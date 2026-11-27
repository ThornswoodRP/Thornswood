# test-2180-record-readers.ps1
#
#     pwsh -NoProfile -File .\tests\test-2180-record-readers.ps1
#
# The local readers of the four high-risk records hold them to RecordShape.ps1
# (#2180, second slice), so a record at a version this checkout does not know,
# or short of a field, stops before anything is sent. Each reader's own code
# is checked for the call, placed before its first send, and the behaviour is
# run where the reader is a function (MaxOnline, CollectionPlugins). Offline.
#
# records\collection-plugins.json has these readers, and each one is held
# here to the same contract, a version it knows, a plugins list, a name, a
# whole size and a sha256 on every row and no plugin twice (#4279):
#   Read-ThornswoodCollectionPluginRecord (CollectionPlugins.ps1), which
#     Deploy-Server, Deploy-DevGamemode and CollectionStore.ps1 read through;
#   Ship-Rules' Get-ShipLastPluginProblem, the Thornswood-Last check;
#   New-NexusRevision's light-flag step, which also refuses a missing record
#     and one that is not the revision it starts from;
#   Build-WoodworkingBenches.py's collection_stop, which Build-BuildingHolds.py
#     and Build-StationSites.py (and Build-MarketStalls.py) call, through
#     own_plugins.read_collection_plugins, the same checks in Python.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Refusal([scriptblock]$b) { try { $null = & $b; return '' } catch { return $_.Exception.Message } }
function Src([string]$rel) { return [IO.File]::ReadAllText((Join-Path $repo $rel)).Replace("`r`n", "`n") }
function At([string]$text, [string]$needle) { return $text.IndexOf($needle) }

# ---- the call is there, and before anything goes
$ds = Src 'scripts\deploy\Deploy-Server.ps1'
$i = At $ds '$rec = Read-ThornswoodRecord -Path $recordPath -Kind server-build'
Yes 'Deploy-Server reads server-build.json through Read-ThornswoodRecord' ($i -gt 0 -and (At $ds ". (Join-Path `$Here '..\release\RecordShape.ps1')") -lt $i -and (At $ds ". (Join-Path `$Here '..\release\RecordShape.ps1')") -gt 0)
Yes '  before the first send or remote call' ($i -lt (At $ds 'Send-ThornswoodArtifact') -or (At $ds 'Send-ThornswoodArtifact') -lt 0)
Yes '  and has no bare read of the record left' (-not $ds.Contains('$rec = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $recordPath'))
$dd = Src 'scripts\deploy\Deploy-DevGamemode.ps1'
$i = At $dd '$devRecord = Read-ThornswoodRecord -Path $devRecordPath -Kind server-build'
Yes 'Deploy-DevGamemode takes the record, its commit and whether it loads light plugins, through Read-ThornswoodRecord' ($i -gt 0 -and (At $dd "RecordShape.ps1')") -lt $i -and (At $dd '$devRecordCommit = [string]$devRecord.source.commit') -gt $i)
Yes '  before the artifact is sent' ($i -lt (At $dd 'Send-ThornswoodArtifact -Artifact'))
$dg = Src 'scripts\deploy\Deploy-Gamemode.ps1'
$i = At $dg 'Read-ThornswoodRecord -Path $serverRecord -Kind server-build'
Yes 'Deploy-Gamemode holds server-build.json to its shape before the load order is worked out' ($i -gt 0 -and $i -lt (At $dg '$loadsLight = '))
$sc = Src 'scripts\release\Sync-Client.ps1'
$i = At $sc 'Get-ThornswoodRecordProblems -Doc $rec -Kind client-build'
Yes 'Sync-Client holds client-build.json to its shape right after it parses, and stops on a problem' ($i -gt (At $sc '$rec = $recText | ConvertFrom-Json') -and $sc.Contains('if ($recBad.Count) { Stop-Here'))
Yes '  before any file is copied' ($i -lt (At $sc 'Copy-Item'))
$ep = Src 'scripts\release\Export-ServerPayload.ps1'
Yes 'Export-ServerPayload holds server-build.json to its shape before packing' ((At $ep 'Get-ThornswoodRecordProblems -Doc $rec -Kind server-build') -gt (At $ep '$rec = [IO.File]::ReadAllText($Record)') -and $ep.Contains("Nothing was packed.') }"))

