<#
  Watch-Services.ps1

      .\scripts\vps\Watch-Services.ps1            what the watcher has seen lately
      .\scripts\vps\Watch-Services.ps1 -Install   put the watcher on the server
      .\scripts\vps\Watch-Services.ps1 -Remove    take it off again
      .\scripts\vps\Watch-Services.ps1 -SetWebhook  where messages go when the bot is down

  Everything runs on one box now. The website, the game, the bot and the voice
  server are four things that can stop on their own, and nothing up there
  notices when one does. Somebody turns up, cannot get in, and the first you
  hear about it is a message in Discord hours later.

  This puts a small watcher on the server that looks at all of them every
  five minutes and starts back up whatever is not answering.

  It will not fight a service that is properly broken. Three restarts of the
  same thing inside an hour and it stops trying and writes that it needs a
  look, because a thing that crashes on startup restarted forever is a thing
  nobody ever finds out about.

  It leaves alone a server somebody stopped on purpose (#5155). Whoever stops
  one leaves a hold beside it, holds\<task or service>.json in this folder,
  saying who, why and until when: 30 minutes unless they say, 2 hours at most
  (ServerHold.ps1 writes it; every script that stops a server on purpose
  sends it, and Hold-Server.ps1 is the same for a stop by hand). While the
  hold runs this neither starts that server nor says anything about it. When
  it runs out this takes it away, says once in #staff-updates who held it and
  why, and starts the server. With no hold, a server that is not answering is
  started straight away, as before. Until then a stop on purpose was started
  again within five minutes: the live server at 4:01 PM on 31 Oct 2026, in
  the middle of a merchant ledger swap.

  Somebody is told (issue #447). Each run decides, for everything it watches,
  whether it is down, and keeps that in outages.txt. The first run that finds
  a thing down writes ONE message saying what died and when; the message
  saying it is back comes once it has answered on two runs in a row, so a
  service that flaps is one outage and two messages, not two every five
  minutes. A thing that answers on its port but fails its health check is
  told about after two runs in a row, and is never restarted for it.

  The messages go into alerts.jsonl beside watch.log, one JSON line each (id,
  at, service, kind, text), and the same sentence goes into watch.log. The
  bot on this box reads alerts.jsonl every minute and posts each one in
  #staff-updates, the channel whose id is in bot\staff-channel.txt
  (watch_services in bot\bot.py), writing its id to alerts-sent-bot.txt.
  When the bot is not running, or has not posted one within two and a half
  minutes, this posts it itself through a Discord webhook whose address is in
  alerts-webhook.txt in this folder on the VPS, and writes its id to
  alerts-sent-webhook.txt. That file is put there by -SetWebhook, never
  committed, never printed, never logged. With no webhook set, a message
  waits for the bot.

  The webhook has to be one made in #staff-updates, or the bot and the
  webhook say the same outages in two different channels. -SetWebhook asks
  Discord where a pasted webhook points and refuses any other channel, and
  the report this prints with no switch says where the one on the box points
  (#2501: until 12 Oct nothing checked, and the bot itself was saying the
  watchdog's messages in the dev updates channel).

  Anything else on this box that needs to tell staff something (the bot's own
  wrapper, issue #449) appends a line of the same shape to alerts.jsonl and
  this delivers it the same way. Watch-Outside.ps1, which asks from outside
  (issue #448), runs on GitHub's runners since #2755 and posts through the
  same webhook itself, because a runner cannot reach this box over ssh.
  tests\test-watch-alerts.ps1 drives the real
  code below against fakes: down, back, flapping, the bot down, a webhook
  that fails. bot\tests\test-watch-services.py reads what that harness writes.

  What it checks:
    caddy     https://thornswood.net answers, which is the only one of these
              a visitor actually touches. Asked with the public name and its
              certificate on purpose: on 21 September Caddy was stopped for
              hours while node sat there answering 3001 perfectly, and a
              check of 3001 says everything is fine right through that.
              Asked of this box's own 443, not through the name, since the
              name is Cloudflare's (#2995) and Cloudflare answers 521 itself
              when Caddy is gone
    website   answers on 3001, which is what Caddy puts on 443
    game      answers on 3000, which is the resources the client pulls
    voice     answers on 7778
    bot       the python the ThornswoodBot service started is alive (#3189).
              And its heartbeat, C:\Thornswood-Bot\data\heartbeat.json, says it is on
              Discord: a bot hung or off Discord for ten minutes while its
              process runs is down too (issue #449). That file is written once
              Install-Bot.ps1 -NoToken has run. The bot is the Windows
              service ThornswoodBot (issue #465), so either way it is
              restarted by that name, under the same three an hour
    dev game  answers on 7788, the dev server's resources port
    dev voice answers on 7789
    bridge    answers on 7790, the ssh bridge (#2753), which is the only way
              into the box over ssh once port 22 takes no outside address
              (#2891). Down, it locks everybody out but the VNC console, so
              it is restarted like the rest
    disk      free space on C:, which every one of the above shares. Under
              twenty percent it writes DISK LOW, under ten DISK CRITICAL,
              once when the line is crossed and once when it comes back. It
              restarts nothing for it, because a restart frees nothing.

  And, told about but never restarted:
    health    the site, both game servers and both voice servers are also
              asked over HTTP, because a hung node process still accepts a
              connection (the kernel does that) and the port check above
              cannot tell hung from idle. That was the 18 September case.
    backup    the Thornswood Backup task's last result, and a backup file in
              C:\Thornswood-Backup less than 26 hours old
    offbox    the copy of the backups off this box is less than 26 hours
              old: the newest backup the Oracle VM took from
              Send-Backups.ps1, by the name it writes into offbox.txt in
              this folder after each one (#2755, #2862). Judged here, so a
              copy that stopped going is told about
    runner    every build runner's Windows service is running: the first,
              thornswood-vps, and the numbered ones Install-Runner.ps1
              -Number puts beside it (4 October)
    cert      the certificate Caddy holds for thornswood.net is accepted
              and has more than 14 days left. Caddy renews it about 30 days
              before the end, so under 14 is a renewal failing for two weeks.
              Watch-Outside.ps1 asked this until #2995; from outside it now
              sees Cloudflare's own certificate, and only this box can still
              reach Caddy's

  The two dev ones are here because the box has been watching them since 16
  September and this file did not know. vps-dev-instance.ps1, which runs ON
  the VPS, used to append them to the installed watch.ps1 in place. So the
  copy up there watched six things, the copy here watched four, and -Install
  would have written the shorter list over the longer one and taken the dev
  server and dev voice off the watchdog with nothing said. This list is the
  one place they live now: vps-dev-instance.ps1 writes nothing into watch.ps1
  and only says whether the installed one has them (issue #1106).

  The game's own traffic is UDP on 7777 and there is nothing to connect to, so
  3000 stands in for it. They are the same process, so if one is gone both are.
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Root = 'C:\Thornswood-Watch',
  [string]$Task = 'Thornswood Watch',
  [int]$Lines   = 25,
  [switch]$Install,
  [switch]$Remove,
  [switch]$SetWebhook,
  [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Vps.ps1')
# #staff-updates, by id, from the file the bot reads (bot\staff-channel.txt):
# the one channel the watchdog's messages belong in, from the bot or from the
# webhook. Not a secret. '' when the file is missing or empty.
$staffFile = Join-Path $Here '..\..\bot\staff-channel.txt'
$StaffChannel = ''
if (Test-Path -LiteralPath $staffFile) { $StaffChannel = ("$(Get-Content -LiteralPath $staffFile -Raw)").Trim() }
if ($StaffChannel -notmatch '^\d{17,20}$') { $StaffChannel = '' }
. (Join-Path $Here 'Send-Script.ps1')
. (Join-Path $Here 'Lock-Folder.ps1')
. (Join-Path $Here 'ServerHold.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

Write-Host ''
Write-Host '  THORNSWOOD  -  keep the services up' -ForegroundColor White

# The watcher itself. Single quoted, so nothing in here is touched on the way
# up. It goes to the server as base64 and is written out there as a file,
# which keeps every quote and backslash exactly as written.
$watcher = @'
$ErrorActionPreference = 'Continue'
$root = 'C:\Thornswood-Watch'
$log  = Join-Path $root 'watch.log'
$hist = Join-Path $root 'restarts.txt'
if (-not (Test-Path $root)) { $null = New-Item -ItemType Directory -Path $root -Force }

function Note($line) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -LiteralPath $log -Value ($stamp + '  ' + $line)
}

function Answers($port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $ok = $c.BeginConnect('127.0.0.1', $port, $null, $null).AsyncWaitHandle.WaitOne(3000)
    $up = $ok -and $c.Connected
    $c.Close()
    return $up
  } catch { return $false }
}

# Caddy holds 443 and is the only thing here a visitor touches. It is asked
# with the public name and its certificate rather than over a plain loopback
# port, because the failure this is for looks perfect from inside: on 21
# September Caddy was stopped and staying stopped while node answered 3001
# all night.
#
# STRAIGHT AT THIS BOX'S 443, NOT THROUGH THE NAME (#2995). The name is
# Cloudflare's, and with Caddy gone Cloudflare itself answers 521, which
# counted as an answer, so asked through the name a dead Caddy looked up
# and was never started again. So this connects to 127.0.0.1:443, asks for
# the name's certificate by SNI and checks it the way a browser does, and
# asks for the page with the name as Host.
#
# Status is the HTTP status (0 for none), NotAfter when the certificate runs
# out (local time), Problems what the trust store says of it ('None' when it
# takes it) and Error, in words, why there was no answer.
function AskCaddy($url) {
  $r = @{ Status = 0; NotAfter = $null; Problems = ''; Error = '' }
  $u = [uri]$url
  $c = $null; $s = $null
  $seen = @{ E = 'None' }
  try {
    $c = New-Object Net.Sockets.TcpClient
    if (-not $c.BeginConnect('127.0.0.1', 443, $null, $null).AsyncWaitHandle.WaitOne(5000) -or -not $c.Connected) { $r.Error = 'nothing took a connection on 443'; return $r }
    $cb = { param($a, $b, $d, $e) $seen.E = '' + $e; return $true }.GetNewClosure()
    $s = New-Object Net.Security.SslStream($c.GetStream(), $false, [Net.Security.RemoteCertificateValidationCallback]$cb)
    $s.ReadTimeout = 10000; $s.WriteTimeout = 10000
    $s.AuthenticateAsClient($u.Host)
    $r.NotAfter = (New-Object Security.Cryptography.X509Certificates.X509Certificate2($s.RemoteCertificate)).NotAfter
    $r.Problems = $seen.E
    $q = [Text.Encoding]::ASCII.GetBytes('HEAD ' + $u.PathAndQuery + " HTTP/1.1`r`nHost: " + $u.Host + "`r`nUser-Agent: Thornswood-Watch`r`nConnection: close`r`n`r`n")
    $s.Write($q, 0, $q.Length)
    $s.Flush()
    $line = (New-Object IO.StreamReader($s, [Text.Encoding]::ASCII)).ReadLine()
    if ("$line" -match '^HTTP/\d(\.\d)? (\d{3})') { $r.Status = [int]$Matches[2] }
    else { $r.Error = 'it answered on 443 without an HTTP status' }
  } catch { $r.Error = 'no TLS handshake or no answer on 443' }
  finally {
    if ($s) { $s.Dispose() }
    if ($c) { $c.Close() }
  }
  return $r
}

# ANY HTTP ANSWER COUNTS, including a 502. A 502 is Caddy up and something
# behind it down, and what is behind it has its own check on the line below.
# Treating a 502 as Caddy being down would restart the wrong thing. A
# certificate a browser would refuse does not count, as it did not when this
# was Invoke-WebRequest.
function SiteAnswers($url) {
  $a = AskCaddy $url
  return ($a.Status -gt 0 -and $a.Problems -eq 'None')
}

# '' when the certificate Caddy holds for the name is accepted and has more
# than $days left, else why not. Caddy not answering at all is the caddy
# check's to tell, so that is '' here.
function CertProblem($url, $days) {
  $a = AskCaddy $url
  if (-not $a.NotAfter) { return '' }
  $when = $a.NotAfter.ToString('d MMMM yyyy HH:mm', [Globalization.CultureInfo]::InvariantCulture)
  if ($a.Problems -ne 'None') { return ('it is not accepted (' + $a.Problems + '). It runs out ' + $when) }
  $left = ($a.NotAfter - $now).TotalDays
  if ($left -le 0) { return ('it ran out on ' + $when + ', so Cloudflare refuses the site to everybody (526)') }
  if ($left -le $days) { $d = [math]::Floor($left); return ('it runs out on ' + $when + ', in ' + $d + ' day' + $(if ($d -eq 1) { '' } else { 's' }) + ', and the line is ' + $days) }
  return ''
}

# The bot is the python the ThornswoodBot service started, nothing else
# (#3189). Any python with Thornswood-Bot in its command line used to count,
# so a harness on a runner that runs a stand-in bot from a folder of that name
# (test-bot-service.ps1 and others) was the bot too, for as long as it ran.
function BotPythons() {
  $svc = Get-CimInstance Win32_Service -Filter "Name = 'ThornswoodBot'" -EA SilentlyContinue
  if (-not $svc -or -not $svc.ProcessId) { return @() }
  return @(Get-CimInstance Win32_Process -Filter ("Name = 'python.exe' AND ParentProcessId = " + [int]$svc.ProcessId) -EA SilentlyContinue)
}

function BotAlive() {
  return (@(BotPythons).Count -gt 0)
}

# ------------------------------------------------ the bot's heartbeat ---
#
# A live python under the bot's service is not a bot that is
# working (issue #449). It can be stuck logging in, hung, or cut off from
# Discord and never getting back, and in every one of those it is still
# running. So the bot writes heartbeat.json in its data folder every minute
# (heartbeat in bot\bot.py): its pid, when it started, when it wrote this,
# whether it is connected to Discord, when it last was, and when it last
# handled something Discord sent it. More than $beatStale seconds of any of
# those going quiet is the bot being down while its process is alive.
#
# Since issue #465 the bot is the service ThornswoodBot, which stops python
# and everything it started when it is stopped, so a hung bot is restarted by
# that name like a bot whose process is gone, under the same three restarts
# an hour. Nothing here reads a command line to stop anything.
#
# No file at all says nothing either way: that is a bot from before this
# went in, and the process check above is all there is for it.
#
# In data under the bot's folder since #1104, the one folder the bot's account
# may write; the code beside it is read only to it.
$botBeat = 'C:\Thornswood-Bot\data\heartbeat.json'
# Ten minutes. The bot writes every minute and discord.py reconnects by
# itself within a few, so ten is well past a blip and still inside two runs.
$beatStale = 600

# Every running bot process: its pid and when it started, in unix seconds.
function BotProcs() {
  $list = @()
  foreach ($p in @(BotPythons)) {
    $at = 0
    try { $at = ([DateTimeOffset]$p.CreationDate).ToUnixTimeSeconds() } catch { }
    $list += @{ Id = [int64]$p.ProcessId; Started = [int64]$at }
  }
  return $list
}

# heartbeat.json as an object, or $null when it is not there or not readable.
function ReadBeat($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 -EA Stop | ConvertFrom-Json) } catch { return $null }
}

function Mins($s) {
  $m = [math]::Round([double]$s / 60)
  if ($m -lt 2) { return 'a minute' }
  return ('' + $m + ' minutes')
}

# '' when the heartbeat says the bot is working, else what is wrong in words.
# $beat is heartbeat.json or $null, $procs what BotProcs found, $at now in
# unix seconds. Nothing in here looks at the world, so it can be tested.
function BeatProblem($beat, $procs, $at) {
  $procs = @($procs)
  if ($procs.Count -eq 0 -or $null -eq $beat) { return '' }
  $mine = $false
  $young = [int64]::MaxValue
  foreach ($p in $procs) {
    if ([int64]$p.Id -eq [int64]$beat.pid) { $mine = $true }
    if ([int64]$p.Started -gt 0 -and $at - [int64]$p.Started -lt $young) { $young = $at - [int64]$p.Started }
  }
  $heard = ''
  if ([int64]$beat.last_event -gt 0) { $heard = '. The last thing it heard from Discord was ' + (Mins ($at - [int64]$beat.last_event)) + ' ago' }
  if (-not $mine) {
    # Every heartbeat there is came from an earlier run, so this one has not
    # written one yet: fine while it is starting, stuck once it is old. A
    # process Windows gave no start time for is not judged on its age.
    if ($young -le $beatStale -or $young -eq [int64]::MaxValue) { return '' }
    return ('Its python process has been running for ' + (Mins $young) + ' and has not written a heartbeat once, so it is stuck before it got going')
  }
  $quiet = $at - [int64]$beat.written
  if ($quiet -gt $beatStale) { return ('Its python process is running, but its heartbeat stopped ' + (Mins $quiet) + ' ago, so it is hung' + $heard) }
  if ($beat.connected) { return '' }
  if ([int64]$beat.connected_at -le 0) {
    $off = $at - [int64]$beat.started
    if ($off -gt $beatStale) { return ('Its python process is running, but it has not reached Discord in the ' + (Mins $off) + ' since it started') }
    return ''
  }
  $off = $at - [int64]$beat.connected_at
  if ($off -gt $beatStale) { return ('Its python process is running, but it has not been connected to Discord for ' + (Mins $off) + $heard) }
  return ''
}

# The one question the checks and the webhook both ask.
function BotSilent($path) {
  return (BeatProblem (ReadBeat $path) (BotProcs) ([DateTimeOffset](Get-Date)).ToUnixTimeSeconds())
}

# ---------------------------------------------------- telling a person ---
#
# Everything below up to the checks is how a person hears about it (#447).
# The header of Watch-Services.ps1 says the whole of it; the short form:
# outages.txt remembers what is down, alerts.jsonl is the outbox the bot
# posts from, and the webhook in alerts-webhook.txt is for when the bot
# cannot. One message when a thing goes down, one when it is back.
$outages  = Join-Path $root 'outages.txt'
$alerts   = Join-Path $root 'alerts.jsonl'
$sentBot  = Join-Path $root 'alerts-sent-bot.txt'
$sentHook = Join-Path $root 'alerts-sent-webhook.txt'
$hookFile = Join-Path $root 'alerts-webhook.txt'
# Two runs in a row before a failed health check counts, because one slow
# answer under load is not an outage.
$healthMisses = 2
# Two runs in a row answering before it is said to be back, so a service
# that comes up and falls over again is still the same outage.
$backAfter = 2
# How long the bot has to post a message before this posts it instead.
$ackWait = 150
# A message older than this is not posted at all: a day late is noise.
$alertMaxAge = 24 * 3600
$hookRx = '^https://((ptb|canary)\.)?discord(app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]+$'
$now = Get-Date

function UnixTime($t) { return ([DateTimeOffset]$t).ToUnixTimeSeconds() }

# ------------------------------------------------------------- holds ---
#
# A server stopped on purpose leaves a hold beside it (#5155, Patrick's answer
# A on 31 Oct 2026): holds\<its task or service name>.json in this folder,
# written by ServerHold.ps1, which every script that stops a server on purpose
# sends with its stop, and Hold-Server.ps1 for a stop by hand. While a hold
# runs this leaves that server alone: no start, no message. When it runs out
# this takes it away, tells staff once and starts the server. A server with no
# hold that is not answering is started straight away, as before.
#
# The most a hold can be is two hours from when its file was written, whatever
# it says, so a hold written wrong cannot keep a server down for longer. A
# file that does not read is a hold too, of the usual thirty minutes from when
# it was written: somebody meant to hold it, and thirty minutes is what they
# would have had without saying. tests\test-5155-server-holds.ps1 writes holds
# with ServerHold.ps1 and reads them with this, so the two agree.
$holdDir   = Join-Path $root 'holds'
$holdUsual = 30
$holdMost  = 120

function HoldFile($target) {
  return (Join-Path $holdDir ((($target -replace '[^A-Za-z0-9]+', '-').Trim('-')) + '.json'))
}

# $null when nothing holds it, else who, why, from when, until when, whether
# it has run out, and its file.
function ReadHold($target) {
  $f = HoldFile $target
  $item = Get-Item -LiteralPath $f -EA SilentlyContinue
  if (-not $item) { return $null }
  $wrote = $item.LastWriteTime
  $h = @{ File = $f; By = 'somebody'; Why = 'its hold file does not say why'; Set = $wrote; Until = $wrote.AddMinutes($holdUsual) }
  $j = $null
  try { $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json } catch { $j = $null }
  if ($j) {
    if ("$($j.by)".Trim()) { $h.By = "$($j.by)".Trim() }
    if ("$($j.why)".Trim()) { $h.Why = "$($j.why)".Trim() }
    # A time that is not a number of seconds is left as the file's own time.
    $n = [int64]0
    if ([int64]::TryParse("$($j.set)", [ref]$n) -and $n -gt 0 -and $n -lt 253402300799) { $h.Set = [DateTimeOffset]::FromUnixTimeSeconds($n).LocalDateTime }
    $n = [int64]0
    if ([int64]::TryParse("$($j.until)", [ref]$n) -and $n -gt 0 -and $n -lt 253402300799) { $h.Until = [DateTimeOffset]::FromUnixTimeSeconds($n).LocalDateTime }
  } else { $h.Why = 'its hold file does not read' }
  $most = $wrote.AddMinutes($holdMost)
  if ($h.Until -gt $most) { $h.Until = $most }
  $h.Over = ($now -ge $h.Until)
  return $h
}

# A check's name for itself in the middle of a sentence: 'the live game server'.
function Lower($s) { return ($s.Substring(0, 1).ToLower() + $s.Substring(1)) }

# The one message when a hold runs out: who held it, why, until when, and
# what the watchdog did, in $after.
function TellHold($c, $h, $after) {
  $head = 'The hold on ' + (Lower $c.Say) + ' has run out.'
  $plain = $h.By + ' stopped it on purpose (' + $h.Why + ') and held it from '
  $discord = $plain + (Shown $h.Set $true) + ' until ' + (Shown $h.Until $true) + '. ' + $after
  $plain = $plain + (Shown $h.Set $false) + ' until ' + (Shown $h.Until $false) + '. ' + $after
  Tell $c 'hold' $head $discord $plain
}

# What the watchdog did once a hold ran out, said after who held it.
function HoldWords($how) {
  switch ($how) {
    'running' { return 'It was already running, so whoever stopped it started it again and left the hold behind. The watchdog took the hold away.' }
    'back'    { return 'The watchdog started it and it answered again.' }
    'stuck'   { return 'The watchdog started it and it is not answering. From here it is watched like any server that is down.' }
    'refused' { return 'Windows would not start it. From here it is watched like any server that is down.' }
    'gaveup'  { return 'The watchdog has already restarted it three times this hour, so it did not start it. It needs a person.' }
  }
  return ''
}

# '' when the address answers over HTTP within ten seconds, else why not.
# Any answer under 500 counts: the process is alive and answering.
function HealthProblem($url) {
  try {
    $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
    return ''
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($code -gt 0 -and $code -lt 500) { return '' }
    if ($code -gt 0) { return ('answered HTTP ' + $code) }
    $st = ''
    try { $st = '' + $_.Exception.Status } catch { }
    if ($st -eq 'Timeout') { return 'did not answer within ten seconds' }
    return 'could not be reached'
  }
}

# '' when every service matching the name is running, else why not. Where
# the name matches several, the build runners, it says which are not.
#
# A service set to start "Automatic (Delayed Start)", as the build runners
# are, is Stopped for the first minutes after a boot: Windows starts those one
# by one after the automatic ones, and on this box the last runner came up
# about ten minutes after a start (21 Oct 2026). Until the box has been up
# $delayedGrace seconds such a service is still starting, not down (#3217:
# every restart told staff the runners needed a person, 1 min 40 s after it).
$delayedGrace = 15 * 60
function StillStarting($svc) {
  if ("$($svc.Status)" -ne 'Stopped' -and "$($svc.Status)" -ne 'StartPending') { return $false }
  if ("$($svc.StartType)" -ne 'Automatic') { return $false }
  $d = Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\' + $svc.Name) -Name DelayedAutostart -EA SilentlyContinue
  if (-not $d -or [int]$d.DelayedAutostart -ne 1) { return $false }
  $up = ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds
  return ($up -lt $delayedGrace)
}
# How the last run of a task that is not running ended, in words, or ''
# while it runs (267009), before its first run (267011) or after a clean
# exit (#1267). An exit code of 0xC0000000 and up is a Windows exception
# code: the game server's node died of a native crash, and since scam_native
# turns Windows Error Reporting back on (the fork's CrashReporting.h) Windows
# writes its dump into C:\Thornswood-Dumps, which LocalDumps names for
# node.exe. The newest dump written since the run started is named (any
# node.exe's, so with two crashes at once it may be the other's), so
# watch.log and staff read crash and where to look, not only "not answering".
$dumps = 'C:\Thornswood-Dumps'
function HowItEnded($task) {
  $i = Get-ScheduledTaskInfo -TaskName $task -EA SilentlyContinue
  if (-not $i) { return '' }
  # LastTaskResult can come back signed. Decimal throughout: PowerShell reads
  # 0xC0000000 as a negative Int32.
  $code = [int64]$i.LastTaskResult
  if ($code -lt 0) { $code += 4294967296 }
  if (@(0, 267009, 267011) -contains $code) { return '' }
  $hex = '0x' + $code.ToString('X8')
  # 0x00041306 is Task Scheduler saying the task was stopped by request
  # (#5155). Somebody stopped it on purpose without leaving a hold, so it is
  # started again like any other, and the words say so.
  if ($code -eq 267014) { return ('it was stopped on purpose (' + $hex + ') and nobody left a hold, so it is started again as if it had stopped by itself') }
  if ($code -lt 3221225472) { return ('its last run ended with code ' + $code + ' (' + $hex + ')') }
  $names = @{ [int64]3221225477 = 'an access violation'; [int64]3221225725 = 'a stack overflow'; [int64]3221226356 = 'heap corruption'; [int64]3221226505 = 'a fail fast' }
  $what = 'an exception'
  if ($names.ContainsKey($code)) { $what = $names[$code] }
  $say = 'its last run crashed with ' + $hex + ' (' + $what + ')'
  $dump = Get-ChildItem -LiteralPath $dumps -Filter '*.dmp' -File -EA SilentlyContinue |
          Where-Object { $_.LastWriteTime -ge $i.LastRunTime } |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($dump) { return ($say + '; the newest dump since it started is ' + $dump.FullName) }
  return ($say + '; there is no dump since it started in ' + $dumps)
}
function ServiceProblem($name) {
  $s = @(Get-Service -Name $name -EA SilentlyContinue)
  if ($s.Count -eq 0) { return 'its Windows service is not installed' }
  $down = @($s | Where-Object { "$($_.Status)" -ne 'Running' -and -not (StillStarting $_) })
  if (-not $down.Count) { return '' }
  if ($s.Count -eq 1) { return ('its Windows service is ' + $down[0].Status) }
  return ('of its ' + $s.Count + ' Windows services, ' + (@($down | ForEach-Object { $_.Name + ' is ' + $_.Status }) -join ', '))
}

# '' when the nightly backup's task last ran clean and a backup file is
# younger than $hours, else why not. 267009 is running now and 267011 is not
# yet run, neither of which is a failure.
function BackupProblem($task, $folder, $hours) {
  $t = Get-ScheduledTask -TaskName $task -EA SilentlyContinue
  if (-not $t) { return ('its task, ' + $task + ', is not registered') }
  # Retention first, because a run that made its backup and could not drop an
  # old one also ends non-zero, and the code alone does not say which (#2354).
  # vps-nightly-backup.ps1 writes one name|error a line, and removes the file
  # once every drop has gone.
  $stuck = @(Get-Content -LiteralPath (Join-Path $folder 'retention-failed.txt') -EA SilentlyContinue |
             Where-Object { "$_".Trim() } | ForEach-Object { ("$_" -split '\|')[0] })
  if ($stuck.Count) {
    return ('retention is failing: ' + $stuck.Count + ' backup(s) past the seven daily and four weekly kept would not delete (' +
            ($stuck -join ', ') + '). See backup.log in ' + $folder)
  }
  $i = Get-ScheduledTaskInfo -TaskName $task -EA SilentlyContinue
  if ($i -and @(0, 267009, 267011) -notcontains [int64]$i.LastTaskResult) {
    return ('its last run, at ' + $i.LastRunTime.ToString('yyyy-MM-dd HH:mm') + ', ended with code ' + $i.LastTaskResult)
  }
  $newest = Get-ChildItem -LiteralPath $folder -File -EA SilentlyContinue |
            Where-Object { $_.Name -match '^thornswood-\d{8}-\d{6}\.zip(\.enc)?$' } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest) { return ('there is no backup in ' + $folder) }
  $age = ($now - $newest.LastWriteTime).TotalHours
  if ($age -gt $hours) { return ('the newest backup, ' + $newest.Name + ', is ' + [math]::Round($age) + ' hours old') }
  return ''
}

# '' when the newest copy off this box is younger than $hours, else why not
# (#2755). Send-Backups.ps1 writes the name of each backup the Oracle VM took
# into offbox.txt (#2862; until 31 Oct Fetch-Backups.ps1 on One wrote the
# newest it had checked), so this box knows how far behind the copy off it
# is. The
# age is read from the name, stamped by this box's clock when it took the
# backup, so the two machines' clocks never meet.
function OffBoxProblem($file, $hours) {
  if (-not (Test-Path -LiteralPath $file)) { return ('no copy has been sent off this box: there is no ' + $file + ', which Send-Backups.ps1 writes after each backup the VM took') }
  $name = ('' + (Get-Content -LiteralPath $file -TotalCount 1 -EA SilentlyContinue)).Trim()
  if ($name -notmatch '^thornswood-(\d{8}-\d{6})\.zip(\.enc)?$') { return ($file + ' does not name a backup') }
  $taken = [datetime]::ParseExact($Matches[1], 'yyyyMMdd-HHmmss', [Globalization.CultureInfo]::InvariantCulture)
  $age = ($now - $taken).TotalHours
  if ($age -gt $hours) { return ('the newest copy sent off this box is ' + $name + ', ' + [math]::Floor($age) + ' hours old, and the line is ' + $hours) }
  return ''
}

# What is down, one line per thing: name|down or up|bad runs|good runs|first
# bad|first good. Only this script writes it.
function ReadOutages() {
  $o = @{}
  if (-not (Test-Path -LiteralPath $outages)) { return $o }
  foreach ($line in (Get-Content -LiteralPath $outages -EA SilentlyContinue)) {
    $b = "$line" -split '\|'
    if ($b.Count -ne 6) { continue }
    try {
      $o[$b[0]] = @{ Down = ($b[1] -eq 'down'); Misses = [int]$b[2]; Clean = [int]$b[3]; Since = $b[4]; Good = $b[5] }
    } catch { continue }
  }
  return $o
}

function SaveOutages($o) {
  $lines = @()
  foreach ($k in ($o.Keys | Sort-Object)) {
    $s = $o[$k]
    $lines += ($k + '|' + $(if ($s.Down) { 'down' } else { 'up' }) + '|' + $s.Misses + '|' + $s.Clean + '|' + $s.Since + '|' + $s.Good)
  }
  Set-Content -LiteralPath $outages -Value $lines -Encoding ASCII
}

# A time as Discord shows it, in each reader's own clock, and as watch.log
# has it, in this box's.
function Shown($t, $discord) {
  if ($discord) { return ('<t:' + (UnixTime $t) + ':f>') }
  return ($t.ToString('yyyy-MM-dd HH:mm') + ' VPS time')
}

function Took($from, $to) {
  $m = [math]::Round(($to - $from).TotalMinutes)
  if ($m -lt 1) { return 'under a minute' }
  if ($m -lt 120) { return ('about ' + $m + ' minutes') }
  return ('about ' + [math]::Round($m / 60.0, 1) + ' hours')
}

# What the watchdog did about it, said after what is wrong.
function HowWords($c, $how) {
  switch ($how) {
    'back'    { return 'The watchdog restarted it and it answered again. If it stays up, a message saying it is back follows in about ten minutes.' }
    'stuck'   { return 'The watchdog restarted it and it is still not answering. It tries every five minutes, three times an hour at most, then leaves it for a person.' }
    'refused' {
      if ($c.ContainsKey('Svc')) { return ('Windows would not restart its service, ' + $c.Svc + ', which usually means the service is not installed. It needs a person.') }
      return ('Windows would not start its task, ' + $c.Task + ', which usually means the task is missing or was renamed. It needs a person.')
    }
    'gaveup'  { return 'The watchdog has restarted it three times this hour and has stopped trying. It needs a person.' }
    'soft'    { return 'It is still running, so the watchdog does not restart it for this. It may be hung. It needs a person.' }
    default   {
      if ($c.ContainsKey('Fix')) { return $c.Fix }
      return 'Nothing restarts this by itself. It needs a person.'
    }
  }
}

# One message into the outbox, and the same sentence into watch.log.
function Tell($c, $kind, $head, $body, $plain) {
  $id = $now.ToString('yyyyMMddHHmmss') + '-' + ($c.Name -replace '[^A-Za-z0-9]', '') + '-' + $kind
  $text = '**' + $head + '** ' + $body
  if ($text.Length -gt 1900) { $text = $text.Substring(0, 1900) }
  $row = ConvertTo-Json @{ id = $id; at = (UnixTime $now); service = $c.Name; kind = $kind; text = $text } -Compress
  [IO.File]::AppendAllText($alerts, $row + "`r`n", (New-Object Text.UTF8Encoding($false)))
  Note ('told staff: ' + $head + ' ' + $plain)
}

# A check's own word for going down or coming back, or the usual one.
function Word($c, $key, $usual) {
  if ($c.ContainsKey($key)) { return $c[$key] }
  return $usual
}

# One run's verdict on one thing. $bad is whether it was found down, $soft
# whether that was only its health check, $why what is wrong in words and
# $how what the watchdog did about it.
function Observe($o, $c, $bad, $soft, $why, $how) {
  if (-not $o.ContainsKey($c.Name)) { $o[$c.Name] = @{ Down = $false; Misses = 0; Clean = 0; Since = ''; Good = '' } }
  $s = $o[$c.Name]
  $stamp = $now.ToString('o')
  if ($bad) {
    $s.Clean = 0
    $s.Good = ''
    $s.Misses = $s.Misses + 1
    if (-not $s.Since) { $s.Since = $stamp }
    $need = 1
    if ($soft) { $need = $healthMisses }
    if (-not $s.Down -and $s.Misses -ge $need) {
      $s.Down = $true
      $since = [datetime]::Parse($s.Since, $null, 'RoundtripKind')
      $rest = $why + '. First noticed '
      $after = '. ' + (HowWords $c $how)
      Tell $c 'down' ($c.Say + ' ' + (Word $c 'Fails' 'is down') + '.') ($rest + (Shown $since $true) + $after) ($rest + (Shown $since $false) + $after)
    }
    return
  }
  $s.Misses = 0
  if (-not $s.Down) { $s.Since = ''; return }
  if (-not $s.Good) { $s.Good = $stamp }
  $s.Clean = $s.Clean + 1
  if ($s.Clean -lt $backAfter) { return }
  $good  = [datetime]::Parse($s.Good, $null, 'RoundtripKind')
  $since = $good
  if ($s.Since) { $since = [datetime]::Parse($s.Since, $null, 'RoundtripKind') }
  $gone = Took $since $good
  Tell $c 'back' ($c.Say + ' ' + (Word $c 'Recovers' 'is back') + '.') ('Working normally since ' + (Shown $good $true) + ', after ' + $gone + ' down (first noticed ' + (Shown $since $true) + ').') ('Working normally since ' + (Shown $good $false) + ', after ' + $gone + ' down (first noticed ' + (Shown $since $false) + ').')
  $s.Down = $false
  $s.Clean = 0
  $s.Since = ''
  $s.Good = ''
}

# The webhook's address, or '' when there is none or it is not one. Never
# printed and never written anywhere by this script.
function WebhookUrl() {
  if (-not (Test-Path -LiteralPath $hookFile)) { return '' }
  $u = ('' + (Get-Content -LiteralPath $hookFile -TotalCount 1 -EA SilentlyContinue)).Trim()
  if ($u -notmatch $hookRx) { return '' }
  return $u
}

# '' when Discord took it, else a short reason that never holds the address.
# No mentions, so nothing in a message can ping anybody.
function PostWebhook($url, $text) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $body = ConvertTo-Json @{ content = $text; allowed_mentions = @{ parse = @() } } -Compress
    $null = Invoke-WebRequest -Uri $url -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -UseBasicParsing -TimeoutSec 15
    return ''
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($code -gt 0) { return ('HTTP ' + $code) }
    return $_.Exception.GetType().Name
  }
}

function SentIds() {
  $s = @{}
  foreach ($f in @($sentBot, $sentHook)) {
    if (-not (Test-Path -LiteralPath $f)) { continue }
    foreach ($l in (Get-Content -LiteralPath $f -EA SilentlyContinue)) {
      $t = "$l".Trim()
      if ($t) { $s[$t] = $true }
    }
  }
  return $s
}

# Post through the webhook whatever the bot has not: everything when the bot
# is not running, and anything it has left for longer than $ackWait when it
# is, which is a bot that is up but not talking. Each failure is written to
# watch.log once, on the first run that tries it.
function Deliver() {
  if (-not (Test-Path -LiteralPath $alerts)) { return }
  $sent  = SentIds
  $url   = WebhookUrl
  # A bot whose heartbeat says it is off Discord cannot post either (#449).
  $botUp = (BotAlive) -and -not (BotSilent $botBeat)
  $from  = 0
  if ($botUp) { $from = $ackWait }
  $nowUnix = UnixTime $now
  foreach ($line in (Get-Content -LiteralPath $alerts -Encoding UTF8 -EA SilentlyContinue)) {
    $a = $null
    try { $a = ConvertFrom-Json $line } catch { continue }
    if (-not $a -or -not $a.id -or -not $a.text) { continue }
    if ($sent.ContainsKey($a.id)) { continue }
    $age = $nowUnix - [int64]$a.at
    if ($age -gt $alertMaxAge -or $age -lt $from) { continue }
    $first = ($age -lt ($from + 300))
    if (-not $url) {
      if ($first) { Note ('the bot has not posted ' + $a.id + ' and there is no webhook in ' + $hookFile + ', so it waits for the bot') }
      continue
    }
    $why = PostWebhook $url $a.text
    if ($why -eq '') {
      Add-Content -LiteralPath $sentHook -Value $a.id -Encoding ASCII
      $sent[$a.id] = $true
      Note ('posted ' + $a.id + ' through the webhook, because the bot ' + $(if ($botUp) { 'had not' } else { 'is not running or not on Discord' }))
    } elseif ($first) {
      Note ('could not post ' + $a.id + ' through the webhook: ' + $why + '. It is tried again every run for a day.')
    }
  }
}

# The outbox keeps two days, and the two lists of what was posted keep far
# more than two days' worth, so nothing still in the outbox loses its mark.
function TrimAlerts() {
  if (Test-Path -LiteralPath $alerts) {
    $all = @(Get-Content -LiteralPath $alerts -Encoding UTF8 -EA SilentlyContinue)
    $keep = @()
    foreach ($line in $all) {
      try { $a = ConvertFrom-Json $line } catch { continue }
      if ($a -and ((UnixTime $now) - [int64]$a.at) -le (2 * $alertMaxAge)) { $keep += $line }
    }
    if ($keep.Count -lt $all.Count) {
      [IO.File]::WriteAllText($alerts, $(if ($keep.Count) { ($keep -join "`r`n") + "`r`n" } else { '' }), (New-Object Text.UTF8Encoding($false)))
    }
  }
  foreach ($f in @($sentBot, $sentHook)) {
    if (-not (Test-Path -LiteralPath $f)) { continue }
    $all = @(Get-Content -LiteralPath $f -EA SilentlyContinue)
    if ($all.Count -gt 5000) { Set-Content -LiteralPath $f -Value ($all[-2500..-1]) -Encoding ASCII }
  }
}

# How many times each service has been restarted in the last hour. A service
# that will not stay up is a service to stop restarting and start reading.
$recent = @{}
if (Test-Path $hist) {
  foreach ($line in (Get-Content -LiteralPath $hist -EA SilentlyContinue)) {
    $bits = "$line" -split '\|'
    if ($bits.Count -ne 2) { continue }
    $when = [datetime]::MinValue
    if (-not [datetime]::TryParse($bits[0], [ref]$when)) { continue }
    if (((Get-Date) - $when).TotalMinutes -gt 60) { continue }
    if (-not $recent.ContainsKey($bits[1])) { $recent[$bits[1]] = 0 }
    $recent[$bits[1]] = $recent[$bits[1]] + 1
  }
}

# Caddy first, because it is the one the outside world meets and because a
# website answering on 3001 means nothing while 443 is unserved.
#
# Say is how a message names it. Health is asked over HTTP after the port
# answers, and only ever told about, never restarted for (the header says why).
$checks = @(
  @{ Name = 'caddy';   Task = 'Thornswood Web';    Port = 0; Url = 'https://thornswood.net/'; Say = 'The website (https://thornswood.net, through Caddy)' },
  @{ Name = 'website'; Task = 'Thornswood Docs';   Port = 3001; Say = 'The website''s app'; Health = 'http://127.0.0.1:3001/api/public' },
  @{ Name = 'game';    Task = 'Thornswood Server'; Port = 3000; Say = 'The live game server'; Health = 'http://127.0.0.1:3000/api/servers/thornswood/manifest.json' },
  @{ Name = 'voice';   Task = 'Thornswood Voice';  Port = 7778; Say = 'Live voice'; Health = 'http://127.0.0.1:7778/health' },
  # A Windows service, not a task (#465): restarted by its name, Svc.
  @{ Name = 'bot';     Svc = 'ThornswoodBot';      Port = 0; Say = 'The Discord bot'; Beat = $botBeat },
  # The dev pair. The dev game server's own traffic is UDP on 7787 and
  # cannot be connected to, so its resources port stands in, exactly as
  # 3000 does for the live one.
  @{ Name = 'dev game';  Task = 'Thornswood Dev Server'; Port = 7788; Say = 'The dev game server'; Health = 'http://127.0.0.1:7788/api/servers/thornswood/manifest.json' },
  @{ Name = 'dev voice'; Task = 'Thornswood Dev Voice';  Port = 7789; Say = 'Dev voice'; Health = 'http://127.0.0.1:7789/health' },
  # The way in over ssh (#2891). A plain request answers 404 on purpose, so
  # the port answering is the whole check.
  @{ Name = 'bridge';    Task = 'Thornswood Bridge';     Port = 7790; Say = 'The ssh bridge, the way into the box' }
)

# Told about and never restarted. The runner's service name is the one
# Install-Runner.ps1 registers, actions.runner.<owner>-<repo>.<runner name>,
# and the name ends in -<n> for every runner after the first.
$tellOnly = @(
  @{ Name = 'backup'; Say = 'The nightly backup'; Fails = 'is failing'; Recovers = 'is working again'; Backup = 'Thornswood Backup'; Folder = 'C:\Thornswood-Backup'; Hours = 26 },
  @{ Name = 'offbox'; Say = 'The copy of the backups off the VPS'; Fails = 'is out of date'; Recovers = 'is up to date again'; OffBox = (Join-Path $root 'offbox.txt'); Hours = 26
     Fix = 'The Thornswood Send Backups task sends each nightly to the Oracle VM when the backup task ends (#2862). Its record says why it did not: the gate verb Send-Backups -Status. Until then a VPS lost is everything since that copy lost too.' },
  @{ Name = 'runner'; Say = 'The build runner (Launcher builds on thornswood-vps and every numbered one)'; Service = 'actions.runner.*.thornswood-vps*' },
  # Caddy's own certificate (#2995), which only this box can reach now.
  @{ Name = 'cert'; Say = 'The certificate Caddy holds for thornswood.net'; Fails = 'needs a look'; Recovers = 'is fine again'; Cert = 'https://thornswood.net/'; Days = 14
     Fix = 'Caddy renews it by itself about 30 days before the end, so a renewal has been failing: read Caddy''s log in C:\Thornswood-Caddy. Cloudflare reaches it over port 443 for the renewal, so Set-WebFirewall.ps1 -Check says whether 443 still takes Cloudflare.' }
)

# What is wrong with one of $checks when it does not answer, in words.
function DownWords($c) {
  if ($c.ContainsKey('Url')) { return ($c.Url + ' is not answering') }
  if ($c.Port -eq 0) { return 'Its python process is not running' }
  return ('It is not answering on port ' + $c.Port)
}

# One place that knows how each of them is asked.
function IsUp($c) {
  if ($c.ContainsKey('Url')) { return (SiteAnswers $c.Url) }
  if ($c.Port -eq 0) { return (BotAlive) }
  return (Answers $c.Port)
}

# A check's verdict once the watchdog has acted on it. $h is the hold that
# ran out this run, or $null: then the one message is the hold's, saying what
# the start did, and a start that worked is not an outage (#5155).
function Verdict($c, $h, $why, $how) {
  if (-not $h) { Observe $told $c $true $false $why $how; return }
  TellHold $c $h (HoldWords $how)
  if ($how -eq 'back') { Observe $told $c $false $false '' ''; return }
  Observe $told $c $true $false $why $how
}

$fresh = @()
$told = ReadOutages
foreach ($c in $checks) {
  # Held on purpose (#5155): left alone until the hold runs out, and nothing
  # said. A hold that has run out is taken away here, and this run starts it.
  $target = ''
  if ($c.ContainsKey('Svc')) { $target = $c.Svc } elseif ($c.ContainsKey('Task')) { $target = $c.Task }
  $held = $null
  if ($target) { $held = ReadHold $target }
  if ($held -and -not $held.Over) {
    Note ($c.Name + ' is held by ' + $held.By + ' until ' + (Shown $held.Until $false) + ' (' + $held.Why + '), so it is left alone')
    continue
  }
  if ($held) { Remove-Item -LiteralPath $held.File -Force -EA SilentlyContinue }

  # What is wrong with it in words, when it is down.
  $why = DownWords $c
  if (IsUp $c) {
    if ($held) { TellHold $c $held (HoldWords 'running'); $held = $null }
    $sick = ''
    if ($c.ContainsKey('Health')) { $sick = HealthProblem $c.Health }
    # Running is not working (#449). Ten quiet minutes is already the grace,
    # so one run is enough. A hung bot is restarted by its service's name
    # below, like one whose process is gone (#465).
    $hung = ''
    if ($c.ContainsKey('Beat')) { $hung = BotSilent $c.Beat }
    if ($sick) { Observe $told $c $true $true ('It answers on port ' + $c.Port + ', but ' + $c.Health + ' ' + $sick) 'soft'; continue }
    if (-not $hung) { Observe $told $c $false $false '' ''; continue }
    if (-not $c.ContainsKey('Svc')) { Observe $told $c $true $false $hung 'soft'; continue }
    $why = $hung
  }

  $already = 0
  if ($recent.ContainsKey($c.Name)) { $already = $recent[$c.Name] }
  if ($already -ge 3) {
    Note ($c.Name + ' is still down after ' + $already + ' restarts this hour. Leaving it. This one needs a look.')
    Verdict $c $held $why 'gaveup'
    continue
  }

  # A start because a hold ran out is not a restart after a failure, so it
  # does not count towards the three an hour.
  if (-not $held) { $fresh += ((Get-Date).ToString('o') + '|' + $c.Name) }
  if ($c.ContainsKey('Svc')) {
    # By the service's name. Restart-Service starts one that is stopped, and
    # stopping this one stops python and anything it started.
    Note ($c.Name + ' is not working (' + $why + '). Restarting the service ' + $c.Svc)
    $rc = 0
    $err = ''
    try { Restart-Service -Name $c.Svc -Force -ErrorAction Stop } catch { $rc = 1; $err = $_.Exception.Message }
    if ($rc -ne 0) {
      Note ($c.Name + ' could not be restarted: ' + $err + ' Is the service called ' + $c.Svc + ' ?')
      Verdict $c $held $why 'refused'
      continue
    }
  } else {
    # Stopped by request is what a hold's own stop leaves, so it is not said
    # once the hold has run out.
    $ended = ''
    if (-not $held) { $ended = HowItEnded $c.Task }
    if ($ended) { $why = $why + ', and ' + $ended }
    Note ($c.Name + ' is not answering' + $(if ($ended) { ': ' + $ended } else { '' }) + '. Starting ' + $c.Task)
    $null = & schtasks /run /tn $c.Task 2>&1
    $rc = $LASTEXITCODE
    if ($rc -ne 0) {
      Note ($c.Name + ' could not be started. schtasks exited with ' + $rc + '. Is the task called ' + $c.Task + ' ?')
      Verdict $c $held $why 'refused'
      continue
    }
  }

  # Caddy's first start after a gap waits on its certificate, so it is given
  # longer before the watcher decides it did not come back.
  Start-Sleep -Seconds $(if ($c.ContainsKey('Url')) { 45 } else { 25 })
  if (IsUp $c) {
    Note ($c.Name + ' is back')
    Verdict $c $held $why 'back'
  }
  else { Note ($c.Name + ' did not come back in time'); Verdict $c $held $why 'stuck' }
}

# A hold on something this does not watch, run out, is taken away too, so the
# folder only ever holds holds that mean something.
foreach ($f in @(Get-ChildItem -LiteralPath $holdDir -Filter '*.json' -File -EA SilentlyContinue)) {
  $h = ReadHold $f.BaseName
  if ($h -and $h.Over) {
    Remove-Item -LiteralPath $f.FullName -Force -EA SilentlyContinue
    Note ('took away the hold on ' + $f.BaseName + ' by ' + $h.By + ', which ran out at ' + (Shown $h.Until $false))
  }
}

if ($fresh.Count -gt 0) { Add-Content -LiteralPath $hist -Value $fresh }

foreach ($c in $tellOnly) {
  $why = ''
  if ($c.ContainsKey('Backup')) { $why = BackupProblem $c.Backup $c.Folder $c.Hours }
  elseif ($c.ContainsKey('OffBox')) { $why = OffBoxProblem $c.OffBox $c.Hours }
  elseif ($c.ContainsKey('Cert')) { $why = CertProblem $c.Cert $c.Days }
  else { $why = ServiceProblem $c.Service }
  if ($why) { Observe $told $c $true $false ($why.Substring(0, 1).ToUpper() + $why.Substring(1)) 'nobody' }
  else { Observe $told $c $false $false '' '' }
}

# Free space. Everything on this box shares one volume: both game servers, the
# site and its uploads, voice, the bot, every log and every payload.
# MOVING-THE-SERVER.md in the ops repo has it at 80 GB with 81 percent free, read off the box
# on 15 September, and all of those only grow. A full disk is not one service
# down, it is every service at once. From the To Do List: "Free space is a
# first-class alert, usually at twenty percent and again at ten, because it is
# the one resource whose exhaustion is total rather than partial."
#
# It is its own check and not a line in $checks because restarting a service
# frees nothing, so nothing here restarts anything. It is said once when a
# line is crossed and once when it comes back, not on every five minute run:
# disk.txt beside restarts.txt holds which side of the lines the last run saw.
$diskState    = Join-Path $root 'disk.txt'
$diskLow      = 20
$diskCritical = 10

# The same two numbers Get-PSDrive C shows by hand on the box, so a person
# checking reads what this read. $null when the drive cannot be read, and then
# nothing is said and nothing is remembered rather than a guess.
function DiskNow() {
  try {
    $d = Get-PSDrive -Name $root.Substring(0, 1) -PSProvider FileSystem -EA Stop
    $free = [double]$d.Free
    $size = [double]$d.Used + $free
    if ($size -le 0) { return $null }
    return @{ Free = $free; Size = $size }
  } catch { return $null }
}

# Which side of the lines a free percentage is on. On the way back up it has
# to clear a line by a whole point before it counts, so a disk sitting right
# on twenty percent, a log trimmed and then growing again, is one line in
# watch.log and not one every five minutes.
function DiskLevel($pct, $was) {
  if ($pct -lt $diskCritical) { return 'critical' }
  if ($was -eq 'critical' -and $pct -lt ($diskCritical + 1)) { return 'critical' }
  if ($pct -lt $diskLow) { return 'low' }
  if (($was -eq 'low' -or $was -eq 'critical') -and $pct -lt ($diskLow + 1)) { return 'low' }
  return 'ok'
}

function DiskCheck($free, $size) {
  $pct   = [math]::Round(100.0 * $free / $size, 1)
  $where = $root.Substring(0, 2)
  $room  = '' + [math]::Round($free / 1GB, 1) + ' GB of ' + [math]::Round($size / 1GB, 1) + ' GB'
  $was = ''
  if (Test-Path -LiteralPath $diskState) {
    $was = ('' + (Get-Content -LiteralPath $diskState -TotalCount 1 -EA SilentlyContinue)).Trim()
  }
  if (@('ok', 'low', 'critical') -notcontains $was) { $was = '' }
  $now = DiskLevel $pct $was
  if ($now -ne $was) {
    if ($now -eq 'critical') {
      Note ('DISK CRITICAL: ' + $pct + '% free on ' + $where + ', ' + $room + '. Under ' + $diskCritical + '%. When it fills, every service on this box stops at once. Clear old logs, uploads or payloads now. Nothing was restarted, because a restart frees nothing.')
    } elseif ($now -eq 'low' -and $was -eq 'critical') {
      Note ('disk up to ' + $pct + '% free on ' + $where + ', ' + $room + '. Out of critical, still under ' + $diskLow + '%.')
    } elseif ($now -eq 'low') {
      Note ('DISK LOW: ' + $pct + '% free on ' + $where + ', ' + $room + '. Under ' + $diskLow + '%. Everything on this box shares this one volume, so this is the whole box and not one service. Nothing was restarted, because a restart frees nothing.')
    } elseif ($was -ne '') {
      Note ('disk back to ' + $pct + '% free on ' + $where + ', ' + $room + '.')
    }
    Set-Content -LiteralPath $diskState -Value $now -Encoding ASCII
  }
  return ('disk      ' + $pct + '% free on ' + $where + ', ' + $room + ' (' + $now + ')')
}

# Printed, so the file run by hand on the box shows what it read.
$space = DiskNow
if ($space) { DiskCheck $space.Free $space.Size }
else { 'disk      could not be read' }

# The disk is told about too, from the verdict DiskCheck just kept. Going
# from low to critical is the same outage, and DISK CRITICAL is still in
# watch.log; the message says how full it was when it was first seen.
$level = ''
if (Test-Path -LiteralPath $diskState) { $level = ('' + (Get-Content -LiteralPath $diskState -TotalCount 1 -EA SilentlyContinue)).Trim() }
if ($space -and $level) {
  $diskCheck = @{ Name = 'disk'; Say = 'Free disk space on the VPS'; Fails = 'is running out'; Recovers = 'is fine again' }
  $pct = [math]::Round(100.0 * $space.Free / $space.Size, 1)
  if ($level -eq 'ok') { Observe $told $diskCheck $false $false '' '' }
  else { Observe $told $diskCheck $true $false ('It is ' + $level + ': ' + $pct + '% free, ' + [math]::Round($space.Free / 1GB, 1) + ' GB. Every service on this box stops when it fills. Clear old logs, uploads or payloads') 'nobody' }
}

SaveOutages $told
Deliver

# Keep the two files from growing forever.
foreach ($f in @($log, $hist)) {
  if (Test-Path $f) {
    $all = @(Get-Content -LiteralPath $f -EA SilentlyContinue)
    if ($all.Count -gt 2000) {
      Set-Content -LiteralPath $f -Value ($all[-1000..-1]) -Encoding UTF8
    }
  }
}
TrimAlerts
'@

# ------------------------------------------------------------------ off ---
if ($Remove) {
  Head 'Taking it off'
  $out = Remote @"
`$ErrorActionPreference = 'Continue'
`$null = & schtasks /delete /tn '$Task' /f 2>&1
if (`$LASTEXITCODE -eq 0) { 'the task is gone' } else { 'there was no task called $Task' }
'the log is still at $Root\watch.log if you want to read it'
"@
  foreach ($l in $out) { Say "  $l" }
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

# -------------------------------------------------------------- webhook ---
# The address goes to the VPS on ssh's standard input, not on its command
# line, so it is in no process list, no shell history and no log. It is
# checked for the shape of a Discord webhook first, so a stray paste goes
# nowhere. On the box the file is readable by SYSTEM and Administrators only,
# which keeps the build runner's account away from it.
$hookRx = '^https://((ptb|canary)\.)?discord(app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]+$'

# Where a webhook posts, asked of Discord: a GET on the webhook's own address
# answers with its channel_id, and the address is its own authority, so no
# token is involved. Channel is '' and Why says why when Discord would not
# say. Nothing here prints or keeps the address. Set-DevNews.ps1 asks the
# same way for the dev release webhook.
function WebhookChannel([string]$url) {
  $r = @{ Channel = ''; Why = '' }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $o = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 15 -UseBasicParsing
    if ($o -and $o.PSObject.Properties['channel_id']) { $r.Channel = [string]$o.channel_id } else { $r.Why = 'Discord answered without a channel' }
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    $r.Why = $(if ($code -eq 401 -or $code -eq 404) { 'Discord answered ' + $code + ', so that webhook does not exist any more or the address is not whole' } elseif ($code) { 'Discord answered ' + $code } else { 'Discord could not be reached (' + $_.Exception.GetType().Name + ')' })
  }
  return $r
}

if ($SetWebhook) {
  Head 'Where the watchdog posts when the bot is down'
  if (-not $StaffChannel) { Die "There is no channel id in $staffFile, so the webhook cannot be checked. Nothing was sent." }
  Say '  In Discord: #staff-updates, Edit Channel, Integrations, Webhooks,' 'DarkGray'
  Say '  New Webhook, then Copy Webhook URL. Paste it below. It is not shown,' 'DarkGray'
  Say '  not printed and not kept on this machine.' 'DarkGray'
  $sec = Read-Host '  Webhook address' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $url = ('' + [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ($url -notmatch $hookRx) { Die 'That is not a Discord webhook address (https://discord.com/api/webhooks/...). Nothing was sent.' }
  # Before anything goes to the box: a webhook made in any other channel
  # would say the outages there while the bot says them in #staff-updates.
  $where = WebhookChannel $url
  if (-not $where.Channel) { $url = $null; Die ('Discord would not say where that webhook posts: ' + $where.Why + '. Nothing was sent.') }
  if ($where.Channel -ne $StaffChannel) { $url = $null; Die ('That webhook posts in channel ' + $where.Channel + ', not #staff-updates (' + $StaffChannel + '). Make it in #staff-updates. Nothing was sent.') }
  Say ('  Discord says it posts in ' + $where.Channel + ', which is #staff-updates.') 'Green'

  $put = @"
`$ErrorActionPreference = 'Continue'
`$u = ('' + [Console]::In.ReadLine()).Trim()
if (-not `$u) { 'FAILED    nothing arrived on standard input'; exit 1 }
$(Get-ThornswoodLockedFolderScript $Root)
`$f = '$Root\alerts-webhook.txt'
[IO.File]::WriteAllText(`$f, `$u + "``r``n", (New-Object Text.UTF8Encoding(`$false)))
`$null = & icacls `$f /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' 2>&1
if (`$LASTEXITCODE -eq 0) { 'saved     ' + `$f + ', readable by SYSTEM and Administrators only' } else { 'FAILED    icacls exited with ' + `$LASTEXITCODE + ' locking ' + `$f }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
`$body = ConvertTo-Json @{ content = 'The watchdog on the VPS can post here. When the Discord bot is down, what stops on the VPS and when it is back is said here instead.'; allowed_mentions = @{ parse = @() } } -Compress
try {
  `$null = Invoke-WebRequest -Uri `$u -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(`$body)) -UseBasicParsing -TimeoutSec 15
  'posted    a test message. Look for it in the channel.'
} catch {
  `$code = 0
  try { `$code = [int]`$_.Exception.Response.StatusCode } catch { }
  'FAILED    the test message: ' + `$(if (`$code) { 'HTTP ' + `$code } else { `$_.Exception.GetType().Name })
}
"@
  $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($put))
  $out = $url | Invoke-ThornswoodNative { $input | & ssh @ssh "$User@$Vps" "pwsh -NoProfile -EncodedCommand $e" } 2>&1
  $url = $null
  foreach ($l in $out) {
    $c = 'Gray'
    if ("$l" -match '^FAILED') { $c = 'Red' }
    if ("$l" -match '^(saved|posted)') { $c = 'Green' }
    Say "  $l" $c
  }
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

# ------------------------------------------------------------------- on ---
if ($Install) {
  Head 'Putting it on the server'

  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($watcher))
  # The box's half of scripts\ops\Say-Staff.ps1, beside watch.ps1 so it takes
  # this folder's lock: how an agent puts a staff notice in this outbox (#2934).
  # A notices key (Grant-BoxAccess.ps1 -NoticesOnly) can run this and nothing else.
  $sayB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $Here 'vps-say-staff.ps1')))

  $out = Remote @"
`$ErrorActionPreference = 'Continue'
$(Get-ThornswoodLockedFolderScript $Root)
[IO.File]::WriteAllBytes('$Root\watch.ps1', [Convert]::FromBase64String('$b64'))
'wrote     $Root\watch.ps1  ' + (Get-Item '$Root\watch.ps1').Length + ' bytes'
[IO.File]::WriteAllBytes('$Root\say-staff.ps1', [Convert]::FromBase64String('$sayB64'))
'wrote     $Root\say-staff.ps1  ' + (Get-Item '$Root\say-staff.ps1').Length + ' bytes, for staff notices from agents'

# Every five minutes, as SYSTEM, so it keeps going when nobody is logged in.
#
# PRIORITY 4, normal, like the services it watches (#1968, #3212). Until
# 21 Oct 2026 this was schtasks /create with no priority, so Task Scheduler's
# default of 7: Below Normal, I/O priority 1 (low), memory priority 2. With
# the build runners at Normal filling the box, that run took a minute to
# reach its first check, a three-second connect to a server that was up the
# whole time timed out, and staff were told the dev server and the site were
# down (6:43 and 6:57 PM). No time limit, and IgnoreNew so a slow run is not
# joined by a second one.
`$a = New-ScheduledTaskAction -Execute (Join-Path `$env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument '-NoProfile -ExecutionPolicy Bypass -File $Root\watch.ps1'
`$tr = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
`$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -Priority 4
`$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
try {
  Register-ScheduledTask -TaskName '$Task' -Action `$a -Trigger `$tr -Settings `$s -Principal `$p -Force -ErrorAction Stop | Out-Null
  'made      the task, every five minutes, at priority ' + (Get-ScheduledTask -TaskName '$Task').Settings.Priority
} catch { 'FAILED    the task could not be registered: ' + `$_.Exception.Message }

# Run it once now so the log has something in it and any problem shows up
# here rather than in five minutes when nobody is watching.
`$null = & schtasks /run /tn '$Task' 2>&1
Start-Sleep -Seconds 8
if (Test-Path '$Root\watch.log') {
  'first run:'
  Get-Content '$Root\watch.log' -Tail 10 | ForEach-Object { '  ' + `$_ }
}
else { 'first run wrote nothing, which means everything it watches was answering' }
if (Test-Path '$Root\alerts-webhook.txt') {
  `$null = & icacls '$Root\alerts-webhook.txt' /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' 2>&1
  'webhook   set, for when the bot is down'
} else { 'webhook   none yet. Messages wait for the bot until -SetWebhook is run' }
"@

  # A FAILED line, or nothing back, is exit 1, so a run through the gate
  # (Box-Run.ps1 -Line 'Watch-Services -Install') says it did not work (#5155).
  $failed = -not @($out).Count
  foreach ($l in $out) {
    $c = 'Gray'
    if ("$l" -match '^FAILED') { $c = 'Red'; $failed = $true }
    if ("$l" -match '^(wrote|made)') { $c = 'Green' }
    Say "  $l" $c
  }

  Head 'From now on'
  Say '  Anything that stops gets started again within five minutes,' 'DarkGray'
  Say '  except a server held on purpose (any deploy, or Hold-Server.ps1), until its hold runs out.' 'DarkGray'
  Say '  #staff-updates hears once when something goes down and once when it is back.' 'DarkGray'
  Say '  Run this script with no switches to see what it has been doing.' 'DarkGray'
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  if ($failed) { exit 1 }
  exit 0
}

# -------------------------------------------------------------- report ---
Head 'Right now'
$out = Remote @"
`$ErrorActionPreference = 'Continue'
function Answers(`$port) {
  try {
    `$c = New-Object Net.Sockets.TcpClient
    `$ok = `$c.BeginConnect('127.0.0.1', `$port, `$null, `$null).AsyncWaitHandle.WaitOne(3000)
    `$up = `$ok -and `$c.Connected
    `$c.Close()
    return `$up
  } catch { return `$false }
}
# Asked the way the watcher asks, for the reasons in the header: the name
# and its certificate, at this box's own 443 and not through Cloudflare
# (#2995). Any HTTP answer counts, a 502 included: that is Caddy up with
# something behind it down, and the line under it says which.
function SiteAnswers(`$url) {
  `$u = [uri]`$url
  `$c = `$null; `$s = `$null
  `$seen = @{ E = 'None' }
  try {
    `$c = New-Object Net.Sockets.TcpClient
    if (-not `$c.BeginConnect('127.0.0.1', 443, `$null, `$null).AsyncWaitHandle.WaitOne(5000) -or -not `$c.Connected) { return `$false }
    `$cb = { param(`$a, `$b, `$d, `$e) `$seen.E = '' + `$e; return `$true }.GetNewClosure()
    `$s = New-Object Net.Security.SslStream(`$c.GetStream(), `$false, [Net.Security.RemoteCertificateValidationCallback]`$cb)
    `$s.ReadTimeout = 10000; `$s.WriteTimeout = 10000
    `$s.AuthenticateAsClient(`$u.Host)
    `$q = [Text.Encoding]::ASCII.GetBytes('HEAD ' + `$u.PathAndQuery + " HTTP/1.1``r``nHost: " + `$u.Host + "``r``nUser-Agent: Thornswood-Watch``r``nConnection: close``r``n``r``n")
    `$s.Write(`$q, 0, `$q.Length)
    `$s.Flush()
    `$line = (New-Object IO.StreamReader(`$s, [Text.Encoding]::ASCII)).ReadLine()
    return (`$seen.E -eq 'None' -and "`$line" -match '^HTTP/\d(\.\d)? \d{3}')
  } catch { return `$false }
  finally {
    if (`$s) { `$s.Dispose() }
    if (`$c) { `$c.Close() }
  }
}
# The python the ThornswoodBot service started, as BotPythons does (#3189).
`$bot = `$false
`$botSvc = Get-CimInstance Win32_Service -Filter "Name = 'ThornswoodBot'" -EA SilentlyContinue
if (`$botSvc -and `$botSvc.ProcessId) {
  `$bot = @(Get-CimInstance Win32_Process -Filter ("Name = 'python.exe' AND ParentProcessId = " + [int]`$botSvc.ProcessId) -EA SilentlyContinue).Count -gt 0
}
'caddy     ' + `$(if (SiteAnswers 'https://thornswood.net/') { 'up' } else { 'DOWN' })
'website   ' + `$(if (Answers 3001) { 'up' } else { 'DOWN' })
'game      ' + `$(if (Answers 3000) { 'up' } else { 'DOWN' })
'voice     ' + `$(if (Answers 7778) { 'up' } else { 'DOWN' })
'bot       ' + `$(if (`$bot) { 'up' } else { 'DOWN' })
# The service the bot runs as (#465), which is what the watcher restarts.
`$bs = Get-Service -Name 'ThornswoodBot' -EA SilentlyContinue
'bot svc   ' + `$(if (`$bs) { 'ThornswoodBot ' + `$bs.Status } else { 'NOT INSTALLED. Run Install-Bot.ps1' })
# What the bot last said about itself (#449). The watcher's own rule is in
# BeatProblem above; this is only what a person looking wants to see.
`$hb = 'C:\Thornswood-Bot\data\heartbeat.json'
if (Test-Path `$hb) {
  try {
    `$b = Get-Content `$hb -Raw -Encoding UTF8 | ConvertFrom-Json
    `$ago = [math]::Round(([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]`$b.written) / 60)
    'heartbeat ' + `$ago + ' min ago, ' + `$(if (`$b.connected) { 'on Discord' } else { 'OFF DISCORD' })
  } catch { 'heartbeat could not be read' }
} else { 'heartbeat none. The bot writes C:\Thornswood-Bot\data\heartbeat.json once Install-Bot.ps1 -NoToken has run' }
'dev game  ' + `$(if (Answers 7788) { 'up' } else { 'DOWN' })
'dev voice ' + `$(if (Answers 7789) { 'up' } else { 'DOWN' })
'bridge    ' + `$(if (Answers 7790) { 'up' } else { 'DOWN' })
# Free space right now, and LOW or CRITICAL when the watcher's last run found
# it under a line. The twenty and the ten are kept in the watcher only, so
# this reads its verdict from disk.txt rather than holding a second copy.
`$d = Get-PSDrive -Name '$($Root.Substring(0, 1))' -PSProvider FileSystem -EA SilentlyContinue
`$lvl = ''
if (Test-Path '$Root\disk.txt') { `$lvl = ('' + (Get-Content '$Root\disk.txt' -TotalCount 1 -EA SilentlyContinue)).Trim() }
if (`$d -and ([double]`$d.Used + `$d.Free) -gt 0) { 'disk      ' + [math]::Round(100.0 * `$d.Free / ([double]`$d.Used + `$d.Free), 1) + '% free, ' + [math]::Round(`$d.Free / 1GB, 1) + ' GB' + `$(if (`$lvl -eq 'low' -or `$lvl -eq 'critical') { ', ' + `$lvl.ToUpper() } else { '' }) }
else { 'disk      could not be read' }
`$t = & schtasks /query /tn '$Task' /fo list 2>`$null
if (`$LASTEXITCODE -eq 0) { 'watcher   installed' } else { 'watcher   NOT installed. Run this with -Install' }
if (Test-Path '$Root\say-staff.ps1') { 'notices   say-staff.ps1 is there, so agents can post in #staff-updates (Say-Staff.ps1)' } else { 'notices   NO say-staff.ps1, so Say-Staff.ps1 cannot post. Run this with -Install' }
# Where the webhook posts, asked of Discord on the box (WebhookChannel's
# question, there): only the channel id comes back, never the address.
if (Test-Path '$Root\alerts-webhook.txt') {
  `$w = ''
  try {
    `$u = ('' + (Get-Content '$Root\alerts-webhook.txt' -TotalCount 1 -EA Stop)).Trim()
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    `$o = Invoke-RestMethod -Uri `$u -Method Get -TimeoutSec 15 -UseBasicParsing
    `$w = '' + `$o.channel_id
  } catch {
    `$code = 0
    try { `$code = [int]`$_.Exception.Response.StatusCode } catch { }
    'webhook   set, and DISCORD WOULD NOT SAY WHERE IT POSTS: ' + `$(if (`$code) { 'HTTP ' + `$code } else { `$_.Exception.GetType().Name })
  }
  `$u = `$null
  if (`$w -and '$StaffChannel' -and `$w -eq '$StaffChannel') { 'webhook   set, posts in ' + `$w + ', which is #staff-updates' }
  elseif (`$w -and '$StaffChannel') { 'webhook   set, and posts in ' + `$w + ', NOT #staff-updates ($StaffChannel). Make one there and run this with -SetWebhook' }
  elseif (`$w) { 'webhook   set, posts in ' + `$w }
} else { 'webhook   none, so only the bot tells anybody. Run this with -SetWebhook' }
`$down = @()
if (Test-Path '$Root\outages.txt') {
  foreach (`$line in (Get-Content '$Root\outages.txt' -EA SilentlyContinue)) {
    `$b = "`$line" -split '\|'
    if (`$b.Count -eq 6 -and `$b[1] -eq 'down') { `$down += `$b[0] }
  }
}
if (`$down.Count) { 'told      DOWN: ' + (`$down -join ', ') } else { 'told      nothing is down' }
# Who is holding what stopped on purpose (#5155), which the watcher leaves alone.
$(Get-ThornswoodHoldScript)
Get-ThornswoodHolds
"@
foreach ($l in $out) {
  $c = 'Gray'
  if ("$l" -match '^held ') { $c = 'Yellow' }
  if ("$l" -match 'DOWN|NOT installed|LOW$|CRITICAL$|OFF DISCORD|Stopped$|NOT #staff-updates|WOULD NOT SAY|NO say-staff') { $c = 'Red' }
  if ("$l" -match '\bup$|installed$|Running$') { $c = 'Green' }
  Say "  $l" $c
}

Head "Last $Lines things the watcher saw"
$out = Remote @"
`$ErrorActionPreference = 'Continue'
if (Test-Path '$Root\watch.log') {
  `$all = @(Get-Content '$Root\watch.log' -EA SilentlyContinue)
  if (`$all.Count -eq 0) { 'nothing yet, which means nothing has gone down' }
  else { `$all | Select-Object -Last $Lines }
}
else { 'no log yet' }
"@
foreach ($l in $out) { Say "  $l" 'DarkGray' }

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
