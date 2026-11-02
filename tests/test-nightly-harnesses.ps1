<#
  test-nightly-harnesses.ps1

      pwsh -NoProfile -File .\tests\test-nightly-harnesses.ps1

  Issue #2357. The nightly's one job used 43 of its 45 minutes on 12 Oct,
  and a job cancelled at 45 prints nothing more: not the harnesses that
  failed, not the ten slowest. scripts\dev\Nightly-Harnesses.ps1 now runs the
  harnesses in shares, one job each, inside a time it is given. This runs it
  against stand-in harnesses in a scratch repository and proves:

    1. every harness is in exactly one share: two shares between them run
       each one once, and none twice;
    2. a harness that passes, one that fails, one past its clock (named in
       its header) and one that leaves a process running are each printed
       as they end, and the summary names the two that failed, the one that
       timed out as timed out, the slowest, and exits 1;
    3. a harness whose clock would not fit in what is left of the budget is
       not started, is named "not run, out of time", turns the share red,
       and the summary is still printed;
    4. nightly.yml runs it once for each share in its matrix, tells it how
       many shares the matrix has, keeps one share's failure from cancelling
       the other, and gives it a budget inside the job's minutes;
    5. -Only (#2970) runs the harnesses named, split by commas or spaces, and
       no others, refuses a name that is no harness before anything runs,
       and is red when a named one fails;
    6. harnesses.yml starts only by dispatch, reads the repository and
       nothing more, runs on GitHub's runner, and hands the names to -Only
       through the environment, never pasted into a script it runs;
    7. -Throttle (#3114) runs that many side by side and no more, in less
       time than one at a time, prints each as it ends; with -Share, past
       the share only into free cores, so a full machine runs its share and
       still every one; a harness whose
       header says RUNS ALONE runs after the rest with nothing beside it;
       on Windows each line says the processor time and the processes the
       harness used, which its job object counted, children included;
    8. -StartLog (#3114) adds a line of JSON as each harness starts, with
       its process id and start time, and as it ends, with its exit code and
       whether it said SKIP, for scripts\dev\Trace-Gate.ps1 to read.
    9. a heavy harness the script names (#4981, test-2914-nexus-scripts.ps1)
       gets a 600 s clock on an off-box runner (thornswood-pr-*, as
       scripts\dev\Run-Gate.ps1 tells One's runners from the box's), and the
       line it ends with and the summary say so and why; on the box, on
       GitHub's runner and off a runner it keeps 300 s, and so does every
       harness the list does not name.

  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$script = Join-Path $repo 'scripts\dev\Nightly-Harnesses.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-nightly-harnesses-' + [Guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Run([string]$root, [string[]]$more) {
    $out = Join-Path $work ('out-' + [Guid]::NewGuid().ToString('N'))
    $said = @(& pwsh -NoProfile -NonInteractive -File $script -Root $root -OutDir $out @more 2>&1 | ForEach-Object { "$_" })
    return @{ Code = $LASTEXITCODE; Said = ($said -join "`n") }
}
function Ran([string]$said) {
    return @([regex]::Matches($said, '(?m)^--- (\S+)  \(') | ForEach-Object { $_.Groups[1].Value })
}

try {
    # The runs need Windows: the runner finds what a harness left running
    # through Win32_Process. Off Windows they are said as not run (#2957).
    if ($OnWindows) {
        # ---- 1. the shares --------------------------------------------------------
        $a = Join-Path $work 'shares'
        foreach ($n in 'a', 'b', 'c', 'd', 'e') { Put (Join-Path $a "tests\test-$n.js") "process.exit(0);`n" }
        Put (Join-Path $a 'tests\test-f.ps1') "exit 0`n"
        Put (Join-Path $a 'tests\not-a-harness.js') "process.exit(1);`n"
        Put (Join-Path $a 'voice\tests\test-v.js') "process.exit(0);`n"
        Put (Join-Path $a 'launcher\tests\test-l.js') "process.exit(0);`n"
        Put (Join-Path $a 'launcher\tests\helper.js') "process.exit(1);`n"
        $r1 = Run $a @('-Shard', '1', '-Of', '2')
        $r2 = Run $a @('-Shard', '2', '-Of', '2')
        $one = @(Ran $r1.Said); $two = @(Ran $r2.Said)
        $all = @($one + $two | Sort-Object)
        $want = @('test-a.js', 'test-b.js', 'test-c.js', 'test-d.js', 'test-e.js', 'test-f.ps1', 'voice/tests/test-v.js', 'launcher/tests/test-l.js' | Sort-Object)
        Yes ("two shares between them run every harness once, a product's own by its path (" + ($all -join ', ') + ")") (($all -join ',') -eq ($want -join ','))
        Yes '  and no harness in both' (-not @($one | Where-Object { $two -contains $_ }).Count)
        Yes ("  each share some of them ({0} and {1})" -f $one.Count, $two.Count) ($one.Count -ge 3 -and $two.Count -ge 3)
        Yes '  a file that is not test-* is no harness' (-not ($all -contains 'not-a-harness.js'))
        Yes '  both green, each saying so' ($r1.Code -eq 0 -and $r2.Code -eq 0 -and $r1.Said -match 'every harness passed' -and $r2.Said -match 'every harness passed')
        $r = Run $a @('-Shard', '3', '-Of', '2')
        Yes "  a share that is not one of them is refused (exit $($r.Code))" ($r.Code -eq 2 -and -not (Ran $r.Said).Count)

        # ---- 2. what each kind of harness looks like ------------------------------
        $b = Join-Path $work 'kinds'
        Put (Join-Path $b 'tests\test-1-pass.js') "console.log('PASS  one thing');`nprocess.exit(0);`n"
        Put (Join-Path $b 'tests\test-2-fail.ps1') "Write-Host 'FAIL  one thing'`nexit 1`n"
        Put (Join-Path $b 'tests\test-3-hang.js') "// NIGHTLY CLOCK: 3 seconds. A stand-in that never ends.`nconsole.log('started');`nsetInterval(() => {}, 1000);`n"
        Put (Join-Path $b 'tests\test-4-leaves.js') ("const { spawn } = require('child_process');`n" +
            "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });`n" +
            "c.unref();`nconsole.log('left one running');`nprocess.exit(0);`n")
        $r = Run $b @()
        Yes "a share with a failure is red (exit $($r.Code))" ($r.Code -eq 1)
        Yes '  every harness is printed with its time and what it said' ($r.Said -match '(?m)^--- test-1-pass\.js  \([0-9.]+s[,)]' -and $r.Said -match 'PASS  one thing' -and $r.Said -match 'FAIL  one thing')
        Yes '  the failed one is named where it failed' ($r.Said -match '::error file=.*?test-2-fail\.ps1::harness failed \(exit 1\)')
        Yes '  the one past its clock is killed and named, on the clock its header gives' ($r.Said -match '::error file=.*?test-3-hang\.js::harness timed out after 3s and was killed' -and $r.Said -match '--- test-3-hang\.js  \([0-9.]+s, on a 3 s clock it names[,)]')
        Yes '  what one left running is killed and named' ($r.Said -match '::warning file=.*?test-4-leaves\.js::harness left 1 process\(es\) running when it ended, now killed: node')
        Yes '  the summary names both that failed, the one that timed out as such' ($r.Said -match '(?m)^2 harness\(es\) failed: test-2-fail\.ps1, test-3-hang\.js \(timed out\)\s*$')
        # Which ran longest is the machine's to say: on a busy runner the
        # PowerShell one can take longer than the 3 s clock the hang is
        # killed on. So the line is held to the times printed above it: every
        # harness that ran, each with its own time, longest first.
        $ran = @{}
        foreach ($m in [regex]::Matches($r.Said, '(?m)^--- (\S+)  \(([0-9.]+)s')) { $ran[$m.Groups[1].Value] = [double]$m.Groups[2].Value }
        $slow = [regex]::Match($r.Said, '(?m)^slowest: (.+?)\s*$').Groups[1].Value
        $listed = @($slow -split ', ' | Where-Object { $_ } | ForEach-Object { $n, $t = $_ -split ' ', 2; [pscustomobject]@{ Name = $n; Secs = [double]($t -replace 's$', '') } })
        $inOrder = $true
        for ($i = 1; $i -lt $listed.Count; $i++) { if ($listed[$i].Secs -gt $listed[$i - 1].Secs) { $inOrder = $false } }
        $same = $listed.Count -eq $ran.Count -and -not @($listed | Where-Object { -not $ran.ContainsKey($_.Name) -or $ran[$_.Name] -ne $_.Secs }).Count
        Yes ('  and the slowest, longest first, with the times above (' + $slow + ')') ($ran.Count -eq 4 -and $same -and $inOrder -and $r.Said -match '(?m)^all of them, added up: \d+s, in \d+s')

        # ---- 3. the budget ----------------------------------------------------------
        $c = Join-Path $work 'budget'
        Put (Join-Path $c 'tests\test-1-first.js') "// NIGHTLY CLOCK: 10 seconds`nsetTimeout(() => process.exit(0), 3000);`n"
        Put (Join-Path $c 'tests\test-2-second.js') "// NIGHTLY CLOCK: 10 seconds`nprocess.exit(0);`n"
        Put (Join-Path $c 'tests\test-3-third.js') "// NIGHTLY CLOCK: 10 seconds`nprocess.exit(0);`n"
        $r = Run $c @('-BudgetSeconds', '12')
        Yes "with 12 s to run them in, the first (clock 10) runs and passes" ((@(Ran $r.Said) -join ',') -eq 'test-1-first.js')
        Yes '  the next two, whose 10 s would not fit after it, are not started' ($r.Said -match '::error file=.*?test-2-second\.js::not run, out of time' -and $r.Said -match '::error file=.*?test-3-third\.js::not run, out of time')
        Yes '  and are named in the summary, which is still printed' ($r.Said -match "(?m)^2 harness\(es\) not run, out of this share's 12 s; nightly\.yml needs another share: test-2-second\.js, test-3-third\.js\s*$" -and $r.Said -match '(?m)^slowest: test-1-first\.js ')
        Yes "  so the share is red though nothing that ran failed (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -notmatch 'every harness passed')
        $r = Run $c @('-BudgetSeconds', '60')
        Yes "with 60 s all three run and the share is green (exit $($r.Code))" ($r.Code -eq 0 -and (@(Ran $r.Said)).Count -eq 3)

    } else {
        Write-Host 'SKIP  the runs in 1 to 3: Nightly-Harnesses.ps1 kills what a harness leaves through Win32_Process, which only Windows has'
    }

    # ---- 4. the workflow ------------------------------------------------------
    $y = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\nightly.yml'))
    $calls = @([regex]::Matches($y, 'Nightly-Harnesses\.ps1 -Shard \$\{\{ matrix\.shard \}\} -Of (\d+) -BudgetSeconds (\d+)'))
    Yes 'nightly.yml runs Nightly-Harnesses.ps1 for the share its matrix names, once' ($calls.Count -eq 1)
    $job = [regex]::Match($y, '(?s)(?m)^  harnesses:\s*$(.*?)(?=^  [A-Za-z0-9_-]+:\s*$|\z)').Groups[1].Value
    $shards = @([regex]::Match($job, '(?m)^\s+shard:\s*\[([^\]]*)\]').Groups[1].Value -split '\s*,\s*' | Where-Object { $_ })
    $of = $(if ($calls.Count) { [int]$calls[0].Groups[1].Value } else { 0 })
    Yes ("  in a job of its own whose matrix is the shares 1 to $of (" + ($shards -join ', ') + ")") ($shards.Count -ge 2 -and (($shards -join ',') -eq ((1..$of) -join ',')))
    Yes '  where one share failing does not cancel the other' ($job -match '(?m)^\s+fail-fast:\s*false\s*$')
    Yes '  on GitHub''s Windows runner, a runner a share (#4983)' ($job -match ('(?m)^\s+runs-on: ' + [regex]::Escape('windows-latest') + '\s*$'))
    $minutes = [int][regex]::Match($job, '(?m)^\s+timeout-minutes:\s*(\d+)').Groups[1].Value
    $budget = $(if ($calls.Count) { [int]$calls[0].Groups[2].Value } else { 0 })
    Yes ("  with a budget ($budget s) that leaves room inside the job's $minutes minutes for the rest of it") ($budget -gt 0 -and $minutes -gt 0 -and $budget -le ($minutes * 60 - 180))
    Yes '  and the old inline harness loop is gone from the workflow' ($y -notmatch 'function Run-One' -and $y -notmatch 'function Kill-Left')

    if ($OnWindows) {
        # ---- 5. named harnesses (-Only, #2970) -----------------------------------
        $r = Run $a @('-Only', 'test-b.js, voice/tests/test-v.js test-f.ps1')
        Yes ("-Only runs the named harnesses and no others (" + ((@(Ran $r.Said) | Sort-Object) -join ', ') + ")") (((@(Ran $r.Said) | Sort-Object) -join ',') -eq ((@('test-b.js', 'test-f.ps1', 'voice/tests/test-v.js') | Sort-Object) -join ','))
        Yes "  split by commas or spaces, and green when they pass (exit $($r.Code))" ($r.Code -eq 0 -and $r.Said -match 'every harness passed')
        $r = Run $a @('-Only', 'test-b.js test-nope.js')
        Yes "  a name that is no harness is refused and nothing runs (exit $($r.Code))" ($r.Code -eq 2 -and -not (Ran $r.Said).Count -and $r.Said -match 'no such harness here, so nothing was run: test-nope\.js')
        $r = Run $a @('-Only', 'not-a-harness.js')
        Yes "  a file that is not test-* cannot be named into a run (exit $($r.Code))" ($r.Code -eq 2 -and -not (Ran $r.Said).Count)
        $r = Run $b @('-Only', 'test-2-fail.ps1')
        Yes "  a named harness that fails turns the run red (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match '(?m)^1 harness\(es\) failed: test-2-fail\.ps1\s*$')

    } else {
        Write-Host 'SKIP  the runs in 5: Nightly-Harnesses.ps1 kills what a harness leaves through Win32_Process, which only Windows has'
    }

    # ---- 6. the workflow that runs them on demand -----------------------------
    $h = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\harnesses.yml'))
    Yes 'harnesses.yml starts only when somebody dispatches it' ($h -match '(?m)^on:\s*\r?\n  workflow_dispatch:' -and $h -notmatch '(?m)^  (push|pull_request|pull_request_target|schedule):')
    Yes '  reads the repository and nothing more' ($h -match '(?m)^permissions:\s*\r?\n  contents: read\s*\r?\n(?!  )')
    Yes '  on GitHub''s Windows runner, as the nightly''s shares are (#4983)' ($h -match ('(?m)^\s+runs-on: ' + [regex]::Escape('windows-latest') + '\s*$'))
    Yes '  hands the names to Nightly-Harnesses.ps1 -Only through the environment' ($h -match 'HARNESSES: \$\{\{ inputs\.harnesses \}\}' -and $h -match 'Nightly-Harnesses\.ps1 -Only \$env:HARNESSES')
    $runs = @([regex]::Matches($h, '(?ms)^\s+run: \|\s*\r?\n(.*?)(?=^\s+- |\z)') | ForEach-Object { $_.Groups[1].Value })
    Yes '  and never pastes them into a script it runs' ($runs.Count -ge 1 -and -not @($runs | Where-Object { $_ -match '\$\{\{\s*inputs\.' }).Count)

    # ---- 7. side by side (-Throttle, #3114) -------------------------------
    # Each stand-in leaves a mark in marks\ while it runs and counts the
    # others' marks at its end; the one that runs alone fails if it sees one.
    $d = Join-Path $work 'side'
    $mk = "const fs=require('fs'),path=require('path');const dir=path.join(__dirname,'..','marks');fs.mkdirSync(dir,{recursive:true});"
    foreach ($n in 'a', 'b', 'c', 'd', 'e', 'f') {
        Put (Join-Path $d "tests\test-$n.js") ($mk + "const me=path.join(dir,'$n');fs.writeFileSync(me,'');" +
            "setTimeout(()=>{console.log('SAW '+(fs.readdirSync(dir).length-1));fs.unlinkSync(me);process.exit(0);},1500);`n")
    }
    Put (Join-Path $d 'tests\test-0-alone.js') ("// RUNS ALONE: a stand-in that fails when another runs beside it.`n" + $mk +
        "const n=fs.readdirSync(dir).length;setTimeout(()=>{const m=fs.readdirSync(dir).length;console.log('ALONE SAW '+(n+m));process.exit(n+m?1:0);},700);`n")
    Put (Join-Path $d 'tests\test-g-children.js') ("const {execFileSync}=require('child_process');" +
        "for(let i=0;i<3;i++)execFileSync(process.execPath,['-e','let x=0;for(let j=0;j<3e7;j++)x+=j']);process.exit(0);`n")
    # The machine the throttle sees is a file here (-BusyFrom): idle first.
    $busy = Join-Path $work 'busy.txt'
    [IO.File]::WriteAllText($busy, '0')
    $r = Run $d @('-Throttle', '3', '-BusyFrom', $busy)
    $side = $r
    $ran = @(Ran $r.Said)
    $saw = @([regex]::Matches($r.Said, '(?m)^SAW (\d+)') | ForEach-Object { [int]$_.Groups[1].Value })
    $wall = [regex]::Match($r.Said, '(?m)^all of them, added up: (\d+)s, in (\d+)s')
    Yes ("-Throttle 3 runs every one and is green (exit $($r.Code), " + $ran.Count + ' ran)') ($r.Code -eq 0 -and $ran.Count -eq 8 -and $r.Said -match 'every harness passed')
    Yes ('  side by side: some saw another running (' + ($saw -join ' ') + ')') (@($saw | Where-Object { $_ -gt 0 }).Count -ge 2)
    Yes '  and never more than three at once' ($saw.Count -eq 6 -and -not @($saw | Where-Object { $_ -gt 2 }).Count)
    Yes ('  in less time than one at a time (' + $wall.Groups[2].Value + ' s for ' + $wall.Groups[1].Value + ' s of harnesses)') ($wall.Success -and [int]$wall.Groups[2].Value -lt [int]$wall.Groups[1].Value)
    Yes '  the one whose header says RUNS ALONE ran last, with nothing beside it' ($ran.Count -and $ran[-1] -eq 'test-0-alone.js' -and $r.Said -match '(?m)^ALONE SAW 0')
    Yes '  and the summary says how many at a time and what the cores did' ($r.Said -match '(?m)^3 at a time; 1 run alone, after the rest' -and $r.Said -match "(?m)^the machine's \d+ cores while they ran: [0-9.]+% busy on average" -and
        $r.Said -match '(?m)^at once: [0-9.]+ on average, 3 at most; 3 always, up to 3 into free cores')
    # -Share 1 (#3114, after #3106's build on 22 Oct): on a machine with no
    # core free, one at a time, every one still run, and green; on an idle
    # one, more than one, up to -Throttle.
    [IO.File]::WriteAllText($busy, '100')
    $r = Run $d @('-Throttle', '3', '-Share', '1', '-BusyFrom', $busy)
    $saw = @([regex]::Matches($r.Said, '(?m)^SAW (\d+)') | ForEach-Object { [int]$_.Groups[1].Value })
    Yes ("  -Share 1 on a machine with no core free: one at a time, every one, and green (exit $($r.Code), saw " + ($saw -join ' ') + ')') ($r.Code -eq 0 -and (Ran $r.Said).Count -eq 8 -and $saw.Count -eq 6 -and -not @($saw | Where-Object { $_ -gt 0 }).Count -and
        $r.Said -match '(?m)^at once: [0-9.]+ on average, 1 at most; 1 always, up to 3 into free cores')
    [IO.File]::WriteAllText($busy, '0')
    $r = Run $d @('-Throttle', '3', '-Share', '1', '-BusyFrom', $busy)
    $saw = @([regex]::Matches($r.Said, '(?m)^SAW (\d+)') | ForEach-Object { [int]$_.Groups[1].Value })
    Yes ("  and on an idle one, past its share into the free cores, never past -Throttle (saw " + ($saw -join ' ') + ')') ($r.Code -eq 0 -and $saw.Count -eq 6 -and @($saw | Where-Object { $_ -gt 0 }).Count -ge 2 -and -not @($saw | Where-Object { $_ -gt 2 }).Count)
    $r = Run $d @('-Throttle', '3', '-Share', '4')
    Yes "  a share past -Throttle is refused before anything runs (exit $($r.Code))" ($r.Code -eq 2 -and -not (Ran $r.Said).Count)
    if ($OnWindows) {
        $g = [regex]::Match($side.Said, '(?m)^--- test-g-children\.js  \([0-9.]+s, ([0-9.]+)s of processor in (\d+) process\(es\)\)')
        Yes ('  each harness says the processor its job counted, children included (' + $g.Value + ')') ($g.Success -and [int]$g.Groups[2].Value -eq 4 -and [double]$g.Groups[1].Value -gt 0)
        Yes '  and the summary adds them up' ($side.Said -match '(?m)^processor used by all of them: \d+s in \d+ processes')
    }
    $r = Run $d @('-Throttle', '0')
    Yes "  a throttle that is not 1 to 16 is refused before anything runs (exit $($r.Code))" ($r.Code -eq 2 -and -not (Ran $r.Said).Count)

    # ---- 8. the start log (-StartLog, #3114) --------------------------------
    $s = Join-Path $work 'startlog'
    Put (Join-Path $s 'tests\test-1-ok.js') "console.log('PASS  fine');`nprocess.exit(0);`n"
    Put (Join-Path $s 'tests\test-2-skip.js') "console.log('  ok   one');`nconsole.log('SKIP  not here');`nconsole.log('SKIP  not here');`nconsole.log('  NOT RUN  that either');`nprocess.exit(0);`n"
    Put (Join-Path $s 'tests\test-3-red.ps1') "Write-Host 'FAIL  no'`nexit 3`n"
    $log = Join-Path $work 'starts.jsonl'
    $t0 = [DateTime]::UtcNow.AddSeconds(-1)
    $r = Run $s @('-Throttle', '2', '-StartLog', $log)
    $lines = @()
    if (Test-Path -LiteralPath $log) { $lines = @(Get-Content -LiteralPath $log | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json }) }
    $starts = @($lines | Where-Object { $null -ne $_.pid }); $ends = @($lines | Where-Object { $null -ne $_.code })
    Yes ("-StartLog has a start line for each harness, with its process id (" + (@($starts | ForEach-Object { $_.name + ' ' + $_.pid }) -join ', ') + ')') ($starts.Count -eq 3 -and -not @($starts | Where-Object { [int]$_.pid -le 0 }).Count -and ((@($starts.name | Sort-Object) -join ',') -eq 'test-1-ok.js,test-2-skip.js,test-3-red.ps1'))
    # pwsh's ConvertFrom-Json makes the time a DateTime already, and its text
    # would be read back as local time.
    $when = @($starts | ForEach-Object { if ($_.start -is [DateTime]) { $_.start.ToUniversalTime() } else { [DateTime]::Parse([string]$_.start, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() } })
    Yes '  and when it started, in UTC, during the run' ($when.Count -eq 3 -and -not @($when | Where-Object { $_ -lt $t0 -or $_ -gt [DateTime]::UtcNow }).Count)
    $byName = @{}; foreach ($e in $ends) { $byName[$e.name] = $e }
    Yes '  and an end line for each, with its exit code and whether it said SKIP' ($ends.Count -eq 3 -and $byName['test-1-ok.js'].code -eq 0 -and -not $byName['test-1-ok.js'].skipped -and
        $byName['test-2-skip.js'].code -eq 0 -and $byName['test-2-skip.js'].skipped -and $byName['test-3-red.ps1'].code -eq 3 -and -not $byName['test-3-red.ps1'].skipped)
    # #5293: gate-map.yml compares the lines of a Windows run and a Linux run.
    Yes '  each end line holds the SKIP and NOT RUN lines it said, once each, trimmed (#5293)' ($ends.Count -eq 3 -and
        (@($byName['test-2-skip.js'].skips) -join '|') -eq 'SKIP  not here|NOT RUN  that either' -and @($byName['test-1-ok.js'].skips).Count -eq 0)
    Yes '  and how many lines it began with PASS or ok' ($ends.Count -eq 3 -and $byName['test-1-ok.js'].passes -eq 1 -and $byName['test-2-skip.js'].passes -eq 1 -and $byName['test-3-red.ps1'].passes -eq 0)

    # ---- 9. a longer clock for heavy harnesses off the box (#4981) ----------
    # The budget proves the clock: with 400 s, a 600 s clock does not fit
    # and the harness is not started, where a 300 s one does and runs.
    $hv = Join-Path $work 'heavy'
    Put (Join-Path $hv 'tests\test-2914-nexus-scripts.ps1') "Write-Host 'PASS  stand-in'`nexit 0`n"
    Put (Join-Path $hv 'tests\test-other.ps1') "Write-Host 'PASS  stand-in'`nexit 0`n"
    $runnerWas = $env:RUNNER_NAME
    try {
        $env:RUNNER_NAME = 'thornswood-pr-one'
        $r = Run $hv @('-Only', 'test-2914-nexus-scripts.ps1')
        Yes "off the box (thornswood-pr-one) the heavy harness runs and passes (exit $($r.Code))" ($r.Code -eq 0 -and (@(Ran $r.Said) -join ',') -eq 'test-2914-nexus-scripts.ps1')
        Yes '  its line says it had the 600 s clock, off the box' ($r.Said -match '(?m)^--- test-2914-nexus-scripts\.ps1  \([0-9.]+s, on a 600 s clock off the box[,)]')
        Yes '  and the summary names it, its clock, the runner and why' ($r.Said -match '(?m)^longer clock off the box: test-2914-nexus-scripts\.ps1 600 s; thornswood-pr-one is an off-box runner, where these heavy harnesses run slower than on the box \(#4981\)\s*$')
        $r = Run $hv @('-Only', 'test-2914-nexus-scripts.ps1', '-BudgetSeconds', '400')
        Yes "  with 400 s to run in, its 600 s clock does not fit and it is not started (exit $($r.Code))" ($r.Code -eq 1 -and -not (Ran $r.Said).Count -and $r.Said -match '::error file=.*?test-2914-nexus-scripts\.ps1::not run, out of time: \d+s used of 400s and its clock is 600s')
        $r = Run $hv @('-Only', 'test-other.ps1', '-BudgetSeconds', '400')
        Yes "  a harness the list does not name keeps 300 s off the box (exit $($r.Code))" ($r.Code -eq 0 -and (@(Ran $r.Said) -join ',') -eq 'test-other.ps1' -and $r.Said -notmatch 'longer clock' -and $r.Said -notmatch '600 s')
        foreach ($name in 'thornswood-vps-2', 'GitHub Actions 7', '') {
            $env:RUNNER_NAME = $name
            $where = $(if ($name) { $name } else { 'no runner' })
            $r = Run $hv @('-Only', 'test-2914-nexus-scripts.ps1', '-BudgetSeconds', '400')
            Yes "  on $where it keeps 300 s: it fits in 400 s, runs and passes, and nothing says longer (exit $($r.Code))" ($r.Code -eq 0 -and (@(Ran $r.Said) -join ',') -eq 'test-2914-nexus-scripts.ps1' -and $r.Said -notmatch 'longer clock' -and $r.Said -notmatch 'off the box')
        }
    } finally {
        if ($null -eq $runnerWas) { Remove-Item Env:\RUNNER_NAME -ErrorAction SilentlyContinue } else { $env:RUNNER_NAME = $runnerWas }
    }
    # The list is one place in the script, and names real harnesses only.
    $src = [IO.File]::ReadAllText($script)
    $list = [regex]::Match($src, '(?ms)^\$OFF_BOX_CLOCK = @\{(.*?)^\}')
    $named = @([regex]::Matches($list.Groups[1].Value, "(?m)^\s*'([^']+)'\s*=\s*(\d+)") | ForEach-Object { [pscustomobject]@{ Name = $_.Groups[1].Value; Secs = [int]$_.Groups[2].Value } })
    Yes ('the heavy harnesses are one list in Nightly-Harnesses.ps1 ($OFF_BOX_CLOCK), naming test-2914-nexus-scripts.ps1 at 600 s (' + (@($named | ForEach-Object { $_.Name + ' ' + $_.Secs }) -join ', ') + ')') ($list.Success -and @($named | Where-Object { $_.Name -eq 'test-2914-nexus-scripts.ps1' -and $_.Secs -eq 600 }).Count -eq 1)
    Yes '  every name on it is a harness here, and no clock on it is past 600 s' ($named.Count -and -not @($named | Where-Object { -not (Test-Path -LiteralPath (Join-Path $repo ('tests\' + $_.Name))) -or $_.Secs -gt 600 -or $_.Secs -le 300 }).Count)
    Yes '  and the box is told from One by the runner name, as Run-Gate.ps1 does' ($src -match "\[string\]\`$env:RUNNER_NAME -like 'thornswood-pr-\*'" -and [IO.File]::ReadAllText((Join-Path $repo 'scripts\dev\Run-Gate.ps1')) -match "\[string\]\`$env:RUNNER_NAME -like 'thornswood-pr-\*'")
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
