<#
  test-2513-every-harness-listed.ps1

      pwsh -NoProfile -File .\tests\test-2513-every-harness-listed.ps1

  Issue #2513. A harness ran on a pull request only if its author also typed
  its name into .github\workflows\build.yml, and nothing checked that they
  did. test-release-baseline.ps1 and test-publish-refusals.ps1 went red on
  main and the build stayed green, because neither was named there.

  Since #3009 there is no name to forget: the gate runs every tests\test-*.js
  and tests\test-*.ps1 that tests\gate-excluded.txt does not name, as
  scripts\dev\Gate-Harnesses.ps1 lists them (tests\test-gate-list.ps1 checks
  that script and the gate step). What is left to hold is the excluded list
  against what build.yml runs in steps of their own. This fails on:
    1. a harness build.yml runs in a step of its own (by path, or by name in
       quotes) that gate-excluded.txt does not name, since the gate would run
       it a second time;
    2. an excluded line that says "own step in build.yml" for a harness
       build.yml does not run, since that harness then runs nowhere on a pull
       request;
    3. build.yml or build-pr.yml no longer running the gate through
       Gate-Harnesses.ps1, or excluding test-release-baseline.ps1,
       test-publish-refusals.ps1 or this harness.
  The same reader is then run over a planted repository with one of each,
  so a reader that finds nothing anywhere cannot pass by accident.

  Read only, apart from the planted folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
