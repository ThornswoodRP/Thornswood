<#
  test-say-staff.ps1

      pwsh -NoProfile -File .\tests\test-say-staff.ps1
      pwsh -NoProfile -File .\tests\test-say-staff.ps1

  Agents post their own staff notices in #staff-updates through the bot
  (#2934): scripts\ops\Say-Staff.ps1 hands the notice over ssh to
  scripts\vps\vps-say-staff.ps1 on the box, which appends one line to the
  watchdog's outbox, and a key from Grant-BoxAccess.ps1 -NoticesOnly can run
  that and nothing else.

  WHAT IT HOLDS THEM TO.
    1. All three parse, and Watch-Services.ps1 -Install sends the box half.
    2. The box half, run as its own process against a scratch watchdog
       folder: nothing on its input says READY and writes nothing; a notice
       is one outbox line of the watchdog's shape (id, at, service, kind,
       text) with the sender in front; no watchdog, a bad sender, an empty,
       too long or unreadable notice, and the 31st in an hour are refused
       with nothing written; a check says WAITING, POSTED bot, POSTED
       webhook, EXPIRED and NOT FOUND from the files the bot and the
       watchdog keep.
    3. The bot's own reader (bot\bot.py watch_alerts_due) takes the line the
       box half wrote, when discord.py is here to import it.
    4. Say-Staff.ps1 end to end, with a stand-in for ssh that runs the box
       half: queued, then checked, the text on standard input and never on
       the command line; and it refuses before connecting what the box would.
       -OnTheBox (#3045), the staff-notice workflow's half: ssh to the box's
       own sshd at 127.0.0.1 with only the notices key, the host key held to
       the pins in a known_hosts of its own, both gone when it ends, and the
       answer left as an annotation. With no ssh, through GitHub (#5187): it
       files an issue on the board titled "Staff notice from <sender>",
       labelled notice: staff, with the text on gh's standard input; -Check
       reads where the bot is from its comments and the labels; -Unsay puts
       the label notice: take back on; a bad -From, a long notice and an
       issue filed without the label each say so.
    5. Grant-BoxAccess.ps1: a notices key's line is taken only through the
       bridge and only runs say-staff.ps1 as its own name; -List reads that
       back; the box change stops with nothing changed when say-staff.ps1 is
       not there; and -NoticesOnly goes only with -MakeKey. -ToEnvironment
       makes the GitHub environment main's alone, or stops naming the other
       branch it lets in, before the box is touched, and the key goes to gh
       secret set on standard input.
    6. staff-notice.yml is not here: it moved to the private ops repository
       with the VPS runners (#4013), whose tests\test-box-workflows.ps1
       holds its shape and runs its step, and Grant-BoxAccess.ps1 puts its
       key there. Say-Staff.ps1 files on the board with the labels bot.py
       reads.
  Nothing connects anywhere and nothing outside the temp folder is touched.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string[]]$parts) { return [IO.Path]::Combine([string[]](@($repo) + $parts)) }

$box = P 'scripts', 'vps', 'vps-say-staff.ps1'
$say = P 'scripts', 'ops', 'Say-Staff.ps1'
$grantPath = P 'scripts', 'vps', 'Grant-BoxAccess.ps1'
$watchPath = P 'scripts', 'vps', 'Watch-Services.ps1'
$shell = (Get-Process -Id $PID).Path
$enc = New-Object Text.UTF8Encoding($false)
# The stand-ins for ssh, ssh-keyscan, ssh-keygen and gh are node, not
# PowerShell (#3168): the runs below start them 51 times, and a PowerShell
# start costs the box about ten times a node start. What they stand in for
# (the box half, Say-Staff.ps1, the workflow's step) still runs in PowerShell.
$node = (Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $node) { Write-Host 'FAIL  node is not on PATH, and the stand-ins for ssh and gh are node'; exit 1 }
$node = $node.Source
# A path as a JavaScript string, for the stand-ins' own text.
function Js([string]$s) { return (ConvertTo-Json -InputObject $s -Compress) }
# Each stand-in is started through a .cmd on Windows; elsewhere through a
# shell script, since only Windows runs a .cmd (#2989).
function Put-StandIn([string]$dir, [string]$name, [string]$js) {
    if ($env:OS -eq 'Windows_NT') {
        [IO.File]::WriteAllText((Join-Path $dir ($name + '.cmd')), ('@"' + $node + '" "' + $js + '" %*' + "`r`n"), $enc)
    } else {
        $sh = Join-Path $dir $name
        [IO.File]::WriteAllText($sh, ("#!/bin/sh`nexec '" + $node + "' '" + $js + "' `"`$@`"`n"), $enc)
        & chmod 755 $sh
    }
}

# ---- 1. they parse ---------------------------------------------------------
$asts = @{}
foreach ($f in $box, $say, $grantPath) {
    $e = $null
    $asts[$f] = [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e)
    Yes ((Split-Path -Leaf $f) + ' parses') (@($e).Count -eq 0)
}
$watch = [IO.File]::ReadAllText($watchPath)
Yes 'Watch-Services.ps1 -Install writes say-staff.ps1 beside watch.ps1, from vps-say-staff.ps1' (
    $watch.Contains("Join-Path `$Here 'vps-say-staff.ps1'") -and $watch.Contains("[IO.File]::WriteAllBytes('`$Root\say-staff.ps1'"))

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-say-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$root = Join-Path $tmp 'Thornswood-Watch'
$alerts = Join-Path $root 'alerts.jsonl'
# The bot's data folder, where it writes what it took back (#3328).
$botData = Join-Path $tmp 'Thornswood-Bot-data'

# The box half as sshd runs it: its own process, the line on its input.
function Box([string]$from, [string[]]$in, [string]$at = $root) {
    $args2 = @('-NoProfile', '-NonInteractive', '-File', $box, '-From', $from, '-Root', $at, '-BotData', $botData)
    $out = @($in | & $shell @args2 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    return [pscustomobject]@{ Out = $out; Code = $LASTEXITCODE; Last = ($out | Select-Object -Last 1) }
}
function SayLine([string]$text) { return ('say ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))) }
function Rows {
    if (-not (Test-Path -LiteralPath $alerts)) { return @() }
    return @([IO.File]::ReadAllLines($alerts) | Where-Object { $_.Trim() } | ForEach-Object { ConvertFrom-Json $_ })
}
function Fresh {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $root 'watch.ps1'), '# stand-in')
}
function UnixNow { return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }

try {
    # ---- 2. the box half -----------------------------------------------------
    Fresh
    Remove-Item -LiteralPath (Join-Path $root 'watch.ps1')
    $r = Box 'cloud' @((SayLine 'hello'))
    Yes 'no watchdog on the box: NOWATCHER, exit 1, nothing written' ($r.Last -eq 'NOWATCHER' -and $r.Code -eq 1 -and -not (Test-Path -LiteralPath $alerts))

    Fresh
    $r = Box 'cloud' @()
    Yes 'nothing on its input: READY, exit 0, nothing written (how a new key is proved)' ($r.Last -eq 'READY' -and $r.Code -eq 0 -and -not (Test-Path -LiteralPath $alerts))

    foreach ($bad in 'Cloud', 'cloud x', 'cloud"', '-cloud', '') {
        $r = Box $bad @((SayLine 'hello'))
        Yes ("a sender that is not one lower case word ('" + $bad + "') is refused") ($r.Last -like 'REFUSED*' -and $r.Code -eq 1 -and -not (Test-Path -LiteralPath $alerts))
    }

    $before = UnixNow
    $r = Box 'cloud' @('', (SayLine "  Taking the dev feed for the cooking fix.`r`nShip at 4:30 PM.  "))
    $rows = @(Rows)
    $raw = [IO.File]::ReadAllText($alerts)
    Yes 'a notice: QUEUED <id>, exit 0' ($r.Last -match '^QUEUED agent-cloud-\d{14}-[0-9a-f]{6}$' -and $r.Code -eq 0)
    Yes '  one outbox line, no byte order mark, ending in CRLF the way the watchdog writes them' ($rows.Count -eq 1 -and $raw.EndsWith("}`r`n") -and ([IO.File]::ReadAllBytes($alerts))[0] -eq 0x7B)
    $row = $rows[0]
    Yes '  its id is the one printed' ($r.Last -eq ('QUEUED ' + $row.id))
    Yes '  at is now, in unix seconds' ([int64]$row.at -ge $before -and [int64]$row.at -le ((UnixNow) + 1))
    Yes '  service "agent cloud", kind "notice"' ($row.service -eq 'agent cloud' -and $row.kind -eq 'notice')
    Yes '  the text is the sender in front of the notice, trimmed, line ends made LF' ($row.text -eq "[cloud] Taking the dev feed for the cooking fix.`nShip at 4:30 PM.")
    $first = $row.id

    $r = Box 'claude' @((SayLine ([string][char]0x00e9 + ' @everyone <ok> & "quoted"')))
    $rows = @(Rows)
    Yes 'a second notice is a second line, and the text survives non-ASCII, quotes and markup' ($rows.Count -eq 2 -and $rows[1].text -eq ('[claude] ' + [string][char]0x00e9 + ' @everyone <ok> & "quoted"'))

    $n = @(Rows).Count
    $r = Box 'cloud' @((SayLine "   `n  "))
    Yes 'an empty notice is refused, nothing written' ($r.Last -like 'REFUSED*empty*' -and @(Rows).Count -eq $n)
    $r = Box 'cloud' @((SayLine ('x' * 1801)))
    Yes 'a notice over 1800 characters is refused, not cut' ($r.Last -like 'REFUSED*1801 characters*' -and @(Rows).Count -eq $n)
    $r = Box 'cloud' @((SayLine ('x' * 1800)))
    Yes '  and one of exactly 1800 goes' ($r.Last -like 'QUEUED*' -and @(Rows).Count -eq ($n + 1))
    $n = @(Rows).Count
    $r = Box 'cloud' @('say not*base64')
    Yes 'a line that is not "say <base64>" or "check <id>" is refused' ($r.Last -like 'REFUSED*' -and @(Rows).Count -eq $n)
    $r = Box 'cloud' @('say @@@@')
    Yes '  and so is a say line whose notice is not base64' ($r.Last -like 'REFUSED*' -and @(Rows).Count -eq $n)

    # Thirty an hour for each sender: the outbox already holding 30 recent
    # ones from it, written here directly, and one from an hour and a half ago.
    Fresh
    $now = UnixNow
    $lines = @()
    for ($i = 0; $i -lt 30; $i++) { $lines += (ConvertTo-Json @{ id = ('agent-busy-x' + $i); at = ($now - 60); service = 'agent busy'; kind = 'notice'; text = 't' } -Compress) }
    $lines += (ConvertTo-Json @{ id = 'agent-calm-old'; at = ($now - 5400); service = 'agent calm'; kind = 'notice'; text = 't' } -Compress)
    $lines += 'not json at all'
    [IO.File]::WriteAllText($alerts, (($lines -join "`r`n") + "`r`n"), $enc)
    $r = Box 'busy' @((SayLine 'one more'))
    Yes 'the 31st notice in an hour from one sender is refused' ($r.Last -like 'REFUSED busy has queued 30*' -and @([IO.File]::ReadAllLines($alerts)).Count -eq 32)
    $r = Box 'calm' @((SayLine 'one'))
    Yes '  another sender, and an old line or a broken one, do not count against it' ($r.Last -like 'QUEUED agent-calm-*')

    # Checks, from the files the bot and the watchdog keep.
    Fresh
    $now = UnixNow
    $lines = @(
        (ConvertTo-Json @{ id = 'agent-a-1'; at = $now; service = 'agent a'; kind = 'notice'; text = 't' } -Compress),
        (ConvertTo-Json @{ id = 'agent-a-2'; at = $now; service = 'agent a'; kind = 'notice'; text = 't' } -Compress),
        (ConvertTo-Json @{ id = 'agent-a-3'; at = $now; service = 'agent a'; kind = 'notice'; text = 't' } -Compress),
        (ConvertTo-Json @{ id = 'agent-a-4'; at = ($now - 90000); service = 'agent a'; kind = 'notice'; text = 't' } -Compress))
    [IO.File]::WriteAllText($alerts, (($lines -join "`r`n") + "`r`n"), $enc)
    [IO.File]::WriteAllText((Join-Path $root 'alerts-sent-bot.txt'), "agent-a-1`r`n")
    [IO.File]::WriteAllText((Join-Path $root 'alerts-sent-webhook.txt'), "agent-a-2`r`n")
    Yes 'check: the bot said it' ((Box 'a' @('check agent-a-1')).Last -eq 'POSTED bot')
    Yes 'check: the webhook said it' ((Box 'a' @('check agent-a-2')).Last -eq 'POSTED webhook')
    $r = Box 'a' @('check agent-a-3')
    Yes 'check: in the outbox, not said yet, exit 0' ($r.Last -eq 'WAITING' -and $r.Code -eq 0)
    Yes 'check: over a day old and never said' ((Box 'a' @('check agent-a-4')).Last -eq 'EXPIRED')
    Yes 'check: no such notice' ((Box 'a' @('check agent-a-9')).Last -eq 'NOT FOUND')
    Yes 'check: only an agent notice''s id is asked about' ((Box 'a' @('check outside-20261020-caddy-down')).Last -like 'REFUSED*')

    # Taking a notice back (#3328): the ask goes in alerts-unsay.txt for the
    # bot, only for the sender's own notice, once; a check reads what the bot
    # wrote in its data folder.
    $unsayFile = Join-Path $root 'alerts-unsay.txt'
    [IO.File]::AppendAllText($alerts, ((ConvertTo-Json @{ id = 'outside-x-down'; at = $now; service = 'caddy'; kind = 'down'; text = 't' } -Compress) + "`r`n"), $enc)
    $r = Box 'a' @('unsay agent-a-1')
    Yes 'unsay: the sender''s own notice is asked for, UNSAY QUEUED <id>, exit 0' ($r.Last -eq 'UNSAY QUEUED agent-a-1' -and $r.Code -eq 0 -and @([IO.File]::ReadAllLines($unsayFile)) -contains 'agent-a-1')
    $r = Box 'a' @('unsay agent-a-1')
    Yes '  asked twice, written once' ($r.Last -eq 'UNSAY QUEUED agent-a-1' -and @([IO.File]::ReadAllLines($unsayFile) | Where-Object { $_ -eq 'agent-a-1' }).Count -eq 1)
    $r = Box 'b' @('unsay agent-a-2')
    Yes '  another sender''s notice is refused, nothing written' ($r.Last -like 'REFUSED*not a notice from b*' -and $r.Code -eq 1 -and @([IO.File]::ReadAllLines($unsayFile)) -notcontains 'agent-a-2')
    Yes '  so is the watchdog''s own message, and an id not in the outbox' (
        (Box 'a' @('unsay outside-x-down')).Last -like 'REFUSED*' -and (Box 'a' @('unsay agent-a-9')).Last -eq 'NOT FOUND')
    $r = Box 'a' @('check agent-a-1')
    Yes 'check: asked to be taken back, the bot not there yet: UNSAY WAITING, exit 0' ($r.Last -eq 'UNSAY WAITING' -and $r.Code -eq 0)
    New-Item -ItemType Directory -Path $botData -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $botData 'staff-unsaid.txt'), "agent-a-1`tfailed Forbidden`nagent-a-1`tdeleted`n", $enc)
    $r = Box 'a' @('check agent-a-1')
    Yes 'check: what the bot did last with it, UNSAID deleted, exit 0' ($r.Last -eq 'UNSAID deleted' -and $r.Code -eq 0)

    # ---- 3. the bot's reader takes it ----------------------------------------
    Fresh
    $r = Box 'cloud' @((SayLine 'for the bot'))
    $py = $null
    foreach ($c in 'python', 'python3') { if (-not $py) { $py = Get-Command $c -ErrorAction SilentlyContinue } }
    $probe = ''
    if ($py) {
        $env:DISCORD_TOKEN = 'not-a-real-token'
        # bot.py writes roots.pem into its data folder when it is imported,
        # which is bot\ itself in a checkout with no bot\data (#3220).
        $env:THORNSWOOD_BOT_DATA = $tmp
        $code = @"
import json, sys, time
sys.path.insert(0, sys.argv[1])
try:
    import bot
except Exception as e:
    print('SKIP ' + type(e).__name__)
    sys.exit(0)
lines = [l.strip() for l in open(sys.argv[2], encoding='utf-8-sig') if l.strip()]
due = bot.watch_alerts_due(lines, set(), int(time.time()))
print('DUE %d' % len(due))
for aid, text in due:
    print('ID ' + aid)
    print('TEXT ' + json.dumps(text))
"@
        $pyFile = Join-Path $tmp 'probe.py'
        [IO.File]::WriteAllText($pyFile, $code, $enc)
        $said = @(& $py.Source -I $pyFile (P 'bot') $alerts 2>&1 | ForEach-Object { "$_" })
        $probe = @($said | Where-Object { $_ -match '^(SKIP|DUE) ' }) | Select-Object -Last 1
        $dueId = @($said | Where-Object { $_ -like 'ID *' } | ForEach-Object { $_.Substring(3) })
        $dueText = @($said | Where-Object { $_ -like 'TEXT *' } | ForEach-Object { ConvertFrom-Json $_.Substring(5) })
        Remove-Item Env:DISCORD_TOKEN, Env:THORNSWOOD_BOT_DATA -ErrorAction SilentlyContinue
    }
    if ($probe -like 'DUE *') {
        Yes 'bot.py watch_alerts_due takes the line the box half wrote, with its text' (
            $probe -eq 'DUE 1' -and $dueId.Count -eq 1 -and ('QUEUED ' + $dueId[0]) -eq $r.Last -and $dueText.Count -eq 1 -and $dueText[0] -eq '[cloud] for the bot')
    } else {
        Write-Host ('SKIP  bot.py could not be imported here (' + $(if ($probe) { $probe } else { 'no python' }) + '); bot\tests\test-watch-services.py covers its reader')
    }

    # ---- 4. Say-Staff.ps1 end to end -----------------------------------------
    # A stand-in for ssh, first on the path of the process Say-Staff.ps1 runs
    # in: writes down what it was given, then runs the box half with what
    # came on its input, the way sshd would.
    $bin = Join-Path $tmp 'bin'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $standIn = Join-Path $tmp 'ssh-stand-in.js'
    $argsFile = Join-Path $tmp 'ssh-args.txt'
    $sshHead = @"
const fs = require('fs'), os = require('os'), cp = require('child_process');
const all = process.argv.slice(2).map(String);

"@
    $sshBody = @"
fs.writeFileSync($(Js $argsFile), all.map(a => a + os.EOL).join(''));
const cmd = all[all.length - 1];
const m = /-From ([a-z0-9-]+)`$/i.exec(cmd);
const from = m ? m[1] : '';
const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/).filter(l => l);
fs.writeFileSync($(Js "$argsFile.in"), lines.map(l => l + os.EOL).join(''));
const r = cp.spawnSync($(Js $shell), ['-NoProfile', '-NonInteractive', '-File', $(Js $box), '-From', from, '-Root', $(Js $root), '-BotData', $(Js $botData)],
  { input: lines.map(l => l + os.EOL).join(''), stdio: ['pipe', 'inherit', 'inherit'] });
process.exit(r.status === null ? 1 : r.status);
"@
    [IO.File]::WriteAllText($standIn, ($sshHead + $sshBody), $enc)
    Put-StandIn $bin 'ssh' $standIn
    Remove-Item Env:THORNSWOOD_NOTICE_KEY_B64, Env:THORNSWOOD_NOTICE_TOKEN -ErrorAction SilentlyContinue
    function SayStaff([string[]]$a) {
        $path = $env:PATH
        $env:PATH = $bin + [IO.Path]::PathSeparator + $path
        try { $out = @(& $shell -NoProfile -NonInteractive -File $say @a -VpsHost 'box.invalid' -VpsUser 'Administrator' 2>&1 | ForEach-Object { "$_" }) }
        finally { $env:PATH = $path }
        return [pscustomobject]@{ Out = ($out -join "`n"); Code = $LASTEXITCODE }
    }
    Fresh
    Remove-Item -LiteralPath $argsFile, "$argsFile.in" -ErrorAction SilentlyContinue
    $text = 'Editing Shell.cs for the scan button, PR to follow.'
    $s = SayStaff @('-From', 'claude', '-Text', $text)
    $rows = @(Rows)
    Yes 'Say-Staff.ps1: queued, exit 0, and the notice is in the outbox from claude' ($s.Code -eq 0 -and $s.Out -match 'queued (agent-claude-\d{14}-[0-9a-f]{6})' -and $rows.Count -eq 1 -and $rows[0].text -eq ('[claude] ' + $text))
    $id = [regex]::Match($s.Out, 'agent-claude-\d{14}-[0-9a-f]{6}').Value
    $sent = @([IO.File]::ReadAllLines($argsFile))
    Yes '  ssh is asked for the box with BatchMode and StrictHostKeyChecking, to run say-staff.ps1 as claude' (
        $sent -contains 'BatchMode=yes' -and $sent -contains 'StrictHostKeyChecking=yes' -and $sent -contains 'Administrator@box.invalid' -and
        $sent[-1] -eq 'pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Thornswood-Watch\say-staff.ps1 -From claude')
    Yes '  the text went on standard input and is on no command line' (
        -not (($sent -join ' ').Contains('Shell.cs')) -and ([IO.File]::ReadAllText("$argsFile.in")).Trim() -eq (SayLine $text))
    $s = SayStaff @('-Check', $id)
    Yes 'Say-Staff.ps1 -Check: not said yet is exit 2' ($s.Code -eq 2 -and $s.Out -match 'not said yet')
    [IO.File]::WriteAllText((Join-Path $root 'alerts-sent-bot.txt'), "$id`r`n")
    $s = SayStaff @('-Check', $id)
    Yes '  and said by the bot is exit 0' ($s.Code -eq 0 -and $s.Out -match 'posted in #staff-updates, by the bot')
    $s = SayStaff @('-From', 'claude', '-Unsay', $id)
    Yes 'Say-Staff.ps1 -Unsay: asked, exit 0, and the ask is on the box' ($s.Code -eq 0 -and $s.Out -match ('asked the bot to take ' + $id + ' back') -and @([IO.File]::ReadAllLines((Join-Path $root 'alerts-unsay.txt'))) -contains $id)
    $s = SayStaff @('-Check', $id)
    Yes '  -Check while the bot has not done it is exit 2' ($s.Code -eq 2 -and $s.Out -match 'not done it yet')
    New-Item -ItemType Directory -Path $botData -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $botData 'staff-unsaid.txt'), "$id`twebhook`n", $enc)
    $s = SayStaff @('-Check', $id)
    Yes '  and one the webhook said is exit 1, saying a person deletes it' ($s.Code -eq 1 -and $s.Out -match 'Manage Messages')
    [IO.File]::WriteAllText((Join-Path $botData 'staff-unsaid.txt'), "$id`twithheld`n", $enc)
    $s = SayStaff @('-Check', $id)
    Yes '  and one never said is exit 0' ($s.Code -eq 0 -and $s.Out -match 'never posted')

    Remove-Item -LiteralPath $argsFile -ErrorAction SilentlyContinue
    $s = SayStaff @('-From', 'claude', '-Text', ('y' * 1801))
    Yes 'Say-Staff.ps1 refuses a notice over 1800 characters before connecting' ($s.Code -eq 1 -and $s.Out -match '1801 characters' -and -not (Test-Path -LiteralPath $argsFile))
    $s = SayStaff @('-From', 'claude', '-Text', '   ')
    Yes '  and an empty one' ($s.Code -eq 1 -and $s.Out -match 'empty' -and -not (Test-Path -LiteralPath $argsFile))
    $s = SayStaff @('-Text', 'hello')
    Yes '  and one with no -From and no notices key' ($s.Code -eq 1 -and $s.Out -match '-From says who' -and -not (Test-Path -LiteralPath $argsFile))
    $s = SayStaff @('-Check', 'outside-x')
    Yes '  and a check of an id that is not a notice''s' ($s.Code -eq 1 -and -not (Test-Path -LiteralPath $argsFile))
    $env:THORNSWOOD_NOTICE_KEY_B64 = 'AAAA'
    $s = SayStaff @('-From', 'claude', '-Text', 'hello')
    Remove-Item Env:THORNSWOOD_NOTICE_KEY_B64 -ErrorAction SilentlyContinue
    Yes '  and a notices key with no token beside it' ($s.Code -eq 1 -and $s.Out -match 'needs both' -and -not (Test-Path -LiteralPath $argsFile))
    Remove-Item -LiteralPath (Join-Path $root 'watch.ps1')
    $s = SayStaff @('-From', 'claude', '-Text', 'hello')
    Yes 'Say-Staff.ps1 says plainly when the box has no watchdog, exit 1' ($s.Code -eq 1 -and $s.Out -match 'watchdog is not installed')

    # ---- 4b. -OnTheBox: the staff-notice workflow's half (#3045) ----------
    # ssh-keyscan and ssh-keygen stand-ins beside the ssh one: the box shows
    # one key, whose fingerprint is the one a scratch vps.json pins (or not).
    # The first host key the repository's vps.json pins: -OnTheBox reads the
    # pins from there alone, never from a machine's own override file.
    $pin = [string]@((Get-Content -LiteralPath (P 'scripts', 'vps', 'vps.json') -Raw | ConvertFrom-Json).hostKeys)[0]
    $fpFile = Join-Path $tmp 'fingerprint.txt'
    $keyscanIn = Join-Path $tmp 'ssh-keyscan-stand-in.js'
    $keygenIn = Join-Path $tmp 'ssh-keygen-stand-in.js'
    [IO.File]::WriteAllText($keyscanIn, "process.stdout.write('127.0.0.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBoxhostkeystandin\n');`n", $enc)
    [IO.File]::WriteAllText($keygenIn, @"
const a = process.argv.slice(2);
if (a.includes('-F')) { process.exit(1); }
if (a.includes('-l')) { const fs = require('fs'); fs.writeSync(1, '256 ' + fs.readFileSync($(Js $fpFile), 'utf8').trim() + ' 127.0.0.1 (ED25519)\n'); process.exit(0); }
process.exit(1);
"@, $enc)
    Put-StandIn $bin 'ssh-keyscan' $keyscanIn
    Put-StandIn $bin 'ssh-keygen' $keygenIn
    # The ssh stand-in also keeps what the key and known_hosts files held
    # while it ran, since they are gone once Say-Staff.ps1 ends.
    $seenKey = Join-Path $tmp 'seen-key'
    $seenHosts = Join-Path $tmp 'seen-known-hosts'
    $peek = @"
const copy = (from, to) => { try { fs.copyFileSync(from, to); } catch (e) { fs.writeSync(2, e.message + '\n'); } };
const ki = all.indexOf('-i');
if (ki >= 0) { copy(all[ki + 1], $(Js $seenKey)); }
const kh = all.find(a => /^UserKnownHostsFile=/i.test(a));
if (kh) { copy(kh.substring(19), $(Js $seenHosts)); }

"@
    [IO.File]::WriteAllText($standIn, ($sshHead + $peek + $sshBody), $enc)
    # A machine's own vps.json pinning something else, as an earlier job on
    # the runner account could leave: -OnTheBox goes by the repository's.
    $localVps = Join-Path $tmp 'local-vps.json'
    [IO.File]::WriteAllText($localVps, '{"hostKeys":["SHA256:someothermachine00000000000000000000000000"],"user":"elsewhere"}', $enc)
    $fakeKey = "a stand-in for the notices key, which is never read here`n"
    function OnTheBox([string[]]$a, [string]$key) {
        $path = $env:PATH
        $env:PATH = $bin + [IO.Path]::PathSeparator + $path
        $env:THORNSWOOD_VPS_LOCAL = $localVps
        $env:GITHUB_ACTIONS = 'true'
        if ($key) { $env:THORNSWOOD_NOTICE_KEY_B64 = $key } else { Remove-Item Env:THORNSWOOD_NOTICE_KEY_B64 -ErrorAction SilentlyContinue }
        try { $out = @(& $shell -NoProfile -NonInteractive -File $say -OnTheBox @a 2>&1 | ForEach-Object { "$_" }) }
        finally {
            $env:PATH = $path
            Remove-Item Env:THORNSWOOD_VPS_LOCAL, Env:GITHUB_ACTIONS, Env:THORNSWOOD_NOTICE_KEY_B64 -ErrorAction SilentlyContinue
        }
        return [pscustomobject]@{ Out = ($out -join "`n"); Code = $LASTEXITCODE }
    }
    Fresh
    Remove-Item -LiteralPath $argsFile, $seenKey, $seenHosts -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($fpFile, $pin)
    $keyB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($fakeKey))
    $s = OnTheBox @('-Text', 'From the workflow.') $keyB64
    $rows = @(Rows)
    $sent = @(if (Test-Path -LiteralPath $argsFile) { [IO.File]::ReadAllLines($argsFile) })
    Yes '-OnTheBox: queued, exit 0, and the notice is in the outbox' ($s.Code -eq 0 -and $s.Out -match 'queued agent-' -and $rows.Count -eq 1 -and $rows[0].text -like '*From the workflow.')
    Yes '  it goes to the box''s own sshd at 127.0.0.1 as vps.json''s user, with no ssh config and only the notices key, whatever this machine''s own vps file says' (
        $sent -contains 'Administrator@127.0.0.1' -and ($sent -join ' ') -match '-F none -i \S+ -o IdentitiesOnly=yes' -and ($sent -join ' ') -notmatch 'ProxyCommand')
    Yes '  the key it used is the one in THORNSWOOD_NOTICE_KEY_B64' ((Test-Path -LiteralPath $seenKey) -and [IO.File]::ReadAllText($seenKey) -eq $fakeKey)
    $kh = @($sent | Where-Object { $_ -like 'UserKnownHostsFile=*' })
    Yes '  host keys from a known_hosts of its own holding the pinned key, with StrictHostKeyChecking' (
        $kh.Count -eq 1 -and $sent -contains 'StrictHostKeyChecking=yes' -and (Test-Path -LiteralPath $seenHosts) -and
        ([IO.File]::ReadAllText($seenHosts)).Trim() -eq '127.0.0.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBoxhostkeystandin')
    $keyAt = $sent[[array]::IndexOf($sent, '-i') + 1]
    Yes '  and the key and known_hosts are gone when it ends' (-not (Test-Path -LiteralPath $keyAt) -and -not (Test-Path -LiteralPath (Split-Path -Parent $keyAt)))
    Yes '  in a GitHub job it leaves the box''s answer as a Say-Staff notice annotation' ($s.Out -match '::notice title=Say-Staff::QUEUED agent-[a-z0-9-]+')

    Remove-Item -LiteralPath $argsFile -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($fpFile, 'SHA256:someothermachine00000000000000000000000000')
    $s = OnTheBox @('-Text', 'hello') $keyB64
    Yes '-OnTheBox: a sshd on 127.0.0.1 that shows no pinned key gets nothing, exit 1, with an error annotation' (
        $s.Code -eq 1 -and $s.Out -match 'pins' -and $s.Out -match '::error title=Say-Staff::' -and -not (Test-Path -LiteralPath $argsFile))
    [IO.File]::WriteAllText($fpFile, $pin)
    $s = OnTheBox @('-Text', 'hello') ''
    Yes '-OnTheBox with no key stops before connecting and names the environment secret' ($s.Code -eq 1 -and $s.Out -match 'NOTICE_KEY_B64 secret of the "notices" environment' -and -not (Test-Path -LiteralPath $argsFile))

    # ---- 4c. with no ssh: an issue on the board (#5187) -------------------
    # A path holding only a stand-in for gh, which answers as GitHub does and
    # writes down each call. The issue and its comments come from files.
    $bin2 = Join-Path $tmp 'bin2'
    New-Item -ItemType Directory -Path $bin2 -Force | Out-Null
    $ghIn = Join-Path $tmp 'gh-stand-in.js'
    $ghCalls = Join-Path $tmp 'gh-calls.txt'
    $ghBody = Join-Path $tmp 'gh-body.json'
    $ghIssue = Join-Path $tmp 'gh-issue.json'
    $ghComments = Join-Path $tmp 'gh-comments.json'
    $ghNoLabel = Join-Path $tmp 'gh-no-label.txt'
    [IO.File]::WriteAllText($ghIn, @"
const fs = require('fs');
const all = process.argv.slice(2).map(String);
fs.appendFileSync($(Js $ghCalls), all.join(' ') + '\n');
const p = all.find(a => /^repos\//i.test(a)) || '';
if (all.some(a => a.toLowerCase() === '--input')) { fs.writeFileSync($(Js $ghBody), fs.readFileSync(0, 'utf8')); }
// writeSync, so nothing is still unwritten when it exits.
const say = s => { fs.writeSync(1, s + '\n'); process.exit(0); };
const no = s => { fs.writeSync(2, s + '\n'); process.exit(1); };
if (/^repos\/ThornswoodRP\/Thornswood\/issues`$/.test(p)) {
  const labels = fs.existsSync($(Js $ghNoLabel)) ? [] : [{ name: 'notice: staff' }];
  say(JSON.stringify({ number: 5300, html_url: 'https://github.com/ThornswoodRP/Thornswood/issues/5300', labels }));
}
if (/^repos\/ThornswoodRP\/Thornswood\/issues\/5300`$/.test(p)) { say(fs.readFileSync($(Js $ghIssue), 'utf8')); }
if (/^repos\/ThornswoodRP\/Thornswood\/issues\/5300\/comments\?per_page=100`$/.test(p)) { say(fs.readFileSync($(Js $ghComments), 'utf8')); }
if (/^repos\/ThornswoodRP\/Thornswood\/issues\/5300\/labels`$/.test(p)) { say('[]'); }
no('gh: Not Found (HTTP 404)');
"@, $enc)
    Put-StandIn $bin2 'gh' $ghIn
    function Issue([string]$state, [string[]]$labels) {
        return (ConvertTo-Json -Compress -Depth 4 -InputObject @{ number = 5300; state = $state; labels = @($labels | ForEach-Object { @{ name = $_ } }) })
    }
    function Said([string[]]$bodies) {
        $all = @(@{ user = @{ type = 'User' }; body = 'Thanks.' }) + @($bodies | ForEach-Object { @{ user = @{ type = 'Bot' }; body = $_ } })
        return (ConvertTo-Json -Compress -Depth 4 -InputObject $all)
    }
    function ThroughGitHub([string[]]$a, [string]$issue = '', [string]$comments = '[]', [switch]$noLabel) {
        Remove-Item -LiteralPath $ghCalls, $ghBody, $ghNoLabel -ErrorAction SilentlyContinue
        if ($noLabel) { [IO.File]::WriteAllText($ghNoLabel, 'yes', $enc) }
        [IO.File]::WriteAllText($ghIssue, $issue, $enc)
        [IO.File]::WriteAllText($ghComments, $comments, $enc)
        $path = $env:PATH
        # Only the stand-in: no ssh is found, the way a cloud container has none.
        $env:PATH = $bin2
        try { $out = @(& $shell -NoProfile -NonInteractive -File $say @a 2>&1 | ForEach-Object { "$_" }) }
        finally { $env:PATH = $path }
        return [pscustomobject]@{
            Out = ($out -join "`n"); Code = $LASTEXITCODE
            Calls = @(if (Test-Path -LiteralPath $ghCalls) { [IO.File]::ReadAllLines($ghCalls) })
            Body = $(if (Test-Path -LiteralPath $ghBody) { ConvertFrom-Json ([IO.File]::ReadAllText($ghBody)) } else { $null })
        }
    }
    $text = 'Restarting the dev server at 4:30 PM for about 5 minutes.'
    $g = ThroughGitHub @('-Text', $text)
    Yes 'no ssh: it files the notice on the board, labelled notice: staff, titled from claude' (
        $g.Body -and $g.Body.title -eq 'Staff notice from claude' -and $g.Body.body -eq $text -and @($g.Body.labels) -contains 'notice: staff' -and
        @($g.Calls | Where-Object { $_ -match '^api -X POST repos/ThornswoodRP/Thornswood/issues --input -$' }).Count -eq 1)
    Yes '  the text went on gh''s standard input and is on no command line' (-not (($g.Calls -join ' ').Contains('dev server')))
    Yes '  it says filed with the number and the -Check line, exit 0' ($g.Code -eq 0 -and $g.Out -match 'filed #5300' -and $g.Out -match 'Say-Staff\.ps1 -Check 5300')
    $g = ThroughGitHub @('-From', 'djinn', '-Text', $text)
    Yes '  -From names the sender in the title' ($g.Code -eq 0 -and $g.Body.title -eq 'Staff notice from djinn')
    $g = ThroughGitHub @('-From', 'Not One', '-Text', $text)
    Yes '  and a -From that is not one lower case word is refused before anything is filed' ($g.Code -eq 1 -and $g.Out -match 'one lower case word' -and $null -eq $g.Body)
    $g = ThroughGitHub @('-Text', ('y' * 1801))
    Yes '  and one over 1800 characters' ($g.Code -eq 1 -and $g.Out -match '1801 characters' -and $g.Calls.Count -eq 0)
    $g = ThroughGitHub @('-Text', $text) -noLabel
    Yes '  an issue GitHub filed without the label is said, exit 1: the bot would not say it' ($g.Code -eq 1 -and $g.Out -match 'without the label notice: staff')

    $g = ThroughGitHub @('-Check', '5300') (Issue 'open' @('notice: staff')) (Said @())
    Yes 'no ssh, -Check: open and not said is exit 2' ($g.Code -eq 2 -and $g.Out -match 'not said yet')
    $g = ThroughGitHub @('-Check', '#5300') (Issue 'closed' @('notice: staff')) (Said @('Said in #staff-updates. The label "notice: take back" on this issue takes it out again.'))
    Yes '  said by the bot is exit 0, and a # is taken' ($g.Code -eq 0 -and $g.Out -match 'posted in #staff-updates, by the bot')
    $g = ThroughGitHub @('-Check', '5300') (Issue 'open' @('notice: staff')) (Said @("The bot did not say this notice in #staff-updates:`n`n- The notice is 1900 characters and 1800 is the most."))
    Yes '  what the bot refused is said as it said it, exit 1' ($g.Code -eq 1 -and $g.Out -match 'the bot refused it: - The notice is 1900 characters')
    $g = ThroughGitHub @('-Check', '5300') (Issue 'closed' @('notice: staff'))
    Yes '  closed and never said is exit 1' ($g.Code -eq 1 -and $g.Out -match 'never will be')
    $g = ThroughGitHub @('-Check', '5300') (Issue 'open' @('bug'))
    Yes '  an issue that is no notice is exit 1' ($g.Code -eq 1 -and $g.Out -match 'not a staff notice')
    $g = ThroughGitHub @('-Check', 'agent-claude-20261021130000-0a1b2c')
    Yes '  a box id is not an issue number, and nothing is asked' ($g.Code -eq 1 -and $g.Out -match 'not a notice''s issue number' -and $g.Calls.Count -eq 0)

    $g = ThroughGitHub @('-Unsay', '5300') (Issue 'closed' @('notice: staff'))
    Yes 'no ssh, -Unsay: the take back label goes on the issue, exit 0' (
        $g.Code -eq 0 -and $g.Out -match 'asked the bot to take #5300 back' -and @($g.Body.labels) -contains 'notice: take back' -and
        @($g.Calls | Where-Object { $_ -match '^api -X POST repos/ThornswoodRP/Thornswood/issues/5300/labels --input -$' }).Count -eq 1)
    $g = ThroughGitHub @('-Check', '5300') (Issue 'closed' @('notice: staff', 'notice: take back')) (Said @('Said in #staff-updates.'))
    Yes '  -Check while the bot has not done it is exit 2' ($g.Code -eq 2 -and $g.Out -match 'not done it yet')
    $g = ThroughGitHub @('-Check', '5300') (Issue 'closed' @('notice: staff', 'notice: take back')) (Said @('Said in #staff-updates.', 'The notice is taken out of #staff-updates.'))
    Yes '  and done is exit 0' ($g.Code -eq 0 -and $g.Out -match 'the bot deleted its post')
    $g = ThroughGitHub @('-Check', '5300') (Issue 'closed' @('notice: staff', 'notice: take back')) (Said @('The notice was not said yet, and now it never is.'))
    Yes '  and withheld is exit 0' ($g.Code -eq 0 -and $g.Out -match 'never posted')

    # ---- 5. Grant-BoxAccess.ps1's notices key ------------------------------
    $gast = $asts[$grantPath]
    $BridgeRoot = Join-Path $tmp 'bridge'
    $PutBack = 'Thornswood box access put back'
    $SayStaff = 'C:\Thornswood-Watch\say-staff.ps1'
    # The change script carries the folder lock from here, as Grant-BoxAccess.ps1 loads it (#3034).
    . (P 'scripts', 'vps', 'Lock-Folder.ps1')
    foreach ($n in 'Get-BoxKeyLine', 'Read-BoxKeyLine', 'Get-BoxChangeScript') {
        $fn = @($gast.FindAll({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n }, $true))
        Yes ("Grant-BoxAccess.ps1 has one $n") ($fn.Count -eq 1)
        Invoke-Expression $fn[0].Extent.Text
    }
    Yes 'Grant-BoxAccess.ps1 says the forced command is say-staff.ps1 in the watchdog''s folder' ([IO.File]::ReadAllText($grantPath).Contains("`$SayStaff = 'C:\Thornswood-Watch\say-staff.ps1'"))
    $pub = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGRZxJ2G1nGDrjqLMTed+Bui13icdTMAODXpx0ZQd55T'
    $plain = Get-BoxKeyLine $pub 'djinn' $false
    $notice = Get-BoxKeyLine $pub 'codex' $true
    Yes 'an ordinary key line is as it was: from="127.0.0.1" <key> thornswood-<name>' ($plain -eq ('from="127.0.0.1" ' + $pub + ' thornswood-djinn'))
    Yes 'a notices key line: only through the bridge, restricted, forced to say-staff.ps1 as its own name' (
        $notice -eq ('from="127.0.0.1",restrict,command="pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Thornswood-Watch\say-staff.ps1 -From codex" ' + $pub + ' thornswood-codex'))
    $rp = Read-BoxKeyLine $plain
    $rn = Read-BoxKeyLine $notice
    Yes '-List reads an ordinary line: its key, through the bridge, not a notices key' ($rp.Key -eq $pub -and $rp.Bridge -and -not $rp.Notices)
    Yes '-List reads a notices line: its key, through the bridge, a notices key' ($rn.Key -eq $pub -and $rn.Bridge -and $rn.Notices)
    $ro = Read-BoxKeyLine ($pub + ' thornswood')
    $rw = Read-BoxKeyLine ('command="powershell.exe -File C:\Thornswood-Watch\say-staff.ps1 -From codex" ' + $pub + ' thornswood-codex')
    Yes '  and a line with no options, which any address may use' ($ro.Key -eq $pub -and -not $ro.Bridge -and -not $ro.Notices)
    Yes '  and a forced command without restrict is not called a notices key' ($rw.Key -eq $pub -and -not $rw.Notices)

    # The box change with say-staff.ps1 missing, against a scratch key file.
    $keys = Join-Path $tmp 'administrators_authorized_keys'
    New-Item -ItemType Directory -Path (Join-Path $BridgeRoot 'tokens') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $BridgeRoot 'bridge.js'), '// stand-in')
    [IO.File]::WriteAllLines($keys, [string[]]@('from="127.0.0.1" ssh-ed25519 AAAAcloudkey thornswood-cloud'))
    $global:Armed = $false
    $stubs = @'
