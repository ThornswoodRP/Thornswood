<#
  Dev-News.ps1

  Which notes on the dev feed are marked DEV, worked out from main's feed, and
  the one place that writes those marks and the dev feed's mainVersion.

      . (Join-Path $PSScriptRoot 'Dev-News.ps1')

  WHY IT EXISTS. The dev feed carries main's whole news list with the dev
  notes on top, and the dev launcher's News tab marks a note DEV when the dev
  build has it and main does not (Config.cs NewsItem.channel, ShellNews.cs).
  Until 6 Oct those marks were worked out only inside a dev publish that
  released something, in Publish-Update.ps1. Measured on 6 Oct 2026 at about
  11 AM: the dev feed had 40 notes, 27 marked DEV, and mainVersion 1.1.106,
  while main had shipped 1.2.0 (release 20261005-235125, from 1c0caabe) after
  the last dev Ship. Three things kept them stale:

    - a dev Ship with nothing new stopped at "Nothing to do" before the marks
      were worked out;
    - a main Ship never touched the dev feed, so after every main release the
      dev News tab showed finished work as DEV until somebody shipped dev;
    - on 5 Oct that was put right by hand with a dev Ship titled "Dev and main
      match again", a release made only to move the marks.

  So the rule lives here, once, and three things call it: a dev publish that
  releases (Set-DevFeedMarks on the feed it is about to send), a dev publish
  with nothing new, and a main Ship once main's feed is out (both through
  Update-DevFeedMarks, the second by Refresh-DevNews.ps1). A refresh makes no
  release, sends no pack, launcher or baseline, posts nothing and tells no
  server: it sends version.json alone, through Feed-Store.ps1 like any other
  feed edit, and only when a mark or mainVersion moved.

      Update-DevNewsChannels $doc $news $mainDoc $repo   the rule, note by note
      Set-DevFeedMarks $doc $mainDoc $repo               the rule and mainVersion on a feed in memory
      Update-DevFeedMarks -SourceRepo ...                receive the dev feed, mark it, send it back if it moved
      Get-DevFeedMarksLines $result                      what to say about a result
#>

. (Join-Path $PSScriptRoot 'Feed-Store.ps1')
. (Join-Path $PSScriptRoot 'Release-Name.ps1')
. (Join-Path $PSScriptRoot 'Feed-News.ps1')

