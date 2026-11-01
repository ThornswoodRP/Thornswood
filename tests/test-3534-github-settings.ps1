<#
  test-3534-github-settings.ps1

      pwsh -NoProfile -File .\tests\test-3534-github-settings.ps1

  WHY THIS EXISTS. Issue #3534. The 25 Oct 2026 weekly review could not read
  GitHub's environment and Actions settings: a cloud thread's proxy refuses
  every one of those paths. scripts\deploy\Check-GitHubSettings.ps1 starts
  github-admin.yml with ask = settings, whose run reads the environments
  with its own token and the rest through the box's admin service, and
  compares it all with records\github-settings.json.

  What it checks:
    1. records\github-settings.json is JSON with every part the compare
       reads, names only, and its environments are the ones the workflows
       name (environment: board, desk, engine-pin, release, watch);
    2. Get-DeployFrom and Compare-GitHubSettings: a match says nothing; a
       setting that differs, a secret, variable or environment on one side
       only, and an environment deploying from somewhere else are each one
       line; a part not read is not a difference;
    3. the GitHub half, against stand-ins for GitHub and the admin service:
       it lists the environments with the run's own token and reads a custom
       policy's branches, asks the service for settings with this run's OIDC
       token past any proxy, makes no call but those, and writes MATCHES,
       DIFFERS <n> or UNREAD <u> as an annotation titled
       Check-GitHubSettings with every difference, what was not read and
       every reading; a service older than #3534, a refusal and no token
       each stop it;
    4. the session half, against a stand-in gh: it starts github-admin.yml
       on main with ask = settings and exits 0, 1, 2 or 3 by the answer.

  Nothing connects anywhere. Read only.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$check = Join-Path $repo 'scripts/deploy/Check-GitHubSettings.ps1'
$recordPath = Join-Path $repo 'records/github-settings.json'
Yes 'Check-GitHubSettings.ps1 is there' (Test-Path -LiteralPath $check)
Yes 'records\github-settings.json is there' (Test-Path -LiteralPath $recordPath)
if (-not (Test-Path -LiteralPath $check) -or -not (Test-Path -LiteralPath $recordPath)) { Done }
$e = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($check, [ref]$null, [ref]$e)
Yes 'Check-GitHubSettings.ps1 parses' (@($e).Count -eq 0)

# ---- 1. the record -------------------------------------------------------------
Write-Host ''; Write-Host 'the record'
$record = [IO.File]::ReadAllText($recordPath) | ConvertFrom-Json
foreach ($k in 'actions', 'workflow_token', 'sharing', 'fork_pull_requests', 'secrets', 'variables', 'environments') {
    Yes ("it has $k") ($null -ne $record.PSObject.Properties[$k])
}
$named = @()
foreach ($f in Get-ChildItem -LiteralPath (Join-Path $repo '.github/workflows') -Filter '*.yml') {
    foreach ($m in [regex]::Matches([IO.File]::ReadAllText($f.FullName), "(?m)^\s+environment:\s*(?:\$\{\{.*?'([a-z-]+)'.*\}\}|([a-z-]+))\s*$")) {
        $named += $(if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value })
    }
}
$named = @($named | Sort-Object -Unique)
$recEnvs = @($record.environments.PSObject.Properties.Name | Sort-Object)
Yes ("its environments are the ones the workflows name ($($named -join ', '))") (($recEnvs -join ',') -eq ($named -join ','))
Yes 'each says where it deploys from, and its secret and variable names' (@($record.environments.PSObject.Properties | Where-Object { -not $_.Value.PSObject.Properties['deploy_from'] -or -not $_.Value.PSObject.Properties['secrets'] -or -not $_.Value.PSObject.Properties['variables'] }).Count -eq 0)
$text = [IO.File]::ReadAllText($recordPath)
Yes 'it holds names, never a value (no "value" key)' ($text -notmatch '"value"')

