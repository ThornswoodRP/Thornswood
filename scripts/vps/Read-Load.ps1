<#
  Read-Load.ps1

      .\scripts\vps\Read-Load.ps1                   reads logs\load.csv, and logs\load.1.csv if it is there
      .\scripts\vps\Read-Load.ps1 -Path x.csv       reads that one instead

  Says which service is using the box, from the record vps-load.ps1 keeps on
  it. Watch-Load.ps1 brings the record down and runs this on it; it can also
  be run on its own against a copy already here.

  The To Do List asks for "a short note saying which service dominates each
  resource", after a week that includes a busy evening, before anybody decides
  between a bigger box and splitting the services apart. This is that note.
  It does not decide anything. Which way to go is Patrick and Djinn's call in
  #staff-updates; this is so it is made on numbers rather than on a guess.

  HOW IT COUNTS. The record holds running totals, so everything here is the
  difference between two lines next to each other, divided by the seconds
  between them. An interval is left out when:
    - the two lines are more than half an hour apart (the box was down, or
      the task was not running), counted as a gap
    - the idle total went backwards, which is a reboot
    - for one service only, its pid changed, which is a restart
  so nothing is ever guessed across a hole.

  CPU is given in cores. One core of a five core box is 20 percent of it, and
  a service whose peak sits at about one core is limited by how fast one core
  is, which more cores will not change. That is the question the entry turns
  on: a simulation wants clock speed.

  Reads only. Runs here and never connects to anything.
#>
[CmdletBinding()]
param(
  [string[]]$Path,
  # Two lines further apart than this are a gap, not an interval.
  [int]$GapSeconds = 1800,
  # Hand back the numbers instead of printing them. The harness uses this.
  [switch]$PassThru,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) {
  Write-Host ''
  if (-not $NoPause -and -not $PassThru) { [void](Read-Host 'Enter to close') }
  exit $code
}

# A number from the record, or $null for an empty field.
function D($x) {
  if ($null -eq $x) { return $null }
  $s = "$x".Trim()
  if ($s -eq '') { return $null }
  $d = 0.0
  if ([double]::TryParse($s, [Globalization.NumberStyles]::Float, $inv, [ref]$d)) { return $d }
  return $null
}

# An empty list arrives as $null, and @($null) is one element long, so the
# nulls are taken out first or an empty list averages to nought.
function Avg($list) {
  $a = @($list | Where-Object { $null -ne $_ })
  if ($a.Count -eq 0) { return $null }
  return (($a | Measure-Object -Sum).Sum / $a.Count)
}

function Peak($list) {
  $a = @($list | Where-Object { $null -ne $_ })
  if ($a.Count -eq 0) { return $null }
  return ($a | Measure-Object -Maximum).Maximum
}

# ---------------------------------------------------------------- the file ---
if (-not $Path -or $Path.Count -eq 0) {
  $logs = Join-Path (Split-Path -Parent (Split-Path -Parent $Here)) 'logs'
  $Path = @()
  foreach ($n in @('load.1.csv', 'load.csv')) {
    $p = Join-Path $logs $n
    if (Test-Path -LiteralPath $p) { $Path += $p }
  }
  if ($Path.Count -eq 0) {
    if ($PassThru) { throw ('no load.csv in ' + $logs) }
    Say ''
    Say ('  There is no load.csv in ' + $logs + '.') 'Yellow'
    Say '  .\scripts\vps\Watch-Load.ps1 brings it down from the box and reads it.' 'DarkGray'
    Done 1
  }
}

# The services are whatever the headers carry, so one added to the collector
# is read here without a change. Each file has its own header: when the
# collector's header changes it moves the old record to load.1.csv, so a
# service added since is named only in load.csv's header, and every file's
# header is read for the names, in the order they first appear.
$rows = @()
$names = @()
foreach ($p in $Path) {
  $head = @(Get-Content -LiteralPath $p -TotalCount 1)
  if ($head.Count) {
    foreach ($col in @($head[0] -split ',')) {
      if ($col.Trim('"') -match '^(.+)_pid$' -and $names -notcontains $Matches[1]) { $names += $Matches[1] }
    }
  }
  foreach ($r in @(Import-Csv -LiteralPath $p)) {
    $t = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse("$($r.time)", $inv, [Globalization.DateTimeStyles]::None, [ref]$t)) { continue }
    $r | Add-Member -NotePropertyName T -NotePropertyValue $t -Force
    $rows += $r
  }
}
$rows = @($rows | Sort-Object { $_.T.UtcTicks })

