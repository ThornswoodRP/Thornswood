<#
.SYNOPSIS
  The trace task on the VPS: traces every main build's gate as it runs and
  leaves the map pull requests are held to in each build runner's folder
  (#3114).

.DESCRIPTION
  Not run by hand. scripts\dev\Trace-Gate.ps1 -Install puts it and
  Trace-Gate-Box.ps1 in C:\Thornswood-Trace\task, which only administrators
  can read, and registers the scheduled task Thornswood Gate Trace, which
  runs it as SYSTEM from the box's start, at below normal priority. Windows
  PowerShell 5.1 runs it. -Status says what it is doing and -Uninstall
  takes it off.

  WHY. Patrick chose on 22 Oct 2026 (option A on his page,
  q-3114-map-refresh) to trace every main build, so a pull request's change
  is measured from a map that is never more than a merge or two old: one 2
  merges old ran 48% of the gate's harness time over the last 40 merges, a
  fresh one 33%, one 10 old 89%. Only an administrator can start the trace
  session, and a build runs as its runner's own account, so the build asks
  and this task does it.

  HOW A BUILD ASKS. Through the runner's own folder, <runner>\trace, which
  its account may write (scripts\dev\Run-Gate.ps1 says what each file is).
  The task looks every two seconds in the folders of the build runners
  task.json names (records\build-runners.json when it was installed), and
  in no other:
    ask.json  taken, read as data and deleted. It is refused unless it names
              a run, a full commit, a checkout inside that runner's own _work
              folder that is no link to somewhere else, and a process that
              is running and started when it says; and unless that run was
              never asked for before. The answer goes in answer.json.
    One trace at a time. An ask while one runs is refused, so that build
    runs untraced; unless the process that asked for the running one has
    ended without saying its gate did, which is a main build cancelled by
    the next merge, and then that trace is dropped and the new one starts.
    done.json the gate ended: the start log and the tree are copied into the
              trace's own folder at once, the session is stopped, and a trace
              that lost any event is dropped. Otherwise it is read.
  A trace is also dropped when its build's process ends without done.json,
  and when it runs past 45 minutes. The session's file stops at 12 GB, which
  loses events, so a trace that big is dropped too; a trace starts only with
  20 GB free on C:.

  THE READ. In a process of its own (this script, -Read <folder>) at below
  normal priority, so it takes only what the builds and the game servers
  leave: about ten minutes of one core for a whole gate. One read at a
  time; when more traces are waiting, only the newest is read, since an
  older map is as true and only wider. It keeps only paths inside the
  build's checkout (Trace-Gate-Box.ps1 says how), writes the traces and the
  tree to every build runner's <runner>\gate-map, then latest.json naming
  them, keeps the newest three there, and deletes the trace. gate-map is
  locked so the runner's account may read it and nothing more: a job cannot
  change the map another pull request is held to.

  What it does goes in C:\Thornswood-Trace\task.log, one line a thing, in
  UTC. A trace sees every file name on the box, so it stays in
  C:\Thornswood-Trace\main, which only administrators can read, until it
  is read and deleted.

.PARAMETER Read
  Only the read of one finished trace, in the folder named: what the task
  starts for each one.
#>
param([string]$Read = '')

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$TraceMode = 'library'
$loaded = @(. (Join-Path $Here 'Trace-Gate-Box.ps1'))
$work = Join-Path $traceRoot 'main'
$seenFile = Join-Path $Here 'seen.txt'
$MaxMinutes = 45
$MaxFileMb = 12288
$MinFreeGb = 20
$KeepMaps = 3
$runners = @(([IO.File]::ReadAllText((Join-Path $Here 'task.json')) | ConvertFrom-Json).runners)

function Log([string]$m) {
    $line = [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss') + 'Z ' + $(if ($Read) { '[read] ' } else { '' }) + $m
    # The loop and a read write here at once now and then.
    for ($i = 0; $i -lt 5; $i++) {
        try {
            if ((Test-Path -LiteralPath $taskLog) -and (Get-Item -LiteralPath $taskLog).Length -gt 4MB) { Move-Item -LiteralPath $taskLog -Destination ($taskLog + '.1') -Force }
            [IO.File]::AppendAllText($taskLog, $line + "`r`n")
            return
        } catch { Start-Sleep -Milliseconds 200 }
    }
}

# ---- the read of one trace ----------------------------------------------------

# The map for each build runner: the traces and the tree under the run's
# key, then latest.json naming them, written whole and renamed into place.
function Publish-Map($w, [string]$key, [byte[]]$traces, [byte[]]$tree, $meta) {
    $dir = Join-Path $w.root 'gate-map'
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Log ('there is no ' + $dir + ', so ' + $w.root + ' gets no map (Trace-Gate.ps1 -Install makes it)'); return }
    [IO.File]::WriteAllBytes((Join-Path $dir ($key + '.traces.jsonl.gz')), $traces)
    [IO.File]::WriteAllBytes((Join-Path $dir ($key + '.tree.gz')), $tree)
    $tmp = Join-Path $dir 'latest.json.tmp'
    [IO.File]::WriteAllText($tmp, ($meta | ConvertTo-Json -Compress))
    Move-Item -LiteralPath $tmp -Destination (Join-Path $dir 'latest.json') -Force
    # The newest few, so a pull request that read latest.json just before
    # still finds the files it named.
    $keys = @(Get-ChildItem -LiteralPath $dir -Filter '*.traces.jsonl.gz' | Sort-Object LastWriteTimeUtc -Descending | ForEach-Object { $_.Name -replace '\.traces\.jsonl\.gz$', '' })
    foreach ($k in @($keys | Select-Object -Skip $KeepMaps)) {
        Remove-Item -LiteralPath (Join-Path $dir ($k + '.traces.jsonl.gz')), (Join-Path $dir ($k + '.tree.gz')) -Force -ErrorAction SilentlyContinue
    }
}

if ($Read) {
    [Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal'
    $code = 0
    $key = Split-Path -Leaf $Read
    try {
        $ask = [IO.File]::ReadAllText((Join-Path $Read 'ask.json')) | ConvertFrom-Json
        $began = [DateTime]::UtcNow
        $r = Read-GateTrace (Join-Path $Read 'gate.etl') ([IO.File]::ReadAllText((Join-Path $Read 'starts.jsonl'))) ([string]$ask.workspace)
        foreach ($l in $r.Lines) { Log ($key + ' ' + $l) }
        $traces = ConvertTo-Gzip $r.Bytes
        $tree = [IO.File]::ReadAllBytes((Join-Path $Read 'tree.gz'))
        $meta = [ordered]@{
            key = $key; commit = [string]$ask.commit; read = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
            harnesses = $r.Count; seconds = [Math]::Round(([DateTime]::UtcNow - $began).TotalSeconds)
        }
        foreach ($w in $runners) { Publish-Map $w $key $traces $tree $meta }
        Log ($key + ' the map of ' + $ask.commit + ' is out: ' + $r.Count + ' harnesses, read in ' + $meta.seconds + ' s')
    } catch {
        Log ($key + ' the read failed, so this commit leaves no map: ' + $_.Exception.Message)
        $code = 1
    } finally {
        Remove-Item -LiteralPath $Read -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit $code
}

# ---- the loop ---------------------------------------------------------------

function Add-Seen([string]$key) {
    $null = $script:seen.Add($key)
    [IO.File]::AppendAllText($seenFile, $key + "`r`n")
}

# The asking process, by its id and its start time, so an id used again by
# something else is not taken for it.
function Test-Alive($a) {
    $p = Get-Process -Id $a.Pid -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    try { return ([Math]::Abs(($p.StartTime.ToUniversalTime() - $a.StartedUtc).TotalSeconds) -lt 2) }
    catch { Log ('the start of process ' + $a.Pid + ' could not be read: ' + $_.Exception.Message); return $false }
}

function Send-Answer($w, [string]$key, [string]$state, [string]$why) {
    $f = Join-Path $w.root 'trace\answer.json'
    $tmp = $f + '.tmp'
    [IO.File]::WriteAllText($tmp, (([ordered]@{ key = $key; state = $state; why = $why }) | ConvertTo-Json -Compress))
    Move-Item -LiteralPath $tmp -Destination $f -Force
    Log ($w.root + ' run ' + $key + ': ' + $state + $(if ($why) { ', ' + $why } else { '' }))
}

# A link anywhere from the runner's _work folder, itself included, down to
# the checkout.
function Test-Linked([string]$under, [string]$full) {
    $p = $full
    while ($p.Length -ge $under.Length - 1) {
        if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
        $p = Split-Path -Parent $p
    }
    return $false
}

# An ask, taken and checked. Key is '' when it names no run to answer;
# Why says what is wrong with it, '' when nothing is.
function Get-Ask($w) {
    $f = Join-Path $w.root 'trace\ask.json'
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    $text = [IO.File]::ReadAllText($f)
    Remove-Item -LiteralPath $f -Force
    $a = [pscustomobject]@{ W = $w; Key = ''; Commit = ''; Workspace = ''; Pid = 0; StartedUtc = [DateTime]::MinValue; Why = '' }
    if ($text.Length -gt 4096) { $a.Why = 'it is longer than any ask'; return $a }
    $o = $null
    try { $o = $text | ConvertFrom-Json } catch { $a.Why = 'it is not JSON'; return $a }
    if ([string]$o.key -notmatch '^\d{1,20}-\d{1,5}$') { $a.Why = 'it names no run'; return $a }
    $a.Key = [string]$o.key
    if ($script:seen.Contains($a.Key)) { $a.Why = 'that run was asked for once already'; return $a }
    if ([string]$o.commit -notmatch '^[0-9a-f]{40}$') { $a.Why = 'it names no full commit'; return $a }
    $a.Commit = [string]$o.commit
    if ([string]$o.pid -notmatch '^\d{1,9}$') { $a.Why = 'it names no process'; return $a }
    $a.Pid = [int]$o.pid
    # A string in Windows PowerShell 5.1, already a date in 7.
    if ($o.started -is [datetime]) { $a.StartedUtc = $o.started.ToUniversalTime() }
    else {
        try { $a.StartedUtc = [DateTime]::Parse([string]$o.started, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() }
        catch { $a.Why = 'its process start is no time'; return $a }
    }
    $under = $w.root.TrimEnd('\') + '\_work\'
    $ws = [string]$o.workspace
    $full = ''
    try { $full = [IO.Path]::GetFullPath($ws).TrimEnd('\') } catch { $a.Why = 'its checkout is no path'; return $a }
    if ($full -ne $ws.TrimEnd('\') -or -not $full.StartsWith($under, [StringComparison]::OrdinalIgnoreCase) -or $full.Length -le $under.Length -or
        -not (Test-Path -LiteralPath $full -PathType Container)) { $a.Why = 'its checkout is not a folder in ' + $under; return $a }
    if (Test-Linked $under $full) { $a.Why = 'its checkout is reached through a link'; return $a }
    $a.Workspace = $full
    return $a
}

function Start-MainTrace($a) {
    $free = (Get-PSDrive C).Free
    if ($free -lt $MinFreeGb * 1GB) { Send-Answer $a.W $a.Key 'refused' ('only ' + [Math]::Round($free / 1GB, 1) + ' GB free on C:, under the ' + $MinFreeGb + ' GB a trace and the read before it may need'); return $null }
    Add-Seen $a.Key
    $dir = Join-Path $work $a.Key
    $null = New-Item -ItemType Directory -Force -Path $dir
    $etl = Join-Path $dir 'gate.etl'
    foreach ($l in @(Start-TraceSession $mainSession $etl $MaxFileMb)) { Log ($a.Key + ' ' + $l) }
    [IO.File]::WriteAllText((Join-Path $dir 'ask.json'), (([ordered]@{ key = $a.Key; commit = $a.Commit; workspace = $a.Workspace; runner = $a.W.root }) | ConvertTo-Json -Compress))
    Send-Answer $a.W $a.Key 'tracing' ''
    return [pscustomobject]@{ Ask = $a; Dir = $dir; Began = [DateTime]::UtcNow }
}

function Stop-Active([string]$why) {
    $null = [ThornswoodTrace]::Stop($mainSession)
    Remove-Item -LiteralPath $script:active.Dir -Recurse -Force -ErrorAction SilentlyContinue
    Log ($script:active.Ask.Key + ' dropped, so this commit leaves no map: ' + $why)
    $script:active = $null
}

# The gate ended: what the build left is copied into the trace's own folder
# before another job on that runner can write there, and the session stops.
function Complete-Active($d) {
    $a = $script:active.Ask
    $t = Join-Path $a.W.root 'trace'
    Log ($a.Key + ' the gate ended, exit ' + $d.code)
    foreach ($f in 'starts.jsonl', 'tree.gz') {
        $src = Join-Path $t $f
        if (-not (Test-Path -LiteralPath $src)) { Stop-Active ('the build left no ' + $f); return }
        if ((Get-Item -LiteralPath $src).Length -gt 64MB) { Stop-Active ($f + ' is bigger than any gate''s'); return }
        Copy-Item -LiteralPath $src -Destination (Join-Path $script:active.Dir $f) -Force
    }
    Remove-Item -LiteralPath (Join-Path $t 'done.json') -Force -ErrorAction SilentlyContinue
    foreach ($l in @(Stop-TraceSession $mainSession)) { Log ($a.Key + ' ' + $l) }
    if ($script:lost) { Stop-Active ([string]$script:lost + ' events were lost, so some opens were never seen'); return }
    [void]$script:queue.Add($script:active.Dir)
    $script:active = $null
}

# One read at a time, of the newest trace waiting.
function Step-Reader {
    if ($script:reader) {
        if (-not $script:reader.HasExited) { return }
        Log ((Split-Path -Leaf $script:readDir) + ' read, exit ' + $script:reader.ExitCode)
        Remove-Item -LiteralPath $script:readDir -Recurse -Force -ErrorAction SilentlyContinue
        $script:reader = $null
    }
    if (-not $script:queue.Count) { return }
    $next = [string]$script:queue[$script:queue.Count - 1]
    foreach ($old in @($script:queue | Select-Object -First ($script:queue.Count - 1))) {
        Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
        Log ((Split-Path -Leaf $old) + ' not read: a newer trace is waiting, and its map is as true and narrower')
    }
    $script:queue.Clear()
    $script:readDir = $next
    $script:reader = Start-Process -FilePath pwsh.exe -PassThru -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-Read', ('"' + $next + '"'))
    # Held now, or the exit code is gone by the time it is asked for.
    $null = $script:reader.Handle
    Log ('reading ' + (Split-Path -Leaf $next) + ' at below normal priority')
}

# One copy only: a second one started by hand leaves at once.
$mutex = New-Object Threading.Mutex($false, 'Global\thornswood-gate-trace-task')
if (-not $mutex.WaitOne(0)) { exit 0 }

$script:active = $null
$script:reader = $null
$script:readDir = ''
$script:queue = New-Object System.Collections.ArrayList
$script:seen = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path -LiteralPath $seenFile) {
    $keep = @([IO.File]::ReadAllLines($seenFile) | Where-Object { $_ } | Select-Object -Last 1000)
    foreach ($k in $keep) { $null = $script:seen.Add($k) }
    [IO.File]::WriteAllLines($seenFile, [string[]]$keep)
}
# A trace this task was stopped in the middle of cannot be finished.
$null = [ThornswoodTrace]::Stop($mainSession)
if (Test-Path -LiteralPath $work) { Get-ChildItem -LiteralPath $work | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
$null = New-Item -ItemType Directory -Force -Path $work
foreach ($l in $loaded) { Log $l }
Log ('started, watching ' + (@($runners | ForEach-Object { $_.root + '\trace' }) -join ', '))

while ($true) {
    try {
        foreach ($w in $runners) {
            $a = Get-Ask $w
            if (-not $a) { continue }
            if (-not $a.Key) { Log ($w.root + ' an ask was refused: ' + $a.Why); continue }
            if ($a.Why) { Send-Answer $w $a.Key 'refused' $a.Why; continue }
            if ($script:active) {
                if (Test-Alive $script:active.Ask) { Send-Answer $w $a.Key 'refused' ('the box is tracing run ' + $script:active.Ask.Key + ' already'); continue }
                Stop-Active ('its build ended without saying its gate did (cancelled by a newer build, most likely), and run ' + $a.Key + ' asked')
            }
            if (-not (Test-Alive $a)) { Send-Answer $w $a.Key 'refused' 'the process that asked is not running'; continue }
            try { $script:active = Start-MainTrace $a }
            catch {
                $null = [ThornswoodTrace]::Stop($mainSession)
                $script:active = $null
                Send-Answer $w $a.Key 'refused' ('the trace did not start: ' + $_.Exception.Message)
            }
        }
        if ($script:active) {
            $doneFile = Join-Path $script:active.Ask.W.root 'trace\done.json'
            $d = $null
            if (Test-Path -LiteralPath $doneFile) {
                try { $d = [IO.File]::ReadAllText($doneFile) | ConvertFrom-Json } catch { Log ('done.json did not read yet: ' + $_.Exception.Message) }
            }
            if ($d -and [string]$d.key -eq $script:active.Ask.Key) { Complete-Active $d }
            elseif (-not (Test-Alive $script:active.Ask)) { Stop-Active 'its build ended without saying its gate did (cancelled by a newer build, most likely)' }
            elseif (([DateTime]::UtcNow - $script:active.Began).TotalMinutes -gt $MaxMinutes) { Stop-Active ('it ran past ' + $MaxMinutes + ' minutes') }
        }
        Step-Reader
    } catch {
        Log ('error: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage)
        if ($script:active) {
            try { Stop-Active 'the task hit the error above' } catch { Log ('and the trace could not be dropped: ' + $_.Exception.Message); $script:active = $null }
        }
    }
    Start-Sleep -Seconds 2
}
