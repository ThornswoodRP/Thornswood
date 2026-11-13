<#
  test-5191-content-build.ps1

      pwsh -NoProfile -File .\tests\test-5191-content-build.ps1

  scripts\mods\Build-ContentOnBox.ps1, the gate's Build-Content verb (#5191,
  stage 3), builds the content plugin and the chain's tables on the box and
  keeps each build by its inputs. This runs it, as the gate does, in a
  stand-in checkout of its own with a stand-in for Run-OnBox.ps1 that writes
  what the tools would, and holds it to that:

  1. A first build runs the plugin's tool and then the chain, keeps the
     plugin and every file the chain says it writes (a folder it writes
     whole) with build.json naming each file's sha256, the commit and the
     key, and copies them all into -Out with build.json as
     content-build.json.
  2. The same commit again (the gate's next checkout) runs no tool: the
     build is REUSED and -Out gets the same files.
  3. A kept build whose file no longer has its sha256 is built again.
  4. A change to an input is a new key and a new build; only the newest
     -Keep builds stay. The other server's build of the same commit has a
     key of its own.
  5. A tool that fails stops the run with nothing kept for its key, and a
     checkout with an uncommitted change is refused before anything runs.
  6. The key is held to what ContentPaths.ps1 lists: a file outside the
     inputs (a harness) changes no key.
  7. Every tool runs from the commit's record: the runner is given the
     collection's store (-Collection), never the server's plugins alone.
  8. A record whose revision adds a plugin the catalogue's order does not
     load moves the order first: the catalogue's two builders run between
     the plugin's tool and the chain, with the moved order as their
     settings, and the build keeps what they wrote. The order is moved by
     ContentPaths.ps1's rule: the new plugin on the end of its kind, a
     master on the end of the masters, a dropped plugin taken out only for
     its revision, Thornswood-Last.esp last.
  9. Records of two revisions stop the build before any tool runs.
#>
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Sha([string]$p) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($p))).ToLowerInvariant() }

$tmpRoot = $(if ($env:TEST_TMP) { $env:TEST_TMP } else { [IO.Path]::GetTempPath() })
$root = Join-Path $tmpRoot ('ts-5191-build-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
$co = Join-Path $root 'checkout'
$cache = Join-Path $root 'cache'
$out = Join-Path $root 'out'
$calls = Join-Path $root 'calls.log'
New-Item -ItemType Directory -Force -Path $co | Out-Null

function Put([string]$rel, [string]$text) {
    $p = Join-Path $co $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p, $text)
}
function TGit([string[]]$w) {
    $o = @(& git -C $co @w 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0) { throw ('git ' + ($w -join ' ') + ': ' + ($o -join ' ')) }
    return $o
}

