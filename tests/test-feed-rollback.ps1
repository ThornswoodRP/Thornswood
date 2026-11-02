<#
  test-feed-rollback.ps1

      pwsh -NoProfile -File .\tests\test-feed-rollback.ps1

  A channel's feed goes back to an earlier release and forward again, and a
  launcher already installed lands on exactly that release's files each way
  (#442).

  WHY THIS EXISTS. The feed was an append only chain of deltas with no way
  back: a launcher applies every pack it has not seen and never takes one off,
  so undoing a release meant writing another one by hand. Since #441 every
  release names the record of what it left installed, Publish-Update now keeps
  those records in the feed as "releases", and scripts\release\Rollback-Feed.ps1
  builds one ordinary pack out of the difference between two of them. This
  proves the whole round trip with the real pieces:

    1. Publish-Update's release list block, lifted out between its markers,
       run for three made up releases on a scratch dev feed: the list starts
       with the first release that names a record, keeps the last pack of each,
       and is newest first
    2. the launcher's own Updater and VersionDoc, built from
       launcher\app\Thornswood.csproj the way the build builds it
       (tests\Launcher-Csc.ps1, Add-LauncherAssembly), reading that feed and
       applying its packs with Updater.Install into scratch installs: one
       that took every release as it came, one that was offline since the
       first, and a fresh install seeded like the installer seeds it
    3. the real Rollback-Feed.ps1 in a child pwsh against the scratch site
       (-SiteDir): -List, -DryRun, -Back 1, then -To the first
       release (a file only the installer ever had, restored from its sha256
       beside the record with no -FilesFrom, #1051; refused when that asset is
       missing), then -To the last one again. After each,
       every install takes what is pending and its game folder is compared
       file by file, by size and sha256, with the record of the release asked
       for; the client runtime stays with the launcher; launcherVersion,
       launcherUrl, launcherSha256, minLauncher and clientRuntime do not move;
       the store's baseline is the new record; the note passes Note-Rules;
       "release" names the rollback itself (the launcher the feed keeps, its
       one pack, its baseline, no commit and no tag) and
       Get-ReleaseDisagreements finds nothing (#1058)
    4. refusals that change nothing: an id the feed does not name, the release
       the feed is already on, -To with -Back, a note with a word the notes may
       not carry, and a feed that names no releases

  Runs in pwsh 7 on every machine with the .NET 10 SDK (#4823): the launcher
  is loaded into this PowerShell, which runs on .NET 10 as it does. The
  installs say SKIP off Windows: Updater.Install lays a pack out in the game
  folder by Windows paths (game\Data\...), which only Windows has, so every
  check of what an install ends with runs on Windows alone; the feed, the
  list, the launcher's reading of it and every Rollback-Feed run are checked
  everywhere. Nothing connects anywhere, and everything it writes is in its
  own temp folder.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's SDK and settings (#4823), and $OnWindows

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$rollback = Join-Path $repo 'scripts\release\Rollback-Feed.ps1'
# Rollback-Feed runs in a pwsh of its own, as on the shipping machine.
$shell = (Get-Process -Id $PID).Path

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
# What an install ends with: checked on Windows, where Updater.Install lays
# a pack out by the paths it carries (game\Data\...); said as SKIP elsewhere.
function Yes-Install([string]$what, [scriptblock]$cond) {
    if ($OnWindows) { Yes $what ([bool](& $cond)) }
    else { Write-Host "SKIP  $what (Updater.Install writes the game folder by Windows paths, which only Windows has)" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

Yes 'scripts\release\Rollback-Feed.ps1 is there' (Test-Path -LiteralPath $rollback)
if (-not (Test-Path -LiteralPath $rollback)) { Done }
. (Join-Path $repo 'scripts\release\Release-Baseline.ps1')
. (Join-Path $repo 'scripts\release\Feed-Store.ps1')
. (Join-Path $repo 'scripts\release\Note-Rules.ps1')
. (Join-Path $repo 'scripts\release\Release-Name.ps1')
Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-feed-rollback-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$site = Join-Path $T 'site'
$feedDir = Join-Path $site 'feed-dev'
New-Item -ItemType Directory -Force -Path (Join-Path $feedDir 'assets') | Out-Null
$ascii = New-Object Text.ASCIIEncoding
$utf8 = New-Object Text.UTF8Encoding($false)

# ---- helpers -------------------------------------------------------------------
function Entry([string]$text) {
    $b = $ascii.GetBytes($text)
    $ms = New-Object IO.MemoryStream (, $b)
    try { return ('{0}:{1}' -f $b.Length, (Get-BaselineStreamSha $ms)) } finally { $ms.Dispose() }
}
function Put-Asset([string]$file) {
    $sha = Get-BaselineFileSha $file
    Copy-Item -LiteralPath $file -Destination (Join-Path $feedDir "assets\$sha") -Force
    return $sha
}
function Url([string]$sha) { return "https://thornswood.net/feed-dev/assets/$sha" }
# The feed the site serves is the newest of its generations, and a feed put
# there is the next one, the way the store sends it (Feed-Store.ps1, #2727).
function Feed-File { return (Get-FeedVersionFile $feedDir) }
function Read-Feed { return (([IO.File]::ReadAllText((Feed-File))) -replace '^﻿', '') | ConvertFrom-Json }
# The list a rollback reads, the store's releases.json beside the feed since
# #1050 (Release-Baseline.ps1), merged with any the feed still carries.
function Read-Releases { return @(Get-StoreReleases $feedDir (Read-Feed)) }
function Write-Feed($doc) {
    New-Item -ItemType Directory -Force -Path (Join-Path $feedDir 'version') | Out-Null
    [IO.File]::WriteAllText((Join-Path (Join-Path $feedDir 'version') (Get-FeedVersionNext $feedDir)), ($doc | ConvertTo-Json -Depth 6), $utf8) }
function Feed-Sha { return (Get-BaselineFileSha (Feed-File)) }
# A pack the way Publish-Update builds one: delete.txt, game/<path>, and the
# plugin list under profile/.
function New-Pack([string]$path, [hashtable]$files, [string[]]$deletes, [string]$plugins) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    $z = [IO.Compression.ZipFile]::Open($path, 'Create')
    try {
        if ($deletes) {
            $w = New-Object IO.StreamWriter ($z.CreateEntry('delete.txt').Open())
            foreach ($d in $deletes) { $w.WriteLine($d.Replace('\', '/')) }
            $w.Dispose()
        }
        foreach ($k in $files.Keys) {
            $s = $z.CreateEntry('game/' + $k.Replace('\', '/')).Open()
            $b = $ascii.GetBytes([string]$files[$k]); $s.Write($b, 0, $b.Length); $s.Dispose()
        }
        foreach ($n in 'plugins.txt', 'loadorder.txt') {
            $text = if ($n -eq 'plugins.txt') { $plugins } else { $plugins.Replace('*', '') }
            $s = $z.CreateEntry("profile/$n").Open()
            $b = $ascii.GetBytes($text); $s.Write($b, 0, $b.Length); $s.Dispose()
        }
    } finally { $z.Dispose() }
}

# The release list block, out of the real Publish-Update.ps1.
$pu = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Publish-Update.ps1'))
$lm = [regex]::Match($pu, '(?s)# ==== thornswood release list ====.*?# ==== end thornswood release list ====')
Yes 'the release list block is in Publish-Update.ps1' $lm.Success
$iList = $pu.IndexOf('# ==== thornswood release list ====')
$iSet = $pu.IndexOf("Set-Prop `$doc 'baseline' `$releaseBaseline")
$iAppend = $pu.IndexOf('# ==== end thornswood feed append ====')
$iBefore = $pu.IndexOf('$lastPackBefore = Get-FeedLastPackId $doc')
Yes '  it runs after the packs are appended and before "baseline" moves, with the last pack from before the append' (
    $iBefore -gt 0 -and $iBefore -lt $pu.IndexOf('# ==== thornswood feed append ====') -and $iList -gt $iAppend -and $iSet -gt $iList)
if (-not $lm.Success) { Done }
$listBlock = $lm.Value
function Say($m, $c) { }

# The client runtime stays with the launcher: one of its six recorded paths.
$cb = ((Get-Content -LiteralPath (Join-Path $repo 'records\client-build.json') -Raw) -replace '^﻿', '') | ConvertFrom-Json
$clientRel = @($cb.files.PSObject.Properties.Name)[0]

# ---- the scratch feed and three releases --------------------------------------
#
# What the installer put down, before any release named a record.
$installer = @{ 'Data\Platform\UI\thornswood-a.esp' = 'a0'; 'Data\Platform\UI\thornswood-b.bsa' = 'b0 from the installer'; 'Data\Platform\Plugins\thornswood-ui.js' = 'ui0 from the installer'
                'Data\Platform\UI\thornswood-keep.txt' = 'kept the whole time'; $clientRel = 'client 0' }
$launcherSha = 'c' * 64
$runtimeSha = 'd' * 64
Write-Feed ([pscustomobject][ordered]@{
    launcherVersion = '1.1.102.5'; launcherUrl = (Url ('e' * 64)); launcherSha256 = $launcherSha; minLauncher = '1.1.102.5'
    serverAddress = '192.0.2.1'; serverPort = '7787'; message = ''; packs = @(); news = @()
    clientRuntime = [pscustomobject][ordered]@{ url = (Url $runtimeSha); sha256 = $runtimeSha; bytes = 10; forkCommit = 'abcdef12'; notice = 1 }
    updateFeedUrl = 'https://thornswood.net/feed-dev/version.json' })
$fixed = @{}
foreach ($k in 'launcherVersion', 'launcherUrl', 'launcherSha256', 'minLauncher') { $fixed[$k] = [string](Read-Feed).$k }

$state = @{}; foreach ($k in $installer.Keys) { $state[$k] = $installer[$k] }
$records = @{}
function Publish-Scratch([string]$Id, [hashtable]$changes, [string[]]$deletes, [string]$plugins, [string]$src) {
    foreach ($k in $changes.Keys) { $script:state[$k] = $changes[$k] }
    foreach ($d in @($deletes)) { if ($d) { $script:state.Remove($d) } }
    $zip = Join-Path $T "packs\pack-$Id.zip"
    New-Pack $zip $changes $deletes $plugins
    $zsha = Put-Asset $zip
    $doc = Read-Feed
    $lastPackBefore = Get-FeedLastPackId $doc
    $doc.packs = @(@($doc.packs) + [pscustomobject][ordered]@{ id = $Id; url = (Url $zsha); sha256 = $zsha; notes = "Release $Id" })
    $map = @{}
    # Every file of the release on the site by its sha256, the way Publish-Update
    # does since #1050, so a rollback past the first change to an installer-only
    # file can fetch those bytes without -FilesFrom (#1051).
    foreach ($k in $script:state.Keys) {
        $map[$k] = Entry $script:state[$k]
        $tmp = Join-Path $T ('record-file-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        [IO.File]::WriteAllText($tmp, [string]$script:state[$k], $ascii)
        [void](Put-Asset $tmp)
        Remove-Item -LiteralPath $tmp -Force
    }
    $map[':profile:plugins.txt'] = (Entry $plugins).Split(':')[1].ToUpperInvariant()
    $map[':order:plugins'] = (Entry ($plugins.ToLowerInvariant())).Split(':')[1]
    $map[':src:app\Shell.cs'] = $src
    $map[$RecordFilesKey] = '1'
    $mf = Join-Path $T "records\manifest-$Id.json"
    $msha = Write-BaselineFile $map $mf
    [void](Put-Asset $mf)
    $releaseBaseline = New-FeedBaselinePointer $Id $msha (Url $msha) $map.Count
    Invoke-Expression $listBlock
    if ($doc.PSObject.Properties['baseline']) { $doc.baseline = $releaseBaseline } else { $doc | Add-Member -NotePropertyName baseline -NotePropertyValue $releaseBaseline }
    # What a Ship writes into "release", so a rollback has something to replace (#1058).
    $relRec = New-ReleaseRecord $Id 'dev' ([string]$doc.launcherVersion) @($Id) $Id ('a' * 40) 'scratch' 0
    if ($doc.PSObject.Properties['release']) { $doc.release = $relRec }
    else { $doc | Add-Member -NotePropertyName 'release' -NotePropertyValue $relRec }
    Write-Feed $doc
    Copy-Item -LiteralPath $mf -Destination (Join-Path $feedDir 'published.json') -Force
    $script:records[$Id] = $map
}

$R1 = '20260901-1000-dev'; $R2 = '20260902-1100-dev'; $R3 = '20260903-1200-dev'
Publish-Scratch $R1 @{ 'Data\Platform\UI\thornswood-a.esp' = 'a1'; 'Data\Platform\UI\thornswood-new1.esp' = 'new one' } @() "*thornswood-a.esp`r`n*thornswood-new1.esp`r`n" ('1' * 64)
$d1 = Read-Feed
Yes 'the first release that names a record starts the list, with only itself' (@($d1.releases).Count -eq 1 -and [string]$d1.releases[0].id -eq $R1 -and [string]$d1.releases[0].lastPack -eq $R1)
Publish-Scratch $R2 @{ 'Data\Platform\UI\thornswood-a.esp' = 'a2'; 'Data\Platform\UI\thornswood-b.bsa' = 'b2, the first change to the installer''s file'; 'Data\Platform\UI\thornswood-new2.esp' = 'new two'
                       'Data\Platform\Plugins\thornswood-ui.js' = 'ui2'; $clientRel = 'client 2' } @('Data\Platform\UI\thornswood-new1.esp') "*thornswood-a.esp`r`n*thornswood-new2.esp`r`n" ('2' * 64)
Publish-Scratch $R3 @{ 'Data\Platform\UI\thornswood-a.esp' = 'a3'; 'Data\Platform\UI\thornswood-new2.esp' = 'new two, again'; 'Data\Platform\UI\thornswood-new3.esp' = 'new three' } @() "*thornswood-a.esp`r`n*thornswood-new2.esp`r`n" ('3' * 64)
$d3 = Read-Feed
Yes 'three releases later the list is newest first, each with the pack it ended on' (
    (@($d3.releases | ForEach-Object { [string]$_.id }) -join ',') -eq "$R3,$R2,$R1" -and
    (@($d3.releases | ForEach-Object { [string]$_.lastPack }) -join ',') -eq "$R3,$R2,$R1")
Yes '  and each names its record by sha256 at the site' (@($d3.releases | Where-Object { $_.url -eq (Url $_.sha256) -and (Test-Path -LiteralPath (Join-Path $feedDir "assets\$($_.sha256)")) }).Count -eq 3)

# A feed that names a record but no list yet, the first release after this
# change: the list starts with that record, ending on the last pack before.
$seed = [pscustomobject]@{ packs = @([pscustomobject]@{ id = 'p-old' }); baseline = (New-FeedBaselinePointer 'old' ('a' * 64) (Url ('a' * 64)) 3) }
$seed.packs = @($seed.packs) + [pscustomobject]@{ id = 'p-new' }
$lst = @(Add-FeedRelease $seed (New-FeedBaselinePointer 'new' ('b' * 64) (Url ('b' * 64)) 4) 'p-new' 'p-old' '')
Yes 'a feed with a record and no list starts the list with that record and the pack it ended on' (
    $lst.Count -eq 2 -and $lst[0].id -eq 'new' -and $lst[0].lastPack -eq 'p-new' -and $lst[1].id -eq 'old' -and $lst[1].lastPack -eq 'p-old')
$many = [pscustomobject]@{ releases = @(1..40 | ForEach-Object { New-FeedReleaseEntry (New-FeedBaselinePointer "r$_" ('a' * 64) (Url ('a' * 64)) 1) "r$_" '' }) }
$lst = @(Add-FeedRelease $many (New-FeedBaselinePointer 'top' ('b' * 64) (Url ('b' * 64)) 1) 'top' 'r1' '')
Yes "the list keeps the newest $FeedReleasesKeep" ($lst.Count -eq $FeedReleasesKeep -and $lst[0].id -eq 'top' -and $lst[1].id -eq 'r1')

# ---- the launcher, built ----------------------------------------------------------
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }
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
$mPending = $U.GetMethod('Pending', $flags); $mInstall = $U.GetMethod('Install', $flags); $mNewer = $U.GetMethod('IsNewer', $flags)
$mParse = $VD.GetMethod('Parse', $flags)
Yes 'Updater.Pending, Updater.Install, Updater.IsNewer and VersionDoc.Parse are in the build' (
    $null -ne $mPending -and $null -ne $mInstall -and $null -ne $mNewer -and $null -ne $mParse)
if ($null -eq $mInstall) { Done }
# Pending asks the config which channel this is, because on dev the game
# files come with the launcher's own package (#4825); with no package
# installed here it is the feed's packs and record, as on main.
$cfg = [Activator]::CreateInstance($asm.GetType('Thornswood.Config'))
$log = [Action[string]] { param($m) }

# A scratch install: the game folder, a profile and an applied.txt.
function New-Install([string]$name, [hashtable]$files, [string[]]$applied) {
    $root = Join-Path $T "inst\$name"
    foreach ($d in 'Game', 'Profile\Default', 'Profile\Packs', 'Launcher') { New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null }
    foreach ($k in $files.Keys) {
        $f = Join-Path (Join-Path $root 'Game') $k
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f) | Out-Null
        [IO.File]::WriteAllText($f, [string]$files[$k], $ascii)
    }
    [IO.File]::WriteAllLines((Join-Path $root 'Profile\applied.txt'), [string[]]@($applied))
    return $root
}
# Paths pointed at a scratch install, the way Paths.Init lays one out with a
# Game folder of its own (Init itself asks where the running exe is, and that
# is this PowerShell, not an install).
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
# What the launcher does with a feed: every pending pack, in order, from the
# bytes the feed names, checked against its sha256, through Updater.Install.
function Update-Install([string]$root, [int]$only = -1) {
    Use-Install $root
    $v = $mParse.Invoke($null, @(, [IO.File]::ReadAllBytes((Feed-File))))
    $pending = @($mPending.Invoke($null, @($cfg, $v)))
    # A launcher from #1050 on offers the record the feed names as one update.
    # These records do not say their files are on the site (':record:files'),
    # so it writes that down and takes the packs (Sync.cs), which is what this
    # does. tests\test-record-sync.ps1 is the sync itself.
    if ($pending.Count -eq 1 -and $null -ne $pending[0].Record) {
        [IO.File]::WriteAllText((Join-Path $root 'Profile\release.txt'), ('packs ' + [string]$pending[0].Record.sha256))
        $pending = @($mPending.Invoke($null, @($cfg, $v)))
    }
    $n = 0
    foreach ($p in $pending) {
        if ($only -ge 0 -and $n -ge $only) { break }
        $sha = ([string]$p.sha256).ToLowerInvariant()
        if ([string]$p.url -ne (Url $sha)) { throw "pack $($p.id) is not named at its own sha256" }
        $zip = Join-Path $feedDir "assets\$sha"
        if ((Get-BaselineFileSha $zip) -ne $sha) { throw "pack $($p.id) on the site is not its sha256" }
        $callArgs = New-Object 'object[]' 3
        $callArgs[0] = [string]$zip; $callArgs[1] = $p.PSObject.BaseObject; $callArgs[2] = $log
        [void]$mInstall.Invoke($null, $callArgs)
        $n++
    }
    return $n
}
function Get-Game([string]$root) {
    $game = Join-Path $root 'Game'
    $m = @{}
    foreach ($f in @(Get-ChildItem -LiteralPath $game -Recurse -File)) { $m[$f.FullName.Substring($game.Length + 1)] = Get-BaselineEntry $f.FullName }
    return $m
}
# The game folder against a record: the same paths with the same bytes, the
# client runtime excepted, which is checked on its own.
function Test-Lands([string]$root, [hashtable]$want) {
    $have = Get-Game $root
    $bad = @()
    foreach ($k in @($want.Keys)) {
        if ($k.StartsWith(':') -or $k -eq $clientRel) { continue }
        if (-not $have.ContainsKey($k)) { $bad += "missing $k" } elseif ($have[$k] -ne $want[$k]) { $bad += "wrong $k" }
    }
    foreach ($k in @($have.Keys)) { if ($k -ne $clientRel -and -not $want.ContainsKey($k)) { $bad += "extra $k" } }
    if ($bad.Count) { Write-Host ('      ' + ($bad -join '; ')) }
    return ($bad.Count -eq 0)
}
function Client-Of([string]$root) { return (Get-Game $root)[$clientRel] }
function Plugins-Of([string]$root) { return [IO.File]::ReadAllText((Join-Path $root 'Profile\Default\plugins.txt')) }

# One that took every release as it came, and one offline since the first.
$A = New-Install 'every-release' $installer @()
Yes-Install 'a launcher applies the three releases as they come' { (Update-Install $A) -eq 3 -and (Test-Lands $A $records[$R3]) }
$B = New-Install 'offline' $installer @()
Yes-Install '  and another took only the first before going quiet' { (Update-Install $B 1) -eq 1 -and (Test-Lands $B $records[$R1]) }
# The feed with the list in it still reads in the launcher, and offers no launcher.
$vNow = $mParse.Invoke($null, @(, [IO.File]::ReadAllBytes((Feed-File))))
Yes 'the launcher reads a feed carrying "releases" and "baseline"' ($null -ne $vNow -and @($vNow.packs).Count -eq 3)

# ---- Rollback-Feed.ps1 ----------------------------------------------------------
$work = Join-Path $T 'work'; $rel = Join-Path $T 'rel'
function Rollback([string[]]$more) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $rollback, '-Channel', 'dev', '-NoPause', '-SiteDir', $site,
           '-ReleaseDir', $rel, '-WorkDir', $work) + $more
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & $shell @a 2>&1 | ForEach-Object { "$_" }
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Code = $rc; Out = ($out -join "`n") }
}
function Show([object]$r) { if ($r.Code -ne 0) { foreach ($l in @($r.Out -split "`n" | Where-Object { $_ -match 'STOP|error|Exception|must never ship|never-ship' } | Select-Object -First 8)) { Write-Host "      $l" } } }
function Test-Kept($doc) {
    $ok = $true
    foreach ($k in $fixed.Keys) { if ([string]$doc.$k -ne $fixed[$k]) { $ok = $false } }
    return ($ok -and [string]$doc.clientRuntime.sha256 -eq $runtimeSha)
}

Write-Host ''; Write-Host 'Rollback-Feed.ps1'
$r = Rollback @('-List')
Yes '-List names the three releases and which one the feed is on' ($r.Code -eq 0 -and $r.Out -match [regex]::Escape($R1) -and $r.Out -match [regex]::Escape($R2) -and
                                                                    $r.Out -match ([regex]::Escape($R3) + '.*the feed is on this one'))

$before = Feed-Sha
$r = Rollback @('-Back', '1', '-DryRun', '-Id', '20260904-0900-dev')
Yes '-DryRun builds the pack and sends nothing' ($r.Code -eq 0 -and (Feed-Sha) -eq $before -and (Test-Path -LiteralPath (Join-Path $work 'pack-20260904-0900-dev.zip')))
$r = Rollback @('-To', 'nothing-like-it')
Yes 'an id the feed does not name is refused, and the feed is as it was' ($r.Code -eq 1 -and $r.Out -match 'names no release nothing-like-it' -and (Feed-Sha) -eq $before)
$r = Rollback @('-To', $R3)
Yes 'the release the feed is already on is refused' ($r.Code -eq 1 -and $r.Out -match 'already has what' -and (Feed-Sha) -eq $before)
$r = Rollback @('-To', $R2, '-Back', '1')
Yes '-To and -Back together are refused' ($r.Code -eq 1 -and (Feed-Sha) -eq $before)
$r = Rollback @('-Back', '1', '-Notes', "Back to what the players had`n- Everything goes back.")
Yes 'a note the notes may not carry is refused before anything is sent' ($r.Code -eq 1 -and $r.Out -match 'says player' -and (Feed-Sha) -eq $before)

# One back: from the third release to the second.
$RB = '20260904-1000-dev'
$r = Rollback @('-Back', '1', '-Id', $RB); Show $r
$d = Read-Feed
Yes '-Back 1 puts the feed back to the second release' ($r.Code -eq 0 -and [string]$d.baseline.id -eq $RB -and [string](Read-Releases)[0].to -eq $R2)
Yes '  and the list it goes back from is the store''s now, not the feed''s (#1050)' (-not $d.PSObject.Properties['releases'] -and (Test-Path -LiteralPath (Join-Path $feedDir 'releases.json')))
Yes '  as one more pack on the end of the feed, at its own sha256 on the site' (
    [string]@($d.packs)[-1].id -eq $RB -and [string]@($d.packs)[-1].url -eq (Url ([string]@($d.packs)[-1].sha256)) -and
    (Get-BaselineFileSha (Join-Path $feedDir ("assets\" + [string]@($d.packs)[-1].sha256))) -eq [string]@($d.packs)[-1].sha256)
Yes '  the launcher, minLauncher and the client runtime on the feed do not move' (Test-Kept $d)
Yes '  the store''s baseline is the record the feed now names' ((Get-BaselineFileSha (Join-Path $feedDir 'published.json')) -eq [string]$d.baseline.sha256)
Yes '  the note says what happened and passes the note rules' ([string]$d.news[0].title -match '^The game files go back' -and @(Get-NoteProblems ([string]@($d.packs)[-1].notes)).Count -eq 0)
$bad = @(Get-ReleaseDisagreements $d (Read-Releases))
Yes '  "release" names the rollback: its id, the launcher the feed keeps, its one pack, its baseline, no commit and no tag' (
    [string]$d.release.id -eq $RB -and [string]$d.release.channel -eq 'dev' -and [string]$d.release.launcherVersion -eq '1.1.102.5' -and
    (@($d.release.packs | ForEach-Object { [string]$_ }) -join ',') -eq $RB -and [string]$d.release.baseline -eq $RB -and
    [string]$d.release.commit -eq '' -and [string]$d.release.tag -eq '' -and [string]$d.release.branch -eq '')
Yes '  Get-ReleaseDisagreements finds nothing on that feed' ($bad.Count -eq 0)
$relTxt = @(if (Test-Path -LiteralPath (Join-Path $feedDir 'releases.txt')) { Get-Content -LiteralPath (Join-Path $feedDir 'releases.txt') })
Yes '  the store''s releases.txt has a line for the rollback, not the Ship it left' (
    @($relTxt | Where-Object { ($_ -split "`t")[0] -eq $RB }).Count -eq 1 -and
    @($relTxt | Where-Object { ($_ -split "`t")[0] -eq $R3 }).Count -eq 0)
$wantB = $records[$R2]
Yes-Install 'the launcher that had everything lands on exactly the second release''s files' { (Update-Install $A) -eq 1 -and (Test-Lands $A $wantB) }
Yes-Install '  its plugin list is the one the second release shipped' { (Plugins-Of $A) -eq "*thornswood-a.esp`r`n*thornswood-new2.esp`r`n" }
Yes-Install '  and the client runtime is the one its launcher expects' { (Client-Of $A) -eq (Entry 'client 2') }
Yes-Install 'the one offline since the first takes the rest and the rollback, and lands on the same files' { (Update-Install $B) -eq 3 -and (Test-Lands $B $wantB) }
$C = New-Install 'fresh' @{} @($R1, $R2, $R3)
foreach ($k in $state.Keys) { $f = Join-Path $C "Game\$k"; New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f) | Out-Null; [IO.File]::WriteAllText($f, [string]$state[$k], $ascii) }
Yes-Install 'a fresh install built at the third release takes only the rollback and lands there too' { (Update-Install $C) -eq 1 -and (Test-Lands $C $wantB) }
$vB = $mParse.Invoke($null, @(, [IO.File]::ReadAllBytes((Feed-File))))
Yes 'no launcher is offered: the version did not move' (-not [bool]$mNewer.Invoke($null, @([string]$vB.launcherVersion, '1.1.102.5')))

# All the way back to the first: the installer's own files are in no pack, but
# since #1050 each release put them on the site by sha256 beside the record.
$installerOnly = @('Data\Platform\UI\thornswood-b.bsa', 'Data\Platform\Plugins\thornswood-ui.js')
$held = Join-Path $T 'held-installer-only'
New-Item -ItemType Directory -Force -Path $held | Out-Null
foreach ($k in $installerOnly) {
    $sha = ([string]$records[$R1][$k]).Split(':')[1]
    $src = Join-Path $feedDir "assets\$sha"
    if (Test-Path -LiteralPath $src) { Move-Item -LiteralPath $src -Destination (Join-Path $held $sha) -Force }
}
$before = Feed-Sha
$r = Rollback @('-To', $R1, '-Id', '20260904-1100-dev')
Yes 'going back without the installer-only file on the site is refused, naming it, and nothing is sent' (
    $r.Code -eq 1 -and $r.Out -match [regex]::Escape('Data\Platform\UI\thornswood-b.bsa') -and $r.Out -match 'FilesFrom' -and (Feed-Sha) -eq $before)
# Put the bytes back beside the record. -FilesFrom remains the fallback when
# they are not there; with them on the site, no -FilesFrom is needed (#1051).
foreach ($f in @(Get-ChildItem -LiteralPath $held -File)) {
    Move-Item -LiteralPath $f.FullName -Destination (Join-Path $feedDir ("assets\" + $f.Name)) -Force
}
$RA = '20260904-1200-dev'
$r = Rollback @('-To', $R1, '-Id', $RA); Show $r
$d = Read-Feed
Yes 'going back to a file only the installer ever had works from its sha256 on the site, with no -FilesFrom' (
    $r.Code -eq 0 -and [string]$d.baseline.id -eq $RA -and [string](Read-Releases)[0].to -eq $R1 -and (Test-Kept $d))
Yes-Install '  the launcher lands on the first release''s files, the installer''s back and the later ones gone' { (Update-Install $A) -eq 1 -and (Test-Lands $A $records[$R1]) }
Yes-Install '  with the first release''s plugin list' { (Plugins-Of $A) -eq "*thornswood-a.esp`r`n*thornswood-new1.esp`r`n" }
Yes-Install '  and the client runtime still the launcher''s, not the first release''s' { (Client-Of $A) -eq (Entry 'client 2') }
Yes-Install '  the offline one lands there as well' { (Update-Install $B) -eq 1 -and (Test-Lands $B $records[$R1]) }

# And forward again, to the third.
$RF = '20260904-1300-dev'
$r = Rollback @('-To', $R3, '-Id', $RF); Show $r
$d = Read-Feed
Yes '-To the third release puts the feed forward again' ($r.Code -eq 0 -and [string](Read-Releases)[0].to -eq $R3 -and (Test-Kept $d))
Yes '  and "release" names that rollback, with nothing disagreeing' (
    [string]$d.release.id -eq $RF -and [string]$d.release.launcherVersion -eq '1.1.102.5' -and
    (@($d.release.packs | ForEach-Object { [string]$_ }) -join ',') -eq $RF -and [string]$d.release.baseline -eq $RF -and
    [string]$d.release.commit -eq '' -and [string]$d.release.tag -eq '' -and @(Get-ReleaseDisagreements $d (Read-Releases)).Count -eq 0)
Yes-Install '  every launcher lands on the third release''s files' {
    (Update-Install $A) -eq 1 -and (Test-Lands $A $records[$R3]) -and (Update-Install $B) -eq 1 -and (Test-Lands $B $records[$R3]) -and
    (Update-Install $C) -eq 2 -and (Test-Lands $C $records[$R3]) }
# Since #1050 the record a rollback names also lists what it takes out
# (':gone:') and the plugin list as its pack carries it (':golden:'), for
# launchers that sync to it, so it is the third release's
# record plus those lines, not the same bytes.
$fwd = Read-BaselineFile (Join-Path $feedDir ("assets\" + [string]$d.baseline.sha256))
$same = $true
foreach ($k in @($records[$R3].Keys)) { if ([string]$fwd[$k] -ne [string]$records[$R3][$k]) { $same = $false } }
foreach ($k in @($fwd.Keys)) { if (-not $k.StartsWith(':gone:') -and -not $k.StartsWith(':golden:') -and $k -ne ':record:files' -and -not $records[$R3].ContainsKey($k)) { $same = $false } }
Yes '  the record it names is the third release''s, with the launcher''s own source, what it takes out, and :record:files' (
    (Get-BaselineFileSha (Join-Path $feedDir 'published.json')) -eq [string]$d.baseline.sha256 -and $same -and
    [string]$fwd[':gone:Data\Platform\UI\thornswood-new1.esp'] -eq 'removed' -and [string]$fwd[$RecordFilesKey] -eq '1')
Yes 'the list names every step, newest first' ((@(Read-Releases | ForEach-Object { [string]$_.id }) -join ',') -eq "$RF,$RA,$RB,$R3,$R2,$R1")
$r = Rollback @('-Back', '1', '-DryRun', '-Id', '20260904-1400-dev')
Yes '-Back 1 from there is the release before it in the list' ($r.Code -eq 0 -and $r.Out -match ("going to " + [regex]::Escape($RA)))

# A feed that names no releases: nothing to go back to.
$d.PSObject.Properties.Remove('releases'); Write-Feed $d
Remove-Item -LiteralPath (Join-Path $feedDir 'releases.json') -Force -ErrorAction SilentlyContinue
$before = Feed-Sha
$r = Rollback @('-Back', '1')
Yes 'a feed that names no releases is refused and left alone' ($r.Code -eq 1 -and (Feed-Sha) -eq $before)

Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
Done
