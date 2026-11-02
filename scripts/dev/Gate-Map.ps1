<#
.SYNOPSIS
  Fetches the newest map of which gate harnesses a change can reach: the
  gate-map artifact of main's nightly trace on GitHub's runner (#5183,
  #4009).

.DESCRIPTION
      .\scripts\dev\Gate-Map.ps1 -Fetch <dir>      (the token in GATE_MAP_TOKEN)

  .github\workflows\gate-map.yml traces the whole gate every night on
  GitHub's hosted Windows runner and keeps latest.json, <key>.map.json and
  <key>.tree.gz as an artifact named gate-map, and since #5293
  <key>.platforms.json, which harnesses its Linux run ran as fully. This reads the newest finished
  runs of that workflow, newest first, and from the first that is main's own
  (gate-map.yml on main, from the schedule, a push to main or a run by hand, of this
  repository) and still holds a gate-map artifact, writes those three files
  into <dir>, the shape scripts\dev\Run-Gate.ps1 and Check-Change.ps1 read.
  Exit 0 with a map in <dir>, 1 without, saying why.

  WHY ONLY MAIN'S RUN. A pull request's code runs in its own workflow and
  can upload anything; a pull request that changes the trace's own scripts
  runs gate-map.yml too, and keeps gate-map-trial, which this never reads.
  So a map counts only from a run GitHub says is gate-map.yml on main from
  the schedule, a push to main or workflow_dispatch, read back for each run, and only an
  artifact named gate-map whose latest.json names that run's own key.

  BEFORE #5183. Until #4983 an administrator task on the box traced each
  main build and main's build printed the map into its log (-Hand, gone with
  it), which this read back; since then no build ran on the box, no map was
  made, and every pull request ran the whole gate.

  The token needs actions: read (an artifact's download needs a token even
  on a public repository). -Fetch reads it from GATE_MAP_TOKEN and takes it
  out of the environment before anything else, so it is never typed or on a
  command line (#4079, tests\test-secrets-off-command-lines.ps1). Run-Gate.ps1
  takes it out of the step's environment before any harness starts and sets
  it only around this call. tests\test-4009-gate-map.ps1 holds this.

.PARAMETER Fetch
  The folder to write the newest map into. Whatever is there goes.

.PARAMETER Repository
  owner/name, GITHUB_REPOSITORY by default, else ThornswoodRP/Thornswood.

.PARAMETER Api
  GitHub's API, https://api.github.com by default (the harness stands in).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Fetch,
    [string]$Repository = $env:GITHUB_REPOSITORY,
    [string]$Api = 'https://api.github.com'
)

$ErrorActionPreference = 'Stop'
# How many of main's newest finished traces are read before giving up.
$Look = 8
$Workflow = 'gate-map.yml'
$Artifact = 'gate-map'
function Say([string]$m) { Write-Host $m }

# A token that may read this repository's Actions runs and artifacts, out of
# the environment at once (#4079).
$Token = [string]$env:GATE_MAP_TOKEN
Remove-Item -LiteralPath Env:GATE_MAP_TOKEN -ErrorAction SilentlyContinue

