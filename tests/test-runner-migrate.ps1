<# #4048: execute installer validation and extracted migration functions with
   OS/native stand-ins only. No account, service, drive or GitHub changes. #>
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\scripts\deploy\Install-Runner.ps1'
$ps = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Check($name, [scriptblock]$body) {
  try { & $body; $script:pass++; Write-Host "PASS  $name" }
  catch { $script:fail++; Write-Host "FAIL  $name`: $($_.Exception.Message)" }
}
function Assert($ok, $why) { if (-not $ok) { throw $why } }
Check 'migration requires an operator-confirmed local maintenance window' {
  $out = & $ps -NoProfile -NonInteractive -File $installer -OffBox -Migrate -NoPause 2>&1 | Out-String
  Assert ($LASTEXITCODE -eq 1 -and $out -match 'Migrate requires -OffBox and -MaintenanceWindow') $out
}
$source = [IO.File]::ReadAllText($installer)
$lib = [regex]::Match($source, '(?s)\$migrateLib = @''\r?\n(.*?)\r?\n''@').Groups[1].Value
Check 'missing account or service is recovery, not migration' {
  Assert ($lib.Length -gt 0) 'migration library is missing'
  . ([scriptblock]::Create($lib))
  foreach ($missing in 'Account', 'Service') {
    $facts = @{ Account = $null; Service = $null }
    $why = ''; try { Assert-RunnerMigrationFacts $facts 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR' } catch { $why = $_.Exception.Message }
    Assert ($why -match 'Move-RunnersToDrive.ps1 -Recover') $why
  }
}
function Fixture {
  @{
    Account = @{ Name='thornswood-pr'; SID='S-1-5-21-1-2-3-1001'; Enabled=$true }
    Service = @{ Name='actions.runner.test'; StartName='.\thornswood-pr'; PathName='"C:\Thornswood-RunnerPR\bin\RunnerService.exe"'; State='Running'; StartMode='Auto' }
    Volumes = @(@{ DriveLetter='R'; FileSystem='ReFS'; FileSystemLabel='Thornswood Runners'; HealthStatus='Healthy' })
    Defender = @{ AMServiceEnabled=$true; AntivirusEnabled=$true; RealTimeProtectionEnabled=$true; AMRunningMode='Normal' }
    ExclusionPath=@(); ExclusionProcess=@(); ExclusionExtension=@()
    Performance = 0
    VolumeQuery = "This is a trusted developer volume.`nDeveloper volumes are protected by antivirus filter.`nFilters currently attached to this developer volume:`n WdFilter, FileInfo"
    GlobalQuery = 'Developer volumes are enabled. Developer volumes are protected by antivirus filter.'
    Profiles = @(@{ SID='S-1-5-21-1-2-3-1001'; LocalPath='C:\Users\thornswood-pr'; Loaded=$true })
    Workers = @(); DestinationExists=$false
  }
}
Check 'healthy migration preserves the loaded live SID and canonical source' {
  . ([scriptblock]::Create($lib))
  $plan = Assert-RunnerMigrationFacts (Fixture) 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  Assert ($plan.SID -eq 'S-1-5-21-1-2-3-1001' -and $plan.Source -eq 'C:\Thornswood-RunnerPR' -and -not $plan.AlreadyThere) 'bad plan'
}
Check 'the PowerShell performance-mode value does not decide readiness; Windows Security showed R: scanning asynchronously while it read 1 (#4048)' {
  . ([scriptblock]::Create($lib))
  foreach ($value in @(1, $null)) {
    $f = Fixture; $f.Performance = $value
    $plan = Assert-RunnerMigrationFacts $f 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
    Assert ($plan.SID -eq 'S-1-5-21-1-2-3-1001') "performance value $value blocked migration"
  }
}
Check 'unsafe volume, Defender, identity, profile, busy and collision metadata fail closed' {
  . ([scriptblock]::Create($lib))
  $cases = @(
    { param($f) $f.Volumes=@() },
    { param($f) $f.Volumes+= $f.Volumes[0] },
    { param($f) $f.Volumes[0].FileSystem='NTFS' },
    { param($f) $f.VolumeQuery='not trusted' },
    { param($f) $f.VolumeQuery=$f.VolumeQuery -replace 'WdFilter','Other' },
    { param($f) $f.GlobalQuery='Developer volumes are not protected by antivirus filter.' },
    { param($f) $f.Defender.RealTimeProtectionEnabled=$false },
    { param($f) $f.Defender.AMRunningMode='Passive Mode' },
    { param($f) $f.ExclusionPath=@('R:\') },
    { param($f) $f.ExclusionPath=@('R:\Thornswood-RunnerPR\_work') },
    { param($f) $f.ExclusionPath=@('C:\Thornswood-RunnerPR') },
    { param($f) $f.ExclusionProcess=@('Runner.Listener.exe') },
    { param($f) $f.ExclusionExtension=@('ps1') },
    { param($f) $f.Service.StartName='DOMAIN\thornswood-pr' },
    { param($f) $f.Service.PathName='C:\Elsewhere\bin\RunnerService.exe' },
    { param($f) $f.Profiles[0].SID='S-1-5-21-9-9-9-9999' },
    { param($f) $f.Workers=@(123) },
    { param($f) $f.DestinationExists=$true }
  )
  $accepted=@()
  foreach ($change in $cases) {
    $f=Fixture; & $change $f
    $why=''; try { $null=Assert-RunnerMigrationFacts $f 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR' } catch { $why=$_.Exception.Message }
    if (-not $why) { $accepted += [string]$change }
  }
  Assert ($accepted.Count -eq 0) ('accepted unsafe cases: ' + ($accepted -join '; '))
}
Check 'migration native exit codes override misleading success text' {
  . ([scriptblock]::Create($lib))
  function fake-native { $global:LASTEXITCODE=17; 'service Running' }
  $why=''; try { Invoke-RunnerMigrationNative 'fake-native' @('x') } catch { $why=$_.Exception.Message }
  Assert ($why -match 'exit 17') 'nonzero native result was accepted'
}
Check 'clears only selected SID deny at own root and verifies readback' {
  . ([scriptblock]::Create($lib))
  $script:removed=@(); $script:denied=$true
  $plan = Assert-RunnerMigrationFacts (Fixture) 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  function Get-Acl {
    param($LiteralPath)
    $acl = [pscustomobject]@{}
    $acl | Add-Member ScriptMethod GetAccessRules { param($e,$i,$t)
      if ($script:denied) { [pscustomobject]@{ AccessControlType='Deny'; IdentityReference=[pscustomobject]@{ Value='S-1-5-21-1-2-3-1001' }; IsInherited=$false } }
      [pscustomobject]@{ AccessControlType='Deny'; IdentityReference=[pscustomobject]@{ Value='S-1-5-21-1-2-3-1002' }; IsInherited=$false }
    }
    $acl
  }
  function icacls.exe {
    $script:removed += ,@($args); $script:denied=$false; $global:LASTEXITCODE=0
  }
  Clear-RunnerMigrationDeny $plan 'R:\'
  Assert ($script:removed.Count -eq 1 -and ($script:removed[0] -join '|') -eq 'R:\|/remove:d|*S-1-5-21-1-2-3-1001|/C|/Q') 'broad deny removal'
  $why=''; try { Clear-RunnerMigrationDeny $plan 'C:\Users' } catch { $why=$_.Exception.Message }
  Assert ($why -and $script:removed.Count -eq 1) 'accepted an unrelated path'
}
Check 'dry run never discovers live labelled drives and defaults to deterministic C:' {
  $file=Join-Path ([IO.Path]::GetTempPath()) ('migrate-dry-' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    $out = & $ps -NoProfile -NonInteractive -Command "function Get-Volume { Write-Host 'LIVE_VOLUME_LOOKUP'; throw 'fixture' }; & '$installer' -OffBox -DryRunTo '$file' -NoPause" 2>&1 | Out-String
    Assert ($LASTEXITCODE -eq 0 -and $out -notmatch 'LIVE_VOLUME_LOOKUP') $out
    $text=[IO.File]::ReadAllText($file)
    Assert ($text.Contains("`$root = 'C:\Thornswood-RunnerPR'")) 'non-deterministic dry-run root'
    Assert ($text -notmatch 'Set-TimeWait.ps1 -Restart') 'off-box script directs an unrelated VPS restart'
  } finally { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
}
Check 'stopping migration waits selected service and selected processes before returning' {
  . ([scriptblock]::Create($lib))
  $plan=Assert-RunnerMigrationFacts (Fixture) 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  $script:events=@(); $script:processPoll=0
  function Stop-Service { param($Name,$Force,$ErrorAction) $script:events+='stop:'+$Name }
  function Get-Service {
    param($Name,$ErrorAction)
    $s=[pscustomobject]@{ Status='Stopped' }
    $s | Add-Member ScriptMethod WaitForStatus { param($state,$timeout) $script:events+='wait:'+ $state }
    $s | Add-Member ScriptMethod Dispose { $script:events+='dispose' }
    $s
  }
  function Get-RunnerMigrationProcesses { param($p) $script:processPoll++; if ($script:processPoll -le 2) { [pscustomobject]@{ ProcessId=10; Name='Runner.Listener.exe' } } }
  function Start-Sleep { param($Milliseconds) $script:events+='process-wait' }
  Stop-RunnerForMigration $plan
  Assert (($script:events -join '|') -eq 'stop:actions.runner.test|wait:Stopped|dispose|process-wait') 'did not stop and wait the selected service/processes'
  function Get-RunnerMigrationProcesses { param($p) [pscustomobject]@{ ProcessId=10; Name='Runner.Worker.exe' } }
  $script:events=@(); $why=''; try { Stop-RunnerForMigration $plan } catch { $why=$_.Exception.Message }
  Assert ($why -match 'worker' -and $script:events.Count -eq 0) 'stopped a busy runner'
}
Check 'post-install verification rejects wrong identity, path, automatic start or no listener' {
  . ([scriptblock]::Create($lib))
  $plan=Assert-RunnerMigrationFacts (Fixture) 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  $script:svc=@{ Name=$plan.Service; PathName='"R:\Thornswood-RunnerPR\bin\RunnerService.exe"'; StartName='.\thornswood-pr'; State='Running'; StartMode='Manual' }
  function Get-LocalUser { param($Name,$ErrorAction) [pscustomobject]@{ SID='S-1-5-21-1-2-3-1001' } }
  function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) if ($ClassName -eq 'Win32_Service') { [pscustomobject]$script:svc } else { (Fixture).Profiles; [pscustomobject]@{SID='S-1-5-21-1-2-3-1002'; LocalPath='C:\Users\thornswood-pr2'; Loaded=$true} } }
  function Get-RunnerMigrationProcesses { param($p) [pscustomobject]@{ Name='Runner.Listener.exe'; ExecutablePath='R:\Thornswood-RunnerPR\bin\Runner.Listener.exe' } }
  Assert-RunnerMigrationService $plan
  foreach ($key in 'StartName','PathName','StartMode','State') {
    $old=$script:svc[$key]; $script:svc[$key]='wrong'; $why=''
    try { Assert-RunnerMigrationService $plan } catch { $why=$_.Exception.Message }
    Assert ($why.Length -gt 0) "accepted wrong $key"; $script:svc[$key]=$old
  }
  function Get-RunnerMigrationProcesses { param($p) @() }
  $why=''; try { Assert-RunnerMigrationService $plan } catch { $why=$_.Exception.Message }
  Assert ($why -match 'listener') 'accepted missing selected listener'
}
Check 'preflight collection stops missing identity before drive discovery or any write' {
  . ([scriptblock]::Create($lib))
  function Get-LocalUser { param($Name,$ErrorAction) $null }
  function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) $null }
  function Get-Volume { throw 'drive lookup reached before identity check' }
  $why=''; try { Get-RunnerMigrationState 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR' } catch { $why=$_.Exception.Message }
  Assert ($why -match 'Move-RunnersToDrive.ps1 -Recover') $why
}
Check 'reparse path and writable drive root are rejected without mutation' {
  . ([scriptblock]::Create($lib))
  function Test-Path { param($LiteralPath,$PathType) $true }
  function Get-Item { param($LiteralPath,$Force,$ErrorAction) [pscustomobject]@{ Attributes=[IO.FileAttributes]::ReparsePoint; FullName=$LiteralPath } }
  $why=''; try { Assert-RunnerMigrationPath 'R:\Thornswood-RunnerPR' } catch { $why=$_.Exception.Message }
  Assert ($why -match 'reparse') $why
  function Get-Acl {
    param($LiteralPath)
    $a=[pscustomobject]@{ AreAccessRulesProtected=$true }
    $a | Add-Member ScriptMethod GetAccessRules { param($e,$i,$t) [pscustomobject]@{ AccessControlType='Allow'; IdentityReference=[pscustomobject]@{ Value='S-1-1-0' }; FileSystemRights=[Security.AccessControl.FileSystemRights]::Modify; InheritanceFlags='None' } }
    $a
  }
  $why=''; try { Assert-RunnerMigrationDriveRoot 'R:\' } catch { $why=$_.Exception.Message }
  Assert ($why -match 'drive root') $why
}
Check 'migration cutover stops before credential reset and locks before selected deny repair' {
  . ([scriptblock]::Create($lib))
  $plan=Assert-RunnerMigrationFacts (Fixture) 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  $script:events=@()
  function Get-RunnerMigrationState { param($a,$s,$r) $plan }
  function Stop-RunnerForMigration { param($p) $script:events+='stop-wait' }
  function Invoke-RunnerMigrationNative { param($c,$a) $script:events+=($c+':'+($a -join ' ')) }
  function Get-Service { param($Name,$ErrorAction) $null }
  function New-Item { param($ItemType,$Path,$ErrorAction) $script:events+='create' }
  function Lock-RunnerRoot { param($r,$a) $script:events+='lock' }
  function Clear-RunnerMigrationDeny { param($p,$r) $script:events+='clear:'+$r }
  function Assert-RunnerMigrationAccess { param($p) $script:events+='access-verified' }
  Begin-RunnerMigration $plan
  Assert (($script:events -join '|') -eq 'stop-wait|sc.exe:delete actions.runner.test|create|lock|clear:R:\|clear:R:\Thornswood-RunnerPR|access-verified') ($script:events -join '|')
}
Check 'generated migration uses existing identity only and never global lock or source cleanup' {
  $file=Join-Path ([IO.Path]::GetTempPath()) ('migrate-plan-' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    $out=& $ps -NoProfile -NonInteractive -File $installer -OffBox -Migrate -MaintenanceWindow -Root 'R:\Thornswood-RunnerPR' -AllowHost 'fixture.invalid' -DryRunTo $file -NoPause 2>&1 | Out-String
    Assert ($LASTEXITCODE -eq 0) $out
    $text=[IO.File]::ReadAllText($file)
    $script:generatedMigration=$text
    Assert ($text -match '(?m)^Begin-RunnerMigration \$migrationPlan') 'migration cutover not generated'
    Assert ($text.IndexOf('Begin-RunnerMigration $migrationPlan') -lt $text.IndexOf('Set-LocalUser -Name $acct')) 'password reset precedes drain'
    Assert ($text -notmatch '(?m)^\s*(New-LocalUser|Remove-LocalUser|Remove-LeftProfiles|Open-RunnerReads|Open-RunnerAccount|Remove-RunnerWatchers)\b') 'migration generated identity deletion, broad opening or global cleanup'
    Assert ($out -notmatch 'Every runner on the box, locked') 'migration ran global lock'
    Assert ($text -match 'Assert-RunnerMigrationService \$migrationPlan') 'selected identity/service verification missing'
  } finally { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
}
Check 'offline or duplicate GitHub registration cannot report success' {
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
  $guard=$ast.Find({ param($a) $a -is [Management.Automation.Language.IfStatementAst] -and $a.Extent.Text -like '*within a minute*' -and $a.Extent.Text -notlike '*while (*' },$true)
  Assert ($null -ne $guard) 'GitHub completion guard missing'
  function Die($message) { throw $message }
  foreach ($items in @(@(@{status='offline'}), @(@{status='online'},@{status='online'}), @(@{status='online (unknown)'}))) {
    $mine=$items; $RunnerName='fixture'; $why=''
    try { & ([scriptblock]::Create($guard.Extent.Text)) } catch { $why=$_.Exception.Message }
    Assert ($why.Length -gt 0) 'offline/duplicate registration accepted'
  }
  $mine=@(@{status='online'}); & ([scriptblock]::Create($guard.Extent.Text))
}
Check 'child subprocess nonzero survives Invoke-Here despite service Running text' {
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
  $fn=$ast.Find({ param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Invoke-Here' },$true)
  . ([scriptblock]::Create($fn.Extent.Text))
  function pwsh { Set-Variable LASTEXITCODE 19 -Scope 1; 'service Running' }
  $DryRunTo=''; $global:LASTEXITCODE=0
  $null=Invoke-Here 'nothing executes'
  Assert ($global:LASTEXITCODE -eq 19) 'lost child exit code'
}
Check 'header no longer prescribes account destruction to move or VPS restart off-box' {
  $header=$source.Substring(0,$source.IndexOf('[CmdletBinding()]'))
  Assert ($header -notmatch '-Number n -Remove\s*\r?\n\s*\.\\scripts\\deploy\\Install-Runner.ps1') 'unsafe remove/install move instructions remain'
  Assert ($header -match '-Migrate -MaintenanceWindow' -and $header -match 'approved local PC restart') 'safe migration/restart instructions missing'
}
Check 'generated credential branch runs only after cutover and rejects a changed SID' {
  . ([scriptblock]::Create($lib))
  $migrationPlan=Assert-RunnerMigrationFacts (Fixture) 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  $acct=$migrationPlan.Account
  $i=$script:generatedMigration.IndexOf('Begin-RunnerMigration $migrationPlan')
  $end=$script:generatedMigration.IndexOf('# Every live Thornswood folder', $i)
  $snippet=$script:generatedMigration.Substring($i,$end-$i)
  $script:events=@(); $script:identity=$migrationPlan.SID
  function Begin-RunnerMigration { param($p) $script:events+='drained-and-locked' }
  function Get-LocalUser { param($Name,$ErrorAction) [pscustomobject]@{SID=$script:identity} }
  function Set-LocalUser { param($Name,$Password,$PasswordNeverExpires) $script:events+='reset' }
  $null=& ([scriptblock]::Create($snippet))
  Assert (($script:events -join '|') -eq 'drained-and-locked|reset') 'generated branch did not reuse Set-LocalUser after cutover'
  $script:events=@(); $script:identity='S-1-5-21-9-9-9-9999'; $why=''
  try { $null=& ([scriptblock]::Create($snippet)) } catch { $why=$_.Exception.Message }
  Assert ($why -and $script:events -notcontains 'reset') 'reset a replacement identity'
}
Check 'Lock-RunnerRoot does not hide failed native broad-grant removal' {
  $locks=[regex]::Match($source, '(?s)\$lockLib = @''\r?\n(.*?)\r?\n''@').Groups[1].Value
  . ([scriptblock]::Create($locks))
  function icacls.exe { $global:LASTEXITCODE=$(if ($args -contains '/remove:g') { 9 } else { 0 }) }
  function Get-Acl { throw 'native failure was hidden until ACL readback' }
  $why=''; try { Lock-RunnerRoot 'R:\Thornswood-RunnerPR' '*S-1-5-21-1-2-3-1001' } catch { $why=$_.Exception.Message }
  Assert ($why -match 'remove broad') $why
}
Check 'allowed filter alone is not proof WdFilter is attached' {
  . ([scriptblock]::Create($lib))
  $f=Fixture; $f.VolumeQuery="This is a trusted developer volume.`nFilters allowed on any developer volume: WdFilter`nFilters currently attached to this developer volume:`n FileInfo"
  $why=''; try { Assert-RunnerMigrationFacts $f 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR' } catch { $why=$_.Exception.Message }
  Assert ($why.Length -gt 0) 'allowed-but-unattached antivirus accepted'
}
Check 'own access verification rejects group denies and requires selected SID Modify' {
  . ([scriptblock]::Create($lib))
  $plan=Assert-RunnerMigrationFacts (Fixture) 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  $script:groupDeny=$false; $script:ownAllow=$true
  function Get-Acl {
    param($LiteralPath)
    $a=[pscustomobject]@{ AreAccessRulesProtected=$true }
    $a | Add-Member ScriptMethod GetAccessRules { param($e,$i,$t)
      if ($script:groupDeny) { [pscustomobject]@{ AccessControlType='Deny'; IdentityReference=[pscustomobject]@{ Value='S-1-5-32-545' }; FileSystemRights=[Security.AccessControl.FileSystemRights]::Read } }
      if ($script:ownAllow) { [pscustomobject]@{ AccessControlType='Allow'; IdentityReference=[pscustomobject]@{ Value='S-1-5-21-1-2-3-1001' }; FileSystemRights=[Security.AccessControl.FileSystemRights]::Modify } }
    }; $a
  }
  Assert-RunnerMigrationAccess $plan
  $script:groupDeny=$true; $why=''
  try { Assert-RunnerMigrationAccess $plan } catch { $why=$_.Exception.Message }
  Assert ($why -match 'deny') 'group deny defeats the new allow'
  $script:groupDeny=$false; $script:ownAllow=$false; $why=''
  try { Assert-RunnerMigrationAccess $plan } catch { $why=$_.Exception.Message }
  Assert ($why -match 'Modify') 'selected SID has no destination Modify allow'
}
Check 'real preflight collector validates mocked Windows metadata and supports already-migrated identity' {
  . ([scriptblock]::Create($lib))
  $script:f=Fixture
  function Get-LocalUser { param($Name,$ErrorAction) [pscustomobject]$script:f.Account }
  function Get-Volume { param($FileSystemLabel,$ErrorAction) $script:f.Volumes }
  function Get-MpComputerStatus { param($ErrorAction) [pscustomobject]$script:f.Defender }
  function Get-MpPreference { param($ErrorAction) [pscustomobject]@{ PerformanceModeStatus=$script:f.Performance; ExclusionPath=@() } }
  function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) switch ($ClassName) { 'Win32_Service' { [pscustomobject]$script:f.Service }; 'Win32_UserProfile' { $script:f.Profiles } } }
  function fsutil.exe { $global:LASTEXITCODE=0; if ($args.Count -eq 3) { $script:f.VolumeQuery } else { $script:f.GlobalQuery } }
  function Get-RunnerMigrationProcesses { param($p) [pscustomobject]@{ Name='Runner.Listener.exe'; ExecutablePath=($p.Source+'\bin\Runner.Listener.exe') } }
  function Test-Path { param($LiteralPath,$PathType) if ($LiteralPath -eq 'R:\Thornswood-RunnerPR') { return [bool]$script:f.DestinationExists }; $true }
  function Get-Item { param($LiteralPath,$Force,$ErrorAction) [pscustomobject]@{ Attributes=[IO.FileAttributes]::Directory; FullName=$LiteralPath } }
  function Get-Acl { param($LiteralPath) $a=[pscustomobject]@{AreAccessRulesProtected=$true}; $a | Add-Member ScriptMethod GetAccessRules { param($e,$i,$t) [pscustomobject]@{ AccessControlType='Allow'; IdentityReference=[pscustomobject]@{Value='S-1-5-18'}; FileSystemRights=[Security.AccessControl.FileSystemRights]::FullControl; InheritanceFlags='None' } }; $a }
  function Get-LocalGroup { param($ErrorAction) [pscustomobject]@{SID='S-1-5-32-545'; Name='Users'} }
  function Get-LocalGroupMember { throw 'should not inspect Users membership as a privileged group' }
  function Get-ScheduledTask { param($TaskName,$ErrorAction) [pscustomobject]@{ State='Ready'; Principal=@{UserId='SYSTEM'}; Actions=@(@{Execute=(Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'); Arguments=('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $env:ProgramData 'Thornswood-RunnerDrive\start.ps1')+'"')}) } }
  # The guards are read from the store an -OffBox install writes them to.
  function Get-NetFirewallRule { param($PolicyStore,$Group,$ErrorAction) if ($PolicyStore -ne 'PersistentStore') { return @() }; [pscustomobject]@{ Enabled='True'; Direction='Outbound'; Action='Block' } }
  $p=Get-RunnerMigrationState 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  Assert ($p.SID -eq $script:f.Account.SID -and -not $p.AlreadyThere) 'collector rejected healthy source'
  $script:f.Service.PathName='"R:\Thornswood-RunnerPR\bin\RunnerService.exe"'; $script:f.DestinationExists=$true
  $p=Get-RunnerMigrationState 'thornswood-pr' 'actions.runner.test' 'R:\Thornswood-RunnerPR'
  Assert ($p.AlreadyThere -and $p.SID -eq $script:f.Account.SID) 'collector did not recognize preserved identity on target'
}
Check 'generated migration executes against OS/native mocks and fails closed at each cutover stage' {
  $body=[regex]::Match($script:generatedMigration, '(?s)# ==== a script it would run, with a secret on standard input ====\r?\n(.*)').Groups[1].Value
  Assert ($body.Length -gt 0) 'generated install script missing'
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput($body,[ref]$tokens,[ref]$errors)
  Assert ($errors.Count -eq 0) ($errors | Out-String)
  # Keep the real generated statements and password generation. Replace only
  # library dependencies with local mocks; no Windows admin command can run.
  $defs=@($ast.FindAll({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -ne 'Pick'},$true) | Sort-Object { $_.Extent.StartOffset } -Descending)
  foreach ($d in $defs) { $body=$body.Remove($d.Extent.StartOffset,$d.Extent.EndOffset-$d.Extent.StartOffset) }
  function Begin-RunnerMigration { param($p) $script:events+='stop-lock'; if ($script:stage -eq 'stop') { throw 'stop failed' } }
  function Get-LocalUser { param($Name,$ErrorAction) [pscustomobject]@{ SID='S-1-5-21-1-2-3-1001' } }
  function Set-LocalUser { param($Name,$Password,$PasswordNeverExpires) $script:events+='reset' }
  function Close-RunnerAccount { $script:events+='folder-guards' }
  function Set-RunnerFirewall { $script:events+='firewall' }
  function Get-RunnerReadDenies { @('C:\Users\<you>','C:\ProgramData\ssh') }
  function Close-RunnerReads { $script:events+='read-guards'; if ($script:stage -eq 'guard') { 'COULD NOT shut selected profile' } }
  function Test-Path { param($LiteralPath,$Path) return (($LiteralPath -eq 'R:\Thornswood-RunnerPR') -or ($Path -eq 'R:\Thornswood-RunnerPR')) }
  function New-Item { throw 'Unplanned filesystem creation in generated-script fixture' }
  function New-LocalUser { throw 'Forbidden account creation in migration fixture' }
  function Remove-LocalUser { throw 'Forbidden account deletion in migration fixture' }
  function Stop-Service { throw 'Unplanned service stop outside the mocked cutover' }
  function icacls.exe { throw 'Unplanned ACL command outside the mocked lock' }
  function Get-Service { param($Name,$ErrorAction) [pscustomobject]@{Status='Running'} }
  function Lock-RunnerRoot { $script:events+='target-lock'; if ($script:stage -eq 'acl') { throw 'ACL failed' } }
  function Set-RunnerTemp { $script:events+='temp' }
  function Set-RunnerHook { $script:events+='hook' }
  function Invoke-WebRequest { param([switch]$UseBasicParsing,$Uri,$OutFile) $script:events+='download'; if ($script:stage -eq 'download') { throw 'download failed' } }
  function Get-FileHash { param($LiteralPath,$Algorithm) [pscustomobject]@{Hash='1150692AFA94E71F872017E254EA55B6EECE1EECE3FE7E3A6D4C93D0A1B85CFC'} }
  function Remove-Item { param($LiteralPath,$Path,[switch]$Force,[switch]$Recurse,$ErrorAction) $script:removed+=@($LiteralPath)+@($Path) }
  function Expand-Archive { param($LiteralPath,$DestinationPath,[switch]$Force) $script:events+='expand' }
  function Get-ChildItem { param($Path,$Filter) @() }
  function Set-Content { param($LiteralPath,$Value) }
  function Push-Location { param($Path) }
  function Pop-Location { }
  function .\config.cmd { $script:events+='config'; $global:LASTEXITCODE=$(if ($script:stage -eq 'config') { 37 } else { 0 }); 'service Running' }
  function sc.exe { $script:events+='demand'; $global:LASTEXITCODE=$(if ($script:stage -eq 'sc') { 38 } else { 0 }) }
  function Start-Sleep { param($Seconds) }
  function Assert-RunnerMigrationAccess { }
  function Assert-RunnerMigrationService { $script:events+='verify' }
  function Get-Process { param($Name,$ErrorAction) @() }
  # The generated script names its folder on the runner drive. A machine
  # without that drive (the box) gets a stand-in for this check alone, so the
  # fixture does not depend on which drives the machine running it has.
  $standIn = $null; $letter = 'R:\Thornswood-RunnerPR'.Substring(0, 1)
  if (-not (Get-PSDrive -Name $letter -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    $standIn = New-PSDrive -Name $letter -PSProvider FileSystem -Root ([IO.Path]::GetTempPath()) -Scope Global
  }
  try {
    foreach ($script:stage in @('success','stop','guard','acl','download','config','sc')) {
      $script:events=@(); $script:removed=@(); $ThornswoodSecret='fixture-token'; $why=''
      try { $null=& ([scriptblock]::Create($body)) } catch { $why=$_.Exception.Message }
      if ($script:stage -eq 'success') {
        Assert (-not $why -and $script:events[-1] -eq 'verify') $why
        Assert ($script:events.IndexOf('stop-lock') -lt $script:events.IndexOf('reset') -and $script:events.IndexOf('read-guards') -lt $script:events.IndexOf('config') -and $script:events.IndexOf('temp') -lt $script:events.IndexOf('config')) ($script:events -join '|')
      } else {
        Assert ($why.Length -gt 0 -and $script:events -notcontains 'verify') "failure hidden at $script:stage"
        if ($script:stage -in @('stop','guard','acl','download')) { Assert ($script:events -notcontains 'config') "configuration reached after $script:stage failure" }
      }
      Assert (-not @($script:removed | Where-Object { $_ -like 'C:\Thornswood-RunnerPR*' }).Count) 'source data was deleted'
    }
  } finally {
    if ($standIn) { Remove-PSDrive -Name $letter -Scope Global -Force }
    [Environment]::SetEnvironmentVariable('ACTIONS_RUNNER_INPUT_TOKEN',$null,'Process')
    [Environment]::SetEnvironmentVariable('ACTIONS_RUNNER_INPUT_WINDOWSLOGONPASSWORD',$null,'Process')
  }
}
Check 'failed prerequisite subprocess stops before registration' {
  $start=$source.IndexOf('$need = Remote @"')
  $end=$source.IndexOf('$missing = @($need |', $start)
  $probe=$source.Substring($start,$end-$start)
  function Remote { param($text) $global:LASTEXITCODE=24; 'HAVE pwsh' }
  function Say { param($message) }
  function Die { param($message) throw $message }
  $signNeed=''; $why=''
  try { & ([scriptblock]::Create($probe)) } catch { $why=$_.Exception.Message }
  Assert ($why -match 'prerequisite check.*24') 'failed prerequisite output was trusted'
}
Check 'migration requires an explicit canonical destination Root' {
  $file=Join-Path ([IO.Path]::GetTempPath()) ('migrate-root-' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    $out=& $ps -NoProfile -NonInteractive -File $installer -OffBox -Migrate -MaintenanceWindow -DryRunTo $file -NoPause 2>&1 | Out-String
    Assert ($LASTEXITCODE -eq 1 -and $out -match 'Migrate requires an explicit canonical -Root destination') $out
  } finally { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
}
Check 'vswhere native nonzero is rejected even when it prints an MSBuild path' {
  $probe=[regex]::Match($script:generatedMigration, '(?s)# ==== a script it would run ====\r?\n(.*?)# ==== a script it would run, with a secret').Groups[1].Value
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput($probe,[ref]$tokens,[ref]$errors)
  $block=$ast.Find({param($a) $a -is [Management.Automation.Language.IfStatementAst] -and $a.Extent.Text -match '& \$vw -latest'},$true)
  Assert ($null -ne $block) 'vswhere prerequisite block missing'
  function Test-Path { param($Path) $true }
  function vswhere-fixture.exe { $global:LASTEXITCODE=77; 'C:\fixture\MSBuild.exe' }
  $vw='vswhere-fixture.exe'; $why=''
  try { & ([scriptblock]::Create($block.Extent.Text)) } catch { $why=$_.Exception.Message }
  Assert ($why -match 'vswhere.exe.*77') 'vswhere native failure ignored'
}
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
