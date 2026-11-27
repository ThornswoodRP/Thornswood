<#
.SYNOPSIS
  Upgrades the box's OpenSSH for Windows to a release with a post-quantum key exchange, keeping the pinned host keys: proves key login, swaps sshd on the box, proves a new login with the pinned key negotiates a post-quantum key exchange, and only then keeps it.

.DESCRIPTION
  Issue #1043. From 28 Sep 2026 every ssh from One to the box printed
  "** WARNING: connection is not using a post-quantum key exchange
  algorithm". The box's sshd is Windows Server 2022's own (OpenSSH for
  Windows 9.5), which Microsoft built without any post-quantum key exchange
  (vps-openssh.ps1 says how that was measured). Decided by Patrick on
  22 Oct 2026 (A): the Desk upgrades it at the box's next restart window,
  checks the host key is the one scripts\vps\vps.json pins, and checks ssh
  connects with no warning.

  Runs on your machine, or a cloud thread after Setup-CloudSsh.ps1. In this
  order, and it stops at the first thing that is not right:

    1. The box's own key. known_hosts here must hold only keys
       scripts\vps\vps.json pins.
    2. Key login, before anything else.
    3. Which key exchange a login gets now, from ssh -v.
    4. On the box: scripts\vps\vps-openssh.ps1 -Phase Plan, sent through
       Send-Script.ps1 with the pins. It refuses unless sshd reads the pinned
       host keys, downloads the pinned MSI and checks its SHA256 and
       Microsoft's signature, writes the box's state, and arms two tasks:
       the swap in about 20 seconds and the put back in 25 minutes.
    5. The swap. sshd is down by design while the box removes the inbox
       OpenSSH and installs the new one, and the only sign from the box that
       it ended is that a login gets in again, so one login is tried every
       15 seconds for up to -WaitMinutes (15), inside the put back's 25.
    6. What the swap did (-Phase Report), word for word.
    7. A new login with ssh -v. It only gets in when the box shows a pinned
       host key (StrictHostKeyChecking yes, and known_hosts holds nothing
       else), and it must negotiate mlkem768x25519-sha256 or
       sntrup761x25519-sha512 with OpenSSH_for_Windows_10.4.
    8. Only then -Phase Finish: the put back is cancelled and the box's work
       folder removed. If anything before this failed, the put back stays
       armed and the box returns to the inbox sshd by itself.

  -WhatIf does 1 to 3 and runs step 4 read only (-DryRun): it checks the
  download the same way and says what WOULD change.

  -Report runs only step 6, for a run that was cut short: what the swap and
  the put back did and what sshd is now.

  WHEN. It cuts every ssh session for the minute or two the swap takes, so
  run it when no deploy, Ship, backup or lane run is talking to the box
  (the ops repo's issues\1043.md records the run on the box).

  THE WAY BACK, BY HAND, if no machine can reach ssh after the put back's
  time has passed. The VPS provider's panel (BisectHosting, VirtFusion) has a
  console for the server that does not use the network: open the server
  there, open its VNC console, sign in as Administrator with the Windows
  password, and in PowerShell:
      Get-Content C:\ProgramData\Thornswood-OpenSSH\swap.log, C:\ProgramData\Thornswood-OpenSSH\putback.log
      Start-ScheduledTask 'Thornswood OpenSSH put back'
  and if that task is gone, the inbox sshd by hand:
      Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
      Set-Service sshd -StartupType Automatic; Start-Service sshd

.PARAMETER Vps
  The box's address. vps.json's by default.

.PARAMETER User
  The account the scripts log in as. vps.json's by default (Administrator).

.PARAMETER KnownHosts
  The known_hosts file that must already hold the pinned key.

.PARAMETER WaitMinutes
  How long step 5 waits for sshd to come back. 15 by default, which is
  inside the put back's 25 minutes.

.PARAMETER Report
  Only read what the last run did on the box.

.PARAMETER NoPause
  Do not wait for Enter before closing.

.EXAMPLE
  pwsh -NoProfile -File scripts/vps/Upgrade-OpenSsh.ps1 -WhatIf -NoPause
  Proves key login, checks the download and says what would change.

.EXAMPLE
  pwsh -NoProfile -File scripts/vps/Upgrade-OpenSsh.ps1 -NoPause
  Upgrades sshd and keeps it only once a new login proves it.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$Vps = '',
    [string]$User = '',
    [string]$KnownHosts = '',
    [int]$WaitMinutes = 15,
    [switch]$Report,
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Send-Script.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $KnownHosts) { $KnownHosts = Get-ThornswoodKnownHostsPath -Address $Vps }

