<#
  Sign-ReleaseCatalog.ps1

  Signs the release manifest's catalog with ThornswoodRelease and checks it the
  way every installed launcher checks a launcher (#2163, phase B).

      . (Join-Path $PSScriptRoot 'Sign-ReleaseCatalog.ps1')
      $why = Invoke-ReleaseCatalogSign $catalog $repoDir     '' when signed and accepted

  Sign-Artifact.ps1 -Required, the one signing path (Azure Artifact Signing,
  records\signing\signing.json), then Get-PublishSignRefusal
  (Assert-PublishSigned.ps1): Authenticode Valid, the Subject names
  ExpectedSigner, and launcher\app\Signature.cs passes. Measured 18 Oct on One:
  the ThornswoodRelease profile signs a New-FileCatalog catalog, with a
  timestamp, and Signature.cs accepts it.

  A file of its own so a harness that runs the real Publish-Update.ps1 with no
  signing setup can stand a stub in for it in its copy of the scripts, as it
  does for Close-Launcher.ps1. Nothing in the release path skips it: a catalog
  that is not signed and accepted stops the publish before version.json moves.

  Keep it ASCII. It runs in PowerShell 7.
#>

. (Join-Path $PSScriptRoot 'Assert-PublishSigned.ps1')

function Invoke-ReleaseCatalogSign([string]$Catalog, [string]$RepoDir) {
    if (-not $Catalog -or -not (Test-Path -LiteralPath $Catalog -PathType Leaf)) { return "there is no catalog at $Catalog to sign" }
    $signer = Join-Path $PSScriptRoot 'Sign-Artifact.ps1'
    $global:LASTEXITCODE = 0
    try { & $signer -Path $Catalog -Required | Out-Host }
    catch { return ('Sign-Artifact.ps1 stopped: ' + $_.Exception.Message) }
    if ($LASTEXITCODE -ne 0) { return "Sign-Artifact.ps1 -Required exited $LASTEXITCODE" }
    $expected = ''
    try { $expected = Get-ExpectedSignerFragment -RepoRoot $RepoDir } catch { return ('ExpectedSigner could not be read: ' + $_.Exception.Message) }
    if (-not $expected) { return 'ExpectedSigner is empty, so the signed catalog cannot be checked' }
    return (Get-PublishSignRefusal -Path $Catalog -ExpectedSigner $expected)
}
