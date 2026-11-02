<#
  Feed-Store.ps1

  Where each channel's feed, its release baseline and their history are kept,
  and the only code that reads or writes them there (#907).

      . (Join-Path $PSScriptRoot 'Feed-Store.ps1')

  WHY IT EXISTS. Until 28 September the feed (version.json) and the baseline
  Ship diffs against (published.json) lived in two git clones of
  EvilPatrick06/Thornswood-Releases beside the repository, pulled, committed
  and pushed by every script that edits the feed. Since #897 every download
  comes from thornswood.net, so that repository held nothing a launcher needs,
  and Patrick asked for it to go: "I just want the repo deleted in general if
  we won't be using it anymore". So the store moved to the VPS, beside the feed
  the site already serves:

      C:\Thornswood-Docs\feed\version\<8 digits>.json
                                                every feed sent, one new file each,
                                                never replaced; the newest is the
                                                live feed (served, #2727)
      C:\Thornswood-Docs\feed\published.json    the live baseline (not served)
      C:\Thornswood-Docs\feed\launchers.txt     every launcher version this
                                                channel has published (not served)
      C:\Thornswood-Docs\feed\releases.txt      every release the feed has named,
                                                by its id, with what else it is
                                                known by (#444, not served)
      C:\Thornswood-Docs\feed\releases.json     the record of each of the last
                                                thirty releases, which a rollback
                                                goes back to (#442); in the feed
                                                as "releases" until #1050 (not
                                                served). Received and sent by
                                                name, like published.json
      C:\Thornswood-Docs\feed\history\          each other file as it was before it
                                                was replaced, <utc stamp>-<name>
                                                (not served)

  and the same under feed-dev for the dev channel. site\server.js answers only
  /feed[-dev]/version.json and /feed[-dev]/assets/<64 hex>, so nothing else in
  those folders can be fetched (tests\test-feed-store.ps1 asks a copy of it).

  ON THIS MACHINE each channel has a working folder, not a git repository:
  %LOCALAPPDATA%\Thornswood\feed\main and ...\feed\dev (Get-FeedStoreDir). A
  script receives the files into it, edits them there, and sends them back.
  read.json in that folder records the sha256 of each file as it was received,
  and backup\ keeps the last twenty copies of each file received, so this
  machine always has the last few feeds and baselines it saw.

  TWO PUBLISHERS AT ONCE. A send checks, on the VPS and in the same step that
  replaces the file, that every file it names still has the sha256 it had when
  this machine received it. If another Ship or feed edit has gone out since,
  nothing is replaced and the send throws, the way git refused a push that was
  behind. The file goes up as <name>.part first and is renamed over the old one
  only once it is whole, and the old one is copied into history\ first.

      Get-FeedStoreDir main|dev          this machine's working folder
      Receive-FeedStore main|dev -Dir    fetch the files, record what was read
      Send-FeedStore main|dev -Dir -Files version.json[, published.json]
                                         send them back, refusing if moved
      Get-FeedStoreThere main|dev        the sha256 of each file up there now
      Get-FeedStoreLaunchers main|dev    launchers.txt, one version a line
      Get-FeedStoreReleases main|dev     releases.txt, one release a line
      Read-SiteFeed main|dev             the feed as the public reads it
      Write-FeedVersionFile -Path -Doc   write version.json as every writer
                                         must: compact, no byte order mark
                                         (Feed-Json.ps1, dot-sourced here)
      Remove-FeedStoreAssets main|dev -Shas -Expect
                                         delete assets no feed names any more,
                                         refusing if either feed moved (#1152)

  -SiteDir <folder>, or $env:THORNSWOOD_TEST_SITE_DIR, stands in for
  C:\Thornswood-Docs on this machine: every read, send and rename happens in
  that folder, by the same script the VPS runs, and nothing connects anywhere.
  The tests use it.
#>

. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named
. (Join-Path $PSScriptRoot 'Feed-Json.ps1')       # Write-FeedVersionFile: the one way version.json is written (#1050)
. (Join-Path $PSScriptRoot 'RecordShape.ps1')     # the feed contracts every send is held to (#2180)
function Get-FeedStorePrefix([string]$Channel) {
    if ($Channel -eq 'dev') { return 'feed-dev' }
    if ($Channel -eq 'main' -or -not $Channel) { return 'feed' }
    throw "Feed-Store.ps1 knows the channels main and dev, not '$Channel'."
}

# This machine's working folder for a channel. Under LOCALAPPDATA beside the
# pending-release notes, so every worktree on the machine shares one, and the
# uninstaller cannot reach it. Where.ps1 says where that is, off Windows too
# (#2903): this used to join $env:LOCALAPPDATA itself, which is null on Linux.
function Get-FeedStoreDir([string]$Channel) {
    $prefix = Get-FeedStorePrefix $Channel
    $place = if ($prefix -eq 'feed-dev') { 'ReleasesDev' } else { 'Releases' }
    return (& (Join-Path $PSScriptRoot 'Where.ps1') $place)
}

# The folder a release from the feed is staged in and built from, one a
# channel, in this machine's own data beside the working folders (#2754,
# New-FeedRoot.ps1 and Ship -FromFeed).
function Get-FeedRootDir([string]$Channel) {
    $prefix = Get-FeedStorePrefix $Channel
    $leaf = if ($prefix -eq 'feed-dev') { 'dev' } else { 'main' }
    return (Join-Path (Join-Path (& (Join-Path $PSScriptRoot 'Where.ps1') MachineData) 'feed-root') $leaf)
}

function Get-FeedStoreSiteDir([string]$SiteDir) {
    if ($SiteDir) { return $SiteDir }
    if ($env:THORNSWOOD_TEST_SITE_DIR) { return [string]$env:THORNSWOOD_TEST_SITE_DIR }
    return ''
}

function Get-FeedStoreSha([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return '' }
    # .NET rather than Get-FileHash: that one comes from a module, and Windows
    # PowerShell started from a PowerShell 7 shell inherits a PSModulePath
    # whose Utility module it cannot load, so the command is not there.
    # Shared for delete as well, so this read never stops the swap (#2727).
    $h = [Security.Cryptography.SHA256]::Create()
    $s = New-Object IO.FileStream((Resolve-Path -LiteralPath $path).ProviderPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try { return (-join ($h.ComputeHash($s) | ForEach-Object { $_.ToString('x2') })) }
    finally { $s.Dispose(); $h.Dispose() }
}

# Where the VPS is, from scripts\vps\vps.json, unless the caller says.
function Get-FeedStoreVps([hashtable]$To) {
    $o = @{ Vps = ''; User = ''; Root = 'C:/Thornswood-Docs' }
    if ($null -ne $To) { foreach ($k in @($To.Keys)) { if ($To[$k]) { $o[$k] = [string]$To[$k] } } }
    if (-not $o.Vps -or -not $o.User) {
        $vpsPs1 = Join-Path $PSScriptRoot '..\vps\Vps.ps1'
        if (-not (Test-Path -LiteralPath $vpsPs1)) { throw "scripts\vps\Vps.ps1 is not beside Feed-Store.ps1, so the VPS address is not known." }
        . $vpsPs1
        if (-not $o.Vps) { $o.Vps = Get-ThornswoodVpsAddress }
        if (-not $o.User) { $o.User = Get-ThornswoodVpsUser }
    }
    return $o
}

# ------------------------------------------------------------ the one rename
# A file into the place of another in one rename. Until it the file is the
# old one, after it the new one. Not File.Replace (#2591): ReplaceFile moves
# the old file aside first and then the new one in, so a send stopped
# between the two left the feed file missing, and the site answered 404 for
# it until the next send (tests\test-2591-whole-records.ps1 kills a swap in
# a loop and finds the file whole every time).
#
# The rename keeps POSIX semantics (#2727): SetFileInformationByHandle with
# FileRenameInfoEx and FILE_RENAME_FLAG_POSIX_SEMANTICS. The plain rename,
# MoveFileEx with MOVEFILE_REPLACE_EXISTING, which this was from #2591 to
# #2727, is refused with "Access is denied" while ANY handle is open on the
# file it replaces, even one opened with share-delete, even a stat. The site
# (site\server.js) stats version.json for every launcher's 304 and every
# feed watch tick and reads it for every 200, so a Ship could stop with NOT
# SHIPPED because a launcher asked for the feed at that moment. Measured 18
# Oct on One, 2000 swaps beside a node loop doing server.js's statSync and
# readFileSync: MoveFileEx refused 1616 of them, this rename none. A reader
# that opened the file with share-delete keeps reading the old bytes. A
# handle opened WITHOUT share-delete still refuses it, with "being used by
# another process"; every reader in this file and the site's node open with
# share-delete. What no rename gives is a name that is always there: for a
# moment inside every replace, POSIX or not, the old name is gone and the
# new one not yet in (measured 19 Oct, #2727, on the box and on One). So
# the file the site serves, version.json, is never replaced at all: each
# one is a new file (the feed's own generations, below). Needs NTFS on
# Windows 10 1709 or Windows Server 2019 or later: the VPS is Windows Server
# 2022, and the working folder is under LOCALAPPDATA on the system drive.
# Windows PowerShell 5.1, which runs this on the VPS, has no such call in
# .NET, so it is declared. Its own type, not the generated record's GeneratedOs
# (launcher\app\GeneratedBuild.cs, which Generated.ps1 compiles), so
# neither can load the other's rename first in one session.
$script:FeedStoreSwap = @'
function Move-FeedStoreInto([string]$from, [string]$to) {
  # Off Windows (a Ship from the feed in the cloud, #2903) there is no
  # kernel32, and loading FeedSwap fails with "Value cannot be null (path1)".
  # There File.Move with overwrite is rename(2), which already replaces the
  # name in one step with the POSIX semantics asked of Windows below: a
  # reader holding the old file keeps it, and a new reader gets the new one.
  # Windows PowerShell 5.1 never reaches this line, so the overload it lacks
  # is never asked of it.
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { [IO.File]::Move($from, $to, $true); return }
  if (-not ('Thornswood.FeedSwap' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace Thornswood
{
    public static class FeedSwap
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetFileInformationByHandle(SafeFileHandle file, int infoClass, IntPtr info, uint size);
        // DELETE | SYNCHRONIZE | FILE_READ_ATTRIBUTES on the new file, shared
        // all ways, write-through as MOVEFILE_WRITE_THROUGH opened it.
        const uint Access = 0x00010000 | 0x00100000 | 0x80;
        const uint ShareAll = 0x1 | 0x2 | 0x4;
        const uint OpenExisting = 3;
        const uint WriteThrough = 0x80000000;
        const int FileRenameInfoEx = 22;
        // FILE_RENAME_FLAG_REPLACE_IF_EXISTS | FILE_RENAME_FLAG_POSIX_SEMANTICS
        const int Flags = 0x1 | 0x2;
        public static void Into(string from, string to)
        {
            string source = Path.GetFullPath(from), target = Path.GetFullPath(to);
            using (SafeFileHandle h = CreateFileW(source, Access, ShareAll, IntPtr.Zero, OpenExisting, WriteThrough, IntPtr.Zero))
            {
                if (h.IsInvalid) Fail(from, to, Marshal.GetLastWin32Error());
                // FILE_RENAME_INFO: Flags, RootDirectory (none), FileNameLength
                // in bytes, then the name.
                byte[] name = System.Text.Encoding.Unicode.GetBytes(target);
                int lengthAt = IntPtr.Size * 2, nameAt = lengthAt + 4;
                int size = nameAt + name.Length + 2;
                IntPtr info = Marshal.AllocHGlobal(size);
                try
                {
                    for (int i = 0; i < size; i++) Marshal.WriteByte(info, i, 0);
                    Marshal.WriteInt32(info, 0, Flags);
                    Marshal.WriteInt32(info, lengthAt, name.Length);
                    Marshal.Copy(name, 0, IntPtr.Add(info, nameAt), name.Length);
                    if (!SetFileInformationByHandle(h, FileRenameInfoEx, info, (uint)size)) Fail(from, to, Marshal.GetLastWin32Error());
                }
                finally { Marshal.FreeHGlobal(info); }
            }
        }
        static void Fail(string from, string to, int error)
        {
            throw new IOException(to + " could not be replaced by " + from + ": " +
                                  new System.ComponentModel.Win32Exception(error).Message);
        }
    }
}
"@
  }
  [Thornswood.FeedSwap]::Into($from, $to)
}
'@
. ([scriptblock]::Create($script:FeedStoreSwap))

# ------------------------------------------------------------ the feed's generations
# version.json, the one store file the public reads, is never replaced
# (#2727). Each feed sent is a new file, version\<8 digits>.json in the
# channel's folder, numbered one past the newest, and none is ever replaced
# or deleted: the newest is the feed, and the rest are its history. Windows
# has no way to put a file in place of another by name without a moment
# where the name is missing: measured 19 Oct on the box (Windows Server
# 2022) with 6 swappers and 6 readers for 10 s a run, the POSIX rename left
# 363 to 4791 opens of 300k finding nothing, MoveFileEx 801 to 4127, a
# replacing hard link up to 1487, and One showed it too. site\server.js
# opens the feed for every launcher's check and every /watch tick, so a
# request in a Ship's swap answered 404. A new name only ever appears, and
# the one before it stays, so a reader that lists the folder and opens the
# newest always finds a whole feed. site\server.js reads it the same way
# (feedFile there). The same block runs on the box and here.
$script:FeedStoreGenerations = @'
function Get-FeedVersionName([string]$channelDir) {
  $v = Join-Path $channelDir 'version'
  if (-not (Test-Path -LiteralPath $v -PathType Container)) { return '' }
  $last = @(Get-ChildItem -LiteralPath $v -File | Where-Object { $_.Name -match '^\d{8}\.json$' } | Sort-Object Name | Select-Object -Last 1)
  if (-not $last.Count) { return '' }
  return $last[0].Name
}
function Get-FeedVersionFile([string]$channelDir) {
  $n = Get-FeedVersionName $channelDir
  if (-not $n) { return '' }
  return (Join-Path (Join-Path $channelDir 'version') $n)
}
function Get-FeedVersionNext([string]$channelDir) {
  $n = Get-FeedVersionName $channelDir
  $k = if ($n) { [int64]$n.Substring(0, 8) + 1 } else { 1 }
  return ('{0:D8}.json' -f $k)
}
'@
. ([scriptblock]::Create($script:FeedStoreGenerations))

# ------------------------------------------------------------ the one script
# Everything that happens up there is this one script, run by ssh on the VPS
# or in place on -SiteDir, so the tests run exactly what the VPS runs. It takes
# its inputs as the variables set in front of it and answers in lines:
#   HAVE|<name>|<sha>|<bytes>|<file>   NONE|<name>   (look; <file> is
#                                  where it is in the channel's folder)
#   L|<version>                                  (launchers)
#   R|<id><tab>...                               (releases)
#   MOVED|<what>   SHORT|<name>   SAME|<name>   SENT|<name>|<sha>   (swap)
#   DONE                                          (the end of every op)
$script:FeedStoreBody = @'
$ErrorActionPreference = 'Stop'
$dir = Join-Path $root $prefix
$hist = Join-Path $dir 'history'
$launchers = Join-Path $dir 'launchers.txt'
# Every read of a store file here shares delete, so an op landing beside
# another machine's swap never stops it (#2727, the rename above).
function OpenShared($p) {
  return New-Object IO.FileStream((Resolve-Path -LiteralPath $p).ProviderPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
}
function Sha($p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { return '' }
  $h = [Security.Cryptography.SHA256]::Create()
  $s = OpenShared $p
  try { return (-join ($h.ComputeHash($s) | ForEach-Object { $_.ToString('x2') })) }
  finally { $s.Dispose(); $h.Dispose() }
}
function ReadShared($p) {
  $r = New-Object IO.StreamReader((OpenShared $p), (New-Object Text.UTF8Encoding($false)), $true)
  try { return $r.ReadToEnd() } finally { $r.Dispose() }
}
function DropParts { foreach ($n in $names) { Remove-Item -LiteralPath (Join-Path $dir ($n + '.part')) -Force -ErrorAction SilentlyContinue } }
# Where a store file is now, relative to $dir: version.json is the newest of
# its generations (above), '' while it has none; the rest are by name. With a
# forward slash, so the same text is a path here and to scp.
function Here([string]$n) {
  if ($n -ne 'version.json') { return $n }
  $g = Get-FeedVersionName $dir
  if ($g) { return ('version/' + $g) } else { return '' }
}
# The same for a feed named from the root, 'feed\version.json'.
function FromRoot([string]$k) {
  if ((Split-Path -Leaf $k) -ne 'version.json') { return (Join-Path $root $k) }
  return (Get-FeedVersionFile (Join-Path $root (Split-Path -Parent $k)))
}
if ($op -eq 'look') {
  foreach ($n in $names) {
    $h = Here $n
    $p = if ($h) { Join-Path $dir $h } else { '' }
    if ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { 'HAVE|' + $n + '|' + (Sha $p) + '|' + (Get-Item -LiteralPath $p).Length + '|' + $h }
    else { 'NONE|' + $n }
  }
  'DONE'
  return
}
if ($op -eq 'launchers') {
  if (Test-Path -LiteralPath $launchers) {
    foreach ($l in @(Get-Content -LiteralPath $launchers)) { if ($l.Trim()) { 'L|' + $l.Trim() } }
  }
  'DONE'
  return
}
if ($op -eq 'releases') {
  $rel = Join-Path $dir 'releases.txt'
  if (Test-Path -LiteralPath $rel) {
    foreach ($l in @(Get-Content -LiteralPath $rel)) { if ($l.Trim()) { 'R|' + $l } }
  }
  'DONE'
  return
}
if ($op -eq 'forget') {
  # Deletes assets\<sha256> for each name, and only while both channels' feeds
  # are the bytes the caller read and found them missing from ($expect, keyed
  # 'feed\version.json' and 'feed-dev\version.json'). A name either feed or
  # either baseline still spells out is kept whatever the caller thought.
  $moved = @()
  foreach ($k in @($expect.Keys)) {
    $now = Sha (FromRoot $k)
    if ($now -ne [string]$expect[$k]) { $moved += ($k + ' was ' + ([string]$expect[$k]).Substring(0, 12) + ' and is ' + $(if ($now) { $now.Substring(0, 12) } else { 'absent' })) }
  }
  if ($moved.Count) { 'MOVED|' + ($moved -join '; '); return }
  # Names that still count as live assets. version.json is scanned as text
  # (pack and record sha256 fields), and so is releases.json, the list of
  # each release's record a rollback reads, which left version.json for the
  # store in #1050. published.json is often a baseline
  # record: only size:sha256 file entries name assets. A bare :gone: sha256
  # (#1261) is a launcher instruction, not a live asset, so it must not keep
  # the bytes on the site.
  $said = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($f in @('feed\version.json', 'feed-dev\version.json', 'feed\releases.json', 'feed-dev\releases.json')) {
    $p = FromRoot $f
    if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
    foreach ($m in [regex]::Matches((ReadShared $p), '[0-9a-fA-F]{64}')) { [void]$said.Add($m.Value.ToLowerInvariant()) }
  }
  foreach ($f in @('feed\published.json', 'feed-dev\published.json')) {
    $p = Join-Path $root $f
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
    foreach ($m in [regex]::Matches((ReadShared $p), '(?i)(\d+):([0-9a-f]{64})')) { [void]$said.Add($m.Groups[2].Value.ToLowerInvariant()) }
  }
  $assets = Join-Path $dir 'assets'
  foreach ($n in $names) {
    if ($n -notmatch '^[0-9a-f]{64}$') { 'BAD|' + $n; continue }
    if ($said.Contains($n)) { 'NAMED|' + $n; continue }
    $p = Join-Path $assets $n
    if (Test-Path -LiteralPath $p -PathType Leaf) { Remove-Item -LiteralPath $p -Force; 'GONE|' + $n }
    else { 'NONE|' + $n }
  }
  'DONE'
  return
}
if ($op -eq 'ready') {
  foreach ($d in @($dir, $hist)) { if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }
  'DONE'
  return
}
if ($op -eq 'swap') {
  $moved = @()
  foreach ($n in $names) {
    $h = Here $n
    $now = if ($h) { Sha (Join-Path $dir $h) } else { '' }
    if ($now -ne [string]$expect[$n]) {
      $was = if ([string]$expect[$n]) { ([string]$expect[$n]).Substring(0, 12) } else { 'absent' }
      $is = if ($now) { $now.Substring(0, 12) } else { 'absent' }
      $moved += ($n + ' was ' + $was + ' and is ' + $is)
    }
  }
  if ($moved.Count) { DropParts; 'MOVED|' + ($moved -join '; '); return }
  foreach ($n in @($sizes.Keys)) {
    $part = Join-Path $dir ($n + '.part')
    $len = -1
    if (Test-Path -LiteralPath $part -PathType Leaf) { $len = (Get-Item -LiteralPath $part).Length }
    if ($len -ne [int64]$sizes[$n]) { DropParts; 'SHORT|' + $n + '|' + $len + ' bytes of ' + $sizes[$n]; return }
  }
  if (-not (Test-Path -LiteralPath $hist)) { New-Item -ItemType Directory -Path $hist -Force | Out-Null }
  foreach ($n in $names) {
    if (-not $sizes.ContainsKey($n)) { 'SAME|' + $n; continue }
    $part = (Join-Path $dir $n) + '.part'
    if ($n -eq 'version.json') {
      # A new generation, never in place of one (the feed's generations,
      # above): the site goes on reading the one before until this name is
      # there, whole. File.Move refuses a name that is already there, so two
      # sends that both got past the check above cannot land on one number.
      $vdir = Join-Path $dir 'version'
      if (-not (Test-Path -LiteralPath $vdir)) { New-Item -ItemType Directory -Path $vdir -Force | Out-Null }
      $p = Join-Path $vdir (Get-FeedVersionNext $dir)
      [IO.File]::Move((Resolve-Path -LiteralPath $part).ProviderPath, $p)
    } else {
      $p = Join-Path $dir $n
      if (Test-Path -LiteralPath $p -PathType Leaf) {
        $keep = Join-Path $hist ($stamp + '-' + $n)
        $k = 2
        while (Test-Path -LiteralPath $keep) { $keep = Join-Path $hist ($stamp + '-' + $k + '-' + $n); $k++ }
        Copy-Item -LiteralPath $p -Destination $keep -Force
      }
      # One rename over the old file, so a send stopped here leaves the old
      # file or the new one whole (FeedStoreSwap, above). Nothing reads these
      # while a Ship sends them but the store's own ops.
      Move-FeedStoreInto $part $p
    }
    if ($n -eq 'version.json') {
      $m = [regex]::Match((ReadShared $p), '"launcherVersion"\s*:\s*"([^"]+)"')
      if ($m.Success) {
        $v = $m.Groups[1].Value
        $had = @()
        if (Test-Path -LiteralPath $launchers) { $had = @(Get-Content -LiteralPath $launchers | ForEach-Object { $_.Trim() }) }
        if ($had -notcontains $v) { Add-Content -LiteralPath $launchers -Value $v -Encoding ASCII }
      }
      # releases.txt (#444): one line a release, tab separated, its id first,
      # then channel, launcher, packs, baseline, commit, tag, so its one name
      # finds the rest. Never a reason to fail a send that has already landed,
      # so a line that could not be added is said (NOTE|, which Send-FeedStore
      # prints) and the send goes on.
      try {
        $rd = ((ReadShared $p) -replace '^\uFEFF', '') | ConvertFrom-Json
        if ($rd.PSObject.Properties['release'] -and $rd.release -and [string]$rd.release.id) {
          $r = $rd.release
          $f = @('id', 'channel', 'launcherVersion', 'packs', 'baseline', 'commit', 'tag') | ForEach-Object {
            if ($r.PSObject.Properties[$_]) { (@($r.$_) | ForEach-Object { [string]$_ }) -join ',' } else { '' }
          }
          $rel = Join-Path $dir 'releases.txt'
          $hadR = @(); if (Test-Path -LiteralPath $rel) { $hadR = @(Get-Content -LiteralPath $rel | ForEach-Object { ($_ -split "`t")[0] }) }
          if ($hadR -notcontains $f[0]) { Add-Content -LiteralPath $rel -Value ($f -join "`t") -Encoding ASCII }
        }
      } catch { 'NOTE|' + $prefix + '\releases.txt was not given this release''s line: ' + ($_.Exception.Message -replace '[\r\n|]+', ' ') }
    }
    'SENT|' + $n + '|' + (Sha $p)
  }
  'DONE'
  return
}
throw ('unknown op ' + $op)
'@

function New-FeedStoreScript([string]$root, [string]$prefix, [string]$op, [string[]]$names, [hashtable]$expect, [hashtable]$sizes) {
    function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
    $lines = @()
    $lines += ('$root = ' + (Q $root))
    $lines += ('$prefix = ' + (Q $prefix))
    $lines += ('$op = ' + (Q $op))
    $lines += ('$stamp = ' + (Q ((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))))
    $lines += ('$names = @(' + ((@($names) | ForEach-Object { Q $_ }) -join ', ') + ')')
    $e = @(); if ($expect) { foreach ($k in $expect.Keys) { $e += ((Q $k) + ' = ' + (Q ([string]$expect[$k]))) } }
    $lines += ('$expect = @{ ' + ($e -join '; ') + ' }')
    $s = @(); if ($sizes) { foreach ($k in $sizes.Keys) { $s += ((Q $k) + ' = ' + [int64]$sizes[$k]) } }
    $lines += ('$sizes = @{ ' + ($s -join '; ') + ' }')
    return (($lines -join "`r`n") + "`r`n" + $script:FeedStoreSwap + "`r`n" + $script:FeedStoreGenerations + "`r`n" + $script:FeedStoreBody)
}

# Runs the one script, up there or on -SiteDir, and hands back its lines.
# Up there it goes through Send-Script.ps1 (Invoke-ThornswoodRemote, issue
# #1167, the same way as #1070): under the limit on the command line, over
# it by scp, and its run deletes the copy before it runs (#3059), and
# the far side's exit code comes back. -SiteDir needs nothing of the VPS.
function Invoke-FeedStoreOp([string]$Channel, [string]$op, [string[]]$names, [hashtable]$expect, [hashtable]$sizes, [string]$SiteDir, [hashtable]$To) {
    $prefix = Get-FeedStorePrefix $Channel
    $sd = Get-FeedStoreSiteDir $SiteDir
    if ($sd) {
        $text = New-FeedStoreScript $sd $prefix $op $names $expect $sizes
        return @(& ([scriptblock]::Create($text)) | ForEach-Object { [string]$_ })
    }
    $v = Get-FeedStoreVps $To
    . (Join-Path $PSScriptRoot '..\vps\Vps.ps1')
    . (Join-Path $PSScriptRoot '..\vps\Send-Script.ps1')
    $text = New-FeedStoreScript ($v.Root.Replace('/', '\')) $prefix $op $names $expect $sizes
    $ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
    return @(Invoke-ThornswoodRemote -Target ($v.User + '@' + $v.Vps) -SshArgs $ssh -Script $text | Where-Object { $_ -is [string] })
}

function Copy-FeedStoreFile([string]$Channel, [string]$from, [string]$dest, [switch]$Up, [string]$SiteDir, [hashtable]$To) {
    $prefix = Get-FeedStorePrefix $Channel
    $sd = Get-FeedStoreSiteDir $SiteDir
    if ($sd) {
        $there = Join-Path (Join-Path $sd $prefix) $(if ($Up) { $dest } else { $from })
        if ($Up) { Copy-Item -LiteralPath $from -Destination $there -Force }
        else { Copy-Item -LiteralPath $there -Destination $dest -Force }
        return
    }
    $v = Get-FeedStoreVps $To
    . (Join-Path $PSScriptRoot '..\vps\Vps.ps1')
    $ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
    $remote = $v.User + '@' + $v.Vps + ':' + $v.Root.TrimEnd('/') + '/' + $prefix + '/'
    if ($Up) { Invoke-ThornswoodNative { & scp @ssh $from ($remote + $dest) } 2>&1 | Out-Null }
    else { Invoke-ThornswoodNative { & scp @ssh ($remote + $from) $dest } 2>&1 | Out-Null }
    $rc = $LASTEXITCODE
    if ($rc -ne 0) { throw ("scp could not " + $(if ($Up) { "send $from" } else { "fetch $from" }) + " (exit $rc). Check the ssh key with scripts\vps\Setup-SshKey.ps1 -Test.") }
}

# What is up there now: a hashtable of name to sha256, '' for a file that is
# not there. Throws when the VPS did not answer, so a caller can never mistake
# no answer for no file.
# releases.json (#1050) is one of the store's own files, so every script that
# edits the feed receives it and every send checks it did not move meanwhile,
# the same as published.json.
function Get-FeedStoreThere([string]$Channel, [string[]]$Files = @('version.json', 'published.json', 'releases.json'), [string]$SiteDir, [hashtable]$To) {
    return (Get-FeedStoreLook $Channel $Files $SiteDir $To).Sha
}

# The same, with where each file is in the channel's folder (At), which for
# version.json is its newest generation (#2727): Receive fetches that file,
# which is never replaced, rather than a name that is.
function Get-FeedStoreLook([string]$Channel, [string[]]$Files = @('version.json', 'published.json', 'releases.json'), [string]$SiteDir, [hashtable]$To) {
    $lines = @(Invoke-FeedStoreOp $Channel 'look' $Files @{} @{} $SiteDir $To)
    if ($lines -notcontains 'DONE') {
        throw ("The VPS did not say what the " + (Get-FeedStorePrefix $Channel) + " store holds: " + (($lines | Select-Object -Last 3) -join ' ').Trim() +
               ". Check the ssh key with scripts\vps\Setup-SshKey.ps1 -Test.")
    }
    $o = @{ Sha = @{}; At = @{} }
    foreach ($l in $lines) {
        $p = $l.Split('|')
        if ($p[0] -eq 'HAVE' -and $p.Count -ge 5) { $o.Sha[$p[1]] = $p[2]; $o.At[$p[1]] = $p[4] }
        elseif ($p[0] -eq 'NONE' -and $p.Count -ge 2) { $o.Sha[$p[1]] = '' }
    }
    return $o
}

function Read-FeedStoreRead([string]$Dir) {
    $f = Join-Path $Dir 'read.json'
    $o = @{}
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    try {
        $j = ([IO.File]::ReadAllText($f) -replace '^\uFEFF', '') | ConvertFrom-Json
        if ($j.PSObject.Properties['there'] -and $null -ne $j.there) {
            foreach ($p in $j.there.PSObject.Properties) { $o[$p.Name] = [string]$p.Value }
        }
    } catch { return $null }
    return $o
}

function Write-FeedStoreRead([string]$Dir, [string]$Channel, [hashtable]$there) {
    $t = [ordered]@{}
    foreach ($k in @($there.Keys | Sort-Object)) { $t[$k] = [string]$there[$k] }
    $o = [ordered]@{ channel = $Channel; at = (Get-Date).ToUniversalTime().ToString('s') + 'Z'; there = $t }
    # Beside it, then the one rename (#2591): written in place, a stop left
    # read.json cut, and the next send refused with "never received".
    $f = Join-Path $Dir 'read.json'
    [IO.File]::WriteAllText(($f + '.new'), ($o | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
    Move-FeedStoreInto ($f + '.new') $f
}

# Fetches the files into the working folder and writes down what they were.
# A file that is not up there is taken out of the folder too (a copy stays in
# backup\), so a baseline is never read from a stale local copy. Each file is
# checked against the sha256 the VPS gave for it, so a feed replaced halfway
# through the fetch is caught rather than half read. Returns the hashtable of
# what was read.
function Receive-FeedStore([string]$Channel, [string]$Dir, [string[]]$Files = @('version.json', 'published.json', 'releases.json'), [string]$SiteDir, [hashtable]$To) {
    if (-not $Dir) { $Dir = Get-FeedStoreDir $Channel }
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    $look = Get-FeedStoreLook $Channel $Files $SiteDir $To
    $there = $look.Sha
    $read = Read-FeedStoreRead $Dir
    if ($null -eq $read) { $read = @{} }
    $backup = Join-Path $Dir 'backup'
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
    foreach ($n in $Files) {
        $local = Join-Path $Dir $n
        if (-not $there[$n]) {
            if (Test-Path -LiteralPath $local) {
                New-Item -ItemType Directory -Force -Path $backup | Out-Null
                Copy-Item -LiteralPath $local -Destination (Join-Path $backup ($stamp + '-gone-' + $n)) -Force
                Remove-Item -LiteralPath $local -Force
            }
            $read[$n] = ''
            continue
        }
        $down = $local + '.down'
        Copy-FeedStoreFile $Channel ([string]$look.At[$n]) $down -SiteDir $SiteDir -To $To
        $got = Get-FeedStoreSha $down
        if ($got -ne $there[$n]) {
            Remove-Item -LiteralPath $down -Force -ErrorAction SilentlyContinue
            throw ("$n changed on the VPS while it was being read. Nothing was changed here; run it again.")
        }
        Move-FeedStoreInto $down $local
        New-Item -ItemType Directory -Force -Path $backup | Out-Null
        Copy-Item -LiteralPath $local -Destination (Join-Path $backup ($stamp + '-' + $n)) -Force
        $read[$n] = $got
        # The last twenty of each, newest by name, which is the stamp.
        $old = @(Get-ChildItem -LiteralPath $backup -File -Filter ('*-' + $n) | Sort-Object Name -Descending | Select-Object -Skip 20)
        foreach ($f in $old) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
    }
    Write-FeedStoreRead $Dir $Channel $read
    return $read
}

# The RecordShape kind a store file is held to, or '' for a file with no
# contract (announced.json, Publish-Discord's record).
function Get-FeedStoreKind([string]$Name) {
    foreach ($k in @($script:ThornswoodRecordKinds.Keys)) {
        $v = $script:ThornswoodRecordKinds[$k]
        if ($v.ContainsKey('Feed') -and $v['Feed'] -eq $Name) { return $k }
    }
    return ''
}

# Sends the named files back, each only when it differs from what was read.
# Every file this folder has read is checked, not only the ones sent: a feed
# edit must not land on top of a baseline another Ship has just moved, and a
# baseline must not land beside a feed somebody else just wrote. -Expect
# replaces read.json as the answer to "what should be up there now"; Remirror
# passes what it saw itself when handed a folder that was never received.
# Returns @{ Sent = names; Same = names }. Throws, with nothing replaced, when
# a feed file it names is out of shape, anything moved up there or a file did
# not arrive whole.
function Send-FeedStore([string]$Channel, [string]$Dir, [string[]]$Files, [string]$SiteDir, [hashtable]$To, [hashtable]$Expect) {
    if (-not $Dir) { $Dir = Get-FeedStoreDir $Channel }
    $read = if ($null -ne $Expect) { $Expect } else { Read-FeedStoreRead $Dir }
    if ($null -eq $read) {
        throw ("$Dir was never received from the VPS, so there is nothing to say what this edit was made on top of. " +
               'Nothing was sent. Run the script again; it receives the feed first.')
    }
    foreach ($n in $Files) {
        if (-not (Test-Path -LiteralPath (Join-Path $Dir $n) -PathType Leaf)) { throw "No $n in $Dir to send. Nothing was sent." }
        if (-not $read.ContainsKey($n)) { throw "$n in $Dir was never received from the VPS, so there is nothing to check it against. Nothing was sent." }
    }
    # Every feed file goes up only in the shape its readers need (#2180).
    # This is the one way a feed file reaches the VPS, so Publish-Update,
    # Rollback-Feed, Scrub-Feed and every other writer are held here, not each
    # on its own. A version.json the launcher cannot read (Config.cs
    # VersionDoc throws on one member of the wrong type) shuts Play for every
    # launcher on the channel; a published.json or releases.json out of shape
    # stops the next Ship or rollback. RecordShape.ps1 names every field.
    foreach ($n in $Files) {
        $kind = Get-FeedStoreKind $n
        if (-not $kind) { continue }
        try { $null = Read-ThornswoodRecord -Path (Join-Path $Dir $n) -Kind $kind }
        catch { throw ($_.Exception.Message + '. Nothing was sent, and the feed on the VPS is as it was.') }
    }
    $check = @($read.Keys | Sort-Object)
    $sizes = @{}
    foreach ($n in $Files) {
        $local = Join-Path $Dir $n
        if ((Get-FeedStoreSha $local) -eq [string]$read[$n]) { continue }
        Copy-FeedStoreFile $Channel $local ($n + '.part') -Up -SiteDir $SiteDir -To $To
        $sizes[$n] = (Get-Item -LiteralPath $local).Length
    }
    $lines = @(Invoke-FeedStoreOp $Channel 'swap' $check $read $sizes $SiteDir $To)
    $moved = @($lines | Where-Object { $_ -like 'MOVED|*' })
    if ($moved.Count) {
        throw ("The " + (Get-FeedStorePrefix $Channel) + " store changed on the VPS after this machine read it (" + $moved[0].Substring(6) +
               "): another Ship or feed edit went out meanwhile. Nothing was replaced. Run it again, so it starts from what is up there now.")
    }
    $short = @($lines | Where-Object { $_ -like 'SHORT|*' })
    if ($short.Count) { throw ("A file did not arrive whole (" + $short[0].Substring(6) + "). Nothing was replaced. Run it again.") }
    if ($lines -notcontains 'DONE') { throw ("The VPS did not confirm the send: " + (($lines | Select-Object -Last 3) -join ' ').Trim() + ". Nothing is known to have been replaced; run it again.") }
    # What the swap could not do after the feed landed (releases.txt), said
    # here; the send itself stands.
    foreach ($n in @($lines | Where-Object { $_ -like 'NOTE|*' })) {
        Write-Host ('  NOTE: the feed went out, but ' + $n.Substring(5) + '. That file is the store''s list of releases by id (Release-Name.ps1), and Get-FeedStoreReleases will not name this one.') -ForegroundColor Yellow
    }
    $sent = @(); $same = @()
    foreach ($l in $lines) {
        $p = $l.Split('|')
        if ($p[0] -eq 'SENT') {
            if ($p[2] -ne (Get-FeedStoreSha (Join-Path $Dir $p[1]))) { throw ("$($p[1]) on the VPS does not hash to what was sent. Send it again.") }
            $read[$p[1]] = $p[2]; $sent += $p[1]
        } elseif ($p[0] -eq 'SAME') { $same += $p[1] }
    }
    Write-FeedStoreRead $Dir $Channel $read
    return @{ Sent = $sent; Same = @($same | Where-Object { $Files -contains $_ }) }
}

# Every launcher version this channel has ever published, oldest first. Ship
# climbs the dev number past all of them (Ship.ps1, the version block).
function Get-FeedStoreLaunchers([string]$Channel, [string]$SiteDir, [hashtable]$To) {
    $lines = @(Invoke-FeedStoreOp $Channel 'launchers' @() @{} @{} $SiteDir $To)
    if ($lines -notcontains 'DONE') { throw ("The VPS did not list the launchers " + (Get-FeedStorePrefix $Channel) + " has published.") }
    return @($lines | Where-Object { $_ -like 'L|*' } | ForEach-Object { $_.Substring(2) })
}

# Every release this channel's feed has named, oldest first, from releases.txt
# (#444): Id, Channel, LauncherVersion, Packs, Baseline, Commit, Tag.
function Get-FeedStoreReleases([string]$Channel, [string]$SiteDir, [hashtable]$To) {
    $lines = @(Invoke-FeedStoreOp $Channel 'releases' @() @{} @{} $SiteDir $To)
    if ($lines -notcontains 'DONE') { throw ("The VPS did not list the releases " + (Get-FeedStorePrefix $Channel) + " has named.") }
    return @($lines | Where-Object { $_ -like 'R|*' } | ForEach-Object {
        $f = @($_.Substring(2).Split("`t")) + @('', '', '', '', '', '', '')
        [pscustomobject]@{ Id = $f[0]; Channel = $f[1]; LauncherVersion = $f[2]; Packs = @($f[3].Split(',') | Where-Object { $_ })
                           Baseline = $f[4]; Commit = $f[5]; Tag = $f[6] }
    })
}

# Deletes /feed[-dev]/assets/<sha256> for each of $Shas (#1152). Nothing else
# here ever deletes an asset: an asset stays while any feed may name it. This is
# for Scrub-Feed.ps1, once it has replaced what must never have been published
# and worked out that no feed, baseline or record names these any more. $Expect
# is the sha256 of both channels' version.json as the caller read them
# (@{ main = <sha>; dev = <sha> }); if either has moved since, nothing is deleted
# and this throws, and a name either feed or either baseline still spells out is
# kept, as is anything that is not 64 hex digits. Returns @{ Gone; None; Named; Bad }.
function Remove-FeedStoreAssets([string]$Channel, [string[]]$Shas, [hashtable]$Expect, [string]$SiteDir, [hashtable]$To) {
    if (-not $Expect -or -not $Expect.ContainsKey('main') -or -not $Expect.ContainsKey('dev')) {
        throw 'Remove-FeedStoreAssets needs the sha256 of both feeds as they were read. Nothing was deleted.'
    }
    $e = @{ 'feed\version.json' = [string]$Expect['main']; 'feed-dev\version.json' = [string]$Expect['dev'] }
    $lines = @(Invoke-FeedStoreOp $Channel 'forget' @($Shas) $e @{} $SiteDir $To)
    $moved = @($lines | Where-Object { $_ -like 'MOVED|*' })
    if ($moved.Count) {
        throw ("A feed changed on the VPS after it was read (" + $moved[0].Substring(6) + "). Nothing was deleted. Run it again.")
    }
    if ($lines -notcontains 'DONE') { throw ("The VPS did not confirm what it deleted: " + (($lines | Select-Object -Last 3) -join ' ').Trim()) }
    $o = @{ Gone = @(); None = @(); Named = @(); Bad = @() }
    foreach ($l in $lines) {
        $p = $l.Split('|')
        if ($p[0] -eq 'GONE') { $o.Gone += $p[1] }
        elseif ($p[0] -eq 'NONE') { $o.None += $p[1] }
        elseif ($p[0] -eq 'NAMED') { $o.Named += $p[1] }
        elseif ($p[0] -eq 'BAD') { $o.Bad += $p[1] }
    }
    return $o
}

# The feed as a launcher reads it: https://thornswood.net/feed[-dev]/version.json,
# public, no ssh, with the settings it names joined back in (Join-FeedSettings,
# #1050), so it is the whole feed the store holds. With -SiteDir (or the test
# variable) the file in that folder. $null when there is none. Throws when the
# site does not answer.
function Read-SiteFeed([string]$Channel, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net') {
    $prefix = Get-FeedStorePrefix $Channel
    $sd = Get-FeedStoreSiteDir $SiteDir
    if ($sd) {
        $f = Get-FeedVersionFile (Join-Path $sd $prefix)
        if (-not $f) { return $null }
        return (ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($f)) $f)
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $wc = New-Object Net.WebClient
    $wc.Headers['User-Agent'] = 'Thornswood-Publish'
    $wc.Headers['Cache-Control'] = 'no-cache'
    $feedUrl = $SiteUrl.TrimEnd('/') + '/' + $prefix + '/version.json'
    try { $bytes = $wc.DownloadData($feedUrl) }
    finally { $wc.Dispose() }
    return (Join-FeedSettings (([Text.Encoding]::UTF8.GetString($bytes) -replace '^\uFEFF', '') | ConvertFrom-Json) $feedUrl)
}