# ---- 2. the compare ----------------------------------------------------------------
Write-Host ''; Write-Host 'the compare'
. $check -Load
Yes 'no policy: any branch' ((Get-DeployFrom $null @()) -join '|' -eq 'any')
Yes 'protected branches' ((Get-DeployFrom ([pscustomobject]@{ protected_branches = $true; custom_branch_policies = $false }) @()) -join '|' -eq 'protected branches')
Yes 'custom: each branch and tag, sorted' ((Get-DeployFrom ([pscustomobject]@{ protected_branches = $false; custom_branch_policies = $true }) @([pscustomobject]@{ name = 'v*'; type = 'tag' }, [pscustomobject]@{ name = 'main'; type = 'branch' })) -join '|' -eq 'branch main|tag v*')

function Matching {
    $envs = [ordered]@{}
    foreach ($p in $record.environments.PSObject.Properties) {
        $envs[$p.Name] = [ordered]@{ deploy_from = @($p.Value.deploy_from); secrets = @($p.Value.secrets); variables = @($p.Value.variables) }
    }
    return [ordered]@{
        actions = $record.actions; workflow_token = $record.workflow_token; sharing = $record.sharing; fork_pull_requests = $record.fork_pull_requests
        secrets = @($record.secrets); variables = @($record.variables); environments = $envs; environments_listed = $true
    }
}
$d = @(Compare-GitHubSettings $record (Matching))
Yes ("readings that match the record: nothing ($($d -join '; '))") ($d.Count -eq 0)
$r = Matching
$r.workflow_token = [pscustomobject]@{ default_workflow_permissions = 'write'; can_approve_pull_request_reviews = $record.workflow_token.can_approve_pull_request_reviews }
$d = @(Compare-GitHubSettings $record $r)
Yes 'a workflow token that writes by default: one line naming it' ($d.Count -eq 1 -and $d[0] -eq 'workflow_token.default_workflow_permissions is write, and the record says read')
$r = Matching
$r.secrets = @($record.secrets) + 'OLD_TOKEN'
$d = @(Compare-GitHubSettings $record $r)
Yes 'a repository secret the record does not name: one line' ($d.Count -eq 1 -and $d[0] -eq 'the repository''s secrets: OLD_TOKEN is on GitHub and not in the record')
$r = Matching
$r.environments['board'].secrets = @()
$d = @(Compare-GitHubSettings $record $r)
Yes 'an environment secret the record names and GitHub lacks: one line' ($d.Count -eq 1 -and $d[0] -eq 'environment board secrets: BOARD_APP_KEY is in the record and not on GitHub')
$r = Matching
$r.environments['board'].deploy_from = @('any')
$d = @(Compare-GitHubSettings $record $r)
Yes 'an environment any branch may use: one line' ($d.Count -eq 1 -and $d[0] -eq 'environment board deploys from any, and the record says branch main')
$r = Matching
$r.environments['github-pages'] = [ordered]@{ deploy_from = @('any'); rules = @() }
$d = @(Compare-GitHubSettings $record $r)
Yes 'an environment the record does not name: one line' ($d.Count -eq 1 -and $d[0] -eq 'environment github-pages is on GitHub and not in the record')
$r = Matching
$r.environments.Remove('desk')
$d = @(Compare-GitHubSettings $record $r)
Yes 'a recorded environment GitHub does not have: one line' ($d.Count -eq 1 -and $d[0] -eq 'environment desk is in the record and not on GitHub')
$r = Matching
$r.Remove('secrets'); $r.Remove('variables'); $r.Remove('actions')
foreach ($n in @($r.environments.Keys)) { $r.environments[$n].Remove('secrets'); $r.environments[$n].Remove('variables') }
$d = @(Compare-GitHubSettings $record $r)
Yes 'parts not read are not differences' ($d.Count -eq 0)
$r.environments_listed = $false
$r.environments = [ordered]@{ board = [ordered]@{}; desk = [ordered]@{}; release = [ordered]@{} }
$d = @(Compare-GitHubSettings $record $r)
Yes '  nor are environments that could not be listed' ($d.Count -eq 0)
Yes 'the head: MATCHES, MATCHES UNREAD 2, DIFFERS 1 UNREAD 3' ((Get-Head 0 0) -eq 'MATCHES' -and (Get-Head 0 2) -eq 'MATCHES UNREAD 2' -and (Get-Head 1 3) -eq 'DIFFERS 1 UNREAD 3')

