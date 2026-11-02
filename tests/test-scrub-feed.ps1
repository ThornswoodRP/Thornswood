<#
  test-scrub-feed.ps1

      pwsh -NoProfile -File .\tests\test-scrub-feed.ps1

  Scrub-Feed.ps1 takes Bethesda's files and one machine's own files out of
  what the feeds already published, and every kind of install still ends with
  the right files (#1152, #1227, #1229, #1239). A run stopped right after it
  sent the feed leaves the next run knowing what to delete (#1244).

  WHY THIS EXISTS. Main packs on the site carried the Creation Kit, a copy of
  SkyrimSE.exe and the script extender's script sources, and the dev records
  named them and a loose script source. Patrick, 29 September: take them off
  the site, and rebuild what needs rebuilding so no install breaks. This proves
  it with the real pieces, on a stand-in site (-SiteDir) served by a copy of
  site\server.js:

    1. a main feed and a dev feed shaped like the real ones: main packs on both
       (the dev feed lists them by their /feed/assets urls, and /feed-dev/assets
       holds copies), a dev pack, and three dev records (two that say their
       files are up, one from before that, naming the Creation Kit)
    2. installs made BEFORE the scrub by the launcher's own Updater, built
       from launcher\app\Thornswood.csproj the way the build builds it
       (tests\Launcher-Csc.ps1, Add-LauncherAssembly): one that replayed
       every main pack, one synced to the dev record
    3. the real Scrub-Feed.ps1: a dry run changes nothing; dev, then main; every
       pack keeps its id and every other entry byte for byte; records keep every
       other key; the store's baselines follow; the old bytes are deleted only
       once no feed names them; a second run does nothing
    4. installs AFTER it: a fresh one replaying every main pack, the one that
       already applied them (nothing fetched again), the one synced to the dev
       record (checks, fetches nothing, removes a matching other-author copy #1261), a fresh dev install
       and an old launcher replaying the dev feed's packs
    5. the real Rollback-Feed.ps1 going back a release on the scrubbed dev feed
    6. the delete refuses when a feed moved, and keeps what a feed still names

  One machine's files ride beside Bethesda's in the same packs and records
  (#1239): key binds, a Vortex record, a report a session left, an expired
  voice token and join pass, a face tint, settings saved from a mod's menu, a
  backup, and delete lines naming a face export and the report. They go, the
  delete line every release carries on purpose (voice-token.txt) stays, and a
  folder entry for Data\Platform, whose folders are ours, stays.

  Runs in pwsh 7 on every machine with the .NET 10 SDK (#4823): the launcher
  is loaded into this PowerShell, which runs on .NET 10 as it does, and
  Scrub-Feed and Rollback-Feed run in a child pwsh, as on the shipping
  machine. The installs, 2 and 4 and the install that follows the rollback,
  say SKIP off Windows: Updater.Install and the sync lay the game folder out
  by Windows paths (game\Data\...), which only Windows has. Every check of
  the site, the feeds, the records and the scripts runs everywhere. Needs
  node on PATH. Everything it writes is in its own temp folder, and nothing
  connects anywhere but 127.0.0.1.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's SDK and settings (#4823), and $OnWindows

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
# Scrub-Feed and Rollback-Feed run in a pwsh of their own, as on the shipping machine.
$child = (Get-Process -Id $PID).Path

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
# What an install ends with: checked on Windows, where Updater.Install and the
# sync lay the game folder out by the paths a pack and a record carry
# (game\Data\...); said as SKIP elsewhere.
function Yes-Install([string]$what, [scriptblock]$cond) {
    if ($OnWindows) { Yes $what ([bool](& $cond)) }
    else { Write-Host "SKIP  $what (Updater.Install and the sync write the game folder by Windows paths, which only Windows has)" }
}
$script:procs = @()
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-scrub-feed-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
function Done {
    foreach ($p in $script:procs) { try { if (-not $p.HasExited) { $p.Kill() } } catch { } }
    Start-Sleep -Milliseconds 300
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
trap { $script:fail++; Write-Host ("FAIL  stopped: " + $_.Exception.Message + ' ' + $_.InvocationInfo.PositionMessage) -ForegroundColor Red; Done }

. (Join-Path $repo 'scripts\release\Release-Baseline.ps1')
. (Join-Path $repo 'scripts\release\Feed-Store.ps1')
. (Join-Path $repo 'scripts\release\Ship-Rules.ps1')
Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
$ascii = New-Object Text.ASCIIEncoding
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Read-Json([string]$path) { return (([IO.File]::ReadAllText($path)) -replace '^﻿', '') | ConvertFrom-Json }
function Free-Port { $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0); $l.Start(); $p = $l.LocalEndpoint.Port; $l.Stop(); return $p }
# The port came from the system and was let go, so another run beside this one
# can take it before the child binds it, the fault #1727 fixed in the .js
# harnesses (#1755). Nothing asks the port anything until the child itself has
# said on its output that it is listening there. A child that closes its output
# first has stopped, and EADDRINUSE on its errors means something else holds
# the port. $err is the task already draining the child's errors. Answers ''
# once the line has come, otherwise why it did not.
function Wait-OwnLine($proc, $err, [string]$mark, [int]$port, [string]$what) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $seen = New-Object 'System.Collections.Generic.List[string]'
    while ($true) {
        $left = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        $read = $proc.StandardOutput.ReadLineAsync()
        if (-not $read.Wait($left)) { return ('{0} did not say it was listening on port {1} within 20 seconds' -f $what, $port) }
        $got = $read.Result
        if ($null -eq $got) {
            [void]$proc.WaitForExit(5000)
            $said = ''
            if ($err.Wait(5000)) { $said = ([string]$err.Result).Trim() }
            $code = '?'
            if ($proc.HasExited) { $code = $proc.ExitCode }
            if ($said -match 'EADDRINUSE') {
                return ('something else already holds port {0}, so {1} stopped (exit {2}) before it was listening' -f $port, $what, $code)
            }
            return ('{0} stopped (exit {1}) before it was listening: {2} {3}' -f $what, $code, ($seen -join ' '), $said)
        }
        $seen.Add($got)
        if ($got.StartsWith($mark + ' listening on ') -and $got.EndsWith(':' + $port)) {
            # Drained from here on, so a chatty child never blocks on a full pipe.
            $null = $proc.StandardOutput.ReadToEndAsync()
            return ''
        }
    }
}

$node = Get-Command node -ErrorAction SilentlyContinue
Yes 'node is on PATH, for the copy of the site' ($null -ne $node)
if ($null -eq $node) { Done }

# ---- the launcher, built --------------------------------------------------------------
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }
New-Item -ItemType Directory -Force -Path $T | Out-Null
$asm = $null
try { $asm = Add-LauncherAssembly }
catch {
    Yes 'the launcher project builds' $false
    foreach ($l in @(($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 10)) { Write-Host "      $l" }
    Done
}
Yes 'the launcher project builds' ($null -ne $asm)
$U = $asm.GetType('Thornswood.Updater'); $P = $asm.GetType('Thornswood.Paths'); $VD = $asm.GetType('Thornswood.VersionDoc')
$flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
$mPending = $U.GetMethod('Pending', $flags); $mInstall = $U.GetMethod('Install', $flags); $mSync = $U.GetMethod('Sync', $flags)
$mParse = $VD.GetMethod('Parse', $flags)
Yes 'Updater.Pending, Updater.Install, Updater.Sync and VersionDoc.Parse are in the build' (
    $null -ne $mPending -and $null -ne $mInstall -and $null -ne $mSync -and $null -ne $mParse)
if ($null -eq $mSync) { Done }
$cfg = [Activator]::CreateInstance($asm.GetType('Thornswood.Config'))
$script:said = New-Object System.Collections.Generic.List[string]
$log = [Action[string]] { param($m) $script:said.Add([string]$m) }

# ---- the site ----------------------------------------------------------------------
$site = Join-Path $T 'site'
$fa = Join-Path $site 'feed\assets'; $da = Join-Path $site 'feed-dev\assets'
New-Item -ItemType Directory -Force -Path $fa, $da | Out-Null
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
Copy-SiteProgram -To $site -App (Join-Path $repo 'site')
$sitePort = Free-Port
# The game check knocks on port 1 (#1816). The system never hands that port
# out for a listen on 0 and no harness listens on a fixed port
# (test-1703-test-ports.js), so no run beside this one can take it and make
# the game read as up. A port taken from the system and let go could be.
Put (Join-Path $site 'config.json') (@{
    password = ''; secret = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')); botKey = ''; gameCheckPort = 1
    onlineFile = (Join-Path $site 'online.json')
    discord = @{ clientId = ''; clientSecret = ''; botToken = ''; guildId = ''; invite = '' }
} | ConvertTo-Json -Depth 4)
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = $node.Source; $psi.Arguments = '"server.js"'; $psi.WorkingDirectory = $site
$psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$psi.EnvironmentVariables['THORNSWOOD_DOCS_PORT'] = [string]$sitePort
$psi.EnvironmentVariables['THORNSWOOD_DOCS_LOCAL'] = '1'
$psi.EnvironmentVariables['THORNSWOOD_CHAT_DIR'] = (Join-Path $site 'chat')
$sp = [Diagnostics.Process]::Start($psi); $spErr = $sp.StandardError.ReadToEndAsync()
$script:procs += $sp
$siteUrl = "http://127.0.0.1:$sitePort"

# ---- what the feeds already published ----------------------------------------------
function Sha-Text([string]$s) { return Get-BaselineStreamSha (New-Object IO.MemoryStream(, $ascii.GetBytes($s))) }
function Entry-Of([string]$s) { return ('{0}:{1}' -f $ascii.GetBytes($s).Length, (Sha-Text $s)) }
$stamp = [DateTimeOffset]::new(2026, 9, 15, 20, 18, 0, [TimeSpan]::Zero)
# A pack: name to text, in this order; a name ending in / is a folder entry.
function New-Pack([string]$path, [object[]]$entries) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    $z = [IO.Compression.ZipFile]::Open($path, 'Create')
    try {
        for ($i = 0; $i -lt $entries.Count; $i += 2) {
            $e = $z.CreateEntry([string]$entries[$i])
            $e.LastWriteTime = $stamp.AddMinutes($i)
            $s = $e.Open()
            try { $b = $ascii.GetBytes([string]$entries[$i + 1]); $s.Write($b, 0, $b.Length) } finally { $s.Dispose() }
        }
    } finally { $z.Dispose() }
    return (Get-BaselineFileSha $path)
}
function Put-Asset([string]$dir, [string]$file) { $sha = Get-BaselineFileSha $file; Copy-Item -LiteralPath $file -Destination (Join-Path $dir $sha) -Force; return $sha }
function Put-Text([string]$dir, [string]$text) { $sha = Sha-Text $text; [IO.File]::WriteAllText((Join-Path $dir $sha), $text, $ascii); return $sha }

$src = Join-Path $T 'src'
# Main pack A (15 Sep): ours, and the script extender's sources beside them.
# And one machine's own: its key binds, Vortex's record of its deployment, and a
# report a session left in the game folder, with that folder's own entry.
$A = @('game/Data/Platform/UI/ours.esp', 'ours one', 'game/Data/Scripts/Source/SKSE.psc', 'skse source', 'game/Data/Scripts/Source/Actor.psc', 'actor source',
       'game/Data/Platform/Scripts/ours.pex', 'compiled ours', 'game/Data/SKSE/Plugins/Thornswood.ini', 'one person''s key binds',
       'game/Data/vortex.deployment.json', 'what vortex put in one skyrim', 'game/Claude outputs/', '', 'game/Claude outputs/Report.md', 'a report',
       'game/Data/Interface/racesex_menu.swf', 'racemenu''s menu', 'profile/plugins.txt', "*ours.esp`r`n")
# RaceMenu's loose menu is another author's (#1178) and goes as well.
$dropA = @('game/Data/Interface/racesex_menu.swf', 'game/Data/Scripts/Source/SKSE.psc', 'game/Data/Scripts/Source/Actor.psc', 'game/Data/SKSE/Plugins/Thornswood.ini', 'game/Data/vortex.deployment.json',
           'game/Claude outputs/', 'game/Claude outputs/Report.md')
# Main pack B (26 Sep): the Creation Kit, a copy of the game, its dialogue views
# and tools, next to a change of ours, and a delete list naming one of ours and
# Bethesda's archive. And an expired voice token and a face tint, with delete
# lines for the token (every release carries that one on purpose), a face
# export and the report.
$B = @('delete.txt', "Data/Platform/UI/old.esp`r`nData/meshes/LostArk/KamenSword.nif`r`nData/MarketplaceTextures.bsa`r`nData/Platform/voice-token.txt`r`nData/SKSE/Plugins/CharGen/Exported/Adventurer.jslot`r`nClaude outputs/Report.md`r`n",
       'game/CreationKit.exe', 'the creation kit', 'game/CreationKit.ini', 'ck settings',
       'game/SkyrimSE.exe.bak-1160-for-369', 'a copy of skyrim', 'game/Data/Platform/UI/ours.esp', 'ours two', 'game/Data/DialogueViews/', '',
       'game/Data/DialogueViews/0001.xml', 'a dialogue view', 'game/Tools/RoboVoicer.exe', 'a tool', 'game/Data/Platform/textures/ours.dds', 'a texture of ours',
       'game/Data/Platform/voice-token.txt', 'v1.7.1726700000000.expired', 'game/Data/textures/CharGen/Exported/Adventurer43553.dds', 'one person''s face tint')
# Main pack C: ours alone, and the folder entry for Data\Platform, which is ours
# although the files straight in it are one machine's.
$C = @('game/Data/Platform/', '', 'game/Data/Platform/UI/new.esp', 'a new plugin of ours')
$shaA = New-Pack (Join-Path $src 'A.zip') $A; $shaB = New-Pack (Join-Path $src 'B.zip') $B; $shaC = New-Pack (Join-Path $src 'C.zip') $C
foreach ($x in 'A', 'B', 'C') { [void](Put-Asset $fa (Join-Path $src "$x.zip")); [void](Put-Asset $da (Join-Path $src "$x.zip")) }
# Dev pack D: ours, beside an expired join pass and settings saved from a mod's menu.
$passText = 'jp1.expired-pass.sig'; $mcmText = 'another server''s values'
$shaD = New-Pack (Join-Path $src 'D.zip') @('game/Data/Platform/Plugins/ui.js', 'the ui, dev', 'game/Data/Platform/thornswood-pass.txt', $passText,
                                          'game/Data/MCM/Settings/Precision.ini', $mcmText)
[void](Put-Asset $da (Join-Path $src 'D.zip'))
$PA = '20260915-2018'; $PB = '20260926-1603'; $PC = '20260927-1633'; $PD = '20260929-0100-dev'
function Pack-Entry([string]$id, [string]$prefix, [string]$sha) { return [ordered]@{ id = $id; url = "https://thornswood.net/$prefix/assets/$sha"; sha256 = $sha; notes = "notes for $id" } }
$mainPacks = @((Pack-Entry $PA 'feed' $shaA), (Pack-Entry $PB 'feed' $shaB), (Pack-Entry $PC 'feed' $shaC))

# The files of the dev release, loose beside its records, and three records.
$ours = [ordered]@{ 'Data\Platform\UI\ours.esp' = 'ours two'; 'Data\Platform\Scripts\ours.pex' = 'compiled ours'; 'Data\Platform\UI\new.esp' = 'a new plugin of ours';
                    'Data\Platform\textures\ours.dds' = 'a texture of ours'; 'Data\Platform\Plugins\ui.js' = 'the ui, dev' }
$ied = 'Scriptname IED extends Quest'
$raceText = 'racemenu''s menu, loose'
foreach ($v in @($ours.Values) + @($ied, "*ours.esp`r`n", 'a texture of ours, older', $passText, $mcmText, $raceText)) { [void](Put-Text $da $v) }
function Record([hashtable]$files, [hashtable]$extra) {
    $m = @{}
    foreach ($k in $files.Keys) { $m[$k] = Entry-Of ([string]$files[$k]) }
    foreach ($k in $extra.Keys) { $m[$k] = [string]$extra[$k] }
    return $m
}
$r3files = @{}; foreach ($k in $ours.Keys) { $r3files[$k] = $ours[$k] }; $r3files['Data\Scripts\Source\IED.psc'] = $ied
# One machine's, as files the records name (and so sent loose), and as gone.
$r3files['Data\Platform\thornswood-pass.txt'] = $passText; $r3files['Data\MCM\Settings\Precision.ini'] = $mcmText
$r3files['Data\Interface\racesex_menu.swf'] = $raceText
$notOursKeys = @('Data\Interface\racesex_menu.swf')
$machineKeys = @('Data\Platform\thornswood-pass.txt', 'Data\MCM\Settings\Precision.ini', ':gone:Data\textures\CharGen\Exported\Adventurer3424.dds')
$R3 = Record $r3files @{ ':record:files' = '1'; ':golden:plugins.txt' = (Entry-Of "*ours.esp`r`n"); ':gone:Data\Platform\UI\old.esp' = 'removed'; ':order:plugins' = 'abc'; ':src:app\Shell.cs' = 'DEF'
                         ':gone:Data\Platform\voice-token.txt' = 'always'; ':gone:Data\textures\CharGen\Exported\Adventurer3424.dds' = 'removed'
                         ':gone:Data\meshes\LostArk\KamenSword.nif' = 'removed' }
$r2files = @{}; foreach ($k in $r3files.Keys) { $r2files[$k] = $r3files[$k] }; $r2files['Data\Platform\textures\ours.dds'] = 'a texture of ours, older'
$R2 = Record $r2files @{ ':record:files' = '1'; ':golden:plugins.txt' = (Entry-Of "*ours.esp`r`n"); ':gone:Data\Platform\UI\old.esp' = 'removed'; ':order:plugins' = 'abc' }
$R1 = Record @{ 'Data\Platform\UI\ours.esp' = 'ours one'; 'CreationKit.exe' = 'the creation kit'; 'Data\DialogueViews\0001.xml' = 'a dialogue view'; 'Data\SKSE\Plugins\SkyrimPlatform.ini.bak' = 'a backup' } @{ ':gone:Tools\Old.exe' = 'removed'; ':order:plugins' = 'abc' }
$rec = @{}
foreach ($n in 'R1', 'R2', 'R3') {
    $f = Join-Path $src "$n.json"
    $rec[$n] = [pscustomobject]@{ Map = (Get-Variable $n).Value; Sha = (Write-BaselineFile (Get-Variable $n).Value $f); File = $f }
    [void](Put-Asset $da $f)
}
$IR1 = '20260928-2324-dev'; $IR2 = '20260929-122410-dev'; $IR3 = '20260929-140118-dev'
function Ptr([string]$id, $r) { return [ordered]@{ id = $id; sha256 = $r.Sha; url = "https://thornswood.net/feed-dev/assets/$($r.Sha)"; entries = $r.Map.Count } }
function Rel([string]$id, $r, [string]$last) { $o = Ptr $id $r; $o['lastPack'] = $last; return $o }
$devDoc = [ordered]@{
    launcherVersion = '1.1.102.10'; launcherUrl = ''; launcherSha256 = ''; message = ''; news = @(@{ date = '9-29-2026 2:02 PM'; title = 'A dev release'; details = @('one') })
    packs = @($mainPacks) + @((Pack-Entry $PD 'feed-dev' $shaD))
    baseline = (Ptr $IR3 $rec['R3'])
    releases = @((Rel $IR3 $rec['R3'] $PD), (Rel $IR2 $rec['R2'] $PD), (Rel $IR1 $rec['R1'] $PC))
    release = [ordered]@{ id = $IR3; channel = 'dev'; packs = @($PD); baseline = $IR3 }
}
$mainDoc = [ordered]@{ launcherVersion = '1.1.102'; launcherUrl = ''; launcherSha256 = ''; message = ''; news = @(); packs = @($mainPacks) }
# Each feed is the first of its write-once generations, version\<8 digits>.json
# in its channel's folder; the newest is the feed (#2727, Feed-Store.ps1).
Put (Join-Path $site 'feed-dev\version\00000001.json') ($devDoc | ConvertTo-Json -Depth 6)
Put (Join-Path $site 'feed\version\00000001.json') ($mainDoc | ConvertTo-Json -Depth 6)
$devSeedSha = Get-BaselineFileSha (Join-Path $site 'feed-dev\version\00000001.json')
Copy-Item -LiteralPath $rec['R3'].File -Destination (Join-Path $site 'feed-dev\published.json')
# Main's baseline from before the feed named one: sizes and file times.
Put (Join-Path $site 'feed\published.json') (@{ 'Data\Platform\UI\ours.esp' = '8:639260000000000000'; 'CreationKit.exe' = '16:639260534800000000'; 'Data\DialogueViews\0001.xml' = '15:1'; ':order:plugins' = 'abc'
                                                'Data\SKSE\Plugins\Thornswood.ini' = '9:1'; 'Data\Platform\thornswood-spots.txt' = '3:1' } | ConvertTo-Json)

$why = Wait-OwnLine $sp $spErr '[thornswood-docs]' $sitePort 'the site'
Yes 'a copy of site\server.js serves the stand-in site' ($why -eq '')
if ($why) { Write-Host "      $why"; Done }

# ---- installs, the launcher's own code ----------------------------------------------
function Raw($x) { if ($x -is [Management.Automation.PSObject]) { return $x.PSObject.BaseObject }; return $x }
function Parse-Feed([string]$prefix) { return (Raw ($mParse.Invoke($null, @(, [IO.File]::ReadAllBytes((Get-FeedVersionFile (Join-Path $site $prefix))))))) }
# Pending asks the config which channel this is, because on dev the game
# files come with the launcher's own package (#4825); with no package
# installed here it is the feed's packs and record, as on main.
function Pending-Of($v) { $a = New-Object 'object[]' 2; $a[0] = (Raw $cfg); $a[1] = (Raw $v); return @($mPending.Invoke($null, $a) | ForEach-Object { Raw $_ }) }
function New-Install([string]$name) {
    $root = Join-Path $T "inst\$name"
    foreach ($d in 'Game\Data', 'Profile\Default', 'Profile\Packs', 'Launcher') { New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null }
    return $root
}
function Use-Install([string]$root) {
    $prof = Join-Path $root 'Profile'
    $set = @{ Root = $root; Game = (Join-Path $root 'Game'); LauncherDir = (Join-Path $root 'Launcher'); ProfileDir = $prof
              MyGames = (Join-Path $prof 'MyGames'); LocalAD = (Join-Path $prof 'LocalAppData'); Golden = (Join-Path $prof 'Default')
              Personal = (Join-Path $root 'Your Mods'); Isolated = (Join-Path $prof 'Isolated'); Replaced = (Join-Path $prof 'Replaced')
              StateFile = (Join-Path $prof 'swap.json'); PlayedFile = (Join-Path $prof 'played.flag'); AppliedFile = (Join-Path $prof 'applied.txt')
              PacksDir = (Join-Path $prof 'Packs'); LogFile = (Join-Path $prof 'launcher.log'); CfgFile = (Join-Path $root 'config.json')
              WinMyGames = (Join-Path $root 'win-mygames'); WinLocalAD = (Join-Path $root 'win-localappdata') }
    $set['Live'] = $set['LocalAD']; $set['LiveMyGames'] = $set['MyGames']
    foreach ($k in $set.Keys) { $P.GetField($k, $flags).SetValue($null, [string]$set[$k]) }
    $P.GetField('Collection', $flags).SetValue($null, $false)
}
function Install-Pack($p) {
    $sha = ([string]$p.sha256).ToLowerInvariant()
    $m = [regex]::Match([string]$p.url, '/(feed|feed-dev)/assets/')
    $a = New-Object 'object[]' 3
    $a[0] = [string](Join-Path $site ($m.Groups[1].Value + "\assets\$sha")); $a[1] = (Raw $p); $a[2] = $log
    [void]$mInstall.Invoke($null, $a)
}
function Invoke-Sync($rec, $v) {
    $a = New-Object 'object[]' 5
    $a[0] = (Raw $cfg); $a[1] = "$siteUrl/feed-dev/assets/"; $a[2] = (Raw $rec); $a[3] = (Raw $v); $a[4] = $log
    return [bool]$mSync.Invoke($null, $a)
}
# What a launcher does with a feed: Pending, then a sync for a release entry and
# Install for a pack. Hands back how many it took.
function Update([string]$root, [string]$prefix) {
    Use-Install $root
    $script:said.Clear()
    $v = Parse-Feed $prefix
    $n = 0
    foreach ($p in @(Pending-Of $v)) {
        if ($null -ne $p.Record) { [void](Invoke-Sync $p.Record $p.Doc) } else { Install-Pack $p }
        $n++
    }
    return $n
}
function Get-Game([string]$root) {
    $game = Join-Path $root 'Game'
    $m = @{}
    foreach ($f in @(Get-ChildItem -LiteralPath $game -Recurse -File)) { $m[$f.FullName.Substring($game.Length + 1)] = [IO.File]::ReadAllText($f.FullName) }
    return $m
}
function Same-Files([hashtable]$have, [hashtable]$want) {
    $bad = @()
    foreach ($k in $want.Keys) { if (-not $have.ContainsKey($k)) { $bad += "missing $k" } elseif ($have[$k] -ne $want[$k]) { $bad += "wrong $k" } }
    foreach ($k in $have.Keys) { if (-not $want.ContainsKey($k)) { $bad += "extra $k" } }
    if ($bad.Count) { Write-Host ('      ' + ($bad -join '; ')) }
    return ($bad.Count -eq 0)
}
function Synced([string]$root) { $f = Join-Path $root 'Profile\release.txt'; if (Test-Path -LiteralPath $f) { return [IO.File]::ReadAllText($f) } else { return '' } }
function Fetched { $m = @($script:said | ForEach-Object { [regex]::Match($_, '^Downloading (\d+) file') } | Where-Object { $_.Success }); if ($m.Count) { return [int]$m[0].Groups[1].Value } else { return 0 } }

Write-Host ''; Write-Host 'installs before the scrub'
$applied = New-Install 'applied-main'
$synced = New-Install 'synced-dev'
$appliedBefore = @{}; $syncedBefore = @{}
Yes-Install 'an install replays the three main packs' { (Update $applied 'feed') -eq 3 }
if ($OnWindows) { $appliedBefore = Get-Game $applied }
Yes-Install '  and has what they carried, the Creation Kit and the script sources among it' { $appliedBefore.ContainsKey('CreationKit.exe') -and $appliedBefore.ContainsKey('Data\Scripts\Source\SKSE.psc') }
if ($OnWindows) { [void](Update $synced 'feed-dev') }
Yes-Install 'an install syncs to the dev record' { (Synced $synced) -match $rec['R3'].Sha -and (Get-Game $synced).ContainsKey('Data\Scripts\Source\IED.psc') }
if ($OnWindows) { $syncedBefore = Get-Game $synced }

# ---- the scrub ------------------------------------------------------------------------
$fake = Join-Path $T 'repo'
New-Item -ItemType Directory -Force -Path $fake | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'scripts') -Destination $fake -Recurse -Force
foreach ($f in 'installer\licences\GPL-3.0.txt', 'installer\licences\AGPL-3.0.txt', 'records\client-build.json', 'records\client-licences.json', 'records\client-licences', 'records\ui-gone.json') {
    $from = Join-Path $repo $f
    if (Test-Path -LiteralPath $from) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $fake $f)) | Out-Null; Copy-Item -LiteralPath $from -Destination (Join-Path $fake $f) -Force -Recurse }
}
$work = Join-Path $T 'scrub-work'
# The install whose config.json names the collection: one of its own with no
# config.json, so the collection is the launcher's own, as on an install that
# names none. Left out, Scrub-Feed reads this machine's install (Where.ps1
# Install), which a harness has no business reading, and off Windows that is
# C:\Thornswood on a drive that is not there.
$scrubRoot = Join-Path $T 'install'
New-Item -ItemType Directory -Force -Path $scrubRoot | Out-Null
function Scrub([string]$channel, [string[]]$more) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $fake 'scripts\release\Scrub-Feed.ps1'), '-Channel', $channel, '-NoPause',
           '-SiteDir', $site, '-SiteUrl', $siteUrl, '-WorkDir', $work, '-ReleaseDir', (Join-Path $T "rel-$channel"), '-Root', $scrubRoot) + @($more)
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & $child @a 2>&1 | ForEach-Object { "$_" }
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($rc -ne 0) { Write-Host ((@($out) | Select-Object -Last 12) -join "`n") -ForegroundColor DarkGray }
    return [pscustomobject]@{ Code = $rc; Out = ($out -join "`n") }
}
function Snapshot {
    $m = @{}
    foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $site 'feed'), (Join-Path $site 'feed-dev') -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/]history[\\/]' })) {
        $m[$f.FullName.Substring($site.Length + 1)] = Get-BaselineFileSha $f.FullName
    }
    return $m
}
function Zip-Shape([string]$zip) {
    $o = [ordered]@{}
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try { foreach ($e in $z.Entries) { $s = $e.Open(); try { $o[$e.FullName] = (Get-BaselineStreamSha $s) + '|' + $e.LastWriteTime.ToString('o') } finally { $s.Dispose() } } }
    finally { $z.Dispose() }
    return $o
}
function Zip-Text([string]$zip, [string]$name) {
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try { $e = $z.GetEntry($name); if ($null -eq $e) { return $null }; $r = New-Object IO.StreamReader($e.Open()); try { return $r.ReadToEnd() } finally { $r.Dispose() } }
    finally { $z.Dispose() }
}
function Feed([string]$prefix) { return Read-Json (Get-FeedVersionFile (Join-Path $site $prefix)) }
function Pack-Of($doc, [string]$id) { return @($doc.packs | Where-Object { $_.id -eq $id })[0] }

