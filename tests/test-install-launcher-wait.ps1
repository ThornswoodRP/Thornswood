<#
  test-install-launcher-wait.ps1

  Issue #1190. Stop-Launcher used to print Closed after a short sleep without
  checking that Launcher\Thornswood.exe could be opened for write. Install-
  Launcher then tried Copy-Item once and a Ship could STOP on a file still
  held by the loader or a scanner.

  What it proves:
    Wait-LauncherExeWritable blocks while a second process holds the exe, and
      returns once that process lets go (under the 15 s deadline)
    Stop-Launcher waits until the exe opens for write before it prints Closed
      when it closed a real launcher process
    Install-Launcher, with the dest exe held for about a second then released,
      puts the new exe in place rather than STOP

  Nothing here closes a real play launcher or touches the Desktop. Everything
  it writes is under its own temp folder.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
# An exe that another process holds cannot be written only under Windows'
# share modes, and the launcher it closes is a Windows program.
if (-not $OnWindows) { Write-Host 'NOT RUN  an exe held open by another process, and a launcher closed and replaced, are Windows'' share modes and a Windows program'; exit 0 }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$close = Join-Path $RepoDir 'scripts\dev\Close-Launcher.ps1'
$install = Join-Path $RepoDir 'scripts\release\Install-Launcher.ps1'
$icon = Join-Path $RepoDir 'launcher\app.ico'
$ps = (Get-Process -Id $PID).Path

Yes 'Close-Launcher.ps1 is in the repo' (Test-Path -LiteralPath $close)
Yes 'Install-Launcher.ps1 is in the repo' (Test-Path -LiteralPath $install)
Yes 'launcher app.ico is in the repo' (Test-Path -LiteralPath $icon)

. $close

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-install-wait-' + [Guid]::NewGuid().ToString('N'))
$root = Join-Path $work 'root'
$from = Join-Path $work 'from'
$launcherDir = Join-Path $root 'Launcher'
New-Item -ItemType Directory -Force -Path $launcherDir, $from | Out-Null

$destExe = Join-Path $launcherDir 'Thornswood.exe'
$builtExe = Join-Path $from 'Thornswood.exe'
Set-Content -LiteralPath $destExe -Value 'OLD-LAUNCHER-BYTES' -Encoding ASCII
Set-Content -LiteralPath $builtExe -Value 'NEW-LAUNCHER-BYTES-1190' -Encoding ASCII
# The two icons the exe embeds, which Build-Launcher.ps1 writes beside it and
# Install-Launcher.ps1 names the shortcuts' icon file from (#887, #4823).
Copy-Item -LiteralPath $icon -Destination (Join-Path $from 'app.ico')
Copy-Item -LiteralPath (Join-Path $RepoDir 'launcher\app-dev.ico') -Destination (Join-Path $from 'app-dev.ico')

