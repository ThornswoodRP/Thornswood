<#
  test-4184-workflows-page.ps1

      pwsh -NoProfile -File .\tests\test-4184-workflows-page.ps1

  Issue #4184: no page listed the repository's workflows, so nobody could
  see at a glance what runs on a schedule, what runs on a pull request and
  what changes issues, and two were named on no page at all. docs\WORKFLOWS.md
  is that page, and this holds it to .github\workflows:

    1. On the tree: every workflow file has exactly one row, every row names
       a file that is there, and each row's "What starts it" names, in
       backticks, every event the file's on: block lists and no event it
       does not.
    2. A planted copy with one row taken out: red, naming that file.
    3. A planted copy with a row for a file that is gone: red, naming it.
    4. A planted copy whose row leaves out one of its file's events: red.
    5. A planted copy whose row names an event its file does not have: red.

  Reads only; the planted copies are in a temp folder, removed after.
#>
[CmdletBinding()]
param()

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

# The events GitHub can start a workflow on that a row could name.
$Events = @('push', 'pull_request', 'pull_request_target', 'merge_group', 'workflow_dispatch', 'workflow_run',
            'workflow_call', 'schedule', 'issues', 'issue_comment', 'deployment', 'deployment_status', 'release',
            'check_run', 'check_suite', 'repository_dispatch', 'create', 'delete', 'label', 'status')

