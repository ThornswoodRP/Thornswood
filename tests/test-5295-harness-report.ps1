<#
  test-5295-harness-report.ps1

      pwsh -NoProfile -File .\tests\test-5295-harness-report.ps1

  Issue #5295. A red gate named a harness file, and the reader looked
  through its log for the failing line. scripts\dev\Nightly-Harnesses.ps1
  -Report now writes a JUnit file with a test case for each check, and
  scripts\dev\Merge-HarnessReports.ps1 merges every share's into one report
  and names the failing checks in the run's summary. This runs them both
  against stand-in harnesses in a scratch repository and proves:

    1. each PASS, FAIL, SKIP and NOT RUN line a harness prints, from .js and
       .ps1 alike, is a test case of its own, under a suite named for the
       harness, failing, skipped or passing as the line says, and the counts
       on the suites and the report add up;
    2. a harness that fails with no FAIL line of its own (it threw, it was
       killed at its clock) gets one failing case saying how it ended, with
       the end of what it printed; a harness not run, out of time, gets one
       too; so every harness the run's summary names as failed is in the
       report as failing;
    3. what a check says is kept whole: quotes, angle brackets, ampersands
       and bars come back as written, and a control character in the output
       does not break the file;
    4. the merge reads several share reports into one, every suite once,
       counts them, and writes a summary naming each failing check beside
       its harness; it exits 0 when the reports are all there, failing
       checks or not;
    5. it says so and exits 1 when fewer reports came than -Expect, or one
       is not a harness report, so a share that died early is not hidden
       behind a short report;
    6. with no -Report the runner writes no report and prints what it did;
    7. with -Summary it writes its section of the run's page itself, under
       the title given, failing checks by name, with no -Report needed, and
       Run-Gate.ps1 -Summary titles a share of the gate by its number;
    8. build.yml's gate shares and nightly.yml's write a report each and
       keep it for the run, and a job of each merges them, expecting one a
       share, onto the run's page and keeps the merged one; harnesses.yml,
       one job, hands GITHUB_STEP_SUMMARY to -Summary by name. No runner
       script reads the page from the environment by itself, since harnesses
       that run these against stand-ins run inside a real run, and their
       stand-in checks must stay off its page.

  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $repo 'scripts\dev\Nightly-Harnesses.ps1'
