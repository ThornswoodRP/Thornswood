<#
.SYNOPSIS
  Where the test harnesses are, and the name each one goes by. Dot-sourced by
  Gate-Harnesses.ps1 and Nightly-Harnesses.ps1, so the gate and the nightly
  can never disagree about which files are harnesses.

.DESCRIPTION
  Plan line 42 (1 Nov 2026): folders grouped by product, tests beside their
  code. A harness is a test-*.js or test-*.ps1 in one of two kinds of folder:

    tests\              the shared folder, for the checks that are about the
                        whole repository (the gate, the words, the secrets)
                        and the harnesses not moved yet. Named by file name
                        alone, test-gate-list.ps1, as they always were, so
                        the gate map, gate-excluded.txt and every harness's
                        own name for itself still hold.
    <product>\tests\    one folder below the top, a product's own:
                        launcher\tests\, site\tests\. Named by its path from
                        the repository with forward slashes,
                        launcher/tests/test-498-msbuild.ps1, the way the
                        nightly named voice's when they sat beside its
                        service (voice/test-turn-key.js, now in voice\tests\).

  Get-HarnessFile turns a name back into its file, either kind. A name with a
  slash in it is a path from the repository; one without is in tests\.

      . (Join-Path $PSScriptRoot 'Harness-Files.ps1')
      Get-Harnesses $Root          every harness, [pscustomobject] Name, File
      Get-HarnessFile $Root $name  the full path a name stands for
      Get-ProductTestFolders $Root every <product>\tests\ there is

  tests\test-gate-list.ps1 holds this, over planted folders.
#>

# Every <product>\tests\ folder under $Root, one level below the top, in name
# order. Not tests\ itself, and not a folder git does not keep (node_modules,
# a worktree, temp), which never hold a top-level product.
$script:HarnessSkipTop = @('tests', 'node_modules', 'worktrees', 'temp', 'local', '.git')
function Get-ProductTestFolders([string]$Root) {
    $out = @()
    foreach ($d in @(Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue | Sort-Object Name)) {
        if ($script:HarnessSkipTop -contains $d.Name) { continue }
        $t = Join-Path $d.FullName 'tests'
        if (Test-Path -LiteralPath $t -PathType Container) { $out += [pscustomobject]@{ Product = $d.Name; Path = $t } }
    }
    return $out
}

function Test-HarnessName([string]$n) {
    return ($n -like 'test-*.js' -or $n -like 'test-*.ps1')
}

# Every harness, tests\ and each product's, in one ordinal name order (a
# product's path sorts among the bare names by its first letter), the order
# gate-excluded.txt keeps and every nightly share agrees on.
function Get-Harnesses([string]$Root) {
    $found = @{}
    $tests = Join-Path $Root 'tests'
    if (Test-Path -LiteralPath $tests) {
        foreach ($f in @(Get-ChildItem -LiteralPath $tests -File | Where-Object { Test-HarnessName $_.Name })) { $found[$f.Name] = $f }
    }
    foreach ($p in @(Get-ProductTestFolders $Root)) {
        foreach ($f in @(Get-ChildItem -LiteralPath $p.Path -File | Where-Object { Test-HarnessName $_.Name })) { $found[$p.Product + '/tests/' + $f.Name] = $f }
    }
    $names = [string[]]@($found.Keys)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    return @(foreach ($n in $names) { [pscustomobject]@{ Name = $n; File = $found[$n] } })
}

function Get-HarnessFile([string]$Root, [string]$Name) {
    if ($Name.Contains('/')) { return (Join-Path $Root ($Name -replace '/', [IO.Path]::DirectorySeparatorChar)) }
    return (Join-Path (Join-Path $Root 'tests') $Name)
}
