<#
.SYNOPSIS
  Lists the GitHub Actions jobs one runner started after a given time, with how each ended and which step failed, and says whether one of them passed; read-only (issue #2161).

.DESCRIPTION
  The outbound limits of #2161 go on one VPS runner account at a time, and
  each is proven by a job that runner then runs green before the next one
  goes on (the ops repo's RUNNER-ISOLATION.md section 6). All the runners carry the
  same labels, so a job cannot be sent to one of them: this reads what each
  did instead, by the runner_name GitHub records on every job.

  It reads with GET calls only (gh api): the runs created from -LookBack
  hours before -Since, because a job queued before the rules went on may
  start after, then each run's jobs. A job counts when its runner is
  -Runner and it started at or after -Since, and, with -Job, when its name
  holds that text: a board card job reaches only GitHub's API, so a build
  runner's limits are proven by a build (-Job 'Launcher builds').

  Exit 0 when at least one such job ended success, 2 when none has yet.
  Failed and cancelled jobs are listed with their failed steps for a person
  to read: a harness that is red on its own branch fails on every runner,
  so a failure alone says nothing about the runner.

.EXAMPLE
  .\scripts\vps\Get-RunnerJobs.ps1 -Runner thornswood-vps-3 -Since 2026-10-21T09:00:00Z -Job 'Launcher builds'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Runner,
    [Parameter(Mandatory = $true)][string]$Since,
    [string]$Job = '',
    [int]$LookBack = 3,
    [string]$Repo = 'ThornswoodRP/Thornswood'
)

$ErrorActionPreference = 'Stop'
$from = [datetime]::Parse($Since, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
$sinceKey = $from.ToString('yyyy-MM-ddTHH:mm:ssZ')
$created = $from.AddHours(-$LookBack).ToString('yyyy-MM-ddTHH:mm:ssZ')

# Page by page rather than gh's --paginate: a proxy in front of the API may
# refuse the numeric repository paths GitHub's next links use.
$runs = New-Object System.Collections.Generic.List[object]
for ($page = 1; $page -le 20; $page++) {
    $got = gh api ("repos/$Repo/actions/runs?created=%3E%3D$created&per_page=100&page=$page") | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "gh api could not list the runs (exit $LASTEXITCODE)" }
    foreach ($r in @($got.workflow_runs)) { $runs.Add($r) }
    if (@($got.workflow_runs).Count -lt 100) { break }
}

$mine = New-Object System.Collections.Generic.List[object]
foreach ($r in $runs) {
    $jobs = gh api ("repos/$Repo/actions/runs/$($r.id)/jobs?per_page=100") | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "gh api could not list the jobs of run $($r.id) (exit $LASTEXITCODE)" }
    foreach ($j in @($jobs.jobs)) {
        if ("$($j.runner_name)" -ne $Runner -or -not $j.started_at) { continue }
        if ($Job -and "$($j.name)" -notlike "*$Job*") { continue }
        $started = ([datetime]$j.started_at).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        if ([string]::CompareOrdinal($started, $sinceKey) -lt 0) { continue }
        $failed = @($j.steps | Where-Object { $_.conclusion -eq 'failure' } | ForEach-Object { $_.name })
        $mine.Add([pscustomobject]@{ started = $started; conclusion = $(if ($j.conclusion) { "$($j.conclusion)" } else { "$($j.status)" }); name = "$($j.name)"; run = $r.id; job = $j.id; branch = "$($r.head_branch)"; failed = $failed })
    }
}

Write-Host ("Jobs {0} started at or after {1} ({2} runs read)" -f $Runner, $sinceKey, $runs.Count)
foreach ($m in @($mine | Sort-Object started)) {
    Write-Host ("  {0}  {1,-11} {2}  run {3} job {4}  {5}" -f $m.started, $m.conclusion, $m.name, $m.run, $m.job, $m.branch)
    foreach ($s in $m.failed) { Write-Host ("      failed step: " + $s) }
}
$ok = @($mine | Sort-Object started | Where-Object { $_.conclusion -eq 'success' })
if ($ok.Count) {
    Write-Host ("PROVEN: {0} ran {1} job(s) green after {2}, first run {3} job {4}" -f $Runner, $ok.Count, $sinceKey, $ok[0].run, $ok[0].job)
    exit 0
}
Write-Host ("NOT YET: no job on {0} has ended success since {1}" -f $Runner, $sinceKey)
exit 2
