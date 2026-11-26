<#
  tests/test-6237-move.ps1

  Move-World.ps1 (#6237): the step that moves a game server's world out of
  the file driver into its database in MongoDB.

  HOW. Always:
    - the gate's Move-World-Dev and Move-World-Main run it on dev and on
      main, take -Survey and nothing else, and main's is a live verb that
      never runs on its own after a deploy, where dev's may;
    - a survey carries no stop and no hold;
    - startup accepts fresh UTC and legacy MongoDB records, and ignores stale or malformed records;
    - its box step, built as the script builds it and run in pwsh, refuses a
      folder whose server-settings.json names another server, with nothing
      touched.
  With THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI (a mongod that
  takes writes to thornswood-wtestm), the box step runs whole against a
  stand-in server folder: the task's start and stop, the UDP list and the
  engine are stand-ins (the engine's move is the fork's MigrationDatabase,
  tested there; this one copies with world.js and says what the engine
  says), the database and every file are real. It checks
    - a survey says what a move would do and changes nothing;
    - it refuses a database that already holds forms, a connection file that
      is not there and an engine from before PR #161, with nothing stopped;
    - an engine that fails, and a database that does not hold what the
      folder holds, leave the server on its files with its own settings,
      byte for byte, and start it again;
    - a move runs the engine with the migration settings, finishes an
      unfinished save first, moves the world folder aside, writes the
      settings that say MongoDB with every other setting kept, and starts the
      server, which loads every form; the hold is gone after;
    - a second run says the world is already there;
    - a server that loads fewer forms than the database holds is said.
  Without them that part prints SKIP. Any platform with pwsh and node.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string]$rel) { return (Join-Path $Repo ($rel.Replace('/', [IO.Path]::DirectorySeparatorChar))) }

# ---- the gate's verbs -------------------------------------------------------
$verbs = [IO.File]::ReadAllText((P 'scripts/vps/gate/verbs.json')) | ConvertFrom-Json
$dev = $verbs.verbs.'Move-World-Dev'
$main = $verbs.verbs.'Move-World-Main'
Yes 'Move-World-Dev runs Move-World.ps1 on dev with -Yes -NoPause, takes -Survey only, is not a live verb, and may run after a dev deploy' (
    $dev -and $dev.script -eq 'scripts/ops/Move-World.ps1' -and ($dev.fixed -join ' ') -eq '-Server dev -Yes -NoPause' -and
    @($dev.params.PSObject.Properties.Name) -join ',' -eq 'Survey' -and -not $dev.PSObject.Properties['build'] -and (@($dev.afterDeploy) -join ',') -eq 'dev')
Yes 'Move-World-Main runs it on main, is a live verb (its line names main''s commit), and never runs on its own after a deploy' (
    $main -and $main.script -eq 'scripts/ops/Move-World.ps1' -and ($main.fixed -join ' ') -eq '-Server main -Yes -NoPause' -and $main.build -eq $true -and -not $main.PSObject.Properties['afterDeploy'])
$mw = [IO.File]::ReadAllText((P 'scripts/ops/Move-World.ps1'))
Yes 'a survey sends no stop and no hold' ($mw.Contains("`$(if (`$Survey) { '' } else { (Get-ThornswoodHoldScript -Script 'Move-World.ps1') + `$stopAndMove"))

# ---- the box step, built the way the script builds it ------------------------
. (P 'scripts/deploy/World.ps1')
. (P 'scripts/vps/ServerHold.ps1')
$from = $mw.IndexOf('$stopAndMove = [IO.File]')
$to = [regex]::Match($mw, "\r?\nWrite-Host ''\r?\nWrite-Host \(""  THORNSWOOD").Index
$build = [scriptblock]::Create("param(`$Here, `$Survey, `$root, `$task, `$Server, `$stamp, `$db, `$uriFile, `$ThornswoodWorld)`nfunction Q([string]`$s) { return `"'`" + (`$s -replace `"'`", `"''`") + `"'`" }`n" + $mw.Substring($from, $to - $from) + "`nreturn `$boxScript")

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-6237m-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $tmp
$node = (Get-Command node).Source
$pwsh = (Get-Process -Id $PID).Path
$gamePort = 7790
$resPort = 7791

