<#
  Watch-RealClient.ps1

      pwsh scripts\dev\Watch-RealClient.ps1 [-Root <install>] [-IdleMinutes 10]
      pwsh scripts\dev\Watch-RealClient.ps1 -Now [-Root <install>]
      pwsh scripts\dev\Watch-RealClient.ps1 -Install
      pwsh scripts\dev\Watch-RealClient.ps1 -Uninstall

  Starts the real game run (Run-RealClient.ps1, #5197) by itself after each
  dev release, so its results land on the Dev Deployment with nobody at the
  PC, which is #5197's Done when. Until 26 Nov every run was started by hand
  from a session on One.

  Each time it is started (every five minutes, by the task -Install makes) it
  looks once and either starts one run or says why not and stops. It starts a
  run only when all of these hold:

  - the newest Dev Deployment succeeded and carries no "Real game run:" line
    yet, so each release is run once, pass or fail, and never again;
  - no Thornswood launcher and no Skyrim is running, so it never takes over
    somebody's game;
  - the PC is not on the lock screen, where the game can read no key (Patrick
    chose on 26 Nov to keep One unlocked for this, q-5197-locked-one);
  - nobody has touched the keyboard or mouse for -IdleMinutes, so it never
    takes the screen from somebody using the PC;
  - no run it started is still going.

  The run is made from the Deployment's own commit, in a worktree of its own
  that goes afterwards, so its steps are the ones that build's plugin knows.
  Every look is one line in temp\real-client\watch.log of the clone.

  -Now is a look somebody asks for: it skips the wait for an idle PC (26 Nov,
  Patrick: "do it now dont wait"), and they keep off the keyboard and mouse
  while it runs. Every other condition holds as above.

  The task runs this script from worktrees\real-client-watcher, a worktree
  -Install makes and every look first moves to origin/main, so a look is
  always today's rule and never the copy in the shared clone, which other
  work moves and may leave days behind. -Uninstall takes it off again.

  Windows only.
#>
[CmdletBinding()]
param(
    [string]$Root = '',
    [int]$IdleMinutes = 10,
    [string]$Repo = 'ThornswoodRP/Thornswood',
    [switch]$Now,
    [switch]$Install,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$taskName = 'Thornswood real game run'

# What decides a look, apart from Windows, so a harness can ask it anywhere.
# $deployment: { id; state; lines = the descriptions of its statuses }.
# $started: the Deployments this has started a run for, from watch-started.txt,
# so a run that stopped before it could say so on the Deployment is not
# started again every five minutes.
function Get-WatchVerdict($deployment, [string[]]$started, [bool]$gameOpen, [bool]$locked, [double]$idleMinutes, [int]$idleNeeded, [bool]$runGoing) {
    if (-not $deployment) { return 'no Dev Deployment' }
    if ($deployment.state -ne 'success') { return "the newest Dev Deployment is $($deployment.state), not success" }
    if (@($deployment.lines | Where-Object { ([string]$_).StartsWith('Real game run:') }).Count) { return 'the newest Dev Deployment has had its run' }
    if (@($started) -contains [string]$deployment.id) { return 'a run was started for the newest Dev Deployment already; watch.log and its run folder say how it went' }
    if ($runGoing) { return 'a run is still going' }
    if ($gameOpen) { return 'the launcher or the game is open' }
    if ($locked) { return 'the PC is on the lock screen' }
    if ($idleMinutes -lt $idleNeeded) { return ('somebody used the PC {0:0} minute(s) ago' -f $idleMinutes) }
    return 'run'
}

if ($MyInvocation.InvocationName -eq '.') { return }
if ($Now) { $IdleMinutes = 0 }
if (-not $IsWindows) { throw 'Watch-RealClient.ps1 starts the real game, so it runs on Windows only.' }

# The clone every worktree hangs off, also when this copy runs from the
# watcher's own worktree: the folder that holds git's shared directory.
$here = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$common = git -C $here rev-parse --git-common-dir
if ($LASTEXITCODE -ne 0) { throw "$here is not in a git clone" }
$repoRoot = Split-Path -Parent ([IO.Path]::GetFullPath([IO.Path]::Combine($here, $common)))
$watcher = Join-Path $repoRoot 'worktrees\real-client-watcher'

if ($Install -or $Uninstall) {
    $have = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($have) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Host "Took off the task '$taskName'." }
    if ($Uninstall) {
        if (Test-Path -LiteralPath $watcher) {
            git -C $repoRoot worktree remove --force $watcher
            if ($LASTEXITCODE -eq 0) { Write-Host "Took off the worktree $watcher." } else { Write-Host "Could not take off the worktree $watcher; git said why above." }
        }
        return
    }
    if (-not (Test-Path -LiteralPath $watcher)) {
        git -C $repoRoot fetch -q origin main
        if ($LASTEXITCODE -ne 0) { throw 'Could not fetch origin main' }
        git -C $repoRoot worktree add -q --detach $watcher origin/main
        if ($LASTEXITCODE -ne 0) { throw "Could not make the worktree $watcher" }
        Write-Host "Made the worktree $watcher at origin/main; every look moves it to origin/main first."
    }
    $pwsh = (Get-Command pwsh).Source
    $look = "git -C '$watcher' fetch -q origin main; git -C '$watcher' checkout -q --detach origin/main; & '" + (Join-Path $watcher 'scripts\dev\Watch-RealClient.ps1') + "'"
    if ($Root) { $look += " -Root '$Root'" }
    $taskArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $look + '"'
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $taskArgs -WorkingDirectory $repoRoot
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
    # As the person signed in, only while they are: the game needs their
    # desktop, and their gh sign-in publishes the run.
    $who = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $who -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 45) -StartWhenAvailable
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
    Write-Host "Made the task '$taskName': every five minutes, as $who while signed in, it moves $watcher to origin/main, looks once and runs the real game check when a new dev release has not had one."
    return
}

