<#
  test-scripts-no-literal-feff.ps1

      pwsh -NoProfile -File .\tests\test-scripts-no-literal-feff.ps1
      powershell -NoProfile -File .\tests\test-scripts-no-literal-feff.ps1

  No script under scripts\ may embed a literal U+FEFF (byte order mark)
  character in its source. A leading UTF-8 BOM on the file itself is fine;
  stripping a BOM from JSON must use [char]0xFEFF (or TrimStart) so Windows
  PowerShell 5.1 does not misread the literal as ??? (issue #1182).
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Scripts = Join-Path $Repo 'scripts'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

Yes 'scripts\ exists' (Test-Path -LiteralPath $Scripts)
if (-not (Test-Path -LiteralPath $Scripts)) {
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}

$bomUtf8 = [byte[]](0xEF, 0xBB, 0xBF)
$hits = New-Object System.Collections.Generic.List[string]
foreach ($f in Get-ChildItem -LiteralPath $Scripts -Recurse -Filter *.ps1 -File) {
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    $start = 0
    if ($bytes.Length -ge 3 -and $bytes[0] -eq $bomUtf8[0] -and $bytes[1] -eq $bomUtf8[1] -and $bytes[2] -eq $bomUtf8[2]) {
        $start = 3
    }
    for ($i = $start; $i -le $bytes.Length - 3; $i++) {
        if ($bytes[$i] -eq $bomUtf8[0] -and $bytes[$i + 1] -eq $bomUtf8[1] -and $bytes[$i + 2] -eq $bomUtf8[2]) {
            $rel = $f.FullName.Substring($Repo.Length).TrimStart('\', '/')
            $hits.Add(("$rel @ byte {0}" -f $i))
            break
        }
    }
}

Yes 'no scripts\*.ps1 embeds a literal U+FEFF after an optional leading BOM' ($hits.Count -eq 0)
if ($hits.Count) {
    foreach ($h in $hits) { Write-Host ("  {0}" -f $h) -ForegroundColor Red }
}

$ship = Join-Path $Repo 'scripts\release\Ship.ps1'
$shipText = [IO.File]::ReadAllText($ship)
# Ship read the feed's launcher with a BOM stripped until #4825, when it
# stopped reading one; what it still holds is held the same way.
Yes 'Ship.ps1 holds no literal U+FEFF, so any mark it strips is written [char]0xFEFF (ASCII-only source)' (
    $shipText.IndexOf([char]0xFEFF) -lt 0
)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
