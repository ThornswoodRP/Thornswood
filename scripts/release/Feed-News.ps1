<#
  Feed-News.ps1

  The notes the launcher's News tab shows, wherever the feed keeps them (#1050).

      . (Join-Path $PSScriptRoot 'Feed-News.ps1')

  WHY IT EXISTS. Measured 12 Oct over https, the news was 31,282 of main's
  95,085 bytes of version.json and 19,980 of dev's 111,305: once the packs and
  the releases list came off the feed, most of what is left, and every
  launcher reads the whole feed on every check, every thirty seconds while the
  game runs. Every launcher up to 1.2.3 reads the News tab only out of "news"
  in version.json. From the first launcher with launcher\app\FeedNews.cs it
  also reads "newsFile": { url, sha256, count }, one asset at
  /feed[-dev]/assets/<sha256> holding the same list, and shows its notes after
  the ones "news" carries. FeedNews.cs went with #5187: the native launcher
  reads its News tab from the GitHub Releases (launcher\app\ReleaseNews.cs)
  and reads neither field, so these are for the launchers already installed
  before it.

  So a channel keeps its notes in "news" until the launcher it lets into the
  game (minLauncher, which a publish sets to the launcher it offers) reads the
  file, and from then they are one asset named as "newsFile" and "news" is []:

      Test-FeedNewsOut <minLauncher>       true from $FeedNewsFileLauncher on
      Get-FeedNewsList $doc                every note, newest first: "news",
                                           then the file's that "news" does not
                                           carry, by date and title
      Open-FeedNewsList $doc               the same, put whole into "news" in
                                           memory with "newsFile" taken out,
                                           for a script about to change them
      Set-FeedNewsList $doc $news ...      puts the list back the way the
                                           channel keeps it, sending the file
                                           to the site first when it is one

  Every script that adds a note, marks one or reads them goes through these:
  Publish-Update, Rollback-Feed, Publish-Server's news entry, Dev-News's DEV
  marks and Publish-Discord (the site reads the news file itself, #5187). A
  feed written by a publisher from before this carries its newest note in "news" beside an older file, and the
  list is the two together, so no note is lost.

  $FeedNewsFileLauncher is the first launcher number with FeedNews.cs: 1.2.4,
  the number after 1.2.3, which went out on both channels on 11 Oct without
  it. That held because FeedNews.cs was on main before Bump-Version.ps1
  moved main to 1.2.4 (#1050). Every dev number climbs from main's, so dev's
  first such launcher was 1.2.4 or a 1.2.4.N. Since 1 Nov 2026 the number is
  worked out from git (LauncherVersion.ps1, #5179), 2026.1101.1745 and the
  like, which is above every 1.2 number, so the comparison still holds.
#>

. (Join-Path $PSScriptRoot 'Release-Baseline.ps1')   # Compare-FeedVersion, Get-FeedAssetFile, Get-BaselineFileSha
. (Join-Path $PSScriptRoot 'Feed-Rules.ps1')         # Get-HostFeedAssetUrl

$FeedNewsFileLauncher = '1.2.4'

# True when every launcher the channel lets into the game reads the news file.
# False for a minimum that is not a version.
function Test-FeedNewsOut([string]$MinLauncher) {
    $c = Compare-FeedVersion ([string]$MinLauncher).Trim() $FeedNewsFileLauncher
    return ($null -ne $c -and $c -ge 0)
}

function Get-FeedNewsKey($n) {
    $d = ''; $t = ''
    if ($null -ne $n -and $n.PSObject.Properties['date']) { $d = [string]$n.date }
    if ($null -ne $n -and $n.PSObject.Properties['title']) { $t = [string]$n.title }
    return ($d + "`n" + $t)
}

# The feed's "newsFile", or $null when it names none. Throws on one that is
# there and is not a url and a sha256, rather than reading it as no notes.
function Get-FeedNewsPointer($doc) {
    if ($null -eq $doc -or -not $doc.PSObject.Properties['newsFile'] -or $null -eq $doc.newsFile) { return $null }
    $f = $doc.newsFile
    $sha = ''; $url = ''
    if ($f.PSObject.Properties['sha256']) { $sha = ([string]$f.sha256).ToLowerInvariant() }
    if ($f.PSObject.Properties['url']) { $url = [string]$f.url }
    if ($sha -notmatch '^[0-9a-f]{64}$' -or -not $url) { throw 'The feed names a news file without a sha256 and a url, so its notes cannot be read.' }
    return $f
}

# Every note the feed has, newest first: the ones "news" carries, then the news
# file's that "news" does not, each once by date and title. The file is read
# from -SiteDir or the site over https and checked against its sha256 (a site
# copy that is not those bytes is refused). Throws when the feed names a file
# that cannot be had: a list without its older notes must never be written
# back as if it were all of them.
function Get-FeedNewsList($doc, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net') {
    $out = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    if ($null -ne $doc -and $doc.PSObject.Properties['news'] -and $null -ne $doc.news) {
        foreach ($n in @($doc.news)) { if ($null -ne $n -and $seen.Add((Get-FeedNewsKey $n))) { $out.Add($n) } }
    }
    $ptr = Get-FeedNewsPointer $doc
    if ($null -ne $ptr) {
        $sha = ([string]$ptr.sha256).ToLowerInvariant()
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-news-' + [Guid]::NewGuid().ToString('N') + '.json')
        try {
            [void](Get-FeedAssetFile ([string]$ptr.url) $sha $tmp $SiteDir $SiteUrl)
            $text = ([IO.File]::ReadAllText($tmp)).TrimStart([char]0xFEFF)
            $items = @()
            if ($text.Trim()) {
                $o = $text | ConvertFrom-Json
                $items = @($o | Where-Object { $null -ne $_ })
            }
            foreach ($n in $items) { if ($seen.Add((Get-FeedNewsKey $n))) { $out.Add($n) } }
        } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
    return $out.ToArray()
}

# For a script about to change the notes: every note (Get-FeedNewsList) put
# whole into "news" in memory, and "newsFile" taken out, so nothing that reads
# the document afterwards merges the old file back in (a note trimmed off the
# end would come back). Set-FeedNewsList puts the list back the way the
# channel keeps it before the feed is written. Returns the list.
function Open-FeedNewsList($doc, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net') {
    $list = @(Get-FeedNewsList $doc $SiteDir $SiteUrl)
    if ($doc.PSObject.Properties['news']) { $doc.news = $list } else { $doc | Add-Member -NotePropertyName 'news' -NotePropertyValue $list }
    if ($doc.PSObject.Properties['newsFile']) { $doc.PSObject.Properties.Remove('newsFile') }
    return $list
}

# The most notes a feed keeps, newest first. It is a news feed, not a changelog.
$FeedNewsKeep = 40

# Puts $News into $doc the way the channel keeps it. While Test-FeedNewsOut is
# not true of $MinLauncher (the feed's minLauncher as it will go out): in
# "news", and no "newsFile". Once it is: written as one file into $WorkDir,
# sent to /feed[-dev]/assets/<sha256> (Remirror-Site-Feed.ps1 -Send, which
# skips a file already there) unless -NoSend, named as "newsFile", and "news"
# is []. Returns 'feed' or 'file'. Throws, with $doc unchanged, when the file
# did not reach the site, so the feed never names a file the site does not hold.
function Set-FeedNewsList($doc, $News, [string]$Channel, [string]$MinLauncher, [string]$WorkDir, [string]$SiteDir, [switch]$NoSend) {
    $list = @($News | Where-Object { $null -ne $_ })
    if ($list.Count -gt $FeedNewsKeep) { $list = @($list[0..($FeedNewsKeep - 1)]) }
    if (-not (Test-FeedNewsOut $MinLauncher)) {
        if ($doc.PSObject.Properties['news']) { $doc.news = $list } else { $doc | Add-Member -NotePropertyName 'news' -NotePropertyValue $list }
        if ($doc.PSObject.Properties['newsFile']) { $doc.PSObject.Properties.Remove('newsFile') }
        return 'feed'
    }
    if (-not $WorkDir) { throw 'Set-FeedNewsList needs a folder to write the news file in.' }
    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    $json = ConvertTo-Json -InputObject @($list) -Depth 6
    if (-not $list.Count) { $json = '[]' }
    $file = Join-Path $WorkDir 'news.json'
    [IO.File]::WriteAllText($file, $json, (New-Object Text.UTF8Encoding($false)))
    $sha = Get-BaselineFileSha $file
    $dev = ($Channel -eq 'dev')
    if (-not $NoSend) {
        $sendArgs = @{ Dev = $dev; Send = @($file); Quiet = $true }
        if ($SiteDir) { $sendArgs['SiteDir'] = $SiteDir }
        $global:LASTEXITCODE = 0
        $why = ''
        try { & (Join-Path $PSScriptRoot '..\deploy\Remirror-Site-Feed.ps1') @sendArgs } catch { $why = $_.Exception.Message }
        if (-not $why -and $LASTEXITCODE -ne 0) { $why = "Remirror-Site-Feed.ps1 -Send exited $LASTEXITCODE" }
        if ($why) { throw ("The news file did not reach the site, so the feed was not changed: " + $why) }
    }
    $ptr = [pscustomobject][ordered]@{ url = (Get-HostFeedAssetUrl $sha -Dev:$dev); sha256 = $sha; count = $list.Count }
    if ($doc.PSObject.Properties['newsFile']) { $doc.newsFile = $ptr } else { $doc | Add-Member -NotePropertyName 'newsFile' -NotePropertyValue $ptr }
    if ($doc.PSObject.Properties['news']) { $doc.news = @() } else { $doc | Add-Member -NotePropertyName 'news' -NotePropertyValue @() }
    return 'file'
}
