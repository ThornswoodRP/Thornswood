<#
  test-6200-cursor-lines.ps1

      pwsh -NoProfile -File .\tests\test-6200-cursor-lines.ps1

  WHY THIS EXISTS. Issue #6200. The first screen's cursor came up at the top
  edge beside the right corner of Patrick's window on 15 and 16 Nov 2026, and
  SkyrimPlatform now writes where the game's menu cursor and the Windows
  pointer are when the page takes focus. Those lines reach the box in each
  session's log set, and scripts\vps\Read-CursorLines.ps1 reads them there
  for a cloud thread through the gate.

  What it checks:
    1. the reader's words are the engine's: the fork's BrowserApiTilted.cpp
       writes the cursor line in the shape the reader reads, when the engine
       checkout is here, the input log's line for the motion left out at the
       load (DInputHook.cpp) too, and the choice page writes "mouse first
       moved at";
    2. the reader, run against session log sets made here: it prints a set's
       cursor, focus and first move lines in order, and the input log's line
       for the motion left out at the load and none of the rest of it, leaves out a set written
       before the window and a set with none of them, counts a set that will
       not read and goes on, counts a focus at an edge (and one away from it),
       prints no account or session key, and says so when there are no lines.

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

$reader = Join-Path $repo 'scripts/vps/Read-CursorLines.ps1'
$readerText = [IO.File]::ReadAllText($reader)

# ---- 1. the words ---------------------------------------------------------------------
Write-Host 'the words'
$tilted = Join-Path $repo 'engine/skymp/skyrim-platform/src/platform_se/skyrim_platform/BrowserApiTilted.cpp'
if (Test-Path -LiteralPath $tilted) {
    $cpp = [IO.File]::ReadAllText($tilted)
    Yes 'the engine writes the cursor line in the reader''s words' ($cpp.Contains('"cursor, {}: the game''s menu cursor at {:.0f},{:.0f}, Cursor "') -and
        $cpp.Contains('"Menu {}, the Windows pointer at {},{} of the window in "') -and $cpp.Contains('"front{} ({}x{})"'))
    Yes '  at the data load, each focus taken and the Cursor Menu' ($cpp.Contains('LogCursor("game data loaded")') -and $cpp.Contains('LogCursor("focus taken")') -and
        $cpp.Contains('"Cursor Menu opening"') -and $cpp.Contains('"Cursor Menu closing"'))
    $hook = Join-Path $repo 'engine/skymp/skyrim-platform/src/tilted/hooks/DInputHook.cpp'
    if (Test-Path -LiteralPath $hook) {
        $hookText = [IO.File]::ReadAllText($hook)
        Yes '  and the input log says how much motion it left out, in the reader''s words' ($hookText.Contains('"[mouse] the first read after the game''s data loaded held "') -and
            $hookText.Contains('"%ld,%ld (wheel %ld) of motion made while it loaded; left out'))
    }
} else {
    Write-Host 'SKIP  the engine checkout is not here, so its words are not read'
}
$select = [IO.File]::ReadAllText((Join-Path $repo 'game/ui/thornswood-select.js'))
Yes 'the choice page writes its first move in the reader''s words' ($select.Contains("tell('mouse first moved at ' + ev.clientX + ',' + ev.clientY + ' '"))
Yes 'the reader names where its words come from' ($readerText.Contains('BrowserApiTilted.cpp, LogCursor') -and $readerText.Contains('thornswood-select.js'))

