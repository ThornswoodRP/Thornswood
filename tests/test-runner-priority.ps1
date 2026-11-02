<#
  test-runner-priority.ps1

      pwsh -NoProfile -File .\tests\test-runner-priority.ps1

  The build runners run at normal priority because of how they start, and
  nothing on a timer sets it. Issue #1969.

  WHY. Install-Runner.ps1 registered a task, Thornswood Runner Priority
  (Thornswood Runner N Priority from the second runner on), that set
  Runner.Listener and Runner.Worker to Normal at start and every five
  minutes: a timer that repairs state, which docs/guide/rules.md "Fix the
  cause, no band-aids" does not allow. It had nothing to repair. The runner
  is a Windows service (config.cmd --runasservice), the service control
  manager starts a service at Normal, I/O priority 2 and memory priority 5,
  and on the VPS on 5 October the runners measured Normal, 2 and 5 (#1931,
  PR #1967). The watcher could not have given them the 2 and the 5: its line
  changes only the priority class.

  HOW.
    1. Read, not run, wherever PowerShell runs: Install-Runner.ps1 installs
       the runner as a service, registers no scheduled task in anything it
       sends to the box, and sets no process's priority class. Every run that
       changes the box (the install, -Lock and -Remove) sends
       Remove-RunnerWatchers, the install after config.cmd, and -Status
       reports a watcher still there.
    2. On Windows, Remove-RunnerWatchers is lifted out of the script and run
       for real on scratch tasks named the way the watchers were but under
       the prefix 'Thornswood priority harness <guid> Runner', which it is
       handed in place of 'Thornswood Runner': '<prefix> Priority' and
       '<prefix> 3 Priority' must go, '<prefix>', '<prefix> Other' and
       '<prefix> 3 Priority old' must stay. The scratch tasks are registered
       for the person running this, logged on interactively, with no trigger,
       and are never started.
    3. On Windows, what the watcher could and could not do, measured: a
       scratch task at Task Scheduler's default priority of 7 starts a
       program, which runs BelowNormal, I/O priority 1, memory priority 2;
       the watcher's own line is run on it, and the class becomes Normal
       while the I/O and memory priority stay 1 and 2. So a runner measured
       at 2 and 5 started there. For the record it also prints what the
       service control manager gave every running own-process service here.

  Registers and removes tasks named Thornswood priority harness <guid> ...
  (not 'Thornswood Test...', which test-deploy-swaps and test-install-server
  clear away, #1135) and stops the PowerShell 7 part 3 started; writes
  nothing else. Where a task cannot be registered or does not start for this
  account (a build runner's service account), that part says SKIP and why.

  -Installer reads another copy, so the same test runs on the one from before
  this change:

      git show origin/main:scripts/deploy/Install-Runner.ps1 > $env:TEMP\runner-before.ps1
      pwsh -NoProfile -File .\tests\test-runner-priority.ps1 -Installer $env:TEMP\runner-before.ps1
#>
[CmdletBinding()]
param([string]$Installer)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Repo = Split-Path -Parent $Here
if (-not $Installer) { $Installer = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Install-Runner.ps1') }
$Installer = [IO.Path]::GetFullPath($Installer)

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

# ---- 1. read, not run ------------------------------------------------------------
Write-Host "installer: $Installer"
$text = [IO.File]::ReadAllText($Installer)
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$t, [ref]$e)
Yes 'Install-Runner.ps1 parses' (-not $e -or $e.Count -eq 0)

# The value of a top-level "$name = @'...'@" or "$name = $other + @'...'@".
function HereOf([string]$name) {
    $a = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -eq ('$' + $name) }, $false))
    if (-not $a.Count) { return $null }
    $s = @($a[0].Right.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.StringConstantType -eq 'SingleQuotedHereString' }, $true))
    if (-not $s.Count) { return $null }
    return $s[-1].Value
}

