<#
  Ship-Rules.ps1

  The one list of what never leaves a machine inside a Thornswood pack.
  Publish-Update.ps1 dot-sources it, and until #4824 the old installer's
  builder did too, so the two could never disagree about
  which files are the build's and which are one machine's, another server's,
  or somebody's sign in.

  It had to become one file the night the installer turned out to carry
  Data\Platform\PluginsNoLoad\auth-data-no-load.js, the SkyMP client's saved
  sign in token from the machine it was built on. Publish-Update had grown a
  careful list of what to leave out; the installer's builder had its own, shorter
  one, and the token file fell through the gap. Every rule lives here now.

      . (Join-Path $PSScriptRoot 'Ship-Rules.ps1')
      Test-ShipRuntime $rel        written by the game or a tool at runtime; never shipped, listed as removed when it goes
      Test-ShipMachine $rel        one machine's own; never shipped, never removed
      Test-ShipOtherServer $rel    not one of ours, or somebody's sign in; never shipped, never removed
      Test-ShipClientRecorded $rel [$full]
                                   one of the six client runtime files, and byte for byte the recorded build
      Test-ShipVanilla $rel        Bethesda's own files; never shipped, never removed
      Test-ShipForeignFramework $rel
                                   somebody else's framework or modding tool under Data; never shipped, never removed
      Test-ShipBethesdaLeftAlone   Bethesda's, and a pack once carried it; never shipped, never removed
      Test-ShipRetired $rel        a mod Thornswood took out; never shipped, never removed (the launcher drops it)
      Test-ShipBethesdaTool $rel   the Creation Kit, its script sources, or a copy of one of the game's programs; never shipped, never recorded, never removed (the launcher drops it)
      Test-ShipBackup $rel         any *.bak; never shipped, never removed
      Test-ShipBethesda $rel       Bethesda's by any of the three rules above (vanilla, Creation Kit, left alone); never packed, recorded or on the site
      Test-ShipOneMachine $rel     one machine's own by kind (runtime state, logs, session and token files, backups, face exports,
                                   Vortex's records, window layouts, settings saved from a mod's menu, saves); never packed, recorded or on the site
      Get-ShipOwnGameCollection    the collection's files in a Game folder the launcher made; never shipped
      Test-ShipGenerated $rel      an animation or body file the launcher builds on each computer (#3715); never shipped, never removed
      Test-ShipNotOurs $rel        another author's loose file (outside Data\Platform, not named ours); never packed, recorded or listed as removed
      Test-ShipOurs $rel           ours outside Data\Platform: the named files, the client runtime, required data, the menu, the BodySlide builds until #1259
      Test-ShipHeld $rel           a loose file that ships until the collection revision that carries its mod, or while the content plugin names it
      Get-ShipCollectionRevision   the revision this machine's Vortex has installed, for $ShipCollectionRevision
      Get-ShipRecordedCollectionRevision  the revision records\collection-plugins.json says a release is built against (CollectionRevision.ps1, #3597)
      Get-ShipCollectionRevisionProblem   why a release built from a source on another revision may not go out naming it, or ''
      Get-ShipNewestRevisionProblem       why no release may go out while the record is not the newest revision published on Nexus, or '' (#4068)
      Get-ShipLoadOrderDir         where the reference plugins.txt and loadorder.txt are read from
      Get-ShipRequiredDataRoot     game\required-data in the repo
      Ensure-ShipRequiredData      place those files into Data\ before a pack or installer scan
      Get-ShipSymbolDir            where this machine keeps launcher/setup .pdb per version (#462)
      Save-ShipSymbols             copy .pdb from a build folder into Get-ShipSymbolDir
      Get-ShipUiHashedAssets       hashed asset names parsed from Data\Platform\UI\build.js
      Save-ShipUiHashedAssets      parse, refuse a bad front, write thornswood-ui-assets.txt

  Paths are relative to the game folder, with backslashes.
#>

# Written at runtime, by the game, a tool or a session. Leaving a folder out
# here makes the next release list its files as removed, and the launcher
# takes them back off every install. So this is also the list of things that
# get cleaned off everybody when they have slipped into a pack once.
$ShipRuntimeDirs = @(
    # Where the Claude desktop app drops files it hands over in chat. It chose
    # the game folder for that once, and a report, a script and a png rode
    # along in packs 20260916-0130 to 0937.
    'Claude outputs\',
    # Where files are parked on a machine when a session cannot delete them.
    '_to_delete\',
    # RaceMenu writes a face export here when somebody saves one in game.
    'Data\SKSE\Plugins\CharGen\Exported\',
    # And its face tint beside it. The dev record of 29 September carried one
    # person's, Data\textures\CharGen\Exported\Adventurer3424.dds (#1152).
    'Data\textures\CharGen\Exported\',
    # Another server's folder must never be listed here: a runtime path has
    # its files listed as removed and swept off every install that has them,
    # which is somebody else's install being swept. Those go in
    # Test-ShipOtherServer below.
    '.sentry-native\'
)

# Settings that belong to the machine rather than to the build. SSE Display
# Tweaks holds the screen resolution, so publishing it stamped one person's
# monitor onto everyone. The client settings file carries one person's
# character slot. The logs and the voice files are live state.
$ShipMachineFiles = @(
    'Data\SKSE\Plugins\SSEDisplayTweaks.ini',
    'Data\Platform\Plugins\skymp5-client-settings.txt',
    'Data\Platform\overlay-boot.count',
    'Data\Platform\thornswood-dress.log',
    'Data\Platform\thornswood-emotes.log',
    'Data\Platform\thornswood-front.log',
    'Data\Platform\thornswood-voice.log',
    # Open Animation Replacer writes this back with its own values on every
    # exit. The two values this build cares about are held by the launcher's
    # Enforce table on every Play instead.
    'Data\SKSE\Plugins\OpenAnimationReplacer.ini',
    # SkyrimPlatform.ini is four machine settings in one file and none of
    # them belong to the build. It holds the log level, whether a console
    # window opens and how big it is, the plugin folder list, and the
    # BackendName line the launcher writes on every Play from what that
    # machine has on disk. Publishing it hands one person's trace logging
    # and console window to everybody, and pins them all to whichever
    # browser backend the machine that built the pack happened to have.
    # No pack has carried it yet, and that was luck rather than a rule.
    'Data\SKSE\Plugins\SkyrimPlatform.ini',
    # The launcher and the voice plugin talk through these three.
    'Data\Platform\voice-port.txt',
    'Data\Platform\voice-status.txt',
    'Data\Platform\voice-ptt.txt',
    # One person's signed join token for the voice room, written by the
    # launcher (Voice.cs) beside the three above. Never listed here until 20
    # September, which meant a pack built on a machine that had played would
    # carry it. Sixty minute life, so a stale one opens nothing, but a token is
    # a token.
    'Data\Platform\voice-token.txt',
    # Who this person has muted in voice, by profile id, written by the voice
    # plugin for the launcher (entry 151). One person's list, so never in a pack.
    'Data\Platform\voice-muted.txt',
    # The game asking the launcher for a join token, "<profile id> <time>"
    # (#1322). One person's profile id, so never in a pack.
    'Data\Platform\voice-token-ask.txt',
    # The main menu character choice, 20 September: the launcher writes the
    # list before Play and the plugin writes the pick. Both are one machine's,
    # and the list is every profile id the install owns.
    'Data\Platform\thornswood-characters.json',
    'Data\Platform\thornswood-choice.txt',
    'Data\Platform\thornswood-forget.txt',
    # Whether this person turned the scroll in front of the choice off.
    'Data\Platform\thornswood-intro.txt',
    # The same list as a script beside the page (Chars.WriteCharacters), so
    # the choice draws before any plugin runs. Every profile id the install
    # owns, so never in a pack.
    'Data\Platform\UI\thornswood-characters.js',
    # Written by the game on this machine every session. The second is the
    # light half of the same list, kept apart because the server's own list
    # drops light plugins and the first file has to match it positionally.
    'Data\Platform\thornswood-loadorder.txt',
    'Data\Platform\thornswood-plugins-light.txt',
    # The launcher's note to the plugins that this is our session. See Keep.cs.
    'Data\Platform\thornswood-session.txt',
    'Data\Platform\menu-music-duck.txt',
    'Data\SKSE\Plugins\po3_Tweaks.ini',
    # One machine's key binds, microphone name and field of view. Every
    # launcher writes it, and the three packs of 16 and 17 Sep carried the
    # publishing machine's copy, which put its Fov=120 and its binds on
    # everyone. A machine without one gets the template from the launcher
    # (ThornIni.Ensure), so it never needs to travel.
    'Data\SKSE\Plugins\Thornswood.ini',
    'Data\SKSE\Plugins\CrashLogger.ini'
)

# Dev only. A path here rides in dev packs and never in a main pack or the
# installer, whatever else goes to main.
#
# EMPTY SINCE 22 SEPTEMBER, and the list stays because the reason for it will
# come round again. Its one entry was thornswood-dev-theme.mp3, the test track
# for the launcher, the main menu and the loading screen. It was held on dev
# from 20 September because the artist had not signed it off, and holding it
# was the whole point of this list. Patrick supplied the final version on
# 22 September and said it goes to main, so the track is now
# Data\Platform\UI\thornswood-theme.mp3, it ships everywhere, and the dev-only
# name went with the dev-only rule.
#
# Put a path back here the next moment something is playable on dev but not
# ours to give out yet. Do not take one out without the owner's word.
$ShipDevOnlyFiles = @(
)

function Test-ShipDevOnly([string]$rel) {
    foreach ($f in $ShipDevOnlyFiles) {
        if ($rel -eq $f) { return $true }
    }
    return $false
}

function Test-ShipRuntime([string]$rel) {
    foreach ($d in $ShipRuntimeDirs) {
        if ($rel.StartsWith($d, 'OrdinalIgnoreCase')) { return $true }
    }
    # The Claude desktop app has dropped its folder deeper than the game root
    # as well: Data\Platform\Claude outputs held three scripts on 16 Sep, one
    # of them written after that machine's baseline.
    if ($rel -match '(^|\\)Claude outputs\\') { return $true }
    return $false
}

# Not one of ours, and anybody's sign in. Decided by what belongs in the
# places another launcher could write to, never by whose a file is: this list
# named two other servers' files until 20 September, and the name of the
# thing to keep out is not the point, the thing to keep in is.
#
# OwnGame.Foreign in the launcher is the same list for Thornswood's own game
# folder; change the two together.
#
# The client runtime is the exception in the other direction. The six files in
# client-build.json are the bundle, MpClientPlugin.dll, both SkyrimPlatform
# DLLs, the CEF host and TESModPlatform.pex, built from the fork. Until 20
# September the copies in every game folder were another launcher's builds,
# told apart from ours by nothing but a comment we had written into them.
#
# One of them is ours when its bytes are the recorded build, and then it ships
# whatever else this says. Until 24 September this note said "ours by recorded
# hash" while the rule never opened the file: a path in the record was ours
# whatever sat there, so a bundle with one byte changed, or another launcher's
# bundle at the same path, went into a pack as ours (To Do entry 128, "a test
# that passes because of something we did to the file is not a test").
# Test-ShipClientRecorded below hashes the file against the record, the same
# sha256 Sync-Client.ps1 and the launcher's ClientRuntime compare. Anything
# else at one of those six paths, and a file that is not there at all, counts
# as not ours: never shipped, and never listed as removed, so no release
# deletes the client off a tester.
#
# PluginsNoLoad is where the SkyMP client keeps its saved sign in
# (auth-data-no-load.js, a token). It is one person's login to whichever
# master issued it and has no place in a pack or an installer, and it is not
# ours to delete off a machine either.
$ShipClientFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$ShipClientHashes = @{}
# A copy of this file with no record beside it (as test fixtures make) has no
# client paths. A record that is there and does not read stops whatever
# loaded this (#2711): read in a try with an empty catch, it left the six
# paths unlisted, so the client runtime fell under Data\Platform as ours and
# would ship whatever bytes the game folder held, unchecked against the record.
$clientRecord = Join-Path $PSScriptRoot '..\..\records\client-build.json'
if (Test-Path -LiteralPath $clientRecord) {
    try {
        $rec = Get-Content -LiteralPath $clientRecord -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if (-not $rec -or -not $rec.PSObject.Properties['files'] -or -not $rec.files) { throw 'it names no files' }
    } catch {
        throw ("Ship-Rules.ps1: records\client-build.json does not read (" + $_.Exception.Message + "), so the client runtime's six paths cannot be told from ours. Nothing was packed or sent.")
    }
    foreach ($p in $rec.files.PSObject.Properties.Name) {
        [void]$ShipClientFiles.Add($p)
        $ShipClientHashes[$p] = ([string]$rec.files.$p.sha256).ToLowerInvariant()
    }
}

# Whether the file at one of the six recorded paths is the recorded build, byte
# for byte. $full is the file when the caller has it. Without it the file is
# $rel under $GameDir: Publish-Update names the folder it scans $GameDir, and
# dot-sourcing this puts these functions in its scope, so its existing calls, which pass only the path, are answered by the
# bytes on disk. With no file and no $GameDir there is nothing to hash, and the
# answer is no.
#
# Hashed with .NET rather than Get-FileHash: a script started with -NoProfile
# can find itself without the module Get-FileHash lives in.
function Test-ShipClientRecorded([string]$rel, [string]$full = '') {
    if (-not $ShipClientHashes.ContainsKey($rel)) { return $false }
    if (-not $full) {
        $game = Get-Variable -Name GameDir -ValueOnly -ErrorAction SilentlyContinue
        if (-not $game) { return $false }
        # Not Join-Path, which throws on a drive that is not there rather than
        # answering that the file is not.
        # The record's backslashes as this system's separator (#2903).
        $full = [IO.Path]::Combine([string]$game, $rel.Replace('\', [IO.Path]::DirectorySeparatorChar))
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return $false }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        # ReadWrite, the way ClientRuntime.Sha256Of opens it: SkyrimPlatform
        # holds these open while the game runs.
        $fs = New-Object IO.FileStream($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try { $have = ([BitConverter]::ToString($sha.ComputeHash($fs))).Replace('-', '').ToLowerInvariant() }
        finally { $fs.Dispose() }
    }
    finally { $sha.Dispose() }
    return ($have -eq $ShipClientHashes[$rel])
}

# SKYUI 5.2'S OWN SCRIPTS, LOOSE IN Data\Scripts. Issue #960, 28 September: on
# dev, "SKYUI ERROR CODE 6", menu file version mismatch for magicmenu.swf,
# skyui/itemcard.swf, skyui/bottombar.swf, map.swf and more, "required 5.2 SE,
# detected 6.11 SE".
#
# MEASURED on the shipping machine. The collection's SkyUI (Nexus 12604, in
# Vortex as SkyUI-12604-6-8) is one archive, SkyUI_SE.bsa: its menus say 6.11
# SE, and its own ski_main.pex (compiled 6 April 2026) no longer compares menu
# versions at all. But the ten names below sit loose in the Steam copy's
# Data\Scripts: SkyUI 5.2 SE's scripts, compiled 3 October 2017, whose
# ski_main.pex checks every menu for 5.2 SE. Loose beats an archive, so the old
# script runs against the new menus and puts up the error box. Vortex's record
# does not list them and no mod in its mods folder has them; the collection
# installer put them there (Profile\installed-into-game.txt lists all ten), the
# launcher linked them into Thornswood's folder, and the dev feed's baseline
# lists all ten, so dev packs have been handing them to everybody.
#
# Only these ten. SKI_ConfigBase.pex and SKI_ConfigManager.pex are loose too,
# but they are MCM Recorder's, deployed by Vortex, and stay.
# scripts\mods\Check-SkyUIMenus.js is the check Ship runs against this.
$ShipOldSkyUIScripts = @(
    'Data\Scripts\ski_activeeffectswidget.pex',
    'Data\Scripts\ski_configmenu.pex',
    'Data\Scripts\ski_favoritesmanager.pex',
    'Data\Scripts\ski_main.pex',
    'Data\Scripts\ski_playerloadgamealias.pex',
    'Data\Scripts\ski_qf_configmanagerinstance.pex',
    'Data\Scripts\ski_questbase.pex',
    'Data\Scripts\ski_settingsmanager.pex',
    'Data\Scripts\ski_widgetbase.pex',
    'Data\Scripts\ski_widgetmanager.pex'
)

# ANOTHER SERVER'S MENU UNDER Data\Platform\UI, issue #1318.
#
# 37 files from Daedric Online's menu (11 jpg, 22 png, 3 EB Garamond ttf,
# menu_theme.mp3) sat on the shipping machine and went out in every installer
# and pack with no licence. Nothing in this repository names them: build.js
# names none, and nothing else under Data\Platform does. Djinn, 9 Oct: remove
# them for good. They never ship, and every pack deletes them from installs.
# Matched by sha256 as well as by name, so a renamed copy still counts.
#
# The 41 unused skymp5-front svgs and bg.png beside them (the old "42 more
# files" row in THIRD-PARTY.md) are dead weight too: build.js names none of
# them. They stop shipping and every pack deletes them from installs as well.
#
# So do the four Futura PT and DIN Pro faces main's older front build named
# by hash (#1317): the front built from the fork names none of them since 20
# Oct, and without a gone entry the installs that took them would keep them.
#
# WHAT IS OURS UNDER UI. Only index.html, build.js, thornswood-* files, and
# the hashed assets build.js actually names. That last list is parsed from
# build.js at ship time, never kept by hand. OwnGame.Foreign reads the list
# Ship wrote into the pack rather than parsing build.js itself.
$ShipUiAssetsRel = 'Data\Platform\UI\thornswood-ui-assets.txt'
$ShipUiHashedPattern = '^[0-9a-f]{8,32}\.(ttf|woff2?|eot|otf|svg|png|jpe?g|gif|wav|mp3|ogg|webp)$'
# One record, records\ui-gone.json: the 37 Daedric names and sha256 values,
# and the 48 unused fork names (41 svgs and bg.png, the four commercial
# faces of #1317, and Bankir-Retro and icomoon, which fork #41 took out). OwnGame.Foreign reads the same file (Build-Launcher
# embeds it). A second hand-copied list here would drift.
$ShipUiGoneRecord = Join-Path $PSScriptRoot '..\..\records\ui-gone.json'
if (-not (Test-Path -LiteralPath $ShipUiGoneRecord -PathType Leaf)) {
    throw 'records\ui-gone.json is missing, so the Daedric menu set and unused fork assets cannot be kept out.'
}
$ShipUiGoneText = "$(Get-Content -LiteralPath $ShipUiGoneRecord -Raw -Encoding UTF8)"
if (-not $ShipUiGoneText.Trim([char]0xFEFF, ' ', [char]9, [char]13, [char]10)) { throw 'records\ui-gone.json is empty, so the Daedric menu set and unused fork assets cannot be kept out.' }
try { $script:ShipUiGoneDoc = $ShipUiGoneText.TrimStart([char]0xFEFF) | ConvertFrom-Json }
catch { throw ('records\ui-gone.json is not valid JSON, so the Daedric menu set and unused fork assets cannot be kept out: ' + $_.Exception.Message) }
# RecordShape.ps1 (#2180): a version this checkout does not know or a missing
# list stops here, rather than shipping with half of what must go kept out.
. (Join-Path $PSScriptRoot 'RecordShape.ps1')
$ShipUiGoneBad = @(Get-ThornswoodRecordProblems -Doc $script:ShipUiGoneDoc -Kind ui-gone)
if ($ShipUiGoneBad.Count) { throw ('records\ui-gone.json is not a ui-gone record this checkout can trust, so the Daedric menu set and unused fork assets cannot be kept out: ' + ($ShipUiGoneBad -join '; ')) }
$ShipDaedricMenu = [ordered]@{}
foreach ($p in @($script:ShipUiGoneDoc.daedric.PSObject.Properties)) {
    $ShipDaedricMenu[$p.Name] = ([string]$p.Value).ToLowerInvariant()
}
$ShipUnusedFrontAssets = @($script:ShipUiGoneDoc.unused | ForEach-Object { [string]$_ })
$ShipDaedricMenuHashes = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($h in $ShipDaedricMenu.Values) { [void]$ShipDaedricMenuHashes.Add($h) }
$ShipUiGoneLeaves = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($n in $ShipDaedricMenu.Keys) { [void]$ShipUiGoneLeaves.Add($n) }
foreach ($n in $ShipUnusedFrontAssets) { [void]$ShipUiGoneLeaves.Add($n) }

function Get-ShipFileSha256([string]$full) {
    if (-not $full -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { return '' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $fs = New-Object IO.FileStream($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try { return ([BitConverter]::ToString($sha.ComputeHash($fs))).Replace('-', '').ToLowerInvariant() }
        finally { $fs.Dispose() }
    }
    finally { $sha.Dispose() }
}

# Webpack file-loader (and asset modules) emit the publicPath concatenated
# with the output file name:
#   module.exports = __webpack_require__.p + "hash.ext";
#   e.exports=n.p+"hash.ext";
# A webpack *dev* eval build wraps that in a string, so the quotes are
# escaped:
#   eval("module.exports = __webpack_require__.p + \"hash.ext\";")
# Quoted source module ids ("./src/img/foo.svg") are webpack keys, not
# concatenations, and are ignored. A concatenation whose URL is not a bare
# name (slash, '..', drive, or rooted) refuses the ship, naming the entry.
# A bare name that is not a hashed asset is ignored, not counted as ours.
function Read-ShipUiHashedAssetsFromText([string]$text) {
    $names = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $concatRe = '(?:__webpack_require__|n)\.p\s*\+\s*(?:\\"([^"]*)\\"|\"([^"]*)\")'
    foreach ($m in [regex]::Matches($text, $concatRe)) {
        $s = $m.Groups[1].Value
        if ([string]::IsNullOrEmpty($s)) { $s = $m.Groups[2].Value }
        $s = $s.Replace('\/', '/').Replace('\\', '\')
        $q = $s.IndexOf('?')
        if ($q -ge 0) { $s = $s.Substring(0, $q) }
        if ([string]::IsNullOrEmpty($s)) { continue }
        $rooted = $s.StartsWith('/') -or $s.StartsWith('\') -or ($s.Length -ge 2 -and $s[1] -eq [char]':')
        $dots = $s -match '(^|[\\/])\.\.($|[\\/])'
        if ($rooted -or $dots -or $s.Contains('/') -or $s.Contains('\')) {
            throw ("build.js names '{0}', which is not a bare hashed asset (slash, '..', or a rooted path). Nothing was packed." -f $s)
        }
        if ($s -notmatch $ShipUiHashedPattern) { continue }
        [void]$names.Add($s)
    }
    return $names
}

$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null
$script:ShipUiHashedGameDir = $null
$script:ShipUiHashedWritten = @()

function Get-ShipUiBuildJsPath {
    $game = $script:ShipUiHashedGameDir
    if (-not $game) {
        $game = Get-Variable -Name GameDir -ValueOnly -ErrorAction SilentlyContinue
    }
    if (-not $game) { return '' }
    return Join-Path ([string]$game) 'Data\Platform\UI\build.js'
}

# The hashed asset names build.js names, parsed at ship time. Empty when there
# is no GameDir or no build.js, so a unit test that only asks a path still
# runs. A bad path in build.js throws, which is how a ship is refused.
function Get-ShipUiHashedAssets {
    $build = Get-ShipUiBuildJsPath
    if (-not $build -or -not (Test-Path -LiteralPath $build -PathType Leaf)) {
        return @()
    }
    $item = Get-Item -LiteralPath $build
    $key = '{0}|{1}|{2}' -f $item.FullName, $item.Length, $item.LastWriteTimeUtc.Ticks
    if ($script:ShipUiHashedCacheKey -eq $key -and $null -ne $script:ShipUiHashedCache) {
        return $script:ShipUiHashedCache
    }
    $set = Read-ShipUiHashedAssetsFromText ([IO.File]::ReadAllText($build))
    $script:ShipUiHashedCache = @($set)
    $script:ShipUiHashedCacheKey = $key
    return $script:ShipUiHashedCache
}

function Test-ShipUiHashedAssetName([string]$leaf) {
    return [bool]($leaf -and ($leaf -match $ShipUiHashedPattern))
}

# Ours under Data\Platform\UI: index.html, build.js, thornswood-* files, and
# hashed assets build.js named. Everything else flat or nested is not ours.
function Test-ShipUiOurs([string]$rel, [string]$leaf) {
    if ($leaf -ieq 'index.html' -or $leaf -ieq 'build.js') { return $true }
    if ($leaf -like 'thornswood-*') { return $true }
    if (Test-ShipUiHashedAssetName $leaf) {
        foreach ($n in @(Get-ShipUiHashedAssets)) { if ($n -ieq $leaf) { return $true } }
    }
    return $false
}

function Test-ShipUiGoneByHash([string]$rel) {
    $game = Get-Variable -Name GameDir -ValueOnly -ErrorAction SilentlyContinue
    if (-not $game) { return $false }
    # [IO.Path]::Combine, not Join-Path: Join-Path throws on a drive this
    # machine has not got (the test's X:\Game\ fakes on the nightly runner).
    $full = [IO.Path]::Combine([string]$game, $rel.Replace('\', [IO.Path]::DirectorySeparatorChar))
    $have = Get-ShipFileSha256 $full
    if (-not $have) { return $false }
    return $ShipDaedricMenuHashes.Contains($have)
}

# Ship-time guard: parse build.js, refuse on zero names, refuse if a named
# file is missing, refuse a bad path (Read-ShipUiHashedAssetsFromText throws).
# Writes the parsed names into Data\Platform\UI\thornswood-ui-assets.txt so
# the pack carries them and OwnGame.Foreign can read them.
function Save-ShipUiHashedAssets([string]$GameFolder) {
    if (-not $GameFolder) { throw 'Save-ShipUiHashedAssets needs the game folder.' }
    $savedParse = $script:ShipUiHashedGameDir
    $script:ShipUiHashedGameDir = $GameFolder
    $savedGame = Get-Variable -Name GameDir -ValueOnly -ErrorAction SilentlyContinue
    $GameDir = $GameFolder
    try {
        $build = Join-Path $GameFolder 'Data\Platform\UI\build.js'
        if (-not (Test-Path -LiteralPath $build -PathType Leaf)) {
            throw 'Data\Platform\UI\build.js is missing, so the front''s hashed assets cannot be derived. Nothing was packed.'
        }
        $script:ShipUiHashedCacheKey = ''
        $script:ShipUiHashedCache = $null
        $names = @(Get-ShipUiHashedAssets)
        if ($names.Count -eq 0) {
            throw 'build.js named no hashed assets, so the parse is wrong or the front is empty. Nothing was packed.'
        }
        $ui = Join-Path $GameFolder 'Data\Platform\UI'
        foreach ($n in $names) {
            $at = Join-Path $ui $n
            if (-not (Test-Path -LiteralPath $at -PathType Leaf)) {
                throw ("build.js names '{0}', which is not in Data\Platform\UI. Nothing was packed." -f $n)
            }
        }
        $sorted = @($names | Sort-Object { $_.ToLowerInvariant() })
        $lines = New-Object 'System.Collections.Generic.List[string]'
        [void]$lines.Add('# Hashed assets Data\Platform\UI\build.js named. Written by Ship at pack time (#1318).')
        [void]$lines.Add('# One bare file name per line. OwnGame.Foreign reads this rather than parsing build.js.')
        foreach ($n in $sorted) { [void]$lines.Add($n) }
        $out = Join-Path $GameFolder $ShipUiAssetsRel
        # Written only when the names moved, so a Ship that finds the same front
        # leaves the file and its time alone: an old size and time baseline then
        # still reads it as unchanged (#2088).
        # CRLF from every machine, as every release has carried it (#2903).
        $text = ($lines -join "`r`n") + "`r`n"
        if (-not (Test-Path -LiteralPath $out -PathType Leaf) -or [IO.File]::ReadAllText($out) -ne $text) {
            [IO.File]::WriteAllText($out, $text)
        }
        $script:ShipUiHashedWritten = $sorted
        return $sorted
    }
    finally {
        $script:ShipUiHashedGameDir = $savedParse
        if ($null -ne $savedGame) { $GameDir = $savedGame }
        else { Remove-Variable -Name GameDir -ErrorAction SilentlyContinue }
    }
}

# FIVE FILES UNDER Data\Platform THAT NOTHING USES, issue #2177. Patrick,
# 15 Oct: they stop shipping and every install loses them on the next
# release. Two pictures in Images (lock.png, a red broken padlock, and
# speaking.png, a white speaker), dated 12 Sep, and three DirectXTK icon fonts
# in Fonts (four, one and one glyphs in the private use range), dated 14 Sep.
# None is in the SkyMP fork or its history. Searched 16 Oct: no file in this
# repository, the game folder's skymp5-client.js, build.js or Modules, or the
# fork names any of them. Skyrim Platform loads every sprite font in Fonts by
# its name (DX11RenderHandler.cpp), and a font is drawn only when a script
# names it: ours names Barlow-SemiBold (#1317), and Tavern is the default. Nothing
# reads Images. Nobody recorded who made them or on what terms.
#
# Test-ShipOtherServer calls them not ours, so no pack or installer carries
# them, and they are on $ShipDeleteAlways below, so every pack deletes them
# from the installs that have them. Tavern and Barlow-SemiBold still ship;
# DIN-Pro-bold and Futura are $ShipCommercialFonts below. OwnGame.Foreign carries the same five so
# a refresh cannot copy them back from a Steam copy; change the two together.
# tests\test-2177-platform-unused.ps1 holds both.
$ShipPlatformUnused = @(
    'Data\Platform\Images\lock.png',
    'Data\Platform\Images\speaking.png',
    'Data\Platform\Fonts\ChainLink.spritefont',
    'Data\Platform\Fonts\NoticeIcon.spritefont',
    'Data\Platform\Fonts\VoiceIcon.spritefont'
)

# TWO SPRITE FONTS OF COMMERCIAL FACES, issue #1317. DIN-Pro-bold.spritefont
# is FSI FontShop's DIN Pro Bold drawn into a sprite font, from upstream
# SkyMP's client-deps; Futura.spritefont, dated 14 Sep, is by its name
# ParaType's Futura PT and is in neither the fork nor upstream. Nothing gives
# SkyMP or Thornswood the right to hand either face on. The one thing that drew
# with either was the overhead voice mark, which draws its dot in
# Barlow-SemiBold.spritefont since #1317 (game\ours, made by
# scripts\mods\Build-SpriteFont.py from the OFL Barlow SemiBold the fork's
# interface uses). They are not ours, so no pack or installer carries them,
# and they are on $ShipDeleteAlways below, so every install loses them on the
# next release. OwnGame.Foreign carries the same two so a refresh cannot copy
# them back from a Steam copy; change the two together.
# tests\test-1317-fonts.ps1 holds both.
$ShipCommercialFonts = @(
    'Data\Platform\Fonts\DIN-Pro-bold.spritefont',
    'Data\Platform\Fonts\Futura.spritefont'
)

function Test-ShipOtherServer([string]$rel) {
    # The client runtime, before anything else is asked: ours when it is the
    # recorded build, and not ours when it is anything else or is not there.
    if ($ShipClientFiles.Contains($rel)) { return (-not (Test-ShipClientRecorded $rel)) }
    # NirnLab UI Platform. SkyrimPlatform will not start on its own browser
    # while this is in the game folder, and it is what brings CEFSubprocess.exe,
    # the second program Windows Firewall asks about. The old installer kept it
    # out all along; nothing kept it out of a pack until this.
    if ($rel -match '^Data\\NirnLabUIPlatform($|\\)') { return $true }
    if ((Split-Path $rel -Leaf) -ieq 'NirnLabUIPlugin.dll') { return $true }
    # Other launchers' parking folders inside our own game folder, Djinn, 25
    # September. Another SkyMP server's launcher moves the Creation Club archives it turns
    # off into a folder in Data named _disabledBy and its own short name, and
    # keeps its own backup and plugin list beside the game; the Daedric
    # server's launcher keeps DaedricData. They came back after a Play and put
    # 2.4 GB of somebody else's files into a dev release. Never shipped, never
    # removed. Anchored, with a boundary.
    # All three are matched by their shape, not by the server's name or its
    # short forms, which no file here carries (Patrick, 12 October, and
    # decision C of 15 October, #400): a folder directly in Data named
    # _disabledBy<name>, and a folder at the root named <name>-backup-<version>
    # or _<name>-plugins-off. Nothing of ours sits in either place under any
    # of those shapes.
    if ($rel -match '^Data\\_disabledBy[^\\]+($|\\)') { return $true }
    if ($rel -match '^(DaedricData|_[^\\]+-plugins-off|[^\\]+-backup-[^\\]+)($|\\)') { return $true }
    # See $ShipDeleteAlways below for why this one also has to be DELETED from
    # machines that already have it, and not merely left out of new packs.
    # A loose map.swf. Somebody else left it in the Steam copy, it overrides
    # SkyUI's own copy inside SkyUI_SE.bsa because loose beats an archive, and
    # SkyUI answers with a full screen "ERROR CODE 5, Incompatible menu file
    # (map.swf)" on the way in. Vortex's deployment record does not list it and
    # A Quality World Map ships no Interface file at all, so nothing in the
    # collection wants it and taking it out keeps the good map.
    # OwnGame.Foreign carries the same rule; change the two together.
    if ($rel -ieq 'Data\Interface\map.swf') { return $true }
    # SkyUI 5.2's own scripts, loose, issue #960. See $ShipOldSkyUIScripts.
    # OwnGame.Foreign carries the same rule; change the two together.
    if ($ShipOldSkyUIScripts -contains $rel) { return $true }
    # Elysium Estate 4.3.5's plugin, issue #690: the servers load the
    # collection's ElysiumEstate.esp since 29 September, and every pack deletes
    # this name (see $ShipDeleteAlways). OwnGame.Foreign carries the same rule;
    # change the two together.
    if ($rel -ieq 'Data\ElysiumEstateSSE.esp') { return $true }
    if (-not $rel.StartsWith('Data\Platform\', 'OrdinalIgnoreCase')) { return $false }
    $leaf = Split-Path $rel -Leaf
    if ($rel.StartsWith('Data\Platform\PluginsNoLoad\', 'OrdinalIgnoreCase')) { return $true }
    if ($leaf -like '*.bak') { return $true }
    # The retired dresser, To Do List entry 127. It is deleted from the repo
    # and never ships again, and it is on $ShipDeleteAlways below so every
    # pack takes it off the machines that have it. OwnGame.Foreign carries the
    # same rule; change the two together.
    if ($rel -ieq 'Data\Platform\Plugins\thornswood-chargen.js') { return $true }
    # The five files nothing uses (#2177, $ShipPlatformUnused above).
    foreach ($u in $ShipPlatformUnused) { if ($rel -ieq $u) { return $true } }
    # The two commercial sprite fonts (#1317, $ShipCommercialFonts above).
    foreach ($u in $ShipCommercialFonts) { if ($rel -ieq $u) { return $true } }
    # In Plugins only our overlays belong. The bundle was decided by its hash above.
    if ($rel -like 'Data\Platform\Plugins\*.js') {
        if ($leaf -like 'thornswood-*.js') { return $false }
        return $true
    }
    # Under UI, ours is only index.html, build.js, thornswood-* files, and
    # the hashed assets build.js names (parsed at ship time, #1318). Nested
    # paths, another menu's Vite files, the Daedric set, the unused fork
    # svgs and bg.png, and any unnamed flat file are not ours. A renamed
    # copy of the Daedric set still counts, by sha256. The first version of
    # this rule on 20 September whitelisted three names and called the
    # front's own hashed files foreign; the 13:02 dev Ship left them out.
    # The next version treated every flat file as ours, which is how the 37
    # slipped through.
    if ($rel -like 'Data\Platform\UI\*') {
        $rest = $rel.Substring('Data\Platform\UI\'.Length)
        if ($rest.Contains('\') -or $rest.Contains('/')) { return $true }
        if ($leaf -ieq 'app.js' -or $leaf -ieq 'vite.svg') { return $true }
        if ($ShipUiGoneLeaves.Contains($leaf)) { return $true }
        if (Test-ShipUiGoneByHash $rel) { return $true }
        if (Test-ShipUiOurs $rel $leaf) { return $false }
        return $true
    }
    return $false
}

# ---------------------------------------------------------------------------
# BETHESDA'S OWN FILES, AND OTHER PEOPLE'S FRAMEWORKS AND TOOLS.
#
# Never shipped, and never listed as removed. Until 24 September these were
# two lists, one inside Publish-Update.ps1 and a longer one inside the old
# installer's builder, which is exactly what the header of this file says
# must not happen, and they had drifted.
#
# MEASURED 24 SEPTEMBER over all 30,697 files in C:\Thornswood\Game on the
# machine that ships: packs carried 90 files (55.5 MB) that the installer
# deliberately left out, and all 90 were in both publish baselines. 82 were
# Nemesis's cache, logs and temporary behaviour files under
# Data\Nemesis_Engine, six were the Bethesda launcher's own state under
# BStarData (that machine's load order, plugin list and Skyrim.ini backups
# among them), and the last two were imgui.ini and steam_appid.txt. None of
# them came from Vortex: the launcher's record has every one as taken from the
# Steam copy. The lists below are the union of the two, so packs now leave out
# what the installer always did, and the installer leaves out what it always
# did.
#
# NEVER REMOVED, ON PURPOSE. A file the pack stops carrying looks gone from
# the build to Publish-Update, and a file gone from the build becomes a line
# in delete.txt unless Test-ShipMachine claims it. So Test-ShipMachine asks
# both tests below. Without that, the first pack after the lists became one
# would have deleted all 90 from every tester, steam_appid.txt with them. They
# stay on every machine that has them; packs simply stop carrying them.

# The five masters every copy of the game has, and the resource pack Steam
# installs beside them.
$ShipVanillaDataFiles = @(
    'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
    '_ResourcePack.esl', '_ResourcePack.bsa'
)
# The game's own archives, and Creation Club content by its cc prefix. Steam
# installs some Creation Club plugins with the game, the rest is Bethesda's
# paid content, and none of it is ours to hand out. OwnGame.UnwantedCreation
# in the launcher counts on packs never carrying a cc plugin.
$ShipVanillaDataPatterns = @('Skyrim - *.bsa', 'cc*.esm', 'cc*.esl', 'cc*.esp', 'cc*.bsa')
# Bethesda's intro videos and the game's translated strings.
$ShipVanillaDataDirs     = @('Video', 'Strings')

# Other people's frameworks and modding tools, by their folder under Data.
#
# Vortex's manifest answers "did Vortex put this here", which is not the same
# question as "does Thornswood need this". These folders answered no to the
# first and were shipped to everybody as though they were ours.
#
# NirnLabUIPlatform is another roleplay server's user interface framework and
# on its own it is 356 MB. Nemesis, FNIS, BodySlide, xEdit and Pandora (the
# behavior engine from collection revision 2, #1247, in the folder of its own
# the collection gives it and its Pandora_Engine patch folder) are tools that
# belong on the machine of somebody who builds mods, not in a folder handed to
# somebody who plays. The rest is documentation, installer leftovers and a
# shader cache that rebuilds itself on first launch. Data\Source, Papyrus script
# sources, was on this list until #1227 moved it to the Creation Kit's rule
# (Test-ShipBethesdaTool) with Data\Scripts\Source, which this list never had.
#
# All of them stay where they are on every machine. This only decides what
# goes into a pack or the installer.
#
# Only the installer had this list until 24 September. Packs kept NirnLab out
# anyway, through Test-ShipOtherServer above; the 82 Nemesis files were what
# they carried from it.
#
# NirnLab is still an open question for Patrick and Djinn, and merging the
# lists does not answer it. The note over Checks.ForeignNames in the launcher
# says NirnLabUIPlugin.dll is this build's own browser and must never be
# treated as foreign. This file, the installer and OwnGame.Foreign
# all treat it as foreign. What this machine runs on, read
# 24 September: SkyrimPlatform.ini says BackendName = tilted, the plugin log of
# the 10:20 session on 23 September says "browser backend: tilted", and there
# is no Data\NirnLabUIPlatform in C:\Thornswood\Game.
$ShipForeignDataDirs = @(
    'NirnLabUIPlatform',
    'Nemesis_Engine', 'FNIS Behavior SE 7.6', 'CalienteTools', 'tools',
    'Pandora Behaviour Engine', 'Pandora_Engine',
    'ModderResource', 'FOMod',
    'Docs', 'Docs and Screenshots', 'readmes',
    'ShaderCache'
)

$ShipVanillaRootFiles = @(
    # The game, its launcher, Steam's library and the video codec. The
    # installer fingerprints three of them into vanilla.json so it can tell a
    # clean Steam copy from a patched one; it never carries them.
    'SkyrimSE.exe', 'SkyrimSELauncher.exe', 'steam_api64.dll', 'bink2w64.dll',
    # The game's Creation Club list, Steam's install script, and the settings
    # presets Bethesda's launcher picks from.
    'Skyrim.ccc', 'installscript.vdf', 'Skyrim_Default.ini',
    'High.ini', 'Low.ini', 'Medium.ini', 'Ultra.ini',

    # Only on the installer's list until 24 September.
    #
    # The script extender is not ours to hand out and it is in the collection
    # now, so shipping it again would be redistributing somebody's mod and
    # doing it twice. VERSION and steam_appid.txt belong to Steam and the
    # downgrader. imgui.ini and the d3dx9 log are written at runtime by
    # whatever was last run against this install.
    #
    # The installer said these were only ever seen when building out of the
    # Steam copy. Not so: the launcher copies steam_appid.txt and imgui.ini
    # from the Steam copy into Thornswood's own folder, and packs carried both.
    'skse64_loader.exe', 'skse64_1_6_1170.dll',
    'skse64_readme.txt', 'skse64_whatsnew.txt',
    'VERSION', 'steam_appid.txt', 'imgui.ini', 'd3dx9_42.log'
)
$ShipVanillaRootDirs = @(
    # The downgrader's backups of the files it replaced: the game's own
    # programs and Creation Club archives, 46 files on the machine that ships.
    '_DowngraderBackups',
    # Two folders beside the game that are empty on the machine that ships,
    # and Skyrim\, which holds only SkyrimPrefs.ini.
    'Creations', 'Mods', 'Skyrim',
    # The script extender's source code, which comes with it.
    'src',
    # Bethesda's launcher keeps its own folder. Not ours, not in an installer,
    # and not in a pack either: six of its files rode in packs until
    # 24 September.
    'BStarData'
)

function Test-ShipVanilla([string]$rel) {
    $parts = $rel -split '\\'
    $top   = $parts[0]
    if ($ShipVanillaRootDirs -contains $top) { return $true }
    if ($parts.Count -eq 1) { return ($ShipVanillaRootFiles -contains $top) }
    if ($top -ne 'Data') { return $false }
    if ($parts.Count -ge 3 -and ($ShipVanillaDataDirs -contains $parts[1])) { return $true }
    if ($parts.Count -eq 2) {
        $leaf = $parts[1]
        if ($ShipVanillaDataFiles -contains $leaf) { return $true }
        foreach ($p in $ShipVanillaDataPatterns) { if ($leaf -like $p) { return $true } }
    }
    return $false
}

function Test-ShipForeignFramework([string]$rel) {
    $parts = $rel -split '\\'
    if ($parts[0] -ne 'Data') { return $false }
    return ($parts.Count -ge 2 -and ($ShipForeignDataDirs -contains $parts[1]))
}

# Bethesda's own files that packs have already carried. Never shipped again,
# and never listed as removed.
#
# Data\MarketplaceTextures.bsa is Bethesda's archive for the in-game Creations
# menu: 121 files, every one under interface\marketplace (buttons for pc and
# xbox, and the stars). 2.8 MB, dated 10 September 11:08:10, five seconds
# after _ResourcePack.bsa, and _DowngraderBackups holds a 3.2 MB copy of it
# beside the rest of Bethesda's files. No plugin loads it by name and Vortex
# does not provide it, so it was in neither vanilla list and in no record,
# and every pack and the installer carried it.
#
# WHY IT WAS NOT PUT WITH SKYRIM.ESM IN THE VANILLA LISTS. Measured 24
# September: both pack baselines, published.json and published-dev.json, list
# Data\MarketplaceTextures.bsa. Publish-Update lists as removed anything the
# last pack had that this scan does not, and the only thing that stops that is
# Test-ShipMachine. When this list was made the vanilla lists were not asked
# there, so a vanilla rule would have left it out of the scan, the next pack
# would have put it in delete.txt, and every launcher that took the pack would
# have deleted a Bethesda file off a tester who has every right to it. Asked
# here, through Test-ShipMachine, it leaves packs and the installer and
# nobody's copy is touched. The launcher builds Thornswood's game folder out
# of the tester's own Steam copy, which is where this machine's came from:
# Profile\OwnGame\files.txt has it as linked in from the Steam copy (L), and
# not deployed by Vortex (O).
#
# The same day the vanilla lists moved into this file and Test-ShipMachine
# started asking them as well (the note over $ShipVanillaDataFiles), so a
# vanilla rule is now just as safe. This list stays because it is the record
# of which Bethesda files a pack has already carried, each with its
# measurement. Put a Bethesda file here whenever a pack has already carried
# it, so that record stays whole.
$ShipBethesdaLeftAlone = @(
    'Data\MarketplaceTextures.bsa'
)

function Test-ShipBethesdaLeftAlone([string]$rel) {
    foreach ($f in $ShipBethesdaLeftAlone) {
        if ($rel -ieq $f) { return $true }
    }
    return $false
}

# MADE FROM THE GAME ON EACH MACHINE, NEVER SHIPPED (#2827).
#
# The main menu (Skyrim's own startmenu.swf with its logo shapes taken out,
# #2177) and the notice board's two meshes (pieces of Skyrim's own meshes,
# #2298) are Bethesda's files, edited or put together, and Bethesda's terms
# grant no right to hand those on (#2792). Patrick chose on 19 Oct that each
# machine makes them from its own game (#2827, option 2): the launcher before
# every Play (launcher\app\MadeFromGame.cs) and Go.ps1 for a ship root. So
# they are in every game folder Ship reads, and none of them may leave it: a
# pack, the installer or a record that carried one would hand on Bethesda's
# file again. Test-ShipBethesda says yes to them, so the record guard refuses
# them and Scrub-Feed.ps1 takes them out of what is already on the site.
#
# NEVER LISTED AS REMOVED either (Test-ShipMachine): an install that took one
# from an earlier pack has the very bytes the launcher makes, and a delete.txt
# line would only take it away until the next Play made it again. The
# launcher's list is FromGame.Files; tests\test-2827-from-game.ps1 holds the
# two to each other.
$ShipMadeFromGame = @(
    'Data\Interface\startmenu.swf',
    'Data\meshes\thornswood\noticeboard01.nif',
    'Data\meshes\thornswood\dropbox01.nif'
)

function Test-ShipMadeFromGame([string]$rel) {
    foreach ($f in $ShipMadeFromGame) {
        if ($rel -ieq $f) { return $true }
    }
    return $false
}

# MADE FROM THE COLLECTION'S MODS ON EACH MACHINE, NEVER SHIPPED (#3113).
#
# An item on Thornswood has no gold price, and three of the collection's mods
# draw one: SkyUI's item lists and item card, SkyHUD's line under an item
# somebody looks at, and moreHUD's value to weight. And SkyUI's journal puts
# Quick Save, Save, Load, Help and the Creation Club on its System page, which
# Thornswood does not use (#3127). The launcher makes these six from each
# machine's own copy of those mods, out of their archives
# (launcher\app\FromGameModMenus.cs, written by scripts\mods\Build-ModMenus.py),
# the same way and at the same times as the three above. They are their
# authors' files edited, so none of them may leave the machine either, and none
# is listed as removed: a delete.txt line would take one away until the next
# Play made it again. Not Bethesda's, so Test-ShipBethesda does not ask this;
# Test-ShipMachine does. The launcher's list is FromGame.Files after the three
# above; tests\test-2827-from-game.ps1 holds the two to each other.
$ShipMadeFromMods = @(
    'Data\Interface\skyui\config.txt',
    'Data\Interface\skyui\itemcard.swf',
    'Data\Interface\hudmenu.swf',
    'Data\Interface\AHZHudInfo.swf',
    'Data\Interface\exported\AHZHudInfo.swf',
    'Data\Interface\quest_journal.swf'
)

function Test-ShipMadeFromMods([string]$rel) {
    foreach ($f in $ShipMadeFromMods) {
        if ($rel -ieq $f) { return $true }
    }
    return $false
}

# MADE FROM THE RECIPE ON EACH MACHINE, NEVER SHIPPED (#2791).
#
# Thornswood-Last.esp copies the winning record of each cell, world, quest and
# placed actor it changes out of about 31 other authors' plugins, so Patrick
# chose on 26 Oct 2026 (A on #3721) that Thornswood hands on only its recipe:
# a release carries Data\Thornswood-Last.recipe ($ShipOursFiles), and the
# launcher makes the plugin from it and the person's own plugins before every
# Play (launcher\app\LastPlugin.cs), as the box does for the servers
# (scripts\deploy\LastPluginOnBox.ps1). So no pack, installer or record
# carries the plugin, and none lists it as removed (Test-ShipMachine): an
# install that took it from an earlier pack has the very bytes the launcher
# makes, and a delete.txt line, or a gone entry by its sha256, would only take
# it away until the next Play made it again. Scrub-Feed.ps1 takes it out of
# the packs and records already on the site, as another author's
# (Test-ShipNotOurs), once both channels carry the recipe.
$ShipMadeFromRecipe = @(
    'Data\Thornswood-Last.esp'
)

function Test-ShipMadeFromRecipe([string]$rel) {
    foreach ($f in $ShipMadeFromRecipe) {
        if ($rel -ieq $f) { return $true }
    }
    return $false
}

# A mod Thornswood has taken out. Never shipped, and never listed as removed:
# the launcher takes these out of its own game folder itself (OwnGame.Retired,
# rules 7), so a pack has nothing to delete and no Vortex file in the Steam
# copy is touched. Change the two lists together.
#
# Start On Save (po3, Nexus 50054), issue #394. Under SkyMP it only ever
# started a second load on top of the server's, which crashed the game about
# thirty seconds in, and the launcher held it still by rewriting its settings
# file on every Play. That rewrite is gone, so neither file may reach a build:
# the DLL with an untouched settings file is the crash again.
$ShipRetiredFiles = @(
    'Data\SKSE\Plugins\po3_StartOnSave.dll',
    'Data\SKSE\Plugins\po3_StartOnSave.ini'
)

function Test-ShipRetired([string]$rel) {
    foreach ($f in $ShipRetiredFiles) {
        if ($rel -ieq $f) { return $true }
    }
    return $false
}

# Body shape sliders and jiggle, issue #993. Patrick, 28 September: no jiggle
# physics and nothing in creation that changes breasts, seat, genitals or
# nipples, for men and women alike; height and weight stay. CBPC's cbp.dll is
# all of the jiggle, and the three scripts are RaceMenu's body slider pages.
# The launcher leaves them out of its own game folder (OwnGame.BodyShape,
# rules 9), so, like the retired files above, a pack never carries them and
# never lists them as removed. Change the two lists together.
$ShipBodyShapeFiles = @(
    'Data\SKSE\Plugins\cbp.dll',
    'Data\Scripts\RaceMenuMorphsCBBE.pex',
    'Data\Scripts\_RaceMenuMorphsHIMBO.pex',
    'Data\Scripts\RaceMenuPluginSoS.pex'
)

function Test-ShipBodyShape([string]$rel) {
    foreach ($f in $ShipBodyShapeFiles) {
        if ($rel -ieq $f) { return $true }
    }
    return $false
}

# BETHESDA'S CREATION KIT, AND COPIES OF THE GAME'S OWN PROGRAMS. Issue #1152.
#
# Never shipped, never in a release record, and never listed as removed.
# Thornswood never hands out Bethesda's files: the installer fingerprints the
# game (vanilla.json) and never carries it.
#
# MEASURED 29 September on the dev record the feed named that day
# (20260929-0259-dev): of its 2,515 files of ours, about 180 MB were Bethesda's.
# CreationKit.exe (46.4 MB) with CreationKit.ini and CreationKitPrefs.ini; the
# Tools folder (86.8 MB: AssetWatcher, the Havok, lip sync and audio tools,
# Microsoft's redistributables); Papyrus Compiler; lex; flowchartx64.dll,
# flowchartx32.dll and p4com64.dll; EditorWarnings.txt, DataFiles.txt and
# SkyrimReservedAddOnIndexes.txt; Data\Scripts.zip, the game's script sources
# (13.6 MB); 1,785 files under Data\DialogueViews (55.4 MB); and
# SkyrimSE.exe.bak-1160-for-369 (35.4 MB), a copy of Skyrim itself. Main pack
# 20260926-1603 carried the Creation Kit and the copy of the game, and the dev
# packs 20260927-0059 and 0250 the rest.
#
# How they got in: Steam installs the Creation Kit into the Steam copy, the
# launcher's own folder takes what the Steam copy has, and a file Vortex did
# not deploy counted as ours. The vanilla lists above name SkyrimSE.exe, not a
# copy of it under another name.
#
# NOT LISTED AS REMOVED, ON PURPOSE. A pack's delete.txt reaches every
# launcher, old ones too, and an install with no game folder of its own
# applies it to the Steam copy, where a Creation Kit is the person's own. So
# the launcher takes these out of its own game folder itself
# (OwnGame.BethesdaTool, rules 10) and nothing touches a Steam copy. Change the
# two together.
#
# THE CREATION KIT'S SCRIPT SOURCES (#1227). The Creation Kit unpacks
# Data\Scripts.zip into Data\Source\Scripts the first time it runs: on the
# shipping machine that was 14,298 .psc files (15.9 MB), which Thornswood's own
# folder took from the Steam copy as its own. Packs had left Data\Source out
# since 24 September, through the foreign frameworks list, but the launcher
# did not. Data\Scripts\Source, the same folder under the name the first
# Creation Kit and SKSE use, was on no list at all. Measured over HTTPS on
# 29 September: all five dev records the feed lists (20260928-2324-dev to
# 20260929-140118-dev) name Data\Scripts\Source\IED.psc, which was sent to the
# site loose, and main packs 20260915-2018, 20260915-2104 and 20260915-2144
# each carried the script extender's 62 sources there (SKSE.psc, Actor.psc and
# the rest). No record or pack names anything under Data\Source.
#
# Both folders are the Creation Kit's alone: the game reads the compiled
# scripts in Data\Scripts and never a source. So the whole of both folders
# never ships, whoever put a file there: Bethesda's sources, and the sources
# mod authors put beside them, which are the collection's to hand out.
# Thornswood has no Papyrus sources in a game folder. Ours are the engine
# fork's (engine\skymp: MpClientPlugin.psc and the Skyrim Platform ones), and
# they stay in the repository; only their compiled scripts reach a game.
#
# Measured the same day on the Steam copy's Creation Kit install list (its two
# Steam depots, 56 files): every file it installs is named here. The Creation
# Kit then writes CreationKitPrefs.ini, EditorWarnings.txt, DataFiles.txt,
# Data\DialogueViews and these sources as it runs; those are named here too.
$ShipBethesdaToolRootDirs  = @('Tools', 'Papyrus Compiler', 'lex')
$ShipBethesdaToolDataDirs  = @('Data\DialogueViews', 'Data\Source', 'Data\Scripts\Source')
$ShipBethesdaToolRootFiles = @(
    'flowchartx64.dll', 'flowchartx32.dll', 'p4com64.dll',
    'EditorWarnings.txt', 'DataFiles.txt', 'SkyrimReservedAddOnIndexes.txt'
)

function Test-ShipBethesdaTool([string]$rel) {
    $parts = $rel -split '\\'
    if ($parts.Count -gt 1 -and ($ShipBethesdaToolRootDirs -contains $parts[0])) { return $true }
    if ($parts.Count -eq 1) {
        $leaf = $parts[0]
        # CreationKit.exe, its settings files and anything else it names so.
        if ($leaf -like 'CreationKit*') { return $true }
        if ($ShipBethesdaToolRootFiles -contains $leaf) { return $true }
        # A copy of one of the game's programs under another name, such as
        # SkyrimSE.exe.bak-1160-for-369. The programs themselves are vanilla.
        if ($leaf -match '^(SkyrimSE|SkyrimSELauncher|skse64_loader)\.exe.') { return $true }
        return $false
    }
    if ($rel -ieq 'Data\Scripts.zip') { return $true }
    foreach ($d in $ShipBethesdaToolDataDirs) {
        if ($rel.StartsWith($d + '\', 'OrdinalIgnoreCase')) { return $true }
    }
    return $false
}

# A BACKUP IS NEVER A FILE OF THE BUILD, wherever it is. The rule in
# Test-ShipOtherServer only looked in Data\Platform, so the same dev record
# carried Data\SKSE\Plugins\SkyrimPlatform.ini.bak and
# SkyrimPlatform.ini.2026-09-19T20-17-00-253Z.bak (one machine's settings, see
# $ShipMachineFiles) and VERSION.bak beside the game (#1152). A name with .bak
# at its end, or followed by a dash or a dot. Never shipped, never removed.
function Test-ShipBackup([string]$rel) {
    return ((Split-Path $rel -Leaf) -match '\.bak($|[-.])')
}

# BETHESDA'S, ASKED ONE WAY EVERYWHERE (#1229). The game and its archives
# (Test-ShipVanilla), the Creation Kit, its script sources and copies of the
# game's programs (Test-ShipBethesdaTool), and Bethesda's files a pack once
# carried (Test-ShipBethesdaLeftAlone, MarketplaceTextures.bsa). Check-Secrets
# asked all three; the record guard in Publish-Update and the rollback filter in
# Rollback-Feed asked only the first two, so a record naming
# MarketplaceTextures.bsa, as a file or as gone, went through both. Every place
# that asks whether a path is Bethesda's asks this, so they cannot drift again;
# Scrub-Feed.ps1 takes exactly these out of what is already on the site.
# The launcher's own folder is the other side of it and keeps
# MarketplaceTextures.bsa: SkyrimSE.exe opens it by name (two references in the
# 1.6.1170 exe, read 29 September), so there it is the game's own file, like
# Skyrim.esm, and never one of the Creation Kit's that OwnGame.BethesdaTool
# drops. Measured the same day, no pack, record or loose file on the site names
# it.
function Test-ShipBethesda([string]$rel) {
    return ((Test-ShipBethesdaTool $rel) -or (Test-ShipVanilla $rel) -or (Test-ShipBethesdaLeftAlone $rel) -or
            (Test-ShipMadeFromGame $rel))
}

# ---------------------------------------------------------------------------
# ONE MACHINE'S OWN FILES, BY KIND (#1239).
#
# A file of the build is the same bytes on every install: a mod's plugin, its
# meshes, our overlays, the client. A file of one machine is whatever the game,
# a mod, the launcher, Vortex or a session wrote on the machine that ships,
# about that machine: who is signed in, what it last played, its screen, its
# key binds, where its windows sat, what its Vortex deployed. Handed to
# everybody it is at best dead weight and at worst one person's token or
# settings on every install.
#
# Until this rule the question was a list of names ($ShipMachineFiles), and a
# name nobody had added went out. MEASURED 29 September over HTTPS, every pack
# and record both feeds name: the join pass the launcher writes for the game
# server (Data\Platform\thornswood-pass.txt, #937) was in dev packs
# 20260928-2131-dev and 20260929-122410-dev and in four dev records, because it
# arrived after the list did; Data\MCM\Settings\Precision.ini,
# TrueDirectionalMovement.ini and TrueHUD.ini (the values a person saved in
# those mods' menus, two of them another server's) were in all five dev
# records, so a launcher that syncs to the record fetched them; and so were
# CommunityShaders\SettingsUser.json, two window layout files, the spot
# marker's output and a hang report. So it is asked by KIND now, and a new
# file of one of these kinds is caught the day it appears:
#
#   - Written at runtime into a folder of its own (Test-ShipRuntime above):
#     Claude outputs, _to_delete, RaceMenu's face exports and face tints,
#     .sentry-native.
#   - The named files in $ShipMachineFiles above: SkyrimPlatform.ini, the
#     launcher's Thornswood.ini, the display, crash and animation settings the
#     launcher or the mod writes back.
#   - Anything straight in Data\Platform. That is where the launcher and the
#     plugins talk to each other while the game runs: the session note, the
#     join pass, the voice port, status and token, the character list and the
#     pick, the load order the game saw, the spots file, the plugins' logs.
#     Every file the build ships under Data\Platform is in a folder (Plugins,
#     UI, Modules, Distribution, Fonts; Images held two pictures until
#     #2177); nothing ships straight in it.
#   - The SkyMP client's saved sign in, Data\Platform\PluginsNoLoad.
#   - Logs and crash dumps (*.log, *.dmp), anywhere.
#   - Backups (Test-ShipBackup, *.bak) and Vortex's own records: its
#     deployment manifests, the *.vortex_backup files it moved aside and the
#     __folder_managed_by_vortex markers. They describe THIS Skyrim, and
#     handing them to somebody else's Vortex is how it loses track of its own
#     deployment; pack-20260916-1217 carried a 6 MB vortex.deployment.json.
#   - Window layouts Dear ImGui writes on exit, imgui.ini and <mod>_ImGui.ini:
#     where each window sat on that screen.
#   - What a person saved from a mod's own menu: Data\MCM\Settings (MCM Helper
#     writes a mod's ini there the first time somebody changes a value; the
#     mod's own defaults are in Data\MCM\Config and ship), and Community
#     Shaders' SettingsUser.json and SettingsTest.json (its defaults,
#     SettingsDefault.json, are the same on every install and stay).
#     CHECKED 29 September that none of the ones the site carried is a setting
#     Thornswood chose. Nothing in the repository writes, holds or names them
#     (no file under game\, no script, no launcher Enforce rule, no decision on
#     an issue). Precision.ini and TrueDirectionalMovement.ini open with "Daedric
#     Online, enforced ..." and were written into the Steam copy on 14 September
#     at 15:00 and 14:56, TrueHUD.ini at 14:43 in the same session, all before
#     Thornswood's first pack (15 September); they were never in a pack, and
#     reached people through the installer and the dev records. The launcher
#     takes what the dev records handed out back out of Thornswood's own
#     folder while it is still those bytes (Leaks.cs, #1252). Community
#     Shaders' SettingsUser.json was written on 19 September at the end of its
#     first time setup on one machine (FirstTimeSetupCompleted, one effect off
#     at boot, beside a window layout for a 2560x1440 screen), rode in one dev
#     pack (20260928-1733-dev), and Community Shaders is in neither the
#     repository nor the shipping machine's game today. A setting Thornswood
#     wants everybody to have is Thornswood's own file (the Thornswood Content
#     mod, or a launcher Enforce rule), never one machine's saved menu file.
#   - What a mod saves from the game itself: Engine Fixes' EngineFixes_SNCT.ini,
#     the sound volumes, which its archive ships empty.
#   - Saves and profiles: a Saves folder, *.ess and *.skse, and a Profile or
#     My Games folder at the top of the game folder.
#   - ShaderCache, anywhere: rebuilt by the game on first launch for that GPU.
#
# NOT one machine's, and never caught here: the six client files in
# client-build.json (ours by recorded bytes), SkyHUD's skyhud.txt (its own
# config), SkyUI's config.shipped.txt (the launcher's copy of the settings the
# build ships), and TrueHUD\RP_Bosses.ini, which is another server's file
# ("Daedric Online boss health bars", written with the two above) and so a
# question of whose it is, not of which machine (#1253).
#
# Never packed, never in a record (as a file or as gone), and never on the site:
# Publish-Update's scan and the installer's leave them out through
# Test-ShipMachine, which asks this; Publish-Update's record guard and
# Rollback-Feed's filter refuse them; Check-Secrets fails a pack or a stage that
# carries one; Scrub-Feed.ps1 takes them out of what is already published.
#
# NEVER LISTED AS REMOVED, except the runtime folders, which Publish-Update lists
# as removed when a baseline once had them (see $ShipRuntimeDirs), and the
# paths on $ShipDeleteAlways below, which every pack deletes on purpose. A
# delete reaches every install, and every one of these is that person's own file
# on theirs: their key binds, their Vortex, their face.
$ShipOneMachineFiles = @(
    'Data\SKSE\Plugins\CommunityShaders\SettingsUser.json',
    'Data\SKSE\Plugins\CommunityShaders\SettingsTest.json',
    # Engine Fixes ships this empty and saves the game's sound volumes into it
    # ("saved SNCT volumes to ini", in its dll). One's held 434 bytes from
    # 5 October against the archive's 0 (#2969).
    'Data\SKSE\Plugins\EngineFixes_SNCT.ini'
)

function Test-ShipOneMachine([string]$rel) {
    if (-not $rel) { return $false }
    if ($ShipClientFiles.Contains($rel)) { return $false }
    if (Test-ShipRuntime $rel) { return $true }
    foreach ($f in $ShipMachineFiles) { if ($rel -ieq $f) { return $true } }
    foreach ($f in $ShipOneMachineFiles) { if ($rel -ieq $f) { return $true } }
    $parts = $rel -split '\\'
    $leaf = $parts[$parts.Count - 1]
    if ($parts.Count -eq 3 -and $parts[0] -ieq 'Data' -and $parts[1] -ieq 'Platform' -and $leaf) { return $true }
    if ($rel.StartsWith('Data\Platform\PluginsNoLoad\', 'OrdinalIgnoreCase')) { return $true }
    if ($leaf -match '\.(log|dmp)$') { return $true }
    if (Test-ShipBackup $rel) { return $true }
    if ($leaf -ieq 'vortex.deployment.json' -or $leaf -like 'vortex.deployment.*.json') { return $true }
    if ($leaf -ieq '__folder_managed_by_vortex') { return $true }
    if ($leaf -like '*.vortex_backup') { return $true }
    if ($leaf -ieq 'imgui.ini' -or $leaf -like '*_ImGui.ini') { return $true }
    if ($rel.StartsWith('Data\MCM\Settings\', 'OrdinalIgnoreCase')) { return $true }
    if ($leaf -match '\.(ess|skse)$') { return $true }
    if ($rel -match '(^|\\)(Saves|ShaderCache)\\') { return $true }
    if ($rel -match '^(Profile|My Games)\\') { return $true }
    return $false
}

# One machine's own, never shipped and never listed as removed. Other servers'
# files count as the machine's here, so a release never strips another
# server's install off a tester.
function Test-ShipMachine([string]$rel) {
    if (Test-ShipOtherServer $rel) { return $true }
    if (Test-ShipRetired $rel) { return $true }
    if (Test-ShipBodyShape $rel) { return $true }
    if (Test-ShipBethesdaTool $rel) { return $true }
    if (Test-ShipBackup $rel) { return $true }
    # So do Bethesda's files and other people's frameworks and tools, for the
    # same reason. See the note over $ShipVanillaDataFiles for the 90 files
    # that needed it on 24 September, and the one over $ShipBethesdaLeftAlone
    # for MarketplaceTextures.bsa.
    if (Test-ShipVanilla $rel) { return $true }
    if (Test-ShipForeignFramework $rel) { return $true }
    if (Test-ShipBethesdaLeftAlone $rel) { return $true }
    # Made on each machine from its own game (#2827) and its own copy of the
    # collection's mods (#3113).
    if (Test-ShipMadeFromGame $rel) { return $true }
    if (Test-ShipMadeFromMods $rel) { return $true }
    # Made on each machine from the recipe the release carries (#2791).
    if (Test-ShipMadeFromRecipe $rel) { return $true }
    # Built on each computer from the collection's Pandora and BodySlide (#3715).
    if (Test-ShipGenerated $rel) { return $true }
    # One machine's own by kind (#1239), the named files and Vortex's records
    # among them. The runtime folders are the one kind left to Test-ShipRuntime,
    # which lists them as removed when a baseline once had them.
    if ((Test-ShipOneMachine $rel) -and -not (Test-ShipRuntime $rel)) { return $true }
    return $false
}

# Thornswood's own game folder (Root\Game, made by the launcher out of what
# Vortex deployed into the Steam copy, OwnGame.cs). Most of it is the
# collection, linked in, and it carries no Vortex record of its own, because
# those describe the Steam copy and are left there. The launcher's record,
# Profile\OwnGame\files.txt, has one line per file brought in:
# kind|origin|size|ticks|path, with origin V for what Vortex deployed. Those
# are the collection's files and stay out of packs and installers, the same way
# the Vortex record keeps them out when the game is the Steam copy. What the
# launcher builds there on each computer (#3715) never ships either, whichever
# record names it (Test-ShipGenerated).
#
# Returns the set of paths, or $null when this build has no such record (the
# game is the Steam copy, or Root\Game came from an installer before 1.1).
function Get-ShipOwnGameCollection([string]$ProfileDir) {
    $record = Join-Path $ProfileDir 'OwnGame\files.txt'
    if (-not (Test-Path -LiteralPath $record)) { return $null }
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in [IO.File]::ReadLines($record)) {
        $p = $line.Split([char[]]'|', 5)
        if ($p.Count -eq 5 -and $p[1] -eq 'V') { [void]$set.Add($p[4]) }
    }
    return ,$set
}

# THE MAIN MENU BACKDROP IS OURS. On 24 September Profile\OwnGame\files.txt
# held 563 files and 539 MB under Data\textures and Data\meshes that Vortex
# never deployed, and the old installer carried every one; Get-ShipLooseArt
# named them a folder at a time for its build until it went (#4824). Since
# #1178 Test-ShipNotOurs below keeps such files out of packs and records,
# and the behavior files and bodies the launcher builds on each computer
# never ship (#3715, Test-ShipGenerated).
#
# Ours is the main menu backdrop: the three files Go.ps1 writes from
# game\menu ($menuPairs there; change the two together).
$ShipOwnArt = @(
    'Data\meshes\interface\logo\logo.nif',
    'Data\meshes\interface\logo\logo01ae.nif',
    'Data\textures\interface\objects\Mainmenuwallpaper.dds'
)

# ---------------------------------------------------------------------------
# OTHER PEOPLE'S LOOSE FILES NEVER SHIP. Issue #1178.
#
# Outside Data\Platform a file of the game folder is ours only when this list
# names it. Everything else that Vortex did not deploy is somebody else's mod
# file, and handing it out is not ours to do: never packed, never in the
# installer, never in a release record, and never listed as removed.
# Data\Platform is Test-ShipOtherServer's, which already names what is ours
# there; the collection's files are left out by Get-ShipOwnGameCollection.
#
# MEASURED 29 September over the installer's payload (C:\Thornswood\Game), the
# dev build's (C:\Thornswood-DevBuild\Game), the dev record 20260929-140118-dev
# and the last main record (20260928-1630): 424 loose files of other people's
# mods outside Data\Platform, 124.7 MB (the installer 409 of them, 116.9 MB).
# 181 (75.1 MB) leave now, 103 (8.4 MB) wait for revision 2 and 140 (41.2 MB)
# BodySlide builds ship as ours for now until #1259 (both below). All
# were in Profile\OwnGame\files.txt with origin O (taken from the Steam copy,
# never deployed by Vortex), most put there by the old installer
# (Profile\installed-into-game.txt), so the old rules called them ours. Each
# was matched by path and sha256 against every
# mod in this machine's Vortex staging, loose and inside its archives, and
# against the game's own archives. What they were, by group
# (docs\COLLECTION-REVISION-2.md has the table):
#   - RaceMenu's interface and translations (21 files), byte for byte the
#     files inside the collection's RaceMenu.bsa; 30 of the travel clothes, the
#     Skyrim Sewers countess and an Elysium Estate texture, the same inside
#     their mods' archives. The collection installs all of them.
#   - 26 of Bethesda's own files, byte for byte the ones in the game's archives
#     (draugr, vampire lord, werewolf and Soul Cairn meshes, notes, a Creation
#     Club script), and the Creation Kit's face tint export for
#     FishingInSkyrim.esp.
#   - BodySlide output built on some other machine, for a body and preset
#     nothing records: Immersive Armours' Bosmer armour, the travel clothes
#     (Common Clothes and Armors 3BA), More Craftable Equipment's executioner,
#     Capital Windhelm's and Crossed Daggers' outfits. What BodySlide builds
#     from the collection is built on each computer now, never shipped (below).
#     The first three ship as ours for now, until Thornswood builds them
#     itself (#1259, $ShipBuiltUntil1259); the refits of the last two leave.
#   - Files of Nexus mods the collection does not have yet: male face and
#     beard morphs, fitted vanilla hoods and robes, children's clothes, a mesh
#     fix. Held below until revision 2 carries them.
#   - Leftovers of mods nothing loads: Mage Clothing Expansion, Common
#     Clothing Expansion, Armory of the Dragon Cult, Armors of the Velothi,
#     NordwarUA's armour, Capital Whiterun's outfits, IED's script without IED,
#     Unofficial Patch and interior mods' scripts without their plugins, old
#     MCM Helper scripts that override the collection's newer ones, and
#     retextures with no mod found.
#   - Another server's files: the other server's haybale mesh (a weapon mesh
#     in a folder named with its prefix), Daedric Online's
#     TrueHUD boss list (RP_Bosses.ini, "Daedric Online boss health bars" by
#     its first line; Patrick, 29 September, #1253: it goes).
#   - Settings a mod or the launcher writes on each machine: ImGui window state,
#     Community Shaders' settings, SkyUI's config copy the launcher keeps.
#
# WHY A LIST OF OURS AND NOT A LIST OF THEIRS. Every rule above that names
# another author's file was written after that file had shipped. A list of
# theirs is one incident behind for ever; a list of ours is right the day it
# is written, and a new file of ours is one line here in the pull request that
# adds it (tests\test-not-ours.ps1 holds the list to the files that ship).
#
# NEVER LISTED AS REMOVED, ON PURPOSE (Test-ShipMachine asks this). A pack's
# delete.txt reaches every launcher, and on an install with no game folder of
# its own it deletes from the Steam copy, where the same path may be the
# person's own Vortex deployment. Installs that already took one of these keep
# it until Patrick decides otherwise; published packs are scrubbed apart
# (Scrub-Feed.ps1).
# The plugins this repo builds and ships itself (#2486).
. (Join-Path $PSScriptRoot 'RepoPlugins.ps1')
$ShipOursFiles = @(
    # Our completed plugins ship on both channels beyond the collection base:
    # the content plugin, and the late-loading one (#2468) as its recipe
    # (#2791), which the launcher makes the plugin from ($ShipMadeFromRecipe).
    # These two lines are $ThornswoodRepoPlugins (RepoPlugins.ps1) as Data\
    # paths, the second as the recipe in the plugin's place.
    'Data\Thornswood-Content.esp',
    'Data\Thornswood-Last.recipe',
    # The SkyMP client's compiled script, from the engine fork.
    'Data\Scripts\MpClientPlugin.pex',
    # An empty loading spinner (Checks.cs, since 16 September) and the menu
    # music's silent stand in for the game's theme. Go.ps1 writes these two,
    # skyhud.txt and QuickLootIE.json below from game\ours ($oursMenuFiles
    # there; change the two together).
    # The main menu itself, with no Bethesda logo, is made on each machine
    # from the game's own since #2827 ($ShipMadeFromGame).
    'Data\Interface\loadwaitspinner.swf',
    'Data\music\special\mus_maintheme.xwm',
    # SkyHUD's settings as Thornswood set them (16 September, after the first
    # pack; no other server's header). The MCM Helper menu files beside it
    # were Daedric Online's by their own first lines and are one machine's
    # (#1239); TrueHUD\RP_Bosses.ini is Daedric Online's boss list (#1253), so
    # neither is named here.
    'Data\Interface\skyhud\skyhud.txt',
    # QuickLoot IE's settings file with its loot menu's columns weight only,
    # no gold value (#3113). QuickLoot IE is GPL-3.0-or-later (#3800), so its
    # file may go out changed, saying so.
    'Data\SKSE\Plugins\QuickLootIE.json',
    # The crafting menu's groups (#3133): Crafting Categories reads every
    # config named after a plugin in the load order, in load order, so this
    # one, named for our content plugin, comes after the collection's own and
    # moves weapons, armour and arrows each under a header of its own, with
    # material groups inside. The English names of those groups beside it.
    # Both are Thornswood's own; Go.ps1 writes them too ($oursMenuFiles).
    'Data\SKSE\Plugins\CraftingCategories\Thornswood-Content.json',
    'Data\Interface\Translations\Thornswood-Content_ENGLISH.txt',
    # The sprite font the overhead voice mark draws its dot in, made from the
    # OFL Barlow SemiBold by scripts\mods\Build-SpriteFont.py, and the OFL
    # beside it, which a copy has to carry (#1317). Under Data\Platform these
    # are ours anyway; they are named here because Go.ps1 writes them from
    # game\ours with the others.
    'Data\Platform\Fonts\Barlow-SemiBold.spritefont',
    'Data\Platform\Fonts\Barlow-SemiBold-OFL.txt'
)

# BUILT ON EACH COMPUTER, NEVER SHIPPED (#3715).
#
# The behavior files Pandora Behaviour Engine+ makes and the bodies BodySlide
# builds (records\generated.json says which). They are the game's own graphs
# with Precision's and True Directional Movement's patches merged in, and
# CBBE 3BA's, CBBE's and HIMBO's bodies: other people's work, which
# THIRD-PARTY.md says whose each is. Until 27 Oct 2026 every release carried
# what the shipping machine had built (#1247). Patrick chose that day (#3715,
# option A) that the launcher builds them on each computer, in Thornswood's
# own folder, from the collection's own Pandora, BodySlide and mods
# (launcher\app\GeneratedHere.cs), before Play and from Fix. So no pack, record
# or installer carries one (Test-ShipMachine), and none is listed as removed:
# an install that took them from an earlier release keeps them until the
# launcher's build replaces them, and a delete.txt line would only take them
# away until the next Play built them again.
#
# Measured 29 September in Data\Nemesis_Engine\cache\mod settings: the patches
# chosen are Precision (Nexus 72347) and True Directional Movement's 360 Horse
# Archery, Procedural Leaning and Headtracking (Nexus 51614), all three mods in
# the collection. The build writes exactly the behaviour graphs, the two
# animation data files, the two character files and FNIS.pex below, and the
# six bodies. A file at one of these paths that Vortex deploys is the
# collection's, and never ships either.
$ShipGeneratedBodyFiles = @(
    # The bodies the build list's slider sets write.
    'Data\meshes\actors\character\character assets\femalebody_0.nif',
    'Data\meshes\actors\character\character assets\femalebody_1.nif',
    'Data\meshes\actors\character\character assets\femalebodyastrid_0.nif',
    'Data\meshes\actors\character\character assets\femalebodyastrid_1.nif',
    'Data\meshes\actors\character\character assets\malebody_0.nif',
    'Data\meshes\actors\character\character assets\malebody_1.nif'
)
# THE OUTFITS FITTED TO THOSE BODIES (#2454), built the same way, on each
# computer, from the collection's BodySlide projects named in
# records\generated.json (bodyslide.outfits), at their own slider defaults and
# with no RaceMenu morphs (#1004). Exact paths, the OutputPath and OutputFile
# (_0 and _1) of each set. None yet: the travel clothes and the executioner
# come with the collection revision that deploys their projects (#2454). Never
# anything from Immersive Armors: Patrick, 17 Oct, it is used as-is through the
# collection and nothing built from it is redistributed (permission-held.txt).
$ShipGeneratedOutfitFiles = @()
$ShipGeneratedPatterns = $ShipGeneratedBodyFiles + $ShipGeneratedOutfitFiles + @(
    'Data\meshes\animationdatasinglefile.txt',
    'Data\meshes\animationsetdatasinglefile.txt',
    'Data\meshes\actors\*\behaviors\*.hkx',
    'Data\meshes\actors\*\characters\*.hkx',
    'Data\meshes\actors\*\characters female\*.hkx',
    'Data\Scripts\FNIS.pex'
)

# HELD UNTIL THE COLLECTION CARRIES THEM. A loose file whose mod is on Nexus
# and not yet in the collection still ships until the collection revision a
# release is built against reaches the one that adds the mod
# (docs\COLLECTION-REVISION-2.md, "Mods revision 2 adds"). Then it leaves by
# itself, the same release that tells every launcher on the older revision to
# update the collection. Path ends in \ for a folder.
#
# Traced 29 September by path against each mod's own file list on Nexus (the
# archives themselves were not downloaded, so these are matched by path, not by
# bytes). Revision 2 adds each mod (Claude Cowork's checklist says how, and
# stops if one brings a plugin, which would move the load order), and a person
# checks in game that nothing looks different.
#
# EVERY LINE NAMES ITS OWN WAY OUT, AND THERE IS NO DEFAULT (#2298). Either
# -Revision N, the collection revision that carries (or drops) its mod, or
# -WhileContentNamesIt, for a mesh no collection revision settles: it ships for
# exactly as long as game\content\Thornswood-Content.esp (the plugin every
# release places, Ensure-ShipRequiredData) names it as a model, so it leaves in
# the same release as the plugin stops needing it, and never before.
#
# Until 11 October this function gave every line Revision 2 whatever it was
# given, the message board's included, though that line's own comment said no
# revision carries it. Releases are built against revision 2 since 3 October
# (records\collection-plugins.json), so dev 1.2.3 listed the board mesh as gone
# and every board the plugin places lost its model while the plugin still named
# it. A line now refuses to be made without a way out, and the board's way out
# was the plugin itself. Since #2298 the plugin's board is Thornswood's own
# mesh, so the board's line held nothing, and it came out on 16 October (#400):
# the old mesh is somebody else's file like any other, which never ships. No
# line holds this way today; it stays for the next mesh the plugin names that
# no revision carries (tests\test-2298-held-board.ps1).
function New-ShipHeld {
    param(
        [Parameter(Mandatory = $true, Position = 0)][string]$Path,
        [Parameter(Mandatory = $true, Position = 1)][string]$Mod,
        [int]$Revision = 0,
        [switch]$WhileContentNamesIt
    )
    if (($Revision -gt 0) -eq [bool]$WhileContentNamesIt) {
        throw ('New-ShipHeld ' + $Path + ': name exactly one way out, -Revision N or -WhileContentNamesIt.')
    }
    $model = ''
    if ($WhileContentNamesIt) {
        if (-not $Path.StartsWith('Data\meshes\', 'OrdinalIgnoreCase') -or $Path.EndsWith('\')) {
            throw ('New-ShipHeld ' + $Path + ': -WhileContentNamesIt is for one mesh file under Data\meshes\.')
        }
        # A plugin's MODL is relative to meshes\.
        $model = $Path.Substring('Data\meshes\'.Length)
    }
    return [pscustomobject]@{ Path = $Path; Revision = $Revision; ContentModel = $model; Mod = $Mod }
}

# The plugin a release places. A test points this at a copy.
$ShipContentPlugin = Join-Path $PSScriptRoot '..\..\game\content\Thornswood-Content.esp'

# Every model (MODL) the plugin names, lower case with backslashes. Compressed
# records are inflated and read too, so a model inside one is not missed.
# Throws when the plugin is missing or does not read as records, because then
# whether the board ships would be a guess.
function Get-ShipContentModels([string]$Plugin = $ShipContentPlugin) {
    if (-not (Test-Path -LiteralPath $Plugin -PathType Leaf)) {
        throw ('The content plugin is not at ' + $Plugin + ', so what it names cannot be read.')
    }
    $b = [IO.File]::ReadAllBytes($Plugin)
    $found = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $ascii = [Text.Encoding]::ASCII
    $p = 24 + [BitConverter]::ToUInt32($b, 4)
    if ($b.Length -lt 24 -or $ascii.GetString($b, 0, 4) -ne 'TES4' -or $p -gt $b.Length) {
        throw ('The content plugin at ' + $Plugin + ' does not start with a TES4 header.')
    }
    while ($p + 24 -le $b.Length) {
        $tag = $ascii.GetString($b, $p, 4)
        $size = [BitConverter]::ToUInt32($b, $p + 4)
        # A group's size counts its own 24 bytes; step inside it.
        if ($tag -eq 'GRUP') { $p += 24; continue }
        if ($p + 24 + $size -gt $b.Length) { throw ('The content plugin at ' + $Plugin + ' ends inside a record.') }
        $flags = [BitConverter]::ToUInt32($b, $p + 8)
        $data = New-Object byte[] $size
        [Array]::Copy($b, $p + 24, $data, 0, $size)
        if (($flags -band 0x00040000) -ne 0) {
            # Four bytes of length, then a zlib stream: two header bytes, then deflate.
            $ms = [IO.MemoryStream]::new($data, 6, $size - 6)
            $ds = [IO.Compression.DeflateStream]::new($ms, [IO.Compression.CompressionMode]::Decompress)
            $out = [IO.MemoryStream]::new()
            $ds.CopyTo($out); $ds.Dispose()
            $data = $out.ToArray()
        }
        $i = 0
        while ($i + 6 -le $data.Length) {
            $st = $ascii.GetString($data, $i, 4)
            $sn = [BitConverter]::ToUInt16($data, $i + 4)
            if ($st -eq 'MODL' -and $i + 6 + $sn -le $data.Length) {
                $found.Add($ascii.GetString($data, $i + 6, $sn).TrimEnd([char]0).Replace('/', '\')) | Out-Null
            }
            $i += 6 + $sn
        }
        $p += 24 + $size
    }
    return , $found
}

# True when the content plugin names this model (relative to meshes\).
function Test-ShipContentNames([string]$Model, [string]$Plugin = $ShipContentPlugin) {
    return (Get-ShipContentModels $Plugin).Contains($Model.Replace('/', '\'))
}
$ShipHeldForCollection = @(
    # Male faces' expressions and beards: Expressive Facial Animation - Male
    # Edition (Nexus 19532), 1.21. Expressive Facegen Morphs, in the
    # collection, carries only the chargen and race morphs beside these.
    (New-ShipHeld 'Data\meshes\actors\character\character assets\MaleHead.tri' 'Expressive Facial Animation - Male Edition (19532)' -Revision 2),
    (New-ShipHeld 'Data\meshes\actors\character\character assets\EyesMale.tri' 'Expressive Facial Animation - Male Edition (19532)' -Revision 2),
    (New-ShipHeld 'Data\meshes\actors\character\character assets\faceparts\' 'Expressive Facial Animation - Male Edition (19532)' -Revision 2),
    (New-ShipHeld 'Data\meshes\actors\character\character assets\mouth\' 'Expressive Facial Animation - Male Edition (19532)' -Revision 2),
    (New-ShipHeld 'Data\meshes\actors\character\character assets\beards\' 'Expressive Facial Animation - Male Edition (19532)' -Revision 2),
    # Vanilla women's hoods and the Creation Club fishing and apprentice robes
    # fitted to the body: CBBE 3BA Vanilla Outfits Redone (Nexus 109194), its
    # prebuilt meshes files.
    (New-ShipHeld 'Data\meshes\clothes\robemythicdawn\' 'CBBE 3BA Vanilla Outfits Redone (109194)' -Revision 2),
    (New-ShipHeld 'Data\meshes\clothes\thalmor\' 'CBBE 3BA Vanilla Outfits Redone (109194)' -Revision 2),
    (New-ShipHeld 'Data\meshes\creationclub\bgssse001\clothes\' 'CBBE 3BA Vanilla Outfits Redone (109194)' -Revision 2),
    # Children's clothes: Styles of Skyrim Mashups - Children Clothes
    # Variations and Mesh Fixes (Nexus 154063), Vanilla Mesh Fixes Standalone.
    (New-ShipHeld 'Data\meshes\clothes\childrenclothes\' 'Styles of Skyrim Mashups - Children Clothes Variations and Mesh Fixes (154063)' -Revision 2),
    (New-ShipHeld 'Data\meshes\_byoh\clothes\childrenclothesvariants\' 'Styles of Skyrim Mashups - Children Clothes Variations and Mesh Fixes (154063)' -Revision 2),
    # A noble end table's mesh fix: Assorted Mesh Fixes (Nexus 32117).
    (New-ShipHeld 'Data\meshes\furniture\noble\nobleendtable04.nif' 'Assorted Mesh Fixes (32117)' -Revision 2)
    # The message board Thornswood-Content.esp used to place, a reworked copy
    # of the board in Missives - Unique Missive Boards (Nexus 111375) that came
    # with the other server's records, in a folder named with that server's
    # prefix (#1258), was held here while the plugin named it. Since #2298 the
    # board names Thornswood's own meshes\thornswood\noticeboard01.nif, so its
    # line held nothing, and it came out on 16 October (#400, decision C: the
    # other server's short forms are named nowhere). The old mesh is now
    # somebody else's file like any other, kept out of every pack because it
    # is not on the list of ours.
)

# The collection revision this release is built against: what the feed's
# collectionRevision says. Publish-Update sets it
# (Get-ShipCollectionRevision); 0 when it is not known, and then everything held
# above still ships, so nothing leaves before the collection carries it.
$ShipCollectionRevision = 0

# The revision of the collection config.json names (or the one the launcher
# ships with), as this machine's Vortex has it installed. Needs LoadOrder.ps1,
# which the callers dot-source; 0 without it.
function Get-ShipCollectionRevision([string]$Root) {
    if (-not (Get-Command Get-CollectionRevision -ErrorAction SilentlyContinue)) { return 0 }
    return [int](Get-CollectionRevision (Get-CollectionSlug (Get-ShipCollectionUrl $Root)))
}

# The collection config.json under $Root names, or the launcher's own when it
# names none. Throws when config.json is there and does not read.
function Get-ShipCollectionUrl([string]$Root) {
    # No config.json, or one naming no collection, is the launcher's own
    # collection. One that is there and does not read stops whatever asked,
    # before anything is packed (Patrick, 19 Oct, #2711 decision 2 B): the
    # revision decides which held files ship, and the launcher's own
    # collection's may not be the one it meant to name. Until then it fell
    # back to it, with an empty catch.
    $url = ''
    $cfg = Join-Path $Root 'config.json'
    if (Test-Path -LiteralPath $cfg) {
        $cfgDoc = $null
        try { $cfgDoc = Get-Content -LiteralPath $cfg -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop }
        catch { throw ("$cfg does not read (" + ($_.Exception.Message -replace '\s+', ' ') + "), so the collection revision it names is not known, and nothing held for a later revision may ship. Fix config.json and run it again.") }
        if ($cfgDoc -and $cfgDoc.PSObject.Properties['CollectionUrl']) { $url = [string]$cfgDoc.CollectionUrl }
    }
    if (-not $url) { $url = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf' }
    return $url
}

# The revision a release names is the recorded one, and the source it is built
# from has to be on it (#3597). Vortex's number above says what this machine
# has; it is never written to a feed in place of the record's.
. (Join-Path $PSScriptRoot 'CollectionRevision.ps1')

# Plugins game\required-data puts in Data\ before a scan (Ensure-ShipRequiredData).
# Worked out in a child scope: this file is dot-sourced into its callers, and
# a name set here would overwrite one of theirs.
# No folder (a copy of this file alone) lists none; a folder that cannot be
# listed stops whatever loaded this, rather than shipping without the list
# (#2711; it was a try with an empty catch).
$ShipRequiredDataFiles = @(& {
    $dir = Join-Path $PSScriptRoot '..\..\game\required-data'
    if (Test-Path -LiteralPath $dir) {
        Get-ChildItem -LiteralPath $dir -File -ErrorAction Stop | Where-Object { $_.Name -ne 'README.md' } | ForEach-Object { 'Data\' + $_.Name }
    }
})

# OURS FOR NOW, UNTIL #1259: 122 outfit meshes built in BodySlide on some other
# machine (Common Clothes' travel clothes, More Craftable Equipment's
# executioner; the Bosmer armour's morphs left in #2454, and nothing is built from it). Patrick, 29 September: Thornswood
# builds the outfits itself from the collection's BodySlide projects, and until
# that build replaces these they keep shipping so nothing looks broken. Exact
# paths, in built-until-1259.txt beside this file; the build that closes #1259
# names its own output here and deletes that file in the same pull request.
# Scrub-Feed leaves them on the site, since they are ours while listed.
# In a child scope, for the reason given over $ShipRequiredDataFiles.
$ShipBuiltUntil1259 = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
# No list (a copy of this file alone) holds none; one that is there and cannot
# be read stops whatever loaded this (#2711; it was a try with an empty catch).
foreach ($ShipBuiltLine in @(& {
    $list = Join-Path $PSScriptRoot 'built-until-1259.txt'
    if (Test-Path -LiteralPath $list) {
        foreach ($line in [IO.File]::ReadAllLines($list)) {
            $one = $line.Trim()
            if ($one -and -not $one.StartsWith('#')) { $one }
        }
    }
})) { [void]$ShipBuiltUntil1259.Add($ShipBuiltLine) }

# NEVER HANDED ON (#2454). A file used only as the collection installs it
# never ships, whichever list above calls it ours: permission-held.txt beside
# this file. Patrick, 17 Oct: Immersive Armors is used as-is through the
# collection and nothing built from it is redistributed, so its Bosmer armour
# folder is held. One hold a line: a path under the game folder (a folder ends
# in \), two or more spaces or a tab, then a reason naming its issue. A line
# with no reason, or no issue, stops the script. The repo's own list is kept by
# tests\test-ship-permission-held.ps1 in the gate, which fails without it; a
# copy of this file alone (as test fixtures make) has no list and no holds,
# like the lists above. Read-ShipPermissionHeld refuses a missing list. A release
# that drops a held file an earlier one shipped lists it as gone with its
# sha256 (Publish-Update, #1261), so installs lose our copy and keep any other.
function Read-ShipPermissionHeld([string]$List) {
    if (-not (Test-Path -LiteralPath $List -PathType Leaf)) { throw "The permission hold list is missing: $List. A hold is released by taking its line out; keep the file." }
    $out = @()
    foreach ($line in [IO.File]::ReadAllLines($List)) {
        $one = $line.Trim()
        if (-not $one -or $one.StartsWith('#')) { continue }
        $parts = ([regex]'\t+| {2,}').Split($one, 2)
        if ($parts.Count -lt 2 -or -not $parts[1].Trim()) { throw "A permission hold gives no reason: $one" }
        if ($parts[1] -notmatch '#\d+') { throw "A permission hold names no issue: $one" }
        $out += [pscustomobject]@{ Path = $parts[0].Trim().Replace('/', '\'); Reason = $parts[1].Trim() }
    }
    return $out
}
$ShipPermissionHeldList = Join-Path $PSScriptRoot 'permission-held.txt'
$ShipPermissionHeld = @(if (Test-Path -LiteralPath $ShipPermissionHeldList -PathType Leaf) { Read-ShipPermissionHeld $ShipPermissionHeldList })

# Whether a path is held until its maker's permission is recorded. Either slash.
function Test-ShipPermissionHeld([string]$rel) {
    $rel = $rel.Replace('/', '\')
    foreach ($h in $ShipPermissionHeld) {
        $p = [string]$h.Path
        if ($p.EndsWith('\')) { if ($rel.StartsWith($p, 'OrdinalIgnoreCase')) { return $true } }
        elseif ($rel -ieq $p) { return $true }
    }
    return $false
}

function Test-ShipGenerated([string]$rel) {
    foreach ($p in $ShipGeneratedPatterns) { if ($rel -like $p) { return $true } }
    return $false
}

# Whether a loose file waits for the collection, at this revision. Either slash:
# the held list is written with backslashes, and a path with forward ones (a zip
# entry, a git path) used to read as not held, so it would not ship at all.
#
# A line held while the content plugin names it (-WhileContentNamesIt) is asked
# of the plugin, whatever the revision; the plugin is read only for a path that
# matches such a line, so a scan of the game folder reads it once per hit.
function Test-ShipHeld([string]$rel, [int]$Revision = $ShipCollectionRevision) {
    $rel = $rel.Replace('/', '\')
    foreach ($h in $ShipHeldForCollection) {
        $p = [string]$h.Path
        $hit = if ($p.EndsWith('\')) { $rel.StartsWith($p, 'OrdinalIgnoreCase') } else { $rel -ieq $p }
        if (-not $hit) { continue }
        if ([string]$h.ContentModel) {
            if (Test-ShipContentNames ([string]$h.ContentModel)) { return $true }
            continue
        }
        if ($Revision -lt [int]$h.Revision) { return $true }
    }
    return $false
}

# Ours outside Data\Platform: the list, the client runtime's recorded paths
# (Test-ShipOtherServer asks their bytes), required data and the menu backdrop.
# Inside Data\Platform this answers yes; that folder is
# Test-ShipOtherServer's to decide.
function Test-ShipOurs([string]$rel) {
    # Never handed on (permission-held.txt, #2454): not ours to ship.
    if (Test-ShipPermissionHeld $rel) { return $false }
    if ($rel.StartsWith('Data\Platform\', 'OrdinalIgnoreCase')) { return $true }
    if ($ShipClientFiles.Contains($rel)) { return $true }
    foreach ($o in $ShipOursFiles) { if ($rel -ieq $o) { return $true } }
    foreach ($o in $ShipOwnArt) { if ($rel -ieq $o) { return $true } }
    foreach ($o in $ShipRequiredDataFiles) { if ($rel -ieq $o) { return $true } }
    if ($ShipBuiltUntil1259.Contains($rel)) { return $true }
    return $false
}

# Somebody else's loose file, which never ships: not ours, and not held for the
# collection at this revision.
function Test-ShipNotOurs([string]$rel, [int]$Revision = $ShipCollectionRevision) {
    # Never handed on (permission-held.txt, #2454), at every revision.
    if (Test-ShipPermissionHeld $rel) { return $true }
    if (Test-ShipOurs $rel) { return $false }
    return (-not (Test-ShipHeld $rel $Revision))
}

# OTHER AUTHORS' FILES OUR OLD PACKS SHIPPED, BY THEIR BYTES (#1178). The packs
# carried them as ours until the scrub of 29 September, which took them out of
# the packs and the records. #1261 (2 October) makes a release list such a file
# as gone at the sha256 we shipped, but only when the release before it named
# the file, and after the scrub none did. So every install the old packs reached
# kept them: 166 files, 67.6 MB, on the main install on 12 October, among them
# old MCM Helper scripts over the collection's newer ones and the other server's
# haybale. records\shipped-not-ours.json names 165 of them with those bytes,
# and Publish-Update puts every one in the record as gone. The haybale's path
# would name the other server, which no tracked file may (#400), so the
# launcher's Leaks.cs takes that one out by its shape and bytes. The launcher
# deletes one only while it still has those bytes and Vortex does not deploy
# the path, so a copy somebody installed themselves is never touched.
#
# Returns path -> lowercase sha256. Stops, naming them, on a record that does
# not read, or on a path Ship-Rules does not call another author's: a delete
# must never reach Bethesda's files, one machine's own, or a backup.
$ShipShippedNotOursRecord = Join-Path $PSScriptRoot '..\..\records\shipped-not-ours.json'
function Get-ShipShippedNotOurs {
    $doc = Read-ThornswoodRecord -Path $ShipShippedNotOursRecord -Kind shipped-not-ours
    $map = [ordered]@{}
    $wrong = @()
    foreach ($p in @($doc.files.PSObject.Properties)) {
        $rel = $p.Name
        if (-not (Test-ShipNotOurs $rel) -or (Test-ShipBethesda $rel) -or (Test-ShipOneMachine $rel) -or (Test-ShipBackup $rel)) { $wrong += $rel; continue }
        $map[$rel] = ([string]$p.Value.sha256).ToLowerInvariant()
    }
    if ($wrong.Count) {
        throw ("records\shipped-not-ours.json names {0} file(s) Ship-Rules does not call another author's loose file, so no release may delete them by it: {1}" -f
               $wrong.Count, (($wrong | Select-Object -First 5) -join ', '))
    }
    return $map
}

# Where this build's reference plugins.txt and loadorder.txt are read from.
#   no Root\Game         the Steam copy: Vortex writes them into AppData
#   an own folder        Profile\OwnGame: the Vortex profile's lists as of the
#                        folder's last update, which is the collection's order
#   an older Root\Game   Profile\Default. AppData is only this build's while
#                        the game runs, so reading it with the game closed
#                        shipped the ordinary Skyrim's list.
function Get-ShipLoadOrderDir([string]$Root, [string]$ProfileDir) {
    $own = Join-Path $ProfileDir 'OwnGame'
    if (Test-Path -LiteralPath (Join-Path $own 'plugins.txt')) { return $own }
    # Named Thornswood Vortex profile over Windows' live list (#557).
    if (Get-Command Get-VortexProfileDir -ErrorAction SilentlyContinue) {
        $tw = Get-VortexProfileDir 'Thornswood'
        if ($tw -and (Test-Path -LiteralPath (Join-Path $tw 'plugins.txt'))) { return $tw }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Root 'Game'))) {
        # Off Windows there is no LOCALAPPDATA, and Join-Path stopped on the
        # null before the Ship could say there was no list (#2989); the
        # platform's own folder answers instead, as in Where.ps1 (#2872).
        $local = $env:LOCALAPPDATA
        if (-not $local) { $local = [Environment]::GetFolderPath('LocalApplicationData') }
        return (Join-Path $local 'Skyrim Special Edition')
    }
    return (Join-Path $ProfileDir 'Default')
}

# ---------------------------------------------------------------------------
# FILES EVERY PACK DELETES, WHETHER THIS MACHINE HAS THEM OR NOT.
#
# Leaving a file out of a pack stops it reaching NEW machines. It does nothing
# at all for the ones that already have it, and those are the machines the
# problem is on.
#
# 22 September, map.swf. It was excluded from shipping by the rule above, the
# release went out, and the pack carried no delete.txt: every tester who
# already had the game kept the broken file and kept the SkyUI error box.
# Excluding it had only helped people who did not have the problem.
#
# WHY IT WAS NOT CAUGHT BY THE ORDINARY REMOVAL DIFF. A file that leaves the
# game folder is normally a removal, but removals are filtered through
# Test-FromCollection first, and the launcher's own record of what Vortex
# provides lists map.swf even though Vortex's deployment manifest does not. So
# it was read as a collection file and dropped from the removal list. That
# guard is RIGHT and stays: the first release after the move to the Steam copy
# carried 28,833 removals and had to be pulled out of version.json by hand.
#
# So this is the deliberate override, and it is a list of paths somebody has
# decided must not exist, not a diff. Deleting a file that is not there is a
# no-op in Updater.Install, so carrying these in every pack costs nothing and
# is what makes the fix reach the machines that need it.
#
# KEEP IT SHORT. Every entry here is deleted from everybody's game on every
# update, for ever. Nothing belongs here that the collection might one day
# legitimately provide.
$ShipDeleteAlways = @(
    # SkyUI refuses a map.swf it does not recognise and puts a full screen
    # ERROR CODE 5 over the loading screen. Vortex deploys no map.swf, SkyUI
    # ships its own inside SkyUI_SE.bsa, and A Quality World Map ships no
    # Interface file at all, so nothing in the collection wants a loose one.
    'Data\Interface\map.swf',

    # ONE PERSON'S VOICE JOIN TOKEN, WHICH NINE PUBLISHED PACKS CARRIED.
    #
    # MEASURED 23 SEPTEMBER, which is what entry 81 asked for and what nobody
    # had done. The token file first existed on 18 September (b2a9f9d) and the
    # packing rule that excludes it landed on 20 September (15c472a). Thirteen
    # packs were published inside that window. Nine of them carry
    # game/Data/Platform/voice-token.txt: 20260918-1615, 20260918-2340,
    # 20260919-1416, 20260919-1546, 20260919-1944, 20260919-2010,
    # 20260919-2044, 20260920-1103 and 20260920-1124. Counted by listing the
    # names inside each zip; no token was opened or printed, per that entry.
    #
    # WHAT IT IS AND IS NOT. The token is a signed join token that proves one
    # profile id to the voice service and lives sixty minutes, so every one of
    # these expired in September 2026 and opens nothing now. The fault was the
    # rule, not the damage.
    #
    # LEAVING IT OUT OF NEW PACKS DOES NOTHING FOR THE MACHINES THAT HAVE ONE,
    # which is the whole reason this list exists: map.swf taught that on 22
    # September. So the next release deletes it from every install that took
    # one of those nine. Harmless to a working machine, because the launcher
    # writes a fresh token at Play and the update is applied before that.
    #
    # THE PUBLISHED PACKS NO LONGER CARRY THEM (#1239). This note used to say
    # the nine packs were left alone because rewriting one changes its sha256.
    # That stopped being a reason once Scrub-Feed.ps1 rewrote a pack and its
    # feed entry together: a launcher matches packs by id in applied.txt and
    # never fetches one it applied again, and one replaying every pack reads
    # the new sha256 from the same feed. Scrub-Feed takes every file
    # Test-ShipOneMachine names out of the packs and records on the site, the
    # tokens with them, and keeps this line in every delete list.
    'Data\Platform\voice-token.txt',

    # THE RETIRED DRESSER, To Do List entry 127. It put the best armour it
    # could find into every empty slot, which is Patrick's "it is auto
    # equipping things sometimes, like a hat", and it is deleted from the repo.
    #
    # Test-ShipOtherServer above calls it not ours, which keeps it out of
    # packs and the installer and, on its own, out of the removal diff as well.
    # So it goes here, the way map.swf did, and every pack deletes it whether
    # or not this machine's baseline still carries it.
    #
    # The launcher's own folder is why that is not enough by itself. A Steam
    # copy that took packs before its machine had a folder of its own still
    # has the old dresser (11,654 bytes, 16 Sep, on Patrick's machine), and a
    # refresh copies whatever the Steam copy has and the folder lacks straight
    # back in. OwnGame.Foreign refuses it, which is what makes the deletion
    # stick. The name is never used again, so nothing legitimate is lost.
    'Data\Platform\Plugins\thornswood-chargen.js',

    # ELYSIUM ESTATE'S OLD PLUGIN, issue #690. Packs carried it from
    # game\required-data from 27 September, while the servers loaded 4.3.5.
    # On 29 September the servers moved to the collection's 5.0.1, whose
    # plugin is ElysiumEstate.esp, so this name is nobody's any more: no mod in
    # the collection has it, and a copy left switched on would take a place
    # the server does not have. Every install that took one of those packs
    # loses it.
    'Data\ElysiumEstateSSE.esp'
)
# SkyUI 5.2's loose scripts, issue #960: dev packs carried them, so leaving
# them out of new packs would do nothing for the machines showing the SkyUI
# error box. The collection's SkyUI keeps its scripts inside SkyUI_SE.bsa, so
# nothing it installs is lost. See $ShipOldSkyUIScripts above.
$ShipDeleteAlways += $ShipOldSkyUIScripts
# The Daedric menu set and the unused fork svgs plus bg.png, issue #1318:
# leaving them out of new packs does nothing for the machines that already
# have them. Every pack deletes these names. Get-ShipDeleteAlways also adds
# a renamed copy whose bytes still match a Daedric sha256.
$ShipUiGonePaths = @($ShipDaedricMenu.Keys | ForEach-Object { 'Data\Platform\UI\' + $_ })
$ShipUiGonePaths += @($ShipUnusedFrontAssets | ForEach-Object { 'Data\Platform\UI\' + $_ })
$ShipDeleteAlways += $ShipUiGonePaths
# The five files under Data\Platform nothing uses, issue #2177: every pack
# deletes them, so the next release takes them off every install.
$ShipDeleteAlways += $ShipPlatformUnused
# The two commercial sprite fonts, issue #1317: every pack deletes them, so
# the next release takes them off every install.
$ShipDeleteAlways += $ShipCommercialFonts

function Get-ShipDeleteAlways {
    $list = New-Object 'System.Collections.Generic.List[string]'
    foreach ($p in $ShipDeleteAlways) { $list.Add($p) }
    $game = Get-Variable -Name GameDir -ValueOnly -ErrorAction SilentlyContinue
    if ($game) {
        $ui = Join-Path ([string]$game) 'Data\Platform\UI'
        if (Test-Path -LiteralPath $ui -PathType Container) {
            $have = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
            foreach ($p in $list) { [void]$have.Add($p) }
            foreach ($f in @(Get-ChildItem -LiteralPath $ui -File)) {
                $rel = 'Data\Platform\UI\' + $f.Name
                if ($have.Contains($rel)) { continue }
                $h = Get-ShipFileSha256 $f.FullName
                if ($h -and $ShipDaedricMenuHashes.Contains($h)) {
                    $list.Add($rel)
                    [void]$have.Add($rel)
                }
            }
        }
    }
    return @($list)
}

# FILES THAT TRAVEL WITH A PAGE, issue #883.
#
# A pack is a diff against the baseline, so a file the baseline already lists
# is never packed again, whether or not any launcher ever received it. The
# sealed scroll's two pictures were written into this machine's game folder on
# 25 September (17:54 UTC) and recorded by Main update 20260925-1654, which was
# pulled from version.json four minutes later. The baseline kept them. Not one
# of the 75 packs on the Main feed carries either picture (every zip listed,
# 28 September), so an install that has only ever taken packs has the page
# and not its art, and thornswood-select.js answers a missing picture with
# "a scroll picture is missing, straight to the slots". That is the start
# screen that skipped the scroll after the update, on the Main launcher.
#
# So when a pack carries the key, it carries these beside it, changed or not:
# 47 KB, only in a pack that already changes the page. The next pack with the
# page in it puts the pictures on every install that is missing them.
# tests\test-start-screen-art.ps1 holds this list to the pictures the page names.
$ShipTravelsWith = @{
    'Data\Platform\UI\thornswood-select.js' = @(
        'Data\Platform\UI\thornswood-scroll.webp',
        'Data\Platform\UI\thornswood-scroll-open.webp'
    )
}

# The companions of every changed path that are not already in the list.
function Get-ShipTravelsWith([string[]]$changed) {
    $out = @()
    foreach ($c in @($changed)) {
        foreach ($k in $ShipTravelsWith.Keys) {
            if ($c -ieq $k) {
                foreach ($w in $ShipTravelsWith[$k]) {
                    if (@($changed) -notcontains $w -and $out -notcontains $w) { $out += $w }
                }
            }
        }
    }
    return $out
}

# REQUIRED DATA THE COLLECTION DOES NOT YET DEPLOY UNDER THE LOAD ORDER NAME.
#
# game\required-data holds plugins that plugins.txt and the server enable by
# exact filename while Vortex deploys a different name. OwnGame links only what
# Vortex deployed, so such a file is on one machine only unless a pack carries
# it. It is empty today: ElysiumEstateSSE.esp was here from 27 to 29 September,
# until the servers moved to the collection's ElysiumEstate.esp (#690).
#
# Go.ps1 and Publish-Update call Ensure-ShipRequiredData so each file here
# lands at Data\<name> before the pack scan. They are
# not origin V in files.txt, so packs carry them. Take a file out of
# game\required-data when the collection deploys that same Data\ path.
function Get-ShipRequiredDataRoot([string]$RepoDir) {
    return (Join-Path $RepoDir 'game\required-data')
}

# Places every file under game\required-data (except README.md) at Data\<name>
# in $GameDir when that path is missing or the bytes differ. A file the game
# folder already holds, same bytes, is left where it is and is not returned:
# callers print this list, and an empty list must stay empty (#1119). Breaks
# an existing hard link before replacing different bytes, so a write never
# goes through into Vortex staging. Throws when the folder is missing, or
# when copy fails.
function Ensure-ShipRequiredData([string]$GameDir, [string]$RepoDir) {
    $srcRoot = Get-ShipRequiredDataRoot $RepoDir
    if (-not (Test-Path -LiteralPath $srcRoot)) {
        throw "game\required-data is missing under $RepoDir"
    }
    $placed = New-Object System.Collections.Generic.List[string]
    $sources = @(Get-ChildItem -LiteralPath $srcRoot -File -EA Stop)
    # Our own plugins (RepoPlugins.ps1): the content plugin and, since #2486,
    # the late-loading one, as its recipe since #2791 (the launcher makes the
    # plugin from it, $ShipMadeFromRecipe). A completed release can update
    # them beyond the published collection base without changing anybody's
    # staging copy. Packs and the installer place exactly this committed
    # source.
    $names = @{}
    foreach ($ownName in $ThornswoodRepoPlugins) {
        $own = Get-ThornswoodRepoPluginPath $RepoDir $ownName
        if (Test-Path -LiteralPath $own) { $sources += Get-Item -LiteralPath $own }
    }
    $recipe = Join-Path $RepoDir $ShipLastRecipe
    if (Test-Path -LiteralPath $recipe) { $r = Get-Item -LiteralPath $recipe; $sources += $r; $names[$r.FullName] = 'Thornswood-Last.recipe' }
    foreach ($f in $sources) {
        if ($f.Name -eq 'README.md') { continue }
        $rel = 'Data\' + $(if ($names.ContainsKey($f.FullName)) { $names[$f.FullName] } else { $f.Name })
        $dst = Join-Path $GameDir $rel
        $dir = Split-Path -Parent $dst
        if (-not (Test-Path -LiteralPath $dir)) {
            $null = New-Item -ItemType Directory -Force -Path $dir
        }
        if (Test-Path -LiteralPath $dst) {
            $same = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash -eq `
                    (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
            if ($same) { continue }
            # OwnGame.Unshare pattern: drop the name if it is a hard link so the
            # copy is this folder's own bytes, not Vortex's.
            try { Remove-Item -LiteralPath $dst -Force -EA Stop } catch {
                throw ("Could not replace $rel in the game folder (is the game open?): " + $_.Exception.Message)
            }
        }
        Copy-Item -LiteralPath $f.FullName -Destination $dst -Force -EA Stop
        $placed.Add($rel)
    }
    # No leading comma. `return ,$array` is one pipeline object, and both
    # callers wrap that in @(), so Count was always 1 and the log said
    # System.String[] whether or not a file was placed (#1119).
    return $placed.ToArray()
}

# ------------------------------------------------------------ launcher symbols
#
# Issue #462. The launcher's publish makes Thornswood.pdb beside the built exe.
# It carries absolute source paths from the build machine and method names. It
# NEVER leaves this machine inside a pack or a public release asset.
# Publish-Update.ps1 already skips any *.pdb under the game folder; this names
# the same rule for the launcher.
#
# Kept per version under Get-ShipSymbolDir so a customer's launcher.log IL
# offsets (Shell.cs fault handler) can be mapped to a line later. Shipping the
# pdb to customers as a second launcher asset needs a #dev decision first.

function Get-ShipSymbolDir([string]$Version) {
    $root = Join-Path (& (Join-Path $PSScriptRoot 'Where.ps1') MachineData) 'symbols'
    if ([string]::IsNullOrWhiteSpace($Version)) { return $root }
    return (Join-Path $root $Version)
}

# Copies every .pdb found in $FromDir into Get-ShipSymbolDir $Version.
# Returns the paths written. Missing pdbs are fine (older CI builds, or a
# main Ship that took the verified exe and never compiled here).
function Save-ShipSymbols([string]$FromDir, [string]$Version) {
    if ([string]::IsNullOrWhiteSpace($FromDir) -or -not (Test-Path -LiteralPath $FromDir)) {
        return ,@()
    }
    $dest = Get-ShipSymbolDir $Version
    if (-not (Test-Path -LiteralPath $dest)) {
        $null = New-Item -ItemType Directory -Force -Path $dest
    }
    $written = New-Object System.Collections.Generic.List[string]
    foreach ($pdb in @(Get-ChildItem -LiteralPath $FromDir -Filter '*.pdb' -File -EA SilentlyContinue)) {
        $to = Join-Path $dest $pdb.Name
        Copy-Item -LiteralPath $pdb.FullName -Destination $to -Force
        $written.Add($to)
    }
    return ,$written.ToArray()
}

# ---------------------------------------------------------------------------
# THE PLUGIN THAT LOADS LAST (#2468, #2486, #2791).
#
# Thornswood-Last.esp switches off every placed actor the NPC
# catalogue cuts and stops the vanilla quests, by copying the WINNING record
# of each actor's cell and world and of each quest, from the exact bytes of
# every plugin in the load order (scripts\mods\Build-LastPlugin.py,
# game\data\last-plugin.json "builtAgainst"). Against any other bytes it would
# undo whatever the newer plugin changes in those records. A new collection
# revision therefore means building it again; it never means shipping the old
# one. Patrick, 12 Oct, #2486: the release refuses a plugin built against
# other bytes than its own, rather than ship a broken one.
#
# It ships from the repository as its recipe (#2791), game\data\last-plugin.recipe,
# placed into the release's Data as Thornswood-Last.recipe and carried by the
# pack, and every machine makes the plugin from it ($ShipMadeFromRecipe). What
# is here makes it LOAD: the plugin list the pack carries enables it last
# (Add-ShipLastPluginLine), which the server's own order then confirms, because
# the deploys put it last there too (Deploy-DevGamemode.ps1 -LoadOrder,
# Deploy-Gamemode.ps1). Every check here applies only when the checkout holds
# the recipe.

$ShipLastPlugin = 'Thornswood-Last.esp'
$ShipLastManifest = 'game\data\last-plugin.json'
$ShipLastRecipe = 'game\data\last-plugin.recipe'
# The five the game loads before it reads any list (LoadOrder.ps1 skips them).
$ShipBaseMasters = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm')

function Test-ShipLastPluginHeld([string]$RepoDir) {
    return (Test-Path -LiteralPath (Join-Path $RepoDir $ShipLastRecipe) -PathType Leaf)
}

# A copy of a plugins.txt with *Thornswood-Last.esp as its last enabled line:
# any line naming it is taken out and one is put after the last line. -Plain
# is for loadorder.txt, whose lines carry no star. Written to $Out, never over
# $Src, with $Src's line endings. Returns $Out.
function Add-ShipLastPluginLine([string]$Src, [string]$Out, [switch]$Plain) {
    $text = [IO.File]::ReadAllText($Src)
    $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = @($text -split "`r?`n")
    if ($lines.Count -and $lines[-1] -eq '') { $lines = @($lines[0..($lines.Count - 2)]) }
    $kept = @($lines | Where-Object { $_.Trim().TrimStart('*').Trim() -ine $ShipLastPlugin })
    $kept += $(if ($Plain) { $ShipLastPlugin } else { '*' + $ShipLastPlugin })
    [IO.File]::WriteAllText($Out, (($kept -join $nl) + $nl), (New-Object Text.UTF8Encoding($false)))
    return $Out
}

# Why this release may not carry Thornswood-Last.esp, or '' when it may.
#   $RepoDir  the checkout
#   $Enabled  the enabled plugin names of the list the pack carries, in order
#   $Ccc      Skyrim.ccc's names that are in the release's Data folder
# Refused: no manifest, a recipe that does not make the plugin the manifest
# names or is not the recipe the manifest names, a load
# order (the five masters, the Skyrim.ccc plugins, then the enabled names,
# without this plugin) that is not the one it was built against, the plugin
# not enabled last, and any
# plugin it was built against whose size or sha256 is not the one the release
# gives people: records\collection-plugins.json for the collection's plugins
# (what Vortex installs and the deploys hold the servers to, #2019) and the
# checkout for the content plugin. The release's own game folder is not the
# measure: a plugin Vortex deploys is never in a pack, and on One on 15 Oct
# the dev release folder held a 3BBB.esp of 3,288 bytes from another
# installer choice while the collection's is 20,257.
# The Skyrim.ccc plugins are the game's to load straight after the five
# masters, and a plugin list never names them, so they come from $Ccc: the
# order the plugin is built against is the server's, which has them there
# (ServerOrder.ps1, Get-ThornswoodGameSequence). Until 15 Oct this left them
# out, and the first dev Ship carrying the plugin was refused on One for
# loading Water for ENB.esm where the server loads _ResourcePack.esl.
# A RELEASE FROM THE FEED SHIPS THE LAST RELEASE'S PLUGIN LIST (#2754), and
# has no game folder to put it into the server's order with, so it is held to
# the order the channel's server loads, read off the box (ServerContent.ps1):
# the base masters, then the Creation Club plugins the game loads on its own
# (on the box, in the server's order, and in no plugin list), then every
# plugin the list enables, in its order, and nothing else. Measured on dev,
# 20 Oct: 103 names, the five masters, _ResourcePack.esl and the 97 the list
# enables, in that order. Anything else means the load order moved, which is a
# collection Ship's to ship. Returns Problem, '' when it holds, and Ccc, the
# names between the masters and the list, for Get-ShipLastPluginProblem.
function Get-ShipFeedOrderProblem([string[]]$ServerOrder, [string[]]$Enabled) {
    $server = @($ServerOrder | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    $names = @($Enabled | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    $ccc = @($server | Where-Object { $ShipBaseMasters -notcontains $_ -and $names -notcontains $_ })
    $want = @($ShipBaseMasters) + $ccc + $names
    for ($i = 0; $i -lt [Math]::Max($server.Count, $want.Count); $i++) {
        $a = if ($i -lt $server.Count) { $server[$i] } else { '(nothing)' }
        $b = if ($i -lt $want.Count) { $want[$i] } else { '(nothing)' }
        if ($a -ine $b) {
            $off = @($names | Where-Object { $server -notcontains $_ })
            $why = if ($off.Count) { 'the plugin list enables ' + (($off | Select-Object -First 5) -join ', ') + ', which the server does not load' }
                   else { "at position $($i + 1) the server loads $a and the plugin list has $b" }
            return [pscustomobject]@{ Problem = "the server's load order is not the plugin list the last release shipped: $why. A load order change ships from One, as a collection Ship."; Ccc = $ccc }
        }
    }
    return [pscustomobject]@{ Problem = ''; Ccc = $ccc }
}

# THE PLUGIN LIST OF A RELEASE FROM THE FEED THAT MOVES THE REVISION (#4069,
# Get-ShipFeedMoveRevision says when one may). It is the servers' order,
# game\data\last-plugin.json's loadOrder with Thornswood-Last.esp on the end,
# written the way the last release's list is ($PrevPlugins, $PrevLoadOrder):
# plugins.txt enables every name of the order but the five base masters and
# the plugins the game loads on its own, which no plugin list names, and
# loadorder.txt is the masters, those plugins, then the same names. The
# plugins the game loads on its own are the ones the last release's
# loadorder.txt has between the masters and its list (the Creation Club's and
# _ResourcePack.esl), which no machine here can read Skyrim.ccc for. The
# header line and the CRLF endings are the last release's. Writes plugins.txt
# and loadorder.txt into $OutDir and returns their paths, with Enabled (the
# names plugins.txt enables, in order); throws, naming why, when the
# checkout's order cannot be read or the last release's lists are not lists.
function New-ShipFeedMoveLists([string]$RepoDir, [string]$PrevPlugins, [string]$PrevLoadOrder, [string]$OutDir) {
    $mpath = Join-Path $RepoDir $ShipLastManifest
    if (-not (Test-Path -LiteralPath $mpath -PathType Leaf)) { throw "there is no $ShipLastManifest, so the checkout has no order to move the collection revision with." }
    $m = ([IO.File]::ReadAllText($mpath) -replace '^\uFEFF', '') | ConvertFrom-Json
    $order = @(@($m.loadOrder) | ForEach-Object { "$_".Trim() } | Where-Object { $_ -and $_ -ine $ShipLastPlugin })
    if ($order.Count -lt ($ShipBaseMasters.Count + 1)) { throw "$ShipLastManifest has no load order, so the checkout has no order to move the collection revision with." }
    for ($i = 0; $i -lt $ShipBaseMasters.Count; $i++) {
        if ($order[$i] -ine $ShipBaseMasters[$i]) { throw "$ShipLastManifest's load order does not start with the five base masters (position $($i + 1) is $($order[$i])), so it is not an order the game loads." }
    }
    $readList = {
        param([string]$Path)
        $text = [IO.File]::ReadAllText($Path) -replace '^\uFEFF', ''
        $lines = @($text -split "`r?`n" | ForEach-Object { $_.Trim() })
        [pscustomobject]@{
            Header = @($lines | Where-Object { $_.StartsWith('#') } | Select-Object -First 1)
            Names  = @($lines | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object { $_.TrimStart('*').Trim() })
        }
    }
    $pp = & $readList $PrevPlugins
    $pl = & $readList $PrevLoadOrder
    if (-not $pp.Names.Count -or -not $pl.Names.Count) { throw "the last release's plugin list is empty, so where the game's own plugins go is not known." }
    $listed = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($n in $pp.Names) { [void]$listed.Add($n) }
    $own = @($pl.Names | Where-Object { $ShipBaseMasters -notcontains $_ -and -not $listed.Contains($_) })
    $ownSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($n in $own) { [void]$ownSet.Add($n) }
    $names = @(@($order | Select-Object -Skip $ShipBaseMasters.Count | Where-Object { -not $ownSet.Contains($_) }) + $ShipLastPlugin)
    $header = if ($pp.Header.Count) { [string]$pp.Header[0] } else { '# Automatically generated by Vortex' }
    $loHeader = if ($pl.Header.Count) { [string]$pl.Header[0] } else { $header }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $utf8 = New-Object Text.UTF8Encoding($false)
    $plugins = Join-Path $OutDir 'plugins.txt'
    $loadorder = Join-Path $OutDir 'loadorder.txt'
    [IO.File]::WriteAllText($plugins, ((@($header) + @($names | ForEach-Object { '*' + $_ })) -join "`r`n") + "`r`n", $utf8)
    [IO.File]::WriteAllText($loadorder, ((@($loHeader) + $ShipBaseMasters + $own + $names) -join "`r`n") + "`r`n", $utf8)
    return [pscustomobject]@{ Plugins = $plugins; LoadOrder = $loadorder; Enabled = $names; Own = $own }
}

# WHAT SKYUI'S MENU CHECK READS, FROM THE FEED (#2754). Check-SkyUIMenus.js
# reads SkyUI's script and its menus where the game takes them: a loose
# script (*.pex) under Data\Scripts and a loose menu (*.swf) under
# Data\Interface, or inside an archive (*.bsa) the plugin list loads, with the
# paths every release deletes read as gone. Nothing else under Data\Interface
# is read: on 31 Oct a cloud dev Ship stopped here for the content plugin's
# string table, Data\Interface\Translations\Thornswood-Content_ENGLISH.txt,
# which the check never opens. A release from the
# feed has the collection's revision and the last release's plugin list (held
# to the server's order above), and the last release passed the check: every
# Ship runs it, on both channels, with no way past it. So when every file of
# those kinds in $GameDir, less the paths this release deletes, is byte for
# byte the one the last release's record names, and the record names no other,
# the check would read what every install read with the last release, and its
# answer holds. Returns the paths that differ, sorted; none when it holds. Any
# path means SkyUI's files moved, which the check has to read, against the
# collection's archives, on One.
function Test-ShipSkyUIInput([string]$Rel) {
    return ($Rel -match '^(?i)Data\\Scripts\\.*\.pex$' -or $Rel -match '^(?i)Data\\Interface\\.*\.swf$' -or $Rel -match '(?i)\.bsa$')
}

function Get-ShipSkyUIFeedChange([string]$GameDir, [hashtable]$Record, [string[]]$Gone = @()) {
    $goneSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($g in $Gone) { if ($g) { [void]$goneSet.Add($g) } }
    $then = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($k in $Record.Keys) {
        if ($k.StartsWith(':') -or -not (Test-ShipSkyUIInput $k)) { continue }
        $then[$k] = ([string]$Record[$k]).ToLowerInvariant()
    }
    $changed = New-Object 'System.Collections.Generic.List[string]'
    $listed = (Get-Item -LiteralPath $GameDir).FullName
    $sep = [string][IO.Path]::DirectorySeparatorChar
    $prefix = $listed.TrimEnd($sep) + $sep
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($f in @(Get-ChildItem -LiteralPath $listed -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($prefix.Length).Replace($sep, '\')
        if (-not (Test-ShipSkyUIInput $rel) -or $goneSet.Contains($rel)) { continue }
        [void]$seen.Add($rel)
        $now = ('{0}:{1}' -f $f.Length, (Get-ShipFileSha256 $f.FullName))
        if (-not $then.ContainsKey($rel) -or $then[$rel] -ne $now) { $changed.Add($rel) }
    }
    foreach ($k in $then.Keys) { if (-not $seen.Contains($k)) { $changed.Add($k) } }
    return @($changed | Sort-Object -Unique)
}

function Get-ShipLastPluginProblem([string]$RepoDir, [string[]]$Enabled, [string[]]$Ccc = @()) {
    $rebuild = 'Build it again for this load order: python scripts\mods\Build-LastPlugin.py --data <a Data folder holding the collection''s bytes>, then commit game\data\last-plugin.recipe and game\data\last-plugin.json.'
    $recipe = Join-Path $RepoDir $ShipLastRecipe
    $mpath = Join-Path $RepoDir $ShipLastManifest
    if (-not (Test-Path -LiteralPath $mpath)) { return "the checkout has the recipe for $ShipLastPlugin and no $ShipLastManifest saying what it was built against." }
    try { $m = ([IO.File]::ReadAllText($mpath) -replace '^\uFEFF', '') | ConvertFrom-Json } catch { return "$ShipLastManifest does not read as JSON: " + $_.Exception.Message }
    $rpath = Join-Path $RepoDir 'records\collection-plugins.json'
    if (-not (Test-Path -LiteralPath $rpath)) { return "there is no records\collection-plugins.json, so nothing says which bytes the collection gives people." }
    try { $record = ([IO.File]::ReadAllText($rpath) -replace '^\uFEFF', '') | ConvertFrom-Json } catch { return "records\collection-plugins.json does not read as JSON: " + $_.Exception.Message }
    $rows = @{}
    foreach ($r in @($record.plugins)) { $rows[([string]$r.name).ToLowerInvariant()] = $r }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hashOf = { param($f) $fs = [IO.File]::OpenRead($f); try { -join ($sha.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }) } finally { $fs.Dispose() } }
        # The recipe names the size and sha256 of the plugin it makes, in its
        # first 41 bytes (scripts\mods\last_recipe.py), and the manifest names
        # both the plugin and the recipe.
        $rb = [IO.File]::ReadAllBytes($recipe)
        if ($rb.Length -lt 41 -or [Text.Encoding]::ASCII.GetString($rb, 0, 5) -ne ('TSLR' + [char]1)) { return "$ShipLastRecipe is not a version 1 recipe for $ShipLastPlugin. $rebuild" }
        $makes = -join ($rb[9..40] | ForEach-Object { $_.ToString('x2') })
        if ([BitConverter]::ToUInt32($rb, 5) -ne [int64]$m.plugin.size -or $makes -ne ([string]$m.plugin.sha256).ToLowerInvariant()) {
            return "$ShipLastRecipe makes another $ShipLastPlugin (sha256 $($makes.Substring(0, 12))) than the one $ShipLastManifest describes (sha256 $(([string]$m.plugin.sha256).Substring(0, 12))). $rebuild"
        }
        $own = & $hashOf $recipe
        if (-not $m.recipe -or $own -ne ([string]$m.recipe.sha256).ToLowerInvariant() -or [int64]$rb.Length -ne [int64]$m.recipe.size) {
            return "$ShipLastRecipe is not the recipe $ShipLastManifest describes (sha256 $($own.Substring(0, 12))). $rebuild"
        }
        $names = @($Enabled | Where-Object { $_ })
        if (-not $names.Count -or $names[-1] -ine $ShipLastPlugin) {
            return "the plugin list this release carries does not enable $ShipLastPlugin last."
        }
        $first = @($ShipBaseMasters)
        foreach ($c in @($Ccc | ForEach-Object { "$_".Trim() } | Where-Object { $_ })) { if ($first -notcontains $c) { $first += $c } }
        $order = $first + @($names | Select-Object -First ($names.Count - 1) | Where-Object { $first -notcontains $_ })
        $built = @($m.loadOrder | ForEach-Object { [string]$_ })
        for ($i = 0; $i -lt [Math]::Max($order.Count, $built.Count); $i++) {
            $a = if ($i -lt $order.Count) { $order[$i] } else { '(nothing)' }
            $b = if ($i -lt $built.Count) { $built[$i] } else { '(nothing)' }
            if ($a -ine $b) {
                return "$ShipLastPlugin was built against another load order: at position $($i + 1) this release loads $a and the plugin was built with $b. $rebuild"
            }
        }
        $revision = [string]$record.revision
        foreach ($row in @($m.builtAgainst)) {
            $n = [string]$row.name
            if ($n -ieq 'Thornswood-Content.esp') {
                $c = Join-Path $RepoDir 'game\content\Thornswood-Content.esp'
                if (-not (Test-Path -LiteralPath $c) -or (& $hashOf $c) -ne ([string]$row.sha256).ToLowerInvariant()) {
                    return "$ShipLastPlugin was built against another Thornswood-Content.esp than the one this checkout ships. $rebuild"
                }
                continue
            }
            $r = $rows[$n.ToLowerInvariant()]
            if ($null -eq $r) { return "$ShipLastPlugin was built against $n, which collection revision $revision does not have. $rebuild" }
            if ([int64]$r.size -ne [int64]$row.size -or ([string]$r.sha256).ToLowerInvariant() -ne ([string]$row.sha256).ToLowerInvariant()) {
                return ("$ShipLastPlugin was built against other bytes of $n ({0:N0} bytes, sha256 {1}) than collection revision $revision gives people ({2:N0} bytes, sha256 {3}). $rebuild" -f
                        [int64]$row.size, ([string]$row.sha256).Substring(0, 12), [int64]$r.size, ([string]$r.sha256).Substring(0, 12))
            }
        }
    } finally { $sha.Dispose() }
    return ''
}
