<#
.SYNOPSIS
  Reports ruff, eslint and PSScriptAnalyzer findings, warnings only, over the files it is given or the whole tree, with each pinned tool fetched once per machine.

.DESCRIPTION
  Issue #3185 (from #1343). The build's "Lint (warnings only)" step fetched
  eslint 9.39.5 with npm and PSScriptAnalyzer 1.24.0 from the PowerShell
  Gallery into RUNNER_TEMP on every job, which the runner empties after it,
  and linted every file in the repository: 35 s a build on average over 8
  green pull request builds on 21 Oct 2026, 14 to 122 s, and about 2.5 box
  hours that day. A report of all 1,276 findings nobody reads on every build
  is the nightly's job.

  So each pinned tool is fetched once into a folder named by its version
  under -Tools, which is the runner account's own (every runner has an
  account of its own, #2161), and used from there while it is that version.
  A fetch goes into a folder of its own first and is renamed into place only
  when it is whole, so a fetch cut short is fetched again next time, never
  used. A new version is a new folder.

  With -Files, only those files are linted: what a pull request changed. A
  file that is not there any more, or of a kind no linter reads, is left out.
  With -All, the whole tree, as the nightly does.

  It never fails anything: findings are GitHub warnings (errors for
  PSScriptAnalyzer's own Error severity and eslint's severity 2), written as
  ::warning and ::error lines with the file and line, so a pull request shows
  them on its files, and it ends 0. ruff writes those lines itself; eslint's
  JSON and PSScriptAnalyzer's findings are turned into them here. A tool it could not
  fetch is a warning saying that linter did not run.

  tests\test-eslint-amp-path.ps1 runs the eslint part under a folder holding
  '&', with the pinned eslint copied into -Tools.

.PARAMETER Files
  The files to lint, relative to the current folder. One string of names
  separated by spaces or new lines also works.

.PARAMETER All
  Lint the whole tree instead.

.PARAMETER Tools
  Where the pinned tools are kept. The machine's own Thornswood folder
  (%LOCALAPPDATA%\Thornswood\lint-tools) unless a test points it elsewhere.

.PARAMETER Only
  ruff, eslint or psscriptanalyzer: run that linter alone (a harness does).

.EXAMPLE
  .\scripts\dev\Lint.ps1 -All
#>
[CmdletBinding()]
param(
    [string[]]$Files = @(),
    [switch]$All,
    [string]$Tools = '',
    [ValidateSet('', 'ruff', 'eslint', 'psscriptanalyzer')][string]$Only = ''
)

