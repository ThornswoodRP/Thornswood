<#
  Report-Clone.ps1

      pwsh scripts/dev/Report-Clone.ps1             on One: list this clone's worktrees, stashes and branches and hand them to GitHub
      pwsh scripts/dev/Report-Clone.ps1 -Install    on One: do that every morning, as a scheduled task of this account
      pwsh scripts/dev/Report-Clone.ps1 -Uninstall  on One: take that task off
      pwsh scripts/dev/Report-Clone.ps1 -Read       anywhere with gh, a cloud thread included: the latest report and what breaks the rules
      pwsh scripts/dev/Report-Clone.ps1 -Read -Run <id>   one report in particular

  Says what One's clone holds that only One can see: every worktree, with its
  branch, whether it has changes nobody committed and when it last changed;
  every stash; every local branch, with whether GitHub still has it and how
  far behind main it is; the folders in temp\ and worktrees\ that no worktree
  owns. The same for the engine fork inside it. Issue #3534.

  WHY THIS EXISTS. The 25 Oct 2026 weekly review listed "One's worktrees and
  stashes" under "Could not read": a cloud thread cannot reach One, and the
  rules about them (CLAUDE.md in the private ops repo, "On the shipping
  machine"; docs/guide/how-work-moves.md,
  "No stray branches, worktrees or pull requests") were checked by nobody.
  When the Local Desk read them by hand on 26 Oct (#3534), the shared clone
  held 29 worktrees, 7 stashes and about 96 dead branches (#3537). So One
  reports them itself, and anything with gh reads the report.

  HOW IT GETS OFF ONE. The report is JSON, gzipped and in base64, handed to
  .github/workflows/clone-report.yml on main as its one input. That run
  checks it is a report and prints it between CLONE-JSON begin and end lines
  in its log, the way board-read.yml hands the board back (#3410): a log
  takes no artifact storage and GitHub keeps it 90 days. -Read finds the
  latest run that ended well and reads its log. Only gh is needed on either
  side, signed in as the person whose account runs it, and no secret is
  made or kept. The run takes a light VPS runner for a few seconds.

  WHAT -Read HOLDS IT TO, one line each under its rule:
    clone on a branch   the shared clone is on a branch; it stays detached at
                        origin/main (CLAUDE.md in the ops repo)
    stash               any stash at all; never git stash in the shared clone (#992)
    branch gone         a worktree or local branch whose branch GitHub no
                        longer has: its pull request merged or closed, so it goes
    changes left        a worktree with changes nobody committed
    folder unowned      a folder in worktrees\ that no worktree owns
    old report          the report is more than two days old, so One has
                        not sent one since; said first
  A worktree on a branch GitHub still has is listed with its age and left to
  the review to judge: lanes may be mid-run in it (CLAUDE.md in the ops
  repo).

  WHAT IT NEVER HOLDS. The repository is public (#3721), so the run's log is
  too. The report names no machine and no path on it: the clone is "clone"
  or "engine/skymp", a worktree is its path inside the clone, and one
  outside it is "outside the clone: <its folder's name>". A stash is its ref
  and time, never its message, and temp\ is a count, never its names.

  Exits: 0 sent, installed, or read with nothing against the rules; 3 read,
  with lines against them; 1 stopped, with why; 2 no report to read yet.
#>
[CmdletBinding(DefaultParameterSetName = 'Send')]
param(
    [Parameter(ParameterSetName = 'Install', Mandatory = $true)][switch]$Install,
    [Parameter(ParameterSetName = 'Uninstall', Mandatory = $true)][switch]$Uninstall,
    [Parameter(ParameterSetName = 'Read', Mandatory = $true)][switch]$Read,
    [Parameter(ParameterSetName = 'Read')][long]$Run,
    # Write the report to this file and send nothing (the harness, and a
    # look before the first send).
    [Parameter(ParameterSetName = 'Send')][string]$OutFile,
    # The clone to report; the one this script is in when unsaid.
    [Parameter(ParameterSetName = 'Send')][string]$Clone,
    # Define the functions and stop, which is how the harness loads them.
    [Parameter(ParameterSetName = 'Load', Mandatory = $true)][switch]$Load,
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\ops\WorkflowRun.ps1')
. (Join-Path $PSScriptRoot '..\release\LogHandBack.ps1')   # Get-GhLogFlags (#5202)

$workflow = 'clone-report.yml'
$taskName = 'Thornswood Clone Report'
# The input clone-report.yml takes, and GitHub's limit on every input of one
# run together.
$maxInput = 60000

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# One git call in a folder; its lines, or throws with what git said.
function Invoke-Git([string]$dir, [string[]]$gitArgs) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = @(& git -C $dir @gitArgs 2>&1 | ForEach-Object { "$_" })
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($c -ne 0) { throw ("git " + ($gitArgs -join ' ') + " in $dir said: " + (($o | Select-Object -Last 2) -join ' ')) }
    return $o
}

function Get-IsoTime([DateTime]$t) { return $t.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

# One clone as the report holds it.
# A worktree's path as the report shows it: inside the clone, its path there;
# outside it, only its folder's name, so no path on One leaves it.
function Get-ShownPath([string]$root, [string]$p) {
    $r = [IO.Path]::GetFullPath($root).TrimEnd('\', '/')
    $f = [IO.Path]::GetFullPath($p).TrimEnd('\', '/')
    if ($f.StartsWith($r + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $f.StartsWith($r + '/', [StringComparison]::OrdinalIgnoreCase)) { return $f.Substring($r.Length + 1).Replace('\', '/') }
    return 'outside the clone: ' + (Split-Path -Leaf $f)
}

# One clone, as the report holds it. name is how the report calls it.
function Get-CloneReport([string]$dir, [string]$name = 'clone') {
    $root = (Resolve-Path -LiteralPath $dir).Path
    $head = @(Invoke-Git $root @('rev-parse', 'HEAD'))[0]
    $branch = @(Invoke-Git $root @('branch', '--show-current'))
    $branch = if ($branch.Count -and $branch[0]) { $branch[0] } else { $null }
    $main = $null
    try { $main = @(Invoke-Git $root @('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'))[0] } catch { $main = $null }

    $worktrees = New-Object System.Collections.Generic.List[object]
    $cur = $null
    foreach ($l in @(Invoke-Git $root @('worktree', 'list', '--porcelain')) + @('')) {
        if ($l -match '^worktree (.+)$') { $cur = [ordered]@{ path = $Matches[1]; branch = $null; sha = $null; detached = $false }; continue }
        if ($null -eq $cur) { continue }
        if ($l -match '^HEAD ([0-9a-f]+)$') { $cur.sha = $Matches[1]; continue }
        if ($l -match '^branch refs/heads/(.+)$') { $cur.branch = $Matches[1]; continue }
        if ($l -eq 'detached') { $cur.detached = $true; continue }
        if ($l -eq '') {
            $p = $cur.path
            $here = (Test-Path -LiteralPath $p)
            $cur.missing = (-not $here)
            $cur.dirty = 0
            $cur.changed_at = $null
            if ($here) {
                try { $cur.dirty = @(Invoke-Git $p @('status', '--porcelain') | Where-Object { $_ }).Count } catch { $cur.dirty = -1 }
                $cur.changed_at = Get-IsoTime (Get-Item -LiteralPath $p).LastWriteTime
            }
            # The clone itself is the first entry; it is reported as the clone.
            if ([IO.Path]::GetFullPath($p).TrimEnd('\', '/') -ne [IO.Path]::GetFullPath($root).TrimEnd('\', '/')) { $worktrees.Add($cur) }
            else { $cur = $null; continue }
            # Kept for the folder check below, then shown without One's paths.
            $cur.full = [IO.Path]::GetFullPath($p).TrimEnd('\', '/').ToLowerInvariant()
            $cur.path = Get-ShownPath $root $p
            $cur = $null
        }
    }

    $stashes = @(Invoke-Git $root @('stash', 'list', '--format=%gd%x09%cI') | Where-Object { $_ } | ForEach-Object {
            $f = $_ -split "`t", 2
            [ordered]@{ ref = $f[0]; at = $f[1] }
        })
    $archived = @(Invoke-Git $root @('for-each-ref', '--format=%(refname)', 'refs/stash-archive') | Where-Object { $_ }).Count

    $branches = @(Invoke-Git $root @('for-each-ref', '--format=%(refname:short)%09%(committerdate:iso-strict)%09%(upstream:short)%09%(upstream:track)', 'refs/heads') | Where-Object { $_ } | ForEach-Object {
            $f = $_ -split "`t", 4
            $behind = $null
            if ($main) { try { $behind = [int]@(Invoke-Git $root @('rev-list', '--count', ($f[0] + '..' + $main)))[0] } catch { $behind = $null } }
            [ordered]@{ name = $f[0]; at = $f[1]; upstream = $(if ($f[2]) { $f[2] } else { $null }); gone = ($f.Count -gt 3 -and $f[3] -eq '[gone]'); behind_main = $behind }
        })

    $owned = @($worktrees | ForEach-Object { $_.full })
    foreach ($w in $worktrees) { $w.Remove('full') }
    $unowned = @()
    $wtDir = Join-Path $root 'worktrees'
    if (Test-Path -LiteralPath $wtDir) {
        $unowned = @(Get-ChildItem -LiteralPath $wtDir -Directory | Where-Object { $owned -notcontains $_.FullName.TrimEnd('\', '/').ToLowerInvariant() } | ForEach-Object {
                [ordered]@{ name = $_.Name; changed_at = (Get-IsoTime $_.LastWriteTime) } })
    }
    $temp = 0
    $tempDir = Join-Path $root 'temp'
    if (Test-Path -LiteralPath $tempDir) { $temp = @(Get-ChildItem -LiteralPath $tempDir -Force).Count }

    return [ordered]@{
        path = $name; head = $head; branch = $branch; origin_main = $main
        worktrees = $worktrees.ToArray(); stashes = $stashes; stash_archive = $archived
        branches = $branches; unowned_worktree_folders = $unowned; temp_count = $temp
    }
}

# The whole report: this clone and the engine fork in it.
function New-CloneReport([string]$dir) {
    $clones = @(Get-CloneReport $dir 'clone')
    $engine = Join-Path $dir 'engine/skymp'
    if (Test-Path -LiteralPath (Join-Path $engine '.git')) { $clones += Get-CloneReport $engine 'engine/skymp' }
    return [ordered]@{ kind = 'thornswood-clone-report'; made_at = (Get-IsoTime (Get-Date)); clones = $clones }
}

# The report as clone-report.yml's input: gzip, then base64.
function ConvertTo-Packed([string]$json) {
    $bytes = (New-Object System.Text.UTF8Encoding $false).GetBytes($json)
    $ms = New-Object IO.MemoryStream
    $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionLevel]::Optimal)
    $gz.Write($bytes, 0, $bytes.Length)
    $gz.Dispose()
    return [Convert]::ToBase64String($ms.ToArray())
}

# A report from the lines of a clone-report job's log: the CLONE-JSON begin
# line gives its length and sha256, the lines after it the JSON in base64, up
# to the end line. A line may start with GitHub's timestamp. Throws, saying
# what is wrong.
function Read-ReportFromLog([string[]]$Lines) {
    $mark = 'CLONE' + '-JSON'
    $re = '^(?:\d{4}-\d\d-\d\dT[\d:.]+Z )?' + $mark + ' (.*)$'
    $begin = $null; $ended = $false; $parts = New-Object System.Text.StringBuilder
    foreach ($l in @($Lines | ForEach-Object { ([string]$_) -split "`r?`n" })) {
        $m = [regex]::Match($l.TrimEnd(), $re)
        if (-not $m.Success) { continue }
        $rest = $m.Groups[1].Value
        if ($rest -match '^begin (\d+) ([0-9a-f]{64})$') {
            if ($begin) { throw "the log has two $mark begin lines" }
            $begin = [pscustomobject]@{ Length = [long]$Matches[1]; Sha = $Matches[2] }
            continue
        }
        if (-not $begin) { continue }
        if ($rest -eq 'end') { $ended = $true; break }
        if ($rest -notmatch '^[A-Za-z0-9+/=]+$') { throw "a $mark line between begin and end is not base64" }
        [void]$parts.Append($rest)
    }
    if (-not $begin) { throw "the log has no $mark begin line" }
    if (-not $ended) { throw "the log has no $mark end line after its begin line" }
    $bytes = [Convert]::FromBase64String($parts.ToString())
    if ($bytes.Length -ne $begin.Length) { throw ("it is {0} bytes, and the begin line says {1}" -f $bytes.Length, $begin.Length) }
    $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    if ($sha -ne $begin.Sha) { throw "its sha256 is $sha, and the begin line says $($begin.Sha)" }
    return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
}

# Every line against the rules, as an ordered table rule -> lines. now is
# when it is read.
function Find-CloneDrift($report, [DateTime]$now) {
    $out = [ordered]@{}
    foreach ($k in 'old report', 'clone on a branch', 'stash', 'branch gone', 'changes left', 'folder unowned') { $out[$k] = New-Object System.Collections.Generic.List[string] }
    # pwsh's ConvertFrom-Json hands an ISO time back as a DateTime already.
    $made = if ($report.made_at -is [DateTime]) { $report.made_at.ToUniversalTime() } else { [DateTime]::Parse([string]$report.made_at, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal) }
    $age = $now.ToUniversalTime() - $made
    if ($age.TotalDays -gt 2) { $out['old report'].Add(('made {0:N1} days ago, at {1}: One has sent none since' -f $age.TotalDays, $report.made_at)) }
    $first = $true
    foreach ($c in @($report.clones)) {
        if ($first -and $c.branch) { $out['clone on a branch'].Add(('{0} is on {1}' -f $c.path, $c.branch)) }
        $first = $false
        foreach ($s in @($c.stashes)) { if ($s) { $out['stash'].Add(('{0}: {1} ({2})' -f $c.path, $s.ref, $s.at)) } }
        $gone = @{}
        foreach ($b in @($c.branches)) { if ($b -and $b.gone) { $gone[[string]$b.name] = $true; $out['branch gone'].Add(('{0}: branch {1}' -f $c.path, $b.name)) } }
        foreach ($w in @($c.worktrees)) {
            if (-not $w) { continue }
            if ($w.branch -and $gone.ContainsKey([string]$w.branch)) { $out['branch gone'].Add(('{0}: worktree {1} on {2}' -f $c.path, $w.path, $w.branch)) }
            if ([int]$w.dirty -gt 0) { $out['changes left'].Add(('{0}: {1} changed file(s), last changed {2}' -f $w.path, $w.dirty, $w.changed_at)) }
        }
        foreach ($u in @($c.unowned_worktree_folders)) { if ($u) { $out['folder unowned'].Add(('{0}: worktrees\{1}, last changed {2}' -f $c.path, $u.name, $u.changed_at)) } }
    }
    return $out
}

# What the report holds, a few lines a clone.
function Format-CloneReport($report) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add(('report made {0}' -f $report.made_at))
    foreach ($c in @($report.clones)) {
        $wt = @($c.worktrees | Where-Object { $_ })
        $br = @($c.branches | Where-Object { $_ })
        $lines.Add(('{0}: {1}, {2} worktree(s), {3} stash(es), {4} archived, {5} local branch(es) ({6} gone from GitHub), {7} unowned folder(s) in worktrees, {8} in temp' -f
                $c.path, $(if ($c.branch) { 'on ' + $c.branch } else { 'detached at ' + ([string]$c.head).Substring(0, [Math]::Min(8, ([string]$c.head).Length)) + $(if ($c.origin_main -and $c.head -eq $c.origin_main) { ' (origin/main)' } else { '' }) }),
                $wt.Count, @($c.stashes | Where-Object { $_ }).Count, $c.stash_archive, $br.Count, @($br | Where-Object { $_.gone }).Count,
                @($c.unowned_worktree_folders | Where-Object { $_ }).Count, [int]$c.temp_count))
        foreach ($w in $wt) {
            $lines.Add(('  worktree {0}: {1}, {2} changed, last changed {3}' -f $w.path, $(if ($w.branch) { $w.branch } else { 'detached' }), $w.dirty, $w.changed_at))
        }
    }
    return $lines.ToArray()
}

if ($Load) { return }

# =============================================================== read ===
if ($Read) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to read the report with.' }
    $id = $Run
    if (-not $id) {
        $g = Get-ThornswoodGitHub "repos/$GitHubRepo/actions/workflows/$workflow/runs?status=success&per_page=1"
        if (-not $g.Body) {
            if ($g.NotFound) { Say "There is no $workflow on main yet, so One has sent no report." 'Yellow'; exit 2 }
            Die $g.Why
        }
        $runs = @($g.Body.workflow_runs)
        if (-not $runs.Count) { Say 'One has sent no report yet: pwsh scripts/dev/Report-Clone.ps1 on One sends one, and -Install sends one every morning.' 'Yellow'; exit 2 }
        $id = [long]$runs[0].id
    }
    $jobs = Get-ThornswoodGitHub "repos/$GitHubRepo/actions/runs/$id/jobs"
    if (-not $jobs.Body) { Die $jobs.Why }
    $j = @($jobs.Body.jobs)
    if ($j.Count -ne 1) { Die ("run $id has $($j.Count) jobs, not the one $workflow runs.") }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    # The log keeps the runner's colours, which a newer gh hands over only
    # when told (Get-GhLogFlags, #5202).
    $flags = @(Get-GhLogFlags)
    $log = @(& gh api "repos/$GitHubRepo/actions/jobs/$($j[0].id)/logs" @flags 2>&1 | ForEach-Object { "$_" })
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($c -ne 0) { Die ("GitHub did not hand over run $id's log: " + ((($log | Select-Object -Last 2) -join ' ') -replace "`e", '')) }
    try { $report = Read-ReportFromLog $log } catch { Die ("run $id's log does not hold a report whole: " + $_.Exception.Message) }
    if ($report.kind -ne 'thornswood-clone-report') { Die "run $id's log holds something that is not a clone report." }
    foreach ($l in (Format-CloneReport $report)) { Say $l }
    $drift = Find-CloneDrift $report (Get-Date)
    $named = 0
    foreach ($k in $drift.Keys) {
        $lines = $drift[$k]
        if (-not $lines.Count) { Say ("  {0}: none" -f $k) 'DarkGray'; continue }
        $named += $lines.Count
        Say ("{0}: {1}" -f $k, $lines.Count) 'Yellow'
        foreach ($l in $lines) { Say "  $l" }
    }
    if ($named) { exit 3 }
    Say 'Nothing in the report is against the rules.' 'Green'
    exit 0
}

# ======================================================== the task on One ===
if ($Install -or $Uninstall) {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Die 'the scheduled task is for One, which is Windows.' }
    $have = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($Uninstall) {
        if ($have) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Say "took off the task $taskName" 'Green' } else { Say "there is no task $taskName" }
        exit 0
    }
    $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)
    if (-not $pwsh) { Die 'there is no pwsh here for the task to run this with.' }
    $self = (Resolve-Path -LiteralPath $PSCommandPath).Path
    $action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument ('-NoProfile -NonInteractive -File "' + $self + '"') -WorkingDirectory (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $self)))
    # Every morning, and as soon as One is on when it was off at that time.
    $trigger = New-ScheduledTaskTrigger -Daily -At '7:40 AM'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
    # As this account, only while it is signed in: gh's sign in is this
    # account's, and nothing here needs a password stored.
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    if ($have) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Hands this clone''s worktrees, stashes and branches to GitHub for the weekly review (#3534). scripts\dev\Report-Clone.ps1.' | Out-Null
    Say "the task $taskName runs $self every day at 7:40 AM as $me, and when One comes on after a missed time" 'Green'
    Say '  sending the first report now' 'DarkGray'
}

# =============================================================== send ===
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'there is no git here.' }
$dir = if ($Clone) { $Clone } else { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
try { $report = New-CloneReport $dir } catch { Die ('the clone could not be read: ' + $_.Exception.Message) }
$json = $report | ConvertTo-Json -Depth 8 -Compress
if ($OutFile) {
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutFile), $json, (New-Object System.Text.UTF8Encoding $false))
    Say "written to $OutFile, and nothing sent" 'Green'
    exit 0
}
$packed = ConvertTo-Packed $json
if ($packed.Length -gt $maxInput) { Die ("the report is {0} characters packed, past the {1} GitHub takes in one run's inputs, so nothing was sent. Most of it is branches: #3537 is clearing them." -f $packed.Length, $maxInput) }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to hand the report to GitHub with.' }
try { $started = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow $workflow -Inputs ([ordered]@{ report = $packed }) }
catch { Die ($_.Exception.Message + '. Nothing was sent.') }
foreach ($l in (Format-CloneReport $report)) { Say $l }
Say ("sent to $workflow" + $(if ($started.Url) { ': ' + $started.Url } else { '' })) 'Green'
exit 0
