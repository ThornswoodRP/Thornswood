<#
  test-3410-artifact-room.ps1

  engine-prune.yml drops every engine build engine.yml keeps that nothing
  pins, after every engine.yml run, so the repository's artifact storage
  cannot fill with them again.

  WHY THIS EXISTS. Issue #3410. On 25 Oct 2026 the artifact storage was over
  its 500 MB and every upload failed ("Artifact storage quota has been hit"):
  three board reads, and engine run 40249618462, the build the #2262 pin
  needed. 22 engine builds of 21 commits held 272 MB of it, kept 30 days
  each, though a Ship machine only ever takes the build of the commit its
  checkout pins. Patrick approved keeping only the builds a pin can still take
  (card t-artifacts, 25 Oct). The board read stopped needing the storage in
  the same change (tests\test-3192-board-read.ps1).

  What it checks:
    1. the workflow is there, starts after every Engine build run however it
       ended and by hand, and on nothing else; its token may delete artifacts
       and read, nothing more; it runs on GitHub's runner with a timeout and
       runs no action; the run's id comes in through the environment, with
       no ${{ }} in the script;
    2. the script, lifted out of the workflow and run in a child PowerShell
       with a stand-in Invoke-RestMethod that answers as GitHub would:
       - it keeps every copy of main's pin, the fork tip, each open pull
         request's pin, the triggering run's build and what a run still going
         made, says why each stays, and deletes every other engine-<12 hex>
         artifact, reading the artifacts past their first page;
       - it never touches an artifact that is not engine-<12 hex> (the
         tested-tree notes, a trace) or one already expired;
       - a pull request whose head repository is gone pins nothing and is
         said so;
       - a read that fails, or a pin that is not a submodule, stops the run
         red before any delete;
       - a delete that fails is said and makes the run red, after it tried
         the rest.

  It never reaches GitHub. Read only apart from files under its own temp
  folder.
#>
[CmdletBinding()]
param([string]$Workflow)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
if (-not $Workflow) { $Workflow = Join-Path $Repo '.github\workflows\engine-prune.yml' }

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

# ---- 1. the workflow --------------------------------------------------------
Yes '.github\workflows\engine-prune.yml is there' (Test-Path -LiteralPath $Workflow)
if (-not (Test-Path -LiteralPath $Workflow)) { Done }
$text = [IO.File]::ReadAllText($Workflow) -replace "`r`n", "`n"
$engineName = [regex]::Match(([IO.File]::ReadAllText((Join-Path $Repo '.github\workflows\engine.yml'))), '(?m)^name:\s*(.+?)\s*$').Groups[1].Value

$on = [regex]::Match($text, '(?ms)^on:\n(.*?)^\S').Groups[1].Value
Yes ("it starts after every run of engine.yml ({0}), however it ended" -f $engineName) (
    $engineName -and $on -match ('(?m)^\s+workflows:\s*\[' + [regex]::Escape($engineName) + '\]\s*$') -and $on -match '(?m)^\s+types:\s*\[completed\]\s*$' -and $on -notmatch 'branches')
Yes '  and by hand, and on nothing else' ($on -match '(?m)^\s+workflow_dispatch:\s*$' -and @([regex]::Matches($on, '(?m)^  [a-z_]+:')).Count -eq 2)
$perms = [regex]::Match($text, '(?m)^permissions:\n((?:  [^ ].*\n)+)').Groups[1].Value
Yes 'its token may delete artifacts and read this repository and its pull requests, nothing more' (
    (@($perms -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() } | Sort-Object) -join '|') -eq 'actions: write|contents: read|pull-requests: read' -and @([regex]::Matches($text, '(?m)^\s+permissions:')).Count -eq 0)
