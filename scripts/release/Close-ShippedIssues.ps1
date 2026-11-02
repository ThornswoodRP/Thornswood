<#
.SYNOPSIS
  Closes the issues in Done whose fix a main Ship carries, each with the test
  task its pull request wrote, and says which it closed and which stay open;
  with -Dev, writes the Dev test tasks a dev Ship carries, closing nothing.

.DESCRIPTION
  WHY (#3279). A fix people would notice merges with "Test task for #N" in its
  pull request, and .github\workflows\done-on-merge.yml moves #N to Done and
  writes the test task on it, ready for when a main Ship puts the fix on the
  main server testers play (#2796). Nothing did that close. It was a hand step
  for whoever ran the Ship, one issue at a time, and on 22 Oct 2026 two threads
  closed noticeable fixes at the merge instead, with no main Ship since 18 Oct,
  which sends testers to look for a fix the main server does not have. Issues
  had sat open after their runs before for the same reason: the close had no
  owner (#3192). The main Ship owns it now: Ship.ps1 runs this after it tags
  the release, with the commit the release was built from.

  WHAT IT CLOSES. Every open issue of this repository whose card is in Done on
  the board, read through scripts\ops\Read-Board.ps1 (the board is read only
  through GraphQL, which a cloud session is refused, so that script reads it
  on a VPS runner and works from One and the cloud alike). For each, the
  issue's last done-on-merge comment, written by github-actions[bot], names
  the merge commit and holds the test task in a fenced block. When the shipped
  commit contains that merge, the issue gets a comment holding exactly the
  block, the "Test task:" comment the bot turns into a #test-tasks post, and
  is closed as completed, in that order, because the bot posts a test task
  when its issue closes after the comment.

  MOVED TO DONE BY HAND (#3411). A fix that spans several pull requests, a
  pin or a box change has no single "Test task for #N" pull request, so
  whoever moves its issue to Done by hand writes the line done-on-merge would
  have written, as a comment of its own, from any author:

      Fixed by <merge commit> (pull request #N).

  then either the test task in a fenced block, as done-on-merge writes it, or
  the line "No test task: nobody would notice this fix." This reads that line
  as it reads done-on-merge's comment, and the newer of the two stands: when
  the shipped commit contains the merge it names, the issue is closed with
  its test task, or with no comment when it has none. The board review of 25
  Oct 2026 (#3192) found 26 of the 36 open issues in Done moved by hand, none
  of which a main Ship could close.

  WHAT STAYS OPEN, each said by number:
    - an issue whose merge the shipped commit does not contain: its fix is not
      on the main server yet, so the next main Ship that carries it closes it.
      That merge has to be on main, though: one that is not, such as an id from
      before main's history was rewritten (#3684), no release will ever carry,
      so it is a stop that names the comment to put the merge's id on main in;
    - an issue in Done with neither a done-on-merge comment nor a "Fixed by"
      line: nothing says which merge finishes it, so this cannot tell whether
      the release carries it, and whoever moved it there closes it.

  DEV AND MAIN. A test task is Main, for any playtester, or Dev, with
  "Server: Dev" under its first line, for what only a developer can check;
  the bot keeps the two apart, in #test-tasks and #dev-test-tasks, and a Dev
  one stays up after the fix is on main (Patrick, 22 Oct; docs/guide/the-board.md,
  "Test tasks and known issues"). So a Dev test task never keeps an issue
  open, and the block is written unless a person wrote a "Test task:" comment
  of the same kind after the merge, which stands instead: the bot reads the
  issue's last one of each kind.

  Whether the release carries a merge is asked of git in -RepoDir, the checkout
  the Ship built from, so a shallow checkout, which cannot answer, is refused.

  A DEV RELEASE (-Dev, #5199). A Dev test task is for developers, and goes
  up as soon as a dev release carries the fix (Patrick, 22 Oct), which was a
  hand step: done-on-merge.yml asked whoever saw the release to write it,
  with a Build: line naming it, and the step had no owner. A dev Ship runs
  this with -Dev and its release's name: for each issue in Done whose block
  is Dev and whose merge the release carries, with no Dev "Test task:"
  comment after the merge, it writes the block with its Build: line set to
  that release, and the bot posts it in #dev-test-tasks. A Main block waits
  for a main Ship, and nothing is closed. The main Ship that closes the
  issue later finds that Dev comment and writes no second one.

  NOTHING HERE FAILS A RELEASE. Ship calls it after the release is out, like
  the remirror (Publish-PostShip.ps1): a stop is a line in Ship's Done with
  the command that runs this again. Running it again closes only what is still
  open, so it can be run twice.

    .\scripts\release\Close-ShippedIssues.ps1 -Commit <sha>          close what <sha> carries
    .\scripts\release\Close-ShippedIssues.ps1 -Commit <sha> -Check   say what it would close, close nothing
    .\scripts\release\Close-ShippedIssues.ps1 -Commit <sha> -Dev -Build <dev release>   write the Dev test tasks it carries

.PARAMETER Commit
  The commit the main release was built from. Ship passes the one its release
  record names, the commit its release/main tag marks.

.PARAMETER RepoDir
  The checkout to ask git in. Defaults to the one this script is in.

.PARAMETER BoardFile
  A board.json Read-Board.ps1 already wrote, instead of reading the board
  again.

.PARAMETER GitHubRepo
  The repository whose issues are closed.

.PARAMETER Dev
  The release is a dev release: write each carried Dev test task with its
  Build: line, close nothing. Needs -Build.

.PARAMETER Build
  With -Dev, the dev release's name, as its release record gives it.

.PARAMETER Check
  Read and say what would close, and change nothing on GitHub. The board read
  still starts board-read.yml, which changes nothing either.

.PARAMETER NoPause
  Skip the Enter-to-close pause so Ship can call this without hanging.

.NOTES
  Exit codes: 0 when every issue the release carries is closed (or would be,
  with -Check), and 1 when something stopped, with the line before saying why.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Commit,
    [string]$RepoDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
    [string]$BoardFile,
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood',
    [switch]$Check,
    [switch]$Dev,
    [string]$Build = '',
    [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Finish([int]$code) {
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit $code
}
function Stop-Here($m) { Say "STOP. $m" 'Red'; Finish 1 }

# The footer done-on-merge.yml ends its comment with, and the line it starts
# with. Read from the comment, never from the pull request again, so what is
# posted is exactly what the issue already shows.
$Footer = '_Done on merge, .github/workflows/done-on-merge.yml_'
$MergedLine = '^Pull request #(\d+) merged \(([0-9a-fA-F]{7,40})\)'
$Robot = 'github-actions[bot]'
$TaskMark = '^\s*test task\s*:'
# The line a person writes for an issue moved to Done by hand (#3411), first
# in its comment, and the line that says the fix needs no test task.
$HandLine = '^Fixed by ([0-9a-fA-F]{7,40}) \(pull request #(\d+)\)\.'
$NoTaskLine = '(?m)^No test task: nobody would notice this fix\.\s*$'
# Dev when "Server: Dev" is the line under the title, as the bot reads it.
function Kind-Of([string[]]$Lines) {
    if ($Lines.Count -gt 1 -and $Lines[1] -match '^\s*server\s*:\s*dev\s*$') { return 'Dev' }
    return 'Main'
}
# A Dev block with its Build: line naming the dev release that carries it:
# the bot shows that line on the post (bot.py, BUILD_LINE). The pull
# request's own Build: line, written before any release existed, is
# replaced; with none, it goes under the Server line.
$BuildLine = '^\s*(?:needs\s+)?build\s*:'
function Set-Build([string]$Task, [string]$Line) {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($l in @($Task -split "`n")) { $lines.Add($l) }
    $at = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match $BuildLine) { $at = $i; break } }
    if ($at -ge 0) { $lines[$at] = $Line } else { $lines.Insert([Math]::Min(2, $lines.Count), $Line) }
    for ($i = $lines.Count - 1; $i -gt $at -and $at -ge 0; $i--) { if ($lines[$i] -match $BuildLine) { $lines.RemoveAt($i) } }
    return ($lines -join "`n")
}
if ($Dev -and $Build -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') { Stop-Here 'a dev release is named with -Build, its release''s name (letters, digits, dots, dashes).' }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Stop-Here 'there is no gh here to read and close the issues with.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-Here 'there is no git here to ask which merges the release carries.' }

# git in the checkout: its exit code and its lines, never thrown. Not named
# Git, which would be git itself to PowerShell and call itself for ever.
function Invoke-Git([string[]]$GitArgs) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $RepoDir @GitArgs 2>&1 | ForEach-Object { [string]$_ }); $c = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $c; Lines = $o; First = $(if ($o.Count) { $o[0].Trim() } else { '' }) }
}

# GitHub's REST API, as whoever gh is signed in as. Invoke-RestMethod reads
# the answer as the UTF-8 GitHub says it is, so a test task with an accent or
# a curly quote is posted back exactly as it was written; gh's own output
# would be read through the console's code page instead. The token is asked
# of gh once, kept in this process and sent only to api.github.com.
$script:Token = $null
function Invoke-GitHub([string]$Method, [string]$Path, $Body) {
    if (-not $script:Token) {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $t = @(& gh auth token 2>&1 | ForEach-Object { [string]$_ }); $c = $LASTEXITCODE }
        finally { $ErrorActionPreference = $old }
        if ($c -ne 0 -or -not $t.Count -or -not $t[0].Trim()) { throw ('gh is not signed in here (gh auth token: ' + ($t -join ' ').Trim() + '). Sign in with gh auth login, then run this again.') }
        $script:Token = $t[0].Trim()
    }
    $h = @{ Authorization = "Bearer $script:Token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
    $a = @{ Method = $Method; Uri = ('https://api.github.com/' + $Path); Headers = $h }
    if ($null -ne $Body) {
        $a.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 6 -Compress))
        $a.ContentType = 'application/json; charset=utf-8'
    }
    try { return (Invoke-RestMethod @a) }
    catch { throw ("GitHub answered $Method $Path with: " + $_.Exception.Message) }
}

# Every comment on an issue, oldest first, a page of 100 at a time.
function Get-Comments([int]$Number) {
    $all = New-Object System.Collections.Generic.List[object]
    for ($page = 1; ; $page++) {
        $got = @(Invoke-GitHub 'GET' ("repos/$GitHubRepo/issues/$Number/comments?per_page=100&page=$page") $null | ForEach-Object { $_ })
        foreach ($c in $got) { $all.Add($c) }
        if ($got.Count -lt 100) { break }
    }
    return $all.ToArray()
}

# ------------------------------------------------------------ the commit
$what = if ($Dev) { 'THE DEV TEST TASKS THIS DEV RELEASE CARRIES' + $(if ($Check) { ' (-Check, nothing changes)' } else { '' }) } elseif ($Check) { 'WHAT A MAIN SHIP WOULD CLOSE (-Check, nothing changes)' } else { 'THE DONE ISSUES THIS MAIN RELEASE CARRIES' }
Write-Host ''
Write-Host "  $what" -ForegroundColor White

if ((Invoke-Git @('rev-parse', '--is-inside-work-tree')).First -ne 'true') { Stop-Here "$RepoDir is not a git checkout." }
if ((Invoke-Git @('rev-parse', '--is-shallow-repository')).First -eq 'true') {
    Stop-Here "$RepoDir is a shallow checkout, so git cannot say which merges $Commit carries. Run this from a full clone."
}
$g = Invoke-Git @('rev-parse', '--verify', '--quiet', ($Commit + '^{commit}'))
if ($g.Code -ne 0 -or -not $g.First) { Stop-Here "commit $Commit is not in $RepoDir. git fetch origin, then run this again." }
$shipped = $g.First
Say ("  the release was built from {0}" -f $shipped.Substring(0, 12)) 'DarkGray'

# ------------------------------------------------------------- the board
Head 'The board'
$scratch = $null
if (-not $BoardFile) {
    $scratch = & (Join-Path $Here 'Get-ScratchDir.ps1') ('Thornswood-close-shipped-' + [Guid]::NewGuid().ToString('N'))
    $BoardFile = Join-Path $scratch 'board.json'
    $reader = Join-Path $Here '..\ops\Read-Board.ps1'
    if (-not (Test-Path -LiteralPath $reader)) { Stop-Here 'scripts\ops\Read-Board.ps1 is not on this machine, so the board cannot be read.' }
    $global:LASTEXITCODE = 0
    & $reader -OutFile $BoardFile -GitHubRepo $GitHubRepo
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $BoardFile)) {
        if ($scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue }
        Stop-Here "the board was not read (Read-Board.ps1 exit $LASTEXITCODE; the lines above say why), so nothing was closed."
    }
}
try { $board = [IO.File]::ReadAllText($BoardFile) | ConvertFrom-Json }
catch { Stop-Here "could not read ${BoardFile}: $($_.Exception.Message)" }
finally { if ($scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue } }

