<#
  test-4224-or-conditions.ps1

      pwsh -NoProfile -File .\tests\test-4224-or-conditions.ps1

  Issue #4224. scripts\dev\Build-RecipeTable.ps1 read each recipe
  condition's OR flag (the low bit of the CTDA's first byte) but never wrote
  it into a row's needs, so "this race, or that race, or a finished quest"
  read as needing all three, and the day-one check and the count of rows
  behind a perk took every condition as required.

  This lifts the functions that read a row's needs out of the script by its
  syntax tree and runs them on needs shaped like the recipes': a run of
  conditions each joined to the next by OR, ended by one that is not, is one
  group, any one of which will do, and the groups are joined by AND. Then it
  holds the places in the script that write the flag and read it.

  -Repo points it at another checkout. Read only. A few seconds.
#>
[CmdletBinding()]
param([string]$Repo)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$path = Join-Path $Repo 'scripts\dev\Build-RecipeTable.ps1'
$src = [IO.File]::ReadAllText($path)
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
function Lift([string]$name) {
    $fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
    Yes ('Build-RecipeTable.ps1 has ' + $name) ($null -ne $fn)
    if ($fn) { return $fn.Extent.Text } else { return '' }
}
$lifted = @('NeedGroupsOf', 'NeedIsReachable', 'NeedsAreReachable', 'NeedsAreBehindPerk', 'NeedsText', 'ConditionRead' | ForEach-Object { Lift $_ })
if ($lifted -contains '') {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}
foreach ($t in $lifted) { Invoke-Expression $t }

# The script's own numbers for the functions these cases use.
$CONDITION_VANILLA_PERK = 448
$CONDITION_HAS_SPELL = 264
$TOMES_TEACH_STAFF_SPELLS = $true
Yes 'the script calls 448 the perk test and 264 HasSpell, as this test does' (
    $src -match '(?m)^\$CONDITION_VANILLA_PERK = 448\b' -and $src -match '(?m)^\$CONDITION_HAS_SPELL = 264\b')

function N([int]$func, [string]$text, [bool]$or = $false, [string[]]$tomes = @()) {
    return [pscustomobject]@{ Func = $func; Text = $text; Or = $or; Tomes = $tomes }
}
$dunmer = N 69 'GetIsRace(DarkElfRace) == 1' $true
$nord   = N 69 'GetIsRace(NordRace) == 1' $true
$quest  = N 58 'GetStageDone(MQ101) == 1'
$perk   = N 448 'HasPerk(SteelSmithing) == 1'
$perkOr = N 448 'HasPerk(SteelSmithing) == 1' $true
$spell  = N 264 'HasSpell(Sparks) == 1' $true @('SpellTomeSparks')

Write-Host ''
Write-Host 'G. groups:'
$g = NeedGroupsOf @($dunmer, $nord, $quest, $perk)
Yes 'G1 race or race or a quest stage, then a perk, is two groups' ($g.Count -eq 2 -and @($g[0]).Count -eq 3 -and @($g[1]).Count -eq 1)
$g = NeedGroupsOf @($perk, $quest)
Yes 'G2 conditions with no OR flag are a group each' ($g.Count -eq 2)
$g = NeedGroupsOf @($quest, $dunmer)
Yes 'G3 an OR flag on the last condition ends the last group' ($g.Count -eq 2 -and @($g[1]).Count -eq 1)
Yes 'G4 no conditions are no groups' ((NeedGroupsOf @()).Count -eq 0)

Write-Host ''
Write-Host 'L. the collection the recipe builder creates:'
$productionCases = @(
    @{ Name = 'no conditions'; Needs = @(); Groups = 0; Reachable = $true; BehindPerk = $false; Text = '' },
    @{ Name = 'one taught spell'; Needs = @((N 264 'HasSpell(Sparks) == 1' $false @('SpellTomeSparks'))); Groups = 1; Reachable = $true; BehindPerk = $false; Text = 'HasSpell(Sparks) == 1' },
    @{ Name = 'an OR group and a perk'; Needs = @($dunmer, $nord, $quest, $perk); Groups = 2; Reachable = $false; BehindPerk = $true; Text = '(GetIsRace(DarkElfRace) == 1 or GetIsRace(NordRace) == 1 or GetStageDone(MQ101) == 1) and HasPerk(SteelSmithing) == 1' }
)
foreach ($case in $productionCases) {
    # Match the builder, including New-Object: a constructor-created list does
    # not expose the array-subexpression failure on the supported PowerShell.
    $productionNeeds = New-Object 'System.Collections.Generic.List[object]'
    foreach ($need in $case.Needs) { $productionNeeds.Add($need) }
    try {
        $groups = NeedGroupsOf $productionNeeds
        $reachable = NeedsAreReachable $productionNeeds
        $behindPerk = NeedsAreBehindPerk $productionNeeds
        $text = NeedsText $productionNeeds
        Yes ('L ' + $case.Name) (
            $groups.Count -eq $case.Groups -and $reachable -eq $case.Reachable -and
            $behindPerk -eq $case.BehindPerk -and $text -eq $case.Text)
    } catch {
        Yes ('L ' + $case.Name + ': ' + $_.Exception.Message) $false
    }
}

