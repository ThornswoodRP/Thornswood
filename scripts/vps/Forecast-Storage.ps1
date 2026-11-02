<#
.SYNOPSIS
  Records the VPS disk free space over time and forecasts when it reaches the watchdog's DISK LOW and DISK CRITICAL lines, refusing to forecast from too few samples, and tells staff when the forecast turns.

.DESCRIPTION
  Issue #2178. Watch-Services.ps1 already says DISK LOW under 20% free and
  DISK CRITICAL under 10%, but only once the disk is already there. This
  keeps a history of samples (one JSON line each: time, drive, total and
  free bytes) and fits a straight line through the free bytes to say how
  many days are left before each of those two lines is crossed.

  The issue warns against judging capacity from one snapshot, so the
  forecast refuses to project (verdict 'not-enough-data', exit 0) until the
  history holds at least -MinSamples samples spread over at least
  -MinSpanDays days. A disk that is flat or gaining free space gets
  'no-growth'.

  ASSUMPTIONS, said in every report: growth is linear over the window
  read (the last -WindowDays days), nothing is deleted or rotated in bulk
  during the horizon, and the drive size does not change.

  THRESHOLDS AND OWNERS
    ok        exit 0  DISK CRITICAL (10%) is more than -WarnDays (30) days out.
    warning   exit 1  10% is reached within 30 days, or 20% within 7.
                      Owner: Installer lane. Action: plan cleanup or retention
                      for logs, uploads, payloads and backups this week.
    critical  exit 2  10% is reached within -CriticalDays (7) days, or the
                      disk is already under 10%. Owner: whoever is on staff.
                      Action: clear old logs, uploads or payloads today.
  Exit 3 means the history could not be read.

  TELLING STAFF. With -Alerts (the watchdog's outbox, alerts.jsonl in
  C:\Thornswood-Watch) a forecast that turns to warning or critical, or from
  warning to critical, appends ONE message of the outbox's shape (id, at,
  service, kind, text), and one more when it is back to ok or no-growth. The
  bot posts it in the staff channel, or the watchdog through its webhook when
  the bot is down (Watch-Services.ps1 says how). The level last told is kept
  in -State (disk-forecast.txt beside the history), so a disk that stays in
  warning is one message, not one a day. not-enough-data never tells and
  never moves the level.

  -TestAlert appends one message saying it is a test and nothing is wrong,
  and prints its id. It reads no disk, writes no sample and leaves -State
  alone, so the alert path is tested without touching any data. The check is
  that the id turns up in alerts-sent-bot.txt (or alerts-sent-webhook.txt)
  within a few minutes.

  Reads the disk and appends one line to the history with -Record. Never
  deletes anything, never touches a service. -FreeBytes/-TotalBytes and
  -Now stand in for a real reading so tests\test-storage-forecast.ps1 can
  run it offline.

  ON THE BOX, from this machine:
      .\scripts\vps\Forecast-Storage.ps1 -Install   put it on the VPS and sample daily
      .\scripts\vps\Forecast-Storage.ps1 -Status    the task, the history, today's forecast
      .\scripts\vps\Forecast-Storage.ps1 -Remove    take the task off, leaving the history
  -Install writes this file to C:\Thornswood-Watch\forecast-storage.ps1 and a
  task, "Thornswood Disk History", that runs it as SYSTEM every day at -At
  (04:00 box time, after the 08:15 UTC backup, so every sample is taken at the
  same point in the day) with -Record, the history in
  C:\Thornswood-Watch\disk-history.jsonl and -Alerts on the watchdog's
  outbox. It then runs the task once and shows the first sample. Its own
  task, not a line in the watchdog, so nothing it does can hold up a
  restart (the same reason Watch-Load.ps1 gives).

.EXAMPLE
  .\scripts\vps\Forecast-Storage.ps1 -Record -History C:\Thornswood-Watch\disk-history.jsonl -Alerts C:\Thornswood-Watch\alerts.jsonl
#>
[CmdletBinding()]
param(
  [string]$History = 'C:\Thornswood-Watch\disk-history.jsonl',
  [switch]$Record,
  [string]$Alerts = '',
  [string]$State = '',
  [switch]$TestAlert,
  [string]$Drive = 'C',
  [double]$FreeBytes = -1,
  [double]$TotalBytes = -1,
  [string]$Now = '',
  [int]$MinSamples = 14,
  [double]$MinSpanDays = 7,
  [double]$WindowDays = 30,
  [double]$WarnDays = 30,
  [double]$CriticalDays = 7,
  [double]$LowPct = 20,
  [double]$CriticalPct = 10,
  [switch]$Install,
  [switch]$Remove,
  [switch]$Status,
  [string]$Vps = '',
  [string]$User = '',
  [string]$Root = 'C:\Thornswood-Watch',
  [string]$Task = 'Thornswood Disk History',
  [string]$At = '04:00',
  [switch]$NoPause
)
$ErrorActionPreference = 'Stop'

