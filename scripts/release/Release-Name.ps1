<#
  Release-Name.ps1

  One name for each release, recorded in the feed and the store, and a git tag
  on the commit it was built from (#444).

      . (Join-Path $PSScriptRoot 'Release-Name.ps1')

  WHY IT EXISTS. Measured on 28 September, a release was known by four things
  that nothing tied together: the launcher version (1.1.102.6, which since
  #921 stays the same across every Ship that does not change the launcher, so
  several releases share it), the pack id Publish-Update mints
  (20260928-2324-dev, also the name of its packs and, since #441, of its
  baseline record), the fork commit of the client runtime, and the source
  commit it was built from, which was written down nowhere at all. The only
  tags in the repository were the v<version> ones a person pushes by hand so
  CI builds a main launcher (release.yml), and a Ship that kept its launcher
  had no tag.

  So the release id is the one name. It is the only one every release has and
  no two share: a Ship that sends no pack still mints one, and a pack, its
  parts (<id>-2, <id>-3) and the baseline record all carry it already.
  Everything else is recorded against it:

    - the feed: "release" in version.json, { id, channel, launcherVersion,
      packs, baseline, commit, branch, uncommitted, tag }, written by
      Publish-Update (the release record block). No launcher reads it, and a
      launcher ignores a field it does not know.
    - the store: releases.txt beside launchers.txt on the VPS, one line per
      release, the id first (Feed-Store.ps1).
    - the repository: an annotated tag, release/main/<id> or release/dev/<id>,
      on the commit that release was built from, made and pushed by Ship only
      after the publisher has sent the feed (Add-ReleaseTag). Never v<...>, so
      it cannot start the launcher build in release.yml. In a cloud session,
      whose git cannot push a tag, GitHub makes it (Set-Ref.ps1, #3314).

      git tag -l 'release/dev/*'         every dev release
      git show release/main/<id>         what it shipped and where to find it

  Get-ReleaseDisagreements says whether a feed's names for its release agree
  with each other, and with "releases", the list Rollback-Feed.ps1 puts a
  channel back from (#442): the newest entry there is this release, by the same
  id, ending on its last pack. A rollback writes "release" for itself (#1058):
  its own id, the launcher the feed keeps, its one pack, its baseline, and no
  commit, so no tag. tests\test-release-name.ps1 drives the names;
  tests\test-feed-rollback.ps1 drives a rolled-back feed.
#>

# ==== thornswood release id ====
# A NEW RELEASE ID, NEVER ONE THE FEED ALREADY USES (#1057). It was the minute,
# yyyyMMdd-HHmm, so two publishes inside one minute both got the same name: a
# launcher that took the first wrote that id into applied.txt and skipped the
# second as already applied, and the store, "releases" and the release tag named
# two releases the same. Now it is the second, yyyyMMdd-HHmmss (-dev on dev),
# and if the feed already names that id, or a part of it (<id>-2), it moves on
# a second at a time to the next free one.
#
# Every installed launcher still updates across it: a launcher compares pack
# ids only for equality (applied.txt) and a release record by its sha256, never
# by the shape of the id. Everything that reads the time out of an id takes
# its first 13 characters, yyyyMMdd-HHmm, and both shapes start that way.
# Publish-Update and Rollback-Feed both mint through this.
function Get-FeedTakenIds($doc) {
    $t = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    if ($null -eq $doc) { return ,$t }
    foreach ($k in 'packs', 'releases', 'release', 'baseline') {
        $p = $doc.PSObject.Properties[$k]
        if ($null -eq $p -or $null -eq $p.Value) { continue }
        foreach ($o in @($p.Value)) {
            if ($null -eq $o -or $o -is [string]) { continue }
            $idp = $o.PSObject.Properties['id']
            if ($null -ne $idp -and [string]$idp.Value) { [void]$t.Add([string]$idp.Value) }
        }
    }
    return ,$t
}

# The team's clock: Mountain time, Patrick's, whatever the clock of the
# machine that ships. A release id and the date on its note are read as one
# clock, with no zone written on either (Find-DevNoteRelease in Dev-News.ps1
# puts a note in its release's span by them, and the News tab shows the date as
# it is). Until 31 Oct both took the shipping machine's own clock: One and the
# box keep Mountain time, a GitHub runner keeps UTC, so a note shipped from a
# runner read six hours late. Measured on the dev feed that day: "The collection
# link opens the server's revision" (release 20261030-115318-dev, tagged
# 11:56 UTC) said 11:54 AM and sat below "The loading screen, the Master's mend
# and the game name" (20261030-114538-dev, tagged 11:48 AM Mountain), which
# said 11:47 AM and went out six hours after it; "Food spoils, gently" said
# 6:05 PM for a Ship tagged at 12:12 PM Mountain. Mountain Standard Time is
# Windows' name for the zone and follows its summer time; America/Denver is
# the same zone's name everywhere else.
function Get-TeamNow([datetime]$UtcNow = [datetime]::UtcNow) {
    $onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
    $zone = [TimeZoneInfo]::FindSystemTimeZoneById($(if ($onWindows) { 'Mountain Standard Time' } else { 'America/Denver' }))
    return [TimeZoneInfo]::ConvertTimeFromUtc([datetime]::SpecifyKind($UtcNow, [DateTimeKind]::Utc), $zone)
}

function New-ReleaseId($doc, [switch]$Dev, [datetime]$Now = (Get-TeamNow)) {
    $taken = Get-FeedTakenIds $doc
    $suffix = if ($Dev) { '-dev' } else { '' }
    $t = $Now
    for ($i = 0; $i -lt 3600; $i++) {
        $id = $t.ToString('yyyyMMdd-HHmmss', [Globalization.CultureInfo]::InvariantCulture) + $suffix
        $clash = $taken.Contains($id)
        if (-not $clash) { foreach ($x in $taken) { if ($x.StartsWith($id + '-', [StringComparison]::OrdinalIgnoreCase)) { $clash = $true; break } } }
        if (-not $clash) { return $id }
        $t = $t.AddSeconds(1)
    }
    throw "Every release id for the hour from $($Now.ToString('HH:mm:ss')) is already on the feed, so none was made."
}
# ==== end thornswood release id ====

# The tag for a release, by its channel and id. '' when there is no id.
function Get-ReleaseTagName([string]$Channel, [string]$Id) {
    if (-not $Id) { return '' }
    $ch = if ($Channel -eq 'dev') { 'dev' } else { 'main' }
    return ('release/' + $ch + '/' + $Id)
}

# What the checkout at $RepoDir is: the commit HEAD names, its branch, and how
# many tracked files differ from it. Commit is '' when $RepoDir is not the top
# of a git checkout, so a folder inside some other repository never reports
# that repository's commit.
# One git call: its first line of output, trimmed, and its exit code. The
# whole output is read, never cut short with Select-Object -First: Windows
# PowerShell stops the process when the pipeline ends early and reports exit -1.
function Invoke-ReleaseGit([string]$RepoDir, [string[]]$GitArgs) {
    # The exit code decides, not stderr. Under Windows PowerShell 5.1 with Stop,
    # a "fatal" git writes for a ref it does not know ends the caller even
    # through 2>$null: Ship's origin/main check stopped there instead of reading
    # Code. Continue here is this function's own and goes when it returns.
    $ErrorActionPreference = 'Continue'
    $out = @(& git -C $RepoDir @GitArgs 2>$null)
    $rc = $LASTEXITCODE
    $first = if ($out.Count) { ([string]$out[0]).Trim() } else { '' }
    return [pscustomobject]@{ Code = $rc; First = $first; Lines = $out }
}

function Get-ReleaseSource([string]$RepoDir) {
    $o = [pscustomobject]@{ Commit = ''; Branch = ''; Uncommitted = 0 }
    if (-not $RepoDir -or -not (Get-Command git -ErrorAction SilentlyContinue)) { return $o }
    # Put back afterwards: Publish-Update runs off its end, so the last native
    # exit code is its own, and Ship reads it.
    $rcWas = $global:LASTEXITCODE
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        # The top of the checkout has no prefix. Asked of git rather than by
        # comparing paths, which a subst drive or a junction would fool.
        $g = Invoke-ReleaseGit $RepoDir @('rev-parse', '--is-inside-work-tree')
        if ($g.Code -ne 0 -or $g.First -ne 'true') { return $o }
        $g = Invoke-ReleaseGit $RepoDir @('rev-parse', '--show-prefix')
        if ($g.Code -ne 0 -or $g.First) { return $o }
        $g = Invoke-ReleaseGit $RepoDir @('rev-parse', 'HEAD')
        if ($g.Code -ne 0 -or $g.First -notmatch '^[0-9a-f]{40}$') { return $o }
        $o.Commit = $g.First
        $o.Branch = (Invoke-ReleaseGit $RepoDir @('rev-parse', '--abbrev-ref', 'HEAD')).First
        $o.Uncommitted = @((Invoke-ReleaseGit $RepoDir @('status', '--porcelain', '--untracked-files=no')).Lines | Where-Object { $_ }).Count
        $o.Uncommitted += @((Invoke-ReleaseGit $RepoDir @('ls-files', '--others', '--exclude-standard', '--',
            'scripts', 'records', 'site', 'game', 'launcher', 'installer')).Lines | Where-Object { $_ }).Count
    } finally { $ErrorActionPreference = $old; $global:LASTEXITCODE = $rcWas }
    return $o
}

# The "release" object Publish-Update writes into version.json. The tag is
# named only when there is a commit for it to go on.
#
# It names the release and nothing it installs. Until #1050 it also carried
# "uiAssets", the front's hashed file names (#1318): 2,569 of main's 7,789
# bytes on 12 Oct, read by no launcher, script or page, only by a harness.
# Those names are Data\Platform\UI\thornswood-ui-assets.txt, a file of the
# release, so its record already holds them by sha256, and that file is what
# OwnGame.Foreign reads.
function New-ReleaseRecord([string]$Id, [string]$Channel, [string]$LauncherVersion, [string[]]$Packs,
                           [string]$Baseline, [string]$Commit, [string]$Branch, [int]$Uncommitted) {
    $ch = if ($Channel -eq 'dev') { 'dev' } else { 'main' }
    $tag = if ($Commit) { Get-ReleaseTagName $ch $Id } else { '' }
    return [pscustomobject][ordered]@{
        id              = $Id
        channel         = $ch
        launcherVersion = [string]$LauncherVersion
        packs           = @(@($Packs) | Where-Object { $_ } | ForEach-Object { [string]$_ })
        baseline        = [string]$Baseline
        commit          = [string]$Commit
        branch          = [string]$Branch
        uncommitted     = $Uncommitted
        tag             = $tag
    }
}

function Get-ReleaseField($o, [string]$k) {
    if ($null -ne $o -and $o.PSObject.Properties[$k] -and $null -ne $o.$k) { return ([string]$o.$k).Trim() }
    return ''
}

# The feed's "release" object, or $null when it has none.
function Get-ReleaseRecord($doc) {
    if ($null -eq $doc -or -not $doc.PSObject.Properties['release'] -or $null -eq $doc.release) { return $null }
    return $doc.release
}

# Every way the feed's names for its release disagree with each other, one
# sentence each. None means the release id, its packs, its baseline record,
# the launcher it offers and its tag all name the same release. $Releases is
# the channel's list of releases as the store keeps it since #1050
# (releases.json, Read-ReleaseListFile); left out, the "releases" the feed
# still carries, if any.
function Get-ReleaseDisagreements($doc, $Releases = $null) {
    $bad = @()
    $r = Get-ReleaseRecord $doc
    if ($null -eq $r) { return @('the feed names no release') }
    $id = Get-ReleaseField $r 'id'
    if (-not $id) { return @('the feed''s release has no id') }
    $ch = Get-ReleaseField $r 'channel'
    if ($ch -ne 'main' -and $ch -ne 'dev') { $bad += "release $id names the channel '$ch', not main or dev" }
    $lv = Get-ReleaseField $r 'launcherVersion'
    $feedLv = Get-ReleaseField $doc 'launcherVersion'
    if ($lv -ne $feedLv) { $bad += "release $id names launcher '$lv' and the feed offers '$feedLv'" }
    $onFeed = @{}
    if ($doc.PSObject.Properties['packs'] -and $doc.packs) {
        foreach ($p in @($doc.packs)) { $pid0 = Get-ReleaseField $p 'id'; if ($pid0) { $onFeed[$pid0] = $true } }
    }
    $packs = @()
    if ($r.PSObject.Properties['packs'] -and $null -ne $r.packs) { $packs = @($r.packs | ForEach-Object { [string]$_ }) }
    foreach ($p in $packs) {
        if ($p -ne $id -and $p -notmatch ('^' + [regex]::Escape($id) + '-\d+$')) { $bad += "release $id names pack $p, which is not one of its own" }
        if (-not $onFeed.ContainsKey($p)) { $bad += "release $id names pack $p, which is not on the feed" }
    }
    $base = Get-ReleaseField $r 'baseline'
    $feedBase = ''
    if ($doc.PSObject.Properties['baseline'] -and $null -ne $doc.baseline) { $feedBase = Get-ReleaseField $doc.baseline 'id' }
    if ($base -and $base -ne $id) { $bad += "release $id names baseline $base, which is another release's" }
    if ($base -ne $feedBase) {
        $said = if ($feedBase) { $feedBase } else { 'none' }
        $bad += "release $id names baseline '$base' and the feed's baseline is $said"
    }
    # The feed's list of releases a channel can be put back to (#442) names
    # this one first, by the same id, ending on its last pack, once it has
    # sent its record. A -NoUpload run sends none and adds nothing to it.
    $rels = @()
    if ($null -ne $Releases) { $rels = @($Releases | Where-Object { $null -ne $_ }) }
    elseif ($doc.PSObject.Properties['releases'] -and $null -ne $doc.releases) { $rels = @($doc.releases | Where-Object { $null -ne $_ }) }
    if ($base -and $rels.Count) {
        $top = $rels[0]
        $topId = Get-ReleaseField $top 'id'
        if ($topId -ne $id) { $bad += "release $id is not the newest in the feed's releases, which starts with $topId" }
        elseif ($packs.Count -and (Get-ReleaseField $top 'lastPack') -ne $packs[$packs.Count - 1]) {
            $bad += ("release $id ends on pack " + $packs[$packs.Count - 1] + " and its entry in releases on '" + (Get-ReleaseField $top 'lastPack') + "'")
        }
    }
    $commit = Get-ReleaseField $r 'commit'
    $tag = Get-ReleaseField $r 'tag'
    if ($commit -and $commit -notmatch '^[0-9a-f]{40}$') { $bad += "release $id names commit '$commit', which is not a full commit id" }
    $want = if ($commit) { Get-ReleaseTagName $ch $id } else { '' }
    if ($tag -ne $want) { $bad += "release $id names tag '$tag' and its tag is '$want'" }
    return $bad
}

# The list of releases the store keeps beside a feed (releases.json, #1050),
# newest first, or $null when there is no such file. Throws on a file that is
# not JSON, rather than reading it as no list.
function Read-ReleaseListFile([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $text = ([IO.File]::ReadAllText($Path)).TrimStart([char]0xFEFF)
    if (-not $text.Trim()) { return ,@() }
    $o = $text | ConvertFrom-Json
    return ,@($o | Where-Object { $null -ne $_ })
}

# The sha256 of every file the feed in $Doc names for this release, labelled
# as the tag message carries them (#3686): the record, whose own entries name
# the rest of the release's files, the launcher, the client runtime, the
# notes, and the signed manifest with its catalog. release-files.yml reads
# these off the tag to put the release's files on its GitHub Release, so it
# never has to find them in a feed that a later Ship has moved on. A field
# the feed does not have, or that is not a sha256, is left out.
function Get-ReleaseFileShas($Doc) {
    $out = [ordered]@{}
    if ($null -eq $Doc) { return $out }
    $field = { param($o, [string]$n) if ($null -ne $o -and $o.PSObject.Properties[$n]) { ([string]$o.$n).ToLowerInvariant() } else { '' } }
    $pick = [ordered]@{
        record   = (& $field $(if ($Doc.PSObject.Properties['baseline']) { $Doc.baseline }) 'sha256')
        exe      = (& $field $Doc 'launcherSha256')
        runtime  = (& $field $(if ($Doc.PSObject.Properties['clientRuntime']) { $Doc.clientRuntime }) 'sha256')
        news     = (& $field $(if ($Doc.PSObject.Properties['newsFile']) { $Doc.newsFile }) 'sha256')
        manifest = (& $field $(if ($Doc.PSObject.Properties['signedManifest']) { $Doc.signedManifest }) 'sha256')
        catalog  = (& $field $(if ($Doc.PSObject.Properties['signedManifest']) { $Doc.signedManifest }) 'catalogSha256')
    }
    foreach ($k in $pick.Keys) { if ($pick[$k] -match '^[0-9a-f]{64}$') { $out[$k] = $pick[$k] } }
    return $out
}

# The annotated tag's message: the release, then everything it is known by,
# then the sha256 of each file it names when the feed ($Doc) is given.
function Get-ReleaseTagMessage($r, [string]$FeedUrl, $Doc = $null) {
    $lines = @()
    $lines += ('Thornswood ' + (Get-ReleaseField $r 'channel') + ' release ' + (Get-ReleaseField $r 'id'))
    $lines += ''
    $lv = Get-ReleaseField $r 'launcherVersion'
    if ($lv) { $lines += ('launcher  ' + $lv) }
    $packs = @(); if ($r.PSObject.Properties['packs'] -and $null -ne $r.packs) { $packs = @($r.packs | ForEach-Object { [string]$_ }) }
    $lines += ('packs     ' + $(if ($packs.Count) { $packs -join ', ' } else { 'none' }))
    $b = Get-ReleaseField $r 'baseline'
    $lines += ('baseline  ' + $(if ($b) { $b } else { 'none' }))
    $br = Get-ReleaseField $r 'branch'
    if ($br) { $lines += ('branch    ' + $br) }
    $u = 0; [void][int]::TryParse((Get-ReleaseField $r 'uncommitted'), [ref]$u)
    if ($u -gt 0) { $lines += ('built with ' + $u + ' uncommitted change(s) on top of this commit') }
    if ($FeedUrl) { $lines += ('feed      ' + $FeedUrl) }
    $shas = Get-ReleaseFileShas $Doc
    foreach ($k in $shas.Keys) { $lines += ($k.PadRight(10) + $shas[$k]) }
    return ($lines -join "`n")
}

# Tags the commit the release in $VersionFile was built from and pushes the
# tag, or in a cloud session has GitHub make it (Set-Ref.ps1). Ship calls it only after the publisher has sent the feed, and passes the
# id the publisher said it sent ($PublishedId); anything else tags nothing.
# Returns { Tag, Commit, Why, PutRight }: Why is '' when the tag is on the
# remote, and PutRight is what a person runs to finish it, '' when there is
# nothing to run.
function Add-ReleaseTag([string]$RepoDir, [string]$VersionFile, [string]$PublishedId, [string]$Remote = 'origin', [string]$FeedUrl) {
    $o = [pscustomobject]@{ Tag = ''; Commit = ''; Why = ''; PutRight = '' }
    if (-not $PublishedId) { $o.Why = 'the publisher did not say it sent a release, so nothing is tagged'; return $o }
    $doc = $null
    try { $doc = (([IO.File]::ReadAllText($VersionFile)) -replace '^\uFEFF', '') | ConvertFrom-Json }
    catch { $o.Why = "could not read $VersionFile, so nothing is tagged: $($_.Exception.Message)"; return $o }
    $r = Get-ReleaseRecord $doc
    $id = Get-ReleaseField $r 'id'
    if ($id -ne $PublishedId) {
        $o.Why = "the publisher sent release $PublishedId and the feed here names release '$id', so nothing is tagged"
        return $o
    }
    $list = $null
    try { $list = Read-ReleaseListFile (Join-Path (Split-Path -Parent $VersionFile) 'releases.json') }
    catch { $o.Why = "could not read the releases list beside $VersionFile, so nothing is tagged: $($_.Exception.Message)"; return $o }
    $bad = @(Get-ReleaseDisagreements $doc $list)
    if ($bad.Count) { $o.Why = ('the feed''s names for release ' + $id + ' disagree, so nothing is tagged: ' + ($bad -join '; ')); return $o }
    $o.Commit = Get-ReleaseField $r 'commit'
    $o.Tag = Get-ReleaseField $r 'tag'
    if (-not $o.Commit) { $o.Why = "release $id was not built from a git checkout, so there is no commit to tag"; return $o }
    $msgFile = [IO.Path]::GetTempFileName()
    # Put back afterwards: Ship runs off its end, so the last native exit code
    # is Ship's own, and a refused push must not turn a release into a failure.
    $rcWas = $global:LASTEXITCODE
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        [IO.File]::WriteAllText($msgFile, (Get-ReleaseTagMessage $r $FeedUrl $doc) + "`n", (New-Object Text.UTF8Encoding($false)))
        $push = "git push $Remote refs/tags/$($o.Tag)"
        $make = "git tag -a $($o.Tag) $($o.Commit) -m ""Thornswood $(Get-ReleaseField $r 'channel') release $id"""
        $g = Invoke-ReleaseGit $RepoDir @('rev-parse', '--verify', '--quiet', ($o.Commit + '^{commit}'))
        if ($g.Code -ne 0) {
            $o.Why = "commit $($o.Commit) is not in this checkout, so $($o.Tag) was not made"
            $o.PutRight = "git fetch $Remote; $make; $push"
            return $o
        }
        $has = (Invoke-ReleaseGit $RepoDir @('rev-parse', '--verify', '--quiet', ('refs/tags/' + $o.Tag + '^{commit}'))).First
        if ($has -and $has -ne $o.Commit) {
            $o.Why = "$($o.Tag) already names commit $has, not $($o.Commit); it was left alone"
            return $o
        }
        # A cloud session's git cannot write refs: the cloud environment's
        # proxy refuses a tag push (#3314, measured 22 Oct 2026). There GitHub
        # makes the tag, from the same message, in git-ref.yml (Set-Ref.ps1),
        # and nothing is tagged in the session's own checkout, so the tag on
        # GitHub is the only one.
        if ($env:CLAUDE_CODE_REMOTE -eq 'true') {
            $setRef = Join-Path $RepoDir 'scripts/ops/Set-Ref.ps1'
            $again = "pwsh scripts/ops/Set-Ref.ps1 -Tag $($o.Tag) -Commit $($o.Commit) -Message ""Thornswood $(Get-ReleaseField $r 'channel') release $id"""
            if (-not (Test-Path -LiteralPath $setRef -PathType Leaf)) {
                $o.Why = "this checkout has no scripts/ops/Set-Ref.ps1, which a cloud session needs to put $($o.Tag) on GitHub"
                $o.PutRight = $again
                return $o
            }
            & $setRef -Tag $o.Tag -Commit $o.Commit -MessageFile $msgFile
            $rc = $LASTEXITCODE
            if ($rc -eq 2) { $o.Why = "GitHub was asked to make $($o.Tag) and its run had not ended; it still makes the tag, and the line above reads its answer"; return $o }
            if ($rc -ne 0) {
                $o.Why = "GitHub did not put $($o.Tag) on (Set-Ref.ps1 exit $rc); the lines above say why"
                $o.PutRight = $again
            }
            return $o
        }
        if (-not $has) {
            $said = @(& git -C $RepoDir tag -a $o.Tag $o.Commit -F $msgFile 2>&1 | ForEach-Object { [string]$_ })
            if ($LASTEXITCODE -ne 0) {
                $o.Why = "git tag stopped (exit $LASTEXITCODE): " + (($said | Select-Object -Last 2) -join ' ').Trim()
                $o.PutRight = "$make; $push"
                return $o
            }
        }
        $said = @(& git -C $RepoDir push $Remote ('refs/tags/' + $o.Tag) 2>&1 | ForEach-Object { [string]$_ })
        if ($LASTEXITCODE -ne 0) {
            $o.Why = "the tag is made here but did not reach $Remote (exit $LASTEXITCODE): " + (($said | Select-Object -Last 2) -join ' ').Trim()
            $o.PutRight = $push
            return $o
        }
    } finally {
        $ErrorActionPreference = $old
        $global:LASTEXITCODE = $rcWas
        Remove-Item -LiteralPath $msgFile -Force -ErrorAction SilentlyContinue
    }
    return $o
}

