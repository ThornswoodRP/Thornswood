<#
  Add-CartTravel.ps1

  RETIRED. DO NOT RUN. Issue #1179: hand-installed CFTO and its patch, rewrote plugin lists, then Ships. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

  Carriages and ferries between the holds, so turning fast travel off leaves
  people with a way to get about.

  This deliberately uses the dull kind of carriage. Touring Carriages gives
  you a real animated ride, and in multiplayer that is the worst
  possible shape: it parents you to a moving furniture actor that the mod
  does not sync, so everyone else watches you stand still or slide, and its
  own author warns that saves made during a ride will not reload. CFTO fades
  instead. One position change, which is exactly what multiplayer already
  handles for ordinary fast travel.

      .\scripts\mods\Add-CartTravel.ps1

  Options:
      -Notes "..."     what the News page says about this release
      -NoShip          install only, publish nothing
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Root      = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
    [string]$Downloads = "$env:USERPROFILE\Downloads",
    [string]$Notes = "Carriages and ferries between the holds`n- every hold has a carriage, and ferries run the rivers`n- the ride is a fade rather than a scripted journey, because a real one desyncs badly in co-op`n- patched for JK's Skyrim so the drivers do not end up standing inside the rebuilt city gates",
    [switch]$NoShip,
    [switch]$NoPause
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Add-CartTravel.ps1 is retired and installs nothing (issue #1179). ' +
       'CFTO and its JK patch come from the Nexus collection now. A hand install rewrites plugin lists and Ships a second copy into Game\Data. ' +
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

$Data    = Join-Path $Root 'Game\Data'
$Golden  = Join-Path $Root 'Profile\Default'
$LocalAD = Join-Path $Root 'Profile\LocalAppData'
if (-not (Test-Path $Data)) { Die "No build at $Data." }

Head 'Making room'
if (Test-GameRunning -Root $Root) { Die 'Skyrim is running. Quit the game first.' }
$null = Stop-Launcher -Root $Root

Head 'Finding the downloads'
function AllMatching($pattern) {
    return @(Get-ChildItem -LiteralPath $Downloads -Filter $pattern -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending)
}
$all  = @(AllMatching 'C*arriage and Ferry*') + @(AllMatching 'CFTO*')
$main = @($all | Where-Object { $_.Name -notmatch 'Patch' } | Select-Object -First 1)
$jk   = @($all | Where-Object { $_.Name -match "JK" } | Select-Object -First 1)

if (-not $main.Count) { Die "Could not find the CFTO main archive in $Downloads." }
Say "  $($main[0].Name)" 'Green'
if ($jk.Count) { Say "  $($jk[0].Name)" 'Green' }
else { Say "  no JK's Skyrim patch found, drivers may stand in odd places" 'Yellow' }

$7z = @(
    "$env:ProgramFiles\7-Zip\7z.exe"
    "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
    "$env:LOCALAPPDATA\Programs\7-Zip\7z.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $7z) { Die '7-Zip is not installed.' }

$work = Join-Path $env:TEMP 'CFTO-install'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path "$work\main", "$work\jk"

Head 'Unpacking'
function Unzip($archive, $dest) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $7z x -y "-o$dest" $archive | Out-Null; return $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
}
if ((Unzip $main[0].FullName "$work\main") -gt 1) { Die 'Could not unpack the CFTO archive.' }
if ($jk.Count -and (Unzip $jk[0].FullName "$work\jk") -gt 1) { Die 'Could not unpack the JK patch.' }

function RootOf($dir, $plugin) {
    $hit = @(Get-ChildItem -LiteralPath $dir -Recurse -File -Filter $plugin -ErrorAction SilentlyContinue |
             Sort-Object { $_.FullName.Length } | Select-Object -First 1)
    if (-not $hit.Count) { return $null }
    return (Split-Path -Parent $hit[0].FullName)
}

Head 'Installing'
$plugins = @()
$roots = @()

$mainRoot = RootOf "$work\main" 'CFTO.esp'
if (-not $mainRoot) { Die 'The CFTO archive did not contain CFTO.esp.' }
$roots += $mainRoot; $plugins += 'CFTO.esp'

if ($jk.Count) {
    $jkRoot = RootOf "$work\jk" 'CFTO-JK-Patch.esp'
    if ($jkRoot) { $roots += $jkRoot; $plugins += 'CFTO-JK-Patch.esp' }
    else { Say '  the JK archive had no CFTO-JK-Patch.esp, skipping' 'Yellow' }
}

$copied = 0
foreach ($from in $roots) {
    foreach ($f in @(Get-ChildItem -LiteralPath $from -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($from.Length).TrimStart('\')
        if ($rel -match '(^|\\)[Ss]ource\\') { continue }
        if ($rel -match '(^|\\)fomod\\') { continue }
        if ($rel -match '\.(txt|md|pdf|jpg|png|webp|html)$' -and $rel -notmatch '\\') { continue }
        $dest = Join-Path $Data $rel
        $dir  = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        $copied++
    }
}
Say ("  {0:n0} files into Game\Data" -f $copied) 'Green'

Head 'Load order'
$plug = Join-Path $Golden 'plugins.txt'
$lo   = Join-Path $Golden 'loadorder.txt'
if (-not (Test-Path $plug)) { Die "No reference plugin list at $plug." }

$plugLines = @(Get-Content $plug)
$loLines   = @(Get-Content $lo)

function InsertBeforeUnbound($lines, $entry) {
    $out = @()
    $placed = $false
    foreach ($line in $lines) {
        if (-not $placed -and $line -match '^\*?Skyrim Unbound') { $out += $entry; $placed = $true }
        $out += $line
    }
    if (-not $placed) { $out += $entry }
    return $out
}

foreach ($name in $plugins) {
    if (-not (Test-Path -LiteralPath (Join-Path $Data $name))) { Die "$name did not land in Data." }
    if ($plugLines -notcontains "*$name" -and $plugLines -notcontains $name) {
        $plugLines = @(InsertBeforeUnbound $plugLines "*$name")
    }
    if ($loLines -notcontains $name) { $loLines = @(InsertBeforeUnbound $loLines $name) }
    Say "  + $name" 'Green'
}

[IO.File]::WriteAllLines($plug, [string[]]$plugLines, (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllLines($lo,   [string[]]$loLines,   (New-Object Text.UTF8Encoding($false)))

if (-not (Test-Path $LocalAD)) { $null = New-Item -ItemType Directory -Force -Path $LocalAD }
Copy-Item $plug (Join-Path $LocalAD 'plugins.txt') -Force
Copy-Item $lo   (Join-Path $LocalAD 'loadorder.txt') -Force
Say '  reference and live lists are back in step' 'DarkGray'
Say "  $($plugLines.Count) lines in plugins.txt, $($loLines.Count) in loadorder.txt" 'DarkGray'

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
# This used to say SunHelm switched fast travel off. SunHelm left the
# collection (To Do List entry 133) and was never what did it: the SkyMP
# client's DisableFastTravelService calls Game.enableFastTravel(false) on
# every update, and the skymp5-client.js in the game folder carries that call,
# checked 24 September. tests\test-sunhelm-gone.js looks for it.
Say '  Fast travel itself is switched off by the SkyMP client on every frame,' 'Gray'
Say '  so nothing here has to. Carriages are how people get about now.' 'Gray'
Write-Host ''

if ($NoShip) {
    Head 'Done'
    Say 'Installed. Nothing published, you asked for -NoShip.' 'Green'
    if (-not $NoPause) { Write-Host ''; [void](Read-Host 'Enter to close') }
    exit 0
}

Head 'Handing over to Ship'
& (Join-Path $Here '..\release\Ship.ps1') -Notes $Notes -Root $Root
