<#
  test-3534-check-board.ps1

      pwsh -NoProfile -File .\tests\test-3534-check-board.ps1

  WHY THIS EXISTS. Issue #3534. The weekly review listed the board's Order
  under "Could not read", and nothing said what a right Order is. Read on
  26 Oct 2026, 315 of the 331 open issues had none. scripts\ops\Check-Board.ps1
  holds a board.json from Read-Board.ps1 to Developer-Guide.md's board rules.

  What it checks, against boards made here:
    1. a board that keeps every rule names nothing and exits 0;
    2. an open issue with no Order, two open cards sharing one, an open card
       with no Status, a closed issue not in Done, Status options other than
       Todo, In Progress and Done, Auto-close on, and an open issue with no
       card are each named under their rule, and it exits 3; Auto-add to
       project is no longer read, since board.yml adds every card (#5185);
    3. an archived card and an open pull request with no Order are left out;
       an issue made after the board was read is not called missing;
    4. it stops (exit 1) on no file, a file that is not a board, and issue
       numbers that are not numbers.

  Nothing connects anywhere. Everything it writes is in its own temp folder.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

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

$check = Join-Path $repo 'scripts/ops/Check-Board.ps1'
Yes 'Check-Board.ps1 is there' (Test-Path -LiteralPath $check)
if (-not (Test-Path -LiteralPath $check)) { Done }
$e = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($check, [ref]$null, [ref]$e)
Yes 'it parses' (@($e).Count -eq 0)

function Card([int]$n, [string]$state, [string]$status, $order, [string]$kind = 'Issue', [bool]$archived = $false) {
    [ordered]@{ repo = 'ThornswoodRP/Thornswood'; number = $n; kind = $kind; title = "card $n"; state = $state; status = $status; order = $order; archived = $archived }
}
function Board($items, $statuses = @('Todo', 'In Progress', 'Done'), $addOn = $true, $closeOn = $false) {
    [ordered]@{
        read_at = '2026-10-26T17:41:23Z'
        board = [ordered]@{ owner = 'ThornswoodRP'; number = 3 }
        statuses = $statuses
        workflows = @([ordered]@{ name = 'Auto-add to project'; enabled = $addOn }, [ordered]@{ name = 'Auto-close issue'; enabled = $closeOn }, [ordered]@{ name = 'Item closed'; enabled = $true })
        items = @($items)
    }
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-3534b-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
function Run($board, [string[]]$issues) {
    $bf = Join-Path $tmp 'board.json'
    $if = Join-Path $tmp 'issues.txt'
    [IO.File]::WriteAllText($bf, ($board | ConvertTo-Json -Depth 6))
    [IO.File]::WriteAllLines($if, $issues)
    $o = @(& $check -Board $bf -Issues $if 6>&1 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($o -join "`n") }
}

try {
    $good = @((Card 1 'OPEN' 'Todo' 10), (Card 2 'OPEN' 'In Progress' 20), (Card 3 'CLOSED' 'Done' $null), (Card 4 'OPEN' 'Done' 30.5))
    $r = Run (Board $good) @('1', '2', '4@2026-10-20T00:00:00Z')
    Yes ("a board that keeps every rule: exit 0 ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match 'Every card keeps every rule')
    $r = Run (Board $good @('Todo', 'In Progress', 'Done') $false $false) @('1', '2', '4')
    Yes ("  Auto-add to project off is no rule broken now board.yml adds every card (#5185): exit 0 ($($r.Code))") ($r.Code -eq 0)

    $bad = @((Card 1 'OPEN' 'Todo' $null), (Card 2 'OPEN' 'Todo' 20), (Card 5 'OPEN' 'Todo' 20), (Card 6 'OPEN' $null 40), (Card 7 'CLOSED' 'In Progress' 50),
        (Card 8 'OPEN' 'Todo' $null 'Issue' $true), (Card 9 'OPEN' 'Todo' $null 'PullRequest'))
    $r = Run (Board $bad @('Todo', 'Doing', 'Done') $false $true) @('1', '2', '5', '6', '9', '11@2026-10-01T00:00:00Z', '12@2026-10-27T00:00:00Z')
    Yes ("a board that breaks them: exit 3 ($($r.Code))") ($r.Code -eq 3)
    Yes '  an open issue with no Order' ($r.Out -match '(?m)^no order: 1\n  #1 card 1$')
    Yes '  two cards sharing an Order' ($r.Out -match '(?m)^shared order: 1\n  Order 20: #2, #5$')
    Yes '  an open card with no Status' ($r.Out -match '(?m)^no status: 1\n  #6 card 6$')
    Yes '  a closed issue not in Done' ($r.Out -match '(?m)^closed open: 1\n  #7 card 7 \(Status In Progress\)$')
    Yes '  Status options that are not the three' ($r.Out -match 'the Status options are Todo, Doing, Done, not Todo, In Progress, Done')
    Yes '  Auto-close on' ($r.Out -match '"Auto-close issue" is on, and should be off' -and $r.Out -notmatch 'Auto-add')
    Yes '  an open issue with no card, made before the read' ($r.Out -match '(?m)^no card: 1\n  #11$')
    Yes 'an archived card and a pull request with no Order are left out' ($r.Out -notmatch '#8 card 8' -and $r.Out -notmatch '#9 card 9')
    Yes 'an issue made after the read is not called missing' ($r.Out -notmatch '#12')

    $nb = Board $good
    $nb.workflows = $null; $nb['workflows_unread'] = 'the board answered: You do not have permission to access workflows'
    $r = Run $nb @('1', '2', '4')
    Yes ("workflows the board App could not read: no rule broken, and it says Auto-close was not checked: exit 0 ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match '"workflows" not checked' -and $r.Out -match 'Auto-close issue must be off')

    $o = @(& $check -Board (Join-Path $tmp 'none.json') -NoIssues 6>&1 2>&1 | ForEach-Object { "$_" })
    Yes 'no file: exit 1' ($LASTEXITCODE -eq 1 -and ($o -join ' ') -match 'Read-Board\.ps1 -OutFile')
    [IO.File]::WriteAllText((Join-Path $tmp 'x.json'), '{"a":1}')
    $o = @(& $check -Board (Join-Path $tmp 'x.json') -NoIssues 6>&1 2>&1 | ForEach-Object { "$_" })
    Yes 'not a board: exit 1' ($LASTEXITCODE -eq 1 -and ($o -join ' ') -match 'no cards')
    $r = Run (Board $good) @('1', 'two')
    Yes 'issue numbers that are not numbers: exit 1' ($r.Code -eq 1 -and $r.Out -match 'did not read as numbers')
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Done
