<#
.SYNOPSIS
  Signs a built binary, or says plainly that it is not signing and carries on.

.DESCRIPTION
  One implementation, so every program of the launcher is signed the same way
  wherever it is signed: Build-Launcher.ps1 on a machine that signs, and the
  release workflow on GitHub.

  It does nothing unless records\signing\signing.json exists. That file is gitignored and
  lives only on a machine that holds a certificate, so Djinn's machine and every
  pull request build keep working exactly as they do today. A build that cannot
  sign is not a failed build.

  Why signing matters here is written out in installer\setup\Bootstrap.cs: SmartScreen
  builds reputation per file hash, and this project ships a new hash every
  release, so an unsigned installer starts from zero reputation every single
  time and warns forever. Signing moves the reputation to the certificate.

  Two shapes of signing.json are understood.

    Azure Artifact Signing, which is what entry 2 recommends. The service was
    called Trusted Signing and before that Azure Code Signing, so both older
    method names are accepted here and mean the same thing.

    Its certificates are valid for THREE DAYS. The timestamp is what keeps a
    signature valid after that, so it is not optional and the right authority
    is the default. Its metadata.json needs Endpoint, CodeSigningAccountName
    and CertificateProfileName, and the Endpoint must name the same region the
    account was created in, or signing fails with a 403 that does not say why.
      {
        "method": "artifactsigning",
        "dlib": "records\\signing\\client\\Azure.CodeSigning.Dlib.dll",
        "metadata": "records\\signing\\metadata.json",
        "timestampUrl": "http://timestamp.acs.microsoft.com"
      }

    A dlib or metadata path that is not a full path is read from the repository
    folder. Since 25 September the signing setup lives there, not in C:\tools:
    records\signing\metadata.json is tracked, because it names the Azure account
    and holds no key or password, and records\signing\client is Microsoft's
    signing client, which git ignores (records\signing\README.md).

    A certificate already in the machine's store:
      {
        "method": "thumbprint",
        "thumbprint": "0123456789ABCDEF0123456789ABCDEF01234567",
        "timestampUrl": "http://timestamp.digicert.com"
      }

  Never put a password or a key in that file. Trusted Signing does not need one,
  and a thumbprint names a certificate rather than carrying it.

  IN A GITHUB JOB (#3412). A job that holds the signing identity (the
  "release" environment, id-token: write) signs with Artifact Signing through
  a federated token, no secret. A caller can name its own token file in
  AZURE_FEDERATED_TOKEN_FILE, as release.yml does right before its one call.
  When none is named and GitHub gave the job a way to ask for one, this asks
  for it itself, right before each file: the token lasts minutes, and a job
  can build or fetch for longer than that before it gets here. The token is written to a file under RUNNER_TEMP
  for that one signtool call and removed with it. AZURE_CLIENT_ID and
  AZURE_TENANT_ID come from the job, as release.yml sets them.

.PARAMETER Path
  One or more files to sign. Missing files are reported and skipped rather than
  stopping the build.

.PARAMETER Required
  Fail instead of skipping. Covers all three reasons this would otherwise skip:
  no signing.json, "enabled": false, and a certificate profile that has not been
  filled in yet. For a real release.

  TO TURN SIGNING OFF while you are still setting it up, put "enabled": false in
  records\signing\signing.json. The config stays where it is and the build stops trying.
  A metadata.json whose CertificateProfileName is still a placeholder does the
  same thing on its own, because that is not a mistake, it is the middle of
  setting this up.

.EXAMPLE
  .\Sign-Artifact.ps1 -Path .\Thornswood.exe, .\libSkiaSharp.dll
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$Path,
    [switch]$Required,
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ConfigPath) { $ConfigPath = Join-Path $Here '..\..\records\signing\signing.json' }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

# ------------------------------------------------------------------ config --
if (-not (Test-Path -LiteralPath $ConfigPath)) {
    if ($Required) {
        Say '  There is no records\signing\signing.json, so nothing can be signed.' 'Red'
        Say '  A release has to be signed. See the header of this script.' 'Red'
        exit 1
    }
    Say '  not signing: no records\signing\signing.json on this machine' 'DarkGray'
    exit 0
}

try {
    $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
} catch {
    Say ("  records\signing\signing.json is not valid JSON: " + $_.Exception.Message) 'Red'
    exit 1
}

