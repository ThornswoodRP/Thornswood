<#
  Reset-Character.ps1

  Throws away the character on the server so the next launch runs creation from
  the top. Works against the VPS or against a server on this machine.

  Your character is not a save file under SkyMP. It is a change form the server
  holds, so New Game in Skyrim's own menu hands the same body, the same
  inventory and the same face straight back. This is the only thing that
  actually gives you a new one.

  The change forms named with a bare number are the ones belonging to people.
  Everything else in that folder describes the world and is left alone. Nothing
  is deleted: what is thrown away goes into a _discarded folder beside it,
  which the game server's server-log.js deletes 30 days later (#3620).

      .\Reset-Character.ps1            the VPS
      .\Reset-Character.ps1 -Local     a server running on this machine

  The launcher has no switch for this (its unused copy went in #2673); for a
  server on this machine use -UseLocal here, or New-Character.ps1, which
  writes the same release list. Neither holds your VPS password.

  WHAT THE SERVER STILL HOLDS OF THE CHARACTER IS LET GO AT ITS NEXT START
  (#2668). A guild trader keys its supply waits and a trade still waiting by
  the character's form id (#2652), and that form id can be handed to the
  next character made. So the characters thrown away are written into the
  release list, private\deleted-characters.json (Release-List.ps1, the same
  list Delete-Person.ps1 writes, #2351), by form id only: the profile keeps
  its id and everything it holds (a house, an office, a book, a farm, the mod
  menu choices), so no profile is ever named. The start right after this
  lets go of the rest and the list is gone. A list already there that is not
  one stops this before anything is moved.

  THE SERVER IS STOPPED AND WAITED FOR, NOT SLEPT ON (#2871). Until 22 Oct
  2026 both paths ended the server and slept two seconds before moving its
  files, and the VPS path then slept three more and knocked on <box>:3000
  from here up to twenty times, with an empty catch: always the live port,
  whatever -TaskName and -VpsRoot named. A process asked to stop still holds
  its files until it has exited (measured on the box, #2928), and a start
  takes as long as it takes (#1938). So each server process is opened before
  it is ended and waited for until it has exited (StopAndMove.ps1, as the
  installer and every swap do), and nothing is moved while one is still
  there. On the VPS the server on -VpsRoot's own port is the one stopped, the
  box waits for both of its ports to answer from 127.0.0.1 within the shared
  ceiling (ServerReadyWait.ps1), and this machine then tries that resources
  port once from outside (Test-ThornswoodFromOutside, Vps.ps1).
#>
[CmdletBinding()]
param(
    [string]$VpsHost  = '',
    [string]$VpsUser  = '',
    [string]$VpsRoot  = 'C:\Thornswood-Server',
    [string]$TaskName = 'Thornswood Server',
    [string]$Local    = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ServerDist),
    [switch]$UseLocal,
    [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here 'Release-List.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

# The body of the job, written once and run in both places. Everything it needs
# arrives as one argument, so there is no second copy of this logic to drift;
# the release list's functions (Release-List.ps1) go in with it.
$body = "param([string]`$Root)`n" + $ThornswoodReleaseList + "`n" + @'
$forms = Join-Path $Root 'world\changeForms'
if (-not (Test-Path -LiteralPath $forms)) { Write-Host 'no characters saved yet, nothing to do'; exit 0 }
# A list there that is not one would be neither read by the server nor safe
# to write over, so nothing is thrown away until somebody has looked at it.
$list = Get-ThornswoodReleaseListPath $Root
if (-not $list) {
    Write-Host ("STOP. " + (Join-Path $Root 'server-settings.json') + " will not parse, so the server's private folder, where the release list goes, is not known. Nothing was thrown away.")
    exit 1
}
if (-not (Read-ThornswoodReleaseList $list).ok) {
    Write-Host ("STOP. $list is not a list of deleted characters, so nothing was thrown away. Look at it, then run this again.")
    exit 1
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bin = Join-Path $forms ('_discarded-' + $stamp)
$moved = @()
foreach ($f in (Get-ChildItem -LiteralPath $forms -Filter *.json -File)) {
    if ($f.BaseName -notmatch '^[0-9]+$') { continue }
    if (-not (Test-Path -LiteralPath $bin)) { New-Item -ItemType Directory -Path $bin -Force | Out-Null }
    $to = Join-Path $bin $f.Name
    try { Move-Item -LiteralPath $f.FullName -Destination $to -Force -ErrorAction Stop; $moved += $to }
    catch { Write-Host ("could not move {0}: {1}" -f $f.Name, $_.Exception.Message) }
}
if ($moved.Count -eq 0) { Write-Host 'there was no character on the server to throw away'; exit 0 }
Write-Host ("thrown away: {0} change form(s), kept at {1}" -f $moved.Count, $bin)
# Only the characters, never the profile (#2668): Release-List.ps1 says why.
$bad = $false
$found = Get-ThornswoodCharacterIds $moved
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
$run = "param([string]`$Root, [string]`$Task)`r`n" + (Get-ThornswoodHoldScript -Script 'Reset-Character.ps1') + [IO.File]::ReadAllText($stopAndMove) + "`r`n" + [IO.File]::ReadAllText($readyWait) + "`r`n" + @'
$settings = Join-Path $Root 'server-settings.json'
$port = 0
try { $port = [int](([IO.File]::ReadAllText($settings) | ConvertFrom-Json).port) }
catch { Write-Host ('STOP. ' + $settings + ' will not read (' + $_.Exception.Message + '), so the server''s port is not known. Nothing was stopped or thrown away.'); exit 1 }
if ($port -le 0) { Write-Host ('STOP. ' + $settings + ' names no port, so the server is not known. Nothing was stopped or thrown away.'); exit 1 }
# skymp5-server/ts/ui.ts: 3000 when the game port is 7777, the game port plus one otherwise.
$resPort = if ($port -eq 7777) { 3000 } else { $port + 1 }
$pids = @()
try { $pids = @(Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $port } | ForEach-Object { [int]$_.OwningProcess }) }
catch { Write-Host ('STOP. The UDP ports could not be listed to find the server on ' + $port + ': ' + $_.Exception.Message + '. Nothing was stopped or thrown away.'); exit 1 }
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
& pwsh -NoProfile -ExecutionPolicy Bypass -File C:\thornswood-reset.ps1 -Root $Root
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

    # Opened before it is ended and waited for until it has exited, so its
    # files are closed before anything is moved (#2871, StopAndMove.ps1).
    $node = @(Get-Process -Name node -ErrorAction SilentlyContinue)
    if ($node.Count) {
        . $stopAndMove
        $held = @(Get-ThornswoodProcessHeld @($node | ForEach-Object { $_.Id }))
        foreach ($l in $ThornswoodNotHeld) { Say $l 'Red' }
        if ($ThornswoodNotHeld.Count) { Die 'the server could not be opened to wait for it. Nothing was stopped or thrown away.' }
        Say 'stopping the server so its files can be moved' 'Yellow'
        $still = @(Stop-ThornswoodProcessHeld $held)
        foreach ($l in $still) { Say $l 'Red' }
        if ($still.Count) { Die 'the server has not exited, so nothing was thrown away.' }
    }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) 'thornswood-reset.ps1'
    Set-Content -LiteralPath $tmp -Value $body -Encoding UTF8
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $tmp -Root $Local
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue

    Write-Host ''
    Say 'Done. Press Play and creation runs from the top.' 'Green'
    Say 'The launcher will start the server again for you.' 'DarkGray'
}
else {
    Head "The VPS at $VpsHost"
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
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-reset-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $tmp = Join-Path $dir 'thornswood-reset.ps1'
    $tmpRun = Join-Path $dir 'thornswood-reset-run.ps1'
    Set-Content -LiteralPath $tmp -Value $body -Encoding UTF8
    Set-Content -LiteralPath $tmpRun -Value $run -Encoding UTF8

    Invoke-ThornswoodNative { & scp @ssh $tmp $tmpRun "${target}:C:/" }
    $scpCode = $LASTEXITCODE
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    if ($scpCode -ne 0) { Die "scp exited with $scpCode" }

    $remote = "pwsh -NoProfile -ExecutionPolicy Bypass -Command `"& C:\thornswood-reset-run.ps1 -Root '$VpsRoot' -Task '$TaskName'; exit `$LASTEXITCODE`""
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
        Say ("Done. The server answers at {0}:{1} from here as well. Press Play and creation runs from the top." -f $VpsHost, $resPort) 'Green'
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
