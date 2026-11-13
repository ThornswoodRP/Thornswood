<#
  test-4162-job-tokens.ps1

      pwsh -NoProfile -File .\tests\test-4162-job-tokens.ps1

  Issue #4162. nightly.yml gave every one of its jobs issues: write, though
  only the board job writes an issue, so the jobs that run every harness and
  the bot's tests held a token that could, and their checkouts kept that
  token in .git/config (actions/checkout's persist-credentials), where any
  harness could read it. The release workflows' checkouts kept theirs the
  same way. Nothing held a workflow to giving a job only what it uses.

  This reads every workflow under .github/workflows and holds:
    1. every checkout sets persist-credentials: false, unless its job pushes
       with git (a job that does is named in $Pushes with why); no job here
       pushes with the checkout's credentials today;
    2. a workflow of more than one job grants no write to all of them: a
       write is given on the job that uses it, so a job beside it never holds
       it (in a workflow of one job the two are the same);
    3. every workflow names permissions, at the top or on every job, so no
       job takes the repository's default token;
    4. in nightly.yml and the release workflows, each job's writes are
       exactly the ones $Writes says it uses, each measured from its steps;
       a job asking for one more is red, naming it;
    5. in every workflow, a job holding a write other than id-token hands
       the run's token to a step, or runs an action that takes it, so a
       write no step can use is red without a table.
  Reads the files only.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- reading a workflow ------------------------------------------------------
# The YAML these files use: two spaces a level, top keys at column 0, job ids
# at 2, a job's keys at 4, its steps at 6 ("- ") and a step's keys at 8.
function Read-Permissions([string[]]$lines, [int]$at, [int]$indent) {
    # $lines[$at] is "<indent>permissions:<rest>". Gives a hashtable scope ->
    # level, or the single key '*' for read-all / write-all / {}.
    $p = @{}
    $rest = ($lines[$at] -replace '^\s*permissions:\s*', '' -replace '\s+#.*$', '').Trim()
    if ($rest) {
        if ($rest -eq 'read-all') { $p['*'] = 'read' }
        elseif ($rest -eq 'write-all') { $p['*'] = 'write' }
        elseif ($rest -eq '{}') { }
        else { $p['?'] = $rest }
        return $p
    }
    for ($i = $at + 1; $i -lt $lines.Count; $i++) {
        $l = $lines[$i]
        if ($l -match '^\s*$' -or $l -match '^\s*#') { continue }
        $ind = $l.Length - $l.TrimStart().Length
        if ($ind -le $indent) { break }
        if ($l -match '^\s*([a-z-]+):\s*([a-z]+)') { $p[$Matches[1]] = $Matches[2] }
    }
    return $p
}

function Read-Workflow([string]$path) {
    $text = [IO.File]::ReadAllText($path) -replace "`r`n", "`n"
    $lines = $text -split "`n"
    $wf = [ordered]@{ Name = [IO.Path]::GetFileName($path); Top = $null; Jobs = [ordered]@{} }
    $inJobs = $false
    $job = $null
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $l = $lines[$i]
        if ($l -match '^\s*#' -or $l -match '^\s*$') { continue }
        if ($l -match '^permissions:') { $wf.Top = Read-Permissions $lines $i 0; continue }
        if ($l -match '^jobs:\s*$') { $inJobs = $true; continue }
        if ($l -match '^\S') { $inJobs = $false; $job = $null; continue }
        if (-not $inJobs) { continue }
        if ($l -match '^  ([A-Za-z0-9_-]+):\s*$') {
            $job = [ordered]@{ Id = $Matches[1]; Perms = $null; Steps = New-Object System.Collections.ArrayList; Text = New-Object System.Text.StringBuilder }
            $wf.Jobs[$job.Id] = $job
            continue
        }
        if (-not $job) { continue }
        [void]$job.Text.AppendLine($l)
        if ($l -match '^    permissions:') { $job.Perms = Read-Permissions $lines $i 4; continue }
        if ($l -match '^      - ') { [void]$job.Steps.Add((New-Object System.Text.StringBuilder)) }
        if ($job.Steps.Count -and ($l.Length - $l.TrimStart().Length) -ge 6) { [void]$job.Steps[$job.Steps.Count - 1].AppendLine($l) }
    }
    return $wf
}

