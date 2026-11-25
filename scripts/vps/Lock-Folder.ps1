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

  A folder the text makes is locked, and so is one already there that is not
  locked (Test-ThornswoodFolderLocked: it takes rules from above, or Users,
  Everyone, Authenticated Users or CREATOR OWNER has a rule on it). Until
  #4212 only a folder it had just made was locked, so one whose first lock
  failed stayed open for good: every later run found it there and went past.
  Locking again is safe to repeat, since every rule by name stays. A folder
  already locked is left exactly as it is.

  A lock that fails is a stop (#4212): the text says
  'FAILED    locking <folder>: <why>' and ends the script it is in with 1,
  so nothing after it writes into the open folder. A caller that does not
  stop on every FAILED line passes what the box said to
  Get-ThornswoodLockFailure and throws on what it returns.

  tests\test-vps-folders-on-create.ps1 runs it and each creator's text
  against scratch folders, and checks it leaves the same rules as
  Lock-VpsFolders.ps1. scripts\tests\test-4212-lock-checked.ps1 runs the
  text with the lock stood in, and the callers with a failed lock.
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

# Whether a folder is locked the way Lock-ThornswoodFolder leaves it: it takes
# nothing from above, and Users, Everyone, Authenticated Users and CREATOR
# OWNER have no rule on it. A folder whose rules cannot be read throws.
function Test-ThornswoodFolderLocked {
    param([Parameter(Mandatory = $true)][string]$Path)
    $broad = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-3-0')
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (-not $acl.AreAccessRulesProtected) { return $false }
    foreach ($r in @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) {
        if ($broad -contains $r.IdentityReference.Value) { return $false }
    }
    return $true
}

# Text for a script that runs on the box: makes $Path when it is missing, and
# locks it when it made it or finds it not locked. A lock that fails says
# FAILED and ends the script with 1. Paths go in single quoted, so nothing in
# them is expanded.
function Get-ThornswoodLockedFolderScript {
    param([Parameter(Mandatory = $true)][string]$Path, [switch]$Only)
    $q = "'" + $Path.Replace("'", "''") + "'"
    $fn = 'function Lock-ThornswoodFolder {' + ${function:Lock-ThornswoodFolder}.ToString() + '}'
    $test = 'function Test-ThornswoodFolderLocked {' + ${function:Test-ThornswoodFolderLocked}.ToString() + '}'
    return @"
$fn
$test
try {
  `$ThornswoodLockMade = `$false
  if (-not (Test-Path -LiteralPath $q)) { `$null = New-Item -ItemType Directory -Path $q -Force -ErrorAction Stop; `$ThornswoodLockMade = `$true }
  if (`$ThornswoodLockMade -or -not (Test-ThornswoodFolderLocked -Path $q)) {
    Lock-ThornswoodFolder -Path $q$(if ($Only) { ' -Only' })
    'locked    ' + $q + ', SYSTEM and Administrators, no Users rule'
  }
}
catch { 'FAILED    locking ' + $q + ': ' + `$_.Exception.Message + ' Nothing after it ran.'; exit 1 }
"@
}

# The line a box's run of the text above said when its lock failed, or ''.
# For the callers that do not already stop on every FAILED line.
function Get-ThornswoodLockFailure {
    param([object[]]$Said = @())
    foreach ($l in @($Said)) {
        $s = ([string]$l).Trim()
        if ($s -match '^FAILED\s+locking ') { return $s }
    }
    return ''
}