Yes '  and no secret' ($text -notmatch 'secrets\.')
$runsOn = [regex]::Match($text, '(?m)^\s*runs-on:\s*(.+)$').Groups[1].Value.Trim()
Yes ("it runs on GitHub's Windows runner (#4983) ({0})" -f $runsOn) ($runsOn -eq 'windows-latest')
Yes '  with a timeout' ($text -match '(?m)^\s+timeout-minutes:\s*\d+\s*$')
Yes '  and runs no action: it checks out nothing and builds nothing' ($text -notmatch '(?m)^\s+(-\s+)?uses:')
Yes 'one prune at a time, none cancelled' ($text -match '(?m)^\s+group:\s*engine-prune\s*$' -and $text -match '(?m)^\s+cancel-in-progress:\s*false\s*$')
Yes 'the run that started it comes in through the environment' ($text -match [regex]::Escape('BUILT_RUN: ${{ github.event.workflow_run.id }}'))

$m = [regex]::Match($text, '(?ms)^\s+shell: pwsh\n.*?^(\s+)run: \|\n(.*)$')
$script = ''
if ($m.Success) {
    $lines = $m.Groups[2].Value -split "`n"
    $indent = [regex]::Match($lines[0], '^\s*').Value
    $body = @()
    foreach ($l in $lines) {
        if ($l.Trim().Length -and -not $l.StartsWith($indent)) { break }
        $body += $(if ($l.Length -ge $indent.Length) { $l.Substring($indent.Length) } else { '' })
    }
    $script = ($body -join "`n").TrimEnd() + "`n"
}
Yes 'the prune step has a script' ($script.Length -gt 0)
Yes '  with no ${{ }} in it' ($script -notmatch '\$\{\{')
Yes '  that deletes only by artifact id' (@([regex]::Matches($script, '-Method Delete')).Count -eq 1 -and $script -match [regex]::Escape('-Method Delete -Uri "$gh/repos/$repo/actions/artifacts/$($a.id)"'))

# ---- 2. the script, run against a stand-in for GitHub -----------------------
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)
Yes 'pwsh is on this machine to run the script with' ($null -ne $pwsh)
if (-not $pwsh -or -not $script) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-engine-prune-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$calls = Join-Path $work 'calls.txt'

