# tests\test-runner-isolation.ps1
# Issue #2161. Offline: scripts\vps\Check-RunnerIsolation.ps1 against made-up
# runner facts and the repository's own workflows, and the ACL reading in
# scripts\vps\Get-RunnerFacts.ps1 against stand-in rules. Nothing reaches the
# VPS or GitHub. From #3550 to #4033 it also held every job of the real
# workflows that could land on the signing runner to main's code; no runner
# of the box signs since #4013, so the check and its cases went.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, every machine runs in PowerShell 7 since #5356, the box
# included, and this harness runs in it too.
$boxPs = Get-BoxPowerShell
$repo = Split-Path -Parent $PSScriptRoot
$check = Join-Path $repo 'scripts\vps\Check-RunnerIsolation.ps1'
$collector = Join-Path $repo 'scripts\vps\Get-RunnerFacts.ps1'
$pass = 0; $fail = 0
function T([bool]$ok, [string]$what) { if ($ok) { Write-Host "PASS  $what"; $script:pass++ } else { Write-Host "FAIL  $what"; $script:fail++ } }

foreach ($s in $check, $collector) {
    $errs = $null; [void][Management.Automation.Language.Parser]::ParseFile($s, [ref]$null, [ref]$errs)
    T ($errs.Count -eq 0) ((Split-Path -Leaf $s) + ' parses')
}
$craw = Get-Content -LiteralPath $collector -Raw
T ($craw -notmatch '(?m)^\s*[^#\n]*\b(Set-|Remove-|New-Item|Stop-|Start-|Restart-|Register-|Unregister-|Disable-|Enable-|Add-LocalGroupMember|icacls)\w*') 'the collector calls nothing that changes anything'
T ($craw -notmatch 'Get-Content') 'the collector reads no file contents'
$xraw = Get-Content -LiteralPath $check -Raw
T ($xraw -notmatch 'gh api[^\n]*( -X | --method | -f | --field | -F )|gh (issue|pr|label) ') 'the check only ever GETs from GitHub and files nothing'

# ---- ACL reading ----------------------------------------------------------
. $collector -Define
$R = [int][Security.AccessControl.FileSystemRights]'ReadAndExecute'
$W = [int][Security.AccessControl.FileSystemRights]'Write'
$acct = 'S-1-5-21-1-2-3-1001'; $users = 'S-1-5-32-545'
$sids = @($acct, $users, 'S-1-1-0', 'S-1-5-11', 'S-1-5-6')
$x = Get-AclReach @(@{ Sid = $users; Type = 'Allow'; Rights = $R }) $sids
T ($x.read -and -not $x.write) 'read through the Users group is read'
$x = Get-AclReach @(@{ Sid = $users; Type = 'Allow'; Rights = $R }, @{ Sid = $acct; Type = 'Deny'; Rights = $R -bor $W }) $sids
T (-not $x.read -and -not $x.write -and $x.denied) 'a deny on the account beats an allow through a group'
$x = Get-AclReach @(@{ Sid = $acct; Type = 'Allow'; Rights = $W }) $sids
T ($x.write -and -not $x.read) 'write without read is write only (Dumps)'
$x = Get-AclReach @(@{ Sid = 'S-1-5-32-544'; Type = 'Allow'; Rights = $R -bor $W }) $sids
T (-not $x.read -and -not $x.write) 'Administrators only is no reach'

