<#
  test-harden-vps.ps1

      pwsh -NoProfile -File .\tests\test-harden-vps.ps1

  scripts\vps\Harden-VPS.ps1 refuses unless key login is proven, and
  scripts\vps\vps-harden.ps1 turns ssh password login and Remote Desktop off
  on the box without ever touching ssh on port 22.

  WHY. Issue #450. Patrick, 28 September: password login off once key login
  is proven, and Remote Desktop off ("I use SSH not RDP"). Both servers run on
  that one box and ssh is the only way in that is not the provider's console,
  so the order and the refusals matter more than the change itself: a
  hardening that ran without the key proven would lock everybody out.

  HOW. NEVER CONNECTS. Two halves.

  The box half runs vps-harden.ps1 here, in this process, with -Layer: a
  stand-in for every function in it that touches Windows (the registry value,
  the firewall rules, the Remote Desktop service, sshd -t, the scheduled
  tasks) that keeps its state in a table this harness reads. The sshd_config
  it edits is a copy of the Windows OpenSSH default in a temp folder. It
  checks: a dry run changes nothing; a real run sets PasswordAuthentication no
  and KbdInteractiveAuthentication no above the Match block, keeps the old
  file, turns the Remote Desktop rules and service off, leaves every rule for
  port 22 on, and arms the rollback and the restart; a second run changes
  nothing; a file sshd -t refuses is never put in place. Since #3213 also:
  the telemetry tasks end up Disabled and AllowTelemetry 0; Windows Update
  is not turned off (its services untouched) and installs every day at
  4 AM; automatic maintenance starts at 4 AM with no random delay; 4 AM is
  clear of the backup (Install-Backup.ps1 -At) and the nightly checks
  (nightly.yml's cron) in summer and in winter; the restart an install
  needs comes on the install's own timer, inside 4 to 6 AM, active hours
  still leave 4 to 6 AM out, and nothing in it restarts the box; a restart
  Windows already set outside the window is said with WARN and left. And
  that every
  command in it that changes Windows sits inside a layer function, so the
  stand-in covers all of them.

  The machine half runs Harden-VPS.ps1 with ssh, scp and ssh-keygen as
  stand-ins (functions win over programs of the same name). ssh answers the
  key probe as told, names login methods from the stand-in sshd_config, and,
  given the script Send-Script.ps1 sends on its standard input, checks it
  carries the whole of vps-harden.ps1 and runs that file against the
  stand-in layer with the arguments the script gave it. It checks: no pinned
  key, or no key login, means a refusal before anything is sent; nothing is
  ever copied to the box (#3035); -WhatIf runs the box read only; a real run
  ends with key login proven, the rollback cancelled, password login refused
  and the port closed, and says FAIL when the port still answers.
  tests\test-3035-file-script.ps1 runs the sent form itself, in a process of
  its own.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$Box = Join-Path $repo 'scripts\vps\vps-harden.ps1'
$Driver = Join-Path $repo 'scripts\vps\Harden-VPS.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-harden-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)

# The Windows OpenSSH server's own sshd_config, as the box had it on
# 28 September (only the lines that matter, and its comments).
$defaultCfg = @(
    '# This is the sshd server system-wide configuration file.  See',
    '# sshd_config(5) for more information.',
    '',
    '#Port 22',
    '#PubkeyAuthentication yes',
    '',
    'AuthorizedKeysFile	.ssh/authorized_keys',
    '',
    '# To disable tunneled clear text passwords, change to no here!',
    '#PasswordAuthentication yes',
    '#PermitEmptyPasswords no',
    '',
    '# override default of no subsystems',
    'Subsystem	sftp	sftp-server.exe',
    '',
    '# Example of overriding settings on a per-user basis',
    '#Match User anoncvs',
    '#	AllowTcpForwarding no',
    '',
    'Match Group administrators',
    '       AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys'
) -join "`r`n"
$defaultCfg += "`r`n"

$layerText = @'
function Get-RdpDeny { return [int]$global:Fake.fDeny }
function Set-RdpDeny { $global:Fake.fDeny = 1; $global:Fake.log.Add('Set-RdpDeny') }
function Get-InboundRules {
    foreach ($r in $global:Fake.rules) {
        if ($r.Enabled) { [pscustomobject]@{ Name = $r.Name; DisplayName = $r.DisplayName; Action = $r.Action; Group = $r.Group; Ports = @($r.Ports); Store = $r.Store } }
    }
}
function Disable-InboundRule([string]$Name, [string]$Store) {
    foreach ($r in $global:Fake.rules) { if ($r.Name -eq $Name) { $r.Enabled = $false } }
    $global:Fake.log.Add('Disable-InboundRule ' + $Name)
    $global:Fake.stores[$Name] = $Store
}
function Get-EdgeInstall { return $global:Fake.edge }
function Remove-EdgeInstall($Edge) {
    $global:Fake.log.Add('Remove-EdgeInstall ' + $Edge.Setup + ' ' + $Edge.Arguments)
    if (-not $global:Fake.edgeRefuses) { $global:Fake.edge = $null }
    return [int]$global:Fake.edgeCode
}
function Get-TermService {
    if (-not $global:Fake.term) { return $null }
    return [pscustomobject]@{ Status = $global:Fake.term.Status; StartType = $global:Fake.term.StartType }
}
function Stop-TermService { $global:Fake.term.Status = 'Stopped'; $global:Fake.log.Add('Stop-TermService') }
function Disable-TermService { $global:Fake.term.StartType = 'Disabled'; $global:Fake.log.Add('Disable-TermService') }
function Get-IdleService([string]$Name) {
    $s = $global:Fake.svcs[$Name]
    if (-not $s) { return $null }
    return [pscustomobject]@{ Status = $s.Status; StartType = $s.StartType }
}
function Stop-IdleService([string]$Name) { $global:Fake.svcs[$Name].Status = 'Stopped'; $global:Fake.log.Add('Stop-IdleService ' + $Name) }
function Disable-IdleService([string]$Name) { $global:Fake.svcs[$Name].StartType = 'Disabled'; $global:Fake.log.Add('Disable-IdleService ' + $Name) }
function Get-WindowsTask([string]$Path, [string]$Name) {
    $t = $global:Fake.tasks[$Path + $Name]
    if (-not $t) { return $null }
    return $t.State
}
function Disable-WindowsTask([string]$Path, [string]$Name) { $global:Fake.tasks[$Path + $Name].State = 'Disabled'; $global:Fake.log.Add('Disable-WindowsTask ' + $Path + $Name) }
function Get-PolicyValue([string]$Key, [string]$Name) {
    if (-not $global:Fake.reg.ContainsKey($Key + '|' + $Name)) { return $null }
    return $global:Fake.reg[$Key + '|' + $Name].Value
}
function Set-PolicyValue([string]$Key, [string]$Name, $Value, [string]$Type) {
    $global:Fake.reg[$Key + '|' + $Name] = @{ Value = $Value; Type = $Type }
    $global:Fake.log.Add('Set-PolicyValue ' + $Name)
}
function Get-BoxTimeZone { return $global:Fake.tz }
function Get-TaskNextRun([string]$Path, [string]$Name) {
    if (-not $global:Fake.next.ContainsKey($Path + $Name)) { return $null }
    return $global:Fake.next[$Path + $Name]
}
function Test-SshdFile([string]$Path) {
    $global:Fake.checked.Add([IO.File]::ReadAllText($Path))
    return [pscustomobject]@{ Ok = [bool]$global:Fake.sshdOk; Said = 'line 12: Bad configuration option: KbdInteractiveAuthentication' }
}
function Start-SshdRestart { $global:Fake.restarts++; $global:Fake.log.Add('Start-SshdRestart') }
function Register-Rollback([string]$Backup) { $global:Fake.rollback = $Backup; $global:Fake.log.Add('Register-Rollback') }
function New-PrivateFile([string]$Path) {
    $global:Fake.private.Add([pscustomobject]@{ Path = $Path; Existed = (Test-Path -LiteralPath $Path) })
    [IO.File]::WriteAllBytes($Path, [byte[]]@())
    $global:Fake.log.Add('New-PrivateFile')
}
'@
$Layer = Join-Path $tmp 'layer.ps1'
[IO.File]::WriteAllText($Layer, $layerText, $utf8)

function New-Fake {
    $global:Fake = @{
        fDeny = 0
        rules = @(
            @{ Name = 'RemoteDesktop-UserMode-In-TCP'; DisplayName = 'Remote Desktop - User Mode (TCP-In)'; Action = 'Allow'; Group = '@FirewallAPI.dll,-28752'; Ports = @('3389'); Enabled = $true; Store = 'Local' },
            @{ Name = 'RemoteDesktop-Shadow-In-TCP'; DisplayName = 'Remote Desktop - Shadow (TCP-In)'; Action = 'Allow'; Group = '@FirewallAPI.dll,-28752'; Ports = @('Any'); Enabled = $true; Store = 'Local' },
            @{ Name = 'Custom-RDP'; DisplayName = 'RDP from anywhere'; Action = 'Allow'; Group = ''; Ports = @('3389'); Enabled = $true; Store = 'GroupPolicy' },
            @{ Name = 'Both-22-3389'; DisplayName = 'ssh and rdp together'; Action = 'Allow'; Group = ''; Ports = @('22', '3389'); Enabled = $true; Store = 'GroupPolicy' },
            @{ Name = 'OpenSSH-Server-In-TCP'; DisplayName = 'OpenSSH SSH Server (sshd)'; Action = 'Allow'; Group = 'OpenSSH Server'; Ports = @('22'); Enabled = $true; Store = 'GroupPolicy' },
            @{ Name = 'Block-RDP'; DisplayName = 'Thornswood: block RDP from outside'; Action = 'Block'; Group = ''; Ports = @('3389'); Enabled = $true; Store = 'GroupPolicy' },
            @{ Name = 'Thornswood-Game'; DisplayName = 'Thornswood game'; Action = 'Allow'; Group = ''; Ports = @('7777'); Enabled = $true; Store = 'GroupPolicy' }
        )
        # Which store each rule was turned off in, by its name.
        stores = @{}
        # The in-box Edge as its uninstall entry gave it on 26 Oct 2026 (#3896).
        edge = [pscustomobject]@{ Version = '130.0.2849.80'; Setup = 'C:\Program Files (x86)\Microsoft\Edge\Application\130.0.2849.80\Installer\setup.exe'; Arguments = '--uninstall --msedge --channel=stable --system-level --verbose-logging' }
        edgeRefuses = $false
        edgeCode = 19
        term = @{ Status = 'Running'; StartType = 'Manual' }
        # As the box had them on 21 Oct 2026 (#3186), less ShellHWDetection,
        # which stands for one a box may not have installed, and Themes
        # already stopped by hand but still set to start.
        svcs = @{
            Spooler = @{ Status = 'Running'; StartType = 'Automatic' }; DiagTrack = @{ Status = 'Running'; StartType = 'Automatic' }
            SysMain = @{ Status = 'Running'; StartType = 'Automatic' }; Themes = @{ Status = 'Stopped'; StartType = 'Automatic' }
            CDPSvc = @{ Status = 'Running'; StartType = 'Automatic' }; WpnService = @{ Status = 'Running'; StartType = 'Automatic' }
            TrkWks = @{ Status = 'Running'; StartType = 'Automatic' }
            sshd = @{ Status = 'Running'; StartType = 'Automatic' }; ThornswoodBot = @{ Status = 'Running'; StartType = 'Automatic' }
            wuauserv = @{ Status = 'Running'; StartType = 'Manual' }; UsoSvc = @{ Status = 'Running'; StartType = 'Automatic' }
        }
        # As the box had them at 4:40 AM on 22 Oct 2026 (#3213): the five
        # telemetry tasks Ready, beside three that are not telemetry and
        # Windows' own restart task, which must all be left alone.
        tasks = @{
            '\Microsoft\Windows\DiskFootprint\Diagnostics' = @{ State = 'Ready' }
            '\Microsoft\Windows\Application Experience\Microsoft Compatibility Appraiser' = @{ State = 'Ready' }
            '\Microsoft\Windows\Application Experience\ProgramDataUpdater' = @{ State = 'Ready' }
            '\Microsoft\Windows\Customer Experience Improvement Program\Consolidator' = @{ State = 'Ready' }
            '\Microsoft\Windows\Customer Experience Improvement Program\UsbCeip' = @{ State = 'Ready' }
            '\Microsoft\Windows\Application Experience\PcaPatchDbTask' = @{ State = 'Ready' }
            '\Microsoft\Windows\Application Experience\StartupAppTask' = @{ State = 'Ready' }
            '\Microsoft\Windows\DiskFootprint\StorageSense' = @{ State = 'Ready' }
            '\Microsoft\Windows\UpdateOrchestrator\Reboot_AC' = @{ State = 'Ready' }
        }
        # Only AUOptions 7 was set, and nothing under DataCollection,
        # active hours or maintenance.
        reg = @{ 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU|AUOptions' = @{ Value = 7; Type = 'DWord' } }
        tz = 'Mountain Standard Time'
        # When a task runs next, by its path and name; none set by default.
        next = @{}
        sshdOk = $true
        restarts = 0
        rollback = ''
        log = New-Object System.Collections.Generic.List[string]
        checked = New-Object System.Collections.Generic.List[string]
        private = New-Object System.Collections.Generic.List[object]
    }
}
function Rule([string]$name) { return @($global:Fake.rules | Where-Object { $_.Name -eq $name })[0] }

# Runs the box script here against the stand-ins.
function Invoke-BoxHere([string]$cfg, [switch]$Dry) {
    $a = @{ Layer = $Layer; SshdConfig = $cfg; Sshd = 'not-used.exe' }
    if ($Dry) { $a.DryRun = $true }
    $global:LASTEXITCODE = 0
    $out = @(& $Box @a 2>&1 | ForEach-Object { [string]$_ })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out }
}
function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }

# #3213: the telemetry tasks, the policy values as the stand-in holds them,
# and the tasks and services that must be left as they were.
$Pol = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows'
$telemetry = '\Microsoft\Windows\DiskFootprint\Diagnostics', '\Microsoft\Windows\Application Experience\Microsoft Compatibility Appraiser',
    '\Microsoft\Windows\Application Experience\ProgramDataUpdater', '\Microsoft\Windows\Customer Experience Improvement Program\Consolidator',
    '\Microsoft\Windows\Customer Experience Improvement Program\UsbCeip'
$leftTasks = '\Microsoft\Windows\Application Experience\PcaPatchDbTask', '\Microsoft\Windows\Application Experience\StartupAppTask',
    '\Microsoft\Windows\DiskFootprint\StorageSense', '\Microsoft\Windows\UpdateOrchestrator\Reboot_AC'
function Reg([string]$key, [string]$name) {
    $e = $global:Fake.reg[$Pol + $key + '|' + $name]
    if (-not $e) { return $null }
    return $e.Value
}
function RegType([string]$key, [string]$name) { $e = $global:Fake.reg[$Pol + $key + '|' + $name]; if ($e) { return $e.Type }; return '' }

# Minutes past midnight, box time, of a UTC hh:mm on a summer and a winter day.
$mountain = [TimeZoneInfo]::FindSystemTimeZoneById('Mountain Standard Time')
function BoxMinutes([int]$utcMin, [int]$month) {
    $u = New-Object DateTime(2026, $month, 15, [math]::Floor($utcMin / 60), ($utcMin % 60), 0, ([DateTimeKind]::Utc))
    $l = [TimeZoneInfo]::ConvertTimeFromUtc($u, $mountain)
    return $l.Hour * 60 + $l.Minute
}

try {
    # =================================================================== the box ===
    # ---- the file itself --------------------------------------------------------
    $boxText = [IO.File]::ReadAllText($Box)
    $errs = $null; $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($boxText, [ref]$tokens, [ref]$errs)
    Yes 'vps-harden.ps1 parses' (-not $errs -or $errs.Count -eq 0)
    Yes '  and is plain ASCII' (-not ($boxText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))

    $layerNames = @('Get-RdpDeny', 'Set-RdpDeny', 'Get-InboundRules', 'Disable-InboundRule', 'Get-TermService', 'Stop-TermService', 'Disable-TermService', 'Get-IdleService', 'Stop-IdleService', 'Disable-IdleService', 'Get-WindowsTask', 'Disable-WindowsTask', 'Get-PolicyValue', 'Set-PolicyValue', 'Get-BoxTimeZone', 'Get-TaskNextRun', 'Test-SshdFile', 'Start-SshdRestart', 'Register-Rollback', 'New-PrivateFile', 'Get-EdgeInstall', 'Remove-EdgeInstall')
    $defined = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    Yes 'every layer function the stand-in replaces is defined in it' (@($layerNames | Where-Object { $defined -notcontains $_ }).Count -eq 0)
    $fakeAst = [System.Management.Automation.Language.Parser]::ParseInput($layerText, [ref]$null, [ref]$null)
    $fakeNames = @($fakeAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    Yes '  and the stand-in replaces every one of them' (@($layerNames | Where-Object { $fakeNames -notcontains $_ }).Count -eq 0)

    $touchers = 'Set-ItemProperty', 'Get-ItemProperty', 'Get-NetFirewallRule', 'Get-NetFirewallPortFilter', 'Disable-NetFirewallRule', 'Enable-NetFirewallRule',
                'Get-Service', 'Stop-Service', 'Set-Service', 'Restart-Service', 'Register-ScheduledTask', 'Start-ScheduledTask', 'Unregister-ScheduledTask', 'New-ItemProperty', 'Remove-NetFirewallRule',
                'Get-ScheduledTask', 'Disable-ScheduledTask', 'Enable-ScheduledTask', 'Stop-ScheduledTask', 'New-Item', 'Remove-ItemProperty', 'Get-TimeZone', 'Set-TimeZone', 'Restart-Computer', 'Start-Process'
    $loose = @()
    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $name = $c.GetCommandName()
        if (-not $name -or $touchers -notcontains $name) { continue }
        $p = $c.Parent
        while ($p -and -not ($p -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $p = $p.Parent }
        if (-not $p -or $layerNames -notcontains $p.Name) { $loose += ('{0} at line {1}' -f $name, $c.Extent.StartLineNumber) }
    }
    Yes ('every command in it that touches Windows is inside a layer function' + $(if ($loose.Count) { ': ' + ($loose -join ', ') } else { '' })) ($loose.Count -eq 0)
    # A copy written plainly into C:\ProgramData\ssh takes the folder's rule
    # for every signed in account (#3034), so rules are set in one place.
    $setAcl = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and [string]$n.Member -eq 'SetAccessControl' }, $true) | Where-Object {
        $p = $_.Parent; while ($p -and -not ($p -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $p = $p.Parent }; -not $p -or $p.Name -ne 'New-PrivateFile' })
    $copies = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and @('Copy-Item', 'Set-Acl', 'icacls', 'icacls.exe') -contains $n.GetCommandName() }, $true))
    Yes '  a file''s rules are set only in New-PrivateFile, and no Copy-Item, Set-Acl or icacls makes or changes one' (-not $setAcl.Count -and -not $copies.Count)

    # ---- a dry run changes nothing ------------------------------------------------
    New-Fake
    $cfg = Join-Path $tmp 'sshd_config'
    [IO.File]::WriteAllText($cfg, $defaultCfg, $utf8)
    $r = Invoke-BoxHere $cfg -Dry
    Yes 'dry run: exits 0' ($r.Code -eq 0)
    Yes '  says WOULD for Remote Desktop, its two allow rules, its service and sshd_config' ((Has $r.Lines '^WOULD Remote Desktop connections refused') -and (Has $r.Lines "^WOULD firewall rule 'Remote Desktop - User Mode") -and
        (Has $r.Lines "^WOULD firewall rule 'RDP from anywhere'") -and (Has $r.Lines '^WOULD Remote Desktop service set to Disabled') -and (Has $r.Lines '^WOULD sshd_config: PasswordAuthentication no'))
    Yes '  and changes nothing: not the file, the registry value, a rule, the service' ([IO.File]::ReadAllText($cfg) -eq $defaultCfg -and $global:Fake.fDeny -eq 0 -and
        (Rule 'Custom-RDP').Enabled -and $global:Fake.term.StartType -eq 'Manual' -and $global:Fake.log.Count -eq 0)
    Yes '  nor restarts sshd or arms a rollback' ($global:Fake.restarts -eq 0 -and -not $global:Fake.rollback)
    Yes '  but does have sshd -t check the file it would write' ($global:Fake.checked.Count -eq 1 -and $global:Fake.checked[0] -match '(?m)^PasswordAuthentication no')
    Yes '  and has nothing of its own to delete, since it is never written on the box (#3035)' ($boxText -notmatch 'PSCommandPath|KeepSelf')
    Yes '  and its last line says nothing was changed' ($r.Lines[-1] -match '^DONE \d+ change\(s\) would be made\. Nothing was changed\.')
    Yes '  says WOULD stop and disable each service the box never uses, with why (#3186)' ((Has $r.Lines '^WOULD Spooler stopped \(was Running\): print spooler') -and
        (Has $r.Lines '^WOULD DiagTrack set to Disabled \(was Automatic\)') -and (Has $r.Lines '^WOULD TrkWks stopped'))
    Yes '  and touches none of them' (@($global:Fake.svcs.Values | Where-Object { $_.StartType -eq 'Disabled' }).Count -eq 0 -and $global:Fake.svcs.Spooler.Status -eq 'Running')
    Yes '  says WOULD disable each telemetry task and set the update values, with why (#3213)' ((Has $r.Lines '^WOULD \\Microsoft\\Windows\\DiskFootprint\\Diagnostics set to Disabled \(was Ready\): DiskSnapshot') -and
        (Has $r.Lines '^WOULD AllowTelemetry set to 0 \(was not set\)') -and (Has $r.Lines '^WOULD AUOptions set to 4 \(was 7\)') -and (Has $r.Lines '^WOULD Activation Boundary set to 2000-01-01T04:00:00'))
    Yes '  and changes none of them' (@($telemetry | Where-Object { $global:Fake.tasks[$_].State -ne 'Ready' }).Count -eq 0 -and
        $global:Fake.reg.Count -eq 1 -and (Reg '\WindowsUpdate\AU' 'AUOptions') -eq 7)
    Yes '  says WOULD set the Edge install policy and uninstall Edge with its own setup (#3896)' ((Has $r.Lines '^WOULD Install\{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062\} set to 0 \(was not set\)') -and
        (Has $r.Lines '^WOULD Microsoft Edge 130\.0\.2849\.80 uninstalled with its own setup'))
    Yes '  and leaves Edge installed' ($null -ne $global:Fake.edge -and -not (Has $global:Fake.log '^Remove-EdgeInstall'))

    # ---- a real run -------------------------------------------------------------------
    $r = Invoke-BoxHere $cfg
    $new = [IO.File]::ReadAllText($cfg)
    $newLines = @($new -split "`r`n")
    $matchAt = [array]::IndexOf($newLines, 'Match Group administrators')
    $pwAt = [array]::IndexOf($newLines, 'PasswordAuthentication no')
    $kbAt = [array]::IndexOf($newLines, 'KbdInteractiveAuthentication no')
    Yes 'real run: exits 0' ($r.Code -eq 0)
    Yes '  PasswordAuthentication no is a global line, above Match' ($pwAt -ge 0 -and $pwAt -lt $matchAt)
    Yes '  right under the commented default it replaces' ($pwAt -gt 0 -and $newLines[$pwAt - 1] -eq '#PasswordAuthentication yes')
    Yes '  KbdInteractiveAuthentication no too, above Match' ($kbAt -ge 0 -and $kbAt -lt $matchAt)
    Yes '  and the rest of the file is as it was, Match block included' (($new -replace '(?m)^(PasswordAuthentication|KbdInteractiveAuthentication) no\r\n', '') -eq $defaultCfg)
    $backups = @(Get-ChildItem -LiteralPath $tmp -Filter 'sshd_config.before-harden-*')
    Yes '  the old file is kept beside it' ($backups.Count -eq 1 -and [IO.File]::ReadAllText($backups[0].FullName) -eq $defaultCfg)
    Yes '  made by New-PrivateFile while it did not exist yet, so its rules are set before the old file goes in (#3034)' ($global:Fake.private.Count -eq 1 -and
        $global:Fake.private[0].Path -eq $backups[0].FullName -and -not $global:Fake.private[0].Existed -and $global:Fake.log.IndexOf('New-PrivateFile') -lt $global:Fake.log.IndexOf('Register-Rollback'))
    Yes '  Remote Desktop refused' ($global:Fake.fDeny -eq 1)
    Yes '  its allow rules off, the group ones and the one on 3389' (-not (Rule 'RemoteDesktop-UserMode-In-TCP').Enabled -and -not (Rule 'RemoteDesktop-Shadow-In-TCP').Enabled -and -not (Rule 'Custom-RDP').Enabled)
    Yes '  ssh''s rule on 22 left on' ((Rule 'OpenSSH-Server-In-TCP').Enabled -and (Has $r.Lines "^KEPT ssh: firewall rule 'OpenSSH SSH Server"))
    Yes '  a rule that covers 22 as well as 3389 left on, and said so' ((Rule 'Both-22-3389').Enabled -and (Has $r.Lines "^KEPT firewall rule 'ssh and rdp together' covers port 22"))
    Yes '  the block rule and the game''s rule not touched' ((Rule 'Block-RDP').Enabled -and (Rule 'Thornswood-Game').Enabled)
    Yes '  its service stopped and Disabled' ($global:Fake.term.Status -eq 'Stopped' -and $global:Fake.term.StartType -eq 'Disabled')
    Yes '  each rule turned off in the store it comes from, the box''s policy or the local one (#3896)' ($global:Fake.stores['RemoteDesktop-UserMode-In-TCP'] -eq 'Local' -and
        $global:Fake.stores['Custom-RDP'] -eq 'GroupPolicy')

    # ---- Edge off the box (#3896) ------------------------------------------------------
    $edgeKey = 'HKLM:\SOFTWARE\Policies\Microsoft\EdgeUpdate|Install{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}'
    Yes '  the Edge updater told never to install Edge again: Install{Edge''s app id} 0, a DWord, and no Update value' ($global:Fake.reg.ContainsKey($edgeKey) -and
        $global:Fake.reg[$edgeKey].Value -eq 0 -and $global:Fake.reg[$edgeKey].Type -eq 'DWord' -and @($global:Fake.reg.Keys | Where-Object { $_ -match 'EdgeUpdate\|Update' }).Count -eq 0)
    Yes '  set before Edge is uninstalled, so nothing puts it back between the two' ($global:Fake.log.IndexOf('Set-PolicyValue Install{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}') -ge 0 -and
        $global:Fake.log.IndexOf('Set-PolicyValue Install{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}') -lt @($global:Fake.log).IndexOf(@($global:Fake.log | Where-Object { $_ -match '^Remove-EdgeInstall' })[0]))
    Yes '  Edge uninstalled with its own setup and arguments, plus --force-uninstall, once' (@($global:Fake.log | Where-Object { $_ -match '^Remove-EdgeInstall ' }).Count -eq 1 -and
        (Has $global:Fake.log '^Remove-EdgeInstall C:\\Program Files \(x86\)\\Microsoft\\Edge\\Application\\130\.0\.2849\.80\\Installer\\setup\.exe --uninstall --msedge --channel=stable --system-level --verbose-logging$') -and
        $null -eq $global:Fake.edge -and (Has $r.Lines '^CHANGED Microsoft Edge 130\.0\.2849\.80 uninstalled with its own setup \(exit 19\)'))
    $layerFns = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Remove-EdgeInstall' }, $true))
    Yes '  and the real Remove-EdgeInstall adds --force-uninstall and waits for setup to end' ($layerFns.Count -eq 1 -and $layerFns[0].Extent.Text -match "' --force-uninstall'" -and $layerFns[0].Extent.Text -match '-Wait -PassThru')
    Yes '  the WebView2 Runtime not touched: its app id, its folder and its uninstall entry named nowhere, and Edge''s entry is Edge''s own' ($boxText -notmatch '(?i)F3017226-FE2A-4295-8BDF-00C3A9A7E4C5|EdgeWebView' -and
        $boxText -match "(?m)^\`$EdgeUninstallKey = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Microsoft Edge'$")
    Yes '  the rollback armed with the old file, then the restart, in that order' ($global:Fake.rollback -eq $backups[0].FullName -and
        $global:Fake.restarts -eq 1 -and $global:Fake.log.IndexOf('Register-Rollback') -lt $global:Fake.log.IndexOf('Start-SshdRestart'))
    Yes '  Remote Desktop before sshd, so a restart that cut the session off would come last' ($global:Fake.log.IndexOf('Disable-TermService') -lt $global:Fake.log.IndexOf('Register-Rollback'))
    $idle = 'Spooler', 'DiagTrack', 'SysMain', 'Themes', 'CDPSvc', 'WpnService', 'TrkWks'
    Yes '  each service the box never uses stopped and Disabled (#3186)' (@($idle | Where-Object { $global:Fake.svcs[$_].Status -ne 'Stopped' -or $global:Fake.svcs[$_].StartType -ne 'Disabled' }).Count -eq 0)
    Yes '  Themes, already stopped, only set to Disabled' (-not $global:Fake.log.Contains('Stop-IdleService Themes') -and $global:Fake.log.Contains('Disable-IdleService Themes') -and (Has $r.Lines '^ALREADY Themes stopped'))
    Yes '  one not installed said and left' ((Has $r.Lines '^ALREADY ShellHWDetection is not installed') -and -not $global:Fake.svcs.ContainsKey('ShellHWDetection'))
    Yes '  and nothing else touched: sshd and the bot still run and start' ($global:Fake.svcs.sshd.Status -eq 'Running' -and $global:Fake.svcs.sshd.StartType -eq 'Automatic' -and
        $global:Fake.svcs.ThornswoodBot.Status -eq 'Running' -and @($global:Fake.log | Where-Object { $_ -match 'IdleService (sshd|ThornswoodBot)' }).Count -eq 0)
    Yes '  the services before sshd, so a restart that cut the session off would come last' ($global:Fake.log.IndexOf('Disable-IdleService TrkWks') -lt $global:Fake.log.IndexOf('Register-Rollback'))

    # ---- telemetry off, Windows Update moved to 4 AM (#3213) -------------------------
    Yes '  each telemetry task Disabled, DiskSnapshot, CompatTelRunner and CEIP (#3213)' (@($telemetry | Where-Object { $global:Fake.tasks[$_].State -ne 'Disabled' }).Count -eq 0)
    Yes '  and the tasks that are not telemetry left Ready, StorageSense and Reboot_AC among them' (@($leftTasks | Where-Object { $global:Fake.tasks[$_].State -ne 'Ready' }).Count -eq 0 -and
        @($global:Fake.log | Where-Object { $_ -match 'PcaPatchDbTask|StartupAppTask|StorageSense|UpdateOrchestrator' }).Count -eq 0)
    Yes '  AllowTelemetry 0, a DWord under DataCollection' ((Reg '\DataCollection' 'AllowTelemetry') -eq 0 -and (RegType '\DataCollection' 'AllowTelemetry') -eq 'DWord')
    Yes '  Windows Update not turned off: wuauserv and UsoSvc untouched, said KEPT, and NoAutoUpdate 0' (
        $global:Fake.svcs.wuauserv.Status -eq 'Running' -and $global:Fake.svcs.wuauserv.StartType -eq 'Manual' -and
        $global:Fake.svcs.UsoSvc.Status -eq 'Running' -and $global:Fake.svcs.UsoSvc.StartType -eq 'Automatic' -and
        @($global:Fake.log | Where-Object { $_ -match 'wuauserv|UsoSvc' }).Count -eq 0 -and
        (Has $r.Lines '^KEPT wuauserv .* left as it is: Running, Manual') -and (Has $r.Lines '^KEPT UsoSvc ') -and (Reg '\WindowsUpdate\AU' 'NoAutoUpdate') -eq 0)
    Yes '  and it is installed on a schedule, every day at 4 AM' ((Reg '\WindowsUpdate\AU' 'AUOptions') -eq 4 -and (Reg '\WindowsUpdate\AU' 'ScheduledInstallDay') -eq 0 -and
        (Reg '\WindowsUpdate\AU' 'ScheduledInstallTime') -eq 4 -and (Reg '\WindowsUpdate\AU' 'ScheduledInstallEveryWeek') -eq 1)
    $boundary = [string](Reg '\Task Scheduler\Maintenance' 'Activation Boundary')
    $maint = [datetime]::MinValue
    $maintOk = [datetime]::TryParseExact($boundary, 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$maint)
    Yes '  automatic maintenance starts at 4 AM, as a string in the form Windows reads, with no random delay' ($maintOk -and $maint.Hour -eq 4 -and $maint.Minute -eq 0 -and
        (RegType '\Task Scheduler\Maintenance' 'Activation Boundary') -eq 'String' -and (Reg '\Task Scheduler\Maintenance' 'Randomized') -eq 0)

    # The window, from the files that set the other two, all year.
    $bAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'scripts\deploy\Install-Backup.ps1'), [ref]$null, [ref]$null)
    $bAt = [string]($bAst.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'At' }).DefaultValue.Value
    $bUtc = [int]$bAt.Substring(0, 2) * 60 + [int]$bAt.Substring(3, 2)
    $yml = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\nightly.yml'))
    $crons = @([regex]::Matches($yml, "cron:\s*'(\d+)\s+(\d+)\s+\*\s+\*\s+\*'") | ForEach-Object { [int]$_.Groups[2].Value * 60 + [int]$_.Groups[1].Value })
    $install = [int](Reg '\WindowsUpdate\AU' 'ScheduledInstallTime') * 60
    $start = [math]::Min($install, $maint.Hour * 60 + $maint.Minute)
    $clear = ($bAt -match '^\d{2}:\d{2}Z$') -and $crons.Count -ge 1
    $said = @()
    foreach ($month in 7, 1) {
        $b = BoxMinutes $bUtc $month
        $said += ('{0}: backup {1:00}:{2:00}' -f $(if ($month -eq 7) { 'summer' } else { 'winter' }), [math]::Floor($b / 60), ($b % 60))
        # The backup has 30 minutes (three times its slowest run, #3187) and
        # the nightly shares 45 each, both before the window opens.
        if ($start - $b -lt 30) { $clear = $false }
        foreach ($c in $crons) { $n = BoxMinutes $c $month; $said += ('nightly {0:00}:{1:00}' -f [math]::Floor($n / 60), ($n % 60)); if ($start - $n -lt 45) { $clear = $false } }
    }
    Yes ('  the window opens at 4 AM clear of the backup and the nightly checks (' + ($said -join ', ') + ')') ($clear -and $start -eq 240)
    $from = [int](Reg '\WindowsUpdate' 'ActiveHoursStart'); $to = [int](Reg '\WindowsUpdate' 'ActiveHoursEnd')
    $active = @(0..23 | Where-Object { if ($from -le $to) { $_ -ge $from -and $_ -lt $to } else { $_ -ge $from -or $_ -lt $to } })
    Yes ('  active hours on, ' + $from + ' to ' + $to + ', 18 hours at most, leaving 4 to 6 AM out and on from 6 AM, before anybody is on at 7') (
        (Reg '\WindowsUpdate' 'SetActiveHours') -eq 1 -and $active.Count -le 18 -and $active -notcontains 4 -and $active -notcontains 5 -and $active -contains 6 -and $active -contains 7)
    # Microsoft's way to schedule an install and its restart (#3213, 23 Oct):
    # AUOptions 4, the install time, and the timer the install starts. The
    # restart has to come inside 4 to 6 AM even after an install of an hour.
    $timer = Reg '\WindowsUpdate\AU' 'AlwaysAutoRebootAtScheduledTimeMinutes'
    $restartAt = $install + 60 + [int]$timer
    Yes ('  the restart an install needs comes on its timer, ' + $timer + ' minutes after it, inside 4 to 6 AM even after an hour of install') (
        (Reg '\WindowsUpdate\AU' 'AlwaysAutoRebootAtScheduledTime') -eq 1 -and $null -ne $timer -and [int]$timer -ge 15 -and [int]$timer -le 180 -and
        $install -ge 240 -and $restartAt -lt 360)
    Yes '  and nothing in vps-harden.ps1 restarts the box itself' (-not @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and @('Restart-Computer', 'shutdown', 'shutdown.exe') -contains $n.GetCommandName() }, $true)).Count)
    Yes '  with no restart set by Windows, it says so' (Has $r.Lines '^ALREADY Windows has no restart for an update set$')
    Yes '  every value written with the type Windows reads it as' (@($global:Fake.reg.Keys | Where-Object { $_ -notmatch 'Activation Boundary$' -and $global:Fake.reg[$_].Type -ne 'DWord' }).Count -eq 0)
    Yes '  the box''s clock said, Mountain' (Has $r.Lines "^ALREADY the box's clock is Mountain Standard Time")
    Yes '  all of it before sshd, so a restart that cut the session off would come last' ($global:Fake.log.IndexOf('Set-PolicyValue Randomized') -ge 0 -and
        $global:Fake.log.IndexOf('Set-PolicyValue Randomized') -lt $global:Fake.log.IndexOf('Register-Rollback'))
    Yes '  every change printed as CHANGED' (@($r.Lines | Where-Object { $_ -match '^CHANGED ' }).Count -ge 7)
    Yes '  and the count is in the last line' ($r.Lines[-1] -match '^DONE \d+ change\(s\) made\.$')

    # ---- a second run -----------------------------------------------------------------
    $r2 = Invoke-BoxHere $cfg
    Yes 'second run: nothing to change' ($r2.Code -eq 0 -and $r2.Lines[-1] -eq 'DONE 0 change(s) made.' -and -not (Has $r2.Lines '^(CHANGED|WOULD) '))
    Yes '  Edge said not installed and its policy ALREADY, no second uninstall (#3896)' ((Has $r2.Lines '^ALREADY Microsoft Edge is not installed') -and
        (Has $r2.Lines '^ALREADY Install\{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062\} is 0') -and @($global:Fake.log | Where-Object { $_ -match '^Remove-EdgeInstall' }).Count -eq 1)

    # ---- a restart Windows set before the policy (#3213, 23 Oct) ------------------------
    # As the box had it at 6:26 AM on 23 Oct: Reboot_AC set for 2:33:33 AM.
    $rebootAc = '\Microsoft\Windows\UpdateOrchestrator\Reboot_AC'
    $global:Fake.next[$rebootAc] = New-Object DateTime(2026, 10, 24, 2, 33, 33)
    $before = $global:Fake.log.Count
    $r3 = Invoke-BoxHere $cfg
    Yes 'a restart Windows set for 2:33 AM: WARN, with the time, outside 4 AM to 6 AM' ($r3.Code -eq 0 -and (Has $r3.Lines '^WARN Windows has a restart for an update set for 2026-10-24 2:33 AM, outside 4 AM to 6 AM'))
    Yes '  and left: its task untouched, nothing changed' ($global:Fake.tasks[$rebootAc].State -eq 'Ready' -and $global:Fake.log.Count -eq $before -and $r3.Lines[-1] -eq 'DONE 0 change(s) made.')
    $global:Fake.next[$rebootAc] = New-Object DateTime(2026, 10, 24, 4, 20, 0)
    $r4 = Invoke-BoxHere $cfg -Dry
    Yes '  one at 4:20 AM is inside the window, and said so' (-not (Has $r4.Lines '^WARN Windows has a restart') -and (Has $r4.Lines '^ALREADY Windows has its restart for an update set for 2026-10-24 4:20 AM, inside 4 AM to 6 AM'))
    Yes '  no second backup and no second restart' (@(Get-ChildItem -LiteralPath $tmp -Filter 'sshd_config.before-harden-*').Count -eq 1 -and $global:Fake.restarts -eq 1 -and $global:Fake.private.Count -eq 1)
    Yes '  says ALREADY for the telemetry tasks and the update values (#3213)' ((Has $r2.Lines '^ALREADY \\Microsoft\\Windows\\DiskFootprint\\Diagnostics Disabled') -and
        (Has $r2.Lines '^ALREADY AllowTelemetry is 0') -and (Has $r2.Lines '^ALREADY AUOptions is 4') -and (Has $r2.Lines '^ALREADY Activation Boundary is 2000-01-01T04:00:00') -and
        -not @($global:Fake.log | Select-Object -Skip $global:Fake.log.IndexOf('Start-SshdRestart') | Where-Object { $_ -match 'WindowsTask|PolicyValue' }).Count)

    # ---- Edge's setup leaves it installed (#3896) ----------------------------------------
    New-Fake
    $global:Fake.edgeRefuses = $true
    $global:Fake.edgeCode = 93
    $cfg5 = Join-Path $tmp 'edge\sshd_config'
    New-Item -ItemType Directory -Path (Split-Path $cfg5) -Force | Out-Null
    [IO.File]::WriteAllText($cfg5, $defaultCfg, $utf8)
    $r = Invoke-BoxHere $cfg5
    # Patrick, 27 Oct, q-3896-edge-uninstall-refused, A: Edge stays, blocked, and the run goes on.
    Yes 'Edge still installed after its setup ran: KEPT with the exit code and where its log is, exit 0' ($r.Code -eq 0 -and
        (Has $r.Lines '^KEPT Microsoft Edge 130\.0\.2849\.80 is still installed: its setup refused the uninstall \(exit 93; its log is msedge_installer\.log'))
    Yes '  the install policy set, and the rest of the run done: the update values, sshd_config and its restart' ($global:Fake.reg.ContainsKey('HKLM:\SOFTWARE\Policies\Microsoft\EdgeUpdate|Install{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}') -and
        (Reg '\WindowsUpdate\AU' 'AUOptions') -eq 4 -and [IO.File]::ReadAllText($cfg5) -match '(?m)^PasswordAuthentication no' -and $global:Fake.restarts -eq 1)
    Yes '  and no CHANGED line for Edge, so it is not counted as gone' (-not (Has $r.Lines '^CHANGED Microsoft Edge') -and $r.Lines[-1] -match '^DONE \d+ change\(s\) made\.$')
    $r2 = Invoke-BoxHere $cfg5
    Yes '  run again: its setup asked once more, KEPT again, nothing else to change' ($r2.Code -eq 0 -and (Has $r2.Lines '^KEPT Microsoft Edge') -and $r2.Lines[-1] -eq 'DONE 0 change(s) made.' -and
        @($global:Fake.log | Where-Object { $_ -match '^Remove-EdgeInstall' }).Count -eq 2)

    # ---- no Edge on the box --------------------------------------------------------------
    New-Fake
    $global:Fake.edge = $null
    $r = Invoke-BoxHere $cfg -Dry
    Yes 'no Edge on the box: said ALREADY, no uninstall' ($r.Code -eq 0 -and (Has $r.Lines '^ALREADY Microsoft Edge is not installed \(#3896\)') -and -not (Has $r.Lines 'Microsoft Edge .* uninstalled'))

    # ---- sshd -t refuses the new file ---------------------------------------------------
    New-Fake
    $global:Fake.sshdOk = $false
    $cfg2 = Join-Path $tmp 'refused\sshd_config'
    New-Item -ItemType Directory -Path (Split-Path $cfg2) -Force | Out-Null
    [IO.File]::WriteAllText($cfg2, $defaultCfg, $utf8)
    $r = Invoke-BoxHere $cfg2
    Yes 'a file sshd -t refuses: exit 1 and a STOP line saying why' ($r.Code -eq 1 -and (Has $r.Lines '^STOP sshd -t refused the new sshd_config.*Bad configuration option'))
    Yes '  the old file stays, with no backup, no rollback and no restart' ([IO.File]::ReadAllText($cfg2) -eq $defaultCfg -and
        @(Get-ChildItem -LiteralPath (Split-Path $cfg2) -Filter '*.before-harden-*').Count -eq 0 -and -not $global:Fake.rollback -and $global:Fake.restarts -eq 0)

    # ---- a file that already says yes, globally and under Match ---------------------------------
    New-Fake
    $cfg3 = Join-Path $tmp 'yes\sshd_config'
    New-Item -ItemType Directory -Path (Split-Path $cfg3) -Force | Out-Null
    $yesCfg = "PasswordAuthentication yes`r`nPasswordAuthentication yes`r`nSubsystem sftp sftp-server.exe`r`nMatch Group administrators`r`n    PasswordAuthentication yes`r`n    AuthorizedKeysFile x`r`n"
    [IO.File]::WriteAllText($cfg3, $yesCfg, $utf8)
    $r = Invoke-BoxHere $cfg3
    $t3 = [IO.File]::ReadAllText($cfg3)
    Yes 'a file that says yes: every PasswordAuthentication line becomes no, the one under Match too' ($r.Code -eq 0 -and $t3 -notmatch 'PasswordAuthentication yes' -and ([regex]::Matches($t3, 'PasswordAuthentication no')).Count -eq 3)
    Yes '  with no extra global line added' ($t3.StartsWith("PasswordAuthentication no`r`nPasswordAuthentication no`r`nSubsystem"))
    Yes '  and the Match line keeps its indent' ($t3 -match "(?m)^    PasswordAuthentication no\r$")

    # ---- no service, and ssh with no rule of its own -----------------------------------------
    New-Fake
    $global:Fake.term = $null
    $global:Fake.rules = @($global:Fake.rules | Where-Object { $_.Name -notin 'OpenSSH-Server-In-TCP', 'Both-22-3389' })
    $r = Invoke-BoxHere $cfg -Dry
    Yes 'no Remote Desktop service: said, not an error' ($r.Code -eq 0 -and (Has $r.Lines '^ALREADY the Remote Desktop service is not installed'))
    Yes 'no rule naming port 22: a WARN, and nothing about ssh changed' (Has $r.Lines '^WARN no enabled firewall rule names port 22')

    # ---- a task not on the box, Windows Update off, a clock not Mountain (#3213) --------------
    New-Fake
    $global:Fake.tasks.Remove('\Microsoft\Windows\Customer Experience Improvement Program\UsbCeip')
    $global:Fake.svcs.wuauserv.StartType = 'Disabled'
    $global:Fake.tz = 'UTC'
    $r = Invoke-BoxHere $cfg -Dry
    Yes 'a telemetry task not on the box: said and left' ($r.Code -eq 0 -and (Has $r.Lines '^ALREADY \\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip is not on the box'))
    Yes 'Windows Update Disabled: a WARN, and left as it is' ((Has $r.Lines '^WARN wuauserv .* is Disabled, so nothing installs at 4 AM') -and $global:Fake.svcs.wuauserv.StartType -eq 'Disabled' -and $global:Fake.log.Count -eq 0)
    Yes 'a clock that is not Mountain: a WARN, and the clock not touched' ((Has $r.Lines "^WARN the box's clock is UTC, not Mountain Standard Time") -and $global:Fake.tz -eq 'UTC')

    # ============================================================= the machine ===
    $vpsJson = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\vps.json') -Raw | ConvertFrom-Json
    $pin = [string]@($vpsJson.hostKeys)[0]
    $kh = Join-Path $tmp 'known_hosts'
    [IO.File]::WriteAllText($kh, "stand-in`n", $utf8)
    $far = Join-Path $tmp 'far'
    New-Item -ItemType Directory -Path $far -Force | Out-Null

    . (Join-Path $repo 'scripts\vps\Send-Script.ps1')
    $global:H = @{
        KeyWorks = $true; HostFp = $pin; Calls = (New-Object System.Collections.Generic.List[string])
        Far = $far; Layer = $Layer; Cfg = ''; Cancelled = $false; Sent = ''
        Box = $Box; BoxText = [IO.File]::ReadAllText($Box); RunnerPath = ${function:Get-ThornswoodRemoteRunnerPath}
    }
    function global:ssh-keygen {
        $a = @($args | ForEach-Object { [string]$_ })
        if ($a -contains '-F') { '# Host 127.0.0.1 found: line 1'; ('127.0.0.1 ED25519 ' + $global:H.HostFp) ; $global:LASTEXITCODE = 0; return }
        $global:LASTEXITCODE = 1
    }
    function global:scp {
        # The real one is its own process; -WhatIf on the driver never reaches it.
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        $global:H.Calls.Add('scp ' + ($a -join ' '))
        $leaf = ($a[-1] -split '/')[-1]
        Copy-Item -LiteralPath $a[-2] -Destination (Join-Path $global:H.Far $leaf) -Force
        $global:H.Sent = Join-Path $global:H.Far $leaf
        $global:LASTEXITCODE = 0
    }
    function global:ssh {
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        $in = @($input | ForEach-Object { [string]$_ })
        $last = $a[-1]
        # The script as the box would run it: inline, or Send-Script.ps1's
        # runner on the line, which takes the copy scp put in the far folder
        # off it and runs that (#3059).
        $s = ''
        if ($last -match 'EncodedCommand (\S+)') {
            $s = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
            $rp = & $global:H.RunnerPath $s
            if ($rp) { $rf = Join-Path $global:H.Far ($rp -split '\\')[-1]; $s = [IO.File]::ReadAllText($rf); Remove-Item -LiteralPath $rf -Force }
        }
        # vps-harden.ps1 whole, as a block with its arguments after it: the
        # file under test runs here with them, against the stand-in layer.
        $at = $s.IndexOf($global:H.BoxText)
        if ($at -ge 0) {
            $given = $s.Substring($at + $global:H.BoxText.Length).Trim().TrimStart('}').Trim()
            $global:H.Calls.Add(('ssh ' + (($a | Select-Object -SkipLast 1) -join ' ') + ' BOX ' + $given).TrimEnd())
            $out = @(& $global:H.Box -Layer $global:H.Layer -SshdConfig $global:H.Cfg -Sshd 'not-used.exe' -DryRun:($given -match '(^|\s)-DryRun(\s|$)') 2>&1 | ForEach-Object { [string]$_ })
            $code = $LASTEXITCODE
            $out
            $global:LASTEXITCODE = $code; return
        }
        $global:H.Calls.Add('ssh ' + ($a -join ' '))
        if ($a -contains '-v') {
            $cfgText = ''
            if ($global:H.Cfg -and (Test-Path -LiteralPath $global:H.Cfg)) { $cfgText = [IO.File]::ReadAllText($global:H.Cfg) }
            $m = 'publickey,password,keyboard-interactive'
            if ($cfgText -match '(?m)^PasswordAuthentication no' -and $cfgText -match '(?m)^KbdInteractiveAuthentication no') { $m = 'publickey' }
            'debug1: Remote protocol version 2.0, remote software version OpenSSH_for_Windows_9.5'
            ('debug1: Authentications that can continue: ' + $m)
            ('Administrator@127.0.0.1: Permission denied (' + $m + ').')
            $global:LASTEXITCODE = 255; return
        }
        if ($last -eq 'echo THORNSWOOD_KEY_OK') {
            if ($global:H.KeyWorks) { '** WARNING: connection is not using a post-quantum key exchange algorithm.'; 'THORNSWOOD_KEY_OK'; $global:LASTEXITCODE = 0 }
            else { 'Administrator@127.0.0.1: Permission denied (publickey).'; $global:LASTEXITCODE = 255 }
            return
        }
        if ($s) {
            if ($s -match 'Unregister-ScheduledTask -TaskName ''Thornswood harden rollback''') { $global:H.Cancelled = $true; 'ROLLBACK_CANCELLED' }
            $global:LASTEXITCODE = 0; return
        }
        $global:LASTEXITCODE = 1
    }

    # A port nothing listens on: bind one, then let it go.
    $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0); $l.Start(); $closedPort = $l.LocalEndpoint.Port; $l.Stop()

    function Invoke-Driver([hashtable]$extra) {
        $a = @{ Vps = '127.0.0.1'; User = 'Administrator'; KnownHosts = $kh; RdpPort = $closedPort; SettleSeconds = 0; NoPause = $true }
        foreach ($k in $extra.Keys) { $a[$k] = $extra[$k] }
        $global:LASTEXITCODE = 0
        $out = @(& $Driver @a 6>&1 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
    }
    function Fresh {
        New-Fake
        $global:H.Calls.Clear(); $global:H.Cancelled = $false; $global:H.Sent = ''
        $d = Join-Path $tmp ('m-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        $global:H.Cfg = Join-Path $d 'sshd_config'
        [IO.File]::WriteAllText($global:H.Cfg, $defaultCfg, $utf8)
    }

    # ---- no pinned key in known_hosts ----------------------------------------------------
    Fresh
    $global:H.HostFp = 'SHA256:' + ('A' * 43)
    $r = Invoke-Driver @{}
    Yes 'known_hosts without the pinned key: refused, exit 1' ($r.Code -eq 1 -and $r.Text -match 'does not hold the key scripts\\vps\\vps\.json pins' -and $r.Text -match 'Setup-SshKey')
    Yes '  before any ssh at all' ($global:H.Calls.Count -eq 0)
    $global:H.HostFp = $pin

    # ---- key login not proven ----------------------------------------------------------
    Fresh
    $global:H.KeyWorks = $false
    $r = Invoke-Driver @{}
    Yes 'key login not proven: refused, exit 1, and says why' ($r.Code -eq 1 -and $r.Text -match 'Key login as Administrator is not proven' -and $r.Text -match 'Nothing was changed')
    Yes '  the only thing it did was the key probe' ($global:H.Calls.Count -eq 1 -and $global:H.Calls[0] -match 'echo THORNSWOOD_KEY_OK')
    Yes '  which allowed publickey and nothing else, with the host key checked' ($global:H.Calls[0] -match 'PreferredAuthentications=publickey' -and $global:H.Calls[0] -match 'StrictHostKeyChecking=yes' -and $global:H.Calls[0] -match 'BatchMode=yes')
    Yes '  nothing was sent and nothing changed' (-not $global:H.Sent -and [IO.File]::ReadAllText($global:H.Cfg) -eq $defaultCfg -and $global:Fake.log.Count -eq 0)
    $global:H.KeyWorks = $true

    # ---- -WhatIf -------------------------------------------------------------------------
    Fresh
    $r = Invoke-Driver @{ WhatIf = $true }
    Yes '-WhatIf: exit 0 and says nothing was changed' ($r.Code -eq 0 -and $r.Text -match 'Nothing was changed\. Run it again without -WhatIf')
    Yes '  the box ran read only' (@($global:H.Calls | Where-Object { $_ -match ' BOX -DryRun$' }).Count -eq 1 -and $r.Text -match 'WOULD sshd_config')
    Yes '  and nothing changed there' ([IO.File]::ReadAllText($global:H.Cfg) -eq $defaultCfg -and $global:Fake.log.Count -eq 0 -and $global:Fake.fDeny -eq 0)
    Yes '  vps-harden.ps1 went whole by scp to a copy its run took off the box, so nothing of it is left there (#3035, #3059)' (
        $global:H.Sent -match 'thornswood-remote-[0-9a-f]{32}\.ps1$' -and @(Get-ChildItem -LiteralPath $global:H.Far -File).Count -eq 0 -and
        @($global:H.Calls | Where-Object { $_ -like 'scp *' }).Count -ge 1 -and @($global:H.Calls | Where-Object { $_ -match '-File ' }).Count -eq 0)
    Yes '  it showed the login methods and the port before' ($r.Text -match 'login methods now\s+publickey, password, keyboard-interactive' -and $r.Text -match "port $closedPort now\s+does not answer")

    # ---- the real run ----------------------------------------------------------------------
    Fresh
    $r = Invoke-Driver @{}
    Yes 'real run: exit 0' ($r.Code -eq 0)
    Yes '  the box ran for real, after the key probe' (@($global:H.Calls | Where-Object { $_ -match ' BOX$' }).Count -eq 1 -and $global:H.Calls[0] -match 'echo THORNSWOOD_KEY_OK')
    Yes '  and made the change' ([IO.File]::ReadAllText($global:H.Cfg) -match '(?m)^PasswordAuthentication no' -and $global:Fake.fDeny -eq 1 -and $global:Fake.term.StartType -eq 'Disabled')
    Yes '  key login proven again before the rollback was cancelled' ($global:H.Cancelled -and
        (@($global:H.Calls | Select-Object -Skip 1 | ForEach-Object { $_ }) -join "`n") -match '(?s) BOX\n.*echo THORNSWOOD_KEY_OK.*\n.*EncodedCommand')
    Yes '  PASS for key login, password refused and the port closed' ($r.Text -match 'PASS  key login works' -and $r.Text -match 'PASS  password login refused \(the box offers publickey\)' -and $r.Text -match "PASS  port $closedPort closed from here")
    Yes '  every ssh and scp it ran checked the host key' (@($global:H.Calls | Where-Object { $_ -notmatch 'StrictHostKeyChecking=yes' }).Count -eq 0)

    # ---- the port still answers --------------------------------------------------------------
    Fresh
    $open = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0); $open.Start()
    try { $r = Invoke-Driver @{ RdpPort = $open.LocalEndpoint.Port } }
    finally { $open.Stop() }
    Yes 'a port that still answers afterwards: FAIL and exit 1' ($r.Code -eq 1 -and $r.Text -match 'FAIL  port \d+ closed from here')

    # ---- the box stops ---------------------------------------------------------------------------
    Fresh
    $global:Fake.sshdOk = $false
    $r = Invoke-Driver @{}
    Yes 'the box stopping stops it too, exit 1, with no rollback to cancel' ($r.Code -eq 1 -and $r.Text -match 'The box stopped' -and -not $global:H.Cancelled)
}
finally {
    foreach ($f in 'ssh', 'scp', 'ssh-keygen') { Remove-Item -Path ("function:global:" + $f) -ErrorAction SilentlyContinue }
    Remove-Variable -Name Fake, H -Scope Global -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
