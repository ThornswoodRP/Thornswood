<#
  test-npc-settings.ps1

  The NPCs come back: no "default" key inside npcSettings.

  WHAT WAS WRONG. Deploy-Gamemode.ps1 wrote the -Npcs choice as
  npcSettings = { "default": { spawnInInterior, spawnInExterior } }.
  ScampServer.cpp reads the flags from there and then ALSO keeps "default" in
  the per-plugin map, and WorldState::IsNpcAllowed refuses every NPC as soon
  as a key in that map is not a loaded plugin file. So every -Npcs setting
  that was not "off" spawned nobody. Patrick, 28 September: "NPCs are
  actually not working right now for some reason and they should be".
  Measured with the server binary over the Skyrim.esm and Update.esm form
  range: {} loads 6015 actors, a "default" key loads 0.

  WHAT THIS PROVES.
    1. Deploy-Gamemode.ps1's settings section, lifted by text and run against
       a scratch build for each -Npcs value, writes no "default" key.
    2. -Npcs all writes {}, -Npcs interior writes one entry per plugin in the
       load order, named exactly as the load order spells the file, inside
       only, and -Npcs off turns npcEnabled off.
    3. A "default" key a build already carries does not survive a deploy.
    4. When this machine has the server binary and the game's masters, the
       written npcSettings is handed to the engine itself: under all the
       Whiterun cow (outdoors) loads, under interior it does not and an
       indoor actor does. That part says SKIP where either is missing.
    5. The people (#956): both deploy scripts set npcAllowCrimeFaction and
       npcAllowEssential true, the dev settings block puts them on a box that
       lacks them and leaves a box that has them alone, and the engine then
       loads Belethor, Hulda and Nazeem, which it refuses with both off.

  Nothing here reaches the VPS. Read only apart from its own temp folder.
#>
[CmdletBinding()]
param([string]$RepoDir)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $RepoDir) { $RepoDir = $Here }
# The counting function Deploy-DevGamemode sends up with the block (#2011).
# The section lifted below calls ConvertFrom-ThornswoodJson, which Deploy-Gamemode dot-sources.
. (Join-Path $RepoDir 'scripts\release\Read-JsonFile.ps1')
. (Join-Path $RepoDir 'scripts\deploy\ServerOrder.ps1')
$script:fullIndexDef = 'function Get-ThornswoodFullIndex {' + "`n" + (Get-Command Get-ThornswoodFullIndex).Definition + "`n}"

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-npcs-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)

function Done {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$helper = Join-Path $RepoDir 'scripts\deploy\MaxOnline.ps1'
Yes 'MaxOnline.ps1 is there for the settings section' (Test-Path -LiteralPath $helper)
if (-not (Test-Path -LiteralPath $helper)) { Done }
. $helper
# The section counts the start point's full index with ServerOrder.ps1 (#1715).
$orderLib = Join-Path $RepoDir 'scripts\deploy\ServerOrder.ps1'
Yes 'ServerOrder.ps1 is there for the settings section' (Test-Path -LiteralPath $orderLib)
if (-not (Test-Path -LiteralPath $orderLib)) { Done }
. $orderLib

# ---- 1 to 3. Deploy-Gamemode.ps1's settings section --------------------------
$dg = Get-Content -LiteralPath (Join-Path $RepoDir 'scripts\deploy\Deploy-Gamemode.ps1') -Raw
$from = $dg.IndexOf('# ---- rewrite server-settings.json')
$to = -1
if ($from -ge 0) { $to = $dg.IndexOf('[IO.File]::WriteAllText($settingsPath', $from) }
if ($to -ge 0) { $to = $dg.IndexOf("`n", $to) }
Yes 'the settings section is in Deploy-Gamemode.ps1' ($from -ge 0 -and $to -gt $from)
if (-not ($from -ge 0 -and $to -gt $from)) { Done }
$section = $dg.Substring($from, $to - $from)

# The plugin names are the real kind: spaces, an apostrophe, an .esm and .esp.
$plugins = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
             "JK's Whiterun's Outskirts.esp", 'Skyrim Unbound.esp')

