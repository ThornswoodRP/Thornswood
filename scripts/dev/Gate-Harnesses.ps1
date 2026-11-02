<#
.SYNOPSIS
  Prints the harnesses the build check runs on every pull request: every test-*.js and test-*.ps1 in tests\ and in a product's own tests folder (launcher\tests\) that tests\gate-excluded.txt does not name, one a line, in name order.

.DESCRIPTION
  Issue #3009. The gate list was a hand-kept array in build.yml, copied into
  build-pr.yml, and every pull request that put a harness on the gate
  appended to its end. Any two of them edited the same lines in both files
  and conflicted: 12 merges touched build.yml between midnight and 6:30 AM
  UTC on 21 Oct 2026, and one pull request conflicted on the list four times.
  A conflicted pull request gets no build at all.

  So the list is read from the files when the build runs. A new harness is
  on the gate the moment it is in tests\, and touches no shared line. One
  comes off the gate by a line in tests\gate-excluded.txt, "name  reason",
  kept in name order so two pull requests adding lines add them in different
  places. Why a harness exists, and why it is on the gate, is in its own
  header.

  The build's "Run the gate harnesses" step calls this in its own process:

      $gate = @(& .\scripts\dev\Gate-Harnesses.ps1)

  It stops with exit 1, and runs nothing, on a gate-excluded.txt line with no
  reason, one naming a harness there is not, a name on two lines, lines
  out of name order, or no harness left to run. Each fault is printed as a
  GitHub error on its line.

  BESIDE THEIR CODE (plan line 42, 1 Nov 2026). A harness may live in its
  product's own folder, <product>\tests\, as well as in tests\.
  scripts\dev\Harness-Files.ps1 says which files are harnesses and what each
  is called: one in tests\ by its file name, one beside its product by its
  path with forward slashes (launcher/tests/test-498-msbuild.ps1). A line in
  gate-excluded.txt names either kind the same way.

  tests\test-gate-list.ps1 runs this against planted folders.
  Read only.

.PARAMETER Root
  The repository whose harnesses are listed. The one this script is in,
  unless a test points it at a copy.
#>
[CmdletBinding()]
param([string]$Root = '')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Harness-Files.ps1')
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$tests = Join-Path $Root 'tests'
$listFile = Join-Path $tests 'gate-excluded.txt'

$faults = New-Object System.Collections.Generic.List[string]
$excluded = @{}
if (Test-Path -LiteralPath $listFile) {
    $i = 0
    $last = ''
    foreach ($line in [IO.File]::ReadAllLines($listFile)) {
        $i++
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $m = [regex]::Match($t, '^(\S+)(?:\s+(.*))?$')
        $n = $m.Groups[1].Value
        $at = "::error file=tests/gate-excluded.txt,line=${i}::"
        if (-not $m.Groups[2].Value.Trim()) { $faults.Add("$at$n has no reason") }
        if (-not (Test-HarnessName (Split-Path -Leaf $n)) -or -not (Test-Path -LiteralPath (Get-HarnessFile $Root $n) -PathType Leaf)) { $faults.Add("$at$n is not a harness in tests or a product's tests folder") }
        if ($excluded.ContainsKey($n)) { $faults.Add("$at$n is on line $($excluded[$n]) already") }
        elseif ([string]::CompareOrdinal($n, $last) -lt 0) { $faults.Add("$at$n is out of name order, after $last") }
        if (-not $excluded.ContainsKey($n)) { $excluded[$n] = $i }
        if ([string]::CompareOrdinal($n, $last) -gt 0) { $last = $n }
    }
}

$names = [string[]]@(Get-Harnesses $Root | ForEach-Object { $_.Name })
$gate = @($names | Where-Object { -not $excluded.ContainsKey($_) })
if ($gate.Count -eq 0) { $faults.Add("::error::no harness in $Root is on the gate") }

if ($faults.Count) {
    foreach ($f in $faults) { Write-Host $f }
    Write-Host ('{0} fault(s) in the gate list, so no harness was run' -f $faults.Count)
    exit 1
}
$gate
exit 0