# ConvertFrom-Json hands back an object with only the keys the file had:
# reading one that is not there throws under strict mode, and assigning one
# that was never there throws too. Publish-Update has its own Val and Set-Prop,
# defined well after the point where a publish with nothing new stops, so this
# file carries its own.
function Get-DevNewsVal($o, [string]$k) {
    if ($null -ne $o -and $o.PSObject.Properties.Name -contains $k) { return [string]$o.$k }
    return ''
}
function Set-DevNewsProp($obj, [string]$name, $value) {
    if ($obj.PSObject.Properties.Name -contains $name) { $obj.$name = $value }
    else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

# Every dev release Ship tagged that this clone has (release/dev/<id>,
# Add-ReleaseTag in Release-Name.ps1), each with the commit it was built from,
# whether it was built with uncommitted files, and the minutes its note can
# carry: from the minute its id names (Publish-Update mints the id before it
# writes the note) to the minute Ship tagged it (after the feed with the note
# was sent), both on the clock of the machine that shipped it, the one the
# note's date is written on. A tag with no tagger, made by hand without -a,
# has no end to that span and no message, so it is left out. Tagged is that
# last moment to the second with its zone, which puts releases in the order
# they went out across machines whose clocks are in different zones.
function Get-DevReleaseTags([string]$sourceRepo) {
    $tags = @()
    # The caller's last exit code is put back, as Is-Published does below.
    $hadCode = Test-Path -LiteralPath 'variable:global:LASTEXITCODE'
    $was = if ($hadCode) { $global:LASTEXITCODE } else { 0 }
    try {
        $g = Invoke-ReleaseGit $sourceRepo @('for-each-ref', 'refs/tags/release/dev',
            '--format=@@%(refname)%09%(objecttype)%09%(*objectname)%09%(taggerdate:iso)%0a%(contents)')
    } finally {
        if ($hadCode) { $global:LASTEXITCODE = $was }
        else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
    }
    if ($g.Code -ne 0) { return @() }
    $cur = $null
    $inv = [Globalization.CultureInfo]::InvariantCulture
    foreach ($l in @($g.Lines)) {
        $s = [string]$l
        if ($s.StartsWith('@@')) {
            if ($cur) { $tags += $cur }
            $cur = $null
            $f = $s.Substring(2).Split("`t")
            if ($f.Count -lt 4 -or $f[1] -ne 'tag' -or $f[2] -notmatch '^[0-9a-f]{40}$') { continue }
            $id = $f[0] -replace '^refs/tags/release/dev/', ''
            $from = [datetime]::MinValue; $to = [datetime]::MinValue
            # The minute its id names, on the team's clock the notes are dated
            # by: a UTC id since #4950, Mountain time before (Get-ReleaseIdUtc).
            $made = Get-ReleaseIdUtc $id
            if ($null -eq $made) { continue }
            $from = Get-TeamNow $made
            $from = $from.AddSeconds(-$from.Second)
            # "2026-10-01 20:04:26 -0600": the tagger's own clock.
            $at = $f[3].Trim()
            if ($at.Length -lt 16 -or -not [datetime]::TryParseExact($at.Substring(0, 16), 'yyyy-MM-dd HH:mm', $inv, 'None', [ref]$to)) { continue }
            $tagged = [DateTimeOffset]::MinValue
            if ($at -notmatch '^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$' -or
                -not [DateTimeOffset]::TryParseExact(('{0} {1}:{2}' -f $Matches[1], $Matches[2], $Matches[3]), 'yyyy-MM-dd HH:mm:ss zzz', $inv, 'None', [ref]$tagged)) { continue }
            $cur = [pscustomobject]@{ Id = $id; Commit = $f[2]; From = $from; To = $to; Tagged = $tagged; Clean = $true }
        } elseif ($cur -and $s -match '^built with \d+ uncommitted change') {
            # Get-ReleaseTagMessage writes this line for a release whose
            # record says uncommitted above 0.
            $cur.Clean = $false
        }
    }
    if ($cur) { $tags += $cur }
    return $tags
}

# The release a note from before sourceCommit came with: the tagged dev
# release whose span holds the note's date. $null when none does, when two do
# that were built from different commits (no one proof), or when the date is
# not a date and a time (entries older than the time on them carry a bare
# date). Two at once from the same commit are the same proof: measured on the
# 12 Oct dev feed, "Safer updates and a quieter journal key" (2 Oct 2:37 PM)
# sits in 20261002-143545-dev and 20261002-143641-dev, both from 85e44094.
function Find-DevNoteRelease($tags, [string]$date) {
    $t = [datetime]::MinValue
    if (-not [datetime]::TryParseExact(([string]$date).Trim(), 'M-d-yyyy h:mm tt', [Globalization.CultureInfo]::InvariantCulture, 'None', [ref]$t)) { return $null }
    $hits = @(@($tags) | Where-Object { $_.From -le $t -and $t -le $_.To })
    if ($hits.Count -eq 0) { return $null }
    if (@($hits | ForEach-Object { $_.Commit } | Select-Object -Unique).Count -ne 1) { return $null }
    return [pscustomobject]@{
        Ids    = @($hits | ForEach-Object { $_.Id })
        Commit = $hits[0].Commit
        Clean  = (@($hits | Where-Object { -not $_.Clean }).Count -eq 0)
        # The last of them to go out, for Is-Settled below.
        Tagged = (@($hits | ForEach-Object { $_.Tagged }) | Sort-Object | Select-Object -Last 1)
    }
}

# Which of these notes the dev build has and main does not.
#
# Main's fresh release record proves which source commits have shipped. A
# note proves its own: its sourceCommit, or when it has none (written before
# that field existed, or by a release built with uncommitted files), the dev
# release it came with (Find-DevNoteRelease), and for a release built with
# uncommitted files, a later clean one (Is-Settled). A note below one whose
# own commit main has is settled by it. Headline changes therefore cannot
# leave completed work marked Dev-only.
function Update-DevNewsChannels($doc, $news, $mainDoc, [string]$sourceRepo) {
    if ($null -eq $mainDoc) { return }
    $mainRelease = $mainDoc.PSObject.Properties['release']
    $mainCommit = if ($mainRelease) { Get-DevNewsVal $mainDoc.release 'commit' } else { '' }
    $mainClean = $mainRelease -and $mainDoc.release.PSObject.Properties['uncommitted'] -and $mainDoc.release.uncommitted -eq 0
    # Main has a Dev source when the commit is an ancestor of Main's, or when
    # Main took everything in it as a commit of its own.
    #
    # The second half is for squash merges, which is how pull requests merge
    # here. A Dev release is often built from a branch; the branch is squashed
    # onto main as one new commit and deleted, so the commit the Dev release
    # recorded never becomes an ancestor of main, and its note stayed marked
    # DEV after Main shipped the same work. Measured 5 Oct: 39 of the Dev
    # feed's 40 notes were marked, the 1 and 2 Oct ones included, which went
    # out on Main 1.1.105 on 3 Oct.
    #
    # The proof is by content, never by a headline: some commit on Main's own
    # line since the two parted, one that touched the files the Dev commit
    # changed, already held all of it, because merging the Dev commit into
    # that commit gives that commit's own tree back. That is the squash commit
    # itself. Main is not compared at its tip, because later work on the same
    # lines (a newer engine pin, the next gamemode change) makes the merge
    # conflict there although the work went in. Against main at c63e9fab this
    # reads 3 of the 39 as still Dev, the three whose Dev release was built
    # with uncommitted files: no commit records what those carried, so no
    # commit proves them (Is-Settled below is what does).
    #
    # The release tags Ship pushes (release/dev/<id>) keep those commits
    # fetchable after the branch is gone. A git too old for
    # merge-tree --write-tree (before 2.38), or a commit this clone does not
    # have, proves nothing, and the note stays marked.
    #
    # Holds asks it of any commit; Is-Published asks it of main's, which only
    # a release built with nothing uncommitted can speak for.
    $script:holdsSeen = @{}
    # Every commit a target holds as an ancestor, from one rev-list for each
    # target, in place of a merge-base --is-ancestor for every pair (#3168):
    # tests\test-2401-legacy-dev-marks.ps1 started 382 of those, nearly
    # 2,000 processes on the box with the rest. $null when git cannot list
    # it, and then each pair is asked the old way.
    $script:ancestorsOf = @{}
    function Ancestors-Of([string]$target) {
        if (-not $script:ancestorsOf.ContainsKey($target)) {
            $list = Invoke-ReleaseGit $sourceRepo @('rev-list', $target)
            $set = $null
            if ($list.Code -eq 0) {
                $set = New-Object 'System.Collections.Generic.HashSet[string]'
                foreach ($l in $list.Lines) { [void]$set.Add(([string]$l).Trim()) }
            }
            $script:ancestorsOf[$target] = $set
        }
        return ,$script:ancestorsOf[$target]
    }
    function Holds([string]$commit, [string]$target) {
        if ($commit -notmatch '^[0-9a-f]{40}$' -or $target -notmatch '^[0-9a-f]{40}$') { return $false }
        $key = $commit + ' ' + $target
        if ($script:holdsSeen.ContainsKey($key)) { return $script:holdsSeen[$key] }
        # Put back as it was, so a caller's own last exit code is not git's.
        # It may not be set at all: Refresh-DevNews.ps1 runs nothing native
        # before this, and under strict mode reading it unset throws.
        $hadCode = Test-Path -LiteralPath 'variable:global:LASTEXITCODE'
        $was = if ($hadCode) { $global:LASTEXITCODE } else { 0 }
        $yes = $false
        try {
            $before = Ancestors-Of $target
            if ($null -ne $before) { $yes = $before.Contains($commit) }
            elseif ((Invoke-ReleaseGit $sourceRepo @('merge-base', '--is-ancestor', $commit, $target)).Code -eq 0) { $yes = $true }
            if (-not $yes) {
                # What the commit changed since it parted from the target, in
                # one git: diff target...commit is the diff from their merge
                # base, and fails where they have none, as merge-base did.
                # It was a merge-base and then a diff, 117 of each in
                # tests\test-2401-legacy-dev-marks.ps1, each two processes on
                # the box behind Git's cmd\git.exe and each a Defender scan
                # (#3835).
                $changed = Invoke-ReleaseGit $sourceRepo @('diff', '--name-only', ($target + '...' + $commit))
                if ($changed.Code -eq 0) {
                    $files = @($changed.Lines | Where-Object { $_ } | ForEach-Object { ([string]$_).Trim() })
                    # Every Main commit since they parted that touched those
                    # files, oldest first, each with its tree. Past 200 files
                    # the list would not fit on a Windows command line, so
                    # every Main commit since they parted is tried instead.
                    # commit..target: everything the target has that the
                    # commit does not, which is what base..target was, the
                    # merge base being where they parted.
                    $walk = @('rev-list', '--first-parent', '--reverse', '--format=%T', ($commit + '..' + $target))
                    if ($files.Count -gt 0 -and $files.Count -le 200) { $walk += @('--') + $files }
                    $lines = @((Invoke-ReleaseGit $sourceRepo $walk).Lines | ForEach-Object { ([string]$_).Trim() })
                    for ($i = 0; $i + 1 -lt $lines.Count -and -not $yes; $i += 2) {
                        if ($lines[$i] -notmatch '^commit ([0-9a-f]{40})$') { $i--; continue }
                        $at = $Matches[1]
                        $tree = $lines[$i + 1]
                        $merged = Invoke-ReleaseGit $sourceRepo @('merge-tree', '--write-tree', $at, $commit)
                        if ($merged.Code -eq 0 -and $merged.First -eq $tree) { $yes = $true }
                        elseif ($merged.Code -gt 1) { break }   # this git has no merge-tree --write-tree
                    }
                }
            }
        }
        finally {
            if ($hadCode) { $global:LASTEXITCODE = $was }
            else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
        }
        $script:holdsSeen[$key] = $yes
        return $yes
    }
    function Is-Published([string]$commit) {
        if (-not $mainClean) { return $false }
        return (Holds $commit $mainCommit)
    }
    # A release built with uncommitted files is settled by a later clean dev
    # release that holds its commit and is on main (Patrick, 12 Oct, #2401,
    # option B). No commit records what the uncommitted files carried, but
    # once a clean release went out after it the dev build was rebuilt from
    # committed files only: whatever they carried is either in that clean
    # release's commit, which main has, or no longer in the dev build at all,
    # and either way "dev has it and main does not" is false. Measured on the
    # 12 Oct dev feed: "Merchant purses and dungeon rewards" came with
    # 20261002-015344-dev (286519a8, 1 uncommitted), and the next clean
    # release, 20261002-143545-dev (85e44094), holds 286519a8 and is on main
    # 7cece557, so it clears. It speaks for the dev client build only: a dev
    # Ship does not redeploy the dev server's gamemode, so a gamemode change
    # deployed by hand from uncommitted files is not covered by it.
    #
    # Oldest first, so the usual proof, the next clean release, is the first
    # one tried.
    function Is-Settled($rel) {
        foreach ($l in @($devTags | Where-Object { $_.Clean -and $_.Tagged -gt $rel.Tagged } | Sort-Object Tagged)) {
            if ((Is-Published $l.Commit) -and (Holds $rel.Commit $l.Commit)) { return $true }
        }
        return $false
    }
    # A note with no sourceCommit to prove it by is proved by the dev release
    # it came with, found by that release's tag (Find-DevNoteRelease), and
    # never by its headline. That is a note from before sourceCommit existed
    # (3 Oct, 1:57 PM), which has no such field, and one written by a release
    # built with uncommitted files, whose sourceCommit Publish-Update leaves
    # empty.
    #
    # Until 12 Oct every note without the field took the commit of the dev
    # feed's current release instead. Between main releases the newest dev
    # release is always ahead of main, so every one of them was marked DEV:
    # measured on 12 Oct, the 16 notes of 1 to 3 Oct, all shipped on main
    # 1.1.105 on 3 Oct, were marked DEV beside the 4 that really were
    # (#2401). And until 18 Oct an empty sourceCommit was judged as a commit
    # main did not have, so such a note was marked DEV for good.
    #
    # No proof is not proof of the opposite. A note whose release this clone
    # has no tag for, or whose release was built with uncommitted files and
    # is not settled yet, keeps the mark it was last given.
    #
    # A sourceCommit this clone does not hold proves nothing either, and is
    # judged the same way, by its release's tag. The #3684 history rewrite of
    # 31 Oct 2026 gave every commit on main a new id and moved the release
    # tags with them, but the notes already in the dev feed kept the old ids.
    # Each read as a commit main lacked, so after main 20261031-144725, which
    # carried all of them, 12 of the 17 notes stayed DEV (#5133).
    #
    # Held means in this clone's history: reachable from a branch, a
    # remote-tracking branch or a tag, not only somewhere in its object
    # store. The gate's checkout on the box was made before the
    # rewrite and fetched main one commit deep on every run, so it still
    # keeps the old main tips as loose objects that no ref reaches. Read as
    # held, each went to Holds, which found no history shared with main, and
    # the first dev Ship with the rule above (20261031-155402-dev) still left
    # 13 of 18 marked. Asked of git twice for every note: which of the ids
    # are commits here, and which of those no branch or tag reaches.
    $devTags = $null
    $marked = 0
    $named = @(@($news) | ForEach-Object { Get-DevNewsVal $_ 'sourceCommit' } | Where-Object { $_ -match '^[0-9a-f]{40}$' } | Select-Object -Unique)
    $held = New-Object 'System.Collections.Generic.HashSet[string]'
    if ($named.Count) {
        $hadCode = Test-Path -LiteralPath 'variable:global:LASTEXITCODE'
        $was = if ($hadCode) { $global:LASTEXITCODE } else { 0 }
        try {
            $g = Invoke-ReleaseGit $sourceRepo (@('log', '--no-walk=unsorted', '--ignore-missing', '--format=%H') + $named)
            $here = @(if ($g.Code -eq 0) { @($g.Lines) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ } })
            if ($here.Count) {
                $u = Invoke-ReleaseGit $sourceRepo (@('rev-list') + $here + @('--not', '--branches', '--remotes', '--tags'))
                if ($u.Code -eq 0) {
                    $loose = New-Object 'System.Collections.Generic.HashSet[string]'
                    foreach ($l in @($u.Lines)) { [void]$loose.Add(([string]$l).Trim()) }
                    foreach ($c in $here) { if (-not $loose.Contains($c)) { [void]$held.Add($c) } }
                }
            }
        }
        finally {
            if ($hadCode) { $global:LASTEXITCODE = $was }
            else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
        }
    }
    # Newest first, as every feed keeps its notes (Publish-Update puts each new
    # one on top). The first note whose own commit main has, and whose dev
    # release was built from that commit with nothing uncommitted, settles
    # every note below it: the dev build was built whole from that commit, so
    # whatever an older dev release carried is either in that commit, which
    # main has, or no longer in the dev build at all. Either way "dev has it
    # and main does not" is false, which is Is-Settled's reasoning (#2401,
    # option B) with the release that settles it named by its own note.
    #
    # Clean is read from the release tags at that commit, every one of them
    # clean and at least one there, never from the note: the 12 Oct dev feed
    # carried sourceCommit on notes of releases built with uncommitted files
    # (20261003-192349-dev among them), and a clone with no tags proves
    # nothing, so there the old notes keep their marks as before.
    #
    # Until 31 Oct an older note with no proof of its own kept its mark for
    # good. Measured on the dev feed that day against main 20261031-144725
    # (90026c6c), with the old ids judged by their tags as above: "Loading
    # screens show the painting" (22 Oct 2:42 PM) and "Loading screen test
    # returns" (5:51 PM) stayed DEV, though the test was taken off dev at
    # 9:23 PM and main has the commit of every dev build up to 31 Oct 2:30 PM.
    # No release tag's span holds either note's time, so nothing else could
    # clear them. Settled by a commit, never by a date: a note's date and a
    # tag's time can be on different clocks (Get-TeamNow in Release-Name.ps1).
    $settled = $false
    foreach ($n in @($news)) {
        $commit = Get-DevNewsVal $n 'sourceCommit'
        if ($settled) { $published = $true }
        elseif ($commit -and $held.Contains($commit)) {
            $published = Is-Published $commit
            if ($published) {
                if ($null -eq $devTags) { $devTags = @(Get-DevReleaseTags $sourceRepo) }
                $at = @($devTags | Where-Object { $_.Commit -eq $commit })
                $settled = ($at.Count -gt 0 -and @($at | Where-Object { -not $_.Clean }).Count -eq 0)
            }
        }
        else {
            if ($null -eq $devTags) { $devTags = @(Get-DevReleaseTags $sourceRepo) }
            $rel = Find-DevNoteRelease $devTags (Get-DevNewsVal $n 'date')
            if ($rel -and $rel.Clean) { $published = Is-Published $rel.Commit }
            elseif ($rel -and (Is-Settled $rel)) { $published = $true }
            else { $published = ((Get-DevNewsVal $n 'channel') -ne 'dev') }
        }
        $want = if ($published) { '' } else { 'dev' }
        Set-DevNewsProp $n 'channel' $want
        if ($want -eq 'dev') { $marked++ }
    }
    Set-DevNewsProp $doc 'news' $news
    return $marked
}

