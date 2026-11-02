<#
  Lock-Folder.ps1

  The one place the creators of the VPS service folders get their lock from
  (follow-up to issues #1183 and #1691): Watch-Services.ps1 and Watch-Load.ps1
  for C:\Thornswood-Watch, Setup-Domain.ps1 for C:\Thornswood-Caddy, and
  Artifact.ps1 and Swap.ps1 for C:\Thornswood-Deploys, and Grant-BoxAccess.ps1
  for the copies it keeps in C:\ProgramData\ssh\box-access-before (#3034).
  Dot-sourced on this machine; the far side gets the function as text inside
  the script that is sent, since those scripts run ON the VPS through
  Send-Script.ps1.

  The rules are the ones Lock-VpsFolders.ps1 applies, so a folder made from now
  on starts the way Lock-VpsFolders leaves an old one:
    takes nothing from above; SYSTEM, Administrators and the account running
    it have Full Control; every rule by name stays; Users, Everyone,
    Authenticated Users and CREATOR OWNER go. -Only also takes off every rule
    by name but those three (private, the backups, Dumps). -Writers then lets
    each SID named make and write files in it, and read nothing (Dumps:
    LOCAL SERVICE and the build runners write node.exe's crash dumps there,
    Patrick's decision on 11 October).
  Only a folder this makes is locked. One that is already there is left to
  Lock-VpsFolders.ps1, which knows what the bot and the site must keep first.

  tests\test-vps-folders-on-create.ps1 runs it and each creator's text
  against scratch folders, and checks it leaves the same rules as
  Lock-VpsFolders.ps1.
#>

function Lock-ThornswoodFolder {
    param([Parameter(Mandatory = $true)][string]$Path, [switch]$Only, [string[]]$Writers = @())
    $broad = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-3-0')
    $tree = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $keepers = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        $id = $r.IdentityReference.Value
        if ($broad -contains $id -or ($Only -and $keepers -notcontains $id)) { [void]$acl.RemoveAccessRuleSpecific($r) }
    }
    foreach ($s in $keepers) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            (New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', $tree, 'None', 'Allow')))
    }
    foreach ($s in @($Writers | Where-Object { $_ -and $keepers -notcontains $_ })) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            (New-Object Security.Principal.SecurityIdentifier($s)), 'Write, Synchronize', $tree, 'None', 'Allow')))
    }
    # Only the access rules are written back, never the audit part (#1120).
    $item = Get-Item -LiteralPath $Path -Force
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, [Security.AccessControl.DirectorySecurity]$acl)
}

# Text for a script that runs on the box: makes $Path when it is missing and
# locks it then. Paths go in single quoted, so nothing in them is expanded.
function Get-ThornswoodLockedFolderScript {
    param([Parameter(Mandatory = $true)][string]$Path, [switch]$Only)
    $q = "'" + $Path.Replace("'", "''") + "'"
    $fn = 'function Lock-ThornswoodFolder {' + ${function:Lock-ThornswoodFolder}.ToString() + '}'
    return @"
$fn
if (-not (Test-Path -LiteralPath $q)) {
  `$null = New-Item -ItemType Directory -Path $q -Force
  try { Lock-ThornswoodFolder -Path $q$(if ($Only) { ' -Only' }); 'locked    ' + $q + ', SYSTEM and Administrators, no Users rule' }
  catch { 'FAILED    locking ' + $q + ': ' + `$_.Exception.Message }
}
"@
}
