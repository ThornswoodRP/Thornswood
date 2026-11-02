# The covered bodies and the behavior files are built on each computer by the
# launcher since #3715 (Patrick, 27 Oct: "The launcher makes all 45 files on
# each computer"), so no update and no installer carries them, and no update
# lists them as removed: an install keeps what its own build made. A nearby
# file of the collection that nothing builds stays the collection's.
# Velopack's Setup.exe carries no game files: the game comes from the feed's
# packs, which Publish-Update makes, and on dev from the merge release's game
# files, built over the dev feed's last release (Build-GameFiles.ps1). So
# Publish-Update is the one that decides; the old installer's
# Package-Thornswood.ps1, read here until #4824, went with it.
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\Ship-Rules.ps1')
$pass=0; $fail=0
function Yes([string]$what,[bool]$ok){if($ok){$script:pass++;Write-Host "PASS $what"}else{$script:fail++;Write-Host "FAIL $what"}}
$bodies=@(@('femalebody_0.nif','femalebody_1.nif','femalebodyastrid_0.nif','femalebodyastrid_1.nif','malebody_0.nif','malebody_1.nif') | ForEach-Object {'Data\meshes\actors\character\character assets\'+$_}) + @($ShipGeneratedOutfitFiles)
$behaviors=@('Data\meshes\animationdatasinglefile.txt','Data\meshes\animationsetdatasinglefile.txt','Data\meshes\actors\character\behaviors\0_master.hkx','Data\meshes\actors\character\characters\defaultmale.hkx')
foreach($b in $bodies + $behaviors){
  Yes "$([IO.Path]::GetFileName($b)) is built on each computer: never shipped and never listed as removed" ((Test-ShipGenerated $b) -and (Test-ShipMachine $b))
  Yes "  and in any letter case" ((Test-ShipGenerated $b.ToUpperInvariant()) -and (Test-ShipMachine $b.ToUpperInvariant()))
}
$other='Data\meshes\actors\character\character assets\femalehands_0.nif'
Yes 'a file of the collection nothing builds is not taken for one built here' (-not (Test-ShipGenerated $other))
$rules=[IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Ship-Rules.ps1'))
Yes 'Ship-Rules no longer reads the record to ship what it lists' ($rules -notmatch 'function Get-ShipGeneratedFiles' -and $rules -notmatch 'function Assert-ShipGeneratedBod')
foreach($scriptName in 'Publish-Update.ps1'){
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo ('scripts\release\'+$scriptName)),[ref]$tokens,[ref]$errors)
  Yes "$scriptName parses" ($errors.Count -eq 0)
  $text=$ast.Extent.Text
  Yes "$scriptName neither reads nor checks the generated record" ($text -notmatch 'Get-ShipGeneratedFiles|Assert-ShipGeneratedBodies|\$shipGeneratedFiles')
  $fn=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-FromCollection'},$true) | Select-Object -First 1
  Yes "$scriptName has Test-FromCollection" ($null -ne $fn)
  if(-not $fn){continue}
  $vortexFiles=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach($b in $bodies){[void]$vortexFiles.Add($b)}
  [void]$vortexFiles.Add($other)
  . ([scriptblock]::Create($fn.Extent.Text))
  Yes "$scriptName counts a body Vortex deploys as the collection's, so it is never taken for ours" (Test-FromCollection $bodies[0])
  Yes "$scriptName still counts a collection file as the collection's" (Test-FromCollection $other)
}
$publish=[IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Publish-Update.ps1'))
Yes 'Publish-Update never makes a built file hash-gone, so no update deletes what an install built' ($publish -match '\(Test-ShipBackup \$k\) -or \(Test-ShipGenerated \$k\)\) \{ continue \}')
Write-Host "$pass passed, $fail failed"
if($fail){exit 1}
