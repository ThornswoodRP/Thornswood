<#
  test-downgrade-steam-window.ps1

      pwsh -NoProfile -File .\tests\test-downgrade-steam-window.ps1

  The Downgrade button finds Steam's window when steamwebhelper draws it, and
  the clipboard fallback says which part of three is on the clipboard.

  WHY THIS EXISTS. Patrick, 24 September, with a tester's screenshot on the
  main build (launcher 1.1.91, Skyrim 1.7.104): "downgrader still isnt
  working, its not going into the console by itself its going to your
  clipboard and it only give you the fiurst one to yuor clipboards and not all
  of them". The screenshot had Steam's console open behind the launcher, the
  card at "Part 1 of 3: 7,145 MB down so far", and the log line saying Steam's
  window would not come to the front.

  Two causes, both in launcher\app\Downgrade.cs:

    1. Steam's window was looked for only among processes named steam, and
       Steam counted as in front only when the foreground window's process
       was named steam. Measured on Patrick's machine the same day, read only,
       with Steam in the tray: the window titled "Steam" (class SDL_app,
       2308 x 927) belongs to steamwebhelper.exe, and steam.exe owns three
       small vguiPopupWindows (two of 43 x 16, one of 149 x 77) and its input
       method window, nothing else. So the real window never counted, and
       every part went to the clipboard.
    2. The parts go one at a time, each command put on the clipboard only when
       the part before it is down, and nothing on screen said so.

  HOW. Nothing here opens Steam, focuses a window or sends a key: Downgrade
  drives another program's window, and keys sent to the wrong one land
  somewhere else on the person's desktop. So the real methods are lifted out
  of Downgrade.cs by brace match and compiled, with the .NET SDK the
  launcher builds with (tests\Launcher-Csc.ps1), into a class whose EnumWindows,
  GetForegroundWindow, Process and clipboard are stand-ins for a made-up
  desktop. What is driven is the shipped text of ForegroundIsSteam,
  MainWindow and the clipboard lines, not a copy of them.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$AppPath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
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

# ---- lifting the real text ---------------------------------------------------
#
# From the start of the line the signature is on to the brace that closes it.
# Strings, characters and comments are stepped over, so a brace inside one of
# them cannot end the method early.
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
                # A field initialiser ends in "};", and the semicolon comes too.
                if ($end -lt $all.Length -and $all[$end] -eq ';') { $end++ }
                return $all.Substring($lineStart, $end - $lineStart)
            }
        }
        $i++
    }
    return $null
}

$wanted = [ordered]@{
    'ForegroundIsSteam' = 'static bool ForegroundIsSteam()'
    'SteamInFront'      = 'static bool SteamInFront(IntPtr h)'
    'MainWindow'        = 'static IntPtr MainWindow()'
    'WindowSearch'      = 'sealed class WindowSearch'
    # The callback EnumWindows calls, from its attribute on (#4823).
    'OnWindow'          = '[UnmanagedCallersOnly]'
    'IsSteam'           = 'static bool IsSteam(string processName)'
    'SteamNames'        = 'static readonly string[] SteamNames ='
    'SayWindow'         = 'static void SayWindow(IntPtr h, Action<string> log)'
    'WindowWords'       = 'static string WindowWords(IntPtr h)'
    'OnClipboard'       = 'static void OnClipboard(string cmd, int part, string why, Action<string> log, Action<string> status)'
    'ClipboardLine'     = 'static string ClipboardLine(int part, int of)'
    'TypeItLine'        = 'static string TypeItLine(string cmd, int part, int of)'
    'ProgressLine'      = 'static string ProgressLine(int part, int of, long bytes, bool pasted)'
    'Next'              = 'static string Next(int part, int of)'
    'Parts'             = 'static string Parts(int from, int to, string one, string many)'
    'FallbackDepots'    = 'static readonly string[][] FallbackDepots ='
    'Command'           = 'static string Command(string[] depot)'
}
$lifted = [ordered]@{}
foreach ($k in $wanted.Keys) {
    $m = Get-Member $text $wanted[$k]
    Yes ("Downgrade.cs has {0}" -f $k) ($null -ne $m)
    if ($null -ne $m) { $lifted[$k] = $m }
}
$said = [regex]::Match($text, '(?m)^\s*static string saidWindow;\s*$')
Yes 'Downgrade.cs keeps the window it last named in saidWindow' $said.Success
$appId = [regex]::Match($text, '(?m)^\s*const int AppId = \d+;\s*$')
Yes 'Downgrade.cs has AppId' $appId.Success

