<#
  Send-Backups.ps1

  Sends each night's encrypted backup off the box to the Oracle VM, where it
  goes on to Google Drive (Patrick, 31 Oct 2026, #2862). It replaces One's
  Fetch-Backups.ps1: the copy off the box no longer waits for One to be on.

      Send-Backups.ps1 -Install -VmHost <address>   make the key, read the VM's host key, register the task
      Send-Backups.ps1                              send what has not gone yet (the task runs this)
      Send-Backups.ps1 -Status                      what is set up and what was sent

  WHERE IT GOES. The VM takes it as tw-boxdrop over SFTP into a jail where it
  can add a file and do nothing else: no list, read, rename, overwrite or
  delete, and its key works only from this box's address (Thornswood-Hermes,
  deploy/sshd/51-tw-boxdrop.conf). So a stolen box cannot reach a copy it
  already sent, on the VM or on Drive. After each file it sends <name>.done
  holding "<sha256> <size>", which the VM checks before it takes the file.

  WHAT GOES. Only thornswood-<date>-<time>.zip.enc, encrypted with the
  passphrase, which never leaves this box, from the last seven days and not
  sent before (sent.txt beside it). Each one is opened first with
  Restore-Backup.ps1 -CheckOnly, so only a backup that opens is sent; one
  that does not is named and the run fails.

  WHEN. The task "Thornswood Send Backups" starts when the nightly backup's
  task ends (the Task Scheduler's own "task completed" event for
  \Thornswood Backup), so it sends tonight's straight after it is made, with
  no clock between them.

  WHAT STAFF SEE. After each file the VM took, its name goes into
  C:\Thornswood-Watch\offbox.txt, which the watchdog's "copy of the backups
  off the VPS" check reads: older than 26 hours and staff are told, as when
  One fetched them.

  Runs as SYSTEM from its own copy in C:\Thornswood-Backup\offbox, which only
  SYSTEM and Administrators may open (the backup folder's own lock). Windows
  PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [string]$VmHost = '',
  [switch]$Status,
  [string]$Root = 'C:\Thornswood-Backup',
  [string]$WatchRoot = 'C:\Thornswood-Watch',
  [string]$TaskName = 'Thornswood Send Backups',
  [string]$BackupTask = 'Thornswood Backup',
  [int]$Days = 7,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Box = Join-Path $Root 'offbox'
$Key = Join-Path $Box 'drop_key'
$Known = Join-Path $Box 'known_hosts'
$Cfg = Join-Path $Box 'vm.json'
$Sent = Join-Path $Box 'sent.txt'
$Log = Join-Path $Box 'send.log'
$Name = '^thornswood-\d{8}-\d{6}\.zip\.enc$'
function Say($m) { Write-Host $m }
function Note($m) {
  Say $m
  if (Test-Path -LiteralPath $Box) { Add-Content -LiteralPath $Log -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $m) -Encoding UTF8 }
}
function Die($m) { Note "STOP. $m"; exit 1 }
function Tool($n) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if (-not $c) { Die "$n is not on PATH. Windows ships it: the OpenSSH Client." }
  return $c.Source
}

if ($Status) {
  if (-not (Test-Path -LiteralPath $Cfg)) { Say 'not set up: there is no vm.json (Send-Backups.ps1 -Install -VmHost <address>)' }
  else { Say ('sends to   tw-boxdrop@' + (Get-Content -LiteralPath $Cfg -Raw | ConvertFrom-Json).host) }
  if (Test-Path -LiteralPath ($Key + '.pub')) { Say ('its key    ' + (Get-Content -LiteralPath ($Key + '.pub') -Raw).Trim()) }
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) { $i = Get-ScheduledTaskInfo -TaskName $TaskName; Say ('task       ' + $t.State + ', last ran ' + $i.LastRunTime + ' result ' + $i.LastTaskResult) }
  else { Say 'task       NOT REGISTERED' }
  $s = @(Get-Content -LiteralPath $Sent -ErrorAction SilentlyContinue | Where-Object { $_ })
  Say ('sent       ' + $s.Count + $(if ($s.Count) { ', newest ' + $s[-1] }))
  if (Test-Path -LiteralPath $Log) { Say '--- send.log, last 10 ---'; Get-Content -LiteralPath $Log -Tail 10 | ForEach-Object { Say $_ } }
  exit 0
}

