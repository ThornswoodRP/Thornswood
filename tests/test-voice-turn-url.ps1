<#
  test-voice-turn-url.ps1

      pwsh -NoProfile -File .\tests\test-voice-turn-url.ps1

  Install-Voice.ps1 can hand the voice service a relay address, keeps it on
  the next install the way it keeps -Bind, says so when it drops one that has
  no key, and with no relay sends the service the command line it always
  sent, but for auth, which is on on every line since #1303.

  WHY THIS EXISTS. The To Do List entry "Voice is a full peer-to-peer mesh
  with no relay and no cap, and the code already admits a pair that cannot
  connect is simply lost". Step one there is a TURN relay, and the voice
  service has been able to hand one out since the ICE list moved into it, but
  Install-Voice.ps1 built the service's whole environment from -Site, -Port,
  -Bind and -Auth, so no relay address could ever reach the running service.
  Its key does not go this way at all: it sits in turn-key.txt beside the
  service, which voice\tests\test-turn-key.js covers.

  Nobody has stood up a relay yet, so the first thing held here is that an
  install without one is the same install, to the character.

  HOW. Install-Voice.ps1 reaches the VPS the moment it runs, so it is parsed
  and never run. The pieces that decide the relay are lifted out of its syntax
  tree and run here:

    the shape      what a relay address may look like, since it goes onto a
                   cmd.exe line where an & would start a second command
    the probe      what is already running, read through a stand-in Remote.ps1
                   that runs the probe in Windows PowerShell on this machine,
                   which is what sshd runs on the box, against real copies of
                   voice\voice-server.js started here on spare ports
    the command    the service's command line, built from the install's own
                   here-string, then run through cmd.exe against a stand-in
                   voice-server.js that writes down the environment it got

  Never connects to anything off this machine. Writes only under its own temp
  folder.
