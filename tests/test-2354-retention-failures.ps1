<#
  test-2354-retention-failures.ps1

      pwsh -NoProfile -File .\tests\test-2354-retention-failures.ps1

  Issue #2354: the deletes that keep backups to what site/data/site/privacy.md
  promises threw their failures away and logged success. A backup past seven
  daily and four weekly that would not delete was logged "dropped", the task
  ended 0, and Watch-Services.ps1 saw nothing; the copies fetched to the
  operator's machine did the same past 30 days.

  This makes a delete really fail, by holding the oldest backup open with no
  sharing while the real script runs, and reads what is said:

    - vps-nightly-backup.ps1 names the file it could not drop and the kind of
      error, never logs it as dropped, writes it to retention-failed.txt, and
      ends non-zero, while tonight's backup is still made and the other old
      copies still go
    - run again with the file let go, it drops it, removes
      retention-failed.txt and ends 0
    - Watch-Services.ps1's BackupProblem, as the box gets it, says retention is
      failing and names the file while retention-failed.txt is there, and
      nothing once it is gone
    - Fetch-Backups.ps1 -PruneOnly names the copy it could not drop, never
      logs it as dropped, and ends non-zero; then 0 once it goes

  The scripts run under PowerShell 7, which is what runs them on the VPS
  since #5356, and only on Windows. Touches nothing but a scratch folder under the temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Vps = Join-Path (Split-Path -Parent $Here) 'scripts\vps'
$Nightly = Join-Path $Vps 'vps-nightly-backup.ps1'
$Fetch   = Join-Path $Vps 'Fetch-Backups.ps1'
$Watch   = Join-Path $Vps 'Watch-Services.ps1'

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

foreach ($f in $Nightly, $Fetch, $Watch) {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errors)
    Yes ((Split-Path -Leaf $f) + ' parses') ($errors.Count -eq 0)
}

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the runs: a copy that will not go is one held open, which only Windows'' share modes keep, and the nightly backup stages under Windows'' TEMP with \ between folders'
    Done
}
$boxPs = Get-BoxPowerShell

