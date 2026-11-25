<#
  test-5191-load-order.ps1

      pwsh -NoProfile -File tests/test-5191-load-order.ps1

  #5191, stage 4e. The load order every content build reads is
  records\load-order.json, a record in git, and no longer the loadOrder of
  game\data\npc-population.json, a table the build writes; so a build reads
  nothing back from the build before it. scripts\mods\Set-LoadOrder.ps1
  moves the record to the revision records\collection-plugins.json names,
  in the pull request that moves the records. This checks:

  1. The repository's records\load-order.json is the order its records give
     (Set-LoadOrder.ps1 -Check), so a pull request that moves the records
     and not the order fails here.
  2. In a scratch copy: -Check passes on a record that is current; when the
     records move to a revision that adds a plugin, -Check ends 1, says the
     command to run and writes nothing; Set-LoadOrder.ps1 then writes the
     moved order (the new plugin on the end of its kind, Thornswood-Last.esp
     last), and -Check passes; a second run writes the same bytes.
  3. With no records\load-order.json, it stops and writes nothing.
  4. The live move, Deploy-Server.ps1 -FromStore -FromRecord, writes that
     order (Get-ThornswoodContentOrder), never last-plugin.json's, which the
     box's build writes and git does not keep current; and the gate sends
     the file it reads it with.

  Needs nothing but pwsh. No network.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Run([string]$root, [string[]]$more = @()) {
    $o = @(& pwsh -NoProfile -File (Join-Path $root 'scripts/mods/Set-LoadOrder.ps1') -Repo $root @more 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($o -join "`n") }
}

# ---- 1. the repository's record ---------------------------------------------
$r1 = Run $Repo @('-Check')
if ($r1.Code -ne 0) { Write-Host $r1.Text }
Yes '1 records/load-order.json is the order the repository''s records give' ($r1.Code -eq 0)
$doc = [IO.File]::ReadAllText((Join-Path $Repo 'records/load-order.json')) | ConvertFrom-Json
$plugins = [IO.File]::ReadAllText((Join-Path $Repo 'records/collection-plugins.json')) | ConvertFrom-Json
$names = @($doc.loadOrder)
Yes '1 it names the collection and revision collection-plugins.json does' ([string]$doc.collection -eq [string]$plugins.collection -and [int]$doc.revision -eq [int]$plugins.revision)
Yes '1 its order starts with the five masters and ends with Thornswood-Last.esp' (
    ($names[0..4] -join ',') -eq 'Skyrim.esm,Update.esm,Dawnguard.esm,HearthFires.esm,Dragonborn.esm' -and $names[-1] -eq 'Thornswood-Last.esp')

