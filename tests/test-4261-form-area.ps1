<#
  test-4261-form-area.ps1

      pwsh -NoProfile -File .\tests\test-4261-form-area.ps1

  Issue #4261. Every issue form puts on "triage", and
  .github\workflows\area-label.yml then put on "area: triage" too whenever
  the title named no area, because it read only the title and never the
  form's own answer to where the problem is. So a report carried two labels
  saying it was not sorted, and nothing said which to clear.

  The labeller now reads the form's answer first, and a form report it can
  give no area keeps only "triage". This holds:

    1. each form's question about where the problem is has a row in the
       labeller's $fromForm, with every option the form offers and no other,
       and every area it names is one docs\guide\the-board.md lists;
    2. a report as a form writes it gets the area its answer names, even
       when its title names none or another;
    3. one whose answer names no area goes by its title;
    4. one that neither names keeps "triage" alone, never "area: triage";
    5. an issue opened by hand still gets "area: triage";
    6. docs\guide\the-board.md says how a report is sorted.

  It runs the labeller's own table and functions, lifted out of the
  workflow's script as tests\test-4144-area-labels.ps1 lifts them. It reaches
  no network.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

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

# ---- the labeller's script, up to where it starts asking GitHub ---------------
$text = [IO.File]::ReadAllText((Join-Path $Repo '.github/workflows/area-label.yml')) -replace "`r`n", "`n"
$run = [regex]::Match($text, '(?ms)^(\s+)run: \|\n(.*)$')
Yes 'area-label.yml has its script' $run.Success
if (-not $run.Success) { Done }
$lines = $run.Groups[2].Value -split "`n"
$indent = [regex]::Match($lines[0], '^\s*').Value
$head = New-Object System.Collections.Generic.List[string]
foreach ($l in $lines) {
    if ($l.Trim().Length -and -not $l.StartsWith($indent)) { break }
    $l = $(if ($l.Length -ge $indent.Length) { $l.Substring($indent.Length) } else { '' })
    if ($l -match '^\$todo = @\(\)') { break }
    $head.Add($l)
}
$src = $head -join "`n"
Yes '  and it reads a form''s answer (LabelFor and $fromForm before it asks GitHub)' ($src -match '(?m)^function LabelFor\b' -and $src -match '(?m)^\$fromForm = ')
if (-not ($src -match '(?m)^function LabelFor\b')) { Done }
$labeller = New-Module -AsCustomObject -ScriptBlock ([scriptblock]::Create($src + "`n" + @'
function Triage { return $triage }
function Table { return $fromForm }
function For([string]$t, [string]$b, [string[]]$l) { return (LabelFor $t $b $l) }
Export-ModuleMember -Function Triage, Table, For
'@))
$triage = $labeller.Triage()
$table = $labeller.Table()

# ---- 1. the forms' own questions and options -----------------------------------
$board = [IO.File]::ReadAllText((Join-Path $Repo 'docs/guide/the-board.md')) -replace "`r`n", "`n"
$listed = @([regex]::Matches($board, '(?m)^\|\s*`(area: [^`]+)`\s*\|') | ForEach-Object { $_.Groups[1].Value })
foreach ($f in 'bug.yml', 'crash.yml', 'suggestion.yml') {
    $yml = [IO.File]::ReadAllText((Join-Path $Repo ".github/ISSUE_TEMPLATE/$f")) -replace "`r`n", "`n"
    # The first dropdown is where the problem is, on all three.
    $m = [regex]::Match($yml, '(?ms)- type: dropdown\n.*?label: ([^\n]+)\n.*?options:\n((?:\s+- [^\n]+\n)+)')
    Yes "1. $f asks where the problem is in a dropdown" $m.Success
    if (-not $m.Success) { continue }
    $q = $m.Groups[1].Value.Trim().Trim('"', "'")
    $opts = @([regex]::Matches($m.Groups[2].Value, '(?m)^\s+- (.+)$') | ForEach-Object { $_.Groups[1].Value.Trim().Trim('"', "'") })
    Yes "   its question '$q' has a row in `$fromForm" ($table.Contains($q))
    if (-not $table.Contains($q)) { continue }
    $row = $table[$q]
    $missing = @($opts | Where-Object { -not $row.Contains($_) })
    $extra = @($row.Keys | Where-Object { $opts -notcontains $_ })
    Yes ("   with every option the form offers ({0})" -f ($missing -join ', ')) ($missing.Count -eq 0)
    Yes ("   and none it does not ({0})" -f ($extra -join ', ')) ($extra.Count -eq 0)
    $bad = @($row.Values | Where-Object { $_ -and $listed -notcontains $_ })
    Yes ("   and every area it names is listed in the guide ({0})" -f ($bad -join ', ')) ($bad.Count -eq 0)
}

# ---- 2 to 5. reports as the forms write them ------------------------------------
function Report([string]$q, [string]$a) {
    return "### $q`n`n$a`n`n### What happened?`n`nIt stopped.`n`n### Anything else?`n`n_No response_"
}
$form = @('triage', 'bug')
$cases = @(
    @{ n = '2. a launcher report whose title names no area'; t = 'It closes when I press it'; b = (Report 'Where is it?' 'The launcher'); l = $form; want = 'area: Launcher' },
    @{ n = '   a game crash'; t = 'Crashed after loading'; b = (Report 'What crashed?' 'The game (Skyrim)'); l = $form; want = 'area: Client' },
    @{ n = '   an idea for the bot, its title naming the site'; t = 'Show my site profile in a card'; b = (Report 'What is it for?' 'The Discord bot'); l = @('triage', 'Suggestion'); want = 'area: Discord' },
    @{ n = '   a report written with Windows line ends'; t = 'Nothing loads'; b = ((Report 'Where is it?' 'The website') -replace "`n", "`r`n"); l = $form; want = 'area: Website' },
    @{ n = '3. "In the game", its title naming a recipe'; t = 'A recipe vanished'; b = (Report 'Where is it?' 'In the game'); l = $form; want = 'area: In-game' },
    @{ n = '4. "Somewhere else", its title naming nothing'; t = 'Something is off'; b = (Report 'Where is it?' 'Somewhere else'); l = $form; want = '' },
    @{ n = '   "In the game", its title naming two areas'; t = 'Bot and launcher both broke'; b = (Report 'Where is it?' 'In the game'); l = $form; want = '' },
    @{ n = '5. an issue opened by hand whose title names nothing'; t = 'Something is off'; b = 'A plain body.'; l = @(); want = $triage },
    @{ n = '   and one whose title names an area'; t = 'The launcher closes'; b = ''; l = @(); want = 'area: Launcher' }
)
foreach ($c in $cases) {
    $got = $labeller.For($c.t, $c.b, [string[]]$c.l)
    $say = $(if ($c.want) { $c.want } else { 'no area label, triage alone' })
    Yes ("{0} gets {1} ({2})" -f $c.n, $say, $(if ($got) { $got } else { 'none' })) ($got -eq $c.want)
}
$both = @($cases | Where-Object { $_.l -contains 'triage' } | ForEach-Object { $labeller.For($_.t, $_.b, [string[]]$_.l) } | Where-Object { $_ -eq $triage })
Yes '   so no form report ever carries both triage labels' ($both.Count -eq 0)

# ---- 6. the guide --------------------------------------------------------------
$sec = [regex]::Match($board, '(?ms)^### Sorting a report\n(.*?)(?=^#)')
Yes '6. docs/guide/the-board.md has "Sorting a report"' $sec.Success
Yes '   saying to put on the area and take triage off' ($sec.Success -and $sec.Groups[1].Value -match 'take `triage` off' -and $sec.Groups[1].Value -match '`area: triage`')

Done
