<#
  test-4219-freeze-exit.ps1

      pwsh -NoProfile -File .\tests\test-4219-freeze-exit.ps1

  scripts\vps\vps-freeze.ps1 is sent to the old box by Remote.ps1, which
  hands its exit code back (#4219). Until then -Undo printed "started" and
  UNDONE without asking whether anything started, and the freeze ended 0 on
  NOT FROZEN, so whoever ran it read success either way.

  Each case runs the real script in a child pwsh with stand-ins for the
  Windows commands it calls (scheduled tasks, the bot's service, the port
  owners, processes), defined as functions so they are found before any
  real command. Nothing on this machine is started or stopped. The child's
  exit code is the script's.

    1. -Undo, a task that will not start: exit 1, NOT UNDONE naming it
    2. -Undo, the bot's service that will not start: exit 1, NOT UNDONE
    3. -Undo, the watchdog that cannot be enabled: exit 1, NOT UNDONE
    4. -Undo, everything starts: exit 0, UNDONE
    5. a freeze with a process still holding a port: exit 1, NOT FROZEN
    6. a freeze with no backup written: exit 1, NOT FROZEN
    7. a freeze with -NoBackup and nothing left: exit 0, FROZEN

  -ScriptPath runs the cases against another copy of the script, such as
  main's from before the fix.
#>
[CmdletBinding()]
param([string]$ScriptPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
if (-not $ScriptPath) { $ScriptPath = Join-Path (Join-Path (Join-Path $Root 'scripts') 'vps') 'vps-freeze.ps1' }
$Script = $ScriptPath
$pwshExe = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
$script:last = ''
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what"; if ($script:last) { $script:last -split "`n" | ForEach-Object { Write-Host ('      | ' + $_) } } }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-4219-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$child = Join-Path $tmp 'run.ps1'
[IO.File]::WriteAllText($child, @'
param([string]$Target)
$Pass = @{ BackupRoot = $env:TS4219_ROOT }
foreach ($a in ("$env:TS4219_ARGS" -split '\|' | Where-Object { $_ })) { $Pass[$a.TrimStart('-')] = $true }
# Global and named apart from anything in vps-freeze.ps1: a function's
# script: scope here would be the freeze script's own when it calls them.
$global:TsTasks = @{}
foreach ($t in 'Thornswood Watch', 'Thornswood Server', 'Thornswood Dev Server', 'Thornswood Docs', 'Thornswood Voice', 'Thornswood Dev Voice') { $global:TsTasks[$t] = 'Ready' }
$global:TsSvc = @{ Status = 'Stopped' }
function Get-ScheduledTask { [CmdletBinding()] param([string]$TaskName)
  if (-not $global:TsTasks.ContainsKey($TaskName)) { return $null }
  return [pscustomobject]@{ TaskName = $TaskName; State = $global:TsTasks[$TaskName]; Principal = [pscustomobject]@{ UserId = 'LOCAL SERVICE' } }
}
function Start-ScheduledTask { [CmdletBinding()] param([string]$TaskName)
  if ($env:TS4219_TASK -eq $TaskName) { Write-Error ('The task ' + $TaskName + ' could not be started (stand-in)'); return }
  $global:TsTasks[$TaskName] = 'Running'
}
function Stop-ScheduledTask { [CmdletBinding()] param([string]$TaskName) $global:TsTasks[$TaskName] = 'Ready' }
function Enable-ScheduledTask { [CmdletBinding()] param([string]$TaskName)
  if ($env:TS4219_WATCH) { Write-Error 'Access is denied (stand-in)'; return }
  $global:TsTasks[$TaskName] = 'Ready'
}
function Disable-ScheduledTask { [CmdletBinding()] param([string]$TaskName) $global:TsTasks[$TaskName] = 'Disabled' }
function Get-Service { [CmdletBinding()] param([string]$Name) return [pscustomobject]@{ Name = $Name; Status = $global:TsSvc.Status } }
function Start-Service { [CmdletBinding()] param([string]$Name)
  if ($env:TS4219_SVC) { Write-Error 'Service ThornswoodBot cannot be started (stand-in)'; return }
  $global:TsSvc.Status = 'Running'
}
function Stop-Service { [CmdletBinding()] param([string]$Name, [switch]$Force) $global:TsSvc.Status = 'Stopped' }
function Get-NetUDPEndpoint { [CmdletBinding()] param([int]$LocalPort) return @() }
function Get-NetTCPConnection { [CmdletBinding()] param([int]$LocalPort, [string]$State)
  if ($env:TS4219_HOLDER -and $LocalPort -eq 3001) { return @([pscustomobject]@{ OwningProcess = 4242 }) }
  return @()
}
function Get-CimInstance { [CmdletBinding()] param([Parameter(Position = 0)][string]$ClassName) return @() }
function Get-Process { [CmdletBinding()] param([int]$Id) return [pscustomobject]@{ ProcessName = 'node' } }
function Stop-Process { [CmdletBinding()] param([int]$Id, [switch]$Force) }
function Start-Sleep { [CmdletBinding()] param([int]$Milliseconds) }
$global:LASTEXITCODE = 0
& $Target @Pass
exit $LASTEXITCODE
'@)

function Invoke-Freeze([string[]]$pass, [hashtable]$envs = @{}) {
    foreach ($k in 'TS4219_TASK', 'TS4219_SVC', 'TS4219_WATCH', 'TS4219_HOLDER') { Set-Item -Path "env:$k" -Value $(if ($envs.ContainsKey($k)) { $envs[$k] } else { '' }) }
    $backup = Join-Path $tmp ('backup-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    $env:TS4219_ARGS = (@($pass) -join '|'); $env:TS4219_ROOT = $backup
    $out = @(& $pwshExe -NoProfile -NonInteractive -File $child -Target $Script 2>&1 | ForEach-Object { [string]$_ })
    $code = $LASTEXITCODE
    $script:last = ($out -join "`n")
    return [pscustomobject]@{ Code = $code; Out = ($out -join "`n") }
}

try {
    $r = Invoke-Freeze @('-Undo') @{ TS4219_TASK = 'Thornswood Server' }
    Yes "1. -Undo with a task that will not start: exit 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   NOT UNDONE, naming the task, and never UNDONE: the old box serves again' ($r.Out -match 'NOT UNDONE' -and $r.Out -match 'Thornswood Server' -and $r.Out -notmatch 'UNDONE: the old box serves again')

    $r = Invoke-Freeze @('-Undo') @{ TS4219_SVC = '1' }
    Yes "2. -Undo with the bot's service that will not start: exit 1 (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match 'NOT UNDONE' -and $r.Out -match 'ThornswoodBot')

    $r = Invoke-Freeze @('-Undo') @{ TS4219_WATCH = '1' }
    Yes "3. -Undo with a watchdog that cannot be enabled: exit 1 (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match 'NOT UNDONE' -and $r.Out -match 'Thornswood Watch')

    $r = Invoke-Freeze @('-Undo')
    Yes "4. -Undo with everything starting: exit 0, UNDONE (exit $($r.Code))" ($r.Code -eq 0 -and $r.Out -match 'UNDONE: the old box serves again' -and $r.Out -notmatch 'NOT UNDONE')

    $r = Invoke-Freeze @('-NoBackup') @{ TS4219_HOLDER = '1' }
    Yes "5. a freeze with a process still on a port: exit 1, NOT FROZEN (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match 'STILL RUNNING pid 4242' -and $r.Out -match 'NOT FROZEN')

    $r = Invoke-Freeze @()
    Yes "6. a freeze with no backup written: exit 1, NOT FROZEN (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match 'NO BACKUP' -and $r.Out -match 'NOT FROZEN')

    $r = Invoke-Freeze @('-NoBackup')
    Yes "7. a freeze with -NoBackup and nothing left: exit 0, FROZEN (exit $($r.Code))" ($r.Code -eq 0 -and $r.Out -match 'FROZEN: nothing on the old box' -and $r.Out -notmatch 'NOT FROZEN')
} finally {
    foreach ($k in 'TS4219_TASK', 'TS4219_SVC', 'TS4219_WATCH', 'TS4219_HOLDER', 'TS4219_ARGS', 'TS4219_ROOT') { Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
