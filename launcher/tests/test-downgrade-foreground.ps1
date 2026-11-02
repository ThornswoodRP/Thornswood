<#
  test-downgrade-foreground.ps1

      pwsh -NoProfile -File .\launcher\tests\test-downgrade-foreground.ps1

  The Downgrade button brings Steam's window to the front for a later part
  too, when the person has gone to another program since the button was
  pressed, and never joins a window that has stopped answering.

  WHY THIS EXISTS. A tester on launcher 1.1.94, 25 September. Part 1 was
  typed into Steam's console and came down. Twenty minutes later the launcher
  opened the console for part 2 and typed nothing (Patrick: "it correctly put
  the first command in it finnished and than it redid the open console command
  and stopped"). Part 1 is asked for with the launcher in front, the moment
  its button is pressed. Part 2 is asked for when the person is somewhere
  else, and BringToFront's two ways through, joining Steam's input thread and
  a tap of Alt, do nothing then when the window in front is one our keys
  cannot reach. The foreground belongs to the window in front, so that is the
  thread to join.

  HOW. BringToFront, SteamInFront, ForegroundIsSteam, IsSteam and InFront are
  lifted out of launcher\app\Downgrade.cs by brace match and compiled with the
  .NET SDK the launcher builds with (tests\Launcher-Csc.ps1), against a
  stand-in desktop, so it runs on any machine. Nothing here focuses a window or sends a key.

  The stand-in follows Windows' rule for SetForegroundWindow as Microsoft
  documents it, reduced to the cases this code meets: the call goes through
  when the window is already in front, when the caller is the process in
  front, when the caller's input is joined to the thread in front, or when
  the last input came from the caller (the Alt tap), unless the window in
  front is one the caller's keys cannot reach. That is a model of Windows,
  not Windows, and it is the rule the code has to get through.
#>
[CmdletBinding()]
param([string]$AppPath)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in launcher\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppPath) { $AppPath = Join-Path $Here 'launcher\app' }

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

$src = Join-Path $AppPath 'Downgrade.cs'
Yes 'launcher\app\Downgrade.cs is there' (Test-Path -LiteralPath $src)
if (-not (Test-Path -LiteralPath $src)) { Done }
$text = [IO.File]::ReadAllText($src)

# From the start of the line the signature is on to the brace that closes it,
# stepping over strings, characters and comments. The same walk as
# test-downgrade-steam-window.ps1.
function Get-Member([string]$all, [string]$signature) {
    $at = $all.IndexOf($signature)
    if ($at -lt 0) { return $null }
    $lineStart = $all.LastIndexOf("`n", $at) + 1
    $open = $all.IndexOf('{', $at + $signature.Length)
    if ($open -lt 0) { return $null }
    $depth = 0
    $i = $open
    while ($i -lt $all.Length) {
        $c = $all[$i]
        if ($c -eq '"' -or $c -eq "'") {
            $q = $c; $i++
            while ($i -lt $all.Length -and $all[$i] -ne $q) { if ($all[$i] -eq '\') { $i++ }; $i++ }
        }
        elseif ($c -eq '/' -and $i + 1 -lt $all.Length -and $all[$i + 1] -eq '/') {
            $i = $all.IndexOf("`n", $i); if ($i -lt 0) { return $null }
        }
        elseif ($c -eq '/' -and $i + 1 -lt $all.Length -and $all[$i + 1] -eq '*') {
            $i = $all.IndexOf('*/', $i + 2); if ($i -lt 0) { return $null }; $i++
        }
        elseif ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) {
                $end = $i + 1
                if ($end -lt $all.Length -and $all[$end] -eq ';') { $end++ }
                return $all.Substring($lineStart, $end - $lineStart)
            }
        }
        $i++
    }
    return $null
}

