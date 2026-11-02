<#
  test-install-server.ps1

  Install-ThornswoodServer.ps1, and Publish-Server.ps1 that sends it, never
  stop or remove the running server before the new one has checked out, and
  put the old one back when the new one does not answer.

  WHY THIS EXISTS. Issue #446: "A failed publish deletes the live server before
  checking the new one". Until 28 September the installer stopped the server,
  deleted the whole root, unpacked the payload into the empty folder, and only
  then checked the load order, so a payload naming a plugin it did not carry
  left no server at all; Publish-Server stopped it even earlier, before the
  copy, and said "Nothing local was changed". The issue's own Done when: a
  payload with a plugin missing from the load order leaves the old root byte
  for byte as it was, and the old server still answers.

  HOW. The installer is run by PowerShell 7, which is what runs it on the VPS
  (#5356), against a root in a scratch folder, with -AllowGamingPc so it runs on
  a machine with the game on it. The payloads are real zips. The server in
  them is a node stub that holds its game port on UDP and its resources port on
  TCP the way skymp5-server does, and dies on start, or never opens the
  resources port, when its gamemode says so. The scheduled task cmdlets are the
  only stand-ins: functions in front of them keep a task in a file and start
  its real action, cmd.exe and all, so nothing here registers a real task.
  Publish-Server.ps1 is driven whole, with ssh and scp replaced by functions
  that run the same thing against the scratch folder, the way
  test-remote-big-script.ps1 replaces them.

  It proves:
    - a first install unpacks, answers and records what the payload shipped
    - a payload naming a plugin it does not carry, a zip that arrived
      different, a gamemode that does not parse and a binary that is not its
      recorded build are each INSTALL REFUSED with the root byte for byte as
      it was and the same server process still answering
    - a payload that does not start is INSTALL ROLLED BACK: the old root back
      as it was, answering again, the new one kept as .failed to read
    - a good one swaps in, carries the world, the roster, the runtime data and
      the logs across, keeps the old root as .prev and the newest two of them
    - -PutBack puts the newest .prev back and keeps what it took out
    - issue #2491: -TaskOnly registers the task again over one with no start
      /high, restarts the server under it with node at High, and changes no
      file; with a switch that would change one it is INSTALL REFUSED
    - a root that cannot be moved because something holds a file in it is
      INSTALL REFUSED, and the old server is started again
    - -FreshWorld starts with no world and leaves the old one in .prev
    - Publish-Server.ps1 exits 1 on a refused payload without having stopped
      anything, and publishes and puts back through the same installer
    - issue #1222: a running server's own settings survive an install, a
      put-back and a Publish-Server on the dev channel and on the live one
      (every thornswood switch, npcSettings, the name, the port), with only
      the load order, the start point and how many it holds taken from the
      payload; a payload's npcSettings "default" key never reaches a running
      server, and a first install of one is refused; settings that moved
      under the install between its stage and its swap put the old folder
      back before anything starts (INSTALL ROLLED BACK)
    - issue #1214: a payload with no build record is refused, and so is a
      Publish-Server whose zip holds a binary the record does not name
    - issue #1804: a running server with no join pass switch is INSTALL
      REFUSED with the root as it was and the same process answering, and
      with -RequirePass on it is INSTALL OK with the switch set and read
      back; a first install of a payload with none is refused, and goes in
      with -RequirePass off. The payloads here carry a switch otherwise.
    - issue #459: a Publish-Server that answered records what the box runs
      (the gamemode artifact in the store, data\thornswood-deploy.json and
      the store's current record, and the engine in the site's
      deployed-build.json, #2303); a refused one records nothing; the old
      folder keeps its own record rather than handing it to the new one; and
      -PutBack records the folder that came back by its own record. The
      Publish-Server payloads carry this checkout's gamemode artifact and a
      stamp for the channel, as Export-ServerPayload.ps1 makes them, so they
      are told apart by what they ship into data.
    - issue #2323: every stub server here starts on ports below the range
      Windows hands to outgoing connections, each pair bound before it is
      handed out, so a block Windows keeps for TCP or a connection that took
      the port cannot stop a start the case expects to answer.

  Connects to nothing but 127.0.0.1.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$installer = [IO.Path]::GetFullPath((Join-Path $Here 'scripts\deploy\Install-ThornswoodServer.ps1'))
$publish   = [IO.Path]::GetFullPath((Join-Path $Here 'scripts\release\Publish-Server.ps1'))

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Remove-Item -Path function:global:ssh, function:global:scp -ErrorAction SilentlyContinue
    Remove-Variable -Name TsBox -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name TsSshSeen, TsScpFail, TsLastCode -Scope Global -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    # A failing run's whole output is kept (#2323): the one failure of 11 Oct
    # could not be read because only its last twelve lines were.
    if ($script:transcript) {
        try { Stop-Transcript | Out-Null } catch { }
        if ($script:fail) { Write-Host ('the whole of this run is kept in ' + $script:transcript) }
        else { Remove-Item -LiteralPath $script:transcript -Force -ErrorAction SilentlyContinue }
    }
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- read, not run ------------------------------------------------------------
$src = [IO.File]::ReadAllText($installer)
$iStage = $src.IndexOf('Expand-Archive -LiteralPath $Zip -DestinationPath $stageDir')
$iCheck = $src.IndexOf('load order does not resolve')
# The swap's stop. -TaskOnly (#2491) stops the server earlier in the file, in
# a branch that ends before the stage and touches no folder.
$iSwap  = $src.IndexOf('# ---- the swap')
$iStop  = if ($iSwap -ge 0) { $src.IndexOf("StopServer `$Root`r`n", $iSwap) } else { -1 }
if ($iSwap -ge 0 -and $iStop -lt 0) { $iStop = $src.IndexOf("StopServer `$Root`n", $iSwap) }
Yes 'the installer unpacks into a stage and checks the load order before it stops anything' (
    $iStage -gt 0 -and $iCheck -gt $iStage -and $iStop -gt $iCheck)
Yes 'and no longer deletes the root' ($src -notmatch 'Remove-Item -LiteralPath \$Root -Recurse')
Yes 'and sets nothing aside in %TEMP% any more' ($src -notmatch '\$env:TEMP')
# #2711: the read back before the start said "which cannot be read" with no
# file and no why; the two reads sat in a try with an empty catch.
Yes 'the read back says which settings file did not read, and why' ($src.Contains("catch { `$unread += ('the server-settings.json the server had, which cannot be read: ' + `$_.Exception.Message) }") -and $src.Contains("catch { `$unread += ('the server-settings.json now in place, which cannot be read: ' + `$_.Exception.Message) }"))
$pub = [IO.File]::ReadAllText($publish)
Yes 'Publish-Server no longer stops the server before it copies' ($pub -notmatch 'Stop-ScheduledTask' -and $pub -notmatch 'stopRemote')
Yes 'and no longer throws the world away over ssh before the install' ($pub -notmatch "Remove-Item -LiteralPath '\`$VpsRoot\\world'")
Yes 'and sends the zip''s hash for the installer to check' ($pub -match '-ZipSha256 \$zipSum')
Yes 'and hands the installer -RequirePass when it is given one (#1804)' ($pub -match '\$instArgs \+= " -RequirePass \$RequirePass"')

# #2711: the port a root's settings name. Settings that did not read were a
# try with an empty catch and came back 7777, the live server's port, so a
# dev root's check could take the live server's answer for its own. Lifted
# out and run: no file is the server's own default, one that does not read
# stops the run naming it. The waits list every UDP port and filter, since
# -LocalPort with nothing on it is an error, not an empty answer.
$gpAst = [Management.Automation.Language.Parser]::ParseInput($src, [ref]$null, [ref]$null).Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'GamePortOf' }, $true)
Yes 'the installer has one GamePortOf to lift' ($null -ne $gpAst)
if ($gpAst) {
    . ([scriptblock]::Create($gpAst.Extent.Text))
    $gpDir = Join-Path ([IO.Path]::GetTempPath()) ('ts-gameport-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $gpDir | Out-Null
    try {
        Yes 'no server-settings.json is the server''s default port, 7777' ((GamePortOf $gpDir) -eq 7777)
        [IO.File]::WriteAllText((Join-Path $gpDir 'server-settings.json'), '{"port":7787}')
        Yes 'settings naming a port give it' ((GamePortOf $gpDir) -eq 7787)
        [IO.File]::WriteAllText((Join-Path $gpDir 'server-settings.json'), '{"name":"x"}')
        Yes 'settings naming none give 7777' ((GamePortOf $gpDir) -eq 7777)
        [IO.File]::WriteAllText((Join-Path $gpDir 'server-settings.json'), '{"port":')
        $why = ''; try { $null = GamePortOf $gpDir } catch { $why = $_.Exception.Message }
        Yes 'settings that do not read stop it, naming the file, where they gave 7777' ($why -match 'server-settings\.json does not read, so the port this server answers on is not known')
    } finally { Remove-Item -LiteralPath $gpDir -Recurse -Force -ErrorAction SilentlyContinue }
}
Yes 'the waits for the ports list them whole and filter, with no -LocalPort left to throw for nothing there' ($src -notmatch 'Get-NetUDPEndpoint -LocalPort' -and $src -match 'Get-NetUDPEndpoint -ErrorAction Stop \| Where-Object \{ \$_\.LocalPort -eq \$port \}')
# #2928: the stop waits for the server's processes to have exited, which is
# when their files and ports are closed, rather than for the ports to let go.
Yes 'the stop waits for each of the server''s processes to exit, not for its ports' (
    $src -match '\$held = @\(Get-ThornswoodProcessHeld \$ids\)' -and $src -match 'Stop-ThornswoodProcessHeld \$held' -and
    $src -notmatch 'Get-NetUDPEndpoint -ErrorAction Stop \| Where-Object \{ \$ids -contains')

# ---- run, against a scratch folder ------------------------------------------
$node = Get-Command node -CommandType Application -EA SilentlyContinue | Select-Object -First 1
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the runs need Get-NetUDPEndpoint, Windows ACLs and cmd.exe, which only Windows has, and this is not Windows'
    Done
}
$boxPs = Get-BoxPowerShell
if (-not $node -or -not (Get-Command Get-NetUDPEndpoint -EA SilentlyContinue)) {
    Write-Host 'SKIP  the runs need node and Get-NetUDPEndpoint as well, and this machine lacks one'
    Done
}

$started = Get-Date
$work    = Join-Path ([IO.Path]::GetTempPath()) ('ts-install-' + [Guid]::NewGuid().ToString('N'))
$box     = Join-Path $work 'box'          # stands in for C:\ on the VPS
$tasks   = Join-Path $work 'tasks'        # the stand-in task scheduler's book
$far     = Join-Path $work 'far'          # the scripts the stand-in ssh runs
$pidLog  = Join-Path $work 'pids.txt'
$root    = Join-Path $box 'Thornswood-Server'
$utf8    = New-Object Text.UTF8Encoding($false)
$runTag  = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$TaskPrefix = 'Thornswood Test ' + $runTag   # every task this run makes, and only those
foreach ($d in $box, $tasks, $far) { $null = [IO.Directory]::CreateDirectory($d) }
# Beside the scratch folder, not in it, because that is removed at the end.
$script:transcript = Join-Path ([IO.Path]::GetTempPath()) ('ts-install-' + $runTag + '.log')
try { Start-Transcript -LiteralPath $script:transcript -Force | Out-Null } catch { $script:transcript = '' }

