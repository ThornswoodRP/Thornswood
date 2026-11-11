<#
  Scrub-Feed.ps1

  Takes Bethesda's files and one machine's own files out of what a channel's
  feed has already published: every pack that carries one is rebuilt without
  it, every release record that names one is written again without it, the feed
  and the store's baseline are sent through Feed-Store.ps1 like any other feed
  edit, and the old bytes are then deleted from the site once no feed names
  them (#1152, #1227, #1229, #1239).

      .\scripts\release\Scrub-Feed.ps1 -Channel dev -DryRun   what it would do
      .\scripts\release\Scrub-Feed.ps1 -Channel dev           dev first, then check it
      .\scripts\release\Scrub-Feed.ps1 -Channel main          then main

  WHY IT EXISTS. Ship-Rules keeps Bethesda's files out of every new pack,
  record and installer (Test-ShipBethesda), but what went out before those
  rules is still on the site. Measured 29 September over HTTPS: main packs
  20260926-1327, 20260926-1603 and 20260926-2209 carry SkyrimSE.exe.bak-1160-for-369
  (a copy of Skyrim) and CreationKit.exe with its settings; 20260927-0059 and
  20260927-0250 carry 1,897 more of the Creation Kit's files (its dialogue
  views, Tools, Papyrus Compiler, lex, Data\Scripts.zip); 20260915-2018, 2104
  and 2144 each carry the script extender's 62 script sources under
  Data\Scripts\Source. The dev feed lists all of them too. The five dev release
  records name Data\Scripts\Source\IED.psc, which went up loose, and the two
  oldest of them name the whole Creation Kit. Patrick, 29 September: take them
  off the site and rebuild what needs rebuilding so no install breaks.

  ONE MACHINE'S FILES (#1239), the same day, the same way. Ship-Rules asks
  Test-ShipOneMachine for them: runtime state and tokens, logs, backups, face
  exports, Vortex's records, window layouts, settings saved from a mod's menu.
  Measured over HTTPS: 35 packs carried them (nine expired voice join tokens,
  two expired join passes, Vortex's 6 MB deployment record, one machine's key
  binds, crash and display settings, face exports, files a Claude session left
  in the game folder, backups), and every dev record named the join pass or the
  mod menu settings of the machine that ships. Patrick: scrub them from the
  site the same way as the Bethesda files, and stop them ever being packed
  again.

  OTHER PEOPLE'S LOOSE FILES (#1178, #1253), the same way again, as files:
  RaceMenu's menus, other mods' scripts, BodySlide builds, leftovers of mods
  nothing loads, another server's haybale and boss list (Test-ShipNotOurs).
  Patrick, 29 September: "we can scrub already published copies". Unlike the
  two rules above, a delete line or a gone entry naming one stays: an earlier
  release took that file out of installs on purpose, and it keeps doing so. And
  what Ship-Rules holds for the collection stays until a run made on a machine
  whose Vortex has the revision that carries it.

  WHAT CHANGES, AND WHAT A LAUNCHER SEES.
    - A pack keeps its id and every other entry, byte for byte and in the same
      order, with the same file times; only the entries that go (and any line of
      its delete.txt that names one, except what $ShipDeleteAlways deletes on
      purpose) go. Its sha256 and size change, so the feed's entry gets the new
      sha256 and the url that names it.
      A launcher matches packs by id in applied.txt (Updater.Pending), so an
      install that already applied the pack does not fetch it again, and one
      that replays every pack from nothing gets the pack without them.
    - A release record keeps every other key; the entries naming files that go,
      as files and as gone (but not what $ShipDeleteAlways deletes), go. Records are named by their sha256, so
      the new one goes up beside the old one and the feed's "baseline" and
      "releases" name it, with its new entry count. "release" names only ids
      and does not change. The store's published.json is the baseline record's
      own bytes, so it is replaced with the new record in the same send; a
      published.json from before the feed named a baseline (main) is written
      again without them.
      A launcher that synced to the old record sees a record it has not synced
      to, checks every file against it, and writes the new one down. Bethesda's
      files and one machine's files dropped from a record are not listed as
      gone, on purpose: Ship-Rules never lists them as removed, because a
      delete reaches Steam copies where they are the person's own; the
      launcher takes Bethesda tools out of its own game folder itself
      (OwnGame.BethesdaTool). Other authors' loose files (#1178, #1261) that a
      record drops become :gone: with the sha256 the record had for them, so
      the launcher deletes only a copy whose bytes still match what we
      shipped.
    - Rollback-Feed reads the new records and finds each file in the rebuilt
      packs by its size and sha256, which have not changed.
    - Nothing here is an exe or the installer, so nothing is signed: a pack
      and a record are checked by their sha256 in the feed, and the launcher's
      own update (launcherUrl, launcherSha256) is not touched.

  THE ORDER. Dev first, then check it, then main. The dev feed lists the main
  packs by their /feed/assets urls, so the dev run builds and sends the new
  main packs as well and points the dev feed at them; the main run makes the
  same bytes (it takes the ones the dev feed already names when they are this
  pack without the files that go, and otherwise rebuilds, which gives the same
  bytes on the same machine) and points the main feed at them.

  DELETING. Every sha256 a run replaces is written to a ledger on this machine
  (scrub-ledger.json in -WorkDir) BEFORE anything is sent (#1244): the first
  dev run on 29 September stopped between sending the feed and writing the
  ledger, and the next run, finding nothing to change, did not know what to
  delete. At the end of every run each one that
  neither feed names any more, directly or through a record either feed names,
  is deleted from both /feed/assets and /feed-dev/assets, through
  Feed-Store.ps1, which deletes nothing if either feed moved since it was read
  and keeps anything either feed or either baseline still spells out. So after
  the dev run the old records and IED.psc go, and the old main packs stay
  until the main run points the main feed away from them.

  -SiteDir <folder> stands in for C:\Thornswood-Docs and nothing connects
  anywhere; tests\test-scrub-feed.ps1 drove it that way until it went with
  the launcher's feed reader (#5608); this script goes with the feed (#5783).
#>
[CmdletBinding()]
param(
    # main or dev. No default: which feed is scrubbed is always said.
    [Parameter(Mandatory = $true)][ValidateSet('main', 'dev')][string]$Channel,
    # Rebuilds and says what it would send and delete. Sends and deletes nothing.
    [switch]$DryRun,
    [switch]$NoPause,
    # Where packs are fetched and rebuilt, and where the ledger is. Left out,
    # %LOCALAPPDATA%\Thornswood\feed\scrub, beside the feeds' working folders,
    # so the dev run and the main run share it from any worktree.
    [string]$WorkDir,
    # This machine's working folder for the channel's feed (Feed-Store.ps1).
    [string]$ReleaseDir,
    [string]$SiteUrl = 'https://thornswood.net',
    # A folder standing in for C:\Thornswood-Docs. Tests only.
    [string]$SiteDir,
    # The install whose config.json names the collection, for the revision
    # Ship-Rules holds loose files against (#1178).
    [string]$Root = (& (Join-Path $PSScriptRoot 'Where.ps1') Install)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

. (Join-Path $Here 'Read-JsonFile.ps1')
. (Join-Path $Here 'Feed-Store.ps1')
. (Join-Path $Here 'Release-Baseline.ps1')
. (Join-Path $Here 'Ship-Rules.ps1')
# What Ship-Rules holds for the collection leaves the site only from the
# revision that carries it, as it leaves new packs (#1178). LoadOrder.ps1 is
# loaded only to ask this machine's Vortex.
$ShipCollectionRevision = & { . (Join-Path $Here '..\mods\LoadOrder.ps1'); Get-ShipCollectionRevision $Root }
# Test-SiteAsset, which checks each new pack answers on the real site after the
# send. The first dev run on 29 September stopped there without it, after the
# feed had gone out, because the tests run on a folder and never reach that line.
. (Join-Path $Here 'Feed-Rules.ps1')
Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue

$sd = Get-FeedStoreSiteDir $SiteDir
if (-not $ReleaseDir) { $ReleaseDir = Get-FeedStoreDir $Channel }
if (-not $WorkDir) { $WorkDir = Join-Path (Split-Path -Parent (Get-FeedStoreDir main)) 'scrub' }
foreach ($d in @($ReleaseDir, $WorkDir, (Join-Path $WorkDir 'packs'), (Join-Path $WorkDir 'rebuilt'), (Join-Path $WorkDir 'records'))) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}
$Remirror = Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1'
$LedgerFile = Join-Path $WorkDir 'scrub-ledger.json'
$utf8 = New-Object Text.UTF8Encoding($false)

function Get-Prop($o, [string]$k) {
    if ($null -ne $o -and $o.PSObject.Properties[$k]) { return [string]$o.$k }
    return ''
}

# 'feed' or 'feed-dev' for an asset url on the site, '' for anything else.
function Get-AssetPrefix([string]$url) {
    $m = [regex]::Match([string]$url, '/(feed|feed-dev)/assets/[0-9a-fA-F]{64}(?:[?#].*)?$')
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}

# The same url naming other bytes.
function Set-UrlSha([string]$url, [string]$sha) {
    return [regex]::Replace([string]$url, '(/(?:feed|feed-dev)/assets/)[0-9a-fA-F]{64}', ('${1}' + $sha))
}

# ---- what goes: Bethesda's, and one machine's --------------------------------

# Bethesda's (Test-ShipBethesda, #1152) or one machine's own
# (Test-ShipOneMachine, #1239): never on the site, as a file or as gone.
function Test-ScrubMachinePath([string]$rel) {
    return ((Test-ShipBethesda $rel) -or (Test-ShipOneMachine $rel))
}

# A file that is never on the site: those, and another author's loose file
# (Test-ShipNotOurs, #1178).
function Test-ScrubPath([string]$rel) {
    return ((Test-ScrubMachinePath $rel) -or (Test-ShipNotOurs $rel))
}

# A path that is never listed as gone: Bethesda's and one machine's, except
# what every release deletes on purpose ($ShipDeleteAlways in Ship-Rules,
# voice-token.txt), which current packs and records name as gone too and so
# keep. Another author's file an earlier release took out stays gone (#1178).
function Test-ScrubGone([string]$rel) {
    return ((Test-ScrubMachinePath $rel) -and (@(Get-ShipDeleteAlways) -notcontains $rel))
}

# A zip entry's game path, or '' for anything not under game/.
function Get-EntryRel([string]$fullName) {
    $n = $fullName.Replace('/', '\')
    if ($n.StartsWith('game\', [StringComparison]::OrdinalIgnoreCase)) { return $n.Substring(5) }
    return ''
}

# True for an entry that goes: a file that is never on the site, or a folder
# entry whose whole folder is (game/Data/DialogueViews/, game/Claude outputs/).
# Asked of a file straight in the folder, of another kind of file, and of one a
# folder deeper, so Data\Platform, whose loose files are one machine's but whose
# folders are the build's, is not taken for one.
function Test-DropEntry($e) {
    $rel = Get-EntryRel $e.FullName
    if (-not $rel) { return $false }
    if ($e.Name) { return (Test-ScrubPath $rel) }
    $dir = $rel.TrimEnd('\')
    # A folder goes by the first two rules only: under Data\meshes a folder can
    # hold Nemesis's output, which is ours, beside other people's files.
    return ($dir -and (Test-ScrubMachinePath ($dir + '\x')) -and (Test-ScrubMachinePath ($dir + '\y.txt')) -and (Test-ScrubMachinePath ($dir + '\z\w.dds')))
}

function Read-EntryText($e) {
    $s = $e.Open()
    try { $ms = New-Object IO.MemoryStream; $s.CopyTo($ms); return ,($ms.ToArray()) } finally { $s.Dispose() }
}

# The keys of a record or baseline that go: files that are never on the site,
# and paths listed as gone that are never deleted from anybody.
function Get-DropKeys($map) {
    return @(@($map.Keys) | Where-Object {
        if ($_.StartsWith(':gone:')) { Test-ScrubGone $_.Substring(6) }
        elseif ($_.StartsWith(':')) { $false }
        else { Test-ScrubPath $_ } })
}

# delete.txt without the lines naming files that are never deleted from anybody
# (Test-ScrubGone), and how many went. The bytes are handed back untouched when
# none did.
function Get-ScrubbedDeletes([byte[]]$bytes) {
    $text = $utf8.GetString($bytes)
    $bom = ''
    if ($text.Length -and [int]$text[0] -eq 0xFEFF) { $bom = [string][char]0xFEFF; $text = $text.Substring(1) }
    $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $keep = New-Object System.Collections.Generic.List[string]
    $gone = 0
    foreach ($l in ($text -split "`r?`n")) {
        $t = $l.Trim()
        if ($t -and -not $t.StartsWith('#') -and (Test-ScrubGone ($t.Replace('/', '\')))) { $gone++; continue }
        $keep.Add($l)
    }
    if (-not $gone) { return [pscustomobject]@{ Bytes = $bytes; Gone = 0 } }
    return [pscustomobject]@{ Bytes = $utf8.GetBytes($bom + ($keep -join $nl)); Gone = $gone }
}

# What a pack carries that goes: entry paths, and lines of its delete.txt.
function Get-PackDrops([string]$zip) {
    $o = [pscustomobject]@{ Entries = @(); Deletes = 0; Bytes = [int64]0 }
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($e in $z.Entries) {
            if ($e.FullName.Replace('/', '\') -ieq 'delete.txt') { $o.Deletes = (Get-ScrubbedDeletes (Read-EntryText $e)).Gone; continue }
            # Folder entries go with their files and are not counted.
            if ($e.Name -and (Test-DropEntry $e)) { $o.Entries += $e.FullName; $o.Bytes += $e.Length }
        }
    } finally { $z.Dispose() }
    return $o
}

# Every entry of a zip as name to sha256 of its bytes, in order, with its time.
function Get-ZipShape([string]$zip) {
    $list = New-Object System.Collections.Generic.List[object]
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($e in $z.Entries) {
            $s = $e.Open()
            try { $sha = Get-BaselineStreamSha $s } finally { $s.Dispose() }
            $list.Add([pscustomobject]@{ Name = $e.FullName; Sha = $sha; Time = $e.LastWriteTime.ToString('o') })
        }
    } finally { $z.Dispose() }
    return $list.ToArray()
}

# True when $candidate is $old without the entries that go: every other entry at
# the same bytes, in the same order and with the same time, delete.txt without
# the lines that go, and nothing added.
function Test-PackIsScrubOf([string]$candidate, [string]$old) {
    $want = New-Object System.Collections.Generic.List[string]
    $z = [IO.Compression.ZipFile]::OpenRead($old)
    try {
        foreach ($e in $z.Entries) {
            if (Test-DropEntry $e) { continue }
            if ($e.FullName.Replace('/', '\') -ieq 'delete.txt') {
                $b = (Get-ScrubbedDeletes (Read-EntryText $e)).Bytes
                $want.Add($e.FullName + '|' + (Get-BaselineStreamSha (New-Object IO.MemoryStream(, $b))) + '|' + $e.LastWriteTime.ToString('o'))
                continue
            }
            $s = $e.Open()
            try { $want.Add($e.FullName + '|' + (Get-BaselineStreamSha $s) + '|' + $e.LastWriteTime.ToString('o')) } finally { $s.Dispose() }
        }
    } finally { $z.Dispose() }
    $have = @(Get-ZipShape $candidate | ForEach-Object { $_.Name + '|' + $_.Sha + '|' + $_.Time })
    if ($have.Count -ne $want.Count) { return $false }
    for ($i = 0; $i -lt $have.Count; $i++) { if ($have[$i] -ne $want[$i]) { return $false } }
    return $true
}

# The pack again without the entries that go. Same entries in the same order
# with the same names and times, each compressed afresh at the one level, so
# the same pack rebuilt on this machine is the same bytes every time.
function New-ScrubbedPack([string]$old, [string]$dest) {
    $part = $dest + '.part'
    Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
    $in = [IO.Compression.ZipFile]::OpenRead($old)
    try {
        $fs = [IO.File]::Open($part, 'CreateNew')
        $out = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($e in $in.Entries) {
                if (Test-DropEntry $e) { continue }
                $ne = $out.CreateEntry($e.FullName, [IO.Compression.CompressionLevel]::Optimal)
                $ne.LastWriteTime = $e.LastWriteTime
                $w = $ne.Open()
                try {
                    if ($e.FullName.Replace('/', '\') -ieq 'delete.txt') {
                        $b = (Get-ScrubbedDeletes (Read-EntryText $e)).Bytes
                        $w.Write($b, 0, $b.Length)
                    } else {
                        $r = $e.Open()
                        try { $r.CopyTo($w) } finally { $r.Dispose() }
                    }
                } finally { $w.Dispose() }
            }
        } finally { $out.Dispose(); $fs.Dispose() }
    } finally { $in.Dispose() }
    Move-Item -LiteralPath $part -Destination $dest -Force
}

# ---- the ledger -------------------------------------------------------------
# sha256 of what a run replaced, with what it was, until it is deleted.
function Read-Ledger {
    $o = @{}
    if (-not (Test-Path -LiteralPath $LedgerFile)) { return $o }
    $j = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($LedgerFile)) $LedgerFile
    if ($null -ne $j) { foreach ($p in $j.PSObject.Properties) { $o[$p.Name] = [string]$p.Value } }
    return $o
}
function Write-Ledger($map) {
    $o = [ordered]@{}
    foreach ($k in @($map.Keys | Sort-Object)) { $o[$k] = [string]$map[$k] }
    [IO.File]::WriteAllText($LedgerFile, ($o | ConvertTo-Json -Depth 3), $utf8)
}

# Sends files to /<prefix>/assets/<sha256> and checks each is there.
function Send-Assets([string]$prefix, [string[]]$files) {
    if (-not $files.Count) { return }
    $a = @{ Send = $files; Quiet = $true; WorkDir = $WorkDir; Dev = ($prefix -eq 'feed-dev') }
    if ($SiteDir) { $a['SiteDir'] = $SiteDir }
    $global:LASTEXITCODE = 0
    & $Remirror @a
    if ($LASTEXITCODE -ne 0) { throw "Remirror-Site-Feed.ps1 -Send exited $LASTEXITCODE" }
    $h = @{ Have = $true; Dev = ($prefix -eq 'feed-dev') }
    if ($SiteDir) { $h['SiteDir'] = $SiteDir }
    $there = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($x in @(& $Remirror @h)) { [void]$there.Add([string]$x) }
    foreach ($f in $files) {
        $sha = Get-BaselineFileSha $f
        if (-not $there.Contains($sha)) { throw "/$prefix/assets/$sha is not on the site after it was sent." }
    }
}

# Every sha256 on the site one of $prefixes holds, as a set.
function Get-Held([string]$prefix) {
    $h = @{ Have = $true; Dev = ($prefix -eq 'feed-dev') }
    if ($SiteDir) { $h['SiteDir'] = $SiteDir }
    $s = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($x in @(& $Remirror @h)) { [void]$s.Add([string]$x) }
    return ,$s
}

# ---- the feed ------------------------------------------------------------------
Head "The $Channel feed"
# With the store's list of releases, kept beside the feed since #1050.
try { [void](Receive-FeedStore $Channel $ReleaseDir @('version.json', 'published.json', $FeedReleasesFile) -SiteDir $SiteDir) }
catch { Die ("Could not receive the $Channel feed from the VPS, so nothing was changed: " + $_.Exception.Message) }
$VersionFile = Join-Path $ReleaseDir 'version.json'
$StateFile = Join-Path $ReleaseDir 'published.json'
if (-not (Test-Path -LiteralPath $VersionFile)) { Die "The VPS has no version.json for the $Channel channel." }
$doc = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($VersionFile)) $VersionFile
$packs = @()
if ($doc.PSObject.Properties['packs'] -and $doc.packs) { $packs = @($doc.packs) }
Say ("  {0} pack(s) on the feed" -f $packs.Count) 'DarkGray'

# The other channel's feed as the public reads it, for the packs both list: the
# same pack id is the same bytes on both feeds.
$otherChannel = if ($Channel -eq 'dev') { 'main' } else { 'dev' }
$otherPacks = @{}
try {
    $od = Read-SiteFeed $otherChannel -SiteDir $SiteDir -SiteUrl $SiteUrl
    if ($null -ne $od -and $od.PSObject.Properties['packs'] -and $od.packs) {
        foreach ($p in @($od.packs)) { if ($null -ne $p -and (Get-Prop $p 'id')) { $otherPacks[(Get-Prop $p 'id')] = $p } }
    }
} catch { Say "  the $otherChannel feed could not be read ($($_.Exception.Message)); every pack is rebuilt here" 'Yellow' }

# ---- the packs ------------------------------------------------------------------
Head 'Packs'
$ledger = Read-Ledger
$newLedger = @{}
$packSwap = @{}      # old sha256 to @{ Sha; Bytes; Prefix; File }
$sendByPrefix = @{ 'feed' = @(); 'feed-dev' = @() }
$droppedFiles = 0; $droppedBytes = [int64]0
foreach ($p in $packs) {
    $id = Get-Prop $p 'id'; $url = Get-Prop $p 'url'; $sha = (Get-Prop $p 'sha256').ToLowerInvariant()
    if (-not $id -or $sha -notmatch '^[0-9a-f]{64}$') { continue }
    if ($packSwap.ContainsKey($sha)) { continue }
    $prefix = Get-AssetPrefix $url
    if (-not $prefix) { Say "  $id is not on the site ($url), so it cannot be read; left as it is" 'Yellow'; continue }
    $local = Join-Path (Join-Path $WorkDir 'packs') ($sha + '.zip')
    if (-not (Test-Path -LiteralPath $local) -or (Get-BaselineFileSha $local) -ne $sha) {
        try { [void](Get-FeedAssetFile $url $sha $local $sd $SiteUrl) }
        catch { Die ("Pack $id could not be read from the site, so nothing was changed: " + $_.Exception.Message) }
    }
    $b = Get-PackDrops $local
    if (-not $b.Entries.Count -and -not $b.Deletes) { continue }

    # The same pack the other feed already names without them, so one pack id
    # is one set of bytes on both feeds, or else rebuilt here.
    $rebuilt = Join-Path (Join-Path $WorkDir 'rebuilt') ($sha + '.zip')
    $o = $null
    if ($otherPacks.ContainsKey($id)) { $o = $otherPacks[$id] }
    $oSha = if ($null -ne $o) { (Get-Prop $o 'sha256').ToLowerInvariant() } else { '' }
    if ($oSha -and $oSha -ne $sha -and (Get-AssetPrefix (Get-Prop $o 'url'))) {
        $cand = Join-Path (Join-Path $WorkDir 'packs') ($oSha + '.zip')
        try {
            if (-not (Test-Path -LiteralPath $cand) -or (Get-BaselineFileSha $cand) -ne $oSha) { [void](Get-FeedAssetFile (Get-Prop $o 'url') $oSha $cand $sd $SiteUrl) }
            if (Test-PackIsScrubOf $cand $local) { Copy-Item -LiteralPath $cand -Destination $rebuilt -Force; Say "  $id`: the $otherChannel feed already names it without them" 'DarkGray' }
        } catch { Say "  $id`: the $otherChannel feed's copy could not be read ($($_.Exception.Message)); rebuilt here" 'Yellow' }
    }
    # A pack rebuilt by an earlier run under an older rule is made again, not
    # taken: the rule decides what the pack is without.
    if ((Test-Path -LiteralPath $rebuilt) -and -not (Test-PackIsScrubOf $rebuilt $local)) { Remove-Item -LiteralPath $rebuilt -Force }
    if (-not (Test-Path -LiteralPath $rebuilt)) { New-ScrubbedPack $local $rebuilt }
    if (-not (Test-PackIsScrubOf $rebuilt $local)) {
        Remove-Item -LiteralPath $rebuilt -Force -ErrorAction SilentlyContinue
        Die "Pack $id did not rebuild as itself without the files that go. Nothing was sent."
    }
    if ((Get-PackDrops $rebuilt).Entries.Count) { Die "Pack $id still carries a file of Bethesda's, one machine's or another author's after the rebuild. Nothing was sent." }
    $newSha = Get-BaselineFileSha $rebuilt
    $newBytes = (Get-Item -LiteralPath $rebuilt).Length
    $packSwap[$sha] = [pscustomobject]@{ Id = $id; Sha = $newSha; Bytes = $newBytes; Prefix = $prefix; File = $rebuilt; OldBytes = (Get-Item -LiteralPath $local).Length }
    $sendByPrefix[$prefix] += $rebuilt
    $newLedger[$sha] = "pack $id"
    $droppedFiles += $b.Entries.Count; $droppedBytes += $b.Bytes
    $eg = @($b.Entries | Select-Object -First 3) -join ', '
    if ($b.Entries.Count) {
        Say ("  {0}: {1:n0} file(s) of Bethesda's, one machine's or another author's, {2:n1} MB ({3}{4}){5}" -f $id, $b.Entries.Count, ($b.Bytes / 1MB), $eg,
             $(if ($b.Entries.Count -gt 3) { ', ...' } else { '' }), $(if ($b.Deletes) { ", $($b.Deletes) delete line(s)" } else { '' })) 'Yellow'
    } else {
        Say ("  {0}: {1} delete line(s) naming files of Bethesda's, one machine's or another author's, and no such file" -f $id, $b.Deletes) 'Yellow'
    }
    Say ("      {0} ({1:n0} bytes) becomes {2} ({3:n0} bytes)" -f $sha, $packSwap[$sha].OldBytes, $newSha, $newBytes) 'DarkGray'
}
if (-not $packSwap.Count) { Say '  no pack on this feed carries a file of Bethesda''s or one machine''s' 'Green' }

# ---- the records ---------------------------------------------------------------
Head 'Release records'
$ptrs = New-Object System.Collections.Generic.List[object]
$base = $null
try { $base = Get-FeedBaselinePointer $doc } catch { Die $_.Exception.Message }
if ($null -ne $base) { $ptrs.Add($base) }
# The releases the store keeps (merged with any the feed still carries), the
# same objects written back once their pointers are swapped below.
$relList = @()
try { $relList = @(Get-StoreReleases $ReleaseDir $doc) } catch { Die ("The store's list of releases could not be read, so nothing was changed: " + $_.Exception.Message) }
foreach ($r in $relList) { $ptrs.Add($r) }
$recSwap = @{}       # old sha256 to @{ Sha; Entries; Prefix; File; Map }
$recordsKept = @{}   # sha256 of each record the feed names after this run, to its map
foreach ($ptr in $ptrs) {
    $rsha = ([string]$ptr.sha256).ToLowerInvariant()
    if ($recSwap.ContainsKey($rsha) -or $recordsKept.ContainsKey($rsha)) { continue }
    $prefix = Get-AssetPrefix ([string]$ptr.url)
    $f = Join-Path (Join-Path $WorkDir 'records') ($rsha + '.json')
    try { if (-not (Test-Path -LiteralPath $f) -or (Get-BaselineFileSha $f) -ne $rsha) { [void](Get-FeedAssetFile ([string]$ptr.url) $rsha $f $sd $SiteUrl) } }
    catch { Die ("The record of release $([string]$ptr.id) could not be read, so nothing was changed: " + $_.Exception.Message) }
    $map = Read-BaselineFile $f
    $drop = @(Get-DropKeys $map)
    if (-not $drop.Count) { $recordsKept[$rsha] = $map; continue }
    $loose = @()
    if ($map.ContainsKey($RecordFilesKey)) {
        foreach ($k in $drop) {
            $m = [regex]::Match([string]$map[$k], '^\d+:([0-9a-f]{64})$')
            if ($m.Success) { $loose += $m.Groups[1].Value }
        }
    }
    foreach ($k in $drop) {
        # #1261: another author's file we once shipped becomes gone with its
        # sha256. Bethesda's and one machine's stay off the gone list
        # (Test-ScrubMachinePath): a delete must never reach Steam copies of
        # those.
        if (-not $k.StartsWith(':') -and (Test-ShipNotOurs $k) -and -not (Test-ScrubMachinePath $k)) {
            $m = [regex]::Match([string]$map[$k], '^\d+:([0-9a-fA-F]{64})$')
            if ($m.Success) { $map[(':gone:' + $k)] = $m.Groups[1].Value.ToLowerInvariant() }
        }
        $map.Remove($k)
    }
    $nf = Join-Path (Join-Path $WorkDir 'records') ($rsha + '-scrubbed.json')
    $nsha = Write-BaselineFile $map $nf
    $recSwap[$rsha] = [pscustomobject]@{ Id = [string]$ptr.id; Sha = $nsha; Entries = $map.Count; Prefix = $prefix; File = $nf; Loose = $loose }
    $recordsKept[$nsha] = $map
    $sendByPrefix[$prefix] += $nf
    $newLedger[$rsha] = "record $([string]$ptr.id)"
    foreach ($l in $loose) { $newLedger[$l] = "a file record $([string]$ptr.id) named" }
    Say ("  {0}: {1:n0} entr{2} naming files of Bethesda's, one machine's or another author's ({3}{4})" -f [string]$ptr.id, $drop.Count, $(if ($drop.Count -eq 1) { 'y' } else { 'ies' }),
         (@($drop | Select-Object -First 3) -join ', '), $(if ($drop.Count -gt 3) { ', ...' } else { '' })) 'Yellow'
    Say ("      {0} ({1:n0} entries) becomes {2} ({3:n0} entries){4}" -f $rsha, ($map.Count + $drop.Count), $nsha, $map.Count,
         $(if ($loose.Count) { "; $($loose.Count) file(s) it named went up loose" } else { '' })) 'DarkGray'
}
if (-not $ptrs.Count) { Say '  the feed names no release record' 'DarkGray' }
elseif (-not $recSwap.Count) { Say '  no record the feed names has a file of Bethesda''s or one machine''s' 'Green' }

# A loose file stays wanted while any record the feed still names lists it.
foreach ($k in @($newLedger.Keys)) {
    foreach ($m in $recordsKept.Values) {
        if ((Get-RecordFileShas $m).ContainsKey($k)) { $newLedger.Remove($k); break }
    }
}

# The store's baseline: the baseline record's own bytes when it is that record,
# otherwise itself without them.
$stateSwap = ''
if (Test-Path -LiteralPath $StateFile) {
    $have = Get-BaselineFileSha $StateFile
    if ($null -ne $base -and $recSwap.ContainsKey($have) -and $have -eq ([string]$base.sha256).ToLowerInvariant()) {
        $stateSwap = $recSwap[$have].File
        Say '  the store''s published.json is the baseline record, and becomes the new one' 'DarkGray'
    } else {
        $sm = Read-BaselineFile $StateFile
        $sdrop = @(Get-DropKeys $sm)
        if ($sdrop.Count) {
            foreach ($k in $sdrop) { $sm.Remove($k) }
            $stateSwap = Join-Path $WorkDir ("published-$Channel-scrubbed.json")
            [void](Write-BaselineFile $sm $stateSwap)
            Say ("  the store's published.json names {0:n0} file(s) of Bethesda's, one machine's or another author's, and is written again without them ({1:n0} entries)" -f $sdrop.Count, $sm.Count) 'Yellow'
        }
    }
}

if (-not $packSwap.Count -and -not $recSwap.Count -and -not $stateSwap) {
    Say ''
    Say "Nothing on the $Channel feed names a file of Bethesda's, one machine's or another author's." 'Green'
}

# The files every new record lists are on the site beside it.
foreach ($rs in $recSwap.Values) {
    if (-not $recordsKept[$rs.Sha].ContainsKey($RecordFilesKey)) { continue }
    $held = Get-Held $rs.Prefix
    $miss = @((Get-RecordFileShas $recordsKept[$rs.Sha]).Keys | Where-Object { -not $held.Contains($_) })
    if ($miss.Count) { Die ("Record $($rs.Id) names {0} file(s) that are not on the site beside it, {1}. Nothing was sent." -f $miss.Count, (($miss | Select-Object -First 3) -join ', ')) }
}

Head 'Summary'
Say ("  {0} pack(s) rebuilt without {1:n0} file(s) of Bethesda's, one machine's or another author's, {2:n1} MB" -f $packSwap.Count, $droppedFiles, ($droppedBytes / 1MB)) 'Green'
Say ("  {0} record(s) written again" -f $recSwap.Count) 'Green'
if ($DryRun) {
    Say ''
    Say '-DryRun: nothing was sent or deleted. The rebuilt packs and records are in' 'Yellow'
    Say "  $WorkDir" 'Yellow'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ---- send -----------------------------------------------------------------------
# What this run replaces goes on the ledger before anything leaves (#1244). The
# first dev run on 29 September stopped after the feed was sent and before the
# ledger was written, and the run after it found nothing to change and so never
# knew the six assets it had replaced. Written first, a run that stops anywhere
# from here on leaves the next one knowing what to delete; a sha256 on it that a
# feed still names is kept until none does, so writing it early deletes nothing
# sooner.
foreach ($k in @($newLedger.Keys)) { $ledger[$k] = $newLedger[$k] }
Write-Ledger $ledger

if ($packSwap.Count -or $recSwap.Count -or $stateSwap) {
    Head 'Sending'
    foreach ($pf in @('feed', 'feed-dev')) {
        $files = @($sendByPrefix[$pf] | Select-Object -Unique)
        if (-not $files.Count) { continue }
        try { Send-Assets $pf $files }
        catch { Die ("The new packs and records did not all reach /$pf/assets, so the feed has not been touched: " + $_.Exception.Message) }
        Say ("  {0} new asset(s) on the site under /{1}/assets" -f $files.Count, $pf) 'Green'
    }

    foreach ($p in $packs) {
        $sha = (Get-Prop $p 'sha256').ToLowerInvariant()
        if (-not $packSwap.ContainsKey($sha)) { continue }
        $p.sha256 = $packSwap[$sha].Sha
        $p.url = Set-UrlSha (Get-Prop $p 'url') $packSwap[$sha].Sha
    }
    foreach ($ptr in $ptrs) {
        $rsha = ([string]$ptr.sha256).ToLowerInvariant()
        if (-not $recSwap.ContainsKey($rsha)) { continue }
        $ptr.sha256 = $recSwap[$rsha].Sha
        $ptr.url = Set-UrlSha ([string]$ptr.url) $recSwap[$rsha].Sha
        if ($ptr.PSObject.Properties['entries']) { $ptr.entries = $recSwap[$rsha].Entries }
    }
    # The store's list goes back with the pointers it holds swapped, and the
    # feed no longer carries one (#1050).
    if ($relList.Count) { Save-StoreReleases $ReleaseDir $relList; Remove-FeedReleasesField $doc }
    Write-FeedVersionFile $VersionFile $doc
    if ($stateSwap) { Copy-Item -LiteralPath $stateSwap -Destination $StateFile -Force }
    $files = @('version.json')
    if ($relList.Count) { $files += $FeedReleasesFile }
    if (Test-Path -LiteralPath $StateFile) { $files += 'published.json' }
    try { $sent = Send-FeedStore $Channel $ReleaseDir $files -SiteDir $SiteDir }
    catch { Die ("The $Channel feed was not sent: " + $_.Exception.Message + ' The new packs are on the site beside the old ones; run this again.') }
    Say ("  sent: {0}" -f ((@($sent.Sent) + @()) -join ', ')) 'Green'

    # As a launcher reads it.
    $pub = Read-SiteFeed $Channel -SiteDir $SiteDir -SiteUrl $SiteUrl
    $bad = @()
    foreach ($p in @($pub.packs)) {
        $sha = (Get-Prop $p 'sha256').ToLowerInvariant()
        foreach ($ps in $packSwap.Values) {
            if ($ps.Id -ne (Get-Prop $p 'id')) { continue }
            if ($sha -ne $ps.Sha) { $bad += "pack $($ps.Id) is $sha on the site's feed" }
        }
    }
    $answer = @()
    foreach ($ps in $packSwap.Values) { $answer += [pscustomobject]@{ Prefix = $ps.Prefix; Sha = $ps.Sha; Bytes = [int64]$ps.Bytes } }
    foreach ($rs in $recSwap.Values) { $answer += [pscustomobject]@{ Prefix = $rs.Prefix; Sha = $rs.Sha; Bytes = [int64](Get-Item -LiteralPath $rs.File).Length } }
    foreach ($x in $answer) {
        $ok = if ($sd) { (Test-Path -LiteralPath (Join-Path $sd "$($x.Prefix)\assets\$($x.Sha)")) } else { Test-SiteAsset $SiteUrl $x.Prefix $x.Sha $x.Bytes }
        if (-not $ok) { $bad += "/$($x.Prefix)/assets/$($x.Sha) does not answer with $($x.Bytes) bytes" }
    }
    if ($bad.Count) { Die ("The feed was sent, but " + ($bad -join '; ') + '. Look before running anything else.') }
    Say '  the site''s feed names the new packs and records, and each one answers' 'Green'
}

# ---- delete what nothing names -----------------------------------------------------
Head 'Deleting what no feed names'
if (-not $ledger.Count) { Say '  nothing waiting' 'DarkGray' }
else {
    # Both feeds as they are now, each read with its sha256, and every record they
    # name, so nothing either one still reaches is deleted.
    $expect = @{}
    $named = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($ch in @('main', 'dev')) {
        $look = Join-Path $WorkDir ("look-$ch")
        $read = Receive-FeedStore $ch $look @('version.json', 'published.json', $FeedReleasesFile) -SiteDir $SiteDir
        $expect[$ch] = [string]$read['version.json']
        # releases.json (#1050) names each release's record by its sha256, as
        # version.json used to, so it is read as text the same way.
        foreach ($f in @('version.json', 'published.json', $FeedReleasesFile)) {
            $pth = Join-Path $look $f
            if (-not (Test-Path -LiteralPath $pth)) { continue }
            # published.json is often the baseline record itself. Its :gone:
            # values may be sha256s of files we once shipped (#1261); those are
            # instructions to the launcher, not assets the feed still hands
            # out. Read them as a record so only real file entries count.
            if ($f -eq 'published.json') {
                foreach ($k in @((Get-RecordFileShas (Read-BaselineFile $pth)).Keys)) {
                    [void]$named.Add($k)
                }
                continue
            }
            foreach ($m in [regex]::Matches([IO.File]::ReadAllText($pth), '[0-9a-f]{64}')) { [void]$named.Add($m.Value) }
        }
        $d2 = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText((Join-Path $look 'version.json'))) (Join-Path $look 'version.json')
        # A baseline the feed names but cannot be read from leaves every file
        # its record names unnamed here, and then deleted (#2711: this was a
        # try with an empty catch). It stops before anything is deleted.
        $rp = @()
        try { $b2 = Get-FeedBaselinePointer $d2 }
        catch { Die ("The $ch feed names a baseline that does not read, so the files its record names cannot be kept. Nothing was deleted: " + $_.Exception.Message) }
        if ($null -ne $b2) { $rp += $b2 }
        $rp += @(Get-StoreReleases $look $d2)
        foreach ($r in $rp) {
            $rsha = ([string]$r.sha256).ToLowerInvariant()
            $rf = Join-Path (Join-Path $WorkDir 'records') ($rsha + '.json')
            try {
                if (-not (Test-Path -LiteralPath $rf) -or (Get-BaselineFileSha $rf) -ne $rsha) { [void](Get-FeedAssetFile ([string]$r.url) $rsha $rf $sd $SiteUrl) }
            } catch { Die ("A record the $ch feed names could not be read, so nothing was deleted: " + $_.Exception.Message) }
            foreach ($k in @((Get-RecordFileShas (Read-BaselineFile $rf)).Keys)) { [void]$named.Add($k) }
        }
    }
    $cand = @($ledger.Keys | Where-Object { -not $named.Contains($_) } | Sort-Object)
    $wait = @($ledger.Keys | Where-Object { $named.Contains($_) })
    foreach ($k in $wait) { Say ("  kept for now, a feed still names it: {0} ({1})" -f $k, $ledger[$k]) 'DarkGray' }
    if ($cand.Count) {
        $gone = @{}; $still = @{}
        foreach ($ch in @('main', 'dev')) {
            $r = $null
            try { $r = Remove-FeedStoreAssets $ch $cand $expect -SiteDir $SiteDir }
            catch { Die ("Nothing more was deleted: " + $_.Exception.Message) }
            foreach ($g in @($r.Gone)) { $gone[$g] = $true; Say ("  deleted /{0}/assets/{1} ({2})" -f (Get-FeedStorePrefix $ch), $g, $ledger[$g]) 'Green' }
            foreach ($n in @($r.Named)) { $still[$n] = $true }
            if (@($r.Bad).Count) { Die ("Not asset names: " + (@($r.Bad) -join ', ')) }
        }
        foreach ($k in $cand) {
            if ($still.ContainsKey($k)) { Say "  kept, a feed or baseline on the VPS still names it: $k" 'Yellow'; continue }
            $ledger.Remove($k)
        }
        Write-Ledger $ledger
    }
    if ($ledger.Count) { Say ("  {0} waiting until no feed names them; the run on the other channel deletes them" -f $ledger.Count) 'Yellow' }
    else { Say '  every replaced file is off the site' 'Green' }
}

Write-Host ''
Say "Done: the $Channel feed names no file of Bethesda's, one machine's or another author's." 'Green'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
