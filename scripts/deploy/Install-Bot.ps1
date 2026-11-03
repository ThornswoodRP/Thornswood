<#
  Install-Bot.ps1

  Puts the Thornswood bot on the VPS and keeps it running. This is the one that
  stays up, unlike Setup-Discord.ps1 which builds the server once and exits.

      .\Install-Bot.ps1               all of it, asks for the token
      .\Install-Bot.ps1 -CodeOnly    just the code, then restart
      .\Install-Bot.ps1 -NoToken     everything except asking for it
      .\Install-Bot.ps1 -PutBack     the code the last run replaced goes back
                                     in, checked the same way
      .\Install-Bot.ps1 -SetPing     asks for the outside monitor's ping
                                     address, puts it in bot.env.json and
                                     restarts the bot; nothing else is sent

  What it does:

    1. Checks Python is on the VPS. If it is missing, downloads one pinned
       python.org 3.12 installer, checks its SHA-256, and installs it only
       when the file matches. A mismatch stops the run.
    2. Stages bot.py, card.py and the card artwork beside the running
       bot and checks them there, before anything is stopped (issue #446,
       FILES below).
    3. Installs discord.py and Pillow into py-libs beside the staged code,
       which the swap puts back with the code.
    4. Asks for the bot token at a prompt, never on a command line, and puts
       it in the bot's bot.env.json and the site's config.json together
       (scripts\vps\Write-BotToken.ps1, the one writer of it).
    5. Makes a shared key, gives it to both the bot and the site, so the site
       knows a ticket really came from the bot. The site is restarted when the
       key or the token changed, since it reads its config only on starting.
    6. Runs it as the Windows service ThornswoodBot, under its own account,
       NT SERVICE\ThornswoodBot, rather than as SYSTEM, and starts it by that
       name (issue #465, scripts\vps\Bot-Service.ps1 and BotService.cs). The
       service starts it at boot, starts python again when it exits, and
       rolls bot.log by size while it runs. The first full run takes the old
       scheduled task and its run.ps1 loop off the box.
    7. Leaves the bot's folder holding what it sends and what is the bot's
       own (its settings, its records and log in data, the service, the
       webhooks, the libraries), and nothing else: the swap moves anything
       else there, a file somebody copied in by hand, aside into .prev with
       what the new code replaced, and says each name (issue #1184,
       Get-ThornswoodBotOwned in scripts\vps\Bot-Service.ps1).
    8. Asks the box, once the swap has answered, what is really at the bot's
       folder there: one Test-Path line per file it sent, by full path, with
       data\bot.log among them. A file that is not there turns the run red,
       so a swap that said SWAP OK while something is missing from the
       install root cannot read as a good deploy.

  Run it again any time to push a change. It stops the old one by the
  service's name only once the new code has checked out, and puts the old
  code back if the new one does not come up.
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Root = 'C:/Thornswood-Bot',
  [string]$DocsRoot = 'C:/Thornswood-Docs',
  # The service the bot runs as, stopped and started by this name.
  [string]$Service = 'ThornswoodBot',
  # The scheduled task the bot ran under before the service. A full run
  # removes it.
  [string]$Task = 'Thornswood Bot',
  # The site's task, restarted when the key or the token it reads changed.
  [string]$SiteTask = 'Thornswood Docs',
  # The channel the ticket panel lives in. More than one name is allowed and
  # the first that exists wins, so renaming the channel in Discord stops being
  # able to take tickets down with it.
  [string]$TicketChannel = 'tickets-and-applications,applications',
  # Staff only, and a different channel: posting closed applications where
  # people apply puts one person's answers in front of the next, and buries
  # the panel. The bot makes it if it is not there.
  [string]$TicketLog     = 'ticket-log,tickets',
  # Where join cards go. The channel called general was renamed, and the bot
  # said so in its log for a day before anybody read it.
  [string]$JoinChannel   = 'welcome-travelers',
  # Pulled into every ticket thread: the council and the ranks that answer
  # tickets, the same names as bot.py's STAFF_ROLES default and Build-Discord.py's
  # TICKET_STAFF (#3317). A run that wrote the old list left the council out of
  # every ticket; bot\tests\test-3317-give.py holds the three together.
  [string]$StaffRoles    = 'Owner,Co-Owner,Lead Dev,Lead Gamemaster,Lead Loremaster,Lead Moderator,Lead Content Creator,Lead Support,Gamemaster,Dev,Loremaster,Moderator',
  # Pulled into applications to join them and nothing else. Content Creator is
  # social media rather than staff, so it has no business reading a report
  # about somebody or another person's playtest application.
  [string]$CreatorRoles  = 'Content Creator',
  # Faction Leader tickets. IDs only. Install-Bot -UpperStaffRoles should
  # carry the Owner role ID and the Lead Gamemaster role ID (and any later
  # Lead department role ID). Names are ignored. Empty means those tickets
  # are refused, not opened to general staff.
  [string]$UpperStaffRoles = '',
  # Every run used to mint a new shared key, which meant every run also
  # silently stopped tickets reaching the site inbox until Deploy-Docs was run
  # again. The key is kept unless you ask for a new one.
  [switch]$RotateKey,
  # Just the code. Sends bot.py, card.py, the artwork and the live smoke's
  # export, restarts, and leaves Python, the libraries, the token and the
  # service alone.
  # This is what a change to bot.py wants, and it never asks for anything,
  # so it runs unattended.
  [switch]$CodeOnly,
  [switch]$NoToken,
  [switch]$NoPause,
  # How long the new bot has to say it is watching its server before the old
  # code goes back. Connecting to Discord and reading the roles takes a while.
  [int]$Wait = 90,
  # Put the code the last run replaced back in, and send nothing.
  [switch]$PutBack,
  # The outside monitor's ping address (issue #449), asked for hidden, into
  # bot.env.json as PING_URL on ssh's standard input, then the bot restarted
  # by name so it reads it. Typing off takes it out. Nothing else is sent.
  [switch]$SetPing,
  # The Windows installer fetched when the VPS has no Python. An exact
  # python.org file, not a floating latest. 3.12.10 is the last 3.12 release
  # python.org published a Windows installer for (3.12.11 and later, including
  # 3.12.15, are source only). PythonSha256 is the SHA-256 of that exact
  # python-3.12.10-amd64.exe, computed locally on 2 Oct 2026. python.org's
  # release page publishes the MD5 5eddb0b6f12c852725de071ae681dde4 for the
  # same file, and the downloaded file's MD5 matched it (size 26964224).
  [string]$PythonVersion = '3.12.10',
  [string]$PythonSha256  = '67b5635e80ea51072b87941312d00ec8927c4db9ba18938f7ad2d27b328b95fb'
)

