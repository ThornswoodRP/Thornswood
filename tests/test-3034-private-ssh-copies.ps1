<#
  test-3034-private-ssh-copies.ps1

      powershell -NoProfile -File .\tests\test-3034-private-ssh-copies.ps1

  The copies our box scripts leave in C:\ProgramData\ssh are open only to
  SYSTEM and Administrators (#3034). That folder gives Authenticated Users
  read, as Windows OpenSSH installs it, and a file or folder made in it takes
  that rule, so on 21 Oct 2026 the rollback copies Set-SshScope.ps1 and
  Harden-VPS.ps1 had left there were readable by every account on the box.

  Against a stand-in for that folder under %TEMP%, with the same rule for
  Authenticated Users and the real PowerShell 7 the box runs (#5356):
    - New-PrivateFile, as vps-ssh-scope.ps1 and vps-harden.ps1 each carry
      it, leaves a file that takes nothing from the folder and has exactly
      SYSTEM and Administrators, Full Control, for two files in one run, and
      stops when the rules it reads back are not those. This account is not an
      administrator on the build runner (Install-Runner.ps1 puts its account
      in Users), so it is also refused the file's content, the way every
      other account on the box is; run as an administrator, as on the box,
      the content written after keeps those rules.
    - the change script Grant-BoxAccess.ps1 sends, built the way it builds
      it, makes its box-access-before folder locked, and the key file and
      token digests it copies in take no broad rule.
  tests\test-ssh-scope.ps1, tests\test-harden-vps.ps1 and
  tests\test-2891-box-access.ps1 hold the order: the rules are set while the
  file or folder is empty, before anything is written into it.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  the copies in C:\ProgramData\ssh get their rights from a Windows ACL, which only Windows has'; exit 0 }
$boxPs = Get-BoxPowerShell
. (Join-Path $repo 'scripts\vps\Lock-Folder.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$broadSids = @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11', 'S-1-3-0')
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$me).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
function Rules([string]$p) { return @((Get-Acl -LiteralPath $p).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) }
function Broad([string]$p) { return @(Rules $p | Where-Object { $broadSids -contains $_.IdentityReference.Value }).Count }
# Protected, and exactly SYSTEM and Administrators with Full Control.
function OnlyTheTwo([string]$p) {
    $acl = Get-Acl -LiteralPath $p
    $who = @(Rules $p | ForEach-Object { $_.IdentityReference.Value + ':' + $_.AccessControlType + ':' + [int]$_.FileSystemRights } | Sort-Object)
    $full = [int][Security.AccessControl.FileSystemRights]::FullControl
    return ($acl.AreAccessRulesProtected -and ($who -join ',') -eq (@("S-1-5-18:Allow:$full", "S-1-5-32-544:Allow:$full") -join ','))
}
function Run51([string]$text) {
    $f = Join-Path ([IO.Path]::GetTempPath()) ('tw-3034-' + [guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding($true)))
    try { return @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_" }) } finally { Remove-Item -LiteralPath $f -Force -EA SilentlyContinue }
}
function FunctionText([string]$path, [string]$name) {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
    $fn = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true))
    if ($fn.Count -ne 1) { return '' }
    return $fn[0].Extent.Text
}
function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }

# The stand-in for C:\ProgramData\ssh: takes nothing from above, SYSTEM and
# Administrators Full Control, Authenticated Users read for everything made
# in it, as Windows OpenSSH leaves it. This account stands for the
# administrator the box scripts run as, so it may make and remove files.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-3034-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$ssh = Join-Path $tmp 'ssh'
try {
    $null = New-Item -ItemType Directory -Path $ssh -Force
    $set = @(& icacls.exe $ssh /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ('*' + $me.User.Value + ':(OI)(CI)F') '*S-1-5-11:(OI)(CI)RX' /C /Q 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('icacls could not give the stand-in folder its rules: ' + ($set -join ' ')) }
    $plain = Join-Path $ssh 'plain.txt'
    [IO.File]::WriteAllText($plain, 'x')
    Yes 'the stand-in folder hands Authenticated Users read to a file made in it plainly, as the box''s does' ((Broad $plain) -gt 0)

    # ---- 1. New-PrivateFile, each copy ---------------------------------------------
    foreach ($box in 'vps-ssh-scope.ps1', 'vps-harden.ps1') {
        $fn = FunctionText (Join-Path $repo ('scripts\vps\' + $box)) 'New-PrivateFile'
        Yes ($box + ' has one New-PrivateFile') ([bool]$fn)
        if (-not $fn) { continue }
        $f = Join-Path $ssh ($box + '.before-test')
        $f2 = Join-Path $ssh ($box + '.before-test-2')
        # Two in one run: a security object reused across files writes
        # nothing the second time, which is what the box step of 21 Oct did.
        $out = Run51 ($fn + "`r`nNew-PrivateFile " + (Q $f) + "`r`nNew-PrivateFile " + (Q $f2) + "`r`n'MADE'")
        Yes ('  run in the box''s PowerShell 7 it makes two files in one run' + $(if (-not ($out -contains 'MADE')) { ': ' + ($out -join ' ') })) (($out -contains 'MADE') -and (Test-Path -LiteralPath $f) -and (Test-Path -LiteralPath $f2))
        Yes '  each empty, taking nothing from the folder, SYSTEM and Administrators Full Control and nobody else' ((Get-Item -LiteralPath $f).Length -eq 0 -and (OnlyTheTwo $f) -and (OnlyTheTwo $f2))
        # A copy whose rules did not take stops the run instead of carrying on.
        $bad = $fn.Replace('$item.SetAccessControl($acl)', '$null = $acl').Replace('[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, $acl)', '$null = $acl')
        $f3 = Join-Path $ssh ($box + '.not-taken')
        $out = Run51 ($bad + "`r`ntry { New-PrivateFile " + (Q $f3) + "; 'CARRIED ON' } catch { 'STOPPED ' + `$_.Exception.Message }")
        Yes '  and when the rules do not take, it reads that back and stops, naming who can still read it' ((($out -join ' ') -match '^STOPPED .*did not take SYSTEM and Administrators alone') -and -not ($out -contains 'CARRIED ON'))
        if ($isAdmin) {
            $w = Run51 ("[IO.File]::WriteAllText(" + (Q $f) + ", 'rollback stand-in')`r`n'WROTE'")
            Yes '  an administrator writes the copy into it, and the rules stay as they were' (($w -contains 'WROTE') -and [IO.File]::ReadAllText($f) -eq 'rollback stand-in' -and (OnlyTheTwo $f))
        } else {
            $read = $true
            try { [void][IO.File]::ReadAllText($f) } catch { if ($_.Exception.GetBaseException() -is [UnauthorizedAccessException]) { $read = $false } }
            Yes '  and this account, not an administrator, cannot open it, the way no other account on the box can' (-not $read)
        }
    }

    # ---- 2. Grant-BoxAccess.ps1's copy folder -----------------------------------------
    $grantPath = Join-Path $repo 'scripts\vps\Grant-BoxAccess.ps1'
    $built = FunctionText $grantPath 'Get-BoxChangeScript'
    Yes 'Grant-BoxAccess.ps1 has one Get-BoxChangeScript' ([bool]$built)
    if ($built) {
        $BridgeRoot = Join-Path $tmp 'bridge'
        $PutBack = 'Thornswood box access put back'
        $null = New-Item -ItemType Directory -Path (Join-Path $BridgeRoot 'tokens') -Force
        [IO.File]::WriteAllText((Join-Path $BridgeRoot 'bridge.js'), '// stand-in')
        [IO.File]::WriteAllText((Join-Path $BridgeRoot 'tokens\cloud'), ('c' * 64))
        $keys = Join-Path $ssh 'administrators_authorized_keys'
        $save = Join-Path $ssh 'box-access-before'
        [IO.File]::WriteAllLines($keys, [string[]]@('ssh-ed25519 AAAAstandin thornswood'))
        Invoke-Expression $built
        $script = Get-BoxChangeScript 'djinn' ('d' * 64) 'from="127.0.0.1" ssh-ed25519 AAAAnewdjinn thornswood-djinn' 'AAAAnewdjinn'
        $script = $script.Replace('C:\ProgramData\ssh\administrators_authorized_keys', $keys).Replace('C:\ProgramData\ssh\box-access-before', $save)
        # The scheduler and icacls stood in, so nothing is armed on this
        # machine and the stand-in key file keeps this account's rule.
        $stubs = @'
function Get-ScheduledTask { param($TaskName, $EA, $ErrorAction) }
function New-ScheduledTaskAction { param($Execute, $Argument) 'action' }
function New-ScheduledTaskTrigger { param([switch]$Once, $At) 'trigger' }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) 'principal' }
function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Principal, [switch]$Force) 'registered' }
function icacls { }
'@
        $out = Run51 ($stubs + "`r`n" + $script)
        Yes ('the change script runs in the box''s PowerShell 7 against the stand-in folder' + $(if (-not ($out -contains 'DONE')) { ': ' + ($out -join ' ') })) ($out -contains 'DONE')
        $copied = @(Get-ChildItem -LiteralPath $save -Recurse -Force -File)
        Yes '  its copy folder takes nothing from the folder above and gives no broad group a rule' ((Get-Acl -LiteralPath $save).AreAccessRulesProtected -and (Broad $save) -eq 0)
        Yes '  and the key file and token digest copied into it take none either' ($copied.Count -eq 2 -and @($copied | Where-Object { (Broad $_.FullName) -gt 0 }).Count -eq 0)
    }
}
finally {
    # The private files shut this account out; as their owner it may still
    # put the inherited rules back, so they can go.
    $null = & icacls.exe $tmp /reset /T /C /Q 2>&1
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
