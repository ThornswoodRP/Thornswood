<#
  test-2578-service-principals.ps1

  Issue #2578: the game servers, voice and Caddy ran as SYSTEM, Highest, so
  anything the code we deploy did, it did as SYSTEM. This holds the
  installers to scripts\deploy\ServiceAccount.ps1 (LOCAL SERVICE, Limited,
  a SID of the task's own, grants to that SID) and runs ServiceAccount.ps1 on
  scratch folders:
    - no installer of these five tasks names SYSTEM or Highest itself any
      more, each takes its principal from New-ThornswoodServicePrincipal and
      has -AsSystem as the way back;
    - the principal is LOCAL SERVICE, Limited, one privilege, Unrestricted;
    - each installer runs the fail-safe before it stops anything, and puts
      the task back on SYSTEM when the grants cannot be made;
    - the grants on a scratch folder are what the header says, and the
      fail-safe finds a folder Users may read and passes a locked one;
    - the server's installer carries an exact copy of the functions, and
      the Caddyfile keeps Caddy's certificates beside it;
    - the header names every script that copies or sends the functions
      (#4340).
  The principal and the scratch folders need Windows (ScheduledTasks and NTFS
  rules) and say SKIP off it; the rest reads text and runs anywhere. A few
  seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')
$Deploy = Join-Path $Repo 'scripts\deploy'
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Text([string]$p) { return [IO.File]::ReadAllText($p) }

$lib = Join-Path $Deploy 'ServiceAccount.ps1'
Yes 'ServiceAccount.ps1 is there' (Test-Path -LiteralPath $lib)
Yes 'ServiceAccount.ps1 is plain ASCII, which the box reads right' (
    -not ([IO.File]::ReadAllBytes($lib) | Where-Object { $_ -gt 127 }))
. $lib

# ---- the installers -----------------------------------------------------------
$server = Text (Join-Path $Deploy 'Install-ThornswoodServer.ps1')
$voice  = Text (Join-Path $Deploy 'Install-Voice.ps1')
$domain = Text (Join-Path $Deploy 'Setup-Domain.ps1')
$sysRe  = "-UserId\s+'SYSTEM'|-User\s+'SYSTEM'|-RunLevel\s+Highest"
# The server's own text, without its copy of ServiceAccount.ps1 (held to the
# original below), which names SYSTEM for -AsSystem.
$serverOwn = [regex]::Replace($server, '(?s)# ---- ServiceAccount\.ps1 \(copy\) ----.*?# ---- end ServiceAccount\.ps1 ----', '')
foreach ($pair in @(@('Install-ThornswoodServer.ps1', $serverOwn), @('Install-Voice.ps1', $voice), @('Setup-Domain.ps1', $domain))) {
    $n = $pair[0]; $t = $pair[1]
    Yes "$n names no SYSTEM principal or Highest run level of its own" (-not [regex]::IsMatch($t, $sysRe))
    Yes "$n takes its principal from New-ThornswoodServicePrincipal" ($t.Contains('New-ThornswoodServicePrincipal -AsSystem:'))
    Yes "$n has -AsSystem, the way back" ([regex]::IsMatch($t, '\[switch\]\$AsSystem'))
    Yes "$n runs the fail-safe" ($t.Contains('Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach'))
    Yes "$n grants the task's own SID and goes back on SYSTEM when it cannot" (
        $t.Contains('Get-ThornswoodTaskSid') -and $t.Contains('Grant-ThornswoodServiceFolder') -and
        $t.Contains('(New-ThornswoodServicePrincipal -AsSystem)'))
}
# The fail-safe before anything stops: ahead of the stage in the server's
# installer, ahead of the firewall and the task in voice's, ahead of
# Stop-ScheduledTask in Caddy's.
Yes 'the server installer checks before it stages or stops anything' (
    $server.IndexOf('Test-ThornswoodServiceCannotReach') -lt $server.IndexOf('# ---- the stage: nothing running is touched'))
# The server's installer carries the functions itself (nothing new is sent
# beside it, so records\remote-commands.json is unchanged); the copy must be
# ServiceAccount.ps1's exactly.
$m = [regex]::Match($server.Replace("`r`n", "`n"), '(?s)# ---- ServiceAccount\.ps1 \(copy\) ----\n(.*?)# ---- end ServiceAccount\.ps1 ----')
Yes 'the server installer carries an exact copy of ServiceAccount.ps1' (
    $m.Success -and $m.Groups[1].Value -eq (Get-ThornswoodServiceAccountScript).Replace("`r`n", "`n"))
Yes 'voice checks before the firewall rule or the task is touched' (
    $voice.IndexOf('Test-ThornswoodServiceCannotReach') -lt $voice.IndexOf("if ('`$Bind' -eq '127.0.0.1')"))
Yes 'voice sends the functions inside the script it runs on the box' ($voice.Contains('$(Get-ThornswoodServiceAccountScript)'))
Yes 'Caddy checks before it is stopped' (
    $domain.IndexOf('Test-ThornswoodServiceCannotReach') -lt $domain.IndexOf("Stop-ScheduledTask -TaskName 'Thornswood Web'"))
Yes 'Caddy sends the functions inside the script it runs on the box' ($domain.Contains('$(Get-ThornswoodServiceAccountScript)'))
Yes 'an existing Thornswood Web task is given the principal too' ($domain.Contains('-Settings `$s -Principal `$who | Out-Null'))

$caddyfile = Text (Join-Path $Deploy 'Caddyfile')
Yes 'the Caddyfile keeps certificates in C:/Thornswood-Caddy/data, the same under any account' (
    [regex]::IsMatch($caddyfile, '(?m)^\s*storage\s+file_system\s+C:/Thornswood-Caddy/data\s*$'))

# The dev instance (vps-dev-instance.ps1) runs alone on the box, so it carries
# its own copy too, and registers both dev tasks through it. The retired
# Fix-Voice.ps1 names no SYSTEM principal either.
$devInst = Text (Join-Path $Repo 'scripts\vps\vps-dev-instance.ps1')
$devOwn = [regex]::Replace($devInst, '(?s)# ---- ServiceAccount\.ps1 \(copy\) ----.*?# ---- end ServiceAccount\.ps1 ----', '')
$md = [regex]::Match($devInst.Replace("`r`n", "`n"), '(?s)# ---- ServiceAccount\.ps1 \(copy\) ----\n(.*?)# ---- end ServiceAccount\.ps1 ----')
Yes 'vps-dev-instance.ps1 carries an exact copy of ServiceAccount.ps1' (
    $md.Success -and $md.Groups[1].Value -eq (Get-ThornswoodServiceAccountScript).Replace("`r`n", "`n"))
Yes 'vps-dev-instance.ps1 names no SYSTEM principal or Highest run level of its own' (-not [regex]::IsMatch($devOwn, $sysRe))
Yes 'vps-dev-instance.ps1 no longer copies the live task principal' (-not $devOwn.Contains('-Principal $liveTask.Principal') -and -not $devOwn.Contains('-Principal $liveVoiceTask.Principal'))
Yes 'vps-dev-instance.ps1 takes its principal from New-ThornswoodServicePrincipal, with -AsSystem as the way back' (
    $devOwn.Contains('New-ThornswoodServicePrincipal -AsSystem:') -and $devOwn.Contains('(New-ThornswoodServicePrincipal -AsSystem)') -and
    [regex]::IsMatch($devOwn, '\[switch\]\$AsSystem'))
Yes 'vps-dev-instance.ps1 runs the fail-safe before any task is registered' (
    $devOwn.IndexOf('Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach') -ge 0 -and
    $devOwn.IndexOf('Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach') -lt $devOwn.IndexOf("Register-DevTask 'Thornswood Dev Server'"))
Yes 'vps-dev-instance.ps1 registers both dev tasks with their grants' (
    $devOwn.Contains("Register-DevTask 'Thornswood Dev Server'") -and $devOwn.Contains("Register-DevTask 'Thornswood Dev Voice'") -and
    $devOwn.Contains('Grant-ThornswoodServiceFolder') -and $devOwn.Contains('Get-ThornswoodTaskSid'))
$fixVoice = Text (Join-Path $Repo 'scripts\oneoff\Fix-Voice.ps1')
Yes 'Fix-Voice.ps1 (retired) names no SYSTEM principal or Highest run level' (-not [regex]::IsMatch($fixVoice, $sysRe))

# ---- the principal --------------------------------------------------------------
if ($OnWindows) {
    $p = New-ThornswoodServicePrincipal
    Yes 'the principal is NT AUTHORITY\LOCAL SERVICE' ($p.UserId -match '(?i)LOCAL SERVICE$')
    Yes 'the principal is Limited' ([string]$p.RunLevel -eq 'Limited')
    Yes 'the principal asks for SeChangeNotifyPrivilege and nothing else' (
        @($p.RequiredPrivilege).Count -eq 1 -and @($p.RequiredPrivilege)[0] -eq 'SeChangeNotifyPrivilege')
    Yes 'the principal has a SID of its own (Unrestricted)' ([string]$p.ProcessTokenSidType -eq 'Unrestricted')
    $s = New-ThornswoodServicePrincipal -AsSystem
    Yes '-AsSystem is SYSTEM, Highest, as it was' ($s.UserId -match '(?i)SYSTEM$' -and [string]$s.RunLevel -eq 'Highest')
} else {
    Write-Host 'SKIP  the principal: New-ScheduledTaskPrincipal is in ScheduledTasks, which only Windows has'
}

# ---- the text sent to the box ----------------------------------------------------
$sent = Get-ThornswoodServiceAccountScript
$ok = $true
try { $null = [scriptblock]::Create($sent) } catch { $ok = $false }
Yes 'the functions sent to the box parse' $ok
# Six from #2578, nine more for who owns what a service makes (#4077).
Yes 'and carry all fifteen' (([regex]::Matches($sent, '(?m)^function ')).Count -eq 15)

# ---- never reach ---------------------------------------------------------------
if ($OnWindows) {
    $nr = @(Get-ThornswoodServiceNeverReach -Own 'C:\Thornswood-Server')
    Yes 'never reach: the backups, the deploys and the watch folders' (
        $nr -contains 'C:\Thornswood-Backup' -and $nr -contains 'C:\Thornswood-Deploys' -and $nr -contains 'C:\Thornswood-Watch')
    Yes "never reach: another server's private folder, and voice keys, but not its own" (
        $nr -contains 'C:\Thornswood-Server-Dev\private' -and $nr -notcontains 'C:\Thornswood-Server\private' -and
        $nr -contains 'C:\Thornswood-Voice\token-key.txt')
    # A deploy into a scratch box is checked against that box (#1273): with the
    # list fixed on C:, a harness on a VPS runner looked at the real servers'
    # private folders, which the runner may not, and the install ended there.
    # Join-Path needs the scratch box's drive to be on this machine, and
    # One's runners have C: and R: but no D: (30 Oct 2026), so the scratch
    # box goes on whichever drive other than C: is here.
    $other = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -ne 'C' -and $_.Root -match '^[A-Za-z]:\\$' } | Select-Object -First 1)
    if ($other.Count) {
        $scratch = $other[0].Name + ':\scratch\box'
        $sb = @(Get-ThornswoodServiceNeverReach -Own ($scratch + '\Thornswood-Server') -Box $scratch)
        Yes 'never reach follows -Box: the scratch box is checked, and nothing on C:' (
            $sb -contains ($scratch + '\Thornswood-Backup') -and $sb -contains ($scratch + '\Thornswood-Server-Dev\private') -and
            $sb -notcontains ($scratch + '\Thornswood-Server\private') -and -not @($sb | Where-Object { $_ -like 'C:\*' }).Count)
    } else {
        Write-Host 'SKIP  never reach follows -Box: this machine has no drive but C: to put a scratch box on'
    }
    Yes '  and with no -Box it is the box, C:' (@(Get-ThornswoodServiceNeverReach) -contains 'C:\Thornswood-Server\private')
    Yes '  and C: written without its backslash is the same' (
        (@(Get-ThornswoodServiceNeverReach -Own 'C:\Thornswood-Docs' -Box 'C:') -join '|') -eq (@(Get-ThornswoodServiceNeverReach -Own 'C:\Thornswood-Docs') -join '|'))
} else {
    Write-Host 'SKIP  the never-reach list: it is the box''s folders joined onto its drive (C:\ or a scratch box on another drive), and Join-Path needs that drive to be on this machine'
}
Yes 'each caller passes the folder its own root is in as -Box' (
    $server.Contains('Get-ThornswoodServiceNeverReach -Own $Root -Box (Split-Path -Parent $Root)') -and
    $voice.Contains("Get-ThornswoodServiceNeverReach -Own '`$Root' -Box (Split-Path -Parent '`$Root')") -and
    $devInst.Contains('Get-ThornswoodServiceNeverReach -Own $dev -Box (Split-Path -Parent $dev)'))
