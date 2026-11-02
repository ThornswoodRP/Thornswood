<#
  Install-AdminService.ps1

  Puts the box's GitHub admin service on the VPS (#3107, Patrick's A of 22 Oct
  2026): scripts\vps\admin\admin.js, as the task "Thornswood Admin",
  listening on 127.0.0.1:7791. It holds the key of a GitHub App made for
  Thornswood, and makes the runners' labels, and the rulesets, private
  vulnerability reporting, immutable releases and secret scanning of
  Thornswood and the engine fork, on GitHub match main's records (records\*-runners.json, and since #3683
  records\github-repo-settings.json) when a run of the ops repository's
  github-admin.yml on main asks
  with its OIDC token (admin.js says how it checks that, and why nothing else
  may ask). That is how Set-BuildRunners.ps1 works from anywhere, a cloud
  thread included. Run it from a machine whose way in already works; it does
  the remote half over ssh, so a service that does not answer is put back as
  it was before this ends.

      .\scripts\deploy\Install-AdminService.ps1           install it, or the newest
                                                         commit of it, and start it
      .\scripts\deploy\Install-AdminService.ps1 -Setup    arm the App's one-time setup
                                                         and print its address
      .\scripts\deploy\Install-AdminService.ps1 -Status   what is there and its log
      .\scripts\deploy\Install-AdminService.ps1 -Forget   drop the App's key, for a new App
      .\scripts\deploy\Install-AdminService.ps1 -Remove   take it off again

  From a cloud thread, which has no ssh, the deploy gate runs the first and
  -Status with main's script (scripts\vps\gate\verbs.json):

      pwsh scripts/vps/Box-Run.ps1 -Line 'Install-AdminService'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Install-AdminService -Status'

  -Setup, -Forget and -Remove are not gate verbs: they change who holds the
  App, which stays with a person at One.

  THE APP (once, by whoever owns the repository). -Setup writes
  state\setup.json, a state nobody can guess that lives an hour, and prints
  https://thornswood.net/github-app/setup?state=<it>. Caddy carries
  /github-app/ to the service (the handle_path block in
  scripts\deploy\Caddyfile, sent by Setup-Domain.ps1). Opening that address
  and pressing the button sends GitHub the App's manifest: private,
  "Administration: write" and "Contents: read", no webhook. GitHub makes the
  App and sends the browser back to /github-app/setup/done, where the service
  trades GitHub's one-time code for the App's key and keeps it in
  state\key.pem. The key is never shown, logged or copied. Last, install the
  App on Thornswood, Thornswood-Ops (its github-admin, #4013) and skymp
  (#3848), and nothing else, from the link the page gives. An App held already
  stops -Setup; -Forget drops it first (delete the old App on GitHub too:
  github.com/settings/apps).

  WHAT IT RUNS AS. LOCAL SERVICE, Limited, with a SID of its own, like the
  bridge and Caddy (#2578, ServiceAccount.ps1), after the same fail-safe. The
  folder takes nothing from C:\: SYSTEM, Administrators and whoever runs
  this, plus the task's own SID to read it, write its log and keep the App in
  state. No other service and no runner account can read the key
  (records\runner-isolation.json lists the folder, and
  scripts\vps\Check-RunnerIsolation.ps1 checks it). -AsSystem registers it as
  SYSTEM, Highest, the way back if LOCAL SERVICE cannot run it.

  THE STATE FOLDER IS LOCKED APART (#4076). The folder above gives CREATOR
  OWNER Modify, so the service can write the logs it makes. A file a LOCAL
  SERVICE task makes is owned by LOCAL SERVICE, not by the task's own SID,
  so that rule became "LOCAL SERVICE: Modify" on key.pem, and every service
  on the box that runs as LOCAL SERVICE (the game servers, voice, the site,
  Caddy, the bridge) could read the key from 22 Oct 2026. Every install now
  sets state's rules before anything is stopped: nothing inherited, SYSTEM
  and Administrators Full, the task's own SID Modify, and OWNER RIGHTS only
  Synchronize, which takes from the owner of a file the service makes later
  (a new key from -Setup) the right to read or change that file's rules
  that every owner has otherwise. What is in it is owned by Administrators
  and keeps only what state gives it. After the grant, the install stops
  the service and refuses when LOCAL SERVICE, a broad group or CREATOR
  OWNER could still read anything there, or LOCAL SERVICE owns a file there
  with no OWNER RIGHTS rule.

  WHAT IT SENDS. A commit or nothing (Artifact.ps1, #459, #1121): admin.js
  and Server-Log.js out of HEAD, checked against the commit
  (Assert-ThornswoodSourceIntegrity) before anything is sent. They go into
  -Root\.stage-<stamp>, are checked there by hash and node --check with the
  old service still running, and only then is it stopped and they are renamed
  in; what they replace goes to .prev-<stamp>. If the new one does not
  answer, the old files and the old task go back and are started. Nothing
  in the state folder, the App's key included, is moved, changed or removed
  by an install; only its rules and owner are set, as above.

  THE BOT'S TOKEN (#5184, Patrick's A of 1 Nov 2026). The service makes the
  Discord bot a GitHub token, issues write on Thornswood alone, every half
  hour, into -Root\for-bot\github-token.json (admin.js says why). That
  folder is locked apart like state: nothing inherited, SYSTEM and
  Administrators Full, the task's own SID Modify, OWNER RIGHTS only
  Synchronize, and the bot's own account, NT SERVICE\<-BotService>, Read.
  The bot walks to it by the one privilege it keeps, so C:\Thornswood-Admin
  itself stays closed to it. The App makes the token only once Issues write
  is added on its page and accepted on the installation.

  THE LOG. admin.log, one line per request (what was asked, by which run,
  what changed), never a token or the key, written by server-log.js with a
  time on each line and kept for 90 days, the same as bridge.log.
#>
[CmdletBinding()]
param(
    [string]$VpsHost  = '',
    [string]$VpsUser  = '',
    [string]$Root     = 'C:\Thornswood-Admin',
    [int]$Port        = 7791,
    [string]$TaskName = 'Thornswood Admin',
    # The Discord bot's service, whose own account alone besides this task
    # reads the token made for it (#5184).
    [ValidatePattern('^[A-Za-z0-9_-]{1,64}$')][string]$BotService = 'ThornswoodBot',
    # The address the outside check asks, and the setup's. The service
    # answers a plain request with "box admin: not here", which the site
    # never says, so that answer through here is the service and Caddy
    # carrying it, as for the bridge (#2875).
    [string]$Site     = 'https://thornswood.net',
    [int]$Wait        = 20,
    [switch]$Status,
    [switch]$Setup,
    [switch]$Forget,
    [switch]$Remove,
    [switch]$AsSystem,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
# The service's answer to a plain request, the same line as PLAIN in admin.js.
$Plain = 'box admin: not here'

# What a plain GET of a URL answers: @{ Code; Body; Why }, Code 0 when nothing
# answered and Why says what happened instead. Every check here reads the
# service's 404 through this, on One and on the box (sent ahead of the scripts
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
# The hold the install writes while it has the admin service stopped (#5155).
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
if (@($Status, $Setup, $Forget, $Remove | Where-Object { $_ }).Count -gt 1) { Die '-Status, -Setup, -Forget and -Remove each do one thing, so pass one of them. Nothing was sent.' }

function Remote($script) {
    # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
    # it off the box before it runs, and the far side's exit code comes back.
    return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script
}

# A path on the box, joined as text: Join-Path checks the drive exists here,
# and there is no C: off Windows (#2872).
$log = $Root.TrimEnd('\') + '\admin.log'
$state = $Root.TrimEnd('\') + '\state'
$forBot = $Root.TrimEnd('\') + '\for-bot'
# NT SERVICE\<the bot's service>, worked out from its name (Bot-Service.ps1),
# so the folder can name it whether or not the bot is installed yet.
. (Join-Path $Here '..\vps\Bot-Service.ps1')
$botSid = Get-ThornswoodServiceSid $BotService

# ------------------------------------------------------------------ status --
if ($Status) {
    Head 'On the VPS'
    Remote @"
`$ErrorActionPreference = 'SilentlyContinue'
`$t = Get-ScheduledTask -TaskName '$TaskName'
if (`$t) { `$i = Get-ScheduledTaskInfo -TaskName '$TaskName'; 'task      ' + `$t.State + ' as ' + `$t.Principal.UserId + ', last ran ' + `$i.LastRunTime + ' result ' + `$i.LastTaskResult } else { 'task      NOT REGISTERED' }
# Which App it holds, never its key.
if (Test-Path -LiteralPath '$state\app.json') {
    `$app = Get-Content -LiteralPath '$state\app.json' -Raw | ConvertFrom-Json
    'app       ' + `$app.slug + ' (' + `$app.id + '), made ' + `$app.made + `$(if (Test-Path -LiteralPath '$state\key.pem') { ', key held' } else { ', KEY MISSING' })
} else { 'app       NONE yet, so every ask is refused until -Setup makes one' }
# Whether another service could read the key (#4076), the install's check.
if (Test-Path -LiteralPath '$state') {
    `$wide = @()
    foreach (`$i in @(@(Get-Item -LiteralPath '$state' -Force) + @(Get-ChildItem -LiteralPath '$state' -Recurse -Force))) {
        `$a = Get-Acl -LiteralPath `$i.FullName
        `$sids = @(`$a.GetAccessRules(`$true, `$true, [Security.Principal.SecurityIdentifier]) | Where-Object { [string]`$_.AccessControlType -eq 'Allow' } | ForEach-Object { `$_.IdentityReference.Value })
        if (@(`$sids | Where-Object { @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-19', 'S-1-3-0') -contains `$_ }).Count -or
            (`$a.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-19' -and `$sids -notcontains 'S-1-3-4')) { `$wide += `$i.Name }
    }
    if (`$wide.Count) { 'state     OPEN to other services: ' + (`$wide -join ', ') + '. An install locks it.' } else { 'state     locked to SYSTEM, Administrators and the task' }
}
if (Test-Path -LiteralPath '$state\setup.json') {
    `$s = Get-Content -LiteralPath '$state\setup.json' -Raw | ConvertFrom-Json
    `$left = [int](`$s.expires - [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    if (`$left -gt 0) { 'setup     armed, ' + [int](`$left / 60) + ' minute(s) left' } else { 'setup     armed once, expired' }
}
$SendPlainAnswer
`$a = Get-PlainAnswer 'http://127.0.0.1:$Port/' 5
if (`$a.Code -eq 404 -and `$a.Body -eq '$Plain') { 'port      $Port answers as the admin service' }
elseif (`$a.Code) { 'port      $Port answered ' + `$a.Code + ' but not as the admin service: ' + `$a.Body }
else { 'port      $Port did not answer: ' + `$a.Why }
if (Test-Path -LiteralPath '$log') { ''; '--- admin.log, last 15 ---'; Get-Content -LiteralPath '$log' -Tail 15 }
"@ | ForEach-Object { Say "  $_" }
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ------------------------------------------------------------------- setup --
# A state nobody can guess, made on the box and good for an hour; the service
# shows the setup page only for it, and only while no App is held.
if ($Setup) {
    Head 'Arming the App''s setup'
    $out = @(Remote @"
`$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath '$state')) { 'NO SERVICE: install it first, with no switch'; exit 1 }
if (Test-Path -LiteralPath '$state\app.json') { 'HELD: an App is held already. -Forget drops it first'; exit 1 }
`$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes(`$b)
`$s = -join (`$b | ForEach-Object { `$_.ToString('x2') })
`$doc = [ordered]@{ state = `$s; expires = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600 } | ConvertTo-Json -Compress
[IO.File]::WriteAllText('$state\setup.json', `$doc, (New-Object Text.UTF8Encoding(`$false)))
'ARMED ' + `$s
"@ | ForEach-Object { "$_".Trim() })
    $armed = @($out | Where-Object { $_ -match '^ARMED [0-9a-f]{64}$' }) | Select-Object -First 1
    if (-not $armed) { Die ('the setup was not armed: ' + ($out -join ' ')) }
    $url = $Site.TrimEnd('/') + '/github-app/setup?state=' + $armed.Substring(6)
    Say '  Armed for one hour. Whoever owns the repository, signed in to GitHub as that account:' 'Green'
    Say "    1. open $url"
    Say '    2. press "Make it on GitHub", then "Create GitHub App for EvilPatrick06" on GitHub'
    Say '    3. on the page that comes back, "Install it": Only select repositories, Thornswood, Thornswood-Ops and skymp, Install'
    Say '  The address works once. -Status says whether the App is held.' 'DarkGray'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ------------------------------------------------------------------ forget --
if ($Forget) {
    Head 'Dropping the App''s key'
    $out = @(Remote @"
`$ErrorActionPreference = 'SilentlyContinue'
`$slug = ''
if (Test-Path -LiteralPath '$state\app.json') { `$slug = [string](Get-Content -LiteralPath '$state\app.json' -Raw | ConvertFrom-Json).slug }
foreach (`$f in 'key.pem', 'app.json', 'setup.json') { Remove-Item -LiteralPath ('$state\' + `$f) -Force }
if (Test-Path -LiteralPath '$state\key.pem') { 'STILL THERE' } else { 'FORGOTTEN ' + `$slug }
"@ | ForEach-Object { "$_".Trim() })
    $done = @($out | Where-Object { $_ -like 'FORGOTTEN*' }) | Select-Object -First 1
    if (-not $done) { Die ('the key was not dropped: ' + ($out -join ' ')) }
    $slug = $done.Substring(9).Trim()
    Say '  The box holds no App now; every ask is refused until -Setup makes one.' 'Green'
    if ($slug) { Say "  The App is still on GitHub: delete it at https://github.com/settings/apps/$slug/advanced" 'Yellow' }
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# The task, then anything of ours still running: server-log.js names
# admin.log on its command line, and admin.js is its child. Each found and
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
    if (`$mine.Count) { 'stopped ' + `$mine.Count + ' admin service process(es)' }
    `$script:stopOk = -not @(@(`$ThornswoodStillRunning) + @(`$ThornswoodNotHeld) | Where-Object { `$_ }).Count
    # Ours have exited, so anything still listening is not ours.
    if (`$stopOk -and (Get-NetTCPConnection -State Listen -LocalPort $Port -EA SilentlyContinue)) {
        'something that is not ours is listening on port $Port'
        `$script:stopOk = `$false
    }
}
"@
# The hold goes in front too (#5155), so StopIt's callers can hold and release the task.
$stopIt = (Get-ThornswoodHoldScript -Script 'Install-AdminService.ps1') + $stopIt

# ------------------------------------------------------------------ remove --
if ($Remove) {
    Head 'Removing'
    $out = @(Remote @"
$stopIt
StopIt
Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false -EA SilentlyContinue
Remove-Item -LiteralPath '$Root' -Recurse -Force -EA SilentlyContinue
if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { 'STILL THERE' } elseif (Test-Path -LiteralPath '$Root') { 'FOLDER STILL THERE' } else { 'REMOVED' }
"@ | ForEach-Object { Say "  $_"; "$_".Trim() })
    if ($out -notcontains 'REMOVED') { Die 'it was not all taken off. The lines above say what is left.' }
    Say '  Gone, the App''s key with it. The App itself is still on GitHub until it is deleted at https://github.com/settings/apps.' 'Green'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ----------------------------------------------------------------- build ----
# A commit or nothing (#1121), built before anything asks the box anything.
. (Join-Path $Here 'Artifact.ps1')
$repo = Join-Path $Here '..\..'
$artifact = New-ThornswoodArtifact -Component admin -RepoDir $repo -Paths 'scripts/vps/admin/admin.js' -AlsoSends 'scripts/vps/Server-Log.js'
Say ('artifact ' + (Format-ThornswoodArtifact $artifact)) 'DarkGray'
Assert-ThornswoodSourceIntegrity -Artifact $artifact -RepoDir $repo
# The log writer is not in the zip: -AlsoSends only holds it to the commit,
# and it goes from the checkout, as Install-Voice.ps1 sends it.
$send = [ordered]@{
    'admin.js'      = Join-Path $artifact.Folder 'scripts\vps\admin\admin.js'
    'server-log.js' = Join-Path $Here '..\vps\Server-Log.js'
}
foreach ($k in $send.Keys) { if (-not (Test-Path -LiteralPath $send[$k])) { Die "not found: $($send[$k]). Nothing was sent." } }
$hashes = [ordered]@{}
foreach ($k in $send.Keys) { $hashes[$k] = (Get-FileHash -LiteralPath $send[$k] -Algorithm SHA256).Hash }
Send-ThornswoodArtifact -Artifact $artifact -Target $target -SshArgs $ssh

# ----------------------------------------------------------------- stage ----
Head 'Staging'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = '.stage-' + $stamp
$prev = '.prev-' + $stamp
$made = @(Remote @"
`$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath '$Root')) { New-Item -ItemType Directory -Path '$Root' -Force | Out-Null }
# Nothing from C:\: the App's key is in here (the header says why).
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
# The App's folder, made once; an install never moves or changes what is in it.
if (-not (Test-Path -LiteralPath '$state')) { New-Item -ItemType Directory -Path '$state' -Force | Out-Null }
# Locked apart from the folder above, before anything is stopped (#4076, the
# header says why): nothing inherited, so no CREATOR OWNER; the task's own
# SID only once the task is there (a first install's grant adds it).
try {
  `$tree = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  `$admins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
  `$taskSid = ''
  # A task that is there has a SID; one that cannot be looked up stops the lock.
  if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { `$taskSid = (New-Object Security.Principal.NTAccount('NT TASK', '$TaskName')).Translate([Security.Principal.SecurityIdentifier]).Value }
  `$rules = @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-3-4', 'Synchronize'))
  if (`$taskSid) { `$rules += ,@(`$taskSid, 'Modify') }
  `$acl = Get-Acl -LiteralPath '$state'
  `$acl.SetAccessRuleProtection(`$true, `$false)
  foreach (`$r in @(`$acl.GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]))) { [void]`$acl.RemoveAccessRuleSpecific(`$r) }
  foreach (`$r in `$rules) {
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$r[0])), `$r[1], `$tree, 'None', 'Allow')))
  }
  `$acl.SetOwner(`$admins)
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath '$state' -Force), `$acl)
  # What is in it keeps only what state gives it, and no LOCAL SERVICE owner.
  foreach (`$i in @(Get-ChildItem -LiteralPath '$state' -Recurse -Force)) {
    `$a = Get-Acl -LiteralPath `$i.FullName
    `$a.SetAccessRuleProtection(`$false, `$false)
    foreach (`$r in @(`$a.GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]))) { [void]`$a.RemoveAccessRuleSpecific(`$r) }
    `$a.SetOwner(`$admins)
    if (`$i -is [IO.DirectoryInfo]) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]`$i, [Security.AccessControl.DirectorySecurity]`$a) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]`$i, [Security.AccessControl.FileSecurity]`$a) }
  }
} catch { 'COULD NOT LOCK STATE: ' + `$_.Exception.Message; exit 1 }
# The bot's token, locked apart the same way, and the bot's own account may
# read it (#5184, the header says why). Made here; the service writes in it.
if (-not (Test-Path -LiteralPath '$forBot')) { New-Item -ItemType Directory -Path '$forBot' -Force | Out-Null }
try {
  `$rules = @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-3-4', 'Synchronize'), @('$botSid', 'Read'))
  if (`$taskSid) { `$rules += ,@(`$taskSid, 'Modify') }
  `$acl = Get-Acl -LiteralPath '$forBot'
  `$acl.SetAccessRuleProtection(`$true, `$false)
  foreach (`$r in @(`$acl.GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]))) { [void]`$acl.RemoveAccessRuleSpecific(`$r) }
  foreach (`$r in `$rules) {
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$r[0])), `$r[1], `$tree, 'None', 'Allow')))
  }
  `$acl.SetOwner(`$admins)
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath '$forBot' -Force), `$acl)
  foreach (`$i in @(Get-ChildItem -LiteralPath '$forBot' -Recurse -Force)) {
    `$a = Get-Acl -LiteralPath `$i.FullName
    `$a.SetAccessRuleProtection(`$false, `$false)
    foreach (`$r in @(`$a.GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]))) { [void]`$a.RemoveAccessRuleSpecific(`$r) }
    `$a.SetOwner(`$admins)
    if (`$i -is [IO.DirectoryInfo]) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]`$i, [Security.AccessControl.DirectorySecurity]`$a) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]`$i, [Security.AccessControl.FileSecurity]`$a) }
  }
} catch { 'COULD NOT LOCK FOR-BOT: ' + `$_.Exception.Message; exit 1 }
Get-ChildItem -LiteralPath '$Root' -Directory -Force -EA SilentlyContinue | Where-Object { `$_.Name -like '.stage-*' } |
  ForEach-Object { Remove-Item -LiteralPath `$_.FullName -Recurse -Force -EA SilentlyContinue }
New-Item -ItemType Directory -Force -Path '$Root\$stage' | Out-Null
'READY'
"@ | ForEach-Object { "$_".Trim() })
if ($made -notcontains 'READY') { Die ("could not make $Root\$stage up there: " + ($made -join ' ') + '. The service was not touched.') }
$rootFar = $Root -replace '\\', '/'
foreach ($k in $send.Keys) {
    Invoke-ThornswoodNative { & scp @ssh $send[$k] "${target}:$rootFar/$stage/$k" }
    if ($LASTEXITCODE -ne 0) { Die "scp exited with $LASTEXITCODE for $k. The service was not touched." }
}
Say '  staged' 'Green'

# ---------------------------------------------------------------- install ---
Head 'Installing'
$want = ($hashes.Keys | ForEach-Object { "'$_' = '$($hashes[$_])'" }) -join '; '
$out = @(Remote @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
`$node = Get-Command node -EA SilentlyContinue
if (-not `$node) {
    `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    `$node = Get-Command node -EA SilentlyContinue
}
if (-not `$node) { 'node is not installed on this machine'; 'ADMIN REFUSED'; exit 1 }
`$stage = '$Root\$stage'
`$want = [ordered]@{ $want }

# The stage, checked with the old service still running.
foreach (`$f in `$want.Keys) {
    `$p = Join-Path `$stage `$f
    if (-not (Test-Path -LiteralPath `$p) -or (Get-FileHash -LiteralPath `$p -Algorithm SHA256).Hash -ne `$want[`$f]) { `$f + ' did not arrive as it was sent'; 'ADMIN REFUSED'; exit 1 }
}
foreach (`$f in 'admin.js', 'server-log.js') {
    `$said = & `$node.Source --check (Join-Path `$stage `$f) 2>&1
    if (`$LASTEXITCODE -ne 0) { `$f + ' does not parse: ' + (`$said -join ' '); 'ADMIN REFUSED'; exit 1 }
}
'the stage checks out'

