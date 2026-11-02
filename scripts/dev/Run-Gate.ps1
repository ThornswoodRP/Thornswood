<#
.SYNOPSIS
  Runs the gate harnesses for build.yml's gate: picks and splits them for its
  shares, on a pull request only those its change can reach, and runs a
  share's part (#3114, #5183).

.DESCRIPTION
  build.yml's gate job runs this and nothing else, once in each of its
  five shares, each on a hosted runner of its own (-Of says why), after its
  job "Pick the gate harnesses" ran it once to pick and split (-Pick):

      .\scripts\dev\Run-Gate.ps1 -Pick 5
      .\scripts\dev\Run-Gate.ps1 -Shard 1 -Of 5 -Throttle 6 -BudgetSeconds 1200

  By hand, with no -Of, it is the whole gate on this machine, as below.

  THE GATE. Every harness scripts\dev\Gate-Harnesses.ps1 lists, run through
  scripts\dev\Nightly-Harnesses.ps1 -Throttle at once with this build's
  share of the cores: the machine's cores over the builds it runs at once.
  On the box those are the runners records\build-runners.json lists, on One
  the off-box runners the runner records name for it (#3860), and on
  GitHub's hosted runner one.

  ON MAIN, ON THE VPS. Patrick chose on 22 Oct 2026 (option A on his page,
  q-3114-map-refresh) that every main build's gate is traced, so pull
  requests can be held to a map that is never more than a merge or two
  old. Only an administrator can start the trace, so this asks the trace
  task (scripts\dev\Trace-Gate-Task.ps1, which runs as SYSTEM) through the
  runner's own folder, <runner>\trace:
    tree.gz     every path in this commit's tree with its mode and object,
                so a pull request can measure its change from this tree
                without fetching it (Affected-Harnesses.js tree)
    ask.json    this run, its commit, its checkout and this process
    answer.json the task's answer: tracing, or why not
    starts.jsonl  Nightly-Harnesses.ps1 -StartLog, which process was which
                harness's
    done.json   the gate ended, and how
  A main build is never held up by it: no answer in -AnswerSeconds, or any
  answer but tracing, runs the gate untraced and that commit leaves no map.
  The gate is the whole gate either way; the trace only watches it.

  ON A PULL REQUEST, ON THE VPS. The task leaves the newest map in every
  build runner's <runner>\gate-map, a folder the runner's account may read
  and not change. Affected-Harnesses.js pick builds the map from it and
  measures the change from the traced tree to this checkout's HEAD,
  GitHub's merge of the pull request into main, and this runs only what
  that change can reach, printing why each one runs. Anything that goes
  wrong on the way (no map, a map that does not read, pick failing) runs
  the whole gate and says why; so does any change to the scripts that list,
  choose and run the harnesses.

  OFF THE BOX (#4009, #5183). A runner with no gate-map of its own (GitHub's
  hosted runner, where every build runs since #5119) takes main's newest
  nightly map, which .github\workflows\gate-map.yml traces on GitHub's
  Windows runner and keeps as an artifact, through scripts\dev\Gate-Map.ps1
  -Fetch, with the job's token in GATE_MAP_TOKEN, and picks from it the same
  way. The token is taken out of the environment here, before any harness
  starts, and put back only around that call (#4079). No map there either
  runs the whole gate.

  THE NOTE. It writes whole=true to the step's outputs only when every gate
  harness ran (with shares, when the pick's plan holds every one). Main's
  build skips (#3182, the job "tested") only a tree whose pull request ran
  the whole gate: scripts\dev\Tested-Tree.js counts a run's note only when
  every gate share's name says it was a share of the whole gate, and a
  share of what a change can reach says so in its name (build.yml). So a
  pull request that ran only what it reaches leaves main to run the whole
  gate, and the nightly runs it every night, so whatever a harness left out
  would have caught is still caught there.

  The trace task, the map's folders and how they are kept from the
  runners' accounts: scripts\dev\Trace-Gate-Task.ps1. Why a map is enough:
  scripts\dev\Affected-Harnesses.js. tests\test-3114-run-gate.ps1 holds
  all of this.

.PARAMETER Shard
  Which share of the gate this runs, from 1, with -Of: its part of the
  pick's plan, or with none, harness number n of the gate list (from 0)
  when n mod Of is Shard - 1, the way nightly.yml splits its harnesses. So
  every harness to run is in exactly one share.

.PARAMETER Of
  How many shares the gate is split into. build.yml's gate job passes the
  length of its matrix. With more than one no trace is asked for, and each
  share runs its part of the pick's plan.

  WHY SHARES (31 Oct 2026). Since #5119 nothing builds on the box, and
  every pull request ran the whole gate on one hosted runner's four cores:
  707 harnesses, 3741 s of processor, the gate step 18 to 20 minutes of a 21
  minute build (run 41231641217). Split five ways over five hosted runners,
  each share has about a fifth of that.

  SHARES OF WHAT A CHANGE REACHES (#5183). A share runs the part of the
  list build.yml's job "Pick the gate harnesses" (this, with -Pick) gave it
  in GATE_PLAN, and checks the plan first: made for this many shares, from
  this gate, each harness in one share. With no plan it runs its part of the
  whole gate by place in the list. It fetches no map itself.

.PARAMETER Pick
  How many shares to pick for. Runs no harness: on a pull request it picks
  what the change can reach from main's nightly map, as above, on main the
  whole gate; then splits the list into that many shares and writes the plan
  (plan=, shares=, whole=) to the step's outputs. With the map's seconds the
  split is by time, longest first to the share with least so far, so the
  shares end together (split by place, run 41260247002's took 175 to 327 s);
  with none, by place. One pick for every share, so all of them run their
  part of one list from one map: a share fetching for itself could read
  another map, a nightly trace having ended between them, or fail to fetch,
  and a harness would then run twice or in no share. A docs, site or bot
  change runs only the harnesses the map says read what it changed; none is
  skipped by its path alone, since many harnesses read docs.

.PARAMETER Throttle
  The most harnesses at once, as Nightly-Harnesses.ps1 takes it.

.PARAMETER BudgetSeconds
  As Nightly-Harnesses.ps1 takes it: a harness starts only when its whole
  clock still fits.

.PARAMETER AnswerSeconds
  How long a main build waits for the trace task to say it is tracing.

.PARAMETER StartLog
  Where Nightly-Harnesses.ps1 -StartLog writes which process was which
  harness's, for gate-map.yml's trace on GitHub's runner (#5183). A main
  build the trace task traces on a box build runner writes its own in
  <runner>\trace.

.PARAMETER Report
  A JUnit file for this share, as Nightly-Harnesses.ps1 -Report writes it:
  a test case for each check (#5295). build.yml's job "Gate report" merges
  every share's into one. A share with nothing to run writes one with no
  harnesses in it, so the merge still counts every share.

.PARAMETER Summary
  Where this run's checks go for a run's page, as Nightly-Harnesses.ps1
  -Summary writes them (#5295). The gate's shares leave that to the job
  "Gate report"; this is for a run of its own.
#>
[CmdletBinding()]
param(
    [int]$Shard = 1,
    [int]$Of = 1,
    [int]$Pick = 0,
    [int]$LinuxShares = 0,
    [int]$Throttle = 6,
    [int]$BudgetSeconds = 1800,
    [int]$AnswerSeconds = 60,
    [string]$StartLog = '',
    [ValidateSet('Windows', 'Linux')]
    [string]$Platform = 'Windows',
    [string]$Report = '',
    [string]$Summary = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$Affected = Join-Path $Here 'Affected-Harnesses.js'

function Say([string]$m) { Write-Host $m }
# For Gate-Map.ps1 -Fetch only: no harness gets it (#4009).
$mapToken = [string]$env:GATE_MAP_TOKEN
Remove-Item -LiteralPath Env:GATE_MAP_TOKEN -ErrorAction SilentlyContinue
function Set-StepOutput([string]$name, [string]$value) {
    if ($env:GITHUB_OUTPUT) { Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value ($name + '=' + $value) }
}
# Written whole and then renamed, so the task never reads half a file.
function Write-Whole([string]$file, [string]$text) {
    $tmp = $file + '.tmp'
    [IO.File]::WriteAllText($tmp, $text)
    Move-Item -LiteralPath $tmp -Destination $file -Force
}

if ($Pick -lt 0 -or $Of -lt 1 -or $Shard -lt 1 -or $Shard -gt $Of) { Write-Host "::error::-Shard $Shard -Of $Of names no share of the gate"; exit 2 }
$gate = @(& (Join-Path $Here 'Gate-Harnesses.ps1'))
if ($LASTEXITCODE -ne 0) { exit 1 }
# This build's share of the cores: the machine's cores over the builds this
# machine runs at once. On the box, the runners records\build-runners.json
# lists (#2994). On One, the off-box runners the runner records name for this
# machine: until 27 Oct 2026 One's builds took the box's count too, so each
# of its five took six of its 22 cores, thirty at once; run 40455516666 on
# thornswood-pr-one-5 had the cores 91% busy throughout and seven harnesses
# killed at their 300 s clock (#3860). On GitHub's hosted runner, one.
function Get-MachineBuilds {
    if ($env:RUNNER_ENVIRONMENT -eq 'github-hosted') { return 1 }
    $records = Join-Path $Repo 'records'
    if ([string]$env:RUNNER_NAME -like 'thornswood-pr-*') {
        $machine = $(if ($env:COMPUTERNAME) { [string]$env:COMPUTERNAME } else { [Environment]::MachineName })
        $mine = '^' + [regex]::Escape('thornswood-pr-' + $machine.ToLower()) + '(-\d+)?$'
        $named = @(Get-ChildItem -LiteralPath $records -Filter '*-runners.json' | ForEach-Object {
            $rec = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
            if ($rec.PSObject.Properties['offBox']) { @($rec.offBox) }
        } | ForEach-Object { [string]$_ } | Where-Object { $_ -match $mine } | Sort-Object -Unique)
        return [Math]::Max(1, $named.Count)
    }
    return @((Get-Content -LiteralPath (Join-Path $records 'build-runners.json') -Raw | ConvertFrom-Json).runners).Count
}
$builds = Get-MachineBuilds
$share = [Math]::Min(6, [Math]::Max(1, [Math]::Floor([Environment]::ProcessorCount / [Math]::Max(1, $builds))))
Say ('{0} build(s) at once on this machine, so {1} of its {2} cores are this one''s.' -f $builds, $share, [Environment]::ProcessorCount)

# The runner's own folder: RUNNER_TEMP is <runner>\_work\_temp there.
$root = ''
if ($env:RUNNER_ENVIRONMENT -eq 'self-hosted' -and $env:RUNNER_TEMP) { $root = Split-Path -Parent (Split-Path -Parent $env:RUNNER_TEMP) }

# The folder holding the newest map: this runner's own on the box, or
# main's nightly map fetched (gate-map.yml, #5183). '' when there is none,
# with $script:MapWhy saying why.
$script:MapWhy = ''
function Find-Map {
    $maps = $(if ($root) { Join-Path $root 'gate-map' } else { '' })
    if ($maps -and (Test-Path -LiteralPath (Join-Path $maps 'latest.json'))) { return $maps }
    $why = $(if ($maps) { 'there is no traced map in ' + $maps + ' yet' } else { 'this runner keeps no map of its own' })
    if (-not $env:RUNNER_TEMP) { $script:MapWhy = $why; return '' }
    $maps = Join-Path $env:RUNNER_TEMP 'gate-map-fetched'
    # The token goes in the environment for this call only, never on a
    # command line (#4079); Gate-Map.ps1 takes it out again at once.
    $env:GATE_MAP_TOKEN = $mapToken
    try { & (Join-Path $Here 'Gate-Map.ps1') -Fetch $maps 2>&1 | ForEach-Object { Say ([string]$_) } }
    finally { Remove-Item -LiteralPath Env:GATE_MAP_TOKEN -ErrorAction SilentlyContinue }
    if ($LASTEXITCODE -ne 0) { $script:MapWhy = $why + ', and main''s nightly gate map could not be fetched (the lines above say why)'; return '' }
    return $maps
}

# The map in a folder: its commit, traces or built map, and tree, with each
# harness's measured seconds in $script:Seconds. $null when it does not
# read, with $script:MapWhy saying why.
function Read-Map([string]$maps) {
    $latest = Join-Path $maps 'latest.json'
    try {
        $m = [IO.File]::ReadAllText($latest) | ConvertFrom-Json
        if ([string]$m.commit -notmatch '^[0-9a-f]{40}$' -or [string]$m.key -notmatch '^\d+-\d+$') { $script:MapWhy = $latest + ' names no commit and run'; return $null }
        $traces = Join-Path $maps ([string]$m.key + '.traces.jsonl.gz')
        # Off the box, the map main's nightly trace built from them (#4009).
        if (-not (Test-Path -LiteralPath $traces)) { $traces = Join-Path $maps ([string]$m.key + '.map.json') }
        $read = $m.read
        if ($read -is [datetime]) { $read = $read.ToUniversalTime().ToString('yyyy-MM-dd HH:mm') + ' UTC' }
        if ($traces -like '*.map.json') {
            $built = [IO.File]::ReadAllText($traces) | ConvertFrom-Json
            foreach ($h in $built.harnesses.PSObject.Properties) { if ($null -ne $h.Value.seconds) { $script:Seconds[$h.Name] = [double]$h.Value.seconds } }
        }
        Say ('The traced map: main ' + ([string]$m.commit).Substring(0, 8) + ', run ' + $m.key + ', read ' + $read + '.')
        # Which harnesses Linux runs as fully as Windows (#5293): the same
        # night's Linux run beside the trace, by Affected-Harnesses.js
        # platforms. With none, every harness runs on Windows.
        $pf = Join-Path $maps ([string]$m.key + '.platforms.json')
        if (Test-Path -LiteralPath $pf) {
            $plat = [IO.File]::ReadAllText($pf) | ConvertFrom-Json
            if ([string]$plat.commit -eq [string]$m.commit) {
                foreach ($h in $plat.harnesses.PSObject.Properties) { if ($h.Value.linux -eq $true) { $null = $script:OnLinux.Add($h.Name) } }
                Say ('{0} of its harnesses run on Linux as fully as on Windows, so they run on Linux.' -f $script:OnLinux.Count)
            } else { Say ('Its platforms file is of ' + [string]$plat.commit + ', not the map''s commit, so every harness runs on Windows.') }
        } else { Say 'It says nothing of Linux (no platforms file), so every harness runs on Windows.' }
        return [pscustomobject]@{ Commit = [string]$m.commit; Traces = $traces; Tree = (Join-Path $maps ([string]$m.key + '.tree.gz')) }
    } catch {
        $script:MapWhy = 'the traced map could not be used (' + $_.Exception.Message + ')'
        return $null
    }
}

# The harnesses a pull request's change can reach, or $null for the whole gate.
function Select-Affected {
    $maps = Find-Map
    if (-not $maps) { Say ('The whole gate runs: ' + $script:MapWhy + '.'); return $null }
    $map = Read-Map $maps
    if (-not $map) { Say ('The whole gate runs: ' + $script:MapWhy + '.'); return $null }
    try {
        $gateFile = Join-Path $env:RUNNER_TEMP 'gate.txt'
        $out = Join-Path $env:RUNNER_TEMP 'gate-picked.txt'
        [IO.File]::WriteAllLines($gateFile, [string[]]$gate)
        # Its lines to the log, not into this function's answer.
        & node $Affected pick $map.Traces $map.Tree $map.Commit $gateFile $out 2>&1 | ForEach-Object { Say ([string]$_) }
        if ($LASTEXITCODE -ne 0) { Say ('The whole gate runs: Affected-Harnesses.js pick failed (exit ' + $LASTEXITCODE + '), the lines above say why.'); return $null }
        $picked = @([IO.File]::ReadAllLines($out) | Where-Object { $_.Trim() })
        $strange = @($picked | Where-Object { $gate -notcontains $_ })
        if ($strange.Count) { Say ('The whole gate runs: pick named what is not on the gate: ' + ($strange -join ', ')); return $null }
        if ($picked.Count -ge $gate.Count) { return $null }
        return ,$picked
    } catch {
        Say ('The whole gate runs: the traced map could not be used (' + $_.Exception.Message + ').')
        return $null
    }
}

# Asks the trace task to trace this gate. Returns the ask, or $null when
# the gate runs untraced, having said why.
function Request-Trace {
    if (-not $root) { return $null }
    $dir = Join-Path $root 'trace'
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Say ('Not traced: there is no ' + $dir + ', so the trace task is not installed for this runner (Trace-Gate.ps1 -Install).'); return $null }
    $key = [string]$env:GITHUB_RUN_ID + '-' + [string]$env:GITHUB_RUN_ATTEMPT
    if ($key -notmatch '^\d+-\d+$') { Say 'Not traced: GitHub gave no run and attempt.'; return $null }
    foreach ($f in 'ask.json', 'answer.json', 'done.json', 'starts.jsonl', 'tree.gz') {
        Remove-Item -LiteralPath (Join-Path $dir $f) -Force -ErrorAction SilentlyContinue
    }
    & node $Affected tree HEAD (Join-Path $dir 'tree.gz') 2>&1 | ForEach-Object { Say ([string]$_) }
    if ($LASTEXITCODE -ne 0) { Say 'Not traced: the tree could not be listed for the map.'; return $null }
    $commit = (& git rev-parse HEAD | Out-String).Trim()
    if ($commit -notmatch '^[0-9a-f]{40}$') { Say ('Not traced: git gave no commit for HEAD (' + $commit + ').'); return $null }
    $me = [Diagnostics.Process]::GetCurrentProcess()
    $ask = [ordered]@{
        key = $key; commit = $commit; workspace = (Get-Location).Path
        pid = $me.Id; started = $me.StartTime.ToUniversalTime().ToString('o')
    }
    Write-Whole (Join-Path $dir 'ask.json') ($ask | ConvertTo-Json -Compress)
    $answer = Join-Path $dir 'answer.json'
    $until = [DateTime]::UtcNow.AddSeconds($AnswerSeconds)
    while ([DateTime]::UtcNow -lt $until) {
        if (Test-Path -LiteralPath $answer) {
            $a = $null
            try { $a = [IO.File]::ReadAllText($answer) | ConvertFrom-Json } catch { Say ('the trace task''s answer did not read yet: ' + $_.Exception.Message) }
            if ($a -and [string]$a.key -eq $key) {
                if ([string]$a.state -eq 'tracing') {
                    Say ('Traced: the trace task is tracing this gate (run ' + $key + ').')
                    return [pscustomobject]@{ Key = $key; Dir = $dir; Starts = (Join-Path $dir 'starts.jsonl') }
                }
                Say ('Not traced: ' + $a.why)
                return $null
            }
        }
        Start-Sleep -Milliseconds 500
    }
    Remove-Item -LiteralPath (Join-Path $dir 'ask.json') -Force -ErrorAction SilentlyContinue
    Say ('Not traced: the trace task did not answer in ' + $AnswerSeconds + ' s.')
    return $null
}

# The list split into $count shares: harness i to share (i mod count) + 1,
# or, with each harness's seconds from the map, the longest first, each to
# the share with the least so far (ties to the lowest share), so the shares
# end close together; a harness the map has no seconds for counts as the
# median. Each share's names in name order, and the loads in $script:Loads.
function Split-Shares([string[]]$list, [int]$count) {
    $parts = New-Object 'System.Collections.Generic.List[string][]' $count
    for ($k = 0; $k -lt $count; $k++) { $parts[$k] = New-Object 'System.Collections.Generic.List[string]' }
    $load = New-Object double[] $count
    if (-not $script:Seconds.Count) {
        for ($i = 0; $i -lt $list.Count; $i++) { $parts[$i % $count].Add($list[$i]) }
    } else {
        $known = @($script:Seconds.Values | Sort-Object)
        $guess = $known[[int][Math]::Floor($known.Count / 2)]
        $sized = @($list | ForEach-Object { [pscustomobject]@{ Name = $_; Secs = $(if ($script:Seconds.ContainsKey($_)) { $script:Seconds[$_] } else { $guess }) } } |
            Sort-Object @{ Expression = 'Secs'; Descending = $true }, @{ Expression = 'Name'; Descending = $false })
        foreach ($h in $sized) {
            $to = 0
            for ($k = 1; $k -lt $count; $k++) { if ($load[$k] -lt $load[$to]) { $to = $k } }
            $load[$to] += $h.Secs
            $parts[$to].Add($h.Name)
        }
    }
    $script:Loads = $load
    $out = New-Object 'object[]' $count
    for ($k = 0; $k -lt $count; $k++) { $out[$k] = [string[]]@($parts[$k] | Sort-Object) }
    return ,$out
}

$script:Seconds = @{}
$script:OnLinux = [System.Collections.Generic.HashSet[string]]::new()
$run = $gate
$whole = $true
$trace = $null
if ($Pick -gt 0) {
    # THE PICK (#5183): one job before the shares picks and splits, so every
    # share runs its part of one list from one map. Each share fetching the
    # map itself could read two maps (a nightly trace ending between them)
    # or one could fail to fetch, and then a harness would run twice or in
    # no share at all.
    $list = $gate
    if ($env:GITHUB_EVENT_NAME -eq 'pull_request') {
        $picked = Select-Affected
        if ($null -ne $picked) { $list = $picked; $whole = $false }
    } else {
        # Main, the merge queue's run and a run by hand run the whole gate;
        # the map only times it. The queue's commit is the one that lands on
        # main (#5296), so its run is main's build, early.
        $maps = Find-Map
        if ($maps) { $null = Read-Map $maps }
    }
    # WHERE EACH RUNS (#5293). A harness the map says Linux runs as fully as
    # Windows goes to a Linux share, when there are any (-LinuxShares), and
    # every other to a Windows share. A Linux runner starts sooner and costs
    # nothing more on a public repository.
    $toLinux = @()
    if ($LinuxShares -gt 0) { $toLinux = @($list | Where-Object { $script:OnLinux.Contains($_) }) }
    $toWindows = @($list | Where-Object { $toLinux -notcontains $_ })
    # At most that many shares each, and no more than there are harnesses to
    # run (#5292): a share with nothing in it still waited for a runner of its
    # own, about a minute, to run nothing. A change that reaches none on a
    # platform gets no share there, [] for its matrix, and build.yml skips
    # that job.
    function Split-For([string[]]$names, [int]$most, [string]$where) {
        $n = [Math]::Min($most, $names.Count)
        if ($n -eq 0) {
            Say ('No gate harness of this change''s runs on ' + $where + ', so no ' + $where + ' runner is started for the gate.')
            return [pscustomobject]@{ Of = 0; Parts = @() }
        }
        $parts = Split-Shares $names $n
        if ($n -lt $most) { Say ('{0}: {1} share(s), not {2}: there are only {1} harness(es) to run there.' -f $where, $n, $most) }
        for ($k = 0; $k -lt $n; $k++) {
            $secs = $(if ($script:Seconds.Count) { (' about {0:N0} s' -f $script:Loads[$k]) } else { '' })
            Say ('{0} share {1} of {2}: {3} harnesses{4}.' -f $where, ($k + 1), $n, $parts[$k].Count, $secs)
        }
        return [pscustomobject]@{ Of = $n; Parts = $parts }
    }
    if ($script:Seconds.Count) { Say ('Split by the seconds each took when traced.') }
    else { Say ('Split by place in the list, with no seconds to split by: ' + $(if ($script:MapWhy) { $script:MapWhy } else { 'the map holds none' }) + '.') }
    $w = Split-For $toWindows $Pick 'Windows'
    $l = Split-For $toLinux $LinuxShares 'Linux'
    Say ('{0} of the gate''s {1} harnesses run, {2}: {3} on Windows, {4} on Linux.' -f $list.Count, $gate.Count, $(if ($whole) { 'the whole gate' } else { 'what this change can reach' }), $toWindows.Count, $toLinux.Count)
    $plan = [ordered]@{ of = $w.Of; whole = $whole; gate = $gate.Count; shares = $w.Parts; linux = [ordered]@{ of = $l.Of; shares = $l.Parts } }
    Set-StepOutput 'plan' ($plan | ConvertTo-Json -Compress -Depth 5)
    Set-StepOutput 'shares' $(if ($w.Of -eq 0) { '[]' } else { '[' + ((1..$w.Of) -join ',') + ']' })
    Set-StepOutput 'linux_shares' $(if ($l.Of -eq 0) { '[]' } else { '[' + ((1..$l.Of) -join ',') + ']' })
    Set-StepOutput 'whole' $(if ($whole) { 'true' } else { 'false' })
    exit 0
}
if ($Of -gt 1 -or [string]$env:GATE_PLAN) {
    # A share. With the pick's plan in GATE_PLAN, its part of that; without
    # one, its part of the whole gate by place in the list. A share never
    # fetches a map or asks for a trace: a trace has to see every harness on
    # one machine (gate-map.yml). Since #5292 the pick makes one share when
    # the change reaches one harness, so a plan makes this a share whatever
    # -Of says: share 1 of 1 runs the plan's one part, and never fetches a
    # map for itself.
    $planText = [string]$env:GATE_PLAN
    if ($planText) {
        try { $plan = $planText | ConvertFrom-Json } catch { Write-Host ('::error::the pick''s plan does not read: ' + $_.Exception.Message); exit 1 }
        # This share's part: the plan's Windows shares, or with -Platform
        # Linux its Linux ones (#5293). A plan with no Linux part has none.
        $mine = $plan
        if ($Platform -eq 'Linux') { $mine = $(if ($plan.PSObject.Properties['linux']) { $plan.linux } else { [pscustomobject]@{ of = 0; shares = @() } }) }
        if ([int]$mine.of -ne $Of) { Write-Host ('::error::the pick''s plan is for ' + $mine.of + ' shares on ' + $Platform + ', and this is a share of ' + $Of); exit 1 }
        if ([int]$plan.gate -ne $gate.Count) { Write-Host ('::error::the pick''s plan was made from a gate of ' + $plan.gate + ' harnesses, and this checkout''s has ' + $gate.Count); exit 1 }
        $all = [System.Collections.Generic.List[string]]::new()
        foreach ($p in @($plan.shares)) { foreach ($n in @($p)) { if ($null -ne $n) { $all.Add([string]$n) } } }
        if ($plan.PSObject.Properties['linux']) { foreach ($p in @($plan.linux.shares)) { foreach ($n in @($p)) { if ($null -ne $n) { $all.Add([string]$n) } } } }
        $all = @($all)
        $strange = @($all | Where-Object { $gate -notcontains $_ })
        if ($strange.Count) { Write-Host ('::error::the pick''s plan names what is not on this checkout''s gate: ' + ($strange -join ', ')); exit 1 }
        if (@($all | Sort-Object -Unique).Count -ne $all.Count) { Write-Host '::error::the pick''s plan puts a harness in two shares'; exit 1 }
        $whole = [bool]$plan.whole
        if ($whole -and $all.Count -ne $gate.Count) { Write-Host ('::error::the pick''s plan says whole and holds ' + $all.Count + ' of the gate''s ' + $gate.Count); exit 1 }
        $run = @(foreach ($n in @(@($mine.shares)[$Shard - 1])) { if ($null -ne $n) { [string]$n } })
        Say ('{0}Share {1} of {2} of {3}: {4} of its {5} harnesses, as the job "Pick the gate harnesses" split them (its log says why each runs).' -f $(if ($Platform -eq 'Linux') { 'Linux ' } else { '' }), $Shard, $Of, $(if ($whole) { 'the whole gate' } else { 'what this change can reach' }), $run.Count, $all.Count)
    } else {
        $run = (Split-Shares $gate $Of)[$Shard - 1]
        Say ('Share {0} of {1} of the whole gate: {2} of its {3} harnesses.' -f $Shard, $Of, $run.Count, $gate.Count)
    }
} elseif ($env:GITHUB_EVENT_NAME -eq 'pull_request') {
    $picked = Select-Affected
    if ($null -ne $picked) { $run = $picked; $whole = $false }
} elseif ($env:GITHUB_EVENT_NAME -eq 'push' -and $env:GITHUB_REF -eq 'refs/heads/main') {
    $trace = Request-Trace
}

$code = 0
$title = $(if ($Of -gt 1) { 'Gate harnesses, share {0} of {1}' -f $Shard, $Of } else { 'Gate harnesses' })
if ($run.Count) {
    $with = @{ Only = ($run -join ' '); Throttle = $Throttle; Share = $share; BudgetSeconds = $BudgetSeconds }
    if ($trace) { $with.StartLog = $trace.Starts } elseif ($StartLog) { $with.StartLog = $StartLog }
    if ($Report) { $with.Report = $Report }
    if ($Summary) { $with.Summary = $Summary; $with.Title = $title }
    & (Join-Path $Here 'Nightly-Harnesses.ps1') @with
    $code = $LASTEXITCODE
} else {
    Say 'No gate harness can be affected by this change, so none runs.'
    if ($Report) {
        $full = [IO.Path]::GetFullPath($Report)
        New-Item -ItemType Directory -Path (Split-Path -Parent $full) -Force | Out-Null
        [IO.File]::WriteAllText($full, '<?xml version="1.0" encoding="utf-8"?>' + "`n" + '<testsuites name="harnesses" tests="0" failures="0" skipped="0" time="0"></testsuites>' + "`n")
    }
    if ($Summary) { [IO.File]::AppendAllText([IO.Path]::GetFullPath($Summary), "## $title`n`nNo gate harness can be affected by this change, so none ran.`n") }
}
if ($trace) {
    Write-Whole (Join-Path $trace.Dir 'done.json') (([ordered]@{ key = $trace.Key; code = $code }) | ConvertTo-Json -Compress)
    Say 'The trace task reads the trace at low priority now and leaves the map for pull requests; this build does not wait for it.'
}
if ($whole) { Set-StepOutput 'whole' 'true' }
exit $code
