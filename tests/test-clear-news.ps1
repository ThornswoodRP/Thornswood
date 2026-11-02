<#
  test-clear-news.ps1

      pwsh -NoProfile -File .\tests\test-clear-news.ps1

  Every note comes off a channel (Patrick, 22 Oct 2026: start clean under
  the new rules). Offline: a folder stands in for the site and the VPS store
  ($env:THORNSWOOD_TEST_SITE_DIR), so nothing connects anywhere.

    - Clear-News.ps1 -Check names every note and sends nothing.
    - On main, whose notes are a news file (minLauncher 1.2.4 on), the feed
      names an empty file afterwards, which the site writes its News page
      from by itself (#5187, tests/test-5187-site-news.js), and the record of #news posts loses its lines while the
      releases it says were announced stay.
    - On dev, whose notes are in "news" (minLauncher before 1.2.4), "news"
      is empty afterwards and no news page is written.
    - A second run finds nothing.
    - Nothing puts hand-written history back: news-public.json and
      Publish-News.ps1 are gone (#5187), and Clear-News sends no news page.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pwshExe = (Get-Process -Id $PID).Path
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-clear-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$site = Join-Path $tmp 'site'
New-Item -ItemType Directory -Force -Path (Join-Path $site 'feed'), (Join-Path $site 'feed-dev') | Out-Null
$env:THORNSWOOD_TEST_SITE_DIR = $site
try {
    . (Join-Path $repo 'scripts\release\Feed-Store.ps1')
    . (Join-Path $repo 'scripts\release\Feed-News.ps1')
    $clear = Join-Path $repo 'scripts\release\Clear-News.ps1'

    # ---- main: the notes are a news file on the site
    $old = @(
        [pscustomobject]@{ date = '10-17-2026 8:59 PM'; title = 'Merchants and quests'; body = ''; details = @('Merchants buy and sell.'); channel = '' },
        [pscustomobject]@{ date = '10-12-2026 1:00 PM'; title = 'An older note'; body = 'Old words.'; details = @('Something old.'); channel = '' }
    )
    $newsJson = ConvertTo-Json -InputObject $old -Depth 6
    $newsFile = Join-Path $tmp 'news-old.json'
    Put $newsFile $newsJson
    $sha = Get-BaselineFileSha $newsFile
    Put (Join-Path $site "feed\assets\$sha") $newsJson
    $mainDoc = [pscustomobject]@{ launcherVersion = '1.2.5'; minLauncher = '1.2.5'; news = @()
        newsFile = [pscustomobject]@{ url = "https://thornswood.net/feed/assets/$sha"; sha256 = $sha; count = 2 } }
    Put (Join-Path $site 'feed\version\00000001.json') ($mainDoc | ConvertTo-Json -Depth 6)
    Put (Join-Path $site 'feed\announced.json') (@{ version = '1.2.5'; title = 'Merchants and quests'
        'posts-main' = @(@{ at = '2026-10-17T20:59:00Z'; title = 'Merchants and quests'; details = @('Merchants buy and sell.'); kind = 'release' }) } | ConvertTo-Json -Depth 6)

    # ---- dev: the notes are in "news"
    $devDoc = [pscustomobject]@{ launcherVersion = '1.2.3'; minLauncher = '1.2.3'
        news = @([pscustomobject]@{ date = '10-22-2026 9:42 AM'; title = 'Lighter gallery pictures'; body = ''; details = @('Smaller copies.'); channel = 'dev' }) }
    Put (Join-Path $site 'feed-dev\version\00000001.json') ($devDoc | ConvertTo-Json -Depth 6)

    function Get-SiteFeed([string]$name) { [IO.File]::ReadAllText((Get-FeedVersionFile (Join-Path $site $name))) }

    $before = Get-SiteFeed 'feed'
    $out = & $pwshExe -NoProfile -File $clear -Channel main -Check -Dir (Join-Path $tmp 'work\main') -NoPause 2>&1 | Out-String
    Yes '-Check names both main notes and the Discord record, and sends nothing' ($LASTEXITCODE -eq 0 -and ([regex]::Matches($out, 'would take off')).Count -eq 2 -and
        $out -match 'lines of 1 Discord post' -and (Get-SiteFeed 'feed') -eq $before -and -not (Test-Path (Join-Path $site 'data\news.json')))

    $out = & $pwshExe -NoProfile -File $clear -Channel main -Dir (Join-Path $tmp 'work\main') -NoPause 2>&1 | Out-String
    $after = Get-SiteFeed 'feed' | ConvertFrom-Json
    Yes 'main clears' ($LASTEXITCODE -eq 0)
    Yes 'the main feed names a news file with no notes, and "news" is empty' ($after.newsFile.count -eq 0 -and @($after.news).Count -eq 0 -and $after.newsFile.sha256 -ne $sha)
    Yes 'and that file is on the site' ((Test-Path (Join-Path $site "feed\assets\$($after.newsFile.sha256)")) -and @(Get-FeedNewsList $after $site).Count -eq 0)
    Yes 'no News page is sent: the site writes it from the feed itself (#5187)' (-not (Test-Path (Join-Path $site 'data\news.json')) -and $out -match 'site writes its News page')
    $rec = [IO.File]::ReadAllText((Join-Path $site 'feed\announced.json')) | ConvertFrom-Json
    Yes 'the record loses its post lines and keeps the release it says was announced' (-not $rec.PSObject.Properties['posts-main'] -and $rec.version -eq '1.2.5' -and $rec.title -eq 'Merchants and quests')

    $out = & $pwshExe -NoProfile -File $clear -Channel dev -Dir (Join-Path $tmp 'work\dev') -NoPause 2>&1 | Out-String
    $afterDev = Get-SiteFeed 'feed-dev' | ConvertFrom-Json
    Yes 'dev clears, its notes kept in "news" and no news file named' ($LASTEXITCODE -eq 0 -and @($afterDev.news).Count -eq 0 -and -not $afterDev.PSObject.Properties['newsFile'])
    Yes 'a dev channel with no record of posts is fine' ($out -match 'Discord posts holds no lines')
    Yes 'and dev writes no site News page' ($out -notmatch 'News page')

    $out = & $pwshExe -NoProfile -File $clear -Channel main -Dir (Join-Path $tmp 'work\main') -NoPause 2>&1 | Out-String
    Yes 'a second run finds nothing' ($LASTEXITCODE -eq 0 -and $out -match 'feed has no notes' -and $out -match 'holds no lines')

    # ---- nothing puts the old notes back
    Yes 'news-public.json is gone' (-not (Test-Path (Join-Path $repo 'scripts\ops\news-public.json')))
    Yes 'Publish-News.ps1 is gone: the site writes its own News page (#5187)' (-not (Test-Path (Join-Path $repo 'scripts\ops\Publish-News.ps1')))
} finally {
    Remove-Item Env:\THORNSWOOD_TEST_SITE_DIR -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "$pass passed, $fail failed"
exit $(if ($fail) { 1 } else { 0 })
