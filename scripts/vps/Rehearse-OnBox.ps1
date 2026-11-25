<#
  Rehearse-OnBox.ps1

  The monthly restore rehearsal (#5020, #5175), run on the box from the cloud
  through the deploy gate's Rehearse-Restore verb, with a bot loading the
  character (#5196) where a person used to load it on One:

      pwsh scripts/vps/Box-Run.ps1 -Line 'Start-Backup'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Rehearse-Restore -Which dev -ProfileId 1909688825'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Rehearse-Restore -Which dev -ProfileId 1909688825 -Reorder'

  Until now it ran on One: the backup was fetched there, the server put
  together there by hand, and somebody at the game loaded a character. The
  box already holds everything it needs (the nightly backups, their key, the
  server program and its plugins), so here it is one run, in this order, and
  it stops at the first thing that is not right:

    1. The folder, C:\Thornswood-Rehearsal, and the work folder beside it.
       What an earlier run left there goes first, but only when it is one
       (its rehearsal.json or this script's mark is in it); anything else
       there stops the run.
    2. The backup: the newest C:\Thornswood-Backup\thornswood-*.zip.enc, or
       -Backup. Its name and age are printed. Start-Backup takes one now.
    3. The server program and plugins: the server folder of -Which
       (C:\Thornswood-Server-Dev for dev) copied as it is, without its world,
       its private folder, its logs and its world-before-* folders. That is
       what a real restore puts the backup into, so its own settings and
       gamemode stay and the backup's world goes on top.
    4. Restore-Server.ps1 -Rehearse -Expect <ProfileId>: the world and private
       folder back, the load order checked against the folder's plugins, the
       character there, then free ports from 7800 up, no door.json and no
       join pass hold.
    5. The firewall, read before node starts: every profile on with inbound
       blocked by default, and no enabled inbound Allow rule taking the game,
       resources or voice port from anywhere but this machine. A rehearsal
       server has no join pass hold, so it never starts on a port the
       internet can reach.
    6. node dist_back/skymp5-server.js in the folder, waited for until it
       listens on its game port (5 minutes at most).
    7. scripts\bot\Check-Character.js --host 127.0.0.1: the bot reads the
       character from the restored world, logs in as it and compares what
       the server sends. CHARACTER CHECK OK is the rehearsal's pass.
    7b. With -Reorder, a load order change (#6237): node is stopped,
       Check-Character.js --pick names the earliest full plugin no other
       plugin needs as a master and that is no master itself, and the one
       rule, ServerOrder.ps1, takes it out of server-settings.json's
       loadOrder and puts it back on the end of the full plugins (#6313),
       so every full plugin after it loads a slot earlier, node
       starts again on that order and the bot checks the character again.
       It passes only when the check passes again and a plugin the
       character's ids name is at another slot than in step 7: a world
       that kept raw load order ids would send items and the cell from the
       wrong plugin and fail it. LOAD ORDER CHECK PASSED says which moved.
       Ids the gamemode keeps in its own properties are not checked here
       (#6245).
    8. node is stopped with its tree and both folders are deleted, whatever
       happened above: the unpacked backup holds the bot token and the site
       keys. The end of the server's own log is printed first.

  Prints REHEARSAL PASSED and exits 0 only when every step passed; anything
  else exits 1. -Out (the gate fills it) gets character-check.json (and
  character-check-reordered.json with -Reorder) and rehearsal.json, which
  hold no secret. It never writes the Last rehearsed
  line of RESTORING.md in the ops repo: the session that ran it does, from
  what this printed.

  Nothing else on the box is touched: the live and dev servers keep running,
  and Restore-Server.ps1 refuses either server folder as -Root.
  PowerShell 7, as the gate runs it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]{1,10}$')][string]$ProfileId,
  [ValidateSet('live', 'dev')][string]$Which = 'dev',
  [string]$Backup = '',
  [string]$Backups = 'C:\Thornswood-Backup',
  [string]$KeyFile = 'C:\Thornswood-Backup\key.txt',
  [string]$Root = 'C:\Thornswood-Rehearsal',
  [string]$Work = 'C:\Thornswood-Rehearsal-Work',
  [int]$ListenMinutes = 5,
  [switch]$Reorder,
  [string]$Out = '',
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
# The one rule for the server's load order (#4688), which -Reorder's change
# is made by (Set-RehearsalOrder, #6313).
. (Join-Path $Repo 'scripts\deploy\ServerOrder.ps1')
$Mark = '.thornswood-rehearsal'
$ServerRoots = @{ live = 'C:\Thornswood-Server'; dev = 'C:\Thornswood-Server-Dev' }
$Source = $ServerRoots[$Which]
# The rehearsal server's process. Not $script:Node: PowerShell names are not
# case sensitive, so that was the same variable as the $node path below, and
# step 8 called WaitForExit on a string (1 Nov 2026).
$script:Server = $null
$script:Failed = ''
$started = Get-Date

function Say($m) { Write-Host $m }
function Step($m) { Write-Host ''; Write-Host ('== ' + $m + ' (' + [int]((Get-Date) - $started).TotalSeconds + ' s)') }
function Fail($m) { $script:Failed = $m; throw ('STOP. ' + $m) }

# Whether a folder may be cleared: missing, empty, or one this script made.
function Test-Ours([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return $true }
  if (-not @(Get-ChildItem -LiteralPath $dir -Force).Count) { return $true }
  return ((Test-Path -LiteralPath (Join-Path $dir $Mark)) -or (Test-Path -LiteralPath (Join-Path $dir 'rehearsal.json')))
}
function Clear-Ours([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return }
  if (-not (Test-Ours $dir)) { Fail ($dir + ' holds something this script did not make, so it was left as it is and nothing ran.') }
  Remove-Item -LiteralPath $dir -Recurse -Force
}
function New-Ours([string]$dir) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  # SYSTEM's and Administrators' only: the world and the private folder go in.
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($who in 'S-1-5-18', 'S-1-5-32-544') {
    $sid = New-Object Security.Principal.SecurityIdentifier($who)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath $dir), $acl)
  Set-Content -LiteralPath (Join-Path $dir $Mark) -Value ('made by Rehearse-OnBox.ps1 ' + (Get-Date -Format o)) -Encoding ASCII
}

# Whether an inbound Allow rule lets a port in from anywhere but this machine.
# A rule bound to a Store app's container or to a service other than Any
# never carries node's traffic; a rule for another program does not either.
function Test-RuleTakes($r, [string]$proto, [int]$port) {
  if ($r.Protocol -ne 'Any' -and $r.Protocol -ne $proto) { return $false }
  if ($r.Package) { return $false }
  if ($r.Service -and $r.Service -ne 'Any') { return $false }
  if ($r.Program -and $r.Program -ne 'Any' -and $r.Program -notmatch '(?i)\\node\.exe$') { return $false }
  $remote = @($r.Remote | Where-Object { $_ -and $_ -notmatch '^(127\.0\.0\.1|::1|127\.0\.0\.0/8|127\.0\.0\.0/255\.0\.0\.0)$' })
  if (-not $remote.Count) { return $false }
  if (-not $r.Ports.Count) { return $true }
  foreach ($p in $r.Ports) {
    if ($p -eq 'Any' -or $p -eq [string]$port) { return $true }
    if ($p -match '^(\d+)-(\d+)$' -and [int]$Matches[1] -le $port -and $port -le [int]$Matches[2]) { return $true }
  }
  return $false
}
function Get-InboundAllow {
  foreach ($r in @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue)) {
    $pf = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
    $af = $r | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue
    $ap = $r | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
    $sf = $r | Get-NetFirewallServiceFilter -ErrorAction SilentlyContinue
    [pscustomobject]@{
      Name = [string]$r.Name; DisplayName = [string]$r.DisplayName
      Protocol = [string]$pf.Protocol
      Ports = @(@($pf.LocalPort) | ForEach-Object { [string]$_ })
      Remote = @(@($af.RemoteAddress) | ForEach-Object { [string]$_ })
      Program = [string]$ap.Program; Package = [string]$ap.Package; Service = [string]$sf.Service
    }
  }
}

# node and every child it started, then the folder's own node processes.
function Stop-Rehearsal {
  if ($script:Server -is [Diagnostics.Process] -and -not $script:Server.HasExited) {
    & "$env:SystemRoot\System32\taskkill.exe" /T /F /PID ([string]$script:Server.Id) 2>&1 | Out-Null
    $script:Server.WaitForExit(30000) | Out-Null
    Say ('  node ' + $script:Server.Id + ' stopped')
  }
  $esc = [regex]::Escape($Root)
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match $esc })) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Say ('  node ' + $p.ProcessId + ' in ' + $Root + ' stopped')
  }
}