$dir = Join-Path $repoRoot 'temp\real-client'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$watchLog = Join-Path $dir 'watch.log'
$lockFile = Join-Path $dir 'watch.pid'
$startedFile = Join-Path $dir 'watch-started.txt'
function Note([string]$text) { Add-Content -LiteralPath $watchLog -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $text) }

if (-not ('ThornswoodRealClient.Idle' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ThornswoodRealClient {
  public static class Idle {
    [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    public static double Minutes() {
      var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i);
      if (!GetLastInputInfo(ref i)) return 0;
      return unchecked((uint)Environment.TickCount - i.dwTime) / 60000.0;
    }
  }
}
'@
}

try {
    $dep = gh api "repos/$Repo/deployments?environment=Dev&per_page=1" | ConvertFrom-Json | Select-Object -First 1
    if ($LASTEXITCODE -ne 0) { throw 'gh could not read the Dev Deployments' }
    $seen = $null
    if ($dep) {
        $statuses = @(gh api "repos/$Repo/deployments/$($dep.id)/statuses?per_page=100" | ConvertFrom-Json)
        if ($LASTEXITCODE -ne 0) { throw "gh could not read Deployment $($dep.id)'s statuses" }
        $seen = [pscustomobject]@{ id = [string]$dep.id; state = ($statuses | Select-Object -First 1).state; lines = @($statuses | ForEach-Object { $_.description }) }
    }
    $mySession = (Get-Process -Id $PID).SessionId
    $gameOpen = [bool](@(Get-Process -Name Thornswood, SkyrimSE, skse64_loader -ErrorAction SilentlyContinue).Count)
    $locked = [bool](@(Get-Process -Name LogonUI -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $mySession }).Count)
    $runGoing = $false
    if (Test-Path -LiteralPath $lockFile) {
        $was = [int]([IO.File]::ReadAllText($lockFile).Trim())
        $runGoing = [bool](Get-Process -Id $was -ErrorAction SilentlyContinue)
    }
    $idle = [ThornswoodRealClient.Idle]::Minutes()
    $started = @(if (Test-Path -LiteralPath $startedFile) { Get-Content -LiteralPath $startedFile | ForEach-Object { $_.Trim() } | Where-Object { $_ } })
    $verdict = Get-WatchVerdict $seen $started $gameOpen $locked $idle $IdleMinutes $runGoing
    if ($verdict -ne 'run') {
        if ($dep) { Note ("Deployment $($dep.id) ($($dep.payload.release)): not now, " + $verdict + '.') } else { Note ('Not now, ' + $verdict + '.') }
        return
    }

    [IO.File]::WriteAllText($lockFile, [string]$PID)
    Add-Content -LiteralPath $startedFile -Value ([string]$dep.id)
    $tree = Join-Path $repoRoot 'worktrees\real-client-watch'
    if (Test-Path -LiteralPath $tree) { git -C $repoRoot worktree remove --force $tree | Out-Null }
    git -C $repoRoot fetch -q origin $dep.sha
    if ($LASTEXITCODE -ne 0) { git -C $repoRoot fetch -q origin main }
    git -C $repoRoot worktree add -q --detach $tree $dep.sha
    if ($LASTEXITCODE -ne 0) { throw "Could not make a worktree at $($dep.sha)" }
    Note "Deployment $($dep.id) ($($dep.payload.release)): starting the run from $($dep.sha)."
    try {
        $runArgs = @('-NoProfile', '-NonInteractive', '-File', (Join-Path $tree 'scripts\dev\Run-RealClient.ps1'), '-Publish', '-Out', (Join-Path $dir ((Get-Date).ToString('yyyyMMdd-HHmmss'))))
        if ($Root) { $runArgs += @('-Root', $Root) }
        & (Get-Command pwsh).Source @runArgs
        Note "Deployment $($dep.id): the run ended with exit code $LASTEXITCODE."
    } finally {
        git -C $repoRoot worktree remove --force $tree | Out-Null
        Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
    }
} catch {
    Note ('Stopped: ' + $_.Exception.Message)
    throw
}
