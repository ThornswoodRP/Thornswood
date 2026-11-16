<#
  test-5191-without-last.ps1

      pwsh -NoProfile -File .\tests\test-5191-without-last.ps1

  #5191, Patrick's B on q-5191-last-plugin-loop (15 Nov 2026). The steps of
  scripts\mods\content-tables.json before Build-LastPlugin.py read a load
  order with Thornswood-Last.esp in it, and Build-LastPlugin.py makes that
  plugin from their tables, so each build read the Last plugin the build
  before it made. Rebuild-ContentTables.ps1 -WithoutLast is the measurement
  of what that moves: the steps before Build-LastPlugin.py are given the
  order without Thornswood-Last.esp, and the steps from it on the whole
  order. Build-ContentOnBox.ps1 -WithoutLast, which runs it on the box, is
  held by tests\test-5191-content-build.ps1.

  This copies Rebuild-ContentTables.ps1 into a scratch repository with a
  chain of a builder before Build-LastPlugin.py, a stand-in for it and a
  builder after it, each of which writes down the plugin list it was given,
  and holds it to:

  1. Without -WithoutLast every step that takes a list gets the whole order.
  2. With it, the step before Build-LastPlugin.py gets the same order without
     Thornswood-Last.esp, and the step after it the whole order.
  3. -List -WithoutLast says which steps get which list, and runs nothing.
  4. A chain with no Build-LastPlugin.py step, or a recorded order with no
     Thornswood-Last.esp, stops before any builder runs.
  5. The repository's chain has the Build-LastPlugin.py step it leaves out
     before.
  6. No step of the repository's chain reads the clock, so one key builds
     the same bytes every time and a DIFFERS line is only what moved. Until
     16 Nov 2026 six table builders wrote builtAt, and the first box run of
     -WithoutLast said food.json and races.json differ for that alone.
  7. Build-CrimeTable.py runs after Build-LastPlugin.py. The scripts it
     reads are the ones the game loads, and Thornswood-Last.esp takes the
     script off every placed thing it switches off (#3077) and every actor
     the catalogue cuts. Before it, the -WithoutLast box run of 16 Nov 2026
     found crime-factions.json took that from the Last plugin of the build
     before (TGTQ03LetterActivation). Nothing the Last plugin is made from
     reads the crime table.

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

function New-Sandbox([string]$chainText = $chain, [string[]]$order = @('A.esp', 'Thornswood-Content.esp', 'B.esp', 'Thornswood-Last.esp')) {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('ts-5191-wl-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    Put $root 'scripts/mods/Rebuild-ContentTables.ps1' ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/Rebuild-ContentTables.ps1')))
    Put $root 'scripts/dev/OwnPlugins.ps1' ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/dev/OwnPlugins.ps1')))
    Put $root 'scripts/mods/content-tables.json' $chainText
    Put $root 'scripts/dev/Before.js' $saysList.Replace('NAME', 'before')
    Put $root 'scripts/dev/After.js' $saysList.Replace('NAME', 'after')
    Put $root 'scripts/mods/Build-LastPlugin.py' $last
    Put $root 'game/data/npc-population.json' (Population $order)
    Put $root 'records/asset-provenance.json' "{`n  `"assets`": []`n}`n"
    [void][IO.Directory]::CreateDirectory((Join-Path $root 'game/content'))
    return $root
}
function Invoke-Chain([string]$root, [string[]]$more = @()) {
    $shell = (Get-Process -Id $PID).Path
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/mods/Rebuild-ContentTables.ps1') @more 2>&1 | Out-String
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
    Yes ("1 without -WithoutLast every step gets the whole order (ran {0})" -f $r.Ran) ($r.Code -eq 0 -and $r.Ran -eq 'before,last,after' -and $r.Before -eq $whole -and $r.After -eq $whole)

    $b = New-Sandbox
    $roots += $b
    $r = Invoke-Chain $b @('-WithoutLast')
    if ($r.Code -ne 0) { Write-Host $r.Out }
    Yes ("2 with -WithoutLast the step before Build-LastPlugin.py gets the order without Thornswood-Last.esp: {0}" -f $r.Before) ($r.Code -eq 0 -and $r.Ran -eq 'before,last,after' -and $r.Before -eq '*A.esp,*Thornswood-Content.esp,*B.esp')
    Yes '2   and the step after it the whole order' ($r.After -eq $whole)
    Yes '2   and the run says which steps read it without the Last plugin' ($r.Out -match 'steps 1 to 1, before scripts/mods/Build-LastPlugin\.py, read it without Thornswood-Last\.esp')

    $c = New-Sandbox
    $roots += $c
    $r = Invoke-Chain $c @('-List', '-WithoutLast')
    Yes '3 -List -WithoutLast lists the first step with the list without the Last plugin and the third with the whole one, and runs nothing' (
        $r.Code -eq 0 -and $r.Ran -eq '' -and $r.Out -match '1\. scripts/dev/Before\.js --plugins \S*without-last[\\/]plugins\.txt' -and
        $r.Out -match '3\. scripts/dev/After\.js --plugins \S*thornswood-loadorder-[0-9a-f]+[\\/]plugins\.txt' -and $r.Out -match 'steps 1 to 1 are given')

    $d = New-Sandbox ($chain -replace 'scripts/mods/Build-LastPlugin\.py', 'scripts/mods/Other.py')
    $roots += $d
    Put $d 'scripts/mods/Other.py' $last
    $r = Invoke-Chain $d @('-WithoutLast')
    Yes '4 a chain with no Build-LastPlugin.py step stops -WithoutLast before any builder runs' ($r.Code -ne 0 -and $r.Ran -eq '' -and $r.Out -match 'has no scripts/mods/Build-LastPlugin\.py step')

    $e = New-Sandbox $chain @('A.esp', 'Thornswood-Content.esp', 'B.esp')
    $roots += $e
    $r = Invoke-Chain $e @('-WithoutLast')
    Yes '4 a recorded order with no Thornswood-Last.esp stops -WithoutLast before any builder runs' ($r.Code -ne 0 -and $r.Ran -eq '' -and $r.Out -match 'has no Thornswood-Last\.esp')

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
} finally {
    foreach ($x in $roots) { try { Remove-Item -LiteralPath $x -Recurse -Force } catch { } }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
