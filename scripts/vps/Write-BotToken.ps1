<#
  Write-BotToken.ps1

  The one writer of the Discord bot token. Dot-sourced on the VPS by
  Rotate-BotToken.ps1, Install-Bot.ps1 and Set-DiscordLogin.ps1, which send
  it up with the script that calls it. It only defines functions, so
  dot-sourcing it does nothing by itself. Each sender puts ServerHold.ps1 in
  front of it (Get-ThornswoodHoldScript), because both restarts below stop a
  server on purpose and hold it while they do, so the watchdog does not start
  it in the middle (#5155).

      . .\Write-BotToken.ps1
      Write-ThornswoodBotToken -Token $t -BotEnv C:\Thornswood-Bot\bot.env.json -SiteConfig C:\Thornswood-Docs\config.json
      Get-ThornswoodBotTokenState -BotEnv ... -SiteConfig ...
      Restart-ThornswoodBot -Root C:\Thornswood-Bot -Service ThornswoodBot
      Restart-ThornswoodSite -Root C:\Thornswood-Docs -Task 'Thornswood Docs'

  WHY. The token lives in two files on the VPS, and two programs read it:

    C:\Thornswood-Bot\bot.env.json    DISCORD_TOKEN     the bot logs in with it
    C:\Thornswood-Docs\config.json    discord.botToken  the site reads roles with it

  Until issue #466 each file had its own writer: Install-Bot.ps1 wrote the bot's
  and Set-DiscordLogin.ps1 wrote the site's, each at its own prompt, and nothing
  tied the two together. Running one and not the other left the site on a dead
  token, and a site that cannot read roles turns away everybody except the
  hand written admins. So the token is written here and only here, into both
  files or into neither:

    - Both files are read and parsed before either is written. A file that is
      not there, or does not parse, stops it with nothing written.
    - A token for a different Discord application than the one already held
      is refused unless -AnyApplication says that is the point.
    - After both are written they are read back off the disk. If either write
      or either read back fails, both files are put back exactly as they were.

  The token is never printed, and never part of a message: every line this
  returns names a file, a field and a state. An error from ConvertFrom-Json is
  not passed on either, because Windows PowerShell quotes the text it could
  not parse, and that text can be somebody's secret.

  tests\test-bot-login-rotation.ps1 runs these functions against fake files.
#>

# The first part of a bot token is the application's id in base64. The id is
# public (the ops repo's OWNERSHIP.md names it); the token is not.
function Get-ThornswoodTokenApp([string]$Token) {
  $parts = "$Token" -split '\.'
  if (@($parts).Count -ne 3) { return '' }
  $t = $parts[0].Replace('-', '+').Replace('_', '/')
  switch ($t.Length % 4) { 2 { $t += '==' } 3 { $t += '=' } }
  try { $id = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($t)) } catch { return '' }
  if ($id -match '^[0-9]{17,20}$') { return $id }
  return ''
}

# A JSON file as an ordered table of its top level, or an exception whose
# message says only which file and what kind of failure.
function Read-ThornswoodJsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw ($Path + ' is not there') }
  $raw = $null
  try { $raw = [IO.File]::ReadAllText($Path) } catch { throw ($Path + ' could not be read') }
  $o = $null
  try { $o = $raw | ConvertFrom-Json } catch { throw ($Path + ' does not parse as JSON') }
  if ($null -eq $o -or -not ($o -is [Management.Automation.PSCustomObject])) {
    throw ($Path + ' does not hold a JSON object')
  }
  $h = [ordered]@{}
  foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = $p.Value }
  return $h
}

function Test-ThornswoodBom([string]$Path) {
  $b = [IO.File]::ReadAllBytes($Path)
  return ($b.Length -ge 3 -and $b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191)
}

# The site's discord block as an ordered table, whatever shape it was stored in.
function Get-ThornswoodDiscordBlock($Cfg) {
  $d = [ordered]@{}
  $have = $Cfg['discord']
  if ($have -is [Collections.IDictionary]) { foreach ($k in $have.Keys) { $d[$k] = $have[$k] } }
  elseif ($have) { foreach ($p in $have.PSObject.Properties) { $d[$p.Name] = $p.Value } }
  return $d
}

