# test-2180-feed-records.ps1
#
#     pwsh -NoProfile -File .\tests\test-2180-feed-records.ps1
#
# The feed store's version.json, published.json and releases.json held to
# RecordShape.ps1's feed contracts (#2180, slice 5), and Check-Records -Feed
# enforcing them. version.json is held to launcher\app\Config.cs VersionDoc:
# its serializer drops the whole document on one value of the wrong type,
# which shuts Play on every launcher. tests\fixtures\feed-2180 is a committed
# sample that passes; each break below is that sample with one thing wrong.
# Offline.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\RecordShape.ps1')
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$exe = (Get-Process -Id $PID).Path
$check = Join-Path $repo 'scripts\release\Check-Records.ps1'
$committed = Join-Path $repo 'tests\fixtures\feed-2180'
function Run([string]$dir) { $o = @(& $exe -NoProfile -NonInteractive -File $check -Feed $dir 2>&1 | ForEach-Object { "$_" }); return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($o -join "`n") } }

# The sample store: version.json and releases.json are committed, and
# published.json is written here, because .gitignore keeps every file of that
# name out of the repository (a baseline is the VPS store's, never git's).
$fx = Join-Path ([IO.Path]::GetTempPath()) ('tw-2180sample ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $fx
foreach ($f in 'version.json', 'releases.json') { Copy-Item -LiteralPath (Join-Path $committed $f) -Destination (Join-Path $fx $f) }
[IO.File]::WriteAllText((Join-Path $fx 'published.json'), ('{ "Data\\Thornswood-Content.esp": "146941:' + ('d' * 64) + '", ":gone:Data\\Interface\\map.swf": "always" }'), (New-Object Text.UTF8Encoding($false)))

$r = Run $fx
Yes 'Check-Records -Feed passes the committed sample feed' ($r.Code -eq 0 -and $r.Out -match 'OK\s+feed-version' -and $r.Out -match 'OK\s+feed-published' -and $r.Out -match 'OK\s+feed-releases')
$r = & $exe -NoProfile -NonInteractive -File $check 2>&1 | Out-String
Yes 'Check-Records without -Feed still passes the committed records and does not ask for feed files' ($LASTEXITCODE -eq 0 -and $r -notmatch 'feed-')

# Each case: the sample with one change, the file it is in, and what must be named.
$base = Get-Content -LiteralPath (Join-Path $fx 'version.json') -Raw
$cases = @(
    @{ What = 'maxOnline as a quoted number'; File = 'version.json'; Text = $base.Replace('"maxOnline": 40', '"maxOnline": "40"'); Says = 'maxOnline is there and not a whole number' },
    @{ What = 'collectionRevision null'; File = 'version.json'; Text = $base.Replace('"collectionRevision": 12', '"collectionRevision": null'); Says = 'collectionRevision is there and not a whole number' },
    @{ What = 'maintenance as true'; File = 'version.json'; Text = $base.Replace('"message": ""', '"message": "", "maintenance": true'); Says = 'maintenance is not text' },
    @{ What = 'no launcherVersion'; File = 'version.json'; Text = $base.Replace('"launcherVersion": "1.4.2",', ''); Says = 'launcherVersion is missing' },
    @{ What = 'a pack with no sha256'; File = 'version.json'; Text = [regex]::Replace($base, '"sha256": "c{64}", "notes"', '"notes"'); Says = 'packs.20261011-175014 has no sha256' },
    @{ What = 'packs as an object'; File = 'version.json'; Text = [regex]::Replace($base, '(?s)"packs": \[.*?\],\s*"optional"', '"packs": {}, "optional"'); Says = 'packs is not a list' },
    @{ What = 'a news detail that is a number'; File = 'version.json'; Text = $base.Replace('"details": [ "one", "two" ]', '"details": [ 1 ]'); Says = 'details is not a list of text' },
    @{ What = 'a baseline with no url'; File = 'version.json'; Text = [regex]::Replace($base, '"url": "[^"]+", "entries": 2', '"entries": 2'); Says = 'baseline is there without a sha256 and a url' },
    @{ What = 'version 2'; File = 'version.json'; Text = $base.Replace('"launcherVersion"', '"version": 2, "launcherVersion"'); Says = 'it is version 2' },
    @{ What = 'version.json cut off'; File = 'version.json'; Text = $base.Substring(0, 80); Says = 'not valid JSON' },
    @{ What = 'a published.json value that is a number'; File = 'published.json'; Text = '{"Data/Thornswood.esp": 5}'; Says = 'Data/Thornswood.esp is not text' },
    @{ What = 'a release with no sha256'; File = 'releases.json'; Text = '[ { "id": "20261011-175014", "url": "u", "entries": 2 } ]'; Says = 'release 20261011-175014 has no sha256' },
    @{ What = 'a release with no entries'; File = 'releases.json'; Text = ('[ { "id": "x", "sha256": "' + ('a' * 64) + '", "url": "u" } ]'); Says = 'release x has no whole entries' }
)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2180feed ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    foreach ($c in $cases) {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        $null = New-Item -ItemType Directory -Path $tmp
        foreach ($f in 'version.json', 'published.json', 'releases.json') { Copy-Item -LiteralPath (Join-Path $fx $f) -Destination (Join-Path $tmp $f) }
        [IO.File]::WriteAllText((Join-Path $tmp $c.File), $c.Text, (New-Object Text.UTF8Encoding($false)))
        $r = Run $tmp
        Yes ("{0} is refused, exit 1, naming {1} and what is wrong" -f $c.What, $c.File) ($r.Code -eq 1 -and $r.Out.Contains($c.File) -and $r.Out.Contains($c.Says))
    }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    $null = New-Item -ItemType Directory -Path $tmp
    Copy-Item -LiteralPath (Join-Path $fx 'version.json') -Destination (Join-Path $tmp 'version.json')
    $r = Run $tmp
    Yes 'a store with only version.json passes, saying the other two are not there' ($r.Code -eq 0 -and $r.Out -match 'NONE\s+feed-published' -and $r.Out -match 'NONE\s+feed-releases')
    Remove-Item -LiteralPath (Join-Path $tmp 'version.json')
    $r = Run $tmp
    Yes 'a store with no version.json is refused' ($r.Code -eq 1 -and $r.Out -match 'REFUSED\s+feed-version')
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $fx -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- the contract names every VersionDoc member, so a new one is not missed
$cfg = [IO.File]::ReadAllText((Join-Path $repo 'launcher\app\Config.cs'))
$m = [regex]::Match($cfg, '(?s)public class VersionDoc\s*\{(.*?)\n    \}')
$members = @([regex]::Matches($m.Groups[1].Value, '\[DataMember\] public [\w\[\]]+ (\w+)') | ForEach-Object { $_.Groups[1].Value })
$rsText = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\RecordShape.ps1'))
$missing = @($members | Where-Object { -not $rsText.Contains("'" + $_ + "'") })
Yes ('every VersionDoc member ({0}) is held by the feed-version contract' -f $members.Count) ($members.Count -ge 20 -and $missing.Count -eq 0)
foreach ($x in $missing) { Write-Host "        not held: $x" }

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }