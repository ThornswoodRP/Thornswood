<#
  test-4197-fork-halves-run.ps1

      pwsh -NoProfile -File tests/test-4197-fork-halves-run.ps1

  Issue #4197. Harnesses that read THORNSWOOD_FORK_REQUIRED fail rather than
  skip when the fork is required. Any harness reading this environment variable
  must be run by a nightly step in .github/workflows/nightly.yml that fetches
  engine/skymp and sets THORNSWOOD_FORK_REQUIRED.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path (Join-Path (Join-Path $Repo 'scripts') 'dev') 'Harness-Files.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$allHarnesses = Get-Harnesses $Repo
$forkHarnesses = @($allHarnesses | Where-Object {
    $_.Name -ne 'test-4197-fork-halves-run.ps1' -and
    ([IO.File]::ReadAllText($_.File.FullName) -match '\bTHORNSWOOD_FORK_REQUIRED\b')
})

$nightlyPath = Join-Path $Repo '.github/workflows/nightly.yml'
$nightlyText = [IO.File]::ReadAllText($nightlyPath)
$steps = $nightlyText -split '(?m)^\s*- name:'
$forkSteps = @($steps | Where-Object { $_ -match '\$env:THORNSWOOD_FORK_REQUIRED\s*=\s*[''"]1[''"]' })

$unrun = New-Object System.Collections.Generic.List[string]
foreach ($h in $forkHarnesses) {
    $name = [IO.Path]::GetFileName($h.Name)
    $inForkStep = $false
    foreach ($step in $forkSteps) {
        if ($step -match "(?m)^\s*node\s+.*?(?:[\\/]|^)$([regex]::Escape($name))\b") {
            $inForkStep = $true
            break
        }
    }
    if (-not $inForkStep) {
        $unrun.Add($h.Name)
    }
}

foreach ($u in $unrun) {
    Write-Host "      $u reads THORNSWOOD_FORK_REQUIRED but is not run by a nightly fork step"
}

Yes "every harness that reads THORNSWOOD_FORK_REQUIRED runs in a nightly fork step ($($unrun.Count) unrun)" ($unrun.Count -eq 0)
Yes "found fork harnesses to check ($($forkHarnesses.Count) found)" ($forkHarnesses.Count -ge 4)

if ($script:fail -gt 0) { exit 1 }
exit 0
