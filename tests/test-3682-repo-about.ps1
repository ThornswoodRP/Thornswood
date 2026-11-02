<#
  test-3682-repo-about.ps1

      pwsh -NoProfile -File .\tests\test-3682-repo-about.ps1

  The repository's About box (the line under its name, the website and the
  topics) is set from records\repo-about.json by the box's admin service,
  because a cloud thread's proxy refuses repository settings writes (#3682,
  Patrick's A of 26 Oct 2026). scripts\deploy\Set-RepoAbout.ps1 is the
  workflow's half and the session's; tests\test-3107-admin.js runs the
  service's half, and tests\test-3107-github-admin.ps1 holds the workflow.

  WHAT IT HOLDS THEM TO.
    1. records\repo-about.json is there, is JSON, and says what it is.
    2. Set-RepoAbout.ps1 parses, and -OnGitHub, against a stand-in for
       GitHub's token service and the admin service: it asks for this run's
       token for the audience thornswood-admin, hands it to 127.0.0.1:7791
       past any proxy with nothing but repo-about and the check, and writes
       the answer (MATCHES, CHANGED <n>, DIFFERS <n>) as an annotation titled
       Set-RepoAbout; a stop or an answer that is not the service's is an
       error; with no OIDC token to ask for it asks nothing.
    3. In a session, against a stand-in for gh: it starts github-admin.yml
       on main with the check, and exits 0 or 1 by the run's annotation.

  Nothing connects anywhere.
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

# ---- 1. the record -----------------------------------------------------------
$recPath = Join-Path $repo 'records/repo-about.json'
Yes 'records/repo-about.json is there' (Test-Path -LiteralPath $recPath)
$rec = $null
try { $rec = [IO.File]::ReadAllText($recPath) | ConvertFrom-Json } catch { $rec = $null }
Yes '  it is JSON with a description, a website and topics' ($null -ne $rec -and [string]$rec.description -and [string]$rec.homepage -and @($rec.topics).Count -ge 1)
Yes '  and says what it is and what makes GitHub match it' ($null -ne $rec -and [string]$rec.about -match 'github-admin\.yml' -and [string]$rec.about -match 'social preview')

