<#
  Bot-Service.ps1

  Runs the Thornswood bot as a Windows service under its own account, and
  stops and starts it by name (issue #465). Functions only, run ON the VPS as
  Administrator: Install-Bot.ps1 sends this in front of its own script, the
  way it sends Write-BotToken.ps1, with scripts\deploy\StopAndMove.ps1 in
  front of it, because every stop here waits for what it stopped to have
  exited (#2928), and scripts\vps\ServerHold.ps1, because each stop here is
  on purpose and holds the bot while it lasts, so the watchdog does not start
  it in the middle (#5155).

      Install-ThornswoodBotService   build the service program, put the
                                     service in place of the old loop, grant
                                     its account what the bot reads and
                                     writes, start it by name
      Restart-ThornswoodBotService   stop by name, sweep, start by name
      Repair-ThornswoodBotData       the folder the service writes its log
                                     and records in, there and writable by
                                     its account, for a restart on a box
                                     where it has gone
      Get-ThornswoodServiceSid       NT SERVICE\<name>'s SID, before the
                                     service exists (sc.exe showsid agrees)

  WHY. The bot ran as SYSTEM, every right on the box that holds every secret,
  for a program that decodes images people upload (the join card) and talks to
  Discord all day. It ran under run.ps1, a PowerShell loop in the scheduled
  task 'Thornswood Bot', and nothing stopped it by name: stopping the task left
  python running, so every script that restarted the bot killed python by its
  command line, and the watchdog could not restart a hung bot at all.

  NOW. The service ThornswoodBot runs BotService.cs (built here, on the box,
  by the .NET Framework's csc), which runs python bot.py and rolls bot.log by
  size while it runs. Its account is NT SERVICE\ThornswoodBot, a virtual
  account Windows makes for the service: it has no password, so there is
  nothing to keep, rotate or send (Send-Secret.ps1 has nothing to carry), and
  it is nobody's but the bot's. It keeps one privilege, the one for walking
  folders, like the site's account (Deploy-Docs.ps1 -RunAs), because the
  impersonation right every service gets by default is the usual way from a
  service account to SYSTEM. Its rights on files are granted below and are
  the bot's own folder plus what bot.py reads, measured in bot.py on 29 Sep.

  tests\test-bot-service.ps1 runs these functions here, against stand-ins for
  the service manager and against scratch folders with the real icacls.
#>

# NT SERVICE\<name> is S-1-5-80- and the SHA-1 of the name in upper case as
# UTF-16, read as five 32 bit numbers. Worked out rather than looked up,
# because the account does not exist until the service does, and the files
# are granted before it is started.
function Get-ThornswoodServiceSid([string]$Name) {
  $sha = [Security.Cryptography.SHA1]::Create()
  try { $h = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Name.ToUpperInvariant())) }
  finally { $sha.Dispose() }
  $parts = @()
  for ($i = 0; $i -lt 20; $i += 4) { $parts += [BitConverter]::ToUInt32($h, $i) }
  return ('S-1-5-80-' + ($parts -join '-'))
}

# The python the service runs, by its full path, from the machine PATH as it
# is now (sshd hands out the PATH from before python was installed).
function Get-ThornswoodBotPython() {
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User')
  $p = Get-Command python -CommandType Application -EA SilentlyContinue | Select-Object -First 1
  if ($p) { return $p.Source }
  return ''
}

# What stops the service's account running the bot, one line each, or
# nothing. A python or a library installed for one person lives under
# C:\Users\<them>, which no other account may read, so the service would
# start and fail on its first import. Install-Bot installs python for all
# users and pip then installs beside it, but a python put on by hand, or a
# pip that fell back to a user install, would not be.
function Test-ThornswoodBotPython([string]$Python, [string]$LibDir) {
  # A native program's standard error is a line to read here, not a stop.
  $ErrorActionPreference = 'Continue'
  $bad = @()
  if (-not $Python -or -not (Test-Path -LiteralPath $Python)) { return @('python was not found on this box') }
  $users = '^[A-Za-z]:\\Users\\'
  if ($Python -match $users) { $bad += ('python is installed for one person, at ' + $Python + ', which the service''s account cannot read. Install it for all users.') }
  $oldPyPath = $env:PYTHONPATH
  if ($LibDir) { $env:PYTHONPATH = $LibDir }
  try {
    $said = @(& $Python -c 'import discord, PIL, certifi; print(discord.__file__); print(PIL.__file__); print(certifi.where())' 2>&1 | ForEach-Object { "$_".Trim() })
  } finally {
    if ($LibDir) {
      if ($null -eq $oldPyPath) { Remove-Item Env:PYTHONPATH -EA SilentlyContinue }
      else { $env:PYTHONPATH = $oldPyPath }
    }
  }
  if ($LASTEXITCODE -ne 0) { return ($bad + @('python cannot import discord, PIL and certifi, so the libraries did not install')) }
  foreach ($l in $said) {
    if ($l -match $users) { $bad += ('a library is installed for one person, at ' + $l + ', which the service''s account cannot read. Install requirements.txt as Administrator, for all users.') }
  }
  return $bad
}

# Builds BotService.cs with the .NET Framework's own compiler, which every
# Windows Server has. @{ Ok; Lines }.
function Build-ThornswoodBotHost([string]$Source, [string]$Out) {
  # A native program's standard error is a line to read here, not a stop.
  $ErrorActionPreference = 'Continue'
  # WINDIR is set only on Windows, and the compiler is a part of Windows, so
  # elsewhere it is said rather than joined onto nothing (#2989).
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { return @{ Ok = $false; Lines = @('no .NET Framework compiler: it comes with Windows, and this machine is not Windows') } }
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path -LiteralPath $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
  if (-not (Test-Path -LiteralPath $csc)) { return @{ Ok = $false; Lines = @('no .NET Framework compiler at ' + $csc) } }
  if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force }
  $said = @(& $csc /nologo /target:exe /optimize+ ('/out:' + $Out) /r:System.ServiceProcess.dll /r:System.Web.Extensions.dll $Source 2>&1 |
            ForEach-Object { "$_" } | Where-Object { $_ -and $_ -notmatch 'C# 5|Copyright|provided as part of|LinkID' })
  return @{ Ok = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $Out)); Lines = $said }
}