#>
[CmdletBinding()]
param([string]$RepoPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $RepoPath) { $RepoPath = $Here }
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
$script:started = @()
$script:temp = Join-Path ([IO.Path]::GetTempPath()) ('turnurl-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $script:temp | Out-Null
function Done {
    foreach ($p in $script:started) { try { if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit(3000) | Out-Null } } catch { } }
    Remove-Item -LiteralPath $script:temp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
# Anything that throws still goes through Done. Without this a throw after
# the three voice services below had started ended the script with them
# still running, and they held the output of whatever ran this: the nightly
# run's harness step waited on them until it was cancelled at 45 minutes on
# 26, 27 and 28 September (issue #891).
trap { Yes ('the run finished without an error: ' + $_.Exception.Message) $false; Done }

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
Yes 'node is here to run the voice service' ([bool]$nodeExe)
if (-not $nodeExe) { Done }

# ---- the script, parsed ----------------------------------------------------
$installPath = Join-Path $RepoPath 'scripts\deploy\Install-Voice.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installPath, [ref]$tokens, [ref]$errors)
Yes 'Install-Voice.ps1 parses' ($errors.Count -eq 0)
if ($errors.Count) { Done }

$top = @($ast.EndBlock.Statements)
function Assigned([string]$name) {
    foreach ($s in $top) {
        if ($s -is [System.Management.Automation.Language.AssignmentStatementAst] -and
            $s.Left.Extent.Text -eq ('$' + $name)) { return $s }
    }
    return $null
}
function IfOn([string]$needle, [switch]$Exactly) {
    foreach ($s in $top) {
        if (-not ($s -is [System.Management.Automation.Language.IfStatementAst])) { continue }
        $cond = $s.Clauses[0].Item1.Extent.Text
        if ($Exactly) { if ($cond -ceq $needle) { return $s } }
        elseif ($cond.Contains($needle)) { return $s }
    }
    return $null
}

$param = $null
foreach ($p in $ast.ParamBlock.Parameters) { if ($p.Name.VariablePath.UserPath -eq 'TurnUrl') { $param = $p } }
Yes 'it takes -TurnUrl' ($null -ne $param)
Yes 'which is empty unless it is given, so an install that does not mention a relay has none' (
    $null -ne $param -and $null -ne $param.DefaultValue -and $param.DefaultValue.SafeGetValue() -eq '')

$shapeAst = Assigned 'turnShape'
$refuseAst = IfOn '-notmatch $turnShape'
$probeAst = IfOn '-not $turnExplicit'
$turnSetAst = Assigned 'turnSet'
$turnSetIf = IfOn '$TurnUrl' -Exactly
$remoteAst = Assigned 'remote'
Yes 'the shape, the refusal, the probe, the relay line and the remote script are all there to lift' (
    $shapeAst -and $refuseAst -and $probeAst -and $turnSetAst -and $turnSetIf -and $remoteAst)
if (-not ($shapeAst -and $refuseAst -and $probeAst -and $turnSetAst -and $turnSetIf -and $remoteAst)) { Done }
$turnShape = ''
. ([scriptblock]::Create($shapeAst.Extent.Text))

# ---- the shape --------------------------------------------------------------
Write-Host ''
Write-Host 'what a relay address may be:'
foreach ($good in 'turn:relay.example.net:3478',
                  'turn:203.0.113.5:3478?transport=udp',
                  'turn:relay.example.net:3478,turns:relay.example.net:5349?transport=tcp') {
    Yes "takes $good" ($good -match $turnShape)
}
foreach ($bad in 'turn:relay.example.net:3478&& calc',
                 'turn:relay.example.net:3478" & echo hi',
                 'turn:relay.example.net:3478 ',
                 'turn:relay.example.net:{0}',
                 'http://relay.example.net:3478',
                 'stun:stun.l.google.com:19302') {
    Yes "refuses $bad" ($bad -notmatch $turnShape)
}

function Refused([string]$url) {
    $TurnUrl = $url
    $script:died = ''
    function Die($m) { $script:died = [string]$m; throw 'died' }
    try { . ([scriptblock]::Create($refuseAst.Extent.Text)) } catch { }
    return [bool]$script:died
}
Yes 'an install given a malformed -TurnUrl stops before it sends anything' (Refused 'turn:x:3478&& calc')
Yes 'and one given a good one, or none, carries on' (-not (Refused 'turn:x:3478') -and -not (Refused ''))

# ---- the command line --------------------------------------------------------
Write-Host ''
Write-Host 'the command line the scheduled task runs:'
$root = Join-Path $script:temp 'root'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$logPath = Join-Path $root 'voice.log'
# The log writer the task runs voice under (#2166, tests\test-roll-log.ps1
# drives it). The real one, beside the stand-in, so the relay line is shown to
# reach node through the whole line the box runs and not a line without it.
$writerPath = Join-Path $root 'server-log.js'
Copy-Item -LiteralPath (Join-Path $RepoPath 'scripts\vps\Server-Log.js') -Destination $writerPath
# Stands in for the service: writes down what cmd.exe handed it and stops.
$seenPath = Join-Path $root 'seen.json'
Set-Content -LiteralPath (Join-Path $root 'voice-server.js') -Encoding ASCII -Value @'
const e = process.env;
const v = (k) => (e[k] === undefined ? null : e[k]);
require('fs').writeFileSync('seen.json', JSON.stringify({
  site: v('THORNSWOOD_SITE'), port: v('THORNSWOOD_VOICE_PORT'), bind: v('THORNSWOOD_VOICE_BIND'),
  auth: v('THORNSWOOD_VOICE_AUTH'), chat: v('THORNSWOOD_CHAT_RANGE'), url: v('THORNSWOOD_TURN_URL'),
  secret: e.THORNSWOOD_TURN_SECRET === undefined ? null : 'set' }));
'@

# The here-string calls Get-ThornswoodServiceAccountScript (#2578) to paste
# ServiceAccount.ps1's functions in. Only the task line is read here, so it
# stands in as nothing. Without it the expansion threw before any check after
# it ran (found while checking the voice line for #2166).
function Get-ThornswoodServiceAccountScript { return '' }
# It also pastes in scripts\vps\BoxFirewall.ps1's Sync-ThornswoodFirewall
# (#3896), loaded here the way Install-Voice.ps1 loads it.
. (Join-Path $RepoPath 'scripts\vps\BoxFirewall.ps1')
# The service's command line, built the way the install builds it: the relay
# lines lifted out of the script, then the remote here-string expanded, then
# the line in it that the VPS runs.
function CommandFor([string]$url) {
    $TurnUrl = $url
    $Site = 'https://thornswood.net'; $Port = 7778; $Bind = '0.0.0.0'; $ChatRange = 'off'
    $Root = 'C:\Thornswood-Voice'; $TaskName = 'Thornswood Voice'; $expectBuild = 'x'
    . ([scriptblock]::Create($turnSetAst.Extent.Text))
    . ([scriptblock]::Create($turnSetIf.Extent.Text))
    . ([scriptblock]::Create($remoteAst.Extent.Text))
    $line = @($remote -split "`r?`n" | Where-Object { $_ -match '^\$cmd = \(' })
    if ($line.Count -ne 1) { return $null }
    $node = [pscustomobject]@{ Source = $nodeExe }
    $log = $logPath
    $writer = $writerPath
    $cmd = $null
    . ([scriptblock]::Create($line[0]))
    return [pscustomobject]@{ Cmd = $cmd; Remote = $remote }
}

# Runs it the way Task Scheduler does: cmd.exe with that argument, from -Root,
# with nothing of this machine's own THORNSWOOD_ settings passed through.
function RunCommand([string]$cmd) {
    Remove-Item -LiteralPath $seenPath -Force -ErrorAction SilentlyContinue
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Get-WindowsPath 'System32\cmd.exe'
    $psi.Arguments = $cmd
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    foreach ($k in @($psi.EnvironmentVariables.Keys)) { if ($k -like 'THORNSWOOD_*') { $psi.EnvironmentVariables.Remove($k) } }
    $p = [System.Diagnostics.Process]::Start($psi)
    [void]$p.WaitForExit(20000)
    if (-not (Test-Path -LiteralPath $seenPath)) { return $null }
    return (Get-Content -LiteralPath $seenPath -Raw | ConvertFrom-Json)
}

# Every install before -TurnUrl existed sent exactly this. The chat range
# came onto the line with local chat (tests\test-chat-range-install.ps1), and
# off is what an install that does not mention it hands over. Since #2166
# voice runs under server-log.js, which writes voice.log and keeps 90 days of
# it, in place of the roller entry 220 put in front of node.
# Auth is on whatever the install is given since #1303: there is no -Auth.
# node goes through start /high since #2491, so voice runs High, and call
# exit hands node's exit code back as the task's.
$before = '/c "set THORNSWOOD_SITE=https://thornswood.net&& set THORNSWOOD_VOICE_PORT=7778&& set THORNSWOOD_VOICE_BIND=0.0.0.0&& set THORNSWOOD_VOICE_AUTH=on&& set THORNSWOOD_CHAT_RANGE=off&&  start "" /b /wait /high "{0}" "{2}" --log "{1}" --days 90 --stamp voice-server.js & call exit %^errorlevel%"' -f $nodeExe, $logPath, $writerPath

$none = CommandFor ''
Yes 'with no relay the command line is the one every install sends, to the character' (
    $none -and $none.Cmd -ceq $before)
if (-not $OnWindows) { Write-Host 'SKIP  what the service is handed: the task line is run through cmd.exe, as Task Scheduler runs it, and only Windows has cmd.exe' }
else {
    $seen = if ($none) { RunCommand $none.Cmd } else { $null }
    Yes 'and the service it starts is handed no relay address' ($seen -and $null -eq $seen.url)
    Yes 'with site, port, bind and chat range as they always were, and auth on' (
        $seen -and $seen.site -eq 'https://thornswood.net' -and $seen.port -eq '7778' -and
        $seen.bind -eq '0.0.0.0' -and $seen.auth -eq 'on' -and $seen.chat -eq 'off')
}

$relay = 'turn:relay.example.net:3478,turns:relay.example.net:5349?transport=tcp'
$with = CommandFor $relay
$want = $before.Replace('set THORNSWOOD_CHAT_RANGE=off&& ', 'set THORNSWOOD_CHAT_RANGE=off&& set THORNSWOOD_TURN_URL=' + $relay + '&& ')
Yes 'with a relay, the one thing added is the relay address, before node starts' ($with -and $with.Cmd -ceq $want)
if ($OnWindows) {
    $seen = if ($with) { RunCommand $with.Cmd } else { $null }
    Yes 'and the service gets exactly that address, with no space on the end' ($seen -and $seen.url -ceq $relay)
    Yes 'the rest is unchanged' (
        $seen -and $seen.site -eq 'https://thornswood.net' -and $seen.port -eq '7778' -and
        $seen.bind -eq '0.0.0.0' -and $seen.auth -eq 'on' -and $seen.chat -eq 'off')
    Yes 'and no relay key rides on the command line: the service is handed none there' (
        $seen -and $null -eq $seen.secret -and $with.Remote -notmatch 'TURN_SECRET|TURN_PASS|TURN_USER')
}

# ---- the probe --------------------------------------------------------------
Write-Host ''
Write-Host 'what is already running is kept, the way -Bind is:'
$stubDir = Join-Path $script:temp 'stub'
# Laid out the way scripts\ is since phase 8 of issue #440: the install in
# deploy, and the Remote.ps1 it calls as ..\vps\Remote.ps1 beside it.
New-Item -ItemType Directory -Force -Path (Join-Path $stubDir 'deploy'), (Join-Path $stubDir 'vps') | Out-Null
# Remote.ps1's own parameters, running here instead of on the VPS. A canned
# answer stands in for a service that is not there, or one saying something
# no real one would.
# The box runs what Remote.ps1 sends in PowerShell 7 (#5356), and so does
# the stand-in, on every machine.
$farShell = Get-BoxPowerShell
Set-Content -LiteralPath (Join-Path $stubDir 'vps\Remote.ps1') -Encoding ASCII -Value (@'
param([Parameter(Position = 0)][string]$Script, [string]$VpsHost, [string]$VpsUser)
if ($env:TS_PROBE_ANSWER) { $env:TS_PROBE_ANSWER; return }
$full = "`$ProgressPreference = 'SilentlyContinue'`r`n" + $Script
$b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($full))
& '__FAR_SHELL__' -NoProfile -NonInteractive -EncodedCommand $b64
'@).Replace('__FAR_SHELL__', $farShell.Replace("'", "''"))

function StartVoice([int]$port, [hashtable]$vars, [string]$key) {
    $dir = Join-Path $script:temp ('voice-' + $port)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepoPath 'voice\voice-server.js') -Destination (Join-Path $dir 'voice-server.js')
    Copy-Item -LiteralPath (Join-Path $RepoPath 'voice\headlines.js') -Destination (Join-Path $dir 'headlines.js')
    Set-Content -LiteralPath (Join-Path $dir 'token-key.txt') -Value 'a join token key for this test only' -Encoding ASCII
    if ($key) { Set-Content -LiteralPath (Join-Path $dir 'turn-key.txt') -Value $key -Encoding ASCII }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $nodeExe
    $psi.Arguments = 'voice-server.js'
    $psi.WorkingDirectory = $dir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($k in @($psi.EnvironmentVariables.Keys)) { if ($k -like 'THORNSWOOD_*') { $psi.EnvironmentVariables.Remove($k) } }
    $psi.EnvironmentVariables['THORNSWOOD_VOICE_PORT'] = [string]$port
    $psi.EnvironmentVariables['THORNSWOOD_SITE'] = ''
    foreach ($k in $vars.Keys) { $psi.EnvironmentVariables[$k] = [string]$vars[$k] }
    $p = [System.Diagnostics.Process]::Start($psi)
    $script:started += $p
    for ($i = 0; $i -lt 60; $i++) {
        try { $null = Invoke-RestMethod ("http://127.0.0.1:{0}/health" -f $port) -TimeoutSec 2; return $true } catch { }
        Start-Sleep -Milliseconds 150
    }
    return $false
}

