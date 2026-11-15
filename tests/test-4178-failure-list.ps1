<#
  test-4178-failure-list.ps1

      pwsh -NoProfile -File .\tests\test-4178-failure-list.ps1

  Issue #4178. A failed build or nightly said that something failed and left
  the reason in the log. The gate's shares already annotate each failed
  harness with its FAIL lines (#5660), and scripts\dev\Merge-HarnessReports.ps1
  already wrote a row for each failing check onto the run's page (#5295), but
  neither said how to run the failed test alone, a harness that died with a
  bare stack trace and no FAIL line showed one row and none of its last
  lines, and the nightly's failure comment on its issue was a fixed line
  with the run's link. This feeds the merge a report of harnesses made to
  fail, in the shape the runner writes it, runs their run-alone commands in
  a scratch repository that holds them, and holds:

    1. the merge's summary for the run's page names each failed test, under
       a heading of its own, with each of its FAIL lines and the command that
       runs it alone: node for a .js, pwsh -NoProfile -File for a .ps1, its
       path from the repository for a product's harness; one with no FAIL
       line has the end of what it printed; a test that passed is not there;
    2. each command it gives, run as written in the scratch repository,
       runs that test alone and fails it with the same FAIL line;
    3. -Failed writes the same list, without the run's heading and counts,
       to a file of its own, for the nightly's failure comment, and writes
       no list when nothing failed;
    4. scripts\dev\Nightly-Issue.ps1 puts that list in the failure comment,
       after the line with the run, and with no list the comment is the
       line alone, as before;
    5. nightly.yml's harness report job writes the list and hands it on as
       the job's output "failed", under a delimiter no list can hold, and
       the board's failure step gets it in env, never pasted into its
       script.

  Writes only into a scratch folder under TEMP, which it removes. Never
  connects to anything.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$merge = Join-Path $repo 'scripts\dev\Merge-HarnessReports.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4178-' + [Guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Pwsh([string]$file, [string[]]$more) {
    $said = @(& (Get-BoxPowerShell) -NoProfile -NonInteractive -File $file @more 2>&1 | ForEach-Object { "$_" })
    return @{ Code = $LASTEXITCODE; Said = ($said -join "`n") }
}
function Read-Or([string]$file) { if (Test-Path -LiteralPath $file) { [IO.File]::ReadAllText($file) } else { '' } }
# The section of a page under "### <name>", up to the next heading.
function Section([string]$md, [string]$name) {
    $m = [regex]::Match($md, '(?ms)^### ' + [regex]::Escape($name) + '\s*$(.*?)(?=^#{2,3} |\z)')
    if ($m.Success) { $m.Groups[1].Value } else { '' }
}
# The command a section says runs it alone: the first line of the block
# after "Run it alone:".
function Command-In([string]$section) {
    $m = [regex]::Match($section, '(?ms)^Run it alone:\s*$\s*^(`{3,}|~{3,})[^\r\n]*$\s*^([^\r\n]+)$')
    if ($m.Success) { $m.Groups[2].Value.Trim() } else { '' }
}

try {
    $root = Join-Path $work 'repo'
    Put (Join-Path $root 'tests\test-41-forge.js') ("console.log('PASS  the forge lights');`n" +
        "console.log('FAIL  the forge makes one dagger (made 2)');`n" +
        "console.log('FAIL  the dagger weighs 4 (weighs 0)');`n" +
        "process.exit(1);`n")
    Put (Join-Path $root 'tests\test-42-tannery.ps1') ("Write-Host 'PASS  the rack stands'`n" +
        "Write-Host 'FAIL  a hide becomes leather (it stayed a hide)'`n" +
        "exit 1`n")
    Put (Join-Path $root 'launcher\tests\test-43-smelter.js') ("console.log('reading the ore table');`n" +
        "throw new Error('the smelter has no fuel row');`n")
    Put (Join-Path $root 'tests\test-44-well.js') "console.log('PASS  the well holds water');`nprocess.exit(0);`n"

    # The share's report for those four, as the runner writes it
    # (Nightly-Harnesses.ps1 Write-Report; tests\test-5295-harness-report.ps1
    # holds that it does): a suite a harness, a case a check line, and one
    # that failed with no FAIL line one failing case with the end of what it
    # printed in its failure. Written here so every part runs on any
    # machine; the runner reads the processor from Windows or /proc/stat.
    $report = Join-Path $work 'reports\share-1.xml'
    Put $report (@'
<?xml version="1.0" encoding="utf-8"?>
<testsuites name="harnesses" tests="7" failures="4" skipped="0" time="1.2">
  <testsuite name="launcher/tests/test-43-smelter.js" tests="1" failures="1" skipped="0" time="0.3">
    <testcase classname="launcher/tests/test-43-smelter.js" name="the harness ended with exit 1 and no FAIL line">
      <failure message="the harness ended with exit 1 and no FAIL line">reading the ore table
Error: the smelter has no fuel row
    at Object.&lt;anonymous&gt; (launcher/tests/test-43-smelter.js:2:7)</failure>
    </testcase>
  </testsuite>
  <testsuite name="test-41-forge.js" tests="3" failures="2" skipped="0" time="0.3">
    <testcase classname="test-41-forge.js" name="the forge lights" />
    <testcase classname="test-41-forge.js" name="the forge makes one dagger (made 2)">
      <failure message="the forge makes one dagger (made 2)"></failure>
    </testcase>
    <testcase classname="test-41-forge.js" name="the dagger weighs 4 (weighs 0)">
      <failure message="the dagger weighs 4 (weighs 0)"></failure>
    </testcase>
  </testsuite>
  <testsuite name="test-42-tannery.ps1" tests="2" failures="1" skipped="0" time="0.3">
    <testcase classname="test-42-tannery.ps1" name="the rack stands" />
    <testcase classname="test-42-tannery.ps1" name="a hide becomes leather (it stayed a hide)">
      <failure message="a hide becomes leather (it stayed a hide)"></failure>
    </testcase>
  </testsuite>
  <testsuite name="test-44-well.js" tests="1" failures="0" skipped="0" time="0.3">
    <testcase classname="test-44-well.js" name="the well holds water" />
  </testsuite>
</testsuites>
'@)

    # ---- 1. the run's page ------------------------------------------------------
    $page = Join-Path $work 'page.md'
    $failed = Join-Path $work 'failed.md'
    $m = Pwsh $merge @('-Path', $report, '-Summary', $page, '-Failed', $failed, '-Title', 'Gate harnesses')
    Yes "the merge reads it (exit $($m.Code))" ($m.Code -eq 0)
    if ($m.Code -ne 0) { Write-Host ('      it said: ' + (($m.Said -split "`n" | Select-Object -Last 4) -join ' / ')) }
    $md = Read-Or $page
    Yes '1. the page is headed and counts the checks' ($md -match '(?m)^## Gate harnesses\s*$' -and $md -match '(?m)^7 checks in 4 harnesses: 4 failed, 0 skipped\.\s*$')

    $forge = Section $md 'test-41-forge.js'
    $tannery = Section $md 'test-42-tannery.ps1'
    $smelter = Section $md 'launcher/tests/test-43-smelter.js'
    Yes '1. each failed test has a heading of its own' ($forge -and $tannery -and $smelter)
    Yes '   with each of its FAIL lines' ($forge -match '(?m)^FAIL  the forge makes one dagger \(made 2\)\s*$' -and $forge -match '(?m)^FAIL  the dagger weighs 4 \(weighs 0\)\s*$' -and $tannery -match '(?m)^FAIL  a hide becomes leather \(it stayed a hide\)\s*$')
    Yes '   and none of its passing ones' ($forge -notmatch 'the forge lights' -and $tannery -notmatch 'the rack stands')
    $cForge = Command-In $forge; $cTannery = Command-In $tannery; $cSmelter = Command-In $smelter
    Yes ("1. a .js test's command runs it with node, from the repository ($cForge)") ($cForge -eq 'node tests/test-41-forge.js')
    Yes ("   a .ps1 test's with pwsh -NoProfile -File ($cTannery)") ($cTannery -eq 'pwsh -NoProfile -File tests/test-42-tannery.ps1')
    Yes ("   a product's test by its path ($cSmelter)") ($cSmelter -eq 'node launcher/tests/test-43-smelter.js')
    Yes '1. one with no FAIL line says so, with the end of what it printed' ($smelter -match 'ended with exit 1 and no FAIL line' -and $smelter -match 'reading the ore table' -and $smelter -match 'the smelter has no fuel row')
    Yes '   and the test that passed is not there' ($md -notmatch 'test-44-well' -and $md -notmatch 'holds water')

    # ---- 2. each command runs its test alone ----------------------------------
    foreach ($c in @(@{ Cmd = $cForge; Line = 'FAIL  the forge makes one dagger (made 2)' },
                     @{ Cmd = $cTannery; Line = 'FAIL  a hide becomes leather (it stayed a hide)' },
                     @{ Cmd = $cSmelter; Line = 'Error: the smelter has no fuel row' })) {
        if (-not $c.Cmd) { Yes ('2. a command was given for the test that fails with: ' + $c.Line) $false; continue }
        $parts = @($c.Cmd -split ' ')
        $exe = $(if ($parts[0] -eq 'pwsh') { Get-BoxPowerShell } else { $parts[0] })
        Push-Location $root
        try { $said = @(& $exe @($parts | Select-Object -Skip 1) 2>&1 | ForEach-Object { "$_".Trim() }); $code = $LASTEXITCODE }
        finally { Pop-Location }
        Yes ("2. '" + $c.Cmd + "', run as written, runs that test alone and fails it the same way (exit $code)") ($code -ne 0 -and ($said -contains $c.Line))
    }

    # ---- 3. the list for the nightly's comment -----------------------------------
    $list = Read-Or $failed
    Yes '3. -Failed writes the same list to a file of its own' ($list -and (Section $list 'test-41-forge.js') -match '(?m)^FAIL  the dagger weighs 4 \(weighs 0\)\s*$' -and (Command-In (Section $list 'test-42-tannery.ps1')) -eq 'pwsh -NoProfile -File tests/test-42-tannery.ps1' -and (Command-In (Section $list 'launcher/tests/test-43-smelter.js')) -eq 'node launcher/tests/test-43-smelter.js')
    Yes '   without the run''s heading and counts' ($list -notmatch '(?m)^## ' -and $list -notmatch 'checks in \d+ harnesses')
    $greenReport = Join-Path $work 'green.xml'
    Put $greenReport "<?xml version=`"1.0`" encoding=`"utf-8`"?>`n<testsuites name=`"harnesses`" tests=`"1`" failures=`"0`" skipped=`"0`" time=`"0.1`">`n  <testsuite name=`"test-45-green.js`" tests=`"1`" failures=`"0`" skipped=`"0`" time=`"0.1`">`n    <testcase classname=`"test-45-green.js`" name=`"all well`" />`n  </testsuite>`n</testsuites>`n"
    $greenFailed = Join-Path $work 'green-failed.md'
    $null = Pwsh $merge @('-Path', $greenReport, '-Summary', (Join-Path $work 'green.md'), '-Failed', $greenFailed)
    Yes '   and no list when nothing failed' (-not (Read-Or $greenFailed).Trim())

    # ---- 4. the nightly's failure comment ----------------------------------------
    $script:Posted = New-Object System.Collections.ArrayList
    $env:GH_TOKEN = 'not-a-token'; $env:REPO = 'tester/thornswood'
    . (Join-Path $repo 'scripts\dev\Nightly-Issue.ps1')
    function Invoke-NightlyApi {
        param([string]$Method, [string]$Path, $Body = $null)
        if ($Method -eq 'GET') { return ,@([pscustomobject]@{ number = 7; title = 'Nightly checks failed'; pull_request = $null }) }
        if ($Method -eq 'POST') { [void]$script:Posted.Add([string]$Body.body); return [pscustomobject]@{ number = 7 } }
        return $null
    }
    $run = 'https://github.com/tester/thornswood/actions/runs/9'
    $can = (Get-Command Update-NightlyIssue).Parameters.ContainsKey('Failed')
    Yes '4. Nightly-Issue.ps1 takes the list (-Failed)' $can
    if ($can) {
        $null = Update-NightlyIssue -Result failure -Run $run -Day '2026-11-12' -Failed $list
        $body = $(if ($script:Posted.Count) { $script:Posted[-1] } else { '' })
        Yes '4. the failure comment says the night and the run first' ($body.StartsWith('The nightly checks failed on 2026-11-12: ' + $run))
        Yes '   and lists each failed test with its FAIL lines and the command to run it alone' ($body -match '(?m)^FAIL  the forge makes one dagger \(made 2\)\s*$' -and (Command-In (Section $body 'test-41-forge.js')) -eq 'node tests/test-41-forge.js' -and (Command-In (Section $body 'launcher/tests/test-43-smelter.js')) -eq 'node launcher/tests/test-43-smelter.js' -and $body -match 'the smelter has no fuel row')
        $script:Posted.Clear()
        $null = Update-NightlyIssue -Result failure -Run $run -Day '2026-11-12' -Failed ''
        $bare = $(if ($script:Posted.Count) { $script:Posted[-1] } else { '' })
        Yes '   and with no list, the comment is the line with the run alone, as before' ($bare.StartsWith('The nightly checks failed on 2026-11-12: ' + $run) -and $bare -notmatch '###')
    }

    # ---- 5. nightly.yml hands the list on ------------------------------------------------
    $y = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\nightly.yml')) -replace "`r`n", "`n"
    $job = [regex]::Match($y, '(?ms)^  harness-report:\s*$(.*?)(?=^  [A-Za-z0-9_-]+:\s*$)').Groups[1].Value
    $board = [regex]::Match($y, '(?ms)^  board:\s*$(.*)\z').Groups[1].Value
    Yes '5. the harness report job hands on its list as the output "failed"' ($job -match '(?m)^    outputs:\s*$' -and $job -match '(?m)^      failed: \$\{\{ steps\.merge\.outputs\.failed \}\}\s*$')
    $step = [regex]::Match($job, '(?s)- name: Merge the shares'' reports into one\s*\n(.*?)(?=\n      - |\z)').Groups[1].Value
    Yes '   its merge step has the id merge, and writes the list with -Failed' ($step -match '(?m)^        id: merge\s*$' -and $step -match 'Merge-HarnessReports\.ps1 .*-Failed ')
    Yes '   under a delimiter of its own each run, so no list can end it early' ($step -match 'failed<<' -and $step -match 'NewGuid')
    $failStep = [regex]::Match($board, '(?s)- name: Put a failure on the board\s*\n(.*?)(?=\n      - |\z)').Groups[1].Value
    Yes '5. the board''s failure step gets the list in env' ($failStep -match '(?m)^          NIGHTLY_FAILED: \$\{\{ needs\.harness-report\.outputs\.failed \}\}\s*$')
    $stepScript = ($failStep -split '(?m)^        run: \|\s*$', 2)[1]
    Yes '   never pasted into its script' ($stepScript -and $stepScript -notmatch 'outputs\.failed')
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