$ErrorActionPreference = 'Stop'
# IDs only, and only when this run asked. A name, a space or any other
# character stops here so bot.env.json is not written with something the
# bot will silently ignore. Leaving the switch off keeps whatever is
# already on the box.
if ($PSBoundParameters.ContainsKey('UpperStaffRoles') -and
    $UpperStaffRoles -notmatch '^[0-9,]*$') {
  Write-Host ''
  Write-Host 'STOP. UPPER_STAFF_ROLES must be role IDs only (digits and commas). Nothing was written.' -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
$ssh  = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here '..\vps\Send-Secret.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
. (Join-Path $Here 'Swap.ps1')
# The bot's code as one list: bot.py and the modules it imports (#5357).
. (Join-Path $Here 'Bot-Code.ps1')
# The bot sources live at the repo root, in bot\. This script sits two levels
# down, in scripts\deploy, since #440 sorted the scripts into scripts\<area> on
# 25 September, so the repo root is two up from here. The copy loop below kept
# the old one-level ..\bot from before the move, which pointed at scripts\bot
# and found nothing on a -CodeOnly deploy. Anchoring the repo root once and
# joining bot\ to it keeps every bot path right whatever this folder's depth is,
# and test-script-paths.ps1 follows a $Repo path from the root the same way.
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$rootWin = $Root.Replace('/','\')
$docsWin = $DocsRoot.Replace('/','\')

# What goes up is the bot artifact (issue #459, Artifact.ps1): the bot's files
# as the commit holds them, in one zip named by commit and hash, sent to the
# box's store first. From here $Repo is the artifact's folder, which is laid
# out like the repository, so every copy below sends exactly what the zip holds.
# -PutBack and -SetPing build and send nothing.
. (Join-Path $Here 'Artifact.ps1')
$artifact = $null
if (-not $PutBack -and -not $SetPing) {
$artifact = New-ThornswoodArtifact -Component bot -RepoDir $Repo -Paths (@(Get-ThornswoodBotCode $Repo | ForEach-Object { 'bot/' + $_ }) + @('bot/staff-channel.txt', 'bot/dev-channel.txt', 'bot/requirements.txt', 'bot/factions.json', 'bot/assets/join-card.png', 'scripts/vps/BotService.cs'))
Write-Host ('artifact ' + (Format-ThornswoodArtifact $artifact)) -ForegroundColor DarkGray
Send-ThornswoodArtifact -Artifact $artifact -Target "$User@$Vps" -SshArgs $ssh
$Repo = $artifact.Folder
}

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }
function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

Write-Host ''
Write-Host '  THORNSWOOD  -  the bot' -ForegroundColor White

# ------------------------------------------------------------ ping url ---
# The outside monitor's ping address (issue #449, bot.py uptime_ping). The
# bot sends it one GET a minute while it is on Discord, and the monitor
# alerts when that stops, whether or not One is on. The address is a secret
# (whoever has it can keep the monitor quiet): asked for hidden, never
# printed, sent on ssh's standard input (Send-Secret.ps1, issue #451), kept
# only in bot.env.json on the VPS, never in the repository. The full run
# keeps it, since it keeps every setting it does not write.
if ($SetPing) {
  Head 'The outside monitor''s ping address'
  Say '  From the monitor''s page for the bot check. Hidden while you paste it, never shown.' 'DarkGray'
  Say '  Type off instead to take it out, so the bot stops pinging.' 'DarkGray'
  $ss = Read-Host '  Paste it' -AsSecureString
  if (-not $ss -or $ss.Length -eq 0) { Die 'Nothing pasted, nothing sent.' }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { $pingUrl = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $ss = $null
  if ($pingUrl -ne 'off') {
    $shape = $pingUrl -match '^https://[^\s/]+\.[^\s/]+/\S+$' -and $pingUrl.Length -le 400
    if (-not $shape) {
      $pingUrl = $null
      Die 'That is not a ping address: it starts with https:// and has no spaces. Nothing was sent.'
    }
    Say ('  a ping address on ' + ([Uri]$pingUrl).Host) 'Green'
  } else { Say '  taking the ping address out' 'Yellow' }

  $writer = Join-Path $Here '..\vps\Write-BotToken.ps1'
  if (-not (Test-Path -LiteralPath $writer)) { Die "missing: $writer" }
  Head 'Into bot.env.json, then the bot restarted by name'
  $out = Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $pingUrl -Script ((Get-ThornswoodHoldScript -Script 'Install-Bot.ps1') + (Get-Content -LiteralPath $writer -Raw) + "`n" + @"
`$ErrorActionPreference = 'Continue'
`$u = `$ThornswoodSecret; `$ThornswoodSecret = `$null
`$f = '$rootWin\bot.env.json'
if (-not `$u) { 'NOT WRITTEN: nothing arrived on standard input. Nothing changed.'; return }
`$h = `$null
try { `$h = Read-ThornswoodJsonFile `$f }
catch { 'NOT WRITTEN: ' + `$_.Exception.Message + '. Run Install-Bot.ps1 once first. Nothing changed.'; return }
`$off = (`$u -eq 'off')
if (`$off) {
  if (-not `$h.Contains('PING_URL')) { 'PING UNCHANGED: bot.env.json holds no ping address. Nothing changed.'; return }
  `$h.Remove('PING_URL')
} else {
  if ([string]`$h['PING_URL'] -ceq `$u) { 'PING UNCHANGED: bot.env.json already holds that ping address. Nothing changed.'; return }
  `$h['PING_URL'] = `$u
}
try { Write-ThornswoodJsonFile `$f `$h }
catch { 'NOT WRITTEN: ' + `$f + ' could not be written. Nothing else changed.'; return }
`$back = `$null
try { `$back = Read-ThornswoodJsonFile `$f }
catch { 'NOT WRITTEN: ' + `$f + ' does not read back (' + `$_.Exception.Message + '). Put it right before the bot restarts.'; return }
if (-not `$back) { 'NOT WRITTEN: ' + `$f + ' does not read back. Put it right before the bot restarts.'; return }
if (`$off) {
  if (`$back.Contains('PING_URL')) { 'NOT WRITTEN: the ping address is still in ' + `$f; return }
  'ping address taken out of ' + `$f + ' and read back'
} else {
  if (-not ([string]`$back['PING_URL'] -ceq `$u)) { 'NOT WRITTEN: ' + `$f + ' reads back a different ping address'; return }
  'ping address written to ' + `$f + ' and read back'
}
`$u = `$null; `$h = `$null; `$back = `$null
# The service hands bot.env.json to python only when it starts it. Its log is
# in data since #1104, beside the code on a box whose full install is older,
# and the one written last when both are there, since -CodeOnly leaves an
# empty one in data on every run.
`$log = '$rootWin\data\bot.log'
`$alt = '$rootWin\bot.log'
`$a = Get-Item -LiteralPath `$alt -EA SilentlyContinue
if (`$a) {
  `$n = Get-Item -LiteralPath `$log -EA SilentlyContinue
  if (-not `$n -or `$a.LastWriteTimeUtc -gt `$n.LastWriteTimeUtc) { `$log = `$alt }
}
`$before = Get-ThornswoodLogLength `$log
`$r = @(Restart-ThornswoodBot -Root '$rootWin' -Service '$Service')
`$r
if (`$r -contains 'bot reconnected') {
  # uptime_ping says once how its first ping went, within seconds of connecting.
  `$seen = @()
  for (`$i = 0; `$i -lt 30 -and -not `$seen.Count; `$i += 2) {
    `$seen = @(Read-ThornswoodLogTail `$log `$before | Where-Object { `$_ -match 'uptime ping' })
    if (-not `$seen.Count) { Start-Sleep -Seconds 2 }
  }
  if (`$seen.Count) { `$seen | ForEach-Object { 'bot: ' + (`$_ -replace '^\s*\[thornswood-bot\]\s*', '') } }
  else { 'THE BOT HAS NOT SAID how its first ping went. Show-BotLog.ps1 shows its log.' }
}
"@)
  $pingUrl = $null
  foreach ($l in @($out)) {
    $s = "$l"
    $c = 'Gray'
    if ($s -match 'NOT WRITTEN|NOT RESTARTED|HAS NOT SAID|FAILED') { $c = 'Red' }
    elseif ($s -match 'read back|reconnected|reached the outside monitor|hears from this bot again') { $c = 'Green' }
    Say "  $s" $c
  }
  Write-Host ''
  if ("$out" -match 'NOT WRITTEN') { Die 'The ping address was not changed.' }
  if ("$out" -match 'PING UNCHANGED') { Say '  Nothing to do: the bot already has that.' 'DarkGray' }
  elseif ("$out" -match 'reached the outside monitor') { Say '  The monitor hears from the bot. Its page shows the first ping.' 'Green' }
  elseif ("$out" -match 'taken out') { Say '  The bot no longer pings anything. Pause or delete the check on the monitor''s page, or it alerts.' 'Yellow' }
  else { Say '  Check the monitor''s page: it shows each ping it gets.' 'Yellow' }
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

