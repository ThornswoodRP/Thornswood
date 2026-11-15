<#
  test-baseline-commit.ps1

  A Ship sends the baseline it moves to the VPS, so the next Ship on any
  machine starts from it.

  MEASURED 27 SEPTEMBER. Publish-Update writes published.json after the feed
  goes out, on purpose, and nothing committed it. The 18:55 dev release left
  it modified in Thornswood-Releases-dev, and the 19:02 Ship stopped on
  "cannot pull with rebase: You have unstaged changes" with nothing published.
  That was fixed by committing it as "Baseline <id>". Since #907 the baseline
  is not in a git clone at all: it lives on the VPS beside the feed
  (scripts\release\Feed-Store.ps1), and Send-Baseline sends it there.

  This lifts the block between the baseline send markers out of the real
  Publish-Update.ps1 and runs it against a scratch folder standing in for the
  VPS store:
    1. after a release, published.json is on the VPS and the old one is kept
       in history
    2. -NoPush sends nothing
    3. a baseline another Ship moved up there meanwhile is not overwritten,
       and the release is not failed for it
  and reads the order in the script: the baseline is saved and sent only after
  the feed (version.json, and releases.json since #2361) was sent, and never
  when the feed send failed.

  Read only apart from its own temp folder.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$src = Get-Content -Raw (Join-Path $PSScriptRoot '..\..\scripts\release\Publish-Update.ps1')

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$m = [regex]::Match($src, '(?s)# ==== thornswood baseline send ====.*?# ==== end thornswood baseline send ====')
Yes 'the baseline send block is in Publish-Update.ps1' $m.Success
Yes 'it runs after the release is saved' ($src -match '(?s)Save-State\s+\$pendingWhy = Clear-Pending \$StateFile\s+Send-Baseline \$Id')
$send = [regex]::Match($src, '(?s)# ==== thornswood feed send ====.*?# ==== end thornswood feed send ====')
Yes 'the feed send block is in Publish-Update.ps1' $send.Success
if ($send.Success) {
    $b = $send.Value
    # Since #2361 (#1050) the files go in $feedFiles, version.json first and
    # the store's releases.json beside it when there is one.
    $feedAt = $b.IndexOf("Send-FeedStore `$Channel `$ReleaseDir `$feedFiles")
    $listAt = $b.IndexOf("`$feedFiles = @('version.json')")
    Yes 'the feed goes to the VPS before the baseline moves' ($listAt -ge 0 -and $listAt -lt $feedAt -and $feedAt -lt $b.IndexOf('Save-State'))
    Yes 'and a feed that did not go leaves the baseline where it was, with a note to finish it' ($b -match '(?s)if \(\$pushFailed\) \{\s+\$pendingWhy = Write-Pending')
}
Yes 'nothing in Publish-Update commits or pushes a baseline any more' (-not ($src -match 'git -C \$ReleaseDir (add|commit|push|pull)'))

$script:said = @()
function Say($m, $c = 'Gray') { $script:said += [string]$m }
. (Join-Path $PSScriptRoot '..\..\scripts\release\Feed-Store.ps1')
if ($m.Success) { . ([scriptblock]::Create($m.Value)) }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('baseline-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $SiteDir = Join-Path $tmp 'site'
    $ReleaseDir = Join-Path $tmp 'store'
    $Channel = 'dev'
    New-Item -ItemType Directory -Path (Join-Path $SiteDir 'feed-dev') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $SiteDir 'feed-dev\version.json'), '{"launcherVersion":"1.1.102.1"}')
    [IO.File]::WriteAllText((Join-Path $SiteDir 'feed-dev\published.json'), '{"a":"1"}')
    [void](Receive-FeedStore $Channel $ReleaseDir -SiteDir $SiteDir)
    function Up { [IO.File]::ReadAllText((Join-Path $SiteDir 'feed-dev\published.json')) }

    # 1. after a release
    $NoPush = $false
    $script:said = @()
    [IO.File]::WriteAllText((Join-Path $ReleaseDir 'published.json'), '{"a":"2"}')
    Send-Baseline '20260928-1902-dev'
    Yes 'after a release the baseline is on the VPS' ((Up) -eq '{"a":"2"}')
    Yes 'and the one it replaced is kept in history' (@(Get-ChildItem -LiteralPath (Join-Path $SiteDir 'feed-dev\history') -Filter '*-published.json').Count -eq 1)
    Yes 'and it says so' (($script:said -join "`n") -like '*baseline 20260928-1902-dev sent to the VPS*')

    # 2. -NoPush
    $NoPush = $true
    [IO.File]::WriteAllText((Join-Path $ReleaseDir 'published.json'), '{"a":"3"}')
    Send-Baseline 'x'
    Yes '-NoPush sends nothing' ((Up) -eq '{"a":"2"}')

    # 3. another Ship moved it meanwhile
    $NoPush = $false
    $script:said = @()
    [IO.File]::WriteAllText((Join-Path $SiteDir 'feed-dev\published.json'), '{"other":"machine"}')
    [IO.File]::WriteAllText((Join-Path $ReleaseDir 'published.json'), '{"a":"4"}')
    $threw = $false
    try { Send-Baseline 'y' } catch { $threw = $true }
    Yes 'a baseline another Ship moved up there is not overwritten' ((Up) -eq '{"other":"machine"}')
    Yes 'and the release is not failed for it' (-not $threw)
    Yes 'it says the next Ship packs these files again' (($script:said -join "`n") -like '*next Ship packs these files again*')
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$pass passed, $fail failed"
exit $(if ($fail) { 1 } else { 0 })