# ---- 2. a revision that adds a plugin, in a scratch copy --------------------
$tmpRoot = $(if ($env:TEST_TMP) { $env:TEST_TMP } else { [IO.Path]::GetTempPath() })
$root = Join-Path $tmpRoot ('ts-5191-order-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
function Put([string]$rel, [string]$text) {
    $p = Join-Path $root $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p, $text)
}
try {
    foreach ($f in @('scripts/mods/Set-LoadOrder.ps1', 'scripts/mods/ContentPaths.ps1', 'scripts/release/RecordShape.ps1', 'scripts/release/Read-JsonFile.ps1')) { Put $f ([IO.File]::ReadAllText((Join-Path $Repo $f))) }
    . (Join-Path $root 'scripts/mods/ContentPaths.ps1')
    $three = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'A.esm', 'B.esp', 'Thornswood-Content.esp', 'Thornswood-Last.esp')
    $at = Join-Path $root 'records/load-order.json'
    Put 'records/load-order.json' (Format-ThornswoodLoadOrderRecord -Slug abc -Revision 3 -Order $three)
    Put 'records/collection.json' '{"collection":"abc","revision":3,"plugins":[{"name":"A.esm","master":true},{"name":"B.esp","master":false}]}'
    Put 'records/collection-plugins.json' ('{"version":1,"collection":"abc","revision":3,"plugins":[{"name":"A.esm","size":12,"sha256":"' + ('0' * 64) + '"}]}')
    $r2 = Run $root @('-Check')
    Yes '2 -Check passes on a record that is its records'' order' ($r2.Code -eq 0 -and $r2.Text -match 'is the order of collection abc revision 3, 9 plugins')

    Put 'records/collection.json' '{"collection":"abc","revision":4,"plugins":[{"name":"A.esm","master":true},{"name":"B.esp","master":false},{"name":"New.esp","master":false}]}'
    Put 'records/collection-plugins.json' ('{"version":1,"collection":"abc","revision":4,"plugins":[{"name":"A.esm","size":12,"sha256":"' + ('0' * 64) + '"}]}')
    $before = [IO.File]::ReadAllText($at)
    $r3 = Run $root @('-Check')
    Yes '2 -Check ends 1 when the records moved and the order did not, and says what to run' ($r3.Code -eq 1 -and $r3.Text -match 'Run pwsh scripts/mods/Set-LoadOrder\.ps1')
    Yes '2   and writes nothing' ([IO.File]::ReadAllText($at) -ceq $before)
    $r4 = Run $root
    $moved = [IO.File]::ReadAllText($at) | ConvertFrom-Json
    Yes ('2 Set-LoadOrder.ps1 writes the moved order: ' + (@($moved.loadOrder) -join ', ')) (
        $r4.Code -eq 0 -and $r4.Text -match 'adding New\.esp' -and [int]$moved.revision -eq 4 -and
        (@($moved.loadOrder) -join ',') -eq 'Skyrim.esm,Update.esm,Dawnguard.esm,HearthFires.esm,Dragonborn.esm,A.esm,B.esp,Thornswood-Content.esp,New.esp,Thornswood-Last.esp')
    $written = [IO.File]::ReadAllText($at)
    Yes '2 then -Check passes' ((Run $root @('-Check')).Code -eq 0)
    $r5 = Run $root
    Yes '2 a second run writes the same bytes' ($r5.Code -eq 0 -and [IO.File]::ReadAllText($at) -ceq $written)
    Yes '2 the record is LF with no byte order mark' ($written -notmatch "`r" -and [IO.File]::ReadAllBytes($at)[0] -eq [byte][char]'{')

    # ---- 3. no record -------------------------------------------------------
    Remove-Item -LiteralPath $at
    $r6 = Run $root
    Yes '3 with no records/load-order.json it stops and writes nothing' ($r6.Code -eq 1 -and $r6.Text -match '^STOP\.' -and -not (Test-Path -LiteralPath $at))
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 4. the live move reads the record --------------------------------------
$ds = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/deploy/Deploy-Server.ps1')).Replace("`r`n", "`n")
$fromRecord = [regex]::Match($ds, '(?s)  if \(\$FromRecord\) \{\n(.*?)\n  \}\n').Groups[1].Value
Yes '4 Deploy-Server -FromRecord moves the live server to the order Get-ThornswoodContentOrder makes' (
    $fromRecord.Contains(". (Join-Path `$repoRoot 'scripts\mods\ContentPaths.ps1')") -and
    $fromRecord.Contains('$contentOrder = Get-ThornswoodContentOrder -Repo $repoRoot') -and $fromRecord.Contains('@($contentOrder.Names)'))
Yes '4   and reads no order from last-plugin.json' ($fromRecord -ne '' -and -not $fromRecord.Contains("'game\data\last-plugin.json'") -and -not $fromRecord.Contains('.loadOrder)'))
Yes '4   and refuses an order of another revision than the store''s' ($fromRecord.Contains('[int]$contentOrder.Revision -ne [int]$store.Revision'))
$verbs = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/vps/gate/verbs.json')) | ConvertFrom-Json
Yes '4 the gate sends ContentPaths.ps1 with Deploy-Server' (@($verbs.verbs.'Deploy-Server'.reads) -contains 'scripts/mods/ContentPaths.ps1')

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
