<#
  test-lint-uv.ps1

      pwsh -NoProfile -File .\tests\test-lint-uv.ps1

  Issue #4481. On a PC whose only Python comes from uv, scripts\dev\Lint.ps1
  makes ruff's environment with uv: uv venv, then uv pip install of the
  hash-pinned .github\ruff-requirements.txt, wheels only, into that venv.
  With neither python nor uv on the PATH, it says both ways to get one.

  This harness used to stop with SKIP wherever uv was not installed, which
  is every runner, so the uv route ran nowhere it was checked. Now a
  stand-in uv runs the route wherever a Python is to be found here:

    A  with only the stand-in uv on the PATH, ruff is fetched through it and
       lints: the venv is asked for first, then the pinned install, hashes
       required and wheels only, into that venv's Python; and the stand-in
       refuses any other shape of call, as uv would;
    B  with the real uv on the PATH too, when this machine has one, the
       same, through the real uv;
    C  with nothing on the PATH, the warning names python and uv.

  The stand-in makes the venv without pip, as uv does, and installs with
  the Python found here through pip --python, so ruff comes from PyPI as
  it does for the build. Everything is written in a temp folder that is
  removed at the end.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$root = Split-Path -Parent $Here
$script:pass = 0; $script:fail = 0
function Check([bool]$ok, [string]$what) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$onWindows = ($IsWindows -or $env:OS -eq 'Windows_NT')
$pwsh = (Get-Process -Id $PID).Path

# A Python to stand behind the stand-in: a real one, not the Store's stub.
$py = $null
foreach ($n in @('python', 'python3')) {
    foreach ($c in @(Get-Command $n -CommandType Application -All -ErrorAction SilentlyContinue)) {
        if ($c.Source -match '(?i)WindowsApps') { continue }
        $v = (& $c.Source -c 'import sys, pip; print(sys.version_info[0] * 100 + sys.version_info[1])' 2>$null)
        if ($LASTEXITCODE -eq 0 -and [int]"$v" -ge 308) { $py = $c.Source; break }
    }
    if ($py) { break }
}
Check ($null -ne $py) ('a Python with pip is here to stand behind the stand-in uv (' + $py + ')')
if (-not $py) { Write-Host ''; Write-Host "$script:pass passed, $script:fail failed"; exit 1 }