Yes 'the runner is a Windows service, which the service control manager starts' ($text.Contains('--runasservice'))
# The file as a whole, the scripts it sends to the box included, as text.
$registers = @([regex]::Matches($text, '(?<!Un)Register-ScheduledTask'))
Yes ('nothing it sends to the box registers a scheduled task (' + $registers.Count + ' found)') ($registers.Count -eq 0)
$sets = @([regex]::Matches($text, 'PriorityClass\s*=|SetPriorityClass|ProcessPriorityClass'))
Yes ('  nor sets a process''s priority class (' + $sets.Count + ' found)') ($sets.Count -eq 0)

$lib = HereOf 'watcherLib'
Yes 'the old priority watchers are taken off by one block, $watcherLib' ([bool]$lib -and $lib -match 'function Remove-RunnerWatchers')
$prefixDefault = $null
if ($lib) {
    $m = [regex]::Match($lib, "function Remove-RunnerWatchers\(\[string\]\`$prefix = '([^']*)'\)")
    if ($m.Success) { $prefixDefault = $m.Groups[1].Value }
}
Yes ("  under the name the installs gave them, 'Thornswood Runner' ($prefixDefault)") ($prefixDefault -eq 'Thornswood Runner')
$cfgAt = $text.IndexOf('& .\config.cmd --unattended')
$installAt = $text.IndexOf('# ----------------------------------------------------------------- install --')
$callAt = if ($installAt -ge 0) { $text.IndexOf('Remove-RunnerWatchers', $installAt) } else { -1 }
Yes 'the install sends it' ($text.Contains('$out = Send-WithSecret $token ($lockLib + $watcherLib + "`n" + @"'))
Yes '  and runs it once config.cmd has made the service' ($cfgAt -gt 0 -and $callAt -gt $cfgAt)
$all = HereOf 'lockAll'
Yes '-Lock, and the end of every install, run it too' ($text.Contains('$lockAll = $lockLib + $watcherLib + "`n`$liveFilter = ''') -and $all -match 'Remove-RunnerWatchers')
Yes '  and count one it could not take off as a failure' ($all -match "-like 'COULD NOT\*'" -and $all -match '\$bad\+\+')
# The top-level blocks, at the start of a line: since #2307 -NetworkOnly has
# its own indented 'if ($Status) {' and 'if ($Remove) {' above them.
function TopAt([string]$switch) { $m = [regex]::Match($text, '(?m)^if \(\$' + $switch + '\) \{'); if ($m.Success) { $m.Index } else { -1 } }
$removeAt = TopAt 'Remove'
$lockAt = TopAt 'Lock'
$removeBlock = if ($removeAt -ge 0 -and $lockAt -gt $removeAt) { $text.Substring($removeAt, $lockAt - $removeAt) } else { '' }
Yes '-Remove runs it' ($removeBlock.Contains('$watcherLib') -and $removeBlock.Contains('Remove-RunnerWatchers'))
$statusAt = TopAt 'Status'
$statusBlock = if ($statusAt -ge 0 -and $removeAt -gt $statusAt) { $text.Substring($statusAt, $removeAt - $statusAt) } else { '' }
Yes '-Status says when a watcher is still there, and takes nothing off' ($statusBlock.Contains('Get-RunnerWatchers') -and -not $statusBlock.Contains('Remove-RunnerWatchers'))
Yes 'there is no -TaskName any more, since there is no task' ($text -notmatch '\[string\]\$TaskName')

# ---- 2. Remove-RunnerWatchers, for real on scratch tasks ----------------------------
Write-Host ''
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'SKIP  the task parts need Windows and its Task Scheduler'; Done }
Import-Module ScheduledTasks -ErrorAction SilentlyContinue
if (-not (Get-Module ScheduledTasks)) { Write-Host 'SKIP  the ScheduledTasks module did not load'; Done }