# The rule above over a whole dev feed in memory, and mainVersion with it: the
# main feed's launcherVersion, so the dev News tab says what main is on. What
# moved comes back, note by note, so a caller can say so and send only when
# something did. A note with no channel at all reads the same as '' (main),
# which is how the launcher reads it, so giving it '' is not a change.
#
# Every note, wherever the feed keeps them (Feed-News.ps1, #1050): "news", and
# the news file once the dev feed's minLauncher reads it. $SiteDir and
# $SiteUrl are where that file is read from. The marked list is left whole in
# "news"; whoever sends the feed puts it back the way the channel keeps it
# (Set-FeedNewsList), as Update-DevFeedMarks below and Publish-Update do.
function Set-DevFeedMarks($doc, $mainDoc, [string]$SourceRepo, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net') {
    if ($null -eq $doc) { throw 'There is no dev feed to mark.' }
    if ($null -eq $mainDoc) { throw "There is no main feed to mark the dev feed against, so the dev marks were left alone." }
    $news = @(Open-FeedNewsList $doc (Get-FeedStoreSiteDir $SiteDir) $SiteUrl)
    $before = @($news | ForEach-Object { Get-DevNewsVal $_ 'channel' })
    $wasMain = Get-DevNewsVal $doc 'mainVersion'
    $marked = Update-DevNewsChannels $doc $news $mainDoc $SourceRepo
    $mainVer = Get-DevNewsVal $mainDoc 'launcherVersion'
    Set-DevNewsProp $doc 'mainVersion' $mainVer
    $cleared = @(); $gained = @(); $kept = @()
    for ($i = 0; $i -lt $news.Count; $i++) {
        $now = Get-DevNewsVal $news[$i] 'channel'
        $t = Get-DevNewsVal $news[$i] 'title'
        if ($before[$i] -eq 'dev' -and $now -ne 'dev') { $cleared += $t }
        elseif ($before[$i] -ne 'dev' -and $now -eq 'dev') { $gained += $t }
        elseif ($now -eq 'dev') { $kept += $t }
    }
    $mainRel = if ($mainDoc.PSObject.Properties['release'] -and $mainDoc.release) { $mainDoc.release } else { $null }
    return [pscustomobject]@{
        Changed        = ($cleared.Count -gt 0 -or $gained.Count -gt 0 -or $wasMain -ne $mainVer)
        Sent           = $false
        Notes          = $news.Count
        Was            = @($before | Where-Object { $_ -eq 'dev' }).Count
        Marked         = [int]$marked
        Cleared        = @($cleared)
        Gained         = @($gained)
        Kept           = @($kept)
        WasMainVersion = $wasMain
        MainVersion    = $mainVer
        MainRelease    = $(if ($mainRel) { Get-DevNewsVal $mainRel 'id' } else { '' })
        MainCommit     = $(if ($mainRel) { Get-DevNewsVal $mainRel 'commit' } else { '' })
    }
}

