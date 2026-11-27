<#
  Install-HarnessTools.ps1

      pwsh -NoProfile -File scripts/dev/Install-HarnessTools.ps1

  What a few harnesses need on a CI runner that the runner does not have, put
  where they look for it, for the gate's shares and the nightly's (#7114):

    - eslint 9.39.5 in herald-lint in the temp folder, the folder
      tests\test-eslint-amp-path.ps1 copies it from (the same pinned install
      scripts\dev\Lint.ps1 makes). Without it that harness says SKIP and
      exits 2.
    - the bot's hash-pinned libraries (bot\requirements.txt) in a venv of
      this run's own under RUNNER_TEMP, never the runner's Python, named in
      THORNSWOOD_BOT_PYTHON for the steps after this one. tests\bot-python.js
      asks that Python first, so the harnesses that run bot.py
      (tests\test-staff-commands.js and the others that use bot-python.js)
      find the bot's libraries.

  WHY. Putting every harness on the gate (#7100) showed both failing on every
  runner: nothing installed eslint for the gate, only harnesses.yml and the
  nightly did, and only the "Bot harnesses" job had the bot's libraries.

  Run before the harnesses, with pwsh and a Python 3.12 on PATH (setup-python).
  Fails, saying which, when either install does not work.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$cache = Join-Path ([IO.Path]::GetTempPath()) 'herald-lint'
& npm install --prefix $cache --no-save --no-audit --no-fund --silent eslint@9.39.5
if (-not (Test-Path -LiteralPath (Join-Path (Join-Path (Join-Path (Join-Path $cache 'node_modules') 'eslint') 'bin') 'eslint.js'))) {
    Write-Host '::error::could not install eslint 9.39.5 into herald-lint, so the lint harness has nothing to copy'
    exit 1
}
Write-Host ('eslint 9.39.5 is in ' + $cache)

$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$venv = Join-Path $base 'harness-bot-venv'
& python -m venv $venv
if ($LASTEXITCODE -ne 0) { Write-Host '::error::could not make the venv for the bot''s libraries'; exit 1 }
$py = if ($IsWindows) { Join-Path (Join-Path $venv 'Scripts') 'python.exe' } else { Join-Path (Join-Path $venv 'bin') 'python' }
if (-not (Test-Path -LiteralPath $py)) { Write-Host "::error::the venv has no python at $py"; exit 1 }
& $py -m pip install --quiet --disable-pip-version-check --require-hashes --only-binary :all: -r (Join-Path (Join-Path $Repo 'bot') 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Write-Host '::error::could not install the bot''s libraries from bot/requirements.txt'; exit 1 }
if ($env:GITHUB_ENV) { "THORNSWOOD_BOT_PYTHON=$py" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8 }
Write-Host ('the bot''s libraries are in ' + $venv + ' (THORNSWOOD_BOT_PYTHON)')
