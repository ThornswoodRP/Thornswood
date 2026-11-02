<#
  test-2061-watch-load-install.ps1

  Issue #2061: the load record was never put on the VPS. There was no
  Thornswood Load task and no load.csv, and nothing had said so. This proves,
  offline, that Watch-Load.ps1 now tells an install that took from one that
  did not, and that -Remove and the report still behave.

  Watch-Load.ps1 is copied into a scratch folder beside stand-ins for Vps.ps1
  and Send-Script.ps1. The stand-in Invoke-ThornswoodRemote records the script
  it was handed and returns canned lines, so nothing here connects to the VPS
  or makes a scheduled task. The scratch folder is removed at the end.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

. (Join-Path $PSScriptRoot 'Windows.ps1')
# The far side runs in PowerShell 7, as on the box since #5356.
$ps = Get-BoxPowerShell

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-test-2061-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$vps = Join-Path $scratch 'vps'
$null = New-Item -ItemType Directory -Path $vps -Force

try {
    foreach ($n in @('Watch-Load.ps1', 'vps-load.ps1', 'Read-Load.ps1', 'Lock-Folder.ps1')) {
        Copy-Item -LiteralPath (Join-Path $Repo "scripts\vps\$n") -Destination $vps
    }
    Set-Content -LiteralPath (Join-Path $vps 'Vps.ps1') -Encoding ASCII -Value @'
function Get-ThornswoodVpsUser { 'tester' }
function Get-ThornswoodVpsAddress { '192.0.2.1' }
'@
    # Each call appends the script it was handed to sent.txt and answers with
    # the canned lines for that kind of call.
    Set-Content -LiteralPath (Join-Path $vps 'Send-Script.ps1') -Encoding ASCII -Value @'
function Invoke-ThornswoodRemote($Target, $SshArgs, $Script) {
  Add-Content -LiteralPath (Join-Path $env:TS2061 'sent.txt') -Value ("==== " + $Target + "`r`n" + $Script) -Encoding ASCII
  $f = Join-Path $env:TS2061 'answer.txt'
  if ($Script -match 'Get-Content -LiteralPath') { $f = Join-Path $env:TS2061 'none.txt' }
  if ($Script -match "Get-Content -LiteralPath '[^']*\\load\.csv'") { $f = Join-Path $env:TS2061 'record.txt' }
  if (Test-Path -LiteralPath $f) { Get-Content -LiteralPath $f }
}
'@
    $env:TS2061 = $scratch
    $watch = Join-Path $vps 'Watch-Load.ps1'

    function Run([string[]]$more, [string[]]$answer) {
        Remove-Item -LiteralPath (Join-Path $scratch 'sent.txt') -ErrorAction SilentlyContinue
        Set-Content -LiteralPath (Join-Path $scratch 'answer.txt') -Value $answer -Encoding ASCII
        $o = (& $ps -NoProfile -ExecutionPolicy Bypass -File $watch -NoPause -Out (Join-Path $scratch 'logs') @more 2>&1 | Out-String)
        $rc = $LASTEXITCODE
        $sent = ''
        if (Test-Path -LiteralPath (Join-Path $scratch 'sent.txt')) { $sent = [IO.File]::ReadAllText((Join-Path $scratch 'sent.txt')) }
        return @{ Rc = $rc; Out = $o; Sent = $sent }
    }

    $good = @(
        'wrote     C:\Thornswood-Watch\load.ps1  12000 bytes',
        'made      the task, every five minutes',
        'first run: 1 line(s) in C:\Thornswood-Watch\load.csv',
        'task      Thornswood Load is registered')

    Write-Host ''
    Write-Host '--- -Install that took' -ForegroundColor Cyan
    $r = Run @('-Install') $good
    Yes 'an install that took exits 0' ($r.Rc -eq 0)
    Yes 'each line the box answers is its own line, not one joined string' ($r.Out -match '(?m)^\s+made\s+the task' -and $r.Out -notmatch 'bytes made')
    Yes 'it went to the configured box as the configured user' ($r.Sent -match '==== tester@192\.0\.2\.1')
    Yes 'it writes the collector as C:\Thornswood-Watch\load.ps1' ($r.Sent -match "WriteAllBytes\('C:\\Thornswood-Watch\\load\.ps1'")
    Yes 'the collector goes byte for byte, as the base64 of vps-load.ps1' ($r.Sent.Contains([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $vps 'vps-load.ps1')))))
    Yes 'it makes Thornswood Load every five minutes as SYSTEM' ($r.Sent -match "/tn 'Thornswood Load' /sc minute /mo 5 /ru SYSTEM")
    Yes 'it runs it once now' ($r.Sent -match "schtasks /run /tn 'Thornswood Load'")
    Yes 'it checks the task is registered afterwards' ($r.Sent -match "Get-ScheduledTask -TaskName 'Thornswood Load'")
    Yes 'it touches no service and not the watchdog' ($r.Sent -notmatch '(?i)(Stop|Start|Restart|Set)-Service|sc\.exe|Thornswood Watch''|watch\.ps1')

    Write-Host ''
    Write-Host '--- -Install that did not take' -ForegroundColor Cyan
    $r = Run @('-Install') @('wrote     C:\Thornswood-Watch\load.ps1  12000 bytes', 'FAILED    schtasks exited with 1', 'FAILED    the first run wrote no load.csv yet', 'FAILED    there is no task called Thornswood Load after making it')
    Yes 'schtasks failing exits non-zero' ($r.Rc -ne 0)
    Yes 'and says STOP' ($r.Out -match 'STOP\. The collector did not take')

    $r = Run @('-Install') @('made      the task, every five minutes', 'task      Thornswood Load is registered', 'FAILED    the first run wrote no load.csv yet')
    Yes 'a first run that wrote no load.csv exits non-zero' ($r.Rc -ne 0)

    $r = Run @('-Install') @()
    Yes 'a box that answers nothing exits non-zero (the 10 Oct case: nothing there, nothing said)' ($r.Rc -ne 0)

    $r = Run @('-Install') @('wrote     C:\Thornswood-Watch\load.ps1  12000 bytes', 'made      the task, every five minutes', 'first run: 1 line(s) in C:\Thornswood-Watch\load.csv')
    Yes 'no word that the task is registered exits non-zero' ($r.Rc -ne 0)

    Write-Host ''
    Write-Host '--- -Remove' -ForegroundColor Cyan
    $r = Run @('-Remove') @('the task is gone', 'the record is still at C:\Thornswood-Watch\load.csv')
    Yes '-Remove exits 0' ($r.Rc -eq 0)
    Yes 'it deletes only Thornswood Load' ($r.Sent -match "schtasks /delete /tn 'Thornswood Load' /f")
    Yes 'and keeps the record' ($r.Sent -notmatch '(?i)Remove-Item|\.Delete\(' -and $r.Out -match 'record is still at')

    Write-Host ''
    Write-Host '--- the report, with no switches' -ForegroundColor Cyan
    $csv = Join-Path $scratch 'made.csv'
    $null = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $vps 'vps-load.ps1') -Root (Join-Path $scratch 'w') 2>&1
    Start-Sleep -Milliseconds 1200
    $null = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $vps 'vps-load.ps1') -Root (Join-Path $scratch 'w') 2>&1
    Copy-Item -LiteralPath (Join-Path $scratch 'w\load.csv') -Destination (Join-Path $scratch 'record.txt')
    $r = Run @() @('task      Ready, last ran now, result 0', 'record    1 KB')
    Yes 'the report brings the record down and reads it, exit 0' ($r.Rc -eq 0 -and (Test-Path -LiteralPath (Join-Path $scratch 'logs\load.csv')))
    Yes 'it keeps the header and both lines' (@(Get-Content -LiteralPath (Join-Path $scratch 'logs\load.csv')).Count -eq 3)
    Remove-Item -LiteralPath (Join-Path $scratch 'record.txt')
    $r = Run @() @('task      NOT installed. Run this with -Install', 'record    none yet')
    Yes 'with no record on the box it stops and says to -Install' ($r.Rc -ne 0 -and $r.Out -match 'Run this with -Install first')
}
finally {
    Remove-Item Env:\TS2061 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
