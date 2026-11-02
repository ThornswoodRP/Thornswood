<#
.SYNOPSIS
  Runs ON the VPS, sent there by Set-TimeWait.ps1: holds a connection the box
  closed in TIME_WAIT for 30 seconds instead of Windows' 120, and restarts the
  box for it when asked and nobody is on either server.

.DESCRIPTION
  Issue #2946, Patrick's A on q-2946-time-wait (21 Oct 2026).

  Measured with pktmon on 21 Oct, 03:58Z to 04:13Z. The box closes every
  HTTPS connection from the cloud first, because the cloud's proxy passes the
  client's TLS close_notify at once and its FIN about 10 s later. So Windows
  keeps each one's address and port in TIME_WAIT for 120 s, the default with
  no TcpTimedWaitDelay. The cloud leaves through a NAT that gives the same
  address and port to a new connection 35 to 117 s later. Windows drops that
  new SYN silently whenever its sequence number is below the old
  connection's, which is about half the time: 39 of the 40 SYNs the box
  never answered were that. Of 268 reuses measured, none came sooner than
  35 s. At 30 s the box has let go of the pair before the NAT hands it out
  again.

  TcpTimedWaitDelay is a DWORD under
  HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters. Windows takes 30
  to 300 and reads it only when it starts, so the value does nothing until
  the box restarts.

  Every line it prints starts with a word: NOW, ALREADY, CHANGED, WOULD,
  ROOM, NOTE, RESTARTING or STOP. Set-TimeWait.ps1 sends its text on ssh's
  standard input and pwsh runs it from there, so nothing
  of it is ever written on the box, restart or no restart (#3035).

.PARAMETER Check
  Only say what the value is now. Nothing is changed.

.PARAMETER Restart
  After the value is right, restart the box so Windows reads it. This
  refuses while anybody is on the live or the dev server, or while either
  one's count cannot be read. The servers, voice, the site, the bot, Caddy
  and the bridge all start again with the box (each is a startup task).

.PARAMETER DryRun
  Read everything and say WOULD for each change. Nothing is changed and
  nothing restarts.

.PARAMETER Layer
  A file that replaces the functions below that touch Windows, and may set
  $ServerRoots. Only tests\test-time-wait.ps1 passes it.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Restart,
    [switch]$DryRun,
    [string]$Layer = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Seconds = 30
$Key = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters'
$Name = 'TcpTimedWaitDelay'
$ServerRoots = @('C:\Thornswood-Server', 'C:\Thornswood-Server-Dev')

function Say([string]$word, [string]$what) { Write-Output ($word + ' ' + $what) }

# ---------------------------------------------------------------- the layer ---
# Everything that touches Windows goes through these, so the harness can put
# stand-ins in their place with -Layer and run the rest of this for real.

# Is this the box? scripts\vps\BoxGuard.ps1 (#3041).
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

# The value as a number, or $null when it is not set.
function Get-TimeWaitValue {
    $p = Get-ItemProperty -LiteralPath $Key -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $p) { return $null }
    return [int]$p.$Name
}
function Set-TimeWaitValue([int]$Value) {
    New-ItemProperty -LiteralPath $Key -Name $Name -PropertyType DWord -Value $Value -Force | Out-Null
}

# Whether anything holds this UDP port open: the game server, when it runs.
function Test-PortOpen([int]$Port) {
    return (@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object { $_.LocalPort -eq $Port }).Count -gt 0)
}

function Invoke-BoxRestart { Restart-Computer -Force }

if ($Layer) { . $Layer }

