<#
  test-local-places.ps1

      pwsh -NoProfile -File .\tests\test-local-places.ps1

  The backups live in the repository's local\backups and every script that
  writes or reads them asks Where.ps1 Backups for it; no script names
  Downloads\Thornswood-Backups or C:\Thornswood-Release-DevBuild any more.

  WHY. Patrick, 5 October: Thornswood work on One lives only in three folders,
  the repository, the vault and C:\ThornswoodTemps&Worktrees. Two things lived
  outside them. The backups were in Downloads\Thornswood-Backups, named by
  hand in Backup-Server.ps1, Fetch-Backups.ps1, Clean-Everything.ps1 and
  Rotate-BotToken.ps1; they are in local\backups now, the folder the settled
  design names for what a machine keeps and git never sees. One's dev release
  folder was C:\Thornswood-Release-DevBuild; it is local\release-devbuild,
  recorded per machine by Setup-ShipMachine.ps1 -Root as before (#1692), so
  only the help and the docs named the old one.

  A worktree has a local folder of its own that goes when the worktree is
  removed, so the scripts that write backups stop there instead of leaving
  the only copy in it. Fetch-Backups.ps1 -Schedule gives its task the whole
  path, because the copy the task runs has no Where.ps1 beside it.

  HOW. Where.ps1 is asked in this checkout. Then the real scripts are copied
  into two scratch repositories under a temp folder, one whose .git is a
  folder (the repository itself) and one whose .git is a file (a worktree),
  and run there: Fetch-Backups -PruneOnly and -Schedule, Backup-Server and
  Clean-Everything -Backups. ssh and scp are stand-ins on PATH that only note
  they were called, the address given is 127.0.0.1, and the scheduled task
  cmdlets are stand-ins that note what they were given, with LOCALAPPDATA
  pointed into the temp folder, so nothing reaches the VPS, the task
  scheduler or this machine's own data. Nothing outside the temp folder is
  touched.
#>
[CmdletBinding()]
param([string]$Tools)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent $Here
if (-not $Tools) { $Tools = $Here }
$realRepo = $Tools

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Same([string]$a, [string]$b) {
    if (-not $a -or -not $b) { return $false }
    return [IO.Path]::GetFullPath($a).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath($b).TrimEnd('\', '/')
}

# ---- 1. Where.ps1 in this checkout -----------------------------------------
$where = [IO.Path]::Combine($realRepo, 'scripts', 'release', 'Where.ps1')
$said = [string](& $where Backups)
Yes ('Where.ps1 Backups is <repo>\local\backups (' + $said + ')') (Same $said ([IO.Path]::Combine($realRepo, 'local', 'backups')))
Yes 'Where.ps1 Local is <repo>\local' (Same ([string](& $where Local)) ([IO.Path]::Combine($realRepo, 'local')))

$lay = [IO.File]::ReadAllText([IO.Path]::Combine($realRepo, 'layout.json')) | ConvertFrom-Json
Yes 'layout.json declares the place Local as local' ([string]$lay.places.Local -eq 'local')
Yes 'and Backups as backups under Local' ([string]$lay.derived.Backups.from -eq 'Local' -and [string]$lay.derived.Backups.join -eq 'backups')

$gi = [IO.File]::ReadAllText([IO.Path]::Combine($realRepo, '.gitignore'))
Yes '.gitignore still keeps /local/ off GitHub' ($gi -match '(?m)^/local/\s*$')

# ---- 2. no script names the old places ---------------------------------------
# In code, not comments: a comment saying where they were until 5 October is
# history, a string is a path a script would use.
$oldBackups = '(?i)Downloads[\\/]+Thornswood-Backups'
$oldRelease = '(?i)Thornswood-Release-DevBuild'
$named = @()
$scriptsDir = [IO.Path]::Combine($realRepo, 'scripts')
foreach ($f in @(Get-ChildItem -LiteralPath $scriptsDir -File -Recurse)) {
    $ext = $f.Extension.ToLowerInvariant()
    if ($ext -eq '.ps1' -or $ext -eq '.psm1') {
        $tokens = $null; $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
        foreach ($t in $tokens) {
            if ($t.Kind -eq 'Comment') { continue }
            if ($t.Text -match $oldBackups -or $t.Text -match $oldRelease) {
                $named += ('{0}:{1}' -f $f.FullName.Substring($realRepo.Length + 1), $t.Extent.StartLineNumber)
            }
        }
    }
    elseif (@('.py', '.js', '.cmd', '.bat', '.sh', '.json') -contains $ext) {
        $i = 0
        foreach ($line in [IO.File]::ReadAllLines($f.FullName)) {
            $i++
            if ($line -match $oldBackups -or $line -match $oldRelease) { $named += ('{0}:{1}' -f $f.FullName.Substring($realRepo.Length + 1), $i) }
        }
    }
}
Yes ('no script under scripts names Downloads\Thornswood-Backups or C:\Thornswood-Release-DevBuild' + $(if ($named.Count) { ': ' + ($named -join ', ') } else { '' })) ($named.Count -eq 0)

$asks = [regex]"Where\.ps1'\)\s+Backups\b"
foreach ($rel in 'scripts\vps\Backup-Server.ps1', 'scripts\vps\Fetch-Backups.ps1', 'scripts\mods\Clean-Everything.ps1', 'scripts\deploy\Rotate-BotToken.ps1') {
    $text = [IO.File]::ReadAllText((Join-Path $realRepo $rel))
    $byVar = $text -match '\$where\s*=\s*Join-Path \$Here ''\.\.\\release\\Where\.ps1''' -and $text -match '& \$where Backups'
    Yes ((Split-Path -Leaf $rel) + ' asks Where.ps1 Backups') ($asks.IsMatch($text) -or $byVar)
}

# ---- 3. the scripts, run in scratch repositories -------------------------------
$exe = (Get-Process -Id $PID).Path
$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-local-places-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$savedPath = $env:PATH
$savedVpsLocal = $env:THORNSWOOD_VPS_LOCAL
try {
    New-Item -ItemType Directory -Force -Path $T | Out-Null

    # ssh and scp that only say they were called.
    $bin = Join-Path $T 'bin'
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $calls = Join-Path $T 'ssh-calls.txt'
    foreach ($n in 'ssh', 'scp') {
        [IO.File]::WriteAllText((Join-Path $bin ($n + '.cmd')), ("@echo off`r`necho {0} %*>>`"{1}`"`r`nexit /b 255`r`n" -f $n, $calls))
    }
    $env:PATH = $bin + [IO.Path]::PathSeparator + $env:PATH
    # Never the real box, whatever a script falls back to.
    $env:THORNSWOOD_VPS_LOCAL = Join-Path $T 'no-vps.json'

    $copy = @(
        'layout.json',
        'scripts\release\Where.ps1',
        'scripts\vps\Backup-Server.ps1', 'scripts\vps\Protect-BackupZip.ps1', 'scripts\vps\Fetch-Backups.ps1', 'scripts\vps\Restore-Backup.ps1',
        'scripts\vps\Vps.ps1', 'scripts\vps\Send-Script.ps1', 'scripts\vps\vps.json',
        'scripts\mods\Clean-Everything.ps1', 'scripts\mods\OnBox.ps1'
    )
    function New-Scratch([string]$dir, [bool]$worktree) {
        foreach ($rel in $copy) {
            $to = Join-Path $dir $rel
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
            Copy-Item -LiteralPath (Join-Path $realRepo $rel) -Destination $to
        }
        if ($worktree) { [IO.File]::WriteAllText((Join-Path $dir '.git'), 'gitdir: C:/nowhere/.git/worktrees/scratch') }
        else { New-Item -ItemType Directory -Force -Path (Join-Path $dir '.git') | Out-Null }
    }
    function Run([string]$script, [string[]]$argList) {
        # Windows PowerShell 5.1 turns a child's stderr into a stopping error
        # under Stop; the child's words are what is checked, so it carries on.
        $ErrorActionPreference = 'Continue'
        $out = & $exe -NoProfile -ExecutionPolicy Bypass -File $script @argList 2>&1 | Out-String
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
    }
    function SshCalled { return (Test-Path -LiteralPath $calls) }

    $main = Join-Path $T 'Thornswood-Repo'
    $wt = Join-Path $T 'claude-wt'
    New-Scratch $main $false
    New-Scratch $wt $true
    $mainBackups = Join-Path (Join-Path $main 'local') 'backups'
    $wtBackups = Join-Path (Join-Path $wt 'local') 'backups'

    # Fetch-Backups -PruneOnly, no -To: the repository's local\backups.
    $r = Run (Join-Path $main 'scripts\vps\Fetch-Backups.ps1') @('-PruneOnly', '-NoPause')
    Yes ("Fetch-Backups -PruneOnly with no -To works in local\backups (exit $($r.Code))") ($r.Code -eq 0 -and $r.Out.Contains($mainBackups) -and (Test-Path -LiteralPath $mainBackups))
    Yes '  and writes its log there' (Test-Path -LiteralPath (Join-Path $mainBackups 'fetch.log'))

    # The same in a worktree: stopped, nothing made there.
    $r = Run (Join-Path $wt 'scripts\vps\Fetch-Backups.ps1') @('-PruneOnly', '-NoPause')
    Yes ("in a worktree, Fetch-Backups with no -To stops (exit $($r.Code))") ($r.Code -ne 0 -and $r.Out -match 'git worktree' -and $r.Out -match '-To')
    Yes '  and makes no local\backups in it' (-not (Test-Path -LiteralPath $wtBackups))
    $elsewhere = Join-Path $T 'given'
    $r = Run (Join-Path $wt 'scripts\vps\Fetch-Backups.ps1') @('-PruneOnly', '-NoPause', '-To', $elsewhere)
    Yes ("  but with -To it uses that folder (exit $($r.Code))") ($r.Code -eq 0 -and (Test-Path -LiteralPath $elsewhere))

    # -Schedule: the task is given the whole path to local\backups.
    $appdata = Join-Path $T 'appdata'
    New-Item -ItemType Directory -Force -Path $appdata | Out-Null
    $argsFile = Join-Path $T 'task-args.txt'
    $exeFile = Join-Path $T 'task-exe.txt'
    # The task runs pwsh from Program Files, which off Windows no variable
    # names, so the driver names one under the scratch folder, as it does
    # LOCALAPPDATA.
    $programs = Join-Path $T 'programs'
    $driver = Join-Path $T 'schedule.ps1'
    $fetchMain = Join-Path $main 'scripts\vps\Fetch-Backups.ps1'
    $lines = @(
        ('$env:LOCALAPPDATA = ''{0}''' -f $appdata),
        ('$env:ProgramFiles = ''{0}''' -f $programs),
        ('function New-ScheduledTaskAction {{ param($Execute, $Argument, $WorkingDirectory) [IO.File]::WriteAllText(''{0}'', $Argument); [IO.File]::WriteAllText(''{1}'', $Execute); ''action'' }}' -f $argsFile, $exeFile),
        'function New-ScheduledTaskTrigger { ''trigger'' }',
        'function New-ScheduledTaskPrincipal { ''principal'' }',
        'function New-ScheduledTaskSettingsSet { ''settings'' }',
        'function Register-ScheduledTask { ''registered'' }',
        'function Unregister-ScheduledTask { }',
        'function Get-ScheduledTask { ''task'' }',
        'function Get-ScheduledTaskInfo { [pscustomobject]@{ NextRunTime = ''never'' } }',
        ('& ''{0}'' -Schedule -NoPause' -f $fetchMain),
        'exit $LASTEXITCODE'
    )
    [IO.File]::WriteAllText($driver, ($lines -join "`r`n"))
    $r = Run $driver @()
    $taskArgs = ''
    if (Test-Path -LiteralPath $argsFile) { $taskArgs = [IO.File]::ReadAllText($argsFile) }
    Yes ("Fetch-Backups -Schedule registers (stand-in, exit $($r.Code))") ($r.Code -eq 0 -and $taskArgs)
    if (-not $taskArgs) { Write-Host $r.Out }
    Yes ('  and gives the task -To "' + $mainBackups + '"') ($taskArgs.Contains('-To "' + $mainBackups + '"'))
    $taskExe = ''
    if (Test-Path -LiteralPath $exeFile) { $taskExe = [IO.File]::ReadAllText($exeFile) }
    Yes '  and the task runs PowerShell 7 from Program Files' ($taskExe -eq (Join-Path $programs 'PowerShell\7\pwsh.exe'))
    $copied = Join-Path $appdata 'Thornswood\Backups-Fetch\Fetch-Backups.ps1'
    Yes '  and copies the script to its own folder' (Test-Path -LiteralPath $copied)

    # The copy has no Where.ps1 beside it: without -To it stops, with the
    # task's -To it runs.
    $r = Run $copied @('-PruneOnly', '-NoPause')
    Yes ("the task's copy, run with no -To, stops and asks for one (exit $($r.Code))") ($r.Code -ne 0 -and $r.Out -match 'Where\.ps1' -and $r.Out -match '-To')
    $r = Run $copied @('-PruneOnly', '-NoPause', '-To', $mainBackups)
    Yes ("  and with the task's -To it runs (exit $($r.Code))") ($r.Code -eq 0)

    # Backup-Server: in a worktree it stops before any ssh.
    $r = Run (Join-Path $wt 'scripts\vps\Backup-Server.ps1') @('-Vps', '127.0.0.1', '-User', 'nobody', '-NoPause')
    Yes ("in a worktree, Backup-Server with no -Out stops (exit $($r.Code))") ($r.Code -ne 0 -and $r.Out -match 'git worktree' -and $r.Out -match '-Out')
    Yes '  before anything was sent' (-not (SshCalled))
    Yes '  and makes no local\backups in it' (-not (Test-Path -LiteralPath $wtBackups))

    # In the repository it aims at local\backups (the stand-in ssh then fails).
    $r = Run (Join-Path $main 'scripts\vps\Backup-Server.ps1') @('-Vps', '127.0.0.1', '-User', 'nobody', '-NoPause')
    Yes ('Backup-Server with no -Out names a zip in local\backups') ($r.Out -match ('to\s+' + [regex]::Escape($mainBackups) + '[\\/]thornswood-backup-\d{8}-\d{4}\.zip'))

    # Clean-Everything -Backups looks in local\backups, deleting nothing.
    # The plain .zip Backup-Server made before #3582 and the .zip.enc it makes now.
    foreach ($n in 'thornswood-backup-20261001-0100.zip', 'thornswood-backup-20261002-0100.zip', 'thornswood-backup-20261003-0100.zip', 'thornswood-backup-20261027-0100.zip.enc') {
        [IO.File]::WriteAllText((Join-Path $mainBackups $n), 'x')
    }
    $r = Run (Join-Path $main 'scripts\mods\Clean-Everything.ps1') @('-Backups', '-Vps', '127.0.0.1', '-User', 'nobody', '-NoPause')
    Yes ("Clean-Everything -Backups finds the four in local\backups, encrypted or not (exit $($r.Code))") ($r.Out -match '4 backup\(s\), keeping the newest 2' -and $r.Out.Contains('thornswood-backup-20261001-0100.zip') -and $r.Out.Contains('thornswood-backup-20261027-0100.zip.enc'))
    Yes '  and deletes none of them without -Delete' (@(Get-ChildItem -LiteralPath $mainBackups -Filter 'thornswood-backup-*').Count -eq 4)
}
finally {
    $env:PATH = $savedPath
    $env:THORNSWOOD_VPS_LOCAL = $savedVpsLocal
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
