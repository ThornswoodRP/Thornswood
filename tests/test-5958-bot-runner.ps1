<# #5958: exercise the actual shared runner with real Python processes.
   No Discord, repository data, package install or network is used here. #>
[CmdletBinding()]
param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$runner = Join-Path (Split-Path $PSScriptRoot) 'scripts/dev/Run-BotHarnesses.ps1'
$scratchParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$scratch = Join-Path $scratchParent ('bot-runner-5958-' + [Guid]::NewGuid().ToString('N'))
$tests = Join-Path $scratch 'bot/tests'
$null = New-Item -ItemType Directory -Path $tests -Force
$pass = 0; $fail = 0
function Yes($what, $ok) {
    if ($ok) { $script:pass++; Write-Host "PASS $what" }
    else { $script:fail++; Write-Host "FAIL $what" }
}
function Fixture($name, $source) { [IO.File]::WriteAllText((Join-Path $tests $name), $source) }
# Leave room for a cold interpreter on a shared Windows runner. The cases
# that verify the timeout and inherited pipes still set their own one-second bound.
function Run([string]$Executable = $Python, [int]$Seconds = 20) {
    $script:output = & (Get-Process -Id $PID).Path -NoProfile -File $runner -Root $scratch -Python $Executable -TimeoutSeconds $Seconds 2>&1 | Out-String
    return $LASTEXITCODE
}
try {
    Fixture 'test-a.py' @'
import os, pathlib, sys
assert os.environ['DISCORD_TOKEN'] == 'not-a-real-token'
assert os.environ['PYTHONIOENCODING'] == 'utf-8'
p = pathlib.Path(os.environ['THORNSWOOD_BOT_DATA'])
assert p.is_dir()
(p / 'from-a').write_text('isolated')
pathlib.Path('first-ran').write_text('yes')
print('first: ✓')
print('stderr detail', file=sys.stderr)
print('out' * 30000)
print('err' * 30000, file=sys.stderr)
'@
    Fixture 'test-z.py' "import pathlib; assert pathlib.Path('first-ran').read_text() == 'yes'; pathlib.Path('last-ran').write_text('yes')"
    Fixture 'helper.py' "raise RuntimeError('not a harness')"
    Yes 'the runner exists' (Test-Path -LiteralPath $runner)
    if (-not (Test-Path -LiteralPath $runner)) { throw 'runner missing (expected RED before implementation)' }
    $firstResult = Run
    $firstPassed = $firstResult -eq 0 -and (Test-Path (Join-Path $scratch 'last-ran'))
    Yes 'sorted real harnesses pass; helper is not selected; private environment is supplied' $firstPassed
    if (-not $firstPassed) {
        Write-Host "First fixture run exited $firstResult"
        $output -split '\r?\n' | Where-Object { $_ -match '^(?:::error|Traceback|AssertionError|Bot harnesses:)' } | Write-Host
    }
    Yes 'stdout and stderr details survive the runner into the job log' ($output -match 'first: ✓' -and $output -match 'stderr detail')
    $oldPath = $env:PATH
    try {
        $pythonPath = (Get-Command $Python -CommandType Application | Select-Object -First 1).Source
        $dir = Split-Path $pythonPath
        $env:PATH = $dir + [IO.Path]::PathSeparator + $dir + [IO.Path]::PathSeparator + $oldPath
        $name = Split-Path -Leaf $pythonPath
        Yes 'the named-Python fixture really resolves multiple Applications' (@(Get-Command $name -CommandType Application).Count -gt 1)
        Yes 'a named executable selects the first Application even with duplicate PATH entries' ((Run -Executable $name) -eq 0)
    } finally { $env:PATH = $oldPath }
    Fixture 'test-a.py' "import sys; sys.exit(7)"
    Remove-Item -LiteralPath (Join-Path $scratch 'last-ran')
    Yes 'a failed harness makes the runner fail while the remaining harness still runs' ((Run) -ne 0 -and (Test-Path (Join-Path $scratch 'last-ran')) -and $output -match 'test-a.py.*exit 7')
    Yes 'missing Python fails closed' ((Run -Executable (Join-Path $scratch 'missing-python.exe')) -ne 0)
    # The timed-out harness starts a child which would leave a marker if it
    # survived. Verify termination of the actual descendant, not only a log.
    Fixture 'test-a.py' @'
import pathlib, subprocess, sys, time
p = subprocess.Popen([sys.executable, '-c', "import pathlib,time; time.sleep(4); pathlib.Path('child-survived').write_text('bad')"])
pathlib.Path('child-pid').write_text(str(p.pid))
time.sleep(30)
'@
    Fixture 'test-z.py' "import pathlib; pathlib.Path('after-timeout').write_text('yes')"
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Yes 'timeout fails and continues the suite' ((Run -Seconds 1) -ne 0 -and (Test-Path (Join-Path $scratch 'after-timeout')) -and $output -match 'timed out')
    $childId = [int][IO.File]::ReadAllText((Join-Path $scratch 'child-pid'))
    Yes 'timeout kills the owned child process as well as the harness' (-not (Get-Process -Id $childId -ErrorAction SilentlyContinue) -and $timer.Elapsed.TotalSeconds -lt 15)
    Fixture 'test-a.py' @'
import pathlib, subprocess, sys
p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
pathlib.Path('pipe-child-pid').write_text(str(p.pid))
'@
    # Use the real interpreter for the exited-parent case so a venv
    # redirector's own exit cleanup cannot mask the ownership regression.
    $basePython = & $Python -c 'import sys; print(sys._base_executable)'
    if ($LASTEXITCODE -ne 0) { throw 'could not resolve the base Python interpreter' }
    try {
        $timer.Restart()
        $pipeResult = Run -Executable $basePython.Trim() -Seconds 1
        $pipeOkay = $pipeResult -ne 0 -and $timer.Elapsed.TotalSeconds -lt 15 -and $output -match 'descendants outlived'
        Yes 'an exited harness retaining child output pipes fails within its bound' $pipeOkay
        if (-not $pipeOkay) { Write-Host $output }
        $pipeChildId = [int][IO.File]::ReadAllText((Join-Path $scratch 'pipe-child-pid'))
        Yes 'the runner owns the exited harness descendant before fixture cleanup' (-not (Get-Process -Id $pipeChildId -ErrorAction SilentlyContinue))
    } finally {
        # This fixture deliberately leaves a known child after its parent
        # exits, to exercise the pipe boundary. Clean up only that owned PID.
        $pipeChildId = [int][IO.File]::ReadAllText((Join-Path $scratch 'pipe-child-pid'))
        $child = Get-Process -Id $pipeChildId -ErrorAction SilentlyContinue
        if ($child) { $child.Kill($true); $child.WaitForExit(); $child.Dispose() }
    }
    Fixture 'test-a.py' @'
import pathlib, subprocess, sys
p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
pathlib.Path('closed-child-pid').write_text(str(p.pid))
'@
    try {
        Yes 'an exited harness cannot leave descendants even after closing their output pipes' ((Run -Executable $basePython.Trim()) -ne 0 -and $output -match 'descendants outlived')
        $closedId = [int][IO.File]::ReadAllText((Join-Path $scratch 'closed-child-pid'))
        Yes 'closed-output orphan is gone before fixture cleanup' (-not (Get-Process -Id $closedId -ErrorAction SilentlyContinue))
    } finally {
        $closedId = [int][IO.File]::ReadAllText((Join-Path $scratch 'closed-child-pid'))
        $child = Get-Process -Id $closedId -ErrorAction SilentlyContinue
        if ($child) { $child.Kill($true); $child.WaitForExit(); $child.Dispose() }
    }
    Fixture 'test-a.py' "import pathlib; pathlib.Path('unowned-test-ran').write_text('bad')"
    $bootstrap = Join-Path (Split-Path $runner) 'bot-harness-bootstrap.py'
    $null = & $Python $bootstrap ('Local\Missing-' + [Guid]::NewGuid().ToString('N')) (Join-Path $tests 'test-a.py') 2>&1
    Yes 'job ownership failure refuses before harness code executes' ($LASTEXITCODE -ne 0 -and -not (Test-Path (Join-Path $scratch 'unowned-test-ran')))
    foreach ($f in Get-ChildItem -LiteralPath $tests -Filter 'test-*.py' -File) { Remove-Item -LiteralPath $f.FullName }
    Yes 'an empty suite refuses to pass' ((Run) -ne 0 -and $output -match 'no bot harnesses')
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $scratchParent.TrimEnd('\', '/') -or [IO.Path]::GetFileName($resolved) -notlike 'bot-runner-5958-*') { throw 'unexpected fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
