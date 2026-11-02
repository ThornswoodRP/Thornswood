<#
  #4048: runner moves keep existing account identities, preflight the whole
  move and stop on a failed install or verification. Stand-ins only: no
  account, service, Defender setting, runner or GitHub record is changed.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$library = Join-Path $Repo 'scripts\deploy\RunnerDriveMove.ps1'
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$condition) {
  if ($condition) { $script:pass++; Write-Host "PASS  $what" }
  else { $script:fail++; Write-Host "FAIL  $what" }
}
if (-not (Test-Path -LiteralPath $library)) {
  Yes 'the move preflight exists before any runner can be changed' $false
  exit 1
}
. $library
$caught = ''
try {
  Get-RunnerMovePlan -Drive 'R:' -PerformanceMode 0 -Numbers @(1) -Accounts @() -Services @() -Workers @() -Profiles @(
    [pscustomobject]@{ LocalPath = 'C:\Users\thornswood-pr'; Loaded = $true }
  ) | Out-Null
} catch { $caught = $_.Exception.Message }
Yes 'an orphaned loaded profile stops preflight with a local restart explanation' ($caught -match 'thornswood-pr' -and $caught -match 'restart this PC' -and $caught -notmatch 'Set-TimeWait|VPS')
$plan = @(Get-RunnerMovePlan -Drive 'R:' -PerformanceMode 0 -Numbers @(1) -Accounts @(
  [pscustomobject]@{ Name = 'thornswood-pr'; SID = 'S-1-5-21-100-200-300-1001' }
) -Services @(
  [pscustomobject]@{ Account = 'thornswood-pr'; Root = 'C:\Thornswood-RunnerPR'; Name = 'actions.runner.test.one'; State = 'Running' }
) -Workers @() -Profiles @(
  [pscustomobject]@{ LocalPath = 'C:\Users\thornswood-pr'; Loaded = $true }
))
Yes 'a live account keeps its identity and gets a move plan, even with its normal loaded profile' ($plan.Count -eq 1 -and $plan[0].AccountSid -eq 'S-1-5-21-100-200-300-1001' -and $plan[0].SourceRoot -eq 'C:\Thornswood-RunnerPR' -and $plan[0].TargetRoot -eq 'R:\Thornswood-RunnerPR')
$base = @{
  Drive = 'R:'; PerformanceMode = 0; Numbers = @(1)
  Accounts = @([pscustomobject]@{ Name = 'thornswood-pr'; SID = 'S-1-5-21-100-200-300-1001' })
  Services = @([pscustomobject]@{ Account = 'thornswood-pr'; Root = 'C:\Thornswood-RunnerPR'; Name = 'actions.runner.test.one'; State = 'Running' })
  Profiles = @(); Workers = @()
}
foreach ($case in @(
  @{ Name = 'a drive that is not the runner drive'; Key = 'Drive'; Value = 'C:'; Reason = 'drive' },
  @{ Name = 'a job in the source folder'; Key = 'Workers'; Value = @([pscustomobject]@{ ExecutablePath = 'C:\Thornswood-RunnerPR\bin\Runner.Worker.exe' }); Reason = 'building' },
  @{ Name = 'a service in an unexpected folder'; Key = 'Services'; Value = @([pscustomobject]@{ Account = 'thornswood-pr'; Root = 'C:\Other'; Name = 'actions.runner.test.one'; State = 'Running' }); Reason = 'folder' }
)) {
  $input = $base.Clone(); $input[$case.Key] = $case.Value; $caught = ''
  try { Get-RunnerMovePlan @input | Out-Null } catch { $caught = $_.Exception.Message }
  Yes ($case.Name + ' stops before a move plan is returned') ($caught -match $case.Reason)
}
$input = $base.Clone(); $input.Numbers = @(1,2)
$input.Profiles = @([pscustomobject]@{ LocalPath = 'C:\Users\thornswood-pr2'; Loaded = $true })
$script:emitted = 0; $caught = ''
try { Get-RunnerMovePlan @input | ForEach-Object { $script:emitted++ } } catch { $caught = $_.Exception.Message }
Yes 'a later blocked runner prevents a partial plan for an earlier runner' ($caught -match 'thornswood-pr2' -and $script:emitted -eq 0)
$script:calls = [Collections.Generic.List[string]]::new()
$moves = @(
  [pscustomobject]@{ Number = 1; SourceRoot = ''; TargetRoot = 'R:\Thornswood-RunnerPR' },
  [pscustomobject]@{ Number = 2; SourceRoot = ''; TargetRoot = 'R:\Thornswood-RunnerPR2' }
)
$caught = ''
if (Get-Command Invoke-RunnerMovePlan -ErrorAction SilentlyContinue) {
  try {
    Invoke-RunnerMovePlan -Plan $moves -Install {
      param($move)
      $script:calls.Add('install-' + $move.Number)
      return 31
    } -Verify {
      param($move)
      $script:calls.Add('verify-' + $move.Number)
      return $true
    } | Out-Null
  } catch { $caught = $_.Exception.Message }
}
Yes 'a failed installer stops the cohort without verification or a second install' ($caught -match '31' -and ($script:calls -join ',') -eq 'install-1')
$script:calls.Clear(); $caught = ''
try {
  Invoke-RunnerMovePlan -Plan $moves -Install {
    param($move)
    $script:calls.Add('install-' + $move.Number)
    return 0
  } -Verify {
    param($move)
    $script:calls.Add('verify-' + $move.Number)
    return @($true, $false)
  } | Out-Null
} catch { $caught = $_.Exception.Message }
Yes 'ambiguous verification cannot be treated as success or allow another install' ($caught -match 'verification' -and ($script:calls -join ',') -eq 'install-1,verify-1')
$script:calls.Clear()
$moves[0].SourceRoot = $moves[0].TargetRoot
$done = @(Invoke-RunnerMovePlan -Plan $moves -Install {
  param($move)
  $script:calls.Add('install-' + $move.Number)
  return 0
} -Verify {
  param($move)
  $script:calls.Add('verify-' + $move.Number)
  return $true
})
Yes 'resuming verifies an already-moved runner without reinstalling it' ($done.Count -eq 2 -and ($script:calls -join ',') -eq 'verify-1,install-2,verify-2')
$driveInput = @{
  Volumes = @([pscustomobject]@{ DriveLetter = 'R'; FileSystem = 'ReFS'; FileSystemLabel = 'Thornswood Runners' })
  PerformanceMode = 0; AntivirusEnabled = $true; RealTimeProtectionEnabled = $true; StartupReady = $true
  DevDriveQuery = "This is a trusted developer volume.`nDeveloper volumes are protected by antivirus filter.`nFilters currently attached to this developer volume:`nWdFilter"
}
foreach ($value in @(1, $null)) {
  $input = $driveInput.Clone(); $input.PerformanceMode = $value; $got = ''; $caught = ''
  if (Get-Command Get-RunnerDriveReadiness -ErrorAction SilentlyContinue) { try { $got = Get-RunnerDriveReadiness @input } catch { $caught = $_.Exception.Message } }
  Yes ("readiness does not trust a PowerShell performance-mode value of '" + $value + "' over the drive's own scanning state (#4048)") ($got -eq 'R:' -and -not $caught)
}
$value = 1; $plan1 = @(); try { $plan1 = @(Get-RunnerMovePlan -Drive 'R:' -PerformanceMode 1 -Numbers @(1) -Accounts @() -Services @() -Workers @() -Profiles @()) } catch { }
Yes 'a plan is not blocked by the PowerShell performance-mode value alone' ($plan1.Count -eq 1)
$ready = ''
if (Get-Command Get-RunnerDriveReadiness -ErrorAction SilentlyContinue) { $ready = Get-RunnerDriveReadiness @driveInput }
Yes 'readiness identifies one trusted ReFS drive with active scanning and its startup task' ($ready -eq 'R:')
foreach ($case in @(
  @{ Name = 'two labelled volumes'; Key = 'Volumes'; Value = @($driveInput.Volumes[0], $driveInput.Volumes[0]); Reason = 'one.*drive' },
  @{ Name = 'an NTFS volume'; Key = 'Volumes'; Value = @([pscustomobject]@{ DriveLetter = 'R'; FileSystem = 'NTFS'; FileSystemLabel = 'Thornswood Runners' }); Reason = 'ReFS' },
  @{ Name = 'disabled antivirus'; Key = 'AntivirusEnabled'; Value = $false; Reason = 'Defender' },
  @{ Name = 'disabled real-time protection'; Key = 'RealTimeProtectionEnabled'; Value = $false; Reason = 'Defender' },
  @{ Name = 'an untrusted or unfiltered volume'; Key = 'DevDriveQuery'; Value = 'This is NOT a trusted developer volume.'; Reason = 'trusted|WdFilter' },
  @{ Name = 'a missing or disabled startup task'; Key = 'StartupReady'; Value = $false; Reason = 'startup task' }
)) {
  $input = $driveInput.Clone(); $input[$case.Key] = $case.Value; $caught = ''
  try { Get-RunnerDriveReadiness @input | Out-Null } catch { $caught = $_.Exception.Message }
  Yes ('readiness refuses ' + $case.Name) ($caught -match $case.Reason)
}
$verifyInput = @{
  Move = $plan[0]
  Account = [pscustomobject]@{ Name = 'thornswood-pr'; SID = 'S-1-5-21-100-200-300-1001' }
  Services = @([pscustomobject]@{ Name = 'actions.runner.test.one'; Account = 'thornswood-pr'; Root = 'R:\Thornswood-RunnerPR'; State = 'Running'; StartMode = 'Manual' })
  Listeners = @([pscustomobject]@{ ExecutablePath = 'R:\Thornswood-RunnerPR\bin\Runner.Listener.exe' })
  Profiles = @([pscustomobject]@{ LocalPath = 'C:\Users\thornswood-pr'; SID = 'S-1-5-21-100-200-300-1001' })
  Registrations = @([pscustomobject]@{ name = 'thornswood-pr-one'; status = 'online'; labels = @([pscustomobject]@{ name = 'thornswood-pr' }) })
  RunnerName = 'thornswood-pr-one'; NeedsBuildLabel = $false; NeedsPrBuildLabel = $false
}
$verified = $false
if (Get-Command Confirm-RunnerMove -ErrorAction SilentlyContinue) { $verified = Confirm-RunnerMove @verifyInput }
Yes 'completion checks the selected account, service, listener, profile and online registration' $verified
foreach ($case in @(
  @{ Name = 'a changed account SID'; Key = 'Account'; Value = [pscustomobject]@{ Name = 'thornswood-pr'; SID = 'S-1-5-21-100-200-300-9999' }; Reason = 'SID' },
  @{ Name = 'a missing service'; Key = 'Services'; Value = @(); Reason = 'service' },
  @{ Name = 'a service on C:'; Key = 'Services'; Value = @([pscustomobject]@{ Name = 'actions.runner.test.one'; Account = 'thornswood-pr'; Root = 'C:\Thornswood-RunnerPR'; State = 'Running'; StartMode = 'Manual' }); Reason = 'service' },
  @{ Name = 'a service using another account'; Key = 'Services'; Value = @([pscustomobject]@{ Name = 'actions.runner.test.one'; Account = 'other'; Root = 'R:\Thornswood-RunnerPR'; State = 'Running'; StartMode = 'Manual' }); Reason = 'service' },
  @{ Name = 'an automatically started service'; Key = 'Services'; Value = @([pscustomobject]@{ Name = 'actions.runner.test.one'; Account = 'thornswood-pr'; Root = 'R:\Thornswood-RunnerPR'; State = 'Running'; StartMode = 'Auto' }); Reason = 'service' },
  @{ Name = 'a missing listener'; Key = 'Listeners'; Value = @(); Reason = 'listener' },
  @{ Name = 'a second suffixed profile'; Key = 'Profiles'; Value = @($verifyInput.Profiles[0], [pscustomobject]@{ LocalPath = 'C:\Users\thornswood-pr.ONE'; SID = 'S-1-5-21-100-200-300-1001' }); Reason = 'profile' },
  @{ Name = 'an offline registration'; Key = 'Registrations'; Value = @([pscustomobject]@{ name = 'thornswood-pr-one'; status = 'offline'; labels = @([pscustomobject]@{ name = 'thornswood-pr' }) }); Reason = 'online' },
  @{ Name = 'duplicate registrations'; Key = 'Registrations'; Value = @($verifyInput.Registrations[0], $verifyInput.Registrations[0]); Reason = 'registration' },
  @{ Name = 'a missing required build label'; Key = 'NeedsBuildLabel'; Value = $true; Reason = 'label' },
  @{ Name = 'a missing required pull request build label (#4010)'; Key = 'NeedsPrBuildLabel'; Value = $true; Reason = 'label' },
  @{ Name = 'a pull request build label records\pr-build-runners.json does not give it'; Key = 'Registrations'; Value = @([pscustomobject]@{ name = 'thornswood-pr-one'; status = 'online'; labels = @([pscustomobject]@{ name = 'thornswood-pr' }, [pscustomobject]@{ name = 'thornswood-pr-build' }) }); Reason = 'label' }
)) {
  $input = $verifyInput.Clone(); $input[$case.Key] = $case.Value; $caught = ''
  try { Confirm-RunnerMove @input | Out-Null } catch { $caught = $_.Exception.Message }
  Yes ('completion refuses ' + $case.Name) ($caught -match $case.Reason)
}
if ([Environment]::OSVersion.Platform -eq 'Win32NT') {
  $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $caught = ''
    if (Get-Command Assert-MoveAdministrator -ErrorAction SilentlyContinue) {
      try { Assert-MoveAdministrator } catch { $caught = $_.Exception.Message }
    }
    Yes 'the execution guard rejects the current unelevated host' ($caught -match 'administrator')
  } else { Write-Host 'SKIP  unelevated-host guard (this test host is already elevated)' }
}
$coordinator = Join-Path $Repo 'scripts\deploy\Move-RunnersToDrive.ps1'
$planExit = -1; $planText = ''; $loadedExit = -1; $loadedText = ''; $installerCalled = $false
$executeExit = -1; $executeText = ''; $installedNumbers = ''
$changedExit = -1; $changedText = ''
$nativeFailureExit = -1; $nativeFailureText = ''; $nativeFailureNumbers = ''
if ((Test-Path -LiteralPath $coordinator) -and [Environment]::OSVersion.Platform -eq 'Win32NT') {
  $tempRoot = $(if ($env:TMPDIR) { $env:TMPDIR } else { [IO.Path]::GetTempPath() })
  $fixture = Join-Path $tempRoot ('ts-4048-move-' + [guid]::NewGuid().ToString('N'))
  $deploy = Join-Path $fixture 'scripts\deploy'
  try {
    New-Item -ItemType Directory -Path $deploy, (Join-Path $fixture 'records') -Force | Out-Null
    Copy-Item -LiteralPath $library, $coordinator -Destination $deploy
    # Only the scratch copy replaces the admin guard. All OS/GitHub calls
    # below are stand-ins and the child installer is a scratch marker writer.
    # The original guard was exercised against the real host above.
    [IO.File]::AppendAllText((Join-Path $deploy 'RunnerDriveMove.ps1'), "`nfunction Assert-MoveAdministrator { }`n")
    [IO.File]::WriteAllText((Join-Path $fixture 'records\build-runners.json'), '{"label":"thornswood-build","offBox":[]}')
    [IO.File]::WriteAllText((Join-Path $fixture 'records\pr-build-runners.json'), '{"label":"thornswood-pr-build","offBox":[]}')
    [IO.File]::WriteAllText((Join-Path $deploy 'Install-Runner.ps1'), @'
param([int]$Number, [switch]$OffBox, [string]$Root, [switch]$NoPause, [string]$AllowHost)
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'installer-called'), ($Number.ToString() + "`n"))
if ($env:THORNSWOOD_4048_FIXTURE_FAIL -eq '31') { Write-Host 'service Running'; exit 31 }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'installed'), 'fixture')
exit 0
'@)
    $standins = @'