# A copy of the bot nobody's service started: one somebody ran by hand, or
# the old run.ps1 loop and its python. Either still holds the token and
# answers tickets. Only ever called with the service stopped, so anything
# left with the bot's folder on its command line is not the service's. This
# is the one place anything here looks at a command line: stopping and
# starting the bot is by the service's name.
#
# Each is opened, ended, and waited for until it has exited (StopAndMove.ps1),
# so what it held is closed before the swap moves the bot's folder.
function Stop-ThornswoodBotStrays([string]$Root) {
  $mark = $Root.TrimEnd('\') + '\'
  $strays = @()
  foreach ($p in @(Get-CimInstance Win32_Process -EA SilentlyContinue |
                   Where-Object { $_.Name -match '^(python|pythonw|powershell|pwsh|cmd)' -and $_.CommandLine -and $_.ProcessId -ne $PID })) {
    if ($p.CommandLine.IndexOf($mark, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
    $strays += $p
  }
  $held = @(Get-ThornswoodProcessHeld @($strays | ForEach-Object { [int]$_.ProcessId }))
  $ThornswoodNotHeld
  foreach ($p in $strays) { 'stopped a copy of the bot no service started, pid ' + $p.ProcessId + ' (' + $p.Name + ')' }
  Stop-ThornswoodProcessHeld $held
}

# The service stopped by name, and returned from once its program and the
# python it ran have exited. Stop-Service returns once the service manager
# says Stopped, which is before its process has exited and let go of its
# files: the service program that is replaced next, and the bot's folder the
# swap moves (#2928, measured on the box: a folder refused 15 times in 15 at
# once after a stop, 0 in 15 once its process had exited). Until 20 Oct the
# program was tried ten times a second apart instead. Both opened before the
# stop, so the wait is on them; throws what Stop-Service throws.
function Stop-ThornswoodBotService([string]$Name) {
  $ids = @()
  $w = Get-CimInstance Win32_Service -Filter ("Name = '" + $Name + "'") -EA SilentlyContinue
  if ($w -and $w.ProcessId) {
    $ids += [int]$w.ProcessId
    $ids += @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + [int]$w.ProcessId) -EA SilentlyContinue | ForEach-Object { [int]$_.ProcessId })
  }
  $held = @(Get-ThornswoodProcessHeld $ids)
  $ThornswoodNotHeld
  Stop-Service -Name $Name -Force -ErrorAction Stop
  'stopped the service ' + $Name
  Stop-ThornswoodProcessHeld $held
}

# Whether a stop above left a process it ended still running, or one it could
# not open: what it held may still be open, so nothing it held is replaced.
function Test-ThornswoodBotStopLeft {
  return (@(@($ThornswoodStillRunning) + @($ThornswoodNotHeld) | Where-Object { $_ }).Count -gt 0)
}

# The old loop's two files, beside the code. Remove-ThornswoodBotLoop takes
# them off with the scheduled task that ran them; until a full run has done
# that, they may still be what runs the bot.
function Get-ThornswoodBotLoopFiles { return @('run.ps1', 'roll-log.ps1') }

# The bot's records from before #1104, when it wrote them beside the code.
# Move-ThornswoodBotRecords moves them into data on a full run.
function Get-ThornswoodBotRecordNames {
  return @('heartbeat.json', 'joins.json', 'open-tickets.json', 'commands-synced.json', 'heartbeat.json.tmp', 'joins.json.tmp')
}

# A log of the bot's, by its name: bot.log, its rolls bot.log.1 and on, and a
# bot.log.<anything> somebody renamed by hand to keep it. No install removes
# a log: a full run moves one beside the code into data with the records,
# and there the service deletes every bot.log copy, whatever its name, once
# its last write is 59 days old, so no line outlives the privacy page's 90
# days (BotService.cs, RollingLog.Age, #2166 and #3583).
function Test-ThornswoodBotLogName([string]$Name) { return ($Name -eq 'bot.log' -or $Name -like 'bot.log.*') }

# WHAT THE BOT'S FOLDER HOLDS BESIDES ITS CODE (issue #1184).
#
# The code is what Install-Bot sends, and the swap is told that list. These
# are the rest of the names at the top of the folder that are the bot's own,
# as wildcards, and the swap leaves them where they are. Everything else at
# the top of the folder, and every file in a folder the install sends into
# (assets), was not put there by the install, so the swap moves it aside with
# what the new code replaces ($Owns in Swap.ps1's service swap block).
#
# Seen on the VPS on 29 Sep: backfill.py, redraw.py, sample.py,
# sample-maka.png, sample-mixed.png and a log renamed by hand sat beside
# bot.py, copied there by hand and never taken off, because the install sent a
# fixed list and had no rule for anything else in the folder. Python puts the
# folder bot.py is in first on the bot's import path, so a sample.py there is
# one import away from being run by the bot.
#
#   bot.env.json             the settings and the token (Write-BotToken.ps1)
#   thornswood-deploy.json   the record of what runs here (Artifact.ps1)
#   data                     the records and the log, the one folder the
#                            bot's account writes (#1104)
#   service                  the program the service runs, and host.json
#   webhooks                 the news and dev webhooks, read over ssh
#   py-libs                  the libraries; a full run stages and swaps them,
#                            -CodeOnly leaves them as they are
#   the old loop's files     until a full run takes the loop off (#465)
#   the records and logs     from before #1104, until a full run moves them
#     beside the code        into data
function Get-ThornswoodBotOwned {
  return @('bot.env.json', 'thornswood-deploy.json', 'data', 'service', 'webhooks', 'py-libs', 'bot.log', 'bot.log.*') +
         @(Get-ThornswoodBotLoopFiles) + @(Get-ThornswoodBotRecordNames)
}

# The old loop, taken off once: its scheduled task, whatever it was running,
# and its two files. The service replaces all of it.
function Remove-ThornswoodBotLoop([string]$Root, [string]$Task) {
  $t = Get-ScheduledTask -TaskName $Task -EA SilentlyContinue
  if ($t) {
    Stop-ScheduledTask -TaskName $Task -EA SilentlyContinue
    Unregister-ScheduledTask -TaskName $Task -Confirm:$false -EA SilentlyContinue
    if (Get-ScheduledTask -TaskName $Task -EA SilentlyContinue) { 'COULD NOT REMOVE the old scheduled task ' + $Task }
    else { 'removed the old scheduled task ' + $Task + ', which ran the bot as SYSTEM' }
  }
  Stop-ThornswoodBotStrays $Root
  foreach ($f in @(Get-ThornswoodBotLoopFiles)) {
    $p = Join-Path $Root $f
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force -EA SilentlyContinue; 'removed ' + $p }
  }
}

