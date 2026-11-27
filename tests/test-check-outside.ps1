<#
  test-check-outside.ps1

      pwsh -NoProfile -File .\tests\test-check-outside.ps1

  Check-Outside.ps1 walks what a first install needs that this project does
  not run: this repository's Releases as GitHub serves them to a stranger
  (the channel's Velopack feed, its package, the signed record's files, the
  setup program), the 7-Zip Release the modlist install takes, Steam's public
  build and the Nexus collection.

  Since #5796 a launcher reads its channel's Releases through GitHub's API
  itself (launcher\app\Velo*.cs, GitHub.cs) and no version.json at all, so
  #7232 moved the walk off the feed and its AllowedHosts and onto the
  Releases. A Nexus collection page answers a bare request with 403; from
  #1064 the check asks Nexus GraphQL instead.

  These drive the real walk, dot-sourced out of the shipped script, with the
  one function that touches the network (Probe) replaced by answers from a
  table. So what is under test is the shipped logic, nothing here leaves the
  machine, and every address it would have asked for is written down and
  checked: none of them may be the server.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$ScriptPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $ScriptPath) { $ScriptPath = Join-Path $Here 'scripts\dev\Check-Outside.ps1' }
# Kept under its own name: dot-sourcing the script sets $Here to wherever the
# script is, which is not scripts\dev when -ScriptPath points at a copy.
$RepoRoot = $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
  else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

Yes 'Check-Outside.ps1 is there' (Test-Path -LiteralPath $ScriptPath)
if (-not (Test-Path -LiteralPath $ScriptPath)) { Write-Host ''; Write-Host '0 passed, 1 failed' -ForegroundColor Red; exit 1 }

. $ScriptPath
$ErrorActionPreference = 'Stop'

# ---- the table the network is replaced by ------------------------------------
$script:Served = @{}
$script:Asked = New-Object 'System.Collections.Generic.List[object]'
$script:Ever = New-Object 'System.Collections.Generic.List[string]'
function Serve([string]$url, [int]$code, [string]$body = '', [hashtable]$more) {
  $r = @{ code = $code; body = $body; location = ''; range = ''; left = ''; reset = ''; link = ''; error = '' }
  if ($more) { foreach ($k in $more.Keys) { $r[$k] = $more[$k] } }
  $script:Served[$url] = $r
}
function Probe([string]$url, [string]$accept = '', [switch]$Body, [switch]$FirstByte, [string]$Method = 'GET', [string]$PostBody = '') {
  $script:Asked.Add([pscustomobject]@{ Url = $url; Accept = $accept; FirstByte = [bool]$FirstByte; Method = $(if ($Method) { $Method } else { 'GET' }); PostBody = [string]$PostBody })
  $script:Ever.Add($url)
  if ($script:Served.ContainsKey($url)) { return $script:Served[$url].Clone() }
  return @{ code = 0; body = ''; location = ''; range = ''; left = ''; reset = ''; link = ''; error = 'unreachable' }
}

$A = 'Owner/Public'
$Z = 'ip7z/7zip'
function Api([string]$repo, [string]$id) { return ('https://api.github.com/repos/' + $repo + '/releases/assets/' + $id) }
$ListA1 = 'https://api.github.com/repos/Owner/Public/releases?per_page=100'
$ListA2 = 'https://api.github.com/repositories/42/releases?per_page=100&page=2'
function TagUrl([string]$repo, [string]$tag) { return ('https://api.github.com/repos/' + $repo + '/releases/tags/' + $tag) }
$Steam  = 'https://api.steamcmd.net/v1/info/489830'
$Nexus  = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123'
$Gql    = 'https://api.nexusmods.com/v2/graphql'
$summary = 'Try SkyUI.'
$description = "## Getting started`n`nTake the caf$([char]0xE9) road.`nKeep to it."
function NexusJson([string]$name, $rev, [hashtable]$text = @{ summary = $summary; description = ($description -replace "`n", "`r`n") }) {
  if (-not $name) { return '{"data":{"collection":null}}' }
  $col = @{ name = $name; latestPublishedRevision = @{ revisionNumber = $rev } }
  foreach ($field in $text.Keys) { $col[$field] = $text[$field] }
  return (ConvertTo-Json -InputObject @{ data = @{ collection = $col } } -Depth 5 -Compress)
}
$Signed = '?sp=r&sv=2018&jwt=SECRETJWTSIGNATURE'
function Cdn([string]$id) { return ('https://release-assets.githubusercontent.com/github-production-release-asset/1/' + $id + $Signed) }
$Digest = 'sha256:' + ('ab' * 32)