function Writes($perms) {
    if ($null -eq $perms) { return @() }
    return @($perms.Keys | Where-Object { $perms[$_] -eq 'write' } | Sort-Object)
}

# ---- what is allowed ---------------------------------------------------------
# The jobs that push with git from their checkout, and why. None today:
# engine-pin.yml pushes its branch with its own header on the command, from
# a checkout that keeps nothing.
$Pushes = @{}

# Every write of the jobs in nightly.yml and the release workflows, each
# measured from the job's own steps (#4162, read on main 0412fe8). A job of
# these workflows not named holds no write.
$Scope = @('nightly.yml', 'merge-release.yml', 'promote-main.yml', 'release-files.yml', 'release-notes.yml', 'frida-sources.yml', 'git-ref.yml', 'deploy-agent.yml')
$Writes = [ordered]@{
    # Nightly-Issue.ps1 opens, comments on and closes "Nightly checks failed".
    'nightly.yml/board'           = @('issues')
    # gh release create/upload/edit and the main-<tag> ref (contents); POST
    # deployments (deployments); Sign-OnRunner.ps1's federated sign-in and
    # the provenance attestations (id-token, attestations); Push-MainPackage
    # to ghcr.io (packages); gh workflow run merge-release.yml when main
    # moved on (actions).
    'merge-release.yml/release'   = @('actions', 'attestations', 'contents', 'deployments', 'id-token', 'packages')
    # gh release create/upload/edit of main-<tag> (contents); POST
    # deployments to Main (deployments).
    'promote-main.yml/promote'    = @('contents', 'deployments')
    # Publish-ReleaseFiles.ps1: a draft Release, its files, then published.
    'release-files.yml/files'     = @('contents')
    # Publish-FridaSources.ps1: the same, for the sources' Release.
    'frida-sources.yml/sources'   = @('contents')
    # Set-Ref.ps1 makes and deletes refs and drafts (contents); the step
    # after it dispatches release-files.yml (actions).
    'git-ref.yml/ref'             = @('actions', 'contents')
    # gh release create/upload/edit agent-v<n> (contents); Sign-OnRunner.ps1's
    # federated sign-in (id-token).
    'deploy-agent.yml/release'    = @('contents', 'id-token')
}

# Steps that take the run's token: handed it, or an action that reads it.
$TokenSteps = 'github\.token|secrets\.GITHUB_TOKEN|uses:\s*(actions/attest-build-provenance|github/codeql-action/|ossf/scorecard-action|actions/github-script)'

# ---- the workflows -----------------------------------------------------------
$dir = Join-Path $Repo '.github/workflows'
$files = @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Extension -in '.yml', '.yaml' } | Sort-Object Name)
Yes ("the workflows are read ({0})" -f $files.Count) ($files.Count -gt 0)
$all = @($files | ForEach-Object { Read-Workflow $_.FullName })

# ---- 1. checkouts ------------------------------------------------------------
$kept = @()
$checkouts = 0
foreach ($wf in $all) {
    foreach ($j in $wf.Jobs.Values) {
        foreach ($s in $j.Steps) {
            $t = $s.ToString()
            if ($t -notmatch 'uses:\s*actions/checkout@') { continue }
            $checkouts++
            if ($t -match 'persist-credentials:\s*false') { continue }
            if ($Pushes.ContainsKey("$($wf.Name)/$($j.Id)")) { continue }
            $kept += "$($wf.Name)/$($j.Id)"
        }
    }
}
Yes ("1. every checkout keeps no credentials in .git/config ({0} checkouts; keeping them: {1})" -f $checkouts, $(if ($kept.Count) { ($kept -join ', ') } else { 'none' })) ($checkouts -gt 0 -and $kept.Count -eq 0)

# ---- 2. and 3. where permissions are given -----------------------------------
$topWrite = @($all | Where-Object { $_.Jobs.Count -gt 1 -and (@(Writes $_.Top).Count -gt 0 -or ($null -ne $_.Top -and $_.Top.ContainsKey('?'))) } | ForEach-Object { "$($_.Name) [" + (@(Writes $_.Top) -join ',') + ']' })
Yes ("2. no workflow of more than one job grants a write to all of them (granting one: {0})" -f $(if ($topWrite.Count) { $topWrite -join ', ' } else { 'none' })) ($topWrite.Count -eq 0)
$unnamed = @()
foreach ($wf in $all) {
    if ($null -ne $wf.Top) { continue }
    foreach ($j in $wf.Jobs.Values) { if ($null -eq $j.Perms) { $unnamed += "$($wf.Name)/$($j.Id)" } }
}
Yes ("3. no job takes the repository's default token (taking it: {0})" -f $(if ($unnamed.Count) { $unnamed -join ', ' } else { 'none' })) ($unnamed.Count -eq 0)

