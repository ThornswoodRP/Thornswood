<#
  test-dev-news-refresh.ps1

      pwsh -NoProfile -File .\tests\test-dev-news-refresh.ps1

  The dev feed's DEV marks follow main without a dev release, and a Ship that
  released nothing tells nobody.

  WHAT HAPPENED. Measured on 6 Oct 2026 at about 11 AM: the dev feed had 40
  notes, 27 marked DEV, and mainVersion 1.1.106, while main had shipped 1.2.0
  (release 20261005-235125, from 1c0caabe) after the last dev Ship. Three
  faults kept it so:

    1. a dev publish with nothing new stopped at "Nothing to do" before the
       marks were worked out, so a dev Ship made to bring them up to date left
       them as they were;
    2. that "Nothing to do" exited 0 without -Launcher, which is how a Ship
       that keeps its launcher runs it (#921), and Ship read 0 as a release: it
       posted the previous night's note to the dev updates channel again and
       told the dev server "update in 5 min";
    3. a main Ship never touched the dev feed, so after every main release
       the dev News tab marked finished work DEV until somebody shipped dev.

  WHAT THIS DRIVES, all offline: a folder stands in for the site and the VPS
  store (-SiteDir, the same script the VPS runs, Feed-Store.ps1), a scratch git
  repository stands in for the clone whose history proves what main has, and
  stand-in scripts stand in for the Discord post, the remirror and the
  server notice. (The site's News page is not sent since #5187.)

    1. Update-DevFeedMarks (Dev-News.ps1) on the 27-mark shape: 3 notes with a
       sourceCommit (one on main by ancestry, one squash merged, one main never
       took) and 24 from before sourceCommit, whose own dev release (found by
       its tag) main has, while the dev feed's newest release is ahead of
       main (#2401). 26 lose the mark, 1 keeps it; old notes whose release was
       built with uncommitted files, or that no tag holds, keep the mark they
       have. mainVersion follows main, and only the dev
       feed's version.json is sent: no pack, no release record, no news entry,
       no baseline. A second run sends nothing. -NoSend sends nothing. No main
       feed, or a store that moved since it was read, sends nothing.
    2. Refresh-DevNews.ps1, the command a person runs, end to end.
    3. The real Publish-Update.ps1 on the dev channel: a release, then the
       same build again with the marks gone stale. It exits 2, makes no
       release and no news entry, and the store's dev feed has the marks
       main says. With -NoPush it sends nothing.
    4. Ship.ps1 from the publisher on, run with stand-ins: a publish with
       nothing new posts nothing and tells no server, says nothing was
       released and how the marks went; a publisher that says 0 without naming
       a release is not announced; a main Ship refreshes the dev marks after
       the remirror, and a refresh that fails does not fail the release.

  Everything it writes is under its own temp folder, which it removes.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
# Publish-Update takes no -Vps; its box here is this machine's stand-in.
$env:THORNSWOOD_VPS = '127.0.0.1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
# The feed below holds a runtime the server already serves, so it carries the note
# version Publish-Update writes today (Source-Notice.ps1), not a number that goes stale.
$noticeV = [int]([regex]::Match((Get-Content -LiteralPath (Join-Path $repo 'scripts\release\Source-Notice.ps1') -Raw), '\$SourceNoticeVersion = (\d+)').Groups[1].Value)
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function Read-Json([string]$path) { return (([IO.File]::ReadAllText($path)) -replace '^\uFEFF', '') | ConvertFrom-Json }
function Sha([string]$path) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (-join ($h.ComputeHash([IO.File]::ReadAllBytes($path)) | ForEach-Object { $_.ToString('x2') })) } finally { $h.Dispose() }
}
# The stand-in site keeps each channel's feed as write-once generations,
# <channel>\version\<8 digits>.json, the newest being the feed (#2727,
# Feed-Store.ps1). SiteFeed is the newest; Put-SiteFeed writes the next one,
# as another publisher would.
function SiteFeed([string]$channelDir) { return (Get-FeedVersionFile $channelDir) }
function Put-SiteFeed([string]$channelDir, [string]$text) { Put (Join-Path (Join-Path $channelDir 'version') (Get-FeedVersionNext $channelDir)) $text }
function RunGit([string]$dir) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& git -C $dir @args 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Out = ($out -join "`n").Trim() }
}
function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
$Shell = (Get-Process -Id $PID).Path
function Child([string]$cmd) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = (& $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Out = $out }
}
function Said($r, [bool]$ok) { if (-not $ok) { Write-Host (($r.Out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 16) -join "`n") -ForegroundColor DarkGray } }
function YesR([string]$what, [bool]$cond, $r) { Yes $what $cond; Said $r $cond }

$lib = Join-Path $repo 'scripts\release\Dev-News.ps1'
Yes 'scripts\release\Dev-News.ps1 is there' (Test-Path -LiteralPath $lib)
# Without it, sections 1 and 2 cannot run; 3 and 4 drive Publish-Update and Ship, which run either way.
$haveLib = Test-Path -LiteralPath $lib
if ($haveLib) { . $lib } else { . (Join-Path $repo 'scripts\release\Feed-Store.ps1') }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Yes 'git is on PATH' $false; Done }

$Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-dev-news-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$gitId = @('-c', 'user.name=Thornswood test', '-c', 'user.email=test@thornswood.invalid', '-c', 'commit.gpgsign=false')
$oldEnv = @{}
foreach ($k in 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'LOCALAPPDATA', 'APPDATA', 'THORNSWOOD_TEST_SITE_DIR') { $oldEnv[$k] = [Environment]::GetEnvironmentVariable($k) }
$env:GIT_COMMITTER_NAME = 'Thornswood test'; $env:GIT_COMMITTER_EMAIL = 'test@thornswood.invalid'
$env:GIT_AUTHOR_NAME = 'Thornswood test'; $env:GIT_AUTHOR_EMAIL = 'test@thornswood.invalid'
# Nothing here may reach this machine's own working folders for the feeds.
$env:LOCALAPPDATA = Join-Path $Scratch 'appdata'
$env:THORNSWOOD_TEST_SITE_DIR = ''
$script:gameServer = $null

