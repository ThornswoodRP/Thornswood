<#
  test-signing-folder.ps1

      pwsh -NoProfile -File .\scripts\tests\test-signing-folder.ps1

  The signing setup lives in records\signing, and Sign-Artifact.ps1 finds a dlib
  or metadata that signing.json names relative to the repository.

  WHY. Until 25 September the signing setup was C:\tools on Patrick's machine:
  metadata.json and Microsoft's signing client, backed up nowhere and on no
  other machine. It moved into the repository with the rest of the folder
  consolidation (C:\Thornswood-Dev), asked for by Patrick and agreed by
  Djinn. signing.json named C:\tools by full path, so it has to be able to
  name records\signing instead, and that has to mean the repository's, not
  whatever folder the build happens to run from.

  HOW. Sign-Artifact.ps1 is run for real with a signing.json in a temp folder
  whose metadata is "records\signing\metadata.json", from a working folder that
  is not the repository. Since 27 September (#815) the tracked metadata.json
  names the real certificate profile, so the working folder is given a
  records\signing\metadata.json of its own whose profile is still the
  placeholder. Read from the working folder, the script would say "not filled
  in yet" and stop there; read from the repository, it goes on to look for
  signtool. Going on is the proof the relative path was read from the right
  place. The file it is asked to sign does not exist, so nothing is signed
  either way. A signing.json naming that placeholder by full path then shows
  that a half set up machine still signs nothing without failing the build,
  and that -Required stops a release on it. Nothing outside the temp folder
  is written.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in scripts\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
$repo = $Here
$shell = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$meta = Join-Path $Here 'records\signing\metadata.json'
Yes 'records\signing\metadata.json is in the repository' (Test-Path -LiteralPath $meta)
$m = $null
try { $m = Get-Content -LiteralPath $meta -Raw | ConvertFrom-Json } catch { }
Yes 'it names the account, the region and the profile' ($m -and $m.CodeSigningAccountName -eq 'ThornswoodSigning' -and $m.Endpoint -eq 'https://wus2.codesigning.azure.net' -and $m.CertificateProfileName)
$keys = @(); if ($m) { $keys = @($m.PSObject.Properties.Name | Sort-Object) }
Yes 'and nothing else, so nothing secret can sit in it unnoticed' (($keys -join ',') -eq 'CertificateProfileName,CodeSigningAccountName,Endpoint')
function Ignored([string]$rel) { & git -C $repo check-ignore -q $rel 2>$null; return ($LASTEXITCODE -eq 0) }
Yes 'records\signing\client is ignored by git' (Ignored 'records/signing/client/Azure.CodeSigning.Dlib.dll')
Yes 'and metadata.json is not' (-not (Ignored 'records/signing/metadata.json'))

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-signing-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
Push-Location $work
try {
    # The decoy: the same relative path under the working folder, with the
    # placeholder profile the example carries.
    $decoyDir = Join-Path $work 'records\signing'
    New-Item -ItemType Directory -Force -Path $decoyDir | Out-Null
    $decoy = Join-Path $decoyDir 'metadata.json'
    [IO.File]::WriteAllText($decoy, '{"Endpoint":"https://wus2.codesigning.azure.net","CodeSigningAccountName":"ThornswoodSigning","CertificateProfileName":"FILL THIS IN"}')
    $sign = Join-Path $Here 'scripts\release\Sign-Artifact.ps1'

    $cfg = Join-Path $work 'signing.json'
    [IO.File]::WriteAllText($cfg, '{"method":"artifactsigning","dlib":"records\\signing\\client\\Azure.CodeSigning.Dlib.dll","metadata":"records\\signing\\metadata.json"}')
    $out = & $shell -NoProfile -File $sign -Path (Join-Path $work 'nothing.exe') -ConfigPath $cfg 2>&1 | Out-String
    Yes 'a relative metadata path is read from the repository, not from the working folder' (
        $out -notmatch 'not filled in yet' -and $out -match 'signtool')

    $half = Join-Path $work 'half.json'
    [IO.File]::WriteAllText($half, ('{"method":"artifactsigning","dlib":"records\\signing\\client\\Azure.CodeSigning.Dlib.dll","metadata":' + (ConvertTo-Json $decoy) + '}'))
    $out = & $shell -NoProfile -File $sign -Path (Join-Path $work 'nothing.exe') -ConfigPath $half 2>&1 | Out-String
    $code = $LASTEXITCODE
    Yes 'with no certificate profile yet it signs nothing and does not fail the build' ($code -eq 0 -and $out -match 'not filled in yet')
    $out = & $shell -NoProfile -File $sign -Path (Join-Path $work 'nothing.exe') -ConfigPath $half -Required 2>&1 | Out-String
    Yes 'with -Required, the same missing profile stops a release' ($LASTEXITCODE -ne 0 -and $out -match 'not filled in yet')
}
finally {
    Pop-Location
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
