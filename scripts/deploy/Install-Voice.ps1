<#
  Install-Voice.ps1

  Puts the proximity voice service on the VPS beside the game server and opens
  the one port it needs. Run it from this machine; it does the remote half
  over ssh.

  How the thing works, in three lines:
    the gamemode pushes everyone's position to the voice service five times a
    second, over loopback on the VPS. Everyone's browser holds a WebSocket to
    that service for positions and for WebRTC signalling. The audio itself goes
    straight between people and never touches the server.

  Positions come from the game server rather than from anybody's game, so voice
  works whichever SkyMP client somebody runs, and nobody can move their own
  voice around by editing a file on their machine.

      .\Install-Voice.ps1              install and start it
      .\Install-Voice.ps1 -Restart     stop it, wait until it has exited, start
                                       it again under the task it has, sending
                                       no file, and check it answers
      .\Install-Voice.ps1 -TaskOnly    register its task again with this
                                       install's settings and restart it under
                                       it, sending no file (#2491); the task
                                       it had goes back if it does not answer
      .\Install-Voice.ps1 -Remove      take it off again
      .\Install-Voice.ps1 -PutBack     the files the last install replaced go
                                       back in, checked; the task is left as is
      .\Install-Voice.ps1 -ChatRange on   typed chat reaches only the people near
      .\Install-Voice.ps1 -TurnUrl turn:host:3478
                                       offer a relay; its key is turn-key.txt
                                       in -Root on the VPS, put there by hand
#>
[CmdletBinding()]
param(
  # The site the voice server asks about character creation choices. Empty
  # turns that check off, which is how this behaved before it existed.
  [string]$Site = 'https://thornswood.net',
    [string]$VpsHost  = '',
    [string]$VpsUser  = '',
    [string]$Root     = 'C:\Thornswood-Voice',
    [int]$Port        = 7778,
    # Which addresses the service answers on. Loopback is the default since
    # #1304: Caddy carries /voice/ and /voice-dev/, every launcher uses that
    # https address, and live and dev have run on loopback since 29 September.
    # 0.0.0.0 opens the raw port again, for a box with no proxy in front, and
    # even then the service takes no token or ticket over it.
    [ValidateSet('0.0.0.0', '127.0.0.1')]
    [string]$Bind     = '127.0.0.1',
    # Who reads a typed line, entry 150. on is the shipped default since
    # 4 Oct, for live as well as dev (Patrick: local chat "should have went
    # out with the other changes to live"): the same cell and 4000 units,
    # the range /ooc uses. off is every line to everybody, as before; a
    # number is the range in units. See CHAT_RANGE in voice\voice-server.js.
    [ValidatePattern('^(off|on|\d+)$')]
    [string]$ChatRange = 'on',
    # A relay for the pairs that cannot reach each other directly:
    # turn:host:3478, or several joined by commas. It becomes
    # THORNSWOOD_TURN_URL on the service's command line. The relay's key never
    # goes on a command line: it sits in turn-key.txt in -Root on the VPS, put
    # there by hand, and the service reads it from there. Left off, whatever
    # is running is kept, the same as -Bind and -ChatRange; -TurnUrl ''
    # takes it away. With no relay at all, the command line is the one it
    # always was.
    [string]$TurnUrl  = '',
    [string]$TaskName = 'Thornswood Voice',
    [switch]$Restart,
    # Register the task again with this install's settings and restart the
    # service under it, sending no file (#2491).
    [switch]$TaskOnly,
    [switch]$Remove,
    [switch]$NoPause,
    # How long the new service has to answer with the build that was sent
    # before the old files and the old task go back.
    [int]$Wait = 30,
    # Put the files the last install replaced back in, and send nothing.
    [switch]$PutBack,
    # Register the task as SYSTEM, Highest, the way it was before #2578, and
    # grant nothing. The way back if voice will not run as LOCAL SERVICE.
    [switch]$AsSystem
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
. (Join-Path $Here 'Swap.ps1')
# The account the task runs as and what it may reach (#2578), sent inside
# the script that installs it.
. (Join-Path $Here 'ServiceAccount.ps1')
# Where the box keeps its firewall rules, and the refresh that makes the
# firewall take a change to them (#3896).
. (Join-Path $Here '..\vps\BoxFirewall.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$target = "$VpsUser@$VpsHost"
# Host key checking on (issue #450): ssh talks only to the box whose key
# Setup-SshKey.ps1 wrote into known_hosts, checked against vps.json.
$ssh = @('-o', 'StrictHostKeyChecking=yes')
foreach ($t in 'ssh', 'scp') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
        Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client."
    }
}

if ($TaskOnly -and ($Remove -or $Restart -or $PutBack)) {
    Die '-TaskOnly registers the task again and restarts voice under it, so it does not go with -Remove, -Restart or -PutBack. Nothing was sent.'
}

if ($Restart -and ($Remove -or $PutBack)) {
    Die '-Restart starts voice again as it is, so it does not go with -Remove or -PutBack. Nothing was sent.'
}

# What goes up is the voice artifact (issue #459, Artifact.ps1): the service
# as the commit holds it, in one zip named by commit and hash. Built here,
# before anything asks the box what it runs, because a service or log roller
# with uncommitted changes is refused with the box untouched (#1121). Sent
# under "files" below. The service serves no page since #1822, so public\ is
# not sent; a box installed before that keeps its old public\ folder, which
# nothing reads.
. (Join-Path $Here 'Artifact.ps1')
$artifact = $null
if (-not $PutBack -and -not $Remove -and -not $Restart -and -not $TaskOnly) {
    $artifact = New-ThornswoodArtifact -Component voice -RepoDir (Join-Path $Here '..\..') -Paths 'voice/voice-server.js', 'voice/headlines.js' `
        -AlsoSends 'scripts/vps/Server-Log.js'
    Say ('artifact ' + (Format-ThornswoodArtifact $artifact)) 'DarkGray'
}

<#
  What is already running, so a flag left off does not quietly undo it.

  -Bind changed real behaviour, and its default is loopback whatever is
  already live. A box someone set to every interface on purpose would be
  closed again by a later command that leaves it off, which is the easy
  thing to do once this is routine. Read what is actually running first, and
  keep it unless the flag was actually passed.
  -Auth went with #1303: the service refuses every join that cannot prove
  itself, so there is no auth left to keep.
#>
$bindExplicit = $PSBoundParameters.ContainsKey('Bind')
$chatExplicit = $PSBoundParameters.ContainsKey('ChatRange')
$turnExplicit = $PSBoundParameters.ContainsKey('TurnUrl')
# What a relay address may look like, whether it came from -TurnUrl or from
# what is running. It goes onto a cmd.exe line below, where an & or a quote
# would start a second command.
$turnShape = '^turns?:[A-Za-z0-9.-]+(:\d{1,5})?(\?transport=(udp|tcp))?(,turns?:[A-Za-z0-9.-]+(:\d{1,5})?(\?transport=(udp|tcp))?)*$'
if ($TurnUrl -and $TurnUrl -notmatch $turnShape) { Die "-TurnUrl takes turn:host:port, or several joined by commas, and nothing else." }
if (-not $Restart -and -not $Remove -and (-not $bindExplicit -or -not $chatExplicit -or -not $turnExplicit)) {
    # The relay is read off /ice, the list every page is handed, because that
    # is what is actually being served; a relay with no key serves nothing and
    # so is not kept, and /health's turn field is read too so that is said
    # rather than done quietly. On its own try, so a service that cannot
    # answer /ice still has its bind and chat range kept. The relay
    # comes last in the answer because its address is read to the end.
    $probe = @"
try { `$h = Invoke-RestMethod 'http://127.0.0.1:$Port/health' -TimeoutSec 5; `$t = ''; `$ie = ''; try { `$t = @((Invoke-RestMethod 'http://127.0.0.1:$Port/ice' -TimeoutSec 5).iceServers | ForEach-Object { `$_.urls } | Where-Object { "`$_" -match '^turns?:' }) -join ',' } catch { `$ie = (`$_.Exception.Message -replace '[;\r\n]', ' ') }; 'bind=' + `$h.bind + ';auth=' + `$h.auth + ';chat=' + `$h.chatRange + ';ice=' + `$ie + ';relay=' + `$h.turn + ';turn=' + `$t } catch { 'none' }
"@
    $current = & (Join-Path $Here '..\vps\Remote.ps1') $probe -VpsHost $VpsHost -VpsUser $VpsUser 2>$null | Select-Object -Last 1
    if ("$current" -match 'bind=([\d.]+);') {
        if (-not $bindExplicit) { Say "  keeping the current bind, $($Matches[1]), since -Bind was not passed" 'DarkGray'; $Bind = $Matches[1] }
    }
    # Whatever range is running is kept, 0 as off, the same as -Bind: the
    # default is for a first install. A service older than the
    # setting reports none and gets the default.
    if (-not $chatExplicit -and "$current" -match ';chat=(\d+)') {
        $ChatRange = $Matches[1]
        if ($ChatRange -eq '0') { $ChatRange = 'off' }
        Say "  keeping the current chat range, $ChatRange, since -ChatRange was not passed" 'DarkGray'
    }
    # /ice that did not answer gives no relay to keep: said, so the relay is not
    # dropped with nothing on the screen (#2711).
    if (-not $turnExplicit -and "$current" -match ';ice=([^;]+);') {
        Say "  the running service did not answer /ice ($($Matches[1].Trim())), so the relay it serves is not known and none is kept. Pass -TurnUrl to keep one." 'Yellow'
    }
    if (-not $turnExplicit -and "$current" -match ';turn=(\S+)') {
        $was = $Matches[1]
        if ($was -match $turnShape) { Say "  keeping the current relay, $was, since -TurnUrl was not passed" 'DarkGray'; $TurnUrl = $was }
    }
    # A relay address given before its key was put in place. Dropping it is
    # right, since it serves nothing, but a relay that quietly vanishes on the
    # next install is the same pair of people still not hearing each other.
    if (-not $turnExplicit -and "$current" -match ';relay=MISCONFIGURED;') {
        Say "  the running service has a relay address and no key for it, so it serves no relay and this install drops the address. Put turn-key.txt in $Root and pass -TurnUrl again." 'Yellow'
    }
}