$docs = Text (Join-Path $Deploy 'Deploy-Docs.ps1')
Yes "and Deploy-Docs does, and names the site's grants from it, not from C:" (
    $docs.Contains("Get-ThornswoodServiceNeverReach -Own '`$rootWin' -Box '`$boxWin'") -and
    $docs.Contains("@('`$boxWin\Thornswood-Server', '(OI)(NP)R')") -and -not $docs.Contains("@('C:\Thornswood-"))

# ---- scratch folders -------------------------------------------------------------
if ($OnWindows) {
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts2578-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $null = New-Item -ItemType Directory -Path $scratch
    try {
        $me  = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $sid = 'S-1-5-87-1111111111-2222222222-3333333333-444444444-555555555'
        $tree = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
        function Locked([string]$d) {
            $null = New-Item -ItemType Directory -Path $d -Force
            $a = Get-Acl -LiteralPath $d
            $a.SetAccessRuleProtection($true, $false)
            foreach ($r in @($a.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { [void]$a.RemoveAccessRuleSpecific($r) }
            foreach ($x in 'S-1-5-18', 'S-1-5-32-544', $me) {
                $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($x)), 'FullControl', $tree, 'None', 'Allow')))
            }
            Set-ThornswoodServiceAcl $d $a
        }

        $open = Join-Path $scratch 'open'
        $null = New-Item -ItemType Directory -Path $open
        $a = Get-Acl -LiteralPath $open
        $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')), 'ReadAndExecute', $tree, 'None', 'Allow')))
        Set-ThornswoodServiceAcl $open $a
        $shut = Join-Path $scratch 'shut'; Locked $shut
        $ls = Join-Path $scratch 'ls'; Locked $ls
        $a = Get-Acl -LiteralPath $ls
        $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-19')), 'Read', $tree, 'None', 'Allow')))
        Set-ThornswoodServiceAcl $ls $a

        Yes 'the fail-safe finds a folder Users may read' (@(Test-ThornswoodServiceCannotReach @($open)).Count -gt 0)
        Yes 'the fail-safe finds a folder LOCAL SERVICE may read' (@(Test-ThornswoodServiceCannotReach @($ls)).Count -gt 0)
        Yes 'the fail-safe passes a locked folder and one that is not there' (
            @(Test-ThornswoodServiceCannotReach @($shut, (Join-Path $scratch 'nothing'))).Count -eq 0)
        Yes "the fail-safe finds a folder the task's own SID may read" (
            @(Test-ThornswoodServiceCannotReach @($open) @($sid)).Count -gt 0)

        # A folder this account may not even look into, the way a VPS runner sees
        # the servers' private folders (#1273): Test-Path on what is inside is an
        # error, and without -ErrorAction Stop it said False and the path was
        # passed over as not there. Only SYSTEM is let in; the owner, this
        # account, may still put its rules back for the clean-up.
        # Every rule but SYSTEM's comes off, its own as well as the inherited
        # ones: on GitHub's runners TEMP passes nothing down, so the folders
        # hold their maker's default rules, Administrators among them, as
        # their own, and an elevated run still looked in (#5062). The inner
        # folder keeps only what it inherits, so SYSTEM's alone.
        $hidden = Join-Path $scratch 'hidden'
        $null = New-Item -ItemType Directory -Path (Join-Path $hidden 'private') -Force
        $null = & icacls (Join-Path $hidden 'private') /reset
        $null = & icacls $hidden /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F'
        foreach ($r in @((Get-Acl -LiteralPath $hidden).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
            if ($r.IdentityReference.Value -ne 'S-1-5-18') { $null = & icacls $hidden /remove:g ('*' + $r.IdentityReference.Value) }
        }
        try {
            $left = @((Get-Acl -LiteralPath $hidden).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
            Yes ('  the folder it may not look into lets SYSTEM alone in (' + ($left -join ', ') + ')') (($left -join ',') -eq 'S-1-5-18')
            $why = @(Test-ThornswoodServiceCannotReach @((Join-Path $hidden 'private')))
            Yes ('the fail-safe refuses a path it may not look for, rather than passing it over (' + ($why -join ' | ') + ')') (
                $why.Count -eq 1 -and $why[0] -match 'could not be checked')
        } finally { $null = & icacls $hidden /grant ('*' + $me + ':(OI)(CI)F') }

        $root = Join-Path $scratch 'root'; Locked $root
        foreach ($d in 'world', 'data', 'private') { Locked (Join-Path $root $d) }
        Set-Content -LiteralPath (Join-Path $root 'gamemode.js') -Value '// code'
        Set-Content -LiteralPath (Join-Path $root 'server.log') -Value 'a line'
        $said = @(Grant-ThornswoodServiceFolder -Root $root -Sid $sid -Writable 'world', 'data', 'private', 'for-bot' -Files '*.log', '*.log.*')
        Yes 'the grant says what it gave' ($said.Count -ge 4)

        function RulesFor([string]$p, [string]$who) {
            return @((Get-Acl -LiteralPath $p).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
                     Where-Object { $_.IdentityReference.Value -eq $who -and [string]$_.AccessControlType -eq 'Allow' })
        }
        $fsr = [Security.AccessControl.FileSystemRights]
        $write = [long]($fsr::WriteData -bor $fsr::AppendData -bor $fsr::Delete)
        function Can([string]$p, [string]$who, [long]$bits) {
            $have = 0L; foreach ($r in (RulesFor $p $who)) { $have = $have -bor [long][int]$r.FileSystemRights }
            return (($have -band $bits) -eq $bits)
        }
        function CanAny([string]$p, [string]$who, [long]$bits) {
            $have = 0L; foreach ($r in (RulesFor $p $who)) { $have = $have -bor [long][int]$r.FileSystemRights }
            return (($have -band $bits) -ne 0)
        }
        $gm = Join-Path $root 'gamemode.js'
        Yes 'the task may read and run gamemode.js' (Can $gm $sid ([long]$fsr::ReadAndExecute))
        Yes 'and may not change or delete it' (-not (CanAny $gm $sid ([long]($fsr::WriteData -bor $fsr::AppendData -bor $fsr::Delete))))
        Yes 'LOCAL SERVICE itself is given nothing on it' (@(RulesFor $gm 'S-1-5-19').Count -eq 0)
        Yes 'the task may make files and folders in the root' (Can $root $sid ([long]($fsr::CreateFiles -bor $fsr::CreateDirectories)))
        Yes 'and may not delete what is in it' (-not (CanAny $root $sid ([long]$fsr::DeleteSubdirectoriesAndFiles)))
        $co = @((Get-Acl -LiteralPath $root).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) |
                Where-Object { $_.IdentityReference.Value -eq 'S-1-3-0' })
        Yes 'what it makes there is its own to change (CREATOR OWNER Modify, inherit only)' (
            $co.Count -eq 1 -and ($co[0].FileSystemRights -band $fsr::Modify) -eq $fsr::Modify -and [string]$co[0].PropagationFlags -eq 'InheritOnly')
        Yes 'the log a SYSTEM task left behind it may keep writing' (Can (Join-Path $root 'server.log') $sid $write)
        foreach ($d in 'world', 'data', 'private') {
            Yes "it may change what is in $d" (Can (Join-Path $root $d) $sid ([long]$fsr::Modify))
        }
        Yes 'a writable folder that is not there is passed over' (-not (Test-Path -LiteralPath (Join-Path $root 'for-bot')))
        $threw = $false
        try { $null = Grant-ThornswoodServiceFolder -Root (Join-Path $scratch 'gone') -Sid $sid } catch { $threw = $true }
        Yes 'a root that is not there throws, so the installer puts the task back on SYSTEM' $threw
    } finally {
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host 'SKIP  the grants and the fail-safe on scratch folders: they are NTFS rules, read and written with Get-Acl and icacls, which only Windows has'
}

