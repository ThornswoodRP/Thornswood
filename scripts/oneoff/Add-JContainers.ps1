<#
  Add-JContainers.ps1

  RETIRED. DO NOT RUN. SunHelm left the collection with the needs rebuild
  (issue #480) and is in no live load order. Everything below installs
  JContainers SE and switches on the MCM recording that set SunHelm's
  hunger, thirst, exhaustion and cold meters on first character create.
  Running it now would put that SunHelm recorder path back into Game\Data
  for a mod the server does not carry. It refuses to run, and the rest of
  the file is kept for the history of how it was installed. site\data\known.md
  is where the removal is written down for people. Leftover after #735
  retired Add-TempleRespawn the same way.

  What it used to do, and what is left of it:

  Installs JContainers SE and switches on the MCM recording that sets
  everyone's survival meters up for them.

  SunHelm keeps its settings inside the save file, which is why the hunger,
  thirst, exhaustion and cold meters kept coming back off for whoever started
  a new character. Nothing shipped in a mod pack can reach a save. MCM
  Recorder can: it drives the real menu on the first character, clicking the
  options the way a person would. It needs JContainers to read its own files,
  which is the only reason this is a separate install.

      .\tools\Add-JContainers.ps1

  Options:
      -Notes "..."     what the News page says about this release
      -NoShip          install only, publish nothing

  The archive has to be JContainers SE 4.3.0, the one under Old files
  described as SKSE 2.2.6 / SSE (SAE) 1.6.1170. The current 4.3.2 is built
  for 1.7.104 and will not load here.
#>
[CmdletBinding()]
param(
    [string]$Root      = 'C:\Thornswood',
    [string]$Downloads = "$env:USERPROFILE\Downloads",
    [string]$Notes = 'Hunger, thirst, exhaustion and cold now switch themselves on. The launcher configures SunHelm for you the first time you make a character, so nobody has to go hunting through menus.',
    [switch]$NoShip,
    [switch]$NoPause
)

# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Add-JContainers.ps1 is retired and installs nothing. ' +
       'SunHelm left the collection with the needs rebuild (issue #480) and is in no live load ' +
       'order, so the MCM Recorder path this script still wires for SunHelm would put settings ' +
       'back for a mod the server does not carry. JContainers itself is already in the build when ' +
       'needed; this one-off was only the SunHelm first-run recording installer. ' +
       'Leftover called out after #735 retired Add-TempleRespawn the same way. ' +
       'The file is kept for the history of how it was installed. Delete this line only if ' +
       'SunHelm comes back to the collection, and read the header first.')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Close-Launcher.ps1')

$Data = Join-Path $Root 'Game\Data'
if (-not (Test-Path $Data)) { Die "No build at $Data." }

Head 'Making room'
if (Test-GameRunning -Root $Root) { Die 'Skyrim is running. Quit the game first, so this does not write underneath it.' }
$null = Stop-Launcher -Root $Root

Head 'Finding the download'
$jc = @(Get-ChildItem -LiteralPath $Downloads -Filter 'JContainers*' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1)
if (-not $jc.Count) { Die "Could not find a 'JContainers*' archive in $Downloads." }
Say "  $($jc[0].Name)" 'Green'
if ($jc[0].Name -notmatch '4\.3\.0') {
    Say '  WARNING: that does not look like 4.3.0. Only the 4.3.0 build loads on 1.6.1170.' 'Yellow'
}

. (Join-Path $PSScriptRoot '..\release\SevenZip.ps1')
$7z = Find-SevenZip
if (-not $7z) { Die '7-Zip is not installed.' }

$work = & (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'release') 'Get-ScratchDir.ps1') 'JContainers-install'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path $work

Head 'Unpacking'
$old = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { & $7z x -y "-o$work" $jc[0].FullName | Out-Null; $code = $LASTEXITCODE }
finally { $ErrorActionPreference = $old }
if ($code -gt 1) { Die 'Could not unpack the JContainers archive.' }

$dll = @(Get-ChildItem -LiteralPath $work -Recurse -File -Filter 'JContainers64.dll' -ErrorAction SilentlyContinue |
         Sort-Object { $_.FullName.Length } | Select-Object -First 1)
if (-not $dll.Count) { Die 'The archive did not contain JContainers64.dll. Wrong file?' }

# The dll sits at <root>\SKSE\Plugins\, so the folder to copy is three up.
$src = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $dll[0].FullName))

Head 'Installing'
$copied = 0
foreach ($f in @(Get-ChildItem -LiteralPath $src -Recurse -File -Force)) {
    $rel = $f.FullName.Substring($src.Length).TrimStart('\')
    if ($rel -match '(^|\\)[Ss]ource\\') { continue }
    if ($rel -match '\.pdb$') { continue }
    if ($rel -match '\.(txt|md|pdf|jpg|png|webp|html)$' -and $rel -notmatch '\\') { continue }
    $dest = Join-Path $Data $rel
    $dir  = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
    Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
    $copied++
}
Say ("  {0:n0} files into Game\Data" -f $copied) 'Green'

foreach ($need in @('SKSE\Plugins\JContainers64.dll', 'Scripts\JValue.pex', 'Scripts\JMap.pex')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Data $need))) { Die "$need did not land in Data." }
}
Say '  JContainers64.dll and its scripts are in place' 'Green'

# No plugin, so the load order does not move and nobody has to restart a
# character over this.
Head 'Load order'
Say '  untouched, JContainers ships no plugin' 'DarkGray'

Head 'The recording'
$rec = Join-Path $Data 'McmRecorder\Thornswood.json'
$steps = Join-Path $Data 'McmRecorder\Thornswood\0001_SunHelm.json'
if ((Test-Path $rec) -and (Test-Path $steps)) {
    Say '  Thornswood.json and its SunHelm steps are already in the build' 'Green'
} else {
    Say '  the recording files are missing from Game\Data\McmRecorder' 'Yellow'
    Say '  install them before shipping, or nothing will configure itself' 'Yellow'
}

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Say '  It plays once, when RaceMenu closes on a new character. Anyone already' 'Gray'
Say '  part way through a game keeps whatever they set, which is the polite' 'Gray'
Say '  way round.' 'Gray'
Write-Host ''

if ($NoShip) {
    Head 'Done'
    Say 'Installed. Nothing published, you asked for -NoShip.' 'Green'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

Head 'Handing over to Ship'
& (Join-Path $Here 'Ship.ps1') -Notes $Notes -Root $Root
