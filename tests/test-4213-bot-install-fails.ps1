<#
  test-4213-bot-install-fails.ps1

      pwsh -NoProfile -File .\tests\test-4213-bot-install-fails.ps1

  A full Install-Bot.ps1 run that could not do part of its work finished
  green (issue #4213). Install-ThornswoodBotService (scripts\vps\Bot-Service.ps1)
  added every line its steps gave back and returned Ok true whatever they
  said: a lock or a grant on the bot's folders that was refused (COULD NOT
  LOCK, COULD NOT GRANT), the old scheduled task still registered beside the
  new service (COULD NOT REMOVE), a record left beside the code (COULD NOT
  MOVE). Install-Bot printed those lines in grey, saved the deploy record and
  exited 0. A service that was not installed at all exited 0 as well.

  WHAT IT CHECKS.
    the install   Install-ThornswoodBotService against stand-ins for the
                  service manager, the task scheduler, the compiler and the
                  grants, so it runs on any machine: a clean run is Ok, and
                  each of those failures makes it not Ok while the service it
                  put in is still started and says so (Started), with a last
                  line that counts what did not go on. A service that does
                  not start is not Started.
    the verdict   Get-ThornswoodBotInstallVerdict, which Install-Bot reads
                  the full run's lines with: the COULD NOT lines and the not
                  installed lines are the ones shown in red, and either gives
                  a reason to stop; a line the bot itself wrote is not one.
    Install-Bot   reads Bot-Service.ps1 here as well as sending it, shows the
                  full run's lines with the verdict's colour, saves the
                  deploy record only with no reason to stop, and stops (exit
                  1) with that reason.

  Never touches a real service, task or folder rule. Writes only under its
  own scratch folder in the system temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$svcLib = Join-Path (Join-Path (Join-Path $repo 'scripts') 'vps') 'Bot-Service.ps1'
$ibPath = Join-Path (Join-Path (Join-Path $repo 'scripts') 'deploy') 'Install-Bot.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-4213-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $tmp

. $svcLib

# ------------------------------------------------------------ stand-ins ---
# Defined after Bot-Service.ps1, so its functions find these first.
$script:svc = $null
$script:task = $true
$script:taskStays = $false
$script:startFails = $false
$script:grantSays = @()
$script:moveSays = @()
$script:calls = @()
$ThornswoodNotHeld = @()
$ThornswoodStillRunning = @()
function Test-ThornswoodBotPython([string]$Python, [string]$LibDir) { return @() }
function Build-ThornswoodBotHost([string]$Source, [string]$Out) { [IO.File]::WriteAllText($Out, 'program'); return @{ Ok = $true; Lines = @() } }
function Get-Service { [CmdletBinding()] param([string]$Name) return $script:svc }
function Stop-Service { [CmdletBinding()] param([string]$Name, [switch]$Force) $script:calls += 'Stop-Service'; $script:svc = [pscustomobject]@{ Name = $Name; Status = 'Stopped' } }
function Start-Service { [CmdletBinding()] param([string]$Name)
    $script:calls += 'Start-Service'
    if ($script:startFails) { throw 'The service did not respond to the start request' }
    $script:svc = [pscustomobject]@{ Name = $Name; Status = 'Running' } }
function New-Service { [CmdletBinding()] param([string]$Name, [string]$BinaryPathName, [string]$DisplayName, [string]$StartupType, [string]$Description)
    $script:svc = [pscustomobject]@{ Name = $Name; Status = 'Stopped' } }
function sc.exe { $global:LASTEXITCODE = 0; 'SUCCESS' }
function Get-ScheduledTask { [CmdletBinding()] param([string]$TaskName) if ($script:task) { return [pscustomobject]@{ TaskName = $TaskName } } }
function Stop-ScheduledTask { [CmdletBinding()] param([string]$TaskName) }
function Unregister-ScheduledTask { [CmdletBinding()] param([string]$TaskName, [switch]$Confirm) if (-not $script:taskStays) { $script:task = $false } }
function Get-CimInstance { [CmdletBinding()] param([Parameter(Position = 0)][string]$ClassName, [string]$Filter)
    if ($ClassName -eq 'Win32_Service') { return [pscustomobject]@{ State = 'Running'; StartName = 'NT SERVICE\ThornswoodBot'; ProcessId = 0 } }
    return @() }
