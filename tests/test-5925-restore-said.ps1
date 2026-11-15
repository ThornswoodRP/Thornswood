<#
  test-5925-restore-said.ps1

      pwsh -NoProfile -File .\tests\test-5925-restore-said.ps1

  Issue #5925. tests\test-5180-deploy-agent.ps1 failed "dotnet restore from
  the locked packages" on a Linux gate share, and the annotation, which
  carries a harness's FAIL lines (Nightly-Harnesses.ps1 Get-FailSaid, #5660),
  said only that. What dotnet printed was in the job log alone, which is too
  big for a Bot to read (Ops #266), so why a restore of the same lock files
  refused on one run and passed on the next could not be measured.

  This runs the real test-5180 with a stand-in dotnet first on PATH, whose
  restore fails the way NuGet does, and holds:

    1. the FAIL line for the restore carries dotnet's own error line, so the
       annotation says why;
    2. every error line dotnet printed is a FAIL line of its own, up to ten,
       and a line that is no error ("Restore failed in ...") is not one;
    3. it still restores in locked mode, and a restore that passes says no
       more than before.

  Writes only under its own temp folder. Never connects to anything.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-5925-' + [Guid]::NewGuid().ToString('N'))
$bin = Join-Path $work 'bin'
$null = New-Item -ItemType Directory -Path $bin -Force
$utf8 = New-Object Text.UTF8Encoding($false)
$NU1403 = 'error NU1403: Package content hash validation failed for System.ServiceProcess.ServiceController.10.0.14. The package is different than the last restore.'
$NU1301 = 'error NU1301: Unable to load the service index for source https://api.nuget.org/v3/index.json.'

# A stand-in dotnet: a restore says what $env:FAKE_RESTORE holds and exits
# with $env:FAKE_CODE; anything else exits 0. Every call is kept in
# $env:FAKE_CALLS.
function Put-FakeDotnet {
    $ps = Join-Path $bin 'fake-dotnet.ps1'
    [IO.File]::WriteAllText($ps, @'
Add-Content -LiteralPath $env:FAKE_CALLS -Value ($args -join ' ')
if ($args[0] -eq 'restore') {
    foreach ($l in ($env:FAKE_RESTORE -split '\|')) { if ($l) { Write-Output $l } }
    exit ([int]$env:FAKE_CODE)
}
exit 0
'@, $utf8)
    $box = Get-BoxPowerShell
    if ($OnWindows) {
        [IO.File]::WriteAllText((Join-Path $bin 'dotnet.cmd'), ('@"' + $box + '" -NoProfile -File "' + $ps + '" %*' + "`r`n"), $utf8)
    } else {
        $sh = Join-Path $bin 'dotnet'
        [IO.File]::WriteAllText($sh, ('#!/bin/sh' + "`n" + 'exec "' + $box + '" -NoProfile -File "' + $ps + '" "$@"' + "`n"), $utf8)
        & chmod +x $sh
    }
}

function Run-5180([string]$restoreSays, [int]$code) {
    $calls = Join-Path $work ('calls-' + [Guid]::NewGuid().ToString('N') + '.txt')
    $was = $env:PATH
    try {
        $env:PATH = $bin + [IO.Path]::PathSeparator + $env:PATH
        $env:FAKE_CALLS = $calls; $env:FAKE_RESTORE = $restoreSays; $env:FAKE_CODE = [string]$code
        $said = @(& (Get-BoxPowerShell) -NoProfile -NonInteractive -File (Join-Path $repo 'tests\test-5180-deploy-agent.ps1') 2>&1 | ForEach-Object { "$_" })
    } finally {
        $env:PATH = $was
        Remove-Item Env:\FAKE_CALLS, Env:\FAKE_RESTORE, Env:\FAKE_CODE -ErrorAction SilentlyContinue
    }
    $c = $(if (Test-Path -LiteralPath $calls) { @(Get-Content -LiteralPath $calls) } else { @() })
    return @{ Said = $said; Calls = $c }
}

try {
    Put-FakeDotnet
    $root = 'tools/DeployAgent.Tests/DeployAgent.Tests.csproj : '
    $r = Run-5180 ('  Determining projects to restore...|' + $root + $NU1403 + '|' + $root + $NU1301 + '|  Restore failed in 1.2 sec.') 1
    $fails = @($r.Said | Where-Object { $_ -match '^FAIL\b' })
    $restore = @($fails | Where-Object { $_ -match 'dotnet restore from the locked packages' })
    Yes ('the stand-in restore was asked, in locked mode (' + ((@($r.Calls) | Where-Object { $_ -match '^restore' }) -join ' / ') + ')') (@($r.Calls | Where-Object { $_ -match '^restore .*DeployAgent\.Tests.* --locked-mode' }).Count -eq 1)
    Yes ('1. the restore''s FAIL line carries dotnet''s own error (' + ($restore -join ' / ') + ')') ($restore.Count -ge 1 -and $restore[0].Contains('error NU1403: Package content hash validation failed'))
    Yes '2. each error line dotnet printed is a FAIL line of its own' (@($fails | Where-Object { $_.Contains('error NU1403') }).Count -eq 1 -and @($fails | Where-Object { $_.Contains('error NU1301') }).Count -eq 1)
    Yes '   and a line that is no error is not one' (-not @($fails | Where-Object { $_ -match 'Determining projects|Restore failed in' }).Count)
    Yes '   and nothing else in it failed: every FAIL line is the restore''s' (@($fails | Where-Object { $_ -notmatch 'dotnet restore' }).Count -eq 0)

    $r = Run-5180 '  Restore complete (0.4s)' 0
    $fails = @($r.Said | Where-Object { $_ -match '^FAIL\b' })
    Yes ('3. a restore that passes passes, with nothing more said (' + ($fails -join ' / ') + ')') ($fails.Count -eq 0 -and @($r.Said | Where-Object { $_ -match '^PASS  dotnet restore from the locked packages$' }).Count -eq 1)
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
