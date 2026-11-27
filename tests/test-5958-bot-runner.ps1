<# #5958: exercise the actual shared runner with real Python processes.
   No Discord, repository data, package install or network is used here.
   #7158: a fixture's child is held by a handle from the moment it is
   ready, and is judged gone by that handle the moment the runner returns.
   Windows gives a freed process id to the next new process, and other
   harnesses on the share start processes all the time, so an id looked up
   after the runner has let go can name some other process. #>
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
# Ordinary fixtures allow a cold interpreter. The separate uninstrumented
# timeout case still bounds startup; ownership cases control their ready point.
function Run([string]$Executable = $Python, [int]$Seconds = 20) {
    $script:output = & (Get-Process -Id $PID).Path -NoProfile -File $runner -Root $scratch -Python $Executable -TimeoutSeconds $Seconds 2>&1 | Out-String
    return $LASTEXITCODE
}
# Pause only the test clock at the real runner's timeout seam. Python, its
# bootstrap, job ownership, timeout and cleanup all remain the real code.
$readyRunner = Join-Path $scratch 'run-after-ready.ps1'
[IO.File]::WriteAllText($readyRunner, @'
param($Runner, $Root, $Python, $Ready, $Result, [switch]$ExitedParent)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Runner, [ref]$tokens, [ref]$errors)
$seams = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Extent.Text -ceq '$timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)'
}, $true))
if ($errors.Count -or $seams.Count -ne 1) { throw 'expected exactly one unchanged timeout seam' }
$global:fixtureReady = @{ Path = $Ready; ExitedParent = [bool]$ExitedParent; Observed = $false; Stamp = 0L; Wait = 0.0; ChildId = 0; Child = $null }
$global:fixtureBreakpoint = Set-PSBreakpoint -Script $Runner -Line $seams[0].Extent.StartLineNumber -Action {
    $setup = [Diagnostics.Stopwatch]::StartNew()
    while ((-not [IO.File]::Exists($global:fixtureReady.Path) -or ($global:fixtureReady.ExitedParent -and -not $process.HasExited)) -and $setup.Elapsed.TotalSeconds -lt 20) {
        Start-Sleep -Milliseconds 10
    }
    $global:fixtureReady.Wait = $setup.Elapsed.TotalSeconds
    $global:fixtureReady.Observed = [IO.File]::Exists($global:fixtureReady.Path) -and (-not $global:fixtureReady.ExitedParent -or $process.HasExited)
    if ($global:fixtureReady.Observed) {
        # Hold the child by a handle now, while it is surely the fixture's.
        # The handle keeps its id from going to another process, and its
        # HasExited reads this process, not whatever has the id later.
        # This runs in the runner's own scope, so it sets nothing there.
        $global:fixtureReady.ChildId = [int][IO.File]::ReadAllText($global:fixtureReady.Path)
        try {
            $global:fixtureReady.Child = [Diagnostics.Process]::GetProcessById($global:fixtureReady.ChildId)
            $null = $global:fixtureReady.Child.SafeHandle
        } catch { $global:fixtureReady.Observed = $false }
    }
    $global:fixtureReady.Stamp = [Diagnostics.Stopwatch]::GetTimestamp()
    Remove-PSBreakpoint -Breakpoint $global:fixtureBreakpoint
}
$childGone = $false
try {
    & $Runner -Root $Root -Python $Python -TimeoutSeconds 1
    $code = $LASTEXITCODE
    # The moment the runner says the harness ended: is the child gone?
    $child = $global:fixtureReady.Child
    $childGone = $child -and $child.HasExited
} finally {
    Remove-PSBreakpoint -Breakpoint $global:fixtureBreakpoint -ErrorAction SilentlyContinue
    $elapsed = if ($global:fixtureReady.Stamp) { [Diagnostics.Stopwatch]::GetElapsedTime($global:fixtureReady.Stamp).TotalSeconds } else { -1 }
    $child = $global:fixtureReady.Child
    if ($child) {
        # A child the runner left running is ended here, through the same
        # handle, so the cleanup can never reach a process that took its id.
        if (-not $child.HasExited) { $child.Kill($true); $null = $child.WaitForExit(5000) }
        $child.Dispose()
    }
    [IO.File]::WriteAllText($Result, (@{ ready = $global:fixtureReady.Observed; wait = $global:fixtureReady.Wait; elapsed = $elapsed; childId = $global:fixtureReady.ChildId; childGone = [bool]$childGone } | ConvertTo-Json))
}
exit $code
'@)
function RunReady([string]$Ready, [string]$Executable = $Python, [switch]$ExitedParent) {
    $resultPath = Join-Path $scratch ('ready-result-' + [Guid]::NewGuid().ToString('N') + '.json')
    $script:output = & (Get-Process -Id $PID).Path -NoProfile -File $readyRunner -Runner $runner -Root $scratch -Python $Executable -Ready (Join-Path $scratch $Ready) -Result $resultPath -ExitedParent:$ExitedParent 2>&1 | Out-String
    $code = $LASTEXITCODE
    $result = if ([IO.File]::Exists($resultPath)) { [IO.File]::ReadAllText($resultPath) | ConvertFrom-Json } else { $null }
    $readyOkay = $result -and $result.ready -and $result.wait -lt 20 -and $result.elapsed -ge 0
    Yes "fixture $Ready publishes readiness within its separate 20-second setup bound" $readyOkay
    if (-not $readyOkay) { throw "fixture readiness failed: $output" }
    $script:activeSeconds = $result.elapsed
    $script:childGone = [bool]$result.childGone
    if (-not $script:childGone) { Write-Host ("the fixture's child, id {0}, was still running when the runner returned:" -f $result.childId); Write-Host $output }
    return $code
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
    # A cold harness may time out before executing any fixture code. This
    # actual, uninstrumented run must still fail and continue the suite.
    Fixture 'test-a.py' "import time; time.sleep(30)"
    Fixture 'test-z.py' "import pathlib; pathlib.Path('after-cold-timeout').write_text('yes')"
    Yes 'the uninstrumented one-second deadline also bounds delayed startup and continues' ((Run -Seconds 1) -ne 0 -and (Test-Path (Join-Path $scratch 'after-cold-timeout')) -and $output -match 'timed out')
    # The timed-out harness starts a child which would leave a marker if it
    # survived. Verify termination of the actual descendant, not only a log.
    Fixture 'test-a.py' @'
import pathlib, subprocess, sys, time
time.sleep(2) # deliberately exceed the old startup race
p = subprocess.Popen([sys.executable, '-c', "import pathlib,time; time.sleep(60); pathlib.Path('child-survived').write_text('bad')"])
pathlib.Path('child-pid.pending').write_text(str(p.pid))
pathlib.Path('child-pid.pending').replace('child-pid')
time.sleep(60)
'@
    Fixture 'test-z.py' "import pathlib; pathlib.Path('after-timeout').write_text('yes')"
    Yes 'timeout fails and continues the suite' ((RunReady -Ready 'child-pid') -ne 0 -and (Test-Path (Join-Path $scratch 'after-timeout')) -and $output -match 'timed out')
    Yes 'timeout kills the owned child process as well as the harness' $childGone
    Yes 'the timed-out harness and its child are ended within 15 seconds' ($activeSeconds -lt 15)
    Fixture 'test-a.py' @'
import pathlib, subprocess, sys, time
time.sleep(2)
p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
pathlib.Path('pipe-child-pid.pending').write_text(str(p.pid))
pathlib.Path('pipe-child-pid.pending').replace('pipe-child-pid')
'@
    # Use the real interpreter for the exited-parent case so a venv
    # redirector's own exit cleanup cannot mask the ownership regression.
    $basePython = & $Python -c 'import sys; print(sys._base_executable)'
    if ($LASTEXITCODE -ne 0) { throw 'could not resolve the base Python interpreter' }
    # This fixture deliberately leaves a known child after its parent exits,
    # to exercise the pipe boundary. The ready runner holds that child by a
    # handle and ends it there if the runner did not.
    $pipeResult = RunReady -Ready 'pipe-child-pid' -Executable $basePython.Trim() -ExitedParent
    $pipeOkay = $pipeResult -ne 0 -and $activeSeconds -lt 15 -and $output -match 'descendants outlived'
    Yes 'an exited harness retaining child output pipes fails within its bound' $pipeOkay
    if (-not $pipeOkay) { Write-Host $output }
    Yes 'the runner owns the exited harness descendant before fixture cleanup' $childGone
    Fixture 'test-a.py' @'
import pathlib, subprocess, sys, time
time.sleep(2)
p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
pathlib.Path('closed-child-pid.pending').write_text(str(p.pid))
pathlib.Path('closed-child-pid.pending').replace('closed-child-pid')
'@
    Yes 'an exited harness cannot leave descendants even after closing their output pipes' ((RunReady -Ready 'closed-child-pid' -Executable $basePython.Trim() -ExitedParent) -ne 0 -and $activeSeconds -lt 15 -and $output -match 'descendants outlived')
    Yes 'closed-output orphan is gone before fixture cleanup' $childGone
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