$BoxScript = Join-Path $Here 'vps-openssh.ps1'
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
$PqKex = @('mlkem768x25519-sha256', 'sntrup761x25519-sha512', 'sntrup761x25519-sha512@openssh.com')
$Want = 'OpenSSH_for_Windows_10.4'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

# A new connection with the key and nothing else.
function Test-KeyLogin {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodNative { & ssh @ssh -o PreferredAuthentications=publickey "$User@$Vps" 'echo THORNSWOOD_KEY_OK' } 2>&1 | ForEach-Object { [string]$_ })
    $ErrorActionPreference = $old
    return (($out -join "`n") -match 'THORNSWOOD_KEY_OK')
}

# What a new key login is offered and agrees on, from ssh -v.
function Get-Handshake {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodNative { & ssh @ssh -v -o PreferredAuthentications=publickey "$User@$Vps" 'echo THORNSWOOD_KEY_OK' } 2>&1 | ForEach-Object { [string]$_ })
    $ErrorActionPreference = $old
    $kex = ''; $server = ''
    foreach ($l in $out) {
        if ($l -match 'kex: algorithm: (\S+)') { $kex = $Matches[1] }
        if ($l -match 'remote software version (\S+)') { $server = $Matches[1] }
    }
    return [pscustomobject]@{ In = (($out -join "`n") -match 'THORNSWOOD_KEY_OK'); Kex = $kex; Server = $server; Pq = ($PqKex -contains $kex) }
}

function Invoke-Box([string]$Arguments) {
    if (-not (Test-Path -LiteralPath $BoxScript)) { Die "There is no $BoxScript. Nothing was sent." }
    $script = Get-ThornswoodFileScript -Path $BoxScript -Arguments $Arguments
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ("`$ProgressPreference = 'SilentlyContinue'`r`n" + $script) | ForEach-Object { [string]$_ } | Where-Object { $_ })
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
function Test-BoxStopped($box) { return ($box.Code -ne 0 -or @($box.Lines | Where-Object { $_ -match '^STOP ' }).Count -gt 0) }

Write-Host ''
Write-Host '  THORNSWOOD  -  OpenSSH on the box' -ForegroundColor White
Say "  $User@$Vps" 'DarkGray'

foreach ($t in 'ssh', 'ssh-keygen') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client." }
}

Head "1. The box's own key"
$hk = Test-ThornswoodKnownHost -Address $Vps -KnownHosts $KnownHosts
if ($hk.Status -ne 'trusted') {
    Die ("known_hosts does not hold only keys scripts\vps\vps.json pins for $Vps (" + $hk.Status + '). Run .\scripts\vps\Setup-SshKey.ps1 (or Setup-CloudSsh.ps1) first. Nothing was changed.')
}
Say '  known_hosts holds the pinned key' 'Green'

if ($Report) {
    Head 'What the last run did on the box'
    $box = Invoke-Box '-Phase Report'
    if (Test-BoxStopped $box) { Done 1 }
    Done 0
}

Head '2. Key login, before anything else'
if (-not (Test-KeyLogin)) { Die "Key login as $User is not proven. Run .\scripts\vps\Setup-SshKey.ps1 -Test until it works. Nothing was changed." }
Say "  $User gets in with the key alone" 'Green'