Write-Host ''; Write-Host 'Scrub-Feed.ps1 -DryRun'
$before = Snapshot
$r = Scrub 'dev' @('-DryRun')
Yes 'a dry run on dev finds the two main packs, the dev pack and all three records' ($r.Code -eq 0 -and $r.Out -match "$PA`: 6 file\(s\) of Bethesda's, one machine's or another author's" -and
    $r.Out -match "$PB`: 7 file\(s\) of Bethesda's, one machine's or another author's.*3 delete line" -and $r.Out -match "$PD`: 2 file\(s\)" -and $r.Out -match '3 pack\(s\) rebuilt' -and $r.Out -match '3 record\(s\) written again')
$afterDry = Snapshot
Yes '  and sends and deletes nothing' ((@($before.Keys | Where-Object { $afterDry[$_] -ne $before[$_] }).Count -eq 0) -and $afterDry.Count -eq $before.Count)
Yes '  nor writes anything down to delete' (-not (Test-Path -LiteralPath (Join-Path $work 'scrub-ledger.json')))

# #1244: a run that stops right after it sent the feed, the way the first dev
# run of 29 September did. A breakpoint on the line that takes Send-FeedStore's
# answer ends the process there, as a crash would.
Write-Host ''; Write-Host 'Scrub-Feed.ps1 -Channel dev, stopped right after the send'
$stopper = Join-Path $T 'stop-after-send.ps1'
Put $stopper ("`$target = `$args[0]`r`n`$rest = @(`$args | Select-Object -Skip 1)`r`n" +
              "`$null = Set-PSBreakpoint -Script `$target -Variable sent -Mode Write -Action { [Environment]::Exit(9) }`r`n& `$target @rest`r`n")
