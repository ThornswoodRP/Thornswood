<#
  test-watch-load.ps1

  The load record the VPS keeps, and the note read out of it.

  WHY THIS EXISTS. Four services share one five core box and nothing kept a
  number for any of them, so the choice between a bigger box and splitting
  them up could only be a guess (To Do List: "nothing today would tell you
  which one is the problem"). vps-load.ps1 now appends a line every five
  minutes on the box and Read-Load.ps1 says which service leads CPU, memory
  and I/O. Neither can be tried on the box from here, so this proves them here:

    - the collector is RUN, under Windows PowerShell 5.1 as the box runs it,
      against a scratch folder, with a port held open by this process standing
      in for the game server. The line it writes has to find this process by
      that port and carry its pid, processor time and memory.
    - the reader is given a made-up record with every awkward thing in it: a
      restart whose new process has a higher total than the old one, an hour
      with no lines, and a reboot. Every figure it gives back is checked
      against the number the record was built from.
    - Check-Load.ps1 reads the online count the gamemode actually writes.

  Nothing here connects to the VPS. Everything it writes is in a temp folder
  that is removed at the end.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$inv = [Globalization.CultureInfo]::InvariantCulture

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Near($a, $b, [double]$tol) {
    if ($null -eq $a -or $null -eq $b) { return $false }
    return ([math]::Abs([double]$a - [double]$b) -le $tol)
}
function Finish {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$collector = Join-Path $Here 'scripts\vps\vps-load.ps1'
$reader    = Join-Path $Here 'scripts\vps\Read-Load.ps1'
$watcher   = Join-Path $Here 'scripts\vps\Watch-Load.ps1'
$checkLoad = Join-Path $Here 'scripts\vps\Check-Load.ps1'
$gamemode  = Join-Path $Here 'game\gamemode.js'

foreach ($f in @($collector, $reader, $watcher)) {
    Yes ((Split-Path -Leaf $f) + ' is there') (Test-Path -LiteralPath $f)
}
if ($script:fail) { Finish }

foreach ($f in @($collector, $reader, $watcher, $checkLoad)) {
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errs)
    Yes ((Split-Path -Leaf $f) + ' parses') (-not $errs -or $errs.Count -eq 0)
}

# The columns, in order. Written out here rather than read from the collector,
# so a change to the shape of the record is a change somebody made on purpose.
$services = @('caddy', 'website', 'game', 'voice', 'bot', 'devgame', 'devvoice')
$cols = @('time', 'cores', 'idle_s', 'mem_used_mb', 'mem_total_mb', 'disk_free_gb',
          'net_in_bytes', 'net_out_bytes', 'online', 'devonline')
foreach ($s in $services) { foreach ($k in @('pid', 'cpu_s', 'mem_mb', 'io_bytes')) { $cols += ($s + '_' + $k) } }
$header = $cols -join ','

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-test-watch-load-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $scratch -Force

try {

# ============================================================ the collector ===
Write-Host ''
Write-Host '--- the collector, run for real' -ForegroundColor Cyan

$bytes = [IO.File]::ReadAllBytes($collector)
Yes 'vps-load.ps1 is plain ASCII, so Windows PowerShell 5.1 reads it the same with no byte order mark' (
    @($bytes | Where-Object { $_ -gt 127 }).Count -eq 0)

$ctext = [IO.File]::ReadAllText($collector)
# Measured on 24 September: these three loaded modules that cost 2 to 3
# seconds each on every run of a task that starts a fresh process each time,
# and Get-NetAdapterStatistics missed the card carrying the default route.
foreach ($slow in @('Get-NetTCPConnection', 'Get-NetAdapterStatistics', 'Get-NetRoute')) {
    Yes "the collector does not call $slow" ($ctext -notmatch ('(?m)^[^#]*\b' + $slow + '\b'))
}

# #3189: the bot is the python its service started. Any python with
# Thornswood-Bot in its command line used to count, so a harness's stand-in
# bot on a runner read as a second bot and as a restart (48 in ten days, with
# none). Watch-Services.ps1 finds it the same way.
Yes 'the collector finds the bot as the python the ThornswoodBot service started' (
    $ctext -match "Service = 'ThornswoodBot'" -and $ctext -match 'ParentProcessId=')
Yes 'the collector does not take any python with Thornswood-Bot in its command line as the bot' (
    $ctext -notmatch "Match = 'Thornswood-Bot'")
$stext = Get-Content -LiteralPath (Join-Path $Here 'scripts\vps\Watch-Services.ps1') -Raw
Yes 'Watch-Services.ps1 takes the bot as the python under its service, in the watchdog and in -Check' (
    ([regex]::Matches($stext, 'ParentProcessId = ')).Count -ge 2 -and
    $stext -notmatch "(?m)^[^#]*-(not)?match 'Thornswood-Bot'")

. (Join-Path $PSScriptRoot 'Windows.ps1')
# The far side runs in PowerShell 7, as on the box since #5356.
$ps = Get-BoxPowerShell
Write-Host ("      running it under {0}" -f $ps) -ForegroundColor DarkGray

$watch   = Join-Path $scratch 'watch'
$liveDir = Join-Path $scratch 'live'
$devDir  = Join-Path $scratch 'dev'
$null = New-Item -ItemType Directory -Path (Join-Path $liveDir 'data') -Force
$null = New-Item -ItemType Directory -Path (Join-Path $devDir 'data') -Force
# What the gamemode writes (gamemode.js, the online count writer).
Set-Content -LiteralPath (Join-Path $liveDir 'data\online.json') -Value '{"now":3,"at":0,"restarting":false}' -Encoding ASCII
# The dev server's file says one, but nothing is listening for the dev
# server, so the line must not believe it.
Set-Content -LiteralPath (Join-Path $devDir 'data\online.json') -Value '{"now":1,"at":0,"restarting":false}' -Encoding ASCII

# A port this process holds, standing in for the game server's 3000, and one
# nobody holds, standing in for a dev server that is down.
$held = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$held.Start()
$gamePort = $held.LocalEndpoint.Port
$gone = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$gone.Start()
$devPort = $gone.LocalEndpoint.Port
$gone.Stop()

function Collect([string[]]$more) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $collector, '-Root', $watch,
           '-Ports', ('game=' + $gamePort + ',devgame=' + $devPort),
           '-GameRoot', $liveDir, '-DevGameRoot', $devDir) + $more
    $null = & $ps @a 2>&1
    return $LASTEXITCODE
}

