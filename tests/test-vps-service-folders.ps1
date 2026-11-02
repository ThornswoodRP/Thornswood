<#
  test-vps-service-folders.ps1

      pwsh -NoProfile -File .\tests\test-vps-service-folders.ps1

  Lock-VpsFolders.ps1 takes Users off the watchdog's, the deploy store's,
  Caddy's and the dumps folders (issues #1183 and #1691), run against scratch
  folders under %TEMP% with the real Get-Acl and Set-Acl, read back. Watch,
  Deploys and Caddy keep their rules by name (the bot's on
  Watch, the site's on Deploys\current, a runner's deny); Dumps is SYSTEM's and
  Administrators', with write and no read for LOCAL SERVICE and the runners
  (WER's node.exe crash dumps), every other rule by name gone, a runner's deny
  too. Watch is refused while the bot has no rule on it, and
  Deploys while the site has none on current, and each is then left as it was.
  tests\test-server-acl.ps1 covers the server, voice and backup folders.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
$lockBox = Join-Path $repo 'scripts\vps\Lock-VpsFolders.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  who may write the service folders is a Windows ACL that Lock-VpsFolders.ps1 sets, which only Windows has'; exit 0 }
$boxPs = Get-BoxPowerShell

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Put([string]$p, [string]$t) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p)
    [IO.File]::WriteAllText($p, $t)
}
$users = 'S-1-5-32-545'
$site = 'S-1-5-19'
$runner = 'S-1-5-21-1-2-3-1001'
$bot = 'S-1-5-80-1-2-3-4-5'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$keep = @('S-1-5-18', 'S-1-5-32-544', $me)
function Sid($r) { return $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
function All([string]$p) { return @((Get-Acl -LiteralPath $p).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) }
function Broad([string]$p) { return @(All $p | Where-Object { @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11') -contains $_.IdentityReference.Value }).Count }
function Named([string]$p, [string]$sid) { return @(All $p | Where-Object { $_.IdentityReference.Value -eq $sid }) }
function Grant([string]$p, [string]$sid, [string]$rights, [string]$inh, [string]$prop, [string]$type = 'Allow') {
    $acl = Get-Acl -LiteralPath $p
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), $rights, $inh, $prop, $type)))
    Set-Acl -LiteralPath $p -AclObject $acl
}
function Box([string]$c, [string]$botSid, [string[]]$more) {
    $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $lockBox, '-Parent', $c, '-SiteSid', $site, '-BotSid', $botSid, '-AllowGamingPc', '-DumpWriterSids', ($site + ',' + $runner)) + $more
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& $boxPs @a 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
    $script:code = $LASTEXITCODE
    return ($o -join "`n")
}
function Make([string]$c) {
    Put (Join-Path $c 'Thornswood-Watch\watch.ps1') 'runs as SYSTEM'
    Put (Join-Path $c 'Thornswood-Watch\alerts.jsonl') '{}'
    Put (Join-Path $c 'Thornswood-Deploys\history.log') 'sent'
    Put (Join-Path $c 'Thornswood-Deploys\current\site.txt') 'what the site runs'
    Put (Join-Path $c 'Thornswood-Deploys\gamemode\a.zip') 'artifact'
    Put (Join-Path $c 'Thornswood-Caddy\caddy.exe') 'program'
    Put (Join-Path $c 'Thornswood-Caddy\Caddyfile') 'config'
    # Off the box since #3288: never touched now, like Docs.
    Put (Join-Path $c 'Thornswood-Maint\update.ps1') 'made by hand'
    Put (Join-Path $c 'Thornswood-Dumps\crash.dmp') 'unknown'
    Put (Join-Path $c 'Thornswood-Docs\x.txt') 'not ours here'
}

