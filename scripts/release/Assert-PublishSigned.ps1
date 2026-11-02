<#
  Assert-PublishSigned.ps1

  Helpers for the publish sign gate. Dot-source this from Ship.ps1 (and
  Test-ReleaseFiles.ps1, which runs the same gate on a release draft). Do
  not call it as a standalone entry: it only defines functions.

  WHY. Since 27 September launchers from ExpectedSigner on refuse an update
  that is not signed by that certificate (CONTRIBUTING, issue #390). A local
  build may still leave a binary unsigned: Sign-Artifact.ps1 prints "not
  signing" and exits 0 when records\signing\signing.json is missing or
  disabled. That soft skip must not reach the feed. Ship refuses instead.

  SCOPE. Feed publish only. A local Build-Launcher stays soft. It signs every
  program of the launcher, the native libraries beside Thornswood.exe too
  (#4823); the setup stub it left unsigned for the old installer went with
  that installer (#4824).

  SAME CHECK AS THE LAUNCHER (#912). After Get-AuthenticodeSignature says
  Valid and the Subject names ExpectedSigner, Get-PublishSignRefusal runs
  launcher\app\Signature.cs itself, the class every installed launcher uses to
  accept an update: Microsoft's Artifact Signing root, a timestamp, and
  Thornswood's durable identity in the certificate. So a Ship signed with any
  other profile or certificate stops here, before the feed, rather than being
  refused by everybody's launcher afterwards. It is compiled from the source
  under a namespace named for the source's hash, so a changed Signature.cs is
  never answered by an older copy already loaded in the same session.
#>

# Signature.cs sits beside this file's folder. Sign-OnGitHub.ps1 carries the
# file's text to the box, where it runs as a block with no script root, and
# names Signature.cs itself (first cloud dev Ship, 22 Oct 2026: Join-Path
# with the empty root stopped the box's check before it began).
if ($PSScriptRoot) { $AssertPublishSignedCs = Join-Path $PSScriptRoot '..\..\launcher\app\Signature.cs' }

function Get-LauncherSignatureType {
    $src = [IO.File]::ReadAllText($AssertPublishSignedCs)
    $sha = [Security.Cryptography.SHA256]::Create()
    $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($src)) | Select-Object -First 8 |
                   ForEach-Object { $_.ToString('x2') })
    $ns = 'ThornswoodSign' + $hash
    $name = $ns + '.Signature'
    $t = $name -as [type]
    if ($t) { return $t }
    $code = [regex]::Replace($src, '(?m)^namespace Thornswood\s*$', ('namespace ' + $ns))
    Add-Type -TypeDefinition $code -Language CSharp
    return ($name -as [type])
}

function Get-ExpectedSignerFragment {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $cs = Join-Path $RepoRoot 'launcher\app\Updater.cs'
    if (-not (Test-Path -LiteralPath $cs)) {
        throw "launcher\app\Updater.cs is missing under $RepoRoot; cannot read ExpectedSigner"
    }
    $raw = [IO.File]::ReadAllText($cs)
    $m = [regex]::Match($raw, 'ExpectedSigner\s*=\s*"([^"]+)"')
    if (-not $m.Success -or [string]::IsNullOrWhiteSpace($m.Groups[1].Value)) {
        throw "ExpectedSigner is not set in launcher\app\Updater.cs"
    }
    return $m.Groups[1].Value.Trim()
}

# One key of signing.json, or $null when it is not there. Every key is read
# this way rather than as $cfg.enabled: Ship runs under Set-StrictMode -Version
# Latest, which its children inherit, and under that a key left out of the file
# throws "The property 'enabled' cannot be found" instead of the gate's own
# sentence (#1072). "enabled" is optional: a file without it is on.
function Get-SigningConfigValue($Config, [string]$Key) {
    if ($null -eq $Config -or $null -eq $Config.PSObject) { return $null }
    $p = $Config.PSObject.Properties[$Key]
    if ($null -eq $p) { return $null }
    return $p.Value
}

function Get-SigningConfigRefusal {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [string]$RepoRoot
    )

    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        return ('There is no records\signing\signing.json on this machine. Only a signing machine may Ship, ' +
                'dev included (CONTRIBUTING). Nothing was published.')
    }

    $cfg = $null
    try {
        $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    } catch {
        return ('records\signing\signing.json is not valid JSON: ' + $_.Exception.Message +
                ' Nothing was published.')
    }

    $on = Get-SigningConfigValue $cfg 'enabled'
    if ($null -ne $on -and -not $on) {
        return ('records\signing\signing.json has "enabled": false. Only a signing machine may Ship, ' +
                'dev included (CONTRIBUTING). Nothing was published.')
    }

    $m = [string](Get-SigningConfigValue $cfg 'metadata')
    if ($m -and $RepoRoot -and -not [IO.Path]::IsPathRooted($m)) {
        $m = Join-Path $RepoRoot $m
    }
    if ($m -and (Test-Path -LiteralPath $m)) {
        $meta = $null
        try { $meta = Get-Content -LiteralPath $m -Raw | ConvertFrom-Json } catch { $meta = $null }
        $profName = [string](Get-SigningConfigValue $meta 'CertificateProfileName')
        if (-not $profName -or $profName -match 'FILL THIS IN|YOUR_|<|\s') {
            return ('the certificate profile in ' + $m + ' is not filled in yet. ' +
                    'Only a signing machine may Ship. Nothing was published.')
        }
    }

    return ''
}

