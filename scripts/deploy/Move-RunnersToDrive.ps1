<#
  #4048. Move One's runners to its existing Dev Drive, one verified runner
  at a time. This never makes/formats a disk, deletes an account or source
  folder, changes Defender, restarts either machine, or marks the issue done.

    .\scripts\deploy\Move-RunnersToDrive.ps1 -Plan
    .\scripts\deploy\Move-RunnersToDrive.ps1 -MaintenanceWindow

  -MaintenanceWindow confirms new jobs have been held outside this script.
  A busy read is not an atomic drain. The selected installer also checks and
  stops its runner before changing its password. Other runners are not stopped.

  If the old remove/install procedure has already deleted the accounts:
    .\scripts\deploy\Move-RunnersToDrive.ps1 -Recover -Plan
    .\scripts\deploy\Move-RunnersToDrive.ps1 -Recover -Count 1

  Recovery creates new identities; deleted SIDs cannot be restored. Loaded
  orphan profiles still require an approved restart of THIS PC. It never
  calls the VPS restart script or force-unloads a profile. After one runner
  is verified, a fresh build and Defender recording must prove the result
  before restoring the full set with -Recover (the default count is five).
  A resumed run verifies already-installed runners without replacing them.
  An interrupted, half-configured destination needs inspection, not deletion
  or an automatic retry. The old folder remains locked after a healthy move;
  there is no automatic rollback after password/registration replacement.

  Run changes from elevated PowerShell 7. -Plan does reads only (some Windows
  metadata also needs elevation) and never contacts GitHub. No scanner
  exclusion is added. Turn on Dev Drive protection in Windows Security first
  (Virus & threat protection settings, See volumes should say asynchronous
  scanning is on for the drive); it keeps scans but is not the same as
  synchronous real-time protection. Get-MpPreference's PerformanceModeStatus
  is shown but not trusted: on One it read 1 while that page said on (#4048).
  This command does not change Defender for you.
#>
#requires -Version 7.0
[CmdletBinding()]
param(
  [ValidateRange(1,5)][int]$Count = 5,
  [switch]$Recover,
  [switch]$MaintenanceWindow,
  [switch]$Plan,
  [string[]]$AllowHost = @('pypi.org', 'files.pythonhosted.org')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'RunnerDriveMove.ps1')
$repository = 'ThornswoodRP/Thornswood'
# A runner's Windows service is named for the repository it was registered
# to, actions.runner.<owner>-<name>.<runner>, and keeps that name when the
# repository moves: the runners registered before the move into ThornswoodRP
# (#5184) are still actions.runner.EvilPatrick06-Thornswood.*. Either is this
# repository's runner; a new registration takes the name it has now.
$repositoryNames = @($repository, 'EvilPatrick06/Thornswood')
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$computer = [Environment]::MachineName.ToLower()

function Get-MoveServices {
  foreach ($service in @(Get-CimInstance Win32_Service -Filter "Name LIKE 'actions.runner.%'")) {
    $account = ($service.StartName -split '\\')[-1]
    if ($account -notmatch '^thornswood-pr(?:[2-5])?$') { continue }
    if ($service.StartName -notin @(('.\' + $account), ([Environment]::MachineName + '\' + $account))) {
      throw ('The runner service ' + $service.Name + ' does not use a dedicated local account.')
    }
    $exe = $service.PathName.Trim().Trim('"')
    if ($exe -notmatch '^[A-Za-z]:\\[^"\r\n]+\\bin\\RunnerService\.exe$') {
      throw ('The runner service ' + $service.Name + ' has an unexpected executable path.')
    }
    [pscustomobject]@{
      Name = $service.Name; Account = $account
      Root = $exe.Substring(0, $exe.Length - '\bin\RunnerService.exe'.Length)
      State = $service.State; StartMode = $service.StartMode
    }
  }
}

function Get-MoveRegistrations {
  $text = & gh api --paginate --slurp ('repos/' + $repository + '/actions/runners?per_page=100') 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('GitHub runner inventory failed (exit ' + $LASTEXITCODE + ').') }
  $batches = @(($text | Out-String) | ConvertFrom-Json)
  $all = @($batches | ForEach-Object { $_.runners })
  $totals = @($batches | ForEach-Object { $_.total_count } | Sort-Object -Unique)
  $ids = @($all | ForEach-Object { $_.id } | Sort-Object -Unique)
  if ($totals.Count -ne 1 -or $all.Count -ne $totals[0] -or $ids.Count -ne $all.Count) {
    throw 'GitHub runner inventory changed or contained duplicate IDs; no complete count can be claimed.'
  }
  $all
}

function Get-MoveDriveProof {
  $volumes = @(Get-Volume -FileSystemLabel 'Thornswood Runners' -ErrorAction Stop | Where-Object { $_.DriveLetter })
  if ($volumes.Count -ne 1) { throw 'Exactly one attached Thornswood Runners drive is required.' }
  $query = @(& fsutil.exe devdrv query ([string]$volumes[0].DriveLetter + ':') 2>&1)
  if ($LASTEXITCODE -ne 0) { throw 'Windows could not verify the Dev Drive. An elevated local plan may be needed.' }
  $preference = Get-MpPreference
  $protection = Get-MpComputerStatus
  $task = Get-ScheduledTask -TaskName 'Thornswood Runner Drive' -ErrorAction Stop
  $startup = Join-Path $env:ProgramData 'Thornswood-RunnerDrive\start.ps1'
  $startupReady = ($task.State -ne 'Disabled' -and $task.Settings.Enabled -and
    $task.Principal.UserId -in @('SYSTEM', 'S-1-5-18', 'NT AUTHORITY\SYSTEM') -and
    @($task.Triggers).Count -eq 1 -and $task.Triggers[0].CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' -and
    @($task.Actions).Count -eq 1 -and $task.Actions[0].Execute -eq (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -and
    $task.Actions[0].Arguments -match ('(?:^|\s)-File\s+"?' + [regex]::Escape($startup) + '"?\s*$'))
  foreach ($path in @((Split-Path -Parent $startup), $startup)) {
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { $startupReady = $false }
    foreach ($rule in @((Get-Acl -LiteralPath $path).Access)) {
      if ($rule.AccessControlType -eq 'Allow' -and
          $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18', 'S-1-5-32-544')) {
        $startupReady = $false
      }
    }
  }
  $ready = @{
    Volumes = $volumes; PerformanceMode = $preference.PerformanceModeStatus
    AntivirusEnabled = $protection.AntivirusEnabled; RealTimeProtectionEnabled = $protection.RealTimeProtectionEnabled
    DevDriveQuery = ($query -join "`n"); StartupReady = $startupReady
  }
  $drive = Get-RunnerDriveReadiness @ready
  if ((Get-Item -LiteralPath ($drive + '\') -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The runner drive root must not be a reparse point.'
  }
  [pscustomobject]@{ Drive = $drive; PerformanceMode = $preference.PerformanceModeStatus }
}

try {
  if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'This command runs on One, in Windows PowerShell 7, not on the VPS.' }
  if ($Recover -and $MaintenanceWindow) { throw 'Choose recovery or a healthy migration, not both.' }
  if (-not $Plan) { Assert-MoveAdministrator }
  $driveState = Get-MoveDriveProof
  $drive = $driveState.Drive
  $accounts = @(Get-LocalUser | Where-Object { $_.Name -match '^thornswood-pr(?:[2-5])?$' })
  $services = @(Get-MoveServices)
  $workers = @(Get-CimInstance Win32_Process -Filter "Name='Runner.Worker.exe'")
  $profiles = @(Get-CimInstance Win32_UserProfile)
  $moves = @(Get-RunnerMovePlan -Drive $drive -PerformanceMode $driveState.PerformanceMode -Numbers @(1..$Count) -Accounts $accounts -Services $services -Workers $workers -Profiles $profiles)
  foreach ($move in $moves) {
    $runnerName = 'thornswood-pr-' + $computer + $(if ($move.Number -gt 1) { '-' + $move.Number } else { '' })
    $expectedServices = @($repositoryNames | ForEach-Object { 'actions.runner.' + $_.Replace('/', '-') + '.' + $runnerName })
    if ($move.ServiceName -and $expectedServices -notcontains $move.ServiceName) { throw ($move.Account + ' has an unexpected service identity.') }
    # One already in its target folder keeps the service it has; one the
    # installer registers again gets the name the repository has now.
    if ($move.SourceRoot -eq $move.TargetRoot) { if (-not $move.ServiceName) { $move.ServiceName = $expectedServices[0] }; continue }
    $move.ServiceName = $expectedServices[0]
    if (Test-Path -LiteralPath $move.TargetRoot) { throw ($move.TargetRoot + ' already exists without its verified service. Inspect the partial state; it will not be deleted or reused blindly.') }
    if ($Recover) {
      if ($move.AccountSid -or $move.SourceRoot) { throw ($move.Account + ' still exists without a verified target service. Recovery will not replace a live account; inspect it or use a healthy migration.') }
    } else {
      if (-not $move.AccountSid -or -not $move.SourceRoot) { throw ($move.Account + ' is missing. Use -Recover only for the already-removed accounts, after Windows releases their profiles.') }
      if (-not $Plan -and -not $MaintenanceWindow) { throw 'Hold new jobs, then explicitly confirm -MaintenanceWindow before a healthy migration.' }
    }
  }
  if ($Plan) {
    $moves | Select-Object Number, Account, SourceRoot, TargetRoot | Format-List | Out-Host
    Write-Host 'Read-only plan. No accounts, services, settings or GitHub registrations were changed.'
    return
  }
  # Prove GitHub can be read before installing the first runner. The installer
  # obtains its own short-lived credential; this command never handles it.
  Get-MoveRegistrations | Out-Null
  $buildRecord = Get-Content -LiteralPath (Join-Path $root 'records\build-runners.json') -Raw | ConvertFrom-Json
  if ($buildRecord.label -ne 'thornswood-build') { throw 'The build-runner label changed; review this coordinator before using it.' }
  $prBuildRecord = Get-Content -LiteralPath (Join-Path $root 'records\pr-build-runners.json') -Raw | ConvertFrom-Json
  if ($prBuildRecord.label -ne 'thornswood-pr-build') { throw 'The pull request build label changed; review this coordinator before using it.' }
  $installer = Join-Path $PSScriptRoot 'Install-Runner.ps1'
  $powershell = (Get-Process -Id $PID).Path
  $done = @(Invoke-RunnerMovePlan -Plan $moves -Install {
    param($move)
    $arguments = @('-NoProfile', '-NonInteractive', '-File', $installer, '-OffBox', '-Number', [string]$move.Number, '-Root', $move.TargetRoot, '-NoPause')
    if (-not $Recover) { $arguments += @('-Migrate', '-MaintenanceWindow') }
    if ($AllowHost.Count) { $arguments += @('-AllowHost', ($AllowHost -join ',')) }
    & $powershell @arguments | Out-Host
    return [int]$LASTEXITCODE
  } -Verify {
    param($move)
    $runnerName = 'thornswood-pr-' + $computer + $(if ($move.Number -gt 1) { '-' + $move.Number } else { '' })
    $registered = @(Get-MoveRegistrations | Where-Object { $_.name -eq $runnerName })
    if ($registered.Count -eq 1) {
      $text = & gh api ('repos/' + $repository + '/actions/runners/' + $registered[0].id) 2>&1
      if ($LASTEXITCODE -ne 0) { throw ($runnerName + ' could not be read back from GitHub.') }
      $registered = @(($text | Out-String) | ConvertFrom-Json)
    }
    $proof = @{
      Move = $move; Account = (Get-LocalUser -Name $move.Account)
      Services = @(Get-MoveServices); Listeners = @(Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'")
      Profiles = @(Get-CimInstance Win32_UserProfile); Registrations = $registered; RunnerName = $runnerName
      NeedsBuildLabel = (@($buildRecord.offBox) -contains $runnerName)
      NeedsPrBuildLabel = (@($prBuildRecord.offBox) -contains $runnerName)
    }
    $valid = Confirm-RunnerMove @proof
    Write-Host ($runnerName + ' verified on ' + $move.TargetRoot)
    return $valid
  })
  if ($done.Count -ne $Count) { throw 'The verified count did not match the requested count.' }
  $after = Get-MoveDriveProof
  if ($after.Drive -ne $drive) { throw 'The attached runner drive changed during the operation; completion cannot be verified.' }
  Write-Host ($done.Count.ToString() + ' runner(s) verified. #4048 still needs a fresh first-build gate and a new Defender recording; this is not an issue-completion claim.')
} catch {
  Write-Host ('STOP. ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'No automatic rollback or retry was attempted. Inspect any earlier verified runners before continuing.'
  exit 1
}