# Receives the dev feed into this machine's working folder for dev (the one a
# dev publish uses, Get-FeedStoreDir), reads main's feed as the site serves
# it, marks the dev feed, and sends version.json back through Send-FeedStore
# only when something moved. Nothing else is sent: no pack, no launcher, no
# baseline, no release record, no news entry.
#
#   -Received   the folder already holds the feed as received (a dev publish
#               that has just received it); nothing is fetched again.
#   -NoSend     work it out and say what would move; nothing is written or sent.
#
# Throws, with nothing sent, when the dev feed cannot be received, main's feed
# cannot be read or is not there, or the store moved since it was received.
function Update-DevFeedMarks {
    param(
        [string]$SourceRepo,
        [string]$Dir,
        [switch]$Received,
        [switch]$NoSend,
        [string]$SiteDir,
        [string]$SiteUrl = 'https://thornswood.net',
        [hashtable]$To
    )
    if (-not $Dir) { $Dir = Get-FeedStoreDir 'dev' }
    if (-not $SourceRepo) { $SourceRepo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
    if (-not $Received) {
        New-Item -ItemType Directory -Force -Path $Dir | Out-Null
        [void](Receive-FeedStore 'dev' $Dir -SiteDir $SiteDir -To $To)
    }
    $file = Join-Path $Dir 'version.json'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'The VPS has no version.json for the dev channel, so there is nothing to mark.' }
    $mainDoc = Read-SiteFeed 'main' -SiteDir $SiteDir -SiteUrl $SiteUrl
    if ($null -eq $mainDoc) { throw 'The site has no main feed, so the dev marks were left alone.' }
    $doc = (([IO.File]::ReadAllText($file)) -replace '^\uFEFF', '') | ConvertFrom-Json
    $r = Set-DevFeedMarks $doc $mainDoc $SourceRepo $SiteDir $SiteUrl
    if ($r.Changed -and -not $NoSend) {
        # The notes back the way the dev feed keeps them (#1050): in "news",
        # or once its minLauncher reads it, a news file sent to the site first.
        $min = Get-DevNewsVal $doc 'minLauncher'
        if (-not $min) { $min = Get-DevNewsVal $doc 'launcherVersion' }
        [void](Set-FeedNewsList $doc @($doc.news) 'dev' $min (Join-Path $Dir 'news-out') $SiteDir)
        # Compact, no byte order mark (Feed-Json.ps1, Write-FeedVersionFile).
        Write-FeedVersionFile $file $doc
        $sent = Send-FeedStore 'dev' $Dir @('version.json') -SiteDir $SiteDir -To $To
        $r.Sent = (@($sent.Sent).Count -gt 0)
    }
    return $r
}