$a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $stopper, (Join-Path $fake 'scripts\release\Scrub-Feed.ps1'), '-Channel', 'dev', '-NoPause',
       '-SiteDir', $site, '-SiteUrl', $siteUrl, '-WorkDir', $work, '-ReleaseDir', (Join-Path $T 'rel-dev'), '-Root', $scrubRoot)
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$null = & $child @a 2>&1; $rc = $LASTEXITCODE
$ErrorActionPreference = $old
$dd = Feed 'feed-dev'
Yes 'the run stopped after the dev feed went out' ($rc -eq 9 -and (Pack-Of $dd $PA).sha256 -ne $shaA -and $dd.baseline.sha256 -ne $rec['R3'].Sha)
Yes '  and before it deleted anything' ((Test-Path -LiteralPath (Join-Path $da $rec['R3'].Sha)) -and (Test-Path -LiteralPath (Join-Path $da (Sha-Text $passText))))
$ledKeys = @()
if (Test-Path -LiteralPath (Join-Path $work 'scrub-ledger.json')) { $ledKeys = @((Read-Json (Join-Path $work 'scrub-ledger.json')).PSObject.Properties | ForEach-Object { $_.Name }) }
Yes '  but what it replaced was written down before the send: the packs, the records and the files only they named' (
    @(@($shaA, $shaB, $shaD, $rec['R1'].Sha, $rec['R2'].Sha, $rec['R3'].Sha, (Sha-Text $ied), (Sha-Text $passText), (Sha-Text $mcmText), (Sha-Text $raceText)) | Where-Object { $ledKeys -notcontains $_ }).Count -eq 0)

