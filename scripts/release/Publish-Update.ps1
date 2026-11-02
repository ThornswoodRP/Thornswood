<#
  Publish-Update.ps1

  Diffs the current build against the last published state, packs only what
  changed, sends it to the site (thornswood.net/feed[-dev]/assets/<sha256>,
  #897), and updates version.json so everyone's launcher picks it up.

  First time:   .\Publish-Update.ps1 -Baseline
  After that:   .\Publish-Update.ps1 -Notes "Swapped the map mod"

  The feed and its baseline are received from the VPS at the start and sent
  back at the end (Feed-Store.ps1, #907). Nothing here uses GitHub.

  NO LAUNCHER GOES ON THE FEED (#4825). The launcher goes out only through
  Velopack (.github\workflows\merge-release.yml for dev, promote-main.yml for
  main), and this sends no launcher and writes none of the feed's launcher
  fields (launcherVersion, launcherUrl, launcherSha256, launcherInputs,
  minLauncher). A feed keeps the ones it has: they name the last launcher the
  feed sent, which every older launcher already takes, so none of those is
  offered a launcher it cannot start.
#>
[CmdletBinding()]
param(
    [string]$Root,
    # Where releases are staged and zipped. Deliberately NOT under $Root: that
    # is the folder people play from, and staging there put 10.9 GB of old
    # packs on the game drive. The dev tree is where build output belongs.
    [string]$DistRoot = (& (Join-Path $PSScriptRoot 'Where.ps1') Dist),
    # How many built packs to keep. They are all uploaded to the releases
    # repository the moment they are made, so the copies here are a local
    # convenience and nothing depends on an old one. Nothing pruned them until
    # 22 September and 62 of them had piled up. 0 keeps everything.
    [int]$KeepPacks = 10,
    # A release deleting more than this many files off everybody is treated as
    # a mistake until somebody says otherwise.
    [int]$MaxRemovals = 200,
    [switch]$AcceptRemovals,
    # And a release sending more than this many MB to everybody, the same way.
    # See the release size block for the number and the night it came from.
    [int64]$MaxReleaseMB = 3072,
    [switch]$AcceptSize,
    [string]$RepoDir,
    # This machine's working folder for the channel's feed and baseline, not a
    # git repository: %LOCALAPPDATA%\Thornswood\feed\main or ...\dev
    # (Feed-Store.ps1). Both files are received from the VPS into it at the
    # start and sent back at the end. Until #907 this was a clone of
    # Thornswood-Releases beside the repository.
    [string]$ReleaseDir,
    [string]$Id,
    [string]$Notes   = '',
    [switch]$Baseline,
    [switch]$NoUpload,
    [switch]$NoPush,
    [switch]$NoPause
    # Ship -DryRun passes this so a dry run does not Stop-Game (issue #494).
    ,[switch]$NoClose
    ,[switch]$MoveServer
    # main is the build everybody plays on. dev is the second launcher and
    # the dev server: its own release branch, its own baseline, its own pack
    # ids, and the dev ports in its version.json. Nothing about main moves.
    ,[ValidateSet('main', 'dev')][string]$Channel = 'main'
    # Where launchers download what this release adds (#897): every pack and
    # the client runtime are sent to /feed[-dev]/assets/<sha256>
    # on thornswood.net BEFORE version.json is written, and the feed names
    # them there. The urls already on the feed move to the site too, each one
    # only once the site answers for its bytes. The GitHub release path kept
    # for rolling back went with Thornswood-Releases (#907).
    #
    # Where the site answers, for the check that moves old urls over and for
    # main's feed on a dev publish. The tests point it at a copy of
    # site\server.js on this machine.
    ,[string]$SiteUrl = 'https://thornswood.net'
    # A folder standing in for the site's root on the VPS (C:\Thornswood-Docs),
    # passed to Remirror-Site-Feed.ps1 and Feed-Store.ps1 so nothing connects
    # to the VPS. Tests only.
    ,[string]$SiteDir,
    # Go ahead from a checkout that is not exactly origin/main and clean (#2118). Loud.
    [switch]$AllowStaleCheckout,
    # A release with no game folder of the collection's (#2754, Ship -FromFeed):
    # -Root is a folder New-FeedRoot.ps1 staged, whose Game holds the files the
    # last release carried and this checkout's own. The collection's files are
    # not in it, so the plugin list, its order key and the collection revision
    # are the last release's, held to the server's order read off the box.
    [switch]$FromFeed
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named
. (Join-Path $PSScriptRoot 'RecordShape.ps1')     # #2180: the Skyrim pin is held to its shape before it goes into the feed

# A stale or dirty checkout sends old or unlanded code; refuse it (#2118).
# The branch rule is Ship's own, through Test-FreshAnyBranch (#2235): a dev
# release may come off any pushed branch, a live one off main or hotfix/.
. (Join-Path $PSScriptRoot '..\deploy\Fresh-Checkout.ps1')
$freshRepo = Join-Path $PSScriptRoot '..\..'
Assert-FreshCheckout -RepoDir $freshRepo -What 'Publish-Update' -AnyBranch:(Test-FreshAnyBranch -RepoDir $freshRepo -Channel $Channel) -AllowStale:$AllowStaleCheckout


Set-StrictMode -Version Latest

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $RepoDir) { $RepoDir = Split-Path -Parent (Split-Path -Parent $Here) }
$Dev = ($Channel -eq 'dev')

# ---- where the launcher is installed ----------------------------------------
#
# The install Where.ps1 finds (#3003): C:\Thornswood on most machines, or
# Thornswood on another drive when the launcher is there. The dev launcher
# lives beside the main one, the install plus -DevBuild, where the main
# launcher's Settings page installs it (DevBuild.cs), and Where.ps1 InstallDev
# answers that. Its config.json carries the dev ports. -Root still wins.
if (-not $PSBoundParameters.ContainsKey('Root')) {
    $Root = [string](& (Join-Path $Here 'Where.ps1') $(if ($Dev) { 'InstallDev' } else { 'Install' }))
}
# Only the folder worked out here is asked for a Launcher folder (#2662): no
# Launcher folder in <install>-DevBuild means the dev build was never
# installed. A folder named by -Root is not: Ship always passes one, and the
# ship root Update-ShipRoot.ps1 makes has no Launcher folder.
if ($Dev -and -not $PSBoundParameters.ContainsKey('Root') -and -not (Test-Path (Join-Path $Root 'Launcher'))) {
    Die "No dev build at $Root. Install it from the main launcher's Settings page first, or name the folder with -Root."
}

# ------------------------------------------------------------ the feed store
# THE FEED AND THE BASELINE COME FROM THE VPS (#907). Each channel keeps
# version.json, published.json and their history beside the feed the site
# serves (C:\Thornswood-Docs\feed and feed-dev); Feed-Store.ps1 says how and
# why. They are received into this machine's working folder for the channel
# before anything is read, so a release is packed against the baseline the
# last Ship on ANY machine left, and sent back at the end. Until then they
# were two clones of Thornswood-Releases beside the repository, and the
# baseline was read off whatever this disk last pulled.
#
# A run that sends nothing (-NoPush, which is Ship -DryRun) and already has
# both files here uses them as they are, so a dry run never needs the VPS.
. (Join-Path $Here 'Feed-Store.ps1')
# What a release is diffed against: file contents, and the feed's own record
# of what its last release left installed (#441). Release-Baseline.ps1 says why.
. (Join-Path $Here 'Release-Baseline.ps1')
# The one name a release goes by, and what else it is known by (#444).
. (Join-Path $Here 'Release-Name.ps1')
# Which dev notes main has not had: the DEV marks and mainVersion (Dev-News.ps1).
. (Join-Path $Here 'Dev-News.ps1')
# Which content plugin the channel's server holds (#2308, ServerContent.ps1).
. (Join-Path $Here '..\deploy\ServerContent.ps1')
# Which Thornswood-Last.esp this commit's recipe makes (#2791).
. (Join-Path $Here '..\deploy\LastPluginRecipe.ps1')
# Where the notes are kept, in the feed or as a file of their own (#1050).
. (Join-Path $Here 'Feed-News.ps1')
# The signed release manifest (#2163, phase B): what it lists, and signing it.
. (Join-Path $Here 'Release-Manifest.ps1')
. (Join-Path $Here 'Sign-ReleaseCatalog.ps1')
. (Join-Path $Here 'Sign-OnGitHub.ps1')
if (-not $ReleaseDir) { $ReleaseDir = Get-FeedStoreDir $Channel }
if (-not (Test-Path -LiteralPath $ReleaseDir)) { New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null }
$haveLocal = (Test-Path -LiteralPath (Join-Path $ReleaseDir 'version.json')) -and (Test-Path -LiteralPath (Join-Path $ReleaseDir 'published.json'))
if (-not $NoPush -or -not $haveLocal) {
    Write-Host "  receiving the $Channel feed and baseline from the VPS into $ReleaseDir" -ForegroundColor DarkGray
    # And the list of releases a rollback can go back to, kept beside them
    # since #1050 rather than in the feed (Release-Baseline.ps1).
    try { [void](Receive-FeedStore $Channel $ReleaseDir @('version.json', 'published.json', $FeedReleasesFile) -SiteDir $SiteDir) }
    catch { Die ("Could not receive the $Channel feed and baseline from the VPS, so nothing was built: " + $_.Exception.Message) }
} else {
    Write-Host "  -NoPush: using the feed and baseline last received into $ReleaseDir" -ForegroundColor DarkGray
}
if (-not (Test-Path (Join-Path $ReleaseDir 'version.json'))) {
    Die "The VPS has no version.json for the $Channel channel. Nothing was built."
}

$GameDir    = Join-Path $Root 'Game'
$ProfileDir = Join-Path $Root 'Profile'

# Where a release is staged and zipped. NOT under $Root any more.
#
# It was $Root\_dist, which is inside the folder Patrick plays from, because
# $Root was the only path in scope when it was written. Nothing about the game
# needs it there and it grew: on 22 September C:\Thornswood\_dist held 941
# files and 10,936.8 MB, 62 pack zips going back to 15 September because
# nothing ever pruned them, on a drive with 22.3 GB free. Measure-Reclaim
# says every byte of it is this folder's alone, so it was 10.9 GB of the game
# drive spent on output nobody reads twice.
#
# One folder per install root, so the main install and the dev build keep the
# separate staging areas they have always had and cannot tread on each other.
# -DistRoot moves the lot for a machine laid out differently.
$DistDir    = Join-Path (Join-Path $DistRoot (Split-Path -Leaf $Root.TrimEnd('\'))) '_dist'
if (-not (Test-Path -LiteralPath $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
}

# The old location, so a machine that has one is told rather than left with
# 10.9 GB it will never look at again. Said once, never deleted here: this
# script publishes, and deleting ten gigabytes is not a thing a publish should
# do quietly.
$OldDist = Join-Path $Root '_dist'
if (Test-Path -LiteralPath $OldDist) {
    # A count for the person, never a reason to stop: what could not be read
    # is said as an "at least" rather than left out of the number unsaid.
    $oldUnread = @()
    # Measure-Object hands back nothing at all when no file comes in, and under
    # Set-StrictMode -Version Latest (top of this file) reading .Sum off that
    # nothing throws "The property 'Sum' cannot be found on this object". An
    # old folder that is there but empty did exactly that, before anything was
    # published. Empty is 0 MB.
    $oldMeasure = @(Get-ChildItem -LiteralPath $OldDist -Recurse -File -ErrorAction SilentlyContinue -ErrorVariable oldUnread) | Measure-Object Length -Sum
    $oldMb = if ($oldMeasure) { [double]$oldMeasure.Sum / 1MB } else { 0 }
    Write-Host ("  releases stage in $DistDir now, not in $OldDist") -ForegroundColor DarkGray
    Write-Host ("  the old one still holds {0}{1:N1} MB. Check it with .\scripts\dev\Measure-Reclaim.ps1 -Path `"$OldDist`", then remove it." -f $(if ($oldUnread.Count) { 'at least ' } else { '' }), $oldMb) -ForegroundColor Yellow
    if ($oldUnread.Count) { Write-Host ("  {0} part(s) of it could not be read to count: {1}" -f $oldUnread.Count, $oldUnread[0].Exception.Message) -ForegroundColor DarkGray }
}

# Profile\developer.flag was written here until 25 September, so the machine
# that ships would let a newer game file win over the launcher's kept copy
# (Keep.cs). It went because it also meant that machine never saw the repair a
# tester's launcher makes (Patrick: "it will make testing easier"). Go.ps1,
# which Ship runs to put the plugins and overlays in, now refreshes the kept
# copies of what it installs, the way a pack does, so nothing here needs it.

# The baseline. What the last release on this channel published, so the next
# run can pack the difference instead of everything.
#
# It used to live in _dist (cleared by uninstall), then under LOCALAPPDATA
# (per machine, so a Dev Ship from a second machine started from nothing),
# then in the Thornswood-Releases clone for the channel (#437). Since #907 it
# is on the VPS beside the channel's feed, received above into the working
# folder, so every machine that ships reads the same baseline. Since #441 it is
# a copy of the record the feed's last release names, and the block "what was
# published" below reads that record from the site when this copy is missing
# or is not it.
# Pending notes stay under LOCALAPPDATA: they are about this machine's
# unfinished send, not about the channel.
$StateFile = Join-Path $ReleaseDir 'published.json'

# Pending resume notes stay per-machine under LOCALAPPDATA.
$legacyDir = & (Join-Path $PSScriptRoot 'Where.ps1') MachineData
$PendingDir = $legacyDir
if (-not (Test-Path -LiteralPath $PendingDir)) { New-Item -ItemType Directory -Path $PendingDir -Force | Out-Null }
$script:PendingFile = Join-Path $PendingDir $(if ($Dev) { 'published-dev-pending.json' } else { 'published-pending.json' })
$VersionFile = Join-Path $ReleaseDir 'version.json'

# ---- which Skyrim this release is made out of -----------------------------
#
# There used to be only one answer: the copy under Root that the installer
# built. A collection install makes no such copy, the game is the one Steam
# owns, and this stopped dead on "No build at C:\Thornswood\Game" while the
# launcher it had just built sat there working perfectly.
#
# Same test the launcher and the packager use, so all three agree about which
# Skyrim they are looking at.
function Get-SkyrimPath {
    $roots = @()
    # Either key may be missing (Steam writes one or the other), so each is
    # tested for, and a key without SteamPath names nothing.
    foreach ($k in @('HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\Wow6432Node\Valve\Steam')) {
        if (-not (Test-Path -LiteralPath $k)) { continue }
        $kp = Get-ItemProperty -LiteralPath $k
        if ($kp.PSObject.Properties['SteamPath'] -and $kp.SteamPath) { $roots += ([string]$kp.SteamPath -replace '/', '\') }
    }
    foreach ($r in @($roots)) {
        $vdf = Join-Path $r 'config\libraryfolders.vdf'
        if (Test-Path -LiteralPath $vdf) {
            foreach ($line in Get-Content -LiteralPath $vdf) {
                if ($line -match '^\s*"path"\s+"(.+)"\s*$') { $roots += ($Matches[1] -replace '\\\\', '\') }
            }
        }
    }
    foreach ($r in $roots) {
        $g = Join-Path $r 'steamapps\common\Skyrim Special Edition'
        if (Test-Path -LiteralPath (Join-Path $g 'SkyrimSE.exe')) { return $g }
    }
    return ''
}

# What never leaves a machine in a pack: runtime folders, one machine's own
# files, other servers' files, sign in tokens, and the collection's files in a
# Game folder the launcher made. The rules live in Ship-Rules.ps1, shared with
# Build-GameFiles.ps1, so the game files Velopack's package carries follow
# exactly the same rules as the packs (the old installer, which had its own
# list until 24 September, did not, and shipped a token file).
. (Join-Path $Here 'Ship-Rules.ps1')
# What a file of the repo ships as, from any machine (#2903).
. (Join-Path $Here 'ShippedBytes.ps1')

# Where the source of the SkyMP files is, and the GPL and AGPL texts, go inside
# every pack that carries one and inside the client runtime zip (#421).
. (Join-Path $Here 'Source-Notice.ps1')
$sourceRecord   = Join-Path $Here '..\..\records\client-build.json'
$sourceLicences = Join-Path $Here '..\..\installer\licences'

# The reference plugin list ships in the server's order, not in whatever order
# Vortex or LOOT last wrote it. The game compares its load order with the
# server's manifest position by position, and one name out of place from any
# index onwards is LOAD ORDER ERROR for the session; on 20 Sep the reference
# shipped in LOOT's order while the server ran Vortex's, the game showed that
# error and the launcher, comparing with the reference, said everything
# checked out. The rule is in LoadOrder.ps1, the same one the launcher's
# LoadOrder.cs applies to a machine's own list: only the full plugins the
# server names move, every other line keeps its place, and against a server
# that publishes its light order (#1715) its light plugins move too, into that
# order. Nothing on this machine is written: the copy that goes
# into the pack is made under _dist and removed once it is zipped.
. (Join-Path $Here '..\mods\LoadOrder.ps1')

# The server's light plugins in light index order (#1715), empty until
# Get-ReferenceInServerOrder reads a manifest that has them.
$script:serverLight = [string[]]@()
# -Out and -Quiet are for the order key (#2031), which reads the list in the
# server's order before anything is packed: its own file, and no second report.
function Get-ReferenceInServerOrder([string]$src, [string]$Out = '', [switch]$Quiet) {
    $url = Get-LoadOrderManifestUrl $Root
    $doc = Get-LoadOrderManifestDoc $url
    # Assigned straight from the property, never through an if expression,
    # which would hand a manifest of one plugin back as a bare name.
    $manifest = $null
    $script:serverLight = [string[]]@()
    if ($null -ne $doc) { $manifest = $doc.Full; $script:serverLight = $doc.Light }
    $script:serverManifest = $manifest
    $script:referenceList = $src
    # THE PLUGIN THAT LOADS LAST IS OURS, NOT VORTEX'S (#2468). The list is the
    # Vortex profile's, which has never heard of it, so a copy of it enables
    # Thornswood-Last.esp as its last line, and that copy is what is put into
    # the server's order and packed. The server's own order has it last too
    # (Deploy-DevGamemode.ps1 -LoadOrder), so it stays there.
    if (Test-ShipLastPluginHeld $RepoDir) {
        $src = Add-ShipLastPluginLine $src (Join-Path $DistDir 'reference-plugins-last.txt')
    }
    if ($null -eq $manifest) {
        Die "The server at $url did not answer with its manifest, so the reference plugin list cannot be put into its order. Start the server, or check the address and port in $Root\config.json, then publish again."
    }
    $file = Read-LoadOrderFile $src
    # A plain script block, not a closure: a closure runs in its own module
    # and cannot see the functions dot-sourced above. It finds $refData by
    # PowerShell's dynamic scoping, through Get-LoadOrderReordered.
    $refData = Join-Path $GameDir 'Data'
    $missing = @($file.Lines | ForEach-Object { Get-LoadOrderEnabledName $_ } |
        Where-Object { $_ -and -not [IO.File]::Exists((Join-Path $refData $_)) } | Select-Object -Unique)
    if ($missing.Count) {
        Die ("The reference plugin list at $src enables missing files: " + ($missing -join ', ') +
             '. Deploy the required mods, or switch off excluded plugins, before publishing either channel.')
    }
    $isLight = { param($n) Test-LoadOrderLight (Join-Path $refData $n) }
    # A server that loads light plugins publishes their order (#1715), and
    # then the pack's list goes out in the server's whole order, light
    # plugins included, so every machine that takes the pack has the light
    # indices the server stores light form ids under. Before this the light
    # lines kept whatever place Vortex or LOOT gave them: on 5 Oct the game
    # gave KhisartinBeards.esp light index 0x29 in the main sessions and 0x27
    # in the last dev one. Skyrim.ccc's names are the game's to load first
    # and are skipped, as the masters are; _ResourcePack.esl is light index 0.
    $ccc = @()
    $cccPath = Join-Path $GameDir 'Skyrim.ccc'
    if (Test-Path -LiteralPath $cccPath) { $ccc = @(Get-Content -LiteralPath $cccPath | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) }
    $whole = $doc.Light.Count -gt 0
    if ($whole) {
        $ordered = Get-LoadOrderReordered $file.Lines $doc.All $null $ccc
    } else {
        $ordered = Get-LoadOrderReordered $file.Lines $manifest $isLight
    }
    if ($null -eq $ordered) {
        # Assigned, not wrapped in @(): the function hands back one array,
        # and @() around it would nest that array inside another.
        if ($whole) { $off = Get-LoadOrderNotEnabled $file.Lines $doc.All $ccc } else { $off = Get-LoadOrderNotEnabled $file.Lines $manifest }
        if ($off.Count) {
            Die ("The server's load order names " + ($off -join ', ') + ", which the reference plugin list at $src does not enable. Enable it there, or deploy the server without it, then publish again.")
        }
        Die "The reference plugin list at $src enables the same plugin twice, so it cannot be put into the server's order."
    }
    $moved = Get-LoadOrderMoved $file.Lines $ordered
    if ($moved.Count -eq 0) {
        if (-not $Quiet) { Say ("  reference plugin list is already in the server's order ({0} plugins{1})" -f $manifest.Count, $(if ($whole) { ', ' + $doc.Light.Count + ' light' } else { '' })) 'DarkGray' }
        return $src
    }
    $tmp = if ($Out) { $Out } else { Join-Path $DistDir 'reference-plugins.txt' }
    Write-LoadOrderFile $tmp $ordered $file
    if (-not $Quiet) { Say ("  reference plugin list put into the server's order: {0} moved, the first {1}" -f $moved.Count, $moved.First) 'Yellow' }
    return $tmp
}

$IsCollection = -not (Test-Path -LiteralPath $GameDir)
# A Game folder the launcher made out of Vortex's deployment (OwnGame.cs) is
# not the old installer's copy: most of it is the collection, linked in.
$ownCollection = if ($IsCollection) { $null } else { Get-ShipOwnGameCollection $ProfileDir }
# A staged folder holds none of the collection's files (#2754): New-FeedRoot
# put only the last release's and this checkout's in it, so nothing in it is
# Vortex's and there is no files.txt to say so.
if ($FromFeed) {
    if ($IsCollection) { Die "-FromFeed publishes a folder New-FeedRoot.ps1 staged, and $GameDir is not there. Nothing was built." }
    $ownCollection = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
}

# No record, no release.
#
# Get-ShipOwnGameCollection reads Profile\OwnGame\files.txt, which is the only
# thing that knows which files in a launcher made Game folder came from Vortex
# and which are ours. Missing, it returns nothing, and every one of the
# collection's thirty thousand files then looks like ours to publish.
#
# That is not a theory. On 17 Sep an uninstall test removed Profile from the
# shipping machine, the record went with it, and the next release got as far as
# "29,063 added or changed (11,368.1 MB)" before it was stopped by hand. It
# would have pushed the entire mod collection to everybody as an update and
# overwritten mods Vortex owns.
#
# The folder can say what it is: a Game folder exists and the launcher made it,
# so the record must exist too. When it does not, something has been deleted,
# and guessing is the one thing that must not happen.
if (-not $IsCollection -and $null -eq $ownCollection) {
    Die ("$ProfileDir\OwnGame\files.txt is missing, and that is the only record of " +
         "which files in $GameDir came from Vortex." + [Environment]::NewLine + [Environment]::NewLine +
         "Without it every file the collection provides looks like one of ours and the " +
         "release would carry the whole collection." + [Environment]::NewLine + [Environment]::NewLine +
         "Open the launcher, go to Settings, Maintenance, and press Bring it up to date " +
         "from Vortex. That writes the record again. Then run this.")
}
if ($IsCollection) {
    $steamGame = Get-SkyrimPath
    if (-not $steamGame) {
        Die "There is no build at $GameDir and no Skyrim in any Steam library either. Nothing to publish out of."
    }
    $GameDir = $steamGame
    Write-Host ''
    Write-Host "  collection install, publishing out of the Steam copy:" -ForegroundColor DarkGray
    Write-Host "  $GameDir" -ForegroundColor DarkGray
}

# What the collection provides. Those files come down from Nexus through
# Vortex, so pushing our own copies of them as an update would put thirty
# thousand files nobody needs into every release and overwrite mods with
# whatever version this machine happens to hold.
$vortexFiles = $null
if ($IsCollection) {
    $vm = Join-Path $GameDir 'Data\vortex.deployment.json'
    if (Test-Path -LiteralPath $vm) {
        try {
            $vdoc = ((Get-Content -LiteralPath $vm -Raw) -replace '^\uFEFF', '') | ConvertFrom-Json
            $vortexFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
            foreach ($vf in @($vdoc.files)) {
                $r = [string]$vf.relPath
                if ($r) { [void]$vortexFiles.Add('Data\' + $r.TrimStart('\')) }
            }
            Write-Host ("  the collection provides {0:n0} file(s), which are not published" -f $vortexFiles.Count) -ForegroundColor DarkGray
        } catch {
            $vortexFiles = $null
            Write-Host '  the Vortex record could not be read, so this release would carry every mod file.' -ForegroundColor Red
            Die 'Refusing to publish the whole collection as an update. Deploy once in Vortex and run this again.'
        }
    } else {
        Write-Host "  no Vortex record at $vm" -ForegroundColor Red
        Die 'Refusing to publish the whole collection as an update. Deploy once in Vortex and run this again.'
    }
}
elseif ($FromFeed) {
    $vortexFiles = $ownCollection
    Write-Host ''
    Write-Host "  a folder staged from the $Channel feed, with none of the collection's files in it:" -ForegroundColor DarkGray
    Write-Host "  $GameDir" -ForegroundColor DarkGray
}
elseif ($null -ne $ownCollection) {
    $vortexFiles = $ownCollection
    Write-Host ''
    Write-Host "  Thornswood's own game folder, made from Vortex's deployment:" -ForegroundColor DarkGray
    Write-Host "  $GameDir" -ForegroundColor DarkGray
    Write-Host ("  the collection provides {0:n0} file(s), which are not published" -f $vortexFiles.Count) -ForegroundColor DarkGray
    if ($vortexFiles.Count -eq 0) {
        Die "The launcher's record of what came from Vortex (Profile\OwnGame\files.txt) lists nothing, so this release would carry every mod file. In the launcher, Settings, Maintenance, bring the folder up to date from Vortex, then publish again."
    }
}
# Patrick authorized shipping the completed repo content on both channels on
# 3 October. Revision 2 supplies the baseline; our packs supply subsequent
# fishing and crafting records. Updater unshares each destination before
# extraction, preserving Vortex staging and the independently updated channel.
# The behavior files and bodies are built on each computer by the launcher
# since #3715 and never ship (Ship-Rules Test-ShipGenerated), so nothing here
# reads the generated record any more.
function Test-FromCollection([string]$rel) {
    if ($null -eq $vortexFiles) { return $false }
    if (Test-ThornswoodRepoPlugin $rel) { return $false }
    return $vortexFiles.Contains($rel)
}
# Place plugins the load order names that Vortex does not deploy under that
# name (game\required-data). Without this, ElysiumEstateSSE.esp only existed on
# the machine that copied it by hand and packs never carried it.
try {
    $req = @(Ensure-ShipRequiredData $GameDir $RepoDir)
    if ($req.Count) {
        Say ("  required data placed into the game folder: {0}" -f ($req -join ', ')) 'Green'
    }
} catch {
    Die ("Could not place game\required-data into $GameDir : " + $_.Exception.Message)
}

# Hashed assets Data\Platform\UI\build.js names, parsed here, never kept by
# hand (#1318). Zero names, a named file that is missing, or a path with a
# slash all refuse the ship. The parsed names are written into the game
# folder so the pack carries them and OwnGame.Foreign can read them.
try {
    $script:ShipUiHashedWritten = @(Save-ShipUiHashedAssets $GameDir)
    Say ("  front hashed assets named by build.js: {0}" -f $script:ShipUiHashedWritten.Count) 'DarkGray'
} catch {
    Die $_.Exception.Message
}

$null = New-Item -ItemType Directory -Force -Path $DistDir

. (Join-Path $Here '..\dev\Close-Launcher.ps1')
# Every file below gets hashed and compared against what friends already have.
# A game still running underneath would publish a file that is mid-write.
# Ship -DryRun passes -NoClose so a dry run only logs what it would close (issue #494).
if ($NoClose) {
    $running = @(Get-GameProcesses -Root $Root)
    if ($running.Count -gt 0) {
        $names = ($running | ForEach-Object { $_.ProcessName } | Sort-Object -Unique) -join ', '
        Say ("  -NoClose: would close running game (" + $names + "), leaving it alone") 'Yellow'
    } else {
        Say '  -NoClose: no running game to close' 'DarkGray'
    }
} else {
    $null = Stop-Game -Root $Root
}

Head 'Thornswood - publish'

# ------------------------------------------------------------ what is ours
# The rules themselves are in Ship-Rules.ps1, dot-sourced above. Bethesda's
# files and other people's frameworks were the last list this file kept for
# itself, a shorter copy of the installer's, and on 24 September packs were
# carrying 90 files the installer left out. That list is in Ship-Rules too now.
$runtimeDirs = $ShipRuntimeDirs
function Test-Vanilla([string]$rel) { return ((Test-ShipVanilla $rel) -or (Test-ShipForeignFramework $rel)) }
function Test-Runtime([string]$rel) { return (Test-ShipRuntime $rel) }
function Test-OtherServer([string]$rel) { return (Test-ShipOtherServer $rel) }
# Other people's loose files as well (#1178): never packed, never recorded,
# never listed as removed. What waits for the collection is asked at the
# revision this release is built against.
$script:FeedMoveFrom = 0
if ($FromFeed) {
    # Nothing here has Vortex to ask: the revision is the one the feed says
    # its last release was built against, which only a collection Ship moves.
    $ShipCollectionRevision = 0
    try { $revDoc = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($VersionFile)) $VersionFile } catch { Die $_.Exception.Message }
    if ($revDoc.PSObject.Properties['collectionRevision']) { [void][int]::TryParse([string]$revDoc.collectionRevision, [ref]$ShipCollectionRevision) }
    if ($ShipCollectionRevision -le 0) { Die "The $Channel feed names no collection revision, so which held files ship is not known. A collection Ship on One names it. Nothing was built." }
    # The last release's plugin list goes forward, so this release is on the
    # last release's revision, and the feed may only say the recorded one
    # (#3597). When the record is ahead, the release moves up to it with the
    # servers' order as its plugin list (#4069, Get-ShipFeedMoveRevision and
    # the feed's plugin list block below).
    $feedMoveTo = Get-ShipFeedMoveRevision -RepoDir $RepoDir -Built $ShipCollectionRevision
    if ($feedMoveTo) {
        $script:FeedMoveFrom = $ShipCollectionRevision
        $ShipCollectionRevision = $feedMoveTo
        Say ("  the {0} feed's last release is on revision {1}; this release moves it to {2}" -f $Channel, $script:FeedMoveFrom, $feedMoveTo) 'Yellow'
    }
    $revWhy = Get-ShipCollectionRevisionProblem -RepoDir $RepoDir -Built $ShipCollectionRevision -Source "the $Channel feed's last release" -Remedy 'A release from the feed moves the revision only up to the recorded one, and only from a checkout with game\data\last-plugin.recipe and last-plugin.json. Nothing was built.'
    if ($revWhy) { Die $revWhy }
} else {
    $ShipCollectionRevision = Get-ShipCollectionRevision $Root
    # This machine's Vortex is what the plugin list, its order and the bodies
    # are read from, so it has to be on the revision the feed will name (#3597).
    $revWhy = Get-ShipCollectionRevisionProblem -RepoDir $RepoDir -Built $ShipCollectionRevision -Slug (Get-CollectionSlug (Get-ShipCollectionUrl $Root)) -Source "this machine's Vortex" -Remedy 'Update the collection in Vortex''s Thornswood profile to the recorded revision, let it deploy, close Vortex, then Ship again. Nothing was built.'
    if ($revWhy) { Die $revWhy }
}
# And the record has to be the newest revision published on Nexus (#4068).
$newestWhy = Get-ShipNewestRevisionProblem -RepoDir $RepoDir
if ($newestWhy) { Die $newestWhy }
Say ("  collection revision {0}: loose files held for the collection until then still ship" -f $ShipCollectionRevision) 'DarkGray'
function Test-Machine([string]$rel) { return ((Test-ShipMachine $rel) -or (Test-ShipNotOurs $rel)) }

# ---- another server's menu -------------------------------------------------
#
# that server's and another launchers write their own Data\Platform\UI\index.html
# over ours. Keep puts ours back before Play, but a release scans the game
# folder, not the kept copy, and until 25 September the machine that ships
# adopted newer game files (developer.flag), so theirs would have gone out to
# everyone as Thornswood's menu and nobody's chat would load.
# Ours is the one that loads thornswood-bridge.js, and it lives in the repo,
# so it is put back here, in the game and in the kept copy, before the scan.
$menuRel  = 'Data\Platform\UI\index.html'
$menuSrc  = Join-Path $RepoDir 'game\ui\index.html'
$menuLive = Join-Path $GameDir $menuRel
if ((Test-Path -LiteralPath $menuLive) -and (Test-Path -LiteralPath $menuSrc)) {
    if (-not ([IO.File]::ReadAllText($menuLive) -like '*thornswood-bridge.js*')) {
        Copy-ThornswoodShippedFile $menuSrc $menuLive
        $menuKept = Join-Path $ProfileDir "Keep\$menuRel"
        if (Test-Path -LiteralPath (Split-Path -Parent $menuKept)) { Copy-ThornswoodShippedFile $menuSrc $menuKept }
        Say "  $menuRel was another server's menu. Thornswood's put back from the repo." 'Yellow'
    }
}

Say '  Scanning the build...'
# The long path, which is what FullName starts with. $GameDir itself
# is the short 8.3 form when the build sits under a short TEMP
# (issue #1156).
$listedGame = (Get-Item -LiteralPath $GameDir).FullName
# Its own separator, so the keys come out the same off Windows (#2903): the
# record writes every path with backslashes.
$sep = [string][IO.Path]::DirectorySeparatorChar
$prefix = $listedGame.TrimEnd($sep) + $sep
$now = @{}
# Each file of ours is recorded by its bytes, '<size>:<sha256>', not by its
# file time (#441): the same bytes are the same entry on any machine, after a
# reinstall, and after something rewrites a file with what it already held.
# Measured 24 September: 891 files, 661.9 MB, about 14 seconds to hash.
$nowFile = @{}
$hashWatch = [Diagnostics.Stopwatch]::StartNew()
foreach ($f in (Get-ChildItem -LiteralPath $listedGame -Recurse -File -Force)) {
    $rel = $f.FullName.Substring($prefix.Length).Replace($sep, '\')
    if (Test-FromCollection $rel) { continue }
    if (Test-Vanilla $rel) { continue }
    if (Test-Runtime $rel) { continue }
    if (Test-Machine $rel) { continue }
    # Dev only files ride in dev packs and never in a main one (Ship-Rules).
    if (-not $Dev -and (Test-ShipDevOnly $rel)) { continue }
    if ($f.Extension -in '.pdb', '.log') { continue }
    $now[$rel] = Get-BaselineEntry $f.FullName
    $nowFile[$rel] = $f
}
Say ("  {0:n0} mod files, hashed in {1:n1} s" -f $now.Count, $hashWatch.Elapsed.TotalSeconds) 'Green'
$others = @(Get-ChildItem -LiteralPath (Join-Path $listedGame 'Data\Platform') -Recurse -File -Force -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName.Substring($prefix.Length).Replace($sep, '\') } | Where-Object { Test-OtherServer $_ })
if ($others.Count) { Say ("  {0} of another server's file(s) in Data\Platform left alone: {1}" -f $others.Count, (($others | ForEach-Object { Split-Path $_ -Leaf }) -join ', ')) 'DarkGray' }

# The reference plugin list is part of what ships, so a load order change on its
# own has to be enough to make a pack. Hashed rather than timestamped, because
# rewriting the same list is not a change worth sending anyone.
# From the feed there is no list here: the last release's goes forward,
# below, once that release has been read (#2754).
$shipReferenceDir = ''
if (-not $FromFeed) {
    $shipReferenceDir = Get-ShipLoadOrderDir $Root $ProfileDir
    foreach ($f in 'plugins.txt', 'loadorder.txt') {
        $src = Join-Path $shipReferenceDir $f
        if (Test-Path $src) { $now[":profile:$f"] = (Get-FileHash $src -Algorithm SHA256).Hash }
    }
}

# WHAT A SAVE ACTUALLY CARES ABOUT, kept apart from the hash above. The hash
# moves on any byte: line endings, a comment, the file rewritten in the same
# order. Until 27 September any of those put "The load order moved, so start a
# new character" under the release, and it went out on 1.1.95, 1.1.96 and dev
# 1.1.101.6 in two days, telling testers to throw characters away. A save only
# minds the plugins that are ON and the order they load in, so this key is that
# list and nothing else: the installed starred lines, in order, trimmed
# and lower cased. Absent plugins never loaded, so removing their references
# cannot break a save. A new key avoids comparing with older keys that counted
# absent files. The first release establishes that installed-only baseline.
#
# Installed is asked the way the game asks it, without regard to case: the
# names are the Data folder's own, lower cased once. Until #2989 each name was
# lower cased first and then asked of the folder, which on a machine whose
# folders care about case (a Ship from the cloud) found none of them, so every
# release's key was the key of an empty list. On Windows the key is unchanged.
function Get-ActiveOrderKey([string]$path, [string]$data = '') {
    $installed = @{}
    if ($data -and [IO.Directory]::Exists($data)) {
        foreach ($f in [IO.Directory]::EnumerateFiles($data)) { $installed[[IO.Path]::GetFileName($f).ToLowerInvariant()] = $true }
    }
    $on = @(Get-Content -LiteralPath $path -ErrorAction Stop |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_.StartsWith('*') } |
            ForEach-Object { $_.Substring(1).Trim().ToLowerInvariant() } |
            Where-Object { $_ -and (-not $data -or $installed.ContainsKey($_)) })
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($on -join "`n")) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}
# THE ORDER THAT SHIPS, NOT THIS MACHINE'S (#2031). Until 7 October the key was
# read from $orderSrc, the order Vortex or LOOT left on whichever machine
# shipped. The pack never carries that order: Get-ReferenceInServerOrder puts
# the list into the server's order first. So two releases from two machines
# disagreed even when they shipped the same list, and dev 20261006-141047-dev
# told testers to start a new character over a list whose 96 enabled plugins
# were the same, in the same order, as the release before (78 lines had moved
# into the server's order on the shipping machine). The key is taken from the
# list as it will be packed. A new key name for the 27 September reason: the
# first release after this has no key of the new kind to compare with, so it
# says nothing rather than comparing against a machine's own order.
$orderSrc = if ($shipReferenceDir) { Join-Path $shipReferenceDir 'plugins.txt' } else { '' }
if ($orderSrc -and (Test-Path $orderSrc)) {
    $orderTmp = Join-Path $DistDir 'reference-plugins-ordered.txt'
    try {
        $shippedList = Get-ReferenceInServerOrder $orderSrc $orderTmp -Quiet
        $now[':order:shippedPlugins'] = Get-ActiveOrderKey $shippedList (Join-Path $GameDir 'Data')
        # THE LAST PLUGIN IS BUILT FOR THESE BYTES OR IT DOES NOT SHIP (#2468).
        # It copies the winning records of this exact load order; against
        # any other it would undo what the newer plugin changed. Refused
        # here, before anything is packed, sent or posted.
        if (Test-ShipLastPluginHeld $RepoDir) {
            $lastEnabled = @(Get-Content -LiteralPath $shippedList | ForEach-Object { $_.Trim() } |
                             Where-Object { $_.StartsWith('*') } | ForEach-Object { $_.Substring(1).Trim() })
            $lastCcc = @()
            $lastCccPath = Join-Path $GameDir 'Skyrim.ccc'
            if (Test-Path -LiteralPath $lastCccPath) {
                $lastCcc = @(Get-Content -LiteralPath $lastCccPath | ForEach-Object { "$_".Trim() } |
                             Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $GameDir ('Data\' + $_))) })
            }
            $lastProblem = Get-ShipLastPluginProblem $RepoDir $lastEnabled $lastCcc
            if ($lastProblem) { throw ('LASTPLUGIN ' + $lastProblem) }
            Say ("  {0} was built against this release's load order and the collection's bytes" -f $ShipLastPlugin) 'DarkGray'
        }
    }
    catch {
        if ($_.Exception.Message.StartsWith('LASTPLUGIN ')) {
            Die ('Nothing was published, posted or told to a server: ' + $_.Exception.Message.Substring(11))
        }
        Say "  could not read the active plugin order from $orderSrc`: $($_.Exception.Message)" 'Yellow'
    }
    finally { Remove-Item -LiteralPath $orderTmp -Force -ErrorAction SilentlyContinue }
}

# The launcher's own source is not recorded here (#4825). It was, as :src:
# keys, while this published the launcher, so a release that changed only the
# launcher was not "nothing to do". No launcher goes on the feed now, so its
# source is no part of a release; a baseline that still has :src: keys reads
# them as gone, and every key that starts with ':' is never deleted (diff).

# The same bytes as the baseline this release publishes on the site (the
# release manifest block), so the store copy and the feed's record agree.
function Save-State {
    [void](Write-BaselineFile $now $StateFile)
}

# ==== thornswood publish resume ====
#
# A RELEASE THAT DID NOT PUSH IS NOT PUBLISHED, and until 23 September this
# file recorded it as published anyway: Save-State ran whatever happened to
# the push, so the baseline moved, and the next Ship compared the build
# against it, found nothing changed and stopped with "Nothing to do". The
# assets were on GitHub, version.json was not, no launcher could see the
# release, and the one command that would have fixed it refused to run.
#
# So the baseline only moves when the last step succeeded, and a failure is
# written down beside it: the id, when, and what went wrong. The next run
# reads that and FINISHES THAT RELEASE rather than minting a new id. Reusing
# the id is the whole point. The assets for it are already on the site, where
# a second send skips every one already there, and a new id would grow the
# feed by a release nobody can install.
#
# It lives under LOCALAPPDATA, not beside the shared baseline on the VPS, for
# the same reason: it is a note about this machine's unfinished send, not part
# of the channel, and the uninstaller cannot reach it. The dev channel has its
# own note.
function Get-PendingFile([string]$stateFile) {
    # Pending is machine-local under LOCALAPPDATA; the baseline ($stateFile) is
    # the channel's, received from the VPS and shared.
    if ($script:PendingFile) { return $script:PendingFile }
    if (-not $stateFile) { return '' }
    return ($stateFile -replace '\.json$', '') + '-pending.json'
}

function Read-Pending([string]$stateFile) {
    $f = Get-PendingFile $stateFile
    if (-not $f -or -not (Test-Path -LiteralPath $f)) { return $null }
    try {
        # A byte order mark is not JSON, and a note we cannot read is the same
        # as no note: never a reason to stop a release.
        $o = ((Get-Content -LiteralPath $f -Raw) -replace '^\uFEFF', '') | ConvertFrom-Json
        if (-not $o -or -not $o.PSObject.Properties['id'] -or -not $o.id) { return $null }
        return $o
    } catch { return $null }
}

# Each hands back '' when it did what it says, or a sentence saying what it
# could not do (#2711): until 18 Oct both ran in a try with an empty catch, so
# a note that was never written still let Done say the next run finishes this
# release, and one that was never removed was left to name a release already
# out. The caller says the sentence; the send it follows stands either way.
function Write-Pending([string]$stateFile, [string]$id, [string]$why) {
    $f = Get-PendingFile $stateFile
    if (-not $f) { return 'there is no place to keep the note' }
    try {
        [ordered]@{
            id  = $id
            why = $why
            at  = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
        } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $f -Encoding UTF8 -ErrorAction Stop
        return ''
    } catch { return ("the note that would finish $id could not be written to ${f}: " + $_.Exception.Message) }
}

function Clear-Pending([string]$stateFile) {
    $f = Get-PendingFile $stateFile
    if ($f -and (Test-Path -LiteralPath $f)) {
        try { Remove-Item -LiteralPath $f -Force -ErrorAction Stop }
        catch { return ("$f, the note of an unfinished release, could not be removed: " + $_.Exception.Message) }
    }
    return ''
}
# ==== end thornswood publish resume ====

# ==== thornswood baseline send ====
#
# THE BASELINE GOES BACK TO THE VPS WHEN IT MOVES (#907).
#
# Save-State writes published.json AFTER the feed is sent, on purpose, so it
# only moves once the release is really out; this sends it to the VPS beside
# the feed, through the same check the feed went through: nothing is replaced
# if the baseline up there is not the one this run received. Until #907 it was
# committed and pushed to Thornswood-Releases as "Baseline <id>".
#
# When it does not arrive the release is still out and nothing is broken: the
# VPS keeps the older baseline, and the next Ship packs these files again on
# top of it, a larger release carrying the same bytes. Said, not stopped on.
function Send-Baseline([string]$id) {
    if ($NoPush) { return }
    try {
        $r = Send-FeedStore $Channel $ReleaseDir @('published.json') -SiteDir $SiteDir
        if (@($r.Sent).Count) { Say "  baseline $id sent to the VPS" 'DarkGray' }
        else { Say '  baseline unchanged on the VPS' 'DarkGray' }
    } catch {
        Say "  the baseline did not reach the VPS: $($_.Exception.Message)" 'Yellow'
        Say '  The release is out. The next Ship packs these files again on top of the older baseline.' 'Yellow'
    }
}
# ==== end thornswood baseline send ====

# ==== thornswood what was published ====
# A RELEASE IS DIFFED AGAINST WHAT THE FEED LAST PUBLISHED (#441), not
# against whatever baseline a disk holds. Since this change every release
# names, in version.json, the record of what it left installed, sent to the
# site beside its packs. Resolve-ReleaseBaseline (Release-Baseline.ps1) uses
# the store's published.json only when it is that record, reads the record
# from the site when the store copy is missing or is not it, and rebuilds
# from the feed's own packs when the feed names none.
$feedPtr = $null
try { $feedPtr = Get-FeedBaselinePointer ((([IO.File]::ReadAllText($VersionFile)) -replace '^\uFEFF', '') | ConvertFrom-Json) }
catch { Die $_.Exception.Message }
if ($Baseline) {
    # Recording this build as published is only for a feed that does not say
    # what it published. One that does is the answer, whatever this build is.
    if ($null -ne $feedPtr) {
        Die ("-Baseline records this build as already published, and the $Channel feed already names what its last release left installed " +
             "(release $([string]$feedPtr.id)). Nothing was recorded. Run the release without -Baseline; it is diffed against that.")
    }
    Save-State
    Send-Baseline 'from -Baseline'
    Head 'Done'
    Say "Baseline recorded: $($now.Count) files." 'Green'
    Say 'Future runs will pack only what changes from here.' 'Gray'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit 0
}
$prev = @{}
$baselineFrom = ''
try {
    $resolved = Resolve-ReleaseBaseline $VersionFile $StateFile $DistDir (Get-FeedStoreSiteDir $SiteDir) $SiteUrl { param($m) Say $m 'Yellow' }
    $prev = $resolved.Map
    $baselineFrom = [string]$resolved.From
    foreach ($l in @($resolved.Lines)) { Say $l $(if ($baselineFrom -eq 'store') { 'DarkGray' } else { 'Yellow' }) }
} catch {
    Die ("No baseline for the $Channel channel, so nothing was built: " + $_.Exception.Message + ' ' +
         'The store has no published.json, the feed names no record of its last release, and its packs could not be read back. ' +
         'Failing everything else, run this once with -Baseline, which records this build as already published.')
}
if (-not $prev.Count) {
    Die ("No baseline for the $Channel channel: what was last published came back empty, so every file would look new. Nothing was built.")
}
# ==== end thornswood what was published ====

# ==== thornswood the feed's plugin list ====
# FROM THE FEED THE PLUGIN LIST IS THE LAST RELEASE'S (#2754). Nothing here has
# the collection, so the list, its hash and its order key go forward as the
# last release recorded them, the way the golden list goes forward below when
# no pack moved it. What a Ship from One asks of the list is asked of the
# server instead: Get-ShipFeedOrderProblem holds it to the order the channel's
# server loads, read off the box, and Thornswood-Last.esp to that order.
#
# A RELEASE THAT MOVES THE REVISION (#4069) carries the servers' order in its
# place, game\data\last-plugin.json's, written by New-ShipFeedMoveLists
# (Ship-Rules.ps1) the way the last release's list is, and held to the
# server below the same way. It goes in the pack and the record as a list
# from One does, so every launcher takes it.
$script:FeedMoveLists = $null
if ($FromFeed) {
    Head $(if ($script:FeedMoveFrom) { "Revision $ShipCollectionRevision's plugin list" } else { "The last release's plugin list" })
    foreach ($k in @($prev.Keys | Where-Object { $_ -like ':profile:*' -or $_ -like ':order:*' })) { $now[$k] = [string]$prev[$k] }
    $fromPtr = $null
    if (Get-Variable -Name resolved -Scope Script -ErrorAction SilentlyContinue) { $fromPtr = $resolved.Pointer }
    if (-not $prev.ContainsKey(':golden:plugins.txt') -or $null -eq $fromPtr) {
        Die "The $Channel feed's last release names no plugin list on the site, so a release from the feed has none to carry. A collection Ship from One makes one. Nothing was built."
    }
    $feedGoldenSha = ([string]$prev[':golden:plugins.txt']).Split(':')[1]
    $feedGolden = Join-Path $DistDir 'feed-plugins.txt'
    try { [void](Get-FeedAssetFile (Get-RecordFileUrl ([string]$fromPtr.url) $feedGoldenSha) $feedGoldenSha $feedGolden (Get-FeedStoreSiteDir $SiteDir) $SiteUrl) }
    catch { Die ("The last release's plugin list could not be read back from the site, so nothing was built: " + $_.Exception.Message) }
    if ($script:FeedMoveFrom) {
        if (-not $prev.ContainsKey(':golden:loadorder.txt')) { Die "The $Channel feed's last release names no loadorder.txt on the site, so where the game's own plugins go in revision $ShipCollectionRevision's list is not known. Nothing was built." }
        $feedLoSha = ([string]$prev[':golden:loadorder.txt']).Split(':')[1]
        $feedLo = Join-Path $DistDir 'feed-loadorder.txt'
        try { [void](Get-FeedAssetFile (Get-RecordFileUrl ([string]$fromPtr.url) $feedLoSha) $feedLoSha $feedLo (Get-FeedStoreSiteDir $SiteDir) $SiteUrl) }
        catch { Die ("The last release's loadorder.txt could not be read back from the site, so nothing was built: " + $_.Exception.Message) }
        try { $script:FeedMoveLists = New-ShipFeedMoveLists $RepoDir $feedGolden $feedLo (Join-Path $DistDir 'feed-move') }
        catch { Die ("Revision $ShipCollectionRevision's plugin list could not be written, so nothing was built: " + $_.Exception.Message) }
        $feedGolden = $script:FeedMoveLists.Plugins
        $now[':profile:plugins.txt'] = (Get-FileHash $script:FeedMoveLists.Plugins -Algorithm SHA256).Hash
        $now[':profile:loadorder.txt'] = (Get-FileHash $script:FeedMoveLists.LoadOrder -Algorithm SHA256).Hash
        $now[':order:shippedPlugins'] = Get-ActiveOrderKey $script:FeedMoveLists.Plugins ''
        Say ("  revision {0}'s list: {1} plugins from game\data\last-plugin.json, after the masters and {2}" -f $ShipCollectionRevision, $script:FeedMoveLists.Enabled.Count, $(if ($script:FeedMoveLists.Own.Count) { ($script:FeedMoveLists.Own.Count.ToString() + ' the game loads on its own') } else { 'nothing the game loads on its own' })) 'Green'
    }
    $feedEnabled = @([IO.File]::ReadAllLines($feedGolden) | ForEach-Object { $_.Trim() } |
                     Where-Object { $_.StartsWith('*') } | ForEach-Object { $_.Substring(1).Trim() })
    $feedBox = $null
    try { $feedBox = Read-ThornswoodServerContent -Channel $Channel }
    catch { Die ("The $Channel server's load order could not be read off the box, so nothing was built: " + $_.Exception.Message) }
    if (-not $feedBox.OrderRead) {
        Die ("The $Channel server's load order could not be read off the box, so nothing was built. It said: " + (@($feedBox.Said | Select-Object -First 5) -join ' | '))
    }
    $feedOrder = Get-ShipFeedOrderProblem $feedBox.Order $feedEnabled
    if ($feedOrder.Problem) { Die ('Nothing was published, posted or told to a server: ' + $feedOrder.Problem) }
    Say ("  {0} plugins enabled, the {1} server's order: the masters, {2}, then the list" -f $feedEnabled.Count, $Channel, $(if ($feedOrder.Ccc.Count) { $feedOrder.Ccc -join ', ' } else { 'no Creation Club plugin' })) 'Green'
    if (Test-ShipLastPluginHeld $RepoDir) {
        $lastProblem = Get-ShipLastPluginProblem $RepoDir $feedEnabled $feedOrder.Ccc
        if ($lastProblem) { Die ('Nothing was published, posted or told to a server: ' + $lastProblem) }
        Say ("  {0} was built against this release's load order and the collection's bytes" -f $ShipLastPlugin) 'DarkGray'
    }
}
# ==== end thornswood the feed's plugin list ====

# ------------------------------------------------------------ diff
Head 'Changes'
$changed = @(); $removed = @()
# Test-BaselineSame also reads an entry written before #441, size and file
# time, the way it was written, so the first release after the switch sends
# only what really changed and records every entry as a hash from then on.
$legacySame = 0
foreach ($k in $now.Keys) {
    if (-not $prev.ContainsKey($k)) { $changed += $k; continue }
    if ($prev[$k] -eq $now[$k]) { continue }
    $fk = if ($nowFile.ContainsKey($k)) { $nowFile[$k] } else { $null }
    if (Test-BaselineSame ([string]$prev[$k]) ([string]$now[$k]) $fk) { $legacySame++; continue }
    $changed += $k
}
if ($legacySame) { Say ("  {0:n0} file(s) compared by size and time, as the old baseline recorded them; recorded by hash from this release on" -f $legacySame) 'DarkGray' }
foreach ($k in $prev.Keys) { if (-not $now.ContainsKey($k)) { $removed += $k } }

$profileChanged = @($changed | Where-Object { $_ -like ':profile:*' })
# Only a real change to the active plugins and their order, and only when the
# last release recorded one to compare with: the first Ship after this key
# arrived has nothing to compare, and saying "start over" then would be the
# same false alarm this exists to stop. See Get-ActiveOrderKey.
$orderMoved     = $prev.ContainsKey(':order:shippedPlugins') -and $now.ContainsKey(':order:shippedPlugins') -and ($prev[':order:shippedPlugins'] -ne $now[':order:shippedPlugins'])
# Every key that starts with ':' is about the release, not a file in the game
# folder: the plugin list, the launcher's source until #4825, and since #1050 what the
# record says about itself (:record:), the plugin list as shipped (:golden:)
# and what is gone (:gone:). None of them is ever packed or deleted.
$changed        = @($changed | Where-Object { -not $_.StartsWith(':') })
$removed        = @($removed | Where-Object { -not $_.StartsWith(':') -and -not (Test-Machine $_) })
# ==== thornswood travels with ====
# A page's own pictures ride in any pack that carries the page, changed or not:
# see $ShipTravelsWith in Ship-Rules.ps1 (issue #883, the scroll's pictures).
foreach ($w in @(Get-ShipTravelsWith $changed)) {
    if ($now.ContainsKey($w)) { $changed += $w }
}
# ==== end thornswood travels with ====

# ---- what a removal is allowed to be --------------------------------------
#
# A removal becomes a line in delete.txt, and every launcher that takes the
# pack deletes that file. That is right for a mod we dropped. It is a disaster
# for a file the collection provides, because the collection lives in the same
# folder now, so deleting it takes the mod off somebody's machine while Vortex
# still believes it deployed it.
#
# Not hypothetical. The first release published after the move to the Steam
# copy carried 28,833 removals: the previous state described the old Game
# folder, the new scan excluded everything Vortex provides, and every one of
# those files therefore looked deleted. It had to be pulled back out of
# version.json by hand before anybody opened a launcher.
$collectionRemovals = @($removed | Where-Object { Test-FromCollection $_ }).Count
if ($collectionRemovals) {
    $removed = @($removed | Where-Object { -not (Test-FromCollection $_) })
}

# ---- and the ones that are deleted whether they were here or not ----------
#
# Leaving a file out of a pack stops it reaching NEW machines and does nothing
# for the ones that already have it, which are the machines the problem is on.
#
# 22 September, map.swf: excluded by Test-ShipOtherServer, released, and the
# pack carried no delete.txt at all, so every tester who already had the game
# kept the broken file and kept the SkyUI error box. It had only helped the
# people who did not have the problem.
#
# The ordinary diff could not catch it. It left the game folder, which is
# normally a removal, but the filter above reads the launcher's record of what
# Vortex provides and that record lists map.swf even though Vortex's own
# deployment manifest does not. So it was taken for a collection file and
# dropped. THAT GUARD IS RIGHT AND STAYS; this is the deliberate override
# beside it.
#
# Added AFTER the collection filter on purpose, so nothing here can be removed
# by it. See $ShipDeleteAlways in Ship-Rules.ps1 for what may go on the list.
#
# The removals this build really made are counted first. The rule paths go in
# every pack that goes out, but they are not a reason to send one: counted as
# removals they made every run a release, twice in a row included, and the
# "Nothing to do" checks below could never pass (#1012).
$realRemoved = $removed.Count
$alwaysGone = @(Get-ShipDeleteAlways)
foreach ($d in $alwaysGone) {
    if ($removed -notcontains $d) { $removed += $d }
}
if ($alwaysGone.Count) {
    Say ("  {0} path(s) are deleted from every install by rule, whether this machine had them or not" -f $alwaysGone.Count) 'DarkGray'
}

$changedBytes = 0
foreach ($c in $changed) { $changedBytes += [int64](($now[$c] -split ':')[0]) }
if ($profileChanged.Count) { Say '  the plugin list changed' 'Green' }
Say ("  {0:n0} added or changed ({1:n1} MB)" -f $changed.Count, ($changedBytes / 1MB)) $(if ($changed.Count) { 'Green' } else { 'DarkGray' })
Say ("  {0:n0} removed" -f $realRemoved) $(if ($realRemoved) { 'Yellow' } else { 'DarkGray' })
if ($collectionRemovals) {
    Say ("  {0:n0} more were the collection's files, left alone" -f $collectionRemovals) 'DarkGray'
}

# ==== thornswood release size ====
#
# A RELEASE THE SIZE OF THE COLLECTION IS THE COLLECTION, NOT AN UPDATE.
#
# 17 September: an uninstall test took Profile off this machine, and with it
# Profile\OwnGame\files.txt, the one record of which files came from Vortex.
# The next release counted "29,063 added or changed (11,368.1 MB)" and was one
# step from sending the whole mod collection to everybody when it was stopped
# by hand. The files.txt refusal further up stops that one cause. This stops
# the size, whatever the cause is next time, before anything is zipped or
# uploaded, instead of relying on somebody reading the number as it scrolls
# past.
#
# The cap sits far above anything real. Everything the packs have ever
# shipped, the whole baseline, measured 891 files and 661.9 MB on 24
# September, so a release of every file we own is a fifth of the cap and an
# ordinary one is a few MB. The incident is 3.7 times over it.
#
# This looks at the total, before anything is zipped. A release is one pack;
# nothing later caps that zip or splits it.
#
# Kept between these markers so tests\test-release-size.ps1 can run the real
# thing against the incident's own number.
function Get-ReleaseSizeRefusal([int64]$Bytes, [int64]$CapMB, [bool]$Accepted) {
    if ($Accepted) { return '' }
    if ($Bytes -le ($CapMB * 1MB)) { return '' }
    return ("This release would send {0:n1} MB to every machine that takes it, and the cap is {1:n0} MB." -f ($Bytes / 1MB), $CapMB)
}
# ==== end thornswood release size ====

$tooBig = Get-ReleaseSizeRefusal $changedBytes $MaxReleaseMB $AcceptSize.IsPresent
if ($tooBig) {
    Write-Host ''
    Say $tooBig 'Red'
    Say 'That is the size of the mod collection, not of an update. The last release' 'Red'
    Say 'this big had lost Profile\OwnGame\files.txt, so every file Vortex provides' 'Yellow'
    Say 'looked like one of ours.' 'Yellow'
    Write-Host ''
    Say 'The biggest here are:' 'DarkGray'
    foreach ($c in @($changed | Sort-Object { [int64](($now[$_] -split ':')[0]) } -Descending | Select-Object -First 12)) {
        Say ("    {0,10:n1} MB  {1}" -f ([int64](($now[$c] -split ':')[0]) / 1MB), $c) 'DarkGray'
    }
    Write-Host ''
    Say 'If every one of those really should go to everybody, run Ship again with' 'Yellow'
    Say '-AcceptSize. If not, find out what the build has started counting as ours.' 'Yellow'
    Die 'Nothing was published.'
}

# Whatever survives that, a release does not delete hundreds of files by
# accident. If it genuinely should, -AcceptRemovals says so out loud.
if ($removed.Count -gt $MaxRemovals -and -not $AcceptRemovals) {
    Write-Host ''
    Say ("This release would delete {0:n0} files from every machine that takes it." -f $removed.Count) 'Red'
    Say 'That is almost always a baseline problem rather than a real removal:' 'Red'
    Say "$StateFile describes the last build this channel published," 'Yellow'
    Say 'and if what counts as "the build" has moved, everything outside the new' 'Yellow'
    Say 'scope looks deleted at once.' 'Yellow'
    Write-Host ''
    Say 'The first few here are:' 'DarkGray'
    foreach ($r in @($removed | Sort-Object | Select-Object -First 12)) { Say "    $r" 'DarkGray' }
    Write-Host ''
    Say 'If every one of those really should go from everybody, run this again' 'Yellow'
    Say "with -AcceptRemovals. If not, delete $StateFile to start the baseline" 'Yellow'
    Say 'again: the next release is large and deletes nothing.' 'Yellow'
    Die 'Nothing was published.'
}



# NOTHING NEW IS NO RELEASE, AND EXIT CODE 2 SAYS SO, whichever way it is run.
#
# Running Ship twice in a row used to cut a second release that carried
# nothing: no mod files, no removals, just a higher version number that
# everyone still had to download. Exit code 2 tells Ship that happened, so it
# tells nobody.
#
# Without a launcher this used to exit 0. Since #921 a Ship whose launcher
# sources were unchanged ran this without one (and since #4825 every Ship
# does), and 0 is what a release that went out returns, so Ship went on to
# its after-release steps. Measured
# 6 Oct: a dev Ship from main 2a8ebc9b printed "Nothing to do", then posted
# the previous night's note to the dev updates channel a second time and told
# the dev server "update in 5 min" for a release that did not exist.
#
# A DEV PUBLISH WITH NOTHING NEW STILL MARKS THE DEV FEED (Dev-News.ps1). Its
# DEV marks and mainVersion follow main's feed, and they used to be worked out
# only further down, on the way to a release, so a dev Ship made to bring them
# up to date stopped here and left them as they were. The marks are sent alone,
# version.json only and only when one moved, with no release.
#
# THE NOTE IS NOT ADDED. A note goes out with the release it describes: its
# sourceCommit, its download size and the Discord post all belong to one, and
# this run has none. Nothing on the dev feed writes a note without a release.
if (-not $changed.Count -and -not $realRemoved -and -not $profileChanged.Count) {
    Head 'Nothing to do'
    Say 'The build matches what is already published.' 'Gray'
    Say 'Nothing was released, so nothing was added to the news.' 'Gray'
    if ($Dev) {
        Head "The dev feed's DEV marks"
        try {
            $marks = Update-DevFeedMarks -SourceRepo $RepoDir -Dir $ReleaseDir -Received -NoSend:$NoPush -SiteDir $SiteDir -SiteUrl $SiteUrl
            $markLines = @(Get-DevFeedMarksLines $marks -NoSend:$NoPush)
            foreach ($l in $markLines) { Say "  $l" 'DarkGray' }
            $global:ThornswoodDevMarks = [pscustomobject]@{ Done = $true; Lines = $markLines }
        } catch {
            Say "  the dev marks were NOT refreshed: $($_.Exception.Message)" 'Yellow'
            $global:ThornswoodDevMarks = [pscustomobject]@{ Done = $false; Lines = @($_.Exception.Message) }
        }
    }
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit 2
}

# ==== thornswood content on the server first ====
# THE SERVER GETS THE CONTENT PLUGIN FIRST, THEN THE SHIP (#2308).
#
# On 11 Oct dev 20261011-221215-dev sent clients a new Thornswood-Content.esp
# (146,381 bytes), and Ship went on to post it, tell the dev server to restart
# and push its tag, while the dev server still had the old one (146,446 bytes):
# for eight minutes every dev client that updated held a plugin the server it
# joined did not. Nothing here asked what the server held.
#
# So a release whose content plugin is not the one this channel's last release
# carried (the baseline the diff above read, so "changes the plugin" is the
# same question the pack answers) asks the channel's server which one it
# holds, and goes on only when that is the same size and sha256. Anything else
# stops here, before anything is packed, sent, posted or told to a server, and
# names the command that sends the plugin there. A box that does not answer is
# a refusal too. ServerContent.ps1 says why the box is read over ssh rather
# than through the server's manifest. A dry run (-NoUpload -NoPush) asks the
# same and stops the same, so it says what the real Ship would do.
# Every plugin of ours (RepoPlugins.ps1), not the content plugin alone: since
# #2486 Thornswood-Last.esp reaches clients from the repo too, under the same
# rule, and since #2791 as its recipe, from which the launcher makes the
# plugin game\data\last-plugin.json names. So a release whose recipe changed
# asks the server for that plugin, which the deploy made on the box.
$contentChanged = @($changed | Where-Object { (Test-ThornswoodRepoPlugin $_) -or $_ -ieq 'Data\Thornswood-Last.recipe' })
if ($contentChanged.Count) {
    Head 'Our plugins on the server'
    $contentBox = $null
    try { $contentBox = Read-ThornswoodServerContent -Channel $Channel }
    catch { $contentBox = [pscustomobject]@{ Answered = $false; Bytes = [int64]-1; Sha = ''; Order = @(); OrderRead = $false; Ours = @{}; Said = @($_.Exception.Message) } }
    foreach ($contentRel in $contentChanged) {
        $contentName = Split-Path -Leaf $contentRel
        $contentEntry = [string]$now[$contentRel]
        if ($contentRel -ieq 'Data\Thornswood-Last.recipe') {
            $contentName = $ThornswoodLastPlugin
            $lastShipWant = Get-ThornswoodLastPluginWant $RepoDir
            $contentEntry = if ($lastShipWant) { '{0}:{1}' -f $lastShipWant.Bytes, $lastShipWant.Sha } else { '' }
        }
        $pluginBox = Get-ThornswoodServerPlugin $contentBox $contentName
        $contentProblem = Get-ThornswoodContentShipProblem $Channel $contentEntry $pluginBox $contentName
        if ($contentProblem) {
            Die ('Nothing was published, posted or told to a server: ' + $contentProblem)
        }
        Say ("  the {0} server already holds this release's {1} ({2:N0} bytes, the same sha256)" -f $Channel, $contentName, $pluginBox.Bytes) 'Green'
    }
}
# ==== end thornswood content on the server first ====

# The feed as received, for the ids it already uses (#1057).
$feedNow = if (Test-Path -LiteralPath $VersionFile) { ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($VersionFile)) $VersionFile } else { $null }
if (-not $Id) {
    # An unfinished release is finished, not replaced. See the block beside
    # Save-State for why the id matters more than the timestamp.
    $resume = Read-Pending $StateFile
    if ($resume) {
        $Id = [string]$resume.id
        Write-Host ''
        Say ("Finishing release $Id, which did not get out: " +
             $(if ($resume.PSObject.Properties['why']) { [string]$resume.why } else { 'the push failed' })) 'Yellow'
        Say '  Its assets are already on the site, so this sends only what is missing' 'DarkGray'
        Say '  rather than making a second release.' 'DarkGray'
    } else {
        # Never one the feed already names (#1057): see New-ReleaseId.
        $Id = New-ReleaseId $feedNow -Dev:$Dev
    }
} elseif ((Get-FeedTakenIds $feedNow).Contains($Id)) {
    $resume = Read-Pending $StateFile
    if (-not $resume -or [string]$resume.id -ne $Id) {
        Die "The feed already has a release or pack named $Id. A launcher that took it would skip this one as applied. Leave -Id out and a free one is made."
    }
}

# ------------------------------------------------------------ pack
# One zip for the release. It goes to the site as
# /feed[-dev]/assets/<sha256> by scp. Nothing on that path caps one asset,
# so a release is not split into parts. version.json still lists the pack,
# and a release that is only removals or a plugin-list change is one pack
# with no game files. The release size gate above refuses a send the size
# of the whole collection before this zips anything.
Add-Type -AssemblyName System.IO.Compression.FileSystem

$chunks = @()
# The reference plugin list as a pack carries it, kept for the release record.
$goldenDir = Join-Path $DistDir ('record-golden-' + $Id)
if (Test-Path -LiteralPath $goldenDir) { Remove-Item -LiteralPath $goldenDir -Recurse -Force }
if ($changed.Count -or $removed.Count -or $profileChanged.Count) {
    Head 'Building the pack'

    # One part, whatever the release contains. The site takes the zip as a
    # file and has no asset cap this used to split on.
    $groups = @(,$changed)

    for ($g = 0; $g -lt $groups.Count; $g++) {
        $part   = $g + 1
        $partId = if ($groups.Count -eq 1) { $Id } else { "$Id-$part" }
        $zipPath = Join-Path $DistDir "pack-$partId.zip"
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

        $zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
        try {
            $n = 0
            foreach ($rel in $groups[$g]) {
                $src = Join-Path $GameDir $rel
                if (-not (Test-Path -LiteralPath $src)) { continue }
                [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, ('game/' + ($rel -replace '\\', '/')), 'Optimal')
                $n++
                if ($n % 500 -eq 0) { Write-Host ("    part $part  {0:n0}/{1:n0}" -f $n, $groups[$g].Count) -ForegroundColor DarkGray }
            }
            $inPart = @($groups[$g] | Where-Object { Test-Path -LiteralPath (Join-Path $GameDir $_) })
            Add-SourceNoticeToZip $zip (Get-SourceNoticeEntries $sourceRecord $inPart 'pack' $sourceLicences)

            # Removals go in the first part, so nothing is deleted after the
            # files that replace it have already arrived.
            if ($part -eq 1 -and $removed.Count) {
                $e = $zip.CreateEntry('delete.txt')
                $sw = New-Object IO.StreamWriter ($e.Open())
                foreach ($rel in $removed) { $sw.WriteLine(($rel -replace '\\', '/')) }
                $sw.Flush(); $sw.Dispose()
            }

            # The hashed assets build.js named, for audit and for OwnGame
            # (#1318). The same names are in the game file thornswood-ui-assets.txt.
            $uiNames = @($script:ShipUiHashedWritten)
            if ($uiNames.Count) {
                $ue = $zip.CreateEntry('ui-assets.txt')
                $uw = New-Object IO.StreamWriter ($ue.Open())
                $uw.WriteLine('# hashed assets build.js named, #1318')
                foreach ($n in $uiNames) { $uw.WriteLine($n) }
                $uw.Flush(); $uw.Dispose()
            }

            # The load order rides in the last part. Anyone who stops halfway
            # then has the new files sitting there but not yet switched on,
            # which is the harmless way round.
            #
            # Where the reference list lives depends on which kind of build this
            # is, and it has been both.
            #
            # With a Game folder of our own, %LOCALAPPDATA%\Skyrim Special
            # Edition is only this build's folder while the game is running, so
            # publishing with the game closed shipped the ordinary Skyrim's
            # plugin list as the reference and every launcher that took the
            # update overwrote its own correct list with it. Hence Profile\Default.
            #
            # A collection build has no Game folder. The game IS the Steam copy,
            # Vortex writes the plugin list into AppData, nothing swaps it about,
            # and Profile\Default is empty and always will be. Reading it there
            # stops a release dead with "that file is this build's reference
            # plugin list", which is how 1.1.1 failed to publish.
            #
            # Same test the launcher uses to decide the same thing. A folder
            # made from Vortex keeps the Vortex profile's list as it stood when
            # the folder was last brought up to date, which is the collection's
            # order. Get-ShipLoadOrderDir (Ship-Rules.ps1) picks between the
            # three, the same for the installer.
            # From the feed the list goes forward in the record alone (the
            # feed's plugin list block): it did not move, so no pack carries it.
            # A release that moves the revision from the feed carries its
            # new list as a pack from One does (#4069).
            if ($part -eq $groups.Count -and $FromFeed -and $script:FeedMoveLists) {
                foreach ($f in 'plugins.txt', 'loadorder.txt') {
                    $src = if ($f -eq 'plugins.txt') { $script:FeedMoveLists.Plugins } else { $script:FeedMoveLists.LoadOrder }
                    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, "profile/$f", 'Optimal')
                    New-Item -ItemType Directory -Force -Path $goldenDir | Out-Null
                    Copy-Item -LiteralPath $src -Destination (Join-Path $goldenDir $f) -Force
                }
            }
            if ($part -eq $groups.Count -and -not $FromFeed) {
                $ownGame = Join-Path $Root 'Game'
                $isCollection = -not (Test-Path -LiteralPath $ownGame)
                $refDir = Get-ShipLoadOrderDir $Root $ProfileDir
                if ($isCollection) {
                    Say "  reference load order from the Vortex profile: $refDir" 'DarkGray'
                }
                elseif ($refDir -eq (Join-Path $ProfileDir 'OwnGame')) {
                    Say "  reference load order from the Vortex profile, as of the folder's last update: $refDir" 'DarkGray'
                }
                foreach ($f in 'plugins.txt', 'loadorder.txt') {
                    $src = Join-Path $refDir $f
                    if (-not (Test-Path $src)) {
                        Die ("$src is missing. That file is this build's reference plugin list." + $(if ($isCollection) {
                             " This is a collection build, so it comes from the profile Vortex deployed. Open the game once through the launcher, or switch to the Thornswood profile in Vortex and deploy, then publish again." } else { "" }))
                    }
                    # plugins.txt goes in the server's order; see
                    # Get-ReferenceInServerOrder. The file at $src is read and
                    # never written.
                    if ($f -eq 'plugins.txt') { $src = Get-ReferenceInServerOrder $src }
                    elseif (Test-ShipLastPluginHeld $RepoDir) {
                        $src = Add-ShipLastPluginLine $src (Join-Path $DistDir 'reference-loadorder-last.txt') -Plain
                    }
                    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, "profile/$f", 'Optimal')
                    # The same bytes go in the release record (#1050), so a
                    # launcher that syncs to it gets the list the pack carries.
                    New-Item -ItemType Directory -Force -Path $goldenDir | Out-Null
                    Copy-Item -LiteralPath $src -Destination (Join-Path $goldenDir $f) -Force
                }
            }
        } finally {
            $zip.Dispose()
            Remove-Item -LiteralPath (Join-Path $DistDir 'reference-plugins.txt') -Force -ErrorAction SilentlyContinue
            foreach ($t in 'reference-plugins-last.txt', 'reference-loadorder-last.txt') {
                Remove-Item -LiteralPath (Join-Path $DistDir $t) -Force -ErrorAction SilentlyContinue
            }
        }

        $bytes = (Get-Item $zipPath).Length
        $mb = [math]::Round($bytes / 1MB, 1)
        Say "  pack-$partId.zip  -  $mb MB" 'Green'

        $chunks += [pscustomobject]@{
            Id   = $partId
            Path = $zipPath
            Sha  = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
            Url  = ''
        }
    }
}

# ==== thornswood packs gone ====
# tests\test-record-sync.ps1 runs the real publisher through this, and
# tests\test-feed-rules.ps1 runs the feed append block with what it decides.
#
# THE PACKS COME OFF THE FEED ONCE NO LAUNCHER ALLOWED IN NEEDS ONE (#1050).
# Every launcher from the first one with Sync.cs syncs the install to the
# record file by file and never replays a pack (Release-Baseline.ps1,
# $FeedFirstSyncLauncher, says which numbers and how they were read). The feed
# lets in nothing below minLauncher, the last launcher the feed sent (the
# feed's launcher fields, below: nothing moves it since #4825, read as the site reads it, the
# feed's launcherVersion when it names none). So when that is at or above the
# first syncing launcher on this channel, and the last record already had all
# its files on the site (so its :gone: list, started from the packs, carries
# what they took out), this release adds no pack and the feed's "packs" goes
# to []: measured 12 Oct, 47,950 of main's 95,085 bytes and 66,018 of dev's
# 111,305. An older launcher still updates: with no pack waiting it is offered
# the feed's launcher, takes it through the signed self-update, and that one
# syncs. The pack is still built, because Check-Secrets reads what this release
# changed out of it, and it stays in the staging folder; it is not sent.
$minAfter = ''
if ($null -ne $feedNow) {
    foreach ($k in 'minLauncher', 'launcherVersion') {
        if ($feedNow.PSObject.Properties[$k] -and [string]$feedNow.$k) { $minAfter = [string]$feedNow.$k; break }
    }
}
$packsGone = (Test-FeedPacksGone $Channel $minAfter) -and $prev.ContainsKey($RecordFilesKey)
if ($packsGone) {
    Say ("  no pack goes on the feed: every launcher let in (from {0}) syncs to the record file by file, the first on {1} being {2}" -f
         $minAfter, $Channel, $FeedFirstSyncLauncher[$(if ($Dev) { 'dev' } else { 'main' })]) 'DarkGray'
}
# ==== end thornswood packs gone ====

# ------------------------------------------------------------ upload
$doc = ConvertFrom-ThornswoodJson (Get-Content $VersionFile -Raw) $VersionFile

# ConvertFrom-Json gives back an object with only the keys the file had, and
# assigning to a key that was never there throws. Anything new has to be added.
function Set-Prop($obj, [string]$name, $value) {
    if ($obj.PSObject.Properties.Name -contains $name) { $obj.$name = $value }
    else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

# And reading one that is not there throws outright under strict mode, which is
# how a missing ServerPassword quietly took the whole server block down once.
function Val($o, [string]$k) {
    if ($null -ne $o -and $o.PSObject.Properties.Name -contains $k) { return [string]$o.$k }
    return ''
}
Say "  downloads go to $SiteUrl/$(if ($Dev) { 'feed-dev' } else { 'feed' })/assets/" 'DarkGray'

# Which urls a launcher can download (Feed-Rules.ps1). Since #907 that is the
# thornswood.net feed asset path: nothing is uploaded to GitHub any more, and
# the feed block below refuses a new pack named anywhere else.
. (Join-Path $Here 'Feed-Rules.ps1')

# ---- the client runtime, as an asset with an address ----------------------
#
# WHY IT IS NOT LEFT TO THE PACKS. A pack carries what CHANGED, and the six
# files in client-build.json change a few times a month, so they are in a pack
# only on the releases where they happened to move and absent from every other
# one. On 22 September the launcher learned to repair a missing client file and
# there was nothing on the feed to repair FROM: the four packs published after
# the client was recorded that morning were 3 MB, 0, 0 and 0, and
# SkyrimPlatformImpl.dll alone is 15.6 MB. It had to be forced by clearing six
# entries out of the publish baseline by hand.
#
# That worked and it is not a mechanism. So the runtime gets its own asset and
# its own line in version.json, and ClientRuntime.Heal asks for it by address
# instead of walking forty updates hoping to trip over it.
#
# PUBLISHED ONLY WHEN IT CHANGES. The name carries the fork commit, so a build
# that is already on the feed is already uploaded and this does nothing. 18 MB
# on every release for six files that move a few times a month is exactly what
# this is avoiding.
$clientZip = ''
$clientRel = $null
try {
    $cbPath = Join-Path $PSScriptRoot '..\..\records\client-build.json'
    if (Test-Path -LiteralPath $cbPath) {
        $cb = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $cbPath -Raw) $cbPath
        $cbCommit = [string]$cb.forkCommit
        $have = $null
        if ($doc.PSObject.Properties['clientRuntime']) { $have = $doc.clientRuntime }
        $already = ($null -ne $have) -and ($have.PSObject.Properties['forkCommit']) -and
                   ([string]$have.forkCommit -eq $cbCommit) -and
                   ($have.PSObject.Properties['url']) -and ([string]$have.url).Length -gt 0 -and
                   ($have.PSObject.Properties['notice']) -and ([int]$have.notice -ge $SourceNoticeVersion)
        if ($already) {
            Say "  client runtime $cbCommit is already on the feed" 'DarkGray'
        } else {
            $names = @($cb.files.PSObject.Properties.Name)
            $stage = Join-Path $DistDir ("client-runtime-" + $cbCommit)
            if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
            $missingClient = @()
            foreach ($n in $names) {
                $src = Join-Path $GameDir $n
                if (-not (Test-Path -LiteralPath $src)) { $missingClient += $n; continue }
                $dst = Join-Path $stage $n
                New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
                Copy-Item -LiteralPath $src -Destination $dst -Force
            }
            if ($missingClient.Count) {
                foreach ($m in $missingClient) { Say "  client runtime file missing from the build: $m" 'Red' }
                Die 'The client runtime is incomplete in the game folder, so it was not published. Run scripts\release\Sync-Client.ps1 and ship again.'
            }
            # The note, the GPL and AGPL texts, and licences\ (#3099).
            Write-SourceNoticeToFolder $stage (Get-SourceNoticeEntries $cbPath $names 'runtime' $sourceLicences)
            $clientZip = Join-Path $DistDir ("client-runtime-" + $cbCommit + ".zip")
            if (Test-Path -LiteralPath $clientZip) { Remove-Item -LiteralPath $clientZip -Force }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [IO.Compression.ZipFile]::CreateFromDirectory($stage, $clientZip, [IO.Compression.CompressionLevel]::Optimal, $false)
            Remove-Item -LiteralPath $stage -Recurse -Force
            $clientRel = [pscustomobject]@{
                name       = [IO.Path]::GetFileName($clientZip)
                path       = $clientZip
                sha256     = (Get-FileHash $clientZip -Algorithm SHA256).Hash.ToLower()
                bytes      = (Get-Item -LiteralPath $clientZip).Length
                forkCommit = $cbCommit
                url        = ''
            }
            Say ("  client runtime {0} packed, {1:N1} MB" -f $cbCommit, ($clientRel.bytes / 1MB)) 'Green'
        }
    }
} catch {
    Say "  the client runtime could not be prepared: $_" 'Yellow'
    $clientRel = $null
}

# ---- nothing that must never ship, read off what was built ----------------
#
# Entry 236. Ship-Rules decides what goes into a pack, and twice a secret got
# past it because nobody had listed the file yet: the SkyMP sign in in the
# installer, and voice-token.txt in nine main packs from 18 to 20 September.
# Check-Secrets reads what was actually built, every pack and the client
# runtime, and stops the release here, before anything is uploaded, on a
# credential by name or by shape or on a file Ship-Rules says never ships.
# It prints the file, the line and the rule, never the value. Measured on 24
# September over the 54 packs and 2 client runtimes on Patrick's machine: the
# two dev packs that carried a token and the 16 September one that carried
# five files the rules keep out now fail, and the other 53 pass.
$scanZips = @($chunks | ForEach-Object { $_.Path })
if ($clientRel) { $scanZips += $clientRel.path }
if ($scanZips.Count) {
    Head 'Checking for secrets'
    & (Join-Path $Here '..\dev\Check-Secrets.ps1') -Zip $scanZips
    if ($LASTEXITCODE -ne 0) { Die 'Something that must never ship is in what was just built. The lines above name each file and rule. Nothing was uploaded.' }
}

if (-not $NoUpload) {
    # ==== thornswood site upload ====
    # site\tests\test-site-assets.ps1 runs this block on its own. If the markers
    # move, it stops rather than quietly testing nothing.
    #
    # UPDATES COME FROM THE SITE (#897). Every asset this release adds goes to
    # /feed[-dev]/assets/<sha256> on thornswood.net, the path site\server.js
    # already serves with Range resume, and the feed names it there. It goes
    # up BEFORE version.json is touched, the rule the GitHub path kept:
    # nothing is written to the feed if an asset did not land, so nobody is
    # sent a pack the site does not hold. Remirror-Site-Feed.ps1 -Send is the
    # one way bytes reach the site, .part then rename, skipping any already up.
    Head 'Sending to the site'
    $siteFiles = @()
    # No pack once the packs are off the feed (the packs gone block): nothing
    # would name it.
    if (-not $packsGone) { foreach ($c in $chunks) { $siteFiles += $c.Path } }
    if ($clientRel) { $siteFiles += $clientRel.path }
    if ($siteFiles.Count) {
        $sendArgs = @{ Dev = $Dev; Send = $siteFiles }
        if ($SiteDir) { $sendArgs['SiteDir'] = $SiteDir }
        $global:LASTEXITCODE = 0
        $sendWhy = ''
        try { & (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') @sendArgs }
        catch { $sendWhy = $_.Exception.Message }
        if (-not $sendWhy -and $LASTEXITCODE -ne 0) { $sendWhy = "Remirror-Site-Feed.ps1 -Send exited $LASTEXITCODE" }
        if ($sendWhy) {
            Say "  $sendWhy" 'Red'
            Die ('Not every asset reached the site, so version.json has not been touched and nobody has been sent a half release. ' +
                 'Check the ssh key with scripts\vps\Setup-SshKey.ps1 -Test, then run Ship again.')
        }
    }
    if (-not $packsGone) { foreach ($c in $chunks) { $c.Url = Get-HostFeedAssetUrl $c.Sha -Dev:$Dev } }
    if ($clientRel) { $clientRel.url = Get-HostFeedAssetUrl $clientRel.sha256 -Dev:$Dev }
    if ($chunks.Count -and -not $packsGone) { Say "  $($chunks.Count) pack asset$(if ($chunks.Count -eq 1) { '' } else { 's' }) on the site" 'Green' }
    if ($clientRel) { Say '  client runtime on the site' 'Green' }
    # ==== end thornswood site upload ====
}

# ==== thornswood record files ====
# tests\test-record-sync.ps1 runs the real Publish-Update through this block.
#
# EVERY FILE OF THIS RELEASE IS ON THE SITE BY ITS OWN SHA256 (#1050), so a
# launcher can sync the install to the record below instead of replaying the
# packs: it compares each file of ours with the record and downloads only the
# ones that differ, from /feed[-dev]/assets/<sha256>, beside the record. Every
# file of ours goes up the first time (the dev record of 29 Sep: 2,515 files,
# 463.5 MB, 449.0 MB once files with the same bytes are counted once, stored
# as they are, not zipped); after that only what a release changes, because
# the send skips any asset already there. Release-Baseline.ps1 says what each
# key of the record means. The record says ':record:files' only once they are
# all up, and a launcher takes the packs from a record that does not.
#
# The plugin list the pack carries goes in as ':golden:'. A release that built
# no pack did not move it, so the last record's goes forward.
$recordSend = @{}
foreach ($f in 'plugins.txt', 'loadorder.txt') {
    $gf = Join-Path $goldenDir $f
    if (Test-Path -LiteralPath $gf) { $now[":golden:$f"] = Get-BaselineEntry $gf; $recordSend[":golden:$f"] = $gf }
}
$prevPtr = $null
if (Get-Variable -Name resolved -Scope Script -ErrorAction SilentlyContinue) { $prevPtr = $resolved.Pointer }
if (-not $recordSend.Count) {
    foreach ($k in @($prev.Keys | Where-Object { $_ -like ':golden:*' })) {
        $now[$k] = [string]$prev[$k]
        if ($NoUpload) { continue }
        # Its bytes, for a feed on another channel's folder (dev after a main Ship).
        $gsha = ([string]$prev[$k]).Split(':')[1]
        $gfile = Join-Path $goldenDir $k.Substring(8)
        try {
            if ($null -eq $prevPtr) { throw 'the last record is not on the site' }
            [void](Get-FeedAssetFile (Get-RecordFileUrl ([string]$prevPtr.url) $gsha) $gsha $gfile (Get-FeedStoreSiteDir $SiteDir) $SiteUrl)
            $recordSend[$k] = $gfile
        } catch {
            $now.Remove($k)
            Say "  the plugin list of the last release could not be read back ($($_.Exception.Message)), so this record carries none" 'Yellow'
        }
    }
}

# What is gone: every file of ours a release has stopped shipping, carried from
# record to record, so a launcher that never replayed the pack that deleted it
# still takes it out. The first record on a channel starts the list from what
# the packs already on the feed took out (read off each pack's delete.txt on the
# site, not the whole pack). Anything back in the build, the collection's, or
# not ours by Ship-Rules comes off the list, except Ship-Rules' own delete list,
# which goes from every install whatever put it there.
$gone = @{}
foreach ($k in @($prev.Keys)) { if ($k.StartsWith(':gone:')) { $gone[$k.Substring(6)] = [string]$prev[$k] } }
if (-not $prev.ContainsKey($RecordFilesKey) -and -not $gone.Count) {
    try {
        foreach ($d in @(Get-FeedPackDeletes $doc (Get-FeedStoreSiteDir $SiteDir) $SiteUrl { param($m) Say $m 'DarkGray' })) { $gone[$d] = 'removed' }
    } catch {
        Say "  what earlier packs took out could not be read: $($_.Exception.Message)" 'Yellow'
        Say '  The record starts its list of removed files from this release; the packs stay on the feed for older installs.' 'Yellow'
    }
}
foreach ($r in $removed) { $gone[$r] = 'removed' }
foreach ($a in $alwaysGone) { $gone[$a] = 'always' }
# #1261: other authors' files we once shipped leave as gone with their sha256,
# so the launcher deletes them only when the bytes still match. The removals
# filter above keeps them off $removed (Test-Machine), which is right for a
# blind delete; here the previous record still names the bytes we put there.
foreach ($k in @($prev.Keys)) {
    if ($k.StartsWith(':')) { continue }
    if ($now.ContainsKey($k)) { continue }
    if (-not (Test-ShipNotOurs $k)) { continue }
    # Bethesda's, one machine's and backups never become hash-gone: a delete
    # must not reach Steam copies of those (#1152, #1239, #1261). Nor what the
    # launcher builds on each computer (#3715): an install whose build made
    # the very bytes a release once carried would lose them at every update
    # and build them again at the next Play.
    # Nor Thornswood-Last.esp, which the launcher makes from the recipe on
    # each computer before every Play (#2791, Test-ShipMadeFromRecipe).
    if ((Test-ShipBethesda $k) -or (Test-ShipOneMachine $k) -or (Test-ShipBackup $k) -or (Test-ShipGenerated $k) -or (Test-ShipMadeFromRecipe $k)) { continue }
    $m = [regex]::Match([string]$prev[$k], '^\d+:([0-9a-fA-F]{64})$')
    if ($m.Success) { $gone[$k] = $m.Groups[1].Value.ToLowerInvariant() }
}
# ==== thornswood shipped not ours ====
# tests\test-shipped-not-ours.ps1 runs this block on its own.
#
# And the ones no record named any more when #1261 came (#1178): the scrub of
# 29 September had already taken them out of the records, so the loop above
# never saw them, and every install the old packs reached kept them.
# Ship-Rules' Get-ShipShippedNotOurs reads them, with the bytes we shipped, from
# records\shipped-not-ours.json, and stops the release on a path that is not
# another author's. A path this release ships is its own file again and is not
# gone; one Ship-Rules deletes everywhere stays 'always'.
$shippedNotOurs = Get-ShipShippedNotOurs
foreach ($k in @($shippedNotOurs.Keys)) {
    if ($now.ContainsKey($k) -or [string]$gone[$k] -eq 'always') { continue }
    $gone[$k] = $shippedNotOurs[$k]
}
# ==== end thornswood shipped not ours ====
foreach ($k in @($gone.Keys)) {
    if ($now.ContainsKey($k)) { $gone.Remove($k); continue }
    if ($gone[$k] -eq 'always') { continue }
    # A hash-matched gone entry stays (#1261): the launcher only deletes when
    # the bytes still match what we shipped.
    if ([string]$gone[$k] -match '^[0-9a-fA-F]{64}$') { continue }
    # Test-ShipMachine, not Test-Machine: another author's file an earlier
    # release already took out (the Lost Ark armour the dev record lists as
    # removed) stays gone;
    # the removals filter above keeps any new one of them off this list (#1178).
    if ((Test-FromCollection $k) -or (Test-Vanilla $k) -or (Test-Runtime $k) -or (Test-ShipMachine $k) -or (Test-OtherServer $k)) { $gone.Remove($k) }
}
foreach ($k in @($gone.Keys)) { $now[':gone:' + $k] = [string]$gone[$k] }

# ==== thornswood no bethesda in the record ====
# tests\test-no-bethesda-files.ps1 runs this block on its own.
#
# Nothing of Bethesda's goes into the record, as a file or as gone (#1152): the
# Creation Kit, a copy of one of the game's programs, the game itself, or a
# backup. The scan leaves them out through Test-Machine; this stops the release
# if a later change ever puts one back, before anything is sent to the site.
# Bethesda's is Test-ShipBethesda, the question Check-Secrets asks, so
# MarketplaceTextures.bsa is caught here too (#1229).
$bethesdaInRecord = @(@($now.Keys) | ForEach-Object { if ($_.StartsWith(':gone:')) { $_.Substring(6) } elseif (-not $_.StartsWith(':')) { $_ } } |
                      Where-Object { $_ -and ((Test-ShipBethesda $_) -or (Test-ShipBackup $_)) })
if ($bethesdaInRecord.Count) {
    Die ("The record of this release names {0} of Bethesda's files or backups, which Thornswood never hands out: {1}. Nothing was sent." -f
         $bethesdaInRecord.Count, (($bethesdaInRecord | Select-Object -First 5) -join ', '))
}
# ==== end thornswood no bethesda in the record ====

# ==== thornswood no one machine's files in the record ====
# tests\test-no-machine-files.ps1 runs this block on its own.
#
# Nothing of one machine's goes into the record either (#1239): its runtime
# state and tokens in Data\Platform, logs, Vortex's records, window layouts,
# settings saved from a mod's menu, face exports, saves (Test-ShipOneMachine).
# A launcher that syncs to the record fetches every file it names, so the dev
# records of 28 and 29 September handed out the join pass and the mod menu
# settings of the machine that ships. The scan leaves them out through
# Test-Machine and Test-Runtime; this stops the release if a later change ever
# puts one back. As gone they are allowed only on $ShipDeleteAlways, which every
# release deletes on purpose (voice-token.txt).
$machineInRecord = @(@($now.Keys) | ForEach-Object {
                        if ($_.StartsWith(':gone:')) { $g = $_.Substring(6); if (@(Get-ShipDeleteAlways) -notcontains $g) { $g } }
                        elseif (-not $_.StartsWith(':')) { $_ } } |
                     Where-Object { $_ -and (Test-ShipOneMachine $_) })
if ($machineInRecord.Count) {
    Die ("The record of this release names {0} of one machine's own files, which never leave it: {1}. Nothing was sent." -f
         $machineInRecord.Count, (($machineInRecord | Select-Object -First 5) -join ', '))
}
# ==== end thornswood no one machine's files in the record ====

if (-not $NoUpload) {
    $recordFiles = @()
    foreach ($k in @($now.Keys)) {
        if ($k.StartsWith(':')) { continue }
        $recordFiles += (Join-Path $GameDir $k)
    }
    $recordFiles += @($recordSend.Values)
    # Nothing that must never ship goes up loose either (Check-Secrets, entry
    # 236). What this release changed is in its pack and was read above; the
    # rest went up, and was read, with an earlier record. Only the first record
    # on a channel sends files no pack carried, so only then is the rest read.
    if (-not $prev.ContainsKey($RecordFilesKey)) {
        Head 'Checking the files of this release for secrets'
        $inPack = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        foreach ($c in $changed) { [void]$inPack.Add([string]$c) }
        $checkZip = Join-Path $DistDir ("record-check-$Id.zip")
        if (Test-Path -LiteralPath $checkZip) { Remove-Item -LiteralPath $checkZip -Force }
        $cz = [IO.Compression.ZipFile]::Open($checkZip, 'Create')
        try {
            foreach ($k in @($now.Keys)) {
                if ($k.StartsWith(':') -or $inPack.Contains($k)) { continue }
                [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($cz, (Join-Path $GameDir $k), ('game/' + ($k -replace '\\', '/')), 'NoCompression')
            }
        } finally { $cz.Dispose() }
        & (Join-Path $Here '..\dev\Check-Secrets.ps1') -Zip @($checkZip)
        $secretsRc = $LASTEXITCODE
        Remove-Item -LiteralPath $checkZip -Force -ErrorAction SilentlyContinue
        if ($secretsRc -ne 0) { Die 'Something that must never ship is among the files of this release. The lines above name each file and rule. Nothing was sent, and version.json has not been touched.' }
    }
    $sendArgs = @{ Dev = $Dev; Send = $recordFiles; Quiet = $true; WorkDir = $DistDir }
    if ($SiteDir) { $sendArgs['SiteDir'] = $SiteDir }
    $global:LASTEXITCODE = 0
    $sendWhy = ''
    try { & (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') @sendArgs }
    catch { $sendWhy = $_.Exception.Message }
    if (-not $sendWhy -and $LASTEXITCODE -ne 0) { $sendWhy = "Remirror-Site-Feed.ps1 -Send exited $LASTEXITCODE" }
    # And every one of them is there under the sha256 the record names: a file
    # rewritten between the scan and the send would be up under another name.
    if (-not $sendWhy) {
        $haveArgs = @{ Dev = $Dev; Have = $true }
        if ($SiteDir) { $haveArgs['SiteDir'] = $SiteDir }
        try {
            $there = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
            foreach ($h in @(& (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') @haveArgs)) { [void]$there.Add([string]$h) }
            $wanted = Get-RecordFileShas $now
            $absent = @($wanted.Keys | Where-Object { -not $there.Contains($_) })
            if ($absent.Count) { $sendWhy = ("{0} file(s) of this release are not on the site under the sha256 the record names; one changed while this ran?" -f $absent.Count) }
            else {
                $recordBytes = [int64]0; foreach ($v in $wanted.Values) { $recordBytes += $v }
                Say ("  every file of this release is on the site by its sha256: {0:n0} file(s), {1:n1} MB" -f $wanted.Count, ($recordBytes / 1MB)) 'Green'
            }
        } catch { $sendWhy = $_.Exception.Message }
    }
    if ($sendWhy) {
        Say "  $sendWhy" 'Red'
        Die ('The files of this release did not all reach the site, so version.json has not been touched. ' +
             'Check the ssh key with scripts\vps\Setup-SshKey.ps1 -Test, then run Ship again.')
    }
    $now[$RecordFilesKey] = '1'
}
# ==== end thornswood record files ====

# ==== thornswood release manifest ====
# tests\test-release-baseline.ps1 runs this block on its own. If the markers
# move, it stops rather than quietly testing nothing.
#
# WHAT THIS RELEASE LEAVES INSTALLED, published beside its packs (#441): the
# whole map, every file of ours with its size and sha256, the same bytes
# Save-State writes into the store once the release is out. It goes to the
# site like a pack, by its sha256, BEFORE version.json names it, and the feed
# names it as "baseline", so the next release on any machine is diffed against
# what this one really published. With -NoUpload it is only written here and
# the feed names none; the next release then reads the store's copy rather
# than a record the site does not hold. Two runs over the same tree write the
# same bytes, which is how a dry run can be compared with a real one.
$releaseBaseline = $null
$manifestPath = Join-Path $DistDir ('manifest-' + $Id + '.json')
$manifestSha = Write-BaselineFile $now $manifestPath
Say ("  manifest-{0}.json: {1:n0} entries, sha256 {2}" -f $Id, $now.Count, $manifestSha) 'DarkGray'
foreach ($old in @(Get-ChildItem -LiteralPath $DistDir -Filter 'manifest-*.json' -File -ErrorAction SilentlyContinue |
                   Sort-Object Name -Descending | Select-Object -Skip 20)) {
    Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue
}
if (-not $NoUpload) {
    $sendArgs = @{ Dev = $Dev; Send = @($manifestPath); Quiet = $true }
    if ($SiteDir) { $sendArgs['SiteDir'] = $SiteDir }
    $global:LASTEXITCODE = 0
    $sendWhy = ''
    try { & (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') @sendArgs }
    catch { $sendWhy = $_.Exception.Message }
    if (-not $sendWhy -and $LASTEXITCODE -ne 0) { $sendWhy = "Remirror-Site-Feed.ps1 -Send exited $LASTEXITCODE" }
    if ($sendWhy) {
        Say "  $sendWhy" 'Red'
        Die ('The record of what this release installs did not reach the site, so version.json has not been touched. ' +
             'Check the ssh key with scripts\vps\Setup-SshKey.ps1 -Test, then run Ship again.')
    }
    # With the note, which a launcher shows on its update card once no pack
    # carries it (Sync.cs RecordDue, the packs gone block).
    $releaseBaseline = New-FeedBaselinePointer $Id $manifestSha (Get-HostFeedAssetUrl $manifestSha -Dev:$Dev) $now.Count $Notes
    Say '  what this release installs is on the site' 'Green'
}
# ==== end thornswood release manifest ====

# ------------------------------------------------------------ version.json
# ==== thornswood feed recheck ====
# Two people can ship from two machines, and this run received the feed and
# the baseline twenty minutes ago. So they are asked for again before the feed
# is edited (#907):
#   - the baseline moved: another Ship went out meanwhile, packed against the
#     same baseline as this one. This release would undo half of it, so it
#     stops here with nothing written; its assets are on the site, and Ship
#     run again packs against the new baseline.
#   - only the feed moved: somebody changed the server, the collection or the
#     news. It is received again and this release is added on top of it, the
#     way git pull --rebase used to.
# The send at the end checks the same two again, in the same step that
# replaces the file on the VPS.
if (-not $NoPush) {
    try { $nowThere = Get-FeedStoreThere $Channel @('version.json', 'published.json', $FeedReleasesFile) -SiteDir $SiteDir }
    catch { Die ("Could not ask the VPS for the $Channel feed before editing it, so nothing was written: " + $_.Exception.Message) }
    $wasRead = Read-FeedStoreRead $ReleaseDir
    if ($null -eq $wasRead) { $wasRead = @{} }
    if ([string]$nowThere['published.json'] -ne [string]$wasRead['published.json']) {
        Die ("Another Ship published on the $Channel channel while this one was building: the baseline on the VPS is not the one this run started from. " +
             'Nothing was written to the feed. Run Ship again; it starts from that release.')
    }
    # The feed, and the store's list of releases (a rollback writes both),
    # received again when either moved, and this release goes on top of them.
    $again = @(@('version.json', $FeedReleasesFile) | Where-Object { [string]$nowThere[$_] -ne [string]$wasRead[$_] })
    if ($again.Count) {
        Say ('  ' + ($again -join ' and ') + ' changed on the VPS since this run read it; received again, and this release goes on top') 'Yellow'
        try { [void](Receive-FeedStore $Channel $ReleaseDir $again -SiteDir $SiteDir) }
        catch { Die ("Could not receive the $Channel feed again, so nothing was written: " + $_.Exception.Message) }
        $doc = ConvertFrom-ThornswoodJson (Get-Content $VersionFile -Raw) $VersionFile
    }
}
# ==== end thornswood feed recheck ====
# ==== thornswood move feed urls ====
# site\tests\test-site-assets.ps1 runs this block on its own.
#
# THE URLS ALREADY ON THE FEED MOVE TO THE SITE, a few at a time or all at
# once, and only by a publish, never by editing the live feed by hand (#897).
# Each GitHub url whose bytes the site already answers for, by sha256 and by
# size where the feed gives one, is rewritten to /feed[-dev]/assets/<sha256>.
# Any other stays where it is, so the feed never names a url that answers 404.
# scripts\oneoff\Copy-ReleaseAssets-ToSite.ps1 is what puts the old bytes up.
if (-not $NoUpload) {
    $sitePrefix = if ($Dev) { 'feed-dev' } else { 'feed' }
    $siteBase = $SiteUrl
    $mv = Move-FeedUrlsToSite $doc -Dev:$Dev -OnSite { param($sha, $bytes) Test-SiteAsset $siteBase $sitePrefix $sha $bytes }
    if ($mv.Moved.Count) { Say ("  {0} url(s) already on the feed now download from the site" -f $mv.Moved.Count) 'Green' }
    $mvLeft = @($mv.Stayed | Where-Object { -not (Test-HostFeedAssetUrl $_.Url) })
    if ($mvLeft.Count) {
        Say ("  {0} url(s) on the feed still point off the site, because the site does not hold those bytes:" -f $mvLeft.Count) 'Yellow'
        foreach ($mvOne in @($mvLeft | Select-Object -First 5)) { Say "    $($mvOne.What)" 'Yellow' }
        Say '  Launchers cannot fetch them once Thornswood-Releases is gone. Send the bytes with' 'Yellow'
        Say '  .\scripts\deploy\Remirror-Site-Feed.ps1 -Send <file>; the next publish moves the urls.' 'Yellow'
    }
}
# ==== end thornswood move feed urls ====
Head 'version.json'
# Where the last release's packs end, for the release list block below.
$lastPackBefore = Get-FeedLastPackId $doc
# ==== thornswood feed append ====
# tests\test-feed-rules.ps1 runs this block on its own. If the markers move,
# it stops rather than quietly testing nothing.
#
# The feed as pulled, before anything is added to it. What is already there is
# not rewritten by a publish: taking packs off the feed is Repair-Manifest's
# job. It is said on every publish until it is done, so it cannot be forgotten.
$feedRepo = Get-FeedRepo $doc
$stale = @()
if ($doc.PSObject.Properties['packs'] -and $doc.packs) { $stale = @((Split-FeedPacks $doc.packs $feedRepo).Drop) }
if ($stale.Count) {
    Say ("  {0} pack(s) already on the feed cannot be downloaded by a launcher, {1} to {2}:" -f
         $stale.Count, (Val $stale[0].Pack 'id'), (Val $stale[$stale.Count - 1].Pack 'id')) 'Yellow'
    foreach ($why in @($stale | ForEach-Object { $_.Why } | Sort-Object -Unique)) { Say "    $why" 'Yellow' }
    Say ("  .\scripts\release\Repair-Manifest.ps1{0} -DryRun lists them, and without -DryRun takes them out and pushes." -f $(if ($Dev) { ' -Channel dev' } else { '' })) 'Yellow'
}
if ($packsGone) {
    # The packs gone block says why. [] rather than no field: the shape every
    # launcher ever published reads. Said each time, with what went.
    $wasOn = 0
    if ($doc.PSObject.Properties['packs'] -and $doc.packs) { $wasOn = @($doc.packs | Where-Object { $null -ne $_ }).Count }
    Set-Prop $doc 'packs' @()
    if ($wasOn) { Say ("  the {0} pack(s) on the feed came off it: every launcher let in syncs to the record" -f $wasOn) 'Green' }
    else { Say '  the feed carries no packs' 'DarkGray' }
}
elseif ($chunks.Count) {
    $packs = @()
    if ($doc.PSObject.Properties['packs'] -and $doc.packs) { $packs = @($doc.packs) }
    # Every new pack must download from the repository launchers read this
    # feed from (Feed-Rules.ps1). An empty url is left to the check further
    # down, which says what that means.
    $wrongHost = @($chunks | Where-Object { $_.Url -and -not (Test-FeedPackUrl $_.Url $feedRepo) })
    if ($wrongHost.Count) {
        foreach ($w in $wrongHost) { Say "  pack-$($w.Id).zip is at $($w.Url)" 'Red' }
        Die "Launchers read this feed from $feedRepo and cannot download a pack from anywhere else, so version.json has not been touched. Nobody has been sent a pack they cannot fetch."
    }
    # In order. The launcher applies whatever it has not seen, in the order it
    # finds them, so part one has to be listed before part two.
    foreach ($c in $chunks) {
        $packs += [pscustomobject]@{
            id     = $c.Id
            url    = $c.Url
            sha256 = $c.Sha
            notes  = $Notes
        }
        Say "  pack $($c.Id) added" 'Green'
    }
    Set-Prop $doc 'packs' $packs
}
# ==== end thornswood feed append ====
# The client runtime's address, so a launcher missing one of those six files
# asks for it by name instead of searching the packs for it.
if ($clientRel -and $clientRel.url) {
    Set-Prop $doc 'clientRuntime' ([pscustomobject]@{
        url        = $clientRel.url
        sha256     = $clientRel.sha256
        bytes      = $clientRel.bytes
        forkCommit = $clientRel.forkCommit
        notice     = $SourceNoticeVersion
    })
    Say "  client runtime $($clientRel.forkCommit) recorded" 'Green'
}
# ==== thornswood release list ====
# tests\test-feed-rollback.ps1 runs this block on its own.
#
# EVERY RELEASE'S RECORD STAYS NAMED (#442). "baseline" below names only the
# last one, so on its own the feed could never say what an earlier release
# left installed, and the only way back from a bad release was another one
# written by hand. This keeps each release's record in "releases", newest
# first, with the last pack on the feed once it was out, and
# Rollback-Feed.ps1 puts the channel back to any of them. Before "baseline"
# moves, so a feed that names one and no list yet starts the list with it.
#
# Kept in the store beside the feed since #1050 ($FeedReleasesFile, sent with
# version.json at the end), not in the feed: no launcher reads it.
if ($releaseBaseline) {
    $releaseList = @(Add-FeedRelease $doc $releaseBaseline (Get-FeedLastPackId $doc) $lastPackBefore '' -Dir $ReleaseDir)
    Say ("  the store names {0} release(s) this channel can be put back to (Rollback-Feed.ps1 -List)" -f $releaseList.Count) 'DarkGray'
}
# ==== end thornswood release list ====
# What this release leaves installed (the release manifest block), which the
# next release is diffed against. Taken out when it was not sent, so the feed
# never names a record the site does not hold.
if ($releaseBaseline) {
    Set-Prop $doc 'baseline' $releaseBaseline
    Say ("  baseline {0} recorded, {1:n0} entries" -f $Id, $now.Count) 'Green'
} elseif ($doc.PSObject.Properties['baseline']) {
    $doc.PSObject.Properties.Remove('baseline')
    Say '  -NoUpload: the feed no longer names a baseline, so the next release reads the store''s copy' 'Yellow'
}
# THE FEED'S LAUNCHER FIELDS ARE LEFT AS THEY ARE (#4825). launcherVersion,
# launcherUrl, launcherSha256 and launcherInputs name the last launcher this
# feed sent, the last one on .NET Framework, and minLauncher (#937), which a
# publish set to that same launcher until #4825. Nothing here writes any of
# them now: the launcher goes out only through Velopack, and a launcher this
# feed offered would be an exe the launchers on .NET Framework swap in when
# its number is newer (ShellUpdate.cs, Upkeep.cs on them), which the launcher
# on .NET 10, an exe and its own DLLs, cannot be. Left as they are, they offer
# those launchers nothing new, and the site's join pass and the feed's own
# shape (feedView, Feed-News.ps1) go on reading the floor they were written
# with.

# Whatever this machine's launcher is pointed at becomes what everyone else is
# pointed at. It is how the password reaches four other people without anyone
# being told what it is, and how a server move fixes itself.
$cfgPath = Join-Path $Root 'config.json'
if (Test-Path $cfgPath) {
    try {
        $raw = [IO.File]::ReadAllBytes($cfgPath)
        $skip = if ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { 3 } else { 0 }
        $cfg = [Text.Encoding]::UTF8.GetString($raw, $skip, $raw.Length - $skip) | ConvertFrom-Json
        # Everyone's launcher takes the address out of version.json and writes
        # it into their own config, so whatever is in THIS machine's config.json
        # at publish time becomes the server for all five people. A stale local
        # config quietly moves the whole group onto a box that is not running
        # anything, and the symptom lands on them rather than here. So a change
        # has to be deliberate.
        $wasAddr = Val $doc 'serverAddress'
        $wasPort = Val $doc 'serverPort'
        $nowAddr = Val $cfg 'ServerAddress'
        $nowPort = Val $cfg 'ServerPort'

        if ($wasAddr -and $nowAddr -and ("$wasAddr`:$wasPort" -ne "$nowAddr`:$nowPort") -and -not $MoveServer -and -not $Dev) {
            Write-Host ''
            Say 'The server address in version.json is about to change:' 'Red'
            Say ("    was  {0}:{1}" -f $wasAddr, $wasPort) 'Red'
            Say ("    now  {0}:{1}" -f $nowAddr, $nowPort) 'Red'
            Write-Host ''
            Say 'That comes from the config.json on this machine, and it moves everybody.' 'Yellow'
            Say 'If the server really has moved, run Ship again with -MoveServer.' 'Yellow'
            Say 'If it has not, fix the address in the launcher first, or with:' 'Yellow'
            Say '    .\scripts\ops\Set-Server.ps1 -Address <ip> -Port <port>' 'Yellow'
            Write-Host ''
            if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
            exit 1
        }

        # VoicePort rides along for the same reason the address does: it is a
        # fact about the server, not a choice, and it used to be a box on the
        # Settings page that nobody should have been editing.
        # DiscordAppId, SiteUrl and PresenceImage feed the "Playing Thornswood"
        # card in Discord and its two buttons. Facts about the project, not
        # choices, so they travel the same way.
        foreach ($pair in @(@('ServerAddress', 'serverAddress'), @('ServerPort', 'serverPort'),
                            @('UpdateFeedUrl', 'updateFeedUrl'), @('VoicePort', 'voicePort'),
                            @('DiscordAppId', 'discordAppId'), @('SiteUrl', 'siteUrl'),
                            @('PresenceImage', 'presenceImage'))) {
            if ($cfg.PSObject.Properties.Name -contains $pair[0]) { Set-Prop $doc $pair[1] ([string]$cfg.($pair[0])) }
        }
        # updateRepo named Thornswood-Releases, the GitHub repository a
        # launcher asked when the site feed did not answer. That repository is
        # going (#907) and the launcher no longer asks it, so the feed stops
        # naming it. A launcher that still has the old fallback keeps the name
        # it saved and asks it at most once every five minutes while the site
        # is down; the site answering is all it needs.
        if ($doc.PSObject.Properties.Name -contains 'updateRepo') {
            $doc.PSObject.Properties.Remove('updateRepo')
            Say '  the feed no longer names a GitHub repository (updateRepo)' 'DarkGray'
        }

        # VoiceUrl travels even when it is empty, which none of the above do.
        # Empty is a real instruction here: it tells every launcher to stop
        # using the proxy and go back to the raw port, and it is the only way
        # back once they have all been pointed at Caddy. Writing it always is
        # what makes that one release rather than one per machine.
        if ($cfg.PSObject.Properties.Name -contains 'VoiceUrl') {
            $vu = [string]$cfg.VoiceUrl
            # The dev channel talks to the dev voice service. Caddy carries
            # /voice/ to the live service and /voice-dev/ to the dev one, and
            # the dev gamemode collects chat commands from the dev one only.
            # Until 20 Sep the dev feed carried main's address, so every slash
            # line from a dev session, /pick among them, went to the live
            # service and was answered by the live gamemode. Empty stays
            # empty: that is the raw port, and voicePort says which one.
            if ($Dev -and $vu.Trim().Length -gt 0 -and $vu.TrimEnd('/') -notmatch '-dev$') {
                $vu = $vu.TrimEnd('/') + '-dev'
                Say "  voiceUrl $vu (the dev service behind Caddy)" 'Green'
            }
            Set-Prop $doc 'voiceUrl' $vu
        }

        # Site feed URL (#649). A move is announced by shipping the new URL
        # under the old feed first. Default from channel when
        # the shipping machine's config.json has not set UpdateFeedUrl yet.
        $feedUrl = ''
        if ($cfg.PSObject.Properties.Name -contains 'UpdateFeedUrl') { $feedUrl = [string]$cfg.UpdateFeedUrl }
        if (-not $feedUrl) { $feedUrl = Get-HostFeedVersionUrl -Dev:$Dev }
        # The feed names its own channel's feed, whatever the shipping
        # machine's config.json says (Djinn, 2 Oct). On 1 Oct the dev feed
        # went out naming the main feed, because this machine's UpdateFeedUrl
        # is the main one, and every dev launcher that read it moved itself
        # onto the main feed. Same rule as voiceUrl above.
        $isDevUrl = $feedUrl -match '/feed-dev/'
        if ([bool]$Dev -ne $isDevUrl) {
            $was = $feedUrl
            $feedUrl = Get-HostFeedVersionUrl -Dev:$Dev
            Say "  updateFeedUrl $feedUrl (config.json said $was, which is the other channel's feed)" 'Yellow'
        }
        Set-Prop $doc 'updateFeedUrl' $feedUrl

        # How many the room holds. A number, not a string, because the launcher
        # reads it as one and a quoted "25" comes back as zero, which reads as
        # no limit at all. It rides along for the same reason the address does:
        # raising the cap should not need everybody to reinstall. From
        # records\most-online.json, the one place the number lives, which the
        # deploy scripts write into the servers too (#481); it used to be this
        # machine's launcher config.json, which the launcher rewrites itself.
        # The channel's own numbers (dev's are the record's dev object), and
        # its seats, people and staff seats together, because this is the M
        # of "N of M awake" (Patrick, 12 Oct: "the real cap is 30 but 25 for
        # people with non staff roles I still want it to say of 30 awake").
        . (Join-Path $PSScriptRoot '..\deploy\MaxOnline.ps1')
        $mo = (Get-MostOnline -Channel $Channel).Seats
        if ($mo -gt 0) { Set-Prop $doc 'maxOnline' $mo }

        # Which collection revision this release agrees with.
        #
        # The recorded one (records\collection-plugins.json, #3597), which the
        # check at the top of this run held this release's source to: One's
        # Vortex for a Ship from One, the last release for one from the feed.
        # The launcher compares its own installed revision against it and says
        # behind or ahead, and holds Play for either.
        #
        # There was no number at all before 22 September. The launcher guessed
        # from whether po3_StartOnSave.dll existed, a file Add-Characters.ps1
        # installs by hand and the collection has never carried, so the test
        # was wrong both ways: anybody who installed the collection properly
        # and skipped that script read as behind, and this machine sat on
        # revision 2 while Nexus was on 4 and nothing said a word.
        #
        # From then until #3597 the number written here was the one this
        # machine's Vortex had installed, or from the feed the last release's.
        # One stayed on revision 2 while 3, 4 and 5 were published without
        # Vortex, so both feeds said 2 and a launcher on 2 was let in.
        Set-Prop $doc 'collectionRevision' $ShipCollectionRevision
        Say "  collection revision $ShipCollectionRevision (records\collection-plugins.json, what this release was built against)" 'Green'

        # The server password does NOT ride along, and it used to.
        #
        # version.json is PUBLIC (then on the releases repository, now on
        # thornswood.net), which is the whole reason a shipped launcher can
        # read it without carrying a credential. Anything written into it is
        # readable by anybody, and the password was being written into it
        # every single publish.
        #
        # Nothing in the launcher ever read it back. Since 1.0.197 the password
        # comes from the site, handed over only after Discord has said who you
        # are, which is the entire point of the check. What was left was a
        # secret published for no reader.
        #
        # Any copy already sitting in version.json is taken out here, so a
        # publish removes it from the public repo rather than leaving it there
        # forever. That part stays, because a stale copy may still be up there.
        #
        # What used to follow it does not. Until 18 September this also copied
        # config.json's ServerPassword into server-secret.txt on every publish.
        # That field is gone from the launcher now, and the character register
        # secret is 32 random bytes written into server-secret.txt directly and
        # rotated by hand. Leaving the copy in place meant any value that found
        # its way back into config.json would silently overwrite the real
        # secret on the next publish, and the register would start refusing
        # everybody with nothing on screen to say why.
        if ($doc.PSObject.Properties.Name -contains 'serverPassword') {
            $doc.PSObject.Properties.Remove('serverPassword')
            Say '  took the server password out of version.json' 'Yellow'
        }
        Say "  server $(Val $cfg 'ServerAddress'):$(Val $cfg 'ServerPort')" 'Green'
        Say "  updates from $(Val $doc 'updateFeedUrl'), voice on $(Val $cfg 'VoicePort')" 'Green'
    } catch {
        Say "  could not read config.json, left the server details alone: $($_.Exception.Message)" 'Yellow'
    }
}

# The Skyrim build this release is pinned to (issue #471): the exe size the
# launcher's checks look for, the size of the newer build Steam hands out, and
# the depot manifests the Downgrade button asks Steam for. Read from
# records\skyrim-pin.json, the one record of the pin. A launcher older than
# these fields ignores them; a newer one reading a feed without them keeps
# what it was built with. Sizes are numbers and the ids strings, because the
# launcher reads them that way and a manifest id can be larger than a long.
# Left as the feed had it when the record cannot be read, never a guess.
$pinPath = Join-Path $PSScriptRoot '..\..\records\skyrim-pin.json'
try {
    $pin = (Get-Content -LiteralPath $pinPath -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json
    # RecordShape.ps1 (#2180): a pin at a version this checkout does not know,
    # or short of a field, is not written into the feed; the feed keeps its pin.
    $pinShape = @(Get-ThornswoodRecordProblems -Doc $pin -Kind skyrim-pin)
    if ($pinShape.Count) { throw ('it is not a skyrim-pin record this checkout can trust: ' + ($pinShape -join '; ')) }
    $pinExe = [long](Val $pin 'expectedExeBytes')
    $pinNewer = [long](Val $pin 'newerExeBytes')
    $pinDepots = @()
    if ($pin.PSObject.Properties['depots']) {
        foreach ($d in @($pin.depots)) {
            $pinDepots += [pscustomobject][ordered]@{ id = (Val $d 'id'); manifest = (Val $d 'manifest') }
        }
    }
    $bad = @($pinDepots | Where-Object { $_.id -notmatch '^\d+$' -or $_.manifest -notmatch '^\d+$' })
    if ($pinExe -le 0 -or $pinNewer -le 0 -or $pinDepots.Count -ne 3 -or $bad.Count) {
        throw 'it needs expectedExeBytes, newerExeBytes and three depots, each an id and a manifest in digits'
    }
    Set-Prop $doc 'expectedExeBytes' $pinExe
    Set-Prop $doc 'newerExeBytes' $pinNewer
    Set-Prop $doc 'depots' $pinDepots
    Say "  Skyrim pin: SkyrimSE.exe $pinExe bytes, depots $((@($pinDepots | ForEach-Object { $_.id })) -join ', ')" 'Green'
} catch {
    Say "  could not read records\skyrim-pin.json, so the feed keeps the Skyrim pin it had: $($_.Exception.Message)" 'Yellow'
}

# The launcher's News page reads this. Without it the page sits empty however
# many releases go out, because the notes were only ever going into the GitHub
# release body, which nobody playing the game ever sees.
#
# Every note the feed has, wherever it keeps them (Feed-News.ps1, #1050): in
# "news", or, once the channel's minLauncher reads it, the news file it names.
# Held whole in "news" in memory from here, so the DEV marks below see every
# note, and put back the way the channel keeps them just before the feed is
# written (the news out block).
try { $news = @(Open-FeedNewsList $doc (Get-FeedStoreSiteDir $SiteDir) $SiteUrl) }
catch { Die ("The notes the feed already has could not be read, so nothing was written: " + $_.Exception.Message) }

# A note can be a headline on its own, or a headline followed by lines. Any
# line starting with - or * becomes its own bullet on the News page, which is
# the only way a change the diff below cannot see (a gamemode rule, a server
# setting) gets described at all: only the person who made the change can say
# what it now does.
#
#     .\scripts\release\Ship.ps1 "Quieter publish output
#     - git progress no longer prints as a red error
#     - the Recheck button checks for updates too"
#
$noteLines = @($Notes -split "`r?`n")
$title   = $noteLines[0].Trim()
$bullets = @()
$bodyBits = @()
for ($i = 1; $i -lt $noteLines.Count; $i++) {
    $line = $noteLines[$i].Trim()
    if (-not $line) { continue }
    if ($line -match '^[-*\u2022]\s*(.+)$') { $bullets += $Matches[1].Trim() }
    else { $bodyBits += $line }
}
$body = ($bodyBits -join ' ').Trim()

# One long line with no breaks still splits on its first sentence, the way it
# always did, so old habits keep working.
if ($noteLines.Count -eq 1) {
    $split = [regex]::Match($Notes, '^(.{1,70}?)(?:\.\s+)(.+)$', 'Singleline')
    if ($split.Success) {
        $title = $split.Groups[1].Value.Trim()
        $body  = $split.Groups[2].Value.Trim()
    }
}

# The note is whatever Patrick typed. These lines are what actually moved,
# worked out from the diff, so nobody has to take the note's word for it and
# nobody has to ask what a release contained.
function Listed($names, [int]$cap) {
    if ($names.Count -le $cap) { return ($names -join ', ') }
    return (($names[0..($cap - 1)]) -join ', ') + (', and {0} more' -f ($names.Count - $cap))
}
function LeafNames($paths, [string]$pattern) {
    return @($paths | Where-Object { $_ -match $pattern } |
             ForEach-Object { Split-Path $_ -Leaf } | Sort-Object -Unique)
}

$details = @()

# What Patrick wrote comes first, because it is the only part that knows why.
foreach ($bpt in $bullets) { $details += $bpt }

$newMods  = @(LeafNames $changed '\\.(esp|esm|esl)$')
$goneMods = @(LeafNames $removed '\\.(esp|esm|esl)$')
$newDlls  = @(LeafNames $changed '[\\/]SKSE[\\/]Plugins[\\/][^\\/]+\\.dll$')

if ($newMods.Count)  { $details += 'Mods added or updated: ' + (Listed $newMods 8) }
if ($goneMods.Count) { $details += 'Mods removed: ' + (Listed $goneMods 8) }
if ($newDlls.Count)  { $details += 'Under the hood: ' + (Listed $newDlls 8) }

# The list of .cs files that moved used to go in here. It meant something to
# one person and nothing to anybody else, and this feed is on a public website
# and in a public Discord now. The launcher's own changes go out with it,
# through Velopack (#4825), not in this feed.

if ($changed.Count) {
    $details += ('{0:n0} file{1} to download, {2:n1} MB' -f $changed.Count, $(if ($changed.Count -eq 1) { '' } else { 's' }), ($changedBytes / 1MB))
}
else { $details += 'Nothing to download, this one is bookkeeping' }
if ($orderMoved) { $details += 'The load order moved, so start a new character or expect the old save to complain' }

# One line once. The 1.1.101 note read "Launcher 1.1.101" twice, because the
# notes carried it and a line this added said it too. First one kept, in order.
$seenDetail = @{}
$details = @($details | Where-Object {
    $k = ([string]$_).Trim().ToLowerInvariant()
    if ($seenDetail.ContainsKey($k)) { $false } else { $seenDetail[$k] = $true; $true }
})

# The full path list. Eighty lines of SKSE ini paths is the ugliest thing that
# could sit under a release note, and this feed is public now, so it is built
# for the console while shipping and kept out of the entry itself. Anybody who
# genuinely wants it has the pack itself, which lists every file.
$Cap = 80
$log = @()
foreach ($c in @($changed | Sort-Object)) { $log += $c }
foreach ($r in @($removed | Sort-Object)) { $log += '- ' + $r }
foreach ($p in @($profileChanged | Sort-Object)) { $log += ($p -replace '^:profile:', '') + '  (load order)' }
if ($log.Count -gt $Cap) {
    $rest = $log.Count - $Cap
    $log  = @($log[0..($Cap - 1)]) + ('... and {0:n0} more file{1}' -f $rest, $(if ($rest -eq 1) { '' } else { 's' }))
}

$newsSource = Get-ReleaseSource $RepoDir
$entry = [pscustomobject]@{
    # Month first, with the time on it, the same shape the site shows under
    # its download button. Entries written before this carry a bare date and
    # the launcher converts those as it reads them. On the team's clock, the
    # one the release id is minted on (Get-TeamNow in Release-Name.ps1).
    date    = (Get-TeamNow).ToString('M-d-yyyy h:mm tt', [Globalization.CultureInfo]::InvariantCulture)
    title   = $title
    body    = $body
    details = @($details)
    channel = $(if ($Dev) { 'dev' } else { '' })
    sourceCommit = $(if ($newsSource.Uncommitted -eq 0) { $newsSource.Commit } else { '' })
}
# Shipping twice in a row with the same note is a re-publish, not two pieces
# of news. Only the first one is worth reading.
$repeat = $false
if ($news.Count -gt 0) {
    $top = $news[0]
    if ((Val $top 'title') -eq $entry.title -and (Val $top 'body') -eq $entry.body) { $repeat = $true }
}

if ($repeat) {
    Say '  same note as last time, so no new news entry' 'DarkGray'
} else {
    # Newest first, and only the last forty. It is a news feed, not a changelog.
    #
    # Twenty until one evening of fixes filled it and started pushing real
    # releases off the bottom. Publish-Server writes here too now, so the
    # feed has two sources and needs the room.
    $news = @($entry) + $news
    if ($news.Count -gt 40) { $news = $news[0..39] }
    Set-Prop $doc 'news' $news
    Say '  news entry added' 'Green'
}

# ------------------------------------------------------- dev or main
# Which of these notes the dev build has and main does not.
#
# The dev feed is a copy of main's, so it carries main's whole news list
# with the dev notes sitting on top of it. In the News tab that read as one
# list with no seam, and the seam is the part worth having: it is the
# difference between the dev build and the build everybody plays, which is
# the list of what wants testing before the two are made the same.
#
# The rule is Update-DevNewsChannels in Dev-News.ps1, the one place it lives
# since 6 Oct, because a dev publish with nothing new and a main Ship mark the
# dev feed by it too (Set-DevFeedMarks, Update-DevFeedMarks). Main's fresh
# release record proves which source commits have shipped; a note from before
# sourceCommit, or with the empty one written above for a release built with
# uncommitted files, is proved by the dev release it came with, found by its
# tag, and that release when dirty by a later clean one on main (#2401);
# headline changes therefore cannot leave completed work marked Dev-only.
if ($Dev) {
    # Main's feed as the site serves it, read fresh on every dev publish, so
    # mainVersion and the news marks are what main has published, not whatever
    # this machine last saw. A stale copy is how the Dev News tab kept showing
    # main on 1.1.37 long after main had moved on (#546). Until #907 this was
    # main's Thornswood-Releases clone, pulled first. A feed that cannot be
    # read leaves the marks alone rather than shipping a stale mainVersion.
    $mainDoc = $null
    try { $mainDoc = Read-SiteFeed 'main' -SiteDir $SiteDir -SiteUrl $SiteUrl }
    catch {
        Say "  could not read main's feed, so the dev marks were left alone: $($_.Exception.Message)" 'Yellow'
    }
    if ($null -ne $mainDoc) {
        $marks = Set-DevFeedMarks $doc $mainDoc $RepoDir $SiteDir $SiteUrl
        Say ("  {0} note{1} marked dev, the ones main has not had" -f $marks.Marked, $(if ($marks.Marked -eq 1) { '' } else { 's' })) 'DarkGray'
    } else {
        Say '  the site has no main feed, so the dev marks were left alone' 'Yellow'
    }
} else {
    # A main release is the build everybody plays, so nothing in its feed is
    # dev only and nothing in it needs to know what main is on. Cleared
    # rather than assumed, in case a note ever reaches here already marked.
    foreach ($n in @($news)) {
        if ($n.PSObject.Properties.Name -contains 'channel') { $n.channel = '' }
    }
    Set-Prop $doc 'mainVersion' ''
}

# ==== thornswood release record ====
# tests\test-release-name.ps1 runs the real publisher and reads this back.
#
# ONE NAME FOR THIS RELEASE (#444): its id, which its packs and its baseline
# record are already named by. Written with everything else it is known by:
# the launcher the feed offers with it (the last one it sent, which no
# publish moves since #4825), its packs, its baseline, and the commit it was built from,
# which Ship tags as release/<channel>/<id> once the feed is out.
$relSource = Get-ReleaseSource $RepoDir
$relBaseline = if ($releaseBaseline) { [string]$releaseBaseline.id } else { '' }
$relPacks = @(if (-not $packsGone) { $chunks | ForEach-Object { [string]$_.Id } })
$relRecord = New-ReleaseRecord $Id $Channel (Val $doc 'launcherVersion') $relPacks `
    $relBaseline $relSource.Commit $relSource.Branch $relSource.Uncommitted
Set-Prop $doc 'release' $relRecord
Say ("  release {0}{1}" -f $Id, $(if ($relRecord.commit) { ', built from ' + $relRecord.commit.Substring(0, 12) } else { ', not from a git checkout' })) 'Green'
# ==== end thornswood release record ====

# ==== thornswood news out ====
# THE NOTES GO WHERE THE CHANNEL KEEPS THEM (#1050, Feed-News.ps1): in "news"
# while any launcher let in reads only that, and from the first minLauncher
# that reads the news file (1.2.4) as one asset named as "newsFile", sent to
# the site before the feed names it, with "news" left []. minLauncher is the
# feed's own, which no publish moves since #4825. A dry run (-NoUpload
# -NoPush) writes the file here and sends nothing, like the rest of it; a run
# that sends the feed but uploads nothing keeps the notes in "news", so the
# feed never names a file the site does not hold.
$newsMin = if ($NoUpload -and -not $NoPush) { '' } else { Val $doc 'minLauncher' }
try {
    $newsWhere = Set-FeedNewsList $doc @($doc.news) $Channel $newsMin (Join-Path $DistDir ('news-' + $Id)) $SiteDir -NoSend:$NoUpload
    if ($newsWhere -eq 'file') { Say ("  the {0} notes are one file on the site, named in the feed (every launcher let in reads it)" -f @($news).Count) 'Green' }
} catch { Die ($_.Exception.Message + ' Run Ship again.') }
# ==== end thornswood news out ====

# ==== thornswood signed manifest ====
# THE RELEASE IS SIGNED BEFORE THE FEED NAMES IT (#2163, phase B of
# docs\SIGNED-RELEASES.md). Every asset the feed now names that carries code or
# names files (the launcher, the client runtime, the packs, the baseline
# record) is listed by sha256 in release.json, a catalog over it is signed by
# ThornswoodRelease and checked the way a launcher checks a launcher, and both
# go to the site as assets before version.json names them as "signedManifest".
# Launchers do not read it yet (phase C). A run that uploads nothing (-NoUpload,
# what Ship -DryRun passes) signs nothing: nothing it names is on the site.
# A catalog that is not signed and accepted stops here, before version.json is
# written or sent, the same as an asset that did not reach the site.
if (-not $NoUpload) {
    Head 'Signing the release manifest'
    $smWhy = ''
    $sm = $null
    # A release from the feed signs on GitHub, in the engine fork (#2903,
    # Patrick's A of 20 Oct), so it needs no signing machine: the catalog
    # comes back signed and is held to release.json and the launcher's own
    # check there (Sign-OnGitHub.ps1). Any other release signs here.
    try { $sm = New-ReleaseManifestFiles $doc $Id $Channel (Join-Path $DistDir ('signed-' + $Id)) -NoCatalog:$FromFeed }
    catch { $smWhy = $_.Exception.Message }
    if ($FromFeed) {
        # The fork checks the launcher the feed names, from where the site
        # serves it, before it signs (#3312): it may have been signed on the box.
        if (-not $smWhy) { $smWhy = Invoke-ReleaseCatalogSignOnGitHub -Json $sm.Json -Catalog $sm.Catalog -RepoDir $RepoDir -Request ($Id + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)) -LauncherUrl (Val $doc 'launcherUrl') }
        if (-not $smWhy) { $smWhy = Get-ReleaseManifestRefusal $sm $doc -CatalogChecked }
    } else {
        if (-not $smWhy) { $smWhy = Invoke-ReleaseCatalogSign $sm.Catalog $RepoDir }
        if (-not $smWhy) { $smWhy = Get-ReleaseManifestRefusal $sm $doc }
    }
    if ($smWhy) {
        Die ("The release manifest was not signed and checked, so version.json has not been touched and nobody has been sent this release: $smWhy")
    }
    $smArgs = @{ Dev = $Dev; Send = @($sm.Json, $sm.Catalog) }
    if ($SiteDir) { $smArgs['SiteDir'] = $SiteDir }
    $global:LASTEXITCODE = 0
    try { & (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') @smArgs }
    catch { $smWhy = $_.Exception.Message }
    if (-not $smWhy -and $LASTEXITCODE -ne 0) { $smWhy = "Remirror-Site-Feed.ps1 -Send exited $LASTEXITCODE" }
    if ($smWhy) { Die ("The signed manifest did not reach the site, so version.json has not been touched: $smWhy") }
    $smJsonSha = (Get-FileHash -LiteralPath $sm.Json -Algorithm SHA256).Hash.ToLowerInvariant()
    $smCatSha = (Get-FileHash -LiteralPath $sm.Catalog -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Prop $doc 'signedManifest' ([pscustomobject][ordered]@{
        url           = (Get-HostFeedAssetUrl $smJsonSha -Dev:$Dev)
        sha256        = $smJsonSha
        catalogUrl    = (Get-HostFeedAssetUrl $smCatSha -Dev:$Dev)
        catalogSha256 = $smCatSha
    })
    Say ("  release.json lists {0} asset(s); its catalog is signed by ThornswoodRelease and on the site" -f @((ConvertFrom-Json ([IO.File]::ReadAllText($sm.Json))).assets).Count) 'Green'
} elseif ($doc.PSObject.Properties['signedManifest']) {
    # The feed names only a manifest made for the release it describes: the
    # last release's would not list what this one changed.
    $doc.PSObject.Properties.Remove('signedManifest')
}
# ==== end thornswood signed manifest ====

# Compact and without a byte order mark, the one way every feed writer writes
# it (Feed-Json.ps1, Write-FeedVersionFile, #1050). A BOM is not JSON: the
# launcher's reader stops on it, which takes out the update check for everyone
# at once, including their route to a fix.
Write-FeedVersionFile $VersionFile $doc

# A pack with no url is not a warning. It is a release that switches Play off
# for every person who takes it, because their launcher tries to download from
# an empty address, fails, and treats a pack it cannot apply as one the server
# is expecting. It locks out whoever would have to publish the fix as well.
# So this stops here, before the send, while the only copy is the one on this
# machine and the VPS has not been touched.
#
# Except on a run that neither uploads nor sends (-NoUpload -NoPush, what Ship
# -DryRun passes): nothing went to the site, so every url is empty by design,
# and this feed goes nowhere. It used to stop every dry run of a real change
# with exit 1 and advice about the ssh key (#1056).
# Only the packs the feed names: once the packs are gone (the packs gone block)
# none is sent or named, so none has a url, by design.
$blank = @($chunks | Where-Object { -not $packsGone -and -not $_.Url })
if ($blank.Count -and $NoUpload -and $NoPush) {
    Say ("  -NoUpload: {0} pack(s) have no url, because nothing was uploaded; this feed is not sent" -f $blank.Count) 'DarkGray'
}
elseif ($blank.Count) {
    Write-Host ''
    Say ("{0} pack(s) uploaded no asset, so their url is empty:" -f $blank.Count) 'Red'
    foreach ($b in $blank) { Say ("    " + $b.Id) 'Red' }
    Write-Host ''
    Say 'version.json has been written here but NOT sent. Nobody has this yet.' 'Yellow'
    Say 'The send to the site is what failed, usually the ssh key. Fix that and run Ship again.' 'Yellow'
    Say ("If a bad one did go out, .\scripts\release\Repair-Manifest.ps1{0} takes it back out and sends the feed." -f $(if ($Dev) { ' -Channel dev' } else { '' })) 'Yellow'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}

# ------------------------------------------------------------ the server copy
# This used to write Profile\Default\loadorder.txt out to _dist\server and tell
# the shipper to upload it to the server's Data folder. Do not put that back.
#
# It was wrong in three ways at once. The file it wrote carries EVERY entry,
# 103 of them today, while Deploy-Gamemode.ps1 deliberately drops light plugins
# from the server's list and cascades that drop to anything mastering them, so
# the two disagree by construction and uploading one over the other breaks the
# server rather than fixing it. Nothing packed _dist\server into a release, so
# the file only ever sat on the shipping machine waiting to tempt somebody. And
# the mechanism it named, ModCheck comparing against Data/loadorder.txt, exists
# nowhere else in this repo: the server's list lives in the loadOrder array of
# server-settings.json, which Deploy-Gamemode.ps1 writes.
#
# What replaces it is a check rather than a file. Nothing here can fix a stale
# server list, because computing it means the light plugin cascade and that
# logic belongs in one place. So this says whether the list the server is
# configured with is older than the one just published, which is the whole
# question, and names the two commands that settle it.
# From the feed the list was held to the order the server loads before
# anything was built (the feed's plugin list block), and nothing here has
# the collection's files to read, so this is a Ship from One's alone.
if ($profileChanged.Count -and -not $FromFeed) {
    Head 'The server needs this too'

    # Not by dates any more. The pack's plugin list goes out in the server's
    # order (Get-ReferenceInServerOrder), so the order can never be what the
    # server lacks; what it can lack is a plugin. A full plugin the list
    # enables that the manifest does not name is one the server has to be
    # given, and until it is, every client that follows the server's order
    # carries it as an extra and is refused at connect. The old check
    # compared file dates and told Patrick to run Deploy-Gamemode on
    # 20 September when the only change was LOOT re-sorting the list; that
    # deploy would have re-keyed the world.
    $manifest = $script:serverManifest
    if ($null -eq $manifest) {
        try { $manifest = Get-LoadOrderManifest (Get-LoadOrderManifestUrl $Root) } catch { $manifest = $null }
    }
    if ($null -eq $manifest) {
        Say '  The server did not answer with its manifest, so this cannot be checked.' 'DarkGray'
    } else {
        $refPath = if ($script:referenceList) { $script:referenceList } else { Join-Path $ProfileDir 'Default\plugins.txt' }
        $refData = Join-Path $GameDir 'Data'
        $enabled = @()
        foreach ($line in (Get-Content -LiteralPath $refPath -EA SilentlyContinue)) {
            $n = Get-LoadOrderEnabledName $line
            if ($n) { $enabled += $n }
        }
        $isLightOrMissing = { param($n) $f = Join-Path $refData $n; (-not (Test-Path -LiteralPath $f)) -or (Test-LoadOrderLight $f) }
        $exists = { param($n) Test-Path -LiteralPath (Join-Path $refData $n) }
        # Assigned, not wrapped in @(): the function hands back one array and
        # @() would nest it, which read as one plugin missing on 20 September.
        $game = Get-LoadOrderGame $enabled $isLightOrMissing @() $exists
        $lower = @{}
        foreach ($m in $manifest) { $lower[$m.ToLowerInvariant()] = $true }
        $missing = @($game | Where-Object { -not $lower.ContainsKey($_.ToLowerInvariant()) })
        # A server that publishes its light order (#1715) counts the light
        # plugins too: one the list enables that the server does not load
        # takes a light index there and moves every light plugin after it.
        if (@($script:serverLight).Count) {
            $isLightHere = { param($n) Test-LoadOrderLight (Join-Path $refData $n) }
            $lightLower = @{}
            foreach ($m in @($script:serverLight)) { $lightLower[$m.ToLowerInvariant()] = $true }
            $lightGame = Get-LoadOrderLight $enabled $isLightHere @() $exists
            $missing += @($lightGame | Where-Object { -not $lightLower.ContainsKey($_.ToLowerInvariant()) })
        }
        if ($missing.Count) {
            Say ("  The server does not have {0} plugin(s) this list enables:" -f $missing.Count) 'Yellow'
            foreach ($m in $missing | Select-Object -First 8) { Say "    $m" 'Yellow' }
            if ($missing.Count -gt 8) { Say "    and $($missing.Count - 8) more" 'Yellow' }
            Say '  Until the server has them, everybody who follows its order carries an extra plugin and is refused.' 'Yellow'
            Say '  Put it right with, in this order:' 'Yellow'
            Say '      .\scripts\deploy\Deploy-Gamemode.ps1' 'Yellow'
            Say ('      .\scripts\release\Publish-Server.ps1 "the plugin list gained ' + $missing[0] + '"') 'Yellow'
            Say '  Deploy-Gamemode keeps the order the server already runs and puts the new ones on the end.' 'Yellow'
            # Stopped here, before the push, Djinn, 25 September. Until then the
            # line above had its + outside brackets, so PowerShell read '+' as a
            # colour and threw, and that throw was the only thing between two dev
            # releases and every tester being refused at connect: the list had 7
            # plugins of another server switched on (its own start plugin, its
            # horses plugin, SunHelm...), taken from Vortex's deployment because that server's
            # collection is
            # deployed to the same Steam copy. version.json is written and not
            # pushed, so nobody has it; the assets are up and nothing points at
            # them. If the server really should gain these, deploy it first and
            # ship again.
            Die ("the pack's plugin list switches on " + $missing.Count + " plugin(s) the server does not have (" + (($missing | Select-Object -First 3) -join ', ') + "). Nothing was pushed. Switch them off in the reference list, or give the server them first, then ship again.")
        } else {
            Say ("  The server has every one of the {0} full plugins this list enables, in the order the pack ships. Nothing to deploy." -f $game.Count) 'Gray'
        }
    }
}

# ------------------------------------------------------- old packs go
#
# After the upload, never before it. A pack is on the releases repository the
# moment it is made and nothing in the update path reads an old one off this
# disk, so the copies here are a local convenience. Nothing pruned them until
# 22 September, by which time 62 of them had piled up inside the folder
# Patrick plays from and come to 10.9 GB.
#
# Newest kept by name, which sorts correctly because every id is
# pack-YYYYMMDD-HHMMSS (HHMM before #1057). The one just built is the newest, so it is never the one
# that goes. -KeepPacks 0 keeps everything, for a machine that wants them.
if ($KeepPacks -gt 0) {
    try {
        $packs = @(Get-ChildItem -LiteralPath $DistDir -Filter 'pack-*.zip' -File -EA SilentlyContinue |
                   Sort-Object Name -Descending)
        if ($packs.Count -gt $KeepPacks) {
            # @() around it, and the reason is Set-StrictMode -Version Latest
            # at the top of this file.
            #
            # Select-Object hands back ONE FileInfo rather than an array when
            # exactly one pack is over the limit, and under StrictMode reading
            # .Count on a scalar throws rather than answering 1. That is what
            # happened on the 1.1.79 release: "The property 'Count' cannot be
            # found on this object". The catch meant the tidy was skipped and
            # the release carried on, which is the right way round, but nothing
            # was pruned and the message read like a mystery.
            #
            # Worth remembering for any count in this file: without StrictMode
            # a scalar answers .Count = 1 quite happily, so this shape tests
            # clean in a bare prompt and fails only where it matters.
            $go = @($packs | Select-Object -Skip $KeepPacks)
            $mb = (($go | Measure-Object Length -Sum).Sum / 1MB)
            if ($NoClose) {
                # Ship -DryRun sets -NoClose; dry run must not prune (issue #494).
                Say ("  -NoClose: would remove {0} older pack(s) from $DistDir, {1:N1} MB; leaving them" -f $go.Count, $mb) 'Yellow'
            } else {
                foreach ($f in $go) { Remove-Item -LiteralPath $f.FullName -Force -EA SilentlyContinue }
                Say ("  {0} older pack(s) removed from $DistDir, {1:N1} MB. They are all on the site." -f $go.Count, $mb) 'DarkGray'
            }
        }
    } catch {
        Say "  could not tidy the old packs: $_" 'DarkGray'
    }
}

# ------------------------------------------------------------ send
# ==== thornswood feed send ====
# THE FEED GOES TO THE VPS, and from that moment the site serves it (#907).
# Every asset it names is on the site already: the new ones went up before the
# feed was touched, and an old url was only moved once the site answered for
# its bytes. Send-FeedStore replaces version.json up there only if the feed
# and the baseline are still the ones this run received (or received again
# above), .part then renamed, the old one kept in history. Until #907 this was
# a git commit and push to Thornswood-Releases, and the site copy followed in
# Publish-PostShip's remirror.
$pushFailed = $null
if (-not $NoPush) {
    Head 'Sending the feed'
    try {
        # The store's list of releases goes in the same step as the feed
        # (Release-Baseline.ps1, #1050), when there is one here to send.
        $feedFiles = @('version.json')
        if (Test-Path -LiteralPath (Join-Path $ReleaseDir $FeedReleasesFile) -PathType Leaf) { $feedFiles += $FeedReleasesFile }
        $sentFeed = Send-FeedStore $Channel $ReleaseDir $feedFiles -SiteDir $SiteDir
        if (@($sentFeed.Sent).Count) { Say "  version.json for $Id is on the VPS, and the site serves it" 'Green' }
        else { Say '  version.json on the VPS already matched this one' 'DarkGray' }
    } catch {
        $pushFailed = $_.Exception.Message
    }
}

# THE BASELINE MOVES ONLY WHEN THE RELEASE IS REALLY OUT.
$pendingWhy = ''
if ($pushFailed) {
    $pendingWhy = Write-Pending $StateFile $Id $pushFailed
} else {
    Save-State
    $pendingWhy = Clear-Pending $StateFile
    Send-Baseline $Id
    # What Ship tags, and only once the feed is on the VPS (#444). Global, the
    # way Publish-Discord hands back its result, because Ship runs this script
    # in its own scope.
    if (-not $NoPush) { $global:ThornswoodPublishedRelease = $Id }
}
# ==== end thornswood feed send ====

Head 'Done'
if ($pushFailed) {
    Say "NOT SHIPPED. $pushFailed" 'Red'
    Say 'The assets are on the site but version.json is not, so no launcher' 'Red'
    Say 'will see this update. Fix the line above and run Ship again.' 'Red'
    if ($pendingWhy) {
        Say "The baseline was NOT moved, but $pendingWhy." 'Red'
        Say "So the next run starts a new release instead of finishing $Id; its assets" 'Red'
        Say "stay on the site unnamed. To finish it, run this script again with -Id $Id." 'Red'
    } else {
        Say "The baseline was NOT moved, so the next run finishes $Id rather than" 'Yellow'
        Say 'starting a new one. Nothing here is lost by running it again.' 'Yellow'
    }
}
elseif ($NoPush) {
    Say "-NoPush: $Id was not sent, so no launcher will see it." 'Yellow'
}
else {
    Say "Everyone's launcher will offer update $Id on next start." 'Green'
    if ($pendingWhy) {
        Say "But $pendingWhy." 'Red'
        Say "It names a release that is out now: delete it before the next Ship, or that Ship goes out under $Id again." 'Red'
    }
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
# Said with an exit code, not only in red (#1055). This used to run off the end
# after NOT SHIPPED, so its exit code was whatever ran last, measured 0, and a
# Ship (which sends no launcher) reads nothing else: it went on to #news, the
# Discord and the server's countdown for a release no launcher could see.
# Anything but 0 or 2 makes Ship stop with "NOTHING was published".
if ($pushFailed) { exit 1 }
exit 0
