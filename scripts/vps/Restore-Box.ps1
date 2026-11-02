<#
  Restore-Box.ps1

  Puts a nightly backup back onto a new VPS, run from this machine.

  All of it in one command: both game servers' worlds, the site, the bot and
  Caddy's file (issue #454). MOVING-THE-SERVER.md in the ops repo says when in a move to
  run it, and RESTORING.md in the ops repo "The box is gone" when there is nothing left
  to move from.

      .\scripts\vps\Restore-Box.ps1 -Backup <file>.zip.enc -Check    ready? sends nothing
      .\scripts\vps\Restore-Box.ps1 -Backup <file>.zip.enc
      .\scripts\vps\Restore-Box.ps1 -Backup <file>.zip.enc -Expect 1234567

  The box has no repository, so this carries what it needs across and takes
  it away again:

    1. Here: Restore-Backup.ps1 -CheckOnly, with this machine's passphrase
       (Documents\thornswood-backup-key.txt). A backup that does not open,
       or holds no characters, stops it before anything is sent.
    2. On the box, asked, not changed: the live and dev server folders hold
       the server program (Install-ThornswoodServer.ps1, vps-dev-instance.ps1)
       and nothing that writes what this puts back is running (the watchdog,
       both game servers, the site, the bot). -Check stops here.
    3. Sends the backup, the passphrase file and three scripts into
       C:\Thornswood-Restore: Restore-Backup.ps1, Restore-Server.ps1 and
       vps-restore-services.ps1. The passphrase also goes to
       C:\Thornswood-Backup\key.txt when the box has none there, so the
       nightly backups the new box takes open with the same file as every
       one before them.
    4. Restore-Server.ps1 into C:\Thornswood-Server, then -Which dev into
       C:\Thornswood-Server-Dev (-NoDev leaves dev out).
    5. Restore-Backup.ps1 unpacks it there, and vps-restore-services.ps1 puts
       the site's data, config, uploads and feed store, the bot's settings and
       join record and the Caddyfile back.
    6. Delete-Person.ps1 -Reapply removes again everybody who asked to be
       deleted (#2351): the people in the box's own record of completed
       requests, C:\Thornswood-Deletions\requests.jsonl, and in the one the
       backup carries, merged into it first. A backup holds the people who
       asked after it was taken; nothing may start before they are gone.
    7. Deletes C:\Thornswood-Restore, whatever happened above: it holds the
       bot token and the site keys.

  Starts nothing. Deploy-Docs.ps1, Install-Bot.ps1 -NoToken and starting the
  game servers come after it, in the order MOVING-THE-SERVER.md in the ops repo gives.

  Prints RESTORE BOX OK and exits 0 only when all three restores and the
  reapply said OK.
  Nothing secret is printed or put on a command line: the passphrase goes
  across as a file, and what the box says back is what the three scripts
  print, which never includes a value out of a config.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [string]$VpsHost = '',
  [string]$VpsUser = '',
  [string]$KeyFile = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Documents\thornswood-backup-key.txt'),
  # A live profile id that must come back, the number the launcher and the
  # site show. Passed to the live restore only.
  [string]$Expect,
  [switch]$NoDev,
  [switch]$Check,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Send-Script.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
function Remote($script) {
  # Send-Script.ps1 (issue #1166, the same way as #1070): a long script goes
  # by scp and its run takes it off the box before it runs, and the far
  # side's exit code comes back. Lines come back as strings, so a later -contains still matches.
  $out = @(Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script | ForEach-Object { "$_" })
  return $out
}
# A script on the box, run from its own file, the way Publish-Server.ps1 runs
# the installer: every argument here is a path under C:\Thornswood-Restore or
# a number, none with a space or a quote in it. Its lines are shown as they
# come, and its exit code is the answer.
function OnBox([string]$file, [string]$argLine) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Invoke-ThornswoodNative { & ssh @ssh $target "pwsh -NoProfile -ExecutionPolicy Bypass -File $far\scripts\vps\$file $argLine" } 2>&1 |
      ForEach-Object { Say ('  ' + $_) }
  } finally { $ErrorActionPreference = $eap }
  return $LASTEXITCODE
}

$clock = [Diagnostics.Stopwatch]::StartNew()
Write-Host ''
Write-Host '  THORNSWOOD  -  put a backup back onto a new box' -ForegroundColor White
Say "  box     $target" 'DarkGray'