function Burn([int]$ms) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $x = 0
    while ($sw.ElapsedMilliseconds -lt $ms) { $x++ }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
$rc1 = Collect @()
$took = $sw.Elapsed.TotalSeconds
Burn 1500
$rc2 = Collect @()
Write-Host ("      one run took {0:N1} s here, starting PowerShell included" -f $took) -ForegroundColor DarkGray

Yes 'the collector exits 0' ($rc1 -eq 0 -and $rc2 -eq 0)
$csv = Join-Path $watch 'load.csv'
Yes 'it wrote load.csv' (Test-Path -LiteralPath $csv)
if (-not (Test-Path -LiteralPath $csv)) { Finish }

$lines = @(Get-Content -LiteralPath $csv)
Yes 'two runs make a header and two lines, not a header each time' ($lines.Count -eq 3)
Yes 'the header is the one Read-Load.ps1 expects' ($lines[0] -eq $header)
$fieldsOk = $true
foreach ($l in $lines) { if (@($l -split ',').Count -ne $cols.Count) { $fieldsOk = $false } }
Yes ('every line has all ' + $cols.Count + ' fields') $fieldsOk

$fileBytes = [IO.File]::ReadAllBytes($csv)
Yes 'the record is plain ASCII' (@($fileBytes | Where-Object { $_ -gt 127 }).Count -eq 0)

$r = @(Import-Csv -LiteralPath $csv)
$t1 = [DateTimeOffset]::MinValue
$t2 = [DateTimeOffset]::MinValue
$p1 = [DateTimeOffset]::TryParse($r[0].time, $inv, [Globalization.DateTimeStyles]::None, [ref]$t1)
$p2 = [DateTimeOffset]::TryParse($r[1].time, $inv, [Globalization.DateTimeStyles]::None, [ref]$t2)
Yes 'the time carries its offset from UTC and reads back' ($p1 -and $p2 -and $r[0].time -match '[+-]\d\d:\d\d$')
Yes 'the second line is later than the first' ($t2 -gt $t1)

# Every figure is a plain number with a full stop, whatever language the box
# is in, and every pid field is pids and spaces.
$shapeOk = $true
$bad = @()
foreach ($row in $r) {
    foreach ($c in $cols) {
        if ($c -eq 'time') { continue }
        $val = "$($row.$c)"
        if ($val -eq '') { continue }
        $want = if ($c -like '*_pid') { '^\d+( \d+)*$' } else { '^\d+(\.\d+)?$' }
        if ($val -notmatch $want) { $shapeOk = $false; $bad += ($c + '=' + $val) }
    }
}
Yes ('every figure is a plain invariant number' + $(if ($bad.Count) { ': ' + ($bad -join ' ') } else { '' })) $shapeOk

