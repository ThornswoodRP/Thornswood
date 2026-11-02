<#
  Where.ps1

      & (Join-Path $PSScriptRoot 'Where.ps1') ServerDist

  Says where the engine fork and the build output are, so every script asks
  one place instead of carrying its own copy of a path.

  WHY IT EXISTS. Until 25 September the fork, its build and everything a release
  is built into sat outside the repository, in a folder on Patrick's machine
  that about thirty scripts named by hand. Nothing in it was on GitHub but the
  fork's source, and Djinn's machine had none of it. Patrick asked for it all
  to live in the repository ("so I dont have all these extra folder and so it
  is backed up by github and my other devs can do more stuff"), and Djinn
  agreed:

      engine\skymp   the fork, a git submodule of this repository, pinned to the
                     commit the build records name
      out            the build output: dist (packs, the launcher, the
                     installer), _payload and thornswood-server.zip. Ignored
                     by git; a release is what keeps them

  NO OLD PLACES. Until 28 September this also answered with the old folder
  while a machine still had it, and with the old tools\ paths from before the
  reorganisation (issue #440). No machine has either any more, so both went:
  the answer is always the place in the repository, whether or not it exists
  yet (an engine not fetched is an empty engine\skymp, and a script that needs
  it says so).

  LAYOUT. layout.json at the repository root holds the places; where.js
  beside this reads the same file.

  LOCAL AND BACKUPS, 5 October. Local is the repository's local folder,
  ignored by git, the settled design's home for anything a machine keeps that
  never goes to GitHub. Backups is local\backups, where Backup-Server.ps1 and
  Fetch-Backups.ps1 put what they bring off the VPS and Clean-Everything.ps1
  looks for old ones. Patrick's rule that day: Thornswood work on One lives
  only in the repository, the vault and C:\ThornswoodTemps&Worktrees (moved
  into the repository's temp and worktrees on 20 Oct, #2900), and the
  backups were the last of it in Downloads\Thornswood-Backups. A worktree has
  a local folder of its own that goes with it, so the scripts that write
  backups stop when this answer is inside a worktree rather than leave the
  only copy there.

  THE FOLDER A RELEASE IS BUILT FROM, issue #1692. ShipRoot and ShipRootDev
  are the Thornswood install a main and a dev release are built from on this
  machine, which Ship.ps1, Check-ShipReady.ps1, Setup-ShipMachine.ps1 and
  Build-Generated.ps1 each worked out for themselves until 5 October, by the
  same rule copied four times: the launcher install (C:\Thornswood, or
  Thornswood on the first other fixed drive with Launcher\Thornswood.exe in
  it), and for dev that with -DevBuild on the end, where the main launcher's
  Settings page installs the dev build. A machine where Vortex deploys into
  that dev folder (docs\COLLECTION-REVISION-2.md step 8) builds its dev
  release in another one, and nothing knew which: on 4 October a dev Ship
  from a clean worktree took Vortex's folder, built and installed the
  launcher there and then stopped at its generated files. ShipRoots is the
  file in this machine's own data (not in the repository, so every clone and
  worktree reads it) that names the folder for a channel, as
  {"dev": "C:\\Thornswood-Repo\\local\\release-devbuild"}
  on One since 5 October; Setup-ShipMachine.ps1 -Root writes it. A channel
  it does not name is the rule above. These three are this machine's, and
  only the PowerShell release scripts ask, so where.js does not answer them.

  WHO NAMED THE FOLDER, issue #2662. ShipRootNamed and ShipRootNamedDev
  answer only what ShipRoots names for the channel, and '' when it names
  none, so a script can tell a recorded folder from the install rule's
  answer, which ShipRoot and ShipRootDev give as one string. A dev Ship asks:
  the install rule's <install>-DevBuild with no Launcher folder means the
  main launcher never installed the dev build there, and Ship refuses it; a
  recorded folder is made by Update-ShipRoot.ps1, which writes no Launcher
  folder, and the Ship's own launcher step makes one, so it is not refused.

  THE ENGINE BUILD, issue #2019. engine\README.md "One engine": there is one
  engine, and an engine change is built in a worktree of the fork
  (Build-Engine.ps1 -Fork, Build-Server.ps1 -Fork), not in a checkout's
  engine\skymp. Until 16 October ServerDist, ClientDist, ServerSettings and
  ChangeForms were always under the checkout's own engine\skymp\build, so
  each clone and worktree read whatever its own folder last built: on
  15 October a dev Ship from a worktree read that worktree's 12 October
  client and refused against the 0714e444 record, and the dev deploys needed
  -Dist pointed at the right folder by hand (#2309). EngineBuild is the fork
  folder this machine records as its engine build, in the file EngineBuilds
  names ({"fork": "<folder>"}, this machine's own data like ShipRoots,
  written by Setup-ShipMachine.ps1 -EngineBuild), and those four places are
  under it. A machine that records none builds in its checkout
  (engine\README.md "Building it on your machine"), and EngineBuild is then
  Engine. A record naming a folder with no build in it stops with a sentence
  and never falls back to another folder. where.js answers EngineBuild the
  same way, so both read one engine build.

  CI'S ENGINE BUILD, issue #3047. A rebuild is never the same bytes, so a
  record CI made (engine.yml, #459) matches only CI's build, and a fork
  folder built on this machine never does: on 21 Oct One's record still
  named a b6c76e45 worktree after the pin moved to 1a7b6eec, and the dev Ship
  stopped. A machine that ships records {"ci": true} instead
  (Setup-ShipMachine.ps1 -EngineBuild ci), and EngineBuild is then
  EngineArtifact: engine-ci\<the fork commit this checkout's
  records\server-build.json names, 12> in this machine's own data, where
  Get-EngineArtifact.ps1 puts the fork's build of that commit after
  holding every file to the records. It is named for the pin, so a pin move
  is a new folder and never a stale one, and each checkout reads the build
  of its own pin. Like any place it is answered whether or not it is there
  yet; Sync-Client.ps1 fetches it when it needs the client from it.

  THE LAUNCHER INSTALL, issue #3003. Install is the folder this machine's
  launcher is installed in: C:\Thornswood, or Thornswood on the first other
  fixed drive with Launcher\Thornswood.exe in it, else C:\Thornswood.
  InstallDev is the same with -DevBuild on the end, where the main launcher's
  Settings page installs the dev build (DevBuild.cs). Until 21 October six
  scripts (Publish-Update, Repair-Manifest, Sync-Client, Go, Deploy-Gamemode
  and Check-CollectionRules) each carried a pasted Find-Root with this rule,
  and Check-Editions a seventh copy inline, so a change to it had to be made
  seven times, and the copies that asked Join-Path for C: stopped on a machine
  with none. They ask here now, and tests\test-3003-one-install-rule.ps1
  fails on a new copy. Like ShipRoots these are this machine's, and only the
  PowerShell scripts ask, so where.js does not answer them.

  Read only. It creates nothing and prints nothing but the one path.

.PARAMETER What
  Which place: Repo, Engine, EngineBuild, EngineBuilds, EngineArtifact, ServerDist,
  ClientDist, ServerSettings, ChangeForms, Out, Dist, Package, Payload,
  ServerZip, Local, Backups, Releases, ReleasesDev, Install, InstallDev,
  ShipRoot, ShipRootDev, ShipRoots, ShipRootNamed or ShipRootNamedDev; or a top folder
  from layout.json (docs, bot, voice, site, tests, game, launcher,
  installer, records, scripts).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$What
)

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $here)

# layout.json, read the first time a place or folder of the repository is
# asked for. This machine's own places (MachineData and the files under it)
# come from the platform and never from it, so asking for one of those does
# not need it (#2903): Publish-Update and Publish-Discord ask Where.ps1 for
# them since then, and run in harnesses from a copy of the
# scripts with no layout.json beside them.
$script:layout = $null
function Get-Layout {
    if ($null -ne $script:layout) { return $script:layout }
    $layoutPath = Join-Path $repo 'layout.json'
    if (-not (Test-Path -LiteralPath $layoutPath)) {
        throw "layout.json is not at $layoutPath. It is in the repository, so the path is wrong."
    }
    $layoutText = "$(Get-Content -LiteralPath $layoutPath -Raw -Encoding UTF8)"
    if (-not $layoutText.Trim([char]0xFEFF, ' ', [char]9, [char]13, [char]10)) { throw "layout.json at $layoutPath is empty." }
    try { $script:layout = $layoutText.TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { throw ("layout.json at $layoutPath is not valid JSON: " + $_.Exception.Message) }
    return $script:layout
}

# This machine's own data (feed copies, ship-roots.json, engine-build.json):
# %LOCALAPPDATA%\Thornswood, which tests point elsewhere by setting it. Off
# Windows there is no LOCALAPPDATA, and Join-Path stopped on the null before
# saying anything (#2872); the platform's own folder for it, ~/.local/share,
# takes its place, and holds none of those files until something writes them.
function Get-MachineData {
    $d = $env:LOCALAPPDATA
    if (-not $d) { $d = [Environment]::GetFolderPath('LocalApplicationData') }
    return Join-Path $d 'Thornswood'
}

function Join-Under([string]$root, [string]$rel) {
    if (-not $rel) { return $root }
    $parts = $rel -split '[\\/]+' | Where-Object { $_ -and $_ -ne '.' }
    $p = $root
    foreach ($part in $parts) { $p = Join-Path $p $part }
    return $p
}

# Looked up by name rather than read as $layout.places.$name. Ship.ps1 runs
# with Set-StrictMode -Version Latest, and a script it calls runs under it too,
# where reading a property an object does not have throws. Every Ship once
# stopped at Sync-Client on "The property 'ClientDist' cannot be found on this
# object" that way.
function Get-Named($obj, [string]$name) {
    if ($null -eq $obj) { return $null }
    $prop = $obj.PSObject.Properties[$name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

# The launcher install (#3003, see the header): C:\Thornswood, or Thornswood
# on the first other fixed drive that has Launcher\Thornswood.exe in it, else
# C:\Thornswood. The only copy of the rule: every script asks Where.ps1
# Install or InstallDev for it. The first is asked as a plain string, so a
# machine with no C: drive (a harness off Windows) gets an answer rather than
# an error from Join-Path.
function Find-InstallRoot {
    $first = 'C:\Thornswood'
    if (Test-Path -LiteralPath ($first + '\Launcher\Thornswood.exe')) { return $first }
    foreach ($d in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Root -match '^[A-Za-z]:\\$' })) {
        $cand = Join-Path $d.Root 'Thornswood'
        if (Test-Path -LiteralPath (Join-Path $cand 'Launcher\Thornswood.exe')) { return $cand }
    }
    return $first
}

# A build runner off the box names its own install folder (#3860): on One the
# rule above finds Patrick's own game, C:\Thornswood, which is his to play
# from and which the runner's account is denied, so a build there stopped on
# "Access to the path 'C:\Thornswood\Launcher\Thornswood.exe' is denied".
# Install-Runner.ps1 -OffBox writes THORNSWOOD_INSTALL into the runner's .env,
# a folder under the runner's own root, so its jobs answer from there, as a
# box runner does from a machine with no install at all, and nothing a build
# runs ever looks in, or writes to, the install people play from.
function Get-InstallRoot {
    if ($env:THORNSWOOD_INSTALL) { return $env:THORNSWOOD_INSTALL }
    return Find-InstallRoot
}

# The folder ShipRoots names for $channel, or '' when it names none (#2662,
# see the header): what Setup-ShipMachine.ps1 -Root recorded, and nothing
# the install rule would answer. Get-ShipRoot asks this first.
function Get-NamedShipRoot([string]$channel) {
    $file = Get-Place 'ShipRoots'
    if (-not (Test-Path -LiteralPath $file)) { return '' }
    $rec = $null
    try { $rec = [IO.File]::ReadAllText($file) | ConvertFrom-Json }
    catch { throw "$file does not read as JSON, so which folder a release is built from here is not known. Fix it, or write it again with .\scripts\release\Setup-ShipMachine.ps1 -Channel $channel -Root <folder>." }
    return [string](Get-Named $rec $channel)
}

# The folder a release on $channel is built from on this machine (#1692, see
# the header): what ShipRoots names for it, or the install rule.
function Get-ShipRoot([string]$channel) {
    $named = Get-NamedShipRoot $channel
    if ($named) { return $named }
    if ($channel -eq 'dev') { return Get-Place 'InstallDev' }
    return Get-Place 'Install'
}

# The folder whose build\dist is this machine's engine build (#2019, see the
# header): CI's build of the pin when EngineBuilds records ci (#3047), the
# fork folder it records, or the checkout's own engine.
function Get-EngineBuild {
    $file = Get-Place 'EngineBuilds'
    if (-not (Test-Path -LiteralPath $file)) { return (Get-Place 'Engine') }
    $rec = $null
    try { $rec = [IO.File]::ReadAllText($file) | ConvertFrom-Json }
    catch { throw "$file does not read as JSON, so which engine build this machine uses is not known. Write it again with .\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci." }
    if ((Get-Named $rec 'ci') -eq $true) { return (Get-Place 'EngineArtifact') }
    $fork = [string](Get-Named $rec 'fork')
    if (-not $fork) { throw "$file names no engine build. Write it again with .\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci." }
    if (-not (Test-Path -LiteralPath (Join-Path $fork 'build\dist'))) {
        throw ("$file names $fork as this machine's engine build, and there is no build\dist in it, so there is no engine build to read. " +
               "Take CI's build of the pin instead, which is the one the records name: .\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci (engine\README.md, A Ship machine takes CI's build).")
    }
    return $fork
}

# Where CI's engine build of this checkout's pin goes (#3047, see the
# header): engine-ci\<fork commit 12> in this machine's own data, the commit
# records\server-build.json names.
function Get-EngineArtifact {
    $record = Join-Path $repo 'records\server-build.json'
    $commit = ''
    try { $commit = ([string](Get-Named (Get-Named ([IO.File]::ReadAllText($record) | ConvertFrom-Json) 'source') 'commit')).ToLowerInvariant() } catch { $commit = '' }
    if ($commit -notmatch '^[0-9a-f]{40}$') { throw "$record names no fork commit (source.commit), so which CI engine build this checkout takes is not known." }
    return (Join-Path (Join-Path (Get-MachineData) 'engine-ci') $commit.Substring(0, 12))
}

function Get-Place([string]$name) {
    switch ($name) {
        'Repo'   { return $repo }
        # This machine's own data, the folder below (#2903).
        'MachineData' { return Get-MachineData }
        # This machine's working copies of the feeds (Feed-Store.ps1, #907),
        # not clones of Thornswood-Releases beside the repository any more.
        'Releases'    { return Join-Path (Get-MachineData) 'feed\main' }
        'ReleasesDev' { return Join-Path (Get-MachineData) 'feed\dev' }
        # The folder a release is built from here, and the file that names it (#1692).
        # The launcher install, and the dev build beside it (#3003).
        'Install'     { return Get-InstallRoot }
        'InstallDev'  { return ((Get-InstallRoot) + '-DevBuild') }
        'ShipRoots'   { return Join-Path (Get-MachineData) 'ship-roots.json' }
        'ShipRoot'    { return Get-ShipRoot 'main' }
        'ShipRootDev' { return Get-ShipRoot 'dev' }
        # Only what ShipRoots names, '' for the install rule (#2662).
        'ShipRootNamed'    { return Get-NamedShipRoot 'main' }
        'ShipRootNamedDev' { return Get-NamedShipRoot 'dev' }
        # This machine's engine build, and the file that names it (#2019).
        'EngineBuilds' { return Join-Path (Get-MachineData) 'engine-build.json' }
        'EngineBuild'  { return Get-EngineBuild }
        # CI's engine build of this checkout's pin (#3047).
        'EngineArtifact' { return Get-EngineArtifact }
    }
    $place = Get-Named (Get-Layout).places $name
    if ($null -ne $place) { return Join-Under $repo ([string]$place) }
    $der = Get-Named (Get-Layout).derived $name
    if ($null -ne $der) {
        $base = Get-Place ([string]$der.from)
        return Join-Under $base ([string]$der.join)
    }
    return $null
}

$placeNames = @('Repo', 'MachineData', 'Engine', 'EngineBuild', 'EngineBuilds', 'EngineArtifact', 'ServerDist', 'ClientDist', 'ServerSettings', 'ChangeForms',
                'Out', 'Dist', 'Package', 'Payload', 'ServerZip', 'Local', 'Backups', 'Releases', 'ReleasesDev',
                'Install', 'InstallDev', 'ShipRoot', 'ShipRootDev', 'ShipRoots', 'ShipRootNamed', 'ShipRootNamedDev')
if ($placeNames -contains $What) {
    Get-Place $What
}
elseif (@((Get-Layout).folders.PSObject.Properties.Name) -contains $What) {
    Join-Under $repo ([string](Get-Named (Get-Layout).folders $What))
}
else {
    $folderNames = @((Get-Layout).folders.PSObject.Properties.Name)
    $known = ($placeNames + $folderNames) -join ', '
    throw "Where.ps1 does not know '$What'. Known: $known"
}
