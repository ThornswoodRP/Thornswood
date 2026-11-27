<#
  test-6237-world.ps1

  A game server's world in MongoDB, read out to a folder and written back
  (#6237): scripts\deploy\World.ps1 and scripts\vps\world.js.

  HOW. Two parts.
    1. Always: World.ps1 parses, its text for the box parses on its own and
       carries world.js whole, a file-driver server's world is its folder as
       before, a settings file naming MongoDB without a database or a
       connection file is refused, and world.js reads its plan from its
       environment and prints no connection string.
    2. With a MongoDB to try it on (THORNSWOOD_TEST_MONGOSH, the mongosh to
       run, and THORNSWOOD_TEST_MONGO_URI, a mongod that takes writes to
       databases named thornswood-wtest*), against a world of three forms:
       Open reads every form out the way the file driver lays them out, with
       each number's type kept (100.0 stays a double, a form id an int64);
       Save writes back a changed form, adds a new one and takes out one
       moved to _discarded, and run again does nothing more; a form the
       server wrote meanwhile stops Save with nothing written; a restore
       makes a new database hold exactly the folder, with the engine's two
       indexes; a file that is not a form, or not named by its own formDesc,
       stops a restore with nothing written. Without one these print SKIP.
  Any platform. A few seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }

# ---- 1. always ------------------------------------------------------------
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts/deploy/World.ps1'), [ref]$null, [ref]$errs)
Yes 'World.ps1 parses' (-not ($errs -and $errs.Count))
. (Join-Path $Repo 'scripts/deploy/World.ps1')
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($ThornswoodWorld, [ref]$null, [ref]$errs)
Yes 'the text a tool sends to the box parses on its own' (-not ($errs -and $errs.Count))
$js = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/vps/world.js'))
Yes 'the text a tool sends to the box carries world.js whole' ($ThornswoodWorld.Contains($js))

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-6237w-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $w = Get-ThornswoodWorld $scratch
    Yes 'a server with no settings keeps its world in world\changeForms' ($w.Driver -eq 'file' -and $w.Forms -eq (Join-Path (Join-Path $scratch 'world') 'changeForms'))
    [IO.File]::WriteAllText((Join-Path $scratch 'server-settings.json'), '{"databaseDriver":"file","databaseName":"other"}')
    $w = Open-ThornswoodWorld $scratch 'x'
    Yes 'a file-driver server''s world is its own folder, opened in place' ($w.Driver -eq 'file' -and $w.Forms -eq (Join-Path (Join-Path $scratch 'other') 'changeForms'))
    Yes 'saving a file-driver world has nothing to write' ((Save-ThornswoodWorld $w) -eq 'WORLDSAVED|file|0|0|0|0')
    [IO.File]::WriteAllText((Join-Path $scratch 'server-settings.json'), '{"databaseDriver":"mongodb","databaseName":"thornswood-live"}')
    Yes 'a MongoDB server with no connection file is refused' ((Open-ThornswoodWorld $scratch 'x').Stop -match 'databaseUriFile')
    [IO.File]::WriteAllText((Join-Path $scratch 'server-settings.json'), '{"databaseDriver":"mongodb","databaseName":"admin","databaseUriFile":"x"}')
    Yes 'a MongoDB server whose database is not thornswood-<name> is refused' ((Open-ThornswoodWorld $scratch 'x').Stop -match 'no world database')
    [IO.File]::WriteAllText((Join-Path $scratch 'server-settings.json'), '{not json')
    Yes 'settings that will not read are refused, not guessed' ((Open-ThornswoodWorld $scratch 'x').Stop -match 'will not read')
} finally { Remove-Item -LiteralPath $scratch -Recurse -Force -EA SilentlyContinue }

$prints = @([regex]::Matches($js, 'print\([^;]*\);') | ForEach-Object { $_.Value })
Yes 'world.js prints no connection string' ($prints.Count -gt 0 -and @($prints | Where-Object { $_ -match '\btext\b|\.uri\b|password' }).Count -eq 0)
Yes 'world.js reads its plan from its environment, not its command line' ($js.Contains('process.env.THORNSWOOD_WORLD_PLAN') -and $ThornswoodWorld.Contains('--nodb --quiet --file $js'))

