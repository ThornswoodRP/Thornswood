<#
  test-3184-runner-logs.ps1

      pwsh -NoProfile -File .\tests\test-3184-runner-logs.ps1

  Issue #3184. The box's build runners kept every log they wrote in _diag
  (1.6 GB, about 4,000 files, the oldest from 25 Sep on 21 Oct 2026).
  scripts\vps\vps-runner-logs.ps1 runs on the box once a day and removes the
  runner and worker logs older than two weeks. It is run here, under
  PowerShell 7 as on the box, against a scratch C:\ with two runner folders. This fails on:
    1. either script not parsing, or vps-runner-logs.ps1 not plain ASCII;
    2. an old Runner_ or Worker_ log, or an old page log, left behind;
    3. anything else removed: a new log, a file of another name in _diag, a
       file in a folder below _diag other than pages, a folder that is not a
       runner's, or the runner's own files;
    4. the run not saying in its log how many it removed.
  A few seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit ([int]($script:fail -gt 0)) }
function P([string[]]$parts) { return [IO.Path]::Combine([string[]]$parts) }

$keeper = P @($Repo, 'scripts', 'vps', 'vps-runner-logs.ps1')
$installer = P @($Repo, 'scripts', 'vps', 'Keep-RunnerLogs.ps1')
foreach ($f in @($keeper, $installer)) {
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$errs)
    Yes ((Split-Path -Leaf $f) + ' parses') (-not $errs -or $errs.Count -eq 0)
}
Yes 'vps-runner-logs.ps1 is plain ASCII' (@([IO.File]::ReadAllBytes($keeper) | Where-Object { $_ -gt 127 }).Count -eq 0)
if ($script:fail) { Done }

# Run in PowerShell 7, as on the box since #5356.
$ps = Get-BoxPowerShell

$scratch = P @([IO.Path]::GetTempPath(), ('ts-3184-' + [guid]::NewGuid().ToString('N').Substring(0, 8)))
$null = New-Item -ItemType Directory -Path $scratch
try {
    $old = (Get-Date).AddDays(-20)
    $new = (Get-Date).AddDays(-3)
    function Plant([string]$rel, [datetime]$at) {
        $f = P (@($scratch) + @($rel -split '/'))
        $null = New-Item -ItemType Directory -Path (Split-Path -Parent $f) -Force
        Set-Content -LiteralPath $f -Value 'x' -Encoding ASCII
        (Get-Item -LiteralPath $f -Force).LastWriteTime = $at
        return $f
    }
    $gone = @(
        (Plant 'Thornswood-Runner/_diag/Runner_20260925-101010-utc.log' $old),
        (Plant 'Thornswood-Runner/_diag/Worker_20260926-101010-utc.log' $old),
        (Plant 'Thornswood-Runner/_diag/pages/3a1b_step.log' $old),
        (Plant 'Thornswood-Runner4/_diag/Worker_20261001-000000-utc.log' $old)
    )
    $kept = @(
        (Plant 'Thornswood-Runner/_diag/Worker_20261018-101010-utc.log' $new),
        (Plant 'Thornswood-Runner/_diag/blocks/old-block.log' $old),
        (Plant 'Thornswood-Runner/_diag/other.txt' $old),
        (Plant 'Thornswood-Runner/.runner' $old),
        (Plant 'Thornswood-Runner4/_diag/pages/fresh.log' $new),
        (Plant 'Thornswood-Runner-Old/_diag/Worker_20260901-000000-utc.log' $old),
        (Plant 'Thornswood-Server/_diag/Worker_20260901-000000-utc.log' $old)
    )
    $log = P @($scratch, 'runner-logs.log')
    $null = & $ps -NoProfile -ExecutionPolicy Bypass -File $keeper -Root $scratch -Days 14 -Log $log 2>&1
    Yes 'it exits 0' ($LASTEXITCODE -eq 0)
    foreach ($f in $gone) { Yes ('removed: ' + $f.Substring($scratch.Length + 1)) (-not (Test-Path -LiteralPath $f)) }
    foreach ($f in $kept) { Yes ('kept: ' + $f.Substring($scratch.Length + 1)) (Test-Path -LiteralPath $f) }
    $said = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { '' }
    Yes 'its log says it removed 4, from 2 runner folders' ($said -match 'removed 4 runner log\(s\).*from 2 runner folder\(s\); 0 could not be removed')
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force
}
Done
