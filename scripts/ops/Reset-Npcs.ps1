<#
  Reset-Npcs.ps1

      .\scripts\ops\Reset-Npcs.ps1 -Server dev -Survey     says what it would take
      .\scripts\ops\Reset-Npcs.ps1 -Server dev             takes it, after RESET is typed

  Starts every NPC on one game server again from its plugin record, and
  leaves every character and every private register as it is (#4595).
  NpcReset.ps1 says which saved change forms count as NPCs, what it measures
  as it goes and where they are put; this is the part that runs it on the box.

  WHY. The engine fork's #98 gives an NPC only the gear it fights and looks
  with, marked as its own, from the moment its inventory is first made. NPCs
  saved before that engine reached a server keep the inventory they were
  saved with, vanilla coin and pockets included, through every death and
  respawn. Moving their change forms aside is what lets the engine make them
  again. Wipe-Saves.ps1 is not this: it starts every character over and sets
  aside every register beside them.

  IT RUNS ONLY ON A SERVER THAT ALREADY RUNS #98. An NPC made again by an
  engine before it is unmarked again. So the box step reads the
  server-build.json in the server's folder and moves nothing unless it is
  the build records\server-build.json holds on main (every pin since 31 Oct
  carries #98); a survey says which build it found (SERVERBUILD) and what
  the NPCs carry (NPCMARKS).

  -Server dev or -Server main, required: the folder is the one each deploy
  uses (C:\Thornswood-Server-Dev, task 'Thornswood Dev Server', and
  C:\Thornswood-Server, task 'Thornswood Server', as Deploy-DevGamemode.ps1
  and Deploy-Server.ps1 name them), and its server-settings.json must say
  thornswoodServer is that name, or nothing is touched.

  -Survey reads the change forms where they are, with the server running,
  and moves nothing. Without it the server on that folder's own game port is
  opened, stopped and waited for until it has exited (StopAndMove.ps1, as
  Reset-Character.ps1 does), the NPCs are moved aside, and the task is
  started again and waited for on both ports (ServerReadyWait.ps1). From
  before the stop until it answers, the server is held (ServerHold.ps1,
  #5155), so the watchdog does not start it while its files move. A server
  that somebody else holds is stopped on purpose for their own work, and is
  left as it is with nothing moved.

  It asks for RESET to be typed before it takes anything. -Yes answers that,
  for the deploy gate, which runs it as Reset-Npcs-Dev and Reset-Npcs-Main
  (scripts\vps\gate\verbs.json) with -Yes and -NoPause and only -Survey to
  add:

    pwsh scripts/vps/Box-Run.ps1 -Line 'Reset-Npcs-Dev -Survey'
    pwsh scripts/vps/Box-Run.ps1 -Line 'Reset-Npcs-Dev'

  Main is a live verb: its line names main's full commit with -Build.

  Stop before you run it without -Survey if people are on. It puts them out.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('dev', 'main')]
  [string]$Server,
  [switch]$Survey,
  [switch]$Yes,
  [switch]$NoPause,
  [string]$Vps  = '',
  [string]$User = ''
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here 'NpcReset.ps1')
. (Join-Path $Here '..\vps\ServerHold.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

# The folder and task of each server, as the deploys name them.
$Servers = @{
  dev  = @{ Root = 'C:\Thornswood-Server-Dev'; Task = 'Thornswood Dev Server' }
  main = @{ Root = 'C:\Thornswood-Server';     Task = 'Thornswood Server' }
}
$root = $Servers[$Server].Root
$task = $Servers[$Server].Task
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
function Q([string]$s) { return "'" + ($s -replace "'", "''") + "'" }

# What runs on the box, Windows PowerShell 5.1. The NPC reset's functions,
# and for a reset the hold, the stop and the wait (Reset-Character.ps1's
# way, #2871 and #5155).
$stopAndMove = [IO.File]::ReadAllText((Join-Path $Here '..\deploy\StopAndMove.ps1'))
$build = [IO.File]::ReadAllText((Join-Path $Here '..\..\records\server-build.json')) -replace '^\uFEFF', '' | ConvertFrom-Json
$readyWait = [IO.File]::ReadAllText((Join-Path $Here '..\deploy\ServerReadyWait.ps1'))
$boxScript = @"
`$ErrorActionPreference = 'Continue'
$ThornswoodNpcReset
`$Root = $(Q $root)
`$Task = $(Q $task)
`$Want = $(Q $Server)
`$Stamp = $(Q $stamp)
`$Survey = `$$([bool]$Survey)
`$WantCommit = $(Q ([string]$build.source.commit))
`$WantSha = $(Q ([string]$build.sha256))
"@ + "`r`n" + $(if ($Survey) { '' } else { (Get-ThornswoodHoldScript -Script 'Reset-Npcs.ps1') + $stopAndMove + "`r`n" + $readyWait }) + "`r`n" + @'
$settings = Join-Path $Root 'server-settings.json'
$cfg = $null
try { $cfg = [IO.File]::ReadAllText($settings) -replace '^\uFEFF', '' | ConvertFrom-Json }
catch { 'STOP|' + $settings + ' will not read (' + $_.Exception.Message + '), so it is not known which server this is. Nothing was touched.'; exit 1 }
if ([string]$cfg.thornswoodServer -ne $Want) { 'STOP|' + $settings + ' says thornswoodServer is ' + [string]$cfg.thornswoodServer + ', not ' + $Want + '. Nothing was touched.'; exit 1 }
$serverBuild = Test-ThornswoodServerBuild $Root $WantCommit $WantSha
$serverBuild
if ($Survey) {
  $out = @(Invoke-ThornswoodNpcReset -Root $Root -Stamp $Stamp)
  $out
  if (@($out | Where-Object { "$_" -like 'STOP|*' }).Count) { exit 1 }
  exit 0
}
# A server without #98 would make the NPCs again unmarked.
if (-not $serverBuild.StartsWith('SERVERBUILD|same|')) { 'STOP|The server in ' + $Root + ' is not the build main''s records\server-build.json holds, so NPCs made again might be unmarked. Nothing was stopped or moved.'; exit 1 }
$port = 0
[void][int]::TryParse([string]$cfg.port, [ref]$port)
if ($port -le 0) { 'STOP|' + $settings + ' names no port, so the server is not known. Nothing was stopped or moved.'; exit 1 }
# skymp5-server/ts/ui.ts: 3000 when the game port is 7777, the game port plus one otherwise.
$resPort = if ($port -eq 7777) { 3000 } else { $port + 1 }
function Get-PortPids {
  return @(Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $port } | ForEach-Object { [int]$_.OwningProcess })
}
$pids = @()
try { $pids = Get-PortPids }
catch { 'STOP|The UDP ports could not be listed to find the server on ' + $port + ': ' + $_.Exception.Message + '. Nothing was stopped or moved.'; exit 1 }
# A hold already there is somebody else's stop on purpose (#5155).
$other = Get-ThornswoodHoldFile -Target $Task
if (Test-Path -LiteralPath $other) {
  @(Get-ThornswoodHolds)
  'STOP|' + $Task + ' is held by another stop on purpose, so it is left as it is. Nothing was stopped or moved.'
  exit 1
}
$held = @(Get-ThornswoodProcessHeld $pids)
if ($ThornswoodNotHeld.Count) {
  foreach ($l in $ThornswoodNotHeld) { $l }
  'STOP|The server could not be opened to wait for it. Nothing was stopped or moved.'
  exit 1
}
# Held from here until it answers again, so the watchdog does not start it
# while its files move; every way out below takes the hold away.
Set-ThornswoodHold -Target $Task -Why 'resetting the NPCs' -By $HoldBy
Stop-ScheduledTask -TaskName $Task -EA SilentlyContinue
foreach ($p in $held) { 'stopped pid ' + $p.Id + ', on UDP ' + $port }
$still = @(Stop-ThornswoodProcessHeld $held)
if ($still.Count) {
  foreach ($l in $still) { $l }
  Clear-ThornswoodHold -Target $Task
  'STOP|The server has not exited, so nothing was moved and it was not started again.'
  exit 1
}
$out = @(Invoke-ThornswoodNpcReset -Root $Root -Stamp $Stamp -Move)
$out
$bad = @($out | Where-Object { "$_" -like 'STOP|*' -or "$_" -like 'FAILED|*' }).Count -gt 0
$startWhy = ''
try { Start-ScheduledTask -TaskName $Task -EA Stop }
catch { $startWhy = $_.Exception.Message }
if ($startWhy) { Clear-ThornswoodHold -Target $Task; 'STOP|The task ' + $Task + ' would not start: ' + $startWhy; exit 1 }
$Wait = Get-ThornswoodServerReadyWait
$until = (Get-Date).AddSeconds($Wait)
$why = ''
$up = $false
while (-not $up) {
  $udp = $false
  try { $udp = @(Get-PortPids).Count -gt 0 } catch { $why = 'the UDP ports could not be listed: ' + $_.Exception.Message }
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
Clear-ThornswoodHold -Target $Task
if ($up) { 'ANSWERED|' + $port + '|' + $resPort }
else {
  $line = 'NOTANSWERED|' + $port + '|' + $resPort + '|' + $Wait
  if ($why) { $line += '|' + $why }
  $line
  exit 1
}
if ($bad) { exit 1 }
exit 0
'@

Write-Host ''
Write-Host ("  THORNSWOOD  -  reset the NPCs on {0}" -f $Server) -ForegroundColor White
Say "  $root on $Vps" 'DarkGray'

# Every line from the box, said the way people read it. Returns whether any
# line was a failure.
function Show-Lines($lines) {
  $failed = $false
  foreach ($l in @($lines)) {
    $b = "$l" -split '\|'
    switch ($b[0]) {
      'NPCRESET'    { Say ("  NPCs: {0}   characters kept: {1}   other references kept: {2}   not read, kept: {3}" -f $b[1], $b[2], $b[3], $b[4]) 'Yellow' }
      'SERVERBUILD' {
        $mine = if ($b[3]) { '{0} ({1})' -f $b[2].Substring(0, [math]::Min(12, $b[2].Length)), $b[3].Substring(0, 8) } else { $b[2] }
        $main = '{0} ({1})' -f $b[4].Substring(0, [math]::Min(12, $b[4].Length)), $b[5].Substring(0, [math]::Min(8, $b[5].Length))
        switch ($b[1]) {
          'same'  { Say ("  server build: fork {0}, the one main's record holds" -f $mine) 'DarkGray' }
          default { Say ("  server build: {0}; main's record holds fork {1}. A reset moves nothing until they match." -f $mine, $main) 'Yellow' }
        }
      }
      'NPCKINDS'    { Say ('  of them: ' + (($b | Select-Object -Skip 1) -join ', ')) 'DarkGray' }
      'NPCMARKS'    { Say ("  what they carry: every item with the engine's own-gear mark (#98): {0}; an item without it: {1}; nothing: {2}" -f $b[1], $b[2], $b[3]) 'DarkGray' }
      'KILLHISTORY' { if ([int]$b[1]) { Say ("  {0} character(s) hold kill-contract history for {1} of these NPCs; each of those NPCs starts again at life 0" -f $b[1], $b[2]) 'Yellow' } }
      'STAFFKEPT'   { Say ("  a creature staff kept: {0}, record {1}, in {2} at {3}" -f $b[1], $b[2], $b[3], $b[4]) 'Yellow' }
      'NOTREAD'     { Say ("  kept, not read: {0} ({1})" -f $b[1], $b[2]) 'Yellow' }
      'FAILED'      { $failed = $true; Say ("  could not move {0}: {1}" -f $b[1], $b[2]) 'Red' }
      'STOP'        { $failed = $true; Say ('  ' + $b[1]) 'Red' }
      'ANSWERED'    { Say ("  the server answers on UDP {0} and TCP {1} on the box" -f $b[1], $b[2]) 'Green' }
      'NOTANSWERED' { $failed = $true; Say ("  the server did not answer on UDP {0} and TCP {1} within {2} s{3}" -f $b[1], $b[2], $b[3], $(if ($b.Count -gt 4) { ', the last look saying: ' + $b[4] } else { '' })) 'Red' }
      default       { Say "  $l" }
    }
  }
  return $failed
}

if ($Survey) {
  Head 'What a reset would take (nothing moves)'
  $surveyLines = Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $boxScript
  $code = $LASTEXITCODE
  $failed = Show-Lines $surveyLines
  if ($failed -or $code -ne 0) { Die "the survey on the box did not finish (exit $code)." }
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

Write-Host ''
Say '  Every NPC on this server starts again from its record. Characters,' 'Red'
Say '  their houses, chests and every register stay as they are. The server' 'DarkGray'
Say '  is stopped while the files move, so anybody on it is put out.' 'DarkGray'
Write-Host ''
if ($Yes) { Say '  -Yes was passed, so it is not asking. Going ahead.' 'Yellow' }
else {
  $typed = Read-Host '  Type RESET to go ahead'
  if ($typed -cne 'RESET') { Die 'Left alone.' }
}

Head 'Resetting'
$resetLines = Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $boxScript
$code = $LASTEXITCODE
$failed = Show-Lines $resetLines
if ($failed -or $code -ne 0) { Die "the reset on the box did not finish (exit $code). What it said is above." }
Write-Host ''
Say '  Done. The NPCs moved aside are in changeForms\_discarded-<stamp> beside' 'Green'
Say '  the rest, and the game server deletes that folder 30 days from today.' 'DarkGray'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
