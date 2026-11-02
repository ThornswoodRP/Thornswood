<#
  RepoPlugins.ps1

  The plugins this repository builds and ships itself, in one list (#2486).
  Thornswood-Content.esp is made under game\content (Add-ContentRecords.py
  and friends) and sent from there, never from a Vortex folder, so a rebuild
  reaches the servers and the packs with no collection revision.
  Thornswood-Last.esp (#2468) is built by Build-LastPlugin.py too, but since
  #2791 it reaches them as its recipe, game\data\last-plugin.recipe: it
  copies other authors' records, so no repository holds it, and the box and
  each launcher make it from the recipe (Ship-Rules.ps1 $ShipMadeFromRecipe,
  scripts\deploy\LastPluginOnBox.ps1). It is still ours in every place
  below; Get-ThornswoodRepoPluginPath names no file for it.

  Every place that tells ours from the collection's reads this list:
    Ship-Rules.ps1           $ShipOursFiles, Ensure-ShipRequiredData
    Publish-Update.ps1        Test-FromCollection
    ServerContent.ps1        what the box holds, by size and sha256 (#2308)
    Deploy-Server.ps1 and Deploy-DevGamemode.ps1    sent from the repo, held by sha256
    CollectionPlugins.ps1    never held to records\collection-plugins.json (#2019)
  game\gamemode.js serves the same names (OURS, #1180), and
  launcher\tests\test-1180-own-plugins.js holds that list to $ShipOursFiles.

  Until #2486 each of those places named Thornswood-Content.esp alone, so
  Thornswood-Last.esp, built here too, fell through to "the collection's" in
  all of them and every rebuild needed a collection revision from Vortex.

  Defines a variable and functions and nothing else.
#>

$ThornswoodRepoPlugins = @('Thornswood-Content.esp', 'Thornswood-Last.esp')

# Whether a plugin name, or a Data\ path of one, is ours.
function Test-ThornswoodRepoPlugin([string]$Name) {
    if (-not $Name) { return $false }
    $n = $Name.Replace('/', '\')
    if ($n -match '^(?i)Data\\') { $n = $n.Substring(5) }
    if ($n.Contains('\')) { return $false }
    return [bool](@($ThornswoodRepoPlugins) -icontains $n)
}

# Where the repo keeps one of them.
function Get-ThornswoodRepoPluginPath([string]$RepoDir, [string]$Name) {
    return (Join-Path $RepoDir ('game\content\' + $Name))
}