<#
  WorkflowRun.ps1

  Starts a workflow on main and reads the answer its runner left, for a
  script whose session cannot make the change itself: Set-Ref.ps1 (a ref
  write, which a cloud session's proxy refuses) and Set-BuildRunners.ps1 (a
  runner label, which needs the box's GitHub App). Each dot-sources this, and
  each workflow's half writes its answer as an annotation with a title of its
  own, which GitHub keeps on the job's check run, so the answer is read
  without reading the log (#3107).

      . (Join-Path $PSScriptRoot 'WorkflowRun.ps1')
      $s = Start-ThornswoodWorkflow -Repo $repo -Workflow 'git-ref.yml' -Inputs $inputs
      $a = Read-ThornswoodRunAnswer -Repo $repo -Workflow 'git-ref.yml' -Run $s.Run -Title 'Set-Ref' -WaitMinutes 15 -Started

  It talks to GitHub through gh only, so it works wherever gh is signed in,
  a cloud session included. The inputs go on gh's standard input, never on a
  command line.
#>

# One GET through gh. Returns @{ Body; Why; NotFound }: Body is the answer as
# an object, or $null with Why saying what gh said.
function Get-ThornswoodGitHub([string]$Path) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = @(& gh api $Path 2>&1 | ForEach-Object { "$_" })
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($c -ne 0) {
        return @{ Body = $null; NotFound = (($o -join ' ') -match '\(HTTP 404\)'); Why = ("GitHub answered GET $Path with: " + (($o | Select-Object -Last 2) -join ' ')) }
    }
    return @{ Body = (($o -join "`n") | ConvertFrom-Json); NotFound = $false; Why = '' }
}

# Starts $Workflow on main. Returns @{ Run; Url }, Run 0 when GitHub started
# it but named no run. Throws with what GitHub said when it did not start it,
# so nothing was asked.
function Start-ThornswoodWorkflow {
    param([string]$Repo, [string]$Workflow, $Inputs)
    $body = [ordered]@{ ref = 'main'; inputs = $Inputs; return_run_details = $true } | ConvertTo-Json -Compress -Depth 5
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = @($body | & gh api -X POST "repos/$Repo/actions/workflows/$Workflow/dispatches" --input - 2>&1 | ForEach-Object { "$_" })
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($c -ne 0) { throw ("GitHub did not start $Workflow in ${Repo}: " + (($o | Select-Object -Last 2) -join ' ')) }
    $started = ($o -join "`n") | ConvertFrom-Json
    if (-not $started -or -not $started.PSObject.Properties['workflow_run_id'] -or -not $started.workflow_run_id) {
        return @{ Run = [long]0; Url = "https://github.com/$Repo/actions/workflows/$Workflow" }
    }
    return @{ Run = [long]$started.workflow_run_id; Url = [string]$started.html_url }
}

# Waits up to -WaitMinutes for run -Run of -Workflow to end, then reads the
# annotations titled -Title on its jobs. -Started: the run was only just
# started, and GitHub can answer Not Found for a run it has only just named
# (#3081), which is one more state of the wait. Returns @{ State; Text; Url }:
#   answer    the run's last notice; Text is its message
#   stopped   the run's last failure; Text is why
#   none      the run ended with neither; Text is how it ended
#   waiting   it had not ended in time; Text is the state it was in
#   unread    a read failed; Text is what GitHub said
#   other     the run is not one of -Workflow; Text is what it is
# -Say is how it says it is waiting, a script block taking one line.
function Read-ThornswoodRunAnswer {
    param([string]$Repo, [string]$Workflow, [long]$Run, [string]$Title, [int]$WaitMinutes = 15, [switch]$Started, [scriptblock]$Say = { param($m) })
    $runPath = "repos/$Repo/actions/runs/$Run"
    $deadline = [DateTime]::UtcNow.AddMinutes($WaitMinutes)
    $notYet = [bool]$Started
    $told = ''
    while ($true) {
        $g = Get-ThornswoodGitHub $runPath
        if (-not $g.Body -and -not ($notYet -and $g.NotFound)) { return @{ State = 'unread'; Text = $g.Why; Url = '' } }
        $r = $g.Body
        if ($r) { $notYet = $false }
        if ($r -and $r.status -eq 'completed') { break }
        $state = if ($r) { [string]$r.status } else { 'not served by GitHub yet' }
        if ([DateTime]::UtcNow -gt $deadline) { return @{ State = 'waiting'; Text = $state; Url = $(if ($r) { [string]$r.html_url } else { '' }) } }
        if ($told -ne $state -and $state -ne 'in_progress') {
            & $Say $(if ($r) { '  waiting for a runner (' + $state + ')' } else { '  started; GitHub does not serve the new run yet' })
            $told = $state
        }
        Start-Sleep -Seconds 5
    }
    if ([string]$r.path -notmatch ('/' + [regex]::Escape($Workflow) + '$')) { return @{ State = 'other'; Text = ("run $Run is not a $Workflow run (it is " + $r.path + ')'); Url = [string]$r.html_url } }
    $jobs = Get-ThornswoodGitHub "$runPath/jobs"
    if (-not $jobs.Body) { return @{ State = 'unread'; Text = $jobs.Why; Url = [string]$r.html_url } }
    $notes = @()
    foreach ($job in @($jobs.Body.jobs)) {
        $a = Get-ThornswoodGitHub ("repos/$Repo/check-runs/" + $job.id + '/annotations')
        if ($null -eq $a.Body -and $a.Why) { return @{ State = 'unread'; Text = $a.Why; Url = [string]$r.html_url } }
        $notes += @($a.Body | Where-Object { $_ -and $_.title -eq $Title })
    }
    $done = @($notes | Where-Object { $_.annotation_level -eq 'notice' }) | Select-Object -Last 1
    if ($done) { return @{ State = 'answer'; Text = ([string]$done.message).Trim(); Url = [string]$r.html_url } }
    $why = @($notes | Where-Object { $_.annotation_level -eq 'failure' }) | Select-Object -Last 1
    if ($why) { return @{ State = 'stopped'; Text = ([string]$why.message).Trim(); Url = [string]$r.html_url } }
    return @{ State = 'none'; Text = ('the run ended ' + $r.conclusion + ' without an answer'); Url = [string]$r.html_url }
}

# An annotation on the job, when this runs in GitHub Actions, carrying lines.
function Write-ThornswoodAnnotation([string]$Level, [string]$Title, [string]$Message) {
    if ($env:GITHUB_ACTIONS -ne 'true') { return }
    Write-Host ('::' + $Level + ' title=' + $Title + '::' + ($Message -replace '%', '%25' -replace "`r", '%0D' -replace "`n", '%0A'))
}
