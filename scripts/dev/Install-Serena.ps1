<#
  Install-Serena.ps1

  Installs Serena once, at the version in scripts\dev\serena-version.txt,
  and points Claude Code on this machine at the installed program, so a
  session start runs Serena straight away instead of resolving it first.

    pwsh -NoProfile -File scripts\dev\Install-Serena.ps1
    pwsh -NoProfile -File scripts\dev\Install-Serena.ps1 -NoCheck

  Why it exists: #2935. Claude Code gives an MCP server 30 seconds to answer.
  Serena was started as `uvx --from serena-agent serena start-mcp-server ...`,
  and uvx resolves serena-agent against PyPI at every start (148 index entries,
  asked again once the cached answers are ten minutes old). What it resolves
  to changed 15 times in the 30 days to 21 October, and each change makes the
  next start build a new environment: download what changed, install every
  package again, and compile every module on its first import. On One that
  start ran past the 30 seconds and the session had no Serena.

  An installed tool is resolved once, here, and its modules are compiled
  here (--compile-bytecode), so a session start only runs Python. A new
  Serena is a pull request that changes serena-version.txt, and this run
  again on each machine, not something a session start finds out about.

  What it changes: uv's tool folder (uv tool install), and the user scope
  Serena entry in Claude Code's config (claude mcp remove and add). Nothing
  leaves the machine except the download from PyPI. It keeps the options
  the entry already had: the project from the folder Claude Code starts in,
  the claude-code context, and no browser for the dashboard.

  Then it runs scripts\dev\Check-Serena.ps1, which times one start, and exits
  with what that says.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    # Install and register only; do not time a start afterwards.
    [switch]$NoCheck
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Pin = (Get-Content -LiteralPath (Join-Path $Here 'serena-version.txt') -TotalCount 1).Trim()
$Config = if ($env:CLAUDE_CONFIG_DIR) { Join-Path $env:CLAUDE_CONFIG_DIR '.claude.json' } else { Join-Path $HOME '.claude.json' }
$ServeArgs = @('start-mcp-server', '--project-from-cwd', '--context', 'claude-code', '--open-web-dashboard', 'False')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

$uv = Get-Command uv -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $uv) { Die 'uv is not on PATH. Install it with: winget install --id astral-sh.uv -e' }
$claude = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $claude) { Die 'claude (Claude Code) is not on PATH, so there is nothing to point at Serena.' }

# ------------------------------------------------------------ the program ---

$have = @(& $uv.Source tool list 2>$null | Where-Object { $_ -match '^serena-agent v(\S+)' } | ForEach-Object { $Matches[1] })
if ($have -and $have[0] -eq $Pin) {
    Say "have   serena-agent $Pin, installed by uv" 'DarkGray'
} else {
    $was = if ($have) { "serena-agent $($have[0])" } else { 'no serena-agent' }
    Say "install serena-agent $Pin (uv had $was)" 'Green'
    # --reinstall so a tool from another version is replaced whole, with
    # every module compiled again, rather than upgraded in place.
    & $uv.Source tool install --reinstall --compile-bytecode "serena-agent==$Pin"
    if ($LASTEXITCODE -ne 0) { Die "uv tool install serena-agent==$Pin stopped with exit code $LASTEXITCODE; its own lines above say why." }
}
$bin = (& $uv.Source tool dir --bin).Trim()
$exe = Join-Path $bin ('serena' + $(if ($IsWindows) { '.exe' } else { '' }))
if (-not (Test-Path -LiteralPath $exe)) { Die "uv installed serena-agent but $exe is not there." }

# ------------------------------------------------------------ Claude Code ---

$entry = $null
if (Test-Path -LiteralPath $Config) {
    $cfg = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json -AsHashtable
    if ($cfg.ContainsKey('mcpServers') -and $cfg.mcpServers -and $cfg.mcpServers.ContainsKey('serena')) { $entry = $cfg.mcpServers['serena'] }
}
$same = $entry -and ([string]$entry.command -eq $exe) -and ((@($entry.args) -join "`n") -eq ($ServeArgs -join "`n"))
if ($same) {
    Say "have   Claude Code starts $exe" 'DarkGray'
} else {
    if ($entry) {
        Say ("remove Claude Code's Serena entry: {0} {1}" -f $entry.command, (@($entry.args) -join ' ')) 'Yellow'
        & $claude.Source mcp remove --scope user serena
        if ($LASTEXITCODE -ne 0) { Die "claude mcp remove --scope user serena stopped with exit code $LASTEXITCODE." }
    }
    Say "add    Claude Code's Serena entry: $exe $($ServeArgs -join ' ')" 'Green'
    & $claude.Source mcp add --scope user serena -- $exe @ServeArgs
    if ($LASTEXITCODE -ne 0) { Die "claude mcp add --scope user serena stopped with exit code $LASTEXITCODE." }
}
Say 'A Claude Code session already running keeps the Serena it started with; the next session starts this one.'

if ($NoCheck) { exit 0 }
& pwsh -NoProfile -File (Join-Path $Here 'Check-Serena.ps1') -Config $Config
exit $LASTEXITCODE
