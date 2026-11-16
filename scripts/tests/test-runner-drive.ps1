<#
  test-runner-drive.ps1

      pwsh -NoProfile -File .\scripts\tests\test-runner-drive.ps1

  scripts\deploy\New-RunnerDrive.ps1 makes the Dev Drive One's pull request
  runners live on (#3861, Patrick's A on 27 Oct 2026), so Defender scans
  their files in performance mode instead of holding each one until it is
  scanned, and instead of not scanning them at all.

  It makes a disk, trusts it, locks it and registers a startup task, which
  needs an administrator and changes the machine, so this runs none of that.
  It reads the script and lifts out the texts it runs:
    - the diskpart line makes a VHDX that grows as it fills, sized in MB;
    - the startup task's script attaches the file only when Windows has not,
      gives the partition its letter back only when it came up without one,
      starts only the runner services whose folder is on that drive, and
      writes what it did, or why it failed, to a log beside the file;
    - the file's folder is locked to SYSTEM and Administrators, and the
      drive's root lets signed-in accounts look at it and nothing below;
    - it stops before anything when it is not run as administrator, and
      -Remove stops while a runner service still runs from the drive.
  Reads only; nothing leaves this machine.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'New-RunnerDrive.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$null, [ref]$errs)
Yes 'New-RunnerDrive.ps1 parses' (-not @($errs).Count)
$src = [IO.File]::ReadAllText($script)
foreach ($name in 'Get-StartScript', 'Get-DiskpartScript') {
    $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
    Yes "it has $name" ($null -ne $fn)
    if ($fn) { . ([scriptblock]::Create($fn.Extent.Text)) }
}

$dp = Get-DiskpartScript 'C:\ProgramData\Thornswood-RunnerDrive\runners.vhdx' 100
Yes 'the disk file grows as it fills, up to the size in MB' ($dp -eq 'create vdisk file="C:\ProgramData\Thornswood-RunnerDrive\runners.vhdx" maximum=102400 type=expandable')

$st = Get-StartScript 'C:\ProgramData\Thornswood-RunnerDrive\runners.vhdx' 'R'
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($st, [ref]$null, [ref]$errs)
Yes 'the startup script parses' (-not @($errs).Count)
Yes '  it attaches the file only when Windows has not' ($st -match [regex]::Escape("if (-not (Get-DiskImage -ImagePath 'C:\ProgramData\Thornswood-RunnerDrive\runners.vhdx').Attached) { Mount-DiskImage"))
Yes '  gives the partition its letter back only when it has none' ($st -match [regex]::Escape("if ([int]`$part[0].DriveLetter -eq 0) { `$part[0] | Set-Partition -NewDriveLetter 'R'"))
Yes '  starts only the runner services whose folder is on R:' ($st -match [regex]::Escape("Name LIKE 'actions.runner.%'") -and $st -match [regex]::Escape("-like 'R:\*'") -and $st -match 'Start-Service')
Yes '  and writes what it did, or why it failed, beside the file, ending 1 on a failure' ($st -match [regex]::Escape("Join-Path (Split-Path -Parent 'C:\ProgramData\Thornswood-RunnerDrive\runners.vhdx') 'start.log'") -and $st -match [regex]::Escape("Note ('FAILED: ' + `$_.Exception.Message); exit 1"))
$q = Get-StartScript "C:\it's\runners.vhdx" 'R'
[void][System.Management.Automation.Language.Parser]::ParseInput($q, [ref]$null, [ref]$errs)
Yes '  a quote in the path is doubled, so the script still parses' (-not @($errs).Count -and $q -match [regex]::Escape("'C:\it''s\runners.vhdx'"))

Yes 'the file''s folder is locked to SYSTEM and Administrators' ($src -match [regex]::Escape("icacls.exe `$Folder /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'"))
Yes 'the drive''s root: signed-in accounts may look at it, nothing below' ($src -match [regex]::Escape("'*S-1-5-11:(RX)'") -and $src -match [regex]::Escape("/remove:g '*S-1-5-32-545' '*S-1-1-0' '*S-1-3-0'"))
Yes 'it is trusted, which is what lets Defender use performance mode there' ($src -match [regex]::Escape("fsutil.exe devdrv trust (`$Letter + ':')"))
Yes 'it is formatted as a Dev Drive, labelled as Install-Runner.ps1 finds it' ($src -match 'Format-Volume -DevDrive' -and $src -match [regex]::Escape("`$Label = 'Thornswood Runners'") -and ([IO.File]::ReadAllText([IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Install-Runner.ps1'))).Contains("Get-Volume -FileSystemLabel 'Thornswood Runners'"))
Yes 'the task runs at startup as SYSTEM' ($src -match 'New-ScheduledTaskTrigger -AtStartup' -and $src -match [regex]::Escape("New-ScheduledTaskPrincipal -UserId 'SYSTEM'"))
$iAdmin = $src.IndexOf('IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'); $iFirst = $src.IndexOf('if ($Status)')
Yes 'it stops before anything when not run as administrator' ($iAdmin -gt 0 -and $iAdmin -lt $iFirst)
Yes '-Remove stops while a runner service still runs from the drive' ($src -match [regex]::Escape('runner services still run from'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
