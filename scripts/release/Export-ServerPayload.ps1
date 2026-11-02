<#
  Export-ServerPayload.ps1

  Packages everything the VPS needs into one zip. Run on the build machine.

  The VPS has Node but no build toolchain, so nothing is compiled there. What
  goes across is the built server plus the plugin files its load order names,
  with the absolute paths rewritten for where they will live on the VPS.

  What goes, and nothing else (#1214):
    every server file records\server-build.json lists, each held to its hash
    first: scam_native.node, dist_back\skymp5-server.js and its map,
    package.json, yarn.lock, launch_server.bat and data\scripts
    (scripts\deploy\ServerBuild.ps1 says which and why)
    gamemode.js, its gamemode-tables folder (#5191) and thornswood-build.json,
    ours (the stamp from -Stamp when it is given, which is how
    Publish-Server.ps1 sends one made for the channel, #459)
    server-settings.json, rewritten below
    server-build.json, the record itself, for the installer to hold them again
  Whatever else sits in the build folder stays there and is named: an old
  settings copy, a gamemode backup, a manifest the server wrote while it ran
  here. Until #1214 everything in the folder went, so a binary or a
  JavaScript half from any build went with it.

  Deliberately left out:
    scam_native.pdb        73 MB of debug symbols, useless on the VPS
    world/                 the save. The VPS starts with a fresh world; copying
                           a local one across would import a character nobody
                           on that server made.
    *.bsa                  the server reads plugin records, not archives. If a
                           Papyrus script turns out to be missing, that is the
                           thing to revisit.

  Kept despite its size: skymp5-server.js.map, 10 MB. Without it every stack
  trace from the server points at minified bundle offsets.
#>
[CmdletBinding()]
param(
    [string]$Dist    = (& (Join-Path $PSScriptRoot 'Where.ps1') ServerDist),
    [string]$OutDir  = (& (Join-Path $PSScriptRoot 'Where.ps1') Payload),
    [string]$VpsRoot = 'C:\Thornswood-Server',
    [string]$Zip     = (& (Join-Path $PSScriptRoot 'Where.ps1') ServerZip),
    # Which server the payload is for (#1114). Dev's ports and name go into the
    # staged settings only; the build's own server-settings.json is never
    # written, so what a dev publish leaves behind is the live file it found.
    [ValidateSet('main', 'dev')][string]$Channel = 'main',
    # The build record the binary is held to and that goes into the payload as
    # server-build.json, so the installer on the box holds it too (#1214).
    [string]$Record = (Join-Path $PSScriptRoot '..\..\records\server-build.json'),
    # The build stamp to pack as thornswood-build.json, in place of the one in
    # the build (#459). Publish-Server.ps1 makes it for the channel it
    # publishes to, beside the gamemode artifact, so a dev stamp never sits in
    # the build for the next live deploy to send, the way the dev ports once
    # did (#1114). Left off, the build's own is packed, when there is one.
    [string]$Stamp = ''
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

if (-not (Test-Path -LiteralPath $Dist)) { throw "server dist not found: $Dist" }
. (Join-Path $PSScriptRoot '..\deploy\ServerSettings.ps1')
. (Join-Path $PSScriptRoot '..\deploy\ServerBuild.ps1')

# ---- settings no server should get, and the dev ones for live ----------------
# Until #1114 a dev Publish-Server rewrote the build's own settings to port
# 7787, voice 7789 and the name Thornswood Dev and never put them back, so the
# next live publish packed them and live came up on the dev port. Nothing
# writes dev settings into the build now, but a build left that way by an
# older run, or by Deploy-DevGamemode pointed at the wrong folder, still stops
# here, before anything is copied or zipped. So does an npcSettings "default"
# key on either channel, which refuses every NPC (#1222): the installer keeps
# the running server's own npcSettings, but a first install has none to keep.
$liveWhy = @(Get-ThornswoodServerSettingsProblems (ConvertFrom-ThornswoodJson (Get-Content -LiteralPath (Join-Path $Dist 'server-settings.json') -Raw) (Join-Path $Dist 'server-settings.json')) $Channel)
if ($liveWhy.Count) {
    $whose = if ($Channel -eq 'main') { "is not the live server's" } else { 'is not fit for any server' }
    throw ("server-settings.json in $Dist $($whose): " + ($liveWhy -join '; ') +
           '. Run .\scripts\deploy\Deploy-Gamemode.ps1, which writes the live ones, then publish again. Nothing was packed.')
}

# ---- every server file is the recorded build (#1214) -------------------------
# Deploy-Server refused a scam_native.node that is not the one
# records\server-build.json names, and the installer on the box refused one
# that is not its payload's record, but a payload carried no record, so a
# publish sent whatever binary sat in the build, and whatever JavaScript half
# beside it, which nothing recorded at all. Every file the record lists is
# held here, and any server file it does not list refuses the payload, before
# anything is copied; the record goes into the payload.
if (-not (Test-Path -LiteralPath $Record)) { throw "there is no build record at $Record, so nothing says which build these server files are. Nothing was packed." }
$rec = $null
try { $rec = [IO.File]::ReadAllText($Record) | ConvertFrom-Json } catch { throw "$Record does not parse: $($_.Exception.Message). Nothing was packed." }
. (Join-Path $PSScriptRoot 'RecordShape.ps1')   # #2180: a version this checkout knows, every field
$recBad = @(Get-ThornswoodRecordProblems -Doc $rec -Kind server-build)
if ($recBad.Count) { throw ("$Record is not a server-build record this checkout can trust: " + ($recBad -join '; ') + '. Nothing was packed.') }
$why = @(Get-ThornswoodServerBuildProblems $rec (Get-ThornswoodServerFolderSums $Dist) $Dist $Record)
if ($why.Count) {
    # Said a line each rather than inside the error, which Windows PowerShell
    # wraps at the window's width, words cut in half.
    Write-Host "the server files in $Dist are not the build $Record names:" -ForegroundColor Red
    foreach ($w in $why) { Write-Host ('  ' + $w) -ForegroundColor Red }
    Write-Host '  If it was rebuilt on purpose, record it with .\scripts\release\New-ServerBuildRecord.ps1 and commit that; if not, find out what changed.' -ForegroundColor Yellow
    throw 'the server files are not the recorded build; the lines above say which. Nothing was packed.'
}
$recFiles = Get-ThornswoodServerRecordFiles $rec
Write-Host ('every server file is the recorded build of ' + ([string]$rec.source.commit).Substring(0, 8) + ': ' + $recFiles.Count + ' files, scam_native.node ' + ([string]$rec.sha256).Substring(0, 12)) -ForegroundColor Cyan

# ---- the gamemode, and the stamp that names it -------------------------------
# A file this expects and does not find stops it (#1336). gamemode.js was
# left out without a word when the build had none, and the installer only
# parsed one that was there, so the payload went up and the server started
# with no gamemode: no door, no join pass, nobody's character. The recorded
# files were held above. The build stamp may be missing, from a build
# Deploy-Gamemode.ps1 never wrote one into, and that is said.
if (-not (Test-Path -LiteralPath (Join-Path $Dist 'gamemode.js'))) {
    throw "there is no gamemode.js in $Dist, so the server would start with no gamemode. Publish-Server.ps1 copies game\gamemode.js into the build; Export-ServerPayload.ps1 by itself needs it there first. Nothing was packed."
}
# Its tables (#5191) are the gamemode-tables folder beside it, which the
# gamemode reads as it loads; a load without them stops, so a build with none
# packs nothing either. Publish-Server.ps1 copies them in with gamemode.js.
$tablesIn = Join-Path $Dist 'gamemode-tables'
$tableFiles = @(Get-ChildItem -LiteralPath $tablesIn -Filter '*.json' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -cmatch '^[A-Z][A-Z0-9_]*\.json$' })
if (-not $tableFiles.Count) {
    throw "there are no gamemode tables in $tablesIn, so the gamemode would stop as it loads (#5191). Publish-Server.ps1 copies game\gamemode-tables into the build; Export-ServerPayload.ps1 by itself needs them there first. Nothing was packed."
}
if ($Stamp) {
    if (-not (Test-Path -LiteralPath $Stamp)) { throw "there is no build stamp at $Stamp, which this run was told to pack. Nothing was packed." }
} elseif (-not (Test-Path -LiteralPath (Join-Path $Dist 'thornswood-build.json'))) {
    Write-Host "no thornswood-build.json in $Dist, so the server will not be able to say which gamemode it runs" -ForegroundColor Yellow
}

if (Test-Path -LiteralPath $OutDir) { Remove-Item -LiteralPath $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'plugins') -Force | Out-Null

# ---- the server itself -----------------------------------------------------
# The recorded files, then ours. server-settings.json is written below.
$own = @('gamemode.js', 'thornswood-build.json')
$taken = @{}
foreach ($rel in @($recFiles.Keys) + $own) {
    $from = Join-Path $Dist ($rel -replace '/', '\')
    if ($rel -eq 'thornswood-build.json' -and $Stamp) { $from = $Stamp }
    if (-not (Test-Path -LiteralPath $from)) { continue }
    $to = Join-Path $OutDir ($rel -replace '/', '\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Force
    $taken[$rel] = $true
}
New-Item -ItemType Directory -Path (Join-Path $OutDir 'gamemode-tables') -Force | Out-Null
foreach ($t in $tableFiles) { Copy-Item -LiteralPath $t.FullName -Destination (Join-Path $OutDir ('gamemode-tables\' + $t.Name)) -Force }
# The record the files were just held to, for the installer to hold them again.
Copy-Item -LiteralPath $Record -Destination (Join-Path $OutDir 'server-build.json') -Force
$distFull = (Get-Item -LiteralPath $Dist).FullName.TrimEnd('\')
$left = @(Get-ChildItem -LiteralPath $distFull -Recurse -File -Force | ForEach-Object { ConvertTo-ThornswoodServerRel ($_.FullName.Substring($distFull.Length)) } |
          Where-Object { -not $taken.ContainsKey($_) -and $_ -ne 'server-settings.json' -and $_ -ne 'scam_native.pdb' -and $_ -notlike 'world/*' })
Write-Host ("server files copied: the {0} recorded, {1}and the record" -f $recFiles.Count, (@($own | Where-Object { $taken.ContainsKey($_) } | ForEach-Object { $_ + ', ' }) -join '')) -ForegroundColor Cyan
if ($left.Count) { Write-Host ('  left in the build, not part of a server release: ' + ($left -join ', ')) -ForegroundColor DarkGray }

# ---- the plugins its load order names --------------------------------------
$settingsPath = Join-Path $Dist 'server-settings.json'
$s = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $settingsPath -Raw) $settingsPath
if (-not $s.loadOrder) { throw 'server-settings.json has no loadOrder' }

$vpsPlugins = ($VpsRoot -replace '\\', '/') + '/plugins'
$newOrder = @()
$missing = @()
$bytes = 0
foreach ($p in $s.loadOrder) {
    $src = $p -replace '/', '\'
    if (-not (Test-Path -LiteralPath $src)) { $missing += $p; continue }
    $name = Split-Path $src -Leaf
    Copy-Item -LiteralPath $src -Destination (Join-Path $OutDir "plugins\$name") -Force
    $bytes += (Get-Item -LiteralPath $src).Length
    $newOrder += "$vpsPlugins/$name"
}
# A plugin the load order names and this machine does not have stops it
# (#1336). It used to be printed in red and left out, and the payload went
# with the shorter order: every form id after the gap then names the plugin
# one place on, and the installer cannot see it, because the order it is
# given is the shorter one and every plugin in that is there.
if ($missing) {
    Write-Host ("plugins the load order names that are not on this machine: {0}" -f ($missing -join ', ')) -ForegroundColor Red
    throw ("the load order names {0} plugin(s) this machine does not have, the lines above say which. Left out, every form id after the gap would name the wrong plugin. Install them where the order says they are (the collection, through Vortex) and run this again. Nothing was packed." -f $missing.Count)
}
Write-Host ("plugins: {0} copied, {1:N0} MB" -f $newOrder.Count, ($bytes/1MB)) -ForegroundColor Cyan

# ---- a settings file with VPS paths ----------------------------------------
# The load order must stay in exactly this order. Its indices are what form ids
# are resolved against, and the client resolves them against its own plugins.txt
# with no translation step in between.
$s.loadOrder = $newOrder
$s | Add-Member -NotePropertyName dataDir -NotePropertyValue 'data' -Force
# A dev payload: the dev server's port, voice port, name and which server a
# join pass must name, into this staged copy only (#1114). vps-dev-instance.ps1
# is where the numbers come from, the same ones Deploy-DevGamemode.ps1 checks
# for. They matter for a first install: over a running server the installer
# keeps that server's own settings and takes only the release's keys from here
# (ServerSettings.ps1, #1222).
if ($Channel -eq 'dev') {
    $s | Add-Member -NotePropertyName port -NotePropertyValue 7787 -Force
    if ($s.PSObject.Properties['name']) { $s.name = 'Thornswood Dev' }
    $s | Add-Member -NotePropertyName thornswoodVoicePort -NotePropertyValue 7789 -Force
    $s | Add-Member -NotePropertyName thornswoodServer -NotePropertyValue 'dev' -Force
    Write-Host 'dev channel: port 7787, voice 7789, name Thornswood Dev, thornswoodServer dev, in the payload only' -ForegroundColor Cyan
}
# Set-Content -Encoding UTF8 writes a byte order mark under Windows PowerShell
# 5.1 and does not under PowerShell 7, so the same line produces a different
# file depending on which one happens to run it. A BOM is not JSON: node stops
# on the first character with "Unexpected token", the server never starts, and
# nothing about the message points at the file that was written three steps
# earlier. WriteAllText with an explicit encoding is the same in both.
[IO.File]::WriteAllText((Join-Path $OutDir 'server-settings.json'), ($s | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))

# A dump from a previous run would override the file we just wrote.
$dump = Join-Path $OutDir 'server-settings-dump.json'
if (Test-Path -LiteralPath $dump) { Remove-Item -LiteralPath $dump -Force }

# ---- zip -------------------------------------------------------------------
if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
Write-Host 'compressing, this takes a minute' -ForegroundColor DarkGray
Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $Zip -CompressionLevel Optimal

$mb = [math]::Round((Get-Item -LiteralPath $Zip).Length / 1MB, 1)
Write-Host ''
Write-Host ("{0}  ({1} MB)" -f $Zip, $mb) -ForegroundColor Green
Write-Host ''
Write-Host 'Copy that to the VPS through the RDP session, then run Install-ThornswoodServer.ps1 there.' -ForegroundColor DarkGray
Write-Host ("It expects to land at {0}." -f $VpsRoot) -ForegroundColor DarkGray
