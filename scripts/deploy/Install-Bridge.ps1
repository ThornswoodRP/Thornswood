<#
  Install-Bridge.ps1

  Puts the box's end of ssh on the VPS (#2753, #2891), the way every machine
  reaches the box's ssh: scripts\vps\bridge\bridge.js, as the task
  "Thornswood Bridge", listening on 127.0.0.1:7790. Caddy hands
  wss://thornswood.net/box/ to it (the handle_path /box/* block in
  scripts\deploy\Caddyfile, sent by Setup-Domain.ps1), and it joins each
  WebSocket that brings a token it holds to the box's own sshd on
  127.0.0.1:22. Run it from a machine whose way in already works; it does the
  remote half over ssh, so a bridge that does not answer is put back as it
  was before this ends.

      .\scripts\deploy\Install-Bridge.ps1            install it, or the newest
                                                     commit of it, and start it
      .\scripts\deploy\Install-Bridge.ps1 -Status    what is there and its log
      .\scripts\deploy\Install-Bridge.ps1 -Record    record what runs as this
                                                     commit, when its files
                                                     are this commit's; it
                                                     stops and starts nothing
      .\scripts\deploy\Install-Bridge.ps1 -Remove    take it off again

  Nobody gets through it until scripts\vps\Grant-BoxAccess.ps1 has given
  somebody a token (its digest in -Root\tokens, one file per name) and put
  their key on the box. With no tokens every WebSocket is refused.
  Grant-BoxAccess.ps1 -Remove takes one name's away again.

  WHAT IT RUNS AS. LOCAL SERVICE, Limited, with a SID of its own, like voice
  and Caddy (#2578, ServiceAccount.ps1), after the same fail-safe. The folder
  takes nothing from C:\: SYSTEM, Administrators and whoever runs this, plus
  the task's own SID to read it and write its log, so no other service, all
  LOCAL SERVICE too, can read the tokens' digests. -AsSystem registers it as
  SYSTEM, Highest, the way back if LOCAL SERVICE cannot run it.

  WHAT IT SENDS. A commit or nothing (Artifact.ps1, #459, #1121): bridge.js,
  ws.js and Server-Log.js out of HEAD, checked against the commit
  (Assert-ThornswoodSourceIntegrity) before anything is sent. They go into
  -Root\.stage-<stamp>, are checked there by hash and node --check with the
  bridge still running, and only then is it stopped and they are renamed in;
  what they replace goes to .prev-<stamp>. If the new one does not answer,
  the old files and the old task go back and are started.

  THE INSTALL RUNS ON THE BOX ON ITS OWN (#3214). Every machine's ssh to
  the box goes through the bridge, so the session that stopped it was cut
  by its own stop. On 30 Oct 2026 from One the box finished the swap and
  the new bridge ran, but what it said after the stop never arrived (ssh's
  last lines, among the far side's CLIXML, read as "Cannot process the XML
  from the 'Error' stream"), BRIDGE OK was never seen, it said STOP, and
  the record of what the box runs was not written. So the install goes to
  the box as a detached run (Get-ThornswoodDetachedRun, Send-Script.ps1, as
  Setup-Domain.ps1 restarts Caddy since #3193), which waits for the session
  that started it to end, and fresh sessions read its report once the
  bridge is back. -Record writes that record for a bridge already running
  this commit's files, which it checks by hash, and touches nothing else.

  THE LOG. bridge.log, one line per session (opened, ended, how long, how
  many bytes), no address and nothing from inside the session, written by
  server-log.js with a time on each line and kept for 90 days, the same as
  voice.log (#2166).
#>
[CmdletBinding()]
param(
    [string]$VpsHost  = '',
    [string]$VpsUser  = '',
    [string]$Root     = 'C:\Thornswood-Bridge',
    [int]$Port        = 7790,
    [string]$TaskName = 'Thornswood Bridge',
    # The address the outside check asks. The bridge answers a plain request
    # with "box bridge: not here", which the site never says (its own 404 is
    # "not here"), so that answer through here is the bridge and Caddy
    # carrying it (#2875).
    [string]$Site     = 'https://thornswood.net',
    [int]$Wait        = 20,
    [switch]$Status,
    [switch]$Record,
    [switch]$Remove,
    [switch]$AsSystem,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
# The bridge's answer to a plain request, the same line as PLAIN in bridge.js.
$Plain = 'box bridge: not here'

# What a plain GET of a URL answers: @{ Code; Body; Why }, Code 0 when nothing
# answered and Why says what happened instead. Every check here reads the
# bridge's 404 through this, on One and on the box (sent ahead of the scripts
# that use it). Invoke-WebRequest can't do it: on the box's Windows PowerShell
# 5.1 a 404 leaves ErrorDetails empty, so its body was never seen and the
# install rolled back (#2875). WebRequest hands back the response the same way
# in 5.1 and 7.
function Get-PlainAnswer {
    param([string]$Url, [int]$Seconds)
    $q = [Net.WebRequest]::Create($Url)
    $q.Timeout = $Seconds * 1000
    $q.ReadWriteTimeout = $Seconds * 1000
    $r = $null
    $why = ''
    try { $r = $q.GetResponse() }
    catch {
        $why = $_.Exception.Message
        $e = $_.Exception
        while ($e -and -not ($e -is [Net.WebException])) { $e = $e.InnerException }
        if ($e -and $e.Response) { $r = $e.Response }
    }
    if (-not $r) { return @{ Code = 0; Body = ''; Why = $why } }
    try {
        $body = (New-Object IO.StreamReader($r.GetResponseStream())).ReadToEnd()
        return @{ Code = [int]$r.StatusCode; Body = $body.Trim(); Why = '' }
    }
    finally { $r.Close() }
}
$SendPlainAnswer = "function Get-PlainAnswer {" + ${function:Get-PlainAnswer} + "}"
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here 'ServiceAccount.ps1')
# The hold the install writes while it has the bridge stopped (#5155).
. (Join-Path $Here '..\vps\ServerHold.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
foreach ($t in 'ssh', 'scp') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
        Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client."
    }
}
if (@($Status, $Record, $Remove | Where-Object { $_ }).Count -gt 1) { Die '-Status only reads, -Record only records and -Remove takes it off, so pass one of them. Nothing was sent.' }

function Remote($script) {
    # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
    # it off the box before it runs, and the far side's exit code comes back.
    return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script
}

# A path on the box, joined as text: Join-Path checks the drive exists here,
# and there is no C: off Windows (#2872).
$log = $Root.TrimEnd('\') + '\bridge.log'

# ------------------------------------------------------------------ status --
if ($Status) {
    Head 'On the VPS'
    Remote @"
`$ErrorActionPreference = 'SilentlyContinue'
`$t = Get-ScheduledTask -TaskName '$TaskName'
if (`$t) { `$i = Get-ScheduledTaskInfo -TaskName '$TaskName'; 'task      ' + `$t.State + ' as ' + `$t.Principal.UserId + ', last ran ' + `$i.LastRunTime + ' result ' + `$i.LastTaskResult } else { 'task      NOT REGISTERED' }
# Whose tokens are there, never what they are.
`$names = @(Get-ChildItem -LiteralPath '$Root\tokens' -File | ForEach-Object { `$_.Name })
if (`$names.Count) { 'tokens    for ' + (`$names -join ', ') } else { 'tokens    NONE, so every WebSocket is refused' }
$SendPlainAnswer
`$a = Get-PlainAnswer 'http://127.0.0.1:$Port/' 5
if (`$a.Code -eq 404 -and `$a.Body -eq '$Plain') { 'port      $Port answers as the bridge' }
elseif (`$a.Code) { 'port      $Port answered ' + `$a.Code + ' but not as the bridge: ' + `$a.Body }
else { 'port      $Port did not answer: ' + `$a.Why }
if (Test-Path -LiteralPath '$log') { ''; '--- bridge.log, last 15 ---'; Get-Content -LiteralPath '$log' -Tail 15 }
"@ | ForEach-Object { Say "  $_" }
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# The task, then anything of ours still running: server-log.js names
# bridge.log on its command line, and bridge.js is its child. Each found and
# opened before the task is asked to stop, then waited for until it has
# exited (StopAndMove.ps1, which goes up in front, #2928), so the port is free
# and no file is open when the install renames it. Until 20 Oct this waited
# for the port to close instead, ten seconds at most. Says what it stopped,
# and leaves in $stopOk whether everything of ours exited and the port is
# free: a function that returned that as well as saying lines gave its caller
# the lines, and a stop that failed was never refused.
$stopIt = [IO.File]::ReadAllText((Join-Path $Here 'StopAndMove.ps1')) + "`r`n" + @"
function StopIt {
    `$all = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue)
    `$mine = @(`$all | Where-Object { `$_.CommandLine -and `$_.CommandLine -like ('*' + '$log' + '*') })
    `$ids = @()
    foreach (`$p in `$mine) {
        `$ids += [int]`$p.ProcessId
        `$ids += @(`$all | Where-Object { `$_.ParentProcessId -eq `$p.ProcessId } | ForEach-Object { [int]`$_.ProcessId })
    }
    `$held = @(Get-ThornswoodProcessHeld `$ids)
    `$ThornswoodNotHeld
    Stop-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue
    Stop-ThornswoodProcessHeld `$held
    if (`$mine.Count) { 'stopped ' + `$mine.Count + ' bridge process(es)' }
    `$script:stopOk = -not @(@(`$ThornswoodStillRunning) + @(`$ThornswoodNotHeld) | Where-Object { `$_ }).Count
    # Ours have exited, so anything still listening is not ours.
    if (`$stopOk -and (Get-NetTCPConnection -State Listen -LocalPort $Port -EA SilentlyContinue)) {
        'something that is not ours is listening on port $Port'
        `$script:stopOk = `$false
    }
}
"@
# The hold goes in front too (#5155), so StopIt's callers can hold and release the task.
$stopIt = (Get-ThornswoodHoldScript -Script 'Install-Bridge.ps1') + $stopIt

# ------------------------------------------------------------------ remove --
if ($Remove) {
    Head 'Removing'
    # Taking the bridge off cuts the session that does it and every one after,
    # from a machine that reaches the box only through it.
    if (Test-ThornswoodBridgeSsh $VpsHost) { Die 'ssh to the box goes through the bridge from here, so taking it off would cut this session and leave no way back in. Run -Remove from the box itself or from a machine that reaches its port 22. Nothing was sent.' }
    $out = @(Remote @"
$stopIt
StopIt
Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false -EA SilentlyContinue
Remove-Item -LiteralPath '$Root' -Recurse -Force -EA SilentlyContinue
if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { 'STILL THERE' } elseif (Test-Path -LiteralPath '$Root') { 'FOLDER STILL THERE' } else { 'REMOVED' }
"@ | ForEach-Object { Say "  $_"; "$_".Trim() })
    if ($out -notcontains 'REMOVED') { Die 'it was not all taken off. The lines above say what is left.' }
    Say '  Gone, tokens and all. Each key on the box goes with scripts\vps\Grant-BoxAccess.ps1 -Name <name> -Remove.' 'Green'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ----------------------------------------------------------------- build ----
# A commit or nothing (#1121), built before anything asks the box anything.
. (Join-Path $Here 'Artifact.ps1')
$repo = Join-Path $Here '..\..'
$artifact = New-ThornswoodArtifact -Component bridge -RepoDir $repo -Paths 'scripts/vps/bridge/bridge.js', 'scripts/vps/bridge/ws.js' -AlsoSends 'scripts/vps/Server-Log.js'
Say ('artifact ' + (Format-ThornswoodArtifact $artifact)) 'DarkGray'
Assert-ThornswoodSourceIntegrity -Artifact $artifact -RepoDir $repo
# The log writer is not in the zip: -AlsoSends only holds it to the commit,
# and it goes from the checkout, as Install-Voice.ps1 sends it.
$send = [ordered]@{
    'bridge.js'     = Join-Path $artifact.Folder 'scripts\vps\bridge\bridge.js'
    'ws.js'         = Join-Path $artifact.Folder 'scripts\vps\bridge\ws.js'
    'server-log.js' = Join-Path $Here '..\vps\Server-Log.js'
}
foreach ($k in $send.Keys) { if (-not (Test-Path -LiteralPath $send[$k])) { Die "not found: $($send[$k]). Nothing was sent." } }
$hashes = [ordered]@{}
foreach ($k in $send.Keys) { $hashes[$k] = (Get-FileHash -LiteralPath $send[$k] -Algorithm SHA256).Hash }
Send-ThornswoodArtifact -Artifact $artifact -Target $target -SshArgs $ssh

# ----------------------------------------------------------------- record ---
# What runs is recorded as this commit only when its three files are this
# commit's, byte for byte, and it answers as the bridge. Nothing is stopped,
# started or moved.
if ($Record) {
    Head 'Recording what runs'
    $want = ($hashes.Keys | ForEach-Object { "'$_' = '$($hashes[$_])'" }) -join '; '
    $out = @(Remote @"
`$ProgressPreference = 'SilentlyContinue'
`$want = [ordered]@{ $want }
`$off = 0
foreach (`$f in `$want.Keys) {
    `$p = Join-Path '$Root' `$f
    if (-not (Test-Path -LiteralPath `$p)) { `$f + ' is not there'; `$off++; continue }
    if ((Get-FileHash -LiteralPath `$p -Algorithm SHA256).Hash -ne `$want[`$f]) { `$f + ' is not this commit''s'; `$off++ } else { `$f + ' is this commit''s' }
}
$SendPlainAnswer
`$a = Get-PlainAnswer 'http://127.0.0.1:$Port/' 5
if (`$a.Code -eq 404 -and `$a.Body -eq '$Plain') { 'it answers as the bridge on 127.0.0.1:$Port' } else { 'it does not answer as the bridge on 127.0.0.1:$Port'; `$off++ }
if (`$off) { 'NOT RECORDED' } else { 'MATCHES' }
"@ | ForEach-Object { Say "  $_"; "$_".Trim() })
    if ($out -notcontains 'MATCHES') { Die 'what runs is not this commit, so nothing was recorded. Install-Bridge.ps1 without -Record installs it.' }
    $null = Set-ThornswoodArtifactCurrent -Artifact $artifact -Target $target -SshArgs $ssh -Root $Root
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ----------------------------------------------------------------- stage ----
Head 'Staging'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = '.stage-' + $stamp
$prev = '.prev-' + $stamp
$made = @(Remote @"
`$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath '$Root')) { New-Item -ItemType Directory -Path '$Root' -Force | Out-Null }
# Nothing from C:\: the tokens' digests are in here (the header says why).
try {
  `$broad = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-19')
  `$acl = Get-Acl -LiteralPath '$Root'
  `$acl.SetAccessRuleProtection(`$true, `$false)
  foreach (`$r in @(`$acl.GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]))) {
    if (`$broad -contains `$r.IdentityReference.Value) { [void]`$acl.RemoveAccessRuleSpecific(`$r) }
  }
  foreach (`$s in @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$s)), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
  }
  # Only the access rules are written back (issue #1120).
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath '$Root' -Force), `$acl)
} catch { 'COULD NOT LOCK: ' + `$_.Exception.Message; exit 1 }
Get-ChildItem -LiteralPath '$Root' -Directory -Force -EA SilentlyContinue | Where-Object { `$_.Name -like '.stage-*' } |
  ForEach-Object { Remove-Item -LiteralPath `$_.FullName -Recurse -Force -EA SilentlyContinue }
New-Item -ItemType Directory -Force -Path '$Root\$stage' | Out-Null
'READY'
"@ | ForEach-Object { "$_".Trim() })
if ($made -notcontains 'READY') { Die ("could not make $Root\$stage up there: " + ($made -join ' ') + '. The bridge was not touched.') }
$rootFar = $Root -replace '\\', '/'
foreach ($k in $send.Keys) {
    Invoke-ThornswoodNative { & scp @ssh $send[$k] "${target}:$rootFar/$stage/$k" }
    if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE for $k. The bridge was not touched." }
}
Say '  staged' 'Green'

# ---------------------------------------------------------------- install ---
Head 'Installing'
$want = ($hashes.Keys | ForEach-Object { "'$_' = '$($hashes[$_])'" }) -join '; '
$install = @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
`$node = Get-Command node -EA SilentlyContinue
if (-not `$node) {
    `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    `$node = Get-Command node -EA SilentlyContinue
}
if (-not `$node) { 'node is not installed on this machine'; 'BRIDGE REFUSED'; exit 1 }
`$stage = '$Root\$stage'
`$want = [ordered]@{ $want }

# The stage, checked with the old bridge still running.
foreach (`$f in `$want.Keys) {
    `$p = Join-Path `$stage `$f
    if (-not (Test-Path -LiteralPath `$p) -or (Get-FileHash -LiteralPath `$p -Algorithm SHA256).Hash -ne `$want[`$f]) { `$f + ' did not arrive as it was sent'; 'BRIDGE REFUSED'; exit 1 }
}
foreach (`$f in 'bridge.js', 'ws.js', 'server-log.js') {
    `$said = & `$node.Source --check (Join-Path `$stage `$f) 2>&1
    if (`$LASTEXITCODE -ne 0) { `$f + ' does not parse: ' + (`$said -join ' '); 'BRIDGE REFUSED'; exit 1 }
}
'the stage checks out'

