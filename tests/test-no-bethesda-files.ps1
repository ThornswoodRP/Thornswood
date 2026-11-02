<#
  test-no-bethesda-files.ps1

  No file of Bethesda's is ever packed or named in a release record: not the game, not its Creation Kit, not a copy of one of its
  programs. And no backup either. Issue #1152.

  WHY THIS EXISTS. On 29 September the dev record the feed named
  (20260929-0259-dev) listed 2,515 files of ours, and about 180 MB of them were
  Bethesda's: CreationKit.exe and its settings, the Tools, Papyrus Compiler and
  lex folders, flowchartx64.dll, flowchartx32.dll, p4com64.dll, 1,785 files
  under Data\DialogueViews, Data\Scripts.zip, and SkyrimSE.exe.bak-1160-for-369,
  a copy of Skyrim itself. Main pack 20260926-1603 carried the Creation Kit and
  the copy of the game. Steam puts the Creation Kit in the Steam copy, the
  launcher's own folder took it from there, and a file Vortex did not deploy
  counted as ours.

  The Creation Kit's script sources joined them on 29 September (#1227): the
  Creation Kit unpacks Data\Scripts.zip into Data\Source\Scripts, 14,298 files
  on the shipping machine that Thornswood's own folder took as its own.
  Data\Source and Data\Scripts\Source are the Creation Kit's source folders and
  never ship, whoever's sources are in them; Thornswood's own Papyrus sources
  live in the repository (the engine fork) and only their compiled scripts
  reach a game.

  What this holds, each against the real code:
    1. Ship-Rules: every path of that measurement is never shipped and never
       listed as removed; the game's own files too; any backup; the files of
       ours beside them still ship.
    2. The measured record itself, where this machine has it
       (%LOCALAPPDATA%\Thornswood\feed\dev\published.json): every Creation Kit
       entry in it is caught, and none of Data\Platform is.
    3. Check-Secrets, which reads every pack and a first record before
       anything is sent: a pack carrying any of them fails, by rule name. The
       old installer, its own scan and its stage went with it (#4824); the
       setup's game files are the feed's packs and client runtime.
    4. Publish-Update's record guard and Rollback-Feed's filter, each lifted out
       of the shipped script between its markers and run.
    5. The launcher: OwnGame.BethesdaTool, lifted and compiled with the
       compiler the build runs (Add-LauncherType, tests\Launcher-Csc.ps1,
       #2821; off Windows that part says SKIP), agrees with
       Ship-Rules on every path, finds exactly those files in a scratch folder,
       Refresh drops them, and Rules moved so every folder refreshes once.

  Read only apart from its own scratch folder. Never connects to anything.
#>
[CmdletBinding()]
param([string]$Record, [string]$OwnGameList = (Join-Path ([string](& (Join-Path $PSScriptRoot '..\scripts\release\Where.ps1') Install)) 'Profile\OwnGame\files.txt'))
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$RulesPath   = Join-Path $Repo 'scripts\release\Ship-Rules.ps1'
$PublishPath = Join-Path $Repo 'scripts\release\Publish-Update.ps1'
$RollPath    = Join-Path $Repo 'scripts\release\Rollback-Feed.ps1'
$SecretsPath = Join-Path $Repo 'scripts\dev\Check-Secrets.ps1'
$OwnGamePath = Join-Path $Repo 'launcher\app\OwnGame.cs'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's compiler and C# version (#2821)
# The dev baseline where Publish-Update keeps it on this machine: Where.ps1's
# ReleasesDev, which LOCALAPPDATA (set only on Windows) no longer has to name.
if (-not $Record) { $Record = Join-Path (& (Join-Path $Repo 'scripts\release\Where.ps1') ReleasesDev) 'published.json' }

$script:pass = 0
$script:fail = 0
$script:skip = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { $script:skip++; Write-Host "SKIP  $what" }
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed, {2} skipped" -f $script:pass, $script:fail, $script:skip)
    if ($script:fail) { exit 1 }
    exit 0
}

. $RulesPath

# ---- 1. Ship-Rules ----------------------------------------------------------
#
# One path of each kind the dev record of 29 September carried, by its own name.
$bethesda = @(
    'CreationKit.exe', 'CreationKit.ini', 'CreationKitPrefs.ini', 'CreationKitCustom.ini',
    'flowchartx64.dll', 'flowchartx32.dll', 'p4com64.dll',
    'EditorWarnings.txt', 'DataFiles.txt', 'SkyrimReservedAddOnIndexes.txt',
    'Tools\AssetWatcher\AssetWatcher.exe', 'Tools\redist\VC_redist.x64.exe', 'Tools\RoboVoicer.exe',
    'Tools\LipGen\LipGenerator\FonixData.cdf', 'Tools\HavokBehaviorPostProcess\HavokBehaviorPostProcess.exe',
    'Papyrus Compiler\PapyrusCompiler.exe', 'Papyrus Compiler\ScriptCompile.bat',
    'lex\ssceam.tlx', 'lex\User\userdic.tlx',
    'Data\DialogueViews\0001A2A8.xml', 'Data\Scripts.zip',
    'SkyrimSE.exe.bak-1160-for-369', 'SkyrimSE.exe.1170', 'SkyrimSELauncher.exe.old', 'skse64_loader.exe.bak',
    # The Creation Kit's script sources (#1227): what it unpacks from
    # Data\Scripts.zip, the same folder under its older name, and what mods put
    # beside them. The game reads none of them.
    'Data\Source\Scripts\Actor.psc', 'Data\Source\Scripts\TESV_Papyrus_Flags.flg',
    'Data\Source\Scripts\PlayerVampireQuestScript.psc', 'Data\Source\Textures\Telvanni_BodyColor2.tga',
    'Data\Scripts\Source\Actor.psc', 'Data\Scripts\Source\IED.psc', 'data\source\scripts\game.PSC'
)
foreach ($rel in $bethesda) {
    Yes "$rel is Bethesda's" (Test-ShipBethesdaTool $rel)
    Yes '  never shipped and never listed as removed' (Test-ShipMachine $rel)
    Yes '  never swept off anybody as a runtime file' (-not (Test-ShipRuntime $rel))
}
Yes 'none of them is on the list every pack deletes' (@($bethesda | Where-Object { @(Get-ShipDeleteAlways) -contains $_ }).Count -eq 0)
Yes 'the Creation Kit rule matches in any case' ((Test-ShipBethesdaTool 'creationkit.EXE') -and (Test-ShipBethesdaTool 'data\dialogueviews\x.xml'))

# The game itself was never shipped, and still is not.
foreach ($rel in @('SkyrimSE.exe', 'SkyrimSELauncher.exe', 'steam_api64.dll', 'Data\Skyrim.esm', 'Data\Update.esm',
                   'Data\Skyrim - Textures0.bsa', 'Data\ccBGSSSE001-Fish.esm', 'Data\MarketplaceTextures.bsa',
                   'Data\Strings\skyrim_english.strings', '_DowngraderBackups\SkyrimSE.exe')) {
    Yes "$rel, the game's own, is never shipped" (Test-ShipMachine $rel)
}

# Any backup, anywhere, never ships and is never removed.
foreach ($rel in @('VERSION.bak', 'Data\SKSE\Plugins\SkyrimPlatform.ini.bak',
                   'Data\SKSE\Plugins\SkyrimPlatform.ini.2026-09-19T20-17-00-253Z.bak',
                   'plugins.txt.bak-elysium-20260927-000739', 'Data\textures\x.dds.bak.1')) {
    Yes "$rel is a backup, never shipped and never removed" ((Test-ShipBackup $rel) -and (Test-ShipMachine $rel) -and -not (Test-ShipRuntime $rel))
}

# One person's face tint, which the same record carried, is runtime.
Yes 'a face tint RaceMenu exported is written at runtime and never shipped' (Test-ShipRuntime 'Data\textures\CharGen\Exported\Adventurer3424.dds')

# The files of ours beside them still ship: the rules are anchored.
foreach ($rel in @('Data\Thornswood-Content.esp', 'Data\Platform\UI\index.html', 'Data\Platform\Plugins\thornswood-front.js',
                   'Data\Platform\UI\thornswood-bake.js', 'Data\meshes\interface\logo\logo.nif',
                   'Data\textures\interface\objects\Mainmenuwallpaper.dds', 'Data\music\special\mus_maintheme.xwm',
                   'Data\meshes\tools\hammer.nif', 'Data\DialogueViewsExtra\x.xml', 'Data\textures\CreationKitLogo.dds',
                   'Data\Scripts\bakery.pex', 'Data\SKSE\Plugins\Tools.ini',
                   'Data\Scripts\Source.pex', 'Data\SourceArt\x.dds', 'Data\textures\Source\x.dds', 'Data\meshes\Scripts\Source\x.nif')) {
    Yes "$rel is not taken for Bethesda's or a backup" (-not (Test-ShipBethesdaTool $rel) -and -not (Test-ShipBackup $rel) -and -not (Test-ShipMachine $rel))
}

# Everything the Creation Kit installs, read on 29 September from the two
# Steam depots of the Steam copy's Creation Kit (app 1946180, depots 1946182
# and 1946183, build 24601472): 56 files. Each one is Bethesda's here.
$ckInstall = @(
    'CreationKit.exe', 'CreationKit.ini', 'Data\Scripts.zip', 'flowchartx32.dll', 'flowchartx64.dll', 'p4com64.dll',
    'SkyrimReservedAddOnIndexes.txt',
    'lex\accent.tlx', 'lex\ssceam.tlx', 'lex\ssceam2.clx', 'lex\sscebr.tlx', 'lex\sscebr2.clx', 'lex\ssceca.tlx',
    'lex\ssceca2.clx', 'lex\tech.tlx', 'lex\User\correct.tlx', 'lex\User\userdic.tlx',
    'Papyrus Compiler\antlr.runtime.dll', 'Papyrus Compiler\Antlr3.Runtime.dll', 'Papyrus Compiler\Antlr3.Utility.dll',
    'Papyrus Compiler\PapyrusAssembler.exe', 'Papyrus Compiler\PapyrusCompiler.exe', 'Papyrus Compiler\PCompiler.dll',
    'Papyrus Compiler\ScriptCompile.bat', 'Papyrus Compiler\StringTemplate.dll',
    'Tools\Archive\Archive.exe', 'Tools\ArtTools\Blender\bgs_skyrim_tools.zip', 'Tools\ArtTools\Blender\io_scene_bsfbx_skyrim.zip',
    'Tools\AssetWatcher\AssetWatcher.exe', 'Tools\AssetWatcher\platforms\qminimal.dll', 'Tools\AssetWatcher\platforms\qoffscreen.dll',
    'Tools\AssetWatcher\platforms\qwindows.dll', 'Tools\AssetWatcher\Plugins\Skyrim\BSFBXDLL.dll',
    'Tools\AssetWatcher\Plugins\Skyrim\Meshes_Settings.json', 'Tools\AssetWatcher\Qt5Core.dll', 'Tools\AssetWatcher\Qt5Gui.dll',
    'Tools\AssetWatcher\Qt5Network.dll', 'Tools\AssetWatcher\Qt5Svg.dll', 'Tools\AssetWatcher\Qt5Widgets.dll',
    'Tools\AssetWatcher\SettingsGeneration.py', 'Tools\AssetWatcher\styles\Default.css',
    'Tools\AssetWatcher\styles\qwindowsvistastyle.dll', 'Tools\Audio\xwmaencode.exe', 'Tools\Elric\xg.dll',
    'Tools\Elric\xtexconv.exe', 'Tools\Exporting Blender Art Assets for Skyrim.pdf',
    'Tools\HavokBehaviorPostProcess\HavokBehaviorPostProcess.exe', 'Tools\HavokBehaviorPostProcess\readme.txt',
    'Tools\HavokBehaviorPostProcess\UpgradeHavokBehavior.bat', 'Tools\LipGen\LipFuzer\LIPFuzer.exe',
    'Tools\LipGen\LipFuzer\LIPFuzer.txt', 'Tools\LipGen\LipGenerator\FonixData.cdf', 'Tools\LipGen\LipGenerator\LipGenerator.exe',
    'Tools\redist\dxwebsetup.exe', 'Tools\redist\VC_redist.x64.exe', 'Tools\RoboVoicer.exe'
)
Yes ('the Creation Kit install list has all {0} of its files' -f $ckInstall.Count) ($ckInstall.Count -eq 56)
$ckMissed = @($ckInstall | Where-Object { -not ((Test-ShipBethesdaTool $_) -and (Test-ShipMachine $_)) })
Yes 'every file the Creation Kit installs is Bethesda''s and never shipped or removed' ($ckMissed.Count -eq 0)
foreach ($m in $ckMissed) { Write-Host "      not caught: $m" }

# Thornswood's own Papyrus sources are never in a game folder, so nothing of
# ours is under the two source folders: what the repository hands a game
# (game\) carries no .psc. Ours are the engine fork's and stay in engine\skymp.
$gameSrc = Join-Path $Repo 'game'
$ownPsc = @(Get-ChildItem -LiteralPath $gameSrc -Recurse -File -Filter '*.psc' -ErrorAction SilentlyContinue)
Yes 'the repository''s game folder carries no Papyrus source of ours' ($ownPsc.Count -eq 0)

# The folder the shipping machine's launcher made, where it is here: every
# script source it holds is caught, and nothing else of Data\Scripts is.
if ($OwnGameList -and (Test-Path -LiteralPath $OwnGameList)) {
    $rels = @(Get-Content -LiteralPath $OwnGameList | ForEach-Object { $p = $_.Split('|'); if ($p.Count -ge 5) { $p[4] } })
    $src = @($rels | Where-Object { $_ -like 'Data\Source\*' -or $_ -like 'Data\Scripts\Source\*' })
    Write-Host ("      the folder's list: {0:n0} files, {1:n0} of them script sources" -f $rels.Count, $src.Count)
    if ($src.Count) {
        Yes ('every one of its {0:n0} script sources is caught' -f $src.Count) (@($src | Where-Object { -not (Test-ShipBethesdaTool $_) }).Count -eq 0)
    } else { Skip 'this folder''s list has no script sources left to measure' }
    $pex = @($rels | Where-Object { $_ -like 'Data\Scripts\*.pex' -and $_ -notlike 'Data\Scripts\Source\*' })
    Yes ('and none of its {0} compiled scripts is' -f $pex.Count) (@($pex | Where-Object { Test-ShipBethesdaTool $_ }).Count -eq 0)
} else {
    Skip "no list of Thornswood's own folder at $OwnGameList to measure against"
}

# ---- 2. the measured record ---------------------------------------------------
if (Test-Path -LiteralPath $Record) {
    $map = ((Get-Content -LiteralPath $Record -Raw) -replace '^﻿', '') | ConvertFrom-Json
    $keys = @($map.PSObject.Properties.Name | Where-Object { -not $_.StartsWith(':') })
    # What #1152 counted as the Creation Kit: everything at the game's root, the
    # dialogue views and the script sources archive.
    $ck = @($keys | Where-Object { $_.IndexOf('\') -lt 0 -or $_ -like 'Tools\*' -or $_ -like 'Papyrus Compiler\*' -or $_ -like 'lex\*' -or $_ -like 'Data\DialogueViews\*' -or $_ -eq 'Data\Scripts.zip' })
    $caught = @($ck | Where-Object { Test-ShipMachine $_ })
    $ckBytes = [int64]0; foreach ($k in $ck) { $ckBytes += [int64](([string]$map.$k).Split(':')[0]) }
    Write-Host ("      the record: {0:n0} files of ours, {1:n0} of them at the root or the Creation Kit's ({2:n1} MB)" -f $keys.Count, $ck.Count, ($ckBytes / 1MB))
    if ($ck.Count) {
        Yes ('every one of those {0:n0} is caught' -f $ck.Count) ($caught.Count -eq $ck.Count)
        foreach ($m in @($ck | Where-Object { -not (Test-ShipMachine $_) } | Select-Object -First 5)) { Write-Host "      not caught: $m" }
    } else { Skip 'this record has no Creation Kit files left to measure' }
    # The five dev records the feed lists on 29 September name Data\Scripts\Source\IED.psc,
    # and the file went up to the site loose (#1227).
    $srcKeys = @($map.PSObject.Properties.Name | ForEach-Object { if ($_.StartsWith(':gone:')) { $_.Substring(6) } elseif (-not $_.StartsWith(':')) { $_ } } |
                 Where-Object { $_ -like 'Data\Source\*' -or $_ -like 'Data\Scripts\Source\*' })
    if ($srcKeys.Count) {
        Yes ('all {0} script sources it names are caught' -f $srcKeys.Count) (@($srcKeys | Where-Object { -not (Test-ShipMachine $_) }).Count -eq 0)
    } else { Skip 'this record names no script sources to measure' }
    $platform = @($keys | Where-Object { $_ -like 'Data\Platform\*' })
    Yes ('and none of its {0} Data\Platform files is' -f $platform.Count) (@($platform | Where-Object { (Test-ShipBethesdaTool $_) -or (Test-ShipBackup $_) }).Count -eq 0)
} else {
    Skip "no dev record at $Record to measure against"
}

# ---- 3. Check-Secrets, over a pack ---------------------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-nobethesda-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-Zip([string]$path, [string[]]$entries) {
    $z = [IO.Compression.ZipFile]::Open($path, 'Create')
    try {
        foreach ($e in $entries) {
            $s = $z.CreateEntry($e).Open()
            try { $b = [Text.Encoding]::ASCII.GetBytes('x'); $s.Write($b, 0, $b.Length) } finally { $s.Dispose() }
        }
    } finally { $z.Dispose() }
}
$ps = (Get-Process -Id $PID).Path
# Check-Secrets writes a hit as a GitHub annotation when GITHUB_ACTIONS is
# true, which it is under the nightly on the VPS, and these checks read the
# form a person sees. test-check-secrets.ps1 checks the annotation form.
function Invoke-Secrets([string[]]$argv) {
    $savedActions = $env:GITHUB_ACTIONS
    $env:GITHUB_ACTIONS = ''
    try { $out = & $ps -NoProfile -File $SecretsPath @argv 2>&1 | Out-String; $code = $LASTEXITCODE }
    finally { $env:GITHUB_ACTIONS = $savedActions }
    return [pscustomobject]@{ Code = $code; Out = $out }
}
try {
    $bad = Join-Path $tmp 'pack-bad.zip'
    New-Zip $bad @('game/CreationKit.exe', 'game/SkyrimSE.exe.bak-1160-for-369', 'game/Data/DialogueViews/0001A2A8.xml',
                   'game/Tools/RoboVoicer.exe', 'game/SkyrimSE.exe', 'game/Data/SKSE/Plugins/SkyrimPlatform.ini.bak')
    $r = Invoke-Secrets @('-Zip', $bad)
    Yes 'a pack carrying the Creation Kit or a copy of the game fails' ($r.Code -eq 1)
    Yes '  naming the Creation Kit by rule' ($r.Out.Contains('game/CreationKit.exe:0  never-ship-bethesda'))
    Yes '  and the copy of the game' ($r.Out.Contains('game/SkyrimSE.exe.bak-1160-for-369:0  never-ship-bethesda'))
    Yes '  and its dialogue views and tools' ($r.Out.Contains('game/Data/DialogueViews/0001A2A8.xml:0  never-ship-bethesda') -and $r.Out.Contains('game/Tools/RoboVoicer.exe:0  never-ship-bethesda'))
    Yes '  and the game itself' ($r.Out.Contains('game/SkyrimSE.exe:0  never-ship-bethesda'))
    Yes '  and a backup' ($r.Out.Contains('SkyrimPlatform.ini.bak:0  never-ship-backup'))

    # The three main packs of 15 September carried 62 of these under
    # Data\Scripts\Source (#1227).
    $src = Join-Path $tmp 'pack-sources.zip'
    New-Zip $src @('game/Data/Source/Scripts/Actor.psc', 'game/Data/Scripts/Source/SKSE.psc', 'game/Data/Platform/Plugins/thornswood-front.js')
    $r = Invoke-Secrets @('-Zip', $src)
    Yes 'a pack carrying the Creation Kit''s script sources fails' ($r.Code -eq 1)
    Yes '  naming both source folders by rule' ($r.Out.Contains('game/Data/Source/Scripts/Actor.psc:0  never-ship-bethesda') -and $r.Out.Contains('game/Data/Scripts/Source/SKSE.psc:0  never-ship-bethesda'))
    Yes '  and not the plugin of ours beside them' (-not $r.Out.Contains('thornswood-front.js:0'))

    $good = Join-Path $tmp 'pack-good.zip'
    New-Zip $good @('game/Data/Platform/Plugins/thornswood-front.js', 'game/Data/meshes/interface/logo/logo.nif')
    $r = Invoke-Secrets @('-Zip', $good)
    Yes 'a pack of ours alone passes' ($r.Code -eq 0)

    $pc = Join-Path $tmp 'pack-compiler.zip'
    New-Zip $pc @('game/Papyrus Compiler/PapyrusCompiler.exe')
    $r = Invoke-Secrets @('-Zip', $pc)
    Yes 'a pack carrying the Papyrus compiler fails' ($r.Code -eq 1 -and $r.Out.Contains('never-ship-bethesda'))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# The packs leave them out by the rule, and are read by Check-Secrets before
# anything leaves.
$pub = Get-Content -LiteralPath $PublishPath -Raw
Yes 'the packs'' scan asks Test-Machine' ($pub -match 'if \(Test-Machine \$rel\) \{ continue \}')
Yes '  and every pack goes through Check-Secrets' ($pub -match "Check-Secrets\.ps1'\) -Zip \`$scanZips")

# ---- 4. the record guard and the rollback filter ------------------------------
function Get-Block([string]$src, [string]$name) {
    $a = $src.IndexOf("# ==== thornswood $name ====")
    $b = $src.IndexOf("# ==== end thornswood $name ====")
    if ($a -lt 0 -or $b -le $a) { return $null }
    return $src.Substring($a, $b - $a)
}
$guard = Get-Block $pub 'no bethesda in the record'
Yes 'the record guard is in Publish-Update.ps1' ($null -ne $guard)
if ($guard) {
    $at = $pub.IndexOf('# ==== thornswood no bethesda in the record ====')
    Yes '  inside the record files block, before anything is sent' ($at -gt $pub.IndexOf('# ==== thornswood record files ====') -and $at -lt $pub.IndexOf('$recordFiles = @()'))
    function Die($m) { throw "STOP $m" }
    function Invoke-Guard($map) {
        $now = $map
        try { Invoke-Expression $guard; return '' } catch { return $_.Exception.Message }
    }
    $clean = @{ 'Data\Platform\UI\index.html' = '1:aa'; ':gone:Data\Interface\map.swf' = 'always'; ':order:plugins' = 'x' }
    Yes '  a record of ours alone goes through' ((Invoke-Guard $clean) -eq '')
    foreach ($k in @('CreationKit.exe', 'SkyrimSE.exe.bak-1160-for-369', 'Data\DialogueViews\1.xml', 'SkyrimSE.exe', 'VERSION.bak', ':gone:Tools\RoboVoicer.exe',
                     'Data\Source\Scripts\Actor.psc', 'Data\Scripts\Source\IED.psc', ':gone:Data\Scripts\Source\SKSE.psc',
                     # Bethesda's archive a pack once carried, as a file and as gone (#1229).
                     'Data\MarketplaceTextures.bsa', ':gone:Data\MarketplaceTextures.bsa')) {
        $m = @{} + $clean; $m[$k] = '1:bb'
        $why = Invoke-Guard $m
        Yes "  a record naming $k stops the release" ($why -like 'STOP*Bethesda*')
    }
}
$roll = Get-Content -LiteralPath $RollPath -Raw
$filter = Get-Block $roll 'no bethesda in a rollback'
Yes 'the rollback filter is in Rollback-Feed.ps1' ($null -ne $filter)
Yes '  which reads Ship-Rules' ($roll -match "\. \(Join-Path \`$Here 'Ship-Rules\.ps1'\)")
if ($filter) {
    Yes '  and runs before the new record is worked out' ($roll.IndexOf('# ==== thornswood no bethesda in a rollback ====') -lt $roll.IndexOf('$newMap = @{}'))
    function Say($m, $c) { }
    $curMap = @{ 'Data\Platform\UI\index.html' = '1:aa'; 'CreationKit.exe' = '2:bb'; ':gone:lex\ssceam.tlx' = 'removed'; ':profile:plugins.txt' = 'x' }
    $curMap[':gone:Data\Source\Scripts\Game.psc'] = 'removed'
    $curMap[':gone:Data\MarketplaceTextures.bsa'] = 'removed'
    $tgtMap = @{ 'Data\Platform\UI\index.html' = '1:cc'; 'SkyrimSE.exe.bak-1160-for-369' = '3:dd'; 'Data\DialogueViews\1.xml' = '4:ee';
                 'Data\Scripts\Source\IED.psc' = '5:ff'; 'Data\Scripts\MpClientPlugin.pex' = '6:aa'; 'Data\MarketplaceTextures.bsa' = '7:bb' }
    Invoke-Expression $filter
    Yes '  going back to an old record hands none of them out' (-not $tgtMap.ContainsKey('SkyrimSE.exe.bak-1160-for-369') -and -not $tgtMap.ContainsKey('Data\DialogueViews\1.xml'))
    Yes '  nor a script source a record of 29 September names' (-not $tgtMap.ContainsKey('Data\Scripts\Source\IED.psc'))
    Yes '  nor MarketplaceTextures.bsa, Bethesda''s archive a pack once carried (#1229)' (-not $tgtMap.ContainsKey('Data\MarketplaceTextures.bsa'))
    Yes '  and going forward lists none of them as gone' (-not $curMap.ContainsKey('CreationKit.exe') -and -not $curMap.ContainsKey(':gone:lex\ssceam.tlx') -and -not $curMap.ContainsKey(':gone:Data\Source\Scripts\Game.psc') -and -not $curMap.ContainsKey(':gone:Data\MarketplaceTextures.bsa'))
    Yes '  while the files of ours and the plugin list stay' ($curMap.ContainsKey('Data\Platform\UI\index.html') -and $tgtMap.ContainsKey('Data\Platform\UI\index.html') -and $curMap.ContainsKey(':profile:plugins.txt') -and $tgtMap.ContainsKey('Data\Scripts\MpClientPlugin.pex'))
    Yes ('  and it says how many it left out ({0})' -f $notOurs) ($notOurs -eq 8)
}

# ---- 4b. one Bethesda question for all three (#1229) --------------------------
# Check-Secrets, the record guard and the rollback filter all ask
# Test-ShipBethesda, which is the three rules together, so they cannot drift.
$one = @('Data\MarketplaceTextures.bsa', 'CreationKit.exe', 'Data\Scripts\Source\IED.psc', 'SkyrimSE.exe', 'Data\Skyrim.esm',
         'Data\Platform\UI\index.html', 'Data\textures\MarketplaceTextures.bsa', 'VERSION.bak')
Yes 'Test-ShipBethesda is the vanilla, Creation Kit and left alone rules together, path for path' (
    @($one | Where-Object { [bool](Test-ShipBethesda $_) -ne [bool]((Test-ShipBethesdaTool $_) -or (Test-ShipVanilla $_) -or (Test-ShipBethesdaLeftAlone $_)) }).Count -eq 0)
Yes '  and it names MarketplaceTextures.bsa and not a file of ours' ((Test-ShipBethesda 'Data\MarketplaceTextures.bsa') -and -not (Test-ShipBethesda 'Data\Platform\UI\index.html'))
$sec = Get-Content -LiteralPath $SecretsPath -Raw
Yes 'Check-Secrets asks it' ($sec -match "if \(Test-ShipBethesda \`$rel\) \{ Write-Hit \`$where \`$key '0' 'never-ship-bethesda'")
Yes 'the record guard asks it' ($null -ne $guard -and $guard -match 'Test-ShipBethesda \$_\)' -and $guard -notmatch 'Test-ShipBethesdaTool')
Yes 'the rollback filter asks it' ($null -ne $filter -and $filter -match 'Test-ShipBethesda \$p\)' -and $filter -notmatch 'Test-ShipBethesdaTool')

# ---- 5. the launcher --------------------------------------------------------
$og = [IO.File]::ReadAllText($OwnGamePath)
function Get-CsMember([string]$text, [string]$signature) {
    $at = $text.IndexOf($signature)
    if ($at -lt 0) { return $null }
    $i = $text.IndexOf('{', $at)
    $depth = 0
    while ($i -lt $text.Length) {
        $c = $text[$i]
        if ($c -eq '"') { $i++; while ($i -lt $text.Length -and $text[$i] -ne '"') { if ($text[$i] -eq '\') { $i++ }; $i++ } }
        elseif ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i + 1 - $at) } }
        $i++
    }
    return $null
}
$lift = [ordered]@{
    Dirs  = Get-CsMember $og 'static readonly string[] BethesdaToolDirs ='
    Files = Get-CsMember $og 'static readonly string[] BethesdaToolFiles ='
    Test  = Get-CsMember $og 'static bool BethesdaTool(string rel)'
    In    = Get-CsMember $og 'static List<string> BethesdaToolsIn(string folder)'
}
$missing = @($lift.Keys | Where-Object { -not $lift[$_] })
Yes 'OwnGame has BethesdaTool, its two lists and BethesdaToolsIn to lift' ($missing.Count -eq 0)
if ($missing.Count) { Done }
$ns = 'TsNoBethesda' + $PID
$cs = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
namespace $ns
{
    public static class Swallow { public static void Note(string where, Exception e) { } }
    public static class OwnGame
    {
        $($lift.Dirs);
        $($lift.Files);
        public $($lift.Test)
        public $($lift.In)
    }
}
"@
$compiled = $false
if (-not $OnWindows) {
    Skip 'BethesdaTool and BethesdaToolsIn, compiled and asked: their compiler is the Roslyn csc that comes with Visual Studio''s Build Tools, which only Windows has'
}
else {
    try { $null = Add-LauncherType -Source $cs; $compiled = $true } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'and they compile as lifted, with the compiler the build runs' $compiled
}
if ($compiled) {
    $T = [type]($ns + '.OwnGame')
    $twins = @($bethesda) + @('SkyrimSE.exe', 'SkyrimSELauncher.exe', 'skse64_loader.exe',
        'Data\Thornswood-Content.esp', 'Data\Platform\UI\index.html', 'Data\meshes\tools\hammer.nif',
        'Data\DialogueViewsExtra\x.xml', 'Data\textures\CreationKitLogo.dds', 'Data\SKSE\Plugins\Tools.ini',
        'Data\Scripts\Source.pex', 'Data\SourceArt\x.dds', 'Data\textures\Source\x.dds', 'Data\meshes\Scripts\Source\x.nif', 'Data\Scripts\IED.pex') + @($ckInstall)
    $apart = @($twins | Where-Object { [bool]$T::BethesdaTool($_) -ne [bool](Test-ShipBethesdaTool $_) })
    Yes ('OwnGame.BethesdaTool and Test-ShipBethesdaTool agree on all {0} paths' -f $twins.Count) ($apart.Count -eq 0)
    # The game opens MarketplaceTextures.bsa by name, so Thornswood's own folder
    # keeps it as the game's file while packs and records never carry it (#1229).
    Yes 'OwnGame keeps MarketplaceTextures.bsa, which the game opens by name, while Ship-Rules never ships it' (
        -not [bool]$T::BethesdaTool('Data\MarketplaceTextures.bsa') -and (Test-ShipBethesda 'Data\MarketplaceTextures.bsa'))
    foreach ($a in $apart) { Write-Host "      they disagree on $a" }

    $game = Join-Path ([IO.Path]::GetTempPath()) ('ts-nobethesda-game-' + $PID)
    try {
        $plant = @('CreationKit.exe', 'SkyrimSE.exe.bak-1160-for-369', 'p4com64.dll', 'Tools\Archive\Archive.exe',
                   'Papyrus Compiler\PapyrusCompiler.exe', 'lex\User\correct.tlx', 'Data\DialogueViews\0001.xml', 'Data\Scripts.zip',
                   'Data\Source\Scripts\Actor.psc', 'Data\Source\Scripts\TESV_Papyrus_Flags.flg', 'Data\Scripts\Source\SKSE.psc')
        $ours = @('SkyrimSE.exe', 'Data\Thornswood-Content.esp', 'Data\Platform\UI\index.html', 'Data\meshes\tools\hammer.nif',
                  'Data\Scripts\IED.pex', 'Data\Scripts\Source.pex')
        foreach ($p in $plant + $ours) {
            $f = Join-Path $game $p
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f) | Out-Null
            [IO.File]::WriteAllText($f, 'x')
        }
        $found = @($T::BethesdaToolsIn($game) | ForEach-Object { $_.Substring($game.Length + 1) })
        Yes ('BethesdaToolsIn finds all {0} planted in a game folder' -f $plant.Count) (@($plant | Where-Object { $found -notcontains $_ }).Count -eq 0)
        Yes '  and nothing of ours' (@($ours | Where-Object { $found -contains $_ }).Count -eq 0)
        Yes '  each once' ($found.Count -eq $plant.Count)
    } finally {
        Remove-Item -LiteralPath $game -Recurse -Force -ErrorAction SilentlyContinue
    }
}
$skipCs = Get-CsMember $og 'static string Skip(string rel)'
Yes 'OwnGame.Skip leaves them out of the folder' ($skipCs -match 'if \(BethesdaTool\(rel\)\) return "')
$refresh = Get-CsMember $og 'static string RefreshNow(Config cfg, Action<string> say)'
Yes 'Refresh drops them from a folder that has them' ($null -ne $refresh -and $refresh -match 'foreach \(string dest in BethesdaToolsIn\(Folder\)\)\s*\{\s*try \{ if \(File\.Exists\(dest\)\) \{ DropName\(dest\); removed\+\+; \} \}')
$rulesNum = [regex]::Match($og, '(?m)^\s*const int Rules = (\d+);')
$rulesDoc = [regex]::Match($og, "(?m)^\s*/// (\d+): Bethesda's Creation Kit")
Yes 'Rules moved for it, so every folder already made refreshes once and drops them' (
    $rulesNum.Success -and $rulesDoc.Success -and [int]$rulesNum.Groups[1].Value -ge [int]$rulesDoc.Groups[1].Value)
$rulesSrc = [regex]::Match($og, "(?m)^\s*/// (\d+): the Creation Kit's script sources")
Yes 'and moved again for the script sources (#1227), past the Creation Kit''s number' (
    $rulesNum.Success -and $rulesSrc.Success -and $rulesDoc.Success -and
    [int]$rulesNum.Groups[1].Value -ge [int]$rulesSrc.Groups[1].Value -and [int]$rulesSrc.Groups[1].Value -gt [int]$rulesDoc.Groups[1].Value)

Done
