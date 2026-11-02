<#
  test-2862-send-backups-acl.ps1

  Issues #2862 and #5356. Send-Backups.ps1 -Install ran on the box under pwsh
  and stopped at its first lock: "Method invocation failed because
  [System.IO.DirectoryInfo] does not contain a method named
  'SetAccessControl'" (gate run 20261101-221646-90a39e, 1 Nov 2026). .NET
  (pwsh) has no SetAccessControl or GetAccessControl on DirectoryInfo or
  FileInfo; it is [IO.FileSystemAclExtensions] there. Every script runs in
  PowerShell 7 since #5356, so there is one way to lock an item and no
  branch on the edition. Held here:
    - no .ps1 or .psm1 outside a tests folder calls .SetAccessControl( or
      .GetAccessControl( on an item, in its own code or in the text it sends
      to the box, so each goes through [IO.FileSystemAclExtensions];
    - no .ps1 or .psm1 outside a tests folder asks $PSVersionTable.PSEdition, so
      nothing keeps a Windows PowerShell 5.1 path;
    - each [IO.FileSystemAclExtensions] call is given a typed item
      ([IO.DirectoryInfo] or [IO.FileInfo]), which is what the method takes;
    - Send-Backups.ps1 locks its folder that way, and -Install says the drop
      key after the lock and before it asks the VM anything;
    - the same call, run for real on a scratch folder, leaves SYSTEM and the
      Administrators alone on it.
  Windows only: the last check prints SKIP elsewhere. Under ten seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Rel([string]$p) { $p.Substring($Repo.Length + 1) }

# The harnesses are left out: tests\ and a product's own tests folder,
# launcher\tests\ (#5341), which name the very things they look for.
$harnesses = '^([^\\/]+[\\/])?tests[\\/]'
$skip = '[\\/](\.git|node_modules|temp|worktrees|engine)[\\/]'
$files = @(Get-ChildItem -LiteralPath $Repo -Recurse -File -Include *.ps1, *.psm1 |
    Where-Object { (Rel $_.FullName) -notmatch $harnesses -and $_.FullName -notmatch $skip })
Yes "there are scripts to read ($($files.Count))" ($files.Count -gt 50)

# ---- no item ACL method, in code or in text sent to the box ---------------------------
# Read as text, not only as code: a here-string sent over ssh is a script too.
$member = New-Object System.Collections.Generic.List[string]
$edition = New-Object System.Collections.Generic.List[string]
$untyped = New-Object System.Collections.Generic.List[string]
$ext = 0
foreach ($f in $files) {
    $n = 0
    foreach ($line in [IO.File]::ReadAllLines($f.FullName)) {
        $n++
        $code = $line -replace '#.*$', ''
        if ($code -match '\.(Set|Get)AccessControl\(' -and $code -notmatch 'FileSystemAclExtensions\]::(Set|Get)AccessControl\(') {
            $member.Add(('{0}:{1}' -f (Rel $f.FullName), $n))
        }
        if ($code -match 'PSEdition') { $edition.Add(('{0}:{1}' -f (Rel $f.FullName), $n)) }
        foreach ($m in [regex]::Matches($code, 'FileSystemAclExtensions\]::(Set|Get)AccessControl\(\s*([^,)]*)')) {
            $ext++
            if ($m.Groups[2].Value -notmatch '^\[IO\.(DirectoryInfo|FileInfo)\]|^\$\w+$') {
                $untyped.Add(('{0}:{1}' -f (Rel $f.FullName), $n))
            }
        }
    }
}
Yes ('no script calls .SetAccessControl( or .GetAccessControl( on an item' +
     $(if ($member.Count) { ' (not: ' + ($member -join ', ') + ')' })) ($member.Count -eq 0)
Yes ('no script asks $PSVersionTable.PSEdition (PowerShell 7 only, #5356)' +
     $(if ($edition.Count) { ' (not: ' + ($edition -join ', ') + ')' })) ($edition.Count -eq 0)
Yes "the scripts lock items through [IO.FileSystemAclExtensions] ($ext calls)" ($ext -gt 10)
Yes ('each [IO.FileSystemAclExtensions] call is given a typed item or a variable holding one' +
     $(if ($untyped.Count) { ' (not: ' + ($untyped -join ', ') + ')' })) ($untyped.Count -eq 0)

# ---- Send-Backups.ps1 itself ------------------------------------------------------
$send = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/vps/Send-Backups.ps1'))
Yes 'Send-Backups.ps1 locks its folder through [IO.FileSystemAclExtensions]::SetAccessControl' (
    $send.Contains('[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]'))
# -Install says the drop key once the lock holds, and before it asks the VM
# anything, so the key reaches Thornswood-Hermes even while the VM is not reachable.
$lock = $send.IndexOf('[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]')
$drop = $send.IndexOf("Say ('The drop key, for Thornswood-Hermes deploy/keys/box-drop.pub: '")
$scan = $send.IndexOf('& $scan -t ed25519 $VmHost')
Yes 'Send-Backups -Install says the drop key after the lock and before it reads the VM''s host key' (
    $lock -ge 0 -and $drop -gt $lock -and $scan -gt $drop)

# ---- the call, for real -----------------------------------------------------------
if (-not $OnWindows) {
    Write-Host 'SKIP  the lock on a scratch folder (Windows only)'
} else {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('tw-2862-acl-' + [guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $dir -Force)
    try {
        $acl = Get-Acl -LiteralPath $dir
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($r) }
        $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        # The current user too, so the scratch folder can be removed again.
        foreach ($sid in 'S-1-5-18', 'S-1-5-32-544', $me) {
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
        }
        $err = ''
        try { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath $dir -Force), [Security.AccessControl.DirectorySecurity]$acl) }
        catch { $err = $_.Exception.Message }
        Yes ('[IO.FileSystemAclExtensions]::SetAccessControl sets the lock' + $(if ($err) { ": $err" })) (-not $err)
        $after = Get-Acl -LiteralPath $dir
        $sids = @($after.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
        Yes 'the folder then holds only SYSTEM, the Administrators (and here this user), nothing inherited' (
            $after.AreAccessRulesProtected -and -not (Compare-Object $sids (@('S-1-5-18', 'S-1-5-32-544', $me) | Sort-Object -Unique)))
    } finally {
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