# ------------------------------------------------- from this machine ---
if ($Install -or $Remove -or $Status) {
  $Here = $PSScriptRoot
  if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
  . (Join-Path $Here 'Vps.ps1')
  . (Join-Path $Here 'Send-Script.ps1')
  . (Join-Path $Here 'Lock-Folder.ps1')
  if (-not $User) { $User = Get-ThornswoodVpsUser }
  if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
  $ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
  function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
  function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
  function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
  if ($At -notmatch '^\d\d:\d\d$') { Say ('STOP. -At takes a time like 04:00, not ' + $At) 'Red'; Done 1 }
  $boxScript = "$Root\forecast-storage.ps1"
  $boxHistory = "$Root\disk-history.jsonl"
  $boxAlerts = "$Root\alerts.jsonl"
  $run = "pwsh -NoProfile -ExecutionPolicy Bypass -File $boxScript -Record -History $boxHistory -Alerts $boxAlerts"
  $said = @()

  if ($Remove) {
    Head 'Taking the daily sample off'
    $said = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script @"
`$ErrorActionPreference = 'Continue'
`$null = & schtasks /delete /tn '$Task' /f 2>&1
if (`$LASTEXITCODE -eq 0) { 'the task is gone' } else { 'there was no task called $Task' }
'the history is still at $boxHistory'
"@)
    foreach ($l in $said) { Say "  $l" }
    Done 0
  }

  if ($Install) {
    Head 'Checking it parses before sending it'
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count) { $errs | Select-Object -First 5 | ForEach-Object { Say ('  ' + $_.Message) 'Red' }; Say 'STOP. Nothing was sent.' 'Red'; Done 1 }
    Say '  Forecast-Storage.ps1 parses' 'Green'
    Head 'Putting it on the server'
    # Sent as base64 and written out byte for byte, as Watch-Load.ps1 does.
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($PSCommandPath))
    $said = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script @"
`$ErrorActionPreference = 'Continue'
$(Get-ThornswoodLockedFolderScript $Root)
[IO.File]::WriteAllBytes('$boxScript', [Convert]::FromBase64String('$b64'))
'wrote     $boxScript  ' + (Get-Item '$boxScript').Length + ' bytes'
`$null = & schtasks /create /tn '$Task' /sc daily /st $At /ru SYSTEM /rl HIGHEST /f /tr '$run' 2>&1
if (`$LASTEXITCODE -eq 0) { 'made      the task, daily at $At' } else { 'FAILED    schtasks exited with ' + `$LASTEXITCODE }
`$before = 0
if (Test-Path '$boxHistory') { `$before = @(Get-Content '$boxHistory').Count }
`$null = & schtasks /run /tn '$Task' 2>&1
Start-Sleep -Seconds 15
`$after = 0
if (Test-Path '$boxHistory') { `$after = @(Get-Content '$boxHistory').Count }
if (`$after -gt `$before) { 'sampled   ' + `$after + ' line(s) in $boxHistory'; Get-Content '$boxHistory' | Select-Object -Last 1 | ForEach-Object { '  ' + `$_ } }
else { 'FAILED    the first run added no line to $boxHistory' }
if (Get-ScheduledTask -TaskName '$Task' -EA SilentlyContinue) { 'task      $Task is registered' } else { 'FAILED    there is no task called $Task after making it' }
"@)
    $failed = $false
    foreach ($l in $said) {
      $c = 'Gray'
      if ("$l" -match '^FAILED') { $c = 'Red'; $failed = $true }
      if ("$l" -match '^(wrote|made|sampled)') { $c = 'Green' }
      Say "  $l" $c
    }
    $text = (@($said) | ForEach-Object { "$_" }) -join "`n"
    if ($text -notmatch '(?m)^made\s') { $failed = $true; Say '  the server never said it made the task' 'Red' }
    if ($text -notmatch '(?m)^task\s+.* is registered') { $failed = $true; Say '  the server never said the task is registered' 'Red' }
    if ($failed) { Say 'STOP. The daily sample did not take on the box. Read the lines above, then run -Install again.' 'Red'; Done 1 }
    Head 'From now on'
    Say '  One sample a day. It forecasts once it has 14 samples over 7 days; until then it says not-enough-data.' 'DarkGray'
    Say '  Run this with -Status to read the forecast.' 'DarkGray'
    Done 0
  }

  Head 'The daily sample'
  $said = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script @"
`$ErrorActionPreference = 'Continue'
`$t = Get-ScheduledTask -TaskName '$Task' -EA SilentlyContinue
if (`$t) { `$i = Get-ScheduledTaskInfo -TaskName '$Task'; 'task      ' + `$t.State + ', last ran ' + `$i.LastRunTime + ', result ' + `$i.LastTaskResult }
else { 'task      NOT installed. Run this with -Install' }
if (Test-Path '$boxScript') { & pwsh -NoProfile -ExecutionPolicy Bypass -File '$boxScript' -History '$boxHistory' 2>&1 | ForEach-Object { "`$_" }; 'exit      ' + `$LASTEXITCODE }
else { 'script    NOT on the box. Run this with -Install' }
"@)
  foreach ($l in $said) {
    $c = 'Gray'
    if ("$l" -match 'NOT installed|NOT on the box|verdict\s+critical') { $c = 'Red' }
    elseif ("$l" -match 'verdict\s+warning') { $c = 'Yellow' }
    Say "  $l" $c
  }
  Done 0
}

# --------------------------------------------------------- on the box ---
$when = if ($Now) { [datetime]::Parse($Now, [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime() } else { [datetime]::UtcNow }
if (-not $State) { $State = Join-Path (Split-Path -Parent $History) 'disk-forecast.txt' }

# One message into the watchdog's outbox, the shape Watch-Services.ps1 Tell
# writes, appended whole with its line ending so the bot never reads half.
function Tell([string]$kind, [string]$text) {
  $id = $when.ToLocalTime().ToString('yyyyMMddHHmmss') + '-diskforecast-' + $kind
  if ($text.Length -gt 1900) { $text = $text.Substring(0, 1900) }
  $row = [ordered]@{ id = $id; at = ([DateTimeOffset]$when).ToUnixTimeSeconds(); service = 'disk forecast'; kind = $kind; text = $text } | ConvertTo-Json -Compress
  $dir = Split-Path -Parent $Alerts
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  [IO.File]::AppendAllText($Alerts, $row + "`r`n", (New-Object Text.UTF8Encoding($false)))
  return $id
}

if ($TestAlert) {
  if (-not $Alerts) { Write-Output 'STOP. -TestAlert needs -Alerts, the outbox to write to.'; exit 3 }
  $id = Tell 'test' '**Test of the disk forecast alert.** Nothing is wrong with the disk. This checks that a forecast warning reaches the staff channel.'
  Write-Output ('told      ' + $id + ' into ' + $Alerts)
  exit 0
}

if ($Record) {
  if ($FreeBytes -lt 0 -or $TotalBytes -le 0) {
    $d = Get-PSDrive -Name $Drive -PSProvider FileSystem
    $FreeBytes = [double]$d.Free; $TotalBytes = [double]$d.Used + [double]$d.Free
  }
  $dir = Split-Path -Parent $History
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $line = [ordered]@{ t = $when.ToString('o'); drive = $Drive; total = $TotalBytes; free = $FreeBytes } | ConvertTo-Json -Compress
  Add-Content -LiteralPath $History -Value $line -Encoding utf8
}

$samples = @()
if (Test-Path -LiteralPath $History) {
  try {
    foreach ($l in Get-Content -LiteralPath $History) {
      if (-not $l.Trim()) { continue }
      $o = $l | ConvertFrom-Json
      if ($o.drive -ne $Drive) { continue }
      $samples += [pscustomobject]@{ t = ([datetime]$o.t).ToUniversalTime(); total = [double]$o.total; free = [double]$o.free }
    }
  } catch { Write-Output ('history unreadable: ' + $History + ': ' + $_.Exception.Message); exit 3 }
}
$samples = @($samples | Where-Object { $_.t -ge $when.AddDays(-$WindowDays) -and $_.t -le $when } | Sort-Object t)

# The forecast: one verdict, why, and the days to each line where known.
$verdict = ''; $why = ''; $dLow = $null; $dCrit = $null; $code = 0
if ($samples.Count -eq 0) { $verdict = 'not-enough-data'; $why = 'no samples yet' }
else {
  $last = $samples[-1]
  $pct = 100.0 * $last.free / $last.total
  $span = ($last.t - $samples[0].t).TotalDays
  if ($pct -lt $CriticalPct) { $verdict = 'critical'; $code = 2; $dCrit = 0; $why = 'already ' + [math]::Round($pct, 1) + '% free, under ' + $CriticalPct + '%. Staff: clear old logs, uploads or payloads today.' }
  elseif ($samples.Count -lt $MinSamples -or $span -lt $MinSpanDays) {
    $verdict = 'not-enough-data'; $why = 'one snapshot is not a forecast; now ' + [math]::Round($pct, 1) + '% free over ' + [math]::Round($span, 1) + ' days of samples'
  } else {
    # Least squares: free bytes against days.
    $n = $samples.Count; $sx = 0.0; $sy = 0.0; $sxx = 0.0; $sxy = 0.0
    foreach ($s in $samples) { $x = ($s.t - $samples[0].t).TotalDays; $sx += $x; $sy += $s.free; $sxx += $x * $x; $sxy += $x * $s.free }
    $den = $n * $sxx - $sx * $sx
    $slope = if ($den -ne 0) { ($n * $sxy - $sx * $sy) / $den } else { 0 }
    if ($slope -ge 0) { $verdict = 'no-growth'; $why = 'free space is flat or rising; now ' + [math]::Round($pct, 1) + '% free' }
    else {
      $burn = -$slope
      $dLow = [math]::Max(0, [math]::Round(($last.free - $last.total * $LowPct / 100) / $burn, 1))
      $dCrit = [math]::Round(($last.free - $last.total * $CriticalPct / 100) / $burn, 1)
      $why = 'now ' + [math]::Round($pct, 1) + '% free, losing ' + [math]::Round($burn / 1GB, 2) + ' GB a day'
      if ($dCrit -le $CriticalDays) { $verdict = 'critical'; $code = 2; $why += '. Staff: clear old logs, uploads or payloads today.' }
      elseif ($dCrit -le $WarnDays -or $dLow -le $CriticalDays) { $verdict = 'warning'; $code = 1; $why += '. Installer lane: plan cleanup or retention this week.' }
      else { $verdict = 'ok' }
    }
  }
}

Write-Output ('verdict   ' + $verdict)
Write-Output ('why       ' + $why)
Write-Output ('samples   ' + $samples.Count + ' in the last ' + $WindowDays + ' days (need ' + $MinSamples + ' over ' + $MinSpanDays + ' days)')
if ($null -ne $dLow) { Write-Output ('to ' + $LowPct + '%    ' + $dLow + ' days') }
if ($null -ne $dCrit) { Write-Output ('to ' + $CriticalPct + '%    ' + $dCrit + ' days') }
Write-Output ('assumes   linear growth over the window, no bulk deletes, same drive size; horizon ' + $WarnDays + ' days')

# Tell staff when the level turns. ok and no-growth are one level, quiet;
# not-enough-data is no level at all and leaves the last one standing.
if ($Alerts -and $verdict -ne 'not-enough-data') {
  $level = if ($verdict -eq 'warning' -or $verdict -eq 'critical') { $verdict } else { 'ok' }
  $was = 'ok'
  if (Test-Path -LiteralPath $State) { $r = ('' + (Get-Content -LiteralPath $State -TotalCount 1)).Trim(); if ($r) { $was = $r } }
  if ($level -ne $was) {
    $days = ''
    if ($null -ne $dCrit) { $days = ' At this rate it reaches ' + $CriticalPct + '% free in ' + $dCrit + ' days' + $(if ($null -ne $dLow) { ' and ' + $LowPct + '% in ' + $dLow + ' days' } else { '' }) + '.' }
    $from = ' Forecast from ' + $samples.Count + ' daily samples.'
    $id = $null
    if ($level -eq 'critical') { $id = Tell 'critical' ('**Free disk space on the VPS runs out within a week.** ' + $why + $days + $from) }
    elseif ($level -eq 'warning') {
      if ($was -eq 'critical') { $id = Tell 'eased' ('**The disk forecast eased from critical to warning.** ' + $why + $days + $from) }
      else { $id = Tell 'warning' ('**Free disk space on the VPS is on course to run low within a month.** ' + $why + $days + $from) }
    }
    else { $id = Tell 'back' ('**The disk forecast is fine again.** ' + $why + '.' + $from) }
    Set-Content -LiteralPath $State -Value $level -Encoding ASCII
    Write-Output ('told      ' + $id + ' (was ' + $was + ', now ' + $level + ')')
  }
}
exit $code
