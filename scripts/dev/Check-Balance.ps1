<#
  Check-Balance.ps1

  Reads the five generated tables and says whether the ladders line up.

  WHY

  Patrick, 21 September: "we also need to make sure the different tiers match
  across so like farmer matches with tiers of cook for their recipes, miner and
  smith, woodworker and miner and so on, so there isn't an imbalance".

  He is right and it is checkable rather than a matter of taste. Every class
  produces things at a rank and every profession consumes them at a rank, and
  the two ladders are built by different scripts using different rules against
  different records. Nothing has ever compared them. A novice Hearthcook whose
  first recipe needs a crop only an expert Farmer may grow is a dead end that
  neither table can see on its own, because each one is internally consistent.

  WHAT IT CAN SAY TODAY, AND WHAT IT CANNOT

  It compares the SHAPE of every ladder: how many things sit on each rung, and
  whether any rung is empty. An empty bottom rung is the failure that has now
  been shipped twice here, once in farming and once in gathering, and both times
  it meant a new character could do nothing at all and had no way to earn the
  rank that would have let them.

  COUNTING ROWS ON A RUNG IS NOT ENOUGH, WHICH WAS FOUND ON 21 SEPTEMBER. This
  script read the counts, found four rungs of the Enchanter/Bladebinder with 41,
  56, 40 and 24 recipes on them, and said every ladder was sound and exited 0.
  All 41 rows on that novice rung want a Heart Stone, and ores.json ranks all
  four Heart Stone deposits master, so a novice Bladebinder opens 41 recipes and
  can gather the makings for none of them. That is the same dead end as an empty
  rung wearing a label, and the label came from the second rule in
  Build-RecipeTable.ps1, which re-ranks a half by how long its shopping lists
  are when neither price nor input cost can tell its rows apart. So every rung
  is now checked for whether anybody standing on it could gather for even one
  row of it, and a half where that fails and is not written down in the table
  with a measured reason fails this script. (Patrick settled the Bladebinder on
  28 September, issue #398, by making Heart Stone deposits advanced mining. The
  miner page put heart stone back on master (#1380, #1586), and on 4 October,
  issue #1622, Patrick answered: each college book staff at its spell's rank.
  So the thirteen staves sit on novice, advanced and expert below a master
  stone, named in RECIPE_RANK and in the table's own rungsNobodyCanGatherFor.)

  It also follows a recipe to the class that produces its inputs, which it
  could not do until 21 September. game\data\recipes.json records WHICH items each
  recipe wants now and not just how many: Build-RecipeTable.ps1 read the CNTO
  subrecords to count them and dropped the form ids, and it keeps them. Every
  owned row carries inputItems, each with the class that produces that item and
  the rank it is produced at, and inputRank, the dearest of them. So the chain
  report below is a number rather than a shape: how far each half's recipes sit
  from what their inputs cost, and every case more than one rung out.

  AND IT FOLLOWS THE HOP, which it could not until 21 September. Leather Strips,
  Steel Ingot and Leather are the three commonest inputs in the whole table and
  none of them comes out of the ground: each is made at a smelter or a tanning
  rack, one of the 1679 rows nobody owns. Every input now carries suppliedBy as
  well as producedBy, the class the input rests on however many benches away,
  so this script can say which class supplies which half as a table of counts.
  The four pairings Patrick named are checked against it by name, one line each,
  and a pairing that does not hold is reported as not holding.

  Read only. It opens five json files in this repository and writes nothing
  anywhere, and it does not touch the game folder or the VPS at all.

  Usage:
    .\scripts\dev\Check-Balance.ps1
    .\scripts\dev\Check-Balance.ps1 -Quiet     the verdict lines only

  Exit code 1 if any ladder has an empty rung below its top, or a rung nobody
  standing on it could gather for that the table has not already written down
  with a reason. Those are the two shapes that are always wrong. And, since
  issue #398, if a recipe sits more than one rung from what its inputs cost
  and is not kept on purpose: see FarReason.
#>
[CmdletBinding()]
param(
    [string]$Repo = '',
    [switch]$Quiet,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }

function Head($m) { if (-not $Quiet) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray } }
function Say($m, $c = 'Gray') { if (-not $Quiet) { Write-Host $m -ForegroundColor $c } }
function Ok($m)   { Write-Host ('  ok    ' + $m) -ForegroundColor Green }
function Bad($m)  { Write-Host ('  BAD   ' + $m) -ForegroundColor Red; $script:fail++ }
function Note($m) { Write-Host ('  note  ' + $m) -ForegroundColor Yellow }

$script:fail = 0
$RANKS = @('novice', 'advanced', 'expert', 'master')

function Load($name) {
    # The tables are in game\data since phase 6 of issue #440.
    $p = Join-Path $Here ('..\..\game\data\' + $name)
    if (-not (Test-Path -LiteralPath $p)) {
        Note "$name is not built yet, so the ladder it holds is not checked. Build it and run this again."
        return $null
    }
    try { return (Get-Content -LiteralPath $p -Raw | ConvertFrom-Json) }
    catch { Bad "$name does not parse: $($_.Exception.Message)"; return $null }
}

# Counts a map of rows by their rank field and reports the shape.
#
# $notIn is another map out of the same file whose keys this class is refused.
# The gatherer is the one that needs it: bb947 Tundra Cotton and bb953 Wheat sit
# in the harvests map and in the crops map at once, because their produce is an
# INGR and the food rule that moved the other crops out of the plant table never
# touched them. game\gamemode.js harvest() opens with `if (isCrop(baseDesc))
# return null;` and onActivate sends a crop base to farmActivate, so a gatherer
# gets nothing at either plant at any rank. Counting them on the gatherer's
# ladder is counting work nobody can do. It is 2 of 109 rows on this build and
# moves no rung off empty, which is exactly why it would have sat there.
function Ladder($what, $map, $who, $notIn = $null) {
    if (-not $map) { return }
    $refused = @{}
    if ($notIn) { foreach ($k in $notIn.PSObject.Properties.Name) { $refused[$k] = $true } }
    $by = @{}
    foreach ($r in $RANKS) { $by[$r] = 0 }
    $n = 0
    foreach ($k in $map.PSObject.Properties.Name) {
        if ($refused.ContainsKey($k)) { continue }
        $row = $map.$k
        $rank = [string]$row.rank
        if (-not $rank) { continue }
        if ($by.ContainsKey($rank)) { $by[$rank]++ } else { $by[$rank] = 1 }
        $n++
    }
    if ($n -eq 0) { Note "$what has no rows with a rank on them"; return }

    $line = ($RANKS | ForEach-Object { '{0} {1}' -f $_, $by[$_] }) -join ', '
    Say ('  {0}  {1} rows: {2}' -f $what.PadRight(22), $n, $line)

    # The rule: a rung may be empty only if every rung above it is empty too.
    # An empty rung with something above it is a wall, and a wall at the bottom
    # is a character who can never start.
    $seenAbove = $false
    for ($i = $RANKS.Count - 1; $i -ge 0; $i--) {
        $r = $RANKS[$i]
        if ($by[$r] -gt 0) { $seenAbove = $true; continue }
        if ($seenAbove) {
            if ($i -eq 0) {
                Bad ("{0}: the NOVICE rung is empty and there are {1} rows above it, so a new {2} can do nothing at all and has no way to earn the rank that would let them" -f $what, $n, $who)
            } else {
                Bad ("{0}: the {1} rung is empty with rows above it, so that rank gives nothing and the next one is unreachable by doing the work" -f $what, $r)
            }
        }
    }
    return $by
}

Head 'What produces'

$ores     = Load 'ores.json'
$harvests = Load 'harvests.json'
$hunts    = Load 'hunts.json'

$shape = @{}
if ($ores)     { $shape['miner']    = Ladder 'Miner, ore veins'      $ores.ores      'miner' }
if ($harvests) { $shape['gatherer'] = Ladder 'Gatherer, plants'      $harvests.harvests 'gatherer' $harvests.crops }
if ($harvests) { $shape['farmer']   = Ladder 'Farmer, crops'         $harvests.crops 'farmer' }
if ($harvests -and $harvests.PSObject.Properties.Name -contains 'fish') {
                 $shape['fisher']   = Ladder 'Fisher, water'         $harvests.fish  'fisher' }
# THE HUNTER HAS TWO LADDERS AND THIS SCRIPT READ ONE. The food split of
# 21 September invented harvests.json's game map, seven hanging-game rows taken
# off the gatherer because a gatherer gathers reagents, and gated in
# game\gamemode.js game() on the hunter's own rank. It was the only producing
# map in the repository with no empty-rung rule anywhere over it:
# scripts\dev\Build-HarvestTable.ps1 covers its novice rung the way it covers the
# fish, and the fish are laddered here while the game was not.
#
# What that let through, measured by doing it: move CharredSkeever03 from
# advanced to expert in GAME_RANK_BY_EDITOR_ID and rebuild, and the map becomes
# novice 4, advanced 0, expert 3. The novice check in the builder still sees 4
# and passes, this script printed no line for the map at all, and the run exited
# 0 on an advanced hunter who reaches a rank that opens no new rack with two
# rows sitting above it. That is the exact shape the rule above exists to fail
# on.
#
# Its own key in $shape, because the lopsided check reads one entry per ladder
# and the bodies are a different ladder from the racks.
if ($harvests -and $harvests.PSObject.Properties.Name -contains 'game') {
                 $shape['hunter, hanging game'] = Ladder 'Hunter, hanging game' $harvests.game 'hunter' }
if ($hunts)    { $shape['hunter']   = Ladder 'Hunter, animals'       $hunts.hunts    'hunter' }

Head 'What consumes'

$recipes = Load 'recipes.json'
if ($recipes) {
    $byHalf = @{}
    # The same rows again, kept rather than counted, because the standability
    # check below has to look at what each one asks for and a count cannot.
    $rowsOf = @{}
    foreach ($k in $recipes.recipes.PSObject.Properties.Name) {
        $row = $recipes.recipes.$k
        # A recipe the server is never asked about cannot be gated, so it is not
        # part of any ladder and counting it would flatter every half that has
        # a lot of tempering in it. The Platewright is the one this matters to:
        # 2015 recipes and only 771 the server ever sees.
        if ($row.PSObject.Properties.Name -contains 'fires' -and -not $row.fires) { continue }
        $half = [string]$row.owner + '/' + [string]$row.half
        if (-not $byHalf.ContainsKey($half)) { $byHalf[$half] = @{} }
        if (-not $rowsOf.ContainsKey($half)) { $rowsOf[$half] = New-Object 'System.Collections.Generic.List[object]' }
        $rank = [string]$row.rank
        if (-not $rank) { continue }
        if (-not $byHalf[$half].ContainsKey($rank)) { $byHalf[$half][$rank] = 0 }
        $byHalf[$half][$rank]++
        $rowsOf[$half].Add($row)
    }

    $empties = @()
    foreach ($half in ($byHalf.Keys | Sort-Object)) {
        $by = $byHalf[$half]
        $tot = 0; foreach ($r in $RANKS) { if ($by.ContainsKey($r)) { $tot += $by[$r] } }
        $line = ($RANKS | ForEach-Object { '{0} {1}' -f $_, ($(if ($by.ContainsKey($_)) { $by[$_] } else { 0 })) }) -join ', '
        Say ('  {0}  {1} recipes the server is asked about: {2}' -f $half.PadRight(24), $tot, $line)
        # The SAME rung rule the producing ladders get, and the first run of this
        # script proved why it has to be here too: the Confectioner came out
        # 18 novice, 0 advanced, 10 expert, and the old check only looked at the
        # bottom rung so it said nothing. A hole in the middle is a rank that
        # gives you nothing new, which is the imbalance Patrick asked about,
        # just one rung further up than the one that has bitten us before.
        if ($tot -gt 0) {
            $seenAbove = $false
            for ($i = $RANKS.Count - 1; $i -ge 0; $i--) {
                $r = $RANKS[$i]
                $c = $(if ($by.ContainsKey($r)) { $by[$r] } else { 0 })
                if ($c -gt 0) { $seenAbove = $true; continue }
                if (-not $seenAbove) { continue }
                if ($i -eq 0) {
                    Bad ("{0}: no novice recipe, so somebody who picks that half can make nothing on their first day" -f $half)
                } else {
                    Bad ("{0}: nothing at {1} with {2} recipe(s) above it, so reaching that rank opens nothing" -f $half, $r, ($tot - $c))
                }
            }
        }

        # AND WHETHER ANYBODY CAN STAND ON THE RUNGS THAT DO HAVE ROWS ON THEM.
        # A row is standable at its rung when inputRank is null, meaning no
        # class rank stands between somebody and the makings, or when inputRank
        # is at or below that rung. A rung whose every row fails that is the
        # Bladebinder case in the header: a rank you reach, a list of recipes it
        # opens, and not one of them you can gather for.
        #
        # The table itself names the halves somebody has decided to live with,
        # in rungsNobodyCanGatherFor with the reason beside it, and
        # Build-RecipeTable.ps1 refuses to write a table with any half that is
        # not named. That is the same arrangement cannotCraftYet has: a decision
        # written down beats a check quietly passing, and a half that turns up
        # here without one is a fault in whoever changed the ranking.
        $known = ''
        if ($recipes.PSObject.Properties.Name -contains 'halves' -and
            $recipes.halves.PSObject.Properties.Name -contains $half) {
            $hv = $recipes.halves.$half
            if ($hv.PSObject.Properties.Name -contains 'rungsNobodyCanGatherFor') {
                $known = [string]$hv.rungsNobodyCanGatherFor
            }
        }
        # THE ROWS ON A RUNG DO NOT HAVE TO AGREE, AND ON THIS BUILD THEY DO NOT.
        # This line used to take the requirement off the FIRST row that failed
        # and print it as 'every one wanting X', which was a claim of uniformity
        # nothing had measured, and it reported the nearest wall rather than the
        # worst. Measured against the committed game\data\recipes.json: the novice
        # Confectioner rung is 7 rows, 5 of them wanting advanced work from a
        # gatherer and 2 of them, both named Apple Dumpling, wanting expert work
        # from a farmer. The old line said the rung was one rung and one class
        # away from standable when two of its seven rows are two rungs away and
        # behind a different class. recipes.json's own generated
        # rungsNobodyCanGatherFor for that half gets it right, so the script was
        # less accurate than the table it reads.
        #
        # Both ends are named now: the nearest, which is what somebody would have
        # to reach for the rung to open at all, and the worst, which is what they
        # would have to reach for all of it. Where every row on the rung really
        # does want the same thing the two are equal and the line says so.
        $unstandable = @()
        foreach ($r in $RANKS) {
            $on = 0
            $can = 0
            $nearAt = 99
            $nearWhat = ''
            $farAt = -1
            $farWhat = ''
            $wants = @{}
            foreach ($row in $rowsOf[$half]) {
                if ([string]$row.rank -ne $r) { continue }
                $on++
                $ir = [string]$row.inputRank
                if (-not $ir) { $can++; continue }
                if ([array]::IndexOf($RANKS, $ir) -le [array]::IndexOf($RANKS, $r)) { $can++; continue }
                $at = [array]::IndexOf($RANKS, $ir)
                $what = $ir + ' work from a ' + [string]$row.inputRankWho
                $wants[$what] = $true
                if ($at -lt $nearAt) { $nearAt = $at; $nearWhat = $what }
                if ($at -gt $farAt) { $farAt = $at; $farWhat = $what }
            }
            if ($on -eq 0 -or $can -gt 0) { continue }
            if ($wants.Count -le 1) {
                $unstandable += ('{0} ({1} recipe(s), every one wanting {2})' -f $r, $on, $nearWhat)
            } else {
                $unstandable += ('{0} ({1} recipe(s) wanting {2} different things, the nearest {3} and the furthest {4})' -f `
                                 $r, $on, $wants.Count, $nearWhat, $farWhat)
            }
        }
        # One line per half and not one per rung. The Bladebinder fails on three
        # rungs for the same reason and printing that reason three times buries
        # the halves underneath it.
        if ($unstandable.Count -gt 0) {
            if ($known) {
                Note ("{0}: nobody standing on these rungs can gather for anything they open: {1}. The table names this half itself and says why, so it is a decision rather than a fault." -f `
                      $half, ($unstandable -join '; '))
            } else {
                Bad ("{0}: nobody standing on these rungs can gather for anything they open: {1}. Reaching that rank opens nothing anybody there can make, and nothing in the table says this was decided." -f `
                     $half, ($unstandable -join '; '))
            }
        }
    }

    # The five that own nothing are a measured fact rather than a hole, and the
    # table says so itself. They are reported so nobody reads a zero as a bug,
    # and so that anybody building a panel knows not to promise them anything.
    if ($recipes.PSObject.Properties.Name -contains 'cannotCraftYet') {
        Head 'Halves that gate nothing, and why'
        foreach ($k in $recipes.cannotCraftYet.PSObject.Properties.Name) {
            Say ('  ' + $k)
            Say ('      ' + ([string]$recipes.cannotCraftYet.$k).Substring(0, [Math]::Min(150, ([string]$recipes.cannotCraftYet.$k).Length)))
        }
    }
}

Head 'Where the ladders disagree'

# The comparison that can be made without the inputs: the SHAPE. A class whose
# ladder is almost all one rung cannot feed a profession whose ladder is spread
# over four, because there is nothing at the ranks the profession is asking for.
if ($shape.Count) {
    $thin = @()
    foreach ($who in ($shape.Keys | Sort-Object)) {
        $by = $shape[$who]
        if (-not $by) { continue }
        $tot = 0; foreach ($r in $RANKS) { $tot += $by[$r] }
        if ($tot -eq 0) { continue }
        $top = 0; foreach ($r in $RANKS) { if ($by[$r] -gt $top) { $top = $by[$r] } }
        $share = [Math]::Round(100.0 * $top / $tot)
        if ($share -ge 60) { $thin += ('{0} ({1}% of it on one rung, {2} rows in all)' -f $who, $share, $tot) }
    }
    if ($thin.Count) {
        Note ('these ladders are lopsided, which is what an imbalance looks like before anybody plays it: ' + ($thin -join '; '))
    } else {
        Ok 'no producing ladder is piled onto a single rung'
    }
}

Head 'The chain: what a recipe asks for against what it is ranked at'

# THIS IS THE ANSWER TO PATRICK'S QUESTION, AS A NUMBER.
#
# Every owned row of recipes.json now carries inputItems, each with the class
# that produces it and the rank that class gets it at, and inputRank, which is
# the dearest of those. Comparing inputRank against the row's own rank says
# exactly how far a profession's ladder sits from the ladders that feed it.
#
# A row whose rank matches its inputRank is in step: you can gather the makings
# on the same rung you are allowed to use them. A row ranked BELOW what its
# inputs cost is the dead end that started all of this, a novice Hearthcook
# handed a recipe wanting a crop only an expert Farmer may grow. A row ranked
# ABOVE what its inputs cost is the other kind of waste: the makings are in
# your pack and the bench still refuses you.
#
# Only the rows the server is asked about are counted, for the same reason the
# ladder counts above skip tempering: a row the gate is never asked about
# cannot be in step or out of it with anything.
#
# WHY A ROW IS MORE THAN ONE RUNG OUT, issue #398, whose done-when is that every
# such row is one somebody looked at and kept. Every one falls under one of
# four causes, each read off the row itself, or it is a new imbalance nobody
# has looked at and this script fails on it:
#   kept         its rank is named outright in RECIPE_RANK, with the reason on
#                the row. The four charcoal grades: coke is a master
#                charburner's alone, and the kiln's menu is the only place
#                charcoal is made since #2337, so the row says it. The
#                kept smelt rows, novice smith work whatever the ore costs
#                (#1391, #1400). And the thirteen college book staves, each at
#                its spell's rank below a master miner's Heart Stone (#1622).
#   unproduced   ranked ABOVE what its inputs cost because something on its list
#                is produced by no class (Dragon Bone, Linen Wrap and the like),
#                so the price holds it up, and the row says it is kept on
#                purpose: Patrick decided on 28 September that those stay dear.
# The Bladebinder's staves were one until 28 September,
# ranked by the second rule below what a master miner's Heart Stone cost.
# Patrick made the stone advanced mining that day, and when the miner page put
# it back on master he answered #1622 on 4 October: each college book staff at
# its spell's rank. That is a decision written in RECIPE_RANK, so those rows are
# kept, and a second rule row out of step is still a new imbalance.
#
# Two rules came after those two, and each carries a reason of its own:
#   seasoned     a garlic or salt dish (#6902) takes the rank of the dish it
#                seasons, with that dish's inputs and one more, so it is out
#                for exactly the reason its unseasoned dish is. It is judged by
#                that dish's row, found through food-groups.json's season
#                table, the same map Build-RecipeTable.ps1 ranks it by. The
#                Garlic and Salted Boar Stews sit at expert because Boar Stew
#                does, held dear over Boar Meat, which nobody gathers.
#   way in       the cheapest row of a half a new character can reach, moved to
#                novice so the half has a way in (NOVICE_MUST_BE_REACHABLE),
#                in a half whose table names that rung in
#                rungsNobodyCanGatherFor with andThatIsAllowedBecause: the
#                decision is the half's, written down there. The Confectioner's
#                Apple Dumpling, behind a farmer's expert Red Apple, because
#                every Confectioner row wants flour (HALVES_WITH_AN_UNSTANDABLE_RUNG).
# Until 27 Nov 2026 this knew only the first two, so those three rows read as
# nobody's and the nightly's balance harness failed on them (#7100).
$seasonedBase = @{}
$fg = Load 'food-groups.json'
if ($fg -and $fg.PSObject.Properties.Name -contains 'season') {
    foreach ($dp in $fg.season.dishes.PSObject.Properties) {
        $dish = $dp.Value
        if (-not ($dish.PSObject.Properties.Name -contains 'recipe') -or -not $dish.recipe) { continue }
        $base = $fg.season.recipes.PSObject.Properties[[string]$dish.of]
        if ($base) { $seasonedBase[[string]$dish.recipe] = [string]$base.Value }
    }
}
function FarReason($row, [int]$gap, [string]$id = '') {
    $rf = [string]$row.rankFrom
    if ($rf -eq 'the unseasoned recipe' -and $seasonedBase.ContainsKey($id)) {
        $bid = $seasonedBase[$id]
        $b = $recipes.recipes.PSObject.Properties[$bid]
        if ($b -and [string]$b.Value.rank -eq [string]$row.rank) {
            $bgap = [array]::IndexOf($RANKS, [string]$b.Value.rank) - [array]::IndexOf($RANKS, [string]$b.Value.inputRank)
            if ([string]$b.Value.inputRank -and [Math]::Sign($bgap) -eq [Math]::Sign($gap)) {
                $why = FarReason $b.Value $bgap $bid
                if ($why -ne 'nobody') { return 'seasoned' }
            }
        }
        return 'nobody'
    }
    if ($rf.StartsWith('named outright in RECIPE_RANK')) { return 'kept' }
    if ($gap -gt 0 -and [int]$row.inputsWithNoProducer -gt 0 -and $rf.Contains('held above what its placed inputs cost') -and
        $rf.Contains('Kept on purpose')) { return 'unproduced' }
    if ($gap -lt 0 -and [string]$row.rank -eq 'novice' -and
        ([string]$row.whyThatRank).StartsWith('the cheapest row of this half that a new character can reach, moved to novice')) {
        $half = [string]$row.owner + '/' + [string]$row.half
        $hv = $recipes.halves.PSObject.Properties[$half]
        if ($hv -and ([string]$hv.Value.rungsNobodyCanGatherFor).StartsWith('the novice rung') -and [string]$hv.Value.andThatIsAllowedBecause) {
            return 'way in'
        }
    }
    return 'nobody'
}
if ($recipes) {
    $inStep = 0; $outStep = 0; $noChain = 0; $far = @()
    $farWhy = [ordered]@{ kept = 0; unproduced = 0; seasoned = 0; 'way in' = 0; nobody = 0 }
    $farNobody = @()
    $perHalf = @{}
    foreach ($k in $recipes.recipes.PSObject.Properties.Name) {
        $row = $recipes.recipes.$k
        if ($row.PSObject.Properties.Name -contains 'fires' -and -not $row.fires) { continue }
        $half = [string]$row.owner + '/' + [string]$row.half
        if (-not $perHalf.ContainsKey($half)) {
            $perHalf[$half] = [pscustomobject]@{ Chained = 0; Loose = 0; Sum = 0; Worst = 0; InStep = 0 }
        }
        $ir = [string]$row.inputRank
        if (-not $ir) { $noChain++; $perHalf[$half].Loose++; continue }
        $a = [array]::IndexOf($RANKS, [string]$row.rank)
        $b = [array]::IndexOf($RANKS, $ir)
        if ($a -lt 0 -or $b -lt 0) { $noChain++; $perHalf[$half].Loose++; continue }
        $gap = $a - $b
        $perHalf[$half].Chained++
        $perHalf[$half].Sum += [Math]::Abs($gap)
        if ([Math]::Abs($gap) -gt $perHalf[$half].Worst) { $perHalf[$half].Worst = [Math]::Abs($gap) }
        if ($gap -eq 0) { $inStep++; $perHalf[$half].InStep++ } else { $outStep++ }
        if ([Math]::Abs($gap) -gt 1) {
            # Which input it was. The row carries inputRank as the dearest of
            # them; this finds the one that set it, so the line names a thing
            # rather than a rank.
            # suppliedAt and not producedAt: what ranks a row is what the
            # chain costs, and the input that set it is usually an ingot or a
            # leather strip, which no class produces and every one of which
            # would have read producedAt null. Matching on producedAt printed
            # 'what it asks for' on 185 rows instead of naming the thing.
            $dearest = ''
            foreach ($it in $row.inputItems) {
                $at = ''
                if ($it.PSObject.Properties.Name -contains 'suppliedAt') { $at = [string]$it.suppliedAt }
                if (-not $at) { $at = [string]$it.producedAt }
                if ($at -eq $ir) { $dearest = [string]$it.name; break }
            }
            if (-not $dearest) { $dearest = 'what it asks for' }
            $which = 'above'
            if ($gap -lt 0) { $which = 'below' }
            $far += ('{0}: {1} is ranked {2} and its dearest input, {3}, is {4} work for a {5}. {6} rung(s) {7} what it costs.' -f `
                     $half, [string]$row.name, [string]$row.rank, $dearest, $ir, [string]$row.inputRankWho, [Math]::Abs($gap), $which)
            $why = FarReason $row $gap $k
            $farWhy[$why] += 1
            if ($why -eq 'nobody') { $farNobody += $far[$far.Count - 1] }
        }
    }

    if ($perHalf.Count -eq 0) {
        Note 'no recipe row carries inputItems yet, so rebuild the table with scripts\dev\Build-RecipeTable.ps1 and run this again'
    } else {
        foreach ($half in ($perHalf.Keys | Sort-Object)) {
            $h = $perHalf[$half]
            $tot = $h.Chained + $h.Loose
            if ($h.Chained -eq 0) {
                Say ('  {0}  {1} row(s), and NOT ONE of them asks for anything a class in this world produces, so there is no chain to read here at all' -f $half.PadRight(24), $tot)
                continue
            }
            $avg = [Math]::Round(($h.Sum / [double]$h.Chained), 2)
            Say ('  {0}  {1} of {2} row(s) have a producer behind them: {3} sit exactly on what their inputs cost, average gap {4} rung(s), worst {5}' -f `
                 $half.PadRight(24), $h.Chained, $tot, $h.InStep, $avg, $h.Worst)
        }
        Say ''
        Say ('  {0} row(s) are in step with what their inputs cost, {1} are not, and {2} ask for nothing any class produces.' -f $inStep, $outStep, $noChain)
    }

    # More than one rung apart is the imbalance worth a name. One rung is the
    # ranking rules rounding against each other; two or more means somebody
    # reaches a rank and the work it opens is either already in their pack or
    # still out of their reach.
    #
    # Being out of step does NOT set the exit code on its own. An empty rung is
    # always wrong and this script exits 1 for it; a recipe out of step with
    # its inputs is a thing somebody has to decide about. What does set it is a
    # row out of step for none of the reasons FarReason knows, because that is
    # one nobody has looked at, which is issue #398's done-when. It is still
    # reported with everything else rather than stopping the run.
    if ($far.Count -gt 0) {
        Note ("{0} recipe(s) are more than one rung away from what their inputs cost" -f $far.Count)
        foreach ($f in ($far | Select-Object -First 10)) { Note ('  ' + $f) }
        if ($far.Count -gt 10) { Note ("  ... and {0} more, every one of them in game\data\recipes.json with its inputItems" -f ($far.Count - 10)) }
        Say ''
        Say '  Why each of them is out, read off the row (FarReason, issue #398):'
        Say ('    {0,4}  kept on purpose: a rank named in RECIPE_RANK with its reason, the charcoal grades, the kept smelt rows and the college book staves' -f $farWhy.kept)
        Say ('    {0,4}  kept on purpose: held above its inputs because something on its list nobody gathers, Patrick 28 September' -f $farWhy.unproduced)
        Say ('    {0,4}  kept on purpose: a garlic or salt dish at the rank of the dish it seasons, which is kept for one of those reasons (#6902)' -f $farWhy.seasoned)
        Say ('    {0,4}  kept on purpose: the way into a half whose novice rung its table names as decided, rungsNobodyCanGatherFor' -f $farWhy['way in'])
        if ($farWhy.nobody -gt 0) {
            Bad ("{0} recipe(s) are more than one rung out for none of those reasons, so nobody has looked at them:" -f $farWhy.nobody)
            foreach ($f in ($farNobody | Select-Object -First 10)) { Write-Host ('          ' + $f) -ForegroundColor Red }
        } else {
            Ok 'every recipe more than one rung out is kept on purpose, and none is waiting on a decision'
        }
    } else {
        Ok 'no recipe is more than one rung away from what its inputs cost'
    }
}

Head 'Which class supplies which half'

# PATRICK, 21 September: "the farmer would supply the cook, gatherer would
# supply tailor and alchemist, miner smith, hunter tailor and smith and so on."
#
# That is a claim about the whole economy and it is now countable, which it was
# not before the hop. Every input of every owned recipe carries suppliedBy: the
# class the input rests on, however many benches away it is. A Steel Ingot is
# produced by nobody and supplied by a miner, one smelter away from his ore. A
# Leather Strip is supplied by a hunter, two benches from the hide.
#
# WHAT IS COUNTED, SAID PLAINLY. One count per input entry: a recipe wanting
# Leather Strips and Steel Ingot is one entry for the hunter and one for the
# miner, and asking for four strips is still one entry, because this is a
# question about who supplies whom and not about tonnage.
#
# EVERY OWNED ROW IS COUNTED AND NOT ONLY THE ONES THE SERVER IS ASKED ABOUT.
# The ladder counts above skip tempering, because a row the gate never sees
# cannot be in step with anything. This is a different question: somebody
# tempering a sword really does consume the ingot, and leaving 1720 tempering
# rows out would hide most of what the Smith buys from the Miner.
if ($recipes) {
    $classes = @{}
    $supplyOf = @{}
    $profOf = @{}
    foreach ($k in $recipes.recipes.PSObject.Properties.Name) {
        $row = $recipes.recipes.$k
        $half = [string]$row.owner + '/' + [string]$row.half
        $prof = [string]$row.owner
        if (-not $supplyOf.ContainsKey($half)) { $supplyOf[$half] = @{} }
        if (-not $profOf.ContainsKey($prof)) { $profOf[$prof] = @{} }
        foreach ($it in $row.inputItems) {
            $who = 'nobody'
            if ($it.PSObject.Properties.Name -contains 'suppliedBy' -and $it.suppliedBy) { $who = [string]$it.suppliedBy }
            $classes[$who] = $true
            if (-not $supplyOf[$half].ContainsKey($who)) { $supplyOf[$half][$who] = 0 }
            $supplyOf[$half][$who]++
            if (-not $profOf[$prof].ContainsKey($who)) { $profOf[$prof][$who] = 0 }
            $profOf[$prof][$who]++
        }
    }

    if ($classes.Count -eq 0) {
        Note 'no recipe row carries suppliedBy yet, so rebuild the table with scripts\dev\Build-RecipeTable.ps1 and run this again'
    } else {
        $cols = @($classes.Keys | Where-Object { $_ -ne 'nobody' } | Sort-Object) + @('nobody')
        $head = '  ' + 'half'.PadRight(24)
        foreach ($c in $cols) { $head += $c.PadLeft(10) }
        $head += 'total'.PadLeft(10)
        Say $head
        Say ('  ' + ('-' * ($head.Length - 2)))
        foreach ($half in ($supplyOf.Keys | Sort-Object)) {
            $tot = 0
            foreach ($c in $cols) { if ($supplyOf[$half].ContainsKey($c)) { $tot += $supplyOf[$half][$c] } }
            if ($tot -eq 0) { continue }
            $line = '  ' + $half.PadRight(24)
            foreach ($c in $cols) {
                $n = 0
                if ($supplyOf[$half].ContainsKey($c)) { $n = $supplyOf[$half][$c] }
                $line += ([string]$n).PadLeft(10)
            }
            $line += ([string]$tot).PadLeft(10)
            Say $line
        }
    }
}

Head 'The four pairings Patrick named, against what was measured'

# HIS OWN WORDS, 21 September, and each one is checked as written rather than
# rounded up: "the farmer would supply the cook, gatherer would supply tailor
# and alchemist, miner smith, hunter tailor and smith and so on."
$PAIRINGS = @(
    @{ Class = 'farmer';   Profession = 'Cook' },
    @{ Class = 'gatherer'; Profession = 'Tailor' },
    @{ Class = 'gatherer'; Profession = 'Alchemist' },
    @{ Class = 'miner';    Profession = 'Smith' },
    @{ Class = 'hunter';   Profession = 'Tailor' },
    @{ Class = 'hunter';   Profession = 'Smith' }
)

# WHEN A PAIRING HOLDS. INVENTED: classes.md sets no number for it.
#
# His sentence names several suppliers for the same profession, hunter and miner
# both for the Smith, so "is it the largest" is the wrong test and it was tried
# first: it reported hunter to Smith as not holding on 1685 entries of hide and
# leather, which is plainly a supply line. The test is a SHARE instead: a
# pairing holds when that class supplies at least PAIRING_MIN_SHARE of the input
# entries a profession asks for that anybody supplies at all. The largest
# supplier is named on every line either way, so a pairing that holds while
# somebody else leads reads as exactly that.
#
# Nothing is rounded up. Below the share, or supplying nothing, or a profession
# with no recipes at all, is reported as DOES NOT HOLD with the number.
#
# The denominator is the entries some class supplies. The ones nobody supplies
# are in the table above under "nobody" and are left out of the share, because a
# Dragon Bone nobody hands over is not evidence about the farmer either way.
#
# It does NOT set the exit code. Whether the world should match the sentence, or
# the sentence the world, is Patrick's to decide and not a script's.

# A fifth. Below that a class is a minor name in that trade rather than one of
# its supply lines, and above it the trade would notice if the class stopped.
# No number in classes.md sets this and nothing in the records suggests one.
$PAIRING_MIN_SHARE = 0.20
if ($recipes -and $profOf.Count -gt 0) {
    foreach ($pr in $PAIRINGS) {
        $prof = $pr.Profession
        $cls = $pr.Class
        if (-not $profOf.ContainsKey($prof)) {
            Note ("{0} to {1}: DOES NOT HOLD. The {1} owns no recipe in this build at all, so there is nothing for anybody to supply it." -f $cls, $prof)
            continue
        }
        $by = $profOf[$prof]
        $tot = 0
        foreach ($c in $by.Keys) { if ($c -ne 'nobody') { $tot += $by[$c] } }
        $mine = 0
        if ($by.ContainsKey($cls)) { $mine = $by[$cls] }
        $topWho = ''
        $topN = -1
        foreach ($c in ($by.Keys | Sort-Object)) {
            if ($c -eq 'nobody') { continue }
            if ($by[$c] -gt $topN) { $topN = $by[$c]; $topWho = $c }
        }
        if ($tot -eq 0) {
            Note ("{0} to {1}: DOES NOT HOLD. Not one input of a {1} recipe is supplied by any class in this world." -f $cls, $prof)
            continue
        }
        $share = [Math]::Round(100.0 * $mine / $tot)
        $lead = 'the largest supplier is the ' + $topWho + ' with ' + $topN
        if ($topWho -eq $cls) { $lead = 'no class supplies more' }
        if ($mine -eq 0) {
            Note ("{0} to {1}: DOES NOT HOLD. The {0} supplies nothing a {1} asks for, of {2} supplied input entries, and {3}." -f `
                  $cls, $prof, $tot, $lead)
        } elseif (($mine / [double]$tot) -ge $PAIRING_MIN_SHARE) {
            Ok ("{0} to {1}: HOLDS. The {0} supplies {2} of the {3} supplied input entries a {1} asks for, {4}%, and {5}." -f `
                $cls, $prof, $mine, $tot, $share, $lead)
        } else {
            Note ("{0} to {1}: DOES NOT HOLD. The {0} supplies {2} of {3} supplied input entries, {4}%, which is under the {5}% a supply line has to reach, and {6}." -f `
                  $cls, $prof, $mine, $tot, $share, [int]($PAIRING_MIN_SHARE * 100), $lead)
        }
    }
}

Head 'Where a profession sits below the class that grows what it asks for'

# THE OTHER HALF OF PATRICK'S QUESTION, AND THE HALF THAT WAS MISSING.
#
# The chain above reads inputRank, which is what an input costs at the CHEAPEST
# class that produces it, because that is what a recipe costs to gather for. It
# cannot see the class that has to climb furthest for the same item, and for the
# Farmer that is every item: all 11 crops in harvests.json are also plants a
# gatherer picks at the same rank or lower, so the farmer sets no inputRank
# anywhere in the table and was invisible in this report until 21 September.
#
# alsoProducedBy on an input names every class that has to be higher up its own
# ladder for the same thing. A Cook row ranked below one of those is the
# imbalance in Patrick's own words, farmer against cook, stated as a row and a
# rank rather than as a feeling.
#
# It does NOT set the exit code, for the reason the chain gaps do not: which of
# the two ladders should move is a decision, and a Confectioner baking with an
# apple a gatherer picked at novice is defensible whatever rank the farmer who
# grows one has to hold.
if ($recipes) {
    $cross = @{}
    $crossSaid = New-Object 'System.Collections.Generic.List[string]'
    $crossRows = 0
    foreach ($k in $recipes.recipes.PSObject.Properties.Name) {
        $row = $recipes.recipes.$k
        if ($row.PSObject.Properties.Name -contains 'fires' -and -not $row.fires) { continue }
        $at = [array]::IndexOf($RANKS, [string]$row.rank)
        if ($at -lt 0) { continue }
        $worst = -1
        $worstWho = ''
        $worstWhat = ''
        foreach ($it in $row.inputItems) {
            if (-not ($it.PSObject.Properties.Name -contains 'alsoProducedBy')) { continue }
            foreach ($other in $it.alsoProducedBy) {
                $oAt = [array]::IndexOf($RANKS, [string]$other.at)
                if ($oAt -le $at) { continue }
                if ($oAt -gt $worst) { $worst = $oAt; $worstWho = [string]$other.who; $worstWhat = [string]$it.name }
            }
        }
        if ($worst -lt 0) { continue }
        $crossRows++
        $pair = ([string]$row.owner + '/' + [string]$row.half + ' against the ' + $worstWho)
        if (-not $cross.ContainsKey($pair)) { $cross[$pair] = 0 }
        $cross[$pair]++
        if ($crossSaid.Count -lt 8) {
            $crossSaid.Add(('{0} is ranked {1} and wants {2}, which a {3} has to be {4} to produce' -f `
                            [string]$row.name, [string]$row.rank, $worstWhat, $worstWho, $RANKS[$worst]))
        }
    }
    if ($crossRows -eq 0) {
        Ok 'no recipe the server is asked about is ranked below a class that has to climb higher for something on its list'
    } else {
        Note ("{0} recipe(s) the server is asked about are ranked below a class that has to climb higher for something they ask for" -f $crossRows)
        foreach ($pair in ($cross.Keys | Sort-Object { -$cross[$_] })) { Note ('  {0,5}  {1}' -f $cross[$pair], $pair) }
        foreach ($s in $crossSaid) { Note ('  ' + $s) }
        if ($crossRows -gt $crossSaid.Count) {
            Note ("  ... and {0} more, every one of them in game\data\recipes.json under alsoProducedBy" -f ($crossRows - $crossSaid.Count))
        }
    }
}

Head 'What this still cannot answer'
Say '  What a thing costs when nobody makes it and nobody digs it up. The hop closed the'
Say '  smelter and the tanning rack: Steel Ingot, Leather and Leather Strips all carry a'
Say '  class now. What is left is bought, looted or dropped, and those rows keep the price'
Say '  rank and say so in rankFrom.'
# THE NUMBERS ARE COUNTED AND NOT TYPED. They were typed into this block until
# 21 September, and by the time anybody read them again they were wrong: the
# block still said 5711 of 6708 entries supplied and named Butter on 46 rows as
# one of the two worth deciding about, when the run that printed it had 5687 and
# Butter was no longer in the first five. A hardcoded measurement in a script
# that runs every build is a sentence somebody reads instead of the output, which
# is the same trap the green line at the bottom of this file was rewritten over.
if ($recipes) {
    $entries = 0
    $supplied = 0
    $loose = @{}
    foreach ($k in $recipes.recipes.PSObject.Properties.Name) {
        foreach ($it in $recipes.recipes.$k.inputItems) {
            $entries++
            if ($it.PSObject.Properties.Name -contains 'suppliedBy' -and $it.suppliedBy) { $supplied++; continue }
            $nm = [string]$it.name
            if (-not $loose.ContainsKey($nm)) { $loose[$nm] = 0 }
            $loose[$nm]++
        }
    }
    Say ('  {0} of the {1} input entries in the table are supplied by a class. The {2} that are' -f `
         $supplied, $entries, ($entries - $supplied))
    Say '  left are led by:'
    foreach ($nm in ($loose.Keys | Sort-Object { -$loose[$_] } | Select-Object -First 6)) {
        Say ('    {0,5} entries  {1}' -f $loose[$nm], $nm)
    }
    Say '  Firewood came off this list on 21 September: chopWood in gamemode.js gives it to a'
    Say '  woodworker at the four chopping blocks, and Build-RecipeTable reads that verb out of'
    Say '  the shipped file the same way it reads the kiln. Butter went the same way on 24 September:'
    Say '  churn() gives it to a farmer at the butter churn. If Butter is still in the list above,'
    Say '  recipes.json was built before that and wants building again.'
}

Write-Host ''
if ($script:fail -gt 0) {
    Write-Host ("{0} ladder problem(s). Every one of them is a rung somebody cannot climb." -f $script:fail) -ForegroundColor Red
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 1
}
# WHAT THIS LINE MAY CLAIM IS WHAT WAS CHECKED. It used to say every ladder had
# a bottom rung and nothing above an empty one, which was true of the counts and
# false of the Bladebinder, whose bottom rung held 41 recipes nobody at that rank
# could gather for. A green line that says more than the checks above did is
# worse than no line, because it is the sentence somebody reads instead of the
# output.
Write-Host 'every ladder has a bottom rung, nothing above an empty one, and every rung that holds work holds something' -ForegroundColor Green
Write-Host 'somebody at that rank could gather for, except where the table names the half and says why.' -ForegroundColor Green
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
