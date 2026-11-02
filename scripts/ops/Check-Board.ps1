<#
  Check-Board.ps1

  Holds the board's cards to the rules docs/guide/the-board.md gives them, from a
  board.json Read-Board.ps1 wrote, and names every card that breaks one. Run
  by the weekly reviews from a cloud thread (#3534):

      pwsh scripts/ops/Read-Board.ps1 -OutFile temp/review/board.json
      pwsh scripts/ops/Check-Board.ps1 -Board temp/review/board.json

  It changes nothing, on the board or anywhere else.

  WHY (#3534). The 25 Oct 2026 weekly review listed the board's Order under
  "Could not read". Read-Board.ps1 has read every card's Order since #3192,
  but its read failed that day on the full artifact storage (#3410), and
  nothing then said what a right Order is. Read again at 11:41 AM on 26 Oct
  (run 40370916888): 315 of the 331 open issues had no Order at all.

  WHAT IT HOLDS EACH CARD TO (docs/guide/the-board.md, "Everything we need to do
  goes on the board"):
    no order      an open issue with no Order. "Order is the do-order. A new
                  issue gets the Order of where it belongs." Every open issue
                  carries one (Patrick, 27 Oct 2026, #3534): board.yml gives a
                  new issue 10000 plus its number (scripts/ops/Sync-Board.js),
                  and the board review moves it to where it belongs in the
                  queue with an order: label.
    shared order  two open cards with the same Order, so neither is first.
    no status     an open card with no Status. The options are Todo, In
                  Progress and Done.
    closed open   a closed issue whose Status is not Done. The board's own
                  "Item closed" workflow sets Done; a closed card elsewhere
                  is one it missed.
    statuses      the Status options are Todo, In Progress and Done, in that
                  order ("never add one through the API").
    workflows     Auto-close issue off, since a Done issue still waits on its
                  test (#3076). Every issue gets its card from board.yml
                  (#5185), so Auto-add to project is neither needed nor
                  checked. GitHub refuses a board's workflows to the board
                  App's token, so a board.json read with it says they
                  were not read (workflows_unread); then this
                  says so on its own line, breaks no rule, and the setting
                  is checked on the board's Workflows page by a person.
    no card       an open issue of the repository, made before the board was
                  read, with no card, when the open issues are read too
                  (-Issues, or gh; -NoIssues skips).
  An archived card is left out of every check but "no card".

  Exits:
    0  every card keeps every rule; what was checked is printed
    1  stopped, and the line before says why
    3  it names cards or settings that break a rule, one line each, under a
       heading per rule with its count
#>
[CmdletBinding()]
param(
    # The board.json Read-Board.ps1 wrote.
    [string]$Board,
    # The numbers of the repository's open issues, one a line, each with
    # @<when it was made> or without. Without it they are read with gh,
    # every page.
    [string]$Issues,
    # Skip "no card", and with it the read of the open issues.
    [switch]$NoIssues,
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood',
    # Define the functions and stop, which is how the harness loads them.
    [switch]$Load
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$StatusOptions = @('Todo', 'In Progress', 'Done')

function Get-Prop($o, [string]$name) {
    if ($null -eq $o) { return $null }
    $p = $o.PSObject.Properties[$name]
    if ($p) { return $p.Value }
    return $null
}

function Get-CardName($c) {
    $n = Get-Prop $c 'number'
    $t = [string](Get-Prop $c 'title')
    if ($t.Length -gt 80) { $t = $t.Substring(0, 77) + '...' }
    if ($null -ne $n) { return ('#{0} {1}' -f $n, $t) }
    return ('(draft) ' + $t)
}

# Every rule a card or the board breaks, as an ordered table rule -> lines.
# board is board.json as an object; open is the numbers of the repository's
# open issues, or $null when they were not read.
function Find-BoardDrift($board, [string]$repo, $open) {
    $out = [ordered]@{}
    foreach ($k in 'no order', 'shared order', 'no status', 'closed open', 'statuses', 'workflows', 'no card') { $out[$k] = New-Object System.Collections.Generic.List[string] }

    $statuses = @(Get-Prop $board 'statuses')
    if (($statuses -join '|') -ne ($StatusOptions -join '|')) {
        $out['statuses'].Add(('the Status options are {0}, not {1}' -f ($(if ($statuses.Count) { $statuses -join ', ' } else { 'none' })), ($StatusOptions -join ', ')))
    }
    $flows = @(Get-Prop $board 'workflows')
    $unread = Get-Prop $board 'workflows_unread'
    foreach ($want in @(@{ n = 'Auto-close issue'; on = $false } | Where-Object { -not $unread })) {
        $f = @($flows | Where-Object { (Get-Prop $_ 'name') -eq $want.n })
        if (-not $f.Count) { $out['workflows'].Add(('the board has no "{0}" workflow' -f $want.n)); continue }
        if ([bool](Get-Prop $f[0] 'enabled') -ne $want.on) { $out['workflows'].Add(('"{0}" is {1}, and should be {2}' -f $want.n, $(if ($want.on) { 'off' } else { 'on' }), $(if ($want.on) { 'on' } else { 'off' }))) }
    }

    $cards = @(Get-Prop $board 'items')
    $mine = @($cards | Where-Object { -not [bool](Get-Prop $_ 'archived') })
    $liveOpen = @($mine | Where-Object { (Get-Prop $_ 'state') -eq 'OPEN' })
    foreach ($c in @($liveOpen | Sort-Object { [int](Get-Prop $_ 'number') })) {
        if ((Get-Prop $c 'kind') -eq 'Issue' -and $null -eq (Get-Prop $c 'order')) { $out['no order'].Add((Get-CardName $c)) }
        if (-not (Get-Prop $c 'status')) { $out['no status'].Add((Get-CardName $c)) }
    }
    foreach ($g in @($liveOpen | Where-Object { $null -ne (Get-Prop $_ 'order') } | Group-Object { [double](Get-Prop $_ 'order') } | Where-Object { $_.Count -gt 1 } | Sort-Object { [double]$_.Name })) {
        $out['shared order'].Add(('Order {0}: {1}' -f $g.Name, (@($g.Group | ForEach-Object { '#' + (Get-Prop $_ 'number') }) -join ', ')))
    }
    foreach ($c in @($mine | Where-Object { (Get-Prop $_ 'kind') -eq 'Issue' -and (Get-Prop $_ 'state') -eq 'CLOSED' -and (Get-Prop $_ 'status') -ne 'Done' } | Sort-Object { [int](Get-Prop $_ 'number') })) {
        $out['closed open'].Add(('{0} (Status {1})' -f (Get-CardName $c), $(if (Get-Prop $c 'status') { Get-Prop $c 'status' } else { 'none' })))
    }
    if ($null -ne $open) {
        $carded = @{}
        foreach ($c in $cards) { if ((Get-Prop $c 'repo') -eq $repo -and $null -ne (Get-Prop $c 'number')) { $carded[[int](Get-Prop $c 'number')] = $true } }
        foreach ($n in @($open | Sort-Object)) { if (-not $carded.ContainsKey([int]$n)) { $out['no card'].Add(('#{0}' -f $n)) } }
    }
    return $out
}

# The numbers of the open issues made before the board was read, from lines
# of "<number>" or "<number>@<when it was made>"; an issue made after the
# read cannot have a card in it yet. Anything else is refused.
function Get-OpenIssueNumbers([string[]]$lines, [string]$readAt) {
    $read = [DateTime]::MaxValue
    if ($readAt) { $read = ([DateTime]::Parse($readAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)) }
    $nums = New-Object System.Collections.Generic.List[int]
    foreach ($l in $lines) {
        $t = ([string]$l).Trim()
        if (-not $t) { continue }
        $m = [regex]::Match($t, '^(\d+)(?:@(\S+))?$')
        if (-not $m.Success) { throw "'$t' is not an issue number" }
        if ($m.Groups[2].Success) {
            $made = [DateTime]::Parse($m.Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
            if ($made -gt $read) { continue }
        }
        $nums.Add([int]$m.Groups[1].Value)
    }
    return , $nums.ToArray()
}

if ($Load) { return }

function Die($m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

if (-not $Board) { Die 'say which board.json to check with -Board; pwsh scripts/ops/Read-Board.ps1 -OutFile <file> writes one.' }
if (-not (Test-Path -LiteralPath $Board)) { Die "there is no $Board. pwsh scripts/ops/Read-Board.ps1 -OutFile $Board writes it." }
try { $b = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Board).Path) | ConvertFrom-Json } catch { Die "$Board is not JSON: $($_.Exception.Message)" }
if (-not (Get-Prop $b 'items')) { Die "$Board has no cards in it, so it is not a board.json Read-Board.ps1 wrote." }

$open = $null
if (-not $NoIssues) {
    if ($Issues) {
        if (-not (Test-Path -LiteralPath $Issues)) { Die "there is no $Issues." }
        $lines = [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $Issues).Path)
    } else {
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to read the open issues with; pass -Issues, or -NoIssues to skip "no card".' }
        # Page by page until a page comes back short: gh's --paginate follows
        # GitHub's next links, which name the repository by its id, and the
        # cloud's proxy refuses those (measured 26 Oct 2026). The issues list
        # carries pull requests too; they have pull_request.
        $lines = New-Object System.Collections.Generic.List[string]
        for ($page = 1; ; $page++) {
            if ($page -gt 50) { Die 'more than 5,000 open issues: stopped reading pages.' }
            $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $o = @(& gh api "repos/$GitHubRepo/issues?state=open&per_page=100&page=$page" --jq '(length | tostring) + " " + ([.[] | select(.pull_request == null) | (.number | tostring) + "@" + .created_at] | join(" "))' 2>&1 | ForEach-Object { "$_" })
            $c = $LASTEXITCODE
            $ErrorActionPreference = $old
            if ($c -ne 0) { Die ('GitHub did not list the open issues: ' + (($o | Select-Object -Last 2) -join ' ')) }
            $words = @(($o -join ' ').Trim() -split '\s+')
            foreach ($w in @($words | Select-Object -Skip 1)) { $lines.Add($w) }
            if ([int]$words[0] -lt 100) { break }
        }
    }
    try { $open = Get-OpenIssueNumbers $lines ([string](Get-Prop $b 'read_at')) } catch { Die ("the open issues did not read as numbers: " + $_.Exception.Message) }
}

$drift = Find-BoardDrift $b $GitHubRepo $open
$cards = @(Get-Prop $b 'items')
$openCards = @($cards | Where-Object { (Get-Prop $_ 'state') -eq 'OPEN' -and -not [bool](Get-Prop $_ 'archived') })
Write-Host ('{0} cards read at {1}, {2} of them open and not archived' -f $cards.Count, (Get-Prop $b 'read_at'), $openCards.Count)
if ($null -ne $open) { Write-Host ('{0} open issues on {1}' -f $open.Count, $GitHubRepo) } else { Write-Host '"no card" skipped: the open issues were not read' }
$unread = Get-Prop $b 'workflows_unread'
if ($unread) { Write-Host ('"workflows" not checked: the board''s workflows were not read ({0}). Auto-close issue must be off; a person checks it on the board''s Workflows page.' -f $unread) -ForegroundColor DarkYellow }

$named = 0
foreach ($k in $drift.Keys) {
    $lines = $drift[$k]
    if (-not $lines.Count) { Write-Host ("  {0}: none" -f $k) -ForegroundColor DarkGray; continue }
    $named += $lines.Count
    Write-Host ("{0}: {1}" -f $k, $lines.Count) -ForegroundColor Yellow
    foreach ($l in $lines) { Write-Host ("  $l") }
}
if ($named) { exit 3 }
Write-Host 'Every card keeps every rule.' -ForegroundColor Green
exit 0
