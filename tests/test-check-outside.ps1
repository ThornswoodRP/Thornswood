<#
  test-check-outside.ps1

      pwsh -NoProfile -File .\tests\test-check-outside.ps1

  Check-Outside.ps1 walks what a first install needs that this project does
  not run: the launcher's Releases on GitHub, the package and the installer
  the channel's Release carries, the downloads, Steam's public build and the
  Nexus collection. Nothing watched any of it before.

  MEASURED 27 NOVEMBER 2026, from a cloud session. main was on
  main-build-1.3.128: releases.main.json named
  Thornswood-1.3.128-main-full.nupkg at 102,164,205 bytes, the Release carried
  it at that size and sha256 with setup-files.main.json and
  Thornswood-Setup.exe (109,897,200 bytes), and both answered 302 to
  release-assets.githubusercontent.com and then their first byte. dev was on
  build-1.3.135 the same way, with Thornswood-Dev-Setup.exe. Until then the
  script walked the site's version.json and the AllowedHosts list in
  Updater.cs, neither of which a launcher has read since #5796, so it and
  this harness were red on every run (#7114).

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
$Repos  = 'https://api.github.com/repos/Owner/Public'
function Api([string]$id) { return ($Repos + '/releases/assets/' + $id) }
$List1  = $Repos + '/releases?per_page=100'
$List2  = 'https://api.github.com/repositories/42/releases?per_page=100&page=2'
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
$ShaPkg = ('ab' * 32)

# A file of a Release as GitHub's list gives it.
function File([string]$id, [string]$name, [long]$size, [string]$sha = '', [string]$state = 'uploaded', [string]$url = '') {
  $f = [ordered]@{ id = [long]$id; url = $(if ($url) { $url } else { Api $id }); name = $name; size = $size; state = $state }
  if ($sha) { $f.digest = 'sha256:' + $sha }
  return $f
}
function Rel([string]$tag, [string]$at, $files, [bool]$pre = $false, [bool]$draft = $false) {
  $r = [ordered]@{ tag_name = $tag; draft = $draft; prerelease = $pre; published_at = $(if ($draft) { $null } else { $at }); assets = @($files) }
  return $r
}
function ListJson($rels) { return (ConvertTo-Json -InputObject @($rels) -Depth 8) }
# A Velopack feed: each entry "version:type:file:size:sha".
function FeedJson([string[]]$entries) {
  $as = @()
  foreach ($e in $entries) {
    $b = $e -split ':'
    $as += [ordered]@{ PackageId = 'Thornswood'; Version = $b[0]; Type = $b[1]; FileName = $b[2]; SHA256 = $b[4].ToUpperInvariant(); Size = [long]$b[3] }
  }
  return (ConvertTo-Json -InputObject ([ordered]@{ Assets = @($as) }) -Depth 6)
}
function SteamJson([string]$build) {
  return ('{"data":{"489830":{"depots":{"branches":{"public":{"buildid":"' + $build + '","timeupdated":"1787839209"}}}}},"status":"success"}')
}
$gh = @{ left = '55'; reset = '1790000000' }

# The main channel's Release, its files as they should be.
function MainFiles {
  return @(
    (File '10' 'releases.main.json' 300),
    (File '11' 'Thornswood-1.3.128-main-full.nupkg' 1234 $ShaPkg),
    (File '12' 'setup-files.main.json' 50),
    (File '13' 'Thornswood-Setup.exe' 5000))
}
$MainFeed = FeedJson @(('1.3.127:Full:Thornswood-1.3.127-main-full.nupkg:999:' + ('cd' * 32)), ('1.3.128:Full:Thornswood-1.3.128-main-full.nupkg:1234:' + $ShaPkg))

# Everything answering the way it should. Page one: a draft carrying main's
# feed (no stranger sees it, and it is never taken), dev's newer Release,
# main's Release, and a Release that carries no feed at all. Page two: an
# older main Release.
function Clean([string]$feed = $MainFeed) {
  $script:Served = @{}
  $page1 = @(
    (Rel 'main-build-9.9.9' '' @((File '90' 'releases.main.json' 300)) $false $true),
    (Rel 'build-1.3.135' '2026-11-27T00:42:32Z' @((File '20' 'releases.dev.json' 300), (File '21' 'Thornswood-1.3.135-dev-full.nupkg' 777 $ShaPkg), (File '22' 'setup-files.dev.json' 50), (File '23' 'Thornswood-Dev-Setup.exe' 6000)) $true),
    (Rel 'main-build-1.3.128' '2026-11-26T21:07:01Z' (MainFiles)),
    (Rel 'content-dev-abc' '2026-11-26T22:00:00Z' @((File '30' 'Thornswood-Content.esp' 10))))
  Serve $List1 200 (ListJson $page1) @{ left = '54'; reset = '1790000000'; link = ('<' + $List2 + '>; rel="next", <' + $List2 + '>; rel="last"') }
  Serve $List2 200 (ListJson @((Rel 'main-build-1.3.100' '2026-11-10T10:00:00Z' @((File '40' 'releases.main.json' 300))))) @{ left = '53'; reset = '1790000000'; link = ('<' + $List1 + '>; rel="prev"') }
  Serve (Api '10') 302 '' @{ location = (Cdn '10'); left = '52' }
  Serve (Cdn '10') 200 $feed
  Serve (Api '20') 302 '' @{ location = (Cdn '20') }
  Serve (Cdn '20') 200 (FeedJson @(('1.3.135:Full:Thornswood-1.3.135-dev-full.nupkg:777:' + $ShaPkg)))
  foreach ($pair in @(@('11', '1234'), @('13', '5000'), @('21', '777'), @('23', '6000'))) {
    Serve (Api $pair[0]) 302 '' @{ location = (Cdn $pair[0]); left = '51' }
    Serve (Cdn $pair[0]) 206 '' @{ range = ('bytes 0-0/' + $pair[1]) }
  }
  Serve $Steam 200 (SteamJson '100')
  Serve $Gql 200 (NexusJson 'Thornswood' 1)
}
# Main's Release again, with its files as given.
function MainWith($files) {
  $page1 = @((Rel 'main-build-1.3.128' '2026-11-26T21:07:01Z' $files))
  Serve $List1 200 (ListJson $page1) $gh
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-outside-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $root
$record = Join-Path $root 'steam-build.json'
[IO.File]::WriteAllText($record, '{ "appId": 489830, "publicBuildId": "100", "recordedUtc": "2026-09-24T10:00:14Z" }')
$pageRecord = Join-Path $root 'collection-page.json'
$page = @{ version = 1; collection = 'abc123'; revision = 1; summary = 'Try [[SkyUI|12604]].'; description = $description; installInstructions = ''; notSaid = @() }
[IO.File]::WriteAllText($pageRecord, (ConvertTo-Json -InputObject $page))

function Run([string]$branch = 'main', [string]$steamRecord = $record, [string]$collection = $Nexus, [string]$repo = $A) {
  $script:Asked.Clear()
  $all = @(Invoke-Outside -Repo $repo -Branch $branch -SteamRecord $steamRecord `
             -Collection $collection -PageRecord $pageRecord -Server @('thornswood.net', '192.0.2.99') 6>&1)
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

try {
  # ---- the files it reads out of the repository ------------------------------
  $d = Read-Defaults (Join-Path $RepoRoot 'launcher\app\Config.cs')
  Yes 'the launcher''s repository is read out of the real Velo.cs' ($d.Repo -eq 'ThornswoodRP/Thornswood')
  Yes 'the collection address is read out of the real Config.cs' ($d.Collection -like 'https://*nexusmods.com/*')
  Yes 'and the site, so it can be kept off it' ($d.SiteHost -eq 'thornswood.net')
  $real = [IO.File]::ReadAllText((Join-Path $RepoRoot 'records\steam-build.json')) | ConvertFrom-Json
  Yes 'records\steam-build.json records app 489830 and a build number' ($real.appId -eq 489830 -and ([string]$real.publicBuildId) -match '^\d+$')
  $merge = [IO.File]::ReadAllText((Join-Path $RepoRoot '.github\workflows\merge-release.yml'))
  Yes 'the installers it looks for are the ones merge-release.yml publishes' (
    $merge.Contains("'Thornswood-Dev-Setup.exe'") -and $merge.Contains("'Thornswood-Setup.exe'") -and (Setup-Name 'dev') -eq 'Thornswood-Dev-Setup.exe' -and (Setup-Name 'main') -eq 'Thornswood-Setup.exe')
  $velo = [IO.File]::ReadAllText((Join-Path $RepoRoot 'launcher\app\VeloUpdate.cs'))
  Yes 'and the feed is the one the launcher reads, releases.<channel>.json' ($velo.Contains('feedName = "releases." + channel + ".json"'))

  # ---- everything as it should be ------------------------------------------
  Clean
  $r = Run
  Yes 'with nothing wrong it finds nothing, so it can exit 0' ($r.N -eq 0 -and $r.Bad.Count -eq 0)
  Yes 'the main channel is the newest published Release with main''s feed, not dev''s newer one nor a draft' (Has $r.Ok 'the main channel is on main-build-1.3.128, published 26 Nov 2026 21:07 UTC*')
  Yes 'the second page of the list is followed, as the launcher reads up to five' (AskedFor $r $List2)
  Yes 'the feed is read the way the launcher reads it, its API address with Accept octet-stream' (@($r.Asked | Where-Object { $_.Url -eq (Api '10') -and $_.Accept -eq 'application/octet-stream' }).Count -eq 1)
  Yes 'of the two full packages a feed names, the highest numbered is the one checked' (Has $r.Ok 'releases.main.json names launcher 1.3.128, Thornswood-1.3.128-main-full.nupkg, and the Release carries it at the size and sha256 the feed gives.')
  Yes 'the files a first start reads and the installer are found' ((Has $r.Ok '*carries setup-files.main.json*') -and (Has $r.Ok '*carries Thornswood-Setup.exe*'))
  Yes 'the package is asked for with Accept octet-stream, then only the first byte of where GitHub sends it' (
    (@($r.Asked | Where-Object { $_.Url -eq (Api '11') -and $_.Accept -eq 'application/octet-stream' }).Count -eq 1) -and (@($r.Asked | Where-Object { $_.Url -eq (Cdn '11') -and $_.FirstByte }).Count -eq 1))
  Yes 'and the installer the same way' (@($r.Asked | Where-Object { $_.Url -eq (Cdn '13') -and $_.FirstByte }).Count -eq 1)
  Yes 'nothing of dev''s Release, the draft or an older Release is fetched' (-not ((AskedFor $r (Api '20')) -or (AskedFor $r (Api '90')) -or (AskedFor $r (Api '40')) -or (AskedFor $r (Api '21'))))
  $apiCalls = @($r.Asked | Where-Object { $_.Url -like 'https://api.github.com/*' }).Count
  Yes ('the whole walk costs ' + $apiCalls + ' of a stranger''s sixty GitHub API calls') ($apiCalls -le 5)
  Yes 'the Steam build matches the record' (Has $r.Ok "Steam's public build is still 100, as recorded 2026-09-24.")
  Yes 'Nexus GraphQL found reports name and revision' (Has $r.Ok 'the collection "Thornswood" is there, revision 1.')
  Yes 'Nexus is asked by anonymous GraphQL POST, not the collection page' (@($r.Asked | Where-Object { $_.Url -eq $Gql -and $_.Method -eq 'POST' -and $_.PostBody -like '*abc123*skyrimspecialedition*' }).Count -eq 1)
  Yes 'the collection page itself is not requested' (-not (AskedFor $r $Nexus))
  Yes 'the depot pins are said to be unchecked, not passed' (Has $r.Skip '*depot manifests*check by hand.')
  Yes 'the signed download address is never printed' (($r.Text + ($r.Ok -join ' ')) -notmatch 'SECRETJWT|jwt=')
  Yes 'only its host is' ($r.Text -match 'release-assets\.githubusercontent\.com')

  # ---- the dev channel -------------------------------------------------------
  Clean
  $r = Run 'dev'
  Yes 'the dev channel takes dev''s Release, a prerelease, and dev''s installer' ($r.N -eq 0 -and (Has $r.Ok 'the dev channel is on build-1.3.135*') -and (Has $r.Ok '*carries Thornswood-Dev-Setup.exe*'))
  Yes 'and fetches its package, not main''s' ((AskedFor $r (Api '21')) -and -not (AskedFor $r (Api '11')))

  # ---- the newest by when it was published, wherever it is on the list --------
  Clean
  Serve $List2 200 (ListJson @((Rel 'main-build-1.3.129' '2026-11-27T01:00:00Z' (MainFiles)))) $gh
  $r = Run
  Yes 'a Release published later on the second page is the channel''s, as the launcher sorts them' (Has $r.Ok 'the main channel is on main-build-1.3.129*')

  # ---- the list itself ---------------------------------------------------------
  Clean
  Serve $List1 404 '{"message":"Not Found"}' $gh
  $r = Run
  Yes 'a repository a stranger gets 404 for is wrong, and said' ($r.N -ge 1 -and (Has $r.Bad 'Owner/Public answers a stranger with 404*'))
  Yes 'and nothing else of GitHub is asked' (@($r.Asked | Where-Object { $_.Url -like 'https://api.github.com/*' }).Count -eq 1)
  Yes 'Steam is still asked, it does not come from GitHub' (AskedFor $r $Steam)

  Clean
  Serve $List1 403 '{"message":"API rate limit exceeded"}' @{ left = '0'; reset = '1790000000' }
  $r = Run
  Yes 'a spent allowance is said as that' (Has $r.Bad 'the Releases were not listed. GitHub*used up*')
  Yes 'and is not called a private repository' (-not (Has $r.Bad '*private*'))

  Clean
  Serve $List1 200 '<html>busy</html>' $gh
  $r = Run
  Yes 'a list that is not JSON is wrong' (Has $r.Bad 'could not list the Releases in Owner/Public: nothing (the listing was not JSON)*')

  Clean
  Serve $List1 200 (ListJson @((Rel 'content-dev-abc' '2026-11-26T22:00:00Z' @((File '30' 'Thornswood-Content.esp' 10))))) $gh
  Serve $List2 200 '[]' $gh
  $r = Run
  Yes 'no Release carrying the channel''s feed is wrong' ($r.N -eq 1 -and (Has $r.Bad 'none of the 1 published Releases a stranger can see in Owner/Public carries releases.main.json*'))

  Clean
  $r = Run 'main' $record $Nexus ''
  Yes 'no repository read out of Velo.cs is wrong, not a pass' (Has $r.Bad 'could not read the launcher''s repository*')

  # ---- the feed ----------------------------------------------------------------
  Clean '{ not json'
  $r = Run
  Yes 'a feed that is not a Velopack feed is wrong' ($r.N -eq 1 -and (Has $r.Bad 'releases.main.json on main-build-1.3.128 answers but is not a Velopack feed*'))

  Clean
  Serve (Cdn '10') 403 ''
  $r = Run
  Yes 'a feed GitHub sends on to storage that refuses it is wrong' (Has $r.Bad 'releases.main.json on main-build-1.3.128 cannot be read: GitHub sends releases.main.json on to release-assets.githubusercontent.com, which answers 403.*')

  Clean (FeedJson @(('1.3.128:Delta:Thornswood-1.3.128-main-delta.nupkg:5:' + $ShaPkg)))
  $r = Run
  Yes 'a feed with no full package is wrong' (Has $r.Bad '*names no full package*')

  # ---- what the feed names -------------------------------------------------------
  Clean
  MainWith @((File '10' 'releases.main.json' 300), (File '12' 'setup-files.main.json' 50), (File '13' 'Thornswood-Setup.exe' 5000))
  $r = Run
  Yes 'a package the feed names and the Release does not carry is wrong' ($r.N -eq 1 -and (Has $r.Bad 'releases.main.json names Thornswood-1.3.128-main-full.nupkg (1.3.128), and main-build-1.3.128 carries no finished file of that name*'))
  Yes 'and it is not fetched' (-not (AskedFor $r (Api '11')))

  Clean
  MainWith @((File '10' 'releases.main.json' 300), (File '11' 'Thornswood-1.3.128-main-full.nupkg' 1234 $ShaPkg 'starter'), (File '12' 'setup-files.main.json' 50), (File '13' 'Thornswood-Setup.exe' 5000))
  $r = Run
  Yes 'an upload that never finished counts as not there' (Has $r.Bad '*carries no finished file of that name*')

  Clean
  MainWith @((File '10' 'releases.main.json' 300), (File '11' 'Thornswood-1.3.128-main-full.nupkg' 1200 $ShaPkg), (File '12' 'setup-files.main.json' 50), (File '13' 'Thornswood-Setup.exe' 5000))
  $r = Run
  Yes 'a package of another size than the feed''s is wrong' (Has $r.Bad 'Thornswood-1.3.128-main-full.nupkg is 1200 bytes on main-build-1.3.128 and releases.main.json says 1234*')

  Clean
  MainWith @((File '10' 'releases.main.json' 300), (File '11' 'Thornswood-1.3.128-main-full.nupkg' 1234 ('ef' * 32)), (File '12' 'setup-files.main.json' 50), (File '13' 'Thornswood-Setup.exe' 5000))
  $r = Run
  Yes 'a package whose sha256 is not the feed''s is wrong' (Has $r.Bad '*has the sha256 efef*releases.main.json says abab*')

  Clean
  MainWith @((File '10' 'releases.main.json' 300), (File '11' 'Thornswood-1.3.128-main-full.nupkg' 1234 $ShaPkg), (File '13' 'Thornswood-Setup.exe' 5000))
  $r = Run
  Yes 'a Release with no setup-files list is wrong' ($r.N -eq 1 -and (Has $r.Bad 'main-build-1.3.128 carries no setup-files.main.json*'))

  Clean
  MainWith @((File '10' 'releases.main.json' 300), (File '11' 'Thornswood-1.3.128-main-full.nupkg' 1234 $ShaPkg), (File '12' 'setup-files.main.json' 50))
  $r = Run
  Yes 'a Release with no installer is wrong' ($r.N -eq 1 -and (Has $r.Bad 'main-build-1.3.128 carries no Thornswood-Setup.exe, so nobody new can install from the main channel.'))

  # ---- the downloads themselves ----------------------------------------------
  Clean
  Serve (Cdn '11') 206 '' @{ range = 'bytes 0-0/4000' }
  $r = Run
  Yes 'a package whose bytes are not the size GitHub lists is wrong' (Has $r.Bad 'Thornswood-1.3.128-main-full.nupkg is 4000 bytes at release-assets.githubusercontent.com and GitHub lists it at 1234*')

  Clean
  Serve (Cdn '13') 403 ''
  $r = Run
  Yes 'a redirect to something that will not hand it over is wrong' (Has $r.Bad 'Thornswood-Setup.exe: GitHub sends it on to release-assets.githubusercontent.com, which answers 403*')

  Clean
  Serve (Api '11') 404 '' $gh
  $r = Run
  Yes 'a listed file GitHub will not hand out is wrong' (Has $r.Bad 'GitHub answers 404 when a launcher asks for Thornswood-1.3.128-main-full.nupkg*')

  # ---- the server is never asked --------------------------------------------
  Clean
  MainWith @((File '10' 'releases.main.json' 300), (File '11' 'Thornswood-1.3.128-main-full.nupkg' 1234 $ShaPkg), (File '12' 'setup-files.main.json' 50), (File '13' 'Thornswood-Setup.exe' 5000 '' 'uploaded' 'https://thornswood.net/Thornswood-Setup.exe'))
  $r = Run
  Yes 'a file whose address is on the server is unchecked, not asked' ((-not (AskedFor $r 'https://thornswood.net/Thornswood-Setup.exe')) -and (Has $r.Skip 'Thornswood-Setup.exe is on the server*'))
  Clean
  $r = Run 'main' $record 'https://thornswood.net/collection'
  Yes 'a collection address on the server is not asked either' ((-not (AskedFor $r 'https://thornswood.net/collection')) -and (Has $r.Skip '*on the server, which this does not contact.'))

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
  Yes 'no other web cmdlet is used that could send something else' ($code -notmatch 'Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient')
}
finally {
  Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail) { 'Red' } else { 'Green' })
if ($script:fail) { exit 1 }