function Get-ThornswoodProcessHeld([int[]]$Ids) { @() }
function Stop-ThornswoodProcessHeld($Held) { }
function Get-ThornswoodPathHolders([string]$Path) { 'nothing' }
function Test-ThornswoodEventSource([string]$Name) { return $true }
function Set-ThornswoodHold { param($Target, $Why, $By, $Root) }
function Clear-ThornswoodHold { param($Target, $Root) }
function Move-ThornswoodBotRecords([string]$Root) { $script:moveSays }
function Grant-ThornswoodBotAccess { param([string]$Sid, [string]$Root, [string]$WatchRoot, [string]$DocsData, [string[]]$ServerRoots = @()) $script:grantSays }

function Install([string]$name) {
    $root = Join-Path $tmp $name
    $null = New-Item -ItemType Directory -Force -Path $root
    [IO.File]::WriteAllText((Join-Path $root 'run.ps1'), 'x')
    $script:calls = @()
    $src = Join-Path $root 'BotService.cs'
    [IO.File]::WriteAllText($src, '// source')
    $r = Install-ThornswoodBotService -Name 'ThornswoodBot' -Root $root -Python 'python' -Source $src -Task 'Thornswood Bot' -WatchRoot '' -DocsData '' -ServerRoots @()
    return @{ R = $r; Text = (@($r.Lines) -join "`n"); Started = ($script:calls -contains 'Start-Service') }
}
function Reset { $script:svc = $null; $script:task = $true; $script:taskStays = $false; $script:startFails = $false; $script:grantSays = @(); $script:moveSays = @() }