# The bot's log, where the running service writes it: data\bot.log once the
# install has moved the records (issue #1104), bot.log beside the code on a
# box whose service program is from before, and when both files are there the
# one that was written last, because that is the one the running program is
# writing. Install-Bot, Show-BotLog, Get-Logs and Write-BotToken all read it
# by this rule.
#
# The last clause is why this is not just a test for which files exist.
# Install-Bot leaves an empty data\bot.log on the box on every -CodeOnly run,
# so that the path the docs and Show-BotLog name is always a file; on a box
# whose service program still writes the old place, both are then there, and a
# rule that preferred the newer place would have every reader on an empty file
# while the bot talked to the other one.
function Get-ThornswoodBotLog([string]$Root) {
  $new = Join-Path (Join-Path $Root 'data') 'bot.log'
  $old = Join-Path $Root 'bot.log'
  $o = Get-Item -LiteralPath $old -EA SilentlyContinue
  if (-not $o) { return $new }
  $n = Get-Item -LiteralPath $new -EA SilentlyContinue
  if (-not $n) { return $old }
  if ($o.LastWriteTimeUtc -gt $n.LastWriteTimeUtc) { return $old }
  return $new
}

# The one folder the service's account writes (issue #1104), there and
# writable by that account, before anything is started. A full run makes it
# and grants it with all the other rights (Grant-ThornswoodBotAccess below);
# -CodeOnly does not, and on a box where the folder had gone the service could
# not open bot.log at all, so it did not start, nothing was written anywhere
# to say why, and the swap put the old code back a minute and a half later.
# The grant goes on only when this made the folder, because the rules on one
# that is already there are the full run's and are not second-guessed from
# here. A line for each thing it had to put right, and nothing when there was
# nothing to do.
function Repair-ThornswoodBotData([string]$Root, [string]$Name = 'ThornswoodBot') {
  $data = Join-Path $Root 'data'
  if (Test-Path -LiteralPath $data) { return }
  try { $null = New-Item -ItemType Directory -Force -Path $data -ErrorAction Stop; 'made ' + $data + ', the one folder the bot''s account writes' }
  catch { 'COULD NOT MAKE ' + $data + ': ' + $_.Exception.Message; return }
  $account = 'NT SERVICE\' + $Name
  try {
    $acl = Get-Acl -LiteralPath $data
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier((Get-ThornswoodServiceSid $Name))), 'Modify',
      [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
      [Security.AccessControl.PropagationFlags]::None, 'Allow')))
    Set-ThornswoodAclAccess $data $acl
    'granted ' + $account + ' Modify on it, as a full run does'
  } catch { 'COULD NOT GRANT ' + $account + ' Modify on ' + $data + ': ' + $_.Exception.Message + '. The service cannot write its log until a full Install-Bot.ps1 run grants it.' }
}