function Start-Hold([string]$exePath, [string]$readyPath, [string]$scriptPath, [int]$holdMs, [int]$delayMs = 0) {
    $exeEsc = $exePath.Replace('\', '\\')
    $readyEsc = $readyPath.Replace('\', '\\')
    $body = @"
`$ErrorActionPreference = 'Stop'
if ($delayMs -gt 0) { Start-Sleep -Milliseconds $delayMs }
`$fs = [IO.File]::Open('$exeEsc', [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
Set-Content -LiteralPath '$readyEsc' -Value 'held'
Start-Sleep -Milliseconds $holdMs
`$fs.Dispose()
"@
    Set-Content -LiteralPath $scriptPath -Value $body -Encoding ASCII
    if (Test-Path -LiteralPath $readyPath) { Remove-Item -LiteralPath $readyPath -Force }
    return Start-Process -FilePath $ps -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile', '-File', $scriptPath)
}

function Wait-Ready([string]$readyPath, [int]$sec = 5) {
    $deadline = [datetime]::UtcNow.AddSeconds($sec)
    while (-not (Test-Path -LiteralPath $readyPath) -and [datetime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 40
    }
    return (Test-Path -LiteralPath $readyPath)
}

$ready = Join-Path $work 'held-ready.txt'

# ---- Wait-LauncherExeWritable while a second process holds the exe -----------
$holder = Start-Hold $destExe $ready (Join-Path $work 'hold-brief.ps1') 1000
Yes 'holder process opened the exe' (Wait-Ready $ready)
Yes 'exe is not writable while held' (-not (Test-LauncherExeWritable -Path $destExe))

$sw = [Diagnostics.Stopwatch]::StartNew()
$waitOk = Wait-LauncherExeWritable -Path $destExe -DeadlineSec 15
$waitMs = $sw.ElapsedMilliseconds
Yes 'Wait-LauncherExeWritable returns true after the holder releases' $waitOk
Yes 'Wait-LauncherExeWritable blocked for about a second (not an instant pass)' ($waitMs -ge 700)
Yes 'exe is writable after the wait' (Test-LauncherExeWritable -Path $destExe)
Wait-Process -Id $holder.Id -Timeout 10 -ErrorAction SilentlyContinue | Out-Null

# ---- Stop-Launcher with no process: waits, does not print Closed ------------
$holder2 = Start-Hold $destExe $ready (Join-Path $work 'hold-for-closed.ps1') 1200
Yes 'second holder opened the exe' (Wait-Ready $ready)
$sw = [Diagnostics.Stopwatch]::StartNew()
$stopLines = @()
$null = Stop-Launcher -Root $root *>&1 | ForEach-Object { $stopLines += [string]$_ }
$stopMs = $sw.ElapsedMilliseconds
$joined = ($stopLines -join "`n")
Yes 'Stop-Launcher waited while the exe was held (~1s+)' ($stopMs -ge 700)
Yes 'Stop-Launcher did not print Closed when nothing was closed' ($joined -notmatch '(?m)^\s*Closed\s*$')
Yes 'exe writable after Stop-Launcher wait' (Test-LauncherExeWritable -Path $destExe)
Wait-Process -Id $holder2.Id -Timeout 10 -ErrorAction SilentlyContinue | Out-Null

# ---- Install-Launcher succeeds when dest is held briefly then released ------
Set-Content -LiteralPath $destExe -Value 'OLD-LAUNCHER-BYTES' -Encoding ASCII
Set-Content -LiteralPath $builtExe -Value 'NEW-LAUNCHER-BYTES-1190' -Encoding ASCII
$holder4 = Start-Hold $destExe $ready (Join-Path $work 'hold-for-install.ps1') 1000
Yes 'Install-Launcher holder opened the dest exe' (Wait-Ready $ready)

$installOutFile = Join-Path $work 'install-out.txt'
$installErrFile = Join-Path $work 'install-err.txt'
$p = Start-Process -FilePath $ps -PassThru -Wait -NoNewWindow `
    -RedirectStandardOutput $installOutFile -RedirectStandardError $installErrFile `
    -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $install,
        '-Root', $root, '-From', $from, '-NoPause'
    )
$installOut = ''
if (Test-Path -LiteralPath $installOutFile) { $installOut = Get-Content -LiteralPath $installOutFile -Raw }
if (Test-Path -LiteralPath $installErrFile) { $installOut += "`n" + (Get-Content -LiteralPath $installErrFile -Raw) }

Yes 'Install-Launcher exit code is 0' ($p.ExitCode -eq 0)
Yes 'Install-Launcher did not STOP on file-in-use' ($installOut -notmatch 'STOP\.\s*Could not put the new Thornswood\.exe')
$after = ''
if (Test-Path -LiteralPath $destExe) { $after = [IO.File]::ReadAllText($destExe).Trim() }
Yes 'Install-Launcher put the new exe bytes in place' ($after -eq 'NEW-LAUNCHER-BYTES-1190')
Wait-Process -Id $holder4.Id -Timeout 10 -ErrorAction SilentlyContinue | Out-Null

# ---- Closed only after writable when a real launcher process was closed -----
Yes 'the .NET SDK the launcher builds with is here for the stand-in launcher' (Test-Path -LiteralPath $LauncherDotnet)
# A program of its own, with the apphost, so it runs as Thornswood.exe and
# Stop-Launcher finds it by that name. The apphost starts the dll named in it
# from its own folder, so the dll and its runtime config go beside it.
$sleepDll = Build-LauncherCode -Exe -Property @{ UseAppHost = 'true' } -Source "using System; using System.Threading;`nclass P { static void Main() { Thread.Sleep(60000); } }`n"
$sleepExe = [IO.Path]::ChangeExtension($sleepDll, '.exe')
Yes 'stand-in sleeper exe compiled' (Test-Path -LiteralPath $sleepExe)

Copy-Item -LiteralPath $sleepExe -Destination $destExe -Force
Get-ChildItem -LiteralPath (Split-Path -Parent $sleepDll) -File | Where-Object { $_.Extension -ne '.exe' } | Copy-Item -Destination $launcherDir -Force
$proc2 = Start-Process -FilePath $destExe -PassThru -WindowStyle Hidden
Start-Sleep -Milliseconds 400
Yes 'stand-in launcher process is running' (-not $proc2.HasExited)

# After Stop-Launcher kills the sleeper, hold the image for 1s so Closed waits.
$holder5 = Start-Hold $destExe $ready (Join-Path $work 'hold-closed-path.ps1') 1000 600
$sw = [Diagnostics.Stopwatch]::StartNew()
$closedOut = @()
$null = Stop-Launcher -Root $root *>&1 | ForEach-Object { $closedOut += [string]$_ }
$closedMs = $sw.ElapsedMilliseconds
$closedText = ($closedOut -join "`n")
Yes 'Stop-Launcher closed the stand-in and waited (~1s+)' ($closedMs -ge 700)
Yes 'Stop-Launcher printed Closed after the exe was writable' ($closedText -match '(?m)^\s*Closed\s*$')
try { Yes 'stand-in launcher process has exited' ($proc2.HasExited) } catch { Yes 'stand-in launcher process has exited' $true }
Wait-Process -Id $holder5.Id -Timeout 10 -ErrorAction SilentlyContinue | Out-Null

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
