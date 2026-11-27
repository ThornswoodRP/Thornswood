<#
  Read-MiningLines.ps1

      pwsh scripts/vps/Box-Run.ps1 -Line 'Read-MiningLines -Days 7'                          from any session with gh, a cloud thread included
      pwsh scripts/vps/Remote.ps1 -File scripts/vps/Read-MiningLines.ps1 -Arguments '-Days 7'  on the box, from One
      .\scripts\vps\Read-MiningLines.ps1 -Folder <a folder of session log sets>               anywhere, for the harness

  Prints what thornswood-front.js wrote about mining in the sessions people
  really played. Issue #4549.

  WHY THIS EXISTS. When a mining spell ends, the character can be left
  unable to jump, sprint or use a forge until the pickaxe is put on and taken
  off again. On 24 Nov 2026 a Main tester did it with the pickaxe drawn: the
  pickaxe went, the ore came with no swing, and they could not move normally
  until they took the pickaxe off. Since #2244 thornswood-front.js writes the
  character's state as lines when a spell ends, half a second and three
  seconds later, and after the next equip and unequip: the sit state, whether
  a weapon is out, the hand types and the behaviour graph variables that gate
  jumping, sprinting and furniture. It also writes every animation event of
  the swing and of the five seconds after it, once each, and what is in each
  hand at a draw or an attack. #6039 asked a person on Dev to send that log
  by hand, and nobody has.

  The launcher already sends the tail of thornswood-front.log to the site
  when a session ends. The site keeps each set in
  C:\Thornswood-Docs\data\session-logs\<session>.json, on the box, where a
  cloud thread cannot open it (#6230), so this reads those sets there.

  WHAT IT PRINTS. For each set written in the window that holds any of these
  lines: the set's day and the launcher version its log names, then the
  front log's "mining:", "after mining" and "hands at" lines in the order the
  log has them, at most 200 a set. Then how many of the sets were read and
  how many held mining lines. No account, name, session key or address is
  printed. The lines it takes hold only times, animation event and graph
  variable names and values, and the names of the items in the hands.

  Reads only. Opens the folder's files, writes nothing, connects to nothing.
  Runs in PowerShell 7, on the box and anywhere.
  tests\test-4549-mining-lines.ps1 runs it against sets of its own.

  Exits 0 with what it found (or "no mining lines in the window" and how many
  sets were read), 1 when the folder is not there.
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

# thornswood-front.js's words (watchTheSwing, afterLine, the after-mining
# hook and handsLine). Every line of that log is "[front] <clock> <text>".
# Change them together.
$MiningLine = '^\[front\] \S+ (?:mining: |after mining[,:] |hands at )'
$Most = 200

if (-not (Test-Path -LiteralPath $Folder)) {
    Write-Host "STOP. There is no $Folder, so there are no session logs to read here."
    exit 1
}

$since = (Get-Date).AddDays(-$Days)
$read = 0
$bad = 0
$shown = 0
foreach ($f in @(Get-ChildItem -LiteralPath $Folder -Filter '*.json' -File | Where-Object { $_.LastWriteTime -ge $since } | Sort-Object LastWriteTime)) {
    $set = $null
    try { $set = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json } catch { $set = $null }
    if ($null -eq $set -or $null -eq $set.PSObject.Properties['logs'] -or $null -eq $set.logs) { $bad++; continue }
    $read++
    $lines = New-Object System.Collections.Generic.List[string]
    $mining = $false
    $front = $set.logs.PSObject.Properties['thornswood-front.log']
    if ($front -and $front.Value) {
        foreach ($line in ([string]$front.Value -split "`r?`n")) {
            if ($line -match $MiningLine) {
                $lines.Add($line.Trim())
                if ($line -notmatch '\] \S+ hands at ') { $mining = $true }
            }
        }
    }
    # A set with only draws and attacks in it says nothing about mining.
    if (-not $mining) { continue }
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
Write-Host ("From {0:yyyy-MM-dd}: {1} session log sets read, {2} that would not read, {3} with mining lines." -f $since, $read, $bad, $shown)
if (-not $shown) {
    Write-Host 'No mining lines in the window. Either nobody mined, or the tail the launcher sent did not reach back that far.'
}
exit 0