# The commits, one for each reason a build stays and two that nothing pins.
function C([string]$d) { return ($d * 40) }
$main = C '1'; $tip = C '2'; $pr = C '3'; $built = C '4'; $old = C '5'; $older = C '6'; $gone = C '7'; $going = C '8'
# Answers as GitHub would. TS_FAIL names a read to fail (main, tip, pulls,
# pin, built, going, list); TS_NOT_SUBMODULE makes main's engine/skymp a
# file; TS_FAIL_DELETE names an artifact id whose delete fails.
$standIn = @'
function Invoke-RestMethod {
    param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$Body)
    $rec = [ordered]@{ method = $Method; uri = $Uri; auth = $Headers['Authorization'] }
    [IO.File]::AppendAllText($env:TS_CALLS, ($rec | ConvertTo-Json -Compress) + "`n")
    $c = @{}; foreach ($d in '1', '2', '3', '4', '5', '6', '7', '8') { $c[$d] = $d * 40 }
    $api = 'https://api.github.com/'
    if (-not $Uri.StartsWith($api)) { throw "stand-in: not GitHub's API: $Uri" }
    $p = $Uri.Substring($api.Length)
    function Fail([string]$what) { if ($env:TS_FAIL -eq $what) { throw "stand-in: 502 Bad Gateway for $what" } }
    function Art([long]$id, [string]$name, [long]$run, [long]$size, [bool]$expired = $false) {
        return [pscustomobject]@{ id = $id; name = $name; size_in_bytes = $size; expired = $expired; created_at = '2026-10-20T12:00:00Z'; workflow_run = [pscustomobject]@{ id = $run } }
    }
    if ($Method -eq 'Delete') {
        if ($p -notmatch '^repos/ThornswoodRP/Thornswood/actions/artifacts/(\d+)$') { throw "stand-in: unexpected delete $p" }
        if ($Matches[1] -eq $env:TS_FAIL_DELETE) { throw 'stand-in: 500 Internal Server Error' }
        return $null
    }
    if ($Method -ne 'Get') { throw "stand-in: unexpected $Method $p" }
    switch -regex ($p) {
        '^repos/ThornswoodRP/Thornswood/contents/engine/skymp\?ref=main$' {
            Fail 'main'
            if ($env:TS_NOT_SUBMODULE) { return [pscustomobject]@{ type = 'file'; sha = $c['1'] } }
            return [pscustomobject]@{ type = 'submodule'; sha = $c['1'].ToUpperInvariant() + "`n" }
        }
        '^repos/(.+?)/contents/engine/skymp\?ref=([0-9a-f]{40})$' {
            Fail 'pin'
            if ($Matches[1] -eq 'ThornswoodRP/Thornswood' -and $Matches[2] -eq ('a' * 40)) { return [pscustomobject]@{ type = 'submodule'; sha = $c['3'] } }
            if ($Matches[1] -eq 'someone/Thornswood' -and $Matches[2] -eq ('b' * 40)) { return [pscustomobject]@{ type = 'submodule'; sha = $c['1'] } }
            throw "stand-in: 404 for $p"
        }
        '^repos/ThornswoodRP/skymp/branches/thornswood%2Fengine-changes$' {
            Fail 'tip'
            return [pscustomobject]@{ name = 'thornswood/engine-changes'; commit = [pscustomobject]@{ sha = $c['2'] } }
        }
        '^repos/ThornswoodRP/Thornswood/pulls\?state=open&per_page=100&page=(\d+)$' {
            Fail 'pulls'
            if ($Matches[1] -ne '1') { return @() }
            return @(
                [pscustomobject]@{ number = 10; head = [pscustomobject]@{ sha = 'a' * 40; repo = [pscustomobject]@{ full_name = 'ThornswoodRP/Thornswood' } } }
                [pscustomobject]@{ number = 11; head = [pscustomobject]@{ sha = 'c' * 40; repo = $null } }
                [pscustomobject]@{ number = 12; head = [pscustomobject]@{ sha = 'b' * 40; repo = [pscustomobject]@{ full_name = 'someone/Thornswood' } } })
        }
        '^repos/ThornswoodRP/Thornswood/actions/runs/900/artifacts\?per_page=100$' {
            Fail 'built'
            return [pscustomobject]@{ total_count = 1; artifacts = @(Art 40 ('engine-' + $c['4'].Substring(0, 12)) 900 12000000) }
        }
        '^repos/ThornswoodRP/Thornswood/actions/workflows/engine\.yml/runs\?status=in_progress&per_page=100$' {
            Fail 'going'
            return [pscustomobject]@{ total_count = 1; workflow_runs = @([pscustomobject]@{ id = 950; status = 'in_progress' }) }
        }
        '^repos/ThornswoodRP/Thornswood/actions/artifacts\?per_page=100&page=(\d+)$' {
            Fail 'list'
            $n = [int]$Matches[1]
            if ($n -eq 1) {
                $a = @(
                    (Art 11 ('engine-' + $c['1'].Substring(0, 12)) 101 12000000)
                    (Art 12 ('engine-' + $c['1'].Substring(0, 12)) 102 12000001)
                    (Art 20 ('engine-' + $c['2'].Substring(0, 12)) 200 12000000)
                    (Art 50 ('engine-' + $c['5'].Substring(0, 12)) 500 12000000)
                    (Art 51 ('engine-' + $c['5'].Substring(0, 12)) 501 12000000)
                    (Art 70 ('engine-' + $c['7'].Substring(0, 12)) 700 12000000 $true)
                    (Art 71 ('engine-' + $c['1'] + '0').Substring(0, 20) 701 100)
                    (Art 72 'gate-trace' 702 100)
                    (Art 73 ('ENGINE-' + $c['6'].Substring(0, 12).ToUpperInvariant()) 703 100))
                foreach ($i in 1..91) { $a += Art (1000 + $i) ('tested-tree-' + ('{0:x40}' -f $i)) (2000 + $i) 300 }
                return [pscustomobject]@{ total_count = 106; artifacts = $a }
            }
            if ($n -eq 2) {
                return [pscustomobject]@{ total_count = 106; artifacts = @(
                    (Art 30 ('engine-' + $c['3'].Substring(0, 12)) 300 12000000)
                    (Art 40 ('engine-' + $c['4'].Substring(0, 12)) 900 12000000)
                    (Art 60 ('engine-' + $c['6'].Substring(0, 12)) 600 12000000)
                    (Art 80 ('engine-' + $c['8'].Substring(0, 12)) 950 12000000)
                    (Art 81 ('engine-' + $c['5'].Substring(0, 12)) 950 12000000)
                    (Art 1092 ('tested-tree-' + ('f' * 40)) 2092 300)) }
            }
            return [pscustomobject]@{ total_count = 106; artifacts = @() }
        }
        default { throw "stand-in: unexpected GET $p" }
    }
}