Head '3. The key exchange a login gets now'
$before = Get-Handshake
Say ('  ' + $before.Server + ', ' + $before.Kex + $(if ($before.Pq) { ', post-quantum' } else { ', not post-quantum' }))

$pins = (Get-ThornswoodVpsHostKeys) -join ','
$doIt = $PSCmdlet.ShouldProcess("$User@$Vps", 'replace the inbox OpenSSH with OpenSSH for Windows 10.4')
Head $(if ($doIt) { '4. On the box' } else { '4. On the box, read only' })
$box = Invoke-Box ("-Phase Plan -Pins '" + $pins + "'" + $(if ($doIt) { '' } else { ' -DryRun' }))
if (Test-BoxStopped $box) { Die ('The box stopped (exit ' + $box.Code + '). The lines above say where.') }
if (-not @($box.Lines | Where-Object { $_ -match '^DONE ' }).Count) {
    Die 'The box did not answer with its summary line, so what it did is not known. Run this again with -Report.'
}
if (-not $doIt) { Write-Host ''; Say 'Nothing was changed. Run it again without -WhatIf to make the changes above.' 'Yellow'; Done 0 }
if (-not @($box.Lines | Where-Object { $_ -match '^CHANGED .*Thornswood OpenSSH upgrade' }).Count) { Say '  nothing to change' 'Green'; Done 0 }

Head '5. The swap'
# One try every 15 seconds, the only sign the box can give: sshd is down on
# purpose until the swap ends, and the put back covers a swap that never does.
$until = (Get-Date).AddMinutes($WaitMinutes)
Start-Sleep -Seconds 30
$back = $false
while ((Get-Date) -lt $until) {
    if (Test-KeyLogin) { $back = $true; break }
    Say ('  ' + (Get-Date -Format 'h:mm:ss tt') + '  sshd is not answering yet') 'DarkGray'
    Start-Sleep -Seconds 15
}
if (-not $back) {
    Die ("sshd did not come back within $WaitMinutes minutes. The box puts the inbox sshd back by itself 25 minutes after step 4 (task 'Thornswood OpenSSH put back'); " +
         'then run this with -Report. If ssh is still refused after that, the way back is in Get-Help .\scripts\vps\Upgrade-OpenSsh.ps1 -Full.')
}
Say "  key login as $User gets in again" 'Green'

Head '6. What the swap did'
$box = Invoke-Box '-Phase Report'
$worked = @($box.Lines | Where-Object { $_ -match '^KEPT result\.json: .*"ok":true' }).Count -gt 0
if (-not $worked) { Die 'The swap did not say it worked, so the put back runs (or ran); the lines above say what happened. Put them on #1043.' }

Head '7. A new login'
$after = Get-Handshake
Say ('  ' + $after.Server + ', ' + $after.Kex)
$keyOk = $after.In
$pqOk = $after.Pq
$verOk = $after.Server.StartsWith($Want)
Say ('  ' + $(if ($keyOk) { 'PASS' } else { 'FAIL' }) + '  a new login gets in, so the box showed a pinned host key') $(if ($keyOk) { 'Green' } else { 'Red' })
Say ('  ' + $(if ($pqOk) { 'PASS' } else { 'FAIL' }) + '  it negotiated a post-quantum key exchange (' + $after.Kex + ')') $(if ($pqOk) { 'Green' } else { 'Red' })
Say ('  ' + $(if ($verOk) { 'PASS' } else { 'FAIL' }) + '  the box says ' + $after.Server) $(if ($verOk) { 'Green' } else { 'Red' })
if (-not ($keyOk -and $pqOk -and $verOk)) { Die 'Not kept: the put back stays armed and returns the box to the inbox sshd within 25 minutes of step 4.' }

Head '8. Keep it'
$box = Invoke-Box '-Phase Finish'
if (Test-BoxStopped $box) { Die 'Finish stopped; the lines above say where. The put back may still be armed: run this with -Report.' }
Done 0
