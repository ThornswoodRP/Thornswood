<#
  test-record-sync.ps1

      pwsh -NoProfile -File .\tests\test-record-sync.ps1

  A launcher syncs its install to the release record the feed names, file by
  file by sha256 from the site, instead of replaying the chain of packs; the
  packs stay on the feed for launchers that do not; and a rollback works for
  both (#1050).

  WHY THIS EXISTS. Until #1050 a launcher only replayed packs, so it never knew
  what a release was meant to leave installed. Patrick, 29 Sep: fetch each
  file straight from the site by its fingerprint, syncing the install to the
  release record. This proves it with the real pieces, nothing copied:

    1. the real Publish-Update.ps1, in a child PowerShell, publishing four
       releases of a made up build into a folder standing in for the site and
       the VPS store (-SiteDir): every file of each release goes up as its own
       asset, the record says so (':record:files'), carries the plugin list as
       the pack carries it and what is gone, the first one reads what the packs
       before it took out, and the packs still go on the feed
    2. the launcher's own Updater, the launcher project built by the .NET 10
       SDK as the build builds it (tests\Launcher-Csc.ps1), syncing scratch installs
       over http from a copy of site\server.js serving that folder: a fresh
       install, one release behind, several behind (with files an old pack took
       out), a download cut off halfway (carried on with a Range request), a
       sync cut off after its downloads (finished with the network gone), a
       file changed by hand, a download whose bytes are not its checksum, a
       file Vortex deploys now, and a record that does not say its files are up
    3. an old launcher beside them, taking the same feed pack by pack, landing
       on the same files
    4. the real Rollback-Feed.ps1 putting the feed back a release and forward
       again, and both kinds of launcher following it

  Runs in pwsh 7 on Windows, where the launcher runs and reads the record's
  Windows paths, with the .NET 10 SDK the launcher builds with. Needs node
  on PATH for the copy of the site. Everything it writes is in its own temp
  folder, and nothing connects anywhere but 127.0.0.1.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
# Publish-Update takes no -Vps; its box here is this machine's stand-in.
$env:THORNSWOOD_VPS = '127.0.0.1'

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the launcher's own build, by the .NET 10 SDK (#4823)
# The record names every file by its path under the game folder as Windows
# writes it (Data\Platform\...), and the launcher syncs those paths on the
# Windows it runs on. Anywhere else a backslash is part of a file's name, so
# the installs here would not be the ones a launcher makes.
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  the launcher syncs the record''s Windows paths, which only Windows reads as folders'; exit 0 }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$app = Join-Path $repo 'launcher\app'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$script:procs = @()
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-record-sync-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
function Done {
    foreach ($p in $script:procs) { try { if (-not $p.HasExited) { $p.Kill() } } catch { } }
    Start-Sleep -Milliseconds 300
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
# Anything that throws is a failure, and the servers still go.
trap { $script:fail++; Write-Host ("FAIL  stopped: " + $_.Exception.Message + ' ' + $_.InvocationInfo.PositionMessage) -ForegroundColor Red; Done }

. (Join-Path $repo 'scripts\release\Release-Baseline.ps1')
. (Join-Path $repo 'scripts\release\Feed-Store.ps1')
. (Join-Path $repo 'scripts\release\Release-Name.ps1')
. (Join-Path $repo 'scripts\release\Feed-News.ps1')
Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
$ascii = New-Object Text.ASCIIEncoding
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Read-Json([string]$path) { return (([IO.File]::ReadAllText($path)) -replace '^﻿', '') | ConvertFrom-Json }
# The stand-in site's feed is the newest of the channel's write-once
# generations, version\<8 digits>.json (#2727). Reading it reads the newest; a
# write here, a hand edit or saved bytes put back, is the next one, as the
# store sends it, and never replaces one.
function Site-Feed([string]$channelDir) {
    $f = Get-FeedVersionFile $channelDir
    if (-not $f) { throw "the stand-in site has no feed in $channelDir\version" }
    return $f
}
function Next-SiteFeed([string]$channelDir) {
    $v = Join-Path $channelDir 'version'
    New-Item -ItemType Directory -Force -Path $v | Out-Null
    return (Join-Path $v (Get-FeedVersionNext $channelDir))
}
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
Yes 'node is on PATH, for the copy of the site and the stand-in game server' ($null -ne $node)
if ($null -eq $node) { Done }

# ---- the launcher, built ----------------------------------------------------------
# The launcher project itself, built by the .NET 10 SDK as the build builds it,
# and loaded into this PowerShell, which runs on .NET 10 as the launcher does.
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
if ($null -eq $asm) { Done }
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

# ---- the site and the stand-in game server ---------------------------------------
$site = Join-Path $T 'site'
$feedDir = Join-Path $site 'feed'
New-Item -ItemType Directory -Force -Path (Join-Path $feedDir 'assets'), (Join-Path $site 'feed-dev') | Out-Null
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
Copy-SiteProgram -To $site -App (Join-Path $repo 'site')
$sitePort = Free-Port
# The game check knocks on port 1 (#1816). The system never hands that port
# out for a listen on 0 and no harness listens on a fixed port
# (test-1703-test-ports.js), so no run beside this one can take it and make
# the game read as up. A port taken from the system and let go could be.
# The same port stands for the site out of reach further down.
$dead = 1
Put (Join-Path $site 'config.json') (@{
    password = ''; secret = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')); botKey = ''; gameCheckPort = $dead
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
$at = "$siteUrl/feed/assets/"

$gamePort = Free-Port
$gameJs = Join-Path $T 'game-server.js'
Put $gameJs ("require('http').createServer(function (q, s) { s.setHeader('Content-Type', 'application/json'); " +
             "s.end(JSON.stringify({ mods: [{ filename: 'collection.esp', size: 1, crc32: 1 }] })); })" +
             ".listen($gamePort, '127.0.0.1', function () { console.log('[game] listening on 127.0.0.1:$gamePort'); });")
$gpsi = New-Object Diagnostics.ProcessStartInfo
$gpsi.FileName = $node.Source; $gpsi.Arguments = '"' + $gameJs + '"'
$gpsi.UseShellExecute = $false; $gpsi.CreateNoWindow = $true; $gpsi.RedirectStandardOutput = $true; $gpsi.RedirectStandardError = $true
$gp = [Diagnostics.Process]::Start($gpsi); $gpErr = $gp.StandardError.ReadToEndAsync()
$script:procs += $gp
$why = Wait-OwnLine $sp $spErr '[thornswood-docs]' $sitePort 'the site'
Yes 'a copy of site\server.js serves the stand-in site' ($why -eq '')
if ($why) { Write-Host "      $why"; Done }
$why = Wait-OwnLine $gp $gpErr '[game]' $gamePort 'the game server stand-in'
Yes 'and the game server stand-in is listening' ($why -eq '')
if ($why) { Write-Host "      $why"; Done }

# ---- the build and the publisher ----------------------------------------------
$fake = Join-Path $T 'repo'
New-Item -ItemType Directory -Force -Path $fake | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'scripts') -Destination $fake -Recurse -Force
# launcher\app\VortexProfileState.cs: LoadOrder.ps1 compiles the Vortex state
# reader from the launcher's source since #1416, and the publish reads the
# collection revision through it (#1878).
foreach ($f in 'layout.json', 'installer\licences\GPL-3.0.txt', 'installer\licences\AGPL-3.0.txt', 'records\generated.json', 'records\ui-gone.json', 'records\shipped-not-ours.json', 'launcher\app\VortexProfileState.cs') {
    $from = Join-Path $repo $f
    if (Test-Path -LiteralPath $from) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $fake $f)) | Out-Null; Copy-Item -LiteralPath $from -Destination (Join-Path $fake $f) -Force }
}
$reqFrom = Join-Path $repo 'game\required-data'
if (Test-Path -LiteralPath $reqFrom) {
    New-Item -ItemType Directory -Force -Path (Join-Path $fake 'game\required-data') | Out-Null
    Copy-Item -Path (Join-Path $reqFrom '*') -Destination (Join-Path $fake 'game\required-data') -Recurse -Force
}
# The real Stop-Game closes any Skyrim on the machine; nothing here may.
Put (Join-Path $fake 'scripts\dev\Close-Launcher.ps1') "function Stop-Game { param([string]`$Root) return `$false }`r`nfunction Get-GameProcesses { param([string]`$Root) return @() }`r`n"
# No signing setup here: the catalog Publish-Update signs (#2163, phase B) is left unsigned, and the stub answers that it passed.
Put (Join-Path $fake 'scripts\release\Sign-ReleaseCatalog.ps1') "function Invoke-ReleaseCatalogSign { param([string]`$Catalog, [string]`$RepoDir) return '' }`r`n"