$merge = Join-Path $repo 'scripts\dev\Merge-HarnessReports.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-5295-' + [Guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Run([string]$root, [string[]]$more) {
    $out = Join-Path $work ('out-' + [Guid]::NewGuid().ToString('N'))
    $said = @(& pwsh -NoProfile -NonInteractive -File $runner -Root $root -OutDir $out @more 2>&1 | ForEach-Object { "$_" })
    return @{ Code = $LASTEXITCODE; Said = ($said -join "`n") }
}
function Merge([string[]]$more) {
    $said = @(& pwsh -NoProfile -NonInteractive -File $merge @more 2>&1 | ForEach-Object { "$_" })
    return @{ Code = $LASTEXITCODE; Said = ($said -join "`n") }
}
function Load([string]$file) {
    $d = New-Object System.Xml.XmlDocument
    $d.Load($file)
    return $d
}
function Suite($doc, [string]$name) {
    foreach ($s in $doc.DocumentElement.SelectNodes('testsuite')) { if ($s.GetAttribute('name') -eq $name) { return $s } }
    return $null
}
# Each case of a suite as "STATE what": PASS, FAIL or SKIP.
function Cases($suite) {
    if (-not $suite) { return @() }
    @(foreach ($c in $suite.SelectNodes('testcase')) {
        $state = $(if ($c.SelectSingleNode('failure')) { 'FAIL' } elseif ($c.SelectSingleNode('skipped')) { 'SKIP' } else { 'PASS' })
        $state + ' ' + $c.GetAttribute('name')
    })
}

try {
    # ---- 1 to 3. one share, every kind of harness ---------------------------------
    $a = Join-Path $work 'kinds'
    $odd = 'quotes "x" and ''y'', <tags> & a | bar'
    Put (Join-Path $a 'tests\test-1-mixed.js') ("console.log('PASS  one thing');`n" +
        "console.log('  FAIL indented, with no two spaces');`n" +
        "console.log('PASS: with a colon');`n" +
        "console.log('a line that is no check, PASS in the middle');`n" +
        "console.log('FAIL  ' + " + ($odd | ConvertTo-Json) + " + String.fromCharCode(7));`n" +
        "process.exit(1);`n")
    Put (Join-Path $a 'tests\test-2-skips.ps1') ("Write-Host 'PASS  ran here'`nWrite-Host 'SKIP  needs Windows'`nWrite-Host 'NOT RUN  needs the box'`nexit 0`n")
    Put (Join-Path $a 'tests\test-3-throws.js') "console.log('PASS  before it threw');`nconsole.log('the last words');`nthrow new Error('it broke here');`n"
    Put (Join-Path $a 'tests\test-4-hang.js') "// NIGHTLY CLOCK: 3 seconds. A stand-in that never ends.`nconsole.log('PASS  started');`nsetInterval(() => {}, 1000);`n"
    Put (Join-Path $a 'tests\test-5-late.js') "// NIGHTLY CLOCK: 600 seconds`nprocess.exit(0);`n"
    $one = Join-Path $work 'reports\share-1.xml'
    $r = Run $a @('-Report', $one, '-BudgetSeconds', '400')
    Yes "the share is red, as before (exit $($r.Code))" ($r.Code -eq 1)
    Yes '  and it says where the report went and what is in it' ($r.Said -match '(?m)^report: \d+ checks in 5 harnesses, \d+ failed, 2 skipped, in .*share-1\.xml\s*$')
    $doc = $null
    try { $doc = Load $one } catch { Write-Host ('  the report: ' + $_.Exception.Message) }
    Yes '  the report is there and reads as XML, with a control character in a check' ($null -ne $doc)
    if ($doc) {
        $mixed = @(Cases (Suite $doc 'test-1-mixed.js'))
        $want = @('PASS one thing', 'FAIL indented, with no two spaces', 'PASS with a colon', ('FAIL ' + $odd))
        Yes ('1. each check line of a .js harness is a case, as its line says (' + ($mixed -join ' / ') + ')') (($mixed -join "`n") -eq ($want -join "`n"))
        Yes '   a line with PASS in its middle is no check' (-not @($mixed | Where-Object { $_ -match 'in the middle' }).Count)
        Yes '3. quotes, angle brackets, ampersands and bars come back as written' ($mixed -contains ('FAIL ' + $odd))
        $skips = @(Cases (Suite $doc 'test-2-skips.ps1'))
        Yes ('1. a .ps1 harness the same, SKIP and NOT RUN as skipped (' + ($skips -join ' / ') + ')') (($skips -join "`n") -eq (@('PASS ran here', 'SKIP needs Windows', 'SKIP needs the box') -join "`n"))
        $threw = Suite $doc 'test-3-throws.js'
        $tc = @(Cases $threw)
        Yes ('2. one that threw has its own checks and one failing case saying how it ended (' + ($tc -join ' / ') + ')') ($tc.Count -eq 2 -and $tc[0] -eq 'PASS before it threw' -and $tc[1] -match '^FAIL the harness ended with exit 1 and no FAIL line$')
        $body = $(if ($threw) { [string]$threw.SelectSingleNode('testcase[2]/failure').InnerText } else { '' })
        Yes '   with the end of what it printed' ($body -match 'the last words' -and $body -match 'it broke here')
        $hc = @(Cases (Suite $doc 'test-4-hang.js'))
        Yes ('2. one killed at its clock says so (' + ($hc -join ' / ') + ')') ($hc.Count -eq 2 -and $hc[1] -eq 'FAIL the harness timed out after 3 s and was killed')
        $lc = @(Cases (Suite $doc 'test-5-late.js'))
        Yes ('2. one not run, out of time, is a failing case (' + ($lc -join ' / ') + ')') (($lc -join '') -eq 'FAIL the harness was not run, out of time')
        $root = $doc.DocumentElement
        $cases = @($root.SelectNodes('testsuite/testcase')).Count
        $fails = @($root.SelectNodes('testsuite/testcase[failure]')).Count
        $skipn = @($root.SelectNodes('testsuite/testcase[skipped]')).Count
        $sumOk = $true
        foreach ($s in $root.SelectNodes('testsuite')) {
            if ([int]$s.GetAttribute('tests') -ne @($s.SelectNodes('testcase')).Count -or [int]$s.GetAttribute('failures') -ne @($s.SelectNodes('testcase[failure]')).Count -or [int]$s.GetAttribute('skipped') -ne @($s.SelectNodes('testcase[skipped]')).Count) { $sumOk = $false }
        }
        Yes ("1. the counts add up: $cases cases, $fails failing, $skipn skipped") ([int]$root.GetAttribute('tests') -eq $cases -and [int]$root.GetAttribute('failures') -eq $fails -and [int]$root.GetAttribute('skipped') -eq $skipn -and $fails -eq 5 -and $skipn -eq 2 -and $sumOk)
        $named = [regex]::Match($r.Said, '(?m)^(\d+) harness\(es\) failed: (.*)$')
        $failedSuites = @(foreach ($s in $root.SelectNodes('testsuite')) { if ([int]$s.GetAttribute('failures') -gt 0) { $s.GetAttribute('name') } })
        Yes ('2. every harness the summary names as failed or not run fails in the report (' + ($failedSuites -join ', ') + ')') ($named.Success -and $r.Said -match 'test-5-late\.js' -and (($failedSuites | Sort-Object) -join ',') -eq 'test-1-mixed.js,test-3-throws.js,test-4-hang.js,test-5-late.js')
    }

    # ---- 4 and 5. the merge -------------------------------------------------------
    $b = Join-Path $work 'green'
    Put (Join-Path $b 'tests\test-6-green.js') "console.log('PASS  all well');`nprocess.exit(0);`n"
    $two = Join-Path $work 'reports\share-2.xml'
    $null = Run $b @('-Report', $two)
    $merged = Join-Path $work 'merged.xml'
    $sum = Join-Path $work 'summary.md'
    $m = Merge @('-Path', (Join-Path $work 'reports'), '-Expect', '2', '-Out', $merged, '-Summary', $sum, '-Title', 'Gate harnesses')
    Yes "4. two share reports merge, failing checks and all, and the merge is green (exit $($m.Code))" ($m.Code -eq 0)
    $md = $(if (Test-Path -LiteralPath $sum) { [IO.File]::ReadAllText($sum) } else { '' })
    $all = $null
    try { $all = Load $merged } catch { Write-Host ('  the merged report: ' + $_.Exception.Message) }
    if ($all) {
        $names = @(foreach ($s in $all.DocumentElement.SelectNodes('testsuite')) { $s.GetAttribute('name') })
        Yes ('4. the merged report holds every suite of both, once (' + ($names -join ', ') + ')') ((($names | Sort-Object) -join ',') -eq 'test-1-mixed.js,test-2-skips.ps1,test-3-throws.js,test-4-hang.js,test-5-late.js,test-6-green.js')
        Yes '   and counts them all' ([int]$all.DocumentElement.GetAttribute('failures') -eq 5 -and [int]$all.DocumentElement.GetAttribute('tests') -eq (@($all.DocumentElement.SelectNodes('testsuite/testcase')).Count))
    } else { Yes '4. the merged report reads as XML' $false }
    Yes '4. the summary is headed and counts the checks' ($md -match '(?m)^## Gate harnesses\s*$' -and $md -match '(?m)^\d+ checks in 6 harnesses: 5 failed, 2 skipped\.\s*$')
    Yes '   and names each failing check beside its harness' ($md -match '(?m)^\| test-1-mixed\.js \| indented, with no two spaces \|\s*$' -and $md -match '(?m)^\| test-4-hang\.js \| the harness timed out after 3 s and was killed \|\s*$')
    Yes '   a bar in a check does not split its row' ($md -match '(?m)^\| test-1-mixed\.js \| quotes .* a \\\| bar \|\s*$')
    Yes '   and no passing check is listed' ($md -notmatch 'all well' -and $md -notmatch 'one thing')

    $m = Merge @('-Path', (Join-Path $work 'reports'), '-Expect', '3', '-Summary', (Join-Path $work 'short.md'))
    $short = [IO.File]::ReadAllText((Join-Path $work 'short.md'))
    Yes "5. fewer reports than shares is red (exit $($m.Code))" ($m.Code -eq 1)
    Yes '   and the summary and the log say how many came' ($short -match '2 of the 3 share reports came' -and $m.Said -match '::error::2 of the 3 share reports came')
    Put (Join-Path $work 'odd\not-ours.xml') "<?xml version=`"1.0`"?><something />"
    $m = Merge @('-Path', (Join-Path $work 'odd'), '-Summary', (Join-Path $work 'odd.md'))
    Yes "5. a file that is not a harness report is red and named (exit $($m.Code))" ($m.Code -eq 1 -and $m.Said -match 'not-ours\.xml is not a harness report')

    # ---- 6. no -Report ----------------------------------------------------------
    $r = Run $b @()
    Yes "6. with no -Report there is no report line, and the run is as before (exit $($r.Code))" ($r.Code -eq 0 -and $r.Said -notmatch '(?m)^report: ' -and $r.Said -match 'every harness passed')

    # ---- 7. -Summary ------------------------------------------------------------
    $page = Join-Path $work 'page.md'
    $r = Run $a @('-Summary', $page, '-Title', 'Gate harnesses, share 2 of 5', '-BudgetSeconds', '400')
    $md = $(if (Test-Path -LiteralPath $page) { [IO.File]::ReadAllText($page) } else { '' })
    Yes "7. -Summary writes the run's section, under the title given (exit $($r.Code))" ($r.Code -eq 1 -and $md -match '(?m)^## Gate harnesses, share 2 of 5\s*$' -and $md -match '(?m)^\d+ checks in 5 harnesses: 5 failed, 2 skipped\.\s*$')
    Yes '   naming each failing check by harness' ($md -match '(?m)^\| test-3-throws\.js \| the harness ended with exit 1 and no FAIL line \|\s*$')
    $r = Run $b @('-Summary', $page)
    $md = [IO.File]::ReadAllText($page)
    Yes "   a second run adds its own section after the first, a share's own title by default (exit $($r.Code))" ($r.Code -eq 0 -and $md -match '(?m)^## Harnesses, share 1 of 1\s*$' -and $md.IndexOf('## Gate harnesses, share 2 of 5') -lt $md.IndexOf('## Harnesses, share 1 of 1'))
    $rg = [IO.File]::ReadAllText((Join-Path $repo 'scripts\dev\Run-Gate.ps1'))
    Yes '7. Run-Gate.ps1 hands -Summary on, titled "Gate harnesses, share n of m"' ($rg -match "\`$with\.Summary = \`$Summary" -and $rg -match [regex]::Escape("'Gate harnesses, share {0} of {1}' -f `$Shard, `$Of"))

    # ---- 8. the workflows -------------------------------------------------------
    $wf = Join-Path $repo '.github\workflows'
    foreach ($pair in @(@('build.yml', 'Run-Gate', 'gate-report', 'report', 'Gate report', 'needs.pick.outputs.shares'), @('build-pr.yml', 'Run-Gate', 'gate-report', 'report', 'Gate report', 'needs.pick.outputs.shares'), @('nightly.yml', 'Nightly-Harnesses', 'harness-report', 'harness-report', 'Harness report', '-Expect 2'))) {
        $k, $runs, $art, $job, $name, $expect = $pair
        $y = [IO.File]::ReadAllText((Join-Path $wf $k))
        Yes "8. $k's shares each write a report" ($y -match ('(?m)^\s+\.\\scripts\\dev\\' + $runs + '\.ps1 -Shard .* -Report \(Join-Path \$env:RUNNER_TEMP ''' + $art + '\\share\.xml''\)\s*$'))
        Yes "   and keep it for the run as $art-<share>, a day" ($y -match ('(?s)uses: actions/upload-artifact@[0-9a-f]{40} # v\d+\s+with:\s+name: ' + $art + '-\$\{\{ matrix\.shard \}\}\s+path: \$\{\{ runner\.temp \}\}/' + $art + '/share\.xml.*?retention-days: 1\b'))
        $jb = [regex]::Match($y, '(?s)(?m)^  ' + [regex]::Escape($job) + ':\s*$(.*?)(?=^  [A-Za-z0-9_-]+:\s*$|\z)').Groups[1].Value
        Yes "   the job ""$name"" downloads them all and merges them onto the run's page" ($jb -match ('name: ' + [regex]::Escape($name)) -and $jb -match ('pattern: ' + [regex]::Escape($art) + '-\*') -and $jb -match 'Merge-HarnessReports\.ps1 -Path \$in -Expect ' -and $jb -match [regex]::Escape($expect))
        # In the builds, whenever either the Windows or the Linux shares (#5293) ran.
        Yes '   running whenever the shares ran, red or green, never with always()' (($jb -match "if: \`$\{\{ !cancelled\(\) && needs\.[a-z]+\.result != 'skipped' \}\}" -or
            $jb -match [regex]::Escape("if: `${{ !cancelled() && (needs.gate.result != 'skipped' || needs['gate-linux'].result != 'skipped') }}")) -and $jb -notmatch 'always\(\)')
    }
    $y = [IO.File]::ReadAllText((Join-Path $wf 'harnesses.yml'))
    Yes "8. harnesses.yml, one job, hands the run's page to -Summary" ($y -match '(?m)^\s+\.\\scripts\\dev\\Nightly-Harnesses\.ps1 -Only .* -Summary \$env:GITHUB_STEP_SUMMARY\s*$')
    $reads = @(foreach ($f in 'Nightly-Harnesses.ps1', 'Run-Gate.ps1', 'Merge-HarnessReports.ps1') {
        $text = [IO.File]::ReadAllText((Join-Path $repo ('scripts\dev\' + $f)))
        $code = (($text -split "`n") | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
        if ($f -ne 'Merge-HarnessReports.ps1' -and $code -match 'env:GITHUB_STEP_SUMMARY') { $f }
    })
    Yes ('8. the runners read the page from no environment by themselves (' + ($reads -join ', ') + ')') (-not $reads.Count)
}
finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit ([int]($script:fail -gt 0))