# The probe block lifted out of the install, run with the install's own
# variables as its parameter block would leave them.
function Probe([int]$port, [hashtable]$given, [string]$canned) {
    $Here = Join-Path $stubDir 'deploy'; $Port = $port; $VpsHost = 'vps.invalid'; $VpsUser = 'nobody'
    # Loopback is the parameter's default since #1304.
    $Bind = '127.0.0.1'; $ChatRange = 'on'; $TurnUrl = ''
    $bindExplicit = $false; $chatExplicit = $false; $turnExplicit = $false
    if ($given.ContainsKey('TurnUrl')) { $TurnUrl = $given['TurnUrl']; $turnExplicit = $true }
    $Root = 'C:\Thornswood-Voice'
    $script:said = @()
    function Say($m, $c) { $script:said += [string]$m }
    $env:TS_PROBE_ANSWER = $canned
    try { . ([scriptblock]::Create($probeAst.Extent.Text)) }
    finally { Remove-Item Env:\TS_PROBE_ANSWER -ErrorAction SilentlyContinue }
    return [pscustomobject]@{ Bind = $Bind; ChatRange = $ChatRange; TurnUrl = $TurnUrl; Said = ($script:said -join "`n") }
}

$withRelay = 7922
$plain = 7923
$noKey = 7924
$key = -join ((1..40) | ForEach-Object { '0123456789abcdef'[(Get-Random -Maximum 16)] })
$up1 = StartVoice $withRelay @{ THORNSWOOD_TURN_URL = $relay; THORNSWOOD_VOICE_AUTH = 'on'; THORNSWOOD_VOICE_BIND = '127.0.0.1'; THORNSWOOD_CHAT_RANGE = 'on' } $key
$up2 = StartVoice $plain @{} ''
$up3 = StartVoice $noKey @{ THORNSWOOD_TURN_URL = $relay } ''
Yes 'three real voice services came up here: a relay with its key in turn-key.txt, no relay, and a relay address with no key' (
    $up1 -and $up2 -and $up3)