# The bot's records and logs, moved out of its code folder into data (issue
# #1104), only ever with the service stopped. One already in data is newer,
# because bot.py writes there once the folder exists, so the copy beside the
# code is then only removed. A log is not removed here: when data already
# has one by its name, it goes into data under that name and
# .beside-code (and a number when that is taken too), keeping its last write,
# so the service ages it with the rest (#3583). Left beside the code, where
# the service cannot delete, it was kept for ever.
# __pycache__ goes: the service's account wrote it and owns it, and Python
# would load a planted file from it ahead of the source. With the code read
# only to the account, Python does not make it again.
function Move-ThornswoodBotRecords([string]$Root) {
  $data = Join-Path $Root 'data'
  if (-not (Test-Path -LiteralPath $data)) { $null = New-Item -ItemType Directory -Force -Path $data; 'made ' + $data }
  $names = @(Get-ThornswoodBotRecordNames)
  $logs = @(Get-ChildItem -LiteralPath $Root -File -Force -EA SilentlyContinue | Where-Object { Test-ThornswoodBotLogName $_.Name } | ForEach-Object { $_.Name })
  foreach ($n in @($names + $logs)) {
    $from = Join-Path $Root $n
    if (-not (Test-Path -LiteralPath $from)) { continue }
    $to = Join-Path $data $n
    try {
      if (-not (Test-Path -LiteralPath $to)) { Move-Item -LiteralPath $from -Destination $to -Force -ErrorAction Stop; 'moved ' + $n + ' into ' + $data }
      elseif ($n -notmatch '^bot\.log') { Remove-Item -LiteralPath $from -Force -ErrorAction Stop; 'removed the old ' + $n + ' beside the code; data holds the newer one' }
      else {
        $as = $n + '.beside-code'
        for ($i = 2; Test-Path -LiteralPath (Join-Path $data $as); $i++) { $as = $n + '.beside-code-' + $i }
        Move-Item -LiteralPath $from -Destination (Join-Path $data $as) -ErrorAction Stop
        'moved ' + $n + ' into ' + $data + ' as ' + $as + ': data already has its own ' + $n
      }
    } catch { 'COULD NOT MOVE ' + $from + ': ' + $_.Exception.Message }
  }
  $cache = Join-Path $Root '__pycache__'
  if (Test-Path -LiteralPath $cache) {
    try { Remove-Item -LiteralPath $cache -Recurse -Force -ErrorAction Stop; 'removed ' + $cache + ', which the bot''s account had written' }
    catch { 'COULD NOT REMOVE ' + $cache + ': ' + $_.Exception.Message }
  }
}