. (Join-Path (Join-Path (Join-Path $Repo 'scripts') 'dev') 'Harness-Files.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The excluded names, and the reason on each line.
function Get-Excluded([string]$repo) {
    $why = @{}
    $listFile = Join-Path $repo 'tests\gate-excluded.txt'
    if (Test-Path -LiteralPath $listFile) {
        foreach ($line in [IO.File]::ReadAllLines($listFile)) {
            $t = $line.Trim()
            if (-not $t -or $t.StartsWith('#')) { continue }
            $m = [regex]::Match($t, '^(\S+)(?:\s+(.*))?$')
            $why[$m.Groups[1].Value] = $m.Groups[2].Value.Trim()
        }
    }
    return $why
}

# What is wrong in one repository, as a list of lines. Empty means nothing.
function Get-Unlisted([string]$repo) {
    $problems = New-Object System.Collections.Generic.List[string]
    # Comment lines say what a step does and run nothing, so they are left out.
    $yml = ((Get-Content -LiteralPath (Join-Path $repo '.github\workflows\build.yml')) |
        Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    # Those in tests by name, and those beside their product by path
    # (launcher/tests/test-x.ps1), as the gate lists them (plan line 42).
    $names = @(Get-Harnesses $repo | ForEach-Object { $_.Name })
    $why = Get-Excluded $repo
    foreach ($n in $names) {
        # Named in quotes ('name') or run by path (node tests\name, -File
        # tests\name), not merely in an ::error line naming the file. One
        # beside its product by its path either way, with either slash.
        if ($n.Contains('/')) {
            $e = (@($n -split '/' | ForEach-Object { [regex]::Escape($_) }) -join '[\\/]')
            $own = ($yml -match ("'(\.[\\/])?" + $e + "'")) -or ($yml -match ('(node|-File|python)\s+(\.[\\/])?' + $e + '(?![\w.-])'))
        } else {
            $e = [regex]::Escape($n)
            $own = ($yml -match ("'" + $e + "'")) -or ($yml -match ('(node|-File|python)\s+(\.[\\/])?tests[\\/]' + $e + '(?![\w.-])'))
        }
        $says = $why.ContainsKey($n) -and $why[$n].StartsWith('own step in build.yml')
        if ($own -and -not $why.ContainsKey($n)) { $problems.Add("$n runs in a step of its own in build.yml and is not in tests\gate-excluded.txt, so the gate runs it twice") }
        if ($says -and -not $own) { $problems.Add("gate-excluded.txt says build.yml runs $n in a step of its own, and it does not") }
    }
    return ,$problems
}

# 1. This repository.
$real = Get-Unlisted $Repo
foreach ($p in $real) { Write-Host "        $p" }
Yes 'every harness build.yml runs in a step of its own is excluded from the gate, and every "own step" line is true' ($real.Count -eq 0)

$why = Get-Excluded $Repo
$first = @('test-release-baseline.ps1', 'test-publish-refusals.ps1')
Yes 'test-release-baseline.ps1 and test-publish-refusals.ps1 are on the gate (#2513)' (
    @($first | Where-Object { $why.ContainsKey($_) -or -not (Test-Path -LiteralPath (Join-Path $Here $_)) }).Count -eq 0)
Yes 'and this check is too' (-not $why.ContainsKey('test-2513-every-harness-listed.ps1'))
foreach ($wf in 'build.yml', 'build-pr.yml') {
    $t = [IO.File]::ReadAllText((Join-Path $Repo ".github\workflows\$wf"))
    # Through scripts\dev\Run-Gate.ps1 since #3114; tests\test-gate-list.ps1
    # holds that it takes its list from Gate-Harnesses.ps1.
    Yes "$wf runs the gate through Run-Gate.ps1, which lists it with Gate-Harnesses.ps1" ($t -match '(?m)^\s+\.\\scripts\\dev\\Run-Gate\.ps1 ' -and
        [IO.File]::ReadAllText((Join-Path $Repo 'scripts\dev\Run-Gate.ps1')) -match "(?m)^\`$gate = @\(& \(Join-Path \`$Here 'Gate-Harnesses\.ps1'\)\)")
    Yes "  and has no hand-kept list left (#3009)" ($t -notmatch '(?m)^\s+\$six\s*=')
}

# 2. A planted repository with one of each fault, and one good of each kind.
$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-2513-' + [Guid]::NewGuid().ToString('N'))
try {
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $work '.github\workflows'), (Join-Path $work 'tests')
    $null = New-Item -ItemType Directory -Force -Path (Join-Path (Join-Path $work 'launcher') 'tests')
    foreach ($n in 'test-l-own.ps1', 'test-l-forgot.js') { Set-Content -LiteralPath (Join-Path (Join-Path (Join-Path $work 'launcher') 'tests') $n) -Value '# stand-in' }
    foreach ($n in 'test-gate.ps1', 'test-own-ok.js', 'test-own-forgot.ps1', 'test-own-false.js', 'test-quoted.ps1', 'test-off.ps1', 'test-error-only.js') {
        Set-Content -LiteralPath (Join-Path $work "tests\$n") -Value '# stand-in'
    }
    Set-Content -LiteralPath (Join-Path $work '.github\workflows\build.yml') -Value @(
        '          # node tests\test-own-false.js is only said in a comment',
        '          node tests\test-own-ok.js',
        '          & pwsh -NoProfile -File tests\test-own-forgot.ps1',
        "          foreach (`$n in 'test-quoted.ps1') { }",
        "          Write-Host '::error file=tests/test-error-only.js::no node'",
        '          & pwsh -NoProfile -File launcher\tests\test-l-own.ps1',
        '          node launcher/tests/test-l-forgot.js')
    Set-Content -LiteralPath (Join-Path $work 'tests\gate-excluded.txt') -Value @(
        '# comment lines are skipped',
        'launcher/tests/test-l-own.ps1  own step in build.yml, "A launcher step"',
        'test-off.ps1  needs a game install',
        'test-own-false.js  own step in build.yml, "A step"',
        'test-own-ok.js  own step in build.yml, "A step"',
        'test-quoted.ps1  own step in build.yml, "Another step"')
    $got = (Get-Unlisted $work) -join "`n"
    Yes 'planted: a harness run by its own step and not excluded is named' ($got -match 'test-own-forgot\.ps1 runs in a step of its own')
    Yes 'planted: an "own step" line for a harness only a comment names is named' ($got -match 'runs test-own-false\.js in a step of its own, and it does not')
    Yes 'planted: a product harness run by its path in its own step and not excluded is named by its path' ($got -match 'launcher/tests/test-l-forgot\.js runs in a step of its own')
    Yes 'planted: and one that is excluded is not' ($got -notmatch 'test-l-own\.ps1')
    Yes 'planted: an own-step harness excluded, a quoted one, an excluded one, a gate one and one only in an error line are not named' (
        $got -notmatch 'test-own-ok\.js' -and $got -notmatch 'test-quoted\.ps1' -and $got -notmatch 'test-off\.ps1' -and
        $got -notmatch 'test-gate\.ps1' -and $got -notmatch 'test-error-only\.js')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
