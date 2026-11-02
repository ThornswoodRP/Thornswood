<#
  Publish-Server.ps1

  Run this ON YOUR LAPTOP. It packs the server, sends it to the VPS, installs it
  there and checks it came up. One command instead of six, and no RDP session.


  What it does, in order:
    0. refuses, naming each file, when anything it would send out of this
       repository has uncommitted changes (#1121)
    1. builds the payload zip from your local dist\server, refusing any
       server file (the binary, the JavaScript half, the rest the fork
       builds) that is not the build records\server-build.json names, and
       puts that record in the zip; the zip is read back and held the same
       way before it is sent (#1214)
    2. copies the zip across, with the server still running
    3. the installer unpacks it BESIDE the running server, gives it the
       running server's own settings with only the release's keys from the
       zip (ServerSettings.ps1, #1222), checks it there (the zip's hash, every
       plugin in the load order, gamemode.js parsing, every server file
       against its record, ServerBuild.ps1) and stops nothing if any of it
       fails
    4. only then stops the server, swaps the new folder in, registers the
       boot task and starts it; if it does not answer on its ports, the
       previous folder goes back and is started again (issue #446)
    5. once the installer has said INSTALL OK, records on the box what the
       server now runs (#459): the server build it installed goes to the
       store as an artifact with a name, read out of the payload
       (ServerArtifact.ps1), the gamemode artifact goes to the store, the
       box holds the installed gamemode.js and its build stamp to it, and the
       record goes into data\thornswood-deploy.json and the store's current
       record; then the engine commit the root's server-build.json names goes
       into the site's deployed-build.json (DeployedBuild.ps1), for the
       credits page (#2303). A record that cannot be written stops the run
       with exit 1, the server up.
    6. tries the resources port once, from here (#2975): the box has
       already had it answer, so this is the try a firewall rule shows up in

  The gamemode in the payload is game\gamemode.js as the commit holds it, the
  gamemode artifact (Artifact.ps1), and its build stamp (thornswood-build.json,
  BuildStamp.ps1) is made for the channel this publishes to, beside the
  artifact rather than in the build. A payload whose gamemode is not that
  artifact's, or whose stamp does not describe it for this channel (a
  -SkipBuild zip from an older commit), is refused before anything is sent.

  The world folder on the VPS is carried across reinstalls by the installer,
  so characters made on the server survive an update. -FreshWorld starts the
  server with none, and leaves the old one in the previous folder.

  The previous folder is kept beside the root, the newest two, and
      .\scripts\release\Publish-Server.ps1 -PutBack
  puts the newest back the same checked way (-Channel dev for the dev server),
  and records the folder that came back by its own record (#459).

  THE TASK ALONE (#2491).
      .\scripts\release\Publish-Server.ps1 -TaskOnly
  sends the installer and nothing to install, and the installer registers the
  server's scheduled task again with its own action and settings, stops the
  server and starts it through the new task (Install-ThornswoodServer.ps1
  -TaskOnly). No zip, no file in the server's folder but the log writer the
  task runs (server-log.js, #2349), no setting, no record and no news: it is how the box takes a change to the task itself, the
  priority it starts node at (#2491), without a release. If the server does
  not answer under the new task, the task it had goes back and is started.
  -Channel dev for the dev server. It drops whoever is on that server, so
  look at its online.json first.

  THE JOIN PASS SWITCH (#1804). The installer refuses, before anything is
  stopped, a server whose thornswoodRequirePass is neither true nor false,
  because the gamemode reads that as on (#1319), and says so. A first
  install always is such a server, since no build carries the switch (#1223).
      .\scripts\release\Publish-Server.ps1 -RequirePass on
  sets it on the server in that publish (off lets a session act until its
  pass arrives); without it the running server keeps its own.

  THE BUILD IT PACKS (#459; the same defect #2309 found in
  Deploy-DevGamemode -LoadOrder). A publish packs a built server: the binary
  and the rest the fork builds, from an engine build's dist\server. -Dist
  names it. Left out, it is this checkout's own engine build (Where.ps1
  ServerDist), never another folder. This script runs only from a clean
  checkout at origin (#2118), which on the shipping machine is a fresh
  worktree with no engine build, so there -Dist is how the build is named:
      .\scripts\release\Publish-Server.ps1 -Channel dev -Dist <the build's dist\server>
  With no built server at -Dist it stops before anything is copied, built or
  sent, and says so. Whatever -Dist names, its server files are held to
  records\server-build.json before anything leaves (Export-ServerPayload and
  the zip read below), so a build of another engine commit is refused. The
  publish copies the commit's gamemode.js into that build and sets how many
  it holds in its server-settings.json, as it always has; the build is
  otherwise read, not changed.

  FROM THE STORE, WITH NO ENGINE BUILD HERE (-FromStore, #459). Since #2467
  every publish and every full Deploy-Server keeps the server build it sends
  in the box's store, C:\Thornswood-Deploys\server, by name. -FromStore puts
  the one records\server-build.json names onto the server from there, so a
  machine with no engine build can publish one:
      .\scripts\release\Publish-Server.ps1 -Channel dev -FromStore
  The payload carries no server build and no plugins: the commit's gamemode
  and its stamp for the channel, the record, how many the server holds
  (records\most-online.json) and any plugin of ours the running load order
  names, from game\content. Before anything is sent the box is asked which
  zip its store keeps for this record, and a publish with none stops there.
  The installer takes that zip's files into its stage, held to the record
  the way a payload's are, and the running server's plugins by its own
  order, and keeps its load order and start point (Install-ThornswoodServer.ps1
  says what it refuses). So it is the engine and the gamemode that move, never
  the order; a new order is Deploy-Gamemode.ps1 and a publish with -Dist.
  A build CI made and the store does not hold yet goes there first, held to
  the record here and again on the box:
      .\scripts\release\Publish-Server.ps1 -Channel dev -FromStore -ServerBuild <the pin's server-<...>.zip>
  A machine that takes CI's engine build (Setup-ShipMachine.ps1 -EngineBuild
  ci, #3047) has no built server to pack, only the files the record names
  and the zip they came in, so there a publish that names no -Dist does this
  by itself, with the zip from Where.ps1 EngineArtifact's artifact\server,
  fetching CI's build of the pin first when it is not there (#3262):
      .\scripts\release\Publish-Server.ps1 -Channel dev

  A LOAD ORDER THAT DROPS PLUGINS (#2320). The installer refuses, before
  anything is stopped, a payload whose load order leaves out a plugin the
  running server loads. On 5 Oct at 9:56 PM a dev publish of a fresh engine
  build carried the engine's own five base masters, because Deploy-Gamemode.ps1
  -Vortex had not yet written the collection's order into that build, and the
  dev server ran 48 plugins before and five after. When a plugin really is
  leaving the collection, name each one:
      .\scripts\release\Publish-Server.ps1 -Channel dev -DropPlugins 'Old Mod.esp'

  It also writes a line into the launcher's News page and pushes it.

  A server change ships nothing. The gamemode runs on the VPS, so there is no
  file for anybody to download and nothing for their launcher to notice, which
  meant every trade kit, every starting town and every fix to creation went out
  with nobody told, while a one line launcher tweak got a headline. Both show up
  in the same place now.

      .\scripts\release\Publish-Server.ps1 "Bards start with instruments"
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$Notes = '',
    [string]$RepoDir,
    # A folder holding the version.json to add the News entry to. Left out,
    # the live feed is received from the VPS store and sent back (#907), the
    # same shape as Set-Server.ps1. See the News section below.
    [string]$ReleaseDir,
    <#
      Which server this goes to. 'main' is the one everybody plays on.

      WHY THIS EXISTS, 21 September. Everything else here has a dev form:
      Ship.ps1 -Channel dev, Deploy-DevGamemode.ps1. This did not, so an
      engine change had one route and that route was live. Patrick, on being
      told that: "why is there no dev version that's a bigggggg issue". He is
      right, and it was worse than missing: the CAPABILITY was always here,
      because -VpsRoot and -TaskName are parameters and the dev server is
      C:\Thornswood-Server-Dev under 'Thornswood Dev Server'. Nothing was
      stopping a dev publish except that nobody could know it without reading
      this block, so the obvious command was the live one and that is the one
      that got run.

      A dev publish also writes no news and pushes nothing, because a news
      entry saying the server changed belongs to the server everybody is on.
    #>
    [ValidateSet('main', 'dev')][string]$Channel = 'main',
    [switch]$NoNews,
    [switch]$NoPush,
    [string]$VpsHost  = '',
    [string]$VpsUser  = '',
    # The built server this packs (an engine build's dist\server). Left out,
    # this checkout's own engine build, and a publish stops before anything
    # when that is not there (THE BUILD IT PACKS in the header). Never another
    # folder by default.
    [string]$Dist     = '',
    # Where the payload zip is made. Left out, this checkout's out folder.
    [string]$Zip      = '',
    [string]$VpsRoot,
    [string]$TaskName,
    [switch]$FreshWorld,
    [switch]$SkipBuild,
    [switch]$NoPause,
    # Put the previous server folder back instead of publishing. Builds and
    # sends nothing but the installer, and writes no news.
    [switch]$PutBack,
    # Register the server's task again and restart it under it, sending
    # nothing to install (#2491, THE TASK ALONE in the header).
    [switch]$TaskOnly,
    # How long the new server has to answer on the box before the previous one
    # goes back. Left off, the shared ceiling in ServerReadyWait.ps1, derived
    # from measured Live and Dev starts (#1938). A start that never answers
    # still rolls back.
    [int]$Wait,
    # The build record the binary is held to (#1214). The repository's own,
    # which the committed check below holds to the commit.
    [string]$Record = '',
    <#
      The ports this run holds the payload and the box to, for the harnesses
      only (#1728). Left at 0, which is how a person shipping runs it, they
      are the channel's, exactly as before: the zip must start the server on
      7787 (dev) or 7777 (live), and the check after the install knocks on the
      resources port, 3000 for 7777 and the game port plus one otherwise.
      tests\test-publish-server-channel.ps1 and tests\test-install-server.ps1
      run beside other builds on the VPS, where the dev and live servers hold
      those very ports, so each takes ports from the system and passes them.
      A payload is built with the channel's port, so -GamePort only matches a
      -SkipBuild zip made for that port; any other zip is refused as before.
    #>
    [ValidateRange(0, 65535)][int]$GamePort = 0,
    [ValidateRange(0, 65535)][int]$ResourcesPort = 0,
    # thornswoodRequirePass for the server this publishes to, set there by the
    # installer (#1804, see the header). Left off, the running server keeps
    # its own, and one with neither true nor false is refused. Live goes on
    # only when Patrick says Main.
    [ValidateSet('', 'on', 'off')][string]$RequirePass = '',
    # The plugins the running server loads that this release's load order may
    # leave out, each by its file name (#2320). Left off, the installer
    # refuses an order that drops any plugin the running server loads, which
    # is what a payload built before Deploy-Gamemode.ps1 -Vortex wrote the
    # collection's order carries: on 5 Oct, the engine's five base masters.
    [string[]]$DropPlugins = @(),
    # Take the server build records\server-build.json names out of the box's
    # store, with no engine build on this machine (#459, FROM THE STORE in the
    # header).
    [switch]$FromStore,
    # A server build zip (server-<...>.zip, with its .json beside it, as
    # Get-EngineArtifact.ps1 makes it) to send to the store first, for -FromStore.
    [string]$ServerBuild = '',
    # Go ahead from a checkout that is not exactly origin/main and clean (#2118). Loud.
    [switch]$AllowStaleCheckout
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

# A stale or dirty checkout sends old or unlanded code; refuse it (#2118).
. (Join-Path $PSScriptRoot '..\deploy\Fresh-Checkout.ps1'); Assert-FreshCheckout -RepoDir (Join-Path $PSScriptRoot '..\..') -What 'Publish-Server' -Target $VpsHost -AllowStale:$AllowStaleCheckout
if (-not $Record) { $Record = Join-Path $PSScriptRoot '..\..\records\server-build.json' }

# The two that the channel decides, unless they were given outright. An
# explicit -VpsRoot still wins, the same way Ship.ps1 lets -Root win.
$IsDev = ($Channel -eq 'dev')
if (-not $PSBoundParameters.ContainsKey('VpsRoot')) {
    $VpsRoot = if ($IsDev) { 'C:\Thornswood-Server-Dev' } else { 'C:\Thornswood-Server' }
}
if (-not $PSBoundParameters.ContainsKey('TaskName')) {
    $TaskName = if ($IsDev) { 'Thornswood Dev Server' } else { 'Thornswood Server' }
}
if ($IsDev) {
    # A dev release is not news and is not a source commit. Said out loud
    # rather than done quietly, so a dev run reads differently from a main one.
    $NoNews = $true
    $NoPush = $true
}

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# Resolved here, not as the parameters' defaults: 5.1 leaves $PSScriptRoot
# empty in an advanced script's defaults (#2229). $DistGiven says whether the
# person named the build, for the refusal below.
$DistGiven = [bool]$Dist
# A machine that takes CI's engine build (Setup-ShipMachine.ps1 -EngineBuild
# ci, #3047) has no built server to pack: CI's artifact holds the server
# files the record names and the zip they came in, never a
# server-settings.json, a load order or a gamemode. So there a publish that
# names no build is one from the store, sending that zip to the store first
# (FROM THE STORE above). On 22 Oct 2026 at 5:37 AM the plain dev publish
# stopped on such a machine, saying engine-ci\670ae74faca5\build\dist\server
# holds no server-settings.json, and was run again by hand with -FromStore
# -ServerBuild and the artifact's zip (#3262). -PutBack and -TaskOnly send
# no build, so they are left as they are.
$CiFromStore = $false
if (-not $DistGiven -and -not $FromStore -and -not $PutBack -and -not $TaskOnly) {
    $buildsFile = & (Join-Path $Here 'Where.ps1') EngineBuilds
    if (Test-Path -LiteralPath $buildsFile) {
        $buildsRec = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($buildsFile)) $buildsFile
        if ($buildsRec -and $buildsRec.PSObject.Properties['ci'] -and $buildsRec.ci -eq $true) { $CiFromStore = $true; $FromStore = $true }
    }
}
# -FromStore packs no build, so it never asks this machine for one (#459).
if (-not $Dist -and -not $FromStore) { $Dist = & (Join-Path $Here 'Where.ps1') ServerDist }
if (-not $Zip)  { $Zip  = & (Join-Path $Here 'Where.ps1') ServerZip }
. (Join-Path $Here '..\vps\Vps.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

# CI's engine build (above): its server zip, fetched first when this machine
# does not have the pin's build yet, the way Sync-Client.ps1 fetches its client.
if ($CiFromStore) {
    $ciDir = & (Join-Path $Here 'Where.ps1') EngineArtifact
    $ciStamp = Join-Path $ciDir 'engine-artifact.json'
    if (-not (Test-Path -LiteralPath $ciStamp)) {
        Say ("this machine takes CI's engine build, and the pin's is not at $ciDir yet, so Get-EngineArtifact.ps1 fetches it") 'Cyan'
        & (Join-Path $Here 'Get-EngineArtifact.ps1') -NoPause
        if ($LASTEXITCODE -ne 0) { Die ("Get-EngineArtifact.ps1 could not fetch CI's engine build of the pin (exit $LASTEXITCODE); its lines above say why. Nothing was sent.") }
    }
    $ciInfo = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($ciStamp)) $ciStamp
    $ciZipName = if ($ciInfo.PSObject.Properties['serverZip']) { [string]$ciInfo.serverZip } else { '' }
    $ciZip = Join-Path (Join-Path (Join-Path $ciDir 'artifact') 'server') $ciZipName
    if (-not $ciZipName -or -not (Test-Path -LiteralPath $ciZip -PathType Leaf)) {
        Die ("$ciStamp names " + $(if ($ciZipName) { $ciZipName } else { 'no server zip' }) + ", and there is none at $ciZip, so CI's server build is not here to send. " +
             "Remove $ciDir and run .\scripts\release\Get-EngineArtifact.ps1 to put it back whole. Nothing was sent.")
    }
    if (-not $ServerBuild) { $ServerBuild = $ciZip }
    Say ('{0,-22} {1}' -f 'engine build', ("CI's, at $ciDir, which has no built server to pack, so this publishes from the store and sends " + $ServerBuild + ' there first')) 'DarkGray'
}

# A put-back sets no setting: the installer puts the previous folder back
# with the running server's own (#1804). Refused before anything is built,
# sent or asked, the way Deploy-Server.ps1 refuses -PutBack with -RequirePass.
if ($PutBack -and $RequirePass) {
    Die '-PutBack sets no setting: it puts the previous server back with the running server''s own settings. Run it without -RequirePass, then a publish with it. Nothing was sent.'
}
if ($PutBack -and @($DropPlugins).Count) {
    Die '-PutBack brings back an order the server ran, so it does not take -DropPlugins. Nothing was sent.'
}
# -FromStore deploys a build out of the store onto a running server, keeping
# its load order (#459); none of these goes with it.
if ($ServerBuild -and -not $FromStore) {
    Die '-ServerBuild sends a server build to the store for -FromStore to publish. Give -FromStore with it. Nothing was sent.'
}
if ($FromStore -and ($PutBack -or $TaskOnly)) {
    Die '-FromStore publishes a server build out of the store; -PutBack and -TaskOnly publish none. Nothing was sent.'
}
if ($FromStore -and ($DistGiven -or $SkipBuild)) {
    Die '-FromStore packs no build: the server build comes out of the store on the box. Run it without -Dist and -SkipBuild. Nothing was sent.'
}
if ($FromStore -and @($DropPlugins).Count) {
    Die '-FromStore keeps the running server''s load order, so it drops no plugin. A new order is Deploy-Gamemode.ps1 and a publish with -Dist. Nothing was sent.'
}
# The task alone changes no file, setting or world (#2491).
if ($TaskOnly -and ($PutBack -or $RequirePass -or @($DropPlugins).Count -or $FreshWorld)) {
    Die '-TaskOnly registers the server''s task again and changes nothing else, so it does not go with -PutBack, -RequirePass, -DropPlugins or -FreshWorld. Nothing was sent.'
}

$target = "$VpsUser@$VpsHost"
# Host key checking on (issue #450): ssh talks only to the box whose key
# Setup-SshKey.ps1 wrote into known_hosts, checked against vps.json.
$ssh = @('-o', 'StrictHostKeyChecking=yes')

# ---------------------------------------------------------------- tools ------
foreach ($t in 'ssh', 'scp') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
        Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client."
    }
}

# -------------------------------------------------------- committed only ----
# A publish sends a commit or nothing (Patrick, 29 Sep, #1121). The files it
# takes out of this repository are the installer and the log writer, sent
# every time, and for a publish the gamemode it copies into the build and the
# number of people records\most-online.json puts in the settings. Any of them
# with uncommitted changes, or untracked, refuses it here, naming each, before
# anything is built or the box is asked anything. There is no switch past it.
. (Join-Path $Here '..\deploy\Artifact.ps1')
# The server build as an artifact the store keeps by name (#459).
. (Join-Path $Here '..\deploy\ServerArtifact.ps1')
# What engine each server runs, for the site's credits page (#2303).
. (Join-Path $Here '..\deploy\DeployedBuild.ps1')
$committedOnly = @('scripts/deploy/Install-ThornswoodServer.ps1', 'scripts/deploy/ServerSettings.ps1', 'scripts/deploy/ServerBuild.ps1', 'scripts/deploy/ServerReadyWait.ps1', 'scripts/vps/Server-Log.js', 'scripts/release/Read-JsonFile.ps1', 'scripts/release/RecordShape.ps1')
if (-not $PutBack -and -not $TaskOnly) { $committedOnly += 'game/gamemode.js', 'records/most-online.json', 'records/server-build.json' }
# -FromStore sends our plugins from game\content (#459), all but
# Thornswood-Last.esp, which no machine sends: it is made on the box from its
# recipe (#2791), and the manifest names the bytes the server must hold.
. (Join-Path $Here 'RepoPlugins.ps1')
. (Join-Path $Here '..\deploy\LastPluginRecipe.ps1')
if ($FromStore) { $committedOnly += @($ThornswoodRepoPlugins | Where-Object { $_ -ine $ThornswoodLastPlugin } | ForEach-Object { 'game/content/' + $_ }) + 'game/data/last-plugin.json' }
try { Assert-ThornswoodCommitted -RepoDir (Join-Path $Here '..\..') -Paths $committedOnly -What 'this publish' }
catch { Die $_.Exception.Message }

# ------------------------------------------------------------- installer ----
# Sent every time rather than trusting whatever copy is up there, so the VPS
# never runs a version of the installer older than the payload it is unpacking.
$installer = Join-Path $Here '..\deploy\Install-ThornswoodServer.ps1'
if (-not (Test-Path -LiteralPath $installer)) { Die "not found: $installer" }
# Beside the installer, which puts it in the server's folder for the task to
# run the server under: it writes server.log, rolls it at midnight and keeps
# no line past 30 days (#2349). See Server-Log.js.
$serverLog = Join-Path $Here '..\vps\Server-Log.js'
if (-not (Test-Path -LiteralPath $serverLog)) { Die "not found: $serverLog" }
# And ServerSettings.ps1 beside it, which says which settings come from the
# payload and which stay the running server's (#1222). The installer refuses
# without it rather than put the build's settings over the server's.
$settingsLib = Join-Path $Here '..\deploy\ServerSettings.ps1'
if (-not (Test-Path -LiteralPath $settingsLib)) { Die "not found: $settingsLib" }
# And ServerBuild.ps1, which says which server files the record holds and
# holds them (#1214), here to the zip and there to the stage.
$buildLib = Join-Path $Here '..\deploy\ServerBuild.ps1'
if (-not (Test-Path -LiteralPath $buildLib)) { Die "not found: $buildLib" }
. $buildLib
# How long a start may take to answer on both ports (#1938). The installer
# loads it from beside itself on the box, so it goes up with the others.
$waitLib = Join-Path $Here '..\deploy\ServerReadyWait.ps1'
if (-not (Test-Path -LiteralPath $waitLib)) { Die "not found: $waitLib" }
. $waitLib
# And the record contracts (#2180, slice 4), which the installer holds the
# payload's settings and server-build.json to. It refuses without them.
$shapeLibs = @((Join-Path $Here 'Read-JsonFile.ps1'), (Join-Path $Here 'RecordShape.ps1'))
foreach ($f in $shapeLibs) { if (-not (Test-Path -LiteralPath $f)) { Die "not found: $f" } }
function Send-ShapeLibs([string]$Why) {
    foreach ($f in $shapeLibs) {
        Invoke-ThornswoodNative { & scp @ssh $f ("${target}:C:/" + (Split-Path -Leaf $f)) }
        if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. $Why" }
    }
}
if (-not $PSBoundParameters.ContainsKey('Wait')) {
    $Wait = Get-ThornswoodServerReadyWait
}

# What the installer said, printed as it comes, and its last line read: it
# ends with INSTALL OK, INSTALL REFUSED, INSTALL ROLLED BACK or INSTALL FAILED.
function Invoke-Installer([string]$instArgs) {
    $lines = @(Invoke-ThornswoodNative { & ssh @ssh $target "pwsh -NoProfile -ExecutionPolicy Bypass -File C:\Install-ThornswoodServer.ps1 $instArgs" } |
               ForEach-Object { Say "  $_"; "$_".Trim() })
    $code = $LASTEXITCODE
    if ($lines -contains 'INSTALL OK' -and $code -eq 0) { return }
    if ($lines -contains 'INSTALL REFUSED') {
        # A refusal can come after the stop (a folder that would not move,
        # #5211), when the installer starts the old server again, so this
        # says only what is always true and leaves the rest to its lines.
        Die "the installer refused, so nothing new was installed and the server up there runs what it ran before. The lines above say why, and whether it was stopped and started again."
    }
    if ($lines -contains 'INSTALL ROLLED BACK') {
        Die "the new server did not answer, or its settings did not read back as the server's own, so the installer put the previous one back. The lines above say which, and whether it answers."
    }
    Die "the installer on the VPS exited with $code and did not say it finished. THE SERVER MAY BE DOWN: look at $VpsRoot and the folders beside it before anything else."
}

# What the box records once the installer has said INSTALL OK (#459, #2303),
# which is the new server answering on both its ports. A publish sends the
# gamemode artifact to the store and has the box hold the installed gamemode
# and its stamp to it before the record is written; a put-back records the
# folder that came back by its own record (Artifact.ps1 says how). Then the
# engine the root's server-build.json names goes to the site for the credits
# page, which never fails a run (DeployedBuild.ps1). A deploy record that is
# not written stops the run with the server up, the way a dev door that was
# not carried does (#1336): it is the one thing on the box that says which
# gamemode it runs, and left alone it names the one that ran before.
function Save-ServerRecords([switch]$PutBack) {
    $lines = @()
    try {
        if ($PutBack) {
            $lines = @(Restore-ThornswoodServerRecord -Target $target -SshArgs $ssh -Root $VpsRoot)
        } else {
            # -FromStore's build is the store's already (#459).
            if (-not $FromStore) { Send-ThornswoodArtifact -Artifact $serverArtifact -Target $target -SshArgs $ssh }
            Send-ThornswoodArtifact -Artifact $artifact -Target $target -SshArgs $ssh
            $lines = @(Set-ThornswoodServerRecord -Artifact $artifact -Target $target -SshArgs $ssh -Root $VpsRoot)
        }
    } catch { $lines = @('SERVER NOT RECORDED: ' + $_.Exception.Message) }
    if (-not @($lines | Where-Object { "$_" -like 'SERVER RECORDED *' }).Count) {
        foreach ($l in $lines) { Say "  $l" 'Red' }
        Die ("the server is installed and answering, but the box's record of what it runs was not written, so its data\thornswood-deploy.json " +
             "and the store's current record still name what ran before. The lines above say why. Put that right, then run this again.")
    }
    $null = Save-ThornswoodDeployedBuild $target $ssh $VpsRoot (Get-ThornswoodDocsRootBeside $VpsRoot)
}

# The installer and the files it loads, sent alone, before a run that
# sends no zip (-TaskOnly and -PutBack).
function Send-InstallerOnly {
    Invoke-ThornswoodNative { & scp @ssh $installer "${target}:C:/Install-ThornswoodServer.ps1" }
    if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. Nothing up there was changed." }
    Invoke-ThornswoodNative { & scp @ssh $serverLog "${target}:C:/Server-Log.js" }
    if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. Nothing up there was changed." }
    Invoke-ThornswoodNative { & scp @ssh $settingsLib "${target}:C:/ServerSettings.ps1" }
    if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. Nothing up there was changed." }
    Invoke-ThornswoodNative { & scp @ssh $buildLib "${target}:C:/ServerBuild.ps1" }
    if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. Nothing up there was changed." }
    Invoke-ThornswoodNative { & scp @ssh $waitLib "${target}:C:/ServerReadyWait.ps1" }
    if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. Nothing up there was changed." }
    Send-ShapeLibs 'Nothing up there was changed.'
}

# ------------------------------------------------------------- -TaskOnly ----
# The installer and the files it loads go up, as for a put-back, and it
# registers the task again and restarts the server under it (#2491). Nothing
# in the server's folder changes, so there is no record to write.
if ($TaskOnly) {
    Head ('Registering the task again: ' + $TaskName)
    Send-InstallerOnly
    Invoke-Installer "-Root '$VpsRoot' -TaskName '$TaskName' -StartNow -TaskOnly -Wait $Wait"
    Say 'the task is registered again and the server answers under it' 'Green'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ------------------------------------------------------------- -PutBack -----
if ($PutBack) {
    Head 'Putting the previous server back'
    Send-InstallerOnly
    Invoke-Installer "-Root '$VpsRoot' -TaskName '$TaskName' -StartNow -PutBack -Wait $Wait"
    Say 'the previous server is back and answering up there' 'Green'
    Save-ServerRecords -PutBack
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ------------------------------------------------------- the build it packs ---
# THE BUILD IT PACKS (#459, the same defect as #2309). See the header. A
# publish packs a built server, so with none at $Dist it stops here, before
# the gamemode is copied, the settings are read or anything is built or sent,
# and says how to name one. Until 12 Oct a missing build skipped the gamemode
# copy and the start point check without a word and stopped later inside
# Export-ServerPayload with "server dist not found", which named neither
# -Dist nor the build the record wants.
# The record names the build, so one that is there and does not read stops
# the publish here, before anything is built or sent, and says why (#2711).
# Until 18 Oct it was read in a try with an empty catch, and the refusal came
# only after the payload was built. No record is refused where it is copied.
$recCommit = ''
if (Test-Path -LiteralPath $Record) {
    $recFirst = $null
    try { $recFirst = [IO.File]::ReadAllText($Record) | ConvertFrom-Json }
    catch { Die ("$Record does not read (" + $_.Exception.Message + "), so nothing says which build is to go. Nothing was built or sent.") }
    if ($recFirst -and $recFirst.PSObject.Properties['source'] -and $recFirst.source -and $recFirst.source.PSObject.Properties['commit']) { $recCommit = [string]$recFirst.source.commit }
}
$recShort = if ($recCommit.Length -ge 8) { $recCommit.Substring(0, 8) } else { 'the one it names' }
$distWhy = ''
if ($FromStore) { }
elseif (-not (Test-Path -LiteralPath $Dist -PathType Container)) { $distWhy = "there is no built server at $Dist" }
elseif (-not (Test-Path -LiteralPath (Join-Path $Dist 'server-settings.json'))) { $distWhy = "$Dist holds no server-settings.json, so it is not a built server" }
if ($distWhy) {
    $nl = [Environment]::NewLine
    if ($DistGiven) {
        Die ($distWhy + '. -Dist names the engine build''s dist\server to pack. Nothing was built or sent.')
    }
    Die ($distWhy + ', which is this checkout''s own engine build. A publish packs a built server, and a fresh checkout has none: the' + $nl +
         'deploy guard lets this run only from a clean checkout at origin (#2118), and the engine is built in another folder.' + $nl +
         'Name that build:' + $nl +
         '    .\scripts\release\Publish-Server.ps1 -Channel ' + $Channel + ' -Dist <the engine build''s dist\server>' + $nl +
         'Its server files must be the build records\server-build.json names (engine ' + $recShort + '); that is checked before anything is sent.' + $nl +
         'Or, with no engine build here, put the recorded one on from the store on the box:' + $nl +
         '    .\scripts\release\Publish-Server.ps1 -Channel ' + $Channel + ' -FromStore' + $nl +
         'Nothing was built or sent.')
}
if ($FromStore) { Say ('{0,-22} {1}' -f 'server build', ('from the store on the box, the build records\server-build.json names (engine ' + $recShort + ')')) 'DarkGray' }
else { Say ('{0,-22} {1}' -f 'built server', $Dist) 'DarkGray' }

# ------------------------------------------------------------- gamemode ------
# The gamemode is edited in game\ and packaged from dist\server. Those are two
# different files, and for a whole evening every change went into the first one
# while every publish shipped the second: the race menu fix, the launcher
# choices, the removal of the books, none of it ever reached the server, and
# nothing said so because both files existed and both looked right.
#
# Copied here rather than left to a separate script somebody has to remember.
#
# From the gamemode artifact (#459, Artifact.ps1): game\gamemode.js as the
# commit holds it, in one zip named by commit and hash, the same artifact
# Deploy-Server.ps1 sends. Its bytes are git's, so a checkout's line endings do
# not come into it, and the record written on the box once the install answers
# names it. Built here, after the committed check above, so it is the commit.
# Its tables (#5191) are in the artifact with it: the gamemode reads them from
# the gamemode-tables folder beside it as it loads, and a load without them stops.
$artifact = New-ThornswoodArtifact -Component gamemode -RepoDir (Join-Path $Here '..\..') -Paths 'game/gamemode.js', 'game/gamemode-tables'
Say ('{0,-22} {1}' -f 'gamemode artifact', (Format-ThornswoodArtifact $artifact)) 'DarkGray'
$gmSrc = Join-Path $artifact.Folder 'game\gamemode.js'
$gmSha = (Get-FileHash -LiteralPath $gmSrc -Algorithm SHA256).Hash.ToLowerInvariant()
. (Join-Path $Here '..\deploy\GamemodeId.ps1')
$tablesSrc = Join-Path $artifact.Folder 'game\gamemode-tables'
$tablesTree = Get-ThornswoodTablesTree $tablesSrc
if (-not $tablesTree) { Die "the gamemode artifact holds no game\gamemode-tables, and the gamemode reads its tables from there (#5191). Nothing was sent." }
# Each table's sha256 by name, what the payload's gamemode-tables has to hold.
$tableSums = @{}
foreach ($t in @(Get-ThornswoodTableFiles $tablesSrc)) { $tableSums[$t.Name] = (Get-FileHash -LiteralPath $t.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
Say ('{0,-22} {1} tables, git tree {2}' -f 'gamemode-tables', $tableSums.Count, $tablesTree) 'DarkGray'
# Copies the artifact's tables into a server folder, as the whole folder, so a
# table the commit no longer has does not stay behind in it.
function Copy-GamemodeTables([string]$into) {
    $to = Join-Path $into 'gamemode-tables'
    if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Recurse -Force }
    $null = [IO.Directory]::CreateDirectory($to)
    foreach ($t in @(Get-ThornswoodTableFiles $tablesSrc)) { Copy-Item -LiteralPath $t.FullName -Destination (Join-Path $to $t.Name) }
}
# -FromStore has no build to copy it into: the payload takes the artifact's own.
if (-not $FromStore -and (Test-Path -LiteralPath $Dist)) {
    $gmDst = Join-Path $Dist 'gamemode.js'
    $dstHash = if (Test-Path -LiteralPath $gmDst) {
        (Get-FileHash -LiteralPath $gmDst -Algorithm SHA256).Hash.ToLowerInvariant()
    } else { '' }
    if ($gmSha -ne $dstHash) {
        Head 'Gamemode'
        Copy-Item -LiteralPath $gmSrc -Destination $gmDst -Force
        Say ("copied the artifact's game\gamemode.js into the build ({0:N0} bytes)" -f (Get-Item -LiteralPath $gmDst).Length) 'Green'
    }
    if ((Get-ThornswoodTablesTree (Join-Path $Dist 'gamemode-tables')) -ne $tablesTree) {
        Head 'Gamemode tables'
        Copy-GamemodeTables $Dist
        Say ("copied the artifact's game\gamemode-tables into the build ({0} tables, git tree {1})" -f $tableSums.Count, $tablesTree) 'Green'
    }
}
# Its build stamp, for the channel this goes to, beside the artifact and not
# in the build: a dev stamp left in the build would go out with the next live
# Deploy-Server, the way the dev ports once did (#1114). Export-ServerPayload
# packs it as thornswood-build.json (-Stamp). Until #459 a publish packed
# whatever stamp the build had, or none, so a fresh build installed with
# nothing in the root saying which gamemode it runs.
$stampPath = [IO.Path]::ChangeExtension($artifact.Zip, ".$Channel-build.json")
if (-not $SkipBuild) {
    . (Join-Path $Here 'BuildStamp.ps1')
    $null = Save-ThornswoodBuildStamp -Gamemode $gmSrc -Channel $Channel -RepoDir (Join-Path $Here '..\..') -Path $stampPath -Artifact $artifact
    Say ('{0,-22} {1}' -f 'thornswood-build.json', (Format-ThornswoodBuildStamp (ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $stampPath -Raw) $stampPath))) 'DarkGray'
}

# --------------------------------------------------- where new characters go --
# The start point is a raw form id, and a raw form id rots when the load order
# moves. SkyMP resolves it as fileIdx * 0x01000000 + shortFormId, where fileIdx
# is the load order's own index, so moving one plugin above Skyrim Unbound
# points every new character at a completely different record.
#
# It has rotted before. The id said index 57 while Unbound had drifted to 59,
# so everybody spawned at whatever sat at 0x19BAD4 in a body morph plugin. The
# gamemode noticed they were not in the creation hall and teleported them, and
# from a chair that is character creation starting in a tavern and then
# dragging through a load screen into the hall. Testers reported exactly that
# on 20 September, as creation happening in the Riften inn.
#
# Deploy-Gamemode.ps1 computes this correctly. This script never checked it, so
# a publish that skipped Deploy-Gamemode shipped whatever was last written and
# nothing said a word. The gamemode logs START POINT IS WRONG on boot, to a
# file on the VPS that nobody reads.
#
# Checked rather than recomputed, on purpose. The file being read is the one
# about to be zipped, and a publish that quietly rewrites its own input is
# worse than one that stops and names the command that fixes it.
# -FromStore has no build settings: the server keeps its own load order and
# start point, which the publish that wrote them checked (#459).
$settingsPath = ''
if (-not $FromStore) { $settingsPath = Join-Path $Dist 'server-settings.json' }

<#
  A DEV PUBLISH PACKS THE DEV PORTS, AND ONLY INTO THE PAYLOAD.

  The build's server-settings.json is the LIVE one: port 7777, name
  Thornswood. Unpacked into the dev root unchanged it brings the dev server up
  on the live port, which is what happened the first time this channel was
  run. So Export-ServerPayload.ps1 -Channel dev writes port 7787, voice 7789
  and the name Thornswood Dev into its staged copy, and the zip carries them.

  It used to write them here, into the build's own file, and never put them
  back (#1114): the next live publish packed them and live came up on 7787
  under the dev name. The build is not written for a channel any more, a live
  export refuses settings that are not the live server's, and the zip is read
  back below before it is sent.

  Over a running server none of that reaches it any more (#1222): the
  installer keeps that server's own settings, its switches, npcSettings, ports
  and name, and takes from the zip only the load order, the start point and
  how many it holds (ServerSettings.ps1). The dev values here are for a first
  install into an empty dev root.
#>
<#
  AND HOW MANY IT HOLDS AT ONCE, #481, whichever channel it goes to:
  thornswoodMostOnline for the gamemode and maxPlayers, with the staff seats
  on top, for the engine, from records\most-online.json by way of
  MaxOnline.ps1, the channel's own numbers (dev's are its dev object since
  12 Oct). Into the DIST copy like the ports above, so what is packed
  carries the one number, and only written when it moved.
#>
if ($settingsPath -and (Test-Path -LiteralPath $settingsPath)) {
    . (Join-Path $PSScriptRoot '..\deploy\MaxOnline.ps1')
    $mostOnline = Get-MostOnline -Channel $Channel
    # The two keys a publish puts over the running server's (ServerSettings.ps1,
    # #1222), so they are the record's number or the publish does not go.
    if ($mostOnline.Value -le 0) { Die ("$($mostOnline.From) gave no number ($($mostOnline.Why)), and a publish sets how many the server holds from it. Nothing was sent.") }
    try {
        $capJson = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $settingsPath -Raw) $settingsPath
        $capWas = [string]$capJson.thornswoodMostOnline + '/' + [string]$capJson.maxPlayers
        Set-MaxPlayers $capJson $mostOnline
        if (([string]$capJson.thornswoodMostOnline + '/' + [string]$capJson.maxPlayers) -ne $capWas) {
            [IO.File]::WriteAllText($settingsPath, ($capJson | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
        }
    } catch {
        throw "Could not set how many the server holds in $settingsPath : $_"
    }
}
if ($settingsPath -and (Test-Path -LiteralPath $settingsPath)) {
    Head 'Where new characters start'
    $hallPlugin = 'Skyrim Unbound.esp'
    $hallLocal = 0x19BAD4                     # SkyrimUnboundRoom01
    $gate = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $settingsPath -Raw) $settingsPath

    # The index a form id is computed from is the plugin's place among the
    # full plugins, which is every entry until the engine the record names
    # loads light plugins and they are listed too (#1715, ServerOrder.ps1).
    . (Join-Path $Here '..\deploy\ServerOrder.ps1')
    $order = [string[]]@($gate.loadOrder)
    $hallIdx = Get-ThornswoodFullIndex $order (Get-ThornswoodLightTest $order $Record) $hallPlugin

    # Written as '0x3A19BAD4' by Deploy-Gamemode, but a hand edit could leave a
    # bare number or bare hex, and reading it wrong would fail this for the
    # wrong reason.
    $have = -1
    $pts = @($gate.startPoints)
    if ($pts.Count -and $null -ne $pts[0].worldOrCell) {
        $raw = ([string]$pts[0].worldOrCell).Trim()
        try {
            if ($raw -match '^0[xX][0-9a-fA-F]+$') { $have = [Convert]::ToInt64($raw.Substring(2), 16) }
            elseif ($raw -match '^[0-9]+$')        { $have = [Convert]::ToInt64($raw, 10) }
            elseif ($raw -match '^[0-9a-fA-F]+$')  { $have = [Convert]::ToInt64($raw, 16) }
        } catch { $have = -1 }
    }

    if ($hallIdx -lt 0) {
        Say "$hallPlugin is not in the load order, so the Whiterun gate fallback applies" 'Yellow'
        Say '  Creation still runs, in a less tidy place. Nothing to fix here.' 'Yellow'
    } elseif ($have -lt 0) {
        Say 'server-settings.json has no readable startPoints entry.' 'Yellow'
        Die 'Run .\scripts\deploy\Deploy-Gamemode.ps1 first, then publish again.'
    } else {
        $want = ($hallIdx * 0x01000000) + $hallLocal
        if ($have -eq $want) {
            Say ("correct: $hallPlugin at index $hallIdx, form 0x{0:X8}" -f $want) 'Green'
        } else {
            Say ("server-settings.json says 0x{0:X8}, and $hallPlugin is at index $hallIdx, which is 0x{1:X8}." -f $have, $want) 'Yellow'
            Say '  Publishing this would put every NEW character in the wrong cell. The' 'Yellow'
            Say '  gamemode would notice and teleport them, which from a chair is' 'Yellow'
            Say '  character creation starting in a tavern instead of the creation hall.' 'Yellow'
            Die 'Run .\scripts\deploy\Deploy-Gamemode.ps1 first, then publish again.'
        }
    }
}

# The port the zip must start on: the channel's, or the harness's (#1728).
$wantPort = if ($GamePort -gt 0) { $GamePort } elseif ($IsDev) { 7787 } else { 7777 }

# ---------------------------------------------------- a payload with no build ---
# -FromStore (#459, the header): the gamemode and its stamp, the record, how
# many the server holds, and our plugins the running order names, so the box
# is asked for that order first. Nothing of a server build goes in.
function New-StorePayload {
    Head 'Packing the payload, with no server build in it'
    . (Join-Path $PSScriptRoot '..\deploy\MaxOnline.ps1')
    . (Join-Path $PSScriptRoot '..\deploy\ServerContent.ps1')
    $mostOnline = Get-MostOnline -Channel $Channel
    if ($mostOnline.Value -le 0) { Die ("$($mostOnline.From) gave no number ($($mostOnline.Why)), and a publish sets how many the server holds from it. Nothing was sent.") }
    $box = Read-ThornswoodServerContent -Channel $Channel -Root $VpsRoot -Target $target -SshArgs $ssh
    if (-not $box.OrderRead) {
        Die ("the $Channel server did not say which load order it runs (it answered: " + ((@($box.Said | Where-Object { $_ }) | Select-Object -Last 3) -join ' | ') +
             "), and -FromStore keeps that order. Nothing was sent.")
    }
    $dir = Join-Path (Split-Path -Parent $Zip) '_payload'
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
    $null = [IO.Directory]::CreateDirectory((Join-Path $dir 'plugins'))
    Copy-Item -LiteralPath $gmSrc -Destination (Join-Path $dir 'gamemode.js')
    Copy-GamemodeTables $dir
    Copy-Item -LiteralPath $stampPath -Destination (Join-Path $dir 'thornswood-build.json')
    Copy-Item -LiteralPath $Record -Destination (Join-Path $dir 'server-build.json')
    # The port is read, not set: the installer keeps the running server's.
    $st = [pscustomobject]@{ port = $wantPort }
    Set-MaxPlayers $st $mostOnline
    [IO.File]::WriteAllText((Join-Path $dir 'server-settings.json'), ($st | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    $ours = @()
    # Thornswood-Last.esp is never sent (#2791): it is made on the box from
    # this commit's recipe. When the running server's is that one, -FromStore
    # keeps it. When it is not, this publish makes it on the box after the
    # copy, from our plugins as this payload carries them and then the
    # server's own, and the installer takes it into the stage held to
    # game\data\last-plugin.json. Waiting for a deploy to make it first could
    # never end when the pin moved too: Deploy-DevGamemode.ps1 sends a
    # gamemode only to a server that already runs this commit's build (#2076).
    $script:LastMake = $null
    $script:LastReads = @()
    $lastWant = Get-ThornswoodLastPluginWant (Join-Path $Here '..\..')
    if ($lastWant -and (@($box.Order) -icontains $ThornswoodLastPlugin)) {
        $boxLast = Get-ThornswoodServerPlugin $box $ThornswoodLastPlugin
        if (-not (Test-ThornswoodContentSame $boxLast $lastWant.Bytes $lastWant.Sha)) {
            $script:LastMake = $lastWant
            Say (("  the $Channel server holds a $ThornswoodLastPlugin of {0:N0} bytes, sha256 {1}, and this commit's recipe makes {2:N0} bytes, sha256 {3}: it will be made on the box" -f $boxLast.Bytes, $(if ($boxLast.Sha) { $boxLast.Sha.Substring(0, 12) } else { 'none' }), $lastWant.Bytes, $lastWant.Sha.Substring(0, 12))) 'Yellow'
        } else {
            Say ("  $ThornswoodLastPlugin is the running server's, the one this commit's recipe makes") 'DarkGray'
        }
    }
    foreach ($n in $ThornswoodRepoPlugins) {
        if ($n -ieq $ThornswoodLastPlugin) { continue }
        $src = Get-ThornswoodRepoPluginPath (Join-Path $Here '..\..') $n
        if (-not (Test-Path -LiteralPath $src)) { continue }
        if (-not (@($box.Order) -icontains $n)) { Say "  $n is ours and the $Channel server's load order does not name it, so it stays out" 'DarkGray'; continue }
        Copy-Item -LiteralPath $src -Destination (Join-Path $dir ('plugins\' + $n))
        $ours += $n
        $script:LastReads += $src
    }
    Say ('  the gamemode artifact and its stamp, the record, how many it holds, and ' + $(if ($ours.Count) { 'our ' + ($ours -join ', ') } else { 'none of our plugins' }) +
         '; the running server keeps its ' + @($box.Order).Count + ' plugins and their order') 'Green'
    if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
    Compress-Archive -Path (Join-Path $dir '*') -DestinationPath $Zip -CompressionLevel Optimal
}

# ---------------------------------------------------------------- build ------
if ($FromStore) { New-StorePayload }
elseif (-not $SkipBuild) {
    Head 'Packing the payload'
    $export = Join-Path $Here 'Export-ServerPayload.ps1'
    if (-not (Test-Path -LiteralPath $export)) { Die "not found: $export" }
    # The same pwsh that is running this (#5356), not whichever one is on
    # PATH.
    $ps = [Environment]::ProcessPath
    # The staging folder beside the zip (out\_payload beside
    # out\thornswood-server.zip, the same as its default).
    & $ps -NoProfile -ExecutionPolicy Bypass -File $export -Dist $Dist -Zip $Zip -VpsRoot $VpsRoot `
        -OutDir (Join-Path (Split-Path -Parent $Zip) '_payload') -Channel $Channel -Record $Record -Stamp $stampPath
    if ($LASTEXITCODE -ne 0) { Die "Export-ServerPayload.ps1 exited with $LASTEXITCODE. The lines above say why." }
}
if (-not (Test-Path -LiteralPath $Zip)) { Die "not found: $Zip. Run without -SkipBuild." }
Say ("payload {0:N1} MB" -f ((Get-Item -LiteralPath $Zip).Length / 1MB)) 'Green'

# The port the zip will really start on, read out of the zip (#1114), so a
# -SkipBuild zip packed for the other channel cannot go to this one either.
$zipPort = ''
# And every server file in it is the recorded build, with the record beside
# them for the installer (#1214), read out of the zip too, so a -SkipBuild zip
# made from another build cannot go either. The record in the zip is this
# repository's own, byte for byte.
$zipSums = @{}
$zipRecSum = ''
$zipWhy = ''
# And its gamemode and the stamp beside it, which the record written on the
# box once it answers will say came from the artifact (#459).
$zipGmSum = ''
$zipStamp = $null
# And its tables (#5191), by name, held to the artifact's.
$zipTableSums = @{}
# And Thornswood-Last.esp, when a full payload carries it from this machine's
# game folder (Export-ServerPayload.ps1), is the one this commit's recipe
# makes (#2791): the launcher made it there, from that machine's plugins.
$zipLastSum = ''
function Get-EntrySum($entry) {
    $zs = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return (-join ($sha.ComputeHash($zs) | ForEach-Object { $_.ToString('x2') })) } finally { $zs.Dispose(); $sha.Dispose() }
}
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $za = [IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        foreach ($ze in $za.Entries) {
            # Compress-Archive under Windows PowerShell 5.1 writes the
            # separators as \, under 7 as /.
            $rel = ConvertTo-ThornswoodServerRel $ze.FullName
            if (-not $ze.Name) { continue }
            if ($rel -eq 'server-settings.json') {
                $zr = New-Object IO.StreamReader($ze.Open())
                try { $zj = $zr.ReadToEnd() | ConvertFrom-Json } finally { $zr.Dispose() }
                if ($zj.PSObject.Properties['port']) { $zipPort = [string]$zj.port }
            }
            elseif ($rel -eq 'server-build.json') { $zipRecSum = Get-EntrySum $ze }
            elseif ($rel -eq 'gamemode.js') { $zipGmSum = Get-EntrySum $ze }
            elseif ($rel -match '^gamemode-tables/([^/]+)$') { $zipTableSums[$Matches[1]] = Get-EntrySum $ze }
            elseif ($rel -eq 'thornswood-build.json') {
                $zr = New-Object IO.StreamReader($ze.Open())
                try { $stampText = $zr.ReadToEnd() } finally { $zr.Dispose() }
                # One that does not parse is refused below as one that says nothing.
                try { $zipStamp = ($stampText -replace '^\uFEFF', '') | ConvertFrom-Json } catch { $zipStamp = $null }
            }
            elseif (Test-ThornswoodServerForkFile $rel) { $zipSums[$rel] = Get-EntrySum $ze }
            elseif ($rel -ieq ('plugins/' + $ThornswoodLastPlugin)) { $zipLastSum = Get-EntrySum $ze }
        }
    } finally { $za.Dispose() }
} catch { $zipWhy = $_.Exception.Message }
if ($zipPort -ne [string]$wantPort) {
    Die ("the payload's server-settings.json starts the server on port " + $(if ($zipPort) { $zipPort } else { 'nothing it says' }) +
         ", and the $Channel server is $wantPort. Nothing was sent. Run it again without -SkipBuild." + $(if ($zipWhy) { " ($zipWhy)" } else { '' }))
}
Say ("payload starts the $Channel server on port $wantPort") 'Green'
$recObj = $null
try { $recObj = [IO.File]::ReadAllText($Record) | ConvertFrom-Json }
catch { Die ("$Record does not read (" + $_.Exception.Message + "), so nothing says which build is to go. Nothing was sent.") }
if (-not $recObj -or -not $recObj.sha256) { Die "$Record cannot be read or names no sha256, so nothing says which build is to go. Nothing was sent." }
$zipBuild = @(Get-ThornswoodServerBuildProblems $recObj $zipSums 'the payload' $Record)
# -FromStore's payload carries none: the build comes out of the store (#459).
if ($FromStore) {
    . (Join-Path $Here 'RecordShape.ps1')   # #2180: a version this checkout knows, every field
    $zipBuild = @(Get-ThornswoodRecordProblems -Doc $recObj -Kind server-build)
    if ($zipSums.Count) { $zipBuild += ('the payload carries server files (' + (@($zipSums.Keys) -join ', ') + '), and -FromStore takes them from the store') }
}
if ($zipBuild.Count) {
    Say 'the payload''s server files are not the recorded build:' 'Red'
    foreach ($w in $zipBuild) { Say "  $w" 'Red' }
    Die ('It is not the recorded build, so nothing was sent. Rebuild the payload from the recorded build, or record this one with .\scripts\release\New-ServerBuildRecord.ps1 and commit that.' +
         $(if ($zipWhy) { " ($zipWhy)" } else { '' }))
}
if ($zipRecSum -ne (Get-FileHash -LiteralPath $Record -Algorithm SHA256).Hash.ToLowerInvariant()) {
    Die ("the payload carries " + $(if ($zipRecSum) { "a server-build.json that is not $Record" } else { 'no server-build.json' }) +
         ", so the installer could not hold the server files to the record. Nothing was sent. Run it again without -SkipBuild.")
}
$lastWant = Get-ThornswoodLastPluginWant (Join-Path $Here '..\..')
if ($zipLastSum -and $lastWant -and $zipLastSum -ne $lastWant.Sha) {
    Die ("the payload's $ThornswoodLastPlugin (sha256 " + $zipLastSum.Substring(0, 12) + ") is not the one this commit's recipe makes (sha256 " + $lastWant.Sha.Substring(0, 12) +
         "), so the server would load another than every launcher makes. Nothing was sent. A full payload takes its plugins from this machine's game folder, and this one holds another copy; -FromStore keeps the server's, which the deploys make on the box.")
}
if ($FromStore) { Say ("payload carries the record of " + ([string]$recObj.source.commit).Substring(0, 8) + " and no server file; the build comes out of the store") 'Green' }
else { Say ("payload server files are the recorded build of " + ([string]$recObj.source.commit).Substring(0, 8) + ", " + $zipSums.Count + " files, and it carries the record") 'Green' }
# The gamemode is the artifact's and its stamp says so, for this channel, or
# the record the box writes after the install would name a gamemode it does
# not run (#459). A -SkipBuild zip packed at an older commit stops here.
if ($zipGmSum -ne $gmSha) {
    Die ("the payload's gamemode.js is " + $(if ($zipGmSum) { 'not' } else { 'missing, so it is not' }) + " game\gamemode.js at " + $artifact.Short +
         ", the commit this publish would record, so the box would run one gamemode and say it runs another. Nothing was sent. Run it again without -SkipBuild.")
}
$tablesOff = @(@($tableSums.Keys) | Where-Object { $zipTableSums[$_] -ne $tableSums[$_] }) + @(@($zipTableSums.Keys) | Where-Object { -not $tableSums.ContainsKey($_) })
if ($tablesOff.Count) {
    Die ("the payload's gamemode-tables are not game\gamemode-tables at " + $artifact.Short + " (" + (($tablesOff | Sort-Object | Select-Object -First 5) -join ', ') +
         "), so the gamemode would load tables its commit does not hold. Nothing was sent. Run it again without -SkipBuild.")
}
$stampSays = if ($zipStamp) { [string]$zipStamp.gamemodeSha256 + '/' + [string]$zipStamp.channel } else { '' }
if ($stampSays -ne ($gmSha + '/' + $Channel)) {
    Die ("the payload's thornswood-build.json " + $(if ($zipStamp) { 'does not describe its gamemode.js for the ' + $Channel + ' server' } else { 'is missing or does not read' }) +
         ", so the server could not say which gamemode it runs. Nothing was sent. Run it again without -SkipBuild.")
}
Say ("payload gamemode is the artifact's, " + $artifact.Short + ", with its stamp for the $Channel server") 'Green'
# The server build it installs, as an artifact with a name (#459,
# ServerArtifact.ps1): the recorded files read out of this zip, so what the
# store keeps is what the server runs. Built here, before anything is sent;
# it goes to the store with the gamemode artifact once the install answers.
if (-not $FromStore) {
    try { $serverArtifact = New-ThornswoodServerBuildArtifact -From $Zip -Record $Record }
    catch { Die ($_.Exception.Message + ' Nothing was sent.') }
    Say ('{0,-22} {1}' -f 'server build artifact', (Format-ThornswoodArtifact $serverArtifact)) 'DarkGray'
} else {
    # -FromStore (#459): a build CI made goes to the store first, held to the
    # record here and by its bytes there; then the box is asked which zip it
    # keeps for this record, and a publish it has none for stops here.
    if ($ServerBuild) {
        Head 'The server build, to the store on the box'
        try {
            $sent = Test-ThornswoodServerBuildArtifact -Zip $ServerBuild -Record $Record
            Say ('{0,-22} {1}' -f 'server build artifact', (Format-ThornswoodArtifact $sent)) 'DarkGray'
            Send-ThornswoodArtifact -Artifact $sent -Target $target -SshArgs $ssh
        } catch { Die ($_.Exception.Message) }
    }
    $stored = $null
    try { $stored = Get-ThornswoodStoredServerBuild -Record $Record -Target $target -SshArgs $ssh } catch { Die ($_.Exception.Message + ' Nothing was sent.') }
    if (-not $stored.Answered) { Die ('the box did not say what its store keeps: ' + ((@($stored.Said | Where-Object { $_ }) | Select-Object -Last 3) -join ' | ') + '. Nothing was sent.') }
    if ($stored.Many) { Die ('the store on the box keeps more than one server build for this record, and one record makes one zip, so the store is not what its records say. Look at C:\Thornswood-Deploys\server. Nothing was sent.') }
    if (-not $stored.Name) {
        Die ('the store on the box keeps no server build of ' + $stored.Commit.Substring(0, 8) + ' with the record this commit holds' +
             $(if (@($stored.Others).Count) { ' (it has ' + (@($stored.Others) -join ', ') + ', from that commit with another record)' } else { '' }) +
             '. Put it there with a publish from a machine that has that build (-Dist), or with -ServerBuild and the pin''s server zip (Where.ps1 EngineArtifact, artifact\server). Nothing was sent.')
    }
    Say ('{0,-22} {1}, in the store on the box' -f 'server build', $stored.Name) 'Green'
}

# ------------------------------------------------------------ no stop here ---
# This used to stop the server here, before anything was copied, so a copy
# that failed or a payload the installer refused left it down. Issue #446.
# The installer stops it now, by its own folder and port, and only once the
# new folder has checked out beside the old one.

Head 'Copying'
Say 'this is the slow part, a few minutes on a first run; the server keeps running' 'DarkGray'
Invoke-ThornswoodNative { & scp @ssh $Zip "${target}:C:/thornswood-server.zip" }
if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. The server up there was not touched." }
Invoke-ThornswoodNative { & scp @ssh $installer "${target}:C:/Install-ThornswoodServer.ps1" }
if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. The server up there was not touched." }
Invoke-ThornswoodNative { & scp @ssh $serverLog "${target}:C:/Server-Log.js" }
if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. The server up there was not touched." }
Invoke-ThornswoodNative { & scp @ssh $settingsLib "${target}:C:/ServerSettings.ps1" }
if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. The server up there was not touched." }
Invoke-ThornswoodNative { & scp @ssh $buildLib "${target}:C:/ServerBuild.ps1" }
if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. The server up there was not touched." }
Invoke-ThornswoodNative { & scp @ssh $waitLib "${target}:C:/ServerReadyWait.ps1" }
if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE. The server up there was not touched." }
Send-ShapeLibs 'The server up there was not touched.'
Say 'copied' 'Green'

Head 'Installing'
# The zip's hash as it left here, for the installer to hold the copy up there to.
$zipSum = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
$instArgs = "-Zip C:\thornswood-server.zip -Root '$VpsRoot' -TaskName '$TaskName' -StartNow -ZipSha256 $zipSum -Wait $Wait"
# The build out of the store, and the running server's plugins (#459).
if ($FromStore) { $instArgs += (" -FromStore -Store '" + ($script:ThornswoodDeployStore + '/server').Replace('/', '\') + "'") }
if ($RequirePass) {
    Say "the installer sets the join pass hold $RequirePass, as asked" 'Yellow'
    $instArgs += " -RequirePass $RequirePass"
}
if (@($DropPlugins).Count) {
    # Names with spaces cross the ssh command line as base64 (ServerSettings.ps1).
    . $settingsLib
    Say ('the installer may leave these out of the running server''s load order, as asked: ' + (@($DropPlugins) -join ', ')) 'Yellow'
    $instArgs += (' -DropPlugins ' + (ConvertTo-ThornswoodNamesArg $DropPlugins))
}
if ($FreshWorld) {
    # Not deleted any more: the installer starts the new server with no world
    # and leaves the old one in the previous folder beside the root.
    Say 'starting with no world, as asked; the old one stays in the previous folder' 'Yellow'
    $instArgs += ' -FreshWorld'
}
# Thornswood-Last.esp, made on the box for this commit (#2791, New-StorePayload
# says when): into a folder the box holds for this run, from our plugins as the
# payload carries them, read first, and then the running server's own.
$lastBox = $null
if ($FromStore -and $script:LastMake) {
    Head "Making $ThornswoodLastPlugin on the box"
    . (Join-Path $Here '..\deploy\LastPluginOnBox.ps1')
    $lastBox = Open-ThornswoodOnBoxFolder -Target $target -SshArgs $ssh
    if (-not $lastBox.Made) { Die ('could not make a folder on the box to make ' + $ThornswoodLastPlugin + ' in: ' + (($lastBox.Said | Select-Object -Last 3) -join ' | ') + '. The server up there was not touched.') }
    $made = $null
    try {
        $null = Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script ("New-Item -ItemType Directory -Force -Path '" + $lastBox.Run + "\reads', '" + $lastBox.Run + "\made' | Out-Null")
        foreach ($src in $script:LastReads) { Send-ThornswoodArtifactFile $src $target $ssh ($lastBox.Far + '/reads/' + (Split-Path -Leaf $src)) }
        $made = Invoke-ThornswoodLastPluginMake -Target $target -SshArgs $ssh -RepoDir (Join-Path $Here '..\..') `
            -Reads @(($lastBox.Run + '\reads'), ($VpsRoot.TrimEnd('\') + '\plugins')) -Into ($lastBox.Run + '\made') -Want $script:LastMake
    } catch {
        $null = Close-ThornswoodOnBoxFolder $lastBox
        Die ($_.Exception.Message + '. The server up there was not touched.')
    }
    Say ('  {0}, made on the box: {1:N0} bytes, sha256 {2}' -f $ThornswoodLastPlugin, $made.Bytes, $made.Sha.Substring(0, 12)) 'Green'
    $instArgs += (" -LastPlugin '" + $lastBox.Run + '\made\' + $ThornswoodLastPlugin + "' -LastSha256 " + $made.Sha)
}
try { Invoke-Installer $instArgs }
finally { if ($lastBox) { $null = Close-ThornswoodOnBoxFolder $lastBox } }

Head 'Recording what it runs'
Save-ServerRecords

<#
  DEV CARRIES MAIN'S ROSTER.

  Patrick, 21 September, on the dev server: "Dev has no playtetser list so I
  can't tp like I can on main", and then "keep the same list on dev as main as
  so I as Owner still have commands".

  The roles come out of private\door.json and private\allowed.json, which the
  door fetches and writes beside itself in the LIVE root. A dev root has never
  had them: nothing creates that folder on a fresh install, and the door on
  dev has no reason to have fetched yet. So every tier answered no to
  everybody on dev, including the owner, and /tp refused him on his own server.

  The live root's copy is taken as the truth and put into the dev root every
  dev publish, so the two lists cannot drift and a playtester added in Discord
  reaches dev the moment live has it. One direction only: dev never writes back
  over live.

  NOTHING IS READ OUT OF THOSE FILES HERE. They are copied on the VPS, from one
  folder to another, and only the count is printed. door.json is a config file
  and its contents are not this script's business.

  Install-ThornswoodServer.ps1 now sets the folder aside and restores it, so
  after the first seeding this is keeping the two in step rather than repairing
  a wipe.

  ONLY THE DOOR, AND ASKING FOR THE DEV LIST (#964). This was
  Copy-Item -LiteralPath (Join-Path $live '*'), and -LiteralPath reads the *
  as a file name, so it never copied anything: the count it printed was what
  dev already held. Copying the whole folder would have been wrong anyway. It
  holds the dev server's own door.log, characters.json, property.json,
  farm-claims.json, take-limit.json, mod-settings.json and online-names.json,
  which belong to the dev world, and a door.json with the live address, which
  gives the dev door the live list. The dev door asks
  https://thornswood.net/dev, whose list is only the people the dev build is
  for (SERVER.md in the ops repo, "The door"); on 28 Sep that took the dev list from 46
  to 28, which is right.

  So now: door.json is live's key and join pass key with the address ending
  in /dev, so a rotated key still reaches dev and the list stays the dev one.
  allowed.json is copied only when dev has none, so the Owner has commands
  on a fresh dev root until its door fetches its own. Nothing else is touched.

  NOTHING TO CARRY STOPS THE PUBLISH (#1336). A live root with no private
  folder, no door.json, one that does not read, or one without the address,
  the key or the join pass key used to be a line in green and a publish that
  went on to say it was done, with the dev door still on whatever key it had
  before the live one was rotated. Now the dev door is left as it was, the
  script says which of those it was and ends DOOR NOT CARRIED, and the
  publish stops there with exit 1. The dev server it installed is up; its
  door is what was not done. Only names are said, never a value.
#>
if ($IsDev) {
    Head 'The roster'
    $seed = @'
# PowerShell wraps the answer in a block of CLIXML progress records without
# this, which is the trap already written down on the server build entry. It
# leaked into the roster line on the first run.
$ProgressPreference = 'SilentlyContinue'
$live = 'C:\Thornswood-Server\private'
$dev  = '@@DEVROOT@@\private'
# What the dev door needs from live, each named when it is not there, and
# nothing on dev touched then (#1336). Names only: no value is printed.
$liveDoor = Join-Path $live 'door.json'
$d = $null
$why = ''
if (-not (Test-Path -LiteralPath $live)) { $why = 'the live server has no private folder' }
elseif (-not (Test-Path -LiteralPath $liveDoor)) { $why = 'the live server has no door.json' }
else {
    try { $d = Get-Content -LiteralPath $liveDoor -Raw | ConvertFrom-Json } catch { $why = 'the live door.json could not be read' }
    if (-not $why -and $null -eq $d) { $why = 'the live door.json is empty' }
    if (-not $why) {
        $lack = @()
        foreach ($k in 'site', 'key', 'passKey') { if (-not [string]$d.$k) { $lack += $k } }
        if ($lack.Count) { $why = 'the live door.json has no ' + ($lack -join ' and no ') }
    }
}
if ($why) {
    $why + ', so the dev door was left as it was'
    'DOOR NOT CARRIED'
} else {
    New-Item -ItemType Directory -Path $dev -Force | Out-Null
    $site = ([string]$d.site).TrimEnd('/')
    if ($site -notmatch '/dev$') { $site = $site + '/dev' }
    $d | Add-Member -NotePropertyName site -NotePropertyValue $site -Force
    [IO.File]::WriteAllText((Join-Path $dev 'door.json'), ($d | ConvertTo-Json),
        (New-Object Text.UTF8Encoding($false)))
    "dev door.json has the live key and join pass key and asks $site/api/allowed"
    $devList = Join-Path $dev 'allowed.json'
    if (-not (Test-Path -LiteralPath $devList) -and (Test-Path -LiteralPath (Join-Path $live 'allowed.json'))) {
        Copy-Item -LiteralPath (Join-Path $live 'allowed.json') -Destination $devList -Force
        'dev had no allowed.json, so it starts from the live one until its door fetches the dev list'
    }
    'DOOR CARRIED'
}
'@
    $seed = $seed.Replace('@@DEVROOT@@', $VpsRoot.TrimEnd('\'))
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($seed))
    $out = @(Invoke-ThornswoodNative { & ssh @ssh $target "pwsh -NoProfile -EncodedCommand $enc" } | ForEach-Object { "$_".Trim() })
    $carried = $out -contains 'DOOR CARRIED'
    foreach ($line in $out) { Say "  $line" $(if ($carried) { 'Green' } else { 'Red' }) }
    if (-not $carried) {
        Die ("the dev server is installed and answering, but its door was not given the live server's keys, so a rotated key does not reach it. " +
             "The line above says what was missing on live. Put it right there (.\scripts\ops\Set-Door.ps1 -Connect writes the live door.json), then publish to dev again.")
    }
}

# ---------------------------------------------------------------- verify -----
# Game traffic is UDP and there is nothing to connect to, so the resources
# folder is what a probe from here can actually reach.
#
# THE PORTS ARE THE CHANNEL'S, AND THEY USED TO BE THE LIVE ONES EITHER WAY.
#
# 21 September, on the first dev publish of the engine changes, this printed
# "Thornswood is up at <live address:port>" at the end of a run that had
# correctly said "dev channel: port 7787" at the top. Both numbers here were
# written in, so a dev publish probed the LIVE resources port, got an answer
# from the LIVE server, and reported a healthy dev server without ever having
# asked it anything. It would have said exactly the same thing if the dev
# server had failed to start, which is the one case this block exists for.
#
# The resources port is not a setting. skymp5-server/ts/ui.ts:102 derives it:
# 3000 when the game port is 7777, and game port plus one otherwise. So dev is
# 7788 and there is no clash with live, and this is where that rule is written
# down on our side of the fence. -GamePort and -ResourcesPort are the
# harnesses' (see the parameters); a person shipping passes neither.
$GamePort = $wantPort
$ResPort  = if ($ResourcesPort -gt 0) { $ResourcesPort } elseif ($GamePort -eq 7777) { 3000 } else { $GamePort + 1 }

Head 'Checking it answers'
# ONE TRY (#2975). The installer has already had the new server answer on
# both its ports from the box itself (INSTALL OK), and the server listens on
# every address with that one socket, behind standing firewall rules, so
# nothing is left to wait for: Vps.ps1 "from outside" has the measurements.
# Until 21 Oct 2026 this tried up to 30 times two seconds apart. The witness
# is the other server's resources port, which answers everybody, so a
# machine that reaches no raw port on the box (a cloud thread's) is told
# apart from a port that is shut (#2711's "say why" is NotKnown's).
$witness = if ($ResPort -eq 3000) { 7788 } else { 3000 }
$outside = Test-ThornswoodFromOutside $VpsHost $ResPort $witness

Write-Host ''
if ($outside.Answered) {
    Say ("{0} is up at {1}:{2}, resources on {3}" -f $(if ($IsDev) { 'The DEV server' } else { 'Thornswood' }), $VpsHost, $GamePort, $ResPort) 'Green'
    Write-Host ''
} elseif ($outside.NotKnown) {
    # The box's own answer is the measurement that the server is up; this one
    # could not be taken from here, so it is said and the run carries on.
    Say ("{0} answers on the box, and whether {1}:{2} answers from outside is not known: {3}." -f $(if ($IsDev) { 'The DEV server' } else { 'Thornswood' }), $VpsHost, $ResPort, $outside.NotKnown) 'Yellow'
    Write-Host ''
} else {
    Say ("The install finished and the server answers on the box, but {0}:{1} was {2} from out here, though {3} on the box answers from here." -f $VpsHost, $ResPort, $outside.Said, $witness) 'Red'
    # The box had the server answer on this port from 127.0.0.1, so this is the
    # inbound rule for it, or something between, and the previous folder would
    # not change it: the new server stays. The rule is what to look at.
    Say ("  The box's inbound rule for TCP {0} is not letting it in. What the box holds for it:" -f $ResPort) 'Red'
    Say ("  .\scripts\vps\Remote.ps1 `"Get-NetFirewallPortFilter -PolicyStore ActiveStore -Protocol TCP | Where-Object LocalPort -eq {0} | Get-NetFirewallRule | Format-Table DisplayName,Enabled,Action,Profile`"" -f $ResPort) 'DarkGray'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}

# ------------------------------------------------------------------ news ----
# The launcher reads version.json for its News page. Publish-Update writes to
# it on every mod or launcher release; this did not, so anything that lives
# only on the server went out silently.
#
# Said plainly in the entry, because it is the useful part: nobody downloads
# anything for this. Somebody reading a headline about instruments should not
# go looking for an update button that is not going to light up.
# Reached only when the server answers: from here, or on the box when here
# could not measure it (a failed try from here stopped the run above).
if (-not $NoNews) {
    if (-not $RepoDir) { $RepoDir = Split-Path -Parent (Split-Path -Parent $Here) }
    # THE LIVE FEED, NOT THE COPY IN THIS REPO. Until 23 September this wrote
    # into the repo's own version.json. That file is not dead, it is the
    # shipped default read as a template, and nothing publishes it: every
    # launcher reads the copy in the public releases clone. So a server change
    # was written down in a file nobody reads, which is the same as not being
    # announced at all, and the whole reason this News section exists.
    #
    # Since #907 the live feed is on the VPS store (Feed-Store.ps1): received
    # into this machine's working folder for main, the entry added, and sent
    # back. Until then it was the Thornswood-Releases clone, pushed. -ReleaseDir
    # works on a folder instead and receives nothing.
    . (Join-Path $Here 'Feed-Store.ps1')
    $receive = -not $ReleaseDir
    if (-not $ReleaseDir) { $ReleaseDir = Get-FeedStoreDir 'main' }
    if ($receive -and -not $NoPush) {
        try { [void](Receive-FeedStore 'main' $ReleaseDir) }
        catch { Say "  could not receive the live feed from the VPS: $($_.Exception.Message)" 'Yellow' }
    }
    $VersionFile = Join-Path $ReleaseDir 'version.json'

    if (-not (Test-Path -LiteralPath $VersionFile)) {
        Say "no version.json in $ReleaseDir, so nothing was added to the News page" 'Yellow'
    } else {
        Head 'News'
        try {
            $doc = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $VersionFile -Raw) $VersionFile

            # What actually moved, worked out here rather than taken from the
            # note, so an entry says something even when the note is empty.
            $details = @()
            foreach ($line in @($Notes -split "`r?`n")) {
                $t = $line.Trim()
                if ($t -match '^[-*\u2022]\s*(.+)$') { $details += $Matches[1].Trim() }
            }

            # Two lines used to go in here that were for whoever ran this, not
            # for the people reading the News tab and the site: "The gamemode
            # was rebuilt: starting kits, creation and arrival points live in
            # it", untrue since the kits went on 20 September, and "Load order:
            # 60 plugins server side". Entry 187 on the To Do List: patch notes
            # people read are about what they will notice. The gamemode copy is
            # said above where it happens; the count is said here, on screen.
            if (-not $FromStore) {
                # A line on screen for whoever runs this, not part of the
                # entry, so settings that do not read are said and the entry
                # goes on (#2711).
                $ssPath = Join-Path $Dist 'server-settings.json'
                try {
                    $ss = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $ssPath -Raw -ErrorAction Stop) $ssPath
                    if ($ss.PSObject.Properties['loadOrder'] -and $ss.loadOrder) { Say ('  load order: {0} plugins server side' -f @($ss.loadOrder).Count) 'DarkGray' }
                } catch { Say ("  load order: not counted, $ssPath does not read: " + $_.Exception.Message) 'Yellow' }
            }

            if ($FreshWorld) { $details += 'The world was thrown away, so every character on the server is gone' }
            $details += 'Nothing to download for this one. It is on the server, so it is already live.'

            # A headline and the rest, the same shape Publish-Update writes, so
            # the News page does not have to know which of the two made an entry.
            $noteLines = @($Notes -split "`r?`n")
            $title = if ($noteLines[0].Trim()) { $noteLines[0].Trim() } else { 'Server updated' }
            $bodyBits = @()
            for ($i = 1; $i -lt $noteLines.Count; $i++) {
                $line = $noteLines[$i].Trim()
                if ($line -and $line -notmatch '^[-*\u2022]') { $bodyBits += $line }
            }
            # A one-line note leaves the body empty, the same as a one-line
            # Ship. It used to be filled with "The server at" and the VPS
            # address "was reinstalled and is answering", which put the address
            # on the public news page and told nobody anything they would notice.
            $body = ($bodyBits -join ' ').Trim()

            # 'kind' and 'stamp' are extra members the launcher never asked
            # for. NewsItem is read with DataContractJsonSerializer, which
            # ignores what it was not told about, so old launchers are safe.
            # They are here so this script can recognise its own entries.
            $named = [bool]$noteLines[0].Trim()
            $entry = [pscustomobject]@{
                date    = (Get-Date).ToString('d MMM yyyy')
                title   = $title
                body    = $body
                details = @($details)
                files   = @()
                kind    = 'server'
                stamp   = (Get-Date).ToString('o')
                named   = $named
            }

            # Every note, wherever the feed keeps them (Feed-News.ps1, #1050).
            # A news file that cannot be read stops the entry here, so a list
            # without its older notes is never written back.
            . (Join-Path $Here 'Feed-News.ps1')
            $newsList = @(Open-FeedNewsList $doc)

            # Publishing the server twice over one change is normal while
            # something is being chased. That is one piece of news, not four.
            #
            # Three runs tonight put three entries at the top of a feed that
            # holds twenty, and three real releases fell off the bottom to make
            # room. An unnamed run is somebody pushing a fix, not an
            # announcement, so it stands in until there is something to say and
            # then gets written over rather than pushing history out.
            $repeat = $false
            $replaceTop = $false
            if ($newsList.Count -gt 0) {
                $top = $newsList[0]
                $topTitle = if ($top.PSObject.Properties.Name -contains 'title') { [string]$top.title } else { '' }
                $topBody  = if ($top.PSObject.Properties.Name -contains 'body')  { [string]$top.body }  else { '' }
                $topKind  = if ($top.PSObject.Properties.Name -contains 'kind')  { [string]$top.kind }  else { '' }
                $topNamed = $true
                if ($top.PSObject.Properties.Name -contains 'named') { $topNamed = [bool]$top.named }

                if ($topTitle -eq $entry.title -and $topBody -eq $entry.body) { $repeat = $true }
                elseif ($topKind -eq 'server' -and -not $topNamed) { $replaceTop = $true }
            }

            if ($repeat) {
                Say '  same note as last time, so no new entry' 'DarkGray'
            } else {
                if ($replaceTop) {
                    Say '  the entry above it had no note, so this replaces it' 'DarkGray'
                    $newsList = @($entry) + @($newsList | Select-Object -Skip 1)
                } else {
                    $newsList = @($entry) + $newsList
                }
                # Forty, not twenty. Twenty was one evening's worth.
                if ($newsList.Count -gt 40) { $newsList = $newsList[0..39] }
                # Back the way the live feed keeps them: in "news", or once its
                # minLauncher reads it, a news file sent to the site first.
                $minNews = if ($doc.PSObject.Properties['minLauncher'] -and [string]$doc.minLauncher) { [string]$doc.minLauncher } else { [string]$doc.launcherVersion }
                [void](Set-FeedNewsList $doc $newsList 'main' $minNews (Join-Path $ReleaseDir 'news-out') '' -NoSend:$NoPush)

                # Compact, no byte order mark (Feed-Json.ps1,
                # Write-FeedVersionFile). A BOM takes out the update check for
                # everybody at once, including their route to a fix.
                Write-FeedVersionFile $VersionFile $doc
                Say ("  added: {0}" -f $entry.title) 'Green'

                if (-not $NoPush) {
                    # THE LIVE FEED ON THE VPS, NEVER THE SOURCE REPO.
                    #
                    # This used to Push-Location into the source repo and run a
                    # bare git push there, which pushed a file nobody reads and
                    # whatever branch the source repo had checked out, usually
                    # main. Then it pushed the Thornswood-Releases clone by -C.
                    # Since #907 the entry goes to the VPS store, where the
                    # site serves it at once; a feed that changed up there
                    # since it was received is refused, not overwritten.
                    try {
                        [void](Send-FeedStore 'main' $ReleaseDir @('version.json'))
                        Say '  sent; the News entry is on the live feed' 'DarkGray'
                    } catch {
                        Say "  the feed was not sent, so nobody has the News entry yet: $($_.Exception.Message)" 'Yellow'
                        Say '  Run this again to add it.' 'Yellow'
                    }
                }
            }
        } catch {
            Say "  could not write the News entry: $($_.Exception.Message)" 'Yellow'
            Say '  The server is up regardless. Nothing else was changed.' 'DarkGray'
        }
    }
}

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
