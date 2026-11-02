<#
.SYNOPSIS
  Checks what the self-hosted GitHub Actions runners on the VPS can reach (accounts, groups, production paths, leftovers, firewall, which workflows and pull requests run there, the repository's Actions settings) and writes a redacted report; read-only (issue #2161).

.DESCRIPTION
  -Collect is the only part that reaches anything, and it only reads:
    Get-RunnerFacts.ps1 and Get-ProdFacts.ps1 (issue #2165) on the VPS
    through Remote.ps1, and the repository's Actions settings through gh
    api GET calls (visibility, fork pull request policy, default token
    permissions, the runners and their labels, how many collaborators).
  It saves them to -Facts. Collecting is a live step: Claude's
  (the ops repo's ops\claude-queue\2161-runner-isolation.md).

  Without -Collect it compares a saved -Facts file with
  records\runner-isolation.json and the workflows in .github\workflows.
  That part is offline and is what tests\test-runner-isolation.ps1 runs.

  The workflows are read job by job (#3550): a condition on one job says
  nothing about the job beside it. From #3550 to #4033 this also held every
  job that could land on the signing runner to main's code; no runner of
  the box signs since #4013, so there is none to hold.

  Each row is ok, intentional (the record's reason), or risk. A risk row is
  a finding for the threat model in the ops repo's RUNNER-ISOLATION.md, not a change:
  this script never changes a runner, an ACL, a setting or a credential.
  Rights come from reading ACLs, not from Windows' effective access check,
  and the report says so. No file contents, setting values or tokens are
  collected; the report is scanned and refused if anything shaped like a
  secret got in.

.EXAMPLE
  .\scripts\vps\Check-RunnerIsolation.ps1 -Collect -Facts $env:TEMP\runner-facts.json -Report $env:TEMP\runner-isolation.md
  .\scripts\vps\Check-RunnerIsolation.ps1 -Facts .\runner-facts.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Facts,
    [string]$Report,
    [switch]$Collect,
    [string]$Record,
    [string]$Workflows,
    [switch]$Strict
)

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Record) { $Record = Join-Path $Repo 'records\runner-isolation.json' }
if (-not $Workflows) { $Workflows = Join-Path $Repo '.github\workflows' }

function Get-RemoteJson([string]$file) {
    $out = & (Join-Path $PSScriptRoot 'Remote.ps1') -File (Join-Path $PSScriptRoot $file)
    if ($LASTEXITCODE -ne 0) { throw "$file failed on the VPS" }
    $j = @($out) | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
    if (-not $j) { throw "$file printed nothing" }
    return ($j | ConvertFrom-Json)
}

if ($Collect) {
    $origin = (git -C $Repo remote get-url origin) -replace '\.git$', ''
    $slug = ($origin -split '[/:]')[-2..-1] -join '/'
    $repoInfo = gh api "repos/$slug" | ConvertFrom-Json
    $gh = [ordered]@{
        private = [bool]$repoInfo.private
        forkPr = (gh api "repos/$slug/actions/permissions/fork-pr-workflows-private-repos" 2>$null | ConvertFrom-Json)
        workflowToken = (gh api "repos/$slug/actions/permissions/workflow" | ConvertFrom-Json)
        runners = @((gh api "repos/$slug/actions/runners" | ConvertFrom-Json).runners | ForEach-Object { [ordered]@{ name = $_.name; labels = @($_.labels.name) } })
        collaborators = @(gh api "repos/$slug/collaborators" | ConvertFrom-Json).Count
        # The deployment branch policy of each environment the record counts
        # as main only (#3550): custom with only main, or what it is instead.
        environments = @(foreach ($en in @((Get-Content -LiteralPath $Record -Raw | ConvertFrom-Json).mainOnlyEnvironments.names)) {
            $p = (gh api "repos/$slug/environments/$en" | ConvertFrom-Json).deployment_branch_policy
            $refs = @()
            if ($p -and $p.custom_branch_policies) { $refs = @((gh api "repos/$slug/environments/$en/deployment-branch-policies" | ConvertFrom-Json).branch_policies | ForEach-Object { "$($_.type):$($_.name)" }) }
            [ordered]@{ name = $en; policy = $(if (-not $p) { 'any' } elseif ($p.protected_branches) { 'protected branches' } else { 'custom' }); refs = $refs }
        })
    }
    $all = [ordered]@{ runner = (Get-RemoteJson 'Get-RunnerFacts.ps1'); prod = (Get-RemoteJson 'Get-ProdFacts.ps1'); github = $gh }
    $all | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $Facts -Encoding utf8
}

$f = Get-Content -LiteralPath $Facts -Raw | ConvertFrom-Json
$r = Get-Content -LiteralPath $Record -Raw | ConvertFrom-Json
# The labels records\<name>-runners.json give runners on the box by number:
# the build runners' (#2994) and the pull request builds' (#4010). Each one
# reaches the box.
$boxLabels = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'records') -Filter '*-runners.json' | Sort-Object Name | ForEach-Object {
    $rr = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
    if (-not [string]$rr.label) { throw ('records\' + $_.Name + ' names no label, so a job on the runners it lists cannot be told from one that is not.') }
    if (@($rr.runners).Count) { [string]$rr.label }
})
if (-not ($boxLabels -contains 'thornswood-build')) { throw 'no records\*-runners.json names thornswood-build, so a job on the box''s build runners cannot be told from one that is not.' }
$rows = New-Object System.Collections.Generic.List[object]
function Row([string]$Area, [string]$Item, [string]$Expected, [string]$Actual, [bool]$Ok, [string]$Kind = 'risk') {
    $cls = 'ok'; $why = ''
    if (-not $Ok) {
        $hit = @($r.intentional | Where-Object { $_.area -eq $Area -and $_.item -eq $Item }) | Select-Object -First 1
        if ($hit) { $cls = 'intentional'; $why = [string]$hit.why } else { $cls = $Kind }
    }
    $rows.Add([pscustomobject]@{ area = $Area; item = $Item; expected = $Expected; actual = $Actual; class = $cls; why = $why })
}

# ---- workflows: what runs on the production box, and for whom --------------
# Read from the files, so this half needs no box and no GitHub. Job by job
# (#3550): a condition on one job says nothing about the job beside it.

# The lines of a block: the lines after line $at indented deeper than $indent,
# up to the first that is not. Blank lines and comments go with the block.
function Get-Block([string[]]$ls, [int]$at, [int]$indent) {
    $out = @()
    for ($j = $at + 1; $j -lt $ls.Count; $j++) {
        $l = $ls[$j]
        if ($l -match '^\s*(#.*)?$') { continue }
        if (($l.Length - $l.TrimStart().Length) -le $indent) { break }
        $out += $l
    }
    return $out
}
# The keys of a mapping at exactly $indent spaces, with the line each is on.
function Get-Keys([string[]]$ls, [int]$indent) {
    $pad = ' ' * $indent
    $out = [ordered]@{}
    for ($j = 0; $j -lt $ls.Count; $j++) {
        if ($ls[$j] -match ('^' + $pad + '([A-Za-z0-9_-]+):(.*)$')) { $out[$Matches[1]] = @{ At = $j; Value = $Matches[2].Trim() -replace '\s+#.*$', '' } }
    }
    return $out
}
# A list written [a, b] or as - lines under the key.
function Get-List([string]$value, [string[]]$under) {
    if ($value -match '^\[(.*)\]$') { return @($Matches[1] -split ',' | ForEach-Object { $_.Trim().Trim("'", '"') } | Where-Object { $_ }) }
    if ($value) { return @($value.Trim("'", '"')) }
    return @($under | Where-Object { $_ -match '^\s*-\s*(.+)$' } | ForEach-Object { ($_ -replace '^\s*-\s*', '').Trim().Trim("'", '"') })
}

foreach ($wf in Get-ChildItem -LiteralPath $Workflows -Filter *.yml) {
    $t = [IO.File]::ReadAllText($wf.FullName)
    $lines = $t -split "\r?\n"
    $top = Get-Keys $lines 0
    $onLines = @(if ($top.Contains('on')) { Get-Block $lines $top['on'].At 0 })
    $on = Get-Keys $onLines 2
    $triggers = @($on.Keys)
    if (-not $triggers.Count -and $top.Contains('on') -and $top['on'].Value) { $triggers = Get-List $top['on'].Value @() }
    $perm = (@(if ($top.Contains('permissions')) { Get-Block $lines $top['permissions'].At 0 }) | ForEach-Object { $_.Trim() }) -join ' '
    if (-not $perm -and $top.Contains('permissions')) { $perm = $top['permissions'].Value }
    $name = $wf.Name
    $jobLines = @(if ($top.Contains('jobs')) { Get-Block $lines $top['jobs'].At 0 })
    $jobKeys = Get-Keys $jobLines 2
    $prodJobs = @(); $sameRepoAll = $true; $privateOnlyAll = $true
    foreach ($jk in $jobKeys.Keys) {
        $jl = @(Get-Block $jobLines $jobKeys[$jk].At 2)
        $k = Get-Keys $jl 4
        $runsOn = $(if ($k.Contains('runs-on')) { $k['runs-on'].Value } else { '' })
        # $null: a runs-on worked out at run time, or a runner group, which can be any runner.
        $labels = $null
        if ($k.Contains('runs-on') -and $runsOn -notmatch '\$\{\{') {
            $ro = @(Get-List $runsOn @(Get-Block $jl $k['runs-on'].At 4) | ForEach-Object { $_.ToLowerInvariant() })
            if ($ro.Count) { $labels = $ro }
        }
        # One of two runners named outright, chosen by a condition (#5292: the
        # launcher job is on Linux when the pick says the change cannot reach
        # it, and on Windows otherwise): it can only be one of those two.
        if ($k.Contains('runs-on') -and $runsOn -match '^\$\{\{\s*.+?\s*&&\s*''([^'']+)''\s*\|\|\s*''([^'']+)''\s*\}\}$') {
            $labels = @($Matches[1].ToLowerInvariant(), $Matches[2].ToLowerInvariant())
        }
        # Only while the repository is private (#3685): the box's labels inside
        # the expression while private, a GitHub-hosted runner once public.
        $gated = $false
        if ($k.Contains('runs-on') -and $runsOn -match '^\$\{\{\s*github\.event\.repository\.private\s*&&\s*fromJSON\(''\[(.*?)\]''\)\s*\|\|\s*''[^'']+''\s*\}\}$') {
            $labels = @($Matches[1] -split ',' | ForEach-Object { $_.Trim().Trim('"').ToLowerInvariant() } | Where-Object { $_ })
            $gated = $true
        }
        $cond = $(if ($k.Contains('if')) { $k['if'].Value } else { '' })
        $anyRunner = $k.Contains('runs-on') -and $null -eq $labels
        # The records' labels reach the box too: its runners carry them beside
        # the production label, and the pull request build's fallback asks for
        # its label alone, so One's off-box runners take it as well as box
        # runner 2 (26 Oct 2026, #4010).
        $onProd = $anyRunner -or ($labels -and (@($labels | Where-Object { @((@($r.productionLabel) + $boxLabels) | ForEach-Object { ([string]$_).ToLowerInvariant() }) -contains $_ }).Count -gt 0))
        if ($onProd) {
            $prodJobs += $jk
            if (-not $gated) { $privateOnlyAll = $false }
            if ($cond -notmatch 'github\.event\.pull_request\.head\.repo\.full_name == github\.repository') { $sameRepoAll = $false }
        }
    }
    # A pull request may reach the production label only through a job that
    # names this repository as the head, so a fork never does (Patrick, 12 Oct
    # 2026: the VPS backs up pull request builds too, same-repository only).
    # pull_request_target is never allowed there, and neither is merge_group
    # (#5296): the merge queue runs any queued pull request's code, a fork's
    # included, and its event names no head repository to hold it to.
    #
    # Once the repository is public (#3685) that condition is no guard: a pull
    # request runs the workflow files of its own branch, so a fork can carry
    # one with no condition, or a new one, that names the production label.
    # Then no pull request job may be on the production label at all while
    # a runner is still registered to the repository (Patrick's A of 26 Oct
    # 2026: the runners move to the private ops repository).
    $onProd = $prodJobs.Count -gt 0
    $sameRepo = $onProd -and $sameRepoAll
    $public = $f.github -and -not $f.github.private -and @($f.github.runners).Count -gt 0
    $prOnProd = $onProd -and ($triggers -contains 'pull_request_target' -or $triggers -contains 'merge_group' -or ($triggers -contains 'pull_request' -and ($public -or -not $sameRepo)))
    Row 'workflow' "$name runs on" "not $($r.productionLabel) for untrusted code" ("triggers " + ($triggers -join ',') + $(if ($onProd) { "; on $($r.productionLabel)" } else { '' }) + $(if ($sameRepo) { '; same-repository pull requests only' } else { '' }) + $(if ($onProd -and $public -and $triggers -contains 'pull_request') { '; the repository is public' } else { '' })) (-not $prOnProd)
    # Events anyone can cause on a public repository, with no write access:
    # opening, closing or commenting on their own issue, a discussion, a
    # fork, a star, a review on a pull request. A job they start may reach
    # the production label only while the repository is private, when only
    # collaborators can cause them (#3685). The workflow file comes from the
    # default branch for these, so the condition in it holds.
    $privateOnly = $onProd -and $privateOnlyAll
    $strangerEvents = @('issues', 'issue_comment', 'discussion', 'discussion_comment', 'fork', 'watch', 'pull_request_review', 'pull_request_review_comment')
    $byStrangers = @($triggers | Where-Object { $strangerEvents -contains $_ })
    if ($byStrangers.Count) {
        Row 'workflow' "$name started by anyone" "not $($r.productionLabel) once public" ("triggers " + ($byStrangers -join ',') + $(if (-not $onProd) { '; not on ' + $r.productionLabel } elseif ($privateOnly) { "; on $($r.productionLabel) only while private" } else { "; on $($r.productionLabel)" })) (-not $onProd -or $privateOnly)
    }
    if ($triggers -contains 'pull_request_target') { Row 'workflow' "$name pull_request_target" 'not used' 'used' $false }
    Row 'workflow' "$name token" 'permissions set per workflow, no write-all' $(if ($perm) { $perm.Trim() } else { 'not set (repository default)' }) ([bool]$perm -and $perm -notmatch 'write-all')
}

# ---- repository settings ----------------------------------------------------
if ($f.github) {
    $g = $f.github
    Row 'github' 'visibility' 'private' $(if ($g.private) { 'private' } else { 'public' }) ([bool]$g.private)
    # A public repository may have no self-hosted runner at all: any fork's
    # pull request can carry a workflow that names one (#3685).
    if (-not $g.private) { Row 'github' 'self-hosted runners on a public repository' 'none' ([string]@($g.runners).Count) (@($g.runners).Count -eq 0) }
    if ($g.forkPr) { Row 'github' 'fork pull requests run workflows' 'no' $(if ($g.forkPr.run_workflows_from_fork_pull_requests) { 'yes' } else { 'no' }) (-not $g.forkPr.run_workflows_from_fork_pull_requests) }
    Row 'github' 'default workflow token' 'read' ([string]$g.workflowToken.default_workflow_permissions) ($g.workflowToken.default_workflow_permissions -eq 'read')
    Row 'github' 'collaborators who can push and so run code on the runners' 'known and few' ([string]$g.collaborators) $true
    foreach ($ru in $g.runners) { Row 'github' "runner $($ru.name) labels" 'listed' (@($ru.labels) -join ',') $true }
    foreach ($e in @($g.environments | Where-Object { $_ })) {
        Row 'github' "environment $($e.name) admits" 'main only (records\runner-isolation.json mainOnlyEnvironments)' ("$($e.policy)" + $(if (@($e.refs).Count) { ': ' + (@($e.refs) -join ',') } else { '' })) ($e.policy -eq 'custom' -and (@($e.refs) -join ',') -eq 'branch:main')
    }
}

# ---- runner accounts on the box ---------------------------------------------
foreach ($ru in @($f.runner.runners)) {
    $id = $ru.account
    $bad = @($ru.groups | Where-Object { $r.forbiddenGroups -contains $_ })
    Row 'account' "$id groups" ('none of ' + ($r.forbiddenGroups -join ', ')) (@($ru.groups) -join ',') (-not $bad)
    foreach ($p in $r.noReach) {
        $x = $ru.reach.$p
        if ($null -eq $x -or $x -is [string]) { Row 'reach' "$id $p" 'no read, no write' $(if ($x) { [string]$x } else { 'not checked' }) $true; continue }
        Row 'reach' "$id $p" 'no read, no write' ("read=" + $x.read + " write=" + $x.write) (-not $x.read -and -not $x.write)
    }
    foreach ($p in $r.writeOnly) {
        $x = $ru.reach.$p
        if ($null -eq $x -or $x -is [string]) { continue }
        Row 'reach' "$id $p" 'write, no read' ("read=" + $x.read + " write=" + $x.write) (-not $x.read)
    }
    Row 'cleanup' "$id _work\_temp" "nothing older than $($r.tempMaxHours) h" ("$($ru.tempLeftFiles) files, oldest $($ru.tempOldestHours) h") (-not ($ru.tempLeftFiles -gt 0 -and [double]$ru.tempOldestHours -gt [double]$r.tempMaxHours))
    Row 'network' "$id outbound" 'limited to GitHub, as Install-Runner -OffBox does' ("$($ru.firewallRules) firewall rules name the account") ([int]$ru.firewallRules -gt 0)
    Row 'credentials' "$id .credentials" 'readable by its own jobs (GitHub design)' $(if ($ru.hasCredentials) { 'present' } else { 'absent' }) $true
}

# ---- what any local account can reach on loopback (from the #2165 facts) ----
if ($f.prod) {
    $f.prod.listeners | Where-Object { $_.address -in '127.0.0.1', '::1' -and $_.proto -eq 'tcp' } | Sort-Object port -Unique | ForEach-Object {
        Row 'loopback' "tcp $($_.port)" 'reachable by every local account, runners too' ([string]$_.process) $true
    }
}
foreach ($n in @($f.runner.machineEnvNames)) {
    Row 'env' $n 'no secret-shaped machine variable every job inherits' 'set (name only)' (-not ($n -match 'TOKEN|KEY|SECRET|PASS'))
}

# ---- report -----------------------------------------------------------------
$lines = @('# Runner isolation report', '',
    "Facts taken $($f.runner.takenUtc) on $($f.runner.host). Record: records\runner-isolation.json. Rights are read from ACLs, not Windows' effective access check.", '',
    '| Area | Item | Expected | Actual | Class |', '| --- | --- | --- | --- | --- |')
foreach ($x in $rows) { $lines += "| $($x.area) | $($x.item) | $($x.expected) | $($x.actual) | $($x.class)$(if ($x.why) { ': ' + $x.why }) |" }
$risk = @($rows | Where-Object class -eq 'risk')
$lines += ''; $lines += "$(@($rows | Where-Object class -eq 'ok').Count) ok, $(@($rows | Where-Object class -eq 'intentional').Count) intentional, $($risk.Count) risk."
$text = $lines -join "`n"
$scan = $text -replace '\b[0-9a-f]{64}\b', '' -replace 'S-1-5-21-[0-9-]+', ''
if ($scan -match '-----BEGIN|(?i)(password|secret|token)\s*[=:]\s*\S{6,}|[A-Za-z0-9+/_\-]{40,}') {
    Write-Host 'the report holds something shaped like a secret; it was not written' -ForegroundColor Red
    exit 2
}
if ($Report) { Set-Content -LiteralPath $Report -Value $text -Encoding utf8 } else { Write-Output $text }
foreach ($x in $risk) { Write-Host ("RISK  {0} {1}: expected {2}, found {3}" -f $x.area, $x.item, $x.expected, $x.actual) -ForegroundColor Yellow }
Write-Host ("{0} rows, {1} risk" -f $rows.Count, $risk.Count)
if ($Strict -and $risk.Count) { exit 1 }
exit 0