function Put([string]$path, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
# Read even while a server holds it open for writing, as it does server.log.
function Get([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $fs = New-Object IO.FileStream($path, 'Open', 'Read', 'ReadWrite')
    try { $r = New-Object IO.StreamReader($fs); return $r.ReadToEnd() } finally { $fs.Dispose() }
}
# A real task by the name the stand-ins use means a stand-in did not take.
# Only this run's own tasks carry $TaskPrefix, so only those are taken off
# again; any other 'Thornswood Test*' task (another run's, or a real one) is
# left exactly where it is, because it is not ours to remove, and says
# nothing about this run.
# The same per-run tag test-deploy-swaps.ps1 uses since #1973 (c8f51230).
#
# Asked by the names this run uses, one by one, never by 'Thornswood Test*'
# (#2323). Until then it listed every 'Thornswood Test*' task and was true
# only when there was none at all, so runs side by side failed each other:
# one run's decoy scene below registers real tasks for a moment, and every
# far call of another run then said a real task had been touched and threw.
# Four runs started together on One on 12 Oct all failed that way. And the
# wildcard listing itself is not safe beside another process: measured the
# same night, Get-ScheduledTask -TaskName 'Thornswood Test*' threw "The
# system cannot find the file specified" when a task was removed while it
# listed, and with SilentlyContinue that is an empty list, a task of this
# run's missed; the exact name never failed in 80 asks. The installer and
# Publish-Server register only the -TaskName they are given, so these are
# every name a stand-in that did not take could leave.
$script:ownTasks = @('Server', 'Dev', 'Live', 'Scene') | ForEach-Object { $TaskPrefix + ' ' + $_ }
function NoRealTask {
    # The task folder on disk, when this account can read it, because asking
    # the scheduler takes seconds and this is asked after every far call.
    $folder = Get-WindowsPath 'System32\Tasks'
    $readable = $false
    try { $null = [IO.Directory]::GetFiles($folder, 'x'); $readable = $true } catch { }
    if ($readable -and -not (Test-Path -Path (Join-Path $folder ($TaskPrefix + ' *')))) { return $true }
    $mine = 0
    foreach ($n in $script:ownTasks) {
        if ($null -eq (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue)) { continue }
        $mine++
        Stop-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue
    }
    return ($mine -eq 0)
}
# A decoy 'Thornswood Test <x>' task that is not this run's survives NoRealTask
# and does not count against it, while one this run made is taken off. Real tasks, made and
# removed here only, under names nothing else uses.
$decoy = 'Thornswood Test Decoy ' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$mine  = $TaskPrefix + ' Scene'
$act   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0'
try {
    $null = Register-ScheduledTask -TaskName $decoy -Action $act -ErrorAction Stop
    $null = Register-ScheduledTask -TaskName $mine  -Action $act -ErrorAction Stop
    $clean = NoRealTask
    Yes 'a real task under one of this run''s names counts against this run' (-not $clean)
    Yes 'a task this run did not make is left where it was' ($null -ne (Get-ScheduledTask -TaskName $decoy -ErrorAction SilentlyContinue))
    Yes 'while a task this run made is removed' ($null -eq (Get-ScheduledTask -TaskName $mine -ErrorAction SilentlyContinue))
    Yes 'and with only another run''s task there, this run counts as clean, so runs side by side do not fail each other (#2323)' (NoRealTask)
} catch {
    Yes ('the decoy scene could register its tasks: ' + $_.Exception.Message) $false
} finally {
    foreach ($n in $decoy, $mine) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }
}
Yes 'and the scene left no task of its own behind' (
    $null -eq (Get-ScheduledTask -TaskName $decoy -ErrorAction SilentlyContinue) -and
    $null -eq (Get-ScheduledTask -TaskName $mine -ErrorAction SilentlyContinue))
function Sha([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
# Every file and folder under a root and its hash, logs left out: a server
# that ran appends to them, and they are carried across on purpose.
function Tree([string]$dir) {
    if (-not (Test-Path -LiteralPath $dir)) { return '(none)' }
    $rows = @()
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force)) {
        if ($f.Name -match '\.log(\.\d+)?$') { continue }
        $rows += ($f.FullName.Substring($dir.Length) + '|' + (Sha $f.FullName))
    }
    foreach ($d in @(Get-ChildItem -LiteralPath $dir -Recurse -Directory -Force)) { $rows += ($d.FullName.Substring($dir.Length) + '|folder') }
    return (($rows | Sort-Object) -join "`n")
}
function Beside([string]$kind) {
    return @(Get-ChildItem -LiteralPath $box -Directory -Force | Where-Object { $_.Name -like ('Thornswood-Server' + $kind) } |
             Sort-Object Name | ForEach-Object { $_.FullName })
}
# A root's settings, and the keys of one that another does not have the same,
# leaving out the four a release is meant to change (ServerSettings.ps1).
function SettingsOf([string]$dir) { return ((Get (Join-Path $dir 'server-settings.json')) | ConvertFrom-Json) }
function Js($v) { if ($null -eq $v) { return 'null' }; return (ConvertTo-Json -InputObject $v -Compress -Depth 20) }
function Carried($was, $now) {
    $release = @('loadOrder', 'startPoints', 'thornswoodMostOnline', 'maxPlayers')
    $a = @($was.PSObject.Properties | ForEach-Object { $_.Name })
    $b = @($now.PSObject.Properties | ForEach-Object { $_.Name })
    return @(@($a + $b | Sort-Object -Unique) | Where-Object {
        $release -notcontains $_ -and (($a -contains $_) -ne ($b -contains $_) -or (Js $was.$_) -ne (Js $now.$_)) })
}
function Free([int]$p) {
    (-not @(Get-NetUDPEndpoint -LocalPort $p -EA SilentlyContinue).Count) -and
    (-not @(Get-NetTCPConnection -LocalPort $p -EA SilentlyContinue).Count)
}
function Owner([int]$port) {
    $e = @(Get-NetUDPEndpoint -LocalPort $port -EA SilentlyContinue)
    if ($e.Count) { return [int]$e[0].OwningProcess }
    return 0
}
function Answers([int]$port) {
    if (-not (Owner $port)) { return $false }
    $res = if ($port -eq 7777) { 3000 } else { $port + 1 }
    $ok = $false
    try {
        $c = New-Object Net.Sockets.TcpClient
        $null = $c.BeginConnect('127.0.0.1', $res, $null, $null).AsyncWaitHandle.WaitOne(500)
        $ok = $c.Connected
        $c.Close()
    } catch { }
    return $ok
}
function WaitUp([int]$port) {
    for ($i = 0; $i -lt 40; $i++) { if (Answers $port) { return $true }; Start-Sleep -Milliseconds 250 }
    return $false
}
# A game port for a stub server, with the port above it for its resources:
# the stub binds UDP on the first and listens on TCP on the second, as
# skymp5-server does. Not within two of one this run already took ($avoid).
# 0 when fifty tries find none. Every server below takes its ports from here:
# the installs, the scratch root's other server, and the Publish-Server runs,
# which until #1728 needed the dev and live servers' own ports.
#
# BELOW THE RANGE WINDOWS HANDS OUT, AND PROVED BY BINDING BOTH (#2323). The
# dev and live pairs used to be asked of the system (UdpClient(0)), which
# answers from the dynamic range, 49152 and up. Two things there stopped a
# stub from ever answering, measured on One on 12 Oct:
#   - Windows reserves blocks of that range for TCP alone (netsh int ipv4 show
#     excludedportrange: 49709-49808, 50321-50420, 51343-51442, 63701-63800
#     and 63874-63973 that day). A UDP port handed out next to one has its
#     TCP port above inside it, nothing holds it, so "free" said yes, and the
#     stub's listen failed with EACCES.
#   - every outgoing connection on the machine takes its own port from the
#     same range, so the port above can be taken between the choice and the
#     start.
#   A start with either never answers. Of 35 stub starts that day, the same
#   cmd, roll-log and node chain the installer registers, on random ports in
#   that range, 3 never answered: the stub's log said EACCES on 49731, inside
#   49709-49808, and EACCES on 50426 with an established connection on it.
#   On 11 Oct the two live Publish-Server cases failed together in one run,
#   the way a live pair whose resources port cannot be listened on fails: the
#   first install had no old folder to go back to, so it was INSTALL FAILED
#   after the swap and the lock, and the one over it rolled back and kept its
#   .failed folder.
# So ports come from below the dynamic range, which no outgoing connection is
# given, and each pair is bound here, UDP and TCP the way the stub binds them,
# before it is handed out: a reserved block, wherever it is, refuses the bind.
$script:dynamicStart = 49152
try {
    $starts = @(@(Get-NetTCPSetting -ErrorAction Stop) + @(Get-NetUDPSetting -ErrorAction Stop) |
                ForEach-Object { [int]$_.DynamicPortRangeStartPort } | Where-Object { $_ -gt 0 } | Sort-Object)
    if ($starts.Count) { $script:dynamicStart = $starts[0] }
} catch { }
$script:portLow = 41000
$script:portTop = [Math]::Min(48000, $script:dynamicStart - 2)
$script:portRand = New-Object Random
function Bindable([int]$p) {
    if (-not ((Free $p) -and (Free ($p + 1)))) { return $false }
    $u = $null
    $t = $null
    try {
        $u = New-Object Net.Sockets.UdpClient((New-Object Net.IPEndPoint([Net.IPAddress]::Loopback, $p)))
        $t = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, ($p + 1))
        $t.Start()
        return $true
    } catch { return $false }
    finally {
        if ($t) { $t.Stop() }
        if ($u) { $u.Close() }
    }
}
function Pair([int[]]$avoid) {
    if ($script:portTop -le $script:portLow) { return 0 }
    for ($i = 0; $i -lt 50; $i++) {
        $p = $script:portRand.Next($script:portLow, $script:portTop)
        $near = @($avoid | Where-Object { [Math]::Abs($_ - $p) -le 2 }).Count
        if ($near -eq 0 -and (Bindable $p)) { return $p }
    }
    return 0
}
# The case measured: a TCP block Windows reserved, with nothing in it for
# "free" to see. A pair whose resources port is the block's first is not
# handed out. A machine with no such block has nothing to show it on.
$blocks = @()
try {
    foreach ($l in @(& netsh int ipv4 show excludedportrange protocol=tcp 2>$null)) {
        $m = [regex]::Match([string]$l, '^\s*(\d+)\s+(\d+)')
        if ($m.Success) { $blocks += [int]$m.Groups[1].Value }
    }
} catch { }
$blockAt = @($blocks | Where-Object { $_ -gt 1025 -and $_ -lt 65535 -and (Free ($_ - 1)) -and (Free $_) } | Select-Object -First 1)
if ($blockAt.Count) {
    Yes ("a pair whose resources port is in a block Windows keeps for TCP ({0}) is not handed out, though nothing holds it (#2323)" -f $blockAt[0]) (
        -not (Bindable ($blockAt[0] - 1)))
} else {
    Write-Host 'SKIP  no TCP block is kept on this machine, so the refusal of one is not shown here'
}
$probe = Pair @()
Yes ('a pair is handed out below the range outgoing connections take ports from, which starts at ' + $script:dynamicStart) (
    $probe -ge $script:portLow -and ($probe + 1) -lt $script:dynamicStart)

