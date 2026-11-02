<#
  New-RunnerDrive.ps1

  Makes the Windows 11 Dev Drive that One's pull request runners live on, so
  Defender scans what their builds open without holding each file until the
  scan is done (#4048, #3861; Patrick's answer A on the report page, 27 Oct 2026,
  q-3861-defender). On One, in PowerShell run as administrator:

      .\scripts\deploy\New-RunnerDrive.ps1            make it (a drive already made is left as it is)
      .\scripts\deploy\New-RunnerDrive.ps1 -Status    say what is there, change nothing
      .\scripts\deploy\New-RunnerDrive.ps1 -Remove    take it off again, once no runner is on it

  Then Move-RunnersToDrive.ps1 plans and checks each move before doing it.
  It finds the drive by its label, Thornswood Runners. Do not remove a live
  account to move its runner; -Recover is only for accounts already removed.

  WHY. On the box Defender skips each runner's folder (Install-Runner.ps1,
  step 6). Off the box it keeps scanning, because pull request code runs
  there. #3861's first build on thornswood-pr-one-3 (run 40444214705, 26 Oct
  2026) took 7 to 11 times the box's processor time for every harness and
  ran out of its 30 minutes. Patrick's Defender recording at 10:47 PM: 23,229
  real-time scans in 120 s, 117 s of scanning between them, most of them the
  runner's own test files scanned as they opened (pwsh 4,524 scans and
  46.8 s, .ps1 files 26.3 s, .json files 14.6 s). The runner's second build
  (run 40451214399) ran every harness in 591 s, so most of that first cost was
  files Defender had not seen before; every new checkout and every file a
  test writes is such a file.

  A DEV DRIVE. A ReFS volume Windows marks for developer work. A trusted
  drive can use Defender performance mode when that setting is enabled and
  Defender and real-time protection are active. The scan runs after a file
  opens instead of before it. Microsoft says this gives less protection than
  checking before the open, though more than an exclusion. Making or trusting
  a drive does not enable a disabled performance-mode setting. This script
  reports that setting; it does not change it or add an exclusion. Windows 11
  22H2 (build 22621) or later; Windows does not make one smaller than 50 GB.

  WHAT IT DOES, in order:
    1. Checks this is PowerShell run as administrator on a Windows that makes
       Dev Drives.
    2. Makes the disk file -File (a VHDX that grows as it fills, up to
       -SizeGB), attaches it, gives it one partition at -Letter and formats
       it as a Dev Drive labelled Thornswood Runners. The file sits in a
       folder only SYSTEM and Administrators may open, so no runner account
       reads the disk under its own folder's lock.
    3. Trusts it (fsutil devdrv trust), which is what lets Defender use
       performance mode there, and says what Defender and fsutil report.
    4. Locks the drive's root: SYSTEM and Administrators may do anything,
       any signed-in account may only look at the root folder itself and
       nothing below it. Each runner's folder there is its own account's
       (Install-Runner.ps1 locks it), and nothing else is made there.
    5. Registers the task Thornswood Runner Drive, at startup as SYSTEM.
       Windows does not attach a disk file again after a restart, so the
       task attaches it and then starts every runner service whose folder
       is on it; Install-Runner.ps1 sets those to start by hand, so none
       starts before its drive is there. RUNNER-DRIVE START, below.

  -Remove refuses while any runner service still runs from the drive
  (Install-Runner.ps1 -OffBox -Number n -Remove takes each off first). Then
  it takes the task off, detaches the file and deletes it and its folder.

  Changes nothing outside this machine. tests\test-runner-drive.ps1 checks
  the scripts it runs.
#>
[CmdletBinding()]
param(
  [ValidatePattern('^[D-Zd-z]$')]
  [string]$Letter = 'R',
  [ValidateRange(50, 2000)]
  [int]$SizeGB = 100,
  [string]$File = (Join-Path $env:ProgramData 'Thornswood-RunnerDrive\runners.vhdx'),
  [switch]$Status,
  [switch]$Remove,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Label = 'Thornswood Runners'
$Task = 'Thornswood Runner Drive'
$Letter = $Letter.ToUpper()
$Folder = Split-Path -Parent $File
$StartScript = Join-Path $Folder 'start.ps1'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }
function Done() { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit 0 }

