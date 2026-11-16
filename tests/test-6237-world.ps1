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
        $again = Save-ThornswoodWorld $w
        Yes ('Save run again finishes what it did and changes nothing more: ' + $again) ($again -eq 'WORLDSAVED|mongodb|2|1|0|3')

        $null = Shell $db 'db.changeForms.updateOne({ formDesc: "14" }, { $set: { profileId: 44 } })'
        $stop = Save-ThornswoodWorld $w
        Yes 'a form the server wrote meanwhile stops Save' ($stop -like 'STOP|*' -and $stop -match '14 changed in the database')
        $kept = Shell $db 'print(db.changeForms.findOne({ formDesc: "14" }).profileId)'
        Yes 'and nothing was written over it' (($kept -join '').Trim() -eq '44')

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
    } finally {
        $null = Shell 'thornswood-wtest' 'db.dropDatabase()'
        $null = Shell 'thornswood-wtestb' 'db.dropDatabase()'
        Remove-Item -LiteralPath $scratch -Recurse -Force -EA SilentlyContinue
    }
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
