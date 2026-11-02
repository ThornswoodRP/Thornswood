<#
  Prove-SecretOffCommandLines.ps1

  Proves, on one real run, that a secret-sending script keeps the value off
  every command line on the VPS (issue #1212, the person check of #451).

      .\scripts\vps\Prove-SecretOffCommandLines.ps1 -Run { .\scripts\deploy\Deploy-Docs.ps1 -Password }

  It asks for the value the run is about to send, hidden as it is typed. It
  starts a watcher on the VPS and waits for it to say it is watching, runs the
  script block, and stops the watcher when the run is over. It ends with one
  of:

      NOT FOUND  no command line on the VPS held the value during the run
      FOUND      that many processes on the VPS had it in their command line

  and a count of the process command lines it read. Exit code 0 for NOT FOUND,
  1 for FOUND, 2 when the watcher could not say. A NOT FOUND over no command
  lines at all proves nothing, so it is not one (#1263): that is a 2 as well.

  WHY THIS EXISTS. #1068's person check was a hand-run Get-CimInstance on the
  VPS during the call. That is one snapshot of a remote powershell that lives
  for about a second, and the person reading it does not know the value, so
  the only way to see it is to print every command line, which prints the
  secret on the day the check fails.

  HOW. The watcher goes up the way every secret does (Send-Secret.ps1): the
  value on ssh's standard input, only the watcher's own script on the command
  line. On the VPS it reads Win32_Process about ten times a second until this
  machine sets its stop event when the run is over, and looks in every
  command line for the value, its UTF-8 base64 and its UTF-16 base64, with any
  -EncodedCommand decoded first. It writes nothing to disk and prints only
  counts: never a command line and never the value, whichever way it comes
  out.

  WHY A STOP EVENT (#2912, 20 Oct). The box's OpenSSH hands the remote command
  only what is on standard input when the session starts. Measured from One
  with no secret: a far side that read two lines got the first at once and
  not the second, written 8 seconds later, in 40 seconds; closing standard
  input 30 seconds after that did not end it either. So neither a stop line
  (#2893) nor the end of standard input (#1212) ever reached the watcher, and
  every proof waited out the whole time limit after the run had ended (the
  #451 run at 11:29 AM: over by 11:31 AM, verdict at 11:45 AM). The same
  watcher in Windows PowerShell 5.1 on One with a plain pipe and no sshd got
  both, which is why the harness never saw it.

  So the watcher reads standard input once, for the value, and is stopped on a
  channel that does not go through it: it makes a named event,
  Global\Thornswood-ProofStop-<guid>, the guid new for each run and sent in
  the watcher's script (it is not secret), and waits on it between looks. When
  the run is over this machine opens a second ssh session that sets it. A
  watcher that finds the name already taken stops before it says it is
  watching, so nobody can stop it early by making the name first. With no read
  left waiting on standard input, powershell.exe ends when the script does, at
  the stop or at the time limit, and ssh with it.

  The harness is tests\test-prove-secret.ps1: it runs this against a fake ssh,
  once the way Send-Secret sends (NOT FOUND) and once the old way, the value
  base64'd into the command line (FOUND), and runs the watcher in Windows
  PowerShell 5.1 with its standard input held open, as on the VPS.

  Never prints the value. Reads nothing on the VPS but the process list.
#>
[CmdletBinding()]
param(
    # The real secret-sending run, as it would be typed.
    [Parameter(Mandatory = $true)][scriptblock]$Run,

    # The value the run sends. Asked for, hidden, when not given; otherwise
    # only from another script, as a SecureString nobody can type.
    [System.Security.SecureString]$Secret,

    [string]$VpsHost = '',
    [string]$VpsUser = '',

    # The watcher stops on its own after this long, whatever happens here.
    [int]$MaxSeconds = 900,

    # The ssh to start the watcher with, and any arguments in front of the
    # usual ones. Only the harness changes it.
    [string[]]$SshCommand = @('ssh')
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Send-Secret.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

# What runs on the VPS, after Send-Secret's prelude has read the value. $Stop
# is the name of the event that ends the watch.
function Get-ThornswoodSecretWatcher([int]$Seconds, [string]$Stop) {
    $body = @'
$v = $ThornswoodSecret; $ThornswoodSecret = $null
if (-not $v) { 'WATCHER EMPTY'; exit 2 }
$forms = @($v, [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v)), [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($v)))
$v = $null
# The stop signal, set from a second ssh session when the run is over. Made
# here, so a name somebody else made first is refused before the watch starts.
$made = $false
$stop = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, 'STOPNAME', [ref]$made)
if (-not $made) { 'WATCHER STOP TAKEN'; exit 2 }
$hit = @{}; $read = @{}
function Look {
  foreach ($p in @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, CommandLine)) {
    $c = [string]$p.CommandLine
    if (-not $c) { continue }
    $read[[string]$p.ProcessId + '|' + $c.Length] = 1
    $m = [regex]::Match($c, '-EncodedCommand\s+"?([A-Za-z0-9+/=]+)')
    if ($m.Success) { try { $c += "`n" + [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value)) } catch { } }
    foreach ($f in $forms) { if ($c.Contains($f)) { $hit[[string]$p.ProcessId] = 1 } }
  }
}
$end = (Get-Date).AddSeconds(SECONDS)
'WATCHER READY'
do { Look } while (-not $stop.WaitOne(100) -and (Get-Date) -lt $end)
Look
$stop.Dispose()
if ($hit.Count) { 'WATCHER FOUND ' + $hit.Count } else { 'WATCHER NOT FOUND' }
'WATCHER READ ' + $read.Count
'@
    return (Get-ThornswoodSecretPrelude) + "`r`n" + $body.Replace('SECONDS', [string]$Seconds).Replace('STOPNAME', $Stop)
}

# What the second ssh session runs: sets the watcher's stop event. It says
# STOP SET, or STOP GONE when the watcher has already ended.
function Get-ThornswoodSecretWatcherStop([string]$Stop) {
    return @'
$e = $null
if ([Threading.EventWaitHandle]::TryOpenExisting('STOPNAME', [ref]$e)) { [void]$e.Set(); $e.Dispose(); 'STOP SET' } else { 'STOP GONE' }
'@.Replace('STOPNAME', $Stop)
}

function ConvertTo-ThornswoodArg([string]$a) {
    if ($a -match '[\s"]') { return '"' + $a.Replace('"', '\"') + '"' }
    return $a
}

# One ssh session to the VPS running $Script, every stream this side's.
function Start-ThornswoodProofSsh([string]$Script) {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
    $sshArgs = @($SshCommand | Select-Object -Skip 1) + @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', "$VpsUser@$VpsHost", "pwsh -NoProfile -EncodedCommand $encoded")
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $SshCommand[0]
    $psi.Arguments = (@($sshArgs | ForEach-Object { ConvertTo-ThornswoodArg $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    return [Diagnostics.Process]::Start($psi)
}

# The value to the watcher's ssh, alone on its line, then its standard input
# closed. False when that ssh has already ended: an ssh that cannot reach the
# VPS (no route, a refused key, BatchMode with no way in) exits 255 without
# reading standard input, and a write into the pipe it has closed throws "The
# pipe is being closed" (#2959). Whether it ends before the write or after is
# a race, and both mean the same thing: the watcher did not start. Anything
# but that IOException still throws.
function Send-ThornswoodProofValue([Diagnostics.Process]$Proc, [string]$Wire) {
    try {
        $Proc.StandardInput.WriteLine($Wire)
        $Proc.StandardInput.Flush()
        $Proc.StandardInput.Close()
        return $true
    } catch {
        if (-not ($_.Exception -is [IO.IOException] -or $_.Exception.InnerException -is [IO.IOException])) { throw }
        return $false
    }
}

if ($PSBoundParameters.ContainsKey('Secret')) { $value = ConvertFrom-ThornswoodSecureString $Secret }
else { $value = Read-ThornswoodSecret 'The value the run will send (hidden)' }
$Secret = $null
if (-not $value) { throw 'No value given, so there is nothing to look for. Nothing was started.' }
$wire = ConvertTo-ThornswoodSecretWire $value
$value = $null

$stopName = 'Global\Thornswood-ProofStop-' + [Guid]::NewGuid().ToString('N')
$proc = Start-ThornswoodProofSsh (Get-ThornswoodSecretWatcher $MaxSeconds $stopName)
# Read and dropped: an ssh error line is not the verdict, and is not shown in
# case anything in it came from the far side.
$null = $proc.StandardError.ReadToEndAsync()
$stopper = $null
$verdict = 2
try {
    # The value first, alone on its line, then wait for the watcher to say it
    # is reading the process list before anything is run. The value is all
    # that goes on standard input: the VPS passes on nothing written later.
    $sent = Send-ThornswoodProofValue $proc $wire
    $wire = $null
    $lines = New-Object Collections.Generic.List[string]
    $ready = $false
    while ($sent) {
        $l = $proc.StandardOutput.ReadLine()
        if ($null -eq $l) { break }
        $lines.Add($l)
        if ($l.Trim() -eq 'WATCHER READY') { $ready = $true; break }
    }
    if (-not $ready) {
        Write-Host 'The watcher on the VPS did not start, so nothing was run and nothing is proved.' -ForegroundColor Red
    } else {
        Write-Host "Watching the command lines on $VpsHost. Running it now."
        # The run sees its own variables, not this script's: a $Secret or a
        # $wire of the caller's is not hidden by an empty one here.
        Remove-Variable -Name Secret, value, wire -ErrorAction SilentlyContinue
        try { & $Run }
        finally {
            # The run is over: the watcher takes one more look and answers.
            $stopper = Start-ThornswoodProofSsh (Get-ThornswoodSecretWatcherStop $stopName)
            $stopper.StandardInput.Close()
            $stopSaid = $stopper.StandardOutput.ReadToEndAsync()
            $null = $stopper.StandardError.ReadToEndAsync()
        }
        while ($true) {
            $l = $proc.StandardOutput.ReadLine()
            if ($null -eq $l) { break }
            $lines.Add($l)
        }
        $proc.WaitForExit()
        $stopper.WaitForExit()
        if (-not ($stopSaid.Result -match '(?m)^STOP (SET|GONE)\s*$')) {
            Write-Host "The stop did not reach the watcher on $VpsHost, so it watched to its $MaxSeconds second limit (ssh exit $($stopper.ExitCode))." -ForegroundColor Yellow
        }
        $said = @($lines | ForEach-Object { $_.Trim() } | Where-Object { $_ -like 'WATCHER *' })
        $read = @($said | Where-Object { $_ -like 'WATCHER READ *' } | ForEach-Object { $_.Substring(13) }) | Select-Object -First 1
        $found = @($said | Where-Object { $_ -like 'WATCHER FOUND *' } | ForEach-Object { $_.Substring(14) }) | Select-Object -First 1
        $readCount = 0
        if (-not [int]::TryParse([string]$read, [ref]$readCount)) { $readCount = 0 }
        if ($said -contains 'WATCHER NOT FOUND' -and $readCount -le 0) {
            Write-Host "The watcher read no command lines on $VpsHost, so nothing is proved." -ForegroundColor Red
        } elseif ($said -contains 'WATCHER NOT FOUND') {
            Write-Host "NOT FOUND  no command line on $VpsHost held the value during the run ($read process command lines read)" -ForegroundColor Green
            $verdict = 0
        } elseif ($found) {
            Write-Host "FOUND  $found processes on $VpsHost had the value or its base64 in their command line ($read read)" -ForegroundColor Red
            $verdict = 1
        } else {
            Write-Host 'The watcher on the VPS did not answer, so nothing is proved.' -ForegroundColor Red
        }
    }
}
finally {
    $wire = $null
    # Even when the run threw, the stop is let through, so the watcher on the
    # VPS ends now rather than at its limit.
    if ($stopper) { $stopper.WaitForExit() }
    if (-not $proc.HasExited) { try { $proc.Kill() } catch { } }
}
exit $verdict