# ---------------------------------------------------------------- the work ---
# Whether the server's game port is open, and the count its online.json holds.
# Read the way Deploy-Server.ps1 reads it (#2740): sharing write and delete,
# because the gamemode replaces the file whole with a rename.
function Get-ServerRoom([string]$Root) {
    $room = @{ Port = 0; Up = $null; Online = $null; Why = '' }
    $settings = Join-Path $Root 'server-settings.json'
    if (-not (Test-Path -LiteralPath $settings)) { $room.Up = $false; $room.Online = 0; $room.Why = 'no server here'; return $room }
    try {
        $s = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
        $room.Port = [int]$s.port
        $d = 'data'
        if ($s.dataDir) { $d = [string]$s.dataDir }
        $data = [IO.Path]::Combine($Root, $d)
    } catch { $room.Why = 'its server-settings.json does not read: ' + $_.Exception.Message; return $room }
    try { $room.Up = (Test-PortOpen $room.Port) }
    catch { $room.Why = 'its game port could not be listed: ' + $_.Exception.Message; return $room }
    if (-not $room.Up) { $room.Online = 0; return $room }
    $f = Join-Path $data 'online.json'
    if (-not (Test-Path -LiteralPath $f)) { $room.Online = 0; return $room }
    try {
        $h = New-Object IO.FileStream($f, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try { $j = (New-Object IO.StreamReader($h, (New-Object Text.UTF8Encoding($false)), $true)).ReadToEnd() | ConvertFrom-Json } finally { $h.Dispose() }
        if ($null -eq $j -or $null -eq $j.now) { throw 'it holds no count' }
        $room.Online = [int]$j.now
    } catch { $room.Why = 'its online.json does not read: ' + $_.Exception.Message }
    return $room
}

function Invoke-TimeWait {
    if (-not $Layer) {
        $notBox = Get-ThornswoodBoxRefusal
        if ($notBox) { Say 'STOP' ($notBox + '. Run Set-TimeWait.ps1 on your machine; it sends this to the box.'); $script:code = 1; return }
    }

    $now = Get-TimeWaitValue
    if ($null -eq $now) { Say 'NOW' "$Name is not set, so Windows holds TIME_WAIT for its default of 120 seconds" }
    else { Say 'NOW' "$Name is $now seconds" }
    if ($Check) { $script:code = 0; return }

    if ($now -eq $Seconds) { Say 'ALREADY' "$Name is $Seconds seconds" }
    elseif ($DryRun) { Say 'WOULD' "set $Name to $Seconds seconds" }
    else {
        Set-TimeWaitValue $Seconds
        $back = Get-TimeWaitValue
        if ($back -ne $Seconds) { Say 'STOP' "$Name reads back as '$back', not $Seconds. Nothing restarted."; $script:code = 1; return }
        Say 'CHANGED' "$Name is $Seconds seconds"
    }

    if (-not $Restart) {
        Say 'NOTE' 'Windows reads it only when it starts: run Set-TimeWait.ps1 -Restart when nobody is on either server.'
        $script:code = 0; return
    }

    $busy = @()
    foreach ($root in $ServerRoots) {
        $r = Get-ServerRoom $root
        if ($null -eq $r.Online) { Say 'STOP' "$root cannot say who is on ($($r.Why)), so the box was not restarted."; $script:code = 1; return }
        $up = if ($r.Up) { 'running' } else { 'not running' }
        Say 'ROOM' ("{0}: {1}, {2} on" -f $root, $up, $r.Online)
        if ($r.Online -gt 0) { $busy += "$root has $($r.Online) on" }
    }
    if ($busy.Count) { Say 'STOP' (($busy -join '; ') + ', so the box was not restarted. Run it again when nobody is on.'); $script:code = 1; return }

    if ($DryRun) { Say 'WOULD' 'restart the box'; $script:code = 0; return }
    $script:RestartNow = $true
    $script:code = 0; return
}

# Every line goes out as it is said; the exit code is kept on the side.
$script:RestartNow = $false
$script:code = 1
try { Invoke-TimeWait }
catch { $script:RestartNow = $false; $script:code = 1; Say 'STOP' ('it failed partway, at: ' + $_.Exception.Message + '. Nothing restarted.') }
$code = $script:code
if ($code -eq 0 -and $script:RestartNow) {
    Say 'RESTARTING' 'the box, so Windows reads the new value; every Thornswood service starts again with it'
    Invoke-BoxRestart
}
exit $code