# node on the folder, waited for until it listens on the game port. -Own
# takes only an endpoint of this process, for a start after a stop, where
# the last one's endpoint could still be read.
function Start-Rehearsal([switch]$Own) {
  $so = Join-Path $Work 'node.out.txt'; $se = Join-Path $Work 'node.err.txt'
  $script:Server = Start-Process -FilePath $nodeExe -ArgumentList 'dist_back/skymp5-server.js' -WorkingDirectory $Root -RedirectStandardOutput $so -RedirectStandardError $se -WindowStyle Hidden -PassThru
  Say ('  node ' + $script:Server.Id + ' started in ' + $Root)
  $until = (Get-Date).AddMinutes($ListenMinutes)
  $up = $false
  while ((Get-Date) -lt $until) {
    Start-Sleep -Seconds 2
    if ($script:Server.HasExited) { break }
    $udp = @(Get-NetUDPEndpoint -LocalPort ([int]$rh.port) -ErrorAction SilentlyContinue | Where-Object { -not $Own -or $_.OwningProcess -eq $script:Server.Id })
    if ($udp.Count) { $up = $true; break }
  }
  if (-not $up) {
    Get-Content -LiteralPath $so, $se -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Say ('  | ' + $_) }
    if ($script:Server.HasExited) { Fail ('node ended with ' + $script:Server.ExitCode + ' before it listened on ' + $rh.port + '.') }
    Fail ('node did not listen on UDP ' + $rh.port + ' within ' + $ListenMinutes + ' minutes.')
  }
  Say ('  listening on UDP ' + $rh.port + ' after ' + [int]((Get-Date) - $script:Server.StartTime).TotalSeconds + ' s')
}

