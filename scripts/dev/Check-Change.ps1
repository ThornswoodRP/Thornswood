<#
.SYNOPSIS
  Runs, before a push, the gate harnesses this branch's change can reach,
  from main's nightly map, in a cloud container or on a PC (#5183).

.DESCRIPTION
      pwsh scripts/dev/Check-Change.ps1
      pwsh scripts/dev/Check-Change.ps1 -Body pr-body.md     the PR's test tasks too
      pwsh scripts/dev/Check-Change.ps1 -List                say what would run, run nothing

  WHY. Of the last 100 pull request runs on 31 Oct 2026, 20 failed and 15
  were cancelled by a newer push: a change was pushed, and what it broke was
  learned from the shares, a round trip of six minutes and six Windows jobs
  each time. The same harnesses the shares would run can run here first.

  WHAT IT RUNS. Main's newest nightly map (.github\workflows\gate-map.yml,
  fetched by scripts\dev\Gate-Map.ps1 -Fetch), the same pick the pull
  request's shares make (scripts\dev\Affected-Harnesses.js pick, from the
  traced tree to this checkout's HEAD), and those harnesses through
  scripts\dev\Nightly-Harnesses.ps1, on their own clocks, with the throttle
  this machine's cores allow. So what passes here is what the shares run,
  measured from the same map. On Linux a harness that needs Windows prints
  SKIP for those checks, and the shares run them on Windows.

  With -Body, the pull request's body in a file is checked as its checks
  will: its release note line as "Release note" holds it (thornswood-notes
  in tools\ReleaseNotes, #5179, which needs the .NET 10 SDK), and its test
  tasks to the bot's
  post rules as "Test tasks in the pull request" holds them
  (bot\pr_tasks.py, #5199), which needs the bot's libraries
  (bot\requirements.txt).

  COMMIT FIRST. The change is HEAD against the traced tree, as on GitHub, so
  edits not yet committed are not part of it; it stops when a tracked file
  has any.

  NO MAP. When no map can be fetched (no token, no nightly run yet, or the
  pick cannot use it) it runs the whole gate, about an hour on four cores,
  and says why first. -List says what it would run without running it.

  The token comes from GITHUB_TOKEN, GH_TOKEN, or gh auth token, in that
  order, and only reaches Gate-Map.ps1, through GATE_MAP_TOKEN, which that
  script takes out of the environment at once; no harness gets it, nor
  GITHUB_TOKEN or GH_TOKEN, as on GitHub. tests\test-5183-check-change.ps1
  holds all of this.

  Exits 0 when everything it ran passed, 1 when anything failed, 2 when it
  could not start.
#>
[CmdletBinding()]
param(
    [string]$Body = '',
    [switch]$List,
    [int]$Throttle = 0
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
function Say([string]$m) { Write-Host $m }
function Stop-Here([string]$m) { Say ('STOP. ' + $m); exit 2 }

$Tokens = 'GITHUB_TOKEN', 'GH_TOKEN'
$kept = @{}
foreach ($n in $Tokens + 'DISCORD_TOKEN', 'THORNSWOOD_BOT_DATA', 'PR_NUMBER', 'HEAD_REF') { $kept[$n] = [Environment]::GetEnvironmentVariable($n) }

Push-Location $Repo
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Stop-Here 'there is no node here, which picks the harnesses and runs the .js ones.' }
    $dirty = @(& git status --porcelain --untracked-files=no 2>$null)
    if ($LASTEXITCODE -ne 0) { Stop-Here 'this is not a git checkout.' }
    if ($dirty.Count) { Stop-Here ('{0} tracked file(s) have changes not committed, and the change checked is HEAD''s, as on GitHub. Commit them, then run this again.' -f $dirty.Count) }
    $head = (& git rev-parse HEAD).Trim()

    $gate = @(& (Join-Path $Here 'Gate-Harnesses.ps1'))
    if ($LASTEXITCODE -ne 0 -or -not $gate.Count) { Stop-Here 'the gate list could not be read (Gate-Harnesses.ps1).' }

    # ---- the map
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('check-change-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $scratch
    $run = $null
    $token = [string]$env:GITHUB_TOKEN
    if (-not $token) { $token = [string]$env:GH_TOKEN }
    # No harness gets a token, as on GitHub, where the gate's shares have
    # none; put back as they were when this ends.
    foreach ($n in $Tokens) { Remove-Item -LiteralPath ('Env:' + $n) -ErrorAction SilentlyContinue }
    if (-not $token -and (Get-Command gh -ErrorAction SilentlyContinue)) {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $token = "$(& gh auth token 2>$null)".Trim() } finally { $ErrorActionPreference = $old }
    }
    if (-not $token) {
        Say 'The whole gate runs: there is no token to fetch main''s gate map with (GITHUB_TOKEN, GH_TOKEN or gh auth login).'
    } else {
        $maps = Join-Path $scratch 'map'
        $env:GATE_MAP_TOKEN = $token
        try { & (Join-Path $Here 'Gate-Map.ps1') -Fetch $maps -Repository 'ThornswoodRP/Thornswood' 2>&1 | ForEach-Object { Say ([string]$_) } }
        finally { Remove-Item -LiteralPath Env:GATE_MAP_TOKEN -ErrorAction SilentlyContinue }
        $token = $null
        if ($LASTEXITCODE -ne 0) {
            Say 'The whole gate runs: main''s gate map could not be fetched (the lines above say why).'
        } else {
            $m = [IO.File]::ReadAllText((Join-Path $maps 'latest.json')) | ConvertFrom-Json
            $mapFile = Join-Path $maps ([string]$m.key + '.map.json')
            $tree = Join-Path $maps ([string]$m.key + '.tree.gz')
            $gateFile = Join-Path $scratch 'gate.txt'
            $out = Join-Path $scratch 'picked.txt'
            [IO.File]::WriteAllLines($gateFile, [string[]]$gate)
            & node (Join-Path $Here 'Affected-Harnesses.js') pick $mapFile $tree ([string]$m.commit) $gateFile $out 2>&1 | ForEach-Object { Say ([string]$_) }
            if ($LASTEXITCODE -ne 0) {
                Say ('The whole gate runs: the pick failed (exit ' + $LASTEXITCODE + '), the lines above say why.')
            } else {
                $run = @([IO.File]::ReadAllLines($out) | Where-Object { $_.Trim() })
            }
        }
    }
    if ($null -eq $run) { $run = $gate }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue

    Say ''
    Say ('{0} of the gate''s {1} harnesses for {2}.' -f $run.Count, $gate.Count, $head.Substring(0, 12))
    if ($List) { foreach ($n in $run) { Say ('  ' + $n) }; exit 0 }

    $code = 0
    if ($run.Count) {
        $with = @{ Only = ($run -join ' ') }
        if ($Throttle -gt 0) { $with.Throttle = $Throttle } else { $with.Throttle = [Math]::Max(1, [Math]::Min(6, [Environment]::ProcessorCount)) }
        & (Join-Path $Here 'Nightly-Harnesses.ps1') @with
        $code = $LASTEXITCODE
    } else {
        Say 'No gate harness can be affected by this change, so none runs.'
    }

    # ---- the pull request's test tasks
    if ($Body) {
        Say ''
        if (-not (Test-Path -LiteralPath $Body)) { Say ('FAIL  there is no body at ' + $Body); $code = 1 }
        else {
            # Its release note, as the check "Release note" holds it (#5179).
            $dotnet = Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $dotnet) {
                Say 'FAIL  the release note: the .NET 10 SDK is not on this machine, and the rules are in tools\ReleaseNotes (docs/guide/set-up-a-machine.md, "Install the tools", has its line)'
                $code = 1
            } else {
                $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
                & $dotnet.Source run --project (Join-Path (Join-Path $Repo 'tools') 'ReleaseNotes') --verbosity quiet -- pr --body-file (Resolve-Path -LiteralPath $Body).Path
                if ($LASTEXITCODE -ne 0) { $code = 1 }
            }
            $py = $null
            foreach ($c in 'python3.12', 'python3', 'python') { if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break } }
            if (-not $py) { Say 'SKIP  the test tasks: there is no Python here' }
            else {
                $env:DISCORD_TOKEN = 'not-a-real-token'
                $data = Join-Path ([IO.Path]::GetTempPath()) ('check-change-bot-' + [Guid]::NewGuid().ToString('N'))
                $null = New-Item -ItemType Directory -Path $data
                $env:THORNSWOOD_BOT_DATA = $data
                foreach ($n in 'PR_NUMBER', 'HEAD_REF') { Remove-Item -LiteralPath ('Env:' + $n) -ErrorAction SilentlyContinue }
                & $py (Join-Path (Join-Path $Repo 'bot') 'pr_tasks.py') --file (Resolve-Path -LiteralPath $Body).Path
                if ($LASTEXITCODE -ne 0) { $code = 1 }
                Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Say ''
    if ($code -ne 0) { Say 'Something failed: fix it before you push.'; exit 1 }
    Say 'Everything this change reaches passed. Push it.'
    exit 0
} finally {
    Pop-Location
    foreach ($n in $kept.Keys) { [Environment]::SetEnvironmentVariable($n, $kept[$n]) }
}