# ---- the stand-in desktop ----------------------------------------------------
$probe = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Probe
{
    // Stands in for System.Diagnostics.Process, which the lifted text names.
    // GetProcessesByName matches without regard to case, as the real one does,
    // and GetProcessById throws for a process that is not there, as the real
    // one does.
    public class Process
    {
        public int Id;
        public string ProcessName;
        public static List<Process> All = new List<Process>();
        public static Process[] GetProcessesByName(string name)
        {
            var o = new List<Process>();
            foreach (Process p in All) if (string.Equals(p.ProcessName, name, StringComparison.OrdinalIgnoreCase)) o.Add(p);
            return o.ToArray();
        }
        public static Process GetProcessById(int id)
        {
            foreach (Process p in All) if (p.Id == id) return p;
            throw new ArgumentException("Process with an Id of " + id + " is not running.");
        }
    }

    // Stands in for launcher\app\Swallow.cs, which the lifted text calls from
    // its catch blocks since the silent catches were given a log line.
    static class Swallow
    {
        public static List<string> Notes = new List<string>();
        public static void Note(string where, Exception e) { Notes.Add(where + ": " + e.Message); }
    }

    public class Win
    {
        public IntPtr Handle; public uint Pid; public bool Visible; public int Width, Height; public string Title; public IntPtr Root;
    }

    public static class Downgrade
    {
        public static List<Win> Desktop = new List<Win>();
        public static IntPtr Foreground = IntPtr.Zero;
        public static List<string> Clipboard = new List<string>();
        public static int Flashes;

        public static void Reset()
        {
            Process.All.Clear(); Desktop.Clear(); Foreground = IntPtr.Zero; Clipboard.Clear(); Flashes = 0; ClipboardTakes = true;
            System.Reflection.FieldInfo f = typeof(Downgrade).GetField("saidWindow", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            if (f != null) f.SetValue(null, null);
        }
        public static void AddProcess(int id, string name) { var p = new Process(); p.Id = id; p.ProcessName = name; Process.All.Add(p); }
        public static void AddWindow(long h, int pid, bool visible, int width, int height, string title)
        {
            var w = new Win(); w.Handle = new IntPtr(h); w.Pid = (uint)pid; w.Visible = visible; w.Width = width; w.Height = height; w.Title = title;
            Desktop.Add(w);
        }
        public static void SetForeground(long h) { Foreground = new IntPtr(h); }
        // A window inside another: GetAncestor(GA_ROOT) answers the outer one.
        public static void SetRoot(long h, long root) { Win w = Find(new IntPtr(h)); if (w != null) w.Root = new IntPtr(root); }

        static Win Find(IntPtr h) { foreach (Win w in Desktop) if (w.Handle == h) return w; return null; }

        public struct RECT { public int Left, Top, Right, Bottom; }
        // Calls the lifted OnWindow through the same function pointer the
        // real EnumWindows is handed, once a window, until it answers 0.
        static unsafe int EnumWindows(delegate* unmanaged<IntPtr, IntPtr, int> cb, IntPtr l) { foreach (Win w in Desktop.ToArray()) if (cb(w.Handle, l) == 0) break; return 1; }
        static bool IsWindowVisible(IntPtr h) { Win w = Find(h); return w != null && w.Visible; }
        static uint GetWindowThreadProcessId(IntPtr h, out uint pid) { Win w = Find(h); pid = w == null ? 0u : w.Pid; return w == null ? 0u : 1u; }
        static bool GetWindowRect(IntPtr h, out RECT r)
        {
            r = new RECT(); Win w = Find(h); if (w == null) return false;
            r.Left = 40; r.Top = 30; r.Right = 40 + w.Width; r.Bottom = 30 + w.Height; return true;
        }
        static IntPtr GetForegroundWindow() { return Foreground; }
        const uint GA_ROOT = 2;
        static IntPtr GetAncestor(IntPtr h, uint flags) { Win w = Find(h); return (w != null && w.Root != IntPtr.Zero) ? w.Root : h; }
        // The real one tries a few times and reads the text back, because
        // Clipboard.SetText fails while another program has the clipboard
        // open. Here it is a switch: ClipboardTakes false is a clipboard that
        // would not take the command.
        public static bool ClipboardTakes = true;
        static bool TryClipboard(string text) { if (!ClipboardTakes) return false; Clipboard.Add(text); return true; }
        static void FlashLauncher() { Flashes++; }

        // ---- lifted from launcher\app\Downgrade.cs ----
__LIFTED__
        // What Run sets from PinnedDepots; a feed with no pin leaves the fallback (#471).
        static string[][] Depots = FallbackDepots;
    }
}
'@
$body = New-Object System.Text.StringBuilder
foreach ($k in $lifted.Keys) { [void]$body.AppendLine($lifted[$k]) }
if ($said.Success) { [void]$body.AppendLine($said.Value) }
if ($appId.Success) { [void]$body.AppendLine($appId.Value) }
$probe = $probe.Replace('__LIFTED__', $body.ToString())

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-downgrade-window-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $asm = $null
    try { $asm = Add-LauncherType -Source $probe }
    catch { $out = $_.Exception.Message }
    Yes 'the lifted methods compile with the .NET SDK the launcher builds with against the stand-in desktop' ($null -ne $asm)
    if (-not $asm) { $out -split "`n" | ForEach-Object { Write-Host "      $_" }; Done }

    $T = $asm.GetType('Probe.Downgrade', $true)
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    function Call([string]$name, [object[]]$argv) {
        $m = $T.GetMethod($name, $flags)
        if (-not $m) { return $null }
        return $m.Invoke($null, $argv)
    }
    function Has([string]$name) { return [bool]$T.GetMethod($name, $flags) }
    function Hwnd($r) { if ($null -eq $r) { return -1 }; return ([IntPtr]$r).ToInt64() }

    # ---- the tester's desktop, shaped like the one measured on 24 Sep ---------
    # steam.exe with two of its small popups, one of them showing; steamwebhelper
    # with the "Steam" window, its Menu, and a bigger window that is hidden;
    # another helper with a visible 0 x 0; and two windows that are not Steam's
    # and are bigger than all of them.
    function Measured {
        Call 'Reset' @() | Out-Null
        Call 'AddProcess' @(100, 'steam') | Out-Null
        Call 'AddProcess' @(200, 'steamwebhelper') | Out-Null
        Call 'AddProcess' @(201, 'steamwebhelper') | Out-Null
        Call 'AddProcess' @(300, 'explorer') | Out-Null
        Call 'AddProcess' @(400, 'Thornswood') | Out-Null
        Call 'AddWindow' @([long]0x11, 100, $true, 43, 16, '') | Out-Null
        Call 'AddWindow' @([long]0x12, 100, $false, 149, 77, 'Untitled') | Out-Null
        Call 'AddWindow' @([long]0x41, 300, $true, 3840, 2160, 'Program Manager') | Out-Null
        Call 'AddWindow' @([long]0x22, 200, $true, 217, 303, 'Menu') | Out-Null
        Call 'AddWindow' @([long]0x21, 200, $true, 2308, 927, 'Steam') | Out-Null
        Call 'AddWindow' @([long]0x23, 200, $false, 3000, 2000, '') | Out-Null
        Call 'AddWindow' @([long]0x31, 201, $true, 0, 0, '') | Out-Null
        Call 'AddWindow' @([long]0x51, 400, $true, 1400, 900, 'Thornswood') | Out-Null
    }

    # ---- which window is Steam's ----------------------------------------------
    Measured
    Yes 'MainWindow picks the window steamwebhelper draws, "Steam", 2308 x 927' ((Hwnd (Call 'MainWindow' @())) -eq 0x21)

    Call 'Reset' @() | Out-Null
    Call 'AddProcess' @(100, 'steam') | Out-Null
    Call 'AddProcess' @(200, 'steamwebhelper') | Out-Null
    Call 'AddWindow' @([long]0x61, 200, $true, 300, 200, 'Friends List') | Out-Null
    Call 'AddWindow' @([long]0x62, 100, $true, 1280, 800, 'Steam') | Out-Null
    Yes 'where steam.exe draws the main window, as it did on 17 Sep, that one is still found' ((Hwnd (Call 'MainWindow' @())) -eq 0x62)

    Call 'Reset' @() | Out-Null
    Call 'AddProcess' @(200, 'SteamWebHelper') | Out-Null
    Call 'AddWindow' @([long]0x71, 200, $true, 1024, 700, 'Steam') | Out-Null
    Yes 'the process name is matched without regard to case' ((Hwnd (Call 'MainWindow' @())) -eq 0x71)

    Call 'Reset' @() | Out-Null
    Call 'AddProcess' @(100, 'steam') | Out-Null
    Call 'AddProcess' @(200, 'steamwebhelper') | Out-Null
    Call 'AddWindow' @([long]0x81, 200, $false, 2308, 927, 'Steam') | Out-Null
    Call 'AddWindow' @([long]0x82, 100, $false, 43, 16, '') | Out-Null
    Yes 'with Steam in the tray and nothing of it showing, nothing is found, so nothing is clicked' ((Hwnd (Call 'MainWindow' @())) -eq 0)

    Call 'Reset' @() | Out-Null
    Call 'AddProcess' @(300, 'explorer') | Out-Null
    Call 'AddProcess' @(500, 'steamservice') | Out-Null
    Call 'AddProcess' @(501, 'steamerrorreporter') | Out-Null
    Call 'AddWindow' @([long]0x91, 300, $true, 3840, 2160, 'Program Manager') | Out-Null
    Call 'AddWindow' @([long]0x92, 501, $true, 600, 400, 'Steam - Error') | Out-Null
    Yes 'with no steam or steamwebhelper running, nothing is found, not even a window of another steam-something' ((Hwnd (Call 'MainWindow' @())) -eq 0)

    # ---- whether Steam is in front --------------------------------------------
    # Nothing is clicked or typed unless this says yes, so both directions matter.
    Measured
    $fg = @(
        @{ H = 0x21; Want = $true;  What = "a foreground window drawn by steamwebhelper counts as Steam's" },
        @{ H = 0x22; Want = $true;  What = "so does steamwebhelper's Menu, as a popup of steam.exe did before" },
        @{ H = 0x11; Want = $true;  What = "a foreground window of steam.exe still counts as Steam's" },
        @{ H = 0x51; Want = $false; What = 'the launcher in front does not count as Steam' },
        @{ H = 0x41; Want = $false; What = 'the desktop in front does not count as Steam' },
        @{ H = 0x00; Want = $false; What = 'no foreground window at all does not count as Steam' }
    )
    foreach ($c in $fg) {
        Call 'SetForeground' @([long]$c.H) | Out-Null
        Yes $c.What ([bool](Call 'ForegroundIsSteam' @()) -eq $c.Want)
    }
    Call 'AddWindow' @([long]0xA1, 999, $true, 800, 600, 'Steam') | Out-Null
    Call 'SetForeground' @([long]0xA1) | Out-Null
    Yes 'a foreground window whose process has gone is not Steam, and nothing throws' (-not [bool](Call 'ForegroundIsSteam' @()))
    foreach ($name in @('steamservice', 'steamerrorreporter', 'steamwebhelper2', 'notsteam', 'Steam Deck')) {
        Call 'AddProcess' @(600, $name) | Out-Null
        Call 'AddWindow' @([long]0xB1, 600, $true, 800, 600, 'Steam') | Out-Null
        Call 'SetForeground' @([long]0xB1) | Out-Null
        Yes ("a window of a process named {0} does not count as Steam's" -f $name) (-not [bool](Call 'ForegroundIsSteam' @()))
        Measured
    }
    # Review, 24 September: any steamwebhelper window counting as Steam's let a
    # Friends list, chat or sign-in window in front take the keys, and a chat
    # would have sent the download_depot line to a friend.
    if (Has 'SteamInFront') {
        Call 'Reset' @() | Out-Null
        Call 'AddProcess' @(700, 'steamwebhelper') | Out-Null
        Call 'AddWindow' @([long]0x71, 700, $true, 2308, 927, 'Steam') | Out-Null
        Call 'AddWindow' @([long]0x72, 700, $true, 300, 600, 'Friends List') | Out-Null
        Call 'AddWindow' @([long]0x73, 700, $true, 400, 30, '') | Out-Null
        Call 'SetRoot' @([long]0x73, [long]0x71) | Out-Null
        Call 'SetForeground' @([long]0x71) | Out-Null
        Yes "Steam's own window in front is Steam in front" ([bool](Call 'SteamInFront' @([IntPtr]0x71)))
        Call 'SetForeground' @([long]0x73) | Out-Null
        Yes 'and so is a window inside it' ([bool](Call 'SteamInFront' @([IntPtr]0x71)))
        Call 'SetForeground' @([long]0x72) | Out-Null
        Yes 'but the Friends list or a chat in front is not, though steamwebhelper draws it too' (-not [bool](Call 'SteamInFront' @([IntPtr]0x71)))
        Call 'SetForeground' @([long]0x71) | Out-Null
        Yes 'and no window at all is never in front' (-not [bool](Call 'SteamInFront' @([IntPtr]::Zero)))
    }
    if (Has 'IsSteam') {
        Yes 'IsSteam takes steam and steamwebhelper in any case, and nothing else' (
            (Call 'IsSteam' @('steam')) -and (Call 'IsSteam' @('STEAM')) -and (Call 'IsSteam' @('steamwebhelper')) -and
            (Call 'IsSteam' @('SteamWebHelper')) -and -not (Call 'IsSteam' @('steamservice')) -and -not (Call 'IsSteam' @('')) -and
            -not (Call 'IsSteam' @($null)))
    }

    # ---- the log says which window it found, once ------------------------------
    $lines = New-Object System.Collections.Generic.List[string]
    $log = [Action[string]]{ param($s) $lines.Add($s) }
    if (Has 'SayWindow') {
        Measured
        Call 'SayWindow' @([IntPtr]0x21, $log) | Out-Null
        Call 'SayWindow' @([IntPtr]0x21, $log) | Out-Null
        Call 'SayWindow' @([IntPtr]0x21, $log) | Out-Null
        Yes 'the window found is named in the log once, however many times it is found' ($lines.Count -eq 1)
        $l = if ($lines.Count) { $lines[0] } else { '' }
        Yes ('the line names the process, its number and the size: ' + $l) (
            $l -like '*steamwebhelper, process 200*' -and $l -like '*2308 x 927*')
        # Never the title (#3627): a Steam chat window is titled with a friend's
        # name, and launcher.log goes up with the session's logs.
        Yes 'the line never carries the window''s title' ($l -notlike '*Steam"*' -and $l -notlike '*titled*')
        Call 'SayWindow' @([IntPtr]0x11, $log) | Out-Null
        Yes 'a different window found later is named too' ($lines.Count -eq 2 -and $lines[1] -like '*steam, process 100*')
        Call 'AddWindow' @([long]0xA1, 999, $true, 800, 600, 'Steam') | Out-Null
        $threw = $false
        try { Call 'SayWindow' @([IntPtr]0xA1, $log) | Out-Null } catch { $threw = $true }
        Yes 'a window whose process has gone is named by its number, and nothing throws' (-not $threw -and $lines.Count -eq 3 -and $lines[2] -like '*process 999*')
        Call 'Reset' @() | Out-Null
        $lines.Clear()
        Call 'AddProcess' @(200, 'steamwebhelper') | Out-Null
        Call 'AddWindow' @([long]0x21, 200, $true, 2308, 927, 'Steam') | Out-Null
        Call 'SayWindow' @([IntPtr]0x21, $log) | Out-Null
        Yes 'a new run names the same window again' ($lines.Count -eq 1)
    }

    # ---- what the clipboard fallback says --------------------------------------
    $words = @()
    if (Has 'ClipboardLine') {
        $c1 = [string](Call 'ClipboardLine' @(1, 3))
        $c2 = [string](Call 'ClipboardLine' @(2, 3))
        $c3 = [string](Call 'ClipboardLine' @(3, 3))
        $words += $c1, $c2, $c3
        Yes ('part 1, word for word as the entry asked: ' + $c1) ($c1 -ceq "Part 1 of 3 is on your clipboard: click in Steam's console command line, press Ctrl+V and Enter. Parts 2 and 3 follow here when it is down.")
        Yes ('part 2 says part 1 is down, that part 2 of 3 is on the clipboard now, and that part 3 follows: ' + $c2) (
            $c2.StartsWith('Part 1 is down. ') -and $c2.Contains('Part 2 of 3 is on your clipboard now') -and $c2.Contains('Ctrl+V') -and $c2.EndsWith('Part 3 follows here when it is down.'))
        Yes ('part 3 says parts 1 and 2 are down and that it is the last: ' + $c3) (
            $c3.StartsWith('Parts 1 and 2 are down. ') -and $c3.Contains('Part 3 of 3 is on your clipboard now') -and $c3.EndsWith('It is the last one.'))
    }
    if (Has 'ProgressLine') {
        $mb = [long]7145
        $n = $mb.ToString('n0')
        $old = "Part 1 of 3: $n MB down so far (Steam shows the rest in its console)"
        $p1 = [string](Call 'ProgressLine' @(1, 3, [long]($mb * 1048576), $false))
        Yes 'a part that was typed shows the line it always did' ($p1 -ceq $old)
        Yes 'and so does one that has not started' (([string](Call 'ProgressLine' @(1, 3, [long]0, $false))) -ceq 'Part 1 of 3: 0 MB down so far (Steam shows the rest in its console)')
        $p0 = [string](Call 'ProgressLine' @(1, 3, [long]0, $true))
        Yes 'a part on the clipboard with nothing down yet keeps the paste on the card' ($p0 -ceq [string](Call 'ClipboardLine' @(1, 3)))
        $pp = [string](Call 'ProgressLine' @(1, 3, [long]($mb * 1048576), $true))
        $words += $pp
        Yes ('once it is coming down, the card says what follows: ' + $pp) ($pp -ceq ($old + '. Parts 2 and 3 follow here when it is down.'))
        $p3 = [string](Call 'ProgressLine' @(3, 3, [long]($mb * 1048576), $true))
        Yes 'and for part 3, that it is the last' ($p3.EndsWith('. It is the last one.'))
    }
    if (Has 'Parts') {
        Yes 'Parts counts past three the same way' (([string](Call 'Parts' @(2, 5, 'follows.', 'follow.'))) -ceq 'Parts 2 to 5 follow.')
    }

    # All three parts falling back, the way Run hands them over: each command
    # goes on the clipboard in turn, and each time the log, the card and the
    # launcher's taskbar button say so.
    if ((Has 'OnClipboard') -and (Has 'Command')) {
        Call 'Reset' @() | Out-Null
        $lines.Clear()
        $cards = New-Object System.Collections.Generic.List[string]
        $status = [Action[string]]{ param($s) $cards.Add($s) }
        $depots = $T.GetField('Depots', $flags).GetValue($null)
        $cmds = @()
        for ($i = 0; $i -lt $depots.Length; $i++) {
            $cmd = [string](Call 'Command' @(, [string[]]$depots[$i]))
            $cmds += $cmd
            $why = if ($i -eq 0) { "Steam's window would not come to the front, so nothing was typed. " } else { '' }
            Call 'OnClipboard' @($cmd, ($i + 1), $why, $log, $status) | Out-Null
        }
        $clip = $T.GetField('Clipboard').GetValue($null)
        Yes 'every part of three goes on the clipboard, in order, not only the first' (
            $clip.Count -eq 3 -and $clip[0] -ceq $cmds[0] -and $clip[1] -ceq $cmds[1] -and $clip[2] -ceq $cmds[2])
        Yes 'and they are the three download_depot lines' ($cmds.Count -eq 3 -and $cmds[0] -like 'download_depot 489830 489831 *' -and $cmds[2] -like 'download_depot 489830 489833 *')
        Yes 'each one leaves one line in the log naming its part of three' (
            $lines.Count -eq 3 -and $lines[0].Contains('Part 1 of 3') -and $lines[1].Contains('Part 2 of 3') -and $lines[2].Contains('Part 3 of 3'))
        Yes 'the first log line still says why nothing was typed, then what to do' (
            $lines.Count -ge 1 -and $lines[0].StartsWith("Steam's window would not come to the front, so nothing was typed. Part 1 of 3 is on your clipboard"))
        Yes 'and every one says the launcher keeps watching' (@($lines | Where-Object { $_.EndsWith('This keeps watching for it.') }).Count -eq 3)
        Yes 'each one puts its part of three on the card' (
            $cards.Count -eq 3 -and $cards[0] -ceq [string](Call 'ClipboardLine' @(1, 3)) -and $cards[1] -ceq [string](Call 'ClipboardLine' @(2, 3)) -and $cards[2] -ceq [string](Call 'ClipboardLine' @(3, 3)))
        Yes "each one flashes the launcher's taskbar button so the person notices" ([int]$T.GetField('Flashes').GetValue($null) -eq 3)
        $words += $lines

        # A clipboard that will not take the command. Clipboard.SetText fails
        # while another program has the clipboard open, and the card used to
        # say "press Ctrl+V" all the same, so following it pasted whatever was
        # on the clipboard before, the part before this one for one, into
        # Steam's console.
        Call 'Reset' @() | Out-Null
        $T.GetField('ClipboardTakes').SetValue($null, $false)
        $lines.Clear()
        $cards = New-Object System.Collections.Generic.List[string]
        $status = [Action[string]]{ param($s) $cards.Add($s) }
        $cmd2 = [string](Call 'Command' @(, [string[]]$depots[1]))
        Call 'OnClipboard' @($cmd2, 2, '', $log, $status) | Out-Null
        $refused = if ($cards.Count -gt 0) { [string]$cards[0] } else { '' }
        $words += $refused
        Yes 'a clipboard that refuses the command is never called a clipboard that took it' ($refused -notmatch 'Ctrl\+V' -and $refused -notmatch 'on your clipboard')
        Yes ('it gives the command to type instead, and where: ' + $refused) (
            $refused -ceq [string](Call 'TypeItLine' @($cmd2, 2, 3)) -and
            $refused.Contains('the command line at the bottom of Steam') -and $refused.StartsWith('Part 1 is down. ') -and
            $refused.Contains('Part 3 follows here when it is down.') -and $refused.EndsWith($cmd2))
        Yes 'and nothing was left on the clipboard for a Ctrl+V to find' (([System.Collections.Generic.List[string]]$T.GetField('Clipboard').GetValue($null)).Count -eq 0)
        Yes 'and the log says the same as the card' ($lines.Count -eq 1 -and $lines[0].StartsWith($refused))
        $T.GetField('ClipboardTakes').SetValue($null, $true)
    }
    # The en and em dash built from their codes, so this file stays ASCII and
    # reads the same in Windows PowerShell 5.1, which takes a file without a
    # BOM as ANSI.
    $dash = '[' + [char]0x2013 + [char]0x2014 + ']'
    foreach ($w in $words) {
        if ($w -match '(?i)player' -or $w -match $dash) { Yes ('no "player" and no dash in: ' + $w) $false }
    }
    Yes 'the words the person reads have no "player" and no em or en dash' ($words.Count -gt 0 -and -not ($words | Where-Object { $_ -match '(?i)player' -or $_ -match $dash }))
    Yes 'and the dash check itself catches a dash' ((([string][char]0x2014) -match $dash) -and (([string][char]0x2013) -match $dash) -and -not ('-' -match $dash))
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- how Run and TypeIntoConsole use them ------------------------------------
$run = Get-Member $text 'static bool Run(Config cfg, Action<string> log, Action<string> status)'
Yes 'Run is found' ($null -ne $run)
if ($run) {
    Yes 'Run puts nothing on the clipboard by itself: both fallbacks go through OnClipboard' ($run -notmatch 'TryClipboard\(')
    Yes 'both fallbacks name their part' (([regex]::Matches($run, 'OnClipboard\(cmd, i \+ 1, ')).Count -eq 2)
    Yes 'the second fallback marks the part as pasted, so the card keeps saying so' ($run -match 'OnClipboard\(cmd, i \+ 1, "", log, status\);\s*pasted = true;')
    # Through SizedLine since 24 September, which adds Steam's size for the part
    # once Steam has given it and otherwise hands back ProgressLine's line, so
    # a part on the clipboard still says so.
    Yes 'the line on the card while a part downloads comes from SizedLine' ($run -match 'status\(SizedLine\(i \+ 1, Depots\.Length, size, total, pasted\)\);')
    $sized = Get-Member $text 'static string SizedLine(int part, int of, long bytes, long total, bool pasted)'
    Yes 'and SizedLine hands back ProgressLine''s line with no size or with nothing down on the clipboard' ($null -ne $sized -and $sized -match 'if \(total <= 0 \|\| \(pasted && bytes <= 0\)\) return ProgressLine\(part, of, bytes, pasted\);')
    Yes 'a new run forgets the window the last one named' ($run -match 'saidWindow = null;')
}
$type = Get-Member $text 'static bool TypeIntoConsole(string cmd, Action<string> log)'
Yes 'TypeIntoConsole is found' ($null -ne $type)
if ($type) {
    Yes 'TypeIntoConsole names the window it found before bringing it forward' ($type -match 'if \(h == IntPtr\.Zero\) continue;\s*SayWindow\(h, log\);\s*BringToFront\(h\);')
    # The trap in the entry: never type or click unless Steam's window is
    # really in front, exactly as before. Three checks, and the click and the
    # keys each come after one.
    Yes 'Steam being in front is still checked three times, each time for the window brought forward' (([regex]::Matches($type, 'SteamInFront\(h\)')).Count -eq 3)
    Yes 'and the click goes to that same window' ($type -match 'ClickCommandLine\(h\);')
    # Right after one: nothing but comments and Thread.Sleep between the check
    # and the click, and between the next check and the keys.
    function Guarded([string]$in, [string]$act) {
        $check = 'if (!SteamInFront(h)) return false;'
        $iAct = $in.IndexOf($act)
        if ($iAct -lt 0) { return $false }
        $iChk = $in.LastIndexOf($check, $iAct)
        if ($iChk -lt 0) { return $false }
        $between = $in.Substring($iChk + $check.Length, $iAct - $iChk - $check.Length)
        $between = [regex]::Replace($between, '//[^\n]*', '')
        $between = [regex]::Replace($between, 'Thread\.Sleep\(\d+\);', '')
        return ($between.Trim() -eq '')
    }
    Yes 'the click comes straight after a check that Steam is in front' (Guarded $type 'ClickCommandLine(')
    Yes 'and the keys come straight after another' (Guarded $type 'Chord(')
    Yes 'and the two checks are not the same one' ($type.LastIndexOf('if (!SteamInFront(h)) return false;', $type.IndexOf('Chord(')) -gt $type.IndexOf('ClickCommandLine('))
}
$flash = Get-Member $text 'static void FlashLauncher()'
Yes 'FlashLauncher is found' ($null -ne $flash)
if ($flash) {
    Yes "it flashes the launcher's own window" ($flash -match 'Process\.GetCurrentProcess\(\)\.MainWindowHandle' -and $flash -match 'FlashWindowEx\(ref f\)')
    Yes 'until the person comes back to it' ($flash -match 'FLASHW_TIMERNOFG')
    Yes 'and it takes nothing from Steam: no foreground change, no input' ($flash -notmatch 'SetForegroundWindow|BringWindowToTop|SendInput|Key\(|Type\(|Mouse\(')
    Yes 'a failure is logged, not swallowed' ($flash -match 'catch \(Exception ex\) \{ Swallow\.Note\("Downgrade\.FlashLauncher", ex\); \}')
}

Done