# What stands in for the box's own: the task, the UDP list, the watchdog.
$stubs = @'
function Get-NetUDPEndpoint { if (Test-Path -LiteralPath $env:TW_UDP) { foreach ($p in @(Get-Content -LiteralPath $env:TW_UDP)) { [pscustomobject]@{ LocalPort = [int]$p; OwningProcess = 0 } } } }
function Stop-ScheduledTask { param($TaskName, $ErrorAction) Add-Content -LiteralPath $env:TW_TASKLOG ('stop ' + $TaskName); Remove-Item -LiteralPath $env:TW_UDP -EA SilentlyContinue }
function Start-ScheduledTask {
  param($TaskName, $ErrorAction)
  Add-Content -LiteralPath $env:TW_TASKLOG ('start ' + $TaskName)
  $s = [IO.File]::ReadAllText((Join-Path $Root 'server-settings.json')) | ConvertFrom-Json
  if ($s.databaseDriver -eq 'mongodb') {
    $n = [int]((Get-ThornswoodWorldCount @{ UriFile = $s.databaseUriFile; Db = $s.databaseName }) -split '\|')[1]
    if ($env:TW_LOAD_WRONG) { $n-- }
    Add-Content -LiteralPath (Join-Path $Root 'server.log') ('[' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff') + '] [info] MongoDB: loaded ' + $n + ' forms')
  }
  $p = Start-Process -FilePath $env:TW_NODE -ArgumentList '-e', ('"const res = require(''net'').createServer((s) => s.end()).listen(' + $env:TW_RES + ', ''127.0.0.1''); setTimeout(() => res.close(), 60000)"') -PassThru
  Add-Content -LiteralPath $env:TW_PIDS $p.Id
  Start-Sleep -Milliseconds 400
  Set-Content -LiteralPath $env:TW_UDP $env:TW_GAME
}
'@
# The engine's move, stood in for: the settings it was run with kept, an
# unfinished save finished first, the forms copied with world.js, and the
# engine's own last line.
$engine = @'
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const s = JSON.parse(fs.readFileSync('server-settings.json', 'utf8').replace(/^\uFEFF/, ''));
fs.writeFileSync('engine-saw.json', JSON.stringify(s));
if (s.databaseDriver !== 'migration') { console.log('[error] not a migration'); process.exitCode = 3; return; }
if (fs.existsSync('engine-fails')) { console.log('[error] MigrationDatabase: databaseNew does not match the old world: 1 missing (a01)'); process.exitCode = 1; return; }
const forms = path.join(s.databaseOld.databaseName, 'changeForms');
const batch = path.join(forms, '.pending-batch');
if (fs.existsSync(batch)) {
  for (const e of JSON.parse(fs.readFileSync(batch, 'utf8')).batch) fs.writeFileSync(path.join(forms, e.file), e.json);
  fs.unlinkSync(batch);
}
let from = forms;
if (fs.existsSync('engine-short')) {
  from = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-short-'));
  const names = fs.readdirSync(forms).filter((n) => /\.json$/.test(n) && n[0] !== '.');
  for (const n of names.slice(1)) fs.copyFileSync(path.join(forms, n), path.join(from, n));
}
const plan = path.join(os.tmpdir(), 'tw-engine-plan-' + process.pid + '.json');
fs.writeFileSync(plan, JSON.stringify({ op: 'apply', uri: s.databaseNew.databaseUriFile, db: s.databaseNew.databaseName, from, mode: 'replace' }));
const r = cp.spawnSync(process.env.THORNSWOOD_MONGOSH, ['--nodb', '--quiet', '--file', process.env.TW_WORLDJS], { encoding: 'utf8', env: Object.assign({}, process.env, { THORNSWOOD_WORLD_PLAN: plan }) });
fs.unlinkSync(plan);
const done = /APPLIED\|(\d+)/.exec(r.stdout || '');
if (!done) { console.log('[error] ' + r.stdout + r.stderr); process.exitCode = 1; return; }
console.log('[info] MigrationDatabase: ' + done[1] + ' changeForms moved, and each read back the same');
console.log('[info] The server will exit');
'@

