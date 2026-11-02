<#
.SYNOPSIS
  Says whether a pull request's change reaches the job "Launcher builds"
  (#5292): launcher=true or launcher=false, to the step's outputs.

.DESCRIPTION
      ./scripts/dev/Launcher-Reach.ps1 -Base <base commit>     build.yml's pick job
      pwsh scripts/dev/Launcher-Reach.ps1 -Base origin/main     by hand, on a branch

  THE PATH RULE (decided by Patrick on 31 Oct 2026, plan part 4). A pull
  request that changes only files under docs, site or bot cannot change what
  "Launcher builds" checks: the launcher's project (its window compiled
  markup and the install its own code, #4823, #4824) and the ship root tool
  read none of those folders, and the
  writing check's harness, which that job runs for its Windows PowerShell 5.1
  comparison, runs in "Tree checks" for every change as well
  (tests\test-5292-path-rule.ps1 holds all of it). So that job is skipped
  for such a change, and the Windows runner it would wait for is
  never started. Every other check of the tree runs for it as for any change,
  in the job "Tree checks" on Linux and in whatever gate harnesses the change
  reaches.

  WHAT IT READS. The files the change touches: git's list of paths that differ
  between -Base and HEAD. On a pull request HEAD is GitHub's merge of it into
  its base, so that list is exactly the pull request's change. The base
  commit is fetched first (one commit, no history) when the checkout does not
  hold it.

  WHEN IT CANNOT TELL. Not a pull request (main, a run by hand), no -Base, a
  base git cannot fetch, or no file changed: launcher=true, and it says why.
  The launcher is never skipped on a guess.

  Prints why in one line, and exits 0 either way; 2 only when it is not in a
  git checkout at all.
#>
[CmdletBinding()]
param(
    [string]$Base = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)

# The folders a change may stay inside and leave the launcher job nothing to
# check. Only these three: anything else, the root's own files included,
# builds.
$Outside = @('docs/', 'site/', 'bot/')

function Set-Out([string]$value, [string]$why) {
    Write-Host ('Launcher builds: ' + $(if ($value -eq 'true') { 'runs' } else { 'skipped' }) + ', ' + $why)
    if ($env:GITHUB_OUTPUT) { Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value ('launcher=' + $value) -Encoding utf8 }
    exit 0
}

$null = & git -C $Repo rev-parse --git-dir 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host ('STOP. {0} is not a git checkout.' -f $Repo); exit 2 }

if ($env:GITHUB_EVENT_NAME -and $env:GITHUB_EVENT_NAME -ne 'pull_request') { Set-Out 'true' ('this is a ' + $env:GITHUB_EVENT_NAME + ' run, not a pull request, and those always build.') }
if (-not $Base) { Set-Out 'true' 'no base commit was given, so what the change touches is not known.' }

$have = & git -C $Repo rev-parse --verify --quiet ($Base + '^{commit}') 2>$null
if ($LASTEXITCODE -ne 0 -or -not $have) {
    if ($Base -match '^[0-9a-f]{40}$') { $null = & git -C $Repo fetch -q --depth=1 --no-tags origin $Base 2>&1 }
    $have = & git -C $Repo rev-parse --verify --quiet ($Base + '^{commit}') 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $have) { Set-Out 'true' ('git could not fetch the base ' + $Base + ', so what the change touches is not known.') }
}

$changed = @(& git -C $Repo -c core.quotepath=off diff --name-only --no-renames $Base HEAD 2>$null | Where-Object { $_ })
if ($LASTEXITCODE -ne 0) { Set-Out 'true' ('git could not list what changed against ' + $Base + '.') }
if (-not $changed.Count) { Set-Out 'true' ('git lists no file changed against ' + $Base + '.') }

$reach = @($changed | Where-Object { $p = $_; -not @($Outside | Where-Object { $p.StartsWith($_) }).Count })
if ($reach.Count) {
    $show = @($reach | Select-Object -First 3) -join ', '
    if ($reach.Count -gt 3) { $show += (' and {0} more' -f ($reach.Count - 3)) }
    Set-Out 'true' ('the change touches ' + $show + ', outside ' + ($Outside -join ', ') + '.')
}
Set-Out 'false' ('all {0} file(s) the change touches are under {1}, which nothing it checks reads (#5292).' -f $changed.Count, ($Outside -join ', '))
