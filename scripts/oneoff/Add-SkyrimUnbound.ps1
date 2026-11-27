<#
  Add-SkyrimUnbound.ps1

  RETIRED. DO NOT RUN. Issue #1179: installed Skyrim Unbound Reborn into the old build and published. The collection (or the settled load order) does this now. It refuses to run, and the rest of the file is kept for the history of how it was installed. Pattern from #405 Add-Bodies.

  What it used to do, and what is left of it:

  Installs Skyrim Unbound Reborn and PapyrusUtil into the isolated build, so
  nobody has to sit through the Helgen cart ride. Five people triggering that
  sequence at different times is also the fastest way to desync a fresh server.

  It reads the two archives straight out of Downloads. Nothing touches Vortex
  or your Steam copy, and it publishes when it is done, so this is the only
  command you run.

      .\tools\Add-SkyrimUnbound.ps1
      .\tools\Add-SkyrimUnbound.ps1 -Password

  Options:
      -Password        asks for the server password, not shown, and sets it
                       first, so it ships with this; nothing typed clears it.
                       Never typed on the command line (issue #1069).
      -Notes "..."     what the News page says about this release
      -NoShip          install only, publish nothing
#>
[CmdletBinding()]
param(
    [string]$Root      = 'C:\Thornswood',
    [string]$Downloads = "$env:USERPROFILE\Downloads",
    [switch]$Password,
    [string]$Notes = 'Skyrim Unbound. No more cart ride. New Game now asks where in Skyrim you wake up, and the launcher connects you to the server by itself once your save has loaded.',
    [switch]$NoShip,
    [switch]$NoPause
)
# The refusal comes before anything else, above the strict mode line and above
# the dot source below it, so no part of the install can run by accident.
throw ('STOP. Add-SkyrimUnbound.ps1 is retired and installs nothing (issue #1179). ' +
       'Skyrim Unbound Reborn comes from the Nexus collection now, not a one-off hand install that Ships into Game\Data. ' +
       'The file is kept for the history of how it was installed. Delete this line only if ' +
       'hand installs are meant again, and read the header first.')


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

# ---- the two archives -----------------------------------------------------
Head 'Finding the downloads'
function Newest($pattern) {
    return @(Get-ChildItem -LiteralPath $Downloads -Filter $pattern -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}
$unboundZip = Newest 'Skyrim Unbound Reborn*'
$papyrusZip = Newest 'PapyrusUtil AE SE*'

if (-not $unboundZip) { Die "Could not find 'Skyrim Unbound Reborn*' in $Downloads." }
if (-not $papyrusZip) { Die "Could not find 'PapyrusUtil AE SE*' in $Downloads." }
Say "  $($unboundZip.Name)" 'Green'
Say "  $($papyrusZip.Name)" 'Green'

. (Join-Path $PSScriptRoot '..\release\SevenZip.ps1')
$7z = Find-SevenZip
if (-not $7z) { Die '7-Zip is not installed, and the Unbound archive is a .7z.' }

$work = & (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'release') 'Get-ScratchDir.ps1') 'SkyrimUnbound-install'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path "$work\unbound", "$work\papyrus"

Head 'Unpacking'
# A native tool writing one line to stderr kills the script while
# ErrorActionPreference is Stop, so 7-Zip runs with it relaxed.
function Unzip($archive, $dest) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $7z x -y "-o$dest" $archive | Out-Null; return $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
}
if ((Unzip $unboundZip.FullName "$work\unbound") -gt 1) { Die 'Could not unpack the Skyrim Unbound archive.' }
if ((Unzip $papyrusZip.FullName "$work\papyrus") -gt 1) { Die 'Could not unpack the PapyrusUtil archive.' }

foreach ($need in @("$work\unbound\main\Skyrim Unbound.esp",
                    "$work\unbound\SkyUILib",
                    "$work\papyrus\SKSE\Plugins\PapyrusUtil.dll")) {
    if (-not (Test-Path -LiteralPath $need)) { Die "The archives did not contain $need. Did a different file get downloaded?" }
}
Say '  both archives look right' 'Green'

# ---- what goes in ---------------------------------------------------------
# Everything here was picked by reading each plugin's master list. The ones
# left out - Campfire, Bruma, Bonemold, Musical Instruments, Skyrim's Got
# Talent, Dungeon Boss - all name a master this build does not have, which is
# a crash on every machine rather than a missing feature.
#
# Vanilla Crossbow and CC Fishing carry no plugin at all, just JSON, so they
# cost nothing. CC Fishing gates itself on the free Fishing creation and simply
# does not appear for anyone who lacks it.
#
# The two patches are the only ones in the installer that match plugins we
# ship: Guard Dialogue Overhaul (the ESL build, confirmed from its header) and
# Capital Windhelm Expansion, which is WindhelmSSE.esp.
Head 'Installing'
$parts = @(
    @{ From = "$work\unbound\main";                             Into = $Data },
    @{ From = "$work\unbound\SkyUILib";                         Into = $Data },
    @{ From = "$work\unbound\options\female";                   Into = $null },   # not installed
    @{ From = "$work\unbound\addons\VanillaCrossbow";           Into = $Data },
    @{ From = "$work\unbound\addons\CCFishing";                 Into = $Data },
    @{ From = "$work\unbound\addons\OrcStrongholds";            Into = $Data },
    @{ From = "$work\unbound\addons\MeekosShack";               Into = $Data },
    @{ From = "$work\unbound\addons\BlackreachLaboratory";      Into = $Data },
    @{ From = "$work\unbound\addons\Thalmor";                   Into = $Data },
    @{ From = "$work\unbound\patches\GDO";                      Into = $Data },
    @{ From = "$work\unbound\patches\CapitalWindhelmExpansion"; Into = $Data },
    @{ From = "$work\papyrus\SKSE";                             Into = (Join-Path $Data 'SKSE') },
    @{ From = "$work\papyrus\Scripts";                          Into = (Join-Path $Data 'Scripts') }
)

