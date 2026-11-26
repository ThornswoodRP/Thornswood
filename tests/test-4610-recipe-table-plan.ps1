# Actual source helper, synthetic table records, no content or native build.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts\dev\Build-RecipeTable.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Recipe builder does not parse'}
$helper=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Use-SeasonedRecipes'},$true)
if(-not $helper){throw 'Actual seasoning table helper missing'}
Invoke-Expression $helper.Extent.Text
$pass=0;$fail=0
function Check($name,$ok){if($ok){$script:pass++;Write-Output ('PASS '+$name)}else{$script:fail++;Write-Output ('FAIL '+$name)}}
$base=[pscustomobject]@{OutDesc='e8448:Skyrim.esm';BenchDesc='a5cb3:Skyrim.esm';Count=1;Inputs=2;Coct=2;InputList=@(
 [pscustomobject]@{Desc='8ac:Gourmet.esp';Count=1},[pscustomobject]@{Desc='34cdf:Skyrim.esm';Count=1});
 Conditions=@('real-source-condition');CondMasters=@('Skyrim.esm');CondIn='Gourmet.esp'}
$target=[pscustomobject]@{OutDesc='1c0c6:Thornswood-Content.esp';BenchDesc='';Count=1;Inputs=0;Coct=0;InputList=@();Conditions=@('never-true-shell');CondMasters=@();CondIn='Thornswood-Content.esp'}
$table=[ordered]@{'8ad:Gourmet.esp'=$base;'1c0c8:Thornswood-Content.esp'=$target}
$season=@{recipes=@{'e8448:Skyrim.esm'='8ad:Gourmet.esp'};dishes=@{'1c0c6:Thornswood-Content.esp'=@{of='e8448:Skyrim.esm';extra='34cdf:Skyrim.esm';recipe='1c0c8:Thornswood-Content.esp'}}}
$applied=Use-SeasonedRecipes $table $season
Check 'one exact original source supplies the planned recipe' ($applied -eq 1 -and $target.BenchDesc -eq $base.BenchDesc -and $target.Count -eq 1)
Check 'external Gourmet meat remains the real input and existing salt gains exactly one' ($target.InputList[0].Desc -eq '8ac:Gourmet.esp' -and $target.InputList[0].Count -eq 1 -and $target.InputList[1].Count -eq 2)
Check 'source conditions retain their original namespace' ($target.Conditions[0] -eq 'real-source-condition' -and $target.CondIn -eq 'Gourmet.esp')
Check 'the original recipe is unchanged' ($base.InputList[1].Count -eq 1 -and $base.Count -eq 1 -and $base.BenchDesc -eq 'a5cb3:Skyrim.esm')
$again=Use-SeasonedRecipes $table $season
Check 'a pass after Last is loaded cannot season the already-seasoned target twice' ($again -eq 1 -and $target.InputList[1].Count -eq 2)
$season.dishes['1c0c6:Thornswood-Content.esp'].extra='34d22:Skyrim.esm'
$base.Count=2;$null=Use-SeasonedRecipes $table $season
Check 'a new extra is appended and the original positive multi-portion yield is preserved' ($target.Count -eq 2 -and $target.InputList.Count -eq 3 -and $target.InputList[2].Desc -eq '34d22:Skyrim.esm' -and $target.InputList[2].Count -eq 1)
$base.BenchDesc='a5cb2:Skyrim.esm';$refused=$false
try{$null=Use-SeasonedRecipes $table $season}catch{$refused=$true}
Check 'an oven or changed bench is refused instead of being quietly moved' $refused
$base.BenchDesc='a5cb3:Skyrim.esm';$base.InputList[1].Count=[int]::MaxValue;$season.dishes['1c0c6:Thornswood-Content.esp'].extra='34cdf:Skyrim.esm';$refused=$false
try{$null=Use-SeasonedRecipes $table $season}catch{$refused=$true}
Check 'an added ingredient count cannot overflow the native signed field' $refused
Write-Output ($pass.ToString()+' passed, '+$fail+' failed')
if($fail){exit 1}