if ($rows.Count -lt 2) {
  if ($PassThru) { throw ('only ' + $rows.Count + ' line(s) in the record, and it takes two to measure anything') }
  Say ''
  Say ('  Only ' + $rows.Count + ' line(s) so far. It takes two, five minutes apart, to measure anything.') 'Yellow'
  Done 1
}

# ---------------------------------------------------------- the intervals ---
$gaps = 0
$reboots = 0
$intervals = @()
for ($i = 1; $i -lt $rows.Count; $i++) {
  $a = $rows[$i - 1]
  $b = $rows[$i]
  $dt = ($b.T - $a.T).TotalSeconds
  if ($dt -le 0 -or $dt -gt $GapSeconds) { $gaps++; continue }

  $cores = D $b.cores
  $ia = D $a.idle_s
  $ib = D $b.idle_s
  if ($null -ne $ia -and $null -ne $ib -and $ib -lt $ia) { $reboots++; continue }

  $box = $null
  if ($cores -and $null -ne $ia -and $null -ne $ib) {
    $box = 100.0 * (1.0 - (($ib - $ia) / ($dt * $cores)))
    if ($box -lt 0) { $box = 0.0 }
    if ($box -gt 100) { $box = 100.0 }
  }

  $netIn = $null
  $netOut = $null
  $x1 = D $a.net_in_bytes; $x2 = D $b.net_in_bytes
  if ($null -ne $x1 -and $null -ne $x2 -and $x2 -ge $x1) { $netIn = ($x2 - $x1) / $dt }
  $x1 = D $a.net_out_bytes; $x2 = D $b.net_out_bytes
  if ($null -ne $x1 -and $null -ne $x2 -and $x2 -ge $x1) { $netOut = ($x2 - $x1) / $dt }

  $svcCores = @{}
  $svcIo = @{}
  foreach ($n in $names) {
    $pa = "$($a.($n + '_pid'))".Trim()
    $pb = "$($b.($n + '_pid'))".Trim()
    if ($pb -eq '' -or $pa -ne $pb) { continue }
    $c1 = D $a.($n + '_cpu_s'); $c2 = D $b.($n + '_cpu_s')
    if ($null -ne $c1 -and $null -ne $c2 -and $c2 -ge $c1) { $svcCores[$n] = ($c2 - $c1) / $dt }
    $o1 = D $a.($n + '_io_bytes'); $o2 = D $b.($n + '_io_bytes')
    if ($null -ne $o1 -and $null -ne $o2 -and $o2 -ge $o1) { $svcIo[$n] = ($o2 - $o1) / $dt }
  }

  $intervals += [pscustomobject]@{
    From   = $a.T
    To     = $b.T
    Dt     = $dt
    Cores  = $cores
    Box    = $box
    NetIn  = $netIn
    NetOut = $netOut
    Svc    = $svcCores
    Io     = $svcIo
    Online = D $b.online
  }
}

$coresNow = D $rows[$rows.Count - 1].cores

# --------------------------------------------------------------- the box ---
$boxList = @($intervals | Where-Object { $null -ne $_.Box })
$boxAvg = Avg ($boxList | ForEach-Object { $_.Box })
$boxPeak = $null
$boxPeakAt = $null
foreach ($x in $boxList) {
  if ($null -eq $boxPeak -or $x.Box -gt $boxPeak) { $boxPeak = $x.Box; $boxPeakAt = $x.To }
}

$memUsed = @($rows | ForEach-Object { D $_.mem_used_mb } | Where-Object { $null -ne $_ })
$memTotal = D $rows[$rows.Count - 1].mem_total_mb
$disk = @($rows | ForEach-Object { D $_.disk_free_gb } | Where-Object { $null -ne $_ })

$inList = @($intervals | Where-Object { $null -ne $_.NetIn })
$outList = @($intervals | Where-Object { $null -ne $_.NetOut })
$inTotal = 0.0
foreach ($x in $inList) { $inTotal += $x.NetIn * $x.Dt }
$outTotal = 0.0
foreach ($x in $outList) { $outTotal += $x.NetOut * $x.Dt }