try {
    # ---- a history like the real one ---------------------------------------------
    $git = Join-Path $Scratch 'clone'
    New-Item -ItemType Directory -Force -Path $git | Out-Null
    [void](RunGit $git init -q)
    function Commit([string]$file, [string]$text, [string]$msg) {
        Put (Join-Path $git $file) $text
        [void](RunGit $git @gitId add -A)
        [void](RunGit $git @gitId commit -q -m $msg)
        return (RunGit $git rev-parse HEAD).Out
    }
    $base = Commit 'a.txt' 'base' 'base'
    $m1 = Commit 'm.txt' 'main one' 'main one'
    # A dev release built from a branch, squash merged onto main later: never
    # an ancestor of main, the way pull requests merge here.
    [void](RunGit $git checkout -q -b work $m1)
    $branch = Commit 'b.txt' 'branch work' 'branch work'
    [void](RunGit $git checkout -q --detach $m1)
    $squash = Commit 'b.txt' 'branch work' 'branch work (#1)'
    $m2 = Commit 'c.txt' 'main two' 'main two'
    # Work main never took.
    [void](RunGit $git checkout -q -b unfinished $m2)
    $unfinished = Commit 'u.txt' 'not on main' 'unfinished'
    [void](RunGit $git checkout -q --detach $m2)
    # Main moves the same lines on before it ships, so the squash commit is
    # proved by content, not at main's tip.
    $mainShip = Commit 'b.txt' 'branch work, moved on' 'main three'
    Yes ("the stand-in clone has its history (main ships {0})" -f $mainShip.Substring(0, 12)) ($mainShip -match '^[0-9a-f]{40}$' -and $unfinished -match '^[0-9a-f]{40}$')
    # The annotated tag Ship pushes for each dev release (Add-ReleaseTag), with
    # the tagger's own clock, which is how a note from before sourceCommit is
    # matched to its release (#2401).
    function Tag-DevRelease([string]$dir, [string]$commit, [string]$id, [string]$at, [switch]$Dirty) {
        $msg = "Thornswood dev release $id`n`nlauncher  1.2.0`npacks     $id`nbaseline  $id`nbranch    HEAD"
        if ($Dirty) { $msg += "`nbuilt with 1 uncommitted change(s) on top of this commit" }
        $env:GIT_COMMITTER_DATE = $at
        try { [void](RunGit $dir @gitId tag -a "release/dev/$id" $commit -m $msg) }
        finally { Remove-Item Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue }
    }
    # The release the old notes came with: the branch, which main took by squash.
    Tag-DevRelease $git $branch '20261005-225302-dev' '2026-10-05T22:54:05-06:00'
    # One built with an uncommitted change, on another machine's clock, as
    # 20261006-141047-dev was (6 Oct 2:10 PM, uncommitted 1, tagged at -0400).
    Tag-DevRelease $git $branch '20261006-141047-dev' '2026-10-06T14:11:23-04:00' -Dirty

    function Note([string]$title, [string]$channel, [string]$commit, [switch]$Legacy, [string]$Date = '10-5-2026 10:53 PM') {
        $n = [ordered]@{ date = $Date; title = $title; body = ''; details = @('a line'); channel = $channel }
        if (-not $Legacy) { $n['sourceCommit'] = $commit }
        return [pscustomobject]$n
    }
    # The dev feed's own release is ahead of main, as it is between main
    # releases. Until #2401 the old notes took that release as their proof
    # and were all marked DEV; they are proved by the release each came with.
    function Stale-DevFeed([string]$LegacyDate = '10-5-2026 10:53 PM') {
        $news = @()
        $news += Note 'Work main never took' 'dev' $unfinished
        $news += Note 'Squash merged work' 'dev' $branch
        $news += Note 'Work main has by ancestry' 'dev' $m2
        for ($i = 1; $i -le 13; $i++) { $news += Note ("Main note $i") '' $(if ($i % 2) { $m1 } else { $m2 }) }
        for ($i = 1; $i -le 24; $i++) { $news += Note ("Note from before sourceCommit $i") 'dev' '' -Legacy -Date $LegacyDate }
        return [pscustomobject][ordered]@{
            launcherVersion = '1.2.0'
            launcherUrl = 'https://thornswood.net/feed-dev/assets/' + ('e' * 64)
            launcherSha256 = ('e' * 64)
            packs = @([pscustomobject]@{ id = '20261011-221215-dev'; url = 'https://thornswood.net/feed-dev/assets/' + ('f' * 64); sha256 = ('f' * 64) })
            news = $news
            mainVersion = '1.1.106'
            release = [pscustomobject][ordered]@{ id = '20261011-221215-dev'; channel = 'dev'; launcherVersion = '1.2.0'; packs = @('20261011-221215-dev')
                                                  baseline = '20261011-221215-dev'; commit = $unfinished; branch = 'unfinished'; uncommitted = 0; tag = 'release/dev/20261011-221215-dev' }
        }
    }
    $mainFeed = [pscustomobject][ordered]@{
        launcherVersion = '1.2.0'; packs = @(); news = @()
        release = [pscustomobject][ordered]@{ id = '20261005-235125'; channel = 'main'; launcherVersion = '1.2.0'; commit = $mainShip; uncommitted = 0 }
    }

    if ($haveLib) {
        # ---- 1. Update-DevFeedMarks against the stand-in store -----------------------
        Write-Host ''; Write-Host 'the refresh, against a stand-in store'
        $site = Join-Path $Scratch 'site'
        $work = Join-Path $Scratch 'work-dev'
        Put (Join-Path $site 'feed\version\00000001.json') ($mainFeed | ConvertTo-Json -Depth 6)
        Put (Join-Path $site 'feed-dev\version\00000001.json') ((Stale-DevFeed) | ConvertTo-Json -Depth 6)
        Put (Join-Path $site 'feed-dev\published.json') '{"Data\\x.esp":"5:0000000000000000000000000000000000000000000000000000000000000000"}'
        $devDir = Join-Path $site 'feed-dev'
        $mainDir = Join-Path $site 'feed'
        $mainFileBefore = SiteFeed $mainDir
        $mainShaBefore = Sha $mainFileBefore
        $devShaBefore = Sha (SiteFeed $devDir)
        $pubShaBefore = Sha (Join-Path $site 'feed-dev\published.json')
        $was = Read-Json (SiteFeed $devDir)
        Yes ("the stale dev feed has 27 of its 40 notes marked DEV and mainVersion 1.1.106 ({0} marked)" -f @($was.news | Where-Object { $_.channel -eq 'dev' }).Count) (
            @($was.news).Count -eq 40 -and @($was.news | Where-Object { $_.channel -eq 'dev' }).Count -eq 27 -and $was.mainVersion -eq '1.1.106')

        $r = Update-DevFeedMarks -SourceRepo $git -Dir $work -SiteDir $site
        Yes ("26 lose the mark, the ones main has ({0} cleared, {1} gained)" -f @($r.Cleared).Count, @($r.Gained).Count) (@($r.Cleared).Count -eq 26 -and @($r.Gained).Count -eq 0)
        Yes ("  1 keeps it, the work main never took ({0})" -f (@($r.Kept) -join '; ')) ($r.Marked -eq 1 -and @($r.Kept).Count -eq 1 -and $r.Kept[0] -eq 'Work main never took')
        Yes '  the squash merged note and the one main has by ancestry are among those cleared' (
            @($r.Cleared) -contains 'Squash merged work' -and @($r.Cleared) -contains 'Work main has by ancestry')
        Yes '  every note from before sourceCommit is cleared, its dev release being on main' (@($r.Cleared | Where-Object { $_ -like 'Note from before sourceCommit*' }).Count -eq 24)
        Yes ("  mainVersion follows main ({0} -> {1}), and the result names main's release" -f $r.WasMainVersion, $r.MainVersion) (
            $r.WasMainVersion -eq '1.1.106' -and $r.MainVersion -eq '1.2.0' -and $r.MainRelease -eq '20261005-235125')
        Yes '  and it says it sent the feed' ($r.Changed -and $r.Sent)
        $now = Read-Json (SiteFeed $devDir)
        Yes 'the store''s dev feed now marks only the one note DEV' (@($now.news | Where-Object { $_.channel -eq 'dev' }).Count -eq 1 -and $now.news[0].channel -eq 'dev')
        Yes '  and says main is on 1.2.0' ($now.mainVersion -eq '1.2.0')
        Yes '  with the same 40 notes in the same order: no entry added, none dropped' (
            @($now.news).Count -eq 40 -and ((@($now.news | ForEach-Object { $_.title }) -join '|') -eq (@($was.news | ForEach-Object { $_.title }) -join '|')))
        Yes '  and nothing else moved: launcher, packs, release record' (
            $now.launcherVersion -eq $was.launcherVersion -and $now.launcherUrl -eq $was.launcherUrl -and
            (($now.packs | ConvertTo-Json -Depth 4 -Compress) -eq ($was.packs | ConvertTo-Json -Depth 4 -Compress)) -and
            (($now.release | ConvertTo-Json -Depth 4 -Compress) -eq ($was.release | ConvertTo-Json -Depth 4 -Compress)))
        Yes '  the baseline and main''s feed are untouched' ((Sha (Join-Path $site 'feed-dev\published.json')) -eq $pubShaBefore -and
            (SiteFeed $mainDir) -eq $mainFileBefore -and (Sha (SiteFeed $mainDir)) -eq $mainShaBefore)
        # The generations are the feed's history: the one it replaced stays
        # beside the new one, unchanged, and nothing else was replaced.
        $gens = @(Get-ChildItem -LiteralPath (Join-Path $devDir 'version') -File | Sort-Object Name)
        $hist = @(Get-ChildItem -LiteralPath (Join-Path $devDir 'history') -File -ErrorAction SilentlyContinue)
        Yes ("  the feed it replaced is still there, unchanged, beside the new one, and nothing else went to history ({0}; history: {1})" -f (($gens | ForEach-Object { $_.Name }) -join ', '), (($hist | ForEach-Object { $_.Name }) -join ', ')) (
            $gens.Count -eq 2 -and $gens[0].Name -eq '00000001.json' -and (Sha $gens[0].FullName) -eq $devShaBefore -and
            $gens[1].Name -eq '00000002.json' -and (SiteFeed $devDir) -eq $gens[1].FullName -and $hist.Count -eq 0)
        # An old note whose own release was built with uncommitted files, and
        # no clean release after it, has nothing to prove it by, so it keeps
        # the mark it has (6 Oct 2:10 PM: 20261006-141047-dev, uncommitted 1).
        # test-2401-legacy-dev-marks.ps1 drives the one a later clean
        # release settles.
        $dirty = Stale-DevFeed '10-6-2026 2:11 PM'
        foreach ($n in @($dirty.news)) { if (-not $n.PSObject.Properties['sourceCommit']) { $n.channel = '' } }
        $d = Set-DevFeedMarks $dirty $mainFeed $git
        Yes ("old notes from a dirty dev release keep the mark they had, none gaining DEV ({0} gained)" -f @($d.Gained).Count) (
            @($d.Gained | Where-Object { $_ -like 'Note from before sourceCommit*' }).Count -eq 0 -and
            @($dirty.news | Where-Object { -not $_.PSObject.Properties['sourceCommit'] -and $_.channel -eq 'dev' }).Count -eq 0)
        $dirty2 = Stale-DevFeed '10-6-2026 2:11 PM'
        $d2 = Set-DevFeedMarks $dirty2 $mainFeed $git
        Yes '  and old notes still marked DEV stay marked, since nothing proves them on main' (
            @($dirty2.news | Where-Object { -not $_.PSObject.Properties['sourceCommit'] -and $_.channel -eq 'dev' }).Count -eq 24)
        Yes '  while notes with a sourceCommit are judged by it as before' (
            @($d2.Cleared) -contains 'Squash merged work' -and @($d2.Kept) -contains 'Work main never took')
        # A date no tagged release's span holds (no release found) keeps its
        # mark too, and so does a bare date with no time on it.
        foreach ($when in '9-1-2026 9:00 AM', '10-5-2026') {
            $lost = Stale-DevFeed $when
            [void](Set-DevFeedMarks $lost $mainFeed $git)
            Yes ("  an old note no tagged release holds ({0}) keeps its mark" -f $when) (
                @($lost.news | Where-Object { -not $_.PSObject.Properties['sourceCommit'] -and $_.channel -eq 'dev' }).Count -eq 24)
        }
        $raw = [IO.File]::ReadAllBytes((SiteFeed $devDir))
        Yes '  written with no byte order mark' (-not ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF))
        Yes '  and no release line was added to the store''s releases.txt' (-not (Test-Path -LiteralPath (Join-Path $site 'feed-dev\releases.txt')) -or
            @(Get-Content -LiteralPath (Join-Path $site 'feed-dev\releases.txt') | Where-Object { $_ }).Count -le 1)

        $shaAfter = Sha (SiteFeed $devDir)
        $r2 = Update-DevFeedMarks -SourceRepo $git -Dir $work -SiteDir $site
        Yes 'a second run finds nothing to move and sends nothing' (-not $r2.Changed -and -not $r2.Sent -and (Sha (SiteFeed $devDir)) -eq $shaAfter -and
            @(Get-ChildItem -LiteralPath (Join-Path $devDir 'version') -File).Count -eq 2)
        Yes ('  and says so: ' + ((Get-DevFeedMarksLines $r2) -join ' / ')) ((Get-DevFeedMarksLines $r2) -contains 'the dev feed already matched main, so nothing was sent')

        Put-SiteFeed $devDir ((Stale-DevFeed) | ConvertTo-Json -Depth 6)
        $staleSha = Sha (SiteFeed $devDir)
        $r3 = Update-DevFeedMarks -SourceRepo $git -Dir $work -SiteDir $site -NoSend
        Yes '-NoSend works it out and sends nothing' ($r3.Changed -and -not $r3.Sent -and @($r3.Cleared).Count -eq 26 -and (Sha (SiteFeed $devDir)) -eq $staleSha)
        Yes '  and writes nothing into the working folder either' (@((Read-Json (Join-Path $work 'version.json')).news | Where-Object { $_.channel -eq 'dev' }).Count -eq 27)

        # No main feed: its generations folder is moved aside, so the site has none.
        $mainGens = Join-Path $mainDir 'version'
        Move-Item -LiteralPath $mainGens -Destination ($mainGens + '.away')
        $threw = ''
        try { [void](Update-DevFeedMarks -SourceRepo $git -Dir $work -SiteDir $site) } catch { $threw = $_.Exception.Message }
        Yes ("no main feed: it refuses and sends nothing ({0})" -f $threw) ($threw -match 'no main feed' -and (Sha (SiteFeed $devDir)) -eq $staleSha)
        Move-Item -LiteralPath ($mainGens + '.away') -Destination $mainGens

        [void](Receive-FeedStore 'dev' $work -SiteDir $site)
        $other = Read-Json (SiteFeed $devDir); $other.launcherVersion = '1.2.0.1'
        Put-SiteFeed $devDir ($other | ConvertTo-Json -Depth 6)
        $otherSha = Sha (SiteFeed $devDir)
        $threw = ''
        try { [void](Update-DevFeedMarks -SourceRepo $git -Dir $work -Received -SiteDir $site) } catch { $threw = $_.Exception.Message }
        Yes ("a dev feed that changed on the VPS after it was read is not written over ({0})" -f $threw) ($threw -match 'changed on the VPS' -and (Sha (SiteFeed $devDir)) -eq $otherSha)

        # ---- 2. Refresh-DevNews.ps1 --------------------------------------------------
        Write-Host ''; Write-Host 'Refresh-DevNews.ps1'
        $refresh = Join-Path $repo 'scripts\release\Refresh-DevNews.ps1'
        Yes 'scripts\release\Refresh-DevNews.ps1 is there' (Test-Path -LiteralPath $refresh)
        Put-SiteFeed $devDir ((Stale-DevFeed) | ConvertTo-Json -Depth 6)
        $staleSha = Sha (SiteFeed $devDir)
        $c = Child ("& " + (Q $refresh) + " -Check -RepoDir " + (Q $git) + " -Dir " + (Q $work) + " -SiteDir " + (Q $site) + " -NoPause; exit `$LASTEXITCODE")
        YesR ("-Check says what would move and sends nothing (exit {0})" -f $c.Code) ($c.Code -eq 0 -and $c.Out -match '1 of 40 notes marked DEV' -and
            $c.Out -match '26 lost the mark' -and $c.Out -match 'this run sends nothing' -and (Sha (SiteFeed $devDir)) -eq $staleSha) $c
        $c = Child ("& " + (Q $refresh) + " -RepoDir " + (Q $git) + " -Dir " + (Q $work) + " -SiteDir " + (Q $site) + " -NoPause; exit `$LASTEXITCODE")
        YesR ("without it, the store's dev feed is marked against main (exit {0})" -f $c.Code) ($c.Code -eq 0 -and $c.Out -match 'version.json was sent' -and
            @((Read-Json (SiteFeed $devDir)).news | Where-Object { $_.channel -eq 'dev' }).Count -eq 1 -and (Read-Json (SiteFeed $devDir)).mainVersion -eq '1.2.0') $c
        Yes '  and it names the note that keeps the mark' ($c.Out -match 'still DEV, main does not have them: Work main never took')
        Move-Item -LiteralPath $mainGens -Destination ($mainGens + '.away')
        $c = Child ("& " + (Q $refresh) + " -RepoDir " + (Q $git) + " -Dir " + (Q $work) + " -SiteDir " + (Q $site) + " -NoPause; exit `$LASTEXITCODE")
        YesR ("with no main feed it exits 1 and says nothing was sent (exit {0})" -f $c.Code) ($c.Code -eq 1 -and $c.Out -match 'NOT refreshed' -and $c.Out -match 'Nothing was sent') $c
        Move-Item -LiteralPath ($mainGens + '.away') -Destination $mainGens
    }

    if ($OnWindows) {
        # ---- 3. the real Publish-Update.ps1, dev, nothing new --------------------------
        Write-Host ''; Write-Host 'the real Publish-Update.ps1 on the dev channel'
        $fake = Join-Path $Scratch 'repo'
        New-Item -ItemType Directory -Force -Path $fake | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo 'scripts') -Destination $fake -Recurse -Force
        foreach ($f in 'layout.json', 'installer\licences\GPL-3.0.txt', 'installer\licences\AGPL-3.0.txt', 'records\generated.json', 'records\ui-gone.json', 'records\shipped-not-ours.json', 'records\client-build.json', 'records\client-licences.json', 'records\client-licences') {
            $from = Join-Path $repo $f
            if (Test-Path -LiteralPath $from) {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $fake $f)) | Out-Null
                Copy-Item -LiteralPath $from -Destination (Join-Path $fake $f) -Force -Recurse
            }
        }
        $reqFrom = Join-Path $repo 'game\required-data'
        if (Test-Path -LiteralPath $reqFrom) {
            New-Item -ItemType Directory -Force -Path (Join-Path $fake 'game\required-data') | Out-Null
            Copy-Item -Path (Join-Path $reqFrom '*') -Destination (Join-Path $fake 'game\required-data') -Recurse -Force
        }
        # The real Stop-Game closes any Skyrim on the machine; nothing here may.
        Put (Join-Path $fake 'scripts\dev\Close-Launcher.ps1') "function Stop-Game { param([string]`$Root) return `$false }`r`nfunction Get-GameProcesses { param([string]`$Root) return @() }`r`n"
        # No signing setup here: the catalog Publish-Update signs (#2163, phase B) is left unsigned, and the stub answers that it passed.
        Put (Join-Path $fake 'scripts\release\Sign-ReleaseCatalog.ps1') "function Invoke-ReleaseCatalogSign { param([string]`$Catalog, [string]`$RepoDir) return '' }`r`n"
        [void](RunGit $fake init -q)
        [void](RunGit $fake @gitId add -A)
        [void](RunGit $fake @gitId commit -q -m 'the build')
        $head = (RunGit $fake rev-parse HEAD).Out
        [void](RunGit $fake checkout -q -b side)
        Put (Join-Path $fake 'side.txt') 'work main never took'
        [void](RunGit $fake @gitId add side.txt)
        [void](RunGit $fake @gitId commit -q -m 'side work')
        $sideCommit = (RunGit $fake rev-parse HEAD).Out
        [void](RunGit $fake checkout -q --detach $head)
        # The release the note from before sourceCommit below came with, built
        # from what main has shipped.
        Tag-DevRelease $fake $head '20261001-215555-dev' '2026-10-01T21:56:40-06:00'
        Yes ("the stand-in checkout is clean at the build ({0})" -f $head.Substring(0, 12)) ((RunGit $fake status --porcelain).Out -eq '' -and $sideCommit -ne $head)

        $inst = Join-Path $Scratch 'install-dev'
        $pSite = Join-Path $Scratch 'site-pub'
        $rel = Join-Path $Scratch 'rel-dev'
        foreach ($dd in 'Game\Data', 'Profile\OwnGame', 'Launcher', 'dist') { New-Item -ItemType Directory -Force -Path (Join-Path $inst $dd) | Out-Null }
        New-Item -ItemType Directory -Force -Path (Join-Path $pSite 'feed'), (Join-Path $pSite 'feed-dev'), $rel | Out-Null
        [IO.File]::WriteAllLines((Join-Path $inst 'Profile\OwnGame\files.txt'), @('F|V|1024|638000000000000000|Data\collection.esp'))
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'the plugin, changed'
        Put (Join-Path $inst 'Profile\OwnGame\plugins.txt') "*ours.esp`r`n"
        $pluginHeader = [byte[]]::new(24)
        [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($pluginHeader, 0)
        foreach ($plugin in 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'ours.esp') {
            [IO.File]::WriteAllBytes((Join-Path $inst "Game\Data\$plugin"), $pluginHeader)
        }
        Put (Join-Path $inst 'Profile\OwnGame\loadorder.txt') "ours.esp`r`n"
        . (Join-Path $repo 'tests\fixtures\ui-front.ps1')
        Install-UiFrontFixture (Join-Path $inst 'Game')
        # The collection revision record, and a Vortex on it (#3597).
        . (Join-Path $repo 'tests\fixtures\collection-revision.ps1')
        $env:APPDATA = Join-Path $inst 'roaming'
        $null = Install-CollectionRevisionFixture -From $repo -RepoCopy $fake -AppData $env:APPDATA
        $node = Get-Command node -ErrorAction SilentlyContinue
        Yes 'node is on PATH, for the stand-in game server' ($null -ne $node)
        if ($null -eq $node) { Done }
        $serverJs = Join-Path $Scratch 'server.js'
        Put $serverJs ("const srv = require('http').createServer(function (q, s) { s.setHeader('Content-Type', 'application/json'); " +
                       "s.end(JSON.stringify({ mods: ['Skyrim.esm','Update.esm','Dawnguard.esm','HearthFires.esm','Dragonborn.esm','ours.esp'].map(filename => ({ filename, size: 24, crc32: 1 })) })); }); " +
                       "srv.listen(0, '127.0.0.1', function () { console.log('listening on 127.0.0.1:' + srv.address().port); });")
        $gpsi = New-Object Diagnostics.ProcessStartInfo
        $gpsi.FileName = $node.Source; $gpsi.Arguments = '"' + $serverJs + '"'
        $gpsi.UseShellExecute = $false; $gpsi.CreateNoWindow = $true; $gpsi.RedirectStandardOutput = $true; $gpsi.RedirectStandardError = $true
        $script:gameServer = [Diagnostics.Process]::Start($gpsi)
        $null = $script:gameServer.StandardError.ReadToEndAsync()
        $first = $script:gameServer.StandardOutput.ReadLineAsync()
        $heard = if ($first.Wait(15000)) { [string]$first.Result } else { '' }
        $pm = [regex]::Match($heard, '^listening on 127\.0\.0\.1:(\d+)$')
        $port = if ($pm.Success) { [int]$pm.Groups[1].Value } else { 0 }
        Yes "the stand-in game server is listening ($port)" ($port -gt 0)
        if (-not $port) { Done }
        $null = $script:gameServer.StandardOutput.ReadToEndAsync()
        Put (Join-Path $inst 'config.json') ('{"ServerAddress":"127.0.0.1","ServerPort":' + ($port - 1) + '}')
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.bsa') ('x' * 4096)
        # Main has shipped the build; the dev feed has one release on it, the
        # plugin as it was, and its notes go stale below.
        $pMain = [pscustomobject][ordered]@{ launcherVersion = '1.2.0'; packs = @(); news = @()
                                             release = [pscustomobject][ordered]@{ id = '20261005-235125'; channel = 'main'; commit = $head; uncommitted = 0 } }
        Put (Join-Path $pSite 'feed\version\00000001.json') ($pMain | ConvertTo-Json -Depth 6)
        # The stand-in UI front carries a SkyMP file (build.js), so the pack's source
        # notice reads records\client-build.json (#1318), copied above. The dev feed
        # already has that client runtime, as a real dev feed does, so this run does
        # not stage the six runtime files the stand-in game folder never had.
        $pFork = [string](((Get-Content -LiteralPath (Join-Path $fake 'records\client-build.json') -Raw) -replace '^\uFEFF', '') | ConvertFrom-Json).forkCommit
        Put (Join-Path $pSite 'feed-dev\version\00000001.json') ('{"launcherVersion":"1.2.0","packs":[],"news":[],"mainVersion":"1.1.106","clientRuntime":{"forkCommit":"' + $pFork + '","url":"https://example.invalid/client-runtime-' + $pFork + '.zip","sha256":"' + ('c' * 64) + '","bytes":4096,"notice":' + $noticeV + '}}')
        Put (Join-Path $pSite 'feed-dev\published.json') '{"Data\\Platform\\UI\\thornswood-ours.esp":"5:0000000000000000000000000000000000000000000000000000000000000000"}'
        function Publish([string[]]$extra) {
            $pu = Join-Path $fake 'scripts\release\Publish-Update.ps1'
            $argText = (@('-Channel', 'dev', '-Root', (Q $inst), '-ReleaseDir', (Q $rel), '-DistRoot', (Q (Join-Path $inst 'dist')), '-SiteDir', (Q $pSite),
                          '-SiteUrl', 'http://127.0.0.1:9', '-NoPause') + @($extra)) -join ' '
            $cmd = "`$global:ThornswoodPublishedRelease = ''; `$global:ThornswoodDevMarks = `$null; `$rc = 1; try { & $(Q $pu) $argText; `$rc = `$LASTEXITCODE } " +
                   "finally { 'PUBLISHED=[' + `$global:ThornswoodPublishedRelease + ']'; 'MARKS=[' + `$(if (`$global:ThornswoodDevMarks) { [string]`$global:ThornswoodDevMarks.Done } else { '' }) + ']' }; exit `$rc"
            $c = Child $cmd
            $p = [regex]::Match($c.Out, 'PUBLISHED=\[([^\]]*)\]'); $mk = [regex]::Match($c.Out, 'MARKS=\[([^\]]*)\]')
            return [pscustomobject]@{ Code = $c.Code; Out = $c.Out; Published = $(if ($p.Success) { $p.Groups[1].Value } else { '?' }); Marks = $(if ($mk.Success) { $mk.Groups[1].Value } else { '?' }) }
        }
        $pDevDir = Join-Path $pSite 'feed-dev'
        $r = Publish @('-Notes', "'Dev test release`n- one line'")
        YesR ("a dev release goes out first (exit {0}, {1})" -f $r.Code, $r.Published) ($r.Code -eq 0 -and $r.Published -match '-dev$') $r
        $afterRelease = Read-Json (SiteFeed $pDevDir)
        Yes '  and on the way it marks its notes against main, as it always did' ($afterRelease.mainVersion -eq '1.2.0' -and @($afterRelease.news).Count -eq 1 -and $afterRelease.news[0].channel -eq '')

        # Stale marks, the shape of 6 Oct: what main has marked DEV, mainVersion behind.
        function Make-Stale {
            $d = Read-Json (SiteFeed $pDevDir)
            $notes = @($d.news) + @(
                [pscustomobject]@{ date = '10-5-2026 3:25 PM'; title = 'Work main never took'; body = ''; details = @('x'); channel = 'dev'; sourceCommit = $sideCommit },
                [pscustomobject]@{ date = '10-5-2026 1:08 PM'; title = 'Work main has'; body = ''; details = @('x'); channel = 'dev'; sourceCommit = $head },
                [pscustomobject]@{ date = '10-1-2026 9:56 PM'; title = 'Note from before sourceCommit'; body = ''; details = @('x'); channel = 'dev' })
            foreach ($n in $notes) { $n.channel = 'dev' }
            $d.news = $notes; $d.mainVersion = '1.1.106'
            Put-SiteFeed $pDevDir ($d | ConvertTo-Json -Depth 6)
        }
        Make-Stale
        $before = Read-Json (SiteFeed $pDevDir)
        $packsBefore = @($before.packs).Count
        $relLines = { @(if (Test-Path -LiteralPath (Join-Path $pSite 'feed-dev\releases.txt')) { Get-Content -LiteralPath (Join-Path $pSite 'feed-dev\releases.txt') | Where-Object { $_ } }).Count }
        $relBefore = & $relLines
        $pubBefore = Sha (Join-Path $pSite 'feed-dev\published.json')
        $r = Publish @('-Notes', "'Dev and main match again`n- the notes main has lose the mark'")
        YesR ("the same build again is Nothing to do, exit 2, and no release is named (exit {0}, [{1}])" -f $r.Code, $r.Published) (
            $r.Code -eq 2 -and $r.Out -match 'Nothing to do' -and $r.Published -eq '') $r
        Yes '  it says nothing was released and nothing was added to the news' ($r.Out -match 'Nothing was released, so nothing was added to the news')
        $after = Read-Json (SiteFeed $pDevDir)
        Yes ("  the store's dev feed marks DEV only the work main never took ({0} marked)" -f @($after.news | Where-Object { $_.channel -eq 'dev' }).Count) (
            @($after.news | Where-Object { $_.channel -eq 'dev' }).Count -eq 1 -and @($after.news | Where-Object { $_.channel -eq 'dev' })[0].title -eq 'Work main never took')
        Yes '  and says main is on 1.2.0' ($after.mainVersion -eq '1.2.0')
        Yes '  no news entry was added and no pack, release or baseline moved' (
            @($after.news).Count -eq @($before.news).Count -and @($after.packs).Count -eq $packsBefore -and
            (& $relLines) -eq $relBefore -and [string]$after.release.id -eq [string]$before.release.id -and
            (Sha (Join-Path $pSite 'feed-dev\published.json')) -eq $pubBefore)
        Yes ("  and the publisher tells Ship the marks were refreshed ({0})" -f $r.Marks) ($r.Marks -eq 'True')

        Make-Stale
        $staleSha = Sha (SiteFeed $pDevDir)
        # -NoPush reads the copy last received rather than the VPS, so receive the
        # stale one the way the run before a dry run would have.
        [void](Receive-FeedStore 'dev' $rel -SiteDir $pSite)
        $r = Publish @('-Notes', "'Dev and main match again`n- a dry run'", '-NoUpload', '-NoPush', '-NoClose', '-KeepPacks', '0')
        YesR ("with -NoPush (what Ship -DryRun passes) it exits 2 and sends nothing (exit {0})" -f $r.Code) ($r.Code -eq 2 -and (Sha (SiteFeed $pDevDir)) -eq $staleSha -and
            $r.Out -match 'this run sends nothing') $r

        # Main sees exit 2 as well when its build matches, and touches no dev feed.
        Put (Join-Path $pSite 'feed\published.json') ([IO.File]::ReadAllText((Join-Path $pSite 'feed-dev\published.json')))
        $pMain2 = Read-Json (SiteFeed (Join-Path $pSite 'feed'))
        $pMain2 | Add-Member -NotePropertyName baseline -NotePropertyValue $afterRelease.baseline -Force
        Put-SiteFeed (Join-Path $pSite 'feed') ($pMain2 | ConvertTo-Json -Depth 6)
        $relMain = Join-Path $Scratch 'rel-main'
        $pu = Join-Path $fake 'scripts\release\Publish-Update.ps1'
        $c = Child ("`$global:ThornswoodDevMarks = `$null; & " + (Q $pu) + " -Root " + (Q $inst) + " -ReleaseDir " + (Q $relMain) + " -DistRoot " + (Q (Join-Path $inst 'dist')) +
                    " -SiteDir " + (Q $pSite) + " -SiteUrl 'http://127.0.0.1:9' -NoPause -Notes 'Main again`n- nothing new'; `$rc = `$LASTEXITCODE; 'MARKS=[' + [string](`$null -ne `$global:ThornswoodDevMarks) + ']'; exit `$rc")
        YesR ("a main publish with nothing new exits 2 too, and leaves the dev feed alone (exit {0})" -f $c.Code) ($c.Code -eq 2 -and $c.Out -match 'MARKS=\[False\]' -and
            (Sha (SiteFeed $pDevDir)) -eq $staleSha) $c
    } else {
        Write-Host 'SKIP  the real Publish-Update.ps1 on the dev channel: a release that signs here makes its catalog with New-FileCatalog, which only Windows has'
    }

    # ---- 4. Ship.ps1 from the publisher on -----------------------------------------
    Write-Host ''; Write-Host 'Ship.ps1 after the publisher'
    $shipPath = Join-Path $repo 'scripts\release\Ship.ps1'
    $shipSrc = [IO.File]::ReadAllText($shipPath)
    $mark = '$published = $LASTEXITCODE'
    $at = $shipSrc.IndexOf($mark)
    Yes 'Ship.ps1 reads the publisher''s exit code as $published' ($at -ge 0)
    if ($at -lt 0) { Done }
    $tail = $shipSrc.Substring($at + $mark.Length)
    # Stand-ins for what follows a release, each writing its name to a file.
    $stand = Join-Path $Scratch 'ship'
    $calls = Join-Path $Scratch 'calls.txt'
    $standIn = "Add-Content -LiteralPath " + (Q $calls) + " -Value '{0}'; if (`$env:TS_FAIL -eq '{0}') {{ exit 1 }}; exit 0"
    foreach ($s in @(@('release\Publish-PostShip.ps1', 'remirror'), @('release\Refresh-DevNews.ps1', 'refresh'),
                     @('ops\Publish-Discord.ps1', 'discord'), @('vps\Request-Restart.ps1', 'server'))) {
        Put (Join-Path $stand $s[0]) ($standIn -f $s[1])
    }
    $prelude = @'
