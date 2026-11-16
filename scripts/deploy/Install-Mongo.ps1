<#
  Install-Mongo.ps1

  Puts MongoDB on the box (#6237): the game servers keep their worlds there
  instead of one JSON file per form. mongod runs as the task Thornswood
  Mongo, listening on 127.0.0.1 only, with authorization on, and every
  program that signs in has a user of its own.

      pwsh scripts/vps/Box-Run.ps1 -Line 'Install-Mongo'           install, or bring it to the record
      pwsh scripts/vps/Box-Run.ps1 -Line 'Install-Mongo -Status'   what runs and who can sign in; only reads

  From a machine with the box's ssh it runs the same way without the gate:

      .\scripts\deploy\Install-Mongo.ps1 [-Status]

  It changes nothing about the game servers: they keep the file driver until
  the move (Move-World), which uses what this makes.

  WHAT IT DOES, on the box, stopping at the first thing that is not right:
    1. Makes C:\Thornswood-Mongo and locks it: nothing from C:\, only
       SYSTEM, Administrators and the account running this, plus the task's
       own SID below. The access folder in it takes no rules from above.
    2. Downloads each of the record's three zips (records\mongodb.json) that
       is not the one installed, checks its SHA-256 against the record, and
       takes only the files the record names out of it. Nothing downloaded
       is run before its hash matched.
    3. Writes mongod.cfg from the record (Mongo.ps1): loopback, the port,
       authorization on, the cache, the data and log folders.
    4. Checks mongod starts at all. A box without the Visual C++ runtime
       ends it with 0xC0000135, and then the runtime from the server's own
       zip (vc_redist.x64.exe, checked with it) is installed once and
       mongod asked again.
    5. Registers the task as LOCAL SERVICE, Limited, with a SID of its own
       (ServiceAccount.ps1, #2578), started at boot and again a minute after
       it stops, with data and log its only writable folders, and starts it.
       Before it is put on LOCAL SERVICE the fail-safe reads that no service
       can read what none may, the access folder among them.
    6. Waits for mongod to listen, -Wait seconds at most.
    7. Makes the users with mongo-users.js (mongosh), from the connection
       files in access: the admin (root), one per game server (readWrite on
       its own database) and the backup (backup, which reads and changes
       nothing). A file that is not there is made with a new password; one
       that is there keeps its password, and the server is set to it. Each
       file is readable by SYSTEM, Administrators and the one task that signs
       in with it. The first run makes the admin through MongoDB's localhost
       exception, the one step it allows on a server with no users; the
       admin's file is kept only once the admin is made.
    8. Lets the backup task read and run bin, for the nightly backup's
       mongosh, which reads each world out (World.ps1).
  When mongod or its configuration changes while mongod runs, the admin asks
  it to stop cleanly first. While a game server runs that does not happen:
  it says to stop them, since their worlds will be kept here.

  -AsSystem registers the task as SYSTEM, Highest: the way back if mongod
  will not run as LOCAL SERVICE. Say why on the issue.
#>
[CmdletBinding()]
param(
  [string]$VpsHost = '',
  [string]$VpsUser = '',
  [string]$RecordPath = '',
  # How long mongod has to listen once started.
  [int]$Wait = 60,
  [switch]$Status,
  [switch]$AsSystem,
  # The deploy gate's Install-Mongo verb. Refused anywhere but under the gate.
  [switch]$FromGate,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here 'ServiceAccount.ps1')
. (Join-Path $Here 'Mongo.ps1')
# The hold the install writes while it has mongod stopped (#5155).
. (Join-Path $Here '..\vps\ServerHold.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

if ($FromGate) {
  if ($env:THORNSWOOD_GATE -ne '1') { Die '-FromGate is for the deploy gate''s Install-Mongo verb: pwsh scripts/vps/Box-Run.ps1 -Line ''Install-Mongo''. Nothing was changed.' }
  $handPicked = @('VpsHost', 'VpsUser', 'RecordPath') | Where-Object { $PSBoundParameters.ContainsKey($_) }
  if ($AsSystem -or @($handPicked).Count) { Die 'through the gate MongoDB is installed from main''s record, as LOCAL SERVICE. Nothing was changed.' }
}
if ($Wait -lt 5 -or $Wait -gt 600) { Die '-Wait is 5 to 600 seconds. Nothing was sent.' }

if (-not $RecordPath) { $RecordPath = Join-Path $Here '..\..\records\mongodb.json' }
try { $rec = Read-ThornswoodMongoRecord $RecordPath } catch { Die ($_.Exception.Message + '. Nothing was sent.') }
$usersJs = Join-Path $Here '..\vps\mongo-users.js'
if (-not (Test-Path -LiteralPath $usersJs)) { Die 'there is no mongo-users.js beside the vps scripts. Nothing was sent.' }

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
foreach ($t in 'ssh', 'scp') { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "$t is not on PATH. Nothing was sent." } }
function Remote($script) { return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script }
function B64([string]$s) { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }

$Root = $ThornswoodMongoRoot
$recB64 = B64 ([IO.File]::ReadAllText($RecordPath))
$cfgB64 = B64 (Get-ThornswoodMongoConfig $rec $Root)
$usersB64 = B64 (ConvertTo-Json -InputObject @(Get-ThornswoodMongoUsers $rec $Root) -Depth 6 -Compress)
$serverTasks = @($rec.servers | ForEach-Object { "'" + ([string]$_.task).Replace("'", "''") + "'" }) -join ', '

# --------------------------------------------- what every box run has ---
$common = @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$(Get-ThornswoodMongoScript)
`$rec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$recB64')) | ConvertFrom-Json
`$root = `$ThornswoodMongoRoot
`$task = `$ThornswoodMongoTask
`$bin = Join-Path `$root 'bin'
`$access = Join-Path `$root 'access'
`$cfg = Join-Path `$root 'mongod.cfg'
`$log = Join-Path `$root 'log\mongod.log'
`$mongod = Join-Path `$bin 'mongod.exe'
`$mongosh = Join-Path `$bin 'mongosh.exe'
`$usersJs = Join-Path `$root 'mongo-users.js'
`$adminFile = Get-ThornswoodMongoAdminFile `$rec `$root
`$serverTasks = @($serverTasks)
function Test-Listening { try { `$c = New-Object Net.Sockets.TcpClient; `$c.Connect(`$rec.bindIp, [int]`$rec.port); `$c.Close(); return `$true } catch { return `$false } }
# mongo-users.js with a plan; its lines, and the exit code in `$global:usersCode.
function Invoke-Users(`$plan) {
    `$planFile = Join-Path `$access ('plan-' + [guid]::NewGuid().ToString('n') + '.json')
    [IO.File]::WriteAllText(`$planFile, (ConvertTo-Json -InputObject `$plan -Depth 8), (New-Object Text.UTF8Encoding(`$false)))
    try {
        `$env:THORNSWOOD_MONGO_PLAN = `$planFile
        `$lines = @(& `$mongosh --nodb --quiet --file `$usersJs 2>&1 | ForEach-Object { "`$_" })
        `$global:usersCode = `$LASTEXITCODE
        return `$lines
    } finally { `$env:THORNSWOOD_MONGO_PLAN = `$null; Remove-Item -LiteralPath `$planFile -Force -EA SilentlyContinue }
}
"@