param([switch]$Loaded, [switch]$Execute, [switch]$DisableAfter, [switch]$ChildFailure)
$env:THORNSWOOD_4048_FIXTURE_FAIL = $(if ($ChildFailure) { '31' } else { '0' })
$global:loadedFixture = [bool]$Loaded
$global:executeFixture = [bool]$Execute
$global:disableAfterFixture = [bool]$DisableAfter
$global:preferenceCallsFixture = 0
$global:installedFixture = Join-Path $PSScriptRoot 'scripts\deploy\installed'
function Get-Volume { [pscustomobject]@{ DriveLetter='R'; FileSystem='ReFS'; FileSystemLabel='Thornswood Runners' } }
function Get-MpPreference {
  $global:preferenceCallsFixture++
  [pscustomobject]@{ PerformanceModeStatus=1 }
}
$global:statusCallsFixture = 0
function Get-MpComputerStatus {
  $global:statusCallsFixture++
  $on = -not ($global:disableAfterFixture -and $global:statusCallsFixture -gt 1)
  [pscustomobject]@{ AntivirusEnabled=$true; RealTimeProtectionEnabled=$on }
}
function Get-ScheduledTask {
  [pscustomobject]@{
    State='Ready'; Settings=[pscustomobject]@{ Enabled=$true }
    Principal=[pscustomobject]@{ UserId='SYSTEM' }
    Actions=@([pscustomobject]@{ Execute=(Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'); Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\ProgramData\Thornswood-RunnerDrive\start.ps1"' })
    Triggers=@([pscustomobject]@{ CimClass=[pscustomobject]@{ CimClassName='MSFT_TaskBootTrigger' } })
  }
}
function Get-LocalUser {
  if ([IO.File]::Exists($global:installedFixture)) { [pscustomobject]@{ Name='thornswood-pr'; SID='S-1-5-21-100-200-300-1001' } }
}
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  if ($ClassName -eq 'Win32_UserProfile' -and $global:loadedFixture) { [pscustomobject]@{ LocalPath='C:\Users\thornswood-pr'; Loaded=$true; SID='S-1-5-21-100-200-300-1001' } }
  if ([IO.File]::Exists($global:installedFixture)) {
    if ($ClassName -eq 'Win32_Service') {
      [pscustomobject]@{ Name=('actions.runner.ThornswoodRP-Thornswood.thornswood-pr-' + [Environment]::MachineName.ToLower()); StartName='.\thornswood-pr'; PathName='"R:\Thornswood-RunnerPR\bin\RunnerService.exe"'; State='Running'; StartMode='Manual' }
    }
    if ($ClassName -eq 'Win32_Process' -and $Filter -match 'Runner.Listener.exe') { [pscustomobject]@{ ExecutablePath='R:\Thornswood-RunnerPR\bin\Runner.Listener.exe' } }
  }
}
function Test-Path { return $false }
function Get-Item { [pscustomobject]@{ Attributes=[IO.FileAttributes]::Directory } }
function Get-Acl {
  [pscustomobject]@{ Access=@(
    [pscustomobject]@{ AccessControlType='Allow'; IdentityReference=[Security.Principal.SecurityIdentifier]::new('S-1-5-18') },
    [pscustomobject]@{ AccessControlType='Allow'; IdentityReference=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544') }
  ) }
}
function fsutil.exe {
  $global:LASTEXITCODE=0
  "This is a trusted developer volume.`nDeveloper volumes are protected by antivirus filter.`nFilters currently attached to this developer volume:`nWdFilter"
}
function gh {
  if (-not $global:executeFixture) { throw 'A read-only local plan must not ask GitHub or obtain a registration token.' }
  $global:LASTEXITCODE=0
  $runner=@{ id=1; name=('thornswood-pr-' + [Environment]::MachineName.ToLower()); status='online'; labels=@(@{name='thornswood-pr'}) }
  if ($args[-1] -match '/actions/runners/1$') { return ($runner | ConvertTo-Json -Depth 5 -Compress) }
  if ($args -notcontains '--slurp') { throw 'Unexpected fixture GitHub request.' }
  $rows=@(); if ([IO.File]::Exists($global:installedFixture)) { $rows=@($runner) }
  ConvertTo-Json -InputObject @(@{total_count=$rows.Count; runners=$rows}) -Depth 5 -Compress
}
$arguments=@{ Recover=$true; Count=$(if ($ChildFailure) { 2 } else { 1 }); Plan=(-not $Execute) }
& (Join-Path $PSScriptRoot 'scripts\deploy\Move-RunnersToDrive.ps1') @arguments
exit $LASTEXITCODE
'@
    $entry = Join-Path $fixture 'fixture.ps1'
    [IO.File]::WriteAllText($entry, $standins)
    $ps = (Get-Process -Id $PID).Path
    $planText = (& $ps -NoProfile -NonInteractive -File $entry 2>&1 | Out-String); $planExit = $LASTEXITCODE
    $loadedText = (& $ps -NoProfile -NonInteractive -File $entry -Loaded 2>&1 | Out-String); $loadedExit = $LASTEXITCODE
    $installerCalled = Test-Path -LiteralPath (Join-Path $deploy 'installer-called')
    $executeText = (& $ps -NoProfile -NonInteractive -File $entry -Execute 2>&1 | Out-String); $executeExit = $LASTEXITCODE
    if (Test-Path -LiteralPath (Join-Path $deploy 'installer-called')) { $installedNumbers = [IO.File]::ReadAllText((Join-Path $deploy 'installer-called')).Trim() }
    Remove-Item -LiteralPath (Join-Path $deploy 'installed'), (Join-Path $deploy 'installer-called') -Force -ErrorAction SilentlyContinue
    $changedText = (& $ps -NoProfile -NonInteractive -File $entry -Execute -DisableAfter 2>&1 | Out-String); $changedExit = $LASTEXITCODE
    Remove-Item -LiteralPath (Join-Path $deploy 'installed'), (Join-Path $deploy 'installer-called') -Force -ErrorAction SilentlyContinue
    $nativeFailureText = (& $ps -NoProfile -NonInteractive -File $entry -Execute -ChildFailure 2>&1 | Out-String); $nativeFailureExit = $LASTEXITCODE
    if (Test-Path -LiteralPath (Join-Path $deploy 'installer-called')) { $nativeFailureNumbers = [IO.File]::ReadAllText((Join-Path $deploy 'installer-called')).Trim() }
    if ($planExit -ne 0) { Write-Host ('Fixture plan exit ' + $planExit + ': ' + $planText) }
    if ($loadedText -notmatch 'restart this PC') { Write-Host ('Fixture loaded-profile exit ' + $loadedExit + ': ' + $loadedText) }
    if ($executeExit -ne 0) { Write-Host ('Fixture execution exit ' + $executeExit + ': ' + $executeText) }
  } finally { if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force } }
}
if ([Environment]::OSVersion.Platform -eq 'Win32NT') {
  Yes 'the real coordinator can plan recovery using stand-ins without installing or asking GitHub' ($planExit -eq 0 -and $planText -match 'R:\\Thornswood-RunnerPR' -and -not $installerCalled)
  Yes 'the real coordinator rejects a loaded orphan before any install or GitHub call' ($loadedExit -ne 0 -and $loadedText -match 'restart this PC' -and $loadedText -notmatch 'Set-TimeWait' -and -not $installerCalled)
  Yes 'the coordinator executes a safe fixture child and reads back the exact registration and local state' ($executeExit -eq 0 -and $installedNumbers -eq '1' -and $executeText -match '1 runner\(s\) verified' -and $executeText -match 'still needs a fresh first-build')
  Yes 'post-install readiness is read again rather than trusting the preflight snapshot' ($changedExit -ne 0 -and $changedText -match 'real-time protection' -and $changedText -notmatch '1 runner\(s\) verified')
  Yes 'a real child exit 31 stops the two-runner fixture despite misleading success text' ($nativeFailureExit -ne 0 -and $nativeFailureNumbers -eq '1' -and $nativeFailureText -match 'exit 31' -and $nativeFailureText -notmatch 'runner\(s\) verified')
} else { Write-Host 'SKIP  Windows coordinator process fixtures (pure checks above still ran)' }
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
