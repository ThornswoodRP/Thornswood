<#
  test-signer-check.ps1

      pwsh -NoProfile -File .\tests\test-signer-check.ps1
      pwsh -NoProfile -File .\tests\test-signer-check.ps1 -Signed <a signed Thornswood.exe>

  The check a launcher runs on a downloaded launcher before it goes in
  (launcher\app\Signature.cs, which the Velopack update asks in VeloPackage.cs
  and VeloUpdate.cs since #4825), pointed at real files.

  WHY THIS EXISTS. Issue #912. Until then the check read the Subject of the
  embedded certificate (X509Certificate.CreateFromSignedFile) and looked for
  the signer's name in it. That call verifies nothing, so a certificate anybody
  can make on their own machine with that name passed. This proves the new
  check on each file it has to decide:

    accepted  the real signed dev launcher (by default
              C:\Thornswood-DevBuild\Launcher\Thornswood.exe), and a copy of
              it in another folder.
    refused   an unsigned exe; the same exe signed with a self-made
              certificate named as the signer, and with one that also copies
              every usage Thornswood's real certificate carries; a program
              validly signed by another publisher (csc.exe: Refusal refuses
              it, it is not Thornswood's identity); a program signed
              through Artifact Signing by another publisher (Git for
              Windows), even asked for its own name; the real launcher with one
              byte changed; the real launcher asked for another identity or
              another name.

  For the self-made certificate it also runs the old Subject read, to show
  that one passed (the bug this closes).

  A Windows file signed only in a catalog, with nothing in the file, is
  refused as not signed. Trust asks WinVerifyTrust with WTD_CHOICE_FILE, so
  catalogs are never honoured (#2046). (Signature.MicrosoftRefusal, which
  voice asked before it ran the WebView2 installer, #1330, went with the web
  view in #4823, and its checks here with it.)

  The self-made certificates are made with New-SelfSignedCertificate in the
  CurrentUser store, used once, and removed from every CurrentUser store
  before this ends, whatever happens. Nothing is trusted, nothing is written
  outside its own temp folder, and nothing touches the network except what
  Windows itself asks for to check revocation.

  When the signed launcher is not on this machine (the VPS), the cases that
  need it say SKIP and are not counted; the refusals are still proved.

  It also runs scripts\release\Assert-PublishSigned.ps1's gate on the same
  files, because Ship must refuse whatever the launcher would.

  Builds Signature.cs with the .NET 10 SDK the way the launcher project
  does (tests\Launcher-Csc.ps1) and runs it in this PowerShell, which is
  .NET 10 as the launcher is. Assert-PublishSigned.ps1 compiles the same file
  with Add-Type when it runs on the box (the check from Sign-OnGitHub.ps1),
  which runs PowerShell 7 since #5356, so that compile is run too, in this
  same PowerShell. Windows only: the check is WinVerifyTrust, and the
  certificates are Windows' own store.
#>
[CmdletBinding()]
param([string]$Signed = '')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's SDK and settings, and $OnWindows
if (-not $OnWindows) { Write-Host 'NOT RUN  Signature.Refusal asks WinVerifyTrust, and the certificates are made in Windows'' own store, which only Windows has'; exit 0 }
if (-not $Signed) { $Signed = Join-Path ([string](& (Join-Path $PSScriptRoot '..\scripts\release\Where.ps1') InstallDev)) 'Launcher\Thornswood.exe' }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$App = Join-Path $Repo 'launcher\app'
# The name on the signing certificate, read from the one place it is written,
# ExpectedSigner in launcher\app\Updater.cs, so no other file carries it (#1052).
$Signer = ''
$m = [regex]::Match([IO.File]::ReadAllText((Join-Path $App 'Updater.cs')), 'const string ExpectedSigner = "([^"]+)"')
if ($m.Success) { $Signer = $m.Groups[1].Value }
if (-not $Signer) { Write-Host 'FAIL  ExpectedSigner could not be read from launcher\app\Updater.cs'; exit 1 }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }
function Finish {
    Write-Host ''
    Write-Host "$($script:pass) passed, $($script:fail) failed"
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- the sources say what they should ---------------------------------------
$sigCs = Join-Path $App 'Signature.cs'
Yes 'launcher\app\Signature.cs exists' (Test-Path -LiteralPath $sigCs)
if (-not (Test-Path -LiteralPath $sigCs)) { Finish }
$sigSrc = [IO.File]::ReadAllText($sigCs)
$upd = [IO.File]::ReadAllText((Join-Path $App 'Updater.cs'))
Yes 'Signature.cs has no C# 6: no $", no ?., no nameof' (-not ($sigSrc -match '\$"|\?\.|nameof\('))
Yes 'Signature.cs asks WinVerifyTrust with WINTRUST_ACTION_GENERIC_VERIFY_V2' (
    $sigSrc -match 'WinVerifyTrust' -and $sigSrc -match '00AAC56B-CD44-11d0-8CC2-00C04FC295EE')
Yes 'Signature.Trust asks WinVerifyTrust with WTD_CHOICE_FILE, never a catalog' (
    $sigSrc -match 'WTD_CHOICE_FILE = 1' -and $sigSrc -match 'dwUnionChoice = WTD_CHOICE_FILE' -and
    $sigSrc -notmatch 'WTD_CHOICE_CATALOG')
# Since #4825 the launcher's own update is Velopack's, and its checks ask
# Signature.Refusal: every program in the package (VeloPackage.cs) and the
# Update.exe that applies it (VeloUpdate.cs). Updater.CheckSigner went with
# the self update.
$velo = [IO.File]::ReadAllText((Join-Path $App 'VeloUpdate.cs'))
$veloPkg = [IO.File]::ReadAllText((Join-Path $App 'VeloPackage.cs'))
Yes 'the launcher update checks every program in the package and Velopack''s Update.exe through Signature.Refusal' (
    $veloPkg -match 'Signature\.Refusal\(tmp, expectedSigner, out signerSaid\)' -and
    $velo -match 'Signature\.Refusal\(updateExe, ExpectedSigner, out exeSaid\)')
Yes 'nothing in the launcher decides a signer from CreateFromSignedFile any more' (
    -not (@(Get-ChildItem (Join-Path $App '*.cs') | Where-Object {
        [IO.File]::ReadAllText($_.FullName) -match 'CreateFromSignedFile\s*\(' }).Count))

# ---- build Signature.cs on its own -------------------------------------------
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Finish }
# Programs Microsoft signed that every Windows has, for the refusals below;
# nothing is compiled with them.
$fw = Get-WindowsPath 'Microsoft.NET\Framework64\v4.0.30319'

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tssigner-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $tmp
$made = @()

function Drop-Cert([string]$thumb) {
    foreach ($store in 'My', 'CA', 'Root', 'TrustedPublisher', 'Disallowed') {
        $p = "Cert:\CurrentUser\$store\$thumb"
        if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
    }
}

try {
    # Assert-PublishSigned.ps1 compiles this file with Add-Type where it runs
    # on the box (the catalog check), and the box runs PowerShell 7 (#5356),
    # the one running this harness. It is asked in a new process of that
    # PowerShell, the way that script asks it, so no type this harness has
    # already loaded answers for it.
    $boxPs = [Environment]::ProcessPath
    $assert = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'release') 'Assert-PublishSigned.ps1'
    # Single quotes after the path: $t is the child's, not this harness's.
    $probe = ". '" + $assert.Replace("'", "''") + "'; " + '$t = Get-LauncherSignatureType; if ($t) { ''COMPILED '' + $t.FullName } else { ''NO TYPE'' }'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $said = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -Command $probe 2>&1 | ForEach-Object { "$_" })
    $ErrorActionPreference = $old
    $compiled = @($said | Where-Object { $_ -match '^COMPILED ThornswoodSign[0-9a-f]+\.Signature$' }).Count -eq 1
    if (-not $compiled) { foreach ($l in @($said | Select-Object -First 20)) { Write-Host "      $l" } }
    Yes 'Signature.cs compiles in the box''s PowerShell with Add-Type, as Assert-PublishSigned.ps1 compiles it there' $compiled

    # The launcher's own build of it, by the project's settings.
    $asm = $null
    try { $asm = Add-LauncherType -File $sigCs }
    catch { foreach ($l in @(($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20)) { Write-Host "      $l" } }
    Yes 'Signature.cs builds on its own the way the launcher project builds it' ($null -ne $asm)
    if ($null -eq $asm) { Finish }
    $S = $asm.GetType('Thornswood.Signature')
    $flags = [Reflection.BindingFlags]'Static, Public'
    $three = $S.GetMethod('Refusal', $flags, $null,
        [Type[]]@([string], [string], [string].MakeByRefType()), $null)
    $four = $S.GetMethod('Refusal', $flags, $null,
        [Type[]]@([string], [string], [string[]], [string].MakeByRefType()), $null)
    Yes 'Signature.Refusal is there, with and without an identity list' ($null -ne $three -and $null -ne $four)
    $ids = [string[]]$S.GetField('Identities').GetValue($null)

    function Check([string]$path, [string]$who) {
        $a = [object[]]@($path, $who, $null)
        $why = [string]$three.Invoke($null, $a)
        return @{ Why = $why; Said = [string]$a[2] }
    }
    function CheckAs([string]$path, [string]$who, [string[]]$idList) {
        $a = [object[]]@($path, $who, $idList, $null)
        return [string]$four.Invoke($null, $a)
    }
    # What the launcher did before #912, kept here only to show it passed.
    function OldCheck([string]$path, [string]$who) {
        try {
            $c = [Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($path)
            return ($c.Subject.IndexOf($who, [StringComparison]::OrdinalIgnoreCase) -ge 0)
        } catch { return $false }
    }
    # The certificate embedded in the file, which WinVerifyTrust with
    # WTD_CHOICE_FILE checks. Get-AuthenticodeSignature on a dual-signed
    # Windows file such as csc.exe returns the catalog signer instead.
    function Get-EmbeddedCert([string]$path) {
        try {
            $raw = [Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($path)
            return New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $raw
        } catch { return $null }
    }

    . (Join-Path $Repo 'scripts\release\Assert-PublishSigned.ps1')

    # ---- a real signed launcher is accepted --------------------------------
    $haveSigned = $Signed -and (Test-Path -LiteralPath $Signed)
    if ($haveSigned) {
        $r = Check $Signed $Signer
        Yes ('the real signed launcher is accepted: ' + $(if ($r.Why) { $r.Why } else { $r.Said })) ($r.Why -eq '')
        Yes 'the log line says who signed it and that it is timestamped' (
            $r.Said -match [regex]::Escape($Signer) -and $r.Said -match 'Artifact Signing' -and $r.Said -match 'timestamped')
        $copy = Join-Path $tmp 'elsewhere\Thornswood.exe'
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $copy)
        Copy-Item -LiteralPath $Signed -Destination $copy
        $r = Check $copy $Signer
        Yes 'a copy of it in another folder is accepted' ($r.Why -eq '')
        $g = Get-PublishSignRefusal -Path $Signed -ExpectedSigner $Signer
        Yes ('the publish gate accepts it too' + $(if ($g) { ': ' + $g } else { '' })) ($g -eq '')

        $r = Check $Signed 'Somebody Else'
        Yes ('asked for another name, it is refused: ' + $r.Why) ($r.Why -match 'does not name Somebody Else')
        $why = CheckAs $Signed $Signer @('1.3.6.1.4.1.311.97.1.2.3.4')
        Yes ('asked for another identity, it is refused: ' + $why) ($why -match "somebody else's identity")

        # One byte in the middle of the file, well before the signature at its end.
        $flip = Join-Path $tmp 'flipped\Thornswood.exe'
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $flip)
        $bytes = [IO.File]::ReadAllBytes($Signed)
        $at = [int]($bytes.Length / 3)
        $bytes[$at] = $bytes[$at] -bxor 0xFF
        [IO.File]::WriteAllBytes($flip, $bytes)
        $r = Check $flip $Signer
        Yes ('the real launcher with one byte changed is refused: ' + $r.Why) ($r.Why -match 'changed since it was signed')
        Yes 'the old Subject read would have passed the changed file' (OldCheck $flip $Signer)
        $g = Get-PublishSignRefusal -Path $flip -ExpectedSigner $Signer
        Yes 'the publish gate refuses the changed file' ($g -ne '')
    } else {
        Skip "no signed launcher at $Signed on this machine: accepted, byte changed and another identity not run"
    }

    # ---- an unsigned exe is refused ----------------------------------------
    # A program built here, so signed by nobody: the SDK's build of a Main
    # that does nothing, under the launcher's name.
    $stub = Join-Path $tmp 'unsigned\Thornswood.exe'
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stub)
    $ok = $false
    try {
        $built = Build-LauncherCode -Source 'static class P { static void Main() { } }' -Exe
        Copy-Item -LiteralPath $built -Destination $stub
        $ok = Test-Path -LiteralPath $stub
    } catch { foreach ($l in @(($_.Exception.Message -split "`r?`n") | Select-Object -First 20)) { Write-Host "      $l" } }
    Yes 'a stand-in program builds' $ok
    if ($ok) {
        $r = Check $stub $Signer
        Yes ('an unsigned exe is refused: ' + $r.Why) ($r.Why -eq 'is not signed.')
    }
    $junk = Join-Path $tmp 'junk\Thornswood.exe'
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $junk)
    [IO.File]::WriteAllBytes($junk, [byte[]](0x4D, 0x5A, 0, 0, 0, 0, 0, 0))
    $r = Check $junk $Signer
    Yes ('a file that is not a program is refused: ' + $r.Why) ($r.Why -ne '')
    $r = Check (Join-Path $tmp 'gone.exe') $Signer
    Yes ('a missing file is refused: ' + $r.Why) ($r.Why -match 'could not be opened')

    # ---- self-made certificates named as the signer are refused ------------
    if ($ok -and (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
        $plain = New-SelfSignedCertificate -Type CodeSigningCert -Subject ('CN=' + $Signer + ', O=' + $Signer + ', C=US') `
                    -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddDays(2)
        $made += $plain.Thumbprint
        # Every usage the real one carries, Thornswood's durable identity included.
        $eku = '2.5.29.37={text}1.3.6.1.5.5.7.3.3,1.3.6.1.4.1.311.97.1.0,' + $ids[0]
        $forged = New-SelfSignedCertificate -Type Custom -Subject ('CN=' + $Signer + ', O=' + $Signer + ', C=US') `
                    -KeyUsage DigitalSignature -TextExtension @($eku) `
                    -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddDays(2)
        $made += $forged.Thumbprint

        foreach ($pair in @(@('self', $plain, 'a self-made certificate named as the signer'),
                            @('forged', $forged, "a self-made certificate with Thornswood's name and every usage its real one has"))) {
            $f = Join-Path $tmp ($pair[0] + '\Thornswood.exe')
            $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f)
            Copy-Item -LiteralPath $stub -Destination $f
            $null = Set-AuthenticodeSignature -LiteralPath $f -Certificate $pair[1] -HashAlgorithm SHA256
            $on = (Get-AuthenticodeSignature -LiteralPath $f).SignerCertificate
            Yes ('the exe signed with ' + $pair[2] + ' carries that signature') ($null -ne $on -and $on.Thumbprint -eq $pair[1].Thumbprint)
            Yes ('the old Subject read would have accepted ' + $pair[2] + ' (#912)') (OldCheck $f $Signer)
            $r = Check $f $Signer
            Yes ('signed with ' + $pair[2] + ', it is refused: ' + $r.Why) ($r.Why -match 'does not trust')
            $g = Get-PublishSignRefusal -Path $f -ExpectedSigner $Signer
            Yes ('the publish gate refuses ' + $pair[2]) ($g -ne '')
        }
    } else {
        Yes 'New-SelfSignedCertificate is here to make the self-made certificate' $false
    }

    # ---- a program validly signed by another publisher is refused ------------
    $other = $null
    $candidates = @(
        (Join-Path $fw 'csc.exe'),
        (Join-Path $fw 'MSBuild.exe'),
        (Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'),
        (Get-WindowsPath 'System32\WindowsPowerShell\v1.0\powershell.exe')
    )
    foreach ($c in $candidates) {
        if (-not (Test-Path -LiteralPath $c)) { continue }
        # $sig, not $s: PowerShell names are not case sensitive, and $s is $S,
        # the Signature type.
        $sig = Get-AuthenticodeSignature -LiteralPath $c
        # The signature in the file, not a catalog: Trust never honours catalogs.
        if ($sig.Status -eq 'Valid' -and $null -ne (Get-EmbeddedCert $c)) { $other = $c; break }
    }
    if ($other) {
        $r = Check $other $Signer
        Yes ('a program validly signed by Microsoft (' + (Split-Path -Leaf $other) + ') is refused: ' + $r.Why) ($r.Why -ne '')
        $r = Check $other 'Microsoft'
        Yes ('it is refused even when asked for its own name, because it is not Thornswood''s identity: ' + $r.Why) ($r.Why -ne '')
    } else {
        Yes 'a program validly signed by another publisher is on this machine' $false
    }

    # ---- another publisher signed through Artifact Signing too ---------------
    # The hardest one: same root, same kind of authority, same usages. Only
    # the durable identity tells it apart, and asked for its own name it has
    # to be refused all the same. Git for Windows is signed this way (MEASURED
    # 28 SEP: CN=Johannes Schindelin, issued by Microsoft ID Verified CS).
    $peer = $null
    foreach ($c in @((Join-Path $env:ProgramFiles 'Git\git-bash.exe'), (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'))) {
        if (-not (Test-Path -LiteralPath $c)) { continue }
        try {
            $pc = [Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($c)
            if ($pc.Issuer -like 'CN=Microsoft ID Verified CS *' -and $pc.Subject -notlike ('*' + $Signer + '*')) { $peer = $c; break }
        } catch { $peer = $null }
    }
    if ($peer) {
        $pc = [Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($peer)
        $peerName = ([regex]::Match($pc.Subject, 'CN=([^,]+)')).Groups[1].Value
        $r = Check $peer $Signer
        Yes ('another publisher''s Artifact Signing program (' + $peer + ') is refused: ' + $r.Why) (
            $r.Why -match "somebody else's identity")
        $r = Check $peer $peerName
        Yes ('it is refused even when asked for its own name, ' + $peerName + ', because only the identity decides: ' + $r.Why) (
            $r.Why -match "somebody else's identity")
    } else {
        Skip 'no program signed through Artifact Signing by another publisher on this machine (Git for Windows is one)'
    }

    # ---- a Windows file signed only in a catalog (#2046) -----------------------
    # A catalog-only Windows file: Get-AuthenticodeSignature says Valid
    # from a catalog, CreateFromSignedFile finds nothing in the file.
    # Trust uses WTD_CHOICE_FILE, so catalogs are never honoured.
    $catalogOnly = $null
    foreach ($c in @(
        (Get-WindowsPath 'System32\notepad.exe'),
        (Get-WindowsPath 'System32\cmd.exe'),
        (Get-WindowsPath 'System32\conhost.exe'),
        (Get-WindowsPath 'System32\svchost.exe'),
        (Get-WindowsPath 'explorer.exe'),
        (Get-WindowsPath 'System32\ntdll.dll'),
        (Get-WindowsPath 'System32\kernel32.dll'),
        (Get-WindowsPath 'System32\WindowsPowerShell\v1.0\powershell.exe')
    )) {
        if (-not (Test-Path -LiteralPath $c)) { continue }
        $catSig = Get-AuthenticodeSignature -LiteralPath $c
        if ($catSig.Status -eq 'Valid' -and $catSig.SignatureType -eq 'Catalog' -and $null -eq (Get-EmbeddedCert $c)) {
            $catalogOnly = $c
            break
        }
    }
    if ($catalogOnly) {
        $r = Check $catalogOnly $Signer
        Yes ('a catalog-only Windows file (' + (Split-Path -Leaf $catalogOnly) + ') is refused as not signed: ' + $r.Why) ($r.Why -eq 'is not signed.')
    } else {
        Skip 'no catalog-only Windows file on this machine (notepad.exe, cmd.exe, powershell.exe are): catalogs-not-honoured not run'
    }
}
finally {
    foreach ($t in $made) { Drop-Cert $t }
    $left = @($made | Where-Object {
        $t = $_
        @('My', 'CA', 'Root', 'TrustedPublisher') | Where-Object { Test-Path -LiteralPath "Cert:\CurrentUser\$_\$t" }
    })
    if ($made.Count) { Yes ('the ' + $made.Count + ' self-made certificates are gone from every CurrentUser store') ($left.Count -eq 0) }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Finish
