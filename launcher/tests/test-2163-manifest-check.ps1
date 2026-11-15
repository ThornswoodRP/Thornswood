<#
  test-2163-manifest-check.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2163-manifest-check.ps1

  The reader of a signed catalog's members (launcher\app\ReleaseManifest.cs,
  CatalogDigests, #2163), which the signed release record of every merge
  release is read through (VeloRecord.cs), compiled on its own with
  Signature.cs, against tests\fixtures\2163-manifest: a release.json and its
  catalog, which ThornswoodRelease really signed on 19 Oct (one signature, on
  One). The fixture names assets that do not exist and was never shipped.

  WHY. The record a launcher update is held to is a catalog over
  manifest.json; the launcher takes the record only when the catalog is
  signed by Thornswood (Signature.Refusal) and lists manifest.json's sha256
  as it arrived. A reader that lists a digest the catalog does not hold would
  pass a manifest nobody signed. The check of the old update feed's
  release.json against the feed went with the feed (#5608).

  What it runs:
    1. The fixture as signed: its catalog is Thornswood's, and its digests
       include release.json's sha256.
    2. A release.json changed after signing: its sha256 is not among them.
    3. The same release.json under a catalog nobody signed: Signature.cs
       refuses it.
    4. A catalog that is not there: CatalogDigests throws.
    5. The wiring, by text: VeloRecord holds manifest.json to the catalog's
       digests after Signature.Refusal.

  The compile and 5 run everywhere. 1 to 4 run on Windows only: Signature.cs
  and ReleaseManifest.cs ask wintrust (WinVerifyTrust and the catalog calls).

  Reads the fixture, writes only a temp folder, sends nothing. Signature.cs
  asks Windows about revocation; with no network it says so and checks
  without. Keep it ASCII. PowerShell 7: the launcher's code is .NET 10
  (#4823), which Windows PowerShell 5.1 cannot load.
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$App = Join-Path $Repo 'launcher\app'
$Fix = Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'fixtures\2163-manifest'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# Compiled the way the build compiles the launcher (Launcher-Csc.ps1, the .NET
# SDK, #4823), the two files on their own, with the reader of loose JSON
# strings ReleaseManifest's generated JSON code names. The type is taken from the assembly
# that build returns, so a session that already loaded another copy is not
# answered by it.
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
$RM = $null
try { $RM = (Add-LauncherType -File (Join-Path $App 'Signature.cs'), (Join-Path $App 'ReleaseManifest.cs')).GetType('Thornswood.ReleaseManifest') }
catch { ($_.Exception.Message -split "`n") | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'Signature.cs and ReleaseManifest.cs compile on their own with the .NET SDK the launcher builds with' ($null -ne $RM)
if (-not $RM) { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit 1 }
$SG = $RM.Assembly.GetType('Thornswood.Signature')
# The name on the signing certificate, written once, in Updater.cs (#1052).
$Signer = [regex]::Match([IO.File]::ReadAllText((Join-Path $App 'Updater.cs')), 'const string ExpectedSigner = "([^"]+)"').Groups[1].Value
Yes 'ExpectedSigner is read from launcher\app\Updater.cs' ([bool]$Signer)
if ($OnWindows) {
    function Signed([string]$cat) {
        $a = [object[]]@($cat, $Signer, $null)
        return [string]$SG.GetMethod('Refusal', [type[]]@([string], [string], [string].MakeByRefType())).Invoke($null, $a)
    }
    function Digests([string]$cat) { return $RM.GetMethod('CatalogDigests').Invoke($null, [object[]]@([string]$cat)) }

    $cat = Join-Path $Fix 'release.cat'
    $json = Join-Path $Fix 'release.json'
    Yes 'the fixture is there: release.json and its signed catalog' ((Test-Path -LiteralPath $cat) -and (Test-Path -LiteralPath $json))

    # ---- 1. as signed ---------------------------------------------------------------
    Yes 'the fixture''s catalog is signed by Thornswood' ((Signed $cat) -eq '')
    $jsonSha = (Get-FileHash -LiteralPath $json -Algorithm SHA256).Hash.ToLowerInvariant()
    Yes "  and its digests include release.json's sha256" ((Digests $cat).Contains($jsonSha))

    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2163c-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null
    try {
        # ---- 2. release.json changed after signing ----------------------------------
        $changed = Join-Path $scratch 'release.json'
        [IO.File]::WriteAllText($changed, ([IO.File]::ReadAllText($json)) + ' ', (New-Object Text.UTF8Encoding($false)))
        $changedSha = (Get-FileHash -LiteralPath $changed -Algorithm SHA256).Hash.ToLowerInvariant()
        Yes 'a release.json changed after signing is not among the digests' (-not (Digests $cat).Contains($changedSha))

        # ---- 3. a catalog nobody signed -----------------------------------------------
        $files = Join-Path $scratch 'files'
        New-Item -ItemType Directory -Force -Path $files | Out-Null
        Copy-Item -LiteralPath $json -Destination (Join-Path $files 'release.json')
        $bare = Join-Path $scratch 'unsigned.cat'
        New-FileCatalog -Path $files -CatalogFilePath $bare -CatalogVersion 2.0 | Out-Null
        Yes 'the same release.json under a catalog nobody signed is refused by Signature.cs' ((Signed $bare).Length -gt 0)

        # ---- 4. no catalog -------------------------------------------------------------
        $threw = $false
        try { Digests (Join-Path $scratch 'missing.cat') | Out-Null } catch { $threw = $true }
        Yes 'a catalog that is not there throws, so nothing is taken' $threw
    } finally {
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host 'SKIP  1 to 4, the catalog run: Signature.cs and ReleaseManifest.cs ask wintrust (WinVerifyTrust and the catalog calls), which only Windows has'
}

# ---- 5. the wiring ----------------------------------------------------------------
$vr = [IO.File]::ReadAllText((Join-Path $App 'VeloRecord.cs')).Replace("`r`n", "`n")
$iSig = $vr.IndexOf('string why = Signature.Refusal(catPath, Updater.ExpectedSigner, out signedSaid);')
$iDig = $vr.IndexOf('if (!ReleaseManifest.CatalogDigests(catPath).Contains(jsonSha))')
Yes 'VeloRecord holds the catalog to the launcher''s own signer, then manifest.json to its digests' ($iSig -gt 0 -and $iDig -gt $iSig)
Yes 'the old update feed''s manifest check is gone' (-not (Test-Path -LiteralPath (Join-Path $App 'FeedManifest.cs')) -and -not ([IO.File]::ReadAllText((Join-Path $App 'ReleaseManifest.cs')) -match 'public static string Refusal'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
