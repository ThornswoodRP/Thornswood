<#
  Checks the upload-version selector without loading the upload script or
  contacting Nexus. On Unix, a fresh child shell uses Mountain time so the
  real DateTime cast crosses the repeated hour. Windows runs the same value
  cases in its configured zone, without changing the machine's time zone.
#>
param([switch]$Cases)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $Cases) {
    $savedZone = $env:TZ
    try {
        $env:TZ = 'America/Denver'
        $output = & (Get-BoxPowerShell) -NoProfile -NonInteractive -File $PSCommandPath -Cases 2>&1
        $code = $LASTEXITCODE
        $output | ForEach-Object { Write-Host $_ }
        if ($code -ne 0) { exit $code }
        if (($output -join "`n") -notmatch '\d+ passed, 0 failed') { throw 'The child did not report a passing summary.' }
    }
    finally { $env:TZ = $savedZone }
    exit 0
}
$root = Split-Path -Parent $PSScriptRoot
function Load-Function([string]$path, [string]$name) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root $path), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ($errors -join "`n") }
    $found = @($ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $name }.GetNewClosure(), $true))
    if ($found.Count -ne 1) { throw ('Expected one function named ' + $name) }
    [scriptblock]::Create($found[0].Extent.Text)
}
. (Load-Function 'scripts/release/Nexus.ps1' 'Get-NexusField')
. (Load-Function 'scripts/release/Send-NexusFile.ps1' 'Latest')
$script:passed = 0; $script:failed = 0
function Check([string]$name, [bool]$ok) {
    if ($ok) { $script:passed++; Write-Host ('PASS  ' + $name) }
    else { $script:failed++; Write-Host ('FAIL  ' + $name) }
}
Write-Host ('Local zone: ' + [TimeZoneInfo]::Local.Id)
if (-not $OnWindows) {
    Check 'the child really runs in Mountain time' ([TimeZoneInfo]::Local.Id -eq 'America/Denver')
}
$zone = [TimeZoneInfo]::FindSystemTimeZoneById('America/Denver')
$earlyTime = [DateTimeOffset]'2026-11-01T07:50:00Z'
$lateTime = [DateTimeOffset]'2026-11-01T08:10:00Z'
$earlyLocal = [TimeZoneInfo]::ConvertTime($earlyTime, $zone)
$lateLocal = [TimeZoneInfo]::ConvertTime($lateTime, $zone)
Check 'the fixture crosses Mountain clock rollback' ($earlyLocal.ToString('HH:mm zzz') -eq '01:50 -06:00' -and $lateLocal.ToString('HH:mm zzz') -eq '01:10 -07:00' -and $earlyLocal.DateTime -gt $lateLocal.DateTime)
$early = [pscustomobject]@{ id = 'early'; uploaded_at = '2026-11-01T07:50:00Z'; category = 'optional'; is_primary = $false }
$late = [pscustomobject]@{ id = 'late'; uploaded_at = '2026-11-01T08:10:00Z'; category = 'main'; is_primary = $true }
foreach ($reverse in @($false, $true)) {
    $versions = if ($reverse) { @($late, $early) } else { @($early, $late) }
    $picked = Latest $versions
    Check ('later UTC upload wins, reversed input ' + $reverse) ($picked.id -eq 'late')
    Check ('category comes from later upload, reversed input ' + $reverse) ($picked.category -eq 'main')
    Check ('primary flag comes from later upload, reversed input ' + $reverse) ($picked.is_primary -eq $true)
}
$offsetEarly = [pscustomobject]@{ id = 'early'; uploaded_at = '2026-11-01T01:50:00-06:00'; category = 'main' }
$offsetLate = [pscustomobject]@{ id = 'late'; uploaded_at = '2026-11-01T01:10:00-07:00'; category = 'main' }
Check 'explicit offsets compare instants, not timestamp text' ((Latest @($offsetLate, $offsetEarly)).id -eq 'late')
$archived = [pscustomobject]@{ id = 'archived'; uploaded_at = '2026-11-01T09:00:00Z'; category = 'archived' }
$removed = [pscustomobject]@{ id = 'removed'; uploaded_at = '2026-11-01T10:00:00Z'; category = 'removed' }
Check 'newer archived and removed versions do not replace a live version' ((Latest @($removed, $late, $archived)).id -eq 'late')
Check 'all-retired selection remains available' ((Latest @($archived, $removed)).id -eq 'removed')
Check 'an empty list has no newest version' ($null -eq (Latest @()))
Write-Host ($script:passed.ToString() + ' passed, ' + $script:failed + ' failed')
if ($script:failed) { exit 1 }