$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$cmdExe = Get-WindowsPath 'System32\cmd.exe'
$boxPs = Get-BoxPowerShell
$mine = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
$prefix = 'Thornswood priority harness ' + [Guid]::NewGuid().ToString('N') + ' Runner'
$goes = @(($prefix + ' Priority'), ($prefix + ' 3 Priority'))
$stays = @($prefix, ($prefix + ' Other'), ($prefix + ' 3 Priority old'))
if (-not $lib) {
    Write-Host 'SKIP  Remove-RunnerWatchers on scratch tasks: the installer has no $watcherLib to lift'
} else {
    $skip = $null
    try {
        try {
            foreach ($n in $goes + $stays) {
                Register-ScheduledTask -TaskName $n -Action (New-ScheduledTaskAction -Execute $cmdExe -Argument '/c exit 0') -Principal $mine -ErrorAction Stop | Out-Null
            }
        } catch { $skip = 'scratch tasks could not be registered for ' + $me + ': ' + $_.Exception.Message }
        if (-not $skip) {
            . ([scriptblock]::Create($lib))
            $said = @(Remove-RunnerWatchers $prefix | ForEach-Object { "$_" })
            $said | ForEach-Object { Write-Host "  said: $_" }
            foreach ($n in $goes) {
                Yes ("Remove-RunnerWatchers takes off '" + $n.Substring($prefix.Length - 6) + "'") (-not (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue))
                Yes '  and says so' (@($said | Where-Object { $_ -eq ('took off the priority watcher task ' + $n + ' (#1969)') }).Count -eq 1)
            }
            foreach ($n in $stays) {
                Yes ("  leaves '" + $n.Substring($prefix.Length - 6) + "' alone") ([bool](Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue))
            }
            Yes '  and says nothing failed' (@($said | Where-Object { $_ -like 'COULD NOT*' }).Count -eq 0)
            $again = @(Remove-RunnerWatchers $prefix | ForEach-Object { "$_" })
            Yes ('  a second run finds none (' + ($again -join ' | ') + ')') ($again.Count -eq 1 -and $again[0] -eq 'no priority watcher task on this box')
        }
    }
    finally {
        foreach ($n in $goes + $stays) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }
    }
    if ($skip) { Write-Host ('SKIP  ' + $skip) }
    Yes 'the scratch tasks are gone again' (@($goes + $stays | Where-Object { Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue }).Count -eq 0)
}

# ---- 3. what the watcher could do, measured --------------------------------------------
Write-Host ''
if (-not ('TsRunnerPriorityProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TsRunnerPriorityProbe {
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetPriorityClass(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessInformation(IntPtr h, int cls, ref uint info, int size);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref uint info, int size, IntPtr returned);
    // The priority class as GetPriorityClass gives it, ProcessIoPriority (33
    // for NtQueryInformationProcess) and ProcessMemoryPriority (0 for
    // GetProcessInformation). -1 means it could not be read.
    public static int[] Read(int id) {
        IntPtr h = OpenProcess(0x1000, false, id);
        if (h == IntPtr.Zero) return new int[] { -1, -1, -1 };
        try {
            uint mem = 0, io = 0;
            uint c = GetPriorityClass(h);
            int m = GetProcessInformation(h, 0, ref mem, 4) ? (int)mem : -1;
            int i = NtQueryInformationProcess(h, 33, ref io, 4, IntPtr.Zero) == 0 ? (int)io : -1;
            return new int[] { c == 0 ? -1 : (int)c, i, m };
        } finally { CloseHandle(h); }
    }
}
'@
}
function Measure-Priority([int]$id) {
    $r = [TsRunnerPriorityProbe]::Read($id)
    $classes = @{ 0x40 = 'Idle'; 0x4000 = 'BelowNormal'; 0x20 = 'Normal'; 0x8000 = 'AboveNormal'; 0x80 = 'High'; 0x100 = 'RealTime' }
    $class = if ($classes.ContainsKey($r[0])) { $classes[$r[0]] } else { '?' }
    [pscustomobject]@{ Class = $class; Io = $r[1]; Memory = $r[2] }
}

