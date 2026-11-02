<#
.SYNOPSIS
  Closes the VPS to everything but ssh with a key: proves key login works, then turns ssh password login off and turns Remote Desktop off, and the Windows services and telemetry the box never uses, and moves Windows Update and its maintenance to 4 AM.

.DESCRIPTION
  Issue #450. Patrick, 28 September: yes to password login off once key login
  is proven, and Remote Desktop off ("I use SSH not RDP").

  Runs on your machine. In this order, and it stops at the first thing that
  is not right, with nothing changed:

    1. The box's own key. known_hosts here must hold the host key
       scripts\vps\vps.json pins (Setup-SshKey.ps1 writes it).
    2. Key login, before anything else. ssh with publickey as the only method
       allowed must get into the account the scripts use (vps.json "user",
       Administrator). If it does not, this refuses: turning passwords off
       would leave no way in over ssh at all.
    3. From outside, before: which login methods the box offers, and whether
       Remote Desktop's port answers from here.
    4. On the box: scripts\vps\vps-harden.ps1 is run there, sent through
       Send-Script.ps1, whose run deletes a long script's copy before it
       runs (#3035, #3059; until 21 Oct 2026 it was copied into
       C:\Windows\Temp and removed after, and a run cut short left the copy
       there). Remote Desktop refused, its
       firewall rules turned off, its service stopped and set to Disabled;
       ssh's own rules on port 22 are never touched. Then the Windows
       services the box never uses (the print spooler, telemetry and six
       more, vps-harden.ps1 lists each and why, #3186) stopped and set to
       Disabled. Then telemetry off: DiskSnapshot.exe's, CompatTelRunner.exe's
       and the Customer Experience Improvement Program's tasks set to
       Disabled, and AllowTelemetry 0. Then Windows Update, which stays on,
       installs every day at 4 AM box time, restarts the box 15 minutes
       after an install that needs it, so in the 4 AM to 6 AM window, and
       its automatic maintenance starts at 4 AM, after the 2:15 AM backup
       and the nightly checks (Patrick, 22 Oct 2026, #3213). A restart
       Windows set before that is said, WARN when it is outside the window,
       and left. Then PasswordAuthentication
       no and KbdInteractiveAuthentication no in sshd_config, checked with
       sshd -t first, the old file kept beside it, and sshd restarted. Every
       line it prints says CHANGED, WOULD, ALREADY, KEPT, WARN or STOP.
    5. After: key login again, then the rollback the box armed is cancelled
       (see below), then from outside: the box offers publickey only, and
       Remote Desktop's port does not answer.

  -WhatIf does steps 1 to 3 and runs step 4 read only: it prints what WOULD
  change and changes nothing. It is also the check: run on a box already
  hardened, every line says ALREADY, and a WOULD names what has come back on.

  THE SAFETY NET. When sshd_config changes, the box also registers a task,
  "Thornswood harden rollback", that puts the old sshd_config back and
  restarts sshd ten minutes later. Step 5 cancels it only after key login is
  proven again. So if anything about the change kept the key out, wait ten
  minutes and ssh works the way it did before, password included.

  THE WAY BACK, BY HAND, if ssh does not work at all. The VPS provider's
  panel (BisectHosting, VirtFusion) has a console for the server that does
  not use the network: open the server there, open its VNC console, and sign
  in as Administrator with the Windows password. This script does not change
  that password, so keep it where you keep your passwords. Then, in
  PowerShell on the box:

    Password login back:
      Get-ChildItem C:\ProgramData\ssh\sshd_config.before-harden-*
      Copy-Item <the newest of those> C:\ProgramData\ssh\sshd_config -Force
      Restart-Service sshd

    A service back (vps-harden.ps1 $IdleServices names them), for example:
      Set-Service Spooler -StartupType Automatic
      Start-Service Spooler

    A telemetry task back (vps-harden.ps1 $TelemetryTasks names them):
      Enable-ScheduledTask -TaskPath '\Microsoft\Windows\DiskFootprint\' -TaskName Diagnostics

    Windows Update as it was before (vps-harden.ps1 $UpdatePolicies names
    each value), for example:
      Set-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' AUOptions 7

    Remote Desktop back (the firewall takes rules only from the box's own
    policy store since #3896, scripts\vps\BoxFirewall.ps1):
      Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' fDenyTSConnections 0
      Copy-NetFirewallRule -Group '@FirewallAPI.dll,-28752' -NewPolicyStore localhost
      Enable-NetFirewallRule -PolicyStore localhost -Group '@FirewallAPI.dll,-28752'
      gpupdate /target:computer /force
      Set-Service TermService -StartupType Manual
      Start-Service TermService
    The two "Thornswood: block RDP from outside" rules put on the box by hand
    before this script existed still block port 3389; turn those off too
    (Disable-NetFirewallRule -PolicyStore localhost -DisplayName 'Thornswood: block RDP from outside*',
    then gpupdate /target:computer /force).

    Microsoft Edge back (#3896; the WebView2 Runtime never went):
      Remove-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\EdgeUpdate' 'Install{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}'
    then install Edge from https://www.microsoft.com/edge/business/download.

  HOW TO CONFIRM IT WORKED, by hand, from your machine:
      .\scripts\vps\Setup-SshKey.ps1 -Test
        prints "it does. Nothing to do.": key login still works.
      ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password Administrator@<address>
        is refused at once with "Permission denied (publickey)" and never
        asks for a password.
      Test-NetConnection <address> -Port 3389
        TcpTestSucceeded : False.
  Step 5 does all three itself and says which passed.

.PARAMETER Vps
  The box's address. vps.json's by default.

.PARAMETER User
  The account the scripts log in as, whose key login is proven first.
  vps.json's by default (Administrator).

.PARAMETER KnownHosts
  The known_hosts file that must already hold the pinned key.
  ~\.ssh\known_hosts by default.

.PARAMETER RdpPort
  The port that must not answer from here afterwards. 3389 is Remote
  Desktop's.

.PARAMETER SettleSeconds
  How long to wait after the box answers before proving key login again,
  while sshd restarts. 10 by default.

.PARAMETER NoPause
  Do not wait for Enter before closing.

.EXAMPLE
  .\scripts\vps\Harden-VPS.ps1 -WhatIf
  Proves key login and says what would change on the box. Changes nothing.

.EXAMPLE
  .\scripts\vps\Harden-VPS.ps1
  Makes the change, then proves key login still works, password login is
  refused and Remote Desktop's port is closed from here.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$Vps = '',
    [string]$User = '',
    [string]$KnownHosts = '',
    [int]$RdpPort = 3389,
    [int]$SettleSeconds = 10,
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Send-Script.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $KnownHosts) { $KnownHosts = Get-ThornswoodKnownHostsPath -Address $Vps }

$BoxScript = Join-Path $Here 'vps-harden.ps1'
$Rollback = 'Thornswood harden rollback'
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

# The box's answer as lines, the empty ones left out. A warning ssh prints
# stays in, so one that starts is seen (#1043).
function Clean($lines) {
    @($lines | ForEach-Object { [string]$_ } | Where-Object { $_ })
}

# Publickey as the only method, so a password can never be what lets it in.
function Test-KeyLogin {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodNative { & ssh @ssh -o PreferredAuthentications=publickey "$User@$Vps" 'echo THORNSWOOD_KEY_OK' } 2>&1 | ForEach-Object { [string]$_ })
    $ErrorActionPreference = $old
    return (($out -join "`n") -match 'THORNSWOOD_KEY_OK')
}

# The methods the box offers a login that brings no key, from ssh -v's
# "Authentications that can continue" line. Nothing is typed and nothing gets
# in: BatchMode never asks for a password.
function Get-LoginMethods {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodNative { & ssh @ssh -v -o PubkeyAuthentication=no "$User@$Vps" 'exit' } 2>&1 | ForEach-Object { [string]$_ })
    $ErrorActionPreference = $old
    $line = @($out | Where-Object { $_ -match 'Authentications that can continue:' }) | Select-Object -Last 1
    if (-not $line) { return $null }
    return @((($line -split 'continue:')[1]).Trim() -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Test-PortOpen([string]$Address, [int]$Port) {
    $c = New-Object Net.Sockets.TcpClient
    try {
        $a = $c.BeginConnect($Address, $Port, $null, $null)
        if (-not $a.AsyncWaitHandle.WaitOne(4000)) { return $false }
        try { $c.EndConnect($a) } catch { return $false }
        return $c.Connected
    }
    catch { return $false }
    finally { $c.Close() }
}

function Show-Outside([string]$when) {
    $m = Get-LoginMethods
    if ($null -eq $m) { Say "  login methods $when   the box did not say" 'Yellow' }
    else { Say ("  login methods $when   " + ($m -join ', ')) }
    $open = Test-PortOpen $Vps $RdpPort
    Say ("  port $RdpPort $when       " + $(if ($open) { 'answers from here' } else { 'does not answer from here' }))
    return [pscustomobject]@{ Methods = $m; RdpOpen = $open }
}

# vps-harden.ps1 runs on the box from ssh's standard input (Send-Script.ps1),
# so a run cut short at any point leaves nothing of it there (#3035).
function Invoke-Box([bool]$dry) {
    if (-not (Test-Path -LiteralPath $BoxScript)) { Die "There is no $BoxScript. Nothing was sent." }
    $script = Get-ThornswoodFileScript -Path $BoxScript -Arguments $(if ($dry) { '-DryRun' } else { '' })
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = Clean @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ("`$ProgressPreference = 'SilentlyContinue'`r`n" + $script))
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    foreach ($l in $out) {
        $c = 'Gray'
        if ($l -match '^CHANGED ') { $c = 'Green' }
        elseif ($l -match '^(WOULD|WARN) ') { $c = 'Yellow' }
        elseif ($l -match '^STOP ') { $c = 'Red' }
        elseif ($l -match '^(ALREADY|KEPT) ') { $c = 'DarkGray' }
        Say "  $l" $c
    }
    return [pscustomobject]@{ Code = $rc; Lines = $out }
}

Write-Host ''
Write-Host '  THORNSWOOD  -  key login only, Remote Desktop off' -ForegroundColor White
Say "  $User@$Vps" 'DarkGray'

foreach ($t in 'ssh', 'ssh-keygen') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client." }
}

# ------------------------------------------------------------- 1. host key ---
Head "1. The box's own key"
$hk = Test-ThornswoodKnownHost -Address $Vps -KnownHosts $KnownHosts
if ($hk.Status -ne 'trusted') {
    Die ("known_hosts does not hold the key scripts\vps\vps.json pins for $Vps (" + $hk.Status + '). Run .\scripts\vps\Setup-SshKey.ps1 first. Nothing was changed.')
}
Say '  known_hosts holds the pinned key' 'Green'

# ------------------------------------------------------------ 2. key login ---
Head '2. Key login, before anything else'
if (-not (Test-KeyLogin)) {
    Die ("Key login as $User is not proven: ssh with a key and nothing else did not get in. Turning passwords off now could leave no way in over ssh. " +
         'Run .\scripts\vps\Setup-SshKey.ps1 until -Test says it works, then run this again. Nothing was changed.')
}
Say "  $User gets in with the key alone" 'Green'

# ------------------------------------------------------ 3. outside, before ---
Head '3. From outside, before'
$before = Show-Outside 'now'

# ----------------------------------------------------------------- 4. box ---
$doIt = $PSCmdlet.ShouldProcess("$User@$Vps", 'turn ssh password login, Remote Desktop, telemetry and the services the box never uses off, and move Windows Update to 4 AM')
Head $(if ($doIt) { '4. On the box' } else { '4. On the box, read only' })
$box = Invoke-Box (-not $doIt)
if ($box.Code -ne 0 -or @($box.Lines | Where-Object { $_ -match '^STOP ' }).Count) {
    Die ('The box stopped (exit ' + $box.Code + '). The lines above say where; anything before the STOP line was done.')
}
if (-not @($box.Lines | Where-Object { $_ -match '^DONE ' }).Count) {
    Die 'The box did not answer with its summary line, so what it did is not known. Run this again with -WhatIf to read where it stands.'
}
if (-not $doIt) {
    Write-Host ''
    Say 'Nothing was changed. Run it again without -WhatIf to make the changes above.' 'Yellow'
    Done 0
}

# ---------------------------------------------------------------- 5. after ---
Head '5. After'
$armed = @($box.Lines | Where-Object { $_ -match [regex]::Escape($Rollback) }).Count -gt 0
if ($armed -and $SettleSeconds -gt 0) { Say "  waiting $SettleSeconds s while sshd restarts" 'DarkGray'; Start-Sleep -Seconds $SettleSeconds }
$back = $false
for ($i = 0; $i -lt 6; $i++) {
    if (Test-KeyLogin) { $back = $true; break }
    if ($SettleSeconds -gt 0) { Start-Sleep -Seconds 5 }
}
if (-not $back) {
    Die ("Key login does not get in after the change. The box puts the old sshd_config back by itself within ten minutes (task '$Rollback'); " +
         'wait for that, then run .\scripts\vps\Setup-SshKey.ps1 -Test. If ssh is still refused after fifteen minutes, the way back is in Get-Help .\scripts\vps\Harden-VPS.ps1 -Full.')
}
Say "  key login as $User still works" 'Green'

if ($armed) {
    $cancel = "`$ProgressPreference = 'SilentlyContinue'`r`nUnregister-ScheduledTask -TaskName '$Rollback' -Confirm:`$false -ErrorAction SilentlyContinue`r`nif (Get-ScheduledTask -TaskName '$Rollback' -ErrorAction SilentlyContinue) { 'ROLLBACK_STILL_ARMED' } else { 'ROLLBACK_CANCELLED' }"
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cancel))
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $said = (@(Invoke-ThornswoodNative { & ssh @ssh "$User@$Vps" "pwsh -NoProfile -EncodedCommand $enc" } 2>&1 | ForEach-Object { [string]$_ }) -join ' ')
    $ErrorActionPreference = $old
    if ($said -match 'ROLLBACK_CANCELLED') { Say "  CHANGED the rollback task is cancelled, so the change stays" 'Green' }
    else { Die "Could not cancel the task '$Rollback', so the box will put password login back within ten minutes. Run this again once that has happened." }
}

$after = Show-Outside 'now'
$pwOff = ($null -ne $after.Methods) -and ($after.Methods -notcontains 'password') -and ($after.Methods -notcontains 'keyboard-interactive')
$rdpOff = -not $after.RdpOpen

Write-Host ''
Say ('  ' + $(if ($back) { 'PASS' } else { 'FAIL' }) + '  key login works') $(if ($back) { 'Green' } else { 'Red' })
Say ('  ' + $(if ($pwOff) { 'PASS' } else { 'FAIL' }) + '  password login refused (the box offers ' + $(if ($null -eq $after.Methods) { 'nothing it would name' } else { $after.Methods -join ', ' }) + ')') $(if ($pwOff) { 'Green' } else { 'Red' })
Say ('  ' + $(if ($rdpOff) { 'PASS' } else { 'FAIL' }) + "  port $RdpPort closed from here") $(if ($rdpOff) { 'Green' } else { 'Red' })
if ($back -and $pwOff -and $rdpOff) { Done 0 }
Done 1