function Get-PublishSignRefusal {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedSigner
    )

    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
        return ("missing file to check for a publish signature: $Path")
    }

    # Get-AuthenticodeSignature is Windows' alone: pwsh elsewhere has no such
    # command, so off Windows no file can be shown signed, and the refusal says
    # that rather than that the command was not found.
    if (-not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) {
        return ((Split-Path -Leaf $Path) + ' cannot be checked for a signature on this machine: ' +
                'Get-AuthenticodeSignature, which reads one, is only on Windows. Check it on Windows. Nothing was published.')
    }
    $sig = $null
    try {
        $sig = Get-AuthenticodeSignature -LiteralPath $Path
    } catch {
        return ((Split-Path -Leaf $Path) + ' could not be read for Authenticode: ' +
                $_.Exception.Message + ' Nothing was published.')
    }

    if ($null -eq $sig -or $sig.Status -ne 'Valid') {
        $st = if ($sig) { [string]$sig.Status } else { 'unknown' }
        return ((Split-Path -Leaf $Path) + ' is not Authenticode Valid (status ' + $st + '). ' +
                'Ship and site publish refuse an unsigned tip. Sign it on a machine with ' +
                'records\signing\signing.json, then publish again. Nothing was published.')
    }

    $who = ''
    if ($sig.SignerCertificate -and $sig.SignerCertificate.Subject) {
        $who = [string]$sig.SignerCertificate.Subject
    }
    if ([string]::IsNullOrWhiteSpace($who) -or
        $who.IndexOf($ExpectedSigner, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        return ((Split-Path -Leaf $Path) + ' is signed by "' + $who + '", which does not contain ' +
                'ExpectedSigner "' + $ExpectedSigner + '". Nothing was published.')
    }

    # The launcher's own check (#912), so what is published is what every
    # installed launcher accepts.
    $said = ''
    $why = ''
    try {
        $t = Get-LauncherSignatureType
        $why = $t::Refusal($Path, $ExpectedSigner, [ref]$said)
    } catch {
        return ((Split-Path -Leaf $Path) + ' could not be put through the launcher''s signature check ' +
                '(launcher\app\Signature.cs): ' + $_.Exception.Message + ' Nothing was published.')
    }
    if ($why) {
        return ((Split-Path -Leaf $Path) + ' ' + $why + ' The launcher''s own check (launcher\app\Signature.cs) ' +
                'refuses it, so installed launchers would too. Nothing was published.')
    }

    return ''
}
