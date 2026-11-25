<#
  test-5191-without-last.ps1

      pwsh -NoProfile -File .\tests\test-5191-without-last.ps1

  #5191, Patrick's B on q-5191-last-plugin-loop (15 Nov 2026). The steps of
  scripts\mods\content-tables.json before Build-LastPlugin.py read a load
  order with Thornswood-Last.esp in it, and Build-LastPlugin.py makes that
  plugin from their tables, so each build read the Last plugin the build
  before it made. Rebuild-ContentTables.ps1 -WithoutLast measured what that
  moved (the box run of 16 Nov 2026), each table it found takes the plugin's
  effect from its own data now or runs after it, and the measurement is the
  build: every step before Build-LastPlugin.py is given the order without
  Thornswood-Last.esp, the steps from it on the whole order.

  This copies Rebuild-ContentTables.ps1 into a scratch repository with a
  chain of a builder before Build-LastPlugin.py, a stand-in for it and a
  builder after it, each of which writes down the plugin list it was given,
  and holds it to:

  1. On every run the step before Build-LastPlugin.py gets the order without
     Thornswood-Last.esp, and the step after it the whole order.
  2. -List says which steps get which list, and runs nothing.
  3. A chain with no Build-LastPlugin.py step makes no Last plugin, so none
     of its steps is given one.
  4. The order is the one the commit records, records\load-order.json at the
     revision records\collection-plugins.json names, not the catalogue's:
     Build-LastPlugin.py cuts the actors game\data\npc-population.json
     lists, so a catalogue of another order stops the run before any
     builder, and so does a -PluginsTxt that is not the record's order.
     Until 16 Nov 2026 the order was the catalogue's, a table a later step
     of the same chain writes.
  5. The repository's chain has the Build-LastPlugin.py step it leaves out
     before.
  6. No step of the repository's chain reads the clock, so one key builds
     the same bytes every time. Until 16 Nov 2026 six table builders wrote
     builtAt, and the first -WithoutLast box run said food.json and
     races.json differ for that alone.
  7. Build-CrimeTable.py runs after Build-LastPlugin.py. The scripts it
     reads are the ones the game loads, and Thornswood-Last.esp takes the
     script off every placed thing it switches off (#3077) and every actor
     the catalogue cuts. Before it, the -WithoutLast box run of 16 Nov 2026
     found crime-factions.json took that from the Last plugin of the build
     before (TGTQ03LetterActivation). Nothing the Last plugin is made from
     reads the crime table.
  8. -WithoutLast is gone from the runner, the box's build and its verb.

  Needs node and python on the path, as the script does; prints SKIP
  without them. No network.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$python = @('python', 'py', 'python3') | ForEach-Object { Get-Command $_ -CommandType Application -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $node -or -not $python) {
    Write-Host 'SKIP  Rebuild-ContentTables.ps1 needs node and python on the path, and this machine lacks one'
    Write-Host ''
    Write-Host '0 passed, 0 failed'
    exit 0
}

$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$root, [string]$rel, [string]$text) {
    $f = Join-Path $root $rel
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $f))
    [IO.File]::WriteAllText($f, $text, $utf8)
}

# A builder that writes the plugin list it was given (--plugins) to OUT.
$saysList = @'
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const at = process.argv.indexOf('--plugins');
fs.appendFileSync(path.join(root, 'run.log'), 'NAME\n');
fs.writeFileSync(path.join(root, 'game', 'data', 'NAME.txt'), at > 0 ? fs.readFileSync(process.argv[at + 1], 'utf8') : 'no list\n');
'@
$last = @'
import os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
with open(os.path.join(root, 'run.log'), 'a') as f:
    f.write('last\n')