# What the service's account may touch, and nothing else of Thornswood's:
#   the bot's folder, read and run only (issue #1104): the code, the card
#     art, the channel ids. It inherits nothing from C:\, so no BUILTIN\Users
#     rule reaches it (every service account is in Users), and OWNER RIGHTS
#     is held to read and run, so a file the account made before this and
#     still owns cannot have its rules changed by it.
#   data\ under it, Modify: bot.log and its rolls, heartbeat.json,
#     joins.json, open-tickets.json and commands-synced.json. The one place
#     the account writes.
#   service\ under it, read only and not inherited from the folder, so the
#     account cannot change the program or host.json that start it.
#   webhooks\ under it, nothing: SYSTEM and Administrators only. The news
#     and dev webhooks are read over ssh by the machines that ship, never by
#     the bot.
#   bot.env.json, read. It is protected (Install-Bot), so this is the one
#     rule on it besides SYSTEM and Administrators.
#   the watchdog's folder, read on the files in it (alerts.jsonl, what the
#     webhook already posted), and Modify on alerts-sent-bot.txt, the one file
#     there the bot writes. The webhook's own file is protected and stays out
#     of reach.
#   the site's data\for-bot, read (issue #1102): trouble.json, inbox.json and
#     moderation.log, which the site writes there for the bot and nothing
#     else. The rule the bot had on the site's whole data folder before, where
#     sessions.json and the other records are, is taken off.
#   the site's data\from-bot, Modify (issue #3140): lists.json, the site's
#     Known Issues page and roadmap, which the bot builds from the board and
#     the site shows. The one folder of the site's the bot writes.
#   each game server's for-bot folder, read on it and everything in it
#     (issue #2321): the gamemode's staff log, moderation.log, which the
#     bot says in the staff channel. A folder, made here when the server has
#     none yet, so the log the gamemode makes later takes the rule. Until
#     #2321 the rule was on private\moderation.log itself, which could only
#     be given once the gamemode had made the file; the live server had
#     none, so its first staff action made a file the bot could not open.
#     That old rule is taken off. private\ stays SYSTEM's and
#     Administrators' alone: it holds door.json and its key.
# Writes back only the access rules of an ACL from Get-Acl. Set-Acl can also
# try to write the audit part, which needs SeSecurityPrivilege: Administrator
# has it, and the build runner's account does not, so on the runner Set-Acl
# refused the grant on bot.env.json (issue #1120). Nothing here changes
# auditing, so .NET is asked to persist what changed, the access rules.
function Set-ThornswoodAclAccess([string]$Path, $Acl) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item -is [IO.DirectoryInfo]) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, [Security.AccessControl.DirectorySecurity]$Acl) }
  else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, [Security.AccessControl.FileSecurity]$Acl) }
}

