<#
  Set-UnboundMenu.ps1

  RETIRED. DO NOT RUN. Issue #1179: swapped Skyrim Unbound's MCM script by hand. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

  Switches Skyrim Unbound's config menu between the locked version and the
  full one.

  The shipped build runs a patched SkyrimUnboundMCMScript.pex whose page list
  is a single entry, Starting Location. That is what stops people handing
  themselves gear during character creation. It also stops YOU setting a class
  up, because Equipment, Spells and Inventory are the pages you need to build
  a preset.

  So: unlock, build the preset in game, save it under Unbound's own preset
  menu, quit, lock again, ship. The preset survives, since it is a file in
  SKSE\Plugins\SkyrimUnbound\Presets, and the menu goes back to one page for
  everyone else.

      .\scripts\mods\Set-UnboundMenu.ps1 -Full      every page, for authoring presets
      .\scripts\mods\Set-UnboundMenu.ps1 -Locked    Starting Location only, for shipping
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
    [switch]$Full,
    [switch]$Locked,
    [switch]$NoPause
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Set-UnboundMenu.ps1 is retired and installs nothing (issue #1179). ' +
       'Skyrim Unbound''s locked MCM script ships with the collection / own-folder payload now. Swapping the pex by hand writes into Game\Data. ' +
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

if ($Full -and $Locked) { Die 'Pick one, -Full or -Locked.' }
if (-not $Full -and -not $Locked) { Die 'Say which: -Full to author presets, -Locked to ship.' }

$live    = Join-Path $Root 'Game\Data\Scripts\SkyrimUnboundMCMScript.pex'
$stock   = Join-Path $Root '_dist\unbound-original\SkyrimUnboundMCMScript.pex'
$lockedF = Join-Path $Root '_dist\unbound-locked\SkyrimUnboundMCMScript.pex'

foreach ($f in @($live, $stock, $lockedF)) {
    if (-not (Test-Path -LiteralPath $f)) { Die "Missing $f" }
}

Head 'Making room'
if (Test-GameRunning -Root $Root) { Die 'Skyrim is running. Quit the game first.' }
$null = Stop-Launcher -Root $Root

$src  = if ($Full) { $stock } else { $lockedF }
$what = if ($Full) { 'every page' } else { 'Starting Location only' }

Copy-Item -LiteralPath $src -Destination $live -Force

function Sha($f) { return (Get-FileHash $f -Algorithm SHA256).Hash }
if ((Sha $live) -ne (Sha $src)) { Die 'The copy did not take.' }

Head 'Unbound menu'
Say "  now $what" 'Green'
Write-Host ''
if ($Full) {
    Say '  Build the class in game, then use Unbound''s own save-preset to write it out.' 'Gray'
    Say '  Do NOT ship while it is like this, or everyone gets the full menu.' 'Yellow'
    Say '  When you are done:  .\scripts\mods\Set-UnboundMenu.ps1 -Locked' 'Gray'
} else {
    Say '  Safe to ship.' 'Gray'
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
