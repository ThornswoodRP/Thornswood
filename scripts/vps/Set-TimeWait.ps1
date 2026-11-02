<#
.SYNOPSIS
  Sets TcpTimedWaitDelay to 30 seconds on the VPS, so the box stops dropping
  connections from the cloud before TLS (#2946), and restarts the box for it
  when asked and nobody is on either server.

.DESCRIPTION
  Issue #2946, Patrick's A on q-2946-time-wait (21 Oct 2026). The cause, as
  measured with pktmon on 21 Oct: the box closes each cloud HTTPS connection
  first, so Windows keeps its address and port in TIME_WAIT for 120 s; the
  cloud's NAT gives the same address and port to a new connection 35 to 117 s
  later; and Windows silently drops that new SYN whenever its sequence number
  is below the old connection's. At 30 s the box has let go of the pair
  before the NAT hands it out again. scripts\vps\vps-time-wait.ps1 says more.

  Runs on your machine. In this order, and it stops at the first thing that
  is not right:

    1. The box's own key. known_hosts here must hold the host key
       scripts\vps\vps.json pins.
    2. Key login, and when the box last started.
    3. On the box: scripts\vps\vps-time-wait.ps1 runs there, sent through
       Send-Script.ps1, whose run deletes a long script's copy before it
       runs (#3035, #3059; until 21 Oct 2026 it was copied into
       C:\Windows\Temp and removed after, and a run cut short left the copy
       there). It sets the value and reads it
       back. With -Restart it then reads who is on the live and the dev
       server, refuses while anybody is or while a count cannot be read, and
       restarts the box.
    4. With -Restart: waits for the box to answer again with a later start
       time, then reads the value as Windows now holds it.
    5. With -Restart: the Thornswood startup tasks, the bot and the ports, as
       the box has them after it started.

  -Check only reads the value. -WhatIf does steps 1 and 2 and runs step 3
  read only: it prints what WOULD change, and that it would restart.

  Windows reads the value only when it starts, so without -Restart it is set
  and does nothing yet.

  A restart stops everything on the box for a few minutes: both servers,
  voice, the site and the feed, the bot, the bridge, and every build on the
  box's runners. Each comes back by itself as a startup task or service.

.PARAMETER Check
  Only say what the value is now. Nothing is changed.

.PARAMETER Restart
  Restart the box once the value is set, so Windows reads it.

.PARAMETER Vps
  The box's address. vps.json's by default.

.PARAMETER User
  The account the scripts log in as. vps.json's by default (Administrator).

.PARAMETER KnownHosts
  The known_hosts file that must already hold the pinned key.

.PARAMETER BackMinutes
  How long to wait for the box to answer again after the restart. 15 by
  default.

.PARAMETER PollSeconds
  How often to ask whether it has. 15 by default.

.PARAMETER NoPause
  Do not wait for Enter before closing.

.EXAMPLE
  .\scripts\vps\Set-TimeWait.ps1 -Check
  Says what TcpTimedWaitDelay is on the box. Changes nothing.

.EXAMPLE
  .\scripts\vps\Set-TimeWait.ps1 -Restart -WhatIf
  Says what it would change, who is on, and that it would restart.

.EXAMPLE
  .\scripts\vps\Set-TimeWait.ps1 -Restart
  Sets the value, restarts the box when nobody is on, and reads it back after.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [switch]$Check,
    [switch]$Restart,
    [string]$Vps = '',
    [string]$User = '',
    [string]$KnownHosts = '',
    [int]$BackMinutes = 15,
    [int]$PollSeconds = 15,
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Send-Script.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $KnownHosts) { $KnownHosts = Get-ThornswoodKnownHostsPath -Address $Vps }

$BoxScript = Join-Path $Here 'vps-time-wait.ps1'
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

function Clean($lines) {
    @($lines | ForEach-Object { [string]$_ } | Where-Object { $_ })
}

function Invoke-Encoded([string]$script) {
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("`$ProgressPreference = 'SilentlyContinue'`r`n" + $script))
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = Clean @(Invoke-ThornswoodNative { & ssh @ssh "$User@$Vps" "pwsh -NoProfile -EncodedCommand $enc" } 2>&1)
    $ErrorActionPreference = $old
    return $out
}

# When the box last started, as a sortable UTC stamp, or '' when it does not
# answer. A new connection each time, with the key alone.
$BootAsk = "'BOOT ' + (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')"
function Get-BootTime {
    $l = @(Invoke-Encoded $BootAsk | Where-Object { $_ -match '^BOOT \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$' })
    if ($l.Count) { return $l[0].Substring(5) }
    return ''
}

