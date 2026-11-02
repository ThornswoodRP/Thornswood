# test-2180-feed-sends.ps1
#
#     pwsh -NoProfile -File .\tests\test-2180-feed-sends.ps1
#
# Every feed file is held to its contract before it is sent (#2180). Send-FeedStore
# in scripts\release\Feed-Store.ps1 is the one way version.json, published.json
# and releases.json reach the VPS store, so Publish-Update, Rollback-Feed,
# Scrub-Feed and every other writer go through it. It now refuses a file
# RecordShape.ps1's feed contract does not pass, naming the file and the field,
# before anything goes up: the store keeps its files byte for byte, no .part is
# left, nothing goes to history and read.json does not move.
#
# The store is a scratch folder (-SiteDir, the same script the VPS runs). The
# refusals happen before the first byte goes up, so they run anywhere. A send
# that passes ends in the store's rename, which is a Windows call (Feed-Store.ps1,
# the one rename), so that half runs where the build check and the nightly run
# it, on Windows, and says so elsewhere. Offline.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\Feed-Store.ps1')
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Put([string]$p, [string]$text) { [IO.File]::WriteAllText($p, $text, (New-Object Text.UTF8Encoding($false))) }
function Threw([scriptblock]$b) { try { $null = & $b; return '' } catch { return $_.Exception.Message } }
. (Join-Path $PSScriptRoot 'Windows.ps1')   # $OnWindows (#2957)

$sample = Join-Path $repo 'tests\fixtures\feed-2180'
$goodVersion = [IO.File]::ReadAllText((Join-Path $sample 'version.json'))
$goodReleases = [IO.File]::ReadAllText((Join-Path $sample 'releases.json'))
$goodPublished = '{ "Data\\Thornswood-Content.esp": "146941:' + ('d' * 64) + '", ":gone:Data\\Interface\\map.swf": "always" }'