$box = Join-Path ([IO.Path]::GetTempPath()) ('ts-svc-folders-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $box
# The rule C:\ gives every folder under it.
Grant $box $users 'ReadAndExecute, AppendData, CreateFiles' 'ContainerInherit, ObjectInherit' 'None'
try {
    # ------------------------------------------------ everything in place
    $c = Join-Path $box 'c'; Make $c
    Grant (Join-Path $c 'Thornswood-Watch') $bot 'Read' 'ObjectInherit' 'None'
    Grant (Join-Path $c 'Thornswood-Watch\alerts.jsonl') $bot 'Read' 'None' 'None'
    Grant (Join-Path $c 'Thornswood-Deploys\current') $site 'Read' 'ObjectInherit' 'NoPropagateInherit'
    Grant (Join-Path $c 'Thornswood-Deploys') $runner 'FullControl' 'ContainerInherit, ObjectInherit' 'None' 'Deny'
    Grant (Join-Path $c 'Thornswood-Dumps') $site 'Read' 'ContainerInherit, ObjectInherit' 'None'
    Grant (Join-Path $c 'Thornswood-Dumps') $runner 'FullControl' 'ContainerInherit, ObjectInherit' 'None' 'Deny'
    $names = 'Thornswood-Watch', 'Thornswood-Deploys', 'Thornswood-Caddy', 'Thornswood-Dumps'
    Yes 'the scratch folders start the way C:\ leaves them, Users reaching caddy.exe' ((Broad (Join-Path $c 'Thornswood-Caddy\caddy.exe')) -gt 0)
    $before = @{}; foreach ($n in $names) { $before[$n] = (Get-Acl -LiteralPath (Join-Path $c $n)).Sddl }
    $o = Box $c $bot @('-WhatIf')
    foreach ($n in $names) { Yes "-WhatIf says it would lock $n" ($o -match ('WOULD LOCK ' + [regex]::Escape((Join-Path $c $n)) + ':')) }
    Yes '-WhatIf names the Dumps writers' ($o -match ('WOULD LOCK ' + [regex]::Escape((Join-Path $c 'Thornswood-Dumps')) + ':.*write \(no read\) for ' + [regex]::Escape($site + ', ' + $runner)))
    Yes '-WhatIf changes nothing' (@($names | Where-Object { (Get-Acl -LiteralPath (Join-Path $c $_)).Sddl -ne $before[$_] }).Count -eq 0 -and $o -match 'WHATIF: nothing was changed')
    $o = Box $c $bot @()
    Yes ('it locks all four and refuses none (exit ' + $script:code + ')') ($script:code -eq 0 -and $o -match 'LOCKED 4 folder\(s\), 0 refused')
    foreach ($n in $names) {
        $p = Join-Path $c $n
        Yes "$n takes nothing from C:\" ((Get-Acl -LiteralPath $p).AreAccessRulesProtected -and @(All $p | Where-Object { $_.IsInherited }).Count -eq 0)
        Yes "  SYSTEM and Administrators have Full Control of it" (
            @(Named $p 'S-1-5-18' | Where-Object { "$($_.FileSystemRights)" -match 'FullControl' }).Count -ge 1 -and @(Named $p 'S-1-5-32-544' | Where-Object { "$($_.FileSystemRights)" -match 'FullControl' }).Count -ge 1)
    }
    foreach ($p in 'Thornswood-Watch\watch.ps1', 'Thornswood-Watch\alerts.jsonl', 'Thornswood-Deploys\history.log', 'Thornswood-Deploys\current\site.txt',
                   'Thornswood-Deploys\gamemode\a.zip', 'Thornswood-Caddy\caddy.exe', 'Thornswood-Caddy\Caddyfile', 'Thornswood-Dumps\crash.dmp') {
        Yes "no Users, Everyone or Authenticated Users rule reaches $p" ((Broad (Join-Path $c $p)) -eq 0)
    }
    Yes 'the bot keeps its read on the watchdog''s files' (@(Named (Join-Path $c 'Thornswood-Watch\watch.ps1') $bot).Count -ge 1 -and @(Named (Join-Path $c 'Thornswood-Watch\alerts.jsonl') $bot).Count -ge 1)
    Yes 'the site keeps its read on Deploys\current' (@(Named (Join-Path $c 'Thornswood-Deploys\current\site.txt') $site).Count -eq 1)
    Yes '  and reaches nothing else in the deploy store' (@(Named (Join-Path $c 'Thornswood-Deploys\history.log') $site).Count -eq 0 -and @(Named (Join-Path $c 'Thornswood-Deploys\gamemode\a.zip') $site).Count -eq 0)
    Yes 'the runner''s deny on Deploys stays' (@(Named (Join-Path $c 'Thornswood-Deploys') $runner | Where-Object { "$($_.AccessControlType)" -eq 'Deny' }).Count -eq 1)
    Yes 'nobody but SYSTEM, Administrators and the bot reaches Caddy' (
        @(@((Get-Acl -LiteralPath (Join-Path $c 'Thornswood-Caddy\caddy.exe')).Access) | Where-Object { $keep -notcontains (Sid $_) }).Count -eq 0)
    $x = @((Get-Acl -LiteralPath (Join-Path $c 'Thornswood-Dumps\crash.dmp')).Access | ForEach-Object { Sid $_ } | Sort-Object -Unique)
    Yes ('Dumps holds only SYSTEM, Administrators and the two writers, the site''s read gone (' + ($x -join ', ') + ')') (@($x | Where-Object { $keep -notcontains $_ -and @($site, $runner) -notcontains $_ }).Count -eq 0)
    $WriteBits = [Security.AccessControl.FileSystemRights]'Write'; $Rd = [Security.AccessControl.FileSystemRights]'ReadData'
    foreach ($w in $site, $runner) {
        foreach ($p in 'Thornswood-Dumps', 'Thornswood-Dumps\crash.dmp') {
            $r = @(Named (Join-Path $c $p) $w)
            Yes "  $w may make and write files in $p, and reads nothing there" (
                $r.Count -ge 1 -and @($r | Where-Object { "$($_.AccessControlType)" -eq 'Deny' }).Count -eq 0 -and
                @($r | Where-Object { ($_.FileSystemRights -band $WriteBits) -eq $WriteBits }).Count -ge 1 -and @($r | Where-Object { ($_.FileSystemRights -band $Rd) -ne 0 }).Count -eq 0)
        }
    }
    Yes 'each is read back' ($o -match ([regex]::Escape((Join-Path $c 'Thornswood-Caddy')) + ': takes nothing from above, no Users rule'))
    Yes 'a folder that is not ours is never touched' ((Broad (Join-Path $c 'Thornswood-Docs\x.txt')) -gt 0)
    Yes '  and neither is Maint, which #3288 took off the list' ((Broad (Join-Path $c 'Thornswood-Maint\update.ps1')) -gt 0 -and $o -notmatch [regex]::Escape((Join-Path $c 'Thornswood-Maint')))
    $s1 = @{}; foreach ($n in $names) { $s1[$n] = (Get-Acl -LiteralPath (Join-Path $c $n)).Sddl }
    $o = Box $c $bot @()
    Yes 'run again, nothing changes' ($script:code -eq 0 -and @($names | Where-Object { (Get-Acl -LiteralPath (Join-Path $c $_)).Sddl -ne $s1[$_] }).Count -eq 0)

    # ------------------------------------------------ the bot and the site with no rule
    $d = Join-Path $box 'd'; Make $d
    $bw = (Get-Acl -LiteralPath (Join-Path $d 'Thornswood-Watch')).Sddl
    $bd = (Get-Acl -LiteralPath (Join-Path $d 'Thornswood-Deploys')).Sddl
    $o = Box $d $bot @()
    Yes 'Watch is refused while the bot has no rule on it, saying to run Install-Bot.ps1' ($o -match ('REFUSED ' + [regex]::Escape((Join-Path $d 'Thornswood-Watch')) + ': the bot''s account has no rule') -and $o -match 'Install-Bot\.ps1 first')
    Yes 'Deploys is refused while the site has no rule on current, saying to run Deploy-Docs.ps1' ($o -match ('REFUSED ' + [regex]::Escape((Join-Path $d 'Thornswood-Deploys')) + ': the site''s account has no rule') -and $o -match 'Deploy-Docs\.ps1 first')
    Yes '  both left exactly as they were, and it exits non-zero' ((Get-Acl -LiteralPath (Join-Path $d 'Thornswood-Watch')).Sddl -eq $bw -and (Get-Acl -LiteralPath (Join-Path $d 'Thornswood-Deploys')).Sddl -eq $bd -and $script:code -ne 0)
    Yes '  and the other two are locked' (@('Thornswood-Caddy\caddy.exe', 'Thornswood-Dumps\crash.dmp' | Where-Object { (Broad (Join-Path $d $_)) -gt 0 }).Count -eq 0)
    $o = Box $d 'none' @()
    Yes 'with no bot on the box, Watch is locked without a bot rule' ($o -match ('locked ' + [regex]::Escape((Join-Path $d 'Thornswood-Watch'))) -and (Broad (Join-Path $d 'Thornswood-Watch\watch.ps1')) -eq 0)
} finally {
    Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0