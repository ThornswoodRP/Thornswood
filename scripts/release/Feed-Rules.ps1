<#
  Feed-Rules.ps1

  Which packs on the update feed a launcher can actually download.
  Publish-Update.ps1 dot-sources this and refuses to add a pack that breaks the
  rule; Repair-Manifest.ps1 dot-sources it and takes the ones already on the
  feed back out. One rule, so the two can never disagree about it.

  THE RULE. A launcher reads version.json from the site feed on thornswood.net
  (until #907 it fell back to the repository the feed named as updateRepo, via
  the GitHub Contents API) and downloads every pack from the url the feed
  gives. So a pack has to be either:

    - an https asset on thornswood.net (or a subdomain), under
      /feed/assets/<sha256> or /feed-dev/assets/<sha256>, or
    - on a feed that still names an updateRepo, a release asset in it

  Anything else answers 404 to a launcher, and a pack that will not download
  stops the update, and Play stays off (Shell.cs skips a pack with NO url, but
  one whose url answers 404 fails the whole update).

  WHY IT EXISTS. Read off the releases clone on 24 September: 227 packs on the
  live feed, 164 of them (20260910-2345 to 20260914-1917) under
  /repos/EvilPatrick06/Thornswood/, the source repository, and 63 under
  Thornswood-Releases. The source repository is private and has no releases
  left at all: gh api answers 0 releases, and asset 556583849, the first of
  them, answers 404 even with Patrick's token. They were published there before
  releases moved to the public repository on 15 September, and the new feed was
  seeded from the old one with all 164 still on it. Fresh installs never notice
  because the setup seeds applied.txt with every id on the feed
  (Build-SetupFiles.ps1, read by launcher\app\InstallSteps.cs).
  A machine that loses applied.txt, or anything that replays the history, asks
  for all 164, the first one fails, and Play stays off.

  HOST CUTOVER (#649). Packs may also be served from thornswood.net under the
  locked URL shape confirmed with Website:

      https://thornswood.net/feed/version.json
      https://thornswood.net/feed-dev/version.json
      https://thornswood.net/feed/assets/<sha256>
      https://thornswood.net/feed-dev/assets/<sha256>

  Private-source GitHub assets and random hosts stay refused.

      . (Join-Path $PSScriptRoot 'Feed-Rules.ps1')
      Get-FeedRepo $doc              owner/name the feed's updateRepo names, or ''
      Get-FeedPackRepo $url          owner/name a pack url downloads from, or ''
      Test-HostFeedAssetUrl $url     true when url is a thornswood.net feed asset
      Get-HostFeedAssetUrl $sha $Dev build https://thornswood.net/feed[-dev]/assets/<sha>
      Test-FeedPackUrl $url $repo    true when a launcher can download it
      Split-FeedPacks $packs $repo   .Keep and .Drop, in feed order, each drop with .Why
      Get-FeedAssets $doc            every asset the feed names: What, Url, Sha, Bytes
      Test-SiteAsset $base $prefix $sha $bytes
                                     true when the site answers for that asset
      Move-FeedUrlsToSite $doc -Dev -OnSite { param($sha, $bytes) ... }
                                     rewrites each url the site holds to the site

  UPDATES COME FROM THE SITE (#897). Since then Publish-Update sends every new
  asset to /feed[-dev]/assets/<sha256> and writes that url, and nothing new is
  uploaded to Thornswood-Releases. The urls already on a feed move over with
  Move-FeedUrlsToSite, run by the next Ship on that channel or by
  Repair-Manifest.ps1 -MoveToSite, and only for an asset the site already
  answers for, so a feed never names a url that answers 404.

  THORNSWOOD-RELEASES GOES (#907). A publish takes updateRepo out of the feed,
  and a feed that names no updateRepo has no GitHub repository its packs may
  come from: Get-FeedRepo answers '' and every GitHub url is one a launcher
  cannot download, which is the truth once that repository is deleted. A feed
  that still names updateRepo (main until its next Ship) keeps its GitHub urls
  legal until then. Nothing here names Thornswood-Releases any more.
#>

# The repository a feed's GitHub pack urls may come from: the updateRepo the
# feed names, or '' when it names none. Until #907 a feed that named none was
# read as Thornswood-Releases, the repository Config.cs gave a fresh install;
# that default went with the repository.
function Get-FeedRepo($doc) {
    if ($null -ne $doc -and $doc.PSObject.Properties['updateRepo']) {
        $r = ([string]$doc.updateRepo).Trim()
        if ($r -match '^[^/\s]+/[^/\s]+$') { return $r }
    }
    return ''
}

# The repository a pack url downloads from, as owner/name, or '' when the url
# is not a GitHub release asset at all. Two shapes are: the API address
# Publish-Update writes, and the browser address GitHub serves the same asset
# from. Anchored at both ends, so a longer name that starts the same, or a
# query string that mentions the right one, does not pass.
function Get-FeedPackRepo([string]$url) {
    if (-not $url) { return '' }
    $u = $url.Trim()
    $m = [regex]::Match($u, '^https://api\.github\.com/repos/([^/?#\s]+/[^/?#\s]+)/releases/assets/\d+$', 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($u, '^https://github\.com/([^/?#\s]+/[^/?#\s]+)/releases/download/[^/?#\s]+/[^/?#\s]+$', 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}

# True when the url is an https pack/asset on thornswood.net (or a subdomain)
# under /feed/assets/<sha256> or /feed-dev/assets/<sha256>. Sha256 is exactly
# 64 hex digits. Query strings are allowed; fragments and other paths are not.
# Hosts that only end with the letters "thornswood.net" (evil.thornswood.net.evil)
# do not pass: the host must be thornswood.net or end with .thornswood.net.
function Test-HostFeedAssetUrl([string]$url) {
    if (-not $url) { return $false }
    $u = $url.Trim()
    $m = [regex]::Match($u,
        '^https://(?i)(?:[a-z0-9-]+\.)*thornswood\.net/(?:feed|feed-dev)/assets/[a-fA-F0-9]{64}(?:\?[^#]*)?$',
        'IgnoreCase')
    return $m.Success
}

# Build a host asset url from a sha256. Dev channel uses /feed-dev/, live uses
# /feed/. Publish-Update.ps1 and Publish-Pack.ps1 name every asset they send
# to the site by it.
function Get-HostFeedAssetUrl([string]$sha256, [switch]$Dev) {
    $sha = ([string]$sha256).Trim().ToLowerInvariant()
    if ($sha -notmatch '^[a-f0-9]{64}$') { return '' }
    $prefix = if ($Dev) { 'feed-dev' } else { 'feed' }
    return "https://thornswood.net/$prefix/assets/$sha"
}

# The default version.json urls on the site (#649). Main live vs dev channel.
function Get-HostFeedVersionUrl([switch]$Dev) {
    if ($Dev) { return 'https://thornswood.net/feed-dev/version.json' }
    return 'https://thornswood.net/feed/version.json'
}

# A pack url a launcher can download: either a GitHub release asset in $repo,
# or a thornswood.net feed asset under the locked path shape. Names on GitHub
# are not case sensitive, so neither is the repo match.
function Test-FeedPackUrl([string]$url, [string]$repo) {
    if (Test-HostFeedAssetUrl $url) { return $true }
    $r = Get-FeedPackRepo $url
    if (-not $r -or -not $repo) { return $false }
    return [string]::Equals($r, $repo.Trim(), [StringComparison]::OrdinalIgnoreCase)
}

# Every pack on a feed, split into the ones a launcher can download and the
# ones it cannot. Feed order is kept on both sides, because the launcher
# applies packs in the order the feed lists them. Each dropped one says why.
# A null entry is on neither side: there is nothing to download and nothing to
# name.
function Split-FeedPacks($packs, [string]$repo) {
    $keep = New-Object System.Collections.ArrayList
    $drop = New-Object System.Collections.ArrayList
    foreach ($p in @($packs)) {
        if ($null -eq $p) { continue }
        $url = ''
        if ($p.PSObject.Properties['url'] -and $p.url) { $url = ([string]$p.url).Trim() }
        if (-not $url) {
            [void]$drop.Add([pscustomobject]@{ Pack = $p; Repo = ''; Why = 'published with no url' })
            continue
        }
        if (Test-FeedPackUrl $url $repo) { [void]$keep.Add($p); continue }
        $r = Get-FeedPackRepo $url
        $why = if ($r -and $repo) { "held in $r, not in $repo where launchers read this feed" }
               elseif ($r) { "held in $r on GitHub, and launchers download only from the site now" }
               else    { 'not a thornswood.net feed asset url' }
        [void]$drop.Add([pscustomobject]@{ Pack = $p; Repo = $r; Why = $why })
    }
    return [pscustomobject]@{ Keep = @($keep.ToArray()); Drop = @($drop.ToArray()) }
}

# ---------------------------------------------------------------- #897 --
# Every asset a feed names, in feed order: the launcher, the client runtime,
# each pack, each optional pack. Each is What (a line a person can read), Url,
# Sha (lowercase, '' when the feed gives none) and Bytes (0 when the feed does
# not say). Kind and Ref say where in the document it sits, so the url can be
# written back. A null entry, or one with no url, is left out.
function Get-FeedAssets($doc) {
    $out = New-Object System.Collections.ArrayList
    if ($null -eq $doc) { return @() }
    function One($obj, [string]$urlName, [string]$shaName, [string]$what, [string]$kind) {
        if ($null -eq $obj) { return }
        $u = ''
        if ($obj.PSObject.Properties[$urlName]) { $u = ([string]$obj.$urlName).Trim() }
        if (-not $u) { return }
        $s = ''
        if ($obj.PSObject.Properties[$shaName]) { $s = ([string]$obj.$shaName).Trim().ToLowerInvariant() }
        if ($s -notmatch '^[a-f0-9]{64}$') { $s = '' }
        $n = [int64]0
        if ($obj.PSObject.Properties['bytes']) { try { $n = [int64]$obj.bytes } catch { $n = 0 } }
        [void]$out.Add([pscustomobject]@{ What = $what; Url = $u; Sha = $s; Bytes = $n; Kind = $kind; Ref = $obj; UrlName = $urlName })
    }
    One $doc 'launcherUrl' 'launcherSha256' ('launcher ' + [string]$(if ($doc.PSObject.Properties['launcherVersion']) { $doc.launcherVersion } else { '' })) 'launcher'
    if ($doc.PSObject.Properties['clientRuntime'] -and $null -ne $doc.clientRuntime) {
        $fc = if ($doc.clientRuntime.PSObject.Properties['forkCommit']) { [string]$doc.clientRuntime.forkCommit } else { '' }
        One $doc.clientRuntime 'url' 'sha256' ('client runtime ' + $fc) 'client'
    }
    foreach ($list in 'packs', 'optional') {
        if (-not $doc.PSObject.Properties[$list] -or $null -eq $doc.$list) { continue }
        foreach ($p in @($doc.$list)) {
            if ($null -eq $p) { continue }
            $id = if ($p.PSObject.Properties['id']) { [string]$p.id } else { '' }
            $label = if ($list -eq 'optional') { 'optional pack ' } else { 'pack ' }
            One $p 'url' 'sha256' ($label + $id) $list
        }
    }
    return @($out.ToArray())
}

# True when the site answers 200 for /<prefix>/assets/<sha> under $base
# (https://thornswood.net, or a local copy in the tests), and, when the feed
# says how big it is, with that many bytes. A HEAD request, so nothing is
# downloaded. Anything else, an error included, is false: the caller then
# leaves the url where it was, which is the safe way round.
function Test-SiteAsset([string]$base, [string]$prefix, [string]$sha, [int64]$bytes = 0) {
    if ($sha -notmatch '^[a-f0-9]{64}$') { return $false }
    $url = $base.TrimEnd('/') + '/' + $prefix + '/assets/' + $sha
    $res = $null
    try {
        $req = [Net.HttpWebRequest]::Create($url)
        $req.Method = 'HEAD'
        $req.Timeout = 20000
        $req.UserAgent = 'Thornswood-Publish'
        $req.AllowAutoRedirect = $false
        $res = $req.GetResponse()
        if ([int]$res.StatusCode -ne 200) { return $false }
        if ($bytes -gt 0 -and $res.ContentLength -ge 0 -and $res.ContentLength -ne $bytes) { return $false }
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $res) { $res.Close() }
    }
}

# Rewrites every url on the feed that is not already a site asset to
# https://thornswood.net/feed[-dev]/assets/<sha256>, but only where $OnSite
# says the site holds those bytes. $OnSite is called with the sha and the
# size the feed gives (0 when it gives none). A url with no sha on the feed
# is left alone, since there is nothing to name it by. Returns what moved and
# what stayed, each a list of Get-FeedAssets entries, in feed order.
function Move-FeedUrlsToSite($doc, [switch]$Dev, [scriptblock]$OnSite) {
    $moved = New-Object System.Collections.ArrayList
    $stayed = New-Object System.Collections.ArrayList
    foreach ($a in @(Get-FeedAssets $doc)) {
        if (Test-HostFeedAssetUrl $a.Url) { continue }
        if (-not $a.Sha) { [void]$stayed.Add($a); continue }
        $yes = $false
        try { $yes = [bool](& $OnSite $a.Sha $a.Bytes) } catch { $yes = $false }
        if (-not $yes) { [void]$stayed.Add($a); continue }
        $a.Ref.($a.UrlName) = (Get-HostFeedAssetUrl $a.Sha -Dev:$Dev)
        [void]$moved.Add($a)
    }
    return [pscustomobject]@{ Moved = @($moved.ToArray()); Stayed = @($stayed.ToArray()) }
}