$T = Join-Path ([IO.Path]::GetTempPath()) ('tw-2180send ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    # A store up there and this machine's working folder, received from it.
    $site = Join-Path $T 'site'
    $up = Join-Path $site 'feed-dev'
    $dir = Join-Path $T 'work'
    $null = New-Item -ItemType Directory -Path (Join-Path $up 'version'), $dir -Force
    # The store's feed is the newest of its generations (#2727).
    function UpFile([string]$n) { if ($n -eq 'version.json') { return (Get-FeedVersionFile $up) } return (Join-Path $up $n) }
    Put (Join-Path $up 'version\00000001.json') $goodVersion
    Put (Join-Path $up 'published.json') $goodPublished
    Put (Join-Path $up 'releases.json') $goodReleases
    $expect = @{}
    foreach ($n in 'version.json', 'published.json', 'releases.json') {
        Copy-Item -LiteralPath (UpFile $n) -Destination (Join-Path $dir $n)
        $expect[$n] = Get-FeedStoreSha (UpFile $n)
    }
    $shaBefore = @{}; foreach ($n in $expect.Keys) { $shaBefore[$n] = $expect[$n] }

    function StoreUntouched {
        foreach ($n in @($shaBefore.Keys)) { if ((Get-FeedStoreSha (UpFile $n)) -ne $shaBefore[$n]) { return $false } }
        if (@(Get-ChildItem -LiteralPath (Join-Path $up 'version') -File).Count -ne 1) { return $false }
        if (@(Get-ChildItem -LiteralPath $up -Filter '*.part' -File).Count) { return $false }
        if (Test-Path -LiteralPath (Join-Path $up 'history')) { return $false }
        return $true
    }

    Yes 'every feed file the store keeps has a contract, and announced.json has none' (
        (Get-FeedStoreKind 'version.json') -eq 'feed-version' -and (Get-FeedStoreKind 'published.json') -eq 'feed-published' -and
        (Get-FeedStoreKind 'releases.json') -eq 'feed-releases' -and (Get-FeedStoreKind 'announced.json') -eq '')

    # Each case: the working folder's copy of one file broken one way, what must be named.
    $cases = @(
        @{ What = 'a version.json a launcher cannot read (maxOnline as text)'; File = 'version.json'; Text = $goodVersion.Replace('"maxOnline": 40', '"maxOnline": "40"'); Says = 'maxOnline is there and not a whole number' },
        @{ What = 'a version.json with no launcherVersion'; File = 'version.json'; Text = $goodVersion.Replace('"launcherVersion": "1.4.2",', ''); Says = 'launcherVersion is missing' },
        @{ What = 'a version.json cut off'; File = 'version.json'; Text = $goodVersion.Substring(0, 80); Says = 'not valid JSON' },
        @{ What = 'a version.json from a newer checkout'; File = 'version.json'; Text = $goodVersion.Replace('"launcherVersion"', '"version": 2, "launcherVersion"'); Says = 'it is version 2' },
        @{ What = 'a published.json with a value that is not text'; File = 'published.json'; Text = '{"Data/Thornswood.esp": 5}'; Says = 'Data/Thornswood.esp is not text' },
        @{ What = 'a releases.json whose release has no sha256'; File = 'releases.json'; Text = '[ { "id": "20261011-175014", "url": "u", "entries": 2 } ]'; Says = 'release 20261011-175014 has no sha256' }
    )
    foreach ($c in $cases) {
        Put (Join-Path $dir $c.File) $c.Text
        $files = @('version.json'); if ($c.File -ne 'version.json') { $files += $c.File }
        $why = Threw { Send-FeedStore 'dev' $dir $files -SiteDir $site -Expect $expect }
        Yes ("{0} is refused, naming the file and the field" -f $c.What) ($why.Contains($c.File) -and $why.Contains($c.Says) -and $why.Contains('Nothing was sent'))
        Yes '  and the store up there is as it was, with no .part and nothing in history' (StoreUntouched)
        Copy-Item -LiteralPath (UpFile $c.File) -Destination (Join-Path $dir $c.File) -Force
    }

    # A file sent unchanged is held too: a store already out of shape is
    # refused by name rather than sent on again beside a new file.
    Put (Join-Path $up 'releases.json') '[ { "id": "x" } ]'
    $expect['releases.json'] = Get-FeedStoreSha (Join-Path $up 'releases.json')
    $shaBefore['releases.json'] = $expect['releases.json']
    Copy-Item -LiteralPath (Join-Path $up 'releases.json') -Destination (Join-Path $dir 'releases.json') -Force
    $why = Threw { Send-FeedStore 'dev' $dir @('version.json', 'releases.json') -SiteDir $site -Expect $expect }
    Yes 'a releases.json already out of shape up there is refused when it is named in a send' ($why.Contains('releases.json') -and $why.Contains('release x has no sha256'))
    Yes '  and nothing is replaced' (StoreUntouched)
    Put (Join-Path $up 'releases.json') $goodReleases
    Copy-Item -LiteralPath (Join-Path $up 'releases.json') -Destination (Join-Path $dir 'releases.json') -Force
    $expect['releases.json'] = Get-FeedStoreSha (Join-Path $up 'releases.json')
    $shaBefore['releases.json'] = $expect['releases.json']

    # The three scripts #2180 names send the feed only through Send-FeedStore,
    # and nothing outside Feed-Store.ps1 writes the store another way.
    foreach ($s in 'Publish-Update.ps1', 'Rollback-Feed.ps1', 'Scrub-Feed.ps1') {
        $t = [IO.File]::ReadAllText((Join-Path $repo ('scripts\release\' + $s)))
        Yes "$s sends the feed through Send-FeedStore" ($t -match 'Send-FeedStore \$Channel \$ReleaseDir')
    }
    $other = @(Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -Recurse -File -Filter '*.ps1' |
        Where-Object { $_.Name -ne 'Feed-Store.ps1' -and ([IO.File]::ReadAllText($_.FullName)) -match 'Invoke-FeedStoreOp|Copy-FeedStoreFile|FeedStoreBody|New-FeedStoreScript' } |
        ForEach-Object { $_.Name })
    Yes 'no script but Feed-Store.ps1 reaches the store by another route' ($other.Count -eq 0)
    foreach ($o in $other) { Write-Host "        another route: $o" }

    if ($onWindows) {
        $next = $goodVersion.Replace('"launcherVersion": "1.4.2"', '"launcherVersion": "1.4.3"')
        Put (Join-Path $dir 'version.json') $next
        $r = Send-FeedStore 'dev' $dir @('version.json', 'releases.json') -SiteDir $site -Expect $expect
        Yes 'a version.json in shape is sent, and the store has it' (@($r.Sent) -contains 'version.json' -and
            (Get-FeedStoreSha (UpFile 'version.json')) -eq (Get-FeedStoreSha (Join-Path $dir 'version.json')))
        Yes '  and releases.json, unchanged, is not sent again' (@($r.Same) -contains 'releases.json')
    } else {
        Write-Host 'SKIP  a send in shape ends in the store''s Windows rename; the build check runs this half on Windows'
    }
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