Write-Host ''; Write-Host 'Scrub-Feed.ps1 -Channel dev, run again'
$r = Scrub 'dev' @()
Yes 'the next dev run goes through, finding nothing left to change' ($r.Code -eq 0 -and $r.Out -match 'Nothing on the dev feed names')
$dd = Feed 'feed-dev'; $md = Feed 'feed'
$nA = Pack-Of $dd $PA; $nB = Pack-Of $dd $PB; $nD = Pack-Of $dd $PD
Yes 'the dev feed names both main packs by the same ids with new sha256s, at /feed/assets' (
    $nA.sha256 -ne $shaA -and $nB.sha256 -ne $shaB -and $nA.url -eq "https://thornswood.net/feed/assets/$($nA.sha256)" -and $nB.url -eq "https://thornswood.net/feed/assets/$($nB.sha256)")
Yes '  and the dev pack by its id with a new sha256, at /feed-dev/assets' ($nD.sha256 -ne $shaD -and $nD.url -eq "https://thornswood.net/feed-dev/assets/$($nD.sha256)")
Yes '  and the pack that carries nothing to take out keeps its own, its Data\Platform folder entry and all' ((Pack-Of $dd $PC).sha256 -eq $shaC -and @($dd.packs).Count -eq 4)
Yes '  every other field of the feed is as it was' ($dd.launcherVersion -eq '1.1.102.10' -and $dd.news[0].title -eq 'A dev release' -and $dd.release.baseline -eq $IR3 -and (Pack-Of $dd $PA).notes -eq "notes for $PA")
$zA = Join-Path $fa $nA.sha256; $zB = Join-Path $fa $nB.sha256; $zD = Join-Path $da $nD.sha256
Yes '  the new packs are on the site, named by their bytes' ((Test-Path -LiteralPath $zA) -and (Get-BaselineFileSha $zA) -eq $nA.sha256 -and (Test-Path -LiteralPath $zB) -and (Get-BaselineFileSha $zB) -eq $nB.sha256 -and
    (Test-Path -LiteralPath $zD) -and (Get-BaselineFileSha $zD) -eq $nD.sha256)
