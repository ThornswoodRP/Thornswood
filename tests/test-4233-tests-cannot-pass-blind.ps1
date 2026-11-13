<#
  test-4233-tests-cannot-pass-blind.ps1

      pwsh -NoProfile -File .\tests\test-4233-tests-cannot-pass-blind.ps1

  #4233. Tests of the collection and the mods that said SKIP and passed
  where the part they check went wrong, so that part could never fail. This
  runs each of them on a scratch folder where that part goes wrong and holds
  it to failing:
    1. test-bodies-retired.ps1, given a game folder whose female body cannot
       be read: Check-CoveredBodies exits non-zero, and that is a failure, not
       a SKIP saying the body is still the nude one.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$Shell = Get-BoxPowerShell
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4233-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    # ---- 1. test-bodies-retired ------------------------------------------------
    $game = Join-Path $T 'Thornswood'
    $mesh = Join-Path $game (Join-Path 'Game' (Join-Path 'Data' (Join-Path 'meshes' (Join-Path 'actors' (Join-Path 'character' (Join-Path 'character assets' 'femalebody_1.nif'))))))
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $mesh))
    [IO.File]::WriteAllText($mesh, 'this is not a nif')
    $out = & $Shell -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'test-bodies-retired.ps1') -GameRoot $game 2>&1 | Out-String
    $code = $LASTEXITCODE
    $lines = @($out -split "\r?\n")
    Yes ('1. test-bodies-retired fails when the body check does not say covered (exit ' + $code + ')') ($code -ne 0)
    Yes '   with a FAIL line for the body in the game folder' (@($lines | Where-Object { $_ -match '^FAIL\s+.*femalebody' -or $_ -match '^FAIL\s+.*body' }).Count -ge 1)
    Yes '   and no SKIP saying the body is still the nude one' (@($lines | Where-Object { $_ -match '^SKIP\s+.*nude' }).Count -eq 0)
    if ($code -eq 0) { Write-Host ('      ' + (($lines | Where-Object { $_ -match '^(SKIP|FAIL)' }) -join ' / ')) }
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
