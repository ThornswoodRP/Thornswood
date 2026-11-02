<#
  Publish-Pack.ps1

  Builds the optional packs listed in optional-packs.txt, sends them to the
  site, and adds them to version.json so every launcher offers them under
  Add-ons on its Diagnostics page.

      .\scripts\release\Publish-Pack.ps1
      .\scripts\release\Publish-Pack.ps1 -Only hd-textures
      .\scripts\release\Publish-Pack.ps1 -DryRun        build and check, upload nothing

  WHERE THE PACKS GO (#897). Updates come from thornswood.net since 28 Sep, so
  each zip is sent to /feed/assets/<sha256> on the site with
  Remirror-Site-Feed.ps1 -Send (.part then rename) BEFORE version.json is
  touched, the feed names it there, and then the feed itself goes to the VPS
  store with Remirror-Site-Feed.ps1, which is what launchers read (#907).
  Nothing is uploaded to GitHub; the GitHub release path went with
  Thornswood-Releases.

  These were the files the old installer's builder left out of the installer;
  both read optional-packs.txt. That builder went with #4824, and nothing
  reads the list to leave these paths out of a release now (optional-packs.txt
  says so). None is listed.

  THE ONE RULE, and it is checked rather than trusted: a pack may not contain a
  plugin. The server compares every enabled plugin by name, size and crc32, so
  one person with an extra esp is one person who cannot connect. Textures,
  meshes, sounds, weather and shaders are invisible to that check and are why
  this is safe at all. A pack with a plugin in it is refused and nothing is
  uploaded.

  THE OTHER RULE, checked the same way: every pack written into version.json
  has to be one a launcher can download, by Feed-Rules.ps1. The live feed is
  received from the VPS before the file is edited, so these packs land on top
  of whatever another machine has just published, and the send refuses a feed
  that changed up there in between rather than writing over it.
#>
[CmdletBinding()]
param(
    [string]$Only,
    [switch]$DryRun,
    [string]$Root = (& (Join-Path $PSScriptRoot 'Where.ps1') Install),
    # A folder holding the version.json to add the packs to. Left out, the
    # live feed is received from the VPS store into this machine's working
    # folder for main, and sent back (#907).
    [string]$ReleaseDir,
    [switch]$NoPause,
    # A folder standing in for the site's feed root, passed to
    # Remirror-Site-Feed.ps1 so nothing connects to the VPS. Tests only.
    [string]$SiteDir,
    # Go ahead from a checkout that is not exactly origin/main and clean (#2118). Loud.
    [switch]$AllowStaleCheckout
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# A stale or dirty checkout sends old or unlanded code; refuse it (#2118).
if (-not $DryRun) { . (Join-Path $PSScriptRoot '..\deploy\Fresh-Checkout.ps1'); Assert-FreshCheckout -RepoDir (Join-Path $PSScriptRoot '..\..') -What 'Publish-Pack' -AllowStale:$AllowStaleCheckout }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent (Split-Path -Parent $Here)
# The live feed is on the VPS beside what the site serves (Feed-Store.ps1,
# #907), received into this machine's working folder for main. Optional
# packs are on the live feed only. Until #907 this was the Thornswood-Releases
# clone beside this repository.
. (Join-Path $Here 'Feed-Store.ps1')
$receive = -not $ReleaseDir
if (-not $ReleaseDir) { $ReleaseDir = Get-FeedStoreDir 'main' }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

# Which pack urls a launcher can actually download. Add-ons on Diagnostics fetches an
# optional pack through the same Updater code as a required one, so the rule
# Publish-Update.ps1 holds required packs to is the rule here too.
. (Join-Path $Here 'Feed-Rules.ps1')

Write-Host ''
Write-Host '  THORNSWOOD  -  optional packs' -ForegroundColor White

# ------------------------------------------------------------ the list ---
$listFile = Join-Path $Here 'optional-packs.txt'
if (-not (Test-Path -LiteralPath $listFile)) { Die "No optional-packs.txt next to this script." }

$packs = @{}
$order = @()
foreach ($line in (Get-Content -LiteralPath $listFile)) {
    $t = $line.Trim()
    if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
    $parts = $t -split '\|'
    if ($parts.Count -lt 3) { Say "  ignored, needs id | name | path:  $t" 'Yellow'; continue }
    $id = $parts[0].Trim()
    if (-not $packs.ContainsKey($id)) {
        $packs[$id] = [pscustomobject]@{ Id = $id; Name = $parts[1].Trim(); Paths = @() }
        $order += $id
    }
    $packs[$id].Paths += $parts[2].Trim().TrimStart('\')
}

if ($order.Count -eq 0) {
    Head 'Nothing to do'
    Say '  optional-packs.txt lists no packs.' 'Yellow'
    Write-Host ''
    Say '  A line looks like this:' 'DarkGray'
    Say '      hd-textures | High resolution textures | Data\textures\' 'Green'
    Write-Host ''
    Say '  optional-packs.txt says what has to leave that path out of the packs first.' 'DarkGray'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

if ($Only) {
    if (-not $packs.ContainsKey($Only)) { Die "No pack called '$Only' in optional-packs.txt." }
    $order = @($Only)
}

$GameDir = Join-Path $Root 'Game'
if (-not (Test-Path -LiteralPath $GameDir)) { Die "No build at $GameDir." }

$work = Join-Path ([IO.Path]::GetTempPath()) 'thornswood-packs'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path $work

# ------------------------------------------------------------ building ---
$built = @()
foreach ($id in $order) {
    $p = $packs[$id]
    Head ("Building " + $p.Name)

    $stage = Join-Path $work $id
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $stage 'game')

    $count = 0; $bytes = 0; $plugins = @()
    foreach ($rel in $p.Paths) {
        $src = Join-Path $GameDir $rel
        if (-not (Test-Path -LiteralPath $src)) { Say "  not in the build, skipped:  $rel" 'Yellow'; continue }

        $files = @(Get-ChildItem -LiteralPath $src -Recurse -File -Force)
        # The long path, which is what FullName starts with. $GameDir
        # itself is the short 8.3 form when the build sits under a short
        # TEMP (issue #1156). Named with \ on any machine (#2989).
        $sep = [string][IO.Path]::DirectorySeparatorChar
        $prefix = (Get-Item -LiteralPath $GameDir).FullName.TrimEnd($sep) + $sep
        foreach ($f in $files) {
            $r = $f.FullName.Substring($prefix.Length).Replace($sep, '\')
            $ext = $f.Extension.ToLowerInvariant()
            if ($ext -in '.esp', '.esm', '.esl', '.bsa') { $plugins += $r; continue }
            $dest = Join-Path (Join-Path $stage 'game') $r
            $dir = Split-Path -Parent $dest
            if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
            Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
            $count++; $bytes += $f.Length
        }
        Say ("  {0}  {1:n0} files" -f $rel, $files.Count)
    }

    # This is the check the whole design rests on. A plugin in a pack means
    # some people have an esp others do not, and the server turns them away
    # with a load order mismatch that looks like a launcher bug.
    if ($plugins.Count) {
        Write-Host ''
        Say "  $($p.Name) contains $($plugins.Count) plugin or archive file(s):" 'Red'
        $plugins | Select-Object -First 12 | ForEach-Object { Say "    $_" 'Red' }
        if ($plugins.Count -gt 12) { Say ("    and " + ($plugins.Count - 12) + " more") 'Red' }
        Write-Host ''
        Say '  A pack cannot contain a plugin or a bsa. The server compares plugin' 'Yellow'
        Say '  lists, so anybody who installs this could not connect, and a bsa is' 'Yellow'
        Say '  loaded by a plugin, so taking one optional shows as purple textures.' 'Yellow'
        Say '  Narrow the path in optional-packs.txt to a folder without them.' 'Yellow'
        Die 'Nothing was built and nothing was uploaded.'
    }

    if ($count -eq 0) { Say '  nothing to pack, skipped' 'Yellow'; continue }

    $zip = Join-Path $work ($id + '.zip')
    Say ("  {0:n0} files, {1:n1} MB, compressing..." -f $count, ($bytes / 1MB))
    Compress-Archive -Path (Join-Path $stage 'game') -DestinationPath $zip -CompressionLevel Optimal -Force
    $zipItem = Get-Item -LiteralPath $zip
    $sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    Say ("  {0:n1} MB zipped" -f ($zipItem.Length / 1MB)) 'Green'

    $built += [pscustomobject]@{
        Id = $id; Name = $p.Name; Zip = $zip
        Bytes = $zipItem.Length; Sha = $sha; Files = $count; Raw = $bytes
    }
}

if ($built.Count -eq 0) { Die 'Nothing was built.' }

if ($DryRun) {
    Head 'Dry run'
    foreach ($b in $built) { Say ("  {0,-24} {1:n1} MB  {2}" -f $b.Id, ($b.Bytes / 1MB), $b.Sha.Substring(0, 12)) }
    Write-Host ''
    Say '  Nothing was uploaded. Run it again without -DryRun.' 'Yellow'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ----------------------------------------------------------- uploading ---
# ==== thornswood pack site upload ====
# tests\test-pack-feed.ps1 runs this block on its own. If the markers move,
# it stops rather than quietly testing nothing.
#
# Every zip goes to /feed/assets/<sha256> on the site, the path site\server.js
# serves with Range resume, before version.json is touched. One that does not
# land stops the publish with the feed as it was, so nobody is offered a pack
# the site does not hold. Optional packs are on the live feed only, so this is
# /feed and never /feed-dev.
Head 'Sending to the site'
$sendArgs = @{ Send = @($built | ForEach-Object { $_.Zip }) }
if ($SiteDir) { $sendArgs['SiteDir'] = $SiteDir }
$global:LASTEXITCODE = 0
$sendWhy = ''
try { & (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') @sendArgs }
catch { $sendWhy = $_.Exception.Message }
if (-not $sendWhy -and $LASTEXITCODE -ne 0) { $sendWhy = "Remirror-Site-Feed.ps1 -Send exited $LASTEXITCODE" }
if ($sendWhy) {
    Say "  $sendWhy" 'Red'
    Die ('Not every pack reached the site, so version.json has not been touched and nobody has been offered them. ' +
         'Check the ssh key with scripts\vps\Setup-SshKey.ps1 -Test, then run this again.')
}
foreach ($b in $built) {
    $u = Get-HostFeedAssetUrl $b.Sha
    if (-not $u) { Die ("No site url for {0}, so version.json has not been touched." -f $b.Id) }
    $b | Add-Member -NotePropertyName Url -NotePropertyValue $u -Force
    Say ("  {0}  {1}" -f $b.Id, $u) 'Green'
}
# ==== end thornswood pack site upload ====

# --------------------------------------------------------- version.json ---
Head 'version.json'
# ==== thornswood pack feed ====
# tests\test-pack-feed.ps1 runs this block on its own, against scratch clones.
# If the markers move, it stops rather than quietly testing nothing.
# Received from the VPS before it is edited, the way Publish-Update.ps1 does
# it (#907): two people can publish from two machines, and these packs go on
# top of whatever the other one just published. The send below refuses if the
# feed changed up there in between, so nothing is written over. -ReleaseDir
# works on a folder instead and receives nothing.
if ($receive) {
    try { [void](Receive-FeedStore 'main' $ReleaseDir) }
    catch { Die ("Could not receive the live feed from the VPS, so version.json has not been touched. The zips are already on the site, so the same run puts them on the feed: " + $_.Exception.Message) }
}
$vf = Join-Path $ReleaseDir 'version.json'
if (-not (Test-Path -LiteralPath $vf)) { Die "No version.json in $ReleaseDir." }

$raw = [IO.File]::ReadAllText($vf) -replace '^\uFEFF', ''
$doc = $raw | ConvertFrom-Json

# Nobody is offered a pack they cannot fetch. Feed-Rules.ps1 has the rule and
# says why: a launcher downloads every pack from the url the feed gives, so
# anything but the thornswood.net feed path answers 404 under Add-ons.
$feedRepo = Get-FeedRepo $doc
$offFeed = @($built | Where-Object { -not (Test-FeedPackUrl $_.Url $feedRepo) })
if ($offFeed.Count) {
    foreach ($o in $offFeed) { Say ("  {0}.zip is at {1}" -f $o.Id, $o.Url) 'Red' }
    Die ("A launcher cannot download a pack from there, so version.json has not been touched. " +
         "The zips are up and nobody has been offered them.")
}
# ==== end thornswood pack feed ====

$optional = @()
if ($doc.PSObject.Properties['optional'] -and $doc.optional) { $optional = @($doc.optional) }

foreach ($b in $built) {
    # Replace the entry rather than adding a second one, so republishing a pack
    # does not leave two rows with the same name and different checksums.
    $optional = @($optional | Where-Object { $_.id -ne $b.Id })
    $optional += [pscustomobject]@{
        id = $b.Id; name = $b.Name; url = $b.Url; sha256 = $b.Sha
        bytes = $b.Bytes
        notes = ('{0:n0} files' -f $b.Files)
    }
    Say ("  {0,-24} {1:n1} MB" -f $b.Id, ($b.Bytes / 1MB))
}

if ($doc.PSObject.Properties['optional']) { $doc.optional = $optional }
else { $doc | Add-Member -NotePropertyName optional -NotePropertyValue $optional }

Write-FeedVersionFile $vf $doc

Remove-Item $work -Recurse -Force -EA SilentlyContinue

# ==== thornswood pack site feed ====
# The feed goes to the VPS store, which is what launchers read (#907). Sent by
# Remirror-Site-Feed.ps1, which first checks every asset the feed names is on
# the site, then replaces version.json through Feed-Store.ps1 only while the
# feed and baseline up there are the ones received above. Until #907 this
# pushed the Thornswood-Releases clone and then remirrored.
Head 'Feed to the site'
$mirrorArgs = @{ FeedDir = $ReleaseDir }
if ($SiteDir) { $mirrorArgs['SiteDir'] = $SiteDir }
$global:LASTEXITCODE = 0
$mirrorWhy = ''
try { & (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') @mirrorArgs }
catch { $mirrorWhy = $_.Exception.Message }
if (-not $mirrorWhy -and $LASTEXITCODE -ne 0) { $mirrorWhy = "Remirror-Site-Feed.ps1 exited $LASTEXITCODE" }
if ($mirrorWhy) {
    Say "  $mirrorWhy" 'Red'
    Die ('The packs are on the site and in the version.json here, but the site still serves the feed without them. ' +
         'Run this again; it sends only what is missing.')
}
# ==== end thornswood pack site feed ====

Head 'Done'
Say ("  " + $built.Count + " pack(s) live. They show under Add-ons on the launcher's Diagnostics page.") 'Green'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