# ---- 3. the GitHub half ----------------------------------------------------------------
Write-Host ''; Write-Host 'the GitHub half'
$global:TSstate = $null
$global:TScalls = @()
function Invoke-WebRequest {
    param($Method, $Uri, $Headers, $Body, $ContentType, [switch]$SkipHttpErrorCheck, [switch]$NoProxy, $TimeoutSec)
    $global:TScalls += ,([pscustomobject]@{ Method = $(if ($Method) { $Method } else { 'GET' }); Uri = [string]$Uri; Body = $(if ($Body) { $Body | ConvertFrom-Json } else { $null }); Auth = $Headers.Authorization; NoProxy = [bool]$NoProxy })
    $s = $global:TSstate
    $u = [string]$Uri
    if ($u -like 'https://token.test/*') { return [pscustomobject]@{ StatusCode = $s.tokenCode; Content = '{"value":"oidc-for-this-run"}' } }
    if ($u -eq 'http://127.0.0.1:7791/converge') { return [pscustomobject]@{ StatusCode = $s.code; Content = $s.content } }
    if ($u.StartsWith('https://api.test/repos/ThornswoodRP/Thornswood/environments?')) { return [pscustomobject]@{ StatusCode = $s.envCode; Content = $s.envs } }
    if ($u -match '^https://api\.test/repos/ThornswoodRP/Thornswood/environments/[^/]+/deployment-branch-policies\?') {
        $n = [uri]::UnescapeDataString(($u -split '/')[7])
        return [pscustomobject]@{ StatusCode = 200; Content = (ConvertTo-Json -Compress -Depth 4 @{ total_count = 1; branch_policies = @($s.policies[$n]) }) }
    }
    return [pscustomobject]@{ StatusCode = 599; Content = '' }
}
$envList = ConvertTo-Json -Compress -Depth 6 @{ total_count = 5; environments = @(
        @{ name = 'board'; protection_rules = @(@{ type = 'branch_policy' }); deployment_branch_policy = @{ protected_branches = $false; custom_branch_policies = $true } },
        @{ name = 'desk'; protection_rules = @(@{ type = 'branch_policy' }); deployment_branch_policy = @{ protected_branches = $false; custom_branch_policies = $true } },
        @{ name = 'engine-pin'; protection_rules = @(@{ type = 'branch_policy' }); deployment_branch_policy = @{ protected_branches = $false; custom_branch_policies = $true } },
        @{ name = 'release'; protection_rules = @(@{ type = 'branch_policy' }); deployment_branch_policy = @{ protected_branches = $false; custom_branch_policies = $true } },
        @{ name = 'watch'; protection_rules = @(@{ type = 'branch_policy' }); deployment_branch_policy = @{ protected_branches = $false; custom_branch_policies = $true } }) }
$policies = @{ board = @{ name = 'main'; type = 'branch' }; desk = @{ name = 'main'; type = 'branch' }; 'engine-pin' = @{ name = 'main'; type = 'branch' }; release = @{ name = 'main'; type = 'branch' }; watch = @{ name = 'main'; type = 'branch' } }
$svcAll = ConvertTo-Json -Compress -Depth 8 @{ ok = $true; unread = @(); lines = @(); readings = @{
        actions = $record.actions; workflow_token = $record.workflow_token; sharing = $record.sharing; fork_pull_requests = $record.fork_pull_requests
        retention = @{ days = 90 }; runners = @(@{ name = 'thornswood-vps'; status = 'online'; labels = @('self-hosted', 'thornswood-vps') })
        secrets = @($record.secrets); variables = @($record.variables)
        environments = @{ board = @{ secrets = @('BOARD_APP_KEY'); variables = @('BOARD_APP_CLIENT_ID', 'BOARD_NUMBER') }; desk = @{ secrets = @('NEXUS_API_KEY'); variables = @() }; 'engine-pin' = @{ secrets = @('PIN_APP_KEY'); variables = @('PIN_APP_CLIENT_ID') }; release = @{ secrets = @(); variables = @() }; watch = @{ secrets = @('RUNNER_TOKEN', 'STAFF_WEBHOOK', 'WATCH_APP_KEY'); variables = @('WATCH_APP_CLIENT_ID') } } } }