# The bot's check, its lines said and its record copied to -Out. Fails the
# run unless it ends CHARACTER CHECK OK.
function Invoke-Check([string]$json) {
  $o = & $nodeExe $check --root $Root --profile $ProfileId --host 127.0.0.1 --port ([string]$rh.port) --out $json 2>&1
  $rc = $LASTEXITCODE
  $o | ForEach-Object { Say ('  ' + $_) }
  if ($Out) {
    if (-not (Test-Path -LiteralPath $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }
    foreach ($f in @($json, (Join-Path $Root 'rehearsal.json'))) { if (Test-Path -LiteralPath $f) { Copy-Item -LiteralPath $f -Destination $Out -Force } }
  }
  if ($rc -ne 0 -or ($o | Out-String) -notmatch 'CHARACTER CHECK OK') { Fail ('Check-Character.js did not end CHARACTER CHECK OK (exit ' + $rc + ').') }
}

# -Reorder's load order change (#6237), made by the one rule (#4688, #6313):
# the plugin Check-Character.js --pick named is taken out of the order the
# rehearsal server runs, and Get-ThornswoodServerOrder puts it back as a new
# plugin, on the end of the full plugins, so every full plugin after it
# loads a slot earlier and the light order is kept. The settings from
# before stay as server-settings.json.before-reorder, and a second change is
# refused, so they are never lost. Returns the REORDERED line.
function Set-RehearsalOrder([string]$Folder, [string]$Name) {
  $file = Join-Path $Folder 'server-settings.json'
  $s = [IO.File]::ReadAllText($file) -replace '^\uFEFF', '' | ConvertFrom-Json
  $entries = @($s.loadOrder | ForEach-Object { [string]$_ })
  if (-not $entries.Count) { Fail ($file + ' names no loadOrder, so there is no order to change.') }
  $dataDir = if ($s.dataDir) { [string]$s.dataDir } else { 'data' }
  $names = @(); $byName = @{}; $kinds = @{}
  foreach ($e in $entries) {
    $n = @($e -split '[\\/]')[-1]
    $p = if ([IO.Path]::IsPathRooted($e)) { $e } else { Join-Path (Join-Path $Folder $dataDir) $e }
    $names += $n
    $byName[$n.ToLowerInvariant()] = $e
    $kinds[$n] = Get-ThornswoodPluginKind $p
  }
  if (-not $byName.ContainsKey($Name.ToLowerInvariant())) { Fail ($Name + ' is not in ' + $file + '''s loadOrder.') }
  $o = Get-ThornswoodServerOrder $names @() $kinds @($names | Where-Object { $_ -ne $Name })
  if ((@($o.AddedFull) -join '|') -ne $Name -or $o.Removed.Count -or $o.NewFullMasters.Count -or $o.LightOutOfPlace.Count) {
    Fail ('the rule did not put ' + $Name + ' back on the end alone (added ' + (@($o.AddedFull) -join ', ') + '; removed ' + (@($o.Removed) -join ', ') + '; new masters ' + (@($o.NewFullMasters) -join ', ') + ').')
  }
  [IO.File]::Copy($file, ($file + '.before-reorder'), $false)
  $s.loadOrder = [string[]]@($o.Order | ForEach-Object { $byName[$_.ToLowerInvariant()] })
  [IO.File]::WriteAllText($file, ($s | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
  $isLight = { param($x) [bool]$kinds[$x].Light }.GetNewClosure()
  return ('REORDERED {0} from slot 0x{1:x2} to 0x{2:x2}' -f $Name, (Get-ThornswoodFullIndex $names $isLight $Name), (Get-ThornswoodFullIndex $o.Order $isLight $Name))
}

$result = 1
$moved = ''
try {
  if ($ServerRoots.Values -contains $Root.TrimEnd('\') -or $ServerRoots.Values -contains $Work.TrimEnd('\')) { Fail ('-Root and -Work are never a server folder.') }
  $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $nodeExe) { Fail 'node is not on PATH here.' }
  $check = Join-Path $Repo 'scripts\bot\Check-Character.js'
  if (-not (Test-Path -LiteralPath $check)) { Fail ('main has no scripts\bot\Check-Character.js (Thornswood #5213), so nothing can load the character.') }

  Step '1. the folders'
  Clear-Ours $Root
  Clear-Ours $Work
  New-Ours $Root
  New-Ours $Work
  Say ('  ' + $Root + ' and ' + $Work + ', SYSTEM''s and Administrators'' only')

  Step '2. the backup'
  if (-not $Backup) {
    $b = Get-ChildItem -LiteralPath $Backups -Filter 'thornswood-*.zip.enc' -File -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $b) { Fail ('no thornswood-*.zip.enc in ' + $Backups + '.') }
    $Backup = $b.FullName
  }
  if (-not (Test-Path -LiteralPath $Backup)) { Fail ($Backup + ' is not there.') }
  if (-not (Test-Path -LiteralPath $KeyFile)) { Fail ('the backup key, ' + $KeyFile + ', is not there.') }
  $bi = Get-Item -LiteralPath $Backup
  Say ('  ' + $bi.Name + ', written ' + $bi.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + ' box time, ' + [math]::Round(((Get-Date) - $bi.LastWriteTime).TotalHours, 1) + ' hours ago, ' + $bi.Length + ' bytes')

  Step ('3. the ' + $Which + ' server''s program and plugins')
  if (-not (Test-Path -LiteralPath (Join-Path $Source 'server-settings.json'))) { Fail ($Source + ' has no server-settings.json.') }
  $free = (Get-PSDrive -Name ($Root.Substring(0, 1))).Free
  $need = (Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(world|private|world-before-[^\\]*|world-mongo-[^\\]*|logs)\\' -and $_.Name -notmatch '\.log(\.\d+)?$' } | Measure-Object Length -Sum).Sum
  Say ('  ' + [math]::Round($need / 1MB) + ' MB to copy, ' + [math]::Round($free / 1MB) + ' MB free')
  if ($need * 1.2 + 2GB -gt $free) { Fail 'not enough free disk for the copy, the world and 2 GB to spare.' }
  & robocopy $Source $Root /E /XD world private "world-before-*" "world-mongo-*" logs /XF *.log *.log.* /NFL /NDL /NJH /NJS /NP | Out-Null
  $rc = $LASTEXITCODE
  if ($rc -ge 8) { Fail ('robocopy ended ' + $rc + ' copying ' + $Source + '.') }
  Say ('  copied (robocopy ' + $rc + ')')

  Step '4. restore as a rehearsal'
  $out4 = & pwsh -NoProfile -File (Join-Path $Here 'Restore-Server.ps1') -Backup $Backup -Root $Root -Which $Which -KeyFile $KeyFile -Expect $ProfileId -Work $Work -Rehearse -NoPause 2>&1
  $rc = $LASTEXITCODE
  $out4 | ForEach-Object { Say ('  ' + $_) }
  $said = ($out4 | Out-String)
  if ($rc -ne 0 -or $said -notmatch 'RESTORE OK' -or $said -notmatch 'REHEARSAL READY') { Fail ('Restore-Server.ps1 did not end RESTORE OK and REHEARSAL READY (exit ' + $rc + ').') }
  $rh = Get-Content -LiteralPath (Join-Path $Root 'rehearsal.json') -Raw | ConvertFrom-Json
  $ports = @([int]$rh.port, [int]$rh.resources, [int]$rh.voicePort)
  if ($ports -contains 0) { Fail 'rehearsal.json does not name the game, resources and voice ports.' }
  if (Test-Path -LiteralPath (Join-Path $Root 'private\door.json')) { Fail 'private\door.json is still in the folder.' }
  Say ('  game ' + $rh.port + ', resources ' + $rh.resources + ', voice ' + $rh.voicePort)

  Step '5. the firewall, before node starts'
  foreach ($fp in @(Get-NetFirewallProfile -PolicyStore ActiveStore)) {
    Say ('  profile ' + $fp.Name + ': on ' + $fp.Enabled + ', inbound ' + $fp.DefaultInboundAction)
    if ([string]$fp.Enabled -ne 'True' -or [string]$fp.DefaultInboundAction -ne 'Block') { Fail ('the firewall''s ' + $fp.Name + ' profile does not block inbound by default, so the rehearsal ports could be open.') }
  }
  $rules = @(Get-InboundAllow)
  $open = @()
  foreach ($r in $rules) {
    foreach ($pp in @(@('UDP', $rh.port), @('TCP', $rh.port), @('TCP', $rh.resources), @('TCP', $rh.voicePort))) {
      if (Test-RuleTakes $r $pp[0] ([int]$pp[1])) { $open += ("'" + $r.DisplayName + "' (" + $r.Name + ') takes ' + $pp[0] + ' ' + $pp[1] + ' from ' + ($r.Remote -join ',')) }
    }
  }
  if ($open.Count) { $open | ForEach-Object { Say ('  OPEN ' + $_) }; Fail 'an inbound rule lets a rehearsal port in from outside this machine. Nothing was started.' }
  Say ('  ' + $rules.Count + ' enabled inbound Allow rules read; none takes a rehearsal port from outside this machine')

  Step '6. start the rehearsal server'
  $mem = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
  Say ('  ' + $mem + ' MB of memory free before it starts')
  Start-Rehearsal

  Step '7. the bot loads the character'
  $json = Join-Path $Work 'character-check.json'
  Invoke-Check $json

  if ($Reorder) {
    Step '7b. a load order change, and the same check again'
    Stop-Rehearsal
    $script:Server = $null
    $said = @(& $nodeExe $check --root $Root --pick 2>&1 | ForEach-Object { "$_" })
    $picked = $LASTEXITCODE
    $said | ForEach-Object { Say ('  ' + $_) }
    $pick = @($said | Where-Object { $_ -like 'PICK * from slot *' })
    if ($picked -ne 0 -or $pick.Count -ne 1) { Fail 'Check-Character.js --pick named no plugin to move.' }
    Say ('  ' + (Set-RehearsalOrder $Root ($pick[0] -replace '^PICK (.+) from slot .*$', '$1')))
    Start-Rehearsal -Own
    $json2 = Join-Path $Work 'character-check-reordered.json'
    Invoke-Check $json2
    $a = (Get-Content -LiteralPath $json -Raw | ConvertFrom-Json).plugins
    $b = (Get-Content -LiteralPath $json2 -Raw | ConvertFrom-Json).plugins
    $changed = @()
    if ($a) { foreach ($n in $a.PSObject.Properties.Name) { if ($b -and [string]$b.$n -ne [string]$a.$n) { $changed += ($n + ' ' + $a.$n + ' to ' + $b.$n) } } }
    if (-not $changed.Count) { Fail ('no plugin character ' + $ProfileId + '''s ids name moved, so the check after the change proved nothing about ids by plugin. Run it with a character that carries items from a plugin after the one that moved.') }
    $moved = $changed -join ', '
    Say ('  LOAD ORDER CHECK PASSED: the character loaded the same with ' + $moved)
  }
  $result = 0
}
catch {
  if (-not $script:Failed) { $script:Failed = $_.Exception.Message }
  Say ''
  Say ('STOP. ' + ($script:Failed -replace '^STOP\. ', ''))
}
finally {
  Step '8. stop and clean up'
  # Each part on its own, so one that throws never keeps the folders, which
  # hold the unpacked world, from being deleted.
  try { Stop-Rehearsal } catch { $result = 1; Say ('  node could not be stopped: ' + $_.Exception.Message) }
  try {
    $log = Join-Path $Root 'thornswood.log'
    if (Test-Path -LiteralPath $log) { Say '  the end of its thornswood.log:'; Get-Content -LiteralPath $log -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Say ('  | ' + $_) } }
  } catch { Say ('  its log could not be read: ' + $_.Exception.Message) }
  # A world in MongoDB went into the rehearsal's own database (#6237,
  # Restore-Server.ps1), a copy of everybody's characters: emptied here as
  # the folders are deleted.
  try {
    if (Test-Path -LiteralPath (Join-Path $Root 'server-settings.json')) {
      . (Join-Path $Here '..\deploy\World.ps1')
      $rw = Get-ThornswoodWorld $Root
      if ($rw.Driver -eq 'mongodb') {
        $e = Clear-ThornswoodScratchWorld $rw
        if ($e -like 'STOP|*') { $result = 1; Say ('  ' + $e.Substring(5) + '. It holds the restored world; empty it.') }
        else { Say ('  ' + $rw.Db + ' emptied, ' + ($e -split '\|')[1] + ' form(s)') }
      }
    }
  } catch { $result = 1; Say ('  the rehearsal''s database could not be emptied: ' + $_.Exception.Message) }
  foreach ($d in $Root, $Work) {
    try { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }; Say ('  ' + $d + ' deleted') }
    catch { $result = 1; Say ('  ' + $d + ' could not be deleted: ' + $_.Exception.Message + ' It holds the unpacked world; delete it.') }
  }
}

Say ''
if ($result -eq 0) { Say ('REHEARSAL PASSED: ' + (Split-Path -Leaf $Backup) + ' restored on the box and character ' + $ProfileId + ' loaded by the bot as the backup holds it' + $(if ($moved) { ', and again after a load order change moved ' + $moved } else { '' }) + ', in ' + [int]((Get-Date) - $started).TotalSeconds + ' s') }
else { Say ('REHEARSAL FAILED: ' + $script:Failed) }
exit $result
