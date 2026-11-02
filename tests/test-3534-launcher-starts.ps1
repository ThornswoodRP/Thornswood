<#
  test-3534-launcher-starts.ps1

      pwsh -NoProfile -File .\tests\test-3534-launcher-starts.ps1

  WHY THIS EXISTS. Issue #3534. The weekly review could not measure the
  launcher's start time, because nothing did. Now the launcher writes one
  line once its window has drawn (Shell.cs, LogStartTime), the site keeps it
  with each session's launcher.log, and scripts\vps\Read-LauncherStarts.ps1
  totals a week of them on the box.

  What it checks:
    1. the launcher writes the line in the words the reader reads, after the
       window has drawn, timed from the process's own start, with the mod
       check's time taken around RunScan, and through LogOnly, which puts
       nothing on the status line;
    2. the reader, run against session log sets made here: it counts each
       start once although the same launcher.log comes in several sets, keeps
       two accounts' starts at the same second apart, leaves out a start
       before the window and a set written before it, counts a set that will
       not read and goes on, says the middle, the one slower than nine in ten
       and the slowest per launcher version, says "not written" for a mod
       check an older line lacks, prints no account, and says so when there
       are no starts;

  Nothing connects anywhere. Everything it writes is in its own temp folder.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$reader = Join-Path $repo 'scripts/vps/Read-LauncherStarts.ps1'
$shell = Join-Path $repo 'launcher/app/Shell.cs'

# ---- 1. the launcher's line -------------------------------------------------------
Write-Host 'the launcher'
$cs = [IO.File]::ReadAllText($shell) -replace "`r`n", "`n"
$fn = [regex]::Match($cs, '(?ms)static void LogStartTime\(\)\n\s+\{\n(.*?)\n        \}\n').Groups[1].Value
Yes 'Shell.cs has LogStartTime' ($fn.Length -gt 0)
Yes '  timed from the process''s own start' ($fn.Contains('Process.GetCurrentProcess()') -and $fn.Contains('.StartTime'))
Yes '  in the reader''s words, through LogOnly' ($fn -match 'LogOnly\("Launcher start: the window was on screen " \+' -and $fn.Contains('" s after the launcher started"') -and
    $fn.Contains('" s of it the mod check"') -and $fn.Contains('", on launcher " + Updater.Version + "."') -and $fn.Contains('InvariantCulture'))
Yes 'it is written once the window has drawn' ($cs -match '(?ms)win\.ContentRendered \+= delegate\n\s+\{\n\s+try \{ LogStartTime\(\); \}')
Yes 'the mod check is timed around RunScan' ($cs -match '(?ms)var scanClock = Stopwatch\.StartNew\(\);\n\s+try \{ RunScan\(\); \}\n[^\n]*\n\s+startScanSeconds = scanClock\.Elapsed\.TotalSeconds;')
$readerText = [IO.File]::ReadAllText($reader)
Yes 'the reader names where the line comes from' ($readerText.Contains('Shell.cs LogStartTime'))