$r = Probe $withRelay @{} ''
Yes 'an install that does not pass -TurnUrl keeps the relay that is running' ($r.TurnUrl -ceq $relay)
Yes 'and still keeps the bind, as it did before' ($r.Bind -eq '127.0.0.1')
# The relay rides on the end of the same answer local chat's range is read
# from, so one install keeping both is the case that shows neither eats the
# other.
Yes 'and the chat range that is running, from the same answer' ($r.ChatRange -eq '4000')
Yes 'and says nothing about a relay with no key' ($r.Said -notmatch 'no key')
$r = Probe $noKey @{} ''
Yes 'a relay address with no key serves nothing, so the install does not keep it' ($r.TurnUrl -eq '')
Yes 'and says so, rather than dropping it quietly' ($r.Said -match 'relay address and no key' -and $r.Said -match 'turn-key\.txt')
$r = Probe $noKey @{ TurnUrl = $relay } ''
Yes 'an install that passes -TurnUrl again is not told off for it' ($r.TurnUrl -ceq $relay -and $r.Said -notmatch 'no key')
$r = Probe $withRelay @{ TurnUrl = '' } ''
Yes "-TurnUrl '' takes the relay away" ($r.TurnUrl -eq '')
$r = Probe $withRelay @{ TurnUrl = 'turn:other.example.net:3478' } ''
Yes 'a -TurnUrl that is passed wins over what is running' ($r.TurnUrl -ceq 'turn:other.example.net:3478')
$r = Probe $plain @{} ''
Yes 'a service with no relay leaves the install with none, which is every box today, and its range off kept off' (
    $r.TurnUrl -eq '' -and $r.Bind -eq '127.0.0.1' -and $r.ChatRange -eq 'off')
