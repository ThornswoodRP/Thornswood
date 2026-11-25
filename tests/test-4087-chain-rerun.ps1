<#
  test-4087-chain-rerun.ps1

      pwsh -NoProfile -File .\tests\test-4087-chain-rerun.ps1

  #4087. Build-RecipeTable.ps1 reads game\data\cut-items.json back
  (readsBack in scripts\mods\content-tables.json), and Write-CutItems.js,
  later in the chain, writes it. Since #4087 the script sorts a row a new
  plugin added into that file, so the recipe build has to run again on it:
  scripts\mods\Rebuild-ContentTables.ps1 runs the chain again from the reader
  when a later step changed what it read, once, and stops on a second change.

  This copies Rebuild-ContentTables.ps1 into a scratch repository with a
  chain of three small node builders (a reader, a step between, a writer) and
  runs it three ways: the writer changes nothing, changes the file once and
  then settles, and changes it every time. Since #5191 the recipe build reads
  game\data\recost.json back as well, which Build-Recost.py writes, so a
  fourth chain has a reader of two files and a writer of each, both changing
  once: each file may change once, and the chain runs again for each. Needs
  node and python on the path, as the script does; prints SKIP without them.
  No network.
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

# Each builder adds its name to the log, so the order they ran in is read back.
$log = "require('fs').appendFileSync(require('path').join(__dirname, '..', '..', 'run.log'), NAME + '\n');"
$reader = $log.Replace('NAME', "'reader'") + @'

const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const cut = fs.readFileSync(path.join(root, 'docs', 'systems', 'cut.json'), 'utf8');
fs.writeFileSync(path.join(root, 'game', 'data', 'table.json'), JSON.stringify({ from: cut }) + '\n');
'@
$between = $log.Replace('NAME', "'between'")
# The writer reads its mode from mode.txt: same (writes what is there),
# settle (writes "sorted" whatever was there), never (writes one more each run).
$writer = $log.Replace('NAME', "'writer'") + @'

const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const f = path.join(root, 'docs', 'systems', 'cut.json');
const mode = fs.readFileSync(path.join(root, 'mode.txt'), 'utf8').trim();
const now = fs.readFileSync(f, 'utf8');
if (mode === 'settle') { fs.writeFileSync(f, 'sorted\n'); }
else if (mode === 'never') { fs.writeFileSync(f, String(Number(now.trim() || 0) + 1) + '\n'); }
else { fs.writeFileSync(f, now); }
'@
$chain = @'
{
 "steps": [
  { "tool": "scripts/dev/Reader.js", "data": null, "plugins": null,
    "reads": [], "readsBack": ["docs/systems/cut.json"], "writes": ["game/data/table.json"] },
  { "tool": "scripts/dev/Between.js", "data": null, "plugins": null,
    "reads": ["game/data/table.json"], "writes": [] },
  { "tool": "scripts/dev/Writer.js", "data": null, "plugins": null,
    "reads": ["game/data/table.json"], "writes": ["docs/systems/cut.json"] }
 ]
}
'@
$population = '{"loadOrder":[{"name":"Skyrim.esm"},{"name":"Update.esm"},{"name":"Dawnguard.esm"},{"name":"HearthFires.esm"},{"name":"Dragonborn.esm"},{"name":"A.esp"}]}'

