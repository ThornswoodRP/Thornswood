<#
  test-3192-board-hygiene.ps1

  The three workflows that keep the board true without anybody remembering to:
  expire-claims.yml (#2797), done-on-merge.yml (#2796) and area-label.yml
  (#2798).

  WHY THIS EXISTS. Issue #3192, the board review of 21 Oct 2026, found the
  board drifting in three ways nothing stopped: claims nobody was working,
  Refs fixes left in In Progress after they merged, and issues with no area
  at all. Patrick approved a cause fix for each on the review page.

  First, that the real Invoke-RestMethod hands a JSON array on as one object,
  as the stand-in below does (#2798). Then, for each workflow:
    1. what starts it, its token's grants, GitHub's runner, a timeout, no
       action and nothing checked out, and no ${{ }} inside its script;
    2. its script, lifted out and run in a child PowerShell with a stand-in
       Invoke-RestMethod that answers from a table and writes down every call:
       expire-claims takes off a claim with nothing for three days and
       comments first, keeps one with a fresh comment, a fresh claim or an
       open pull request moved today, and passes over a label already off,
       a Hermes Bot's claimed label the same as anybody's (#4715);
       done-on-merge writes the test task of a merged pull request on its
       issue (its card follows by itself through board.yml, #5185) in a fenced
       block, and leaves alone a Refs with no test task, a closed issue and a
       pull request number; area-label puts on the one area a title names,
       "area: triage" for none or two, and makes that label when it is missing.

  It never reaches GitHub. Files under its own temp folder only.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Flows = Join-Path $Repo '.github\workflows'

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

function Read-Flow([string]$name) {
    $p = Join-Path $Flows $name
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    $text = [IO.File]::ReadAllText($p) -replace "`r`n", "`n"
    $run = [regex]::Match($text, '(?ms)^(\s+)run: \|\n(.*)$')
    $script = ''
    if ($run.Success) {
        $lines = $run.Groups[2].Value -split "`n"
        $indent = [regex]::Match($lines[0], '^\s*').Value
        $body = @()
        foreach ($l in $lines) {
            if ($l.Trim().Length -and -not $l.StartsWith($indent)) { break }
            $body += $(if ($l.Length -ge $indent.Length) { $l.Substring($indent.Length) } else { '' })
        }
        $script = ($body -join "`n").TrimEnd() + "`n"
    }
    $perm = [regex]::Match($text, '(?ms)^permissions:\n(.*?)^\S').Groups[1].Value
    $grants = @([regex]::Matches($perm, '(?m)^\s+([a-z-]+):\s*(\S+)') | ForEach-Object { $_.Groups[1].Value + ': ' + $_.Groups[2].Value } | Sort-Object)
    return [pscustomobject]@{
        Text = $text; Script = $script; Grants = ($grants -join ', ')
        On = [regex]::Match($text, '(?ms)^on:\n(.*?)^\S').Groups[1].Value
        RunsOn = [regex]::Match($text, '(?m)^\s*runs-on:\s*(.+)$').Groups[1].Value.Trim()
        Runs = @([regex]::Matches($text, '(?m)^\s+run:')).Count
    }
}
function Shape([string]$name, $f, [string]$grants) {
    Yes "$name is there" ($null -ne $f)
    if ($null -eq $f) { return }
    Yes ("  its token can do only what it needs ({0})" -f $f.Grants) ($f.Grants -eq $grants)
    Yes '  and no job widens it' (@([regex]::Matches($f.Text, '(?m)^\s{2,}permissions:')).Count -eq 0)
    # GitHub's runners are free on a public repository and no VPS runner is
    # registered to it (#3685, #4983).
    Yes ("  it runs on GitHub's Windows runner (#4983) ({0})" -f $f.RunsOn) ($f.RunsOn -eq 'windows-latest')
    Yes '  with a timeout' ($f.Text -match '(?m)^\s+timeout-minutes:\s*\d+\s*$')
    Yes '  it checks out nothing and runs no action' ($f.Text -notmatch '(?m)^\s*(-\s+)?uses:')
    Yes '  it has one script, under pwsh, with no ${{ }} inside it' ($f.Runs -eq 1 -and $f.Script.Length -gt 0 -and $f.Script -notmatch '\$\{\{' -and $f.Text -match '(?m)^\s+shell:\s*pwsh\s*$')
    Yes '  it runs on no pull request event' ($f.On -notmatch 'pull_request')
}

$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)
Yes 'pwsh is on this machine to run the scripts with' ($null -ne $pwsh)
if (-not $pwsh) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-board-hygiene-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$calls = Join-Path $work 'calls.txt'
$routes = Join-Path $work 'routes.json'
# The real Invoke-RestMethod hands a JSON array on as ONE object, not an item
# at a time, so @(Invoke-RestMethod ...) is a list of one whatever the page
# holds. The stand-in below has to answer the same way, or a script that
# reads a page wrong passes here and fails on the runner: area-label.yml
# started by hand found "0 issue(s) with no area label" with 145 open, and
# done-on-merge.yml found no pull request behind any merge (#2798, #3273).
# So the real one is asked once, of a server on this machine, and the
# stand-in is held to what it does.
# A plain TCP listener on a port the system picks, so it needs no URL
# reservation on Windows and never meets a port already taken.
$listen = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listen.Start()
$port = $listen.LocalEndpoint.Port
try {
    $serve = Start-ThreadJob -ArgumentList $listen -ScriptBlock {
        param($l)
        foreach ($answer in @('[{"number":1},{"number":2}]', '[]')) {
            $c = $l.AcceptTcpClient()
            $s = $c.GetStream()
            $r = [IO.StreamReader]::new($s)
            while ($r.ReadLine()) { }
            $b = [Text.Encoding]::UTF8.GetBytes($answer)
            $head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: application/json`r`nContent-Length: $($b.Length)`r`nConnection: close`r`n`r`n")
            $s.Write($head, 0, $head.Length)
            $s.Write($b, 0, $b.Length)
            $s.Flush()
            $c.Close()
        }
    }
    $two = @(Microsoft.PowerShell.Utility\Invoke-RestMethod -Uri "http://127.0.0.1:$port/two" -NoProxy -TimeoutSec 10)
    $none = @(Microsoft.PowerShell.Utility\Invoke-RestMethod -Uri "http://127.0.0.1:$port/none" -NoProxy -TimeoutSec 10)
    $serve | Wait-Job -Timeout 10 | Remove-Job -Force
} finally { $listen.Stop() }
Yes ('the real Invoke-RestMethod hands a JSON array of two on as one object, so @() of it holds {0}' -f $two.Count) ($two.Count -eq 1 -and $two[0] -is [array] -and $two[0].Count -eq 2)
Yes '  and an empty one the same way' ($none.Count -eq 1 -and $none[0] -is [array] -and $none[0].Count -eq 0)

# Defined before the script, so the script's Invoke-RestMethod is this one.
# It answers a GET from the table by its address (everything after the
# repository), 404 for an address the table marks so, and an empty list for
# anything else; a list goes back as one object, the way the real one does
# (checked above). It writes down every call, with its token and body.
$standIn = @'
function Invoke-RestMethod {
    param([string]$Method = 'Get', [string]$Uri, [hashtable]$Headers, $Body, [string]$ContentType)
    $tail = $Uri -replace '^https://api\.github\.com/repos/[^/]+/[^/]+', ''
    [IO.File]::AppendAllText($env:TS_CALLS, ($Method.ToUpperInvariant() + ' ' + $tail + ' ' + $Headers['Authorization'] + ' ' + [string]$Body) + "`n")
    $t = Get-Content -LiteralPath $env:TS_ROUTES -Raw | ConvertFrom-Json
    $key = $Method.ToUpperInvariant() + ' ' + $tail
    if ($t.PSObject.Properties['404'] -and @($t.'404') -contains $key) {
        $res = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]::NotFound)
        throw [Microsoft.PowerShell.Commands.HttpResponseException]::new('Response status code does not indicate success.', $res)
    }
    if ($t.PSObject.Properties[$key]) { $v = $t.$key; if ($v -is [array]) { return ,$v }; return $v }
    if ($Method -eq 'Get') { return ,@() }
    return [pscustomobject]@{}
}

'@
function Run-Flow($f, [hashtable]$table, [hashtable]$envs) {
    Remove-Item -LiteralPath $calls -Force -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($routes, ($table | ConvertTo-Json -Depth 12))
    $runner = Join-Path $work 'flow.ps1'
    [IO.File]::WriteAllText($runner, $standIn + $f.Script)
    $keep = @{}
    $all = @{ GITHUB_REPOSITORY = 'ThornswoodRP/Thornswood'; GH_TOKEN = 'run-token'; TS_CALLS = $calls; TS_ROUTES = $routes } + $envs
    foreach ($k in $all.Keys) { $keep[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, [string]$all[$k]) }
    try {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $out = & $pwsh.Source -NoProfile -NonInteractive -File $runner 2>&1 | Out-String; $code = $LASTEXITCODE }
        finally { $ErrorActionPreference = $old }
    } finally {
        foreach ($k in $keep.Keys) { [Environment]::SetEnvironmentVariable($k, $keep[$k]) }
    }
    $made = @()
    if (Test-Path -LiteralPath $calls) { $made = @(Get-Content -LiteralPath $calls | Where-Object { $_ -and $_ -notmatch '^GET ' }) }
    return [pscustomobject]@{ Code = $code; Out = $out; Writes = $made }
}
function Ago([double]$days) { return [DateTime]::UtcNow.AddDays(-$days).ToString('yyyy-MM-ddTHH:mm:ssZ') }

try {
    # ---- expire-claims.yml ---------------------------------------------------
    $f = Read-Flow 'expire-claims.yml'
    Shape 'expire-claims.yml' $f 'issues: write'
    if ($f) {
        Yes '  it runs once a night and by hand, and on nothing else' ($f.On -match '(?m)^\s+schedule:' -and $f.On -match "cron: '\d+ \d+ \* \* \*'" -and $f.On -match '(?m)^\s+workflow_dispatch:' -and @([regex]::Matches($f.On, '(?m)^  [a-z_]+:')).Count -eq 2)
        $claim = @(@{ name = 'claimed: Claude' }, @{ name = 'area: Launcher' })
        $table = @{
            'GET /issues?state=open&per_page=100&page=1' = @(
                @{ number = 11; created_at = (Ago 30); labels = $claim },
                @{ number = 12; created_at = (Ago 30); labels = $claim },
                @{ number = 13; created_at = (Ago 30); labels = @(@{ name = 'claimed: Codex' }) },
                @{ number = 14; created_at = (Ago 30); labels = $claim },
                @{ number = 15; created_at = (Ago 30); labels = @(@{ name = 'area: Site' }) },
                @{ number = 16; created_at = (Ago 30); labels = $claim; pull_request = @{ url = 'x' } },
                @{ number = 17; created_at = (Ago 30); labels = @(@{ name = 'claimed: Claude' }, @{ name = 'claimed:GitHub' }) },
                @{ number = 18; created_at = (Ago 30); labels = @(@{ name = 'claimed: Wisp' }) },
                @{ number = 19; created_at = (Ago 30); labels = @(@{ name = 'claimed: Sprocket' }) })
            'GET /issues/11/timeline?per_page=100&page=1' = @(
                @{ event = 'labeled'; created_at = (Ago 9); label = @{ name = 'claimed: Claude' } },
                @{ event = 'commented'; created_at = (Ago 5) })
            'GET /issues/12/timeline?per_page=100&page=1' = @(
                @{ event = 'labeled'; created_at = (Ago 9); label = @{ name = 'claimed: Claude' } },
                @{ event = 'commented'; created_at = (Ago 1) })
            'GET /issues/13/timeline?per_page=100&page=1' = @(
                @{ event = 'labeled'; created_at = (Ago 10); label = @{ name = 'area: x' } },
                @{ event = 'labeled'; created_at = (Ago 2); label = @{ name = 'claimed: Codex' } })
            'GET /issues/14/timeline?per_page=100&page=1' = @(
                @{ event = 'labeled'; created_at = (Ago 9); label = @{ name = 'claimed: Claude' } },
                @{ event = 'cross-referenced'; created_at = (Ago 8); source = @{ issue = @{ number = 99; state = 'open'; updated_at = (Ago 0.2); pull_request = @{ url = 'x' } } } })
            'GET /issues/17/timeline?per_page=100&page=1' = @(
                @{ event = 'referenced'; created_at = (Ago 4) })
            # A Hermes Bot's claim (#4715): the same three days as anybody's.
            'GET /issues/18/timeline?per_page=100&page=1' = @(
                @{ event = 'labeled'; created_at = (Ago 5); label = @{ name = 'claimed: Wisp' } })
            'GET /issues/19/timeline?per_page=100&page=1' = @(
                @{ event = 'labeled'; created_at = (Ago 1); label = @{ name = 'claimed: Sprocket' } })
            '404' = @('DELETE /issues/17/labels/claimed%3AGitHub')
        }
        $r = Run-Flow $f $table @{ CLAIM_DAYS = '3' }
        $w = $r.Writes
        Yes ("the run passes (exit {0})" -f $r.Code) ($r.Code -eq 0)
        Yes '  #11, a comment 5 days ago: a comment, then its claim comes off' (
            @($w | Where-Object { $_ -like 'POST /issues/11/comments *' }).Count -eq 1 -and @($w | Where-Object { $_ -like 'DELETE /issues/11/labels/claimed%3A%20Claude *' }).Count -eq 1 -and
            [array]::IndexOf($w, @($w | Where-Object { $_ -like 'POST /issues/11/comments *' })[0]) -lt [array]::IndexOf($w, @($w | Where-Object { $_ -like 'DELETE /issues/11/*' })[0]))
        Yes '  the comment names the claim, the date and the rule' (@($w | Where-Object { $_ -like 'POST /issues/11/comments *' -and $_ -match 'claimed: Claude' -and $_ -match '#2797' -and $_ -match 'a comment' }).Count -eq 1)
        Yes '  #12, a comment yesterday: kept' (@($w | Where-Object { $_ -match '/issues/12/' }).Count -eq 0 -and $r.Out -match '#12: kept')
        Yes '  #13, claimed two days ago: kept' (@($w | Where-Object { $_ -match '/issues/13/' }).Count -eq 0)
        Yes '  #14, an open pull request naming it moved today: kept' (@($w | Where-Object { $_ -match '/issues/14/' }).Count -eq 0 -and $r.Out -match '#14: kept .*open pull request #99')
        Yes '  #15, no claim: not read at all, and #16, a pull request: passed over' (@($w | Where-Object { $_ -match '/issues/1[56]/' }).Count -eq 0)
        Yes '  #17, two claims: both asked off, one already off said and passed over' (
            @($w | Where-Object { $_ -like 'DELETE /issues/17/labels/*' }).Count -eq 2 -and $r.Out -match 'claimed:GitHub was already off')
        Yes '  #18, a Bot''s claim with nothing for 5 days: a comment, then claimed: Wisp comes off' (
            @($w | Where-Object { $_ -like 'POST /issues/18/comments *' -and $_ -match 'claimed: Wisp' }).Count -eq 1 -and @($w | Where-Object { $_ -like 'DELETE /issues/18/labels/claimed%3A%20Wisp *' }).Count -eq 1)
        Yes '  #19, a Bot claimed it yesterday: kept' (@($w | Where-Object { $_ -match '/issues/19/' }).Count -eq 0 -and $r.Out -match '#19: kept')
        Yes '  every write uses the run''s own token' (@($w | Where-Object { $_ -notmatch 'Bearer run-token' }).Count -eq 0)
    }

    # ---- done-on-merge.yml ---------------------------------------------------
    $f = Read-Flow 'done-on-merge.yml'
    Shape 'done-on-merge.yml' $f 'contents: read, issues: write, pull-requests: read'
    if ($f) {
        Yes '  it runs on a push to main and by hand, and on nothing else' ($f.On -match '(?m)^\s+push:\s*$' -and $f.On -match 'branches:\s*\[\s*main\s*\]' -and $f.On -match '(?m)^\s+workflow_dispatch:' -and @([regex]::Matches($f.On, '(?m)^  [a-z_]+:')).Count -eq 2)
        Yes '  with no environment and no secret since #5185 (board.yml moves the card), the commits and the merges started by hand through the environment' ($f.Text -notmatch '(?m)^\s+environment:' -and $f.Text -notmatch 'secrets\.' -and $f.Text -match [regex]::Escape('COMMITS: ${{ toJSON(github.event.commits.*.id) }}') -and $f.Text -match [regex]::Escape('MERGES: ${{ inputs.merges }}'))
        $body = "## What changed`n`nThe forge lists only what you can make. Refs #613, Refs #700.`n`nTest task for #613: Forge lists only what you can make`nServer: Main`n`n1. Open a forge.`n2. Look.`n`nWhat should happen: nothing a smith makes.`n`nTest task for #614: Closed one`n1. x`nTest task for #615: A pull request`n1. y`n`n## Checked`n`nharness`n`n" + [char]0xD83E + [char]0xDD16 + ' Generated with Claude Code'
        $table = @{
            'GET /commits/aaa/pulls' = @(@{ number = 3300; merged_at = (Ago 0); base = @{ ref = 'main' }; merge_commit_sha = '0123456789abcdef'; body = $body })
            'GET /commits/bbb/pulls' = @(@{ number = 3300; merged_at = (Ago 0); base = @{ ref = 'main' }; merge_commit_sha = '0123456789abcdef'; body = $body })
            'GET /commits/ccc/pulls' = @(@{ number = 3301; merged_at = (Ago 0); base = @{ ref = 'main' }; merge_commit_sha = 'fedcba9876543210'; body = "Refs #613 only, no test task." })
            'GET /issues/613' = @{ number = 613; state = 'open' }
            'GET /issues/614' = @{ number = 614; state = 'closed' }
            'GET /issues/615' = @{ number = 615; state = 'open'; pull_request = @{ url = 'x' } }
        }
        $r = Run-Flow $f $table @{ BOARD_TOKEN = 'board-token'; COMMITS = '["aaa","bbb","ccc"]' }
        $w = $r.Writes
        Yes ("the run passes (exit {0})" -f $r.Code) ($r.Code -eq 0)
        Yes '  #613 gets no label: its card follows the merged test task by itself (#5185)' (@($w | Where-Object { $_ -like 'POST /issues/613/labels *' }).Count -eq 0)
        $c = @($w | Where-Object { $_ -like 'POST /issues/613/comments *' })
        Yes '  and one comment, with the run''s token, holding the test task in a fenced block' ($c.Count -eq 1 -and $c[0] -match 'Bearer run-token' -and $c[0] -match '```\\nTest task: Forge lists only what you can make\\nServer: Main' -and $c[0] -match 'What should happen: nothing a smith makes\.\\n```')
        Yes '  the comment says the issue stays open until a main Ship, not the merge (#2796)' ($c.Count -eq 1 -and $c[0] -match 'stays open' -and $c[0] -match 'The main Ship that carries it closes this issue' -and $c[0] -match 'Close-ShippedIssues\.ps1' -and $c[0] -notmatch 'When it is on main')
        Yes '  the block stops at the next test task, a heading and the footer' ($c.Count -eq 1 -and $c[0] -notmatch 'Closed one' -and $c[0] -notmatch 'harness' -and $c[0] -notmatch 'Generated')
        Yes '  two commits of one pull request move it once' ($c.Count -eq 1)
        Yes '  a closed issue and a pull request number are passed over, said' (@($w | Where-Object { $_ -match '/issues/61[45]/' }).Count -eq 0 -and $r.Out -match '#614, which is closed' -and $r.Out -match '#615, which is a pull request')
        Yes '  Refs with no test task moves nothing' ($r.Out -match '#3301: no test task')
        Yes '  #700, named only by Refs, is not touched' (@($w | Where-Object { $_ -match '/issues/700/' }).Count -eq 0)

        $dev = "Refs #616.`n`nTest task for #616: A forged number is refused`nServer: Dev`nBuild: dev release 20261022-070758-dev`n1. Edit the number.`nWhat should happen: refused."
        $r = Run-Flow $f @{ 'GET /commits/eee/pulls' = @(@{ number = 3302; merged_at = (Ago 0); base = @{ ref = 'main' }; merge_commit_sha = 'abcdef0123456789'; body = $dev }); 'GET /issues/616' = @{ number = 616; state = 'open' } } @{ BOARD_TOKEN = 'board-token'; COMMITS = '["eee"]' }
        $c = @($r.Writes | Where-Object { $_ -like 'POST /issues/616/comments *' })
        Yes '  a Dev test task''s comment says the dev Ship that carries it writes it, and that the main Ship closes the issue (#5199)' ($c.Count -eq 1 -and $c[0] -match 'The dev Ship that carries it writes it on this issue with its Build: line naming that release' -and $c[0] -match 'dev-test-tasks' -and $c[0] -match 'Close-ShippedIssues\.ps1 -Dev' -and $c[0] -match 'The main Ship that carries it closes this issue, and writes this on it if nobody has' -and $c[0] -match 'Server: Dev\\nBuild: dev release')

        # A merge the push run missed (#1626, #3273), started by hand.
        $seen = @{ user = @{ login = 'github-actions[bot]' }; body = 'Pull request #3300 merged (0123456789ab), so this is in Done and stays open: ...' }
        $other = @{ user = @{ login = 'EvilPatrick06' }; body = 'Pull request #3300 merged (0123456789ab), moved by hand' }
        $byHand = $table + @{ 'GET /commits/aaaaaaa/pulls' = $table['GET /commits/aaa/pulls']; 'GET /commits/ccccccc/pulls' = $table['GET /commits/ccc/pulls'] }
        $r = Run-Flow $f ($byHand + @{ 'GET /issues/613/comments?per_page=100&page=1' = @($other) }) @{ BOARD_TOKEN = 'board-token'; COMMITS = '[]'; MERGES = ' aaaaaaa  ccccccc ' }
        $c = @($r.Writes | Where-Object { $_ -like 'POST /issues/613/comments *' })
        Yes ("started by hand with merges, it moves what those merges finish, like the push would have (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $c.Count -eq 1 -and $c[0] -match 'Pull request #3300 merged \(0123456789ab\)' -and @($r.Writes | Where-Object { $_ -like 'POST /issues/613/labels *' }).Count -eq 0)
        Yes '  a person''s comment of the same shape does not count as done-on-merge''s' ($c.Count -eq 1)
        $r = Run-Flow $f ($byHand + @{ 'GET /issues/613/comments?per_page=100&page=1' = @($other, $seen) }) @{ BOARD_TOKEN = 'board-token'; COMMITS = '[]'; MERGES = 'aaaaaaa' }
        Yes ("  an issue already holding its done-on-merge comment is said and passed over, nothing written (exit {0})" -f $r.Code) ($r.Code -eq 0 -and @($r.Writes | Where-Object { $_ -match '/issues/613/' }).Count -eq 0 -and $r.Out -match '#613, which already holds its done-on-merge comment')
        $r = Run-Flow $f $table @{ BOARD_TOKEN = 'board-token'; COMMITS = '[]'; MERGES = 'aaaaaaa main;rm' }
        Yes ("  anything in merges that is not a commit fails the run before a call (exit {0})" -f $r.Code) ($r.Code -ne 0 -and $r.Writes.Count -eq 0 -and $r.Out -match 'is not a commit')

        $r = Run-Flow $f @{ 'GET /commits/ddd/pulls' = @() } @{ BOARD_TOKEN = ''; COMMITS = '["ddd"]' }
        Yes ("a push with no merged pull request behind it does nothing and passes (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Writes.Count -eq 0)
        Yes ("  and the workflow names no board token at all (#5185)") ($f.Text -notmatch 'BOARD_TOKEN')
    }

    # ---- area-label.yml ------------------------------------------------------
    $f = Read-Flow 'area-label.yml'
    Shape 'area-label.yml' $f 'issues: write'
    if ($f) {
        Yes '  it runs when an issue is opened and by hand, and on nothing else' ($f.On -match 'types:\s*\[\s*opened\s*\]' -and $f.On -match '(?m)^\s+workflow_dispatch:' -and @([regex]::Matches($f.On, '(?m)^  [a-z_]+:')).Count -eq 2)
        Yes '  only for an issue with no area label' ($f.Text -match [regex]::Escape("!contains(join(github.event.issue.labels.*.name, '|'), 'area:')"))
        Yes '  the title comes in through the environment' ($f.Text -match [regex]::Escape('TITLE: ${{ github.event.issue.title }}'))
        $cases = @(
            @{ t = 'Launcher says Steam is running when it is not'; want = 'area: Launcher' },
            @{ t = 'Turn on DNSSEC for thornswood.net'; want = 'area: triage' },
            @{ t = 'Organize the crafting tables into better categories'; want = 'area: In-game' },
            @{ t = 'Courier parcels at an inn'; want = 'area: triage' },
            @{ t = 'The bot cannot post the join card'; want = 'area: Discord' })
        foreach ($k in $cases) {
            $r = Run-Flow $f @{ 'GET /labels/area%3A%20triage' = @{ name = 'area: triage' } } @{ EVENT = 'issues'; ISSUE = '900'; TITLE = $k.t }
            Yes ("'{0}' gets {1}" -f $k.t, $k.want) ($r.Code -eq 0 -and @($r.Writes | Where-Object { $_ -like 'POST /issues/900/labels *' -and $_ -match [regex]::Escape('"' + $k.want + '"') }).Count -eq 1 -and @($r.Writes).Count -eq 1)
        }
        $r = Run-Flow $f @{ '404' = @('GET /labels/area%3A%20triage') } @{ EVENT = 'issues'; ISSUE = '901'; TITLE = 'Something nobody can place' }
        Yes 'area: triage is made when it is missing, then put on' ($r.Code -eq 0 -and $r.Writes.Count -eq 2 -and $r.Writes[0] -like 'POST /labels *' -and $r.Writes[0] -match 'area: triage' -and $r.Writes[1] -like 'POST /issues/901/labels *')
        $table = @{ 'GET /issues?state=open&per_page=100&page=1' = @(
            @{ number = 1; title = 'Voice position feed runs five times a second'; labels = @() },
            @{ number = 2; title = 'Launcher thing'; labels = @(@{ name = 'area: Launcher' }) },
            @{ number = 3; title = 'Unplaceable'; labels = @(@{ name = 'Dev Findings' }) },
            @{ number = 4; title = 'Launcher PR'; labels = @(); pull_request = @{ url = 'x' } })
            'GET /labels/area%3A%20triage' = @{ name = 'area: triage' } }
        $r = Run-Flow $f $table @{ EVENT = 'workflow_dispatch'; ISSUE = ''; TITLE = '' }
        Yes 'started by hand, every open issue with no area gets one, and the others are left alone' (
            $r.Code -eq 0 -and $r.Writes.Count -eq 2 -and @($r.Writes | Where-Object { $_ -like 'POST /issues/1/labels *' -and $_ -match 'area: Voice' }).Count -eq 1 -and @($r.Writes | Where-Object { $_ -like 'POST /issues/3/labels *' -and $_ -match 'area: triage' }).Count -eq 1)
    }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
