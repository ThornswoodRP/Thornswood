<#
  test-play-stuck-game.ps1

      pwsh -NoProfile -File .\launcher\tests\test-play-stuck-game.ps1

  The Play path's guards that no harness ran: ClearStuckGame,
  CloseGameWaiting, ClearLeftovers and EnsureServer in launcher\app\Shell.cs and ShellPlay.cs.

  Each method is lifted out of the real Shell.cs (the brace-matched body, the
  way test-play-progress.ps1 reads its wiring) and built the way the project
  builds, with the .NET 10 SDK (tests\Launcher-Csc.ps1, #4823, on any machine
  that has it), beside stand-ins for Checks, SkyMp, Ask (the launcher's
  message boxes), Waiting and Log. The
  stand-ins script every answer the real ones can give, so this fails if a
  guard starts closing somebody's other Skyrim, closes a visible game without
  asking, carries on when the game would not close, kills a session that is
  still loading, or lets the game start against a local server that never came
  up. Then the order of the steps in Play is read from the file: the busy
  guards, ClearStuckGame, Verify, EnsureServer, Keep/Hold, and only then
  Process.Start.

  No process is started or ended. Read only apart from the build under
  out\harness, which git ignores.
#>
[CmdletBinding()]
param([string]$AppDir)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppDir) { $AppDir = Join-Path $Repo 'launcher\app' }

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

$shellPath = Join-Path $AppDir 'Shell.cs'
Yes 'Shell.cs is in the launcher source' (Test-Path -LiteralPath $shellPath)
if (-not (Test-Path -LiteralPath $shellPath)) { Done }
# Since #500 the Play session (Play, EnsureServer, ClearStuckGame,
# CloseGameWaiting) is in ShellPlay.cs; ClearLeftovers stays in Shell.cs.
$shell = [IO.File]::ReadAllText($shellPath, [Text.Encoding]::UTF8) + "`n" + [IO.File]::ReadAllText((Join-Path $AppDir 'ShellPlay.cs'), [Text.Encoding]::UTF8)

$sigs = @('static bool ClearStuckGame(bool askIfVisible)', 'static string CloseGameWaiting(out int closed)',
          'static string ClearLeftovers()', 'static bool EnsureServer()')
$bodies = @()
foreach ($sig in $sigs) {
    $b = Body $shell $sig
    Yes "lifted $sig" ($b.Length -gt 0)
    $bodies += $b
}
if ($script:fail) { Done }

Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.Collections.Generic;
namespace Thornswood
{
    class Config { }
    // Stands in for Ask.cs: every box is recorded, a Yes and No box gets
    // Answer, and nothing goes on the screen.
    static class Ask
    {
        public enum Icon { None, Error, Question, Warning, Info }
        public static bool Answer;
        public static List<string> Asked = new List<string>();
        public static void Tell(string text, string title = "Thornswood", Icon icon = Icon.Info) { Asked.Add(text); }
        public static bool YesNo(string text, string title = "Thornswood", Icon icon = Icon.Question, bool noIsDefault = false)
        { Asked.Add(text); return Answer; }
    }
    static class Checks
    {
        public static bool Running, Other, Visible;
        public static int Closes, CloseCalls;
        public static string Stuck = "";
        public static bool GameRunning() { return Running; }
        public static bool OtherSkyrimRunning() { return Other; }
        public static bool GameVisible() { return Visible; }
        public static int CloseGame() { CloseCalls++; return Closes; }
        public static string StuckReport() { return Stuck; }
    }
    static class SkyMp
    {
        public static bool IsUp, Local, Throw;
        public static string StartSays;
        public static int Starts;
        public static bool Up(Config c) { if (Throw) throw new InvalidOperationException("boom"); return IsUp; }
        public static bool IsLocal(Config c) { return Local; }
        public static string Start(Config c, Action<string> say) { Starts++; return StartSays; }
    }
    static partial class Shell
    {
        static Config cfg = new Config();
        static string stallDoing;
        static bool young;
        static int waits;
        static string stallSeenInside;
        static List<string> logged = new List<string>();
        static void Log(string m) { logged.Add(m); }
        static void SafeLog(string m) { logged.Add(m); }
        static void Waiting(Action a) { waits++; stallSeenInside = stallDoing; a(); }
        static bool JustStarted(int seconds) { return young; }

__METHODS__