try {
    # ======================================================== the install ===
    Reset
    $script:grantSays = @('the bot''s folder takes nothing from C:\ and no Users rule reaches it: X')
    $x = Install 'clean'
    Yes ('a clean install is Ok' + $(if (-not $x.R.Ok) { ': ' + $x.Text } else { '' })) ([bool]$x.R.Ok -and $x.Started)
    Yes '  and says no COULD NOT' ($x.Text -notmatch 'COULD NOT')

    $cases = @(
        @{ Name = 'lock';  What = 'a lock on the bot''s folder that was refused'; Grant = @('COULD NOT LOCK C:\Thornswood-Bot: Attempted to perform an unauthorized operation.'); Line = 'COULD NOT LOCK C:\\Thornswood-Bot' },
        @{ Name = 'hooks'; What = 'a lock on the webhooks folder that was refused'; Grant = @('the bot''s folder takes nothing from C:\: X', 'COULD NOT LOCK C:\Thornswood-Bot\webhooks: denied'); Line = 'COULD NOT LOCK C:\\Thornswood-Bot\\webhooks' },
        @{ Name = 'grant'; What = 'a grant that was refused'; Grant = @('COULD NOT GRANT the bot''s account Modify, the one folder it writes, on C:\Thornswood-Bot\data: denied'); Line = 'COULD NOT GRANT the bot''s account Modify' },
        @{ Name = 'move';  What = 'a record left beside the code'; Move = @('COULD NOT MOVE C:\Thornswood-Bot\joins.json: in use'); Line = 'COULD NOT MOVE C:\\Thornswood-Bot\\joins\.json' },
        @{ Name = 'task';  What = 'the old scheduled task still registered'; TaskStays = $true; Line = 'COULD NOT REMOVE the old scheduled task Thornswood Bot' })
    foreach ($c in $cases) {
        Reset
        if ($c.Grant) { $script:grantSays = $c.Grant }
        if ($c.Move) { $script:moveSays = $c.Move }
        if ($c.TaskStays) { $script:taskStays = $true }
        $x = Install $c.Name
        Yes ($c.What + ' makes the install not Ok') (-not $x.R.Ok)
        Yes ('  and its line is in what the install says') ($x.Text -match $c.Line)
        Yes ('  while the service it put in is still started, and says so') ($x.Started -and [bool]$x.R.Started)
        Yes ('  with a last line that says the install did not finish and counts it') (
            @($x.R.Lines)[-1] -match '^THE BOT''S INSTALL DID NOT FINISH: 1 step said COULD NOT')
    }
    Reset
    $script:grantSays = @('COULD NOT LOCK C:\a: x', 'COULD NOT LOCK C:\b: x')
    $script:taskStays = $true
    $x = Install 'three'
    Yes 'three failures are counted as three' (-not $x.R.Ok -and @($x.R.Lines)[-1] -match '^THE BOT''S INSTALL DID NOT FINISH: 3 steps said COULD NOT')

    Reset
    $script:startFails = $true
    $x = Install 'nostart'
    Yes 'a service that does not start is not Ok and not Started' (-not $x.R.Ok -and -not $x.R.Started -and $x.Text -match 'THE SERVICE DID NOT START')

    # ======================================================== the verdict ===
    $v = $null
    try { $v = Get-ThornswoodBotInstallVerdict @('python for the service: x', 'started the service ThornswoodBot', 'service ThornswoodBot: Running, as NT SERVICE\ThornswoodBot') 'ThornswoodBot' } catch { }
    Yes 'the verdict on a clean run: nothing red, no reason to stop' ($v -and @($v.Red).Count -eq 0 -and -not $v.Why)
    $v = $null
    $lines = @('built the service program from BotService.cs', 'COULD NOT LOCK C:\Thornswood-Bot: denied', 'COULD NOT REMOVE the old scheduled task Thornswood Bot',
               'THE BOT''S INSTALL DID NOT FINISH: 2 steps said COULD NOT.', 'service ThornswoodBot: Running, as NT SERVICE\ThornswoodBot',
               '[thornswood-bot] join numbers: COULD NOT DELETE 4 (in use); it is tried again in an hour')
    try { $v = Get-ThornswoodBotInstallVerdict $lines 'ThornswoodBot' } catch { }
    Yes 'the verdict shows each COULD NOT line and the closing line in red' ($v -and @($v.Red).Count -eq 3 -and
        @($v.Red) -contains 'COULD NOT LOCK C:\Thornswood-Bot: denied' -and @($v.Red) -contains 'COULD NOT REMOVE the old scheduled task Thornswood Bot')
    Yes '  but not a line the bot itself wrote' ($v -and @($v.Red | Where-Object { $_ -match '^\[thornswood-bot\]' }).Count -eq 0)
    Yes '  and gives a reason to stop that says the record was not saved' ($v -and $v.Why -match 'did not finish' -and $v.Why -match 'not saved')
    $v = $null
    try { $v = Get-ThornswoodBotInstallVerdict @('CANNOT SWITCH: python was not found on this box', 'Nothing was stopped or changed.', 'BOT SERVICE NOT INSTALLED') 'ThornswoodBot' } catch { }
    Yes 'a service that was not installed is red and a reason to stop too' ($v -and @($v.Red) -contains 'BOT SERVICE NOT INSTALLED' -and $v.Why -match 'not installed')

    # ======================================================== Install-Bot ===
    $ib = Get-Content -LiteralPath $ibPath -Raw
    Yes 'Install-Bot reads Bot-Service.ps1 here too, for the verdict' ($ib -match [regex]::Escape(". (Join-Path `$Here '..\vps\Bot-Service.ps1')"))
    Yes 'the full run says BOT SERVICE NOT INSTALLED only when the service did not start' (
        $ib -match [regex]::Escape("if (-not ```$r.Ok -and -not ```$r.Started) { 'BOT SERVICE NOT INSTALLED'; return }"))
    $at = $ib.IndexOf('$verdict = Get-ThornswoodBotInstallVerdict $running $Service')
    Yes 'Install-Bot reads the full run''s lines with the verdict' ($at -ge 0)
    $tail = if ($at -ge 0) { $ib.Substring($at) } else { '' }
    Yes '  shows them with its colour, red for what it names' ($tail -match [regex]::Escape("`$running | ForEach-Object { if (@(`$verdict.Red) -contains `"`$_`".Trim()) { Say `"  `$_`" 'Red' } else { Say `"  `$_`" } }"))
    Yes '  and no longer prints them all the one way first' ($ib -notmatch [regex]::Escape('$running | ForEach-Object { Say "  $_" }'))
    Yes '  saves the deploy record only with no reason to stop' ($tail -match [regex]::Escape("if (-not `$verdict.Why -and "))
    Yes '  and stops with that reason, exit 1, before the end' ($tail -match [regex]::Escape('if ($verdict.Why) { Die $verdict.Why }') -and
        $tail.IndexOf('if ($verdict.Why) { Die $verdict.Why }') -lt $tail.IndexOf("Read-Host 'Enter to close'"))
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) $false
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
