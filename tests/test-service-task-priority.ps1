<#
  test-service-task-priority.ps1

      pwsh -NoProfile -File .\tests\test-service-task-priority.ps1

  The site and Caddy start at normal priority: normal for the processor, the
  disk and memory, the same as a service on the box. Voice starts at high
  priority for the processor, with the game servers, and normal for the disk
  and memory.

  WHY VOICE IS HIGH (#2491). Decided by Patrick on 12 Oct 2026 at about
  6:20 PM: "we need to fix it so the servers run on high priority". Voice
  runs with the game servers, above the six build runners, the site, Caddy
  and the bot. Its task is registered at priority 1, HIGH_PRIORITY_CLASS, and
  node is started through cmd's start /high, because cmd.exe at High starts
  node Normal unless asked (measured 12 Oct; tests\test-server-task-priority.ps1).

  WHY NOT BELOW NORMAL. Deploy-Docs.ps1, Install-Voice.ps1 and Setup-Domain.ps1 registered
  their scheduled tasks with no -Priority, so Task Scheduler used its default
  of 7: BelowNormal, I/O priority 1 (low) and memory priority 2, measured on
  the VPS on 5 October for Caddy and the site. In the kernel trace of
  4 October 17:18 Caddy's reads took a median of 47 ms, held back the same
  way the game server's were (#1931, tests\test-server-task-priority.ps1).
  Issue #1968.

  HOW. The same two parts as test-server-task-priority.ps1, for each of the
  three:
    1. Read, not run, wherever PowerShell runs. Each installer builds its
       task on the VPS in a script it sends there, a here-string in the
       installer. That here-string is found, read as the script the box
       runs, its one New-ScheduledTaskSettingsSet found and the -Priority it
       passes read (none is 7, the default). For the site and Caddy it must
       be 4 to 6, the band Microsoft's table starts as NORMAL_PRIORITY_CLASS;
       for voice 1, HIGH_PRIORITY_CLASS, never 0, realtime, and voice's task
       command line must start node through start "" /b /wait /high.
    2. On Windows, that call is run for real (it only builds the settings),
       and a task with those settings and a made-up name is registered: for
       SYSTEM as a service when this shell is elevated, which is what all
       three run as on the box (the site may be LOCAL SERVICE, which the
       priority does not depend on), and otherwise for the person running
       this, logged on interactively. For the site and Caddy its action is
       cmd.exe /c starting a program: their tasks start their program
       directly, so what counts is the process the task starts (cmd.exe
       here). For voice it is voice's own command line, with Windows
       PowerShell sleeping in place of node and a scratch log and roller:
       its task starts cmd.exe, which starts node through start /high, so
       what counts is cmd's child. Both processes are measured for each:
       Normal, I/O priority 2 and memory priority 5 for the site and Caddy,
       High, 2 and 5 for voice. The task and its processes are removed again
       whatever happens. Where a task cannot be registered or does not start
       for this account (a build runner's service account), this part says
       SKIP and why.

  -DeployDocs, -InstallVoice and -SetupDomain read another copy of each, so
  the same test runs on the ones from before this change:

      git show origin/main:scripts/deploy/Setup-Domain.ps1 > $env:TEMP\domain-before.ps1
      pwsh -NoProfile -File .\tests\test-service-task-priority.ps1 -SetupDomain $env:TEMP\domain-before.ps1

  Registers and removes one task at a time named Thornswood priority harness
  <guid> (not 'Thornswood Test...', which test-deploy-swaps and
  test-install-server clear away, #1135), stops the cmd.exe and Windows
  PowerShell it started, and removes the scratch folder in TEMP that holds
  voice's log and roller; writes nothing else.
#>
[CmdletBinding()]
param([string]$DeployDocs, [string]$InstallVoice, [string]$SetupDomain, [string]$WatchServices)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Repo = Split-Path -Parent $Here
$deploy = [IO.Path]::Combine($Repo, 'scripts', 'deploy')
if (-not $DeployDocs) { $DeployDocs = [IO.Path]::Combine($deploy, 'Deploy-Docs.ps1') }
if (-not $InstallVoice) { $InstallVoice = [IO.Path]::Combine($deploy, 'Install-Voice.ps1') }
if (-not $SetupDomain) { $SetupDomain = [IO.Path]::Combine($deploy, 'Setup-Domain.ps1') }
if (-not $WatchServices) { $WatchServices = [IO.Path]::Combine($Repo, 'scripts', 'vps', 'Watch-Services.ps1') }

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

# What each task starts, and so which process carries its program: the one the
# task starts, or that one's child.
$installers = @(
    [pscustomobject]@{ Name = 'Deploy-Docs.ps1'; Path = $DeployDocs; Task = 'Thornswood Docs'; Program = 'node, started by the task'; Child = $false; High = $false }
    [pscustomobject]@{ Name = 'Install-Voice.ps1'; Path = $InstallVoice; Task = 'Thornswood Voice'; Program = 'node, started by the task''s cmd.exe'; Child = $true; High = $true }
    [pscustomobject]@{ Name = 'Setup-Domain.ps1'; Path = $SetupDomain; Task = 'Thornswood Web'; Program = 'caddy.exe, started by the task'; Child = $false; High = $false }
    [pscustomobject]@{ Name = 'Watch-Services.ps1'; Path = $WatchServices; Task = 'Thornswood Watch'; Program = 'PowerShell 7, started by the task'; Child = $false; High = $false }
)

# ---- 1. read, not run ------------------------------------------------------------
foreach ($ins in $installers) {
    $ins.Path = [IO.Path]::GetFullPath($ins.Path)
    Write-Host ''
    Write-Host ("{0} ({1}): {2}" -f $ins.Name, $ins.Task, $ins.Path)
    $t = $null; $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($ins.Path, [ref]$t, [ref]$e)
    Yes ('  ' + $ins.Name + ' parses') (-not $e -or $e.Count -eq 0)
    # The scripts it sends to the box that build a task's settings. Value is
    # the text with its escapes taken out (`$ is $, a doubled backtick one)
    # and nothing expanded, which is the script the box runs but for the
    # installer's own variables, still written as names.
    $sent = @($ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
        $n.Value -match 'New-ScheduledTaskSettingsSet' }, $true))
    $calls = @()
    foreach ($s in $sent) {
        $t2 = $null; $e2 = $null
        $inner = [System.Management.Automation.Language.Parser]::ParseInput($s.Value, [ref]$t2, [ref]$e2)
        if ($e2 -and $e2.Count) { Yes ('  the script it sends from line ' + $s.Extent.StartLineNumber + ' parses') $false; continue }
        $calls += @($inner.FindAll({ param($n)
            $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'New-ScheduledTaskSettingsSet' }, $true))
    }
    Yes ('  it builds the task''s settings in one place, in the script it sends to the box (' + $calls.Count + ')') ($calls.Count -eq 1)
    $ins | Add-Member -NotePropertyName Call -NotePropertyValue $null
    $ins | Add-Member -NotePropertyName Asked -NotePropertyValue $null
    if ($calls.Count -ne 1) { continue }
    $call = $calls[0]
    $ins.Call = $call

    # The -Priority the call passes: a number written in it, or Task
    # Scheduler's default of 7 when there is none. Anything else (a variable,
    # an expression) is reported as it is written and fails, because it
    # cannot be read here.
    $asked = 7
    $how = 'none passed, so Task Scheduler''s default'
    $el = $call.CommandElements
    for ($i = 1; $i -lt $el.Count; $i++) {
        $p = $el[$i]
        if ($p -is [System.Management.Automation.Language.CommandParameterAst] -and $p.ParameterName -eq 'Priority') {
            $arg = $p.Argument
            if (-not $arg -and $i + 1 -lt $el.Count) { $arg = $el[$i + 1] }
            if ($arg -is [System.Management.Automation.Language.ConstantExpressionAst] -and $arg.Value -is [int]) {
                $asked = [int]$arg.Value; $how = 'passed as -Priority ' + $asked
            } else {
                $asked = $null; $how = 'passed as ' + $(if ($arg) { $arg.Extent.Text } else { 'nothing' })
            }
        }
    }
    $ins.Asked = $asked
    if ($ins.High) {
        Yes ("  the task's priority is 1, high, never 0, realtime ($asked, $how)") ($asked -is [int] -and $asked -eq 1)
    } else {
        Yes ("  the task's priority is in the normal band 4 to 6 ($asked, $how)") ($asked -is [int] -and $asked -ge 4 -and $asked -le 6)
    }
    # Voice's task command line, as it is written in the script it sends: the
    # one $cmd = ('/c ...' -f ...) line, the format string and what fills it.
    $ins | Add-Member -NotePropertyName Format -NotePropertyValue $null
    if ($ins.High) {
        $m = [regex]::Match([IO.File]::ReadAllText($ins.Path), '`\$cmd = \(''(/c "set THORNSWOOD_SITE=[^\r\n]*?)'' -f ([^\r\n]+)\)')
        Yes '  its task command line is in the script it sends' $m.Success
        if ($m.Success) { $ins.Format = $m.Groups[1].Value }
        Yes '  and starts node through start "" /b /wait /high, on server-log.js running voice (#2166)' ($ins.Format -and $ins.Format.Contains('start "" /b /wait /high "{0}" "{2}" --log "{1}" --days 90 --stamp voice-server.js'))
        Yes '  and hands node''s exit code back as the task''s' ($ins.Format -and $ins.Format.Contains('& call exit %^errorlevel%"'))
    }
}

# ---- 2. run, through Task Scheduler ----------------------------------------------
Write-Host ''
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'SKIP  the task part needs Windows and its Task Scheduler'; Done }
Import-Module ScheduledTasks -ErrorAction SilentlyContinue
if (-not (Get-Module ScheduledTasks)) { Write-Host 'SKIP  the ScheduledTasks module did not load'; Done }

