<# Existing Dev issuer only. Never changes Main or a relay firewall/task.
   A separate protected Oracle rollback is retained for every switch attempt.
   Run on the VPS only after the reviewed relay is active and Dev is drained. #>
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Inspect','Switch','Rollback')][string]$Step,
      [Parameter(Mandatory)][string]$RelayIPv4,
      [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedDevCommit,
      [string]$ReceiptDirectory='',
      [switch]$AllowChatOnlyMaintenance)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(-not $IsWindows){throw 'Dev relay rotation requires Windows.'}
. (Join-Path $PSScriptRoot 'PionHost.ps1')
. (Join-Path $PSScriptRoot 'PionPolicy.ps1')
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'scripts/vps/ServerHold.ps1')
. (Join-Path $repo 'scripts/deploy/ServiceAccount.ps1')
$script:turnOwner=Get-PionOwnerIdentity
$script:turnHoldBy=(Get-ThornswoodHoldBy -Script 'Switch-DevTurnRelay.ps1')+' '+[guid]::NewGuid().ToString('n')
$script:turnHoldOwned=$false;$script:turnIssuerHealthy=$false
$policy=Get-Content -LiteralPath (Join-Path $repo 'records/turn/relay-policy.json') -Raw | ConvertFrom-Json
$null=Get-PionConfiguration $policy dev $RelayIPv4 (Join-Path $env:SystemDrive 'Thornswood-Turn-Dev/private/shared-key.txt')
$relayRoot=Join-Path $env:SystemDrive 'Thornswood-Turn-Dev'
$voiceRoot=Join-Path $env:SystemDrive 'Thornswood-Voice-Dev'
$taskName='Thornswood Dev Voice'
$voiceSid=([Security.Principal.NTAccount]::new('NT TASK',$taskName)).Translate([Security.Principal.SecurityIdentifier]).Value
$keyPath=Join-Path $voiceRoot 'turn-key.txt'
$newUrl='turn:'+$RelayIPv4+':'+$policy.roles.dev.udpPort+'?transport=udp'