# ---- 2. the GitHub half ------------------------------------------------------
$set = Join-Path $repo 'scripts/deploy/Set-RepoAbout.ps1'
Yes 'Set-RepoAbout.ps1 is there' (Test-Path -LiteralPath $set)
if (-not (Test-Path -LiteralPath $set)) { Done }
$e = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($set, [ref]$null, [ref]$e)
Yes 'Set-RepoAbout.ps1 parses' (@($e).Count -eq 0)

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
function OnGitHub([hashtable]$envs, [hashtable]$state) {
    $base = @{ tokenCode = 200; code = 200; content = '{"ok":true,"lines":["records/repo-about.json: GitHub matches it"],"changed":0,"differs":0}' }
    foreach ($k in $state.Keys) { $base[$k] = $state[$k] }
    $global:TSadmin = $base
    $global:TScalls = @()
    $all = @{ GITHUB_ACTIONS = 'true'; ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.test/idtoken?api-version=2.0'; ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'request-token'; ADMIN_CHECK = 'false'; THORNSWOOD_ADMIN_PORT = '' }
    foreach ($k in $envs.Keys) { $all[$k] = $envs[$k] }
    $was = @{}
    foreach ($k in $all.Keys) { $was[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $all[$k]) }
    try {
        $global:LASTEXITCODE = 0
        $out = @(& $set -OnGitHub 6>&1 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
    } finally {
        foreach ($k in $was.Keys) { [Environment]::SetEnvironmentVariable($k, $was[$k]) }
    }
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $rc; Calls = @($global:TScalls) }
}

$r = OnGitHub @{} @{}
Yes ("GitHub matching main: exit 0, MATCHES ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match '::notice title=Set-RepoAbout::MATCHES%0Arecords/repo-about\.json: GitHub matches it')
Yes '  it asked for this run''s token for the audience thornswood-admin' ($r.Calls.Count -eq 2 -and $r.Calls[0].Uri -eq 'https://token.test/idtoken?api-version=2.0&audience=thornswood-admin')
Yes '  and handed it to the box''s service alone, past any proxy' ($r.Calls[1].Method -eq 'POST' -and $r.Calls[1].Uri -eq 'http://127.0.0.1:7791/converge' -and $r.Calls[1].Auth -eq 'Bearer oidc-for-this-run' -and $r.Calls[1].NoProxy)
Yes '  asking for repo-about and the check, nothing else' ($r.Calls[1].Body.what -eq 'repo-about' -and $r.Calls[1].Body.check -eq $false -and @($r.Calls[1].Body.PSObject.Properties).Count -eq 2)
$r = OnGitHub @{} @{ content = '{"ok":true,"lines":["records/repo-about.json: the website is now \"https://thornswood.net\", was \"\""],"changed":1,"differs":1}' }
Yes 'one part set: exit 0, CHANGED 1 with the lines' ($r.Code -eq 0 -and $r.Out -match 'Set-RepoAbout::CHANGED 1%0Arecords/repo-about\.json: the website is now')
$r = OnGitHub @{ ADMIN_CHECK = 'true' } @{ content = '{"ok":true,"lines":["x would be y"],"changed":0,"differs":3}' }
Yes 'a check that differs: exit 0, DIFFERS 3, and the check reached the service' ($r.Code -eq 0 -and $r.Out -match 'Set-RepoAbout::DIFFERS 3' -and $r.Calls[1].Body.check -eq $true)
$r = OnGitHub @{} @{ code = 502; content = '{"ok":false,"lines":["records/repo-about.json: the description is more than one line"]}' }
Yes 'the service stopping: exit 1, an error with its lines' ($r.Code -eq 1 -and $r.Out -match '::error title=Set-RepoAbout::the box''s admin service said no \(HTTP 502\)%0Arecords/repo-about\.json: the description')
$r = OnGitHub @{} @{ code = 400; content = 'not here' }
Yes 'an answer that is not the service''s: exit 1, says so' ($r.Code -eq 1 -and $r.Out -match 'did not answer as itself')
$r = OnGitHub @{ ACTIONS_ID_TOKEN_REQUEST_URL = '' } @{}
Yes 'no id-token permission: exit 1, nothing asked' ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'id-token: write')
Remove-Item Function:\Invoke-WebRequest

# ---- 3. the session half -----------------------------------------------------
$global:TSghCalls = @()
$global:TSghBody = $null
$global:TSghNotes = '[]'
function gh {
    $a = @($args | ForEach-Object { [string]$_ })
    $global:TSghCalls += ,($a -join ' ')
    $p = @($a | Where-Object { $_ -match '^repos/' }) | Select-Object -First 1
    if ($a -contains '--input') { $global:TSghBody = (@($input) -join "`n") | ConvertFrom-Json }
    $global:LASTEXITCODE = 0
    if ($p -match '^repos/ThornswoodRP/Thornswood-Ops/actions/workflows/github-admin\.yml/dispatches$') { return '{"workflow_run_id":91,"html_url":"https://github.com/x/actions/runs/91"}' }
    if ($p -match '^repos/ThornswoodRP/Thornswood-Ops/actions/runs/91$') { return '{"status":"completed","conclusion":"success","path":".github/workflows/github-admin.yml","html_url":"https://github.com/x/actions/runs/91"}' }
    if ($p -match '/actions/runs/91/jobs$') { return '{"jobs":[{"id":557}]}' }
    if ($p -match '/check-runs/557/annotations$') { return $global:TSghNotes }
    $global:LASTEXITCODE = 1
    return 'gh: Not Found (HTTP 404)'
}
function Session([hashtable]$a, [object[]]$notes) {
    $global:TSghCalls = @(); $global:TSghBody = $null
    $global:TSghNotes = ConvertTo-Json -InputObject @($notes) -Compress
    $global:LASTEXITCODE = 0
    $out = @(& $set @a 6>&1 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $LASTEXITCODE; Body = $global:TSghBody }
}
# The run also carries the runner labels' answer; only its own is read.
$labels = @{ annotation_level = 'notice'; title = 'Set-BuildRunners'; message = 'DIFFERS 9' }
$s = Session @{} @($labels, @{ annotation_level = 'notice'; title = 'Set-RepoAbout'; message = "CHANGED 3`nrecords/repo-about.json: the topics is now x" })
Yes ("it starts github-admin.yml on the ops repository's main and says the About box matches, exit 0 ($($s.Code))") ($s.Code -eq 0 -and $s.Body.ref -eq 'main' -and $s.Body.inputs.check -eq 'false' -and $s.Out -match '3 part\(s\) changed')
$s = Session @{ Check = $true } @($labels, @{ annotation_level = 'notice'; title = 'Set-RepoAbout'; message = "DIFFERS 2`nx would be y" })
Yes '-Check that differs: check true, exit 1' ($s.Code -eq 1 -and $s.Body.inputs.check -eq 'true' -and $s.Out -match 'differs from main''s record in 2')

Done