# One asset of a Release, as GitHub lists it.
function File([string]$repo, [string]$id, [string]$name, [long]$size = 10, [string]$state = 'uploaded', [string]$digest = $Digest) {
  return [ordered]@{ id = [long]$id; name = $name; state = $state; size = $size; digest = $digest; url = (Api $repo $id) }
}
function Rel([string]$tag, [string]$when, $files, [bool]$pre = $false) {
  return [ordered]@{ tag_name = $tag; draft = $false; prerelease = $pre; published_at = $when; assets = @($files) }
}
function ListJson($rels) { return (ConvertTo-Json -InputObject @($rels) -Depth 8) }
# A Velopack feed: the full package of the release before is kept in it too.
function FeedJson([long]$size = 3000, [string]$version = '1.3.50') {
  $f = [ordered]@{ Assets = @(
    [ordered]@{ PackageId = 'Thornswood'; Version = '1.3.49'; Type = 'Full'; FileName = 'Thornswood-1.3.49-full.nupkg'; Size = 2900 },
    [ordered]@{ PackageId = 'Thornswood'; Version = $version; Type = 'Full'; FileName = ('Thornswood-' + $version + '-full.nupkg'); Size = $size },
    [ordered]@{ PackageId = 'Thornswood'; Version = $version; Type = 'Delta'; FileName = ('Thornswood-' + $version + '-delta.nupkg'); Size = 40 }) }
  return (ConvertTo-Json -InputObject $f -Depth 6)
}
function SteamJson([string]$build) {
  return ('{"data":{"489830":{"depots":{"branches":{"public":{"buildid":"' + $build + '","timeupdated":"1787839209"}}}}},"status":"success"}')
}
$gh = @{ left = '55'; reset = '1790000000' }

# The Releases as a good main channel has them: main-build-1.3.50 serves the
# feed, the package, the setup list and the setup program; build-1.3.50 is
# the signed record.
function Record-Files([string[]]$leave = @()) {
  $all = @((File $A '1' 'manifest.json'), (File $A '2' 'manifest.cat'), (File $A '3' 'game-files.json'), (File $A '4' 'collection-modlist.wabbajack'), (File $A '5' 'setup-files.dev.json'))
  return @($all | Where-Object { $leave -notcontains $_.name })
}
function Main-Files([string[]]$leave = @(), [long]$pkgSize = 3000, [string]$setupDigest = $Digest) {
  $all = @(
    (File $A '10' 'releases.main.json' 400),
    (File $A '11' 'Thornswood-1.3.50-full.nupkg' $pkgSize),
    (File $A '12' 'setup-files.main.json'),
    (File $A '21' 'Thornswood-Setup.exe' 5000 'uploaded' $setupDigest))
  return @($all | Where-Object { $leave -notcontains $_.name })
}
function List-Of($main = (Main-Files), $record = (Record-Files)) {
  return @(
    (Rel 'main-build-1.3.50' '2026-11-21T03:00:00Z' $main),
    (Rel 'build-1.3.50' '2026-11-20T03:00:00Z' $record $true),
    (Rel 'main-build-1.3.49' '2026-11-10T03:00:00Z' @((File $A '90' 'releases.main.json'), (File $A '91' 'Thornswood-Setup.exe' 4000))))
}
function Download([string]$id, [long]$size) {
  Serve (Api $A $id) 302 '' @{ location = (Cdn $id); left = '52' }
  Serve (Cdn $id) 206 '' @{ range = ('bytes 0-0/' + $size) }
}

