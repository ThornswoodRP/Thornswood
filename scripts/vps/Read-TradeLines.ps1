<#
  Read-TradeLines.ps1

      pwsh scripts/vps/Box-Run.ps1 -Line 'Read-TradeLines -Days 7'                          from any session with gh, a cloud thread included
      pwsh scripts/vps/Remote.ps1 -File scripts/vps/Read-TradeLines.ps1 -Arguments '-Days 7'  on the box, from One
      .\scripts\vps\Read-TradeLines.ps1 -Folder <session log sets> -Server <server folders>    anywhere, for the harness

  Prints what the servers and the games wrote about trades and about the
  pack being put right, in the games people really played. Issue #6723.

  WHY THIS EXISTS. On Main Playtest #6 a tester got duplicated gear in a
  trade, another got duplicated ebony armour, and the rest of a potion stack
  went when half of it was given away. The server cannot have made either on
  its own record: trade.ts checks both packs at the swap, writes each once,
  and says "HALF A TRADE" in the server log when only one write went through
  (#4520). So the difference is most likely between the server's pack and
  what the game shows, which the client puts right every 5 seconds
  (skymp5-client sync/inventory.ts and remoteServer.ts). Which of those went
  wrong is written in two places on the box, and a cloud thread can open
  neither (#6230):

  - The servers' logs (C:\Thornswood-Server and C:\Thornswood-Server-Dev,
    server.log and the server.log.<when> copies Server-Log.js keeps for 30
    days). trade.ts writes "[thornswood trade] A and B traded: <what A gave>
    for <what B gave>" for every trade that went through, and "HALF A TRADE:"
    for one that went half through.
  - The session log sets the launcher sends at game close
    (C:\Thornswood-Docs\data\session-logs). Their skyrim-platform.log holds
    the client's lines: "removeInventoryItems(...)" with the lists it read
    and what it took from each, "[thornswood] inventory: the game holds N
    fewer than the difference takes away", "the game refused to take away",
    "this difference was applied five seconds ago and is still there", "Owner
    inventory or outfit did not finish loading" (which stops the 5 second
    apply for the whole session, #6717), and "Refused inventory with an
    invalid item count".

  WHAT IT PRINTS. For each server log in the window, each trade line: its
  time in UTC, which server, and what each side gave, with the two names
  left out. Then, for each session log set written in the window that holds
  any of the client's lines above, its day, the launcher version its log
  names and those lines in the order the log has them, at most 200 a set.
  Then the counts. No account, name, profile, session key or address is
  printed: a client line holds form ids, counts and item names.

  Reads only. Opens the folders' files, writes nothing, connects to nothing.
  Runs in PowerShell 7, on the box and anywhere.
  tests\test-6723-trade-lines.ps1 runs it against folders of its own.

  Exits 0 with what it found, 1 when the session log folder is not there.
#>
[CmdletBinding()]
param(
    # The site's session log sets.
    [string]$Folder = 'C:\Thornswood-Docs\data\session-logs',
    # The game servers' folders, Main's and Dev's. Comma separated, as
    # pwsh -File hands a list over as one string.
    [string]$Server = 'C:\Thornswood-Server,C:\Thornswood-Server-Dev',
    # The window, in days, ending now.
    [int]$Days = 7
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# trade.ts's tlog words, after Server-Log.js's "[<UTC>Z] " stamp. Change them
# together.
$TradeLine = '\[thornswood trade\] (?:.+? traded: (?<what>.+)|HALF A TRADE: .+? was not, trading (?<half>.+))$'
$StampLine = '^\[(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d{3}Z\]'
# skymp5-client's words (sync/inventory.ts and remoteServer.ts).
$ClientLine = '(?:removeInventoryItems\(|\[thornswood\] inventory: |Owner inventory or outfit did not finish loading|Refused inventory with an invalid item count)'
$Most = 200

if (-not (Test-Path -LiteralPath $Folder)) {
    Write-Host "STOP. There is no $Folder, so there are no session logs to read here."
    exit 1
}

$since = (Get-Date).AddDays(-$Days)
$sinceUtc = $since.ToUniversalTime()

# ---- the server logs -------------------------------------------------------------------
Write-Host 'The server logs: every trade the servers wrote'
$trades = 0
$halves = 0
foreach ($dir in @($Server -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    $where = if ($dir -match 'Dev') { 'Dev' } else { 'Main' }
    if (-not (Test-Path -LiteralPath $dir)) {
        Write-Host ('  {0}: no {1} here' -f $where, $dir)
        continue
    }
    $files = @()
    try {
        $files = @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -match '^server\.log(?:\.\d+)?$' -and $_.LastWriteTime -ge $since } | Sort-Object LastWriteTime)
    } catch {
        Write-Host ('  {0}: {1} would not open: {2}' -f $where, $dir, $_.Exception.Message)
        continue
    }
    foreach ($log in $files) {
        $hits = @()
        try {
            $hits = @(Select-String -LiteralPath $log.FullName -SimpleMatch -Pattern '[thornswood trade]')
        } catch {
            Write-Host ('  {0}: {1} would not open: {2}' -f $where, $log.Name, $_.Exception.Message)
            continue
        }
        foreach ($hit in $hits) {
            $line = $hit.Line
            $m = [regex]::Match($line, $TradeLine)
            if (-not $m.Success) { continue }
            $when = 'no time'
            $s = [regex]::Match($line, $StampLine)
            if ($s.Success) {
                $at = [datetime]::ParseExact($s.Groups[1].Value, 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
                if ($at -lt $sinceUtc) { continue }
                $when = $at.ToString('yyyy-MM-dd HH:mm:ss') + ' UTC'
            }
            if ($m.Groups['half'].Success) {
                $halves++
                Write-Host ('  {0}  {1,-4}  HALF A TRADE, only one pack was written: {2}' -f $when, $where, $m.Groups['half'].Value)
            } else {
                $trades++
                Write-Host ('  {0}  {1,-4}  traded: {2}' -f $when, $where, $m.Groups['what'].Value)
            }
        }
    }
}

# ---- the session log sets --------------------------------------------------------------
Write-Host ''
Write-Host 'The session logs: what the game did to put the pack right'
$read = 0
$bad = 0
$shown = 0
foreach ($f in @(Get-ChildItem -LiteralPath $Folder -Filter '*.json' -File | Where-Object { $_.LastWriteTime -ge $since } | Sort-Object LastWriteTime)) {
    $set = $null
    try { $set = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json } catch { $set = $null }
    if ($null -eq $set -or $null -eq $set.PSObject.Properties['logs'] -or $null -eq $set.logs) { $bad++; continue }
    $read++
    $lines = New-Object System.Collections.Generic.List[string]
    $platform = $set.logs.PSObject.Properties['skyrim-platform.log']
    if ($platform -and $platform.Value) {
        foreach ($line in ([string]$platform.Value -split "`r?`n")) {
            if ($line -match $ClientLine) { $lines.Add($line.Trim()) }
        }
    }
    if (-not $lines.Count) { continue }
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
Write-Host ("From {0:yyyy-MM-dd}: {1} trade(s) and {2} half trade(s) in the server logs; {3} session log sets read, {4} that would not read, {5} with pack lines." -f $since, $trades, $halves, $read, $bad, $shown)
if (-not $trades -and -not $halves) {
    Write-Host 'No trade reached the server logs in the window.'
}
exit 0
