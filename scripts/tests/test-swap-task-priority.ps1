<#
  test-swap-task-priority.ps1

      pwsh -NoProfile -File .\scripts\tests\test-swap-task-priority.ps1

  A deploy says when the game server's task is not the one the installer
  makes, and changes nothing in it (#2491).

  WHY. Install-ThornswoodServer.ps1 registers the server's task at priority
  1 with node started through cmd's start /high, so the server runs High
  (Patrick, 12 Oct 2026, #2491). Deploy-Server and Deploy-DevGamemode start
  the server through Swap.ps1's $swapBlock. From 5 Oct (#2015) the block set
  the task's priority to 4 before each start, repairing tasks an older install
  had registered at the default of 7; against the installer's task at 1 it
  would have put the server back to Normal. The installer is the one place the
  task is made, and Publish-Server.ps1 -TaskOnly registers an old one again,
  so the block now says so and leaves the task alone.

  HOW. Swap.ps1 is dot-sourced for $swapBlock. Its TaskShape function is read
  out of it and run against a task registered for the person running this,
  with $Task and $Root set as SwapVars sets them: once at Task Scheduler's
  default priority with a plain action, where it must say the task is not the
  installer's, name the command, and leave the priority and the action as they
  were; and once at priority 1 with the installer's start /high in its action,
  where it must say nothing. NormalTask must be gone, and every
  Start-ScheduledTask in the block must come straight after a TaskShape.

  Registers and removes one task named Thornswood swap priority harness <guid>
  (not 'Thornswood Test...', which test-deploy-swaps and test-install-server
  clear away, #1135). Nothing is started.
#>
[CmdletBinding()]
param([string]$Swap)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $Swap) { $Swap = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Swap.ps1') }

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

. $Swap
Yes 'Swap.ps1 gives $swapBlock' ([bool]$swapBlock)
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($swapBlock, [ref]$t, [ref]$e)
Yes 'the swap block parses' (-not $e -or $e.Count -eq 0)
$fn = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'TaskShape' }, $true))
Yes 'it has a TaskShape step' ($fn.Count -eq 1)
$old = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'NormalTask' }, $true))
Yes 'and no NormalTask, which set the task to priority 4 before every start' ($old.Count -eq 0)
$sets = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -in 'Set-ScheduledTask', 'Register-ScheduledTask', 'Unregister-ScheduledTask' }, $true))
Yes ('the swap block changes no task (' + $sets.Count + ' Set-, Register- or Unregister-ScheduledTask)') ($sets.Count -eq 0)
$lines = @($swapBlock -split "`r?`n" | ForEach-Object { $_.Trim() })
$starts = @(); for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -like 'Start-ScheduledTask -TaskName $Task*') { $starts += $i } }
Yes ('every start of the task comes straight after TaskShape (' + $starts.Count + ' start(s))') (
    $starts.Count -ge 2 -and @($starts | Where-Object { $_ -gt 0 -and $lines[$_ - 1] -eq 'TaskShape' }).Count -eq $starts.Count)
if ($fn.Count -ne 1) { Done }

. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'SKIP  the task part needs Windows and its Task Scheduler'; Done }
Import-Module ScheduledTasks -ErrorAction SilentlyContinue
if (-not (Get-Module ScheduledTasks)) { Write-Host 'SKIP  the ScheduledTasks module did not load'; Done }

$Task = 'Thornswood swap priority harness ' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$Root = 'C:\Thornswood-Server-Dev'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$run = [scriptblock]::Create($fn[0].Extent.Text + "`nTaskShape")
try {
    $a = New-ScheduledTaskAction -Execute (Get-WindowsPath 'System32\cmd.exe') -Argument '/c exit 0' -WorkingDirectory ([IO.Path]::GetTempPath())
    $p = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive
    Register-ScheduledTask -TaskName $Task -Action $a -Principal $p -Settings (New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)) | Out-Null
    $before = Get-ScheduledTask -TaskName $Task
    Yes ('a task registered with no -Priority has Task Scheduler''s default, 7 (' + $before.Settings.Priority + ')') ($before.Settings.Priority -eq 7)

    $said = @(& $run | ForEach-Object { "$_" })
    $said | ForEach-Object { Write-Host ('      ' + $_) }
    $after = Get-ScheduledTask -TaskName $Task
    Yes 'TaskShape says the task is not the installer''s, and why' (
        ($said -join ' ') -match 'not the one the installer makes' -and ($said -join ' ') -match 'priority is 7, not 1' -and ($said -join ' ') -match 'start /high')
    Yes '  and names the command that registers it again, for the dev server here' (($said -join ' ') -match 'Publish-Server\.ps1 -TaskOnly -Channel dev')
    Yes '  and changes nothing: the priority and the action are as they were' (
        $after.Settings.Priority -eq 7 -and $after.Actions[0].Arguments -eq $before.Actions[0].Arguments -and $after.Settings.RestartCount -eq 999)

    # The installer's shape: priority 1 and node through start /high.
    Unregister-ScheduledTask -TaskName $Task -Confirm:$false
    $a = New-ScheduledTaskAction -Execute (Get-WindowsPath 'System32\cmd.exe') -Argument '/c "start "" /b /wait /high "node.exe" dist_back/skymp5-server.js >> "server.log" 2>&1 & call exit %^errorlevel%"' -WorkingDirectory ([IO.Path]::GetTempPath())
    # Priority 1 is above what an account that is not elevated may give a
    # task: a VPS runner is refused here (#1273), the way
    # test-server-task-priority.ps1 is refused its scratch task, and says so.
    $denied = $null
    try { Register-ScheduledTask -TaskName $Task -Action $a -Principal $p -Settings (New-ScheduledTaskSettingsSet -Priority 1) -ErrorAction Stop | Out-Null }
    catch {
        if ($_.Exception.HResult -eq -2147024891 -or $_.Exception.Message -match 'Access is denied') { $denied = $_.Exception.Message } else { throw }
    }
    if ($denied) {
        Write-Host ('SKIP  the installer''s task, priority 1, could not be registered for ' + $me + ': ' + $denied)
    } else {
        $again = @(& $run | ForEach-Object { "$_" })
        Yes ('on the installer''s task, priority 1 and start /high, it says nothing (' + ($again -join ' | ') + ')') ($again.Count -eq 0)
        Yes '  and the task is still at 1' ((Get-ScheduledTask -TaskName $Task).Settings.Priority -eq 1)
    }
}
catch {
    Yes ('the harness ran to the end without an error: ' + $_.Exception.Message) $false
}
finally {
    Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue
}
Done
