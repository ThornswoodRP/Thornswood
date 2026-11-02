<#
  test-bot-env-acl.ps1

      pwsh -NoProfile -File .\tests\test-bot-env-acl.ps1

  bot.env.json keeps the bot's own account's read rule through a full
  Install-Bot.ps1 run (issue #2158).

  WHY. The settings step rewrote bot.env.json and then took every rule off it,
  putting back only SYSTEM, Administrators and the account running it. The
  swap then started NT SERVICE\ThornswoodBot, which could not read its own
  settings, the rollback hit the same denied read, and the run ended with the
  bot stopped (twice on Oct 11, 2026).

  HOW. Takes the settings step's own lines out of Install-Bot.ps1, from the
  write of bot.env.json to the first line it prints, expands them the way the
  here-string does, and runs them against a scratch file that already has the
  service's read rule. Then checks the rule is there afterward, that
  Protect-ThornswoodBotEnv in Write-BotToken.ps1 gives it on a file that never
  had it, that the nightly backup's own task account gets read when the box
  has that task (#2836), that the SID agrees with Get-ThornswoodServiceSid in
  Bot-Service.ps1, and that the later writes of the token (WriteAllText and
  WriteAllBytes on the same file) keep the rules. On the code before #2158 the
  rule is gone after the settings lines, so it fails.

  Talks to nothing, no VPS and no network. The service does not need to exist:
  rules are granted by SID. Writes only to its own scratch folder, removed at
  the end. Windows only.
#>
[CmdletBinding()]
param([string]$Scratch)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  this proves NTFS rules on bot.env.json, read and written with Get-Acl and Set-Acl, which only Windows has'; exit 0 }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$writer  = Join-Path $repo 'scripts\vps\Write-BotToken.ps1'
$service = Join-Path $repo 'scripts\vps\Bot-Service.ps1'
$install = Join-Path $repo 'scripts\deploy\Install-Bot.ps1'

if (-not $Scratch) { $Scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-botenv-acl-' + [guid]::NewGuid().ToString('N')) }
$null = New-Item -ItemType Directory -Force -Path $Scratch

function Get-SidReadRule([string]$Path, [string]$Sid) {
    $acl = Get-Acl -LiteralPath $Path
    foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        if ($r.IdentityReference.Value -eq $Sid -and $r.AccessControlType -eq 'Allow' -and
            (($r.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Read) -eq [Security.AccessControl.FileSystemRights]::Read)) { return $r }
    }
    return $null
}
function Grant-SidRead([string]$Path, [string]$Sid) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($Sid)), 'Read', 'Allow')))
    $item = Get-Item -LiteralPath $Path
    if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, [Security.AccessControl.FileSecurity]$acl) }
    else { $item.SetAccessControl($acl) }
}

