<#
  Check-GitHubSettings.ps1

  Reads GitHub's Actions settings, environments, secrets and variables for
  this repository and names every way they differ from
  records\github-settings.json on main. Changes nothing. From One, a
  developer's PC or a cloud thread; the weekly reviews run it (#3534).

      pwsh scripts/deploy/Check-GitHubSettings.ps1             read and compare
      pwsh scripts/deploy/Check-GitHubSettings.ps1 -Run <id>   the answer of a run that had not ended

  WHY (#3534). The 25 Oct 2026 weekly review listed "GitHub's environment and
  Actions settings" under "Could not read". A cloud thread's proxy refuses
  every environments, actions/permissions, actions/secrets, actions/variables
  and actions/runners path with HTTP 403 (measured again 26 Oct 2026), and
  One's gh is not there on a Sunday morning. So the reading is done on the
  box, by the two things there that may read each part, and this only
  starts it and prints what came back:
    environments and where each may deploy from: the run's own token, given
      actions read for it, in github-admin.yml. That workflow is in the
      private ops repository since #4013, so its token reads this public
      repository's environments the way anyone may read a public
      repository's;
    the Actions settings (on or off, which actions may run, the workflow
      token's default, sharing, retention, fork pull requests) and the
      runners: the box's GitHub App (scripts\vps\admin\admin.js, #3107),
      which holds administration;
    the names of the repository's and each environment's secrets and
      variables: the same App, once it holds read of Secrets, Variables and
      Environments. Until then the answer says each is not read and why.
  GitHub never hands back a secret's value, and nothing here asks for a
  variable's.

  HOW. Like Set-BuildRunners.ps1: it starts github-admin.yml on main of the
  private ops repository, where the VPS runners are registered (#4013), with
  ask = settings, waits, and reads the runner's answer, an annotation titled
  Check-GitHubSettings. That run reads the environments with its own token,
  hands GitHub's OIDC token for it to the admin service on 127.0.0.1:7791,
  which reads the rest with a read-only installation token, compares the lot
  with main's record and writes the answer.

  WHAT IT SAYS AND EXITS.
    MATCHES                          0, everything read matches the record
    MATCHES UNREAD <u>               3, what was read matches; <u> parts not read, each with why
    DIFFERS <n> [UNREAD <u>]         1, with each difference
    refused, or the service stopped  1, with why
    the run had not ended            2, after -WaitMinutes; -Run <id> reads it
  Under the first line come the differences, what was not read, and then
  every reading, so a review can hold them to a standard the record does
  not name.
  -OnGitHub is the workflow's half. tests\test-3534-github-settings.ps1
  runs the compare and both halves against stand-ins.
#>
[CmdletBinding(DefaultParameterSetName = 'Ask')]
param(
    # A github-admin run that had not ended: read its answer.
    [Parameter(ParameterSetName = 'Run', Mandatory = $true)]
    [long]$Run,
    # The workflow's half.
    [Parameter(ParameterSetName = 'OnGitHub', Mandatory = $true)]
    [switch]$OnGitHub,
    # Define the functions and stop, which is how the harness loads them.
    [Parameter(ParameterSetName = 'Load', Mandatory = $true)]
    [switch]$Load,
    [int]$WaitMinutes = 15,
    # Where github-admin.yml and the VPS runners are (#4013).
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\ops\WorkflowRun.ps1')

$workflow = 'github-admin.yml'
# The repository whose settings are read and compared, which is this one,
# not the one the workflow runs in.
$Repo = 'ThornswoodRP/Thornswood'
$title = 'Check-GitHubSettings'
# The audience admin.js takes, and nothing else does.
$audience = 'thornswood-admin'

# A field of an object or a dictionary, $null when it has none. A list comes
# back down the pipe item by item, so an empty one reads as $null: ask
# Test-Field whether it is there at all.
function Get-Field($o, [string]$name) {
    if ($null -eq $o) { return $null }
    if ($o -is [System.Collections.IDictionary]) { if ($o.Contains($name)) { return $o[$name] }; return $null }
    $p = $o.PSObject.Properties[$name]
    if ($p) { return $p.Value }
    return $null
}
function Test-Field($o, [string]$name) {
    if ($null -eq $o) { return $false }
    if ($o -is [System.Collections.IDictionary]) { return ($o.Contains($name) -and $null -ne $o[$name]) }
    $p = $o.PSObject.Properties[$name]
    return ($null -ne $p -and $null -ne $p.Value)
}
function Get-Names($o) {
    if ($null -eq $o) { return @() }
    if ($o -is [System.Collections.IDictionary]) { return @($o.Keys | ForEach-Object { [string]$_ }) }
    return @($o.PSObject.Properties | ForEach-Object { $_.Name })
}
function Format-Value($v) {
    if ($null -eq $v) { return 'nothing' }
    if ($v -is [bool]) { return $(if ($v) { 'true' } else { 'false' }) }
    if ($v -is [array]) { if (-not $v.Count) { return 'none' }; return (@($v | ForEach-Object { [string]$_ }) -join ', ') }
    return [string]$v
}

# Where an environment may deploy from, as the record writes it: "any",
# "protected branches", or "branch <name>" and "tag <name>" for each custom
# policy. policy is GitHub's deployment_branch_policy; custom its
# branch_policies, when it has them.
function Get-DeployFrom($policy, $custom) {
    if ($null -eq $policy) { return @('any') }
    if ([bool](Get-Field $policy 'protected_branches')) { return @('protected branches') }
    return @(@($custom) | Where-Object { $_ } | ForEach-Object {
            $t = [string](Get-Field $_ 'type'); if (-not $t) { $t = 'branch' }
            '{0} {1}' -f $t, (Get-Field $_ 'name')
        } | Sort-Object)
}

# Every way the readings differ from the record, one line each. readings is
# what the run read: actions, workflow_token, sharing, fork_pull_requests
# (objects as GitHub gave them), secrets and variables (names, or absent when
# not read), and environments: name -> { deploy_from, secrets, variables },
# each key absent when not read. A part the readings do not hold is not a
# difference: the answer says it was not read.
function Compare-GitHubSettings($record, $readings) {
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($part in 'actions', 'workflow_token', 'sharing', 'fork_pull_requests') {
        $want = Get-Field $record $part
        $have = Get-Field $readings $part
        if ($null -eq $want -or $null -eq $have) { continue }
        foreach ($k in (Get-Names $want)) {
            $w = Get-Field $want $k
            $h = Get-Field $have $k
            if ((Format-Value $w) -ne (Format-Value $h)) { $out.Add(('{0}.{1} is {2}, and the record says {3}' -f $part, $k, (Format-Value $h), (Format-Value $w))) }
        }
    }
    $sets = {
        param([string]$where, $want, $have)
        $w = @(@($want) | Where-Object { $_ } | ForEach-Object { [string]$_ })
        $h = @(@($have) | Where-Object { $_ } | ForEach-Object { [string]$_ })
        foreach ($x in @($h | Where-Object { $w -notcontains $_ } | Sort-Object)) { $out.Add(('{0}: {1} is on GitHub and not in the record' -f $where, $x)) }
        foreach ($x in @($w | Where-Object { $h -notcontains $_ } | Sort-Object)) { $out.Add(('{0}: {1} is in the record and not on GitHub' -f $where, $x)) }
    }
    foreach ($kind in 'secrets', 'variables') {
        if (Test-Field $readings $kind) { & $sets ('the repository''s ' + $kind) (Get-Field $record $kind) (Get-Field $readings $kind) }
    }
    $wantEnv = Get-Field $record 'environments'
    $haveEnv = Get-Field $readings 'environments'
    if (Test-Field $readings 'environments') {
        $wn = @(Get-Names $wantEnv)
        foreach ($n in @(Get-Names $haveEnv | Sort-Object)) {
            $h = Get-Field $haveEnv $n
            if ($wn -notcontains $n) {
                if (Test-Field $h 'deploy_from') { $out.Add(('environment {0} is on GitHub and not in the record' -f $n)) }
                continue
            }
            $w = Get-Field $wantEnv $n
            $from = @(Get-Field $h 'deploy_from')
            if (Test-Field $h 'deploy_from') {
                if ((Format-Value @(@(Get-Field $w 'deploy_from') | Sort-Object)) -ne (Format-Value @(@($from) | Sort-Object))) {
                    $out.Add(('environment {0} deploys from {1}, and the record says {2}' -f $n, (Format-Value @($from)), (Format-Value @(Get-Field $w 'deploy_from'))))
                }
            }
            foreach ($kind in 'secrets', 'variables') {
                if (Test-Field $h $kind) { & $sets ('environment ' + $n + ' ' + $kind) (Get-Field $w $kind) (Get-Field $h $kind) }
            }
        }
        foreach ($n in @($wn | Sort-Object)) {
            $h = Get-Field $haveEnv $n
            if (-not (Test-Field $h 'deploy_from')) {
                if (Get-Field $readings 'environments_listed') { $out.Add(('environment {0} is in the record and not on GitHub' -f $n)) }
            }
        }
    }
    return $out.ToArray()
}

# Every reading as one line, for the review to hold to standards the record
# does not name.
function Format-Readings($readings) {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($part in 'actions', 'selected_actions', 'workflow_token', 'sharing', 'retention', 'fork_pull_requests') {
        $v = Get-Field $readings $part
        if ($null -eq $v) { continue }
        $lines.Add(('read {0}: {1}' -f $part, (@(Get-Names $v | ForEach-Object { $_ + '=' + (Format-Value (Get-Field $v $_)) }) -join '; ')))
    }
    foreach ($r in @(Get-Field $readings 'runners')) {
        if ($null -eq $r) { continue }
        $lines.Add(('read runner {0}: {1}, {2}' -f (Get-Field $r 'name'), (Get-Field $r 'status'), (Format-Value @(Get-Field $r 'labels'))))
    }
    foreach ($kind in 'secrets', 'variables') {
        if (Test-Field $readings $kind) { $lines.Add(('read the repository''s {0}: {1}' -f $kind, (Format-Value @(Get-Field $readings $kind)))) }
    }
    $envs = Get-Field $readings 'environments'
    foreach ($n in @(Get-Names $envs | Sort-Object)) {
        $e = Get-Field $envs $n
        $bits = @()
        foreach ($k in 'deploy_from', 'rules', 'secrets', 'variables') { if (Test-Field $e $k) { $bits += ($k + ' ' + (Format-Value @(Get-Field $e $k))) } }
        if ($bits.Count) { $lines.Add(('read environment {0}: {1}' -f $n, ($bits -join '; '))) }
    }
    return $lines.ToArray()
}

# The answer's first line.
function Get-Head([int]$differs, [int]$unread) {
    $h = if ($differs) { 'DIFFERS ' + $differs } else { 'MATCHES' }
    if ($unread) { $h += ' UNREAD ' + $unread }
    return $h
}

if ($Load) { return }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-ThornswoodAnnotation 'error' $title $m; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# ======================================================== the GitHub half ===
if ($OnGitHub) {
    if (-not $env:GH_TOKEN) { Die 'this run has no token of its own to read the environments with: github-admin.yml has to give the step GH_TOKEN. Nothing was read.' }
    if (-not $env:ACTIONS_ID_TOKEN_REQUEST_URL -or -not $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
        Die 'this run has no OIDC token to ask for: github-admin.yml has to give the job id-token: write. Nothing was read.'
    }
    $api = if ($env:THORNSWOOD_GITHUB_API) { $env:THORNSWOOD_GITHUB_API.TrimEnd('/') } else { 'https://api.github.com' }
    $port = if ($env:THORNSWOOD_ADMIN_PORT) { [int]$env:THORNSWOOD_ADMIN_PORT } else { 7791 }
    $recordPath = Join-Path $PSScriptRoot '..\..\records\github-settings.json'
    if (-not (Test-Path -LiteralPath $recordPath)) { Die 'this checkout has no records\github-settings.json to compare with.' }
    try { $record = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $recordPath).Path) | ConvertFrom-Json } catch { Die ('records\github-settings.json is not JSON: ' + $_.Exception.Message) }

    $unread = New-Object System.Collections.Generic.List[string]
    $readings = [ordered]@{}

    # 1. The environments, with this run's own token (actions read).
    function Get-WithRunToken([string]$path) {
        $a = Invoke-WebRequest -Uri ($api + '/repos/' + $Repo + '/' + $path) -SkipHttpErrorCheck -TimeoutSec 60 `
            -Headers @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'thornswood-settings' }
        $b = $null
        try { $b = [string]$a.Content | ConvertFrom-Json } catch { $b = $null }
        return @{ Code = [int]$a.StatusCode; Body = $b }
    }
    $envs = [ordered]@{}
    $listed = $true
    $page = 1
    while ($true) {
        $a = Get-WithRunToken ("environments?per_page=100&page=$page")
        if ($a.Code -ne 200 -or $null -eq $a.Body) { $unread.Add(('environments: GET environments answered HTTP {0}' -f $a.Code)); $listed = $false; break }
        $batch = @(Get-Field $a.Body 'environments')
        foreach ($e in $batch) {
            if ($null -eq $e) { continue }
            $name = [string](Get-Field $e 'name')
            $policy = Get-Field $e 'deployment_branch_policy'
            $custom = @()
            if ($policy -and [bool](Get-Field $policy 'custom_branch_policies')) {
                $c = Get-WithRunToken ('environments/' + [uri]::EscapeDataString($name) + '/deployment-branch-policies?per_page=100')
                if ($c.Code -eq 200 -and $c.Body) { $custom = @(Get-Field $c.Body 'branch_policies') }
                else { $unread.Add(('environment {0} deploy_from: GET deployment-branch-policies answered HTTP {1}' -f $name, $c.Code)); $envs[$name] = [ordered]@{}; continue }
            }
            $envs[$name] = [ordered]@{
                deploy_from = @(Get-DeployFrom $policy $custom)
                rules       = @(@(Get-Field $e 'protection_rules') | Where-Object { $_ } | ForEach-Object { [string](Get-Field $_ 'type') } | Sort-Object)
            }
        }
        if ($batch.Count -lt 100) { break }
        $page++
        if ($page -gt 10) { $unread.Add('environments: more than 1,000, stopped reading pages'); break }
    }

    # 2. The rest, through the box's App.
    $sep = if ($env:ACTIONS_ID_TOKEN_REQUEST_URL.Contains('?')) { '&' } else { '?' }
    $t = Invoke-WebRequest -Uri ($env:ACTIONS_ID_TOKEN_REQUEST_URL + $sep + 'audience=' + $audience) -SkipHttpErrorCheck -TimeoutSec 60 `
        -Headers @{ Authorization = "bearer $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN" }
    $token = ''
    if ([int]$t.StatusCode -eq 200) { $token = [string](([string]$t.Content | ConvertFrom-Json).value) }
    if (-not $token) { Die ('GitHub gave this run no OIDC token (HTTP ' + $t.StatusCode + '). Nothing was read through the box.') }
    $a = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:$port/converge" -SkipHttpErrorCheck -NoProxy -TimeoutSec 120 `
        -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body (ConvertTo-Json -Compress @{ what = 'settings' })
    $code = [int]$a.StatusCode
    $r = $null
    try { $r = [string]$a.Content | ConvertFrom-Json } catch { $r = $null }
    if (-not $r -or -not $r.PSObject.Properties['ok']) {
        Die ("the box's admin service on 127.0.0.1:$port did not answer as itself (HTTP $code). Install-AdminService.ps1 -Status says whether it is there.")
    }
    if ($code -ne 200 -or -not $r.ok) { Die ((@("the box's admin service said no (HTTP $code)") + @($r.lines | ForEach-Object { [string]$_ })) -join "`n") }
    if (-not $r.PSObject.Properties['readings']) { Die "the box's admin service answered with no readings: it is older than #3534, and Install-AdminService.ps1 puts main's on the box." }
    foreach ($u in @($r.unread)) { if ($u) { $unread.Add([string]$u) } }
    foreach ($p in $r.readings.PSObject.Properties) {
        if ($p.Name -eq 'environments') { continue }
        $readings[$p.Name] = $p.Value
    }
    # The App reads the secrets and variables of the environments the
    # record names; this run's token says which environments there are.
    foreach ($p in @($(if ($r.readings.PSObject.Properties['environments']) { $r.readings.environments.PSObject.Properties } else { @() }))) {
        if (-not $envs.Contains($p.Name)) { $envs[$p.Name] = [ordered]@{} }
        foreach ($k in 'secrets', 'variables') { if (Test-Field $p.Value $k) { $envs[$p.Name][$k] = @(Get-Field $p.Value $k) } }
    }
    $readings['environments'] = $envs
    $readings['environments_listed'] = $listed

    $diff = @(Compare-GitHubSettings $record $readings)
    $lines = @($diff | ForEach-Object { 'differs: ' + $_ }) + @($unread | ForEach-Object { 'not read: ' + $_ }) + @(Format-Readings $readings)
    $head = Get-Head $diff.Count $unread.Count
    foreach ($l in $lines) { Say "  $l" }
    Write-ThornswoodAnnotation 'notice' $title ((@($head) + $lines) -join "`n")
    Say $head $(if ($diff.Count) { 'Yellow' } else { 'Green' })
    exit 0
}

# ======================================================= the session half ===
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die "there is no gh here to start $workflow with. Install GitHub CLI from https://cli.github.com and run gh auth login." }
$again = 'pwsh scripts/deploy/Check-GitHubSettings.ps1 -Run '

function Read-Answer([long]$id, [switch]$Started) {
    $a = Read-ThornswoodRunAnswer -Repo $GitHubRepo -Workflow $workflow -Run $id -Title $title -WaitMinutes $WaitMinutes -Started:$Started -Say { param($m) Say $m 'DarkGray' }
    switch ($a.State) {
        'answer' { return $a.Text }
        'waiting' {
            Say ("the run has not ended after $WaitMinutes minutes (it was " + $a.Text + '), so every VPS runner is busy. It still reads GitHub when one takes it.') 'Yellow'
            Say ('  its answer then: ' + $again + $id) 'DarkGray'
            if ($a.Url) { Say ('  ' + $a.Url) 'DarkGray' }
            exit 2
        }
        'unread' {
            if (-not $Started) { Die $a.Text }
            Say ("GitHub started run $id. Its answer was not read here: " + $a.Text) 'Yellow'
            Say ('  its answer: ' + $again + $id) 'DarkGray'
            exit 2
        }
        'stopped' { Die ($a.Text + "`n(" + $a.Url + ')') }
        'other' { Die ($a.Text + '.') }
    }
    Die ($a.Text + '. Its log says why: ' + $a.Url)
}

if ($PSCmdlet.ParameterSetName -eq 'Run') {
    $answer = Read-Answer $Run
} else {
    try { $started = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow $workflow -Inputs ([ordered]@{ ask = 'settings' }) }
    catch { Die ($_.Exception.Message + '. Nothing was read.') }
    if (-not $started.Run) {
        Say ("GitHub started $workflow, but named no run" + ', so its answer cannot be read here. Its runs: ' + $started.Url) 'Yellow'
        exit 2
    }
    Say ("sent to $workflow" + ': ' + $started.Url) 'DarkGray'
    $answer = Read-Answer $started.Run -Started
}

$said = @("$answer" -split "`n")
foreach ($l in @($said | Select-Object -Skip 1)) { Say "  $l" }
$m = [regex]::Match($said[0], '^(MATCHES|DIFFERS (\d+))(?: UNREAD (\d+))?$')
if (-not $m.Success) { Die ("the run answered '" + $said[0] + "', which is none of the answers this knows.") }
$u = if ($m.Groups[3].Success) { [int]$m.Groups[3].Value } else { 0 }
if ($m.Groups[2].Success) { Say ('GitHub differs from records\github-settings.json in ' + $m.Groups[2].Value + ' place(s), above' + $(if ($u) { ", and $u part(s) were not read" } else { '' }) + '.') 'Yellow'; exit 1 }
if ($u) { Say ("What was read matches records\github-settings.json; $u part(s) were not read, above.") 'Yellow'; exit 3 }
Say 'GitHub matches records\github-settings.json in everything.' 'Green'
exit 0