# ------------------------------------------------------------- python ---
Head 'Python on the VPS'
$py = Remote @"
# sshd was started before Python was ever installed, so every session it hands
# out carries the PATH from back then. Without this the check says MISSING on a
# box that has had Python on it for weeks, and the whole installer runs again.
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
`$p = Get-Command python -EA SilentlyContinue
if (`$p) { 'FOUND ' + (& `$p.Source --version 2>&1) + ' at ' + `$p.Source }
else { 'MISSING' }
"@
$py | ForEach-Object { Say "  $_" }
if ("$py" -match 'MISSING') {
  # Windows Server usually has no winget and no store, so this fetches the
  # official installer and runs it quietly rather than telling you to go and
  # click through a wizard over RDP.
  Say '  not there, installing it' 'Yellow'
  Head 'Installing Python 3.12 on the VPS'
  Remote @"
`$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
`$url = 'https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe'
`$exe = Join-Path `$env:TEMP 'python-$PythonVersion-amd64.exe'
'downloading ' + `$url
try { Invoke-WebRequest -Uri `$url -OutFile `$exe -UseBasicParsing -TimeoutSec 300 }
catch { 'DOWNLOAD FAILED: ' + `$_.Exception.Message; exit 1 }
# Checked before the installer runs. A file that does not match is deleted
# and nothing is installed, rather than an installer nobody can vouch for.
`$got = (Get-FileHash -LiteralPath `$exe -Algorithm SHA256).Hash
if (`$got -ne '$PythonSha256') {
  Remove-Item -LiteralPath `$exe -Force -EA SilentlyContinue
  throw ('python $PythonVersion installer does not match the checksum recorded for it, so it was not installed. Got ' + `$got)
}
'checksum matched'
'running the installer, quietly, for all users'
`$p = Start-Process `$exe -ArgumentList '/quiet','InstallAllUsers=1','PrependPath=1','Include_pip=1','Include_test=0' -Wait -PassThru
'installer exit code ' + `$p.ExitCode
Remove-Item `$exe -Force -EA SilentlyContinue
# PrependPath only touches the machine PATH, and this session started before
# it did, so read it back rather than trusting `$env:PATH.
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
`$c = Get-Command python -EA SilentlyContinue
if (`$c) { 'FOUND ' + (& `$c.Source --version 2>&1) } else { 'STILL MISSING' }
"@ | ForEach-Object { Say "  $_" }
  # A checksum mismatch or a failed download exits non-zero on the VPS.
  # Stop here rather than continuing a run that did not install Python.
  if ($LASTEXITCODE -ne 0) { Die 'Python was not installed. Nothing was copied.' }

  $py = Remote @"
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
`$p = Get-Command python -EA SilentlyContinue
if (`$p) { 'FOUND ' + (& `$p.Source --version 2>&1) } else { 'MISSING' }
"@
  $py | ForEach-Object { Say "  $_" }
  if ("$py" -match 'MISSING') {
    Write-Host ''
    Say 'That did not take. Do it by hand over RDP or ssh:' 'Yellow'
    Say '  https://www.python.org/downloads/windows/' 'DarkGray'
    Say '  Tick Add Python to PATH, then run this again.' 'DarkGray'
    Die 'Nothing was copied.'
  }
}

# --------------------------------------------------------------- files ---
<#
  STAGED, CHECKED, THEN SWAPPED, issue #446.

  This used to copy every file straight over the running bot, without looking
  at a single scp exit code, and then restart it, so a copy that failed half
  way was loaded half new at the next start. Now the files go into
  $Root\.stage-<stamp> while the bot runs, every copy is checked, and the box
  checks the stage (each file by its hash, bot.py and card.py through Python's
  own parser). Nothing is stopped if that fails. The swap then stops the
  service by name, renames the files in (what they replace goes to
  $Root\.prev-<stamp>, the newest two kept, and so does anything in the
  folder this run did not send that is not the bot's own, issue #1184),
  starts it by name, and waits
  for this start to say it is watching its server. If it does not, the old
  files go back and the service is started again on them. -PutBack puts the
  newest .prev folder back the same way.
#>
$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$stageName = '.stage-' + $stamp
$prevName  = '.prev-' + $stamp
$hashes    = [ordered]@{}
if (-not $PutBack) {
Head 'Staging it'
# staff-channel.txt goes up with the code, and it is not an afterthought.
#
# It holds the id of #staff-updates, where the bot says the watchdog's messages
# and the sessions that went wrong (bot.py, WATCH_ID and TROUBLE_ID). The
# channel id file was not in this list on 21 September, so the first run of the
# watcher on the VPS said "in channel 0" and would have found the site down and
# had nowhere to say so. The id is not a secret and the file is tracked in git,
# unlike the webhook files that sit on the box, which are not sent by anything
# and must not be added here.
#
# dev-channel.txt goes up again (#5187). It is the dev updates channel, and
# the bot posts each dev release's news there by its id (watch_release_news).
# From #2501 until then it was not sent: the bot read it for the watchdog until
# 12 Oct, which put every outage among the dev release posts. The watchdog
# reads only staff-channel.txt now (test-watch-services.py W6 holds it), so
# sending this file cannot bring that back.
#
# requirements.txt too, because the full run installs the libraries from it.
#
# The Live smoke export went up with these from 6 Oct (#2018) until the Live
# smoke checklist was taken out on 11 Oct. Nothing reads it now. The join-card
# harness's point is that joins.json, the bot's own record, is never sent; it
# still checks that.
#
# factions.json too: the named factions the Faction Leader form reads from
# beside itself. A file this list does not name never reaches the box.
$send = [ordered]@{}
# _pyguard.py is the Python version check bot.py imports first (#2276),
# trust.py says which roots it trusts (#3111), and bot_*.py are the bot's
# modules, the ones bot.py imports (#5357, Bot-Code.ps1).
foreach ($f in @(Get-ThornswoodBotCode $Repo) + @('staff-channel.txt', 'dev-channel.txt', 'requirements.txt', 'factions.json')) {
  $src = Join-Path $Repo "bot\$f"
  if (-not (Test-Path $src)) { Die "missing: $src" }
  $send[$f] = $src
}
# No roll-log.ps1 any more: the service rolls bot.log itself, by size, while
# the bot runs (BotService.cs).

$art = Join-Path $Repo 'bot\assets\join-card.png'
if (Test-Path $art) { $send['assets/join-card.png'] = $art }
else { Say '  no join-card.png, cards will fall back to a plain background' 'Yellow' }

# The bot reads what the site writes for it from the site's data\for-bot
# (issue #1102), which the site's own code makes and moves those files into.
# A bot sent before the site has done that would find nothing there, and once
# the site moved them it would read every row as new and say each one in the
# staff channel. So the site goes first.
$forBot = @(Remote "if (Test-Path -LiteralPath '$docsWin\data\for-bot') { 'FOR-BOT THERE' } else { 'NO FOR-BOT' }" | ForEach-Object { "$_".Trim() })
if ($forBot -notcontains 'FOR-BOT THERE') {
  Die "the site has not made $docsWin\data\for-bot yet, where the bot now reads what the site writes for it. Run .\scripts\deploy\Deploy-Docs.ps1 first, then this again. Nothing on the box was changed."
}
# The other way round (issue #3140): the bot writes the site's Known Issues
# page and roadmap into data\from-bot, which the site makes and reads. A bot
# sent first could not write them, and the grant below needs the folder there.
$fromBot = @(Remote "if (Test-Path -LiteralPath '$docsWin\data\from-bot') { 'FROM-BOT THERE' } else { 'NO FROM-BOT' }" | ForEach-Object { "$_".Trim() })
if ($fromBot -notcontains 'FROM-BOT THERE') {
  Die "the site has not made $docsWin\data\from-bot yet, where the bot writes the site's known issues and roadmap. Run .\scripts\deploy\Deploy-Docs.ps1 first, then this again. Nothing on the box was changed."
}

# A stage a run that died part way left behind was never swapped in.
$made = @(Remote @"
New-Item -ItemType Directory -Force -Path '$rootWin','$rootWin\assets' | Out-Null
Get-ChildItem -LiteralPath '$rootWin' -Directory -Force -EA SilentlyContinue |
  Where-Object { `$_.Name -like '.stage-*' } |
  ForEach-Object { Remove-Item -LiteralPath `$_.FullName -Recurse -Force -EA SilentlyContinue }
New-Item -ItemType Directory -Force -Path '$rootWin\$stageName\assets' | Out-Null
'ready'
"@ | ForEach-Object { "$_".Trim() })
if ($made -notcontains 'ready') { Die "could not make $rootWin\$stageName on the VPS. The bot was not touched." }
foreach ($rel in $send.Keys) {
  Invoke-ThornswoodNative { & scp @ssh $send[$rel] "${User}@${Vps}:$Root/$stageName/$rel" } | Out-Null
  if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE for $rel. The bot was not touched." }
  Say "  $rel" 'Green'
}
$hashes = Get-SwapHashes $send
$checkOut = @(Remote ((ServiceSwapVars $Root $stageName $prevName $Wait $hashes @(Get-ThornswoodBotCode $Repo)) + $serviceCheckBlock) |
              ForEach-Object { Say "  $_"; "$_".Trim() })
if ($checkOut -notcontains 'STAGE OK') { Die 'the stage did not check out, so the bot was not stopped or changed. The lines above say why.' }
}

# ==== thornswood bot hooks ====
# What is particular to the bot, for Swap.ps1's service swap, in front of
# which Bot-Service.ps1 goes: stopped by the service's name, with one sweep
# for a copy somebody started by hand, which is still a bot holding the token
# (issue #465); started by name. Healthy when this start has written 'watching
# N server' to bot.log, which bot.py says once it is connected and has read
# the roles, and not merely when the service says Running: a bot.py that fails
# on import is running for a second at a time. A box with no service yet, on a
# full run that is about to install it, has nothing to start or check here.
#
# The one case where the service saying Running is taken as the answer is a
# start that wrote no line at all, to either place the log can be. That is a
# log that could not be read, not a bot that failed, and it is never grounds
# for putting the old code back over a bot that is up. Said in the PASS line
# when it happens, with Show-BotLog.ps1 to read the bot itself.
#
# StartIt is the only thing that starts the bot, and the swap block calls it
# twice: once on the new files, and again on the old ones when the new ones
# did not come up. Both go through Restart-ThornswoodBotService, which is
# Stop-Service, the sweep, Start-Service, each said in a line of its own
# (scripts\vps\Bot-Service.ps1). So a -CodeOnly run that ends either way
# leaves the service started, and a run that could not start it says
# 'THE SERVICE DID NOT START' with the reason.
$botHooks = @"
`$log = Get-ThornswoodBotLog '$rootWin'
`$before = 0
# The other place the bot's log can be, for FollowLog below: data\bot.log
# since #1104, bot.log beside the code before it.
`$otherLog = Join-Path '$rootWin' 'bot.log'
if (`$log -eq `$otherLog) { `$otherLog = Join-Path (Join-Path '$rootWin' 'data') 'bot.log' }
`$otherBefore = 0
`$saidNothing = `$false
`$freshWhy = ''
`$followed = ''
`$hasService = [bool](Get-Service -Name '$Service' -EA SilentlyContinue)
if (-not `$hasService -and -not `$NoServiceOk) {
  'THE BOT SERVICE IS NOT INSTALLED HERE. Run Install-Bot.ps1 once without -CodeOnly: it puts the service in place of the old loop.'
  'SWAP REFUSED'
  exit 1
}
function StopIt {
  if (`$hasService) {
    try { Stop-ThornswoodBotService '$Service' }
    catch { 'COULD NOT STOP the service $Service' + ': ' + `$_.Exception.Message }
  }
  `$left = @(@(`$ThornswoodStillRunning) + @(`$ThornswoodNotHeld) | Where-Object { `$_ })
  Stop-ThornswoodBotStrays '$rootWin'
  # The swap reads both after StopIt: what the service stop left counts too.
  `$script:ThornswoodStillRunning = @(@(`$ThornswoodStillRunning) + `$left | Where-Object { `$_ })
}
# NOTHING HERE MAY NEED THE LOG TO BE THERE ALREADY, AND THE PATH PEOPLE ARE
# TOLD TO LOOK AT IS LEFT ON THE BOX BY EVERY RUN, GREEN OR NOT.
#
# Two things, both on every run. First the data folder, because the service
# opens its log before it starts python, so a folder that is not there, or
# that its account cannot write, is a service that does not start at all
# (Repair-ThornswoodBotData, scripts\vps\Bot-Service.ps1). Then data\bot.log,
# which is where the bot's log has gone since #1104: made empty when it is not
# there, whichever of the two files this run reads, so after a -CodeOnly run
# the path in the docs and in Show-BotLog.ps1 is a file that exists. It used
# to be skipped whenever the log beside the code was the one being read, which
# is every box that has had only -CodeOnly runs since #1104, because those
# leave the service program as it is and an older program writes the old
# place.
#
# Then the file this run reads, when that is the old place and it is not
# there either. Fresh opens it with FileMode.Open, which finds nothing to open
# and hands back no lines, so with nothing writing it Healthy waits out the
# whole of `$Wait, the swap puts the old code back, waits `$Wait again, and Why
# says 'nothing yet' about a file nobody had been told was missing.
#
# Making the newer file does not point the readers at it while the bot writes
# the older one: Get-ThornswoodBotLog takes the one written last when both are
# there, and `$log here was settled before any of this ran. The service opens
# its log with FileMode.Append and writes into an empty file as it is
# (BotService.cs), and a file made in data takes that folder's rules, so
# nothing changes about what the bot may write.
function MakeLog {
  Repair-ThornswoodBotData -Root '$rootWin' -Name '$Service'
  `$data = Join-Path '$rootWin' 'data'
  `$new = Join-Path `$data 'bot.log'
  if (-not (Test-Path -LiteralPath `$new)) {
    if (-not (Test-Path -LiteralPath `$data)) { 'COULD NOT MAKE ' + `$new + ': ' + `$data + ' is not there' }
    else {
      try { [IO.File]::WriteAllText(`$new, ''); 'made an empty ' + `$new + ', which is where the bot''s log goes and where Show-BotLog.ps1 reads it' }
      catch { 'COULD NOT MAKE ' + `$new + ': ' + `$_.Exception.Message }
    }
  }
  if (Test-Path -LiteralPath `$log) { return }
  `$dir = Split-Path -Parent `$log
  if (`$dir -and -not (Test-Path -LiteralPath `$dir)) { 'COULD NOT MAKE ' + `$dir + ', so this start has nowhere to write its log'; return }
  try { [IO.File]::WriteAllText(`$log, ''); 'there was no bot.log here, so an empty one is made for this start to write into: ' + `$log }
  catch { 'COULD NOT MAKE ' + `$log + ': ' + `$_.Exception.Message }
}
function StartIt {
  MakeLog
  `$script:before = 0
  if (Test-Path -LiteralPath `$log) { `$script:before = (Get-Item -LiteralPath `$log).Length }
  # The other place's length as well, so FollowLog can tell a file this start
  # wrote from one that has been sitting there since before it.
  `$script:otherBefore = 0
  if (Test-Path -LiteralPath `$otherLog) { `$script:otherBefore = (Get-Item -LiteralPath `$otherLog).Length }
  if (`$hasService) { Restart-ThornswoodBotService -Name '$Service' -Root '$rootWin' }
}
# Which of the two files this start is really writing. With no log on the box
# at all, Get-ThornswoodBotLog can only name the newer place, data\bot.log,
# and a box whose service program is older writes the one beside the code: the
# health check would then read an empty file it had just made while the bot
# talked to the other one. So when the file being watched has not been written
# and the other one has grown since the start, the other one is the log, read
# from its beginning. A file that was already long before the start is not a
# file this start wrote, which is why both lengths are taken above.
#
# NOT ONE LINE GOES TO THE OUTPUT STREAM HERE. Healthy calls this and hands
# back one true or false, and a line of its own in that stream would make the
# caller's 'if (Healthy)' an array, which is true whatever the check found, so
# nothing would ever roll back. Which file it read is said by Answer and by
# Why, which are written to be read.
function FollowLog {
  `$f = Get-Item -LiteralPath `$log -EA SilentlyContinue
  if (`$f -and `$f.Length -gt `$before) { return }
  `$o = Get-Item -LiteralPath `$otherLog -EA SilentlyContinue
  if (-not `$o -or `$o.Length -le `$otherBefore) { return }
  `$script:followed = `$otherLog
  `$script:log = `$otherLog
  `$script:before = 0
}
# Only what this start wrote. The file is held open by the service, so it is
# read with FileShare ReadWrite or not at all. Shorter than before means it
# rolled, so all of it is this start.
function Fresh {
  `$out = @()
  # No log yet is no lines, which Healthy and Why read for themselves. One
  # that is there and cannot be opened is said, in place of no lines.
  `$script:freshWhy = ''
  if (-not (Test-Path -LiteralPath `$log)) { return `$out }
  `$fs = `$null
  try {
    `$fs = New-Object IO.FileStream(`$log, 'Open', 'Read', 'ReadWrite')
    `$from = `$before
    if (`$fs.Length -lt `$from) { `$from = 0 }
    if (`$fs.Length -gt `$from) {
      [void]`$fs.Seek(`$from, 'Begin')
      `$sr = New-Object IO.StreamReader(`$fs, [Text.Encoding]::UTF8)
      `$out = @((`$sr.ReadToEnd()) -split "\r?\n")
      `$sr.Close()
    }
  } catch { `$script:freshWhy = `$log + ' could not be read: ' + `$_.Exception.Message }
  if (`$fs) { `$fs.Dispose() }
  return `$out
}
function Healthy {
  if (-not `$hasService) { return `$true }
  `$until = (Get-Date).AddSeconds(`$Wait)
  while (`$true) {
    FollowLog
    `$said = @(Fresh)
    if (@(`$said -match 'watching \d+ server').Count -and (Get-Service -Name '$Service').Status -eq 'Running') { return `$true }
    if (@(`$said -match 'stopped within').Count) { return `$false }
    if ((Get-Date) -gt `$until) {
      # NOT A FAILURE: a start that wrote no line at all, to either place the
      # log can be, while the service is Running. The log is how this tells a
      # bot that came up from one restarting on a broken import, and it is
      # the better answer whenever there are lines to read. With none there
      # is nothing to read rather than something bad to read, and putting the
      # old code back over a bot that is up is the worse of the two mistakes.
      # Said in the PASS line, so nobody takes it for the full check.
      if (-not `$said.Count -and (Get-Service -Name '$Service').Status -eq 'Running') {
        `$script:saidNothing = `$true
        return `$true
      }
      return `$false
    }
    Start-Sleep -Seconds 2
  }
}
function Answer {
  if (-not `$hasService) { return 'the files are in; the service is installed below' }
  `$s = 'service $Service is ' + (Get-Service -Name '$Service').Status
  if (`$followed) { `$s += ', writing its log to ' + `$followed }
  if (`$saidNothing -and `$freshWhy) { return `$s + ', and the code is in, but ' + `$freshWhy + '. Read the bot''s own lines with Show-BotLog.ps1.' }
  if (`$saidNothing) { return `$s + ', and the code is in, but this start wrote nothing to ' + `$log + '. Read the bot''s own lines with Show-BotLog.ps1.' }
  return `$s + ', and the bot says it is watching its server'
}
function Why {
  '--- what the bot said this time ---'
  if (`$followed) { 'read from ' + `$followed + ', which is the file this start wrote' }
  if (-not (Test-Path -LiteralPath `$log)) {
    'there is no ' + `$log + ' to read, so nothing was written at all. Since #1104 the bot''s log is in the data folder under its own folder, not beside the code.'
    return
  }
  `$said = @(Fresh | Where-Object { `$_ -match '^\s*\[(thornswood-bot|run|service)\]' -or `$_ -match 'Error|Traceback' })
  if (`$said.Count) { `$said | Select-Object -Last 25 } elseif (`$freshWhy) { `$freshWhy } else { 'nothing yet' }
}

"@
# ==== end thornswood bot hooks ====

# The swap itself, for -CodeOnly, -PutBack and a full run. Hands back what the
# box said. A full run may meet a box with no service yet, which the service
# install below then puts in.
function Invoke-BotSwap([bool]$noServiceOk) {
  $pick = ''
  if ($PutBack) { $pick = $putBackPick }
  $svcLib = Join-Path $Here '..\vps\Bot-Service.ps1'
  if (-not (Test-Path -LiteralPath $svcLib)) { Die "missing: $svcLib" }
  $vars = (ServiceSwapVars $Root $stageName $prevName $Wait $hashes @() $Service) + ('$NoServiceOk = $' + $noServiceOk + "`r`n") + ('$Dirs = @(''py-libs'')' + "`r`n")
  # The bot's folder holds what this run sends and what is the bot's own
  # (Get-ThornswoodBotOwned, issue #1184), so the swap moves anything else
  # there aside with what the new code replaces. After Bot-Service.ps1, which
  # defines the list. -PutBack sends nothing to hold the folder to, so it
  # looks at nothing.
  $owns = ''
  if (-not $PutBack) { $owns = '$Owns = @(Get-ThornswoodBotOwned)' + "`r`n" }
  $out = @(Remote ($vars + (Get-ThornswoodHoldScript -Script 'Install-Bot.ps1') + $ThornswoodStopAndMoveText + (Get-Content -LiteralPath $svcLib -Raw) + "`n" + $owns + $botHooks + $pick + $serviceSwapBlock) |
           ForEach-Object { Say "  $_"; "$_".Trim() })
  if (-not (Show-SwapResult $out "$rootWin\.prev-<stamp>")) { Die 'the bot was not swapped in. The lines above say what is running.' }
  return $out
}

