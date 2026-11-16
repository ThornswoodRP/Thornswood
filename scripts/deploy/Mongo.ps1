<#
  Mongo.ps1

  What every MongoDB script reads (#6237): the record, the folder on the box,
  the configuration mongod starts with, and who signs in to which database.
  Dot-source it:

      . (Join-Path $Here 'Mongo.ps1')

  records\mongodb.json says what runs and why. On the box everything is in
  one folder, C:\Thornswood-Mongo:
      bin       mongod, mongodump, mongorestore, mongosh, checked against the
                record's SHA-256 before any of it is used
      data      the databases, one per game server
      log       mongod.log
      access    one connection file per user, each readable by the task that
                signs in with it and by nothing else (Install-Mongo.ps1);
                the folder takes no rules from above, so mongod itself
                cannot read them
      mongod.cfg
  A password is made on the box, kept only in its connection file, and never
  printed, put on a command line or sent anywhere (#451).
#>

$ThornswoodMongoRoot = 'C:\Thornswood-Mongo'
$ThornswoodMongoTask = 'Thornswood Mongo'

# The record, read whole and checked. Throws with what is wrong.
function Read-ThornswoodMongoRecord {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "not found: $Path" }
    $r = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
    $hosts = @{
        server = '^https://fastdl\.mongodb\.org/windows/mongodb-windows-x86_64-(\d+\.\d+\.\d+)\.zip$'
        tools  = '^https://fastdl\.mongodb\.org/tools/db/mongodb-database-tools-windows-x86_64-(\d+\.\d+\.\d+)\.zip$'
        shell  = '^https://downloads\.mongodb\.com/compass/mongosh-(\d+\.\d+\.\d+)-win32-x64\.zip$'
    }
    foreach ($k in 'server', 'tools', 'shell') {
        $p = $r.$k
        if (-not $p) { throw "the record names no $k" }
        if ([string]$p.url -notmatch $hosts[$k]) { throw ("the record's $k does not come from MongoDB's own downloads: " + $p.url) }
        if ($Matches[1] -ne [string]$p.version) { throw ("the record's $k url is not its version " + $p.version) }
        if ([string]$p.sha256 -notmatch '^[0-9a-f]{64}$') { throw "the record's $k has no SHA-256" }
        $take = @($p.take)
        if ($take.Count -lt 1) { throw "the record takes nothing from its $k" }
        foreach ($t in $take) { if ([string]$t -notmatch '^bin/[A-Za-z0-9_.]+\.(exe|dll)$') { throw ("the record's $k takes " + $t + ', which is not a file in its bin') } }
    }
    if ([string]$r.server.version -notmatch '^8\.0\.') { throw 'the engine''s driver (mongo-c-driver 2.2.3) is held to the 8.0 series' }
    if ([string]$r.bindIp -ne '127.0.0.1') { throw 'mongod listens on loopback only' }
    if ([int]$r.port -lt 1024 -or [int]$r.port -gt 65535) { throw 'the record''s port is not one a service listens on' }
    if ([double]$r.cacheSizeGB -le 0 -or [double]$r.cacheSizeGB -gt 2) { throw 'the record''s cache is not between 0 and 2 GB on an 8 GB box' }
    $names = @{}
    foreach ($s in @($r.servers)) {
        foreach ($k in 'name', 'task', 'database', 'user') { if (-not [string]$s.$k) { throw "a server in the record has no $k" } }
        if ([string]$s.database -notmatch '^thornswood-[a-z]+$') { throw ('a server''s database is not thornswood-<name>: ' + $s.database) }
        if ([string]$s.user -notmatch '^[a-z]+$') { throw ('a server''s user is not lower case letters: ' + $s.user) }
        if ($names.ContainsKey([string]$s.user)) { throw ('two servers sign in as ' + $s.user) }
        $names[[string]$s.user] = $true
    }
    if (@($r.servers).Count -lt 1) { throw 'the record names no server' }
    foreach ($k in 'backup', 'admin') {
        if ([string]$r.$k.user -notmatch '^[a-z]+$') { throw "the record's $k user is not lower case letters" }
        if ($names.ContainsKey([string]$r.$k.user)) { throw ("the $k signs in as a server's user") }
        $names[[string]$r.$k.user] = $true
    }
    if (-not [string]$r.backup.task) { throw 'the record names no backup task' }
    # The rehearsal's world is a database of its own, never a server's (#6237).
    if ([string]$r.rehearsal.user -notmatch '^[a-z]+$') { throw 'the record''s rehearsal user is not lower case letters' }
    if ($names.ContainsKey([string]$r.rehearsal.user)) { throw 'the rehearsal signs in as another program''s user' }
    if ([string]$r.rehearsal.database -ne 'thornswood-rehearsal') { throw 'the rehearsal''s database is not thornswood-rehearsal' }
    if (@($r.servers | Where-Object { [string]$_.database -eq [string]$r.rehearsal.database }).Count) { throw 'a server keeps its world in the rehearsal''s database' }
    return $r
}

# mongod.cfg, as mongod reads it. Loopback only and authorization on: there
# is no way to start it here with either off.
function Get-ThornswoodMongoConfig {
    param($Record, [string]$Root = $ThornswoodMongoRoot)
    $lines = @(
        '# Written by Install-Mongo.ps1 from records\mongodb.json (#6237). A change here is lost at its next run.',
        'net:',
        ('  bindIp: ' + $Record.bindIp),
        ('  port: ' + [int]$Record.port),
        'security:',
        '  authorization: enabled',
        'storage:',
        ('  dbPath: ' + $Root.TrimEnd('\') + '\data'),
        '  wiredTiger:',
        '    engineConfig:',
        ('      cacheSizeGB: ' + ([double]$Record.cacheSizeGB).ToString([Globalization.CultureInfo]::InvariantCulture)),
        'systemLog:',
        '  destination: file',
        ('  path: ' + $Root.TrimEnd('\') + '\log\mongod.log'),
        '  logAppend: true',
        '  logRotate: rename'
    )
    return (($lines -join "`r`n") + "`r`n")
}

# Each user, the database it signs in to, its roles, the task that reads its
# connection file, and that file. The admin's file only SYSTEM and
# Administrators read.
function Get-ThornswoodMongoUsers {
    param($Record, [string]$Root = $ThornswoodMongoRoot)
    # Windows paths, built as text: this also runs on a Linux machine that
    # sends the install to the box.
    $access = $Root.TrimEnd('\') + '\access'
    $out = @()
    foreach ($s in @($Record.servers)) {
        $out += [pscustomobject]@{ User = [string]$s.user; Db = [string]$s.database; Task = [string]$s.task
            Roles = @(@{ role = 'readWrite'; db = [string]$s.database }); File = ($access + '\' + [string]$s.user + '.uri') }
    }
    # backup reads every database for mongodump; it changes nothing.
    $out += [pscustomobject]@{ User = [string]$Record.backup.user; Db = 'admin'; Task = [string]$Record.backup.task
        Roles = @(@{ role = 'backup'; db = 'admin' }); File = ($access + '\' + [string]$Record.backup.user + '.uri') }
    # The restore rehearsal's: its own database and nothing else, read by
    # SYSTEM and Administrators only (no task), as the gate runs it.
    $out += [pscustomobject]@{ User = [string]$Record.rehearsal.user; Db = [string]$Record.rehearsal.database; Task = ''
        Roles = @(@{ role = 'readWrite'; db = [string]$Record.rehearsal.database }); File = ($access + '\' + [string]$Record.rehearsal.user + '.uri') }
    return $out
}

function Get-ThornswoodMongoAdminFile {
    param($Record, [string]$Root = $ThornswoodMongoRoot)
    return ($Root.TrimEnd('\') + '\access\' + [string]$Record.admin.user + '.uri')
}

# A connection string for one user. The password is 32 random bytes as hex,
# so nothing in it needs escaping in a URI.
function New-ThornswoodMongoUri {
    param([string]$User, [string]$Db, $Record)
    $b = New-Object byte[] 32
    ([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($b)
    $pw = -join ($b | ForEach-Object { $_.ToString('x2') })
    return ('mongodb://' + $User + ':' + $pw + '@' + $Record.bindIp + ':' + [int]$Record.port + '/' + $Db + '?authSource=' + $Db + '&directConnection=true')
}

# The functions above as text, for a script that runs on the box.
function Get-ThornswoodMongoScript {
    $out = '$ThornswoodMongoRoot = ''' + $ThornswoodMongoRoot + "'`r`n" + '$ThornswoodMongoTask = ''' + $ThornswoodMongoTask + "'`r`n"
    foreach ($n in 'Read-ThornswoodMongoRecord', 'Get-ThornswoodMongoConfig', 'Get-ThornswoodMongoUsers', 'Get-ThornswoodMongoAdminFile', 'New-ThornswoodMongoUri') {
        $out += 'function ' + $n + ' {' + (Get-Item ('function:' + $n)).ScriptBlock.ToString() + "}`r`n"
    }
    return $out
}