param([string]$Channel, [int]$Published, [string]$Release, [switch]$DryRun, [string]$Marks)
$ErrorActionPreference = 'Stop'
function Say($m, $c = 'Gray') { Write-Host $m }
function Head($m) { Write-Host ''; Write-Host $m }
function Die($m) { Write-Host "STOP. $m"; exit 1 }
function Unbump([string]$why) { Write-Host "UNBUMP $why" }
function Measure-Installer { [pscustomobject]@{ DistDir = 'x'; Known = $true; Why = ''; Release = '20260101-000000'; Behind = 0 } }
function Add-ReleaseTag { Add-Content -LiteralPath $env:TS_CALLS -Value 'tag'; [pscustomobject]@{ Why = ''; Tag = 'release/x'; Commit = ('a' * 40); PutRight = '' } }
$Here = Join-Path $env:TS_STAND 'release'
$Dev = ($Channel -eq 'dev')
$NoPause = $true; $NoAnnounce = $false; $AnnounceMinutes = 5; $Package = $false; $ciStub = ''
# A folder that is not there, on this machine's own drive: off Windows there
# is no C:, and Join-Path stops on a drive that is not there.
$Root = Join-Path $env:TS_REL 'nowhere'; $DistRoot = $Root; $RepoDir = $Root; $ReleaseDir = $env:TS_REL
$Notes = "A note`n- a line"; $current = '1.2.0'; $target = '1.2.0'; $dryKeep = @()
$script:InstallerFailed = 0; $script:PostShipFailed = @()
$global:ThornswoodDiscordResult = ''
$global:ThornswoodPublishedRelease = $Release
$global:ThornswoodDevMarks = $null
if ($Marks -eq 'done') { $global:ThornswoodDevMarks = [pscustomobject]@{ Done = $true; Lines = @('1 of 40 notes marked DEV against main 1.2.0, 27 before') } }
if ($Marks -eq 'failed') { $global:ThornswoodDevMarks = [pscustomobject]@{ Done = $false; Lines = @('The site has no main feed, so the dev marks were left alone.') } }
$global:LASTEXITCODE = $Published
$published = $LASTEXITCODE
'@
    $shipTail = Join-Path $Scratch 'ship-tail.ps1'
    Put $shipTail ($prelude + $tail)
    $relDir = Join-Path $Scratch 'ship-rel'
    function ShipRun([string]$channel, [int]$code, [string]$release, [string]$marks, [string]$failing = '') {
        if (Test-Path -LiteralPath $calls) { Remove-Item -LiteralPath $calls -Force }
        # What the publisher left: version.json naming the release it sent,
        # which is what Ship holds a publisher that said 0 to (#4825).
        Put (Join-Path $relDir 'version.json') ('{"release":{"id":"' + $release + '"}}')
        $env:TS_CALLS = $calls; $env:TS_STAND = $stand; $env:TS_REL = $relDir; $env:TS_FAIL = $failing
        $cmd = "& " + (Q $shipTail) + " -Channel $channel -Published $code -Release " + (Q $release) + " -Marks " + (Q $marks) + "; exit `$LASTEXITCODE"
        $c = Child $cmd
        $got = @(if (Test-Path -LiteralPath $calls) { Get-Content -LiteralPath $calls | Where-Object { $_ } })
        return [pscustomobject]@{ Code = $c.Code; Out = $c.Out; Calls = $got }
    }
    try {
        $s = ShipRun 'dev' 2 '' 'done'
        YesR ("dev, nothing new: nothing is posted, no server is told, no tag (called: {0})" -f ($s.Calls -join ', ')) ($s.Calls.Count -eq 0 -and $s.Code -eq 0) $s
        Yes '  it says nothing was released and nobody was told' ($s.Out -match 'Nothing was released' -and $s.Out -match 'was not posted to, and no server was told')
        Yes '  and that the dev marks were refreshed, with what moved' ($s.Out -match "DEV marks were refreshed against main" -and $s.Out -match '1 of 40 notes marked DEV')

        $s = ShipRun 'dev' 2 '' 'failed'
        YesR ("dev, nothing new, marks not refreshed: still nobody told (called: {0})" -f ($s.Calls -join ', ')) ($s.Calls.Count -eq 0) $s
        Yes '  it says the marks were NOT refreshed, why, and what does it on its own' ($s.Out -match 'were NOT refreshed' -and $s.Out -match 'no main feed' -and
            $s.Out -match [regex]::Escape('.\scripts\release\Refresh-DevNews.ps1'))

        $s = ShipRun 'dev' 0 '' ''
        YesR ("a publisher that says 0 but names no release is not announced (exit {0}, called: {1})" -f $s.Code, ($s.Calls -join ', ')) (
            $s.Calls.Count -eq 0 -and $s.Code -eq 1 -and $s.Out -match 'NOTHING WAS PUBLISHED') $s

        $s = ShipRun 'main' 2 '' ''
        YesR ("main, nothing new: nobody told, and the dev marks are left as they are (called: {0})" -f ($s.Calls -join ', ')) (
            $s.Calls.Count -eq 0 -and $s.Out -match "DEV marks were not touched") $s

        $s = ShipRun 'main' 0 '20261005-235125' ''
        YesR ("main, released: the dev marks follow at once, after the remirror and before anybody is told ({0})" -f ($s.Calls -join ', ')) (
            ($s.Calls -join ',') -eq 'remirror,refresh,discord,server,tag') $s

        $s = ShipRun 'main' 0 '20261005-235125' '' 'refresh'
        YesR ("  a refresh that fails does not fail the release (exit {0}, called: {1})" -f $s.Code, ($s.Calls -join ', ')) (
            $s.Code -eq 0 -and ($s.Calls -join ',') -eq 'remirror,refresh,discord,server,tag') $s
        Yes '  and Done names it with the command that does it again' ($s.Out -match "the dev feed's DEV marks" -and $s.Out -match [regex]::Escape('.\scripts\release\Refresh-DevNews.ps1'))

        $s = ShipRun 'dev' 0 '20261006-110000-dev' ''
        YesR ("dev, released: announced as before, and no separate refresh, the publish marked it (called: {0})" -f ($s.Calls -join ', ')) (
            ($s.Calls -join ',') -eq 'remirror,discord,server,tag') $s
    } finally {
        foreach ($k in 'TS_CALLS', 'TS_STAND', 'TS_REL', 'TS_FAIL') { [Environment]::SetEnvironmentVariable($k, $null) }
    }
}
finally {
    if ($script:gameServer) { try { if (-not $script:gameServer.HasExited) { $script:gameServer.Kill() } } catch { } }
    foreach ($k in @($oldEnv.Keys)) { [Environment]::SetEnvironmentVariable($k, $oldEnv[$k]) }
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