$(Get-ThornswoodServiceAccountScript)
`$AsSystem = [bool]$([int][bool]$AsSystem)
if (-not `$AsSystem) {
    `$cannot = @(Test-ThornswoodServiceCannotReach (@(Get-ThornswoodServiceNeverReach -Own '$Root' -Box (Split-Path -Parent '$Root')) + '$Root'))
    if (`$cannot.Count) {
        'LOCAL SERVICE could read what no service may, so the admin service is not put on it:'
        `$cannot
        'Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -AsSystem. Nothing was stopped or changed.'
        'ADMIN REFUSED'; exit 1
    }
}

$stopIt

`$writer = Join-Path '$Root' 'server-log.js'
`$cmd = ('/c "set THORNSWOOD_ADMIN_PORT=$Port&& set THORNSWOOD_ADMIN_STATE=$state&& start "" /b /wait "{0}" "{2}" --log "{1}" --days 90 --stamp admin.js & call exit %^errorlevel%"' -f `$node.Source, '$log', `$writer)
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
# service's 404. A status code alone would take any other server on the port
# for it (#2875).
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
Set-ThornswoodHold -Target '$TaskName' -Why 'installing new admin service files' -By `$HoldBy
StopIt
if (-not `$stopOk) { Clear-ThornswoodHold -Target '$TaskName'; 'ADMIN REFUSED'; exit 1 }
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
            `$null = Grant-ThornswoodServiceFolder -Root '$Root' -Sid `$sid -Writable 'state', 'for-bot' -Files 'admin.log', 'admin.log.*'
            # What it makes is its own, not every service's (#4077).
            Set-ThornswoodTaskOwner -TaskName '$TaskName' -Sid `$sid -Roots '$Root'
        } catch { `$why = 'its folder could not be granted to it: ' + `$_.Exception.Message }
    }
    if (`$why) { `$why + ', so the task goes on SYSTEM'; Register `$true }
    else { 'the task runs as LOCAL SERVICE, Limited, as NT TASK\$TaskName' }
}
# The App's key reaches no other service (#4076), checked after the grant and
# before the service starts. CREATOR OWNER counts here: what it gives is what
# a LOCAL SERVICE file's owner gets, and that is every service on the box.
# The bot's token folder is held to the same, the bot's own account apart (#5184).
`$inState = @(@(Get-ChildItem -LiteralPath '$state' -Recurse -Force -EA SilentlyContinue) + @(Get-ChildItem -LiteralPath '$forBot' -Recurse -Force -EA SilentlyContinue))
`$open = @(Test-ThornswoodServiceCannotReach -Paths (@('$state', '$forBot') + @(`$inState | ForEach-Object { `$_.FullName })) -Sids @('S-1-3-0'))
foreach (`$i in `$inState) {
    `$a = Get-Acl -LiteralPath `$i.FullName
    `$capped = @(`$a.GetAccessRules(`$true, `$true, [Security.Principal.SecurityIdentifier]) | Where-Object { `$_.IdentityReference.Value -eq 'S-1-3-4' }).Count
    if (`$a.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-19' -and -not `$capped) { `$open += (`$i.FullName + ': LOCAL SERVICE owns it with no OWNER RIGHTS rule, so any service could give itself a rule on it') }
}
if (`$open.Count) {
    'ANOTHER SERVICE COULD READ THE APP''S KEY, so the admin service is left stopped and disabled:'
    `$open
    Clear-ThornswoodHold -Target '$TaskName'
    Disable-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue | Out-Null
    'ADMIN REFUSED'; exit 1
}
'state is SYSTEM''s, Administrators'' and the task''s own, and no other service reaches it; for-bot the same, with the bot''s own account to read it'
try { & `$node.Source `$writer --log '$log' --days 90 --roll } catch { 'could not roll admin.log: ' + `$_.Exception.Message }
Start-ScheduledTask -TaskName '$TaskName'
if (Answers @('$Plain')) {
    'the admin service answers on 127.0.0.1:$Port'
    if (-not (Test-Path -LiteralPath '$state\app.json')) { 'it holds no App yet, so it refuses every ask until -Setup makes one' }
    Clear-ThornswoodHold -Target '$TaskName'
    'ADMIN OK'; exit 0
}
'it did not answer on 127.0.0.1:$Port within $Wait seconds. admin.log says:'
if (Test-Path -LiteralPath '$log') { Get-Content -LiteralPath '$log' -Tail 15 } else { 'nothing was written' }
StopIt
`$back = @(Get-ChildItem -LiteralPath '$Root\$prev' -File -EA SilentlyContinue)
foreach (`$f in `$back) { Move-Item -LiteralPath `$f.FullName -Destination (Join-Path '$Root' `$f.Name) -Force }
if (`$oldXml) {
    if (Get-ScheduledTask -TaskName '$TaskName' -EA SilentlyContinue) { Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false }
    Register-ScheduledTask -TaskName '$TaskName' -Xml `$oldXml | Out-Null
    Start-ScheduledTask -TaskName '$TaskName'
    if (Answers @('$Plain')) { 'the old files and task are back, and it answers again' } else { 'THE OLD FILES AND TASK ARE BACK AND IT STILL DOES NOT ANSWER' }
} else {
    Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false -EA SilentlyContinue
    'there was no admin service before this, so none is left registered'
}
Clear-ThornswoodHold -Target '$TaskName'
'ADMIN ROLLED BACK'; exit 1
"@ | ForEach-Object { Say "  $_"; "$_".Trim() })
if ($out -notcontains 'ADMIN OK') { Die 'the admin service was not installed. The lines above say why and what is running.' }
$null = Set-ThornswoodArtifactCurrent -Artifact $artifact -Target $target -SshArgs $ssh -Root $Root

# ---------------------------------------------------------------- outside ---
Head 'Checking from here'
# A plain request through Caddy: the service says "box admin: not here" with
# a 404, and the site's own 404 says only "not here", so this whole line tells
# whether Caddy carries /github-app/ (#2875), which only the App's setup needs.
$via = $Site.TrimEnd('/') + '/github-app/'
$a = Get-PlainAnswer $via 15
if ($a.Code -eq 404 -and $a.Body -eq $Plain) {
    Say "  $via reaches the admin service." 'Green'
} else {
    $said = if ($a.Code) { "$($a.Code) $($a.Body)" } else { 'no answer: ' + $a.Why }
    Say "  $via did not reach the admin service (it said: $said), so Caddy does not carry /github-app/ yet, which the App's setup needs. Setup-Domain.ps1 -TaskOnly does not send the Caddyfile; Setup-Domain.ps1 does." 'Yellow'
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
