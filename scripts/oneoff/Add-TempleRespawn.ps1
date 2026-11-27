<#
  Add-TempleRespawn.ps1

  RETIRED. DO NOT RUN. Respawn - Death Overhaul left the collection with the
  needs rebuild (issue #480) and is in no live load order. Everything below
  installs it and puts it back into plugins.txt and loadorder.txt, so running
  it now would add a plugin the server does not carry and shift every index
  after it, which is the client's "Expect EVERYTHING BREAK". It also turns the
  server's own death system off, and nothing would then decide where anybody
  wakes up. It refuses to run, and the rest of the file is kept for the
  history of how the mod was installed. site\data\known.md is where the
  removal is written down for people.

  What it used to do, and what is left of it:

  Stops people respawning on the spot where they died. Respawn - Death
  Overhaul sends you to the Temple of Kynareth or the nearest Hall of the
  Dead instead, which is the closest thing Skyrim has to a soulslike bonfire.

  The old multiplayer server owned death by default and dropped you a few feet from your
  corpse, so this also turns the server's own death system off. There is no
  way to keep both: whichever one is on decides where you wake up.

      .\tools\Add-TempleRespawn.ps1

  Options:
      -Notes "..."     what the News page says about this release
      -NoShip          install only, publish nothing

  After this runs you still have to set bEnableDeathSystem = false in the
  BisectHosting panel and restart the server. The script prints a reminder.
#>
[CmdletBinding()]
param(
    [string]$Root      = 'C:\Thornswood',
    [string]$Downloads = "$env:USERPROFILE\Downloads",
    [string]$Notes = 'Dying now sends you to the Temple of Kynareth or the nearest Hall of the Dead instead of dropping you next to your own corpse. Walk back for your things.',
    [switch]$NoShip,
    [switch]$NoPause
)

# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Add-TempleRespawn.ps1 is retired and installs nothing. ' +
       'Respawn - Death Overhaul is out of the collection (issue #480) and out of the live load ' +
       'order, so installing it now would put a plugin in plugins.txt that the server does not ' +
       'carry and every mod form after it would resolve to the wrong object. ' +
       'The file is kept for the history of how it was installed. Delete this line only if the ' +
       'mod comes back to the collection, and read the header first.')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Close-Launcher.ps1')

$Data    = Join-Path $Root 'Game\Data'
$Golden  = Join-Path $Root 'Profile\Default'
$LocalAD = Join-Path $Root 'Profile\LocalAppData'

if (-not (Test-Path $Data)) { Die "No build at $Data." }

Head 'Making room'
if (Test-GameRunning -Root $Root) { Die 'Skyrim is running. Quit the game first, so this does not write underneath it.' }
$null = Stop-Launcher -Root $Root

# ---- the archives ---------------------------------------------------------
Head 'Finding the downloads'
function Newest($pattern) {
    return @(Get-ChildItem -LiteralPath $Downloads -Filter $pattern -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

$respawn = @(Newest 'Respawn*')
$mfgfix  = @(Newest 'Mfg Fix*')
if (-not $mfgfix.Count) { $mfgfix = @(Newest 'MfgFix*') }

if (-not $respawn.Count) { Die "Could not find a 'Respawn*' archive in $Downloads." }
Say "  $($respawn[0].Name)" 'Green'

# Mfg Fix is listed as a requirement, but all it guards against is coming back
# from the dead with your eyes shut. Worth having, not worth refusing to
# install over, and the build for 1.6.1170 is a fork rather than the original.
if ($mfgfix.Count) { Say "  $($mfgfix[0].Name)" 'Green' }
else { Say '  no Mfg Fix archive, installing without it. Faces may come back with shut eyes.' 'Yellow' }

. (Join-Path $PSScriptRoot '..\release\SevenZip.ps1')
$7z = Find-SevenZip
if (-not $7z) { Die '7-Zip is not installed.' }

$work = & (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'release') 'Get-ScratchDir.ps1') 'Respawn-install'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path "$work\respawn", "$work\mfgfix"

Head 'Unpacking'
function Unzip($archive, $dest) {
    # A native tool writing one line to stderr kills the script while
    # ErrorActionPreference is Stop, so 7-Zip runs with it relaxed.
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $7z x -y "-o$dest" $archive | Out-Null; return $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
}
if ((Unzip $respawn[0].FullName "$work\respawn") -gt 1) { Die 'Could not unpack the Respawn archive.' }
if ($mfgfix.Count -and (Unzip $mfgfix[0].FullName "$work\mfgfix") -gt 1) { Die 'Could not unpack the Mfg Fix archive.' }

# Archives from Nexus are sometimes wrapped in one folder and sometimes not,
# so the known file is found rather than assumed, and Data is rebuilt from
# where it actually sits.
function RootOf($dir, $pattern) {
    $hit = @(Get-ChildItem -LiteralPath $dir -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue |
             Sort-Object { $_.FullName.Length } | Select-Object -First 1)
    if (-not $hit.Count) { return $null }
    return (Split-Path -Parent $hit[0].FullName)
}

$respawnEsp  = 'Respawn - Death Overhaul.esp'
$respawnRoot = RootOf "$work\respawn" $respawnEsp
if (-not $respawnRoot) { Die "The Respawn archive did not contain '$respawnEsp'. Did a different file get downloaded?" }

# Mfg Fix is an SKSE plugin, so its root is the folder holding SKSE\, not the dll.
$roots = @($respawnRoot)
if ($mfgfix.Count) {
    $mfgDll = @(Get-ChildItem -LiteralPath "$work\mfgfix" -Recurse -File -Filter 'MfgFix.dll' -ErrorAction SilentlyContinue |
                Sort-Object { $_.FullName.Length } | Select-Object -First 1)
    if ($mfgDll.Count) { $roots += (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $mfgDll[0].FullName))) }
    else { Say '  the Mfg Fix archive had no MfgFix.dll in it, skipping' 'Yellow' }
}

