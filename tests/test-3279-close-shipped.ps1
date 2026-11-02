<#
  test-3279-close-shipped.ps1

  scripts\release\Close-ShippedIssues.ps1, which a main Ship runs after it
  tags the release: every open issue in Done whose done-on-merge comment names
  a merge the shipped commit contains is closed, with the test task from that
  comment as its closing comment, and every other one stays open, said.

  WHY THIS EXISTS. Issue #3279. done-on-merge.yml (#2796) moves a noticeable
  fix's issue to Done at the merge and writes its test task on it "for when a
  main Ship carries it", and nothing did that close: it was a hand step for
  whoever ran the Ship, and on 22 Oct two threads closed fixes at the merge
  instead, before any main Ship carried them.

  What it checks, in a scratch git repository with a merge before the shipped
  commit and one after, a board.json in the shape board-read.yml writes, and
  stand-ins for gh and Invoke-RestMethod that answer from a table and write
  down every call:
    1. an issue in Done whose merge is in the release gets one comment holding
       exactly the test task, then is closed as completed, in that order;
    2. one whose merge came after the release stays open, and so does one
       whose last done-on-merge comment names the later merge;
    3. one with a person's newer "Test task:" for main is closed with no
       second comment; a newer Server: Dev one keeps nothing open and the
       Main block is still written; a Dev block is written unless a newer
       Dev one stands, whatever Main one is beside it (Patrick, 22 Oct: the
       two are for different people, and a Dev one may stay while on main);
    4. one with no done-on-merge comment, or one only a person wrote with the
       same footer, stays open, listed;
    5. a card not in Done, a closed issue and another repository's are not
       read at all, and a comment on the second page of 100 is found;
    6. -Check writes nothing and says what it would close;
    7. a refused close is a stop: exit 1, the issue named, the command that
       runs it again printed, and the others still closed;
    8. a shallow checkout and a commit the checkout does not hold stop before
       anything is read;
    9. an issue moved to Done by hand (#3411), with a person's "Fixed by
       <merge> (pull request #N)." line: closed with the test task in its
       block, or with no comment when it says "No test task: nobody would
       notice this fix."; kept open when the merge is not in the release; the
       newer of it and a done-on-merge comment stands; and a line with
       neither a block nor the no-task line is a stop;
   10. a merge this checkout does not hold stays open only when GitHub says
       it is on main; one that is not (an id from before main's history was
       rewritten, #3684), or that GitHub does not know, is a stop naming it,
       and the issues beside it are still closed;
   11. with -Dev and a dev release's name (#5199), a carried Dev block with
       no Dev test task after its merge is written with its Build: line
       naming that release, a Main one waits, and nothing is closed.

  It never reaches GitHub. Files under its own temp folder only.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Script = Join-Path $Repo 'scripts\release\Close-ShippedIssues.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

Yes 'scripts\release\Close-ShippedIssues.ps1 is there' (Test-Path -LiteralPath $Script)
$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
Yes 'pwsh is on this machine to run it with' ($null -ne $pwsh)
if (-not (Test-Path -LiteralPath $Script) -or -not $pwsh) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-close-shipped-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$calls = Join-Path $work 'calls.txt'
$routes = Join-Path $work 'routes.json'
$git = Join-Path $work 'repo'

function G([string[]]$a) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $git @a 2>&1 | ForEach-Object { [string]$_ }) } finally { $ErrorActionPreference = $old }
    if ($LASTEXITCODE -ne 0) { throw ("git " + ($a -join ' ') + ": " + ($o -join ' ')) }
    return $(if ($o.Count) { $o[-1].Trim() } else { '' })
}

# The stand-ins: functions, which PowerShell finds before the real gh and
# Invoke-RestMethod. gh answers "auth token" only. Invoke-RestMethod answers
# "<METHOD> <path>" from the table, throws for what the table's refuse list
# names, hands a list back as one object the way the real one does
# (test-3192-board-hygiene.ps1 measures that), and writes down every call
# with its token and body.
$standIn = @'
function gh {
    if (($args -join ' ') -eq 'auth token') { $global:LASTEXITCODE = 0; return 'test-token' }
    $global:LASTEXITCODE = 1; return ('stand-in gh: not asked for: ' + ($args -join ' '))
}
function Invoke-RestMethod {
    param([string]$Method = 'Get', [string]$Uri, [hashtable]$Headers, $Body, [string]$ContentType)
    $key = $Method.ToUpperInvariant() + ' ' + ($Uri -replace '^https://api\.github\.com/', '')
    $text = if ($Body -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Body) } else { [string]$Body }
    [IO.File]::AppendAllText($env:TS_CALLS, ($key + ' ' + $Headers['Authorization'] + ' ' + $text).Trim() + "`n", [Text.Encoding]::UTF8)
    $t = Get-Content -LiteralPath $env:TS_ROUTES -Raw -Encoding UTF8 | ConvertFrom-Json
    if (@($t.refuse) -contains $key) { throw 'Response status code does not indicate success: 403 (Forbidden).' }
    if ($t.answers.PSObject.Properties[$key]) { $v = $t.answers.$key; if ($v -is [array]) { return ,$v }; return $v }
    if ($Method -eq 'Get') { return ,@() }
    return [pscustomobject]@{}
}

