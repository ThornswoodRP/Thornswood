<#
  test-2308-content-before-ship.ps1

      pwsh -NoProfile -File .\tests\test-2308-content-before-ship.ps1

  The server gets the content plugin first, then the Ship (#2308). On 11 Oct
  dev 20261011-221215-dev sent clients a new Thornswood-Content.esp (146,381
  bytes), posted it, told the dev server to restart and pushed its tag while
  the dev server still had the old one (146,446 bytes). Publish-Update.ps1 now
  asks the channel's server which content plugin it holds whenever the
  release's is not the one the baseline recorded, and refuses, before
  anything is packed or sent, unless it is the same size and sha256.

  What this proves:
    1. Get-ThornswoodContentShipProblem (scripts\deploy\ServerContent.ps1):
       the same bytes pass; another sha256 at the same size, no plugin on the
       box, and a box that did not answer all refuse; the refusal names
       Deploy-DevGamemode.ps1 -LoadOrder for dev and Deploy-Server.ps1
       -GamemodeOnly for live.
    2. Read-ThornswoodServerContent runs its real far side text on a folder
       standing in for the server root, and reads the size, the sha256 and
       the server's own load order the way the box would; the stand-in is
       never used for a real host or outside the harness.
    3. The real Publish-Update.ps1, in a child PowerShell, against a
       stand-in site and store (-SiteDir) and a stand-in server folder:
       a. the release's content plugin is new and the server holds another:
          exit 1, the refusal names the command, and nothing was published
          (the store's version.json and published.json are the bytes they
          were, no asset reached the site, no release was named);
       b. the server holds the same plugin: the release goes out;
       c. the content plugin did not change since the last release: the
          release goes out whatever the server holds, because this release
          sends clients nothing new of it.
    4. Where the check sits in Publish-Update.ps1: after the diff and the
       "nothing to do" exit, before the pack, the upload and the feed send.

  Nothing connects anywhere but 127.0.0.1, and everything it writes is in its
  own temp folder.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
# Publish-Update takes no -Vps; its box here is this machine's stand-in.
$env:THORNSWOOD_VPS = '127.0.0.1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
# The feed below holds a runtime the server already serves, so it carries the note
# version Publish-Update writes today (Source-Notice.ps1), not a number that goes stale.
$noticeV = [int]([regex]::Match((Get-Content -LiteralPath (Join-Path $repo 'scripts\release\Source-Notice.ps1') -Raw), '\$SourceNoticeVersion = (\d+)').Groups[1].Value)
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function RunGit([string]$dir) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& git -C $dir @args 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Out = ($out -join "`n").Trim() }
}
function Read-Json([string]$path) { return (([IO.File]::ReadAllText($path)) -replace '^\uFEFF', '') | ConvertFrom-Json }
function Sha([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return '' }
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}
# The feed the stand-in site serves: the newest of its generations (#2727).
function SiteFeed([string]$site) {
    $g = @(Get-ChildItem -LiteralPath (Join-Path $site 'feed\version') -File | Where-Object { $_.Name -match '^\d{8}\.json$' } | Sort-Object Name | Select-Object -Last 1)
    return $g[0].FullName
}
function ShaOf([string]$text) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return -join ($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) } finally { $h.Dispose() }
}

$lib = Join-Path $repo 'scripts\deploy\ServerContent.ps1'
Yes 'scripts\deploy\ServerContent.ps1 is there' (Test-Path -LiteralPath $lib)
if (-not (Test-Path -LiteralPath $lib)) { Done }
. $lib

$script:gameServer = $null
$Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-2308-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$oldServerDir = $env:THORNSWOOD_TEST_SERVER_DIR

