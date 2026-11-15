<#
  test-1046-rehearsal-due.ps1

      pwsh -NoProfile -File .\scripts\tests\test-1046-rehearsal-due.ps1

  THE MONTHLY RESTORE REHEARSAL (issue #1046). Patrick ruled on 18 October
  2026 that the hands-on restore rehearsal runs monthly. Nothing read when
  the last one ran, so nothing could say one was due.
  scripts\vps\Check-RehearsalDue.ps1 reads the Last rehearsed line in
  RESTORING.md, which is in the private ops repo since #3693, and that
  repo's nightly runs it.

  It proves:
    1. On made-up pages, with -Today: 35 days after the line is ok and 36
       is overdue (exit 1), naming the due date and where the steps are;
       -Days moves that line; no line, two lines, a date that does not read,
       a date after today, a missing page and a bad -Today are each unread
       (exit 3), never ok.
    2. scripts\README.md lists it.
  The real page's checks are the ops repo's tests\test-ops-runbooks.ps1.

  Writes nothing but a scratch folder under the temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$Check = Join-Path $Repo 'scripts\vps\Check-RehearsalDue.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$shell = (Get-Process -Id $PID).Path
function Run([string[]]$argv) {
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -File $Check @argv 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

$tokens = $null; $errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Check, [ref]$tokens, [ref]$errors)
Yes 'Check-RehearsalDue.ps1 parses' ($errors.Count -eq 0)
$src = [IO.File]::ReadAllText($Check)
Yes 'its cadence is a number, 35 days by default' ($src -match '\[int\]\$Days = 35')
Yes 'it writes nothing' (-not ($src -match 'WriteAllText|Set-Content|Out-File|Add-Content|Remove-Item|New-Item'))

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-1046due-' + [guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
    function Page([string]$name, [string]$body) {
        $p = Join-Path $work $name
        [IO.File]::WriteAllText($p, $body)
        return $p
    }
    $one = Page 'one.md' ("# Restoring`n`nSome words.`n`n**Last rehearsed: 28 September 2026** (unpack and restore).`n")

    $r = Run @('-Doc', $one, '-Today', '2026-10-18')
    Yes ('20 days after: ok (exit {0})' -f $r.Code) ($r.Code -eq 0)
    Yes '  saying how old it is and when the next is due' ($r.Out -match '20 day\(s\) ago' -and $r.Out -match 'due by 2 November 2026')

    $r = Run @('-Doc', $one, '-Today', '2026-11-02')
    Yes ('35 days after: still ok (exit {0})' -f $r.Code) ($r.Code -eq 0)

    $r = Run @('-Doc', $one, '-Today', '2026-11-03')
    Yes ('36 days after: overdue (exit {0})' -f $r.Code) ($r.Code -eq 1)
    Yes '  saying OVERDUE, the due date and where the steps are' ($r.Out -match 'OVERDUE' -and $r.Out -match 'due by 2 November 2026' -and $r.Out -match "Rehearsing it")

    $r = Run @('-Doc', $one, '-Today', '2026-10-30', '-Days', '30')
    Yes ('-Days 30 moves the line: 32 days is overdue (exit {0})' -f $r.Code) ($r.Code -eq 1)
    $r = Run @('-Doc', $one, '-Today', '2026-10-28', '-Days', '30')
    Yes ('  and 30 days is ok (exit {0})' -f $r.Code) ($r.Code -eq 0)

    $r = Run @('-Doc', (Page 'none.md' "# Restoring`n`nLast rehearsed: never`n"), '-Today', '2026-10-18')
    Yes ('no **Last rehearsed** line: unread (exit {0})' -f $r.Code) ($r.Code -eq 3)

    $r = Run @('-Doc', (Page 'two.md' "**Last rehearsed: 28 September 2026**`n`n**Last rehearsed: 1 October 2026**`n"), '-Today', '2026-10-18')
    Yes ('two lines: unread (exit {0})' -f $r.Code) ($r.Code -eq 3)

    $r = Run @('-Doc', (Page 'bad.md' "**Last rehearsed: last Tuesday**`n"), '-Today', '2026-10-18')
    Yes ('a date that does not read: unread (exit {0})' -f $r.Code) ($r.Code -eq 3)

    $r = Run @('-Doc', (Page 'future.md' "**Last rehearsed: 1 December 2026**`n"), '-Today', '2026-10-18')
    Yes ('a date after today: unread (exit {0})' -f $r.Code) ($r.Code -eq 3)

    $r = Run @('-Doc', (Join-Path $work 'gone.md'), '-Today', '2026-10-18')
    Yes ('a page that is not there: unread (exit {0})' -f $r.Code) ($r.Code -eq 3)

    $r = Run @('-Doc', $one, '-Today', '18/10/2026')
    Yes ('a -Today that is not yyyy-MM-dd: unread (exit {0})' -f $r.Code) ($r.Code -eq 3)

    $r = Run @('-Doc', $one, '-Today', '2026-10-18', '-Days', '0')
    Yes ('-Days 0: unread (exit {0})' -f $r.Code) ($r.Code -eq 3)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

# The real RESTORING.md and SERVICE-OBJECTIVES.md are in the private ops repo
# since #3693. Its tests\test-ops-runbooks.ps1 runs this script against the
# real page and holds the two pages to the cadence, and its nightly runs it.

$readme = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\README.md'))
Yes 'scripts\README.md lists it' ($readme -match '\[vps/Check-RehearsalDue\.ps1\]')

Done
