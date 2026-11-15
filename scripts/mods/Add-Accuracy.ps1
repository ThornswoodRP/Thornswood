<#
  Add-Accuracy.ps1

  RETIRED. DO NOT RUN. Issue #1179: hand-installed Core Impact Framework and Accuracy, then Ships. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

  Localised combat damage. Where you hit somebody starts to matter, on top
  of what Precision already does for where your weapon actually is.

  Both of these are SKSE plugins with no plugin of their own, so the load
  order does not move and nobody has to start a new character.

  The one thing that matters in co-op: this is entirely client side, and
  damage is worked out on the machine of whoever swung. If one
  person has different numbers to everyone else, health bars disagree across
  screens and kills land at different times. So the config files ship with
  the build rather than being left to each person's MCM, and the optional
  MCM menu is deliberately not installed.

      .\scripts\mods\Add-Accuracy.ps1

  Options:
      -Notes "..."     what the News page says about this release
      -NoShip          install only, publish nothing
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Root      = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
    [string]$Downloads = "$env:USERPROFILE\Downloads",
    [string]$Notes = "Where you hit somebody now matters`n- localised damage per body part, layered on top of Precision`n- armour on that part of the body counts, so a helmet is worth wearing`n- the settings ship with the build, identical for everyone, because damage is worked out on the attacker's machine and mismatched numbers make health bars disagree",
    [switch]$NoShip,
    [switch]$NoPause
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Add-Accuracy.ps1 is retired and installs nothing (issue #1179). ' +
       'Core Impact Framework and Accuracy come from the Nexus collection now, not a hand install that Ships into Game\Data. ' +
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
if (Test-GameRunning -Root $Root) { Die 'Skyrim is running. Quit the game first.' }
$null = Stop-Launcher -Root $Root

Head 'Finding the downloads'
function Newest($pattern) {
    return @(Get-ChildItem -LiteralPath $Downloads -Filter $pattern -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}
$cif = @(Newest 'Core Impact Framework*')
$acc = @(Newest 'Accuracy*')
if (-not $cif.Count) { Die "Could not find a 'Core Impact Framework*' archive in $Downloads." }
if (-not $acc.Count) { Die "Could not find an 'Accuracy*' archive in $Downloads." }
Say "  $($cif[0].Name)" 'Green'
Say "  $($acc[0].Name)" 'Green'

$7z = @(
    "$env:ProgramFiles\7-Zip\7z.exe"
    "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
    "$env:LOCALAPPDATA\Programs\7-Zip\7z.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $7z) { Die '7-Zip is not installed.' }

$work = Join-Path $env:TEMP 'Accuracy-install'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path "$work\cif", "$work\acc"

Head 'Unpacking'
function Unzip($archive, $dest) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $7z x -y "-o$dest" $archive | Out-Null; return $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
}
if ((Unzip $cif[0].FullName "$work\cif") -gt 1) { Die 'Could not unpack Core Impact Framework.' }
if ((Unzip $acc[0].FullName "$work\acc") -gt 1) { Die 'Could not unpack Accuracy.' }

# Both archives wrap everything in a Data folder, so that folder is the root
# to copy from rather than the archive root.
function DataRoot($dir, $known) {
    $hit = @(Get-ChildItem -LiteralPath $dir -Recurse -File -Filter $known -ErrorAction SilentlyContinue |
             Sort-Object { $_.FullName.Length } | Select-Object -First 1)
    if (-not $hit.Count) { return $null }
    # <root>\Data\SKSE\Plugins\<dll>  ->  three levels up is <root>\Data
    return (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $hit[0].FullName)))
}

Head 'Installing'
$roots = @()
$cifRoot = DataRoot "$work\cif" 'CoreImpactFramework.dll'
$accRoot = DataRoot "$work\acc" 'Accuracy.dll'
if (-not $cifRoot) { Die 'Core Impact Framework archive had no CoreImpactFramework.dll.' }
if (-not $accRoot) { Die 'Accuracy archive had no Accuracy.dll.' }
$roots += $cifRoot
$roots += $accRoot

$copied = 0
foreach ($from in $roots) {
    foreach ($f in @(Get-ChildItem -LiteralPath $from -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($from.Length).TrimStart('\')
        if ($rel -match '\.pdb$') { continue }
        if ($rel -match '\.(txt|md|pdf|jpg|png|webp|html)$' -and $rel -notmatch '\\') { continue }
        $dest = Join-Path $Data $rel
        $dir  = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        $copied++
    }
}
Say ("  {0:n0} files into Game\Data" -f $copied) 'Green'

foreach ($need in @('SKSE\Plugins\CoreImpactFramework.dll',
                    'SKSE\Plugins\Accuracy.dll',
                    'SKSE\Plugins\Accuracy.ini')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Data $need))) { Die "$need did not land in Data." }
}
$rules = @(Get-ChildItem -LiteralPath (Join-Path $Data 'SKSE\CoreImpactFramework') -Recurse -File -Filter '*.json' -ErrorAction SilentlyContinue)
Say "  $($rules.Count) damage and mapping rule files, shared by everyone" 'Green'

Head 'Load order'
Say '  untouched, neither of these ships a plugin' 'DarkGray'

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Say '  The MCM menu for this was deliberately not installed. Its settings live' 'Gray'
Say '  in each save, so five people would drift apart and the numbers would' 'Gray'
Say '  stop matching. The ini in the build is the single source of truth.' 'Gray'
Write-Host ''

if ($NoShip) {
    Head 'Done'
    Say 'Installed. Nothing published, you asked for -NoShip.' 'Green'
    if (-not $NoPause) { Write-Host ''; [void](Read-Host 'Enter to close') }
    exit 0
}

Head 'Handing over to Ship'
& (Join-Path $Here '..\release\Ship.ps1') -Notes $Notes -Root $Root