# What to say about a result, one line each, for Publish-Update, Ship and
# Refresh-DevNews.ps1 alike.
function Get-DevFeedMarksLines($r, [switch]$NoSend) {
    $lines = @()
    $main = if ($r.MainVersion) { "main $($r.MainVersion)" } else { 'main' }
    if ($r.MainRelease) { $main += " (release $($r.MainRelease))" }
    $lines += ("{0} of {1} notes marked DEV against {2}, {3} before" -f $r.Marked, $r.Notes, $main, $r.Was)
    if (@($r.Cleared).Count) { $lines += ("{0} lost the mark, main has them: {1}" -f @($r.Cleared).Count, (@($r.Cleared) -join '; ')) }
    if (@($r.Gained).Count) { $lines += ("{0} gained the mark, main does not have them: {1}" -f @($r.Gained).Count, (@($r.Gained) -join '; ')) }
    if ($r.WasMainVersion -ne $r.MainVersion) { $lines += ("mainVersion {0} -> {1}" -f $(if ($r.WasMainVersion) { $r.WasMainVersion } else { '(none)' }), $r.MainVersion) }
    if (-not $r.Changed) { $lines += 'the dev feed already matched main, so nothing was sent' }
    elseif ($NoSend) { $lines += 'nothing was sent: this run sends nothing' }
    elseif ($r.Sent) { $lines += 'the dev feed''s version.json was sent, and the site serves it' }
    else { $lines += 'the dev feed on the VPS already had these marks' }
    return $lines
}
