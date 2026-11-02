<#
  test-2183-availability.ps1

      pwsh -NoProfile -File .\tests\test-2183-availability.ps1

  Issue #2183. Holds scripts\vps\Read-Availability.ps1 to what it says, on
  made-up alerts.jsonl lines in a temp folder, the shape Watch-Services.ps1
  and Watch-Outside.ps1 write (id, at, service, kind, text). Nothing real is
  read and nothing reaches the VPS.

  What it checks, over a one-day window (1,440 minutes):
    1. one outage gives its minutes and the availability for the window;
       two outages of one service add up; services are kept apart, the
       outside ones included
    2. an outage that began before the window is cut at its start, one still
       open is counted to its end and marked, and one wholly outside the
       window is not counted
    3. a back with no down before it in the file is counted from the
       window's start, a second down while down changes nothing, and lines
       out of order in the file are read in time order
    4. lines of other kinds (the disk forecast, a test) and lines that are
       not JSON are skipped and counted, and a service with no outage in the
       window is not listed
    5. -Days ends at -To, -Service picks services, a window that ends before
       it starts and a file that is not there are refused
    6. the printed report says both limitations and the minutes under
       PowerShell 7, the box's since #5356, and never says a service met a target
    7. it reads only: the file is the same after, nothing is added beside it,
       and the script has no command that writes, deletes or connects
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\vps\Read-Availability.ps1'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('avail-' + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
$script:pass = 0; $script:fail = 0
function T([bool]$cond, [string]$what, [string]$detail = '') {
  if ($cond) { $script:pass++; Write-Host ('PASS  ' + $what) }
  else { $script:fail++; Write-Host ('FAIL  ' + $what); if ($detail) { Write-Host $detail } }
}

