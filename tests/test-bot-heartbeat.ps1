<#
  test-bot-heartbeat.ps1

  The watchdog treats a bot whose heartbeat has gone quiet as down, even while
  its python process is alive (issue #449).

  WHY THIS EXISTS. The watchdog's only question about the bot was whether a
  python process with Thornswood-Bot in its command line was running. A bot
  stuck logging in, hung, or cut off from Discord for good is still that
  process, so the watchdog said nothing and, since #447, the staff channel
  heard nothing either: the bot is what posts there. Now the bot writes
  heartbeat.json beside itself every minute (bot\tests\test-heartbeat.py checks
  that half) and the watchdog reads it. This checks the watchdog half:

    the rule    BeatProblem, the one function that decides, against a table
                of heartbeats: fresh, hung, off Discord, never on Discord, a
                new run that has not written yet, a file from before this
    the run     the real watcher, top to bottom, on a fake clock: a hung bot
                is told about once, through the webhook because the bot
                cannot post, is restarted by its service's name (#465), at
                most three times an hour, and is said to be back once it
                beats again. A bot with no heartbeat file is left to the
                process check, as before
    the bot     when a python with discord.py is on this machine, the real
                bot.py writes a heartbeat and the real rule reads it

  HOW. The watcher is a single quoted here-string inside Watch-Services.ps1.
  This lifts it out through the AST, as test-watch-alerts.ps1 does, and
  replaces only what touches the world: the probes, schtasks,
  Restart-Service, the sleep, the clock and the webhook post. The heartbeat
  file is a real file in a scratch folder.

  Read only apart from files under its own temp folder. Never connects to
  anything, never runs schtasks and never restarts a service.
#>
[CmdletBinding()]
param([string]$WatchPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $WatchPath) { $WatchPath = Join-Path $Here '..\scripts\vps\Watch-Services.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done() {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- the watcher, as the box gets it ----------------------------------------
$errs = $null
$outer = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $WatchPath).Path, [ref]$null, [ref]$errs)
Yes 'Watch-Services.ps1 parses' ($errs.Count -eq 0)
$assign = $outer.Find({ param($a)
    $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$watcher' }, $true)
$text = $null
if ($assign) {
    $str = $assign.Right.Find({ param($a) $a -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true)
    if ($str) { $text = $str.Value }
}
Yes 'the watcher here-string is in Watch-Services.ps1' ($null -ne $text)
if ($null -eq $text) { Done }
$werrs = $null
$inner = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$werrs)
Yes 'the watch.ps1 it writes on the box parses' ($werrs.Count -eq 0)

$fns = @{}
foreach ($f in $inner.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $fns[$f.Name] = $f }
foreach ($n in @('BotProcs', 'ReadBeat', 'Mins', 'BeatProblem', 'BotSilent', 'Observe', 'Deliver')) {
    Yes "$n is in the watcher" ($fns.ContainsKey($n))
}
if ($script:fail) { Done }

$heart = ''
foreach ($n in @('BotProcs', 'ReadBeat', 'Mins', 'BeatProblem', 'BotSilent')) { $heart += $fns[$n].Extent.Text + "`n" }
Yes 'nothing that reads the heartbeat restarts or stops anything itself' (
    $heart -notmatch 'schtasks|ScheduledTask|Stop-Process|Restart-|Start-Process|taskkill|Kill\(')
Yes 'the heartbeat is read from where the bot writes it, the data folder under C:\Thornswood-Bot' (
    $text -match "(?m)^\`$botBeat = 'C:\\Thornswood-Bot\\data\\heartbeat\.json'\r?$")
Yes 'the bot''s check carries the heartbeat' ($text -match "Name = 'bot';[^\r\n]*Beat = \`$botBeat")
Yes 'the webhook treats a bot off Discord as a bot that cannot post' ($fns['Deliver'].Extent.Text -match 'BotSilent \$botBeat')
$staleAst = $inner.Find({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$beatStale' }, $true)
Yes 'ten quiet minutes is the line' ($staleAst -and $staleAst.Right.Extent.Text -eq '600')

# ---- the rule, on its own ---------------------------------------------------
$beatStale = 600
. ([scriptblock]::Create($fns['Mins'].Extent.Text + "`n" + $fns['BeatProblem'].Extent.Text + "`n" + $fns['ReadBeat'].Extent.Text))

$at = 2000000000
function B([int64]$written, [bool]$on, [int64]$connectedAt, [int64]$started = ($at - 7200), [int64]$procId = 4242, [int64]$lastEvent = 0) {
    return [pscustomobject]@{ pid = $procId; started = $started; written = $written; connected = $on; connected_at = $connectedAt; last_event = $lastEvent; last_event_type = 'GUILD_MEMBER_UPDATE' }
}
$running = @(@{ Id = 4242; Started = $at - 7200 })

Yes 'fresh and on Discord is fine' ((BeatProblem (B ($at - 30) $true ($at - 30)) $running $at) -eq '')
Yes 'no bot process is not this rule''s to judge: the process check has it' ((BeatProblem (B ($at - 5000) $false 0) @() $at) -eq '')
Yes 'no heartbeat file is a bot from before this, and says nothing' ((BeatProblem $null $running $at) -eq '')
$r = BeatProblem (B ($at - 660) $true ($at - 660)) $running $at
Yes 'a heartbeat eleven minutes old is a hung bot' ($r -match '^Its python process is running, but its heartbeat stopped 11 minutes ago, so it is hung$')
Yes 'nine minutes old is not yet' ((BeatProblem (B ($at - 540) $true ($at - 540)) $running $at) -eq '')
Yes 'exactly ten is not yet either' ((BeatProblem (B ($at - 600) $true ($at - 600)) $running $at) -eq '')
$r = BeatProblem (B ($at - 20) $false ($at - 900)) $running $at
Yes 'beating but off Discord for fifteen minutes is down' ($r -match '^Its python process is running, but it has not been connected to Discord for 15 minutes$')
Yes 'off Discord for five is a reconnect, and fine' ((BeatProblem (B ($at - 20) $false ($at - 300)) $running $at) -eq '')
$r = BeatProblem (B ($at - 20) $false 0 ($at - 720)) @(@{ Id = 4242; Started = $at - 720 }) $at
Yes 'never reached Discord in twelve minutes since it started is down' ($r -match '^Its python process is running, but it has not reached Discord in the 12 minutes since it started$')
Yes 'three minutes after starting it is still logging in, and fine' ((BeatProblem (B ($at - 20) $false 0 ($at - 180)) @(@{ Id = 4242; Started = $at - 180 }) $at) -eq '')
$old = B ($at - 90000) $true ($at - 90000) ($at - 99000) 1111
Yes 'a new run that has not written yet, two minutes in, is starting, and fine' ((BeatProblem $old @(@{ Id = 4242; Started = $at - 120 }) $at) -eq '')
$r = BeatProblem $old @(@{ Id = 4242; Started = $at - 1200 }) $at
Yes 'twenty minutes in with no heartbeat of its own, it is stuck before it got going' ($r -match '^Its python process has been running for 20 minutes and has not written a heartbeat once')
Yes 'a process Windows gave no start time for is not judged on its age' ((BeatProblem $old @(@{ Id = 4242; Started = 0 }) $at) -eq '')
Yes 'a copy started by hand beside the real one does not hide the real one''s heartbeat' (
    (BeatProblem (B ($at - 30) $true ($at - 30)) @(@{ Id = 9999; Started = $at - 60 }, @{ Id = 4242; Started = $at - 7200 }) $at) -eq '')
$r = BeatProblem (B ($at - 20) $false ($at - 900) ($at - 7200) 4242 ($at - 840)) $running $at
Yes 'the message says when it last heard from Discord, when it has' ($r -match 'for 15 minutes\. The last thing it heard from Discord was 14 minutes ago$')
Yes 'a minute is said as a minute' ((Mins 60) -eq 'a minute' -and (Mins 30) -eq 'a minute' -and (Mins 180) -eq '3 minutes')
$words = @(
    (BeatProblem (B ($at - 660) $true ($at - 660) ($at - 7200) 4242 ($at - 700)) $running $at),
    (BeatProblem (B ($at - 20) $false ($at - 900)) $running $at),
    (BeatProblem (B ($at - 20) $false 0 ($at - 720)) @(@{ Id = 4242; Started = $at - 720 }) $at),
    (BeatProblem $old @(@{ Id = 4242; Started = $at - 1200 }) $at))
$bad = @($words | Where-Object { -not $_ -or $_ -match '[^\x00-\x7F]' -or $_ -match '(?i)\bplayers?\b' -or $_ -match '\.$' })
Yes 'every reason is plain ASCII, never says player, and leaves the full stop to the message' ($bad.Count -eq 0)

# ---- the whole watcher, on a fake clock ---------------------------------------
$fake = @('Answers', 'SiteAnswers', 'BotAlive', 'BotProcs', 'HealthProblem', 'HowItEnded', 'ServiceProblem', 'BackupProblem', 'OffBoxProblem', 'CertProblem', 'PostWebhook', 'DiskNow')
$body = @()
foreach ($s in $inner.EndBlock.Statements) {
    if ($s -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $fake -contains $s.Name) { continue }
    if ($s -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($s.Left)" -eq '$root') { $body += '$root = $script:boxRoot'; continue }
    if ($s -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($s.Left)" -eq '$botBeat') { $body += '$botBeat = $script:beatFile'; continue }
    $body += $s.Extent.Text
}
$script:watchBlock = [scriptblock]::Create($body -join "`n")

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-botbeat-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
# Built, never written whole: files here are scanned for webhook addresses.
$script:goodHook = 'https://discord.com/api/' + 'webhooks/12345/' + 'harness-not-a-real-token'

function Box([string]$name) {
    $script:boxRoot = Join-Path $tmp $name
    New-Item -ItemType Directory -Force -Path $script:boxRoot | Out-Null
    Set-Content -LiteralPath (Join-Path $script:boxRoot 'alerts-webhook.txt') -Value $script:goodHook -Encoding ASCII
    $script:beatFile = Join-Path $script:boxRoot 'heartbeat.json'
    $script:clock = New-Object DateTime (2026, 9, 29, 12, 0, 0, [DateTimeKind]::Local)
    $script:alive = $true        # the python process is there
    $script:beating = $true      # its heartbeat loop is running
    $script:onDiscord = $true    # and it is connected
    $script:writes = $true       # and it writes a heartbeat at all
    $script:procStart = ([DateTimeOffset]$script:clock).ToUnixTimeSeconds() - 3600
    $script:connectedAt = 0
    $script:down = @{}
    $script:said = @()
    $script:runs = @()
    $script:restartHelps = $true # a restart brings a bot that works
}
function Unix() { return ([DateTimeOffset]$script:clock).ToUnixTimeSeconds() }

function Get-Date { return $script:clock }
function Start-Sleep { }
function schtasks { $script:runs += $args[-1]; $global:LASTEXITCODE = 0; return 'SUCCESS' }
# The bot's service (#465). On the VPS, where the nightly run is, the real one
# would restart the real bot, so this stands in before anything runs. A
# restart is a new python: it starts now, and it works unless told not to.
function Restart-Service {
    [CmdletBinding()] param([string]$Name, [switch]$Force)
    $script:runs += $Name
    $script:alive = $true
    $script:procStart = Unix
    if ($script:restartHelps) { $script:beating = $true; $script:onDiscord = $true }
}
function Answers($port) { return -not $script:down.ContainsKey([int]$port) }
function SiteAnswers($url) { return $true }
function BotAlive() { return $script:alive }
function BotProcs() { if ($script:alive) { return @(@{ Id = 4242; Started = $script:procStart }) } return @() }
function HealthProblem($url) { return '' }
function HowItEnded($task) { return '' }
function ServiceProblem($name) { return '' }
function BackupProblem($task, $folder, $hours) { return '' }
# The off-box copy (#2936), which test-watch-alerts.ps1 holds; here it is fine.
function OffBoxProblem($file, $hours) { return '' }
# Caddy's own certificate (#2995), which test-watch-alerts.ps1 holds; here it is fine.
function CertProblem($url, $days) { return '' }
function DiskNow() { return @{ Free = 40GB; Size = 80GB } }
function PostWebhook($url, $text) {
    if ($url -ne $script:goodHook) { return 'HTTP 404' }
    $script:said += @{ By = 'hook'; Text = $text }
    return ''
}

# The bot's minute: write the heartbeat the way bot.py does, then post what
# nobody has, the way watch_services does, if it is on Discord to post it.
function BotMinute() {
    if (-not $script:alive) { return }
    $now = Unix
    if ($script:onDiscord) { $script:connectedAt = $now }
    if ($script:writes -and $script:beating) {
        $rec = @{ pid = 4242; started = $script:procStart; written = $now; connected = $script:onDiscord; connected_at = $script:connectedAt; last_event = $script:connectedAt; last_event_type = 'GUILD_MEMBER_UPDATE' }
        [IO.File]::WriteAllText($script:beatFile, ($rec | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    }
    if (-not ($script:beating -and $script:onDiscord)) { return }
    $f = Join-Path $script:boxRoot 'alerts.jsonl'
    if (-not (Test-Path -LiteralPath $f)) { return }
    $done = @{}
    foreach ($n in @('alerts-sent-bot.txt', 'alerts-sent-webhook.txt')) {
        $p = Join-Path $script:boxRoot $n
        if (Test-Path -LiteralPath $p) { foreach ($i in (Get-Content -LiteralPath $p)) { $done["$i".Trim()] = $true } }
    }
    foreach ($line in (Get-Content -LiteralPath $f -Encoding UTF8)) {
        if (-not $line) { continue }
        $a = ConvertFrom-Json $line
        if ($done.ContainsKey($a.id)) { continue }
        $script:said += @{ By = 'bot'; Text = $a.text }
        Add-Content -LiteralPath (Join-Path $script:boxRoot 'alerts-sent-bot.txt') -Value $a.id -Encoding ASCII
    }
}
# Five minutes: the bot's minutes, then the watcher's run.
function Step([int]$n = 1) {
    for ($i = 0; $i -lt $n; $i++) {
        $script:clock = $script:clock.AddMinutes(5)
        BotMinute
        $null = . $script:watchBlock
        BotMinute
    }
}
function Said([string]$rx) { return @($script:said | Where-Object { $_.Text -match $rx }).Count }
function By([string]$who) { return @($script:said | Where-Object { $_.By -eq $who }).Count }
function BotRuns() { return @($script:runs | Where-Object { $_ -eq 'ThornswoodBot' }).Count }
function TaskRuns() { return @($script:runs | Where-Object { $_ -eq 'Thornswood Bot' }).Count }

try {
    # -- a bot that is fine ------------------------------------------------------
    Box 'fine'
    Step 24
    Yes 'two hours of a bot beating on Discord say nothing and restart nothing' ($script:said.Count -eq 0 -and $script:runs.Count -eq 0)

    # -- hung: running, and the heartbeat stops -----------------------------------
    Box 'hung'
    Step 2
    $script:beating = $false
    Step 2
    Yes 'ten minutes of a stopped heartbeat is not yet down' ($script:said.Count -eq 0)
    Step 1
    Yes 'fifteen is: said once, that the bot is down' ((Said '^\*\*The Discord bot is down\.\*\*') -eq 1 -and $script:said.Count -eq 1)
    $first = "$($script:said[0].Text)"
    Yes 'in words: running, but hung, and since when' ($first -match 'Its python process is running, but its heartbeat stopped 15 minutes ago, so it is hung\. The last thing it heard from Discord was 15 minutes ago\. First noticed <t:\d+:f>\.')
    Yes 'and that the watchdog restarted it (#465)' ($first -match 'The watchdog restarted it and it answered again\.')
    Yes 'by the service''s name, once, and never through a task' ((BotRuns) -eq 1 -and (TaskRuns) -eq 0)
    Yes 'through the webhook, at once, because a hung bot cannot post it' ((By 'hook') -eq 1 -and (By 'bot') -eq 0)
    Step 1
    Yes 'one run beating again is not yet back' ((Said 'The Discord bot is back') -eq 0)
    Step 1
    Yes 'two is back, said once, by the bot now it can' ((Said 'The Discord bot is back') -eq 1 -and @($script:said | Where-Object { $_.By -eq 'bot' -and $_.Text -match 'Discord bot is back' }).Count -eq 1)
    Yes 'and nothing is said twice, nor restarted again' ((Said 'The Discord bot is down') -eq 1 -and (BotRuns) -eq 1)

    # -- hung, and a restart does not help ------------------------------------------
    Box 'hung-stays'
    $script:restartHelps = $false
    Step 2
    $script:beating = $false
    Step 3
    Yes 'hung again after its restart: said once' ((Said 'The Discord bot is down') -eq 1)
    Step 12
    Yes 'an hour of it is restarted three times and no more, the same rule as a service that will not stay up' ((BotRuns) -eq 3)
    Yes 'and said no more than once' ($script:said.Count -eq 1)
    Yes 'watch.log says it has stopped trying' (@(Get-Content -LiteralPath (Join-Path $script:boxRoot 'watch.log') | Where-Object { $_ -match 'bot is still down after 3 restarts this hour' }).Count -ge 1)
    $script:down[3000] = $true
    Step 1
    Yes 'something else dying while the bot is hung goes through the webhook too' ((Said 'The live game server is down') -eq 1 -and (By 'hook') -eq 2)
    $script:down = @{}

    # -- off Discord: beating, not connected --------------------------------------
    Box 'off'
    Step 2
    $script:onDiscord = $false
    Step 2
    Yes 'ten minutes off Discord is a reconnect, and says nothing' ($script:said.Count -eq 0)
    Step 1
    Yes 'fifteen is down, once, saying it is off Discord' ((Said 'The Discord bot is down\.\*\* Its python process is running, but it has not been connected to Discord for 15 minutes') -eq 1 -and $script:said.Count -eq 1)
    Yes 'through the webhook' ((By 'hook') -eq 1)
    Yes 'and restarted by the service''s name' ((BotRuns) -eq 1)
    Step 2
    Yes 'back on Discord after the restart is back, once' ((Said 'The Discord bot is back') -eq 1 -and $script:said.Count -eq 2)
    Step 6
    Yes 'and nothing more' ($script:said.Count -eq 2 -and (BotRuns) -eq 1)

    # -- a bot from before the heartbeat --------------------------------------------
    Box 'old-bot'
    $script:writes = $false
    Step 24
    Yes 'a bot that writes no heartbeat is left to the process check: nothing said' ($script:said.Count -eq 0 -and $script:runs.Count -eq 0)
    Yes 'and the watcher writes no heartbeat of its own' (-not (Test-Path -LiteralPath $script:beatFile))

    # -- the process itself gone ------------------------------------------------------
    Box 'gone'
    Step 2
    $script:alive = $false
    Step 1
    Yes 'the process gone: restarted by the service''s name, and said once' ((BotRuns) -eq 1 -and (TaskRuns) -eq 0 -and (Said 'The Discord bot is down') -eq 1)
    Yes 'in the old words, not the heartbeat''s' ((Said 'Its python process is not running') -eq 1 -and (Said 'heartbeat') -eq 0)

    $leak = $false
    foreach ($d in (Get-ChildItem -LiteralPath $tmp -Directory)) {
        foreach ($f in (Get-ChildItem -LiteralPath $d.FullName -File | Where-Object { $_.Name -ne 'alerts-webhook.txt' })) {
            if ((Get-Content -LiteralPath $f.FullName -Raw) -match 'webhooks/|harness-not-a-real-token') { $leak = $true }
        }
    }
    Yes 'the webhook address is in none of the files the watcher writes' (-not $leak)
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) $false
}

# ---- the real bot's heartbeat, read by the real rule ---------------------------
# Only where a python with discord.py is installed, which the VPS and a
# developer's machine have. Anywhere else this part is skipped, and says so.
try {
    # Python's own complaints on stderr are not this harness failing.
    $ErrorActionPreference = 'Continue'
    $py = $null
    # The bot's own floor (bot\_pyguard.py, #2276): 3.10 or newer. Until #2504
    # this tried py -3.9 first and never asked the version, so on a machine
    # whose 3.9 had discord.py the real bot refused to start and wrote nothing.
    foreach ($c in @(@('py', '-3.12'), @('python'))) {
        $exe = Get-Command $c[0] -EA SilentlyContinue
        if (-not $exe) { continue }
        $pre = @(); if ($c.Count -gt 1) { $pre = @($c[1]) }
        $null = & $c[0] @pre -c 'import sys; assert sys.version_info >= (3, 10); import discord, PIL' 2>&1
        if ($LASTEXITCODE -eq 0) { $py = $c; break }
    }
    if (-not $py) {
        Write-Host 'SKIP  the real bot''s heartbeat: no python 3.10 or newer with discord.py on this machine'
    } else {
        $real = Join-Path $tmp 'real-heartbeat.json'
        $botDir = (Resolve-Path (Join-Path $Here '..\bot')).Path
        $env:DISCORD_TOKEN = 'not-a-real-token'
        $env:HEARTBEAT_FILE = $real
        $pre = @(); if ($py.Count -gt 1) { $pre = @($py[1]) }
        $code = "import sys; sys.path.insert(0, sys.argv[1]); import harness_bot; sys.exit(0 if harness_bot.whole().beat_now() else 1)"
        $null = & $py[0] @pre -c $code $botDir 2>&1
        $rc = $LASTEXITCODE
        Remove-Item Env:HEARTBEAT_FILE -EA SilentlyContinue
        Yes 'the real bot.py writes a heartbeat' ($rc -eq 0 -and (Test-Path -LiteralPath $real))
        $got = $null
        if (Test-Path -LiteralPath $real) {
            $got = ReadBeat $real
        }
        Yes 'the watcher''s ReadBeat reads it' ($null -ne $got -and [int64]$got.pid -gt 0)
        if ($got) {
            $p = @(@{ Id = [int64]$got.pid; Started = [int64]$got.started })
            Yes 'just written, not yet on Discord: fine' ((BeatProblem $got $p ([int64]$got.written)) -eq '')
            Yes 'the same file twelve minutes later, never written again, is a hung bot' (
                (BeatProblem $got $p ([int64]$got.written + 720)) -match 'its heartbeat stopped 12 minutes ago, so it is hung')
            $got.written = [int64]$got.started + 660
            Yes 'and written a minute ago, still not on Discord, is a bot that never reached it' (
                (BeatProblem $got $p ([int64]$got.started + 720)) -match 'has not reached Discord in the 12 minutes since it started')
        }
    }
}
catch {
    Yes ('the real bot''s heartbeat part ran: ' + $_.Exception.Message) $false
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}

Done