# ------------------------------------------------------------------ status --
if ($Status) {
  Head 'On the box'
  Remote ($common + @"

`$ErrorActionPreference = 'SilentlyContinue'
`$t = Get-ScheduledTask -TaskName `$task
if (`$t) { `$i = Get-ScheduledTaskInfo -TaskName `$task; 'task      ' + `$t.State + ' as ' + `$t.Principal.UserId + ', last ran ' + `$i.LastRunTime + ' result ' + `$i.LastTaskResult } else { 'task      NOT REGISTERED' }
`$inst = Join-Path `$bin 'installed.json'
if (Test-Path -LiteralPath `$inst) { `$have = [IO.File]::ReadAllText(`$inst) | ConvertFrom-Json; foreach (`$k in 'server', 'tools', 'shell') { 'bin       ' + `$k + ' ' + `$have.`$k.version + `$(if (`$have.`$k.sha256 -eq `$rec.`$k.sha256) { ', the recorded build' } else { ', NOT the recorded ' + `$rec.`$k.version }) } } else { 'bin       NOTHING INSTALLED' }
'listening ' + `$(if (Test-Listening) { 'yes, ' + `$rec.bindIp + ':' + `$rec.port } else { 'NO' })
`$size = (Get-ChildItem -LiteralPath (Join-Path `$root 'data') -File -Recurse -Force | Measure-Object Length -Sum).Sum
'data      ' + [math]::Round(`$size / 1MB, 1) + ' MB'
foreach (`$u in @(Get-ChildItem -LiteralPath `$access -File -Filter '*.uri')) { 'access    ' + `$u.Name + ' (never shown)' }
if ((Test-Path -LiteralPath `$adminFile) -and (Test-Listening)) {
    ''; '--- users, as the admin reads them ---'
    Invoke-Users @{ adminUri = `$adminFile; firstRun = `$false; users = @() }
}
if (Test-Path -LiteralPath `$log) { ''; '--- mongod.log, last 10 ---'; Get-Content -LiteralPath `$log -Tail 10 }
"@) | ForEach-Object { Say "  $_" }
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

