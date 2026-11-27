<#
  Set-DiscordLogin.ps1

  Points the site at your Discord, which is what decides who gets in anywhere.

  There are three things it holds, and they do different jobs:

    Client id and secret   sign people in. Proves who somebody is.
    Bot token and guild id look them up in your server. Proves they are IN it,
                           and what roles they have there.
    Invite link            where to send somebody who is not.

  Without the bot token the site can still sign people in, but it cannot see
  roles, so it falls back to the hand written admin list and lets everybody
  else in as an ordinary member. With it, Discord roles decide everything:

    Owner, Co-Owner, Lead Dev, Dev     admin on the site
    every staff role, Playtester       allowed into the game (#3317)
    Owner, Co-Owner, Dev, the leads    allowed the dev build
    Banned                             turned away everywhere

  Jarl of <hold> and Citizen of <hold> are in world and grant nothing. Somebody
  playing a Jarl still needs Member to get through the door.

  Which roles mean what lives in config.json on the VPS under "access", so it
  can be changed there without touching this.

  First time:

    .\Set-DiscordLogin.ps1 -ClientId 123... -GuildId 456... -Invite https://discord.gg/xxxx

  It asks for the client secret and the bot token at a prompt rather than
  taking them on the command line, so neither ends up in your history.

  A bot token given here goes into the bot's C:\Thornswood-Bot\bot.env.json as
  well as the site's config.json, through scripts\vps\Write-BotToken.ps1, the
  one writer of it, and the bot is restarted. To change only the token,
  Rotate-BotToken.ps1 is the shorter way.

  Later, to change one thing, pass just that thing. Anything you leave out is
  left as it is:

    .\Set-DiscordLogin.ps1 -Invite https://discord.gg/yyyy -NoSecrets

  Which roles mean what (#3317). Each -Access is one list, written whole:
  pass every role name the list should hold, not just the new one. The lists
  are the site's cfg.access ones: admin, play, dev, devBuild, banned, company
  and slots3. Lists not named keep what they hold.

    .\Set-DiscordLogin.ps1 -NoSecrets -Access 'company=Free Skyrim Trading Company'

  The fallback admin list, for when Discord itself is having a bad day. Pass
  every id, not just the new one:

    .\Set-DiscordLogin.ps1 -Admin 615236910243119104 -NoSecrets

  Where to find each:
    Client id and secret  https://discord.com/developers/applications, OAuth2
    Bot token             same application, Bot, Reset Token
    Guild id              Discord, right click your server, Copy Server ID
                          (needs Developer Mode on in Discord's settings)
    Invite                Discord, Invite People, Edit invite link, never expire
#>
[CmdletBinding()]
param(
  [string]$ClientId,
  [string]$GuildId,
  [string]$Invite,
  # Prompts for the link instead of taking it on the command line. Exists
  # because an example link in a command block gets pasted verbatim, every
  # time, and no amount of angle brackets stops it.
  [switch]$NewInvite,
  [string[]]$Admin,
  # 'list=Role,Role' for each access list to write whole (#3317).
  [string[]]$Access,
  # The Patreon page, once there is one. Puts a real link in the nav and the
  # footer instead of sending people to the Support page.
  [string]$Patreon,
  # Prompts for it, same reason as -NewInvite. Press enter on an empty line to
  # clear it and put the Support page back in the nav.
  [switch]$NewPatreon,
  [switch]$NoSecrets,
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Root = 'C:/Thornswood-Docs',
  [string]$Task = 'Thornswood Docs',
  # The bot's folder and service. A bot token goes into its bot.env.json as well
  # as the site's config.json, through the one writer both use, and the bot is
  # restarted when it changed.
  [string]$BotRoot = 'C:/Thornswood-Bot',
  [string]$BotService = 'ThornswoodBot'
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here '..\vps\Send-Secret.ps1')
# The hold the site's restart writes (#5155), sent in front of Write-BotToken.ps1.
. (Join-Path $Here '..\vps\ServerHold.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$rootWin = $Root.Replace('/','\')
$botWin  = $BotRoot.Replace('/','\')
$writer  = Join-Path $Here '..\vps\Write-BotToken.ps1'
# Here too, for the restart lines it holds what the box says to (#4211).
. $writer

function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

function AskSecret($what) { Read-ThornswoodSecret $what }

if ($NewPatreon) {
  Write-Host ''
  Write-Host '  Your Patreon page address, the one people visit.' -ForegroundColor DarkGray
  Write-Host '  Press enter on an empty line to clear it. The site keeps the' -ForegroundColor DarkGray
  Write-Host '  address written into the page, so the buttons still work.' -ForegroundColor DarkGray
  Write-Host ''
  $typed = (Read-Host '  Paste it here').Trim()
  $Patreon = if ($typed) { $typed } else { 'none' }
  $NoSecrets = $true
}

if ($NewInvite) {
  Write-Host ''
  Write-Host '  Discord, right click the server, Invite People, Edit invite link.' -ForegroundColor DarkGray
  Write-Host '  Expire after: Never. Max uses: No limit. Then copy the link.' -ForegroundColor DarkGray
  Write-Host ''
  $Invite = (Read-Host '  Paste it here').Trim()
  if (-not $Invite) { Write-Host '  Nothing pasted, nothing sent.' -ForegroundColor Yellow; exit 1 }
  $NoSecrets = $true
}

# A bot token is three parts with dots between them, and the first part is the
# application's own id written in base64. A client secret is one run of 32
# characters with no dot anywhere in it. They get pasted into each other's box
# constantly, because both are long and both are hidden while you type them,
# and the only thing you see afterwards is a 401 that does not say which of the
# two was wrong. So the shape gets checked here, before anything leaves this
# machine. Nothing secret is printed either way.
function AppIdIn($v) {
  $parts = "$v" -split '\.'
  if (@($parts).Count -ne 3) { return '' }
  $t = $parts[0].Replace('-','+').Replace('_','/')
  switch ($t.Length % 4) { 2 { $t += '==' } 3 { $t += '=' } }
  try { $id = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($t)) } catch { return '' }
  if ($id -match '^[0-9]{17,20}$') { return $id }
  return ''
}
function Reject($lines) {
  Write-Host ''
  foreach ($l in $lines) { Write-Host "  $l" -ForegroundColor Red }
  Write-Host ''
  Write-Host '  Client secret  https://discord.com/developers/applications, your app,' -ForegroundColor DarkGray
  Write-Host '                 OAuth2 in the left menu, Reset Secret, then Copy.' -ForegroundColor DarkGray
  Write-Host '  Bot token      same app, Bot in the left menu, Reset Token, then Copy.' -ForegroundColor DarkGray
  Write-Host '                 Discord shows a token once. Copy it before you leave.' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  Nothing was sent. Run it again.' -ForegroundColor Yellow
  exit 1
}

$clientSecret = ''
$botToken     = ''
if (-not $NoSecrets) {
  Write-Host ''
  Write-Host '  Leave either blank to keep whatever is already up there.' -ForegroundColor DarkGray
  $clientSecret = AskSecret 'Discord client secret'
  $botToken     = AskSecret 'Discord bot token'

  if ($clientSecret) {
    if (AppIdIn $clientSecret) {
      Reject @('That is a BOT TOKEN in the client secret box.',
               'It is ' + $clientSecret.Length + ' characters and has dots in it.',
               'A client secret is 32 characters and has no dots.')
    }
    if ($clientSecret.Length -lt 25 -or $clientSecret.Length -gt 45) {
      Reject @('That client secret is ' + $clientSecret.Length + ' characters.',
               'A Discord client secret is 32.')
    }
  }

  if ($botToken) {
    $app = AppIdIn $botToken
    if (-not $app) {
      $n = ($botToken -split '\.').Count
      Reject @('That is not a bot token.',
               'It is ' + $botToken.Length + ' characters in ' + $n + ' part(s).',
               'A bot token is three parts with dots between them.')
    }
    if ($ClientId -and $app -ne $ClientId) {
      Reject @('That bot token belongs to application ' + $app + '.',
               'You are pointing the site at application ' + $ClientId + '.',
               'Those have to be the same application.')
    }
  }
}

# Every id Discord hands out is a snowflake: 17 to 20 digits and nothing else.
# This exists because a placeholder got pasted in verbatim once, the script
# happily wrote the words YOUR_CLIENT_ID to the VPS, and the read back said
# "set" because "set" only ever meant "not empty".
function CheckId($what, $v) {
  if ($v -notmatch '^[0-9]{17,20}$') {
    Write-Host ''
    Write-Host "  $what has to be a Discord id: 17 to 20 digits." -ForegroundColor Red
    Write-Host "  You gave: $v" -ForegroundColor Red
    Write-Host ''
    Write-Host '  Client id   https://discord.com/developers/applications, your app, OAuth2' -ForegroundColor DarkGray
    Write-Host '  Guild id    right click the server, Copy Server ID (Developer Mode on)' -ForegroundColor DarkGray
    Write-Host '  Admin id    right click yourself, Copy User ID' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Nothing was sent. Run it again with the real one.' -ForegroundColor Yellow
    exit 1
  }
}
if ($ClientId) { CheckId 'The client id' $ClientId }
if ($GuildId)  { CheckId 'The guild id'  $GuildId }
foreach ($a in @($Admin)) { if ($a) { CheckId 'An admin id' $a } }
if ($Invite) {
  if ($Invite -notmatch '^https://(discord\.gg/|discord\.com/invite/)') {
    Write-Host ''
    Write-Host '  That does not look like a Discord invite.' -ForegroundColor Red
    Write-Host '  It should start https://discord.gg/ or https://discord.com/invite/' -ForegroundColor DarkGray
    Write-Host '  Nothing was sent.' -ForegroundColor Yellow
    exit 1
  }
  # The code after the slash on a real invite is 7 to 12 of Discord's own
  # characters. xxxx and yyyy are what a copied example looks like.
  $code = ($Invite -split '/')[-1]
  # A real code is mixed case and digits. ALLCAPS is what an example looks
  # like, and so is any of these words.
  if ($code -cmatch '^[A-Z]+$' -or
      $code -match '^(x+|y+|z+|abc.*|code|invite|link|here|yours?|real.*|.*code|.*here)$' -or
      $code.Length -lt 6) {
    Write-Host ''
    Write-Host "  That invite code looks like a placeholder: $code" -ForegroundColor Red
    Write-Host '  Discord, right click the server, Invite People, Edit invite link,' -ForegroundColor DarkGray
    Write-Host '  expire after Never, max uses No limit, then copy the real link.' -ForegroundColor DarkGray
    Write-Host '  Nothing was sent.' -ForegroundColor Yellow
    exit 1
  }
}

if ($Patreon -and $Patreon -ne 'none') {
  if ($Patreon -notmatch '^https://(www\.)?patreon\.com/.+') {
    Write-Host ''
    Write-Host '  That is not a Patreon page address.' -ForegroundColor Red
    Write-Host '  It should start https://www.patreon.com/ and then your page name.' -ForegroundColor DarkGray
    Write-Host '  Nothing was sent.' -ForegroundColor Yellow
    exit 1
  }
  $slug = ($Patreon.TrimEnd('/') -split '/')[-1]
  if ($slug -match '^(your.*|my.*|page|name|example|creator|.*page|.*name)$') {
    Write-Host ''
    Write-Host "  That page name looks like a placeholder: $slug" -ForegroundColor Red
    Write-Host '  Use the real one, or run .\Set-DiscordLogin.ps1 -NewPatreon and paste it.' -ForegroundColor DarkGray
    Write-Host '  Nothing was sent.' -ForegroundColor Yellow
    exit 1
  }
}

# The access lists, checked here so nothing odd leaves this machine: a list
# the site has, and role names in plain words.
$accessLists = 'admin', 'play', 'dev', 'devBuild', 'banned', 'company', 'slots3'
$acc = @{}
foreach ($a in @($Access | Where-Object { "$_".Trim() })) {
  if ("$a" -notmatch '^\s*([A-Za-z0-9]+)\s*=(.*)$' -or $accessLists -cnotcontains $Matches[1]) {
    Write-Host ("  -Access takes 'list=Role,Role' with a list of " + ($accessLists -join ', ') + ', not: ' + $a) -ForegroundColor Red
    exit 1
  }
  $key = $Matches[1]
  $names = @($Matches[2] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  foreach ($n in $names) {
    if ($n -notmatch '^[\p{L}\p{N} ._-]+$') { Write-Host ('  -Access: not a role name: ' + $n) -ForegroundColor Red; exit 1 }
  }
  if (-not $names.Count) { Write-Host ('  -Access ' + $key + ' names no role. Nothing sent.') -ForegroundColor Red; exit 1 }
  $acc[$key] = $names
}

$d = @{}
if ($ClientId)     { $d.clientId = $ClientId }
if ($clientSecret) { $d.clientSecret = $clientSecret }
if ($GuildId)      { $d.guildId = $GuildId }
if ($Invite)       { $d.invite = $Invite }

# The bot token is not part of the discord block this merges. It goes to
# Write-ThornswoodBotToken on the VPS, which puts it into the site's
# config.json and the bot's bot.env.json together or into neither (#466).
$payload = @{
  discord = $d
  token   = "$botToken"
  patreon = "$Patreon"
  admins  = @(if ($Admin) { $Admin | ForEach-Object { "$_" } })
  access  = $acc
} | ConvertTo-Json -Depth 4 -Compress
# A client id given with the token says which application this is on purpose,
# and the token was checked against it above.
$any = ''
if ($ClientId) { $any = ' -AnyApplication' }

# Both secrets go on ssh's standard input (Send-Secret.ps1, issue #451), so
# neither is on a command line or in a file on either machine. A comment here
# used to say base64 kept them off the command line; it did not, the base64
# went inside it.
$clientSecret = $null; $botToken = $null

Write-Host ''
Write-Host 'Writing it to the VPS...'
if (-not (Test-Path -LiteralPath $writer)) { Write-Host "  missing: $writer" -ForegroundColor Red; exit 1 }
$wrote = @(Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $payload -Script ((Get-ThornswoodHoldScript -Script 'Set-DiscordLogin.ps1') + (Get-Content -LiteralPath $writer -Raw) + "`n" + @"
`$ErrorActionPreference = 'Stop'
`$patch = `$null
if (-not `$ThornswoodSecret) { 'NOTHING ARRIVED on standard input. Nothing written.'; return }
# The parse error is not said: its text would quote what arrived, the secrets.
try { `$patch = `$ThornswoodSecret | ConvertFrom-Json }
catch { `$ThornswoodSecret = `$null; 'NOT WRITTEN: what arrived on standard input is not the JSON Set-DiscordLogin.ps1 sends. Nothing written.'; return }
`$ThornswoodSecret = `$null
if (-not `$patch) { 'NOTHING ARRIVED on standard input. Nothing written.'; return }
`$f = Join-Path '$rootWin' 'config.json'
# A config.json that is there and does not read is not empty: written over,
# it would lose the bot token, botKey, the cookie secret and the rest (#2317).
`$cfg = @{}
if (Test-Path `$f) {
  try { `$cfg = Read-ThornswoodJsonFile `$f }
  catch { 'NOT WRITTEN: ' + `$_.Exception.Message + ', and it is left as it is. Nothing written.'; return }
}

`$d = @{}
if (`$cfg.discord) { `$cfg.discord.PSObject.Properties | ForEach-Object { `$d[`$_.Name] = `$_.Value } }
`$patch.discord.PSObject.Properties | ForEach-Object { if (`$_.Value) { `$d[`$_.Name] = `$_.Value } }
`$cfg['discord'] = `$d
if (`$patch.admins -and @(`$patch.admins).Count) { `$cfg['admins'] = @(`$patch.admins) }
if (`$patch.patreon -eq 'none') { `$cfg['patreon'] = '' }
elseif (`$patch.patreon)         { `$cfg['patreon'] = `$patch.patreon }
if (-not `$cfg['admins']) { `$cfg['admins'] = @() }
if (-not `$cfg['access']) {
  # The same lists as site\server.js's defaults (#3317).
  `$cfg['access'] = @{
    admin  = @('Owner','Co-Owner','Lead Dev','Dev')
    play   = @('Owner','Co-Owner','Lead Dev','Lead Gamemaster','Lead Loremaster','Lead Moderator',
               'Lead Content Creator','Lead Support','Dev','Gamemaster','Trial Gamemaster',
               'Loremaster','Moderator','Content Creator','Support','Playtester')
    banned = @('Banned')
  }
}
# -Access: each list named is written whole, the rest kept (#3317).
if (`$patch.access -and @(`$patch.access.PSObject.Properties).Count) {
  `$acc = @{}
  if (`$cfg['access'] -is [hashtable]) { foreach (`$k in `$cfg['access'].Keys) { `$acc[`$k] = `$cfg['access'][`$k] } }
  elseif (`$cfg['access']) { `$cfg['access'].PSObject.Properties | ForEach-Object { `$acc[`$_.Name] = `$_.Value } }
  `$patch.access.PSObject.Properties | ForEach-Object { `$acc[`$_.Name] = @(`$_.Value) }
  `$cfg['access'] = `$acc
}

# Set-Content -Encoding UTF8 on Windows PowerShell writes a byte order mark.
# Node's JSON.parse chokes on it, the site's try/catch swallows the error, and
# the whole file is silently ignored while every check here still says 'set'.
# So write the bytes ourselves, with no mark on the front.
[IO.File]::WriteAllText(`$f, (`$cfg | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding(`$false)))

# The bot token, into this file and the bot's bot.env.json together, or into
# neither. Blank at the prompt keeps what is there.
`$tokenChanged = `$false
if (`$patch.token) {
  `$r = Write-ThornswoodBotToken -Token `$patch.token -BotEnv '$botWin\bot.env.json' -SiteConfig `$f$any
  `$r.Lines
  `$tokenChanged = [bool]`$r.Changed
}

# Read it back off the disk. What was in memory a second ago proves nothing.
`$bytes = [IO.File]::ReadAllBytes(`$f)
if (`$bytes.Length -ge 3 -and `$bytes[0] -eq 239 -and `$bytes[1] -eq 187 -and `$bytes[2] -eq 191) {
  'BYTE ORDER MARK STILL ON THE FILE. The site cannot read it. Tell Claude.'
}
`$back = [Text.Encoding]::UTF8.GetString(`$bytes) | ConvertFrom-Json

'on the disk now, ' + `$bytes.Length + ' bytes:'
'  client id     ' + `$(if (`$back.discord.clientId)     { `$back.discord.clientId } else { 'MISSING' })
function AppIdIn(`$v) {
  `$parts = "`$v" -split '\.'
  if (@(`$parts).Count -ne 3) { return '' }
  `$t = `$parts[0].Replace('-','+').Replace('_','/')
  switch (`$t.Length % 4) { 2 { `$t += '==' } 3 { `$t += '=' } }
  try { `$id = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(`$t)) } catch { return '' }
  if (`$id -match '^[0-9]{17,20}`$') { return `$id }
  return ''
}
function SecretLooks(`$v) {
  if (-not `$v) { return 'MISSING' }
  if (AppIdIn `$v) { return 'THIS IS A BOT TOKEN, NOT A CLIENT SECRET' }
  if ("`$v".Length -lt 25 -or "`$v".Length -gt 45) {
    return 'set, but it is ' + "`$v".Length + ' characters and a client secret is 32' }
  return 'set'
}
function TokenLooks(`$v, `$cid) {
  if (-not `$v) { return 'not set, roles will not be read' }
  `$app = AppIdIn `$v
  if (-not `$app) { return 'NOT A BOT TOKEN, it has no application id in it' }
  if (`$cid -and `$app -ne `$cid) { return 'set, but it belongs to application ' + `$app + ', NOT ' + `$cid }
  return 'set, and it belongs to this application'
}
'  client secret ' + (SecretLooks `$back.discord.clientSecret)
'  bot token     ' + (TokenLooks `$back.discord.botToken `$back.discord.clientId)
'  guild id      ' + `$(if (`$back.discord.guildId)      { `$back.discord.guildId } else { 'not set, roles will not be read' })
'  invite        ' + `$(if (`$back.discord.invite)       { `$back.discord.invite } else { 'not set' })
'  fallback admins ' + (@(`$back.admins) -join ', ')
'  patreon       ' + `$(if (`$back.patreon) { `$back.patreon } else { 'not set' })
'  lets into the game: ' + (@(`$back.access.play) -join ', ')
if (`$patch.access) {
  `$patch.access.PSObject.Properties | ForEach-Object {
    '  access ' + `$_.Name + ': ' + (@(`$back.access.(`$_.Name)) -join ', ')
  }
}

Restart-ThornswoodSite -Root '$rootWin' -Task '$Task'
if (`$tokenChanged) { Restart-ThornswoodBot -Root '$botWin' -Service '$BotService' }
"@))
$payload = $null
$wrote | ForEach-Object { if (Test-ThornswoodRestartLine "$_") { Write-Host "  $_" -ForegroundColor Red } else { Write-Host "  $_" } }
if (@($wrote | Where-Object { "$_" -like 'NOT WRITTEN:*' -or "$_" -like 'NOTHING ARRIVED*' }).Count) {
  Write-Host ''
  Write-Host '  Nothing was written on the VPS, and nothing was restarted. The line above says why.' -ForegroundColor Red
  exit 1
}
# The site reads config.json only when it starts, and the bot its token only
# when it starts, so neither change is in use until its restart says it
# worked (#4211). The bot is restarted when the writer wrote it a new token.
$restarted = @('site')
if (@($wrote | Where-Object { "$_" -match 'DISCORD_TOKEN\s+written and read back' }).Count) { $restarted += 'bot' }
$failed = @(Get-ThornswoodRestartFailed $wrote $restarted)
if ($failed.Count) {
  Write-Host ''
  foreach ($f in $failed) { Write-Host "  $f" -ForegroundColor Red }
}

Write-Host ''
Write-Host '  The redirect in the Discord application must be exactly this:' -ForegroundColor DarkGray
Write-Host '    https://thornswood.net/auth/discord/callback' -ForegroundColor Green
Write-Host ''
Write-Host '  The bot has to be IN the server for roles to be readable.' -ForegroundColor DarkGray
Write-Host '  Apply-Discord.ps1 puts it there.' -ForegroundColor DarkGray
if ($failed.Count) {
  Write-Host ''
  Write-Host '  It is written on the VPS, but not in use: the FAILED lines above say which restart did not happen.' -ForegroundColor Red
  exit 1
}
