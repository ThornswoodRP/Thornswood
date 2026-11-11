<#
  Check-CollectionRevisions.ps1

  Holds Nexus's newest published collection revision, the record and both
  feeds to each other, and keeps one issue on the board for the rebuild while
  they part (#4068).

      .\scripts\release\Check-CollectionRevisions.ps1            says, changes nothing
      .\scripts\release\Check-CollectionRevisions.ps1 -Issue     and opens or closes the issue

  WHY. Collection revision 5 was published on Nexus on 21 Oct, and on 27 Oct
  both feeds still named revision 2. Nothing compared them, and nothing told
  anybody the servers had to be rebuilt, so a launcher on revision 2 was let
  in and one on 5 was held out. Patrick, 27 Oct: "1. The launcher should
  always be on the newest revision 2. the new updates should be based on the
  newest revison 3. the launcher should refuse if not on the latest revison".
  A Ship already refuses while the record is not the newest published
  revision (CollectionRevision.ps1, Get-ShipNewestRevisionProblem); this is
  what notices a revision nobody has shipped yet, however it was published,
  in Vortex by hand or with New-NexusRevision.ps1 -Publish.

  WHAT IT READS. The newest published revision from Nexus
  (NexusPublished.ps1, the public read, no key), the revision
  records\collection-plugins.json names in this checkout, and the
  collectionRevision in the signed manifest of the Release each channel runs
  (ReleaseRevision.ps1), which is the number every launcher holds Play to
  (#5767). Until 11 Nov that was the feed's, which only a Ship writes; nothing
  ships through a Ship any more, and revision 8 sat behind 7 on both feeds
  from 8 to 11 Nov.

  WHAT IT SAYS. Exit 0 when all four agree, 1 when they do not, with a line
  for each that is behind, 2 when one of them could not be read: a check that
  cannot read its numbers has not checked anything, so it never answers 0.

  -Issue (.github/workflows/collection-revision.yml, every hour, with GH_TOKEN
  and REPO set). While they part, one open issue named for the newest
  revision says what is behind, so the rebuild is on the board for the Desk:
  the record first (its merge release carries the revision to dev), then
  main with the next promotion. None is opened while one for that revision is open. Once
  all four say the same revision, every open one is closed by this, saying
  so. An unreadable number changes no issue. Exit 0 once the issue is as it
  should be, 2 as above.

  tests\test-4068-revision-check.ps1 runs it against stand-ins. Works on
  Windows PowerShell 5.1 and PowerShell 7.
#>
[CmdletBinding()]
param([switch]$Issue)
$ErrorActionPreference = 'Stop'
$script:RevisionHere = $PSScriptRoot
if (-not $script:RevisionHere) { $script:RevisionHere = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $script:RevisionHere 'CollectionRevision.ps1')

$script:RevisionTitle = 'Collection revision {0} is published: rebuild dev, then main, on it'
$script:RevisionTitleRx = '^Collection revision \d+ is published: rebuild dev, then main, on it$'

# Each number, read once. The tests replace these three.
function Read-RevisionNexus([string]$Slug) { return [int](& (Join-Path $script:RevisionHere 'NexusPublished.ps1') -Slug $Slug) }
function Read-RevisionRelease([string]$Channel) {
    . (Join-Path $script:RevisionHere 'ReleaseRevision.ps1')
    $r = Get-ChannelReleaseRevision -Channel $Channel -Repo $(if ($env:REPO) { $env:REPO } else { 'ThornswoodRP/Thornswood' })
    return $r.Revision
}
function Invoke-RevisionApi {
    param([string]$Method, [string]$Path, $Body = $null)
    $h = @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'thornswood-collection-revision'; Accept = 'application/vnd.github+json' }
    $uri = "https://api.github.com/repos/$env:REPO/$Path"
    if ($null -ne $Body) {
        $r = Invoke-RestMethod -Method $Method -Headers $h -Uri $uri -Body ($Body | ConvertTo-Json) -ContentType 'application/json'
    } else {
        $r = Invoke-RestMethod -Method $Method -Headers $h -Uri $uri
    }
    return $r
}

# The four numbers and what parts, as { Nexus; Record; Main; Dev; Unread;
# Behind }. Unread names each number that could not be read; Behind holds a
# line for each one that is not the newest published revision.
function Get-RevisionState([string]$RepoDir) {
    $unread = @()
    $rec = $null
    try { $rec = Get-ShipRecordedCollectionRevision $RepoDir } catch { $unread += ('the record: ' + $_.Exception.Message) }
    $slug = if ($rec) { $rec.Slug } else { '7essxf' }
    $nexus = 0; $main = 0; $dev = 0
    try { $nexus = Read-RevisionNexus $slug } catch { $unread += ('Nexus: ' + ($_.Exception.Message -replace '\s+', ' ')) }
    try { $main = Read-RevisionRelease 'main' } catch { $unread += ('main''s Release: ' + ($_.Exception.Message -replace '\s+', ' ')) }
    try { $dev = Read-RevisionRelease 'dev' } catch { $unread += ('dev''s Release: ' + ($_.Exception.Message -replace '\s+', ' ')) }
    $record = if ($rec) { [int]$rec.Revision } else { 0 }
    $behind = @()
    if (-not $unread.Count) {
        if ($record -ne $nexus) { $behind += ("records\collection-plugins.json names revision {0}" -f $record) }
        if ($dev -ne $nexus) { $behind += ("the Release dev runs names revision {0}, so every dev launcher holds Play to it" -f $dev) }
        if ($main -ne $nexus) { $behind += ("the Release main runs names revision {0}, so every main launcher holds Play to it" -f $main) }
    }
    return [pscustomobject]@{ Nexus = $nexus; Record = $record; Main = $main; Dev = $dev; Unread = @($unread); Behind = @($behind) }
}

# Every open issue (not pull request) named for a revision rebuild, oldest
# first, from every page.
function Get-RevisionIssues {
    $found = @()
    $page = 1
    while ($true) {
        $batch = @(Invoke-RevisionApi 'GET' ("issues?state=open&sort=created&direction=asc&per_page=100&page=$page"))
        foreach ($i in $batch) {
            if ($i.PSObject.Properties['pull_request'] -and $i.pull_request) { continue }
            if ([string]$i.title -match $script:RevisionTitleRx) { $found += $i }
        }
        if ($batch.Count -lt 100) { break }
        $page++
        if ($page -gt 50) { throw 'More than 5,000 open issues: stopped reading pages.' }
    }
    return @($found | Sort-Object { [int]$_.number })
}

# The issue as the state says it should be. Returns one line saying what it did.
function Sync-RevisionIssue($State) {
    if ($State.Unread.Count) { return 'a number could not be read, so no issue was changed' }
    $open = @(Get-RevisionIssues)
    $said = @()
    $title = $script:RevisionTitle -f $State.Nexus
    if (-not $State.Behind.Count) {
        foreach ($o in $open) {
            [void](Invoke-RevisionApi 'POST' "issues/$($o.number)/comments" @{ body = ("Nexus, the record and the Releases dev and main run all name collection revision {0} now. Closed by the hourly revision check." -f $State.Nexus) })
            [void](Invoke-RevisionApi 'PATCH' "issues/$($o.number)" @{ state = 'closed'; state_reason = 'completed' })
            $said += "closed #$($o.number)"
        }
        if (-not $open.Count) { $said += 'all on one revision, nothing open' }
        return ($said -join '; ')
    }
    # One for an older revision is that rebuild overtaken: this one carries it.
    $same = @($open | Where-Object { [string]$_.title -eq $title })
    foreach ($o in @($open | Where-Object { [string]$_.title -ne $title })) {
        [void](Invoke-RevisionApi 'POST' "issues/$($o.number)/comments" @{ body = ("Collection revision {0} is published since, so the rebuild is onto it now. Closed by the hourly revision check." -f $State.Nexus) })
        [void](Invoke-RevisionApi 'PATCH' "issues/$($o.number)" @{ state = 'closed'; state_reason = 'not_planned' })
        $said += "closed #$($o.number), an older revision"
    }
    if ($same.Count) { $said += "#$($same[0].number) is open for it"; return ($said -join '; ') }
    $body = ("Collection revision {0} is published on Nexus and is not shipped yet: {1}.`n" -f $State.Nexus, ($State.Behind -join '; ')) +
            "Record it in a pull request (New-CollectionPluginRecord.ps1; when its plugins changed, Thornswood-Last.esp is rebuilt on its order, Rebuild-ContentTables). That merge's release carries the revision to dev, and main takes it with the next promotion (promote-main.yml).`n" +
            "Done when Nexus, the record and the Releases dev and main run name revision $($State.Nexus); the hourly revision check closes this then."
    $i = Invoke-RevisionApi 'POST' 'issues' @{ title = $title; body = $body; labels = @('area: Release') }
    $said += "opened #$($i.number)"
    return ($said -join '; ')
}

if ($MyInvocation.InvocationName -eq '.') { return }

$repoDir = (Resolve-Path -LiteralPath (Join-Path $script:RevisionHere '..\..')).ProviderPath
$state = Get-RevisionState $repoDir
Write-Host ("  Nexus {0}, the record {1}, dev's Release {2}, main's Release {3}" -f $state.Nexus, $state.Record, $state.Dev, $state.Main)
foreach ($u in $state.Unread) { Write-Host ("  could not read {0}" -f $u) -ForegroundColor Red }
foreach ($b in $state.Behind) { Write-Host ("  behind revision {0}: {1}" -f $state.Nexus, $b) -ForegroundColor Yellow }
if ($Issue) {
    foreach ($n in 'GH_TOKEN', 'REPO') {
        if (-not [Environment]::GetEnvironmentVariable($n)) { throw "$n is not set. collection-revision.yml sets it." }
    }
    Write-Host ('  ' + (Sync-RevisionIssue $state))
    if ($state.Unread.Count) { exit 2 }
    exit 0
}
if ($state.Unread.Count) { exit 2 }
if ($state.Behind.Count) { exit 1 }
Write-Host ("  all on collection revision {0}" -f $state.Nexus) -ForegroundColor Green
exit 0