# Given again at every install; the same rule added twice is kept once.
# Built in .NET rather than with icacls, because icacls will not name an
# account Windows cannot look up, and the service's is granted in the tests
# on a machine that has no such service.
function Grant-ThornswoodBotAccess {
  param([string]$Sid, [string]$Root, [string]$WatchRoot, [string]$DocsData, [string[]]$ServerRoots = @())
  $tree = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $none = [Security.AccessControl.PropagationFlags]::None
  $bot = New-Object Security.Principal.SecurityIdentifier($Sid)
  # SYSTEM, Administrators, and whoever runs this, which is Administrator
  # over ssh, the same three bot.env.json keeps.
  $admins = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  # Everyone, Authenticated Users, Users, CREATOR OWNER: never on a folder of
  # the bot's.
  $broad = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-3-0')
  function Rule([string]$s, $rights, $inherit) {
    return New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($s)), $rights, $inherit, $none, 'Allow')
  }
  # $how: 'tree' is this folder and everything under it, 'files' the files
  # directly in this folder, '' the one file.
  function Give([string]$path, [string]$rights, [string]$how, [string]$what) {
    if (-not (Test-Path -LiteralPath $path)) { return ('not there yet, nothing granted: ' + $path) }
    $inherit = [Security.AccessControl.InheritanceFlags]::None
    $prop = [Security.AccessControl.PropagationFlags]::None
    if ($how -eq 'tree') { $inherit = $tree }
    if ($how -eq 'files') { $inherit = [Security.AccessControl.InheritanceFlags]::ObjectInherit; $prop = [Security.AccessControl.PropagationFlags]::NoPropagateInherit }
    try {
      $acl = Get-Acl -LiteralPath $path
      $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($bot, $rights, $inherit, $prop, 'Allow')))
      Set-ThornswoodAclAccess $path $acl
      return ('granted ' + $what + ' on ' + $path)
    } catch { return ('COULD NOT GRANT ' + $what + ' on ' + $path + ': ' + $_.Exception.Message) }
  }
  # Protected, SYSTEM and Administrators Full Control, the broad groups and
  # every allow rule of the bot's own taken off; any other rule set on the
  # folder by hand or by another script (a deny for the build runner) stays.
  function Lock([string]$path, [string]$what) {
    try {
      $acl = Get-Acl -LiteralPath $path
      $acl.SetAccessRuleProtection($true, $false)
      foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        if ($r.AccessControlType -ne 'Allow') { continue }
        if ($broad -contains $r.IdentityReference.Value -or $r.IdentityReference.Value -eq $Sid) { [void]$acl.RemoveAccessRuleSpecific($r) }
      }
      foreach ($s in $admins) { $acl.AddAccessRule((Rule $s 'FullControl' $tree)) }
      Set-ThornswoodAclAccess $path $acl
      return ($what + ': ' + $path)
    } catch { return ('COULD NOT LOCK ' + $path + ': ' + $_.Exception.Message) }
  }
  $locked = Lock $Root 'the bot''s folder takes nothing from C:\ and no Users rule reaches it'
  $locked
  if ($locked -notmatch '^COULD NOT') {
    try {
      $acl = Get-Acl -LiteralPath $Root
      $acl.AddAccessRule((Rule $Sid 'ReadAndExecute' $tree))
      $acl.AddAccessRule((Rule 'S-1-3-4' 'ReadAndExecute' $tree))
      Set-ThornswoodAclAccess $Root $acl
      'the bot''s code is read only to the bot''s account, and to whoever owns a file in it: ' + $Root
    } catch { 'COULD NOT GRANT the bot''s account read on ' + $Root + ': ' + $_.Exception.Message }
  }
  $data = Join-Path $Root 'data'
  if (-not (Test-Path -LiteralPath $data)) { $null = New-Item -ItemType Directory -Force -Path $data }
  Give $data 'Modify' 'tree' 'the bot''s account Modify, the one folder it writes,'
  $hooks = Join-Path $Root 'webhooks'
  if (Test-Path -LiteralPath $hooks) {
    try {
      $acl = Get-Acl -LiteralPath $hooks
      $acl.SetAccessRuleProtection($true, $false)
      foreach ($r in @($acl.Access)) { [void]$acl.RemoveAccessRule($r) }
      foreach ($s in $admins) { $acl.AddAccessRule((Rule $s 'FullControl' $tree)) }
      Set-ThornswoodAclAccess $hooks $acl
      'the webhooks are SYSTEM''s and Administrators'' only: ' + $hooks
    } catch { 'COULD NOT LOCK ' + $hooks + ': ' + $_.Exception.Message }
  }
  $svc = Join-Path $Root 'service'
  if (Test-Path -LiteralPath $svc) {
    try {
      $acl = Get-Acl -LiteralPath $svc
      $acl.SetAccessRuleProtection($true, $false)
      foreach ($r in @($acl.Access)) { [void]$acl.RemoveAccessRule($r) }
      $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
      $none = [Security.AccessControl.PropagationFlags]::None
      # SYSTEM, Administrators, and whoever runs this, which is Administrator
      # over ssh, the same three bot.env.json keeps.
      foreach ($s in @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
          (New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', $inherit, $none, 'Allow')))
      }
      $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        (New-Object Security.Principal.SecurityIdentifier($Sid)), 'ReadAndExecute', $inherit, $none, 'Allow')))
      Set-ThornswoodAclAccess $svc $acl
      'the service program''s folder is read only to the bot''s account: ' + $svc
    } catch { 'COULD NOT LOCK ' + $svc + ': ' + $_.Exception.Message }
  }
  Give (Join-Path $Root 'bot.env.json') 'Read' '' 'the bot''s account read'
  if ($WatchRoot) {
    if (Test-Path -LiteralPath $WatchRoot) {
      Give $WatchRoot 'Read' 'files' 'the bot''s account read on the files'
      $sent = Join-Path $WatchRoot 'alerts-sent-bot.txt'
      if (-not (Test-Path -LiteralPath $sent)) { [IO.File]::WriteAllText($sent, '') }
      Give $sent 'Modify' '' 'the bot''s account Modify'
    } else { 'not there yet, nothing granted: ' + $WatchRoot + '. Run Install-Bot.ps1 again after Watch-Services.ps1 -Install' }
  }
  if ($DocsData -and (Test-Path -LiteralPath $DocsData)) {
    # The rule from before #1102, read on every file in the site's data.
    try {
      $acl = Get-Acl -LiteralPath $DocsData
      if (@($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $Sid }).Count) {
        $acl.PurgeAccessRules($bot)
        Set-ThornswoodAclAccess $DocsData $acl
        'took the bot''s account off the site''s data folder, where the site''s own records are: ' + $DocsData
      }
    } catch { 'COULD NOT TAKE the bot''s account off ' + $DocsData + ': ' + $_.Exception.Message }
    $forBot = Join-Path $DocsData 'for-bot'
    if (Test-Path -LiteralPath $forBot) { Give $forBot 'Read' 'tree' 'the bot''s account read' }
    else { 'not there yet, nothing granted: ' + $forBot + '. Run Deploy-Docs.ps1, whose site makes it, then Install-Bot.ps1 again' }
    $fromBot = Join-Path $DocsData 'from-bot'
    if (Test-Path -LiteralPath $fromBot) { Give $fromBot 'Modify' 'tree' 'the bot''s account Modify, on the known issues and roadmap it writes for the site,' }
    else { 'not there yet, nothing granted: ' + $fromBot + '. Run Deploy-Docs.ps1, whose site makes it, then Install-Bot.ps1 again' }
  }
  foreach ($s in $ServerRoots) {
    if (-not (Test-Path -LiteralPath $s)) { 'no game server at ' + $s + ', so nothing granted there'; continue }
    $fb = Join-Path $s 'for-bot'
    if (-not (Test-Path -LiteralPath $fb)) {
      try { $null = New-Item -ItemType Directory -Force -Path $fb -ErrorAction Stop; 'made ' + $fb + ', where the gamemode writes its staff log' }
      catch { 'COULD NOT MAKE ' + $fb + ': ' + $_.Exception.Message; continue }
    }
    Give $fb 'Read' 'tree' 'the bot''s account read, on the staff log the gamemode writes there and any it makes later,'
    # The rule from before #2321, on private\moderation.log alone. The bot
    # reads for-bot now, so nothing of private is left to it.
    $was = Join-Path $s 'private\moderation.log'
    if (Test-Path -LiteralPath $was) {
      try {
        $acl = Get-Acl -LiteralPath $was
        if (@($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $Sid }).Count) {
          $acl.PurgeAccessRules($bot)
          Set-ThornswoodAclAccess $was $acl
          'took the bot''s account off ' + $was + ', which it no longer reads'
        }
      } catch { 'COULD NOT TAKE the bot''s account off ' + $was + ': ' + $_.Exception.Message }
    }
  }
}

