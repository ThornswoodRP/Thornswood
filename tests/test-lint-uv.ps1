<#
  test-lint-uv.ps1

  Issue #4481. The lint script, scripts\dev\Lint.ps1, runs ruff using uv when
  no python is on PATH, using the hash-pinned requirements.txt. When neither
  python nor uv is available, the warning names both ways to get one.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$root = Split-Path -Parent $Here
$pass = 0; $fail = 0
function Check([bool]$ok, [string]$what) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

$uvCmd = Get-Command uv -CommandType Application -ErrorAction SilentlyContinue
if (-not $uvCmd) {
    Write-Host "SKIP  uv is not installed on this machine"
    exit 0
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('lint-uv-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$repo = Join-Path $work 'repo'
$tools1 = Join-Path $work 'tools-uv'
$tools2 = Join-Path $work 'tools-none'

try {
    New-Item -ItemType Directory -Force -Path (Join-Path $repo '.github\lint'), (Join-Path $repo 'scripts\dev'), $tools1, $tools2 | Out-Null
    Copy-Item -LiteralPath (Join-Path $root '.github\ruff-requirements.txt') -Destination (Join-Path $repo '.github')
    Copy-Item -LiteralPath (Join-Path $root '.github\lint\ruff.toml') -Destination (Join-Path $repo '.github\lint')
    Copy-Item -LiteralPath (Join-Path $root 'scripts\dev\Lint.ps1') -Destination (Join-Path $repo 'scripts\dev')
    Set-Content -LiteralPath (Join-Path $repo 'sample.py') -Value "x = 1`n"

    # 1. On a machine with uv and no python on PATH:
    $uvPath = ($env:PATH -split ';' | Where-Object { $_ -and -not ($_ -match '(?i)python') -and -not ($_ -match '(?i)WindowsApps') }) -join ';'
    $outUv = (& pwsh -NoProfile -Command "Set-Location '$repo'; `$env:PATH = '$uvPath'; & (Join-Path '$repo' 'scripts\dev\Lint.ps1') -Files sample.py -Tools '$tools1' -Only ruff" 2>&1 | Out-String)
    Check ($outUv -match 'fetched ruff-') "ruff was fetched using uv when python is not on PATH"
    Check ($outUv -notmatch 'ruff lint skipped') "ruff lint did not skip when uv is available"

    # 2. On a machine with neither python nor uv on PATH:
    $noPyNoUv = ($env:PATH -split ';' | Where-Object { $_ -and -not ($_ -match '(?i)python') -and -not ($_ -match '(?i)WindowsApps') -and -not ($_ -match '(?i)\.local\\bin') -and -not ($_ -match '(?i)uv') }) -join ';'
    $outNone = (& pwsh -NoProfile -Command "Set-Location '$repo'; `$env:PATH = '$noPyNoUv'; & (Join-Path '$repo' 'scripts\dev\Lint.ps1') -Files sample.py -Tools '$tools2' -Only ruff" 2>&1 | Out-String)
    Check ($outNone -match 'neither python nor uv found on PATH') "missing tool error names both python and uv"
    Check ($outNone -match 'ruff lint skipped \(install python or uv\)') "warning names both python and uv to get one"

} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail -ne 0) { exit 1 }
