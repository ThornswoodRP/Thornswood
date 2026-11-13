<#
  test-4233-tests-cannot-pass-blind.ps1

      pwsh -NoProfile -File .\tests\test-4233-tests-cannot-pass-blind.ps1

  #4233. Tests of the collection and the mods that said SKIP and passed
  where the part they check went wrong, so that part could never fail. This
  runs each of them on a scratch folder where that part goes wrong and holds
  it to failing:
    1. test-bodies-retired.ps1, given a game folder whose female body cannot
       be read, or is not there: a failure, not a SKIP saying the body is
       still the nude one or that there is no game folder.
    2. test-third-party.js, given a Vortex mods folder with no Client Runtime
       in it, or an older one than THIRD-PARTY.md describes, and a launcher
       profile whose files.txt gives the collection no runtime file: each a
       failure, not a SKIP that leaves the runtime's files unread.
    3. test-collection-revision-2.ps1, given servers that do not answer: a
       failure naming each, not a SKIP; -Offline still leaves them out.
    4. test-skyui-menus.js, given a dev install (Where.ps1 InstallDev, so
       THORNSWOOD_INSTALL moves it) whose game folder has no SkyUI: a failure,
       not a SKIP for a folder it never looked in.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$Shell = Get-BoxPowerShell
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Lines([string]$out) { return @($out -split "\r?\n") }
function Any([string[]]$lines, [string]$rx) { return @($lines | Where-Object { $_ -match $rx }).Count -ge 1 }
function Show([string[]]$lines, [string]$rx) { $lines | Where-Object { $_ -match $rx } | Select-Object -First 4 | ForEach-Object { Write-Host ('      ' + $_) } }
Remove-Item Alias:Dir -Force
function Dir([string]$p) { [void][IO.Directory]::CreateDirectory($p); return $p }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4233-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$savedEnv = @{}
foreach ($n in @('THORNSWOOD_VORTEX_MODS', 'THORNSWOOD_PROFILE', 'THORNSWOOD_INSTALL')) { $savedEnv[$n] = [Environment]::GetEnvironmentVariable($n) }
try {
    # ---- 1. test-bodies-retired ------------------------------------------------
    $bodies = Join-Path $PSScriptRoot 'test-bodies-retired.ps1'
    $game = Join-Path $T 'Thornswood'
    $assets = Dir (Join-Path $game (Join-Path 'Game' (Join-Path 'Data' (Join-Path 'meshes' (Join-Path 'actors' (Join-Path 'character' 'character assets'))))))
    [IO.File]::WriteAllText((Join-Path $assets 'femalebody_1.nif'), 'this is not a nif')
    $out = & $Shell -NoProfile -NonInteractive -File $bodies -GameRoot $game 2>&1 | Out-String
    $code = $LASTEXITCODE
    $l = Lines $out
    Yes ('1. test-bodies-retired fails when the body check does not say covered (exit ' + $code + ')') ($code -ne 0)
    Yes '   with a FAIL line for the body in the game folder' (Any $l '^FAIL\s+.*female body')
    Yes '   and no SKIP saying the body is still the nude one' (-not (Any $l '^SKIP\s+.*nude'))
    if ($code -eq 0) { Show $l '^(SKIP|FAIL)' }

    Remove-Item -LiteralPath (Join-Path $assets 'femalebody_1.nif') -Force
    $out = & $Shell -NoProfile -NonInteractive -File $bodies -GameRoot $game 2>&1 | Out-String
    $code = $LASTEXITCODE
    $l = Lines $out
    Yes ('   a game folder with no female body in it fails too (exit ' + $code + ')') ($code -ne 0 -and (Any $l '^FAIL\s+.*femalebody_1\.nif'))
    Yes '   and is not called no game folder' (-not (Any $l '^SKIP\s+no game folder'))
    if ($code -eq 0) { Show $l '^(SKIP|FAIL)' }

    # ---- 2. test-third-party: the Client Runtime ---------------------------------
    $third = Join-Path $PSScriptRoot 'test-third-party.js'
    function Third([string]$mods, [string]$profile) {
        $env:THORNSWOOD_VORTEX_MODS = $mods
        $env:THORNSWOOD_PROFILE = $profile
        return Lines (& node $third 2>&1 | Out-String)
    }
    $emptyMods = Dir (Join-Path $T 'mods-empty')
    $l = Third $emptyMods (Join-Path $T 'no-profile')
    Yes '2. test-third-party fails where Vortex''s mods folder is here and holds no Client Runtime' (Any $l '^FAIL\s+.*Client Runtime.*mods-empty')
    Yes '   and does not skip it' (-not (Any $l '^SKIP\s+no copy of the Thornswood Client Runtime'))
    if (-not (Any $l '^FAIL\s+.*Client Runtime.*mods-empty')) { Show $l 'Client Runtime' }

    $oldMods = Join-Path $T 'mods-old'
    [void](Dir (Join-Path $oldMods (Join-Path 'Thornswood Client Runtime 192762 0.0.1 1700000000' (Join-Path 'Platform' 'Distribution'))))
    $profile = Join-Path $T 'Profile'
    [void](Dir (Join-Path $profile 'OwnGame'))
    [IO.File]::WriteAllText((Join-Path $profile (Join-Path 'OwnGame' 'files.txt')), "x|V|x|x|Data\Platform\Distribution\stand-in-4233.dll`n")
    $l = Third $oldMods $profile
    Yes '   an older Client Runtime than THIRD-PARTY.md describes fails, naming both versions' (Any $l '^FAIL\s+.*Client Runtime 0\.0\.1, older than the ')
    Yes '   and so does the files.txt comparison that reads the same runtime' (Any $l '^FAIL\s+.*files\.txt gives the collection.*0\.0\.1, older than the ')
    Yes '   with no SKIP for either' (-not (Any $l '^SKIP\s+.*older than the '))
    if (-not (Any $l '^FAIL\s+.*older than the ')) { Show $l 'older than the' }

    [IO.File]::WriteAllText((Join-Path $profile (Join-Path 'OwnGame' 'files.txt')), "x|V|x|x|Data\SKSE\Plugins\stand-in-4233.dll`n")
    $l = Third (Join-Path $T 'no-vortex') $profile
    Yes '   a files.txt that gives the collection no runtime file fails' (Any $l '^FAIL\s+.*files\.txt here gives the collection no file under Data\\Platform\\Distribution')
    Yes '   and does not skip it' (-not (Any $l '^SKIP\s+files\.txt here gives the collection no file'))
    Yes '   an explicitly requested Vortex folder that is absent fails too' (Any $l '^FAIL\s+.*no-vortex')
    $env:THORNSWOOD_VORTEX_MODS = $savedEnv['THORNSWOOD_VORTEX_MODS']
    $env:THORNSWOOD_PROFILE = $savedEnv['THORNSWOOD_PROFILE']

    # ---- 3. test-collection-revision-2: the servers --------------------------------
    $rev2 = Join-Path $PSScriptRoot 'test-collection-revision-2.ps1'
    # Nothing listens on these ports here: live on 9 asks 10, dev on 11 asks 12.
    $vps = Join-Path $T 'vps.json'
    [IO.File]::WriteAllText($vps, '{"address": "127.0.0.1", "livePort": 9, "devPort": 11}')
    $out = & $Shell -NoProfile -NonInteractive -File $rev2 -SourcesOnly -VpsPath $vps -Scratch (Dir (Join-Path $T 'rev2')) 2>&1 | Out-String
    $code = $LASTEXITCODE
    $l = Lines $out
    Yes ('3. test-collection-revision-2 fails when the servers do not answer (exit ' + $code + ')') ($code -ne 0)
    Yes '   with a FAIL naming the live server''s manifest' (Any $l '^FAIL\s+.*live server.*127\.0\.0\.1:10/')
    Yes '   and one naming the dev server''s' (Any $l '^FAIL\s+.*dev server.*127\.0\.0\.1:12/')
    Yes '   and no SKIP saying a manifest did not answer' (-not (Any $l '^SKIP\s+.*did not answer'))
    if ($code -eq 0 -or -not (Any $l '^FAIL\s+.*server')) { Show $l '(server|VpsPath|parameter)' }
    $out = & $Shell -NoProfile -NonInteractive -File $rev2 -VpsPath $vps -Offline -Scratch (Join-Path $T 'rev2') 2>&1 | Out-String
    $l = Lines $out
    Yes '   -Offline leaves the servers out, saying so' ((Any $l '^SKIP\s+the servers: -Offline') -and -not (Any $l '^FAIL\s+.*(live|dev) server'))
    Yes '   the fixture-only run passes its own page and plugin cases' ($LASTEXITCODE -eq 0)

    $settings = Join-Path $T 'settings.json'
    $record = Join-Path $T 'record.json'
    [IO.File]::WriteAllText($record, '{"lightPlugins":true}')
    $repo = Split-Path -Parent $PSScriptRoot
    $order = @([IO.File]::ReadAllLines((Join-Path $repo 'docs/COLLECTION-REVISION-2.md')) | ForEach-Object {
        if ($_ -match '^\|\s*\d+\s*\|\s*([^|]+?)\s*\|') { $Matches[1] }
    })
    $plugins = foreach ($name in $order) {
        $p = Join-Path (Dir (Join-Path $T 'plugins')) $name
        $b = New-Object byte[] 24
        [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
        [IO.File]::WriteAllBytes($p, $b)
        $p
    }
    [IO.File]::WriteAllText($settings, (@{loadOrder=@($plugins)} | ConvertTo-Json -Depth 4))
    $out = & $Shell -NoProfile -NonInteractive -File $rev2 -SourcesOnly -Offline -SettingsPath $settings -ServerRecordPath $record -Scratch (Join-Path $T 'rev2') 2>&1 | Out-String
    Yes '   built settings fixtures run the real full-plugin comparison' ($LASTEXITCODE -eq 0 -and (Any (Lines $out) '^PASS\s+the page.s order is the built server settings.s order'))
    [IO.File]::WriteAllText($settings, '{"loadOrder":[]}')
    $out = & $Shell -NoProfile -NonInteractive -File $rev2 -SourcesOnly -Offline -SettingsPath $settings -ServerRecordPath $record -Scratch (Join-Path $T 'rev2') 2>&1 | Out-String
    Yes '   settings with no load order fail rather than skip' ($LASTEXITCODE -ne 0 -and (Any (Lines $out) '^FAIL\s+the built server settings.*no load order'))
    [IO.File]::WriteAllText($settings, 'not JSON')
    $out = & $Shell -NoProfile -NonInteractive -File $rev2 -SourcesOnly -Offline -SettingsPath $settings -ServerRecordPath $record -Scratch (Join-Path $T 'rev2') 2>&1 | Out-String
    Yes '   unreadable settings fail with their path' ($LASTEXITCODE -ne 0 -and (Any (Lines $out) '^FAIL\s+the built server settings.*settings.json.*read'))

    # ---- 4. test-skyui-menus: the dev game folder ----------------------------------
    $env:THORNSWOOD_INSTALL = Join-Path $T 'inst'
    [void](Dir (Join-Path ($env:THORNSWOOD_INSTALL + '-DevBuild') (Join-Path 'Game' 'Data')))
    $l = Lines (& node (Join-Path $PSScriptRoot 'test-skyui-menus.js') 2>&1 | Out-String)
    Yes '4. test-skyui-menus looks in the dev install Where.ps1 names' (Any $l ([regex]::Escape($env:THORNSWOOD_INSTALL + '-DevBuild')))
    Yes '   and fails when its game folder has no SkyUI' (Any $l '^FAIL\s+.*dev game folder.*SkyUI_SE\.bsa')
    Yes '   with no SKIP for it' (-not (Any $l '^SKIP\s+.*dev game folder'))
    if (-not (Any $l '^FAIL\s+.*dev game folder')) { Show $l '(dev game|SKIP)' }
}
finally {
    foreach ($n in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($n, $savedEnv[$n]) }
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
