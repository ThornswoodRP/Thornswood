<#
  test-4628-wait-on-the-thing.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4628-wait-on-the-thing.ps1

  #4628. Closing a stuck Skyrim and moving the Skyrim folders aside waited
  out their races with fixed sleeps and retries instead of waiting on what
  each needs:

    - Checks.CloseGame looked every 250 ms, up to 24 times after asking the
      game to close and 12 after ending it, whether the game had gone or
      not. What it needs is the processes' exit, and a process's own handle
      says when that is (WaitForExit). Once it has exited, Windows has
      closed every handle it held.
    - Swap.MoveAside, refused because something still held the folder,
      closed the game and then tried the move ten more times, 400 ms
      apart. What the move needs is the game gone, which CloseGame now
      returns only once it is; a move refused after that is held by
      something that is not the game, and waiting does not make it let go.

  Both are lifted from launcher\app and built the way the project builds,
  with stand-ins for the parts that would touch the real game:

    1. CloseGame, given a real process with no window (pwsh, sleeping):
         a. it ends it and says it closed one;
         b. the process has exited by the time it returns;
         c. it never sleeps: it waits on the exit, not on a clock.
    2. MoveAside, with a stand-in Directory.Move and Checks:
         a. a move that goes first time closes nothing;
         b. a refused move closes the game once and moves once more;
         c. refused again, it does not move a third time, and it throws
            naming the folder, with the refusal inside;
         d. that says what StuckReport found when the game would not go,
            and says the holder is not Skyrim when it did go.
    3. Teeth: a CloseGame that looks again every 250 ms after ending the
       game fails 1c, and a MoveAside that moves again without closing the
       game first fails 2b.

  Read only apart from the builds under out\harness, which git ignores.
#>
[CmdletBinding()]
param([string]$AppDir)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppDir) { $AppDir = Join-Path $Repo (Join-Path 'launcher' 'app') }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host "$script:pass passed, $script:fail failed"
    exit $(if ($script:fail) { 1 } else { 0 })
}
function Body([string]$src, [string]$start) {
    $at = $src.IndexOf($start)
    if ($at -lt 0) { return '' }
    $open = $src.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $src.Length; $i++) {
        if ($src[$i] -eq '{') { $depth++ }
        elseif ($src[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $src.Substring($at, $i - $at + 1) } }
    }
    return ''
}
function Run-Built([string]$src, [string]$label) {
    $built = $null
    try { $built = Build-LauncherCode -Source $src -Exe }
    catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    Yes "$label builds the way the project builds" ($null -ne $built)
    if (-not $built) { return @() }
    return @(Invoke-LauncherExe $built | ForEach-Object { "$_" })
}
function Count-Lines([string[]]$lines) {
    foreach ($l in @($lines)) {
        if ($l -like 'PASS  *') { $script:pass++; Write-Host $l }
        elseif ($l -like 'FAIL  *') { $script:fail++; Write-Host $l }
    }
}

Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$checks = [IO.File]::ReadAllText((Join-Path $AppDir 'Checks.cs'), [Text.Encoding]::UTF8)
$swap = [IO.File]::ReadAllText((Join-Path $AppDir 'Swap.cs'), [Text.Encoding]::UTF8)

# ---- 1. CloseGame waits on the exit --------------------------------------------
# CloseGame and whatever it keeps beside it, up to StuckReport's summary.
$from = $checks.IndexOf('public static int CloseGame()')
$to = $checks.IndexOf('/// What is still running and why it might not go')
if ($to -gt 0) { $to = $checks.LastIndexOf('/// <summary>', $to) }
Yes '1. Checks.cs has CloseGame, then StuckReport after it' ($from -ge 0 -and $to -gt $from)
$close = if ($from -ge 0 -and $to -gt $from) { $checks.Substring($from, $to - $from) } else { '' }

# No using System.Threading: Thread here is the stand-in, which counts.
$closeDriver = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Thornswood
{
    static class Thread
    {
        public static int Slept;
        public static void Sleep(int ms) { Slept += ms; System.Threading.Thread.Sleep(ms); }
    }
    static class Swallow { public static void Note(string where, Exception e) { Console.WriteLine("NOTE  " + where + ": " + e.Message); } }

    static class Checks
    {
        static int child;
        static List<Process> GameProcesses()
        {
            var ps = new List<Process>();
            try { ps.Add(Process.GetProcessById(child)); } catch (ArgumentException) { return ps; }
            return ps;
        }
        static void Release(List<Process> ps) { foreach (Process p in ps) p.Dispose(); }
        public static bool GameRunning()
        {
            List<Process> ps = GameProcesses();
            bool up = false;
            foreach (Process p in ps) if (!p.HasExited) up = true;
            Release(ps);
            return up;
        }

__CLOSE__

        static int pass, fail;
        static void Yes(string what, bool ok)
        {
            if (ok) { pass++; Console.WriteLine("PASS  " + what); }
            else { fail++; Console.WriteLine("FAIL  " + what); }
        }

        static int Main()
        {
            var psi = new ProcessStartInfo("pwsh", "-NoProfile -NonInteractive -Command Start-Sleep -Seconds 120");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process held = Process.Start(psi);
            child = held.Id;
            try
            {
                int closed = CloseGame();
                bool gone = held.HasExited;
                Yes("1a. CloseGame ends a process with no window and says it closed one (" + closed + ")", closed == 1);
                Yes("1b. the process has exited by the time CloseGame returns", gone);
                Yes("1c. CloseGame never sleeps, it waits on the exit (slept " + Thread.Slept + " ms)", Thread.Slept == 0);
            }
            finally { try { if (!held.HasExited) held.Kill(); } catch (InvalidOperationException) { } }
            Console.WriteLine(pass + " passed, " + fail + " failed");
            return fail == 0 ? 0 : 1;
        }
    }
}
'@

if ($close.Length -gt 0) {
    Count-Lines (Run-Built ($closeDriver.Replace('__CLOSE__', $close)) '1. CloseGame, lifted,')

    # Teeth: looking again on a clock after ending the game.
    $clocked = $close.Replace('WaitForExits(ps, EndedToGo);', 'for (int i = 0; i < 12; i++) { Thread.Sleep(250); if (!GameRunning()) break; }')
    Yes '3. the clocked CloseGame differs from the shipped one' ($clocked -ne $close)
    $lines = Run-Built ($closeDriver.Replace('__CLOSE__', $clocked)) '3. a CloseGame that looks again every 250 ms'
    Yes '3. and it fails 1c' (@($lines | Where-Object { $_ -like 'FAIL  1c. *' }).Count -eq 1)
}

# ---- 2. MoveAside moves once more, after the game is gone ----------------------
$move = Body $swap 'static void MoveAside(string from, string to)'
$held = Body $swap 'static Exception StillHeld(string from, Exception refused)'
Yes '2. Swap.cs has MoveAside' ($move.Length -gt 0)

# Directory and Checks here are the stand-ins: a type in the namespace wins
# over one a using brings in.
$moveDriver = @'
using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    static class Swallow { public static void Note(string where, Exception e) { } }
    static class Directory
    {
        public static int Moves, RefuseFirst;
        public static void Move(string from, string to)
        {
            Moves++;
            if (Moves <= RefuseFirst) throw new IOException("The process cannot access the file because it is being used by another process.");
        }
    }
    static class Checks
    {
        public static int Closes;
        public static string Stuck = "";
        public static int CloseGame() { Closes++; return 1; }
        public static string StuckReport() { return Stuck; }
    }

    static class Swap
    {
__MOVE__

        static int pass, fail;
        static void Yes(string what, bool ok)
        {
            if (ok) { pass++; Console.WriteLine("PASS  " + what); }
            else { fail++; Console.WriteLine("FAIL  " + what); }
        }
        static Exception Try(int refuse, string stuck)
        {
            Directory.Moves = 0; Directory.RefuseFirst = refuse; Checks.Closes = 0; Checks.Stuck = stuck;
            try { MoveAside(@"C:\Users\someone\Documents\My Games\Skyrim Special Edition", @"C:\aside"); return null; }
            catch (Exception ex) { return ex; }
        }

        static int Main()
        {
            Exception e = Try(0, "");
            Yes("2a. a move that goes first time closes nothing and moves once", e == null && Checks.Closes == 0 && Directory.Moves == 1);

            e = Try(1, "");
            Yes("2b. a refused move closes the game once and moves once more (closed " + Checks.Closes + ", moved " + Directory.Moves + ")",
                e == null && Checks.Closes == 1 && Directory.Moves == 2);

            e = Try(1000, "");
            Yes("2c. refused again, it does not move a third time (moved " + Directory.Moves + ")", Directory.Moves == 2 && Checks.Closes == 1);
            Yes("2c. and it throws naming the folder, with the refusal inside",
                e != null && e.Message.Contains("Skyrim Special Edition") && e.InnerException is IOException);
            Yes("2d. with the game gone, it says the holder is not Skyrim",
                e != null && e.Message.Contains("Something other than Skyrim"));

            e = Try(1000, "Still running: SkyrimSE.exe (process 4242).");
            Yes("2d. with the game still there, it says what StuckReport found",
                e != null && e.Message.Contains("SkyrimSE.exe (process 4242)"));

            Console.WriteLine(pass + " passed, " + fail + " failed");
            return fail == 0 ? 0 : 1;
        }
    }
}
'@

if ($move.Length -gt 0) {
    $both = $move + "`r`n`r`n" + $held
    Count-Lines (Run-Built ($moveDriver.Replace('__MOVE__', $both)) '2. MoveAside, lifted,')

    # Teeth: moving again without closing the game first.
    $blind = $move.Replace('try { Checks.CloseGame(); } catch (Exception ex) { Swallow.Note("Swap.MoveAside, CloseGame", ex); }', '')
    Yes '3. the MoveAside that does not close the game differs from the shipped one' ($blind -ne $move)
    $lines = Run-Built ($moveDriver.Replace('__MOVE__', $blind + "`r`n`r`n" + $held)) '3. a MoveAside that moves again without closing the game'
    Yes '3. and it fails 2b' (@($lines | Where-Object { $_ -like 'FAIL  2b. *' }).Count -eq 1)
}

Done