$(Get-ThornswoodServiceAccountScript)
`$AsSystem = [bool]$([int][bool]$AsSystem)
if (-not `$AsSystem) {
    `$cannot = @(Test-ThornswoodServiceCannotReach (@(Get-ThornswoodServiceNeverReach -Own '$Root' -Box (Split-Path -Parent '$Root')) + '$Root'))
    if (`$cannot.Count) {
        'LOCAL SERVICE could read what no service may, so the bridge is not put on it:'
        `$cannot
        'Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -AsSystem. Nothing was stopped or changed.'
        'BRIDGE REFUSED'; exit 1
    }
}

$stopIt

`$writer = Join-Path '$Root' 'server-log.js'
`$cmd = ('/c "set THORNSWOOD_BRIDGE_PORT=$Port&& start "" /b /wait "{0}" "{2}" --log "{1}" --days 90 --stamp bridge.js & call exit %^errorlevel%"' -f `$node.Source, '$log', `$writer)
`$oldXml = `$null
if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { `$oldXml = (Export-ScheduledTask -TaskName '$TaskName' | Out-String) }

# From here one error must not leave it half done.
`$ErrorActionPreference = 'Continue'

function Register([bool]`$system) {
    `$action = New-ScheduledTaskAction -Execute "`$env:SystemRoot\System32\cmd.exe" -Argument `$cmd -WorkingDirectory '$Root'
    # Priority 4, normal, not Task Scheduler's default of 7 (#1968).
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 4
    if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false }
    Register-ScheduledTask -TaskName '$TaskName' -Action `$action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings `$settings -Principal (New-ThornswoodServicePrincipal -AsSystem:`$system) | Out-Null
}

# Whether the port answers a plain request with one of these lines, the
# bridge's 404. A status code alone would take any other server on the port
# for the bridge (#2875).
$SendPlainAnswer
function Answers([string[]]`$Lines) {
    `$until = (Get-Date).AddSeconds($Wait)
    while ((Get-Date) -lt `$until) {
        `$a = Get-PlainAnswer 'http://127.0.0.1:$Port/' 2
        if (`$a.Code -eq 404 -and `$Lines -contains `$a.Body) { return `$true }
        Start-Sleep -Milliseconds 700
    }
    return `$false
}

