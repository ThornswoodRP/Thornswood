<#
  test-server-acl.ps1

      powershell -NoProfile -File .\tests\test-server-acl.ps1

  No BUILTIN\Users rule reaches the game servers' folders, and private is
  SYSTEM's and Administrators' alone, at every install and now (issue #1105).

  WHY THIS EXISTS. Every folder made under C:\ inherits Windows' rule that
  BUILTIN\Users may read it, and every service account on the VPS is in Users:
  the bot's NT SERVICE\ThornswoodBot, the site's LOCAL SERVICE, the build
  runner's. So each could read C:\Thornswood-Server\private\door.json, the key
  the site trusts. Nothing took that rule off the server folders.

  WHAT IT CHECKS, on scratch folders with the real Get-Acl and Set-Acl, read
  back:
    the installer   Lock-ServerRoot and Lock-ServerDir, lifted out of
                    Install-ThornswoodServer.ps1, on a new root (the stage it
                    swaps in, which inherits Users) and the root it replaced:
                    nothing inherited, no Users rule anywhere, the site's
                    rules by name carried across onto the root and data, a
                    build runner's deny kept, private SYSTEM's and
                    Administrators' only, the bot's rule on moderation.log
                    in private from before #2321 kept, for-bot SYSTEM's,
                    Administrators' and the bot's to read, a staff log made
                    in it afterwards readable by the bot and private still
                    not (#2321),
                    kept, the folder it replaced locked too; and the installer
                    calls it after the world and roster are carried across and
                    before the server's task is started
    the box         Lock-VpsFolders.ps1 run against a scratch C:\: -WhatIf
                    changes nothing, a server folder the site has no rule on is
                    refused and left as it was while the rest are locked, the
                    voice folder keeps the site's rule on chat, a folder that is
                    not ours is never touched, and it refuses a machine that is not the box
  test-install-server.ps1 runs the whole installer and reads the same back.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
$installer = Join-Path $repo 'scripts\deploy\Install-ThornswoodServer.ps1'
$lockBox = Join-Path $repo 'scripts\vps\Lock-VpsFolders.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  who may read the server folders is a Windows ACL, read back with Get-Acl, so this runs only on Windows'; exit 0 }
$ps = Get-BoxPowerShell

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Put([string]$p, [string]$t) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p)
    [IO.File]::WriteAllText($p, $t)
}
$users = 'S-1-5-32-545'
$site = 'S-1-5-19'          # LOCAL SERVICE, which the site runs as
$runner = 'S-1-5-21-1-2-3-1001'  # a stand-in for the build runner's account
$bot = 'S-1-5-80-1-2-3-4-5'      # a stand-in for NT SERVICE\ThornswoodBot
function Sid($r) { return $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
function All([string]$p) { return @((Get-Acl -LiteralPath $p).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) }
function Broad([string]$p) { return @(All $p | Where-Object { @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11') -contains $_.IdentityReference.Value }).Count }
function Named([string]$p, [string]$sid) { return @(All $p | Where-Object { $_.IdentityReference.Value -eq $sid }) }
function Grant([string]$p, [string]$sid, [string]$rights, [string]$inh, [string]$prop, [string]$type = 'Allow') {
    $acl = Get-Acl -LiteralPath $p
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), $rights, $inh, $prop, $type)))
    Set-Acl -LiteralPath $p -AclObject $acl
}