# ------------------------------------------------------------------ here ---
if (-not (Test-Path -LiteralPath $Backup)) { Die "There is no file at $Backup" }
$Backup = (Resolve-Path -LiteralPath $Backup).Path
$name = Split-Path -Leaf $Backup
# The nightly shape only. Backup-Server.ps1's thornswood-backup-<stamp>.zip.enc
# names the dev server game-2; Restore-Server.ps1 reads game and game-dev.
if ($name -notmatch '^thornswood-\d{8}-\d{6}\.zip\.enc$') {
  Die ("$name is not a nightly backup (thornswood-<date>-<time>.zip.enc). Take one with " +
       'Install-Backup.ps1 -RunNow and bring it down with Fetch-Backups.ps1.')
}
if ($Expect -and $Expect -notmatch '^\d+$') { Die '-Expect takes a profile id, digits only.' }
if (-not (Test-Path -LiteralPath $KeyFile)) { Die "There is no passphrase file at $KeyFile. Pass -KeyFile." }
Say "  backup  $Backup" 'DarkGray'

Head 'Does it open, here'
$global:LASTEXITCODE = 0
& (Join-Path $Here 'Restore-Backup.ps1') -Backup $Backup -KeyFile $KeyFile -CheckOnly -NoPause
if ($LASTEXITCODE -ne 0) { Die 'The backup did not open here, so nothing was sent. The lines above say why.' }