# The task scheduler, for the far side. A task is a file holding its action;
# starting it starts that action, the real cmd.exe line, and stopping it ends
# the process it started and nothing under it, as Task Scheduler does.
$prelude = @'
# Loaded first, on purpose. It is a module of functions, and loaded part way
# through a script, by the first use of New-ScheduledTaskAction, it is put
# where it hides the stand-ins below; loaded here, the stand-ins are found
# first. Without this the real Register-ScheduledTask ran and registered a
# real task on the machine running this, which the harness now checks for.
Import-Module ScheduledTasks -ErrorAction SilentlyContinue
if (-not (Get-Module ScheduledTasks)) { 'THE TASK MODULE DID NOT LOAD, SO THE STAND-INS CANNOT BE TRUSTED'; exit 98 }
# And every command of it the scripts use is a stand-in too, so nothing in
# them can load it again part way through and bring the real ones back.
function New-ScheduledTaskAction { [CmdletBinding()] param([string]$Execute, [string]$Argument, [string]$WorkingDirectory) [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory } }
function New-ScheduledTaskTrigger { [CmdletBinding()] param([switch]$AtStartup, [switch]$Once, $At, $RepetitionInterval) [pscustomobject]@{ AtStartup = [bool]$AtStartup } }
function New-ScheduledTaskSettingsSet { [CmdletBinding()] param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, [switch]$StartWhenAvailable, $RestartCount, $RestartInterval, $ExecutionTimeLimit, $Priority) [pscustomobject]@{ RestartCount = $RestartCount; ExecutionTimeLimit = 'PT0S'; Priority = $Priority } }
function New-ScheduledTaskPrincipal { [CmdletBinding()] param([string]$UserId, $LogonType, $RunLevel, $RequiredPrivilege, $ProcessTokenSidType) [pscustomobject]@{ UserId = $UserId; RunLevel = [string]$RunLevel } }
$env:TS_PIDLOG = '@@PIDLOG@@'
$TsTasks = '@@TASKS@@'
function TsTaskFile([string]$n) { Join-Path $TsTasks (($n -replace '[^A-Za-z0-9]', '_') + '.json') }
function TsRead([string]$n) { $f = TsTaskFile $n; if (Test-Path -LiteralPath $f) { return ([IO.File]::ReadAllText($f) | ConvertFrom-Json) }; return $null }
function TsWrite([string]$n, $t) { [IO.File]::WriteAllText((TsTaskFile $n), ($t | ConvertTo-Json -Depth 4)) }
function Get-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  $t = TsRead $TaskName
  if (-not $t) { return }
  [pscustomobject]@{ TaskName = $TaskName; State = 'Ready'
    Actions = @([pscustomobject]@{ Execute = $t.Execute; Arguments = $t.Argument; WorkingDirectory = $t.WorkingDirectory })
    Principal = [pscustomobject]@{ UserId = 'SYSTEM'; RunLevel = 'Highest' }; Settings = $null }
}
function Register-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName, $Action, $Trigger, $Settings, $Principal, [string]$Xml, [string]$User, [string]$RunLevel)
  $t = [ordered]@{ Execute = ''; Argument = ''; WorkingDirectory = ''; Pid = 0 }
  if ($Xml) {
    $x = [xml]$Xml
    $e = $x.Task.Actions.Exec
    $t.Execute = [string]$e.Command; $t.Argument = [string]$e.Arguments; $t.WorkingDirectory = [string]$e.WorkingDirectory
  } else {
    $a = @($Action)[0]
    $t.Execute = [string]$a.Execute; $t.Argument = [string]$a.Arguments; $t.WorkingDirectory = [string]$a.WorkingDirectory
  }
  TsWrite $TaskName $t
}
function Set-ScheduledTask {
  [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$InputObject)
  process {
    $t = TsRead $InputObject.TaskName
    $a = @($InputObject.Actions)[0]
    $n = [ordered]@{ Execute = [string]$a.Execute; Argument = [string]$a.Arguments; WorkingDirectory = [string]$a.WorkingDirectory; Pid = 0 }
    if ($t) { $n.Pid = $t.Pid }
    TsWrite $InputObject.TaskName $n
  }
}
function Unregister-ScheduledTask {
  [CmdletBinding(SupportsShouldProcess = $true)] param([string]$TaskName)
  Remove-Item -LiteralPath (TsTaskFile $TaskName) -Force -EA SilentlyContinue
}
function Export-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  $t = TsRead $TaskName
  if (-not $t) { return }
  $x = New-Object xml
  $task = $x.AppendChild($x.CreateElement('Task'))
  $exec = $task.AppendChild($x.CreateElement('Actions')).AppendChild($x.CreateElement('Exec'))
  foreach ($k in @(@('Command', $t.Execute), @('Arguments', $t.Argument), @('WorkingDirectory', $t.WorkingDirectory))) {
    $null = $exec.AppendChild($x.CreateElement($k[0])).AppendChild($x.CreateTextNode([string]$k[1]))
  }
  $x.OuterXml
}
function Start-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  $t = TsRead $TaskName
  if (-not $t) { return }
  $p = Start-Process -FilePath $t.Execute -ArgumentList $t.Argument -WorkingDirectory $t.WorkingDirectory -WindowStyle Hidden -PassThru
  [IO.File]::AppendAllText($env:TS_PIDLOG, [string]$p.Id + "`n")
  $n = [ordered]@{ Execute = $t.Execute; Argument = $t.Argument; WorkingDirectory = $t.WorkingDirectory; Pid = $p.Id }
  TsWrite $TaskName $n
}
function Stop-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  $t = TsRead $TaskName
  if ($t -and $t.Pid) { Stop-Process -Id ([int]$t.Pid) -Force -EA SilentlyContinue }
  # A case can have something happen at the moment the server is stopped,
  # once: the settings moving under an install between its stage and its swap.
  if ($env:TS_ON_STOP -and (Test-Path -LiteralPath $env:TS_ON_STOP_ONCE)) {
    Remove-Item -LiteralPath $env:TS_ON_STOP_ONCE -Force
    & ([scriptblock]::Create($env:TS_ON_STOP))
  }
}
function Get-ScheduledTaskInfo { [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$InputObject) process { [pscustomobject]@{ LastTaskResult = 0 } } }
function Get-NetFirewallRule { }
function New-NetFirewallRule { }
function Remove-NetFirewallRule { }
foreach ($n in 'Get-ScheduledTask', 'Register-ScheduledTask', 'Start-ScheduledTask', 'Stop-ScheduledTask',
               'Unregister-ScheduledTask', 'Set-ScheduledTask', 'Export-ScheduledTask', 'New-NetFirewallRule',
               'New-ScheduledTaskAction', 'New-ScheduledTaskTrigger', 'New-ScheduledTaskSettingsSet', 'New-ScheduledTaskPrincipal') {
  $c = Get-Command $n
  if ($c.CommandType -ne 'Function' -or $c.Source) { 'THE STAND-IN FOR ' + $n + ' IS NOT THE ONE FOUND'; exit 97 }
}

'@
$prelude = $prelude.Replace('@@PIDLOG@@', $pidLog.Replace("'", "''")).Replace('@@TASKS@@', $tasks.Replace("'", "''"))