function OnGitHub([hashtable]$envs, [hashtable]$state) {
    $base = @{ tokenCode = 200; code = 200; content = $svcAll; envCode = 200; envs = $envList; policies = $policies }
    foreach ($k in $state.Keys) { $base[$k] = $state[$k] }
    $global:TSstate = $base
    $global:TScalls = @()
    $all = @{ GITHUB_ACTIONS = 'true'; GH_TOKEN = 'run-token'; THORNSWOOD_GITHUB_API = 'https://api.test'; ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.test/idtoken?api-version=2.0'; ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'request-token'; THORNSWOOD_ADMIN_PORT = '' }
    foreach ($k in $envs.Keys) { $all[$k] = $envs[$k] }
    $was = @{}
    foreach ($k in $all.Keys) { $was[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $all[$k]) }
    try {
        $global:LASTEXITCODE = 0
        $out = @(& $check -OnGitHub 6>&1 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
    } finally {
        foreach ($k in $was.Keys) { [Environment]::SetEnvironmentVariable($k, $was[$k]) }
    }
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $rc; Calls = @($global:TScalls) }
}

$r = OnGitHub @{} @{}
Yes ("everything read and matching: exit 0, MATCHES ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match '::notice title=Check-GitHubSettings::MATCHES%0A')
Yes '  the environments listed with the run''s own token' (@($r.Calls | Where-Object { $_.Uri -like 'https://api.test/*' -and $_.Auth -eq 'Bearer run-token' }).Count -eq 6)
Yes '  the service asked for settings alone, with this run''s OIDC token, past any proxy' (
    @($r.Calls | Where-Object { $_.Uri -eq 'http://127.0.0.1:7791/converge' -and $_.Method -eq 'POST' -and $_.Auth -eq 'Bearer oidc-for-this-run' -and $_.NoProxy -and $_.Body.what -eq 'settings' -and @($_.Body.PSObject.Properties).Count -eq 1 }).Count -eq 1)
Yes '  and nothing else was called, nothing but GETs to GitHub' (@($r.Calls | Where-Object { $_.Uri -like 'https://api.test/*' -and $_.Method -ne 'GET' }).Count -eq 0 -and $r.Calls.Count -eq 8)
Yes '  every reading is in the answer' ($r.Out -match 'read workflow_token: default_workflow_permissions=read' -and $r.Out -match 'read runner thornswood-vps: online' -and $r.Out -match 'read environment release: deploy_from branch main')

$r = OnGitHub @{} @{ content = (ConvertTo-Json -Compress -Depth 8 @{ ok = $true; unread = @('secrets: the App has no Secrets permission, so GitHub gives it none of these names'); lines = @(); readings = @{ actions = $record.actions; environments = @{ board = @{}; desk = @{}; 'engine-pin' = @{}; release = @{}; watch = @{} } } }) }
Yes 'names the App may not read: exit 0, MATCHES UNREAD 1 with why' ($r.Code -eq 0 -and $r.Out -match 'Check-GitHubSettings::MATCHES UNREAD 1%0Anot read: secrets: the App has no Secrets permission')
$anyBranch = ConvertTo-Json -Compress -Depth 6 @{ total_count = 5; environments = @(
        @{ name = 'board'; protection_rules = @(); deployment_branch_policy = $null },
        @{ name = 'desk'; protection_rules = @(); deployment_branch_policy = $null },
        @{ name = 'engine-pin'; protection_rules = @(); deployment_branch_policy = $null },
        @{ name = 'release'; protection_rules = @(); deployment_branch_policy = $null },
        @{ name = 'watch'; protection_rules = @(); deployment_branch_policy = $null }) }
$r = OnGitHub @{} @{ envs = $anyBranch }
Yes 'environments any branch may use: DIFFERS with each' ($r.Code -eq 0 -and $r.Out -match 'Check-GitHubSettings::DIFFERS 5' -and $r.Out -match 'differs: environment board deploys from any, and the record says branch main')
$r = OnGitHub @{} @{ envCode = 403; envs = '{"message":"Resource not accessible by integration"}' }
Yes 'environments the run''s token may not list: said as not read, and no environment called missing' ($r.Out -match 'not read: environments: GET environments answered HTTP 403' -and $r.Out -notmatch 'is in the record and not on GitHub')
$r = OnGitHub @{} @{ content = '{"ok":true,"lines":["records/build-runners.json: GitHub matches it"],"changed":0,"differs":0}' }
Yes 'a service older than #3534: exit 1, says to put main''s on the box' ($r.Code -eq 1 -and $r.Out -match 'older than #3534')
$r = OnGitHub @{} @{ code = 403; content = '{"ok":false,"lines":["refused: the token is from the workflow x"]}' }
Yes 'the service refusing: exit 1 with its lines' ($r.Code -eq 1 -and $r.Out -match '::error title=Check-GitHubSettings::the box''s admin service said no \(HTTP 403\)%0Arefused')
$r = OnGitHub @{} @{ tokenCode = 403 }
Yes 'GitHub giving no OIDC token: exit 1, the service never asked' ($r.Code -eq 1 -and @($r.Calls | Where-Object { $_.Uri -like 'http://127.0.0.1*' }).Count -eq 0)
$r = OnGitHub @{ GH_TOKEN = '' } @{}
Yes 'no run token: exit 1, nothing asked' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)
Remove-Item Function:\Invoke-WebRequest

# ---- 4. the session half -----------------------------------------------------------
Write-Host ''; Write-Host 'the session half'
$global:TSghCalls = @()
$global:TSghBody = $null
$global:TSghNotes = '[]'
function gh {
    $a = @($args | ForEach-Object { [string]$_ })
    $global:TSghCalls += ,($a -join ' ')
    $p = @($a | Where-Object { $_ -match '^repos/' }) | Select-Object -First 1
    if ($a -contains '--input') { $global:TSghBody = (@($input) -join "`n") | ConvertFrom-Json }
    $global:LASTEXITCODE = 0
    if ($p -match '/actions/workflows/github-admin\.yml/dispatches$') { return '{"workflow_run_id":91,"html_url":"https://github.com/x/actions/runs/91"}' }
    if ($p -match '/actions/runs/91$') { return '{"status":"completed","conclusion":"success","path":".github/workflows/github-admin.yml","html_url":"https://github.com/x/actions/runs/91"}' }
    if ($p -match '/actions/runs/91/jobs$') { return '{"jobs":[{"id":557}]}' }
    if ($p -match '/check-runs/557/annotations$') { return $global:TSghNotes }
    $global:LASTEXITCODE = 1
    return 'gh: Not Found (HTTP 404)'
}
function Session([string]$message) {
    $global:TSghCalls = @(); $global:TSghBody = $null
    $global:TSghNotes = ConvertTo-Json -InputObject @(@{ annotation_level = 'notice'; title = 'Check-GitHubSettings'; message = $message }) -Compress
    $global:LASTEXITCODE = 0
    $out = @(& $check 6>&1 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $LASTEXITCODE; Body = $global:TSghBody }
}
$s = Session "MATCHES`nread sharing: access_level=none"
Yes ("it starts github-admin.yml on main with ask = settings, and exits 0 on MATCHES ($($s.Code))") ($s.Code -eq 0 -and $s.Body.ref -eq 'main' -and $s.Body.inputs.ask -eq 'settings' -and $s.Out -match 'access_level=none')
$s = Session "MATCHES UNREAD 2`nnot read: secrets: x"
Yes 'MATCHES UNREAD: exit 3' ($s.Code -eq 3)
$s = Session "DIFFERS 1`ndiffers: x"
Yes 'DIFFERS: exit 1' ($s.Code -eq 1 -and $s.Out -match 'differs from records')
$s = Session 'ALL GOOD'
Yes 'an answer it does not know: exit 1' ($s.Code -eq 1)
Remove-Item Function:\gh

Done