# Everything answering the way it should.
function Clean {
  $script:Served = @{}
  Serve $ListA1 200 (ListJson (List-Of)) @{ left = '54'; reset = '1790000000'; link = ('<' + $ListA2 + '>; rel="next"') }
  Serve (Api $A '10') 302 '' @{ location = (Cdn '10'); left = '53' }
  Serve (Cdn '10') 200 (FeedJson)
  Download '11' 3000
  Download '21' 5000
  Serve (TagUrl $Z '25.01') 200 (ConvertTo-Json -Depth 6 -InputObject (Rel '25.01' '2025-08-03T00:00:00Z' @((File $Z '31' '7zr.exe' 601088), (File $Z '32' '7z2501-x64.exe' 1643509)))) $gh
  foreach ($pair in @(@('31', '601088'), @('32', '1643509'))) {
    Serve (Api $Z $pair[0]) 302 '' @{ location = (Cdn $pair[0]) }
    Serve (Cdn $pair[0]) 206 '' @{ range = ('bytes 0-0/' + $pair[1]) }
  }
  Serve $Steam 200 (SteamJson '100')
  Serve $Gql 200 (NexusJson 'Thornswood' 1)
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-outside-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $root
$record = Join-Path $root 'steam-build.json'
[IO.File]::WriteAllText($record, '{ "appId": 489830, "publicBuildId": "100", "recordedUtc": "2026-09-24T10:00:14Z" }')
$pageRecord = Join-Path $root 'collection-page.json'
$page = @{ version = 1; collection = 'abc123'; revision = 1; summary = 'Try [[SkyUI|12604]].'; description = $description; installInstructions = ''; notSaid = @() }
[IO.File]::WriteAllText($pageRecord, (ConvertTo-Json -InputObject $page))
$SevenZip = Read-SevenZip (Join-Path $RepoRoot 'launcher\app\ModlistFetch.cs')

function Run([string]$branch = 'main', [string]$steamRecord = $record, [string]$collection = $Nexus, $sevenZip = $SevenZip, [string]$repo = $A) {
  $script:Asked.Clear()
  $all = @(Invoke-Outside -Repo $repo -Branch $branch -SteamRecord $steamRecord `
             -Collection $collection -PageRecord $pageRecord -Server @('thornswood.net', '192.0.2.99') -SevenZip $sevenZip 6>&1)
  $n = @($all | Where-Object { $_ -is [int] }) | Select-Object -Last 1
  $text = (@($all | Where-Object { $_ -is [Management.Automation.InformationRecord] } | ForEach-Object { [string]$_.MessageData }) -join "`n")
  return [pscustomobject]@{
    N = $n
    Bad = @($script:Found | Where-Object { $_.Kind -eq 'bad' } | ForEach-Object { $_.Text })
    Skip = @($script:Found | Where-Object { $_.Kind -eq 'skip' } | ForEach-Object { $_.Text })
    Ok = @($script:Found | Where-Object { $_.Kind -eq 'ok' } | ForEach-Object { $_.Text })
    Lines = @($script:Found | Where-Object { $_.Kind -eq 'line' } | ForEach-Object { $_.Text })
    Text = $text
    Asked = @($script:Asked | ForEach-Object { $_ })
  }
}
function Has($list, [string]$like) { return (@($list | Where-Object { $_ -like $like }).Count -gt 0) }
function AskedFor($r, [string]$url) { return (@($r.Asked | Where-Object { $_.Url -eq $url }).Count -gt 0) }
function Relist($rels, [hashtable]$more = @{ left = '54'; reset = '1790000000' }) { Serve $ListA1 200 (ListJson $rels) $more }

try {
  # ---- the files it reads out of the repository ------------------------------
  Yes 'the repository is read out of the real Velo.cs' ((Read-VeloRepo (Join-Path $RepoRoot 'launcher\app\Velo.cs')) -eq 'ThornswoodRP/Thornswood')
  Yes 'the 7-Zip Release and both its pins are read out of the real ModlistFetch.cs' ($null -ne $SevenZip -and $SevenZip.Repo -eq $Z -and @($SevenZip.Pins).Count -eq 2 -and @($SevenZip.Pins | Where-Object { $_.Size -gt 0 }).Count -eq 2)
  $d = Read-Defaults (Join-Path $RepoRoot 'launcher\app\Config.cs')
  Yes 'the collection address is read out of the real Config.cs' ($d.Collection -like 'https://*nexusmods.com/*')
  Yes 'and the site, so it can be kept off it' ($d.SiteHost -eq 'thornswood.net')
  $real = [IO.File]::ReadAllText((Join-Path $RepoRoot 'records\steam-build.json')) | ConvertFrom-Json
  Yes 'records\steam-build.json records app 489830 and a build number' ($real.appId -eq 489830 -and ([string]$real.publicBuildId) -match '^\d+$')
  Yes 'the setup kinds are the ones site\lib\feed.js offers' ((Get-Content -Raw (Join-Path $RepoRoot 'site\lib\feed.js')).Contains("'Thornswood-Setup.exe'") -and (Get-Content -Raw (Join-Path $RepoRoot 'site\lib\feed.js')).Contains("'Thornswood-Dev-Setup.exe'"))

  # ---- everything as it should be ------------------------------------------
  Clean
  $r = Run
  Yes 'with nothing wrong it finds nothing, so it can exit 0' ($r.N -eq 0 -and $r.Bad.Count -eq 0)
  Yes 'the channel is the newest Release with its feed' (Has $r.Ok 'the newest Release with releases.main.json is main-build-1.3.50.')
  Yes 'the feed is asked for the way the launcher asks, Accept octet-stream' (@($r.Asked | Where-Object { $_.Url -eq (Api $A '10') -and $_.Accept -eq 'application/octet-stream' }).Count -eq 1)
  Yes 'and read from where GitHub sends it' (AskedFor $r (Cdn '10'))
  Yes 'the full package is the highest version the feed names, not the one before' (Has $r.Ok '*full package Thornswood-1.3.50-full.nupkg, version 1.3.50*')
  Yes 'the signed record is the build Release that made it' (Has $r.Ok 'build-1.3.50 carries manifest.json, manifest.cat, game-files.json, collection-modlist.wabbajack.')
  Yes 'main''s setup list is read off main''s Release' (Has $r.Ok 'main-build-1.3.50 carries setup-files.main.json.')
  Yes 'the setup program is the newest of the main kind' (Has $r.Ok 'Thornswood-Setup.exe is on main-build-1.3.50, 5000 bytes.')
  Yes 'the package is asked for with Accept octet-stream, then only its first byte' ((@($r.Asked | Where-Object { $_.Url -eq (Api $A '11') -and $_.Accept -eq 'application/octet-stream' }).Count -eq 1) -and (@($r.Asked | Where-Object { $_.Url -eq (Cdn '11') -and $_.FirstByte }).Count -eq 1))
  Yes 'the setup program downloads too' (Has $r.Ok 'Thornswood-Setup.exe downloads: GitHub sends it on to release-assets.githubusercontent.com, 5000 bytes.')
  Yes 'both 7-Zip files download at their pinned size' ((Has $r.Ok '7-Zip''s 7zr.exe downloads*601088 bytes.') -and (Has $r.Ok '7-Zip''s 7z2501-x64.exe downloads*1643509 bytes.'))
  Yes 'a record file is not downloaded, the listing already covers it' (-not (AskedFor $r (Api $A '1')))
  Yes 'one page of Releases was enough, so the second is not asked' (-not (AskedFor $r $ListA2))
  Yes 'the record is found in the listing, not asked for again' (-not (AskedFor $r (TagUrl $A 'build-1.3.50')))
  Yes 'no version.json is asked for anywhere' (@($r.Asked | Where-Object { $_.Url -like '*version.json*' }).Count -eq 0)
  Yes 'the Steam build matches the record' (Has $r.Ok "Steam's public build is still 100, as recorded 2026-09-24.")
  Yes 'Nexus GraphQL found reports name and revision' (Has $r.Ok 'the collection "Thornswood" is there, revision 1.')
  Yes 'Nexus is asked by anonymous GraphQL POST, not the collection page' (@($r.Asked | Where-Object { $_.Url -eq $Gql -and $_.Method -eq 'POST' -and $_.PostBody -like '*abc123*skyrimspecialedition*' }).Count -eq 1)
  Yes 'the collection page itself is not requested' (-not (AskedFor $r $Nexus))
  Yes 'the depot pins are said to be unchecked, not passed' (Has $r.Skip '*depot manifests*check by hand.')
  Yes 'the signed download address is never printed' (($r.Text + ($r.Ok -join ' ')) -notmatch 'SECRETJWT|jwt=')
  Yes 'only its host is' ($r.Text -match 'release-assets\.githubusercontent\.com')

  # ---- the budget: a stranger gets sixty calls an hour ----------------------
  $apiCalls = @($r.Asked | Where-Object { $_.Url -like 'https://api.github.com/*' }).Count
  Yes ('a clean walk costs ' + $apiCalls + ' GitHub API calls of the sixty') ($apiCalls -le 7)

  # ---- the dev channel -------------------------------------------------------
  Clean
  $devFiles = @(Record-Files) + @((File $A '40' 'releases.dev.json' 400), (File $A '41' 'Thornswood-1.3.50-full.nupkg' 3000), (File $A '42' 'Thornswood-Dev-Setup.exe' 6000))
  Relist @((Rel 'build-1.3.50' '2026-11-20T03:00:00Z' $devFiles $true), (Rel 'main-build-1.3.49' '2026-11-10T03:00:00Z' (Main-Files)))
  Serve (Api $A '40') 302 '' @{ location = (Cdn '40') }
  Serve (Cdn '40') 200 (FeedJson)
  Download '41' 3000
  Download '42' 6000
  $r = Run 'dev'
  Yes 'the dev channel reads its own feed, record and setup list' ($r.N -eq 0 -and (Has $r.Ok 'the newest Release with releases.dev.json is build-1.3.50.') -and (Has $r.Ok 'build-1.3.50 carries *setup-files.dev.json.'))
  Yes 'and offers the dev setup program off a build Release' (Has $r.Ok 'Thornswood-Dev-Setup.exe is on build-1.3.50, 6000 bytes.')
  Yes 'a dev walk asks for no main- Release' (@($r.Asked | Where-Object { $_.Url -like '*/releases/tags/main-*' }).Count -eq 0)

  # ---- paging: what is not on the first page is on the next -----------------
  Clean
  Relist @((Rel 'main-build-1.3.50' '2026-11-21T03:00:00Z' (Main-Files @('Thornswood-Setup.exe')))) @{ left = '54'; link = ('<' + $ListA2 + '>; rel="next"') }
  Serve $ListA2 200 (ListJson @((Rel 'build-1.3.50' '2026-11-20T03:00:00Z' (Record-Files) $true), (Rel 'main-build-1.3.49' '2026-11-10T03:00:00Z' @((File $A '91' 'Thornswood-Setup.exe' 4000))))) @{ left = '53' }
  Download '91' 4000
  $r = Run
  Yes 'the second page is followed when the setup program is not on the first' ((AskedFor $r $ListA2) -and $r.N -eq 0)
  Yes 'and the older setup program is the one offered' (Has $r.Ok 'Thornswood-Setup.exe is on main-build-1.3.49, 4000 bytes.')

  Clean
  Relist @((Rel 'main-build-1.3.50' '2026-11-21T03:00:00Z' (Main-Files)))
  Serve (TagUrl $A 'build-1.3.50') 200 (ConvertTo-Json -Depth 6 -InputObject (Rel 'build-1.3.50' '2026-11-20T03:00:00Z' (Record-Files) $true)) $gh
  $r = Run
  Yes 'a record Release past the pages read is asked for by its tag' ((AskedFor $r (TagUrl $A 'build-1.3.50')) -and $r.N -eq 0)

  # ---- the channel ------------------------------------------------------------
  Clean
  Relist @((Rel 'build-1.3.50' '2026-11-20T03:00:00Z' (Record-Files) $true))
  $r = Run
  Yes 'no Release with the channel''s feed is wrong' (Has $r.Bad 'no published Release carries releases.main.json*nothing to install or update to.')
  Yes 'and no setup program is said too' (Has $r.Bad 'no published Release of the main kind carries Thornswood-Setup.exe*')

  Clean
  Relist (List-Of (Main-Files @('Thornswood-1.3.50-full.nupkg')))
  $r = Run
  Yes 'a feed naming a package its Release does not carry is wrong' ($r.N -eq 1 -and (Has $r.Bad '*names Thornswood-1.3.50-full.nupkg, which that Release does not carry*'))

  Clean
  Relist (List-Of (Main-Files @() 2999))
  $r = Run
  Yes 'a package whose size is not the feed''s is wrong' ($r.N -eq 1 -and (Has $r.Bad 'Thornswood-1.3.50-full.nupkg on main-build-1.3.50 is 2999 bytes and the feed says 3000*'))

  Clean
  $half = @(Main-Files @('Thornswood-1.3.50-full.nupkg')) + @(File $A '11' 'Thornswood-1.3.50-full.nupkg' 3000 'starter')
  Relist (List-Of $half)
  $r = Run
  Yes 'an upload that never finished counts as not there' (Has $r.Bad '*does not carry as a finished upload.')
  Yes 'and it is not downloaded' (-not (AskedFor $r (Api $A '11')))

  Clean
  Serve (Cdn '10') 200 '<html>no</html>'
  $r = Run
  Yes 'a feed that is not a Velopack feed is wrong' (Has $r.Bad 'releases.main.json on main-build-1.3.50 is not a Velopack feed*')

  Clean
  Serve (Cdn '10') 200 (FeedJson 3000 '2.0.1')
  $r = Run
  Yes 'a package version no Thornswood release makes is wrong' (Has $r.Bad '*version, 2.0.1, is not one a Thornswood release makes*')

  Clean
  Serve (Api $A '10') 404 '' $gh
  $r = Run
  Yes 'a feed GitHub will not hand out is wrong' (Has $r.Bad 'releases.main.json on main-build-1.3.50 could not be read: GitHub answers 404.')

  Clean
  $off = @(Main-Files @('releases.main.json')) + @([ordered]@{ id = 10; name = 'releases.main.json'; state = 'uploaded'; size = 400; digest = $Digest; url = 'https://evil.example.com/releases/assets/10' })
  Relist (List-Of $off)
  $r = Run
  Yes 'a file GitHub lists at any other address is wrong, and not asked for' ((Has $r.Bad '*is not at one of Owner/Public''s Release file addresses*') -and -not (@($r.Asked | Where-Object { $_.Url -like '*evil.example.com*' }).Count))

  # ---- the signed record --------------------------------------------------------
  Clean
  Relist (List-Of (Main-Files) (Record-Files @('manifest.cat', 'game-files.json')))
  $r = Run
  Yes 'a record missing its files is wrong, and names them' ($r.N -eq 1 -and (Has $r.Bad 'build-1.3.50 does not carry manifest.cat, game-files.json*'))

  Clean
  Relist (List-Of (Main-Files @('setup-files.main.json')))
  $r = Run
  Yes 'a main Release without its setup list is wrong' ($r.N -eq 1 -and (Has $r.Bad 'main-build-1.3.50 does not carry setup-files.main.json*'))

  Clean
  Relist @((Rel 'main-build-1.3.50' '2026-11-21T03:00:00Z' (Main-Files)))
  Serve (TagUrl $A 'build-1.3.50') 404 '{"message":"Not Found"}' $gh
  $r = Run
  Yes 'a record Release that is gone is wrong' (Has $r.Bad 'the Release build-1.3.50, which made the package, answers 404*')

  # ---- the setup program -------------------------------------------------------
  Clean
  Relist (List-Of (Main-Files @() 3000 ''))
  Download '91' 4000
  $r = Run
  Yes 'a setup program without GitHub''s sha256 is passed over, as the site passes it over' (Has $r.Ok 'Thornswood-Setup.exe is on main-build-1.3.49, 4000 bytes.')

  Clean
  Serve (Cdn '21') 206 '' @{ range = 'bytes 0-0/4999' }
  $r = Run
  Yes 'a setup program whose size is not GitHub''s is wrong' (Has $r.Bad 'Thornswood-Setup.exe is 4999 bytes at release-assets.githubusercontent.com and GitHub lists it as 5000*')

  Clean
  Serve (Cdn '11') 403 ''
  $r = Run
  Yes 'a redirect to something that will not hand it over is wrong' (Has $r.Bad 'Thornswood-1.3.50-full.nupkg: GitHub sends it on to release-assets.githubusercontent.com, which answers 403*')

  # ---- the Releases themselves ---------------------------------------------------
  Clean
  Serve $ListA1 404 '{"message":"Not Found"}' $gh
  $r = Run
  Yes 'Releases a stranger gets 404 for are wrong' (Has $r.Bad 'Owner/Public answers a stranger with 404*nobody can install or update.')
  Yes 'and nothing below them is asked' (-not (AskedFor $r (Api $A '10')))
  Yes 'Steam is still asked, it is not on the Releases' (AskedFor $r $Steam)

  Clean
  Serve $ListA1 403 '{"message":"API rate limit exceeded"}' @{ left = '0'; reset = '1790000000' }
  $r = Run
  Yes 'a spent allowance is said as that' (Has $r.Bad 'the Releases were not read. GitHub*used up*')
  Yes 'and is not called a private repository' (-not (Has $r.Bad '*private*'))

  Clean
  $r = Run 'main' $record $Nexus $SevenZip ''
  Yes 'with no repository named it says so rather than passing blind' (Has $r.Bad 'no repository was named*')

  # ---- 7-Zip ------------------------------------------------------------------
  Clean
  Serve (TagUrl $Z '25.01') 404 '' $gh
  $r = Run
  Yes '7-Zip''s Release being gone is wrong' ($r.N -eq 1 -and (Has $r.Bad '7-Zip''s Release 25.01 in ip7z/7zip answers 404*'))

  Clean
  Serve (TagUrl $Z '25.01') 200 (ConvertTo-Json -Depth 6 -InputObject (Rel '25.01' '2025-08-03T00:00:00Z' @((File $Z '31' '7zr.exe' 601000)))) $gh
  $r = Run
  Yes 'a 7-Zip file at another size than pinned is wrong' (Has $r.Bad '7zr.exe on 7-Zip''s Release 25.01 is 601000 bytes and the launcher pins 601088*')
  Yes 'and a pinned file it no longer has is wrong' (Has $r.Bad '7-Zip''s Release 25.01 has no 7z2501-x64.exe*')

  Clean
  $r = Run 'main' $record $Nexus $null
  Yes 'with no 7-Zip pin to read it says so rather than passing blind' (Has $r.Bad 'could not read which 7-Zip Release*')

  # ---- the server is never asked --------------------------------------------
  Clean
  $r = Run 'main' $record 'https://thornswood.net/collection'
  Yes 'a collection address on the server is not asked' ((-not (AskedFor $r 'https://thornswood.net/collection')) -and (Has $r.Skip '*its address is on the server, which this does not contact.'))
  # The one path that reaches the guard inside Ask itself: a feed GitHub
  # sends on to the server.
  Clean
  Serve (Api $A '10') 302 '' @{ location = 'https://thornswood.net/feed.json' }
  $r = Run
  Yes 'a redirect to the server is refused before any request, and said' ((-not (AskedFor $r 'https://thornswood.net/feed.json')) -and (Has $r.Bad '*sends it on to thornswood.net, which answers nothing (not asked, that is the server).'))

  # ---- Steam -----------------------------------------------------------------
  Clean
  Serve $Steam 200 (SteamJson '200')
  $r = Run
  Yes "Steam's public build moving is red" ($r.N -eq 1 -and (Has $r.Bad "Steam's public build moved from 100 to 200 on 27 Aug 2026."))
  Yes 'and it says what to do about it' (Has $r.Lines '*as publicBuildId.')

  Clean
  $script:Served.Remove($Steam)
  $r = Run
  Yes 'a third party that does not answer is unchecked, not red' ($r.N -eq 0 -and (Has $r.Skip 'Steam: api.steamcmd.net answered nothing*'))

  Clean
  $r = Run 'main' (Join-Path $root 'no-such-record.json')
  Yes 'no record to compare with is red' (Has $r.Bad 'no Steam build is recorded in*')

  # ---- Nexus (GraphQL: found / gone / no answer) --------------------------------
  Clean
  Serve $Gql 200 (NexusJson 'Thornswood' 1)
  $r = Run
  Yes 'a GraphQL answer with name and revision is green' ($r.N -eq 0 -and (Has $r.Ok 'the collection "Thornswood" is there, revision 1.'))
  Yes 'published text matches after rendering marks and normalizing line endings' (Has $r.Ok '*summary and description match*')
  $query = ($r.Asked | Where-Object Url -eq $Gql).PostBody | ConvertFrom-Json
  Yes 'the same anonymous query asks for both public text fields' ($query.query -match '\bsummary\b' -and $query.query -match '\bdescription\b')
  Serve $Gql 200 (NexusJson 'Thornswood' 1 @{ summary = 'Try skyui.'; description = 'Also changed.' })
  $r = Run
  Yes 'case-only summary drift names the first field and line, once' ($r.N -eq 1 -and (Has $r.Bad '*summary line 1 differs*'))
  Serve $Gql 200 (NexusJson 'Thornswood' 1 @{ summary = $summary; description = "## Getting started`n`nChanged.`nAlso changed." })
  $r = Run
  Yes 'description drift names the first changed line, including blank lines' ($r.N -eq 1 -and (Has $r.Bad '*description line 3 differs*'))
  Serve $Gql 200 (NexusJson 'Thornswood' 1 @{ summary = $summary })
  $r = Run
  Yes 'missing public description is red, not a match' ($r.N -eq 1 -and (Has $r.Bad '*Nexus returned no description*'))
  Serve $Gql 200 (NexusJson 'Thornswood' 1 @{ description = $description })
  $r = Run
  Yes 'missing public summary is red, not a match' ($r.N -eq 1 -and (Has $r.Bad '*Nexus returned no summary*'))
  Clean
  Serve $Gql 200 (NexusJson '' $null)
  $r = Run
  Yes 'Nexus saying there is no such collection is red' ($r.N -eq 1 -and (Has $r.Bad 'Nexus says there is no collection abc123*'))
  Clean
  $script:Served.Remove($Gql)
  $r = Run
  Yes 'Nexus not answering at all is unchecked, not red' ($r.N -eq 0 -and (Has $r.Skip 'the collection: Nexus did not answer*unchecked.'))
  Clean
  Serve $Gql 403 'Just a moment...'
  $r = Run
  Yes 'a non-answer HTTP code from GraphQL is unchecked, not red' ($r.N -eq 0 -and (Has $r.Skip 'the collection: Nexus answered 403*unchecked.'))

  # ---- over every run above --------------------------------------------------
  $toServer = @($script:Ever | Where-Object { $_ -match '^https?://([^/]+\.)?thornswood\.net(/|:|$)' -or $_ -match '192\.0\.2\.10|192\.0\.2\.99' })
  Yes ('not one request in ' + $script:Ever.Count + ' went to the server') ($toServer.Count -eq 0)

  # ---- the file itself -------------------------------------------------------
  $src = [IO.File]::ReadAllText($ScriptPath)
  $code = [regex]::Replace($src, '(?s)<#.*?#>', '')
  $code = [regex]::Replace($code, '(?m)^\s*#.*$', '')
  Yes 'no token, key or launcher config is touched' ($code -notmatch 'Authorization|Bearer|UpdateToken|GITHUB_TOKEN|GH_TOKEN|config\.json|bot\.env')
  Yes 'Method is set once from the caller (GET by default, POST for Nexus GraphQL)' (([regex]::Matches($code, '\.Method\s*=')).Count -eq 1 -and $code -match '-Method ''POST''' -and $code -match '\$r\.Method = \$\(if \(\$Method\)')
  Yes 'no version.json and no AllowedHosts are read any more (#5796)' ($code -notmatch 'version\.json|AllowedHosts|Updater\.cs')
  Yes 'no other web cmdlet is used that could send something else' ($code -notmatch 'Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient')
}
finally {
  Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail) { 'Red' } else { 'Green' })
if ($script:fail) { exit 1 }