function Stop-Fakes {
    if (Test-Path -LiteralPath (Join-Path $tmp 'pids')) {
        foreach ($p in @(Get-Content -LiteralPath (Join-Path $tmp 'pids'))) { Stop-Process -Id ([int]$p) -Force -EA SilentlyContinue }
        Remove-Item -LiteralPath (Join-Path $tmp 'pids') -Force
    }
    Remove-Item -LiteralPath (Join-Path $tmp 'udp') -Force -EA SilentlyContinue
}
# A stand-in server folder: dev's settings, a world in files, the engine.
function New-Root([string]$name, [string]$engineKnows = 'databaseUriFile') {
    $r = Join-Path $tmp $name
    $null = New-Item -ItemType Directory -Path (Join-Path $r 'world/changeForms') -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $r 'dist_back') -Force
    [IO.File]::WriteAllText((Join-Path $r 'server-settings.json'), ('{' + "`n" + '  "thornswoodServer": "dev",' + "`n" + '  "port": ' + $gamePort + ',' + "`n" + '  "name": "Thornswood Dev",' + "`n" + '  "damageMult": 1.5,' + "`n" + '  "npcSettings": { "default": { "spawnInInterior": true, "list": [ 1, 2 ] } }' + "`n" + '}' + "`n"))
    [IO.File]::WriteAllText((Join-Path $r 'scam_native.node'), ("`0`0binary " + $engineKnows + " `0"))
    [IO.File]::WriteAllText((Join-Path $r 'dist_back/skymp5-server.js'), $engine)
    $f = Join-Path $r 'world/changeForms'
    [IO.File]::WriteAllText((Join-Path $f 'a01.json'), '{"formDesc":"a01","profileId":5001,"recType":1,"isDeleted":false,"angle":{"x":0.0,"y":0.0,"z":90.5}}')
    [IO.File]::WriteAllText((Join-Path $f 'a02.json'), '{"formDesc":"a02","profileId":5002,"recType":1,"isDeleted":false}')
    [IO.File]::WriteAllText((Join-Path $f '3eb15_Skyrim.esm.json'), '{"formDesc":"3eb15:Skyrim.esm","profileId":-1,"recType":1,"isDeleted":false}')
    return $r
}
function Run-Box([string]$root, [bool]$survey, [string]$uriFile, [string]$db = 'thornswood-wtestm') {
    $box = & $build (P "scripts/ops") $survey $root 'Thornswood Dev Server' 'dev' '20261116-120000' $db $uriFile $ThornswoodWorld
    $box = $box.Replace("`$ThornswoodHoldRoot = 'C:\Thornswood-Watch'", "`$ThornswoodHoldRoot = '" + (Join-Path $tmp 'watch') + "'")
    $box = $box.Replace('$wait = Get-ThornswoodServerReadyWait', '$wait = 20')
    $file = Join-Path $tmp 'box.ps1'
    [IO.File]::WriteAllText($file, $stubs + "`n" + $box)
    $out = @(& $pwsh -NoProfile -File $file 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    Stop-Fakes
    return @{ Out = $out; Code = $code }
}
# The first line with that tag, or nothing.
function Line($r, [string]$tag) { return ($r.Out | Where-Object { $_ -like ($tag + '|*') } | Select-Object -First 1) }
function Tasks { $f = Join-Path $tmp 'tasks.log'; if (Test-Path -LiteralPath $f) { $t = @(Get-Content -LiteralPath $f); Remove-Item -LiteralPath $f; return ($t -join ',') }; return '' }

$env:TW_UDP = Join-Path $tmp 'udp'
$env:TW_TASKLOG = Join-Path $tmp 'tasks.log'
$env:TW_PIDS = Join-Path $tmp 'pids'
$env:TW_NODE = $node
$env:TW_RES = [string]$resPort
$env:TW_GAME = [string]$gamePort
$env:TW_WORLDJS = P 'scripts/vps/world.js'
$null = New-Item -ItemType Directory -Path (Join-Path $tmp 'watch/holds') -Force

try {
    # Exercise the actual restart check with a loopback listener and a fixed
    # clock. No task or database is needed to check the log's freshness.
    $startAt = $mw.IndexOf('# Starts the task and waits for both ports;')
    $startEnd = $mw.IndexOf('# Back to its files:', $startAt)
    $startScript = [scriptblock]::Create($mw.Substring($startAt, $startEnd - $startAt))
    & {
        . $startScript
        $Root = New-Root 'log-clock'
        $Task = 'Fixture only'
        $Db = 'fixture'
        $port = 0
        $log = Join-Path $Root 'server.log'
        $fixtureNow = [DateTime]::new(2026, 11, 25, 12, 0, 0, [DateTimeKind]::Utc).ToLocalTime()
        $inv = [Globalization.CultureInfo]::InvariantCulture
        function Get-Date { return $fixtureNow }
        function Get-PortPids { return 1 }
        function Start-ScheduledTask { param($TaskName, $ErrorAction) }
        function Clear-ThornswoodHold { param($Target) }
        function Get-ThornswoodServerReadyWait { return -1 }
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        try {
            $listener.Start()
            $resPort = $listener.LocalEndpoint.Port
            $expected = 'LOADED|4|0|' + $resPort
            $utc = $fixtureNow.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $inv)
            $legacy = $fixtureNow.ToString('yyyy-MM-dd HH:mm:ss.fff', $inv)
            $staleUtc = $fixtureNow.ToUniversalTime().AddSeconds(-2).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $inv)
            $staleLegacy = $fixtureNow.AddSeconds(-2).ToString('yyyy-MM-dd HH:mm:ss.fff', $inv)
            [IO.File]::WriteAllLines($log, @("[$utc] [info] MongoDB: loaded 4 forms"))
            Yes 'restart sees the new UTC receipt stamp and proves the loaded count' ((Start-AndWait 4) -eq $expected)
            [IO.File]::WriteAllLines($log, @("[$legacy] [info] MongoDB: loaded 4 forms"))
            Yes 'restart still sees a fresh legacy local MongoDB load' ((Start-AndWait 4) -eq $expected)
            [IO.File]::WriteAllLines($log, @("[$staleUtc] [info] MongoDB: loaded 4 forms", "[$staleLegacy] [info] MongoDB: loaded 4 forms",
                '[2026-02-31T12:00:00.000Z] [info] MongoDB: loaded 4 forms', '[2026-02-31 12:00:00.000] [info] MongoDB: loaded 4 forms'))
            Yes 'both stale clock formats and invalid timestamps cannot prove this restart loaded' ((Start-AndWait 4) -like 'NOTLOADED|*')
        } finally { $listener.Stop() }
    }

    # ---- a folder that is another server's ----------------------------------
    $other = New-Root 'other'
    $text = [IO.File]::ReadAllText((Join-Path $other 'server-settings.json'))
    [IO.File]::WriteAllText((Join-Path $other 'server-settings.json'), $text.Replace('"dev"', '"main"'))
    $r = Run-Box $other $false (Join-Path $tmp 'none.uri')
    Yes 'a folder whose settings name another server is refused, with nothing touched' ($r.Code -eq 1 -and (Line $r 'STOP') -match 'not dev' -and -not (Tasks))

    $shell = $env:THORNSWOOD_TEST_MONGOSH
    $uri = $env:THORNSWOOD_TEST_MONGO_URI
    if (-not $shell -or -not $uri -or -not (Test-Path -LiteralPath $shell)) {
        Write-Host 'SKIP  the move against a MongoDB: set THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI'
    } else {
        $env:THORNSWOOD_MONGOSH = $shell
        $db = 'thornswood-wtestm'
        $dbUri = $uri -replace '/\?', ('/' + $db + '?')
        function Mongo([string]$js) { return (& $shell --quiet $dbUri --eval $js 2>&1 | ForEach-Object { "$_" }) -join "`n" }
        $uriFile = Join-Path $tmp 'dev.uri'
        [IO.File]::WriteAllText($uriFile, $uri)
        $null = Mongo 'db.dropDatabase()'

        # ---- a survey
        $root = New-Root 'survey'
        $before = [IO.File]::ReadAllText((Join-Path $root 'server-settings.json'))
        $r = Run-Box $root $true $uriFile
        Yes 'a survey says it would put the 3 forms into the database' ($r.Code -eq 0 -and (Line $r 'SURVEY') -eq ('SURVEY|3|' + $db) -and (Line $r 'COUNT') -eq 'COUNT|0|0')
        Yes 'and changes nothing: no stop, no start, the settings and the world as they were' (-not (Tasks) -and [IO.File]::ReadAllText((Join-Path $root 'server-settings.json')) -eq $before -and (Test-Path -LiteralPath (Join-Path $root 'world/changeForms/a01.json')) -and (Mongo 'print(db.changeForms.countDocuments({}))') -eq '0')

        # ---- refusals before anything stops
        $r = Run-Box $root $false (Join-Path $tmp 'none.uri')
        Yes 'a connection file that is not there is refused, nothing stopped' ($r.Code -eq 1 -and (Line $r 'STOP') -match 'none\.uri is not there' -and -not (Tasks))
        $old = New-Root 'old-engine' 'something else'
        $r = Run-Box $old $false $uriFile
        Yes 'an engine from before PR #161 is refused, nothing stopped' ($r.Code -eq 1 -and (Line $r 'STOP') -match 'before PR #161' -and -not (Tasks))
        $null = Mongo 'db.changeForms.insertOne({ formDesc: "zz", profileId: 9 })'
        $r = Run-Box $root $false $uriFile
        Yes 'a database that already holds forms is refused, nothing stopped' ($r.Code -eq 1 -and (Line $r 'STOP') -match 'already holds 1 forms' -and -not (Tasks))
        $null = Mongo 'db.dropDatabase()'

        # ---- an engine that fails
        $failing = New-Root 'failing'
        $before = [IO.File]::ReadAllText((Join-Path $failing 'server-settings.json'))
        [IO.File]::WriteAllText((Join-Path $failing 'engine-fails'), '')
        $r = Run-Box $failing $false $uriFile
        Yes 'an engine that fails is said with its own line' ($r.Code -eq 1 -and @($r.Out | Where-Object { $_ -match '^ENGINE\|.*does not match the old world' }).Count -eq 1 -and (Line $r 'STOP') -match 'did not move the world')
        Yes 'and the server is started again on its own settings, byte for byte, with its world where it was' (
            (Tasks) -eq 'stop Thornswood Dev Server,start Thornswood Dev Server' -and (Line $r 'ANSWERED').Count -eq 1 -and
            [IO.File]::ReadAllText((Join-Path $failing 'server-settings.json')) -eq $before -and (Test-Path -LiteralPath (Join-Path $failing 'world/changeForms/a01.json')) -and
            -not (Test-Path -LiteralPath (Join-Path $failing 'server-settings.json.before-move-20261116-120000')))
        Yes 'and the hold is taken away' (@(Get-ChildItem -LiteralPath (Join-Path $tmp 'watch/holds') -File).Count -eq 0)
        $null = Mongo 'db.dropDatabase()'

        # ---- a database that does not hold what the folder holds
        $short = New-Root 'short'
        $before = [IO.File]::ReadAllText((Join-Path $short 'server-settings.json'))
        [IO.File]::WriteAllText((Join-Path $short 'engine-short'), '')
        $r = Run-Box $short $false $uriFile
        Yes 'a database that holds fewer forms than the folder is refused, and the server goes back to its files' (
            $r.Code -eq 1 -and (Line $r 'STOP') -match 'does not hold the 3 forms' -and [IO.File]::ReadAllText((Join-Path $short 'server-settings.json')) -eq $before -and
            (Test-Path -LiteralPath (Join-Path $short 'world/changeForms/a01.json')) -and (Tasks) -eq 'stop Thornswood Dev Server,start Thornswood Dev Server')
        $null = Mongo 'db.dropDatabase()'

        # ---- the move, with an unfinished save
        $root = New-Root 'moving'
        $pending = @{ version = 1; batch = @(@{ file = 'a03.json'; json = '{"formDesc":"a03","profileId":5003,"recType":1,"isDeleted":false}' }) } | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText((Join-Path $root 'world/changeForms/.pending-batch'), $pending)
        $r = Run-Box $root $false $uriFile
        Yes 'a move says the unfinished save, and finishes with 0' ($r.Code -eq 0 -and (Line $r 'PENDING').Count -eq 1)
        $saw = [IO.File]::ReadAllText((Join-Path $root 'engine-saw.json')) | ConvertFrom-Json
        Yes 'the engine ran with the migration: the file world as old, the server''s database and connection file as new' (
            $saw.databaseDriver -eq 'migration' -and $saw.databaseOld.databaseDriver -eq 'file' -and $saw.databaseOld.databaseName -eq 'world' -and
            $saw.databaseNew.databaseDriver -eq 'mongodb' -and $saw.databaseNew.databaseName -eq $db -and $saw.databaseNew.databaseUriFile -eq $uriFile -and $saw.port -eq $gamePort)
        Yes 'the database holds every form, the unfinished save''s too' ((Mongo 'print(db.changeForms.countDocuments({}))') -eq '4' -and (Line $r 'MOVED') -like ('MOVED|' + $db + '|4|*'))
        Yes 'and keeps a double a double' ((Mongo 'print(db.changeForms.findOne({ formDesc: "a01" }).angle.z)') -eq '90.5' -and (Mongo 'print(typeof db.changeForms.findOne({ formDesc: "a01" }, {}, { promoteValues: false }).angle.x)') -eq 'object')
        $now = [IO.File]::ReadAllText((Join-Path $root 'server-settings.json')) | ConvertFrom-Json
        Yes 'the settings say MongoDB, the server''s database and its connection file' ($now.databaseDriver -eq 'mongodb' -and $now.databaseName -eq $db -and $now.databaseUriFile -eq $uriFile)
        Yes 'and every other setting is kept' ($now.thornswoodServer -eq 'dev' -and $now.port -eq $gamePort -and $now.name -eq 'Thornswood Dev' -and $now.damageMult -eq 1.5 -and
            $now.npcSettings.default.spawnInInterior -eq $true -and (@($now.npcSettings.default.list) -join ',') -eq '1,2' -and -not $now.PSObject.Properties['databaseOld'])
        Yes 'the world folder is set aside as world-before-<stamp>, which server-log.js ages out' (
            -not (Test-Path -LiteralPath (Join-Path $root 'world')) -and (Test-Path -LiteralPath (Join-Path $root 'world-before-20261116-120000/changeForms/a03.json')) -and
            -not (Test-Path -LiteralPath (Join-Path $root 'server-settings.json.before-move-20261116-120000')))
        Yes 'the server is started and loads every form from MongoDB' ((Tasks) -eq 'stop Thornswood Dev Server,start Thornswood Dev Server' -and (Line $r 'LOADED') -eq ('LOADED|4|' + $gamePort + '|' + $resPort))
        Yes 'and the hold is taken away' (@(Get-ChildItem -LiteralPath (Join-Path $tmp 'watch/holds') -File).Count -eq 0)
        Yes 'the world tools read it there now' ((Get-ThornswoodWorld $root).Driver -eq 'mongodb' -and (Get-ThornswoodWorld $root).Db -eq $db)

        # ---- once more
        $r = Run-Box $root $false $uriFile
        Yes 'a second run says the world is already there, and stops nothing' ($r.Code -eq 0 -and (Line $r 'ALREADY') -eq ('ALREADY|' + $db) -and (Line $r 'COUNT') -eq 'COUNT|4|3' -and -not (Tasks))
        $null = Mongo 'db.dropDatabase()'

        # ---- a server that loads fewer forms than the database holds
        $wrong = New-Root 'wrong'
        $env:TW_LOAD_WRONG = '1'
        $r = Run-Box $wrong $false $uriFile
        Remove-Item Env:TW_LOAD_WRONG
        Yes 'a server that loads fewer forms than the database holds is said, and the run fails' ($r.Code -eq 1 -and (Line $r 'NOTLOADED') -match 'loaded 2 forms .* holds 3')
        $null = Mongo 'db.dropDatabase()'
    }
} finally {
    Stop-Fakes
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
