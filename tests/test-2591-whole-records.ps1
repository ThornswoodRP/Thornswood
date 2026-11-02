<#
  test-2591-whole-records.ps1

      pwsh -NoProfile -File .\tests\test-2591-whole-records.ps1

  Issue #2591. #2586 moved the launcher's own-folder records onto one rename,
  MoveFileEx with MOVEFILE_REPLACE_EXISTING (OwnGame.WriteRecord), and
  Build-Generated's record with it. Four more places replaced a file in two
  steps, and a writer stopped between the two left no file at all:
    - Steam's appmanifest_489830.acf (launcher\app\SteamUpdates.cs) and the
      feed files on the VPS (scripts\release\Feed-Store.ps1, the script the
      box runs) went through File.Replace, which moves the old file aside
      first and then moves the new one in;
    - release.txt and release-files.txt (launcher\app\Sync.cs) and the news
      cache (launcher\app\FeedNews.cs, gone since #5187) deleted the old
      file and then moved the new one in. The feed's settings cache
      (launcher\app\FeedSettings.cs) is written the same way they are now.

  Measured 16 Oct on One, a writer swapping a 17 KB file in a loop and killed
  with TerminateProcess 150 times: File.Replace left it missing 6 times (and
  16 ~RF....TMP files beside it), delete then move 30 times, MoveFileEx never.
  The feed store's own call, [IO.File]::Replace in Windows PowerShell 5.1 as
  the box runs it, killed 100 times: missing 3 times.

  WHAT IT HOLDS THEM TO.
    1. None of the four replaces a file in two steps any more, and each goes
       through the one rename: SteamUpdates through its own (it is compiled
       alone, in test-steam-updates.ps1), Sync and FeedSettings through
       OwnGame.WriteRecord, the feed store through Move-FeedStoreInto, whose
       type is its own (Thornswood.FeedSwap, a rename with POSIX semantics
       since #2727, tests\test-2727-feed-swap-readers.ps1), so it never
       shares a name with the generated record's Thornswood.GeneratedOs
       (launcher\app\GeneratedBuild.cs, compiled by scripts\mods\Generated.ps1).
    2. SteamUpdates.cs compiled with the .NET SDK the launcher builds with:
       its write replaces a manifest, and killed 40 times while it swaps a
       manifest in a loop, the manifest is whole every time.
    3. OwnGame.WriteRecord's byte form (the settings cache), lifted and compiled:
       the same bytes, and whole after 40 kills.
       The compile runs everywhere; the runs rename through kernel32's
       MoveFileEx, so they run on Windows only and say SKIP elsewhere.
    4. The feed store under PowerShell 7, which is what the VPS runs it with
       since #5356: the real swap op, built by New-FeedStoreScript, replaces
       a store file (published.json; version.json is never replaced, it goes
       up as a new generation, #2727) and keeps the old one in history; and a
       PowerShell 7 process swapping a feed file through Move-FeedStoreInto, killed 15 times,
       leaves it whole every time.

  Nothing outside its own scratch folder is written.
#>
[CmdletBinding()]
param([string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
$Repo = Split-Path -Parent $PSScriptRoot
$App = Join-Path $Repo 'launcher\app'
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}
function Text([string]$p) { return ([IO.File]::ReadAllText($p) -replace "`r`n", "`n") }

# ---- 1: the four places ---------------------------------------------------------
$steam = Text (Join-Path $App 'SteamUpdates.cs')
$sync = Text (Join-Path $App 'Sync.cs')
$settings = Text (Join-Path $App 'FeedSettings.cs')
$store = Text (Join-Path $Repo 'scripts\release\Feed-Store.ps1')
$gen = Text (Join-Path $App 'GeneratedBuild.cs')

Yes 'SteamUpdates: no File.Replace' ($steam -notmatch 'File\.Replace\(')
Yes '...the manifest is written beside it, flushed, and renamed over it in one call' (
    $steam -match 'WriteWhole\(tmp, Bytes\.GetBytes\(after\)\);' -and $steam -match 'SwapIn\(tmp, manifest\);' -and
    $steam -match 'MoveFileEx\(next, path, MoveReplaceExisting \| MoveWriteThrough\)' -and $steam -match 'const int MoveReplaceExisting = 0x1;' -and
    $steam -match 'fs\.Flush\(true\)')

function Body([string]$src, [string]$sig) {
    $m = [regex]::Match($src, '(?s)' + [regex]::Escape($sig) + '.*?\n        \}\n')
    if ($m.Success) { return $m.Value } else { return '' }
}
$ws = Body $sync 'static void WriteSyncState(SyncState s)'
$wr = Body $sync 'static void WriteReleaseFiles(RecordRef r, ICollection<string> rels)'
Yes 'Sync: release.txt goes through OwnGame.WriteRecord, no delete and move' ($ws -match 'OwnGame\.WriteRecord\(SyncStateFile, lines\);' -and $ws -notmatch 'File\.(Delete|Move)\(')
Yes 'Sync: release-files.txt the same' ($wr -match 'OwnGame\.WriteRecord\(ReleaseFilesFile, lines\);' -and $wr -notmatch 'File\.(Delete|Move)\(')
Yes 'FeedSettings: the settings cache goes through OwnGame.WriteRecord, no delete and move' ($settings -match 'OwnGame\.WriteRecord\(cache, raw\);' -and $settings -notmatch 'File\.(Delete|Move)\(')

$body = [regex]::Match($store, "(?s)\`$script:FeedStoreBody = @'\n(.*?)\n'@")
$swap = [regex]::Match($store, "(?s)\`$script:FeedStoreSwap = @'\n(.*?)\n'@")
Yes 'Feed-Store: the box''s script and the one rename are there' ($body.Success -and $swap.Success)
Yes '...the box''s script has no File.Replace and no Move-Item over a feed file' ($body.Groups[1].Value -notmatch '::Replace\(' -and $body.Groups[1].Value -notmatch '(?<![A-Za-z])Move-Item')
Yes '...it swaps each file in with Move-FeedStoreInto' ($body.Groups[1].Value -match 'Move-FeedStoreInto \$part \$p')
Yes '...and the rename goes up with every script the box runs' ($store -match '\$script:FeedStoreSwap \+ "`r`n" \+ \$script:FeedStoreGenerations \+ "`r`n" \+ \$script:FeedStoreBody')
Yes '...the received copy and read.json on this machine go through it too' (
    $store -match 'Move-FeedStoreInto \$down \$local' -and $store -match "Move-FeedStoreInto \(\`$f \+ '\.new'\) \`$f")
$csStore = [regex]::Match($swap.Groups[1].Value, '(?s)namespace Thornswood\n\{.*?\n\}')
Yes '...its type is its own, not the generated record''s, so neither loads the other''s rename first (#2727)' (
    $csStore.Success -and $csStore.Value -match 'public static class FeedSwap' -and $csStore.Value -notmatch 'class (RecordSwap|GeneratedOs)' -and
    $gen -match 'public static class GeneratedOs' -and $gen -notmatch 'class FeedSwap')

$work = Join-Path $Scratch ('thornswood-2591-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    # ---- 2 and 3: the launcher's two, compiled ---------------------------------
    $og = Text (Join-Path $App 'OwnGame.cs')
    $m = [regex]::Match($og, '(?s)\n(        (?:internal )?static void WriteRecord\(string path, IEnumerable<string> lines\)\n        \{\n.*?\n        \}\n.*?private static partial bool MoveFileEx\([^)]*\);\n)')
    Yes 'OwnGame.WriteRecord and its byte form are in OwnGame.cs' ($m.Success -and $m.Groups[1].Value -match 'internal static void WriteRecord\(string path, byte\[\] bytes\)')
    if (-not $m.Success) { Done }
    $driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Thornswood
{
    static partial class OwnGame
    {
__WRITERECORD__
    }

    static class WholeRecordTest
    {
        static byte[] Make(char c, int n) { var b = new byte[n]; for (int i = 0; i < n; i++) b[i] = (byte)(i % 64 == 63 ? '\n' : c); return b; }
        static int Main(string[] args)
        {
            string mode = args[0], path = args[1];
            int n = int.Parse(args[2]);
            byte[] a = Make('a', n), b = Make('b', n + 7);
            if (mode == "seed") { File.WriteAllBytes(path, a); return 0; }
            if (mode == "steamonce") { string t = path + ".tmp"; SteamUpdates.WriteWhole(t, b); SteamUpdates.SwapIn(t, path); return 0; }
            if (mode == "recordonce") { OwnGame.WriteRecord(path, b); return 0; }
            Console.WriteLine("ready");
            Console.Out.Flush();
            for (int k = 0; ; k++)
            {
                byte[] w = k % 2 == 0 ? b : a;
                if (mode == "steam") { string t = path + ".tmp"; SteamUpdates.WriteWhole(t, w); SteamUpdates.SwapIn(t, path); }
                else OwnGame.WriteRecord(path, w);
            }
        }
    }
}
'@
    $driver = $driver.Replace('__WRITERECORD__', $m.Groups[1].Value.TrimEnd())
    # Named, as the other harnesses that compile launcher code name it, so a
    # machine without it fails here rather than saying nothing (#2965).
    Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }
    $dll = $null
    try { $dll = Build-LauncherCode -Source $driver -File (Join-Path $App 'SteamUpdates.cs') -Exe }
    catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes "SteamUpdates.cs and WriteRecord compile with the .NET SDK the launcher builds with, C# $LauncherLangVersion" ($null -ne $dll)
    if (-not $dll) { Done }

    if (-not $OnWindows) {
        Write-Host 'SKIP  the launcher''s two, killed mid-swap: they rename through kernel32''s MoveFileEx, which only Windows has'
    } else {
        $N = 1156   # the size of Steam's manifest for Skyrim on One
        function Run([string[]]$a) { $null = Invoke-LauncherExe $dll @a; return $LASTEXITCODE }
        function Len([string]$p) { if (Test-Path -LiteralPath $p) { return (Get-Item -LiteralPath $p).Length } else { return -1 } }

        $man = Join-Path $work 'steamapps\appmanifest_489830.acf'
        $null = New-Item -ItemType Directory -Force -Path (Split-Path $man)
        $null = Run @('seed', $man, $N)
        $code = Run @('steamonce', $man, $N)
        Yes 'SteamUpdates replaces a manifest with the new bytes, and leaves nothing beside it' ($code -eq 0 -and (Len $man) -eq ($N + 7) -and
            @(Get-ChildItem -LiteralPath (Split-Path $man) -Force).Count -eq 1)
        $rec = Join-Path $work 'Profile\feed-settings.json'
        $code = Run @('recordonce', $rec, 37427)
        Yes 'WriteRecord''s byte form makes the folder and the record, and leaves no .new' ($code -eq 0 -and (Len $rec) -eq 37434 -and -not (Test-Path -LiteralPath ($rec + '.new')))

        function KillTest([string]$mode, [string]$path, [int]$size, [int]$kills) {
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $path)
            $null = Run @('seed', $path, $size)
            $whole = 0; $bad = @()
            $rand = New-Object Random 2591
            for ($i = 0; $i -lt $kills; $i++) {
                $psi = New-Object Diagnostics.ProcessStartInfo($LauncherDotnet, ('"{0}" "{1}" "{2}" {3}' -f $dll, $mode, $path, $size))
                $psi.UseShellExecute = $false
                $psi.RedirectStandardOutput = $true
                $p = [Diagnostics.Process]::Start($psi)
                $null = $p.StandardOutput.ReadLine()
                Start-Sleep -Milliseconds ($rand.Next(15, 160))
                $p.Kill(); $p.WaitForExit(); $p.Dispose()
                $l = Len $path
                if ($l -eq $size -or $l -eq ($size + 7)) { $whole++ } else { $bad += $(if ($l -lt 0) { 'missing' } else { "$l bytes" }); $null = Run @('seed', $path, $size) }
            }
            return [pscustomobject]@{ Whole = $whole; Bad = $bad }
        }
        $r = KillTest 'steam' (Join-Path $work 'killed-steam\appmanifest_489830.acf') $N 40
        Yes ('killed 40 times while SteamUpdates swaps the manifest in: whole every time ({0} of 40{1})' -f $r.Whole, $(if ($r.Bad) { '; ' + ($r.Bad -join ', ') })) ($r.Whole -eq 40)
        $r = KillTest 'record' (Join-Path $work 'killed-settings\feed-settings.json') 37427 40
        Yes ('killed 40 times while WriteRecord swaps the settings cache in: whole every time ({0} of 40{1})' -f $r.Whole, $(if ($r.Bad) { '; ' + ($r.Bad -join ', ') })) ($r.Whole -eq 40)
    }

    # ---- 4: the feed store, in PowerShell 7 as the VPS runs it (#5356) ------------
    if (-not $OnWindows) { Write-Host 'SKIP  the feed store killed mid-swap: on the VPS it renames through kernel32, which only Windows has'; Done }
    $boxPs = Get-BoxPowerShell
    $storePs1 = Join-Path $Repo 'scripts\release\Feed-Store.ps1'

    # The real swap op on a store of its own.
    $root = Join-Path $work 'site'
    $feed = Join-Path $root 'feed'
    $null = New-Item -ItemType Directory -Force -Path $feed
    [IO.File]::WriteAllText((Join-Path $feed 'published.json'), '{"version":"old"}')
    [IO.File]::WriteAllText((Join-Path $feed 'published.json.part'), '{"version":"new one"}')
    $one = Join-Path $work 'swap-once.ps1'
    [IO.File]::WriteAllText($one, @'
param($store, $root)
$ErrorActionPreference = 'Stop'
. $store
$feed = Join-Path $root 'feed'
$was = Get-FeedStoreSha (Join-Path $feed 'published.json')
$size = (Get-Item -LiteralPath (Join-Path $feed 'published.json.part')).Length
$text = New-FeedStoreScript $root 'feed' 'swap' @('published.json') @{ 'published.json' = $was } @{ 'published.json' = $size }
& ([scriptblock]::Create($text))
'@)
    $out = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $one $storePs1 $root 2>&1 | ForEach-Object { [string]$_ })
    $hist = @(Get-ChildItem -LiteralPath (Join-Path $feed 'history') -File -ErrorAction SilentlyContinue)
    Yes ('the box''s swap op, run by PowerShell 7, sends the new baseline (' + (($out | Select-Object -Last 2) -join ' ') + ')') (
        ($out -match '^SENT\|published\.json\|').Count -eq 1 -and ($out -contains 'DONE') -and
        [IO.File]::ReadAllText((Join-Path $feed 'published.json')) -eq '{"version":"new one"}' -and -not (Test-Path -LiteralPath (Join-Path $feed 'published.json.part')))
    Yes '...keeps the old one in history, and leaves no ~RF file beside it' ($hist.Count -eq 1 -and [IO.File]::ReadAllText($hist[0].FullName) -eq '{"version":"old"}' -and
        @(Get-ChildItem -LiteralPath $feed -Force -Filter '*~RF*').Count -eq 0)

    # Killed while it swaps.
    $loop = Join-Path $work 'swap-loop.ps1'
    [IO.File]::WriteAllText($loop, @'
param($store, $p, [int]$n)
$ErrorActionPreference = 'Stop'
. $store
$a = New-Object byte[] $n; $b = New-Object byte[] ($n + 7)
$part = $p + '.part'
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
for ($k = 0; ; $k++) {
    [IO.File]::WriteAllBytes($part, $(if ($k % 2) { $a } else { $b }))
    Move-FeedStoreInto $part $p
}
'@)
    $vp = Join-Path $work 'killed-feed\version.json'
    $null = New-Item -ItemType Directory -Force -Path (Split-Path $vp)
    $size = 40000
    [IO.File]::WriteAllBytes($vp, (New-Object byte[] $size))
    $whole = 0; $bad = @()
    $rand = New-Object Random 2591
    for ($i = 0; $i -lt 15; $i++) {
        $psi = New-Object Diagnostics.ProcessStartInfo($boxPs, ('-NoProfile -ExecutionPolicy Bypass -File "{0}" "{1}" "{2}" {3}' -f $loop, $storePs1, $vp, $size))
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $p = [Diagnostics.Process]::Start($psi)
        $null = $p.StandardOutput.ReadLine()
        Start-Sleep -Milliseconds ($rand.Next(15, 160))
        $p.Kill(); $p.WaitForExit(); $p.Dispose()
        $l = Len $vp
        if ($l -eq $size -or $l -eq ($size + 7)) { $whole++ } else { $bad += $(if ($l -lt 0) { 'missing' } else { "$l bytes" }); [IO.File]::WriteAllBytes($vp, (New-Object byte[] $size)) }
    }
    Yes ('killed 15 times while PowerShell 7 swaps a feed file in through Move-FeedStoreInto: whole every time ({0} of 15{1})' -f $whole, $(if ($bad) { '; ' + ($bad -join ', ') })) ($whole -eq 15)
}
finally {
    try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop } catch { Write-Host "NOTE  $work could not be removed: $($_.Exception.Message)" }
}

Done
