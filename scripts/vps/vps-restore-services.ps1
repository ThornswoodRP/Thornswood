<#
  vps-restore-services.ps1

  Runs ON the VPS, sent there by Restore-Box.ps1: puts the site's, the bot's
  and Caddy's half of an unpacked nightly backup back into their folders. The
  game servers' half is Restore-Server.ps1; this is everything else
  RESTORING.md in the ops repo used to leave to hand copying on a box that has no repo
  (issue #454).

      vps-restore-services.ps1 -From C:\Thornswood-Restore\unpacked

  What goes where:
    site\data          -> C:\Thornswood-Docs\data        whole
    site\config.json   -> C:\Thornswood-Docs\config.json
    site\uploads       -> C:\Thornswood-Docs\uploads     whole
    site\feed\...      -> C:\Thornswood-Docs\feed\...    the feed's store:
    site\feed-dev\...  -> C:\Thornswood-Docs\feed-dev\... published.json,
                          launchers.txt, releases.txt, and the feed's
                          generations (version\, #2727) and history merged
                          in. Never the assets folder, which
                          Remirror-Site-Feed.ps1 fills.
    bot\bot.env.json   -> C:\Thornswood-Bot\bot.env.json, readable by SYSTEM
                          and Administrators only, as Install-Bot.ps1 leaves it
    bot\joins.json     -> C:\Thornswood-Bot\data\joins.json, the bot's data
                          folder (issue #1104)
    web\Caddyfile      -> C:\Thornswood-Caddy\Caddyfile

  Not put back: voice\choices.json. The backup still takes it, and nothing has
  read it since the voice service's character choices went on 20 September.

  Whatever was already in a place is moved aside to <name>-before-restore-
  <stamp> beside it. Decided by Patrick on 26 Oct (#3620, B): those that hold
  people are kept 30 days by the stamp in their name, so a restore can be
  undone, then deleted by what owns them: the site's data, uploads and
  config.json by the site's hourly retention sweep (site\server.js), the
  bot's joins.json by the bot's hourly join-number watch (bot\bot.py).
  Delete-Person.ps1 takes a deleted person out of both while they are there.
  The Caddyfile, the feed's files and bot.env.json hold nobody and are left;
  each is named on its 'kept' line, to be deleted by hand once the restore is
  good. The site's data folder, its config and the
  bot's settings are the ones a restore is for: when any of those three is not
  in the backup this ends SERVICES INCOMPLETE with exit 1, after placing the
  rest. It refuses to start while the site or the bot is running from those
  folders, because either one writes there while it runs.

  It also says whether each game server's gamemode.js and gamemode-tables
  (#5191) are the ones the backup was taken with, because the payload installed on a new box carries whatever
  main has, and a live server should not start on a gamemode nobody tried on
  dev without somebody saying so.

  Prints SERVICES OK and exits 0 when all three are back.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$From,
  [string]$SiteRoot    = 'C:\Thornswood-Docs',
  [string]$BotRoot     = 'C:\Thornswood-Bot',
  [string]$CaddyRoot   = 'C:\Thornswood-Caddy',
  [string]$GameRoot    = 'C:\Thornswood-Server',
  [string]$DevGameRoot = 'C:\Thornswood-Server-Dev'
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path -LiteralPath $From)) { 'STOP. There is no unpacked backup at ' + $From; exit 1 }
$From = (Resolve-Path -LiteralPath $From).Path.TrimEnd('\')
if (-not (Test-Path -LiteralPath (Join-Path $From 'site')) -and -not (Test-Path -LiteralPath (Join-Path $From 'bot'))) {
  'STOP. ' + $From + ' has neither site nor bot in it, so it is not an unpacked nightly backup.'
  exit 1
}

# ------------------------------------------------------------ not running ---
# node or python whose command line names one of the two folders. Only those:
# the shell this runs in names its own arguments, and that is not a service.
$busy = @()
try {
  foreach ($p in @(Get-CimInstance Win32_Process -EA SilentlyContinue)) {
    if ($p.ProcessId -eq $PID -or -not $p.CommandLine) { continue }
    if ($p.Name -ne 'node.exe' -and $p.Name -notlike 'python*') { continue }
    foreach ($r in $SiteRoot, $BotRoot) {
      if ($p.CommandLine.IndexOf($r, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $busy += ('{0} (pid {1})' -f $r, $p.ProcessId) }
    }
  }
} catch { }
if ($busy.Count) {
  'STOP. Running from a folder this writes into: ' + ($busy -join ', ') + '. Stop it first; nothing was put back.'
  exit 1
}

# ------------------------------------------------------------------ place ---
$missing = @()
$essential = @()
function Aside([string]$dst) {
  if (-not (Test-Path -LiteralPath $dst)) { return }
  $leaf = Split-Path -Leaf $dst
  $to = Join-Path (Split-Path -Parent $dst) ($leaf + '-before-restore-' + $stamp)
  # Two restores inside one second (the harness does it on the build runner)
  # would meet the first one's copy here: a file stops the move, a folder goes
  # inside it. The second gets -2, the third -3 (issue #1107).
  $n = 2
  while (Test-Path -LiteralPath $to) {
    $to = Join-Path (Split-Path -Parent $dst) ($leaf + '-before-restore-' + $stamp + '-' + $n)
    $n++
  }
  Move-Item -LiteralPath $dst -Destination $to
  'kept      ' + $dst + ' as it was, at ' + $to
}
function Place([string]$rel, [string]$dst, [switch]$Essential) {
  $src = Join-Path $From $rel
  if (-not (Test-Path -LiteralPath $src)) {
    'missing   ' + $rel + ' is not in this backup'
    $script:missing += $rel
    if ($Essential) { $script:essential += $rel }
    return
  }
  $parent = Split-Path -Parent $dst
  if (-not (Test-Path -LiteralPath $parent)) { [void](New-Item -ItemType Directory -Path $parent -Force) }
  $item = Get-Item -LiteralPath $src
  if ($item.PSIsContainer) {
    # An empty folder the installers made is not worth keeping aside.
    if ((Test-Path -LiteralPath $dst) -and -not @(Get-ChildItem -LiteralPath $dst -Force -EA SilentlyContinue).Count) {
      Remove-Item -LiteralPath $dst -Recurse -Force
    }
    Aside $dst
    Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
    $n = @(Get-ChildItem -LiteralPath $dst -Recurse -File -Force -EA SilentlyContinue).Count
    'placed    ' + $rel + ' -> ' + $dst + ' (' + $n + ' files)'
  } else {
    Aside $dst
    Copy-Item -LiteralPath $src -Destination $dst -Force
    'placed    ' + $rel + ' -> ' + $dst
  }
}

Place 'site\data'        (Join-Path $SiteRoot 'data') -Essential
Place 'site\config.json' (Join-Path $SiteRoot 'config.json') -Essential
Place 'site\uploads'     (Join-Path $SiteRoot 'uploads')

# The feed's store, file by file, because the feed folder also holds the
# assets, which are not in any backup and may already be arriving from
# Remirror-Site-Feed.ps1. The feed's generations (version\, #2727) and history
# are merged: nothing already there is replaced, as nothing there ever is.
foreach ($feed in 'feed', 'feed-dev') {
  if (-not (Test-Path -LiteralPath (Join-Path $From "site\$feed"))) {
    'missing   site\' + $feed + ' is not in this backup (backups before issue #454 do not carry the feed; see MOVING-THE-SERVER.md in the ops repo)'
    $missing += "site\$feed"
    continue
  }
  foreach ($n in 'published.json', 'launchers.txt', 'releases.txt') {
    if (Test-Path -LiteralPath (Join-Path $From "site\$feed\$n")) { Place "site\$feed\$n" (Join-Path $SiteRoot "$feed\$n") }
  }
  foreach ($kept in 'version', 'history') {
    $hist = Join-Path $From "site\$feed\$kept"
    if (-not (Test-Path -LiteralPath $hist)) { continue }
    $to = Join-Path $SiteRoot "$feed\$kept"
    [void](New-Item -ItemType Directory -Path $to -Force)
    $k = 0
    foreach ($f in @(Get-ChildItem -LiteralPath $hist -File -Force)) {
      if (Test-Path -LiteralPath (Join-Path $to $f.Name)) { continue }
      Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $to $f.Name)
      $k++
    }
    'placed    site\' + $feed + '\' + $kept + ' -> ' + $to + ' (' + $k + ' files it did not have)'
  }
}

Place 'bot\bot.env.json' (Join-Path $BotRoot 'bot.env.json') -Essential
$envFile = Join-Path $BotRoot 'bot.env.json'
if (Test-Path -LiteralPath $envFile) {
  # The token is in it. SYSTEM (the bot's task) and Administrators, and
  # nobody else, the same as Install-Bot.ps1 leaves it.
  try {
    $acl = Get-Acl -LiteralPath $envFile
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in @($acl.Access)) { [void]$acl.RemoveAccessRule($r) }
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
      $who = (New-Object Security.Principal.SecurityIdentifier($sid)).Translate([Security.Principal.NTAccount])
      $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'Allow')))
    }
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      [Security.Principal.WindowsIdentity]::GetCurrent().Name, 'FullControl', 'Allow')))
    Set-Acl -LiteralPath $envFile -AclObject $acl
    'locked    ' + $envFile + ' to SYSTEM and Administrators'
  } catch { 'COULD NOT LOCK ' + $envFile + ': ' + $_.Exception.Message }
}
Place 'bot\joins.json'   (Join-Path $BotRoot 'data\joins.json')
Place 'web\Caddyfile'    (Join-Path $CaddyRoot 'Caddyfile')
if (Test-Path -LiteralPath (Join-Path $From 'voice\choices.json')) {
  'left      voice\choices.json: nothing has read it since 20 September'
}