$wanted = [ordered]@{
    'BringToFront'      = 'static void BringToFront(IntPtr h)'
    'SteamInFront'      = 'static bool SteamInFront(IntPtr h)'
    'ForegroundIsSteam' = 'static bool ForegroundIsSteam()'
    'IsSteam'           = 'static bool IsSteam(string processName)'
    'SteamNames'        = 'static readonly string[] SteamNames ='
    'InFront'           = 'static string InFront()'
}
$lifted = [ordered]@{}
foreach ($k in $wanted.Keys) {
    $m = Get-Member $text $wanted[$k]
    Yes ("Downgrade.cs has {0}" -f $k) ($null -ne $m)
    if ($null -ne $m) { $lifted[$k] = $m }
}
if ($lifted.Count -ne $wanted.Count) { Done }

# ---- read from the text -------------------------------------------------------
Yes 'InFront names the program and never reads a window title, which can be private' (-not $lifted['InFront'].Contains('GetWindowText') -and -not $lifted['InFront'].Contains('WindowWords'))
Yes 'when nothing was typed the log says which program was in front' ($text.Contains("Steam's window would not come to the front (the window in front belongs to "" + InFront() + ""), so nothing was typed. "))
Yes 'IsHungAppWindow is declared' ([regex]::IsMatch($text, 'LibraryImport\("user32\.dll"\)\]\s*\[return: MarshalAs\(UnmanagedType\.Bool\)\]\s*private static partial bool IsHungAppWindow\(IntPtr hWnd\);'))

# ---- the second go at the console, read off Run's text -------------------------
#
# BringToFront getting Steam forward is only half of it. Run used to try the
# console a second time with `if (!started && typed)`, so a part whose first
# attempt never reached the console at all got no second go and went straight
# to the clipboard to sit there. That is every part after the first: part 1 is
# asked for with the launcher in front, the moment the button is pressed, and
# the rest twenty minutes apart with whatever the person has opened since over
# the top. So the second go happens either way now.
$run = Get-Member $text 'static bool Run(Config cfg, Action<string> log, Action<string> status)'
Yes 'Run is there' ($null -ne $run)
if ($null -ne $run) {
    Yes 'the console is tried again whether the first attempt typed or fell back to the clipboard' ($run -notmatch 'if \(!started && typed\)')
    # Past the first attempt's own "bool typed = TypeIntoConsole(cmd, log);",
    # which holds the same words.
    $atFocus = $run.IndexOf('FocusConsole(log);')
    $atRetype = if ($atFocus -ge 0) { $run.IndexOf('typed = TypeIntoConsole(cmd, log);', $atFocus) } else { -1 }
    Yes 'the second go brings the console back before it types' ($atFocus -ge 0 -and $atRetype -gt $atFocus)
    # A part on the clipboard may have been pasted by the person while the
    # console was being brought back, and a pasted download_depot and a typed
    # one would both run.
    Yes 'and types nothing if Steam took a command while the console was coming back' (
        $run -match 'string sinceCmd = steamLog\.Since\(\);' -and
        $run -match 'if \(LogStarted\(sinceCmd, depot\) \|\| Directory\.Exists\(folder\)\) \{ sawStart = true; started = true; \}')
    Yes 'the clipboard is what is left after the second go, and is said once' (
        $run -match 'if \(!pasted\)\s*\{\s*OnClipboard\(cmd, i \+ 1, "", log, status\);\s*pasted = true;')
}

# ---- the stand-in desktop -------------------------------------------------------
$probe = @'
using System;
using System.Collections.Generic;
using System.Threading;

namespace Probe
{
    public class Process
    {
        public int Id;
        public string ProcessName;
        public static List<Process> All = new List<Process>();
        public static Process GetProcessById(int id)
        {
            foreach (Process p in All) if (p.Id == id) return p;
            throw new ArgumentException("Process with an Id of " + id + " is not running.");
        }
    }

    public class Win { public IntPtr Handle; public uint Pid; public uint Thread; public bool Hung; public bool Unreachable; }