Yes 'cores is this machine''s logical processor count' ([int]$r[1].cores -eq [Environment]::ProcessorCount)
# The idle time, memory, C:, every process and who listens on a port are read
# from Windows' own counters (CIM and netstat.exe), as on the box. Off Windows
# there are none, and those columns are empty.
$counters = 'the idle time, memory, C:, the processes and who listens where come from Windows'' own counters (CIM and netstat.exe), which only Windows has'
if ($OnWindows) {
    $i1 = [double]::Parse($r[0].idle_s, $inv)
    $i2 = [double]::Parse($r[1].idle_s, $inv)
    Yes 'the idle total is there and does not go backwards' ($i1 -gt 0 -and $i2 -ge $i1)
    Yes 'memory in use is there and under the total' ([double]$r[1].mem_used_mb -gt 0 -and [double]$r[1].mem_used_mb -le [double]$r[1].mem_total_mb)
    Yes 'free space on C: is there' ("$($r[1].disk_free_gb)" -ne '' -and [double]$r[1].disk_free_gb -gt 0)
} else {
    Write-Host "SKIP  the idle total, memory and free space on C:: $counters"
}

# The card with a gateway, asked the same way, so this holds on a runner too.
$hasCard = $false
foreach ($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
    $gw = @($nic.GetIPProperties().GatewayAddresses | Where-Object {
        -not $_.Address.Equals([Net.IPAddress]::Any) -and -not $_.Address.Equals([Net.IPAddress]::IPv6Any) })
    if ($gw.Count) { $hasCard = $true }
}
if ($hasCard) {
    Yes 'network bytes in and out are there for the card with the gateway' (
        "$($r[1].net_in_bytes)" -ne '' -and "$($r[1].net_out_bytes)" -ne '')
} else {
    Write-Host 'SKIP  this machine has no card with a gateway, so there are no network bytes to read'
}

# The game server stand-in, found by its port.
if ($OnWindows) {
    Yes 'the game server is found by the port it listens on, and it is this process' ("$($r[0].game_pid)" -eq "$PID" -and "$($r[1].game_pid)" -eq "$PID")
    Yes 'its memory is there' ([double]$r[1].game_mem_mb -gt 0)
    $g1 = [double]::Parse($r[0].game_cpu_s, $inv)
    $g2 = [double]::Parse($r[1].game_cpu_s, $inv)
    Yes ('its processor time grew by the second and a half this spent busy ({0:N2} s)' -f ($g2 - $g1)) (($g2 - $g1) -ge 1.0)
    Yes 'its I/O total is there' ("$($r[1].game_io_bytes)" -ne '')
    Yes 'the people on the live server come from its online.json while it is up' ("$($r[1].online)" -eq '3')
} else {
    Write-Host "SKIP  the game server found by its port, its processor time, memory and I/O, and the people on it: $counters"
}
Yes 'a down dev server is empty, and so is its people count though its file says one' (
    "$($r[1].devgame_pid)" -eq '' -and "$($r[1].devonline)" -eq '')

# The game server goes away.
$held.Stop()
$rc3 = Collect @()
$r = @(Import-Csv -LiteralPath $csv)
Yes 'with the game server gone its columns are empty and so is its people count' (
    $rc3 -eq 0 -and $r.Count -eq 3 -and "$($r[2].game_pid)" -eq '' -and "$($r[2].online)" -eq '')

# A broken online.json costs its own column and nothing else.
$held = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $gamePort)
$held.Start()
Set-Content -LiteralPath (Join-Path $liveDir 'data\online.json') -Value 'this is not json' -Encoding ASCII
$rc4 = Collect @()
$r = @(Import-Csv -LiteralPath $csv)
if ($OnWindows) {
    Yes 'a broken online.json leaves that column empty and the line still goes in' (
        $rc4 -eq 0 -and $r.Count -eq 4 -and "$($r[3].online)" -eq '' -and "$($r[3].game_pid)" -eq "$PID")
} else {
    Yes 'a broken online.json does not stop the line going in' ($rc4 -eq 0 -and $r.Count -eq 4)
    Write-Host "SKIP  and leaves only that column empty while the game server is found: $counters"
}
$held.Stop()