if (-not ('TsServicePriorityProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TsServicePriorityProbe {
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetPriorityClass(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessInformation(IntPtr h, int cls, ref uint info, int size);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref uint info, int size, IntPtr returned);
    // The priority class as GetPriorityClass gives it, ProcessIoPriority (33
    // for NtQueryInformationProcess) and ProcessMemoryPriority (0 for
    // GetProcessInformation). All three need only
    // PROCESS_QUERY_LIMITED_INFORMATION, which an elevated shell has on a
    // SYSTEM process. -1 means it could not be read.
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
    $r = [TsServicePriorityProbe]::Read($id)
    $classes = @{ 0x40 = 'Idle'; 0x4000 = 'BelowNormal'; 0x20 = 'Normal'; 0x8000 = 'AboveNormal'; 0x80 = 'High'; 0x100 = 'RealTime' }
    $class = if ($classes.ContainsKey($r[0])) { $classes[$r[0]] } else { '?' }
    [pscustomobject]@{ Class = $class; Io = $r[1]; Memory = $r[2] }
}
$self = Measure-Priority $PID
Write-Host ("this shell, for comparison: {0}, I/O priority {1}, memory priority {2}" -f $self.Class, $self.Io, $self.Memory)

# SYSTEM as a service, highest, when this shell is elevated and may register
# one: what the three run as on the box. Otherwise the person running this,
# logged on interactively, which needs no admin and no password.
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) {
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $who = 'SYSTEM, as a service, as on the box'
} else {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    $who = $me + ', logged on interactively (not elevated, so not SYSTEM)'
}
$boxPs = Get-BoxPowerShell
$cmdExe = Get-WindowsPath 'System32\cmd.exe'


