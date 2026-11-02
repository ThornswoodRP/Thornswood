<#
  Read-LauncherStarts.ps1

      pwsh scripts/vps/Box-Run.ps1 -Line 'Read-LauncherStarts -Days 7'                          from any session with gh, a cloud thread included
      pwsh scripts/vps/Remote.ps1 -File scripts/vps/Read-LauncherStarts.ps1                    the last 7 days, on the box, from One
      pwsh scripts/vps/Remote.ps1 -File scripts/vps/Read-LauncherStarts.ps1 -Arguments '-Days 28'
      .\scripts\vps\Read-LauncherStarts.ps1 -Folder <a folder of session log sets>              anywhere, for the harness

  Says how long the launcher took to start on the machines of the people who
  played, per launcher version: how many starts, the middle one, the one
  slower than nine in ten, the slowest, and how much of the middle start the
  mod check took. Issue #3534.

  WHY THIS EXISTS. The weekly review measures the launcher's start time
  (its Performance area), and the 25 Oct 2026 review could not: "the
  launcher is never started" by a Claude, and nothing else measured it.
  Since #3534 the launcher writes one line to Profile\launcher.log once its
  window has drawn (Shell.cs, LogStartTime):

      2026-10-27 19:04:11  Launcher start: the window was on screen 2.4 s after the launcher started, 0.8 s of it the mod check, on launcher 1.2.6.

  The launcher already sends the last 256 KB of launcher.log to the site when
  a session ends (the privacy page, "The launcher's own log"), and the site
  keeps each set in C:\Thornswood-Docs\data\session-logs\<session>.json. So
  the starts testers really had are on the box, from their own machines,
  which is the number that matters, and this reads them there.

  HOW IT COUNTS. Every set written in the window is read, and every start line
  in its launcher.log whose own time is in the window. One launcher.log runs
  across several sessions, so the same line comes in more than one set; a
  line is counted once per account and time. Sets that will not read are
  counted and skipped. No account, name or address is printed: only counts
  and seconds.

  Reads only. Opens the folder's files, writes nothing, connects to nothing.
  Runs in PowerShell 7, on the box and anywhere.
  WHO CAN RUN IT. A cloud thread, the weekly review's included, holds no key
  to the box (#2841), so it asks the deploy gate: Read-LauncherStarts is one
  of the gate's verbs (scripts\vps\gate\verbs.json), run from main on the
  box with -Days alone, and Box-Run.ps1 seals what it prints to the asker,
  so the run's log carries none of it. It only reads.

  tests\test-3534-launcher-starts.ps1 runs it against sets of its own.

  Exits 0 with the table (or "no starts in the window" and how many sets were
  read), 1 when the folder is not there.
#>
[CmdletBinding()]
param(
    # The site's session log sets.
    [string]$Folder = 'C:\Thornswood-Docs\data\session-logs',
    # The window, in days, ending now.
    [int]$Days = 7
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# The launcher's words, Shell.cs LogStartTime. Change both together.
$StartLine = '^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)  Launcher start: the window was on screen (\d+(?:\.\d+)?) s after the launcher started(?:, (\d+(?:\.\d+)?) s of it the mod check)?, on launcher ([^\s,]+?)\.\s*$'

# The value at a share of a sorted list, nearest rank.
function Get-Rank([double[]]$sorted, [double]$share) {
    if (-not $sorted.Count) { return $null }
    $i = [int][Math]::Ceiling($share * $sorted.Count) - 1
    if ($i -lt 0) { $i = 0 }
    if ($i -ge $sorted.Count) { $i = $sorted.Count - 1 }
    return $sorted[$i]
}

if (-not (Test-Path -LiteralPath $Folder)) {
    Write-Host "STOP. There is no $Folder, so there are no session logs to read here."
    exit 1
}

$inv = [Globalization.CultureInfo]::InvariantCulture
$until = Get-Date
$since = $until.AddDays(-$Days)
$seen = @{}
$starts = New-Object System.Collections.Generic.List[object]
$read = 0
$bad = 0
foreach ($f in @(Get-ChildItem -LiteralPath $Folder -Filter '*.json' -File | Where-Object { $_.LastWriteTime -ge $since })) {
    $set = $null
    try { $set = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json } catch { $set = $null }
    if ($null -eq $set -or $null -eq $set.PSObject.Properties['logs'] -or $null -eq $set.logs) { $bad++; continue }
    $read++
    $p = $set.logs.PSObject.Properties['launcher.log']
    if (-not $p -or -not $p.Value) { continue }
    $who = ''
    if ($set.PSObject.Properties['who']) { $who = [string]$set.who }
    foreach ($line in ([string]$p.Value -split "`r?`n")) {
        $m = [regex]::Match($line, $StartLine)
        if (-not $m.Success) { continue }
        $at = [DateTime]::ParseExact($m.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $inv)
        # The launcher writes its own local time; the box's window is wide
        # enough that a few hours either way only moves a start at its edge.
        if ($at -lt $since -or $at -gt $until.AddDays(1)) { continue }
        $key = $who + '|' + $m.Groups[1].Value
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $scan = $null
        if ($m.Groups[3].Success) { $scan = [double]::Parse($m.Groups[3].Value, $inv) }
        $starts.Add([pscustomobject]@{ Version = $m.Groups[4].Value; Window = [double]::Parse($m.Groups[2].Value, $inv); Scan = $scan })
    }
}

Write-Host ("Launcher starts from {0:yyyy-MM-dd} to {1:yyyy-MM-dd}: {2} session log sets read, {3} that would not read." -f $since, $until, $read, $bad)
if (-not $starts.Count) {
    Write-Host 'No starts in the window. Either nobody played, or nobody had a launcher that writes the start line yet (#3534).'
    exit 0
}
Write-Host ''
Write-Host 'launcher    starts   middle   9 in 10   slowest   mod check (middle)'
foreach ($g in @($starts | Group-Object Version | Sort-Object Name)) {
    $w = [double[]]@($g.Group | ForEach-Object { $_.Window } | Sort-Object)
    $s = [double[]]@($g.Group | Where-Object { $null -ne $_.Scan } | ForEach-Object { $_.Scan } | Sort-Object)
    $scan = if ($s.Count) { (Get-Rank $s 0.5).ToString('F1', $inv) + ' s' } else { 'not written' }
    Write-Host ('{0,-10}  {1,6}   {2,5} s   {3,6} s   {4,6} s   {5}' -f $g.Name, $g.Count,
        (Get-Rank $w 0.5).ToString('F1', $inv), (Get-Rank $w 0.9).ToString('F1', $inv), $w[$w.Count - 1].ToString('F1', $inv), $scan)
}
exit 0