# Rolling at the size limit.
$rc5 = Collect @('-RollAt', '1')
$old = Join-Path $watch 'load.1.csv'
$oldLines = @(if (Test-Path -LiteralPath $old) { Get-Content -LiteralPath $old } else { @() })
$newLines = @(Get-Content -LiteralPath $csv)
Yes 'past the size limit the record rolls to load.1.csv and starts again' (
    $rc5 -eq 0 -and $oldLines.Count -eq 5 -and $newLines.Count -eq 2 -and $newLines[0] -eq $header)

# A record in an older shape is moved aside rather than written into.
Set-Content -LiteralPath $csv -Value @('time,cores', '2026-09-01T00:00:00+00:00,5') -Encoding ASCII
$rc6 = Collect @()
$oldLines = @(Get-Content -LiteralPath $old)
$newLines = @(Get-Content -LiteralPath $csv)
Yes 'a record with a different header is moved aside, so one file never has two shapes' (
    $rc6 -eq 0 -and $oldLines[0] -eq 'time,cores' -and $newLines[0] -eq $header -and $newLines.Count -eq 2)

# ================================================ the reader, real record ===
Write-Host ''
Write-Host '--- the reader, on the two lines the collector just wrote' -ForegroundColor Cyan
$pair = Join-Path $scratch 'pair.csv'
Set-Content -LiteralPath $pair -Value $lines -Encoding ASCII
$real = & $reader -Path $pair -PassThru
$g = @($real.Services | Where-Object { $_.Name -eq 'game' })
Yes 'it measures one interval from two real lines' ($real.Intervals -eq 1)
if ($OnWindows) {
    Yes 'it finds the game server stand-in busy in it' ($g.Count -eq 1 -and $g[0].CoresAvg -gt 0)
    Yes 'the box figure is a percentage' ($null -ne $real.CpuAvg -and $real.CpuAvg -ge 0 -and $real.CpuAvg -le 100)
} else {
    Write-Host "SKIP  the game server stand-in busy in them, and the box figure: $counters"
}

# =============================================== the reader, a made-up one ===
Write-Host ''
Write-Host '--- the reader, on a made-up record with a restart, a gap and a reboot' -ForegroundColor Cyan
<#
  Five cores, a line every five minutes from 18:00, two hours of it, then an
  hour with no lines, then a reboot, then one more interval.

    game     half a core, then a whole core from 19:00 to 20:00, restarted at
             line 6 with a HIGHER total than the process it replaced, so a
             reader that measured across the restart would see 2.5 cores
    voice    0.1 of a core, and the most I/O
    website  0.05, bot 0.02, caddy 0.01, and 0.1 of a core of everything else
    network  0.2 MB/s in; out 1 MB/s, and 3 MB/s from 19:00 to 20:00
    people   2, then 6 from line 13, then 1