    // Stands in for launcher\app\Swallow.cs, which the lifted text calls from
    // its catch blocks since the silent catches were given a log line (#461).
    static class Swallow { public static void Note(string where, Exception e) { } }

    public static class Downgrade
    {
        public static List<Win> Desktop = new List<Win>();
        public static IntPtr Foreground = IntPtr.Zero;
        public const uint Me = 1;          // the launcher's worker thread
        public const uint MyPid = 400;     // the launcher
        public static HashSet<uint> Joined = new HashSet<uint>();
        public static List<uint> EverJoined = new List<uint>();
        public static bool LastInputOurs;
        public static int Keys;

        public static void Reset()
        {
            Process.All.Clear(); Desktop.Clear(); Foreground = IntPtr.Zero;
            Joined.Clear(); EverJoined.Clear(); LastInputOurs = false; Keys = 0;
        }
        public static void AddProcess(int id, string name) { var p = new Process(); p.Id = id; p.ProcessName = name; Process.All.Add(p); }
        public static void AddWindow(long h, int pid, int thread, bool hung, bool unreachable)
        {
            var w = new Win(); w.Handle = new IntPtr(h); w.Pid = (uint)pid; w.Thread = (uint)thread; w.Hung = hung; w.Unreachable = unreachable;
            Desktop.Add(w);
        }
        public static void SetForeground(long h) { Foreground = new IntPtr(h); }
        public static long GetForeground() { return Foreground.ToInt64(); }
        public static int JoinedCount() { return Joined.Count; }
        public static bool EverJoinedThread(int t) { return EverJoined.Contains((uint)t); }
        static Win Find(IntPtr h) { foreach (Win w in Desktop) if (w.Handle == h) return w; return null; }

        const uint GA_ROOT = 2;
        const int SW_RESTORE = 9;
        const ushort VK_MENU = 0x12;
        static bool IsIconic(IntPtr h) { return false; }
        static bool ShowWindow(IntPtr h, int cmd) { return true; }
        static uint GetCurrentThreadId() { return Me; }
        static IntPtr GetForegroundWindow() { return Foreground; }
        static IntPtr GetAncestor(IntPtr h, uint flags) { return h; }
        static bool IsHungAppWindow(IntPtr h) { Win w = Find(h); return w != null && w.Hung; }
        static uint GetWindowThreadProcessId(IntPtr h, out uint pid)
        {
            Win w = Find(h); pid = w == null ? 0u : w.Pid; return w == null ? 0u : w.Thread;
        }
        static bool AttachThreadInput(uint a, uint b, bool on)
        {
            if (a == 0 || b == 0 || a == b) return false;
            if (on) { Joined.Add(b); EverJoined.Add(b); } else Joined.Remove(b);
            return true;
        }
        static bool BringWindowToTop(IntPtr h) { return true; }
        // A key from us is the last input, unless the window in front is one
        // our keys cannot reach (a program running as administrator).
        static void Key(ushort vk)
        {
            Keys++;
            Win f = Find(Foreground);
            LastInputOurs = !(f != null && f.Unreachable);
        }
        static bool SetForegroundWindow(IntPtr h)
        {
            Win target = Find(h); if (target == null) return false;
            Win f = Find(Foreground);
            bool allowed = Foreground == h
                || f == null
                || f.Pid == MyPid
                || Joined.Contains(f.Thread)
                || LastInputOurs;
            if (allowed) Foreground = h;
            return allowed;
        }

