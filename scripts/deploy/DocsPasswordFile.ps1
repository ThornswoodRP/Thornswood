<#
  DocsPasswordFile.ps1

  Where the site's member password comes from for Deploy-Docs.ps1 -Password, when nobody
  types it (issue #2116): a file on the box, locked to the box's Administrators
  and the deploy account. The value is read on the box and goes straight into
  the site's config.json, so it never crosses the wire, never sits on a
  command line, and is never printed. When the file is not there, -Password
  falls back to the hidden prompt it always had.

  The file the code expects:

      C:\Thornswood-Secrets\docs-site-password.txt

  outside C:\Thornswood-Docs, so the site's own LOCAL SERVICE account cannot
  read it. Its ACL has inheritance off, and Allow rules for BUILTIN\Administrators
  (S-1-5-32-544) and the deploy account (whoever ssh logs in as) only, and one
  of those two owns it. Anything else, or an empty file, stops -Password
  before anything is written: a password file anybody else can read is not
  one to use, and falling back to the prompt would hide that it is wrong.

  The checks run in Windows PowerShell 5.1 on the box. scripts\tests\test-docs-pwfile.ps1
  runs the same text on scratch files here.
#>

function Get-ThornswoodDocsPasswordFile { return 'C:\Thornswood-Secrets\docs-site-password.txt' }

# The check, as text for the far side. Defines Test-ThornswoodPwFile, which
# answers OK, MISSING, EMPTY, or UNSAFE: <why>. It reads the value only to see
# that it is not blank, and prints nothing of it.
function Get-ThornswoodDocsPasswordCheck([string]$File) {
    $q = $File.Replace("'", "''")
    return @"
`$pwFile = '$q'
function Test-ThornswoodPwFile([string]`$f) {
  if (-not (Test-Path -LiteralPath `$f -PathType Leaf)) { return 'MISSING' }
  `$acl = Get-Acl -LiteralPath `$f
  `$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  `$ok = @('S-1-5-32-544', `$me)
  `$name = { param(`$s) try { (New-Object Security.Principal.SecurityIdentifier(`$s)).Translate([Security.Principal.NTAccount]).Value } catch { `$s } }
  if (-not `$acl.AreAccessRulesProtected) { return 'UNSAFE: it inherits permissions from its folder' }
  `$owner = `$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if (`$ok -notcontains `$owner) { return ('UNSAFE: it is owned by ' + (& `$name `$owner)) }
  foreach (`$r in `$acl.GetAccessRules(`$true, `$true, [Security.Principal.SecurityIdentifier])) {
    if (`$r.IsInherited) { return 'UNSAFE: it has an inherited rule' }
    if (`$r.AccessControlType -eq 'Allow' -and `$ok -notcontains `$r.IdentityReference.Value) {
      return ('UNSAFE: ' + (& `$name `$r.IdentityReference.Value) + ' is allowed in')
    }
  }
  `$v = ''
  try { `$v = [IO.File]::ReadAllText(`$f, [Text.Encoding]::UTF8).Trim() } catch { return 'UNSAFE: the deploy account cannot read it' }
  `$blank = -not `$v
  `$v = `$null
  if (`$blank) { return 'EMPTY' }
  return 'OK'
}
"@
}

# The probe -Password runs before it asks for anything: one line, PWFILE <answer>.
function Get-ThornswoodDocsPasswordProbe([string]$File) {
    return (Get-ThornswoodDocsPasswordCheck $File) + "`n'PWFILE ' + (Test-ThornswoodPwFile `$pwFile)`n"
}

# The head of the set script when the value comes from the file: checked again
# at the moment of use, then read into `$pw, which the rest of the -Password
# script writes into config.json.
function Get-ThornswoodDocsPasswordSetHead([string]$File) {
    return (Get-ThornswoodDocsPasswordCheck $File) + @"
`$ErrorActionPreference = 'Stop'
`$st = Test-ThornswoodPwFile `$pwFile
if (`$st -ne 'OK') { 'PASSWORD FILE ' + `$st + '. Nothing written, the password is unchanged.'; return }
`$pw = [IO.File]::ReadAllText(`$pwFile, [Text.Encoding]::UTF8).Trim()

"@
}