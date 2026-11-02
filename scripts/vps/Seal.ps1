<#
  Seal.ps1

  How a secret held by GitHub reaches the box without passing through any
  session, chat or log in a form anybody can read (#3216, Patrick's A of
  22 Oct 2026). Dot-source it beside Vps.ps1:

      . (Join-Path $Here '..\vps\Seal.ps1')

  WHY. Patrick pastes a secret once, into the repository's Actions secrets,
  which is a page only he signs in to. A workflow can read it there, but a
  workflow's log is open to everybody on the repository, and the Desk that
  must put the value on the box is a Claude session whose every word is kept.
  The Desk refused to read the Turnstile secret through the Cloudflare
  connector for that reason. So the value is sealed: the workflow encrypts it
  to a key whose private half never leaves the box, and only the sealed form
  goes through GitHub and the session. Only the box can open it.

  THE KEY. RSA 3072, made on the box the first time it is asked for (the
  block from Get-ThornswoodSealKeyBlock), kept as one file in C:\Thornswood-Seal
  that only SYSTEM, Administrators and the account that made it can read. The
  public half is printed for the caller to hand to the workflow; it is
  public, so it may go anywhere. The private half is never printed, copied or
  sent.

  THE SEAL. RSA-OAEP with SHA-1 (RSAEncryptionPadding.OaepSHA1), through
  [Security.Cryptography.RSA]::Create(), which every PowerShell here has:
  PowerShell 7 on the box and on a runner or
  anywhere. The key object is never a named key container, so nothing is
  left in a Windows key store. A 3072-bit key seals
  up to 342 bytes, far more than a token. The sealed value is base64, one line.

  tests\test-3216-turnstile-seal.ps1 seals and opens with these blocks.
#>

# Where the box keeps the key. One folder, one file.
$ThornswoodSealFolder = 'C:\Thornswood-Seal'

# The value sealed to -PublicKeyXml (the <RSAKeyValue> the box printed), as
# one line of base64. Runs in PowerShell 7 or 5.1.
function ConvertTo-ThornswoodSealed {
    param(
        [Parameter(Mandatory = $true)][string]$PublicKeyXml,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value
    )
    if ($PublicKeyXml -notmatch '^\s*<RSAKeyValue><Modulus>[A-Za-z0-9+/=]+</Modulus><Exponent>[A-Za-z0-9+/=]+</Exponent></RSAKeyValue>\s*$') {
        throw 'That is not a public key as the box prints it (<RSAKeyValue> with a Modulus and an Exponent and nothing else). Nothing was sealed.'
    }
    $rsa = [Security.Cryptography.RSA]::Create()
    try {
        $rsa.FromXmlString($PublicKeyXml.Trim())
        if ($rsa.KeySize -lt 3072) { throw ('The key is ' + $rsa.KeySize + ' bits; a seal key is 3072. Nothing was sealed.') }
        return [Convert]::ToBase64String($rsa.Encrypt([Text.Encoding]::UTF8.GetBytes($Value), [Security.Cryptography.RSAEncryptionPadding]::OaepSHA1))
    } finally { $rsa.Dispose() }
}

# Box-side text: makes the key if there is none, locks its folder, and sets
# $sealPublic to the public half. Prints 'SEAL KEY <xml>' and, the first
# time, 'seal key made'. On a failure it prints why and returns, so nothing
# after it in the same script runs.
function Get-ThornswoodSealKeyBlock([string]$Folder = $ThornswoodSealFolder) {
    $f = $Folder.Replace("'", "''")
    return @"
`$sealFolder = '$f'
`$sealFile = Join-Path `$sealFolder 'seal-key.xml'
`$sealPublic = ''
try {
  if (-not (Test-Path -LiteralPath `$sealFolder)) { New-Item -ItemType Directory -Path `$sealFolder -Force | Out-Null }
  Lock-ThornswoodSealFolder `$sealFolder
  if (-not (Test-Path -LiteralPath `$sealFile)) {
    # Made with its size, because .NET Framework's provider ignores a
    # KeySize set after it is made and would make 1024 bits.
    `$rsa = New-Object Security.Cryptography.RSACryptoServiceProvider 3072
    try {
      if (`$rsa.KeySize -ne 3072) { throw ('the key came out ' + `$rsa.KeySize + ' bits, not 3072') }
      [IO.File]::WriteAllText(`$sealFile, `$rsa.ToXmlString(`$true), (New-Object Text.UTF8Encoding(`$false)))
      `$sealPublic = `$rsa.ToXmlString(`$false)
    } finally { `$rsa.Dispose() }
    'seal key made'
  } else {
    `$rsa = [Security.Cryptography.RSA]::Create()
    try {
      `$rsa.FromXmlString([IO.File]::ReadAllText(`$sealFile))
      `$sealPublic = `$rsa.ToXmlString(`$false)
    } finally { `$rsa.Dispose() }
  }
} catch { 'COULD NOT READY THE SEAL KEY: ' + `$_.Exception.Message; return }
'SEAL KEY ' + `$sealPublic
"@
}

# Box-side text: opens the sealed value in `$sealed with the box's key and
# puts it in `$ThornswoodSecret. On a failure it prints why and returns.
# The value is never printed.
function Get-ThornswoodUnsealBlock([string]$Folder = $ThornswoodSealFolder) {
    $f = $Folder.Replace("'", "''")
    return @"
`$ThornswoodSecret = ''
`$sealFile = Join-Path '$f' 'seal-key.xml'
if (-not (Test-Path -LiteralPath `$sealFile)) { 'NO SEAL KEY on the box, so nothing sealed to it can be opened. Nothing was changed.'; return }
`$rsa = [Security.Cryptography.RSA]::Create()
try {
  `$rsa.FromXmlString([IO.File]::ReadAllText(`$sealFile))
  `$ThornswoodSecret = [Text.Encoding]::UTF8.GetString(`$rsa.Decrypt([Convert]::FromBase64String(`$sealed), [Security.Cryptography.RSAEncryptionPadding]::OaepSHA1))
} catch { 'THE SEALED VALUE DID NOT OPEN with the box''s key (sealed to another key, or cut short). Nothing was changed.'; return }
finally { `$rsa.Dispose(); `$sealed = `$null }
"@
}

# Box-side text: the function the key block calls. Only SYSTEM,
# Administrators and the account running it may open the folder; nothing
# comes from C:\, the way Install-AdminService.ps1 locks the App's key.
function Get-ThornswoodSealLockFunction {
    return @'
function Lock-ThornswoodSealFolder([string]$dir) {
  $acl = Get-Acl -LiteralPath $dir
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($r) }
  foreach ($s in @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
  }
  # Only the access rules are written back (issue #1120).
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath $dir -Force), $acl)
}
'@
}