Yes 'and says nothing about a relay at all' ($r.Said -notmatch 'relay')
$r = Probe $plain @{} 'bind=127.0.0.1;auth=on;chat=2500;relay=none;turn='
Yes 'an answer with nothing after turn= keeps bind and chat range and no relay' (
    $r.TurnUrl -eq '' -and $r.Bind -eq '127.0.0.1' -and $r.ChatRange -eq '2500')
$r = Probe $plain @{} 'bind=0.0.0.0;auth=log;chat=0;relay=ephemeral;turn=turn:x:3478&&calc'
Yes 'an answer carrying something that is not a relay address is not put on the command line' ($r.TurnUrl -eq '')
$r = Probe $plain @{} 'none'
Yes 'nothing running leaves every default as it was, local chat on' (
    $r.TurnUrl -eq '' -and $r.Bind -eq '127.0.0.1' -and $r.ChatRange -eq 'on')
# #2711: /ice that did not answer was a try with an empty catch, and the relay
# it served was dropped with nothing on the screen.
$r = Probe $plain @{} 'bind=127.0.0.1;auth=on;chat=2500;ice=The operation has timed out.;relay=ephemeral;turn='
Yes 'a service whose /ice does not answer keeps no relay, and says so with why' (
    $r.TurnUrl -eq '' -and $r.Bind -eq '127.0.0.1' -and $r.Said -match 'did not answer /ice \(The operation has timed out\.\)' -and $r.Said -match 'Pass -TurnUrl')
$r = Probe $plain @{} 'bind=127.0.0.1;auth=on;chat=2500;ice=;relay=none;turn='
Yes '  and one whose /ice answered says nothing about it' ($r.Said -notmatch '/ice')

# And the build the check after the start holds the new service to: a
# voice-server.js that does not read, or names no BUILD, stops the install
# before anything on the box is stopped, where it used to leave the check
# passing whatever answered (#2711).
$installText = [IO.File]::ReadAllText($installPath)
$iNoBuild = $installText.IndexOf('names no const BUILD, so there is no build to check the new service by')
$iUnread = $installText.IndexOf('could not be read, so there is no build to check the new service by')
$iStop = $installText.IndexOf('StopIt', [Math]::Max($iNoBuild, $iUnread))
Yes 'a voice-server.js that names no BUILD, or does not read, stops the install with Die before the artifact is sent' (
    $iNoBuild -gt 0 -and $iUnread -gt 0 -and $iStop -gt $iNoBuild -and $installText.IndexOf('Send-ThornswoodArtifact -Artifact $artifact') -gt $iNoBuild -and
    $installText.Substring($iUnread - 260, 260) -match 'catch \{ Die' -and $installText -match 'if \(-not \$m\.Success\) \{ Die "\$vsPath names no const BUILD')
Yes '  and the voice-server.js here names one, so an install today has its check' ([regex]::IsMatch([IO.File]::ReadAllText((Join-Path $RepoPath 'voice\voice-server.js')), "const\s+BUILD\s*=\s*'([^']+)'"))

Done
