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
     checkout with an uncommitted change is refused before anything runs. A
     runner that throws stops it on a STOP line saying what it threw, which
     the deploy agent puts in its status (#6351).
  6. The key is held to what ContentPaths.ps1 lists: a file outside the
     inputs (a harness) changes no key.
  7. Every tool runs from the commit's record: the runner is given the
     collection's store (-Collection), never the server's plugins alone.
  8. The catalogue's two builders run in every build, between the plugin's
     tool and the chain, with the build's order as their settings, and the
     build keeps what they wrote. A record whose revision adds a plugin
     records\load-order.json does not load moves the order. The order is moved by
     ContentPaths.ps1's rule: the new plugin on the end of its kind, a
     master on the end of the masters, a dropped plugin taken out only for
     its revision, Thornswood-Last.esp last.
  9. Records of two revisions stop the build before any tool runs.
  11. The order is records\load-order.json's: a catalogue in the checkout
      that records another order moves nothing (#5191, 4e).
  10. -Stations (#6192) lays the newest whole build of the server kept here
      over the checkout, measures the stations over its tables, then builds
      the plugin from the new sites and runs the chain, keeps nothing, and
      hands every file back, station-sites.json among them; with no build
      kept it stops before any tool runs.
  12. -WithoutLast (#5191, Patrick's B on q-5191-last-plugin-loop) was the
      measurement of what the steps before Build-LastPlugin.py took from the
      Last plugin of the build before. Rebuild-ContentTables.ps1 leaves the
      plugin out of their order on every build since 16 Nov 2026, so the
      switch is gone: asked for, it stops before any tool runs.
  13. Every file of the build is the bytes git holds at the build's commit,
      not the checkout's copy: a file committed LF that the checkout holds
      CRLF (core.autocrlf, an eol rule added later) is kept and handed back
      LF.
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
if ($env:TS5191_FAIL -and $Script -like "*$($env:TS5191_FAIL)*") { if ($env:TS5191_SAYS) { Write-Host 'a line before'; Write-Host ('STOP. ' + $env:TS5191_SAYS) -ForegroundColor Yellow; Write-Host 'the tool exited 3' }; exit 3 }
if ($env:TS5191_THROW -and $Script -like "*$($env:TS5191_THROW)*") { throw "the stand-in threw before it reached the box for $Script" }
$src = [IO.File]::ReadAllText((Join-Path $co 'game/data/source.json'))
function W($rel, $text) { $p = Join-Path $co $rel; New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null; [IO.File]::WriteAllText($p, $text) }
$sitesAt = Join-Path $co 'game/data/station-sites.json'
$sites = if (Test-Path -LiteralPath $sitesAt) { ' with ' + [IO.File]::ReadAllText($sitesAt) } else { '' }
if ($Script -eq 'scripts/mods/Add-ContentRecords.py') { W 'game/content/Thornswood-Content.esp' ("plugin for $Server from $src$sites") }
elseif ($Script -eq 'scripts/dev/Build-StationSites.py') { W 'game/data/station-sites.json' ('sites over ' + [IO.File]::ReadAllText((Join-Path $co 'game/data/x.json'))) }
elseif ($Script -eq 'scripts/dev/Build-NpcPopulation.py') { W 'game/data/npc-population.json' $env:TS5191_MOVED }
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
    # The stand-in checkout: the scripts under test (and Artifact.ps1, which
    # reads the build's files out of git), a chain of one step,
    # its source and the outputs as committed.
    foreach ($f in @('scripts/mods/Build-ContentOnBox.ps1', 'scripts/mods/ContentPaths.ps1', 'scripts/deploy/Artifact.ps1',
            'scripts/release/RecordShape.ps1', 'scripts/release/Read-JsonFile.ps1',
            'scripts/vps/Vps.ps1', 'scripts/vps/Send-Script.ps1', 'scripts/vps/Lock-Folder.ps1')) {
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
    # The records of a revision whose order records\load-order.json already is.
    $loadOrder = '{"collection":"abc","revision":3,"loadOrder":[' + ((@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'A.esm', 'B.esp', 'Thornswood-Content.esp', 'Thornswood-Last.esp') | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']}'
    Put 'records/load-order.json' $loadOrder
    Put 'records/collection.json' '{"collection":"abc","revision":3,"plugins":[{"name":"A.esm","master":true},{"name":"B.esp","master":false},{"name":"Off.esp","master":false,"enabled":false}]}'
    Put 'records/collection-plugins.json' ('{"version":1,"collection":"abc","revision":3,"plugins":[{"name":"A.esm","size":12,"sha256":"' + ('0' * 64) + '"}]}')
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
    $env:TS5191_THROW = ''
    $env:TS5191_SAYS = ''
    $env:TS5191_MOVED = 'the catalogue'
    $build = Join-Path $co 'scripts/mods/Build-ContentOnBox.ps1'

    function Run([string]$Server = 'dev', [int]$Keep = 8, [switch]$Stations, [switch]$WithoutLast) {
        foreach ($f in @($calls, ($calls + '.store'))) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f } }
        if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
        $more = @(); if ($Stations) { $more += '-Stations' }; if ($WithoutLast) { $more += '-WithoutLast' }
        $o = @(& pwsh -NoProfile -File $build -Server $Server -Out $out -Cache $cache -Keep $Keep -Runner $runner -Store $store @more 2>&1 | ForEach-Object { "$_" })
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
    Yes '1 it runs the plugin''s tool with the load order''s plugins as its masters, the catalogue in that order, then the chain' (
        $r1.Calls.Count -eq 3 -and $r1.Calls[0] -eq 'dev scripts/mods/Add-ContentRecords.py --masters {data} --plugins {plugins}' -and
        $r1.Calls[1] -eq 'dev scripts/dev/Build-NpcPopulation.py --settings {settings}' -and
        $r1.Calls[2] -eq 'dev scripts/mods/Rebuild-ContentTables.ps1 -Data {data} -PluginsTxt {plugins}')
    $kept = Join-Path (Join-Path $cache 'dev') $r1.Key
    $rec = [IO.File]::ReadAllText((Join-Path $kept 'build.json')) | ConvertFrom-Json
    $names = @($rec.files.PSObject.Properties | ForEach-Object { $_.Name })
    $want = @('game/content/Thornswood-Content.esp', 'game/data/npc-population.json', 'game/data/x.json', 'game/gamemode-tables/X.json', 'docs/systems/lists/a.md', 'docs/systems/lists/deep/b.md')
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
    Yes '7 every tool is given the collection''s store' ($script:stores.Count -eq 3 -and -not @($script:stores | Where-Object { $_ -ne $store }).Count)
    Yes '7 an order records\load-order.json already is is not moved, and the line says so' ($r1.Text -match 'collection abc revision 3, 9 plugins, as records\\load-order\.json records it' -and $rec.collection.moved -eq $false)
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
    Yes '3 a kept build whose file is not its sha256 is built again' ($r3.Code -eq 0 -and $r3.Key -eq $r1.Key -and ($r3.Lines -contains "BUILT $($r1.Key)") -and $r3.Calls.Count -eq 3)
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
    Yes '4 a changed input is a new key and a new build' ($r4.Code -eq 0 -and $r4.Key -and $r4.Key -ne $r1.Key -and $r4.Calls.Count -eq 3 -and ($r4.Lines -contains "FROM $v2"))
    Yes '4   built from the new source' ([IO.File]::ReadAllText((Join-Path $out 'game/content/Thornswood-Content.esp')) -eq 'plugin for dev from {"v":2}')
    Yes '4 with -Keep 1, only the newest build of the server stays' (
        @(Get-ChildItem -LiteralPath (Join-Path $cache 'dev') -Directory | ForEach-Object { $_.Name }) -join ',' -eq $r4.Key)
    Fresh $v2
    $r4m = Run -Server main
    Yes '4 the main server''s build of the same commit has a key of its own, built against main''s plugins' (
        $r4m.Code -eq 0 -and $r4m.Key -ne $r4.Key -and $r4m.Calls.Count -eq 3 -and $r4m.Calls[0] -like 'main *' -and
        (Test-Path -LiteralPath (Join-Path (Join-Path $cache 'main') $r4m.Key)) -and (Test-Path -LiteralPath (Join-Path (Join-Path $cache 'dev') $r4.Key)))

    # ---- 12. the measurement is the build now -------------------------------
    Fresh $v2
    $r12 = Run -WithoutLast
    Yes '12 -WithoutLast is not a switch any more, and stops before any tool runs' ($r12.Code -ne 0 -and $r12.Calls.Count -eq 0)

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
    # A runner that throws (Run-OnBox.ps1 refusing its artifact, #6351)
    # ended the build 1 with no STOP line, so the agent's status had no reason.
    Fresh $v2
    Put 'game/data/source.json' '{"v":4}'
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-am', 'source v4') | Out-Null
    $env:TS5191_THROW = 'Add-ContentRecords'
    $r5c = Run
    $env:TS5191_THROW = ''
    Yes '5 a runner that throws stops the run on a STOP line naming what it threw' (
        $r5c.Code -eq 1 -and @($r5c.Lines | Where-Object { $_ -match '^STOP\. the stand-in threw before it reached the box for scripts/mods/Add-ContentRecords\.py .*Nothing was kept\.$' }).Count -eq 1 -and -not $r5c.Key)
    # A step that ends other than 0 after saying why (Run-OnBox.ps1 says the
    # tool's last STOP line, or its last line, #6351) stops the build on a
    # STOP line that carries that reason, so the agent's status has it.
    Fresh $v2
    Put 'game/data/source.json' '{"v":5}'
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-am', 'source v5') | Out-Null
    $env:TS5191_FAIL = 'Add-ContentRecords'
    $env:TS5191_SAYS = "FileNotFoundError: [Errno 2] No such file or directory: 'recipes.json'."
    $r5d = Run
    $env:TS5191_FAIL = ''
    $env:TS5191_SAYS = ''
    $last5d = @($r5d.Lines | Where-Object { $_ -match '^STOP\. ' }) | Select-Object -Last 1
    Yes '5 a step that says why it stopped stops the build on a last STOP line carrying that reason' (
        $r5d.Code -eq 1 -and -not $r5d.Key -and
        $last5d -ceq "STOP. Add-ContentRecords.py ended with exit 3: FileNotFoundError: [Errno 2] No such file or directory: 'recipes.json'. The chain did not run and nothing was kept.")
    Yes '5   and what the step said is still shown, in its order' (
        @($r5d.Lines | Where-Object { $_ -ceq 'a line before' }).Count -eq 1 -and @($r5d.Lines | Where-Object { $_ -ceq 'the tool exited 3' }).Count -eq 1)

    # ---- 8. a revision that adds plugins ------------------------------------
    Fresh $v2
    Put 'records/collection.json' '{"collection":"abc","revision":4,"plugins":[{"name":"A.esm","master":true},{"name":"New.esp","master":false,"after":["B.esp"]},{"name":"B.esp","master":false},{"name":"M.esp","master":true},{"name":"Off.esp","master":false,"enabled":false}]}'
    Put 'records/collection-plugins.json' ('{"version":1,"collection":"abc","revision":4,"plugins":[{"name":"A.esm","size":12,"sha256":"' + ('0' * 64) + '"}]}')
    $env:TS5191_MOVED = 'the moved catalogue'
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-am', 'revision 4') | Out-Null
    $rev4 = (TGit @('rev-parse', 'HEAD')) -join ''
    $r8 = Run
    if ($r8.Code -ne 0) { Write-Host $r8.Text }
    Yes '8 a revision that adds plugins moves the order, and the catalogue runs in it between the plugin''s tool and the chain' (
        $r8.Code -eq 0 -and $r8.Calls.Count -eq 3 -and $r8.Calls[0] -like 'dev scripts/mods/Add-ContentRecords.py *' -and
        $r8.Calls[1] -eq 'dev scripts/dev/Build-NpcPopulation.py --settings {settings}' -and
        $r8.Calls[2] -like 'dev scripts/mods/Rebuild-ContentTables.ps1 *')
    Yes '8   and says what it adds' ($r8.Text -match 'revision 4, 11 plugins, moved from the 9 records\\load-order\.json records, adding M\.esp, New\.esp')
    $k8 = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $cache 'dev') $r8.Key) 'build.json')) | ConvertFrom-Json
    Yes '8   and keeps what the catalogue wrote' (
        [IO.File]::ReadAllText((Join-Path $out 'game/data/npc-population.json')) -eq 'the moved catalogue' -and
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

    # ---- 10. the stations, when the order moves ----------------------------
    $before = @(Get-ChildItem -LiteralPath (Join-Path $cache 'dev') -Directory | ForEach-Object { $_.Name } | Sort-Object) -join ','
    $r10 = Run -Stations
    if ($r10.Code -ne 0) { Write-Host $r10.Text }
    Yes '10 -Stations measures the stations first, then builds the plugin and runs the chain' (
        $r10.Code -eq 0 -and $r10.Calls.Count -ge 3 -and $r10.Calls[0] -eq 'dev scripts/dev/Build-StationSites.py --data {data}' -and
        $r10.Calls[1] -like 'dev scripts/mods/Add-ContentRecords.py *' -and $r10.Calls[-1] -like 'dev scripts/mods/Rebuild-ContentTables.ps1 *')
    Yes '10   over the tables of the newest build kept, and says which' (
        [IO.File]::ReadAllText((Join-Path $out 'game/data/station-sites.json')) -eq ('sites over table of plugin for dev from {"v":2}') -and
        ($r10.Lines -contains "MEASURED $($r8.Key)"))
    Yes '10   the plugin it hands back is built from the new sites' (
        [IO.File]::ReadAllText((Join-Path $out 'game/content/Thornswood-Content.esp')) -eq 'plugin for dev from {"v":2} with sites over table of plugin for dev from {"v":2}')
    Yes '10   and nothing is kept: the builds of the server are the ones before it' (
        (@(Get-ChildItem -LiteralPath (Join-Path $cache 'dev') -Directory | ForEach-Object { $_.Name } | Sort-Object) -join ',') -eq $before -and
        -not ($r10.Lines | Where-Object { $_ -match '^(BUILT|REUSED) ' }))
    Fresh $rev4
    Remove-Item -LiteralPath (Join-Path $cache 'main') -Recurse -Force
    $r10b = Run -Server main -Stations
    Yes '10 with no build of the server kept, -Stations stops before any tool runs' ($r10b.Code -ne 0 -and $r10b.Text -match 'no whole build of the main server is kept here' -and $r10b.Calls.Count -eq 0)
    Fresh $rev4

    # ---- 11. the order is load-order.json's, not a catalogue's --------------
    Fresh $rev4
    $other = '{"loadOrder":[' + ((@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'A.esm', 'B.esp', 'M.esp', 'New.esp', 'Thornswood-Content.esp', 'Thornswood-Last.esp') | ForEach-Object { '{"name":"' + $_ + '","sha256":"0"}' }) -join ',') + ']}'
    Put 'game/data/npc-population.json' $other
    $o11 = Get-ThornswoodContentOrder -Repo $co
    Yes '11 a catalogue in the checkout with another order moves nothing: the order is records\load-order.json''s, moved to the record' (
        ($o11.Names -join ',') -eq ($o8.Names -join ',') -and ($o11.Recorded -join ',') -eq 'Skyrim.esm,Update.esm,Dawnguard.esm,HearthFires.esm,Dragonborn.esm,A.esm,B.esp,Thornswood-Content.esp,Thornswood-Last.esp')
    Fresh $rev4

    # ---- 13. the files as git holds them, not as the checkout wrote them ----
    # The box's checkout has core.autocrlf true: a file whose eol=lf rule
    # came after its blob last changed stays CRLF there, and git calls it
    # clean (29e6a4c's CSVs, 16 Nov 2026). The build takes git's bytes.
    Fresh $rev4
    Put 'scripts/mods/content-tables.json' '{"steps":[{"tool":"scripts/dev/Build-X.js","reads":[],"writes":["game/data/x.json","game/gamemode-tables/X.json","docs/systems/lists","docs/SPOTS.csv"]}],"notInChain":[]}'
    Put 'docs/SPOTS.csv' "a,b`nc,d`n"
    TGit @('add', '--all') | Out-Null
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'spots') | Out-Null
    # The box's checkout writes it, then the rule comes in a commit that
    # leaves its blob alone.
    TGit @('config', 'core.autocrlf', 'true') | Out-Null
    Remove-Item -LiteralPath (Join-Path $co 'docs/SPOTS.csv')
    TGit @('checkout', '--', 'docs/SPOTS.csv') | Out-Null
    Put '.gitattributes' "*.csv text eol=lf`n"
    TGit @('add', '.gitattributes') | Out-Null
    TGit @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'the rule') | Out-Null
    $clean = ([IO.File]::ReadAllText((Join-Path $co 'docs/SPOTS.csv')) -eq "a,b`r`nc,d`r`n") -and -not @(TGit @('status', '--porcelain')).Count
    $r13 = Run
    TGit @('config', 'core.autocrlf', 'false') | Out-Null
    if ($r13.Code -ne 0) { Write-Host $r13.Text }
    $k13 = Join-Path (Join-Path (Join-Path $cache 'dev') $r13.Key) 'files/docs/SPOTS.csv'
    Yes '13 a file git holds LF whose checkout copy is CRLF, which git calls clean, is built' ($clean -and $r13.Code -eq 0 -and $r13.Key)
    Yes '13   and the build keeps it LF, as git holds it, and hands it back LF' (
        (Test-Path -LiteralPath $k13) -and [IO.File]::ReadAllText($k13) -eq "a,b`nc,d`n" -and
        [IO.File]::ReadAllText((Join-Path $out 'docs/SPOTS.csv')) -eq "a,b`nc,d`n")
    Fresh $rev4

    # ---- 9. records of two revisions ---------------------------------------
    Put 'records/collection-plugins.json' ('{"version":1,"collection":"abc","revision":5,"plugins":[{"name":"A.esm","size":12,"sha256":"' + ('0' * 64) + '"}]}')
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