# Held while it is stopped (#5155, ServerHold.ps1), so the watchdog leaves
# it; every way out below takes the hold away.
Set-ThornswoodHold -Target '$TaskName' -Why 'installing new bridge files' -By `$HoldBy
StopIt
if (-not `$stopOk) { Clear-ThornswoodHold -Target '$TaskName'; 'BRIDGE REFUSED'; exit 1 }
New-Item -ItemType Directory -Force -Path '$Root\$prev' | Out-Null
foreach (`$f in `$want.Keys) {
    `$live = Join-Path '$Root' `$f
    if (Test-Path -LiteralPath `$live) { Move-Item -LiteralPath `$live -Destination (Join-Path '$Root\$prev' `$f) -Force }
    Move-Item -LiteralPath (Join-Path `$stage `$f) -Destination `$live -Force
}
Remove-Item -LiteralPath `$stage -Recurse -Force -EA SilentlyContinue

Register `$AsSystem
if (-not `$AsSystem) {
    `$why = ''
    `$sid = Get-ThornswoodTaskSid '$TaskName'
    if (-not `$sid) { `$why = 'the task SID NT TASK\$TaskName could not be looked up' }
    else {
        try {
            `$null = Grant-ThornswoodServiceFolder -Root '$Root' -Sid `$sid -Files 'bridge.log', 'bridge.log.*'
            # What it makes is its own, not every service's (#4077).
            Set-ThornswoodTaskOwner -TaskName '$TaskName' -Sid `$sid -Roots '$Root'
        } catch { `$why = 'its folder could not be granted to it: ' + `$_.Exception.Message }
    }
    if (`$why) { `$why + ', so the task goes on SYSTEM'; Register `$true }
    else { 'the task runs as LOCAL SERVICE, Limited, as NT TASK\$TaskName' }
}
try { & `$node.Source `$writer --log '$log' --days 90 --roll } catch { 'could not roll bridge.log: ' + `$_.Exception.Message }
Start-ScheduledTask -TaskName '$TaskName'
if (Answers @('$Plain')) {
    'the bridge answers on 127.0.0.1:$Port'
    if (-not @(Get-ChildItem -LiteralPath '$Root\tokens' -File -EA SilentlyContinue).Count) { 'there are no tokens yet, so it refuses everybody until Grant-BoxAccess.ps1 gives somebody one' }
    Clear-ThornswoodHold -Target '$TaskName'
    'BRIDGE OK'; exit 0
}
'it did not answer on 127.0.0.1:$Port within $Wait seconds. bridge.log says:'
if (Test-Path -LiteralPath '$log') { Get-Content -LiteralPath '$log' -Tail 15 } else { 'nothing was written' }
StopIt
`$back = @(Get-ChildItem -LiteralPath '$Root\$prev' -File -EA SilentlyContinue)
foreach (`$f in `$back) { Move-Item -LiteralPath `$f.FullName -Destination (Join-Path '$Root' `$f.Name) -Force }
if (`$oldXml) {
    if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false }
    Register-ScheduledTask -TaskName '$TaskName' -Xml `$oldXml | Out-Null
    Start-ScheduledTask -TaskName '$TaskName'
    # The old files may be from before #2875, when the bridge's 404 said only
    # "not here". Nothing but the bridge listens on this port, and the site's
    # own "not here" can only come through Caddy, never here.
    if (Answers @('$Plain', 'not here')) { 'the old files and task are back, and it answers again' } else { 'THE OLD FILES AND TASK ARE BACK AND IT STILL DOES NOT ANSWER' }
} else {
    Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false -EA SilentlyContinue
    'there was no bridge before this, so none is left registered'
}
Clear-ThornswoodHold -Target '$TaskName'
'BRIDGE ROLLED BACK'; exit 1
"@

# The header's THE INSTALL RUNS ON THE BOX ON ITS OWN. The start says
# STARTED, and nothing has been stopped by then, nor will be until the
# session that started it has ended.
$run = Get-ThornswoodDetachedRun -Script $install
$started = @(Remote $run.Start)
$startedRc = $LASTEXITCODE
if ($startedRc -ne 0 -or -not @($started | Where-Object { $_ -is [string] -and $_ -match '^STARTED \d+$' }).Count) {
    $started | ForEach-Object { Say "  $_" }
    Die "the box did not start the install (exit $startedRc). The lines above say why; the bridge was not touched."
}
# The report, read until it ends. While the bridge restarts a session cannot
# open, which is waited out the same as a report not yet finished. Each line
# is shown once, as it arrives.
$out = @()
$shown = 0
$endRc = $null
$until = (Get-Date).AddSeconds(180 + 3 * $Wait)
while ($null -eq $endRc -and (Get-Date) -lt $until) {
    Start-Sleep -Seconds 5
    $was = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $read = @(Remote $run.Read | Where-Object { $_ -is [string] })
    $readRc = $LASTEXITCODE
    $ErrorActionPreference = $was
    if ($readRc -ne 0 -or -not $read.Count -or $read[0] -notmatch '^REPORT \d+$') { continue }
    $lines = @($read | Select-Object -Skip 1)
    for ($i = $shown; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^END (-?\d+)$') { $endRc = [int]$Matches[1] }
        else { Say ('  ' + $lines[$i]); $out += $lines[$i].Trim() }
    }
    $shown = $lines.Count
}
if ($null -eq $endRc) { Die ('the install on the box had not finished after ' + (180 + 3 * $Wait) + ' s, or the box could not be read since the bridge stopped. Its report is ' + $run.Log + ' on the box; -Status says what runs, and -Record records it once it is this commit.') }
if ($out -notcontains 'BRIDGE OK') { Die 'the bridge was not installed. The lines above say why and what is running.' }
$null = Set-ThornswoodArtifactCurrent -Artifact $artifact -Target $target -SshArgs $ssh -Root $Root

# ---------------------------------------------------------------- outside ---
Head 'Checking from here'
# A plain request through Caddy: the bridge says "box bridge: not here" with
# a 404, and the site's own 404 says only "not here", so this whole line tells
# whether Caddy carries /box/ (#2875).
$via = $Site.TrimEnd('/') + '/box/'
$a = Get-PlainAnswer $via 15
if ($a.Code -eq 404 -and $a.Body -eq $Plain) {
    Say "  $via reaches the bridge." 'Green'
} else {
    $said = if ($a.Code) { "$($a.Code) $($a.Body)" } else { 'no answer: ' + $a.Why }
    Say "  $via did not reach the bridge (it said: $said), so Caddy does not carry /box/ yet. Setup-Domain.ps1 -TaskOnly does not send the Caddyfile; Setup-Domain.ps1 does." 'Yellow'
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
