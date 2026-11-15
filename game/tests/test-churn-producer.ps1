<#
  test-churn-producer.ps1

      pwsh -NoProfile -File .\game\tests\test-churn-producer.ps1

  The recipe table's reader sees the butter churn as a farmer's producer of
  Butter, at novice, and still reads every other station the way it did.

  WHY THIS EXISTS. To Do List entry 94. Patrick, 21 September: "give milk and
  butter to farmers". Butter is 46 of the Cook's inputs and no class supplied
  any of it, because the food rule took the churn off the gatherer and gave it
  to nobody. churn() in gamemode.js now answers the churn with the farm verb,
  and STATION_VERBS in Build-RecipeTable.ps1 names it, so the next build of
  game\data\recipes.json puts Butter on the farmer.

  That reader is crude on purpose: it takes the body of each named function by
  counting braces and reads ITEMS.<key> off the lines, and a brace in the wrong
  place or an ITEMS key it cannot resolve turns a producer into a complaint.
  The full build takes nine minutes and needs the game's plugins, so this runs
  the reader alone. It lifts the real STATION_VERBS and the real
  ReadStationVerbs out of Build-RecipeTable.ps1's syntax tree and runs them
  against the real game\gamemode.js, so what is under test is the shipped
  code and not a copy of it.

  -Recipe and -GameMode point it at other copies, which is how it was shown
  to fail on the files from before this change.

  Read only.
#>
[CmdletBinding()]
param([string]$Recipe, [string]$GameMode)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Recipe) { $Recipe = Join-Path $Here '..\..\scripts\dev\Build-RecipeTable.ps1' }
if (-not $GameMode) { $GameMode = Join-Path $Here '..\..\game\gamemode.js' }

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

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Recipe, [ref]$tokens, [ref]$errors)
Yes 'Build-RecipeTable.ps1 parses' ($errors.Count -eq 0)

$fnAst = $ast.Find({
    param($n)
    $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'ReadStationVerbs'
}, $true)
$svAst = $ast.Find({
    param($n)
    $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $n.Left.Extent.Text -eq '$STATION_VERBS'
}, $true)
Yes 'it still defines ReadStationVerbs' ($null -ne $fnAst)
Yes 'and still assigns STATION_VERBS' ($null -ne $svAst)
if ($null -eq $fnAst -or $null -eq $svAst) { Done }

. ([scriptblock]::Create($svAst.Extent.Text))
. ([scriptblock]::Create($fnAst.Extent.Text))

$named = @($STATION_VERBS | Where-Object { $_.Fn -eq 'churn' })
Yes 'STATION_VERBS names churn() once' ($named.Count -eq 1)
Yes 'and says it is the farmer''s' ($named.Count -eq 1 -and $named[0].Who -eq 'farmer')

$res = ReadStationVerbs $GameMode
foreach ($b in $res.Bad) { Write-Host ("      the reader says: {0}" -f $b) }
Yes 'the reader has no complaint about any station in the gamemode' ($res.Bad.Count -eq 0)

$churn = @($res.Rows | Where-Object { $_.Fn -eq 'churn' })
Yes 'it reads exactly one thing off churn()' ($churn.Count -eq 1)
if ($churn.Count -eq 1) {
    $c = $churn[0]
    Write-Host ("      {0}" -f $c.Where)
    Yes 'and that thing is Butter, 353c:HearthFires.esm, out of ITEMS.butter' ($c.Key -eq 'butter' -and $c.Desc -eq '353c:HearthFires.esm')
    Yes 'handed to a farmer' ($c.Who -eq 'farmer')
    Yes ('at the bottom of the ladder, ' + $res.Ladder[0] + ', because nothing in churn() is behind a rank') ($c.At -eq 0 -and $c.Rank -eq $res.Ladder[0])
}

# The stations that were there before, read the same as before. The counts
# and grades were read off the reader on the build before this change. The
# kiln left the list in #2337: it is a bench, and its charcoal is four recipe
# rows (game\tests\test-2337-kiln-menu.js).
$salt = @($res.Rows | Where-Object { $_.Fn -eq 'mineSalt' })
$wood = @($res.Rows | Where-Object { $_.Fn -eq 'chopWood' })
Yes 'the salt quarry still gives the Salt Pile at novice and the three rare salts above it' (
    $salt.Count -eq 4 -and
    @($salt | Where-Object { $_.Key -eq 'saltPile' -and $_.At -eq 0 }).Count -eq 1 -and
    @($salt | Where-Object { $_.At -eq 2 }).Count -eq 3)
Yes 'the kiln is not read as a station any more, because it is a bench (#2337)' (
    @($STATION_VERBS | Where-Object { $_.Fn -eq 'burnCharcoal' }).Count -eq 0)
Yes 'the chopping blocks still give Firewood at novice' (
    $wood.Count -eq 1 -and $wood[0].Key -eq 'firewood' -and $wood[0].At -eq 0)
# milk() since #396 (#859): a farmer milks a living cow for a Jug of Milk,
# the fifth verb in STATION_VERBS.
$milk = @($res.Rows | Where-Object { $_.Fn -eq 'milk' })
Yes 'milking a cow gives the farmer Milk at novice' (
    $milk.Count -eq 1 -and $milk[0].Key -eq 'milk' -and $milk[0].Who -eq 'farmer' -and $milk[0].At -eq 0)
# collectEgg() since #628: a farmer takes a Chicken's Egg off a chicken nest,
# the sixth verb in STATION_VERBS.
$egg = @($res.Rows | Where-Object { $_.Fn -eq 'collectEgg' })
Yes 'a chicken nest gives the farmer Chicken''s Egg at novice' (
    $egg.Count -eq 1 -and $egg[0].Key -eq 'chickenEgg' -and $egg[0].Who -eq 'farmer' -and $egg[0].At -eq 0)
# hive() since #1377: a farmer takes one Honeycomb off a placed hive,
# a verb in STATION_VERBS. No rank gate.
$hive = @($res.Rows | Where-Object { $_.Fn -eq 'hive' })
Yes 'a placed hive gives the farmer Honeycomb at novice' (
    $hive.Count -eq 1 -and $hive[0].Key -eq 'honeycomb' -and $hive[0].Who -eq 'farmer' -and $hive[0].At -eq 0)
Yes 'and nothing but those six verbs is read' (
    @($res.Rows | Where-Object { @('mineSalt', 'chopWood', 'churn', 'milk', 'collectEgg', 'hive') -notcontains $_.Fn }).Count -eq 0)

Done
