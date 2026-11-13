<#
  test-2791-recipe-permissions.ps1

      pwsh -NoProfile -File game\tests\test-2791-recipe-permissions.ps1

  #2791. Thornswood-Last.esp is made on each machine from its recipe,
  game\data\last-plugin.recipe, out of that machine's own copies of the
  plugins it reads (Patrick's A of 26 Oct 2026 on #3721). Thornswood hands
  out none of those records, so the 22 Oct B (rebuild what an author does not
  let us hand out) has nothing left to rebuild. What the issue still asks is
  that every plugin the recipe copies from has its author and terms on
  record, and that the record says what the plugin is really made of.

  This reads the recipe's own steps and holds that:
    1  every plugin of another author the recipe copies from has a reading
       of its Nexus page in records\collection-permissions.json
    2  records\asset-provenance.json's Thornswood-Last.esp entry names every
       one of them
    3  that entry does not say a plugin the recipe copies from is left out
       (Immersive Armors' perk recipes are copied, issue 4826)

  It prints each source with what the recipe copies from it, which is the
  measurement on #2791.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Output ('PASS  ' + $what) } else { $script:fail++; Write-Output ('FAIL  ' + $what) }
}

# ---- the recipe's sources, and what its steps take from each
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
Yes 'the recipe is a version 1 recipe' ([Text.Encoding]::ASCII.GetString($b, 0, 4) -eq 'TSLR' -and $b[4] -eq 1)
$script:p = 5 + 4 + 32
$count = VI
$src = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt $count; $i++) {
    $kind = $b[$script:p]; $script:p++
    $len = VI
    $name = [Text.Encoding]::UTF8.GetString($b, $script:p, $len); $script:p += $len
    $null = VI; $script:p += 32
    $src.Add([pscustomobject]@{ Kind = $kind; Name = $name; Records = 0; Bytes = [long]0 })
}
$cur = -1
while ($script:p -lt $b.Length) {
    $op = $b[$script:p]; $script:p++
    switch ($op) {
        0 { $n = VI; $script:p += $n }
        1 { $s = VI; $null = VI; $cur = $s; $src[$s].Records++ }
        2 { $null = VI; $n = VI; $src[$cur].Bytes += $n }
        3 { $null = VI; $null = VI }
        default { throw ('the recipe has an unknown step ' + $op + ' at byte ' + ($script:p - 1)) }
    }
}

$bethesda = @('skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm', '_resourcepack.esl')
$ours = @('thornswood-content.esp')
$theirs = @($src | Where-Object {
    $k = $_.Name.ToLowerInvariant()
    $_.Kind -eq 0 -and $_.Records -gt 0 -and $bethesda -notcontains $k -and $ours -notcontains $k -and $k -notmatch '^cc.*\.es[lm]$'
} | Sort-Object Records -Descending)
Yes ('the recipe copies from {0} plugin(s) of other authors' -f $theirs.Count) ($theirs.Count -gt 0)

# ---- 1: a reading of each one's page
$perm = Get-Content -Raw (Join-Path $Repo 'records/collection-permissions.json') | ConvertFrom-Json
$reading = @{}
foreach ($m in $perm.mods) {
    foreach ($pl in @($m.plugins)) { if ($pl) { $reading[$pl.ToLowerInvariant()] = $m } }
}
foreach ($t in $theirs) {
    $m = $reading[$t.Name.ToLowerInvariant()]
    $ok = $null -ne $m -and $null -ne $m.reading -and [string]$m.reading.read
    $who = if ($m) { '{0}, Nexus {1}' -f $m.author, $m.modId } else { 'no mod names it' }
    Yes ('1  {0} ({1}): {2} records, {3} bytes; its page read' -f $t.Name, $who, $t.Records, $t.Bytes) $ok
}

# ---- 2 and 3: the provenance entry
$prov = Get-Content -Raw (Join-Path $Repo 'records/asset-provenance.json') | ConvertFrom-Json
$entry = $null
foreach ($prop in $prov.PSObject.Properties) {
    foreach ($a in @($prop.Value)) {
        if ($a -is [psobject] -and $a.PSObject.Properties.Name -contains 'path' -and ([string]$a.path) -ieq 'Data\Thornswood-Last.esp') { $entry = $a }
    }
}
Yes 'records\asset-provenance.json has a Thornswood-Last.esp entry' ($null -ne $entry)
if ($entry) {
    $text = (@($entry.what, $entry.licence, $entry.attribution) -join ' ')
    $missing = @($theirs | Where-Object { $text.IndexOf($_.Name, [StringComparison]::OrdinalIgnoreCase) -lt 0 } | ForEach-Object { $_.Name })
    Yes ('2  the entry names every plugin the recipe copies from' + $(if ($missing.Count) { ' (not named: ' + ($missing -join ', ') + ')' } else { '' })) ($missing.Count -eq 0)
    Yes '3  the entry does not say nothing of Immersive Armors is in it' ($text -notmatch 'no record of Hothtrooper44_ArmorCompilation\.esp' -and $text -notmatch 'nothing of Immersive Armors')
}

Write-Output ''
Write-Output ('{0} passed, {1} failed' -f $pass, $fail)
if ($fail) { exit 1 } else { exit 0 }
