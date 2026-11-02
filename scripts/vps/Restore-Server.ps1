<#
  Restore-Server.ps1

  Puts a nightly backup's world back into a game server folder and checks the
  result would start: the load order resolves and the characters are there.

      .\scripts\vps\Restore-Server.ps1 -Backup <file>.zip.enc -Root C:\Thornswood-Restore-Test
      .\scripts\vps\Restore-Server.ps1 -Backup <file>.zip.enc -Root C:\Thornswood-Server-Dev -Which dev
      .\scripts\vps\Restore-Server.ps1 -Backup <file>.zip.enc -Root <folder> -Expect 1234567
      .\scripts\vps\Restore-Server.ps1 -Backup <file>.zip.enc -Root <folder> -Work C:\Thornswood-Repo\temp\restore
      .\scripts\vps\Restore-Server.ps1 -Backup <file>.zip.enc -Root <throwaway folder> -Rehearse [-Port 7800 -VoicePort 7802]

  Restore-Backup.ps1 checks the signature and unpacks; this is the step after
  it that RESTORING.md in the ops repo used to leave to hand copying. It takes the
  backup's game (live) or game-dev (dev) half and lays it into -Root:

    world    whole, because the backup is the truth about who exists
    private  whole: characters.json, mod-settings.json, take-limit.json,
             door.json, allowed.json. Nothing in a build ships into it.
    data     only the files the folder does not already have, so a build
             already installed there keeps its own shipped files
    server-settings.json, gamemode.js and gamemode-tables (#5191)
             only when the folder has none, for the same reason, EXCEPT the
             keys that say which server this is: port, name,
             thornswoodVoicePort, thornswoodServer and
             thornswoodLoadOrderRefuse come from the backup. The payload on
             the box (C:\thornswood-server.zip) is whichever channel was
             published last, and on the first rehearsal (28 September) it was
             a dev one: a live restore kept port 7787 and the name
             Thornswood Dev, so the live server would have come back as the
             dev one. The join pass switch and the written role lists,
             thornswoodRequirePass, thornswoodDevs and thornswoodPlaytesters,
             come from the backup too (#1845): they are the server's own and
             no build carries them (#1223), so the payload's would be nobody's
             choice. Those three are named and their values never printed.

  Whatever world and private the folder already had is moved aside into
  world-before-restore-<stamp> inside it, kept 30 days so the restore can be
  undone, then deleted by the server's server-log.js (#3620).

  -Root must already hold the server program and its plugins: on a new box,
  Install-ThornswoodServer.ps1 -Zip <payload> -Root <it> -NoTask first. The
  backup does not carry them; they come from the repo.

  THE LOAD ORDER CHECK. server-settings.json names each plugin by its full
  path, C:/Thornswood-Server/plugins/..., so a throwaway folder restored from
  a live backup would "resolve" against the live server's plugins and prove
  nothing. Any entry whose folder is not -Root is pointed at -Root first (the
  same rewrite vps-dev-instance.ps1 does for dev), and then every entry must
  be on disk. One that is not is named and the run ends with exit 1, the same
  refusal Install-ThornswoodServer.ps1 makes.

  THE CHARACTER CHECK. A character is a runtime change form in
  world\changeForms, named with its form id in lowercase hex and no plugin
  (0.json, 1.json, ..., a.json, 1f.json: the engine's FormDesc::ToString,
  %x; a slot number, not the profile id), whose profileId is set and which is
  not deleted. Reading digits alone missed every character whose id has a
  letter (#5168; the 1 Nov 2026 rehearsal on the box found none in dev). A deleted character
  keeps its slot file with profileId -1 and isDeleted true, so counting the
  files counted the dead too: the first real rehearsal, 28 September, found
  18 slot files on live and 11 people in them. No characters is exit 1.
  -Expect <profile id> (the number the launcher and the site show, in
  decimal) also requires that person's character.

  It refuses to touch a folder whose server is running: the server writes
  world while it runs and would write straight back over the restore.

  Prints RESTORE OK and exits 0 only when every check above passed.

  A REHEARSAL, -Rehearse (issue #1046). A restore makes the folder BE the
  server it came from: its port, its name and private\door.json, which names
  the live site and holds the key the site trusts and the join pass key. That
  is right for a real restore and wrong for a throwaway folder somebody means
  to start and connect to, and RESTORING.md in the ops repo left making it safe to four
  hand steps nobody had done. -Rehearse does them after every check above has
  passed, and refuses before anything is put back when -Root is one of the
  server folders on this machine (C:\Thornswood-Server,
  C:\Thornswood-Server-Dev):
    ports    port and thornswoodVoicePort become free ones: the first game
             port from 7800 up whose UDP and TCP are free and whose resources
             port (port+1, what the server opens itself) is free on TCP, and
             the first free TCP port above that for voice. Never the live or
             dev ports, read from both server folders' settings and the
             backup's, nor 7777, 7778, 3000, 7787 or 7788. -Port and
             -VoicePort name them instead, checked the same way.
    door     private\door.json is deleted from the folder; the backup still
             holds it. Not moved: a moved copy of the site key is one more
             place a secret sits.
    pass     thornswoodRequirePass is set to false, said by name only: the
             join pass key is in door.json, so with the hold on nobody could
             stay connected. Start it only where its ports are not open to
             the internet.
    name     " (restore rehearsal)" goes on the end of name.
    record   rehearsal.json in the folder says when, from which backup, the
             ports, and what was taken out. Each -Rehearse is a whole new
             restore and writes it again.
  It prints REHEARSAL READY with the start line and the launcher settings.
  It never writes the Last rehearsed line of RESTORING.md in the ops repo: that waits for a
  person who started it and loaded a character.

  -Work is the folder the decrypted zip and the unpacked backup sit in while
  this runs. Left out, that is %TEMP%. Restore-Backup.ps1 is given the same
  folder, so the zip is not written to %TEMP% either. Both are deleted before
  this exits, including when the run is refused: the unpacked backup holds
  the bot token and the site keys.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [Parameter(Mandatory = $true)][string]$Root,
  [ValidateSet('live', 'dev')][string]$Which = 'live',
  [string]$KeyFile,
  [string]$Expect,
  # Where the decrypted zip and the unpacked backup sit. Left out, %TEMP%.
  [string]$Work,
  # Make the restored folder safe to start and connect to (#1046, see above).
  [switch]$Rehearse,
  # With -Rehearse: the game port and the voice port. Left out, free ones.
  [int]$Port = 0,
  [int]$VoicePort = 0,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# $work below is the unpacked backup. PowerShell does not distinguish it from
# -Work, so copy the folder off under another name before that assignment.
if ($Work) { $WorkRoot = $Work } else { $WorkRoot = $env:TEMP }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
$work = $null
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  # The unpacked backup holds the bot token and the site keys. Never left behind.
  if ($script:work -and (Test-Path -LiteralPath $script:work)) { Remove-Item -LiteralPath $script:work -Recurse -Force -EA SilentlyContinue }
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
# The characters in a world: one entry per living one, with its profile id and
# slot file. $script:deleted counts the slots a deleted character left behind.
$deleted = 0
function People([string]$worldDir) {
  $script:deleted = 0
  $forms = Join-Path $worldDir 'changeForms'
  if (-not (Test-Path -LiteralPath $forms)) { return @() }
  $out = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $forms -File -Filter *.json -EA SilentlyContinue |
                   Where-Object { $_.BaseName -cmatch '^[0-9a-f]{1,16}$' } | Sort-Object { [Convert]::ToInt64($_.BaseName, 16) })) {
    $o = $null
    try { $o = [IO.File]::ReadAllText($f.FullName) -replace '^\uFEFF', '' | ConvertFrom-Json } catch { $o = $null }
    $id = 0L
    if ($o -and $null -ne $o.profileId) { try { $id = [long]$o.profileId } catch { $id = 0L } }
    # A deleted character keeps its slot (profileId -1, isDeleted true); a
    # runtime NPC's form has a profileId below 0 too and is no slot at all.
    if ($o -and $o.isDeleted -eq $true) { $script:deleted++; continue }
    if ($id -le 0) { continue }
    $out += [pscustomobject]@{ Id = $id; File = $f }
  }
  return $out
}

# ------------------------------------------------- the rehearsal (#1046) ---
# The server folders on a box, which -Rehearse never touches and whose ports
# a rehearsal never takes.
$ServerRoots = @('C:\Thornswood-Server', 'C:\Thornswood-Server-Dev')
# '' or why -Root may not be rehearsed in.
function Get-RehearsalRootRefusal([string]$root, [string[]]$serverRoots) {
  $r = ([string]$root).TrimEnd('\', '/')
  foreach ($sr in $serverRoots) {
    if ([string]::Equals($r, ([string]$sr).TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase)) {
      return ("$root is a server folder people play on. A rehearsal is started and connected to, and changes its ports, name, join pass hold and door, " +
              "so it only goes into a throwaway folder: Install-ThornswoodServer.ps1 -Zip <payload> -Root <throwaway> -NoTask, then -Rehearse into that.")
    }
  }
  return ''
}
# The resources port the server opens beside its game port, as
# Install-ThornswoodServer.ps1 and Swap.ps1 work it out.
function Get-ResourcesPort([int]$gamePort) { if ($gamePort -eq 7777) { return 3000 } return ($gamePort + 1) }
# Every port a rehearsal must not take: the fixed live and dev ones, and each
# settings object's game, resources and voice ports.
function Get-ReservedPorts([object[]]$settingsList) {
  $out = New-Object 'System.Collections.Generic.List[int]'
  foreach ($n in 7777, 7778, 3000, 7787, 7788) { if (-not $out.Contains($n)) { $out.Add($n) } }
  foreach ($st in @($settingsList)) {
    if ($null -eq $st) { continue }
    $gp = 0; $vp = 0
    if ($st.PSObject.Properties.Name -contains 'port') { try { $gp = [int]$st.port } catch { $gp = 0 } }
    if ($st.PSObject.Properties.Name -contains 'thornswoodVoicePort') { try { $vp = [int]$st.thornswoodVoicePort } catch { $vp = 0 } }
    foreach ($n in @($(if ($gp -gt 0) { $gp; (Get-ResourcesPort $gp) }) + @($(if ($vp -gt 0) { $vp })))) {
      if (-not $out.Contains([int]$n)) { $out.Add([int]$n) }
    }
  }
  return $out.ToArray()
}
# What is listening on this machine now: Udp and Tcp, each a list of ports.
function Get-PortsInUse {
  $ip = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties()
  return [pscustomobject]@{
    Udp = @($ip.GetActiveUdpListeners() | ForEach-Object { [int]$_.Port })
    Tcp = @($ip.GetActiveTcpListeners() | ForEach-Object { [int]$_.Port })
  }
}
# Why a game port will not do for a rehearsal, or ''.
function Get-GamePortRefusal([int]$p, [int[]]$reserved, $inUse) {
  if ($p -lt 1024 -or $p -gt 65534) { return "$p is not a port a rehearsal can use (1024 to 65534)" }
  $rp = Get-ResourcesPort $p
  if (@($reserved) -contains $p) { return "$p is a live or dev server's port" }
  if (@($reserved) -contains $rp) { return "$p's resources port $rp is a live or dev server's port" }
  if (@($inUse.Udp) -contains $p -or @($inUse.Tcp) -contains $p) { return "$p is already in use on this machine" }
  if (@($inUse.Tcp) -contains $rp) { return "$p's resources port $rp is already in use on this machine" }
  return ''
}
# Why a voice port will not do beside game port $p, or ''.
function Get-VoicePortRefusal([int]$v, [int]$p, [int[]]$reserved, $inUse) {
  if ($v -lt 1024 -or $v -gt 65535) { return "$v is not a port a rehearsal can use (1024 to 65535)" }
  if ($v -eq $p -or $v -eq (Get-ResourcesPort $p)) { return "voice port $v is the game port or its resources port" }
  if (@($reserved) -contains $v) { return "voice port $v is a live or dev server's port" }
  if (@($inUse.Tcp) -contains $v) { return "voice port $v is already in use on this machine" }
  return ''
}
# The game and voice ports for a rehearsal: Port, Resources, VoicePort and Why
# ('' when both are good). $want and $wantVoice are -Port and -VoicePort, 0
# for the first free ones from 7800 up.
function Get-RehearsalPorts([int]$want, [int]$wantVoice, [int[]]$reserved, $inUse) {
  $p = 0
  if ($want) {
    $why = Get-GamePortRefusal $want $reserved $inUse
    if ($why) { return [pscustomobject]@{ Port = $want; Resources = 0; VoicePort = $wantVoice; Why = "-Port: $why." } }
    $p = $want
  } else {
    for ($c = 7800; $c -le 7998; $c++) { if (-not (Get-GamePortRefusal $c $reserved $inUse)) { $p = $c; break } }
    if (-not $p) { return [pscustomobject]@{ Port = 0; Resources = 0; VoicePort = 0; Why = 'No free game port from 7800 to 7998. Name one with -Port.' } }
  }
  $v = 0
  if ($wantVoice) {
    $why = Get-VoicePortRefusal $wantVoice $p $reserved $inUse
    if ($why) { return [pscustomobject]@{ Port = $p; Resources = (Get-ResourcesPort $p); VoicePort = $wantVoice; Why = "-VoicePort: $why." } }
    $v = $wantVoice
  } else {
    for ($c = $p + 2; $c -le $p + 200; $c++) { if (-not (Get-VoicePortRefusal $c $p $reserved $inUse)) { $v = $c; break } }
    if (-not $v) { return [pscustomobject]@{ Port = $p; Resources = (Get-ResourcesPort $p); VoicePort = 0; Why = "No free voice port above $p. Name one with -VoicePort." } }
  }
  return [pscustomobject]@{ Port = $p; Resources = (Get-ResourcesPort $p); VoicePort = $v; Why = '' }
}

if (-not $Rehearse -and ($Port -or $VoicePort)) {
  Die '-Port and -VoicePort go with -Rehearse. A real restore keeps the ports the backup says.'
}
if (-not (Test-Path -LiteralPath $Root)) {

  Die ("There is no server folder at $Root. Put the server program there first " +
       "(Install-ThornswoodServer.ps1 -Zip <payload> -Root $Root -NoTask), then restore into it.")
}
$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
$rootFwd = $Root -replace '\\', '/'
$tag = if ($Which -eq 'dev') { 'game-dev' } else { 'game' }
if ($Rehearse) {
  $rootWhy = Get-RehearsalRootRefusal $Root $ServerRoots
  if ($rootWhy) { Die ($rootWhy + ' Nothing was put back.') }
}

Write-Host ''
Write-Host '  THORNSWOOD  -  put a backup back into a server folder' -ForegroundColor White
Say "  backup  $Backup" 'DarkGray'
Say "  into    $Root  ($Which, from $tag in the backup)" 'DarkGray'
if ($Rehearse) { Say '  as a rehearsal: free ports, no door, no join pass hold (#1046)' 'DarkGray' }

# ------------------------------------------------------------ not running ---
Head 'Is its server running'
$settingsPath = Join-Path $Root 'server-settings.json'
# node under this folder, or the cmd the server task wraps it in. Only those:
# the shell this was started from can name the folder too (an ssh command
# line does), and that is not a server.
$running = @()
try {
  $running = @(Get-CimInstance Win32_Process -EA SilentlyContinue |
               Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and
                              $_.CommandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                              ($_.Name -eq 'node.exe' -or $_.CommandLine -match 'skymp5-server') })
} catch { $running = @() }
if ($running.Count) {
  Die ("The server in this folder is running (pid {0}, {1}). Stop it first: it writes world while it runs." -f
       $running[0].ProcessId, $running[0].Name)
}
# node started by hand with a relative path does not name the folder on its
# command line. Whoever holds the game port does, or its parent does. A port
# held by some OTHER server (a throwaway folder whose settings still say 7777
# while live runs) is not this one running, and is only said.
$heldPort = 0
if (Test-Path -LiteralPath $settingsPath) {
  try { $heldPort = [int]((Get-Content -LiteralPath $settingsPath -Raw) -replace '^\uFEFF', '' | ConvertFrom-Json).port } catch { $heldPort = 0 }
}
if ($heldPort -and (Get-Command Get-NetUDPEndpoint -EA SilentlyContinue)) {
  foreach ($ep in @(Get-NetUDPEndpoint -LocalPort $heldPort -EA SilentlyContinue)) {
    $p = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$ep.OwningProcess) -EA SilentlyContinue
    $up = $null
    if ($p) { $up = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$p.ParentProcessId) -EA SilentlyContinue }
    $lines = @($p, $up) | Where-Object { $_ -and $_.CommandLine } | ForEach-Object { $_.CommandLine }
    if (@($lines | Where-Object { $_.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count) {
      Die "UDP $heldPort is held by this folder's server (pid $($ep.OwningProcess)). Stop it first: it writes world while it runs."
    }
    Say "  UDP $heldPort is held by another server (pid $($ep.OwningProcess)); give this folder its own port before starting it" 'Yellow'
  }
}
Say '  nothing is running from it' 'Green'

# ---------------------------------------------------------------- unpack ---
Head 'Opening the backup'
if (-not $WorkRoot) { Die 'No folder for the unpacked backup: -Work was not passed and %TEMP% is not set.' }
try { [void][IO.Directory]::CreateDirectory($WorkRoot) }
catch { Die ("-Work is not a folder: " + $WorkRoot + " (" + $_.Exception.Message + ")") }
try {
$work = Join-Path $WorkRoot ('thornswood-restore-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$open = @{ Backup = $Backup; To = $work; NoPause = $true; Work = $WorkRoot }
if ($KeyFile) { $open['KeyFile'] = $KeyFile }
$global:LASTEXITCODE = 0
& (Join-Path $Here 'Restore-Backup.ps1') @open
if ($LASTEXITCODE -ne 0) { Die 'The backup did not open, so nothing was put back. The lines above say why.' }

$src = Join-Path $work $tag
$srcWorld = Join-Path $src 'world'
if (-not (Test-Path -LiteralPath $srcWorld)) {
  Die "This backup has no $tag\world. Backups from before issue #401 carry no dev server; use -Which live or a newer one."
}
$had = @(People $srcWorld)
if (-not $had.Count) { Die "The backup's $tag\world holds no characters. Use an older backup: that is what the weeklies are for." }
Say ("  {0} character(s) in the backup's {1}\world" -f $had.Count, $tag) 'Green'

# --------------------------------------------------------------- put back ---
Head 'Putting it back'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$aside = Join-Path $Root ('world-before-restore-' + $stamp)
foreach ($n in 'world', 'private') {
  $d = Join-Path $Root $n
  if ((Test-Path -LiteralPath $d) -and @(Get-ChildItem -LiteralPath $d -Force -EA SilentlyContinue).Count) {
    [void](New-Item -ItemType Directory -Path $aside -Force)
    Move-Item -LiteralPath $d -Destination (Join-Path $aside $n)
    Say "  the $n that was here is kept at $aside\$n" 'Yellow'
  } elseif (Test-Path -LiteralPath $d) {
    Remove-Item -LiteralPath $d -Recurse -Force
  }
}
Copy-Item -LiteralPath $srcWorld -Destination (Join-Path $Root 'world') -Recurse -Force
Say ("  world      {0} file(s)" -f @(Get-ChildItem -LiteralPath (Join-Path $Root 'world') -Recurse -File).Count)

$srcPriv = Join-Path $src 'private'
if (Test-Path -LiteralPath $srcPriv) {
  Copy-Item -LiteralPath $srcPriv -Destination (Join-Path $Root 'private') -Recurse -Force
  $names = @(Get-ChildItem -LiteralPath (Join-Path $Root 'private') -File | ForEach-Object { $_.Name })
  Say ("  private    {0}" -f ($names -join ', '))
} else {
  [void](New-Item -ItemType Directory -Path (Join-Path $Root 'private') -Force)
  Say '  private    NOT IN THE BACKUP. The door and the character cards start empty.' 'Yellow'
}

$srcData = Join-Path $src 'data'
if (Test-Path -LiteralPath $srcData) {
  $kept = 0
  # Each file's path under data, cut off the very string it was listed from.
  # This used to cut Get-ChildItem's FullName by the length of Resolve-Path's
  # answer, and the two disagree when TEMP is a short 8.3 path (C:\Users\
  # ADMINI~1\...), which it is for Administrator on the box: Resolve-Path
  # kept the short form, FullName gave the long one, and data\keep.txt came
  # back as data\game\data\keep.txt. Seen on the build runner, issue #1120.
  foreach ($path in @([IO.Directory]::EnumerateFiles($srcData, '*', [IO.SearchOption]::AllDirectories))) {
    $to = Join-Path (Join-Path $Root 'data') $path.Substring($srcData.Length).TrimStart('\')
    if (Test-Path -LiteralPath $to) { continue }
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force)
    Copy-Item -LiteralPath $path -Destination $to
    $kept++
  }
  Say "  data       $kept file(s) the folder did not already have"
}
foreach ($n in 'server-settings.json', 'gamemode.js') {
  $from = Join-Path $src $n
  if (-not (Test-Path -LiteralPath (Join-Path $Root $n)) -and (Test-Path -LiteralPath $from)) {
    Copy-Item -LiteralPath $from -Destination (Join-Path $Root $n)
    Say "  $n from the backup, because the folder had none" 'Yellow'
  }
}
# The tables gamemode.js reads as it loads (#5191), whole, on the same rule:
# a folder that has them keeps its own, which go with its own gamemode.js.
$srcTables = Join-Path $src 'gamemode-tables'
if (-not (Test-Path -LiteralPath (Join-Path $Root 'gamemode-tables')) -and (Test-Path -LiteralPath $srcTables)) {
  Copy-Item -LiteralPath $srcTables -Destination (Join-Path $Root 'gamemode-tables') -Recurse
  Say "  gamemode-tables from the backup, because the folder had none" 'Yellow'
}

# ------------------------------------------------------------ load order ---
Head 'Does the load order resolve'
if (-not (Test-Path -LiteralPath $settingsPath)) { Die "There is no server-settings.json in $Root or in the backup." }
$bytes = [IO.File]::ReadAllBytes($settingsPath)
$bom = $false
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  $bytes = [byte[]]($bytes[3..($bytes.Length - 1)])
  $bom = $true
  Say '  took a byte order mark off server-settings.json, node cannot parse one' 'Yellow'
}
$utf8 = New-Object Text.UTF8Encoding($false)
$s = $utf8.GetString($bytes) | ConvertFrom-Json
if (-not $s.loadOrder) { Die 'server-settings.json has no loadOrder.' }

# Which server this is comes from the backup, not from whichever channel's
# payload was unpacked here (see the note at the top). So do the join pass
# switch and the written role lists (#1845), which are said by name only.
$named = 0
$backupSettings = $null
$byNameOnly = @('thornswoodRequirePass', 'thornswoodDevs', 'thornswoodPlaytesters')
$srcSettings = Join-Path $src 'server-settings.json'
if (Test-Path -LiteralPath $srcSettings) {
  $b = $null
  try { $b = [IO.File]::ReadAllText($srcSettings) -replace '^\uFEFF', '' | ConvertFrom-Json } catch { $b = $null }
  $backupSettings = $b
  if ($b) {
    foreach ($k in @('port', 'name', 'thornswoodVoicePort', 'thornswoodServer', 'thornswoodLoadOrderRefuse') + $byNameOnly) {
      $has = $s.PSObject.Properties.Name -contains $k
      $want = $b.PSObject.Properties.Name -contains $k
      $quiet = $byNameOnly -contains $k
      if ($want) {
        if (-not $has) {
          if ($quiet) { Say "  $k from the backup, the folder had none" 'Yellow' }
          else { Say ("  {0}: {1} from the backup, the folder had none" -f $k, (ConvertTo-Json $b.$k -Compress)) 'Yellow' }
          $s | Add-Member -NotePropertyName $k -NotePropertyValue $b.$k; $named++
        }
        elseif ((ConvertTo-Json $s.$k -Compress) -ne (ConvertTo-Json $b.$k -Compress)) {
          if ($quiet) { Say "  $k from the backup, the folder's was different" 'Yellow' }
          else { Say ("  {0}: {1} from the backup, was {2}" -f $k, (ConvertTo-Json $b.$k -Compress), (ConvertTo-Json $s.$k -Compress)) 'Yellow' }
          $s.$k = $b.$k; $named++
        }
      } elseif ($has) {
        Say "  $k taken off: the backup's settings do not have it" 'Yellow'
        $s.PSObject.Properties.Remove($k); $named++
      }
    }
  }
}

$order = @()
$moved = 0
foreach ($p in @($s.loadOrder)) {
  $fwd = ([string]$p) -replace '\\', '/'
  $i = $fwd.ToLowerInvariant().LastIndexOf('/plugins/')
  if ($i -gt 0 -and -not [string]::Equals($fwd.Substring(0, $i), $rootFwd, [StringComparison]::OrdinalIgnoreCase)) {
    $fwd = $rootFwd + $fwd.Substring($i)
    $moved++
  }
  $order += $fwd
}
if ($moved -or $named) {
  $s.loadOrder = $order
  [IO.File]::WriteAllText($settingsPath, ($s | ConvertTo-Json -Depth 20), $utf8)
  if ($moved) { Say "  $moved plugin path(s) named another server's folder; pointed at $rootFwd" 'Yellow' }
} elseif ($bom) {
  [IO.File]::WriteAllBytes($settingsPath, $bytes)
}
$bad = @($order | Where-Object { -not (Test-Path -LiteralPath ($_ -replace '/', '\')) })
if ($bad.Count) {
  Write-Host ''
  Write-Host ("{0} plugin(s) in the load order are not on disk:" -f $bad.Count) -ForegroundColor Red
  foreach ($b in $bad) { Write-Host "    $b" -ForegroundColor Red }
  Die ('load order does not resolve. The world is back, but this server would refuse to start. ' +
       'Put the server program and plugins here with Install-ThornswoodServer.ps1, then run this again.')
}
Say ("  load order: all {0} plugins present" -f $order.Count) 'Green'

# ------------------------------------------------------------ characters ---
Head 'Are the characters there'
$now = @(People (Join-Path $Root 'world'))
if (-not $now.Count) { Die 'world\changeForms holds no characters after the restore.' }
Say ("  {0} character(s), profile ids {1}{2}" -f $now.Count, (($now | Select-Object -First 5 | ForEach-Object { $_.Id }) -join ', '),
     $(if ($now.Count -gt 5) { ', ...' } else { '' })) 'Green'
if ($deleted) { Say "  and $deleted slot(s) a deleted character left behind, not counted" 'DarkGray' }
if ($Expect) {
  $hit = @($now | Where-Object { [string]$_.Id -eq $Expect.Trim() })
  if (-not $hit.Count) {
    Die "Character $Expect is not in the restored world (no living character has that profile id)."
  }
  Say ("  character {0} is there, in {1}" -f $Expect, $hit[0].File.Name) 'Green'
}
$book = Join-Path $Root 'private\characters.json'
if (Test-Path -LiteralPath $book) {
  try {
    $who = (Get-Content -LiteralPath $book -Raw -Encoding UTF8 | ConvertFrom-Json).who
    $cards = @($who.PSObject.Properties).Count
    Say "  characters.json names $cards on the launcher's cards" 'DarkGray'
  } catch { Say '  characters.json is there but does not parse' 'Yellow' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'dist_back\skymp5-server.js'))) {
  Say '  there is no dist_back\skymp5-server.js here, so this folder has the world but not the server program yet' 'Yellow'
}

# ------------------------------------------------- a rehearsal (#1046) ---
$rh = $null
if ($Rehearse) {
  Head 'Making it a rehearsal'
  $others = @()
  foreach ($sr in $ServerRoots) {
    # A server folder this account may not look into (the runner's account
    # on the VPS cannot read the live one) still has its usual ports kept
    # off by Get-ReservedPorts, and a running server's ports are refused as
    # in use; what it cannot see is a port someone changed, so it says so.
    $sp = Join-Path $sr 'server-settings.json'
    $there = $false
    try { $there = Test-Path -LiteralPath $sp -EA Stop } catch {
      Say ("  {0} could not be read ({1}); only the usual live and dev ports are kept off for it" -f $sp, $_.Exception.Message) 'Yellow'
      continue
    }
    if ($there) {
      try { $others += ([IO.File]::ReadAllText($sp) -replace '^\uFEFF', '' | ConvertFrom-Json) } catch {
        Say ("  {0} could not be read ({1}); only the usual live and dev ports are kept off for it" -f $sp, $_.Exception.Message) 'Yellow'
      }
    }
  }
  $reserved = Get-ReservedPorts (@($backupSettings) + $others)
  $rh = Get-RehearsalPorts $Port $VoicePort $reserved (Get-PortsInUse)
  if ($rh.Why) { Die ($rh.Why + ' The world is back; the folder is not a rehearsal yet and must not be started.') }
  $rs = [IO.File]::ReadAllText($settingsPath) -replace '^\uFEFF', '' | ConvertFrom-Json
  $was = [string]$rs.port
  $rs.port = $rh.Port
  if ($rs.PSObject.Properties.Name -contains 'thornswoodVoicePort') { $wasVoice = [string]$rs.thornswoodVoicePort; $rs.thornswoodVoicePort = $rh.VoicePort }
  else { $wasVoice = 'none'; $rs | Add-Member -NotePropertyName thornswoodVoicePort -NotePropertyValue $rh.VoicePort }
  Say ("  port       {0}, was {1}; resources {2} (the server opens port+1 itself)" -f $rh.Port, $was, $rh.Resources) 'Green'
  Say ("  voice      {0}, was {1}" -f $rh.VoicePort, $wasVoice) 'Green'
  $suffix = ' (restore rehearsal)'
  $nm = [string]$rs.name
  if (-not $nm.EndsWith($suffix)) { $rs.name = $nm + $suffix }
  Say ("  name       {0}" -f $rs.name) 'Green'
  if ($rs.PSObject.Properties.Name -contains 'thornswoodRequirePass') { $rs.thornswoodRequirePass = $false }
  else { $rs | Add-Member -NotePropertyName thornswoodRequirePass -NotePropertyValue $false }
  Say '  thornswoodRequirePass off: the join pass key left with door.json. Start it only where these ports are not open to the internet.' 'Yellow'
  [IO.File]::WriteAllText($settingsPath, ($rs | ConvertTo-Json -Depth 20), $utf8)
  $door = Join-Path $Root 'private\door.json'
  $removed = @()
  if (Test-Path -LiteralPath $door) {
    Remove-Item -LiteralPath $door -Force
    $removed += 'private\door.json'
    Say '  door       private\door.json deleted from this folder; the backup still holds it' 'Green'
  } else {
    Say '  door       there was no private\door.json' 'DarkGray'
  }
  $record = [ordered]@{
    at = (Get-Date).ToString('o'); backup = (Split-Path -Leaf $Backup); which = $Which
    port = $rh.Port; resources = $rh.Resources; voicePort = $rh.VoicePort
    removed = $removed; requirePass = $false; issue = 1046
  }
  [IO.File]::WriteAllText((Join-Path $Root 'rehearsal.json'), ($record | ConvertTo-Json -Depth 5), $utf8)
  Say '  record     rehearsal.json' 'DarkGray'
}

Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
Write-Host ''
Say ("RESTORE OK: {0} character(s), all {1} plugins on disk, in {2}" -f $now.Count, $order.Count, $Root) 'Green'
if ($rh) {
  Say ("REHEARSAL READY: game port {0}, voice {1}, no door, no join pass hold, in {2}" -f $rh.Port, $rh.VoicePort, $Root) 'Green'
  Say ("  Start it by hand:   cd '{0}'; node dist_back/skymp5-server.js" -f $Root) 'DarkGray'
  Say ('  Point a launcher at it: in that launcher''s config.json, ServerAddress this machine (127.0.0.1 on it), ServerPort "{0}"' -f $rh.Port) 'DarkGray'
  Say '  and load a character from the backup while thornswood.log says it connected.' 'DarkGray'
  Say ('  Or have a bot load it (#5196), once node is up: node scripts/bot/Check-Character.js --root "{0}" --profile <id>' -f $Root) 'DarkGray'
  Say ("  End it: stop node, then Remove-Item -LiteralPath '{0}' -Recurse -Force. RESTORING.md in the ops repo has the rest." -f $Root) 'DarkGray'
} else {
  Say '  Start it with its scheduled task, Start-ScheduledTask -TaskName <its task>, which runs node High (#2491); node started by hand runs Normal and outside the task' 'DarkGray'
  Say '  and watch thornswood.log until a character connects. RESTORING.md in the ops repo has the rest.' 'DarkGray'
}
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0

} finally {
  if ($script:work -and (Test-Path -LiteralPath $script:work)) {
    Remove-Item -LiteralPath $script:work -Recurse -Force -EA SilentlyContinue
  }
}
