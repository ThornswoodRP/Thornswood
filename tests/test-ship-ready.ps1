<#
  test-ship-ready.ps1

      pwsh -NoProfile -File .\tests\test-ship-ready.ps1

  Whether Check-ShipReady.ps1 says NOT READY only for what would stop a Ship.
  Issue #946.

  WHY THIS EXISTS. On 28 Sep two dev Ships from fresh worktrees ran to the end
  and published, while Check-ShipReady -Channel dev said "NOT READY. 18 passed,
  1 in the way" for each, because engine\skymp was not a clone of the skymp
  fork. A Ship never builds the engine. What it needs of the client is the
  game folder holding the recorded build, which Sync-Client.ps1 -Check
  answers, or a build that matches the record for Go.ps1 to copy in. And
  Sync-Client itself stopped on "client build not found" before looking at the
  game folder, so a worktree with no build could not Ship even when the folder
  it packs was right.

  What it runs. The row functions out of Check-ShipReady.ps1, lifted by the
  PowerShell parser (New-Row, Get-ShipVerdict, Get-ClientRows,
  Get-MainOnlyRows), against a scratch record, game folder and build, with the
  real Sync-Client.ps1 answering:
    1. A fresh worktree: no engine\skymp at all, the recorded client in the
       game folder. READY.
    2. No matching client anywhere. NOT READY, and the fix names CI's build
       (Setup-ShipMachine -EngineBuild ci) and Sync-Client -Check -Dist, and
       never a rebuild, which cannot match a record (#3047).
    3. A matching build and a game folder that differs: READY, Ship copies it.
    4. A build that is not the recorded one: READY when the game folder holds
       the recorded client, NOT READY when it does not.
    5. The main-only row (the server build, issue #932): none on dev, WARN
       on main, and never a change to the verdict. The setup stub is not a
       row: a Ship builds no installer and sends no launcher (#4825).
    6. The script's own text: no row asks for the fork, stale plugins and
       required-data in the game folder are notes (Ship's Go.ps1 step copies
       them in before it checks), and the main-only rows are asked only when
       the channel is main.
    7. The checkout (issues #1254, #2981): asked what Ship asks, through
       Fresh-Checkout.ps1 with Ship's branch rule, on both channels, so an
       uncommitted change or a clone behind main is a gap on dev too.
    8. The release folder is a ship root, not an install (issue #2603).
       Get-LauncherRows: on main a folder with no launcher passes, saying
       the Ship puts the one CI built there itself, and no fix says to
       install Thornswood; on dev the Launcher folder, not the exe, is the
       need, as Ship asks it, but only of the install rule's folder: with
       the main launcher's dev build as the fix for <install>-DevBuild,
       where it installs, and recording a folder with Setup-ShipMachine for
       any other; since #2662 a folder named by -Root or recorded passes
       with no Launcher folder, as a dev Ship makes one there itself.
       The -Package launcher row went with the old installer (#4824).
       And the script's text: no "Install Thornswood from thornswood.net",
       no "press Play", and the game folder's fix is Update-ShipRoot alone:
       the animation and body files are built on each computer by the
       launcher since #3715, so nothing builds them in a ship root.

  Writes only to a temp folder of its own, and removes it.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Release = Join-Path (Split-Path -Parent $Here) 'scripts\release'
$Ready = Join-Path $Release 'Check-ShipReady.ps1'
$Sync = Join-Path $Release 'Sync-Client.ps1'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
    else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# ------------------------------------------------ the functions under test --
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Ready, [ref]$null, [ref]$errs)
Yes 'Check-ShipReady.ps1 parses' (@($errs).Count -eq 0)
$fns = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
foreach ($name in 'New-Row', 'Get-ShipVerdict', 'Get-ClientRows', 'Get-MainOnlyRows', 'Get-LauncherRows') {
    $f = @($fns | Where-Object { $_.Name -eq $name })
    Yes "Check-ShipReady.ps1 has $name" ($f.Count -eq 1)
    if ($f.Count -eq 1) { Invoke-Expression $f[0].Extent.Text }
}
if ($script:fail) { Write-Host "$($script:pass) passed, $($script:fail) failed"; exit 1 }
# What Get-MainOnlyRows holds a server build with, which Check-ShipReady.ps1
# dot-sources.
. (Join-Path (Split-Path -Parent $Here) 'scripts\deploy\ServerBuild.ps1')

function Sha([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Put([string]$root, [string]$rel, [string]$text) {
    $p = Join-Path $root $rel
    $d = Split-Path -Parent $p
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText($p, $text)
}
function Fresh([string]$p) {
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $p | Out-Null
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-ship-ready-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    # A record for two files, written from their bytes.
    $client = @{ 'Data\Platform\Plugins\skymp5-client.js' = 'the recorded bundle'; 'Data\Scripts\TESModPlatform.pex' = 'the recorded pex' }
    $proto = Join-Path $tmp 'proto'
    $files = [ordered]@{}
    foreach ($rel in $client.Keys) {
        Put $proto $rel $client[$rel]
        $files[$rel] = [ordered]@{ sha256 = (Sha (Join-Path $proto $rel)); bytes = (Get-Item -LiteralPath (Join-Path $proto $rel)).Length }
    }
    $record = Join-Path $tmp 'client-build.json'
    ([ordered]@{ forkCommit = 'abcdef12'; forkBranch = 'thornswood/engine-changes'; recordedUtc = '2026-09-28T00:00:00Z'; files = $files } |
        ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $record -Encoding UTF8

    $game = Join-Path $tmp 'Game'
    $dist = Join-Path $tmp 'worktree\engine\skymp\build\dist\client'   # never made unless a case makes it

    function Set-Game([string]$how) {
        Fresh $game
        if ($how -eq 'empty') { return }
        foreach ($rel in $client.Keys) { Put $game $rel $client[$rel] }
        if ($how -eq 'wrong') { Put $game 'Data\Platform\Plugins\skymp5-client.js' 'another launcher''s bundle' }
    }
    function Set-Dist([string]$how) {
        $top = Join-Path $tmp 'worktree\engine'
        if (Test-Path -LiteralPath $top) { Remove-Item -LiteralPath $top -Recurse -Force }
        if ($how -eq 'none') { return }
        foreach ($rel in $client.Keys) { Put $dist $rel $client[$rel] }
        if ($how -eq 'wrong') { Put $dist 'Data\Scripts\TESModPlatform.pex' 'a pex from an edited engine' }
    }
    function Client-Rows { return @(Get-ClientRows $Sync $record $game $dist) }
    function Client-Row { return @(Client-Rows | Where-Object { $_.What -like 'the recorded client*' })[0] }

    # ------------------------------------------------ 1. a fresh worktree --
    Set-Game 'recorded'; Set-Dist 'none'
    $global:LASTEXITCODE = 0
    & $Sync -Check -NoPause -Game $game -Dist $dist -Record $record 6>$null | Out-Null
    Yes '1. Sync-Client -Check answers 0 with no build, when the game folder holds the recorded client' ($LASTEXITCODE -eq 0)
    $global:LASTEXITCODE = 0
    & $Sync -NoPause -Game $game -Dist $dist -Record $record 6>$null | Out-Null
    Yes '1. Sync-Client without -Check (what Go.ps1 runs) answers 0 as well, and copies nothing' ($LASTEXITCODE -eq 0)
    $rows = Client-Rows
    Yes '1. the client rows all pass with no engine\skymp at all' (@($rows | Where-Object { -not $_.Ok }).Count -eq 0)
    Yes '1. and there are two: the record and the client' ($rows.Count -eq 2)
    $v = Get-ShipVerdict $rows
    Yes '1. the verdict is READY' ($v.Ready)
    # The script keeps its rows in a List, and @() over one threw "Argument
    # types do not match" the first time this ran for real.
    $list = New-Object Collections.Generic.List[object]
    foreach ($r in $rows) { $list.Add($r) }
    $v = $null
    try { $v = Get-ShipVerdict $list } catch { Write-Host ('      threw: ' + $_.Exception.Message) -ForegroundColor Red }
    Yes '1. and the same from the List the script keeps its rows in' ($null -ne $v -and $v.Ready -and $v.Passed -eq 2)

    # --------------------------------------------- 2. no matching client --
    Set-Game 'wrong'; Set-Dist 'none'
    $global:LASTEXITCODE = 0
    & $Sync -Check -NoPause -Game $game -Dist $dist -Record $record 6>$null | Out-Null
    Yes '2. Sync-Client -Check answers 1 with no build and a game folder that is not the recorded client' ($LASTEXITCODE -eq 1)
    $r = Client-Row
    Yes '2. the client row fails' (-not $r.Ok)
    Yes '2. and it is a need, not a warn' ($r.Level -eq 'need')
    Yes '2. it says the build was not found and the game folder is not right' ($r.Detail -match 'client build not found' -and $r.Detail -match '1 of 2 in place')
    Yes '2. the fix says how to check a candidate, and to take CI''s build of the pin, not a rebuild (#3047)' (
        $r.Fix -match 'Sync-Client\.ps1 -Check -Dist' -and $r.Fix -match 'Setup-ShipMachine\.ps1 -EngineBuild ci' -and $r.Fix -notmatch 'Build-Engine')
    Yes '2. the verdict is NOT READY' (-not (Get-ShipVerdict (Client-Rows)).Ready)

    Set-Game 'empty'; Set-Dist 'none'
    Yes '2. an empty game folder and no build is NOT READY too' (-not (Get-ShipVerdict (Client-Rows)).Ready)

    # ------------------------------------- 3. a build Ship copies in itself --
    Set-Game 'wrong'; Set-Dist 'recorded'
    $r = Client-Row
    Yes '3. a matching build with a game folder that differs passes (Go.ps1 copies it in)' ($r.Ok)
    Yes '3. and says Ship copies it' ($r.Detail -match 'Ship copies it in')
    Set-Game 'empty'; Set-Dist 'recorded'
    Yes '3. so does a matching build with nothing in the game folder yet' ((Client-Row).Ok)

    # ------------------------------------ 4. a build that is not recorded --
    Set-Game 'recorded'; Set-Dist 'wrong'
    Yes '4. a stale build does not matter when the game folder holds the recorded client' ((Client-Row).Ok)
    Set-Game 'wrong'; Set-Dist 'wrong'
    $r = Client-Row
    Yes '4. a stale build and a game folder that differs fail' (-not $r.Ok)
    Yes '4. saying the build is not the recorded one' ($r.Detail -match 'not the recorded one')

    # No game folder: only the record is asked, and nothing runs.
    $rows = @(Get-ClientRows $Sync $record '' $dist)
    Yes 'no game folder: only the record row' ($rows.Count -eq 1 -and $rows[0].Ok)
    $rows = @(Get-ClientRows $Sync (Join-Path $tmp 'nothing.json') $game $dist)
    Yes 'no record: the record row fails as a need' ($rows.Count -eq 1 -and -not $rows[0].Ok -and $rows[0].Level -eq 'need')

    # -------------------------------------------------- 5. main-only rows --
    $srv = Join-Path $tmp 'engine\skymp\build\dist\server'
    $payload = Join-Path $tmp 'out\_payload'
    # Every server file the record holds (ServerBuild.ps1, #1214), the binary
    # saying which server it is.
    function Put-Server([string]$dir, [string]$binary) {
        Put $dir 'scam_native.node' $binary
        foreach ($rel in 'dist_back\skymp5-server.js', 'dist_back\skymp5-server.js.map', 'package.json', 'yarn.lock', 'launch_server.bat', 'data\scripts\A.pex') { Put $dir $rel ('the recorded ' + $rel) }
    }
    Put-Server $payload 'the recorded server'
    $srvFiles = [ordered]@{}
    foreach ($rel in 'scam_native.node', 'dist_back/skymp5-server.js', 'dist_back/skymp5-server.js.map', 'package.json', 'yarn.lock', 'launch_server.bat', 'data/scripts/A.pex') {
        $srvFiles[$rel] = [ordered]@{ sha256 = (Sha (Join-Path $payload $rel)); bytes = 1; commit = 'abcdef0123456789abcdef0123456789abcdef01' }
    }
    $srvRecord = Join-Path $tmp 'server-build.json'
    ([ordered]@{ binary = 'scam_native.node'; sha256 = (Sha (Join-Path $payload 'scam_native.node')); source = @{ commit = 'abcdef0123456789abcdef0123456789abcdef01' }; files = $srvFiles } | ConvertTo-Json -Depth 5) |
        Set-Content -LiteralPath $srvRecord -Encoding UTF8
    function Main-Rows([string]$chan) { return @(Get-MainOnlyRows $chan $srvRecord @($srv, $payload)) }

    Yes '5. dev asks for none of the main-only rows' (@(Main-Rows 'dev').Count -eq 0)

    $m = @(Main-Rows 'main')
    Yes '5. main asks for the server build only: the setup stub comes from CI (#932)' ($m.Count -eq 1 -and @($m | Where-Object { $_.What -like '*setup stub*' }).Count -eq 0)
    Yes '5. and it is a warning' (@($m | Where-Object { $_.Level -ne 'warn' }).Count -eq 0)
    $b = @($m | Where-Object { $_.What -like '*server build*' })[0]
    Yes '5. the server row fails when only out\_payload matches' (-not $b.Ok)
    Yes '5. naming the folder that does match' ($b.Detail.Contains($payload + ' does'))
    Yes '5. and says to pass a scratch copy of it as -Dist' ($b.Fix -match 'scratch' -and $b.Fix -match '-Dist')

    Set-Game 'recorded'; Set-Dist 'none'
    $v = Get-ShipVerdict (@(Client-Rows) + $m)
    Yes '5. a fresh worktree on main with the warning is still READY' ($v.Ready)
    Yes '5. and lists the one warning' ($v.Warns.Count -eq 1)

    Put-Server $srv 'the recorded server'
    $m = @(Main-Rows 'main')
    Yes '5. a matching server build passes' (@($m | Where-Object { -not $_.Ok }).Count -eq 0)

    # The binary right and the JavaScript half from another build (#1214).
    Put $srv 'dist_back\skymp5-server.js' 'a JavaScript half from 24 Sep'
    $b = @(Main-Rows 'main' | Where-Object { $_.What -like '*server build*' })[0]
    Yes '5. a server build whose JavaScript half is another build''s does not match' (-not $b.Ok -and $b.Detail.Contains($payload + ' does'))
    Put $srv 'dist_back\skymp5-server.js' 'the recorded dist_back\skymp5-server.js'

    Put $srv 'scam_native.node' 'an edited server'
    Put $payload 'scam_native.node' 'another edited server'
    $b = @(Main-Rows 'main' | Where-Object { $_.What -like '*server build*' })[0]
    Yes '5. no matching server build anywhere fails, pointing at CI''s build, not a rebuild (#3047)' (-not $b.Ok -and $b.Fix -match '-EngineBuild ci' -and $b.Fix -notmatch 'Build-Engine')

    # A record that does not read (#2711): it was read in a try with an empty
    # catch, and then every build "did not match" and the fix named a build.
    $srvRecordWas = [IO.File]::ReadAllText($srvRecord)
    [IO.File]::WriteAllText($srvRecord, '{ "binary": "scam_native.node", ')
    $m = @(Main-Rows 'main')
    $b = @($m | Where-Object { $_.What -like '*record reads*' })[0]
    Yes '5. a server record that does not read is its own row, saying why' ($m.Count -eq 1 -and $b -and -not $b.Ok -and $b.Detail -match 'does not read: ' -and $b.Level -eq 'warn')
    Yes '5. and its fix is the record, not a build' ($b.Fix -match 'records\\server-build\.json' -and $b.Fix -notmatch 'Build-Engine')
    [IO.File]::WriteAllText($srvRecord, $srvRecordWas)

    # ------------------------------------------------- 6. the script's text --
    $text = Get-Content -LiteralPath $Ready -Raw
    Yes '6. no row asks whether the skymp fork is cloned' ($text -notmatch "Ready\s+'the skymp fork")
    Yes '6. no row asks which branch the fork is on' ($text -notmatch "Ready\s+'the fork is on")
    # Ship runs Go.ps1 before it checks either, and Go.ps1 copies both in.
    Yes '6. stale plugins in the game folder are a note, not a gap' ($text -notmatch "Ready\s+'the game folder holds this source")
    Yes '6. stale required-data in the game folder is a note, not a gap' ($text -notmatch "Ready\s+'the game folder holds required-data")
    Yes '6. the main-only rows are asked only when the channel is not dev' ($text -match '(?s)if \(-not \$Dev\) \{\s*Head [^\n]*\n\s*foreach \(\$r in @\(Get-MainOnlyRows')
    Yes '6. the verdict is Get-ShipVerdict''s, and exit 1 follows it' ($text -match '\$verdict = Get-ShipVerdict \$script:rows' -and $text -match 'if \(-not \$verdict\.Ready\) \{ exit 1 \}')

    # A main Ship has refused uncommitted work since 22 Sep (f917dd8), and
    # every Ship, dev too, since #2118 put Fresh-Checkout.ps1 in front of it.
    # On 20 Oct this map still called it a note on dev and said READY two
    # minutes before a dev Ship refused (#2981). So the checkout is asked
    # what Ship asks, with the -AnyBranch Ship passes, on both channels.
    # tests\test-2981-update-checkout.ps1 runs it against a scratch clone.
    Yes '7. the checkout is asked Fresh-Checkout''s question, with the branch rule Ship uses' (
        $text -match '\$fresh = Get-FreshCheckoutState -RepoDir \$RepoDir -AnyBranch:\(Test-FreshAnyBranch -RepoDir \$RepoDir -Channel \$Channel\)' -and
        $text -match 'foreach \(\$r in @\(Get-CheckoutRows \$fresh\)\) \{ Show-Row \$r \}')
    Yes '7. and not only on main: it is outside the channel test' (
        $text -notmatch '(?s)if \(\$Dev\) \{[^}]*Get-FreshCheckoutState' -and $text -notmatch '(?s)\} else \{[^}]*Get-FreshCheckoutState')
    Yes '7. it no longer says a dev Ship builds from uncommitted changes' (
        $text -notmatch 'A dev Ship builds from those changes as they are')
    Yes '7. it no longer says a main Ship commits uncommitted changes' (
        $text -notmatch 'commits them when it is out')

    # ------------------------------- 8. a ship root, not an install (#2603) --
    # Main: local\release-main on 16 Oct, Game, Profile and config.json and no
    # Launcher folder, was NOT READY on "a launcher is installed".
    $mainRoot = Join-Path $tmp 'release-main'
    Fresh $mainRoot
    New-Item -ItemType Directory -Force -Path (Join-Path $mainRoot 'Game') | Out-Null
    $r = @(Get-LauncherRows 'main' $mainRoot)
    Yes '8. main, no Launcher folder: one row, and it passes' ($r.Count -eq 1 -and $r[0].Ok)
    Yes '8.   it is a need row, so it counts as passed, not as a warning' ($r[0].Level -eq 'need')
    Yes '8.   it says a main Ship puts the launcher CI built there itself' ($r[0].Detail -match 'none yet' -and $r[0].Detail -match 'CI built' -and $r[0].Detail -match 'its own install step')
    Yes '8.   and no fix line, least of all installing Thornswood' (-not $r[0].Fix)
    Yes '8.   the verdict with it alone is READY' ((Get-ShipVerdict $r).Ready)
    Put $mainRoot 'Launcher\Thornswood.exe' 'a launcher'
    $r = @(Get-LauncherRows 'main' $mainRoot)
    Yes '8. main, a launcher there: passes, naming it and saying a Ship that builds one replaces it' (
        $r[0].Ok -and $r[0].Detail.Contains((Join-Path $mainRoot 'Launcher\Thornswood.exe')) -and $r[0].Detail -match 'replaces')

    # Dev: Ship asks for the Launcher folder, not the exe.
    $mainInstall = Join-Path $tmp 'Thornswood'
    $devRoot = $mainInstall + '-DevBuild'
    Fresh $devRoot
    $r = @(Get-LauncherRows 'dev' $devRoot)
    Yes '8. dev, no Launcher folder: a need that fails, as a dev Ship stops' ($r.Count -eq 1 -and -not $r[0].Ok -and $r[0].Level -eq 'need')
    Yes '8.   saying a dev Ship stops on it' ($r[0].Detail -match 'No dev build at')
    Yes '8.   <install>-DevBuild with no main launcher beside it: the fix says so, and offers recording a folder of your own' (
        $r[0].Fix -notmatch 'Settings, The dev build' -and $r[0].Fix.Contains('no main launcher is installed at ' + $mainInstall) -and
        $r[0].Fix -match 'Setup-ShipMachine\.ps1 -Channel dev -Root <folder>' -and $r[0].Fix -notmatch '#2662')
    Put $mainInstall 'Launcher\Thornswood.exe' 'the main launcher'
    $r = @(Get-LauncherRows 'dev' $devRoot)
    Yes '8.   with the main install beside it: that launcher''s dev build, naming both folders' (
        $r[0].Fix -match ('^In the main launcher installed at ' + [regex]::Escape($mainInstall) + ':') -and $r[0].Fix.Contains('into ' + $devRoot))
    # One's dev root ends in -devbuild too, and no main launcher is beside it.
    $relDev = Join-Path $tmp 'local\release-devbuild'
    Fresh $relDev
    $r = @(Get-LauncherRows 'dev' $relDev)
    Yes '8. dev, a ship root like local\release-devbuild with no Launcher folder, as the install rule''s answer, fails the same' (-not $r[0].Ok)
    Yes '8.   and its fix is not the main launcher''s dev build, which installs elsewhere, but recording the folder' (
        $r[0].Fix -notmatch 'Settings, The dev build' -and $r[0].Fix -match 'Setup-ShipMachine\.ps1 -Channel dev -Root <folder>' -and $r[0].Fix -notmatch '#2662')
    $r = @(Get-LauncherRows 'dev' (Join-Path $tmp 'release-dev'))
    Yes '8.   a folder not ending in -DevBuild names no main install' ($r[0].Fix -notmatch 'installed at' -and $r[0].Fix -match 'Setup-ShipMachine')
    # #2662: the same folder named by -Root or recorded in ship-roots.json is
    # a ship root Update-ShipRoot.ps1 made, and a dev Ship makes its Launcher
    # folder itself.
    $r = @(Get-LauncherRows 'dev' $relDev $true)
    Yes '8. dev, a named ship root with no Launcher folder: one need row, and it passes' ($r.Count -eq 1 -and $r[0].Ok -and $r[0].Level -eq 'need')
    Yes '8.   saying the Ship''s launcher step makes it, and no fix line' (
        $r[0].Detail -match 'none yet in' -and $r[0].Detail -match 'its launcher step makes it' -and -not $r[0].Fix -and $r[0].Detail -notmatch 'No dev build at')
    Yes '8.   the verdict with it alone is READY' ((Get-ShipVerdict $r).Ready)
    Yes '8.   named or not, <install>-DevBuild with no Launcher folder passes only when named' (
        (@(Get-LauncherRows 'dev' $devRoot $true))[0].Ok -and -not (@(Get-LauncherRows 'dev' $devRoot $false))[0].Ok)
    Yes '8.   main is the same named or not' ((@(Get-LauncherRows 'main' $mainRoot $true))[0].Ok -and (@(Get-LauncherRows 'main' $mainRoot))[0].Ok)
    New-Item -ItemType Directory -Force -Path (Join-Path $relDev 'Launcher') | Out-Null
    $r = @(Get-LauncherRows 'dev' $relDev)
    Yes '8. dev, an empty Launcher folder passes: Ship asks for the folder, and builds and puts the exe there' ($r[0].Ok -and $r[0].Detail -eq (Join-Path $relDev 'Launcher'))
    Put $devRoot 'Launcher' 'a file, not a folder'
    Yes '8. dev, a file named Launcher is not the folder' (-not (@(Get-LauncherRows 'dev' $devRoot))[0].Ok)
    Yes '8. no folder known: the dev row fails, the main row still passes' (
        -not (@(Get-LauncherRows 'dev' ''))[0].Ok -and (@(Get-LauncherRows 'main' ''))[0].Ok)
    Yes '8.   and named makes no difference to a folder that is not known' (-not (@(Get-LauncherRows 'dev' '' $true))[0].Ok)

    # The script's text.
    Yes '8. no fix says to install Thornswood from thornswood.net' ($text -notmatch 'Install Thornswood from thornswood\.net')
    Yes '8. no fix says to open the launcher and press Play' ($text -notmatch 'press Play')
    Yes '8. the old row is gone' ($text -notmatch "Ready 'a launcher is installed'")
    Yes '8. the game folder''s fix is Update-ShipRoot, with -SkyrimFrom named, and no Build-Generated (#3715)' (
        $text -match "(?s)Ready 'it has its own game folder'.{0,400}Update-ShipRoot\.ps1 -Channel.{0,300}-SkyrimFrom" -and $text -notmatch 'Build-Generated' -and $text -notmatch 'Get-GeneratedRows')
    Yes '8. the launcher row is asked of the folder Ship would build from' ($text -match 'foreach \(\$r in @\(Get-LauncherRows \$Channel \$Root \$rootNamed\)\) \{ Show-Row \$r \}')
    Yes '8. no row asks for a launcher for -Package any more (#4824)' ($text -notmatch 'Get-PackageLauncherRows' -and $text -notmatch '-Package')
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
