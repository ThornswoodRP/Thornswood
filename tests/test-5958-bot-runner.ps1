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
function Run([string]$Executable = $Python, [int]$Seconds = 5) {
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
    Yes 'sorted real harnesses pass; helper is not selected; private environment is supplied' ((Run) -eq 0 -and (Test-Path (Join-Path $scratch 'last-ran')))
    Yes 'stdout and stderr details survive the runner into the job log' ($output -match 'first: ✓' -and $output -match 'stderr detail')
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
    try {
        $timer.Restart()
        Yes 'an exited harness retaining child output pipes fails within its bound' ((Run -Seconds 1) -ne 0 -and $timer.Elapsed.TotalSeconds -lt 15 -and $output -match 'output pipes did not close')
    } finally {
        # This fixture deliberately leaves a known child after its parent
        # exits, to exercise the pipe boundary. Clean up only that owned PID.
        $pipeChildId = [int][IO.File]::ReadAllText((Join-Path $scratch 'pipe-child-pid'))
        $child = Get-Process -Id $pipeChildId -ErrorAction SilentlyContinue
        if ($child) { $child.Kill($true); $child.WaitForExit(); $child.Dispose() }
    }
    foreach ($f in Get-ChildItem -LiteralPath $tests -Filter 'test-*.py' -File) { Remove-Item -LiteralPath $f.FullName }
    Yes 'an empty suite refuses to pass' ((Run) -ne 0 -and $output -match 'no bot harnesses')
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $scratchParent.TrimEnd('\', '/') -or [IO.Path]::GetFileName($resolved) -notlike 'bot-runner-5958-*') { throw 'unexpected fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