# vps-time-wait.ps1 runs on the box from ssh's standard input, as
# Harden-VPS.ps1 sends its own (Send-Script.ps1), so a run cut short at any
# point, the restart included, leaves nothing of it there (#3035).
function Invoke-Box([string]$mode) {
    if (-not (Test-Path -LiteralPath $BoxScript)) { Die "There is no $BoxScript. Nothing was sent." }
    $script = Get-ThornswoodFileScript -Path $BoxScript -Arguments $mode
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = Clean @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ("`$ProgressPreference = 'SilentlyContinue'`r`n" + $script))
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    foreach ($l in $out) {
        $c = 'Gray'
        if ($l -match '^(CHANGED|RESTARTING) ') { $c = 'Green' }
        elseif ($l -match '^(WOULD|NOTE) ') { $c = 'Yellow' }
        elseif ($l -match '^STOP ') { $c = 'Red' }
        elseif ($l -match '^ALREADY ') { $c = 'DarkGray' }
        Say "  $l" $c
    }
    return [pscustomobject]@{ Code = $rc; Lines = $out }
}
function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }

Write-Host ''
Write-Host '  THORNSWOOD  -  how long the box holds a closed connection' -ForegroundColor White
Say "  $User@$Vps" 'DarkGray'

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Die 'ssh is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client.' }
if ($Check -and $Restart) { Die '-Check only reads, so it does not go with -Restart.' }

Head "1. The box's own key"
$hk = Test-ThornswoodKnownHost -Address $Vps -KnownHosts $KnownHosts
if ($hk.Status -ne 'trusted') {
    Die ("known_hosts does not hold the key scripts\vps\vps.json pins for $Vps (" + $hk.Status + '). Run .\scripts\vps\Setup-SshKey.ps1 first. Nothing was changed.')
}
Say '  known_hosts holds the pinned key' 'Green'

Head '2. Key login'
$before = Get-BootTime
if (-not $before) { Die "The box does not answer a key login as $User. Run .\scripts\vps\Setup-SshKey.ps1 -Test until it works. Nothing was changed." }
Say "  $User gets in; the box started $before" 'Green'

if ($Check) {
    Head '3. On the box, read only'
    $box = Invoke-Box '-Check'
    if ($box.Code -ne 0 -or -not (Has $box.Lines '^NOW ')) { Die ('The box did not say what the value is (exit ' + $box.Code + ').') }
    Done 0
}

$what = if ($Restart) { 'set TcpTimedWaitDelay to 30 seconds and restart the box' } else { 'set TcpTimedWaitDelay to 30 seconds' }
$doIt = $PSCmdlet.ShouldProcess("$User@$Vps", $what)
Head $(if ($doIt) { '3. On the box' } else { '3. On the box, read only' })
$mode = @()
if ($Restart) { $mode += '-Restart' }
if (-not $doIt) { $mode += '-DryRun' }
$box = Invoke-Box ($mode -join ' ')
if (Has $box.Lines '^STOP ') { Die ('The box stopped (exit ' + $box.Code + '). The lines above say why. It was not restarted.') }
if (-not $doIt) {
    if ($box.Code -ne 0) { Die ('The box did not finish its read (exit ' + $box.Code + ').') }
    Write-Host ''; Say 'Nothing was changed. Run it again without -WhatIf to make the changes above.' 'Yellow'; Done 0
}
if (-not $Restart) {
    if ($box.Code -ne 0) { Die ('The box did not finish (exit ' + $box.Code + '). Run this with -Check to read where it stands.') }
    Done 0
}
# The restart cuts the session, so the exit code says nothing here. A later
# start time is the proof, in the next step.

Head '4. Waiting for the box to start again'
$deadline = (Get-Date).AddMinutes($BackMinutes)
$after = ''
while ((Get-Date) -lt $deadline) {
    if ($PollSeconds -gt 0) { Start-Sleep -Seconds $PollSeconds }
    $b = Get-BootTime
    if ($b -and [string]::CompareOrdinal($b, $before) -gt 0) { $after = $b; break }
}
if (-not $after) {
    Die ("The box has not answered with a later start time in $BackMinutes minutes (it started $before). " +
         'It may still be starting: run this with -Check in a few minutes. If it never answers, the way in is the provider console, in Get-Help .\scripts\vps\Set-SshScope.ps1 -Full.')
}
Say "  the box started again at $after" 'Green'
$box = Invoke-Box '-Check'
if (-not (Has $box.Lines '^NOW TcpTimedWaitDelay is 30 seconds$')) { Die 'The box started again, but it does not read TcpTimedWaitDelay as 30 seconds. The line above says what it reads.' }

Head '5. What started with it'
$read = Invoke-Encoded @'
foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like 'Thornswood*' } | Sort-Object TaskName)) {
  'task      ' + $t.TaskName + ': ' + $t.State
}
$b = Get-Service -Name 'ThornswoodBot' -ErrorAction SilentlyContinue
if ($b) { 'service   ThornswoodBot: ' + $b.Status }
foreach ($p in 443, 7777, 7787) {
  $u = @(Get-NetUDPEndpoint -LocalPort $p -ErrorAction SilentlyContinue).Count
  $c = @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue).Count
  'port      ' + $p + ': ' + $(if ($c) { 'TCP listening ' } else { '' }) + $(if ($u) { 'UDP open' } else { '' }) + $(if (-not ($c -or $u)) { 'nothing yet' } else { '' })
}
'@
foreach ($l in $read) { Say "  $l" }
Say ''
Say '  A service still starting shows Ready or nothing yet; read it again with Check-Site.ps1 and Check-Load.ps1 in a minute.' 'DarkGray'
Done 0
