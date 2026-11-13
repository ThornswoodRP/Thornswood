<#
  test-balance-ladders.ps1

      pwsh -NoProfile -File .\game\tests\test-balance-ladders.ps1

  Issue #398: the ladders line up across classes and professions. Done when
  Check-Balance.ps1 runs green, no half has an empty rung with work above it,
  and every recipe whose inputs sit more than one rung from its own rank is one
  somebody looked at and kept. This proves the parts that are code:

  1. THE TABLE IS IN STEP WITH THE PRODUCER TABLES IT WAS BUILT FROM. Every
     input that an ore vein, a plant, a crop or a fish hands over directly
     carries a producer in game\data\recipes.json, at a rank no dearer than the
     cheapest of those tables. The table on main before this was built before
     Tundra Cotton moved to the gatherer (#626) and the farmer's milk (#859),
     and read Thread as advanced farmer work for 188 recipes.
  2. NO HALF HAS AN EMPTY RUNG WITH WORK ABOVE IT, over every owned row and over
     the rows the server is asked about.
  2b. PATRICK'S ANSWERS OF 28 SEPTEMBER ARE IN THE TABLES, with the Heart Stone
     moved back to master by the miner page (issue #1380): every Heart Stone
     deposit is master mining and the miner has 24 master deposits; the 161
     Bladebinder staves sit on all four rungs and no half needs the second rule;
     every row held dear by something nobody gathers says in rankFrom that it
     is kept on purpose. With the stone on master, Patrick answered #1622 on
     4 October: each college book staff at its spell's rank. So a staff more
     than one rung below its stone is one of the book's, named in RECIPE_RANK,
     and no other staff is; until then the check was that none was.
  3. THE ONE RUNG HOLE FILL does what HOLE_FILL_MOVES_ONE_RUNG says: it closes a
     hole next to a crowded rung without moving any row more than one rung or
     any pinned row, and a half it cannot close (every row on master, the
     Bladebinder's shape) is handed back exactly as it came. The function is
     lifted out of Build-RecipeTable.ps1's syntax tree, so it is the shipped
     code under test and not a copy. The full build needs the game's plugins
     and takes minutes, so it is not run here.
  4. CHECK-BALANCE RUNS GREEN, which now includes: every row more than one rung
     out is kept on purpose, and none is waiting on a decision.
  5. THE THREE DECISIONS ARE STILL ONE LINE EACH, set as Patrick answered:
     RANK_BY_ORE names the Heart Stone master, CROP_COSTS_THE_FARMERS_RANK is
     off and UNPLACED_INPUT_RULE is 'floor'.

  -Repo points it at another checkout, which is how it was shown to fail on
  main before this change (checks 1 and 4).

  Read only.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }

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

$RANKS = @('novice', 'advanced', 'expert', 'master')
function At([string]$r) { return [array]::IndexOf($RANKS, $r) }

$data = Join-Path $Repo 'game\data'
$recipes = Get-Content -LiteralPath (Join-Path $data 'recipes.json') -Raw | ConvertFrom-Json
$ores = Get-Content -LiteralPath (Join-Path $data 'ores.json') -Raw | ConvertFrom-Json
$harv = Get-Content -LiteralPath (Join-Path $data 'harvests.json') -Raw | ConvertFrom-Json

# ---- 1. in step with the producer tables --------------------------------
$cheapest = @{}
function Offer([string]$desc, [string]$rank) {
    if (-not $desc -or (At $rank) -lt 0) { return }
    if (-not $cheapest.ContainsKey($desc) -or (At $rank) -lt (At $cheapest[$desc])) { $cheapest[$desc] = $rank }
}
foreach ($k in $ores.ores.PSObject.Properties.Name) { Offer ([string]$ores.ores.$k.ore) ([string]$ores.ores.$k.rank) }
$crops = @{}
foreach ($k in $harv.crops.PSObject.Properties.Name) { $crops[$k] = $true; Offer ([string]$harv.crops.$k.produce) ([string]$harv.crops.$k.rank) }
foreach ($k in $harv.harvests.PSObject.Properties.Name) {
    if ($crops.ContainsKey($k)) { continue }
    Offer ([string]$harv.harvests.$k.produce) ([string]$harv.harvests.$k.rank)
}
foreach ($k in $harv.fish.PSObject.Properties.Name) { Offer ([string]$harv.fish.$k.produce) ([string]$harv.fish.$k.rank) }
Yes ('the producer tables name items to check against ({0})' -f $cheapest.Count) ($cheapest.Count -gt 50)

$missing = @{}
$dearer = @{}
$checked = 0
foreach ($k in $recipes.recipes.PSObject.Properties.Name) {
    $row = $recipes.recipes.$k
    foreach ($it in @($row.inputItems)) {
        if ($null -eq $it) { continue }
        $d = [string]$it.item
        if (-not $cheapest.ContainsKey($d)) { continue }
        $checked++
        if (-not $it.producedBy) { $missing[[string]$it.name] = $true; continue }
        if ((At ([string]$it.producedAt)) -gt (At $cheapest[$d])) {
            $dearer[('{0}: {1} in the table, {2} in the producer tables' -f $it.name, $it.producedAt, $cheapest[$d])] = $true
        }
    }
}
foreach ($m in @($missing.Keys | Select-Object -First 5)) { Write-Host "      no producer on: $m" }
foreach ($m in @($dearer.Keys | Select-Object -First 5)) { Write-Host "      dearer than its producer: $m" }
Yes ("every one of the {0} input entries a producer table hands over carries a producer" -f $checked) ($missing.Count -eq 0)
Yes 'and none is dearer in recipes.json than the cheapest producer table puts it, so the table is not stale' ($dearer.Count -eq 0)

# ---- 2. no hole in any half --------------------------------------------
$holes = @()
foreach ($firingOnly in @($false, $true)) {
    $by = @{}
    foreach ($k in $recipes.recipes.PSObject.Properties.Name) {
        $row = $recipes.recipes.$k
        if ($firingOnly -and $row.fires -eq $false) { continue }
        $h = [string]$row.owner + '/' + [string]$row.half
        if (-not $by.ContainsKey($h)) { $by[$h] = @(0, 0, 0, 0) }
        $i = At ([string]$row.rank)
        if ($i -ge 0) { $by[$h][$i]++ }
    }
    foreach ($h in $by.Keys) {
        $c = $by[$h]
        for ($i = 0; $i -lt 4; $i++) {
            if ($c[$i] -gt 0) { continue }
            $above = 0
            for ($j = $i + 1; $j -lt 4; $j++) { $above += $c[$j] }
            if ($above -gt 0) { $holes += ('{0} {1} ({2})' -f $h, $RANKS[$i], $(if ($firingOnly) { 'rows the server is asked about' } else { 'every owned row' })); break }
        }
    }
}
foreach ($h in $holes) { Write-Host "      empty rung with work above it: $h" }
Yes 'no half has an empty rung with work above it, every owned row or only the firing rows' ($holes.Count -eq 0)

$moved = 0
foreach ($k in $recipes.recipes.PSObject.Properties.Name) {
    if (([string]$recipes.recipes.$k.rankFrom).StartsWith('moved one rung')) { $moved++ }
}
$second = @()
foreach ($h in $recipes.halves.PSObject.Properties.Name) {
    if ($recipes.halves.$h.PSObject.Properties.Name -contains 'secondRule') { $second += $h }
}
Write-Host ("      second rule used by: {0}; rows moved one rung: {1}" -f ($second -join ', '), $moved)
# Patrick, 28 September: the Bladebinder's staves are ranked by what they
# cost and no half needs the second rule any more. Heart Stone went back to
# master on the miner page (issue #1380); the staves still do not need it.
Yes 'no half needs the second rule' ($second.Count -eq 0)

# ---- 2b. Patrick's three answers of 28 September, read off the tables ------
$heart = @($ores.ores.PSObject.Properties | Where-Object { [string]$_.Value.name -eq 'Heart Stone' })
Yes ('every Heart Stone deposit is master mining, the miner page''s rank ({0} of them)' -f $heart.Count) (
    $heart.Count -eq 4 -and @($heart | Where-Object { [string]$_.Value.rank -ne 'master' }).Count -eq 0)
Yes 'and ores.json says why, under rankNamedOutright' (
    $ores.PSObject.Properties.Name -contains 'rankNamedOutright' -and
    ([string]$ores.rankNamedOutright.DLC2HeartStone).StartsWith('master'))
$masters = @($ores.ores.PSObject.Properties | Where-Object { [string]$_.Value.rank -eq 'master' }).Count
Yes ('the miner has 24 master deposits ({0})' -f $masters) ($masters -eq 24)
$bb = @($recipes.recipes.PSObject.Properties | Where-Object { [string]$_.Value.owner -eq 'Enchanter' -and [string]$_.Value.half -eq 'Bladebinder' } | ForEach-Object { $_.Value })
$bbBy = @(0, 0, 0, 0); $bbFar = 0; $bbBook = 0
foreach ($r in $bb) {
    $bbBy[(At ([string]$r.rank))]++
    if ([string]$r.inputRank -and [Math]::Abs((At ([string]$r.rank)) - (At ([string]$r.inputRank))) -gt 1) {
        # Patrick, 4 October (#1622): each college book staff at its spell's
        # rank, which is a rank named in RECIPE_RANK on a staff the book keeps.
        if ([string]$r.rankFrom -eq 'named outright in RECIPE_RANK' -and [string]$r.book -ne 'cut') { $bbBook++ } else { $bbFar++ }
    }
}
Write-Host ("      Bladebinder staves: novice {0}, advanced {1}, expert {2}, master {3}" -f $bbBy[0], $bbBy[1], $bbBy[2], $bbBy[3])
Yes 'the staves spread over all four rungs' (
    $bb.Count -eq 161 -and $bbBy[0] -gt 0 -and $bbBy[1] -gt 0 -and $bbBy[2] -gt 0 -and $bbBy[3] -gt 0)
Yes ('a staff more than one rung below its stone is a college book staff named in RECIPE_RANK at its spell''s rank ({0}), and no other staff is' -f $bbBook) (
    $bbBook -gt 0 -and $bbFar -eq 0)
$held = @($recipes.recipes.PSObject.Properties | Where-Object { ([string]$_.Value.rankFrom).Contains('held above what its placed inputs cost') } | ForEach-Object { $_.Value })
$notKept = @($held | Where-Object { -not ([string]$_.rankFrom).Contains('Kept on purpose') })
Yes ('every row held dear by something nobody gathers says it is kept on purpose ({0} rows)' -f $held.Count) ($held.Count -gt 0 -and $notKept.Count -eq 0)

# ---- 3. the one rung hole fill, lifted out of the build script ------------
$build = Join-Path $Repo 'scripts\dev\Build-RecipeTable.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($build, [ref]$tokens, [ref]$errors)
Yes 'Build-RecipeTable.ps1 parses' ($errors.Count -eq 0)
$want = 'FillHolesOneRung', 'RungShare', 'CountRungs', 'HoleIn', 'RankAt', 'SecondRuleKey'
$found = @{}
foreach ($n in $want) {
    $f = $ast.Find({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n }.GetNewClosure(), $true)
    if ($f) { $found[$n] = $f; . ([scriptblock]::Create($f.Extent.Text)) }
}
Yes ('it defines ' + ($want -join ', ')) ($found.Count -eq $want.Count)
function Knob([string]$name) {
    $a = $ast.Find({ param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -eq $name }.GetNewClosure(), $true)
    return $a
}
foreach ($k in '$RANK_SHARE', '$SECOND_RULE_KEY') { $a = Knob $k; if ($a) { . ([scriptblock]::Create($a.Extent.Text)) } }
Yes 'HOLE_FILL_MOVES_ONE_RUNG is a knob and it is on' ((Knob '$HOLE_FILL_MOVES_ONE_RUNG') -and (Knob '$HOLE_FILL_MOVES_ONE_RUNG').Right.Extent.Text -eq '$true')
if ($found.Count -ne $want.Count) { Done }

function Row([string]$rank, [int]$value, [string]$inputRank, [bool]$pinned = $false) {
    return [pscustomobject]@{ Edid = ''; OutName = ''; Rank = $rank; RankFrom = 'what it sells for'; RankWhy = 'test';
        InputRank = $inputRank; Value = $value; InputList = @(); Pinned = $pinned }
}

# The Liverywright's shape on 28 September: a crowd on novice, a few on
# advanced, nothing on expert and ten price-held rows on master.
$owned = @{}
$descs = @()
for ($i = 0; $i -lt 8; $i++) { $owned["n$i"] = Row 'novice' (5 + $i) 'novice'; $descs += "n$i" }
$owned['a0'] = Row 'advanced' 25 'advanced'; $descs += 'a0'
for ($i = 0; $i -lt 10; $i++) { $owned["m$i"] = Row 'master' (100 + $i) 'novice'; $descs += "m$i" }
$owned['m9'].Pinned = $true
$before = @{}; foreach ($d in $descs) { $before[$d] = $owned[$d].Rank }
$moves = FillHolesOneRung $descs
$c = CountRungs $descs
Yes 'a hole at expert under a crowded master rung is closed' ($null -ne $moves -and (HoleIn $c) -lt 0)
$far = 0; foreach ($d in $descs) { if ([Math]::Abs((At $owned[$d].Rank) - (At $before[$d])) -gt 1) { $far++ } }
Yes 'and no row moved more than one rung' ($far -eq 0)
Yes ('the expert rung takes its share of the ten, not all of them ({0} moved, master keeps {1})' -f $c['expert'], $c['master']) ($c['expert'] -ge 1 -and $c['master'] -ge 1)
Yes 'the cheapest master rows are the ones that moved down' ($owned['m0'].Rank -eq 'expert' -and $owned['m8'].Rank -eq 'master')
Yes 'a pinned row never moves' ($owned['m9'].Rank -eq 'master')
Yes 'a moved row says so in rankFrom' (([string]$owned['m0'].RankFrom).StartsWith('moved one rung from master'))

# The Confectioner's shape: nothing on novice, two rungs above it.
$owned = @{}
$descs = @()
for ($i = 0; $i -lt 6; $i++) { $owned["a$i"] = Row 'advanced' (6 + $i) 'advanced'; $descs += "a$i" }
for ($i = 0; $i -lt 3; $i++) { $owned["e$i"] = Row 'expert' 14 'expert'; $descs += "e$i" }
$moves = FillHolesOneRung $descs
$c = CountRungs $descs
Yes 'an empty novice rung is filled from advanced, one rung down' ($null -ne $moves -and (HoleIn $c) -lt 0 -and $c['novice'] -ge 1 -and $c['advanced'] -ge 1)

# The Bladebinder's shape: every row on master. One rung cannot close three
# holes, so nothing moves and the build goes on to the second rule.
$owned = @{}
$descs = @()
for ($i = 0; $i -lt 12; $i++) { $owned["m$i"] = Row 'master' 5 'master'; $descs += "m$i" }
$moves = FillHolesOneRung $descs
$still = @($descs | Where-Object { $owned[$_].Rank -ne 'master' -or $owned[$_].RankFrom -ne 'what it sells for' })
Yes 'every row on master is handed back unchanged for the second rule' ($null -eq $moves -and $still.Count -eq 0)

# ---- 4. Check-Balance runs green -----------------------------------------
$cb = Join-Path $Repo 'scripts\dev\Check-Balance.ps1'
$out = & pwsh -NoProfile -File $cb -NoPause 2>&1 | Out-String
$code = $LASTEXITCODE
foreach ($l in ($out -split "`r?`n")) { if ($l -match '^\s+BAD') { Write-Host ('      ' + $l.Trim()) } }
Yes 'Check-Balance.ps1 exits 0' ($code -eq 0)
Yes 'and says every row more than one rung out is kept on purpose, none waiting on a decision' (
    $out -match 'every recipe more than one rung out is kept on purpose, and none is waiting on a decision' -or
    $out -match 'no recipe is more than one rung away from what its inputs cost')
Yes 'and no line of it says a row is waiting on Patrick' ($out -notmatch 'waiting on Patrick')

# ---- 5. the decisions are one line each, set as Patrick answered ----------
Yes 'the wild crop decision is one knob, and it stays off' ((Knob '$CROP_COSTS_THE_FARMERS_RANK') -and (Knob '$CROP_COSTS_THE_FARMERS_RANK').Right.Extent.Text -eq '$false')
Yes 'what an input nobody produces costs is one knob, and it stays floor' ((Knob '$UNPLACED_INPUT_RULE') -and (Knob '$UNPLACED_INPUT_RULE').Right.Extent.Text -eq "'floor'")
$oreAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts\dev\Build-OreTable.ps1'), [ref]$tokens, [ref]$errors)
$rbo = $oreAst.Find({ param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -eq '$RANK_BY_ORE' }, $true)
Yes 'the Heart Stone decision is one entry in RANK_BY_ORE in Build-OreTable.ps1' ($errors.Count -eq 0 -and $rbo -and $rbo.Extent.Text -match "'DLC2HeartStone'\s*=\s*@\{\s*Rank\s*=\s*'master'")

Done