        static int pass, fail;
        static void Yes(string what, bool ok)
        {
            if (ok) { pass++; Console.WriteLine("PASS  " + what); }
            else { fail++; Console.WriteLine("FAIL  " + what); }
        }
        static void Reset()
        {
            Checks.Running = Checks.Other = Checks.Visible = false;
            Checks.Closes = 0; Checks.CloseCalls = 0; Checks.Stuck = "";
            SkyMp.IsUp = SkyMp.Local = SkyMp.Throw = false; SkyMp.StartSays = null; SkyMp.Starts = 0;
            Ask.Answer = false; Ask.Asked.Clear();
            logged.Clear(); young = false; waits = 0; stallSeenInside = null; stallDoing = null;
        }
        static bool LoggedHas(string s) { foreach (string l in logged) if (l.Contains(s)) return true; return false; }

        static int Main()
        {
            // ---- ClearStuckGame -------------------------------------------
            Reset();
            Yes("nothing running: Play goes on, nothing asked or closed", ClearStuckGame(true) && Ask.Asked.Count == 0 && Checks.CloseCalls == 0);

            Reset(); Checks.Other = true;
            Yes("another folder's Skyrim, asked and refused: stop, it is not closed", !ClearStuckGame(true) && Ask.Asked.Count == 1 && Checks.CloseCalls == 0);
            Reset(); Checks.Other = true; Ask.Answer = true;
            Yes("another folder's Skyrim, asked and accepted: go on, still not closed", ClearStuckGame(true) && Checks.CloseCalls == 0);
            Reset(); Checks.Other = true;
            Yes("another folder's Skyrim with no asking: go on, never closed", ClearStuckGame(false) && Ask.Asked.Count == 0 && Checks.CloseCalls == 0);

            Reset(); Checks.Running = true; Checks.Visible = true;
            Yes("our game on screen, refused: stop and close nothing", !ClearStuckGame(true) && Checks.CloseCalls == 0 && LoggedHas("Left the game"));
            Reset(); Checks.Running = true; Checks.Visible = true;
            Yes("our game on screen with no asking: never closed silently", !ClearStuckGame(false) && Checks.CloseCalls == 0 && Ask.Asked.Count == 0);
            Reset(); Checks.Running = true; Checks.Visible = true; Ask.Answer = true; Checks.Closes = 2;
            Yes("our game on screen, accepted: closed and Play goes on", ClearStuckGame(true) && Checks.CloseCalls == 1 && LoggedHas("Closed 2 Skyrim processes"));

            Reset(); Checks.Running = true; Checks.Closes = 1;
            Yes("windowless leftover: closed without asking", ClearStuckGame(true) && Ask.Asked.Count == 0 && LoggedHas("Closed 1 Skyrim process that"));
            Reset(); Checks.Running = true; Checks.Stuck = "Still running: SkyrimSE.exe (process 9).";
            Yes("leftover that will not close: stop, and say what is still running", !ClearStuckGame(true) && Ask.Asked.Count == 1 && Ask.Asked[0].Contains("SkyrimSE.exe"));
            Reset(); Checks.Running = true; Checks.Stuck = "Still running: x.";
            Yes("leftover that will not close, no asking: stop with no box", !ClearStuckGame(false) && Ask.Asked.Count == 0);

            // ---- CloseGameWaiting -----------------------------------------
            Reset(); Checks.Closes = 3; Checks.Stuck = null; int n;
            string still = CloseGameWaiting(out n);
            Yes("CloseGameWaiting closes inside Waiting with the stall label set", waits == 1 && stallSeenInside == "closing Skyrim");
            Yes("CloseGameWaiting clears the stall label and counts what closed", stallDoing == null && n == 3);
            Yes("a null StuckReport comes back as empty, not null", still == "");

            // ---- ClearLeftovers -------------------------------------------
            Reset();
            Yes("startup: nothing running, nothing to say", ClearLeftovers() == null && Checks.CloseCalls == 0);
            Reset(); Checks.Running = true; Checks.Visible = true;
            Yes("startup: a visible game is left alone", ClearLeftovers() == null && Checks.CloseCalls == 0);
            Reset(); Checks.Running = true; young = true;
            Yes("startup: a windowless game still loading in is left alone", ClearLeftovers() == null && Checks.CloseCalls == 0);
            Reset(); Checks.Running = true; Checks.Closes = 2;
            string s = ClearLeftovers();
            Yes("startup: an old windowless leftover is closed and counted", s != null && s.Contains("Closed 2 Skyrim processes") && Checks.CloseCalls == 1);
            Reset(); Checks.Running = true; Checks.Stuck = "Still running: y.";
            s = ClearLeftovers();
            Yes("startup: one that would not close is reported", s != null && s.Contains("would not close") && s.Contains("Still running: y."));

            // ---- EnsureServer ---------------------------------------------
            Reset(); SkyMp.IsUp = true;
            Yes("server answering: go, nothing started or asked", EnsureServer() && SkyMp.Starts == 0 && Ask.Asked.Count == 0);
            Reset();
            Yes("remote server silent, refused: do not start", !EnsureServer() && Ask.Asked.Count == 1 && SkyMp.Starts == 0);
            Reset(); Ask.Answer = true;
            Yes("remote server silent, accepted: start anyway, never start a server", EnsureServer() && SkyMp.Starts == 0);
            Reset(); SkyMp.Local = true;
            Yes("local server down and comes up: started inside Waiting, go", EnsureServer() && SkyMp.Starts == 1 && waits == 1 && LoggedHas("The server is up."));
            Reset(); SkyMp.Local = true; SkyMp.StartSays = "Node is missing.";
            Yes("local server will not start: stop and show why", !EnsureServer() && Ask.Asked.Count == 1 && Ask.Asked[0] == "Node is missing.");
            Reset(); SkyMp.Throw = true;
            Yes("a check that throws is logged and lets Play go on (as written)", EnsureServer() && LoggedHas("Could not check the server: boom"));

            Console.WriteLine();
            Console.WriteLine(pass + " passed, " + fail + " failed");
            return fail == 0 ? 0 : 1;
        }
    }
}
'@
$driver = $driver.Replace('__METHODS__', ($bodies -join "`r`n`r`n"))