# Every key read below is optional in the file, so each one missing is added
# as $null here. Build-Launcher and Ship run this under Set-StrictMode -Version
# Latest, where reading $cfg.enabled off a file without it throws "The property
# 'enabled' cannot be found" instead of signing (#1072). No "enabled" is on.
foreach ($k in 'enabled', 'method', 'dlib', 'metadata', 'thumbprint', 'timestampUrl') {
    if ($null -eq $cfg.PSObject.Properties[$k]) { $cfg | Add-Member -NotePropertyName $k -NotePropertyValue $null }
}

# A dlib or metadata that is not a full path is the repository folder's, so the
# same signing.json works wherever the repository is cloned.
$repoRoot = Split-Path -Parent (Split-Path -Parent $Here)
foreach ($k in 'dlib', 'metadata') {
    $v = [string]$cfg.$k
    if ($v -and -not [IO.Path]::IsPathRooted($v)) { $cfg.$k = Join-Path $repoRoot $v }
}

# ------------------------------------------------------------ half done ----
# Setting this up is not one step, and the middle of it used to break the build.
#
# On 18 September a release went out having printed "Signing failed. Nothing was
# published." The Azure account and signtool existed, signing.json was correct,
# and the certificate profile did not exist yet because the identity validation
# was still in progress. signtool answered 403 on every file. There is nothing
# wrong with being at that point; it is most of a working setup. It should not
# stop anybody shipping.
#
# So two ways out, and both say which one they took rather than going quiet.
# "enabled": false turns it off while keeping the config. A metadata.json whose
# CertificateProfileName is still a placeholder is the same situation and is
# detected rather than sent to the service to be refused.
#
# -Required overrides both, because a real release has to be signed and finding
# that out at the end is the point of that switch.
function Skip($why) {
    if ($Required) {
        Say ("  " + $why) 'Red'
        Say '  -Required was passed, and a release has to be signed.' 'Red'
        exit 1
    }
    Say ("  not signing: " + $why) 'Yellow'
    exit 0
}

if ($null -ne $cfg.enabled -and -not $cfg.enabled) {
    Skip ('records' + [char]92 + 'signing' + [char]92 + 'signing.json has "enabled": false')
}

$m = if ($cfg.metadata) { [string]$cfg.metadata } else { '' }
if ($m -and (Test-Path -LiteralPath $m)) {
    $meta = $null
    try { $meta = Get-Content -LiteralPath $m -Raw | ConvertFrom-Json } catch { $meta = $null }
    # Not $profile: that is an automatic variable holding the PowerShell
    # profile path, and writing to it here would be confusing at best.
    $profName = if ($meta -and $meta.PSObject.Properties['CertificateProfileName']) { [string]$meta.CertificateProfileName } else { '' }
    # Anything still carrying the words from the example, or nothing at all.
    # A real profile name is 5 to 100 characters and has no spaces in it.
    if (-not $profName -or $profName -match 'FILL THIS IN|YOUR_|<|\s') {
        Skip ("the certificate profile in " + $m + " is not filled in yet, so there is nothing to sign with")
    }
}

# ------------------------------------------------------ a GitHub job's token --
# The header, IN A GITHUB JOB. '' when no token was asked for here (a token
# file was named, or this is not a job GitHub lets ask), the file's path when
# one was, or a throw that says why it could not be had.
function New-GitHubSigningToken {
    if ($env:AZURE_FEDERATED_TOKEN_FILE) { return '' }
    if (-not $env:ACTIONS_ID_TOKEN_REQUEST_URL -or -not $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN) { return '' }
    if (-not $env:AZURE_CLIENT_ID -or -not $env:AZURE_TENANT_ID) {
        throw 'this GitHub job may ask for a signing token, but AZURE_CLIENT_ID and AZURE_TENANT_ID are not set (release.yml sets them from the repository variables)'
    }
    $answer = Invoke-RestMethod -Uri ($env:ACTIONS_ID_TOKEN_REQUEST_URL + '&audience=api://AzureADTokenExchange') -Headers @{ Authorization = ('bearer ' + $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN) } -ErrorAction Stop
    if (-not $answer -or -not $answer.value) { throw 'GitHub answered the request for a signing token with no token' }
    # Masked before anything could print it.
    Write-Host ('::add-mask::' + [string]$answer.value)
    $dir = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
    $file = Join-Path $dir ('azure-federated-token-' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($file, [string]$answer.value)
    return $file
}

# ---------------------------------------------------------------- signtool --
# Newest first. The Windows SDK installs one per version and they are not
# interchangeable: older ones cannot drive a Trusted Signing dlib.
$signtool = $null
$roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "$env:ProgramFiles\Windows Kits\10\bin"
)
foreach ($r in $roots) {
    if (-not (Test-Path -LiteralPath $r)) { continue }
    $found = Get-ChildItem -LiteralPath $r -Recurse -Filter 'signtool.exe' -EA SilentlyContinue |
             Where-Object { $_.FullName -match '\\x64\\' } |
             Sort-Object FullName -Descending |
             Select-Object -First 1
    if ($found) { $signtool = $found.FullName; break }
}
if (-not $signtool) {
    $c = Get-Command signtool.exe -EA SilentlyContinue
    if ($c) { $signtool = $c.Source }
}
if (-not $signtool) {
    Say '  signtool.exe was not found. It comes with the Windows SDK.' 'Red'
    Say '  https://developer.microsoft.com/windows/downloads/windows-sdk/' 'Yellow'
    exit 1
}
Say ("  signtool: " + $signtool) 'DarkGray'