function Invoke-Section([string]$dist, [string]$npcs) {
    $Dist = $dist
    $paths = @($plugins | ForEach-Object { 'C:/Data/' + $_ })
    $ServerName = 'Thornswood'; $Port = 7777; $VoicePort = 7778; $Npcs = $npcs
    $HitsOnPeople = 1.0; $HitsOnNpcs = 2.0; $Devs = @(); $Playtesters = @()
    $maxOnline = [pscustomobject]@{ Value = 0; From = 'x'; Why = 'none' }
    . ([scriptblock]::Create($section)) 6>$null
}
# The build folder as a deploy from before this fix left it, default key and all.
function Seed-Built([string]$dist) {
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    [IO.File]::WriteAllText((Join-Path $dist 'server-settings.json'),
        ('{"port":7777,"name":"Thornswood","maxPlayers":25,"keepMe":"yes","loadOrder":[],' +
         '"npcEnabled":true,"npcSettings":{"default":{"spawnInInterior":true,"spawnInExterior":true}}}'), $utf8)
}
function Read-Built([string]$dist) {
    Get-Content -LiteralPath (Join-Path $dist 'server-settings.json') -Raw | ConvertFrom-Json
}
function Keys($o) { if ($null -eq $o) { return @() } return @($o.PSObject.Properties | ForEach-Object { $_.Name }) }

$written = @{}
foreach ($npcs in 'all', 'interior', 'off') {
    $dist = Join-Path $tmp ('dist-' + $npcs)
    Seed-Built $dist
    $ok = $true
    try { Invoke-Section $dist $npcs } catch { $ok = $false; Write-Host ("      " + $_.Exception.Message) }
    Yes ("-Npcs {0}: the lifted section runs against a scratch build" -f $npcs) $ok
    $w = Read-Built $dist
    $written[$npcs] = $w
    $keys = Keys $w.npcSettings
    Yes ("-Npcs {0}: npcSettings is written" -f $npcs) ($null -ne $w.npcSettings)
    Yes ("-Npcs {0}: npcSettings has no default key, which refuses every NPC" -f $npcs) ($keys -notcontains 'default')
    Yes ("-Npcs {0}: every key names a plugin in the load order" -f $npcs) (@($keys | Where-Object { $plugins -notcontains $_ }).Count -eq 0)
    Yes ("-Npcs {0}: a key nobody sets there survives" -f $npcs) ($w.keepMe -eq 'yes')
}

Yes '-Npcs all: npcEnabled is on' ($written['all'].npcEnabled -eq $true)
Yes '-Npcs all: npcSettings is {}, every NPC everywhere' ((Keys $written['all'].npcSettings).Count -eq 0)

$in = $written['interior']
$inKeys = Keys $in.npcSettings
Yes '-Npcs interior: npcEnabled is on' ($in.npcEnabled -eq $true)
Yes ('-Npcs interior: one entry per plugin, {0} of them' -f $plugins.Count) ($inKeys.Count -eq $plugins.Count)
Yes '-Npcs interior: the names are spelt as the load order spells them' (
    @($plugins | Where-Object { $inKeys -cnotcontains $_ }).Count -eq 0)
$flags = @($inKeys | ForEach-Object { $in.npcSettings.$_ })
Yes '-Npcs interior: every entry is inside only' (
    @($flags | Where-Object { $_.spawnInInterior -ne $true -or $_.spawnInExterior -ne $false }).Count -eq 0)

Yes '-Npcs off: npcEnabled is off' ($written['off'].npcEnabled -eq $false)

# ---- 5. the people, #956: the two gates that refuse guards and named people ----
foreach ($npcs in 'all', 'interior') {
    Yes ("-Npcs {0}: npcAllowCrimeFaction is true, so guards and townsfolk load" -f $npcs) ($written[$npcs].npcAllowCrimeFaction -eq $true)
    Yes ("-Npcs {0}: npcAllowEssential is true, so named shopkeepers and residents load" -f $npcs) ($written[$npcs].npcAllowEssential -eq $true)
}