# ---- 2. the reader --------------------------------------------------------------------
Write-Host ''; Write-Host ('the reader, in ' + $PSVersionTable.PSEdition + ' ' + $PSVersionTable.PSVersion)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-6200-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    function Set-Logs([string]$name, [string]$who, [hashtable]$logs, [int]$hoursAgo) {
        $file = Join-Path $tmp ($name + '.json')
        [IO.File]::WriteAllText($file, (@{ who = $who; logs = $logs } | ConvertTo-Json -Depth 4))
        (Get-Item -LiteralPath $file).LastWriteTime = (Get-Date).AddHours(-$hoursAgo)
    }
    $loaded = "[09:33:57:693] cursor, game data loaded: the game's menu cursor at 1720,720, Cursor Menu closed, the Windows pointer at 1146,480 of the window in front (3440x1440)"
    $taken = '[09:34:00:765] browser: focus taken'
    $corner = "[09:34:00:766] cursor, focus taken: the game's menu cursor at 3429,0, Cursor Menu closed, the Windows pointer at 2286,0 of the window in front (3440x1440)"
    $opening = "[09:34:00:801] cursor, Cursor Menu opening: the game's menu cursor at 3429,0, Cursor Menu open, the Windows pointer at -1,-1 of the window in front (unknown) (3440x1440)"
    $middle = "[10:00:00:000] cursor, focus taken: the game's menu cursor at 1720,720, Cursor Menu open, the Windows pointer at 1146,480 of the window in front (3440x1440)"
    $dropped = "[mouse] the first read after the game's data loaded held -2210,-1302 (wheel 0) of motion made while it loaded; left out"
    $moved = '[front] 09:34:01.456 choice page: mouse first moved at 3429,0 vis=visible panel=flex/1/visible top=div.slot size=3440x1440 scale=1.33'
    Set-Logs 'key-one-secret' 'Someone Secret' @{
        'skyrim-platform.log' = ("[09:33:36:625] platform_se v2.9.0`n" + $loaded + "`n[09:33:58:195] registering browser api`n" + $taken + "`n" + $corner + "`n" + $opening + "`n" + $middle)
        'thornswood-front.log' = ("[front] 09:34:00.732 choice page: ready 3 slots`n" + $moved)
        'launcher.log' = '2026-11-16 09:33:33  Starting the game on launcher 1.3.115, game files of build-1.3.115, borderless.'
        'thornswood-input.log' = ("[coop] Mouse  asked 0x00000006 nonexclusive foreground  ->  used 0x0000000A`n" + $dropped + "`n[input] +5000ms  getData 250")
    } 2
    Set-Logs 'key-old' 'Old Person' @{ 'skyrim-platform.log' = $corner } (24 * 30)
    Set-Logs 'key-quiet' 'Quiet Person' @{ 'skyrim-platform.log' = '[09:00:00:000] game data loaded' } 3
    [IO.File]::WriteAllText((Join-Path $tmp 'key-broken.json'), '{ not json')

    $out = (& pwsh -NoProfile -File $reader -Folder $tmp -Days 7 2>&1 | Out-String)
    $code = $LASTEXITCODE
    Yes 'it exits 0' ($code -eq 0)
    Yes 'it prints the cursor, focus and first move lines of the set' ($out.Contains($loaded) -and $out.Contains($taken) -and $out.Contains($corner) -and
        $out.Contains($opening) -and $out.Contains($middle) -and $out.Contains($moved))
    Yes '  in the order the logs have them' ($out.IndexOf($loaded) -lt $out.IndexOf($taken) -and $out.IndexOf($taken) -lt $out.IndexOf($corner) -and $out.IndexOf($corner) -lt $out.IndexOf($moved))
    Yes 'it prints how much motion made during the load was left out' ($out.Contains($dropped))
    Yes '  and leaves out the rest of the input log' (-not $out.Contains('[coop]') -and -not $out.Contains('getData 250'))
    Yes '  and leaves out the lines that are not about the cursor' (-not $out.Contains('platform_se v2.9.0') -and -not $out.Contains('registering browser api') -and -not $out.Contains('ready 3 slots'))
    Yes 'it names the launcher the set ran on' ($out.Contains('on launcher 1.3.115'))
    Yes 'it leaves out a set written before the window' (([regex]::Matches($out, '(?m)^Session \d+,')).Count -eq 1)
    Yes 'it counts the sets read and the one that would not read' ($out.Contains('2 session log sets read, 1 that would not read, 1 with cursor lines'))
    Yes 'it counts a focus at an edge and one away from it' ($out.Contains("Focus taken 2 time(s); the game's menu cursor was within 12 pixels of an edge of the window 1 of them"))
    Yes 'it prints no account or session key' (-not $out.Contains('Secret') -and -not $out.Contains('key-one') -and -not $out.Contains('Old Person'))

    Remove-Item -LiteralPath (Join-Path $tmp 'key-one-secret.json')
    $none = (& pwsh -NoProfile -File $reader -Folder $tmp -Days 7 2>&1 | Out-String)
    Yes 'it says so when there are no cursor lines' ($LASTEXITCODE -eq 0 -and $none.Contains('No cursor lines in the window'))

    $missing = (& pwsh -NoProfile -File $reader -Folder (Join-Path $tmp 'not-there') 2>&1 | Out-String)
    Yes 'it stops when the folder is not there' ($LASTEXITCODE -eq 1 -and $missing.Contains('STOP.'))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Done