<#
  HOW MANY PEOPLE HOLD A VOICE PLACE AT ONCE (#481; only somebody in the world
  holds one, #3570). records\most-online.json is the one
  place the numbers live, the world's seats and voice's, read through
  MaxOnline.ps1 the way the deploys read the seats, before anything is sent:
  a voice number under the seats stops here with the box untouched. It goes
  on the service's command line as THORNSWOOD_VOICE_MOST. With no voice
  number in the record the service is started without one, which is no cap,
  and this says so.

  Dev voice, C:\Thornswood-Voice-Dev (the folder every dev install names,
  SERVER.md in the ops repo), takes the dev server's numbers, the record's dev object;
  any other folder is the live service and takes main's (Patrick, 12 Oct:
  dev voice at most 5).
#>
. (Join-Path $Here 'MaxOnline.ps1')
$mostSet = ''
$voiceChannel = $(if ($Root.TrimEnd('\') -eq 'C:\Thornswood-Voice-Dev') { 'dev' } else { 'main' })
if (-not $PutBack -and -not $Remove -and -not $Restart) {
    try { $mostGot = Get-MostOnline -Channel $voiceChannel } catch { Die $_.Exception.Message }
    if ($mostGot.Note) { Say ("  " + $mostGot.Note) 'Yellow' }
    if ($mostGot.Voice -gt 0) {
        $mostSet = "set THORNSWOOD_VOICE_MOST=$([int]$mostGot.Voice)&& "
        Say ("  most people at once: {0}, the {1} numbers, from {2}" -f $mostGot.Voice, $voiceChannel, $mostGot.From) 'DarkGray'
    } else {
        Say ("  {0} gives no {1} voice number, so the service takes everybody who comes" -f $mostGot.From, $voiceChannel) 'Yellow'
    }
}

# ---------------------------------------------------------------- files -----
# The voice artifact built above goes to the box's store first, and only
# after its tree matches the commit (Assert-ThornswoodSourceIntegrity, issue
# #1335). A file that is not that commit stops the install here, and nothing
# is sent. The copies below are from its folder. -PutBack builds and sends
# nothing.
#
# The build string out of the file being sent, read before it is sent. It is
# checked on the far end after the start, because "the port answers" turned
# out to prove nothing at all: an old process still holding the port answers
# too (see StopIt below). Without it that check passes whatever answers, the
# old process included, so a file that does not read or names no build stops
# this here, before anything is sent (#2711).
$expectBuild = ''
$src = Join-Path $Here '..\..\voice'
if (-not $PutBack -and -not $TaskOnly -and -not $Restart -and -not $Remove) {
Assert-ThornswoodSourceIntegrity -Artifact $artifact -RepoDir (Join-Path $Here '..\..')
$vsPath = Join-Path $artifact.Folder 'voice\voice-server.js'
$vsText = ''
try { $vsText = [IO.File]::ReadAllText($vsPath) } catch { Die ("$vsPath could not be read, so there is no build to check the new service by. Nothing was sent: " + $_.Exception.Message) }
$m = [regex]::Match($vsText, "const\s+BUILD\s*=\s*'([^']+)'")
if (-not $m.Success) { Die "$vsPath names no const BUILD, so there is no build to check the new service by. Nothing was sent." }
$expectBuild = $m.Groups[1].Value
Send-ThornswoodArtifact -Artifact $artifact -Target $target -SshArgs $ssh
$src = Join-Path $artifact.Folder 'voice'
}
foreach ($f in 'voice-server.js', 'headlines.js') {
    if (-not (Test-Path -LiteralPath (Join-Path $src $f))) { Die "not found: $(Join-Path $src $f)" }
}

<#
  STAGED, CHECKED, THEN SWAPPED, issue #446.

  This used to copy voice-server.js and the page straight over the running
  service, then stop it, re-register it and start it, and say "voice did not
  come up" with nothing put back and an exit code of 0. The page changed under
  everybody the moment it was copied, whatever the service did next.

  Now the files go into $Root\.stage-<stamp> while the service runs, the
  box checks them there (each by its hash, voice-server.js through
  node --check), and nothing is stopped if that fails. Then Swap.ps1's service
  swap stops it, renames them in (what they replace goes to
  $Root\.prev-<stamp>), registers the task with this install's settings and
  starts it, and asks /health for the build that was sent. If that is not what
  answers, the old files go back, the task goes back exactly as it was
  (exported before anything changed), and it is started again. -PutBack puts
  the newest .prev folder back and leaves the task as it is.
#>
function Remote($script) {
    # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
    # it off the box before it runs, and the far side's exit code comes back.
    return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script
}

$rootFar   = $Root -replace '\\', '/'
$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$stageName = '.stage-' + $stamp
$prevName  = '.prev-' + $stamp
$hashes    = [ordered]@{}


# THE CHARACTER REGISTER IS GONE, 23 September, and so is the secret it used.
# The three routes it guarded refused every real caller, and they are out of
# voice-server.js along with owners.json. Sending a secret that nothing reads
# is worse than sending nothing, so nothing here sends one. The service's own
# join tokens are signed with a key it makes for itself in token-key.txt.

if (-not $PutBack -and -not $TaskOnly -and -not $Restart -and -not $Remove) {
    Head 'Staging'
    $send = [ordered]@{}
    $send['voice-server.js'] = Join-Path $src 'voice-server.js'
    $send['headlines.js'] = Join-Path $src 'headlines.js'
    # The log writer the task runs the service under (#2166), the game
    # server's since #2349. See Server-Log.js.
    $send['server-log.js'] = Join-Path $Here '..\vps\Server-Log.js'
    # A stage a run that died part way left behind was never swapped in.
    $made = @(Remote @"
New-Item -ItemType Directory -Force -Path '$Root' | Out-Null
Get-ChildItem -LiteralPath '$Root' -Directory -Force -EA SilentlyContinue |
  Where-Object { `$_.Name -like '.stage-*' } |
  ForEach-Object { Remove-Item -LiteralPath `$_.FullName -Recurse -Force -EA SilentlyContinue }
New-Item -ItemType Directory -Force -Path '$Root\$stageName' | Out-Null
'ready'
"@ | ForEach-Object { "$_".Trim() })
    if ($made -notcontains 'ready') { Die "could not make $Root\$stageName up there. Voice was not touched." }
    foreach ($rel in $send.Keys) {
        Invoke-ThornswoodNative { & scp @ssh $send[$rel] "${target}:$rootFar/$stageName/$rel" }
        if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE for $rel. Voice was not touched." }
    }
    Say 'staged' 'Green'
    $hashes = Get-SwapHashes $send
    $checkOut = @(Remote ((ServiceSwapVars $Root $stageName $prevName $Wait $hashes @('voice-server.js')) + $serviceCheckBlock) |
                  ForEach-Object { Say "  $_"; "$_".Trim() })
    if ($checkOut -notcontains 'STAGE OK') { Die 'the stage did not check out, so voice was not stopped or changed. The lines above say why.' }
}

# ---------------------------------------------------------------- install ---
Head $(if ($Restart) { 'Restarting' } elseif ($Remove) { 'Removing' } else { 'Installing' })
# The relay, when there is one. With none this is empty and the service's
# command line below is exactly the one every install sent before it existed.
$turnSet = ''
if ($TurnUrl) { $turnSet = "set THORNSWOOD_TURN_URL=$TurnUrl&& " }
$remote = @"
`$ErrorActionPreference = 'Stop'
if (-not `$node) { 'node is not installed on this machine'; 'SWAP REFUSED'; exit 1 }

# The account voice runs as (#2578, ServiceAccount.ps1). The fail-safe comes
# before anything is stopped or changed: voice goes onto LOCAL SERVICE only
# where LOCAL SERVICE can read none of what no service may.
$(Get-ThornswoodServiceAccountScript)
`$AsSystem = [bool]$([int][bool]$AsSystem)
if (-not `$AsSystem) {
    `$cannot = @(Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach -Own '$Root' -Box (Split-Path -Parent '$Root')))
    if (`$cannot.Count) {
        'LOCAL SERVICE could read what no service may, so voice is not moved onto it:'
        `$cannot
        'Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -AsSystem. Nothing was stopped or changed.'
        'SWAP REFUSED'; exit 1
    }
}

# The port, opened only for a service that answers every interface. On
# loopback (the default since #1304) nothing outside has any business with it,
# so a rule an earlier install made for it goes. The position feed is
# loopback only and needs nothing opened either way.
# Checked under the same name it is created under. This used to look for
# 'Thornswood Voice' and create '$TaskName', so installing dev found the live
# rule already there and never opened 7789 at all. The rule lives in the
# box's own policy store, the only one the firewall takes rules from, and
# Group Policy is refreshed after a change (scripts\vps\BoxFirewall.ps1, #3896).
$(Get-ThornswoodFirewallScript)
`$fwHas = [bool](Get-NetFirewallRule -PolicyStore localhost -DisplayName '$TaskName' -EA SilentlyContinue)
if ('$Bind' -eq '127.0.0.1') {
    if (`$fwHas) { Remove-NetFirewallRule -PolicyStore localhost -DisplayName '$TaskName'; Sync-ThornswoodFirewall }
} elseif (-not `$fwHas) {
    New-NetFirewallRule -PolicyStore localhost -DisplayName '$TaskName' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    Sync-ThornswoodFirewall
}

# THORNSWOOD_SITE is what lets /choose check that a character creation choice
# actually came from the person who owns that profile. That endpoint has to be
# reachable from every person's machine, so it cannot be locked to the loopback,
# and without this it takes anybody's word for anything.
#
# set is used rather than a scheduled task environment block because a task
# action has nowhere to put one, and this is the whole command line anyway.
# THORNSWOOD_VOICE_PORT is what the service actually reads (voice-server.js:28).
# Without it on this line -Port drove the firewall rule, the is-it-free check
# and the health probe, and nothing else, so -Port 7789 opened 7789, checked
# 7789 was free, and then started a service that bound 7778 on top of live.
#
# VOICE RUNS UNDER server-log.js (#2166), which writes voice.log. Until 17
# Oct 2026 it was cmd's >> voice.log 2>&1 with roll-log.ps1 in front, and cmd
# holds that file open for as long as node runs, so voice.log was rolled only
# at a start, by size, five kept, and nothing aged it: a voice service that
# was not restarted kept one file growing, holding profile numbers and
# character names, for as long as it ran. Decided by Patrick on 17 Oct
# (#2166, G5): voice.log goes after 90 days. server-log.js holds the file
# itself, so it rolls it at midnight and at 4 MB and cuts every rolled copy
# to 90 days (--days 90), at a start, at each roll and once an hour, and the
# copies roll-log.ps1 left (.1 to .5) the same way. Voice's own lines carry
# no time, so --stamp puts one in front of each; that is what lets a line be
# aged. The relay line, when there is one, sits with the other settings, so
# it is set in this cmd before node starts.
#
# node goes through cmd's start /high, so it runs High (#2491, the task's
# settings below say why), and server-log.js gives voice its own priority as
# it starts it: /b keeps it in this cmd's console, so the environment holds,
# and /wait keeps the task running until voice ends. server-log.js ends with
# voice's exit code and start leaves cmd's exit code 0 whatever that was, so
# call exit %^errorlevel% hands it back as the task's last result, as before
# (measured 12 Oct). The log path is still on the line, which is how this
# installer finds its own process.
#
# THORNSWOOD_VOICE_AUTH=on is not read by this voice-server.js, which refuses
# every join that cannot prove itself (#1303). It stays on the line because
# -PutBack puts the files the last install replaced back under this same
# task, and a copy from before #1303 reads it and lets unproven joins in
# without it.
`$cmd = ('/c "set THORNSWOOD_SITE=$Site&& set THORNSWOOD_VOICE_PORT=$Port&& set THORNSWOOD_VOICE_BIND=$Bind&& set THORNSWOOD_VOICE_AUTH=on&& set THORNSWOOD_CHAT_RANGE=$ChatRange&& $mostSet$turnSet start "" /b /wait /high "{0}" "{2}" --log "{1}" --days 90 --stamp voice-server.js & call exit %^errorlevel%"' -f `$node.Source, `$log, `$writer)

# The task as it is now, for the way back: a new install that does not answer
# gets its old files AND its old settings back.
`$oldXml = `$null
if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { `$oldXml = (Export-ScheduledTask -TaskName '$TaskName' | Out-String) }

# Going to loopback with somebody still on the raw port cuts them off in
# the middle of a word, and nothing on this box can reach them to say so.
# Refused here, before anything has been stopped.
if ('$Bind' -eq '127.0.0.1') {
    `$direct = @(Get-NetTCPConnection -LocalPort $Port -State Established -EA SilentlyContinue |
                Where-Object { `$_.RemoteAddress -notin '127.0.0.1', '::1' })
    if (`$direct.Count) {
        'REFUSING to bind to loopback: ' + `$direct.Count + ' connection(s) are still on the raw port:'
        foreach (`$d in `$direct) { '   ' + `$d.RemoteAddress + ' since ' + `$d.CreationTime }
        'Those are launchers that have not moved to the proxy. Leave the port open.'
        if (`$Stage -like '.stage-*') { Remove-Item -LiteralPath (Join-Path '$Root' `$Stage) -Recurse -Force -EA SilentlyContinue }
        'SWAP REFUSED'
        exit 1
    }
    'nothing is on the raw port directly, so loopback is safe'
}

# From here the swap runs, and one error must not end it half way.
`$ErrorActionPreference = 'Continue'
# Not `$want: names ignore case here, and `$Want is the swap's list of files.
`$wantBuild = '$expectBuild'
"@

<#
  What every run on the box that stops or starts voice shares, sent in front
  of what that run does: an install, -TaskOnly, -Restart and -Remove. Each
  stops voice through StopIt, and so through StopAndMove.ps1, which goes in
  front of this.
#>
$voiceTools = @"
# Progress records come back as a wall of CLIXML when stdout is not a console.
`$ProgressPreference = 'SilentlyContinue'
`$node = (Get-Command node -EA SilentlyContinue)
if (-not `$node) {
    `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    `$node = Get-Command node -EA SilentlyContinue
}
`$log = Join-Path '$Root' 'voice.log'
`$writer = Join-Path '$Root' 'server-log.js'

<#
  Stop the old service, and mean it.

  A bare Unregister-ScheduledTask leaves the process it started running, so
  the old node kept the port, the new one died on the bind, and every check
  connected to the orphan and called it success: days of voice-server changes
  went to disk and never ran. So: find what is ours and open it, stop the
  task, end whatever of ours is still running, and wait until each of them has
  exited (StopAndMove.ps1, #2928), so the port is free and no file is still
  open when the swap renames it. Until 20 Oct this waited for the port to let
  go instead, fifteen seconds at most, and the renames were tried ten times.

  Ours, and only ours. This used to kill every node running voice-server.js,
  whatever folder it ran from, and there are two of these services, live and
  dev: on 18 September installing dev stopped live. A process is ours if it
  was started from this root, which the log path in its parent cmd's command
  line shows (node's own line is bare, node.exe voice-server.js, measured on
  the box 18 September), or if it sits on the port we are about to bind.
  NOTE the backtick on the log: it belongs to the far side, and written bare
  the outer PowerShell expands it to nothing and the test matches every voice
  process there is, which is how this killed live twice on 18 September.
#>
function StopIt {
    `$mine = @()
    foreach (`$p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue)) {
        if (-not `$p.CommandLine) { continue }
        if (`$p.CommandLine -notlike '*voice-server.js*') { continue }
        if (`$p.CommandLine -like ('*' + `$log + '*')) { `$mine += `$p.ProcessId; continue }
        `$parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + `$p.ParentProcessId) -EA SilentlyContinue
        if (`$parent -and `$parent.CommandLine -like ('*' + `$log + '*')) { `$mine += `$p.ProcessId; continue }
        `$onPort = Get-NetTCPConnection -State Listen -LocalPort $Port -EA SilentlyContinue |
                  Where-Object { `$_.OwningProcess -eq `$p.ProcessId }
        if (`$onPort) { `$mine += `$p.ProcessId }
    }
    # The parent shell of each too, so it cannot outlive the node it started.
    `$shells = @()
    foreach (`$id in (`$mine | Select-Object -Unique)) {
        `$par = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + `$id) -EA SilentlyContinue).ParentProcessId
        if (`$par) {
            `$pp = Get-CimInstance Win32_Process -Filter ("ProcessId=" + `$par) -EA SilentlyContinue
            if (`$pp -and `$pp.Name -eq 'cmd.exe') { `$shells += [int]`$par }
        }
    }
    `$held = @(Get-ThornswoodProcessHeld (@(`$mine) + @(`$shells)))
    `$ThornswoodNotHeld
    Stop-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue
    Stop-ThornswoodProcessHeld `$held
    `$killed = @(`$mine | Select-Object -Unique).Count
    if (`$killed) { "stopped `$killed old voice process(es) for this root" }
    `$others = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue |
                Where-Object { `$_.CommandLine -like '*voice-server.js*' })
    if (`$others.Count) { "left " + `$others.Count + " other voice process(es) alone" }
    # Ours have exited, so anything on the port now is not ours, and is said.
    # A try that throws has not looked, so it is not taken for a free port.
    `$busy = `$false
    `$why = ''
    `$c = New-Object Net.Sockets.TcpClient
    try {
        `$null = `$c.BeginConnect('127.0.0.1', $Port, `$null, `$null).AsyncWaitHandle.WaitOne(300)
        `$busy = `$c.Connected
    } catch { `$why = `$_.Exception.Message }
    finally { `$c.Close() }
    if (`$why) { 'could not tell whether port $Port up here is free: ' + `$why }
    elseif (`$busy) { 'something that is not ours is holding port $Port up here' }
}

# Whether everything StopIt ended has exited, and nothing else: StopIt has
# already said each one that has not. One that has not still holds the port,
# so a new voice started now dies on the bind while the old one goes on
# answering; the runs that start voice again without a swap ask this first,
# as the swap does (Swap.ps1).
function StoppedAll {
    return (-not @(@(`$ThornswoodStillRunning) + @(`$ThornswoodNotHeld) | Where-Object { `$_ }).Count)
}

# Any other task that starts voice-server.js from this root (#2008). The
# one-off Fix-Voice.ps1 registered ThornswoodVoice on 13 September, to start
# C:\Thornswood-Voice\voice-server.js at boot with none of this task's
# environment, so no auth and no loopback bind, and no install took it off:
# after a reboot, whichever of the two got the port first was live voice.
# Another root's task is not ours: live's and dev's leave each other alone.
function RemoveStrayTasks {
    `$rootDir = '$Root'.TrimEnd('\')
    foreach (`$t in @(Get-ScheduledTask -EA SilentlyContinue)) {
        if (`$t.TaskName -eq '$TaskName') { continue }
        foreach (`$a in @(`$t.Actions)) {
            `$line = [string]`$a.Execute + ' ' + [string]`$a.Arguments
            if (`$line -notlike '*voice-server.js*') { continue }
            `$here = ([string]`$a.WorkingDirectory).TrimEnd('\') -ieq `$rootDir -or `$line.ToLowerInvariant().Contains((`$rootDir + '\voice-server.js').ToLowerInvariant())
            if (-not `$here) { continue }
            Stop-ScheduledTask -TaskName `$t.TaskName -TaskPath `$t.TaskPath -EA SilentlyContinue
            Unregister-ScheduledTask -TaskName `$t.TaskName -TaskPath `$t.TaskPath -Confirm:`$false
            'took off the task ' + `$t.TaskName + ', which also started voice-server.js from ' + `$rootDir
            break
        }
    }
}

# This install's task, or on the way back the one there was before it.
# -PutBack leaves the task as it is and only starts it.
function StartIt {
    if (-not `$KeepTask) {
        if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false }
        if (`$Rolling) {
            if (-not `$oldXml) { 'there was no task before this install, so nothing is started'; return }
            Register-ScheduledTask -TaskName '$TaskName' -Xml `$oldXml | Out-Null
            'the task is back as it was before this install'
        } else {
            `$action = New-ScheduledTaskAction -Execute "`$env:SystemRoot\System32\cmd.exe" -Argument `$cmd -WorkingDirectory '$Root'
            # Priority 1, high, with node started through start /high
            # (#2491). Decided by Patrick on 12 Oct 2026 at about 6:20 PM:
            # "we need to fix it so the servers run on high priority". Voice
            # runs with the game servers (Install-ThornswoodServer.ps1), above
            # the six build runners, the site, Caddy and the bot, which are
            # all Normal. Priority 1 makes this task's cmd.exe High, and a
            # process started from a High one runs Normal unless it asks for
            # another class, so node ran Normal at 1 until start /high asked:
            # measured 12 Oct, node High, I/O priority 2 and memory priority
            # 5, the same I/O and memory priority as at 4. Never 0, which is
            # realtime. Never the default of 7 either (#1968): BelowNormal,
            # I/O priority 1 (low) and memory priority 2, which held the game
            # server's reads back (#1931). tests\test-service-task-priority.ps1
            # measures all three.
            `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 1
            # LOCAL SERVICE, Limited, with a SID of its own and the grants on
            # this root that go to it (#2578). Back on SYSTEM when the SID
            # cannot be looked up or the grants cannot be written.
            `$principal = New-ThornswoodServicePrincipal -AsSystem:`$AsSystem
            Register-ScheduledTask -TaskName '$TaskName' -Action `$action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings `$settings -Principal `$principal | Out-Null
            if (-not `$AsSystem) {
                `$why = ''
                `$sid = Get-ThornswoodTaskSid '$TaskName'
                if (-not `$sid) { `$why = 'the task SID NT TASK\$TaskName could not be looked up' }
                else {
                    try {
                        Grant-ThornswoodServiceFolder -Root '$Root' -Sid `$sid -Writable 'chat' -Files 'voice.log', 'voice.log.*', 'token-key.txt'
                        # What it makes is its own, not every service's (#4077).
                        Set-ThornswoodTaskOwner -TaskName '$TaskName' -Sid `$sid -Action `$action -Roots '$Root'
                    } catch { `$why = 'its folder could not be granted to it: ' + `$_.Exception.Message }
                }
                if (`$why) {
                    `$why + ', so the task goes back on SYSTEM'
                    Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false
                    Register-ScheduledTask -TaskName '$TaskName' -Action `$action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings `$settings -Principal (New-ThornswoodServicePrincipal -AsSystem) | Out-Null
                } else { 'the task runs as LOCAL SERVICE, Limited, as NT TASK\$TaskName' }
            }
            RemoveStrayTasks
        }
    }
    # Rolled whatever its size rather than deleted, so the run before this
    # install is a voice.log.<digits> of its own and the tails below read only
    # this one, and every rolled copy cut to 90 days (#2166).
    try { & `$node.Source `$writer --log `$log --days 90 --roll } catch { 'could not roll voice.log: ' + `$_.Exception.Message }
    Start-ScheduledTask -TaskName '$TaskName'
}

function Build {
    try { return [string](Invoke-RestMethod -Uri 'http://127.0.0.1:$Port/health' -TimeoutSec 2).build } catch { return '' }
}

# The port answering is not the test. Which build answers is the test.
`$healthWhy = ''
function Healthy {
    `$until = (Get-Date).AddSeconds(`$Wait)
    while (`$true) {
        `$up = `$false
        `$c = New-Object Net.Sockets.TcpClient
        try {
            `$null = `$c.BeginConnect('127.0.0.1', $Port, `$null, `$null).AsyncWaitHandle.WaitOne(500)
            `$up = `$c.Connected
        } catch { `$script:healthWhy = `$_.Exception.Message }
        finally { `$c.Close() }
        if (`$up) {
            if (`$Rolling -or -not `$wantBuild) { return `$true }
            if ((Build) -eq `$wantBuild) { return `$true }
        }
        if ((Get-Date) -gt `$until) { return `$false }
        Start-Sleep -Milliseconds 700
    }
}

function Answer { "voice is up on $Port running " + (Build) }

function Why {
    `$seen = Build
    if (`$wantBuild -and `$seen -and `$seen -ne `$wantBuild) {
        "WRONG BUILD on $Port. sent `$wantBuild, running '" + `$seen + "'. That means an old process is still answering."
    }
    if (`$healthWhy) { 'the last try to connect on $Port said: ' + `$healthWhy }
    'voice.log says:'
    if (Test-Path -LiteralPath `$log) { Get-Content -LiteralPath `$log -Tail 20 } else { 'nothing was written' }
}

"@

<#
  -TaskOnly (#2491): the task again with this install's settings, and
  nothing sent. The same StopIt, StartIt, Healthy, Answer and Why as an
  install, after the same lines above, in place of the swap: what answers
  now is what must answer again, under the new task, and if it does not, the
  task it had goes back, exported above exactly as it was, and is started.
  The last line is TASK OK or TASK ROLLED BACK. StopIt ends what it stops
  through StopAndMove.ps1 (Swap.ps1's $ThornswoodStopAndMoveText), which goes
  in front, as it does in front of the swap.
#>
$taskOnlyBlock = @'
$Rolling = $false
$wantBuild = Build
# Held while it is stopped (#5155, ServerHold.ps1), so the watchdog leaves
# it; every way out below takes the hold away.
Set-ThornswoodHold -Target $HoldTarget -Why 'registering voice''s task again' -By $HoldBy
StopIt
if (-not (StoppedAll)) { Clear-ThornswoodHold -Target $HoldTarget; 'what the stop ended has not all exited, so voice was not started again'; 'TASK NOT STARTED'; exit 1 }
StartIt
if (Healthy) {
  Clear-ThornswoodHold -Target $HoldTarget
  'PASS: ' + (Answer)
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue)) {
    $up = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId) -EA SilentlyContinue
    if (-not $up -or $up.CommandLine -notlike ('*' + $log + '*')) { continue }
    $class = 'unreadable'
    $proc = Get-Process -Id $p.ProcessId -EA SilentlyContinue
    if (-not $proc) { 'node, pid ' + $p.ProcessId + ', has already gone'; continue }
    try { $class = [string]$proc.PriorityClass } catch { $class = 'unreadable (' + $_.Exception.Message + ')' }
    'node, pid ' + $p.ProcessId + ', runs at ' + $class + ' priority'
  }
  'TASK OK'
  exit 0
}
'FAIL: it did not answer within ' + $Wait + ' seconds under the new task'
Why
StopIt
$Rolling = $true
StartIt
if (Healthy) { 'the task it had is back and it is answering again: ' + (Answer) }
else { 'THE TASK IT HAD IS BACK AND IT STILL IS NOT ANSWERING'; Why }
Clear-ThornswoodHold -Target $HoldTarget
'TASK ROLLED BACK'
exit 1
'@