'@
$runner = Join-Path $work 'prune.ps1'
[IO.File]::WriteAllText($runner, $standIn + $script)

$names = 'GH_TOKEN', 'BUILT_RUN', 'FORK', 'FORK_BRANCH', 'GITHUB_REPOSITORY', 'TS_CALLS', 'TS_FAIL', 'TS_NOT_SUBMODULE', 'TS_FAIL_DELETE'
function Invoke-Prune([hashtable]$extra = @{}) {
    if (Test-Path -LiteralPath $calls) { Remove-Item -LiteralPath $calls -Force }
    $keep = @{}
    foreach ($k in $names) { $keep[$k] = [Environment]::GetEnvironmentVariable($k) }
    try {
        $env:GH_TOKEN = 'stand-in-run-token'
        $env:BUILT_RUN = '900'
        $env:FORK = 'ThornswoodRP/skymp'
        $env:FORK_BRANCH = 'thornswood/engine-changes'
        $env:GITHUB_REPOSITORY = 'ThornswoodRP/Thornswood'
        $env:TS_CALLS = $calls
        $env:TS_FAIL = ''
        $env:TS_NOT_SUBMODULE = ''
        $env:TS_FAIL_DELETE = ''
        foreach ($k in $extra.Keys) { [Environment]::SetEnvironmentVariable($k, $extra[$k]) }
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $out = & $pwsh.Source -NoProfile -NonInteractive -File $runner 2>&1 | Out-String; $code = $LASTEXITCODE }
        finally { $ErrorActionPreference = $old }
    } finally {
        foreach ($k in $keep.Keys) { [Environment]::SetEnvironmentVariable($k, $keep[$k]) }
    }
    $made = @()
    if (Test-Path -LiteralPath $calls) { $made = @(Get-Content -LiteralPath $calls | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json }) }
    $deleted = @($made | Where-Object { $_.method -eq 'Delete' } | ForEach-Object { [long]($_.uri -replace '^.*/', '') } | Sort-Object)
    return [pscustomobject]@{ Code = $code; Out = $out; Calls = $made; Deleted = $deleted }
}
function Ids($list) { return ((@($list) | ForEach-Object { [string]$_ }) -join ',') }