# ---- who else carries the functions (#4340) ------------------------------------
# The header names the two scripts that carry a copy and the scripts that send
# the functions as text. Both lists are held to the scripts that really do it,
# so the next editor of a function reads where else it goes.
$hdr = [regex]::Match((Text $lib).Replace("`r`n", "`n"), '(?s)WHO ELSE CARRIES THEM\.(.*?)So a change to a function here').Groups[1].Value
$cut = $hdr.IndexOf('send the functions as text')
$named = { param([string]$t) @([regex]::Matches($t, '(?m)^\s+(scripts\\\S+\.ps1)\s*$') | ForEach-Object { $_.Groups[1].Value.Replace('\', '/') } | Sort-Object) }
$namedCopies = if ($cut -gt 0) { & $named $hdr.Substring(0, $cut) } else { @() }
$namedSenders = if ($cut -gt 0) { & $named $hdr.Substring($cut) } else { @() }
$scripts = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Filter '*.ps1' |
    Where-Object { $_.FullName -ne (Resolve-Path -LiteralPath $lib).Path -and $_.FullName -notmatch '[\\/]scripts[\\/]tests[\\/]' })
$rel = { param($f) [IO.Path]::GetRelativePath($Repo, $f.FullName).Replace('\', '/') }
$realCopies = @($scripts | Where-Object { (Text $_.FullName).Contains('# ---- ServiceAccount.ps1 (copy) ----') } | ForEach-Object { & $rel $_ } | Sort-Object)
$realSenders = @($scripts | Where-Object { (Text $_.FullName) -match '(?m)^(?!\s*#).*\(Get-ThornswoodServiceAccountScript\)' } | ForEach-Object { & $rel $_ } | Sort-Object)
Yes ("ServiceAccount.ps1's header names every script that carries a copy, and only those ({0})" -f ($realCopies -join ', ')) (
    $realCopies.Count -gt 0 -and ($namedCopies -join ',') -eq ($realCopies -join ','))
Yes ("  and every script that sends the functions as text, and only those ({0})" -f $realSenders.Count) (
    $realSenders.Count -gt 0 -and ($namedSenders -join ',') -eq ($realSenders -join ','))

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
exit 0