function Get-ScheduledTask { param($TaskName, $EA, $ErrorAction) if ($global:Armed) { 'a task' } }
function Register-ScheduledTask { $global:Armed = $true }
function icacls { }
'@
    $missing = Join-Path $tmp 'no-such-say-staff.ps1'
    $script = (Get-BoxChangeScript 'codex' ('d' * 64) $notice (($pub -split ' ')[1]) $missing).Replace('C:\ProgramData\ssh\administrators_authorized_keys', $keys).Replace('; exit 1 }', '; return }')
    $out = @(& ([scriptblock]::Create($stubs + "`n" + $script)) 2>&1 | ForEach-Object { "$_" })
    Yes 'a notices grant with no say-staff.ps1 on the box: STOP, nothing armed, nothing changed' (
        ($out -join ' ') -match '^STOP there is no .*no-such-say-staff\.ps1 on the box' -and -not $global:Armed -and
        @([IO.File]::ReadAllLines($keys)).Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path (Join-Path $BridgeRoot 'tokens') 'codex')))

    # It looks for ssh and ssh-keygen before it reads its switches.
    if ((Get-Command ssh -ErrorAction SilentlyContinue) -and (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
        $g = @(& $shell -NoProfile -NonInteractive -File $grantPath -Name codex -FromClipboard -NoticesOnly -NoPause 2>&1 | ForEach-Object { "$_" }) -join ' '
        Yes 'Grant-BoxAccess.ps1 -NoticesOnly without -MakeKey stops before anything is done' ($g -match '-NoticesOnly goes with -MakeKey')
    } else { Write-Host 'SKIP  Grant-BoxAccess.ps1 -NoticesOnly without -MakeKey: no ssh here, and it stops on that first' }

    # ---- 5b. -ToEnvironment: the workflow's key on GitHub (#3045) ----------
    # Set-MainOnlyEnvironment against a stand-in gh, a function here, which
    # answers each GET from the case's table and writes down each call.
    foreach ($n in 'Invoke-GitHub', 'Set-MainOnlyEnvironment') {
        $fn = @($gast.FindAll({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n }, $true))
        Yes ("Grant-BoxAccess.ps1 has one $n") ($fn.Count -eq 1)
        Invoke-Expression $fn[0].Extent.Text
    }
    $GitHubRepo = 'ThornswoodRP/Thornswood'
    function Say { }
    function Die([string]$m) { throw "DIE $m" }
    $script:ghAnswers = @{}
    $script:ghCalls = @()
    function gh {
        $all = @($args | ForEach-Object { [string]$_ })
        $body = @($input) -join ''
        $script:ghCalls += ,(($all -join ' ') + $(if ($body) { ' <<' + $body } else { '' }))
        $method = $all[[array]::IndexOf($all, '-X') + 1]
        $path = @($all | Where-Object { $_ -like 'repos/*' })[0]
        $key = $method + ' ' + $path
        if ($script:ghAnswers.ContainsKey($key)) { $global:LASTEXITCODE = $script:ghAnswers[$key][0]; return $script:ghAnswers[$key][1] }
        $global:LASTEXITCODE = 0
        return '{}'
    }
    function EnvCase([hashtable]$answers) {
        $script:ghAnswers = $answers
        $script:ghCalls = @()
        $err = ''
        try { Set-MainOnlyEnvironment 'notices' } catch { $err = $_.Exception.Message }
        return [pscustomobject]@{ Err = $err; Calls = $script:ghCalls; Changes = @($script:ghCalls | Where-Object { $_ -notmatch '^api -X GET ' }) }
    }
    $envPath = 'repos/ThornswoodRP/Thornswood/environments/notices'
    $c = EnvCase @{ ("GET " + $envPath) = @(1, 'gh: Not Found (HTTP 404)') }
    Yes '-ToEnvironment: no environment yet, so it is made for chosen branches and main is the one let in' (
        -not $c.Err -and $c.Changes.Count -eq 2 -and
        $c.Changes[0] -eq ('api -X PUT ' + $envPath + ' --input - <<{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}') -and
        $c.Changes[1] -eq ('api -X POST ' + $envPath + '/deployment-branch-policies --input - <<{"name":"main","type":"branch"}'))
    $custom = '{"name":"notices","deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
    $c = EnvCase @{ ("GET " + $envPath) = @(0, $custom); ("GET " + $envPath + '/deployment-branch-policies?per_page=100') = @(0, '{"total_count":1,"branch_policies":[{"id":1,"name":"main","type":"branch"}]}') }
    Yes '  there already, for main only: nothing is changed' (-not $c.Err -and $c.Changes.Count -eq 0)
    $c = EnvCase @{ ("GET " + $envPath) = @(0, $custom); ("GET " + $envPath + '/deployment-branch-policies?per_page=100') = @(0, '{"total_count":2,"branch_policies":[{"id":1,"name":"main","type":"branch"},{"id":2,"name":"claude/*","type":"branch"}]}') }
    Yes '  there, and another branch let in too: it stops, naming it, and changes nothing' ($c.Err -match '^DIE .*branch claude/\*' -and $c.Changes.Count -eq 0)
    $c = EnvCase @{ ("GET " + $envPath) = @(0, '{"name":"notices","deployment_branch_policy":null}') }
    Yes '  there with every branch let in: it is narrowed to main' ($c.Err -eq '' -and $c.Changes.Count -eq 2 -and $c.Changes[1] -match '"name":"main"')
    $c = EnvCase @{ ("GET " + $envPath) = @(1, 'gh: Must have admin rights to Repository. (HTTP 403)') }
    Yes '  GitHub refusing the read stops it, changing nothing' ($c.Err -match '^DIE .*HTTP 403' -and $c.Changes.Count -eq 0)
    $grantText = [IO.File]::ReadAllText($grantPath)
    # The same line sets the desk's DESK_KEY_B64 for -Deploy (#2841), so the
    # name is a variable that is NOTICE_KEY_B64 for every other key.
    Yes 'the key goes to gh secret set NOTICE_KEY_B64 for that environment on its standard input, and to no file' (
        $grantText.Contains("`$SecretName = if (`$Deploy) { 'DESK_KEY_B64' } else { 'NOTICE_KEY_B64' }") -and
        $grantText -match [regex]::Escape('[Convert]::ToBase64String([IO.File]::ReadAllBytes($newKey)) | & gh secret set $SecretName --env $ToEnvironment --repo $GitHubRepo') -and
        $grantText.IndexOf('if ($ToEnvironment) {', $grantText.IndexOf('Proving the new key through the bridge')) -lt $grantText.IndexOf('notice-access.txt', $grantText.IndexOf('Proving the new key through the bridge')))
    Yes '  and the environment is settled before the box is touched' ($grantText.IndexOf('Set-MainOnlyEnvironment $ToEnvironment') -lt $grantText.IndexOf('Get-BoxChangeScript $Name'))

    # ---- 6. staff-notice.yml is in the ops repository (#4013) --------------
    Yes 'staff-notice.yml is not in this repository, which has no VPS runner once public' (-not (Test-Path -LiteralPath (P '.github', 'workflows', 'staff-notice.yml')))
    $sayText = [IO.File]::ReadAllText($say)
    Yes '  Say-Staff.ps1 files on the board the bot reads, with the labels the bot reads' (
        $sayText.Contains("[string]`$NoticeRepo = 'ThornswoodRP/Thornswood'") -and $sayText.Contains("`$noticeLabel = 'notice: staff'") -and $sayText.Contains("`$takeBackLabel = 'notice: take back'"))
    $botText = [IO.File]::ReadAllText((P 'bot', 'bot.py'))
    Yes '  and they are the bot''s own' (
        $botText.Contains("os.environ.get('STAFF_NOTICE_LABEL', 'notice: staff')") -and $botText.Contains("os.environ.get('STAFF_TAKE_BACK_LABEL', 'notice: take back')"))
    Yes '  and Grant-BoxAccess.ps1 -ToEnvironment puts the key in that repository''s environment' ($grantText.Contains("[string]`$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'"))
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
exit 0
