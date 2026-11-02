<#
  Remirror-Site-Feed.ps1

  Puts the release feed on the site, so https://thornswood.net/feed/version.json
  is the same file as this machine's working copy of the feed and every asset
  it names can be downloaded from thornswood.net.

  SINCE #907 THE VPS IS WHERE THE FEED LIVES. Publish-Update.ps1 receives it
  from there and sends it back itself (scripts\release\Feed-Store.ps1), so
  after a Ship this finds version.json up there already and only checks the
  assets. version.json goes up through the same Feed-Store check as a Ship: it
  replaces the site's copy only while that copy is still the one this machine
  received, and the one it replaces is kept in the feed's history folder.
  Handed a folder that was never received (-FeedDir at an old clone), it
  replaces whatever the site has, the way it always did, and says so.

  WHY IT EXISTS. Since the #649 host cutover a launcher reads version.json from
  the site (the GitHub fallback it had went with #907), and Publish-Update.ps1
  writes pack, launcher and clientRuntime urls
  as https://thornswood.net/feed/assets/<sha256>. Its own comment says "Website
  mirrors the bytes to /feed/assets/<sha256>", and nothing did: the mirror was
  somebody copying files by hand. A feed published without it points every
  launcher at bytes that answer 404, and a 404 on a pack fails the whole update
  and leaves Play off.

  WHAT IT SENDS, and in this order, because the order is the safety:

    1. every asset the feed names that is missing up there, each one to
       <sha256>.part and then renamed, so a dropped connection cannot leave a
       short file sitting at the name of its own hash
    2. version.json, last, and only when every asset it names is up there

  So the worst a failed run leaves is a site feed one release behind, which is
  what launchers were already reading, rather than a feed pointing at nothing.
  Nothing is ever deleted: an asset the current feed does not name is left
  alone, because an older feed may still name it.

      .\scripts\deploy\Remirror-Site-Feed.ps1 -Check   says what it would send
      .\scripts\deploy\Remirror-Site-Feed.ps1          the live feed, to /feed
      .\scripts\deploy\Remirror-Site-Feed.ps1 -Dev     the dev feed, to /feed-dev
      .\scripts\deploy\Remirror-Site-Feed.ps1 -Verify  re-sends any asset up
                                                       there whose bytes do not
                                                       hash to its own name
      .\scripts\deploy\Remirror-Site-Feed.ps1 -AssetDir D:\packs
                                                       another folder to look
                                                       for the bytes in

  HOW SHIP SHOULD CALL IT. After the release is published and before the news
  step, one line:

      & (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') -Dev:$Dev

  in a try/catch, the way Ship calls Publish-Discord.ps1. It exits 1 when it
  refused to publish the feed, which is a line on screen for whoever shipped
  rather than a reason to fail a release that is already out.

  SENDING ASSETS ON THEIR OWN (#897). Since updates come from the site rather
  than from GitHub, Publish-Update.ps1 sends each new pack, the
  launcher and the client runtime up BEFORE it writes version.json, with

      .\scripts\deploy\Remirror-Site-Feed.ps1 [-Dev] -Send <file>, <file>

  which sends exactly those files to /feed[-dev]/assets/<sha256> (by the same
  .part then rename), skips any already up there, never touches version.json,
  and exits 1 when one did not land. Copy-ReleaseAssets-ToSite.ps1 uses it too.

  -SiteDir <folder> stands in for the site's feed root on this machine: every
  list, send and rename happens in that folder and nothing connects to the
  VPS. The tests use it, with a copy of site\server.js serving that folder.

  Nothing about the setup program is this script's business: since #4824 it
  is the launcher, released on GitHub, and the site sends people there.

  Reads this machine's working copy of the feed, and writes only to the site's
  feed folders.
#>
[CmdletBinding()]
param(
  # The folder holding version.json. Left out, it is this machine's working
  # copy for the channel, %LOCALAPPDATA%\Thornswood\feed\main or ...\dev,
  # where Publish-Update.ps1 receives and edits it (Feed-Store.ps1).
  [string]$FeedDir,
  # The dev feed, to /feed-dev. The last dev Ship wins, the same as everywhere.
  [switch]$Dev,
  # More folders to look for asset bytes in, searched before the built-in ones.
  # A file named by its own sha256 is taken at its name; a .zip or .exe is
  # hashed to find out what it is.
  [string[]]$AssetDir,
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Root = 'C:/Thornswood-Docs',
  # Says what it would send and sends nothing. It still asks the VPS what is
  # already up there when it can, and says so when it cannot.
  [switch]$Check,
  # Hash every asset up there and re-send any whose bytes do not match the name
  # they are stored under. Off by default because the assets are tens of
  # megabytes each and the name is the hash.
  [switch]$Verify,
  [switch]$Quiet,
  # Send exactly these files to /feed[-dev]/assets/<sha256> and nothing else:
  # no feed is read and version.json is not sent. Publish-Update.ps1 calls it
  # before it writes the feed (#897).
  [string[]]$Send,
  # Hands back, one per line, the sha256 of every asset already in
  # /feed[-dev]/assets on the site, and sends nothing. Publish-Update.ps1 reads
  # it to check every file of a release is up under the name its record gives
  # it (#1050). Throws when the site could not be asked.
  [switch]$Have,
  # Where a bundle of assets is put together before it is sent. Left out, the
  # temp folder.
  [string]$WorkDir,
  # A folder on this machine standing in for the site's feed root (the folder
  # holding feed\ and feed-dev\). Nothing connects to the VPS. For the tests.
  [string]$SiteDir,
  # Stand-in for this machine's main feed store. Left out, that store is
  # %LOCALAPPDATA%\Thornswood\feed\main. Read only, and only so a dev run can
  # tell a main pack that is already there from one that is really missing.
  # The tests pass a scratch folder. It is never uploaded.
  [string]$MainStore
)

$ErrorActionPreference = 'Stop'
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
if (-not $User -and -not $SiteDir) { $User = Get-ThornswoodVpsUser }
if (-not $Vps -and -not $SiteDir) { $Vps = Get-ThornswoodVpsAddress }
$rootWin = $Root.Replace('/','\')
$prefix  = if ($Dev) { 'feed-dev' } else { 'feed' }

function Say($m, $c = 'Gray') { if (-not $Quiet) { Write-Host $m -ForegroundColor $c } }
function Head($m) { if (-not $Quiet) { Write-Host ''; Write-Host $m -ForegroundColor Cyan } }

# ------------------------------------------------------------ the transport --
# Three things this script does to the site, each one way over ssh and one way
# into -SiteDir, so the whole of it can be run against a folder on this machine.
function Get-ThereLines([bool]$withHashes) {
  if ($SiteDir) {
    $dir = Join-Path (Join-Path $SiteDir $prefix) 'assets'
    if (-not (Test-Path -LiteralPath $dir)) { return @('NOTHING THERE YET') }
    $lines = @('ASKED')
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -File)) {
      $h = ''
      if ($withHashes) { $h = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower() }
      $lines += ($f.Name + '|' + $f.Length + '|' + $h)
    }
    return $lines
  }
  $wantHashes = if ($withHashes) { '1' } else { '0' }
  $listScript = @"
`$dir = '$rootWin\$prefix\assets'
if (-not (Test-Path `$dir)) { 'NOTHING THERE YET'; exit }
'ASKED'
Get-ChildItem `$dir -File | ForEach-Object {
  `$h = ''
  if ('$wantHashes' -eq '1') { `$h = (Get-FileHash -LiteralPath `$_.FullName -Algorithm SHA256).Hash.ToLower() }
  `$_.Name + '|' + `$_.Length + '|' + `$h
}
"@
  return @(RemoteLines $listScript)
}

function New-ThereFolders {
  if ($SiteDir) {
    New-Item -ItemType Directory -Force -Path (Join-Path (Join-Path $SiteDir $prefix) 'assets') | Out-Null
    return @('ready')
  }
  return @(RemoteLines @"
foreach (`$d in @('$rootWin\$prefix', '$rootWin\$prefix\assets')) {
  if (-not (Test-Path `$d)) { New-Item -ItemType Directory -Path `$d -Force | Out-Null }
}
'ready'
"@)
}