# ----------------------------------------------------------------- install --
Head 'Sending mongo-users.js up'
$made = Remote @"
`$r = '$Root'
if (-not (Test-Path -LiteralPath `$r)) { [void](New-Item -ItemType Directory -Path `$r -Force) }
'READY'
"@
if ("$made" -notmatch 'READY') { Die "could not make $Root on the box: $made" }
Invoke-ThornswoodNative { & scp @ssh $usersJs "${target}:$($Root.Replace('\','/'))/mongo-users.js" }
if ($LASTEXITCODE -ne 0) { Die 'scp of mongo-users.js failed. Nothing was installed.' }

Head 'Installing MongoDB'
$asSystemInt = [int][bool]$AsSystem
$install = $common + "`r`n" + (Get-ThornswoodServiceAccountScript) + (Get-ThornswoodHoldScript -Script 'Install-Mongo.ps1') + @"

`$AsSystem = [bool]$asSystemInt
`$wait = $Wait
`$utf8 = New-Object Text.UTF8Encoding(`$false)
# Nothing from C:\, only SYSTEM, Administrators and whoever runs this. Other
# rules already on it (the task's SID from an earlier run) stay.
function Lock-Folder([string]`$dir, [bool]`$keepOthers) {
    `$acl = Get-Acl -LiteralPath `$dir
    `$acl.SetAccessRuleProtection(`$true, `$false)
    foreach (`$r in @(`$acl.GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]))) {
        if (@('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-19') -contains `$r.IdentityReference.Value -or -not `$keepOthers) { [void]`$acl.RemoveAccessRuleSpecific(`$r) }
    }
    foreach (`$s in @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
        `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$s)), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
    }
    Set-ThornswoodServiceAcl `$dir `$acl
}
# A connection file: SYSTEM, Administrators, whoever runs this, and the one
# task that signs in with it.
function Lock-UriFile([string]`$file, [string]`$taskName) {
    `$acl = New-Object Security.AccessControl.FileSecurity
    `$acl.SetAccessRuleProtection(`$true, `$false)
    foreach (`$s in @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
        `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$s)), 'FullControl', 'Allow')))
    }
    if (`$taskName) {
        `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier((Get-ThornswoodTaskSidFromName `$taskName))), 'Read', 'Allow')))
    }
    Set-ThornswoodServiceAcl `$file `$acl
}
function Write-Locked([string]`$file, [string]`$text, [string]`$taskName) {
    if (-not (Test-Path -LiteralPath `$file)) { [IO.File]::WriteAllText(`$file, '', `$utf8) }
    Lock-UriFile `$file `$taskName
    [IO.File]::WriteAllText(`$file, `$text, `$utf8)
}

`$held = `$false
try {
    # 1. The folders, locked.
    foreach (`$d in @(`$root, `$bin, (Join-Path `$root 'data'), (Join-Path `$root 'log'), `$access)) { if (-not (Test-Path -LiteralPath `$d)) { New-Item -ItemType Directory -Path `$d -Force | Out-Null } }
    Lock-Folder `$root `$true
    Lock-Folder `$access `$false
    if (-not (Test-Path -LiteralPath `$usersJs)) { 'mongo-users.js did not arrive in ' + `$root; 'MONGO REFUSED'; exit 1 }

    # 2. The recorded builds, or nothing.
    `$inst = Join-Path `$bin 'installed.json'
    `$have = if (Test-Path -LiteralPath `$inst) { [IO.File]::ReadAllText(`$inst) | ConvertFrom-Json } else { `$null }
    `$stage = Join-Path `$root ('.stage-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    `$staged = @{}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach (`$k in 'server', 'tools', 'shell') {
        `$p = `$rec.`$k
        `$there = (`$have -and `$have.`$k -and `$have.`$k.sha256 -eq `$p.sha256)
        foreach (`$f in @(`$p.take)) { if (-not (Test-Path -LiteralPath (Join-Path `$bin (Split-Path -Leaf `$f)))) { `$there = `$false } }
        if (`$there) { `$k + ' ' + `$p.version + ' is already the recorded build'; continue }
        New-Item -ItemType Directory -Path (Join-Path `$stage `$k) -Force | Out-Null
        `$zip = Join-Path `$stage (`$k + '.zip')
        Invoke-WebRequest -Uri `$p.url -OutFile `$zip -UseBasicParsing -TimeoutSec 900
        `$h = (Get-FileHash -LiteralPath `$zip -Algorithm SHA256).Hash.ToLowerInvariant()
        if (`$h -ne `$p.sha256) { Remove-Item -LiteralPath `$stage -Recurse -Force -EA SilentlyContinue; `$k + ' ' + `$p.version + ' came down as ' + `$h + ', not the recorded ' + `$p.sha256 + ', so nothing of it was used'; 'MONGO REFUSED'; exit 1 }
        # Only the named files, each from the zip's one top folder.
        `$z = [IO.Compression.ZipFile]::OpenRead(`$zip)
        try {
            foreach (`$f in @(`$p.take)) {
                `$e = @(`$z.Entries | Where-Object { (`$_.FullName -replace '\\', '/') -match ('^[^/]+/' + [regex]::Escape([string]`$f) + '`$') })
                if (`$e.Count -ne 1) { `$k + ' ' + `$p.version + ' holds ' + `$e.Count + ' copies of ' + `$f + ', not one'; 'MONGO REFUSED'; exit 1 }
                [IO.Compression.ZipFileExtensions]::ExtractToFile(`$e[0], (Join-Path (Join-Path `$stage `$k) (Split-Path -Leaf `$f)), `$true)
            }
        } finally { `$z.Dispose() }
        Remove-Item -LiteralPath `$zip -Force
        `$staged[`$k] = `$true
        'downloaded ' + `$k + ' ' + `$p.version + ', SHA-256 matched'
    }

    # 3. The configuration (written below, once mongod is stopped if it must be).
    `$cfgText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$cfgB64'))
    `$cfgNew = -not ((Test-Path -LiteralPath `$cfg) -and ([IO.File]::ReadAllText(`$cfg) -ceq `$cfgText))

    # The task as it should be (registered in 5).
    `$arg = '--config "' + `$cfg + '"'
    `$haveTask = Get-ScheduledTask -TaskName `$task -EA SilentlyContinue
    `$sameTask = (`$haveTask -and ([string]@(`$haveTask.Actions)[0].Arguments).Contains(`$arg) -and ([bool](`$haveTask.Principal.UserId -match 'SYSTEM') -eq `$AsSystem))
    `$change = (`$staged.Count -gt 0 -or `$cfgNew -or -not `$sameTask)

    if (`$change -and (Test-Listening)) {
        `$running = @(foreach (`$s in `$serverTasks) { `$x = Get-ScheduledTask -TaskName `$s -EA SilentlyContinue; if (`$x -and "`$(`$x.State)" -eq 'Running') { `$s } })
        if (`$running.Count) { 'mongod would have to stop, and ' + (`$running -join ' and ') + ' is running. Their worlds are kept here, so stop them first. Nothing was changed.'; 'MONGO REFUSED'; exit 1 }
        if (-not (Test-Path -LiteralPath `$adminFile)) { 'mongod is running and there is no admin file to stop it cleanly with. Nothing was changed.'; 'MONGO REFUSED'; exit 1 }
        `$said = Invoke-Users @{ adminUri = `$adminFile; firstRun = `$false; shutdown = `$true }
        if (`$said -notcontains 'SHUTDOWN SENT') { `$said; 'mongod did not take the shutdown. Nothing was changed.'; 'MONGO REFUSED'; exit 1 }
        `$until = (Get-Date).AddSeconds(60)
        while ((Test-Listening) -and (Get-Date) -lt `$until) { Start-Sleep -Seconds 1 }
        if (Test-Listening) { 'mongod still listens a minute after it was asked to stop. Nothing was changed.'; 'MONGO REFUSED'; exit 1 }
        'stopped mongod cleanly'
    }
    # Held while it is stopped (#5155), so nothing that watches it starts a
    # half-installed mongod; the finally below takes the hold away.
    if (`$change) {
        Set-ThornswoodHold -Target `$task -Why 'installing mongod' -By `$HoldBy
        `$held = `$true
        Stop-ScheduledTask -TaskName `$task -EA SilentlyContinue
    }

    foreach (`$k in @(`$staged.Keys)) {
        foreach (`$f in @(Get-ChildItem -LiteralPath (Join-Path `$stage `$k) -File)) { Move-Item -LiteralPath `$f.FullName -Destination (Join-Path `$bin `$f.Name) -Force }
    }
    if (`$staged.Count) {
        `$now = [ordered]@{}
        foreach (`$k in 'server', 'tools', 'shell') { `$now[`$k] = @{ version = `$rec.`$k.version; sha256 = `$rec.`$k.sha256 } }
        [IO.File]::WriteAllText(`$inst, (ConvertTo-Json -InputObject `$now -Depth 4), `$utf8)
    }
    if (Test-Path -LiteralPath `$stage) { Remove-Item -LiteralPath `$stage -Recurse -Force -EA SilentlyContinue }
    if (`$cfgNew) { [IO.File]::WriteAllText(`$cfg, `$cfgText, `$utf8); 'wrote mongod.cfg' }

    # 4. mongod runs at all. 0xC0000135 is a DLL Windows could not find: the
    # Visual C++ runtime, which the server's own zip carries.
    `$v = @(& `$mongod --version 2>&1 | ForEach-Object { "`$_" })
    if (`$LASTEXITCODE -eq -1073741515) {
        `$redist = Join-Path `$bin 'vc_redist.x64.exe'
        `$p = Start-Process -FilePath `$redist -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
        if (@(0, 1638, 3010) -notcontains `$p.ExitCode) { 'the Visual C++ runtime would not install (' + `$p.ExitCode + ')'; 'MONGO REFUSED'; exit 1 }
        'installed the Visual C++ runtime mongod needs'
        `$v = @(& `$mongod --version 2>&1 | ForEach-Object { "`$_" })
    }
    if (`$LASTEXITCODE -ne 0) { 'mongod --version ended with ' + `$LASTEXITCODE + ':'; `$v | Select-Object -First 5; 'MONGO REFUSED'; exit 1 }
    'mongod: ' + (`$v | Select-Object -First 1)

    # 5. The task.
    if (-not `$AsSystem) {
        `$cannot = @(Test-ThornswoodServiceCannotReach (@(Get-ThornswoodServiceNeverReach -Own `$root -Box (Split-Path -Parent `$root)) + `$access))
        if (`$cannot.Count) { 'LOCAL SERVICE could read what no service may, so mongod is not put on it:'; `$cannot; 'Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -AsSystem. Nothing was started.'; 'MONGO REFUSED'; exit 1 }
    }
    if (-not `$sameTask) {
        function Register([bool]`$system) {
            `$action = New-ScheduledTaskAction -Execute `$mongod -Argument `$arg -WorkingDirectory `$root
            if (Get-ScheduledTask -TaskName `$task -EA SilentlyContinue) { Unregister-ScheduledTask -TaskName `$task -Confirm:`$false }
            `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Priority 4
            Register-ScheduledTask -TaskName `$task -Action `$action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings `$settings -Principal (New-ThornswoodServicePrincipal -AsSystem:`$system) | Out-Null
        }
        Register `$AsSystem
        if (-not `$AsSystem) {
            `$why = ''
            `$sid = Get-ThornswoodTaskSid `$task
            if (-not `$sid) { `$why = 'the task SID NT TASK\' + `$task + ' could not be looked up' }
            else {
                try {
                    `$null = Grant-ThornswoodServiceFolder -Root `$root -Sid `$sid -Writable 'data', 'log'
                    Set-ThornswoodTaskOwner -TaskName `$task -Sid `$sid -Roots `$root | Out-Null
                } catch { `$why = 'its folder could not be granted to it: ' + `$_.Exception.Message }
            }
            if (`$why) { `$why + ', so the task goes on SYSTEM'; Register `$true }
            else { 'the task runs as LOCAL SERVICE, Limited, as NT TASK\' + `$task }
        } else { 'the task runs as SYSTEM, Highest, as -AsSystem asked' }
    }
    if (-not (Test-Listening)) { Start-ScheduledTask -TaskName `$task }

    # 6. Listening.
    `$until = (Get-Date).AddSeconds(`$wait)
    while (-not (Test-Listening) -and (Get-Date) -lt `$until) { Start-Sleep -Seconds 1 }
    if (-not (Test-Listening)) {
        'mongod is not listening on ' + `$rec.bindIp + ':' + `$rec.port + ' after ' + `$wait + ' seconds. mongod.log says:'
        if (Test-Path -LiteralPath `$log) { Get-Content -LiteralPath `$log -Tail 15 } else { 'nothing was written' }
        'MONGO REFUSED'; exit 1
    }
    'mongod is listening on ' + `$rec.bindIp + ':' + `$rec.port

    # 7. The users. The admin's file is kept only once the admin is made.
    `$firstRun = -not (Test-Path -LiteralPath `$adminFile)
    `$adminUse = `$adminFile
    if (`$firstRun) {
        `$adminUse = `$adminFile + '.new'
        Write-Locked `$adminUse (New-ThornswoodMongoUri ([string]`$rec.admin.user) 'admin' `$rec) ''
    }
    `$users = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$usersB64')) | ConvertFrom-Json
    `$plan = @{ adminUri = `$adminUse; firstRun = `$firstRun; users = @() }
    foreach (`$u in @(`$users)) {
        if (-not (Test-Path -LiteralPath `$u.File)) { Write-Locked `$u.File (New-ThornswoodMongoUri `$u.User `$u.Db `$rec) `$u.Task; 'made a connection file for ' + `$u.User + ' (not shown)' }
        else { Lock-UriFile `$u.File `$u.Task }
        `$plan.users += @{ user = `$u.User; db = `$u.Db; roles = @(`$u.Roles); uri = `$u.File }
    }
    `$said = Invoke-Users `$plan
    `$said
    if (`$global:usersCode -ne 0 -or `$said -notcontains 'USERS OK') { 'the users were not all made'; 'MONGO REFUSED'; exit 1 }
    if (`$firstRun) { Move-Item -LiteralPath `$adminUse -Destination `$adminFile -Force; Lock-UriFile `$adminFile '' }
    # The nightly backup reads each world out with mongosh (World.ps1), so
    # its task may read and run what is in bin, and nothing else here.
    `$backupSid = Get-ThornswoodTaskSidFromName ([string]`$rec.backup.task)
    `$acl = Get-Acl -LiteralPath `$bin
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$backupSid)), 'ReadAndExecute', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
    Set-ThornswoodServiceAcl `$bin `$acl
    'the backup task may run mongosh from bin, to read the worlds out'
    'MONGO OK'; exit 0
} catch { 'STOPPED: ' + `$_.Exception.Message; 'MONGO REFUSED'; exit 1 }
finally { if (`$held) { Clear-ThornswoodHold -Target `$task } }
"@

$out = @(Remote $install | ForEach-Object { Say "  $_"; "$_".Trim() })
if ($out -notcontains 'MONGO OK') { Die 'MongoDB is not installed as it should be. The lines above say why.' }
Say '  MongoDB runs on the box with its users. The game servers still keep their worlds in files until the move.' 'Green'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
