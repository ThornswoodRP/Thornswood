<#
  CollectionRevision.ps1

  Which collection revision a release is built against, and the one place
  that number comes from (#3597).

      $r = Get-ShipRecordedCollectionRevision -RepoDir <repo>
      $why = Get-ShipCollectionRevisionProblem -RepoDir <repo> -Built <n> -Slug <slug> -Source <words> -Remedy <words>
      $why = Get-ShipNewestRevisionProblem -RepoDir <repo>

  records\collection-plugins.json names the collection and the revision its
  plugins are, and both deploys already hold every plugin they send to it
  (CollectionPlugins.ps1, #2019). It is the revision Nexus gives people and the
  servers are deployed against, so it is what the feed's collectionRevision
  says, and the launcher holds Play until an install is on it (Shell.cs,
  CollectionProblem).

  Until #3597 the feed's number came from somewhere else: a Ship from One wrote
  the revision One's Vortex had installed, and a Ship from the feed carried the
  last release's. One's Vortex stayed on revision 2 while revisions 3, 4 and 5
  were made and published without it, so both feeds said 2 from 21 to 27 Oct,
  and a launcher on revision 2 read as current and was let in (Patrick, 27 Oct:
  "my local collection is on #2 and the launcher never made me update to the
  newest one and still let me in").

  So a release names the recorded revision, and it may only be built from a
  source that is on it: One's Vortex for a Ship from One (its plugin list, load
  order and bodies are read there), the last release for a Ship from the feed
  (it carries that release's plugin list). When the source is on another
  revision, or cannot say which, the Ship stops, naming both numbers, before
  anything is built. It never writes the source's number instead.

  And the record has to be the newest revision published on Nexus (#4068), so
  a release is never built on an old one and every launcher is held to the
  newest: Get-ShipNewestRevisionProblem asks Nexus (NexusPublished.ps1) and
  stops a release while the record is behind it or ahead of it.
  Check-CollectionRevisions.ps1 holds Nexus, the record and both feeds to each
  other every hour, and files the rebuild on the board when they part.

  Dot-sourced by Ship-Rules.ps1; defines functions and
  nothing else. Runs in PowerShell 7.
#>

# The record's collection and revision, as { Slug; Revision }. Throws, naming
# the file, when it is not there, does not read, or names no whole revision.
function Get-ShipRecordedCollectionRevision([string]$RepoDir, [string]$Path) {
    if (-not $Path) { $Path = Join-Path $RepoDir 'records\collection-plugins.json' }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "There is no $Path, so nothing says which collection revision this release is built against."
    }
    try { $doc = ([IO.File]::ReadAllText($Path) -replace ('^' + [char]0xFEFF), '') | ConvertFrom-Json }
    catch { throw ("$Path does not read as JSON, so nothing says which collection revision this release is built against: " + ($_.Exception.Message -replace '\s+', ' ')) }
    $slug = if ($doc.PSObject.Properties['collection']) { [string]$doc.collection } else { '' }
    $raw = if ($doc.PSObject.Properties['revision']) { $doc.revision } else { $null }
    $n = 0
    if ($null -eq $raw -or $raw -is [bool] -or $raw -is [string] -or -not [int]::TryParse([string]$raw, [ref]$n) -or $n -lt 1) {
        throw "$Path names no whole collection revision, so nothing says which one this release is built against."
    }
    if ($slug -notmatch '^[A-Za-z0-9]+$') { throw "$Path names no collection, so the revision it records is not known to be this collection's." }
    return [pscustomobject]@{ Slug = $slug; Revision = $n; Path = $Path }
}

# '' when a release built from a source on revision $Built may go out naming
# the recorded revision; otherwise the reason it may not, with both numbers
# and $Remedy. $Source says what $Built was read from ("this machine's Vortex",
# "the dev feed's last release"). A record that does not read is a reason too.
function Get-ShipCollectionRevisionProblem([string]$RepoDir, [int]$Built, [string]$Slug, [string]$Source, [string]$Remedy, [string]$Path) {
    try { $rec = Get-ShipRecordedCollectionRevision $RepoDir $Path }
    catch { return $_.Exception.Message }
    if ($Slug -and $Slug -ne $rec.Slug) {
        return "This release names collection $Slug and records\collection-plugins.json is collection $($rec.Slug)'s, so which revision it is built against is not known. $Remedy"
    }
    if ($Built -le 0) {
        return "$Source does not say which collection revision it is on, and the collection is on revision $($rec.Revision) (records\collection-plugins.json). A release has to be built from revision $($rec.Revision) to say so. $Remedy"
    }
    if ($Built -lt $rec.Revision) {
        return "The collection is on revision $($rec.Revision) (records\collection-plugins.json, what Nexus gives people and the deploys hold the servers' plugins to) and $Source is on revision $Built. A release built from it would carry revision $Built's plugins and tell every launcher that $Built is current, so an install left on $Built would be let in. $Remedy"
    }
    if ($Built -gt $rec.Revision) {
        return "$Source is on collection revision $Built and records\collection-plugins.json is still on $($rec.Revision). Record revision $Built (scripts\mods\New-CollectionPluginRecord.ps1) in its own pull request first, so the deploys and this release agree on it. $Remedy"
    }
    return ''
}

# A RELEASE FROM THE FEED THAT MOVES THE REVISION (#4069). A Ship from the
# feed carries the last release's plugin list, so until 31 Oct 2026 only a
# Ship from One could move the revision, and with One retired from releases a
# new revision stopped every Ship. The plugin list a revision ships is the
# servers' order, which is game\data\last-plugin.json's: every table and the
# Last plugin of the checkout were built against it, and
# Get-ShipLastPluginProblem holds that order to the bytes
# records\collection-plugins.json gives people for the recorded revision. So a
# release from the feed may move from the feed's revision to the recorded one
# when the checkout holds the Last plugin's recipe and manifest, and then its
# list is that order (New-ShipFeedMoveLists, Ship-Rules.ps1), held to the
# order the channel's server loads before anything is built.
# Returns the revision it moves to, or 0 when it does not move: the feed is
# already on the record, says no revision, is ahead of it, or the checkout
# has no order to move with.
function Get-ShipFeedMoveRevision([string]$RepoDir, [int]$Built, [string]$Path) {
    if ($Built -le 0) { return 0 }
    try { $rec = Get-ShipRecordedCollectionRevision $RepoDir $Path } catch { return 0 }
    if ($Built -ge $rec.Revision) { return 0 }
    foreach ($f in 'game\data\last-plugin.recipe', 'game\data\last-plugin.json') {
        if (-not (Test-Path -LiteralPath (Join-Path $RepoDir $f) -PathType Leaf)) { return 0 }
    }
    return $rec.Revision
}

# '' when the recorded revision is the newest one published on Nexus;
# otherwise the reason no release may go out (#4068). Patrick, 27 Oct, when
# revision 5 had been out six days and both feeds still said 2: "1. The
# launcher should always be on the newest revision 2. the new updates should
# be based on the newest revison 3. the launcher should refuse if not on the
# latest revison". A release names the recorded revision and the launcher
# holds Play to it, so a record behind Nexus is a release built on an old
# revision that tells every launcher the old one is current.
#
# $Published is what Nexus says, for a harness; left at 0 it is asked of
# Nexus through NexusPublished.ps1 beside this file. A Nexus that does not
# answer is a reason too: nothing then says the record is the newest.
function Get-ShipNewestRevisionProblem([string]$RepoDir, [int]$Published = 0, [string]$Path) {
    try { $rec = Get-ShipRecordedCollectionRevision $RepoDir $Path }
    catch { return $_.Exception.Message }
    if ($Published -le 0) {
        try { $Published = [int](& (Join-Path $PSScriptRoot 'NexusPublished.ps1') -Slug $rec.Slug) }
        catch { return ("Nexus did not say which revision of collection $($rec.Slug) is the newest published one (" + ($_.Exception.Message -replace '\s+', ' ') + "), so nothing says this release is built on it. Run it again once Nexus answers. Nothing was built or published.") }
    }
    if ($Published -gt $rec.Revision) {
        return "Collection revision $Published is published on Nexus and records\collection-plugins.json is still on $($rec.Revision), so this release would be built on revision $($rec.Revision) and tell every launcher it is current. Record revision $Published (scripts\mods\New-CollectionPluginRecord.ps1) in its own pull request, rebuild dev on it, then main, and Ship after that. Nothing was built or published."
    }
    if ($Published -lt $rec.Revision) {
        return "records\collection-plugins.json is on collection revision $($rec.Revision) and the newest revision published on Nexus is $Published, so nobody can install the revision this release would name. Publish revision $($rec.Revision) (scripts\release\New-NexusRevision.ps1 -Publish $($rec.Revision)) first. Nothing was built or published."
    }
    return ''
}