$peakOnline = $null
$peakOnlineAt = $null
foreach ($r in $rows) {
  $o = D $r.online
  if ($null -ne $o -and ($null -eq $peakOnline -or $o -gt $peakOnline)) { $peakOnline = $o; $peakOnlineAt = $r.T }
}

# ---------------------------------------------------------- each service ---
$svc = @()
foreach ($n in $names) {
  # Up is out of the lines whose header names the service: a line from before
  # it was added did not record it, which is not the same as it being down.
  $known = @($rows | Where-Object { $null -ne $_.PSObject.Properties[$n + '_pid'] })
  $up = @($known | Where-Object { "$($_.($n + '_pid'))".Trim() -ne '' })
  $mem = @($up | ForEach-Object { D $_.($n + '_mem_mb') } | Where-Object { $null -ne $_ })

  # A restart is the pid changing from one it was seen with to another, with
  # or without a stretch of being down in between.
  $restarts = 0
  $last = ''
  foreach ($r in $up) {
    $p = "$($r.($n + '_pid'))".Trim()
    if ($last -ne '' -and $p -ne $last) { $restarts++ }
    $last = $p
  }

  $measured = @($intervals | Where-Object { $_.Svc.ContainsKey($n) })
  $coreList = @($measured | ForEach-Object { $_.Svc[$n] })
  $cpuSeconds = 0.0
  foreach ($x in $measured) { $cpuSeconds += $x.Svc[$n] * $x.Dt }
  $ioMeasured = @($intervals | Where-Object { $_.Io.ContainsKey($n) })
  $ioBytes = 0.0
  $ioSeconds = 0.0
  foreach ($x in $ioMeasured) { $ioBytes += $x.Io[$n] * $x.Dt; $ioSeconds += $x.Dt }

  $svc += [pscustomobject]@{
    Name       = $n
    Up         = $(if ($known.Count) { 100.0 * $up.Count / $known.Count } else { 0 })
    CoresAvg   = Avg $coreList
    CoresPeak  = Peak $coreList
    CpuSeconds = $cpuSeconds
    MemAvg     = Avg $mem
    MemPeak    = Peak $mem
    IoAvg      = $(if ($ioSeconds -gt 0) { $ioBytes / $ioSeconds } else { $null })
    IoBytes    = $ioBytes
    Restarts   = $restarts
  }
}

$seen = @($svc | Where-Object { $_.CpuSeconds -gt 0 -or $null -ne $_.MemAvg })
$topCpu = $seen | Sort-Object CpuSeconds -Descending | Select-Object -First 1
$topMem = $seen | Where-Object { $null -ne $_.MemAvg } | Sort-Object MemAvg -Descending | Select-Object -First 1
$topIo  = $seen | Sort-Object IoBytes -Descending | Select-Object -First 1
$allCpu = ($svc | Measure-Object CpuSeconds -Sum).Sum

# What the services did not account for: Windows itself, the watchdog,
# anything else on the box. Box share of the whole minus the services' share.
$otherCores = $null
if ($null -ne $boxAvg -and $coresNow) {
  $sumAvg = 0.0
  foreach ($s in $svc) {
    # Averaged over every interval the box was measured in, down counting as
    # nothing, so it can be taken away from the box's own average.
    $tot = 0.0
    foreach ($x in $boxList) { if ($x.Svc.ContainsKey($s.Name)) { $tot += $x.Svc[$s.Name] } }
    if ($boxList.Count) { $sumAvg += $tot / $boxList.Count }
  }
  $otherCores = ($boxAvg / 100.0) * $coresNow - $sumAvg
  if ($otherCores -lt 0) { $otherCores = 0.0 }
}

