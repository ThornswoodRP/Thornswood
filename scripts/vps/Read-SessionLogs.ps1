<#
  Read-SessionLogs.ps1

      pwsh scripts/vps/Box-Run.ps1 -Line 'Read-SessionLogs -Profile 1234567890 -Day 2026-11-24'   from any session with gh, a cloud thread included
      pwsh scripts/vps/Box-Run.ps1 -Line 'Read-SessionLogs -Session 0e0cfa8f2b6e4c1d9a7f3e5b1c2d4a6f'
      .\scripts\vps\Read-SessionLogs.ps1 -Folder <session log sets> -Rows <sessions.json> -Session <id> -Out <folder>   anywhere, for the harness

  Brings down the log sets the launcher sent at game close for one session,
  or for every game one profile played on one day. Issue #6230.

  WHY THIS EXISTS. The launcher sends its log and the game's logs to the
  site when the game closes (/api/play/logs), and the site keeps them on the
  box in C:\Thornswood-Docs\data\session-logs, one JSON set a session
  ({ session, who, at, bytes, logs: { name: text } }), with the session's
  row (start, end, version, server, why it ended) in data\sessions.json. A
  report from a playtest is settled by the game's own lines in those logs:
  for #6723, the server's log says two trades went through, and only the
  giver's skyrim-platform.log can say what the game did with the pack after
  each. No gate verb read a set, so a cloud thread had to start a session on
  One to open one.

  WHAT IT DOES. Picks the sets: the one named by -Session, or each set whose
  account or played characters include -Profile and that was sent on -Day
  by the box's clock (Mountain), at most 20. For each it prints the session,
  when the set was sent, its size, the session's row from sessions.json and
  each log's name and line count, and writes every log as a file of its own
  into -Out\<session>\<log name>, where the gate seals it to whoever asked
  (Box-Run.ps1 puts it in its run folder). Nothing is printed from inside a
  log: the logs carry names, chat and paths, and come back only as files.

  Reads only. Opens the folder's files and writes only under -Out; connects
  to nothing. Runs in PowerShell 7 and Windows PowerShell 5.1.
  tests\test-6230-session-logs.ps1 runs it against folders of its own.

  Exits 0 when it wrote at least one set, 1 when the line was not one it
  takes, the folder is not there, or no set matched.
