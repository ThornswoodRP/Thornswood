<#
  Check-ServerPriority.ps1

      .\scripts\vps\Check-ServerPriority.ps1

  Reads, and changes nothing: the priority the live and dev game servers and
  the live and dev voice services run at on the VPS (#2491).

  Since 12 Oct 2026 they run High (Patrick: "we need to fix it so the
  servers run on high priority"). Install-ThornswoodServer.ps1 and
  Install-Voice.ps1 register each task at priority 1 and start node through
  cmd's start "" /b /wait /high, because the task's priority alone makes only
  its cmd.exe High (tests\test-server-task-priority.ps1). For each of the
  four this prints the task's priority, whether its action starts node
  through start /high, and every node running from that folder with its
  priority class, I/O priority and memory priority (High, 2 and 5 is right).
  A node is the folder's when its own command line or its parent cmd.exe's
  names the folder with a backslash after it, so C:\Thornswood-Server is not
  taken for C:\Thornswood-Server-Dev.

  Ends with ALL HIGH and exit 0, or NOT ALL HIGH and exit 1, naming which.
  Publish-Server.ps1 -TaskOnly (-Channel dev) and Install-Voice.ps1 -TaskOnly
  register a task that is not right again.
#>
[CmdletBinding()]
param(
    [string]$Vps  = '',
    [string]$User = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Send-Script.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')

# Runs on the box, in PowerShell 7. One line per finding, and a
# RESULT|<task>|HIGH or RESULT|<task>|NOT HIGH|<why> line for each task.
$far = @'
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
if (-not ('TsServerPriorityRead' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TsServerPriorityRead {
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessInformation(IntPtr h, int cls, ref uint info, int size);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref uint info, int size, IntPtr returned);
    // ProcessIoPriority (33) and ProcessMemoryPriority (0); -1 when unreadable.
    public static int[] Read(int id) {
        IntPtr h = OpenProcess(0x1000, false, id);
        if (h == IntPtr.Zero) return new int[] { -1, -1 };
        try {
            uint mem = 0, io = 0;
            int m = GetProcessInformation(h, 0, ref mem, 4) ? (int)mem : -1;
            int i = NtQueryInformationProcess(h, 33, ref io, 4, IntPtr.Zero) == 0 ? (int)io : -1;
            return new int[] { i, m };
        } finally { CloseHandle(h); }
    }
}
"@
}
$all = @(Get-CimInstance Win32_Process -EA SilentlyContinue)
$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
foreach ($s in @(
  @('Thornswood Server', 'C:\Thornswood-Server'),
  @('Thornswood Dev Server', 'C:\Thornswood-Server-Dev'),
  @('Thornswood Voice', 'C:\Thornswood-Voice'),
  @('Thornswood Dev Voice', 'C:\Thornswood-Voice-Dev'))) {
  $name = $s[0]; $mark = $s[1] + '\'
  $why = @()
  $t = Get-ScheduledTask -TaskName $name -EA SilentlyContinue
  if (-not $t) {
    'TASK|' + $name + '|not registered'
    $why += 'no task'
  } else {
    $high = @($t.Actions | Where-Object { [string]$_.Arguments -like '*start "" /b /wait /high *' }).Count -gt 0
    'TASK|' + $name + '|priority ' + $t.Settings.Priority + ', ' + $(if ($high) { 'starts node through start /high' } else { 'does not start node through start /high' }) + ', ' + $t.State
    if ($t.Settings.Priority -ne 1) { $why += ('task priority ' + $t.Settings.Priority) }
    if (-not $high) { $why += 'no start /high' }
  }
  $nodes = @($all | Where-Object {
    $_.Name -eq 'node.exe' -and (
      ([string]$_.CommandLine).IndexOf($mark, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      ($byId.ContainsKey([int]$_.ParentProcessId) -and ([string]$byId[[int]$_.ParentProcessId].CommandLine).IndexOf($mark, [StringComparison]::OrdinalIgnoreCase) -ge 0)) })
  if (-not $nodes.Count) { 'NODE|' + $name + '|none running from ' + $s[1]; $why += 'no node running' }
  foreach ($n in $nodes) {
    $class = 'unreadable'
    try { $class = [string](Get-Process -Id ([int]$n.ProcessId) -EA Stop).PriorityClass } catch { }
    $r = [TsServerPriorityRead]::Read([int]$n.ProcessId)
    'NODE|' + $name + '|pid ' + $n.ProcessId + ', ' + $class + ', I/O priority ' + $r[0] + ', memory priority ' + $r[1] + ', started ' + $n.CreationDate
    if ($class -ne 'High') { $why += ('node ' + $n.ProcessId + ' at ' + $class) }
    if ($r[0] -ne 2 -or $r[1] -ne 5) { $why += ('node ' + $n.ProcessId + ' at I/O ' + $r[0] + ', memory ' + $r[1]) }
  }
  if ($why.Count) { 'RESULT|' + $name + '|NOT HIGH|' + ($why -join '; ') } else { 'RESULT|' + $name + '|HIGH' }
}
'@

Write-Host ''
Write-Host '  THORNSWOOD  -  what the game servers and voice run at' -ForegroundColor White
Write-Host ''
$lines = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $far | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
$bad = @()
$seen = 0
foreach ($l in $lines) {
    $f = $l -split '\|'
    switch ($f[0]) {
        'TASK'   { Write-Host ('  {0,-22} task  {1}' -f $f[1], $f[2]) }
        'NODE'   { Write-Host ('  {0,-22} node  {1}' -f $f[1], $f[2]) }
        'RESULT' {
            $seen++
            if ($f[2] -eq 'HIGH') { Write-Host ('  {0,-22} HIGH' -f $f[1]) -ForegroundColor Green }
            else { Write-Host ('  {0,-22} NOT HIGH: {1}' -f $f[1], $f[3]) -ForegroundColor Yellow; $bad += $f[1] }
            Write-Host ''
        }
        default  { Write-Host ('  ' + $l) -ForegroundColor DarkGray }
    }
}
if ($seen -ne 4) {
    Write-Host ('  the box answered for ' + $seen + ' of the four, so this is not a reading of all of them') -ForegroundColor Red
    Write-Host 'NOT ALL HIGH'
    exit 1
}
if ($bad.Count) {
    Write-Host ('  not High: ' + ($bad -join ', ') + '. Publish-Server.ps1 -TaskOnly (-Channel dev) registers a game server''s task again, Install-Voice.ps1 -TaskOnly a voice service''s.') -ForegroundColor Yellow
    Write-Host 'NOT ALL HIGH'
    exit 1
}
Write-Host 'ALL HIGH'
exit 0
