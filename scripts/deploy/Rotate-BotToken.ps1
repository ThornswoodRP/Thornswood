<#
  Rotate-BotToken.ps1

  Puts a new Discord bot token into both places on the VPS that use it, in one
  go, and restarts both programs that read it.

      .\scripts\deploy\Rotate-BotToken.ps1            asks for the new token, writes both, restarts both
      .\scripts\deploy\Rotate-BotToken.ps1 -Check     writes nothing: says whether each file holds a token

  The token lives in two files on the VPS:

    C:\Thornswood-Bot\bot.env.json    DISCORD_TOKEN     the bot logs in with it
    C:\Thornswood-Docs\config.json    discord.botToken  the site reads roles with it

  A token that reaches the first and not the second leaves the site unable to
  read anybody's roles, so everybody except the hand written admins is turned
  away. That is why this is one command: scripts\vps\Write-BotToken.ps1 writes
  both files or neither, and Install-Bot.ps1 and Set-DiscordLogin.ps1 use the
  same writer when they are given a token.

  Before running it: the Discord developer portal, the Thornswood application,
  Bot, Reset Token, Copy. The old token stops working the moment it is reset,
  so the bot drops off Discord until this has run. Pick a quiet moment: the
  restart throws anybody who is part way through a ticket.

  What it does:

    1. Asks for the new token at a prompt, hidden, never as a parameter and
       never as a word on a command line, and checks it looks like a bot token
       before anything leaves this machine.
    2. Sends the writer's text inline with the script that calls it, and the
       token on ssh's standard input, the same way Install-Bot.ps1
       and Set-DiscordLogin.ps1 do. Nothing is written on the box but the two
       files the token goes into (#3035: until 21 Oct 2026 the writer went up
       as a file of its own in C:\Windows\Temp first, and a run cut before
       the next call left it there).
    3. Writes both files, reads both back, and refuses a token for a different
       application than the one they hold (-AnyApplication, only when moving to
       a new application on purpose).
    4. Restarts the bot and the site, and prints what each said on the way up:
       who the bot logged in as, and whether the site can read the server.

  Every line it prints names a file and a state. The token is never printed.

  The old token is still inside every backup made before the rotation: the
  nightly ones in C:\Thornswood-Backup on the VPS, and any zip Fetch-Backups.ps1
  or Backup-Server.ps1 brought down to local\backups in the repository
  (Where.ps1 Backups; Downloads\Thornswood-Backups until 5 October). Discord
  stopped accepting it at the reset, but the same zips hold the client secret,
  which is still live, so they stay where the rest of that is kept.
