<#
  Set-RepoAbout.ps1

  Makes the repository's About box on GitHub (the line under its name, the
  website and the topics) match records\repo-about.json on main. From One, a
  developer's PC or a cloud thread.

      pwsh scripts/deploy/Set-RepoAbout.ps1            make GitHub match main's record
      pwsh scripts/deploy/Set-RepoAbout.ps1 -Check     change nothing; exit 1 when GitHub differs
      pwsh scripts/deploy/Set-RepoAbout.ps1 -Run <id>  the answer of a run that had not ended

  Changing it is a pull request to the record; once it merges, the Desk runs
  this script and GitHub matches it a minute later. -Check says only what
  differs. The workflow it starts is in the private ops repository (#4013),
  so a push here cannot start it by itself.

  WHY THIS WAY (#3682, Patrick's A of 26 Oct 2026). The About box is a
  repository setting, and a cloud thread's proxy refuses every repository
  settings write: "Repository settings writes are not permitted through this
  proxy" (HTTP 403, measured 26 Oct 2026, 5:13 PM), and the topics the same.
  The box's admin service (scripts\vps\admin\admin.js) already holds a GitHub
  App with administration write on this repository for the runner labels
  (#3107), and that covers these. So this starts github-admin.yml on the
  ops repository's main, whose run hands GitHub's OIDC token for it to the
  service, and the service reads the record from this repository's main
  itself and makes the About box match. What to
  set never comes from here. The social preview picture has no API, so it is
  not in the record.

  WHAT IT SAYS AND EXITS.
    MATCHES, or CHANGED <n>          0, with the service's lines
    DIFFERS <n> (-Check)             1, with what differs
    refused, or the service stopped  1, with why
    the run had not ended            2, after -WaitMinutes; -Run <id> reads it
  -OnGitHub is the workflow's half; it writes the answer as an annotation
  titled Set-RepoAbout.
#>
[CmdletBinding(DefaultParameterSetName = 'Ask')]
param(
    # Change nothing; say what differs and exit 1 when anything does.
    [Parameter(ParameterSetName = 'Ask')]
    [switch]$Check,
    # A github-admin run that had not ended: read its answer.
    [Parameter(ParameterSetName = 'Run', Mandatory = $true)]
    [long]$Run,
    # The workflow's half: asks the box's admin service with this run's
    # OIDC token. -Check comes from ADMIN_CHECK there.
    [Parameter(ParameterSetName = 'OnGitHub', Mandatory = $true)]
    [switch]$OnGitHub,
    [int]$WaitMinutes = 15,
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\ops\WorkflowRun.ps1')

$workflow = 'github-admin.yml'
$title = 'Set-RepoAbout'
# The audience admin.js takes, and nothing else does.
$audience = 'thornswood-admin'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-ThornswoodAnnotation 'error' $title $m; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# ======================================================== the GitHub half ===
if ($OnGitHub) {
    $askCheck = ($env:ADMIN_CHECK -eq 'true')
    if (-not $env:ACTIONS_ID_TOKEN_REQUEST_URL -or -not $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
        Die 'this run has no OIDC token to ask for: github-admin.yml has to give the job id-token: write. Nothing was changed.'
    }
    $port = if ($env:THORNSWOOD_ADMIN_PORT) { [int]$env:THORNSWOOD_ADMIN_PORT } else { 7791 }

    $sep = if ($env:ACTIONS_ID_TOKEN_REQUEST_URL.Contains('?')) { '&' } else { '?' }
    $t = Invoke-WebRequest -Uri ($env:ACTIONS_ID_TOKEN_REQUEST_URL + $sep + 'audience=' + $audience) -SkipHttpErrorCheck -TimeoutSec 60 `
        -Headers @{ Authorization = "bearer $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN" }
    $token = ''
    if ([int]$t.StatusCode -eq 200) { $token = [string](([string]$t.Content | ConvertFrom-Json).value) }
    if (-not $token) { Die ('GitHub gave this run no OIDC token (HTTP ' + $t.StatusCode + '). Nothing was changed.') }

    # The service is on this machine; nothing between here and it.
    $a = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:$port/converge" -SkipHttpErrorCheck -NoProxy -TimeoutSec 120 `
        -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' `
        -Body (ConvertTo-Json -Compress @{ what = 'repo-about'; check = $askCheck })
    $code = [int]$a.StatusCode
    $r = $null
    try { $r = [string]$a.Content | ConvertFrom-Json } catch { $r = $null }
    if (-not $r -or -not $r.PSObject.Properties['lines']) {
        Die ("the box's admin service on 127.0.0.1:$port did not answer as itself (HTTP $code). Install-AdminService.ps1 -Status says whether it is there. Nothing was changed.")
    }
    $lines = @($r.lines | ForEach-Object { [string]$_ })
    foreach ($l in $lines) { Say "  $l" }
    if ($code -eq 200 -and $r.ok) {
        $head = if ($askCheck -and [int]$r.differs) { 'DIFFERS ' + $r.differs } elseif ([int]$r.changed) { 'CHANGED ' + $r.changed } else { 'MATCHES' }
        Write-ThornswoodAnnotation 'notice' $title (@($head) + $lines -join "`n")
        Say $head 'Green'
        exit 0
    }
    Die ((@("the box's admin service said no (HTTP $code)") + $lines) -join "`n")
}

# ======================================================= the session half ===
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die "there is no gh here to start $workflow with. Install GitHub CLI from https://cli.github.com and run gh auth login. Nothing was changed." }
$again = 'pwsh scripts/deploy/Set-RepoAbout.ps1 -Run '

function Read-Answer([long]$id, [switch]$Started) {
    $a = Read-ThornswoodRunAnswer -Repo $GitHubRepo -Workflow $workflow -Run $id -Title $title -WaitMinutes $WaitMinutes -Started:$Started -Say { param($m) Say $m 'DarkGray' }
    switch ($a.State) {
        'answer' { return $a.Text }
        'waiting' {
            Say ("the run has not ended after $WaitMinutes minutes (it was " + $a.Text + '), so every VPS runner is busy. It still does it when one takes it.') 'Yellow'
            Say ('  its answer then: ' + $again + $id) 'DarkGray'
            if ($a.Url) { Say ('  ' + $a.Url) 'DarkGray' }
            exit 2
        }
        'unread' {
            if (-not $Started) { Die $a.Text }
            Say ("GitHub started run $id, and the run does it. Its answer was not read here: " + $a.Text) 'Yellow'
            Say ('  its answer: ' + $again + $id) 'DarkGray'
            exit 2
        }
        'stopped' { Die ($a.Text + "`n(" + $a.Url + ')') }
        'other' { Die ($a.Text + '.') }
    }
    Die ($a.Text + ', so nothing it knows of was changed. Its log says why: ' + $a.Url)
}

if ($PSCmdlet.ParameterSetName -eq 'Run') {
    $answer = Read-Answer $Run
} else {
    try { $started = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow $workflow -Inputs ([ordered]@{ check = $(if ($Check) { 'true' } else { 'false' }) }) }
    catch { Die ($_.Exception.Message + '. Nothing was changed.') }
    if (-not $started.Run) {
        Say ("GitHub started $workflow, but named no run" + ', so its answer cannot be read here. Its runs: ' + $started.Url) 'Yellow'
        exit 2
    }
    Say ("sent to $workflow" + ': ' + $started.Url) 'DarkGray'
    $answer = Read-Answer $started.Run -Started
}

$said = @("$answer" -split "`n")
foreach ($l in @($said | Select-Object -Skip 1)) { Say "  $l" }
switch -Regex ($said[0]) {
    '^MATCHES$' { Say 'GitHub''s About box matches main''s record.' 'Green'; exit 0 }
    '^CHANGED (\d+)$' { Say ('GitHub''s About box matches main''s record now; ' + $Matches[1] + ' part(s) changed.') 'Green'; exit 0 }
    '^DIFFERS (\d+)$' { Say ('GitHub''s About box differs from main''s record in ' + $Matches[1] + ' part(s), above. pwsh scripts/deploy/Set-RepoAbout.ps1 puts it right.') 'Yellow'; exit 1 }
}
Die ("the run answered '" + $said[0] + "', which is none of the answers this knows.")
