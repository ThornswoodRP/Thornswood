<#
  Release-Baseline.ps1

  What a release is diffed against, and the record each release publishes of
  what it left installed (#441).

      . (Join-Path $PSScriptRoot 'Release-Baseline.ps1')

  WHY IT EXISTS. A release is the difference between this build and the last
  one published. Until #441 "the last one published" was published.json, a map
  of every file of ours to '<bytes>:<LastWriteTimeUtc.Ticks>' as the machine
  that last shipped saw it. Since #907 that file sits on the VPS beside the
  feed, so every machine reads the same one, but what it records is still one
  machine's memory: a file time. The same bytes on another machine, after a
  reinstall, or rewritten in place with the same content (hotfix 1.1.93 sent
  21 unchanged files, 12.5 MB, for exactly that) all read as changed. And when
  the store copy was missing the only way on was -Baseline, which records this
  build as already published whatever the feed really holds.

  So:
    - An entry is '<bytes>:<sha256>' of the file's own bytes (Get-BaselineEntry).
      The same bytes give the same entry on any machine.
    - An old '<bytes>:<ticks>' entry still compares the way it always did, the
      size and the file time, so the first release after the switch does not
      send the whole build again (Test-BaselineSame). Its new entry is a hash.
    - Every release writes the whole map as a file (ConvertTo-BaselineJson:
      sorted, ASCII, one shape on Windows PowerShell and PowerShell 7, so two
      runs over the same tree give the same bytes), sends it to the site as an
      asset like a pack (/feed[-dev]/assets/<sha256>), and names it in
      version.json as "baseline": { id, sha256, url, entries }. published.json
      in the store is written from the same map, so it has the same sha256.
    - Resolve-ReleaseBaseline decides what to diff against, in this order:
        1. the feed names a baseline and the store copy has its sha256: the
           store copy.
        2. the feed names one and the store copy is missing or is not it (a
           baseline send that failed, a feed put back by hand): that file,
           fetched from the site and checked against its sha256.
        3. the feed names none yet (feeds published before #441) and the store
           has one: the store copy, as before.
        4. otherwise: rebuilt by replaying every pack the feed lists, in order,
           from the site: each game file a pack carries at the size and sha256
           it carried it, each delete.txt line taken out. A file that never
           went out in a pack is missing from that and is sent again, so it can
           only send too much, never too little.
      The feed is what launchers install, so it wins over any copy on a disk.

  Every release's record also stays named in the feed, newest first, as
  "releases" (Add-FeedRelease), so Rollback-Feed.ps1 can put a channel back to
  one of them (#442).

  -SiteDir <folder> stands in for C:\Thornswood-Docs (the folder holding feed\
  and feed-dev\): assets are read from <folder>\<feed>\assets\<sha256> and
  nothing connects anywhere. Otherwise they are fetched from -SiteUrl over
  https, which needs no ssh. tests\test-release-baseline.ps1 drives it.
#>

. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named
function Get-BaselineHex([byte[]]$bytes) {
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Get-BaselineStreamSha([IO.Stream]$stream) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (Get-BaselineHex ($h.ComputeHash($stream))) }
    finally { $h.Dispose() }
}

function Get-BaselineFileSha([string]$path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return '' }
    $s = [IO.File]::Open((Resolve-Path -LiteralPath $path).ProviderPath, 'Open', 'Read', 'ReadWrite')
    try { return (Get-BaselineStreamSha $s) }
    finally { $s.Dispose() }
}

# One file's entry: its length and the sha256 of its bytes.
function Get-BaselineEntry([string]$path) {
    $s = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try { return ('{0}:{1}' -f $s.Length, (Get-BaselineStreamSha $s)) }
    finally { $s.Dispose() }
}

# '<bytes>:<ticks>', what published.json held until #441.
function Test-BaselineLegacy([string]$value) {
    return ([string]$value -match '^\d+:\d+$')
}

# Whether the file behind $now is the one $prev recorded. A hash entry is
# compared as it is. An old size and time entry is compared the way it was
# written: same size and same file time. $file is the file itself.
function Test-BaselineSame([string]$prev, [string]$now, $file) {
    if ($prev -eq $now) { return $true }
    if ($null -eq $file -or -not (Test-BaselineLegacy $prev)) { return $false }
    $p = $prev.Split(':')
    return ([int64]$p[0] -eq [int64]$file.Length) -and ([int64]$p[1] -eq [int64]$file.LastWriteTimeUtc.Ticks)
}

function ConvertTo-BaselineString([string]$s) {
    $e = [regex]::Replace($s, '[\\"\x00-\x1f\x7f-\uffff]', {
        param($m)
        $c = [int][char]$m.Value
        if ($c -eq 0x5C) { return '\\' }
        if ($c -eq 0x22) { return '\"' }
        return ('\u{0:x4}' -f $c)
    })
    return ('"' + $e + '"')
}

# The map as JSON, keys in ordinal order, ASCII only, no spaces, so the same
# map is the same bytes whichever PowerShell writes it.
function ConvertTo-BaselineJson($map) {
    $keys = [string[]]@($map.Keys)
    [Array]::Sort($keys, [StringComparer]::Ordinal)
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append('{')
    for ($i = 0; $i -lt $keys.Length; $i++) {
        if ($i) { [void]$sb.Append(',') }
        [void]$sb.Append((ConvertTo-BaselineString $keys[$i]))
        [void]$sb.Append(':')
        [void]$sb.Append((ConvertTo-BaselineString ([string]$map[$keys[$i]])))
    }
    [void]$sb.Append('}')
    return $sb.ToString()
}

# Writes the map and hands back the sha256 of what was written.
function Write-BaselineFile($map, [string]$path) {
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [IO.File]::WriteAllText($path, (ConvertTo-BaselineJson $map), (New-Object Text.ASCIIEncoding))
    return (Get-BaselineFileSha $path)
}

function Read-BaselineFile([string]$path) {
    $map = @{}
    $text = ([IO.File]::ReadAllText($path)) -replace '^\uFEFF', ''
    if (-not $text.Trim()) { return $map }
    $o = ConvertFrom-ThornswoodJson $text $path
    if ($null -ne $o) { foreach ($p in $o.PSObject.Properties) { $map[$p.Name] = [string]$p.Value } }
    return $map
}

# The "baseline" the feed names, or $null when it names none. Throws on one
# this script did not write, rather than guessing past it.
function Get-FeedBaselinePointer($doc) {
    if ($null -eq $doc -or -not $doc.PSObject.Properties['baseline'] -or $null -eq $doc.baseline) { return $null }
    $b = $doc.baseline
    $sha = ''; $url = ''
    if ($b.PSObject.Properties['sha256']) { $sha = ([string]$b.sha256).ToLowerInvariant() }
    if ($b.PSObject.Properties['url']) { $url = [string]$b.url }
    if ($sha -notmatch '^[0-9a-f]{64}$' -or -not $url) {
        throw 'The feed names a baseline without a sha256 and a url, so what was last published cannot be read from it.'
    }
    return $b
}

# $Notes is the release note, Ship's whole note, title first. A launcher that
# syncs to the record shows "notes" on its update card (Sync.cs RecordDue,
# #1050): once the packs are off the feed, their notes field is gone with them,
# and this is where the card reads it instead. Only the title goes here. The
# whole note is the newest entry of the news file the News tab reads, and on
# the card it was most of version.json (2,956 of main's 4,928 bytes on 19 Oct)
# and its 29 lines of text above Play. Left out when there is none.
function New-FeedBaselinePointer([string]$Id, [string]$Sha, [string]$Url, [int]$Entries, [string]$Notes = '') {
    $o = [ordered]@{ id = $Id; sha256 = $Sha.ToLowerInvariant(); url = $Url; entries = $Entries }
    $title = @(([string]$Notes -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ }) | Select-Object -First 1
    if ($title) { $o['notes'] = $title }
    return [pscustomobject]$o
}

# ---- when the packs can go (#1050) -------------------------------------------
#
# Every launcher from the first one built with launcher\app\Sync.cs (#1154,
# merged 29 Sep as 854aeeed) syncs the install to the release record and never
# replays a pack: Updater.Pending offers the record and Sync marks every pack on
# the feed applied without fetching one. So the packs are on the feed only for
# launchers older than that, and those are below minLauncher on both channels:
# Play is held for them and the site refuses them a join pass (#937). What they
# can still do is update, and that never needed a pack: with no pack waiting
# they are offered the launcher, take it through the signed self-update, and
# the new one syncs. The first launcher with Sync.cs on each channel, read off
# the release tags (git tag -l 'release/*' with the launcher each names):
#   main  1.1.103    release/main/20261001-180012, the first main release after 854aeeed
#   dev   1.1.102.8  release/dev/20260929-1129-dev; 1.1.102.7 the release before it had none
# From the first release whose channel's minLauncher is at or above that
# number, and whose last record already said every file of its own was on the
# site (so its :gone: list carries what the packs took out, started from them),
# the feed carries "packs": [] and no release adds one. [] rather than leaving
# the field out: an empty list is a shape every launcher ever published reads.
$FeedFirstSyncLauncher = @{ main = '1.1.103'; dev = '1.1.102.8' }

# Two dotted versions compared part by part, the way Updater.IsNewer reads
# them: 1, 0 or -1. $null when either is not digits and dots.
function Compare-FeedVersion([string]$a, [string]$b) {
    if ([string]$a -notmatch '^\d+(\.\d+)*$' -or [string]$b -notmatch '^\d+(\.\d+)*$') { return $null }
    $x = @($a.Split('.') | ForEach-Object { [int64]$_ })
    $y = @($b.Split('.') | ForEach-Object { [int64]$_ })
    for ($i = 0; $i -lt [Math]::Max($x.Count, $y.Count); $i++) {
        $u = if ($i -lt $x.Count) { $x[$i] } else { [int64]0 }
        $v = if ($i -lt $y.Count) { $y[$i] } else { [int64]0 }
        if ($u -ne $v) { if ($u -gt $v) { return 1 } else { return -1 } }
    }
    return 0
}

# True when every launcher the channel lets into the game ($MinLauncher, the
# feed's minLauncher once this edit is out) syncs to the record, so the feed
# need carry no pack. False for a minimum that is not a version.
function Test-FeedPacksGone([string]$Channel, [string]$MinLauncher) {
    $first = if ($Channel -eq 'dev') { $FeedFirstSyncLauncher['dev'] } else { $FeedFirstSyncLauncher['main'] }
    $c = Compare-FeedVersion ([string]$MinLauncher).Trim() $first
    return ($null -ne $c -and $c -ge 0)
}

# ---- every release's record, so a channel can be put back (#442) -------------
#
# The record each release published, newest first, each with lastPack: the id
# of the last pack on the feed once that release was out, which is the pack
# holding the plugin list it shipped ('' once the packs are gone; the record's
# own :golden: entries hold it then). Publish-Update adds one per release (the
# release list block); Rollback-Feed.ps1 reads them to put the channel back to
# one of them, and Scrub-Feed.ps1 rewrites the ones it scrubs. No launcher reads
# it. The newest $FeedReleasesKeep are kept: about 200 bytes each.
#
# WHERE IT IS KEPT (#1050). Until 12 Oct it was "releases" in version.json,
# about 8 KB of a feed every launcher reads every thirty seconds, for scripts
# only. It is releases.json in the channel's store on the VPS now, beside
# published.json, received and sent through Feed-Store.ps1 with the feed and
# never served (site\server.js answers only version.json and assets). A feed
# that still carries "releases" (one written before this, or by a Ship from a
# branch without it) is read as well and merged by id, and the next write takes
# it out of the feed.
$FeedReleasesKeep = 30
$FeedReleasesFile = 'releases.json'

# The id of the last pack on the feed, or '' when it lists none.
function Get-FeedLastPackId($doc) {
    if ($null -eq $doc -or -not $doc.PSObject.Properties['packs'] -or -not $doc.packs) { return '' }
    $all = @($doc.packs)
    for ($i = $all.Count - 1; $i -ge 0; $i--) {
        $p = $all[$i]
        if ($null -ne $p -and $p.PSObject.Properties['id'] -and [string]$p.id) { return [string]$p.id }
    }
    return ''
}

# The records the feed lists, newest first. An entry without an id, a sha256
# and a url is not one this script wrote and is left out.
function Get-FeedReleases($doc) {
    $out = New-Object System.Collections.Generic.List[object]
    if ($null -eq $doc -or -not $doc.PSObject.Properties['releases'] -or $null -eq $doc.releases) { return $out.ToArray() }
    foreach ($r in @($doc.releases)) {
        if ($null -eq $r) { continue }
        $id  = if ($r.PSObject.Properties['id']) { [string]$r.id } else { '' }
        $sha = if ($r.PSObject.Properties['sha256']) { ([string]$r.sha256).ToLowerInvariant() } else { '' }
        $url = if ($r.PSObject.Properties['url']) { [string]$r.url } else { '' }
        if (-not $id -or $sha -notmatch '^[0-9a-f]{64}$' -or -not $url) { continue }
        $out.Add($r)
    }
    return $out.ToArray()
}

function New-FeedReleaseEntry($Pointer, [string]$LastPack, [string]$To) {
    $o = [ordered]@{ id = [string]$Pointer.id; sha256 = ([string]$Pointer.sha256).ToLowerInvariant(); url = [string]$Pointer.url
                     entries = [int]$Pointer.entries; lastPack = $LastPack }
    if ($To) { $o['to'] = $To }
    return [pscustomobject]$o
}

# When a release id says it was made, as yyyyMMddHHmmss, for putting two lists
# in one order: ids are yyyyMMdd-HHmmss since #1057 and yyyyMMdd-HHmm before,
# -dev on dev. '' for an id of any other shape.
function Get-FeedReleaseTimeKey([string]$Id) {
    $m = [regex]::Match([string]$Id, '^(\d{8})-(\d{4})(\d{2})?(?:$|-)')
    if (-not $m.Success) { return '' }
    $s = if ($m.Groups[3].Success) { $m.Groups[3].Value } else { '00' }
    return ($m.Groups[1].Value + $m.Groups[2].Value + $s)
}

# The list as the store keeps it, in the channel's working folder $Dir
# (Feed-Store.ps1), merged with any "releases" the feed $doc still carries:
# one entry per id, the store's copy first, newest first by the time in the id
# (both lists are in that order already; a rollback's id is the time it ran).
# Never throws on a missing file; a store file that is not a JSON list is
# named, because reading it as empty would lose every release it holds.
function Get-StoreReleases([string]$Dir, $doc) {
    $mine = @()
    $f = if ($Dir) { Join-Path $Dir $FeedReleasesFile } else { '' }
    if ($f -and (Test-Path -LiteralPath $f -PathType Leaf)) {
        $text = ([IO.File]::ReadAllText($f)).TrimStart([char]0xFEFF)
        if ($text.Trim()) {
            $o = ConvertFrom-ThornswoodJson $text $f
            $mine = @(Get-FeedReleases ([pscustomobject]@{ releases = @($o) }))
        }
    }
    $theirs = @(Get-FeedReleases $doc)
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $rows = New-Object System.Collections.Generic.List[object]
    $at = 0
    foreach ($r in @($mine) + @($theirs)) {
        if (-not $seen.Add([string]$r.id)) { continue }
        $rows.Add([pscustomobject]@{ Key = (Get-FeedReleaseTimeKey ([string]$r.id)); At = $at; R = $r })
        $at++
    }
    return @($rows | Sort-Object @{ Expression = 'Key'; Descending = $true }, @{ Expression = 'At'; Descending = $false } | ForEach-Object { $_.R })
}

# Writes the list into the store's working folder, as a JSON list, with no
# byte order mark, for Send-FeedStore to send beside version.json.
function Save-StoreReleases([string]$Dir, $List) {
    $f = Join-Path $Dir $FeedReleasesFile
    $json = ConvertTo-Json -InputObject @($List) -Depth 4
    if (-not @($List).Count) { $json = '[]' }
    [IO.File]::WriteAllText($f, $json, (New-Object Text.UTF8Encoding($false)))
}

# Takes "releases" out of the feed once the store holds them.
function Remove-FeedReleasesField($doc) {
    if ($null -ne $doc -and $doc.PSObject.Properties['releases']) { $doc.PSObject.Properties.Remove('releases') }
}

# Puts this release's record at the front of the list and keeps the newest
# $Keep. Called BEFORE the feed's "baseline" is replaced: a feed that names a
# baseline and no list yet (the first release after #442) starts the list with
# that baseline, whose release ended at $LastPackBefore, the last pack on the
# feed before this release added its own. $To names the release a rollback put
# the channel back to. With $Dir (the channel's store working folder) the list
# is the store's, merged with what the feed still carries, it is written there
# as releases.json and "releases" comes out of the feed; without it the list
# stays in the feed, as it was until #1050.
function Add-FeedRelease($doc, $Pointer, [string]$LastPack, [string]$LastPackBefore, [string]$To, [int]$Keep = $FeedReleasesKeep, [string]$Dir = '') {
    # Wrapped whole: an if hands its output back one item at a time, so one
    # release would come back as that object, not a list of one.
    $list = @(if ($Dir) { Get-StoreReleases $Dir $doc } else { Get-FeedReleases $doc })
    if (-not $list.Count) {
        $old = $null
        try { $old = Get-FeedBaselinePointer $doc } catch { $old = $null }
        if ($null -ne $old -and [string]$old.id -ne [string]$Pointer.id) { $list = @(New-FeedReleaseEntry $old $LastPackBefore '') }
    }
    $list = @(New-FeedReleaseEntry $Pointer $LastPack $To) + @($list | Where-Object { [string]$_.id -ne [string]$Pointer.id })
    if ($Keep -gt 0 -and $list.Count -gt $Keep) { $list = @($list[0..($Keep - 1)]) }
    if ($Dir) {
        Save-StoreReleases $Dir $list
        Remove-FeedReleasesField $doc
    } elseif ($doc.PSObject.Properties['releases']) { $doc.releases = $list }
    else { $doc | Add-Member -NotePropertyName 'releases' -NotePropertyValue $list }
    return $list
}

# One site asset into $Part. The site answers /feed[-dev]/assets/<sha256>
# either with the bytes or, when a published GitHub Release holds the file
# (site/lib/feed.js, RELEASE_DOWNLOAD), with a redirect to that Release's
# github.com/<owner>/<repo>/releases/download/<tag>/<name>. That is GitHub's
# web route. From 05:11 UTC on 9 Nov it answered 504 from its iad edge for
# every repository, measured from One, the VPS, the Oracle VM and a
# GitHub-hosted runner, while api.github.com served the same assets. Two merge
# releases stopped on it while staging dev's last release. So the site is only
# asked where the file is, and a Release's copy comes through the REST API's
# asset route (Save-ReleaseAsset), which does not go through that web route.
function Save-SiteAsset([string]$Url, [string]$Part) {
    Add-Type -AssemblyName System.Net.Http
    $h = [Net.Http.HttpClientHandler]::new()
    $h.AllowAutoRedirect = $false
    $c = [Net.Http.HttpClient]::new($h)
    $c.Timeout = [TimeSpan]::FromMinutes(10)
    [void]$c.DefaultRequestHeaders.UserAgent.TryParseAdd('Thornswood-Publish')
    try {
        $r = $c.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $code = [int]$r.StatusCode
        if ($code -eq 200) {
            $in = $r.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $out = [IO.File]::Create($Part)
            try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() }
            return
        }
        $loc = if ($null -ne $r.Headers.Location) { [string]$r.Headers.Location.AbsoluteUri } else { '' }
        if ($code -ge 300 -and $code -lt 400 -and $loc) {
            $m = [regex]::Match($loc, '^https://github\.com/([^/]+)/([^/]+)/releases/download/(.+)/([^/?#]+)$')
            if (-not $m.Success) { throw "the site sent it to $loc, which is not a GitHub Release's file" }
            Save-ReleaseAsset $m.Groups[1].Value $m.Groups[2].Value ([uri]::UnescapeDataString($m.Groups[3].Value)) ([uri]::UnescapeDataString($m.Groups[4].Value)) $Part
            return
        }
        throw "the site answered $code"
    }
    finally { $c.Dispose() }
}

