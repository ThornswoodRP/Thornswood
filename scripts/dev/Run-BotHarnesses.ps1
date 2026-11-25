<# Run the bot's complete top-level test-*.py suite, for PRs and nightly (#5958).
   Python and dependencies are supplied by the caller's hash-pinned venv.
   Each harness owns a fresh process with a bounded lifetime; one failure
   does not hide failures in the remaining harnesses. Never runs a live bot. #>
[CmdletBinding()]
param(
    [string]$Root = (Split-Path (Split-Path $PSScriptRoot)),
    [Parameter(Mandatory)][string]$Python,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 300
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path
$tests = @(Get-ChildItem -LiteralPath (Join-Path $Root 'bot/tests') -Filter 'test-*.py' -File | Sort-Object Name)
if (-not $tests.Count) { throw 'no bot harnesses were found; refusing an empty pass' }
$pythonCommand = Get-Command $Python -CommandType Application -ErrorAction Stop
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
        $elapsed = [Diagnostics.Stopwatch]::StartNew()
        try {
            if (-not $process.Start()) { throw 'Python did not start' }
            # Drain both pipes concurrently: a harness can fill either one
            # while waiting for the other. Publish its output even on failure.
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
                $process.Kill($true)
                $process.WaitForExit()
                $bad++
                Write-Host ("::error file={0}::harness timed out after {1}s; its process tree was killed" -f $test.FullName, $TimeoutSeconds)
            } elseif ($process.ExitCode -ne 0) {
                $bad++
                Write-Host ("::error file={0}::harness failed (exit {1})" -f $test.FullName, $process.ExitCode)
            }
            # A descendant can retain a pipe after Python exits. That must
            # not turn ReadToEnd into an unbounded wait or a false pass.
            $remaining = [Math]::Max(1, $TimeoutSeconds * 1000 - [int]$elapsed.ElapsedMilliseconds)
            $readers = [Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]@($stdout, $stderr))
            if (-not $readers.Wait($remaining)) { throw 'harness output pipes did not close within its timeout' }
            Write-Host ($stdout.GetAwaiter().GetResult())
            Write-Host ($stderr.GetAwaiter().GetResult())
        } catch {
            $bad++
            Write-Host ("::error file={0}::could not run harness: {1}" -f $test.FullName, $_.Exception.Message)
        } finally { $process.Dispose() }
    }
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $scratchParent.TrimEnd('\', '/') -or [IO.Path]::GetFileName($resolved) -notlike 'bot-harnesses-*') { throw 'unexpected bot scratch cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Host ("Bot harnesses: {0} run, {1} failed, {2:N1}s elapsed" -f $tests.Count, $bad, $clock.Elapsed.TotalSeconds)
if ($bad) { exit 1 }
