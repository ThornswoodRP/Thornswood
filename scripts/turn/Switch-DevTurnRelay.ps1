<# Existing Dev issuer only. Never changes Main or a relay firewall/task.
   A separate protected Oracle rollback is retained for every switch attempt.
   Run on the VPS only after the reviewed relay is active and Dev is drained. #>
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Inspect','Switch','Rollback')][string]$Step,
      [Parameter(Mandatory)][string]$RelayIPv4,
      [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedDevCommit,
      [string]$ReceiptDirectory='')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(-not $IsWindows){throw 'Dev relay rotation requires Windows.'}
. (Join-Path $PSScriptRoot 'CoturnHost.ps1')
. (Join-Path $PSScriptRoot 'CoturnPolicy.ps1')
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$policy=Get-Content -LiteralPath (Join-Path $repo 'records/turn/relay-policy.json') -Raw | ConvertFrom-Json
$null=Get-CoturnPublicOptions $policy dev $RelayIPv4
$relayRoot=Join-Path $env:SystemDrive 'Thornswood-Turn-Dev'
$voiceRoot=Join-Path $env:SystemDrive 'Thornswood-Voice-Dev'
$taskName='Thornswood Dev Voice'
$voiceSid=([Security.Principal.NTAccount]::new('NT TASK',$taskName)).Translate([Security.Principal.SecurityIdentifier]).Value
$keyPath=Join-Path $voiceRoot 'turn-key.txt'
$newUrl='turn:'+$RelayIPv4+':'+$policy.roles.dev.udpPort+'?transport=udp'