$work = Join-Path ([IO.Path]::GetTempPath()) ('lint-uv-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$repo = Join-Path $work 'repo'
try {
    foreach ($d in @((Join-Path $repo '.github/lint'), (Join-Path $repo 'scripts/dev'), (Join-Path $work 'stand-in'), (Join-Path $work 'real'), (Join-Path $work 'nothing'))) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $root '.github/ruff-requirements.txt') -Destination (Join-Path $repo '.github')
    Copy-Item -LiteralPath (Join-Path $root '.github/lint/ruff.toml') -Destination (Join-Path $repo '.github/lint')
    Copy-Item -LiteralPath (Join-Path $root 'scripts/dev/Lint.ps1') -Destination (Join-Path $repo 'scripts/dev')
    # One finding ruff always has, so a run that linted is told from one that did not.
    Set-Content -LiteralPath (Join-Path $repo 'sample.py') -Value "import os`nx = 1"

    # ---- the stand-in uv ----
    $calls = Join-Path $work 'uv-calls.txt'
    $standIn = Join-Path $work 'stand-in'
    $body = @'
$ErrorActionPreference = 'Stop'
$py = 'PYTHON'
$a = @($args)
Add-Content -LiteralPath 'CALLS' -Value ($a -join ' | ')
if ($a.Count -eq 2 -and $a[0] -eq 'venv') {
    & $py -m venv --without-pip $a[1]
    exit $LASTEXITCODE
}
if ($a.Count -ge 2 -and $a[0] -eq 'pip' -and $a[1] -eq 'install') {
    $req = $null; $into = $null; $hashes = $false; $binary = $false
    for ($i = 2; $i -lt $a.Count; $i++) {
        switch -Exact ($a[$i]) {
            '--quiet' { }
            '--require-hashes' { $hashes = $true }
            '--only-binary' { $i++; $binary = ($a[$i] -eq ':all:') }
            '-r' { $i++; $req = $a[$i] }
            '--python' { $i++; $into = $a[$i] }
            default { [Console]::Error.WriteLine('stand-in uv: unexpected ' + $a[$i]); exit 2 }
        }
    }
    if (-not ($req -and $into -and $hashes -and $binary)) { [Console]::Error.WriteLine('stand-in uv: not a pinned wheel install into a venv'); exit 2 }
    & $py -m pip --python $into install --quiet --disable-pip-version-check --only-binary ':all:' --require-hashes -r $req
    exit $LASTEXITCODE
}
[Console]::Error.WriteLine('stand-in uv: no such call'); exit 2
'@
    $body = $body.Replace("'PYTHON'", "'" + $py.Replace("'", "''") + "'").Replace("'CALLS'", "'" + $calls.Replace("'", "''") + "'")
    $script = Join-Path $work 'uv-stand-in.ps1'
    Set-Content -LiteralPath $script -Value $body -Encoding UTF8
    if ($onWindows) {
        Set-Content -LiteralPath (Join-Path $standIn 'uv.cmd') -Value ('@"' + $pwsh + '" -NoProfile -File "' + $script + '" %*') -Encoding ASCII
    } else {
        $sh = Join-Path $standIn 'uv'
        Set-Content -LiteralPath $sh -Value ("#!/bin/sh`nexec '" + $pwsh + "' -NoProfile -File '" + $script + "' `"`$@`"") -NoNewline
        & chmod +x $sh
    }

    function Lint-With([string]$path, [string]$tools) {
        $env:LINT_UV_PATH = $path
        $env:LINT_UV_REPO = $repo
        $env:LINT_UV_TOOLS = $tools
        $said = (& $pwsh -NoProfile -Command 'Set-Location $env:LINT_UV_REPO; $env:PATH = $env:LINT_UV_PATH; & (Join-Path $env:LINT_UV_REPO ''scripts/dev/Lint.ps1'') -Files sample.py -Tools $env:LINT_UV_TOOLS -Only ruff' 2>&1 | Out-String)
        Remove-Item Env:\LINT_UV_PATH, Env:\LINT_UV_REPO, Env:\LINT_UV_TOOLS
        return $said
    }
    $venvPy = if ($onWindows) { 'Scripts\python.exe' } else { 'bin/python' }

    # ---- A. only the stand-in uv on the PATH ----
    Write-Host '--- A. no python on the PATH, the stand-in uv'
    $out = Lint-With $standIn (Join-Path $work 'tools-a')
    $log = @(if (Test-Path -LiteralPath $calls) { Get-Content -LiteralPath $calls })
    Check ($out -match 'fetched ruff-') 'ruff is fetched through uv'
    Check ($out -match 'F401') 'and ruff lints the file'
    Check ($out -notmatch 'ruff lint skipped') 'it is not skipped'
    Check ($log.Count -eq 2 -and $log[0] -match '^venv \| ' -and $log[1] -match '^pip \| install \| ') ('uv is asked for the venv, then the install (' + ($log -join ' / ') + ')')
    $venvDir = if ($log.Count) { ($log[0] -split ' \| ')[1] } else { '' }
    $inst = if ($log.Count -gt 1) { @($log[1] -split ' \| ') } else { @() }
    $at = { param($flag) $k = [array]::IndexOf($inst, $flag); if ($k -ge 0 -and $k + 1 -lt $inst.Count) { $inst[$k + 1] } else { $null } }
    Check (($inst -contains '--require-hashes') -and (& $at '--only-binary') -eq ':all:') 'the install requires the hashes and takes wheels only'
    Check ("$(& $at '-r')" -match 'ruff-requirements\.txt$') 'from the pinned .github\ruff-requirements.txt'
    Check ($venvDir -and "$(& $at '--python')" -eq (Join-Path $venvDir $venvPy)) 'into the Python of the venv uv made'

    # ---- B. the real uv, where this machine has one ----
    $uv = @(Get-Command uv -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike ($standIn + '*') })
    if ($uv.Count) {
        Write-Host '--- B. no python on the PATH, the real uv'
        $real = Join-Path $work 'real'
        Copy-Item -LiteralPath $uv[0].Source -Destination $real
        $out = Lint-With $real (Join-Path $work 'tools-b')
        Check ($out -match 'fetched ruff-' -and $out -match 'F401' -and $out -notmatch 'ruff lint skipped') 'the real uv fetches ruff and it lints the file'
    } else {
        Write-Host '--- B. no real uv on this machine, so only the stand-in ran'
    }

    # ---- C. nothing on the PATH ----
    Write-Host '--- C. neither python nor uv on the PATH'
    $out = Lint-With (Join-Path $work 'nothing') (Join-Path $work 'tools-c')
    Check ($out -match 'neither python nor uv found on PATH') 'the fetch says neither python nor uv was found'
    Check ($out -match 'ruff lint skipped \(install python or uv\)') 'and the warning names both ways to get one'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail -ne 0) { exit 1 }