# Whether the service's name is a source in the event log yet. Only
# Administrator can make one, so the install does, and the service writes to it.
function Test-ThornswoodEventSource([string]$Name) {
  return [Diagnostics.EventLog]::SourceExists($Name)
}

# host.json beside the service program: the bot's folder, the data folder it
# writes (issue #1104) and the python the service runs. Written as UTF-8 with
# no mark.
function Write-ThornswoodBotHostJson([string]$Path, [string]$Root, [string]$Python) {
  $o = [ordered]@{ root = $Root; data = (Join-Path $Root 'data'); python = $Python; script = 'bot.py' }
  [IO.File]::WriteAllText($Path, ($o | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}

# The whole switch. Everything that can fail without touching the running
# bot is done first: python checked, the program built beside the old one.
# Only then is anything stopped. @{ Ok; Lines }.
function Install-ThornswoodBotService {
  param(
    [string]$Name = 'ThornswoodBot',
    [string]$Root = 'C:\Thornswood-Bot',
    [string]$Python,
    [string]$Source,
    [string]$Task = 'Thornswood Bot',
    [string]$WatchRoot = 'C:\Thornswood-Watch',
    [string]$DocsData = 'C:\Thornswood-Docs\data',
    [string[]]$ServerRoots = @('C:\Thornswood-Server', 'C:\Thornswood-Server-Dev')
  )
  # A native program's standard error is a line to read here, not a stop.
  $ErrorActionPreference = 'Continue'
  $out = @()
  $account = 'NT SERVICE\' + $Name
  $sid = Get-ThornswoodServiceSid $Name

  if (-not $Python) { $Python = Get-ThornswoodBotPython }
  $bad = @(Test-ThornswoodBotPython $Python (Join-Path $Root 'py-libs'))
  if ($bad.Count) {
    return @{ Ok = $false; Lines = @($bad | ForEach-Object { 'CANNOT SWITCH: ' + $_ }) + @('Nothing was stopped or changed.') }
  }
  $out += 'python for the service: ' + $Python

  $dir = Join-Path $Root 'service'
  if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
  $exe = Join-Path $dir 'ThornswoodBotService.exe'
  $new = Join-Path $dir 'ThornswoodBotService.new.exe'
  # Registered bare, below. A space would make it a path Windows reads more
  # than one way, which is how a service ends up starting something else.
  if ($exe -match '\s') { return @{ Ok = $false; Lines = @('CANNOT SWITCH: the bot''s folder has a space in its path, ' + $Root + '. Nothing was stopped or changed.') } }
  $b = Build-ThornswoodBotHost $Source $new
  if (-not $b.Ok) {
    return @{ Ok = $false; Lines = $out + @('THE SERVICE PROGRAM DID NOT BUILD. Nothing was stopped or changed.') + @($b.Lines | Select-Object -First 20) }
  }
  $out += 'built the service program from ' + (Split-Path -Leaf $Source)

  # Stopped by name, then the old loop, then any copy started by hand, each
  # waited for until it has exited. Held from the stop until the start below,
  # or until this gives up and leaves the bot to the watchdog (#5155).
  $svc = Get-Service -Name $Name -EA SilentlyContinue
  $out += @(Set-ThornswoodHold -Target $Name -Why 'putting in the bot''s service program' -By $HoldBy -Root $WatchRoot)
  if ($svc -and "$($svc.Status)" -ne 'Stopped') {
    try { $out += @(Stop-ThornswoodBotService $Name) }
    catch { return @{ Ok = $false; Lines = $out + @('COULD NOT STOP the service ' + $Name + ': ' + $_.Exception.Message) + @(Clear-ThornswoodHold -Target $Name -Root $WatchRoot) } }
    if (Test-ThornswoodBotStopLeft) { return @{ Ok = $false; Lines = $out + @('THE SERVICE PROGRAM HAS NOT EXITED, so it was not replaced. The bot is stopped; the line above names the process.') + @(Clear-ThornswoodHold -Target $Name -Root $WatchRoot) } }
  }
  $out += @(Remove-ThornswoodBotLoop -Root $Root -Task $Task)
  $out += @(Stop-ThornswoodBotStrays $Root)

  # The new program over the old, once: everything that ran it has exited.
  try { Move-Item -LiteralPath $new -Destination $exe -Force -ErrorAction Stop }
  catch { return @{ Ok = $false; Lines = $out + @('COULD NOT REPLACE ' + $exe + ' (' + $_.Exception.Message + '; open in it then: ' + (Get-ThornswoodPathHolders $exe) + '). The bot is stopped.') + @(Clear-ThornswoodHold -Target $Name -Root $WatchRoot) } }
  Write-ThornswoodBotHostJson (Join-Path $dir 'host.json') $Root $Python

  # The service. Its program path has no spaces in it, and every setting on
  # the sc.exe lines is plain, so nothing here depends on how quotes survive
  # a native command line. No password: a virtual account has none.
  if (-not $svc) {
    try {
      New-Service -Name $Name -BinaryPathName $exe -DisplayName 'Thornswood Bot' -StartupType Automatic `
        -Description 'The Thornswood Discord bot. Installed by Install-Bot.ps1; bot.log is in the data folder under its folder.' -ErrorAction Stop | Out-Null
      $out += 'made the service ' + $Name
    } catch { return @{ Ok = $false; Lines = $out + @('COULD NOT MAKE the service ' + $Name + ': ' + $_.Exception.Message) + @(Clear-ThornswoodHold -Target $Name -Root $WatchRoot) } }
  }
  foreach ($c in @(
      @('config', $Name, 'binPath=', $exe, 'start=', 'auto', 'obj=', $account),
      @('sidtype', $Name, 'unrestricted'),
      @('privs', $Name, 'SeChangeNotifyPrivilege'),
      # A crash of the service program itself: started again after a minute,
      # then after five, the count forgotten after an hour. The bot's own
      # exits are the program's to handle, and a give-up is a clean stop that
      # this does not undo.
      @('failure', $Name, 'reset=', '3600', 'actions=', 'restart/60000/restart/300000'))) {
    $said = & sc.exe @c 2>&1
    if ($LASTEXITCODE -ne 0) { return @{ Ok = $false; Lines = $out + @('COULD NOT SET ' + $c[0] + ' on ' + $Name + ': ' + (($said | Out-String).Trim())) + @(Clear-ThornswoodHold -Target $Name -Root $WatchRoot) } }
  }
  $out += 'the service runs as ' + $account + ', with one privilege, and restarts itself if it crashes'

  try {
    if (-not (Test-ThornswoodEventSource $Name)) { New-EventLog -LogName Application -Source $Name -ErrorAction Stop }
    $out += 'the bot''s exits go to the Application event log as ' + $Name
  } catch { $out += 'no event log source, so exits are in bot.log only: ' + $_.Exception.Message }

  $out += @(Move-ThornswoodBotRecords $Root)
  $out += @(Grant-ThornswoodBotAccess -Sid $sid -Root $Root -WatchRoot $WatchRoot -DocsData $DocsData -ServerRoots $ServerRoots)

  $started = ''
  try { Start-Service -Name $Name -ErrorAction Stop; $out += 'started the service ' + $Name }
  catch { $started = $_.Exception.Message }
  $out += @(Clear-ThornswoodHold -Target $Name -Root $WatchRoot)
  if ($started) { return @{ Ok = $false; Lines = $out + @('THE SERVICE DID NOT START: ' + $started) } }
  $w = Get-CimInstance Win32_Service -Filter ("Name = '" + $Name + "'") -EA SilentlyContinue
  if ($w) { $out += 'service ' + $Name + ': ' + $w.State + ', as ' + $w.StartName }
  return @{ Ok = $true; Lines = $out }
}

# Stop by name, the sweep, start by name. What -CodeOnly does after sending
# the code. $null when there is no service yet, which means the full install
# has not been run on this box. Held from the stop to the start (#5155).
function Restart-ThornswoodBotService([string]$Name = 'ThornswoodBot', [string]$Root = 'C:\Thornswood-Bot', [string]$WatchRoot = 'C:\Thornswood-Watch') {
  if (-not (Get-Service -Name $Name -EA SilentlyContinue)) { return $null }
  $out = @()
  $out += @(Set-ThornswoodHold -Target $Name -Why 'restarting the bot' -By $HoldBy -Root $WatchRoot)
  try { $out += @(Stop-ThornswoodBotService $Name) }
  catch { $out += 'COULD NOT STOP the service ' + $Name + ': ' + $_.Exception.Message }
  $out += @(Stop-ThornswoodBotStrays $Root)
  try { Start-Service -Name $Name -ErrorAction Stop; $out += 'started the service ' + $Name }
  catch { $out += 'THE SERVICE DID NOT START: ' + $_.Exception.Message }
  $out += @(Clear-ThornswoodHold -Target $Name -Root $WatchRoot)
  return $out
}