if ($Install) {
  if ($VmHost -notmatch '^[0-9]{1,3}(\.[0-9]{1,3}){3}$') { Die 'give -VmHost as the VM''s IPv4 address. Nothing was changed.' }
  if (-not (Test-Path -LiteralPath $Root)) { Die "$Root is not there: Install-Backup.ps1 makes it, with its lock. Nothing was changed." }
  $keygen = Tool 'ssh-keygen'; $scan = Tool 'ssh-keyscan'; [void](Tool 'sftp')
  # Under the backup folder, so it takes that folder's lock (SYSTEM,
  # Administrators and the backup task), then made SYSTEM's and the
  # Administrators' alone: ssh refuses a private key anybody else may read.
  if (-not (Test-Path -LiteralPath $Box)) { [void](New-Item -ItemType Directory -Path $Box -Force) }
  $acl = Get-Acl -LiteralPath $Box
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($r) }
  foreach ($sid in 'S-1-5-18', 'S-1-5-32-544') {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
  }
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath $Box -Force), $acl)
  Note "  $Box is SYSTEM's and the Administrators' only"
  if (-not (Test-Path -LiteralPath $Key)) {
    & $keygen -q -t ed25519 -N '""' -C 'thornswood-box-drops-backups' -f $Key
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Key)) { Die 'ssh-keygen could not make the key.' }
    Note '  made the drop key'
  }
  # Said before anything that needs the VM, so the key can go into
  # Thornswood-Hermes even while the VM does not answer this box yet.
  Say ('The drop key, for Thornswood-Hermes deploy/keys/box-drop.pub: ' + (Get-Content -LiteralPath ($Key + '.pub') -Raw).Trim())
  # The VM's host key, read once here and then the only one ssh accepts. Its
  # fingerprint is printed so it can be checked against the VM's own.
  $hk = @(& $scan -t ed25519 $VmHost 2>$null | Where-Object { $_ -match '^\S+ ssh-ed25519 ' })
  if (-not $hk.Count) { Die "ssh-keyscan read no host key from $VmHost on port 22: the VM does not answer this box there yet." }
  [IO.File]::WriteAllLines($Known, [string[]]$hk)
  $fp = (& $keygen -lf $Known 2>$null | Select-Object -First 1)
  Note "  the VM's host key: $fp"
  [IO.File]::WriteAllText($Cfg, (@{ host = $VmHost; user = 'tw-boxdrop' } | ConvertTo-Json))
  # Its own copies, so the task never runs a checkout that moves.
  Copy-Item -LiteralPath (Join-Path $Here 'Send-Backups.ps1') -Destination (Join-Path $Box 'Send-Backups.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $Here 'Restore-Backup.ps1') -Destination (Join-Path $Box 'Restore-Backup.ps1') -Force
  # Started by the nightly's own end: Task Scheduler writes event 102 ("task
  # completed") in its Operational log when \Thornswood Backup finishes.
  $q = "<QueryList><Query Id='0' Path='Microsoft-Windows-TaskScheduler/Operational'><Select Path='Microsoft-Windows-TaskScheduler/Operational'>*[System[(EventID=102)]] and *[EventData[Data[@Name='TaskName']='\$BackupTask']]</Select></Query></QueryList>"
  $class = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
  $trigger = New-CimInstance -CimClass $class -ClientOnly
  $trigger.Subscription = $q
  $trigger.Enabled = $true
  $action = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $Box 'Send-Backups.ps1') + '"')
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Note "  registered $TaskName, started each time $BackupTask ends"
  exit 0
}

# ---- send
if (-not (Test-Path -LiteralPath $Cfg)) { Die "not set up: there is no $Cfg (Send-Backups.ps1 -Install -VmHost <address>)." }
$vm = Get-Content -LiteralPath $Cfg -Raw | ConvertFrom-Json
$sftp = Tool 'sftp'
$restore = Join-Path $Here 'Restore-Backup.ps1'
$keyFile = Join-Path $Root 'key.txt'
$done = @(Get-Content -LiteralPath $Sent -ErrorAction SilentlyContinue | Where-Object { $_ })
$since = (Get-Date).AddDays(-$Days)
$todo = @(Get-ChildItem -LiteralPath $Root -File | Where-Object { $_.Name -match $Name -and $_.LastWriteTime -ge $since -and $done -notcontains $_.Name } | Sort-Object Name)
if (-not $todo.Count) { Note '  nothing new to send'; exit 0 }
$failed = 0
foreach ($f in $todo) {
  $check = & pwsh -NoProfile -ExecutionPolicy Bypass -File $restore -Backup $f.FullName -KeyFile $keyFile -CheckOnly 2>&1
  if ($LASTEXITCODE -ne 0) { Note ("  NOT SENT $($f.Name): it does not open with the passphrase. " + ("$check" -replace '\s+', ' ')); $failed++; continue }
  $sha = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $mark = Join-Path $Box ($f.Name + '.done')
  [IO.File]::WriteAllText($mark, ($sha + ' ' + $f.Length + "`n"), (New-Object Text.ASCIIEncoding))
  $batch = Join-Path $Box 'batch.txt'
  [IO.File]::WriteAllLines($batch, [string[]]@(('put "' + $f.FullName + '" "' + $f.Name + '"'), ('put "' + $mark + '" "' + $f.Name + '.done"')))
  $out = & $sftp -b $batch -i $Key -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ("UserKnownHostsFile=" + $Known) ($vm.user + '@' + $vm.host) 2>&1
  $code = $LASTEXITCODE
  Remove-Item -LiteralPath $mark, $batch -Force -ErrorAction SilentlyContinue
  if ($code -ne 0) { Note ("  NOT SENT $($f.Name): sftp ended with $code. " + ("$out" -replace '\s+', ' ')); $failed++; continue }
  Add-Content -LiteralPath $Sent -Value $f.Name -Encoding ASCII
  if (Test-Path -LiteralPath $WatchRoot) { [IO.File]::WriteAllText((Join-Path $WatchRoot 'offbox.txt'), $f.Name) }
  Note "  sent     $($f.Name) ($([math]::Round($f.Length / 1MB, 2)) MB), $sha"
}
# The names of those sent in the last $Days days are all sent.txt needs.
$keep = @(Get-ChildItem -LiteralPath $Root -File | Where-Object { $_.Name -match $Name } | ForEach-Object { $_.Name })
@(Get-Content -LiteralPath $Sent -ErrorAction SilentlyContinue | Where-Object { $keep -contains $_ }) | Set-Content -LiteralPath $Sent -Encoding ASCII
if ($failed) { Note "  $failed backup(s) were not sent; the next run of the nightly sends them"; exit 1 }
exit 0