$pub = Join-Path $T 'publisher'
$rel = Join-Path $T 'rel'
foreach ($dd in 'Game\Data', 'Profile\OwnGame', 'appdata', 'dist') { New-Item -ItemType Directory -Force -Path (Join-Path $pub $dd) | Out-Null }
New-Item -ItemType Directory -Force -Path $rel | Out-Null
[IO.File]::WriteAllLines((Join-Path $pub 'Profile\OwnGame\files.txt'), @('F|V|1024|638000000000000000|Data\collection.esp'))
# The reference plugin list enables the plugin Vortex deployed into Data. Since
# 6e4488e4 a publish refuses a list that enables a file Data does not have, and
# ours.esp is under Data\Platform\UI, so naming it stopped every release (#1878).
Put (Join-Path $pub 'Profile\OwnGame\plugins.txt') "*collection.esp`r`n"
Put (Join-Path $pub 'Profile\OwnGame\loadorder.txt') "collection.esp`r`n"
. (Join-Path $repo 'tests\fixtures\ui-front.ps1')
Install-UiFrontFixture (Join-Path $pub 'Game')
Put (Join-Path $pub 'config.json') ('{"ServerAddress":"127.0.0.1","ServerPort":' + ($gamePort - 1) + '}')

# What the build holds, relative to the game folder, and how to change it.
$build = @{}
function Set-Build([string]$relPath, $content) {
    $f = Join-Path (Join-Path $pub 'Game') $relPath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f) | Out-Null
    if ($content -is [byte[]]) { [IO.File]::WriteAllBytes($f, $content) } else { [IO.File]::WriteAllText($f, [string]$content, $ascii) }
    $script:build[$relPath] = $true
}
function Drop-Build([string]$relPath) { Remove-Item -LiteralPath (Join-Path (Join-Path $pub 'Game') $relPath) -Force; $script:build.Remove($relPath) }
function Bytes([int]$n, [int]$seed) { $r = New-Object Random $seed; $b = New-Object byte[] $n; $r.NextBytes($b); return ,$b }

Set-Build 'Data\Platform\UI\thornswood-ours.esp' 'the plugin, as the installer had it'
Set-Build 'Data\Platform\UI\thornswood-ours.bsa' ('x' * 4096)
Set-Build 'Data\Platform\Plugins\thornswood-ui.js' 'ui as the installer had it'
Set-Build 'Data\Platform\UI\thornswood-old.esp' 'a plugin the first release drops'
Set-Build 'Data\Platform\UI\thornswood-keep.txt' 'the same the whole time'
# The collection's, which no release carries.
$f = Join-Path $pub 'Game\Data\collection.esp'; [IO.File]::WriteAllText($f, 'from Vortex', $ascii)

