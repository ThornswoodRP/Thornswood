<#
.SYNOPSIS
  Runs ON THE VPS, sent there by Harden-VPS.ps1: turns ssh password login off, turns Remote Desktop off and the Windows services and telemetry the box never uses, and moves Windows Update and its maintenance to 4 AM, leaving ssh on port 22 alone.

.DESCRIPTION
  Do not run this by hand. Harden-VPS.ps1 proves key login works first, from
  your machine, and refuses to send this otherwise; run that instead. It
  sends this file's text on ssh's standard input and Windows PowerShell 5.1
  runs it from there, so nothing of it is ever written on the box (#3035).

  In this order, each step saying what it found and what it did:

    Remote Desktop   fDenyTSConnections set to 1, every enabled inbound allow
                     rule in the Remote Desktop group or on port 3389 turned
                     off, and the Remote Desktop service stopped and set to
                     Disabled. A rule that also covers port 22 is never
                     touched, and neither are the rules that allow ssh.
    services         the Windows services in $IdleServices below, which a
                     box that runs game servers, a site, a bot and build
                     runners with nobody signed in never uses, each stopped
                     and set to Disabled, with the reason beside it (#3186).
                     One that is not installed is said and left.
    Edge             the in-box Microsoft Edge, which nothing on the box runs
                     and whose setup adds an inbound firewall rule with every
                     version (#3896), uninstalled with its own setup, and the
                     EdgeUpdate policy in $EdgePolicies below set so its
                     updater never installs it again. The WebView2 Runtime and
                     the updater stay: the Visual Studio C++ workload the
                     runners build with requires WebView2, and the updater
                     keeps it patched. Should Edge's setup refuse the
                     uninstall (Microsoft lets it on some Windows versions),
                     Edge stays, unused, with the updater told never to install
                     it again, and the run says KEPT with the exit code and
                     where its log is and goes on: the box's own firewall
                     policy ignores the rules its setup adds (Patrick, 27 Oct,
                     q-3896-edge-uninstall-refused, A).
    telemetry        the scheduled tasks in $TelemetryTasks below
                     (DiskSnapshot.exe, CompatTelRunner.exe and the Customer
                     Experience Improvement Program) set to Disabled, and
                     AllowTelemetry set to 0, with the reason beside each
                     (#3213). One that is not on the box is said and left.
    Windows Update   the policy values in $UpdatePolicies below: updates
                     install every day at 4 AM box time, Windows restarts
                     15 minutes after an install that needs it, and its
                     automatic maintenance starts at 4 AM with no random
                     delay (#3213). Windows Update itself stays on: its
                     services are read and left as they are, and a WARN
                     says so if one is Disabled. A WARN too if the box's
                     clock is not Mountain time, since every hour here is
                     the box's own, and if Windows already has a restart
                     set outside 4 AM to 6 AM, which these values do not
                     move.
    sshd_config     PasswordAuthentication no and KbdInteractiveAuthentication
                     no, as the first setting of each (sshd takes the first
                     one it reads) and above the Match block, where a global
                     setting has to be. The new file is checked with
                     sshd -t before it replaces the old one, and the old one
                     is kept beside it as sshd_config.before-harden-<time>,
                     which only SYSTEM and Administrators may read (#3034).
    restart          sshd is restarted by a one time scheduled task a few
                     seconds after this returns, so the answer gets back
                     before the connection goes. A second task puts the old
                     sshd_config back and restarts sshd ten minutes later
                     unless Harden-VPS.ps1 cancels it after proving key login
                     still works: if the change ever locked the key out, the
                     box undoes it on its own.

  Firewall rules are read as the firewall takes them and turned off in the
  store they came from: the box's own policy, then Group Policy refreshed
  (scripts\vps\BoxFirewall.ps1, #3896), or the local store.

  Every line of output starts with one word: CHANGED, WOULD (with -DryRun),
  ALREADY, KEPT, WARN or STOP. STOP means nothing after it was done, and the
  exit code is 1.

.PARAMETER DryRun
  Read everything, change nothing, and say WOULD for each change.

.PARAMETER SshdConfig
  The sshd_config to change. The Windows OpenSSH server's own by default.

.PARAMETER Sshd
  The sshd.exe that checks the new file (sshd -t) before it is used. The one
  the sshd service runs when empty, read from the service, so the check is
  made by the sshd that will read the file: since #1043 that is OpenSSH for
  Windows in C:\Program Files\OpenSSH, not the inbox one in System32.

.PARAMETER Layer
  A file that replaces the functions below that touch Windows (the registry,
  the firewall, services, scheduled tasks, the clock's time zone, sshd -t,
  the copy's rules). Only
  tests\test-harden-vps.ps1 passes it, to run this against stand-ins.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$SshdConfig = (Join-Path $env:ProgramData 'ssh\sshd_config'),
    [string]$Sshd = '',
    [string]$Layer = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RdpGroup = '@FirewallAPI.dll,-28752'
$TsKey = 'HKLM:\System\CurrentControlSet\Control\Terminal Server'
$RestartTask = 'Thornswood sshd restart'

# Windows services the box runs and never uses (#3186). Found running and
# set to start on their own on 21 Oct 2026. The box is a server nobody signs
# in to: it prints nothing, has no desktop, no devices plugged in, nobody to
# notify and no files linked across machines. All 45 svchost processes
# together used about 0.03 of a core, so each of these is a little memory
# and processor time, and the print spooler is attack surface with a history
# (PrintNightmare). Microsoft Edge's update tasks stay: the same updater
# keeps the WebView2 runtime patched, and WebView2 stays because the Visual
# Studio C++ workload requires it (#3896). Edge itself goes, below.
$IdleServices = @(
    @{ Name = 'Spooler'; Why = 'print spooler: nothing prints from the box, and it is the PrintNightmare service' },
    @{ Name = 'DiagTrack'; Why = 'Connected User Experiences and Telemetry: sends usage data to Microsoft' },
    @{ Name = 'SysMain'; Why = 'SysMain (Superfetch): preloads programs a person opens; the box keeps its own running' },
    @{ Name = 'Themes'; Why = 'Themes: the desktop''s look, and nobody signs in to a desktop' },
    @{ Name = 'ShellHWDetection'; Why = 'Shell Hardware Detection: AutoPlay for discs and sticks put in' },
    @{ Name = 'CDPSvc'; Why = 'Connected Devices Platform: phones and PCs paired to a signed in person' },
    @{ Name = 'WpnService'; Why = 'Windows Push Notifications: toasts for a signed in person' },
    @{ Name = 'TrkWks'; Why = 'Distributed Link Tracking Client: follows shortcuts to files moved across machines' }
)

# Telemetry tasks Windows runs from its maintenance and when the box is idle
# (#3213). At 7:04 PM on 21 Oct 2026, with the box idle, DiskSnapshot.exe
# took 16.6% of its processor and CompatTelRunner.exe 16.5%. Patrick, 22 Oct:
# telemetry goes off. DiskSnapshot.exe is no snapshot of anything we keep:
# on 22 Oct the box had no shadow copies and, being a server, no System
# Restore, and the backup is our own Thornswood Backup task, which zips and
# encrypts and never calls it. Each is disabled, not deleted, so
# Enable-ScheduledTask puts it back. PcaPatchDbTask, StartupAppTask and
# DiskFootprint\StorageSense are not telemetry and stay.
$TelemetryTasks = @(
    @{ Path = '\Microsoft\Windows\DiskFootprint\'; Name = 'Diagnostics'; Why = 'DiskSnapshot.exe -z: a record for Microsoft of what fills the disk, not a shadow copy' },
    @{ Path = '\Microsoft\Windows\Application Experience\'; Name = 'Microsoft Compatibility Appraiser'; Why = 'CompatTelRunner.exe: reads every program installed and sends the result to Microsoft' },
    @{ Path = '\Microsoft\Windows\Application Experience\'; Name = 'ProgramDataUpdater'; Why = 'CompatTelRunner.exe -maintenance: the same telemetry, gathered during maintenance' },
    @{ Path = '\Microsoft\Windows\Customer Experience Improvement Program\'; Name = 'Consolidator'; Why = 'Customer Experience Improvement Program: gathers usage data and sends it' },
    @{ Path = '\Microsoft\Windows\Customer Experience Improvement Program\'; Name = 'UsbCeip'; Why = 'Customer Experience Improvement Program: usage data about USB devices, and the box has none' }
)

# Policy values Windows reads as Group Policy (#3213), each with why. Patrick,
# 22 Oct (docs\DECIDED.md): telemetry off, and Windows Update and its
# maintenance run 4 AM to 6 AM box time, at low priority, after the 2:15 AM
# backup. The box's clock is Mountain time, the backup starts at 08:15 UTC
# and the nightly checks at 09:00 UTC, so in box time those are 2:15 AM and
# 3:00 AM in summer and 1:15 AM and 2:00 AM in winter, and the shares have
# 45 minutes each: 4 AM is clear of both all year, and nobody is on before
# 7 AM. On 22 Oct the box had AUOptions 7 (Server's download, then wait for
# somebody to install and restart) and nothing else, so Windows staged
# updates whenever it chose, its maintenance started at its default of 2 AM,
# beside the backup, and UpdateOrchestrator\Reboot_AC was set to restart the
# box by itself at 6:08 AM on 23 Oct.
#
# Each key is one Server 2022's own Group Policy templates write: the update
# ones WindowsUpdate.admx, the maintenance ones msched.admx and
# AllowTelemetry DataCollection.admx. Option 4 installs at the scheduled
# time; option 7 never installs by itself, and Windows had set Reboot_AC
# under it all the same; and NoAutoRebootWithLoggedOnUsers holds a restart
# off only while somebody is signed in, which on this box nobody is, so it is
# not set. The restart is pinned to the install: AlwaysAutoRebootAtScheduledTime
# 1 starts a timer the moment Windows Update installs an update that needs a
# restart, and restarts when AlwaysAutoRebootAtScheduledTimeMinutes runs out
# (15 to 180; 15, the shortest, so an install that takes an hour still ends
# in a restart before 6 AM). Microsoft's "Manage device restarts after
# updates" names exactly these four values as the way to schedule a specific
# install and restart time, and says the timer applies to Windows 10 and
# not 11; Server 2022 is the Windows 10 line. Until 23 Oct 2026 the restart
# was left to active hours alone, and that was measured to miss the window:
# the 4 AM install on 23 Oct needed a restart at 4:06 AM, Windows did not
# take it before 6 AM, and set Reboot_AC to 2:33 AM on 24 Oct instead, the
# night hour it chose after active hours ended, 18 minutes after the backup
# starts and outside 4 AM to 6 AM. Active hours stay set, 6 AM to midnight,
# the 18 hours Windows allows at most (ActiveHoursMaxRange is 8 to 18):
# Microsoft's page says they have no effect while the timer is on, and they
# are what holds a restart Windows sets by itself (an update installed some
# other way) out of the day instead of its default of 8 AM to 5 PM. A
# restart Windows set before these values were is not moved by them; the
# run says when one stands outside the window. The hour Windows looks for
# updates and downloads them has no key outside WSUS (DetectionFrequency
# needs an update server of our own), so only the install is moved. Low
# priority: Windows already runs its update installer (TiWorker.exe) and the
# maintenance tasks at its own background priority, and there is no
# documented setting that lowers them further, so none is set.
$PolicyRoot = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows'
$UpdatePolicies = @(
    @{ Key = "$PolicyRoot\DataCollection"; Name = 'AllowTelemetry'; Type = 'DWord'; Value = 0; Why = 'diagnostic data at Security, the lowest level, which Server allows' },
    @{ Key = "$PolicyRoot\WindowsUpdate\AU"; Name = 'NoAutoUpdate'; Type = 'DWord'; Value = 0; Why = 'Windows Update stays on' },
    @{ Key = "$PolicyRoot\WindowsUpdate\AU"; Name = 'AUOptions'; Type = 'DWord'; Value = 4; Why = 'download, then install on the schedule below, not whenever somebody presses Install' },
    @{ Key = "$PolicyRoot\WindowsUpdate\AU"; Name = 'ScheduledInstallDay'; Type = 'DWord'; Value = 0; Why = 'every day, so an update waits a day at most' },
    @{ Key = "$PolicyRoot\WindowsUpdate\AU"; Name = 'ScheduledInstallTime'; Type = 'DWord'; Value = 4; Why = 'at 4 AM box time, after the backup and the nightly checks' },
    @{ Key = "$PolicyRoot\WindowsUpdate\AU"; Name = 'ScheduledInstallEveryWeek'; Type = 'DWord'; Value = 1; Why = 'every week of the month, as Group Policy writes it beside the day' },
    @{ Key = "$PolicyRoot\WindowsUpdate\AU"; Name = 'AlwaysAutoRebootAtScheduledTime'; Type = 'DWord'; Value = 1; Why = 'the restart an install needs comes on a timer started by the install, so in the 4 AM to 6 AM window' },
    @{ Key = "$PolicyRoot\WindowsUpdate\AU"; Name = 'AlwaysAutoRebootAtScheduledTimeMinutes'; Type = 'DWord'; Value = 15; Why = 'the timer: 15 minutes, the shortest Windows takes, so the restart comes about 4:20 AM' },
    @{ Key = "$PolicyRoot\WindowsUpdate"; Name = 'SetActiveHours'; Type = 'DWord'; Value = 1; Why = 'Windows never restarts for an update inside the active hours below' },
    @{ Key = "$PolicyRoot\WindowsUpdate"; Name = 'ActiveHoursStart'; Type = 'DWord'; Value = 6; Why = 'active from 6 AM, so a restart for the 4 AM install can come only before 6 or after midnight' },
    @{ Key = "$PolicyRoot\WindowsUpdate"; Name = 'ActiveHoursEnd'; Type = 'DWord'; Value = 0; Why = 'to midnight: 18 hours, the most Windows allows' },
    @{ Key = "$PolicyRoot\Task Scheduler\Maintenance"; Name = 'Activation Boundary'; Type = 'String'; Value = '2000-01-01T04:00:00'; Why = 'automatic maintenance starts at 4 AM box time, not its default of 2 AM beside the backup' },
    @{ Key = "$PolicyRoot\Task Scheduler\Maintenance"; Name = 'Randomized'; Type = 'DWord'; Value = 0; Why = 'no random delay, which unset is up to 4 hours past the start' }
)
# Windows Update's own services. Read, never changed: a WARN says when one is
# Disabled, since then nothing installs at 4 AM.
$UpdateServices = @(
    @{ Name = 'wuauserv'; Why = 'Windows Update' },
    @{ Name = 'UsoSvc'; Why = 'Update Orchestrator, which starts the scheduled install' }
)
$BoxTimeZone = 'Mountain Standard Time'
# Windows' own restart for an update, which it sets when an install needs one.
$RestartTask = @{ Path = '\Microsoft\Windows\UpdateOrchestrator\'; Name = 'Reboot_AC' }
$RollbackTask = 'Thornswood harden rollback'

# Microsoft Edge (#3896). Measured on 26 Oct 2026: the in-box Edge (EdgeUpdate
# brand INBX), which nothing on the box runs (one profile, Administrator's,
# last written 12 Sep 2026; no process loads it), and whose setup adds an
# inbound "Microsoft Edge (mDNS-In)" rule on UDP 5353 with every new version
# (one added 24 Oct 2026). Chromium's installer adds that rule with no policy
# or check in its way, so the browser goes. Patrick, 27 Oct 2026 (B). Its
# updater stays for the WebView2 Runtime, so the updater's own policy keeps it
# from putting Edge back: Install{<Edge's app id>} 0 is "do not allow
# installation" in Microsoft's EdgeUpdate policy, for that app only.
# Update{...} is not set: should the uninstall ever be refused, an Edge left on
# the box must still be patched.
$EdgeAppId = '{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}'
$EdgeUninstallKey = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge'
$EdgePolicies = @(
    @{ Key = 'HKLM:\SOFTWARE\Policies\Microsoft\EdgeUpdate'; Name = ('Install' + $EdgeAppId); Type = 'DWord'; Value = 0; Why = 'the Edge updater never installs Edge on the box again; it still updates the WebView2 Runtime' }
)

# ---------------------------------------------------------------- the layer ---
# Everything that touches Windows goes through these, so the harness can put
# stand-ins in their place with -Layer and run the rest of this for real.

function Get-RdpDeny {
    $v = Get-ItemProperty -LiteralPath $TsKey -Name fDenyTSConnections -ErrorAction SilentlyContinue
    if ($null -eq $v) { return -1 }
    return [int]$v.fDenyTSConnections
}
function Set-RdpDeny { Set-ItemProperty -LiteralPath $TsKey -Name fDenyTSConnections -Value 1 -Type DWord }

# Enabled inbound rules the firewall takes, each as Name, DisplayName,
# Action, Group, Ports and Store (GroupPolicy for the box's own policy, Local
# for the local store; #3896).
function Get-InboundRules {
    foreach ($r in @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -ErrorAction SilentlyContinue)) {
        $pf = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
        [pscustomobject]@{
            Name = [string]$r.Name; DisplayName = [string]$r.DisplayName; Action = [string]$r.Action
            Group = [string]$r.Group; Ports = @(@($pf.LocalPort) | ForEach-Object { [string]$_ })
            Store = [string]$r.PolicyStoreSourceType
        }
    }
}
function Disable-InboundRule([string]$Name, [string]$Store = 'GroupPolicy') {
    if ($Store -eq 'Local') { Disable-NetFirewallRule -PolicyStore PersistentStore -Name $Name; return }
    Disable-NetFirewallRule -PolicyStore localhost -Name $Name
    Sync-ThornswoodFirewall
}

# The in-box Edge as its uninstall entry says it, Version and Setup (its
# setup.exe) and Arguments (what its uninstall entry runs it with), or $null
# when it is not installed.
function Get-EdgeInstall {
    $v = Get-ItemProperty -LiteralPath $EdgeUninstallKey -ErrorAction SilentlyContinue
    if ($null -eq $v -or -not $v.UninstallString) { return $null }
    $s = [string]$v.UninstallString
    $exe = $s; $rest = ''
    if ($s.StartsWith('"')) { $end = $s.IndexOf('"', 1); $exe = $s.Substring(1, $end - 1); $rest = $s.Substring($end + 1).Trim() }
    return [pscustomobject]@{ Version = [string]$v.DisplayVersion; Setup = $exe; Arguments = $rest }
}
# Runs Edge's own uninstall, with --force-uninstall so it does not stop to
# ask, and returns its exit code.
function Remove-EdgeInstall($Edge) {
    return [int](Start-Process -FilePath $Edge.Setup -ArgumentList ($Edge.Arguments + ' --force-uninstall') -Wait -PassThru).ExitCode
}

function Get-TermService {
    $s = Get-Service -Name TermService -ErrorAction SilentlyContinue
    if (-not $s) { return $null }
    return [pscustomobject]@{ Status = [string]$s.Status; StartType = [string]$s.StartType }
}
function Stop-TermService { Stop-Service -Name TermService -Force }
function Disable-TermService { Set-Service -Name TermService -StartupType Disabled }

function Get-IdleService([string]$Name) {
    $s = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $s) { return $null }
    return [pscustomobject]@{ Status = [string]$s.Status; StartType = [string]$s.StartType }
}
function Stop-IdleService([string]$Name) { Stop-Service -Name $Name -Force }
function Disable-IdleService([string]$Name) { Set-Service -Name $Name -StartupType Disabled }

# A scheduled task's state (Ready, Running, Disabled), or $null when the box
# has no such task.
function Get-WindowsTask([string]$Path, [string]$Name) {
    $t = Get-ScheduledTask -TaskPath $Path -TaskName $Name -ErrorAction SilentlyContinue
    if (-not $t) { return $null }
    return [string]$t.State
}
function Disable-WindowsTask([string]$Path, [string]$Name) { Disable-ScheduledTask -TaskPath $Path -TaskName $Name | Out-Null }

# A registry value, or $null when it is not set.
function Get-PolicyValue([string]$Key, [string]$Name) {
    $v = Get-ItemProperty -LiteralPath $Key -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $v) { return $null }
    return $v.$Name
}
function Set-PolicyValue([string]$Key, [string]$Name, $Value, [string]$Type) {
    if (-not (Test-Path -LiteralPath $Key)) { New-Item -Path $Key -Force | Out-Null }
    New-ItemProperty -LiteralPath $Key -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
}

function Get-BoxTimeZone { return [string](Get-TimeZone).Id }

# When a scheduled task runs next, or $null when it is not set to.
function Get-TaskNextRun([string]$Path, [string]$Name) {
    $t = Get-ScheduledTask -TaskPath $Path -TaskName $Name -ErrorAction SilentlyContinue
    if (-not $t) { return $null }
    $next = ($t | Get-ScheduledTaskInfo).NextRunTime
    if (-not $next -or $next.Year -lt 2000) { return $null }
    return [datetime]$next
}

# The program the sshd service runs, without quotes or arguments.
function Get-SshdExe {
    $p = [string](Get-CimInstance -ClassName Win32_Service -Filter "Name='sshd'" -ErrorAction Stop).PathName
    if (-not $p) { throw 'there is no sshd service' }
    if ($p.StartsWith('"')) { return $p.Substring(1, $p.IndexOf('"', 1) - 1) }
    if ($p -match '^(.*?\.exe)\b') { return $Matches[1] }
    return $p
}

function Test-SshdFile([string]$Path) {
    $exe = $Sshd
    if (-not $exe) { $exe = Get-SshdExe }
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(& $exe -t -f $Path 2>&1 | ForEach-Object { [string]$_ })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Ok = ($rc -eq 0); Said = ($out -join ' ') }
}

# A task, not Restart-Service here: an ssh session's own processes go with it,
# and restarting sshd from inside the session could cut this answer off.
function Start-SshdRestart {
    $a = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ("-NoProfile -Command `"Start-Sleep -Seconds 5; Restart-Service sshd -Force; Unregister-ScheduledTask -TaskName '" + $RestartTask + "' -Confirm:`$false`"")
    $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $RestartTask -Action $a -Principal $p -Force | Out-Null
    Start-ScheduledTask -TaskName $RestartTask
}

function Register-Rollback([string]$Backup) {
    $cmd = "Copy-Item -LiteralPath '" + $Backup + "' -Destination '" + $SshdConfig + "' -Force; Restart-Service sshd -Force; Unregister-ScheduledTask -TaskName '" + $RollbackTask + "' -Confirm:`$false"
    $a = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ('-NoProfile -Command "' + $cmd + '"')
    $t = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(10))
    $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $RollbackTask -Action $a -Trigger $t -Principal $p -Force | Out-Null
}

# Makes $Path an empty file only SYSTEM and Administrators may open, taking
# nothing from its folder (#3034). C:\ProgramData\ssh gives every signed in
# account read, as Windows OpenSSH installs it, and a file made there takes
# that rule, so a copy made there plainly is open to every account on the
# box. The rules are set while the file is empty, so its content is never
# open, and they are the ones administrators_authorized_keys has.
function New-PrivateFile([string]$Path) {
    [IO.File]::WriteAllBytes($Path, [byte[]]@())
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($s in 'S-1-5-18', 'S-1-5-32-544') {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', 'Allow')))
    }
    $item = Get-Item -LiteralPath $Path -Force
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, $acl)
    # Read back, not taken from the call: a FileSecurity already written once
    # writes nothing the second time and says nothing (#3034, on the box).
    $got = Get-Acl -LiteralPath $Path
    $who = @($got.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
    if (-not $got.AreAccessRulesProtected -or ($who -join ',') -ne 'S-1-5-18,S-1-5-32-544') { throw ($Path + ' did not take SYSTEM and Administrators alone: ' + ($who -join ', ')) }
}

# ---- BoxFirewall.ps1 (copy) ----
function Sync-ThornswoodFirewall {
    # scripts\vps\BoxFirewall.ps1 (#3896): the firewall takes the box's policy
    # store when Group Policy is refreshed, so every change to the store ends here.
    $was = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $said = @(& gpupdate.exe /target:computer /force 2>&1 | ForEach-Object { [string]$_ } | Where-Object { $_.Trim() })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $was
    if ($rc -ne 0) { throw ('gpupdate did not refresh the box''s policy, so the firewall has not taken the change (exit ' + $rc + '): ' + ($said -join ' ')) }
}
# ---- end BoxFirewall.ps1 ----

if ($Layer) { . $Layer }

# ---- BoxGuard.ps1 (copy) ----
function Get-ThornswoodBoxRefusal {
    # scripts\vps\BoxGuard.ps1 says why this asks Windows rather than looking
    # for the game, and why it refuses when it cannot tell (#3041).
    try { $type = [int](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).ProductType }
    catch { return ('Windows did not say whether this is a server (' + $_.Exception.Message + '), so it is not taken for the box') }
    if ($type -eq 2 -or $type -eq 3) { return '' }
    if ($type -eq 1) { return 'this is a Windows workstation, a gaming PC or a developer''s machine, not the box' }
    return ('Windows gives this machine product type ' + $type + ', which is not a server, so it is not taken for the box')
}
# ---- end BoxGuard.ps1 ----

# ---------------------------------------------------------------- the file ---
# Sets Key to Value everywhere sshd would read it, and above the first Match
# line when no global line says it: sshd takes the first value it reads, and a
# line under Match applies only to that match.
function Set-SshdOption([string[]]$Lines, [string]$Key, [string]$Value) {
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($l in $Lines) { $out.Add($l) }
    $rx = '^(\s*)' + [regex]::Escape($Key) + '(\s+|\s*=\s*)(\S+)(.*)$'
    $matchAt = $out.Count
    for ($i = 0; $i -lt $out.Count; $i++) { if ($out[$i] -match '^\s*Match\s') { $matchAt = $i; break } }
    $global = $false
    for ($i = 0; $i -lt $out.Count; $i++) {
        $m = [regex]::Match($out[$i], $rx, 'IgnoreCase')
        if (-not $m.Success) { continue }
        if ($i -lt $matchAt) { $global = $true }
        if ($m.Groups[3].Value -ne $Value) { $out[$i] = $m.Groups[1].Value + $Key + ' ' + $Value + $m.Groups[4].Value }
    }
    if (-not $global) {
        $at = -1
        for ($i = 0; $i -lt $matchAt; $i++) {
            if ($out[$i] -match ('^\s*#\s*' + [regex]::Escape($Key) + '\b')) { $at = $i + 1; break }
        }
        if ($at -lt 0) { $at = $matchAt }
        $out.Insert($at, $Key + ' ' + $Value)
    }
    return , ($out.ToArray())
}

$changes = 0
$stopped = $false
function Say([string]$word, [string]$what) { Write-Output ($word + ' ' + $what) }
function Change([string]$what) {
    $script:changes++
    if ($DryRun) { Say 'WOULD' $what } else { Say 'CHANGED' $what }
}

function Invoke-Harden {
    # Only ever on the box (BoxGuard.ps1, carried below its layer).
    if (-not $Layer) {
        $notBox = Get-ThornswoodBoxRefusal
        if ($notBox) { $script:stopped = $true; Say 'STOP' ($notBox + '. Run Harden-VPS.ps1 on your machine; it sends this to the box.'); return }
    }

    # ---------------------------------------------------------- ssh stays ---
    $rules = @(Get-InboundRules)
    $sshRules = @($rules | Where-Object { $_.Action -eq 'Allow' -and ($_.Ports -contains '22') })
    if ($sshRules.Count) {
        foreach ($r in $sshRules) { Say 'KEPT' ("ssh: firewall rule '" + $r.DisplayName + "' allows port 22, left on") }
    } else {
        Say 'WARN' 'no enabled firewall rule names port 22; ssh is reaching the box some other way (a rule for any port, or the firewall off). Nothing here changes that.'
    }

    # ---------------------------------------------------- Remote Desktop ---
    $deny = Get-RdpDeny
    if ($deny -eq 1) { Say 'ALREADY' 'Remote Desktop connections refused (fDenyTSConnections 1)' }
    else {
        if (-not $DryRun) { Set-RdpDeny }
        Change ('Remote Desktop connections refused (fDenyTSConnections ' + $deny + ' to 1)')
    }

    $rdpRules = @($rules | Where-Object { $_.Action -eq 'Allow' -and ($_.Group -eq $RdpGroup -or $_.Ports -contains '3389') })
    foreach ($r in $rdpRules) {
        if ($r.Ports -contains '22') { Say 'KEPT' ("firewall rule '" + $r.DisplayName + "' covers port 22 as well as Remote Desktop, so it was left on. Look at it by hand."); continue }
        if (-not $DryRun) { Disable-InboundRule $r.Name $r.Store }
        Change ("firewall rule '" + $r.DisplayName + "' turned off (allowed " + (($r.Ports | Where-Object { $_ }) -join ',') + ')')
    }
    if (-not $rdpRules.Count) { Say 'ALREADY' 'no enabled firewall rule lets Remote Desktop in' }

    $ts = Get-TermService
    if (-not $ts) { Say 'ALREADY' 'the Remote Desktop service is not installed' }
    else {
        if ($ts.Status -ne 'Stopped') {
            if (-not $DryRun) { Stop-TermService }
            Change ('Remote Desktop service stopped (was ' + $ts.Status + ')')
        } else { Say 'ALREADY' 'Remote Desktop service stopped' }
        if ($ts.StartType -ne 'Disabled') {
            if (-not $DryRun) { Disable-TermService }
            Change ('Remote Desktop service set to Disabled (was ' + $ts.StartType + ')')
        } else { Say 'ALREADY' 'Remote Desktop service Disabled' }
    }

    # ---------------------------------------------- services it never uses ---
    foreach ($svc in $IdleServices) {
        $st = Get-IdleService $svc.Name
        if (-not $st) { Say 'ALREADY' ($svc.Name + ' is not installed (' + $svc.Why + ')'); continue }
        if ($st.Status -ne 'Stopped') {
            if (-not $DryRun) { Stop-IdleService $svc.Name }
            Change ($svc.Name + ' stopped (was ' + $st.Status + '): ' + $svc.Why)
        } else { Say 'ALREADY' ($svc.Name + ' stopped') }
        if ($st.StartType -ne 'Disabled') {
            if (-not $DryRun) { Disable-IdleService $svc.Name }
            Change ($svc.Name + ' set to Disabled (was ' + $st.StartType + ')')
        } else { Say 'ALREADY' ($svc.Name + ' Disabled') }
    }

    # --------------------------------------------------------- telemetry ---
    foreach ($t in $TelemetryTasks) {
        $full = $t.Path + $t.Name
        $state = Get-WindowsTask $t.Path $t.Name
        if ($null -eq $state) { Say 'ALREADY' ($full + ' is not on the box (' + $t.Why + ')'); continue }
        if ($state -eq 'Disabled') { Say 'ALREADY' ($full + ' Disabled'); continue }
        if (-not $DryRun) { Disable-WindowsTask $t.Path $t.Name }
        Change ($full + ' set to Disabled (was ' + $state + '): ' + $t.Why)
    }

    # -------------------------------------------------------------- Edge ---
    foreach ($v in $EdgePolicies) {
        $have = Get-PolicyValue $v.Key $v.Name
        if ($null -ne $have -and [string]$have -eq [string]$v.Value) { Say 'ALREADY' ($v.Name + ' is ' + $v.Value); continue }
        if (-not $DryRun) { Set-PolicyValue $v.Key $v.Name $v.Value $v.Type }
        Change ($v.Name + ' set to ' + $v.Value + ' (was ' + $(if ($null -eq $have) { 'not set' } else { [string]$have }) + '): ' + $v.Why)
    }
    $edge = Get-EdgeInstall
    if (-not $edge) { Say 'ALREADY' 'Microsoft Edge is not installed (#3896)' }
    elseif ($DryRun) { Change ('Microsoft Edge ' + $edge.Version + ' uninstalled with its own setup (' + $edge.Setup + '): nothing on the box runs it, and its setup adds an inbound firewall rule with every version (#3896)') }
    else {
        $code = Remove-EdgeInstall $edge
        $left = Get-EdgeInstall
        # Patrick, 27 Oct, q-3896-edge-uninstall-refused, A: a refused uninstall
        # keeps Edge, blocked from coming back, and the run goes on.
        if ($left) { Say 'KEPT' ('Microsoft Edge ' + $left.Version + ' is still installed: its setup refused the uninstall (exit ' + $code + '; its log is msedge_installer.log in C:\Windows\SystemTemp or C:\Windows\Temp). It stays unused, the updater is told never to install it again, and the box''s own firewall policy ignores the rules its setup adds (#3896).') }
        else { Change ('Microsoft Edge ' + $edge.Version + ' uninstalled with its own setup (exit ' + $code + '): nothing on the box runs it, and its setup added an inbound firewall rule with every version (#3896)') }
    }

    # ---------------------------------------------------- Windows Update ---
    $tz = Get-BoxTimeZone
    if ($tz -eq $BoxTimeZone) { Say 'ALREADY' ("the box's clock is " + $tz + ', so the hours below are Mountain time') }
    else { Say 'WARN' ("the box's clock is " + $tz + ', not ' + $BoxTimeZone + ', so 4 AM below is not 4 AM Mountain and may fall beside the backup or the nightly checks. Nothing here changes the clock.') }

    foreach ($v in $UpdatePolicies) {
        $have = Get-PolicyValue $v.Key $v.Name
        if ($null -ne $have -and [string]$have -eq [string]$v.Value) { Say 'ALREADY' ($v.Name + ' is ' + $v.Value); continue }
        if (-not $DryRun) { Set-PolicyValue $v.Key $v.Name $v.Value $v.Type }
        Change ($v.Name + ' set to ' + $v.Value + ' (was ' + $(if ($null -eq $have) { 'not set' } else { [string]$have }) + '): ' + $v.Why)
    }

    # A restart Windows set before the values above were, read only: they
    # pin the restart of the next install, not one already set.
    $next = Get-TaskNextRun $RestartTask.Path $RestartTask.Name
    $when = $(if ($next) { $next.ToString('yyyy-MM-dd h:mm tt', [Globalization.CultureInfo]::InvariantCulture) } else { '' })
    if (-not $next) { Say 'ALREADY' 'Windows has no restart for an update set' }
    elseif ($next.Hour -ge 4 -and $next.Hour -lt 6) { Say 'ALREADY' ('Windows has its restart for an update set for ' + $when + ', inside 4 AM to 6 AM') }
    else { Say 'WARN' ('Windows has a restart for an update set for ' + $when + ', outside 4 AM to 6 AM. It was set by an install before the values above, which pin the restart of the next install, so it stands. Nothing here moves it.') }

    # The same read as the services above, and nothing more: Windows Update stays on.
    foreach ($svc in $UpdateServices) {
        $st = Get-IdleService $svc.Name
        if (-not $st) { Say 'WARN' ($svc.Name + ' (' + $svc.Why + ') is not installed, so nothing installs at 4 AM'); continue }
        if ($st.StartType -eq 'Disabled') { Say 'WARN' ($svc.Name + ' (' + $svc.Why + ') is Disabled, so nothing installs at 4 AM. Windows Update stays on (#3213), but what turned this off is found before it is turned back on, so it is left.'); continue }
        Say 'KEPT' ($svc.Name + ' (' + $svc.Why + ') left as it is: ' + $st.Status + ', ' + $st.StartType)
    }

    # ------------------------------------------------------- sshd_config ---
    if (-not (Test-Path -LiteralPath $SshdConfig)) { $script:stopped = $true; Say 'STOP' ("there is no sshd_config at " + $SshdConfig + ". sshd was not touched."); return }
    $text = [IO.File]::ReadAllText($SshdConfig)
    $nl = "`n"; if ($text.Contains("`r`n")) { $nl = "`r`n" }
    $lines = @($text -split "`r?`n")
    if ($lines.Count -and $lines[$lines.Count - 1] -eq '') { $lines = @($lines[0..($lines.Count - 2)]) }
    $new = $lines
    foreach ($k in 'PasswordAuthentication', 'KbdInteractiveAuthentication') { $new = Set-SshdOption $new $k 'no' }
    $newText = ($new -join $nl) + $nl

    if ($newText -eq (($lines -join $nl) + $nl)) {
        Say 'ALREADY' 'sshd_config: PasswordAuthentication no, KbdInteractiveAuthentication no'
    } else {
        # The new file is checked from a temp copy first, so a line sshd does
        # not understand never reaches the one it starts from.
        $cand = [IO.Path]::GetTempFileName()
        [IO.File]::WriteAllText($cand, $newText, (New-Object Text.UTF8Encoding($false)))
        try { $check = Test-SshdFile $cand }
        finally { Remove-Item -LiteralPath $cand -Force -ErrorAction SilentlyContinue }
        if (-not $check.Ok) {
            $script:stopped = $true
            Say 'STOP' ('sshd -t refused the new sshd_config, so the old one is still in place and sshd was not restarted: ' + $check.Said)
            return
        }
        if ($DryRun) {
            Change 'sshd_config: PasswordAuthentication no, KbdInteractiveAuthentication no (sshd -t accepts the new file), then sshd restarted'
        } else {
            $backup = $SshdConfig + '.before-harden-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
            # Byte for byte, into a file only SYSTEM and Administrators may
            # open, not Copy-Item's, which takes the folder's rules.
            New-PrivateFile $backup
            [IO.File]::WriteAllBytes($backup, [IO.File]::ReadAllBytes($SshdConfig))
            # Written in place, so the file keeps the permissions sshd insists on.
            [IO.File]::WriteAllText($SshdConfig, $newText, (New-Object Text.UTF8Encoding($false)))
            Change ('sshd_config: PasswordAuthentication no, KbdInteractiveAuthentication no (old file kept as ' + $backup + ')')
            Register-Rollback $backup
            Say 'CHANGED' ("a task named '" + $RollbackTask + "' puts the old sshd_config back in ten minutes unless Harden-VPS.ps1 cancels it once key login is proven again")
            Start-SshdRestart
            Say 'CHANGED' 'sshd restarts in about five seconds'
        }
    }
}

try { Invoke-Harden }
catch {
    $stopped = $true
    Say 'STOP' ('it failed partway, at: ' + $_.Exception.Message)
}
finally {
    if ($DryRun) { Say 'DONE' ([string]$changes + ' change(s) would be made. Nothing was changed.') }
    elseif ($stopped) { Say 'DONE' ([string]$changes + ' change(s) made before it stopped.') }
    else { Say 'DONE' ([string]$changes + ' change(s) made.') }
}
if ($stopped) { exit 1 }
exit 0