$copied = 0
foreach ($p in $parts) {
    if (-not $p.Into) { continue }
    if (-not (Test-Path -LiteralPath $p.From)) { Say "  skipped, missing: $($p.From)" 'Yellow'; continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $p.From -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($p.From.Length).TrimStart('\')
        # Scripts\Source and Source\Scripts are for people compiling papyrus.
        if ($rel -match '(^|\\)[Ss]ource\\') { continue }
        $dest = Join-Path $p.Into $rel
        $dir  = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        $copied++
    }
}
Say ("  {0:n0} files into Game\Data" -f $copied) 'Green'

# ---- the orphan -----------------------------------------------------------
# This plugin lost its master and was pulled from the list, but the file is
# still on disk, so Skyrim keeps writing it back into plugins.txt. The server's
# mod check compares whole load orders, so a stray entry is a refused connect.
$orphan = Join-Path $Data 'More idle markers.esp'
if (Test-Path -LiteralPath $orphan) {
    $bin = Join-Path $Root '_removed'
    if (-not (Test-Path $bin)) { $null = New-Item -ItemType Directory -Force -Path $bin }
    Move-Item -LiteralPath $orphan -Destination (Join-Path $bin 'More idle markers.esp') -Force
    Say '  moved More idle markers.esp out of Data, it had no master' 'Yellow'
}

# ---- the load order -------------------------------------------------------
# Unbound goes late: it decides where a new character starts, so anything else
# that touches the opening should come first. Its addons and patches name it as
# a master, so they follow it.
Head 'Load order'
$add = @(
    'Skyrim Unbound.esp',
    'Skyrim Unbound Addon - Orc Strongholds.esp',
    'Skyrim Unbound Addon - Meeko''s Shack.esp',
    'Skyrim Unbound Addon - Blackreach Laboratory.esp',
    'Skyrim Unbound Addon - Thalmor.esp',
    'Skyrim Unbound - GDO Patch.esp',
    'Skyrim Unbound - Capital Windhelm Expansion Patch.esp'
)

$plug = Join-Path $Golden 'plugins.txt'
$lo   = Join-Path $Golden 'loadorder.txt'
if (-not (Test-Path $plug)) { Die "No reference plugin list at $plug." }

$plugLines = @(Get-Content $plug)
$loLines   = @(Get-Content $lo)

foreach ($name in $add) {
    if (-not (Test-Path -LiteralPath (Join-Path $Data $name))) { Die "$name did not land in Data." }
    if ($plugLines -notcontains "*$name" -and $plugLines -notcontains $name) { $plugLines += "*$name" }
    if ($loLines -notcontains $name) { $loLines += $name }
    Say "  + $name" 'Green'
}

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

# ---- the password ---------------------------------------------------------
# Set here rather than in the launcher, because the launcher that can show the
# box is the one this run is about to build. Publish-Update copies it out of
# config.json, so setting it before shipping is what gets it to everyone.
if ($Password) {
    Head 'Server password'
    # Read-ThornswoodSecret, which also takes the value piped in with no keyboard (#4346).
    . (Join-Path $PSScriptRoot '..\vps\Send-Secret.ps1')
    $newPassword = Read-ThornswoodSecret '  Server password (it is not shown; nothing clears it)'
    $cfgPath = Join-Path $Root 'config.json'
    if (-not (Test-Path $cfgPath)) { Die "No config.json at $cfgPath." }

    $raw  = [IO.File]::ReadAllBytes($cfgPath)
    $skip = if ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { 3 } else { 0 }
    $cfg  = [Text.Encoding]::UTF8.GetString($raw, $skip, $raw.Length - $skip) | ConvertFrom-Json

    if ($cfg.PSObject.Properties.Name -contains 'ServerPassword') { $cfg.ServerPassword = $newPassword }
    else { $cfg | Add-Member -NotePropertyName 'ServerPassword' -NotePropertyValue $newPassword }

    # No BOM. The launcher strips one, but nothing else that reads this does.
    $json = $cfg | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($cfgPath, $json, (New-Object Text.UTF8Encoding($false)))
    Say $(if ($newPassword) { "  set, and it ships with this release" } else { "  cleared" }) 'Green'
    $newPassword = $null
}

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
