<#
  Deploy-Gamemode.ps1

  Puts gamemode.js and its gamemode-tables folder (#5191) into the built
  server and writes a server load order that actually lines up with the
  client's.

  The load order is the whole game here, so it is worth stating plainly.

  SkyMP turns a form id into a plugin plus a local id with plain arithmetic,
  fileIdx * 0x01000000 + shortFormId, where fileIdx is the position in
  server-settings.json. The client does NOT translate: remoteIdToLocalId passes
  anything below 0xff000000 straight to Game.getFormEx, and the client never
  calls Game.getFormFromFile, the one API that resolves by plugin name and
  handles light plugins. So the server's indices must equal the game's.

  Skyrim gives an ESL-flagged plugin no normal index at all, so listing one
  server-side shifts everything after it. Leaving them out is therefore exact,
  not a compromise, and it matches what the client already believes: its own
  loadOrderVerificationService enumerates with Game.getModCount, which skips
  light plugins by construction.

  A plugin that masters to a dropped one cannot load either, so those are pruned
  too, repeatedly until the list is closed. On this setup that costs exactly one
  plugin, MCMHelper.esp, which is menu glue the server has no use for.

  A plugin is light if its extension is .esl or its TES4 header carries flag
  0x200. The second case is the one that surprises people: TheNewGentleman.esp
  was a plain .esp carrying both the ESM and ESL flags.

  AN ENGINE THAT LOADS LIGHT PLUGINS (#1715) gives each one the game's own
  0xFE slot, its light index, instead of a full index, so nothing shifts and
  nothing is dropped or pruned. records\server-build.json says which engine
  this is ("lightPlugins": true, written by New-ServerBuildRecord.ps1 when the
  recorded fork can tell a light plugin from a full one). Then the list is
  every plugin the game loads, in the game's order: the five masters, the
  Skyrim.ccc plugins in Data (_ResourcePack.esl is light index 0), then the
  plugin list, and the order the server already runs is kept for each kind
  apart (ServerOrder.ps1 says how). A form id is then computed from a
  plugin's place among the full plugins, never its place in the list.

  -FullLoadOrder disables all of this and lists everything. The server will
  start, and form ids will be wrong for every plugin after the first ESL. It is
  here for narrowing down a load failure, not for playing on.

  This script does not stop the live server and does not talk to the VPS. It
  only writes into the local build tree. People who are on live are counted and
  warned by Deploy-Server.ps1 before that one stops anything (OnlineNow, the
  listen check, Request-Restart, and -Minutes / -Mode / -Why / -Now). That is
  the live half of issue #520. online.json carries a count and no names, so the
  warning says how many are on, not who.

  It does not post to #news. A gamemode change that goes live is announced when
  Ship.ps1 runs and calls Publish-Discord.ps1 on the release note. This script
  only prepares the build tree; Deploy-Server.ps1 carries it up, and Ship tells
  people. Issue #594.

#>
param(
    [string]$Gamemode,
    [string]$Dist     = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ServerDist),
    # Under the launcher install, which Where.ps1 Install finds (C:\Thornswood
    # on most machines, another drive's when the launcher is there, #3003).
    # -Data, -Plugins and -Vortex still win.
    [string]$Data     = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    [string]$Plugins  = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile\Default\plugins.txt'),
    [string]$ServerName = 'Thornswood',
    [int]   $Port     = 7777,
    [switch]$MinimalLoadOrder,   # masters plus Thornswood-Content.esp only
    [switch]$FullLoadOrder,      # list everything, indices be damned. for bisecting
    [switch]$Vortex,             # read the Steam game and the active Vortex profile
    [switch]$NewOrder,           # take the plugin list's order as it is, for a world being wiped
    # Write only the load order this run would give the server, to this file,
    # as { "loadOrder": [paths] }, and nothing into the build: the order a new
    # collection revision makes, before Thornswood-Last.esp is built against
    # it (#4068). See THE ORDER ALONE below.
    [string]$OrderOnly = '',
    # The LIVE voice service, the one the 'Thornswood Voice' task runs on.
    # Written into server-settings.json on every deploy rather than left to
    # whatever is already in the file. See the block that writes it for why.
    # The dev half of this is Deploy-DevGamemode.ps1 -VoicePort, which is 7789.
    [int]$VoicePort = 7778,
    <#
      The NPCs, and how many of them the server simulates.

      Patrick, 21 September, after playing it: "To many fucking NPCs spawning
      man all at once group together, on top of players, enimes hit way to hard
      and have to much health or dont die at all".

      npcEnabled true with an empty npcSettings means the server simulates
      EVERY npc in the world, interior and exterior, because both spawn flags
      default to true in ScampServer. That is one shared world, which is the
      thing SkyMP is for, and it is also every bandit and every chicken in
      Skyrim being kept alive by one process.

        -Npcs off        none at all. The cleanest way to test a trade.
        -Npcs interior   only inside, so towns are alive and the roads are not.
        -Npcs all        the default, everything.

      Off is not a downgrade to the old multiplayer mod's behaviour: that
      was everybody getting their own private copy. Off is nobody getting one.
    #>
    [ValidateSet('all', 'interior', 'off')][string]$Npcs = 'all',

    <#
      What a blow is worth, in each direction.

      Patrick, 21 September, after playing it: "enimes hit way to hard and have
      to much health or dont die at all". Both halves are one class in the
      engine, DamageMultFormula, which is always in the chain.

      -HitsOnPeople    an NPC hitting a person. The engine's own default is 2,
                       applied when this file says nothing, which is what it
                       has always said. Nobody chose that doubling. 1 is the
                       blow the weapon is actually worth.
      -HitsOnNpcs      a person hitting an NPC. This direction was never
                       multiplied at all, and the formula under it reads the
                       weapon's base damage, the target's armour and the power,
                       block and sneak flags, and NOTHING about the person
                       swinging: no skill, no perks, no attackDamageMult. So a
                       giant keeps its full vanilla health and takes the number
                       printed on the sword, over and over. 2 is a starting
                       point and it is one number to turn.

      Both are read separately by the fork, so setting one does not discard the
      other. They are in server-settings.json, so they reach the dev server
      through Publish-Server -Channel dev and the live one through
      Deploy-Server, and neither needs a rebuild once the fork is built.
    #>
    [double]$HitsOnPeople = 1.0,
    [double]$HitsOnNpcs   = 2.0,

    <#
      Who may run /tp, /goto, /restart and the rest, and whether a session is
      held until its join pass arrives, are the live server's own, and this
      script does not write them (#1223). They used to be -Devs,
      -Playtesters and -RequirePass here, written into this machine's build
      and kept there for good, so every later Deploy-Server from this machine
      sent them to live again. Deploy-Server.ps1 -Devs, -Playtesters and
      -RequirePass set them on the box, in the run that asks.
    #>
    # Deploy even though the collection installed here is behind the one
    # Vortex knows is out. For the case where that is deliberate; it is a
    # refusal rather than a warning because a warning in a long run is a line
    # nobody reads.
    [switch]$IgnoreRevision
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot '..\release\Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

# ---------------------------------------------------------------- -Vortex ---
#
# Where the build actually is.
#
# Two answers, and the wrong one is silent: it produces a load order that
# looks fine and does not match what anybody is running. The old build under
# C:\Thornswood\Game is still on this machine and still readable, so a default
# that points at it keeps working long after it stopped being the truth.
#
# -Vortex reads the live one instead: Skyrim where Steam put it, with the mods
# Vortex has deployed into it, and the plugin list of whichever Vortex profile
# is active. That is what is loaded when the game starts, so it is what the
# server should be built from.
function Get-SkyrimPath {
    $roots = @()
    foreach ($k in 'HKCU:\Software\Valve\Steam','HKCU:\Software\Wow6432Node\Valve\Steam') {
        try { $p = (Get-ItemProperty -Path $k -Name SteamPath -EA Stop).SteamPath } catch { continue }
        if ($p) { $roots += ($p -replace '/','\') }
    }
    try { $p = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Wow6432Node\Valve\Steam' -Name InstallPath -EA Stop).InstallPath } catch { $p = $null }
    if ($p) { $roots += $p }

    # Games are not always in Steam's own folder. Every extra library is listed
    # in this file, one "path" line each, with the separator escaped.
    foreach ($r in @($roots)) {
        $vdf = Join-Path $r 'config\libraryfolders.vdf'
        if (-not (Test-Path -LiteralPath $vdf)) { continue }
        foreach ($line in (Get-Content -LiteralPath $vdf)) {
            $m = [regex]::Match($line, '^\s*"path"\s+"(.+)"\s*$')
            if ($m.Success) { $roots += ($m.Groups[1].Value -replace '\\\\','\') }
        }
    }

    foreach ($r in ($roots | Select-Object -Unique)) {
        $g = Join-Path $r 'steamapps\common\Skyrim Special Edition'
        if (Test-Path -LiteralPath (Join-Path $g 'SkyrimSE.exe')) { return $g }
    }
    return ''
}

if ($Vortex) {
    $sk = Get-SkyrimPath
    if (-not $sk) { throw "Could not find Skyrim Special Edition through Steam, so -Vortex has nothing to read." }
    $Data    = Join-Path $sk 'Data'
    $Plugins = Join-Path $env:LOCALAPPDATA 'Skyrim Special Edition\Plugins.txt'
    if (-not (Test-Path -LiteralPath $Plugins)) { throw "No plugin list at $Plugins. Start Vortex, activate the Thornswood profile and deploy, then run this again." }
    Write-Host "  -Vortex" -ForegroundColor Cyan
    Write-Host "    data     $Data" -ForegroundColor DarkGray
    Write-Host "    plugins  $Plugins" -ForegroundColor DarkGray
}


# Resolved from where this script is rather than from a fixed path under
# Downloads. The repo folder gets renamed and moved, and a default that names it
# turns every one of these into a broken command the first time it does.
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Gamemode) { $Gamemode = Join-Path $Here '..\..\game\gamemode.js' }

if (-not (Test-Path -LiteralPath $Gamemode)) { throw "not found: $Gamemode" }

# "server dist not found" read as a bug on any machine but the one that has
# the fork built, which is every machine but Patrick's. It is not a bug: this
# script writes the gamemode and the load order INTO a local skymp build tree,
# and a machine with no build tree has nothing to write into. Say that, and
# say what to do about it, rather than naming a path and stopping.
if (-not (Test-Path -LiteralPath $Dist)) {
    throw (
        "No skymp server build at $Dist, so there is nothing to configure." + [Environment]::NewLine +
        [Environment]::NewLine +
        "This script does not talk to the VPS. It writes gamemode.js and the load order into a" + [Environment]::NewLine +
        "LOCAL build of the server, and Deploy-Server.ps1 is what carries that build to the box." + [Environment]::NewLine +
        [Environment]::NewLine +
        "If you have the fork built somewhere else, point at it:" + [Environment]::NewLine +
        "    .\scripts\deploy\Deploy-Gamemode.ps1 -Dist <path to skymp\build\dist\server>" + [Environment]::NewLine +
        [Environment]::NewLine +
        "If you have not built the fork, this deploy is not yours to run. The build tree lives on" + [Environment]::NewLine +
        "Patrick's machine, and .\scripts\release\Check-ShipReady.ps1 says what this machine is missing."
    )
}

# The collection revision check further down reads its numbers through
# scripts\mods\LoadOrder.ps1. A checkout without that file used to skip the
# whole check without a word (#1814), the same kind of silent skip #1336 took
# out of the server publish chain, and a check that cannot run has not
# checked anything. So a missing file stops here, before anything is written,
# and -IgnoreRevision is the way past it, as it is for an unreadable revision.
$lo = [IO.Path]::GetFullPath((Join-Path $Here '..\mods\LoadOrder.ps1'))
if (-not (Test-Path -LiteralPath $lo) -and -not $IgnoreRevision) {
    Write-Host ''
    Write-Host "  STOP. $lo is not here, so the collection revision cannot be checked." -ForegroundColor Red
    Write-Host '  It reads the revision this machine has and the one Vortex knows is out, and' -ForegroundColor Red
    Write-Host '  the server''s load order is derived from what Vortex has deployed here.' -ForegroundColor Red
    Write-Host ''
    Write-Host '  Nothing was written. Put the file back from git, then run this again.' -ForegroundColor Yellow
    Write-Host '  -IgnoreRevision if you mean to deploy without the check.' -ForegroundColor DarkGray
    throw "$lo is missing, so the collection revision was not checked. Nothing was written."
}

# Whether the engine this build is loads light plugins (#1715), read before
# anything is written, from the record of the server build that goes out
# with this gamemode. A record that is missing or does not read stops here.
$serverOrderLib = Join-Path $Here 'ServerOrder.ps1'
if (-not (Test-Path -LiteralPath $serverOrderLib)) { throw "$serverOrderLib is missing, so the server's load order cannot be written. Nothing was written." }
. $serverOrderLib
$serverRecord = [IO.Path]::GetFullPath((Join-Path $Here '..\..\records\server-build.json'))
# RecordShape.ps1 (#2180): a server record this checkout cannot trust (a version
# it does not know, a missing field) stops the build here, before it is written.
. (Join-Path $Here '..\release\RecordShape.ps1')
if (Test-Path -LiteralPath $serverRecord) { $null = Read-ThornswoodRecord -Path $serverRecord -Kind server-build }
$loadsLight = (-not $FullLoadOrder) -and (-not $MinimalLoadOrder) -and (Test-ThornswoodEngineLoadsLight $serverRecord)

# How many the server holds at once, read before anything is written, so a
# number the engine would refuse stops this with the build untouched.
# MaxOnline.ps1 says where the number lives (records\most-online.json) and why.
. (Join-Path $Here 'MaxOnline.ps1')
$maxOnline = Get-MostOnline

# Syntax first, as Deploy-DevGamemode.ps1 does. A gamemode that does not parse
# stops the live server at start, and a live deploy is not always preceded by a
# dev one with the same file. node is required here, as it is in
# Deploy-DevGamemode.ps1 and Deploy-Server.ps1 (#1857): a check skipped where
# node is missing checks nothing.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is not on this machine, so gamemode.js cannot be checked before it goes live. Nothing was written.' }
& node --check $Gamemode
if ($LASTEXITCODE -ne 0) { throw 'gamemode.js does not parse. Nothing was written.' }
Write-Host '  gamemode.js parses'

if (-not $OrderOnly) {
    Copy-Item -LiteralPath $Gamemode -Destination (Join-Path $Dist 'gamemode.js') -Force
    $kb = [math]::Round((Get-Item (Join-Path $Dist 'gamemode.js')).Length / 1KB)
    Write-Host "gamemode.js -> $Dist  ($kb KB)" -ForegroundColor Cyan

    # Its tables (#5191), the gamemode-tables folder beside it: the gamemode
    # reads them from the server's folder as it loads, and a load without them
    # stops. The folder in the build is made the source's whole, so a table
    # the source no longer has does not stay behind in it.
    $tablesFrom = Join-Path (Split-Path -Parent $Gamemode) 'gamemode-tables'
    if (-not (Test-Path -LiteralPath $tablesFrom -PathType Container)) { throw "not found: $tablesFrom, the gamemode's tables (#5191)" }
    $tablesTo = Join-Path $Dist 'gamemode-tables'
    if (Test-Path -LiteralPath $tablesTo) { Remove-Item -LiteralPath $tablesTo -Recurse -Force }
    New-Item -ItemType Directory -Path $tablesTo -Force | Out-Null
    $tableCount = 0
    foreach ($t in @(Get-ChildItem -LiteralPath $tablesFrom -Filter '*.json' -File)) {
        Copy-Item -LiteralPath $t.FullName -Destination (Join-Path $tablesTo $t.Name) -Force
        $tableCount++
    }
    Write-Host "gamemode-tables -> $Dist  ($tableCount tables)" -ForegroundColor Cyan

    # What this gamemode is, written beside it, so the server can say which build it
    # runs instead of a person hashing files to find out. Deploy-Server.ps1 carries
    # it up with gamemode.js. Written straight after the copy and from the same
    # source, so the two always agree even if something below stops this run. The
    # fields and the reasons are in BuildStamp.ps1.
    . (Join-Path $Here '..\release\BuildStamp.ps1')
    $buildStamp = Save-ThornswoodBuildStamp -Gamemode $Gamemode -Channel main -RepoDir (Split-Path -Parent (Split-Path -Parent $Here)) `
                    -Path (Join-Path $Dist 'thornswood-build.json')
    Write-Host ("thornswood-build.json  {0}" -f (Format-ThornswoodBuildStamp $buildStamp)) -ForegroundColor DarkGray
}

function Read-PluginHeader([string]$path) {
    $fs = [IO.File]::OpenRead($path)
    $len = [Math]::Min(16384, $fs.Length)
    $b = New-Object byte[] $len
    [void]$fs.Read($b, 0, $len)
    $fs.Close()
    return (Read-PluginHeaderBytes $b $path)
}

# The same, of a plugin's first bytes, named $path for its extension.
function Read-PluginHeaderBytes([byte[]]$b, [string]$path) {
    $len = $b.Length

    # Two bits in the same dword at offset 8, and until 22 September only one
    # of them was read. 0x200 is light, which gets no index. 0x1 is master,
    # which the game honours BEFORE the list order: a master-flagged plugin is
    # hoisted to the front whatever position the list gives it. An .esm is
    # master by extension whether or not the bit is set, and an .esp can carry
    # the bit, which is the silent case: the game moves it, the server does
    # not, and every form id after it is computed from the wrong position.
    $light  = ($path -match '\.esl$')
    $master = ($path -match '\.esm$')
    if ($len -ge 12 -and [Text.Encoding]::ASCII.GetString($b,0,4) -eq 'TES4') {
        $flags = [BitConverter]::ToUInt32($b,8)
        if (($flags -band 0x200) -ne 0) { $light  = $true }
        if (($flags -band 0x1)   -ne 0) { $master = $true }
    }

    $masters = @()
    for ($i = 0; $i -lt $b.Length - 6; $i++) {
        if ($b[$i] -eq 0x4D -and $b[$i+1] -eq 0x41 -and $b[$i+2] -eq 0x53 -and $b[$i+3] -eq 0x54) {
            $sz = [BitConverter]::ToUInt16($b, $i+4)
            if ($sz -gt 0 -and $sz -lt 260 -and ($i+6+$sz) -le $b.Length) {
                $str = [Text.Encoding]::GetEncoding(1252).GetString($b, $i+6, $sz).TrimEnd([char]0)
                if ($str -match '\.es[pml]$') { $masters += $str }
            }
        }
    }
    [pscustomobject]@{ Light = $light; Master = $master; Masters = ($masters | Select-Object -Unique) }
}

# The master-flagged entries first, in the order they already have, then the
# rest in the order they already have. Stable both sides, because LOOT's
# ordering within each block is meaningful and a sort that shuffles it is a
# worse bug than the one being fixed.
function Sort-MastersFirst($names, $info) {
    $first = @($names | Where-Object { $info[$_] -and $info[$_].Master })
    $rest  = @($names | Where-Object { -not ($info[$_] -and $info[$_].Master) })
    return @($first + $rest)
}

# ---- build the load order --------------------------------------------------
$wanted = if ($MinimalLoadOrder) {
    'Skyrim.esm','Update.esm','Dawnguard.esm','HearthFires.esm','Dragonborn.esm','Thornswood-Content.esp'
} else {
    if (-not (Test-Path -LiteralPath $Plugins)) { throw "not found: $Plugins" }
    $fromFile = Get-Content -LiteralPath $Plugins |
                Where-Object { $_ -match '^\*' } |
                ForEach-Object { $_.TrimStart('*').Trim() }
    # plugins.txt omits the always-on masters; the server needs them spelled out
    $implicit = 'Skyrim.esm','Update.esm','Dawnguard.esm','HearthFires.esm','Dragonborn.esm'
    @($implicit | Where-Object { $fromFile -notcontains $_ }) + $fromFile
}

# IS THE COLLECTION THIS IS BEING DERIVED FROM ACTUALLY CURRENT?
#
# This is the question nothing asked, and it is why the live server spent a
# week built against a collection two revisions old.
#
# The server's load order comes from whatever Vortex has DEPLOYED on this
# machine. That is the right source: it is what the game actually loads. But
# it is only right if the deployment is current, and nothing checked. Vortex
# knew: its own state recorded newestVersion going 2 to 3 and then 3 to 4
# while every deploy took the revision 2 files without a word.
#
# A stale deploy is not a small thing. The world keys every changed form on
# the plugin's position in this list, so deploying from an old collection and
# then updating means moving the order twice. And everybody who installs the
# collection correctly gets a mod set the server has never seen and is
# refused at the door, which is exactly what was happening.
#
# It refuses rather than warns, because a warning in the middle of a long run
# is a line nobody reads. -IgnoreRevision is there for the case where the
# answer is genuinely "yes I know, do it anyway".
# $lo is the file the check before the first write made sure is here, or that
# -IgnoreRevision let this run go on without.
if (-not (Test-Path -LiteralPath $lo)) {
    Write-Host ("  collection revision NOT checked: {0} is missing, carrying on because -IgnoreRevision" -f $lo) -ForegroundColor Yellow
}
else {
    . $lo
    $cfgPath = Join-Path (Split-Path -Parent $Data) 'config.json'
    if (-not (Test-Path -LiteralPath $cfgPath)) { $cfgPath = (& (Join-Path $Here '..\release\Where.ps1') Install) + '\config.json' }
    # Which collection is read from config.json. One that is not there, or does
    # not read, names none, so the revision cannot be read below either, and
    # the stop there says why.
    $colUrl = ''
    $cfgWhy = ''
    if (-not (Test-Path -LiteralPath $cfgPath)) { $cfgWhy = "there is no $cfgPath to name the collection" }
    else {
        try { $colUrl = [string](ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $cfgPath -Raw) $cfgPath).CollectionUrl }
        catch { $cfgWhy = $_.Exception.Message }
        if (-not $cfgWhy -and -not $colUrl) { $cfgWhy = "$cfgPath names no CollectionUrl" }
    }
    $cs = Get-CollectionState $colUrl
    if ($cs.Known) {
        if ($cs.Behind -and -not $IgnoreRevision) {
            Write-Host ''
            Write-Host ("  STOP. This machine has collection revision {0} and Vortex says {1} is out." -f $cs.Have, $cs.Newest) -ForegroundColor Red
            Write-Host '  The server''s load order is derived from what Vortex has deployed here, so' -ForegroundColor Red
            Write-Host '  deploying now builds the server against a collection two steps behind the' -ForegroundColor Red
            Write-Host '  one everybody else installs. They get a mod set the server has never seen' -ForegroundColor Red
            Write-Host '  and are refused at the door.' -ForegroundColor Red
            Write-Host ''
            Write-Host '  Update the collection in Vortex, let it deploy, then run this again.' -ForegroundColor Yellow
            Write-Host '  -IgnoreRevision if you mean to deploy from the old one anyway.' -ForegroundColor DarkGray
            throw ("collection revision {0} installed, {1} available" -f $cs.Have, $cs.Newest)
        }
        Write-Host ("  collection revision {0}{1}" -f $cs.Have, $(if ($cs.Behind) { " (BEHIND $($cs.Newest), carrying on because -IgnoreRevision)" } else { ', which is the newest Vortex knows of' })) -ForegroundColor $(if ($cs.Behind) { 'Yellow' } else { 'Green' })
    }
    elseif (-not $IgnoreRevision) {
        #
        # A CHECK THAT CANNOT READ ITS NUMBERS HAS NOT CHECKED ANYTHING, and
        # until 22 September this branch did not exist: an unreadable revision
        # fell straight through and the deploy carried on with nothing said.
        #
        # Behind is false when either number is unknown, deliberately, because
        # a wrong number must never stop a deploy that is correct. That makes
        # "up to date" and "could not tell" the same answer to any caller
        # reading the bool, and on 22 September they were: Get-CollectionNewest
        # could only read the transition shape, so the moment this machine was
        # ON the newest revision the number went back to 0, Behind went false,
        # and the gate added the day before to stop a stale collection reaching
        # the server was off. It passed a deploy while blind, which is exactly
        # what it exists to prevent.
        #
        # So an unreadable revision stops here now, the same way Deploy-Server
        # refuses a binary it cannot hash. -IgnoreRevision is the way past it.
        Write-Host ''
        Write-Host '  STOP. The collection revision could not be read, so it was not checked.' -ForegroundColor Red
        Write-Host ("  installed here: {0}    newest Vortex knows of: {1}" -f `
            $(if ($cs.Have -gt 0) { $cs.Have } else { 'unreadable' }), `
            $(if ($cs.Newest -gt 0) { $cs.Newest } else { 'unreadable' })) -ForegroundColor Red
        if ($cfgWhy) { Write-Host ("  no collection to read it for: {0}" -f $cfgWhy) -ForegroundColor Red }
        Write-Host '  The server''s load order is derived from what Vortex has deployed here.' -ForegroundColor Red
        Write-Host '  Deploying without knowing the revision is how the server was built against' -ForegroundColor Red
        Write-Host '  a two revision old collection for days with nothing saying so.' -ForegroundColor Red
        Write-Host ''
        Write-Host '  Close Vortex and run this again: it holds its own state open while running.' -ForegroundColor Yellow
        Write-Host '  -IgnoreRevision if you mean to deploy without the check.' -ForegroundColor DarkGray
        throw 'the collection revision could not be read, so it was not checked'
    }
    else {
        Write-Host ("  collection revision NOT checked: it could not be read{0}, carrying on because -IgnoreRevision" -f $(if ($cfgWhy) { " ($cfgWhy)" } else { '' })) -ForegroundColor Yellow
    }
}

$info = @{}; $missing = @()
foreach ($p in $wanted) {
    $full = Join-Path $Data $p
    if (Test-Path -LiteralPath $full) { $info[$p] = Read-PluginHeader $full } else { $missing += $p }
}

# The Skyrim.ccc plugins in Data, which the game loads straight after the five
# masters whatever the list says. Only an engine that loads light plugins
# lists them: the ones Thornswood's own folder has are light
# (_ResourcePack.esl), and they take light index 0 and up on every machine.
$ccc = @()
if ($loadsLight) {
    $cccPath = Join-Path (Split-Path -Parent $Data) 'Skyrim.ccc'
    if (Test-Path -LiteralPath $cccPath) {
        $ccc = @(Get-Content -LiteralPath $cccPath | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    }
    foreach ($c in $ccc) {
        $full = Join-Path $Data $c
        if (-not $info.ContainsKey($c) -and (Test-Path -LiteralPath $full)) { $info[$c] = Read-PluginHeader $full }
    }
}

$drop = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$pruned = @{}
if ($loadsLight) {
    # Nothing is dropped: every light plugin has its own slot.
    $lightCount = 0
} elseif (-not $FullLoadOrder) {
    foreach ($p in $wanted) { if ($info[$p] -and $info[$p].Light) { [void]$drop.Add($p) } }
    $lightCount = $drop.Count
    do {
        $again = $false
        foreach ($p in $wanted) {
            if (-not $info[$p] -or $drop.Contains($p)) { continue }
            foreach ($m in $info[$p].Masters) {
                if ($drop.Contains($m)) { [void]$drop.Add($p); $pruned[$p] = $m; $again = $true; break }
            }
        }
    } while ($again)
} else { $lightCount = 0 }

$keep  = @($wanted | Where-Object { $info[$_] -and -not $drop.Contains($_) })

# THE PLUGIN THAT LOADS LAST (#2468, #2486) is ours, built in this repository
# and never in the collection, so no plugin list Vortex writes names it. When
# the checkout holds its recipe, it is the server's last plugin whatever the
# list says, and the deploy makes it on the box from the recipe (#2791,
# LastPluginOnBox.ps1); its header is read out of the recipe, which holds it
# as Thornswood wrote it. It is light, so it needs an engine that loads light
# plugins (#1715).
. (Join-Path $Here 'LastPluginRecipe.ps1')
$lastName = $ThornswoodLastPlugin
$lastHead = Get-ThornswoodLastRecipeHead (Join-Path $Here '..\..')
$lastHeld = $null -ne $lastHead
if ($lastHeld) {
    if (-not $loadsLight) {
        throw "$lastName is a light plugin and the server build records\server-build.json names does not load light plugins, so it cannot be in this load order."
    }
    $info[$lastName] = Read-PluginHeaderBytes $lastHead $lastName
    $keep = @($keep | Where-Object { $_ -ine $lastName }) + $lastName
}

# A plugin the list names that is not in Data. It was collected and then
# thrown away, so a list naming a plugin nobody has said nothing at all and
# the server quietly shipped an order one shorter than the one being read.
if ($missing.Count) {
    Write-Host ("  {0} plugin(s) the list names are not in {1}:" -f $missing.Count, $Data) -ForegroundColor Yellow
    foreach ($m in $missing) { Write-Host "    $m" -ForegroundColor Yellow }
    Write-Host '    They take no place in the server list. Every machine that has them is one place off from here on.' -ForegroundColor Yellow
}

# ---- the order the server already runs stays ------------------------------
#
# The world database keys every changed form on fileIdx * 0x01000000 plus the
# local id, and fileIdx is the position in this list. Move a plugin and every
# saved chest, door and body from every plugin after it points at the wrong
# record. So the order is not this machine's plugin list's to decide once a
# world exists: the list the server already has is kept as it is, a plugin
# that is new goes on the end, and a plugin that is gone is said out loud,
# because everything after it moves up one and that is the one move nothing
# here can undo. The client follows: the launcher's LoadOrder.cs puts every
# machine's list into the server's order, and Publish-Update.ps1 ships the
# reference list that way. Until 20 September this took the order from the
# plugin list every time, and LOOT re-sorting that list at 13:05 would have
# re-keyed the whole world on the next deploy.
#
# -NewOrder takes the list's order as it is. That is for a world that is
# being wiped, and for nothing else.
$priorPath = Join-Path $Dist 'server-settings.json'
$prior = @()
if (-not $NewOrder -and -not $FullLoadOrder -and -not $MinimalLoadOrder -and (Test-Path -LiteralPath $priorPath)) {
    try {
        $prior = @((ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $priorPath -Raw) $priorPath).loadOrder |
                   ForEach-Object { @(([string]$_) -split '[\\/]')[-1] } |
                   Where-Object { $_ })
    } catch { $prior = @() }
}
if ($loadsLight) {
    # The same rule for an engine that loads light plugins, kept for each
    # kind apart, because a full index and a light index count only their own
    # kind (ServerOrder.ps1). The first deploy that lists light plugins has no
    # light order to keep, so the light order is the game's for this list,
    # which is the order a machine that takes the pack's list gets.
    # With the last plugin held, the places full and light plugins hold among
    # each other are the ones it was built against, read from its record, not
    # this machine's list (ServerOrder.ps1, Get-ThornswoodRecordedSequence).
    $sequence = [string[]]$wanted
    $lastOrder = @()
    # -OrderOnly is the order Thornswood-Last.esp is about to be built
    # against, so it is not held to the one the plugin was built against.
    if ($lastHeld -and -not $OrderOnly) {
        $lastRecord = [IO.Path]::GetFullPath((Join-Path $Here '..\..\game\data\last-plugin.json'))
        if (-not (Test-Path -LiteralPath $lastRecord)) { throw "the checkout holds the recipe for $lastName and no game\data\last-plugin.json saying which load order it was built against" }
        $lastOrder = @((ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($lastRecord)) $lastRecord).loadOrder | ForEach-Object { [string]$_ })
        $rs = Get-ThornswoodRecordedSequence ([string[]]$wanted) ([string[]]$lastOrder)
        $sequence = $rs.Wanted
    }
    # Its own place is last, put there below, so the kept order is read
    # without it and it is never counted as gone.
    $keptPrior = @($prior | Where-Object { -not ($lastHeld -and $_ -ieq $lastName) })
    $so = Get-ThornswoodServerOrder $sequence ([string[]]$ccc) $info ([string[]]$keptPrior)
    $keep = @($so.Order)
    if ($prior.Count) {
        Write-Host ("  order kept from the server's own list, full and light apart: {0} full and {1} light, {2} full and {3} light new on the end of their own kind, {4} gone" -f `
            ($so.Full.Count - $so.AddedFull.Count), ($so.Light.Count - $so.AddedLight.Count), $so.AddedFull.Count, $so.AddedLight.Count, $so.Removed.Count) -ForegroundColor Cyan
    } else {
        if ($NewOrder) { Write-Host "  -NewOrder: the plugin list's order is taken as it is" -ForegroundColor Yellow }
        Write-Host ("  the game's order for this list: {0} full and {1} light plugins" -f $so.Full.Count, $so.Light.Count) -ForegroundColor Cyan
    }
    if (-not $so.LightKept -and $so.Light.Count) {
        Write-Host ("  light order taken from the plugin list, as the game takes it: {0} first at light index 0" -f $so.Light[0]) -ForegroundColor Cyan
    }
    foreach ($a in $so.AddedFull)  { Write-Host "    + $a" -ForegroundColor Green }
    foreach ($a in $so.AddedLight) { Write-Host "    + $a (light)" -ForegroundColor Green }
    foreach ($r in $so.Removed)    { Write-Host "    - $r   every plugin of its kind after it moves up one; the world's saved forms from those plugins are re-keyed (scripts\oneoff\Move-LightFormIds.ps1 for light ones)" -ForegroundColor Yellow }
    if ($so.NewFullMasters.Count -or $so.LightOutOfPlace.Count) {
        Write-Host ''
        Write-Host ("  STOP. {0} new plugin(s) the game loads ahead of where the kept order would put them:" -f ($so.NewFullMasters.Count + $so.LightOutOfPlace.Count)) -ForegroundColor Red
        foreach ($m in $so.NewFullMasters)  { Write-Host "    $m" -ForegroundColor Red }
        foreach ($m in $so.LightOutOfPlace) { Write-Host "    $m (light)" -ForegroundColor Red }
        Write-Host '  The game loads a master, and a Skyrim.ccc plugin, ahead of the rest of its kind whatever the' -ForegroundColor Red
        Write-Host '  list says, so it cannot go on the end of an order the world is already keyed to.' -ForegroundColor Red
        Write-Host '  Either take it out of the collection, or wipe the world and rebuild the' -ForegroundColor Red
        Write-Host '  order with -NewOrder, which re-keys everything on purpose.' -ForegroundColor Red
        throw 'a plugin the game loads ahead of its kind cannot be appended to the live order'
    }
    # The server's order is the one the last plugin was built against, or it
    # does not go out: the plugin would undo whatever a plugin that wins in
    # this order changed. Publish-Update refuses the same at the Ship
    # (Get-ShipLastPluginProblem); this stops it before a server runs it.
    if ($lastHeld -and -not $OrderOnly) {
        $built = @($so.Order | Where-Object { $_ -ine $lastName })
        $at = -1
        for ($i = 0; $i -lt [Math]::Max($built.Count, $lastOrder.Count); $i++) {
            $a = if ($i -lt $built.Count) { $built[$i] } else { '(nothing)' }
            $b = if ($i -lt $lastOrder.Count) { $lastOrder[$i] } else { '(nothing)' }
            if ($a -ine $b) { $at = $i; break }
        }
        if ($at -ge 0) {
            Write-Host ''
            Write-Host "  STOP. $lastName was built against another load order than the one this server keeps." -ForegroundColor Red
            Write-Host ("    at position {0} the server would load {1} and the plugin was built with {2}" -f ($at + 1), $a, $b) -ForegroundColor Red
            foreach ($n in $rs.NotRecorded) { Write-Host "    $n is enabled here and the plugin's record does not name it" -ForegroundColor Red }
            Write-Host '  Build it again for this order: python scripts\mods\Build-LastPlugin.py --data <a Data folder holding the collection''s bytes>,' -ForegroundColor Red
            Write-Host '  then commit the plugin and game\data\last-plugin.json.' -ForegroundColor Red
            throw "$lastName was built against another load order"
        }
        Write-Host ("  the order {0} was built against: {1} plugins, full and light where its record has them" -f $lastName, $built.Count) -ForegroundColor Cyan
    }
} elseif ($prior.Count) {
    $keepBy = @{}
    foreach ($k in $keep) { $keepBy[$k.ToLowerInvariant()] = $k }
    $ordered = @(); $placed = @{}
    foreach ($p in $prior) {
        $lk = $p.ToLowerInvariant()
        if ($keepBy.ContainsKey($lk) -and -not $placed.ContainsKey($lk)) { $ordered += $keepBy[$lk]; $placed[$lk] = $true }
    }
    $added   = @($keep  | Where-Object { -not $placed.ContainsKey($_.ToLowerInvariant()) })
    $removed = @($prior | Where-Object { -not $keepBy.ContainsKey($_.ToLowerInvariant()) })
    $keep = @($ordered + $added)
    Write-Host ("  order kept from the server's own list: {0} in place, {1} new on the end, {2} gone" -f $ordered.Count, $added.Count, $removed.Count) -ForegroundColor Cyan
    foreach ($a in $added)   { Write-Host "    + $a" -ForegroundColor Green }
    foreach ($r in $removed) { Write-Host "    - $r   every plugin after it moves up one; the world's saved forms from those plugins are re-keyed" -ForegroundColor Yellow }

    # The order is not re-sorted here, deliberately. A master that is already
    # in the server's list is where the world's form ids say it is, and
    # hoisting it now would re-key every saved form after it. But a NEW
    # master-flagged plugin goes on the end, and the game will load it at the
    # front, so client and server disagree from that plugin's own position
    # onwards the moment anybody starts the game. Say so rather than deploy it
    # quietly; -NewOrder with a wipe is the way out.
    $newMasters = @($added | Where-Object { $info[$_] -and $info[$_].Master })
    if ($newMasters.Count) {
        Write-Host ''
        Write-Host ("  STOP. {0} new plugin(s) carry the master flag:" -f $newMasters.Count) -ForegroundColor Red
        foreach ($m in $newMasters) { Write-Host "    $m" -ForegroundColor Red }
        Write-Host '  The game loads a master-flagged plugin at the front whatever the list says,' -ForegroundColor Red
        Write-Host '  so it cannot go on the end of an order the world is already keyed to.' -ForegroundColor Red
        Write-Host '  Either take it out of the collection, or wipe the world and rebuild the' -ForegroundColor Red
        Write-Host '  order with -NewOrder, which re-keys everything on purpose.' -ForegroundColor Red
        throw 'a new master-flagged plugin cannot be appended to the live order'
    }
} else {
    # Nothing to follow, so this is where the order is decided. The game puts
    # every master-flagged plugin first, so the server's list has to as well
    # or the two disagree from the first non-master onwards.
    $before = $keep
    $keep = Sort-MastersFirst $keep $info
    $movedMasters = 0
    for ($i = 0; $i -lt $keep.Count; $i++) { if ($keep[$i] -ne $before[$i]) { $movedMasters++ } }
    $masterCount = @($keep | Where-Object { $info[$_] -and $info[$_].Master }).Count
    if ($NewOrder) { Write-Host "  -NewOrder: the plugin list's order is taken as it is" -ForegroundColor Yellow }
    Write-Host ("  masters first: {0} master-flagged, {1} position(s) changed" -f $masterCount, $movedMasters) -ForegroundColor Cyan
}

# And last after the server's own order was followed, whatever it held.
if ($lastHeld) { $keep = @($keep | Where-Object { $_ -ine $lastName }) + $lastName }
$paths = @($keep | ForEach-Object {
    (Join-Path $Data $_) -replace '\\', '/'
})

# ---- THE ORDER ALONE (-OrderOnly, #4068) -----------------------------------
#
# A collection revision that adds plugins moves the order, and
# Thornswood-Last.esp has to be built against the order the servers will run
# before any server runs it; above, a deploy stops on a plugin built against
# another order. The NPC catalogue it is built from reads that order out of a
# server-settings file (scripts\dev\Build-NpcPopulation.py --settings), and
# until #4068 the only file that held it was the one this script would not
# write: on 27 Oct, with revision 5 on One, Build-NpcPopulation could only
# reuse revision 2's order and this stopped at it. So -OrderOnly writes the
# order this run would give the server, with the plugin's own place last,
# to that file and stops, having written nothing into the build:
#
#   Deploy-Gamemode.ps1 -NewOrder -OrderOnly temp\order\server-settings.json
#   python scripts\dev\Build-NpcPopulation.py --settings temp\order\server-settings.json --write-runtime
#   python scripts\dev\Build-ResourceLocations.py --settings temp\order\server-settings.json
#   python scripts\mods\Build-LastPlugin.py --data <the same Data>
#
# and a deploy after that holds the order the plugin's record now names.
# Each of Thornswood's own plugins in game\content is named at its file
# there, the one every builder reads it from (own_plugins.py, #2923), never
# the copy a game folder holds. Thornswood-Last.esp is not there: the box
# makes it from its recipe (#2791), so it takes its place last in Data.
if ($OrderOnly) {
    $ownDir = [IO.Path]::GetFullPath((Join-Path $Here '..\..\game\content'))
    $orderPaths = @($keep | ForEach-Object {
        $own = Join-Path $ownDir $_
        if (Test-Path -LiteralPath $own -PathType Leaf) { $own -replace '\\', '/' } else { (Join-Path $Data $_) -replace '\\', '/' }
    })
    $orderFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OrderOnly)
    $orderDir = Split-Path -Parent $orderFile
    if (-not (Test-Path -LiteralPath $orderDir)) { [void](New-Item -ItemType Directory -Force -Path $orderDir) }
    $orderDoc = [ordered]@{ builtBy = 'scripts/deploy/Deploy-Gamemode.ps1 -OrderOnly'; data = ($Data -replace '\\', '/'); loadOrder = $orderPaths }
    [IO.File]::WriteAllText($orderFile, ($orderDoc | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    Write-Host ("  the order alone, {0} plugins, to {1}; nothing was written into {2}" -f $orderPaths.Count, $OrderOnly, $Dist) -ForegroundColor Green
    return
}

# ---- rewrite server-settings.json -----------------------------------------
$settingsPath = Join-Path $Dist 'server-settings.json'
$s = if (Test-Path -LiteralPath $settingsPath) {
        ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $settingsPath -Raw) $settingsPath
     } else { [pscustomobject]@{} }

$s | Add-Member -NotePropertyName loadOrder   -NotePropertyValue $paths      -Force
$s | Add-Member -NotePropertyName name        -NotePropertyValue $ServerName -Force
$s | Add-Member -NotePropertyName port        -NotePropertyValue $Port       -Force
$s | Add-Member -NotePropertyName offlineMode -NotePropertyValue $true       -Force
$s | Add-Member -NotePropertyName dataDir     -NotePropertyValue 'data'      -Force
# How many it holds at once (#481): thornswoodMostOnline for the gamemode and
# the engine's slot count a few seats above it for staff, from
# records\most-online.json rather than whatever the build put there (100).
Set-MaxPlayers $s $maxOnline

<#
  WHICH VOICE SERVICE THIS SERVER TALKS TO, written every time rather than
  inherited.

  This file is READ BACK AND ADDED TO, not rewritten from nothing, so a key
  nobody sets here survives for ever once anything puts it in. On 20 September
  at 23:13 Deploy-DevGamemode.ps1 was run against C:\Thornswood-Server, the
  LIVE folder, instead of the dev one. It set thornswoodVoicePort to 7789, the
  dev voice service, and left its own server-settings.json.before-<stamp> in
  the live folder as the only trace. The backup it made has no such key, which
  is how that was proved rather than guessed.

  FOR TWO DAYS THE LIVE SERVER THEN TALKED TO THE DEV VOICE SERVICE. Nothing
  said so. The live voice service on 7778 took every slash command from every
  person and queued it; the live game server drained 7789, which was empty and
  always would be. The panel's picks ride that queue, so pressing Confirm at
  the end of character creation said "Sent. The server is checking." and
  nothing ever came back. Found 22 September with 38 commands piled up on
  7778 and 0 on 7789, after Patrick could not finish a character.

  The mirror of this is the case Deploy-DevGamemode.ps1 exists to prevent, and
  its own comment describes it: a dev server with no port set talks to the LIVE
  voice service and drains the live queues. Both directions are silent, and
  both are one wrong -Root away.

  So the live deploy asserts its own port the same way the dev deploy asserts
  its. Setting it beats defaulting to it: gamemode.js falls back to 7778 when
  the key is absent, but absent is not what goes wrong here, a wrong value is,
  and a fallback cannot correct a value that is present and wrong.
#>
if ($s.PSObject.Properties.Name -contains 'thornswoodVoicePort' -and
    [int]$s.thornswoodVoicePort -ne $VoicePort) {
    Write-Host ("  thornswoodVoicePort was {0}, which is not this server's voice service. Setting it to {1}." -f `
        [int]$s.thornswoodVoicePort, $VoicePort) -ForegroundColor Yellow
    Write-Host '  A value that is not ours here means a dev deploy was pointed at this folder.' -ForegroundColor DarkGray
}
$s | Add-Member -NotePropertyName thornswoodVoicePort -NotePropertyValue $VoicePort -Force
# Which server a join pass must name (#937). Asserted for the same reason as
# the voice port: a dev deploy pointed at this folder writes dev here, and the
# live server would then refuse every pass the site issues for it.
$s | Add-Member -NotePropertyName thornswoodServer -NotePropertyValue 'main' -Force
# The join pass hold and the written role lists are the live server's own and
# never come from a build (#1223): Deploy-Server.ps1 -RequirePass, -Devs and
# -Playtesters set them on the box. A build an older run of this script gave
# them keeps them for good, because this file is read back and added to, so
# they are taken out here and the build stops carrying a value nobody asked
# this run for.
$fromBuild = @('thornswoodRequirePass', 'thornswoodDevs', 'thornswoodPlaytesters' |
               Where-Object { $s.PSObject.Properties.Name -contains $_ })
foreach ($k in $fromBuild) { $s.PSObject.Properties.Remove($k) }
if ($fromBuild.Count) {
    Write-Host ('  taken out of this build, because the live server keeps its own: ' + ($fromBuild -join ', ')) -ForegroundColor Yellow
}
Write-Host '  join pass and role lists: the live server keeps its own; Deploy-Server.ps1 -RequirePass on|off, -Devs and -Playtesters change them (#1223).' -ForegroundColor DarkGray
# Server-simulated NPCs. Off is SkyMP's default and it is the old multiplayer
# mod's behaviour we are leaving behind: everyone gets their own private copy of every
# bandit. On means one shared world. npcSettings stays empty, which is "no
# per-NPC overrides", not "no NPCs".
$s | Add-Member -NotePropertyName npcEnabled  -NotePropertyValue ($Npcs -ne 'off') -Force
# The people, not only the animals (#956). The engine refuses anyone in a
# hold's crime faction (every guard, nearly every townsperson) and anyone
# essential, protected or unique (every named shopkeeper and resident) unless
# these two say otherwise, and nothing wrote them, so the world had its animals
# and few of its people. Over the dev load order the server binary loads 1406
# of 4942 Skyrim.esm people with both off and 3274 with both on.
# Deploy-DevGamemode.ps1 sets the same two on the dev box.
$s | Add-Member -NotePropertyName npcAllowCrimeFaction -NotePropertyValue $true -Force
$s | Add-Member -NotePropertyName npcAllowEssential -NotePropertyValue $true -Force

# WHAT YOU ARE WEARING STAYS ON. Measured 20 September, after Patrick rejoined
# an existing character and arrived with nothing on.
#
# The server refuses an equipment update outright in two places, and on a
# modded load order both of them fire constantly:
#
#   equipmentSlotCheckEnabled   the gear strip. ActionListener::OnUpdateEquipment
#                               ORs together the biped slot flags of everything
#                               worn and refuses the whole update the moment two
#                               items share one bit, then sends an UnequipItem
#                               for every item involved. Vanilla Skyrim already
#                               uses slots 44 to 47, and every cloak, scarf and
#                               backpack mod reaches for the same handful of
#                               free-looking ones. It is an anti-cheat against
#                               wearing five chest pieces and it costs far more
#                               than it earns here.
#   equipmentSpellCheckEnabled  a spell the server did not itself grant is
#                               refused and a RemoveSpell is sent back. Every
#                               spell learned from a tome in the world is one
#                               the server never saw, so it comes straight back
#                               off the hand.
#
# Both were made switchable in our own fork of the engine and both still default
# to true in WorldState.h:277-278, because the engine change was made and the
# last step, writing the setting, never was. So the switches have been there and
# have never once been thrown. This throws them.
#
# What is worn is saved by the engine, not by the gamemode: MpChangeForm carries
# an equipment field and MpChangeForms.cpp writes it to the world save. So
# equipment already persists across a session, on the one condition that the
# update was accepted in the first place. These two lines are that condition.
# The gamemode cannot do this job instead: EquipmentBinding has a Get and no
# Set, so the server can read what somebody is wearing and cannot write it.
<#
  NOTHING IN THE WORLD COMES BACK, EXCEPT THE THINGS THAT GROW.

  Patrick, 21 September: "even the stuff in the containers that start in them
  should be once only and same wih on the ground so it doesnt respawn and isnt
  infinites (Except for the thigs that hang like the meats, garlic, elves ears,
  etc.)".

  Nothing the world placed lies on the floor (Thornswood-Last.esp switches it
  off, #3077), and a container starts empty (forbiddenBaseContainer, below).
  What the gamemode cannot do from inside is stop the ENGINE putting
  everything back an hour later.
  MpObjectReference::GetRelootTime returns an hour for CONT, an hour for anything
  espm::utils::IsItem calls an item, and an hour for FLOR and TREE. So a chest
  emptied of its bread refills with bread at teatime, for ever, and that is an
  infinite supply of everything the gamemode does NOT take out.

  RequestReloot returns early when the base type is in forbiddenReloot, so this
  is the switch and there is no other.

  WHICH TYPES, AND THE MEASUREMENT THAT MADE THE EXCEPTION SAFE. Every
  harvestable this server knows about was looked up by record type on
  21 September, all 146 of them across the four tables in game\data\harvests.json:

      the hanging game     7 bases, every one FLOR
      plants and harvests  109 bases, 69 FLOR and 40 TREE
      crops                15 bases, 11 TREE and 4 FLOR
      fish                 15 bases, every one FLOR

  Not one of them is anything else. So FLOR and TREE are exactly the things
  Patrick wants to keep coming back, and everything he wants to stop is a
  different type. The exception is not a list of forms anybody has to maintain:
  it is the two types left out of the line below.

  The item types are the ones IsItem covers, which is what the engine itself
  reloots on an hour, written out here rather than inferred so that a reader can
  see what is in the list without reading espm.
#>
$s | Add-Member -NotePropertyName forbiddenReloot -NotePropertyValue @(
    'CONT',
    'WEAP', 'ARMO', 'AMMO', 'MISC', 'ALCH', 'INGR', 'BOOK', 'SLGM', 'SCRL',
    'LIGH', 'KEYM', 'NOTE'
) -Force
<#
  A CONTAINER STARTS EMPTY (#3078). Patrick, 21 October 2026: "not fill them
  with anything vannilla onky our speacil ones for the caves with our items abd
  refill times, and dont fill any storages that shouldnt be filled".

  MpObjectReference::EnsureBaseContainerAdded copied a container's plugin
  contents (CNTO, leveled lists rolled) in on the first press. With CONT named
  here it returns before reading the record, so every chest, barrel, sack and
  cupboard in the world holds only what a person put in it, or the pile the
  dungeon loot block pays. CONT only: an actor's base is NPC_, so what an NPC
  carries and wears is the engine's as before. Needs the fork at
  thornswood/engine-changes with skymp#96 or later; an older server ignores
  the key and fills containers again.
#>
$s | Add-Member -NotePropertyName forbiddenBaseContainer -NotePropertyValue @('CONT') -Force
$s | Add-Member -NotePropertyName equipmentSlotCheckEnabled  -NotePropertyValue $false -Force
$s | Add-Member -NotePropertyName equipmentSpellCheckEnabled -NotePropertyValue $false -Force
# The third one, and the one the live log actually shows firing. Measured on
# 20 September: 24 refusals over two days, every one of them the same item,
# 0x13790 IronWarAxe, on every character seconds after spawning. Skyrim
# Unbound hands out starting gear inside the client's own game and the server
# never sees it happen, so the first equipment update a new character sends
# names an item the server has no record of. Upstream throws the WHOLE update
# away for that, so the equipment record stays empty all session, and on the
# next spawn the client empties the pack and refills it from that empty record.
# Off, the unknown item is dropped and the rest of the update is kept.
$s | Add-Member -NotePropertyName equipmentInventoryCheckEnabled -NotePropertyValue $false -Force
# The one equipment switch that is ON (#2262). The fork's onEquipItemAttempt
# (skymp#73) asks the gamemode about each item an equipment update puts on that
# the saved record does not already have on, before the update is stored, and
# takes off only an item it answers false to. The gamemode's strength gate
# answers it: a weapon heavier than the character's Might can wield is refused
# there, and nothing invalid is ever saved. Off, the engine never asks, which
# is the fork's default. With no handler in the gamemode the event answers
# nothing and every item stands. Needs the fork at thornswood/engine-changes
# b109bbac or later; an older server ignores the key.
$s | Add-Member -NotePropertyName equipItemAttemptEnabled -NotePropertyValue $true -Force
<#
  NO "default" KEY INSIDE npcSettings, EVER. It emptied both worlds.

  ScampServer.cpp reads npcSettings.default for the two flags, and then ALSO
  puts every key of npcSettings, "default" included, into the per-plugin map.
  WorldState::IsNpcAllowed walks that map looking for each key among the
  loaded plugin file names, and returns false the moment a key is not one. No
  plugin is called "default", so every NPC in every plugin was refused before
  its flags were ever read. Measured 28 September with the server binary
  itself (scam_native.node) over the Skyrim.esm and Update.esm form range:
  npcSettings {} loads 6015 actors, {"default": {both true}} loads 0,
  {"default": {interior only}} loads 0. Patrick, 28 September: "NPCs are
  actually not working right now for some reason and they should be".

  So the shape written here is one the engine reads the way it is meant:
    -Npcs all       {}, no overrides, which is every NPC everywhere
    -Npcs interior  one entry per plugin in this load order, inside only
                    (the same measurement: 2498 actors, all of them indoors)
    -Npcs off       {}, and npcEnabled false above does the work
  Every key has to be a file name exactly as the load order spells it,
  because one key that is not a loaded plugin refuses everything again.
#>
$npcTable = [ordered]@{}
if ($Npcs -eq 'interior') {
    foreach ($p in $paths) {
        $npcTable[[IO.Path]::GetFileName($p)] = [pscustomobject]@{ spawnInInterior = $true; spawnInExterior = $false }
    }
}
$s | Add-Member -NotePropertyName npcSettings -NotePropertyValue ([pscustomobject]$npcTable) -Force
Write-Host ("  NPCs: $Npcs (npcEnabled $($Npcs -ne 'off'), {0} per-plugin entries, no default key)" -f $npcTable.Count) -ForegroundColor DarkGray

<#
  What a blow is worth. See -HitsOnPeople and -HitsOnNpcs above.

  This key was absent from every settings file this repo has ever written, so
  the server logged "Unable to get multiplier from config" at startup and
  doubled every blow landed on a person, and nobody knew. Writing it is the
  whole of the fix for the first half of Patrick's sentence; the second half
  needs the fork built, because playerMultiplier is ours.
#>
$s | Add-Member -NotePropertyName damageMultFormulaSettings -NotePropertyValue ([pscustomobject]@{
    multiplier       = $HitsOnPeople
    playerMultiplier = $HitsOnNpcs
}) -Force

Write-Host ("  damage: an NPC hitting a person x{0}, a person hitting an NPC x{1}" -f $HitsOnPeople, $HitsOnNpcs) -ForegroundColor DarkGray
# Where a brand new character first appears, which is also where the gamemode
# runs character creation. Skyrim Unbound's own creation room is the right
# answer on this setup: a new game already puts everybody there, so the client
# and the server agree from the first frame instead of arguing about it. The
# Whiterun gate this used to point at was the published SkyMP spawn, and it is
# still the fallback, but it is outdoors and half a world away from where the
# client actually starts.
#
# The form id is computed rather than written down. SkyMP resolves
# fileIdx * 0x01000000 + shortFormId, so a literal would rot the moment the
# load order moved. fileIdx is the plugin's place among the full plugins of
# this array: every plugin in it, until an engine that loads light plugins
# lists them too, and they take no full index (#1715).
$hallPlugin = 'Skyrim Unbound.esp'
$hallLocal  = 0x19BAD4                      # SkyrimUnboundRoom01
$lightName = $null
if ($loadsLight) { $lightName = { param($n) [bool]($info[$n] -and $info[$n].Light) } }
$hallIdx = Get-ThornswoodFullIndex ([string[]]$paths) $lightName $hallPlugin
if ($hallIdx -ge 0) {
    $hallId = ($hallIdx * 0x01000000) + $hallLocal
    $start = [pscustomobject]@{
        pos = @(3755.7, -495.7, -207.7); worldOrCell = ('0x{0:X8}' -f $hallId); angleZ = 180
    }
    $startNote = "the Unbound creation room, $hallPlugin at index $hallIdx, form 0x{0:X8}" -f $hallId
} else {
    $start = [pscustomobject]@{
        pos = @(22659, -8697, -3594); worldOrCell = '0x1a26f'; angleZ = 268
    }
    $startNote = "Whiterun's main gate; $hallPlugin is not in the load order"
}
$s | Add-Member -NotePropertyName startPoints -NotePropertyValue @($start) -Force

# Set-Content -Encoding UTF8 writes a byte order mark under Windows PowerShell
# 5.1 and does not under PowerShell 7, so the same line produces a different
# file depending on which one happens to run it. A BOM is not JSON: node stops
# on the first character with "Unexpected token", the server never starts, and
# nothing about the message points at the file that was written three steps
# earlier. WriteAllText with an explicit encoding is the same in both.
[IO.File]::WriteAllText($settingsPath, ($s | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))

Write-Host ("server-settings.json  {0} plugins, name '{1}', port {2}, NPCs server-side" -f $paths.Count, $ServerName, $Port) -ForegroundColor Cyan
Write-Host '  the gear strip and the spell strip are both off, so what you wear and what you have learned stay on' -ForegroundColor DarkGray
Write-Host ("  new characters start at {0}" -f $startNote) -ForegroundColor DarkGray

if ($FullLoadOrder) {
    Write-Host '  -FullLoadOrder: indices will NOT match the game. Diagnostic use only.' -ForegroundColor Yellow
} elseif ($loadsLight) {
    Write-Host ("  {0} light plugin(s) listed, light index 0 to {1}: the engine this build records loads them (lightPlugins in {2})" -f $so.Light.Count, ($so.Light.Count - 1), $serverRecord) -ForegroundColor DarkGray
} elseif ($lightCount) {
    Write-Host ("  {0} light plugin(s) left out so the indices match the game exactly" -f $lightCount) -ForegroundColor DarkGray
    foreach ($k in ($pruned.Keys | Sort-Object)) {
        Write-Host ("      also {0}, which masters to {1}" -f $k, $pruned[$k]) -ForegroundColor DarkGray
    }
}
$i = Get-ThornswoodFullIndex ([string[]]$paths) $lightName 'Thornswood-Content.esp'
if ($i -lt 0) {
    Write-Host '  WARNING: Thornswood-Content.esp is not in the load order. The stations will not resolve.' -ForegroundColor Red
} else {
    Write-Host ("  Thornswood-Content.esp at index {0} (0x{1:X2})" -f $i, $i) -ForegroundColor DarkGray
}

Write-Host ''