Head 'Installing'
$copied = 0
foreach ($from in $roots) {
    foreach ($f in @(Get-ChildItem -LiteralPath $from -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($from.Length).TrimStart('\')
        # Scripts\Source and Source\Scripts are for people compiling papyrus.
        if ($rel -match '(^|\\)[Ss]ource\\') { continue }
        if ($rel -match '(^|\\)fomod\\') { continue }
        if ($rel -match '\.pdb$') { continue }
        # Readmes and screenshots that sit loose at the top of an archive.
        if ($rel -match '\.(txt|md|pdf|jpg|png|webp|html)$' -and $rel -notmatch '\\') { continue }
        $dest = Join-Path $Data $rel
        $dir  = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        $copied++
    }
}
Say ("  {0:n0} files into Game\Data" -f $copied) 'Green'

# ---- the load order -------------------------------------------------------
# Respawn hooks the death event and nothing else touches it, so it only has
# to sit before Skyrim Unbound, which stays last because it owns the opening.
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

if (-not (Test-Path -LiteralPath (Join-Path $Data $respawnEsp))) { Die "$respawnEsp did not land in Data." }
if ($plugLines -notcontains "*$respawnEsp" -and $plugLines -notcontains $respawnEsp) {
    $plugLines = @(InsertBeforeUnbound $plugLines "*$respawnEsp")
}
if ($loLines -notcontains $respawnEsp) {
    $loLines = @(InsertBeforeUnbound $loLines $respawnEsp)
}
Say "  + $respawnEsp" 'Green'

# No byte order mark. Skyrim reads the first line of plugins.txt verbatim, so
# three stray bytes in front of it become part of a plugin name that does not
# exist.
[IO.File]::WriteAllLines($plug, [string[]]$plugLines, (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllLines($lo,   [string[]]$loLines,   (New-Object Text.UTF8Encoding($false)))

# The live pair is what Skyrim and the server actually read. Copying the
# reference over them is exactly what the launcher's Fix button does.
if (-not (Test-Path $LocalAD)) { $null = New-Item -ItemType Directory -Force -Path $LocalAD }
Copy-Item $plug (Join-Path $LocalAD 'plugins.txt') -Force
Copy-Item $lo   (Join-Path $LocalAD 'loadorder.txt') -Force
Say '  reference and live lists are back in step' 'DarkGray'

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Say "  $($plugLines.Count) lines in plugins.txt, $($loLines.Count) in loadorder.txt" 'DarkGray'

Write-Host ''
Write-Host '  ONE THING LEFT, AND IT IS NOT OPTIONAL' -ForegroundColor Yellow
Say '  In the BisectHosting panel, set  bEnableDeathSystem = false  and restart' 'Yellow'
Say '  the server. Until you do, the server keeps deciding where people' 'Yellow'
Say '  wake up and this mod never gets a turn.' 'Yellow'
Write-Host ''

# ---- publish --------------------------------------------------------------
if ($NoShip) {
    Head 'Done'
    Say 'Installed. Nothing published, you asked for -NoShip.' 'Green'
    Write-Host ''
    Say 'When you are ready:  .\scripts\release\Ship.ps1 "what changed"' 'Gray'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

Head 'Handing over to Ship'
Say '  builds the launcher, then publishes the launcher and the changed mod files together' 'DarkGray'
& (Join-Path $Here 'Ship.ps1') -Notes $Notes -Root $Root
