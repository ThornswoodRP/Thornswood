<#
  test-1938-server-ready-wait.ps1

      pwsh -NoProfile -File .\tests\test-1938-server-ready-wait.ps1

  A healthy game server start that takes more than 60 s is kept, and a start
  that never answers still rolls back when the ceiling is reached.

  WHY. Deploy-Server, Deploy-DevGamemode, Publish-Server and
  Install-ThornswoodServer each defaulted -Wait to 60. Swap.ps1's Answering
  (and the installer's Answers) wait for both ports: UDP on the game port and
  TCP on the resources port, which opens only once the native server has been
  built without throwing. That is the right signal. The 60 s ceiling was not
  derived from how long a start takes. On 5 Oct Live took 66 s from start to
  both ports answering, so a healthy deploy was rolled back. Dev has taken
  113 s.

  HOW.
    1. Read, not run, wherever PowerShell runs: one file holds the measured
       starts and the derived ceiling (half again the worst of them). The
       four scripts take that ceiling when -Wait is omitted, and the swap
       block waits on $Wait rather than a literal 60.
    2. On Windows, with node, the real swap block is run against a scratch
       folder and a stub that holds the ports the way skymp5-server does:
         - a start that never opens the resources port is SWAP ROLLED BACK
           in about the passed ceiling, not the old 60 s and not forever
         - a start that opens the resources port after 61 s, past the old
           60 s wait, is SWAP OK when the ceiling is the shared one

  Connects to nothing but 127.0.0.1.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Deploy = Join-Path $Repo 'scripts\deploy'
$WaitLib = Join-Path $Deploy 'ServerReadyWait.ps1'
$SwapLib = Join-Path $Deploy 'Swap.ps1'

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

Yes 'ServerReadyWait.ps1 and Swap.ps1 are there' (
    (Test-Path -LiteralPath $WaitLib) -and (Test-Path -LiteralPath $SwapLib))

. $WaitLib
$measuredWorst = [Math]::Max($ThornswoodServerReadyLiveSeconds, $ThornswoodServerReadyDevSeconds)
$derived = [int][Math]::Ceiling($measuredWorst * 1.5)
Yes 'the Live 5 Oct start (66 s) and the Dev start (113 s) are the recorded times' (
    $ThornswoodServerReadyLiveSeconds -eq 66 -and $ThornswoodServerReadyDevSeconds -eq 113)
Yes 'the shared ceiling is half again the worst of those, and past 60 s' (
    $ThornswoodServerReadyWaitSeconds -eq $derived -and
    (Get-ThornswoodServerReadyWait) -eq $derived -and
    $derived -gt 60 -and $derived -ge 113 -and $derived -eq 170)
Yes 'ServerReadyWait.ps1 is plain ASCII, which the box reads right' (
    ([IO.File]::ReadAllText($WaitLib)) -notmatch '[^\x00-\x7F]')

$swapText = [IO.File]::ReadAllText($SwapLib)
Yes 'Swap.ps1 loads the shared wait, and Answering waits $Wait seconds not a literal 60' (
    $swapText.Contains(". (Join-Path `$PSScriptRoot 'ServerReadyWait.ps1')") -and
    $swapText.Contains('(Get-Date).AddSeconds($Wait)') -and
    $swapText -notmatch 'AddSeconds\(\s*60\s*\)')
Yes 'Swap.ps1 lists the UDP ports whole, and says a list it could not have rather than reading it as a free port' (
    $swapText -notmatch 'Get-NetUDPEndpoint -LocalPort' -and
    $swapText.Contains('catch { $script:heldWhy = $_.Exception.Message; return $true }') -and
    ([regex]::Matches($swapText, [regex]::Escape('if ($blindWhy) { $blindWhy }'))).Count -eq 2)

$callers = @(
    'scripts\deploy\Deploy-Server.ps1',
    'scripts\deploy\Deploy-DevGamemode.ps1',
    'scripts\deploy\Install-ThornswoodServer.ps1',
    'scripts\release\Publish-Server.ps1'
)
foreach ($rel in $callers) {
    $t = [IO.File]::ReadAllText((Join-Path $Repo $rel))
    Yes ("{0} takes the shared ceiling when -Wait is omitted" -f $rel) (
        $t.Contains("if (-not `$PSBoundParameters.ContainsKey('Wait'))") -and
        $t.Contains('$Wait = Get-ThornswoodServerReadyWait') -and
        $t -notmatch '\[int\]\$Wait\s*=\s*60')
}

$inst = [IO.File]::ReadAllText((Join-Path $Deploy 'Install-ThornswoodServer.ps1'))
Yes 'the installer Answers with $Wait as well, not a literal 60' (
    $inst.Contains('(Get-Date).AddSeconds($Wait)') -and
    $inst -notmatch 'AddSeconds\(\s*60\s*\)' -and
    $inst.Contains("Join-Path `$here 'ServerReadyWait.ps1'"))

$pub = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Publish-Server.ps1'))
Yes 'Publish-Server sends ServerReadyWait.ps1 beside the installer, and refuses to send an uncommitted copy' (
    $pub.Contains("scp @ssh `$waitLib `"`${target}:C:/ServerReadyWait.ps1`"") -and
    $pub.Contains("'scripts/deploy/ServerReadyWait.ps1'") -and
    ([regex]::Matches($pub, 'C:/ServerReadyWait\.ps1')).Count -eq 2)

# ---- run, against a scratch folder ------------------------------------------
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the runs need Get-NetUDPEndpoint, which only Windows has, and this is not Windows'
    Done
}
$boxPs = Get-BoxPowerShell
$node = Get-Command node -EA SilentlyContinue
if (-not $node -or -not (Get-Command Get-NetUDPEndpoint -EA SilentlyContinue)) {
    Write-Host 'SKIP  the runs need node and Get-NetUDPEndpoint as well, and this machine lacks one'
    Done
}