if (-not $Repository) { $Repository = 'ThornswoodRP/Thornswood' }
if (-not $Token) { Say 'No token to read main''s gate map on GitHub with.'; exit 1 }
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { Say ('No repository to look in (' + $Repository + ').'); exit 1 }
$headers = @{ Authorization = ('Bearer ' + $Token); Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
$base = $Api.TrimEnd('/') + '/repos/' + $Repository + '/actions'
$ProgressPreference = 'SilentlyContinue'

try {
    $list = Invoke-RestMethod -Method Get -Uri ($base + '/workflows/' + $Workflow + '/runs?branch=main&status=completed&per_page=' + $Look) -Headers $headers
} catch {
    Say ('GitHub would not list main''s gate traces: ' + $_.Exception.Message)
    exit 1
}
$runs = @($list.workflow_runs)
if (-not $runs.Count) { Say ('GitHub lists no finished ' + $Workflow + ' run on main.'); exit 1 }
foreach ($run in $runs) {
    $what = 'main''s gate trace, run ' + $run.id
    if (@('schedule', 'push', 'workflow_dispatch') -notcontains [string]$run.event -or [string]$run.head_branch -ne 'main' -or
        [string]$run.path -notmatch ('^\.github/workflows/' + [regex]::Escape($Workflow) + '(@|$)') -or [string]$run.head_repository.full_name -ne $Repository) {
        Say ('Passed over run ' + $run.id + ': it is ' + $run.path + ' on ' + $run.event + ' to ' + $run.head_branch + ', not ' + $Workflow + ' on main from the schedule, a push or by hand.')
        continue
    }
    try {
        $arts = Invoke-RestMethod -Method Get -Uri ($base + '/runs/' + $run.id + '/artifacts?name=' + $Artifact) -Headers $headers
    } catch {
        Say ('Passed over ' + $what + ': GitHub would not list its artifacts (' + $_.Exception.Message + ').')
        continue
    }
    $art = @($arts.artifacts | Where-Object { [string]$_.name -eq $Artifact -and -not $_.expired } | Select-Object -First 1)
    if (-not $art.Count) { Say ('Passed over ' + $what + ': it kept no ' + $Artifact + ' artifact that has not expired (the trace was refused, or the gate did not finish).'); continue }
    $zip = Join-Path ([IO.Path]::GetTempPath()) ('gate-map-' + $art[0].id + '.zip')
    $into = Join-Path ([IO.Path]::GetTempPath()) ('gate-map-' + $art[0].id)
    try {
        # The answer is a redirect to the zip, and PowerShell 7 drops the
        # token on it, as it should.
        Invoke-WebRequest -Method Get -Uri ($base + '/artifacts/' + $art[0].id + '/zip') -Headers $headers -OutFile $zip -UseBasicParsing
        if (Test-Path -LiteralPath $into) { Remove-Item -LiteralPath $into -Recurse -Force }
        Expand-Archive -LiteralPath $zip -DestinationPath $into -Force
        $m = [IO.File]::ReadAllText((Join-Path $into 'latest.json')) | ConvertFrom-Json
        $key = [string]$m.key; $commit = [string]$m.commit
        if ($commit -notmatch '^[0-9a-f]{40}$' -or $key -notmatch ('^' + $run.id + '-\d+$')) { throw ('its latest.json names ' + $key + ' of ' + $commit + ', not this run') }
        foreach ($f in ($key + '.map.json'), ($key + '.tree.gz')) {
            if (-not (Test-Path -LiteralPath (Join-Path $into $f))) { throw ('it holds no ' + $f) }
        }
        $map = [IO.File]::ReadAllText((Join-Path $into ($key + '.map.json'))) | ConvertFrom-Json
        if ([string]$map.commit -ne $commit) { throw ('its map is of ' + $map.commit + ', not ' + $commit) }
    } catch {
        Say ('Passed over ' + $what + ': ' + $_.Exception.Message + '.')
        Remove-Item -LiteralPath $zip, $into -Recurse -Force -ErrorAction SilentlyContinue
        continue
    }
    if (Test-Path -LiteralPath $Fetch) { Remove-Item -LiteralPath $Fetch -Recurse -Force }
    $null = New-Item -ItemType Directory -Force -Path $Fetch
    foreach ($f in 'latest.json', ($key + '.map.json'), ($key + '.tree.gz')) { Copy-Item -LiteralPath (Join-Path $into $f) -Destination (Join-Path $Fetch $f) }
    # Which harnesses Linux runs as fully as Windows (#5293), when that
    # night's Linux run finished; without it every harness runs on Windows.
    $pf = $key + '.platforms.json'
    if (Test-Path -LiteralPath (Join-Path $into $pf)) { Copy-Item -LiteralPath (Join-Path $into $pf) -Destination (Join-Path $Fetch $pf) }
    else { Say ('It holds no ' + $pf + ', so every harness runs on Windows.') }
    Remove-Item -LiteralPath $zip, $into -Recurse -Force -ErrorAction SilentlyContinue
    Say ('The map of ' + $what + ': the gate traced on main ' + $commit.Substring(0, 8) + ', read ' + $m.read + '.')
    exit 0
}
Say ('None of main''s ' + $runs.Count + ' newest finished gate traces kept a map that could be read.')
exit 1
