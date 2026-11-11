<#
  test-2791-recipe-permissions.ps1

      pwsh -NoProfile -File tests\test-2791-recipe-permissions.ps1

  #2791. Thornswood-Last.esp is made on each machine from its recipe,
  game\data\last-plugin.recipe, which names every plugin a record is copied
  from. Patrick decided B on 22 Oct 2026: records whose author does not allow
  us to hand them out are rebuilt as our own. So no record may be copied from
  a plugin whose permission to copy is not on record, and the builder has to
  stop on one rather than write it into the recipe.

  What this holds:
    1  every plugin the committed recipe copies from is Bethesda's, ours
       (Thornswood-Content.esp), or has a permission to copy on record in
       game\data\last-plugin-policy.json "copyAllowed", each naming the
       decision that allows it. A plugin with none fails with what the
       recipe copies from it and whose it is (records\collection-permissions.json).
    2  scripts\mods\Build-LastPlugin.py reads "copyAllowed" and stops on a
       record from a plugin outside it.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Output ('PASS  ' + $what) } else { $script:fail++; Write-Output ('FAIL  ' + $what) }
}

# ---- the recipe's sources, and what each step takes from them
$b = [IO.File]::ReadAllBytes((Join-Path $Repo 'game/data/last-plugin.recipe'))
$script:p = 0
function VI {
    $n = [long]0; $s = 0
    while ($true) {
        $x = $b[$script:p]; $script:p++
        $n = $n -bor ([long]($x -band 0x7F) -shl $s)
        if (-not ($x -band 0x80)) { return $n }
        $s += 7
    }
}
$magic = [Text.Encoding]::ASCII.GetString($b, 0, 4)
Yes 'the recipe starts TSLR, version 1' ($magic -eq 'TSLR' -and $b[4] -eq 1)
$script:p = 5 + 4 + 32
$count = VI
$src = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt $count; $i++) {
    $kind = $b[$script:p]; $script:p++
    $len = VI
    $name = [Text.Encoding]::UTF8.GetString($b, $script:p, $len); $script:p += $len
    $null = VI; $script:p += 32
    $src.Add([pscustomobject]@{ Kind = $kind; Name = $name; Records = 0; Bytes = [long]0; Strings = 0 })
}
$cur = -1
while ($script:p -lt $b.Length) {
    $op = $b[$script:p]; $script:p++
    switch ($op) {
        0 { $n = VI; $script:p += $n }
        1 { $s = VI; $null = VI; $cur = $s; $src[$s].Records++ }
        2 { $null = VI; $n = VI; $src[$cur].Bytes += $n }
        3 { $s = VI; $null = VI; $src[$s].Strings++ }
        default { throw ('the recipe has an unknown step ' + $op + ' at byte ' + ($script:p - 1)) }
    }
}

# A string table is its plugin's: skyrim_english.strings is Skyrim.esm's.
$plugins = [ordered]@{}
foreach ($s in $src) { if ($s.Kind -eq 0) { $plugins[$s.Name.ToLowerInvariant()] = [pscustomobject]@{ Name = $s.Name; Records = $s.Records; Bytes = $s.Bytes; Strings = 0 } } }
foreach ($s in $src) {
    if ($s.Kind -ne 1) { continue }
    $base = ($s.Name -replace '_[A-Za-z]+\.(dl|il)?strings$', '').ToLowerInvariant()
    $owner = @($plugins.Keys | Where-Object { [IO.Path]::GetFileNameWithoutExtension($_) -eq $base }) | Select-Object -First 1
    if ($owner) { $plugins[$owner].Strings += $s.Strings }
}

$bethesda = @('skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm', '_resourcepack.esl')
$ours = @('thornswood-content.esp')

$perm = Get-Content -Raw (Join-Path $Repo 'records/collection-permissions.json') | ConvertFrom-Json
$whose = @{}
foreach ($m in $perm.mods) { foreach ($pl in @($m.plugins)) { if ($pl) { $whose[$pl.ToLowerInvariant()] = ('{0}, Nexus {1}' -f $m.author, $m.modId) } } }

$policy = Get-Content -Raw (Join-Path $Repo 'game/data/last-plugin-policy.json') | ConvertFrom-Json
$allowed = @{}
if ($policy.PSObject.Properties.Name -contains 'copyAllowed') {
    foreach ($a in @($policy.copyAllowed)) { $allowed[([string]$a.plugin).ToLowerInvariant()] = [string]$a.decision }
}

$theirs = 0; $without = 0
foreach ($k in $plugins.Keys) {
    $pl = $plugins[$k]
    if ($bethesda -contains $k -or $k -match '^cc.*\.es[lm]$' -or $ours -contains $k) { continue }
    $theirs++
    $who = if ($whose.ContainsKey($k)) { $whose[$k] } else { 'no reading in collection-permissions.json' }
    $what = '{0} records, {1} bytes and {2} strings' -f $pl.Records, $pl.Bytes, $pl.Strings
    if ($allowed.ContainsKey($k)) {
        Yes ('1  {0} ({1}): {2} copied, allowed by {3}' -f $pl.Name, $who, $what, $allowed[$k]) ($allowed[$k].Trim().Length -gt 0)
    } else {
        $without++
        Yes ('1  {0} ({1}): {2} copied with no permission to copy on record' -f $pl.Name, $who, $what) $false
    }
}
Yes ('1  the recipe copies from {0} plugin(s) of other authors, {1} with no permission on record' -f $theirs, $without) ($without -eq 0)

# ---- the builder stops on one
$builder = Get-Content -Raw (Join-Path $Repo 'scripts/mods/Build-LastPlugin.py')
Yes '2  Build-LastPlugin.py reads copyAllowed from the policy' ($builder -match "policy\.get\('copyAllowed'" -or $builder -match "policy\['copyAllowed'\]")

Write-Output ''
Write-Output ('{0} passed, {1} failed' -f $pass, $fail)
if ($fail) { exit 1 } else { exit 0 }
