<#
  test-storage-forecast.ps1

  Issue #2178. Holds scripts\vps\Forecast-Storage.ps1 to its promises with
  made-up histories in a temp folder: it refuses to forecast from one
  snapshot or too short a span, says no-growth on a flat disk, and gives
  ok, warning and critical at the documented lines. Then the alerts: a
  forecast that turns writes one message of the watchdog's outbox shape, a
  level that holds writes nothing more, not-enough-data never tells, and
  -TestAlert writes one test message and touches no sample or level. Each
  case runs under PowerShell 7, because the task on the box runs pwsh since
  #5356. Nothing real is read and nothing reaches the VPS.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\vps\Forecast-Storage.ps1'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('fc-' + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
$fail = 0; $pass = 0
$total = 100GB
$t0 = [datetime]'2026-10-01T00:00:00Z'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# Each shell by name, for the lines and the folders named after it: the
# box's PowerShell 7, the one that runs this.
$shells = @('pwsh')
$boxPs = Get-BoxPowerShell
function Hist([string]$name, [int]$count, [double]$startFree, [double]$perDay, [double]$stepDays = 1) {
  $p = Join-Path $tmp $name
  $lines = for ($i = 0; $i -lt $count; $i++) {
    [ordered]@{ t = $t0.ToUniversalTime().AddDays($i * $stepDays).ToString('o'); drive = 'C'; total = $total; free = $startFree + $perDay * $i * $stepDays } | ConvertTo-Json -Compress
  }
  Set-Content $p $lines -Encoding utf8; $p
}
function Run([string]$shell, [object[]]$argv) {
  $out = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $script @argv 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $out }
}
function T([bool]$cond, [string]$what, [string]$detail = '') {
  if ($cond) { $script:pass++; Write-Host ('PASS ' + $what) } else { $script:fail++; Write-Host ('FAIL ' + $what + "`n" + $detail) }
}
function Check([string]$shell, [string]$what, [string]$hist, [string]$now, [int]$code, [string]$verdict, [string[]]$extra = @()) {
  $x = Run $shell (@('-History', $hist, '-Now', $now) + $extra)
  T ($x.Code -eq $code -and $x.Out -match ('verdict\s+' + [regex]::Escape($verdict))) ($shell + ': ' + $what) ('exit ' + $x.Code + "`n" + $x.Out)
}
function Outbox([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return ,@() }
  return ,@(Get-Content -LiteralPath $path | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
}
$end = { param($n, $s = 1) $t0.AddDays(($n - 1) * $s).ToString('o') }
try {
  foreach ($sh in $shells) {
    Check $sh 'one snapshot refuses' (Hist 'one.jsonl' 1 30GB 0) (& $end 1) 0 'not-enough-data'
    Check $sh 'many samples over too short a span refuse' (Hist 'short.jsonl' 20 50GB (-2GB) 0.1) (& $end 20 0.1) 0 'not-enough-data'
    Check $sh 'no history refuses' (Join-Path $tmp 'none.jsonl') (& $end 1) 0 'not-enough-data'
    Check $sh 'flat disk is no-growth' (Hist 'flat.jsonl' 15 60GB 0) (& $end 15) 0 'no-growth'
    Check $sh 'slow growth is ok' (Hist 'slow.jsonl' 15 80GB (-0.5GB)) (& $end 15) 0 'ok'
    Check $sh '10% inside 30 days warns' (Hist 'warn.jsonl' 15 60GB (-2GB)) (& $end 15) 1 'warning'
    Check $sh '10% inside 7 days is critical' (Hist 'crit.jsonl' 15 50GB (-2.5GB)) (& $end 15) 2 'critical'
    Check $sh 'already under 10% is critical even with one sample' (Hist 'under.jsonl' 1 5GB 0) (& $end 1) 2 'critical'

    # -Record appends a line with the stand-in reading and nothing else.
    $rec = Join-Path $tmp ($sh + '-rec\h.jsonl')
    $null = Run $sh @('-History', $rec, '-Record', '-FreeBytes', 40GB, '-TotalBytes', $total, '-Now', '2026-10-01T00:00:00Z')
    $lines = @(Get-Content $rec)
    T ($lines.Count -eq 1 -and ($lines[0] | ConvertFrom-Json).free -eq 40GB) ($sh + ': -Record appends one sample') ($lines -join ' | ')

    # ---- telling staff: one message when the level turns, none while it holds
    $box = Join-Path $tmp ($sh + '-box'); New-Item -ItemType Directory $box | Out-Null
    $ob = Join-Path $box 'alerts.jsonl'; $st = Join-Path $box 'disk-forecast.txt'
    $a = @('-Alerts', $ob, '-State', $st)
    $x = Run $sh (@('-History', (Join-Path $tmp 'warn.jsonl'), '-Now', (& $end 15)) + $a)
    $o = Outbox $ob
    T ($x.Code -eq 1 -and $o.Count -eq 1 -and $o[0].kind -eq 'warning' -and (Get-Content $st) -eq 'warning') ($sh + ': a forecast that turns to warning tells staff once and keeps the level') $x.Out
    $m = $o[0]
    T ($m.id -match '-diskforecast-warning$' -and [int64]$m.at -gt 0 -and $m.service -eq 'disk forecast' -and $m.text -match '^\*\*Free disk space on the VPS' -and $m.text -match 'reaches 10% free in') ($sh + ': the message has the outbox shape the bot reads (id, at, service, kind, text) and says the days left') ($o | ConvertTo-Json -Compress)
    $x = Run $sh (@('-History', (Join-Path $tmp 'warn.jsonl'), '-Now', (& $end 15)) + $a)
    T ($x.Code -eq 1 -and (Outbox $ob).Count -eq 1) ($sh + ': the same warning the next day tells nobody again') $x.Out
    $x = Run $sh (@('-History', (Join-Path $tmp 'one.jsonl'), '-Now', (& $end 1)) + $a)
    T ((Outbox $ob).Count -eq 1 -and (Get-Content $st) -eq 'warning') ($sh + ': not-enough-data tells nothing and leaves the level') $x.Out
    $x = Run $sh (@('-History', (Join-Path $tmp 'crit.jsonl'), '-Now', (& $end 15)) + $a)
    $o = Outbox $ob
    T ($x.Code -eq 2 -and $o.Count -eq 2 -and $o[1].kind -eq 'critical' -and (Get-Content $st) -eq 'critical') ($sh + ': warning to critical tells again') $x.Out
    $x = Run $sh (@('-History', (Join-Path $tmp 'flat.jsonl'), '-Now', (& $end 15)) + $a)
    $o = Outbox $ob
    T ($x.Code -eq 0 -and $o.Count -eq 3 -and $o[2].kind -eq 'back' -and (Get-Content $st) -eq 'ok') ($sh + ': back to no-growth says it is fine again') $x.Out
    $x = Run $sh (@('-History', (Join-Path $tmp 'slow.jsonl'), '-Now', (& $end 15)) + $a)
    T ((Outbox $ob).Count -eq 3) ($sh + ': ok after no-growth is the same quiet level') $x.Out
    $x = Run $sh (@('-History', (Join-Path $tmp 'slow.jsonl'), '-Now', (& $end 15)))
    T (-not ($x.Out -match 'told')) ($sh + ': without -Alerts nothing is told') $x.Out

    # ---- -TestAlert: one test message, no disk read, no sample, no level
    $tb = Join-Path $tmp ($sh + '-test'); New-Item -ItemType Directory $tb | Out-Null
    $th = Join-Path $tb 'h.jsonl'; $tob = Join-Path $tb 'alerts.jsonl'; $tst = Join-Path $tb 'disk-forecast.txt'
    Set-Content $tst 'warning' -Encoding ASCII
    $x = Run $sh @('-History', $th, '-Alerts', $tob, '-State', $tst, '-TestAlert')
    $o = Outbox $tob
    T ($x.Code -eq 0 -and $o.Count -eq 1 -and $o[0].kind -eq 'test' -and $o[0].text -match 'Nothing is wrong' -and $x.Out -match [regex]::Escape($o[0].id)) ($sh + ': -TestAlert writes one test message and prints its id') $x.Out
    T (-not (Test-Path $th) -and (Get-Content $tst) -eq 'warning') ($sh + ': -TestAlert writes no sample and leaves the level alone') ''
    $x = Run $sh @('-History', $th, '-TestAlert')
    T ($x.Code -eq 3 -and -not (Test-Path (Join-Path $tb 'h.jsonl'))) ($sh + ': -TestAlert without -Alerts stops') $x.Out
  }

  # ---- the install from this machine sends what the box will run
  $tokens = $null; $errs = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $script).Path, [ref]$tokens, [ref]$errs)
  T (-not $errs.Count) 'Forecast-Storage.ps1 parses' (($errs | ForEach-Object { $_.Message }) -join '; ')
  $text = [IO.File]::ReadAllText((Resolve-Path $script).Path)
  T ($text -match "schtasks /create /tn '\`$Task' /sc daily /st \`$At /ru SYSTEM" -and $text -match '-Record -History \$boxHistory -Alerts \$boxAlerts') 'the task samples daily as SYSTEM with -Record and the watchdog outbox' ''
  T ($text -match '\[string\]\$Task = ''Thornswood Disk History''' -and $text -match '\[string\]\$Root = ''C:\\Thornswood-Watch''') 'the task name and folder are the ones records\prod-parity.json and the docs name' ''
  T ($text -match 'pwsh -NoProfile -ExecutionPolicy Bypass -File \$boxScript' -and $text -notmatch '\bpowershell(\.exe)? -') 'the box runs it with PowerShell 7, as every box task since #5356, and nothing in it starts Windows PowerShell' ''
} finally { Remove-Item -Recurse -Force $tmp }
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
