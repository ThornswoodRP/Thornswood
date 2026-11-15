<#
  test-4164-voice-gate.ps1

      pwsh -NoProfile -File .\tests\test-4164-voice-gate.ps1

  Issue #4164. Most voice tests ran only in the nightly: the gate read only
  tests\, so voice's own harnesses beside the service could not be on it or
  named in tests\gate-excluded.txt. Since plan line 42 (1 Nov 2026) the gate
  reads voice\tests\ too, but the voice harnesses #2513 had found off the gate
  stayed there as "not sorted yet", which is no reason, so a pull request
  that broke deleting old chat or a full room's roster still merged green.

  This holds every voice harness, voice\tests\test-* and tests\test-voice-*,
  to one of two: it is on the gate, as scripts\dev\Gate-Harnesses.ps1 lists
  it, or gate-excluded.txt names it with a real reason. "Not sorted yet" is
  not one. Reads the files only; runs no harness.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

. (Join-Path $Repo 'scripts/dev/Harness-Files.ps1')
$voice = @(Get-Harnesses $Repo | ForEach-Object { $_.Name } | Where-Object { $_ -like 'voice/tests/*' -or $_ -like 'test-voice-*' })
Yes ("voice's harnesses are found, beside the service and in tests ({0})" -f $voice.Count) (@($voice | Where-Object { $_ -like 'voice/tests/*' }).Count -gt 0 -and @($voice | Where-Object { $_ -like 'test-voice-*' }).Count -gt 0)

$gate = @(& pwsh -NoProfile -File (Join-Path $Repo 'scripts/dev/Gate-Harnesses.ps1') -Root $Repo)
Yes ("the gate list reads ({0} harnesses)" -f $gate.Count) ($LASTEXITCODE -eq 0 -and $gate.Count -gt 0)

$reason = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $Repo 'tests/gate-excluded.txt'))) {
    $m = [regex]::Match($line.Trim(), '^(\S+)\s+(.+)$')
    if ($m.Success -and -not $line.Trim().StartsWith('#')) { $reason[$m.Groups[1].Value] = $m.Groups[2].Value }
}

$off = @($voice | Where-Object { $gate -notcontains $_ })
$unsorted = @($off | Where-Object { -not $reason.ContainsKey($_) -or $reason[$_] -match '^not sorted yet' })
Yes ("every voice harness off the gate has a real reason in gate-excluded.txt ({0})" -f ($unsorted -join ', ')) ($unsorted.Count -eq 0)
foreach ($n in $off) {
    if ($unsorted -notcontains $n) { Write-Host ("      off the gate: {0}  {1}" -f $n, $reason[$n]) }
}
Yes ("  and the rest are on it ({0} of {1})" -f ($voice.Count - $off.Count), $voice.Count) (($voice.Count - $off.Count) -gt 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