'@

function Run([string[]]$extra, [hashtable]$answers, [string[]]$refuse = @(), [string]$commit = $script:shipped, [string]$repoDir = $git) {
    Remove-Item -LiteralPath $calls -Force -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($routes, (@{ answers = $answers; refuse = $refuse } | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
    $runner = Join-Path $work 'run.ps1'
    [IO.File]::WriteAllText($runner, $standIn + "& '" + $Script.Replace("'", "''") + "' @args`nexit `$LASTEXITCODE`n")
    $keep = @{ TS_CALLS = $env:TS_CALLS; TS_ROUTES = $env:TS_ROUTES }
    $env:TS_CALLS = $calls; $env:TS_ROUTES = $routes
    try {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            $out = & $pwsh.Source -NoProfile -NonInteractive -File $runner -Commit $commit -RepoDir $repoDir -BoardFile $script:boardFile -NoPause @extra 2>&1 | Out-String
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $old }
    } finally { $env:TS_CALLS = $keep.TS_CALLS; $env:TS_ROUTES = $keep.TS_ROUTES }
    $all = @()
    if (Test-Path -LiteralPath $calls) { $all = @(Get-Content -LiteralPath $calls -Encoding UTF8 | Where-Object { $_ }) }
    return [pscustomobject]@{ Code = $code; Out = $out; Calls = $all; Writes = @($all | Where-Object { $_ -notmatch '^GET ' }) }
}

try {
    # ---- the repository: merge A, the shipped commit, then merge B ----------
    New-Item -ItemType Directory -Force -Path $git | Out-Null
    $null = G @('init', '-q')
    $null = G @('config', 'user.email', 'test@example.invalid')
    $null = G @('config', 'user.name', 'test')
    $null = G @('config', 'commit.gpgsign', 'false')
    $mergeA = $null; $mergeB = $null
    foreach ($step in 'a', 'shipped', 'b') {
        [IO.File]::WriteAllText((Join-Path $git "$step.txt"), $step)
        $null = G @('add', '-A')
        $null = G @('commit', '-q', '-m', $step)
        $sha = G @('rev-parse', 'HEAD')
        if ($step -eq 'a') { $mergeA = $sha } elseif ($step -eq 'shipped') { $script:shipped = $sha } else { $mergeB = $sha }
    }

    # Not $Slug: PowerShell names are not case sensitive, and $r is each run.
    $Slug = 'ThornswoodRP/Thornswood'
    function Card([int]$n, [string]$status = 'Done', [string]$state = 'OPEN', [string]$repo = $Slug) {
        return [ordered]@{ repo = $repo; number = $n; kind = 'Issue'; title = "issue $n"; state = $state; status = $status; order = $null; archived = $false }
    }
    $items = @((Card 1), (Card 2), (Card 3), (Card 4 'In Progress'), (Card 5 'Done' 'CLOSED'), (Card 6), (Card 7), (Card 8), (Card 10), (Card 11 'Done' 'OPEN' 'EvilPatrick06/other'), (Card 12), (Card 13), (Card 15), (Card 16), (Card 17), (Card 18), (Card 20), (Card 21))
    $items += [ordered]@{ repo = $Slug; number = 14; kind = 'PullRequest'; title = 'a pull request'; state = 'OPEN'; status = 'Done'; order = $null; archived = $false }
    $script:boardFile = Join-Path $work 'board.json'
    [IO.File]::WriteAllText($script:boardFile, ([ordered]@{ read_at = '2026-10-22T13:41:52Z'; items = $items } | ConvertTo-Json -Depth 6))

    # Curly quotes and an accent, so a test task comes back as it was written.
    $task = "Test task: Forge lists only what you can make`nServer: Main`n1. Open the forge at Dawnstar" + [char]0x2019 + "s caf" + [char]0xE9 + ".`n2. Only what you can make is listed; what you can" + [char]0x2019 + "t is not."
    function Robot([string]$sha, [int]$pr = 3300, [string]$who = 'github-actions[bot]', [string]$t = $task) {
        $b = ('Pull request #{0} merged ({1}), so this is in Done and stays open: the merge puts the fix on the main branch, not on the main server testers play. When a main Ship carries it, close this issue with a comment holding exactly this:' -f $pr, $sha.Substring(0, 12)) +
            "`n`n" + '```' + "`n" + $t + "`n" + '```' + "`n`n---`n_Done on merge, .github/workflows/done-on-merge.yml_"
        return [ordered]@{ user = @{ login = $who }; body = $b; created_at = '2026-10-22T12:00:00Z' }
    }
    $devBlock = "Test task: Measure the anvil`nServer: Dev`nBuild: 20261022-063057-dev`n1. Read the log for activate: lines."
    function Person([string]$body) { return [ordered]@{ user = @{ login = 'EvilPatrick06' }; body = $body; created_at = '2026-10-22T13:00:00Z' } }
    function Page([int]$n, [int]$p = 1) { return "GET repos/$Slug/issues/$n/comments?per_page=100&page=$p" }
    # The line a person writes for an issue moved to Done by hand (#3411).
    $handTask = "Test task: Stalls keep their goods`nServer: Main`n1. Put a sword on your stall and walk away.`n2. It is still there when you come back."
    function Hand([string]$sha, [int]$pr = 3320, [string]$rest = ('```' + "`n" + $handTask + "`n" + '```')) {
        return Person (('Fixed by {0} (pull request #{1}).' -f $sha.Substring(0, 12), $pr) + "`n`n" + $rest + "`n`n---`n_Generated by [Claude Code](https://claude.ai/code)_")
    }

    $filler = @(1..100 | ForEach-Object { Person "note $_" })
    $answers = @{
        (Page 1)  = @((Person 'claimed'), (Robot $mergeA))
        (Page 2)  = @((Robot $mergeB 3301))
        (Page 3)  = @((Person 'moved to Done by hand'))
        (Page 4)  = @((Robot $mergeA))
        (Page 5)  = @((Robot $mergeA))
        (Page 6)  = @((Robot $mergeA), (Person "Test task: A better title`nServer: Main`n1. Look again."))
        (Page 7)  = @((Robot $mergeA), (Person "Test task: Measure the forge`nServer: Dev`n1. Read the log."))
        (Page 8)  = @((Robot $mergeA 3300 'EvilPatrick06'))
        (Page 10) = @((Robot $mergeA 3304 'github-actions[bot]' $devBlock), (Person "Test task: The anvil works`nServer: Main`n1. Use the anvil."))
        (Page 15) = @((Robot $mergeA 3304 'github-actions[bot]' $devBlock), (Person ($devBlock + "`n2. And the timing.")))
        (Page 11) = @((Robot $mergeA))
        (Page 12) = @((Robot $mergeA), (Person 'it broke again'), (Robot $mergeB 3302))
        (Page 13) = $filler
        (Page 13 2) = @((Robot $mergeA 3303))
        (Page 16) = @((Person 'moved to Done by hand'), (Hand $mergeA))
        (Page 17) = @((Hand $mergeA 3321 'No test task: nobody would notice this fix.'))
        (Page 18) = @((Hand $mergeB 3322))
        (Page 20) = @((Robot $mergeB 3323), (Hand $mergeA 3324))
        (Page 21) = @((Hand $mergeA 3325), (Robot $mergeB 3326))
    }

    # ---- 1 to 5: a main Ship's run -------------------------------------------
    $r = Run @() $answers
    $w = $r.Writes
    Yes ("the run passes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    $c1 = @($w | Where-Object { $_ -like "POST repos/$Slug/issues/1/comments *" })
    $p1 = @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/1 *" })
    Yes '#1, merge in the release: one comment holding exactly the test task' (
        $c1.Count -eq 1 -and ($c1[0].Substring($c1[0].IndexOf('{')) | ConvertFrom-Json).body -ceq $task)
    Yes '  then closed as completed, after the comment' (
        $p1.Count -eq 1 -and $p1[0] -match '"state":"closed"' -and $p1[0] -match '"state_reason":"completed"' -and [array]::IndexOf($w, $c1[0]) -lt [array]::IndexOf($w, $p1[0]))
    Yes '#2, merge after the release: stays open, said' (@($w | Where-Object { $_ -match '/issues/2[ /]' }).Count -eq 0 -and $r.Out -match "#2: stays open, pull request #3301's merge")
    Yes '  a merge after the release in this checkout asks GitHub nothing more' (@($r.Calls | Where-Object { $_ -match '/compare/' }).Count -eq 0)
    Yes '#12, its last done-on-merge comment names the later merge: stays open' (@($w | Where-Object { $_ -match '/issues/12[ /]' }).Count -eq 0 -and $r.Out -match "#12: stays open, pull request #3302's merge")
    Yes '#6, a person''s newer test task for main: closed with no second comment' (
        @($w | Where-Object { $_ -like "POST repos/$Slug/issues/6/comments *" }).Count -eq 0 -and @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/6 *" -and $_ -match '"state":"closed"' }).Count -eq 1)
    $c7 = @($w | Where-Object { $_ -like "POST repos/$Slug/issues/7/comments *" })
    Yes '#7, a newer test task saying Server: Dev: closed all the same, with the Main block written' (
        $c7.Count -eq 1 -and ($c7[0].Substring($c7[0].IndexOf('{')) | ConvertFrom-Json).body -ceq $task -and
        @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/7 *" -and $_ -match '"state":"closed"' }).Count -eq 1)
    $c10 = @($w | Where-Object { $_ -like "POST repos/$Slug/issues/10/comments *" })
    Yes '#10, a Dev block with only a newer Main test task beside it: the Dev block is written, then closed' (
        $c10.Count -eq 1 -and ($c10[0].Substring($c10[0].IndexOf('{')) | ConvertFrom-Json).body -ceq $devBlock -and
        @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/10 *" -and $_ -match '"state":"closed"' }).Count -eq 1)
    Yes '#15, a Dev block with a newer Dev test task: closed with no second comment' (
        @($w | Where-Object { $_ -like "POST repos/$Slug/issues/15/comments *" }).Count -eq 0 -and @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/15 *" -and $_ -match '"state":"closed"' }).Count -eq 1)
    Yes '#3, no done-on-merge comment, and #8, the footer written by a person: stay open, listed' (
        @($w | Where-Object { $_ -match '/issues/[38][ /]' }).Count -eq 0 -and $r.Out -match 'no test task from a merge to close them with \(2\): #3 #8')
    Yes '#4 in progress, #5 closed, #11 another repository''s and #14 a pull request: not read at all' (
        @($r.Calls | Where-Object { $_ -match '/issues/(4|5|11|14)/' }).Count -eq 0)
    Yes '#13, the done-on-merge comment on the second page: found and closed' (
        @($r.Calls | Where-Object { $_ -like ((Page 13 2) + '*') }).Count -eq 1 -and @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/13 *" }).Count -eq 1)
    $c16 = @($w | Where-Object { $_ -like "POST repos/$Slug/issues/16/comments *" })
    Yes '#16, moved by hand with a Fixed by line and a test task: one comment holding exactly its block, then closed' (
        $c16.Count -eq 1 -and ($c16[0].Substring($c16[0].IndexOf('{')) | ConvertFrom-Json).body -ceq $handTask -and
        @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/16 *" -and $_ -match '"state":"closed"' }).Count -eq 1)
    Yes '#17, a Fixed by line saying no test task: closed with no comment' (
        @($w | Where-Object { $_ -like "POST repos/$Slug/issues/17/comments *" }).Count -eq 0 -and
        @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/17 *" -and $_ -match '"state":"closed"' }).Count -eq 1 -and $r.Out -match '#17: closed.*it needs no test task')
    Yes '#18, a Fixed by line naming a merge after the release: stays open, said' (@($w | Where-Object { $_ -match '/issues/18[ /]' }).Count -eq 0 -and $r.Out -match "#18: stays open, pull request #3322's merge")
    $c20 = @($w | Where-Object { $_ -like "POST repos/$Slug/issues/20/comments *" })
    Yes '#20, a newer Fixed by line than the done-on-merge comment: the Fixed by line stands, closed with its block' (
        $c20.Count -eq 1 -and ($c20[0].Substring($c20[0].IndexOf('{')) | ConvertFrom-Json).body -ceq $handTask -and
        @($w | Where-Object { $_ -like "PATCH repos/$Slug/issues/20 *" }).Count -eq 1)
    Yes '#21, a newer done-on-merge comment than the Fixed by line: it stands, and its merge is not in the release' (@($w | Where-Object { $_ -match '/issues/21[ /]' }).Count -eq 0 -and $r.Out -match "#21: stays open, pull request #3326's merge")
    Yes '  and nothing else was written' ($w.Count -eq 15)
    Yes '  every call carries the token gh is signed in with' ($r.Calls.Count -gt 0 -and @($r.Calls | Where-Object { $_ -notmatch ' Bearer test-token' }).Count -eq 0)
    Yes '  the summary names what closed' ($r.Out -match 'Closed \(9\): #1 #6 #7 #10 #13 #15 #16 #17 #20')

    # ---- 6: -Check -----------------------------------------------------------
    $r = Run @('-Check') $answers
    Yes ("-Check writes nothing and passes (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Writes.Count -eq 0)
    Yes '  and says what it would close' ($r.Out -match 'Would close \(9\): #1 #6 #7 #10 #13 #15 #16 #17 #20' -and $r.Out -match '#1: would close' -and $r.Out -match '#17: would close.*with no test task')

    # ---- 7: a refused close ----------------------------------------------------
    $r = Run @() $answers @("PATCH repos/$Slug/issues/6")
    Yes ("a refused close stops the run (exit {0})" -f $r.Code) ($r.Code -eq 1)
    Yes '  names the issue and what GitHub said' ($r.Out -match '#6: GitHub answered PATCH' -and $r.Out -match '403' -and $r.Out -match 'Stopped, the lines above say why \(1\): #6')
    Yes '  prints the command that runs it again' ($r.Out -match [regex]::Escape(".\scripts\release\Close-ShippedIssues.ps1 -Commit $script:shipped"))
    Yes '  and still closes the others' (@($r.Writes | Where-Object { $_ -like "PATCH repos/$Slug/issues/1 *" -or $_ -like "PATCH repos/$Slug/issues/13 *" }).Count -eq 2)

    # ---- 9: a Fixed by line with neither a block nor the no-task line ----------
    $keepBoard = $script:boardFile
    $script:boardFile = Join-Path $work 'board-19.json'
    [IO.File]::WriteAllText($script:boardFile, ([ordered]@{ read_at = '2026-10-22T13:41:52Z'; items = @((Card 19), (Card 1)) } | ConvertTo-Json -Depth 6))
    $r = Run @() @{ (Page 19) = @((Hand $mergeA 3327 'Moved to Done.')); (Page 1) = $answers[(Page 1)] }
    Yes ("#19, a Fixed by line with no test task and no no-task line: a stop (exit {0})" -f $r.Code) (
        $r.Code -eq 1 -and @($r.Writes | Where-Object { $_ -match '/issues/19[ /]' }).Count -eq 0 -and $r.Out -match '#19: the Fixed by line naming pull request #3327 holds no Test task' -and $r.Out -match 'Stopped, the lines above say why \(1\): #19')
    Yes '  and #1 beside it is still closed' (@($r.Writes | Where-Object { $_ -like "PATCH repos/$Slug/issues/1 *" }).Count -eq 1)
    $script:boardFile = $keepBoard

    # ---- 10: a merge this checkout does not hold -------------------------------
    $script:boardFile = Join-Path $work 'board-9.json'
    [IO.File]::WriteAllText($script:boardFile, ([ordered]@{ read_at = '2026-10-22T13:41:52Z'; items = @((Card 9), (Card 1)) } | ConvertTo-Json -Depth 6))
    $gone = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    $cmp = "GET repos/$Slug/compare/$($gone.Substring(0, 12))...main?per_page=1"
    $nine = @{ (Page 9) = @((Robot $gone 3328)); (Page 1) = $answers[(Page 1)] }
    $r = Run @() ($nine + @{ $cmp = @{ status = 'ahead' } })
    Yes ("#9, a merge GitHub has on main that this checkout does not hold: stays open (exit {0})" -f $r.Code) (
        $r.Code -eq 0 -and @($r.Writes | Where-Object { $_ -match '/issues/9[ /]' }).Count -eq 0 -and $r.Out -match "#9: stays open, pull request #3328's merge" -and
        @($r.Calls | Where-Object { $_ -like "$cmp *" }).Count -eq 1)
    $r = Run @() ($nine + @{ $cmp = @{ status = 'diverged' } })
    Yes ("#9, a merge that is not on main, as after a history rewrite: a stop (exit {0})" -f $r.Code) (
        $r.Code -eq 1 -and @($r.Writes | Where-Object { $_ -match '/issues/9[ /]' }).Count -eq 0 -and
        $r.Out -match "#9: the done-on-merge comment for pull request #3328 names merge deadbeefdead, which is not on main \(GitHub says main and it have diverged\)" -and
        $r.Out -match 'Stopped, the lines above say why \(1\): #9')
    Yes '  and #1 beside it is still closed' (@($r.Writes | Where-Object { $_ -like "PATCH repos/$Slug/issues/1 *" }).Count -eq 1)
    $r = Run @() $nine @($cmp)
    Yes ("#9, a merge GitHub does not know: a stop that says what GitHub answered (exit {0})" -f $r.Code) (
        $r.Code -eq 1 -and @($r.Writes | Where-Object { $_ -match '/issues/9[ /]' }).Count -eq 0 -and $r.Out -match '#9: .*which is not on main \(GitHub answered GET .*403')
    $script:boardFile = $keepBoard

    # ---- 11: a dev release (-Dev, #5199) ---------------------------------------
    # #10's Dev block is carried and has only a Main test task after it, so it
    # is written with its Build: line set to the release; #15's has a newer
    # Dev one, so nothing; #2's merge is not carried; Main blocks wait; and
    # nothing is closed.
    $r = Run @('-Dev', '-Build', '20261101-020000-dev') $answers
    $w = $r.Writes
    $want = $devBlock.Replace('Build: 20261022-063057-dev', ('Build: dev release 20261101-020000-dev, from ' + $script:shipped.Substring(0, 12)))
    $c10 = @($w | Where-Object { $_ -like "POST repos/$Slug/issues/10/comments *" })
    Yes ("a dev release passes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  #10''s carried Dev block is written, its Build: line naming the dev release' ($c10.Count -eq 1 -and ($c10[0].Substring($c10[0].IndexOf('{')) | ConvertFrom-Json).body -ceq $want)
    Yes '  and that is the only write: no close, no Main block, nothing for #15''s newer Dev one or #2''s later merge' ($w.Count -eq 1 -and @($w | Where-Object { $_ -match '^PATCH ' }).Count -eq 0)
    Yes '  saying which are for main and which are already there' ($r.Out -match '#1: its test task is for main' -and $r.Out -match '#15: its Dev test task is already written after the merge')
    $r = Run @('-Dev', '-Build', '20261101-020000-dev', '-Check') $answers
    Yes '  with -Check it writes nothing and says what it would' ($r.Code -eq 0 -and $r.Writes.Count -eq 0 -and $r.Out -match '#10: would write its Dev test task, Build: dev release 20261101-020000-dev')
    $r = Run @('-Dev') $answers
    Yes '  with no -Build it stops before anything is read' ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'named with -Build')
    # A Dev block with no Build: line gets one under its Server line.
    $keepBoard = $script:boardFile
    $script:boardFile = Join-Path $work 'board-22.json'
    [IO.File]::WriteAllText($script:boardFile, ([ordered]@{ read_at = '2026-11-01T02:00:00Z'; items = @((Card 22)) } | ConvertTo-Json -Depth 6))
    $bare = "Test task: Measure the bellows`nServer: Dev`n1. Read the log for bellows: lines."
    $r = Run @('-Dev', '-Build', '20261101-020000-dev') @{ (Page 22) = @((Robot $mergeA 3330 'github-actions[bot]' $bare)) }
    $c22 = @($r.Writes | Where-Object { $_ -like "POST repos/$Slug/issues/22/comments *" })
    Yes '  a Dev block with no Build: line gets one under its Server line' ($c22.Count -eq 1 -and ($c22[0].Substring($c22[0].IndexOf('{')) | ConvertFrom-Json).body -ceq ("Test task: Measure the bellows`nServer: Dev`nBuild: dev release 20261101-020000-dev, from " + $script:shipped.Substring(0, 12) + "`n1. Read the log for bellows: lines."))
    $script:boardFile = $keepBoard

    # ---- 8: what stops before anything is read -------------------------------
    $r = Run @() $answers @() 'f00df00df00df00df00df00df00df00df00df00d'
    Yes ("a commit the checkout does not hold stops before anything is read (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'is not in')
    $shallow = Join-Path $work 'shallow'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $null = & git clone -q --depth 1 ('file:///' + ($git -replace '\\', '/').TrimStart('/')) $shallow 2>&1 } finally { $ErrorActionPreference = $old }
    $r = Run @() $answers @() 'HEAD' $shallow
    Yes ("a shallow checkout stops before anything is read (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'shallow')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