# RUNNER-DRIVE START. What the startup task runs, as SYSTEM: attach the file
# when Windows has not, give its partition the letter back when it came up
# without one (Get-Partition gives [char]0 for none, hence the [int]), then
# start each runner service whose folder is on the drive. Written whole
# into the locked folder by step 5; tests\test-runner-drive.ps1 reads it
# from here.
function Get-StartScript([string]$file, [string]$letter) {
  $f = $file.Replace("'", "''")
  return @"
`$ErrorActionPreference = 'Stop'
`$log = Join-Path (Split-Path -Parent '$f') 'start.log'
function Note([string]`$m) { Add-Content -LiteralPath `$log -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + `$m) }
try {
  if (-not (Get-DiskImage -ImagePath '$f').Attached) { Mount-DiskImage -ImagePath '$f' | Out-Null; Note 'attached $f' }
  `$part = @(Get-DiskImage -ImagePath '$f' | Get-Disk | Get-Partition | Where-Object { `$_.Type -eq 'Basic' -or `$_.Type -eq 'IFS' })
  if (-not `$part.Count) { throw 'the disk file has no partition' }
  if ([int]`$part[0].DriveLetter -eq 0) { `$part[0] | Set-Partition -NewDriveLetter '$letter'; Note 'gave it $letter' }
  foreach (`$svc in @(Get-CimInstance Win32_Service -Filter "Name LIKE 'actions.runner.%'")) {
    if (('' + `$svc.PathName).Trim().Trim('"') -like '${letter}:\*' -and `$svc.State -ne 'Running') { Start-Service -Name `$svc.Name; Note ('started ' + `$svc.Name) }
  }
} catch { Note ('FAILED: ' + `$_.Exception.Message); exit 1 }
"@
}

# Step 2's disk file, by diskpart: the only tool in Windows itself that makes
# a VHDX without Hyper-V. The rest goes through the Storage cmdlets.
function Get-DiskpartScript([string]$file, [int]$sizeGB) {
  return ('create vdisk file="' + $file + '" maximum=' + ($sizeGB * 1024) + ' type=expandable')
}

# The runner services on the drive, by the folder their RunnerService.exe is in.
function Get-ServicesOn([string]$letter) {
  @(Get-CimInstance Win32_Service -Filter "Name LIKE 'actions.runner.%'" -EA SilentlyContinue |
    Where-Object { ('' + $_.PathName).Trim().Trim('"') -like ($letter + ':\*') })
}

function Show-Status {
  Head 'The runner drive'
  if (Test-Path -LiteralPath $File) {
    $img = Get-DiskImage -ImagePath $File
    Say ('file      ' + $File + ', ' + [Math]::Round($img.FileSize / 1GB, 1) + ' GB of ' + [Math]::Round($img.Size / 1GB) + ' GB, ' + $(if ($img.Attached) { 'attached' } else { 'NOT ATTACHED' }))
  } else { Say ('file      NOT THERE: ' + $File) 'Yellow' }
  $vol = Get-Volume -FileSystemLabel $Label -EA SilentlyContinue
  if ($vol) { Say ('volume    ' + $vol.DriveLetter + ':, ' + $vol.FileSystem + ', ' + [Math]::Round($vol.SizeRemaining / 1GB) + ' GB free') } else { Say ('volume    no volume labelled ' + $Label) 'Yellow' }
  if ($vol -and $vol.DriveLetter) { & fsutil.exe devdrv query ($vol.DriveLetter + ':') 2>&1 | ForEach-Object { Say ('fsutil    ' + "$_".Trim()) } }
  try { Say ('defender  performance mode status ' + (Get-MpPreference).PerformanceModeStatus + ' (0 is on; on One this read 1 while Windows Security, Dev Drive protection, See volumes said R: scans asynchronously, so that page is the one to trust, #4048)') } catch { Say ('defender  could not be read: ' + $_.Exception.Message) 'Yellow' }
  $t = Get-ScheduledTask -TaskName $Task -EA SilentlyContinue
  if ($t) { Say ('task      ' + $Task + ', ' + $t.State) } else { Say ('task      NO TASK: after a restart nothing attaches the drive') 'Yellow' }
  if ($vol -and $vol.DriveLetter) {
    $on = Get-ServicesOn ([string]$vol.DriveLetter)
    Say ('runners   ' + $on.Count + ' on it' + $(if ($on.Count) { ': ' + (($on | ForEach-Object { $_.Name + ' ' + $_.State + ', starts ' + $_.StartMode }) -join '; ') } else { '' }))
  }
}

$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Die 'A Dev Drive, its startup task and its folder rules need PowerShell run as administrator.' }

if ($Status) { Show-Status; Done }

if ($Remove) {
  Head 'Taking the runner drive off'
  $vol = Get-Volume -FileSystemLabel $Label -EA SilentlyContinue
  if ($vol -and $vol.DriveLetter) {
    $on = Get-ServicesOn ([string]$vol.DriveLetter)
    if ($on.Count) { Die ('runner services still run from ' + $vol.DriveLetter + ': ' + (($on | ForEach-Object { $_.Name }) -join ', ') + '. Install-Runner.ps1 -OffBox -Number <n> -Remove takes each off first.') }
  }
  if (Get-ScheduledTask -TaskName $Task -EA SilentlyContinue) { Unregister-ScheduledTask -TaskName $Task -Confirm:$false; Say ('task ' + $Task + ' taken off') }
  if (Test-Path -LiteralPath $File) {
    if ((Get-DiskImage -ImagePath $File).Attached) { Dismount-DiskImage -ImagePath $File | Out-Null; Say 'detached' }
    Remove-Item -LiteralPath $Folder -Recurse -Force
    Say ('deleted ' + $Folder)
  } else { Say ('no disk file at ' + $File) }
  Done
}

Head 'Making the runner drive'
$build = [Environment]::OSVersion.Version.Build
if ($build -lt 22621) { Die ('Windows build ' + $build + ' makes no Dev Drive; it needs Windows 11 22H2 (build 22621) or later.') }
if (-not (Get-Command Format-Volume).Parameters.ContainsKey('DevDrive')) { Die 'Format-Volume on this Windows has no -DevDrive, so it makes no Dev Drive. Windows Update brings it.' }

# 2. The disk file, in a folder only SYSTEM and Administrators may open.
$null = New-Item -ItemType Directory -Path $Folder -Force
$out = & icacls.exe $Folder /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /C /Q 2>&1
if ($LASTEXITCODE -ne 0) { Die ('icacls could not lock ' + $Folder + ': ' + (($out | ForEach-Object { "$_" }) -join ' ')) }
Say ($Folder + ' is locked: only SYSTEM and Administrators may open it')
if (-not (Test-Path -LiteralPath $File)) {
  $dp = Join-Path $Folder 'make.txt'
  [IO.File]::WriteAllText($dp, (Get-DiskpartScript $File $SizeGB) + "`r`n")
  $out = & diskpart.exe /s $dp 2>&1
  $code = $LASTEXITCODE
  Remove-Item -LiteralPath $dp -Force
  if ($code -ne 0 -or -not (Test-Path -LiteralPath $File)) { Die ('diskpart could not make ' + $File + ': ' + (($out | ForEach-Object { "$_" }) -join ' ')) }
  Say ('made ' + $File + ', growing as it fills up to ' + $SizeGB + ' GB')
}
if (-not (Get-DiskImage -ImagePath $File).Attached) { Mount-DiskImage -ImagePath $File | Out-Null; Say 'attached' }
$disk = Get-DiskImage -ImagePath $File | Get-Disk
if ($disk.PartitionStyle -eq 'RAW') { $disk | Initialize-Disk -PartitionStyle GPT; Say 'set up the disk (GPT)' }
$vol = Get-Volume -FileSystemLabel $Label -EA SilentlyContinue
if (-not $vol) {
  $taken = Get-Volume -DriveLetter $Letter -EA SilentlyContinue
  if ($taken) { Die ($Letter + ': is already a drive here. -Letter <another> picks a free one.') }
  $part = @($disk | Get-Partition | Where-Object { $_.Type -eq 'Basic' -or $_.Type -eq 'IFS' })
  if (-not $part.Count) { $part = @($disk | New-Partition -UseMaximumSize -DriveLetter $Letter) }
  $vol = $part[0] | Format-Volume -DevDrive -NewFileSystemLabel $Label -Confirm:$false -Force
  Say ('formatted ' + $Letter + ': as a Dev Drive labelled ' + $Label)
} else {
  if ([string]$vol.DriveLetter -ne $Letter) { Say ('the drive is already there, at ' + $vol.DriveLetter + ':, and stays there') 'Yellow'; $Letter = [string]$vol.DriveLetter }
  else { Say ('the drive is already there, at ' + $Letter + ':') }
}

# 3. Trusted, so Defender scans it in performance mode.
$out = & fsutil.exe devdrv trust ($Letter + ':') 2>&1
if ($LASTEXITCODE -ne 0) { Die ('fsutil could not trust ' + $Letter + ': ' + (($out | ForEach-Object { "$_" }) -join ' ')) }
Say ('trusted ' + $Letter + ':')

# 4. The root: open to look at, closed below.
$out = & icacls.exe ($Letter + ':\') /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-11:(RX)' /C /Q 2>&1
if ($LASTEXITCODE -ne 0) { Die ('icacls could not lock ' + $Letter + ':\: ' + (($out | ForEach-Object { "$_" }) -join ' ')) }
$null = & icacls.exe ($Letter + ':\') /remove:g '*S-1-5-32-545' '*S-1-1-0' '*S-1-3-0' /C /Q 2>&1
Say ($Letter + ':\ is locked: signed-in accounts may look at the root and nothing below it')

# 5. The startup task.
[IO.File]::WriteAllText($StartScript, (Get-StartScript $File $Letter))
$action = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $StartScript + '"')
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$null = Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
Say ('task ' + $Task + ' attaches the drive and starts its runners at every startup')

Show-Status
Say ''
Say ('Next: Install-Runner.ps1 -OffBox puts a runner on ' + $Letter + ':. Its header, ON THE RUNNER DRIVE, says how to move one there.') 'Green'
Done