$method = if ($cfg.method) { [string]$cfg.method } else { 'thumbprint' }
if ($method -eq 'trustedsigning' -or $method -eq 'codesigning') { $method = 'artifactsigning' }

# Artifact Signing certificates last three days. Without a timestamp every
# release would stop verifying by the weekend, so its own authority is the
# default rather than a general purpose one.
$ts = if ($cfg.timestampUrl) { [string]$cfg.timestampUrl }
      elseif ($method -eq 'artifactsigning') { 'http://timestamp.acs.microsoft.com' }
      else { 'http://timestamp.digicert.com' }

# ------------------------------------------------------------------- sign ---
$failed = 0
foreach ($p in $Path) {
    if (-not (Test-Path -LiteralPath $p)) {
        Say ("  not there, skipped: " + $p) 'Yellow'
        continue
    }
    $full = (Resolve-Path -LiteralPath $p).Path
    $name = Split-Path $full -Leaf

    switch ($method) {
        'artifactsigning' {
            foreach ($k in 'dlib', 'metadata') {
                if (-not $cfg.$k) { Say ("  signing.json is missing " + $k) 'Red'; exit 1 }
                if (-not (Test-Path -LiteralPath ([string]$cfg.$k))) {
                    Say ("  signing.json points " + $k + " at a file that is not there") 'Red'; exit 1
                }
            }
            $args = @('sign', '/v', '/debug', '/fd', 'SHA256',
                      '/tr', $ts, '/td', 'SHA256',
                      '/dlib', [string]$cfg.dlib, '/dmdf', [string]$cfg.metadata, $full)
        }
        'thumbprint' {
            if (-not $cfg.thumbprint) { Say '  signing.json is missing thumbprint' 'Red'; exit 1 }
            $args = @('sign', '/v', '/fd', 'SHA256',
                      '/tr', $ts, '/td', 'SHA256',
                      '/sha1', [string]$cfg.thumbprint, $full)
        }
        default {
            Say ("  signing.json has an unknown method: " + $method) 'Red'
            exit 1
        }
    }

    # The exit code decides, not stderr. signtool writes "SignTool Error" there,
    # and under Stop Windows PowerShell 5.1 made that line a thrown error: the
    # first file that failed ended the script, with no count and no read-back.
    $tokenFile = ''
    if ($method -eq 'artifactsigning') {
        try { $tokenFile = New-GitHubSigningToken }
        catch {
            Say ("  no signing token for " + $name + ": " + $_.Exception.Message) 'Red'
            $failed++
            continue
        }
        if ($tokenFile) { $env:AZURE_FEDERATED_TOKEN_FILE = $tokenFile }
    }
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $signtool @args 2>&1 | ForEach-Object { Say ("    " + $_) 'DarkGray' } }
    finally {
        $ErrorActionPreference = $was
        if ($tokenFile) {
            Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
            Remove-Item Env:\AZURE_FEDERATED_TOKEN_FILE -ErrorAction SilentlyContinue
        }
    }
    if ($LASTEXITCODE -ne 0) {
        Say ("  signtool exited with " + $LASTEXITCODE + " on " + $name) 'Red'
        $failed++
        continue
    }

    # Signing that reports success and leaves an unsigned file is the failure
    # worth catching, so the result is read back rather than trusted.
    $sig = Get-AuthenticodeSignature -LiteralPath $full
    if ($sig.Status -ne 'Valid') {
        Say ("  " + $name + " still reports " + $sig.Status + " after signing") 'Red'
        $failed++
        continue
    }
    Say ("  signed  " + $name.PadRight(22) + " " + $sig.SignerCertificate.Subject) 'Green'
}

if ($failed -gt 0) { exit 1 }
exit 0
