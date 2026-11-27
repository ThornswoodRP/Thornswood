<#
  Reset-Character.ps1

  Throws away one character on a game server, so the next time that person
  joins, creation runs from the top. Works against a server on the VPS, dev or
  main, or against a server on this machine.

      .\Reset-Character.ps1 -Server dev -Character ff000a01
      .\Reset-Character.ps1 -Server main -Character ff000a01
      .\Reset-Character.ps1 -UseLocal -Character ff000a01      a server on this machine

  -Character is the character's form id in hex, as the server's log writes it
  (ff000a01), or its local part alone (a01). One that is not on that server
  stops it, and the line says which characters are there, by id and name.

  A character is not a save file under SkyMP. It is a change form the server
  holds, so New Game in Skyrim's own menu hands the same body, the same
  inventory and the same face straight back. This is the only thing that
  actually gives somebody a new one.

  ONE CHARACTER, ON A SERVER NAMED, NOBODY ON, AND IT ASKS (#4173). Until 27
  Nov 2026 this named nothing: with no options it took the live server's
  folder and task, stopped it, and moved every character there aside, without
  asking and without looking whether anybody was in the world. Now it needs
  the server (-Server dev or main, or -UseLocal) and one character, and the
  box's server-settings.json must say thornswoodServer is that server. It
  asks for RESET to be typed before it stops anything; -Yes answers that. On
  the box, right before the server is stopped, it reads the server's
  online.json (in its dataDir, as Deploy-Server.ps1 does) and the character's
  change form while the server still runs, and stops with nothing touched
  when anybody is in the world, when who is on cannot be read, or when that
  character is not there. A server that has nothing on its game port has
  nobody on it, whatever online.json still says.

  A character is a change form named with a runtime form's id in lowercase
  hex and no plugin (0.json, 1f.json: the engine's FormDesc::ToString) whose
  profileId is above 0 and which is not deleted (#5168, Release-List.ps1).
  The one asked for is the one whose formDesc is that runtime form. Every
  other form, characters and the world alike, is left alone. Nothing is
  deleted: what is thrown away goes into a _discarded folder beside it, which
  the game server's server-log.js deletes 30 days later (#3620). A server
  that keeps its world in MongoDB (#6237) has it read out into
  world-mongo-<stamp>\changeForms in its folder first (World.ps1), the
  _discarded folder goes there, and the character is taken out of the
  database before the release list names it. A look that moves nothing
  removes what it read out.

  The launcher has no switch for this (its unused copy went in #2673). For a
  test server on this machine, where every character goes, New-Character.ps1
  is the tool, and New-Character.cmd runs it. Neither holds your VPS password.

  WHAT THE SERVER STILL HOLDS OF THE CHARACTER IS LET GO AT ITS NEXT START
  (#2668). A guild trader keys its supply waits and a trade still waiting by
  the character's form id (#2652), and that form id can be handed to the
  next character made. So the character thrown away is written into the
  release list, private\deleted-characters.json (Release-List.ps1, the same
  list Delete-Person.ps1 writes, #2351), by form id only: the profile keeps
  its id and everything it holds (a house, an office, a book, a farm, the mod
  menu choices), so no profile is ever named. The start right after this
  lets go of the rest and the list is gone. A list already there that is not
  one stops this before anything is moved.

  THE SERVER IS STOPPED AND WAITED FOR, NOT SLEPT ON (#2871). A process asked
  to stop still holds its files until it has exited (measured on the box,
  #2928), and a start takes as long as it takes (#1938). So each server
  process is opened before it is ended and waited for until it has exited
  (StopAndMove.ps1, as the installer and every swap do), and nothing is moved
  while one is still there. On the VPS the server on its folder's own port is
  the one stopped, the box waits for both of its ports to answer from
  127.0.0.1 within the shared ceiling (ServerReadyWait.ps1), and this machine
  then tries that resources port once from outside
  (Test-ThornswoodFromOutside, Vps.ps1).
#>
#Requires -Version 7
[CmdletBinding(DefaultParameterSetName = 'Box')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Box')]
    [ValidateSet('dev', 'main')]
    [string]$Server,
    [Parameter(Mandatory = $true, ParameterSetName = 'Here')]
    [switch]$UseLocal,
    [Parameter(ParameterSetName = 'Here')]
    [string]$Local    = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ServerDist),
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(0x)?[0-9a-fA-F]{1,8}$')]
    [string]$Character,
    [string]$VpsHost  = '',
    [string]$VpsUser  = '',
    [switch]$Yes,
    [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here 'Release-List.ps1')
. (Join-Path $Here '..\deploy\World.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

# The folder and task of each server on the box, as the deploys name them
# (Reset-Npcs.ps1 names them the same way).
$Servers = @{
    dev  = @{ Root = 'C:\Thornswood-Server-Dev'; Task = 'Thornswood Dev Server' }
    main = @{ Root = 'C:\Thornswood-Server';     Task = 'Thornswood Server' }
}

# The body of the job, written once and run in both places. Everything it needs
# arrives as one argument, so there is no second copy of this logic to drift;
# the release list's functions (Release-List.ps1) go in with it.
$body = "param([string]`$Root, [string]`$Character, [string]`$Running = 'yes', [switch]`$Look)`n" + $ThornswoodReleaseList + "`n" + $ThornswoodWorld + "`n" + @'
# The one character asked for (#4173): its runtime form id in hex, as the
# server's log writes it (ff000a01), or its local part (a01).
$c = ([string]$Character).Trim().ToLowerInvariant() -replace '^0x', ''
$want = [long]0
if ($c -match '^ff[0-9a-f]{6}$') { $want = [Convert]::ToInt64($c, 16) }
elseif ($c -match '^[0-9a-f]{1,6}$') { $want = ConvertFrom-ThornswoodFormDesc $c }
if ($want -le 4278190080) { Write-Host ("STOP. '" + $Character + "' is not a character's form id: give it in hex as the server's log writes it, like ff000a01. Nothing was stopped or thrown away."); exit 1 }
$hex = '{0:x8}' -f $want
# Who is in the world, looked at while the server still runs (#4173): a
# reset stops the server, which puts everybody on it out. The count is the
# server's own online.json in its dataDir, which the gamemode writes within
# two seconds of starting and again whenever it moves (voice-feed.ts), read
# sharing write and delete as the deploys read it (#2740). Nothing on the
# game port is nobody on, whatever online.json still says; a running server
# whose count cannot be read is not taken as nobody.
if ($Look -and $Running -ne 'no') {
    $settings = Join-Path $Root 'server-settings.json'
    $dataDir = 'data'
    try {
        $cfg = [IO.File]::ReadAllText($settings) -replace '^﻿', '' | ConvertFrom-Json -ErrorAction Stop
        if ($cfg -and $cfg.dataDir) { $dataDir = [string]$cfg.dataDir }
    }
    catch { Write-Host ('STOP. ' + $settings + ' will not read (' + $_.Exception.Message + '), so who is on is not known. Nothing was stopped or thrown away.'); exit 1 }
    $onlineFile = [IO.Path]::Combine($Root, $dataDir, 'online.json')
    $now = -1
    try {
        $h = New-Object IO.FileStream($onlineFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try { $text = (New-Object IO.StreamReader($h, (New-Object Text.UTF8Encoding($false)), $true)).ReadToEnd() } finally { $h.Dispose() }
        $j = $text | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $j -or $null -eq $j.now) { throw 'it has no "now" count' }
        $now = [int]$j.now
    }
    catch { Write-Host ('STOP. The server is running and ' + $onlineFile + ' does not say who is on (' + $_.Exception.Message + '), so nobody is taken to be off. Nothing was stopped or thrown away.'); exit 1 }
    if ($now -gt 0) { Write-Host ('STOP. ' + $now + ' in the world on this server, and a reset stops it, which would put them out. Nothing was stopped or thrown away. Run it again once nobody is on.'); exit 1 }
    Write-Host 'nobody is in the world'
}
# The world where server-settings.json says it is (World.ps1, #6237): the
# folder for the file driver, or read out of MongoDB into a folder of the
# same shape, which Save writes back once the character is moved, and which
# a look, or a stop before anything moved, removes again.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$world = Open-ThornswoodWorld $Root $stamp
if ($world.Stop) { Write-Host ('STOP. ' + $world.Stop + '. Nothing was thrown away.'); exit 1 }
$forms = $world.Forms
function Remove-ThornswoodReadOut {
    if ($world.Driver -eq 'mongodb') { Remove-Item -LiteralPath (Split-Path -Parent $world.Forms) -Recurse -Force }
}
# A list there that is not one would be neither read by the server nor safe
# to write over, so nothing is thrown away until somebody has looked at it.
$list = Get-ThornswoodReleaseListPath $Root
if (-not $list) {
    Remove-ThornswoodReadOut
    Write-Host ("STOP. " + (Join-Path $Root 'server-settings.json') + " will not parse, so the server's private folder, where the release list goes, is not known. Nothing was thrown away.")
    exit 1
}
if (-not (Read-ThornswoodReleaseList $list).ok) {
    Remove-ThornswoodReadOut
    Write-Host ("STOP. $list is not a list of deleted characters, so nothing was thrown away. Look at it, then run this again.")
    exit 1
}
# The characters, by the one rule (#5168, Release-List.ps1): a runtime
# form's hex name and a profileId above 0. Of them, the one whose formDesc
# is the form asked for; every other is left where it is.
$chars = Get-ThornswoodCharacterForms $forms 'a reset leaves it where it is'
foreach ($n in $chars.notes) { Write-Host ("$n" -split '\|', 2)[1] }
$mine = @()
$there = @()
foreach ($p in $chars.files) {
    $o = [IO.File]::ReadAllText($p) -replace '^﻿', '' | ConvertFrom-Json
    $id = ConvertFrom-ThornswoodFormDesc $o.formDesc
    $name = ''
    if ($o.appearanceDump -and $o.appearanceDump.name) { $name = [string]$o.appearanceDump.name }
    if ($id -eq $want) { $mine += @{ File = $p; Name = $name } }
    elseif ($id -gt 0) { $there += (('{0:x8}' -f $id) + $(if ($name) { ' (' + $name + ')' } else { '' })) }
}
if ($mine.Count -ne 1) {
    Remove-ThornswoodReadOut
    if ($mine.Count -gt 1) { Write-Host ("STOP. {0} change forms on this server are character {1} ({2}), so which one to throw away is not known. Nothing was thrown away." -f $mine.Count, $hex, (($mine | ForEach-Object { Split-Path -Leaf $_.File }) -join ', ')); exit 1 }
    $said = if ($there.Count -eq 0) { 'it has no characters' } elseif ($there.Count -le 20) { 'its characters are ' + ($there -join ', ') } else { 'its characters include ' + (($there | Select-Object -First 20) -join ', ') + ' and ' + ($there.Count - 20) + ' more' }
    Write-Host ("STOP. There is no character {0} on this server: {1}. Nothing was stopped or thrown away." -f $hex, $said)
    exit 1
}
$one = $mine[0]
$who = $hex + $(if ($one.Name) { ' (' + $one.Name + ')' } else { '' })
if ($Look) {
    Remove-ThornswoodReadOut
    Write-Host ('found character ' + $who + ', in ' + (Split-Path -Leaf $one.File))
    exit 0
}
$bin = Join-Path $forms ('_discarded-' + $stamp)
$leaf = Split-Path -Leaf $one.File
$to = Join-Path $bin $leaf
# A character that could not be moved is still there on the next join, so
# the reset did not work (#4199): it ends 1, with nothing released.
try {
    if (-not (Test-Path -LiteralPath $bin)) { New-Item -ItemType Directory -Path $bin -Force -ErrorAction Stop | Out-Null }
    Move-Item -LiteralPath $one.File -Destination $to -Force -ErrorAction Stop
}
catch {
    Remove-ThornswoodReadOut
    Write-Host ("could not move {0}: {1}" -f $leaf, $_.Exception.Message)
    Write-Host ("STOP. Character {0} could not be moved, so the reset did not happen." -f $who)
    exit 1
}
# Out of MongoDB before anything is released: a character the release list
# names must be gone from the world the server loads.
$saved = Save-ThornswoodWorld $world
if ($saved -like 'STOP|*') { Write-Host ('STOP. ' + $saved.Substring(5) + '. The character is still in the world and nothing was released.'); exit 1 }
Write-Host ("thrown away: character {0}, kept at {1}" -f $who, $to)
# Only the character, never the profile (#2668): Release-List.ps1 says why.
$bad = $false
$found = Get-ThornswoodCharacterIds @($to)
foreach ($l in @($found.notes) + @(Write-ThornswoodReleaseList -Root $Root -Actors $found.ids)) {
    $b = "$l" -split '\|'
    switch ($b[0]) {
        'RELEASE'     { if ($b[1] -ne 'none') { Write-Host ("release list: {0}, {1} character(s); the server lets go of what it holds of them at its next start" -f $b[1], $b[3]) } }
        'RELEASENOTE' { Write-Host $b[1] }
        default       { $bad = $true; Write-Host ('STOP. ' + $b[1]) }
    }
}
if ($bad) { exit 1 }
'@

# What the box runs around the body (#2871): the server on this root's own
# port opened, stopped and waited for until it has exited, the body run in its
# own process, the task started, and both ports waited for from the box. The
# last line says whether it answered, for this machine to read.
$stopAndMove = Join-Path $Here '..\deploy\StopAndMove.ps1'
$readyWait = Join-Path $Here '..\deploy\ServerReadyWait.ps1'
# The hold it writes while the server is stopped (#5155, ServerHold.ps1), so
# the watchdog does not start it while its characters are moved.
. (Join-Path $Here '..\vps\ServerHold.ps1')
$run = "param([string]`$Root, [string]`$Task, [string]`$Server, [string]`$Character)`r`n" + (Get-ThornswoodHoldScript -Script 'Reset-Character.ps1') + [IO.File]::ReadAllText($stopAndMove) + "`r`n" + [IO.File]::ReadAllText($readyWait) + "`r`n" + @'
$settings = Join-Path $Root 'server-settings.json'
$port = 0
$cfg = $null
try { $cfg = [IO.File]::ReadAllText($settings) -replace '^\uFEFF', '' | ConvertFrom-Json; $port = [int]$cfg.port }
catch { Write-Host ('STOP. ' + $settings + ' will not read (' + $_.Exception.Message + '), so the server''s port is not known. Nothing was stopped or thrown away.'); exit 1 }
# The server named is the one in this folder, or nothing is touched (#4173).
if ([string]$cfg.thornswoodServer -ne $Server) { Write-Host ('STOP. ' + $settings + ' says thornswoodServer is ' + [string]$cfg.thornswoodServer + ', not ' + $Server + '. Nothing was stopped or thrown away.'); exit 1 }
if ($port -le 0) { Write-Host ('STOP. ' + $settings + ' names no port, so the server is not known. Nothing was stopped or thrown away.'); exit 1 }
# skymp5-server/ts/ui.ts: 3000 when the game port is 7777, the game port plus one otherwise.
$resPort = if ($port -eq 7777) { 3000 } else { $port + 1 }
$pids = @()
try { $pids = @(Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $port } | ForEach-Object { [int]$_.OwningProcess }) }
catch { Write-Host ('STOP. The UDP ports could not be listed to find the server on ' + $port + ': ' + $_.Exception.Message + '. Nothing was stopped or thrown away.'); exit 1 }
# Who is on and the character, looked at while the server still runs, right
# before it is stopped (#4173): anybody in the world, a count that cannot be
# read, or no such character stops it here with nothing touched.
$running = if ($pids.Count) { 'yes' } else { 'no' }
& pwsh -NoProfile -ExecutionPolicy Bypass -File C:\thornswood-reset.ps1 -Look -Running $running -Root $Root -Character $Character
if ($LASTEXITCODE -ne 0) { Write-Host 'STOP. The look before the stop said no, in the lines above. Nothing was stopped or thrown away.'; exit 1 }
$held = @(Get-ThornswoodProcessHeld $pids)
if ($ThornswoodNotHeld.Count) {
    foreach ($l in $ThornswoodNotHeld) { Write-Host $l }
    Write-Host 'STOP. The server could not be opened to wait for it. Nothing was stopped or thrown away.'
    exit 1
}
# Held from here until it is started again, or this gives up and leaves it
# to the watchdog: every way out below takes the hold away.
Write-Host (Set-ThornswoodHold -Target $Task -Why 'throwing away a character' -By $HoldBy)
Stop-ScheduledTask -TaskName $Task -EA SilentlyContinue
foreach ($p in $held) { Write-Host ('stopped pid ' + $p.Id + ', on UDP ' + $port) }
$still = @(Stop-ThornswoodProcessHeld $held)
if ($still.Count) {
    foreach ($l in $still) { Write-Host $l }
    Write-Host (Clear-ThornswoodHold -Target $Task)
    Write-Host 'STOP. The server has not exited, so nothing was thrown away and it was not started again.'
    exit 1
}
& pwsh -NoProfile -ExecutionPolicy Bypass -File C:\thornswood-reset.ps1 -Root $Root -Character $Character
$resetCode = $LASTEXITCODE
$startWhy = ''
try { Start-ScheduledTask -TaskName $Task -EA Stop }
catch { $startWhy = $_.Exception.Message }
if ($startWhy) { Write-Host (Clear-ThornswoodHold -Target $Task); Write-Host ('STOP. The task ' + $Task + ' would not start: ' + $startWhy); exit 1 }
$Wait = Get-ThornswoodServerReadyWait
$until = (Get-Date).AddSeconds($Wait)
$why = ''
$up = $false
while (-not $up) {
    $udp = $false
    try { $udp = @(Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $port }).Count -gt 0 }
    catch { $why = 'the UDP ports could not be listed: ' + $_.Exception.Message }
    if ($udp) {
        $c = New-Object Net.Sockets.TcpClient
        try { $null = $c.BeginConnect('127.0.0.1', $resPort, $null, $null).AsyncWaitHandle.WaitOne(500); $up = $c.Connected }
        catch { $why = $_.Exception.Message }
        finally { $c.Close() }
    }
    if ($up -or (Get-Date) -gt $until) { break }
    Start-Sleep -Milliseconds 700
}
# Answering, or past the wait: from here the watchdog watches it as before.
Write-Host (Clear-ThornswoodHold -Target $Task)
if ($up) { Write-Host ('the server answers on UDP ' + $port + ' and TCP ' + $resPort + ' on the box'); Write-Host ('ANSWERED|' + $port + '|' + $resPort) }
else {
    $line = 'the server did not answer on UDP ' + $port + ' and TCP ' + $resPort + ' on the box within ' + $Wait + ' s'
    if ($why) { $line += ', the last look saying: ' + $why }
    Write-Host $line
    Write-Host ('NOTANSWERED|' + $port + '|' + $resPort)
}
exit $resetCode
'@

if ($UseLocal) {
    Head 'This machine'
    if (-not (Test-Path -LiteralPath $Local)) { Die "no server at $Local" }
    $tmp = & (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'release') 'Get-ScratchDir.ps1') ('thornswood-reset-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    Set-Content -LiteralPath $tmp -Value $body -Encoding UTF8

    # Who is on and the character first, while the server still runs (#4173).
    $node = @(Get-Process -Name node -ErrorAction SilentlyContinue)
    $running = if ($node.Count) { 'yes' } else { 'no' }
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $tmp -Look -Running $running -Root $Local -Character $Character
    if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; Die 'the look before the stop said no, in the lines above. Nothing was stopped or thrown away.' }

    Write-Host ''
    Say ("  Character $Character on the server in $Local is thrown away; the next time that person joins, creation runs from the top.") 'Red'
    Say '  The server is stopped while its files move, so anybody on it is put out.' 'DarkGray'
    if ($Yes) { Say '  -Yes was passed, so it is not asking. Going ahead.' 'Yellow' }
    else {
        $typed = Read-Host '  Type RESET to go ahead'
        if ($typed -cne 'RESET') { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; Die 'Left alone. Nothing was stopped or thrown away.' }
    }

    # Opened before it is ended and waited for until it has exited, so its
    # files are closed before anything is moved (#2871, StopAndMove.ps1).
    $node = @(Get-Process -Name node -ErrorAction SilentlyContinue)
    if ($node.Count) {
        . $stopAndMove
        $held = @(Get-ThornswoodProcessHeld @($node | ForEach-Object { $_.Id }))
        foreach ($l in $ThornswoodNotHeld) { Say $l 'Red' }
        if ($ThornswoodNotHeld.Count) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; Die 'the server could not be opened to wait for it. Nothing was stopped or thrown away.' }
        Say 'stopping the server so its files can be moved' 'Yellow'
        $still = @(Stop-ThornswoodProcessHeld $held)
        foreach ($l in $still) { Say $l 'Red' }
        if ($still.Count) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; Die 'the server has not exited, so nothing was thrown away.' }
    }

    & pwsh -NoProfile -ExecutionPolicy Bypass -File $tmp -Root $Local -Character $Character
    $resetCode = $LASTEXITCODE
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    # Done only when the reset says it worked (#4199), as the VPS path reads it.
    if ($resetCode -ne 0) { Die "the reset exited with $resetCode, so the character is not thrown away. The lines above say why." }

    Write-Host ''
    Say 'Done. The next time that person presses Play, creation runs from the top.' 'Green'
    Say 'The launcher will start the server again for you.' 'DarkGray'
}
else {
    $VpsRoot = $Servers[$Server].Root
    $TaskName = $Servers[$Server].Task
    Head "The $Server server on the VPS at $VpsHost"
    Say ("  Character $Character on $Server ($VpsRoot) is thrown away; the next time that person joins, creation runs from the top.") 'Red'
    Say '  Before the server is stopped the box looks that the character is there and that nobody is in the world, and stops with nothing touched if not.' 'DarkGray'
    if ($Yes) { Say '  -Yes was passed, so it is not asking. Going ahead.' 'Yellow' }
    else {
        $typed = Read-Host '  Type RESET to go ahead'
        if ($typed -cne 'RESET') { Die 'Left alone. Nothing was stopped or thrown away.' }
    }
    foreach ($t in 'ssh', 'scp') {
        if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
            Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client."
        }
    }
    $target = "$VpsUser@$VpsHost"
    # Host key checking on (issue #450): ssh talks only to the box whose key
    # Setup-SshKey.ps1 wrote into known_hosts, checked against vps.json.
    $ssh = @('-o', 'StrictHostKeyChecking=yes')

    # Both files in one scp and the job in one ssh session, so it is two
    # passwords rather than more.
    $dir = & (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'release') 'Get-ScratchDir.ps1') ('thornswood-reset-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $tmp = Join-Path $dir 'thornswood-reset.ps1'
    $tmpRun = Join-Path $dir 'thornswood-reset-run.ps1'
    Set-Content -LiteralPath $tmp -Value $body -Encoding UTF8
    Set-Content -LiteralPath $tmpRun -Value $run -Encoding UTF8

    Invoke-ThornswoodNative { & scp @ssh $tmp $tmpRun "${target}:C:/" }
    $scpCode = $LASTEXITCODE
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    if ($scpCode -ne 0) { Die "scp exited with $scpCode" }

    $remote = "pwsh -NoProfile -ExecutionPolicy Bypass -Command `"& C:\thornswood-reset-run.ps1 -Root '$VpsRoot' -Task '$TaskName' -Server '$Server' -Character '$Character'; exit `$LASTEXITCODE`""
    $answer = ''
    # Said line by line as the box says it: the wait for the start can be minutes.
    Invoke-ThornswoodNative { & ssh @ssh $target $remote } | ForEach-Object {
        if ("$_" -like 'ANSWERED|*' -or "$_" -like 'NOTANSWERED|*') { $answer = "$_" } else { Write-Host $_ }
    }
    $code = $LASTEXITCODE
    $b = $answer -split '\|'

    Write-Host ''
    if ($b[0] -eq 'NOTANSWERED') {
        Say ("The server on the box has not come back on UDP {0} and TCP {1}." -f $b[1], $b[2]) 'Red'
        Say "  ssh $target" 'DarkGray'
        Say "  Start-ScheduledTask -TaskName '$TaskName'   (the task runs node High, #2491; node started by hand does not)" 'DarkGray'
        if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
        exit 1
    }
    if ($code -ne 0) { Die "the reset on the VPS exited with $code" }
    if ($b[0] -ne 'ANSWERED') { Die 'the VPS did not say whether the server came back' }

    # The box has said both ports answer there. One try from here (#2975):
    # the server listens on every address with one socket, so a second try
    # can only say what the first said.
    $resPort = [int]$b[2]
    $witness = if ($resPort -eq 3000) { 7788 } else { 3000 }
    $outside = Test-ThornswoodFromOutside $VpsHost $resPort $witness
    if ($outside.Answered) {
        Say ("Done. The server answers at {0}:{1} from here as well. The next time that person presses Play, creation runs from the top." -f $VpsHost, $resPort) 'Green'
    } elseif ($outside.NotKnown) {
        Say ("Done on the box. Whether {0}:{1} answers from here is not known: {2}." -f $VpsHost, $resPort, $outside.NotKnown) 'Yellow'
    } else {
        Say ("The box says the server answers, and {0}:{1} was {2} from here, though {3} on the box answers from here." -f $VpsHost, $resPort, $outside.Said, $witness) 'Red'
        Say ("  .\scripts\vps\Remote.ps1 `"Get-NetFirewallPortFilter -PolicyStore ActiveStore -Protocol TCP | Where-Object LocalPort -eq {0} | Get-NetFirewallRule | Format-Table DisplayName,Enabled,Action,Profile`"" -f $resPort) 'DarkGray'
        if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
        exit 1
    }
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