$oldA = Zip-Shape (Join-Path $src 'A.zip'); $newA = Zip-Shape $zA
$keepA = [ordered]@{}; foreach ($k in $oldA.Keys) { if ($dropA -notcontains $k) { $keepA[$k] = $oldA[$k] } }
Yes '  the first is itself without the script sources, the key binds, the Vortex record and the report: every other entry byte for byte, same order, same times' (
    (($newA.Keys -join ',') -eq ($keepA.Keys -join ',')) -and (@($keepA.Keys | Where-Object { $newA[$_] -ne $keepA[$_] }).Count -eq 0) -and $keepA.Count -eq 3)
$newB = Zip-Shape $zB
Yes '  the second has none of the Creation Kit, the copy of the game, its dialogue views or tools' (
    @($newB.Keys | Where-Object { $_ -match 'CreationKit|SkyrimSE\.exe|DialogueViews|Tools/' }).Count -eq 0 -and $newB.Contains('game/Data/Platform/UI/ours.esp') -and $newB.Contains('game/Data/Platform/textures/ours.dds'))
Yes '  nor the voice token or the face tint' (@($newB.Keys | Where-Object { $_ -match 'voice-token|CharGen' }).Count -eq 0)
Yes '  and its delete list keeps the line of ours, another author''s file an earlier release took out and the token every release deletes, and drops Bethesda''s archive, the face export and the report' (
    (Zip-Text $zB 'delete.txt') -eq "Data/Platform/UI/old.esp`r`nData/meshes/LostArk/KamenSword.nif`r`nData/Platform/voice-token.txt`r`n")