#>
[CmdletBinding()]
param(
    # The site's session log sets.
    [string]$Folder = 'C:\Thornswood-Docs\data\session-logs',
    # The site's session rows.
    [string]$Rows = 'C:\Thornswood-Docs\data\sessions.json',
    # One session, by the id the launcher made for it.
    [string]$Session = '',
    # Or one profile's games ...
    [string]$Profile = '',
    # ... on one day, yyyy-MM-dd, by the box's clock.
    [string]$Day = '',
    # Where the logs are written. The gate sets it to a folder of the run's own.
    [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Most = 20

function Stop([string]$why) {
    Write-Host "STOP. $why"
    exit 1
}

# The site's own rule for a session id (sessionKey in site/lib/sessions.js),
# and the names the site keeps (SLOG_NAMES there). A set is a file from
# outside, so a name that is not one of these is never made into a path.
$KeyRule = '^[A-Za-z0-9-]{8,64}$'
$Names = @('launcher.log', 'crash.log', 'thornswood-front.log', 'thornswood-voice.log',
    'thornswood-emotes.log', 'thornswood-input.log', 'thornswood-loadorder.txt',
    'thornswood-plugins-light.txt', 'skyrim-platform.log')

if (-not $Out) { Stop 'Say where the logs go with -Out. The gate sets it.' }
$byOne = [bool]$Session
if ($byOne) {
    if ($Session -notmatch $KeyRule) { Stop "$Session is not a session id: 8 to 64 letters, digits and hyphens." }
    if ($Profile -or $Day) { Stop 'Name a session, or a profile and a day, not both.' }
} else {
    if ($Profile -notmatch '^[0-9]{1,12}$' -or $Day -notmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') {
        Stop 'Name a session with -Session, or a profile and a day with -Profile <digits> -Day yyyy-MM-dd.'
    }
}
if (-not (Test-Path -LiteralPath $Folder)) { Stop "There is no $Folder, so there are no session logs to read here." }

function When($ms) {
    $n = 0.0
    if ($null -eq $ms -or -not [double]::TryParse([string]$ms, [ref]$n) -or $n -le 0) { return 'not said' }
    return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$n).ToLocalTime().ToString('yyyy-MM-dd h:mm:ss tt')
}
function Field($o, [string]$name) {
    if ($null -eq $o) { return $null }
    $p = $o.PSObject.Properties[$name]
    if ($p) { return $p.Value }
    return $null
}
function ReadSet([string]$path) {
    try { return [IO.File]::ReadAllText($path) | ConvertFrom-Json } catch { return $null }
}

# ---- the rows --------------------------------------------------------------------------
$rowList = @()
if (Test-Path -LiteralPath $Rows) {
    # Into a variable first: Windows PowerShell 5.1 hands a JSON array down
    # the pipeline as one object, so @(... | ConvertFrom-Json) is one row.
    try { $parsed = [IO.File]::ReadAllText($Rows) | ConvertFrom-Json; $rowList = @($parsed) } catch {
        Write-Host "sessions.json would not read ($($_.Exception.Message)); the sets come without their rows."
    }
} else {
    Write-Host "There is no $Rows; the sets come without their rows."
}
function RowOf([string]$key) {
    foreach ($r in $rowList) {
        if ($null -ne $r -and [string](Field $r 'session') -eq $key) { return $r }
    }
    return $null
}

# ---- the sets --------------------------------------------------------------------------
$picked = New-Object System.Collections.Generic.List[object]
$bad = 0
if ($byOne) {
    $file = Join-Path $Folder ($Session + '.json')
    if (-not (Test-Path -LiteralPath $file)) { Stop "No set for session $Session is kept here." }
    $set = ReadSet $file
    if ($null -eq $set -or $null -eq (Field $set 'logs')) { Stop "The set for session $Session would not read." }
    $picked.Add($set)
} else {
    $from = [datetime]::ParseExact($Day, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    $to = $from.AddDays(1)
    # A set's file carries the set's own time (writeSlogSet), so the day is
    # read off the file before it is opened; a resent mark leaves it alone.
    $files = @(Get-ChildItem -LiteralPath $Folder -Filter '*.json' -File |
        Where-Object { $_.LastWriteTime -ge $from -and $_.LastWriteTime -lt $to } | Sort-Object LastWriteTime)
    foreach ($f in $files) {
        $set = ReadSet $f.FullName
        if ($null -eq $set -or $null -eq (Field $set 'logs')) { $bad++; continue }
        $key = [string](Field $set 'session')
        $row = RowOf $key
        $who = @([string](Field $set 'who'))
        if ($row) {
            $who += [string](Field $row 'profile')
            $played = Field $row 'profiles'
            if ($played) { $who += @($played | ForEach-Object { [string]$_ }) }
        }
        if ($who -notcontains $Profile) { continue }
        if ($picked.Count -ge $Most) {
            Write-Host "More than $Most sets match; the first $Most by time are written. Ask by -Session for another."
            break
        }
        $picked.Add($set)
    }
}

if (-not $picked.Count) {
    Write-Host ("No set matched{0}." -f $(if ($bad) { " ($bad set(s) in that day would not read)" } else { '' }))
    exit 1
}

$n = 0
foreach ($set in $picked) {
    $n++
    $key = [string](Field $set 'session')
    if ($key -notmatch $KeyRule) { Write-Host "Set $n has no session id the site would have made; left out."; continue }
    Write-Host ''
    Write-Host ("Set {0}: session {1}, sent {2}, {3} bytes{4}" -f $n, $key, (When (Field $set 'at')), (Field $set 'bytes'),
        $(if (Field $set 'resent') { ", sent again $(Field $set 'resent') time(s) after" } else { '' }))
    $row = RowOf $key
    if ($row) {
        $played = Field $row 'profiles'
        Write-Host ("  row: {0} server, version {1}, started {2}, ended {3}, {4} minute(s), ended by {5}, profile {6}{7}" -f
            (Field $row 'channel'), (Field $row 'version'), (When (Field $row 'start')), (When (Field $row 'end')),
            (Field $row 'minutes'), (Field $row 'why'), (Field $row 'profile'),
            $(if ($played) { ', played ' + (@($played) -join ' ') } else { '' }))
    } else {
        Write-Host '  row: none in sessions.json'
    }
    $dir = Join-Path $Out $key
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $logs = Field $set 'logs'
    foreach ($p in $logs.PSObject.Properties) {
        if ($Names -notcontains $p.Name) { Write-Host "  $($p.Name): not a name the site keeps; left out"; continue }
        $text = [string]$p.Value
        [IO.File]::WriteAllText((Join-Path $dir $p.Name), $text, (New-Object Text.UTF8Encoding($false)))
        Write-Host ("  {0}: {1} line(s)" -f $p.Name, @($text -split "`r?`n").Count)
    }
    if (Field $set 'chat') { Write-Host '  the set also holds the kept chat; it stays on the box (the hub shows it)' }
}

Write-Host ''
Write-Host ("{0} set(s) written under {1}{2}." -f $picked.Count, $Out, $(if ($bad) { "; $bad set(s) that day would not read" } else { '' }))
exit 0
