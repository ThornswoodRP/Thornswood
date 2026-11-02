<#
  test-app-ico-png.ps1

      pwsh -NoProfile -File .\launcher\tests\test-app-ico-png.ps1

  launcher\app.ico must carry seven frames and every frame must be PNG
  compressed. Issue #426: the 16-128 frames used to be uncompressed bitmaps.
  Pixels are not rechecked here; Build-Launcher embedding is a separate prove.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
$ico = Join-Path $repo 'launcher\app.ico'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

Yes 'launcher\app.ico is there' (Test-Path -LiteralPath $ico)
if (-not (Test-Path -LiteralPath $ico)) {
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}

$b = [IO.File]::ReadAllBytes($ico)
Yes 'it is an ICO (reserved=0 type=1)' ($b.Length -ge 6 -and $b[0] -eq 0 -and $b[1] -eq 0 -and $b[2] -eq 1 -and $b[3] -eq 0)
$n = [BitConverter]::ToUInt16($b, 4)
Yes 'it has seven frames' ($n -eq 7)

$pngSig = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
$sizes = @()
$allPng = $true
0..($n - 1) | ForEach-Object {
    $o = 6 + $_ * 16
    $w = if ($b[$o] -eq 0) { 256 } else { $b[$o] }
    $h = if ($b[$o + 1] -eq 0) { 256 } else { $b[$o + 1] }
    $sz = [BitConverter]::ToUInt32($b, $o + 8)
    $off = [BitConverter]::ToUInt32($b, $o + 12)
    $isPng = ($off + 8 -le $b.Length) -and (@(Compare-Object $b[$off..($off + 7)] $pngSig -SyncWindow 0).Count -eq 0)
    if (-not $isPng) { $allPng = $false }
    $sizes += $w
    Write-Host ("  frame {0}x{1}  bytes={2}  png={3}" -f $w, $h, $sz, $isPng)
}
Yes 'every frame is PNG-compressed' $allPng
Yes 'sizes are 16 24 32 48 64 128 256' (
    ($sizes -join ',') -eq '16,24,32,48,64,128,256')
Yes 'no em dash in this harness' (-not ([IO.File]::ReadAllText($PSCommandPath)).Contains([string][char]0x2014))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