# The stand-in runner: says what it was asked, and writes what the tool
# would into the checkout, from the commit's own source file.
$runner = Join-Path $root 'runner.ps1'
[IO.File]::WriteAllText($runner, @'
param([Parameter(Position = 0)][string]$Script, [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Arguments, [string]$Server, [string]$Collection)
$co = $env:TS5191_CHECKOUT
Add-Content -LiteralPath $env:TS5191_CALLS -Value ("$Server $Script " + ($Arguments -join ' '))
Add-Content -LiteralPath ($env:TS5191_CALLS + '.store') -Value $Collection
if ($env:TS5191_FAIL -and $Script -like "*$($env:TS5191_FAIL)*") { exit 3 }
$src = [IO.File]::ReadAllText((Join-Path $co 'game/data/source.json'))
function W($rel, $text) { $p = Join-Path $co $rel; New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null; [IO.File]::WriteAllText($p, $text) }
if ($Script -eq 'scripts/mods/Add-ContentRecords.py') { W 'game/content/Thornswood-Content.esp' ("plugin for $Server from $src") }
elseif ($Script -eq 'scripts/dev/Build-NpcPopulation.py') { W 'game/data/npc-population.json' $env:TS5191_MOVED }
elseif ($Script -eq 'scripts/dev/Build-ResourceLocations.py') { W 'game/data/resource-locations.json' 'resources in the moved order' }
elseif ($Script -eq 'scripts/mods/Rebuild-ContentTables.ps1') {
    $plugin = [IO.File]::ReadAllText((Join-Path $co 'game/content/Thornswood-Content.esp'))
    W 'game/data/x.json' ("table of $plugin")
    W 'game/gamemode-tables/X.json' ("gamemode table of $plugin")
    W 'docs/systems/lists/a.md' 'list a'
    W 'docs/systems/lists/deep/b.md' 'list b'
}
exit 0
'@)

try {
    # The stand-in checkout: the two scripts under test, a chain of one step,
    # its source and the outputs as committed.
    foreach ($f in @('scripts/mods/Build-ContentOnBox.ps1', 'scripts/mods/ContentPaths.ps1')) {
        Put $f ([IO.File]::ReadAllText((Join-Path $Repo $f)))
    }
    Put 'scripts/mods/content-tables.json' '{"steps":[{"tool":"scripts/dev/Build-X.js","reads":[],"writes":["game/data/x.json","game/gamemode-tables/X.json","docs/systems/lists"]}],"notInChain":[]}'
    Put 'scripts/dev/Build-X.js' '// stand-in'
    Put 'game/data/source.json' '{"v":1}'
    Put 'game/content/Thornswood-Content.esp' 'as committed'
    Put 'game/data/x.json' 'as committed'
    Put 'game/gamemode-tables/X.json' 'as committed'
    Put 'docs/systems/lists/a.md' 'as committed'
    Put 'records/r.json' '{}'
    # The records of a revision whose order the catalogue already loads.
    $catalogue = '{"loadOrder":[' + ((@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'A.esm', 'B.esp', 'Thornswood-Content.esp', 'Thornswood-Last.esp') | ForEach-Object { '{"name":"' + $_ + '","sha256":"0"}' }) -join ',') + ']}'
    Put 'game/data/npc-population.json' $catalogue
    Put 'game/data/resource-locations.json' 'resources as committed'
    Put 'records/collection.json' '{"collection":"abc","revision":3,"plugins":[{"name":"A.esm","master":true},{"name":"B.esp","master":false},{"name":"Off.esp","master":false,"enabled":false}]}'
    Put 'records/collection-plugins.json' '{"collection":"abc","revision":3,"plugins":[]}'
    $store = Join-Path $root 'store'
    New-Item -ItemType Directory -Force -Path $store | Out-Null
    Put 'layout.json' '{}'
    Put 'tests/test-x.js' '// a harness, not an input'
    TGit @('init', '-q') | Out-Null
    TGit @('add', '--all') | Out-Null
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'base') | Out-Null
    $base = (TGit @('rev-parse', 'HEAD')) -join ''
    $env:TS5191_CHECKOUT = $co
    $env:TS5191_CALLS = $calls
    $env:TS5191_FAIL = ''
    $build = Join-Path $co 'scripts/mods/Build-ContentOnBox.ps1'

    function Run([string]$Server = 'dev', [int]$Keep = 8) {
        foreach ($f in @($calls, ($calls + '.store'))) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f } }
        if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
        $o = @(& pwsh -NoProfile -File $build -Server $Server -Out $out -Cache $cache -Keep $Keep -Runner $runner -Store $store 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
        $asked = $(if (Test-Path -LiteralPath $calls) { @(Get-Content -LiteralPath $calls) } else { @() })
        $script:stores = $(if (Test-Path -LiteralPath ($calls + '.store')) { @(Get-Content -LiteralPath ($calls + '.store')) } else { @() })
        $key = @($o | Where-Object { $_ -match '^(BUILT|REUSED) ([0-9a-f]{64})$' } | ForEach-Object { $Matches[2] }) | Select-Object -First 1
        return [pscustomobject]@{ Code = $code; Text = ($o -join "`n"); Lines = $o; Calls = $asked; Key = $key }
    }
    # The gate's next run: a fresh checkout of the same commit.
    function Fresh([string]$At = $base) { TGit @('reset', '-q', '--hard', $At) | Out-Null; TGit @('clean', '-q', '-fdx') | Out-Null }

    # ---- 1. a first build ----------------------------------------------------
    $r1 = Run
    if ($r1.Code -ne 0) { Write-Host $r1.Text }
    Yes '1 a first build ends 0 and says BUILT with its key, and the commit it is from' ($r1.Code -eq 0 -and $r1.Key -and ($r1.Lines -contains "FROM $base"))
    Yes '1 it runs the plugin''s tool with the load order''s plugins as its masters, then the chain' (
        $r1.Calls.Count -eq 2 -and $r1.Calls[0] -eq 'dev scripts/mods/Add-ContentRecords.py --masters {data}' -and
        $r1.Calls[1] -eq 'dev scripts/mods/Rebuild-ContentTables.ps1 -Data {data} -PluginsTxt {plugins}')
    $kept = Join-Path (Join-Path $cache 'dev') $r1.Key
    $rec = [IO.File]::ReadAllText((Join-Path $kept 'build.json')) | ConvertFrom-Json
    $names = @($rec.files.PSObject.Properties | ForEach-Object { $_.Name })
    $want = @('game/content/Thornswood-Content.esp', 'game/data/x.json', 'game/gamemode-tables/X.json', 'docs/systems/lists/a.md', 'docs/systems/lists/deep/b.md')
    Yes ('1 the build keeps the plugin and every file the chain writes, a folder whole: ' + ($names -join ', ')) (
        $names.Count -eq $want.Count -and -not @($want | Where-Object { $names -notcontains $_ }).Count)
    Yes '1 the plugin kept is the one the tool wrote, not the one committed' (
        [IO.File]::ReadAllText((Join-Path $kept 'files/game/content/Thornswood-Content.esp')) -eq 'plugin for dev from {"v":1}')
    Yes '1 build.json names the server, the key, the commit and each file''s sha256' (
        $rec.server -eq 'dev' -and $rec.key -eq $r1.Key -and $rec.commit -eq $base -and $rec.issue -eq 5191 -and
        -not @($rec.files.PSObject.Properties | Where-Object { (Sha (Join-Path $kept ('files/' + $_.Name))) -ne $_.Value }).Count)
    Yes '1 -Out gets every file of the build and build.json as content-build.json' (
        -not @($want | Where-Object { -not (Test-Path -LiteralPath (Join-Path $out $_)) }).Count -and
        (Sha (Join-Path $out 'content-build.json')) -eq (Sha (Join-Path $kept 'build.json')))
    Yes '7 every tool is given the collection''s store' ($script:stores.Count -eq 2 -and -not @($script:stores | Where-Object { $_ -ne $store }).Count)
    Yes '7 an order the catalogue already loads is not moved: no catalogue builder runs, and the line says so' ($r1.Text -match 'collection abc revision 3, 9 plugins, as the catalogue records it' -and $names -notcontains 'game/data/resource-locations.json')
    Yes '1 no .part folder is left' (-not @(Get-ChildItem -LiteralPath (Join-Path $cache 'dev') -Directory | Where-Object { $_.Name -like '*.part' }).Count)

    # ---- 2. the same commit again ------------------------------------------
    Fresh
    $r2 = Run
    Yes '2 the same commit again is REUSED under the same key, and no tool runs' ($r2.Code -eq 0 -and $r2.Key -eq $r1.Key -and ($r2.Lines -contains "REUSED $($r1.Key)") -and $r2.Calls.Count -eq 0)
    Yes '2 -Out gets the same files' ((Sha (Join-Path $out 'game/content/Thornswood-Content.esp')) -eq (Sha (Join-Path $kept 'files/game/content/Thornswood-Content.esp')) -and
        (Test-Path -LiteralPath (Join-Path $out 'docs/systems/lists/deep/b.md')))

    # ---- 3. a kept file that changed ----------------------------------------
    [IO.File]::WriteAllText((Join-Path $kept 'files/game/data/x.json'), 'tampered')
    Fresh
    $r3 = Run
    Yes '3 a kept build whose file is not its sha256 is built again' ($r3.Code -eq 0 -and $r3.Key -eq $r1.Key -and ($r3.Lines -contains "BUILT $($r1.Key)") -and $r3.Calls.Count -eq 2)
    Yes '3   and the file is right again' ([IO.File]::ReadAllText((Join-Path $kept 'files/game/data/x.json')) -eq 'table of plugin for dev from {"v":1}')

    # ---- 6. a file outside the inputs ---------------------------------------
    Fresh
    Put 'tests/test-x.js' '// changed'
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-am', 'a harness') | Out-Null
    $harness = (TGit @('rev-parse', 'HEAD')) -join ''
    $r6 = Run
    Yes '6 a commit that changes only a harness has the same key, and is REUSED' ($r6.Code -eq 0 -and $r6.Key -eq $r1.Key -and $r6.Calls.Count -eq 0)

    # ---- 4. a changed input, the other server, and what is kept --------------
    Fresh $harness
    Put 'game/data/source.json' '{"v":2}'
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-am', 'source v2') | Out-Null
    $v2 = (TGit @('rev-parse', 'HEAD')) -join ''
    $r4 = Run -Keep 1
    Yes '4 a changed input is a new key and a new build' ($r4.Code -eq 0 -and $r4.Key -and $r4.Key -ne $r1.Key -and $r4.Calls.Count -eq 2 -and ($r4.Lines -contains "FROM $v2"))
    Yes '4   built from the new source' ([IO.File]::ReadAllText((Join-Path $out 'game/content/Thornswood-Content.esp')) -eq 'plugin for dev from {"v":2}')
    Yes '4 with -Keep 1, only the newest build of the server stays' (
        @(Get-ChildItem -LiteralPath (Join-Path $cache 'dev') -Directory | ForEach-Object { $_.Name }) -join ',' -eq $r4.Key)
    Fresh $v2
    $r4m = Run -Server main
    Yes '4 the main server''s build of the same commit has a key of its own, built against main''s plugins' (
        $r4m.Code -eq 0 -and $r4m.Key -ne $r4.Key -and $r4m.Calls.Count -eq 2 -and $r4m.Calls[0] -like 'main *' -and
        (Test-Path -LiteralPath (Join-Path (Join-Path $cache 'main') $r4m.Key)) -and (Test-Path -LiteralPath (Join-Path (Join-Path $cache 'dev') $r4.Key)))

    # ---- 5. a failing tool, and an uncommitted change -----------------------
    Fresh $v2
    Put 'game/data/source.json' '{"v":3}'
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-am', 'source v3') | Out-Null
    $env:TS5191_FAIL = 'Rebuild-ContentTables'
    $r5 = Run
    $env:TS5191_FAIL = ''
    Yes '5 a tool that fails stops the run' ($r5.Code -ne 0 -and $r5.Text -match 'STOP\. Rebuild-ContentTables\.ps1 ended with exit 3' -and -not $r5.Key)
    Yes '5   and nothing is kept for its key, finished or not' (
        @(Get-ChildItem -LiteralPath (Join-Path $cache 'dev') -Directory | ForEach-Object { $_.Name }) -join ',' -eq $r4.Key)
    Fresh $v2
    Put 'game/data/source.json' '{"v":"not committed"}'
    $r5b = Run
    Yes '5 a checkout with an uncommitted change is refused before any tool runs' ($r5b.Code -ne 0 -and $r5b.Text -match 'uncommitted' -and $r5b.Calls.Count -eq 0)

    # ---- 8. a revision that adds plugins ------------------------------------
    Fresh $v2
    Put 'records/collection.json' '{"collection":"abc","revision":4,"plugins":[{"name":"A.esm","master":true},{"name":"New.esp","master":false,"after":["B.esp"]},{"name":"B.esp","master":false},{"name":"M.esp","master":true},{"name":"Off.esp","master":false,"enabled":false}]}'
    Put 'records/collection-plugins.json' '{"collection":"abc","revision":4,"plugins":[]}'
    $env:TS5191_MOVED = 'the moved catalogue'
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-am', 'revision 4') | Out-Null
    $rev4 = (TGit @('rev-parse', 'HEAD')) -join ''
    $r8 = Run
    if ($r8.Code -ne 0) { Write-Host $r8.Text }
    Yes '8 a revision that adds plugins moves the order: the catalogue''s builders run between the plugin''s tool and the chain' (
        $r8.Code -eq 0 -and $r8.Calls.Count -eq 4 -and $r8.Calls[0] -like 'dev scripts/mods/Add-ContentRecords.py *' -and
        $r8.Calls[1] -eq 'dev scripts/dev/Build-NpcPopulation.py --settings {settings}' -and
        $r8.Calls[2] -eq 'dev scripts/dev/Build-ResourceLocations.py --settings {settings} --strings-dir {data}' -and
        $r8.Calls[3] -like 'dev scripts/mods/Rebuild-ContentTables.ps1 *')
    Yes '8   and says what it adds' ($r8.Text -match 'revision 4, 11 plugins, moved from the 9 the catalogue records, adding M\.esp, New\.esp')
    $k8 = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $cache 'dev') $r8.Key) 'build.json')) | ConvertFrom-Json
    Yes '8   and keeps what the catalogue''s builders wrote' (
        [IO.File]::ReadAllText((Join-Path $out 'game/data/npc-population.json')) -eq 'the moved catalogue' -and
        [IO.File]::ReadAllText((Join-Path $out 'game/data/resource-locations.json')) -eq 'resources in the moved order' -and
        $k8.collection.revision -eq 4 -and $k8.collection.moved -eq $true)

    # The rule itself, on the records alone.
    Fresh $rev4
    . (Join-Path $co 'scripts/mods/ContentPaths.ps1')
    $o8 = Get-ThornswoodContentOrder -Repo $co
    Yes ('8 a new master goes on the end of the masters and a new plugin on the end, Thornswood-Last.esp last: ' + ($o8.Names -join ', ')) (
        ($o8.Names -join ',') -eq 'Skyrim.esm,Update.esm,Dawnguard.esm,HearthFires.esm,Dragonborn.esm,A.esm,M.esp,B.esp,Thornswood-Content.esp,New.esp,Thornswood-Last.esp')
    Yes '8 a plugin the record switches off is not added' ($o8.Names -notcontains 'Off.esp')
    Put 'records/collection-dropped.json' '{"collection":"abc","revision":3,"dropped":[{"name":"B.esp"}]}'
    Yes '8 collection-dropped.json for another revision takes nothing out' ((Get-ThornswoodContentOrder -Repo $co).Names -contains 'B.esp')
    Put 'records/collection-dropped.json' '{"collection":"abc","revision":4,"dropped":[{"name":"B.esp"}]}'
    $d8 = Get-ThornswoodContentOrder -Repo $co
    Yes '8 collection-dropped.json for this revision takes its plugin out' ($d8.Names -notcontains 'B.esp' -and ($d8.Dropped -join ',') -eq 'B.esp')
    Fresh $rev4

    # ---- 9. records of two revisions ---------------------------------------
    Put 'records/collection-plugins.json' '{"collection":"abc","revision":5,"plugins":[]}'
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-am', 'half a revision') | Out-Null
    $r9 = Run
    Yes '9 records of two revisions stop the build before any tool runs' ($r9.Code -ne 0 -and $r9.Text -match 'they move together' -and $r9.Calls.Count -eq 0 -and -not $r9.Key)
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