. $SwapLib
Yes 'Swap.ps1 gives SwapVars and the swap block' (
    [bool]$swapBlock -and [bool](Get-Command SwapVars -EA SilentlyContinue))

$rand = New-Object Random
# The ports, listed whole and filtered as Swap.ps1 does: -LocalPort with
# nothing on it is an error, and a list that cannot be had stops the run
# instead of reading as a free port (#2466).
function UdpOn([int]$p) { return @(Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $p }) }
function TcpOn([int]$p) { return @(Get-NetTCPConnection -EA Stop | Where-Object { $_.LocalPort -eq $p }) }
function Free([int]$p) {
    (-not @(UdpOn $p).Count) -and (-not @(TcpOn $p).Count)
}
function PickPort {
    do { $script:P = $rand.Next(41000, 48000) } until ((Free $script:P) -and (Free ($script:P + 1)))
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-1938-' + [Guid]::NewGuid().ToString('N'))
$root = Join-Path $work 'Thornswood-Server'
$pidLog = Join-Path $work 'pids.txt'
$stub = Join-Path $work 'stub.js'
$utf8 = New-Object Text.UTF8Encoding($false)

function Put([string]$path, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Sha([string]$text) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (($h.ComputeHash($utf8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $h.Dispose() }
}
function SettingsJson([int]$port) {
    return (@{ port = $port; name = 'Thornswood Test'; loadOrder = @('Skyrim.esm') } | ConvertTo-Json -Compress)
}
function Owner([int]$port) {
    $e = @(UdpOn $port)
    if ($e.Count) { return [int]$e[0].OwningProcess }
    return 0
}
# Which process holds the game port, as pid and start time. Windows hands a
# freed pid out again quickly, so on a busy box the new stand-in can get the
# old one's pid; the pid alone cannot tell them apart (#2466).
function Ident([int]$port) {
    $id = Owner $port
    if (-not $id) { return '' }
    $p = Get-Process -Id $id -EA SilentlyContinue
    if (-not $p) { return '' }
    return ('{0}@{1:o}' -f $id, $p.StartTime)
}
function Answers([int]$port) {
    if (-not (Owner $port)) { return $false }
    $ok = $false
    try {
        $c = New-Object Net.Sockets.TcpClient
        $null = $c.BeginConnect('127.0.0.1', $port + 1, $null, $null).AsyncWaitHandle.WaitOne(500)
        $ok = $c.Connected
        $c.Close()
    } catch { }
    return $ok
}
function WaitUp([int]$port) {
    for ($i = 0; $i -lt 40; $i++) { if (Answers $port) { return $true }; Start-Sleep -Milliseconds 250 }
    return $false
}
function MakeStage([string]$name, [string]$gamemode) {
    $dir = Join-Path $root $name
    $files = [ordered]@{
        'gamemode.js'          = $gamemode
        'server-settings.json' = (SettingsJson $script:P)
    }
    $want = [ordered]@{}
    foreach ($k in $files.Keys) {
        $path = Join-Path $dir ($k -replace '/', '\')
        Put $path $files[$k]
        $want[$k] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    return $want
}
# Each time the swap asks the task to stop or start, the stand-in task writes
# the moment down in stamps.txt, so a case times the swap from the moment it
# took the server down (or started the new one) and not from when Windows
# PowerShell was asked to start. Before the first stop the swap loads
# StopAndMove.ps1's C# (Add-Type runs the compiler) and lists the ports, with
# the old server still up. On 31 Oct 2026 a GitHub runner four of whose cores
# were 81% busy took 69 s over that (PR #5143, the old server's stand-in was
# ended 69 s after the run began), and the case timed from the start called
# a 6 s swap 75 s.
$stampLog = Join-Path $work 'stamps.txt'
function Stamps {
    if (-not (Test-Path -LiteralPath $stampLog)) { return @() }
    return @(Get-Content -LiteralPath $stampLog | Where-Object { $_ -match '^(stop|start) \d+$' } | ForEach-Object {
        $f = $_ -split ' '
        [pscustomobject]@{ Kind = $f[0]; At = [DateTime]::new([long]$f[1], [DateTimeKind]::Utc) }
    })
}
function RunFar([string]$stageName, [string]$prevName, [int]$wait, $want) {
    $mock = @"
function Get-ScheduledTask { [CmdletBinding()] param([string]`$TaskName) }
function Set-ScheduledTask { [CmdletBinding()] param([Parameter(ValueFromPipeline = `$true)]`$InputObject) }
function Stop-ScheduledTask { [CmdletBinding()] param([string]`$TaskName)
  [IO.File]::AppendAllText('$stampLog', 'stop ' + [DateTime]::UtcNow.Ticks + "``r``n")
}
function Start-ScheduledTask { [CmdletBinding()] param([string]`$TaskName)
  [IO.File]::AppendAllText('$stampLog', 'start ' + [DateTime]::UtcNow.Ticks + "``r``n")
  Start-Process -FilePath '$($node.Source)' -WindowStyle Hidden -ArgumentList '"$stub" watch "$root" "$pidLog"'
}

"@
    Remove-Item -LiteralPath $stampLog -Force -EA SilentlyContinue
    $body = (SwapVars $root 'Thornswood Test 1938' $stageName $prevName $wait $want) + $mock + $swapBlock
    $f = Join-Path $work ('far-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, $body, (New-Object Text.UTF8Encoding($true)))
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_".Trim() }) }
    finally { $ErrorActionPreference = $eap }
    $script:lastFar = $out
    return $out
}
function Show {
    foreach ($l in $script:lastFar) { Write-Host ('        ' + $l) }
}

$stubJs = @'
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const dgram = require('dgram');
const net = require('net');
const mode = process.argv[2];
const root = process.argv[3];
const pidLog = process.argv[4];
fs.appendFileSync(pidLog, process.pid + '\n');
// Every line carries its time and the pid that wrote it, so a stand-in that
// went can be told from one that never answered, and when (#2466).
function log(m) { fs.appendFileSync(path.join(root, 'server.log'), new Date().toISOString() + ' pid ' + process.pid + ' ' + m + '\n'); }
if (mode === 'watch') {
  // The stand-in runs as this process's child, so how it ended is written
  // down even when it could not write that itself: its exit code, and the
  // last of what it said on stderr. Stop-Process ends a process with -1
  // (0xffffffff); a crash ends it with an NTSTATUS code such as 0xc0000005.
  const err = path.join(path.dirname(pidLog), 'stand-in-' + process.pid + '.err');
  const c = cp.spawn(process.execPath, [__filename, 'serve', root, pidLog],
                     { stdio: ['ignore', 'ignore', fs.openSync(err, 'w')], windowsHide: true });
  c.on('error', function (e) { log('the stand-in did not start: ' + e.message); });
  c.on('exit', function (code, signal) {
    if (!fs.existsSync(root)) { return; }
    const said = fs.readFileSync(err, 'utf8').split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
    log('stand-in pid ' + c.pid + ' ended: ' +
        (code === null ? 'signal ' + signal : 'exit code ' + code + ' (0x' + (code >>> 0).toString(16) + ')') +
        (said ? ', it said: ' + said : ''));
  });
} else {
  let why = '';
  process.on('exit', function (code) { if (fs.existsSync(root)) { log('exit ' + code + (why ? ', ' + why : '')); } });
  const gm = fs.readFileSync(path.join(root, 'gamemode.js'), 'utf8');
  const s = JSON.parse(fs.readFileSync(path.join(root, 'server-settings.json'), 'utf8'));
  const res = s.port === 7777 ? 3000 : s.port + 1;
  const udp = dgram.createSocket('udp4');
  udp.on('listening', function () { log('UDP ' + s.port + ' bound'); });
  udp.on('error', function (e) { why = 'UDP ' + s.port + ' taken: ' + e.code; process.exit(1); });
  udp.bind(s.port, '127.0.0.1');
  function listen() {
    // Swap.ps1's probe connects and closes its socket at once, which Windows
    // may send as a reset. A socket with no error listener throws that, and
    // the stand-in died of it the moment its slow port opened (20 Oct
    // nightly: ECONNRESET, read). A real server takes a reset as one client
    // gone, so this one does too, and says so.
    const srv = net.createServer(function (c) {
      c.on('error', function (e) { log('a connection on ' + res + ' ended: ' + e.code); });
      c.end();
    });
    srv.on('listening', function () { log('resources port ' + res + ' open'); });
    srv.on('error', function (e) { why = 'resources port ' + res + ' taken: ' + e.code; process.exit(1); });
    srv.listen(res, '127.0.0.1');
  }
  if (gm.indexOf('udp-only') >= 0) {
    log('listening on ' + s.port + ' only');
  } else if (gm.indexOf('slow-start-past-60') >= 0) {
    setTimeout(listen, 61000);
    log('listening on ' + s.port + ', resources after 61 s');
  } else {
    listen();
    log('listening on ' + s.port + ' and ' + res);
  }
  setInterval(function () { if (!fs.existsSync(root)) { process.exit(0); } }, 1000);
  setTimeout(function () { why = 'its 600 s were up'; process.exit(0); }, 600000);
}
'@

# What the stand-ins wrote to server.log from $from bytes on: when each one
# started, bound and opened its ports, and how each one ended.
function LogSince([long]$from) {
    $logPath = Join-Path $root 'server.log'
    if (-not (Test-Path -LiteralPath $logPath)) { return @() }
    $all = [IO.File]::ReadAllText($logPath)
    if ($all.Length -le $from) { return @() }
    return @($all.Substring([int]$from) -split "`r?`n" | Where-Object { $_ })
}
function LogLength {
    $logPath = Join-Path $root 'server.log'
    if (Test-Path -LiteralPath $logPath) { return (Get-Item -LiteralPath $logPath).Length }
    return 0
}

try {
    Put $stub $stubJs
    Put (Join-Path $root 'gamemode.js') '// old gamemode'
    Put (Join-Path $root 'plugins\Skyrim.esm') 'skyrim'
    # One start, on ports free when they were picked. Until 19 Oct this was up
    # to five starts on fresh ports, and the slow case below was set up again
    # on a fresh port up to three times (#2534): retries for a port another
    # process might take. Over 524 runs on the VPS runners from 12 to 19 Oct
    # neither ever ran (the stand-in always answered within 3.5 s, and no
    # "taken" line was ever written), and the two slow-case failures in that
    # time had nothing to do with a port being taken. A port that is taken
    # now fails the run, and the stand-in's own line says which and how.
    PickPort
    Put (Join-Path $root 'server-settings.json') (SettingsJson $script:P)
    $null = Start-Process -FilePath $node.Source -WindowStyle Hidden `
                          -ArgumentList ('"' + $stub + '" watch "' + $root + '" "' + $pidLog + '"')
    $up = WaitUp $P
    Yes ("the stand-in server is answering on UDP {0} and TCP {1}" -f $P, ($P + 1)) $up
    if (-not $up) { throw ('no stand-in server came up, so there is nothing to deploy over. It wrote: ' + ((LogSince 0) -join ' / ')) }
    $before = (Get-FileHash -LiteralPath (Join-Path $root 'gamemode.js') -Algorithm SHA256).Hash

    # A start that never becomes ready still rolls back within the ceiling.
    $w = MakeStage '.stage-never' '// new gamemode, udp-only'
    $began = [DateTime]::UtcNow
    $out = RunFar '.stage-never' '.prev-never' 4 $w
    $ended = [DateTime]::UtcNow
    $down = @(Stamps | Where-Object { $_.Kind -eq 'stop' } | Select-Object -First 1)
    $said = $out -join "`n"
    $failed = $script:fail
    Yes 'a start that never opens the resources port is SWAP ROLLED BACK' ($out -contains 'SWAP ROLLED BACK')
    Yes '  and it says FAIL, naming both ports and the 4 s ceiling' (
        $said -match ('FAIL: nothing answered on UDP ' + $P + ' and ' + ($P + 1) + ' within 4 seconds'))
    $swapS = -1
    if ($down.Count) { $swapS = ($ended - $down[0].At).TotalSeconds }
    Yes '  and the swap asked the task to stop' ($down.Count -eq 1)
    Yes ("  and from taking the server down it finished in {0:n1} s, within the 4 s ceiling plus the put-back, not the old 60 s ({1:n1} s before that, with the old server up)" -f $swapS, $(if ($down.Count) { ($down[0].At - $began).TotalSeconds } else { -1 })) (
        $swapS -lt 50 -and $swapS -ge 3)
    Yes '  and the old gamemode is back' (
        (Get-FileHash -LiteralPath (Join-Path $root 'gamemode.js') -Algorithm SHA256).Hash -eq $before)
    Yes '  and the old server is answering again' (WaitUp $P)
    if ($script:fail -gt $failed) { Show }

    # A slow-but-healthy start past 60 s is kept.
    # On the VPS runners this took 63.7 to 68.5 s in 522 of 524 runs from 12
    # to 19 Oct, and all 170 s in the other two (12 Oct, 19 Oct), one of them
    # with no other job on the box: the stand-in was gone or the swap could
    # not see it, not slow. Which of those it was is what the lines printed on
    # a failure say: the stand-ins' own log with times, how each one ended,
    # and the swap's own word on a UDP list it could not have (#2466).
    $logFrom = LogLength
    $running = Ident $P
    $w = MakeStage '.stage-slow' '// new gamemode, slow-start-past-60'
    $out = RunFar '.stage-slow' '.prev-slow' (Get-ThornswoodServerReadyWait) $w
    $ended = [DateTime]::UtcNow
    $up = @(Stamps | Where-Object { $_.Kind -eq 'start' } | Select-Object -First 1)
    $waitS = -1
    if ($up.Count) { $waitS = ($ended - $up[0].At).TotalSeconds }
    $said = $out -join "`n"
    $failed = $script:fail
    Yes 'a start that answers after 61 s, past the old 60 s wait, is SWAP OK' ($out -contains 'SWAP OK')
    Yes '  and says PASS from the resources port' (
        $said -match ('PASS: the server is answering on ' + ($P + 1) + ', game port ' + $P))
    Yes ("  and from starting the new server that wait took {0:n1} s, past 60 s and inside the shared ceiling" -f $waitS) (
        $waitS -ge 60 -and $waitS -lt (Get-ThornswoodServerReadyWait))
    Yes '  and the new gamemode is the one answering' (
        ([IO.File]::ReadAllText((Join-Path $root 'gamemode.js'))) -match 'slow-start-past-60' -and
        (Answers $P) -and ((Ident $P) -ne $running))
    if ($script:fail -gt $failed) {
        Show
        Write-Host '        --- what the stand-ins wrote while this case ran ---'
        foreach ($l in (LogSince $logFrom)) { Write-Host ('        ' + $l) }
    }
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message) $false
}
finally {
    if (Test-Path -LiteralPath $pidLog) {
        foreach ($id in @(Get-Content -LiteralPath $pidLog)) {
            $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$id) -EA SilentlyContinue
            if ($proc -and $proc.CommandLine -and $proc.CommandLine.Contains($work)) {
                Stop-Process -Id ([int]$id) -Force -EA SilentlyContinue
            }
        }
    }
    Start-Sleep -Milliseconds 300
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Done