$ErrorActionPreference = 'Stop'
$EslintVersion = '9.39.5'
$PssaVersion = '1.24.0'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Tools) { $Tools = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Thornswood\lint-tools' }

if (-not $All) {
    $Files = @($Files | ForEach-Object { [string]$_ -split '\s+' } | Where-Object { $_ } |
        ForEach-Object { $_ -replace '\\', '/' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Sort-Object -Unique)
    Write-Host ("{0} file(s) to lint" -f $Files.Count)
    if ($Files.Count -eq 0) { exit 0 }
}
function Of([string[]]$ext) { @($Files | Where-Object { $ext -contains [IO.Path]::GetExtension($_).ToLowerInvariant() }) }
# One linter, unless -Only names another. Whatever it throws is a warning:
# this step reports, it never fails a build.
function Lint([string]$name, [scriptblock]$run) {
    if ($Only -and $Only -ne $name) { return }
    try { & $run } catch { Write-Host ("::warning::{0} lint stopped: {1}" -f $name, $_.Exception.Message) }
}

# One tool's folder: $Tools\<name>-<version>, used while $whole says it is
# whole, otherwise fetched again into a folder of its own and renamed in.
function Get-Tool([string]$name, [scriptblock]$whole, [scriptblock]$fetch) {
    $dir = Join-Path $Tools $name
    if (Test-Path -LiteralPath $dir) {
        if (& $whole $dir) { return $dir }
        Remove-Item -LiteralPath $dir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $Tools | Out-Null
    $new = Join-Path $Tools ($name + '.fetching-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $new | Out-Null
    try {
        & $fetch $new
        if (-not (& $whole $new)) { return $null }
        Move-Item -LiteralPath $new -Destination $dir
        Write-Host "fetched $name into $dir"
        return $dir
    } catch {
        Write-Host ("::warning::could not fetch {0}: {1}" -f $name, $_.Exception.Message)
        return $null
    } finally {
        if (Test-Path -LiteralPath $new) { Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

# ruff: the venv the build's "Check the Python names what exists" step made
# from the hash-pinned .github\ruff-requirements.txt. Where no step made one
# (the nightly), a venv of the same pinned file under -Tools, named by the
# file's own hash, so a new pin is a new venv.
Lint 'ruff' {
    $list = @(if ($All) { @(git ls-files '*.py') } else { Of @('.py') })
    if (-not $list.Count) { return }
    $py = if ($env:RUNNER_TEMP) { Join-Path $env:RUNNER_TEMP 'ruff-venv\Scripts\python.exe' } else { '' }
    if (-not $py -or -not (Test-Path -LiteralPath $py)) {
        $req = Join-Path $Repo '.github\ruff-requirements.txt'
        $pin = (Get-FileHash -LiteralPath $req -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant()
        $bin = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'Scripts\python.exe' } else { 'bin/python' }
        $dir = Get-Tool ('ruff-' + $pin) {
            param($d)
            $p = Join-Path $d $bin
            (Test-Path -LiteralPath $p) -and ((& $p -m ruff --version 2>$null) -match '^ruff ')
        } {
            param($d)
            if (Get-Command python -CommandType Application -ErrorAction SilentlyContinue) {
                python -m venv $d
                & (Join-Path $d $bin) -m pip install --quiet --disable-pip-version-check --only-binary :all: --require-hashes -r $req
            }
            elseif (Get-Command uv -CommandType Application -ErrorAction SilentlyContinue) {
                uv venv $d
                uv pip install --quiet --require-hashes -r $req --python (Join-Path $d $bin)
            }
            else {
                throw 'neither python nor uv found on PATH'
            }
        }
        $py = if ($dir) { Join-Path $dir $bin } else { '' }
    }
    if (-not $py) { Write-Host '::warning::no ruff venv, ruff lint skipped (install python or uv)' }
    else { & $py -m ruff check --no-cache --config (Join-Path $Repo '.github\lint\ruff.toml') --exit-zero --output-format github @list }
}

# A workflow command's text and its file= property, escaped the way GitHub
# reads them back: % and line ends in both, and , and : in a property.
function Format-Data([string]$s) { return $s.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A') }
function Format-Property([string]$s) { return (Format-Data $s).Replace(':', '%3A').Replace(',', '%2C') }

# eslint: pinned by version only (no lockfile, no hash). node runs eslint.js
# itself, not npm's eslint.cmd shim: cmd.exe reads the shim, whose
# 'SET dp0=%~dp0' and '%*' are unquoted, so an '&' in its folder or an
# argument (C:\ThornswoodTemps&Worktrees) cut the command short and eslint
# never ran (#1343).
Lint 'eslint' {
    $list = @(if ($All) { @('.') } else { Of @('.js', '.mjs', '.cjs') })
    if ($list.Count) {
        $dir = Get-Tool ('eslint-' + $EslintVersion) {
            param($d)
            $pkg = Join-Path $d 'node_modules\eslint\package.json'
            (Test-Path -LiteralPath $pkg) -and ((Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).version -eq $EslintVersion)
        } {
            param($d)
            npm install --prefix $d --no-save --no-audit --no-fund --silent ('eslint@' + $EslintVersion)
        }
        if ($dir) {
            # eslint 9 has no GitHub format of its own, so its JSON is turned
            # into the same workflow lines ruff and PSScriptAnalyzer write
            # (#4311): a finding eslint calls an error (severity 2, a file
            # that does not parse) is ::error, the rest ::warning.
            $json = (& node (Join-Path $dir 'node_modules\eslint\bin\eslint.js') -c (Join-Path $Repo '.github\lint\eslint.config.mjs') --no-warn-ignored -f json @list | Out-String)
            $n = 0
            foreach ($r in @($json | ConvertFrom-Json)) {
                foreach ($m in @($r.messages)) {
                    $n++
                    $lvl = if ([int]$m.severity -ge 2) { 'error' } else { 'warning' }
                    $rule = if ($m.ruleId) { [string]$m.ruleId } else { 'eslint' }
                    Write-Host ("::{0} file={1},line={2},col={3}::{4}: {5}" -f $lvl, (Format-Property $r.filePath), [int]$m.line, [int]$m.column, $rule, (Format-Data ([string]$m.message)))
                }
            }
            Write-Host ("eslint: {0} finding(s)" -f $n)
        } else { Write-Host "::warning::could not fetch eslint $EslintVersion, eslint lint skipped" }
    }
}

# PSScriptAnalyzer: pinned by version only, from the PowerShell Gallery.
Lint 'psscriptanalyzer' {
    $list = @(if ($All) { @('.') } else { Of @('.ps1', '.psm1', '.psd1') })
    if ($list.Count) {
        $dir = Get-Tool ('PSScriptAnalyzer-' + $PssaVersion) {
            param($d)
            $psd = Join-Path $d ('PSScriptAnalyzer\' + $PssaVersion + '\PSScriptAnalyzer.psd1')
            (Test-Path -LiteralPath $psd) -and ([string](Import-PowerShellDataFile -LiteralPath $psd).ModuleVersion -eq $PssaVersion)
        } {
            param($d)
            Save-Module -Name PSScriptAnalyzer -RequiredVersion $PssaVersion -Path $d -Repository PSGallery -Force
        }
        if ($dir) {
            Import-Module (Join-Path $dir ('PSScriptAnalyzer\' + $PssaVersion + '\PSScriptAnalyzer.psd1'))
            $settings = Join-Path $Repo '.github\lint\PSScriptAnalyzerSettings.psd1'
            $found = @(foreach ($p in $list) { Invoke-ScriptAnalyzer -Path $p -Recurse:($p -eq '.') -Settings $settings })
            foreach ($d in $found) {
                $lvl = if ($d.Severity -eq 'Error') { 'error' } else { 'warning' }
                Write-Host ("::{0} file={1},line={2}::{3}: {4}" -f $lvl, $d.ScriptPath, $d.Line, $d.RuleName, $d.Message)
            }
            Write-Host ("PSScriptAnalyzer: {0} finding(s)" -f $found.Count)
        } else { Write-Host "::warning::could not fetch PSScriptAnalyzer $PssaVersion, PSScriptAnalyzer lint skipped" }
    }
}
exit 0