# ------------------------------------------------------- the busiest hour ---
# By the box's CPU, in this machine's own time, because that is the clock the
# person reading this lives on.
$hours = @{}
foreach ($x in $boxList) {
  $k = $x.From.ToLocalTime().ToString('yyyy-MM-dd HH:00', $inv)
  if (-not $hours.ContainsKey($k)) { $hours[$k] = @() }
  $hours[$k] += $x
}
$busiest = $null
foreach ($k in $hours.Keys) {
  $inHour = @($hours[$k])
  $avg = Avg ($inHour | ForEach-Object { $_.Box })
  if ($null -eq $busiest -or $avg -gt $busiest.CpuAvg) {
    $lead = $null
    $leadCores = 0.0
    foreach ($n in $names) {
      $l = @($inHour | Where-Object { $_.Svc.ContainsKey($n) } | ForEach-Object { $_.Svc[$n] })
      $la = Avg $l
      if ($null -ne $la -and $la -gt $leadCores) { $lead = $n; $leadCores = $la }
    }
    $busiest = [pscustomobject]@{
      Hour      = $k
      CpuAvg    = $avg
      Lead      = $lead
      LeadCores = $leadCores
      Online    = Peak ($inHour | ForEach-Object { $_.Online })
      NetOut    = Avg ($inHour | ForEach-Object { $_.NetOut })
    }
  }
}

$days = ($rows[$rows.Count - 1].T - $rows[0].T).TotalDays

$result = [pscustomobject]@{
  Lines        = $rows.Count
  From         = $rows[0].T
  To           = $rows[$rows.Count - 1].T
  Days         = $days
  Intervals    = $intervals.Count
  Gaps         = $gaps
  Reboots      = $reboots
  Cores        = $coresNow
  CpuAvg       = $boxAvg
  CpuPeak      = $boxPeak
  CpuPeakAt    = $boxPeakAt
  MemUsedAvg   = Avg $memUsed
  MemUsedPeak  = Peak $memUsed
  MemTotal     = $memTotal
  DiskFirst    = $(if ($disk.Count) { $disk[0] } else { $null })
  DiskLast     = $(if ($disk.Count) { $disk[$disk.Count - 1] } else { $null })
  DiskMin      = $(if ($disk.Count) { ($disk | Measure-Object -Minimum).Minimum } else { $null })
  NetInAvg     = Avg ($inList | ForEach-Object { $_.NetIn })
  NetInPeak    = Peak ($inList | ForEach-Object { $_.NetIn })
  NetOutAvg    = Avg ($outList | ForEach-Object { $_.NetOut })
  NetOutPeak   = Peak ($outList | ForEach-Object { $_.NetOut })
  NetInTotal   = $inTotal
  NetOutTotal  = $outTotal
  PeakOnline   = $peakOnline
  PeakOnlineAt = $peakOnlineAt
  Services     = $svc
  TopCpu       = $(if ($topCpu) { $topCpu.Name } else { $null })
  TopCpuShare  = $(if ($topCpu -and $allCpu -gt 0) { 100.0 * $topCpu.CpuSeconds / $allCpu } else { $null })
  TopMem       = $(if ($topMem) { $topMem.Name } else { $null })
  TopIo        = $(if ($topIo -and $topIo.IoBytes -gt 0) { $topIo.Name } else { $null })
  OtherCores   = $otherCores
  Busiest      = $busiest
  AWeek        = ($days -ge 7)
}

if ($PassThru) { return $result }

# -------------------------------------------------------------- printing ---
function F($x, [int]$digits) {
  if ($null -eq $x) { return '-' }
  return ([double]$x).ToString('N' + $digits, $inv)
}
function When($t) {
  if ($null -eq $t) { return '-' }
  return $t.ToLocalTime().ToString('ddd d MMM HH:mm', $inv)
}
function Mbit($bytesPerSecond) {
  if ($null -eq $bytesPerSecond) { return '-' }
  return (F ($bytesPerSecond * 8 / 1e6) 1)
}
function MBs($bytesPerSecond) {
  if ($null -eq $bytesPerSecond) { return '-' }
  return ((F ($bytesPerSecond / 1MB) 2) + ' MB/s')
}
function MB($megabytes) {
  if ($null -eq $megabytes) { return '-' }
  return ((F $megabytes 0) + ' MB')
}

Write-Host ''
Write-Host '  THORNSWOOD  -  what the box used, and what used it' -ForegroundColor White

Head 'The record'
Say ('  {0} lines, {1} to {2}, {3} days, {4} cores' -f (F $result.Lines 0), (When $result.From), (When $result.To), (F $days 1), (F $coresNow 0))
if ($gaps -or $reboots) {
  Say ('  left out: {0} gap(s) of more than {1} minutes, {2} reboot(s)' -f $gaps, [int]($GapSeconds / 60), $reboots) 'DarkGray'
}