try {
    # ---- 1. the decision ---------------------------------------------------------------
    Write-Host ''; Write-Host 'the decision'
    $new = 'b' * 64; $old = 'a' * 64
    $entry = '146381:' + $new
    function Box([int64]$bytes, [string]$sha, [bool]$answered = $true) {
        return [pscustomobject]@{ Answered = $answered; Bytes = $bytes; Sha = $sha; Order = @(); OrderRead = $false; Said = @('CONTENT ...', 'DONE') }
    }
    Yes 'the server holds the same bytes: no problem' ((Get-ThornswoodContentShipProblem 'dev' $entry (Box 146381 $new)) -eq '')
    Yes '  and the sha256 is compared without case' ((Get-ThornswoodContentShipProblem 'dev' ('146381:' + $new.ToUpperInvariant()) (Box 146381 $new)) -eq '')
    $p = Get-ThornswoodContentShipProblem 'dev' $entry (Box 146446 $old)
    Yes 'the 11 Oct case, another size: refused, naming both sizes' ($p -match '146,381' -and $p -match '146,446')
    Yes '  and the command that sends it to the dev server, Deploy-DevGamemode.ps1 -LoadOrder' ($p.Contains('.\scripts\deploy\Deploy-DevGamemode.ps1 -LoadOrder'))
    Yes '  and the order: the server first, then the Ship' ($p -match 'server gets the content plugin first, then the Ship')
    $p = Get-ThornswoodContentShipProblem 'dev' $entry (Box 146381 $old)
    Yes 'the same size and another sha256: refused' ($p -ne '' -and $p -match 'holds another')
    $p = Get-ThornswoodContentShipProblem 'main' $entry (Box 146381 $old)
    Yes 'on main the refusal names the live server and Deploy-Server.ps1 -GamemodeOnly' ($p -match 'live server' -and $p.Contains('.\scripts\deploy\Deploy-Server.ps1 -GamemodeOnly'))
    $p = Get-ThornswoodContentShipProblem 'dev' $entry (Box -1 '')
    Yes 'no content plugin on the box: refused' ($p -match 'has none')
    $p = Get-ThornswoodContentShipProblem 'dev' $entry (Box 146381 $new $false)
    Yes 'a box that did not finish its answer: refused, even when the numbers it gave match' ($p -match 'did not say')
    $p = Get-ThornswoodContentShipProblem 'dev' $entry $null
    Yes 'no answer at all: refused' ($p -match 'did not say')
    $p = Get-ThornswoodContentShipProblem 'dev' '146381:12345' (Box 146381 $new)
    Yes 'a release record that is not a size and a sha256: refused' ($p -match 'not a size and a sha256')
    Yes 'the dev and live roots are the ones the deploys use' (
        (Get-ThornswoodServerContentRoot 'dev') -eq 'C:\Thornswood-Server-Dev' -and (Get-ThornswoodServerContentRoot 'main') -eq 'C:\Thornswood-Server')

    # ---- 2. the read, on a stand-in server folder --------------------------------------
    Write-Host ''; Write-Host 'the read'
    $srv = Join-Path $Scratch 'server'
    $esp = Join-Path $srv 'plugins\Thornswood-Content.esp'
    Put $esp 'the content plugin, version two'
    Put (Join-Path $srv 'server-settings.json') '{"port":7787,"loadOrder":["C:/Thornswood-Server-Dev/plugins/Skyrim.esm","C:/Thornswood-Server-Dev/plugins/Thornswood-Content.esp"]}'
    $env:THORNSWOOD_TEST_SERVER_DIR = $srv
    $r = Read-ThornswoodServerContent -Channel dev -Target 'Administrator@127.0.0.1'
    $want = Get-ThornswoodLocalContent $esp
    Yes ("the box text reads the plugin's size and sha256 ({0} bytes, {1})" -f $r.Bytes, $r.Sha.Substring(0, [Math]::Min(12, $r.Sha.Length))) (
        $r.Answered -and $r.Bytes -eq $want.Bytes -and $r.Sha -eq $want.Sha -and $want.Sha -eq (Sha $esp))
    Yes '  and the server''s own load order, by file name' ($r.OrderRead -and (@($r.Order) -join '|') -eq 'Skyrim.esm|Thornswood-Content.esp')
    Yes '  and Test-ThornswoodContentSame agrees' ((Test-ThornswoodContentSame $r $want.Bytes $want.Sha) -and -not (Test-ThornswoodContentSame $r $want.Bytes $old))
    Remove-Item -LiteralPath $esp -Force
    Put (Join-Path $srv 'server-settings.json') 'not json'
    $r = Read-ThornswoodServerContent -Channel dev -Target 'Administrator@127.0.0.1'
    Yes 'no plugin: it answers, with none' ($r.Answered -and $r.Bytes -eq -1 -and $r.Sha -eq '')
    Yes '  and settings that do not read give no order' (-not $r.OrderRead -and @($r.Order).Count -eq 0)
    $cut = ConvertFrom-ThornswoodServerContentLines @('CONTENT 10 ' + $new)
    Yes 'an answer cut off before DONE is not an answer' (-not $cut.Answered)
    Yes 'the stand-in is never used for a real host' ((Get-ThornswoodServerContentStandIn 'Administrator@192.0.2.10') -eq '')
    $env:THORNSWOOD_HARNESS = ''
    Yes '  nor outside the harness' ((Get-ThornswoodServerContentStandIn 'Administrator@127.0.0.1') -eq '')
    $env:THORNSWOOD_HARNESS = '1'
    $text = $ThornswoodServerContentText
    Yes 'the box text is ASCII and reads with .NET, not Get-FileHash' (
        -not ($text.ToCharArray() | Where-Object { [int]$_ -gt 127 }) -and $text -notmatch 'Get-FileHash' -and $text.Contains('Security.Cryptography.SHA256'))

    # ---- 3. the real Publish-Update.ps1 ------------------------------------------------
    Write-Host ''; Write-Host 'the real Publish-Update.ps1'
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Yes 'git is on PATH' $false; Done }
    $gitId = @('-c', 'user.name=Thornswood test', '-c', 'user.email=test@thornswood.invalid', '-c', 'commit.gpgsign=false')
    $fake = Join-Path $Scratch 'repo'
    New-Item -ItemType Directory -Force -Path $fake | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'scripts') -Destination $fake -Recurse -Force
    foreach ($f in 'layout.json', 'installer\licences\GPL-3.0.txt', 'installer\licences\AGPL-3.0.txt', 'records\generated.json', 'records\ui-gone.json', 'records\shipped-not-ours.json', 'records\client-build.json', 'records\client-licences.json', 'records\client-licences') {
        $from = Join-Path $repo $f
        if (Test-Path -LiteralPath $from) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $fake $f)) | Out-Null
            Copy-Item -LiteralPath $from -Destination (Join-Path $fake $f) -Force -Recurse
        }
    }
    $reqFrom = Join-Path $repo 'game\required-data'
    New-Item -ItemType Directory -Force -Path (Join-Path $fake 'game\required-data') | Out-Null
    if (Test-Path -LiteralPath $reqFrom) { Copy-Item -Path (Join-Path $reqFrom '*') -Destination (Join-Path $fake 'game\required-data') -Recurse -Force }
    # The content plugin this checkout holds, which Publish-Update places in the
    # game folder before the scan (Ensure-ShipRequiredData).
    $contentV2 = 'the content plugin, version two'
    Put (Join-Path $fake 'game\content\Thornswood-Content.esp') $contentV2
    # The real Stop-Game closes any Skyrim on the machine; nothing here may.
    Put (Join-Path $fake 'scripts\dev\Close-Launcher.ps1') "function Stop-Game { param([string]`$Root) return `$false }`r`nfunction Get-GameProcesses { param([string]`$Root) return @() }`r`n"
    # No signing setup here: the catalog Publish-Update signs (#2163, phase B) is left unsigned, and the stub answers that it passed.
    Put (Join-Path $fake 'scripts\release\Sign-ReleaseCatalog.ps1') "function Invoke-ReleaseCatalogSign { param([string]`$Catalog, [string]`$RepoDir) return '' }`r`n"
    [void](RunGit $fake init -q)
    [void](RunGit $fake @gitId add -A)
    [void](RunGit $fake @gitId commit -q -m 'the build')

    $inst = Join-Path $Scratch 'install'
    $site = Join-Path $Scratch 'site'
    $rel = Join-Path $Scratch 'rel'
    foreach ($dd in 'Game\Data', 'Profile\OwnGame', 'appdata', 'dist') { New-Item -ItemType Directory -Force -Path (Join-Path $inst $dd) | Out-Null }
    New-Item -ItemType Directory -Force -Path (Join-Path $site 'feed'), (Join-Path $site 'feed-dev'), $rel | Out-Null
    [IO.File]::WriteAllLines((Join-Path $inst 'Profile\OwnGame\files.txt'), @('F|V|1024|638000000000000000|Data\collection.esp'))
    Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'the plugin, changed'
    Put (Join-Path $inst 'Profile\OwnGame\plugins.txt') "*ours.esp`r`n"
    $pluginHeader = [byte[]]::new(24)
    [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($pluginHeader, 0)
    foreach ($plugin in 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'ours.esp') {
        [IO.File]::WriteAllBytes((Join-Path $inst "Game\Data\$plugin"), $pluginHeader)
    }
    Put (Join-Path $inst 'Profile\OwnGame\loadorder.txt') "ours.esp`r`n"
    . (Join-Path $repo 'tests\fixtures\ui-front.ps1')
    # The collection revision record, and a Vortex on it (#3597).
    . (Join-Path $repo 'tests\fixtures\collection-revision.ps1')
    $roaming = Join-Path $inst 'roaming'
    $null = Install-CollectionRevisionFixture -From $repo -RepoCopy $fake -AppData $roaming
    Install-UiFrontFixture (Join-Path $inst 'Game')
    $node = Get-Command node -ErrorAction SilentlyContinue
    Yes 'node is on PATH, for the stand-in game server''s manifest' ($null -ne $node)
    if ($null -eq $node) { Done }
    # The reference plugin list goes out in the game server's order, read from
    # its manifest; a stand-in on a port the system gives answers for it.
    $serverJs = Join-Path $Scratch 'server.js'
    Put $serverJs ("const srv = require('http').createServer(function (q, s) { s.setHeader('Content-Type', 'application/json'); " +
                   "s.end(JSON.stringify({ mods: ['Skyrim.esm','Update.esm','Dawnguard.esm','HearthFires.esm','Dragonborn.esm','ours.esp'].map(filename => ({ filename, size: 24, crc32: 1 })) })); }); " +
                   "srv.listen(0, '127.0.0.1', function () { console.log('listening on 127.0.0.1:' + srv.address().port); });")
    $gpsi = New-Object Diagnostics.ProcessStartInfo
    $gpsi.FileName = $node.Source; $gpsi.Arguments = '"' + $serverJs + '"'
    $gpsi.UseShellExecute = $false; $gpsi.CreateNoWindow = $true; $gpsi.RedirectStandardOutput = $true; $gpsi.RedirectStandardError = $true
    $script:gameServer = [Diagnostics.Process]::Start($gpsi)
    $null = $script:gameServer.StandardError.ReadToEndAsync()
    $first = $script:gameServer.StandardOutput.ReadLineAsync()
    $heard = if ($first.Wait(15000)) { [string]$first.Result } else { '' }
    $m = [regex]::Match($heard, '^listening on 127\.0\.0\.1:(\d+)$')
    $port = if ($m.Success) { [int]$m.Groups[1].Value } else { 0 }
    Yes "the stand-in game server is listening ($port)" ($port -gt 0)
    if (-not $port) { Done }
    $null = $script:gameServer.StandardOutput.ReadToEndAsync()
    Put (Join-Path $inst 'config.json') ('{"ServerAddress":"127.0.0.1","ServerPort":' + ($port - 1) + '}')
    Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.bsa') ('x' * 4096)
    # The last release on the store carried version one of the content plugin,
    # so this checkout's version two is a change the pack would send.
    $contentV1 = 'the content plugin, version one'
    $v1Entry = ('{0}:{1}' -f [Text.Encoding]::UTF8.GetByteCount($contentV1), (ShaOf $contentV1))
    $pFork = [string](((Get-Content -LiteralPath (Join-Path $fake 'records\client-build.json') -Raw) -replace '^\uFEFF', '') | ConvertFrom-Json).forkCommit
    Put (Join-Path $site 'feed\version\00000001.json') ('{"launcherVersion":"1.1.102","packs":[],"news":[],"clientRuntime":{"forkCommit":"' + $pFork + '","url":"https://example.invalid/client-runtime-' + $pFork + '.zip","sha256":"' + ('c' * 64) + '","bytes":4096,"notice":' + $noticeV + '}}')
    Put (Join-Path $site 'feed\published.json') ('{"Data\\Platform\\UI\\thornswood-ours.esp":"5:0000000000000000000000000000000000000000000000000000000000000000","Data\\Thornswood-Content.esp":"' + $v1Entry + '"}')
    $Shell = (Get-Process -Id $PID).Path
    function Publish([string[]]$extra) {
        $oldA = $env:LOCALAPPDATA; $oldR = $env:APPDATA; $oldE = $ErrorActionPreference
        $env:LOCALAPPDATA = Join-Path $inst 'appdata'
        $env:APPDATA = $roaming
        $ErrorActionPreference = 'Continue'
        try {
            $pu = Join-Path $fake 'scripts\release\Publish-Update.ps1'
            function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
            $argText = (@('-Root', (Q $inst), '-ReleaseDir', (Q $rel), '-DistRoot', (Q (Join-Path $inst 'dist')), '-SiteDir', (Q $site),
                          '-SiteUrl', 'http://127.0.0.1:9', '-NoPause') + @($extra)) -join ' '
            $cmd = "`$global:ThornswoodPublishedRelease = ''; `$rc = 1; try { & $(Q $pu) $argText; `$rc = `$LASTEXITCODE } " +
                   "finally { 'PUBLISHED=[' + `$global:ThornswoodPublishedRelease + ']' }; exit `$rc"
            $out = (& $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String); $code = $LASTEXITCODE
        } finally { $env:LOCALAPPDATA = $oldA; $env:APPDATA = $oldR; $ErrorActionPreference = $oldE }
        $said = [regex]::Match($out, 'PUBLISHED=\[([^\]]*)\]')
        return [pscustomobject]@{ Code = $code; Out = $out; Published = $(if ($said.Success) { $said.Groups[1].Value } else { '?' }) }
    }
    function Said($r, [bool]$ok) { if (-not $ok) { Write-Host (($r.Out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 16) -join "`n") -ForegroundColor DarkGray } }
    function YesR([string]$what, [bool]$cond, $r) { Yes $what $cond; Said $r $cond }
    function Assets { return @(Get-ChildItem -LiteralPath (Join-Path $site 'feed') -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\assets\\' }).Count }

    # The stand-in live server: plugins and its own settings.
    $live = Join-Path $Scratch 'live'
    $liveEsp = Join-Path $live 'plugins\Thornswood-Content.esp'
    Put (Join-Path $live 'server-settings.json') '{"port":7777,"loadOrder":["C:/Thornswood-Server/plugins/Skyrim.esm","C:/Thornswood-Server/plugins/Thornswood-Content.esp"]}'
    $env:THORNSWOOD_TEST_SERVER_DIR = $live

    # a. The server still has version one: refused, nothing published.
    Put $liveEsp $contentV1
    $feedBefore = Sha (SiteFeed $site)
    $baseBefore = Sha (Join-Path $site 'feed\published.json')
    $assetsBefore = Assets
    $r = Publish @('-Notes', "'Test release`n- one line'")
    YesR ("a release with a new content plugin, onto a server that holds the old one, is refused (exit {0})" -f $r.Code) ($r.Code -eq 1) $r
    Yes '  it says the server holds another plugin, and names Deploy-Server.ps1 -GamemodeOnly' ($r.Out -match 'holds another' -and $r.Out.Contains('Deploy-Server.ps1 -GamemodeOnly'))
    Yes '  and that nothing was published, posted or told to a server' ($r.Out -match 'Nothing was published, posted or told to a server')
    Yes '  the store''s version.json is the bytes it was' ((Sha (SiteFeed $site)) -eq $feedBefore)
    Yes '  the store''s baseline is the bytes it was' ((Sha (Join-Path $site 'feed\published.json')) -eq $baseBefore)
    Yes ("  no asset reached the site ({0} before, {1} after)" -f $assetsBefore, (Assets)) ((Assets) -eq $assetsBefore)
    Yes '  and the publisher named no release, so Ship tells nobody' ($r.Published -eq '')
    $zips = @(Get-ChildItem -LiteralPath (Join-Path $inst 'dist') -Recurse -File -Filter 'pack-*.zip' -ErrorAction SilentlyContinue)
    Yes '  and no pack was even made' ($zips.Count -eq 0)

    if ($OnWindows) {
        # b. The server holds version two: the release goes out.
        Put $liveEsp $contentV2
        $r = Publish @('-Notes', "'Test release`n- one line'")
        YesR ("the same release, once the server holds the same plugin, goes out (exit {0}, release {1})" -f $r.Code, $r.Published) ($r.Code -eq 0 -and $r.Published -match '^\d{8}-\d{6}$') $r
        Yes '  and says the server already holds it' ($r.Out -match 'already holds this release''s Thornswood-Content.esp')
        $feed = Read-Json (SiteFeed $site)
        Yes '  the feed the site serves has the release''s pack' (@($feed.packs).Count -ge 1)
        Yes ("  and its assets reached the site, so the count in a. could see one ({0})" -f (Assets)) ((Assets) -gt $assetsBefore)
        $base = Read-Json (Join-Path $site 'feed\published.json')
        $v2Entry = ('{0}:{1}' -f [Text.Encoding]::UTF8.GetByteCount($contentV2), (ShaOf $contentV2))
        $baseEntry = $base.PSObject.Properties['Data\Thornswood-Content.esp']
        Yes '  and the baseline records version two' ($null -ne $baseEntry -and [string]$baseEntry.Value -eq $v2Entry)

        # c. The content plugin did not change: the server is not asked.
        Put $liveEsp 'whatever the server has now'
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'the plugin, changed again'
        $r = Publish @('-Notes', "'Second test release`n- another line'")
        YesR ("a release that does not change the content plugin goes out whatever the server holds (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Published -match '^\d{8}-\d{6}$') $r
        Yes '  and does not ask it' ($r.Out -notmatch 'The content plugin on the server')
    } else {
        Write-Host 'SKIP  b. and c., a release that goes out: a release that signs here makes its catalog with New-FileCatalog, which only Windows has'
    }

    # ---- 4. where it sits ---------------------------------------------------------------
    Write-Host ''; Write-Host 'where the check sits'
    $pu = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Publish-Update.ps1')).Replace("`r`n", "`n")
    $at = $pu.IndexOf('# ==== thornswood content on the server first ====')
    $nothing = $pu.IndexOf("Head 'Nothing to do'")
    $diff = $pu.IndexOf("Head 'Changes'")
    $pack = $pu.IndexOf('# ------------------------------------------------------------ pack')
    $upload = $pu.IndexOf('# ==== thornswood site upload ====')
    $send = $pu.IndexOf('# ==== thornswood feed send ====')
    Yes 'Publish-Update.ps1 has the check' ($at -gt 0)
    Yes '  after the diff against the baseline and the nothing to do exit' ($at -gt $diff -and $at -gt $nothing -and $diff -gt 0 -and $nothing -gt 0)
    Yes '  before the pack, the upload and the feed send' ($pack -gt $at -and $upload -gt $at -and $send -gt $at)
    Yes '  and it dot-sources ServerContent.ps1' ($pu.Contains(". (Join-Path `$Here '..\deploy\ServerContent.ps1')"))
    $ship = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Ship.ps1')).Replace("`r`n", "`n")
    $call = $ship.IndexOf("& (Join-Path `$Here 'Publish-Update.ps1') @pubArgs")
    $stop = $ship.IndexOf('if ($published -ne 0 -and $published -ne 2) {')
    $post = $ship.IndexOf("`$discordScript = Join-Path `$Here '..\ops\Publish-Discord.ps1'")
    $restart = $ship.IndexOf("`$announce = Join-Path `$Here '..\vps\Request-Restart.ps1'")
    Yes 'and Ship stops on the publisher''s exit 1 before it posts or tells the server' ($call -gt 0 -and $stop -gt $call -and $post -gt $stop -and $restart -gt $stop)
}
finally {
    if ($script:gameServer) { try { if (-not $script:gameServer.HasExited) { $script:gameServer.Kill() } } catch { } }
    $env:THORNSWOOD_TEST_SERVER_DIR = $oldServerDir
    $env:THORNSWOOD_HARNESS = '1'
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