# The REST API's answers about one Release's files: "<owner>/<repo>/<tag>" ->
# @{ <name> = <asset id> }, asked once per Release for each run.
$script:ReleaseAssetIds = @{}

# A Release's file through the REST API: the Release by its tag, the asset by
# its name, then /releases/assets/<id> as application/octet-stream, which
# answers with GitHub's storage. Signed in with GH_TOKEN (or GITHUB_TOKEN, or
# gh's own sign in) when there is one: a release has hundreds of files, and
# GitHub allows sixty unsigned calls an hour. Invoke-WebRequest drops the
# Authorization header on the redirect to storage, which is another host.
function Save-ReleaseAsset([string]$Owner, [string]$Repo, [string]$Tag, [string]$Name, [string]$Part) {
    $api = 'https://api.github.com/repos/' + $Owner + '/' + $Repo
    $headers = @{ 'User-Agent' = 'Thornswood-Publish'; 'X-GitHub-Api-Version' = '2022-11-28' }
    $token = [string]$env:GH_TOKEN
    if (-not $token) { $token = [string]$env:GITHUB_TOKEN }
    if (-not $token -and (Get-Command gh -ErrorAction SilentlyContinue)) { $token = [string](& gh auth token 2>$null) }
    if ($token) { $headers['Authorization'] = 'Bearer ' + $token.Trim() }
    $key = "$Owner/$Repo/$Tag"
    if (-not $script:ReleaseAssetIds.ContainsKey($key)) {
        $rel = Invoke-RestMethod -Uri ($api + '/releases/tags/' + $Tag) -Headers ($headers + @{ Accept = 'application/vnd.github+json' })
        $ids = @{}
        for ($page = 1; $page -le 20; $page++) {
            # Through the pipeline, which hands the array's items over one by
            # one: PowerShell 7's Invoke-RestMethod returns a JSON array whole.
            $got = @(Invoke-RestMethod -Uri ($api + '/releases/' + $rel.id + '/assets?per_page=100&page=' + $page) -Headers ($headers + @{ Accept = 'application/vnd.github+json' }) | ForEach-Object { $_ })
            foreach ($a in $got) { if ([string]$a.state -eq 'uploaded') { $ids[[string]$a.name] = [long]$a.id } }
            if ($got.Count -lt 100) { break }
        }
        $script:ReleaseAssetIds[$key] = $ids
    }
    $ids = $script:ReleaseAssetIds[$key]
    if (-not $ids.ContainsKey($Name)) { throw "the GitHub Release $Tag holds no file named $Name" }
    Invoke-WebRequest -Uri ($api + '/releases/assets/' + $ids[$Name]) -Headers ($headers + @{ Accept = 'application/octet-stream' }) -OutFile $Part -UseBasicParsing | Out-Null
}