# Written with no byte order mark: node's JSON.parse refuses one, and the site
# then runs on its defaults (site\server.js, where it reads config.json).
function Write-ThornswoodJsonFile([string]$Path, $Table) {
  [IO.File]::WriteAllText($Path, ($Table | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
}

# bot.env.json, locked to SYSTEM, Administrators and whoever runs this, plus
# read for the service's own account NT SERVICE\<Service>, the one program
# meant to open it. Until issue #2158 the settings step in Install-Bot.ps1
# took every rule off and put back only the first three, so the swap started
# a service that could not read its own settings, the rollback hit the same
# denied read, and a full run left the bot stopped. The service's rule is
# given here, in the same write that takes the others off.
# The SID is worked out the way Get-ThornswoodServiceSid in Bot-Service.ps1
# does it (tests\test-bot-env-acl.ps1 checks they agree), because this file
# goes up without Bot-Service.ps1 and the account may not exist yet.
function Get-ThornswoodBotEnvServiceSid([string]$Service) {
  $sha = [Security.Cryptography.SHA1]::Create()
  try { $h = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Service.ToUpperInvariant())) }
  finally { $sha.Dispose() }
  $parts = @()
  for ($i = 0; $i -lt 20; $i += 4) { $parts += [BitConverter]::ToUInt32($h, $i) }
  return ('S-1-5-80-' + ($parts -join '-'))
}

# And read for the nightly backup's own task account, NT TASK\Thornswood
# Backup, which takes this file into the encrypted backup a new box is
# rebuilt from (#2836). Since the backup moved off SYSTEM to LOCAL SERVICE
# with a SID of its own (#2612), no other rule lets it in: on 22 Oct 2026 the
# 2:15 AM run said NO ACCESS on this file and ended with code 1. Given here,
# in the same write, so every writer of this file keeps it, and only while
# that SID resolves: on a box whose backup still runs as SYSTEM, or has none,
# there is nobody to give it to, and SYSTEM already reads it.
function Protect-ThornswoodBotEnv([string]$Path, [string]$Service = 'ThornswoodBot', [string]$BackupTask = 'Thornswood Backup') {
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($r in @($acl.Access)) { [void]$acl.RemoveAccessRule($r) }
  $admins = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  foreach ($s in $admins) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', 'Allow')))
  }
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier((Get-ThornswoodBotEnvServiceSid $Service))), 'Read', 'Allow')))
  $backupSid = ''
  try { $backupSid = (New-Object Security.Principal.NTAccount('NT TASK', $BackupTask)).Translate([Security.Principal.SecurityIdentifier]).Value }
  catch [Security.Principal.IdentityNotMappedException] { $backupSid = '' }
  if ($backupSid) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($backupSid)), 'Read', 'Allow')))
  }
  # Only the access rules are written back, as Set-ThornswoodAclAccess does,
  # so an account without SeSecurityPrivilege can run it (issue #1120).
  $item = Get-Item -LiteralPath $Path -Force
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, [Security.AccessControl.FileSecurity]$acl)
}