Head 'The box'
Say ('  cpu       {0}% on average, {1}% at its peak ({2})' -f (F $boxAvg 0), (F $boxPeak 0), (When $boxPeakAt))
Say ('  memory    {0} MB in use on average, {1} MB at its peak, of {2} MB' -f (F $result.MemUsedAvg 0), (F $result.MemUsedPeak 0), (F $memTotal 0))
Say ('  disk      C: {0} GB free at the start, {1} GB at the end, {2} GB at its lowest' -f (F $result.DiskFirst 1), (F $result.DiskLast 1), (F $result.DiskMin 1))
Say ('  network   in {0} Mbit/s on average and {1} at its peak, out {2} Mbit/s on average and {3} at its peak' -f (Mbit $result.NetInAvg), (Mbit $result.NetInPeak), (Mbit $result.NetOutAvg), (Mbit $result.NetOutPeak))
Say ('            {0} GB in and {1} GB out over the record' -f (F ($inTotal / 1GB) 1), (F ($outTotal / 1GB) 1))
if ($null -ne $peakOnline) {
  Say ('  people    {0} on the live server at once at the most, {1}' -f (F $peakOnline 0), (When $peakOnlineAt))
}

$core = if ($coresNow) { F (100.0 / $coresNow) 0 } else { '-' }
Head ('Each service (cpu in cores; one core is ' + $core + '% of this box)')
Say ('  {0,-10}{1,6}{2,10}{3,10}{4,12}{5,12}{6,14}{7,10}' -f 'service', 'up', 'cpu avg', 'cpu peak', 'mem avg', 'mem peak', 'i/o avg', 'restarts') 'DarkGray'
foreach ($s in $svc) {
  $c = if ($s.Up -gt 0) { 'Gray' } else { 'DarkGray' }
  Say ('  {0,-10}{1,6}{2,10}{3,10}{4,12}{5,12}{6,14}{7,10}' -f $s.Name, ((F $s.Up 0) + '%'), (F $s.CoresAvg 2), (F $s.CoresPeak 2),
       (MB $s.MemAvg), (MB $s.MemPeak), (MBs $s.IoAvg), $s.Restarts) $c
}
if ($null -ne $otherCores) {
  Say ('  everything else on the box: {0} cores on average' -f (F $otherCores 2)) 'DarkGray'
}

Head 'Which one leads'
if ($result.TopCpu) {
  Say ('  cpu       {0}, {1}% of all the processor time the services used' -f $result.TopCpu, (F $result.TopCpuShare 0)) 'White'
}
if ($result.TopMem) {
  Say ('  memory    {0}, {1} MB on average' -f $result.TopMem, (F $topMem.MemAvg 0)) 'White'
}
if ($result.TopIo) {
  Say ('  i/o       {0}, {1} on average, disk and network together' -f $result.TopIo, (MBs $topIo.IoAvg)) 'White'
}
Say ('  network   the box as a whole sent {0} Mbit/s on average. Windows keeps no per-service count' -f (Mbit $result.NetOutAvg)) 'White'
Say '            of network bytes that is cheap to read, so i/o above is the nearest per-service figure.' 'DarkGray'

if ($busiest) {
  Head 'The busiest hour'
  $lead = if ($busiest.Lead) { $busiest.Lead + ' used the most (' + (F $busiest.LeadCores 2) + ' cores)' } else { 'no service measured' }
  Say ('  {0}   cpu {1}% on average, {2}, {3} people on, out {4} Mbit/s' -f $busiest.Hour, (F $busiest.CpuAvg 0), $lead, (F $busiest.Online 0), (Mbit $busiest.NetOut))
}

$oneCore = @($svc | Where-Object { $null -ne $_.CoresPeak -and $_.CoresPeak -ge 0.9 })
if ($oneCore.Count) {
  Write-Host ''
  Say ('  ' + (($oneCore | ForEach-Object { $_.Name }) -join ', ') + ' reached about one full core at its peak. That is the speed of one core') 'Yellow'
  Say '  running out, and more cores do not help it. A faster core does.' 'Yellow'
}

if (-not $result.AWeek) {
  Write-Host ''
  Say ('  This is {0} days. The To Do List asks for a week that includes a busy evening before' -f (F $days 1)) 'Yellow'
  Say '  anything is decided from it.' 'Yellow'
}

Done 0
