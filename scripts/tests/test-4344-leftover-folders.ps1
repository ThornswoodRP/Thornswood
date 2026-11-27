<#
  test-4344-leftover-folders.ps1

      pwsh -NoProfile -File .\scripts\tests\test-4344-leftover-folders.ps1

  A folder that Remove-HandMadeTasks.ps1 leaves on the box is locked by
  Lock-VpsFolders.ps1, and said (issue #4344). The remover leaves
  C:\Thornswood-Maint or C:\Thornswood-Diagnostics on purpose when the task
  changed, the folder is or holds a link, holds a crash dump or is in use, or
  removing it failed; #3288 had taken Maint off Lock-VpsFolders' list, so a
  folder left that way kept the Users rule from C:\ and nothing said so.

  WHAT IT CHECKS.
    everywhere   every folder the remover may leave is one Lock-VpsFolders.ps1
                 takes, read from both scripts, so a third one added to the
                 remover is not skipped again
    on Windows   against scratch folders under %TEMP% whose parent gives
                 Users a rule the way C:\ does, with the real Get-Acl and
                 Set-Acl, read back: -WhatIf says it would lock both, names
                 the remover and changes nothing; a run locks both, takes
                 every Users rule off the script and the settings copy,
                 keeps a rule set by name, says each was left, and exits 0;
                 a second run changes nothing; a Maint that is a link is
                 refused, left as it is, and the run exits 1
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$lockBox = Join-Path $repo 'scripts\vps\Lock-VpsFolders.ps1'
$remover = Join-Path $repo 'scripts\vps\Remove-HandMadeTasks.ps1'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# ------------------------------------------------ everywhere: the two lists agree
$rm = Get-Content -LiteralPath $remover -Raw
$lk = Get-Content -LiteralPath $lockBox -Raw
$left = @([regex]::Matches($rm, "Folder = '([^']+)'") | ForEach-Object { $_.Groups[1].Value })
$m = [regex]::Match($lk, "(?m)^\`$leftRule = '([^']+)'")
$nm = [regex]::Match($lk, "(?m)^\`$nameRule = '([^']+)'")
Yes ('the remover names its folders (' + ($left -join ', ') + ')') ($left.Count -ge 2)
Yes 'Lock-VpsFolders.ps1 has a rule for what the remover leaves, and its folder rule' ($m.Success -and $nm.Success)
if ($m.Success -and $nm.Success) {
    foreach ($f in $left) {
        Yes ("  $f is taken by Lock-VpsFolders.ps1 as one the remover left") ($f -match $m.Groups[1].Value -and $f -match $nm.Groups[1].Value)
    }
}

. (Join-Path (Join-Path $repo 'tests') 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  the folder rules themselves: a Windows ACL that Lock-VpsFolders.ps1 sets, which only Windows has'; Done }
$boxPs = Get-BoxPowerShell

function Put([string]$p, [string]$t) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p)
    [IO.File]::WriteAllText($p, $t)
}
$runner = 'S-1-5-21-1-2-3-1001'
function All([string]$p) { return @((Get-Acl -LiteralPath $p).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) }
function Broad([string]$p) { return @(All $p | Where-Object { @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11', 'S-1-3-0') -contains $_.IdentityReference.Value }).Count }
function Named([string]$p, [string]$sid) { return @(All $p | Where-Object { $_.IdentityReference.Value -eq $sid }) }
function Grant([string]$p, [string]$sid, [string]$rights, [string]$inh) {
    $acl = Get-Acl -LiteralPath $p
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), $rights, $inh, 'None', 'Allow')))
    Set-Acl -LiteralPath $p -AclObject $acl
}
function Box([string]$c, [string[]]$more) {
    $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $lockBox, '-Parent', $c, '-SiteSid', 'none', '-BotSid', 'none', '-DumpWriterSids', 'none', '-AllowGamingPc') + $more
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& $boxPs @a 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
    $script:code = $LASTEXITCODE
    return ($o -join "`n")
}

