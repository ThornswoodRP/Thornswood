<#
  test-1050-news-out.ps1

      pwsh -NoProfile -File .\tests\test-1050-news-out.ps1

  The notes leave version.json for a file of their own once every launcher a
  channel lets in reads one (#1050), and every script that adds, marks or
  reads them finds them there.

  WHY THIS EXISTS. Measured 12 Oct over https, the news was 31,282 of main's
  95,085 bytes of version.json and 19,980 of dev's 111,305, read by every
  launcher on every check. Launchers 1.2.4 to 2026.1101 read the News tab
  from "newsFile" as well as "news"; since #5187 the launcher reads it from
  the build Releases and the site's News page is what reads "newsFile".
  scripts\release\Feed-News.ps1 is the one place that decides
  which a channel uses and reads either. What this proves, on a stand-in site
  folder (-SiteDir), nothing sent anywhere:
    - Test-FeedNewsOut: from 1.2.4 on, dev numbers included, and never for a
      minimum that is not a version
    - below it the notes stay in "news" and the feed names no file
    - from it the notes are one asset under their sha256, named as newsFile
      { url, sha256, count }, "news" written as [], and the site holds the file
      before the feed would name it
    - Get-FeedNewsList reads the file back, after the notes "news" carries,
      each note once; Open-FeedNewsList puts the whole list in "news" and takes
      the file out, so a trimmed note never comes back; the list keeps forty
    - a file the site does not hold, or a newsFile of another shape, stops a
      script rather than letting it write back a list without its older notes
    - Dev-News's marks read every note through it
    - (the site's News page, which reads the news file itself since #5187,
      is tests\test-5187-site-news.js)
    - Publish-Update, Rollback-Feed, Publish-Server, Publish-Discord and
      Remirror-Site-Feed go through it (read from their source)
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Threw([scriptblock]$b) { try { & $b | Out-Null; return '' } catch { return $_.Exception.Message } }

. (Join-Path $Repo 'scripts\release\Feed-News.ps1')
. (Join-Path $Repo 'scripts\release\Feed-Store.ps1')
. (Join-Path $Repo 'scripts\release\Dev-News.ps1')

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-news-out-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$site = Join-Path $T 'site'
New-Item -ItemType Directory -Force -Path (Join-Path $site 'feed\assets'), (Join-Path $site 'feed-dev\assets') | Out-Null

function Note([string]$date, [string]$title, [string]$channel = '') {
    return [pscustomobject][ordered]@{ date = $date; title = $title; body = ''; details = @('A line about it.'); channel = $channel }
}
function Titles($items) { return (@($items | ForEach-Object { [string]$_.title }) -join ',') }
function Feed([string]$min, $news) { return [pscustomobject][ordered]@{ launcherVersion = $min; minLauncher = $min; packs = @(); news = @($news) } }

try {
    Write-Host 'when a channel keeps the notes as a file'
    Yes 'not below 1.2.4: 1.2.3 and 1.2.3.9 keep them in the feed' (-not (Test-FeedNewsOut '1.2.3') -and -not (Test-FeedNewsOut '1.2.3.9'))
    Yes 'from 1.2.4 on, a dev number too: 1.2.4, 1.2.4.1, 1.2.10, 1.3.0' ((Test-FeedNewsOut '1.2.4') -and (Test-FeedNewsOut '1.2.4.1') -and (Test-FeedNewsOut '1.2.10') -and (Test-FeedNewsOut '1.3.0'))
    Yes 'never for a minimum that is not a version' (-not (Test-FeedNewsOut '') -and -not (Test-FeedNewsOut 'latest') -and -not (Test-FeedNewsOut '1.2.x'))
    # The launcher reads its News from the build Releases (ReleaseNews.cs,
    # #5187) and neither "news" nor the file, so where the feed keeps the
    # notes is the site's News page's concern alone.
    $reader = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'launcher\app') -Filter '*.cs' -File |
                Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match '\bclass\s+FeedNews\b' }).Count -gt 0
    $releases = Test-Path -LiteralPath (Join-Path $Repo 'launcher\app\ReleaseNews.cs')
    Yes 'the launcher reads its News from the Releases, not the feed''s notes, so emptying "news" takes nothing from it' ($releases -and -not $reader)

    $three = @((Note '10-12-2026 1:00 AM' 'Third' 'dev'), (Note '10-11-2026 5:51 PM' 'Second'), (Note '10-10-2026 9:00 AM' 'First'))

    Write-Host ''; Write-Host 'below 1.2.4'
    $d = Feed '1.2.3' @()
    $d | Add-Member -NotePropertyName newsFile -NotePropertyValue ([pscustomobject]@{ url = 'https://thornswood.net/feed/assets/' + ('a' * 64); sha256 = ('a' * 64); count = 1 })
    $r = Set-FeedNewsList $d $three 'main' '1.2.3' (Join-Path $T 'w1') $site
    Yes 'the notes stay in "news" and the feed names no file' ($r -eq 'feed' -and (Titles $d.news) -eq 'Third,Second,First' -and -not $d.PSObject.Properties['newsFile'])
    Yes '  and nothing went to the site' (@(Get-ChildItem -LiteralPath (Join-Path $site 'feed\assets') -File).Count -eq 0)

    Write-Host ''; Write-Host 'from 1.2.4'
    $d = Feed '1.2.4' $three
    $r = Set-FeedNewsList $d $three 'dev' '1.2.4' (Join-Path $T 'w2') $site
    $ptr = $d.newsFile
    $asset = if ($null -ne $ptr) { Join-Path $site ('feed-dev\assets\' + $ptr.sha256) } else { '' }
    Yes 'the notes are one file on the site, under its sha256, before the feed names it' ($r -eq 'file' -and $null -ne $ptr -and (Test-Path -LiteralPath $asset) -and (Get-BaselineFileSha $asset) -eq $ptr.sha256)
    Yes '  named as newsFile with its url on the channel''s own folder and its count' ($ptr.url -eq ('https://thornswood.net/feed-dev/assets/' + $ptr.sha256) -and [int]$ptr.count -eq 3)
    Yes '  and "news" is written as [], not left out' (@($d.news).Count -eq 0 -and (($d | ConvertTo-Json -Depth 6) -match '"news":\s*\[\s*\]'))
    $back = @(Get-FeedNewsList $d $site)
    Yes 'Get-FeedNewsList reads them back, in order, with the DEV mark' ((Titles $back) -eq 'Third,Second,First' -and [string]$back[0].channel -eq 'dev')
    $again = Feed '1.2.4' @()
    $r2 = Set-FeedNewsList $again $three 'dev' '1.2.4' (Join-Path $T 'w3') $site
    Yes 'the same notes make the same file, so a second send has nothing new to send' ($again.newsFile.sha256 -eq $ptr.sha256)

    # A publisher from before this put its newest note in "news" beside the file.
    $mixed = Feed '1.2.4' @((Note '10-13-2026 8:00 AM' 'From an older publisher'), (Note '10-12-2026 1:00 AM' 'Third' 'dev'))
    $mixed | Add-Member -NotePropertyName newsFile -NotePropertyValue $ptr
    Yes 'a note in "news" beside the file comes first, and a note in both is there once' ((Titles (Get-FeedNewsList $mixed $site)) -eq 'From an older publisher,Third,Second,First')
    $open = @(Open-FeedNewsList $mixed $site)
    Yes 'Open-FeedNewsList puts the whole list in "news" and takes the file out' ((Titles $open) -eq 'From an older publisher,Third,Second,First' -and
        (Titles $mixed.news) -eq (Titles $open) -and -not $mixed.PSObject.Properties['newsFile'])
    $trim = @($open[0..2])
    [void](Set-FeedNewsList $mixed $trim 'dev' '1.2.4' (Join-Path $T 'w4') $site)
    Yes '  so a note trimmed off the end stays off' ((Titles (Get-FeedNewsList $mixed $site)) -eq 'From an older publisher,Third,Second')

    $many = @(1..45 | ForEach-Object { Note ('10-01-2026 {0}:00 AM' -f ($_ % 12 + 1)) ("Note $_") })
    $big = Feed '1.2.4' @()
    [void](Set-FeedNewsList $big $many 'main' '1.2.4' (Join-Path $T 'w5') $site)
    Yes 'the file keeps the newest forty' ([int]$big.newsFile.count -eq 40 -and @(Get-FeedNewsList $big $site).Count -eq 40 -and (Titles @(Get-FeedNewsList $big $site)[0]) -eq 'Note 1')
    Yes '  on main''s own folder' ((Test-Path -LiteralPath (Join-Path $site ('feed\assets\' + $big.newsFile.sha256))) -and $big.newsFile.url -like 'https://thornswood.net/feed/assets/*')

    $local = Feed '1.2.4' @()
    $before = @(Get-ChildItem -LiteralPath (Join-Path $site 'feed\assets') -File).Count
    [void](Set-FeedNewsList $local @((Note '10-14-2026 1:00 AM' 'Not sent')) 'main' '1.2.4' (Join-Path $T 'w6') $site -NoSend)
    Yes '-NoSend names the file and sends nothing (a dry run)' ($null -ne $local.newsFile -and @(Get-ChildItem -LiteralPath (Join-Path $site 'feed\assets') -File).Count -eq $before)

    Write-Host ''; Write-Host 'what stops a script'
    $gone = Feed '1.2.4' @()
    $gone | Add-Member -NotePropertyName newsFile -NotePropertyValue ([pscustomobject]@{ url = 'https://thornswood.net/feed/assets/' + ('b' * 64); sha256 = ('b' * 64); count = 4 })
    Yes 'a news file the site does not hold stops Get-FeedNewsList, so no shorter list is written back' ((Threw { Get-FeedNewsList $gone $site }) -match 'has no /feed/assets/')
    $odd = Feed '1.2.4' @()
    $odd | Add-Member -NotePropertyName newsFile -NotePropertyValue ([pscustomobject]@{ url = ''; sha256 = 'not a hash' })
    Yes 'so does a newsFile of another shape' ((Threw { Get-FeedNewsList $odd $site }) -match 'without a sha256 and a url')
    $bent = Feed '1.2.4' @()
    $bent | Add-Member -NotePropertyName newsFile -NotePropertyValue ([pscustomobject]@{ url = $ptr.url; sha256 = $big.newsFile.sha256 })
    Yes 'and a url that is not the asset its sha256 names' ((Threw { Get-FeedNewsList $bent $site }) -match 'not the asset its sha256 names')
    $empty = Feed '1.2.3' @()
    Yes 'a feed with no notes and no file reads as no notes' (@(Get-FeedNewsList $empty $site).Count -eq 0)

    Write-Host ''; Write-Host 'the scripts that read and write them'
    $dev = Feed '1.2.4' @()
    [void](Set-FeedNewsList $dev $three 'dev' '1.2.4' (Join-Path $T 'w7') $site)
    $main = [pscustomobject]@{ launcherVersion = '1.2.4' }
    $marks = Set-DevFeedMarks $dev $main $Repo $site
    Yes 'Dev-News''s marks read every note out of the file, and leave the whole list in "news" for the sender' (
        [int]$marks.Notes -eq 3 -and (Titles $dev.news) -eq 'Third,Second,First' -and -not $dev.PSObject.Properties['newsFile'] -and [string]$dev.mainVersion -eq '1.2.4')

    $src = @{}
    foreach ($f in 'scripts\release\Publish-Update.ps1', 'scripts\release\Rollback-Feed.ps1', 'scripts\release\Publish-Server.ps1', 'scripts\ops\Publish-Discord.ps1', 'scripts\deploy\Remirror-Site-Feed.ps1', 'scripts\release\Dev-News.ps1') {
        $src[$f] = [IO.File]::ReadAllText((Join-Path $Repo $f))
    }
    $pu = $src['scripts\release\Publish-Update.ps1']
    Yes 'Publish-Update opens the whole list before it adds a note, and puts it back the channel''s way after the DEV marks and before the feed is written' (
        $pu -match 'Open-FeedNewsList \$doc' -and $pu.IndexOf('Open-FeedNewsList $doc') -lt $pu.IndexOf('$marks = Set-DevFeedMarks') -and
        $pu.IndexOf('$marks = Set-DevFeedMarks') -lt $pu.IndexOf('Set-FeedNewsList $doc') -and
        $pu.IndexOf('Set-FeedNewsList $doc') -lt $pu.IndexOf('Write-FeedVersionFile $VersionFile'))
    Yes '  with the minLauncher it writes, and nothing sent on a run that uploads nothing' ($pu -match "Val \`$doc 'minLauncher'" -and $pu -match '-NoSend:\$NoUpload')
    Yes '  and names no launcher number in the note, since the feed carries none that moves (#4825)' (
        $pu -notmatch 'this one is on' -and $pu -notmatch "Launcher \`$")
    $rb = $src['scripts\release\Rollback-Feed.ps1']
    Yes 'Rollback-Feed adds its note to the whole list and puts it back before the feed is written' ($rb -match 'Open-FeedNewsList \$doc' -and $rb.IndexOf('Set-FeedNewsList $doc') -gt 0 -and
        $rb.IndexOf('Set-FeedNewsList $doc') -lt $rb.IndexOf('Write-FeedVersionFile $VersionFile'))
    $ps = $src['scripts\release\Publish-Server.ps1']
    Yes 'Publish-Server''s news entry does the same' ($ps -match 'Open-FeedNewsList \$doc' -and $ps.IndexOf('Set-FeedNewsList $doc') -gt 0 -and
        $ps.IndexOf('Set-FeedNewsList $doc') -lt $ps.IndexOf('Write-FeedVersionFile $VersionFile'))
    $dn = $src['scripts\release\Dev-News.ps1']
    Yes 'a dev marks refresh puts the list back the dev feed''s way before it sends' ($dn.IndexOf('Set-FeedNewsList $doc') -gt 0 -and $dn.IndexOf('Set-FeedNewsList $doc') -lt $dn.IndexOf("Send-FeedStore 'dev'"))
    Yes 'Publish-Discord posts the newest note wherever the feed keeps it' ($src['scripts\ops\Publish-Discord.ps1'] -match '\$n = @\(Get-FeedNewsList \$v')
    Yes 'Remirror-Site-Feed checks the news file is on the site like every asset the feed names' ($src['scripts\deploy\Remirror-Site-Feed.ps1'] -match "Want \(Prop \`$doc\.newsFile 'url'\) 'news file'")
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
