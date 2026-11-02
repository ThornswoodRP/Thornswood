<#
  vps-syn-flood.ps1

  Measures the forged SYN flood on the box's port 443 (#2995) and what it
  costs the box, over a short window. Runs ON the box, in PowerShell 7,
  sent by Remote.ps1 from a clean main checkout:

      .\scripts\vps\Remote.ps1 -File .\scripts\vps\vps-syn-flood.ps1
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\vps-syn-flood.ps1 -Arguments '-Seconds 120'

  WHAT THE FLOOD IS. Somebody sends SYNs to 443 with the source address of
  somebody else (residential ranges, mostly Russian, changing all the time),
  so the box's SYN-ACKs, and its four resends of each, go to the forged
  address: the box is one reflector of many in an attack on those addresses.
  Measured on 21 Oct 2026 (#2995): about 110 to 120 half-open connections on
  443 at any moment, 5 to 8 failed connects a second, four or five SYN-ACKs
  and one RST sent for each forged SYN, and 83% of the SYNs in the #2946
  capture with no TCP option at all, which no real client sends. It costs the box next to
  nothing (Caddy never sees a half-open connection; the SYN-ACKs are a few
  kilobytes a second), but it makes the box's retransmit share read near 20%,
  which is the flood and not a fault in the network. The fix is the host's:
  filtering forged SYNs upstream before they reach the box.

  WHY A SCRIPT. So the same measurement can be taken again, by anybody, the
  day the host says it filters, and the numbers compared with the ones above.
  Lines typed into a shell on the live box from a cloud session are refused
  (#2970); a reviewed file sent by Remote.ps1 is not.

  WHAT IT READS, and it changes nothing:
    the process that listens on 443;
    the half-open (SynReceived) connections on 443, every 10 seconds;
    the box's IPv4 TCP totals (passive opens, failed connects, segments sent
    and resent), the ones netstat -s prints, at the start and the end of the
    window. They come from GetTcpIPv4Statistics, the call netstat itself
    makes, which any account may make. The TCPv4 performance class gave the
    same totals at both ends of an 11 second window under the Windows
    runner's account while the flood ran (#2995), and a window of zeros
    reads like a box with no flood;
    the 443 process's CPU time and working set.
  No address is printed: only how many, and how many distinct /16s.

  WHAT IT PRINTS:
      LISTENER <process> pid <n>
      HALF-OPEN 443 min <n> avg <n> max <n>, <n> addresses in <n> /16s
      CONNECTS <n> passive, <n> failed (<p>%) in <s> s
      RETRANSMITS <n>/s of <n>/s sent (<p>%), about <n> per failed connect
      COST <process> <p>% of one core, <n> MB; SYN-ACKs about <n> bytes/s out
      VERDICT FLOOD|QUIET <why>
  FLOOD is 20 or more half-open on 443 on average; a box nobody floods has a
  handful at most. Exit 0 either way; 1 only when it could not measure, with
  VERDICT UNKNOWN and why.

  tests\test-syn-flood.ps1 holds it to this.
#>
[CmdletBinding()]
param(
    [ValidateRange(10, 300)][int]$Seconds = 60
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Every = 10
# A SYN-ACK on the wire with only an MSS option, as the capture shows them.
$SynAckBytes = 58

function Get-Tcp { [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetTcpIPv4Statistics() }
function Get-Half {
    $h = @(Get-NetTCPConnection -State SynReceived -LocalPort 443 -ErrorAction SilentlyContinue)
    , @($h | ForEach-Object { $_.RemoteAddress })
}

$l = @(Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue) | Select-Object -First 1
if (-not $l) { 'VERDICT UNKNOWN nothing listens on 443, so there is nothing to measure'; exit 1 }
$p = Get-Process -Id $l.OwningProcess
'LISTENER {0} pid {1}' -f $p.ProcessName, $p.Id

$t0 = Get-Tcp
if (-not $t0) { 'VERDICT UNKNOWN the TCP totals could not be read, so nothing was measured'; exit 1 }
$c0 = $null
try { $c0 = $p.TotalProcessorTime.TotalSeconds } catch { $c0 = $null }
$start = Get-Date
$counts = @()
$addrs = @{}
$n = [Math]::Max(1, [int]($Seconds / $Every))
for ($i = 0; $i -le $n; $i++) {
    $h = Get-Half
    $counts += $h.Count
    foreach ($a in $h) { $addrs[$a] = $true }
    if ($i -lt $n) { Start-Sleep -Seconds $Every }
}
$t1 = Get-Tcp
$secs = ((Get-Date) - $start).TotalSeconds

$m = $counts | Measure-Object -Minimum -Average -Maximum
$sixteens = @($addrs.Keys | ForEach-Object { (($_ -split '\.')[0..1]) -join '.' } | Sort-Object -Unique).Count
'HALF-OPEN 443 min {0} avg {1:N0} max {2}, {3} addresses in {4} /16s' -f $m.Minimum, $m.Average, $m.Maximum, $addrs.Count, $sixteens

$passive = $t1.ConnectionsAccepted - $t0.ConnectionsAccepted
$failed = $t1.FailedConnectionAttempts - $t0.FailedConnectionAttempts
$sent = $t1.SegmentsSent - $t0.SegmentsSent
$resent = $t1.SegmentsResent - $t0.SegmentsResent
$failedPct = 0; if ($passive -gt 0) { $failedPct = 100 * $failed / $passive }
$resentPct = 0; if ($sent -gt 0) { $resentPct = 100 * $resent / $sent }
$perFailed = 0; if ($failed -gt 0) { $perFailed = $resent / $failed }
'CONNECTS {0} passive, {1} failed ({2:N0}%) in {3:N0} s' -f $passive, $failed, $failedPct, $secs
'RETRANSMITS {0:N1}/s of {1:N1}/s sent ({2:N0}%), about {3:N1} per failed connect' -f ($resent / $secs), ($sent / $secs), $resentPct, $perFailed

$cpu = 'unknown'
if ($null -ne $c0) {
    try { $p.Refresh(); $cpu = '{0:N2}%' -f (100 * ($p.TotalProcessorTime.TotalSeconds - $c0) / $secs) } catch { $cpu = 'unknown' }
}
$synAcks = ($failed + $resent) / $secs
'COST {0} {1} of one core, {2:N0} MB; SYN-ACKs about {3:N0} bytes/s out' -f $p.ProcessName, $cpu, ($p.WorkingSet64 / 1MB), ($synAcks * $SynAckBytes)

if ($m.Average -ge 20) {
    'VERDICT FLOOD {0:N0} half-open on 443 on average and {1:N1} failed connects a second' -f $m.Average, ($failed / $secs)
} else {
    'VERDICT QUIET {0:N0} half-open on 443 on average' -f $m.Average
}
exit 0