# The dev box: Deploy-DevGamemode.ps1 never sends the settings file, it edits
# the one on the box, so its settings block is lifted and run in Windows
# PowerShell (what sshd runs there) against a box that has neither key, which
# is what the dev box had on 28 September.
$devScript = Join-Path $RepoDir 'scripts\deploy\Deploy-DevGamemode.ps1'
$devText = [IO.File]::ReadAllText($devScript)
$dStart = $devText.IndexOf("Write-Host 'Pointing the dev server at the dev voice service...'")
$dOpen = $devText.IndexOf('Remote @"', $dStart)
$dClose = $devText.IndexOf('"@ | ForEach-Object', $dOpen)
Yes 'the dev settings block is in Deploy-DevGamemode.ps1' ($dStart -ge 0 -and $dOpen -gt $dStart -and $dClose -gt $dOpen)
if ($dStart -ge 0 -and $dOpen -gt $dStart -and $dClose -gt $dOpen) {
    $devBody = $devText.Substring($dOpen + 'Remote @"'.Length, $dClose - $dOpen - 'Remote @"'.Length).Trim("`r", "`n")
    $box = Join-Path $tmp 'dev-box'
    New-Item -ItemType Directory -Force -Path $box | Out-Null
    function Run-DevBlock {
        $rootWin = $box; $orderWire = ''; $remotePlugins = 'C:/nowhere'; $VoicePort = 7789
        $fullIndexDef = $script:fullIndexDef
        $lightDef = ''
        $devRecordLight = $false
        $maxOnline = 0; $LoadOrderRefuse = ''; $RequirePass = ''; $Npcs = ''
        $file = Join-Path $tmp 'dev-block.ps1'
        [IO.File]::WriteAllText($file, $ExecutionContext.InvokeCommand.ExpandString($devBody), (New-Object Text.UTF8Encoding $true))
        $ErrorActionPreference = 'Continue'
        $said = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" }
        return ($said -join "`n")
    }
    function Dev-Backups { return @(Get-ChildItem -LiteralPath $box -Filter 'server-settings.json.before-*').Count }
    [IO.File]::WriteAllText((Join-Path $box 'server-settings.json'),
        ('{"port":7787,"thornswoodVoicePort":7789,"thornswoodServer":"dev","maxPlayers":10,' +
         '"equipmentSlotCheckEnabled":false,"equipmentSpellCheckEnabled":false,"equipmentInventoryCheckEnabled":false,' +
         '"loadOrder":["C:/p/Skyrim.esm"],"npcEnabled":true,"npcSettings":{}}'), $utf8)
    $said = Run-DevBlock
    $after = Get-Content -LiteralPath (Join-Path $box 'server-settings.json') -Raw | ConvertFrom-Json
    Yes 'dev box with neither key: says the people were refused and lets them in' ($said -match 'guards, shopkeepers and named people were refused')
    Yes 'dev box: npcAllowCrimeFaction is true after the run' ($after.npcAllowCrimeFaction -eq $true)
    Yes 'dev box: npcAllowEssential is true after the run' ($after.npcAllowEssential -eq $true)
    Yes 'dev box: the read back names both' ($said -match 'guards and townsfolk True, named people True')
    Yes 'dev box: the rest is kept (npcEnabled, npcSettings, port)' ($after.npcEnabled -eq $true -and $after.port -eq 7787 -and (Keys $after.npcSettings).Count -eq 0)
    Yes 'dev box: the old file is kept' ((Dev-Backups) -eq 1)
    $said = Run-DevBlock
    Yes 'dev box: a second run finds nothing to do and writes nothing' ((Dev-Backups) -eq 1 -and $said -notmatch 'were refused')
    # A box someone set false by hand is put back too.
    $o = Get-Content -LiteralPath (Join-Path $box 'server-settings.json') -Raw | ConvertFrom-Json
    $o.npcAllowEssential = $false
    [IO.File]::WriteAllText((Join-Path $box 'server-settings.json'), ($o | ConvertTo-Json -Depth 10), $utf8)
    $null = Run-DevBlock
    $after = Get-Content -LiteralPath (Join-Path $box 'server-settings.json') -Raw | ConvertFrom-Json
    Yes 'dev box: npcAllowEssential false is put back to true' ($after.npcAllowEssential -eq $true)
}

# ---- 4. the engine itself, where this machine has it --------------------------
$serverDist = $env:THORNSWOOD_SERVER_DIST
if (-not $serverDist) {
    try { $serverDist = [string](& (Join-Path $RepoDir 'scripts\release\Where.ps1') ServerDist 6>$null) } catch { $serverDist = '' }
}
$gameData = $env:THORNSWOOD_GAME_DATA
if (-not $gameData) { $gameData = 'C:\Thornswood\Game\Data' }
$native = if ($serverDist) { Join-Path $serverDist 'scam_native.node' } else { '' }
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not ($native -and (Test-Path -LiteralPath $native) -and (Test-Path -LiteralPath (Join-Path $gameData 'Skyrim.esm')) -and $node)) {
    Write-Host 'SKIP  the engine check: needs scam_native.node (THORNSWOOD_SERVER_DIST), Skyrim.esm (THORNSWOOD_GAME_DATA) and node'
    Done
}

