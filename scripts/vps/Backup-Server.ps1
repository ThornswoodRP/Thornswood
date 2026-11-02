<#
  Backup-Server.ps1

  Pulls everything off the server that could not be rebuilt from the repo, and
  puts it on this machine as a dated zip encrypted with the backup passphrase,
  thornswood-backup-<yyyyMMdd-HHmm>.zip.enc: in local\backups in the
  repository (Where.ps1 Backups), or the folder -Out names.

      .\scripts\vps\Backup-Server.ps1

  Run this before any move to a different box, before any plan change, and
  every so often anyway.

  What it takes:
    the website's data folder   linked Discord accounts, the boards, the
                                documents people have typed into, the public
                                pages
    the bot folder              whole: its config, bot.log and joins.json
    the voice server folder     whole: its config, voice.log and the chat\
                                day files, every line typed in the game
    the game server             server-settings.json, gamemode.js and the
                                gamemode-tables it reads (#5191), and the
                                data, world and private folders next to it.
                                world is the characters: every person who plays
                                here is a change form in that folder and nowhere
                                else. private is the door list, who is allowed
                                in, and the door log.

                                world and private were both missing until 18
                                September. The two backups that existed were
                                taken sixteen minutes apart on 15 September and
                                neither one had a single character in it.
    the web server config       whatever is answering on 443 for thornswood.net
    the three scheduled tasks   exported as xml, so they can be imported whole
                                on a new box instead of rebuilt by hand
    a notes file                windows version, node and python versions, the
                                firewall rules for the game and site ports, and
                                the disk layout

  What it leaves:
    node_modules, and anything over 200 MB. The installer under the website's
    public folder is the big one, and it is already on GitHub and rebuildable
    from the repo. Taking it would turn a two minute backup into a long one.

  The zip has the bot token, the Discord client secret and the server password
  in it, because a backup without them is not a backup, and the site's
  sign-ins with their addresses, voice chat and every character besides.

  ENCRYPTED ON THE BOX, AND KEPT 30 DAYS (#3582). The zip is encrypted on the
  box before it comes down, with the nightly backup's passphrase
  (C:\Thornswood-Backup\key.txt) and in the nightly's own format
  (Protect-BackupZip.ps1), so Restore-Backup.ps1 opens it like any nightly and
  no plain copy ever reaches this machine. With no passphrase on the box it
  stops and brings nothing down. Fetch-Backups.ps1 deletes one here 30 days
  after it was taken (its -KeepDays), on its daily run, so it is kept no
  longer than site/data/site/privacy.md says a copy on the operator's computer
  is. Until 26 Oct 2026 this brought down a plain zip that nothing ever
  deleted, and Fetch-Backups.ps1's prune matched only the nightly's names.

  Reads only, on the server side. The one thing it writes there is the copy
  it zips, the zip and the encrypted zip, in a folder of the run's own under C:\Windows\Temp
  that lives as long as one ssh session (scripts\mods\OnBox.ps1, the same
  folder Run-OnBox.ps1 uses): the session's keeper makes it, and removes it
  when this says the run is over or the session drops. A keeper killed with
  its session cannot remove anything, but the folder is then held by nobody,
  and the next run of either script removes it before it makes its own.

  Until 21 Oct 2026 (#3035) the copy and the zip were made by one ssh call,
  brought down by scp, and removed by a third call, which a run cut short
  never reached, and a zip scp could not bring down was left on the box on
  purpose. That left a copy of everybody's characters and the bot's data
  outside the places the privacy page names, for as long as nobody noticed.
  A run that cannot bring the zip down now says so, and the zip goes with
  the folder: run it again.
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Out,
  [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Send-Script.ps1')
. (Join-Path $Here '..\mods\OnBox.ps1')
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

# The repository's local\backups since 5 October, asked of Where.ps1, not
# Downloads\Thornswood-Backups: Patrick's rule that Thornswood work on One
# lives only in the repository and the vault.
# A worktree's local folder goes when the worktree is removed, and this zip is
# the only copy (the one on the VPS goes with its run's folder), so a
# worktree is refused rather than written into.
if (-not $Out) {
  $where = Join-Path $Here '..\release\Where.ps1'
  $Out = [string](& $where Backups)
  $repoDir = [string](& $where Repo)
  if (Test-Path -LiteralPath (Join-Path $repoDir '.git') -PathType Leaf) {
    Die "$repoDir is a git worktree, and its local folder goes when the worktree is removed. Run this from the repository folder itself, or pass -Out <folder>."
  }
}
if (-not (Test-Path -LiteralPath $Out)) { [void](New-Item -ItemType Directory -Path $Out -Force) }

$stamp = (Get-Date).ToString('yyyyMMdd-HHmm')
$name  = "thornswood-backup-$stamp.zip"
$localZip  = Join-Path $Out ($name + '.enc')
$protect = [IO.File]::ReadAllText((Join-Path $Here 'Protect-BackupZip.ps1'))

Write-Host ''
Write-Host '  THORNSWOOD  -  back up the server' -ForegroundColor White
Say "  from  $Vps" 'DarkGray'
Say "  to    $localZip" 'DarkGray'

# ---------------------------------------------------------- gather it up ---
Head 'Gathering'

$gather = @"
`$ErrorActionPreference = 'Continue'
`$stage = Join-Path `$run 'stage'
`$null = New-Item -ItemType Directory -Path `$stage -Force

function Grab(`$from, `$asName) {
  if (-not (Test-Path `$from)) { 'missing   ' + `$from; return }
  `$to = Join-Path `$stage `$asName
  `$null = New-Item -ItemType Directory -Path (Split-Path -Parent `$to) -Force -EA SilentlyContinue
  if ((Get-Item `$from).PSIsContainer) {
    `$null = New-Item -ItemType Directory -Path `$to -Force -EA SilentlyContinue
    `$n = 0
    # Listed from the long path. `$from may be a short 8.3 path, and
    # FullName is not (issue #1156).
    `$listed = (Get-Item -LiteralPath `$from).FullName
    foreach (`$f in (Get-ChildItem -LiteralPath `$listed -Recurse -File -EA SilentlyContinue)) {
      if (`$f.FullName -like '*\node_modules\*') { continue }
      if (`$f.Length -gt 200MB) { continue }
      `$rel = `$f.FullName.Substring(`$listed.Length).TrimStart('\')
      `$dest = Join-Path `$to `$rel
      `$null = New-Item -ItemType Directory -Path (Split-Path -Parent `$dest) -Force -EA SilentlyContinue
      Copy-Item `$f.FullName `$dest -Force -EA SilentlyContinue
      `$n = `$n + 1
    }
    'took      ' + `$asName + '   ' + `$n + ' file(s)'
  }
  else {
    Copy-Item `$from `$to -Force -EA SilentlyContinue
    'took      ' + `$asName
  }
}

Grab 'C:\Thornswood-Docs\data' 'site\data'
Grab 'C:\Thornswood-Docs\lib' 'site\lib'
foreach (`$f in @('server.js','package.json','package-lock.json','config.json')) {
  if (Test-Path ('C:\Thornswood-Docs\' + `$f)) { Grab ('C:\Thornswood-Docs\' + `$f) ('site\' + `$f) }
}
Grab 'C:\Thornswood-Bot' 'bot'
Grab 'C:\Thornswood-Voice' 'voice'

# The game server moves around between builds, so it gets found rather than
# assumed. Anything with a server-settings.json beside it counts.
`$found = @()
foreach (`$d in (Get-ChildItem 'C:\' -Directory -EA SilentlyContinue)) {
  foreach (`$hit in (Get-ChildItem `$d.FullName -Recurse -Filter 'server-settings.json' -Depth 4 -File -EA SilentlyContinue)) {
    `$found += `$hit.DirectoryName
  }
}
`$found = `$found | Select-Object -Unique
if (`$found.Count -eq 0) { 'missing   the game server (no server-settings.json anywhere under C:\)' }
`$i = 0
foreach (`$root in `$found) {
  `$i = `$i + 1
  `$tag = if (`$i -eq 1) { 'game' } else { 'game-' + `$i }
  'game at   ' + `$root
  Grab (Join-Path `$root 'server-settings.json') (`$tag + '\server-settings.json')
  if (Test-Path (Join-Path `$root 'gamemode.js')) { Grab (Join-Path `$root 'gamemode.js') (`$tag + '\gamemode.js') }
  if (Test-Path (Join-Path `$root 'gamemode-tables')) { Grab (Join-Path `$root 'gamemode-tables') (`$tag + '\gamemode-tables') }
  if (Test-Path (Join-Path `$root 'data')) { Grab (Join-Path `$root 'data') (`$tag + '\data') }
  # The characters. Every person who plays here is a change form in this
  # folder and nowhere else, and it was not in the backup: the 15 September
  # zip is 195 KB with 47 entries and nothing under world at all. It is
  # 1,423 files and about 2 MB, so there was never a size reason to skip it.
  if (Test-Path (Join-Path `$root 'world')) { Grab (Join-Path `$root 'world') (`$tag + '\world') }
  # The door list, who is allowed in, and the door log. Moved here out of
  # data so that the web server stops serving them, which means anything
  # that only took data stopped taking them too.
  if (Test-Path (Join-Path `$root 'private')) { Grab (Join-Path `$root 'private') (`$tag + '\private') }
}

# Whatever is terminating TLS for the site. Guessing at fixed folders missed
# it the first time this ran, so this asks the running process where it lives.
`$webNotes = @()
foreach (`$proc in (Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { `$_.Name -match '^(caddy|nginx|httpd)\.exe`$' })) {
  `$cmd = "`$(`$proc.CommandLine)"
  `$webNotes += (`$proc.Name + '   ' + `$cmd)
  `$exe = `$proc.ExecutablePath
  if (`$exe -and (Test-Path `$exe)) {
    `$dir = Split-Path -Parent `$exe
    foreach (`$f in (Get-ChildItem `$dir -File -EA SilentlyContinue | Where-Object { `$_.Name -match '^(Caddyfile|caddy\.json|nginx\.conf)`$' -or `$_.Extension -eq '.conf' })) {
      Grab `$f.FullName ('web\' + `$f.Name)
    }
  }
  # caddy run --config <path>, which is often nowhere near the exe.
  `$m = [regex]::Match(`$cmd, '--config\s+"?([^"\s]+)"?')
  if (`$m.Success -and (Test-Path `$m.Groups[1].Value)) {
    Grab `$m.Groups[1].Value ('web\' + (Split-Path -Leaf `$m.Groups[1].Value))
  }
}
foreach (`$c in @('C:\Caddy','C:\caddy','C:\Program Files\Caddy','C:\Thornswood-Web','C:\nginx','C:\Program Files\nginx')) {
  if (Test-Path `$c) {
    foreach (`$f in (Get-ChildItem `$c -Recurse -File -EA SilentlyContinue | Where-Object { `$_.Name -match '^(Caddyfile|caddy\.json|nginx\.conf)`$' })) {
      Grab `$f.FullName ('web\' + `$f.Name)
    }
  }
}
if (`$webNotes.Count -eq 0) { 'missing   nothing that looks like a web server is running' }

# The scheduled tasks, whole. Importing these beats rebuilding them by hand.
#
# ASKED FOR RATHER THAN REMEMBERED, 23 September. This used to list four names
# by hand and the box runs six: Setup-Domain registers Thornswood Web, which is
# Caddy and therefore the only thing anybody outside can reach, and
# Watch-Services registers Thornswood Watch, which is what restarts everything
# else. A rebuild from this backup would have come up with no web server and
# nothing watching, which is the pair you would least want to be missing at
# 2am.
#
# So it enumerates and filters on the prefix. A task added later is in the
# backup the night it is added, with nobody editing this file, and the count is
# printed so a box that has lost one says so here rather than on the day it is
# needed. The dev instances are named Thornswood Dev Server and Thornswood Dev
# Voice and match the same prefix, which is right: they are part of the box.
`$null = New-Item -ItemType Directory -Path (Join-Path `$stage 'tasks') -Force -EA SilentlyContinue
`$tasks = @()
try {
  `$tasks = @(Get-ScheduledTask -EA SilentlyContinue |
              Where-Object { `$_.TaskName -like 'Thornswood*' } |
              Select-Object -ExpandProperty TaskName | Sort-Object)
} catch { `$tasks = @() }
if (`$tasks.Count -eq 0) {
  'missing   no scheduled task whose name begins Thornswood, which cannot be right'
}
foreach (`$t in `$tasks) {
  `$xml = & schtasks /query /tn `$t /xml 2>`$null
  if (`$LASTEXITCODE -eq 0 -and `$xml) {
    `$safe = `$t.Replace(' ','-')
    [IO.File]::WriteAllText((Join-Path `$stage ('tasks\' + `$safe + '.xml')), (`$xml -join [Environment]::NewLine))
    'took      tasks\' + `$safe + '.xml'
  }
  else { 'no task   ' + `$t + ' (it is registered but schtasks would not export it)' }
}
'tasks     ' + `$tasks.Count + ' scheduled task(s) whose name begins Thornswood'

# What the box is, so the new one can be made to match.
`$notes = @()
`$notes += 'taken     ' + (Get-Date).ToString('u')
`$notes += 'windows   ' + (Get-CimInstance Win32_OperatingSystem).Caption
`$notes += 'cpu       ' + (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
`$notes += 'memory    ' + [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1) + ' GB'
foreach (`$d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
  `$notes += 'disk ' + `$d.DeviceID + '   ' + [math]::Round(`$d.Size / 1GB, 1) + ' GB, ' + [math]::Round(`$d.FreeSpace / 1GB, 1) + ' GB free'
}
foreach (`$exe in @('node','python','npm','git')) {
  `$v = & cmd /c (`$exe + ' --version') 2>`$null
  if (`$v) { `$notes += (`$exe.PadRight(10) + (`$v | Select-Object -First 1)) }
}
`$notes += ''
`$notes += 'firewall rules that let anything in:'
foreach (`$r in (Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -Action Allow -EA SilentlyContinue)) {
  `$p = `$r | Get-NetFirewallPortFilter -EA SilentlyContinue
  if (`$p -and `$p.LocalPort -and `$p.LocalPort -ne 'Any') {
    `$notes += '  ' + `$r.DisplayName + '   ' + `$p.Protocol + ' ' + (`$p.LocalPort -join ',')
  }
}
`$notes += ''
`$notes += 'web server, as it is actually running:'
if (`$webNotes.Count -eq 0) { `$notes += '  none found' }
foreach (`$w in `$webNotes) { `$notes += '  ' + `$w }
[IO.File]::WriteAllText((Join-Path `$stage 'notes.txt'), (`$notes -join [Environment]::NewLine))
'took      notes.txt'

