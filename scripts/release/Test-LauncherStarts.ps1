<#
.SYNOPSIS
  Starts a published Thornswood.exe for real and holds it to opening its
  window and staying up (#5524).

.DESCRIPTION
      .\scripts\release\Test-LauncherStarts.ps1 -Exe <folder>\Thornswood.exe

  WHY THIS EXISTS. On 8 Nov 2026 a launcher went to dev and then to main
  that stopped at start with "Specified cast is not valid": the Play bar's
  slide was run on a transform, which Avalonia's transform animator cannot
  take. Every check passed it, because nothing started the native exe the
  release ships: the build published it and checked its bytes, and the
  window start harness ran the window in .NET on the headless platform.
  This starts the very exe, as it runs on a PC, before it can reach anybody.

  HOW. A root of its own under the temp folder (RUNNER_TEMP on a runner),
  given with -root, so no install is touched and the exe is not asked to
  install itself. Its Profile\accepted.json is written the way the setup
  writes one when the site does not answer, so the terms window at start
  (Acceptance.Ensure) is not asked; a later recheck may ask, after the
  window, which does not stop anything here. Then:
    1. the exe starts, and within -WindowSeconds its launcher.log says
       "Launcher start: the window was on screen" (Shell.LogStartTime, on the
       window's first frame);
    2. it stays up for -StaySeconds more, with no "COULD NOT START" line
       (Shell.Main writes one for anything that ends Run) and the process
       still running;
    3. it is asked to close its window, and is ended if it does not within
       ten seconds.
  Any of those failing prints the log and exits 1. The root is deleted
  afterwards. Windows only: the exe is a Windows program.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [int]$WindowSeconds = 120,
    [int]$StaySeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Exe)) { Write-Host "FAIL  there is no launcher at $Exe"; exit 1 }
$Exe = (Resolve-Path -LiteralPath $Exe).Path

$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$root = Join-Path $temp ('launcher-starts-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$profileDir = Join-Path $root 'Profile'
$null = New-Item -ItemType Directory -Force -Path $profileDir
$log = Join-Path $profileDir 'launcher.log'

# The record Acceptance.ToJson writes when the site did not answer: the three
# pages, each with an empty hash.
$pages = foreach ($p in 'terms', 'privacy', 'rules') { '    "' + $p + '": { "url": "https://thornswood.net/' + $p + '", "sha256": "" }' }
$accepted = "{`n  `"accepted`": `"" + [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") + "`",`n  `"pages`": {`n" + ($pages -join ",`n") + "`n  },`n  `"about`": `"Written by Test-LauncherStarts.ps1 for a start in a root of its own.`"`n}`n"
[IO.File]::WriteAllText((Join-Path $profileDir 'accepted.json'), $accepted, (New-Object Text.UTF8Encoding($false)))

function Read-Log {
    if (-not (Test-Path -LiteralPath $log)) { return '' }
    # Shared with the launcher, which holds it open to write.
    $fs = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
    try { return (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() }
}

$failed = $null
$proc = $null
try {
    Write-Host "starting $Exe -root $root"
    $proc = Start-Process -FilePath $Exe -ArgumentList @('-root', ('"' + $root + '"')) -PassThru
    $until = (Get-Date).AddSeconds($WindowSeconds)
    $window = $false
    while ((Get-Date) -lt $until) {
        $text = Read-Log
        if ($text -match 'COULD NOT START') { $failed = 'the launcher wrote COULD NOT START before its window was up'; break }
        if ($text -match 'Launcher start: the window was on screen') { $window = $true; break }
        if ($proc.HasExited) { $failed = "the launcher ended (exit $($proc.ExitCode)) before its window was up"; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $failed -and -not $window) { $failed = "the launcher did not say its window was on screen within $WindowSeconds s" }
    if (-not $failed) {
        Write-Host "PASS  the window was on screen"
        $until = (Get-Date).AddSeconds($StaySeconds)
        while ((Get-Date) -lt $until) {
            if ((Read-Log) -match 'COULD NOT START') { $failed = 'the launcher wrote COULD NOT START after its window was up'; break }
            if ($proc.HasExited) { $failed = "the launcher ended (exit $($proc.ExitCode)) after its window was up"; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $failed) { Write-Host "PASS  it stayed up for $StaySeconds s with no COULD NOT START" }
    }
} finally {
    if ($proc -and -not $proc.HasExited) {
        $null = $proc.CloseMainWindow()
        if (-not $proc.WaitForExit(10000)) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; $null = $proc.WaitForExit(10000) }
    }
    $said = Read-Log
    if ($failed) {
        Write-Host "FAIL  $failed"
        Write-Host '---- the launcher''s log ----'
        Write-Host $said
    }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }
Write-Host 'the launcher starts'
exit 0
