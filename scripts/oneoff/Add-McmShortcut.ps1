<#
  Add-McmShortcut.ps1

  RETIRED. DO NOT RUN. Issue #1179: hand-installed MCM Shortcut NG, then Ships. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

  Installs MCM Shortcut NG, which is what lets Skyrim Unbound open its own
  config menu.

  Unbound does not open the MCM itself. It calls
  MCMShortcutNG.OpenMCM(modName, delay, pageName, delay), and before that it
  asks MCMShortcutNG.IsInstalled(). With the plugin missing that answer is
  always no, so the menu never appears and the starting location can only be
  reached by opening the journal by hand.

  Unbound opens Pages[0], and Pages[0] is now the Starting Location page, so
  once this is in, character creation runs itself: face, then location, then
  class.

      .\scripts\oneoff\Add-McmShortcut.ps1

  Options:
      -Notes "..."     what the News page says about this release
      -NoShip          install only, publish nothing

  Download both files from the mod page, the main plugin and the optional
  "Default INI and JSON", and leave them in Downloads.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Root      = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
    [string]$Downloads = "$env:USERPROFILE\Downloads",
    [string]$Notes = 'Making a character now walks you through it. The starting location menu opens on its own after the face, and the class menu follows.',
    [switch]$NoShip,
    [switch]$NoPause
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Add-McmShortcut.ps1 is retired and installs nothing (issue #1179). ' +
       'MCM Shortcut NG comes from the Nexus collection now, not a hand install that Ships into Game\Data. ' +
       'The file is kept for the history of how it was installed. Delete this line only if ' +
       'hand installs are meant again, and read the header first.')


Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\dev\Close-Launcher.ps1')

$Data = Join-Path $Root 'Game\Data'
if (-not (Test-Path $Data)) { Die "No build at $Data." }

Head 'Making room'
if (Test-GameRunning -Root $Root) { Die 'Skyrim is running. Quit the game first, so this does not write underneath it.' }
$null = Stop-Launcher -Root $Root

Head 'Finding the downloads'
# The optional config download is not called "MCM Shortcut" at all, it is
# called "Default INI and JSON". Both carry the Nexus mod id 169548 in the
# filename, which is the only thing the two reliably share.
$archives = @(Get-ChildItem -LiteralPath $Downloads -File -ErrorAction SilentlyContinue |
              Where-Object { ($_.Name -match 'MCM.?Shortcut' -or $_.Name -match '169548') -and
                             $_.Extension -match '^\.(7z|zip|rar)$' } |
              Sort-Object LastWriteTime)
if (-not $archives.Count) {
    Die "Nothing matching 'MCM Shortcut' or '169548' in $Downloads. Grab it from https://www.nexusmods.com/skyrimspecialedition/mods/169548"
}
foreach ($a in $archives) { Say "  $($a.Name)" 'Green' }

$7z = @(
    "$env:ProgramFiles\7-Zip\7z.exe"
    "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
    "$env:LOCALAPPDATA\Programs\7-Zip\7z.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $7z) { Die '7-Zip is not installed.' }

$work = Join-Path $env:TEMP 'McmShortcut-install'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path $work

$copied = 0
$n = 0
foreach ($a in $archives) {
    $n++
    $dest = Join-Path $work ('a{0}' -f $n)
    $null = New-Item -ItemType Directory -Force -Path $dest

    Head ('Unpacking ' + $a.Name)
    $code = 0
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $7z x -y "-o$dest" $a.FullName | Out-Null; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    if ($code -gt 1) { Die ('Could not unpack ' + $a.Name) }

    # The archive root is whatever folder holds SKSE or Scripts. Nexus archives
    # wrap that in an extra folder often enough that guessing a depth is how
    # these scripts break, so it is found rather than assumed.
    $marker = @(Get-ChildItem -LiteralPath $dest -Recurse -Directory -Force -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -eq 'SKSE' -or $_.Name -eq 'Scripts' } |
                Sort-Object { $_.FullName.Length } | Select-Object -First 1)

    if ($marker.Count) {
        $src = Split-Path -Parent $marker[0].FullName
        foreach ($f in @(Get-ChildItem -LiteralPath $src -Recurse -File -Force)) {
            $rel = $f.FullName.Substring($src.Length).TrimStart('\')
            if ($rel -match '(^|\\)[Ss]ource\\') { continue }
            if ($rel -match '\.(pdb|md)$') { continue }
            if ($rel -notmatch '\\') { continue }
            $out = Join-Path $Data $rel
            $dir = Split-Path -Parent $out
            if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
            Copy-Item -LiteralPath $f.FullName -Destination $out -Force
            $copied++
        }
    }
    else {
        # The INI and JSON download is sometimes just the two loose files.
        $loose = @(Get-ChildItem -LiteralPath $dest -Recurse -File -Force -ErrorAction SilentlyContinue |
                   Where-Object { $_.Name -match '^MCMShortcutNG\.(ini|json)$' })
        if (-not $loose.Count) { Die ('Could not work out the shape of ' + $a.Name + '. Tell me what is inside it.') }
        $plugins = Join-Path $Data 'SKSE\Plugins'
        if (-not (Test-Path -LiteralPath $plugins)) { $null = New-Item -ItemType Directory -Force -Path $plugins }
        foreach ($f in $loose) {
            Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $plugins $f.Name) -Force
            $copied++
        }
    }
}

Head 'Installing'
Say ("  {0:n0} files into Game\Data" -f $copied) 'Green'

foreach ($need in @('SKSE\Plugins\MCMShortcutNG.dll', 'Scripts\MCMShortcutNG.pex')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Data $need))) { Die "$need did not land in Data. Wrong archive?" }
}
Say '  the dll and the Papyrus script are both in place' 'Green'

Head 'Load order'
Say '  untouched, MCM Shortcut NG ships no plugin' 'DarkGray'

Head 'Checking Unbound agrees'
$cfgFile = Join-Path $Data 'SKSE\Plugins\SkyrimUnbound\SkyrimUnbound.json'
if (Test-Path $cfgFile) {
    $cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json
    if ($cfg.int.auto_open_mcm -eq 1) {
        Say '  auto_open_mcm is on, so the location page opens by itself' 'Green'
    } else {
        Say '  auto_open_mcm is off, so nothing will open. Set it to 1.' 'Yellow'
    }
} else {
    Say '  SkyrimUnbound.json is missing from the build' 'Yellow'
}

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Say '  Character creation from here: the face, then the starting location' 'Gray'
Say '  page on its own, then Enter for the class menu. Nothing else is' 'Gray'
Say '  reachable, because every other Unbound page is gone.' 'Gray'
Write-Host ''

if ($NoShip) {
    Head 'Done'
    Say 'Installed. Nothing published, you asked for -NoShip.' 'Green'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

Head 'Handing over to Ship'
& (Join-Path $Here '..\release\Ship.ps1') -Notes $Notes -Root $Root