$newD = Zip-Shape $zD
Yes '  the dev pack keeps ours and drops the join pass and the mod menu settings' (@($newD.Keys) -join ',' -eq 'game/Data/Platform/Plugins/ui.js')
Yes 'the main feed is not touched by the dev run' ((Pack-Of $md $PA).sha256 -eq $shaA -and (Pack-Of $md $PB).sha256 -eq $shaB)
Yes '  so the old main packs stay on the site for it' ((Test-Path -LiteralPath (Join-Path $fa $shaA)) -and (Test-Path -LiteralPath (Join-Path $fa $shaB)))
Yes '  while the old dev pack, which only the dev feed named, is gone' (-not (Test-Path -LiteralPath (Join-Path $da $shaD)))

$b = $dd.baseline
$nR3 = Read-BaselineFile (Join-Path $da $b.sha256)
$goneR3 = @('Data\Scripts\Source\IED.psc') + $machineKeys + $notOursKeys
Yes 'the dev baseline is the record again without IED.psc, the join pass, the mod menu settings or the face tint as gone, at a new sha256, with its entry count' (
    $b.id -eq $IR3 -and $b.sha256 -ne $rec['R3'].Sha -and @($goneR3 | Where-Object { $nR3.ContainsKey($_) }).Count -eq 0 -and $b.entries -eq $nR3.Count -and $nR3.Count -eq ($rec['R3'].Map.Count - 4))
Yes '  every other key as it was, the voice token every release deletes still listed as gone' (
    @($rec['R3'].Map.Keys | Where-Object { $goneR3 -notcontains $_ -and $nR3[$_] -ne $rec['R3'].Map[$_] }).Count -eq 0 -and $nR3[':gone:Data\Platform\voice-token.txt'] -eq 'always' -and $nR3[':gone:Data\meshes\LostArk\KamenSword.nif'] -eq 'removed')
Yes '  and the files are not listed as gone either' (-not $nR3.ContainsKey(':gone:Data\Scripts\Source\IED.psc') -and -not $nR3.ContainsKey(':gone:Data\Platform\thornswood-pass.txt'))
Yes '  while another author''s file we shipped is gone with its sha256 (#1261)' (
    $nR3.ContainsKey(':gone:Data\Interface\racesex_menu.swf') -and $nR3[':gone:Data\Interface\racesex_menu.swf'] -eq (Sha-Text $raceText))
# The list is the store's releases.json beside the feed since #1050: the run
# read it out of the feed, which still carried it, and wrote it back there.
$rels = @(Get-StoreReleases (Join-Path $site 'feed-dev') $dd)
Yes 'the release list goes back to the store beside the feed, and the feed carries none' (
    (Test-Path -LiteralPath (Join-Path $site 'feed-dev\releases.json')) -and -not $dd.PSObject.Properties['releases'])
$nR1 = Read-BaselineFile (Join-Path $da $rels[2].sha256)
Yes 'the release list names the three records again, same ids and order, new sha256s' (
    ($rels | ForEach-Object { $_.id }) -join ',' -eq "$IR3,$IR2,$IR1" -and $rels[0].sha256 -eq $b.sha256 -and $rels[1].sha256 -ne $rec['R2'].Sha -and $rels[2].sha256 -ne $rec['R1'].Sha -and $rels[2].lastPack -eq $PC)
Yes '  the oldest without the Creation Kit, its dialogue view, its tool as gone, or a backup' (
    -not $nR1.ContainsKey('CreationKit.exe') -and -not $nR1.ContainsKey('Data\DialogueViews\0001.xml') -and -not $nR1.ContainsKey(':gone:Tools\Old.exe') -and
    -not $nR1.ContainsKey('Data\SKSE\Plugins\SkyrimPlatform.ini.bak') -and $nR1.ContainsKey('Data\Platform\UI\ours.esp') -and $rels[2].entries -eq 2)
$pubDev = Join-Path $site 'feed-dev\published.json'
Yes 'the dev store''s baseline is the new record''s own bytes' ((Get-BaselineFileSha $pubDev) -eq $b.sha256)
Yes 'the old records are off the site' (-not (Test-Path -LiteralPath (Join-Path $da $rec['R3'].Sha)) -and -not (Test-Path -LiteralPath (Join-Path $da $rec['R2'].Sha)) -and -not (Test-Path -LiteralPath (Join-Path $da $rec['R1'].Sha)))
Yes '  and so is IED.psc, which only they named' (-not (Test-Path -LiteralPath (Join-Path $da (Sha-Text $ied))))
Yes '  and the join pass and the mod menu settings they named, which went up loose' (-not (Test-Path -LiteralPath (Join-Path $da (Sha-Text $passText))) -and -not (Test-Path -LiteralPath (Join-Path $da (Sha-Text $mcmText))))
Yes '  while every file the new records name is still there' (@((Get-RecordFileShas $nR3).Keys | Where-Object { -not (Test-Path -LiteralPath (Join-Path $da $_)) }).Count -eq 0)
# The feed's generations are its history: the one it replaced is still there,
# unchanged, beside the newer, and history\ holds no copy of it.
$gens = @(Get-ChildItem -LiteralPath (Join-Path $site 'feed-dev\version') -File | Sort-Object Name)
Yes ('the feed store kept the feed it replaced, unchanged, as the generation before ({0})' -f (($gens | ForEach-Object { $_.Name }) -join ', ')) (
    $gens.Count -ge 2 -and $gens[0].Name -eq '00000001.json' -and (Get-BaselineFileSha $gens[0].FullName) -eq $devSeedSha -and
    (Get-FeedVersionFile (Join-Path $site 'feed-dev')) -eq $gens[$gens.Count - 1].FullName -and
    @(Get-ChildItem -LiteralPath (Join-Path $site 'feed-dev\history') -Filter '*-version.json' -ErrorAction SilentlyContinue).Count -eq 0)

Write-Host ''; Write-Host 'Scrub-Feed.ps1 -Channel main'
$r = Scrub 'main' @()
Yes 'the main run goes through' ($r.Code -eq 0)
$md = Feed 'feed'; $dd = Feed 'feed-dev'
Yes 'the main feed names the very bytes the dev feed does, for each pack id' ((Pack-Of $md $PA).sha256 -eq $nA.sha256 -and (Pack-Of $md $PB).sha256 -eq $nB.sha256 -and (Pack-Of $md $PC).sha256 -eq $shaC)
Yes '  taken from the dev feed, not made again' ($r.Out -match 'the dev feed already names it without them')
Yes 'the old packs are off the site, from both folders' (
    -not (Test-Path -LiteralPath (Join-Path $fa $shaA)) -and -not (Test-Path -LiteralPath (Join-Path $fa $shaB)) -and
    -not (Test-Path -LiteralPath (Join-Path $da $shaA)) -and -not (Test-Path -LiteralPath (Join-Path $da $shaB)))