# ==== what the box has ====
#
# WHAT IS REALLY AT THE INSTALL ROOT, ASKED OF THE BOX, AFTER THE SWAP.
#
# A run said artifact, 8 files, STAGE OK, SWAP OK and the bot watching, and
# then Test-Path on C:\Thornswood-Bot\data\bot.log and on
# the Live smoke export (since retired) at the same root both answered False. Every
# line the run printed was about the box; the two answers were about whatever
# machine typed them, and C:\Thornswood-Bot is a folder on the VPS. Nothing
# in the run itself had ever said what those paths hold on the box, so there
# was no way to tell that apart from a swap that had left files behind, and
# the whole deploy was stopped for a day over it.
#
# So the run answers it. This asks the box, in one line per file, for the
# full path under the same root the swap moved the files to, and says which
# machine it asked. It also makes data\bot.log once more, after the start
# rather than before it: MakeLog in the hooks above makes it in front of the
# start, and this is the same two things again at the end, so a green run
# cannot finish with that path absent whatever the service did in between.
#
# A file that is not there turns the run red (FILES MISSING below), because a
# run that ends green while the bot has no export to read is the failure this
# whole block exists to stop.
#
# Single quoted and taking its values from the lines BotThereVars puts in
# front of it, like Swap.ps1's blocks, so what goes up is plain PowerShell a
# person can read and tests\test-bot-service.ps1 can run it against a scratch
# folder, with and without the export, while tests\test-deploy-swaps.ps1 reads
# its lines out of a whole -CodeOnly run. Keep it ASCII. Bot-Service.ps1 goes
# in front of it for Repair-ThornswoodBotData.
$botThereBlock = @'
$ErrorActionPreference = 'Continue'
'asked of ' + [Environment]::MachineName + ', where the bot runs from ' + $Root
# The folder the service writes, then the log in it. Repair makes the folder
# and grants the account what it needs when it had to make it; it says
# nothing when there was nothing to do.
Repair-ThornswoodBotData -Root $Root -Name $Service
$log = Join-Path (Join-Path $Root 'data') 'bot.log'
if (-not (Test-Path -LiteralPath $log)) {
  try { [IO.File]::WriteAllText($log, ''); 'made an empty ' + $log + ', which is where the bot writes its log and where Show-BotLog.ps1 reads it' }
  catch { 'COULD NOT MAKE ' + $log + ': ' + $_.Exception.Message }
}
# Test-Path by its own name, with the path it was given, because that is the
# command whose two False answers started this. The log is checked as the
# same path that was just made, rather than as a second spelling of it.
$each = @()
foreach ($rel in @($Must)) { if ($rel) { $each += (Join-Path $Root ($rel -replace '/', '\')) } }
$each += $log
$gone = @()
foreach ($at in $each) {
  if (Test-Path -LiteralPath $at) { 'Test-Path ' + $at + '  True' }
  else { 'Test-Path ' + $at + '  False'; $gone += $at }
}
if ($gone.Count) {
  'THE BOX DOES NOT HOLD ' + $gone.Count + ' of them: ' + ($gone -join ', ')
  'FILES MISSING'
} else {
  'every file this run sent is at ' + $Root + ' on the box, and so is data\bot.log'
  'FILES ON THE BOX'
}
'@
# ==== end what the box has ====

# The values that block runs with, quoted once here, every single quote
# doubled, the way ServiceSwapVars does it.
function BotThereVars([string]$farRoot, [string]$service, [string[]]$must) {
  $q = { param($s) "'" + ([string]$s).Replace("'", "''") + "'" }
  $lines = @(
    ('$Root    = ' + (& $q $farRoot.Replace('/', '\'))),
    ('$Service = ' + (& $q $service)),
    ('$Must    = @(' + ((@($must | Where-Object { $_ }) | ForEach-Object { & $q $_ }) -join ', ') + ')')
  )
  return (($lines -join "`r`n") + "`r`n")
}

# Asks the box and prints what it said. $true only when every file is there.
function Confirm-BotFiles([string[]]$must) {
  $svcLib = Join-Path $Here '..\vps\Bot-Service.ps1'
  if (-not (Test-Path -LiteralPath $svcLib)) { Die "missing: $svcLib" }
  Head 'What the box has, at the folder the swap moved them to'
  $out = @(Remote ((BotThereVars $Root $Service $must) + (Get-ThornswoodHoldScript -Script 'Install-Bot.ps1') + $ThornswoodStopAndMoveText + (Get-Content -LiteralPath $svcLib -Raw) + "`n" + $botThereBlock) |
           ForEach-Object {
             $s = "$_".Trim()
             $c = 'Gray'
             if ($s -match 'False$|MISSING|COULD NOT|DOES NOT HOLD') { $c = 'Red' }
             elseif ($s -match 'True$|FILES ON THE BOX') { $c = 'Green' }
             Say "  $s" $c
             $s
           })
  Say '  Those are paths on the VPS. The same Test-Path typed on this machine answers for' 'DarkGray'
  Say '  a folder this machine does not have, and is False whatever the box holds.' 'DarkGray'
  return ($out -contains 'FILES ON THE BOX')
}

# The box records that the bot runs this artifact (Artifact.ps1), and only
# once the service is running on it (issue #465) and the swap has answered
# (issue #446): -CodeOnly after the swap, a full run after the service
# install. The record it had goes into .prev with the files it describes, so
# -PutBack brings it back (Swap.ps1). A run that ends with the bot stopped
# records nothing, so the record never names code that is not up.
function Save-BotRecord {
  Save-SwapPreviousRecord "$User@$Vps" $ssh $Root $prevName
  $null = Set-ThornswoodArtifactCurrent -Artifact $artifact -Target "$User@$Vps" -SshArgs $ssh -Root $Root
}

# ----------------------------------------------------------- code only ---
# A change to bot.py and nothing else, which is most of them.
#
# The full run checks Python, reinstalls three libraries over the network,
# rewrites bot.env.json and re-installs the service, and none of that has
# anything to do with the code having changed. This swaps the staged files in
# and restarts the service by name, which is the whole job, and it never asks
# for the token, so it runs unattended. -PutBack is the same swap with the
# newest .prev folder in place of the stage.
if ($CodeOnly -or $PutBack) {
    if ($PutBack) { Head 'Putting the last files back' } else { Head 'Swapping it in' }
    $restart = Invoke-BotSwap $false

    # The box is asked what is at the install root, and the run is red if
    # anything this deploy sent is not there. In front of the record, so the
    # box never records as the bot's code a set of files it does not hold.
    # -PutBack sends nothing, so there is no list to hold the box to.
    if (-not $PutBack -and -not (Confirm-BotFiles @($send.Keys))) {
        Die 'the swap answered but the box does not hold every file this run sent. The lines above name each one, with the full path on the box. Run .\scripts\deploy\Install-Bot.ps1 -CodeOnly again, and if it says the same thing, look at that folder on the VPS.'
    }

    if ($PutBack) { Restore-SwapRecord "$User@$Vps" $ssh $Root $restart '' 'bot' }
    elseif ($restart -contains 'SWAP OK') {
        if ("$restart" -match ('service ' + $Service + ' is Running')) { Save-BotRecord }
        else { Say '  The service is not running, so the box does not record this code as the bot''s.' 'Yellow' }
    }

    # The swap went by the service alone, because the bot wrote no line to
    # either place its log can be. The code is in and the service is up; what
    # is missing is the bot's own word for it, which this says where to read.
    if ("$restart" -match 'wrote nothing to') {
        Write-Host ''
        Say '  The code is in and the service is up, but the bot wrote nothing to its log this' 'Yellow'
        Say '  start, so this went by the service alone. Read what it is saying with:' 'Yellow'
        Say '    .\scripts\vps\Show-BotLog.ps1' 'Green'
    }

    Write-Host ''
    Say '  Code only. Python, the libraries, the token and the service were left alone.' 'DarkGray'
    Say '  The ticket panel updates itself on startup, so a changed panel is already up.' 'DarkGray'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ---------------------------------------------------------------- deps ---
Head 'Its two libraries'
$libs = @(Remote @"
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
Set-Location '$rootWin'
# certifi as well as the other two. Windows Server ships with an empty root
# certificate store and Automatic Root Certificates Update switched off by
# policy, so Python cannot verify discord.com and aiohttp fails the handshake
# with "unable to get local issuer certificate". Carrying the roots in a file
# sidesteps the whole thing.
#
# At the exact versions in requirements.txt, which went up with the code. By
# name alone this took whatever PyPI had newest on the day, so the next fresh
# box would have taken the next major of any of the three, untried. The
# build check installs the same file before it runs the bot harnesses, so the
# versions tested are the versions run. Bump them there, on purpose.
#
# Into py-libs in the stage, not into the machine's Python. The swap moves
# that folder in with the code and puts the old one back when the bot does
# not come up, so a bump that breaks the start does not leave the new
# libraries under the old code (#1076).
#
# By hash as well as version (#2190): requirements.txt lists every library
# the bot pulls in with the sha256 of each published wheel, and
# --require-hashes refuses a file that does not match or a library it does
# not list. Wheels only, so nothing is built from source on the box.
New-Item -ItemType Directory -Force -Path '$rootWin\$stageName\py-libs' | Out-Null
& python -m pip install --quiet --disable-pip-version-check --require-hashes --only-binary :all: --upgrade --target '$rootWin\$stageName\py-libs' -r '$rootWin\$stageName\requirements.txt' 2>&1 | Out-Null
if (`$LASTEXITCODE -eq 0) { 'discord.py, pillow and certifi ready, in py-libs, at the versions in requirements.txt' } else { 'PIP FAILED with ' + `$LASTEXITCODE }
# pip --target builds in a folder made by Python's tempfile.mkdtemp, which on
# Windows (Python 3.12.4 and later) holds only SYSTEM, Administrators and its
# owner, with no inheritance, and then renames the files into py-libs. A
# rename keeps them that way, so the bot's own account could not read its
# libraries: on 11 Oct the first full install since py-libs came in (#1543)
# stopped on PermissionError for typing_extensions.py and rolled back. Put
# every file under the stage's own rules, the bot folder's, and refuse
# before the bot is stopped if its account still cannot read one.
& icacls '$rootWin\$stageName\py-libs' /reset /T /Q 2>&1 | Out-Null
if (`$LASTEXITCODE -ne 0) { 'PY-LIBS NOT RESET: icacls exited ' + `$LASTEXITCODE }
`$rx = [Security.AccessControl.FileSystemRights]::ReadAndExecute
`$shut = @(Get-ChildItem -LiteralPath '$rootWin\$stageName\py-libs' -File -Recurse | Where-Object {
  -not @((Get-Acl -LiteralPath `$_.FullName).Access | Where-Object {
    `$_.IdentityReference.Value -eq 'NT SERVICE\$Service' -and `$_.AccessControlType -eq 'Allow' -and (`$_.FileSystemRights -band `$rx) -eq `$rx })
})
if (`$shut.Count) { 'PY-LIBS NOT READABLE by NT SERVICE\${Service}: ' + `$shut.Count + ' file(s), first ' + `$shut[0].Name }
# The roots the bot will trust: certifi's from these libraries, less what
# trust.py leaves out (#3111). The bot writes the same set into data\roots.pem
# at every start; this says it before anything is stopped, and stops the run
# when the staged trust.py cannot make it from what was installed.
`$env:PYTHONPATH = '$rootWin\$stageName\py-libs'
`$said = @(& python '$rootWin\$stageName\trust.py' 2>&1 | ForEach-Object { "`$_" })
if (`$LASTEXITCODE -eq 0) { `$said | ForEach-Object { 'roots: ' + `$_ } } else { 'ROOTS NOT MADE: ' + (`$said -join ' ') }
"@)
$libs | ForEach-Object { Say "  $_" }
if ("$libs" -match 'PIP FAILED') { Die 'the libraries did not install into py-libs, so the bot was not stopped or changed.' }
if ("$libs" -match 'PY-LIBS NOT') { Die "the bot's account could not read py-libs, so the bot was not stopped or changed." }
if ("$libs" -match 'ROOTS NOT MADE') { Die "trust.py could not make the bot's roots from the certifi in py-libs, so the bot was not stopped or changed." }

# --------------------------------------------------------------- token ---
$token = ''
if (-not $NoToken) {
  Head 'The bot token'
  Say '  Same one Setup-Discord.ps1 wants. Leave blank to keep what is up there.' 'DarkGray'
  $ss = Read-Host '  Paste it' -AsSecureString
  if ($ss -and $ss.Length -gt 0) {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)).Trim()
  }
}

# A key the site can check, so /api/ticket is not open to whoever finds it.
function NewKey([int]$n) {
  $out = ''
  while ($out.Length -lt $n) {
    $b = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    $out += ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]','')
  }
  return $out.Substring(0, $n)
}
$botKey = NewKey 32
$KeyMode = if ($RotateKey) { 'new' } else { 'keep' }

# The token and the key go on ssh's standard input, never in the script or on
# a command line on either machine (Send-Secret.ps1, issue #451).
$payload = @{ token = $token; key = $botKey } | ConvertTo-Json -Compress
$token = $null

# The one writer of the token, which puts it in bot.env.json and the site's
# config.json together or in neither (issue #466). It goes up in front of the
# settings script, so both run in the same session on the VPS.
$writer = Join-Path $Here '..\vps\Write-BotToken.ps1'
if (-not (Test-Path -LiteralPath $writer)) { Die "missing: $writer" }

Head 'Settings, and the key the site will check'
$settings = Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $payload -Script ((Get-ThornswoodHoldScript -Script 'Install-Bot.ps1') + (Get-Content -LiteralPath $writer -Raw) + "`n" + @"
`$ErrorActionPreference = 'Stop'
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
`$p = `$null
if (-not `$ThornswoodSecret) { 'NOTHING ARRIVED on standard input. Nothing written.'; return }
# The parse error is not said: its text would quote what arrived, the token.
try { `$p = `$ThornswoodSecret | ConvertFrom-Json }
catch { `$ThornswoodSecret = `$null; 'SETTINGS NOT WRITTEN: what arrived on standard input is not the JSON Install-Bot.ps1 sends. Nothing written.'; return }
`$ThornswoodSecret = `$null
if (-not `$p) { 'NOTHING ARRIVED on standard input. Nothing written.'; return }

# The bot's own env file. Kept out of the repo and readable by this account only.
`$f = '$rootWin\bot.env.json'
# One that is there and does not read is not empty: written over, it would
# lose the key the doors hold and the ping address, so nothing is written.
`$env2 = @{}
if (Test-Path `$f) {
  try { `$env2 = Read-ThornswoodJsonFile `$f }
  catch { 'SETTINGS NOT WRITTEN: ' + `$_.Exception.Message + ', and it is left as it is. Put it right, or move it aside to start it over. Nothing written.'; return }
}
# The token is not written here. Write-ThornswoodBotToken writes it below,
# into this file and the site's config.json together, once both exist.
`$env2['THORNSWOOD_SITE'] = 'https://thornswood.net'
`$changed = `$false
if ('$KeyMode' -eq 'new' -or -not `$env2['THORNSWOOD_KEY']) {
  `$env2['THORNSWOOD_KEY'] = `$p.key
  `$changed = `$true
}
`$env2['JOIN_CHANNEL']    = '$JoinChannel'
`$env2['TICKET_CHANNEL']  = '$TicketChannel'
`$env2['TICKET_LOG']      = '$TicketLog'
`$env2['STAFF_ROLES']     = '$StaffRoles'
`$env2['CREATOR_ROLES']   = '$CreatorRoles'
# Only when this run passed -UpperStaffRoles. An omitted switch must not
# wipe a list that is already in bot.env.json.
if ('$($PSBoundParameters.ContainsKey('UpperStaffRoles'))' -eq 'True') {
  `$env2['UPPER_STAFF_ROLES'] = '$UpperStaffRoles'
}
# Piped, Python writes in the machine's ANSI codepage and PowerShell reads the
# pipe as OEM. Anything outside plain ASCII, a role name or a channel name with
# an accent in it, came out of that as a screenful of question marks. Both ends
# are told UTF-8 instead, here and by the service (BotService.cs).
`$env2['PYTHONIOENCODING'] = 'utf-8'
# The libraries folder beside the code. The service already running copies
# this into python's environment on the restart the swap does, and the new
# service program sets the same path itself.
`$env2['PYTHONPATH'] = '$rootWin\py-libs'

# No SSL_CERT_FILE. The bot writes its own roots at every start and names them
# itself (bot.py, trust.py, #3111). The one set here was certifi's bundle as
# this shell's Python found it, with nothing of py-libs on its path, so it
# was not the certifi requirements.txt pins. One an earlier run wrote goes, so
# bot.env.json does not name a file the bot no longer reads.
foreach (`$k in 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE') { if (`$env2.Contains(`$k)) { `$env2.Remove(`$k) } }
[IO.File]::WriteAllText(`$f, (`$env2 | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding(`$false)))
# Locked down, but not so far that the thing meant to read it cannot: SYSTEM,
# Administrators and this account, plus read for NT SERVICE\ThornswoodBot,
# given in the same write (Protect-ThornswoodBotEnv in Write-BotToken.ps1,
# issue #2158), and for the nightly backup's own task account, NT TASK\
# Thornswood Backup, when the box has it (#2836). A file its reader cannot
# open is how the swap once failed and left the bot stopped.
try { Protect-ThornswoodBotEnv -Path `$f -Service '$Service' }
catch { 'could not tighten bot.env.json: ' + `$_.Exception.Message }
'panel channel: #' + (`$env2['TICKET_CHANNEL'] -replace ',', ' or #')
'closed tickets: #' + (`$env2['TICKET_LOG'] -replace ',', ' or #') + '  (staff only)'
'join cards:    #' + `$env2['JOIN_CHANNEL']
'staff:         ' + `$env2['STAFF_ROLES']
'creator only:  ' + `$env2['CREATOR_ROLES']
'upper staff:   ' + `$env2['UPPER_STAFF_ROLES']
if (-not [string]`$env2['UPPER_STAFF_ROLES']) {
  'WARNING: UPPER_STAFF_ROLES is empty. Faction Leader applications will be refused until it is set to the Owner role ID and the Lead Gamemaster role ID.'
}

# The same key into the site's config, so it accepts the bot and nobody else.
# Never over a config.json that is there and does not parse: it is not empty,
# it is unreadable, and writing a fresh one over it is how the whole Discord
# setup, client secret and token included, went once already.
`$c = '$docsWin\config.json'
`$cfg = @{}
`$cfgOk = `$true
if (Test-Path `$c) {
  try { (Get-Content `$c -Raw | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { `$cfg[`$_.Name] = `$_.Value } } catch { `$cfgOk = `$false }
}
if (`$cfgOk) {
  `$cfg['botKey'] = `$env2['THORNSWOOD_KEY']
  [IO.File]::WriteAllText(`$c, (`$cfg | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding(`$false)))
} else {
  `$changed = `$false
  'SITE CONFIG DOES NOT PARSE: ' + `$c + ' was left as it is, and neither the key nor the token went into it'
}

# The token, into both files or neither. Blank at the prompt keeps what is there.
`$tokenChanged = `$false
if (`$p.token) {
  `$r = Write-ThornswoodBotToken -Token `$p.token -BotEnv `$f -SiteConfig `$c
  `$r.Lines
  `$tokenChanged = [bool]`$r.Changed
}
Get-ThornswoodBotTokenState -BotEnv `$f -SiteConfig `$c

# The site reads config.json once, when it starts, so a new key or token means
# nothing to it until it restarts.
if (`$changed -or `$tokenChanged) {
  if (`$changed) { 'site told about a NEW key' }
  Restart-ThornswoodSite -Root '$docsWin' -Task '$SiteTask'
} else { 'key and token unchanged, the site does not need restarting' }
"@)
$payload = $null; $botKey = $null
$settings | ForEach-Object { Say "  $_" }
# Before the swap: new code over settings that were not written is a bot whose
# settings nobody chose (#2711).
if (@($settings | Where-Object { "$_" -like 'SETTINGS NOT WRITTEN*' }).Count) {
  Die 'the settings on the box were not written (the line above says why), so the new code was not swapped in. The bot is running as it was, and the next run clears the stage.'
}

# ---------------------------------------------------------------- swap ---
# The staged code in, with the old service stopped and started again by name,
# and the old code back if it does not come up (issue #446). A box with no
# service yet gets the files, and the install below starts them.
Head 'Swapping it in'
$null = Invoke-BotSwap $true

# -------------------------------------------------------------- runner ---
# The bot as the Windows service ThornswoodBot, under its own account (issue
# #465). BotService.cs is the program the service runs: python bot.py with
# bot.env.json as its environment, bot.log written and rolled by size, python
# started again when it exits, three quick exits and it stops. It is built on
# the box by Bot-Service.ps1, which also takes off the old way: the scheduled
# task that ran run.ps1 as SYSTEM, and run.ps1 and roll-log.ps1 with it.
#
# Nothing on the box is stopped until python has been checked and the program
# has built beside the old one, so a failure there leaves the running bot as
# it is.
Head 'Keeping it running'
$svcLib = Join-Path $Here '..\vps\Bot-Service.ps1'
# From the artifact, like the bot's own files: the program is part of what
# the box records as running.
$svcSrc = Join-Path $Repo 'scripts\vps\BotService.cs'
foreach ($f in $svcLib, $svcSrc) { if (-not (Test-Path -LiteralPath $f)) { Die "missing: $f" } }
$null = Remote "New-Item -ItemType Directory -Force -Path '$rootWin\service' | Out-Null; 'ready'"
Invoke-ThornswoodNative { & scp @ssh $svcSrc "${User}@${Vps}:$Root/service/BotService.cs" } | Out-Null
if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE for BotService.cs. The bot was not touched." }
Say '  service\BotService.cs' 'Green'
$running = @(Remote ((Get-ThornswoodHoldScript -Script 'Install-Bot.ps1') + $ThornswoodStopAndMoveText + (Get-Content -LiteralPath $svcLib -Raw) + "`n" + @"
`$ErrorActionPreference = 'Continue'
# Remember how long the log is, and read back only what is written past that.
# Waiting for the words 'watching 1 server' to appear is no good on its own:
# every previous start left that line behind, so the wait was satisfied by a
# run from hours ago and this printed that run instead of the one it had just
# begun. Writing a marker line instead did not work either, because the bot
# holds bot.log open the whole time it runs and Add-Content is refused. A byte
# count needs nothing but a look at the file.
#
# Measured on the log the running service writes, which the install moves
# into data if it is still beside the code (issue #1104), and read afterwards
# from data, where the new program writes it.
`$log = Get-ThornswoodBotLog '$rootWin'
`$before = 0
if (Test-Path `$log) { `$before = (Get-Item `$log).Length }
`$log = '$rootWin\data\bot.log'

`$r = Install-ThornswoodBotService -Name '$Service' -Root '$rootWin' -Source '$rootWin\service\BotService.cs' -Task '$Task'
`$r.Lines
if (-not `$r.Ok) { 'BOT SERVICE NOT INSTALLED'; return }

# Opened with FileShare ReadWrite, because the service has it open for
# writing and anything less strict than that is denied while it does. Shorter
# than before means it rolled, so all of it is this start.
function Fresh {
  `$out = @()
  # No log yet is no lines, which Healthy and Why read for themselves. One
  # that is there and cannot be opened is said, in place of no lines.
  `$script:freshWhy = ''
  if (-not (Test-Path -LiteralPath `$log)) { return `$out }
  `$fs = `$null
  try {
    `$fs = New-Object IO.FileStream(`$log, 'Open', 'Read', 'ReadWrite')
    `$from = `$before
    if (`$fs.Length -lt `$from) { `$from = 0 }
    if (`$fs.Length -gt `$from) {
      [void]`$fs.Seek(`$from, 'Begin')
      `$sr = New-Object IO.StreamReader(`$fs, [Text.Encoding]::UTF8)
      `$out = @((`$sr.ReadToEnd()) -split "\r?\n")
      `$sr.Close()
    }
  } catch { `$script:freshWhy = `$log + ' could not be read: ' + `$_.Exception.Message }
  if (`$fs) { `$fs.Dispose() }
  return `$out
}

# Python is up in about a second. Connecting to Discord, reading the roles and
# checking the channels takes longer, and the old eight second sleep was over
# well before any of it had happened.
`$ready = `$false
foreach (`$i in 1..30) {
  Start-Sleep -Seconds 2
  if (@(Fresh) -match 'watching \d+ server') { `$ready = `$true; break }
}
if (-not `$ready) {
  'it has not finished starting yet, so what follows may be short'
}
'--- what the bot said this time ---'
`$said = @(Fresh) | Where-Object { `$_ -match '^\s*\[(thornswood-bot|run)\]' }
if (`$said) { `$said | Select-Object -Last 25 } elseif (`$freshWhy) { `$freshWhy } else { 'nothing yet' }
"@))
$running | ForEach-Object { Say "  $_" }
if ("$running" -notmatch 'BOT SERVICE NOT INSTALLED' -and "$running" -match ('service ' + $Service + ': Running')) { Save-BotRecord }
if ("$running" -match 'BOT SERVICE NOT INSTALLED') {
  Write-Host ''
  if ("$running" -match 'Nothing was stopped or changed') {
    Say 'The bot was left running the way it was. Fix what the lines above say, then run this again.' 'Yellow'
  } else {
    Say 'The bot is NOT running. Fix what the lines above say, then run this again.' 'Red'
  }
}

if (-not (Confirm-BotFiles @($send.Keys))) {
  Die 'the install finished but the box does not hold every file it sent. The lines above name each one, with the full path on the box.'
}

Write-Host ''
if ("$settings" -match 'SITE DID NOT COME BACK|SITE CONFIG DOES NOT PARSE') {
  Say 'The site is not running with the new key or token, so tickets and role' 'Yellow'
  Say 'lookups fail until it is. Start it again with:' 'Yellow'
  Say '    .\scripts\deploy\Deploy-Docs.ps1' 'Green'
} elseif ("$settings" -match 'site restarted') {
  Say 'The site was restarted, so it has the key and the token the bot has.' 'DarkGray'
} else {
  Say 'The key and the token did not change, so the site needs nothing.' 'DarkGray'
}
if ("$settings" -match 'NEW key') {
  Say 'A NEW key: the doors need it too, or both are refused on their next fetch:' 'Yellow'
  Say '    .\scripts\ops\Set-Door.ps1 -Connect' 'Green'
  Say '    .\scripts\ops\Set-Door.ps1 -Connect -Root C:\Thornswood-Server-Dev -Site https://thornswood.net/dev' 'Green'
}
Write-Host ''
Say 'Then check the panel channel above, and try joining with another account.' 'DarkGray'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