$day0 = [DateTimeOffset]::Parse('2026-10-01T00:00:00Z', [Globalization.CultureInfo]::InvariantCulture)
function At([string]$hhmm, [int]$dayOffset = 0) {
  $p = $hhmm.Split(':')
  return $day0.AddDays($dayOffset).AddHours([int]$p[0]).AddMinutes([int]$p[1]).ToUnixTimeSeconds()
}
function Line([string]$service, [string]$kind, [long]$at) {
  return (ConvertTo-Json @{ id = ('' + $at + '-' + ($service -replace '[^A-Za-z0-9]', '') + '-' + $kind); at = $at; service = $service; kind = $kind; text = ('**' + $service + ' ' + $kind + '**') } -Compress)
}
function Fixture([string]$name, [string[]]$lines) {
  $p = Join-Path $tmp $name
  [IO.File]::WriteAllText($p, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  return $p
}
$W = @{ From = '2026-10-01T00:00:00Z'; To = '2026-10-02T00:00:00Z' }
function ReadIt([string]$p, [hashtable]$more = @{}) {
  $a = @{ Path = $p; PassThru = $true } + $W
  foreach ($k in $more.Keys) { $a[$k] = $more[$k] }
  return & $script @a
}
function Svc($r, [string]$name) { return @($r.Services | Where-Object { $_.Service -eq $name })[0] }

try {
  # ---------------------------------------------------------- 1
  $f1 = Fixture 'basic.jsonl' @(
    (Line 'game' 'down' (At '10:00')), (Line 'game' 'back' (At '10:30')),
    (Line 'game' 'down' (At '20:00')), (Line 'game' 'back' (At '20:15')),
    (Line 'caddy' 'down' (At '12:00')), (Line 'caddy' 'back' (At '12:06')),
    (Line 'outside site' 'down' (At '12:05')), (Line 'outside site' 'back' (At '12:20'))
  )
  $r = ReadIt $f1
  $g = Svc $r 'game'
  T ($r.WindowMinutes -eq 1440) 'the window is 1,440 minutes' ('' + $r.WindowMinutes)
  T ($g.Outages -eq 2 -and $g.DownSeconds -eq 2700 -and $g.DownMinutes -eq 45) 'two outages of one service add up: 30 + 15 = 45 minutes' ($g | Out-String)
  T ($g.Availability -eq 96.875) 'and give 96.875% of the day (1 - 45/1440)' ('' + $g.Availability)
  $c = Svc $r 'caddy'
  T ($c.Outages -eq 1 -and $c.DownMinutes -eq 6) 'caddy is counted on its own: 6 minutes' ($c | Out-String)
  $o = Svc $r 'outside site'
  T ($o.DownMinutes -eq 15) 'an outside line is its own service: 15 minutes' ($o | Out-String)
  T (@($r.Services).Count -eq 3) 'three services, no more' (($r.Services | Out-String))

  # ---------------------------------------------------------- 2
  $f2 = Fixture 'edges.jsonl' @(
    (Line 'voice' 'down' (At '23:00' -1)), (Line 'voice' 'back' (At '01:00')),
    (Line 'bot' 'down' (At '23:00')),
    (Line 'website' 'down' (At '10:00' -2)), (Line 'website' 'back' (At '11:00' -2)),
    (Line 'website' 'down' (At '01:00' 1)), (Line 'website' 'back' (At '02:00' 1))
  )
  $r = ReadIt $f2
  $v = Svc $r 'voice'
  T ($v.DownMinutes -eq 60) 'an outage from before the window is cut at its start: 60 minutes, not 120' ($v | Out-String)
  $b = Svc $r 'bot'
  T ($b.DownMinutes -eq 60 -and $b.StillDown) 'one still open is counted to the window''s end and marked still down' ($b | Out-String)
  T ($null -eq (Svc $r 'website')) 'outages wholly before or after the window are not counted' ($r.Services | Out-String)
  T (@($r.Notes | Where-Object { $_ -like 'bot: still down*' }).Count -eq 1) 'a note says the bot was still down at the end' ($r.Notes -join "`n")

  # ---------------------------------------------------------- 3
  $f3 = Fixture 'odd.jsonl' @(
    (Line 'dev game' 'back' (At '02:00')),
    (Line 'game' 'back' (At '08:20')),
    (Line 'game' 'down' (At '08:00')),
    (Line 'runner' 'down' (At '09:00')), (Line 'runner' 'down' (At '09:10')), (Line 'runner' 'back' (At '09:30'))
  )
  $r = ReadIt $f3
  $d = Svc $r 'dev game'
  T ($d.DownMinutes -eq 120) 'a back with no down before it is counted from the window''s start: 120 minutes' ($d | Out-String)
  T (@($r.Notes | Where-Object { $_ -like 'dev game: a back line with no down*' }).Count -eq 1) 'and a note says so' ($r.Notes -join "`n")
  $g = Svc $r 'game'
  T ($g.DownMinutes -eq 20 -and $g.Outages -eq 1) 'lines out of order are read in time order: 20 minutes' ($g | Out-String)
  $u = Svc $r 'runner'
  T ($u.DownMinutes -eq 30 -and $u.Outages -eq 1) 'a second down while down changes nothing: 30 minutes from the first' ($u | Out-String)
  T (@($r.Notes | Where-Object { $_ -like 'runner: 1 down line*' }).Count -eq 1) 'and a note counts it' ($r.Notes -join "`n")

  # ---------------------------------------------------------- 4
  $forecast = ConvertTo-Json @{ id = 'x-diskforecast-warning'; at = (At '05:00'); service = 'disk forecast'; kind = 'warning'; text = 'w' } -Compress
  $test = ConvertTo-Json @{ id = 'x-test'; at = (At '05:00'); service = 'watch'; kind = 'test'; text = 't' } -Compress
  $f4 = Fixture 'mixed.jsonl' @(
    $forecast, $test, 'not json at all', '{"service":"game","kind":"down"}', '',
    (Line 'backup' 'down' (At '03:00')), (Line 'backup' 'back' (At '04:00'))
  )
  $r = ReadIt $f4
  T ($r.Other -eq 2) 'two lines of other kinds are skipped and counted' ('' + $r.Other)
  T ($r.Skipped -eq 2) 'a line that is not JSON and one with no time are skipped and counted' ('' + $r.Skipped)
  T ($r.Lines -eq 6 -and $r.DownOrBack -eq 2) 'six lines read (the blank one is not a line), two of them down or back' ('' + $r.Lines + ' ' + $r.DownOrBack)
  T (@($r.Services).Count -eq 1 -and (Svc $r 'backup').DownMinutes -eq 60) 'only the service with an outage is listed' ($r.Services | Out-String)
  $r = ReadIt (Fixture 'empty.jsonl' @())
  T (@($r.Services).Count -eq 0) 'an empty file lists nothing' ($r.Services | Out-String)

  # ---------------------------------------------------------- 5
  $r = & $script -Path $f1 -To '2026-10-02T00:00:00Z' -Days 1 -PassThru
  T ($r.WindowMinutes -eq 1440 -and (Svc $r 'game').DownMinutes -eq 45) '-Days 1 ending at -To is the same day' ('' + $r.WindowMinutes)
  $r = & $script -Path $f1 -To '2026-10-02T00:00:00Z' -Days 28 -PassThru
  T ((Svc $r 'game').Availability -eq 99.888) 'over 28 days the same 45 minutes are 99.888%' ('' + (Svc $r 'game').Availability)
  $r = ReadIt $f1 @{ Service = @('caddy') }
  T (@($r.Services).Count -eq 1 -and $r.Services[0].Service -eq 'caddy') '-Service caddy lists caddy only' ($r.Services | Out-String)
  $threw = $false; try { $null = & $script -Path $f1 -From '2026-10-02' -To '2026-10-01' -PassThru } catch { $threw = $true }
  T $threw 'a window that ends before it starts is refused'
  $threw = $false; try { $null = & $script -Path (Join-Path $tmp 'none.jsonl') -PassThru } catch { $threw = $true }
  T $threw 'a file that is not there is refused'

  # ---------------------------------------------------------- 6
  . (Join-Path $PSScriptRoot 'Windows.ps1')
  # Each shell by name, for the lines: the box's PowerShell 7, the one that runs this.
  $shells = @('pwsh')
  foreach ($sh in $shells) {
    $exe = Get-BoxPowerShell
    $out = & $exe -NoProfile -ExecutionPolicy Bypass -File $script -Path $f1 -From $W.From -To $W.To -NoPause 2>&1 | Out-String
    $code = $LASTEXITCODE
    T ($code -eq 0) ($sh + ': the report exits 0') $out
    T ($out -match '(?m)^\s+game\s+2\s+45\.0\s+96\.875%') ($sh + ': it prints game, 2 outages, 45.0 minutes, 96.875%') $out
    T ($out -match 'undercounted by up to that window' -and $out -match 'Nothing is counted while the watchdog itself is off') ($sh + ': it says both limitations') $out
    T ($out -notmatch '(?i)\b(meets|met|meeting)\b') ($sh + ': it never says a service met a target') $out
    $miss = & $exe -NoProfile -ExecutionPolicy Bypass -File $script -Path (Join-Path $tmp 'none.jsonl') -NoPause 2>&1 | Out-String
    T ($LASTEXITCODE -eq 1 -and $miss -match 'NO FILE') ($sh + ': a missing file exits 1 and says NO FILE') $miss
  }

  # ---------------------------------------------------------- 7
  $before = (Get-FileHash -LiteralPath $f1 -Algorithm SHA256).Hash
  $count = @(Get-ChildItem -LiteralPath $tmp).Count
  $null = ReadIt $f1
  T ((Get-FileHash -LiteralPath $f1 -Algorithm SHA256).Hash -eq $before) 'the file is the same after it is read'
  T (@(Get-ChildItem -LiteralPath $tmp).Count -eq $count) 'nothing is added beside it'
  $src = [IO.File]::ReadAllText((Resolve-Path $script).Path)
  $code = [regex]::Replace($src, '(?s)<#.*?#>', '')
  $code = ($code -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
  $writes = 'Set-Content', 'Add-Content', 'Out-File', 'Remove-Item', 'New-Item', 'Move-Item', 'Copy-Item', 'WriteAll', 'AppendAll', 'Invoke-WebRequest', 'Invoke-RestMethod', 'ssh', 'scp', 'schtasks'
  $found = @($writes | Where-Object { $code -match ('(?i)\b' + [regex]::Escape($_)) })
  T ($found.Count -eq 0) ('the script has no command that writes, deletes or connects' ) ($found -join ', ')
  T ($src -match [regex]::Escape("[string]`$Path = 'C:\Thornswood-Watch\alerts.jsonl'")) 'it reads the watchdog''s outbox by default'
}
finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
