<#
  test-5767-revision-from-release.ps1

      pwsh -NoProfile -File .\tests\test-5767-revision-from-release.ps1

  The collection revision a server runs comes with the Release that puts it
  there (#5767). Until 11 Nov the launcher and the Downloads page read it from
  the feed's collectionRevision, which only a Ship writes, and releases no
  longer go through a Ship: revision 8 was published and recorded on 8 Nov
  and both feeds said 7 until 11 Nov, so a launcher on 8 was told the server
  had not caught up with it.

  What this proves:
    1. New-SignedManifest.ps1 writes collectionRevision into a build Release's
       manifest, the revision records/collection-plugins.json names, and none
       into the deploy agent's own Release;
    2. the launcher reads it from the signed record of the Release its channel
       is on (VeloRecord.Manifest, VeloUpdate.CheckLauncher) and no longer
       from the feed (ShellUpdate.cs);
    3. the site reads it from the manifest of the Release main runs
       (feed.js serverRevision) for the Downloads page and its link.
  Writes only under its own temp folder.
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
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('rev-from-release-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    $want = [int]((Get-Content -LiteralPath (Join-Path $Repo 'records/collection-plugins.json') -Raw) | ConvertFrom-Json).revision
    $gm = Join-Path $tmp 'gamemode.js'
    [IO.File]::WriteAllText($gm, 'x')
    $write = Join-Path $Repo 'scripts/release/New-SignedManifest.ps1'
    $null = & $write -Out (Join-Path $tmp 'build') -Tag 'build-1.3.99' -Commit ('a' * 40) -Part gamemode -Files $gm -Version '1.3.99' -NoCatalog 6>$null
    $m = Get-Content -LiteralPath (Get-ChildItem -LiteralPath (Join-Path $tmp 'build') -Recurse -Filter manifest.json | Select-Object -First 1).FullName -Raw | ConvertFrom-Json
    Yes ('1. a build Release''s manifest names the recorded revision, ' + $want) ($m.collectionRevision -is [long] -or $m.collectionRevision -is [int])
    Yes '   as a whole number equal to records/collection-plugins.json''s' ([int]$m.collectionRevision -eq $want -and $want -gt 0)
    $null = & $write -Out (Join-Path $tmp 'agent') -Tag 'agent-v1.0.999' -Commit ('b' * 40) -Part agent -Files $gm -Version '1.0.999' -NoCatalog 6>$null
    $a = Get-Content -LiteralPath (Get-ChildItem -LiteralPath (Join-Path $tmp 'agent') -Recurse -Filter manifest.json | Select-Object -First 1).FullName -Raw | ConvertFrom-Json
    Yes '   and the deploy agent''s own Release names none' (-not $a.PSObject.Properties['collectionRevision'])
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

$app = Join-Path $Repo 'launcher/app'
$record = Get-Content -LiteralPath (Join-Path $app 'VeloRecord.cs') -Raw
$update = Get-Content -LiteralPath (Join-Path $app 'VeloUpdate.cs') -Raw
$shell = Get-Content -LiteralPath (Join-Path $app 'ShellUpdate.cs') -Raw
$all = (Get-ChildItem -LiteralPath $app -Filter '*.cs' | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
Yes '2. the launcher''s record of a Release reads collectionRevision' ($record -match '\[JsonPropertyName\("collectionRevision"\)\] public int CollectionRevision')
Yes '   CheckLauncher takes it from the record of the Release the channel is on' ($update.Contains('SemanticVersion on = info != null ? info.TargetFullRelease.Version : Velo.Locator?.CurrentlyInstalledVersion;') -and
    $update.Contains('ServerCollectionRevision = VeloRecord.Get(on, out recordSaid).CollectionRevision;'))
Yes '   and nothing reads it from the feed any more' (-not $shell.Contains('= v.collectionRevision') -and $all -notmatch 'FeedCollectionRevision')

$feed = Get-Content -LiteralPath (Join-Path $Repo 'site/lib/feed.js') -Raw
$dl = Get-Content -LiteralPath (Join-Path $Repo 'site/lib/downloads.js') -Raw
Yes '3. the site reads main''s revision from its Release''s manifest.json' ($feed.Contains("const tag = st.tag.replace(/^main-/, '');") -and $feed.Contains("await releaseAsset(tag, 'manifest.json')") -and $feed.Contains('Number(doc.collectionRevision)'))
Yes '   and the Downloads page and its link use it, not the feed''s number' ($dl.Contains("const revision = serverRevision('main');") -and $dl -notmatch 'feed\.collectionRevision')
Done
