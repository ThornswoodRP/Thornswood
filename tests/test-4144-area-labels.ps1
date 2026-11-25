<#
  test-4144-area-labels.ps1

      pwsh -NoProfile -File .\tests\test-4144-area-labels.ps1

  Issue #4144. .github\workflows\area-label.yml gives a new issue the area
  its title names, from a table of words in its script. Tried on the 400
  newest issues it agreed with the label people chose 31% of the time, left
  60% in "area: triage" and picked a wrong area for 9%: the table missed
  plurals and several areas people use, and nothing said which area labels
  there are. This holds:

    1. docs\guide\the-board.md, "Area labels", lists every area label once,
       each with what it covers, and the labeller's table names exactly
       those, so a label is never put on that the guide does not list and
       no listed area is left out of the table;
    2. the labeller matches a word in the plural and in any case, and a
       "test task" is not a test;
    3. on real titles (tests\fixtures\area-label-titles.tsv, the board's own
       issues with the areas people gave them) it agrees with people at least
       40% of the time, leaves at most 52% to triage and puts on a wrong
       area at most 10% of the time, and every area people used there is a
       listed one.

  It runs the labeller's own table and Pick, lifted out of the workflow's
  script, so what is measured is what runs. It reaches no network.
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
$flow = Join-Path $Repo '.github/workflows/area-label.yml'
$text = [IO.File]::ReadAllText($flow) -replace "`r`n", "`n"
$run = [regex]::Match($text, '(?ms)^(\s+)run: \|\n(.*)$')
Yes 'area-label.yml has its script' $run.Success
if (-not $run.Success) { Done }
$lines = $run.Groups[2].Value -split "`n"
$indent = [regex]::Match($lines[0], '^\s*').Value
$head = New-Object System.Collections.Generic.List[string]
$reached = $false
foreach ($l in $lines) {
    if ($l.Trim().Length -and -not $l.StartsWith($indent)) { break }
    $l = $(if ($l.Length -ge $indent.Length) { $l.Substring($indent.Length) } else { '' })
    if ($l -match '^\$todo = @\(\)') { $reached = $true; break }
    $head.Add($l)
}
Yes '  and it defines its table and Pick before it asks GitHub for anything' ($reached -and ($head -join "`n") -match '(?m)^function Pick\b')
if (-not $reached) { Done }
# Its own scope, so nothing it sets reaches this harness's names.
$labeller = New-Module -AsCustomObject -ScriptBlock ([scriptblock]::Create(($head -join "`n") + "`n" + @'
function Names { return @($areas.Keys) }
function Triage { return $triage }
function PickOne([string]$t) { return (Pick $t) }
Export-ModuleMember -Function Names, Triage, PickOne
'@))
$table = @($labeller.Names())
$triageLabel = $labeller.Triage()
Yes ("  its table names areas ({0})" -f $table.Count) ($table.Count -gt 0)

# ---- 1. the guide lists them, each with what it covers ---------------------
$board = [IO.File]::ReadAllText((Join-Path $Repo 'docs/guide/the-board.md')) -replace "`r`n", "`n"
$section = [regex]::Match($board, '(?ms)^### Area labels\n(.*?)(?=^#)')
Yes '1. docs/guide/the-board.md has an "Area labels" section' $section.Success
$listed = [ordered]@{}
$noWords = @()
if ($section.Success) {
    foreach ($m in [regex]::Matches($section.Groups[1].Value, '(?m)^\|\s*`(area: [^`]+)`\s*\|\s*(.*?)\s*\|\s*$')) {
        $name = $m.Groups[1].Value
        if ($listed.Contains($name)) { $listed[$name] = $null } else { $listed[$name] = $m.Groups[2].Value }
        if (-not $m.Groups[2].Value) { $noWords += $name }
    }
}
$twice = @($listed.Keys | Where-Object { $null -eq $listed[$_] })
Yes ("   it lists area labels ({0})" -f $listed.Count) ($listed.Count -gt 0)
Yes ("   each once ({0})" -f ($twice -join ', ')) ($twice.Count -eq 0)
Yes ("   each with what it covers ({0})" -f ($noWords -join ', ')) ($listed.Count -gt 0 -and $noWords.Count -eq 0)
Yes ("   and with {0}, which the labeller puts on when a title names none or two" -f $triageLabel) ($listed.Contains($triageLabel))
$areasListed = @($listed.Keys | Where-Object { $_ -ne $triageLabel })
$notListed = @($table | Where-Object { $areasListed -notcontains $_ })
$notInTable = @($areasListed | Where-Object { $table -notcontains $_ })
Yes ("   the labeller puts on no label the guide does not list ({0})" -f ($notListed -join ', ')) ($notListed.Count -eq 0)
Yes ("   and leaves no listed area out of its table ({0})" -f ($notInTable -join ', ')) ($notInTable.Count -eq 0)

# ---- 2. plurals, any case, and a test task that is no test -----------------
$cases = @(
    @{ t = 'LAUNCHER WINDOW CLOSES ON ITS OWN'; want = 'area: Launcher' },
    @{ t = 'Two launchers open at once'; want = 'area: Launcher' },
    @{ t = 'Workflows skip on a schedule'; want = 'area: GitHub & CI' },
    @{ t = 'Recipes vanish from the list'; want = 'area: In-game' },
    @{ t = 'Bans outlive the character'; want = 'area: Moderation' },
    @{ t = 'Flaky tests on Windows'; want = 'area: Testing' },
    @{ t = 'A test task names the wrong step'; want = $triageLabel })
foreach ($k in $cases) {
    $got = $labeller.PickOne($k.t)
    Yes ("2. '{0}' gets {1} ({2})" -f $k.t, $k.want, $got) ($got -eq $k.want)
}

# ---- 3. real titles ----------------------------------------------------------
$rows = @()
foreach ($l in [IO.File]::ReadAllLines((Join-Path $Repo 'tests/fixtures/area-label-titles.tsv'))) {
    if (-not $l -or $l.StartsWith('#')) { continue }
    $p = $l -split "`t"
    if ($p.Count -ne 3) { throw "fixtures/area-label-titles.tsv: a line that is not number, areas and title: $l" }
    $rows += [pscustomobject]@{ N = $p[0]; Want = @($p[1] -split '\|' | ForEach-Object { 'area: ' + $_ }); Title = $p[2] }
}
Yes ("3. the real titles are there ({0})" -f $rows.Count) ($rows.Count -ge 300)
$unknown = @($rows | ForEach-Object { $_.Want } | Sort-Object -Unique | Where-Object { $areasListed -notcontains $_ })
Yes ("   every area people gave them is a listed one ({0})" -f ($unknown -join ', ')) ($unknown.Count -eq 0)
$agree = 0; $tri = 0; $wrong = 0
foreach ($r in $rows) {
    $got = $labeller.PickOne($r.Title)
    if ($got -eq $triageLabel) { $tri++ }
    elseif ($r.Want -contains $got) { $agree++ }
    else { $wrong++ }
}
$n = [double]$rows.Count
if ($n -eq 0) { $n = 1 }
$say = '{0} of {1}: {2:0}% the area people gave, {3:0}% triage, {4:0}% a wrong area' -f $agree, $rows.Count, (100 * $agree / $n), (100 * $tri / $n), (100 * $wrong / $n)
Write-Host "      $say"
Yes '   it agrees with people on at least 40% of them' ((100 * $agree / $n) -ge 40)
Yes '   it leaves at most 52% to triage' ((100 * $tri / $n) -le 52)
Yes '   it puts on a wrong area at most 10% of the time' ((100 * $wrong / $n) -le 10)

Done