function AcquireTurnHold {
 $file=Get-ThornswoodHoldFile -Target $taskName
 if(Test-Path -LiteralPath $file){throw 'Dev voice already has a maintenance hold; coordinate its existing owner.'}
 $line=Set-ThornswoodHold -Target $taskName -Why 'controlled TURN issuer rotation' -By $script:turnHoldBy -Minutes 30
 if($line -notmatch '^held '){throw 'Dev voice maintenance hold could not be established.'}
 $script:turnHoldOwned=$true
}
function ReleaseTurnHoldIfHealthy {
 if(-not $script:turnHoldOwned -or -not $script:turnIssuerHealthy){return}
 $file=Get-ThornswoodHoldFile -Target $taskName
 $current=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
 if($current.by -cne $script:turnHoldBy){throw 'Dev maintenance hold ownership changed; do not clear it.'}
 $line=Clear-ThornswoodHold -Target $taskName
 if($line -notmatch '^released '){throw 'Verified Dev issuer is up, but its maintenance hold could not be cleared.'}
 $script:turnHoldOwned=$false
}
function Health([int]$Port){Invoke-RestMethod -TimeoutSec 5 ('http://127.0.0.1:'+$Port+'/health')}
function MainSnapshot {
 $h=Health 7778;$p=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7778 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
 if($p.Count -ne 1 -or -not $h.ok){throw 'Cannot establish unchanged Main voice identity.'}
 return @{pid=$p[0];started=(Get-Process -Id $p[0] -ErrorAction Stop).StartTime.ToUniversalTime().Ticks;source=$h.deploy.commit;turn=$h.turn}
}
function AssertMain($Before){
 $after=MainSnapshot
 foreach($name in 'pid','started','source','turn'){if($after[$name] -cne $Before.$name){throw 'Main voice changed during the Dev-only transaction; inspect before any further action.'}}
}
function DevTask {
 $task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
 Assert-PionTaskPrincipal $task
 if(@($task.Actions).Count -ne 1){throw 'The existing Dev voice task has an unexpected action count.'}
 $action=@($task.Actions)[0]
 $owner=Get-PionOwnerIdentity
 if($owner.path -ine $script:turnOwner.path -or $owner.sha256 -cne $script:turnOwner.sha256 -or $action.Execute -ine $owner.path -or -not $action.Arguments.StartsWith($voiceSid+' "',[StringComparison]::Ordinal) -or $action.Arguments -match 'THORNSWOOD_TURN_(SECRET|PASS|USER)='){throw 'Unexpected Dev voice owner wrapper or credential-bearing task action.'}
 Assert-PionVoiceAction $action $voiceRoot $voiceSid $owner.path (Get-PionCommandInterpreter) (Get-Command node.exe -ErrorAction Stop).Source
 return $task
}
function DevClear {
 param([switch]$ForRollback)
 $h=Health 7789
 if(-not $h.ok -or $h.bind -cne '127.0.0.1' -or $h.auth -cne 'on' -or (-not $ForRollback -and $h.turn -cne 'ephemeral') -or $h.deploy.commit -cne $ExpectedDevCommit){throw 'Unexpected Dev health/source/auth state.'}
 if($h.people -ne 0 -or $h.tracked -ne 0 -or ($h.peers -ne 0 -and -not $AllowChatOnlyMaintenance)){throw 'Dev has active peers or in-world profiles; do not interrupt them.'}
 if($AllowChatOnlyMaintenance -and $h.peers -gt 0){Write-Information ('Controlled Dev maintenance may reconnect '+[int]$h.peers+' unplaced signaling sockets; no voice places or tracked profiles.') -InformationAction Continue}
 return $h
}
function WaitDevStopped([int]$OwnedPid=0){
 $deadline=[DateTime]::UtcNow.AddSeconds(15)
 do{
  $listener=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7789 -State Listen -ErrorAction SilentlyContinue)
  $running=(Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State -eq 'Running'
  $oldAlive=$OwnedPid -gt 0 -and [bool](Get-Process -Id $OwnedPid -ErrorAction SilentlyContinue)
  if(-not $running -and -not $listener.Count -and -not $oldAlive){return}
  Start-Sleep -Milliseconds 100
 }while([DateTime]::UtcNow -lt $deadline)
 throw 'Dev task/listener termination is unverified; do not replace keys or start another issuer.'
}
function StopDev {
 param([switch]$ForRollback,[switch]$Recovery)
 $script:turnStopIssued=$false;$script:turnStopPid=0
 Disable-ScheduledTask -TaskName $taskName | Out-Null
 try{
  if(-not $Recovery){$null=DevClear -ForRollback:$ForRollback}
  $old=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7789 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if($old.Count -gt 1 -or (-not $Recovery -and $old.Count -ne 1)){throw 'Dev has an ambiguous listener identity.'}
  if($old.Count){$script:turnStopPid=$old[0]}
 }catch{Enable-ScheduledTask -TaskName $taskName | Out-Null;throw}
 $script:turnStopIssued=$true;$script:turnIssuerHealthy=$false
 Stop-ScheduledTask -TaskName $taskName
 WaitDevStopped $script:turnStopPid
}
function ReplaceKey([byte[]]$Bytes){
 $pending=Join-Path $voiceRoot ('turn-key.'+[guid]::NewGuid().ToString('n')+'.pending')
 try{
  Write-PionProtectedFile $pending $Bytes $voiceSid
  Assert-PionSecretAcl $pending $voiceSid
  [IO.File]::Replace($pending,$keyPath,[NullString]::Value)
  Assert-PionSecretAcl $keyPath $voiceSid
 }finally{if(Test-Path -LiteralPath $pending){Remove-Item -LiteralPath $pending -Force}}
}
function RestoreIssuer([string]$Receipt,[switch]$AlreadyStopped,$ExpectedMain=$null){
 if($null -eq $ExpectedMain){$ExpectedMain=MainSnapshot}
 $full=[IO.Path]::GetFullPath($Receipt);$allowed=(Join-Path $relayRoot 'rollback').TrimEnd('\')+'\'
 if(-not $full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($full) -cnotmatch '^attempt-[a-f0-9]{32}$'){throw 'Rollback receipt is outside the owned relay transaction directory.'}
 $info=Get-Content -LiteralPath (Join-Path $full 'receipt.json') -Raw | ConvertFrom-Json
 if($info.role -cne 'dev' -or $info.voiceSid -cne $voiceSid -or $info.source -cne $ExpectedDevCommit){throw 'Rollback receipt does not identify this Dev issuer.'}
 foreach($file in 'receipt.json','oracle-key.txt','original-action.json'){Assert-PionSecretAcl (Join-Path $full $file)}
 if((Get-FileHash -LiteralPath (Join-Path $full 'oracle-key.txt') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $info.keyHash -or (Get-FileHash -LiteralPath (Join-Path $full 'original-action.json') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $info.actionHash){throw 'Protected rollback bytes differ from their retained receipt.'}
 if(-not $AlreadyStopped){
  $listeners=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7789 -State Listen -ErrorAction SilentlyContinue)
  if($listeners.Count){$null=DevClear -ForRollback;StopDev -ForRollback}
  else{if((Get-ScheduledTask -TaskName $taskName).State -eq 'Running'){throw 'Unhealthy Dev task is still running without a listener; inspect and stop that owned task before rollback.'};Disable-ScheduledTask -TaskName $taskName | Out-Null}
 }
 WaitDevStopped $script:turnStopPid
 $bytes=[IO.File]::ReadAllBytes((Join-Path $full 'oracle-key.txt'))
 try{ReplaceKey $bytes}finally{[Array]::Clear($bytes,0,$bytes.Length)}
 $a=Get-Content -LiteralPath (Join-Path $full 'original-action.json') -Raw | ConvertFrom-Json
 $null=DevTask
 $action=New-ScheduledTaskAction -Execute $a.execute -Argument $a.arguments -WorkingDirectory $a.workingDirectory
 Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null
 Enable-ScheduledTask -TaskName $taskName | Out-Null
 Start-ScheduledTask -TaskName $taskName
 WaitIssuer $info.oracleUrl
 $script:turnIssuerHealthy=$true
 AssertMain $ExpectedMain
 Write-Output 'Protected Oracle issuer rollback verified; the separate Windows relay/key were retained for controlled cleanup.'
}
function WaitIssuer([string]$ExpectedUrl){
 $deadline=[DateTime]::UtcNow.AddSeconds(20);$ready=$false
 do{
  try{
   $h=Health 7789
   if($h.ok -and $h.auth -ceq 'on' -and $h.bind -ceq '127.0.0.1' -and $h.deploy.commit -ceq $ExpectedDevCommit -and $h.turn -ceq 'ephemeral'){
    $ice=Invoke-RestMethod -TimeoutSec 5 'http://127.0.0.1:7789/ice'
    $relay=@($ice.iceServers | Where-Object {@($_.urls | Where-Object {$_ -match '^turn:'}).Count})
    if($relay.Count -ne 1 -or @($relay[0].urls).Count -ne 1 -or [string]@($relay[0].urls)[0] -cne $ExpectedUrl){throw 'Dev relay endpoint differs from the transaction target.'}
    $user=[string]$relay[0].username
    if($user -cnotmatch '^[0-9]{10}$' -or [long]$user -le [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -or [long]$user -gt [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+3660){throw 'Dev did not issue a bounded numeric-expiry credential.'}
    $key=[IO.File]::ReadAllText($keyPath).Trim();$mac=[Security.Cryptography.HMACSHA1]::new([Text.Encoding]::ASCII.GetBytes($key))
    try{$expected=[Convert]::ToBase64String($mac.ComputeHash([Text.Encoding]::ASCII.GetBytes($user)))}finally{$mac.Dispose();$key=$null}
    if($expected -cne [string]$relay[0].credential){throw 'The live Dev issuer does not match its protected key.'}
    $expected=$null;$ice=$null;$relay=$null;$ready=$true;break
   }
  }catch{$lastFailure=$_.Exception.GetType().Name}
  Start-Sleep -Milliseconds 200
 }while([DateTime]::UtcNow -lt $deadline)
 if(-not $ready){throw 'Dev issuer failed its bounded health/endpoint/HMAC verification.'}
}

$task=DevTask
if($Step -eq 'Inspect'){
 $dev=Health 7789
 @{devSource=$dev.deploy.commit;devPeers=$dev.peers;devPeople=$dev.people;devTracked=$dev.tracked;turn=$dev.turn;restrictedOwner=$true;requestedUrlIsCurrent=$task.Actions[0].Arguments.Contains('THORNSWOOD_TURN_URL='+$newUrl);main=MainSnapshot} | ConvertTo-Json -Depth 4 -Compress
 exit
}
if($Step -eq 'Rollback'){
 if(-not $ReceiptDirectory){throw 'Rollback requires the exact retained transaction receipt directory.'}
 AcquireTurnHold
 try{RestoreIssuer $ReceiptDirectory}finally{ReleaseTurnHoldIfHealthy}
 exit
}
Assert-PionCutover $RelayIPv4
$null=DevClear
Assert-PionSecretAcl $keyPath $voiceSid
$main=MainSnapshot
$state=Get-Content -LiteralPath (Join-Path $relayRoot 'relay.json') -Raw | ConvertFrom-Json
if($state.role -cne 'dev' -or $state.relayIPv4 -cne $RelayIPv4 -or -not $state.lastActivationVerifiedUtc){throw 'The separate Dev relay has no completed activation proof.'}
Assert-PionInstalledFiles $relayRoot
$endpoint=@(Get-NetUDPEndpoint -LocalAddress $RelayIPv4 -LocalPort $policy.roles.dev.udpPort -ErrorAction Stop)
if($endpoint.Count -ne 1 -or (Get-Process -Id $endpoint[0].OwningProcess -ErrorAction Stop).Path -ine (Join-Path $relayRoot 'runtime/thornswood-turn.exe')){throw 'The exact separate native relay is not listening.'}
$newKeyPath=Join-Path $relayRoot 'private/shared-key.txt'
Assert-PionSecretAcl $newKeyPath $state.taskSid
$oldAction=@($task.Actions)[0]
$turnMatches=[regex]::Matches($oldAction.Arguments,'(?<=set THORNSWOOD_TURN_URL=)([^&\"]+)(?=&&)')
if($turnMatches.Count -ne 1){throw 'The old task has no unique relay URL binding.'}
$oldUrl=$turnMatches[0].Value
if($oldUrl -ceq $newUrl -or $oldUrl -cnotmatch '^turn:[A-Za-z0-9.-]+:[0-9]{1,5}(\?transport=udp)?$'){throw 'The previous ephemeral relay is not a distinct canonical UDP rollback target.'}
$rollback=Join-Path $relayRoot 'rollback';[void][IO.Directory]::CreateDirectory($rollback)
$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetSecurityDescriptorSddlForm('D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)');[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($rollback),$acl)
$attempt=Join-Path $rollback ('attempt-'+[guid]::NewGuid().ToString('n'));[void][IO.Directory]::CreateDirectory($attempt)
$keyBytes=[IO.File]::ReadAllBytes($keyPath)
try{Write-PionProtectedFile (Join-Path $attempt 'oracle-key.txt') $keyBytes}finally{[Array]::Clear($keyBytes,0,$keyBytes.Length)}
$a=@{execute=$oldAction.Execute;arguments=$oldAction.Arguments;workingDirectory=$oldAction.WorkingDirectory}
Write-PionProtectedFile (Join-Path $attempt 'original-action.json') ([Text.Encoding]::UTF8.GetBytes(($a | ConvertTo-Json -Compress)))
$info=@{role='dev';voiceSid=$voiceSid;source=$ExpectedDevCommit;oracleUrl=$oldUrl;main=$main;createdUtc=[DateTime]::UtcNow.ToString('o');keyHash=(Get-FileHash -LiteralPath (Join-Path $attempt 'oracle-key.txt') -Algorithm SHA256).Hash.ToLowerInvariant();actionHash=(Get-FileHash -LiteralPath (Join-Path $attempt 'original-action.json') -Algorithm SHA256).Hash.ToLowerInvariant()}
Write-PionProtectedFile (Join-Path $attempt 'receipt.json') ([Text.Encoding]::UTF8.GetBytes(($info | ConvertTo-Json -Depth 5 -Compress)))
$stopped=$false;$script:turnStopIssued=$false
AcquireTurnHold
$script:turnIssuerHealthy=$true
try{
 StopDev;$stopped=$true
 $bytes=[IO.File]::ReadAllBytes($newKeyPath)
 try{
  if([Text.Encoding]::ASCII.GetString($bytes).Trim() -cnotmatch '^[a-f0-9]{64}$'){throw 'New protected relay key has an invalid shape.'}
  ReplaceKey $bytes
 }finally{[Array]::Clear($bytes,0,$bytes.Length)}
 $newArguments=$oldAction.Arguments.Substring(0,$turnMatches[0].Index)+$newUrl+$oldAction.Arguments.Substring($turnMatches[0].Index+$turnMatches[0].Length)
 $action=New-ScheduledTaskAction -Execute $oldAction.Execute -Argument $newArguments -WorkingDirectory $oldAction.WorkingDirectory
 Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null
 Enable-ScheduledTask -TaskName $taskName | Out-Null
 Start-ScheduledTask -TaskName $taskName
 WaitIssuer $newUrl
 $script:turnIssuerHealthy=$true
 $null=DevTask
 AssertMain $main
 @{devSource=$ExpectedDevCommit;ephemeralIssuerVerified=$true;protectedKeyMatched=$true;mainPreserved=$true;receiptDirectory=$attempt;realMediaAcceptance=$false} | ConvertTo-Json -Compress
}catch{
 $cause=$_
 if($stopped){
  # A new issuer may have started: stop that owned task, and prove it ended
  # before any rollback write. Errors are not suppressed or called stopped.
  StopDev -Recovery
  RestoreIssuer $attempt -AlreadyStopped -ExpectedMain $main
 }elseif($script:turnStopIssued){
  # Original settings/key are unchanged. If a partial stop actually ended,
  # restore its original running state; otherwise only re-enable the same
  # task and leave the live process/key untouched for operator inspection.
  try{WaitDevStopped $script:turnStopPid;RestoreIssuer $attempt -AlreadyStopped -ExpectedMain $main}
  catch{Enable-ScheduledTask -TaskName $taskName | Out-Null;throw}
 }
 throw $cause
}finally{
 ReleaseTurnHoldIfHealthy
}