# ---- 4. and 5. each job's writes -----------------------------------------------
$more = @()
$less = @()
$unused = @()
$seen = @{}
foreach ($wf in $all) {
    foreach ($j in $wf.Jobs.Values) {
        $key = "$($wf.Name)/$($j.Id)"
        $seen[$key] = $true
        $eff = $(if ($null -ne $j.Perms) { $j.Perms } else { $wf.Top })
        $have = @(Writes $eff)
        $nonOidc = @($have | Where-Object { $_ -ne 'id-token' })
        if ($nonOidc.Count -and ($j.Text.ToString() -notmatch $TokenSteps)) { $unused += "$key holds " + ($nonOidc -join ', ') + ' and hands the token to no step' }
        if ($Scope -notcontains $wf.Name) { continue }
        $want = @($(if ($Writes.Contains($key)) { $Writes[$key] } else { @() }) | Sort-Object)
        $extra = @($have | Where-Object { $want -notcontains $_ })
        $missing = @($want | Where-Object { $have -notcontains $_ })
        if ($extra.Count) { $more += "$key asks for " + ($extra -join ', ') }
        if ($missing.Count) { $less += "$key no longer asks for " + ($missing -join ', ') }
    }
}
$stale = @($Writes.Keys | Where-Object { -not $seen.ContainsKey($_) })
Yes ("4. no job asks for a write its steps were not measured to use ({0})" -f $(if ($more.Count) { $more -join '; ' } else { 'none' })) ($more.Count -eq 0)
Yes ("   and the table names no write a job gave up, nor a job that is gone ({0})" -f $(if ($less.Count + $stale.Count) { (@($less) + @($stale | ForEach-Object { "$_ is gone" })) -join '; ' } else { 'none' })) (($less.Count + $stale.Count) -eq 0)
Yes ("5. every job with a write hands the run's token to a step that can use it ({0})" -f $(if ($unused.Count) { $unused -join '; ' } else { 'none' })) ($unused.Count -eq 0)

# ---- the reader is shown what it is for ----------------------------------------
$fake = Join-Path ([IO.Path]::GetTempPath()) ("tw4162-" + [guid]::NewGuid().ToString('N') + '.yml')
try {
    [IO.File]::WriteAllText($fake, (@(
        'name: fake', 'on: push', 'permissions:', '  contents: read', '  issues: write', 'jobs:',
        '  tests:', '    runs-on: ubuntu-latest', '    steps:',
        '      - uses: actions/checkout@0000000000000000000000000000000000000000 # v7',
        '      - run: echo hi',
        '  board:', '    runs-on: ubuntu-latest', '    permissions:', '      contents: read', '      issues: write', '    steps:',
        '      - uses: actions/checkout@0000000000000000000000000000000000000000 # v7',
        '        with:', '          persist-credentials: false',
        '      - run: ./board.ps1', '        env:', '          GH_TOKEN: ${{ github.token }}'
    ) -join "`n"))
    $f = Read-Workflow $fake
    Yes '   the reader sees a workflow-wide write' ((Writes $f.Top) -contains 'issues')
    Yes '   a job with no permissions of its own takes the workflow''s' ($null -eq $f.Jobs['tests'].Perms -and $null -ne $f.Jobs['board'].Perms)
    Yes '   a checkout with no persist-credentials: false is seen, and one with it is not' (
        ($f.Jobs['tests'].Steps[0].ToString() -notmatch 'persist-credentials:\s*false') -and ($f.Jobs['board'].Steps[0].ToString() -match 'persist-credentials:\s*false'))
    Yes '   a job given no token is told from one that is' (($f.Jobs['tests'].Text.ToString() -notmatch $TokenSteps) -and ($f.Jobs['board'].Text.ToString() -match $TokenSteps))
}
finally { Remove-Item -LiteralPath $fake -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