# ------------------------------------------------------------- the box ---
# Asked for here, after what this machine can refuse on its own, so a
# backup that would be refused is refused for itself, ssh or no ssh.
foreach ($t in 'ssh', 'scp') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client."
  }
}
Head 'Is the box ready'
$ready = @(Remote @'
$ErrorActionPreference = 'SilentlyContinue'
foreach ($t in 'Thornswood Watch', 'Thornswood Server', 'Thornswood Dev Server', 'Thornswood Docs') {
  $x = Get-ScheduledTask -TaskName $t
  if ($x) { 'TASK|' + $t + '|' + $x.State } else { 'TASK|' + $t + '|absent' }
}
# The bot is a Windows service since issue #465; Running blocks it the same way.
$x = Get-Service -Name 'ThornswoodBot'
if ($x) { 'TASK|ThornswoodBot service|' + $x.Status } else { 'TASK|ThornswoodBot service|absent' }
foreach ($r in 'C:\Thornswood-Server', 'C:\Thornswood-Server-Dev') {
  'ROOT|' + $r + '|' + (Test-Path (Join-Path $r 'dist_back\skymp5-server.js'))
}
'KEY|' + (Test-Path 'C:\Thornswood-Backup\key.txt')
'DONE'
'@)
if (-not ($ready -contains 'DONE')) {
  foreach ($l in $ready) { Say "  $l" 'DarkGray' }
  Die "Could not ask $VpsHost anything over ssh. Setup-SshKey.ps1 -Test says why."
}
$blocked = @()
foreach ($l in $ready) {
  $b = "$l".Split('|')
  if ($b[0] -eq 'TASK') {
    $c = if ($b[2] -eq 'Running') { 'Yellow' } else { 'DarkGray' }
    Say ("  {0,-24} {1}" -f $b[1], $b[2]) $c
    if ($b[2] -eq 'Running') { $blocked += "$($b[1]) is running" }
  } elseif ($b[0] -eq 'ROOT') {
    $dev = $b[1] -like '*-Dev'
    $ok = $b[2] -eq 'True'
    Say ("  {0,-24} {1}" -f $b[1], $(if ($ok) { 'has the server program' } else { 'no server program' })) $(if ($ok -or ($dev -and $NoDev)) { 'DarkGray' } else { 'Yellow' })
    if (-not $ok -and -not ($dev -and $NoDev)) {
      $blocked += $(if ($dev) { "$($b[1]) has no server program (vps-dev-instance.ps1 makes it; -NoDev leaves dev out)" }
                    else { "$($b[1]) has no server program (Install-ThornswoodServer.ps1 puts it there)" })
    }
  } elseif ($b[0] -eq 'KEY') {
    Say ("  {0,-24} {1}" -f 'C:\Thornswood-Backup', $(if ($b[1] -eq 'True') { 'has a passphrase' } else { 'no passphrase yet, this one goes there' })) 'DarkGray'
  }
}
if ($blocked.Count) {
  foreach ($x in $blocked) { Say "  $x" 'Yellow' }
  Die 'Not ready, so nothing was sent. The watchdog and every service the restore writes under must be stopped, and the server program in place.'
}
if ($Check) {
  Write-Host ''
  Say 'READY. -Check sends nothing; run this again without it to restore.' 'Green'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

# --------------------------------------------------------------- send it ---
$far = 'C:\Thornswood-Restore'
$farFwd = 'C:/Thornswood-Restore'
$results = [ordered]@{}
try {
  Head 'Sending it'
  $made = Remote "New-Item -ItemType Directory -Force -Path '$far\scripts\vps', 'C:\Thornswood-Backup' | Out-Null; 'MADE'"
  if (-not ($made -contains 'MADE')) { throw "could not make $far on the box" }
  Invoke-ThornswoodNative { & scp @ssh $Backup "${target}:$farFwd/$name" }
  if ($LASTEXITCODE -ne 0) { throw 'scp could not send the backup' }
  Say "  $name" 'Green'
  Invoke-ThornswoodNative { & scp @ssh $KeyFile "${target}:$farFwd/key.txt" }
  if ($LASTEXITCODE -ne 0) { throw 'scp could not send the passphrase file' }
  Say '  the passphrase file (not shown)' 'Green'
  foreach ($s in 'Restore-Backup.ps1', 'Restore-Server.ps1', 'vps-restore-services.ps1', 'Delete-Person.ps1') {
    Invoke-ThornswoodNative { & scp @ssh (Join-Path $Here $s) "${target}:$farFwd/scripts/vps/$s" }
    if ($LASTEXITCODE -ne 0) { throw "scp could not send $s" }
    Say "  $s" 'Green'
  }
  # Compared by hash on the box, so neither passphrase is read back here.
  $k = Remote @"
if (-not (Test-Path 'C:\Thornswood-Backup\key.txt')) { Copy-Item '$far\key.txt' 'C:\Thornswood-Backup\key.txt'; 'KEY placed' }
elseif ((Get-FileHash '$far\key.txt').Hash -eq (Get-FileHash 'C:\Thornswood-Backup\key.txt').Hash) { 'KEY same' }
else { 'KEY different' }
"@
  if ($k -contains 'KEY placed') { Say '  C:\Thornswood-Backup\key.txt is this machine''s passphrase now' 'Green' }
  elseif ($k -contains 'KEY different') { Say '  C:\Thornswood-Backup\key.txt on the box is NOT this machine''s passphrase: backups the new box takes will not open with it. Replace one with the other before relying on them.' 'Yellow' }

  $bk = "-Backup $far\$name -KeyFile $far\key.txt -NoPause"
  Head 'The live game server'
  $a = "$bk -Root C:\Thornswood-Server"
  if ($Expect) { $a += " -Expect $Expect" }
  $results['live game server'] = (OnBox 'Restore-Server.ps1' $a)

  if (-not $NoDev) {
    Head 'The dev game server'
    $results['dev game server'] = (OnBox 'Restore-Server.ps1' "$bk -Root C:\Thornswood-Server-Dev -Which dev")
  }

  Head 'The site, the bot and Caddy'
  $code = OnBox 'Restore-Backup.ps1' "-Backup $far\$name -KeyFile $far\key.txt -To $far\unpacked -NoPause"
  if ($code -eq 0) { $code = OnBox 'vps-restore-services.ps1' "-From $far\unpacked" }
  $results['site, bot and Caddy'] = $code

  # Before anything starts, whatever came back above (#2351). The backup's
  # own record is merged in when it has one; a backup from before the first
  # request has none, and the box's own record is then the whole list.
  Head 'Deletion requests, applied again'
  $has = Remote "if (Test-Path -LiteralPath '$far\unpacked\deletions\requests.jsonl') { 'RECORD' } else { 'NONE' }"
  if ($has -contains 'RECORD') { $results['deletions reapplied'] = (OnBox 'Delete-Person.ps1' "-Reapply -Delete -Merge $far\unpacked\deletions\requests.jsonl") }
  else {
    Say '  the backup carries no record of deletion requests, so the box''s own record is the list' 'DarkGray'
    $results['deletions reapplied'] = (OnBox 'Delete-Person.ps1' '-Reapply -Delete')
  }
}
catch {
  Say ("  " + $_.Exception.Message) 'Red'
  $results['sending'] = 1
}
finally {
  Head 'Taking the copy off the box'
  $gone = Remote "Remove-Item -LiteralPath '$far' -Recurse -Force -EA SilentlyContinue; if (Test-Path -LiteralPath '$far') { 'STILL THERE' } else { 'GONE' }"
  if ($gone -contains 'GONE') { Say "  $far deleted: the backup, the passphrase file and everything unpacked from it" 'Green' }
  else { Say "  $far IS STILL ON THE BOX and holds the bot token and the site keys. Delete it by hand." 'Red' }
}

Head 'What came back'
$bad = 0
foreach ($k in $results.Keys) {
  $ok = $results[$k] -eq 0
  if (-not $ok) { $bad++ }
  Say ("  {0,-22} {1}" -f $k, $(if ($ok) { 'OK' } else { 'FAILED (exit ' + $results[$k] + ')' })) $(if ($ok) { 'Green' } else { 'Red' })
}
Say ("  took {0:N0} s" -f $clock.Elapsed.TotalSeconds) 'DarkGray'
Write-Host ''
if ($bad) {
  Say 'RESTORE BOX FAILED. Nothing was started. The lines above say which part and why.' 'Red'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 1
}
Say 'RESTORE BOX OK. Nothing is started yet: MOVING-THE-SERVER.md in the ops repo has the next steps.' 'Green'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
