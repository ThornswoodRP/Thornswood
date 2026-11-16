<#
  test-2401-legacy-dev-marks.ps1

      pwsh -NoProfile -File .\scripts\tests\test-2401-legacy-dev-marks.ps1

  The dev News tab marks a note from before sourceCommit by the dev release it
  came with, not by the dev feed's newest release (#2401).

  WHAT HAPPENED. Patrick, 12 Oct: "dev News tab still says 20 notes are labled
  dev which isnt right it should only be 4". Read that morning from the site:
  main's release 20261011-175014 (7cece557, clean); the dev feed's release
  20261012-080945-dev (13f88fcc), 40 notes, 20 marked DEV. The 4 newest
  (tonight's dev Ships) were rightly DEV. The other 16 were the notes of 1 to
  3 Oct, written before Publish-Update recorded a sourceCommit, all shipped on
  main 1.1.105 on 3 Oct. Update-DevNewsChannels gave every such note the
  proof of the dev feed's current release, which is ahead of main between main
  releases, so all 16 read as DEV.

  WHAT THIS DRIVES, offline: the real 40 notes of the dev feed of 12 Oct (date,
  title, whether it has a sourceCommit, its mark) and the real 44 dev release
  tags of 1 to 12 Oct (id, the tagger's time and zone, whether the release was
  built with uncommitted files, and the two of 2 Oct 2:35 and 2:36 PM built
  from one commit), in a scratch git repository with one commit a release on
  one line, main's release at the commit of 20261011-174543-dev, as 7cece557
  was. Update-DevNewsChannels must leave DEV on the 4 newest and take it off
  the 1 to 3 Oct notes. One of those, "Merchant purses and dungeon rewards",
  came with 20261002-015344-dev, built with 1 uncommitted change: no commit
  proves it, and it clears because the next clean release,
  20261002-143545-dev, holds its commit and is on main (Patrick's answer on
  #2401, 12 Oct: option B). Until that is so, it keeps the mark it has.

  Also driven: a note whose sourceCommit names a commit the clone does not
  hold (the notes from before the #3684 history rewrite, #5133) is judged by
  its release's tag; a note whose sourceCommit is empty, as Publish-Update writes it
  for a release built with uncommitted files, is judged the same way and not
  as a commit main lacks; and a later clean release that does not hold the
  dirty release's commit settles nothing. And a note with no proof of its own
  is settled by the first note above it whose clean commit main has (31 Oct:
  two 22 Oct loading screen notes stayed DEV for good), but not by one whose
  release was built with uncommitted files, nor in a clone with no tags.

  Everything it writes is under its own temp folder, which it removes.
#>
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'scripts\release\Dev-News.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# The dev release tags of 1 to 12 Oct as they are on GitHub: id, when Ship
# tagged it on the shipping machine's clock, built with uncommitted files,
# built from the same commit as the one before it.
$tags = @(
    ,@('20261001-170723-dev', '2026-10-01T17:08:14-06:00', $false, $false)
    ,@('20261001-185615-dev', '2026-10-01T18:57:06-06:00', $false, $false)
    ,@('20261001-195002-dev', '2026-10-01T19:50:53-06:00', $false, $false)
    ,@('20261001-200344-dev', '2026-10-01T20:04:26-06:00', $false, $false)
    ,@('20261001-204154-dev', '2026-10-01T20:42:49-06:00', $false, $false)
    ,@('20261001-215555-dev', '2026-10-01T21:56:40-06:00', $false, $false)
    ,@('20261001-220727-dev', '2026-10-01T22:08:07-06:00', $false, $false)
    ,@('20261001-223010-dev', '2026-10-01T22:30:49-06:00', $false, $false)
    ,@('20261001-224424-dev', '2026-10-01T22:45:08-06:00', $false, $false)
    ,@('20261001-231219-dev', '2026-10-01T23:13:03-06:00', $false, $false)
    ,@('20261001-232427-dev', '2026-10-01T23:25:08-06:00', $false, $false)
    ,@('20261001-234201-dev', '2026-10-01T23:42:43-06:00', $false, $false)
    ,@('20261001-235244-dev', '2026-10-01T23:53:30-06:00', $false, $false)
    ,@('20261002-001423-dev', '2026-10-02T00:15:07-06:00', $false, $false)
    ,@('20261002-003521-dev', '2026-10-02T00:36:06-06:00', $false, $false)
    ,@('20261002-010717-dev', '2026-10-02T01:07:57-06:00', $false, $false)
    ,@('20261002-015344-dev', '2026-10-02T01:54:30-06:00', $true, $false)
    ,@('20261002-143545-dev', '2026-10-02T14:37:15-06:00', $false, $false)
    ,@('20261002-143641-dev', '2026-10-02T14:37:57-06:00', $false, $true)
    ,@('20261003-131311-dev', '2026-10-03T13:14:13-06:00', $false, $false)
    ,@('20261003-143423-dev', '2026-10-03T14:35:17-06:00', $false, $false)
    ,@('20261003-173559-dev', '2026-10-03T17:37:01-06:00', $false, $false)
    ,@('20261003-180655-dev', '2026-10-03T18:07:41-06:00', $false, $false)
    ,@('20261003-185740-dev', '2026-10-03T18:58:35-06:00', $true, $false)
    ,@('20261003-192349-dev', '2026-10-03T19:24:55-06:00', $true, $false)
    ,@('20261003-224149-dev', '2026-10-03T22:43:10-06:00', $false, $false)
    ,@('20261003-231349-dev', '2026-10-03T23:14:55-06:00', $false, $false)
    ,@('20261004-001131-dev', '2026-10-04T00:13:21-06:00', $true, $false)
    ,@('20261004-124437-dev', '2026-10-04T12:45:39-06:00', $false, $false)
    ,@('20261004-184346-dev', '2026-10-04T18:44:39-06:00', $false, $false)
    ,@('20261004-225259-dev', '2026-10-04T22:54:04-06:00', $false, $false)
    ,@('20261004-235750-dev', '2026-10-04T23:58:48-06:00', $false, $false)
    ,@('20261005-130756-dev', '2026-10-05T13:08:54-06:00', $false, $false)
    ,@('20261005-140602-dev', '2026-10-05T14:06:37-04:00', $false, $false)
    ,@('20261005-152448-dev', '2026-10-05T15:25:27-04:00', $false, $false)
    ,@('20261005-225302-dev', '2026-10-05T22:54:05-06:00', $false, $false)
    ,@('20261006-141047-dev', '2026-10-06T14:11:23-04:00', $true, $false)
    ,@('20261008-160255-dev', '2026-10-08T16:03:30-04:00', $false, $false)
    ,@('20261011-145512-dev', '2026-10-11T14:56:41-06:00', $false, $false)
    ,@('20261011-174543-dev', '2026-10-11T17:47:25-06:00', $false, $false)
    ,@('20261011-221215-dev', '2026-10-11T22:13:56-06:00', $false, $false)
    ,@('20261012-004958-dev', '2026-10-12T00:53:48-06:00', $false, $false)
    ,@('20261012-021714-dev', '2026-10-12T02:21:35-06:00', $false, $false)
    ,@('20261012-080945-dev', '2026-10-12T08:11:19-06:00', $false, $false)
)
# The dev feed's 40 notes as the site served them on 12 Oct: date, title,
# whether it carries a sourceCommit, its mark, and the release it came with
# (measured; the code under test is never told it).
$notes = @(
    ,@('10-12-2026 8:10 AM', 'No bounty for a killing in town, and crashes reach staff', $true, 'dev', '20261012-080945-dev')
    ,@('10-12-2026 2:20 AM', 'The look panel steps aside, and a quicker game folder', $true, 'dev', '20261012-021714-dev')
    ,@('10-12-2026 12:52 AM', 'Notice boards are back, and house parts leave the forge', $true, 'dev', '20261012-004958-dev')
    ,@('10-11-2026 10:13 PM', 'Keys, deeds and forges', $true, 'dev', '20261011-221215-dev')
    ,@('10-11-2026 5:46 PM', 'The launcher gets ready in seconds', $true, '', '20261011-174543-dev')
    ,@('10-11-2026 2:56 PM', 'Worn gear updates at once and keys stop repeating after panels', $true, '', '20261011-145512-dev')
    ,@('10-8-2026 4:03 PM', 'The game notes what is in your hands when you draw', $true, '', '20261008-160255-dev')
    ,@('10-6-2026 2:11 PM', 'Number keys are your favourites hotkeys again', $true, '', '20261006-141047-dev')
    ,@('10-5-2026 10:53 PM', 'Add-on hair and beards, steadier voice, and panels that close with their own key', $true, '', '20261005-225302-dev')
    ,@('10-5-2026 3:25 PM', 'The emote wheel closes after two minutes', $true, '', '20261005-152448-dev')
    ,@('10-5-2026 1:08 PM', 'Dev and main match again', $true, '', '20261005-130756-dev')
    ,@('10-5-2026 2:06 PM', 'Clearer small crest icons in the launcher and on the site', $true, '', '20261005-140602-dev')
    ,@('10-4-2026 11:58 PM', 'Supplies wait for your character', $true, '', '20261004-235750-dev')
    ,@('10-4-2026 10:53 PM', 'Merchants keep what they buy', $true, '', '20261004-225259-dev')
    ,@('10-4-2026 6:44 PM', 'Riekling and Goblin clothes stay on at doors', $true, '', '20261004-184346-dev')
    ,@('10-4-2026 12:45 PM', 'Starting clothes arrive with your character', $true, '', '20261004-124437-dev')
    ,@('10-4-2026 12:12 AM', 'Creation can finish dressing and open', $true, '', '20261004-001131-dev')
    ,@('10-3-2026 11:14 PM', 'Starting clothes fixes stay installed', $true, '', '20261003-231349-dev')
    ,@('10-3-2026 10:42 PM', 'Starting clothes and drawn gear corrections', $true, '', '20261003-224149-dev')
    ,@('10-3-2026 7:24 PM', 'Starting clothes finish loading before creation', $true, '', '20261003-192349-dev')
    ,@('10-3-2026 6:58 PM', 'Covered bodies restored', $true, '', '20261003-185740-dev')
    ,@('10-3-2026 6:07 PM', 'The start scroll responds again', $true, '', '20261003-180655-dev')
    ,@('10-3-2026 5:36 PM', 'Starting clothes and emotes behave correctly', $true, '', '20261003-173559-dev')
    ,@('10-3-2026 2:34 PM', 'Both builds now match', $true, '', '20261003-143423-dev')
    ,@('10-3-2026 1:13 PM', 'The new collection is ready', $false, 'dev', '20261003-131311-dev')
    ,@('10-2-2026 2:37 PM', 'Safer updates and a quieter journal key', $false, 'dev', '20261002-143641-dev')
    ,@('10-2-2026 1:54 AM', 'Merchant purses and dungeon rewards', $false, 'dev', '20261002-015344-dev')
    ,@('10-2-2026 1:07 AM', 'Dungeon chests pay by the place''s tier', $false, 'dev', '20261002-010717-dev')
    ,@('10-2-2026 12:35 AM', 'Dev build: reliable book prices and submissions', $false, 'dev', '20261002-003521-dev')
    ,@('10-2-2026 12:14 AM', 'A message board stands in each town', $false, 'dev', '20261002-001423-dev')
    ,@('10-1-2026 11:53 PM', 'The notice board opens when you click it', $false, 'dev', '20261001-235244-dev')
    ,@('10-1-2026 11:42 PM', 'Dev launchers stay on the Dev feed', $false, 'dev', '20261001-234201-dev')
    ,@('10-1-2026 11:24 PM', 'The drop box is the notice board', $false, 'dev', '20261001-232427-dev')
    ,@('10-1-2026 11:12 PM', 'A price list can be left at the hold box', $false, 'dev', '20261001-231219-dev')
    ,@('10-1-2026 10:44 PM', 'Stand up works with the wheel open', $false, 'dev', '20261001-224424-dev')
    ,@('10-1-2026 10:30 PM', 'A lute stays put until you choose it', $false, 'dev', '20261001-223010-dev')
    ,@('10-1-2026 10:07 PM', 'The emote wheel stays in the middle', $false, 'dev', '20261001-220727-dev')
    ,@('10-1-2026 9:56 PM', 'A group book is on J for a business or a faction', $false, 'dev', '20261001-215555-dev')
    ,@('10-1-2026 8:42 PM', 'NPC populations and shared supplies', $false, 'dev', '20261001-204154-dev')
    ,@('10-1-2026 8:04 PM', 'A lost server now returns you to the main menu', $false, 'dev', '20261001-200344-dev')
)
$newest4 = @($notes[0..3] | ForEach-Object { $_[1] })
$legacy = @($notes | Where-Object { -not $_[2] })
$dirtyOne = 'Merchant purses and dungeon rewards'

$Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-2401-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$git = Join-Path $Scratch 'clone'
New-Item -ItemType Directory -Force -Path $git | Out-Null
$saved = @{}
foreach ($k in 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_DATE') { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
$env:GIT_COMMITTER_NAME = 'Thornswood test'; $env:GIT_COMMITTER_EMAIL = 'test@thornswood.invalid'
$env:GIT_AUTHOR_NAME = 'Thornswood test'; $env:GIT_AUTHOR_EMAIL = 'test@thornswood.invalid'
function G { $o = @(& git -C $git -c commit.gpgsign=false -c tag.gpgsign=false -c maintenance.auto=false @args 2>&1 | ForEach-Object { [string]$_ }); if ($LASTEXITCODE) { throw ("git " + ($args -join ' ') + ": " + ($o -join ' ')) }; return ,$o }
try {
    [void](G init -q -b main)
    # One commit a release, each with a change of its own (an empty commit has
    # nothing main could be missing), tagged the way Ship tags it: an
    # annotated tag whose tagger time is when Ship tagged it. Written in one
    # git fast-import, not an add, a commit, a rev-parse and a tag for each
    # of the 44 (#3835: those were about 350 processes on the box, two for
    # every git behind Git's cmd\git.exe, and each start a Defender scan).
    $who = 'Thornswood test <test@thornswood.invalid>'
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $fi = New-Object Text.StringBuilder
    function Add-Data([string]$text) { [void]$fi.Append('data ' + [Text.Encoding]::UTF8.GetByteCount($text) + "`n" + $text + "`n") }
    [void]$fi.Append("commit refs/heads/main`nmark :1`ncommitter $who $now +0000`n"); Add-Data 'base'
    $markOf = @{}
    $mark = 1
    foreach ($t in $tags) {
        if (-not $t[3]) {
            $mark++
            [void]$fi.Append("commit refs/heads/main`nmark :$mark`ncommitter $who $now +0000`n"); Add-Data ('work for ' + $t[0])
            [void]$fi.Append("M 100644 inline release.txt`n"); Add-Data $t[0]
        }
        $markOf[$t[0]] = $mark
        $msg = "Thornswood dev release $($t[0])`n`nlauncher  1.2.3.2`npacks     $($t[0])`nbaseline  $($t[0])`nbranch    HEAD"
        if ($t[2]) { $msg += "`nbuilt with 1 uncommitted change(s) on top of this commit" }
        $when = [DateTimeOffset]::Parse($t[1], [Globalization.CultureInfo]::InvariantCulture)
        $zone = '{0}{1:00}{2:00}' -f $(if ($when.Offset -lt [TimeSpan]::Zero) { '-' } else { '+' }), [Math]::Abs($when.Offset.Hours), [Math]::Abs($when.Offset.Minutes)
        [void]$fi.Append("tag release/dev/$($t[0])`nfrom :$mark`ntagger $who $($when.ToUnixTimeSeconds()) $zone`n"); Add-Data ($msg + "`n")
    }
    $marks = Join-Path $Scratch 'marks.txt'
    # Straight to its standard input as bytes: PowerShell's pipe to a native
    # command and Start-Process -RedirectStandardInput both rewrite the end of
    # the text, and fast-import counts every byte of each data block.
    $psi = New-Object Diagnostics.ProcessStartInfo 'git'
    $psi.Arguments = '-C "' + $git + '" fast-import --quiet "--export-marks=' + $marks + '"'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardError = $true
    $fip = [Diagnostics.Process]::Start($psi)
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($fi.ToString())
    $fip.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $fip.StandardInput.Close()
    $fiErr = $fip.StandardError.ReadToEnd()
    $fip.WaitForExit()
    if ($fip.ExitCode) { throw ('git fast-import: ' + $fiErr) }
    $shaOf = @{}
    foreach ($l in [IO.File]::ReadAllLines($marks)) { if ($l -match '^:(\d+) ([0-9a-f]{40})$') { $shaOf[[int]$Matches[1]] = $Matches[2] } }
    $commitOf = @{}
    foreach ($id in $markOf.Keys) { $commitOf[$id] = $shaOf[$markOf[$id]] }
    [void](G reset -q --hard)
    $mainCommit = $commitOf['20261011-174543-dev']
    $made = G tag -l 'release/dev/*'
    Yes ("the stand-in clone has 44 tagged dev releases on one line ({0})" -f $made.Count) ($made.Count -eq 44)

    function Feed {
        $news = @(foreach ($n in $notes) {
            $o = [ordered]@{ date = $n[0]; title = $n[1]; body = ''; details = @('a line'); channel = $n[3] }
            if ($n[2]) { $o['sourceCommit'] = $commitOf[$n[4]] }
            [pscustomobject]$o
        })
        return [pscustomobject][ordered]@{
            launcherVersion = '1.2.3.2'; news = $news; mainVersion = '1.2.3'
            release = [pscustomobject][ordered]@{ id = '20261012-080945-dev'; channel = 'dev'; commit = $commitOf['20261012-080945-dev']; uncommitted = 0; tag = 'release/dev/20261012-080945-dev' }
        }
    }
    $mainFeed = [pscustomobject][ordered]@{ launcherVersion = '1.2.3'; news = @()
        release = [pscustomobject][ordered]@{ id = '20261011-175014'; channel = 'main'; commit = $mainCommit; uncommitted = 0 } }

    $dev = Feed
    Yes ("the stale dev feed has 20 of its 40 notes marked DEV, 16 of them from before sourceCommit ({0})" -f @($dev.news | Where-Object { $_.channel -eq 'dev' }).Count) (
        @($dev.news | Where-Object { $_.channel -eq 'dev' }).Count -eq 20 -and $legacy.Count -eq 16)
    $r = Set-DevFeedMarks $dev $mainFeed $git
    $still = @($dev.news | Where-Object { $_.channel -eq 'dev' } | ForEach-Object { $_.title })
    Yes ("4 of 40 stay marked DEV ({0})" -f $r.Marked) ($r.Marked -eq 4)
    Yes '  the 4 newest, which main does not have' (@($newest4 | Where-Object { $still -contains $_ }).Count -eq 4)
    Yes ("all 16 notes from 1 to 3 Oct lose the mark ({0} cleared)" -f @($r.Cleared).Count) (
        @($r.Cleared).Count -eq 16 -and @($legacy | Where-Object { @($r.Cleared) -notcontains $_[1] }).Count -eq 0)
    Yes ("  among them the one whose release was built with an uncommitted change, settled by the next clean release ({0})" -f $dirtyOne) (@($r.Cleared) -contains $dirtyOne)
    Yes '  and the one in two releases a minute apart from one commit' (@($r.Cleared) -contains 'Safer updates and a quieter journal key')
    Yes '  none gains it, and every note with a sourceCommit is left as it was' (@($r.Gained).Count -eq 0 -and
        @($dev.news | Where-Object { $_.PSObject.Properties['sourceCommit'] -and $newest4 -notcontains $_.title -and $_.channel -eq 'dev' }).Count -eq 0)
    Yes ("  and mainVersion is main's ({0})" -f $dev.mainVersion) ($dev.mainVersion -eq '1.2.3')

    $again = Set-DevFeedMarks $dev $mainFeed $git
    Yes 'a second pass moves nothing' (-not $again.Changed -and $again.Marked -eq 4)

    # The dirty one with no mark gains none: it is settled, so it reads as main.
    $dev2 = Feed
    foreach ($n in @($dev2.news)) { if ($n.title -eq $dirtyOne) { $n.channel = '' } }
    $r2 = Set-DevFeedMarks $dev2 $mainFeed $git
    Yes ("with no mark to keep, it gains none ({0} marked)" -f $r2.Marked) ($r2.Marked -eq 4 -and @($r2.Gained).Count -eq 0)

    # Main one release back (20261008-160255-dev's commit): the 3 Oct notes
    # are still on main, and the newer work is not.
    $older = [pscustomobject][ordered]@{ launcherVersion = '1.2.0'; news = @()
        release = [pscustomobject][ordered]@{ id = '20261008-170000'; channel = 'main'; commit = $commitOf['20261008-160255-dev']; uncommitted = 0 } }
    $dev3 = Feed
    $r3 = Set-DevFeedMarks $dev3 $older $git
    Yes ("against an older main the old notes still clear and the 11 Oct ones gain DEV ({0} marked: {1})" -f $r3.Marked, (@($r3.Gained) -join '; ')) (
        $r3.Marked -eq 6 -and @($r3.Gained).Count -eq 2 -and @($r3.Gained) -contains 'The launcher gets ready in seconds' -and @($r3.Cleared).Count -eq 16)

    # Main at the dirty release's own commit: its commit is on main, but no
    # clean release after it is, so nothing says what the uncommitted change
    # carried, and the note keeps its mark.
    $atDirty = [pscustomobject][ordered]@{ launcherVersion = '1.1.104'; news = @()
        release = [pscustomobject][ordered]@{ id = '20261002-020000'; channel = 'main'; commit = $commitOf['20261002-015344-dev']; uncommitted = 0 } }
    $dev5 = Feed
    [void](Set-DevFeedMarks $dev5 $atDirty $git)
    $five = @($dev5.news | Where-Object { $_.title -eq $dirtyOne })[0]
    Yes ("with main at the dirty release's own commit and no clean release after it on main, it keeps DEV ({0})" -f $five.channel) ($five.channel -eq 'dev')
    $dev5b = Feed
    foreach ($n in @($dev5b.news)) { if ($n.title -eq $dirtyOne) { $n.channel = '' } }
    [void](Set-DevFeedMarks $dev5b $atDirty $git)
    Yes '  and with no mark, it gains none' (@($dev5b.news | Where-Object { $_.title -eq $dirtyOne })[0].channel -eq '')

    # A note whose sourceCommit is empty, the way Publish-Update writes it for
    # a release built with uncommitted files. "Covered bodies restored" came
    # with 20261003-185740-dev (1 uncommitted); the next clean release is
    # 20261003-224149-dev. Until 18 Oct the empty field read as a commit main
    # did not have, so the note was marked DEV for good.
    $covered = 'Covered bodies restored'
    function EmptySource($feed, [string]$channel) {
        foreach ($n in @($feed.news)) { if ($n.title -eq $covered) { $n.sourceCommit = ''; $n.channel = $channel } }
        return $feed
    }
    $dev6 = EmptySource (Feed) 'dev'
    $r6 = Set-DevFeedMarks $dev6 $mainFeed $git
    Yes ("an empty sourceCommit is settled by the next clean release on main, and clears ({0})" -f (@($r6.Cleared) -join '; ')) (
        @($r6.Cleared) -contains $covered -and $r6.Marked -eq 4)
    $before224 = [pscustomobject][ordered]@{ launcherVersion = '1.1.105'; news = @()
        release = [pscustomobject][ordered]@{ id = '20261003-200000'; channel = 'main'; commit = $commitOf['20261003-192349-dev']; uncommitted = 0 } }
    $dev7 = EmptySource (Feed) 'dev'
    [void](Set-DevFeedMarks $dev7 $before224 $git)
    Yes '  with main before that clean release (at 20261003-192349-dev, dirty too), it keeps DEV' (
        @($dev7.news | Where-Object { $_.title -eq $covered })[0].channel -eq 'dev')
    $dev8 = EmptySource (Feed) ''
    $r8 = Set-DevFeedMarks $dev8 $before224 $git
    Yes '  and with no mark, it gains none' (@($r8.Gained) -notcontains $covered -and @($dev8.news | Where-Object { $_.title -eq $covered })[0].channel -eq '')

    # A later clean release on main that does not hold the dirty release's
    # commit settles nothing: the dirty release was built from a side line,
    # and main wrote the same file its own way.
    $tip = (G rev-parse HEAD)[0].Trim()
    [void](G checkout -q -b side $tip)
    [IO.File]::WriteAllText((Join-Path $git 'release.txt'), 'side work')
    [void](G add release.txt)
    [void](G commit -q -m 'side work')
    $side = (G rev-parse HEAD)[0].Trim()
    $env:GIT_COMMITTER_DATE = '2026-10-13T10:01:00-06:00'
    try { [void](G tag -a 'release/dev/20261013-100000-dev' $side -m "Thornswood dev release 20261013-100000-dev`n`nbuilt with 1 uncommitted change(s) on top of this commit") }
    finally { Remove-Item Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue }
    [void](G checkout -q --detach $tip)
    [IO.File]::WriteAllText((Join-Path $git 'release.txt'), 'main work')
    [void](G add release.txt)
    [void](G commit -q -m 'main work')
    $later = (G rev-parse HEAD)[0].Trim()
    $env:GIT_COMMITTER_DATE = '2026-10-13T12:01:00-06:00'
    try { [void](G tag -a 'release/dev/20261013-120000-dev' $later -m 'Thornswood dev release 20261013-120000-dev') }
    finally { Remove-Item Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue }
    $atLater = [pscustomobject][ordered]@{ launcherVersion = '1.2.4'; news = @()
        release = [pscustomobject][ordered]@{ id = '20261013-130000'; channel = 'main'; commit = $later; uncommitted = 0 } }
    $dev9 = [pscustomobject][ordered]@{ launcherVersion = '1.2.4.1'; mainVersion = '1.2.3'
        news = @([pscustomobject][ordered]@{ date = '10-13-2026 10:00 AM'; title = 'Side work'; body = ''; details = @('a line'); channel = 'dev'; sourceCommit = '' }) }
    [void](Set-DevFeedMarks $dev9 $atLater $git)
    Yes ("a later clean release on main that does not hold the dirty commit settles nothing ({0})" -f $dev9.news[0].channel) ($dev9.news[0].channel -eq 'dev')

    # Notes whose sourceCommit this clone does not hold, as every note written
    # before the #3684 history rewrite of 31 Oct 2026 names an id main no
    # longer has (#5133): each is judged by its release's tag, as a note with
    # none is. "The launcher gets ready in seconds" came with
    # 20261011-174543-dev, main's own commit, so it clears from a stale DEV;
    # "Keys, deeds and forges" came with 20261011-221215-dev, which main does
    # not have, so it keeps DEV. Until 31 Oct both read as commits main lacked.
    $gone = @{ 'The launcher gets ready in seconds' = ('ab' * 20); 'Keys, deeds and forges' = ('cd' * 20) }
    $dev10 = Feed
    foreach ($n in @($dev10.news)) {
        if ($gone.ContainsKey($n.title)) { $n.sourceCommit = $gone[$n.title]; $n.channel = 'dev' }
    }
    $r10 = Set-DevFeedMarks $dev10 $mainFeed $git
    $ch10 = @{}; foreach ($n in @($dev10.news)) { $ch10[$n.title] = $n.channel }
    Yes ("a sourceCommit the clone does not hold is judged by its release's tag: on main it clears ({0})" -f (@($r10.Cleared) -join '; ')) (
        $ch10['The launcher gets ready in seconds'] -eq '' -and @($r10.Cleared) -contains 'The launcher gets ready in seconds')
    Yes ("  and one whose release main does not have keeps DEV ({0} marked)" -f $r10.Marked) (
        $ch10['Keys, deeds and forges'] -eq 'dev' -and $r10.Marked -eq 4)
    $dev11 = Feed
    foreach ($n in @($dev11.news)) { if ($gone.ContainsKey($n.title)) { $n.sourceCommit = $gone[$n.title] } }
    $r11 = Set-DevFeedMarks $dev11 $older $git
    $ch11 = @{}; foreach ($n in @($dev11.news)) { $ch11[$n.title] = $n.channel }
    Yes '  and against a main before its release the one with no mark gains DEV, by the tag, as with its own id' (
        $ch11['The launcher gets ready in seconds'] -eq 'dev' -and $r11.Marked -eq 6)

    # The same when the commit is in the clone's object store but no branch or
    # tag reaches it, as the gate's checkout on the box keeps the old main tips
    # it fetched one commit deep before the rewrite: the first dev Ship with
    # the rule above, 20261031-155402-dev, still left 13 of 18 notes marked.
    $loose = (G commit-tree ((G rev-parse 'HEAD^{tree}')[0].Trim()) -m 'an old main tip no ref reaches')[0].Trim()
    $dev12 = Feed
    foreach ($n in @($dev12.news)) {
        if ($n.title -eq 'The launcher gets ready in seconds') { $n.sourceCommit = $loose; $n.channel = 'dev' }
    }
    $r12 = Set-DevFeedMarks $dev12 $mainFeed $git
    Yes ("  and one the clone holds that no branch or tag reaches is judged by the tag too, and clears ({0} marked)" -f $r12.Marked) (
        @($r12.Cleared) -contains 'The launcher gets ready in seconds' -and $r12.Marked -eq 4)

    # A note with no proof of its own, below one whose own clean commit main
    # has, is settled by it: the dev build was rebuilt whole from that commit,
    # so whatever the older release carried is on main or gone from dev. On
    # 31 Oct "Loading screens show the painting" and "Loading screen test
    # returns" (22 Oct, a test taken off dev that evening) stayed DEV for good:
    # their ids are from before the #3684 rewrite and no tag's span holds
    # their times. Stood in for here by two old notes given an id nothing holds
    # and a time no tag covers.
    $orphans = @('NPC populations and shared supplies', 'A lost server now returns you to the main menu')
    function Orphaned {
        $f = Feed
        foreach ($n in @($f.news)) {
            if ($orphans -contains $n.title) { $n.date = '10-1-2026 3:00 AM'; $n.channel = 'dev'; $n | Add-Member -NotePropertyName sourceCommit -NotePropertyValue ('ef' * 20) -Force }
        }
        return $f
    }
    $dev13 = Orphaned
    $r13 = Set-DevFeedMarks $dev13 $mainFeed $git
    Yes ("notes with no proof below one whose clean commit main has are settled by it, and clear ({0} marked)" -f $r13.Marked) (
        $r13.Marked -eq 4 -and @($orphans | Where-Object { @($r13.Cleared) -notcontains $_ }).Count -eq 0)
    $dev14 = Orphaned
    [void](Set-DevFeedMarks $dev14 $atDirty $git)
    Yes '  and with nothing above them on main, they keep their marks' (
        @($dev14.news | Where-Object { $orphans -contains $_.title -and $_.channel -eq 'dev' }).Count -eq 2)
    # A note whose release was built with uncommitted files settles nothing
    # below it, though main has its commit: no commit says what the dev build
    # carried then. Two notes, one on the other: "Covered bodies restored",
    # carrying 20261003-185740-dev's commit (1 uncommitted), over a note with
    # no proof; main at that commit. Then the same over the clean
    # 20261003-180655-dev, main at its commit, which does settle it.
    function Pair([string]$rel, [string]$title) {
        return [pscustomobject][ordered]@{ launcherVersion = '1.2.3.2'; mainVersion = '1.2.3'; news = @(
            [pscustomobject][ordered]@{ date = '10-3-2026 6:58 PM'; title = $title; body = ''; details = @('a line'); channel = 'dev'; sourceCommit = $commitOf[$rel] }
            [pscustomobject][ordered]@{ date = '10-1-2026 3:00 AM'; title = 'No proof'; body = ''; details = @('a line'); channel = 'dev'; sourceCommit = ('ef' * 20) }) }
    }
    function MainAt([string]$rel) {
        return [pscustomobject][ordered]@{ launcherVersion = '1.1.105'; news = @()
            release = [pscustomobject][ordered]@{ id = '20261003-235900'; channel = 'main'; commit = $commitOf[$rel]; uncommitted = 0 } }
    }
    $dev15 = Pair '20261003-185740-dev' 'Covered bodies restored'
    [void](Set-DevFeedMarks $dev15 (MainAt '20261003-185740-dev') $git)
    Yes ("  under a note whose release was built with uncommitted files it keeps DEV, though main has that commit ({0} over {1})" -f $(if ($dev15.news[0].channel) { 'dev' } else { 'main' }), $dev15.news[1].channel) (
        $dev15.news[0].channel -eq '' -and $dev15.news[1].channel -eq 'dev')
    $dev16 = Pair '20261003-180655-dev' 'The start scroll responds again'
    [void](Set-DevFeedMarks $dev16 (MainAt '20261003-180655-dev') $git)
    Yes ("  and under a clean one main has it clears ({0})" -f $(if ($dev16.news[1].channel) { 'dev' } else { 'main' })) (
        $dev16.news[0].channel -eq '' -and $dev16.news[1].channel -eq '')

    # A clone with no tags proves nothing about the old notes: they keep their marks.
    $made = G tag -l 'release/dev/*'
    [void](G tag -d @made)
    $dev4 = Feed
    $r4 = Set-DevFeedMarks $dev4 $mainFeed $git
    Yes ("with no release tags in the clone every old note keeps its mark ({0} marked)" -f $r4.Marked) ($r4.Marked -eq 20 -and @($r4.Cleared).Count -eq 0)
}
finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