# Everything the stand-ins below read is in $global:TsBox, not in a variable
# of this script: they run inside the script under test, and PowerShell
# finds that script's own variables first (its Remote has a $far of its own).
$global:TsBox = [pscustomobject]@{ Far = $far; Prelude = $prelude; Work = $work; BoxPs = $boxPs; Box = $box }
function RunWrapped([string]$body) {
    $f = Join-Path $global:TsBox.Far ('far-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, ($global:TsBox.Prelude + $body), (New-Object Text.UTF8Encoding($true)))
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location -LiteralPath $global:TsBox.Work
    try { $out = @(& $global:TsBox.BoxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_".TrimEnd() }) }
    finally { Pop-Location; $ErrorActionPreference = $eap }
    $script:lastCode = $LASTEXITCODE
    $global:TsLastCode = $LASTEXITCODE
    $script:lastOut = $out
    if (-not (NoRealTask)) { Yes 'no real scheduled task was touched' $false; throw 'a real scheduled task was registered, and has been removed' }
    return $out
}
function Show { foreach ($l in $script:lastOut) { Write-Host ('        ' + $l) } }

# The installer, the way Publish-Server has the box run it.
function Install([string]$zip, [string[]]$more) {
    $a = "-Zip '" + $zip.Replace("'", "''") + "' -Root '" + $root.Replace("'", "''") + "' -TaskName '$TaskPrefix Server' -StartNow -AllowGamingPc -Wait 8 " + ($more -join ' ')
    return (RunWrapped ("& '" + $installer.Replace("'", "''") + "' " + $a + "`r`nexit `$LASTEXITCODE`r`n"))
}

# The server in a payload: skymp5-server.js as the task starts it, from the
# root, with its output going to server.log through cmd.
$stubJs = @'
const fs = require('fs');
const dgram = require('dgram');
const net = require('net');
try { fs.appendFileSync(process.env.TS_PIDLOG, process.pid + '\n'); } catch (e) { }
const root = process.cwd();
const gm = fs.readFileSync('gamemode.js', 'utf8');
if (gm.indexOf('will-not-start') >= 0) { console.log('Error: this gamemode will not start'); process.exit(1); }
const s = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
const res = s.port === 7777 ? 3000 : s.port + 1;
dgram.createSocket('udp4').bind(s.port, '127.0.0.1');
if (gm.indexOf('udp-only') < 0) { net.createServer(function (c) { c.end(); }).listen(res, '127.0.0.1'); }
console.log('listening on ' + s.port);
setTimeout(function () { process.exit(0); }, 600000);
'@

$script:zipN = 0
# The server files the fork builds besides the binary and the JavaScript half
# (ServerBuild.ps1), as a payload carries them.
$forkRest = [ordered]@{ 'dist_back/skymp5-server.js.map' = '{ "version": 3 }'; 'package.json' = '{ "name": "skymp5-server" }'; 'yarn.lock' = '# yarn'
                        'launch_server.bat' = 'node dist_back/skymp5-server.js'; 'data/scripts/ActiveMagicEffect.pex' = 'compiled papyrus' }
function TextSha([string]$text) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (($h.ComputeHash($utf8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}
# The record of a build whose binary says $Binary and whose JavaScript half is
# $Js, the way New-ServerBuildRecord.ps1 writes one: every file, one commit.
function RecordText([string]$Binary, [string]$Js = $stubJs) {
    $c = 'abcdef0123456789abcdef0123456789abcdef01'
    $files = [ordered]@{}
    $files['scam_native.node'] = [ordered]@{ sha256 = (TextSha $Binary); bytes = 1; commit = $c }
    $files['dist_back/skymp5-server.js'] = [ordered]@{ sha256 = (TextSha $Js); bytes = 1; commit = $c }
    foreach ($k in $forkRest.Keys) { $files[$k] = [ordered]@{ sha256 = (TextSha $forkRest[$k]); bytes = 1; commit = $c } }
    return ([ordered]@{ binary = 'scam_native.node'; sha256 = (TextSha $Binary); bytes = 1; source = [ordered]@{ commit = $c }; files = $files } | ConvertTo-Json -Depth 5)
}
# A payload as Export-ServerPayload makes one: the load order written out in
# full under the root it is for, and every server file with its record.
# -RecordFor and -RecordJs make a record of another binary or JavaScript half.
# -GamemodeFrom copies a gamemode in (the artifact's, for Publish-Server, #459)
# and -StampFor writes the build stamp naming it for that channel; both default
# to what the Publish-Server runs below set.
$script:PayloadGamemodeFrom = ''
$script:PayloadStampFor = ''
function Payload {
    param([string]$Gamemode = '// v2', [string[]]$Order = @('Skyrim.esm', 'A.esp'), [string[]]$Carry = @('Skyrim.esm', 'A.esp'),
          [string]$Binary = 'binary v2', [string]$RecordFor = '', [string]$RecordJs = '', [string]$Shipped = 'shipped v2', [int]$Port = $P,
          [string]$ForRoot = $root, [hashtable]$Settings = @{}, [switch]$NoRecord, [string]$Stray = '', [string]$Js = '', [switch]$NoPass,
          [string]$GamemodeFrom = $script:PayloadGamemodeFrom, [string]$StampFor = $script:PayloadStampFor)
    $script:zipN++
    $dir = Join-Path $work ('payload-' + $script:zipN)
    foreach ($n in $Carry) { Put (Join-Path $dir ('plugins\' + $n)) ('plugin ' + $n) }
    if ($GamemodeFrom) {
        $null = [IO.Directory]::CreateDirectory($dir)
        Copy-Item -LiteralPath $GamemodeFrom -Destination (Join-Path $dir 'gamemode.js') -Force
    } else { Put (Join-Path $dir 'gamemode.js') $Gamemode }
    # Its tables (#5191): the artifact's beside its gamemode.js, or one of
    # the harness's own, since the installer refuses a payload with none.
    $tablesFrom = if ($GamemodeFrom) { Join-Path (Split-Path -Parent $GamemodeFrom) 'gamemode-tables' } else { '' }
    if ($tablesFrom -and (Test-Path -LiteralPath $tablesFrom)) { Copy-Item -LiteralPath $tablesFrom -Destination (Join-Path $dir 'gamemode-tables') -Recurse -Force }
    else { Put (Join-Path $dir 'gamemode-tables\WAY_OUT.json') '{}' }
    if ($StampFor) {
        Put (Join-Path $dir 'thornswood-build.json') (([ordered]@{ channel = $StampFor; commit = 'harness'; gamemodeMatchesCommit = $true
                                                                  gamemodeSha256 = (Sha (Join-Path $dir 'gamemode.js')) }) | ConvertTo-Json)
    }
    if (-not $Js) { $Js = $stubJs }
    Put (Join-Path $dir 'dist_back\skymp5-server.js') $Js
    Put (Join-Path $dir 'scam_native.node') $Binary
    foreach ($k in $forkRest.Keys) { Put (Join-Path $dir ($k -replace '/', '\')) $forkRest[$k] }
    if ($Stray) { Put (Join-Path $dir ($Stray -replace '/', '\')) '// from another build' }
    if (-not $RecordFor) { $RecordFor = $Binary }
    if (-not $RecordJs) { $RecordJs = $Js }
    if (-not $NoRecord) { Put (Join-Path $dir 'server-build.json') (RecordText $RecordFor $RecordJs) }
    Put (Join-Path $dir 'data\shipped.txt') $Shipped
    $far = ($ForRoot -replace '\\', '/') + '/plugins/'
    $st = [ordered]@{ port = $Port; name = 'Thornswood Test'; dataDir = 'data'; loadOrder = @($Order | ForEach-Object { $far + $_ }) }
    # A join pass switch, so a first install of it is not refused (#1804).
    # No build carries one since #1223; -NoPass is that payload.
    if (-not $NoPass) { $st['thornswoodRequirePass'] = $true }
    foreach ($k in $Settings.Keys) { $st[$k] = $Settings[$k] }
    Put (Join-Path $dir 'server-settings.json') ($st | ConvertTo-Json -Depth 8)
    $zip = Join-Path $work ('payload-' + $script:zipN + '.zip')
    Compress-Archive -Path (Join-Path $dir '*') -DestinationPath $zip -Force
    return $zip
}

try {
    $P = Pair @()
    Yes ("a game port for the installs, {0}, and {1} above it, both bound and let go below the dynamic range, which starts at {2}" -f $P, ($P + 1), $script:dynamicStart) ($P -gt 0)
    if (-not $P) { throw ('no pair of ports from {0} to {1} could be bound, so no stub server can start' -f $script:portLow, $script:portTop) }

    # ---- a first install ---------------------------------------------------
    $v1 = Payload -Gamemode '// v1' -Binary 'binary v1' -Shipped 'shipped v1'
    $out = Install $v1 @()
    $failed = $script:fail
    Yes 'a first install is INSTALL OK' ($out -contains 'INSTALL OK')
    Yes '  and the server answers on both its ports' (WaitUp $P)
    Yes '  and what the payload shipped into data is written down' ((Get (Join-Path $root '.payload-data.txt')) -match 'shipped\.txt')
    Yes '  and an empty private folder is made, with a line saying so' (
        (Test-Path -LiteralPath (Join-Path $root 'private')) -and (($out -join "`n") -match 'no roster to restore'))
    Yes '  and no stage is left beside it' (@(Beside '.stage-*').Count -eq 0)
    if ($script:fail -gt $failed) { Show }

    # ---- a scratch root whose settings name another server's port ------------
    # RESTORING.md in the ops repo installs into C:\Thornswood-RestoreTest\server with
    # -NoTask, from a payload whose settings are the live server's. The stop
    # must be by this root's own processes: the one on that port is live.
    $Q = Pair @($P)
    if (-not $Q) { throw ('no second pair of ports from {0} to {1} could be bound, so the other server cannot start' -f $script:portLow, $script:portTop) }
    $other = Join-Path $work 'other-server'
    Put (Join-Path $other 'gamemode.js') '// the other server'
    Put (Join-Path $other 'server-settings.json') ((@{ port = $Q; name = 'other' }) | ConvertTo-Json)
    Put (Join-Path $work 'other-stub.js') $stubJs
    $env:TS_PIDLOG = $pidLog
    $o = Start-Process -FilePath $node.Source -ArgumentList ('"' + (Join-Path $work 'other-stub.js') + '"') -WorkingDirectory $other -WindowStyle Hidden -PassThru
    $scratch = Join-Path $box 'RestoreTest\server'
    $saveRoot = $root
    try {
        $script:otherUp = WaitUp $Q
        $root = $scratch
        foreach ($n in 1..2) {
            $a = "-Zip '" + (Payload -Port $Q -ForRoot $scratch).Replace("'", "''") + "' -Root '" + $scratch.Replace("'", "''") + "' -NoTask -AllowGamingPc`r`nexit `$LASTEXITCODE`r`n"
            $out = RunWrapped ("& '" + $installer.Replace("'", "''") + "' " + $a)
        }
    } finally { $root = $saveRoot }
    $failed = $script:fail
    Yes '-NoTask into a scratch root is INSTALL OK, twice over' ($out -contains 'INSTALL OK')
    Yes '  and the other server on the port its settings name was never stopped' ($script:otherUp -and ((Owner $Q) -eq $o.Id) -and (Answers $Q))
    if ($script:fail -gt $failed) { Show }

    # What a server that has been running has, that no payload brings.
    Put (Join-Path $root 'world\w.txt') 'every character'
    # The door a live server has: an address, a key and a join pass key, all
    # made up here. Since #1807 (#1336) a dev publish carries the key and the
    # join pass key from this file to the dev door and stops, DOOR NOT
    # CARRIED, when any of the three is missing; a door with only a site
    # stopped both dev publishes below (#1905).
    $liveDoor = [ordered]@{ site = 'https://door.harness.invalid'; key = 'harness-door-key-not-a-real-one'; passKey = 'harness-pass-key-not-a-real-one' }
    Put (Join-Path $root 'private\door.json') ($liveDoor | ConvertTo-Json)
    Put (Join-Path $root 'data\book.txt') 'the character book'
    Put (Join-Path $root 'thornswood.log') 'the gamemode log'
    $before = Tree $root
    $running = Owner $P

    # ---- refusals: nothing stops, nothing moves ----------------------------
    foreach ($case in @(
        @{ Label = 'a payload naming a plugin it does not carry'; Why = 'not in the payload or on disk';
           Zip = { Payload -Order @('Skyrim.esm', 'A.esp', 'Nowhere.esp') }; More = @() },
        @{ Label = 'a zip that arrived different from what was sent'; Why = 'arrived different from what was sent';
           Zip = { Payload }; More = @('-ZipSha256 00112233') },
        @{ Label = 'a gamemode that does not parse'; Why = 'gamemode\.js does not parse';
           Zip = { Payload -Gamemode 'function ( { not javascript' }; More = @() },
        @{ Label = 'a binary that is not its recorded build'; Why = 'not the build server-build\.json records';
           Zip = { Payload -RecordFor 'some other binary' }; More = @() },
        @{ Label = 'a payload that carries no build record (#1214)'; Why = 'carries no server-build\.json';
           Zip = { Payload -NoRecord }; More = @() },
        @{ Label = 'a JavaScript half that is not its recorded build (#1214)'; Why = 'dist_back/skymp5-server\.js in the payload is not the build server-build\.json records';
           Zip = { Payload -RecordJs '// the 24 Sep JavaScript half' }; More = @() },
        @{ Label = 'a server file its record does not list (#1214)'; Why = 'dist_back/old-bundle\.js in the payload is a server file server-build\.json does not list';
           Zip = { Payload -Stray 'dist_back/old-bundle.js' }; More = @() }
    )) {
        $zip = & $case.Zip
        $out = Install $zip $case.More
        $failed = $script:fail
        $label = $case.Label
        Yes "$label is INSTALL REFUSED" (($out -contains 'INSTALL REFUSED') -and $script:lastCode -ne 0)
        Yes '  and it says why' (($out -join "`n") -match $case.Why)
        Yes '  and the root is byte for byte as it was, with no stage left' (((Tree $root) -eq $before) -and @(Beside '.stage-*').Count -eq 0)
        $ownerNow = Owner $P; $ans = Answers $P
        # Which half failed, said in the line, so a failure on a runner is measured (#1273).
        Yes ('  and the same server process is still answering (process ' + $ownerNow + ', was ' + $running + '; answers ' + $ans + ')') (($ownerNow -eq $running) -and $ans)
        if ($script:fail -gt $failed) { Show }
    }

    # ---- a payload that does not start -------------------------------------
    $bad = Payload -Gamemode '// v3, will-not-start'
    $out = Install $bad @()
    $failed = $script:fail
    Yes 'a payload that does not start is INSTALL ROLLED BACK' (($out -contains 'INSTALL ROLLED BACK') -and $script:lastCode -ne 0)
    Yes '  and says why from its log' (($out -join "`n") -match 'this gamemode will not start')
    Yes '  and the old root is back as it was, world, roster and runtime data included' ((Tree $root) -eq $before)
    Yes '  and the old server is answering again, as a new process' ((WaitUp $P) -and ((Owner $P) -ne $running))
    $kept = @(Beside '.failed-*')
    Yes '  and the new one is kept to read, beside it' ($kept.Count -eq 1 -and (Get (Join-Path $kept[0] 'gamemode.js')) -match 'will-not-start')
    Yes '  and no .prev is left, since the old root is the root again' (@(Beside '.prev-*').Count -eq 0)
    Yes '  and the logs came back with it, the failed start in them' ((Get (Join-Path $root 'server.log')) -match 'will not start')
    if ($script:fail -gt $failed) { Show }

    # ---- a good one ----------------------------------------------------------
    # The site's read on the root's files and on data's, which Deploy-Docs.ps1
    # puts on the folder going out (issue #1105): carried across by name.
    # Only the access rules are written back, the way the scripts do it since
    # #1120 (Set-ThornswoodAclAccess in Bot-Service.ps1). Set-Acl, when its
    # first try is refused, keeps the audit part whenever the folder's own
    # rules are protected, which the installer has just made them, and the
    # audit part needs SeSecurityPrivilege: an Administrator has it, and the
    # build runner's account never will. On the runner that stopped this
    # harness here (#1880).
    foreach ($d in $root, (Join-Path $root 'data')) {
        $acl = Get-Acl -LiteralPath $d
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-19')), 'Read', 'ObjectInherit', 'NoPropagateInherit', 'Allow')))
        $item = Get-Item -LiteralPath $d -Force
        [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, [Security.AccessControl.DirectorySecurity]$acl)
    }
    $running = Owner $P
    $v2 = Payload
    $out = Install $v2 @()
    $failed = $script:fail
    $broadOn = { param($p) @((Get-Acl -LiteralPath $p).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11') -contains $_.IdentityReference.Value }).Count }
    Yes '  and no Users rule reaches the root, data, the world or private\door.json (#1105)' (
        (Get-Acl -LiteralPath $root).AreAccessRulesProtected -and
        @($root, (Join-Path $root 'data\shipped.txt'), (Join-Path $root 'world\w.txt'), (Join-Path $root 'private\door.json') | Where-Object { (& $broadOn $_) -gt 0 }).Count -eq 0)
    Yes '  and private takes nothing from the root' ((Get-Acl -LiteralPath (Join-Path $root 'private')).AreAccessRulesProtected)
    Yes '  and the site''s rules on the root and data came across with it' (
        @((Get-Acl -LiteralPath $root).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq 'S-1-5-19' }).Count -eq 1 -and
        @((Get-Acl -LiteralPath (Join-Path $root 'data')).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq 'S-1-5-19' }).Count -eq 1)
    Yes 'a good payload is INSTALL OK' ($out -contains 'INSTALL OK')
    Yes '  and the new gamemode and binary are live, and answering as a new process' (
        (Get (Join-Path $root 'gamemode.js')) -eq '// v2' -and (Get (Join-Path $root 'scam_native.node')) -eq 'binary v2' -and
        (WaitUp $P) -and ((Owner $P) -ne $running))
    Yes '  and the world and the roster were carried across' (
        (Get (Join-Path $root 'world\w.txt')) -eq 'every character' -and (Get (Join-Path $root 'private\door.json')) -match 'site')
    Yes '  and the runtime data came too, while what the payload ships is the new one' (
        (Get (Join-Path $root 'data\book.txt')) -eq 'the character book' -and (Get (Join-Path $root 'data\shipped.txt')) -eq 'shipped v2')
    Yes '  and the logs were carried, not deleted' ((Get (Join-Path $root 'thornswood.log')) -eq 'the gamemode log')
    $prev = @(Beside '.prev-*')
    Yes '  and the old root is kept beside it as .prev, with what it shipped' (
        $prev.Count -eq 1 -and (Get (Join-Path $prev[0] 'gamemode.js')) -eq '// v1' -and
        (Get (Join-Path $prev[0] 'data\shipped.txt')) -eq 'shipped v1')
    # Only with the one .prev there: a run that failed left none, and indexing
    # it would end every case after this one (#1273).
    Yes '  and without the world, which moved rather than being copied' (
        $prev.Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $prev[0] 'world')))
    if ($script:fail -gt $failed) { Show }

    # ---- -PutBack --------------------------------------------------------------
    Put (Join-Path $root 'world\w2.txt') 'a character made since'
    $running = Owner $P
    $out = RunWrapped ("& '" + $installer.Replace("'", "''") + "' -Root '" + $root.Replace("'", "''") +
                       "' -TaskName '$TaskPrefix Server' -StartNow -AllowGamingPc -Wait 8 -PutBack`r`nexit `$LASTEXITCODE`r`n")
    $failed = $script:fail
    Yes '-PutBack is INSTALL OK' ($out -contains 'INSTALL OK')
    Yes '  and the old gamemode is live again, answering as a new process' (
        (Get (Join-Path $root 'gamemode.js')) -eq '// v1' -and (WaitUp $P) -and ((Owner $P) -ne $running))
    Yes '  and the world it runs is the current one, with what was made since' ((Get (Join-Path $root 'world\w2.txt')) -eq 'a character made since')
    $undone = @(Beside '.undone-*')
    Yes '  and what it took out is kept as .undone, and the .prev it put back is gone' (
        $undone.Count -eq 1 -and (Get (Join-Path $undone[0] 'gamemode.js')) -eq '// v2' -and @(Beside '.prev-*').Count -eq 0)
    if ($script:fail -gt $failed) { Show }

    # ---- -TaskOnly (#2491) -----------------------------------------------------
    # The task as an install before #2491 registered it, node started by cmd
    # with no start /high, which is what the box has. -TaskOnly registers the
    # installer's task again, restarts the server under it and changes no file.
    $taskFile = Join-Path $tasks ((($TaskPrefix + ' Server') -replace '[^A-Za-z0-9]', '_') + '.json')
    $tj = [IO.File]::ReadAllText($taskFile) | ConvertFrom-Json
    $tj.Argument = ([string]$tj.Argument).Replace('start "" /b /wait /high ', '').Replace(' & call exit %^errorlevel%', '')
    [IO.File]::WriteAllText($taskFile, ($tj | ConvertTo-Json -Depth 4))
    $gmWas = Get (Join-Path $root 'gamemode.js')
    $setWas = Get (Join-Path $root 'server-settings.json')
    $besideWas = @(Beside '.*').Count
    $running = Owner $P
    $taskOnly = "& '" + $installer.Replace("'", "''") + "' -Root '" + $root.Replace("'", "''") + "' -TaskName '$TaskPrefix Server' -StartNow -AllowGamingPc -Wait 8 -TaskOnly"
    $out = RunWrapped ($taskOnly + " -FreshWorld`r`nexit `$LASTEXITCODE`r`n")
    $failed = $script:fail
    Yes '-TaskOnly with -FreshWorld is INSTALL REFUSED, and the same server is still answering' (
        ($out -contains 'INSTALL REFUSED') -and $script:lastCode -ne 0 -and ((Owner $P) -eq $running))
    Yes '  and the task is left as it was' (([IO.File]::ReadAllText($taskFile) | ConvertFrom-Json).Argument -notlike '*/high*')
    $out = RunWrapped ($taskOnly + "`r`nexit `$LASTEXITCODE`r`n")
    Yes '-TaskOnly is INSTALL OK, answering as a new process' (($out -contains 'INSTALL OK') -and (WaitUp $P) -and ((Owner $P) -ne $running))
    Yes '  and the task starts node through start /high again, on server-log.js running the server (#2349), and hands its exit code back' (
        [string](([IO.File]::ReadAllText($taskFile) | ConvertFrom-Json).Argument) -like '*start "" /b /wait /high "*" "*\server-log.js" --log "*\server.log" --also thornswood.log dist_back/skymp5-server.js & call exit %^errorlevel%"')
    Yes '  and it reads node back at High' (($out -join "`n") -match 'node, pid \d+, runs at High priority')
    Yes '  and no file of the server changed, and nothing was set beside it' (
        (Get (Join-Path $root 'gamemode.js')) -eq $gmWas -and (Get (Join-Path $root 'server-settings.json')) -eq $setWas -and @(Beside '.*').Count -eq $besideWas)
    if ($script:fail -gt $failed) { Show }

    # ---- the running server's settings are its own (#1222) ----------------------
    # Dev rollout 6, 29 Sep: a publish put the build's settings over the dev
    # server's, and it came up not marked dev, with no load order refusal, no
    # join pass and an npcSettings default key that refused every NPC. Here
    # the running server has its own switches and the payload has none of
    # them, other values for some, and that default key.
    $own = SettingsOf $root
    foreach ($kv in @(
        @('name', 'Thornswood Own Name'), @('thornswoodServer', 'dev'), @('thornswoodLoadOrderRefuse', $true),
        @('thornswoodRequirePass', $true), @('thornswoodVoicePort', 7789), @('npcSettings', [pscustomobject]@{}),
        @('npcEnabled', $true), @('npcAllowCrimeFaction', $true), @('thornswoodMostOnline', 20), @('maxPlayers', 25),
        @('thornswoodSomethingNew', 'the server''s own'),
        @('startPoints', @([pscustomobject]@{ worldOrCell = '0x0119BAD4'; pos = @(1, 2, 3); angleZ = 180 })))) {
        $own | Add-Member -NotePropertyName $kv[0] -NotePropertyValue $kv[1] -Force
    }
    Put (Join-Path $root 'server-settings.json') ($own | ConvertTo-Json -Depth 8)
    $own = SettingsOf $root
    $theirs = @{ thornswoodServer = 'main'; thornswoodLoadOrderRefuse = $false; thornswoodMostOnline = 30; maxPlayers = 35
                 npcSettings = @{ default = @{ spawnInInterior = $true; spawnInExterior = $true } }; npcAllowCrimeFaction = $false
                 startPoints = @(@{ worldOrCell = '0x0219BAD4'; pos = @(1, 2, 3); angleZ = 180 }); thornswoodBuildOnly = 'not the server''s' }
    $running = Owner $P
    $out = Install (Payload -Gamemode '// v3 settings' -Order @('Skyrim.esm', 'A.esp', 'B.esp') -Carry @('Skyrim.esm', 'A.esp', 'B.esp') -Settings $theirs) @()
    $failed = $script:fail
    $after = SettingsOf $root
    Yes 'an install over a server with its own switches is INSTALL OK, answering as a new process' (
        ($out -contains 'INSTALL OK') -and (WaitUp $P) -and ((Owner $P) -ne $running))
    Yes ('  and every setting outside the release is the server''s own: ' + ((Carried $own $after) -join ', ')) ((Carried $own $after).Count -eq 0)
    Yes '  thornswoodServer, the load order refusal, the join pass, the voice port and the name among them' (
        $after.thornswoodServer -eq 'dev' -and $after.thornswoodLoadOrderRefuse -eq $true -and $after.thornswoodRequirePass -eq $true -and
        [int]$after.thornswoodVoicePort -eq 7789 -and $after.name -eq 'Thornswood Own Name' -and $after.npcAllowCrimeFaction -eq $true)
    Yes '  and the payload''s npcSettings default key did not reach it' (
        (Js $after.npcSettings) -eq '{}' -and -not ($after.PSObject.Properties.Name -contains 'thornswoodBuildOnly'))
    Yes '  while the load order, the start point and how many it holds are the release''s' (
        @($after.loadOrder).Count -eq 3 -and [int]$after.thornswoodMostOnline -eq 30 -and [int]$after.maxPlayers -eq 35 -and
        [string]@($after.startPoints)[0].worldOrCell -eq '0x0219BAD4')
    Yes '  and it says what it kept and what it read back' (
        (($out -join "`n") -match 'kept as the running server has them, not as the release had them: .*thornswoodServer') -and
        (($out -join "`n") -match 'read back: every setting outside this release is the one the server had'))
    if ($script:fail -gt $failed) { Show }

    # A put-back brings back the older release, not the older settings: a
    # switch changed since the install stays as the running server has it.
    $now = SettingsOf $root
    $now | Add-Member -NotePropertyName thornswoodRequirePass -NotePropertyValue $false -Force
    Put (Join-Path $root 'server-settings.json') ($now | ConvertTo-Json -Depth 8)
    $now = SettingsOf $root
    $out = RunWrapped ("& '" + $installer.Replace("'", "''") + "' -Root '" + $root.Replace("'", "''") +
                       "' -TaskName '$TaskPrefix Server' -StartNow -AllowGamingPc -Wait 8 -PutBack`r`nexit `$LASTEXITCODE`r`n")
    $failed = $script:fail
    $back = SettingsOf $root
    Yes '-PutBack after it is INSTALL OK, and the older release is back' (
        ($out -contains 'INSTALL OK') -and (Get (Join-Path $root 'gamemode.js')) -ne '// v3 settings' -and @($back.loadOrder).Count -eq 2 -and (WaitUp $P))
    Yes '  with the running server''s settings, the switch changed since included' (
        (Carried $now $back).Count -eq 0 -and $back.thornswoodRequirePass -eq $false -and $back.thornswoodServer -eq 'dev')
    Yes '  and how many it holds as the older release had it' ([int]$back.thornswoodMostOnline -eq 20 -and [int]$back.maxPlayers -eq 25)
    if ($script:fail -gt $failed) { Show }

    # Settings that move under an install, between its stage and its swap:
    # here the stand-in task scheduler turns the load order refusal off as the
    # server is stopped. The stage was made from the file before that, so the
    # read-back finds a switch that is not what the server had.
    $once = Join-Path $work 'on-stop-once'
    Put $once 'once'
    $env:TS_ON_STOP_ONCE = $once
    $env:TS_ON_STOP = ("`$p = '" + (Join-Path $root 'server-settings.json').Replace("'", "''") + "'`r`n" +
                       "`$j = [IO.File]::ReadAllText(`$p) | ConvertFrom-Json`r`n" +
                       "`$j | Add-Member -NotePropertyName thornswoodLoadOrderRefuse -NotePropertyValue `$false -Force`r`n" +
                       "[IO.File]::WriteAllText(`$p, (`$j | ConvertTo-Json -Depth 20))")
    $gmBefore = Get (Join-Path $root 'gamemode.js')
    $running = Owner $P
    try { $out = Install (Payload -Gamemode '// v6 moved under it') @() }
    finally { Remove-Item Env:\TS_ON_STOP, Env:\TS_ON_STOP_ONCE -ErrorAction SilentlyContinue }
    $failed = $script:fail
    $moved = SettingsOf $root
    Yes 'settings that moved between the stage and the swap are INSTALL ROLLED BACK' (($out -contains 'INSTALL ROLLED BACK') -and $script:lastCode -ne 0)
    Yes '  and it names the switch, before anything was started' (
        (($out -join "`n") -match 'read back: thornswoodLoadOrderRefuse would not be what the server had') -and
        -not (($out -join "`n") -match 'started, giving it'))
    Yes '  and the old folder is back, with the setting as the server had it when it stopped' (
        (Get (Join-Path $root 'gamemode.js')) -eq $gmBefore -and $moved.thornswoodLoadOrderRefuse -eq $false)
    Yes '  and the old server is answering again, as a new process' ((WaitUp $P) -and ((Owner $P) -ne $running))
    $kept = @(Beside '.failed-*')
    Yes '  and the folder that was refused is kept to read' ($kept.Count -ge 1 -and (Get (Join-Path $kept[-1] 'gamemode.js')) -eq '// v6 moved under it')
    if ($script:fail -gt $failed) { Show }

    # ---- a running server with no join pass switch (#1804) ---------------------
    # The gamemode reads a missing switch as on (#1319), so this server would
    # start holding the moment the new gamemode reached it. Refused before
    # anything stops, though the payload carries a switch: the running
    # server's settings are the ones carried. -RequirePass on goes through.
    $none = SettingsOf $root
    $none.PSObject.Properties.Remove('thornswoodRequirePass')
    Put (Join-Path $root 'server-settings.json') ($none | ConvertTo-Json -Depth 8)
    $none = SettingsOf $root
    $before = Tree $root
    $running = Owner $P
    $out = Install (Payload -Gamemode '// v7 no pass') @()
    $failed = $script:fail
    Yes 'an install over a server with no join pass switch is INSTALL REFUSED (#1804)' (($out -contains 'INSTALL REFUSED') -and $script:lastCode -ne 0)
    Yes '  and says which switch, and how to give one' (
        (($out -join "`n") -match 'thornswoodRequirePass is missing on this server') -and (($out -join "`n") -match 'Publish-Server\.ps1 -RequirePass on, or off'))
    Yes '  and the root is byte for byte as it was, with no stage left' (((Tree $root) -eq $before) -and @(Beside '.stage-*').Count -eq 0)
    $ownerNow = Owner $P; $ans = Answers $P
    # Which half failed, said in the line, so a failure on a runner is measured (#1273).
    Yes ('  and the same server process is still answering (process ' + $ownerNow + ', was ' + $running + '; answers ' + $ans + ')') (($ownerNow -eq $running) -and $ans)
    if ($script:fail -gt $failed) { Show }
    $out = Install (Payload -Gamemode '// v7 pass on') @('-RequirePass on')
    $failed = $script:fail
    $after = SettingsOf $root
    Yes '  and with -RequirePass on it is INSTALL OK, answering as a new process' (
        ($out -contains 'INSTALL OK') -and (WaitUp $P) -and ((Owner $P) -ne $running) -and (Get (Join-Path $root 'gamemode.js')) -eq '// v7 pass on')
    Yes '  with the switch true, said, and read back as asked' (
        $after.thornswoodRequirePass -eq $true -and (($out -join "`n") -match 'set as this run asked: thornswoodRequirePass') -and
        (($out -join "`n") -match 'read back: every setting outside this release is the one the server had'))
    Yes ('  and every other setting the server''s own: ' + ((@(Carried $none $after) | Where-Object { $_ -ne 'thornswoodRequirePass' }) -join ', ')) (
        @(Carried $none $after | Where-Object { $_ -ne 'thornswoodRequirePass' }).Count -eq 0)
    if ($script:fail -gt $failed) { Show }

    # A first install has no server to keep settings from, so the payload's
    # are held to what no server should start with.
    $fresh = Join-Path $box 'Fresh\Thornswood-Server'
    $fz = Payload -ForRoot $fresh -Settings @{ npcSettings = @{ default = @{ spawnInInterior = $true; spawnInExterior = $true } } }
    $out = RunWrapped ("& '" + $installer.Replace("'", "''") + "' -Zip '" + $fz.Replace("'", "''") + "' -Root '" + $fresh.Replace("'", "''") +
                       "' -NoTask -AllowGamingPc`r`nexit `$LASTEXITCODE`r`n")
    $failed = $script:fail
    Yes 'a first install of a payload whose npcSettings has a default key is INSTALL REFUSED' (
        ($out -contains 'INSTALL REFUSED') -and (($out -join "`n") -match 'refuses every NPC') -and -not (Test-Path -LiteralPath $fresh))
    if ($script:fail -gt $failed) { Show }
    # And one with no join pass switch, as every build is since #1223 (#1804).
    $fz = Payload -ForRoot $fresh -NoPass
    $out = RunWrapped ("& '" + $installer.Replace("'", "''") + "' -Zip '" + $fz.Replace("'", "''") + "' -Root '" + $fresh.Replace("'", "''") +
                       "' -NoTask -AllowGamingPc`r`nexit `$LASTEXITCODE`r`n")
    $failed = $script:fail
    Yes 'a first install of a payload with no join pass switch is INSTALL REFUSED (#1804)' (
        ($out -contains 'INSTALL REFUSED') -and (($out -join "`n") -match 'thornswoodRequirePass is missing') -and
        (($out -join "`n") -match 'Publish-Server\.ps1 -RequirePass on, or off') -and -not (Test-Path -LiteralPath $fresh))
    $out = RunWrapped ("& '" + $installer.Replace("'", "''") + "' -Zip '" + $fz.Replace("'", "''") + "' -Root '" + $fresh.Replace("'", "''") +
                       "' -NoTask -AllowGamingPc -RequirePass off`r`nexit `$LASTEXITCODE`r`n")
    Yes '  and with -RequirePass off it is INSTALL OK, with the switch false' (
        ($out -contains 'INSTALL OK') -and (SettingsOf $fresh).thornswoodRequirePass -eq $false)
    if ($script:fail -gt $failed) { Show }

    # ---- a root something is holding -------------------------------------------
    $before = Tree $root
    $running = Owner $P
    $held = [IO.File]::Open((Join-Path $root 'world\w.txt'), 'Open', 'Read', 'None')
    try { $out = Install (Payload) @() } finally { $held.Close() }
    $failed = $script:fail
    Yes 'a root that cannot be moved aside is INSTALL REFUSED' (($out -contains 'INSTALL REFUSED') -and $script:lastCode -ne 0)
    # Tried once, saying the Windows error and what holds it (#2928): this
    # harness, which has the file open.
    Yes '  and says why, naming what holds it' (($out -join "`n") -match ('could not move .* \(0x8007[0-9A-F]{4}\); open under it then: .*pid ' + $PID + '\b'))
    Yes '  and the root is as it was, with no stage left' (((Tree $root) -eq $before) -and @(Beside '.stage-*').Count -eq 0)
    Yes '  and the old server was started again' ((WaitUp $P) -and ((Owner $P) -ne $running))
    if ($script:fail -gt $failed) { Show }

    # ---- -FreshWorld, and the newest two .prev -----------------------------------
    foreach ($n in 1..4) { Put (Join-Path $box ('Thornswood-Server.prev-20000101-00000' + $n + '\gamemode.js')) '// long ago' }
    $out = Install (Payload -Gamemode '// v4') @('-FreshWorld')
    $failed = $script:fail
    Yes '-FreshWorld is INSTALL OK and starts with no world' (($out -contains 'INSTALL OK') -and -not (Test-Path -LiteralPath (Join-Path $root 'world')))
    $prev = @(Beside '.prev-*')
    Yes '  and the old world is kept in the .prev it left' ($prev.Count -and (Get (Join-Path $prev[-1] 'world\w.txt')) -eq 'every character')
    Yes '  and the roster still came across' ((Get (Join-Path $root 'private\door.json')) -match 'site')
    Yes '  and only the newest two .prev folders are kept, not three (#1121)' (
        $prev.Count -eq 2 -and -not (Test-Path -LiteralPath (Join-Path $box 'Thornswood-Server.prev-20000101-000003')))
    if ($script:fail -gt $failed) { Show }

    # ---- Publish-Server.ps1, whole, on the dev channel ---------------------------
    # Publish-Server holds the payload to a game port and checks the answer on
    # the resources port. By default those are the dev server's own, 7787 and
    # 7788, which the dev server holds on the VPS where this runs; so this
    # takes a pair of its own and passes them (-GamePort, -ResourcesPort,
    # #1728). No pair to be had fails here rather than skipping.
    $D = Pair @($P, $Q)
    Yes ("a game port for the dev Publish-Server runs, {0}, and {1} above it, both bound and let go" -f $D, ($D + 1)) ($D -gt 0)
    if ($D -gt 0) {
        $devRoot = Join-Path $box 'Thornswood-Server-Dev'
        $dist = Join-Path $work 'dist'
        Put (Join-Path $dist 'server-settings.json') ((@{ port = 7777; name = 'Thornswood'; loadOrder = @('c:/x/Skyrim.esm') }) | ConvertTo-Json)
        Put (Join-Path $dist 'gamemode.js') '// the dist copy'
        $global:TsScpFail = ''

        # ssh and scp, for the box under $box. The fixed paths Publish-Server
        # names on C:\ land in the scratch folder, so the live root its door
        # seed reads private\door.json from is the scratch one, $root, with
        # the made-up door written above (#1905).
        # The deploy store and the site's folder land there too (#459), so
        # nothing here reaches the
        # box's own C:\Thornswood-Deploys or C:\Thornswood-Docs, which on the
        # VPS are real.
        function MapFar([string]$s) {
            foreach ($p in 'C:\Windows\Temp\', 'C:\thornswood-server.zip', 'C:\Install-ThornswoodServer.ps1', 'C:\ServerSettings.ps1', 'C:\ServerBuild.ps1', 'C:\ServerReadyWait.ps1', 'C:\Read-JsonFile.ps1', 'C:\RecordShape.ps1', 'C:\Server-Log.js', 'C:\Thornswood-Server\',
                           'C:\Thornswood-Deploys', 'C:\Thornswood-Docs') {
                $to = Join-Path $global:TsBox.Box $p.Substring(3)
                $s = $s.Replace($p, $to).Replace($p.Replace('\', '/'), $to)
            }
            return $s
        }
        function global:ssh {
            $in = @($input)
            $all = @($args | ForEach-Object { [string]$_ })
            $cmd = $all[-1]
            [void]$global:TsSshSeen.Add($cmd)
            $body = ''
            $m = [regex]::Match($cmd, 'EncodedCommand\s+(\S+)')
            if ($m.Success) { $body = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value)) }
            # A long script goes by scp to a copy of its own, which
            # Send-Script.ps1's runner takes off the box and runs (#3059), so
            # it is read from there and taken off the same way.
            $r = [regex]::Match($body, "^\`$ThornswoodRunFile = '(C:\\Windows\\Temp\\thornswood-remote-[0-9a-f]{32}\.ps1)'")
            if ($m.Success -and $r.Success) { $copy = MapFar $r.Groups[1].Value; $body = [IO.File]::ReadAllText($copy); Remove-Item -LiteralPath $copy -Force }
            else {
                $m = [regex]::Match($cmd, '-File\s+(\S+)(.*)$')
                if ($m.Success) {
                    # The zip goes in quotes: the scratch folder can hold an &.
                    $rest = $m.Groups[2].Value.Replace('C:\thornswood-server.zip', "'" + (Join-Path $global:TsBox.Box 'thornswood-server.zip').Replace("'", "''") + "'")
                    $body = "& '" + (MapFar $m.Groups[1].Value).Replace("'", "''") + "'" + $rest + " -AllowGamingPc`r`nexit `$LASTEXITCODE"
                }
                else {
                    $m = [regex]::Match($cmd, '-Command\s+(.*)$')
                    if ($m.Success) { $body = (MapFar $m.Groups[1].Value).Trim('"') }
                }
            }
            $out = RunWrapped (MapFar $body)
            foreach ($l in $out) { $l }
            $global:LASTEXITCODE = $global:TsLastCode
        }
        function global:scp {
            $all = @($args | ForEach-Object { [string]$_ })
            $src = $all[-2]; $dst = $all[-1]
            $m = [regex]::Match($dst, '^[^@\s]+@[^:\s]+:(.+)$')
            $global:LASTEXITCODE = 1
            if (-not $m.Success) { return }
            if ($global:TsScpFail -and $m.Groups[1].Value -match $global:TsScpFail) { return }
            $to = MapFar $m.Groups[1].Value
            if ($to -eq $m.Groups[1].Value) { return }
            Copy-Item -LiteralPath $src -Destination $to -Force
            $global:LASTEXITCODE = 0
        }
        $global:TsSshSeen = New-Object Collections.Generic.List[string]
        $null = [IO.Directory]::CreateDirectory((Join-Path $box 'Windows\Temp'))
        # A site on the stand-in box, so the deployed build is written (#2303).
        Put (Join-Path $box 'Thornswood-Docs\server.js') '// the site'
        $deploys = Join-Path $box 'Thornswood-Deploys'
        $siteBuild = Join-Path $box 'Thornswood-Docs\data\deployed-build.json'
        # The gamemode artifact this checkout makes, which Publish-Server
        # builds and holds the payload to (#459).
        $art = & { . (Join-Path $Here 'scripts\deploy\Artifact.ps1'); New-ThornswoodArtifact -Component gamemode -RepoDir $Here -Paths 'game/gamemode.js', 'game/gamemode-tables' }
        $artGm = Join-Path $art.Folder 'game\gamemode.js'
        $script:PayloadGamemodeFrom = $artGm
        $script:PayloadStampFor = 'dev'
        function Rec([string]$p) { $t = Get $p; if ($null -eq $t) { return $null }; return ($t | ConvertFrom-Json) }
        # The build record the payloads' binary is held to (#1214): Payload's
        # default binary.
        $recordFile = Join-Path $work 'server-build.json'
        Put $recordFile (RecordText 'binary v2')
        function Publish([string]$zip, [string[]]$more, [string]$channel = 'dev', [string]$vpsRoot = $devRoot, [string]$task = ($TaskPrefix + ' Dev'), [int]$port = $D) {
            $a = @{ Channel = $channel; VpsRoot = $vpsRoot; TaskName = $task; VpsHost = '127.0.0.1'; VpsUser = 'nobody'
                    Dist = $dist; Zip = $zip; SkipBuild = $true; NoPause = $true; Wait = 8; Record = $recordFile; NoNews = $true; NoPush = $true
                    GamePort = $port; ResourcesPort = ($port + 1) }
            foreach ($x in $more) { $a[$x] = $true }
            $global:TsSshSeen.Clear()
            $global:LASTEXITCODE = 0
            $said = @(& $publish @a *>&1 | ForEach-Object { "$_" })
            $script:lastOut = $said
            return $global:LASTEXITCODE
        }

        # The dev door after a publish, read back: the live key and join pass
        # key, and the live address with /dev on it, once (#1336, #1905).
        function DevDoorOk {
            $f = Join-Path $devRoot 'private\door.json'
            if (-not (Test-Path -LiteralPath $f)) { return $false }
            $d = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
            return ($d.key -eq $liveDoor.key -and $d.passKey -eq $liveDoor.passKey -and $d.site -eq ($liveDoor.site + '/dev'))
        }

        $code = Publish (Payload -Port $D -ForRoot $devRoot -Shipped 'shipped dev v1') @()
        $failed = $script:fail
        Yes 'Publish-Server puts a first dev server up and exits 0' ($code -eq 0 -and (WaitUp $D))
        Yes '  and says DOOR CARRIED' (@($script:lastOut | ForEach-Object { $_.Trim() }) -contains 'DOOR CARRIED')
        Yes '  and the dev door.json has the live key and join pass key, and the live site ending in /dev' (DevDoorOk)
        $devCur = Join-Path $deploys 'current\thornswood-server-dev.json'
        $devBeside = Join-Path $devRoot 'data\thornswood-deploy.json'
        $c1 = Rec $devCur
        Yes '  and the box records it (#459): the store''s current record names the gamemode artifact and its commit' (
            $c1 -and $c1.name -eq $art.Name -and $c1.commit -eq $art.Commit -and $c1.part -eq 'thornswood-server-dev')
        Yes '    and the same record is beside it, in data, where the server serves it' ((Get $devBeside) -eq (Get $devCur))
        Yes '    and the artifact is in the store, as it was built' (
            (Test-Path -LiteralPath (Join-Path $deploys ('gamemode\' + $art.Name))) -and (Sha (Join-Path $deploys ('gamemode\' + $art.Name))) -eq $art.Sha256)
        Yes '    and history.log has the publish' ((Get (Join-Path $deploys 'history.log')) -match [regex]::Escape('thornswood-server-dev ' + $art.Name))
        # The server build it installed, kept by name (ServerArtifact.ps1).
        $srvJson = @(Get-ChildItem -LiteralPath (Join-Path $deploys 'server') -Filter 'server-abcdef012345-*.json' -File -ErrorAction SilentlyContinue)
        $srvRec = if ($srvJson.Count -eq 1) { Rec $srvJson[0].FullName } else { $null }
        Yes '    and the server build it installed is in the store by name, as it was built (#459)' (
            $srvRec -and $srvRec.component -eq 'server' -and $srvRec.commit -eq 'abcdef0123456789abcdef0123456789abcdef01' -and
            (Sha (Join-Path $deploys ('server\' + $srvRec.name))) -eq $srvRec.sha256 -and
            @($srvRec.files | Where-Object { $_.path -eq 'scam_native.node' -and $_.sha256 -eq (TextSha 'binary v2') }).Count -eq 1)
        $sb = Rec $siteBuild
        Yes '    and the site''s deployed-build.json names the engine dev runs (#2303)' ($sb -and $sb.dev.commit -eq 'abcdef0123456789abcdef0123456789abcdef01')
        $rec1 = Get $devCur
        if ($script:fail -gt $failed) { Show }
        # The dev server's own switches, the ones dev rollout 6 lost (#1222).
        $devOwn = SettingsOf $devRoot
        foreach ($kv in @(@('name', 'Thornswood Dev'), @('thornswoodServer', 'dev'), @('thornswoodLoadOrderRefuse', $true),
                          @('thornswoodRequirePass', $false), @('thornswoodVoicePort', 7789), @('npcSettings', [pscustomobject]@{}),
                          @('npcAllowCrimeFaction', $true), @('npcAllowEssential', $true))) {
            $devOwn | Add-Member -NotePropertyName $kv[0] -NotePropertyValue $kv[1] -Force
        }
        Put (Join-Path $devRoot 'server-settings.json') ($devOwn | ConvertTo-Json -Depth 8)
        $devOwn = SettingsOf $devRoot
        # What the build had on 29 Sep: none of those, and the default key.
        $build = @{ name = 'Thornswood'; npcSettings = @{ default = @{ spawnInInterior = $true; spawnInExterior = $true } }
                    npcAllowCrimeFaction = $false; npcAllowEssential = $false; thornswoodVoicePort = 7789 }
        $devBefore = Tree $devRoot
        $devPid = Owner $D

        $code = Publish (Payload -Port $D -ForRoot $devRoot -Order @('Skyrim.esm', 'Missing.esp')) @()
        $failed = $script:fail
        Yes 'Publish-Server with a payload the installer refuses exits 1' ($code -ne 0)
        Yes '  and says the server was not stopped or changed' ((($script:lastOut) -join "`n") -match 'was not stopped or changed')
        Yes '  and it was not: the same process, the root as it was' (((Owner $D) -eq $devPid) -and ((Tree $devRoot) -eq $devBefore))
        Yes '  and nothing it sent the box before the installer stops anything' (
            @($global:TsSshSeen | Where-Object { $_ -match 'EncodedCommand' }).Count -eq 0)
        Yes '  and the box''s record is the one before it (#459)' ((Get $devCur) -eq $rec1 -and (Get $devBeside) -eq $rec1)
        if ($script:fail -gt $failed) { Show }

        $global:TsScpFail = 'thornswood-server\.zip'
        $code = Publish (Payload -Port $D -ForRoot $devRoot) @()
        $global:TsScpFail = ''
        $failed = $script:fail
        Yes 'Publish-Server whose copy fails exits 1 with the server untouched' (
            $code -ne 0 -and ((Owner $D) -eq $devPid) -and ((Tree $devRoot) -eq $devBefore))
        if ($script:fail -gt $failed) { Show }

        # A binary the record does not name, in a zip whose own record names it.
        $code = Publish (Payload -Port $D -ForRoot $devRoot -Binary 'binary v9') @()
        $failed = $script:fail
        Yes 'Publish-Server with a binary the build record does not name exits 1 (#1214)' ($code -ne 0 -and (($script:lastOut) -join "`n") -match 'not the recorded build')
        Yes '  before anything is sent: the installer never ran, the same process, the root as it was' (
            @($global:TsSshSeen | Where-Object { $_ -match '-File' }).Count -eq 0 -and ((Owner $D) -eq $devPid) -and ((Tree $devRoot) -eq $devBefore))
        if ($script:fail -gt $failed) { Show }

        # The recorded binary beside a JavaScript half from another build, in a
        # zip whose own record names it: the shape of 29 September.
        $code = Publish (Payload -Port $D -ForRoot $devRoot -Js '// the 24 Sep JavaScript half') @()
        $failed = $script:fail
        Yes 'Publish-Server with a JavaScript half the build record does not name exits 1 (#1214)' (
            $code -ne 0 -and (($script:lastOut) -join "`n") -match 'dist_back/skymp5-server\.js in the payload is not the build')
        Yes '  before anything is sent: the installer never ran, the same process, the root as it was' (
            @($global:TsSshSeen | Where-Object { $_ -match '-File' }).Count -eq 0 -and ((Owner $D) -eq $devPid) -and ((Tree $devRoot) -eq $devBefore))
        if ($script:fail -gt $failed) { Show }

        # A second apart at least, so the two records differ in when.
        Start-Sleep -Milliseconds 1100
        $code = Publish (Payload -Port $D -ForRoot $devRoot -Shipped 'shipped dev v2' -Settings $build -Order @('Skyrim.esm', 'A.esp', 'B.esp') -Carry @('Skyrim.esm', 'A.esp', 'B.esp')) @()
        $failed = $script:fail
        $devAfter = SettingsOf $devRoot
        Yes 'Publish-Server with a good payload exits 0 and the new folder answers' (
            $code -eq 0 -and (Get (Join-Path $devRoot 'data\shipped.txt')) -eq 'shipped dev v2' -and (WaitUp $D))
        $rec2 = Get $devCur
        $devPrev = @(Get-ChildItem -LiteralPath $box -Directory -Force | Where-Object { $_.Name -like 'Thornswood-Server-Dev.prev-*' } | Sort-Object Name -Descending | Select-Object -First 1)
        Yes '  and the box records the new publish, beside it and in the store (#459)' ($rec2 -and $rec2 -ne $rec1 -and (Get $devBeside) -eq $rec2)
        Yes '  and the old folder kept its own record, not handed to the new one' (
            $devPrev.Count -eq 1 -and (Get (Join-Path $devPrev[0].FullName 'data\thornswood-deploy.json')) -eq $rec1)
        Yes ('  and the dev server keeps every one of its own settings (#1222): ' + ((Carried $devOwn $devAfter) -join ', ')) (
            (Carried $devOwn $devAfter).Count -eq 0 -and $devAfter.thornswoodServer -eq 'dev' -and $devAfter.thornswoodLoadOrderRefuse -eq $true -and
            $devAfter.thornswoodRequirePass -eq $false -and $devAfter.name -eq 'Thornswood Dev' -and (Js $devAfter.npcSettings) -eq '{}')
        Yes '  and takes the release''s load order' (@($devAfter.loadOrder).Count -eq 3)
        Yes '  and says DOOR CARRIED again, with the dev door.json read back as before, /dev not added twice' (
            (@($script:lastOut | ForEach-Object { $_.Trim() }) -contains 'DOOR CARRIED') -and (DevDoorOk))
        if ($script:fail -gt $failed) { Show }

        $code = Publish '' @('PutBack')
        $failed = $script:fail
        Yes 'Publish-Server -PutBack exits 0 and the previous folder answers again' (
            $code -eq 0 -and (Get (Join-Path $devRoot 'data\shipped.txt')) -eq 'shipped dev v1' -and (WaitUp $D))
        Yes '  with the dev server''s own settings still' ((Carried $devOwn (SettingsOf $devRoot)).Count -eq 0)
        Yes '  and the box records the folder that came back by its own record (#459)' ((Get $devCur) -eq $rec1 -and (Get $devBeside) -eq $rec1)
        Yes '    and history.log says it was put back to it' ((Get (Join-Path $deploys 'history.log')) -match [regex]::Escape('thornswood-server-dev put back to ' + $art.Name))
        if ($script:fail -gt $failed) { Show }

        # Issue #2491: the task alone, through the same installer.
        $shippedWas = Get (Join-Path $devRoot 'data\shipped.txt')
        $curWas = Get $devCur
        $code = Publish '' @('TaskOnly')
        $failed = $script:fail
        Yes 'Publish-Server -TaskOnly exits 0 and the dev server answers under the task again' ($code -eq 0 -and (WaitUp $D))
        Yes '  having changed no file and no record' ((Get (Join-Path $devRoot 'data\shipped.txt')) -eq $shippedWas -and (Get $devCur) -eq $curWas)
        Yes '  and node reads back at High' ((@($script:lastOut) -join "`n") -match 'node, pid \d+, runs at High priority')
        if ($script:fail -gt $failed) { Show }

        # ---- Publish-Server -FromStore (#459) -------------------------------------
        # The recorded build out of the box's store, with no engine build here:
        # no -Dist and no -SkipBuild, the payload made by the publish itself.
        # The store has kept the 'binary v2' build since the first publish
        # above. 'binary v3' is a build of the same commit made elsewhere (the
        # way engine.yml makes one), sent with -ServerBuild.
        function PublishStore([string]$record, [hashtable]$more = @{}) {
            $a = @{ Channel = 'dev'; VpsRoot = $devRoot; TaskName = ($TaskPrefix + ' Dev'); VpsHost = '127.0.0.1'; VpsUser = 'nobody'
                    Zip = (Join-Path $work 'store-payload.zip'); NoPause = $true; Wait = 8; Record = $record; NoNews = $true; NoPush = $true
                    GamePort = $D; ResourcesPort = ($D + 1); FromStore = $true }
            foreach ($k in $more.Keys) { $a[$k] = $more[$k] }
            $global:TsSshSeen.Clear()
            $global:LASTEXITCODE = 0
            $said = @(& $publish @a *>&1 | ForEach-Object { "$_" })
            $script:lastOut = $said
            return $global:LASTEXITCODE
        }
        # A build folder and its record, and the artifact engine.yml would keep.
        function StoreBuild([string]$binary, [switch]$Light) {
            $b = Join-Path $work ('store-build-' + ($binary -replace '\W', ''))
            Put (Join-Path $b 'scam_native.node') $binary
            Put (Join-Path $b 'dist_back\skymp5-server.js') $stubJs
            foreach ($k in $forkRest.Keys) { Put (Join-Path $b ($k -replace '/', '\')) $forkRest[$k] }
            $r = RecordText $binary | ConvertFrom-Json
            if ($Light) { $r | Add-Member -NotePropertyName lightPlugins -NotePropertyValue $true -Force }
            $rp = Join-Path $b 'record.json'
            Put $rp ($r | ConvertTo-Json -Depth 5)
            $z = & { . (Join-Path $Here 'scripts\deploy\ServerArtifact.ps1'); New-ThornswoodServerBuildArtifact -From $b -Record $rp -OutDir (Join-Path $b 'ci') }
            return [pscustomobject]@{ Record = $rp; Zip = $z.Zip; Name = $z.Name }
        }
        # What a stage and a root are held to (ServerBuild.ps1), to read the result.
        . (Join-Path $Here 'scripts\deploy\ServerBuild.ps1')
        $v3 = StoreBuild 'binary v3'
        $devBefore = Tree $devRoot
        $devPid = Owner $D
        $orderWas = (Js (SettingsOf $devRoot).loadOrder)

        $code = PublishStore $v3.Record
        $failed = $script:fail
        Yes 'Publish-Server -FromStore whose build the store does not keep exits 1, saying so (#459)' (
            $code -ne 0 -and (($script:lastOut) -join "`n") -match 'keeps no server build of abcdef01 with the record this commit holds')
        Yes '  naming the build of that commit it does keep' ((($script:lastOut) -join "`n") -match 'server-abcdef012345-[0-9a-f]{16}, from that commit with another record')
        Yes '  before anything is sent: the installer never ran, the same process, the root as it was' (
            @($global:TsSshSeen | Where-Object { $_ -match '-File' }).Count -eq 0 -and ((Owner $D) -eq $devPid) -and ((Tree $devRoot) -eq $devBefore))
        if ($script:fail -gt $failed) { Show }

        $devOwn = SettingsOf $devRoot
        $code = PublishStore $v3.Record @{ ServerBuild = $v3.Zip }
        $failed = $script:fail
        Yes 'Publish-Server -FromStore -ServerBuild sends the build to the store and puts it on: exit 0, answering' ($code -eq 0 -and (WaitUp $D))
        Yes '  the build in the store by name, as it was made' (
            (Test-Path -LiteralPath (Join-Path $deploys ('server\' + $v3.Name))) -and (Sha (Join-Path $deploys ('server\' + $v3.Name))) -eq (Sha $v3.Zip))
        Yes '  the server runs it: the binary, and the record beside it' (
            (Get (Join-Path $devRoot 'scam_native.node')) -eq 'binary v3' -and (Sha (Join-Path $devRoot 'server-build.json')) -eq (Sha $v3.Record))
        Yes '  every other file the record lists is there as recorded' (
            @(Get-ThornswoodServerBuildProblems (Rec $v3.Record) (Get-ThornswoodServerFolderSums $devRoot) 'the dev root' 'v3').Count -eq 0)
        Yes '  the load order and the plugins it names are the running server''s' (
            (Js (SettingsOf $devRoot).loadOrder) -eq $orderWas -and (Test-Path -LiteralPath (Join-Path $devRoot 'plugins\Skyrim.esm')) -and (Test-Path -LiteralPath (Join-Path $devRoot 'plugins\A.esp')))
        Yes ('  and every setting of its own stays (#1222): ' + ((Carried $devOwn (SettingsOf $devRoot)) -join ', ')) ((Carried $devOwn (SettingsOf $devRoot)).Count -eq 0)
        Yes '  and the box records the gamemode it runs and the engine (#459, #2303)' ((Get $devBeside) -eq (Get $devCur) -and (Rec $devCur).name -eq $art.Name -and (Rec $siteBuild).dev.commit -eq 'abcdef0123456789abcdef0123456789abcdef01')
        if ($script:fail -gt $failed) { Show }

        # An engine that reads light plugins another way than the running one
        # would move every form id after the first light plugin (#1715).
        $v4 = StoreBuild 'binary v4' -Light
        $devBefore = Tree $devRoot
        $devPid = Owner $D
        $code = PublishStore $v4.Record @{ ServerBuild = $v4.Zip }
        $failed = $script:fail
        Yes 'Publish-Server -FromStore of an engine that reads light plugins another way is refused by the installer (#1715)' (
            $code -ne 0 -and (($script:lastOut) -join "`n") -match 'written for an engine that does not load light plugins')
        Yes '  with the server not stopped or changed' (((Owner $D) -eq $devPid) -and ((Tree $devRoot) -eq $devBefore))
        if ($script:fail -gt $failed) { Show }
    }

    # ---- Publish-Server.ps1, whole, on the live channel (#1222) --------------------
    # The same over a live server. Its own ports, 7777 and 3000, are the live
    # server's on the VPS, so this takes a pair of its own too (#1728).
    $L = Pair @($P, $Q, $D)
    Yes ("a game port for the live Publish-Server runs, {0}, and {1} above it, both bound and let go" -f $L, ($L + 1)) ($L -gt 0)
    if ($L -gt 0 -and $D -gt 0) {
        # Named Thornswood-Server, as on the box, so the box files it as the
        # live server's part; under Live\ because the Install-Server runs
        # above hold $box\Thornswood-Server. On the box the live and dev roots
        # sit beside one site, and since #3398 a deploy writes
        # deployed-build.json into the Thornswood-Docs beside the root it
        # deployed, so Live\Thornswood-Docs is a junction to the dev root's
        # site: one site, as there.
        $liveRoot = Join-Path $box 'Live\Thornswood-Server'
        $liveSite = Join-Path $box 'Live\Thornswood-Docs'
        $null = New-Item -ItemType Directory -Force -Path (Join-Path $box 'Live')
        $null = New-Item -ItemType Junction -Path $liveSite -Target (Join-Path $box 'Thornswood-Docs')
        Yes 'the live root''s Thornswood-Docs is the dev root''s site' ((Test-Path -LiteralPath (Join-Path $liveSite 'data\deployed-build.json')) -and (Get-Item -LiteralPath $liveSite).LinkType -eq 'Junction')
        $script:PayloadStampFor = 'main'
        $code = Publish (Payload -Port $L -ForRoot $liveRoot -Shipped 'shipped live v1') @() 'main' $liveRoot ($TaskPrefix + ' Live') $L
        $failed = $script:fail
        Yes 'Publish-Server -Channel main puts a first live server up and exits 0' ($code -eq 0 -and (WaitUp $L))
        $lc = Rec (Join-Path $deploys 'current\thornswood-server.json')
        Yes '  and the box records it as the live server''s (#459)' ($lc -and $lc.name -eq $art.Name -and $lc.part -eq 'thornswood-server')
        $sb = Rec $siteBuild
        Yes '  and the site''s deployed-build.json names live, keeping dev (#2303)' ($sb -and $sb.live.commit -eq 'abcdef0123456789abcdef0123456789abcdef01' -and $sb.dev.commit -eq 'abcdef0123456789abcdef0123456789abcdef01')
        if ($script:fail -gt $failed) { Show }
        $liveOwn = SettingsOf $liveRoot
        foreach ($kv in @(@('name', 'Thornswood'), @('thornswoodServer', 'main'), @('thornswoodLoadOrderRefuse', $true),
                          @('thornswoodRequirePass', $true), @('thornswoodVoicePort', 7778), @('npcSettings', [pscustomobject]@{}),
                          @('thornswoodDevs', @(123456789)))) {
            $liveOwn | Add-Member -NotePropertyName $kv[0] -NotePropertyValue $kv[1] -Force
        }
        Put (Join-Path $liveRoot 'server-settings.json') ($liveOwn | ConvertTo-Json -Depth 8)
        $liveOwn = SettingsOf $liveRoot
        $code = Publish (Payload -Port $L -ForRoot $liveRoot -Shipped 'shipped live v2' -Settings @{ name = 'Thornswood Test'
                         npcSettings = @{ default = @{ spawnInInterior = $true } }; thornswoodRequirePass = $false }) @() 'main' $liveRoot ($TaskPrefix + ' Live') $L
        $failed = $script:fail
        $liveAfter = SettingsOf $liveRoot
        Yes 'a live publish over it exits 0 and the new folder answers' (
            $code -eq 0 -and (Get (Join-Path $liveRoot 'data\shipped.txt')) -eq 'shipped live v2' -and (WaitUp $L))
        Yes ('  and the live server keeps every one of its own settings: ' + ((Carried $liveOwn $liveAfter) -join ', ')) (
            (Carried $liveOwn $liveAfter).Count -eq 0 -and $liveAfter.thornswoodServer -eq 'main' -and $liveAfter.thornswoodRequirePass -eq $true -and
            $liveAfter.thornswoodLoadOrderRefuse -eq $true -and (Js $liveAfter.npcSettings) -eq '{}' -and @($liveAfter.thornswoodDevs).Count -eq 1)
        if ($script:fail -gt $failed) { Show }
    }
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message) $false
    Show
}
finally {
    Yes 'no real scheduled task was left behind' (NoRealTask)
    # Only what this run started: the pids it wrote down, and only processes
    # that began after it did, so a pid Windows has since handed to something
    # else is left alone.
    if (Test-Path -LiteralPath $pidLog) {
        foreach ($id in @(Get-Content -LiteralPath $pidLog | Where-Object { $_ })) {
            $p = Get-Process -Id ([int]$id) -EA SilentlyContinue
            if ($p -and $p.StartTime -ge $started) { Stop-Process -Id $p.Id -Force -EA SilentlyContinue }
        }
    }
    Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Done