function Write-ThornswoodBotToken {
  param(
    [string]$Token,
    [string]$BotEnv,
    [string]$SiteConfig,
    # A token for another application than the one the files hold now. Only
    # for moving to a new Discord application, never for a rotation.
    [switch]$AnyApplication
  )
  $lines = New-Object 'System.Collections.Generic.List[string]'
  $result = New-Object PSObject -Property @{ Ok = $false; Changed = $false; App = ''; Lines = $lines }

  $app = Get-ThornswoodTokenApp $Token
  if (-not $app) {
    $lines.Add('NOT WRITTEN: what was given is not a bot token (three parts with dots, the first the application id). Nothing changed.')
    return $result
  }
  $result.App = $app

  # Read both before writing either. The bytes are kept to put back.
  try {
    $env2 = Read-ThornswoodJsonFile $BotEnv
    $cfg  = Read-ThornswoodJsonFile $SiteConfig
  } catch {
    $lines.Add('NOT WRITTEN: ' + $_.Exception.Message + '. Neither file was changed.')
    if ($_.Exception.Message -like ($BotEnv + '*')) {
      $lines.Add('  The bot is not installed there yet. Install-Bot.ps1 installs it and writes the token into both files.')
    }
    return $result
  }
  $envBytes = [IO.File]::ReadAllBytes($BotEnv)
  $cfgBytes = [IO.File]::ReadAllBytes($SiteConfig)
  $d = Get-ThornswoodDiscordBlock $cfg

  if (-not $AnyApplication) {
    $held = @(
      @{ Where = $BotEnv + ' DISCORD_TOKEN';        App = (Get-ThornswoodTokenApp ([string]$env2['DISCORD_TOKEN'])) },
      @{ Where = $SiteConfig + ' discord.botToken'; App = (Get-ThornswoodTokenApp ([string]$d['botToken'])) },
      @{ Where = $SiteConfig + ' discord.clientId'; App = ([string]$d['clientId']) }
    )
    foreach ($h in $held) {
      if ($h.App -and $h.App -ne $app) {
        $lines.Add('NOT WRITTEN: the new token belongs to application ' + $app + ', and ' + $h.Where +
                   ' is for application ' + $h.App + '. A rotation keeps the same application. Neither file was changed.')
        return $result
      }
    }
  }

  if (([string]$env2['DISCORD_TOKEN']) -ceq $Token -and ([string]$d['botToken']) -ceq $Token) {
    $result.Ok = $true
    $lines.Add($BotEnv + '  DISCORD_TOKEN     already holds this token, application ' + $app)
    $lines.Add($SiteConfig + '  discord.botToken  already holds this token, application ' + $app)
    return $result
  }

  $env2['DISCORD_TOKEN'] = $Token
  $d['botToken'] = $Token
  $cfg['discord'] = $d

  $step = ''
  try {
    $step = 'writing ' + $BotEnv
    Write-ThornswoodJsonFile $BotEnv $env2
    $step = 'writing ' + $SiteConfig
    Write-ThornswoodJsonFile $SiteConfig $cfg

    # Off the disk, not out of memory. What was in memory proves nothing.
    $step = 'reading back ' + $BotEnv
    $backEnv = Read-ThornswoodJsonFile $BotEnv
    $step = 'reading back ' + $SiteConfig
    $backCfg = Read-ThornswoodJsonFile $SiteConfig
    $backD = Get-ThornswoodDiscordBlock $backCfg
    $step = 'checking what was written'
    if (Test-ThornswoodBom $BotEnv)     { throw 'bom' }
    if (Test-ThornswoodBom $SiteConfig) { throw 'bom' }
    if (-not (([string]$backEnv['DISCORD_TOKEN']) -ceq $Token)) { throw 'mismatch' }
    if (-not (([string]$backD['botToken']) -ceq $Token))        { throw 'mismatch' }
  } catch {
    # Both back as they were, so the bot and the site still agree.
    $put = 'both files were put back as they were'
    try {
      [IO.File]::WriteAllBytes($BotEnv, $envBytes)
      [IO.File]::WriteAllBytes($SiteConfig, $cfgBytes)
    } catch { $put = 'PUTTING THEM BACK FAILED TOO, so check both files by hand' }
    $lines.Add('NOT WRITTEN: stopped while ' + $step + '; ' + $put + '.')
    return $result
  }

  $result.Ok = $true
  $result.Changed = $true
  $lines.Add($BotEnv + '  DISCORD_TOKEN     written and read back, application ' + $app)
  $lines.Add($SiteConfig + '  discord.botToken  written and read back, application ' + $app)
  return $result
}

# Read only: whether each file parses and holds a token, and for which
# application. For checking after a rotation, and for the Done when of #466.
function Get-ThornswoodBotTokenState([string]$BotEnv, [string]$SiteConfig) {
  $out = @()
  foreach ($f in @(@{ Path = $BotEnv; Field = 'DISCORD_TOKEN' }, @{ Path = $SiteConfig; Field = 'discord.botToken' })) {
    try {
      $t = Read-ThornswoodJsonFile $f.Path
      $v = ''
      if ($f.Field -eq 'DISCORD_TOKEN') { $v = [string]$t['DISCORD_TOKEN'] }
      else { $v = [string](Get-ThornswoodDiscordBlock $t)['botToken'] }
      $bom = ''
      if (Test-ThornswoodBom $f.Path) { $bom = ', BUT IT STARTS WITH A BYTE ORDER MARK' }
      if (-not $v) { $out += ($f.Path + '  parses' + $bom + '; ' + $f.Field + ' is NOT SET') }
      else {
        $a = Get-ThornswoodTokenApp $v
        if ($a) { $out += ($f.Path + '  parses' + $bom + '; ' + $f.Field + ' is present, application ' + $a) }
        else    { $out += ($f.Path + '  parses' + $bom + '; ' + $f.Field + ' is present but is NOT A BOT TOKEN') }
      }
    } catch { $out += ('CANNOT READ: ' + $_.Exception.Message) }
  }
  return $out
}