# Fetches one asset by the url the feed gives it, from the site or from
# -SiteDir, into $Dest, and refuses bytes that are not the sha256 they are
# named by. Only /feed[-dev]/assets/<sha256> urls: that is where every asset
# the feed names has lived since #897.
function Get-FeedAssetFile([string]$Url, [string]$Sha, [string]$Dest, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net') {
    $m = [regex]::Match([string]$Url, '/(feed|feed-dev)/assets/([0-9a-fA-F]{64})(?:[?#].*)?$')
    if (-not $m.Success) { throw "$Url is not an asset on the site, so it cannot be read back." }
    $prefix = $m.Groups[1].Value
    $name = $m.Groups[2].Value.ToLowerInvariant()
    if ($Sha -and $name -ne $Sha.ToLowerInvariant()) { throw "$Url is not the asset its sha256 names." }
    $dir = Split-Path -Parent $Dest
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $part = $Dest + '.part'
    Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
    if ($SiteDir) {
        $src = Join-Path (Join-Path (Join-Path $SiteDir $prefix) 'assets') $name
        if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "The site has no /$prefix/assets/$name." }
        Copy-Item -LiteralPath $src -Destination $part -Force
    } else {
        try { Save-SiteAsset ($SiteUrl.TrimEnd('/') + '/' + $prefix + '/assets/' + $name) $part }
        catch { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue; throw ("/$prefix/assets/$name could not be fetched from $SiteUrl" + ': ' + $_.Exception.Message) }
    }
    $got = Get-BaselineFileSha $part
    if ($got -ne $name) {
        Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
        throw "/$prefix/assets/$name on the site is not the bytes its name says (they hash to $got)."
    }
    Move-Item -LiteralPath $part -Destination $Dest -Force
    return $Dest
}

