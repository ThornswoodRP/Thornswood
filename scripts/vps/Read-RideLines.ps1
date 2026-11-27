<#
  Read-RideLines.ps1

      pwsh scripts/vps/Box-Run.ps1 -Line 'Read-RideLines -Days 7'                          from any session with gh, a cloud thread included
      pwsh scripts/vps/Remote.ps1 -File scripts/vps/Read-RideLines.ps1 -Arguments '-Days 7'  on the box, from One
      .\scripts\vps\Read-RideLines.ps1 -Folder <session log sets> -Chat <chat log folders>    anywhere, for the harness

  Prints what reached the box when people pressed E on a carriage or ferry
  driver in the games they really played. Issue #4581.

  WHY THIS EXISTS. E on a driver opens no panel, on both carriages and
  ferries, and testers have tried it many times (Patrick, 27 Nov 2026). The
  press goes a long way before a panel is drawn: thornswood-front.js takes
  the person under the crosshair for a driver by his base (isRideDriverRef),
  sends "/ride e <id>" through the chat page to the voice service, the
  gamemode takes it from there and answers with the panel's view, and the
  page opens once no menu is up. The server logs nothing for a press, only a
  ride, so the server's logs cannot say where it stops. Two things on the box
  can:

  - The chat log (C:\Thornswood-Voice\chat and C:\Thornswood-Voice-Dev\chat,
    a file a day) keeps every slash line the voice service took, pressed or
    typed. A "/ride e <id>" there is a press that reached the server. A
    "/merchant e <id>" is a press on a person the front plugin did not take
    for a driver: driverPress comes first, and the trader's press takes any
    person it leaves. Its id beside a driver's says the plugin did not know
    him.
  - The session log sets the launcher sends at game close
    (C:\Thornswood-Docs\data\session-logs), which a cloud thread cannot open
    (#6230). Their thornswood-front.log says whether the plugin found the
    drivers' bases ("carriage and ferry drivers: "), whether a press was
    sent ("asked the server where driver", from #7092), whether the panel's
    page was in ("the ride panel is in"), whether the panel took the
    keyboard ("focus claimed by ride"), and any error in the handlers on the
    way ("keys threw", "ride panel ... threw", "ride distance threw").

  WHAT IT PRINTS. For each chat day in the window, each "/ride" and
  "/merchant e" line: its time in UTC, which server's chat it was in, how it
  came (press or typed) and the line. Then, for each session log set written
  in the window that holds any of the front lines above, its day, the
  launcher version its log names and those lines, at most 200 a set. Then
  the counts. No account, name, profile, session key or address is printed:
  a line's id is a form id, a driver's or a trader's.

  Reads only. Opens the folders' files, writes nothing, connects to nothing.
  Runs in PowerShell 7, on the box and anywhere.
  tests\test-4581-ride-lines.ps1 runs it against folders of its own.

  Exits 0 with what it found, 1 when the session log folder is not there.
#>
[CmdletBinding()]
param(
    # The site's session log sets.
    [string]$Folder = 'C:\Thornswood-Docs\data\session-logs',
    # The voice services' chat logs, Main's and Dev's. Comma separated, as
    # pwsh -File hands a list over as one string.
    [string]$Chat = 'C:\Thornswood-Voice\chat,C:\Thornswood-Voice-Dev\chat',
    # The window, in days, ending now.
    [int]$Days = 7
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# thornswood-front.js's words (rideDriverIdSet, driverPress, the page's
# ride:ready, claimFocus and guard). Every line of that log is
# "[front] <clock> <text>". Change them together.
$FrontLine = '^\[front\] \S+ (?:carriage and ferry drivers: |asked the server where driver |the ride panel is in|focus (?:claimed|released) by ride\b|keys threw:|ride panel (?:waits|opens) threw:|ride distance threw:)'
# The lines the front plugin sends on E (driverPress, merchantPress) and the
# ride panel's own (thornswood-ride.js).
$ChatLine = '^/(?:ride(?: |$)|merchant e )'
$Most = 200

if (-not (Test-Path -LiteralPath $Folder)) {
    Write-Host "STOP. There is no $Folder, so there are no session logs to read here."
    exit 1
}

$since = (Get-Date).AddDays(-$Days)
$sinceMs = [DateTimeOffset]::new($since.ToUniversalTime()).ToUnixTimeMilliseconds()

# ---- the chat logs ---------------------------------------------------------------------
Write-Host 'The chat logs: the E presses the voice service took'
$rides = 0
$traders = 0
foreach ($dir in @($Chat -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    $where = if ($dir -match 'Dev') { 'Dev' } else { 'Main' }
    if (-not (Test-Path -LiteralPath $dir)) {
        Write-Host ('  {0}: no {1} here' -f $where, $dir)
        continue
    }
    $files = @()
    try {
        $files = @(Get-ChildItem -LiteralPath $dir -Filter '*.jsonl' -File | Where-Object { $_.LastWriteTime -ge $since } | Sort-Object Name)
    } catch {
        Write-Host ('  {0}: {1} would not open: {2}' -f $where, $dir, $_.Exception.Message)
        continue
    }
    foreach ($day in $files) {
        $text = $null
        try { $text = [IO.File]::ReadAllText($day.FullName) } catch {
            Write-Host ('  {0}: {1} would not open: {2}' -f $where, $day.Name, $_.Exception.Message)
            continue
        }
        foreach ($row in ($text -split "`r?`n")) {
            if (-not $row) { continue }
            $entry = $null
            try { $entry = $row | ConvertFrom-Json } catch { continue }
            if ($null -eq $entry -or $null -eq $entry.PSObject.Properties['text'] -or $null -eq $entry.PSObject.Properties['kind']) { continue }
            if ([string]$entry.kind -ne 'command') { continue }
            $line = [string]$entry.text
            if ($line -notmatch $ChatLine) { continue }
            $at = 0L
            if ($entry.PSObject.Properties['at']) { try { $at = [long]$entry.at } catch { $at = 0L } }
            if ($at -and $at -lt $sinceMs) { continue }
            $how = if ($entry.PSObject.Properties['via'] -and [string]$entry.via -eq 'press') { 'press' } else { 'typed' }
            $when = if ($at) { [DateTimeOffset]::FromUnixTimeMilliseconds($at).UtcDateTime.ToString('yyyy-MM-dd HH:mm:ss') + ' UTC' } else { 'no time' }
            if ($line -match '^/ride') { $rides++ } else { $traders++ }
            Write-Host ('  {0}  {1,-4}  {2,-5}  {3}' -f $when, $where, $how, $line)
        }
    }
}

# ---- the session log sets --------------------------------------------------------------
Write-Host ''
Write-Host 'The session logs: what the front plugin wrote about drivers'
$read = 0
$bad = 0
$shown = 0
foreach ($f in @(Get-ChildItem -LiteralPath $Folder -Filter '*.json' -File | Where-Object { $_.LastWriteTime -ge $since } | Sort-Object LastWriteTime)) {
    $set = $null
    try { $set = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json } catch { $set = $null }
    if ($null -eq $set -or $null -eq $set.PSObject.Properties['logs'] -or $null -eq $set.logs) { $bad++; continue }
    $read++
    $lines = New-Object System.Collections.Generic.List[string]
    $drivers = $false
    $front = $set.logs.PSObject.Properties['thornswood-front.log']
    if ($front -and $front.Value) {
        foreach ($line in ([string]$front.Value -split "`r?`n")) {
            if ($line -match $FrontLine) {
                $lines.Add($line.Trim())
                # The page coming in and a key handler's error are in every
                # session; a set says something about drivers only with one
                # of the drivers' own lines.
                if ($line -match '\] \S+ (?:carriage and ferry drivers: |asked the server where driver |focus (?:claimed|released) by ride\b|ride )') { $drivers = $true }
            }
        }
    }
    if (-not $drivers) { continue }
    $version = ''
    $launcher = $set.logs.PSObject.Properties['launcher.log']
    if ($launcher -and $launcher.Value) {
        $v = [regex]::Matches([string]$launcher.Value, 'on launcher (\d+\.\d+\.\d+)')
        if ($v.Count) { $version = ' on launcher ' + $v[$v.Count - 1].Groups[1].Value }
    }
    $shown++
    Write-Host ''
    Write-Host ('Session {0}, written {1:yyyy-MM-dd HH:mm}{2}:' -f $shown, $f.LastWriteTime, $version)
    $n = 0
    foreach ($l in $lines) {
        if ($n -ge $Most) { Write-Host ('  ... and {0} more' -f ($lines.Count - $Most)); break }
        Write-Host ('  ' + $l)
        $n++
    }
}

Write-Host ''
Write-Host ("From {0:yyyy-MM-dd}: {1} /ride line(s) and {2} /merchant e line(s) in the chat logs; {3} session log sets read, {4} that would not read, {5} with driver lines." -f $since, $rides, $traders, $read, $bad, $shown)
if (-not $rides -and -not $shown) {
    Write-Host 'No press on a driver reached the box in the window, by either way in.'
}
exit 0