# ---- comparison -------------------------------------------------------------
$rec = Get-Content (Join-Path $repo 'records\runner-isolation.json') -Raw | ConvertFrom-Json
function Facts {
    $reach = [ordered]@{}
    foreach ($p in $rec.noReach) { $reach[$p] = [ordered]@{ read = $false; write = $false; denied = $true } }
    $reach['C:\Thornswood-Dumps'] = [ordered]@{ read = $false; write = $true; denied = $false }
    [ordered]@{
        runner = [ordered]@{ takenUtc = '2026-10-11T12:00:00Z'; host = 'STANDIN'; machineEnvNames = @('THORNSWOOD_SITE')
            runners = @([ordered]@{ service = 'actions.runner.X.thornswood-vps'; account = 'thornswood-runner'; sid = 'S-1-5-21-1-2-3-1001'; state = 'Running'
                groups = @('Users', 'GITHUB_ActionsRunner_G1'); root = 'C:\Thornswood-Runner'; hasCredentials = $true; workFolders = 3
                tempLeftFiles = 0; tempOldestHours = 0; firewallRules = 12; reach = $reach }) }
        prod = [ordered]@{ listeners = @(@{ proto = 'tcp'; address = '127.0.0.1'; port = 3001; process = 'node' }) }
        github = [ordered]@{ private = $true; forkPr = @{ run_workflows_from_fork_pull_requests = $false }; workflowToken = @{ default_workflow_permissions = 'read' }
            runners = @(@{ name = 'thornswood-vps'; labels = @('self-hosted', 'thornswood-vps') }); collaborators = 3 }
    }
}
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('runner-iso-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$wfOk = Join-Path $scratch 'wf'; New-Item -ItemType Directory -Path $wfOk | Out-Null
Set-Content (Join-Path $wfOk 'build.yml') "on:`n  pull_request:`n  push:`npermissions:`n  contents: read`njobs:`n  a:`n    runs-on: [self-hosted, Windows, thornswood-pr]`n"
Set-Content (Join-Path $wfOk 'nightly.yml') "on:`n  schedule:`npermissions:`n  contents: read`njobs:`n  a:`n    runs-on: [self-hosted, Windows, thornswood-vps]`n"
function Run($facts, [string]$wf) {
    $fp = Join-Path $scratch 'facts.json'; $rp = Join-Path $scratch 'report.md'
    Remove-Item $rp -EA SilentlyContinue
    $facts | ConvertTo-Json -Depth 8 | Set-Content $fp -Encoding utf8
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $check, '-Facts', $fp, '-Report', $rp, '-Strict')
    if ($wf) { $a += @('-Workflows', $wf) }
    $o = & $boxPs @a 2>&1 | Out-String
    @{ Code = $LASTEXITCODE; Out = $o; Report = $(if (Test-Path $rp) { Get-Content $rp -Raw } else { '' }) }
}
try {
    $x = Run (Facts) $wfOk
    T ($x.Code -eq 0) 'a locked runner, private repo and no pull request on the production label: nothing at risk'
    T ($x.Report -match 'loopback \| tcp 3001') 'loopback services every local account can reach are listed from the #2165 facts'
    T ($x.Report -match "not Windows' effective access") 'the report says rights come from reading ACLs'

    # The real workflows: no pull request job is on the production label
    # without the same-repository condition, read job by job (#3550). And no
    # row is about a signing runner, since there is none (#4033).
    $x = Run (Facts) ''
    T ($x.Out -notmatch 'RISK  workflow \S+ runs on') 'no real workflow runs a pull request on the production runners without the same-repository condition'
    T ($x.Report -notmatch 'signing runner') 'no row is about a signing runner, since no runner of the box signs (#4033)'
    # Since #4983 no real workflow asks for a runner of the box at all: the
    # pull request build has no VPS fallback, and anything anyone can start
    # on a public repository (#3685), opening or closing their own issue, is
    # on GitHub's runner.
    T ($x.Out -notmatch 'RISK  workflow build-pr\.yml runs on' -and $x.Report -match '\| workflow \| build-pr\.yml runs on \|[^\n]*triggers pull_request,merge_group,workflow_dispatch \|' -and $x.Report -notmatch '\| workflow \| build-pr\.yml runs on \|[^\n]*; on thornswood') 'the real build-pr.yml is not on the production label at all, and the check says ok (#4983)'
    foreach ($n in 'area-label.yml', 'drop-claims.yml') {
        T ($x.Out -notmatch ('RISK  workflow ' + [regex]::Escape($n) + ' started by anyone') -and $x.Report -match ('\| workflow \| ' + [regex]::Escape($n) + ' started by anyone \|[^\n]*; not on thornswood-vps[^\n]*\| ok \|')) "the real $n is not on the production label, and the check says ok"
    }
    $wfIs = Join-Path $scratch 'wfis'; New-Item -ItemType Directory -Path $wfIs | Out-Null
    Set-Content (Join-Path $wfIs 'label.yml') "on:`n  issues:`n    types: [opened]`npermissions:`n  issues: write`njobs:`n  a:`n    runs-on: [self-hosted, Windows, thornswood-vps]`n"
    $x = Run (Facts) $wfIs
    T ($x.Out -match 'RISK  workflow label\.yml started by anyone') 'an issue job always on the production label is a risk, even while private'
    Set-Content (Join-Path $wfIs 'label.yml') "on:`n  issue_comment:`npermissions:`n  issues: write`njobs:`n  a:`n    runs-on: `${{ github.event.repository.private && fromJSON('[`"self-hosted`", `"Windows`", `"thornswood-vps`"]') || 'ubuntu-latest' }}`n  b:`n    runs-on: [self-hosted, Windows, thornswood-vps]`n"
    $x = Run (Facts) $wfIs
    T ($x.Out -match 'RISK  workflow label\.yml started by anyone') '  and one job left on it beside one that picks it only while private is still a risk'
    # A choice between two runners named outright is either of them (#5292).
    Set-Content (Join-Path $wfIs 'label.yml') "on:`n  issue_comment:`npermissions:`n  issues: write`njobs:`n  a:`n    runs-on: `${{ needs.pick.outputs.launcher == 'false' && 'ubuntu-24.04-arm' || 'windows-latest' }}`n"
    $x = Run (Facts) $wfIs
    T ($x.Out -notmatch 'RISK  workflow label\.yml started by anyone' -and $x.Report -match '\| workflow \| label\.yml started by anyone \|[^\n]*; not on thornswood-vps[^\n]*\| ok \|') '  a job that picks one of two hosted runners by name is on neither of the box''s (#5292)'
    Set-Content (Join-Path $wfIs 'label.yml') "on:`n  issue_comment:`npermissions:`n  issues: write`njobs:`n  a:`n    runs-on: `${{ github.event.comment.body == 'x' && 'thornswood-vps' || 'ubuntu-latest' }}`n"
    $x = Run (Facts) $wfIs
    T ($x.Out -match 'RISK  workflow label\.yml started by anyone') '  and one whose choice names the production label is a risk'
    Set-Content (Join-Path $wfIs 'label.yml') "on:`n  issue_comment:`npermissions:`n  issues: write`njobs:`n  a:`n    runs-on: `${{ github.event.repository.private && fromJSON('[`"self-hosted`", `"Windows`", `"thornswood-vps`"]') || 'ubuntu-latest' }}`n"
    $x = Run (Facts) $wfIs
    T ($x.Out -notmatch 'RISK  workflow label\.yml started by anyone') '  a job that picks it only while private is not'
    $pub = Facts; $pub.github.private = $false
    $x = Run $pub $wfIs
    T ($x.Out -notmatch 'RISK  workflow label\.yml started by anyone') '  and stays not a risk once public, since it then runs on GitHub'

    # Once public, the same-repository condition is no guard: a fork's pull
    # request carries its own workflow files (#3685). The real build-pr.yml
    # falls back to the box's build runners (the build label, since 26 Oct
    # 2026 without the VPS label, and since #4010 the pull request build label,
    # which runner 2 on the box carries), so a public repository shows it as a
    # risk until that fallback is gone.
    $x = Run $pub ''
    $bp = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\build-pr.yml'))
    if ($bp -match 'runs-on:[^\n]*\bthornswood-(vps|build|pr-build)\b') {
        T ($x.Out -match 'RISK  workflow build-pr\.yml runs on: expected not thornswood-vps for untrusted code, found [^\n]*the repository is public') 'a public repository with a runner and a pull request job on the production label is a risk, condition or not'
    } else {
        T ($x.Out -notmatch 'RISK  workflow build-pr\.yml runs on') 'build-pr.yml has no job on the production label, so a public repository is safe from it'
    }
    T ($x.Out -match 'RISK  github self-hosted runners on a public repository: expected none, found 1') '  and a public repository with any self-hosted runner registered is a risk'
    # Patrick's A of 26 Oct 2026: on the day it goes public the runners move
    # to the private ops repository, and then nothing here can reach them.
    $gone = Facts; $gone.github.private = $false; $gone.github.runners = @()
    $x = Run $gone ''
    T ($x.Out -notmatch 'RISK  workflow [^\n]* runs on' -and $x.Out -notmatch 'RISK  workflow [^\n]* started by anyone' -and $x.Out -notmatch 'RISK  github self-hosted runners') 'once public with the runners moved off, no real workflow is a risk'

    # A pull request on the production label without the same-repository
    # condition is a risk; with it, it is not.
    $wfPr = Join-Path $scratch 'wfpr'; New-Item -ItemType Directory -Path $wfPr | Out-Null
    Set-Content (Join-Path $wfPr 'build-pr.yml') "on:`n  pull_request:`npermissions:`n  contents: read`njobs:`n  a:`n    runs-on: [self-hosted, Windows, thornswood-vps]`n"
    $x = Run (Facts) $wfPr
    T ($x.Out -match 'RISK  workflow build-pr\.yml runs on') 'a pull request job on the production label with no same-repository condition is a risk'
    Set-Content (Join-Path $wfPr 'build-pr.yml') "on:`n  pull_request:`npermissions:`n  contents: read`njobs:`n  a:`n    if: `${{ github.event.pull_request.head.repo.full_name == github.repository }}`n    runs-on: [self-hosted, Windows, thornswood-vps]`n"
    $x = Run (Facts) $wfPr
    T ($x.Out -notmatch 'RISK  workflow build-pr\.yml runs on') 'the same job limited to this repository is not'
    Set-Content (Join-Path $wfPr 'build-pr.yml') "on:`n  pull_request_target:`npermissions:`n  contents: read`njobs:`n  a:`n    if: `${{ github.event.pull_request.head.repo.full_name == github.repository }}`n    runs-on: [self-hosted, Windows, thornswood-vps]`n"
    $x = Run (Facts) $wfPr
    T ($x.Out -match 'RISK  workflow build-pr\.yml runs on') 'pull_request_target on the production label stays a risk, condition or not'
    # #5296: the merge queue runs a queued pull request's code, a fork's too.
    Set-Content (Join-Path $wfPr 'build-pr.yml') "on:`n  merge_group:`npermissions:`n  contents: read`njobs:`n  a:`n    if: `${{ github.event.pull_request.head.repo.full_name == github.repository }}`n    runs-on: [self-hosted, Windows, thornswood-vps]`n"
    $x = Run (Facts) $wfPr
    T ($x.Out -match 'RISK  workflow build-pr\.yml runs on') 'merge_group on the production label is a risk too, condition or not (#5296)'
    # Two pull request jobs on the production label, one limited to this
    # repository: the other is still a risk (#3550, the condition used to be
    # matched against the whole file).
    Set-Content (Join-Path $wfPr 'build-pr.yml') "on:`n  pull_request:`npermissions:`n  contents: read`njobs:`n  a:`n    if: `${{ github.event.pull_request.head.repo.full_name == github.repository }}`n    runs-on: [self-hosted, Windows, thornswood-vps, thornswood-build]`n  b:`n    runs-on: [self-hosted, Windows, thornswood-vps, thornswood-build]`n"
    $x = Run (Facts) $wfPr
    T ($x.Out -match 'RISK  workflow build-pr\.yml runs on') 'one job limited to this repository does not cover the job beside it'

    # ---- the environments counted as main only (#3550) ---------------------
    $g = Facts
    $g.github.environments = @([ordered]@{ name = 'board'; policy = 'custom'; refs = @('branch:main') }, [ordered]@{ name = 'notices'; policy = 'any'; refs = @() })
    $x = Run $g $wfOk
    T ($x.Out -match 'RISK  github environment notices admits' -and $x.Out -notmatch 'RISK  github environment board') 'an environment the record counts as main only that GitHub says lets in other refs is a risk'
    T (-not (Test-Path -LiteralPath (Join-Path (Join-Path $repo 'records') 'sign-runners.json'))) 'records\sign-runners.json is gone: no runner of the box signs (#4033)'

    $rec0 = Get-Content (Join-Path $repo 'records\runner-isolation.json') -Raw | ConvertFrom-Json
    T ([string]$rec0.decision -match 'GitHub-hosted' -and [string]$rec0.decision -match '11 Oct 2026' -and [string]$rec0.decision -match 'outbound' -and [string]$rec0.decision -notmatch 'residual') 'the record carries the decision'

    $b = Facts; $ru = $b.runner.runners[0]
    $ru.groups = @('Users', 'Administrators')
    $ru.reach['C:\Thornswood-Docs\config.json'] = [ordered]@{ read = $true; write = $false; denied = $false }
    $ru.reach['C:\Thornswood-Dumps'] = [ordered]@{ read = $true; write = $true; denied = $false }
    $ru.tempLeftFiles = 4; $ru.tempOldestHours = 50; $ru.firewallRules = 0
    $b.runner.machineEnvNames = @('GH_TOKEN')
    $b.github.private = $false; $b.github.forkPr.run_workflows_from_fork_pull_requests = $true; $b.github.workflowToken.default_workflow_permissions = 'write'
    $x = Run $b $wfOk
    T ($x.Code -eq 1) 'with -Strict, any risk fails'
    T ($x.Out -match 'RISK  account thornswood-runner groups') 'a runner in Administrators is a risk'
    T ($x.Out -match 'RISK  reach thornswood-runner C:\\Thornswood-Docs\\config\.json: expected no read, no write, found read=True') 'a runner that can read the site config is a risk'
    T ($x.Out -match 'RISK  reach thornswood-runner C:\\Thornswood-Dumps: expected write, no read') 'a runner that can read crash dumps is a risk'
    T ($x.Out -match 'RISK  cleanup thornswood-runner') 'files left in _work\_temp past the limit are a risk'
    T ($x.Out -match 'RISK  network thornswood-runner outbound') 'no outbound limit on a runner account is a risk'
    T ($x.Out -match 'RISK  env GH_TOKEN') 'a token-shaped machine variable every job inherits is a risk, by name only'
    T ($x.Out -match 'RISK  github visibility' -and $x.Out -match 'RISK  github fork pull requests' -and $x.Out -match 'RISK  github default workflow token') 'public repo, fork workflows and a write token are risks'

    $r2 = Get-Content (Join-Path $repo 'records\runner-isolation.json') -Raw | ConvertFrom-Json
    $r2.intentional = @([pscustomobject]@{ area = 'network'; item = 'thornswood-runner outbound'; why = 'stand-in reason' })
    $rp2 = Join-Path $scratch 'rec.json'; $r2 | ConvertTo-Json -Depth 6 | Set-Content $rp2 -Encoding utf8
    $c = Facts; $c.runner.runners[0].firewallRules = 0
    $fp = Join-Path $scratch 'f2.json'; $c | ConvertTo-Json -Depth 8 | Set-Content $fp -Encoding utf8
    $o = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $check -Facts $fp -Record $rp2 -Workflows $wfOk -Strict 2>&1 | Out-String
    T ($LASTEXITCODE -eq 0 -and $o -match 'intentional: stand-in reason') 'a risk listed as intentional is classed so, with its reason'

    $d = Facts; $d.runner.runners[0].account = 'password=hunter2PLANTED'
    $x = Run $d $wfOk
    T ($x.Code -eq 2 -and -not $x.Report) 'a report holding something shaped like a secret is refused and not written'
    T ((Get-Content (Join-Path $repo 'records\runner-isolation.json') -Raw) -notmatch '(?i)password\s*[=:]|BEGIN ') 'records\runner-isolation.json holds no secret'
} finally { Remove-Item -LiteralPath $scratch -Recurse -Force -EA SilentlyContinue }

Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