# ---- a release's files, each on the site by its own sha256 (#1050) -----------
#
# Since #1050 a launcher syncs the install to the record the feed names instead
# of replaying packs: it compares every file of ours with the record and
# downloads only the ones that differ, from the folder the record itself is in
# (/feed[-dev]/assets/<sha256> of each file). A record carries:
#   '<path>'              '<bytes>:<sha256>'  a file of ours in the game folder
#   ':golden:plugins.txt' '<bytes>:<sha256>'  the reference plugin list as a pack
#   ':golden:loadorder.txt'                   carries it, into Profile\Default
#   ':gone:<path>'        'removed'           a file of ours a release stopped
#                                             shipping; left alone on a machine
#                                             whose Vortex deploys that path now
#                         'always'            Ship-Rules' delete list, taken out
#                                             whatever put it there
#                         '<sha256>'          another author's file we once
#                                             shipped (#1261, #1178): taken out
#                                             only while it still has those
#                                             bytes and Vortex does not deploy it
#   ':record:files'       '1'                 every file above is on the site
#                                             beside the record. Without it (every
#                                             record before #1050) a launcher
#                                             takes the packs instead.
# plus the keys that were already there (:profile:, :order:, :src:), which no
# launcher reads.
$RecordFilesKey = ':record:files'