Write-Host ''
Write-Host 'R. can a new character make it:'
Yes 'R1 no condition at all: yes' (NeedsAreReachable @())
Yes 'R2 a spell a tome teaches, or a race: yes, the tome is a way in' (NeedsAreReachable @($spell, (N 69 'GetIsRace(NordRace) == 1')))
Yes 'R3 race or race or a quest stage: no' (-not (NeedsAreReachable @($dunmer, $nord, $quest)))
Yes 'R5 a taught spell alone: yes, and a race alone: no' ((NeedsAreReachable @((N 264 'HasSpell(Sparks) == 1' $false @('SpellTomeSparks')))) -and -not (NeedsAreReachable @((N 69 'GetIsRace(NordRace) == 1'))))
Yes 'R4 a taught spell and then a race: no, the race is needed too' (-not (NeedsAreReachable @((N 264 'HasSpell(Sparks) == 1' $false @('SpellTomeSparks')), (N 69 'GetIsRace(NordRace) == 1'))))

Write-Host ''
Write-Host 'P. behind a perk:'
Yes 'P1 a perk test or a race is not behind a perk' (-not (NeedsAreBehindPerk @($perkOr, (N 69 'GetIsRace(NordRace) == 1'))))
Yes 'P2 a perk test and a race is' (NeedsAreBehindPerk @($perk, (N 69 'GetIsRace(NordRace) == 1')))
Yes 'P3 a perk test or a perk test is' (NeedsAreBehindPerk @($perkOr, $perk))
Yes 'P4 a row with no perk test is not' (-not (NeedsAreBehindPerk @($dunmer, $nord, $quest)))

Write-Host ''
Write-Host 'T. in words:'
$t = NeedsText @($dunmer, $nord, $quest, $perk)
Yes ('T1 a group reads with or, the groups with and (' + $t + ')') (
    $t -eq '(GetIsRace(DarkElfRace) == 1 or GetIsRace(NordRace) == 1 or GetStageDone(MQ101) == 1) and HasPerk(SteelSmithing) == 1')

Write-Host ''
Write-Host 'C. ConditionRead keeps the flag:'
$CONDITION_FUNCTIONS_THE_SERVER_HAS = @{ 69 = 'GetIsRace' }
$CONDITION_OPERATORS = @('==', '!=', '>', '>=', '<', '<=')
$items = @{}; $tomesBySpell = @{}
function DescOf($id, $masters, $plugin) { return '' }
$c = ConditionRead ([pscustomobject]@{ Func = 69; Param1 = 0; Operator = 0; Value = 1; UsesGlobal = $false; Or = $true }) @() 'Skyrim.esm'
Yes 'C1 a condition read with its OR flag set says so' ($c.Or -eq $true)
$c = ConditionRead ([pscustomobject]@{ Func = 69; Param1 = 0; Operator = 0; Value = 1; UsesGlobal = $false; Or = $false }) @() 'Skyrim.esm'
Yes 'C2 and one without it says not' ($c.Or -eq $false)

Write-Host ''
Write-Host 'S. where the script uses them:'
Yes 'S1 the flag is read off the low bit of the operator byte' ($src -match 'Or = \(\(\$opByte -band 0x01\) -ne 0\)')
Yes 'S2 recipes.json writes it on each need' ($src -match ', "serverSees": '' \+ \$sees \+ '', "or": '' \+ \$orTxt')
Yes 'S3 and says what it means in its header' ($src -match '"needs": .*or true means the condition is joined to the next one by OR')
Yes 'S4 the day-one check reads the groups' ($src -match 'DayOne = \(NeedsAreReachable \$needs\)')
Yes 'S5 behind a perk reads the groups' ($src -match '\$behindPerk = NeedsAreBehindPerk \$needs')
Yes 'S6 a thin half''s rows say what they want with or' ($src -match 'and wants \{2\}" -f \$row\.Edid, \$row\.OutName, \(NeedsText \$row\.Needs\)')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit ([int]($script:fail -gt 0))