$exe = $null
try { $exe = Build-LauncherCode -Source $driver -Exe } catch { Write-Host ('      ' + $_.Exception.Message) }
Yes 'the lifted guards build the way the project builds them' ($null -ne $exe)
if (-not $exe) { Done }
$lines = Invoke-LauncherExe $exe
$code = $LASTEXITCODE
foreach ($l in $lines) {
    if ($l -like 'PASS  *') { $script:pass++; Write-Host $l }
    elseif ($l -like 'FAIL  *') { $script:fail++; Write-Host $l }
}
Yes 'the driver exits 0' ($code -eq 0)

# ---- 2. the order of Play's steps, read from the file ----------------------
$play = Body $shell 'static void Play()'
Yes 'Play() is in ShellPlay.cs' ($play.Length -gt 0)
$steps = @('if (updatePending)', 'if (collectionBarUp)', 'if (ownGameBusy)', 'File.Exists(Paths.Loader)',
           'ClearStuckGame(true)', 'Verify.Run(cfg)', 'EnsureServer()', 'Keep.Restore()', 'Hold.Take(', 'Swap.Apply()', 'Process.Start(psi)')
$prev = -1; $prevName = 'the top'
foreach ($st in $steps) {
    $i = $play.IndexOf($st)
    Yes "Play has $st after $prevName" ($i -gt $prev)
    if ($i -ge 0) { $prev = $i; $prevName = $st }
}
Yes 'a refused ClearStuckGame returns before the game starts' ($play.Contains('if (!ClearStuckGame(true)) return;'))
Yes 'a refused EnsureServer returns before the game starts' ($play.Contains('if (!EnsureServer()) return;'))
$upd = [IO.File]::ReadAllText((Join-Path $AppDir 'ShellUpdate.cs'), [Text.Encoding]::UTF8)
Yes 'the update path also stops on a refused ClearStuckGame' ($upd.Contains('if (!ClearStuckGame(true)) return;'))

Done