#>
$t0 = New-Object DateTimeOffset(2026, 9, 20, 18, 0, 0, [TimeSpan]::FromHours(-6))
$rate  = @{ caddy = 0.01; website = 0.05; voice = 0.1; bot = 0.02 }
$ioR   = @{ caddy = 1000; website = 50000; game = 100000; voice = 500000; bot = 1000 }
$memOf = @{ caddy = 40; website = 150; voice = 80; bot = 60 }
$pids  = @{ caddy = 10; website = 11; game = 100; voice = 12; bot = 13 }
$cpu   = @{ caddy = 0.0; website = 0.0; game = 0.0; voice = 0.0; bot = 0.0 }
$io    = @{ caddy = 0.0; website = 0.0; game = 0.0; voice = 0.0; bot = 0.0 }
$idle = 1000000.0
$netIn = 1e9
$netOut = 5e9
$disk = 50.0
$t = $t0
$made = @($header)
for ($n = 0; $n -le 27; $n++) {
    $busy = ($n -ge 13 -and $n -le 24)
    if ($n -gt 0) {
        $dt = 300
        if ($n -eq 25) { $dt = 3600 }
        $t = $t.AddSeconds($dt)
        if ($n -eq 26) {
            # The reboot: every process is new and every counter starts again.
            $pids = @{ caddy = 20; website = 21; game = 200; voice = 22; bot = 23 }
            foreach ($k in @($cpu.Keys)) { $cpu[$k] = 5.0; $io[$k] = 1000.0 }
            $idle = 100.0
            $netIn = 1000.0
            $netOut = 2000.0
        } else {
            $gameRate = if ($busy) { 1.0 } else { 0.5 }
            $outRate = if ($busy) { 3e6 } else { 1e6 }
            foreach ($k in @($rate.Keys)) { $cpu[$k] += $rate[$k] * $dt }
            $cpu['game'] += $gameRate * $dt
            foreach ($k in @($ioR.Keys)) { $io[$k] += $ioR[$k] * $dt }
            $idle += (5 - ($gameRate + 0.18 + 0.1)) * $dt
            $netIn += 2e5 * $dt
            $netOut += $outRate * $dt
            if ($n -eq 6) { $pids['game'] = 101; $cpu['game'] = 1500.0; $io['game'] = 1000.0 }
        }
        $disk -= 0.01
    }
    $v = @{}
    foreach ($c in $cols) { $v[$c] = '' }
    $v['time'] = $t.ToString("yyyy-MM-dd'T'HH:mm:sszzz", $inv)
    $v['cores'] = '5'
    $v['idle_s'] = $idle.ToString('0.00', $inv)
    $v['mem_used_mb'] = '3000'
    $v['mem_total_mb'] = '8192'
    $v['disk_free_gb'] = $disk.ToString('0.00', $inv)
    $v['net_in_bytes'] = $netIn.ToString('0', $inv)
    $v['net_out_bytes'] = $netOut.ToString('0', $inv)
    $v['online'] = $(if ($n -le 12) { '2' } elseif ($n -le 24) { '6' } else { '1' })
    foreach ($k in @('caddy', 'website', 'game', 'voice', 'bot')) {
        $v[$k + '_pid'] = "$($pids[$k])"
        $v[$k + '_cpu_s'] = $cpu[$k].ToString('0.00', $inv)
        $v[$k + '_io_bytes'] = $io[$k].ToString('0', $inv)
        $m = if ($k -eq 'game') { $(if ($busy) { 2400 } else { 2000 }) } else { $memOf[$k] }
        $v[$k + '_mem_mb'] = "$m"
    }
    $made += ((@($cols | ForEach-Object { $v[$_] })) -join ',')
}
$fake = Join-Path $scratch 'made-up.csv'
Set-Content -LiteralPath $fake -Value $made -Encoding ASCII

$res = & $reader -Path $fake -PassThru
$game  = @($res.Services | Where-Object { $_.Name -eq 'game' })[0]
$voice = @($res.Services | Where-Object { $_.Name -eq 'voice' })[0]
$dev   = @($res.Services | Where-Object { $_.Name -eq 'devgame' })[0]