<#
  -Restart: voice stopped and started again under the task it has, nothing
  sent and nothing registered. Until 21 Oct 2026 (#2952) this was one line,
  Stop-ScheduledTask, a second's sleep, Start-ScheduledTask, and "restarted"
  whatever happened. Measured on the box that day, on dev voice:
  Stop-ScheduledTask returned in 63 ms with the task already Ready and all
  four of its processes (cmd, conhost, server-log.js and voice-server.js)
  still running, node still on the port; all four were gone 673 ms in. So the
  second was a guess that node had let go of the port, and when it guessed
  wrong the new node died on the bind and nothing said so.

  Now it is StopIt, which waits until each process has exited
  (StopAndMove.ps1), then StartIt with the task kept, then Healthy, held to
  the build voice-server.js on the box names, since that is what the start
  runs. The last line is RESTART OK or RESTART FAILED.
#>
$restartBlock = @"
`$ErrorActionPreference = 'Continue'
`$Rolling = `$false
if (-not `$node) { 'node is not installed on this machine, so voice was not stopped'; 'RESTART FAILED'; exit 1 }
if (-not (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue)) { 'there is no task $TaskName up here, so voice was not stopped. Install it first.'; 'RESTART FAILED'; exit 1 }
`$wantBuild = ''
`$vs = Join-Path '$Root' 'voice-server.js'
try { `$m = [regex]::Match([IO.File]::ReadAllText(`$vs), "const\s+BUILD\s*=\s*'([^']+)'"); if (`$m.Success) { `$wantBuild = `$m.Groups[1].Value } }
catch { 'could not read ' + `$vs + ': ' + `$_.Exception.Message }
if (-not `$wantBuild) { `$vs + ' names no build, so only that port $Port answers is checked' }
# Held while it is stopped (#5155, ServerHold.ps1), so the watchdog leaves
# it; every way out below takes the hold away.
Set-ThornswoodHold -Target `$HoldTarget -Why 'restarting voice' -By `$HoldBy
StopIt
if (-not (StoppedAll)) { Clear-ThornswoodHold -Target `$HoldTarget; 'what the stop ended has not all exited, so voice was not started again'; 'RESTART FAILED'; exit 1 }
StartIt
`$ok = Healthy
Clear-ThornswoodHold -Target `$HoldTarget
if (`$ok) { 'PASS: ' + (Answer); 'RESTART OK'; exit 0 }
'FAIL: it did not answer within ' + `$Wait + ' seconds of being started'
Why
'RESTART FAILED'
exit 1
"@

<#
  -Remove: voice stopped the same way, and only once every process of it
  has exited are its task, its firewall rule and its folder taken away, each
  saying why when it cannot be. Until 21 Oct 2026 (#2952) the folder went in
  the same instant as Stop-ScheduledTask, which returns before voice has
  exited, with every error silenced, so "removed" could leave the folder
  half there; and the rule it took away was always live's, 'Thornswood
  Voice', whichever service was being removed, where an install makes it
  under the task's own name.
#>
$removeBlock = @"
`$ErrorActionPreference = 'Continue'
StopIt
if (-not (StoppedAll)) { 'what the stop ended has not all exited, so nothing was taken away'; 'NOT REMOVED'; exit 1 }
if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) {
    try { Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false -EA Stop; 'took off the task $TaskName' }
    catch { 'could not take off the task ${TaskName}: ' + `$_.Exception.Message; 'NOT REMOVED'; exit 1 }
}
$(Get-ThornswoodFirewallScript)
if (Get-NetFirewallRule -PolicyStore localhost -DisplayName '$TaskName' -EA SilentlyContinue) {
    try { Remove-NetFirewallRule -PolicyStore localhost -DisplayName '$TaskName' -EA Stop; Sync-ThornswoodFirewall; 'took away the firewall rule $TaskName' }
    catch { 'could not take away the firewall rule ${TaskName}: ' + `$_.Exception.Message; 'NOT REMOVED'; exit 1 }
}
if (Test-Path -LiteralPath '$Root') {
    try { Remove-Item -LiteralPath '$Root' -Recurse -Force -EA Stop; 'took away $Root' }
    catch { 'could not take away ${Root}: ' + `$_.Exception.Message + '; open under it then: ' + (Get-ThornswoodPathHolders '$Root'); 'NOT REMOVED'; exit 1 }
}
'REMOVED'
"@

