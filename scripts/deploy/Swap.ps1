<#
  Swap.ps1

  Stages a deploy beside what is running, checks it there, and only then swaps it in, keeping what it replaced for a one-command put-back.

  Dot-sourced by the scripts that change something running on the VPS:
  Deploy-Server.ps1 and Deploy-DevGamemode.ps1 (the game servers, the first
  pair of blocks below), and Deploy-Docs.ps1, Install-Voice.ps1 and
  Install-Bot.ps1 (the site, the voice service and the bot, the second pair).
  Install-ThornswoodServer.ps1 does the same for a whole server folder, on the
  box itself, with folders beside the root instead of files inside it.

  WHY, issue #446: "A failed publish deletes the live server before checking
  the new one." Measured on 28 September, every one of those scripts but
  Deploy-Server wrote over the running copy first and found out afterwards
  whether the new one worked, and none of them could put the old one back.
  The shape Deploy-Server was given for entry 209 is the one they all use now:

    1. Every new file goes up into <root>\.stage-<stamp> while the old one
       runs. A failed copy stops the run with nothing touched.
    2. The box checks the stage: every file hashed against what left this
       machine, the settings parsed, the program parsed (node --check, or
       Python's own parser). A refusal clears the stage and stops nothing.
    3. Only then the stop, one rename per file (what it replaces goes into
       <root>\.prev-<stamp>), and the same for a directory named in $Dirs;
       for a caller that names what else at its root is its own ($Owns, the
       bot, issue #1184), whatever is there that it did not send goes into
       .prev the same way; then the start, and a check that it answers.
    4. If a rename fails, or it does not answer, the old files go back, the
       old one is started again, and the run says SWAP ROLLED BACK and exits 1.

  The stop waits for each process it stopped to have exited, and each rename
  is tried once, saying why when Windows refuses it (StopAndMove.ps1, whose
  text goes in front of both swap blocks, #2928).

  The newest two .prev folders are kept, and the newest two .undone ones
  (Patrick, 29 Sep, #1121: two, not three). -PutBack on each of those
  scripts puts the newest one back the same checked way, and keeps what it
  took out in <root>\.undone-<stamp>, so a put-back can itself be put back by
  hand.

  What runs on the box is kept here as single quoted text, so what goes up is
  plain PowerShell a person can read and the harnesses can run against a
  scratch folder (tests\test-deploy-server-swap.ps1, tests\test-deploy-swaps.ps1).
  Keep it ASCII: a laptop on PowerShell 7 writes the file Remote sends without
  a byte order mark, and Windows PowerShell 5.1 at the far end reads it as ANSI.

  $Wait in the swap is how long both ports may take. Left off on the caller,
  it is the shared ceiling in ServerReadyWait.ps1, derived from measured Live
  and Dev starts (#1938).
#>

. (Join-Path $PSScriptRoot 'ServerReadyWait.ps1')
# Restore-SwapRecord sends its lock for the deploy store (Lock-Folder.ps1).
. (Join-Path $PSScriptRoot '..\vps\Lock-Folder.ps1')
# The hold both swap blocks write while they have a server stopped (#5155).
. (Join-Path $PSScriptRoot '..\vps\ServerHold.ps1')

# ==== deploy-server remote blocks ====
#
# THE TWO HALVES THAT RUN ON THE BOX, KEPT HERE SO A HARNESS CAN RUN THEM TOO.
#
# Written for Deploy-Server.ps1 and moved here for issue #446, so the dev
# server's deploy (Deploy-DevGamemode.ps1) stages, checks and swaps with the
# same two blocks rather than a copy of them.
#
# Entry 209 on the To Do List: "Upload to a staging path, verify there, the
# shortest possible stop, an atomic rename, a real health check." And: "This
# is the script that runs most often and has the least protection." Until
# then it stopped the server, copied over the running folder, waited six
# seconds, and printed SERVER IS NOT LISTENING without exiting non-zero,
# putting anything back, asking the resources port or checking the load order
# on the box.
#
# $checkBlock runs while the server is still up and touches nothing but the
# stage. $swapBlock is the only part that stops anything, and it does the
# stop, the renames, the start, the health check and the way back in one
# script, so a connection that drops between two ssh calls cannot leave the
# server stopped with half its files moved.
#
# Both are single quoted and take their values from the lines SwapVars puts in
# front of them, so what goes to the box is plain PowerShell a person can read
# and tests\test-deploy-server-swap.ps1 can run against a scratch folder. Each
# ends with one line the caller reads: STAGE OK or STAGE REFUSED, and SWAP OK,
# SWAP ROLLED BACK, SWAP REFUSED or SWAP FAILED. A line and not an exit code,
# because Remote sends a long script as a file and the exit code left behind
# is the one from deleting that file.
#
# Keep them ASCII. A laptop on PowerShell 7 writes that file without a byte
# order mark, and Windows PowerShell 5.1 at the far end then reads it as ANSI.
#
# $checkBlock calls ServerBuild.ps1, beside this file, whose text is put in
# front of it below the end marker, so the stage's server files are held to
# the record sent with them by the same lines that hold a payload and a build
# (#1214).
$checkBlock = @'
$ProgressPreference = 'SilentlyContinue'
$stageDir = Join-Path $Root $Stage
$bad = @()
# Every file the same as the one that left the laptop, by its hash. An exit
# code from scp says a copy ended, not what arrived.
$sums = @{}
foreach ($rel in @($Want.Keys)) {
  $p = Join-Path $stageDir ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $p)) { $bad += ('did not arrive: ' + $rel); continue }
  $sums[$rel] = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sums[$rel] -ne $Want[$rel]) { $bad += ('arrived different from what was sent: ' + $rel) }
}
$new = $null
$sp = Join-Path $stageDir 'server-settings.json'
if (Test-Path -LiteralPath $sp) {
  $b = [IO.File]::ReadAllBytes($sp)
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) {
    $bad += 'server-settings.json starts with a byte order mark, and node will not parse it'
  }
  try { $new = Read-ThornswoodRecord -Path $sp -Kind server-settings }
  catch { $bad += ('the staged settings cannot be trusted: ' + $_.Exception.Message) }
} else { $bad += 'there is no server-settings.json in the stage' }
# The port it runs on now and the port the new settings name must agree. The
# stop picks its process by that port and the health check asks it, so a file
# that moved it would stop one process and then ask about another.
$now = $null
$nowWhy = ''
try { $now = Read-ThornswoodRecord -Path (Join-Path $Root 'server-settings.json') -Kind server-settings } catch { $nowWhy = $_.Exception.Message }
if (-not $now) {
  $bad += ('the settings in ' + $Root + ' cannot be read, so there is no telling which process is this server: ' + $nowWhy)
} elseif ($new -and [int]$new.port -ne [int]$now.port) {
  $bad += ('the new settings put this server on port ' + [int]$new.port + ' and it is on ' + [int]$now.port + ' now')
}
# The load order resolution Install-ThornswoodServer.ps1 does, against the
# plugins already here plus the ones in the stage, because a shortened load
# order shifts every index after the gap.
$order = @()
if ($new -and $new.loadOrder) { $order = @($new.loadOrder) }
if ($new -and -not $order.Count) { $bad += 'server-settings.json has no loadOrder' }
$plugins = Join-Path $Root 'plugins'
foreach ($p in $order) {
  $at = ([string]$p) -replace '/', '\'
  if (-not $at) { $bad += 'the load order has an empty entry'; continue }
  $leaf = [IO.Path]::GetFileName($at)
  $staged = ((Split-Path -Parent $at) -eq $plugins) -and (Test-Path -LiteralPath (Join-Path $stageDir ('plugins\' + $leaf)))
  if (-not $staged -and -not (Test-Path -LiteralPath $at)) { $bad += ('the load order names a plugin that is not on disk: ' + $p) }
}
# The gamemode parses on the box too, not only where it was written. Issue
# #446: a gamemode that does not parse stops the server at start, and this is
# the last point at which that costs nothing.
$gm = Join-Path $stageDir 'gamemode.js'
if ($sums.ContainsKey('gamemode.js') -and (Test-Path -LiteralPath $gm)) {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
  $nd = Get-Command node -CommandType Application -EA SilentlyContinue | Select-Object -First 1
  if (-not $nd) { $bad += 'node is not on this machine, so gamemode.js could not be checked' }
  else {
    $said = @(& $nd.Source --check $gm 2>&1)
    if ($LASTEXITCODE -ne 0) {
      $bad += ('gamemode.js does not parse: ' + ((@($said | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) | Select-Object -First 6) -join ' | '))
    }
  }
}
# Every server file sent is the build the record sent with it names, every
# file the record names was sent, and a server file with no record beside it
# does not go in (#1214). Deploy-Server sends them all together, so the box
# never runs a binary of one build beside the JavaScript half of another.
$forkSent = @($sums.Keys | Where-Object { Test-ThornswoodServerForkFile $_ })
$rp = Join-Path $stageDir 'server-build.json'
if ($sums.ContainsKey('server-build.json') -and (Test-Path -LiteralPath $rp)) {
  try {
    $rec = Read-ThornswoodRecord -Path $rp -Kind server-build
    $forkSums = @{}
    foreach ($k in $forkSent) { $forkSums[$k] = $sums[$k] }
    $bad += @(Get-ThornswoodServerBuildProblems $rec $forkSums 'the stage' 'server-build.json')
  } catch { $bad += ('the staged server-build.json cannot be trusted: ' + $_.Exception.Message) }
} elseif ($forkSent.Count) {
  $bad += ('server files came with no server-build.json to hold them to: ' + ($forkSent -join ', '))
}
if ($bad.Count) {
  foreach ($x in $bad) { 'REFUSED: ' + $x }
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  'the stage is cleared and the server was not touched'
  'STAGE REFUSED'
} else {
  'the stage checks out: {0} file(s) as sent, {1} plugins in the load order and all on disk, port {2}' -f $Want.Count, $order.Count, [int]$new.port
  'STAGE OK'
}
'@

$swapBlock = @'
$ProgressPreference = 'SilentlyContinue'
$stageDir = Join-Path $Root $Stage
$prevDir  = Join-Path $Root $Prev
$log      = Join-Path $Root 'server.log'
# Before every start here: whether the task is the one the installer makes,
# said and never changed (#2491). Install-ThornswoodServer.ps1 registers it at
# priority 1 with node started through cmd's start /high, so the server runs
# High (Patrick, 12 Oct 2026). The installer is the one place the task is
# made. A task an older install registered is registered again by
# Publish-Server.ps1 -TaskOnly, which this names; a deploy starts the task the
# box has. From 5 Oct (#2015) this step set the task's priority to 4 before
# each start instead, repairing at every deploy the tasks registered before
# #1967 rather than registering them again, and on a task at 1 it would have
# put the server back to Normal.
function TaskShape {
  $t = Get-ScheduledTask -TaskName $Task -EA SilentlyContinue
  if (-not $t) { return }
  $high = @($t.Actions | Where-Object { [string]$_.Arguments -like '*start "" /b /wait /high *' }).Count -gt 0
  if ($t.Settings.Priority -eq 1 -and $high) { return }
  $why = @()
  if ($t.Settings.Priority -ne 1) { $why += ('its priority is ' + $t.Settings.Priority + ', not 1') }
  if (-not $high) { $why += 'it does not start node through start /high' }
  $chan = ''
  if ($Root.TrimEnd('\') -like '*-Dev') { $chan = ' -Channel dev' }
  'the task ' + $Task + ' is not the one the installer makes (' + ($why -join '; ') + '), so the server will not run High: register it again with .\scripts\release\Publish-Server.ps1 -TaskOnly' + $chan
}
$new      = [IO.File]::ReadAllText((Join-Path $stageDir 'server-settings.json')) | ConvertFrom-Json
# The check has already refused a port that moves, so this is the port the
# running server is on and the one the new one will be on.
$port     = [int]$new.port
# skymp5-server/ts/ui.ts: 3000 when the game port is 7777, the game port plus
# one otherwise. The same rule Publish-Server and Install-ThornswoodServer use.
$resPort  = if ($port -eq 7777) { 3000 } else { $port + 1 }
$clean    = $true

# What holds UDP $port, listed whole and filtered as the installer's waits do
# (#2711): -LocalPort with nothing on it is an error, and nothing there is what
# most of these looks are for. A list that cannot be had is not a free port.
# Held says it is held and leaves why in $heldWhy, and each caller says so.
# Until 19 Oct this was -LocalPort with -EA SilentlyContinue, which made a box
# that could not list its ports look exactly like a server that never started
# (#2466).
$heldWhy = ''
$heldBy  = @()
function Held {
  $script:heldWhy = ''
  $script:heldBy = @()
  try { $script:heldBy = @(Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $port } | ForEach-Object { [int]$_.OwningProcess }) }
  catch { $script:heldWhy = $_.Exception.Message; return $true }
  return $script:heldBy.Count -gt 0
}

function StopOurs {
  # The process on this root's own port and nothing else. Matching every
  # node.exe running skymp5-server took the dev server down with the live one
  # and only started the live one back up.
  'stopping whatever holds UDP ' + $port
  $pids = @()
  try { $pids = @(Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $port } | ForEach-Object { [int]$_.OwningProcess }) }
  catch { 'COULD NOT LIST the UDP ports to find what holds ' + $port + ', so nothing was stopped by its port: ' + $_.Exception.Message }
  # Only the UDP port. The line that also stopped whatever listened on the TCP
  # port one above it was copied from the dev script, where that port is the
  # server's own HTTP and belongs to the same process. On the live root it is
  # 7778, which is the voice service, a separate process that carries voice
  # chat, the launcher's character choices and the chat command queue the
  # lockpick fix rides on. Stopping the game server must never take that down.
  #
  # Found and opened before the task is asked to stop, then waited for until
  # it has exited, so its files are closed before anything is renamed
  # (StopAndMove.ps1, #2928). Until 20 Oct this waited for the port to close
  # and then two seconds more, and the renames were tried ten times over.
  $held = @(Get-ThornswoodProcessHeld $pids)
  $ThornswoodNotHeld
  Stop-ScheduledTask -TaskName $Task -EA SilentlyContinue
  foreach ($p in $held) { 'stopped pid ' + $p.Id }
  Stop-ThornswoodProcessHeld $held
  # Once the process is gone, so is any restart.json it never read. The
  # gamemode deletes that file when it reads it, and a process that is down,
  # or whose gamemode failed at load, never does. The next one to start then
  # finds it within a tick and a half and counts down on its own: under
  # -Mode notice a "Pushing a server update in 1 minute" with nothing behind
  # it, and under -Mode restart a kick a minute after boot with no restart
  # behind it. Same gap Deploy-DevGamemode closed on 24 September.
  # Settings that do not read name no data folder: the default is not guessed
  # for them, and the line says the restart.json was not looked for.
  $d = 'data'
  $dWhy = ''
  try {
    $s = [IO.File]::ReadAllText((Join-Path $Root 'server-settings.json')) | ConvertFrom-Json
    if ($s.dataDir) { $d = [string]$s.dataDir }
  } catch { $dWhy = $_.Exception.Message }
  if ($dWhy) {
    'COULD NOT READ ' + (Join-Path $Root 'server-settings.json') + ' for its data folder (' + $dWhy + '), so a restart.json the old process never read was not looked for, and the new process may count down on its own'
  } else {
    $rq = Join-Path ([IO.Path]::Combine($Root, $d)) 'restart.json'
    if (Test-Path -LiteralPath $rq) {
      try { Remove-Item -LiteralPath $rq -Force -EA Stop; 'removed a restart.json the old process never read' }
      catch { 'COULD NOT REMOVE ' + $rq + ', so the new process will count down on its own: ' + $_.Exception.Message }
    }
  }
}

# Both ports, from the box itself. UDP alone is not enough: the resources port
# is what the launcher and the client fetch from, and it only opens once the
# native server has been built without throwing. $Wait is the shared ceiling
# unless the caller passed -Wait (ServerReadyWait.ps1, #1938).
$answerWhy = ''
# A look that could not list the UDP ports is not answering, and how many of
# the looks were like that is said with the FAIL line (#2466).
$blindWhy = ''
function Answering {
  $until = (Get-Date).AddSeconds($Wait)
  $looks = 0
  $blind = 0
  $script:blindWhy = ''
  while ($true) {
    $tcp = $false
    $looks++
    $udp = Held
    if ($heldWhy) {
      $udp = $false
      $blind++
      $script:blindWhy = 'the UDP ports could not be listed on ' + $blind + ' of ' + $looks + ' looks, the last saying: ' + $heldWhy
    }
    if ($udp) {
      # A try that throws is kept for the FAIL line, which says it.
      $c = New-Object Net.Sockets.TcpClient
      try {
        $null = $c.BeginConnect('127.0.0.1', $resPort, $null, $null).AsyncWaitHandle.WaitOne(500)
        $tcp = $c.Connected
      } catch { $script:answerWhy = $_.Exception.Message }
      finally { $c.Close() }
    }
    if ($tcp) { return $true }
    if ((Get-Date) -gt $until) { return $false }
    Start-Sleep -Milliseconds 700
  }
}

# THE GAMEMODE'S TABLES (#5191). A gamemode from #5191 on reads its tables
# from <root>\gamemode-tables as it loads, every NAME.json there and nothing
# else, and names the folder in server.log by its git tree id. So the folder
# is the deploy's as a whole: each table is in $Want for the check, which
# holds it to its hash, and the swap moves the folder in one rename, the old
# one into .prev with any table this deploy no longer has. A put-back's .prev
# holds the folder it took out, and puts that back the same way. A deploy
# that sends no table leaves the folder at the root alone.
$TablesDir = 'gamemode-tables'
$moveRels = @(@($Want.Keys) | Where-Object { -not $_.StartsWith($TablesDir + '/') })
if (@(@($Want.Keys) | Where-Object { $_.StartsWith($TablesDir + '/') }).Count) { $moveRels += $TablesDir }

# Each rename is Move-ThornswoodPath (StopAndMove.ps1): once, after StopOurs
# has waited for the server to exit, saying why when it is refused.
function PutBack {
  $rels = @($moveRels)
  [array]::Reverse($rels)
  foreach ($rel in $rels) {
    $r = $rel -replace '/', '\'
    $at = Join-Path $Root $r
    if ($placed -contains $rel) {
      if (-not (Move-ThornswoodPath $at (Join-Path $stageDir $r))) { 'COULD NOT TAKE THE NEW ' + $rel + ' BACK OUT: ' + $ThornswoodMoveWhy; $script:clean = $false; continue }
    }
    if ($aside -contains $rel) {
      if (-not (Move-ThornswoodPath (Join-Path $prevDir $r) $at)) { 'COULD NOT PUT THE OLD ' + $rel + ' BACK: ' + $ThornswoodMoveWhy; $script:clean = $false }
    }
  }
}

if (-not $port) {
  'the staged settings name no port, so nothing was stopped'
  if (-not $KeepStage) { Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue }
  'SWAP REFUSED'
  exit 1
}
# The nightly backup reads this server's folder; one of the two at a time
# (#3247, Enter-ThornswoodServerFolderTurn in ServerFolderTurn.ps1). Held
# until this block ends. A put-back's stage is the .prev folder it puts back,
# so a refused put-back leaves it where it is ($KeepStage).
$turnWhy = ''
try { $serverTurn = Enter-ThornswoodServerFolderTurn (Join-Path (Split-Path -Parent $Root.TrimEnd('\')) 'Thornswood-Backup') ('a deploy into ' + $Root) 1200 { param($m) Write-Host $m } }
catch { $turnWhy = $_.Exception.Message }
if ($turnWhy) {
  $turnWhy + ', so nothing was stopped'
  if (-not $KeepStage) { Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue }
  'SWAP REFUSED'
  exit 1
}
# Held on purpose from here until this block ends (#5155, ServerHold.ps1), so
# the watchdog does not start the old files in the middle of the swap. Every
# way out below takes the hold away, once the server has been started again or
# this has given up on it and left it to the watchdog.
Set-ThornswoodHold -Target $Task -Why ('swapping in new files at ' + $Root) -By $HoldBy
StopOurs
$notGone = @($ThornswoodStillRunning) + @($ThornswoodNotHeld)
if ($notGone.Count -or (Held)) {
  if ($notGone.Count) { 'what the stop ended has not all exited, so its files may still be open, and nothing was swapped' }
  elseif ($heldWhy) { 'the UDP ports could not be listed after the stop (' + $heldWhy + '), so whether UDP ' + $port + ' let go is not known, and nothing was swapped' }
  else { 'UDP ' + $port + ' is still held by pid ' + ($heldBy -join ', ') + ' after the stop, so nothing was swapped' }
  if (-not $KeepStage) { Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue }
  Clear-ThornswoodHold -Target $Task
  'SWAP REFUSED'
  exit 1
}

$placed = @()
$aside = @()
$moved = $true
foreach ($rel in @($moveRels)) {
  $r = $rel -replace '/', '\'
  $at = Join-Path $Root $r
  if (Test-Path -LiteralPath $at) {
    if (-not (Move-ThornswoodPath $at (Join-Path $prevDir $r))) { 'could not move the old ' + $rel + ' aside: ' + $ThornswoodMoveWhy; $moved = $false; break }
    $aside += $rel
  }
  if (-not (Move-ThornswoodPath (Join-Path $stageDir $r) $at)) { 'could not move the new ' + $rel + ' into place: ' + $ThornswoodMoveWhy; $moved = $false; break }
  $placed += $rel
}

# READ BACK, BEFORE ANYTHING STARTS (#1222), when the caller named the keys its
# release is meant to change ($ReleaseKeys, Deploy-Server.ps1 from
# ServerSettings.ps1): every other key of the settings now in place must be
# the one the server had. The staged file was carried from the running one,
# so a difference means that file moved in between, and the old files go back.
if ($moved -and $null -ne $ReleaseKeys -and $placed -contains 'server-settings.json') {
  $was = $null
  $got = $null
  $drift = @()
  try { $was = [IO.File]::ReadAllText((Join-Path $prevDir 'server-settings.json')) | ConvertFrom-Json } catch { $drift += ('the server-settings.json the server had, which cannot be read (' + $_.Exception.Message + ')') }
  try { $got = [IO.File]::ReadAllText((Join-Path $Root 'server-settings.json')) | ConvertFrom-Json } catch { $drift += ('the server-settings.json now in place, which cannot be read (' + $_.Exception.Message + ')') }
  if (-not $drift.Count -and ($null -eq $was -or $null -eq $got)) { $drift += 'server-settings.json, which is empty' }
  if (-not $drift.Count) {
    $wn = @($was.PSObject.Properties | ForEach-Object { $_.Name })
    $gn = @($got.PSObject.Properties | ForEach-Object { $_.Name })
    foreach ($k in @($wn + $gn | Sort-Object -Unique)) {
      if ($ReleaseKeys -contains $k) { continue }
      $a = 'absent'
      $b = 'absent'
      if ($wn -contains $k) { $a = ConvertTo-Json -InputObject $was.$k -Compress -Depth 30 }
      if ($gn -contains $k) { $b = ConvertTo-Json -InputObject $got.$k -Compress -Depth 30 }
      if ($a -ne $b) { $drift += $k }
    }
  }
  if ($drift.Count) {
    'read back: ' + ($drift -join ', ') + ' would not be what the server had, so nothing is started'
    $moved = $false
  } else { 'read back: every setting outside this release is the one the server had' }
}

if ($moved) {
  'swapped in ' + $placed.Count + ' file(s), the ones they replaced are in ' + $prevDir
  TaskShape
  Start-ScheduledTask -TaskName $Task -EA SilentlyContinue
  'started, giving it ' + $Wait + ' seconds to answer on UDP ' + $port + ' and on ' + $resPort
  if (Answering) {
    'PASS: the server is answering on ' + $resPort + ', game port ' + $port + ', pid ' + ($heldBy -join ', ')
    Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
    # The last two sets of replaced files stay, newest first by their stamp,
    # and the last two a -PutBack took out.
    foreach ($kind in '.prev-*', '.undone-*') {
      # Said, not thrown away: a copy that will not go stays, and the line
      # says which and what Windows answered (#3183).
      $pastTwo = @(Get-ChildItem -LiteralPath $Root -Directory -Force |
        Where-Object { $_.Name -like $kind } | Sort-Object Name -Descending | Select-Object -Skip 2)
      foreach ($pd in $pastTwo) {
        try { Remove-Item -LiteralPath $pd.FullName -Recurse -Force -ErrorAction Stop }
        catch { 'PRUNE FAILED: could not remove ' + $pd.FullName + ', one of the old copies past the newest 2: ' + $_.Exception.Message }
      }
    }
    Clear-ThornswoodHold -Target $Task
    'SWAP OK'
    exit 0
  }
  'FAIL: nothing answered on UDP ' + $port + ' and ' + $resPort + ' within ' + $Wait + ' seconds'
  if ($answerWhy) { 'the last try at ' + $resPort + ' said: ' + $answerWhy }
  if ($blindWhy) { $blindWhy }
  if (Test-Path -LiteralPath $log) { '--- server.log, last 30 ---'; Get-Content -LiteralPath $log -Tail 30 }
  StopOurs
}

'putting the previous files back'
PutBack
TaskShape
Start-ScheduledTask -TaskName $Task -EA SilentlyContinue
if (Answering) { 'the previous files are back and the server is answering on ' + $resPort + ' again' }
else {
  'THE PREVIOUS FILES ARE BACK AND THE SERVER STILL IS NOT ANSWERING on ' + $resPort
  if ($answerWhy) { 'the last try at ' + $resPort + ' said: ' + $answerWhy }
  if ($blindWhy) { $blindWhy }
}
Clear-ThornswoodHold -Target $Task
if ($clean) {
  # A put-back's stage is the .prev folder it was putting back, full again.
  if (-not $KeepStage) { Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue }
  Remove-Item -LiteralPath $prevDir -Recurse -Force -EA SilentlyContinue
  'SWAP ROLLED BACK'
} else {
  'what it replaced is still in ' + $prevDir + ' and what it could not take out is in ' + $stageDir
  'SWAP FAILED'
}
exit 1
'@

# The values the two blocks run with, as lines of PowerShell put in front of
# them. Quoted here once, doubling any single quote, because a plugin name is
# free text and one of them with an apostrophe in it would otherwise end the
# string early on the far side.
#
# $releaseKeys, when given, are the settings keys the deploy is meant to
# change: the swap then reads the settings back before it starts anything, and
# ServerSettings.ps1's $settingsCarryBlock uses them (Deploy-Server.ps1). Left
# out, $ReleaseKeys is $null and there is no read-back.
function SwapVars([string]$farRoot, [string]$taskName, [string]$stageName, [string]$prevName, [int]$waitSeconds, $sums, [string[]]$releaseKeys = $null) {
  $q = { param($s) "'" + ([string]$s).Replace("'", "''") + "'" }
  $keysLine = '$ReleaseKeys = $null'
  if ($null -ne $releaseKeys) { $keysLine = '$ReleaseKeys = @(' + ((@($releaseKeys) | ForEach-Object { & $q $_ }) -join ', ') + ')' }
  $lines = @(
    ('$Root  = ' + (& $q $farRoot.Replace('/', '\'))),
    ('$Task  = ' + (& $q $taskName)),
    ('$Stage = ' + (& $q $stageName)),
    ('$Prev  = ' + (& $q $prevName)),
    ('$Wait  = ' + $waitSeconds),
    '$KeepStage = $false',
    $keysLine,
    ('$HoldBy = ' + (& $q (Get-ThornswoodHoldBy ([IO.Path]::GetFileName($MyInvocation.ScriptName))))),
    '$Want  = [ordered]@{}'
  )
  foreach ($k in @($sums.Keys)) { $lines += ('$Want[' + (& $q $k) + '] = ' + (& $q $sums[$k])) }
  return (($lines -join "`r`n") + "`r`n")
}
# ==== end deploy-server remote blocks ====

# What $checkBlock calls to hold the server files to their record (#1214),
# in front of it, so the box has it. Outside the markers because it reads a
# file beside this one: tests\test-deploy-server-swap.ps1 runs the blocks out
# of the markers and puts the same text in front itself.
$checkBlock = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'ServerBuild.ps1')) + "`r`n" + $checkBlock
# And the record contracts (#2180, slice 4): Read-JsonFile.ps1 and
# RecordShape.ps1 as text, so the stage's server-build.json and both
# settings files are held to the same shape on the box as they are here, and
# a bad one is refused naming the file and the field instead of read as
# whatever ConvertFrom-Json made of it.
$ThornswoodRecordShapeText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\release\Read-JsonFile.ps1')) + "`r`n" +
                             [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\release\RecordShape.ps1')) + "`r`n"
$checkBlock = $ThornswoodRecordShapeText + $checkBlock
# And the stop and the renames (#2928): each process waited for until it has
# exited, each rename tried once and said when refused. In front of the swap
# here, and of the service swap below.
$ThornswoodStopAndMoveText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'StopAndMove.ps1')) + "`r`n"
$swapBlock = $ThornswoodStopAndMoveText + $swapBlock
# And the hold (#5155): the server stopped on purpose says so, so the watchdog
# leaves it alone while it is swapped. In front of the swap here, and of the
# service swap below.
$ThornswoodHoldText = Get-ThornswoodHoldScript
$swapBlock = $ThornswoodHoldText + $swapBlock
# And the server folders' turn (#3247), which the nightly backup takes as
# well: in front of the game server swap only, the one whose folders it reads.
$ThornswoodServerFolderTurnText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'ServerFolderTurn.ps1')) + "`r`n"
$swapBlock = $ThornswoodServerFolderTurnText + $swapBlock

# ==== put-back pick ====
#
# -PutBack on Deploy-Server, Deploy-DevGamemode, Deploy-Docs, Install-Voice and
# Install-Bot. Put in front of the swap block in place of a stage: the newest
# .prev folder IS the stage, what it holds is what gets swapped back in, and
# what it replaces goes to .undone-<stamp> rather than another .prev, so a
# second -PutBack goes to the one before rather than back to what was just
# taken out. $KeepStage, because a put-back that does not answer, or is
# refused before it swaps, must leave that .prev folder where it was, full,
# rather than clear it as a failed stage is cleared. Until 22 Oct 2026 the
# game server swap's two refusals before it moves anything (no port, the stop
# not done) cleared it anyway, and a refused put-back lost what it was putting
# back. A file the deploy added with nothing before it stays; there is
# nothing to put back for it, and nothing running reads a file the old one
# did not name.
$putBackPick = @'
$ProgressPreference = 'SilentlyContinue'
$last = @(Get-ChildItem -LiteralPath $Root -Directory -Force -EA SilentlyContinue |
          Where-Object { $_.Name -like '.prev-*' } | Sort-Object Name -Descending | Select-Object -First 1)
if (-not $last.Count) {
  'there is no .prev folder in ' + $Root + ', so there is nothing to put back'
  'SWAP REFUSED'
  exit 1
}
$Stage = $last[0].Name
$Prev = '.undone-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$KeepStage = $true
$Want = [ordered]@{}
foreach ($f in @(Get-ChildItem -LiteralPath $last[0].FullName -Recurse -File -Force -EA SilentlyContinue)) {
  $Want[$f.FullName.Substring($last[0].FullName.Length).TrimStart('\').Replace('\', '/')] = ''
}
if (-not $Want.Count) {
  $last[0].FullName + ' is empty, so there is nothing to put back'
  'SWAP REFUSED'
  exit 1
}
'putting back what ' + $last[0].FullName + ' kept: ' + (@($Want.Keys) -join ', ')

'@
# ==== end put-back pick ====

# ==== service swap blocks ====
#
# The site, the voice service and the bot. The same two halves as the game
# server's above, without what only a game server has (a load order, a port
# in its settings, a build record). What is different about each service is
# five functions the caller puts in front of the swap block:
#
#   StopIt    stops it, by its own folder or port, and says what it stopped;
#             it opens what it will stop with Get-ThornswoodProcessHeld and
#             ends it with Stop-ThornswoodProcessHeld (StopAndMove.ps1), so
#             it returns once that has exited
#   StartIt   starts it; $Rolling is true when it is the old files starting
#   Healthy   $true once it answers within $Wait seconds, and nothing else
#   Answer    one line saying what answered
#   Why       the lines that say why it did not (a log tail)
#
# and, for the check block, an optional ExtraCheck that returns reasons to
# refuse. $Parse names the files that are programs: .js ones go through
# node --check and .py ones through Python's own parser, on the box, because a
# file that does not parse is the commonest way a deploy that copied fine
# still takes the thing down.
$serviceCheckBlock = @'
$ProgressPreference = 'SilentlyContinue'
$stageDir = Join-Path $Root $Stage
$bad = @()
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
foreach ($rel in @($Want.Keys)) {
  $p = Join-Path $stageDir ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $p)) { $bad += ('did not arrive: ' + $rel); continue }
  if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Want[$rel]) {
    $bad += ('arrived different from what was sent: ' + $rel); continue
  }
  if ($rel -like '*.json') {
    $b = [IO.File]::ReadAllBytes($p)
    if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) {
      $bad += ($rel + ' starts with a byte order mark, and node will not parse it')
    } else {
      try { $null = [IO.File]::ReadAllText($p) | ConvertFrom-Json } catch { $bad += ($rel + ' does not parse: ' + $_.Exception.Message) }
    }
  }
}
foreach ($rel in @($Parse)) {
  if (-not $rel) { continue }
  $p = Join-Path $stageDir ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $isJs = ($rel -like '*.js')
  $what = 'python'
  if ($isJs) { $what = 'node' }
  $tool = Get-Command $what -CommandType Application -EA SilentlyContinue | Select-Object -First 1
  if (-not $tool) { $bad += ($what + ' is not on this machine, so ' + $rel + ' could not be checked'); continue }
  if ($isJs) { $said = @(& $tool.Source --check $p 2>&1) }
  else { $said = @(& $tool.Source -c "import ast,sys; ast.parse(open(sys.argv[1],'rb').read(), sys.argv[1])" $p 2>&1) }
  if ($LASTEXITCODE -ne 0) {
    $bad += ($rel + ' does not parse: ' + ((@($said | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) | Select-Object -First 6) -join ' | '))
  }
}
if (${function:ExtraCheck}) { $bad += @(ExtraCheck | Where-Object { $_ }) }
if ($bad.Count) {
  foreach ($x in $bad) { 'REFUSED: ' + $x }
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  'the stage is cleared and nothing running was touched'
  'STAGE REFUSED'
} else {
  $said = 'the stage checks out: ' + $Want.Count + ' file(s) as sent'
  if (@($Parse | Where-Object { $_ }).Count) { $said += ', and ' + (@($Parse | Where-Object { $_ }) -join ', ') + ' parse' }
  $said
  'STAGE OK'
}
'@

$serviceSwapBlock = @'
$ProgressPreference = 'SilentlyContinue'
$stageDir = Join-Path $Root $Stage
$prevDir  = Join-Path $Root $Prev
$clean    = $true
$Rolling  = $false

# Each rename is Move-ThornswoodPath (StopAndMove.ps1): once, after StopIt
# has waited for what it stopped to exit, saying why when it is refused.
function PutBack {
  $rels = @($moveRels)
  [array]::Reverse($rels)
  foreach ($rel in $rels) {
    $r = $rel -replace '/', '\'
    $at = Join-Path $Root $r
    if ($placed -contains $rel) {
      if (-not (Move-ThornswoodPath $at (Join-Path $stageDir $r))) { 'COULD NOT TAKE THE NEW ' + $rel + ' BACK OUT: ' + $ThornswoodMoveWhy; $script:clean = $false; continue }
    }
    if ($aside -contains $rel) {
      if (-not (Move-ThornswoodPath (Join-Path $prevDir $r) $at)) { 'COULD NOT PUT THE OLD ' + $rel + ' BACK: ' + $ThornswoodMoveWhy; $script:clean = $false }
    }
  }
}

# A directory named in $Dirs (the bot's py-libs) moves with the files, so the
# old one is what .prev puts back. A deploy that did not stage that directory
# leaves the one already at the root alone.
if (-not (Test-Path variable:Dirs)) { $Dirs = @() }
$moveRels = @($Want.Keys)
foreach ($rel in @($Dirs)) {
  if (-not $rel) { continue }
  $atDir = Join-Path $stageDir ($rel -replace '/', '\')
  if (Test-Path -LiteralPath $atDir -PathType Container) { $moveRels += $rel }
}

# StopIt ends what it stops through Stop-ThornswoodProcessHeld, which leaves
# what had not exited in $ThornswoodStillRunning (and what it could not open
# in $ThornswoodNotHeld). Nothing it may still hold is moved: the old one is
# started again as it was.
$ThornswoodStillRunning = @()
$ThornswoodNotHeld = @()
# Held on purpose from here until this block ends (#5155, ServerHold.ps1),
# under the task or service name the watchdog knows it by ($HoldTarget, from
# ServiceSwapVars), so the watchdog does not start it in the middle of the
# swap. Both ways out below take the hold away.
if ($HoldTarget) { Set-ThornswoodHold -Target $HoldTarget -Why ('swapping in new files at ' + $Root) -By $HoldBy }
StopIt
$placed = @()
$aside = @()
$moved = $true
if (@($ThornswoodStillRunning).Count -or @($ThornswoodNotHeld).Count) {
  'what the stop ended has not all exited, so its files may still be open, and nothing was moved'
  $moved = $false
}
foreach ($rel in @($moveRels)) {
  if (-not $moved) { break }
  $r = $rel -replace '/', '\'
  $at = Join-Path $Root $r
  if (Test-Path -LiteralPath $at) {
    if (-not (Move-ThornswoodPath $at (Join-Path $prevDir $r))) { 'could not move the old ' + $rel + ' aside: ' + $ThornswoodMoveWhy; $moved = $false; break }
    $aside += $rel
  }
  if (-not (Move-ThornswoodPath (Join-Path $stageDir $r) $at)) { 'could not move the new ' + $rel + ' into place: ' + $ThornswoodMoveWhy; $moved = $false; break }
  $placed += $rel
}

# WHAT THIS DEPLOY DID NOT SEND, issue #1184. A caller that owns the whole of
# its root says so with $Owns: the names at the top of the root that are its
# own besides what it sends (its settings, its records, the folders it
# keeps), as wildcards. Everything else at the top of the root, and every
# file in a folder this deploy sends into, goes aside into $prevDir while it
# is stopped, so what starts is the root as the deploy describes it and
# nothing more. It goes the way a replaced file goes: a rollback puts it back,
# -PutBack puts it back with the code it came out beside (a file an older
# deploy sent and this one no longer does is that older code's), and it
# leaves the box with that .prev folder. The swap's own folders are never
# looked at. With no $Owns nothing is, which is the site and the voice
# service.
$strays = @()
if ($moved -and (Test-Path variable:Owns) -and @($Owns | Where-Object { $_ }).Count) {
  $sentRels = @($moveRels)
  $ownNames = @('.stage-*', '.prev-*', '.undone-*') + @($Owns | Where-Object { $_ })
  function Strays([string]$dir, [string]$under) {
    foreach ($e in @(Get-ChildItem -LiteralPath $dir -Force -EA SilentlyContinue)) {
      $rel = $under + $e.Name
      if (-not $under -and @($ownNames | Where-Object { $e.Name -like $_ }).Count) { continue }
      if ($sentRels -contains $rel) { continue }
      if ($e.PSIsContainer -and @($sentRels | Where-Object { $_.StartsWith($rel + '/', [StringComparison]::OrdinalIgnoreCase) }).Count) {
        Strays $e.FullName ($rel + '/')
        continue
      }
      $rel
    }
  }
  foreach ($rel in @(Strays $Root '')) {
    $r = $rel -replace '/', '\'
    if (-not (Move-ThornswoodPath (Join-Path $Root $r) (Join-Path $prevDir $r))) { 'could not move ' + $rel + ', which this deploy did not send, aside: ' + $ThornswoodMoveWhy; $moved = $false; break }
    $aside += $rel
    $moveRels += $rel
    $strays += $rel
  }
}

# WHAT LEFT THE REPOSITORY. A caller that sends only what changed (the site)
# cannot use $Owns, which would take every unchanged file aside, so it names
# in $Gone the files it no longer has. On 17 Oct the site's looks.js and
# looks.css were still served after #2572 took them out, because nothing
# ever took a public file away. They go aside the way a stray does: a
# rollback and -PutBack put them back.
if (-not (Test-Path variable:Gone)) { $Gone = @() }
$goneAside = @()
if ($moved) {
  foreach ($rel in @($Gone | Where-Object { $_ })) {
    $r = $rel -replace '/', '\'
    $at = Join-Path $Root $r
    if (-not (Test-Path -LiteralPath $at -PathType Leaf)) { continue }
    if (-not (Move-ThornswoodPath $at (Join-Path $prevDir $r))) { 'could not move ' + $rel + ', which this deploy no longer has, aside: ' + $ThornswoodMoveWhy; $moved = $false; break }
    $aside += $rel
    $moveRels += $rel
    $goneAside += $rel
  }
}

if ($moved) {
  'swapped in ' + $placed.Count + ' file(s), the ones they replaced are in ' + $prevDir
  if ($goneAside.Count) { 'took out ' + $goneAside.Count + ' file(s) this deploy no longer has, into ' + $prevDir + ': ' + ($goneAside -join ', ') }
  if ($strays.Count) { 'moved aside ' + $strays.Count + ' thing(s) at ' + $Root + ' that this deploy did not send and that are not its own, into ' + $prevDir + ': ' + ($strays -join ', ') }
  StartIt
  'started, giving it ' + $Wait + ' seconds to answer'
  if (Healthy) {
    'PASS: ' + (Answer)
    Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
    # The newest two of each, by their stamp.
    foreach ($kind in '.prev-*', '.undone-*') {
      # Said, not thrown away: a copy that will not go stays, and the line
      # says which and what Windows answered (#3183).
      $pastTwo = @(Get-ChildItem -LiteralPath $Root -Directory -Force |
        Where-Object { $_.Name -like $kind } | Sort-Object Name -Descending | Select-Object -Skip 2)
      foreach ($pd in $pastTwo) {
        try { Remove-Item -LiteralPath $pd.FullName -Recurse -Force -ErrorAction Stop }
        catch { 'PRUNE FAILED: could not remove ' + $pd.FullName + ', one of the old copies past the newest 2: ' + $_.Exception.Message }
      }
    }
    if ($HoldTarget) { Clear-ThornswoodHold -Target $HoldTarget }
    'SWAP OK'
    exit 0
  }
  'FAIL: it did not answer within ' + $Wait + ' seconds'
  Why
  StopIt
}

$Rolling = $true
'putting the previous files back'
PutBack
StartIt
if (Healthy) { 'the previous files are back and it is answering again: ' + (Answer) }
else { 'THE PREVIOUS FILES ARE BACK AND IT STILL IS NOT ANSWERING'; Why }
if ($HoldTarget) { Clear-ThornswoodHold -Target $HoldTarget }
if ($clean) {
  if (-not $KeepStage) { Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue }
  Remove-Item -LiteralPath $prevDir -Recurse -Force -EA SilentlyContinue
  'SWAP ROLLED BACK'
} else {
  'what it replaced is still in ' + $prevDir + ' and what it could not take out is in ' + $stageDir
  'SWAP FAILED'
}
exit 1
'@
# The stop and the renames in front of it, and the hold, as in front of
# $swapBlock above.
$serviceSwapBlock = $ThornswoodStopAndMoveText + $serviceSwapBlock
$serviceSwapBlock = $ThornswoodHoldText + $serviceSwapBlock

# The values the service blocks run with, the same way SwapVars does it for
# the game server: quoted once here, every single quote doubled.
# $holdTarget is the task or service name the watchdog knows it by, held while
# the swap block has it stopped (#5155); '' for a block that stops nothing.
function ServiceSwapVars([string]$farRoot, [string]$stageName, [string]$prevName, [int]$waitSeconds, $sums, [string[]]$parse, [string]$holdTarget = '') {
  $q = { param($s) "'" + ([string]$s).Replace("'", "''") + "'" }
  $lines = @(
    ('$Root  = ' + (& $q $farRoot.Replace('/', '\'))),
    ('$Stage = ' + (& $q $stageName)),
    ('$Prev  = ' + (& $q $prevName)),
    ('$Wait  = ' + $waitSeconds),
    '$KeepStage = $false',
    ('$HoldTarget = ' + (& $q $holdTarget)),
    ('$HoldBy = ' + (& $q (Get-ThornswoodHoldBy ([IO.Path]::GetFileName($MyInvocation.ScriptName))))),
    '$Want  = [ordered]@{}'
  )
  foreach ($k in @($sums.Keys)) { $lines += ('$Want[' + (& $q $k) + '] = ' + (& $q $sums[$k])) }
  $lines += ('$Parse = @(' + ((@($parse | Where-Object { $_ }) | ForEach-Object { & $q $_ }) -join ', ') + ')')
  return (($lines -join "`r`n") + "`r`n")
}

# The SHA-256 of each file about to go up, by the path it will have under the
# stage, for the check block to hold the far copies to.
function Get-SwapHashes($send) {
  $h = [ordered]@{}
  foreach ($rel in @($send.Keys)) {
    $h[$rel] = (Get-FileHash -LiteralPath $send[$rel] -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  return $h
}

# What the caller does with the last line of a swap: SWAP OK is the only
# success. Said once here so every script reports a failed swap the same way.
function Show-SwapResult($lines, [string]$prevWhere) {
  $all = @($lines | ForEach-Object { "$_".Trim() })
  if ($all -contains 'SWAP OK') { return $true }
  Write-Host ''
  if ($all -contains 'SWAP ROLLED BACK') {
    Write-Host '  FAIL. The new copy did not answer, so the old files were put back and it' -ForegroundColor Red
    Write-Host '  was started again. The lines above say whether it answered, and why the' -ForegroundColor Red
    Write-Host '  new one did not.' -ForegroundColor Red
  } elseif ($all -contains 'SWAP REFUSED') {
    Write-Host '  FAIL. Nothing was swapped. The lines above say why.' -ForegroundColor Red
  } else {
    Write-Host '  FAIL, AND THE BOX MAY NOT BE AS IT WAS. Look at it before anything else.' -ForegroundColor Red
    Write-Host "  The files the swap replaced are in $prevWhere, and the lines above say" -ForegroundColor Red
    Write-Host '  what could not be moved back.' -ForegroundColor Red
  }
  return $false
}
# ==== end service swap blocks ====

# ==== deploy records ====
#
# What each part runs, as Artifact.ps1 records it (issue #459): a record
# beside what runs (thornswood-deploy.json in the root, or in data for a game
# server) and the same in the store's current\<part>.json. Artifact.ps1 writes
# a new one only after the swap has answered. These two keep the record in step
# with a put-back: the record a part had goes into the .prev folder with the
# files it describes, so -PutBack swaps it back in with them, and after a
# put-back the store is told what came back.
#
# Both need Artifact.ps1 loaded: Invoke-ThornswoodArtifactRemote,
# Get-ThornswoodArtifactPart and the store's name.

function Get-SwapRecordPlace([string]$Root, [string]$Beside) {
  $rootWin = $Root.Replace('/', '\').TrimEnd('\')
  if (-not $Beside) { $Beside = $rootWin + '\thornswood-deploy.json' }
  $bes = $Beside.Replace('/', '\')
  $rel = ''
  if ($bes.StartsWith($rootWin + '\', [StringComparison]::OrdinalIgnoreCase)) { $rel = $bes.Substring($rootWin.Length + 1) }
  return [pscustomobject]@{ Root = $rootWin; Beside = $bes; Rel = $rel }
}

# After SWAP OK and before the new record is written: the record the part had
# goes into the .prev folder this deploy made, at the same place under the root.
function Save-SwapPreviousRecord([string]$Target, [string[]]$SshArgs, [string]$Root, [string]$PrevName, [string]$Beside = '') {
  $w = Get-SwapRecordPlace $Root $Beside
  if (-not $w.Rel) { return }
  $q = { param($s) "'" + ([string]$s).Replace("'", "''") + "'" }
  $said = @(Invoke-ThornswoodArtifactRemote $Target $SshArgs @"
`$from = $(& $q $w.Beside)
`$prev = Join-Path $(& $q $w.Root) $(& $q $PrevName)
if (-not (Test-Path -LiteralPath `$from)) { 'NO RECORD' }
elseif (-not (Test-Path -LiteralPath `$prev)) { 'NO PREV' }
else {
  `$to = Join-Path `$prev $(& $q $w.Rel)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent `$to) | Out-Null
  Copy-Item -LiteralPath `$from -Destination `$to -Force
  'KEPT'
}
"@)
  if ($said -contains 'KEPT') { Write-Host ('  the record it ran before is kept with the old files in ' + $PrevName) -ForegroundColor DarkGray }
}

# After a put-back has said SWAP OK. $lines is what the swap said: its
# 'putting back what <folder> kept: ...' line names the record when one came
# back with the files. Then the store's current record is that one. When none
# did (a .prev from before records), the record says the part runs an older
# copy nobody recorded, rather than go on naming what was taken out.
function Restore-SwapRecord([string]$Target, [string[]]$SshArgs, [string]$Root, $Lines, [string]$Beside = '', [string]$Component = '') {
  $w = Get-SwapRecordPlace $Root $Beside
  $part = Get-ThornswoodArtifactPart $Root
  $came = $false
  foreach ($l in @($Lines)) {
    $s = [string]$l
    $at = $s.IndexOf(' kept: ')
    if ($s.StartsWith('putting back what ') -and $at -gt 0) {
      $came = @($s.Substring($at + 7) -split ', ' | ForEach-Object { $_.Trim() }) -contains $w.Rel.Replace('\', '/')
    }
  }
  $store = [string]$script:ThornswoodDeployStore
  if (-not $store) { $store = 'C:/Thornswood-Deploys' }
  $storeWin = $store.Replace('/', '\').TrimEnd('\')
  $q = { param($x) "'" + ([string]$x).Replace("'", "''") + "'" }
  $said = @(Invoke-ThornswoodArtifactRemote $Target $SshArgs @"
`$beside = $(& $q $w.Beside)
`$cur = Join-Path $(& $q ($storeWin + '\current')) $(& $q ($part + '.json'))
`$when = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture)
$(Get-ThornswoodLockedFolderScript $storeWin)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent `$cur) | Out-Null
if ('$came' -eq 'True' -and (Test-Path -LiteralPath `$beside)) {
  Copy-Item -LiteralPath `$beside -Destination `$cur -Force
  `$name = ''
  try { `$name = [string]([IO.File]::ReadAllText(`$beside) | ConvertFrom-Json).name } catch { `$name = 'a record that does not read (' + `$_.Exception.Message + ')' }
} else {
  `$name = 'an older copy kept before deploys were recorded'
  `$rec = [ordered]@{ part = $(& $q $part); component = $(& $q $Component); name = `$name; commit = ''; putBack = `$true; deployedUtc = `$when; from = `$env:COMPUTERNAME }
  `$json = ConvertTo-Json -InputObject `$rec
  [IO.File]::WriteAllText(`$cur, `$json, (New-Object Text.UTF8Encoding(`$false)))
  [IO.File]::WriteAllText(`$beside, `$json, (New-Object Text.UTF8Encoding(`$false)))
}
Add-Content -LiteralPath $(& $q ($storeWin + '\history.log')) -Value (`$when + ' ' + $(& $q $part) + ' put back to ' + `$name)
'RECORDED ' + `$name
"@)
  $r = @($said | Where-Object { "$_" -like 'RECORDED *' })
  if ($r.Count) { Write-Host ('  the box records ' + $part + ' as ' + ([string]$r[0]).Substring(9)) -ForegroundColor DarkGray }
  else { Write-Host ('  the put-back was not recorded in the store: ' + ($said -join ' ')) -ForegroundColor Yellow }
}
# ==== end deploy records ====