try {
    . $writer
    Yes 'Write-BotToken.ps1 defines Protect-ThornswoodBotEnv' ([bool](Get-Command Protect-ThornswoodBotEnv -EA SilentlyContinue))

    # The SID, two ways.
    $svcText = Get-Content -LiteralPath $service -Raw
    $m = [regex]::Match($svcText, '(?ms)^function Get-ThornswoodServiceSid.*?^\}')
    Yes 'Bot-Service.ps1 has Get-ThornswoodServiceSid' $m.Success
    if ($m.Success) { . ([scriptblock]::Create($m.Value)) }
    $sid = Get-ThornswoodServiceSid 'ThornswoodBot'
    if (Get-Command Get-ThornswoodBotEnvServiceSid -EA SilentlyContinue) {
        Yes 'the SID Write-BotToken.ps1 works out is the one Bot-Service.ps1 does' ((Get-ThornswoodBotEnvServiceSid 'ThornswoodBot') -eq $sid)
    } else { Yes 'Write-BotToken.ps1 works out the service SID' $false }

    # The settings step's own lines, from Install-Bot.ps1.
    $lines = Get-Content -LiteralPath $install
    $start = -1; $end = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($start -lt 0 -and $lines[$i] -match '^\[IO\.File\]::WriteAllText\(`\$f, \(`\$env2') { $start = $i }
        elseif ($start -ge 0 -and $lines[$i] -match "^'panel channel: ") { $end = $i; break }
    }
    Yes 'found the settings step''s write of bot.env.json in Install-Bot.ps1' ($start -ge 0 -and $end -gt $start)
    $frag = ($lines[($start + 1)..($end - 1)] -join "`r`n")
    Yes 'the settings step takes no rule off bot.env.json by itself' ($frag -notmatch 'RemoveAccessRule')
    Yes 'the settings step locks bot.env.json with Protect-ThornswoodBotEnv' ($frag -match 'Protect-ThornswoodBotEnv')

    $Service = 'ThornswoodBot'
    $code = $ExecutionContext.InvokeCommand.ExpandString($frag)
    $f = Join-Path $Scratch 'bot.env.json'
    [IO.File]::WriteAllText($f, '{"THORNSWOOD_SITE":"https://thornswood.net"}', (New-Object Text.UTF8Encoding($false)))
    Grant-SidRead $f $sid
    Yes 'the scratch bot.env.json starts with the service''s read rule' ($null -ne (Get-SidReadRule $f $sid))
    $said = @(& ([scriptblock]::Create($code)))
    Yes 'the settings step''s lock says nothing went wrong' (-not (($said -join ' ') -match 'could not tighten'))
    Yes 'after the settings step the service still has read on bot.env.json (#2158)' ($null -ne (Get-SidReadRule $f $sid))
    $acl = Get-Acl -LiteralPath $f
    Yes 'bot.env.json takes nothing from its folder' $acl.AreAccessRulesProtected
    $who = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value })
    Yes 'SYSTEM keeps it' ($who -contains 'S-1-5-18')
    Yes 'Administrators keep it' ($who -contains 'S-1-5-32-544')
    Yes 'no Users, Authenticated Users or Everyone rule on it' (-not ($who | Where-Object { $_ -in @('S-1-5-32-545', 'S-1-5-11', 'S-1-1-0') }))
    $bot = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $sid })
    Yes 'the service gets read only, not write' (@($bot | Where-Object { ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::WriteData) -ne 0 }).Count -eq 0)

    # The token is written after, into the same file.
    [IO.File]::WriteAllText($f, '{"THORNSWOOD_SITE":"https://thornswood.net","X":"1"}', (New-Object Text.UTF8Encoding($false)))
    Yes 'a WriteAllText over it keeps the service''s read' ($null -ne (Get-SidReadRule $f $sid))
    [IO.File]::WriteAllBytes($f, [IO.File]::ReadAllBytes($f))
    Yes 'a WriteAllBytes put-back keeps the service''s read' ($null -ne (Get-SidReadRule $f $sid))

    # #2711: the head of the settings step, from what arrived on standard input
    # to the read of the bot.env.json already there. Both reads sat in a try
    # with an empty catch: a bot.env.json that did not read became an empty
    # table, and the file was written over with a new key and no ping address.
    $hs = -1; $he = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($hs -lt 0 -and $lines[$i] -eq '`$p = `$null') { $hs = $i }
        elseif ($hs -ge 0 -and $lines[$i] -match '^# The token is not written here') { $he = $i; break }
    }
    Yes 'found the head of the settings step in Install-Bot.ps1' ($hs -ge 0 -and $he -gt $hs)
    $rootWin = $Scratch
    $head = $ExecutionContext.InvokeCommand.ExpandString(($lines[$hs..($he - 1)] -join "`r`n") + "`r`n'READ ON'")
    $f = Join-Path $Scratch 'bot.env.json'
    $held = '{"THORNSWOOD_KEY":"not-a-real-key","PING_URL":"https://hc-ping.example/x"'
    [IO.File]::WriteAllText($f, $held)
    $ThornswoodSecret = '{"token":"not-a-real-token","key":""}'
    $said = @(& ([scriptblock]::Create($head)) | ForEach-Object { "$_" })
    Yes 'a bot.env.json that does not read stops the settings step, naming the file' (($said -join ' ') -match '^SETTINGS NOT WRITTEN: .*bot\.env\.json does not parse as JSON' -and ($said -notcontains 'READ ON'))
    Yes '  and it is left exactly as it was' ([IO.File]::ReadAllText($f) -ceq $held)
    [IO.File]::WriteAllText($f, '{"THORNSWOOD_KEY":"not-a-real-key"}')
    $ThornswoodSecret = '{"token":"not-a-real-token", oops'
    $said = @(& ([scriptblock]::Create($head)) | ForEach-Object { "$_" })
    Yes 'what arrived that is not the JSON sent stops it, without repeating what arrived' (($said -join ' ') -match '^SETTINGS NOT WRITTEN: what arrived on standard input' -and -not (($said -join ' ') -match 'not-a-real-token|oops') -and ($said -notcontains 'READ ON'))
    $ThornswoodSecret = '{"token":"not-a-real-token","key":""}'
    $said = @(& ([scriptblock]::Create($head)) | ForEach-Object { "$_" })
    Yes 'a bot.env.json that reads goes on' ($said -contains 'READ ON')
    $inst = [IO.File]::ReadAllText($install)
    $iSay = $inst.IndexOf('$settings | ForEach-Object { Say "  $_" }')
    $iDie = $inst.IndexOf("Where-Object { ""`$_"" -like 'SETTINGS NOT WRITTEN*' }", $iSay)
    $iSwap = $inst.IndexOf('# ---------------------------------------------------------------- swap ---', $iSay)
    Yes '  and Install-Bot.ps1 stops on that line before the swap' ($iSay -gt 0 -and $iDie -gt $iSay -and $iSwap -gt $iDie)

    # A file that never had the rule gets it.
    $g = Join-Path $Scratch 'fresh.env.json'
    [IO.File]::WriteAllText($g, '{}')
    if (Get-Command Protect-ThornswoodBotEnv -EA SilentlyContinue) { Protect-ThornswoodBotEnv -Path $g -Service 'ThornswoodBot' }
    Yes 'Protect-ThornswoodBotEnv gives the service read on a file that never had it' ($null -ne (Get-SidReadRule $g $sid))

    # The nightly backup's own task account (#2836): read on the file while
    # NT TASK\Thornswood Backup resolves, and nothing for a task that is not
    # there. The VPS runners have the real task on its own SID.
    $h = Join-Path $Scratch 'nobackup.env.json'
    [IO.File]::WriteAllText($h, '{}')
    $threw = ''
    try { Protect-ThornswoodBotEnv -Path $h -Service 'ThornswoodBot' -BackupTask ('No Such Task ' + [guid]::NewGuid().ToString('N')) } catch { $threw = $_.Exception.Message }
    $whoH = @((Get-Acl -LiteralPath $h).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value })
    Yes ('with no backup task of that name it gives nobody else anything, and does not fail' + $(if ($threw) { ': ' + $threw })) (
        -not $threw -and @($whoH | Where-Object { @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value, $sid) -notcontains $_ }).Count -eq 0)
    $backupSid = ''
    try { $backupSid = (New-Object Security.Principal.NTAccount('NT TASK', 'Thornswood Backup')).Translate([Security.Principal.SecurityIdentifier]).Value }
    catch [Security.Principal.IdentityNotMappedException] { $backupSid = '' }
    if ($backupSid) {
        $rule = Get-SidReadRule $g $backupSid
        Yes ('the nightly backup''s own task account, ' + $backupSid + ', may read it (#2836)') ($null -ne $rule)
        Yes '  and only read, not write' ($null -ne $rule -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::WriteData) -eq 0)
        $f2 = Join-Path $Scratch 'settings.env.json'
        [IO.File]::WriteAllText($f2, '{"THORNSWOOD_SITE":"https://thornswood.net"}', (New-Object Text.UTF8Encoding($false)))
        $f = $f2
        $code2 = $ExecutionContext.InvokeCommand.ExpandString($frag)
        $null = @(& ([scriptblock]::Create($code2)))
        Yes '  and keeps it through the settings step of Install-Bot.ps1' ($null -ne (Get-SidReadRule $f2 $backupSid))
    } else {
        Write-Host 'SKIP  the nightly backup''s read: no Thornswood Backup task on a SID of its own here (the VPS runners have one, #2836)'
    }
}
finally {
    Remove-Item -LiteralPath $Scratch -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }