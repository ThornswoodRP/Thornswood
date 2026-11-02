<#
  test-2599-whole-swaps.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2599-whole-swaps.ps1

  Issue #2599. Four places in the launcher replaced a file in Thornswood's
  game folder in two steps, the old name off (File.Delete or DropName) and
  then the new file moved in (File.Move), so a launcher stopped between the
  two left the file missing: Enforce.MakeItOurs, OwnGame.Separate, and the
  share step and TakeBack in OwnGameShare. #2591 measured the pattern: 30 of
  150 kills left the file missing; one MoveFileEx rename over it, none.

  WHAT IT HOLDS THEM TO.
    1. The four places: MakeItOurs and Separate call OwnGame.SwapCopyIn; the
       share step and TakeBack take a stale .thornswood-share off with
       DeleteName and put the new name in with SwapNameIn. None deletes and
       then moves. (Matched on tokens, not on exact spacing.)
    2. The real ReplaceName, SwapNameIn, SwapCopyIn and DeleteName, lifted
       out of OwnGame.cs with the MoveFileEx and handles they use, compiled
       with the .NET SDK the launcher builds with (everywhere) and run on
       real files (on Windows only: they rename through kernel32):
         - replace, create, nothing left beside;
         - read only, without clearReadOnly: refused, left as it was;
           with it: replaced;
         - a read only hard link held open by another process so the rename
           is refused even with the mark cleared: the mark is back on, on
           the other name, and SwapNameIn takes next away;
         - a lock let go after 150 ms is waited out; one never let go is
           refused within about a second and path is whole;
         - DeleteName takes a read only link's name off and the other name
           keeps its bytes and its mark;
         - SwapCopyIn over a stale read only copy from a stopped run: done,
           path has one name and the stale copy is gone; refused on a read
           only shared file: path as it was, and no copy left beside it.
    3. Killed while it swaps: a child swaps a file over and over through
       ReplaceName and is killed 50 times; the file is whole every time. The
       old delete then move is stopped exactly between the two steps (the
       child says so before it waits) and the file is missing, so the test
       sees the fault it guards against every run, not by chance.

  Nothing outside its own scratch folder is read or written, besides the
  repository's own sources.
#>
[CmdletBinding()]
param([string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
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
function Src([string]$name) { return ([IO.File]::ReadAllText((Join-Path $App $name)) -replace "`r`n", "`n") }
function Body([string]$src, [string]$head) {
    $m = [regex]::Match($src, '(?s)' + $head + '.*?\n        \}\n')
    if ($m.Success) { return $m.Value } else { return '' }
}

# ---- 1: the four places -----------------------------------------------------------
$enforce = Src 'Enforce.cs'
$og = Src 'OwnGame.cs'
$share = Src 'OwnGameShare.cs'
$make = Body $enforce 'static void MakeItOurs\(string file\)'
$sep = Body $og 'public static void Separate\(string path\)'
$take = Body $share 'static bool TakeBack\('
Yes 'Enforce.MakeItOurs, OwnGame.Separate and OwnGameShare.TakeBack are found' ($make -and $sep -and $take)
Yes 'MakeItOurs puts its own copy in with OwnGame.SwapCopyIn, and deletes and moves nothing itself' ($make -match 'OwnGame\s*\.\s*SwapCopyIn\s*\(\s*file\s*,\s*file\s*\+\s*"\.mine"\s*\)' -and $make -notmatch 'File\.(Delete|Move|Copy)\(')
Yes 'Separate does the same' ($sep -match '\bSwapCopyIn\s*\(\s*path\s*,\s*path\s*\+\s*"\.own"\s*\)' -and $sep -notmatch 'File\.(Delete|Move|Copy)\(')
Yes 'TakeBack takes a stale next off with DeleteName and swaps with SwapNameIn' ($take -match '\bDeleteName\s*\(\s*next\s*\)' -and $take -match '\bSwapNameIn\s*\(\s*next\s*,\s*own\s*,\s*true\s*\)' -and $take -notmatch 'File\.(Delete|Move)\(' -and $take -notmatch 'DropName\(')
Yes 'the share step does the same, around the hard link' ($share -match '(?s)\bDeleteName\s*\(\s*next\s*\)\s*;\s*if\s*\(\s*!\s*CreateHardLink\s*\(\s*next\s*,\s*theirs\s*,\s*IntPtr\.Zero\s*\)\s*\)\s*continue\s*;\s*SwapNameIn\s*\(\s*next\s*,\s*own\s*,\s*true\s*\)')
Yes 'no File.Move is left in OwnGameShare.cs' ($share -notmatch 'File\.Move\(')

# ---- 2 and 3: the real code, compiled -----------------------------------------------
$region = [regex]::Match($og, '(?s)\n(        (?:internal )?static void WriteRecord\(string path, IEnumerable<string> lines\)\n.*?private static partial bool MoveFileEx\([^)]*\);\n)')
$block = [regex]::Match($og, '(?s)\n(        // ---- #2599: one name of the game folder replaced whole.*?        // ---- end #2599[^\n]*\n)')
Yes 'ReplaceName and the record writers, with the MoveFileEx they call, are in OwnGame.cs' ($region.Success -and $region.Groups[1].Value -match 'internal static void ReplaceName\(string next, string path, bool clearReadOnly\)')
Yes 'DeleteName, SwapCopyIn and SwapNameIn are in OwnGame.cs' ($block.Success -and $block.Groups[1].Value -match 'internal static void DeleteName\(' -and $block.Groups[1].Value -match 'internal static void SwapCopyIn\(' -and $block.Groups[1].Value -match 'internal static void SwapNameIn\(')
Yes 'the records keep their own SwapIn, a different name from ReplaceName' ($og -match 'static void SwapIn\(string next, string path\)' -and $og -notmatch 'static void SwapIn\(string next, string path, bool')
Yes 'ReplaceName renames with write through and never opens next for writing: a link to the Steam copy is not flushed' ($region.Success -and $region.Groups[1].Value -match 'internal static void ReplaceName\(string next, string path, bool clearReadOnly\)\s*\{\s*int err = MoveOver\(next, path\);' -and $region.Groups[1].Value -match 'fs\.Flush\(true\)' -and $region.Groups[1].Value -match 'MoveReplaceExisting \| MoveWriteThrough')
Yes 'SwapCopyIn flushes the fresh copy it made before it takes the file''s place' ($block.Success -and $block.Groups[1].Value -match '(?s)internal static void SwapCopyIn\(string path, string aside\).*?File\.Copy\(path, aside, false\);.*?FlushToDisk\(aside\);\s*SwapNameIn\(aside, path, false\);')
if (-not ($region.Success -and $block.Success)) { Done }

$work = Join-Path $Scratch ('thornswood-2599-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Thornswood
{
    static class Swallow { public static void Note(string where, Exception ex) { Console.WriteLine("NOTE " + where + ": " + ex.Message); } }

    static partial class OwnGame
    {
__REGION__
__BLOCK__
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateHardLink(string name, string existing, IntPtr security);

        static int Try(Action a) { try { a(); return 0; } catch (IOException e) { Console.WriteLine(e.Message); return 3; } catch (UnauthorizedAccessException e) { Console.WriteLine(e.Message); return 3; } }

        // Holds path open without letting anyone delete or rename over it,
        // the way a scan does, for ms milliseconds (-1: until the process ends).
        static void Lock(string path, int ms, ManualResetEvent held)
        {
            var t = new Thread(delegate () {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    held.Set();
                    Thread.Sleep(ms < 0 ? Timeout.Infinite : ms);
                }
            });
            t.IsBackground = true;
            t.Start();
            held.WaitOne();
        }

        static int Main(string[] args)
        {
            string mode = args[0], path = args[1];
            if (mode == "swap") return Try(delegate { ReplaceName(args[2], path, args[3] == "clear"); });
            if (mode == "namein") return Try(delegate { SwapNameIn(args[2], path, args[3] == "clear"); });
            if (mode == "copyin") return Try(delegate { SwapCopyIn(path, args[2]); });
            if (mode == "delname") return Try(delegate { DeleteName(path); });
            if (mode == "link") return CreateHardLink(args[2], path, IntPtr.Zero) ? 0 : 4;
            if (mode == "steamheld")
            {
                // The Steam copy's file held open the way a reader that lets
                // others rename but not write holds it; next is a link to it.
                using (var held = new FileStream(args[3], FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
                    return Try(delegate { ReplaceName(args[2], path, false); });
            }
            if (mode == "lockedswap" || mode == "lockednamein")
            {
                Lock(path, int.Parse(args[3]), new ManualResetEvent(false));
                var sw = System.Diagnostics.Stopwatch.StartNew();
                int r = mode == "lockedswap" ? Try(delegate { ReplaceName(args[2], path, false); }) : Try(delegate { SwapNameIn(args[2], path, true); });
                Console.WriteLine("MS " + sw.ElapsedMilliseconds);
                return r;
            }
            string next = path + ".next";
            if (mode == "oldway")
            {
                // The old two steps, stopped exactly between them.
                File.WriteAllBytes(next, File.ReadAllBytes(path));
                File.Delete(path);
                Console.WriteLine("between");
                Console.Out.Flush();
                Thread.Sleep(Timeout.Infinite);
            }
            Console.WriteLine("ready");
            Console.Out.Flush();
            for (int n = 0; ; n++)
            {
                File.WriteAllBytes(next, File.ReadAllBytes(path));
                ReplaceName(next, path, false);
            }
        }
    }
}
'@
    $driver = $driver.Replace('__REGION__', $region.Groups[1].Value.TrimEnd()).Replace('__BLOCK__', $block.Groups[1].Value.TrimEnd())
    $dll = $null
    try { $dll = Build-LauncherCode -Source $driver -Exe }
    catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes "the real code compiles with the .NET SDK the launcher builds with, C# $LauncherLangVersion" ($null -ne $dll)
    if (-not $dll) { Done }
    if (-not $OnWindows) { Write-Host 'SKIP  the swaps, run: the launcher''s code renames through kernel32, which only Windows has'; Done }

    $script:out = ''
    function Run([string[]]$a) { $script:out = (Invoke-LauncherExe $dll @a) -join "`n"; return $LASTEXITCODE }
    function Put([string]$p, [string]$t) { [IO.File]::WriteAllText($p, $t) }
    function Text([string]$p) { if (Test-Path -LiteralPath $p) { return [IO.File]::ReadAllText($p) } else { return $null } }
    function RO([string]$p) { return (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReadOnly) -ne 0) }
    function SetRO([string]$p) { [IO.File]::SetAttributes($p, 'ReadOnly') }
    function Names([string]$p) { return @(& fsutil hardlink list $p 2>$null | Where-Object { $_ }).Count }
    $n = Join-Path $work 'x.next'

    # 2: what it does.
    $f = Join-Path $work 'a.ini'; Put $f 'old'; Put $n 'new'
    Yes 'ReplaceName: a file is replaced by the one beside it, and nothing is left beside it' ((Run @('swap', $f, $n, 'keep')) -eq 0 -and (Text $f) -eq 'new' -and -not (Test-Path -LiteralPath $n))
    $g = Join-Path $work 'b.esp'; Put $n 'fresh'
    Yes '...where there was no file, it is put in place' ((Run @('swap', $g, $n, 'keep')) -eq 0 -and (Text $g) -eq 'fresh')

    $steam = Join-Path $work 'steamcopy.bsa'; Put $steam 'STEAM'; $sharedAt = Join-Path $work 'shared.bsa'; Put $sharedAt 'OLD COPY'
    $null = Run @('link', $steam, $n)
    Yes 'a link to the Steam copy goes in while Steam reads that file, with no write handle asked of it' ((Run @('steamheld', $sharedAt, $n, $steam)) -eq 0 -and (Text $sharedAt) -eq 'STEAM' -and (Text $steam) -eq 'STEAM')
    $r = Join-Path $work 'r.ini'; Put $r 'old'; SetRO $r; Put $n 'new'
    Yes 'a read only file, not told to clear the mark: refused, and left as it was, mark and all' ((Run @('swap', $r, $n, 'keep')) -eq 3 -and (Text $r) -eq 'old' -and (RO $r))
    Yes '...told to clear the mark: replaced' ((Run @('swap', $r, $n, 'clear')) -eq 0 -and (Text $r) -eq 'new' -and -not (Test-Path -LiteralPath $n))

    # A read only hard link the rename cannot replace even with the mark off.
    $v = Join-Path $work 'vortex.bsa'; $o = Join-Path $work 'ours.bsa'
    Put $v 'theirs'; $linked = (Run @('link', $v, $o)) -eq 0; SetRO $v; Put $n 'mine'
    $code = Run @('lockednamein', $o, $n, '-1')
    Yes ('a read only link held open: SwapNameIn is refused ({0})' -f $code) ($linked -and $code -eq 3 -and (Text $o) -eq 'theirs')
    Yes '...the read only mark is back on, on the other name too' ((RO $v) -and (RO $o))
    Yes '...and next is taken away, so nothing is left beside it' (-not (Test-Path -LiteralPath $n))

    # Locks.
    $l = Join-Path $work 'locked.ini'; Put $l 'old'; Put $n 'new'
    $code = Run @('lockedswap', $l, $n, '150')
    Yes ('a lock let go after 150 ms is waited out, and the file replaced ({0})' -f ($script:out -split "`n" | Select-Object -Last 1)) ($code -eq 0 -and (Text $l) -eq 'new')
    Put $n 'new2'
    $code = Run @('lockedswap', $l, $n, '-1')
    $ms = [int](([regex]::Match($script:out, 'MS (\d+)')).Groups[1].Value)
    Yes ('a lock never let go: refused after about {0} ms, and the file is whole' -f $ms) ($code -eq 3 -and (Text $l) -eq 'new' -and $ms -ge 300 -and $ms -lt 3000)
    Remove-Item -LiteralPath $n -Force -ErrorAction SilentlyContinue

    # DeleteName.
    $v2 = Join-Path $work 'steam.bsa'; $s2 = Join-Path $work 'steam.bsa.thornswood-share'
    Put $v2 'steam'; $null = Run @('link', $v2, $s2); SetRO $v2
    Yes 'DeleteName takes a read only link''s name off' ((Run @('delname', $s2)) -eq 0 -and -not (Test-Path -LiteralPath $s2))
    Yes '...and the other name keeps its bytes and its read only mark' ((Text $v2) -eq 'steam' -and (RO $v2) -and (Names $v2) -eq 1)

    # SwapCopyIn.
    $sv = Join-Path $work 'vortex.ini'; $sp = Join-Path $work 'game.ini'; $aside = $sp + '.mine'
    Put $sv 'shared'; $null = Run @('link', $sv, $sp)
    Put $aside 'stale'; SetRO $aside
    Yes 'SwapCopyIn over a stale read only copy from a stopped run: done' ((Run @('copyin', $sp, $aside)) -eq 0 -and (Text $sp) -eq 'shared' -and -not (Test-Path -LiteralPath $aside))
    Yes '...path has a name of its own now, and the other file is untouched' ((Names $sp) -eq 1 -and (Names $sv) -eq 1 -and (Text $sv) -eq 'shared')
    $rv = Join-Path $work 'vortex-ro.ini'; $rp = Join-Path $work 'game-ro.ini'
    Put $rv 'shared'; $null = Run @('link', $rv, $rp); SetRO $rv
    Yes 'SwapCopyIn on a read only shared file: refused, path as it was' ((Run @('copyin', $rp, ($rp + '.own'))) -eq 3 -and (Text $rp) -eq 'shared' -and (RO $rp) -and (Names $rp) -eq 2)
    Yes '...and no copy is left beside it' (-not (Test-Path -LiteralPath ($rp + '.own')))
    Yes 'no clean up had to be noted as failed' ($script:out -notmatch 'NOTE ')

    # 3: killed while it swaps.
    $body = ('x' * 17000)
    $kp = Join-Path $work 'killed\settings.ini'
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $kp)
    Put $kp $body
    $whole = 0; $bad = @()
    $rand = New-Object Random 2599
    for ($i = 0; $i -lt 50; $i++) {
        $psi = New-Object Diagnostics.ProcessStartInfo($LauncherDotnet, ('"{0}" "loop" "{1}"' -f $dll, $kp))
        $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true
        $p = [Diagnostics.Process]::Start($psi)
        $null = $p.StandardOutput.ReadLine()
        Start-Sleep -Milliseconds ($rand.Next(15, 160))
        $p.Kill(); $p.WaitForExit(); $p.Dispose()
        if ((Text $kp) -eq $body) { $whole++ } else { $bad += $(if (Test-Path -LiteralPath $kp) { 'cut' } else { 'missing' }) }
    }
    Yes ('killed 50 times while ReplaceName swaps: the file is there and whole every time ({0} of 50{1})' -f $whole, $(if ($bad) { '; ' + ($bad -join ', ') })) ($whole -eq 50)

    $op = Join-Path $work 'oldway\settings.ini'
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $op)
    Put $op $body
    $psi = New-Object Diagnostics.ProcessStartInfo($LauncherDotnet, ('"{0}" "oldway" "{1}"' -f $dll, $op))
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true
    $p = [Diagnostics.Process]::Start($psi)
    $said = $p.StandardOutput.ReadLine()
    $p.Kill(); $p.WaitForExit(); $p.Dispose()
    Yes 'the old delete then move, stopped between its two steps, leaves the file missing' ($said -eq 'between' -and -not (Test-Path -LiteralPath $op))
}
finally {
    Get-ChildItem -LiteralPath $work -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Attributes = 'Normal' } catch { } }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