#>
[CmdletBinding()]
param(
  [string]$Vps      = '',
  [string]$User     = '',
  [string]$BotRoot  = 'C:/Thornswood-Bot',
  [string]$DocsRoot = 'C:/Thornswood-Docs',
  [string]$BotService = 'ThornswoodBot',
  [string]$SiteTask = 'Thornswood Docs',
  # Writes nothing and restarts nothing. Says whether each file parses and
  # holds a token, and for which application.
  [switch]$Check,
  # Accept a token for a different Discord application than the files hold.
  # For moving to a new application, never for a rotation.
  [switch]$AnyApplication,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Send-Secret.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$writer = Join-Path $Here '..\vps\Write-BotToken.ps1'
. $writer
# The hold the restarts write (#5155), sent in front of Write-BotToken.ps1.
. (Join-Path $Here '..\vps\ServerHold.ps1')
$writerText = (Get-ThornswoodHoldScript -Script 'Rotate-BotToken.ps1') + [IO.File]::ReadAllText($writer)

$botWin  = $BotRoot.Replace('/','\')
$docsWin = $DocsRoot.Replace('/','\')
$envFile = $botWin + '\bot.env.json'
$cfgFile = $docsWin + '\config.json'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

# Every remote script here starts with the writer's own text, so the box
# never holds a copy of it (#3035), and is sent the way every script here is
# (Send-Script.ps1): too long for a command line, so by scp, and its run
# deletes the copy before it runs (#3059). The token goes on ssh's standard
# input (Send-Secret.ps1, issue #451), so it is on no command line and in no
# file on either machine.
function Remote($script) {
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

function Show($lines) {
  foreach ($l in @($lines)) {
    $s = "$l"
    $c = 'Gray'
    if ((Test-ThornswoodRestartLine $s) -or $s -match '^(NOT WRITTEN|CANNOT READ|PUTTING)' -or $s -match 'NOT SET|NOT A BOT TOKEN|BYTE ORDER MARK|NO ROLES') { $c = 'Red' }
    elseif ($s -match '(written and read back|already holds|is present|reconnected|site restarted|roles visible|can read)') { $c = 'Green' }
    Say "  $s" $c
  }
}

Write-Host ''
Write-Host '  THORNSWOOD  -  rotate the bot token' -ForegroundColor White

# ---------------------------------------------------------------- check ---
if ($Check) {
  Head 'What the VPS holds now'
  $out = Remote ($writerText + "`n" + @"
`$ErrorActionPreference = 'Continue'
if (-not (Get-Command Get-ThornswoodBotTokenState -EA SilentlyContinue)) { 'CANNOT READ: Write-BotToken.ps1 did not load on the VPS'; return }
Get-ThornswoodBotTokenState -BotEnv '$envFile' -SiteConfig '$cfgFile'
"@)
  Show $out
  Say ''
  Say '  Read only. Nothing was written and nothing was restarted.' 'DarkGray'
  Done 0
}

# ---------------------------------------------------------------- token ---
Head 'The new bot token'
Say '  Discord developer portal, the Thornswood application, Bot, Reset Token, Copy.' 'DarkGray'
Say '  It is hidden while you paste it and never shown afterwards.' 'DarkGray'
$token = (Read-ThornswoodSecret '  Paste it').Trim()
if (-not $token) { Die 'Nothing pasted, nothing sent.' }

$app = Get-ThornswoodTokenApp $token
if (-not $app) {
  $token = $null
  Say '  That is not a bot token. A bot token is three parts with dots between them.' 'Red'
  Say '  The client secret (OAuth2, one run of 32 characters) is the one it gets mixed up with.' 'DarkGray'
  Die 'Nothing was sent. Run it again.'
}
Say "  a bot token for application $app" 'Green'

$any = ''
if ($AnyApplication) { $any = ' -AnyApplication' }

# --------------------------------------------------------------- write ---
Head 'Writing both files, then restarting the bot and the site'
# The token goes on ssh's standard input and arrives as $ThornswoodSecret.
$out = Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $token -Script ($writerText + "`n" + @"
`$ErrorActionPreference = 'Continue'
if (-not (Get-Command Write-ThornswoodBotToken -EA SilentlyContinue)) {
  'NOT WRITTEN: Write-BotToken.ps1 did not load on the VPS. Nothing changed.'
  return
}
`$t = `$ThornswoodSecret; `$ThornswoodSecret = `$null
if (-not `$t) { 'NOT WRITTEN: nothing arrived on standard input. Nothing changed.'; return }
`$r = Write-ThornswoodBotToken -Token `$t -BotEnv '$envFile' -SiteConfig '$cfgFile'$any
`$t = `$null
`$r.Lines
if (`$r.Ok) {
  '--- the bot ---'
  Restart-ThornswoodBot -Root '$botWin' -Service '$BotService'
  '--- the site ---'
  Restart-ThornswoodSite -Root '$docsWin' -Task '$SiteTask'
}
'--- on the disk now ---'
Get-ThornswoodBotTokenState -BotEnv '$envFile' -SiteConfig '$cfgFile'
"@)
$token = $null
Show $out

if ("$out" -match 'NOT WRITTEN') {
  Say ''
  Say '  Nothing was changed on the VPS, so the bot and the site still agree with each other.' 'Yellow'
  Die 'The token was not rotated.'
}
if ("$out" -notmatch 'written and read back|already holds') {
  Die 'The VPS did not say the token was written. Run it again with -Check to see what it holds.'
}
# Both programs read the token only when they start, so it is in use only
# once each restart said it worked (#4211).
$failed = @(Get-ThornswoodRestartFailed $out @('bot', 'site'))
if ($failed.Count) {
  Write-Host ''
  foreach ($f in $failed) { Say "  $f" 'Red' }
  Die 'The token is in both files, but not everything that reads it restarted onto it. Put right what the lines above say, then run this again: it finds the token already there and restarts both.'
}

Head 'Consumers updated'
Say "  $envFile  DISCORD_TOKEN, read by the bot (the service $BotService)" 'Green'
Say "  $cfgFile  discord.botToken, read by the site ($SiteTask)" 'Green'
Write-Host ''
Say '  The old token is still inside every backup made before now:' 'Yellow'
Say '    C:\Thornswood-Backup on the VPS, the nightly ones' 'Yellow'
# Where.ps1 Backups since 5 October, the repository's local\backups, where
# those two scripts now put them.
Say ('    ' + [string](& (Join-Path $Here '..\release\Where.ps1') Backups) + ' here, whatever Fetch-Backups.ps1 or Backup-Server.ps1 brought down') 'Yellow'
Say '  Discord stopped taking it at the reset, but those zips hold the live client' 'DarkGray'
Say '  secret too, so they stay where the rest of that is kept.' 'DarkGray'
Write-Host ''
Say '  Then check from the outside, the way the site sees Discord:' 'DarkGray'
Say '    .\scripts\vps\Check-Site.ps1' 'Green'
Say '    .\scripts\vps\Show-BotLog.ps1' 'Green'
Done 0