# ---- 2. the reader ---------------------------------------------------------------------
Write-Host ''; Write-Host ('the reader, in ' + $PSVersionTable.PSEdition + ' ' + $PSVersionTable.PSVersion)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-3534-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $now = Get-Date
    $stamp = { param([int]$hoursAgo) $now.AddHours(-$hoursAgo).ToString('yyyy-MM-dd HH:mm:ss') }
    $l1 = (& $stamp 30) + '  Launcher start: the window was on screen 2.0 s after the launcher started, 0.5 s of it the mod check, on launcher 1.2.6.'
    $l2 = (& $stamp 20) + '  Launcher start: the window was on screen 4.0 s after the launcher started, 1.5 s of it the mod check, on launcher 1.2.6.'
    $l3 = (& $stamp 10) + '  Launcher start: the window was on screen 10.0 s after the launcher started, 6.0 s of it the mod check, on launcher 1.2.6.'
    $old = (& $stamp 400) + '  Launcher start: the window was on screen 99.0 s after the launcher started, on launcher 1.2.5.'
    $noScan = (& $stamp 5) + '  Launcher start: the window was on screen 3.0 s after the launcher started, on launcher 1.2.7.'
    function Put([string]$name, [string]$who, [string[]]$lines, [int]$writtenHoursAgo) {
        $set = [ordered]@{ session = $name; who = $who; at = 0; logs = [ordered]@{ 'launcher.log' = (($lines + @('2026-10-01 00:00:00  Ready.')) -join "`r`n"); 'crash.log' = 'x' } }
        $f = Join-Path $tmp ($name + '.json')
        [IO.File]::WriteAllText($f, ($set | ConvertTo-Json -Depth 5))
        (Get-Item -LiteralPath $f).LastWriteTime = $now.AddHours(-$writtenHoursAgo)
    }
    # One account's launcher.log as it grows across three sessions.
    Put 'a1' '111111111111111111' @($old, $l1) 25
    Put 'a2' '111111111111111111' @($old, $l1, $l2) 15
    Put 'a3' '111111111111111111' @($old, $l1, $l2, $l3) 5
    # Another account, starting at the very second of one of those.
    Put 'b1' '222222222222222222' @($l1) 25
    # An older launcher with no mod check in its line, and a set from before the window.
    Put 'c1' '333333333333333333' @($noScan) 4
    Put 'old' '444444444444444444' @(((& $stamp 300) + '  Launcher start: the window was on screen 50.0 s after the launcher started, on launcher 1.2.4.')) 300
    [IO.File]::WriteAllText((Join-Path $tmp 'broken.json'), '{ not json')

    $out = @(& $reader -Folder $tmp -Days 7 6>&1 2>&1 | ForEach-Object { "$_" })
    $rc = $LASTEXITCODE
    $text = $out -join "`n"
    Yes ("it ends 0 ($rc)") ($rc -eq 0)
    Yes 'it reads the five sets in the window and counts the one that will not read' ($text -match '5 session log sets read, 1 that would not read')
    $row = @($out | Where-Object { $_ -match '^1\.2\.6\s' })
    Yes ("1.2.6: four starts, each counted once, the second account's at the same second too ($($row -join ''))") ($row.Count -eq 1 -and $row[0] -match '^1\.2\.6\s+4\s')
    Yes '  the middle 2.0 s, nine in ten 10.0 s, the slowest 10.0 s, the mod check''s middle 0.5 s' ($row.Count -eq 1 -and $row[0] -match '\s2\.0 s\s+10\.0 s\s+10\.0 s\s+0\.5 s$')
    $row7 = @($out | Where-Object { $_ -match '^1\.2\.7\s' })
    Yes 'an older line with no mod check: counted, and "not written"' ($row7.Count -eq 1 -and $row7[0] -match '^1\.2\.7\s+1\s.*not written$')
    Yes 'a start before the window and a set written before it are left out' ($text -notmatch '1\.2\.5' -and $text -notmatch '1\.2\.4')
    Yes 'no account is printed' ($text -notmatch '1111111' -and $text -notmatch '2222222')

    $empty = Join-Path $tmp 'empty'
    New-Item -ItemType Directory -Path $empty | Out-Null
    $out = @(& $reader -Folder $empty 6>&1 2>&1 | ForEach-Object { "$_" })
    Yes 'no starts: ends 0 and says so' ($LASTEXITCODE -eq 0 -and ($out -join ' ') -match 'No starts in the window')
    $out = @(& $reader -Folder (Join-Path $tmp 'not-there') 6>&1 2>&1 | ForEach-Object { "$_" })
    Yes 'no folder: ends 1 and says so' ($LASTEXITCODE -eq 1 -and ($out -join ' ') -match 'STOP\. There is no')
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Done
