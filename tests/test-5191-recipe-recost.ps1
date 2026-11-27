<#
  test-5191-recipe-recost.ps1

      pwsh -NoProfile -File .\tests\test-5191-recipe-recost.ps1

  #5191, stage 4e, Patrick's B on q-5191-last-plugin-loop: the steps before
  Build-LastPlugin.py never read Thornswood-Last.esp, and each takes that
  plugin's effect from the data that decides it. The -WithoutLast box run on
  16 Nov 2026 found recipes.json and recost.json were two: without the Last
  plugin 48 recipes kept their mod's counts and the coins of the forge
  recipes that charge them, and so the Dragonguard Katana and the Colovian
  Composite Bow were ranked by price (expert, advanced) and not by what their
  inputs cost (advanced, novice). Build-RecipeTable.ps1 now never reads the
  Last plugin and gives each row of game/data/recost.json its new counts
  itself, reading the file back (#4087).

  Held here:

    1. Use-RecostCounts, lifted out of the script and run: a re-costed row
       takes its new counts; a row whose coins go to 0 loses that input and
       one from its count of inputs; a row whose recipe no longer has the
       inputs recost.json measured, and a row of a recipe not in the load
       order, are left alone and named.
    2. The script leaves Thornswood-Last.esp out of the order it reads and
       names it nowhere else as a plugin read.
       Since #4625 it reads recost.json's notCopied rows as well: a
       never-copied plugin's record keeps its mod's counts, but every game
       sets the counts that row gives it (RECIPES_SET_IN_GAME), coins to 0,
       and the table had kept listing the Eyepatch's gold coin.
    3. Run over the box's two builds of 16 Nov 2026 (the table without the
       Last plugin, and recost.json with it) when they are on this machine:
       the counts come out those of the table with it, row for row. Prints
       SKIP elsewhere: the builds are not in the repository.

  Needs pwsh only. No game, no network.
#>
param([string]$Without = '', [string]$Recost = '', [string]$With = '')
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

$table = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/dev/Build-RecipeTable.ps1'))
$fn = [regex]::Match($table, '(?ms)^function Use-RecostCounts\(\$recipes, \$rows\) \{.*?^\}')
Yes '1 the script has a Use-RecostCounts' $fn.Success
if ($fn.Success) {
    . ([scriptblock]::Create($fn.Value))
    function Row([string]$d, $pairs) {
        [pscustomobject]@{ Desc = $d; Inputs = $pairs.Count; InputList = @($pairs | ForEach-Object { [pscustomobject]@{ Desc = $_[0]; Count = $_[1] } }) }
    }
    function Line($r) { (@($r.InputList | ForEach-Object { $_.Desc + 'x' + $_.Count }) -join ' ') + ' / ' + $r.Inputs }
    $recipes = [ordered]@{
        'a:Mod.esp' = (Row 'a:Mod.esp' @(, @('strip:Skyrim.esm', 2)))
        'b:Mod.esp' = (Row 'b:Mod.esp' @(@('ingot:Skyrim.esm', 1), @('f:Skyrim.esm', 25), @('strip:Skyrim.esm', 1)))
        'c:Mod.esp' = (Row 'c:Mod.esp' @(, @('strip:Skyrim.esm', 3)))
    }
    $rows = @(
        [pscustomobject]@{ recipe = 'a:Mod.esp'; inputs = @([pscustomobject]@{ item = 'strip:Skyrim.esm'; count = 2; to = 5 }) }
        [pscustomobject]@{ recipe = 'b:Mod.esp'; inputs = @(
            [pscustomobject]@{ item = 'ingot:Skyrim.esm'; count = 1; to = 1 }
            [pscustomobject]@{ item = 'f:Skyrim.esm'; count = 25; to = 0 }
            [pscustomobject]@{ item = 'strip:Skyrim.esm'; count = 1; to = 1 }) }
        [pscustomobject]@{ recipe = 'c:Mod.esp'; inputs = @([pscustomobject]@{ item = 'strip:Skyrim.esm'; count = 2; to = 5 }) }
        [pscustomobject]@{ recipe = 'gone:Mod.esp'; inputs = @([pscustomobject]@{ item = 'strip:Skyrim.esm'; count = 1; to = 2 }) }
    )
    $got = Use-RecostCounts $recipes $rows
    Yes '1 a re-costed row takes its new counts' ((Line $recipes['a:Mod.esp']) -eq 'strip:Skyrim.esmx5 / 1')
    Yes '1 a row whose coins go to 0 loses them, and one from its count of inputs' ((Line $recipes['b:Mod.esp']) -eq 'ingot:Skyrim.esmx1 strip:Skyrim.esmx1 / 2')
    Yes '1 a row whose recipe no longer has the inputs measured is left as its mod has it' ((Line $recipes['c:Mod.esp']) -eq 'strip:Skyrim.esmx3 / 1')
    Yes ('1 it answers which it changed and which it left (' + ($got.Applied -join ' ') + ' / ' + ($got.Stale -join ' ') + ')') (
        ($got.Applied -join ' ') -eq 'a:Mod.esp b:Mod.esp' -and ($got.Stale -join ' ') -eq 'c:Mod.esp gone:Mod.esp')
}

Yes '2 the script leaves Thornswood-Last.esp out of the order it reads' (
    $table.Contains('$order.RemoveAll([Predicate[string]] { param($p) $p -ieq $LAST_PLUGIN })') -and -not $table.Contains('$pl -eq $LAST_PLUGIN'))
Yes '2 and takes the re-costed counts from game\data\recost.json' ($table.Contains('$recostGot = Use-RecostCounts $recipes $recostRows'))
Yes '2 its notCopied rows too, whose counts each game sets, so no row lists the coins every game takes out (#4625)' (
    $table.Contains('$recostRows = @(@($recostData.recipes) + @($recostData.notCopied) | Where-Object { $_ })'))

if ($fn.Success -and $Without -and $Recost -and $With -and (Test-Path -LiteralPath $Without) -and (Test-Path -LiteralPath $Recost) -and (Test-Path -LiteralPath $With)) {
    $wo = [IO.File]::ReadAllText($Without) | ConvertFrom-Json
    $wl = [IO.File]::ReadAllText($With) | ConvertFrom-Json
    $rc = [IO.File]::ReadAllText($Recost) | ConvertFrom-Json
    $all = [ordered]@{}
    foreach ($p in $wo.recipes.PSObject.Properties) {
        $all[$p.Name] = [pscustomobject]@{ Inputs = [int]$p.Value.inputs; InputList = @(@($p.Value.inputItems) | ForEach-Object { [pscustomobject]@{ Desc = [string]$_.item; Count = [int]$_.count } }) }
    }
    $got = Use-RecostCounts $all @($rc.recipes)
    $bad = 0
    foreach ($p in $wl.recipes.PSObject.Properties) {
        $want = (@(@($p.Value.inputItems) | ForEach-Object { [string]$_.item + 'x' + [int]$_.count }) -join ' ') + ' / ' + [int]$p.Value.inputs
        if (-not $all.Contains($p.Name) -or (Line $all[$p.Name]) -ne $want) { $bad++ }
    }
    Yes ('3 over the box''s two builds, ' + $got.Applied.Count + ' rows re-costed and every row''s counts are the table''s with the Last plugin (' + $bad + ' differ)') ($bad -eq 0 -and $got.Stale.Count -eq 0)
} else {
    Write-Host 'SKIP  3 the box''s two builds of 16 Nov 2026 are not on this machine (-Without, -Recost, -With)'
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