$script:last = @()
function Run([string]$file, [string[]]$argv) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $script:last = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file @argv 2>&1 | ForEach-Object { "$_" }) }
    finally { $ErrorActionPreference = $eap }
    return $LASTEXITCODE
}
function Show { foreach ($l in $script:last | Select-Object -Last 30) { Write-Host ('        ' + $l) } }
function Said([string]$pattern) { return (($script:last -join "`n") -match $pattern) }
function Put([string]$path, [string]$text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text)
}
# Open with no sharing, which is what makes Windows refuse the delete.
function Hold([string]$path) { return [IO.File]::Open($path, 'Open', 'Read', 'None') }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2354-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void](New-Item -ItemType Directory -Path $work)
$held = $null
try {
    # ---- the nightly backup on the box ----------------------------------------
    $out = Join-Path $work 'backup'
    $seeded = @()
    $d = [datetime]'2025-03-03'
    while ($seeded.Count -lt 10) {
        if ($d.DayOfWeek -ne 'Sunday') {
            $n = 'thornswood-' + $d.ToString('yyyyMMdd') + '-031500.zip'
            Put (Join-Path $out $n) 'old'
            $seeded += $n
        }
        $d = $d.AddDays(1)
    }
    $oldest = $seeded[0]
    $second = $seeded[1]
    $site = Join-Path $work 'site'
    Put (Join-Path $site 'data\linked.json') '{}'
    $common = @('-GameRoot', (Join-Path $work 'no-game'), '-DevGameRoot', (Join-Path $work 'no-dev'),
                '-SiteRoot', $site, '-BotRoot', (Join-Path $work 'no-bot'),
                '-CaddyRoot', (Join-Path $work 'no-caddy'), '-VoiceRoot', (Join-Path $work 'no-voice'), '-DeletionRoot', (Join-Path $work 'no-del'),
                '-Out', $out, '-Plain')
    $failedList = Join-Path $out 'retention-failed.txt'

    $held = Hold (Join-Path $out $oldest)
    $code = Run $Nightly $common
    $held.Dispose(); $held = $null
    $logText = [IO.File]::ReadAllText((Join-Path $out 'backup.log'))
    Yes "with the oldest held open, the nightly ends non-zero (exit $code)" ($code -ne 0)
    Yes '  and says it did not drop that one, with the kind of error' (
        $logText -match ('NOT DROPPED ' + [regex]::Escape($oldest) + ': IOException'))
    Yes '  and never logs it as dropped' (-not ($logText -cmatch ('dropped\s+' + [regex]::Escape($oldest))))
    Yes '  and names it in retention-failed.txt' (
        (Test-Path -LiteralPath $failedList) -and ([IO.File]::ReadAllText($failedList) -match [regex]::Escape($oldest)))
    Yes '  and the run says retention failed and that the backup itself was made' (Said 'Retention failed: 1 backup')
    $made = @(Get-ChildItem -LiteralPath $out -File | Where-Object { $_.Name -match '^thornswood-\d{8}-\d{6}\.zip$' -and $seeded -notcontains $_.Name })
    Yes '  while tonight''s backup was still made' ($made.Count -eq 1)
    Yes '  and the other old copies still went' (-not (Test-Path -LiteralPath (Join-Path $out $second)) -and ($logText -match ('dropped\s+' + [regex]::Escape($second))))
    Yes '  and the held one is still there, which is what it said' (Test-Path -LiteralPath (Join-Path $out $oldest))
    if ($code -eq 0) { Show }

    # ---- what the watcher on the box says about it ----------------------------
    $errs = $null
    $outer = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $Watch).Path, [ref]$null, [ref]$errs)
    $assign = $outer.Find({ param($a)
        $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$watcher' }, $true)
    $text = $null
    if ($assign) {
        $str = $assign.Right.Find({ param($a) $a -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true)
        if ($str) { $text = $str.Value }
    }
    $fn = $null
    if ($text) {
        $inner = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$null)
        $fn = $inner.Find({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'BackupProblem' }, $true)
    }
    Yes 'BackupProblem is in the watcher the box gets' ($null -ne $fn)
    if ($fn) {
        # The task is there and last ran clean, so only retention can answer.
        $ask = [scriptblock]::Create(@'
function Get-ScheduledTask { param($TaskName, $ErrorAction) return @{ TaskName = $TaskName } }
function Get-ScheduledTaskInfo { param($TaskName, $ErrorAction) return @{ LastTaskResult = 0; LastRunTime = (Get-Date) } }
$now = Get-Date
'@ + "`n" + $fn.Extent.Text + "`n" + 'BackupProblem ''Thornswood Backup'' $args[0] 26')
        $why = & $ask $out
        Yes "  while a copy will not go, it says retention is failing and names it ($why)" (
            ($why -match '^retention is failing: 1 backup') -and ($why -match [regex]::Escape($oldest)))
    }

    $code = Run $Nightly $common
    $logText = [IO.File]::ReadAllText((Join-Path $out 'backup.log'))
    Yes "let go, the next run drops it and ends 0 (exit $code)" ($code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $out $oldest)))
    Yes '  and retention-failed.txt is gone, and the log says so' (
        -not (Test-Path -LiteralPath $failedList) -and ($logText -match 'retention-failed.txt is gone'))
    if ($code -ne 0) { Show }
    if ($fn) {
        $why = & $ask $out
        Yes "  and the watcher has nothing to say about it ($why)" ($why -eq '')
    }

    # ---- the copies fetched to this machine -----------------------------------
    $here = Join-Path $work 'fetched'
    $today = Get-Date
    $names = @()
    foreach ($i in 0..1) { $names += 'thornswood-' + $today.AddDays(-$i).ToString('yyyyMMdd') + '-031500.zip.enc' }
    foreach ($i in 0..8) { $names += 'thornswood-' + $today.AddDays(-60 - $i).ToString('yyyyMMdd') + '-031500.zip.enc' }
    foreach ($n in $names) { Put (Join-Path $here $n) 'x' }
    $oldestHere = ($names | Sort-Object)[0]
    $held = Hold (Join-Path $here $oldestHere)
    $code = Run $Fetch @('-To', $here, '-KeepDays', '30', '-PruneOnly', '-NoPause')
    $held.Dispose(); $held = $null
    $fetchLog = [IO.File]::ReadAllText((Join-Path $here 'fetch.log'))
    Yes "Fetch-Backups.ps1 -PruneOnly with the oldest held open ends non-zero (exit $code)" ($code -ne 0)
    Yes '  and says it did not drop that one, with the kind of error' (
        $fetchLog -match ('NOT DROPPED ' + [regex]::Escape($oldestHere) + ': IOException'))
    Yes '  and never logs it as dropped' (-not ($fetchLog -cmatch ('dropped ' + [regex]::Escape($oldestHere))))
    $code = Run $Fetch @('-To', $here, '-KeepDays', '30', '-PruneOnly', '-NoPause')
    Yes "  let go, the next run drops it and ends 0 (exit $code)" ($code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $here $oldestHere)))
    if ($code -ne 0) { Show }
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message) $false
    Show
}
finally {
    if ($held) { $held.Dispose() }
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}
Done