# 0x10ebaf is the Whiterun cow the engine's own NpcExists test uses (outdoors,
# no crime faction, not essential). 0xea7 is an indoor actor in Skyrim.esm.
$probe = @'
const addon = require(process.argv[2]);
const s = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const srv = new addon.ScampServer(JSON.stringify(s));
const out = {};
for (const [k, id] of [['cow', 0x10ebaf], ['indoors', 0xea7], ['belethor', 0x1a672], ['hulda', 0x1a66e], ['nazeem', 0x1a6a4]]) {
  try { srv.get(id, 'pos'); out[k] = true; } catch (e) { out[k] = false; }
}
console.log('PROBE ' + JSON.stringify(out));
process.exit(0);
'@
$probeFile = Join-Path $tmp 'probe.js'
[IO.File]::WriteAllText($probeFile, $probe, $utf8)
$masters = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm')

function Invoke-Engine($npcSettings, [bool]$enabled, [switch]$AsGiven, [bool]$people = $true) {
    # The written npcSettings with the entries for the two plugins not loaded
    # here taken out, because the engine needs every key to be a plugin it
    # actually loaded. Any other key goes over as written, so a default key
    # reaches the engine. -AsGiven hands it over untouched.
    $ns = [ordered]@{}
    foreach ($k in (Keys $npcSettings)) {
        if ($AsGiven -or $masters -contains $k -or $plugins -notcontains $k) { $ns[$k] = $npcSettings.$k }
    }
    $s = [ordered]@{
        port = 7991; maxPlayers = 2; offlineMode = $true; name = 'npc-settings-test'
        dataDir = $gameData; loadOrder = @($masters | ForEach-Object { Join-Path $gameData $_ })
        npcEnabled = $enabled; npcAllowEssential = $people; npcAllowCrimeFaction = $people
        npcSettings = [pscustomobject]$ns; logLevel = 'error'
    }
    $f = Join-Path $tmp ('engine-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
    [IO.File]::WriteAllText($f, ([pscustomobject]$s | ConvertTo-Json -Depth 10), $utf8)
    $ErrorActionPreference = 'Continue'
    $line = @(& $node.Source $probeFile $native $f 2>&1 | ForEach-Object { [string]$_ } | Where-Object { $_.StartsWith('PROBE ') })
    if (-not $line.Count) { return $null }
    return ($line[-1].Substring(6) | ConvertFrom-Json)
}

$allPeople = ($written['all'].npcAllowCrimeFaction -eq $true -and $written['all'].npcAllowEssential -eq $true)
$r = Invoke-Engine $written['all'].npcSettings $true -people $allPeople
Yes 'engine, -Npcs all: the Whiterun cow is in the world' ($null -ne $r -and $r.cow -eq $true)
Yes 'engine, -Npcs all: so is the indoor actor' ($null -ne $r -and $r.indoors -eq $true)
# #956: Whiterun's trader, innkeeper and Nazeem, each unique and in the
# Whiterun crime faction, under the gates Deploy-Gamemode writes.
Yes 'engine, -Npcs all: Belethor is in the world' ($null -ne $r -and $r.belethor -eq $true)
Yes 'engine, -Npcs all: Hulda is in the world' ($null -ne $r -and $r.hulda -eq $true)
Yes 'engine, -Npcs all: Nazeem is in the world' ($null -ne $r -and $r.nazeem -eq $true)
# And the shape the dev box had, both gates off: the cow loads, the people do not.
$r = Invoke-Engine $written['all'].npcSettings $true -people $false
Yes 'engine, both gates off (the dev box before #956): the cow loads' ($null -ne $r -and $r.cow -eq $true)
Yes 'engine, both gates off: Belethor, Hulda and Nazeem do not' ($null -ne $r -and -not $r.belethor -and -not $r.hulda -and -not $r.nazeem)
$r = Invoke-Engine $written['interior'].npcSettings $true
Yes 'engine, -Npcs interior: the cow outdoors is not' ($null -ne $r -and $r.cow -eq $false)
Yes 'engine, -Npcs interior: the indoor actor is' ($null -ne $r -and $r.indoors -eq $true)
# The shape this replaces, to show the engine still refuses it: that is why
# the key must never be written.
$r = Invoke-Engine ([pscustomobject]@{ default = [pscustomobject]@{ spawnInInterior = $true; spawnInExterior = $true } }) $true -AsGiven
Yes 'engine: a default key still refuses the cow, the reason it is never written' ($null -ne $r -and $r.cow -eq $false)

Done
