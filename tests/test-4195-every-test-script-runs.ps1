<#
  test-4195-every-test-script-runs.ps1

      pwsh -NoProfile -File tests/test-4195-every-test-script-runs.ps1

  Issue #4195. Scripts sat in tests\ that nothing ran: not named like a
  harness, so neither the gate nor the nightly started them, run by no
  workflow step, used by no other script, and not in tests\README.md, so
  nobody knew how to run them by hand. They could stop working unseen.

  Every script directly in tests\ (.js, .ps1, .psm1, .py, .sh) must be one of:
    1. a harness, test-*.js or test-*.ps1, which the gate and the nightly run
       (scripts\dev\Harness-Files.ps1);
    2. run by a workflow, by its path (python tests/test-npc-population.py);
    3. used by another script: required, imported or dot-sourced by name;
    4. listed in tests\README.md with the exact command that runs it.
  The files are the ones git tracks, so nothing untracked or another
  harness's scratch is read. The same reader then runs over a planted
  repository with one of each, so a reader that passes everything cannot
  pass here by accident.

  Read only, apart from the planted folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$ScriptKinds = @('.js', '.ps1', '.psm1', '.py', '.sh')
$CodeKinds = @('.js', '.cjs', '.mjs', '.ps1', '.psm1', '.py')

# The scripts in tests\ that are none of the four, as '<name>: why' lines.
function Get-Unrun([string]$root) {
    # What git tracks and is still there: a file deleted and not yet
    # committed is gone, and is no script to run.
    $tracked = @(& git -C $root ls-files)
    if ($LASTEXITCODE -ne 0) { throw "git ls-files in $root said $LASTEXITCODE, so the files are not known" }
    $tracked = @($tracked | Where-Object { Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf })
    $scripts = @($tracked | Where-Object { $_ -match '^tests/[^/]+$' -and $ScriptKinds -contains [IO.Path]::GetExtension($_) })
    # Comment lines say what a step does and run nothing, so they are left out.
    $flows = (@($tracked | Where-Object { $_ -match '^\.github/workflows/[^/]+\.ya?ml$' } |
        ForEach-Object { [IO.File]::ReadAllLines((Join-Path $root $_)) } | Where-Object { $_ -notmatch '^\s*#' })) -join "`n"
    $readmePath = Join-Path $root 'tests/README.md'
    $readme = $(if (Test-Path -LiteralPath $readmePath) { [IO.File]::ReadAllText($readmePath) } else { '' })
    $code = @($tracked | Where-Object { $CodeKinds -contains [IO.Path]::GetExtension($_) } |
        ForEach-Object { [pscustomobject]@{ Path = $_; Text = [IO.File]::ReadAllText((Join-Path $root $_)) } })
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($s in $scripts) {
        $name = [IO.Path]::GetFileName($s)
        $stem = [IO.Path]::GetFileNameWithoutExtension($s)
        if ($name -like 'test-*.js' -or $name -like 'test-*.ps1') { continue }
        $byPath = '(node|python3?|pwsh|bash|-File)\s+(\.[\\/])?tests[\\/]' + [regex]::Escape($name) + '(?![\w.-])'
        if ($flows -match $byPath) { continue }
        # By the readme: a command that runs it, on a line of its own or in code.
        if ($readme -match $byPath) { continue }
        # Used by another script: its stem as a name of its own (require('./x'),
        # require('../../tests/x'), . (Join-Path $x 'x.ps1'), import x).
        $use = '(?<![\w-])' + [regex]::Escape($stem) + '(\.(js|ps1|psm1|py))?(?![\w-])'
        if (@($code | Where-Object { $_.Path -ne $s -and $_.Text -match $use }).Count) { continue }
        $out.Add("$s is not a harness, no workflow runs it, no script uses it, and tests/README.md gives no command for it")
    }
    return ,$out
}

# 1. This repository.
$real = Get-Unrun $Repo
foreach ($p in $real) { Write-Host "      $p" }
Yes ('every script in tests/ is a harness, run by a workflow, used by a script, or in tests/README.md with its command (' + $real.Count + ' not)') ($real.Count -eq 0)

# 2. A planted repository with one of each.
$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4195-' + [Guid]::NewGuid().ToString('N'))
try {
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $work 'tests'), (Join-Path $work '.github/workflows'), (Join-Path $work 'game/tests')
    $put = { param($p, $t) [IO.File]::WriteAllText((Join-Path $work $p), $t) }
    & $put 'tests/test-a-harness.js' "require('./helper-used');"
    & $put 'tests/helper-used.js' 'module.exports = 1;'
    & $put 'tests/test-flow.py' 'print(1)'
    & $put 'tests/by-hand.js' 'console.log(1)'
    & $put 'tests/forgotten.js' 'console.log(1)'
    & $put 'tests/only-in-docs.js' 'console.log(1)'
    & $put 'tests/test-not-run.py' 'print(1)'
    & $put 'game/tests/test-x.js' "require('../../tests/game-helper');"
    & $put 'tests/game-helper.js' 'module.exports = 2;'
    & $put '.github/workflows/build.yml' "steps:`n  - run: python tests/test-flow.py`n  # node tests/forgotten.js, said only in a comment`n"
    & $put 'tests/README.md' "Run it by hand:`n`n    node tests/by-hand.js <addon>`n`nonly-in-docs.js is named here with no command.`n"
    $null = & git -C $work init -q 2>&1
    $null = & git -C $work add -A 2>&1
    $got = (Get-Unrun $work) -join "`n"
    Yes 'planted: a script nothing runs is named' ($got -match 'tests/test-not-run\.py is not a harness')
    Yes 'planted: one only a workflow comment names is named' ($got -match 'tests/forgotten\.js is not a harness')
    Yes 'planted: one the readme only names, with no command, is named' ($got -match 'tests/only-in-docs\.js is not a harness')
    Yes 'planted: a harness, a helper it requires, one a product harness requires, one a workflow runs and one the readme gives a command for are not' (
        $got -notmatch 'test-a-harness' -and $got -notmatch 'helper-used' -and $got -notmatch 'game-helper' -and
        $got -notmatch 'test-flow' -and $got -notmatch 'by-hand')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