# ---- 2. with a MongoDB ----------------------------------------------------
$shell = $env:THORNSWOOD_TEST_MONGOSH
$uri = $env:THORNSWOOD_TEST_MONGO_URI
if (-not $shell -or -not $uri -or -not (Test-Path -LiteralPath $shell)) {
    Skip 'reading a world out of MongoDB and writing it back: set THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI'
} else {
    $ThornswoodMongoShell = $shell
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-6237w-' + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $scratch | Out-Null
    $uriFile = Join-Path $scratch 'test.uri'
    [IO.File]::WriteAllText($uriFile, $uri)
    function Shell([string]$db, [string]$eval) { return @(& $shell --quiet ($uri.TrimEnd('/') -replace '/\?', ('/' + $db + '?')) --eval $eval 2>&1 | ForEach-Object { "$_" }) }
    function Settings([string]$db) { [IO.File]::WriteAllText((Join-Path $scratch 'server-settings.json'), (@{ databaseDriver = 'mongodb'; databaseName = $db; databaseUriFile = $uriFile } | ConvertTo-Json)) }
    try {
        $db = 'thornswood-wtest'
        $null = Shell $db @'
db.dropDatabase();
db.changeForms.insertMany([
  { formDesc: "14", profileId: Int32(42), position: [Double(100), Double(1.5), Double(-3)], inv: { entries: [ { baseId: "f:Skyrim.esm", count: Int32(300) }, { baseId: Long("4278190090"), count: Int32(1) } ] }, isDeleted: false, recType: Int32(1) },
  { formDesc: "3eb15:Sword_Plus.esp", profileId: Int32(-1), recType: Int32(2) },
  { formDesc: "1f", profileId: Int32(7), isDeleted: true, recType: Int32(1) }
]);
'@
        Settings $db
        $w = Open-ThornswoodWorld $scratch 'one'
        Yes 'Open reads every form out' (-not $w.Stop -and $w.Exported -eq 3)
        $names = @(Get-ChildItem -LiteralPath $w.Forms -File | ForEach-Object Name | Sort-Object)
        Yes 'each form is kept as the file driver names it' (($names -join ',') -eq '14.json,1f.json,3eb15_Sword_Plus.esp.json')
        $t = [IO.File]::ReadAllText((Join-Path $w.Forms '14.json'))
        Yes 'a double keeps its point and a form id stays whole' ($t.Contains('"position":[100.0,1.5,-3.0]') -and $t.Contains('"baseId":4278190090') -and $t.Contains('"baseId":"f:Skyrim.esm"'))
        Yes 'a second Open of the same stamp is refused' ([bool](Open-ThornswoodWorld $scratch 'one').Stop)

        [IO.File]::WriteAllText((Join-Path $w.Forms '14.json'), $t.Replace('"count":300', '"count":299'))
        $aside = Join-Path $w.Forms '_discarded-one'
        New-Item -ItemType Directory -Path $aside | Out-Null
        Move-Item -LiteralPath (Join-Path $w.Forms '1f.json') -Destination $aside
        [IO.File]::WriteAllText((Join-Path $w.Forms '20.json'), '{"formDesc":"20","profileId":5,"recType":1,"position":[1.0,2,3]}')
        $saved = Save-ThornswoodWorld $w
        Yes ('Save writes the changed and the new form and takes out the one moved away: ' + $saved) ($saved -eq 'WORLDSAVED|mongodb|2|1|1|3')
        $types = Shell $db 'print(db.changeForms.countDocuments({ formDesc: "14", "inv.entries.0.count": 299, "position.0": { $type: "double" }, "inv.entries.1.baseId": { $type: "long" } }), db.changeForms.countDocuments({ formDesc: "20", "position.0": { $type: "double" }, "position.1": { $type: "int" } }), db.changeForms.countDocuments({ formDesc: "1f" }))'
        Yes ('what was written keeps each number''s type: ' + ($types -join ' ')) (($types -join ' ').Trim() -eq '1 1 0')
        Yes 'the form moved away is still on disk' (Test-Path -LiteralPath (Join-Path $aside '1f.json'))
        $left = @(Get-ChildItem -LiteralPath $w.Forms -Recurse -File | ForEach-Object { $_.FullName.Substring($w.Forms.Length + 1) -replace '\\', '/' })
        Yes ('once written, the copy read out goes and only what was set aside stays: ' + ($left -join ',')) (($left -join ',') -eq '_discarded-one/1f.json' -and -not (Test-Path -LiteralPath $w.Manifest))

        # A Save cut off part way is finished by the same Save again; a form
        # the server wrote meanwhile stops it.
        $w = Open-ThornswoodWorld $scratch 'two'
        $t = [IO.File]::ReadAllText((Join-Path $w.Forms '14.json'))
        [IO.File]::WriteAllText((Join-Path $w.Forms '14.json'), $t.Replace('"count":299', '"count":298'))
        $null = Shell $db 'db.changeForms.updateOne({ formDesc: "14" }, { $set: { "inv.entries.0.count": Int32(298) } })'
        $again = Save-ThornswoodWorld $w
        Yes ('Save of a change already in the database finishes and changes nothing more: ' + $again) ($again -eq 'WORLDSAVED|mongodb|1|0|0|3')
        $w = Open-ThornswoodWorld $scratch 'three'
        $t = [IO.File]::ReadAllText((Join-Path $w.Forms '14.json'))
        [IO.File]::WriteAllText((Join-Path $w.Forms '14.json'), $t.Replace('"count":298', '"count":297'))
        $null = Shell $db 'db.changeForms.updateOne({ formDesc: "14" }, { $set: { profileId: 44 } })'
        $stop = Save-ThornswoodWorld $w
        Yes 'a form the server wrote meanwhile stops Save' ($stop -like 'STOP|*' -and $stop -match '14 changed in the database')
        $kept = Shell $db 'print(db.changeForms.findOne({ formDesc: "14" }).profileId)'
        Yes 'and nothing was written over it' (($kept -join '').Trim() -eq '44')
        Yes 'and the folder is left to be saved again' ((Test-Path -LiteralPath (Join-Path $w.Forms '14.json')) -and (Test-Path -LiteralPath $w.Manifest))

        $db2 = 'thornswood-wtestb'
        $null = Shell $db2 'db.dropDatabase(); db.changeForms.insertOne({ formDesc: "99", profileId: 1 })'
        Settings $db2
        $r = Restore-ThornswoodWorld (Get-ThornswoodWorld $scratch) $w.Forms
        Yes ('a restore makes the database hold exactly the folder: ' + $r) ($r -eq 'WORLDSAVED|mongodb|3|0|1|3')
        $ix = Shell $db2 'print(db.changeForms.getIndexes().filter(i => (i.name === "formDesc_unique" && i.unique) || i.name === "profileId").length)'
        Yes 'with the engine''s two indexes' (($ix -join '').Trim() -eq '2')
        Yes 'and the count says its forms and characters' ((Get-ThornswoodWorldCount (Get-ThornswoodWorld $scratch)) -eq 'COUNT|3|2')
        $bad = Join-Path $w.Forms '21.json'
        [IO.File]::WriteAllText($bad, '{not a form')
        $r = Restore-ThornswoodWorld (Get-ThornswoodWorld $scratch) $w.Forms
        Yes 'a file that is not a form stops a restore' ($r -like 'STOP|*' -and $r -match 'does not read as a form')
        [IO.File]::WriteAllText($bad, '{"formDesc":"22"}')
        $r = Restore-ThornswoodWorld (Get-ThornswoodWorld $scratch) $w.Forms
        Yes 'a file not named by its own formDesc stops a restore' ($r -like 'STOP|*' -and $r -match 'whose file is 22.json')
        Yes 'with nothing written' ((Get-ThornswoodWorldCount (Get-ThornswoodWorld $scratch)) -eq 'COUNT|3|2')

        # ---- the tools, on a world in MongoDB ----
        $env:THORNSWOOD_MONGOSH = $shell
        $box = (Get-Command pwsh).Source
        function Lift([string]$file, [string]$name) {
            $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $file), [ref]$null, [ref]$null)
            $a = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -eq $name }, $true))
            if ($a.Count -ne 1) { return $null }
            return (& ([scriptblock]::Create($a[0].Right.Extent.Text)))
        }
        function RunBody([string]$body, [string[]]$arg) {
            $f = Join-Path $scratch ('body-' + [guid]::NewGuid().ToString('n') + '.ps1')
            [IO.File]::WriteAllText($f, $body)
            $out = @(& $box -NoProfile -NonInteractive -File $f @arg 2>&1 | ForEach-Object { "$_" })
            return @{ Code = $LASTEXITCODE; Out = $out }
        }
        . (Join-Path $Repo 'scripts/ops/Release-List.ps1')
        $db = 'thornswood-wtestc'
        $null = Shell $db 'db.dropDatabase(); db.changeForms.insertMany([{ formDesc: "a01", profileId: 5001, recType: 1, appearanceDump: { name: "A" } }, { formDesc: "13164:Skyrim.esm", profileId: -1, recType: 1 }, { formDesc: "a02", profileId: -1, recType: 1 }])'
        Settings $db
        $reset = Lift 'scripts/ops/Reset-Character.ps1' '$body'
        $r = RunBody $reset @('-Root', $scratch, '-Character', 'ff000a01')
        $left = (Shell $db 'print(db.changeForms.find().sort({ formDesc: 1 }).toArray().map(d => d.formDesc).join(","))') -join ''
        Yes ('Reset-Character takes the character out of a MongoDB world and leaves the world''s own forms: ' + $left) ($r.Code -eq 0 -and $left.Trim() -eq '13164:Skyrim.esm,a02')
        $aside = @(Get-ChildItem -LiteralPath $scratch -Recurse -File -Filter 'a01.json' | Where-Object { $_.FullName -match '[\/]world-mongo-[0-9-]+[\/]changeForms[\/]_discarded-' })
        Yes 'and keeps it on disk in world-mongo-<stamp>\changeForms\_discarded-<stamp>' ($aside.Count -eq 1)
        $list = Join-Path $scratch 'private/deleted-characters.json'
        Yes 'and names it on the release list by its runtime form id' ((Test-Path -LiteralPath $list) -and ([IO.File]::ReadAllText($list) -match '"actors":\[4278192641\]'))

        . (Join-Path $Repo 'scripts/ops/NpcReset.ps1')
        . ([scriptblock]::Create($ThornswoodNpcReset))
        $db = 'thornswood-wtestd'
        $null = Shell $db 'db.dropDatabase(); db.changeForms.insertMany([{ formDesc: "a01", profileId: 5, recType: 1 }, { formDesc: "12345:Skyrim.esm", profileId: -1, recType: 1 }, { formDesc: "b00", profileId: -1, recType: 0 }])'
        Settings $db
        $survey = @(Invoke-ThornswoodNpcReset -Root $scratch -Stamp '20261116-020000')
        Yes ('Reset-Npcs surveys a MongoDB world: ' + ($survey -join ' / ')) (($survey -contains 'NPCRESET|1|1|1|0') -and -not (Test-Path -LiteralPath (Join-Path $scratch 'world-mongo-20261116-020000')))
        $move = @(Invoke-ThornswoodNpcReset -Root $scratch -Stamp '20261116-020001' -Move)
        $left = (Shell $db 'print(db.changeForms.find().sort({ formDesc: 1 }).toArray().map(d => d.formDesc).join(","))') -join ''
        Yes ('and moves its NPCs out of it, keeping the character and the chest: ' + $left) (-not @($move | Where-Object { $_ -like 'STOP|*' -or $_ -like 'FAILED|*' }).Count -and $left.Trim() -eq 'a01,b00')
        Yes 'with the NPC kept on disk' (Test-Path -LiteralPath (Join-Path $scratch 'world-mongo-20261116-020001/changeForms/_discarded-20261116-020001/12345_Skyrim.esm.json'))

        # Wipe-Saves' move, as it is sent to the box, on a MongoDB world.
        $wipe = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/ops/Wipe-Saves.ps1')).Replace("`r`n", "`n")
        $at = $wipe.IndexOf("Head 'Moving the old storage aside'")
        $open = $wipe.IndexOf('Remote @"', $at); $start = $wipe.IndexOf("`n", $open) + 1; $end = $wipe.IndexOf("`n" + '"@', $start)
        $db = 'thornswood-wteste'
        $null = Shell $db 'db.dropDatabase(); db.changeForms.insertMany([{ formDesc: "a01", profileId: 5001, recType: 1 }, { formDesc: "13164:Skyrim.esm", profileId: -1, recType: 0 }])'
        Settings $db
        $rootsLit = "'" + $scratch + "'"; $movesLit = "'world','private\characters.json'"; $wipeDoneLit = "'farms'"; $stamp = '20261116-0300'
        Remove-Item -LiteralPath (Join-Path $scratch 'private') -Recurse -Force -EA SilentlyContinue
        $moveText = $ExecutionContext.InvokeCommand.ExpandString($wipe.Substring($start, $end - $start))
        $r = RunBody $moveText @()
        $left = (Shell $db 'print(db.changeForms.countDocuments({}))') -join ''
        $before = Join-Path $scratch 'world-before-20261116-0300/changeForms'
        Yes ('Wipe-Saves empties a MongoDB world: ' + (($r.Out | Where-Object { $_ -match '^(moved|FAILED|RELEASE)' }) -join ' / ')) ($left.Trim() -eq '0' -and -not @($r.Out | Where-Object { $_ -like 'FAILED*' }).Count)
        Yes 'into world-before-<stamp>\changeForms, one file per form, as a file world is set aside' ((Test-Path -LiteralPath (Join-Path $before 'a01.json')) -and (Test-Path -LiteralPath (Join-Path $before '13164_Skyrim.esm.json')) -and -not (Test-Path -LiteralPath (Join-Path $scratch 'world-mongo-20261116-0300')))
        Yes 'and names its character on the release list' (@($r.Out | Where-Object { $_ -like 'RELEASE|*|0|1|*' }).Count -eq 1)

        # The nightly backup's TakeWorld, lifted, on a MongoDB world.
        $bk = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts/vps/vps-nightly-backup.ps1'), [ref]$null, [ref]$null)
        $tw = @($bk.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'TakeWorld' }, $true))
        $db = 'thornswood-wtestf'
        $null = Shell $db 'db.dropDatabase(); db.changeForms.insertMany([{ formDesc: "a01", profileId: 5001, recType: 1, position: [Double(1), Double(2.5), Double(3)] }, { formDesc: "13164:Skyrim.esm", profileId: -1, recType: 0 }])'
        Settings $db
        $stage = Join-Path $scratch 'stage'; $ownedStage = $scratch; $MongoUri = $uriFile
        $notes = New-Object System.Collections.ArrayList
        function Note($m) { [void]$notes.Add([string]$m) }
        $took = 0; $worldsNotTaken = @()
        . ([scriptblock]::Create($tw[0].Extent.Text))
        TakeWorld $scratch 'game/world'
        $got = @(Get-ChildItem -LiteralPath (Join-Path $stage 'game/world/changeForms') -File -EA SilentlyContinue | ForEach-Object Name | Sort-Object)
        Yes ('the nightly backup reads a MongoDB world out into game\world\changeForms with the backup''s file: ' + ($notes -join ' / ')) (($got -join ',') -eq '13164_Skyrim.esm.json,a01.json' -and $took -eq 2 -and -not $worldsNotTaken.Count)
        Yes 'one file per form, each number''s type kept' ([IO.File]::ReadAllText((Join-Path $stage 'game/world/changeForms/a01.json')).Contains('"position":[1.0,2.5,3.0]'))
        $MongoUri = Join-Path $scratch 'none.uri'
        TakeWorld $scratch 'game-dev/world'
        Yes 'a world it could not read out is said and counted, for the run to end non-zero' ($worldsNotTaken -contains 'game-dev/world' -and @($notes | Where-Object { $_ -like '*WORLD NOT TAKEN game-dev/world*' }).Count -eq 1)
        $inst = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/deploy/Install-Backup.ps1'))
        Yes 'Install-Backup sends the world functions beside the backup as world.ps1' ($inst.Contains('$ThornswoodWorld, (New-Object Text.UTF8Encoding $true)') -and $inst.Contains('/world.ps1"'))

        # Restore-Server.ps1, whole, into a folder whose settings say
        # MongoDB, with a stand-in Restore-Backup.ps1 that lays out a backup
        # the way the real one unpacks it.
        $tree = Join-Path $scratch 'tree'
        foreach ($d in 'scripts/vps', 'scripts/deploy', 'records') { New-Item -ItemType Directory -Path (Join-Path $tree $d) -Force | Out-Null }
        foreach ($f in 'scripts/vps/Restore-Server.ps1', 'scripts/vps/world.js', 'scripts/deploy/World.ps1', 'scripts/deploy/Mongo.ps1', 'records/mongodb.json') { Copy-Item -LiteralPath (Join-Path $Repo $f) -Destination (Join-Path $tree $f) }
        $bk = Join-Path $scratch 'unpacked'
        foreach ($f in @{ 'a01.json' = '{"formDesc":"a01","profileId":5001,"recType":1,"isDeleted":false,"inv":{"entries":[{"baseId":"f:Skyrim.esm","count":5}]}}'; '13164_Skyrim.esm.json' = '{"formDesc":"13164:Skyrim.esm","profileId":-1,"recType":0}' }.GetEnumerator()) {
            $to = Join-Path $bk ('game/world/changeForms/' + $f.Key); New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null; [IO.File]::WriteAllText($to, $f.Value)
        }
        New-Item -ItemType Directory -Path (Join-Path $bk 'game/private') -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $bk 'game/private/characters.json'), '{"who":{}}')
        [IO.File]::WriteAllText((Join-Path $tree 'scripts/vps/Restore-Backup.ps1'), "param([string]`$Backup, [string]`$To, [string]`$KeyFile, [string]`$Work, [switch]`$NoPause)`nCopy-Item -LiteralPath '$bk' -Destination `$To -Recurse`nexit 0`n")
        $rroot = Join-Path $scratch 'restore-root'
        New-Item -ItemType Directory -Path (Join-Path $rroot 'plugins') -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $rroot 'plugins/Skyrim.esm'), 'TES4')
        $db = 'thornswood-wtestg'
        [IO.File]::WriteAllText((Join-Path $rroot 'server-settings.json'), (@{ port = 7777; loadOrder = @(($rroot -replace '\\', '/') + '/plugins/Skyrim.esm'); databaseDriver = 'mongodb'; databaseName = $db; databaseUriFile = $uriFile } | ConvertTo-Json))
        $null = Shell $db 'db.dropDatabase(); db.changeForms.insertMany([{ formDesc: "b07", profileId: 9, recType: 1 }])'
        $out = @(& $box -NoProfile -NonInteractive -File (Join-Path $tree 'scripts/vps/Restore-Server.ps1') -Backup 'x.zip.enc' -Root $rroot -Expect 5001 -Work (Join-Path $scratch 'work') -NoPause 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
        $held = (Shell $db 'print(db.changeForms.find().sort({ formDesc: 1 }).toArray().map(d => d.formDesc + "=" + (d.inv ? d.inv.entries[0].baseId : "")).join(","))') -join ''
        Yes ('Restore-Server puts a backup''s world into the server''s MongoDB database and finds the character there: ' + (($out | Where-Object { $_ -match 'RESTORE OK|STOP|world  ' }) -join ' / ')) ($code -eq 0 -and $held.Trim() -eq '13164:Skyrim.esm=,a01=f:Skyrim.esm')
        $asideB07 = @(Get-ChildItem -LiteralPath $rroot -Recurse -File -Filter 'b07.json' | Where-Object { $_.FullName -match 'world-before-restore-[0-9-]+[\\/]world[\\/]changeForms' })
        Yes 'and keeps what the database held aside in world-before-restore-<stamp>\world' ($asideB07.Count -eq 1 -and -not @(Get-ChildItem -LiteralPath $rroot -Directory -Filter 'world-mongo-*').Count)
        $before = (Shell $db 'print(db.changeForms.countDocuments({}))') -join ''
        $out = @(& $box -NoProfile -NonInteractive -File (Join-Path $tree 'scripts/vps/Restore-Server.ps1') -Backup 'x.zip.enc' -Root $rroot -Rehearse -Work (Join-Path $scratch 'work') -NoPause 2>&1 | ForEach-Object { "$_" })
        $rs = [IO.File]::ReadAllText((Join-Path $rroot 'server-settings.json')) | ConvertFrom-Json
        $after = (Shell $db 'print(db.changeForms.countDocuments({}))') -join ''
        Yes ('a rehearsal points the folder at the rehearsal''s own database before any world goes in: ' + $rs.databaseName + ' ' + $rs.databaseUriFile) ($rs.databaseName -eq 'thornswood-rehearsal' -and $rs.databaseUriFile -eq 'C:\Thornswood-Mongo\access\rehearsal.uri' -and $before -eq $after)
    } finally {
        Remove-Item Env:THORNSWOOD_MONGOSH -ErrorAction SilentlyContinue
        $null = Shell 'thornswood-wtestg' 'db.dropDatabase()'
        $null = Shell 'thornswood-wtestf' 'db.dropDatabase()'
        $null = Shell 'thornswood-wteste' 'db.dropDatabase()'
        $null = Shell 'thornswood-wtestd' 'db.dropDatabase()'
        $null = Shell 'thornswood-wtestc' 'db.dropDatabase()'
        $null = Shell 'thornswood-wtest' 'db.dropDatabase()'
        $null = Shell 'thornswood-wtestb' 'db.dropDatabase()'
        Remove-Item -LiteralPath $scratch -Recurse -Force -EA SilentlyContinue
    }
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