foreach ($ins in $installers) {
    Write-Host ''
    Write-Host ($ins.Name + ', for real')
    if (-not $ins.Call) { Write-Host '  SKIP  there is no one settings call to run'; continue }
    $settings = & ([scriptblock]::Create($ins.Call.Extent.Text))
    Yes ('  run for real, its settings carry priority ' + $settings.Priority) ($settings.Priority -eq $ins.Asked)

    $name = 'Thornswood priority harness ' + [Guid]::NewGuid().ToString('N')
    $mark = [Guid]::NewGuid().ToString('N')
    $sleep = '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 90 #' + $mark
    $scratch = $null
    if ($ins.High) {
        if (-not $ins.Format) { Write-Host '  SKIP  there is no task command line to run'; continue }
        # Voice's own line: what the outer script fills in at install time,
        # then node, the real Server-Log.js and a stand-in voice that sleeps,
        # in a scratch folder whose name carries the mark (#2166). The
        # measured program is the log writer start starts under cmd, and the
        # voice it starts is measured too, as on the VPS.
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        if (-not $nodeCmd) { Write-Host '  SKIP  node is not on this machine, and the task runs voice under it'; continue }
        $scratch = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-priority-' + $mark)
        New-Item -ItemType Directory -Force -Path $scratch | Out-Null
        $writerAt = Join-Path $scratch 'server-log.js'
        Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'vps', 'Server-Log.js')) -Destination $writerAt
        [IO.File]::WriteAllText((Join-Path $scratch 'voice-server.js'), "setTimeout(function () { }, 90000);`n")
        $fmt = $ins.Format.Replace('$Site', 'https://site.invalid').Replace('$Port', '7999').Replace('$Bind', '127.0.0.1').Replace('$ChatRange', 'off').Replace('$mostSet', '').Replace('$turnSet', '')
        $action = New-ScheduledTaskAction -Execute $cmdExe -Argument ($fmt -f $nodeCmd.Source, (Join-Path $scratch 'voice.log'), $writerAt) -WorkingDirectory $scratch
    } else {
        $action = New-ScheduledTaskAction -Execute $cmdExe `
                                          -Argument ('/c ""' + $boxPs + '" ' + $sleep + '"')
    }
    $child = $null
    $parent = $null
    $voiceKid = $null
    $skip = $null
    Write-Host ("  registering a scratch task, $name, for $who")
    try {
        try {
            Register-ScheduledTask -TaskName $name -Action $action -Settings $settings -Principal $principal -ErrorAction Stop | Out-Null
        } catch {
            $skip = 'a task could not be registered for ' + $who + ': ' + $_.Exception.Message
        }
        if (-not $skip) {
            Start-ScheduledTask -TaskName $name
            for ($i = 0; $i -lt 40 -and -not ($child -and ($voiceKid -or -not $ins.High)); $i++) {
                Start-Sleep -Milliseconds 500
                if ($ins.High) {
                    $child = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
                               Where-Object { "$($_.CommandLine)" -like "*$mark*" -and "$($_.CommandLine)" -like '*server-log.js*' }) | Select-Object -First 1
                    if ($child) { $voiceKid = @(Get-CimInstance Win32_Process -Filter ("Name = 'node.exe' AND ParentProcessId = " + [int]$child.ProcessId)) | Select-Object -First 1 }
                } else {
                    $child = @(Get-CimInstance Win32_Process -Filter ("Name = '" + (Split-Path -Leaf $boxPs) + "'") |
                               Where-Object { "$($_.CommandLine)" -like "*$mark*" }) | Select-Object -First 1
                }
            }
            if ($ins.High -and $child -and -not $voiceKid) { $child = $null }
            if (-not $child) {
                $info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue
                $skip = 'the task was registered but no process of it appeared in 20 s (last result ' + $info.LastTaskResult + '); an account with no session cannot start an interactive task'
            }
        }
        if (-not $skip) {
            $parent = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$child.ParentProcessId)
            $up = Measure-Priority ([int]$child.ParentProcessId)
            $got = Measure-Priority ([int]$child.ProcessId)
            Write-Host ("  the process the task started (cmd.exe): {0}, I/O priority {1}, memory priority {2}" -f $up.Class, $up.Io, $up.Memory)
            Write-Host ("  the program cmd.exe started:            {0}, I/O priority {1}, memory priority {2}" -f $got.Class, $got.Io, $got.Memory)
            Yes '  the measured program is cmd.exe''s child' ($parent -and $parent.Name -eq 'cmd.exe')
            $first = 'the process the task starts'
            $second = 'what that process starts'
            if ($ins.Child) { $second += ' (' + $ins.Program + ')' } else { $first += ' (' + $ins.Program + ')' }
            foreach ($m in @(@($first, $up), @($second, $got))) {
                if ($ins.High) {
                    Yes ('  ' + $m[0] + ' runs at the High priority class (Normal at 4, BelowNormal at 7)') ($m[1].Class -eq 'High')
                } else {
                    Yes ('  ' + $m[0] + ' runs at the Normal priority class (BelowNormal at priority 7)') ($m[1].Class -eq 'Normal')
                }
                Yes ('    with normal I/O priority, 2 (1, low, at priority 7)') ($m[1].Io -eq 2)
                Yes ('    and normal memory priority, 5 (2 at priority 7)') ($m[1].Memory -eq 5)
            }
            if ($voiceKid) {
                $vk = Measure-Priority ([int]$voiceKid.ProcessId)
                Write-Host ("  the voice the log writer started:        {0}, I/O priority {1}, memory priority {2}" -f $vk.Class, $vk.Io, $vk.Memory)
                Yes '  the voice server-log.js starts runs High too, the writer''s own (Windows starts a child of a High process at Normal)' ($vk.Class -eq 'High' -and $vk.Io -eq 2 -and $vk.Memory -eq 5)
            }
        }
    }
    finally {
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
        if ($voiceKid) { Stop-Process -Id ([int]$voiceKid.ProcessId) -Force -ErrorAction SilentlyContinue }
        if ($child) { Stop-Process -Id ([int]$child.ProcessId) -Force -ErrorAction SilentlyContinue }
        if ($parent) { Stop-Process -Id ([int]$parent.ProcessId) -Force -ErrorAction SilentlyContinue }
        # Tried a few times: the log writer, stopped a moment ago, can still
        # hold voice.log open, a file another program has open. Checked below.
        for ($i = 0; $scratch -and $i -lt 20 -and (Test-Path -LiteralPath $scratch); $i++) {
            Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path -LiteralPath $scratch) { Start-Sleep -Milliseconds 250 }
        }
    }
    if ($skip) { Write-Host ('  SKIP  ' + $skip) }
    Yes '  the scratch task is gone again' (-not (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue))
    if ($child) {
        $ids = @([int]$child.ProcessId, [int]$child.ParentProcessId) + @(if ($voiceKid) { [int]$voiceKid.ProcessId })
        Yes '    and so are its processes' (-not (Get-Process -Id $ids -ErrorAction SilentlyContinue))
    }
    if ($scratch) { Yes '    and its scratch folder' (-not (Test-Path -LiteralPath $scratch)) }
}
Done