# A pack from before any record, already on the feed: it took Data\Platform\UI\thornswood-ancient.esp out.
function New-Zip([string]$path, [hashtable]$files, [string[]]$deletes) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    $z = [IO.Compression.ZipFile]::Open($path, 'Create')
    try {
        if ($deletes) { $w = New-Object IO.StreamWriter ($z.CreateEntry('delete.txt').Open()); foreach ($d in $deletes) { $w.WriteLine($d.Replace('\', '/')) }; $w.Dispose() }
        foreach ($k in $files.Keys) { $s = $z.CreateEntry('game/' + $k.Replace('\', '/')).Open(); $b = $ascii.GetBytes([string]$files[$k]); $s.Write($b, 0, $b.Length); $s.Dispose() }
    } finally { $z.Dispose() }
}
$ancientZip = Join-Path $T 'ancient.zip'
New-Zip $ancientZip @{ 'Data\Platform\UI\thornswood-filler.txt' = 'a file an old pack wrote' } @('Data\Platform\UI\thornswood-ancient.esp')
$ancientSha = Get-BaselineFileSha $ancientZip
Copy-Item -LiteralPath $ancientZip -Destination (Join-Path $feedDir "assets\$ancientSha")
Set-Build 'Data\Platform\UI\thornswood-filler.txt' 'a file an old pack wrote'
Put (Join-Path $feedDir 'version\00000001.json') ((@{
    launcherVersion = '1.1.102'; launcherUrl = ''; launcherSha256 = ''; minLauncher = '1.1.102'; message = ''; news = @()
    packs = @(@{ id = '20260101-0000'; url = "https://thornswood.net/feed/assets/$ancientSha"; sha256 = $ancientSha; notes = 'An old update' })
}) | ConvertTo-Json -Depth 5)

$Shell = (Get-Process -Id $PID).Path
function Publish([string[]]$extra) {
    $oldA = $env:LOCALAPPDATA; $oldE = $ErrorActionPreference
    $env:LOCALAPPDATA = Join-Path $pub 'appdata'
    $ErrorActionPreference = 'Continue'
    try {
        $pu = Join-Path $fake 'scripts\release\Publish-Update.ps1'
        function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
        $argText = (@('-Root', (Q $pub), '-ReleaseDir', (Q $rel), '-DistRoot', (Q (Join-Path $pub 'dist')), '-SiteDir', (Q $site),
                      '-SiteUrl', $siteUrl, '-NoPause', '-NoClose', '-KeepPacks', '0') + @($extra)) -join ' '
        $cmd = "`$rc = 1; try { & $(Q $pu) $argText; `$rc = `$LASTEXITCODE } finally { }; exit `$rc"
        $out = (& $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String); $code = $LASTEXITCODE
    } finally { $env:LOCALAPPDATA = $oldA; $ErrorActionPreference = $oldE }
    return [pscustomobject]@{ Code = $code; Out = $out }
}
function Show($r) { if ($r.Code -ne 0) { Write-Host (($r.Out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 14) -join "`n") -ForegroundColor DarkGray } }
function Feed { return Read-Json (Site-Feed $feedDir) }
function Record-Of($doc) { return Read-BaselineFile (Join-Path $feedDir ("assets\" + [string]$doc.baseline.sha256)) }
$records = @{}
function Release([string]$Id, [string]$note) {
    $r = Publish @('-Id', $Id, '-Notes', ("'" + $note + "`n- what changed'"))
    Show $r
    $doc = Feed
    $ok = ($r.Code -eq 0 -and $doc.PSObject.Properties['baseline'] -and [string]$doc.baseline.id -eq $Id)
    if ($ok) { $script:records[$Id] = Record-Of $doc }
    return $ok
}

Write-Host ''; Write-Host 'the real Publish-Update.ps1'
$r = Publish @('-Baseline')
Yes 'the build the installer carries is recorded as published (-Baseline)' ($r.Code -eq 0)
Show $r
# What the installer carries: the build as it stood then, with the required data
# Publish-Update places, and without the collection's file.
$installerFiles = @{}
$gameAt = Join-Path $pub 'Game'
foreach ($f in @(Get-ChildItem -LiteralPath $gameAt -Recurse -File)) {
    $k = $f.FullName.Substring($gameAt.Length + 1)
    if ($k -ne 'Data\collection.esp') { $installerFiles[$k] = [IO.File]::ReadAllBytes($f.FullName) }
}

$R1 = '20260930-0100'; $R2 = '20260930-0200'; $R3 = '20260930-0300'
Set-Build 'Data\Platform\UI\thornswood-ours.esp' 'the plugin, first release'
Drop-Build 'Data\Platform\UI\thornswood-old.esp'
Set-Build 'Data\Platform\UI\thornswood-new1.esp' 'added by the first release'
Yes 'the first release goes out' (Release $R1 'The first release of the test')
$d1 = Feed; $m1 = $records[$R1]
Yes '  its record says every file is on the site beside it' ($null -ne $m1 -and [string]$m1[':record:files'] -eq '1')
$shas = Get-RecordFileShas $m1
$absent = @($shas.Keys | Where-Object { -not (Test-Path -LiteralPath (Join-Path $feedDir "assets\$_")) })
Yes ("  and every one is: {0} file(s), each at /feed/assets/<its sha256>" -f $shas.Count) ($shas.Count -ge 6 -and $absent.Count -eq 0)
# The signed manifest (#2163, phase B): on the site by its sha256, named by the
# feed, and listing the baseline record that names every file above.
$smOk = $false
if ($d1.PSObject.Properties['signedManifest']) {
    $smFile = Join-Path $feedDir ("assets\" + [string]$d1.signedManifest.sha256)
    $smCat = Join-Path $feedDir ("assets\" + [string]$d1.signedManifest.catalogSha256)
    if ((Test-Path -LiteralPath $smFile) -and (Test-Path -LiteralPath $smCat)) {
        $smDoc = [IO.File]::ReadAllText($smFile) | ConvertFrom-Json
        $smOk = ($smDoc.release -eq $R1 -and (@($smDoc.assets | ForEach-Object { $_.sha256 }) -contains [string]$d1.baseline.sha256))
    }
}
Yes '  the feed names its signed manifest, on the site with its catalog, listing the baseline record' $smOk
$okBytes = $true
foreach ($k in @($m1.Keys | Where-Object { -not $_.StartsWith(':') })) {
    $sha = ([string]$m1[$k]).Split(':')[1]
    if ((Get-BaselineFileSha (Join-Path $feedDir "assets\$sha")) -ne $sha) { $okBytes = $false }
}
Yes '  each asset''s bytes are its name' $okBytes
Yes '  the collection''s file is not in it' (-not $m1.ContainsKey('Data\collection.esp'))
$packZip = Join-Path $feedDir ("assets\" + [string]@($d1.packs)[-1].sha256)
$z = [IO.Compression.ZipFile]::OpenRead($packZip)
try { $e = $z.GetEntry('profile/plugins.txt'); $s = $e.Open(); try { $packList = Get-BaselineStreamSha $s } finally { $s.Dispose() } } finally { $z.Dispose() }
Yes '  it carries the plugin list as the pack carries it' ($m1.ContainsKey(':golden:plugins.txt') -and ([string]$m1[':golden:plugins.txt']).EndsWith(':' + $packList) -and $m1.ContainsKey(':golden:loadorder.txt'))
Yes '  the file the release dropped is gone' ([string]$m1[':gone:Data\Platform\UI\thornswood-old.esp'] -eq 'removed')
Yes '  and so is the one a pack took out before any record, read off that pack''s delete.txt' ([string]$m1[':gone:Data\Platform\UI\thornswood-ancient.esp'] -eq 'removed')
Yes '  the packs are still on the feed, for launchers that replay them' (@($d1.packs).Count -eq 2 -and [string]@($d1.packs)[-1].id -eq $R1)

Set-Build 'Data\Platform\Plugins\thornswood-ui.js' 'ui, second release'
$big = Bytes (3 * 1048576 + 12345) 7
Set-Build 'Data\Platform\UI\thornswood-big.bsa' $big
Yes 'the second release goes out' (Release $R2 'The second release of the test')
Set-Build 'Data\Platform\UI\thornswood-ours.bsa' ('y' * 4096)
Set-Build 'Data\Platform\UI\thornswood-new3.esp' 'added by the third release'
Yes 'the third release goes out' (Release $R3 'The third release of the test')
$d3 = Feed
Yes '  every release''s record says its files are up, and the gone list carries forward' (
    [string]$records[$R2][':record:files'] -eq '1' -and [string]$records[$R3][':record:files'] -eq '1' -and
    [string]$records[$R3][':gone:Data\Platform\UI\thornswood-old.esp'] -eq 'removed' -and [string]$records[$R3][':gone:Data\Platform\UI\thornswood-ancient.esp'] -eq 'removed')
Yes ("  the feed still lists the packs ({0}) beside the record" -f @($d3.packs).Count) (@($d3.packs).Count -eq 4)
# #1178 (from #3419): the other authors' files the packs shipped before the scrub, gone by sha256.
$snoDoc = [IO.File]::ReadAllText((Join-Path $repo 'records\shipped-not-ours.json')) | ConvertFrom-Json
$snoMissing = @($snoDoc.files.PSObject.Properties | Where-Object { [string]$records[$R3][':gone:' + $_.Name] -ne [string]$_.Value.sha256 })
Yes ("  and every record carries records\shipped-not-ours.json's files as gone by their sha256 ({0} not)" -f $snoMissing.Count) (
    $snoMissing.Count -eq 0 -and [string]$records[$R1][':gone:Data\Scripts\MCM_ConfigBase.pex'] -match '^[0-9a-f]{64}$')

# ---- the launcher reads it ----------------------------------------------------
Write-Host ''; Write-Host 'the launcher reads the feed'
function Raw($x) { if ($x -is [Management.Automation.PSObject]) { return $x.PSObject.BaseObject }; return $x }
function Parse-Feed { return (Raw ($mParse.Invoke($null, @(, [IO.File]::ReadAllBytes((Site-Feed $feedDir)))))) }
# Pending takes the config first (#4825), for whether the game files come from
# the Velopack package instead; nothing here was installed by Velopack, so it
# offers the record and the packs the feed names, which is what is tested.
function Pending-Of($v) { $a = New-Object 'object[]' 2; $a[0] = (Raw $cfg); $a[1] = (Raw $v); return @($mPending.Invoke($null, $a) | ForEach-Object { Raw $_ }) }
$v = Parse-Feed
Yes 'VersionDoc.Parse reads the record the feed names' ($null -ne $v.record -and $v.record.id -eq $R3 -and $v.record.sha256 -eq [string]$d3.baseline.sha256)
$oddFeeds = @(
    '{"launcherVersion":"1","packs":[{"id":"a","url":"u","sha256":"s"}],"baseline":5}',
    '{"launcherVersion":"1","packs":[{"id":"a","url":"u","sha256":"s"}],"baseline":{"id":"x","sha256":"not a hash","url":"https://thornswood.net/feed/assets/x"}}',
    '{"launcherVersion":"1","packs":[{"id":"a","url":"u","sha256":"s"}]}'
)
$allRead = $true
foreach ($oddText in $oddFeeds) {
    $o = $mParse.Invoke($null, @(, $utf8.GetBytes($oddText)))
    if ($null -eq $o -or @($o.packs).Count -ne 1 -or $null -ne $o.record) { $allRead = $false }
}
Yes 'a "baseline" of any other shape costs only that field: the feed still reads, and it has no record' $allRead

# ---- installs ---------------------------------------------------------------------
function New-Install([string]$name, [hashtable]$files, [string[]]$applied) {
    $root = Join-Path $T "inst\$name"
    foreach ($d in 'Game\Data', 'Profile\Default', 'Profile\Packs', 'Launcher') { New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null }
    foreach ($k in $files.Keys) {
        $f = Join-Path (Join-Path $root 'Game') $k
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f) | Out-Null
        $c = $files[$k]
        if ($c -is [byte[]]) { [IO.File]::WriteAllBytes($f, $c) } else { [IO.File]::WriteAllText($f, [string]$c, $ascii) }
    }
    if ($null -ne $applied) { [IO.File]::WriteAllLines((Join-Path $root 'Profile\applied.txt'), [string[]]@($applied)) }
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
# What a launcher from #1050 on does with the feed: Pending, then for the entry
# that stands for a release, the sync (through Sync itself, with the site at
# 127.0.0.1 rather than https), and for a pack, Install from the site's bytes.
function Invoke-Sync($rec, $v, [string]$base = $at) {
    $a = New-Object 'object[]' 5
    $a[0] = (Raw $cfg); $a[1] = [string]$base; $a[2] = (Raw $rec); $a[3] = (Raw $v); $a[4] = $log
    return [bool]$mSync.Invoke($null, $a)
}
function Install-Pack($p) {
    $sha = ([string]$p.sha256).ToLowerInvariant()
    $a = New-Object 'object[]' 3
    $a[0] = [string](Join-Path $feedDir "assets\$sha"); $a[1] = (Raw $p); $a[2] = $log
    [void]$mInstall.Invoke($null, $a)
}
function Update-New([string]$root, [string]$base = $at) {
    Use-Install $root
    $script:said.Clear()
    $v = Parse-Feed
    $pending = (Pending-Of $v)
    $n = 0
    foreach ($p in $pending) {
        if ($null -ne $p.Record) {
            if (-not (Invoke-Sync $p.Record $p.Doc $base)) { foreach ($q in (Pending-Of $v)) { Install-Pack $q; $n++ } }
        } else { Install-Pack $p }
        $n++
    }
    return $n
}
# An old launcher: every pack id not in applied.txt, in order, and nothing else.
function Update-Old([string]$root) {
    Use-Install $root
    $done = @()
    $af = Join-Path $root 'Profile\applied.txt'
    if (Test-Path -LiteralPath $af) { $done = @(Get-Content -LiteralPath $af | ForEach-Object { $_.Trim() }) }
    $n = 0
    foreach ($p in @((Parse-Feed).packs)) { if ($done -notcontains $p.id) { Install-Pack $p; $n++ } }
    return $n
}
function Get-Game([string]$root) {
    $game = Join-Path $root 'Game'
    $m = @{}
    foreach ($f in @(Get-ChildItem -LiteralPath $game -Recurse -File)) { $m[$f.FullName.Substring($game.Length + 1)] = Get-BaselineEntry $f.FullName }
    return $m
}
# The game folder against a record: every file of ours at its bytes, nothing of
# ours it does not list. $extra are files that are not ours and stay.
function Test-Lands([string]$root, [hashtable]$want, [string[]]$extra = @()) {
    $have = Get-Game $root
    $bad = @()
    foreach ($k in @($want.Keys)) {
        if ($k.StartsWith(':')) { continue }
        if (-not $have.ContainsKey($k)) { $bad += "missing $k" } elseif ($have[$k] -ne $want[$k]) { $bad += "wrong $k" }
    }
    foreach ($k in @($have.Keys)) { if (-not $want.ContainsKey($k) -and $extra -notcontains $k) { $bad += "extra $k" } }
    if ($bad.Count) { Write-Host ('      ' + ($bad -join '; ')) }
    return ($bad.Count -eq 0)
}
function Plugins-Match([string]$root, [hashtable]$want) {
    $f = Join-Path $root 'Profile\Default\plugins.txt'
    return ((Test-Path -LiteralPath $f) -and ('{0}' -f (Get-BaselineEntry $f)) -eq [string]$want[':golden:plugins.txt'])
}
function Synced([string]$root) { $f = Join-Path $root 'Profile\release.txt'; if (Test-Path -LiteralPath $f) { return [IO.File]::ReadAllText($f) } else { return '' } }
function Said([string]$pattern) { return @($script:said | Where-Object { $_ -match $pattern }).Count -gt 0 }
function Fetched { $m = @($script:said | ForEach-Object { [regex]::Match($_, '^Downloading (\d+) file') } | Where-Object { $_.Success }); if ($m.Count) { return [int]$m[0].Groups[1].Value } else { return 0 } }
function Err($sb) { try { & $sb; return '' } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; return $e.Message } }

Write-Host ''; Write-Host 'a launcher that syncs to the record'
$ids = @('20260101-0000')
$fresh = New-Install 'fresh' $installerFiles $ids
Use-Install $fresh
$pend = @(Pending-Of (Parse-Feed))
Yes 'a fresh install as the installer left it is offered the release as one update, not its three packs' ($pend.Count -eq 1 -and $null -ne $pend[0].Record -and $pend[0].Record.id -eq $R3)
[void](Update-New $fresh)
Yes '  it syncs straight to the third release, file for file' (Test-Lands $fresh $records[$R3])
Yes ("  downloading only what differs from what it had: six game files and the plugin list's two ({0})" -f (Fetched)) ((Fetched) -eq 8)
Yes '  with the plugin list the release shipped, in Profile\Default' (Plugins-Match $fresh $records[$R3])
Yes '  it writes down which release it is on' ((Synced $fresh) -match ([regex]::Escape([string]$d3.baseline.sha256) + ' ' + $R3))
Yes '  and every pack on the feed as behind it, so an old feed shape replays nothing' (@(Get-Content (Join-Path $fresh 'Profile\applied.txt')).Count -eq 4)
Yes '  after which nothing is pending' ((Pending-Of (Parse-Feed)).Count -eq 0)
# The release's game files, kept for Thornswood's own folder (#1232): the
# only record of a file the sync found already right.
$rf = Join-Path $fresh 'Profile\release-files.txt'
$rfLines = @(); if (Test-Path -LiteralPath $rf) { $rfLines = @([IO.File]::ReadAllLines($rf)) }
$gameKeys = @($records[$R3].Keys | Where-Object { -not ([string]$_).StartsWith(':') } | ForEach-Object { [string]$_ } | Sort-Object)
$kept = @(); if ($rfLines.Count -gt 1) { $kept = @($rfLines[1..($rfLines.Count - 1)] | Sort-Object) }
Yes ("  and keeps the list of the game files that release ships ({0})" -f $kept.Count) (
    $rfLines.Count -gt 1 -and $rfLines[0] -eq ('release ' + ([string]$d3.baseline.sha256).ToLowerInvariant() + ' ' + $R3) -and (($kept -join '|') -eq ($gameKeys -join '|')))
# As a launcher from before #1232 left it: on the release, with no list.
Remove-Item -LiteralPath $rf
$again = @(Pending-Of (Parse-Feed))
Yes 'an install synced before the list was kept is offered the same release once more' ($again.Count -eq 1 -and $null -ne $again[0].Record -and $again[0].Record.id -eq $R3)
[void](Update-New $fresh)
Yes '  the check downloads nothing, keeps the list, and then nothing is pending' ((Fetched) -eq 0 -and (Test-Path -LiteralPath $rf) -and (Pending-Of (Parse-Feed)).Count -eq 0)
$noApplied = New-Install 'no-applied' $installerFiles $null
[void](Update-New $noApplied)
Yes 'a fresh install with no applied.txt at all reaches the third release too' ((Test-Lands $noApplied $records[$R3]) -and @(Get-Content (Join-Path $noApplied 'Profile\applied.txt')).Count -eq 4)

# One behind: an install on the second release.
$one = New-Install 'one-behind' @{} $ids
$saveFeed = [IO.File]::ReadAllBytes((Site-Feed $feedDir))
Use-Install $one
# The list of releases is the store's releases.json since #1050, beside the
# feed and not in it.
$storeReleases = @(Get-StoreReleases $feedDir (Feed))
Yes 'the releases a rollback can go back to are in the store beside the feed, and the feed carries none' (
    $storeReleases.Count -ge 3 -and -not $d3.PSObject.Properties['releases'])
$r2ptr = @($storeReleases | Where-Object { $_.id -eq $R2 })[0]
$rec2 = [Activator]::CreateInstance($asm.GetType('Thornswood.RecordRef')); $rec2.id = $R2; $rec2.sha256 = [string]$r2ptr.sha256; $rec2.url = [string]$r2ptr.url
$script:said.Clear()
[void](Invoke-Sync $rec2 (Parse-Feed))
Yes ("an empty install syncs to the second release by its record in the feed's list ({0} files)" -f (Fetched)) ((Test-Lands $one $records[$R2]) -and (Fetched) -eq (Get-RecordFileShas $records[$R2]).Count)
[void](Update-New $one)
Yes 'one release behind, it downloads only the two files the third release changed' ((Test-Lands $one $records[$R3]) -and (Fetched) -eq 2)

# Several behind: as the installer left it, and it never took the old pack that
# removed Data\Platform\UI\thornswood-ancient.esp.
$several = @{}; foreach ($k in $installerFiles.Keys) { $several[$k] = $installerFiles[$k] }
$several['Data\Platform\UI\thornswood-ancient.esp'] = 'an old plugin an old pack took out'
$sev = New-Install 'several-behind' $several @()
[void](Update-New $sev)
Yes 'several releases behind, it lands on the third release' (Test-Lands $sev $records[$R3])
Yes '  having taken out what the first release dropped and what the old pack took out' ((Said '^removed Data\\Platform\\UI\\thornswood-old\.esp') -and (Said '^removed Data\\Platform\\UI\\thornswood-ancient\.esp'))

# A file Vortex deploys now is the collection's, not ours, whatever a record says.
$vx = New-Install 'vortex' $installerFiles $ids
Put (Join-Path $vx 'Game\Data\vortex.deployment.json') '{"files":[{"relPath":"Platform\\UI\\thornswood-old.esp","source":"a mod"}]}'
[void](Update-New $vx)
Yes 'a file of ours a release dropped stays when Vortex deploys that path now' (
    (Test-Lands $vx $records[$R3] @('Data\Platform\UI\thornswood-old.esp', 'Data\vortex.deployment.json')) -and (Test-Path -LiteralPath (Join-Path $vx 'Game\Data\Platform\UI\thornswood-old.esp')) -and (Said 'collection''s now and stayed'))

# ---- the download apart from the write (#2210) ------------------------------------
# Patrick, 12 Oct: the game folder is prepared during the update's download. So
# the sync's first half downloads and writes nothing into the game folder or the
# records, and its second half writes, and checks again any file that changed
# between the two (a refresh brought it up to date from Vortex meanwhile).
Write-Host ''; Write-Host 'an update that downloads while the game folder is prepared (#2210)'
$mPrep = $U.GetMethod('PrepareSync', $flags); $mWrite = $U.GetMethod('WriteSync', $flags)
Yes 'the sync is two halves, PrepareSync and WriteSync' ($null -ne $mPrep -and $null -ne $mWrite)
$side = New-Install 'beside' $installerFiles $ids
Use-Install $side
$vNow = Parse-Feed
$before = Get-Game $side
$script:said.Clear()
$a = New-Object 'object[]' 5
$a[0] = (Raw $cfg); $a[1] = [string]$at; $a[2] = (Raw $vNow.record); $a[3] = (Raw $vNow); $a[4] = $log
$plan = $mPrep.Invoke($null, $a)
$mid = Get-Game $side
$same = ($before.Count -eq $mid.Count)
foreach ($k in @($before.Keys)) { if (-not $mid.ContainsKey($k) -or $mid[$k] -ne $before[$k]) { $same = $false } }
Yes 'the download half leaves the game folder exactly as it was' ($null -ne $plan -and $same)
Yes '  and does not say the install is on the release' ((Synced $side) -notmatch [regex]::Escape($R3))
$staged = @(Get-ChildItem -LiteralPath (Join-Path $side 'Profile\Sync') -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[0-9a-f]{64}$' })
Yes ("  the files it fetched wait in Profile\Sync ({0})" -f $staged.Count) ($staged.Count -eq (Fetched) -and $staged.Count -gt 0)
# A refresh beside the download puts other bytes at a path the check found right.
$matched = @($records[$R3].Keys | Where-Object { -not ([string]$_).StartsWith(':') -and $before.ContainsKey([string]$_) -and $before[[string]$_] -eq $records[$R3][[string]$_] } | ForEach-Object { [string]$_ })
Yes ("a file of ours the check found right is there to change ({0})" -f $matched.Count) ($matched.Count -gt 0)
$moved = Join-Path (Join-Path $side 'Game') $matched[0]
Remove-Item -LiteralPath $moved -Force
[IO.File]::WriteAllText($moved, 'what a refresh brought from Vortex meanwhile', $ascii)
$w = New-Object 'object[]' 3
$w[0] = (Raw $cfg); $w[1] = $plan; $w[2] = $log
[void]$mWrite.Invoke($null, $w)
Yes 'the write half lands the release, the file changed meanwhile included' (Test-Lands $side $records[$R3])
Yes '  and says that file changed while it downloaded' (Said 'changed while it downloaded')
Yes '  and only then says the install is on the release, with Profile\Sync gone' (((Synced $side) -match [regex]::Escape($R3)) -and -not (Test-Path -LiteralPath (Join-Path $side 'Profile\Sync')))

# ---- other authors' files we shipped leave only when the bytes match (#1261) ----
Write-Host ''; Write-Host 'other authors files we shipped (#1261)'
$shipped = 'racemenu bytes we once shipped'
$own = 'a person put their own RaceMenu here'
$ms = New-Object IO.MemoryStream (,$ascii.GetBytes($shipped))
$shippedSha = (Get-FileHash -InputStream $ms -Algorithm SHA256).Hash.ToLowerInvariant()
$ms.Dispose()
$hashGone = @{}
foreach ($k in $records[$R3].Keys) { $hashGone[$k] = $records[$R3][$k] }
$hashGone[':gone:Data\Interface\racesex_menu.swf'] = $shippedSha
$hashFile = Join-Path $T 'hash-gone.json'
$hashSha = Write-BaselineFile $hashGone $hashFile
Copy-Item -LiteralPath $hashFile -Destination (Join-Path $feedDir ("assets\" + $hashSha))
$saveFeed2 = [IO.File]::ReadAllBytes((Site-Feed $feedDir))
$doc = Feed
$doc.baseline = [pscustomobject]@{ id = 'hash-gone'; sha256 = $hashSha; url = ("https://thornswood.net/feed/assets/" + $hashSha); entries = $hashGone.Count }
[IO.File]::WriteAllText((Next-SiteFeed $feedDir), ($doc | ConvertTo-Json -Depth 6), $utf8)
$matchFiles = @{} + $installerFiles
$matchFiles['Data\Interface\racesex_menu.swf'] = $shipped
$hm = New-Install 'hash-match' $matchFiles $ids
[void](Update-New $hm)
Yes 'a copy whose bytes still match what we shipped is removed' (
    -not (Test-Path -LiteralPath (Join-Path $hm 'Game\Data\Interface\racesex_menu.swf')) -and (Said '^removed Data\\Interface\\racesex_menu\.swf'))
$ownFiles = @{} + $installerFiles
$ownFiles['Data\Interface\racesex_menu.swf'] = $own
$ho = New-Install 'hash-own' $ownFiles $ids
[void](Update-New $ho)
Yes 'a person''s own copy of the same path is left alone' (
    (Test-Path -LiteralPath (Join-Path $ho 'Game\Data\Interface\racesex_menu.swf')) -and
    ((Get-Content -LiteralPath (Join-Path $ho 'Game\Data\Interface\racesex_menu.swf') -Raw) -eq $own) -and
    -not (Said '^removed Data\\Interface\\racesex_menu\.swf'))
[IO.File]::WriteAllBytes((Next-SiteFeed $feedDir), $saveFeed2)

# ---- the old launcher beside it -----------------------------------------------
Write-Host ''; Write-Host 'an old launcher on the same feed'
$oldL = New-Install 'old-launcher' $installerFiles $ids
Yes 'an old launcher replays the three packs' ((Update-Old $oldL) -eq 3)
Yes '  and lands on the same files as the record' (Test-Lands $oldL $records[$R3])

# ---- verified, resumed, finished ---------------------------------------------
Write-Host ''; Write-Host 'every download is checked, and a cut off one carries on'
$bigSha = ([string]$records[$R3]['Data\Platform\UI\thornswood-big.bsa']).Split(':')[1]
$bigAsset = Join-Path $feedDir "assets\$bigSha"
$half = [int]($big.Length / 2)
$bad = New-Object byte[] $big.Length
[Array]::Copy($big, $bad, $big.Length)
for ($i = 0; $i -lt $half; $i++) { $bad[$i] = [byte](255 - $bad[$i]) }
[IO.File]::WriteAllBytes($bigAsset, $bad)
$chk = New-Install 'checked' $installerFiles $ids
$before = Get-Game $chk
Use-Install $chk
$why = Err { [void](Update-New $chk) }
Yes 'a download whose bytes are not its sha256 is refused' ($why -match 'Checksum did not match')
Yes '  and nothing in the install moved, nor is it written down as synced' ((($before.Keys | Where-Object { (Get-Game $chk)[$_] -ne $before[$_] }).Count -eq 0) -and -not (Synced $chk))
$cut = New-Install 'cut-off' $installerFiles $ids
New-Item -ItemType Directory -Force -Path (Join-Path $cut 'Profile\Sync') | Out-Null
$part = New-Object byte[] $half
[Array]::Copy($big, $part, $half)
[IO.File]::WriteAllBytes((Join-Path $cut "Profile\Sync\$bigSha.part"), $part)
$why = Err { [void](Update-New $cut) }
Yes 'a download cut off halfway carries on from where it stopped (only a Range request gets these bytes right)' ($why -eq '' -and (Test-Lands $cut $records[$R3]))
[IO.File]::WriteAllBytes($bigAsset, $big)

# Cut off after the downloads: one file could not be put in place.
$stop = New-Install 'stopped' $installerFiles $ids
New-Item -ItemType Directory -Force -Path (Join-Path $stop 'Game\Data\Platform\UI\thornswood-new3.esp') | Out-Null
$why = Err { [void](Update-New $stop) }
Yes 'a sync that stops after its downloads is not written down as done' ($why -ne '' -and -not (Synced $stop) -and (Test-Path -LiteralPath (Join-Path $stop "Profile\Sync\$bigSha")))
Remove-Item -LiteralPath (Join-Path $stop 'Game\Data\Platform\UI\thornswood-new3.esp') -Recurse -Force
$why = Err { [void](Update-New $stop "http://127.0.0.1:$dead/feed/assets/") }
Yes '  and the next one finishes from what it had fetched, with the site out of reach' ($why -eq '' -and (Test-Lands $stop $records[$R3]))
Yes '  then tidies what it fetched away' (-not (Test-Path -LiteralPath (Join-Path $stop 'Profile\Sync')))

# A file changed by hand.
$tamper = Join-Path $fresh 'Game\Data\Platform\UI\thornswood-ours.bsa'
[IO.File]::WriteAllText($tamper, ('z' * 4096), $ascii)
Use-Install $fresh
Yes 'a file changed by hand is not a new release: nothing is offered' ((Pending-Of (Parse-Feed)).Count -eq 0)
$script:said.Clear()
$vv = Parse-Feed
[void](Invoke-Sync $vv.record $vv)
Yes '  but a sync to the release (Updater.Resync) finds it by its sha256 and puts only it right' ((Test-Lands $fresh $records[$R3]) -and (Fetched) -eq 1)

# A record that does not say its files are up: the packs, and not again.
$plain = @{}; foreach ($k in $records[$R3].Keys) { if ($k -ne ':record:files') { $plain[$k] = $records[$R3][$k] } }
$plainFile = Join-Path $T 'plain.json'
$plainSha = Write-BaselineFile $plain $plainFile
Copy-Item -LiteralPath $plainFile -Destination (Join-Path $feedDir "assets\$plainSha")
$doc = Feed
$doc.baseline = [pscustomobject]@{ id = 'plain'; sha256 = $plainSha; url = "https://thornswood.net/feed/assets/$plainSha"; entries = $plain.Count }
[IO.File]::WriteAllText((Next-SiteFeed $feedDir), ($doc | ConvertTo-Json -Depth 6), $utf8)
$pl = New-Install 'plain' $installerFiles $ids
[void](Update-New $pl)
Yes 'a record without :record:files is taken as packs, pack by pack' ((Test-Lands $pl $records[$R3]) -and (Said 'pack by pack'))
Use-Install $pl
Yes '  and is not offered again' ((Pending-Of (Parse-Feed)).Count -eq 0 -and (Synced $pl) -match "packs $plainSha")
[IO.File]::WriteAllBytes((Next-SiteFeed $feedDir), $saveFeed)

# ---- a rollback, for both ---------------------------------------------------------
Write-Host ''; Write-Host 'Rollback-Feed.ps1, for both kinds of launcher'
$rbScript = Join-Path $fake 'scripts\release\Rollback-Feed.ps1'
$work = Join-Path $T 'rb-work'; $rbRel = Join-Path $T 'rb-rel'
function Rollback([string[]]$more) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $rbScript, '-Channel', 'main', '-NoPause', '-SiteDir', $site, '-SiteUrl', $siteUrl,
           '-ReleaseDir', $rbRel, '-WorkDir', $work) + $more
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & $Shell @a 2>&1 | ForEach-Object { "$_" }
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($rc -ne 0) { Write-Host ((@($out) | Select-Object -Last 10) -join "`n") -ForegroundColor DarkGray }
    return [pscustomobject]@{ Code = $rc; Out = ($out -join "`n") }
}
$RB = '20260930-0400'
$r = Rollback @('-Back', '1', '-Id', $RB)
$db = Feed; $mb = Record-Of $db
Yes 'the feed goes back a release, as one more pack and a new record' ($r.Code -eq 0 -and [string]$db.baseline.id -eq $RB -and [string]@($db.packs)[-1].id -eq $RB)
Yes '  the record says its files are up, and they are' ([string]$mb[':record:files'] -eq '1' -and
    @((Get-RecordFileShas $mb).Keys | Where-Object { -not (Test-Path -LiteralPath (Join-Path $feedDir "assets\$_")) }).Count -eq 0)
Yes '  and says the file the third release added is gone' ([string]$mb[':gone:Data\Platform\UI\thornswood-new3.esp'] -eq 'removed')
[void](Update-New $fresh)
Yes 'a launcher that syncs lands on the second release''s files' ((Test-Lands $fresh $records[$R2]) -and (Plugins-Match $fresh $records[$R2]))
Yes '  downloading only the file that went back' ((Fetched) -eq 1)
Yes 'an old launcher takes the rollback pack and lands there too' ((Update-Old $oldL) -eq 1 -and (Test-Lands $oldL $records[$R2]))
Yes 'an install that was several behind lands there as well' (((Update-New $sev) -ge 1) -and (Test-Lands $sev $records[$R2]))
$RF = '20260930-0500'
$r = Rollback @('-To', $R3, '-Id', $RF)
Yes 'and forward again to the third' ($r.Code -eq 0 -and [string](Feed).baseline.id -eq $RF)
[void](Update-New $fresh); [void](Update-Old $oldL)
Yes '  both kinds of launcher follow it' ((Test-Lands $fresh $records[$R3]) -and (Test-Lands $oldL $records[$R3]))

# ---- the packs come off the feed (#1050) ------------------------------------------
# Once the launcher the feed lets in (minLauncher, which a publish sets to the
# launcher it offers) is at or above the first one that syncs (main 1.1.103), a
# release adds no pack and the feed's packs become []. As if 1.2.3 had shipped:
Write-Host ''; Write-Host 'the packs come off the feed'
$fd = Feed
$fd.launcherVersion = '1.2.3'; $fd.minLauncher = '1.2.3'
Put (Next-SiteFeed $feedDir) ($fd | ConvertTo-Json -Depth 8)
$R5 = '20260930-0600'
Set-Build 'Data\Platform\UI\thornswood-new3.esp' 'changed by the fifth release'
$note5 = 'Keys open their own doors'
Yes 'a release goes out with every launcher let in syncing to the record' (Release $R5 $note5)
$d5 = Feed; $m5 = $records[$R5]
Yes '  the feed carries packs as an empty list, the shape every launcher reads' ($d5.PSObject.Properties['packs'] -and @($d5.packs).Count -eq 0 -and
    ([IO.File]::ReadAllText((Site-Feed $feedDir)) -match '"packs":\s*\[\s*\]'))
Yes '  and minLauncher is 1.2.3' ([string]$d5.minLauncher -eq '1.2.3')
# The launchers in this harness sync from feeds the publisher wrote, so their
# passes are also the proof that a launcher reads one written this way.
Yes '  the publisher writes version.json compact, one line, and its release carries no uiAssets (#1050)' (
    ([IO.File]::ReadAllText((Site-Feed $feedDir)) -notmatch '[\r\n]') -and -not $d5.release.PSObject.Properties['uiAssets'])
Yes '  the release names no pack, and its record says every file is up' (@($d5.release.packs).Count -eq 0 -and [string]$m5[':record:files'] -eq '1' -and
    @((Get-RecordFileShas $m5).Keys | Where-Object { -not (Test-Path -LiteralPath (Join-Path $feedDir "assets\$_")) }).Count -eq 0)
$zip5 = @(Get-ChildItem -LiteralPath (Join-Path $pub 'dist') -Recurse -File -Filter "pack-$R5.zip")
Yes '  its pack was built for the secrets check and kept here, and never sent' ($zip5.Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $feedDir ("assets\" + (Get-BaselineFileSha $zip5[0].FullName)))))
Yes '  the record''s pointer carries the note''s title, for the update card' ([string]$d5.baseline.notes -ceq $note5)
$list5 = @(Get-StoreReleases $feedDir (Feed))
Yes '  the store''s list starts with it, ending on no pack' ([string]$list5[0].id -eq $R5 -and [string]$list5[0].lastPack -eq '' -and -not $d5.PSObject.Properties['releases'])
$bad5 = @(Get-ReleaseDisagreements $d5 $list5)
Yes ('  every name for it agrees' + $(if ($bad5.Count) { ': ' + ($bad5 -join '; ') } else { '' })) ($bad5.Count -eq 0)
$sz = (Get-Item -LiteralPath (Site-Feed $feedDir)).Length
Yes ("  version.json is {0:n0} bytes" -f $sz) ($sz -gt 0)

Use-Install $fresh
$pend5 = @(Pending-Of (Parse-Feed))
Yes 'a launcher on the last release is offered this one, with its note on the card' ($pend5.Count -eq 1 -and $null -ne $pend5[0].Record -and $pend5[0].Record.id -eq $R5 -and
    [string]$pend5[0].notes -ceq $note5)
[void](Update-New $fresh)
Yes '  and syncs to it, downloading the one file that changed' ((Test-Lands $fresh $m5) -and (Fetched) -eq 1 -and (Pending-Of (Parse-Feed)).Count -eq 0)
$noApplied5 = New-Install 'no-applied-5' $installerFiles $null
[void](Update-New $noApplied5)
Yes 'a fresh install with no applied.txt reaches it from the record alone' ((Test-Lands $noApplied5 $m5) -and (Plugins-Match $noApplied5 $m5))
$sev5 = New-Install 'several-behind-5' $several @()
[void](Update-New $sev5)
Yes 'one several releases behind lands on it, taking out what the old pack took out' ((Test-Lands $sev5 $m5) -and (Said '^removed Data\\Platform\\UI\\thornswood-ancient\.esp'))
Yes 'a launcher from before the sync finds no pack to replay, so the launcher is all it is offered' ((Update-Old $oldL) -eq 0)

# A rollback with the packs gone is the record alone.
$RG = '20260930-0700'
$r = Rollback @('-Back', '1', '-Id', $RG)
$dg = Feed; $mg = Record-Of $dg
$zipG = Join-Path $work "pack-$RG.zip"
Yes 'a rollback with the packs gone names a new record and sends no pack' ($r.Code -eq 0 -and [string]$dg.baseline.id -eq $RG -and @($dg.packs).Count -eq 0 -and
    (-not (Test-Path -LiteralPath $zipG) -or -not (Test-Path -LiteralPath (Join-Path $feedDir ("assets\" + (Get-BaselineFileSha $zipG))))))
Yes '  its record says every file is up, with the plugin list of the release it went back to' ([string]$mg[':record:files'] -eq '1' -and
    [string]$mg[':golden:plugins.txt'] -eq [string]$records[$R3][':golden:plugins.txt'])
$listG = @(Get-StoreReleases $feedDir (Feed))
Yes '  the store''s list names it first, put back to the release before' ([string]$listG[0].id -eq $RG -and [string]$listG[0].to -eq $RF -and [string]$listG[0].lastPack -eq '')
Yes '  and every name for it agrees' (@(Get-ReleaseDisagreements $dg $listG).Count -eq 0)
[void](Update-New $fresh)
Yes 'a launcher that syncs lands back on the third release''s files' ((Test-Lands $fresh $records[$R3]) -and (Fetched) -eq 1)
$r = Rollback @('-To', $R5, '-Id', '20260930-0800')
[void](Update-New $fresh)
Yes '  and forward again to the fifth' ($r.Code -eq 0 -and @((Feed).packs).Count -eq 0 -and (Test-Lands $fresh $m5))

# ---- the notes leave the feed too, from 1.2.4 (#1050) ----------------------------
# Every launcher up to 1.2.3 reads the News tab only out of "news", so on 1.2.3
# the notes stayed there; from the first launcher that reads the news file
# (Feed-News.ps1) they are one asset of their own.
Write-Host ''; Write-Host 'the notes leave the feed'
Yes 'on 1.2.3 the notes stayed in version.json and the feed named no news file' (@($d5.news).Count -ge 1 -and -not $d5.PSObject.Properties['newsFile'])
$fd = Feed
$fd.launcherVersion = '1.2.4'; $fd.minLauncher = '1.2.4'
Put (Next-SiteFeed $feedDir) ($fd | ConvertTo-Json -Depth 8)
$R6 = '20260930-0900'
Set-Build 'Data\Platform\UI\thornswood-new3.esp' 'changed by the sixth release'
Yes 'a release goes out with every launcher let in reading the news file' (Release $R6 'Notes in a file of their own')
$d6 = Feed
$nf = if ($d6.PSObject.Properties['newsFile'] -and $d6.newsFile) { Join-Path $feedDir ("assets\" + [string]$d6.newsFile.sha256) } else { '' }
Yes '  version.json carries "news" as [] and names the file, on this channel''s folder' (@($d6.news).Count -eq 0 -and $nf -and
    ([IO.File]::ReadAllText((Site-Feed $feedDir)) -match '"news":\s*\[\s*\]') -and [string]$d6.newsFile.url -eq ('https://thornswood.net/feed/assets/' + [string]$d6.newsFile.sha256))
$six = @(Get-FeedNewsList $d6 $site)
Yes ("  the file is on the site, its bytes its name, this release's note first and the {0} before it after" -f ($six.Count - 1)) (
    (Test-Path -LiteralPath $nf) -and (Get-BaselineFileSha $nf) -eq [string]$d6.newsFile.sha256 -and [string]$six[0].title -eq 'Notes in a file of their own' -and
    $six.Count -eq [int]$d6.newsFile.count -and @($six | Where-Object { [string]$_.title -eq $note5 }).Count -eq 1)
$sz6 = (Get-Item -LiteralPath (Site-Feed $feedDir)).Length
Yes ("  version.json is {0:n0} bytes, from {1:n0} with the notes in it" -f $sz6, $sz) ($sz6 -lt $sz)
$R7 = '20260930-1000'
Set-Build 'Data\Platform\UI\thornswood-new3.esp' 'changed by the seventh release'
Yes 'the next release adds its note to the file, and keeps every older one' ((Release $R7 'Another note on top') -and
    ((@(Get-FeedNewsList (Feed) $site) | ForEach-Object { [string]$_.title }) -join '|').StartsWith('Another note on top|Notes in a file of their own|'))

# ---- nothing here weakens the launcher's own update -------------------------------
Write-Host ''; Write-Host 'the launcher itself'
$src = [IO.File]::ReadAllText((Join-Path $app 'Sync.cs'))
$upd = [IO.File]::ReadAllText((Join-Path $app 'VeloUpdate.cs'))
Yes 'the sync never touches the launcher exe: it writes only under the game folder and Profile\Default' (
    $src -notmatch 'SelfUpdate\(|FetchLauncher\(|ApplyLauncher\(|Paths\.LauncherDir|\.exe\.new' -and $src -match 'Inside\(full, Paths\.Game\)')
# The launcher's own update is Velopack's since #4825 (VeloUpdate.cs): the
# package and the Update.exe that applies it are checked against the signer,
# by Signature.cs, before it is marked checked, and only a checked one is applied.
Yes 'the launcher''s own update still checks the signer before it goes in, and Signature.cs is what it asks' (
    $upd -match '(?s)public static void FetchLauncher.*?VeloPackage\.Refusal\(pkg, list, setup, ExpectedSigner,.*?Signature\.Refusal\(updateExe, ExpectedSigner, .*?u\.Checked = true;' -and
    $upd -match '(?s)public static void ApplyLauncher\(LauncherUpdate u\)\s*\{\s*if \(u == null \|\| !u\.Checked\) throw')
Yes 'the public sync checks the record''s address (https, the host list) before a byte is fetched' ($src -match '(?s)public static void SyncRecord.*?CheckUrl\(r\.url\);.*?AssetFolder\(r\)')

Done
