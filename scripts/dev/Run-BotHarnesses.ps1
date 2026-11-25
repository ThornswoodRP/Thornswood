<#
.SYNOPSIS
Runs the complete bot harness suite for pull requests and nightly checks.
.DESCRIPTION
Windows only. The caller supplies Python and its hash-pinned virtual
environment. Each harness has an owned process tree with a bounded lifetime;
one failure does not hide the remaining failures. Never runs a live bot.
.PARAMETER Root
The repository whose top-level bot/tests/test-*.py harnesses run.
.PARAMETER Python
The Python executable from the caller's prepared virtual environment.
.PARAMETER TimeoutSeconds
How long each harness may run before its owned process tree is terminated.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Root = (Split-Path (Split-Path $PSScriptRoot)),
    [Parameter(Mandatory)][string]$Python,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 300
)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'bot harness job ownership requires Windows' }
if (-not ('BotHarnessJob' -as [type])) { Add-Type -LiteralPath (Join-Path $PSScriptRoot 'BotHarnessJob.cs') }
$bootstrap = Join-Path $PSScriptRoot 'bot-harness-bootstrap.py'
$Root = (Resolve-Path -LiteralPath $Root).Path
$tests = @(Get-ChildItem -LiteralPath (Join-Path $Root 'bot/tests') -Filter 'test-*.py' -File | Sort-Object Name)
if (-not $tests.Count) { throw 'no bot harnesses were found; refusing an empty pass' }
$pythonCommand = Get-Command $Python -CommandType Application -ErrorAction Stop | Select-Object -First 1
$scratchParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$scratch = Join-Path $scratchParent ('bot-harnesses-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $scratch
$clock = [Diagnostics.Stopwatch]::StartNew()
$bad = 0
try {
    foreach ($test in $tests) {
        Write-Host ("--- {0}" -f $test.Name)
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $pythonCommand.Source
        $jobName = 'Local\ThornswoodBotHarness-' + [Guid]::NewGuid().ToString('N')
        $start.ArgumentList.Add($bootstrap)
        $start.ArgumentList.Add($jobName)
        $start.ArgumentList.Add($test.FullName)
        $start.WorkingDirectory = $Root
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.StandardOutputEncoding = [Text.Encoding]::UTF8
        $start.StandardErrorEncoding = [Text.Encoding]::UTF8
        $start.Environment['PYTHONIOENCODING'] = 'utf-8'
        $start.Environment['PYTHONUNBUFFERED'] = '1'
        $start.Environment['DISCORD_TOKEN'] = 'not-a-real-token'
        $start.Environment['THORNSWOOD_BOT_DATA'] = $scratch
        $process = [Diagnostics.Process]::new()
        $process.StartInfo = $start
        $job = $null
        $started = $false
        $failed = $false
        $alive = @()
        try {
            $job = [BotHarnessJob]::new($jobName)
            if (-not $process.Start()) { throw 'Python did not start' }
            $started = $true
            # Drain both pipes concurrently: a harness can fill either one
            # while waiting for the other. Publish its output even on failure.
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
            if ($timedOut) {
                $failed = $true
                Write-Host ("::error file={0}::harness timed out after {1}s" -f $test.FullName, $TimeoutSeconds)
            } elseif ($process.ExitCode -ne 0) {
                $failed = $true
                Write-Host ("::error file={0}::harness failed (exit {1})" -f $test.FullName, $process.ExitCode)
            }
            # A venv redirector is not the real Python process. The trusted
            # bootstrap joins the job before runpy, so even an orphan that
            # has closed its output pipes remains ours to stop.
            foreach ($ownedId in $job.ProcessIds()) {
                $owned = Get-Process -Id $ownedId -ErrorAction SilentlyContinue
                if ($owned) {
                    if ($owned.HasExited) { $owned.Dispose() }
                    else { $alive += $owned }
                }
            }
            if (-not $timedOut -and $alive.Count) {
                $failed = $true
                Write-Host ("::error file={0}::descendants outlived the harness; its owned job was terminated" -f $test.FullName)
            }
            $job.Kill()
            $cleanup = [Diagnostics.Stopwatch]::StartNew()
            foreach ($owned in $alive) {
                $remaining = [Math]::Max(1, 5000 - [int]$cleanup.ElapsedMilliseconds)
                if (-not $owned.WaitForExit($remaining)) { throw 'owned harness process did not terminate' }
            }
            if (-not $process.HasExited) { $process.Kill($true) }
            $remaining = [Math]::Max(1, 5000 - [int]$cleanup.ElapsedMilliseconds)
            if (-not $process.WaitForExit($remaining)) { throw 'Python launcher did not terminate' }
            $readers = [Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]@($stdout, $stderr))
            $remaining = [Math]::Max(1, 5000 - [int]$cleanup.ElapsedMilliseconds)
            if (-not $readers.Wait($remaining)) { throw 'harness output pipes did not close after owned job termination' }
            Write-Host ($stdout.GetAwaiter().GetResult())
            Write-Host ($stderr.GetAwaiter().GetResult())
        } catch {
            $failed = $true
            Write-Host ("::error file={0}::could not run harness: {1}" -f $test.FullName, $_.Exception.Message)
        } finally {
            # KILL_ON_JOB_CLOSE also covers errors before the ordinary stop.
            if ($job) { $job.Dispose() }
            foreach ($owned in $alive) { $owned.Dispose() }
            if ($started -and -not $process.HasExited) {
                $process.Kill($true)
                if (-not $process.WaitForExit(5000)) { throw 'Python launcher cleanup did not terminate' }
            }
            $process.Dispose()
        }
        if ($failed) { $bad++ }
    }
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $scratchParent.TrimEnd('\', '/') -or [IO.Path]::GetFileName($resolved) -notlike 'bot-harnesses-*') { throw 'unexpected bot scratch cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Host ("Bot harnesses: {0} run, {1} failed, {2:N1}s elapsed" -f $tests.Count, $bad, $clock.Elapsed.TotalSeconds)
if ($bad) { exit 1 }
