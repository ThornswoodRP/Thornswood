<#
  Set-BuildRunners.ps1

  Makes the labels on GitHub's VPS runners match the runner records on main
  (records\<name>-runners.json): records\build-runners.json caps how many
  builds run on the box at once. A label of our own that no record names
  comes off every runner, so taking a record off main takes its label off
  too (#4033). From One, a developer's PC or a cloud thread.

      pwsh scripts/deploy/Set-BuildRunners.ps1            make GitHub match main's records
      pwsh scripts/deploy/Set-BuildRunners.ps1 -Check     change nothing; exit 1 when GitHub differs
      pwsh scripts/deploy/Set-BuildRunners.ps1 -Run <id>  the answer of a run that had not ended
      pwsh scripts/deploy/Set-BuildRunners.ps1 -RepoSettings [-Check | -Run <id>]
                                                         the same for main's repository settings
      pwsh scripts/deploy/Set-BuildRunners.ps1 -AppRepos  which repositories the box's App is on

  REPOSITORY SETTINGS (#3683, Patrick's answers of 26 Oct 2026). With
  -RepoSettings it asks for records\github-repo-settings.json instead, which
  names Thornswood, the engine fork, ThornswoodRP/skymp, and the ops
  repository, and for each its rulesets (none for the ops repository, which
  GitHub Free keeps none for) and, where it says, private vulnerability
  reporting, immutable releases, secret scanning, push protection,
  auto-merge and the three merge methods: each ruleset is made on
  GitHub, or put back, with exactly its target, enforcement, conditions,
  rules and bypass list, and the rest are switched on or off as the record
  says. A ruleset GitHub has that the record does not name stops it and is
  left as it is. The same App, the same run, the same rule: what to
  change comes from main, never from here.

  A record is { "label": ..., "runners": [1, 2] }: the runners it lists
  (thornswood-vps is 1, thornswood-vps-<n> is n) carry the label and no other
  runner does, an off-box runner (thornswood-pr-*) only when the record's
  offBox names it and it does not carry thornswood-vps (One's pull request
  build runners, 26 Oct 2026, #4010). Changing one is a pull request to the
  record; once it merges, the Desk runs this script and GitHub matches it a
  minute later. -Check says only what differs. The workflow it starts is in
  the private ops repository, where the runners are registered (#4013), so a
  push here cannot start it by itself.

  WHY THE BUILD LABEL (#2994). The VPS has six cores and, from 20 October,
  eight runners (#2929; three since the evening of 21 October, #3108,
  #3219). Every heavy job asked for thornswood-vps, which all eight carried,
  so on the night of 20 to 21 October seven builds ran at once, each one's
  harness step stretched from about 15 minutes to 34 to 39, and the job's
  40-minute limit cancelled three pull requests' builds that were passing.
  Measured over 558 box jobs: past four at once the box finishes no more
  builds an hour (11.1 at four, 11.6 at seven), each one only takes longer.
  So the heavy jobs (the build fallbacks in build.yml and build-pr.yml, the
  engine fallback, the nightly checks) ask for the build label as well, and
  only the runners records\build-runners.json lists carry it. The light
  jobs (board cards, dropped claims, the release jobs) still run on any VPS
  runner, so they never wait behind a build.

  HOW (#3107, Patrick's A of 22 Oct 2026). A runner's labels can be changed
  only by somebody who administers the repository, and a cloud thread's proxy
  refuses every actions/runners path, so this no longer calls GitHub's
  runner API itself. It starts github-admin.yml on the main of
  ThornswoodRP/Thornswood-Ops, which checks out this repository's main
  (#4013), waits, and prints
  the runner's answer, the way Set-Ref.ps1 does. That run hands GitHub's OIDC
  token for it to the box's admin service (scripts\vps\admin\admin.js,
  Install-AdminService.ps1), which holds the key of a GitHub App made for
  Thornswood and nothing else does. The service checks the token is that
  workflow on the ops repository's main, reads the records from this
  repository's main itself, and makes the labels of the runners registered
  to the ops repository match. What to change never comes from here, so nobody can label a runner
  any way main does not say. A job already running is not touched.

  The service refuses to leave GitHub with no registered runner carrying a
  record's label, because every job asking for it would then wait for a
  runner that never comes. A record that names a label every VPS runner
  carries, lists no runners, or names a label another record names, stops
  it. tests\test-3107-admin.js runs the service's rules; #2161 (one runner
  at a time): a runner outside the build list runs only the light jobs, so
  to prove one, add its number to the record in the same pull request that
  moves the rollout to it.

  WHERE THE APP IS (-AppRepos, #4013). The App has to be on every repository
  whose runners it labels, and from the flip that is Thornswood-Ops, which
  Patrick adds to its installation by hand. A cloud thread cannot see an
  App's installation, and gh's own sign-in cannot either (GitHub answers
  that only to the App). So -AppRepos asks the service the same way, and the
  service lists the installation's repositories with a token that can read
  their metadata and nothing else. It changes nothing.

  WHAT IT SAYS AND EXITS.
    MATCHES, or CHANGED <n>          0, with the service's lines
    REPOS <n> (-AppRepos)            0, one line per repository
    DIFFERS <n> (-Check)             1, with what differs
    refused, or the service stopped  1, with why
    the run had not ended            2, after -WaitMinutes; -Run <id> reads it
  -OnGitHub is the workflow's half; it writes the answer as an annotation
  titled Set-BuildRunners.
#>
[CmdletBinding(DefaultParameterSetName = 'Ask')]
param(
    # Change nothing; say what differs and exit 1 when anything does.
    [Parameter(ParameterSetName = 'Ask')]
    [switch]$Check,
    # A github-admin run that had not ended: read its answer.
    [Parameter(ParameterSetName = 'Run', Mandatory = $true)]
    [long]$Run,
    # Change nothing; list the repositories the box's App is installed on.
    [Parameter(ParameterSetName = 'AppRepos', Mandatory = $true)]
    [switch]$AppRepos,
    # The workflow's half: asks the box's admin service with this run's
    # OIDC token. -Check comes from ADMIN_CHECK there, and what it asks for
    # from ADMIN_ASK (runner-labels when unset; repo-settings is as
    # -RepoSettings).
    [Parameter(ParameterSetName = 'OnGitHub', Mandatory = $true)]
    [switch]$OnGitHub,
    # main's repository settings (records\github-repo-settings.json) rather than its runner records.
    [switch]$RepoSettings,
    [int]$WaitMinutes = 15,
    # Where github-admin.yml and the VPS runners are (#4013).
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\ops\WorkflowRun.ps1')

$workflow = 'github-admin.yml'
if ($AppRepos -and $RepoSettings) { Write-Host 'STOP. -AppRepos and -RepoSettings are two different asks; give one. Nothing was changed.' -ForegroundColor Red; exit 1 }
# The run's own half asks for the repository settings when the run was
# started for them (ADMIN_ASK repo-settings), as -RepoSettings does here.
if ($OnGitHub -and $env:ADMIN_ASK -eq 'repo-settings') { $RepoSettings = [switch]$true }
$what = if ($RepoSettings) { 'repo-settings' } else { 'runner-labels' }
$title = if ($RepoSettings) { 'Set-RepoSettings' } else { 'Set-BuildRunners' }
$records = if ($RepoSettings) { 'main''s repository settings record' } else { 'main''s runner records' }
# The audience admin.js takes, and nothing else does.
$audience = 'thornswood-admin'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-ThornswoodAnnotation 'error' $title $m; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# ======================================================== the GitHub half ===
if ($OnGitHub) {
    $askCheck = ($env:ADMIN_CHECK -eq 'true')
    # The ask comes from ADMIN_ASK (or -RepoSettings): runner-labels,
    # installation-repos or repo-settings.
    $askWhat = if ($RepoSettings) { 'repo-settings' } elseif ($env:ADMIN_ASK) { [string]$env:ADMIN_ASK } else { 'runner-labels' }
    if (-not $RepoSettings -and $askWhat -notin @('runner-labels', 'installation-repos')) { Die "the run asked for '$askWhat', which is neither runner-labels nor installation-repos. Nothing was changed." }
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
        -Body $(if ($askWhat -eq 'installation-repos') { ConvertTo-Json -Compress @{ what = $askWhat } } else { ConvertTo-Json -Compress @{ what = $askWhat; check = $askCheck } })
    $code = [int]$a.StatusCode
    $r = $null
    try { $r = [string]$a.Content | ConvertFrom-Json } catch { $r = $null }
    if (-not $r -or -not $r.PSObject.Properties['lines']) {
        Die ("the box's admin service on 127.0.0.1:$port did not answer as itself (HTTP $code). Install-AdminService.ps1 -Status says whether it is there. Nothing was changed.")
    }
    $lines = @($r.lines | ForEach-Object { [string]$_ })
    foreach ($l in $lines) { Say "  $l" }
    if ($code -eq 200 -and $r.ok) {
        $head = if ($askWhat -eq 'installation-repos') { 'REPOS ' + @($r.repos).Count } elseif ($askCheck -and [int]$r.differs) { 'DIFFERS ' + $r.differs } elseif ([int]$r.changed) { 'CHANGED ' + $r.changed } else { 'MATCHES' }
        Write-ThornswoodAnnotation 'notice' $title (@($head) + $lines -join "`n")
        Say $head 'Green'
        exit 0
    }
    Die ((@("the box's admin service said no (HTTP $code)") + $lines) -join "`n")
}

# ======================================================= the session half ===
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die "there is no gh here to start $workflow with. Install GitHub CLI from https://cli.github.com and run gh auth login. Nothing was changed." }
$again = 'pwsh scripts/deploy/Set-BuildRunners.ps1 ' + $(if ($RepoSettings) { '-RepoSettings ' } else { '' }) + '-Run '

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
    $inputs = [ordered]@{ check = $(if ($Check) { 'true' } else { 'false' }); ask = $(if ($AppRepos) { 'installation-repos' } else { $what }) }
    try { $started = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow $workflow -Inputs $inputs }
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
    '^MATCHES$' { Say "GitHub matches $records." 'Green'; exit 0 }
    '^CHANGED (\d+)$' { Say ("GitHub matches $records now; " + $Matches[1] + ' change(s) made.') 'Green'; exit 0 }
    '^REPOS (\d+)$' { Say ('The box''s App is installed on ' + $Matches[1] + ' repositor' + $(if ($Matches[1] -eq '1') { 'y' } else { 'ies' }) + ', above.') 'Green'; exit 0 }
    '^DIFFERS (\d+)$' { Say ("GitHub differs from $records in " + $Matches[1] + ' place(s), above. pwsh scripts/deploy/Set-BuildRunners.ps1' + $(if ($RepoSettings) { ' -RepoSettings' } else { '' }) + ' puts it right.') 'Yellow'; exit 1 }
}
Die ("the run answered '" + $said[0] + "', which is none of the answers this knows.")