# Each part of a run's far script is a here-string, and a here-string's last
# line has no line break after it, so the parts are joined on line breaks: put
# end to end, $remote's last line and -TaskOnly's first were one line the box
# could not parse (#2952, 20 Oct).
if ($Restart) {
    # The hold the restart writes while voice is stopped (#5155) goes with the values.
    $vars = $ThornswoodHoldText + (ServiceSwapVars $Root 'none' 'none' $Wait ([ordered]@{}) @() $TaskName) + '$KeepTask = $true' + "`r`n"
    $restartOut = @(Remote (@($vars, $ThornswoodStopAndMoveText, $voiceTools, $restartBlock) -join "`r`n") | ForEach-Object { Say "  $_"; "$_".Trim() })
    if ($restartOut -notcontains 'RESTART OK') { Die 'voice was not restarted. The lines above say what is running.' }
    Say 'restarted, and voice answers again' 'Green'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

if ($Remove) {
    $vars = (ServiceSwapVars $Root 'none' 'none' $Wait ([ordered]@{}) @()) + '$KeepTask = $true' + "`r`n"
    $removeOut = @(Remote (@($vars, $ThornswoodStopAndMoveText, $voiceTools, $removeBlock) -join "`r`n") | ForEach-Object { Say "  $_"; "$_".Trim() })
    if ($removeOut -notcontains 'REMOVED') { Die 'voice was not taken off. The lines above say what is left.' }
    Say 'Gone. The game server is untouched.' 'Green'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

if ($TaskOnly) {
    $vars = $ThornswoodHoldText + (ServiceSwapVars $Root 'none' 'none' $Wait ([ordered]@{}) @() $TaskName) + '$KeepTask = $false' + "`r`n"
    $taskOut = @(Remote (@($vars, $ThornswoodStopAndMoveText, $voiceTools, $remote, $taskOnlyBlock) -join "`r`n") | ForEach-Object { Say "  $_"; "$_".Trim() })
    if ($taskOut -notcontains 'TASK OK') { Die 'voice was not restarted under a new task. The lines above say what is running.' }
    Say 'registered again, and voice answers under the new task' 'Green'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

$keepTask = '$KeepTask = $false'
$pick = ''
if ($PutBack) { $keepTask = '$KeepTask = $true'; $pick = $putBackPick }
$vars = (ServiceSwapVars $Root $stageName $prevName $Wait $hashes @() $TaskName) + $keepTask + "`r`n" + $pick
$swapOut = @(Remote (@($vars, $voiceTools, $remote, $serviceSwapBlock) -join "`r`n") | ForEach-Object { Say "  $_"; "$_".Trim() })
if (-not (Show-SwapResult $swapOut "$Root\.prev-<stamp>")) { Die 'voice was not swapped in. The lines above say what is running.' }

# ---------------------------------------------------------------- verify ----
Head 'Checking from here'

<#
  What "working" looks like depends on the bind, and it used to not.

  This reached for the raw address and called silence a failure. Once the
  service is on loopback that silence is the entire point, so a correct install
  printed "Installed, but nothing is answering" in red. That is how somebody
  panics and reverts a change that worked, which is worse than the change
  having failed.

  So: on 0.0.0.0 the port must answer. On 127.0.0.1 it must NOT, and the
  service is reached through whatever is proxying instead.

  One try (#2961). Until 21 Oct 2026 this tried up to 15 times a second
  apart, which waited for nothing: the firewall rule is made before the old
  voice is stopped, and the box has already had the new build answer on this
  port. Measured that day on the box: New-NetFirewallRule had the rule in
  the active store when it returned, and connections from outside to 7789
  came in 0.3 s after it, with no rule before that dropped. The try gets 5 s
  so TCP's own resends of a lost SYN (at 1 s and 3 s) are inside it; a
  connection from outside took 0.1 s. The try and the witness below are
  Vps.ps1's "from outside" (#2975), shared with the server scripts.

  A port that is silent is only shut if this machine reaches the box's raw
  ports at all. A cloud thread's container reaches nothing but HTTPS, through
  its proxy, so from there every raw port is silent, and this printed
  "correctly shut" whatever the firewall did. The game server's resources
  port (3000 live, 7788 dev, the one every launcher reads) answers
  everybody, so it is asked the same way, and when it is silent too the
  voice port was not measured from here, and this says so.
#>
# Vps.ps1 "from outside" (#2975) is the one try, shared with Publish-Server
# and Deploy-Server.
$resPort = $(if ($voiceChannel -eq 'dev') { 7788 } else { 3000 })
$outside = Test-ThornswoodFromOutside $VpsHost $Port $resPort
$voiceTry = $outside.Said
$reachable = $outside.Answered
$reachWhy = $outside.NotKnown

Write-Host ''
if ($Bind -eq '127.0.0.1') {
    if ($reachable) {
        Say "$VpsHost`:$Port IS STILL ANSWERING from outside, and it should not be." 'Red'
        Say '  The bind did not take, or the firewall rule is still open.' 'Red'
        Say "  ssh $target `"pwsh -NoProfile -Command Get-Content '$Root\voice.log' -Tail 20`"" 'DarkGray'
    } elseif ($reachWhy) {
        Say "Loopback only, and whether ${VpsHost}:$Port is shut from outside is not known: $reachWhy." 'Yellow'
    } else {
        Say "Loopback only, and ${VpsHost}:$Port is correctly shut from out here ($voiceTry)." 'Green'
    }
    # The service is only useful if something is carrying it, so say whether
    # anything actually is rather than leaving that to be assumed. This goes
    # over HTTPS, so it is asked from anywhere, a cloud thread included.
    # Through the site /health says only ok (#3806): the build, bind and auth
    # go to a caller on the box, and the build was read there above.
    if (-not $reachable) {
        $via = ''
        if ($Site) { $via = $Site.TrimEnd('/') + $(if ($Port -eq 7778) { '/voice' } else { '/voice-dev' }) }
        if ($via) {
            try {
                $h = Invoke-RestMethod ($via + '/health') -TimeoutSec 10
                if ($h -and $h.PSObject.Properties['ok'] -and $h.ok -eq $true) {
                    Say "Reached it through $via, which says ok." 'Green'
                } else {
                    Say "Something answered at $via/health, but not voice's ok, so the site is not carrying voice there." 'Red'
                    Say '  Check the Caddyfile has the handle_path block for this port.' 'DarkGray'
                }
            } catch {
                Say "But $via/health did not answer either, so nothing is carrying it." 'Red'
                Say '  Check the Caddyfile has the handle_path block for this port.' 'DarkGray'
            }
        }
    }
} elseif ($reachable) {
    Say "Voice is up at http://${VpsHost}:$Port" 'Green'
    Write-Host ''
    Say 'The position feed is part of game\gamemode.js, so nothing else needs running for it.' 'Gray'
} elseif ($reachWhy) {
    Say "Voice answers on the box, and whether ${VpsHost}:$Port answers from outside is not known: $reachWhy." 'Yellow'
} else {
    Say "Installed, but ${VpsHost}:$Port was $voiceTry from out here, though voice answers on the box and the game server answers from here." 'Red'
    Say "  The firewall rule '$TaskName' up there, or something between, is not letting it in." 'Red'
    Say "  .\scripts\vps\Remote.ps1 `"Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName '$TaskName' | Get-NetFirewallPortFilter`"" 'DarkGray'
}
# The service's files are in place: the box records that it runs this
# artifact, and /health says so from then on (Artifact.ps1).
# Only now, with the new build answering: the record it had goes into .prev
# with the files it describes (Swap.ps1). After -PutBack, the record that came
# back with the files is the one recorded.
if ($PutBack) { Restore-SwapRecord $target $ssh $Root $swapOut '' 'voice' }
else {
    Save-SwapPreviousRecord $target $ssh $Root $prevName
    $null = Set-ThornswoodArtifactCurrent -Artifact $artifact -Target $target -SshArgs $ssh -Root $Root
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