'@
$chain = @'
{
 "steps": [
  { "tool": "scripts/dev/Before.js", "data": null, "plugins": "--plugins",
    "reads": [], "writes": ["game/data/before.txt"] },
  { "tool": "scripts/mods/Build-LastPlugin.py", "data": null, "plugins": null,
    "reads": ["game/data/before.txt"], "writes": [] },
  { "tool": "scripts/dev/After.js", "data": null, "plugins": "--plugins",
    "reads": [], "writes": ["game/data/after.txt"] }
 ]
}
'@
$masters = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm')
function Population([string[]]$names) { '{"loadOrder":[' + ((@($masters) + $names | ForEach-Object { '{"name":"' + $_ + '"}' }) -join ',') + ']}' }
# The order the commit records: records\load-order.json, at the revision both
# collection records name (ContentPaths.ps1, Get-ThornswoodContentOrder).
function Put-Record([string]$root, [string[]]$names) {
    Put $root 'records/collection.json' '{"collection":"t","revision":1,"plugins":[]}'
    Put $root 'records/collection-plugins.json' ('{"version":1,"collection":"t","revision":1,"plugins":[{"name":"A.esp","size":12,"sha256":"' + ('0' * 64) + '"}]}')
    Put $root 'records/load-order.json' ('{"loadOrder":[' + ((@($masters) + $names | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']}')
}

function New-Sandbox([string]$chainText = $chain, [string[]]$order = @('A.esp', 'Thornswood-Content.esp', 'B.esp', 'Thornswood-Last.esp')) {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('ts-5191-wl-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    Put $root 'scripts/mods/Rebuild-ContentTables.ps1' ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/Rebuild-ContentTables.ps1')))
    Put $root 'scripts/dev/OwnPlugins.ps1' ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/dev/OwnPlugins.ps1')))
    foreach ($helper in 'scripts/mods/ContentPaths.ps1', 'scripts/release/RecordShape.ps1', 'scripts/release/Read-JsonFile.ps1') {
        Put $root $helper ([IO.File]::ReadAllText((Join-Path $Repo $helper)))
    }
    Put $root 'scripts/mods/content-tables.json' $chainText
    Put $root 'scripts/dev/Before.js' $saysList.Replace('NAME', 'before')
    Put $root 'scripts/dev/After.js' $saysList.Replace('NAME', 'after')
    Put $root 'scripts/mods/Build-LastPlugin.py' $last
    Put $root 'game/data/npc-population.json' (Population $order)
    Put-Record $root $order
    Put $root 'records/asset-provenance.json' "{`n  `"assets`": []`n}`n"
    [void][IO.Directory]::CreateDirectory((Join-Path $root 'game/content'))
    return $root
}
# Out is the run's whole output as one string. Windows may still break a
# long line at the console's width, so a check reads it with its white space
# taken out.
function Invoke-Chain([string]$root, [string[]]$more = @()) {
    $shell = (Get-Process -Id $PID).Path
    # A stop is caught in the child and its message written as one line:
    # left to the console, Windows' error view breaks it at the console's
    # width with "|" on each line after the first, which no match reads.
    # The switches go by name: a string '-List' splatted from an array is a
    # value, not a switch.
    $named = @{}
    for ($i = 0; $i -lt $more.Count; $i++) {
        $n = $more[$i].TrimStart('-')
        if ($i + 1 -lt $more.Count -and -not $more[$i + 1].StartsWith('-')) { $named[$n] = $more[$i + 1]; $i++ } else { $named[$n] = $true }
    }
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -Command {
        param($s, $m)
        try { & $s @m } catch { 'STOPPED: ' + $_.Exception.Message; exit 1 }
    } -args (Join-Path $root 'scripts/mods/Rebuild-ContentTables.ps1'), $named 2>&1 | Out-String
    $code = $LASTEXITCODE
    $logFile = Join-Path $root 'run.log'
    $ran = $(if (Test-Path -LiteralPath $logFile) { @([IO.File]::ReadAllLines($logFile) | Where-Object { $_ }) } else { @() })
    function ListOf([string]$n) { $f = Join-Path $root "game/data/$n.txt"; if (Test-Path -LiteralPath $f) { @([IO.File]::ReadAllLines($f) | Where-Object { $_ }) -join ',' } else { '' } }
    return @{ Code = $code; Out = $out; Ran = ($ran -join ','); Before = (ListOf 'before'); After = (ListOf 'after') }
}

$whole = '*A.esp,*Thornswood-Content.esp,*B.esp,*Thornswood-Last.esp'
$roots = @()
try {
    $a = New-Sandbox
    $roots += $a
    $r = Invoke-Chain $a
    if ($r.Code -ne 0) { Write-Host $r.Out }
    Yes ("1 the step before Build-LastPlugin.py gets the order without Thornswood-Last.esp: {0}" -f $r.Before) ($r.Code -eq 0 -and $r.Ran -eq 'before,last,after' -and $r.Before -eq '*A.esp,*Thornswood-Content.esp,*B.esp')
    Yes '1   and the step after it the whole order' ($r.After -eq $whole)
    Yes '1   and the run says which steps read it without the Last plugin' ($r.Out -match 'steps 1 to 1, before scripts/mods/Build-LastPlugin\.py, read it without Thornswood-Last\.esp')

    $proofChain = $chain.Replace('"steps": [', '"orderProof": {"game/data/proof.json": "phase"}, "steps": [').Replace('"writes": ["game/data/before.txt"]', '"writes": ["game/data/before.txt", "game/data/proof.json"]')
    $p = New-Sandbox $proofChain
    $roots += $p
    . (Join-Path $Repo 'scripts/dev/OwnPlugins.ps1')
    $good = Get-LoadOrderName ($masters + @('A.esp', 'Thornswood-Content.esp', 'B.esp'))
    $wrong = Get-LoadOrderName ($masters + @('B.esp', 'Thornswood-Content.esp', 'A.esp'))
    Put $p 'game/data/proof.json' (@{ source = "fixture of $wrong" } | ConvertTo-Json)
    $r = Invoke-Chain $p
    Yes 'a table with the right count but a different order stops before the next builder' (
        $r.Code -ne 0 -and $r.Ran -eq 'before' -and $r.Out -match 'game/data/proof\.json')
    Remove-Item -LiteralPath (Join-Path $p 'run.log')
    Put $p 'game/data/proof.json' (@{ source = "fixture of $good" } | ConvertTo-Json)
    $r = Invoke-Chain $p
    Yes 'the matching order lets the chain finish' ($r.Code -eq 0 -and $r.Ran -eq 'before,last,after')

    foreach ($badSource in @('no order recorded', ($good -replace '^8 ', '9 '))) {
        Remove-Item -LiteralPath (Join-Path $p 'run.log')
        Put $p 'game/data/proof.json' (@{ source = $badSource } | ConvertTo-Json)
        $r = Invoke-Chain $p
        Yes "a table without the expected order proof stops: $badSource" (
            $r.Code -ne 0 -and $r.Ran -eq 'before' -and $r.Out -match 'game/data/proof\.json')
    }
    $realProof = (Get-Content -LiteralPath (Join-Path $Repo 'scripts/mods/content-tables.json') -Raw | ConvertFrom-Json).orderProof
    $expectedProofs = @('hunts', 'ores', 'harvests', 'races', 'food', 'spells', 'warmth', 'waters', 'weather', 'recipes')
    $actualProofs = @($realProof.PSObject.Properties.Name)
    Yes 'the listed tables have order proofs, with a five-master scope only for spells' (
        $actualProofs.Count -eq $expectedProofs.Count -and @($expectedProofs | Where-Object {
            $realProof.PSObject.Properties["game/data/$_.json"].Value -ne $(if ($_ -eq 'spells') { 'masters' } else { 'phase' })
        }).Count -eq 0)

    $c = New-Sandbox
    $roots += $c
    $r = Invoke-Chain $c @('-List')
    Yes '2 -List lists the first step with the list without the Last plugin and the third with the whole one, and runs nothing' (
        $r.Code -eq 0 -and $r.Ran -eq '' -and $r.Out -match '1\. scripts/dev/Before\.js --plugins \S*without-last[\\/]plugins\.txt' -and
        $r.Out -match '3\. scripts/dev/After\.js --plugins \S*thornswood-loadorder-[0-9a-f]+[\\/]plugins\.txt' -and $r.Out -match 'steps 1 to 1 are given')

    $d = New-Sandbox ($chain -replace 'scripts/mods/Build-LastPlugin\.py', 'scripts/mods/Other.py')
    $roots += $d
    Put $d 'scripts/mods/Other.py' $last
    $r = Invoke-Chain $d
    Yes '3 a chain with no Build-LastPlugin.py step gives none of its steps the Last plugin' (
        $r.Code -eq 0 -and $r.Ran -eq 'before,last,after' -and $r.Before -eq '*A.esp,*Thornswood-Content.esp,*B.esp' -and $r.After -eq $r.Before)

    $e = New-Sandbox
    $roots += $e
    Put $e 'game/data/npc-population.json' (Population @('A.esp', 'Thornswood-Content.esp', 'Thornswood-Last.esp'))
    $r = Invoke-Chain $e
    Yes '4 a catalogue built in another order than the record stops the run before any builder, naming where they part' (
        $r.Code -ne 0 -and $r.Ran -eq '' -and ($r.Out -replace '\s', '') -match 'npc-population\.jsonisnotbuiltintheloadorderthecommitrecords' -and
        ($r.Out -replace '\s', '') -match 'atplace8ithasThornswood-Last\.espwheretherecordhasB\.esp')
    $f = New-Sandbox
    $roots += $f
    $other = Join-Path $f 'other.txt'
    [IO.File]::WriteAllText($other, "*A.esp`r`n*B.esp`r`n*Thornswood-Content.esp`r`n*Thornswood-Last.esp`r`n")
    $r = Invoke-Chain $f @('-PluginsTxt', $other)
    Yes '4 and so does a -PluginsTxt that is not the record''s order' (
        $r.Code -ne 0 -and $r.Ran -eq '' -and ($r.Out -replace '\s', '') -match 'isnottheloadorderthecommitrecords')
    $g = New-Sandbox
    $roots += $g
    Put-Record $g @('A.esp', 'Thornswood-Content.esp', 'B.esp', 'New.esp', 'Thornswood-Last.esp')
    Put $g 'game/data/npc-population.json' (Population @('A.esp', 'Thornswood-Content.esp', 'B.esp', 'New.esp', 'Thornswood-Last.esp'))
    $r = Invoke-Chain $g
    Yes '4 the builders are given the record''s order, a plugin it adds among them' (
        $r.Code -eq 0 -and $r.Before -eq '*A.esp,*Thornswood-Content.esp,*B.esp,*New.esp' -and $r.After -eq '*A.esp,*Thornswood-Content.esp,*B.esp,*New.esp,*Thornswood-Last.esp')

    $real = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/content-tables.json')) | ConvertFrom-Json
    $at = @(0..($real.steps.Count - 1) | Where-Object { $real.steps[$_].tool -eq 'scripts/mods/Build-LastPlugin.py' })
    Yes ('5 the repository''s chain has one Build-LastPlugin.py step, step ' + (@($at | ForEach-Object { $_ + 1 }) -join ', ') + ' of ' + $real.steps.Count) ($at.Count -eq 1 -and $at[0] -gt 0)

    $clock = 'new Date\(|Date\.now|toISOString|Get-Date|\[DateTime\]::|\bUtcNow\b|datetime\.(now|utcnow|today)|time\.time\('
    $reads = @($real.steps | ForEach-Object { [string]$_.tool } | Select-Object -Unique | Where-Object {
        [IO.File]::ReadAllText((Join-Path $Repo $_)) -match $clock })
    Yes ('6 no step of the repository''s chain reads the clock' + $(if ($reads.Count) { ': ' + ($reads -join ', ') } else { '' })) ($reads.Count -eq 0)

    $crime = @(0..($real.steps.Count - 1) | Where-Object { $real.steps[$_].tool -eq 'scripts/dev/Build-CrimeTable.py' })
    Yes ('7 Build-CrimeTable.py runs after Build-LastPlugin.py, step ' + (@($crime | ForEach-Object { $_ + 1 }) -join ', ')) (
        $crime.Count -eq 1 -and $at.Count -eq 1 -and $crime[0] -gt $at[0])

    $named = @(@('scripts/mods/Rebuild-ContentTables.ps1', 'scripts/mods/Build-ContentOnBox.ps1', 'scripts/vps/gate/verbs.json') | Where-Object {
        [IO.File]::ReadAllText((Join-Path $Repo $_)) -match '\[switch\]\$WithoutLast|"WithoutLast"|\$WithoutLast' })
    Yes ('8 -WithoutLast is gone from the runner, the box''s build and its verb' + $(if ($named.Count) { ': ' + ($named -join ', ') } else { '' })) ($named.Count -eq 0)
} finally {
    foreach ($x in $roots) { try { Remove-Item -LiteralPath $x -Recurse -Force } catch { } }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
