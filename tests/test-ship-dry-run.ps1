<#
  test-ship-dry-run.ps1

  A dry run publishes nothing, and a real Ship still publishes.

  The entry, found on 24 September by the script index run (entry 260):
  "-DryRun -Package publishes the installer to the site." A dry run exists so
  a person can see what a release would do without doing it; one that puts
  anything on the live site is the opposite. Since #4824 a Ship builds no
  installer at all (-Package went with the old installer, and the download
  is Velopack's Setup.exe from merge-release.yml), so what is left to hold is
  that Ship has no such switch and that a dry run sends nothing else.

  The same read found one more way a dry run could reach outside the machine.
  On the dev channel, with no dev release worktree on the disk and no dev
  branch that git could see on the releases repository, Ship made the branch
  and pushed it, dry run or not. Since #907 there is no releases repository:
  the feed and the baseline are on the VPS store (Feed-Store.ps1), stood in for
  here by a folder through THORNSWOOD_TEST_SITE_DIR.

  HOW. The real Ship.ps1 is copied into a temp folder shaped like this repo,
  beside a stand-in for every script it calls. Each stand-in writes down what it
  was asked and does nothing else. git, gh, ssh and scp are stand-ins too,
  first on PATH for the child, so anything that would leave the machine is
  written down instead of done. Ship then runs in a child PowerShell, start to
  finish:

    D  -DryRun on main
    V  -DryRun on dev
    R  a real Ship on main, past the real freshness guard
       (Fresh-Checkout.ps1, #2118) as the harness stand-in it is
    Q  the same real Ship with Fresh-Checkout.ps1 gone: refused on the load,
       before anything is built or called (#3006)
    E  -DryRun on dev, numbered from what the store says dev has published
    G  -DryRun on dev with no -Root, on a machine that recorded its dev
       release folder (Where.ps1 ShipRootDev, #1692): that folder is built,
       installed and published
    G2 the same with a recorded folder that has no Launcher folder, as
       Update-ShipRoot.ps1 makes one: not refused, and its launcher step
       makes the folder (#2662)
    H  -Root naming a folder Vortex deploys into: refused before anything is
       built, installed or published (#1692)
    I  a folder whose collection cannot build the animation and body files
       (Build-Generated.ps1 -DryRun exits 1): refused before the launcher is
       built or installed (#1692, #3715)
    J  a game folder on a machine with no node: refused before anything is
       built, installed or published, saying why (#1913)
    K  SkyUI's menus could not be read (Check-SkyUIMenus.js exit 1): refused,
       nothing published (#1913)
    L  the same folder with a check that passes runs to the end, so J and K
       stop on node and on the check, not on the folder; and a mismatch
       (exit 2) still refuses (#960)
    N  this machine's Vortex a collection revision behind
       records\collection-plugins.json, or unable to say: refused before the
       version moves, nothing published (#3597)
    O  Nexus on a newer revision than the record, or not answering: refused
       before the version moves, nothing published (#4068)

  R is there so D and V prove something: the same stand-ins, on a real Ship,
  do write down the feed and baseline going to
  the store, dev following main through it, the news, the Discord and the restart.
  And the release tag (#444): R pushes release/main/<id> once, after the
  publisher said it sent the feed; D, V and E make no tag at all.

  No Ship builds, fetches or publishes a launcher (#4825): the launcher goes
  out through Velopack (merge-release.yml, promote-main.yml), so every case
  holds that Build-Launcher.ps1 and Install-Launcher.ps1 are never called and
  the publisher is given no launcher.

  The stand-ins are only worth what the real scripts do, so one of those is
  read as well: Publish-Update.ps1 has no gh or git call that reaches GitHub,
  and every send to the VPS store is behind -NoPush.

  Nothing here touches this repository, the network, a game or a launcher.
  Everything it writes is under its own temp folder.
#>
[CmdletBinding()]
param([string]$ShipPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $ShipPath) { $ShipPath = Join-Path $Here 'scripts\release\Ship.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    # The temp folder's path is long and says nothing; the calls read better without it.
    if ($script:T) { $what = $what.Replace($script:T, '<temp>') }
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$IfAst = [System.Management.Automation.Language.IfStatementAst]
$CmdAst = [System.Management.Automation.Language.CommandAst]
$FnAst = [System.Management.Automation.Language.FunctionDefinitionAst]

function Parse([string]$path) {
    $t = $null; $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$t, [ref]$e)
    return [pscustomobject]@{ Ast = $ast; Tokens = @($t); Errors = @($e) }
}

# The condition of the clause of the nearest enclosing if, walking out from a
# node, and the name of the nearest enclosing function. The clause, not just
# the if: an elseif under "-not $NoUpload" is not the branch that uploads.
function Enclosing($node) {
    $conds = @()
    $fn = ''
    $prev = $node
    $p = $node.Parent
    while ($p) {
        if ($p -is $IfAst) {
            foreach ($c in $p.Clauses) {
                if ([object]::ReferenceEquals($c.Item2, $prev)) { $conds += $c.Item1.Extent.Text }
            }
        }
        if ($p -is $FnAst -and -not $fn) { $fn = $p.Name }
        $prev = $p
        $p = $p.Parent
    }
    return [pscustomobject]@{ Conditions = $conds; Function = $fn }
}

# ---- the real scripts the stand-ins stand for ------------------------------------
$shipSrc = [IO.File]::ReadAllText($ShipPath)
$ship = Parse $ShipPath
Yes 'Ship.ps1 parses' ($ship.Errors.Count -eq 0)

$shipParams = @($ship.Ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Yes 'Ship.ps1 has no -Package: a Ship builds no installer since #4824' ($shipParams.Count -gt 0 -and $shipParams -notcontains 'Package')
Yes '  and calls neither the old installer''s builder nor its publisher' (-not ($shipSrc -match 'Package-Thornswood|Publish-Installer'))

$pu = Parse (Join-Path $Here 'scripts\release\Publish-Update.ps1')
$away = @($pu.Ast.FindAll({ param($n) $n -is $CmdAst }, $true) | Where-Object {
    $name = $_.GetCommandName()
    $words = @($_.CommandElements | ForEach-Object { $_.Extent.Text })
    ($name -eq 'gh') -or ($name -eq 'git' -and @($words | Where-Object { $_ -in 'push', 'pull', 'fetch', 'ls-remote', 'clone' }).Count -gt 0)
})
Yes ('Publish-Update.ps1 has no gh or git call that reaches GitHub any more (#907)' + $(if ($away.Count) { ': ' + (($away | ForEach-Object { 'line ' + $_.Extent.StartLineNumber }) -join ', ') } else { '' })) ($away.Count -eq 0)
$sends = @($pu.Ast.FindAll({ param($n) $n -is $CmdAst -and $n.GetCommandName() -eq 'Send-FeedStore' }, $true))
$loose = @()
foreach ($c in $sends) {
    $e = Enclosing $c
    $held = @($e.Conditions | Where-Object { $_ -match '-not \$NoPush\b' }).Count -gt 0
    if (-not $held -and $e.Function -ne 'Send-Baseline') { $loose += ('line ' + $c.Extent.StartLineNumber) }
}
$sb = @($pu.Ast.FindAll({ param($n) $n -is $FnAst -and $n.Name -eq 'Send-Baseline' }, $true))
Yes ("  what it sends to the VPS goes through Send-FeedStore ({0} call(s)), so the next lines read something" -f $sends.Count) ($sends.Count -ge 2)
Yes ('  every one is behind -NoPush, or in Send-Baseline' + $(if ($loose.Count) { ': ' + ($loose -join '; ') } else { '' })) ($loose.Count -eq 0)
Yes '  and Send-Baseline sends nothing under -NoPush' ($sb.Count -eq 1 -and $sb[0].Extent.Text -match 'if \(\$NoPush\) \{ return \}')
Yes '  and Ship always gives it the working folder' ($shipSrc -match '\$pubArgs = @\{[^\r\n]*ReleaseDir = \$ReleaseDir')

# ---- a repository, a releases clone and two installs, all stand-ins --------------
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-ship-dry-' + [Guid]::NewGuid().ToString('N'))
$repo = Join-Path $T 'Thornswood'
$appdata = Join-Path $T 'appdata'
# This machine's working copies of the feeds (Feed-Store.ps1, #907), and the
# folder standing in for the VPS store beside the site's feeds.
$rel = Join-Path $appdata 'Thornswood\feed\main'
$relDev = Join-Path $appdata 'Thornswood\feed\dev'
$site = Join-Path $T 'site'
$bin = Join-Path $T 'bin'
$root = Join-Path $T 'Play'
$rootDev = Join-Path $T 'Play-DevBuild'
$dist = Join-Path $T 'dist'
$log = Join-Path $T 'calls.log'

# What every stand-in script writes down: its name and what it was given, on
# one line. A value's own line breaks are written as " / ": the notes have a
# title and a list since #586, and a break in them split one call into two
# lines of the log, so a switch after -Notes was never seen.
$noteText = @'
$line = 'NAME'
foreach ($k in @($PSBoundParameters.Keys | Sort-Object)) {
    $v = $PSBoundParameters[$k]
    if ($v -is [System.Management.Automation.SwitchParameter]) { if ($v.IsPresent) { $line += ' -' + $k } }
    else { $line += ' -' + $k + ' ' + ([string]$v -replace "\r?\n", ' / ') }
}
[IO.File]::AppendAllText($env:TS_DRY_CALLS, $line + "`r`n")
'@
function Stub([string]$name, [string]$params, [string]$body) {
    $text = "param($params)`r`n" + $noteText.Replace('NAME', $name) + "`r`n" + $body + "`r`nexit 0`r`n"
    # Each in its own area under scripts\ since phase 8 of issue #440, where Ship.ps1
    # in scripts\release calls it.
    $area = 'release'
    if ($name -eq 'Publish-Discord') { $area = 'ops' }
    if ($name -eq 'Request-Restart') { $area = 'vps' }
    $dir = Join-Path $repo ('scripts\' + $area)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [IO.File]::WriteAllText((Join-Path $dir ($name + '.ps1')), $text)
}

$oldPath = $env:PATH
# PATH's separator: ; on Windows, : elsewhere.
$pathSep = [string][IO.Path]::PathSeparator
$oldAppData = $env:LOCALAPPDATA
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
$oldCalls = $env:TS_DRY_CALLS
$oldGhDl = $env:TS_GH_DL
$oldGhTag = $env:TS_GH_TAG
$oldSite = $env:THORNSWOOD_TEST_SITE_DIR
$oldScratch = $env:THORNSWOOD_SCRATCH_ROOT
$oldVps = $env:THORNSWOOD_VPS
$ps = (Get-Process -Id $PID).Path

function Invoke-Ship([string[]]$shipArgs) {
    if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\release\Ship.ps1') @shipArgs 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old }
    $calls = @()
    if (Test-Path -LiteralPath $log) { $calls = @(Get-Content -LiteralPath $log | Where-Object { $_ }) }
    return [pscustomobject]@{ Code = $code; Out = $out; Calls = $calls }
}
# The comma keeps a one line answer an array: a return unrolls it otherwise,
# and [0] of a bare string is its first character.
function Called($run, [string]$name) { return ,@($run.Calls | Where-Object { $_ -eq $name -or $_.StartsWith($name + ' ') }) }
# Anything that would have left the machine, by the stand-ins on PATH. Every
# gh, ssh and scp call, and every git call but the ones that only read: since
# 25 September a dev Ship reads the version each channel has published off
# origin (git fetch, then show and log of origin/main and origin/dev), so a
# dev number never lands below one already out. Reading sends nothing of this
# release anywhere.
function Away($run) {
    return ,@($run.Calls | Where-Object {
        $_ -match '^(gh|ssh|scp)( |$)' -or
        ($_ -match '^git( |$)' -and $_ -notmatch '^git (-C \S+ )?(fetch|show|log|rev-parse|status|remote get-url|ls-remote)( |$)')
    })
}
function Hash([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return 'absent' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path))) } finally { $sha.Dispose() }
}
# The stand-in store keeps each channel's feed as write-once generations,
# version\<8 digits>.json in its folder, the newest being the feed (#2727,
# Feed-Store.ps1). Its hash here is the newest's name and bytes, so a new
# generation counts as a move even with the same bytes.
. (Join-Path $Here 'scripts\release\Feed-Store.ps1')
function Hash-SiteFeed([string]$channelDir) {
    $f = Get-FeedVersionFile $channelDir
    if (-not $f) { return 'absent' }
    return ((Split-Path -Leaf $f) + '|' + (Hash $f))
}

try {
    foreach ($d in @((Join-Path $repo 'launcher\app'), (Join-Path $repo 'scripts\release'), $rel, $relDev, $bin,
                     (Join-Path $root 'Launcher'), (Join-Path $rootDev 'Launcher'), $dist, (Join-Path $appdata 'Thornswood'))) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
    }
    Copy-Item -LiteralPath $ShipPath -Destination (Join-Path $repo 'scripts\release\Ship.ps1') -Force
    # The real files Ship dot-sources, beside it, so it runs as it does for real.
    $realRel = Split-Path -Parent $ShipPath
    foreach ($n in 'Ship-Rules.ps1', 'ShippedBytes.ps1', 'Assert-PublishSigned.ps1', 'Feed-Store.ps1', 'Feed-Json.ps1', 'Release-Name.ps1', 'Note-Rules.ps1', 'Where.ps1', 'Get-ScratchDir.ps1', 'Read-JsonFile.ps1', 'RecordShape.ps1', 'RepoPlugins.ps1', 'CollectionRevision.ps1', 'Note-Repeats.ps1', 'Feed-News.ps1', 'Release-Baseline.ps1', 'Feed-Rules.ps1', 'LauncherVersion.ps1') {
        Copy-Item -LiteralPath (Join-Path $realRel $n) -Destination (Join-Path $repo ('scripts\release\' + $n)) -Force
    }
    Copy-Item -LiteralPath (Join-Path $realRel '..\..\layout.json') -Destination (Join-Path $repo 'layout.json') -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'records') | Out-Null
    Copy-Item -LiteralPath (Join-Path $realRel '..\..\records\ui-gone.json') -Destination (Join-Path $repo 'records\ui-gone.json') -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'scripts\mods') | Out-Null
    Copy-Item -LiteralPath (Join-Path $realRel '..\mods\LoadOrder.ps1') -Destination (Join-Path $repo 'scripts\mods\LoadOrder.ps1') -Force
    # The freshness guard a real Ship loads (#2118), the real one: R runs it,
    # and it lets R by only as the harness stand-in, THORNSWOOD_HARNESS with
    # the box harness.invalid. Until #3006 it was not here, Ship walked past
    # the missing file under Continue, and R passed with no guard at all.
    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'scripts\deploy') | Out-Null
    $freshCopy = Join-Path $repo 'scripts\deploy\Fresh-Checkout.ps1'
    Copy-Item -LiteralPath (Join-Path $realRel '..\deploy\Fresh-Checkout.ps1') -Destination $freshCopy -Force
    # What Ship.ps1 dot-sources, which a stand-in cannot write down because it
    # is not called, only read. The two rule files are the real ones: they
    # only define functions, and the notes below are held to Note-Rules the
    # way a real Ship holds them.
    $realRelease = Split-Path -Parent (Resolve-Path -LiteralPath $ShipPath).Path
    foreach ($f in 'Ship-Rules.ps1', 'Note-Rules.ps1') {
        Copy-Item -LiteralPath (Join-Path $realRelease $f) -Destination (Join-Path $repo 'scripts\release') -Force
    }
    # The publish sign gate (#826) and the load order check (#557) read this
    # machine's signing setup, its signed exe and Vortex, none of which a
    # temp folder has. Their stand-ins pass, so what is measured here is
    # still what Ship calls and what leaves the machine; the gate itself has
    # tests\test-publish-sign-gate.ps1.
    [IO.File]::WriteAllText((Join-Path $repo 'scripts\release\Assert-PublishSigned.ps1'), @'
function Get-SigningConfigRefusal { param([string]$ConfigPath, [string]$RepoRoot) return '' }
function Get-ExpectedSignerFragment { param([string]$RepoRoot) return 'CN=Thornswood' }
function Get-PublishSignRefusal { param([string]$Path, [string]$ExpectedSigner) return '' }
'@)
    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'scripts\mods') | Out-Null
    [IO.File]::WriteAllText((Join-Path $repo 'scripts\mods\LoadOrder.ps1'), @'
function Assert-VortexProfile([string]$Name = 'Thornswood') { return (Join-Path $env:LOCALAPPDATA 'Vortex-Thornswood') }
function Get-LoadOrderCopyDiffs([hashtable]$Copies) { return @() }
function Get-CollectionSlug([string]$Url) { return '7essxf' }
function Get-CollectionRevision([string]$Slug) { if ($env:TS_DRY_COLLECTION_REVISION) { return [int]$env:TS_DRY_COLLECTION_REVISION }; return 0 }
'@)
    # The collection revision record Ship holds this machine's Vortex to
    # (#3597); the stand-in Vortex above is on it unless a case says not.
    Copy-Item -LiteralPath (Join-Path $realRel '..\..\records\collection-plugins.json') -Destination (Join-Path $repo 'records\collection-plugins.json') -Force
    $env:TS_DRY_COLLECTION_REVISION = [string](([IO.File]::ReadAllText((Join-Path $repo 'records\collection-plugins.json')) -replace '^\uFEFF', '') | ConvertFrom-Json).revision
    # What Nexus says is the newest published revision (#4068), without asking
    # it: the record's, unless a case says otherwise; 'none' is a Nexus that
    # does not answer.
    [IO.File]::WriteAllText((Join-Path $repo 'scripts\release\NexusPublished.ps1'), @'
param([string]$Slug, [string]$Game)
if ($env:TS_DRY_NEXUS_PUBLISHED -eq 'none') { throw 'the stand-in Nexus did not answer' }
if ($env:TS_DRY_NEXUS_PUBLISHED) { return [int]$env:TS_DRY_NEXUS_PUBLISHED }
return [int]$env:TS_DRY_COLLECTION_REVISION
'@)
    $updaterCs = Join-Path $repo 'launcher\app\Updater.cs'
    # The launcher's number comes from when its sources last changed
    # (LauncherVersion.ps1, #5179): the git stand-in below answers that they
    # last changed at 5:45 PM UTC on 1 Nov 2026, 2026.1101.1745. It goes into
    # the build as -p:Version and no source file holds it (#4825), so no run of
    # Ship may change this file; it is fingerprinted after each one.
    [IO.File]::WriteAllText($updaterCs, "        public static readonly string Version = BuiltVersion();`r`n")
    $updaterWas = Hash $updaterCs
    # Issue #1081: Ship runs scripts\dev\Check-Words.ps1 before it builds.
    # This stand-in passes. tests\test-ship-check-words.ps1 runs the real
    # script against a planted hit. A stand-in here keeps this dry run on
    # what leaves the machine.
    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'scripts\dev') | Out-Null
    [IO.File]::WriteAllText((Join-Path $repo 'scripts\dev\Check-Words.ps1'), "param([string]`$Root)`r`nexit 0`r`n")
    # The VPS store (Feed-Store.ps1, #907), stood in for by a folder, and this
    # machine's working copies of it as the last run left them.
    foreach ($d in (Join-Path $site 'feed\version'), (Join-Path $site 'feed-dev\version')) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    foreach ($pair in @(@($rel, 'feed'), @($relDev, 'feed-dev'))) {
        # Main's feed offers 2026.1031.900: the launcher's sources changed since, to
        # 2026.1101.1745, not shipped yet, the state a main Ship starts from. A main
        # feed already offering 2026.1101.1745 from other launcher sources is refused before anything is
        # built (#2347, tests\test-2347-dev-launcher-version.ps1).
        $v = if ($pair[1] -eq 'feed') { '{"launcherVersion":"2026.1031.900","packs":[]}' } else { '{"launcherVersion":"2026.1101.1745.2","packs":[],"serverPort":7001}' }
        $b = if ($pair[1] -eq 'feed') { '{"main":"as last published"}' } else { '{"dev":"as last published"}' }
        [IO.File]::WriteAllText((Join-Path $site ($pair[1] + '\version\00000001.json')), $v)
        [IO.File]::WriteAllText((Join-Path $site ($pair[1] + '\published.json')), $b)
        [IO.File]::WriteAllText((Join-Path $pair[0] 'version.json'), $v)
        [IO.File]::WriteAllText((Join-Path $pair[0] 'published.json'), $b)
    }
    [IO.File]::WriteAllText((Join-Path $site 'feed-dev\launchers.txt'), "2026.1101.1745.1`r`n2026.1101.1745.2`r`n")
    # An hour old, so the stand-in install is newer and Ship calls it built.
    foreach ($r in $root, $rootDev) {
        $exe = Join-Path $r 'Launcher\Thornswood.exe'
        [IO.File]::WriteAllText($exe, 'the launcher as installed')
        (Get-Item -LiteralPath $exe).LastWriteTimeUtc = [DateTime]::UtcNow.AddHours(-1)
    }

    # The build writes its exe into -OutDir and the install copies that one
    # into the root, as the real ones do: Ship reads back that the exe in the
    # root is the one in -OutDir by its sha256 (#5156).
    Stub 'Build-Launcher' '[string]$Root, [string]$OutDir, [switch]$NoPause, [switch]$NoSign, [string]$Version' @'
[void](New-Item -ItemType Directory -Force -Path $OutDir)
[IO.File]::WriteAllText((Join-Path $OutDir 'Thornswood.exe'), 'the launcher this run built')
'@
    # Makes the Launcher folder when there is none, as the real one does: a
    # ship root Update-ShipRoot.ps1 made has none (G2, #2662).
    Stub 'Install-Launcher' '[string]$Root, [string]$From, [switch]$NoPause' @'
[void](New-Item -ItemType Directory -Force -Path (Join-Path $Root 'Launcher'))
Copy-Item -LiteralPath (Join-Path $From 'Thornswood.exe') -Destination (Join-Path $Root 'Launcher\Thornswood.exe') -Force
'@
    Stub 'Go' '[switch]$SkipServer, [string]$Game, [switch]$Vortex' ''
    Stub 'Build-Front' '[string]$Fork, [string]$Commit, [string]$Out, [switch]$Record' ''
    Stub 'Sync-Client' '[switch]$Check, [switch]$NoPause, [string]$Game' ''
    # The ship root (#2019): passes unless TS_SHIPROOT_EXIT says otherwise, for N.
    # tests\test-2019-ship-roots.ps1 runs the real one on a stand-in root.
    Stub 'Update-ShipRoot' '[string]$Channel, [string]$Root, [switch]$NoPause' 'if ($env:TS_SHIPROOT_EXIT) { exit ([int]$env:TS_SHIPROOT_EXIT) }'
    # What the real publisher does: receives the feed and baseline (from the
    # stand-in store), writes version.json and its baseline, and with no
    # -NoPush sends both back.
    Stub 'Publish-Update' ('[string]$Notes, [string]$Root, [string]$RepoDir, [string]$ReleaseDir, [string]$DistRoot, ' +
                           '[switch]$NoPause, [switch]$MoveServer, [switch]$AcceptSize, ' +
                           '[string]$Channel, [switch]$NoUpload, [switch]$NoPush, ' +
                           # A dry run also passes these two since #494: close no game, prune no packs.
                           '[switch]$NoClose, [int]$KeepPacks = 10') @'
# F: the send of the feed failed, the way the real one ends then (#1055).
if ($env:TS_PUB_FAIL) { Write-Host 'NOT SHIPPED. the store refused version.json'; exit 1 }
. (Join-Path $PSScriptRoot 'Feed-Store.ps1')
if (-not $NoPush) { [void](Receive-FeedStore $(if ($Channel) { $Channel } else { 'main' }) $ReleaseDir) }
$vf = Join-Path $ReleaseDir 'version.json'
$feedWas = Get-Content -LiteralPath $vf -Raw | ConvertFrom-Json
$was = [string]$feedWas.launcherVersion
# The real one writes no launcher field (#4825): the feed keeps the launcher
# it offers, and so does this.
$now = $was
$inputsNow = if ($feedWas.PSObject.Properties['launcherInputs']) { [string]$feedWas.launcherInputs } else { '' }
# With the release record the real one writes (#444): one name, 20990101-0000,
# for the pack, the launcher it offers and the commit it was built from.
$ch = if ($Channel -eq 'dev') { 'dev' } else { 'main' }
[IO.File]::WriteAllText($vf, '{"launcherVersion":"' + $now + '","launcherInputs":"' + $inputsNow + '","packs":[{"id":"20990101-0000","url":"https://example.invalid/20990101-0000.zip","sha256":"' + ('d' * 64) + '"}],' +
    '"release":{"id":"20990101-0000","channel":"' + $ch + '","launcherVersion":"' + $now + '","packs":["20990101-0000"],' +
    '"baseline":"","commit":"' + ('ab12' * 10) + '","branch":"main","uncommitted":0,"tag":"release/' + $ch + '/20990101-0000"}}')
[IO.File]::WriteAllText((Join-Path $ReleaseDir 'published.json'), '{"written":"by the publisher"}')
# The send the real one makes: the feed and then the baseline, through
# Feed-Store.ps1 into the stand-in for the VPS store.
if (-not $NoPush) {
    . (Join-Path $PSScriptRoot 'Feed-Store.ps1')
    $ch = if ($Channel) { $Channel } else { 'main' }
    [void](Send-FeedStore $ch $ReleaseDir @('version.json'))
    [void](Send-FeedStore $ch $ReleaseDir @('published.json'))
    # And says so, as the real one does once the feed is on the VPS.
    $global:ThornswoodPublishedRelease = '20990101-0000'
}
'@
    # The real one's last step, which the static check above holds it to.
    Stub 'Publish-Discord' '[switch]$Dev' ''
    Stub 'Request-Restart' '[double]$Minutes, [string]$Mode, [string]$Why, [string]$Data' ''
    # What follows a tip: the host feed remirror. The real one reaches the VPS
    # and the site, so a dry run must not call it at all and a real Ship calls it
    # once. Ship reads the exit code and says at the end whether it completed,
    # so this hands back 0 like the rest.
    Stub 'Publish-PostShip' ('[string]$Channel, [string]$Root, [string]$DistRoot, [string]$Only, ' +
                             '[switch]$NoPause') ''
    # The stand-ins are .ps1, not .cmd (issue #1013). PowerShell finds a .ps1 on
    # PATH before an .exe further along it and runs it with every argument
    # whole. A .cmd gets its arguments through cmd.exe, which ends a command at
    # a bare &, so under C:\ThornswoodTemps&Worktrees (where every temp file on
    # the shipping machine went until #2900) the gh download's --dir was cut
    # in two and the real main Ship case went red.
    $standIn = @'
[IO.File]::AppendAllText($env:TS_DRY_CALLS, ((@('NAME') + @($args | ForEach-Object { [string]$_ })) -join ' ') + "`r`n")
'@
    foreach ($n in 'git', 'ssh', 'scp') {
        [IO.File]::WriteAllText((Join-Path $bin ($n + '.ps1')), $standIn.Replace('NAME', $n) + "`r`nexit 0`r`n")
    }
    # git answers one read as well: the first-parent history of the launcher's
    # sources LauncherVersion.ps1 asks for, one change at 5:45:12 PM UTC on
    # 1 Nov 2026 (1793555112), so the launcher's number is 2026.1101.1745.
    [IO.File]::WriteAllText((Join-Path $bin 'git.ps1'), $standIn.Replace('NAME', 'git') + "`r`n" +
        "if (`$args -contains 'log' -and `$args -contains '--first-parent' -and `$args -contains '--format=%H %ct') { Write-Output ('" + ('c0de' * 10) + " 1793555112') }`r`nexit 0`r`n")
    # gh needs one thing more than logging: on a real main Ship the launcher is
    # not compiled here, it is downloaded from the release CI built and checked
    # against SHA256SUMS (issue #457). Since #2432 Ship finds that draft in the
    # REST list of releases and downloads each file by its asset id, reading
    # gh's standard output as bytes. So the gh stand-in answers both, the way
    # GitHub does: the list with a draft for TS_GH_TAG carrying Thornswood.exe
    # (id 21), a native library beside it (id 22, the launcher is a folder
    # since #4823) and SHA256SUMS (id 23), and each asset with its
    # bytes. It computes the hashes itself, so the download always verifies and
    # the test proves the path runs, not that a particular byte matches. Since
    # #2841 Ship first asks for the green release.yml runs of the tag, whose
    # artifact it would take; the stand-in has none, as for a tag built before
    # then, so the draft is read as before. Every other gh call still only logs.
    $ghDl = Join-Path $bin 'gh-download.ps1'
    [IO.File]::WriteAllText($ghDl, @'
$utf8 = New-Object Text.UTF8Encoding($false)
function Out-Bytes([byte[]]$b) { $o = [Console]::OpenStandardOutput(); $o.Write($b, 0, $b.Length); $o.Flush() }
$exe = $utf8.GetBytes('the Thornswood.exe CI built for this tag')
$lib = $utf8.GetBytes('the libSkiaSharp.dll CI built for this tag')
$sha = [Security.Cryptography.SHA256]::Create()
$sums = $utf8.GetBytes(((@(@('Thornswood.exe', $exe), @('libSkiaSharp.dll', $lib)) | ForEach-Object {
    (($sha.ComputeHash([byte[]]$_[1]) | ForEach-Object { $_.ToString('x2') }) -join '') + '  ' + $_[0] }) -join "`n") + "`n")
$files = @{ 21 = $exe; 22 = $lib; 23 = $sums }
$target = [string]$args[$args.Count - 1]
if ($target -match '^repos/[^/]+/[^/]+/actions/workflows/release\.yml/runs\?') {
    Out-Bytes ($utf8.GetBytes('{"total_count":0,"workflow_runs":[]}'))
} elseif ($target -match '^repos/[^/]+/[^/]+/releases\?per_page=100&page=(\d+)$') {
    $list = @()
    if ($Matches[1] -eq '1') {
        $assets = @(@(21, 'Thornswood.exe'), @(22, 'libSkiaSharp.dll'), @(23, 'SHA256SUMS') | ForEach-Object { [ordered]@{ id = $_[0]; name = $_[1]; size = $files[$_[0]].Length } })
        $list = @([ordered]@{ id = 501; tag_name = $env:TS_GH_TAG; draft = $true; assets = $assets })
    }
    Out-Bytes ($utf8.GetBytes((ConvertTo-Json -InputObject @($list) -Depth 5 -Compress)))
} elseif ($target -match '^repos/[^/]+/[^/]+/releases/assets/(\d+)$' -and $files.ContainsKey([int]$Matches[1])) {
    Out-Bytes $files[[int]$Matches[1]]
}
'@)
    [IO.File]::WriteAllText((Join-Path $bin 'gh.ps1'), $standIn.Replace('NAME', 'gh') + "`r`n" +
        "if (`$args.Count -ge 2 -and `$args[0] -eq 'api') { & `$env:TS_GH_DL @args }`r`nexit 0`r`n")

    $env:PATH = $bin + $pathSep + $oldPath
    $env:LOCALAPPDATA = $appdata
    # Ship stages the launcher under Get-ScratchDir (issue #1272), not %TEMP%.
    # Point the scratch root at this run's own folder so the gh stand-in writes
    # here and nothing lands under the real temps tree. TEMP stays sandboxed
    # too for anything else that still reads it.
    $env:THORNSWOOD_SCRATCH_ROOT = Join-Path $T 'scratch'
    New-Item -ItemType Directory -Force -Path $env:THORNSWOOD_SCRATCH_ROOT | Out-Null
    $dryTemp = Join-Path $T 'temp'
    $env:TEMP = $dryTemp
    $env:TMP = $dryTemp
    New-Item -ItemType Directory -Force -Path $dryTemp | Out-Null
    $env:TS_DRY_CALLS = $log
    $env:TS_GH_DL = $ghDl
    # The tag a main Ship of the launcher's 2026.1101.1745 looks for.
    $env:TS_GH_TAG = 'v2026.1101.1745'
    $env:THORNSWOOD_TEST_SITE_DIR = $site
    # The box a Ship's freshness guard asks about: one that can never be a
    # real server, so the guard knows the stand-in (Fresh-Checkout.ps1).
    $env:THORNSWOOD_VPS = 'harness.invalid'

    $feed = Join-Path $rel 'version.json'
    $devFeed = Join-Path $relDev 'version.json'
    $base = Join-Path $rel 'published.json'
    $devBase = Join-Path $relDev 'published.json'
    $siteFeedDir = Join-Path $site 'feed'
    $siteBase = Join-Path $site 'feed\published.json'
    $siteDevDir = Join-Path $site 'feed-dev'
    $siteDevBase = Join-Path $site 'feed-dev\published.json'

    # ---- D: -DryRun on main ---------------------------------------------------------
    $was = @{ feed = (Hash $feed); dev = (Hash $devFeed); base = (Hash $base); site = (Hash-SiteFeed $siteFeedDir); siteBase = (Hash $siteBase); siteDev = (Hash-SiteFeed $siteDevDir) }
    $d = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-DryRun', '-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("D a main -DryRun runs to the end (exit {0})" -f $d.Code) ($d.Code -eq 0 -and $d.Out -match 'Dry run finished')
    $pub = Called $d 'Publish-Update'
    Yes 'D the publisher ran, told not to upload and not to push' ($pub.Count -eq 1 -and $pub[0] -match ' -NoUpload\b' -and $pub[0] -match ' -NoPush\b')
    foreach ($n in 'Publish-Discord', 'Request-Restart', 'Publish-PostShip') {
        Yes "D $n.ps1 is not called" ((Called $d $n).Count -eq 0)
    }
    $gone = Away $d
    Yes ('D nothing leaves the machine: no git, gh, ssh or scp' + $(if ($gone.Count) { ' (' + ($gone -join '; ') + ')' } else { '' })) ($gone.Count -eq 0)
    $go = Called $d 'Go'
    Yes 'D Go.ps1 is told to leave the server alone' ($go.Count -eq 1 -and $go[0] -match ' -SkipServer\b')
    Yes 'D version.json is byte for byte what it was' ((Hash $feed) -eq $was.feed)
    Yes '  and so is the baseline' ((Hash $base) -eq $was.base)
    Yes '  and the dev feed is not reset to match' ((Hash $devFeed) -eq $was.dev)
    Yes '  and nothing on the VPS store moved' ((Hash-SiteFeed $siteFeedDir) -eq $was.site -and (Hash $siteBase) -eq $was.siteBase -and (Hash-SiteFeed $siteDevDir) -eq $was.siteDev)

    # ---- V: -DryRun on dev ----------------------------------------------------------
    $was = @{ dev = (Hash $devFeed); devBase = (Hash $devBase); feed = (Hash $feed) }
    $v = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-Root', $rootDev, '-DistRoot', $dist, '-NoPause')
    Yes ("V a dev -DryRun runs to the end (exit {0})" -f $v.Code) ($v.Code -eq 0 -and $v.Out -match 'Dry run finished')
    $pub = Called $v 'Publish-Update'
    Yes 'V the publisher ran on dev, told not to upload and not to push' ($pub.Count -eq 1 -and $pub[0] -match ' -Channel dev\b' -and $pub[0] -match ' -NoUpload\b' -and $pub[0] -match ' -NoPush\b')
    # No launcher in a Ship (#4825): nothing builds or installs one, and the
    # publisher is given no launcher, no number and no fingerprint.
    Yes 'V no launcher is built or installed' ((Called $v 'Build-Launcher').Count -eq 0 -and (Called $v 'Install-Launcher').Count -eq 0)
    Yes '  and the publisher is given no launcher, number or fingerprint' (
        $pub.Count -eq 1 -and $pub[0] -notmatch ' -(Launcher|VersionOverride|LauncherInputs)\b')
    foreach ($n in 'Publish-Discord', 'Request-Restart', 'Publish-PostShip') {
        Yes "V $n.ps1 is not called" ((Called $v $n).Count -eq 0)
    }
    $gone = Away $v
    Yes ('V nothing leaves the machine: no git, gh, ssh or scp' + $(if ($gone.Count) { ' (' + ($gone -join '; ') + ')' } else { '' })) ($gone.Count -eq 0)
    Yes 'V the dev feed is byte for byte what it was' ((Hash $devFeed) -eq $was.dev)
    Yes '  and so is the dev baseline' ((Hash $devBase) -eq $was.devBase)
    Yes '  and the main feed is not touched' ((Hash $feed) -eq $was.feed)
    Yes '  and the launcher''s source is as it was: no file holds the number' ((Hash $updaterCs) -eq $updaterWas)

    # ---- R: a real Ship on main -------------------------------------------------------
    $devBeforeMain = Hash-SiteFeed $siteDevDir
    $devBaselineBeforeMain = Hash $siteDevBase
    $r = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("R a real main Ship runs to the end (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'Everyone in the world has')
    Yes 'R its freshness guard ran, and let the harness stand-in by (#2118)' ($r.Out -match 'freshness: the harness stand-in box, not checked')
    $unknown = @($r.Out -split "`r?`n" | Where-Object { $_ -match 'is not recognized' })
    Yes ('R and nothing it loads or calls is missing (#3006)' + $(if ($unknown.Count) { ': ' + $unknown[0].Trim() } else { '' })) ($unknown.Count -eq 0)
    # When it stops, what it said and what it called, so the FAIL says why.
    if ($r.Code -ne 0) { $r.Out -split "`r?`n" | Select-Object -Last 25 | ForEach-Object { Write-Host ("      " + $_) }; $r.Calls | ForEach-Object { Write-Host ("      call: " + $_) } }
    $pub = Called $r 'Publish-Update'
    Yes 'R the publisher ran, and was not told to hold anything back' ($pub.Count -eq 1 -and $pub[0] -notmatch ' -NoUpload\b' -and $pub[0] -notmatch ' -NoPush\b')
    foreach ($n in 'Publish-Discord', 'Request-Restart') {
        Yes "R $n.ps1 is called" ((Called $r $n).Count -eq 1)
    }
    # What follows the tip: one call per half, on the main channel, each with the
    # install and the staging folder. No
    # switch can hold either half back, so nothing here says -Skip anything, and
    # no clone is passed: the remirror works its own out from the channel.
    $post = Called $r 'Publish-PostShip'
    Yes ('R what follows the tip runs once (remirror) for main, with the install and the staging folder' +
         $(if ($post.Count) { ' (' + ($post -join '; ') + ')' } else { '' })) (
        $post.Count -eq 1 -and
        @($post | Where-Object { $_ -match ' -Channel main\b' -and $_.Contains(' -Root ' + $root) -and
                                 $_.Contains(' -DistRoot ' + $dist) -and $_ -notmatch ' -Skip' -and
                                 $_ -notmatch ' -ReleaseDir' }).Count -eq 1 -and
        @($post | Where-Object { $_ -match ' -Only Remirror\b' }).Count -eq 1 -and
        @($post | Where-Object { $_ -match ' -Only VirusTotal\b' }).Count -eq 0)
    # No launcher in a Ship (#4825): it goes out through Velopack alone, so a
    # main Ship neither builds, installs nor fetches one, and asks gh nothing.
    $inst = Called $r 'Install-Launcher'
    Yes ('R no launcher is installed' + $(if ($inst.Count) { ' (' + ($inst -join '; ') + ')' } else { '' })) ($inst.Count -eq 0)
    $gone = Away $r
    Yes 'R nor built: Build-Launcher.ps1 is not called' ((Called $r 'Build-Launcher').Count -eq 0)
    Yes ('R nor fetched from a GitHub release: no gh call at all' + $(if ($gone.Count) { ' (' + ($gone -join '; ') + ')' } else { '' })) (
        @($gone | Where-Object { $_ -match '^gh ' }).Count -eq 0)
    Yes '  and the publisher is given no launcher, number or fingerprint' (
        $pub.Count -eq 1 -and $pub[0] -notmatch ' -(Launcher|VersionOverride|LauncherInputs)\b')
    Yes 'R the feed reaches the VPS store: the site serves what the publisher wrote' (
        ([IO.File]::ReadAllText((Get-FeedVersionFile $siteFeedDir))) -match '20990101-0000')
    # The one thing pushed is the release tag (#444), on the commit the feed
    # names, after the publisher has sent the feed.
    $pushes = @($gone | Where-Object { $_ -match '^git .*\bpush\b' })
    Yes ('R the only git push is the release tag, release/main/20990101-0000' + $(if ($pushes.Count) { ' (' + ($pushes -join '; ') + ')' } else { '' })) (
        $pushes.Count -eq 1 -and $pushes[0] -match ' push origin refs/tags/release/main/20990101-0000$')
    $tags = @($gone | Where-Object { $_ -match '^git .*\btag\b' })
    Yes ('R the tag is made once, annotated, on the commit the feed names' + $(if ($tags.Count) { ' (' + ($tags -join '; ') + ')' } else { '' })) (
        $tags.Count -eq 1 -and $tags[0] -match (' tag -a release/main/20990101-0000 ' + ('ab12' * 10) + ' -F '))
    $at = @{}
    for ($i = 0; $i -lt $r.Calls.Count; $i++) {
        foreach ($k in 'Publish-Update', 'Request-Restart') { if (-not $at.ContainsKey($k) -and $r.Calls[$i].StartsWith($k)) { $at[$k] = $i } }
        if (-not $at.ContainsKey('tag') -and $r.Calls[$i] -match '^git .*\btag -a\b') { $at['tag'] = $i }
    }
    Yes 'R and only after the publisher has sent the feed, and after the release is announced' (
        $at.ContainsKey('tag') -and $at.ContainsKey('Publish-Update') -and $at['tag'] -gt $at['Publish-Update'] -and
        $at.ContainsKey('Request-Restart') -and $at['tag'] -gt $at['Request-Restart'])
    Yes 'R and it says so' ($r.Out -match 'release/main/20990101-0000 marks ab12ab12ab12, and it is on GitHub')
    $devNow = [IO.File]::ReadAllText((Get-FeedVersionFile $siteDevDir)) | ConvertFrom-Json
    Yes 'R a main ship preserves the independently published dev feed' ((Hash-SiteFeed $siteDevDir) -eq $devBeforeMain)
    Yes '  and the independently published dev baseline' ((Hash $siteDevBase) -eq $devBaselineBeforeMain)

    # ---- Q: the freshness guard is not there (#3006) -----------------------------------
    # Ship loads Fresh-Checkout.ps1 under Stop, so a guard that cannot load
    # ends the Ship on that line, before anything is built, called or sent.
    Remove-Item -LiteralPath $freshCopy -Force
    try {
        $q = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Root', $root, '-DistRoot', $dist, '-NoPause')
    } finally { Copy-Item -LiteralPath (Join-Path $realRel '..\deploy\Fresh-Checkout.ps1') -Destination $freshCopy -Force }
    Yes ("Q a real Ship with no Fresh-Checkout.ps1 is refused (exit {0})" -f $q.Code) ($q.Code -ne 0 -and $q.Out -match 'Fresh-Checkout\.ps1')
    Yes ('Q before anything is called or sent' + $(if ($q.Calls.Count) { ' (' + ($q.Calls -join '; ') + ')' } else { '' })) ($q.Calls.Count -eq 0)
    Yes '  and it does not go on past the guard' ($q.Out -notmatch 'Test-FreshAnyBranch|Assert-FreshCheckout' -and $q.Out -notmatch 'Everyone in the world has')

    # ---- E: a dev dry run works out no number at all (#4825) ---------------------------
    # Until #4825 a dev Ship numbered its launcher from the dev store's
    # launchers.txt. It sends no launcher now, so it reads none and passes none,
    # with nothing sent to git, gh, ssh or scp (#907).
    $e = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-Root', $rootDev, '-DistRoot', $dist, '-NoPause')
    $pub = Called $e 'Publish-Update'
    Yes ("E a dev dry run runs to the end (exit {0})" -f $e.Code) ($e.Code -eq 0 -and $e.Out -match 'Dry run finished')
    Yes ('E it passes the publisher no launcher number' + $(if ($pub.Count) { ' (' + $pub[0] + ')' } else { '' })) (
        $pub.Count -eq 1 -and $pub[0] -notmatch ' -VersionOverride\b' -and $e.Out -notmatch '2026\.1101\.1745\.3')
    $gone = Away $e
    Yes ('E and asks nothing of git, gh, ssh or scp to get it' + $(if ($gone.Count) { ' (' + ($gone -join '; ') + ')' } else { '' })) ($gone.Count -eq 0)

    # ---- F: a Ship whose feed did not send (#1055) ---------------------------------------
    # The publisher ends NOT SHIPPED with exit 1 now; Ship must stop there and
    # tell nobody.
    $env:TS_PUB_FAIL = '1'
    try {
        $f = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-Root', $rootDev, '-DistRoot', $dist, '-NoPause')
    } finally { $env:TS_PUB_FAIL = '' }
    Yes ("F a Ship whose feed did not send stops, NOTHING was published (exit {0})" -f $f.Code) (
        $f.Code -eq 1 -and (Called $f 'Publish-Update').Count -eq 1 -and $f.Out -match 'NOTHING was published')
    foreach ($n in 'Publish-Discord', 'Request-Restart', 'Publish-PostShip') {
        Yes "F $n.ps1 is not called" ((Called $f $n).Count -eq 0)
    }
    $pushes = @(Away $f | Where-Object { $_ -match '^git .*\b(push|tag)\b' })
    Yes ('F and no release tag is made' + $(if ($pushes.Count) { ' (' + ($pushes -join '; ') + ')' } else { '' })) ($pushes.Count -eq 0)

    # ---- G: no -Root, on a machine that recorded its dev release folder (#1692) --------
    # Setup-ShipMachine.ps1 -Root writes the file Where.ps1 ShipRoots names, in
    # this machine's own data; Ship takes the folder from it with no -Root.
    $relDevRoot = Join-Path $T 'Release-DevBuild'
    New-Item -ItemType Directory -Force -Path (Join-Path $relDevRoot 'Launcher') | Out-Null
    $relExe = Join-Path $relDevRoot 'Launcher\Thornswood.exe'
    [IO.File]::WriteAllText($relExe, 'the launcher as installed')
    (Get-Item -LiteralPath $relExe).LastWriteTimeUtc = [DateTime]::UtcNow.AddHours(-1)
    $shipRoots = Join-Path $appdata 'Thornswood\ship-roots.json'
    [IO.File]::WriteAllText($shipRoots, (ConvertTo-Json -InputObject ([ordered]@{ dev = $relDevRoot })))
    try {
        $g = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-DistRoot', $dist, '-NoPause')
    } finally { Remove-Item -LiteralPath $shipRoots -Force -ErrorAction SilentlyContinue }
    Yes ("G a dev dry run with no -Root runs to the end (exit {0})" -f $g.Code) ($g.Code -eq 0 -and $g.Out -match 'Dry run finished')
    $pub = Called $g 'Publish-Update'
    Yes '  publishing the folder this machine recorded for dev, not <root>-DevBuild' (
        $pub.Count -eq 1 -and $pub[0].Contains(' -Root ' + $relDevRoot))

    # ---- G2: the recorded folder has no Launcher folder (#2662) -------------------------
    # A ship root Update-ShipRoot.ps1 made: Game and Profile (config.json too,
    # which this stand-in run does not need) and no Launcher folder. Until
    # #2662 every dev Ship stopped on "No dev build at".
    $bareRoot = Join-Path $T 'Release-Bare'
    New-Item -ItemType Directory -Force -Path (Join-Path $bareRoot 'Game'), (Join-Path $bareRoot 'Profile') | Out-Null
    [IO.File]::WriteAllText($shipRoots, (ConvertTo-Json -InputObject ([ordered]@{ dev = $bareRoot })))
    try {
        $g2 = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-DistRoot', $dist, '-NoPause')
    } finally { Remove-Item -LiteralPath $shipRoots -Force -ErrorAction SilentlyContinue }
    Yes ("G2 a dev dry run from a recorded folder with no Launcher folder runs to the end (exit {0})" -f $g2.Code) (
        $g2.Code -eq 0 -and $g2.Out -match 'Dry run finished' -and $g2.Out -notmatch 'No dev build at')
    $pub = Called $g2 'Publish-Update'
    Yes '  publishing it' ($pub.Count -eq 1 -and $pub[0].Contains(' -Root ' + $bareRoot))
    Yes '  and puts no launcher in it, since a Ship has none (#4825)' (-not (Test-Path -LiteralPath (Join-Path $bareRoot 'Launcher')))

    # ---- H: a folder Vortex deploys into (#1692) ---------------------------------------
    $vortexRoot = Join-Path $T 'Vortex-DevBuild'
    New-Item -ItemType Directory -Force -Path (Join-Path $vortexRoot 'Launcher'), (Join-Path $vortexRoot 'Game\Data') | Out-Null
    [IO.File]::WriteAllText((Join-Path $vortexRoot 'Launcher\Thornswood.exe'), 'the launcher as installed')
    [IO.File]::WriteAllText((Join-Path $vortexRoot 'Game\Data\vortex.deployment.json'), '{}')
    $h = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-Root', $vortexRoot, '-DistRoot', $dist, '-NoPause')
    Yes ("H a Ship from a folder Vortex deploys into is refused (exit {0})" -f $h.Code) (
        $h.Code -eq 1 -and $h.Out -match 'is a folder Vortex deploys into' -and $h.Out -match 'Nothing was built')
    Yes '  before anything is built, installed or published' (
        (Called $h 'Build-Launcher').Count -eq 0 -and (Called $h 'Install-Launcher').Count -eq 0 -and (Called $h 'Publish-Update').Count -eq 0)
    Yes '  and the launcher''s source is as it was: no file holds the number' ((Hash $updaterCs) -eq $updaterWas)

    # ---- N: the ship root could not be brought up to date (#2019) ------------------------
    # Update-ShipRoot.ps1 stood in for, exiting 1 as it does when the tool or
    # the client install refuses. On a real Ship, before anything is built,
    # installed, packed or told; and every Ship asks it, dry runs included.
    $rooted = Called $g 'Update-ShipRoot'
    Yes 'G and the root it built from was brought up to date first (Update-ShipRoot.ps1, #2019)' (
        $rooted.Count -eq 1 -and $rooted[0].EndsWith(' -Root ' + $relDevRoot) -and $rooted[0] -match ' -Channel dev\b')
    $env:TS_SHIPROOT_EXIT = '1'
    try {
        $nr = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-Root', $rootDev, '-DistRoot', $dist, '-NoPause')
    } finally { $env:TS_SHIPROOT_EXIT = '' }
    Yes ("N a Ship whose ship root is not current stops (exit {0})" -f $nr.Code) (
        $nr.Code -eq 1 -and $nr.Out -match 'is not current: Update-ShipRoot\.ps1 says why above\. Nothing was built or published\.')
    Yes '  before the launcher is built or installed, and before anything is published or told' (
        (Called $nr 'Build-Launcher').Count -eq 0 -and (Called $nr 'Install-Launcher').Count -eq 0 -and (Called $nr 'Publish-Update').Count -eq 0 -and
        (Called $nr 'Publish-Discord').Count -eq 0 -and (Called $nr 'Request-Restart').Count -eq 0)
    Yes '  and nothing left the machine' (@(Away $nr | Where-Object { $_ -notmatch '^git ' }).Count -eq 0 -and @(Away $nr | Where-Object { $_ -match '\b(push|tag)\b' }).Count -eq 0)
    Yes '  and the launcher''s source is as it was: no file holds the number' ((Hash $updaterCs) -eq $updaterWas)

    # ---- I: the collection cannot build the animation and body files (#1692, #3715) ----
    # Build-Generated.ps1 stood in for: its dry run stops, as it does when a
    # slider set or a patch is not deployed. The real one is held to a folder
    # by tests\test-build-generated.ps1.
    $genRoot = Join-Path $T 'Gen-DevBuild'
    New-Item -ItemType Directory -Force -Path (Join-Path $genRoot 'Launcher'), (Join-Path $genRoot 'Game') | Out-Null
    [IO.File]::WriteAllText((Join-Path $genRoot 'Launcher\Thornswood.exe'), 'the launcher as installed')
    [IO.File]::WriteAllText((Join-Path $genRoot 'Game\SkyrimSE.exe'), 'skyrim')
    # The build's stand-in writes down what it was asked and exits with
    # TS_GEN_EXIT, 0 when unset.
    [IO.File]::WriteAllText((Join-Path $repo 'scripts\mods\Build-Generated.ps1'), (
        'param([string]$Root, [switch]$DryRun, [switch]$NoPause)' + "`r`n" +
        '[IO.File]::AppendAllText($env:TS_DRY_CALLS, ("Build-Generated -Root " + $Root + $(if ($DryRun) { " -DryRun" } else { "" }) + "`r`n"))' + "`r`n" +
        'if ([int]$env:TS_GEN_EXIT) { Write-Host "STOP. No slider set named ''CBBE 3BBB Amazing NeverNude'' is in SliderSets (stand-in)." }' + "`r`n" +
        'exit ([int]$env:TS_GEN_EXIT)' + "`r`n"))
    $oldGenExit = $env:TS_GEN_EXIT
    $env:TS_GEN_EXIT = '1'
    try {
        $i = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-Root', $genRoot, '-DistRoot', $dist, '-NoPause')
    } finally { $env:TS_GEN_EXIT = $oldGenExit }
    $asked = Called $i 'Build-Generated'
    Yes ("I a Ship whose collection cannot build the animation and body files stops (exit {0})" -f $i.Code) (
        $i.Code -eq 1 -and $i.Out -match 'cannot build Thornswood''s animation and body files \(Build-Generated\.ps1 -DryRun exit 1' -and $i.Out -match 'stand-in')
    Yes '  after asking the build of that folder, as a dry run that writes nothing' ($asked.Count -eq 1 -and $asked[0] -match ' -DryRun$' -and $asked[0].Contains(' -Root ' + $genRoot))
    Yes '  before the launcher is built or installed, and before anything is published' (
        (Called $i 'Build-Launcher').Count -eq 0 -and (Called $i 'Install-Launcher').Count -eq 0 -and (Called $i 'Publish-Update').Count -eq 0)
    Yes '  and the installed launcher is the one it had' ([IO.File]::ReadAllText((Join-Path $genRoot 'Launcher\Thornswood.exe')) -eq 'the launcher as installed')

    # ---- J, K, L: SkyUI's menus need node (#1913) ---------------------------------------
    # A game folder that gets as far as the SkyUI menus step: a collection that
    # builds the animation and body files (the build's stand-in above, exit 0)
    # and the in game plugin in place (each has its own harness). node is a stand-in on PATH that writes
    # down what it was asked and exits with TS_NODE_EXIT, so these run the
    # same on a machine with node and on one without.
    $skyRoot = Join-Path $T 'Sky-DevBuild'
    New-Item -ItemType Directory -Force -Path (Join-Path $skyRoot 'Launcher'), (Join-Path $skyRoot 'Game\Data\Platform\Plugins'),
        (Join-Path $repo 'game\plugins') | Out-Null
    $skyExe = Join-Path $skyRoot 'Launcher\Thornswood.exe'
    [IO.File]::WriteAllText($skyExe, 'the launcher as installed')
    (Get-Item -LiteralPath $skyExe).LastWriteTimeUtc = [DateTime]::UtcNow.AddHours(-1)
    [IO.File]::WriteAllText((Join-Path $skyRoot 'Game\SkyrimSE.exe'), 'skyrim')
    foreach ($p in (Join-Path $repo 'game\plugins\stand-in.js'), (Join-Path $skyRoot 'Game\Data\Platform\Plugins\stand-in.js')) {
        [IO.File]::WriteAllText($p, '// the in game plugin, as the source has it')
    }
    $nodeStandIn = Join-Path $bin 'node.ps1'
    $nodeLine = '[IO.File]::AppendAllText($env:TS_DRY_CALLS, ((@(''node'') + @($args | ForEach-Object { [string]$_ })) -join '' '') + "`r`n")'
    # PATH without any folder that holds a real node, for J.
    # A real node is node.exe or node.cmd on Windows, and node elsewhere.
    $nodeNames = if ($OnWindows) { @('node.exe', 'node.cmd') } else { @('node') }
    $noNodePath = (@($bin) + @($oldPath -split [regex]::Escape($pathSep) | Where-Object {
        $d = $_; $d -and -not @($nodeNames | Where-Object { Test-Path -LiteralPath (Join-Path $d $_) }).Count
    })) -join $pathSep
    $skyNote = "The map marker points at the right door`n- The marker over a house now sits on the door you walk through"
    $skyArgs = @($skyNote, '-Channel', 'dev', '-DryRun', '-Root', $skyRoot, '-DistRoot', $dist, '-NoPause')
    $oldNodeExit = $env:TS_NODE_EXIT
    try {
        # J: no node at all.
        $env:PATH = $noNodePath
        $j = Invoke-Ship $skyArgs
        $env:PATH = $bin + $pathSep + $oldPath
        Yes ("J a Ship with a game folder and no node is refused (exit {0})" -f $j.Code) ($j.Code -eq 1 -and $j.Out -match 'STOP\. node is not on this machine')
        Yes '  and says why: SkyUI''s menus are read with it, and how to install it' (
            $j.Out -match 'Check-SkyUIMenus\.js' -and $j.Out -match 'SkyUI error box' -and $j.Out -match 'winget install --id OpenJS\.NodeJS\.LTS')
        Yes '  before anything is built, installed, copied into the game or published' (
            (Called $j 'Build-Launcher').Count -eq 0 -and (Called $j 'Install-Launcher').Count -eq 0 -and
            (Called $j 'Go').Count -eq 0 -and (Called $j 'Publish-Update').Count -eq 0)
        Yes '  and it no longer says it in yellow and carries on' ($j.Out -notmatch 'so SkyUI''s menus were not read' -and $j.Out -notmatch 'Dry run finished')
        Yes '  and the launcher''s source is as it was: no file holds the number' ((Hash $updaterCs) -eq $updaterWas)
        Yes '  and the installed launcher is the one it had' ([IO.File]::ReadAllText($skyExe) -eq 'the launcher as installed')

        [IO.File]::WriteAllText($nodeStandIn, $nodeLine + "`r`nexit ([int]`$env:TS_NODE_EXIT)`r`n")

        # K: the check could not read something.
        $env:TS_NODE_EXIT = '1'
        $k = Invoke-Ship $skyArgs
        $ran = Called $k 'node'
        Yes ("K a Ship whose SkyUI menus could not be read is refused (exit {0})" -f $k.Code) (
            $k.Code -eq 1 -and $k.Out -match 'STOP\. SkyUI''s menus could not all be read \(Check-SkyUIMenus\.js exit 1\)')
        Yes '  after the check really ran on the game folder' ($ran.Count -eq 1 -and $ran[0] -match 'Check-SkyUIMenus\.js' -and $ran[0].Contains((Join-Path $skyRoot 'Game\Data')))
        Yes '  and nothing is published' ((Called $k 'Publish-Update').Count -eq 0 -and (Away $k).Count -eq 0)
        Yes '  and the launcher''s source is as it was: no file holds the number' ((Hash $updaterCs) -eq $updaterWas)

        # L: the same folder, a check that passes, runs to the end.
        $env:TS_NODE_EXIT = '0'
        $l = Invoke-Ship $skyArgs
        Yes ("L the same folder with node and a check that passes runs to the end (exit {0})" -f $l.Code) ($l.Code -eq 0 -and $l.Out -match 'Dry run finished')
        if ($l.Code -ne 0) { $l.Out -split "`r?`n" | Select-Object -Last 15 | ForEach-Object { Write-Host ("      " + $_) } }
        Yes '  and the check ran once' ((Called $l 'node').Count -eq 1)
        Yes '  and the release was published, told not to upload or push, with no launcher built' (
            (Called $l 'Build-Launcher').Count -eq 0 -and @(Called $l 'Publish-Update' | Where-Object { $_ -match ' -NoPush\b' }).Count -eq 1)

        # And a mismatch, exit 2, refuses as it did (#960).
        $env:TS_NODE_EXIT = '2'
        $m = Invoke-Ship $skyArgs
        Yes ("L a mismatch, exit 2, is still refused (exit {0})" -f $m.Code) (
            $m.Code -eq 1 -and $m.Out -match 'not the version its script wants' -and (Called $m 'Publish-Update').Count -eq 0)

    } finally {
        $env:PATH = $bin + $pathSep + $oldPath
        $env:TS_NODE_EXIT = $oldNodeExit
        Remove-Item -LiteralPath $nodeStandIn -Force -ErrorAction SilentlyContinue
    }

    # ---- N: this machine's Vortex behind the collection's record (#3597) ---------------
    # Both feeds said revision 2, One's Vortex, while the record and Nexus were
    # on 5, so a launcher on 2 was let in. A Ship from a Vortex a revision behind
    # stops before the version moves, naming both, and publishes nothing.
    $recRev = [int]$env:TS_DRY_COLLECTION_REVISION
    $env:TS_DRY_COLLECTION_REVISION = [string]($recRev - 1)
    try {
        $nb = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-Root', $rootDev, '-DistRoot', $dist, '-NoPause')
        Yes ("N a Ship from a Vortex a revision behind the record is refused (exit {0})" -f $nb.Code) ($nb.Code -ne 0 -and $nb.Out -match ('collection is on revision ' + $recRev) -and $nb.Out -match ('Vortex is on revision ' + ($recRev - 1)))
        Yes '  and nothing was built or published' ((Called $nb 'Publish-Update').Count -eq 0 -and $nb.Out -match 'Nothing was built or published')
        Yes '  and the launcher''s source is as it was: no file holds the number' ((Hash $updaterCs) -eq $updaterWas)
        $env:TS_DRY_COLLECTION_REVISION = '0'
        $nu = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-Root', $rootDev, '-DistRoot', $dist, '-NoPause')
        Yes ("N a Ship from a Vortex that cannot say its revision is refused, never guessed (exit {0})" -f $nu.Code) ($nu.Code -ne 0 -and $nu.Out -match 'does not say which collection revision' -and (Called $nu 'Publish-Update').Count -eq 0)

        # ---- O: the record behind the newest revision on Nexus (#4068) ------------------
        # Vortex and the record agree, and Nexus has published the next one:
        # a release built now would be on an old revision, so it stops.
        $env:TS_DRY_COLLECTION_REVISION = [string]$recRev
        $env:TS_DRY_NEXUS_PUBLISHED = [string]($recRev + 1)
        $no = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-Root', $rootDev, '-DistRoot', $dist, '-NoPause')
        Yes ("O a Ship while Nexus has a newer revision than the record is refused (exit {0})" -f $no.Code) ($no.Code -ne 0 -and $no.Out -match ('Collection revision ' + ($recRev + 1) + ' is published on Nexus') -and $no.Out -match ('still on ' + $recRev))
        Yes '  and nothing was built or published, and the launcher''s source did not move' ((Called $no 'Publish-Update').Count -eq 0 -and (Hash $updaterCs) -eq $updaterWas)
        $env:TS_DRY_NEXUS_PUBLISHED = 'none'
        $nn = Invoke-Ship @("The map marker points at the right door`n- The marker over a house now sits on the door you walk through", '-Channel', 'dev', '-DryRun', '-Root', $rootDev, '-DistRoot', $dist, '-NoPause')
        Yes ("O a Ship while Nexus does not answer is refused, never taken as current (exit {0})" -f $nn.Code) ($nn.Code -ne 0 -and $nn.Out -match 'Nexus did not say which revision' -and (Called $nn 'Publish-Update').Count -eq 0)
    } finally { $env:TS_DRY_COLLECTION_REVISION = [string]$recRev; $env:TS_DRY_NEXUS_PUBLISHED = '' }
}
finally {
    $env:PATH = $oldPath
    $env:LOCALAPPDATA = $oldAppData
    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
    $env:TS_DRY_CALLS = $oldCalls
    $env:TS_GH_DL = $oldGhDl
    $env:TS_GH_TAG = $oldGhTag
    $env:THORNSWOOD_TEST_SITE_DIR = $oldSite
    if ($null -eq $oldScratch) { Remove-Item Env:THORNSWOOD_SCRATCH_ROOT -ErrorAction SilentlyContinue } else { $env:THORNSWOOD_SCRATCH_ROOT = $oldScratch }
    if ($null -eq $oldVps) { Remove-Item Env:THORNSWOOD_VPS -ErrorAction SilentlyContinue } else { $env:THORNSWOOD_VPS = $oldVps }
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Done
