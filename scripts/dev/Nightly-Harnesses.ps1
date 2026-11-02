<#
.SYNOPSIS
  Runs one share of the test harnesses for the nightly checks, or the ones it is named, one at a time or a few side by side, each on a clock, and always ends by naming every harness that failed and the ten slowest, inside the time it is given.

.DESCRIPTION
  Run by .github/workflows/nightly.yml once for each of its harness jobs:

      .\scripts\dev\Nightly-Harnesses.ps1 -Shard 1 -Of 2
      .\scripts\dev\Nightly-Harnesses.ps1 -Shard 2 -Of 2

  The harnesses are every test-*.js and test-*.ps1 in tests\ and in each
  product's own tests folder (launcher\tests\, voice\tests\), as
  scripts\dev\Harness-Files.ps1 lists and names them, in name order. Harness number n (from 0) belongs to share
  (n mod Of) + 1, so every harness is in exactly one share and the slow ones
  spread out by name.

  ONE AT A TIME, timed, within a share. Run in parallel inside one step on
  25 September the step hung for twenty minutes where one at a time it
  finished in five and a half: every harness's output went through one pipe,
  and a process one of them left running held it open. Each harness here is
  a process of its own with its output in files of its own, so the shares run
  side by side on separate runners (separate accounts, separate TEMP), the
  way several Launcher builds jobs have run side by side since #1690; the
  harnesses take their ports from the system for that reason (#1703, #1727,
  #1755, #1973).

  EACH ON A CLOCK, and printed the moment it ends. On 26 and 28 September the
  step ran until the job's 45 minutes were up and was cancelled with nothing
  in the log, because every harness's output was held until all of them had
  finished, and one never did. Each harness gets 300 seconds; past that it
  and everything it started are killed and it is named as timed out, and the
  rest still run. A harness whose own cases take longer says so in its
  header, with its measured time beside it ("NIGHTLY CLOCK: 600 seconds"),
  and gets that clock instead, never more than 600 (#1273).

  A LONGER CLOCK OFF THE BOX (#4981). A few heavy harnesses take several
  times as long on One's runners as on the box, and are named in
  $OFF_BOX_CLOCK below with the clock they get there, never more than 600.
  test-2914-nexus-scripts.ps1 starts about 390 processes: 37.5 s on the box,
  122 to 162 s on One's idle runner, and killed at 300 s there on 30 Oct 2026
  with a build beside it, Defender scanning each process start. A runner is
  off the box when its name is thornswood-pr-*, the way Run-Gate.ps1 tells
  them apart: Install-Runner.ps1 -OffBox names One's runners that way, and
  the box's are thornswood-vps-n. On the box, on GitHub's runner and off a
  runner every harness keeps its clock as before. The line a harness ends
  with and the summary say when it had the longer clock, and why.

  What a harness leaves running when it ends is killed too, and named.

  INSIDE ITS TIME (#2357). The job that runs this has 45 minutes and is
  cancelled past them, and a cancelled step prints nothing more: no list of
  what failed, no ten slowest. On 12 Oct the one harness step that ran them
  all took 43 minutes of the 45. So this is given a budget (-BudgetSeconds)
  and starts a harness only when its whole clock still fits inside it. A
  harness that does not fit is not run and is named as a failure, "not run,
  out of time", so a night that runs short is red and says which ones, and
  the summary is always printed. The cure for that line is another share in
  nightly.yml, not a longer budget.

  SIDE BY SIDE WHEN ASKED (#3114). -Throttle N runs up to N harnesses at
  once, each still a process of its own with its output in files of its own
  and printed the moment it ends, so no pipe is shared and nothing one leaves
  running can hold the step. The pull request gate (build.yml, "Run the gate
  harnesses") runs its list this way through -Only: one at a time, its 550
  harnesses took 26 of a 28 minute build on 21 Oct 2026, most of it waiting
  on timers and child processes rather than working. Harnesses side by side
  share the runner's account, so its TEMP, its profile and the checkout. One
  that writes where another reads says so in its header, with why
  ("RUNS ALONE: it builds the launcher into the checkout's out folder"), and
  runs after the rest with nothing of this run beside it.

  On Windows each harness is in a job object of its own, so the summary also
  says how much processor time the harnesses and all their children used and
  how many processes they started, and the machine's processor is read over
  the whole run.

  A SHARE, AND MORE ONLY INTO FREE CORES (#3114, 22 Oct 2026). Up to -Share
  run at once whatever the machine is doing: that is this run's part of the
  cores beside the other builds the machine runs at once. Past it, up to
  -Throttle, another starts only into a core the machine has free: the
  processor is read every half second, and after each reading no more of
  those start than it had cores idle. So a build alone on the box uses the
  cores the others would have, and once another build arrives and the cores
  fill, this one is back to its share as its extra harnesses end, and
  neither takes the other's. #3106's build at 519b986 on 21 Oct ran 3 at a
  time beside #3190's at 6 and others, with the box 99.9% busy: #3106's
  harnesses got 1472 s of processor in 1592 s, under one core, #3190's 1475 s
  in 737 s, and 30 of #3106's never started inside its 1800 s. The summary
  says how many ran at once, at most and on average.

  NAMED HARNESSES ON DEMAND (#2970). .github/workflows/harnesses.yml runs
  the harnesses somebody names, on the same Windows runners and the same
  way, so a harness that needs Windows PowerShell is run from a cloud
  session by dispatching that workflow, with no login on the box:

      .\scripts\dev\Nightly-Harnesses.ps1 -Only 'test-deploy-swaps.ps1 voice/tests/test-most.js'

  -Only takes the names as the nightly prints them, split by spaces or
  commas, and runs those in place of a share. A name that is no harness here
  is refused before anything runs (exit 2), so a typo is never a green run.

  ONE REPORT, A TEST CASE PER CHECK (#5295). With -Report it also writes a
  JUnit file: a test suite for each harness, and in it a test case for each
  line the harness printed starting PASS, FAIL, SKIP or NOT RUN, the
  contract every harness keeps (tests\README.md). A harness that failed
  with no FAIL line of its own (it threw, it timed out, it was not run, out
  of time) gets one failing case saying so, with the end of what it
  printed, so the report holds every failure the summary names.
  scripts\dev\Merge-HarnessReports.ps1 merges every share's into one report
  for the run and writes the failing checks, by name, to the run's summary.
  Before this a red run named a file, and the reader looked through its log
  for the line. Measured on 1 Nov 2026, the gate's 453 .js harnesses four
  at once took 157 s under node --test and 156 s here, so the runner stays
  and only the results gained a structure.

  With -Summary (build.yml's gate, nightly.yml and harnesses.yml pass
  GITHUB_STEP_SUMMARY) it also hands its report to
  Merge-HarnessReports.ps1, which writes how many checks ran and every
  failing one, by harness, on the run's page: one section a share, all on
  the one page. Asked for by name, never read from the environment, since
  harnesses that run this against stand-ins run inside a real run, and
  their stand-in results must not reach its page. No artifact is kept: the
  builds keep none (#3399), and the page is where a reader looks.

  tests\test-nightly-harnesses.ps1 runs this against stand-in harnesses.

.PARAMETER Shard
  Which share to run, from 1.

.PARAMETER Of
  How many shares there are. nightly.yml passes the length of its matrix.

.PARAMETER BudgetSeconds
  How long this may take in all. A harness starts only when the time used so
  far plus its clock is no more than this. nightly.yml gives 2400 seconds of a
  45 minute job.

.PARAMETER Only
  Harness names to run in place of a share, split by spaces or commas
  (test-x.ps1, test-y.js, voice/test-z.js). Every one must be a harness
  here, or nothing runs and the exit is 2.

.PARAMETER Throttle
  The most harnesses at once, 1 to 16. 1, one at a time, unless asked.

.PARAMETER Share
  How many of those run at once whatever the machine is doing, 1 to
  -Throttle; the rest start only into free cores. -Throttle, all of them,
  unless asked. build.yml gives the box's cores over the builds it runs at
  once.

.PARAMETER StartLog
  A file to which a line of JSON is added as each harness starts (its name,
  its process id and when Windows says it started, in UTC) and as it ends
  (its exit code, its seconds, whether it said SKIP or NOT RUN, and since
  #5293 each such line it said, once, and how many lines it began with PASS
  or ok). A trace of the gate (gate-map.yml through
  scripts\dev\Trace-Gate-Here.ps1, #3114) reads it to know which process tree
  was which harness's; gate-map.yml compares a Windows run's lines with a
  Linux run's to know which harnesses Linux runs as fully as Windows.

.PARAMETER BusyFrom
  A file holding how busy the machine is, 0 to 100, read in place of its
  processor. Only tests\test-nightly-harnesses.ps1 sets it, to run the
  throttle against a machine it decides.

.PARAMETER Root
  The repository whose harnesses run. The one this script is in, unless a
  test points it at a copy.

.PARAMETER OutDir
  Where each harness's output is kept while it runs. harness-out under the
  runner's temp folder, or under TEMP off a runner.

.PARAMETER Report
  A JUnit file to write when the run ends: a test case for each check every
  harness printed, as above. None unless asked, or report.xml in -OutDir
  with -Summary.

.PARAMETER Summary
  A Markdown file to add the run's checks to, as above: GITHUB_STEP_SUMMARY
  on a runner. None unless asked.

.PARAMETER Title
  The heading of that section. "Harnesses, share n of m", or "Harnesses"
  with -Only, unless asked.
#>
[CmdletBinding()]
param(
    [int]$Shard = 1,
    [int]$Of = 1,
    [int]$BudgetSeconds = 2400,
    [string]$Only = '',
    [int]$Throttle = 1,
    [string]$Root = '',
    [string]$OutDir = '',
    [int]$Share = 0,
    [string]$BusyFrom = '',
    [string]$StartLog = '',
    [string]$Report = '',
    [string]$Summary = '',
    [string]$Title = ''
)

$ErrorActionPreference = 'Stop'
if ($Of -lt 1 -or $Shard -lt 1 -or $Shard -gt $Of) { Write-Host "::error::-Shard $Shard -Of $Of names no share"; exit 2 }
if ($Throttle -lt 1 -or $Throttle -gt 16) { Write-Host "::error::-Throttle $Throttle is not 1 to 16"; exit 2 }
if ($Share -eq 0) { $Share = $Throttle }
if ($Share -lt 1 -or $Share -gt $Throttle) { Write-Host "::error::-Share $Share is not 1 to -Throttle ($Throttle)"; exit 2 }
if ($StartLog) { $StartLog = [IO.Path]::GetFullPath($StartLog) }
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$Root = [IO.Path]::GetFullPath($Root)
if (-not $OutDir) {
    $base = $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() })
    $OutDir = Join-Path $base ('harness-out-' + $Shard)
}
if ($Summary -and -not $Report) { $Report = Join-Path $OutDir 'report.xml' }
if ($Report) { $Report = [IO.Path]::GetFullPath($Report) }
if ($Summary) { $Summary = [IO.Path]::GetFullPath($Summary) }
if (-not $Title) { $Title = $(if ($Only.Trim()) { 'Harnesses' } else { 'Harnesses, share {0} of {1}' -f $Shard, $Of }) }

$PER_HARNESS = 300
$MAX_CLOCK = 600
# The heavy harnesses and their clock on a runner off the box (#4981), at
# most $MAX_CLOCK. A harness here keeps its usual clock on the box.
$OFF_BOX_CLOCK = @{
    'test-2914-nexus-scripts.ps1' = 600
}
$offBox = [string]$env:RUNNER_NAME -like 'thornswood-pr-*'
function Head-Of($path) {
    $head = [IO.File]::ReadAllText($path)
    if ($head.Length -gt 8000) { $head = $head.Substring(0, 8000) }
    $head
}
function Clock-Of($head) {
    $m = [regex]::Match($head, '(?im)^[\s#/*<]*NIGHTLY CLOCK:\s*(\d+) seconds')
    if ($m.Success) { [Math]::Min([int]$m.Groups[1].Value, $MAX_CLOCK) } else { $PER_HARNESS }
}
function Alone-Of($head) { [regex]::IsMatch($head, '(?im)^[\s#/*<]*RUNS ALONE:\s*\S') }
# -StartLog: one line of JSON a start or an end, added as it happens.
function Write-StartLog($fields) {
    if (-not $StartLog) { return }
    [IO.File]::AppendAllText($StartLog, ((New-Object psobject -Property $fields) | ConvertTo-Json -Compress) + "`n")
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
# An empty file for stdin: no harness reads it, and one that tried would
# otherwise wait on the runner's for ever.
$nothing = Join-Path $OutDir 'stdin.empty'
Set-Content -Path $nothing -Value $null -NoNewline

# On Windows each harness runs in a job object of its own (#3114). Every
# process it starts is in that job however it was started and whether or not
# its parent is still there, so what it left running is the job's list, read
# once, and the job's accounting is the processor time the harness and all of
# its children used and how many processes it started. Walking parent ids
# from the harness's own id, which this did before, misses a child whose
# parent ended first, and with harnesses side by side could follow an id
# Windows had handed on to another harness's process.
#
# Off Windows (a cloud session running the harnesses, #2989) there is no job
# object, and a process whose parent ends is handed to init. There each
# harness is started with a mark of its own in its environment, which every
# process it starts inherits and no re-parenting takes away, and /proc says
# which processes hold it.
$onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
if ($onWindows) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HarnessJob {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, int length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetSystemTimes(out long idle, out long kernel, out long user);

    public static IntPtr Create() {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return job;
    }
    public static bool Assign(IntPtr job, IntPtr process) { return AssignProcessToJobObject(job, process); }
    // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION (class 1): processor time in
    // 100 ns ticks, user and kernel, and the processes the job has held.
    public static long[] Accounting(IntPtr job) {
        IntPtr b = Marshal.AllocHGlobal(48);
        try {
            if (!QueryInformationJobObject(job, 1, b, 48, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return new long[] { Marshal.ReadInt64(b, 0) + Marshal.ReadInt64(b, 8), Marshal.ReadInt32(b, 36) };
        } finally { Marshal.FreeHGlobal(b); }
    }
    // JOBOBJECT_BASIC_PROCESS_ID_LIST (class 3): the processes in it now.
    public static long[] Pids(IntPtr job) {
        int max = 4096, size = 8 + IntPtr.Size * max;
        IntPtr b = Marshal.AllocHGlobal(size);
        try {
            if (!QueryInformationJobObject(job, 3, b, size, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            int n = Marshal.ReadInt32(b, 4);
            long[] ids = new long[n];
            for (int i = 0; i < n; i++) ids[i] = Marshal.ReadIntPtr(b, 8 + IntPtr.Size * i).ToInt64();
            return ids;
        } finally { Marshal.FreeHGlobal(b); }
    }
    public static void Kill(IntPtr job) { TerminateJobObject(job, 1); }
    public static void Close(IntPtr job) { CloseHandle(job); }
    // The whole machine's processor time so far: idle, and all of it.
    public static long[] SystemTimes() {
        long idle, kernel, user;
        if (!GetSystemTimes(out idle, out kernel, out user)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return new long[] { idle, kernel + user };
    }
}
'@
}
function Get-Marked($mark) {
    $want = 'THORNSWOOD_NIGHTLY_RUN=' + $mark
    foreach ($d in [IO.Directory]::GetDirectories('/proc')) {
        $n = [IO.Path]::GetFileName($d)
        if ($n -notmatch '^\d+$' -or [int]$n -eq $PID) { continue }
        try { $env = [Text.Encoding]::Latin1.GetString([IO.File]::ReadAllBytes($d + '/environ')) }
        catch { continue <# it ended while being listed, or is not ours to read: neither is a harness's #> }
        if ($env.Split([char]0) -notcontains $want) { continue }
        $comm = ''
        try { $comm = [IO.File]::ReadAllText($d + '/comm').Trim() } catch { $comm = '(ended)' }
        [pscustomobject]@{ Id = [int]$n; Name = $comm }
    }
}

# The machine's processor, busy, as a share of all its cores between two
# readings: GetSystemTimes on Windows, the cpu line of /proc/stat elsewhere.
function Read-Cpu {
    if ($onWindows) { $t = [HarnessJob]::SystemTimes(); return @{ Idle = $t[0]; All = $t[1] } }
    $f = @(([IO.File]::ReadAllLines('/proc/stat')[0] -split '\s+') | Select-Object -Skip 1 | Where-Object { $_ } | ForEach-Object { [long]$_ })
    $all = 0L; foreach ($v in @($f | Select-Object -First 8)) { $all += $v }
    @{ Idle = $f[3] + $f[4]; All = $all }
}
function Busy-Between($a, $b) {
    $d = $b.All - $a.All
    if ($d -le 0) { return 0 }
    [Math]::Round(100.0 * (1 - ($b.Idle - $a.Idle) / $d), 1)
}
# How many cores were idle over the last half second or more: what another
# harness may start into. -BusyFrom stands in for the processor in a test.
$cores = [Environment]::ProcessorCount
function Idle-Cores($a, $b) {
    if ($BusyFrom) { $busy = [double]([IO.File]::ReadAllText($BusyFrom).Trim()) } else { $busy = Busy-Between $a $b }
    [Math]::Floor($cores * (100 - [Math]::Min(100, [Math]::Max(0, $busy))) / 100 + 1e-9)
}

# One git setting for every git a harness starts, through git's own
# GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n, after the ones
# already there. Hands back what was there, for Undo-GitSetting.
function Add-GitSetting([string]$Key, [string]$Value) {
    $was = $env:GIT_CONFIG_COUNT
    $n = 0
    if ($was -match '^\d+$') { $n = [int]$was }
    [Environment]::SetEnvironmentVariable(('GIT_CONFIG_KEY_' + $n), $Key)
    [Environment]::SetEnvironmentVariable(('GIT_CONFIG_VALUE_' + $n), $Value)
    $env:GIT_CONFIG_COUNT = [string]($n + 1)
    return [pscustomobject]@{ Count = $was; Index = $n }
}
function Undo-GitSetting($was) {
    [Environment]::SetEnvironmentVariable(('GIT_CONFIG_KEY_' + $was.Index), $null)
    [Environment]::SetEnvironmentVariable(('GIT_CONFIG_VALUE_' + $was.Index), $null)
    if ($null -eq $was.Count) { Remove-Item Env:\GIT_CONFIG_COUNT -ErrorAction SilentlyContinue }
    else { $env:GIT_CONFIG_COUNT = $was.Count }
}

# Start-Process joins -ArgumentList with spaces and quotes nothing, so a path
# is quoted here. $p.Handle is read at once because without it ExitCode comes
# back empty once the process is gone.
function Start-One($t) {
    $file = $t.Name -replace '[\\/]', '_'
    $o = Join-Path $OutDir ($file + '.out'); $e = Join-Path $OutDir ($file + '.err')
    $mark = [Guid]::NewGuid().ToString('N')
    if ($t.File.Extension -eq '.js') { $exe = 'node'; $argList = @('"' + $t.File.FullName + '"') }
    else { $exe = 'pwsh'; $argList = @('-NoProfile', '-File', ('"' + $t.File.FullName + '"')) }
    if (-not $onWindows) { $env:THORNSWOOD_NIGHTLY_RUN = $mark }
    # Git's auto maintenance off for the harness and all it starts (#3835).
    # A commit, fetch, merge or pull starts `git maintenance run --auto`
    # after it, a process of its own that a scratch clone has no use for.
    # Counted on the box on 26 Oct 2026: a commit is 3 processes with it and
    # 2 without, and each process start costs Defender about 4.5 ms of
    # processor beside its own. Added after any git settings this process
    # already carries; a harness that sets GIT_CONFIG_COUNT itself replaces
    # them for its own git.
    $gitWas = Add-GitSetting 'maintenance.auto' 'false'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $before = [DateTime]::UtcNow
    try {
        $p = Start-Process -FilePath $exe -ArgumentList $argList -NoNewWindow -PassThru -WorkingDirectory $Root `
               -RedirectStandardInput $nothing -RedirectStandardOutput $o -RedirectStandardError $e
    } finally {
        Remove-Item Env:\THORNSWOOD_NIGHTLY_RUN -ErrorAction SilentlyContinue
        Undo-GitSetting $gitWas
    }
    $null = $p.Handle
    $job = [IntPtr]::Zero
    if ($onWindows) {
        # A harness spends its first few hundred milliseconds starting node
        # or pwsh before it can start anything of its own, so it is in its
        # job before its first child.
        # One that has already ended by then started nothing either.
        $job = [HarnessJob]::Create()
        if (-not [HarnessJob]::Assign($job, $p.Handle)) {
            $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            [HarnessJob]::Close($job); $job = [IntPtr]::Zero
            if (-not $p.HasExited) { throw ("could not put {0} in a job of its own (Windows error {1})" -f $t.Name, $err) }
        }
    }
    # On Windows, Windows' own start time, which a trace's process events
    # carry (Trace-Gate-Box.ps1 knows the harness by it). The handle taken
    # above keeps it readable after the process ends. No trace is read
    # anywhere else, and there a process that has ended and been reaped has
    # no start time left to ask for, so it is the time just before
    # Start-Process.
    $began = $before
    if ($onWindows) { $began = $p.StartTime.ToUniversalTime() }
    Write-StartLog ([ordered]@{ name = $t.Name; pid = $p.Id; start = $began.ToString('o') })
    [pscustomobject]@{ T = $t; P = $p; Job = $job; Mark = $mark; Sw = $sw; Out = $o; Err = $e; Ended = $p.WaitForExitAsync() }
}

function Finish-One($r, [bool]$timedOut) {
    $t = $r.T; $p = $r.P
    $left = @()
    $cpu = $null; $procs = $null
    if ($onWindows -and $r.Job -ne [IntPtr]::Zero) {
        if ($timedOut) { [HarnessJob]::Kill($r.Job); $null = $p.WaitForExit(10000) }
        $acct = [HarnessJob]::Accounting($r.Job)
        $ids = @([HarnessJob]::Pids($r.Job) | Where-Object { $_ -ne $p.Id })
        foreach ($id in $ids) {
            $q = Get-Process -Id $id -ErrorAction SilentlyContinue
            if ($q) { $left += $q.ProcessName }
        }
        if ($ids.Count) { [HarnessJob]::Kill($r.Job) }
        [HarnessJob]::Close($r.Job)
        $cpu = [Math]::Round($acct[0] / 1e7, 1); $procs = [int]$acct[1]
    } elseif (-not $onWindows) {
        if ($timedOut) {
            foreach ($q in @(Get-Marked $r.Mark)) { Stop-Process -Id $q.Id -Force -ErrorAction SilentlyContinue }
            $null = $p.WaitForExit(10000)
        }
        $l = @(Get-Marked $r.Mark | Where-Object { $_.Id -ne $p.Id })
        foreach ($q in $l) { Stop-Process -Id $q.Id -Force -ErrorAction SilentlyContinue }
        $left = @($l | ForEach-Object { $_.Name })
    }
    $code = if ($timedOut) { -1 } else { $p.ExitCode }
    $secs = [Math]::Round($r.Sw.Elapsed.TotalSeconds, 1)
    $said = @()
    if ($t.OffBox) { $said += 'on a ' + $t.Clock + ' s clock off the box' }
    elseif ($t.Clock -ne $PER_HARNESS) { $said += 'on a ' + $t.Clock + ' s clock it names' }
    if ($null -ne $cpu) { $said += ('{0}s of processor in {1} process(es)' -f $cpu, $procs) }
    Write-Host ("--- {0}  ({1}s{2})" -f $t.Name, $secs, $(if ($said.Count) { ', ' + ($said -join ', ') } else { '' }))
    $skipped = $false
    $printed = ''
    $skips = [System.Collections.Generic.List[string]]::new()
    $passes = 0
    foreach ($f in $r.Out, $r.Err) {
        if (Test-Path $f) {
            $txt = Get-Content -Raw $f
            if ($txt) {
                Write-Host $txt.TrimEnd()
                $printed += $txt.TrimEnd() + "`n"
                foreach ($m in [regex]::Matches($txt, '(?m)^\s*((?:SKIP|NOT RUN)\b[^\r\n]*)')) {
                    $skipped = $true
                    $line = $m.Groups[1].Value.Trim()
                    if (-not $skips.Contains($line)) { $skips.Add($line) }
                }
                $passes += [regex]::Matches($txt, '(?m)^\s*(?:PASS|ok)\b').Count
            }
        }
    }
    Write-StartLog ([ordered]@{ name = $t.Name; end = [DateTime]::UtcNow.ToString('o'); code = $code; secs = $secs; skipped = $skipped; skips = @($skips); passes = $passes })
    $path = $t.File.FullName
    if ($timedOut) { Write-Host ("::error file={0}::harness timed out after {1}s and was killed" -f $path, $t.Clock) }
    elseif ($code -ne 0) { Write-Host ("::error file={0}::harness failed (exit {1})" -f $path, $code) }
    if ($left.Count) { Write-Host ("::warning file={0}::harness left {1} process(es) running when it ended, now killed: {2}" -f $path, $left.Count, ($left -join ', ')) }
    [pscustomobject]@{ Name = $t.Name; Path = $path; Code = $code; TimedOut = $timedOut; Secs = $secs; Cpu = $cpu; Procs = $procs; Said = $printed; Clock = $t.Clock }
}

# -Report (#5295): the checks a harness printed, one for each line starting
# PASS, FAIL, SKIP or NOT RUN, and when it failed with no FAIL line of its
# own, one failing check saying how it ended.
function Checks-Of($res) {
    $checks = New-Object System.Collections.Generic.List[object]
    foreach ($line in ($res.Said -split "`r?`n")) {
        $m = [regex]::Match($line, '^\s*(PASS|FAIL|SKIP|NOT RUN)\b[\s:]*(.*)$')
        if (-not $m.Success) { continue }
        $what = $m.Groups[2].Value.Trim()
        if (-not $what) { $what = '(a check with no name)' }
        $checks.Add([pscustomobject]@{ What = $what; Is = $m.Groups[1].Value })
    }
    $failedOwn = @($checks | Where-Object { $_.Is -eq 'FAIL' }).Count
    if ($res.Code -ne 0 -and -not $failedOwn) {
        $how = $(if ($res.TimedOut) { 'timed out after ' + $res.Clock + ' s and was killed' } else { 'ended with exit ' + $res.Code + ' and no FAIL line' })
        $tail = @($res.Said -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 20) -join "`n"
        $checks.Add([pscustomobject]@{ What = 'the harness ' + $how; Is = 'FAIL'; Tail = $tail })
    }
    $checks
}
# XML 1.0 has no place for most control characters, which a harness's
# output can carry (a colour code, a stray byte), so they are left out.
function Xml-Text([string]$s) {
    [Security.SecurityElement]::Escape(([regex]::Replace($s, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '')))
}
function Write-Report($results, $notRun) {
    $sb = New-Object System.Text.StringBuilder
    $all = 0; $bad = 0; $skip = 0; $time = 0.0
    $suites = New-Object System.Text.StringBuilder
    $rows = @(foreach ($res in $results) { $res }) + @(foreach ($n in $notRun) {
        [pscustomobject]@{ Name = $n; Code = -2; TimedOut = $false; Secs = 0; Said = ''; Clock = 0; NotRun = $true }
    })
    foreach ($res in $rows) {
        if ($res.PSObject.Properties['NotRun']) { $checks = @([pscustomobject]@{ What = 'the harness was not run, out of time'; Is = 'FAIL' }) }
        else { $checks = @(Checks-Of $res) }
        $f = @($checks | Where-Object { $_.Is -eq 'FAIL' }).Count
        $k = @($checks | Where-Object { $_.Is -in 'SKIP', 'NOT RUN' }).Count
        $all += $checks.Count; $bad += $f; $skip += $k; $time += [double]$res.Secs
        [void]$suites.AppendFormat('  <testsuite name="{0}" tests="{1}" failures="{2}" skipped="{3}" time="{4}">', (Xml-Text $res.Name), $checks.Count, $f, $k, ([double]$res.Secs).ToString([Globalization.CultureInfo]::InvariantCulture)).Append("`n")
        foreach ($c in $checks) {
            $open = '    <testcase classname="{0}" name="{1}"' -f (Xml-Text $res.Name), (Xml-Text $c.What)
            if ($c.Is -eq 'PASS') { [void]$suites.Append($open + ' />' + "`n"); continue }
            if ($c.Is -eq 'FAIL') {
                $body = $(if ($c.PSObject.Properties['Tail']) { Xml-Text $c.Tail } else { '' })
                [void]$suites.Append($open + ">`n      <failure message=`"" + (Xml-Text $c.What) + "`">" + $body + "</failure>`n    </testcase>`n")
                continue
            }
            [void]$suites.Append($open + ">`n      <skipped message=`"" + (Xml-Text $c.What) + "`" />`n    </testcase>`n")
        }
        [void]$suites.Append("  </testsuite>`n")
    }
    [void]$sb.Append('<?xml version="1.0" encoding="utf-8"?>' + "`n")
    [void]$sb.AppendFormat('<testsuites name="harnesses" tests="{0}" failures="{1}" skipped="{2}" time="{3}">', $all, $bad, $skip, $time.ToString([Globalization.CultureInfo]::InvariantCulture)).Append("`n")
    [void]$sb.Append($suites.ToString())
    [void]$sb.Append("</testsuites>`n")
    $dir = Split-Path -Parent $Report
    if ($dir) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($Report, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
    Write-Host ('report: {0} checks in {1} harnesses, {2} failed, {3} skipped, in {4}' -f $all, $rows.Count, $bad, $skip, $Report)
}

# Every harness, in one order every share agrees on: those in tests\ and in
# each product's tests folder (voice's among them since they moved from beside
# voice-server.js into voice\tests\), as scripts\dev\Harness-Files.ps1 lists
# and names them for the gate too.
. (Join-Path $PSScriptRoot 'Harness-Files.ps1')
$every = @(Get-Harnesses $Root)
if ($Only.Trim()) {
    $asked = @($Only -split '[\s,]+' | Where-Object { $_ } | Select-Object -Unique)
    $known = @{}; foreach ($t in $every) { $known[$t.Name] = $true }
    $unknown = @($asked | Where-Object { -not $known.ContainsKey($_) })
    if ($unknown.Count) { Write-Host ("::error::no such harness here, so nothing was run: " + ($unknown -join ', ')); exit 2 }
    $want = @{}; foreach ($n in $asked) { $want[$n] = $true }
    $mine = @($every | Where-Object { $want.ContainsKey($_.Name) })
    $names = $(if ($mine.Count -le 20) { ': ' + (@($mine | ForEach-Object { $_.Name }) -join ', ') } else { '' })
    Write-Host ("the {0} harness(es) asked for, of the {1}, {2} s to run them in{3}" -f $mine.Count, $every.Count, $BudgetSeconds, $names)
} else {
    $mine = @(for ($i = 0; $i -lt $every.Count; $i++) { if (($i % $Of) -eq ($Shard - 1)) { $every[$i] } })
    Write-Host ("share {0} of {1}: {2} of the {3} harnesses, {4} s to run them in" -f $Shard, $Of, $mine.Count, $every.Count, $BudgetSeconds)
}

# The order they start in: those that share nothing first, in name order, as
# many at once as -Throttle; then each one whose header says RUNS ALONE, with
# nothing else of this run beside it.
$order = @(foreach ($t in $mine) {
    $head = Head-Of $t.File.FullName
    $clock = Clock-Of $head; $longer = $false
    if ($offBox -and $OFF_BOX_CLOCK.ContainsKey($t.Name)) {
        $heavy = [Math]::Min([int]$OFF_BOX_CLOCK[$t.Name], $MAX_CLOCK)
        if ($heavy -gt $clock) { $clock = $heavy; $longer = $true }
    }
    [pscustomobject]@{ Name = $t.Name; File = $t.File; Clock = $clock; OffBox = $longer; Alone = (Alone-Of $head) }
})
$order = @(@($order | Where-Object { -not $_.Alone }) + @($order | Where-Object { $_.Alone }))
if ($Throttle -gt 1) {
    Write-Host ("{0} at a time; {1} run alone, after the rest" -f $Throttle, @($order | Where-Object { $_.Alone }).Count)
}

$clockAll = [Diagnostics.Stopwatch]::StartNew()
$cpuFirst = Read-Cpu; $cpuLast = $cpuFirst; $cpuAt = 0.0; $cpuPeak = 0.0
# The half-second reading that harnesses past -Share start from: $room is
# how many more of those may start before the next one.
$tickCpu = $cpuFirst; $tickAt = 0.0; $room = 0
$mostAtOnce = 0; $runningTime = 0.0
$results = @()
$notRun = @()
$running = New-Object System.Collections.ArrayList
$next = 0
while ($next -lt $order.Count -or $running.Count) {
    $now = $clockAll.Elapsed.TotalSeconds
    if ($now - $tickAt -ge 0.5) {
        $read = Read-Cpu
        $room = Idle-Cores $tickCpu $read
        $tickCpu = $read; $tickAt = $now
    }
    while ($next -lt $order.Count -and $running.Count -lt $Throttle) {
        $t = $order[$next]
        if ($running.Count -and ($t.Alone -or $running[0].T.Alone)) { break }
        $extra = $running.Count -ge $Share
        if ($extra -and $room -lt 1) { break }
        $next++
        if ($clockAll.Elapsed.TotalSeconds + $t.Clock -gt $BudgetSeconds) {
            $notRun += $t.Name
            Write-Host ("::error file={0}::not run, out of time: {1}s used of {2}s and its clock is {3}s" -f $t.File.FullName, [Math]::Round($clockAll.Elapsed.TotalSeconds), $BudgetSeconds, $t.Clock)
            continue
        }
        [void]$running.Add((Start-One $t))
        if ($extra) { $room-- }
        $mostAtOnce = [Math]::Max($mostAtOnce, $running.Count)
        if ($t.Alone) { break }
    }
    if (-not $running.Count) { continue }

    # Sleep until one of them ends or the nearest clock is up, whichever is
    # first, or the next reading when one more is waiting for a free core.
    $soonest = [double]::MaxValue
    foreach ($r in $running) { $soonest = [Math]::Min($soonest, $r.T.Clock * 1000 - $r.Sw.Elapsed.TotalMilliseconds) }
    if ($next -lt $order.Count -and $running.Count -lt $Throttle -and $running.Count -ge $Share) {
        $soonest = [Math]::Min($soonest, [Math]::Max(50, ($tickAt + 0.5 - $clockAll.Elapsed.TotalSeconds) * 1000))
    }
    $runningSince = $clockAll.Elapsed.TotalSeconds; $runningCount = $running.Count
    $tasks = [Threading.Tasks.Task[]]@($running | ForEach-Object { $_.Ended })
    $null = [Threading.Tasks.Task]::WaitAny($tasks, [int][Math]::Max(0, [Math]::Ceiling($soonest)))
    $runningTime += $runningCount * ($clockAll.Elapsed.TotalSeconds - $runningSince)

    foreach ($r in @($running)) {
        if ($r.P.HasExited) { $results += Finish-One $r $false; $running.Remove($r) }
        elseif ($r.Sw.Elapsed.TotalSeconds -ge $r.T.Clock) { $results += Finish-One $r $true; $running.Remove($r) }
    }
    if ($clockAll.Elapsed.TotalSeconds - $cpuAt -ge 10) {
        $now = Read-Cpu
        $cpuPeak = [Math]::Max($cpuPeak, (Busy-Between $cpuLast $now))
        $cpuLast = $now; $cpuAt = $clockAll.Elapsed.TotalSeconds
    }
}
$cpuAll = Busy-Between $cpuFirst (Read-Cpu)
$cpuPeak = [Math]::Max($cpuPeak, $cpuAll)

$failed = @($results | Where-Object { $_.Code -ne 0 } | ForEach-Object { if ($_.TimedOut) { $_.Name + ' (timed out)' } else { $_.Name } })
Write-Host ''
Write-Host ('slowest: ' + ((@($results | Sort-Object Secs -Descending | Select-Object -First 10) | ForEach-Object { '{0} {1}s' -f $_.Name, $_.Secs }) -join ', '))
if ($onWindows) {
    Write-Host ('most processor: ' + ((@($results | Sort-Object Cpu -Descending | Select-Object -First 10) | ForEach-Object { '{0} {1}s' -f $_.Name, $_.Cpu }) -join ', '))
    Write-Host ('most processes: ' + ((@($results | Sort-Object Procs -Descending | Select-Object -First 10) | ForEach-Object { '{0} {1}' -f $_.Name, $_.Procs }) -join ', '))
    Write-Host ('processor used by all of them: {0}s in {1} processes' -f [Math]::Round(($results | Measure-Object Cpu -Sum).Sum), ($results | Measure-Object Procs -Sum).Sum)
}
Write-Host ('all of them, added up: {0}s, in {1}s' -f [Math]::Round(($results | Measure-Object Secs -Sum).Sum), [Math]::Round($clockAll.Elapsed.TotalSeconds))
Write-Host ('the machine''s {0} cores while they ran: {1}% busy on average, {2}% at most over 10 s' -f [Environment]::ProcessorCount, $cpuAll, $cpuPeak)
if ($Throttle -gt 1) {
    $avg = if ($clockAll.Elapsed.TotalSeconds -gt 0) { [Math]::Round($runningTime / $clockAll.Elapsed.TotalSeconds, 1) } else { 0 }
    Write-Host ('at once: {0} on average, {1} at most; {2} always, up to {3} into free cores' -f $avg, $mostAtOnce, $Share, $Throttle)
}
$longClock = @($order | Where-Object { $_.OffBox })
if ($longClock.Count) {
    Write-Host ('longer clock off the box: {0}; {1} is an off-box runner, where these heavy harnesses run slower than on the box (#4981)' -f
        ((@($longClock | ForEach-Object { '{0} {1} s' -f $_.Name, $_.Clock })) -join ', '), $env:RUNNER_NAME)
}
if ($notRun.Count) {
    Write-Host ''
    if ($Only.Trim()) { Write-Host ("{0} harness(es) not run, out of the {1} s; name fewer in one run: {2}" -f $notRun.Count, $BudgetSeconds, ($notRun -join ', ')) }
    else { Write-Host ("{0} harness(es) not run, out of this share's {1} s; nightly.yml needs another share: {2}" -f $notRun.Count, $BudgetSeconds, ($notRun -join ', ')) }
}
if ($failed.Count) {
    Write-Host ''
    Write-Host ("{0} harness(es) failed: {1}" -f $failed.Count, ($failed -join ', '))
}
$reportBad = $false
if ($Report) { Write-Report $results $notRun }
if ($Summary) {
    & (Join-Path $PSScriptRoot 'Merge-HarnessReports.ps1') -Path $Report -Expect 1 -Summary $Summary -Title $Title
    if ($LASTEXITCODE -ne 0) { $reportBad = $true; Write-Host '::error::the report could not be written to the run''s summary' }
}
if ($failed.Count -or $notRun.Count -or $reportBad) { exit 1 }
Write-Host 'every harness passed'
exit 0
