<#
  test-watch-alerts.ps1

  The watchdog on the VPS tells a person when something dies, once, and once
  more when it is back (issue #447).

  WHY THIS EXISTS. Until #447 the watchdog restarted what stopped and wrote
  about it in watch.log on the same box, and nothing reached a person unless
  the bot was up to read that file. The bot being down was the one outage
  nobody could hear about. And a watcher that says the same thing every five
  minutes is a channel nobody reads, which is the same as nobody being told.
  So most of what this checks is the count: one message per outage, one per
  recovery, through a service that stays down, one that comes back, one that
  flaps, one that is hung, the bot being down, the bot being up but silent,
  and a webhook that fails.

  HOW. The watcher is a single quoted here-string inside Watch-Services.ps1,
  written out on the VPS as watch.ps1. This lifts it out through the AST and
  runs the real thing, top to bottom, once per five minute step on a fake
  clock, in a scratch folder. Only what touches the world is replaced: the
  port, site, health, bot, backup, off-box copy, runner and disk probes, schtasks,
  Restart-Service (the bot's service, #465), the sleep, the clock and the
  webhook post. A fake bot plays the part of
  watch_services in bot.py between runs: it posts whatever is in the outbox
  and not yet posted, and marks it, the way the real one does.
  bot\tests\test-watch-services.py drives the real bot against what this writes
  (-Emit).

  Read only apart from files under its own temp folder. Never connects to
  anything, never runs schtasks and never restarts a service.
#>
[CmdletBinding()]
param(
    [string]$WatchPath,
    # Write an outbox the real watcher produced to this file and stop, for
    # the bot's harness to read.
    [string]$Emit
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $WatchPath) { $WatchPath = Join-Path $Here '..\scripts\vps\Watch-Services.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; if (-not $Emit) { Write-Host "PASS  $what" } }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done() {
    if (-not $Emit) {
        Write-Host ''
        Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    }
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
Yes 'the watch.ps1 it writes is plain ASCII' (-not ($text -match '[^\x00-\x7F]'))

$fns = @{}
foreach ($f in $inner.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $fns[$f.Name] = $f }
foreach ($n in @('Observe', 'Tell', 'Deliver', 'PostWebhook', 'WebhookUrl', 'HealthProblem', 'HowItEnded', 'BackupProblem', 'OffBoxProblem', 'ServiceProblem', 'ReadOutages', 'SaveOutages', 'TrimAlerts')) {
    Yes "$n is in the watcher" ($fns.ContainsKey($n))
}
if ($script:fail) { Done }

# What stays exactly as it was.
Yes 'the three-strikes rule is still there' ($text -match '\$already -ge 3')
Yes 'a health check that fails restarts nothing: Observe and HealthProblem never call schtasks' (
    ($fns['Observe'].Extent.Text + $fns['HealthProblem'].Extent.Text + $fns['Deliver'].Extent.Text) -notmatch 'schtasks|ScheduledTask|Restart-|Stop-Process|Start-Process')
$outerHook = $outer.Find({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$hookRx' -and $a.Extent.StartOffset -gt $assign.Extent.EndOffset }, $true)
$innerHook = $inner.Find({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$hookRx' }, $true)
Yes 'the webhook shape -SetWebhook checks is the one the box checks' (
    $outerHook -and $innerHook -and $outerHook.Right.Extent.Text -eq $innerHook.Right.Extent.Text)
Yes 'no webhook address is written in the file' (
    -not ((Get-Content -LiteralPath $WatchPath -Raw) -match 'discord(app)?\.com/api/webhooks/\d'))
Yes '-SetWebhook sends the address on standard input, never on the command line' (
    # Through Invoke-ThornswoodNative since #941, piped on to ssh the same way.
    (Get-Content -LiteralPath $WatchPath -Raw) -match '\$url \| Invoke-ThornswoodNative \{ \$input \| & ssh' -and
    (Get-Content -LiteralPath $WatchPath -Raw) -match '\[Console\]::In\.ReadLine\(\)')

# The watcher as it runs, without the probes that touch the world. The fakes
# below stand in for those, and $root is a scratch folder.
$fake = @('Answers', 'SiteAnswers', 'BotAlive', 'BotProcs', 'HealthProblem', 'HowItEnded', 'ServiceProblem', 'BackupProblem', 'OffBoxProblem', 'CertProblem', 'PostWebhook', 'DiskNow')
$body = @()
foreach ($s in $inner.EndBlock.Statements) {
    if ($s -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $fake -contains $s.Name) { continue }
    if ($s -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($s.Left)" -eq '$root') {
        $body += '$root = $script:boxRoot'
        continue
    }
    $body += $s.Extent.Text
}
$script:watchBlock = [scriptblock]::Create($body -join "`n")

# ---- the fake world ---------------------------------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-watchalerts-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
if ($Emit) { $tmp = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($Emit))) ('watchalerts-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)) }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# Built, never written whole: this file is scanned for webhook addresses.
$script:goodHook = 'https://discord.com/api/' + 'webhooks/12345/' + 'harness-not-a-real-token'
$ports = @{ 3001 = 'website'; 3000 = 'game'; 7778 = 'voice'; 7788 = 'dev game'; 7789 = 'dev voice'; 7790 = 'bridge' }
$tasks = @{ 'Thornswood Web' = 'caddy'; 'Thornswood Docs' = 'website'; 'Thornswood Server' = 'game'; 'Thornswood Voice' = 'voice'; 'Thornswood Dev Server' = 'dev game'; 'Thornswood Dev Voice' = 'dev voice'; 'Thornswood Bridge' = 'bridge' }

function Box([string]$name, [switch]$NoHook, [string]$Hook) {
    $script:boxRoot = Join-Path $tmp $name
    New-Item -ItemType Directory -Force -Path $script:boxRoot | Out-Null
    if ($Hook) { Set-Content -LiteralPath (Join-Path $script:boxRoot 'alerts-webhook.txt') -Value $Hook -Encoding ASCII }
    elseif (-not $NoHook) { Set-Content -LiteralPath (Join-Path $script:boxRoot 'alerts-webhook.txt') -Value $script:goodHook -Encoding ASCII }
    $script:clock = New-Object DateTime (2026, 9, 28, 12, 0, 0, [DateTimeKind]::Local)
    $script:world = @{}
    foreach ($n in @('caddy', 'website', 'game', 'voice', 'bot', 'dev game', 'dev voice', 'bridge')) {
        $script:world[$n] = @{ Up = $true; Restart = 'up'; Health = ''; Ended = '' }
    }
    $script:backupWhy = ''
    $script:offboxWhy = ''
    $script:certWhy = ''
    $script:runnerWhy = ''
    $script:diskPct = 50.0
    $script:hookAnswer = ''
    $script:hookTries = 0
    $script:botHung = $false
    $script:said = @()
    $script:runs = @()
}

function Get-Date { return $script:clock }
function Start-Sleep { }
function schtasks {
    $name = $args[-1]
    $script:runs += $name
    $w = $null
    if ($tasks.ContainsKey($name)) { $w = $script:world[$tasks[$name]] }
    if (-not $w -or $w.Restart -eq 'refuse') { $global:LASTEXITCODE = 1; return 'ERROR: no such task' }
    if ($w.Restart -eq 'up') { $w.Up = $true }
    $global:LASTEXITCODE = 0
    return 'SUCCESS'
}
# The bot is a Windows service since #465, restarted by its name. Standing in
# here matters more than anything else in this file: on the VPS, where the
# nightly run is, the real Restart-Service would restart the real bot.
$services = @{ 'ThornswoodBot' = 'bot' }
function Restart-Service {
    [CmdletBinding()] param([string]$Name, [switch]$Force)
    $script:runs += $Name
    $w = $null
    if ($services.ContainsKey($Name)) { $w = $script:world[$services[$Name]] }
    if (-not $w -or $w.Restart -eq 'refuse') { throw ('Cannot find any service with service name ''' + $Name + '''.') }
    if ($w.Restart -eq 'up') { $w.Up = $true }
}
function Answers($port) { return [bool]$script:world[$ports[[int]$port]].Up }
function SiteAnswers($url) { return [bool]$script:world['caddy'].Up }
function BotAlive() { return [bool]$script:world['bot'].Up }
# No process for the heartbeat rule (#449) to judge, so it never reads the
# live bot's heartbeat when this runs on the VPS. test-bot-heartbeat.ps1 has it.
function BotProcs() { return @() }
function HealthProblem($url) {
    foreach ($k in $ports.Keys) { if ($url -match (':' + $k + '/')) { return $script:world[$ports[$k]].Health } }
    return ''
}
function HowItEnded($task) { if ($tasks.ContainsKey($task)) { return $script:world[$tasks[$task]].Ended }; return '' }
function ServiceProblem($name) { return $script:runnerWhy }
function BackupProblem($task, $folder, $hours) { return $script:backupWhy }
function OffBoxProblem($file, $hours) { $script:offboxFile = $file; return $script:offboxWhy }
function CertProblem($url, $days) { $script:certAsked = $url; return $script:certWhy }
function DiskNow() { return @{ Free = 80GB * $script:diskPct / 100.0; Size = 80GB } }
function PostWebhook($url, $text) {
    $script:hookTries++
    if ($url -ne $script:goodHook) { return 'HTTP 404' }
    if ($script:hookAnswer) { return $script:hookAnswer }
    $script:said += @{ By = 'hook'; Text = $text }
    return ''
}

function Outbox() {
    $f = Join-Path $script:boxRoot 'alerts.jsonl'
    if (-not (Test-Path -LiteralPath $f)) { return @() }
    return @(Get-Content -LiteralPath $f -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { ConvertFrom-Json $_ })
}
function SentIn($file) {
    $f = Join-Path $script:boxRoot $file
    if (-not (Test-Path -LiteralPath $f)) { return @() }
    return @(Get-Content -LiteralPath $f | Where-Object { $_ })
}

# The bot's minute between two runs: it posts what nobody has, and marks it.
function BotRound() {
    if (-not $script:world['bot'].Up -or $script:botHung) { return }
    $done = @{}
    foreach ($i in (SentIn 'alerts-sent-bot.txt') + (SentIn 'alerts-sent-webhook.txt')) { $done[$i] = $true }
    foreach ($a in (Outbox)) {
        if ($done.ContainsKey($a.id)) { continue }
        $script:said += @{ By = 'bot'; Text = $a.text }
        Add-Content -LiteralPath (Join-Path $script:boxRoot 'alerts-sent-bot.txt') -Value $a.id -Encoding ASCII
    }
}

# One five minute step: the watcher's run, then the bot's minute.
function Step([int]$n = 1) {
    for ($i = 0; $i -lt $n; $i++) {
        $script:clock = $script:clock.AddMinutes(5)
        $null = . $script:watchBlock
        BotRound
    }
}
function Said([string]$rx) { return @($script:said | Where-Object { $_.Text -match $rx }).Count }
function By([string]$who) { return @($script:said | Where-Object { $_.By -eq $who }).Count }
function LogLines([string]$rx) {
    $f = Join-Path $script:boxRoot 'watch.log'
    if (-not (Test-Path -LiteralPath $f)) { return 0 }
    return @(Get-Content -LiteralPath $f | Where-Object { $_ -match $rx }).Count
}
function Show() {
    foreach ($s in $script:said) { Write-Host ('      ' + $s.By + ': ' + $s.Text) }
    $f = Join-Path $script:boxRoot 'watch.log'
    if (Test-Path -LiteralPath $f) { Get-Content -LiteralPath $f | ForEach-Object { Write-Host "      log: $_" } }
}

try {
    if ($Emit) {
        Box 'emit'
        $script:world['game'].Up = $false; $script:world['game'].Restart = 'down'
        Step 2
        $script:world['game'].Up = $true
        Step 3
        $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'down'
        Step 1
        Copy-Item -LiteralPath (Join-Path $script:boxRoot 'alerts.jsonl') -Destination $Emit -Force
        Yes 'the emitted outbox has three messages' (@(Outbox).Count -eq 3)
        Done
    }

    # -- a quiet box ----------------------------------------------------------
    Box 'quiet'
    Step 40
    Yes 'forty runs with everything up say nothing at all' ($script:said.Count -eq 0 -and @(Outbox).Count -eq 0)
    Yes 'and restart nothing' ($script:runs.Count -eq 0)

    # -- a service that goes down and stays down, then comes back -------------
    Box 'down-back'
    $g = $script:world['game']
    $g.Up = $false; $g.Restart = 'down'
    Step 1
    Yes 'the first run that finds the live game server down says so, once' ((Said 'The live game server is down') -eq 1 -and $script:said.Count -eq 1)
    $first = "$($script:said[0].Text)"
    Yes 'in plain words: what died, how it was found and when' (
        $first -match '^\*\*The live game server is down\.\*\* It is not answering on port 3000\. First noticed <t:\d+:f>\.')
    Yes 'and what the watchdog did about it' ($first -match 'restarted it and it is still not answering')
    Yes 'said by the bot, which is up' ((By 'bot') -eq 1 -and (By 'hook') -eq 0)
    Step 11
    Yes 'an hour more of it down says nothing more' ($script:said.Count -eq 1)
    Yes 'the three-strikes rule still stops the restarts at three an hour' (@($script:runs | Where-Object { $_ -eq 'Thornswood Server' }).Count -eq 3)
    Yes 'watch.log still has the watchdog''s own sentences' (
        (LogLines 'game is not answering\. Starting Thornswood Server') -eq 3 -and (LogLines 'needs a look') -ge 1)
    Yes 'and the message it told staff, the same words' ((LogLines 'told staff: The live game server is down\. It is not answering on port 3000\. First noticed 2026-09-28 12:05 VPS time') -eq 1)
    $g.Up = $true
    Step 1
    Yes 'one run answering is not yet back' ($script:said.Count -eq 1)
    Step 1
    Yes 'two runs answering is back, said once' ((Said 'The live game server is back') -eq 1 -and $script:said.Count -eq 2)
    Yes 'the back message says since when and for how long' (
        "$($script:said[1].Text)" -match '^\*\*The live game server is back\.\*\* Working normally since <t:\d+:f>, after about 60 minutes down \(first noticed <t:\d+:f>\)\.$')
    Step 20
    Yes 'and nothing after that' ($script:said.Count -eq 2)
    $ids = @(Outbox | ForEach-Object { $_.id })
    Yes 'each message in the outbox has its own id' ($ids.Count -eq 2 -and @($ids | Select-Object -Unique).Count -eq 2)
    Yes 'the outbox lines carry id, at, service, kind and text' (
        @(Outbox | Where-Object { $_.id -and $_.at -gt 0 -and $_.service -eq 'game' -and @('down', 'back') -contains $_.kind -and $_.text }).Count -eq 2)
    Yes 'no message was posted through the webhook while the bot was up' ((SentIn 'alerts-sent-webhook.txt').Count -eq 0 -and $script:hookTries -eq 0)

    # -- a crash the watchdog fixed --------------------------------------------
    Box 'fixed'
    $w = $script:world['website']
    $w.Up = $false; $w.Restart = 'up'
    Step 1
    Yes 'a crash the watchdog restarted is still told, once' ((Said 'The website''s app is down') -eq 1 -and $script:said.Count -eq 1)
    Yes 'saying the restart worked' ("$($script:said[0].Text)" -match 'restarted it and it answered again')
    Step 1
    Yes 'the next run answering is not yet back' ($script:said.Count -eq 1)
    Step 1
    Yes 'the one after says it is back' ((Said 'The website''s app is back') -eq 1 -and $script:said.Count -eq 2)

    # -- a native crash: watch.log and staff say so, and where the dump is (#1267)
    Box 'crashed'
    $d = $script:world['dev game']
    $d.Up = $false; $d.Restart = 'up'
    $d.Ended = 'its last run crashed with 0xC0000005 (an access violation); the newest dump since it started is C:\Thornswood-Dumps\node.exe.1496.dmp'
    Step 1
    Yes 'a dev server that crashed is logged as a crash with its code and dump, before the restart' (
        (LogLines 'dev game is not answering: its last run crashed with 0xC0000005 \(an access violation\); the newest dump since it started is C:\\Thornswood-Dumps\\node\.exe\.1496\.dmp\. Starting Thornswood Dev Server') -eq 1)
    Yes 'and staff are told it crashed, not only that it stopped answering' (
        (Said 'The dev game server is down\.\*\* It is not answering on port 7788, and its last run crashed with 0xC0000005 \(an access violation\); the newest dump') -eq 1)
    $d.Ended = ''
    Box 'not-crashed'
    $d = $script:world['dev game']
    $d.Up = $false; $d.Restart = 'up'
    Step 1
    Yes 'one that did not crash is logged as before' ((LogLines 'dev game is not answering\. Starting Thornswood Dev Server') -eq 1)

    # -- HowItEnded itself, against a pretend task and dumps folder -------------
    $script:taskInfo = $null
    function Get-ScheduledTaskInfo { param([string]$TaskName, $ErrorAction) return $script:taskInfo }
    $dumps = Join-Path $tmp 'dumps'
    New-Item -ItemType Directory -Force -Path $dumps | Out-Null
    . ([scriptblock]::Create($fns['HowItEnded'].Extent.Text))
    $start = (Get-Date).AddMinutes(-30)
    function Info($code) { $script:taskInfo = [pscustomobject]@{ LastTaskResult = $code; LastRunTime = $start } }
    Info 267009
    Yes 'a task still running has nothing to say' ((HowItEnded 'Thornswood Dev Server') -eq '')
    Info 0
    Yes 'nor one that exited clean' ((HowItEnded 'Thornswood Dev Server') -eq '')
    Info 1
    Yes 'any other code is said as it is' ((HowItEnded 'Thornswood Dev Server') -eq 'its last run ended with code 1 (0x00000001)')
    Info 267014
    Yes 'stopped by request with no hold is said as that (#5155)' ((HowItEnded 'Thornswood Dev Server') -eq 'it was stopped on purpose (0x00041306) and nobody left a hold, so it is started again as if it had stopped by itself')
    Info ([uint32]3221225477)
    Yes 'the access violation of 29 September, as Task Scheduler gives it, with no dump yet' (
        (HowItEnded 'Thornswood Dev Server') -eq ('its last run crashed with 0xC0000005 (an access violation); there is no dump since it started in ' + $dumps))
    Info ([int32]-1073741819)
    Yes 'the same code read signed is the same crash' ((HowItEnded 'Thornswood Dev Server') -match '^its last run crashed with 0xC0000005 \(an access violation\)')
    $old = Join-Path $dumps 'node.exe.1360.dmp'; Set-Content -LiteralPath $old -Value 'x'
    (Get-Item -LiteralPath $old).LastWriteTime = $start.AddDays(-1)
    $new = Join-Path $dumps 'node.exe.1496.dmp'; Set-Content -LiteralPath $new -Value 'x'
    (Get-Item -LiteralPath $new).LastWriteTime = $start.AddMinutes(10)
    Info ([uint32]3221225477)
    Yes 'a dump written since the run started is named, an older one is not' (
        (HowItEnded 'Thornswood Dev Server') -eq ('its last run crashed with 0xC0000005 (an access violation); the newest dump since it started is ' + $new))
    Info ([uint32]3221226505)
    Yes 'a fail fast is named too' ((HowItEnded 'Thornswood Dev Server') -match '^its last run crashed with 0xC0000409 \(a fail fast\)')
    $script:taskInfo = $null
    Yes 'a task that is not there has nothing to say' ((HowItEnded 'Thornswood Dev Server') -eq '')
    Remove-Item Function:\Get-ScheduledTaskInfo
    . ([scriptblock]::Create('function HowItEnded($task) { if ($tasks.ContainsKey($task)) { return $script:world[$tasks[$task]].Ended }; return '''' }'))

    # -- a service that flaps --------------------------------------------------
    Box 'flap'
    $v = $script:world['dev voice']
    $v.Restart = 'up'
    for ($i = 0; $i -lt 6; $i++) {
        $v.Up = $false
        Step 1
        $v.Up = $true
        Step 1
    }
    Yes 'down, up, down, up for an hour is one message' ((Said 'Dev voice is down') -eq 1 -and $script:said.Count -eq 1)
    Step 1
    Yes 'and back is said once it has stayed up two runs' ((Said 'Dev voice is back') -eq 1 -and $script:said.Count -eq 2)
    $v.Up = $false
    Step 1
    Yes 'a new outage after that is a new message' ((Said 'Dev voice is down') -eq 2 -and $script:said.Count -eq 3)

    # -- hung: the port answers, the health check does not ---------------------
    Box 'hung'
    $g = $script:world['game']
    $g.Health = 'did not answer within ten seconds'
    Step 1
    Yes 'one failed health check says nothing' ($script:said.Count -eq 0)
    Step 1
    Yes 'two in a row say it may be hung, once' ((Said 'The live game server is down') -eq 1 -and $script:said.Count -eq 1)
    Yes 'naming the address that did not answer' ("$($script:said[0].Text)" -match 'It answers on port 3000, but http://127\.0\.0\.1:3000/api/servers/thornswood/manifest\.json did not answer within ten seconds')
    Yes 'and saying nothing restarts it for this' ("$($script:said[0].Text)" -match 'does not restart it for this\. It may be hung')
    Step 6
    Yes 'half an hour more of it says nothing' ($script:said.Count -eq 1)
    Yes 'and a hung server is never restarted' ($script:runs.Count -eq 0)
    $g.Health = ''
    Step 2
    Yes 'answering again is back, once' ((Said 'The live game server is back') -eq 1 -and $script:said.Count -eq 2)
    Box 'blip'
    $script:world['voice'].Health = 'answered HTTP 503'
    Step 1
    $script:world['voice'].Health = ''
    Step 5
    Yes 'one slow answer between good ones says nothing at all' ($script:said.Count -eq 0)

    # -- the bot is the thing that is down -------------------------------------
    Box 'bot-down'
    $b = $script:world['bot']
    $b.Up = $false; $b.Restart = 'down'
    Step 1
    Yes 'the bot down is said through the webhook, at once' ((Said 'The Discord bot is down') -eq 1 -and (By 'hook') -eq 1 -and (By 'bot') -eq 0)
    Yes 'and restarted by its service''s name, never through a task (#465)' (@($script:runs | Where-Object { $_ -eq 'ThornswoodBot' }).Count -eq 1 -and @($script:runs | Where-Object { $_ -eq 'Thornswood Bot' }).Count -eq 0)
    Yes 'and marked as posted' ((SentIn 'alerts-sent-webhook.txt').Count -eq 1)
    Step 5
    Yes 'and not again' ($script:said.Count -eq 1)
    $script:world['voice'].Up = $false; $script:world['voice'].Restart = 'down'
    Step 1
    Yes 'something else dying while the bot is down goes through the webhook too' ((Said 'Live voice is down') -eq 1 -and (By 'hook') -eq 2)
    $b.Up = $true
    $script:world['voice'].Up = $true
    Step 2
    Yes 'the bot back is said by the bot, once' ((Said 'The Discord bot is back') -eq 1 -and @($script:said | Where-Object { $_.By -eq 'bot' -and $_.Text -match 'Discord bot is back' }).Count -eq 1)
    Yes 'and the bot does not say again what the webhook already said' ((Said 'The Discord bot is down') -eq 1 -and (Said 'Live voice is down') -eq 1)
    Step 3
    Yes 'the whole outage is four messages: two down, two back' ($script:said.Count -eq 4 -and (Said 'Live voice is back') -eq 1)
    $leak = $false
    foreach ($f in @('watch.log', 'alerts.jsonl', 'outages.txt', 'alerts-sent-bot.txt', 'alerts-sent-webhook.txt')) {
        $p = Join-Path $script:boxRoot $f
        if ((Test-Path -LiteralPath $p) -and ((Get-Content -LiteralPath $p -Raw) -match 'webhooks/|harness-not-a-real-token')) { $leak = $true }
    }
    Yes 'the webhook address is in none of the files the watcher writes' (-not $leak)

    # -- the bot is up but not posting -----------------------------------------
    Box 'bot-silent'
    $script:botHung = $true
    $script:world['dev game'].Up = $false; $script:world['dev game'].Restart = 'down'
    Step 1
    Yes 'while the bot is running it gets the first chance' ($script:said.Count -eq 0 -and $script:hookTries -eq 0)
    Step 1
    Yes 'one run later, still not posted, the webhook says it, once' ((Said 'The dev game server is down') -eq 1 -and (By 'hook') -eq 1)
    Step 3
    Yes 'and not again' ($script:said.Count -eq 1)
    $script:botHung = $false
    Step 1
    Yes 'when the bot wakes it does not say it again' ((Said 'The dev game server is down') -eq 1)

    # -- a webhook that fails ---------------------------------------------------
    Box 'hook-fails'
    $script:hookAnswer = 'HTTP 500'
    $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'down'
    Step 1
    Yes 'a failed post is not marked as posted' ($script:said.Count -eq 0 -and (SentIn 'alerts-sent-webhook.txt').Count -eq 0)
    Yes 'and says why in watch.log, without the address' ((LogLines 'could not post .* through the webhook: HTTP 500') -eq 1)
    Step 2
    Yes 'it is tried again every run' ($script:hookTries -eq 3)
    Yes 'and the failure is written once, not every run' ((LogLines 'could not post') -eq 1)
    $script:hookAnswer = ''
    Step 1
    Yes 'once the webhook answers, it is said once' ((Said 'The Discord bot is down') -eq 1 -and $script:said.Count -eq 1)
    Step 2
    Yes 'and not again' ($script:said.Count -eq 1)

    # -- no webhook at all ------------------------------------------------------
    Box 'no-hook' -NoHook
    $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'down'
    Step 3
    Yes 'with no webhook and the bot down, nothing is posted' ($script:said.Count -eq 0 -and $script:hookTries -eq 0)
    Yes 'and watch.log says it waits for the bot, once' ((LogLines 'there is no webhook in .* so it waits for the bot') -eq 1)
    $script:world['bot'].Up = $true
    Step 1
    Yes 'when the bot is back it says what it missed, once' ((Said 'The Discord bot is down') -eq 1 -and (By 'bot') -eq 1)
    Box 'bad-hook' -Hook 'https://example.com/not-a-webhook'
    $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'down'
    Step 2
    Yes 'a webhook file that is not a Discord webhook is never posted to' ($script:hookTries -eq 0)

    # -- a message a day old is not posted ----------------------------------------
    Box 'stale' -NoHook
    $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'down'
    Step 1
    $script:clock = $script:clock.AddHours(25)
    Set-Content -LiteralPath (Join-Path $script:boxRoot 'alerts-webhook.txt') -Value $script:goodHook -Encoding ASCII
    Step 1
    Yes 'a webhook set a day later does not post the day-old message' ((Said 'The Discord bot is down') -eq 0 -and $script:hookTries -eq 0)

    # -- something else on the box speaks through the same outbox (#449) ---------
    Box 'other'
    $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'down'
    Step 1
    $row = @{ id = 'wrapper-1'; at = ([DateTimeOffset]$script:clock).ToUnixTimeSeconds(); service = 'bot'; kind = 'note'; text = 'The bot stopped three times in a minute and its wrapper gave up.' } | ConvertTo-Json -Compress
    Add-Content -LiteralPath (Join-Path $script:boxRoot 'alerts.jsonl') -Value $row -Encoding ASCII
    Step 1
    Yes 'a line another script adds to the outbox is delivered the same way' ((Said 'its wrapper gave up') -eq 1)

    # -- told about, never restarted: backup, runner, disk -----------------------
    Box 'backup'
    $script:backupWhy = 'its last run, at 2026-09-28 03:15, ended with code 1'
    Step 1
    Yes 'a failed backup is told once, in words' ((Said '^\*\*The nightly backup is failing\.\*\* Its last run, at 2026-09-28 03:15, ended with code 1\. First noticed') -eq 1)
    Yes 'saying nothing restarts it' ("$($script:said[0].Text)" -match 'Nothing restarts this by itself')
    Step 10
    Yes 'and not again while it stays failed' ($script:said.Count -eq 1)
    Yes 'the backup is never run by the watcher' ($script:runs.Count -eq 0)
    $script:backupWhy = ''
    Step 2
    Yes 'working again is said once' ((Said 'The nightly backup is working again') -eq 1 -and $script:said.Count -eq 2)
    # The copy off the box (#2755): judged here from what Send-Backups.ps1
    # writes after each backup the Oracle VM took (#2862).
    Box 'offbox'
    $script:offboxWhy = 'the newest copy sent off this box is thornswood-20260926-031500.zip.enc, 56 hours old, and the line is 26'
    Step 1
    Yes 'an off-box copy out of date is told once, in words' ((Said '^\*\*The copy of the backups off the VPS is out of date\.\*\* The newest copy sent off this box is thornswood-20260926-031500\.zip\.enc, 56 hours old') -eq 1)
    Yes '  saying which task sends it and where its record is, not that nothing restarts it, and nothing about One' ("$($script:said[0].Text)" -match 'Thornswood Send Backups task' -and "$($script:said[0].Text)" -match 'Send-Backups -Status' -and "$($script:said[0].Text)" -notmatch 'Nothing restarts' -and "$($script:said[0].Text)" -notmatch '\bOne\b')
    Yes '  asking about offbox.txt in the watchdog''s own folder' ($script:offboxFile -eq (Join-Path $script:boxRoot 'offbox.txt'))
    Step 10
    Yes '  and not again while it stays behind' ($script:said.Count -eq 1)
    $script:offboxWhy = ''
    Step 2
    Yes '  up to date again is said once' ((Said 'The copy of the backups off the VPS is up to date again') -eq 1 -and $script:said.Count -eq 2)
    # The real OffBoxProblem, against real files: the age comes from the
    # stamp in the name, the box's own clock, not from the file's time.
    $ob = [scriptblock]::Create('param($f, $n) $now = $n' + "`n" + $fns['OffBoxProblem'].Extent.Text + "`n" + 'OffBoxProblem $f 26')
    $obFile = Join-Path $script:boxRoot 'offbox.txt'
    $obNow = New-Object DateTime (2026, 9, 28, 12, 0, 0)
    Yes 'OffBoxProblem: no offbox.txt says no copy has been sent off the box' ((& $ob $obFile $obNow) -match '^no copy has been sent off this box: there is no .*offbox\.txt')
    Set-Content -LiteralPath $obFile -Value 'notes' -Encoding ASCII
    Yes 'OffBoxProblem: a file that names no backup says so' ((& $ob $obFile $obNow) -match 'does not name a backup')
    Set-Content -LiteralPath $obFile -Value 'thornswood-20260927-031500.zip.enc' -Encoding ASCII
    Yes 'OffBoxProblem: a copy taken 32 hours ago is out of date, with its name and the line' ((& $ob $obFile $obNow) -eq 'the newest copy sent off this box is thornswood-20260927-031500.zip.enc, 32 hours old, and the line is 26')
    Set-Content -LiteralPath $obFile -Value 'thornswood-20260928-031500.zip.enc' -Encoding ASCII
    Yes 'OffBoxProblem: one taken this morning is fine' ((& $ob $obFile $obNow) -eq '')
    Set-Content -LiteralPath $obFile -Value 'thornswood-20260927-110000.zip' -Encoding ASCII
    Yes 'OffBoxProblem: 25 hours is inside the line, and a plain .zip counts' ((& $ob $obFile $obNow) -eq '')
    # Caddy's own certificate (#2995): from outside, Cloudflare's shows, so
    # the box asks its own 443 for Caddy's.
    Box 'cert'
    $script:certWhy = 'it runs out on 30 September 2026 03:00, in 1 day, and the line is 14'
    Step 1
    Yes 'Caddy''s certificate running out is told once, in words' ((Said '^\*\*The certificate Caddy holds for thornswood\.net needs a look\.\*\* It runs out on 30 September 2026 03:00, in 1 day') -eq 1)
    Yes '  saying where to look, and that 443 must still take Cloudflare' ("$($script:said[0].Text)" -match 'Caddy''s log in C:\\Thornswood-Caddy' -and "$($script:said[0].Text)" -match 'Set-WebFirewall\.ps1 -Check')
    Yes '  asking about the site''s own name' ($script:certAsked -eq 'https://thornswood.net/')
    Yes '  and restarting nothing for it' ($script:runs.Count -eq 0)
    $script:certWhy = ''
    Step 2
    Yes '  fine again is said once' ((Said 'The certificate Caddy holds for thornswood\.net is fine again') -eq 1 -and $script:said.Count -eq 2)
    # The real CertProblem and SiteAnswers, with what Caddy's 443 said stood in.
    $cp = [scriptblock]::Create('param($ans, $n) $now = $n; function AskCaddy($url) { return $ans }' + "`n" + $fns['CertProblem'].Extent.Text + "`n" + 'CertProblem ''https://thornswood.net/'' 14')
    $sa = [scriptblock]::Create('param($ans) function AskCaddy($url) { return $ans }' + "`n" + $fns['SiteAnswers'].Extent.Text + "`n" + 'SiteAnswers ''https://thornswood.net/''')
    $cpNow = New-Object DateTime (2026, 9, 28, 12, 0, 0)
    Yes 'CertProblem: 60 days left is fine' ((& $cp @{ Status = 200; NotAfter = $cpNow.AddDays(60); Problems = 'None'; Error = '' } $cpNow) -eq '')
    Yes 'CertProblem: 10 days left says when, and the line' ((& $cp @{ Status = 200; NotAfter = $cpNow.AddDays(10); Problems = 'None'; Error = '' } $cpNow) -eq 'it runs out on 8 October 2026 12:00, in 10 days, and the line is 14')
    Yes 'CertProblem: one that ran out says Cloudflare refuses the site' ((& $cp @{ Status = 200; NotAfter = $cpNow.AddDays(-1); Problems = 'None'; Error = '' } $cpNow) -match '^it ran out on 27 September 2026 12:00, so Cloudflare refuses')
    Yes 'CertProblem: one the trust store refuses says why' ((& $cp @{ Status = 200; NotAfter = $cpNow.AddDays(60); Problems = 'RemoteCertificateNameMismatch'; Error = '' } $cpNow) -match '^it is not accepted \(RemoteCertificateNameMismatch\)')
    Yes 'CertProblem: no handshake at all is the caddy check''s, so nothing here' ((& $cp @{ Status = 0; NotAfter = $null; Problems = ''; Error = 'nothing took a connection on 443' } $cpNow) -eq '')
    Yes 'SiteAnswers: a 502 from Caddy counts as Caddy up' ((& $sa @{ Status = 502; NotAfter = $cpNow; Problems = 'None'; Error = '' }) -eq $true)
    Yes 'SiteAnswers: nothing on 443 is Caddy down' ((& $sa @{ Status = 0; NotAfter = $null; Problems = ''; Error = 'nothing took a connection on 443' }) -eq $false)
    Yes 'SiteAnswers: a certificate a browser refuses is Caddy down, as it was with Invoke-WebRequest' ((& $sa @{ Status = 200; NotAfter = $cpNow; Problems = 'RemoteCertificateChainErrors'; Error = '' }) -eq $false)
    $ak = $fns['AskCaddy'].Extent.Text
    Yes 'AskCaddy asks this box''s own 443 with the name, not the name''s address (#2995)' ($ak -match "BeginConnect\('127\.0\.0\.1', 443" -and $ak -match 'AuthenticateAsClient\(\$u\.Host\)' -and $ak -match "Host: "" \+ \`$u\.Host" -and $ak -notmatch 'Invoke-WebRequest')
    Box 'runner'
    $script:runnerWhy = 'its Windows service is Stopped'
    Step 3
    Yes 'the build runner stopped is told once' ((Said 'The build runner .* is down\.\*\* Its Windows service is Stopped') -eq 1 -and $script:said.Count -eq 1)
    $script:runnerWhy = ''
    Step 2
    Yes 'and back once' ((Said 'The build runner .* is back') -eq 1 -and $script:said.Count -eq 2)
    Box 'disk'
    $script:diskPct = 15
    Step 1
    Yes 'a disk under twenty percent is told once' ((Said 'Free disk space on the VPS is running out\.\*\* It is low: 15% free') -eq 1)
    Step 5
    $script:diskPct = 5
    Step 5
    Yes 'going on to critical is the same outage: no second message' ($script:said.Count -eq 1)
    Yes 'but watch.log has DISK CRITICAL as before' ((LogLines 'DISK CRITICAL') -eq 1)
    $script:diskPct = 50
    Step 2
    Yes 'cleared, it is said once to be fine again' ((Said 'Free disk space on the VPS is fine again') -eq 1 -and $script:said.Count -eq 2)

    # -- Windows refusing the bot's service ------------------------------------------
    Box 'bot-refused'
    $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'refuse'
    Step 1
    Yes 'Windows refusing the bot''s service names the service' ((Said 'Windows would not restart its service, ThornswoodBot, which usually means the service is not installed') -eq 1)

    # -- what the messages look like ----------------------------------------------
    Box 'words'
    foreach ($n in @('caddy', 'website', 'game', 'voice', 'dev game', 'dev voice')) { $script:world[$n].Up = $false; $script:world[$n].Restart = 'refuse' }
    Step 1
    Yes 'Windows refusing a task is said too' ((Said 'Windows would not start its task, Thornswood Server') -eq 1)
    $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'down'
    $script:backupWhy = 'there is no backup in C:\Thornswood-Backup'
    $script:runnerWhy = 'its Windows service is not installed'
    $script:diskPct = 5
    Step 1
    $all = @(Outbox)
    Yes 'ten things down at once is ten messages' ($all.Count -eq 10)
    $bad = @($all | Where-Object {
        $_.text.Length -gt 1900 -or $_.text -match '[^\x00-\x7F]' -or $_.text -match '(?i)\bplayers?\b' -or $_.text -notmatch '<t:\d+:f>' })
    Yes 'every message is plain ASCII, under Discord''s limit, never says player, and has its time' ($bad.Count -eq 0)
    if ($bad.Count) { $bad | ForEach-Object { Write-Host ('      ' + $_.text) } }

    # -- a server stopped on purpose, held (#5155) ------------------------------------
    # Holds are written by ServerHold.ps1, the file every stopping script
    # sends, so this also holds the writer and the watcher's reader together.
    # The file's time is put on the fake clock, since the watcher takes two
    # hours from when it was written as the most a hold can be.
    . (Join-Path $Here '..\scripts\vps\ServerHold.ps1')
    function Hold([string]$target, [int]$minutes = 30) {
        $line = Set-ThornswoodHold -Target $target -Why 'swapping the merchant ledger' -By 'Deploy-Server.ps1 (harness)' -Minutes $minutes -Root $script:boxRoot
        $f = Get-ThornswoodHoldFile -Target $target -Root $script:boxRoot
        if (Test-Path -LiteralPath $f) { (Get-Item -LiteralPath $f).LastWriteTime = $script:clock }
        return $line
    }
    function HoldThere([string]$target) { return (Test-Path -LiteralPath (Get-ThornswoodHoldFile -Target $target -Root $script:boxRoot)) }
    function Restarted([string]$name) { return @($script:runs | Where-Object { $_ -eq $name }).Count }

    Box 'held'
    $g = $script:world['game']
    $line = Hold 'Thornswood Server'
    Yes 'a hold is written and said in one line' ($line -match '^held      Thornswood Server until \d\d:\d\d box time \(30 min\), by Deploy-Server\.ps1 \(harness\): swapping the merchant ledger$' -and (HoldThere 'Thornswood Server'))
    $g.Up = $false; $g.Restart = 'up'
    $script:world['dev game'].Up = $false; $script:world['dev game'].Restart = 'up'
    Step 5
    Yes 'a held server is not started for the whole of its hold' ((Restarted 'Thornswood Server') -eq 0)
    Yes '  and nothing is said about it' ((Said 'live game server') -eq 0)
    Yes '  and watch.log says each run who holds it and why' ((LogLines 'game is held by Deploy-Server\.ps1 \(harness\) until 2026-09-28 12:30 VPS time \(swapping the merchant ledger\), so it is left alone') -eq 5)
    Yes 'a server that is not held is still restarted straight away beside it' ((Restarted 'Thornswood Dev Server') -eq 1 -and (Said 'The dev game server is down') -eq 1)
    Step 1
    Yes 'when the hold runs out the server is started' ((Restarted 'Thornswood Server') -eq 1)
    Yes '  and the hold is taken away' (-not (HoldThere 'Thornswood Server'))
    Yes '  and staff are told once, who held it, why, until when, and that it answered' (
        (Said '^\*\*The hold on the live game server has run out\.\*\* Deploy-Server\.ps1 \(harness\) stopped it on purpose \(swapping the merchant ledger\) and held it from <t:\d+:f> until <t:\d+:f>\. The watchdog started it and it answered again\.$') -eq 1)
    Yes '  and that is the only message about it: no down, no back' ((Said 'live game server') -eq 1)
    Yes '  in the outbox as its own kind, which availability does not count as an outage' (@(Outbox | Where-Object { $_.service -eq 'game' -and $_.kind -eq 'hold' }).Count -eq 1 -and @(Outbox | Where-Object { $_.service -eq 'game' -and $_.kind -ne 'hold' }).Count -eq 0)
    Yes '  and the start does not count towards the three restarts an hour' (-not ((Get-Content -LiteralPath (Join-Path $script:boxRoot 'restarts.txt') -Raw) -match '\|game'))
    Step 6
    Yes '  and nothing more is said' ((Said 'live game server') -eq 1)

    # The deploy that wrote the hold starts the server and takes the hold away.
    Box 'held-cleared'
    $g = $script:world['game']
    $null = Hold 'Thornswood Server'
    $g.Up = $false; $g.Restart = 'up'
    Step 2
    $g.Up = $true
    $c = Clear-ThornswoodHold -Target 'Thornswood Server' -Root $script:boxRoot
    Yes 'taking a hold away says so' ($c -eq 'released  Thornswood Server, the watchdog watches it again' -and -not (HoldThere 'Thornswood Server'))
    Yes 'taking away one that is not there says so too' ((Clear-ThornswoodHold -Target 'Thornswood Server' -Root $script:boxRoot) -eq 'no hold   Thornswood Server to take away')
    Step 12
    Yes 'a stop held and started again by its own script is never started by the watchdog, and nothing is said' ((Restarted 'Thornswood Server') -eq 0 -and $script:said.Count -eq 0)
    $g.Up = $false; $g.Restart = 'up'
    Step 1
    Yes 'once the hold is gone a crash is restarted straight away, as before' ((Restarted 'Thornswood Server') -eq 1 -and (Said 'The live game server is down') -eq 1)

    # A hold left behind by a script that started the server and forgot it.
    Box 'held-left'
    $null = Hold 'Thornswood Dev Server'
    Step 6
    Yes 'a hold left behind on a running server is taken away when it runs out' (-not (HoldThere 'Thornswood Dev Server') -and (Restarted 'Thornswood Dev Server') -eq 0)
    Yes '  and staff are told once that it was left behind' ((Said '^\*\*The hold on the dev game server has run out\.\*\* .* It was already running, so whoever stopped it started it again and left the hold behind\. The watchdog took the hold away\.$') -eq 1 -and $script:said.Count -eq 1)

    # A held server that does not come back when its hold runs out.
    Box 'held-stuck'
    $g = $script:world['game']
    $null = Hold 'Thornswood Server'
    $g.Up = $false; $g.Restart = 'down'
    Step 6
    Yes 'a held server that does not answer when started says so in the hold''s message' ((Said 'The hold on the live game server has run out\.\*\* .*The watchdog started it and it is not answering\. From here it is watched like any server that is down\.$') -eq 1)
    Yes '  and is then a server that is down like any other, told once' ((Said '^\*\*The live game server is down\.\*\* It is not answering on port 3000\.') -eq 1 -and $script:said.Count -eq 2)
    Yes '  without saying it was stopped by request, which is what the hold''s own stop left' ((Said 'stopped on purpose \(0x') -eq 0)
    Step 12
    Yes '  and restarted under the three an hour after that, the hold''s start not counted' ((Restarted 'Thornswood Server') -eq 4)

    # Two hours at most, whatever the file says.
    Box 'held-most'
    New-Item -ItemType Directory -Force -Path (Join-Path $script:boxRoot 'holds') | Out-Null
    $hf = Get-ThornswoodHoldFile -Target 'Thornswood Voice' -Root $script:boxRoot
    $at = ([DateTimeOffset]$script:clock).ToUnixTimeSeconds()
    Set-Content -LiteralPath $hf -Value (ConvertTo-Json @{ target = 'Thornswood Voice'; by = 'a run note'; why = 'testing'; set = $at; until = ($at + 10 * 3600) } -Compress) -Encoding ASCII
    (Get-Item -LiteralPath $hf).LastWriteTime = $script:clock
    $script:world['voice'].Up = $false; $script:world['voice'].Restart = 'up'
    Step 23
    Yes 'a hold that says ten hours holds for two hours' ((Restarted 'Thornswood Voice') -eq 0)
    Step 1
    Yes '  and no longer' ((Restarted 'Thornswood Voice') -eq 1 -and (Said 'The hold on live voice has run out') -eq 1)
    Yes 'Set-ThornswoodHold itself writes two hours at most' ((Hold 'Thornswood Voice' 600) -match '\(120 min\)')
    Yes '  and a minute at least' ((Hold 'Thornswood Voice' 0) -match '\(1 min\)')

    # A hold file that does not read still holds, for the usual thirty minutes.
    Box 'held-bad'
    New-Item -ItemType Directory -Force -Path (Join-Path $script:boxRoot 'holds') | Out-Null
    $hf = Get-ThornswoodHoldFile -Target 'Thornswood Docs' -Root $script:boxRoot
    Set-Content -LiteralPath $hf -Value 'half a file' -Encoding ASCII
    (Get-Item -LiteralPath $hf).LastWriteTime = $script:clock
    $script:world['website'].Up = $false; $script:world['website'].Restart = 'up'
    Step 5
    Yes 'a hold file that does not read holds for thirty minutes' ((Restarted 'Thornswood Docs') -eq 0)
    Step 1
    Yes '  then the server is started and the message says the file did not read' ((Restarted 'Thornswood Docs') -eq 1 -and (Said 'somebody stopped it on purpose \(its hold file does not read\)') -eq 1)

    # The bot, a Windows service, is held by its service's name.
    Box 'held-bot'
    $null = Hold 'ThornswoodBot' 10
    $script:world['bot'].Up = $false; $script:world['bot'].Restart = 'up'
    Step 1
    Yes 'a held bot is not restarted' ((Restarted 'ThornswoodBot') -eq 0)
    Step 1
    Yes '  until its hold runs out' ((Restarted 'ThornswoodBot') -eq 1 -and (Said 'The hold on the Discord bot has run out') -eq 1)

    # A hold on something the watchdog does not watch goes when it runs out.
    Box 'held-other'
    $null = Hold 'Thornswood Gate'
    Step 5
    Yes 'a hold on something not watched stays while it runs' (HoldThere 'Thornswood Gate')
    Step 1
    Yes '  and is taken away once it has run out, saying so in watch.log' (-not (HoldThere 'Thornswood Gate') -and (LogLines 'took away the hold on Thornswood-Gate by Deploy-Server\.ps1 \(harness\)') -eq 1 -and $script:said.Count -eq 0)

    # No watchdog folder, no hold.
    Yes 'with no watchdog folder there is nothing to hold, and it says so' (
        (Set-ThornswoodHold -Target 'Thornswood Server' -Why 'x' -Root (Join-Path $tmp 'no-such-box')) -match '^no hold   Thornswood Server: there is no ')

    # -- the outbox does not grow forever -------------------------------------------
    Box 'trim'
    $script:world['game'].Up = $false; $script:world['game'].Restart = 'down'
    Step 1
    $script:clock = $script:clock.AddDays(3)
    $script:world['game'].Up = $true
    Step 1
    Yes 'messages older than two days leave the outbox' (@(Outbox | Where-Object { $_.kind -eq 'down' }).Count -eq 0)
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) $false
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}

Done
