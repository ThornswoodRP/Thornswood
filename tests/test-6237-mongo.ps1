<#
  test-6237-mongo.ps1

  MongoDB on the box (#6237): records\mongodb.json, scripts\deploy\Mongo.ps1,
  scripts\deploy\Install-Mongo.ps1 and scripts\vps\mongo-users.js. mongod
  listens on loopback only with authorization on, each program signs in as a
  user of its own with only the rights it needs, and no password is printed
  or put on a command line.

  HOW. NEVER CONNECTS. Four parts.
    1. The record. The shipped one passes Read-ThornswoodMongoRecord, and a
       record that listens beyond loopback, downloads from anywhere but
       MongoDB's own downloads, has no SHA-256, leaves the 8.0 series the
       engine's driver is held to, or gives two programs one user is
       refused.
    2. mongod.cfg as Get-ThornswoodMongoConfig writes it: loopback, the
       record's port, authorization enabled, the cache, data and log under
       C:\Thornswood-Mongo.
    3. The users: each game server has readWrite on its own database and
       nothing else, the backup has backup and nothing else, each
       connection file is in the access folder, and a new connection string
       carries a 64 character hex password and the database it signs in to.
    4. The scripts: Install-Mongo.ps1 parses, runs mongosh only with --file
       (the connection files are read inside it), and the gate verb takes
       -Status and nothing that loosens it; mongo-users.js prints no
       password.
  Any platform. A few seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
. (Join-Path $Repo 'scripts/deploy/Mongo.ps1')
function Text([string]$p) { return [IO.File]::ReadAllText((Join-Path $Repo $p)) }
$recordPath = Join-Path $Repo 'records/mongodb.json'

# ---- 1. the record ----------------------------------------------------------
$rec = $null
try { $rec = Read-ThornswoodMongoRecord $recordPath; Yes 'the shipped record passes its own check' $true }
catch { Yes ('the shipped record passes its own check: ' + $_.Exception.Message) $false }

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-6237-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $scratch | Out-Null
function Refused([string]$what, [scriptblock]$change, [string]$says) {
    $r = (Text 'records/mongodb.json') | ConvertFrom-Json
    & $change $r
    $p = Join-Path $scratch 'r.json'
    [IO.File]::WriteAllText($p, ($r | ConvertTo-Json -Depth 8))
    $msg = ''
    try { $null = Read-ThornswoodMongoRecord $p } catch { $msg = $_.Exception.Message }
    Yes ("a record that $what is refused") ($msg -and $msg -match $says)
}
try {
    Refused 'listens on every address' { param($r) $r.bindIp = '0.0.0.0' } 'loopback'
    Refused 'downloads mongod from elsewhere' { param($r) $r.server.url = 'https://example.com/mongodb-windows-x86_64-8.0.38.zip' } 'own downloads'
    Refused 'names a url of another version' { param($r) $r.server.version = '8.0.39' } 'not its version'
    Refused 'has no SHA-256 for mongosh' { param($r) $r.shell.sha256 = '' } 'SHA-256'
    Refused 'takes a file outside a zip''s bin' { param($r) $r.tools.take = @('../evil.exe') } 'not a file in its bin'
    Refused 'leaves the 8.0 series' { param($r) $r.server.version = '7.0.14'; $r.server.url = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.14.zip' } '8\.0'
    Refused 'gives two servers one user' { param($r) $r.servers[1].user = $r.servers[0].user } 'two servers'
    Refused 'gives the backup a server''s user' { param($r) $r.backup.user = $r.servers[0].user } 'backup'
    Refused 'keeps a world outside thornswood-<name>' { param($r) $r.servers[0].database = 'admin' } 'thornswood-'
    Refused 'rehearses in a server''s database' { param($r) $r.servers[1].database = 'thornswood-rehearsal' } 'rehearsal'
    Refused 'gives the rehearsal a server''s user' { param($r) $r.rehearsal.user = $r.servers[0].user } 'rehearsal'
} finally { Remove-Item -LiteralPath $scratch -Recurse -Force -EA SilentlyContinue }

# ---- 2. mongod.cfg --------------------------------------------------------
if ($rec) {
    $cfg = Get-ThornswoodMongoConfig $rec 'C:\Thornswood-Mongo'
    Yes 'mongod.cfg listens on 127.0.0.1 only' ($cfg -match '(?m)^  bindIp: 127\.0\.0\.1\r?$')
    Yes 'mongod.cfg turns authorization on' ($cfg -match '(?m)^security:\r?\n  authorization: enabled\r?$')
    Yes 'mongod.cfg keeps the record''s port' ($cfg -match ('(?m)^  port: ' + [int]$rec.port + '\r?$'))
    Yes 'mongod.cfg caps the cache at the record''s size' ($cfg -match ('(?m)^      cacheSizeGB: ' + [regex]::Escape(([double]$rec.cacheSizeGB).ToString([Globalization.CultureInfo]::InvariantCulture)) + '\r?$'))
    Yes 'mongod.cfg keeps data and the log under C:\Thornswood-Mongo' ($cfg.Contains('dbPath: C:\Thornswood-Mongo\data') -and $cfg.Contains('path: C:\Thornswood-Mongo\log\mongod.log'))

# ---- 3. the users -----------------------------------------------------------
    $users = @(Get-ThornswoodMongoUsers $rec 'C:\Thornswood-Mongo')
    Yes 'one user per game server, the backup and the rehearsal' ($users.Count -eq (@($rec.servers).Count + 2))
    foreach ($s in @($rec.servers)) {
        $u = @($users | Where-Object { $_.User -eq $s.user })
        $ok = ($u.Count -eq 1 -and $u[0].Db -eq $s.database -and $u[0].Task -eq $s.task -and @($u[0].Roles).Count -eq 1 -and
               $u[0].Roles[0].role -eq 'readWrite' -and $u[0].Roles[0].db -eq $s.database)
        Yes ("$($s.user) reads and writes $($s.database) and nothing else, and only $($s.task) reads its file") $ok
    }
    $b = @($users | Where-Object { $_.User -eq $rec.backup.user })
    Yes 'the backup user has the backup role and nothing else' ($b.Count -eq 1 -and @($b[0].Roles).Count -eq 1 -and $b[0].Roles[0].role -eq 'backup' -and $b[0].Task -eq $rec.backup.task)
    $h = @($users | Where-Object { $_.User -eq $rec.rehearsal.user })
    Yes 'the rehearsal user reads and writes thornswood-rehearsal and nothing else, and no task reads its file' ($h.Count -eq 1 -and @($h[0].Roles).Count -eq 1 -and $h[0].Roles[0].role -eq 'readWrite' -and $h[0].Roles[0].db -eq 'thornswood-rehearsal' -and -not $h[0].Task)
    Yes 'every connection file is in the access folder' (@($users | Where-Object { $_.File -notlike 'C:\Thornswood-Mongo\access\*.uri' }).Count -eq 0)
    Yes 'the admin''s file is in the access folder' ((Get-ThornswoodMongoAdminFile $rec 'C:\Thornswood-Mongo') -eq ('C:\Thornswood-Mongo\access\' + $rec.admin.user + '.uri'))
    $uri = New-ThornswoodMongoUri 'live' 'thornswood-live' $rec
    Yes 'a new connection string signs in to its own database with a 64 character hex password' ($uri -match '^mongodb://live:[0-9a-f]{64}@127\.0\.0\.1:\d+/thornswood-live\?authSource=thornswood-live&directConnection=true$')
    Yes 'two new connection strings have different passwords' ((New-ThornswoodMongoUri 'a' 'admin' $rec) -ne (New-ThornswoodMongoUri 'a' 'admin' $rec))
}

# ---- 4. the scripts -------------------------------------------------------
foreach ($p in 'scripts/deploy/Install-Mongo.ps1', 'scripts/deploy/Mongo.ps1') {
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $p), [ref]$null, [ref]$errs)
    Yes "$p parses" (-not ($errs -and $errs.Count))
}
$inst = Text 'scripts/deploy/Install-Mongo.ps1'
$calls = @([regex]::Matches($inst, '& `\$mongosh [^\r\n]*') | ForEach-Object { $_.Value })
Yes 'Install-Mongo runs mongosh only with --nodb and --file, never a connection string' ($calls.Count -ge 1 -and @($calls | Where-Object { $_ -notmatch '--nodb --quiet --file' }).Count -eq 0)
Yes 'Install-Mongo checks each download''s SHA-256 against the record before it is used' ($inst.Contains('Get-FileHash -LiteralPath `$zip -Algorithm SHA256') -and $inst.Contains('-ne `$p.sha256'))
Yes 'Install-Mongo puts mongod on LOCAL SERVICE through ServiceAccount.ps1, with the fail-safe first' ($inst.Contains('New-ThornswoodServicePrincipal -AsSystem:`$system') -and $inst.Contains('Test-ThornswoodServiceCannotReach'))
Yes 'Install-Mongo lets the backup task run mongosh from bin and nothing else in the folder' ($inst.Contains('Get-ThornswoodTaskSidFromName ([string]`$rec.backup.task)') -and $inst.Contains('Get-Acl -LiteralPath `$bin') -and $inst.Contains("'ReadAndExecute'"))
$verbs = (Text 'scripts/vps/gate/verbs.json') | ConvertFrom-Json
$v = $verbs.verbs.'Install-Mongo'
Yes 'the gate''s Install-Mongo verb runs the script with -FromGate' ($v -and $v.script -eq 'scripts/deploy/Install-Mongo.ps1' -and @($v.fixed) -contains '-FromGate')
Yes 'the gate''s Install-Mongo verb takes -Status and nothing else' ($v -and (@($v.params.PSObject.Properties.Name) -join ',') -eq 'Status')
$js = Text 'scripts/vps/mongo-users.js'
$prints = @([regex]::Matches($js, 'print\([^;]*\);') | ForEach-Object { $_.Value })
Yes 'mongo-users.js prints no password' ($prints.Count -gt 0 -and @($prints | Where-Object { $_ -match '\.password|pwd|\.text\b' }).Count -eq 0)
Yes 'mongo-users.js reads the plan from its environment, not its command line' ($js.Contains('process.env.THORNSWOOD_MONGO_PLAN'))

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