try {
    $r = Invoke-Prune
    Yes ("the run passes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  every call carries the run''s own token' ($r.Calls.Count -gt 0 -and @($r.Calls | Where-Object { $_.auth -ne 'Bearer stand-in-run-token' }).Count -eq 0)
    Yes ("  it deletes the builds nothing pins, every copy, and only those (deleted {0})" -f (Ids $r.Deleted)) ((Ids $r.Deleted) -eq '50,51,60')
    Yes '  it read the artifacts past their first page' (@($r.Calls | Where-Object { $_.uri -match 'actions/artifacts\?per_page=100&page=2$' }).Count -eq 1)
    Yes '  every read came before the first delete' (
        @($r.Calls | Where-Object { $_.method -eq 'Delete' }).Count -eq 3 -and
        ([array]::IndexOf(@($r.Calls | ForEach-Object { $_.method }), 'Delete')) -gt ([array]::LastIndexOf(@($r.Calls | ForEach-Object { $_.method }), 'Get')))
    $k = [regex]::Escape
    Yes '  main''s pin stays, both of its copies, and the log says so (a pin given in capitals and with a line end too)' (
        $r.Out -match ('keeps engine-' + $main.Substring(0, 12) + ": main's pin, the pin of pull request #12") -and $r.Out -match 'kept   engine-111111111111 \(artifact 11,' -and $r.Out -match 'kept   engine-111111111111 \(artifact 12,')
    Yes '  the fork''s engine-changes tip stays' ($r.Out -match ('keeps engine-' + $tip.Substring(0, 12) + ": the tip of the fork's thornswood/engine-changes") -and $r.Out -match 'kept   engine-222222222222')
    Yes '  an open pull request''s pin stays' ($r.Out -match ('keeps engine-' + $pr.Substring(0, 12) + ': the pin of pull request #10') -and $r.Out -match 'kept   engine-333333333333')
    Yes '  the build of the run that started it stays' ($r.Out -match ('keeps engine-' + $built.Substring(0, 12) + ': built by run 900') -and $r.Out -match 'kept   engine-444444444444')
    Yes '  what a run still going made stays, whatever its commit' ($r.Out -match 'keeps what engine.yml run 950 made: it has not ended' -and $r.Out -match 'kept   engine-888888888888 \(artifact 80,' -and $r.Out -match 'kept   engine-555555555555 \(artifact 81,')
    Yes '  a pull request whose head repository is gone pins nothing, and is said so' ($r.Out -match 'pull request #11 has no head repository left, so it pins nothing')
    Yes '  each one dropped is said, with its run' ($r.Out -match 'dropped engine-555555555555 \(artifact 50, run 500, made [^)]+\): nothing pins it' -and $r.Out -match 'dropped engine-666666666666 \(artifact 60, run 600')
    Yes '  an expired build, a name that is not engine-<12 hex>, a tested-tree note and a trace are not touched' (
        @($r.Deleted | Where-Object { $_ -in 70, 71, 72, 73 -or $_ -ge 1000 }).Count -eq 0)
    Yes '  and the total is said' ($r.Out -match '7 engine build\(s\) kept, [\d,]+ bytes; 3 dropped, 36,000,000 bytes freed; 0 could not be')

    $r = Invoke-Prune @{ BUILT_RUN = '' }
    Yes ("by hand, with no run that started it: what it built goes too (deleted {0})" -f (Ids $r.Deleted)) ($r.Code -eq 0 -and (Ids $r.Deleted) -eq '40,50,51,60' -and @($r.Calls | Where-Object { $_.uri -match 'actions/runs/\d+/artifacts' }).Count -eq 0)

    foreach ($what in 'main', 'tip', 'pulls', 'pin', 'built', 'going', 'list') {
        $r = Invoke-Prune @{ TS_FAIL = $what }
        Yes ("a read of {0} that fails stops the run red and deletes nothing (exit {1})" -f $what, $r.Code) ($r.Code -ne 0 -and $r.Deleted.Count -eq 0 -and $r.Out -match "502 Bad Gateway for $what")
    }
    $r = Invoke-Prune @{ TS_NOT_SUBMODULE = '1' }
    Yes ("main's engine/skymp that is not a submodule stops the run red and deletes nothing (exit {0})" -f $r.Code) ($r.Code -ne 0 -and $r.Deleted.Count -eq 0 -and $r.Out -match 'is not a submodule pin, so nothing is deleted')

    $r = Invoke-Prune @{ TS_FAIL_DELETE = '50' }
    Yes ("a delete that fails is said and makes the run red (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match '::error::engine-555555555555 \(artifact 50\) could not be deleted')
    Yes '  after it tried the rest' (@($r.Calls | Where-Object { $_.method -eq 'Delete' }).Count -eq 3 -and $r.Out -match '2 dropped, 24,000,000 bytes freed; 1 could not be')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
