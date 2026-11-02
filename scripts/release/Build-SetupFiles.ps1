<#
.SYNOPSIS
  Builds the files the launcher's Velopack package carries beside Game for
  the install's first start, and the list of them.

.DESCRIPTION
  Velopack's Setup.exe puts the launcher and its package on the PC, and the
  launcher's first start runs the install (launcher\app\InstallSteps.cs,
  #4824). That reads these, from the package's own folder, beside the game
  files:

      config.json       the -Channel feed's server, voice and site, the
                        fields New-FeedRoot.ps1 writes, and Channel, which
                        picks the launcher's feed and its Velopack channel;
                        the install merges it into the install folder's own
      profile\          plugins.txt and loadorder.txt, the reference load
                        order of the release the game files were built over
                        (dev's, its :golden:), fetched from the site by their
                        sha256 (#3412), so the load order matches the
                        files
      applied.txt       every pack the -Channel feed lists, so a fresh
                        install does not offer the whole history of the
                        project as pending updates (the install writes it
                        only when the install folder has none)
      SOURCE CODE.txt,  where the source of the SkyMP files in Game is, the
      GPL-3.0.txt,      GNU GPL and AGPL texts, and the licence texts of the
      AGPL-3.0.txt,     libraries inside those files (Source-Notice.ps1, kind
      licences\         setup; #421, #3099)
      *-LICENSE.txt,    the licence texts of the libraries inside the
      *-NOTICES.txt,    launcher and shipped with it, the voice's Concentus,
      Velopack-Rust-    SharpSRTP and BouncyCastle among them, from
      crates.txt        installer\licences (its README.txt says where each
                        is from); the names are InstallSteps.LicenceFiles,
                        read from InstallSteps.cs (#4823)

  merge-release.yml packs every one of them at the top of the package, beside
  Thornswood.exe and Game, and setup-files.<channel>.json lists each with its
  size and sha256. That list goes into the Release's signed manifest, and the
  launcher refuses an update package holding a file beside Game that the list
  does not name with those bytes (launcher\app\VeloPackage.cs).

      setup-files.<channel>.json: { schema: 1, commit, channel,
                          from: <the record id the game files were built over>,
                          files: [ { path: "profile/plugins.txt", size, sha256 } ] }

  ONE PER CHANNEL. Every merge release that makes a package packs it for dev
  and for main from the same launcher and game files (merge-release.yml), and
  this runs once for each: config.json and applied.txt are the channel's
  own, and everything else is the same. The game files are always built over
  dev's last release, so the record checked and the load order are dev's for
  both.

  No read me is carried: READ ME FIRST.txt told people which of Setup.bat
  and Install.bat to run, both retired with #4824, and it went with them.
  The install window says each step, and the join guide on the site is the
  long form (installer\README.md).

  WHAT IT REFUSES. A -GameRoot New-FeedRoot did not stage (no record), a dev
  feed whose record is not the one staged there (a Ship published between the
  two steps: run the workflow again), a record with no reference load order,
  and a golden list that does not hash to its name.

  Talks to the site (https) for the feed and the two lists; never to the VPS.
  Writes only under -Out.

.PARAMETER Out
  The folder: files\ holds what is packed, setup-files.<channel>.json the
  list. Emptied first.

.PARAMETER GameRoot
  The folder Build-GameFiles.ps1 staged dev's last release in (its -Root),
  holding Game and record\record.json as New-FeedRoot.ps1 left them.

.PARAMETER Channel
  The Velopack channel the package is for, dev or main: whose server, voice,
  site and packs config.json and applied.txt carry.

.PARAMETER Commit
  The commit, 40 hex, written into the list. git rev-parse HEAD unless given.

.PARAMETER SiteDir
  A folder standing in for the site's root. Tests only.

.EXAMPLE
  pwsh -File scripts/release/Build-SetupFiles.ps1 -Out $env:RUNNER_TEMP\setup-main -GameRoot $env:RUNNER_TEMP\game-root -Channel main
  What merge-release.yml runs for main's package, and with -Channel dev for dev's.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [Parameter(Mandatory = $true)][string]$GameRoot,
    [Parameter(Mandatory = $true)][ValidateSet('main', 'dev')][string]$Channel,
    [string]$Commit,
    [string]$SiteUrl = 'https://thornswood.net',
    [string]$SiteDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Here = $PSScriptRoot
$RepoDir = (Resolve-Path (Join-Path $Here '..\..')).Path
. (Join-Path $Here 'Read-JsonFile.ps1')
. (Join-Path $Here 'Feed-Store.ps1')
. (Join-Path $Here 'Release-Baseline.ps1')
. (Join-Path $Here 'Source-Notice.ps1')
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

if (-not $Commit) { $Commit = (& git -C $RepoDir rev-parse HEAD).Trim() }
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "commit $Commit is not 40 hex" }
$recordFile = Join-Path (Join-Path $GameRoot 'record') 'record.json'
$gameDir = Join-Path $GameRoot 'Game'
if (-not (Test-Path -LiteralPath $recordFile -PathType Leaf)) { throw "$recordFile is not there. Build-GameFiles.ps1 (New-FeedRoot.ps1) stages it; run that first with this -Root." }

if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Recurse -Force }
$files = Join-Path $Out 'files'
$null = New-Item -ItemType Directory -Force -Path (Join-Path $files 'profile')
$utf8 = New-Object Text.UTF8Encoding($false)

# ---- dev's feed, held to the record the game files were built over
$devFeed = Read-SiteFeed 'dev' $SiteDir $SiteUrl
if ($null -eq $devFeed) { throw 'The site has no dev feed.' }
$ptr = Get-FeedBaselinePointer $devFeed
if ($null -eq $ptr) { throw 'The dev feed names no record of its last release.' }
$staged = (Get-FileHash -LiteralPath $recordFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($staged -ne ([string]$ptr.sha256).ToLowerInvariant()) {
    throw ("The dev feed names release $([string]$ptr.id) now, and the game files were built over another record ($staged). " +
           'A Ship published while this ran; run the workflow again so both are the same release.')
}
$map = Read-BaselineFile $recordFile

# ---- the package's channel's own feed, for config.json and applied.txt
$feed = $devFeed
if ($Channel -ne 'dev') {
    $feed = Read-SiteFeed $Channel $SiteDir $SiteUrl
    if ($null -eq $feed) { throw "The site has no $Channel feed." }
}

# ---- config.json: the channel feed's server, voice and site, the fields
# New-FeedRoot.ps1 writes from a feed, and the channel. The launcher reads its
# feed and its Velopack channel from Channel (Updater.FeedUrl,
# Velo.ChannelFor): 'dev', or empty for main, as the old setup wrote it.
$cfgOut = [ordered]@{}
foreach ($pair in @(@('ServerAddress', 'serverAddress'), @('ServerPort', 'serverPort'),
                    @('UpdateFeedUrl', 'updateFeedUrl'), @('VoicePort', 'voicePort'),
                    @('VoiceUrl', 'voiceUrl'), @('DiscordAppId', 'discordAppId'), @('SiteUrl', 'siteUrl'),
                    @('PresenceImage', 'presenceImage'), @('CollectionUrl', 'collectionUrl'))) {
    if ($feed.PSObject.Properties[$pair[1]]) { $cfgOut[$pair[0]] = [string]$feed.($pair[1]) }
}
$cfgOut['Channel'] = $(if ($Channel -eq 'dev') { 'dev' } else { '' })
[IO.File]::WriteAllText((Join-Path $files 'config.json'), (([pscustomobject]$cfgOut) | ConvertTo-Json), $utf8)
Say "  config.json: the $Channel feed's server, voice and site, and the $Channel channel" 'Green'

# ---- profile\: the reference load order the release recorded (:golden:)
$sd = Get-FeedStoreSiteDir $SiteDir
foreach ($f in 'plugins.txt', 'loadorder.txt') {
    $key = ":golden:$f"
    if (-not $map.ContainsKey($key)) { throw "Release $([string]$ptr.id) recorded no $f, so the install would carry no reference load order." }
    $sha = ([string]$map[$key]).Split(':')[-1].ToLowerInvariant()
    $url = Get-RecordFileUrl ([string]$ptr.url) $sha
    if (-not $url) { throw "The dev feed's record is not an asset on the site ($([string]$ptr.url)), so its $f cannot be fetched beside it." }
    [void](Get-FeedAssetFile $url $sha (Join-Path (Join-Path $files 'profile') $f) $sd $SiteUrl)
}
Say "  profile\: plugins.txt and loadorder.txt of release $([string]$ptr.id)" 'Green'

# ---- applied.txt: every pack the channel's feed lists
$ids = @()
if ($feed.PSObject.Properties['packs']) {
    foreach ($pk in @($feed.packs)) {
        if ($pk -and $pk.PSObject.Properties['id'] -and $pk.id) { $ids += [string]$pk.id }
    }
}
$ids = @($ids | Select-Object -Unique)
if ($ids.Count -gt 0) {
    [IO.File]::WriteAllLines((Join-Path $files 'applied.txt'), [string[]]$ids, $utf8)
    Say ("  applied.txt: {0} packs the release already holds" -f $ids.Count) 'Green'
} else {
    Say '  applied.txt: the feed lists no packs, so none is written' 'DarkGray'
}

# ---- SOURCE CODE.txt, the GPL and AGPL texts and licences\
$carried = @()
if (Test-Path -LiteralPath $gameDir) {
    $carried = @(Get-ChildItem -LiteralPath $gameDir -Recurse -File -Force | ForEach-Object { [IO.Path]::GetRelativePath($gameDir, $_.FullName).Replace('/', '\') })
}
$entries = @(Get-SourceNoticeEntries (Join-Path $RepoDir 'records\client-build.json') $carried 'setup' (Join-Path $RepoDir 'installer\licences') (Join-Path $RepoDir 'records\front-build.json'))
if ($entries.Count -eq 0) { throw 'The game files carry none of the SkyMP files, so there is no source to name. That is not a release this builds.' }
Write-SourceNoticeToFolder $files $entries
Say ("  SOURCE CODE.txt, the GPL and AGPL texts and {0} library licence texts" -f (@($entries).Count - 3)) 'Green'

# ---- the launcher's libraries' licence texts
# Everything built into the launcher or shipped with it (.NET, Avalonia,
# SkiaSharp and Skia, HarfBuzz, ANGLE, Velopack and its Rust crates, the voice
# libraries Concentus, SharpSRTP and BouncyCastle, NLayer, the voice's HRTF
# code and data): installer\licences\README.txt says where each text is from.
# The names are read from InstallSteps.LicenceFiles in
# launcher\app\InstallSteps.cs, the one list: the install copies those names
# from the package into the install folder and Uninstall.cs removes them
# (#4823), so a text added there is packed here with no second list to keep
# in step. The GPL and AGPL texts on it are Source-Notice's, written above.
$stepsCs = Join-Path $RepoDir 'launcher\app\InstallSteps.cs'
if (-not (Test-Path -LiteralPath $stepsCs)) { throw "$stepsCs is not there, so the licence texts the install copies cannot be read." }
$listAt = [regex]::Match([IO.File]::ReadAllText($stepsCs), '(?s)static\s+readonly\s+string\[\]\s+LicenceFiles\s*=\s*\{(.*?)\};')
if (-not $listAt.Success) { throw 'InstallSteps.cs has no LicenceFiles list, so the licence texts the install copies cannot be read.' }
$launcherLicences = @([regex]::Matches($listAt.Groups[1].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -notin 'GPL-3.0.txt', 'AGPL-3.0.txt' })
if ($launcherLicences.Count -eq 0) { throw 'InstallSteps.LicenceFiles names no licence text of the launcher''s libraries.' }
foreach ($lic in $launcherLicences) {
    $from = Join-Path $RepoDir (Join-Path 'installer\licences' $lic)
    if (-not (Test-Path -LiteralPath $from)) { throw "installer\licences\$lic is missing. Each library inside the launcher has its licence text go with the install (#4823)." }
    Copy-Item -LiteralPath $from -Destination (Join-Path $files $lic) -Force
}
Say ("  {0} licence texts of the launcher's libraries" -f $launcherLicences.Count) 'Green'

# ---- the list
$list = foreach ($f in @(Get-ChildItem -LiteralPath $files -Recurse -File -Force)) {
    [ordered]@{
        path   = [IO.Path]::GetRelativePath($files, $f.FullName).Replace('\', '/')
        size   = $f.Length
        sha256 = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$sorted = [object[]]@($list)
[Array]::Sort($sorted, [Comparison[object]] { param($a, $b) [string]::CompareOrdinal($a.path, $b.path) })
$doc = [ordered]@{ schema = 1; commit = $Commit; channel = $Channel; from = [string]$ptr.id; files = $sorted }
$listName = "setup-files.$Channel.json"
[IO.File]::WriteAllText((Join-Path $Out $listName), ($doc | ConvertTo-Json -Depth 4), $utf8)
Say ("  {0} lists {1} files" -f $listName, $sorted.Count) 'Green'
exit 0