$box = Join-Path ([IO.Path]::GetTempPath()) ('ts-server-acl-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $box
# The rule C:\ gives every folder under it, on the scratch folder, so what is
# made in it inherits it the way it does on the box.
Grant $box $users 'ReadAndExecute, CreateFiles' 'ContainerInherit, ObjectInherit' 'None'

try {
    # ================================================================ the installer
    $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$null, [ref]$e)
    Yes 'Install-ThornswoodServer.ps1 parses' (@($e).Count -eq 0)
    $fns = @{}
    foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $fns[$f.Name] = $f.Extent.Text }
    Yes 'it has Lock-ServerDir and Lock-ServerRoot' ($fns.ContainsKey('Lock-ServerDir') -and $fns.ContainsKey('Lock-ServerRoot'))
    function Say([string]$m, [string]$c = 'Gray') { $script:said += $m }
    . ([scriptblock]::Create($fns['Lock-ServerDir'] + "`n" + $fns['Lock-ServerRoot']))

    $old = Join-Path $box 'Thornswood-Server.prev-20260929-120000'
    $new = Join-Path $box 'Thornswood-Server'
    Put (Join-Path $old 'server-settings.json') '{}'
    Put (Join-Path $old 'data\shipped.txt') 'old'
    # What the box has on the root going out: the site's read on the files in
    # the root and in data (Deploy-Docs.ps1), and the runner's deny.
    Grant $old $site 'Read' 'ObjectInherit' 'NoPropagateInherit'
    Grant (Join-Path $old 'data') $site 'Read' 'ObjectInherit' 'NoPropagateInherit'
    Grant $old $runner 'FullControl' 'ContainerInherit, ObjectInherit' 'None' 'Deny'
    # The one coming in, as the stage leaves it, with the world and the roster
    # carried across into it.
    Put (Join-Path $new 'server-settings.json') '{}'
    Put (Join-Path $new 'server.log') 'log'
    Put (Join-Path $new 'data\shipped.txt') 'new'
    Put (Join-Path $new 'world\w.txt') 'every character'
    Put (Join-Path $new 'private\door.json') '{ "key": "the door key" }'
    Put (Join-Path $new 'private\moderation.log') '{}'
    Grant (Join-Path $new 'private\moderation.log') $bot 'Read' 'None' 'None'
    # The folder the installer makes for the gamemode's staff log (#2321), as
    # it is before the lock: inheriting from the root, and so Users.
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $new 'for-bot')
    Yes 'the scratch root starts the way a stage does, with Users reaching private\door.json' ((Broad (Join-Path $new 'private\door.json')) -gt 0)

    $script:said = @()
    Lock-ServerRoot $new $old $bot
    if ($new) { Lock-ServerRoot $old '' }
    Yes 'it says it locked the root' (($script:said -join ' ') -match 'locked ' + [regex]::Escape($new) -and ($script:said -join ' ') -notmatch 'COULD NOT')
    foreach ($p in @($new, (Join-Path $new 'server-settings.json'), (Join-Path $new 'server.log'), (Join-Path $new 'data'), (Join-Path $new 'data\shipped.txt'),
                     (Join-Path $new 'world\w.txt'), (Join-Path $new 'private'), (Join-Path $new 'private\door.json'), (Join-Path $new 'private\moderation.log'),
                     $old, (Join-Path $old 'data\shipped.txt'))) {
        Yes ('no Users, Everyone or Authenticated Users rule reaches ' + $p.Substring($box.Length + 1)) ((Broad $p) -eq 0)
    }
    Yes 'the root takes nothing from C:\' ((Get-Acl -LiteralPath $new).AreAccessRulesProtected -and @(All $new | Where-Object { $_.IsInherited }).Count -eq 0)
    $x = @(Named $new 'S-1-5-18' | Where-Object { "$($_.FileSystemRights)" -match 'FullControl' -and "$($_.InheritanceFlags)" -match 'ContainerInherit' })
    Yes 'SYSTEM, which the server runs as, has Full Control of all of it' ($x.Count -ge 1 -and @(Named (Join-Path $new 'world\w.txt') 'S-1-5-18').Count -ge 1)
    Yes 'and Administrators' (@(Named $new 'S-1-5-32-544' | Where-Object { "$($_.FileSystemRights)" -match 'FullControl' }).Count -ge 1)
    $x = @(Named $new $site)
    Yes 'the site''s read on the root''s files is carried across from the folder it replaced' ($x.Count -eq 1 -and "$($x[0].FileSystemRights)" -match '^Read' -and "$($x[0].PropagationFlags)" -match 'NoPropagateInherit')
    Yes '  so it reaches server.log' (@(Named (Join-Path $new 'server.log') $site).Count -eq 1)
    Yes '  and data''s files, carried from the old data' (@(Named (Join-Path $new 'data') $site | Where-Object { -not $_.IsInherited }).Count -eq 1 -and @(Named (Join-Path $new 'data\shipped.txt') $site).Count -eq 1)
    Yes '  and never private or the world' (@(Named (Join-Path $new 'private\door.json') $site).Count -eq 0 -and @(Named (Join-Path $new 'world\w.txt') $site).Count -eq 0)
    Yes 'the build runner''s deny is carried across' (@(Named $new $runner | Where-Object { "$($_.AccessControlType)" -eq 'Deny' }).Count -eq 1)
    $pacl = Get-Acl -LiteralPath (Join-Path $new 'private')
    $who = @($pacl.Access | ForEach-Object { Sid $_ } | Sort-Object -Unique)
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    Yes ('private takes nothing from the root, and is SYSTEM''s and Administrators'' alone (' + ($who -join ', ') + ')') (
        $pacl.AreAccessRulesProtected -and @($who | Where-Object { @('S-1-5-18', 'S-1-5-32-544', $me) -notcontains $_ }).Count -eq 0)
    Yes 'the bot''s read on private\moderation.log stays, and reaches nothing else there' (
        @(Named (Join-Path $new 'private\moderation.log') $bot).Count -eq 1 -and @(Named (Join-Path $new 'private\door.json') $bot).Count -eq 0)
    Yes 'the folder it replaced is locked too, keeping its own rules by name' ((Get-Acl -LiteralPath $old).AreAccessRulesProtected -and @(Named $old $site).Count -eq 1)

    # for-bot (#2321): the bot reads the staff log by a rule on the folder.
    $fb = Join-Path $new 'for-bot'
    $facl = Get-Acl -LiteralPath $fb
    $fwho = @($facl.Access | ForEach-Object { Sid $_ } | Sort-Object -Unique)
    Yes ('for-bot takes nothing from the root, and is SYSTEM''s, Administrators'' and the bot''s alone (' + ($fwho -join ', ') + ')') (
        $facl.AreAccessRulesProtected -and @($fwho | Where-Object { @('S-1-5-18', 'S-1-5-32-544', $me, $bot) -notcontains $_ }).Count -eq 0 -and (Broad $fb) -eq 0)
    $x = @(Named $fb $bot)
    Yes 'the bot''s account may read for-bot and everything in it, and no more' (
        $x.Count -eq 1 -and "$($x[0].FileSystemRights)" -match '^Read' -and "$($x[0].FileSystemRights)" -notmatch 'Modify|Write|FullControl' -and "$($x[0].InheritanceFlags)" -match 'ContainerInherit' -and "$($x[0].InheritanceFlags)" -match 'ObjectInherit')
    Yes 'and says so' (($script:said -join ' ') -match ('the bot''s account may read ' + [regex]::Escape($fb)))
    # The gamemode's first staff action, after the install: it makes the file.
    $later = Join-Path $fb 'moderation.log'
    [IO.File]::AppendAllText($later, '{"did":"warn"}' + "`n")
    $x = @(Named $later $bot)
    Yes 'a staff log made in for-bot after the install is readable by the bot''s account, by the folder''s rule' (
        $x.Count -eq 1 -and $x[0].IsInherited -and "$($x[0].FileSystemRights)" -match '^Read' -and (Broad $later) -eq 0)
    Yes 'and private still is not: no rule of the bot''s on private or door.json' (
        @(Named (Join-Path $new 'private') $bot).Count -eq 0 -and @(Named (Join-Path $new 'private\door.json') $bot).Count -eq 0)
    Yes 'nor of the site''s on for-bot' (@(Named $fb $site).Count -eq 0 -and @(Named $later $site).Count -eq 0)

    $script:said = @()
    Lock-ServerRoot $new $old $bot
    Yes 'locked again, nothing is doubled' (@(Named $new $site | Where-Object { -not $_.IsInherited }).Count -eq 1 -and @(Named $new 'S-1-5-18' | Where-Object { -not $_.IsInherited }).Count -eq 1 -and @(Named $fb $bot | Where-Object { -not $_.IsInherited }).Count -eq 1)
    # A box whose bot account could not be looked up: for-bot keeps the rule it
    # had by name, as it moved across from the folder it replaced.
    $script:said = @()
    Lock-ServerRoot $new $old ''
    Yes 'locked with no bot account to give, for-bot keeps the bot''s rule it already had' (@(Named $fb $bot | Where-Object { -not $_.IsInherited }).Count -eq 1)

    # Where the installer calls it.
    $text = Get-Content -LiteralPath $installer -Raw
    $carry = $text.IndexOf('if ($hadRoot) { Carry $aside $Root ([bool]$FreshWorld) }')
    $lock = $text.IndexOf('Lock-ServerRoot $Root $(if ($hadRoot) { $aside } else { '''' })')
    # The call, not the definition: since #2608 the task is registered by
    # Register-ServerTask, whose body sits above the lock in the file.
    $task = $text.IndexOf('if (-not $NoTask) { Register-ServerTask $writer }')
    $start = $text.IndexOf("`nStart-ScheduledTask -TaskName `$TaskName")
    Yes 'the installer locks the root after the world and the roster are carried across' ($carry -gt 0 -and $lock -gt $carry)
    Yes 'and before the server''s task is registered or started' ($task -gt 0 -and $lock -lt $task -and $lock -lt $start)
    Yes 'and locks what it replaced' ($text -match [regex]::Escape('if ($hadRoot -and (Test-Path -LiteralPath $aside)) { Lock-ServerRoot $aside '''' }'))
    Yes 'the installer carries for-bot across whole, as it does private' ($text -match [regex]::Escape("foreach (`$name in 'world', 'private', 'for-bot')"))
    $mk = $text.IndexOf('$forBotDir = Join-Path $Root ''for-bot''')
    Yes 'and makes for-bot when the server has none, before it locks, and gives the lock the bot''s account' (
        $mk -gt $carry -and $mk -lt $lock -and $text -match [regex]::Escape('Lock-ServerRoot $Root $(if ($hadRoot) { $aside } else { '''' }) $botSid') -and
        $text -match [regex]::Escape("NTAccount('NT SERVICE\ThornswoodBot')"))

    # ================================================================ the box, now
    $c = Join-Path $box 'c'
    foreach ($n in 'Thornswood-Server', 'Thornswood-Server-Dev', 'Thornswood-Voice', 'Thornswood-Server.prev-20260928-010203', 'Thornswood-Docs', 'Something-Else') {
        Put (Join-Path $c "$n\x.txt") 'x'
    }
    Put (Join-Path $c 'Thornswood-Server\private\door.json') 'key'
    Put (Join-Path $c 'Thornswood-Server\data\online.json') '{}'
    Put (Join-Path $c 'Thornswood-Server-Dev\private\door.json') 'key'
    # The staff log's folder with the bot's read on it, as Install-Bot gives it (#2321).
    Put (Join-Path $c 'Thornswood-Server\for-bot\moderation.log') '{}'
    Grant (Join-Path $c 'Thornswood-Server\for-bot') $bot 'Read' 'ContainerInherit, ObjectInherit' 'None'
    Put (Join-Path $c 'Thornswood-Voice\chat\1.jsonl') 'said'
    Put (Join-Path $c 'Thornswood-Voice\token-key.txt') 'key'
    # The backups and their passphrase (#1173), with a rule somebody gave the
    # site on it by name, which must go too: nothing but SYSTEM reads it.
    Put (Join-Path $c 'Thornswood-Backup\key.txt') 'passphrase'
    Put (Join-Path $c 'Thornswood-Backup\thornswood-20260929-031500.zip') 'every secret'
    Grant (Join-Path $c 'Thornswood-Backup') $site 'Read' 'ContainerInherit, ObjectInherit' 'None'
    Grant (Join-Path $c 'Thornswood-Server') $site 'Read' 'ObjectInherit' 'NoPropagateInherit'
    Grant (Join-Path $c 'Thornswood-Server\data') $site 'Read' 'ObjectInherit' 'NoPropagateInherit'
    Grant (Join-Path $c 'Thornswood-Voice\chat') $site 'Read' 'ObjectInherit' 'NoPropagateInherit'
    # Thornswood-Server-Dev has no rule for the site: the site deploy has not
    # been run since it was made.
    function Box([string[]]$more) {
        $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $lockBox, '-Parent', $c, '-SiteSid', $site, '-BotSid', $bot, '-AllowGamingPc') + $more
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = @(& $ps @a 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
        $script:code = $LASTEXITCODE
        return $o
    }
    $before = @{}
    foreach ($n in 'Thornswood-Server', 'Thornswood-Server-Dev', 'Thornswood-Voice') { $before[$n] = (Get-Acl -LiteralPath (Join-Path $c $n)).Sddl }
    $out = Box @('-WhatIf')
    $o = $out -join "`n"
    Yes 'Lock-VpsFolders -WhatIf says what it would lock' ($o -match 'WOULD LOCK ' + [regex]::Escape((Join-Path $c 'Thornswood-Server\private')) -and $o -match 'WHATIF: nothing was changed')
    Yes '  and changes nothing' (@($before.Keys | Where-Object { (Get-Acl -LiteralPath (Join-Path $c $_)).Sddl -ne $before[$_] }).Count -eq 0)
    $out = Box @()
    $o = $out -join "`n"
    Yes 'a folder the site has no rule on is refused, saying what to run first' ($o -match ('REFUSED ' + [regex]::Escape((Join-Path $c 'Thornswood-Server-Dev')) + ': the site''s account has no rule') -and $o -match 'Deploy-Docs\.ps1 first' -and $script:code -ne 0)
    Yes '  and left exactly as it was' ((Get-Acl -LiteralPath (Join-Path $c 'Thornswood-Server-Dev')).Sddl -eq $before['Thornswood-Server-Dev'])
    foreach ($p in 'Thornswood-Server', 'Thornswood-Server\private\door.json', 'Thornswood-Server\data\online.json', 'Thornswood-Server.prev-20260928-010203\x.txt',
                   'Thornswood-Voice', 'Thornswood-Voice\token-key.txt', 'Thornswood-Voice\chat\1.jsonl') {
        Yes ("the rest are locked: no Users rule reaches $p") ((Broad (Join-Path $c $p)) -eq 0)
    }
    Yes 'the site keeps its read on server.log''s folder, data and the chat logs' (
        @(Named (Join-Path $c 'Thornswood-Server\x.txt') $site).Count -eq 1 -and @(Named (Join-Path $c 'Thornswood-Server\data\online.json') $site).Count -eq 1 -and
        @(Named (Join-Path $c 'Thornswood-Voice\chat\1.jsonl') $site).Count -eq 1)
    $fbBox = Join-Path $c 'Thornswood-Server\for-bot'
    Yes 'for-bot is locked: no Users rule reaches it or the staff log in it (#2321)' ((Broad $fbBox) -eq 0 -and (Broad (Join-Path $fbBox 'moderation.log')) -eq 0 -and (Get-Acl -LiteralPath $fbBox).AreAccessRulesProtected)
    Yes '  and the bot keeps its read on it, and on the staff log' (@(Named $fbBox $bot | Where-Object { -not $_.IsInherited }).Count -eq 1 -and @(Named (Join-Path $fbBox 'moderation.log') $bot).Count -ge 1)
    Yes '  and a server whose for-bot has the bot''s rule is not said to need Install-Bot' ($o -notmatch [regex]::Escape('no rule on ' + $fbBox) -and $o -notmatch [regex]::Escape((Join-Path $c 'Thornswood-Server') + ' has no for-bot'))
    Yes 'and never reaches private or token-key.txt' (@(Named (Join-Path $c 'Thornswood-Server\private\door.json') $site).Count -eq 0 -and @(Named (Join-Path $c 'Thornswood-Voice\token-key.txt') $site).Count -eq 0)
    Yes 'private is SYSTEM''s and Administrators'' alone' ((Get-Acl -LiteralPath (Join-Path $c 'Thornswood-Server\private')).AreAccessRulesProtected -and
        @((Get-Acl -LiteralPath (Join-Path $c 'Thornswood-Server\private')).Access | Where-Object { @('S-1-5-18', 'S-1-5-32-544', $me) -notcontains (Sid $_) }).Count -eq 0)
    Yes 'each one is read back, one line a rule' ($o -match 'no Users rule' -and $o -match 'Allow ')
    $bk = Join-Path $c 'Thornswood-Backup'
    Yes 'the backups'' folder is locked, needing no rule for the site' ($o -match ('locked ' + [regex]::Escape($bk)) -and $o -notmatch ('REFUSED ' + [regex]::Escape($bk)))
    foreach ($p in 'key.txt', 'thornswood-20260929-031500.zip') {
        $x = @((Get-Acl -LiteralPath (Join-Path $bk $p)).Access | ForEach-Object { Sid $_ } | Sort-Object -Unique)
        Yes ("$p in it is SYSTEM's and Administrators' alone, the site's rule gone too (" + ($x -join ', ') + ')') (
            @($x | Where-Object { @('S-1-5-18', 'S-1-5-32-544', $me) -notcontains $_ }).Count -eq 0)
    }
    # Install-Backup.ps1 locks it before anything is sent into it.
    $ib = Get-Content -LiteralPath (Join-Path $repo 'scripts\deploy\Install-Backup.ps1') -Raw
    $lk = $ib.IndexOf('SetAccessRuleProtection(`$true, `$false)')
    Yes 'Install-Backup.ps1 locks the backups'' folder, and before the script or the passphrase go up' (
        $lk -gt 0 -and $lk -lt $ib.IndexOf('& scp @ssh $script') -and $lk -lt $ib.IndexOf('& scp @ssh $KeyOut') -and $ib -match "'S-1-5-32-545'" -and $ib -match 'Die \("could not lock')
    Yes 'a folder that is not a server''s or voice''s is never touched' ((Broad (Join-Path $c 'Thornswood-Docs\x.txt')) -gt 0 -and (Broad (Join-Path $c 'Something-Else\x.txt')) -gt 0)
    # Off the box (a developer's workstation): refused without
    # -AllowGamingPc, in the rule's words (scripts\vps\BoxGuard.ps1, #3041).
    . (Join-Path $repo 'scripts\vps\BoxGuard.ps1')
    $notBox = Get-ThornswoodBoxRefusal
    if ($notBox) {
        $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $lockBox, '-Parent', $c, '-SiteSid', $site)
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = (@(& $ps @a 2>&1 | ForEach-Object { "$_" }) -join ' ') } finally { $ErrorActionPreference = $eap }
        Yes 'off the box it refuses, says why, and changes nothing' ($o.Contains('REFUSED: ' + $notBox) -and $LASTEXITCODE -ne 0)
    } else { Write-Host 'SKIP  the refusal off the box: this is the box, a server (tests\test-3041-box-guard.ps1 runs it with a workstation stood in)' }
} finally {
    Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