        // ---- lifted from launcher\app\Downgrade.cs ----
__LIFTED__
    }
}
'@
$body = New-Object System.Text.StringBuilder
foreach ($k in $lifted.Keys) { [void]$body.AppendLine($lifted[$k]) }
$probe = $probe.Replace('__LIFTED__', $body.ToString())

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-downgrade-front-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $asm = $null
    try { $asm = Add-LauncherType -Source $probe }
    catch { $out = $_.Exception.Message }
    Yes 'the lifted methods compile with the .NET SDK the launcher builds with against the stand-in desktop' ($null -ne $asm)
    if (-not $asm) { $out -split "`n" | ForEach-Object { Write-Host "      $_" }; Done }

    $T = $asm.GetType('Probe.Downgrade', $true)
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    function Call([string]$name, [object[]]$argv) { return $T.GetMethod($name, $flags).Invoke($null, $argv) }

    # Steam's window (steamwebhelper, thread 20), the launcher (thread 1 is its
    # worker, 41 its window), a browser (thread 30), a program running as
    # administrator (thread 60, our keys cannot reach it) and one that has
    # stopped answering (thread 70).
    function Desk([long]$front) {
        Call 'Reset' @() | Out-Null
        Call 'AddProcess' @(200, 'steamwebhelper') | Out-Null
        Call 'AddProcess' @(400, 'Thornswood') | Out-Null
        Call 'AddProcess' @(300, 'firefox') | Out-Null
        Call 'AddProcess' @(600, 'Taskmgr') | Out-Null
        Call 'AddProcess' @(700, 'notepad') | Out-Null
        Call 'AddWindow' @([long]0x21, 200, 20, $false, $false) | Out-Null
        Call 'AddWindow' @([long]0x41, 400, 41, $false, $false) | Out-Null
        Call 'AddWindow' @([long]0x31, 300, 30, $false, $false) | Out-Null
        Call 'AddWindow' @([long]0x61, 600, 60, $false, $true) | Out-Null
        Call 'AddWindow' @([long]0x71, 700, 70, $true, $true) | Out-Null
        Call 'SetForeground' @($front) | Out-Null
    }
    $steam = [IntPtr]::new(0x21)
    function Front { return [long](Call 'GetForeground' @()) }

    # 1. Part 1: the launcher is in front, its button just pressed.
    Desk 0x41
    Call 'BringToFront' @($steam) | Out-Null
    Yes 'part 1, with the launcher in front: Steam comes forward' ((Front) -eq 0x21)

    # 2. Steam is already in front.
    Desk 0x21
    Call 'BringToFront' @($steam) | Out-Null
    Yes 'Steam already in front stays there, and nobody else is joined' ((Front) -eq 0x21 -and -not (Call 'EverJoinedThread' @(30)))

    # 3. A later part, the person in a browser: the Alt tap is enough.
    Desk 0x31
    Call 'BringToFront' @($steam) | Out-Null
    Yes 'a later part with a browser in front: Steam comes forward' ((Front) -eq 0x21)

    # 4. The tester's case as far as it can be known: a later part, with a
    #    window in front our keys cannot reach.
    Desk 0x61
    Call 'BringToFront' @($steam) | Out-Null
    Yes 'a later part with a window our keys cannot reach in front: Steam comes forward' ((Front) -eq 0x21)
    Yes 'by joining the thread of the window in front' (Call 'EverJoinedThread' @(60))
    Yes 'and every thread joined is let go again' ((Call 'JoinedCount' @()) -eq 0)

    # 5. A window that has stopped answering is never joined.
    Desk 0x71
    Call 'BringToFront' @($steam) | Out-Null
    Yes 'a hung window in front is never joined, so this thread cannot hang with it' (-not (Call 'EverJoinedThread' @(70)))
    Yes 'and Steam is not claimed to be in front when it is not' (-not [bool](Call 'SteamInFront' @($steam)))

    # 6. What the log says.
    Desk 0x61
    Yes 'InFront names the program in front' ((Call 'InFront' @()) -eq 'Taskmgr')
    Call 'SetForeground' @([long]0) | Out-Null
    Yes 'and says so when nothing is in front, as on a locked screen' ((Call 'InFront' @()) -match 'no window')
    Call 'SetForeground' @([long]0x99) | Out-Null
    Yes 'and does not throw for a window whose program cannot be read' ((Call 'InFront' @()) -is [string])
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
