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
  B. The runner against stand-in harnesses in a scratch repository: the
     ::error line it writes for a failing harness carries its FAIL lines,
     and a harness that passed gets none. The runner reads the processor
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
$caps = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -in '$FAIL_LINES', '$FAIL_LINE_CHARS', '$FAIL_REASON_LINES' }, $false))
Yes 'Nightly-Harnesses.ps1 has Get-FailSaid and its three caps' ($null -ne $fn -and $caps.Count -eq 3)
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
        Put (Join-Path $a 'tests/test-1-two.ps1') ("Write-Host 'PASS  the first thing'`nWrite-Host 'FAIL  the door opens for the holder'`nWrite-Host '      the holder has no key'`n" +
            "Write-Host 'PASS  the second thing'`nWrite-Host 'FAIL  the key is kept'`nexit 1`n")
        Put (Join-Path $a 'tests/test-2-pass.ps1') ("Write-Host 'PASS  all good'`nexit 0`n")
        $said = (@(& (Get-BoxPowerShell) -NoProfile -NonInteractive -File $runner -Root $a -OutDir (Join-Path $work 'out') 2>&1 | ForEach-Object { "$_" }) -join "`n")
        $code = $LASTEXITCODE
        $got = Annotation $said 'test-1-two.ps1'
        Yes ("B. the share with a failure is red (exit $code)") ($code -eq 1)
        Yes ('   its annotation carries the harness''s FAIL lines, with the reason under the first (' + $got + ')') ($got -eq 'harness failed (exit 1): its FAIL lines%0AFAIL  the door opens for the holder%0A    the holder has no key%0AFAIL  the key is kept')
        Yes '   and the harness that passed has none' (-not (Annotation $said 'test-2-pass.ps1'))
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
