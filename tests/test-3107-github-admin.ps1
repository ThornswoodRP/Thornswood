<#
  test-3107-github-admin.ps1

      pwsh -NoProfile -File .\tests\test-3107-github-admin.ps1

  A runner's labels can be changed only by somebody who administers the
  repository, and a cloud thread's proxy refuses every actions/runners path
  (#3107). So the box's admin service (scripts\vps\admin\admin.js, which
  tests\test-3107-admin.js runs) holds a GitHub App's key, and
  the ops repository's github-admin.yml asks it, through
  scripts\deploy\Set-BuildRunners.ps1 (Patrick's A of 22 Oct 2026).

  WHAT IT HOLDS THEM TO.
    1. github-admin.yml is not here: it moved to the private ops repository
       with the VPS runners (#4013), whose tests\test-box-workflows.ps1
       holds its shape, and Set-BuildRunners.ps1 starts it there. Its ask input
       takes repo-settings too (#3683), which Set-BuildRunners.ps1
       -RepoSettings sends.
    2. Set-BuildRunners.ps1 -OnGitHub, against a stand-in for GitHub's token
       service and the admin service: it asks for this run's token for the
       audience thornswood-admin, hands it to 127.0.0.1:7791 with nothing
       but runner-labels and the check, and writes the answer (MATCHES,
       CHANGED <n>, DIFFERS <n>) as an annotation titled Set-BuildRunners
       with the service's lines; with -RepoSettings it asks for
       repo-settings and titles its answer Set-RepoSettings;
       installation-repos (#4013) asks for that alone and answers REPOS <n>;
       an ask it does not know asks nothing; a refusal, a stop, or an answer
       that is not the service's is an error; with no OIDC token to ask for
       it asks nothing.
    3. Set-BuildRunners.ps1 in a session, against a stand-in for gh: it
       starts the ops repository's github-admin.yml on main with the check,
       reads the runner's annotation and exits 0, 1 or 2 by it, -AppRepos
       starts it with installation-repos, and -Run reads a run's answer
       later.
    4. Install-AdminService.ps1: it parses, and every script it sends parses
       once built; a commit or nothing; LOCAL SERVICE with its own SID,
       granted its folder and its state folder, after the fail-safe; the
       folder locked; the stage checked before the old service stops and
       rolled back when the new one does not answer; StopIt stops only what
       names admin.log; it looks for the whole line admin.js answers with;
       -Setup makes a 32 byte state on the box that lives an hour and
       refuses while an App is held; no install moves or changes what is in
       the state folder. That folder is locked apart before anything stops
       (#4076): nothing inherited, SYSTEM, Administrators, the task's own
       SID and OWNER RIGHTS only, owned by Administrators; the install
       refuses, leaving the service stopped, while another service could
       read the key, and -Status says which.
    5. records\runner-isolation.json keeps every runner account out of the
       service's folder.

  Nothing connects anywhere. Everything it writes is in its own temp folder.
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

$set = Join-Path $repo 'scripts/deploy/Set-BuildRunners.ps1'
$wf = Join-Path $repo '.github/workflows/github-admin.yml'
$inst = Join-Path $repo 'scripts/deploy/Install-AdminService.ps1'
foreach ($p in $set, $inst) { Yes ((Split-Path -Leaf $p) + ' is there') (Test-Path -LiteralPath $p) }
if (-not ((Test-Path -LiteralPath $set) -and (Test-Path -LiteralPath $inst))) { Done }
foreach ($p in $set, $inst, (Join-Path $repo 'scripts/ops/WorkflowRun.ps1')) {
    $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$e)
    Yes ((Split-Path -Leaf $p) + ' parses') (@($e).Count -eq 0)
}

# ---- 1. the workflow is in the ops repository (#4013) --------------------------
Write-Host ''; Write-Host 'the workflow'
Yes 'github-admin.yml is not in this repository, which has no VPS runner once public' (-not (Test-Path -LiteralPath $wf))
$setText = [IO.File]::ReadAllText($set)
Yes '  Set-BuildRunners.ps1 starts it in the private ops repository, where the runners are registered' ($setText.Contains("[string]`$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'") -and $setText.Contains("`$workflow = 'github-admin.yml'"))
$aboutText = [IO.File]::ReadAllText((Join-Path $repo 'scripts/deploy/Set-RepoAbout.ps1'))
Yes '  and Set-RepoAbout.ps1 starts it there too' ($aboutText.Contains("[string]`$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'") -and $aboutText.Contains("`$workflow = 'github-admin.yml'"))
$settingsText = [IO.File]::ReadAllText((Join-Path $repo 'scripts/deploy/Check-GitHubSettings.ps1'))
Yes '  and Check-GitHubSettings.ps1 starts it there, reading this repository''s settings (#3534)' ($settingsText.Contains("[string]`$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'") -and $settingsText.Contains("`$workflow = 'github-admin.yml'") -and $settingsText.Contains("`$Repo = 'ThornswoodRP/Thornswood'"))

# ---- 2. the GitHub half ------------------------------------------------------
Write-Host ''; Write-Host 'the GitHub half'
$global:TSadmin = $null
$global:TScalls = @()
function Invoke-WebRequest {
    param($Method, $Uri, $Headers, $Body, $ContentType, [switch]$SkipHttpErrorCheck, [switch]$NoProxy, $TimeoutSec)
    $global:TScalls += ,([pscustomobject]@{ Method = $Method; Uri = [string]$Uri; Body = $(if ($Body) { $Body | ConvertFrom-Json } else { $null }); Auth = $Headers.Authorization; NoProxy = [bool]$NoProxy })
    $s = $global:TSadmin
    if ([string]$Uri -like 'https://token.test/*') { return [pscustomobject]@{ StatusCode = $s.tokenCode; Content = $(if ($s.tokenCode -eq 200) { '{"value":"oidc-for-this-run"}' } else { '{"message":"no"}' }) } }
    if ([string]$Uri -eq 'http://127.0.0.1:7791/converge') { return [pscustomobject]@{ StatusCode = $s.code; Content = $s.content } }
    return [pscustomobject]@{ StatusCode = 599; Content = '' }
}
function OnGitHub([hashtable]$envs, [hashtable]$state, [switch]$Rules) {
    $base = @{ tokenCode = 200; code = 200; content = '{"ok":true,"lines":["records/build-runners.json: GitHub matches it"],"changed":0,"differs":0}' }
    foreach ($k in $state.Keys) { $base[$k] = $state[$k] }
    $global:TSadmin = $base
    $global:TScalls = @()
    $all = @{ GITHUB_ACTIONS = 'true'; ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.test/idtoken?api-version=2.0'; ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'request-token'; ADMIN_CHECK = 'false'; ADMIN_ASK = ''; THORNSWOOD_ADMIN_PORT = '' }
    foreach ($k in $envs.Keys) { $all[$k] = $envs[$k] }
    $was = @{}
    foreach ($k in $all.Keys) { $was[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $all[$k]) }
    try {
        $global:LASTEXITCODE = 0
        $out = @(& $set -OnGitHub -RepoSettings:$Rules 6>&1 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
    } finally {
        foreach ($k in $was.Keys) { [Environment]::SetEnvironmentVariable($k, $was[$k]) }
    }
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $rc; Calls = @($global:TScalls) }
}

$r = OnGitHub @{} @{}
Yes ("GitHub matching main: exit 0, MATCHES ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match '::notice title=Set-BuildRunners::MATCHES%0Arecords/build-runners\.json: GitHub matches it')
Yes '  it asked for this run''s token for the audience thornswood-admin, with the request token' (
    $r.Calls.Count -eq 2 -and $r.Calls[0].Uri -eq 'https://token.test/idtoken?api-version=2.0&audience=thornswood-admin' -and $r.Calls[0].Auth -eq 'bearer request-token')
Yes '  and handed it to the box''s service on 127.0.0.1:7791 alone, past any proxy' ($r.Calls[1].Method -eq 'POST' -and $r.Calls[1].Uri -eq 'http://127.0.0.1:7791/converge' -and $r.Calls[1].Auth -eq 'Bearer oidc-for-this-run' -and $r.Calls[1].NoProxy)
Yes '  asking for runner-labels and the check, nothing else' ($r.Calls[1].Body.what -eq 'runner-labels' -and $r.Calls[1].Body.check -eq $false -and @($r.Calls[1].Body.PSObject.Properties).Count -eq 2)
$r = OnGitHub @{} @{ content = '{"ok":true,"lines":["records/github-repo-settings.json: release tags made (active)"],"changed":1,"differs":1}' } -Rules
Yes '-RepoSettings asks for repo-settings and the check, nothing else, and titles its answer Set-RepoSettings' (
    $r.Code -eq 0 -and $r.Calls[1].Body.what -eq 'repo-settings' -and @($r.Calls[1].Body.PSObject.Properties).Count -eq 2 -and $r.Out -match '::notice title=Set-RepoSettings::CHANGED 1%0Arecords/github-repo-settings\.json: release tags made')
$r = OnGitHub @{ ADMIN_ASK = 'repo-settings' } @{ content = '{"ok":true,"lines":["records/github-repo-settings.json: GitHub matches it"],"changed":0,"differs":0}' }
Yes '  and so does a run started for repo-settings, with no -RepoSettings' ($r.Code -eq 0 -and $r.Calls[1].Body.what -eq 'repo-settings' -and $r.Out -match '::notice title=Set-RepoSettings::MATCHES')
$r = OnGitHub @{} @{ content = '{"ok":true,"lines":["records/build-runners.json: thornswood-vps-2, thornswood-build put on"],"changed":1,"differs":1}' }
Yes 'labels put right: exit 0, CHANGED 1 with the lines' ($r.Code -eq 0 -and $r.Out -match 'Set-BuildRunners::CHANGED 1%0Arecords/build-runners\.json: thornswood-vps-2, thornswood-build put on')
$r = OnGitHub @{ ADMIN_CHECK = 'true' } @{ content = '{"ok":true,"lines":["x would have y put on"],"changed":0,"differs":2}' }
Yes 'a check that differs: exit 0, DIFFERS 2, and the check reached the service' ($r.Code -eq 0 -and $r.Out -match 'Set-BuildRunners::DIFFERS 2' -and $r.Calls[1].Body.check -eq $true)
$r = OnGitHub @{ ADMIN_ASK = 'runner-labels' } @{}
Yes 'asking for runner-labels by name is the same' ($r.Code -eq 0 -and $r.Calls[1].Body.what -eq 'runner-labels' -and $r.Out -match 'Set-BuildRunners::MATCHES')
$r = OnGitHub @{ ADMIN_ASK = 'installation-repos'; ADMIN_CHECK = 'true' } @{ content = '{"ok":true,"lines":["installed on ThornswoodRP/Thornswood","installed on ThornswoodRP/Thornswood-Ops"],"repos":["ThornswoodRP/Thornswood","ThornswoodRP/Thornswood-Ops"]}' }
Yes 'installation-repos: exit 0, REPOS 2 with a line for each' ($r.Code -eq 0 -and $r.Out -match 'Set-BuildRunners::REPOS 2%0Ainstalled on ThornswoodRP/Thornswood%0Ainstalled on ThornswoodRP/Thornswood-Ops')
Yes '  asking for that and nothing else' ($r.Calls[1].Body.what -eq 'installation-repos' -and @($r.Calls[1].Body.PSObject.Properties).Count -eq 1)
$r = OnGitHub @{ ADMIN_ASK = 'secrets' } @{}
Yes 'an ask it does not know: exit 1, nothing asked' ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'neither runner-labels nor installation-repos')
$r = OnGitHub @{} @{ code = 409; content = '{"ok":false,"lines":["STOP no runner records/build-runners.json lists is registered on GitHub"],"changed":0,"differs":0}' }
Yes 'the service stopping: exit 1, an error with its lines' ($r.Code -eq 1 -and $r.Out -match '::error title=Set-BuildRunners::the box''s admin service said no \(HTTP 409\)%0ASTOP no runner')
$r = OnGitHub @{} @{ code = 403; content = '{"ok":false,"lines":["refused: the token is from the workflow x"]}' }
Yes 'the service refusing the token: exit 1' ($r.Code -eq 1 -and $r.Out -match 'HTTP 403\)%0Arefused')
$r = OnGitHub @{} @{ code = 404; content = 'not here' }
Yes 'an answer that is not the service''s: exit 1, says so' ($r.Code -eq 1 -and $r.Out -match 'did not answer as itself')
$r = OnGitHub @{} @{ tokenCode = 403 }
Yes 'GitHub giving no OIDC token: exit 1, the service never asked' ($r.Code -eq 1 -and $r.Calls.Count -eq 1)
$r = OnGitHub @{ ACTIONS_ID_TOKEN_REQUEST_URL = '' } @{}
Yes 'no id-token permission: exit 1, nothing asked' ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'id-token: write')
Remove-Item Function:\Invoke-WebRequest

# ---- 3. the session half -----------------------------------------------------
Write-Host ''; Write-Host 'the session half'
$global:TSghCalls = @()
$global:TSghBody = $null
$global:TSghRun = ''
$global:TSghNotes = '[]'
function gh {
    $a = @($args | ForEach-Object { [string]$_ })
    $global:TSghCalls += ,($a -join ' ')
    $p = @($a | Where-Object { $_ -match '^repos/' }) | Select-Object -First 1
    if ($a -contains '--input') { $global:TSghBody = (@($input) -join "`n") | ConvertFrom-Json }
    $global:LASTEXITCODE = 0
    if ($p -match '/actions/workflows/github-admin\.yml/dispatches$') { return '{"workflow_run_id":91,"html_url":"https://github.com/x/actions/runs/91"}' }
    if ($p -match '/actions/runs/91$') { return $global:TSghRun }
    if ($p -match '/actions/runs/91/jobs$') { return '{"jobs":[{"id":557}]}' }
    if ($p -match '/check-runs/557/annotations$') { return $global:TSghNotes }
    $global:LASTEXITCODE = 1
    return 'gh: Not Found (HTTP 404)'
}
$done = '{"status":"completed","conclusion":"success","path":".github/workflows/github-admin.yml","html_url":"https://github.com/x/actions/runs/91"}'
function Session([hashtable]$a, [string]$run, [object[]]$notes) {
    $global:TSghCalls = @(); $global:TSghBody = $null
    $global:TSghRun = $run
    $global:TSghNotes = ConvertTo-Json -InputObject @($notes) -Compress
    $global:LASTEXITCODE = 0
    $out = @(& $set @a 6>&1 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $LASTEXITCODE; Calls = @($global:TSghCalls); Body = $global:TSghBody }
}
function Note([string]$level, [string]$message, [string]$title = 'Set-BuildRunners') { return @{ annotation_level = $level; title = $title; message = $message } }

$s = Session @{} $done @((Note 'notice' "CHANGED 1`nrecords/build-runners.json: thornswood-vps-2, thornswood-build put on"))
Yes ("it starts the ops repository's github-admin.yml on main and says GitHub matches, exit 0 ($($s.Code))") ($s.Code -eq 0 -and $s.Calls[0] -match '^api -X POST repos/ThornswoodRP/Thornswood-Ops/actions/workflows/github-admin\.yml/dispatches' -and $s.Body.ref -eq 'main' -and $s.Out -match 'runner records now; 1 change\(s\) made')
Yes '  with check false, and the service''s lines' ($s.Body.inputs.check -eq 'false' -and $s.Out -match 'thornswood-build put on')
Yes '  asking for runner-labels' ($s.Body.inputs.ask -eq 'runner-labels')
$s = Session @{ RepoSettings = $true } $done @((Note 'notice' "CHANGED 1`nrecords/github-repo-settings.json: release tags made (active)" 'Set-RepoSettings'))
Yes '-RepoSettings: ask repo-settings, it reads the Set-RepoSettings answer, exit 0' ($s.Code -eq 0 -and $s.Body.inputs.ask -eq 'repo-settings' -and $s.Out -match 'matches main''s repository settings record now; 1 change' -and $s.Out -match 'release tags made')
$s = Session @{ RepoSettings = $true; Check = $true } $done @((Note 'notice' "MATCHES`nx" 'Set-BuildRunners'), (Note 'notice' "DIFFERS 1`nrecords/github-repo-settings.json: main differs and would be put back" 'Set-RepoSettings'))
Yes '  and with -Check reads its own answer, not the labels'' (exit 1)' ($s.Code -eq 1 -and $s.Out -match 'differs from main''s repository settings record in 1' -and $s.Out -match 'Set-BuildRunners\.ps1 -RepoSettings puts it right')
$s = Session @{ AppRepos = $true } $done @((Note 'notice' "REPOS 2`ninstalled on ThornswoodRP/Thornswood`ninstalled on ThornswoodRP/Thornswood-Ops"))
Yes '-AppRepos asks for installation-repos and says where the App is, exit 0' ($s.Code -eq 0 -and $s.Body.inputs.ask -eq 'installation-repos' -and $s.Out -match 'installed on ThornswoodRP/Thornswood-Ops' -and $s.Out -match 'installed on 2 repositories')
$s = Session @{ AppRepos = $true; RepoSettings = $true } $done @()
Yes '-AppRepos with -RepoSettings: exit 1, nothing started' ($s.Code -eq 1 -and $s.Calls.Count -eq 0)
$s = Session @{ Check = $true } $done @((Note 'notice' "DIFFERS 2`nx would have y put on"))
Yes '-Check that differs: check true, exit 1' ($s.Code -eq 1 -and $s.Body.inputs.check -eq 'true' -and $s.Out -match 'differs from main''s runner records in 2')
$s = Session @{ Check = $true } $done @((Note 'notice' "MATCHES`nrecords/build-runners.json: GitHub matches it"))
Yes '-Check that matches: exit 0' ($s.Code -eq 0 -and $s.Out -match 'GitHub matches main')
$s = Session @{} $done @((Note 'failure' "the box's admin service said no (HTTP 503)`nthere is no App here yet"))
Yes 'a stopped runner: exit 1 with its reason' ($s.Code -eq 1 -and $s.Out -match 'no App here yet')
$s = Session @{ WaitMinutes = '0' } $done.Replace('"completed"', '"queued"') @()
Yes 'a run not ended in time: exit 2 with the -Run line' ($s.Code -eq 2 -and $s.Out -match 'Set-BuildRunners\.ps1 -Run 91')
$s = Session @{ Run = '91' } $done @((Note 'notice' 'MATCHES'))
Yes '-Run reads the answer later' ($s.Code -eq 0 -and $s.Calls.Count -ge 1 -and $s.Calls[0] -notmatch 'dispatches')
$s = Session @{ Run = '91' } $done.Replace('github-admin.yml', 'build.yml') @((Note 'notice' 'MATCHES'))
Yes '  of a github-admin run only' ($s.Code -eq 1)
$s = Session @{ Run = '91' } $done @((Note 'notice' 'ALL GOOD'))
Yes 'an answer it does not know: exit 1' ($s.Code -eq 1)
Remove-Item Function:\gh

# ---- 4. Install-AdminService.ps1 ---------------------------------------------
Write-Host ''; Write-Host 'Install-AdminService.ps1'
$install = [IO.File]::ReadAllText($inst)
function ParseErrors([string]$code) {
    $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$null, [ref]$e)
    return @($e)
}
$e = $null
$iast = [System.Management.Automation.Language.Parser]::ParseFile($inst, [ref]$null, [ref]$e)
$hs = @($iast.FindAll({ param($n) $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $n.StringConstantType -eq 'DoubleQuotedHereString' }, $true))
function Build($h) {
    $t = $h.Extent.Text
    $t = $t.Substring($t.IndexOf("`n") + 1)
    $t = $t.Substring(0, $t.LastIndexOf("`n"))
    return $ExecutionContext.InvokeCommand.ExpandString($t)
}
. (Join-Path $repo 'scripts/deploy/ServiceAccount.ps1')
$Root = 'C:\Thornswood-Admin'; $Port = 7791; $TaskName = 'Thornswood Admin'; $Wait = 20; $AsSystem = $false
$forBot = 'C:\Thornswood-Admin\for-bot'; $botSid = 'S-1-5-80-1-2-3-4-5'
$log = 'C:\Thornswood-Admin\admin.log'; $state = 'C:\Thornswood-Admin\state'; $stage = '.stage-20261022-000000'; $prev = '.prev-20261022-000000'
$want = "'admin.js' = 'AA'; 'server-log.js' = 'CC'"
$pa = @($iast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-PlainAnswer' }, $true))
$sendAst = @($iast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$SendPlainAnswer' }, $true))
Yes 'it reads every answer through one Get-PlainAnswer, which it sends to the box' ($pa.Count -eq 1 -and $sendAst.Count -eq 1)
Invoke-Expression $pa[0].Extent.Text
Invoke-Expression $sendAst[0].Extent.Text
$Plain = 'box admin: not here'
$stopAst = @($hs | Where-Object { $_.Extent.Text -match '^@"\r?\nfunction StopIt' })
Yes 'it has one StopIt it sends' ($stopAst.Count -eq 1)
$stopIt = Build $stopAst[0]
$bad = @()
foreach ($h in $hs) {
    try { $c = Build $h } catch { $bad += ('line ' + $h.Extent.StartLineNumber + ' does not build: ' + $_.Exception.Message); continue }
    $errs = @(ParseErrors $c)
    if ($errs.Count) { $bad += ('line ' + $h.Extent.StartLineNumber + ': ' + $errs[0].Message) }
}
Yes ('every script it sends parses once built (' + $hs.Count + ')' + $(if ($bad.Count) { ': ' + ($bad -join '; ') })) ($hs.Count -ge 7 -and $bad.Count -eq 0)
$installCode = Build (@($hs | Where-Object { $_.Extent.Text -match 'ADMIN OK' })[0])
$setupCode = Build (@($hs | Where-Object { $_.Extent.Text -match "'ARMED ' \+" })[0])
$stageCode = Build (@($hs | Where-Object { $_.Extent.Text -match "'READY'" })[0])

Yes 'a commit or nothing: admin.js from HEAD, checked before it is sent' (
    $install -match "New-ThornswoodArtifact -Component admin -RepoDir \`$repo -Paths 'scripts/vps/admin/admin.js' -AlsoSends 'scripts/vps/Server-Log.js'" -and $install -match 'Assert-ThornswoodSourceIntegrity')
Yes '  and records what the box runs only once it answers' ($install.IndexOf('Set-ThornswoodArtifactCurrent') -gt $install.IndexOf("-notcontains 'ADMIN OK'"))
Yes 'the task is LOCAL SERVICE with its own SID, after the fail-safe' (
    $installCode -match 'New-ThornswoodServicePrincipal -AsSystem:\$system' -and $installCode -match 'Get-ThornswoodTaskSid' -and
    $installCode.IndexOf('Test-ThornswoodServiceCannotReach (') -ge 0 -and $installCode.IndexOf('Test-ThornswoodServiceCannotReach (') -lt $installCode.IndexOf('if (-not $stopOk)'))
Yes '  granted its folder, its state folder to keep the App in, and its log' ($installCode.Contains("Grant-ThornswoodServiceFolder -Root 'C:\Thornswood-Admin' -Sid `$sid -Writable 'state', 'for-bot' -Files 'admin.log', 'admin.log.*'"))
Yes '  at priority 4, normal (#1968)' ($installCode -match 'New-ScheduledTaskSettingsSet [^\r\n]*-Priority 4\b')
Yes '  running admin.js under server-log.js, kept 90 days with a time on each line, on 7791 with its state folder' (
    $installCode -match '--log "\{1\}" --days 90 --stamp admin\.js' -and $installCode.Contains('set THORNSWOOD_ADMIN_PORT=7791&& set THORNSWOOD_ADMIN_STATE=C:\Thornswood-Admin\state&&'))
Yes 'the folder takes nothing from C:\ and no broad group keeps a rule on it' (
    $install -match 'SetAccessRuleProtection\(`\$true, `\$false\)' -and $install -match "'S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-19'")
Yes '  and the state folder is made there before the grant' ($stageCode.Contains("if (-not (Test-Path -LiteralPath 'C:\Thornswood-Admin\state')) { New-Item -ItemType Directory -Path 'C:\Thornswood-Admin\state'"))
# #4076: CREATOR OWNER on the folder became LOCAL SERVICE Modify on key.pem.
$lockAt = $stageCode.IndexOf('# Locked apart')
$lock = if ($lockAt -ge 0) { $stageCode.Substring($lockAt, $stageCode.IndexOf("'COULD NOT LOCK STATE: '") - $lockAt) } else { '' }
Yes 'the state folder is locked apart before anything is stopped, and a lock that fails stops the install (#4076)' (
    $lock -and $stageCode.IndexOf("'COULD NOT LOCK STATE: '") -lt $stageCode.IndexOf("'READY'") -and $stageCode -match "'COULD NOT LOCK STATE: ' \+ \`$_\.Exception\.Message; exit 1")
Yes '  nothing inherited, so no CREATOR OWNER, and no rule of its own left over' (
    $lock -match "Get-Acl -LiteralPath 'C:\\Thornswood-Admin\\state'" -and $lock -match '\$acl\.SetAccessRuleProtection\(\$true, \$false\)' -and
    $lock -match 'foreach \(\$r in @\(\$acl\.GetAccessRules\(\$true, \$false, [^\r\n]*RemoveAccessRuleSpecific\(\$r\)')
Yes '  SYSTEM and Administrators Full, OWNER RIGHTS only Synchronize, the task''s own SID Modify' (
    $lock -match "@\('S-1-5-18', 'FullControl'\), @\('S-1-5-32-544', 'FullControl'\), @\('S-1-3-4', 'Synchronize'\)" -and
    $lock -match "NTAccount\('NT TASK', 'Thornswood Admin'\)" -and $lock -match "if \(\`$taskSid\) \{ \`$rules \+= ,@\(\`$taskSid, 'Modify'\) \}" -and
    $lock -notmatch "'S-1-5-19'|'S-1-3-0'|'S-1-1-0'|'S-1-5-11'|'S-1-5-32-545'")
Yes '  owned by Administrators, and so is all in it, which keeps only what state gives it' (
    $lock -match '\$acl\.SetOwner\(\$admins\)' -and $lock -match "Get-ChildItem -LiteralPath 'C:\\Thornswood-Admin\\state' -Recurse -Force" -and
    $lock -match '\$a\.SetAccessRuleProtection\(\$false, \$false\)' -and $lock -match '\$a\.SetOwner\(\$admins\)' -and $lock -notmatch '(Remove|Move|Set-Content|Clear)-(Item|Content)')
$check = $installCode.IndexOf('ANOTHER SERVICE COULD READ')
Yes 'after the grant and before the start, the install refuses while another service could read the key' (
    $check -gt $installCode.IndexOf('Grant-ThornswoodServiceFolder -Root') -and $check -lt $installCode.IndexOf("Start-ScheduledTask -TaskName 'Thornswood Admin'") -and
    $installCode -match "Test-ThornswoodServiceCannotReach -Paths \(@\('C:\\Thornswood-Admin\\state', 'C:\\Thornswood-Admin\\for-bot'\) \+ [^\r\n]*-Sids @\('S-1-3-0'\)")
# #5184, Patrick's A of 1 Nov 2026: the Discord bot's token folder.
$botAt = $stageCode.IndexOf("# The bot's token, locked apart")
$botLock = if ($botAt -ge 0) { $stageCode.Substring($botAt, $stageCode.IndexOf("'COULD NOT LOCK FOR-BOT: '") - $botAt) } else { '' }
Yes 'the bot''s token folder is made and locked apart before anything is stopped, and a lock that fails stops the install (#5184)' (
    $botLock -and $stageCode.IndexOf("'COULD NOT LOCK FOR-BOT: '") -lt $stageCode.IndexOf("'READY'") -and
    $botLock.Contains("New-Item -ItemType Directory -Path 'C:\Thornswood-Admin\for-bot'") -and $botLock -match '\$acl\.SetAccessRuleProtection\(\$true, \$false\)')
Yes '  SYSTEM and Administrators Full, OWNER RIGHTS only Synchronize, the bot''s own account Read, the task''s SID Modify, and no broad group' (
    $botLock -match "@\('S-1-5-18', 'FullControl'\), @\('S-1-5-32-544', 'FullControl'\), @\('S-1-3-4', 'Synchronize'\), @\('S-1-5-80-1-2-3-4-5', 'Read'\)" -and
    $botLock -match "if \(\`$taskSid\) \{ \`$rules \+= ,@\(\`$taskSid, 'Modify'\) \}" -and $botLock -notmatch "'S-1-5-19'|'S-1-3-0'|'S-1-1-0'|'S-1-5-11'|'S-1-5-32-545'")
Yes '  owned by Administrators, and so is all in it' ($botLock -match '\$acl\.SetOwner\(\$admins\)' -and $botLock -match '\$a\.SetOwner\(\$admins\)')
. (Join-Path $repo 'scripts/vps/Bot-Service.ps1')
Yes '  the bot''s account is NT SERVICE\ThornswoodBot, worked out from its name' ($install -match "Get-ThornswoodServiceSid \`$BotService" -and $install -match "\[string\]\`$BotService = 'ThornswoodBot'" -and (Get-ThornswoodServiceSid 'ThornswoodBot') -match '^S-1-5-80(-\d+){5}$')
Yes '  or LOCAL SERVICE owns a file there with no OWNER RIGHTS rule, and leaves the service stopped and disabled' (
    $installCode -match "GetOwner\(\[Security\.Principal\.SecurityIdentifier\]\)\.Value -eq 'S-1-5-19' -and -not \`$capped" -and
    $installCode -match "Disable-ScheduledTask -TaskName 'Thornswood Admin'[^\r\n]*\r?\n\s*'ADMIN REFUSED'; exit 1")
$statusCode = Build (@($hs | Where-Object { $_.Extent.Text -match "'task      ' \+" })[0])
Yes '-Status says whether another service could read the key' ($statusCode -match "'state     OPEN to other services: '" -and $statusCode -match "'S-1-5-19', 'S-1-3-0'" -and $statusCode -match "-notcontains 'S-1-3-4'")
Yes 'the stage is checked by hash and node --check before the old service stops' (
    $installCode.IndexOf('did not arrive as it was sent') -lt $installCode.IndexOf('if (-not $stopOk)') -and $installCode.IndexOf('--check') -lt $installCode.IndexOf('if (-not $stopOk)'))
Yes 'a service that does not answer gets the old files and task back' ($installCode -match 'Register-ScheduledTask -TaskName .Thornswood Admin. -Xml \$oldXml' -and $installCode -match 'ADMIN ROLLED BACK')
Yes 'StopIt stops only what names admin.log, and its child' ($stopIt -match [regex]::Escape("like ('*' + 'C:\Thornswood-Admin\admin.log' + '*')") -and $stopIt -match 'ParentProcessId -eq')
$adminJs = [IO.File]::ReadAllText((Join-Path $repo 'scripts/vps/admin/admin.js'))
Yes 'it looks for the whole line admin.js answers a plain request with (#2875)' ($adminJs -match "const PLAIN = 'box admin: not here';" -and $install -match "(?m)^\`$Plain = 'box admin: not here'\r?$")
Yes '  through Caddy at /github-app/, and on the port, never by status code alone' (
    $install.Contains("`$via = `$Site.TrimEnd('/') + '/github-app/'") -and $install.Contains('if ($a.Code -eq 404 -and $a.Body -eq $Plain) {') -and
    $install.Contains("if (Answers @('`$Plain'))") -and $install -notmatch "'not here'\)")
Yes 'no install moves or removes anything in the state folder' (
    $installCode -notmatch '(Remove|Move)-Item[^\r\n]*state' -and $stageCode -notmatch '(Remove|Move)-Item[^\r\n]*state' -and $installCode -match 'foreach \(\$f in \$want\.Keys\)')
Yes '-Setup makes a 32 byte state on the box that lives an hour' ($setupCode -match 'New-Object byte\[\] 32' -and $setupCode -match 'RandomNumberGenerator' -and $setupCode -match 'ToUnixTimeSeconds\(\) \+ 3600')
Yes '  refuses while an App is held, or before the service is there' ($setupCode.IndexOf("'HELD:") -lt $setupCode.IndexOf('RandomNumberGenerator') -and $setupCode.IndexOf("'NO SERVICE:") -lt $setupCode.IndexOf('RandomNumberGenerator'))
Yes '  and prints the address the Caddy route and admin.js serve' ($install.Contains("'/github-app/setup?state='") -and $adminJs.Contains("u.pathname === '/setup'"))
Yes 'the status names the App, never its key' ($install -match "'app       ' \+" -and $install -notmatch 'Get-Content[^\r\n]*key\.pem')

# ---- 5. no runner reaches it -------------------------------------------------
$iso = [IO.File]::ReadAllText((Join-Path $repo 'records/runner-isolation.json')) | ConvertFrom-Json
Yes 'records\runner-isolation.json keeps every runner account out of C:\Thornswood-Admin' (@($iso.noReach) -contains 'C:\Thornswood-Admin')

Done