# The events a workflow file's on: names, in the three ways YAML can write it.
function Get-WorkflowEvents([string]$path) {
    $lines = [IO.File]::ReadAllLines($path)
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $m = [regex]::Match($lines[$i], '^["'']?on["'']?:\s*(.*?)\s*(#.*)?$')
        if (-not $m.Success) { continue }
        $inline = $m.Groups[1].Value
        if ($inline) { return @($inline.Trim('[', ']') -split ',' | ForEach-Object { $_.Trim().Trim('"', '''') } | Where-Object { $_ }) }
        $out = @()
        for ($j = $i + 1; $j -lt $lines.Count; $j++) {
            $l = $lines[$j]
            if (-not $l.Trim() -or $l.TrimStart().StartsWith('#')) { continue }
            if ($l -notmatch '^\s') { break }
            $k = [regex]::Match($l, '^  ([a-z_]+):')
            if ($k.Success) { $out += $k.Groups[1].Value }
        }
        return $out
    }
    return @()
}

# What is wrong between the page and the folder, one line each.
function Find-WorkflowPageFaults([string]$root) {
    $faults = @()
    $dir = Join-Path (Join-Path $root '.github') 'workflows'
    $files = @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -match '\.ya?ml$' } | ForEach-Object { $_.Name } | Sort-Object)
    $page = Join-Path (Join-Path $root 'docs') 'WORKFLOWS.md'
    if (-not (Test-Path -LiteralPath $page)) { return @('docs/WORKFLOWS.md is not there') }
    $rows = @{}
    foreach ($l in [IO.File]::ReadAllLines($page)) {
        $m = [regex]::Match($l, '^\|\s*\[([^\]]+)\]\(\.\./\.github/workflows/([^)]+)\)\s*\|([^|]*)\|')
        if (-not $m.Success) { continue }
        $name = $m.Groups[2].Value
        if ($m.Groups[1].Value -ne $name) { $faults += "the row for $name shows it as $($m.Groups[1].Value)" }
        if ($rows.ContainsKey($name)) { $faults += "$name has two rows"; continue }
        $rows[$name] = $m.Groups[3].Value
    }
    foreach ($f in $files) {
        if (-not $rows.ContainsKey($f)) { $faults += "$f has no row"; continue }
        $named = @([regex]::Matches($rows[$f], '`([a-z_]+)`') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $Events -contains $_ })
        $has = @(Get-WorkflowEvents (Join-Path $dir $f))
        foreach ($e in $has) { if ($named -notcontains $e) { $faults += "the row for $f leaves out $e, which its on: names" } }
        foreach ($e in $named) { if ($has -notcontains $e) { $faults += "the row for $f names $e, which its on: does not" } }
    }
    foreach ($r in $rows.Keys) { if ($files -notcontains $r) { $faults += "a row names $r, which is not in .github/workflows" } }
    return $faults
}

# ---- 1. the tree -----------------------------------------------------------------
$faults = @(Find-WorkflowPageFaults $repo)
Yes ('docs/WORKFLOWS.md has one row for each workflow, with its events' + $(if ($faults.Count) { ': ' + ($faults -join ' | ') } else { '' })) ($faults.Count -eq 0)
$count = @(Get-ChildItem -LiteralPath (Join-Path $repo '.github/workflows') -File | Where-Object { $_.Name -match '\.ya?ml$' }).Count
Yes ('  it read every workflow file ({0})' -f $count) ($count -ge 20)
Yes '  and the build check''s events were read from its on: block' ((@(Get-WorkflowEvents (Join-Path $repo '.github/workflows/build-pr.yml')) -join ',') -eq 'pull_request,merge_group,workflow_dispatch')
Yes '  docs/README.md links the page' ([IO.File]::ReadAllText((Join-Path $repo 'docs/README.md')).Contains('[WORKFLOWS.md](WORKFLOWS.md)'))

# ---- 2 to 5. planted copies --------------------------------------------------------
function New-Copy {
    $t = Join-Path ([IO.Path]::GetTempPath()) ('ts-4184-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path (Join-Path $t '.github') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $t 'docs') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo '.github/workflows') -Destination (Join-Path $t '.github/workflows') -Recurse
    Copy-Item -LiteralPath (Join-Path $repo 'docs/WORKFLOWS.md') -Destination (Join-Path $t 'docs/WORKFLOWS.md')
    return $t
}
function Edit-Page([string]$t, [scriptblock]$change) {
    $p = Join-Path $t 'docs/WORKFLOWS.md'
    $lines = [IO.File]::ReadAllLines($p)
    [IO.File]::WriteAllLines($p, [string[]]@(& $change $lines))
}

$t = New-Copy
try {
    Edit-Page $t { param($l) $l | Where-Object { $_ -notmatch '^\| \[drop-claims\.yml\]' } }
    $r = @(Find-WorkflowPageFaults $t)
    Yes ('a page with drop-claims.yml''s row taken out is red, naming it (' + ($r -join ' | ') + ')') ($r.Count -eq 1 -and $r[0] -eq 'drop-claims.yml has no row')
} finally { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }

$t = New-Copy
try {
    Edit-Page $t { param($l) $l; '| [release.yml](../.github/workflows/release.yml) | `push` | Gone since #5385. | A Release. |' }
    $r = @(Find-WorkflowPageFaults $t)
    Yes ('a row for a workflow that is gone is red, naming it (' + ($r -join ' | ') + ')') ($r.Count -eq 1 -and $r[0] -eq 'a row names release.yml, which is not in .github/workflows')
} finally { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }

$t = New-Copy
try {
    Edit-Page $t { param($l) $l | ForEach-Object { if ($_ -match '^\| \[nightly\.yml\]') { $_.Replace('`schedule` (09:00 UTC), ', '') } else { $_ } } }
    $r = @(Find-WorkflowPageFaults $t)
    Yes ('a row that leaves out its file''s schedule is red (' + ($r -join ' | ') + ')') ($r.Count -eq 1 -and $r[0] -eq 'the row for nightly.yml leaves out schedule, which its on: names')
} finally { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }

$t = New-Copy
try {
    Edit-Page $t { param($l) $l | ForEach-Object { if ($_ -match '^\| \[harnesses\.yml\]') { $_.Replace('`workflow_dispatch` (harness', '`pull_request`, `workflow_dispatch` (harness') } else { $_ } } }
    $r = @(Find-WorkflowPageFaults $t)
    Yes ('a row that names an event its file does not have is red (' + ($r -join ' | ') + ')') ($r.Count -eq 1 -and $r[0] -eq 'the row for harnesses.yml names pull_request, which its on: does not')
} finally { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }

Done
