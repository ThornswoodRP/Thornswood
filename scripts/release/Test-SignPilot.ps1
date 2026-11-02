<#
.SYNOPSIS
  Signs and verifies a throwaway TEST artifact only, to pilot the signed release design (issue #2163). Never touches a release, the feed or release.yml.

.DESCRIPTION
  The pilot in docs\SIGNED-RELEASES.md. Two halves.

  -Sign builds a tiny console exe that is not Thornswood and never ships,
  hashes it unsigned, signs it with the same scripts\release\Sign-Artifact.ps1
  -Required that Build-Launcher and Package use (Azure Artifact Signing, the
  ThornswoodRelease profile, so it needs this machine's records\signing\signing.json
  and an az login that holds the signer role), then runs the verify half on
  what came out and writes, into -Out:
    pilot.exe        the signed test exe
    SHA256SUMS       its sha256, the same shape release.yml writes
    provenance.json  source commit, engine pin, machine, both hashes, signer check,
                     timestamp, the root and durable identity it chained to

  -Verify reads such a folder and checks, without signing anything and
  without the Azure sign in:
    1. SHA256SUMS still matches pilot.exe (the checksum layer stays first);
    2. provenance.json names the same signed hash;
    3. Get-PublishSignRefusal (Assert-PublishSigned.ps1), which is the Ship
       gate and runs launcher\app\Signature.cs, the launcher's own check,
       says nothing is wrong;
    4. a copy with one byte changed is refused by both the checksum and the
       signature check (failed-signature behaviour: refuse, never warn).
  Exit 0 only when every check holds.

  It holds no key or password. The sign in is the credential, as everywhere
  else in records\signing.

.EXAMPLE
  .\scripts\release\Test-SignPilot.ps1 -Sign -Out $env:TEMP\sign-pilot
  .\scripts\release\Test-SignPilot.ps1 -Verify -Out $env:TEMP\sign-pilot
#>
[CmdletBinding()]
param(
    [switch]$Sign,
    [switch]$Verify,
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$ConfigPath,
    [string]$ExpectedSigner
)

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'Assert-PublishSigned.ps1')
if (-not $ExpectedSigner) { $ExpectedSigner = Get-ExpectedSignerFragment -RepoRoot $Repo }
if (-not ($Sign -or $Verify)) { Write-Host 'Say -Sign, -Verify or both.' -ForegroundColor Red; exit 2 }

function Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
$fails = 0
function Check([bool]$ok, [string]$what) {
    if ($ok) { Write-Host ("PASS  " + $what) -ForegroundColor Green }
    else { Write-Host ("FAIL  " + $what) -ForegroundColor Red; $script:fails++ }
}

$exe = Join-Path $Out 'pilot.exe'
$sums = Join-Path $Out 'SHA256SUMS'
$prov = Join-Path $Out 'provenance.json'