# --------------------------------------------------------------- gamemode ---
foreach ($g in @(@{ Tag = 'game'; Root = $GameRoot }, @{ Tag = 'game-dev'; Root = $DevGameRoot })) {
  $had = Join-Path $From ($g.Tag + '\gamemode.js')
  $has = Join-Path $g.Root 'gamemode.js'
  if (-not (Test-Path -LiteralPath $had) -or -not (Test-Path -LiteralPath $has)) { continue }
  if ((Get-FileHash -LiteralPath $had).Hash -eq (Get-FileHash -LiteralPath $has).Hash) {
    'gamemode  ' + $has + ' is the one the backup''s ' + $g.Tag + ' ran'
  } else {
    'GAMEMODE DIFFERS  ' + $has + ' is not the one the backup''s ' + $g.Tag + ' ran. Ask before starting it (MOVING-THE-SERVER.md in the ops repo).'
  }
  # Its tables, each by name and hash: the gamemode reads them as it loads.
  $hadT = Join-Path $From ($g.Tag + '\gamemode-tables')
  $hasT = Join-Path $g.Root 'gamemode-tables'
  $sumsOf = {
    param($dir)
    if (-not (Test-Path -LiteralPath $dir)) { return '' }
    (@(Get-ChildItem -LiteralPath $dir -Filter '*.json' -File | Sort-Object Name |
      ForEach-Object { $_.Name + ' ' + (Get-FileHash -LiteralPath $_.FullName).Hash })) -join "`n"
  }
  $hadSums = & $sumsOf $hadT
  $hasSums = & $sumsOf $hasT
  if ($hadSums -eq $hasSums) {
    'gamemode  ' + $hasT + ' are the tables the backup''s ' + $g.Tag + ' ran'
  } else {
    'GAMEMODE DIFFERS  ' + $hasT + ' are not the tables the backup''s ' + $g.Tag + ' ran. Ask before starting it (MOVING-THE-SERVER.md in the ops repo).'
  }
}

''
if ($essential.Count) {
  'SERVICES INCOMPLETE: not in the backup: ' + ($essential -join ', ')
  exit 1
}
'SERVICES OK: the site''s data and config and the bot''s settings are back'
exit 0