# For the record, not checked: a service can set its own priority after it
# starts, so what each runs at now is not only what the SCM gave it.
$tally = @{}
foreach ($s in @(Get-CimInstance Win32_Service -Filter "State = 'Running' AND ServiceType = 'Own Process'" -ErrorAction SilentlyContinue)) {
    if (-not $s.ProcessId) { continue }
    $p = Measure-Priority ([int]$s.ProcessId)
    if ($p.Class -eq '?') { continue }
    $k = '{0}, I/O priority {1}, memory priority {2}' -f $p.Class, $p.Io, $p.Memory
    $tally[$k] = 1 + [int]$tally[$k]
}
Write-Host 'running own-process services here, as the service control manager started them or as they set themselves since:'
$tally.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { Write-Host ('  {0,3}  {1}' -f $_.Value, $_.Key) }

# The watcher's line as Install-Runner.ps1 sent it, run on the one process.
$watcherLine = { param($id) Get-Process -Id $id -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'Normal' } }
$name = 'Thornswood priority harness ' + [Guid]::NewGuid().ToString('N')
$mark = [Guid]::NewGuid().ToString('N')
$child = $null
$skip = $null
try {
    try {
        Register-ScheduledTask -TaskName $name -Action (New-ScheduledTaskAction -Execute $boxPs -Argument ('-NoProfile -NonInteractive -Command Start-Sleep -Seconds 90 #' + $mark)) `
                              -Principal $mine -ErrorAction Stop | Out-Null
    } catch { $skip = 'a task could not be registered for ' + $me + ': ' + $_.Exception.Message }
    if (-not $skip) {
        Write-Host ('a scratch task at priority ' + (Get-ScheduledTask -TaskName $name).Settings.Priority + ', ' + $name)
        Start-ScheduledTask -TaskName $name
        for ($i = 0; $i -lt 40 -and -not $child; $i++) {
            Start-Sleep -Milliseconds 500
            $child = @(Get-CimInstance Win32_Process -Filter ("Name = '" + (Split-Path -Leaf $boxPs) + "'") |
                       Where-Object { "$($_.CommandLine)" -like "*$mark*" }) | Select-Object -First 1
        }
        if (-not $child) { $skip = 'the scratch task was registered but no process of it appeared in 20 s; an account with no session cannot start an interactive task' }
    }
    if (-not $skip) {
        $before = Measure-Priority ([int]$child.ProcessId)
        & $watcherLine ([int]$child.ProcessId)
        $after = Measure-Priority ([int]$child.ProcessId)
        Write-Host ("  started by the task:      {0}, I/O priority {1}, memory priority {2}" -f $before.Class, $before.Io, $before.Memory)
        Write-Host ("  after the watcher's line: {0}, I/O priority {1}, memory priority {2}" -f $after.Class, $after.Io, $after.Memory)
        Yes 'a priority 7 task starts its program BelowNormal, I/O priority 1, memory priority 2' ($before.Class -eq 'BelowNormal' -and $before.Io -eq 1 -and $before.Memory -eq 2)
        Yes '  the watcher''s line makes the class Normal' ($after.Class -eq 'Normal')
        Yes '  and leaves I/O priority 1 and memory priority 2, so the runners'' 2 and 5 on the VPS came from how they start' ($after.Io -eq 1 -and $after.Memory -eq 2)
    }
}
finally {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    if ($child) { Stop-Process -Id ([int]$child.ProcessId) -Force -ErrorAction SilentlyContinue }
}
if ($skip) { Write-Host ('SKIP  ' + $skip) }
Yes 'the scratch task is gone again' (-not (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue))
if ($child) { Yes '  and so is its process' (-not (Get-Process -Id ([int]$child.ProcessId) -ErrorAction SilentlyContinue)) }
Done
