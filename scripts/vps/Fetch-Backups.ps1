<#
  Fetch-Backups.ps1

  Brings the nightly backups off the VPS onto this machine, and checks that
  what arrived is readable. This is the half that makes them backups: a copy
  that only exists on the server is gone with the server.

      .\scripts\vps\Fetch-Backups.ps1              bring down anything new
      .\scripts\vps\Fetch-Backups.ps1 -All         bring down everything, again
      .\scripts\vps\Fetch-Backups.ps1 -NoVerify    just copy, do not open them

  EVERY ONE IT BRINGS DOWN IS CHECKED (issue #2200), with Restore-Backup.ps1
  -CheckOnly, not just the newest: a newest-only check says nothing about the
  others. Each file is named with its result. One that fails, or arrives
  short, is renamed out of the backup pattern to <name>.failed-<stamp>, kept
  for a look and never counted, pruned or skipped as already here, and the
  run ends non-zero. No passphrase, or no Restore-Backup.ps1 beside this
  script, is a failure too, because then nothing was checked. -NoVerify is the
  one way to skip the check, and says so.

  Everything it brings down is encrypted, so where it lands matters less than
  it would otherwise. The passphrase is the thing to keep carefully, and it is
  not in here.

  WHERE THEY LAND: local\backups in the repository (Where.ps1 Backups), or
  the folder -To names. Until 5 October it was Downloads\Thornswood-Backups;
  Patrick's rule that day is that Thornswood work on One lives only in the
  repository and the vault (and C:\ThornswoodTemps&Worktrees, inside the
  repository since #2900). A worktree's local
  folder goes when the worktree is removed, so run from a worktree it stops
  and asks for -To rather than land there.

  ON ITS OWN, since issue #401:

      .\scripts\vps\Fetch-Backups.ps1 -Schedule      every day at 04:15, an hour after the box takes one
      .\scripts\vps\Fetch-Backups.ps1 -Unschedule    take that task off again
      .\scripts\vps\Fetch-Backups.ps1 -PruneOnly     only the tidy below, no ssh

  -Schedule copies this script, Restore-Backup.ps1, Vps.ps1 and vps.json to
  %LOCALAPPDATA%\Thornswood\Backups-Fetch and points a task on this machine at
  that copy, so the task does not break when a repo folder or worktree is
  moved or removed. The task is given -To as a whole path, the folder this run
  would use, because the copy has no Where.ps1 beside it to ask; a -To or
  -KeyFile that is not a whole path (C:\... or \\server\share) is refused
  before anything is made or registered (#2199). It runs as
  you, while you are signed in, and a run missed because the machine was off
  happens at the next sign in. Run -Schedule again after this script changes
  to refresh the copy, and after the backups folder moves so the task writes
  to the new one.

  The copy off the box goes over ssh (scp), with the key already used for the
  VPS. Nothing is ever served over HTTPS for this.

  KEPT HERE: everything from the last -KeepDays days (30 unless told), and the
  newest seven whatever their age, so a VPS that stopped taking backups a
  month ago does not quietly lose its last good ones here too. Only files
  named the way the box names them are ever considered.

  And the whole-server copies Backup-Server.ps1 takes by hand into the same
  folder (thornswood-backup-<yyyyMMdd-HHmm>.zip.enc, and the plain .zip it
  made until #3582), each deleted -KeepDays days after the day in its name.
  They are no part of the nightly series, so the newest seven are not
  counted among them and none is kept past its days for that.

  Every run adds to fetch.log in the -To folder, because a task that runs
  unattended says nothing to anybody otherwise.

  THE BOX IS TOLD (issue #2755). After a run that checked what it brought
  down, or found nothing new, the name of the newest copy here goes into
  offbox.txt in the watchdog's folder on the box (-WatchRoot), and
  Watch-Services.ps1 there tells staff when that copy is over 26 hours old.
  So a copy that falls behind is told while this machine is off, which is
  when it falls behind. A run that could not check what it brought down
  (-NoVerify, no passphrase, no Restore-Backup.ps1) tells the box nothing,
  because the newest copy here is then not one anybody has opened. The box
  not taking the name fails the run.
#>
[CmdletBinding()]
param(
  [string]$VpsHost = '',
  [string]$VpsUser = '',
  [string]$Remote  = 'C:/Thornswood-Backup',
  [string]$WatchRoot = 'C:/Thornswood-Watch',
  [string]$To      = '',
  [string]$KeyFile = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Documents\thornswood-backup-key.txt'),
  [int]$KeepDays   = 30,
  [string]$At      = '04:15',
  [string]$TaskName = 'Thornswood Fetch Backups',
  [switch]$Schedule,
  [switch]$Unschedule,
  [switch]$PruneOnly,
  [switch]$All,
  [switch]$NoVerify,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c; Log $m }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray; Log "-- $m" }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Log "STOP. $m"; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }
function Log($m) {
  try {
    if (Test-Path -LiteralPath $To) {
      Add-Content -LiteralPath (Join-Path $To 'fetch.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m) -Encoding UTF8
    }
  } catch { }
}

# A file that failed is renamed out of the backup pattern, so it is never
# kept as one of the newest seven, never pruned and never taken for a copy
# already here. Kept, not deleted, so it can be looked at (#2200).
function Set-Aside($path) {
  $to = $path + '.failed-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  try {
    Move-Item -LiteralPath $path -Destination $to -Force
    Say ("          set aside as {0}" -f (Split-Path -Leaf $to)) 'Yellow'
  } catch { Say ("          could not set {0} aside: {1}" -f (Split-Path -Leaf $path), $_.Exception.Message) 'Red' }
}

# Everything from the last $KeepDays days, and the newest seven whatever
# their age. Matched by name, so nothing put here by hand is ever touched,
# except Backup-Server.ps1's own copies, aged below by the day in theirs.
function Prune {
  if ($KeepDays -le 0) { return }
  $mine = @(Get-ChildItem -LiteralPath $To -File -EA SilentlyContinue |
            Where-Object { $_.Name -match '^thornswood-(\d{8})-(\d{6})\.zip(\.enc)?$' } |
            Sort-Object Name -Descending)
  $cut = (Get-Date).Date.AddDays(-$KeepDays)
  $dropped = 0
  for ($i = 7; $i -lt $mine.Count; $i++) {
    $d = [datetime]::ParseExact($mine[$i].Name.Substring(11, 8), 'yyyyMMdd', $null)
    if ($d -lt $cut) {
      # Said truthfully (#2354): a copy that will not delete is named with
      # the kind of error and counted as a failure, so the run ends non-zero
      # and the task's last result says so. It used to be -EA
      # SilentlyContinue and then "dropped" whatever happened.
      try {
        Remove-Item -LiteralPath $mine[$i].FullName -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $mine[$i].FullName) { throw [IO.IOException]::new('still there after the delete') }
        Say ("  dropped {0}, older than {1} days" -f $mine[$i].Name, $KeepDays) 'DarkGray'
        $dropped++
      } catch {
        $ex = $_.Exception
        $kind = $ex.GetType().Name
        if ($ex.HResult) { $kind += (' 0x{0:X8}' -f $ex.HResult) }
        Say ("  NOT DROPPED {0}: {1}. It is older than {2} days and is still here." -f $mine[$i].Name, $kind, $KeepDays) 'Red'
        $script:pruneFailed++
      }
    }
  }
  Say ("  kept {0} backup(s) here" -f ($mine.Count - $dropped)) 'DarkGray'

  # Backup-Server.ps1's copies taken by hand (#3582), by the day in the name.
  $byHand = @(Get-ChildItem -LiteralPath $To -File -EA SilentlyContinue |
              Where-Object { $_.Name -match '^thornswood-backup-(\d{8})-(\d{4})\.zip(\.enc)?$' } |
              Sort-Object Name)
  $kept = 0
  foreach ($f in $byHand) {
    $d = [datetime]::ParseExact($f.Name.Substring(18, 8), 'yyyyMMdd', $null)
    if ($d -ge $cut) { $kept++; continue }
    try {
      Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
      if (Test-Path -LiteralPath $f.FullName) { throw [IO.IOException]::new('still there after the delete') }
      Say ("  dropped {0}, a copy taken by hand, older than {1} days" -f $f.Name, $KeepDays) 'DarkGray'
    } catch {
      $ex = $_.Exception
      $kind = $ex.GetType().Name
      if ($ex.HResult) { $kind += (' 0x{0:X8}' -f $ex.HResult) }
      Say ("  NOT DROPPED {0}: {1}. It is a copy taken by hand, older than {2} days, and is still here." -f $f.Name, $kind, $KeepDays) 'Red'
      $script:pruneFailed++
    }
  }
  if ($byHand.Count) { Say ("  kept {0} copy(ies) taken by hand here" -f $kept) 'DarkGray' }
}
$script:pruneFailed = 0

# The box's watchdog judges how old the copy off it is from this (THE BOX IS
# TOLD above). Only a name matched the way the box names its backups is
# written, so nothing else ever reaches the command line.
function Send-OffBoxMark {
  $newest = @(Get-ChildItem -LiteralPath $To -File -EA SilentlyContinue |
              Where-Object { $_.Name -match '^thornswood-\d{8}-\d{6}\.zip(\.enc)?$' } |
              Sort-Object Name -Descending | Select-Object -First 1)
  if (-not $newest.Count) { Say '  the box was not told of a copy: there is none here' 'Yellow'; return }
  $name = $newest[0].Name
  $file = $WatchRoot.Replace('/', '\') + '\offbox.txt'
  $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("Set-Content -LiteralPath '$file' -Value '$name' -Encoding ASCII; 'MARKED'"))
  $said = @(Invoke-ThornswoodNative { & ssh @ssh $target "pwsh -NoProfile -EncodedCommand $enc" } 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
  if ($said -contains 'MARKED') { Say ("  told the box the newest copy here is {0}" -f $name) 'Green'; return }
  $first = $(if ($said.Count) { $said[0] } else { 'it said nothing' })
  Say ("  NOT TOLD  the box did not take {0} into {1}: {2}" -f $name, $file, $first) 'Red'
  $script:markFailed++
}
$script:markFailed = 0

# Where they land when -To is not given (WHERE THEY LAND above, 5 October).
# The copy -Schedule makes has no Where.ps1 beside it and its task always
# passes -To, so only a hand run of that copy without -To stops here.
if (-not $To -and -not $Unschedule) {
  $where = Join-Path $Here '..\release\Where.ps1'
  if (-not (Test-Path -LiteralPath $where)) { Die "There is no Where.ps1 at $where to say where the backups go, so pass -To <folder>." }
  $To = [string](& $where Backups)
  $repoDir = [string](& $where Repo)
  if (Test-Path -LiteralPath (Join-Path $repoDir '.git') -PathType Leaf) {
    Die "$repoDir is a git worktree, and its local folder goes when the worktree is removed. Run this from the repository folder itself, or pass -To <folder>."
  }
}

# -To, and under -Schedule -KeyFile, must be whole paths: a drive and a
# backslash (C:\...) or \\server\share. Each is used as given, and the task
# -Schedule registers is handed both word for word, so anything else means a
# different folder depending on where it runs. Measured 12 Oct (#2199): -To
# given through Git Bash unquoted arrived as C:Users<you>DownloadsThornswood-
# Repolocalbackups, a path relative to the current folder on C:. This script
# made that folder inside the worktree it ran from and registered the task
# with it, so the next 4:15 AM run would have fetched into a new folder under
# its own copy's folder and left local\backups to go stale.
function Test-WholePath([string]$p) {
  if ($p -match '^[A-Za-z]:[\\/]' -or $p -match '^\\\\[^\\/]+[\\/][^\\/]+') { return $true }
  # Off Windows a whole path starts at / (#2989). On Windows /x is relative to
  # the current drive, so there it stays refused.
  return ([IO.Path]::DirectorySeparatorChar -eq '/' -and $p.StartsWith('/'))
}
function Stop-NotWholePath([string]$name, [string]$p) {
  Die ("-{0} is not a whole path: '{1}'. Give it as C:\folder\... or \\server\share\... A path like C:Users... is what a shell that dropped the backslashes passes on (Git Bash does this to an unquoted C:\...); run it from PowerShell, or quote the path." -f $name, $p)
}
if ($To -and -not (Test-WholePath $To)) { $bad = $To; $To = ''; Stop-NotWholePath 'To' $bad }
if ($Schedule -and -not (Test-WholePath $KeyFile)) { Stop-NotWholePath 'KeyFile' $KeyFile }
if ($To -and -not (Test-Path -LiteralPath $To)) { [void](New-Item -ItemType Directory -Path $To -Force) }

# ---------------------------------------------------------- the schedule ----
if ($Unschedule) {
  Head 'Taking the fetch task off this machine'
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -EA SilentlyContinue
  if (Get-ScheduledTask -TaskName $TaskName -EA SilentlyContinue) { Die "$TaskName is still registered." }
  Say "  $TaskName removed. The backups already here are left alone." 'Green'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}
if ($Schedule) {
  Head 'Putting the fetch on a schedule on this machine'
  $home2 = Join-Path $env:LOCALAPPDATA 'Thornswood\Backups-Fetch'
  [void](New-Item -ItemType Directory -Path $home2 -Force)
  foreach ($n in 'Fetch-Backups.ps1', 'Restore-Backup.ps1', 'Vps.ps1', 'vps.json') {
    $from = Join-Path $Here $n
    if (-not (Test-Path -LiteralPath $from)) { Die "$n is not beside this script, so the task would not run." }
    Copy-Item -LiteralPath $from -Destination (Join-Path $home2 $n) -Force
  }
  Say "  copied the scripts to $home2" 'DarkGray'
  $me = Join-Path $home2 'Fetch-Backups.ps1'
  $argLine = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NoPause -To "{1}" -KeyFile "{2}" -KeepDays {3}' -f
              $me, $To, $KeyFile, $KeepDays)
  $a = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument $argLine -WorkingDirectory $home2
  $t = New-ScheduledTaskTrigger -Daily -At $At
  $p = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive
  $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $TaskName -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null
  $x = Get-ScheduledTask -TaskName $TaskName -EA SilentlyContinue
  if (-not $x) { Die "Registering $TaskName failed." }
  Say ("  {0} registered, next run {1}" -f $TaskName, (Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime) 'Green'
  Say "  it writes what it did to $(Join-Path $To 'fetch.log')" 'DarkGray'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}
if ($PruneOnly) {
  Head "Tidying $To"
  Prune
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  if ($script:pruneFailed) { exit 1 }
  exit 0
}

if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
Log "---- fetch from $VpsHost ----"
$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
foreach ($t in 'ssh', 'scp') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "$t is not on PATH." }
}
if (-not (Test-Path -LiteralPath $To)) { [void](New-Item -ItemType Directory -Path $To -Force) }

$e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(@"
Get-ChildItem '$($Remote.Replace('/','\'))' -File -EA SilentlyContinue |
  Where-Object { `$_.Name -match '^thornswood-\d{8}-\d{6}\.zip(\.enc)?`$' } |
  ForEach-Object { `$_.Name + '|' + `$_.Length }
"@))
$listing = Invoke-ThornswoodNative { & ssh @ssh $target "pwsh -NoProfile -EncodedCommand $e" } 2>&1

Head 'On the VPS'
$onBox = @()
foreach ($line in $listing) {
  $s = "$line".Trim()
  if ($s -match '^(thornswood-\d{8}-\d{6}\.zip(?:\.enc)?)\|(\d+)$') {
    $onBox += [pscustomobject]@{ Name = $Matches[1]; Length = [long]$Matches[2] }
  } elseif ($s) { Say "  $s" 'DarkGray' }
}
if (-not $onBox.Count) { Die "No backups on the VPS at $Remote. Has Install-Backup.ps1 been run, and has the task fired yet?" }
Say ("  {0} backup(s)" -f $onBox.Count)

$want = @()
foreach ($b in ($onBox | Sort-Object Name)) {
  $local = Join-Path $To $b.Name
  # Matched on size, not just on the name. A copy that was interrupted halfway
  # is the one thing worse than no copy, because it looks like a copy.
  if (-not $All -and (Test-Path -LiteralPath $local) -and (Get-Item $local).Length -eq $b.Length) {
    Say ("  have    {0}" -f $b.Name) 'DarkGray'
    continue
  }
  $want += $b
}
if (-not $want.Count) {
  Head 'Nothing new'
  Say "  Everything on the box is already in $To" 'Green'
  Prune
  Send-OffBoxMark
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  if ($script:pruneFailed -or $script:markFailed) { exit 1 }
  exit 0
}

Head ("Copying {0}" -f $want.Count)
$got = @()
# Counted so an unattended run ends non-zero, which is what the task
# scheduler shows as its last result.
$failed = 0
foreach ($b in $want) {
  Invoke-ThornswoodNative { & scp @ssh "${target}:$Remote/$($b.Name)" (Join-Path $To $b.Name) }
  if ($LASTEXITCODE -ne 0) { Say ("  FAILED  " + $b.Name) 'Red'; $failed++; continue }
  $local = Join-Path $To $b.Name
  $len = (Get-Item $local).Length
  if ($len -ne $b.Length) {
    Say ("  SHORT   {0}  got {1} of {2} bytes" -f $b.Name, $len, $b.Length) 'Red'
    Set-Aside $local
    $failed++
    continue
  }
  Say ("  {0}  {1} MB" -f $b.Name, [math]::Round($len / 1MB, 2)) 'Green'
  $got += $local
}

if ($NoVerify -or -not $got.Count) {
  Write-Host ''
  if ($NoVerify -and $got.Count) { Say ("  -NoVerify: {0} copied and NOT checked, so the box was not told of them" -f $got.Count) 'Yellow' }
  Prune
  if (-not $NoVerify) { Send-OffBoxMark }
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  if ($failed -or $script:pruneFailed -or $script:markFailed) { exit 1 }
  exit 0
}

Head ("Checking every one opens ({0})" -f $got.Count)
# Copying a file proves the bytes moved. It does not prove the backup is a
# backup, and that is the failure worth catching: the two that existed before
# any of this were both readable and both had no characters in them. Every
# file this run brought down is checked, in name order, not only the newest
# (#2200): a newest-only check proves nothing about the rest.
$restore = Join-Path $Here 'Restore-Backup.ps1'
$checked = $false
if (-not (Test-Path -LiteralPath $restore)) {
  Say ("  NOT CHECKED  Restore-Backup.ps1 is not next to this script, so none of the {0} could be opened." -f $got.Count) 'Red'
  $failed++
} elseif (-not (Test-Path -LiteralPath $KeyFile)) {
  Say ("  NOT CHECKED  No passphrase at {0}, so none of the {1} could be opened. Pass -KeyFile, or -NoVerify to only copy." -f $KeyFile, $got.Count) 'Red'
  $failed++
} else {
  $checked = $true
  foreach ($one in ($got | Sort-Object)) {
    $leaf = Split-Path -Leaf $one
    $global:LASTEXITCODE = 0
    try { & $restore -Backup $one -KeyFile $KeyFile -CheckOnly -NoPause; $code = $LASTEXITCODE }
    catch { Say ("  {0}: {1}" -f $leaf, $_.Exception.Message) 'Red'; $code = 1 }
    if ($code -ne 0) {
      Say ("  FAILED  {0}  did not open (exit {1}). Do not trust it until you know why." -f $leaf, $code) 'Red'
      Set-Aside $one
      $failed++
    } else {
      Say ("  OK      {0}  opens and its signature is good" -f $leaf) 'Green'
    }
  }
}

Prune
# A failed one was set aside out of the backup pattern, so the newest here is
# one that opened. Unchecked copies are not told about.
if ($checked) { Send-OffBoxMark } else { Say '  the box was not told of these, because none of them was opened' 'Yellow' }
Write-Host ''
Say "  They are in $To" 'DarkGray'
Say '  Restoring one for real is RESTORING.md in the ops repo.' 'DarkGray'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
if ($failed -or $script:pruneFailed -or $script:markFailed) { exit 1 }
exit 0