# One asset, to <sha>.part and then renamed, so a dropped connection cannot
# leave a short file sitting at the name of its own hash: the site would serve
# it happily, and the launcher that downloads it fails the hash check and stops
# the whole update. Throws when it did not land.
function Send-Asset([string]$local, [string]$sha) {
  $size = (Get-Item -LiteralPath $local).Length
  if ($SiteDir) {
    $dir = Join-Path (Join-Path $SiteDir $prefix) 'assets'
    $part = Join-Path $dir ($sha + '.part')
    Copy-Item -LiteralPath $local -Destination $part -Force
    $n = (Get-Item -LiteralPath $part).Length
    if ($n -ne $size) { Remove-Item -LiteralPath $part -Force; throw "$sha did not land: SHORT: $n bytes of $size" }
    Move-Item -LiteralPath $part -Destination (Join-Path $dir $sha) -Force
    return
  }
  Invoke-ThornswoodNative { & scp @ssh $local "$User@${Vps}:$Root/$prefix/assets/$sha.part" }
  if ($LASTEXITCODE -ne 0) { throw "scp failed: $sha ($local)" }
  $said = ((RemoteLines @"
`$p = '$rootWin\$prefix\assets\$sha.part'
`$f = '$rootWin\$prefix\assets\$sha'
`$n = (Get-Item -LiteralPath `$p).Length
if (`$n -ne $size) { Remove-Item -LiteralPath `$p -Force; 'SHORT: ' + `$n + ' bytes of $size'; exit }
Move-Item -LiteralPath `$p -Destination `$f -Force
'in place'
"@) -join ' ').Trim()
  if ($said -notmatch 'in place') { throw "$sha did not land: $said" }
}

# MANY ASSETS AT ONCE (#1050). The first release after #1050 sends every file of
# ours, about 2,500 of them, and one scp and one ssh each would be thousands of
# connections. So more than a few go as one zip, each entry named by its sha256,
# unpacked up there by the script below: each one is written to <sha>.part,
# hashed, and renamed only when its bytes are its name, an asset already there
# is left alone, and the zip is deleted. It lands in the channel's folder beside
# the assets, which the site never serves (it answers only version.json and a
# name of 64 hex characters under assets). -SiteDir runs the same script here.
$BundleUnpack = @'
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipFile = '@ZIP@'
$assets = '@ASSETS@'
if (-not (Test-Path -LiteralPath $assets)) { New-Item -ItemType Directory -Force -Path $assets | Out-Null }
$z = [IO.Compression.ZipFile]::OpenRead($zipFile)
$h = [Security.Cryptography.SHA256]::Create()
try {
  foreach ($e in $z.Entries) {
    $name = $e.Name.ToLowerInvariant()
    if ($name -notmatch '^[0-9a-f]{64}$') { 'SKIP ' + $e.FullName; continue }
    $final = Join-Path $assets $name
    if (Test-Path -LiteralPath $final) { 'THERE ' + $name; continue }
    $part = $final + '.part'
    [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $part, $true)
    $s = [IO.File]::OpenRead($part)
    try { $got = -join ($h.ComputeHash($s) | ForEach-Object { $_.ToString('x2') }) } finally { $s.Dispose() }
    if ($got -ne $name) { Remove-Item -LiteralPath $part -Force; 'BAD ' + $name; continue }
    Move-Item -LiteralPath $part -Destination $final -Force
    'PUT ' + $name
  }
} finally {
  $z.Dispose(); $h.Dispose()
  Remove-Item -LiteralPath $zipFile -Force -ErrorAction SilentlyContinue
}
'UNPACKED'
'@

# $items: sha256 to local file. Throws unless every one is up there afterwards.
function Send-AssetBundle($items) {
  Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  $work = if ($WorkDir) { $WorkDir } else { [IO.Path]::GetTempPath() }
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $tag = [Guid]::NewGuid().ToString('N')
  $zipPath = Join-Path $work ("assets-$tag.zip")
  $z = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    foreach ($sha in @($items.Keys)) {
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $items[$sha], $sha, [IO.Compression.CompressionLevel]::Fastest)
    }
  } finally { $z.Dispose() }
  Say ("  {0} asset(s) in one bundle, {1:N1} MB" -f $items.Count, ((Get-Item -LiteralPath $zipPath).Length / 1MB))
  try {
    if ($SiteDir) {
      $assets = Join-Path (Join-Path $SiteDir $prefix) 'assets'
      $there = Join-Path (Join-Path $SiteDir $prefix) ("incoming-$tag.zip")
      Copy-Item -LiteralPath $zipPath -Destination $there -Force
      $text = $BundleUnpack.Replace('@ZIP@', $there.Replace("'", "''")).Replace('@ASSETS@', $assets.Replace("'", "''"))
      $said = @(& ([scriptblock]::Create($text)) | ForEach-Object { [string]$_ })
    } else {
      Invoke-ThornswoodNative { & scp @ssh $zipPath "$User@${Vps}:$Root/$prefix/incoming-$tag.zip" }
      if ($LASTEXITCODE -ne 0) { throw "scp failed: the bundle of $($items.Count) asset(s)" }
      $text = $BundleUnpack.Replace('@ZIP@', "$rootWin\$prefix\incoming-$tag.zip").Replace('@ASSETS@', "$rootWin\$prefix\assets")
      $said = @(RemoteLines $text)
    }
  } finally { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
  $bad = @($said | Where-Object { $_ -match '^BAD ' })
  if (-not (@($said) -contains 'UNPACKED') -or $bad.Count) {
    throw ("the bundle did not unpack cleanly up there: " + ((@($said) | Select-Object -Last 5) -join ' | '))
  }
  $done = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach ($l in @($said | Where-Object { $_ -match '^(PUT|THERE) ' })) { [void]$done.Add($l.Substring($l.IndexOf(' ') + 1)) }
  $miss = @($items.Keys | Where-Object { -not $done.Contains($_) })
  if ($miss.Count) { throw ("{0} asset(s) of the bundle are not up there: {1}" -f $miss.Count, (($miss | Select-Object -First 3) -join ', ')) }
}

# version.json through the feed store (#907): .part then renamed on the VPS,
# the one it replaces kept in history, and only while the feed and baseline up
# there are what this folder received. A folder that was never received (an
# old clone passed as -FeedDir) is checked against what is up there right now,
# which replaces whatever the site has, as this script always did.
function Send-FeedJson([string]$dir) {
  $to = @{ Vps = $Vps; User = $User; Root = $Root }
  $expect = $null
  if ($null -eq (Read-FeedStoreRead $dir)) {
    Say "  $dir was never received from the VPS, so its version.json replaces whatever the site has" 'Yellow'
    $expect = Get-FeedStoreThere $(if ($Dev) { 'dev' } else { 'main' }) @('version.json') -SiteDir $SiteDir -To $to
  }
  $r = Send-FeedStore $(if ($Dev) { 'dev' } else { 'main' }) $dir @('version.json') -SiteDir $SiteDir -To $to -Expect $expect
  return (@($r.Sent).Count -gt 0)
}

# Runs a script up there and hands back what it said. The same block every
# other script that talks to the VPS carries: under the limit it goes on the
# command line, and over it it is sent as a file and run from there, because
# sshd on Windows hands the command to cmd.exe and cmd.exe stops at 8,191
# characters.
function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

# Only the lines, and no throw when ssh has written a word to stderr.
#
# Any line ssh writes on stderr (the post-quantum warning was one on every
# connection until the box's OpenSSH 10.4, #1043), 2>&1 above folds into the
# output as an error record, and a native command that writes to stderr
# while $ErrorActionPreference is Stop is a terminating error.
# Deploy-Docs.ps1 lost a whole deploy to that once. So every remote call comes
# through here and the caller decides what the absence of an answer means.
function RemoteLines($script) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { return @(Remote $script | Where-Object { $_ -is [string] }) }
  finally { $ErrorActionPreference = $old }
}

# ConvertFrom-Json gives back an object with only the properties the file had,
# and reaching for one that is not there throws under strict mode. The same two
# readers Publish-Discord.ps1 carries, for the same reason.
function Prop($obj, $name) {
  if ($null -eq $obj) { return '' }
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p) { return '' }
  return [string]$p.Value
}
function PropList($obj, $name) {
  if ($null -eq $obj) { return @() }
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p) { return @() }
  return @($p.Value)
}

# Which urls the site is supposed to serve, and the sha256 in each one.
. (Join-Path $Here '..\release\Feed-Rules.ps1')
# Where the feed lives and how it is sent (#907).
. (Join-Path $Here '..\release\Feed-Store.ps1')

# ------------------------------------------------- -Have: what is up there --
if ($Have) {
  $asked = $false
  foreach ($l in (Get-ThereLines $false)) {
    $line = ([string]$l).Trim()
    if ($line -eq 'NOTHING THERE YET' -or $line -eq 'ASKED') { $asked = $true; continue }
    $m = [regex]::Match($line, '^([a-f0-9]{64})\|(\d+)\|')
    if ($m.Success) { $m.Groups[1].Value }
  }
  if (-not $asked) { throw "$Vps did not say what is up there in /$prefix/assets." }
  return
}

# ------------------------------------------------- -Send: these files only --
if ($PSBoundParameters.ContainsKey('Send')) {
  $files = @($Send | Where-Object { $_ })
  Head ("Sending {0} asset(s) to /{1}/assets/ on the site" -f $files.Count, $prefix)
  $byHash = [ordered]@{}
  foreach ($f in $files) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { Say "  not a file: $f" 'Red'; exit 1 }
    $h = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower()
    if (-not $byHash.Contains($h)) { $byHash[$h] = (Resolve-Path -LiteralPath $f).Path }
  }
  $upThere = @{}
  $asked = $false
  foreach ($l in (Get-ThereLines $false)) {
    $line = ([string]$l).Trim()
    if ($line -eq 'NOTHING THERE YET' -or $line -eq 'ASKED') { $asked = $true; continue }
    $m = [regex]::Match($line, '^([a-f0-9]{64})\|(\d+)\|')
    if ($m.Success) { $upThere[$m.Groups[1].Value] = [int64]$m.Groups[2].Value }
  }
  if (-not $asked) {
    Say "  $Vps did not say what is already up there, so nothing was sent." 'Red'
    Say '  Check the ssh key with scripts\vps\Setup-SshKey.ps1 -Test.' 'Yellow'
    exit 1
  }
  if ($Check) {
    foreach ($h in $byHash.Keys) {
      $state = if ($upThere.ContainsKey($h)) { 'already there' } else { 'to send      ' }
      Say ("  {0}  {1}  {2}" -f $state, $h.Substring(0, 12), (Split-Path -Leaf $byHash[$h]))
    }
    Say '  Dry run. Nothing left this machine.' 'Yellow'
    exit 0
  }
  [void](New-ThereFolders)
  $sentNow = 0
  $toSend = [ordered]@{}
  foreach ($h in $byHash.Keys) {
    $local = $byHash[$h]
    $size = (Get-Item -LiteralPath $local).Length
    if ($upThere.ContainsKey($h) -and $upThere[$h] -eq $size) {
      if ($byHash.Count -le 20) { Say ("  already there  {0}  {1}" -f $h.Substring(0, 12), (Split-Path -Leaf $local)) 'DarkGray' }
      continue
    }
    $toSend[$h] = $local
  }
  if ($toSend.Count -gt 4) {
    try { Send-AssetBundle $toSend; $sentNow = $toSend.Count }
    catch { Say "  $($_.Exception.Message)" 'Red'; exit 1 }
  } else {
    foreach ($h in @($toSend.Keys)) {
      $local = $toSend[$h]
      Say ("  {0}  {1:N1} MB  {2}" -f $h.Substring(0, 12), ((Get-Item -LiteralPath $local).Length / 1MB), (Split-Path -Leaf $local))
      try { Send-Asset $local $h }
      catch { Say "  $($_.Exception.Message)" 'Red'; exit 1 }
      $sentNow++
    }
  }
  Say ("  {0} sent, {1} already there. version.json was not touched." -f $sentNow, ($byHash.Count - $sentNow)) 'Green'
  exit 0
}

# ------------------------------------------------------------------ the feed
if (-not $FeedDir) { $FeedDir = Get-FeedStoreDir $(if ($Dev) { 'dev' } else { 'main' }) }
$versionFile = Join-Path $FeedDir 'version.json'
if (-not (Test-Path -LiteralPath $versionFile)) {
  throw ("No version.json in $FeedDir. It is received there by the first Ship or feed edit on this machine " +
         '(Feed-Store.ps1); or pass -FeedDir.')
}
# A byte order mark is not JSON, and ConvertFrom-Json stops on the first
# character with something unhelpful about a token.
$doc = ((Get-Content -LiteralPath $versionFile -Raw) -replace '^\uFEFF', '') | ConvertFrom-Json

Head "Reading $versionFile"
$packCount = @(PropList $doc 'packs').Count
Say ("  launcher {0}, {1} pack(s), for /{2}/ on the site" -f (Prop $doc 'launcherVersion'), $packCount, $prefix)

# ==== thornswood feed assets wanted ====
# tests\test-remirror-feed.ps1 runs this block on its own against a scratch
# version.json. If the markers move, it stops rather than quietly testing
# nothing. It reads $doc and $prefix and writes $need, $offSite, $wrongChannel and
# $mainNamed, and talks to nothing.
#
# Every asset the feed names that the site is supposed to serve, in feed order,
# keyed by the sha256 in its own url. A url off the site (an old GitHub one)
# is counted and left alone: this cannot mirror what it does not name by
# sha256, and Publish-Update moves such a url once the site holds its bytes.
# A dev run records a url under /feed/assets/<sha> in $mainNamed instead of
# $wrongChannel. The dev feed names those packs on purpose. The lines after
# this block say NOT MIRRORED for one only when it is neither on the site nor
# in main's store. A main run still records a /feed-dev/ url as the other
# channel, and still does not upload it.
$need = [ordered]@{}
$script:offSite = 0
$script:wrongChannel = @()
$script:mainNamed = @()
function Want([string]$url, [string]$what) {
  $u = ([string]$url).Trim()
  if (-not $u) { return }
  if (-not (Test-HostFeedAssetUrl $u)) { $script:offSite++; return }
  $m = [regex]::Match($u, '/(feed|feed-dev)/assets/([a-fA-F0-9]{64})', 'IgnoreCase')
  if (-not $m.Success) { return }
  $channel = $m.Groups[1].Value.ToLowerInvariant()
  if ($channel -ne $prefix) {
    if ($prefix -eq 'feed-dev' -and $channel -eq 'feed') {
      $sha = $m.Groups[2].Value.ToLowerInvariant()
      $script:mainNamed += ($sha + ' ' + $what)
      return
    }
    $script:wrongChannel += ("{0} is published under /{1}/" -f $what, $channel)
    return
  }
  $sha = $m.Groups[2].Value.ToLowerInvariant()
  if (-not $need.Contains($sha)) { $need[$sha] = $what }
}

Want (Prop $doc 'launcherUrl') ('launcher ' + (Prop $doc 'launcherVersion'))
if ($doc.PSObject.Properties['clientRuntime']) {
  Want (Prop $doc.clientRuntime 'url') ('client runtime ' + (Prop $doc.clientRuntime 'forkCommit'))
}
foreach ($p in (PropList $doc 'packs')) {
  if ($null -eq $p) { continue }
  Want (Prop $p 'url') ('pack ' + (Prop $p 'id'))
}
foreach ($p in (PropList $doc 'optional')) {
  if ($null -eq $p) { continue }
  Want (Prop $p 'url') ('optional pack ' + (Prop $p 'id'))
}
# The notes as a file of their own, once the channel keeps them that way
# (Feed-News.ps1, #1050).
if ($doc.PSObject.Properties['newsFile'] -and $null -ne $doc.newsFile) {
  Want (Prop $doc.newsFile 'url') 'news file'
}
# ==== end thornswood feed assets wanted ====

Say ("  {0} asset(s) named on the site, {1} still named somewhere else" -f $need.Count, $script:offSite)
foreach ($w in $script:wrongChannel) {
  Say "  NOT MIRRORED: $w, and this run is /$prefix/. Run it for that channel." 'Yellow'
}

# A dev feed names main packs under /feed/assets/<sha> on purpose: a main Ship
# resets dev to main, and a dev launcher takes those packs from /feed/. They
# are not uploaded by this run. NOT MIRRORED only when the named file is
# neither on the site under /feed/assets/ nor in main's store. -SiteDir and
# -MainStore are the stand-ins; with neither, the site check is one read of
# the main assets folder and the store is this machine's main feed store.
if (@($script:mainNamed).Count) {
  $onSite = @{}
  $shas = @($script:mainNamed | ForEach-Object { $_.Substring(0, 64) } | Select-Object -Unique)
  if ($SiteDir) {
    $mainAssets = Join-Path (Join-Path $SiteDir 'feed') 'assets'
    foreach ($s in $shas) {
      if (Test-Path -LiteralPath (Join-Path $mainAssets $s)) { $onSite[$s] = $true }
    }
  } else {
    $quoted = ($shas | ForEach-Object { "'" + $_ + "'" }) -join ','
    $look = @'
$dir = '__ROOT__\feed\assets'
foreach ($s in @(__LIST__)) {
  if (Test-Path -LiteralPath (Join-Path $dir $s)) { $s }
}
'@
    $look = $look.Replace('__ROOT__', $rootWin).Replace('__LIST__', $quoted)
    foreach ($l in @(RemoteLines $look)) {
      $t = ([string]$l).Trim().ToLowerInvariant()
      if ($t -match '^[a-f0-9]{64}$') { $onSite[$t] = $true }
    }
  }
  $storeRoot = if ($MainStore) { $MainStore } else { Get-FeedStoreDir 'main' }
  $storeAssets = Join-Path $storeRoot 'assets'
  foreach ($row in @($script:mainNamed)) {
    $sha = $row.Substring(0, 64)
    $what = $row.Substring(65)
    $inStore = Test-Path -LiteralPath (Join-Path $storeAssets $sha)
    if ($onSite.ContainsKey($sha) -or $inStore) { continue }
    Say ("  NOT MIRRORED: {0} is published under /feed/, and this run is /{1}/. It is not on the site and not in main's store." -f $what, $prefix) 'Yellow'
  }
}

# ------------------------------------------------------- what is up there --
$there = @{}
$badUpThere = @()
$askedTheVps = $false
foreach ($l in (Get-ThereLines ([bool]$Verify))) {
  $line = $l.Trim()
  if ($line -eq 'NOTHING THERE YET' -or $line -eq 'ASKED') { $askedTheVps = $true; continue }
  $m = [regex]::Match($line, '^([a-f0-9]{64})\|(\d+)\|([a-f0-9]{64})?$')
  if (-not $m.Success) { continue }
  $name = $m.Groups[1].Value
  if ($m.Groups[3].Value -and $m.Groups[3].Value -ne $name) {
    # The name IS the hash, so bytes that do not hash to it are a short or
    # damaged file that every launcher will refuse. -Verify is what looks.
    $badUpThere += $name
    continue
  }
  $there[$name] = [int64]$m.Groups[2].Value
}
if ($askedTheVps) {
  Say ("  {0} asset(s) already on the site" -f $there.Count)
  $spare = @($there.Keys | Where-Object { -not $need.Contains($_) }).Count
  if ($spare) { Say "  and $spare the current feed does not name, left alone" 'DarkGray' }
} else {
  $said = "$Vps did not say what is already up there."
  if (-not $Check) { throw ($said + ' Nothing was sent. Check the ssh key with scripts\vps\Setup-SshKey.ps1 -Test.') }
  Say "  $said The plan below assumes the site has none of it." 'Yellow'
}
foreach ($b in $badUpThere) { Say "  BAD BYTES up there, this sends them again: $b" 'Yellow' }

# ------------------------------------------------ where the bytes are here --
# The folders a publishing machine keeps assets in, cheapest to read first. A
# file named by its own sha256 is taken at its name; a .zip or .exe has to be
# hashed. Those are what Publish-Update leaves behind for the release that just
# went out (pack-<id>.zip, client-runtime-<commit>.zip) and what Build-Launcher
# leaves in the install folder (Thornswood.exe).
$gameRoot = [string](& (Join-Path $Here '..\release\Where.ps1') $(if ($Dev) { 'InstallDev' } else { 'Install' }))
$folders = @()
foreach ($d in @($AssetDir)) { if ($d) { $folders += $d } }
$folders += (Join-Path $FeedDir 'assets')
# Where.ps1 answers from the repository's layout.json. A machine where it
# cannot be asked still sends whatever -AssetDir names. With -SiteDir (the tests) only the folders
# named are read, never this machine's build output or install.
if (-not $SiteDir) {
  try {
    $folders += (& (Join-Path $Here '..\release\Where.ps1') Package)
    $folders += (& (Join-Path $Here '..\release\Where.ps1') Dist)
  } catch {
    Say "  could not ask Where.ps1 where the build output is: $_" 'DarkGray'
  }
  $folders += ($gameRoot + '\Launcher')
}
$folders = @($folders |
  Where-Object { $_ -and (Test-Path -LiteralPath $_ -ErrorAction SilentlyContinue) } |
  Select-Object -Unique)

$found = @{}
$wanted = @($need.Keys | Where-Object { -not $there.ContainsKey($_) })
# StillWanted is read as @(StillWanted).Count / $missing = @(StillWanted).
# Publish-PostShip.ps1 sets StrictMode -Version Latest and & this script, so
# StrictMode is inherited. return @() unwraps to nothing and return @('one')
# unwraps to a string; under StrictMode reading .Count on either throws
# "The property 'Count' cannot be found" (same shape as the KeepPacks tidy
# note in Publish-Update.ps1). The @() at every call site is the defence.
# Do not lead with a comma here: ,@() makes @(StillWanted).Count answer 1
# when nothing is wanted, and the script refuses to publish an empty plan.
function StillWanted { return @($wanted | Where-Object { -not $found.ContainsKey($_) }) }
foreach ($f in $folders) {
  if (-not @(StillWanted).Count) { break }
  foreach ($file in @(Get-ChildItem -LiteralPath $f -File -ErrorAction SilentlyContinue)) {
    if (-not @(StillWanted).Count) { break }
    $byName = $file.Name.ToLowerInvariant()
    if ($byName -match '^[a-f0-9]{64}$') {
      if ($wanted -contains $byName) { $found[$byName] = $file.FullName }
      continue
    }
    if ($file.Extension -notin '.zip', '.exe') { continue }
    $h = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower()
    if ($wanted -contains $h) { $found[$h] = $file.FullName }
  }
}
$missing = @(StillWanted)

# ----------------------------------------------------------------- the plan --
Head 'What this run does'
foreach ($sha in $need.Keys) {
  $short = $sha.Substring(0, 12)
  if ($there.ContainsKey($sha)) { Say ("  already there  {0}  {1}" -f $short, $need[$sha]) 'DarkGray' }
  elseif ($found.ContainsKey($sha)) { Say ("  to send        {0}  {1}" -f $short, $need[$sha]) 'Green' }
  else { Say ("  MISSING        {0}  {1}" -f $short, $need[$sha]) 'Red' }
}

if ($missing.Count -and -not $askedTheVps) {
  Say ''
  Say ("$($missing.Count) asset(s) are not on this machine, and the site was not asked, so") 'Yellow'
  Say '  some of them may already be up there. Run it again where ssh works.' 'Yellow'
  exit 0
}
if ($missing.Count) {
  Say ''
  Say ("$($missing.Count) asset(s) the feed names are neither on the site nor on this machine.") 'Red'
  Say '  Nothing was sent, because a feed pointing at a 404 stops every update.' 'Red'
  Say '  They are usually still on the machine that built them. Copy them anywhere' 'Yellow'
  Say '  and pass it as -AssetDir.' 'Yellow'
  exit 1
}
if ($Check) {
  Say ''
  Say ("Dry run. {0} asset(s) to send, then version.json to /$prefix/. Nothing left this machine." -f $found.Count) 'Yellow'
  exit 0
}

# ----------------------------------------------------------------- sending --
Head 'Making room'
foreach ($l in (New-ThereFolders)) { Say "  $l" }

$sent = 0
if ($found.Count) { Head 'Sending the assets' }
foreach ($sha in $need.Keys) {
  if (-not $found.ContainsKey($sha)) { continue }
  $local = $found[$sha]
  $size  = (Get-Item -LiteralPath $local).Length
  Say ("  {0}  {1:N1} MB  {2}" -f $sha.Substring(0, 12), ($size / 1MB), (Split-Path -Leaf $local))
  # To .part first, then renamed up there (Send-Asset says why).
  Send-Asset $local $sha
  $sent++
}

# version.json last. Everything it names is up there by now, so a launcher
# reading it the same second finds every asset it asks for.
Head 'Sending version.json'
$feedSent = Send-FeedJson $FeedDir
if (-not $feedSent) { Say '  the site already serves this version.json' 'DarkGray' }

Head 'Done'
Say ("  {0} asset(s) sent, {1} already there, version.json {2}" -f $sent, $there.Count, $(if ($feedSent) { 'published' } else { 'already there' })) 'Green'
Say "  https://thornswood.net/$prefix/version.json" 'Green'