# The files a record names that a launcher downloads: sha256 to size, for the
# game files and the plugin list.
function Get-RecordFileShas($map) {
    $out = @{}
    foreach ($k in @($map.Keys)) {
        if ($k.StartsWith(':') -and -not $k.StartsWith(':golden:')) { continue }
        $m = [regex]::Match([string]$map[$k], '^(\d+):([0-9a-f]{64})$')
        if ($m.Success) { $out[$m.Groups[2].Value] = [int64]$m.Groups[1].Value }
    }
    return $out
}

# The address of one file beside a record: the record's own url with its sha256
# swapped for the file's. '' when the url is not an asset on the site.
function Get-RecordFileUrl([string]$RecordUrl, [string]$Sha) {
    $m = [regex]::Match([string]$RecordUrl, '^(.*/(?:feed|feed-dev)/assets/)[0-9a-fA-F]{64}(?:[?#].*)?$')
    if (-not $m.Success) { return '' }
    return ($m.Groups[1].Value + $Sha.ToLowerInvariant())
}

# Some bytes of one asset: $Count from $From, or the last $Count when $From is
# negative. From -SiteDir by seeking the file, otherwise with an https Range
# request. Hands back @{ Bytes; Start }.
function Get-FeedAssetRange([string]$Url, [int64]$From, [int64]$Count, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net') {
    $m = [regex]::Match([string]$Url, '/(feed|feed-dev)/assets/([0-9a-fA-F]{64})(?:[?#].*)?$')
    if (-not $m.Success) { throw "$Url is not an asset on the site." }
    $prefix = $m.Groups[1].Value; $name = $m.Groups[2].Value.ToLowerInvariant()
    if ($SiteDir) {
        $fs = [IO.File]::OpenRead((Join-Path (Join-Path (Join-Path $SiteDir $prefix) 'assets') $name))
        try {
            $start = if ($From -lt 0) { [Math]::Max([int64]0, $fs.Length - $Count) } else { $From }
            $n = [int][Math]::Min($Count, $fs.Length - $start)
            $buf = New-Object byte[] $n
            $fs.Position = $start
            $got = 0
            while ($got -lt $n) { $r = $fs.Read($buf, $got, $n - $got); if ($r -le 0) { break }; $got += $r }
            return @{ Bytes = $buf; Start = $start }
        } finally { $fs.Dispose() }
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $req = [Net.HttpWebRequest]::Create($SiteUrl.TrimEnd('/') + '/' + $prefix + '/assets/' + $name)
    $req.UserAgent = 'Thornswood-Publish'
    if ($From -lt 0) { $req.AddRange([int64](-$Count)) } else { $req.AddRange([int64]$From, [int64]($From + $Count - 1)) }
    $resp = $req.GetResponse()
    try {
        if ([int]$resp.StatusCode -ne 206) { throw "/$prefix/assets/$name did not answer a range request" }
        $cr = [regex]::Match([string]$resp.Headers['Content-Range'], 'bytes (\d+)-(\d+)/')
        if (-not $cr.Success) { throw "/$prefix/assets/$name answered a range without saying which" }
        $ms = New-Object IO.MemoryStream
        $s = $resp.GetResponseStream()
        try { $s.CopyTo($ms) } finally { $s.Dispose() }
        return @{ Bytes = $ms.ToArray(); Start = [int64]$cr.Groups[1].Value }
    } finally { $resp.Close() }
}

# The lines of delete.txt in one pack on the site, reading only the zip's
# directory and that one entry, not the whole pack. @() when it has none.
function Get-FeedPackDeleteLines($Pack, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net') {
    $url = [string]$Pack.url
    $tail = Get-FeedAssetRange $url -1 66000 $SiteDir $SiteUrl
    $b = [byte[]]$tail.Bytes
    $eocd = -1
    for ($i = $b.Length - 22; $i -ge 0; $i--) { if ($b[$i] -eq 0x50 -and $b[$i + 1] -eq 0x4b -and $b[$i + 2] -eq 5 -and $b[$i + 3] -eq 6) { $eocd = $i; break } }
    if ($eocd -lt 0) { throw "pack $([string]$Pack.id) is not a zip" }
    $cdSize = [int64][BitConverter]::ToUInt32($b, $eocd + 12)
    $cdOff = [int64][BitConverter]::ToUInt32($b, $eocd + 16)
    if ($cdOff -ge $tail.Start) { $cd = $b; $at = [int]($cdOff - $tail.Start) }
    else { $cd = [byte[]](Get-FeedAssetRange $url $cdOff $cdSize $SiteDir $SiteUrl).Bytes; $at = 0 }
    $end = $at + $cdSize
    while ($at + 46 -le $end -and [BitConverter]::ToUInt32($cd, $at) -eq 0x02014b50) {
        $method = [BitConverter]::ToUInt16($cd, $at + 10)
        $csize = [int64][BitConverter]::ToUInt32($cd, $at + 20)
        $nlen = [BitConverter]::ToUInt16($cd, $at + 28); $xlen = [BitConverter]::ToUInt16($cd, $at + 30); $clen = [BitConverter]::ToUInt16($cd, $at + 32)
        $loff = [int64][BitConverter]::ToUInt32($cd, $at + 42)
        $name = [Text.Encoding]::UTF8.GetString($cd, $at + 46, $nlen)
        if ($name -eq 'delete.txt') {
            $lh = [byte[]](Get-FeedAssetRange $url $loff 30 $SiteDir $SiteUrl).Bytes
            $skip = 30 + [BitConverter]::ToUInt16($lh, 26) + [BitConverter]::ToUInt16($lh, 28)
            $data = [byte[]]@()
            if ($csize -gt 0) { $data = [byte[]](Get-FeedAssetRange $url ($loff + $skip) $csize $SiteDir $SiteUrl).Bytes }
            if ($method -eq 8) {
                $ds = New-Object IO.Compression.DeflateStream ((New-Object IO.MemoryStream (, $data)), [IO.Compression.CompressionMode]::Decompress)
                $out = New-Object IO.MemoryStream
                try { $ds.CopyTo($out) } finally { $ds.Dispose() }
                $data = $out.ToArray()
            } elseif ($method -ne 0) { throw "pack $([string]$Pack.id) stores delete.txt in a way this cannot read" }
            return @(([Text.Encoding]::UTF8.GetString($data) -split "`r?`n") | ForEach-Object { $_.Trim().Replace('/', '\') } | Where-Object { $_ -and -not $_.StartsWith('#') })
        }
        $at += 46 + $nlen + $xlen + $clen
    }
    return @()
}

# Every path the packs on the feed took out, oldest pack first. What the first
# record with its files on the site starts its ':gone:' list from, so a launcher
# that syncs to it takes out what the packs it never replayed would have.
function Get-FeedPackDeletes($doc, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net', [scriptblock]$Say) {
    Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
    $all = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $packs = @()
    if ($null -ne $doc -and $doc.PSObject.Properties['packs'] -and $doc.packs) { $packs = @($doc.packs | Where-Object { $null -ne $_ }) }
    foreach ($p in $packs) {
        if (-not $p.PSObject.Properties['url'] -or -not [string]$p.url) { continue }
        foreach ($l in @(Get-FeedPackDeleteLines $p $SiteDir $SiteUrl)) { [void]$all.Add($l) }
    }
    if ($Say) { & $Say ("  read what {0} pack(s) took out: {1} path(s)" -f $packs.Count, $all.Count) }
    return @($all)
}

# Case 4: every pack the feed lists, applied in order the way a launcher
# applies them, reduced to the entry each game file would have. Only game
# files: the plugin list and launcher source keys are left out, so the next
# release sends the plugin list again (harmless) and never says the load order
# moved when nobody knows that it did.
function Get-BaselineFromPacks($doc, [string]$WorkDir, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net', [scriptblock]$Say) {
    Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $map = @{}
    $packs = @()
    if ($doc.PSObject.Properties['packs'] -and $doc.packs) { $packs = @($doc.packs) }
    if (-not $packs.Count) { throw 'The feed lists no packs to rebuild the baseline from.' }
    if (-not (Test-Path -LiteralPath $WorkDir)) { New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null }
    $n = 0
    foreach ($p in $packs) {
        $n++
        $id = if ($p.PSObject.Properties['id']) { [string]$p.id } else { "#$n" }
        $sha = if ($p.PSObject.Properties['sha256']) { ([string]$p.sha256).ToLowerInvariant() } else { '' }
        $url = if ($p.PSObject.Properties['url']) { [string]$p.url } else { '' }
        if ($sha -notmatch '^[0-9a-f]{64}$') { throw "Pack $id on the feed has no sha256, so it cannot be read back." }
        $zipPath = Join-Path $WorkDir ('replay-' + $sha + '.zip')
        [void](Get-FeedAssetFile $url $sha $zipPath $SiteDir $SiteUrl)
        if ($Say) { & $Say ("    pack {0} of {1}: {2}" -f $n, $packs.Count, $id) }
        $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            $del = $zip.GetEntry('delete.txt')
            if ($null -ne $del) {
                $r = New-Object IO.StreamReader ($del.Open())
                try {
                    while ($null -ne ($line = $r.ReadLine())) {
                        $rel = $line.Trim().Replace('/', '\')
                        if ($rel) { $map.Remove($rel) }
                    }
                } finally { $r.Dispose() }
            }
            foreach ($e in $zip.Entries) {
                if (-not $e.FullName.StartsWith('game/') -or $e.FullName.EndsWith('/')) { continue }
                $rel = $e.FullName.Substring(5).Replace('/', '\')
                $s = $e.Open()
                try { $map[$rel] = ('{0}:{1}' -f $e.Length, (Get-BaselineStreamSha $s)) }
                finally { $s.Dispose() }
            }
        } finally { $zip.Dispose() }
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    }
    return $map
}

# What this release is diffed against; see the top of this file for the order.
# Hands back @{ Map; From; Pointer; Lines }: From is store, feed, store-no-pointer
# or packs, and Lines what to tell the person shipping. Writes nothing but
# scratch files under $WorkDir; Save-State writes the store copy once the
# release is out.
function Resolve-ReleaseBaseline([string]$VersionFile, [string]$StateFile, [string]$WorkDir, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net', [scriptblock]$Say) {
    $doc = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($VersionFile)) $VersionFile
    $ptr = Get-FeedBaselinePointer $doc
    $have = Get-BaselineFileSha $StateFile
    $lines = @()
    if ($null -ne $ptr) {
        $want = ([string]$ptr.sha256).ToLowerInvariant()
        $relId = if ($ptr.PSObject.Properties['id']) { [string]$ptr.id } else { '' }
        if ($have -eq $want) {
            return [pscustomobject]@{ Map = (Read-BaselineFile $StateFile); From = 'store'; Pointer = $ptr; Lines = @("  baseline: release $relId, the one the feed names") }
        }
        $lines += $(if ($have) { "  the store's baseline is not the one the feed's last release ($relId) names, so that one is read from the site" }
                    else { "  the store has no baseline, so the one the feed's last release ($relId) names is read from the site" })
        $got = Join-Path $WorkDir ('baseline-' + $want + '.json')
        try {
            [void](Get-FeedAssetFile ([string]$ptr.url) $want $got $SiteDir $SiteUrl)
            $map = Read-BaselineFile $got
            Remove-Item -LiteralPath $got -Force -ErrorAction SilentlyContinue
            $lines += ("  baseline: release $relId, {0:n0} entries, checked against its sha256" -f $map.Count)
            return [pscustomobject]@{ Map = $map; From = 'feed'; Pointer = $ptr; Lines = $lines }
        } catch {
            $lines += ('  ' + $_.Exception.Message)
            $lines += '  so it is rebuilt from the packs the feed lists instead'
        }
    } elseif ($have) {
        return [pscustomobject]@{ Map = (Read-BaselineFile $StateFile); From = 'store-no-pointer'; Pointer = $null
                                  Lines = @('  baseline: the store''s published.json (the feed names none yet; the next release does)') }
    } else {
        $lines += '  the store has no baseline and the feed names none, so it is rebuilt from the packs the feed lists'
    }
    if ($Say) { foreach ($l in $lines) { & $Say $l } }
    $map = Get-BaselineFromPacks $doc $WorkDir $SiteDir $SiteUrl $Say
    $done = ("  baseline rebuilt from {0} pack(s): {1:n0} files. Anything of ours no pack carried is sent again." -f @($doc.packs).Count, $map.Count)
    return [pscustomobject]@{ Map = $map; From = 'packs'; Pointer = $ptr; Lines = @($done) }
}