function New-Sandbox([string]$mode, [string]$cut, [string]$withChain = $chain) {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('ts-4087-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    Put $root 'scripts/mods/Rebuild-ContentTables.ps1' ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/Rebuild-ContentTables.ps1')))
    Put $root 'scripts/dev/OwnPlugins.ps1' ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/dev/OwnPlugins.ps1')))
    foreach ($helper in 'scripts/mods/ContentPaths.ps1', 'scripts/release/RecordShape.ps1', 'scripts/release/Read-JsonFile.ps1') {
        Put $root $helper ([IO.File]::ReadAllText((Join-Path $Repo $helper)))
    }
    Put $root 'scripts/mods/content-tables.json' $withChain
    Put $root 'scripts/dev/CostWriter.js' $writer.Replace("'writer'", "'cost'").Replace("'docs', 'systems', 'cut.json'", "'docs', 'systems', 'cost.json'")
    Put $root 'scripts/dev/Reader.js' $reader
    Put $root 'scripts/dev/Between.js' $between
    Put $root 'scripts/dev/Writer.js' $writer
    Put $root 'game/data/npc-population.json' $population
    # The order the commit records, which the catalogue is held to (#5191).
    Put $root 'records/collection.json' '{"collection":"t","revision":1,"plugins":[]}'
    Put $root 'records/collection-plugins.json' ('{"version":1,"collection":"t","revision":1,"plugins":[{"name":"A.esp","size":12,"sha256":"' + ('0' * 64) + '"}]}')
    Put $root 'records/load-order.json' '{"loadOrder":["Skyrim.esm","Update.esm","Dawnguard.esm","HearthFires.esm","Dragonborn.esm","A.esp"]}'
    Put $root 'records/asset-provenance.json' "{`n  `"assets`": []`n}`n"
    Put $root 'docs/systems/cut.json' $cut
    Put $root 'mode.txt' $mode
    [void][IO.Directory]::CreateDirectory((Join-Path $root 'game/content'))
    return $root
}
function Invoke-Chain([string]$root) {
    $shell = (Get-Process -Id $PID).Path
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/mods/Rebuild-ContentTables.ps1') 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ran = @()
    $logFile = Join-Path $root 'run.log'
    if (Test-Path -LiteralPath $logFile) { $ran = @([IO.File]::ReadAllLines($logFile) | Where-Object { $_ }) }
    return @{ Code = $code; Out = $out; Ran = ($ran -join ',') }
}

$roots = @()
try {
    $a = New-Sandbox 'same' "kept`n"
    $roots += $a
    $r = Invoke-Chain $a
    Yes ("a writer that changes nothing: the chain runs once and ends 0 (ran {0})" -f $r.Ran) ($r.Code -eq 0 -and $r.Ran -eq 'reader,between,writer' -and $r.Out -notmatch 'runs again')


    # Only the order at the root is authoritative. A nested copy cannot
    # make an out-of-order or damaged catalogue pass the build preflight.
    $invalid = New-Sandbox 'same' "kept`n"
    $roots += $invalid
    $ordered = $population.Substring(1, $population.Length - 2)
    $wrong = $ordered.Replace('A.esp', 'B.esp')
    Put $invalid 'game/data/npc-population.json' ('{"other":' + $population + ',' + $wrong + '}')
    $r = Invoke-Chain $invalid
    # PowerShell can colour and wrap exception text differently on each host.
    Yes 'preflight rejects a wrong top-level order even with a matching nested order' (
        $r.Code -ne 0 -and $r.Ran -eq '' -and $r.Out -match 'B\.esp' -and $r.Out -match 'A\.esp')

    Put $invalid 'game/data/npc-population.json' ('{' + $ordered + ',"npcs":[')
    $r = Invoke-Chain $invalid
    Yes 'preflight rejects truncated JSON after a correct order' ($r.Code -ne 0 -and $r.Ran -eq '')

    $b = New-Sandbox 'settle' "old`n"
    $roots += $b
    $r = Invoke-Chain $b
    Yes ("a writer that changes the file a step read back runs the chain again from that step, once (ran {0})" -f $r.Ran) ($r.Code -eq 0 -and $r.Ran -eq 'reader,between,writer,reader,between,writer')
    Yes 'it says which step changed which file and where it starts again' ($r.Out -match 'scripts/dev/Writer\.js changed docs/systems/cut\.json, which scripts/dev/Reader\.js read, so the chain runs again from step 1')
    $table = [IO.File]::ReadAllText((Join-Path $b 'game/data/table.json'))
    Yes 'and the reader built from the file as the writer left it' ($table -match 'sorted')
    Yes 'the run ends with every builder done' ($r.Out -match 'All 3 builders ran')

    $c = New-Sandbox 'never' "0`n"
    $roots += $c
    $r = Invoke-Chain $c
    Yes ("a writer that never settles stops the chain after the second pass (exit 1, ran {0})" -f $r.Ran) ($r.Code -eq 1 -and $r.Ran -eq 'reader,between,writer,reader,between,writer')
    Yes 'and says it changed the file again' ($r.Out -match 'STOP\. scripts/dev/Writer\.js changed docs/systems/cut\.json again after scripts/dev/Reader\.js ran on it a second time')

    # Two files read back by one reader, each changed once by its writer: the
    # chain runs again for each, and ends 0.
    $two = @'
{
 "steps": [
  { "tool": "scripts/dev/Reader.js", "data": null, "plugins": null,
    "reads": [], "readsBack": ["docs/systems/cut.json", "docs/systems/cost.json"], "writes": ["game/data/table.json"] },
  { "tool": "scripts/dev/CostWriter.js", "data": null, "plugins": null,
    "reads": ["game/data/table.json"], "writes": ["docs/systems/cost.json"] },
  { "tool": "scripts/dev/Writer.js", "data": null, "plugins": null,
    "reads": ["game/data/table.json"], "writes": ["docs/systems/cut.json"] }
 ]
}
'@
    $d = New-Sandbox 'settle' "old`n" $two
    $roots += $d
    Put $d 'docs/systems/cost.json' "old`n"
    $r = Invoke-Chain $d
    Yes ("a reader of two files, each changed once by its writer: the chain runs again for each and ends 0 (ran {0})" -f $r.Ran) (
        $r.Code -eq 0 -and $r.Ran -eq 'reader,cost,reader,cost,writer,reader,cost,writer')
    Yes 'and says which file sent it back each time' (
        $r.Out -match 'CostWriter\.js changed docs/systems/cost\.json' -and $r.Out -match 'Writer\.js changed docs/systems/cut\.json')

    # The chain as the repository has it: the recipe build reads the cut file
    # back and Write-CutItems.js writes it later, so a run reaches the rerun.
    $real = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/content-tables.json')) | ConvertFrom-Json
    $readerAt = -1; $writerAt = -1
    for ($i = 0; $i -lt $real.steps.Count; $i++) {
        if (@($real.steps[$i].readsBack) -contains 'game/data/cut-items.json') { $readerAt = $i }
        if (@($real.steps[$i].writes) -contains 'game/data/cut-items.json' -and $real.steps[$i].tool -eq 'scripts/dev/Write-CutItems.js') { $writerAt = $i }
    }
    Yes 'content-tables.json has the recipe build read cut-items.json back before Write-CutItems.js writes it' ($readerAt -ge 0 -and $writerAt -gt $readerAt -and $real.steps[$readerAt].tool -eq 'scripts/dev/Build-RecipeTable.ps1')
    $writesKept = @($real.steps | Where-Object { $_.tool -eq 'scripts/dev/Write-CutItems.js' } | ForEach-Object { @($_.writes) })
    Yes 'and Write-CutItems.js names cut-kept.json among what it writes' ($writesKept -contains 'game/data/cut-kept.json')
    $recostAt = -1
    for ($i = 0; $i -lt $real.steps.Count; $i++) { if ($real.steps[$i].tool -eq 'scripts/dev/Build-Recost.py' -and @($real.steps[$i].writes) -contains 'game/data/recost.json') { $recostAt = $i } }
    Yes 'and has it read recost.json back before Build-Recost.py writes it (#5191)' (
        $readerAt -ge 0 -and @($real.steps[$readerAt].readsBack) -contains 'game/data/recost.json' -and $recostAt -gt $readerAt)
} finally {
    foreach ($x in $roots) { try { Remove-Item -LiteralPath $x -Recurse -Force } catch { } }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