# Only what a log gained since $Before, read with FileShare ReadWrite because
# the program writing it holds it open. Shorter than before means it was
# rolled on the way up, so all of it is new.
function Read-ThornswoodLogTail([string]$Log, [long]$Before) {
  $out = @()
  $fs = $null
  try {
    $fs = New-Object IO.FileStream($Log, 'Open', 'Read', 'ReadWrite')
    $from = $Before
    if ($fs.Length -lt $from) { $from = 0 }
    if ($fs.Length -gt $from) {
      [void]$fs.Seek($from, 'Begin')
      $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
      $out = @(($sr.ReadToEnd()) -split "\r?\n" | Where-Object { $_ })
      $sr.Close()
    }
  } catch { }
  if ($fs) { $fs.Dispose() }
  return $out
}

function Get-ThornswoodLogLength([string]$Log) {
  if (Test-Path -LiteralPath $Log) { return (Get-Item -LiteralPath $Log).Length }
  return 0
}

# The bot's service restarted by its name (issue #465; Install-Bot.ps1 puts
# it there), then the bot's own lines from this start: "up as" is who it
# logged in as, and "watching N server(s)" is it connected. Stopping the
# service stops python and anything it started, so nothing is looked for by
# its command line. Restart-Service starts a service that was stopped.
function Restart-ThornswoodBot([string]$Root, [string]$Service = 'ThornswoodBot', [int]$WaitSeconds = 60) {
  # In data since #1104; beside the code on a box whose full install is older;
  # and the one written last when both are there, since Install-Bot leaves an
  # empty one in data on every run. Reading the empty one would have this say
  # the bot never came back when it had.
  $log = Join-Path $Root 'data\bot.log'
  $alt = Join-Path $Root 'bot.log'
  $a = Get-Item -LiteralPath $alt -EA SilentlyContinue
  if ($a) {
    $n = Get-Item -LiteralPath $log -EA SilentlyContinue
    if (-not $n -or $a.LastWriteTimeUtc -gt $n.LastWriteTimeUtc) { $log = $alt }
  }
  $before = Get-ThornswoodLogLength $log
  $out = @()
  $null = Set-ThornswoodHold -Target $Service -Why 'restarting the bot on its new settings' -By $HoldBy
  $why = ''
  try { Restart-Service -Name $Service -Force -ErrorAction Stop }
  catch { $why = $_.Exception.Message }
  $null = Clear-ThornswoodHold -Target $Service
  if ($why) { return @('BOT NOT RESTARTED: the service ' + $Service + ' would not restart (' + $why + '). Install-Bot.ps1 puts it on the box.') }
  $up = $false
  for ($i = 0; $i -lt $WaitSeconds; $i += 2) {
    Start-Sleep -Seconds 2
    $new = @(Read-ThornswoodLogTail $log $before)
    if ($new -match 'watching \d+ server') { $up = $true; break }
    if ($new -match '(?i)improper token|LoginFailure|401 Unauthorized|stopped within') { break }
  }
  if ($up) { $out += 'bot reconnected' } else { $out += 'BOT HAS NOT SAID IT IS CONNECTED, read its lines below' }
  $said = @(Read-ThornswoodLogTail $log $before) | Where-Object { $_ -match '^\s*\[(thornswood-bot|run)\]' }
  if ($said) { $out += @($said | Select-Object -Last 12 | ForEach-Object { '  ' + $_ }) } else { $out += '  nothing from the bot yet' }
  return $out
}

# The same stop and start as Set-DiscordLogin.ps1, then the site's own lines
# about Discord from this start: whether the bot token it now holds can read
# the server, and how many roles it sees.
function Restart-ThornswoodSite([string]$Root, [string]$Task, [int]$Port = 3001, [int]$WaitSeconds = 30) {
  $leaf = Split-Path -Leaf $Root
  $log = Join-Path $Root 'site.log'
  $before = Get-ThornswoodLogLength $log
  $out = @()
  $null = Set-ThornswoodHold -Target $Task -Why 'restarting the site on its new settings' -By $HoldBy
  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $leaf + '*') } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $Task -EA SilentlyContinue
  $null = Clear-ThornswoodHold -Target $Task
  $said = @()
  for ($i = 0; $i -lt $WaitSeconds; $i += 2) {
    Start-Sleep -Seconds 2
    $said = @(Read-ThornswoodLogTail $log $before) |
      Where-Object { $_ -match '(?i)discord (login|bot)|roles visible|CANNOT READ THE SERVER|NO ROLES VISIBLE|will not parse' }
    if ($said -match '(?i)roles visible|CANNOT READ THE SERVER|will not parse') { break }
  }
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue) { $out += 'site restarted, answering on ' + $Port }
  else { $out += 'SITE DID NOT COME BACK on ' + $Port }
  if ($said) { $out += @($said | ForEach-Object { '  ' + $_ }) } else { $out += '  the site has not said anything about Discord yet' }
  return $out
}
