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
    6. a child that dies (#5752): its "Segmentation fault" and "Unhandled
       exception." lines go in after the FAIL lines, and no stack line;
    7. a dying line said twice goes in once, a PASS line that only quotes
       one stays out, and past 5 a count of how many more;
    8. with no FAIL line the last lines already hold it, said once.
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

# ---- A. the function, as the runner has it -------------------------------------------
$ast = [Management.Automation.Language.Parser]::ParseFile($runner, [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-FailSaid' }, $true)
$caps = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -in '$FAIL_LINES', '$FAIL_LINE_CHARS', '$DEATH_LINES', '$DEATH_SAYS' }, $false))
Yes 'Nightly-Harnesses.ps1 has Get-FailSaid, its two caps, and what a dying process says (#5752)' ($null -ne $fn -and $caps.Count -eq 4)
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
    # #5752: a child that dies prints how; the FAIL line after it says only
    # what the harness did not get.
    $six = Get-FailSaid ("PASS  it starts`nSegmentation fault (core dumped)`nUnhandled exception. System.ArgumentException: Token b03f5f7f11d`n" +
        "   at System.Reflection.AssemblyNameParser.Parse()`nFAIL  with no Dist folder it says none (exit 139)`n")
    Yes ('6. the lines of a process dying go in after the FAIL lines (' + $six + ')') ($six -eq (
        ': its FAIL lines%0AFAIL  with no Dist folder it says none (exit 139)%0Aand what it printed of a process dying%0A' +
        'Segmentation fault (core dumped)%0AUnhandled exception. System.ArgumentException: Token b03f5f7f11d'))
    Yes '   and not a line of its stack, nor a PASS line' ($six -notmatch 'AssemblyNameParser' -and $six -notmatch 'PASS')
    $seven = Get-FailSaid ("FAIL  one`nPASS  the abort is handled, Process terminated. is only quoted`nAborted`nAborted`nProcess terminated. planted`nFatal error. 0x80131506`nStack overflow.`n" +
        "/bin/sh: line 1: 42 Segmentation fault`nanother (core dumped)`n")
    Yes ('7. a line said twice goes in once, a line merely quoting one stays out, and at most 5 with a count (' + $seven + ')') (
        $seven -eq (': its FAIL lines%0AFAIL  one%0Aand what it printed of a process dying%0AAborted%0AProcess terminated. planted%0AFatal error. 0x80131506%0A' +
        'Stack overflow.%0A/bin/sh: line 1: 42 Segmentation fault%0Aand 1 more such line(s), in the job log'))
    $eight = Get-FailSaid "reading the record`nSegmentation fault`n"
    Yes ('8. with no FAIL line the last lines already hold it, so it is not said twice (' + $eight + ')') ($eight -eq ': no FAIL line; its last lines%0Areading the record%0ASegmentation fault')
    Yes ('   and case 1, with nothing dying, is as it was') ((Get-FailSaid $l) -eq $one -and $one -notmatch 'dying')
}

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
        Put (Join-Path $a 'tests/test-1-two.ps1') ("Write-Host 'PASS  the first thing'`nWrite-Host 'FAIL  the door opens for the holder'`n" +
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
        Yes ('   its annotation carries the harness''s FAIL lines (' + $got + ')') ($got -eq 'harness failed (exit 1): its FAIL lines%0AFAIL  the door opens for the holder%0AFAIL  the key is kept')
        Yes '   and the harness that passed has none' (-not (Annotation $said 'test-2-pass.ps1'))
        $died = Annotation $said 'test-3-dies.ps1'
        Yes ('B. a harness whose child died carries the child''s dying line after its FAIL line (' + $died + ')') (
            $died -match '^harness failed \(exit 1\): its FAIL lines%0AFAIL  the child gave nothing back \(exit \d+\)%0Aand what it printed of a process dying%0AProcess terminated\. planted for 5752')
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