function Health([int]$Port){Invoke-RestMethod -TimeoutSec 5 ('http://127.0.0.1:'+$Port+'/health')}
function MainSnapshot {
 $h=Health 7778;$p=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7778 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
 if($p.Count -ne 1 -or -not $h.ok){throw 'Cannot establish unchanged Main voice identity.'}
 return @{pid=$p[0];started=$h.startedAt;source=$h.deploy.commit;turn=$h.turn}
}
function AssertMain($Before){
 $after=MainSnapshot
 foreach($name in 'pid','started','source','turn'){if($after[$name] -cne $Before.$name){throw 'Main voice changed during the Dev-only transaction; inspect before any further action.'}}
}
function DevTask {
 $task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
 if($task.Principal.UserId -notin 'S-1-5-19','NT AUTHORITY\LOCAL SERVICE' -or $task.Principal.RunLevel -ne 'Limited' -or @($task.Actions).Count -ne 1){throw 'The existing Dev voice task is not the restricted canonical task.'}
 $action=@($task.Actions)[0]
 if([IO.Path]::GetFileName($action.Execute) -ine 'thornswood-owner.exe' -or -not $action.Arguments.Contains($voiceSid) -or $action.Arguments -match 'THORNSWOOD_TURN_(SECRET|PASS|USER)='){throw 'Unexpected Dev voice owner wrapper or credential-bearing task action.'}
 if(-not $action.Arguments.Contains('THORNSWOOD_SITE=http://127.0.0.1:3001')){throw 'Dev voice does not use its canonical local ownership issuer.'}
 return $task
}
function DevClear {
 param([switch]$ForRollback)
 $h=Health 7789
 if(-not $h.ok -or $h.bind -cne '127.0.0.1' -or $h.auth -cne 'on' -or (-not $ForRollback -and $h.turn -cne 'ephemeral') -or $h.deploy.commit -cne $ExpectedDevCommit){throw 'Unexpected Dev health/source/auth state.'}
 if($h.peers -ne 0 -or $h.people -ne 0){throw 'Dev has active peers or in-world profiles; do not interrupt them.'}
 return $h
}
function StopDev {
 param([switch]$ForRollback)
 Disable-ScheduledTask -TaskName $taskName | Out-Null
 try{$null=DevClear -ForRollback:$ForRollback}catch{Enable-ScheduledTask -TaskName $taskName | Out-Null;throw}
 try {
  $old=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7789 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
  if($old.Count -ne 1){throw 'Dev has an ambiguous listener identity.'}
 }catch{Enable-ScheduledTask -TaskName $taskName | Out-Null;throw}
 Stop-ScheduledTask -TaskName $taskName
 $deadline=[DateTime]::UtcNow.AddSeconds(15)
 while([DateTime]::UtcNow -lt $deadline -and (Get-Process -Id $old[0] -ErrorAction SilentlyContinue)){Start-Sleep -Milliseconds 100}
 if(Get-Process -Id $old[0] -ErrorAction SilentlyContinue){throw 'The owned Dev listener did not stop; no key or task setting changed.'}
}
function ReplaceKey([byte[]]$Bytes){
 $pending=Join-Path $voiceRoot ('turn-key.'+[guid]::NewGuid().ToString('n')+'.pending')
 try{
  Write-CoturnProtectedFile $pending $Bytes $voiceSid
  Assert-CoturnSecretAcl $pending $voiceSid
  [IO.File]::Replace($pending,$keyPath,$null)
  Assert-CoturnSecretAcl $keyPath $voiceSid
 }finally{if(Test-Path -LiteralPath $pending){Remove-Item -LiteralPath $pending -Force}}
}
function RestoreIssuer([string]$Receipt,[switch]$AlreadyStopped,$ExpectedMain=$null){
 if($null -eq $ExpectedMain){$ExpectedMain=MainSnapshot}
 $full=[IO.Path]::GetFullPath($Receipt);$allowed=(Join-Path $relayRoot 'rollback').TrimEnd('\')+'\'
 if(-not $full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($full) -cnotmatch '^attempt-[a-f0-9]{32}$'){throw 'Rollback receipt is outside the owned relay transaction directory.'}
 $info=Get-Content -LiteralPath (Join-Path $full 'receipt.json') -Raw | ConvertFrom-Json
 if($info.role -cne 'dev' -or $info.voiceSid -cne $voiceSid -or $info.source -cne $ExpectedDevCommit){throw 'Rollback receipt does not identify this Dev issuer.'}
 foreach($file in 'receipt.json','oracle-key.txt','original-action.json'){Assert-CoturnSecretAcl (Join-Path $full $file)}
 if(-not $AlreadyStopped){
  $listeners=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7789 -State Listen -ErrorAction SilentlyContinue)
  if($listeners.Count){$null=DevClear -ForRollback;StopDev -ForRollback}
  else{if((Get-ScheduledTask -TaskName $taskName).State -eq 'Running'){throw 'Unhealthy Dev task is still running without a listener; inspect and stop that owned task before rollback.'};Disable-ScheduledTask -TaskName $taskName | Out-Null}
 }
 $bytes=[IO.File]::ReadAllBytes((Join-Path $full 'oracle-key.txt'))
 try{ReplaceKey $bytes}finally{[Array]::Clear($bytes,0,$bytes.Length)}
 $a=Get-Content -LiteralPath (Join-Path $full 'original-action.json') -Raw | ConvertFrom-Json
 $null=DevTask
 $action=New-ScheduledTaskAction -Execute $a.execute -Argument $a.arguments -WorkingDirectory $a.workingDirectory
 Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null
 Enable-ScheduledTask -TaskName $taskName | Out-Null
 Start-ScheduledTask -TaskName $taskName
 WaitIssuer $info.oracleUrl
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
 @{devSource=$dev.deploy.commit;devPeers=$dev.peers;devPeople=$dev.people;turn=$dev.turn;restrictedOwner=$true;requestedUrlIsCurrent=$task.Actions[0].Arguments.Contains('THORNSWOOD_TURN_URL='+$newUrl);main=MainSnapshot} | ConvertTo-Json -Depth 4 -Compress
 exit
}
if($Step -eq 'Rollback'){
 if(-not $ReceiptDirectory){throw 'Rollback requires the exact retained transaction receipt directory.'}
 RestoreIssuer $ReceiptDirectory
 exit
}
Assert-CoturnCutover $RelayIPv4
$null=DevClear
Assert-CoturnSecretAcl $keyPath $voiceSid
$main=MainSnapshot
$state=Get-Content -LiteralPath (Join-Path $relayRoot 'relay.json') -Raw | ConvertFrom-Json
if($state.role -cne 'dev' -or $state.relayIPv4 -cne $RelayIPv4 -or -not $state.lastActivationVerifiedUtc){throw 'The separate Dev relay has no completed activation proof.'}
$endpoint=@(Get-NetUDPEndpoint -LocalAddress $RelayIPv4 -LocalPort $policy.roles.dev.udpPort -ErrorAction Stop)
if($endpoint.Count -ne 1 -or (Get-Process -Id $endpoint[0].OwningProcess -ErrorAction Stop).Path -ine (Join-Path $relayRoot 'runtime/bin/turnserver.exe')){throw 'The exact separate native relay is not listening.'}
$newKeyPath=Join-Path $relayRoot 'private/shared-key.txt'
Assert-CoturnSecretAcl $newKeyPath
$oldAction=@($task.Actions)[0]
$turnMatches=[regex]::Matches($oldAction.Arguments,'(?<=set THORNSWOOD_TURN_URL=)([^&\"]+)(?=&&)')
if($turnMatches.Count -ne 1){throw 'The old task has no unique relay URL binding.'}
$oldUrl=$turnMatches[0].Value
if($oldUrl -ceq $newUrl -or $oldUrl -cnotmatch '^turn:[A-Za-z0-9.-]+:[0-9]{1,5}(\?transport=udp)?$'){throw 'The previous ephemeral relay is not a distinct canonical UDP rollback target.'}
$rollback=Join-Path $relayRoot 'rollback';[void][IO.Directory]::CreateDirectory($rollback)
$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetSecurityDescriptorSddlForm('D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)');[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($rollback),$acl)
$attempt=Join-Path $rollback ('attempt-'+[guid]::NewGuid().ToString('n'));[void][IO.Directory]::CreateDirectory($attempt)
$keyBytes=[IO.File]::ReadAllBytes($keyPath)
try{Write-CoturnProtectedFile (Join-Path $attempt 'oracle-key.txt') $keyBytes}finally{[Array]::Clear($keyBytes,0,$keyBytes.Length)}
$a=@{execute=$oldAction.Execute;arguments=$oldAction.Arguments;workingDirectory=$oldAction.WorkingDirectory}
Write-CoturnProtectedFile (Join-Path $attempt 'original-action.json') ([Text.Encoding]::UTF8.GetBytes(($a | ConvertTo-Json -Compress)))
$info=@{role='dev';voiceSid=$voiceSid;source=$ExpectedDevCommit;oracleUrl=$oldUrl;main=$main;createdUtc=[DateTime]::UtcNow.ToString('o')}
Write-CoturnProtectedFile (Join-Path $attempt 'receipt.json') ([Text.Encoding]::UTF8.GetBytes(($info | ConvertTo-Json -Depth 5 -Compress)))
$stopped=$false
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
 $null=DevTask
 AssertMain $main
 @{devSource=$ExpectedDevCommit;ephemeralIssuerVerified=$true;protectedKeyMatched=$true;mainPreserved=$true;receiptDirectory=$attempt;realMediaAcceptance=$false} | ConvertTo-Json -Compress
}catch{
 if($stopped){
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName $taskName | Out-Null
  RestoreIssuer $attempt -AlreadyStopped -ExpectedMain $main
 }
 throw
}
