<#
  test-4169-nexus-console-437.ps1

      pwsh -NoProfile -File .\tests\test-4169-nexus-console-437.ps1

  tests\test-2914-nexus-scripts.ps1 holds nexus-collection.js to a mod name
  with a letter outside ASCII. Node writes UTF-8, and PowerShell decodes a
  program's output in [Console]::OutputEncoding, which is code page 437 on an
  English Windows console, so the name came back as other letters and the
  check failed there unless the console had been set to UTF-8 (#4169).

  HOW. The Nexus test runs as a child whose console encoding is code page 437,
  as on an English Windows machine, and the check that compares node's output
  with that name has to pass. Only the child's console is set; nothing here
  changes this one's.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$Nexus = Join-Path (Join-Path $Repo 'tests') 'test-2914-nexus-scripts.ps1'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$check = 'nexus-collection.js adds a patch to an entry with none and to one that has one, and says each'
$child = "[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(437); 'CODEPAGE ' + [Console]::OutputEncoding.CodePage; & '" + $Nexus.Replace("'", "''") + "'"
$ErrorActionPreference = 'Continue'
$out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $child 2>&1 | Out-String
$ErrorActionPreference = 'Stop'

Yes 'the child''s console decodes in code page 437' ($out -match '(?m)^CODEPAGE 437\s*$')
Yes ('under it, the check on the accented mod name passes: ' + $check) ($out.Contains('PASS  ' + $check) -and -not $out.Contains('FAIL  ' + $check))
if ($script:fail) { $out.TrimEnd() -split "`r?`n" | Where-Object { $_ -match '^(FAIL|CODEPAGE)|passed, \d+ failed' } | ForEach-Object { Write-Host ('      ' + $_) } }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
