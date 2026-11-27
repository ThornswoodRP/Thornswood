<#
  test-eslint-amp-path.ps1

  The eslint part of the build's "Lint (warnings only)" step (issue #1343),
  scripts\dev\Lint.ps1 since #3185, has to work when the checkout, or the
  folder eslint is kept in, sits under a path holding '&', as every lane
  worktree under C:\ThornswoodTemps&Worktrees did until #2900.

  WHY THIS EXISTS. The step ran npm's eslint.cmd shim. cmd.exe reads that
  shim, and its "SET dp0=%~dp0" and "%*" are unquoted, so an '&' in the
  shim's folder or in an argument ends the command there: eslint either
  never starts ("is not recognized", "Cannot find module C:\eslint\...") or
  loads its config from 'C:\ThornswoodTemps' and dies with
  ERR_UNSUPPORTED_DIR_IMPORT.

  This makes a tiny repository with the real Lint.ps1, the real
  .github\lint\eslint.config.mjs and one file with a known no-unreachable
  finding, and runs Lint.ps1 -Only eslint on that file with the repository
  and its -Tools folder both under a '&' folder, then again under a plain
  folder. Each run must report the finding and must not crash. Offline: the
  -Tools folder gets the eslint 9.39.5 already installed in -EslintCache
  (default herald-lint in the temp folder, %TEMP% on Windows), the folder
  Lint.ps1 would have fetched it into. Without that cache it says SKIP and
  exits 2.
#>
[CmdletBinding()]
param([string]$EslintCache = (Join-Path ([IO.Path]::GetTempPath()) 'herald-lint'))

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$root = Split-Path -Parent $Here
$pass = 0; $fail = 0
function Check([bool]$ok, [string]$what) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

if (-not (Test-Path -LiteralPath (Join-Path $EslintCache 'node_modules\eslint\bin\eslint.js'))) {
    Write-Host "SKIP  no eslint in $EslintCache\node_modules (npm i eslint@9.39.5 there once)"
    exit 2
}

function RunFrom([string]$base, [string]$label) {
    $repo = Join-Path $base 'repo'
    $tools = Join-Path $base 'lint-tools'
    $eslint = Join-Path $tools 'eslint-9.39.5'
    New-Item -ItemType Directory -Force -Path (Join-Path $repo '.github\lint'), (Join-Path $repo 'scripts\dev'), $eslint | Out-Null
    Copy-Item -LiteralPath (Join-Path $root '.github\lint\eslint.config.mjs') -Destination (Join-Path $repo '.github\lint')
    Copy-Item -LiteralPath (Join-Path $root 'scripts\dev\Lint.ps1') -Destination (Join-Path $repo 'scripts\dev')
    Copy-Item -LiteralPath (Join-Path $EslintCache 'node_modules') -Destination $eslint -Recurse -Force
    Set-Content -LiteralPath (Join-Path $repo 'bad.js') -Value "function f() {`n  return 1;`n  f();`n}`nf();"
    Push-Location -LiteralPath $repo
    try { $out = (& pwsh -NoProfile -File (Join-Path $repo 'scripts\dev\Lint.ps1') -Files bad.js -Tools $tools -Only eslint 2>&1 | Out-String) } finally { Pop-Location }
    Check ($out -match 'no-unreachable') "$label : eslint reports the no-unreachable finding"
    Check ($out -match '(?m)^::warning file=[^\r\n]*bad\.js,line=3,col=3::no-unreachable: ') "$label : as a ::warning line on bad.js line 3, the way ruff's are (#4311)"
    Check ($out -notmatch 'Oops!|ERR_UNSUPPORTED_DIR_IMPORT|is not recognized|Cannot find module|fetched eslint') "$label : eslint did not crash, and ran from -Tools without fetching"
    if ($out -notmatch 'no-unreachable') { Write-Host (($out.Trim() -split "`n" | Select-Object -First 6) -join "`n") }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('eslint-amp-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    RunFrom (Join-Path $work 'Temps&Worktrees') "'&' path"
    RunFrom (Join-Path $work 'plain') 'plain path'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 } else { exit 0 }