$done = @(@($board.items) | Where-Object {
        $_.kind -eq 'Issue' -and $_.state -eq 'OPEN' -and $_.status -eq 'Done' -and -not $_.archived -and
        [string]$_.repo -eq $GitHubRepo -and $null -ne $_.number
    } | Sort-Object { [int]$_.number })
Say ("  {0} open issue(s) in Done, read at {1}" -f $done.Count, $board.read_at) 'DarkGray'

# ------------------------------------------------------------ each issue
Head 'Each issue'
$closed = New-Object System.Collections.Generic.List[string]
$notCarried = New-Object System.Collections.Generic.List[string]
$noTask = New-Object System.Collections.Generic.List[string]
$trouble = New-Object System.Collections.Generic.List[string]

foreach ($card in $done) {
    $n = [int]$card.number
    try { $comments = @(Get-Comments $n) }
    catch { Say "  #${n}: $($_.Exception.Message)" 'Red'; $trouble.Add("#$n"); continue }

    # The newest of done-on-merge's comment and a person's "Fixed by" line.
    $mark = -1; $byHand = $false
    for ($i = $comments.Count - 1; $i -ge 0; $i--) {
        $c = $comments[$i]
        $body = ([string]$c.body) -replace "`r`n", "`n"
        if ([string]$c.user.login -eq $Robot -and $body.Contains($Footer) -and $body -match $MergedLine) { $mark = $i; break }
        if ($body.TrimStart() -match $HandLine) { $mark = $i; $byHand = $true; break }
    }
    if ($mark -lt 0) { $noTask.Add("#$n"); continue }

    $body = ([string]$comments[$mark].body) -replace "`r`n", "`n"
    if ($byHand) {
        $m = [regex]::Match($body.TrimStart(), $HandLine)
        $merge = $m.Groups[1].Value
        $pr = $m.Groups[2].Value
        $whose = "the Fixed by line naming pull request #$pr"
    } else {
        $m = [regex]::Match($body, $MergedLine)
        $pr = $m.Groups[1].Value
        $merge = $m.Groups[2].Value
        $whose = "the done-on-merge comment for pull request #$pr"
    }
    $fence = [regex]::Match($body, '(?ms)^```\n(.*?)\n```\s*$')
    $task = if ($fence.Success) { $fence.Groups[1].Value.Trim() } else { '' }
    $none = $byHand -and $task -notmatch $TaskMark -and $body -match $NoTaskLine
    if ($task -notmatch $TaskMark -and -not $none) {
        Say "  #${n}: $whose holds no Test task: block and does not say it needs none, so there is nothing to close it with" 'Red'
        $trouble.Add("#$n"); continue
    }

    # A "Test task:" comment of the block's own kind, Dev or Main, written
    # after the merge's is the one that stands: the bot reads the issue's
    # last one of each kind. One of the other kind changes nothing here.
    $kind = Kind-Of (@($task -split "`n"))
    $own = $false
    for ($i = $comments.Count - 1; $i -gt $mark -and -not $none; $i--) {
        $lines = @((([string]$comments[$i].body) -replace "`r`n", "`n").Trim() -split "`n")
        if ($lines.Count -and $lines[0] -match $TaskMark -and (Kind-Of $lines) -eq $kind) { $own = $true; break }
    }

    $a = Invoke-Git @('merge-base', '--is-ancestor', $merge, $shipped)
    $held = (Invoke-Git @('rev-parse', '--verify', '--quiet', ($merge + '^{commit}'))).Code -eq 0
    if ($a.Code -ne 0 -and $held -and $a.Code -ne 1) {
        Say ("  #{0}: git could not say whether {1} carries {2}: {3}" -f $n, $shipped.Substring(0, 12), $merge, (($a.Lines | Select-Object -Last 1) -join '')) 'Red'
        $trouble.Add("#$n"); continue
    }
    if ($a.Code -ne 0) {
        # Not in this release. That is only "not yet" when the merge is on
        # main: after the shipped commit in this checkout, or else on main as
        # GitHub has it (a merge newer than this checkout's fetch, or a
        # release built off main's line). A merge that is not on main at all
        # is never carried by any release, so the issue would stay open for
        # ever without a word: the 21 issues in Done whose comments named
        # merge ids from before main's history was rewritten (#3684) did
        # exactly that through the main Ship of 31 Oct. Said as a stop instead.
        $onMain = $held -and (Invoke-Git @('merge-base', '--is-ancestor', $shipped, $merge)).Code -eq 0
        $why = ''
        if (-not $onMain) {
            try {
                $cmp = Invoke-GitHub 'GET' ("repos/$GitHubRepo/compare/$merge...main?per_page=1") $null
                $status = [string]$cmp.status
                $onMain = $status -eq 'ahead' -or $status -eq 'identical'
                if (-not $onMain) { $why = "GitHub says main and it have $status" }
            } catch { $why = $_.Exception.Message }
        }
        if (-not $onMain) {
            Say ("  #{0}: $whose names merge {1}, which is not on main ({2}). Its id is from before main's history was rewritten, or wrong. Put the id that merge has on main in that comment, then run this again." -f $n, $merge, $why) 'Red'
            $trouble.Add("#$n"); continue
        }
        Say ("  #{0}: stays open, pull request #{1}'s merge {2} is not in this release" -f $n, $pr, $merge) 'DarkGray'
        $notCarried.Add("#$n"); continue
    }

    if ($Dev) {
        # Only a Dev block goes up on a dev release, once.
        if ($none -or $kind -ne 'Dev') { Say ("  #{0}: its test task is for main, so the main Ship that carries it writes it" -f $n) 'DarkGray'; $notCarried.Add("#$n"); continue }
        if ($own) { Say ("  #{0}: its Dev test task is already written after the merge" -f $n) 'DarkGray'; $closed.Add("#$n"); continue }
        $line = 'Build: dev release ' + $Build + ', from ' + $shipped.Substring(0, 12)
        if ($Check) { Say ("  #{0}: would write its Dev test task, {1}" -f $n, $line) 'Green'; $closed.Add("#$n"); continue }
        try {
            $null = Invoke-GitHub 'POST' "repos/$GitHubRepo/issues/$n/comments" @{ body = (Set-Build $task $line) }
            Say ("  #{0}: its Dev test task is written, {1}; the bot posts it in #dev-test-tasks" -f $n, $line) 'Green'
            $closed.Add("#$n")
        } catch {
            Say "  #${n}: $($_.Exception.Message)" 'Red'
            $trouble.Add("#$n")
        }
        continue
    }
    if ($Check) {
        Say ("  #{0}: would close, pull request #{1}'s merge {2} is in this release{3}" -f $n, $pr, $merge, $(if ($none) { ', with no test task, as its Fixed by line says' } elseif ($own) { ', with the test task written on it after the merge' } else { '' })) 'Green'
        $closed.Add("#$n"); continue
    }
    try {
        if (-not $own -and -not $none) { $null = Invoke-GitHub 'POST' "repos/$GitHubRepo/issues/$n/comments" @{ body = $task } }
        $null = Invoke-GitHub 'PATCH' "repos/$GitHubRepo/issues/$n" @{ state = 'closed'; state_reason = 'completed' }
        Say ("  #{0}: closed, pull request #{1}'s merge {2} is in this release{3}" -f $n, $pr, $merge, $(if ($none) { '; it needs no test task' } elseif ($own) { '; its own later test task stands' } else { '; its test task is on it' })) 'Green'
        $closed.Add("#$n")
    } catch {
        Say "  #${n}: $($_.Exception.Message)" 'Red'
        $trouble.Add("#$n")
    }
}

# ------------------------------------------------------------------ done
Head 'Done'
$verb = if ($Dev) { 'Dev test tasks written or already there' } elseif ($Check) { 'Would close' } else { 'Closed' }
function Line([string]$label, $list, $colour) {
    if ($list.Count) { Say ("  {0} ({1}): {2}" -f $label, $list.Count, ($list -join ' ')) $colour }
}
if (-not $closed.Count) { Say $(if ($Dev) { '  No Dev test task in Done is carried by this release.' } else { '  Nothing in Done is carried by this release.' }) 'DarkGray' }
Line $verb $closed 'Green'
Line $(if ($Dev) { 'Not written, not carried or for main' } else { 'Stay open, their merge is not in this release' }) $notCarried 'DarkGray'
Line 'Stay open, in Done with no test task from a merge to close them with' $noTask 'DarkGray'
if ($trouble.Count) {
    Line 'Stopped, the lines above say why' $trouble 'Red'
    Say ("  .\scripts\release\Close-ShippedIssues.ps1 -Commit {0}{1}   runs it again; it does only what is still to do" -f $shipped, $(if ($Dev) { ' -Dev -Build ' + $Build } else { '' })) 'Yellow'
    Finish 1
}
Finish 0