Yes 'it reads all 28 lines' ($res.Lines -eq 28)
Yes 'the hour with no lines is a gap and is left out' ($res.Gaps -eq 1)
Yes 'the idle total going backwards is a reboot and is left out' ($res.Reboots -eq 1)
Yes ('25 intervals are measured (got {0})' -f $res.Intervals) ($res.Intervals -eq 25)
Yes ('the box averaged 20.4% (got {0:N2})' -f $res.CpuAvg) (Near $res.CpuAvg 20.4 0.01)
Yes ('the box peaked at 25.6% (got {0:N2})' -f $res.CpuPeak) (Near $res.CpuPeak 25.6 0.01)
Yes ('the game server averaged 0.75 of a core (got {0:N3})' -f $game.CoresAvg) (Near $game.CoresAvg 0.75 0.001)
Yes ('its peak is 1.0, so the restart was not measured across (got {0:N2})' -f $game.CoresPeak) (Near $game.CoresPeak 1.0 0.001)
Yes ('it restarted twice, once on its own and once in the reboot (got {0})' -f $game.Restarts) ($game.Restarts -eq 2)
Yes 'the game server leads CPU' ($res.TopCpu -eq 'game')
Yes ('with 80% of the processor time the services used (got {0:N2})' -f $res.TopCpuShare) (Near $res.TopCpuShare 80 0.01)
Yes ('everything else on the box came to 0.12 of a core (got {0:N3})' -f $res.OtherCores) (Near $res.OtherCores 0.12 0.001)
Yes 'the game server leads memory' ($res.TopMem -eq 'game')
Yes ('at 2,171 MB on average (got {0:N2})' -f $game.MemAvg) (Near $game.MemAvg (60800 / 28) 0.01)
Yes 'voice leads I/O' ($res.TopIo -eq 'voice')
Yes ('at 500,000 bytes a second (got {0:N0})' -f $voice.IoAvg) (Near $voice.IoAvg 500000 0.5)
Yes ('the box sent 1.96 MB/s on average (got {0:N0})' -f $res.NetOutAvg) (Near $res.NetOutAvg 1960000 0.5)
Yes ('and 3 MB/s at its peak (got {0:N0})' -f $res.NetOutPeak) (Near $res.NetOutPeak 3000000 0.5)
Yes ('and 14.7 GB in all, the gap and the reboot left out (got {0:N0})' -f $res.NetOutTotal) (Near $res.NetOutTotal 1.47e10 1)
Yes 'received averaged 0.2 MB/s' (Near $res.NetInAvg 200000 0.5)
Yes 'the most people on at once was 6' ($res.PeakOnline -eq 6)
Yes 'first reached at 19:05' ($null -ne $res.PeakOnlineAt -and $res.PeakOnlineAt.UtcTicks -eq $t0.AddMinutes(65).UtcTicks)
$wantHour = $t0.AddMinutes(60).ToLocalTime().ToString('yyyy-MM-dd HH:00', $inv)
Yes ('the busiest hour is the one from 19:00, {0} here (got {1})' -f $wantHour, $res.Busiest.Hour) ($res.Busiest.Hour -eq $wantHour)
Yes 'in it the box averaged 25.6%' (Near $res.Busiest.CpuAvg 25.6 0.01)
Yes 'the game server led it with a whole core' ($res.Busiest.Lead -eq 'game' -and (Near $res.Busiest.LeadCores 1.0 0.001))
Yes 'with 6 people on, sending 3 MB/s' ($res.Busiest.Online -eq 6 -and (Near $res.Busiest.NetOut 3000000 0.5))
Yes 'free disk went from 50.00 to 49.73 GB' ((Near $res.DiskFirst 50 0.001) -and (Near $res.DiskLast 49.73 0.001) -and (Near $res.DiskMin 49.73 0.001))
Yes 'a dev server that was never up is up 0% of the time' ($dev.Up -eq 0)
Yes 'three hours is not a week, and it says so' (-not $res.AWeek)

# The printed note, under Windows PowerShell 5.1 as it is likely to be run.
$printed = (& $ps -NoProfile -ExecutionPolicy Bypass -File $reader -Path $fake -NoPause 2>&1 | Out-String)
$printRc = $LASTEXITCODE
Yes 'the note prints and exits 0' ($printRc -eq 0 -and $printed.Length -gt 0)
Yes 'the note names the game server as leading CPU' ($printed -match 'cpu\s+game, 80%')
Yes 'the note names voice as leading I/O' ($printed -match 'i/o\s+voice,')
Yes 'the note says the game server reached a full core' ($printed -match 'game reached about one full core')
Yes 'the note says three hours is not yet a week' ($printed -match 'asks for a week')
Yes 'the note calls people people, by the house words' ($printed -notmatch '(?i)player')
Yes 'the note carries no em dash' ($printed.IndexOf([char]0x2014) -lt 0)

# ================================================================ the rest ===
Write-Host ''
Write-Host '--- the installer and Check-Load' -ForegroundColor Cyan
$w = [IO.File]::ReadAllText($watcher)
Yes 'Watch-Load installs its own task, not the watchdog''s' ($w -match "\`$Task\s*=\s*'Thornswood Load'" -and $w -notmatch "'Thornswood Watch'")
Yes 'every five minutes, as SYSTEM' ($w -match '/sc minute /mo 5 /ru SYSTEM')
Yes 'it sends vps-load.ps1 and parses it first' ($w -match "vps-load\.ps1" -and $w -match 'ParseFile\(\$collector')
Yes 'it never writes into the watchdog''s own watch.ps1' ($w -notmatch 'watch\.ps1')

# The gamemode writes {"now": n, ...}. Check-Load read .count, which it never
# wrote, and counted the object itself instead, so it said 1 whoever was on.
$gm = [IO.File]::ReadAllText($gamemode)
Yes 'the gamemode writes the online count as now' ($gm -match 'JSON\.stringify\(\{\s*now:\s*n')
$cl = @(Get-Content -LiteralPath $checkLoad | Where-Object { $_ -match "'online    '" })
Yes 'Check-Load reads now' ($cl.Count -eq 1 -and $cl[0] -match '\.now' -and $cl[0] -notmatch '\.count')

}
finally {
    try { if ($held) { $held.Stop() } } catch { }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Finish