if ($Sign) {
    New-Item -ItemType Directory -Force -Path $Out | Out-Null
    Remove-Item -LiteralPath $exe, $sums, $prov -Force -EA SilentlyContinue
    $src = 'public static class SignPilot { public static int Main() { System.Console.WriteLine("Thornswood signing pilot, issue 2163. Not a release."); return 0; } }'
    # PowerShell 7's Add-Type writes no exe, so the .NET SDK the launcher
    # builds with makes it (#5356, #4823): a one file project, built with its
    # apphost, the exe that is signed.
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $dotnet) { Write-Host 'No .NET SDK: dotnet is not on this machine (docs/guide/set-up-a-machine.md, "Setting up a machine").' -ForegroundColor Red; exit 1 }
    $proj = Join-Path $Out 'pilot-src'
    New-Item -ItemType Directory -Force -Path $proj | Out-Null
    [IO.File]::WriteAllText((Join-Path $proj 'pilot.cs'), $src)
    [IO.File]::WriteAllText((Join-Path $proj 'pilot.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><AssemblyName>pilot</AssemblyName><UseAppHost>true</UseAppHost><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>')
    $built = Join-Path $proj 'bin'
    $said = @(& $dotnet.Source build (Join-Path $proj 'pilot.csproj') -c Release -o $built --nologo -v minimal --disable-build-servers 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $built 'pilot.exe'))) {
        $said | ForEach-Object { Write-Host $_ }; Write-Host 'The .NET SDK refused the test exe; nothing was signed.' -ForegroundColor Red; exit 1
    }
    Copy-Item -LiteralPath (Join-Path $built 'pilot.exe') -Destination $exe -Force
    Remove-Item -LiteralPath $proj -Recurse -Force
    $unsigned = Sha $exe
    Write-Host ("unsigned sha256  " + $unsigned)
    $signArgs = @{ Path = @($exe); Required = $true }
    if ($ConfigPath) { $signArgs.ConfigPath = $ConfigPath }
    & (Join-Path $PSScriptRoot 'Sign-Artifact.ps1') @signArgs
    if ($LASTEXITCODE -ne 0) { Write-Host 'Signing failed; nothing is written as signed.' -ForegroundColor Red; exit 1 }
    $signed = Sha $exe
    $sig = Get-AuthenticodeSignature -LiteralPath $exe
    $engine = (git -C $Repo ls-tree HEAD engine/skymp 2>$null) -replace '^\S+\s+\S+\s+(\S+).*$', '$1'
    Set-Content -LiteralPath $sums -Value ("$signed  pilot.exe") -Encoding ascii
    [ordered]@{
        issue          = 2163
        artifact       = 'pilot.exe (test only, never shipped)'
        sourceCommit   = (git -C $Repo rev-parse HEAD)
        engineSkymp    = $engine
        machine        = $env:COMPUTERNAME
        signedAtUtc    = (Get-Date).ToUniversalTime().ToString('o')
        unsignedSha256 = $unsigned
        signedSha256   = $signed
        digest         = 'SHA256 file digest, RFC 3161 SHA256 timestamp'
        timestampUrl   = 'http://timestamp.acs.microsoft.com'
        # Not the Subject: the name on the certificate lives in Updater.cs and nowhere else git holds.
        signerMatchesExpectedSigner = ($sig.SignerCertificate.Subject.IndexOf($ExpectedSigner, [StringComparison]::OrdinalIgnoreCase) -ge 0)
        signerIssuer   = $sig.SignerCertificate.Issuer
        signerExpires  = $sig.SignerCertificate.NotAfter.ToUniversalTime().ToString('o')
        timestamper    = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { '' }
    } | ConvertTo-Json | Set-Content -LiteralPath $prov -Encoding utf8
    Write-Host ("signed sha256    " + $signed)
}

if ($Verify) {
    Check (Test-Path -LiteralPath $exe) 'pilot.exe is there'
    Check (Test-Path -LiteralPath $sums) 'SHA256SUMS is there'
    if ($fails) { exit 1 }
    $have = Sha $exe
    $line = (Get-Content -LiteralPath $sums | Select-Object -First 1)
    Check ($line -eq "$have  pilot.exe") 'SHA256SUMS matches pilot.exe (checksum first, as Ship does)'
    if (Test-Path -LiteralPath $prov) {
        $p = Get-Content -LiteralPath $prov -Raw | ConvertFrom-Json
        Check ($p.signedSha256 -eq $have) 'provenance.json names the same signed hash'
        Check ($p.unsignedSha256 -ne $have) 'the signed bytes differ from the unsigned build (a signature was added)'
    } else { Check $false 'provenance.json is there' }
    $why = Get-PublishSignRefusal -Path $exe -ExpectedSigner $ExpectedSigner
    Check (-not $why) ('the Ship gate and the launcher check accept it' + $(if ($why) { ': ' + $why } else { '' }))
    $bad = Join-Path ([IO.Path]::GetTempPath()) ('sign-pilot-tampered-' + [guid]::NewGuid().ToString('N') + '.exe')
    try {
        # Offset 0x4E is the DOS stub text, inside what Authenticode hashes. The middle of a small signed exe is the signature blob itself, which the hash leaves out, so a change there proves nothing.
        $b = [IO.File]::ReadAllBytes($exe); $b[0x4E] = $b[0x4E] -bxor 0xFF
        [IO.File]::WriteAllBytes($bad, $b)
        Check ((Sha $bad) -ne $have) 'a one byte change fails the checksum'
        Check ([bool](Get-PublishSignRefusal -Path $bad -ExpectedSigner $ExpectedSigner)) 'a one byte change fails the signature check'
    } finally { Remove-Item -LiteralPath $bad -Force -EA SilentlyContinue }
}

if ($fails) { Write-Host ("$fails check(s) failed") -ForegroundColor Red; exit 1 }
Write-Host 'pilot OK' -ForegroundColor Green
exit 0