Yes '  and nothing else was deleted' ((Test-Path -LiteralPath (Join-Path $fa $shaC)) -and (Test-Path -LiteralPath (Join-Path $da $nD.sha256)) -and (Test-Path -LiteralPath (Join-Path $da $shaC)))
$pm = Read-BaselineFile (Join-Path $site 'feed\published.json')
Yes 'main''s baseline is written again without the Creation Kit, the key binds or the spots file, keeping the rest' (-not $pm.ContainsKey('CreationKit.exe') -and -not $pm.ContainsKey('Data\DialogueViews\0001.xml') -and
    -not $pm.ContainsKey('Data\SKSE\Plugins\Thornswood.ini') -and -not $pm.ContainsKey('Data\Platform\thornswood-spots.txt') -and $pm['Data\Platform\UI\ours.esp'] -eq '8:639260000000000000' -and $pm[':order:plugins'] -eq 'abc' -and $pm.Count -eq 2)
$led = Read-Json (Join-Path $work 'scrub-ledger.json')
Yes 'nothing is left waiting to be deleted' (@($led.PSObject.Properties).Count -eq 0)
$allNames = @(Get-ChildItem -LiteralPath $fa, $da -File | ForEach-Object { Join-Path $_.Directory.FullName $_.Name })
$left = @()
foreach ($f in $allNames) {
    $n = [IO.Path]::GetFileName($f)
    if ($n -notmatch '^[0-9a-f]{64}$') { continue }
    $bytes = [IO.File]::ReadAllBytes($f)
    if ($bytes.Length -gt 2 -and $bytes[0] -eq 0x50 -and $bytes[1] -eq 0x4B) {
        $left += @((Zip-Shape $f).Keys | Where-Object { $_.StartsWith('game/') -and ((Test-ShipBethesda ($_.Substring(5).Replace('/', '\'))) -or (Test-ShipOneMachine ($_.Substring(5).Replace('/', '\')))) })
    }
    if ($ascii.GetString($bytes) -eq $ied) { $left += 'IED.psc' }
    if ($ascii.GetString($bytes) -eq $passText -or $ascii.GetString($bytes) -eq $mcmText) { $left += 'a loose file of one machine''s' }
}
Yes 'no asset left on either folder of the site carries a file of Bethesda''s or one machine''s' ($left.Count -eq 0)
foreach ($l in @($left | Select-Object -First 5)) { Write-Host "      still there: $l" }

Write-Host ''; Write-Host 'a second run'
$snap = Snapshot
$r1 = Scrub 'dev' @(); $r2 = Scrub 'main' @()
Yes 'finds nothing on either feed and changes nothing' ($r1.Code -eq 0 -and $r2.Code -eq 0 -and $r1.Out -match 'Nothing on the dev feed names' -and $r2.Out -match 'Nothing on the main feed names' -and
    (@($snap.Keys | Where-Object { (Snapshot)[$_] -ne $snap[$_] }).Count -eq 0) -and (Snapshot).Count -eq $snap.Count)

# ---- installs after it ---------------------------------------------------------------
Write-Host ''; Write-Host 'installs after the scrub'
$want = @{ 'Data\Platform\UI\ours.esp' = 'ours two'; 'Data\Platform\Scripts\ours.pex' = 'compiled ours'; 'Data\Platform\UI\new.esp' = 'a new plugin of ours'; 'Data\Platform\textures\ours.dds' = 'a texture of ours' }
$fresh = New-Install 'fresh-main'
Yes-Install 'a fresh main install replaying every pack takes all three' { (Update $fresh 'feed') -eq 3 }
Yes-Install '  and ends with the files of ours and none of Bethesda''s or one machine''s' { Same-Files (Get-Game $fresh) $want }
Yes-Install 'an install that already applied them is offered nothing: the ids are in its applied.txt' { Use-Install $applied; (Pending-Of (Parse-Feed 'feed')).Count -eq 0 }
Yes-Install '  so nothing is fetched again and its files are as they were' { (Update $applied 'feed') -eq 0 -and (Same-Files (Get-Game $applied) $appliedBefore) }
Yes-Install 'an install synced to the old dev record is offered the new one' {
    Use-Install $synced
    $pend = @(Pending-Of (Parse-Feed 'feed-dev'))
    $pend.Count -eq 1 -and $null -ne $pend[0].Record -and $pend[0].Record.sha256 -eq $dd.baseline.sha256 }
Yes-Install '  checks every file, downloads nothing, and removes the matching RaceMenu copy (#1261)' {
    [void](Update $synced 'feed-dev')
    $after = Get-Game $synced
    $wantAfter = @{}; foreach ($k in $syncedBefore.Keys) { if ($k -ne 'Data\Interface\racesex_menu.swf') { $wantAfter[$k] = $syncedBefore[$k] } }
    (Fetched) -eq 0 -and @($script:said | Where-Object { $_ -like 'removed Data\Interface\racesex_menu.swf' }).Count -eq 1 -and (Same-Files $after $wantAfter) -and
    -not (Test-Path -LiteralPath (Join-Path $synced 'Game\Data\Interface\racesex_menu.swf')) }
Yes-Install '  and writes the new record down, so it is not offered again' { (Synced $synced) -match $dd.baseline.sha256 -and (Pending-Of (Parse-Feed 'feed-dev')).Count -eq 0 }
$wantDev = @{}; foreach ($k in $ours.Keys) { $wantDev[$k] = $ours[$k] }
Yes-Install 'a fresh dev install syncs to the new record and ends without IED.psc, the join pass or the mod menu settings' {
    $freshDev = New-Install 'fresh-dev'
    [void](Update $freshDev 'feed-dev')
    (Same-Files (Get-Game $freshDev) $wantDev) -and (Synced $freshDev) -match $dd.baseline.sha256 }
Yes-Install 'an old launcher replaying the dev feed''s packs ends without Bethesda''s or one machine''s files too' {
    $oldL = New-Install 'old-launcher-dev'
    Use-Install $oldL
    foreach ($pk in @((Parse-Feed 'feed-dev').packs)) { Install-Pack $pk }
    Same-Files (Get-Game $oldL) $wantDev }

# ---- a rollback on the scrubbed feed ---------------------------------------------------
Write-Host ''; Write-Host 'Rollback-Feed.ps1 on the scrubbed dev feed'
$a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $fake 'scripts\release\Rollback-Feed.ps1'), '-Channel', 'dev', '-NoPause',
       '-SiteDir', $site, '-SiteUrl', $siteUrl, '-ReleaseDir', (Join-Path $T 'rb-rel'), '-WorkDir', (Join-Path $T 'rb-work'), '-Back', '1', '-Id', '20260929-150000-dev')
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$out = & $child @a 2>&1 | ForEach-Object { "$_" }; $rc = $LASTEXITCODE
$ErrorActionPreference = $old
if ($rc -ne 0) { Write-Host ((@($out) | Select-Object -Last 12) -join "`n") -ForegroundColor DarkGray }
$db = Feed 'feed-dev'
Yes 'going back a release reads the new records and finds every file it needs' ($rc -eq 0 -and $db.baseline.id -eq '20260929-150000-dev')
# The dev feed offers 1.1.102.10, past the first dev launcher that syncs to the
# record (1.1.102.8), so the rollback is the record alone and the feed carries
# no packs (Release-Baseline.ps1, Test-FeedPacksGone, #1050).
$rbRec = Read-BaselineFile (Join-Path $da ([string]$db.baseline.sha256))
Yes '  with every launcher let in syncing, it adds no pack and the feed carries none' (@($db.packs).Count -eq 0 -and [string]$rbRec[':record:files'] -eq '1')
Yes '  and its record names none of Bethesda''s or one machine''s files' (@($rbRec.Keys | Where-Object { -not $_.StartsWith(':') -and ((Test-ShipBethesda $_) -or (Test-ShipOneMachine $_)) }).Count -eq 0)
Yes-Install '  and the synced install follows it to the older texture' { [void](Update $synced 'feed-dev'); (Get-Game $synced)['Data\Platform\textures\ours.dds'] -eq 'a texture of ours, older' }

# ---- a baseline the other feed names that does not read (#2711) ------------------------
# Before it deletes, a run reads both feeds' baselines for the files their
# records name. The other feed's was read in a try with an empty catch, so a
# pointer that did not read left those files unnamed, and they went. Now the
# run stops there, before anything is deleted.
Write-Host ''; Write-Host 'Scrub-Feed.ps1 -Channel dev, with the main feed''s baseline unreadable'
# The main feed changes the way the store sends one: as its next generation (#2727).
$mainChan = Join-Path $site 'feed'
$mainFeedWas = [IO.File]::ReadAllText((Get-FeedVersionFile $mainChan))
$ledgerPath = Join-Path $work 'scrub-ledger.json'
$ledgerWas = $(if (Test-Path -LiteralPath $ledgerPath) { [IO.File]::ReadAllText($ledgerPath) } else { $null })
$stray = Put-Text $da 'a file only a ledger names, while the main baseline does not read'
$led = [ordered]@{}
if ($ledgerWas) { foreach ($p in (ConvertFrom-Json $ledgerWas).PSObject.Properties) { $led[$p.Name] = [string]$p.Value } }
$led[$stray] = 'stand-in for a replaced file'
[IO.File]::WriteAllText($ledgerPath, ($led | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))
$mf = ConvertFrom-Json $mainFeedWas
if ($mf.PSObject.Properties['baseline']) { $mf.baseline = [pscustomobject]@{ id = 'no-sha-no-url' } }
else { $mf | Add-Member -NotePropertyName 'baseline' -NotePropertyValue ([pscustomobject]@{ id = 'no-sha-no-url' }) }
[IO.File]::WriteAllText((Join-Path (Join-Path $mainChan 'version') (Get-FeedVersionNext $mainChan)), ($mf | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
$r = Scrub 'dev' @()
Yes 'the run stops, saying the main feed''s baseline does not read' ($r.Code -ne 0 -and $r.Out -match 'The main feed names a baseline that does not read' -and $r.Out -match 'Nothing was deleted')
Yes '  and deletes nothing' (Test-Path -LiteralPath (Join-Path $da $stray))
[IO.File]::WriteAllText((Join-Path (Join-Path $mainChan 'version') (Get-FeedVersionNext $mainChan)), $mainFeedWas, (New-Object Text.UTF8Encoding($false)))
if ($null -ne $ledgerWas) { [IO.File]::WriteAllText($ledgerPath, $ledgerWas, (New-Object Text.UTF8Encoding($false))) } else { Remove-Item -LiteralPath $ledgerPath -Force }
Remove-Item -LiteralPath (Join-Path $da $stray) -Force

# ---- the delete itself -----------------------------------------------------------------
Write-Host ''; Write-Host 'Remove-FeedStoreAssets'
$loose = Put-Text $da 'a stray file nothing names'
$named = [string]$db.baseline.sha256
$now = @{ main = (Get-BaselineFileSha (Get-FeedVersionFile (Join-Path $site 'feed'))); dev = (Get-BaselineFileSha (Get-FeedVersionFile (Join-Path $site 'feed-dev'))) }
$why = ''
try { [void](Remove-FeedStoreAssets dev @($loose) @{ main = $now.main; dev = ('0' * 64) } -SiteDir $site) } catch { $why = $_.Exception.Message }
Yes 'a delete refuses when a feed moved since it was read, and deletes nothing' ($why -match 'changed on the VPS' -and (Test-Path -LiteralPath (Join-Path $da $loose)))
$res = Remove-FeedStoreAssets dev @($loose, $named, 'not-a-sha') $now -SiteDir $site
Yes '  keeps what a feed still names, whatever it was asked' (@($res.Named) -contains $named -and (Test-Path -LiteralPath (Join-Path $da $named)))
Yes '  refuses a name that is not a sha256' (@($res.Bad) -contains 'not-a-sha')
Yes '  and deletes what nothing names' (@($res.Gone) -contains $loose -and -not (Test-Path -LiteralPath (Join-Path $da $loose)))

# ---- every function it calls is loaded -------------------------------------------
# Some lines run only against the real site (Test-SiteAsset, after the send), so
# a run on a folder never reaches them. On 29 September the first dev run
# stopped there because Feed-Rules.ps1, which defines it, was not loaded. So:
# every function Scrub-Feed.ps1 calls that a script beside it defines is in a
# file it loads.
Write-Host ''; Write-Host 'what Scrub-Feed.ps1 loads'
$scrubPath = Join-Path $repo 'scripts\release\Scrub-Feed.ps1'
$tk = $null; $er = $null
$sast = [System.Management.Automation.Language.Parser]::ParseFile($scrubPath, [ref]$tk, [ref]$er)
$own = @($sast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
# What it loads, and what each of those loads at its own top level, all the
# way down: a function a loaded file brings in with it is loaded too.
# Write-FeedVersionFile is the case (#1050, #2450): Feed-Store.ps1, which
# Scrub-Feed loads, loads Feed-Json.ps1 that defines it, so counting only the
# files Scrub-Feed names itself failed on something that works. Only lines at
# column 0 count; an indented load is inside a function and may never run.
$loadRx = "(?m)^\. \(Join-Path \`$(?:Here|PSScriptRoot) '([^'\\]+\.ps1)'\)"
$loaded = @()
$queue = @([regex]::Matches([IO.File]::ReadAllText($scrubPath), $loadRx) | ForEach-Object { $_.Groups[1].Value })
while ($queue.Count) {
    $next = $queue[0]; $queue = @($queue | Select-Object -Skip 1)
    if ($loaded -contains $next) { continue }
    $loaded += $next
    $lp = Join-Path $repo ('scripts\release\' + $next)
    if (Test-Path -LiteralPath $lp) { $queue += @([regex]::Matches([IO.File]::ReadAllText($lp), $loadRx) | ForEach-Object { $_.Groups[1].Value }) }
}
$definedIn = @{}
foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $repo 'scripts\release') -Filter '*.ps1' -File)) {
    $t2 = $null; $e2 = $null
    $a2 = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t2, [ref]$e2)
    foreach ($fd in @($a2.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Parent -is [System.Management.Automation.Language.NamedBlockAst] }, $false))) {
        if (-not $definedIn.ContainsKey($fd.Name)) { $definedIn[$fd.Name] = @() }
        $definedIn[$fd.Name] += $f.Name
    }
}
$calls = @($sast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Sort-Object -Unique)
$unloaded = @($calls | Where-Object { $own -notcontains $_ -and $definedIn.ContainsKey($_) -and -not @($definedIn[$_] | Where-Object { $loaded -contains $_ }).Count })
Yes ('every function it calls from a script beside it is loaded ({0} of them)' -f @($calls | Where-Object { $definedIn.ContainsKey($_) -and $own -notcontains $_ }).Count) ($unloaded.Count -eq 0)
foreach ($u in $unloaded) { Write-Host ("      {0} is defined in {1}, which it does not load" -f $u, ($definedIn[$u] -join ', ')) }
Yes '  Test-SiteAsset among them, from Feed-Rules.ps1' ($calls -contains 'Test-SiteAsset' -and $loaded -contains 'Feed-Rules.ps1')

Done