# ---- MaxOnline: an unknown version stops; missing data still says why
. (Join-Path $repo 'scripts\deploy\MaxOnline.ps1')
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2180b [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
try {
    $mo = Join-Path $tmp 'most-online.json'
    [IO.File]::WriteAllText($mo, '{ "version": 2, "people": 25 }')
    $why = Refusal { Get-MostOnline $mo }
    Yes 'Get-MostOnline throws on a version this checkout does not know, naming the file' ($why.StartsWith($mo) -and $why -match 'it is version 2, and this checkout knows 1')
    [IO.File]::WriteAllText($mo, '{ "version": 1, "people": 25, "staffSeats": 5 }')
    $r = Get-MostOnline $mo
    Yes '  version 1 said out loud still reads' ($r.Value -eq 25 -and $r.Staff -eq 5)
    [IO.File]::WriteAllText($mo, '{ "people": 25 }')
    Yes '  and no version reads as before' ((Get-MostOnline $mo).Value -eq 25)
    [IO.File]::WriteAllText($mo, '{ "note": "x" }')
    $r = Get-MostOnline $mo
    Yes '  a record with no people still gives no number and says why (unchanged)' ($r.Value -eq 0 -and $r.Why -eq 'it has no people')
    Yes 'the committed most-online.json still reads' ((Get-MostOnline).Value -gt 0)

    # ---- CollectionPlugins: the reader holds the record to the same contract
    . (Join-Path $repo 'scripts\deploy\CollectionPlugins.ps1')
    $cp = Join-Path $tmp 'collection-plugins.json'
    $h = '0' * 64
    [IO.File]::WriteAllText($cp, ('{"version":1,"plugins":[{"name":"a.esp","size":"12","sha256":"' + $h + '"}]}'))
    $why = Refusal { Read-ThornswoodCollectionPluginRecord $cp }
    Yes 'Read-ThornswoodCollectionPluginRecord refuses a size that is a string, naming the file' ($why.StartsWith($cp) -and $why -match 'plugins\.a\.esp has no whole size')
    [IO.File]::WriteAllText($cp, ('{"version":2,"plugins":[{"name":"a.esp","size":12,"sha256":"' + $h + '"}]}'))
    Yes '  and still refuses version 2 (its own message)' ((Refusal { Read-ThornswoodCollectionPluginRecord $cp }) -match 'not a version 1 collection plugin record')
    [IO.File]::WriteAllText($cp, ('{"version":1,"plugins":[{"name":"a.esp","size":12,"sha256":"' + $h + '"}]}'))
    $t = Read-ThornswoodCollectionPluginRecord $cp
    Yes '  a good record still reads' ($t.ContainsKey('A.ESP') -and $t['a.esp'].Size -eq 12)
    Yes 'the committed collection-plugins.json still reads through the deploy reader' ((Read-ThornswoodCollectionPluginRecord (Join-Path $repo 'records\collection-plugins.json')).Count -gt 50)

    # ---- the other readers of collection-plugins.json (#4279)
    $real = Join-Path $repo 'records\collection-plugins.json'
    $realRev = [int](ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($real)) $real).revision
    $twice = '{"version":1,"collection":"7essxf","revision":8,"plugins":[{"name":"a.esp","size":12,"sha256":"' + $h + '"},{"name":"A.esp","size":12,"sha256":"' + $h + '"}]}'
    $v2 = '{"version":2,"collection":"7essxf","revision":8,"plugins":[{"name":"a.esp","size":12,"sha256":"' + $h + '"}]}'
    $good = '{"version":1,"collection":"7essxf","revision":8,"plugins":[{"name":"a.esp","size":12,"sha256":"' + $h + '"}]}'

    # Revision metadata readers (#6228), with the same contents except version.
    . (Join-Path $repo 'scripts/release/CollectionRevision.ps1')
    . (Join-Path $repo 'scripts/release/CollectionRecord.ps1')
    $meta = Join-Path $tmp 'metadata'
    [void][IO.Directory]::CreateDirectory((Join-Path $meta 'records'))
    $metaPlugins = Join-Path $meta 'records/collection-plugins.json'
    [IO.File]::WriteAllText((Join-Path $meta 'records/collection.json'), '{"collection":"7essxf","revision":8,"plugins":[{"name":"a.esp","master":false}]}')
    [IO.File]::WriteAllText((Join-Path $meta 'records/load-order.json'), '{"loadOrder":["Skyrim.esm","Update.esm","Dawnguard.esm","HearthFires.esm","Dragonborn.esm","a.esp","Thornswood-Content.esp","Thornswood-Last.esp"]}')
    $readers = [ordered]@{
        CollectionRevision = { (Get-ShipRecordedCollectionRevision $meta).Revision }
        ContentPaths = { (Get-ThornswoodContentOrder -Repo $meta).Revision }
        CollectionRecord = { (Read-CollectionRecord $metaPlugins).revision }
    }
    foreach ($reader in $readers.Keys) {
        [IO.File]::WriteAllText($metaPlugins, $good)
        Yes "$reader reads revision 8 from a valid version 1 record" ((& $readers[$reader]) -eq 8)
        [IO.File]::WriteAllText($metaPlugins, $v2)
        $why = Refusal $readers[$reader]
        Yes "$reader refuses version 2 before using its revision" ($why.StartsWith($metaPlugins) -and $why -match 'it is version 2, and this checkout knows 1')
    }

    # Ship-Rules: the Thornswood-Last check reads the record before the recipe.
    . (Join-Path $repo 'scripts\release\Ship-Rules.ps1')
    $sr = Join-Path $tmp 'ship'
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $sr $ShipLastManifest)), (Join-Path $sr 'records')
    [IO.File]::WriteAllText((Join-Path $sr $ShipLastManifest), '{}')
    $srRec = Join-Path $sr 'records\collection-plugins.json'
    function ShipSays { try { return [string](Get-ShipLastPluginProblem $sr @('a.esp', 'Thornswood-Last.esp')) } catch { return 'THREW: ' + $_.Exception.Message } }
    [IO.File]::WriteAllText($srRec, $twice)
    $p = ShipSays
    Yes 'Get-ShipLastPluginProblem refuses a record that lists a plugin twice, before it reads the recipe' ($p -match 'collection-plugins record this checkout can trust' -and $p -match 'lists A\.esp twice')
    if ($p -notmatch 'lists A\.esp twice') { Write-Host "      it said: $p" }
    [IO.File]::WriteAllText($srRec, $v2)
    $p = ShipSays
    Yes '  and one at a version this checkout does not know' ($p -match 'it is version 2, and this checkout knows 1')
    $sh = Src 'scripts\release\Ship-Rules.ps1'
    $f = At $sh 'function Get-ShipLastPluginProblem'
    Yes '  it reads the record through Read-ThornswoodRecord, and has no bare parse of it left' ($sh.IndexOf('Read-ThornswoodRecord -Path $rpath -Kind collection-plugins', $f) -gt $f -and -not $sh.Contains('$record = ([IO.File]::ReadAllText($rpath)'))

    # New-NexusRevision: the light-flag step, a script run on Nexus, so its
    # code is checked here and its runs in test-2914-nexus-scripts.ps1.
    $nn = Src 'scripts\release\New-NexusRevision.ps1'
    $i = At $nn 'Read-ThornswoodRecord -Path $PluginRecord -Kind collection-plugins'
    Yes 'New-NexusRevision reads collection-plugins.json through Read-ThornswoodRecord in its light-flag step' ($i -gt 0 -and (At $nn ". (Join-Path `$Here 'RecordShape.ps1')") -gt 0 -and (At $nn ". (Join-Path `$Here 'RecordShape.ps1')") -lt $i)
    Yes '  does not pass over a missing record' (-not $nn.Contains('if (Test-Path -LiteralPath $recordPath)') -and -not $nn.Contains('if (Test-Path -LiteralPath $PluginRecord)'))
    $j = $nn.IndexOf('-ne $BaseRevision', [Math]::Max($i, 0))
    Yes '  holds the record''s revision to the revision it starts from' ($i -gt 0 -and $j -gt $i -and $j - $i -lt 700)
        # The light-flag step's own download, the first after its record is read:
    # the replicate step further up (#6907) downloads for another purpose.
    $dl = $nn.IndexOf('Get-NexusFileArchive $Game $fid', [Math]::Max($i, 0))
    Yes '  and both before any archive is downloaded for it' ($i -gt 0 -and $j -gt $i -and $dl -gt $j)

    # The builders: one shared helper in Python, the same checks.
    $wbSrc = Src 'scripts\dev\Build-WoodworkingBenches.py'
    $cs = At $wbSrc 'def collection_stop('
    Yes 'Build-WoodworkingBenches.py''s collection_stop reads the record through own_plugins.read_collection_plugins' ($cs -gt 0 -and $wbSrc.IndexOf('own_plugins.read_collection_plugins(COLLECTION_PLUGINS)', $cs) -gt $cs -and -not $wbSrc.Contains('json.load(io.open(COLLECTION_PLUGINS'))
    foreach ($b in 'Build-BuildingHolds.py', 'Build-StationSites.py') {
        $bs = Src ('scripts\dev\' + $b)
        Yes "  $b asks wb.collection_stop and parses the record nowhere itself" ($bs.Contains('wb.collection_stop(') -and $bs -notmatch 'json\.load\([^\n]*(collection-plugins|COLLECTION_PLUGINS)')
    }
    $py = $null
    foreach ($exe in 'python', 'py', 'python3') { if (Get-Command $exe -ErrorAction SilentlyContinue) { $py = $exe; break } }
    Yes 'there is a python here to run the builders'' check' ($null -ne $py)
    if ($py) {
        $wbPath = Join-Path $repo 'scripts\dev\Build-WoodworkingBenches.py'
        $stopPy = "import importlib.util,sys`ns=importlib.util.spec_from_file_location('wb',sys.argv[1])`nm=importlib.util.module_from_spec(s)`ntry:`n    s.loader.exec_module(m)`n    print(m.collection_stop([],[],'Data') or 'NONE')`nexcept Exception as e:`n    print('RAISED %s: %s' % (type(e).__name__,e))"
        $pyRec = Join-Path $tmp 'py-collection-plugins.json'
        function PyStop {
            $was = $env:THORNSWOOD_COLLECTION_PLUGINS
            $env:THORNSWOOD_COLLECTION_PLUGINS = $pyRec
            try { return ((& $py -c $stopPy $wbPath) | Out-String).Trim() } finally { $env:THORNSWOOD_COLLECTION_PLUGINS = $was }
        }
        [IO.File]::WriteAllText($pyRec, $twice)
        $p = PyStop
        Yes 'the builders'' collection_stop stops on a record that lists a plugin twice, naming the file' ($p.StartsWith('STOP.') -and $p.Contains($pyRec) -and $p -match 'this checkout can trust' -and $p -match 'lists A\.esp twice')
        if (-not $p.StartsWith('STOP.') -or $p -notmatch 'twice') { Write-Host "      it said: $p" }
        [IO.File]::WriteAllText($pyRec, $v2)
        $p = PyStop
        Yes '  and on one at a version this checkout does not know' ($p.StartsWith('STOP.') -and $p -match 'it is version 2, and this checkout knows 1')
        [IO.File]::WriteAllText($pyRec, '{"version":1,"plugins":[{"name":"a.esp","size":"12","sha256":"' + $h + '"}]}')
        $p = PyStop
        Yes '  and on a size that is a string' ($p.StartsWith('STOP.') -and $p -match 'plugins\.a\.esp has no whole size')
        Remove-Item -LiteralPath $pyRec
        $p = PyStop
        Yes '  and on no record at all, as a STOP rather than a traceback' ($p.StartsWith('STOP.') -and $p.Contains($pyRec))
        [IO.File]::WriteAllText($pyRec, $good)
        $p = PyStop
        Yes '  a good record still reads, and only the load order is asked about' ($p.StartsWith('STOP.') -and $p -notmatch 'can trust' -and $p -match 'not in the load order' -and $p -match 'a\.esp')
        $readPy = "import sys`nsys.path.insert(0,sys.argv[1])`nimport own_plugins`nprint(len(own_plugins.read_collection_plugins(sys.argv[2])['plugins']))"
        $n = ((& $py -c $readPy (Join-Path $repo 'scripts\dev') $real 2>&1) | Out-String).Trim()
        Yes 'the committed collection-plugins.json reads through own_plugins.read_collection_plugins' ($n -match '^\d+$' -and [int]$n -gt 50)
    }

    # The header of CollectionPlugins.ps1 shows the record as it is now.
    $cph = Src 'scripts\deploy\CollectionPlugins.ps1'
    $ex = [regex]::Match($cph, '"revision": (\d+)')
    Yes "CollectionPlugins.ps1's example names revision $realRev, the one the record is on" ($ex.Success -and [int]$ex.Groups[1].Value -eq $realRev)
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- build.yml runs Check-Records (as ./scripts/release/Check-Records.ps1
# since the workflow's paths went to forward slashes, so either is read)
$by = Src '.github\workflows\build.yml'
Yes 'build.yml runs Check-Records.ps1 and fails closed on it' ($by -match 'scripts[\\/]release[\\/]Check-Records\.ps1[^\n]*\n\s+if \(\$LASTEXITCODE -ne 0\)')

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
