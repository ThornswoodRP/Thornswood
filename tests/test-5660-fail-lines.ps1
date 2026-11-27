<#
  test-5660-fail-lines.ps1

      pwsh -NoProfile -File .\tests\test-5660-fail-lines.ps1

  Issue #5660. A gate harness that failed was annotated with only
  "<harness>: harness failed (exit 1)". The FAIL lines that say what failed
  were in the job log alone, which is too big for a Bot to read (Ops #266),
  so #5630 and #5701 waited on somebody opening the log.
  scripts\dev\Nightly-Harnesses.ps1, which every gate share and the nightly
  run through, now puts the harness's own FAIL lines into that annotation
  (Get-FailSaid).

  A. Get-FailSaid, taken out of the script as it is written:
    1. two FAIL lines among PASS lines: both, each on a line of its own
       (%0A), and no PASS line;
    2. 25 FAIL lines: the first 10 and a line saying 15 more;
    3. a FAIL line of 1000 characters: cut at 300 with "...";
    4. no FAIL line: its last lines instead, and it says so;
    5. a % in a line goes in as %25, so the message reads as written;
    6. the indented lines under a FAIL line, which say why it failed
       (#6137), go with it, and an indented line under no FAIL line does not;
    7. at most $FAIL_REASON_LINES of them per FAIL line, each cut at 300, and
       a line saying how many more.
    8. a child that dies (#5752): its "Segmentation fault" and "Unhandled
       exception." lines go in after the FAIL lines, and no stack line;
    9. a dying line said twice goes in once, a PASS line that only quotes
       one stays out, and past 5 a count of how many more;
    10. with no FAIL line the last lines already hold it, said once;
    11. a header alone, as .NET 10's fail fast prints "Process terminated.",
       takes the message on the line after it, never a stack line.
    13. a thrown error a node harness prints under its FAIL line goes in
       indented, so the annotation keeps its reason (#6059: test-4407's site
       copy said listen EADDRINUSE, and the annotation said nothing), and no
       harness prints one flush left.
  B. The runner against stand-in harnesses in a scratch repository: the
     ::error line it writes for a failing harness carries its FAIL lines,
     a harness that passed gets none, and a harness whose child pwsh dies
     by .NET's fail fast carries the child's "Process terminated." line
     after its FAIL line. The runner reads the processor
     from /proc/stat off Windows, so on a machine with neither this part
     says NOT RUN; the gate's Windows and Linux shares both have it.

  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$runner = Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Nightly-Harnesses.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# What case B wants from the annotation of a harness whose child died: its
# FAIL line naming the child's exit, then the child's dying line. The exit is
# whatever the system gives a .NET fail fast: 134 on Linux (SIGABRT),
# -2146232797 (0x80131623) on Windows (#6257). Case 12 holds it to both, and
# to failing without the dying line, on every machine.
$DIED_SAYS = '^harness failed \(exit 1\): its FAIL lines%0AFAIL  the child gave nothing back \(exit -?\d+\)%0Aand what it printed of a process dying%0AProcess terminated\. planted for 5752'

# ---- A. the function, as the runner has it -------------------------------------------
$ast = [Management.Automation.Language.Parser]::ParseFile($runner, [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-FailSaid' }, $true)
$caps = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -in '$FAIL_LINES', '$FAIL_LINE_CHARS', '$FAIL_REASON_LINES', '$DEATH_LINES', '$DEATH_SAYS' }, $false))
Yes 'Nightly-Harnesses.ps1 has Get-FailSaid, its three caps, and what a dying process says (#5752)' ($null -ne $fn -and $caps.Count -eq 5)
if ($null -ne $fn) {
    foreach ($c in $caps) { . ([scriptblock]::Create($c.Extent.Text)) }
    . ([scriptblock]::Create($fn.Extent.Text))
    $l = "PASS  the first thing`nFAIL  the door opens for the holder`nPASS  the second thing`r`nFAIL  the key is kept`n"
    $one = Get-FailSaid $l
    Yes ('1. its FAIL lines, each on its own line (' + $one + ')') ($one -eq ': its FAIL lines%0AFAIL  the door opens for the holder%0AFAIL  the key is kept')
    Yes '   and no PASS line' ($one -notmatch 'PASS')
    $two = Get-FailSaid ((1..25 | ForEach-Object { "FAIL  check number $_" }) -join "`n")
    $shown = @([regex]::Matches($two, 'FAIL  check number \d+')).Count
    Yes ("2. 25 FAIL lines: the first 10 ($shown shown) and how many more") ($shown -eq 10 -and $two.Contains('check number 10%0A') -and -not $two.Contains('check number 11') -and $two.EndsWith('%0Aand 15 more FAIL line(s), in the job log'))
    $three = Get-FailSaid ('FAIL  ' + ('x' * 1000))
    Yes ('3. a 1000 character line is cut at 300 (' + $three.Length + ' characters)') ($three -eq (': its FAIL lines%0A' + 'FAIL  ' + ('x' * 294) + '...'))
    $four = Get-FailSaid "reading the record`n`nthe record has no rows`n"
    Yes ('4. no FAIL line: its last lines, and it says so (' + $four + ')') ($four -eq ': no FAIL line; its last lines%0Areading the record%0Athe record has no rows')
    Yes '   and nothing printed says so' ((Get-FailSaid '') -eq ': it printed nothing')
    $five = Get-FailSaid 'FAIL  100% of the cells, %0A not a new line'
    Yes ('5. a % goes in as %25 (' + $five + ')') ($five -eq ': its FAIL lines%0AFAIL  100%25 of the cells, %250A not a new line')
    # #6137: a harness says why a check failed on indented lines under it
    # (test-4389 prints its site copy's output there); the annotation is the
    # only place a Bot can read that, so the lines go with their FAIL line.
    $six = Get-FailSaid ("PASS  first`nFAIL  a copy of the site starts`n      Error: listen EADDRINUSE 127.0.0.1:41234`n      at Server.setupListenHandle`n" +
        "PASS  later`n  not under a FAIL line`nFAIL  E1 /rules: one h1 (0)`n")
    Yes ('6. the indented lines under a FAIL line go with it, and no others (' + $six + ')') ($six -eq (': its FAIL lines%0AFAIL  a copy of the site starts' +
        '%0A    Error: listen EADDRINUSE 127.0.0.1:41234%0A    at Server.setupListenHandle%0AFAIL  E1 /rules: one h1 (0)'))
    $seven = Get-FailSaid ((@('FAIL  the copy said a lot') + (1..30 | ForEach-Object { '      line ' + $_ + ' ' + ('y' * 400) })) -join "`n")
    $kept = @([regex]::Matches($seven, '%0A    line \d+ ')).Count
    Yes ("7. at most $FAIL_REASON_LINES of them ($kept kept), each cut at 300, and how many more") ($kept -eq $FAIL_REASON_LINES -and
        $seven.Contains('%0A    line 1 ' + ('y' * (300 - 'line 1 '.Length)) + '...') -and
        $seven.EndsWith('%0A    and ' + (30 - $FAIL_REASON_LINES) + ' more line(s) under it, in the job log'))
    # #5752: a child that dies prints how; the FAIL line after it says only
    # what the harness did not get.
    $eight = Get-FailSaid ("PASS  it starts`nSegmentation fault (core dumped)`nUnhandled exception. System.ArgumentException: Token b03f5f7f11d`n" +
        "   at System.Reflection.AssemblyNameParser.Parse()`nFAIL  with no Dist folder it says none (exit 139)`n")
    Yes ('8. the lines of a process dying go in after the FAIL lines (' + $eight + ')') ($eight -eq (
        ': its FAIL lines%0AFAIL  with no Dist folder it says none (exit 139)%0Aand what it printed of a process dying%0A' +
        'Segmentation fault (core dumped)%0AUnhandled exception. System.ArgumentException: Token b03f5f7f11d'))
    Yes '   and not a line of its stack, nor a PASS line' ($eight -notmatch 'AssemblyNameParser' -and $eight -notmatch 'PASS')
    $nine = Get-FailSaid ("FAIL  one`nPASS  the abort is handled, Process terminated. is only quoted`nAborted`nAborted`nProcess terminated. planted`nFatal error. 0x80131506`nStack overflow.`n" +
        "/bin/sh: line 1: 42 Segmentation fault`nanother (core dumped)`n")
    Yes ('9. a line said twice goes in once, a line merely quoting one stays out, and at most 5 with a count (' + $nine + ')') (
        $nine -eq (': its FAIL lines%0AFAIL  one%0Aand what it printed of a process dying%0AAborted%0AProcess terminated. planted%0AFatal error. 0x80131506%0A' +
        'Stack overflow.%0A/bin/sh: line 1: 42 Segmentation fault%0Aand 1 more such line(s), in the job log'))
    $ten = Get-FailSaid "reading the record`nSegmentation fault`n"
    Yes ('10. with no FAIL line the last lines already hold it, so it is not said twice (' + $ten + ')') ($ten -eq ': no FAIL line; its last lines%0Areading the record%0ASegmentation fault')
    Yes ('   and case 1, with nothing dying, is as it was') ((Get-FailSaid $l) -eq $one -and $one -notmatch 'dying')
    # .NET 10's fail fast prints its header alone and the message on the next
    # line (#5785's Linux share 3 of 4): the message goes with the header.
    $eleven = Get-FailSaid "Process terminated.`nplanted for 5752`n   at System.Environment.FailFast(System.String)`nUnhandled exception.`n   at Thornswood.Main()`nFAIL  the child gave nothing back (exit 134)`n"
    Yes ('11. a header alone takes the line after it, never a stack line (' + $eleven + ')') ($eleven -eq (
        ': its FAIL lines%0AFAIL  the child gave nothing back (exit 134)%0Aand what it printed of a process dying%0AProcess terminated. planted for 5752%0AUnhandled exception.'))
}

# ---- 12. what case B wants, against what each system really writes (#6257) ----------------
# As the Windows gate share wrote it on merge queue run 43780604606, and as
# a Linux share writes it.
$onWindows = 'harness failed (exit 1): its FAIL lines%0AFAIL  the child gave nothing back (exit -2146232797)%0Aand what it printed of a process dying%0AProcess terminated. planted for 5752'
$onLinux = 'harness failed (exit 1): its FAIL lines%0AFAIL  the child gave nothing back (exit 134)%0Aand what it printed of a process dying%0AProcess terminated. planted for 5752'
$noDying = 'harness failed (exit 1): its FAIL lines%0AFAIL  the child gave nothing back (exit -2146232797)'
Yes '12. case B takes the annotation the Windows share writes, with a fail fast''s negative exit' ($onWindows -match $DIED_SAYS)
Yes '    and the one a Linux share writes' ($onLinux -match $DIED_SAYS)
Yes '    and not one without the dying line' ($noDying -notmatch $DIED_SAYS)

# ---- 13. a thrown error goes under its FAIL line, indented (#6059) ---------------------
# test-4407 on 13 Nov (run 43343929039, Linux share): its copy of the site
# exited with listen EADDRINUSE, and the harness printed the thrown error
# flush left under "FAIL  the harness itself threw", so the annotation (6)
# carried only "Error: the scratch site never came up:" and no reason.
$thrown = 'const err = new Error("the scratch site never came up:\n[thornswood-docs] uncaught exception, exiting: Error: listen EADDRINUSE: address already in use 127.0.0.1:37023");'
$asNow = & node -e ($thrown + ' console.log("FAIL  the harness itself threw: " + String(err && err.stack ? err.stack : err).replace(/\n/g, "\n      "));') 2>&1 | Out-String
$asWas = & node -e ($thrown + ' console.log("FAIL  the harness itself threw: " + (err && err.stack ? err.stack : err));') 2>&1 | Out-String
if ($null -ne $fn) {
    $now = Get-FailSaid $asNow
    Yes ('13. a thrown error printed indented under its FAIL line keeps the site''s own reason (' + $now.Substring(0, [Math]::Min(200, $now.Length)) + ')') ($now -match 'never came up:%0A    \[thornswood-docs\] uncaught exception, exiting: Error: listen EADDRINUSE')
    Yes '    and printed flush left, as before, it did not' ((Get-FailSaid $asWas) -notmatch 'EADDRINUSE')
}
# Every node harness (in tests or a product's tests folder) that prints a
# thrown error after a FAIL line prints the rest of it indented, so its
# annotation carries why.
$flush = '''FAIL  [^'']*'' \+ \(\w+ && \w+\.stack'
$left = @(Get-ChildItem -LiteralPath $repo -Recurse -File -Filter '*.js' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.git)[\\/]' -and $_.FullName.Substring($repo.Length) -match '[\\/]tests[\\/]' -and (Select-String -LiteralPath $_.FullName -Pattern $flush -Quiet) } |
    ForEach-Object { $_.FullName.Substring($repo.Length + 1) })
Yes ('    and no harness prints one flush left (' + ($left -join ', ') + ')') (-not $left.Count)

# ---- B. the runner writes it -------------------------------------------------------------
$canRun = $OnWindows -or (Test-Path -LiteralPath '/proc/stat')
if (-not $canRun) {
    Write-Host 'NOT RUN  B. the runner end to end: this machine has neither Windows nor /proc/stat, which the runner reads the processor from'
} else {
    $work = Join-Path ([IO.Path]::GetTempPath()) ('ts-5660-' + [Guid]::NewGuid().ToString('N'))
    $utf8 = New-Object Text.UTF8Encoding($false)
    function Put([string]$path, [string]$text) {
        $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
        [IO.File]::WriteAllText($path, $text, $utf8)
    }
    function Annotation([string]$said, [string]$name) {
        $m = [regex]::Match($said, '(?m)^::error file=[^\r\n]*?' + [regex]::Escape($name) + '::([^\r\n]*)$')
        if ($m.Success) { return $m.Groups[1].Value }
        return ''
    }
    try {
        $a = Join-Path $work 'repo'
        Put (Join-Path $a 'tests/test-1-two.ps1') ("Write-Host 'PASS  the first thing'`nWrite-Host 'FAIL  the door opens for the holder'`nWrite-Host '      the holder has no key'`n" +
            "Write-Host 'PASS  the second thing'`nWrite-Host 'FAIL  the key is kept'`nexit 1`n")
        Put (Join-Path $a 'tests/test-2-pass.ps1') ("Write-Host 'PASS  all good'`nexit 0`n")
        # #5752: a harness whose child really dies, by .NET's own fail fast,
        # and prints what the child said before its FAIL line.
        Put (Join-Path $a 'tests/test-3-dies.ps1') ("`$said = @(& (Get-Process -Id `$PID).Path -NoProfile -NonInteractive -Command '[Environment]::FailFast(""planted for 5752"")' 2>&1 | ForEach-Object { ""`$_"" })`n" +
            "`$code = `$LASTEXITCODE`nforeach (`$s in `$said) { Write-Host `$s }`nWrite-Host ""FAIL  the child gave nothing back (exit `$code)""`nexit 1`n")
        $said = (@(& (Get-BoxPowerShell) -NoProfile -NonInteractive -File $runner -Root $a -OutDir (Join-Path $work 'out') 2>&1 | ForEach-Object { "$_" }) -join "`n")
        $code = $LASTEXITCODE
        $got = Annotation $said 'test-1-two.ps1'
        Yes ("B. the share with a failure is red (exit $code)") ($code -eq 1)
        Yes ('   its annotation carries the harness''s FAIL lines, with the reason under the first (' + $got + ')') ($got -eq 'harness failed (exit 1): its FAIL lines%0AFAIL  the door opens for the holder%0A    the holder has no key%0AFAIL  the key is kept')
        Yes '   and the harness that passed has none' (-not (Annotation $said 'test-2-pass.ps1'))
        $died = Annotation $said 'test-3-dies.ps1'
        Yes ('B. a harness whose child died carries the child''s dying line after its FAIL line (' + $died + ')') ($died -match $DIED_SAYS)
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