# Encrypted here, before anything leaves the box (#3582): with no passphrase
# there is no 'zip' line, and the side that asked brings nothing down.
`$keyFile = 'C:\Thornswood-Backup\key.txt'
`$pass = ''
if (Test-Path -LiteralPath `$keyFile) { `$pass = ("`$(Get-Content -LiteralPath `$keyFile -Raw)").Trim() }
if (-not `$pass) { 'STOP the backup passphrase is not at ' + `$keyFile + ', or is empty, so nothing was zipped. Install-Backup.ps1 puts it there.'; return }
`$zip = Join-Path `$run '$name'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(`$stage, `$zip)
Protect-ThornswoodBackupZip -Zip `$zip -Enc (`$zip + '.enc') -Pass `$pass
'zip       ' + [math]::Round((Get-Item (`$zip + '.enc')).Length / 1MB, 1) + ' MB, encrypted'
"@

# The run's folder on the box, held by its keeper until the run is over, or
# until its session drops (OnBox.ps1). The gather above makes its files
# inside it, and holds it as well while it runs, so they go with it.
$box = Open-ThornswoodOnBoxFolder -Target "$User@$Vps" -SshArgs $ssh
function Shut {
  $shut = Close-ThornswoodOnBoxFolder $box
  if ($shut.Gone) { Say '  nothing of it is left on the server' 'DarkGray' }
  else {
    $then = $(if ($shut.Told) { 'The next run of this or Run-OnBox.ps1 removes it once nothing holds it.' } else { 'Its keeper could not be told to end, so it still holds it (#3063).' })
    Say ('  ' + $box.Run + ' is still on the server (' + $(if ($shut.Said.Count) { $shut.Said -join ' ' } else { 'its keeper''s session ended without a word' }) + '). ' + $then) 'Yellow'
  }
}
try {
  foreach ($l in $box.Said) { Say "  box  $l" 'DarkGray' }
  if (-not $box.Made) { Die ('The server could not make ' + $box.Run + ' for the run. What ssh said is above. Nothing has been brought down.') }
  $remoteZip = $box.Far + '/' + $name + '.enc'

  $lines = Remote ((Get-ThornswoodOnBoxHoldScript -Run $box.Run) + "`r`n" + $protect + "`r`n" + $gather)
  foreach ($l in $lines) {
    $c = 'Gray'
    if ("$l" -match '^missing') { $c = 'Yellow' }
    if ("$l" -match '^zip') { $c = 'Green' }
    if ("$l" -match '^STOP') { $c = 'Red' }
    Say "  $l" $c
  }
  if (-not ($lines | Where-Object { "$_" -match '^zip' })) {
    Die 'The server did not finish making the zip. Nothing has been brought down.'
  }

  # ---------------------------------------------------------- bring it down ---
  Head 'Bringing it down'
  Invoke-ThornswoodNative { & scp @ssh "${User}@${Vps}:$remoteZip" "$localZip" } 2>&1 | Out-Host
}
finally { Shut }
if (-not (Test-Path -LiteralPath $localZip)) { Die "scp did not leave a file at $localZip, and the zip on the server went with its run's folder. Run this again." }

$mb = [math]::Round((Get-Item -LiteralPath $localZip).Length / 1MB, 1)
Say "  $localZip   $mb MB" 'Green'

Head 'Keep this somewhere sensible'
Say '  It is encrypted with the backup passphrase. Restore-Backup.ps1 opens it.' 'DarkGray'
Say '  Fetch-Backups.ps1 deletes it here 30 days after it was taken, as the' 'DarkGray'
Say '  privacy page says of every copy on this machine.' 'DarkGray'

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
