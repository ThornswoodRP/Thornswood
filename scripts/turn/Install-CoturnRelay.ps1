<# Run locally on the Windows game VPS only, after reviewed cutover proof.
   Stage creates a DISABLED isolated task/package; Activate is Dev-only.
   It does not change the voice issuer. That is a separate drained transaction. #>
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Stage','Activate','Stop')][string]$Step,
      [ValidateSet('dev','main')][string]$Role='dev',
      [Parameter(Mandatory)][string]$RelayIPv4,
      [string]$Archive='',
      [ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(-not $IsWindows){throw 'Native relay installation requires Windows.'}
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'CoturnHost.ps1')
. (Join-Path $PSScriptRoot 'CoturnPackage.ps1')
. (Join-Path $PSScriptRoot 'CoturnPolicy.ps1')
. (Join-Path $repo 'scripts/deploy/ServiceAccount.ps1')
. (Join-Path $repo 'scripts/vps/BoxFirewall.ps1')
$policy=Get-Content -LiteralPath (Join-Path $repo 'records/turn/relay-policy.json') -Raw | ConvertFrom-Json
$options=@(Get-CoturnPublicOptions $policy $Role $RelayIPv4)
$r=$policy.roles.$Role
$root=Join-Path $env:SystemDrive ('Thornswood-Turn-'+$(if($Role -eq 'dev'){'Dev'}else{'Main'}))
$ruleName='Thornswood-'+$Role+'-TURN-UDP'
if($Step -eq 'Stop'){
 $state=Get-Content -LiteralPath (Join-Path $root 'relay.json') -Raw | ConvertFrom-Json
 if($state.role -cne $Role -or $state.relayIPv4 -cne $RelayIPv4){throw 'The installed role is not the requested relay.'}
 Stop-ScheduledTask -TaskName $r.taskName
 Disable-ScheduledTask -TaskName $r.taskName | Out-Null
 if(Get-NetFirewallRule -PolicyStore localhost -Name $ruleName -ErrorAction SilentlyContinue){Remove-NetFirewallRule -PolicyStore localhost -Name $ruleName;Sync-ThornswoodFirewall}
 Write-Output 'The isolated relay task and its own ingress rule are stopped; retained package/key remain protected.'
 exit
}
Assert-CoturnCutover $RelayIPv4
if($Step -eq 'Stage'){
 if(-not $Archive -or -not $SourceCommit){throw 'Stage requires the verified retained archive and exact reviewed operations source.'}
 if(Get-ScheduledTask -TaskName $r.taskName -ErrorAction SilentlyContinue){throw 'That relay task already exists; no existing task is overwritten.'}
 if(Test-Path -LiteralPath $root){throw 'That relay root already exists; no existing package/key is overwritten.'}
 $sid=Get-ThornswoodTaskSidFromName $r.taskName
 $vendorPin=Get-Content -LiteralPath (Join-Path $repo 'records/turn/coturn-windows.json') -Raw | ConvertFrom-Json
 [void](Read-CoturnRuntime -Archive $Archive -Pin $vendorPin)
 [void][IO.Directory]::CreateDirectory($root)
 $item=Get-Item -LiteralPath $root -Force
 $owner=(Get-Acl -LiteralPath $root).GetOwner([Security.Principal.SecurityIdentifier]).Value
 if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $owner -notin @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')){throw 'The new relay root is not a plain operator-owned directory.'}
 Set-CoturnDirectoryAcl $root $sid
 & (Join-Path $PSScriptRoot 'New-CoturnPackage.ps1') -Archive $Archive -OutputDirectory (Join-Path $root 'runtime')
 if(-not $?){throw 'Pinned relay staging failed.'}
 foreach($name in 'ops','private','logs'){[void][IO.Directory]::CreateDirectory((Join-Path $root $name));Set-CoturnDirectoryAcl (Join-Path $root $name) $sid -Writable:($name -eq 'logs')}
 foreach($name in 'CoturnHost.ps1','CoturnPolicy.ps1','Run-Coturn.ps1','Run-Coturn.js'){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $root ('ops/'+$name))}
 Copy-Item -LiteralPath (Join-Path $repo 'scripts/vps/Server-Log.js') -Destination (Join-Path $root 'ops/server-log.js')
 Copy-Item -LiteralPath (Join-Path $repo 'records/turn/coturn-windows.json') -Destination (Join-Path $root 'supplier-pin.json')
 Copy-Item -LiteralPath (Join-Path $repo 'records/turn/relay-policy.json') -Destination (Join-Path $root 'relay-policy.json')
 $key=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
 $keyBytes=[Text.Encoding]::ASCII.GetBytes($key+"`n")
 try{Write-CoturnProtectedFile (Join-Path $root 'private/shared-key.txt') $keyBytes}finally{[Array]::Clear($keyBytes,0,$keyBytes.Length)}
 $configBytes=[Text.Encoding]::ASCII.GetBytes(($options -join "`n")+"`nstatic-auth-secret="+$key+"`n")
 try{Write-CoturnProtectedFile (Join-Path $root 'private/turnserver.conf') $configBytes $sid}finally{[Array]::Clear($configBytes,0,$configBytes.Length);$key=$null}
 Assert-CoturnSecretAcl (Join-Path $root 'private/shared-key.txt')
 Assert-CoturnSecretAcl (Join-Path $root 'private/turnserver.conf') $sid
 @{schema=1;role=$Role;relayIPv4=$RelayIPv4;taskSid=$sid;operationsCommit=$SourceCommit;lastActivationVerifiedUtc=$null} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'relay.json') -Encoding utf8
 Assert-CoturnInstalledFiles $root
 $node=(Get-Command node.exe -ErrorAction Stop).Source
 $action=New-ScheduledTaskAction -Execute $node -Argument ('"'+(Join-Path $root 'ops/server-log.js')+'" --log "'+(Join-Path $root 'logs/turn.log')+'" --days 90 --stamp "'+(Join-Path $root 'ops/Run-Coturn.js')+'"') -WorkingDirectory $root
 $settings=New-ScheduledTaskSettingsSet -Disable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
 Register-ScheduledTask -TaskName $r.taskName -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $settings -Principal (New-ThornswoodServicePrincipal) | Out-Null
 try{
  if((Get-ThornswoodTaskSid $r.taskName) -cne $sid){throw 'The registered task SID differs from the reviewed role.'}
  Set-ThornswoodTaskOwner -TaskName $r.taskName -Sid $sid -Action $action -Roots $root | Out-Null
  $task=Get-ScheduledTask -TaskName $r.taskName
  if($task.Settings.Enabled -or $task.Principal.RunLevel -ne 'Limited' -or $task.Principal.UserId -notin 'S-1-5-19','NT AUTHORITY\LOCAL SERVICE'){throw 'The prepared relay task is not disabled and restricted.'}
 }catch{Disable-ScheduledTask -TaskName $r.taskName | Out-Null;throw}
 Write-Output ('Prepared disabled '+$Role+' relay with separate protected key; no listener/firewall/issuer activation.')
 exit
}
if($Role -ne 'dev'){throw 'Main relay activation remains held; this step only activates Dev.'}
$state=Get-Content -LiteralPath (Join-Path $root 'relay.json') -Raw | ConvertFrom-Json
if($state.role -cne $Role -or $state.relayIPv4 -cne $RelayIPv4 -or $state.taskSid -cne (Get-ThornswoodTaskSidFromName $r.taskName)){throw 'Prepared relay does not match the requested source/role.'}
Assert-CoturnInstalledFiles $root
Assert-CoturnSecretAcl (Join-Path $root 'private/shared-key.txt')
Assert-CoturnSecretAcl (Join-Path $root 'private/turnserver.conf') $state.taskSid
$busy=@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object {$_.LocalPort -eq $r.udpPort -or ($_.LocalPort -ge $r.minPort -and $_.LocalPort -le $r.maxPort)})
if($busy.Count){throw 'The requested relay UDP ports are already held.'}
if(Get-NetFirewallRule -PolicyStore localhost -Name $ruleName -ErrorAction SilentlyContinue){throw 'The relay ingress rule already exists; do not overwrite unknown state.'}
try{
 New-NetFirewallRule -PolicyStore localhost -Name $ruleName -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol UDP -LocalAddress $RelayIPv4 -LocalPort @([string]$r.udpPort,([string]$r.minPort+'-'+[string]$r.maxPort)) -Program (Join-Path $root 'runtime/bin/turnserver.exe') | Out-Null
 Sync-ThornswoodFirewall
 if(-not (Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName -ErrorAction Stop).Enabled){throw 'The actual firewall has not taken the relay ingress rule.'}
 Enable-ScheduledTask -TaskName $r.taskName | Out-Null
 Start-ScheduledTask -TaskName $r.taskName
 $deadline=[DateTime]::UtcNow.AddSeconds(15);$endpoint=@()
 while([DateTime]::UtcNow -lt $deadline){
  $endpoint=@(Get-NetUDPEndpoint -LocalAddress $RelayIPv4 -LocalPort $r.udpPort -ErrorAction SilentlyContinue)
  if($endpoint.Count -eq 1){break}
  Start-Sleep -Milliseconds 200
 }
 if($endpoint.Count -ne 1){throw 'The exact relay listener did not become ready.'}
 $pidValue=$endpoint[0].OwningProcess
 $process=Get-Process -Id $pidValue -ErrorAction Stop
 if($process.Path -ine (Join-Path $root 'runtime/bin/turnserver.exe')){throw 'The listener is not the staged native relay executable.'}
 $all=@(Get-NetUDPEndpoint -OwningProcess $pidValue -ErrorAction Stop)
 if(@($all | Where-Object {$_.LocalAddress -cne $RelayIPv4 -or ($_.LocalPort -ne $r.udpPort -and ($_.LocalPort -lt $r.minPort -or $_.LocalPort -gt $r.maxPort))}).Count -or @(Get-NetTCPConnection -OwningProcess $pidValue -ErrorAction SilentlyContinue).Count){throw 'The native relay opened an unexpected endpoint.'}
 $state.lastActivationVerifiedUtc=[DateTime]::UtcNow.ToString('o');$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'relay.json') -Encoding utf8
 @{role=$Role;task=$r.taskName;pid=$pidValue;activeSourceVerified=$true;exactUdpScope=$true;issuerChanged=$false} | ConvertTo-Json -Compress
}catch{
 Stop-ScheduledTask -TaskName $r.taskName -ErrorAction SilentlyContinue
 Disable-ScheduledTask -TaskName $r.taskName | Out-Null
 if(Get-NetFirewallRule -PolicyStore localhost -Name $ruleName -ErrorAction SilentlyContinue){Remove-NetFirewallRule -PolicyStore localhost -Name $ruleName;Sync-ThornswoodFirewall}
 throw
}
