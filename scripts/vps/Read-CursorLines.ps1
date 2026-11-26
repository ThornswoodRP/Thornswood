<#
  Read-CursorLines.ps1

      pwsh scripts/vps/Box-Run.ps1 -Line 'Read-CursorLines -Days 7'                          from any session with gh, a cloud thread included
      pwsh scripts/vps/Remote.ps1 -File scripts/vps/Read-CursorLines.ps1 -Arguments '-Days 7'  on the box, from One
      .\scripts\vps\Read-CursorLines.ps1 -Folder <a folder of session log sets>               anywhere, for the harness

  Says where the cursor came up when the game's page took focus, in the
  sessions people really played. Issue #6200.

  WHY THIS EXISTS. On 16 Nov 2026 Patrick's first screen showed no cursor
  until he pressed Shift+Tab twice. His logs showed the page's first mouse
  move at 3429,0 of a 3440x1440 window, the top edge beside the right corner,
  and the run the day before at 3399,0. The cursor is drawn at the game's own
  menu cursor, so since fork pull request 167 (on main from build-1.3.115)
  SkyrimPlatform writes a line saying where that cursor is, whether the
  Cursor Menu is up, and where the Windows pointer is, when the game's data
  has loaded, at each focus taken and as the Cursor Menu opens and closes
  (BrowserApiTilted.cpp, LogCursor):

      [09:34:00:765] cursor, focus taken: the game's menu cursor at 3429,0, Cursor Menu closed, the Windows pointer at 1146,480 of the window in front (3440x1440)

  The launcher sends the tail of skyrim-platform.log and thornswood-front.log
  to the site when a session ends, and the site keeps each set in
  C:\Thornswood-Docs\data\session-logs\<session>.json. Those are on the box,
  where a cloud thread cannot open them (#6230), so this reads them there.

  WHAT IT PRINTS. For each set written in the window that holds any of
  them: the set's day and the launcher version its log names, then the
  cursor lines, the browser focus lines and the page's "mouse first moved"
  line, in the order the logs have them, then the input log's line saying
  how much mouse motion made during the load was left out (DInputHook.cpp,
  ForgetMouseMotion), at most 40 of each set. Then how
  many focus-taken lines put the game's cursor within 12 pixels of an edge
  of the window. No account, name, session key or address is printed: the
  lines it takes hold only times, positions, sizes and menu names.

  Reads only. Opens the folder's files, writes nothing, connects to nothing.
  Runs in PowerShell 7, on the box and anywhere. tests\test-6200-cursor-lines.ps1
  runs it against sets of its own.

  Exits 0 with what it found (or "no cursor lines in the window" and how many
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

# SkyrimPlatform's words (BrowserApiTilted.cpp, LogCursor and SetFocusedImpl;
# DInputHook.cpp, ForgetMouseMotion) and the choice page's
# (game\ui\thornswood-select.js). Change them together.
$CursorLine = 'cursor, (?:game data loaded|focus taken|Cursor Menu opening|Cursor Menu closing): the game''s menu cursor at (-?\d+),(-?\d+), Cursor Menu (?:open|closed), the Windows pointer at -?\d+,-?\d+ of the window in front(?: \(unknown\))? \((-?\d+)x(-?\d+)\)\s*$'
$FocusLine = '\] browser: focus (?:taken|let go)'
$MovedLine = 'choice page: mouse first moved at -?\d+,-?\d+ '
# DInputHook.cpp, ForgetMouseMotion: the motion made while the game loaded.
$DroppedLine = '^\[mouse\] the first read after the game''s data loaded held -?\d+,-?\d+ \(wheel -?\d+\) of motion made while it loaded; left out\s*$'
$Edge = 12
$Most = 40

if (-not (Test-Path -LiteralPath $Folder)) {
    Write-Host "STOP. There is no $Folder, so there are no session logs to read here."
    exit 1
}

$since = (Get-Date).AddDays(-$Days)
$read = 0
$bad = 0
$shown = 0
$taken = 0
$atEdge = 0
foreach ($f in @(Get-ChildItem -LiteralPath $Folder -Filter '*.json' -File | Where-Object { $_.LastWriteTime -ge $since } | Sort-Object LastWriteTime)) {
    $set = $null
    try { $set = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json } catch { $set = $null }
    if ($null -eq $set -or $null -eq $set.PSObject.Properties['logs'] -or $null -eq $set.logs) { $bad++; continue }
    $read++
    $lines = New-Object System.Collections.Generic.List[string]
    $platform = $set.logs.PSObject.Properties['skyrim-platform.log']
    if ($platform -and $platform.Value) {
        foreach ($line in ([string]$platform.Value -split "`r?`n")) {
            $m = [regex]::Match($line, $CursorLine)
            if ($m.Success) {
                $lines.Add($line.Trim())
                if ($line.Contains('cursor, focus taken:')) {
                    $taken++
                    $x = [int]$m.Groups[1].Value; $y = [int]$m.Groups[2].Value
                    $w = [int]$m.Groups[3].Value; $h = [int]$m.Groups[4].Value
                    if ($x -le $Edge -or $y -le $Edge -or ($w -gt 0 -and $x -ge $w - $Edge) -or ($h -gt 0 -and $y -ge $h - $Edge)) { $atEdge++ }
                }
            } elseif ($line -match $FocusLine) {
                $lines.Add($line.Trim())
            }
        }
    }
    $front = $set.logs.PSObject.Properties['thornswood-front.log']
    if ($front -and $front.Value) {
        foreach ($line in ([string]$front.Value -split "`r?`n")) {
            if ($line -match $MovedLine) { $lines.Add($line.Trim()) }
        }
    }
    $inputLog = $set.logs.PSObject.Properties['thornswood-input.log']
    if ($inputLog -and $inputLog.Value) {
        foreach ($line in ([string]$inputLog.Value -split "`r?`n")) {
            if ($line -match $DroppedLine) { $lines.Add($line.Trim()) }
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
Write-Host ("From {0:yyyy-MM-dd}: {1} session log sets read, {2} that would not read, {3} with cursor lines." -f $since, $read, $bad, $shown)
if (-not $shown) {
    Write-Host 'No cursor lines in the window. Either nobody played, or nobody had an engine that writes them yet (fork pull request 167).'
    exit 0
}
Write-Host ("Focus taken {0} time(s); the game's menu cursor was within {1} pixels of an edge of the window {2} of them." -f $taken, $Edge, $atEdge)
exit 0