$box = Join-Path ([IO.Path]::GetTempPath()) ('ts-4344-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $box
# The rule C:\ gives every folder under it.
Grant $box 'S-1-5-32-545' 'ReadAndExecute, AppendData, CreateFiles' 'ContainerInherit, ObjectInherit'
try {
    # ------------------------------------------------ both left behind
    $c = Join-Path $box 'c'
    $maint = Join-Path $c 'Thornswood-Maint'
    $diag = Join-Path $c 'Thornswood-Diagnostics'
    Put (Join-Path $maint 'update.ps1') 'run as SYSTEM'
    Put (Join-Path $diag 'server-settings.json') '{}'
    Grant $maint $runner 'Read' 'ContainerInherit, ObjectInherit'
    Yes 'the scratch folders start the way C:\ leaves them, Users reaching update.ps1' ((Broad (Join-Path $maint 'update.ps1')) -gt 0)
    $before = @{ M = (Get-Acl -LiteralPath $maint).Sddl; D = (Get-Acl -LiteralPath $diag).Sddl }
    $o = Box $c @('-WhatIf')
    Yes '-WhatIf says it would lock both' ($o -match ('WOULD LOCK ' + [regex]::Escape($maint) + ':') -and $o -match ('WOULD LOCK ' + [regex]::Escape($diag) + ':'))
    Yes '  says each was left by the remover' ($o -match ([regex]::Escape($maint) + ' was left by .*Remove-HandMadeTasks\.ps1') -and $o -match ([regex]::Escape($diag) + ' was left by .*Remove-HandMadeTasks\.ps1'))
    Yes '  and changes nothing' ((Get-Acl -LiteralPath $maint).Sddl -eq $before.M -and (Get-Acl -LiteralPath $diag).Sddl -eq $before.D -and $o -match 'WHATIF: nothing was changed')
    $o = Box $c @()
    Yes ('a run locks both and refuses none (exit ' + $script:code + ')') ($script:code -eq 0 -and $o -match 'LOCKED 2 folder\(s\), 0 refused')
    foreach ($p in $maint, (Join-Path $maint 'update.ps1'), $diag, (Join-Path $diag 'server-settings.json')) {
        Yes "no Users, Everyone or Authenticated Users rule reaches $p" ((Broad $p) -eq 0)
    }
    foreach ($p in $maint, $diag) {
        Yes "$p takes nothing from above" ((Get-Acl -LiteralPath $p).AreAccessRulesProtected -and @(All $p | Where-Object { $_.IsInherited }).Count -eq 0)
        Yes '  and SYSTEM and Administrators have Full Control of it' (
            @(Named $p 'S-1-5-18' | Where-Object { "$($_.FileSystemRights)" -match 'FullControl' }).Count -ge 1 -and @(Named $p 'S-1-5-32-544' | Where-Object { "$($_.FileSystemRights)" -match 'FullControl' }).Count -ge 1)
    }
    Yes 'a rule set on Maint by name stays, on the folder and the script in it' (@(Named $maint $runner).Count -ge 1 -and @(Named (Join-Path $maint 'update.ps1') $runner).Count -ge 1)
    Yes 'the run says each was left by the remover' ($o -match ([regex]::Escape($maint) + ' was left by .*Remove-HandMadeTasks\.ps1') -and $o -match ([regex]::Escape($diag) + ' was left by'))
    $s1 = @{ M = (Get-Acl -LiteralPath $maint).Sddl; D = (Get-Acl -LiteralPath $diag).Sddl }
    $o = Box $c @()
    Yes 'run again, nothing changes' ($script:code -eq 0 -and (Get-Acl -LiteralPath $maint).Sddl -eq $s1.M -and (Get-Acl -LiteralPath $diag).Sddl -eq $s1.D)

    # ------------------------------------------------ a Maint that is a link
    $d = Join-Path $box 'd'
    $target = Join-Path $box 'elsewhere'
    Put (Join-Path $target 'x.txt') 'not ours'
    $null = New-Item -ItemType Directory -Force -Path $d
    $null = New-Item -ItemType Junction -Path (Join-Path $d 'Thornswood-Maint') -Target $target
    $bt = (Get-Acl -LiteralPath $target).Sddl
    $o = Box $d @()
    Yes ('a Maint that is a link is refused and the run exits 1 (exit ' + $script:code + ')') ($o -match ('REFUSED ' + [regex]::Escape((Join-Path $d 'Thornswood-Maint')) + ': it is a link') -and $script:code -eq 1)
    Yes '  and what it points at is left as it is' ((Get-Acl -LiteralPath $target).Sddl -eq $bt -and (Broad (Join-Path $target 'x.txt')) -gt 0)
} finally {
    Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
}
Done
