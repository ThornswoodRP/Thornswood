<#
  test-4726-window-before-server.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4726-window-before-server.ps1

  WHY THIS EXISTS. Issue #4726. On every start the launcher asked the game
  server for its plugin list and read every plugin's bytes before its window
  was first drawn, so with the server slow or down there was nothing on screen
  for seconds. Cause: Shell.Run called RunScan before win.Show, and OffThread
  (Waiting.cs) runs its work on the calling thread until the window is up, so
  the server's wait was spent on the window's thread with no window. Now the
  check starts once the window has drawn (Shell.StartupCheck, from
  ContentRendered), the status line says it is checking, and the launcher log
  says when the window and the first status came, once each.

  What it checks:
    1. In Shell.Run (source): nothing that asks the server runs on Run's own
       path. RunScan, RunScanAsync, Verify.Run and StartupCheck appear only
       inside the ContentRendered delegate, and the status line says it is
       checking before win.Show.
    2. The start, run: Shell.Run's steps are read from the real Shell.cs in
       the order it has them and replayed against the real Waiting.cs
       (OffThread, Begin), the real RunScan and RunScanAsync from
       ShellScanFix.cs and the real StartupCheck, LogStartTime, SinceStart
       and LogFirstStatus from Shell.cs, with a stand-in window and the server
       stubbed. Twice: a server that never answers until the harness lets it
       time out, and one that refuses at once. Each time the window is shown
       before the server is asked, the server is never asked from the
       window's thread, the first frame is handled while the server still
       has not answered, the failure is said and the start goes on to its
       status, and the window line and the first status line are each
       written once, the second with the mod check's time.
    3. The weekly reader (scripts\vps\Read-LauncherStarts.ps1, read only,
       not changed) still reads the window line, and does not mistake the
       first status line for a start.

  Fails on main: Run calls RunScan before win.Show, so the stubbed server is
  asked on the window's thread before anything is shown.

  Nothing connects anywhere and nothing is written outside memory.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$App = Join-Path $Repo 'launcher/app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Src([string]$name) { return ([IO.File]::ReadAllText((Join-Path $App $name))).Replace("`r`n", "`n") }

# The brace-matched block that starts at the first { at or after $from.
function Block([string]$text, [int]$from) {
    $open = $text.IndexOf('{', $from)
    if ($open -lt 0) { return $null }
    $depth = 0
    for ($i = $open; $i -lt $text.Length; $i++) {
        $c = $text[$i]
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return @{ Open = $open; Close = $i } } }
    }
    return $null
}
# A whole member, from its signature to its closing brace, or '' when it is not there.
function Member([string]$text, [string]$signature) {
    $at = $text.IndexOf($signature)
    if ($at -lt 0) { return '' }
    $line = $text.LastIndexOf("`n", $at) + 1
    $b = Block $text $at
    if ($null -eq $b) { return '' }
    return $text.Substring($line, $b.Close - $line + 1)
}
# Code only: whole-line and trailing // comments and /* */ comments out, strings kept.
function Code([string]$text) {
    $t = [regex]::Replace($text, '(?s)/\*.*?\*/', ' ')
    return [regex]::Replace($t, '(?m)^\s*//.*$', '')
}

$shell = Src 'Shell.cs'
$scanFix = Src 'ShellScanFix.cs'
$waiting = Src 'Waiting.cs'

# ---- 1. Shell.Run, read -------------------------------------------------------------
Write-Host 'Shell.Run, read'
$runAt = $shell.IndexOf('static void Run(string[] args)')
Yes 'Shell.cs has Run' ($runAt -ge 0)
$runBlock = Block $shell $runAt
$run = Code ($shell.Substring($runBlock.Open, $runBlock.Close - $runBlock.Open + 1))
$rAt = $run.IndexOf('win.ContentRendered += delegate')
Yes 'Run hangs work off the first frame (win.ContentRendered)' ($rAt -ge 0)
$rBlock = Block $run $rAt
$rendered = $run.Substring($rBlock.Open, $rBlock.Close - $rBlock.Open + 1)
$top = $run.Substring(0, $rAt) + ' <<RENDERED>>; ' + $run.Substring($rBlock.Close + 1)
$asks = [regex]::Matches($top, '(?<![\w.])(RunScan|RunScanAsync|StartupCheck)\s*\(|Verify\.Run\s*\(')
$where = @($asks | ForEach-Object { $shell.Substring(0, $runBlock.Open).Split("`n").Count + $run.Substring(0, $_.Index).Split("`n").Count - 1 })
Yes ('nothing on Run''s own path asks the server: no RunScan, RunScanAsync, Verify.Run or StartupCheck outside the first frame' +
    $(if ($asks.Count) { ' (found ' + (($asks | ForEach-Object { $_.Value.Trim() }) -join ', ') + ' near Shell.cs line ' + ($where -join ', ') + ')' } else { '' })) ($asks.Count -eq 0)
Yes 'the first frame starts the mod check: Begin(StartupCheck())' ($rendered -match 'Begin\(StartupCheck\(\)\);')
$showAt = $top.IndexOf('win.Show();')
$sayAt = $top.IndexOf('Log("Checking your mods against the server.");')
Yes 'the status line says it is checking before the window is shown' ($sayAt -ge 0 -and $showAt -ge 0 -and $sayAt -lt $showAt)

# The steps the replay takes, in Run's own order.
$stepRx = '(?<![\w.])RunScan\(\);|Begin\(StartupCheck\(\)\);|Log\("Checking your mods against the server\."\);|win\.Show\(\);|<<RENDERED>>|(?<![\w.])LogStartTime\(\)'
function Steps([string]$text) {
    return [string[]]@([regex]::Matches($text, $stepRx) | ForEach-Object {
        switch -regex ($_.Value) {
            '^RunScan' { 'RunScan'; break }
            '^Begin' { 'StartupCheck'; break }
            '^LogStartTime' { 'LogStartTime'; break }
            '^Log\(' { 'Checking'; break }
            '^win' { 'Show'; break }
            '^<<' { 'Rendered'; break }
        }
    })
}
$topSteps = Steps $top
$renderedSteps = Steps $rendered
Write-Host ('      Run''s steps: ' + ($topSteps -join ', ') + '; on the first frame: ' + ($renderedSteps -join ', '))

# ---- 2. the start, run -----------------------------------------------------------------
Write-Host ''
Write-Host 'the start, run against a stubbed server'
$lift = New-Object System.Collections.Generic.List[string]
foreach ($sig in @('static void RunScan() {', 'static void RunScan(bool pressed) {', 'static async Task RunScanAsync(bool pressed)')) {
    $m = Member $scanFix $sig
    Yes ("ShellScanFix.cs has " + $sig.TrimEnd(' ', '{')) ($m.Length -gt 0)
    $lift.Add($m)
}
$shellLifts = @{}
foreach ($sig in @('static void LogStartTime()', 'static double SinceStart()', 'static void LogFirstStatus()', 'static async System.Threading.Tasks.Task StartupCheck()')) {
    $m = Member $shell $sig
    $shellLifts[$sig] = $m.Length -gt 0
    if ($m.Length) { $lift.Add($m) }
}
Yes 'Shell.cs has LogStartTime' ($shellLifts['static void LogStartTime()'])
Yes 'Shell.cs has StartupCheck, the mod check once the window is up' ($shellLifts['static async System.Threading.Tasks.Task StartupCheck()'])
Yes 'Shell.cs has LogFirstStatus, the first status line' ($shellLifts['static void LogFirstStatus()'])

$stubs = @'
// Fields the start's own methods use on one side of #4726 and not the other.
#pragma warning disable 0169, 0414, 0649
namespace Avalonia.Controls { class Unused { } }
namespace Avalonia.Input
{
    public enum StandardCursorType { Arrow, Wait }
    public class Cursor { public Cursor(StandardCursorType t) { Type = t; } public StandardCursorType Type; }
    public class InputElement { public bool IsEnabled = true; }
}
namespace Avalonia.Threading
{
    public enum DispatcherPriority { Background, ApplicationIdle, Normal }
    /// <summary>The window's thread: one queue, run by whoever pumps it on the thread that owns it.</summary>
    public class Dispatcher
    {
        public static readonly Dispatcher UIThread = new Dispatcher();
        public System.Threading.Thread Owner;
        readonly System.Collections.Generic.Queue<System.Action> q = new System.Collections.Generic.Queue<System.Action>();
        public bool CheckAccess() { return System.Threading.Thread.CurrentThread == Owner; }
        public void Post(System.Action a) { lock (q) q.Enqueue(a); }
        public void Post(System.Action a, DispatcherPriority p) { Post(a); }
        public bool RunOne()
        {
            System.Action a = null;
            lock (q) { if (q.Count > 0) a = q.Dequeue(); }
            if (a == null) return false;
            a();
            return true;
        }
        public void MainLoop(System.Threading.CancellationToken t) { while (!t.IsCancellationRequested) if (!RunOne()) System.Threading.Thread.Sleep(5); }
    }
    /// <summary>What Avalonia puts on its thread: an await there comes back there.</summary>
    public class UiContext : System.Threading.SynchronizationContext
    {
        public override void Post(System.Threading.SendOrPostCallback d, object s) { Dispatcher.UIThread.Post(delegate { d(s); }); }
    }
}
namespace Thornswood
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;
    using System.Reflection;
    using System.Threading;
    using System.Threading.Tasks;
    using Avalonia.Threading;

    public class MainWindow
    {
        public object Content = new Avalonia.Input.InputElement();
        public Avalonia.Input.Cursor Cursor;
        public bool IsVisible;
        public event EventHandler Opened;
        public void Show() { IsVisible = true; Model.Say("shown"); if (Opened != null) Opened(this, EventArgs.Empty); }
        public void Close() { IsVisible = false; }
    }
    public class Config { }
    public class Issue { }
    public static class Upkeep { public static void Look(Config c, bool pressed) { } }
    public static class Failure { public static string Say(string where, Exception e, string it = null) { return e.Message; } }
    public static class Swallow { public static void Note(string where, Exception e) { Model.Say("swallowed: " + where + ": " + e.Message); } }
    public static class Velo { public static bool Restarted; }
    public static class Updater { public static string Version = "9.9.9"; }

    /// <summary>The game server, stubbed: it never answers until let go, or it refuses at once.</summary>
    public static class Verify
    {
        public static List<Issue> Run(Config c)
        {
            Model.Say("server asked" + (Dispatcher.UIThread.CheckAccess() ? " on the window's thread" : ""));
            if (Model.Mode == "refuses") throw new IOException("No connection could be made because the target machine actively refused it.");
            bool let = Model.Answer.Wait(3000);
            Model.Say("server timed out" + (let ? "" : " (never let go by the harness)"));
            throw new TimeoutException("The server did not answer in time.");
        }
    }

    public static class Model
    {
        public static string Mode;
        public static ManualResetEventSlim Answer;
        static readonly List<string> said = new List<string>();
        public static void Say(string s) { lock (said) said.Add(s); }
        public static bool Has(string start) { lock (said) { foreach (string s in said) if (s.StartsWith(start, StringComparison.Ordinal)) return true; } return false; }
        public static string[] All() { lock (said) return said.ToArray(); }
        public static void Reset(string mode) { Mode = mode; Answer = new ManualResetEventSlim(false); lock (said) said.Clear(); }
    }

    public static class Harness
    {
        public static string[] Start(string mode, string[] top, string[] rendered) { return Shell.Replay(mode, top, rendered); }
    }

    static partial class Shell
    {
        static MainWindow win;
        static Config cfg = new Config();
        static bool fixing = false;
        static readonly HashSet<string> triedByFix = new HashSet<string>(StringComparer.Ordinal);
        static double startScanSeconds = -1;
        static bool firstStatusLogged;
        static string leftCurrentFolder = null;
        static void Log(string s) { Model.Say("status: " + s); }
        static void LogOnly(string s) { Model.Say("log: " + s); }
        static void ShowVerify(List<Issue> issues, bool logDetail) { Model.Say("card painted"); }
        static bool DrawStatus() { return false; }
        static void AfterLauncherUpdate() { Model.Say("after the update"); }

        static void Call(string name)
        {
            MethodInfo m = typeof(Shell).GetMethod(name, BindingFlags.Static | BindingFlags.NonPublic, null, Type.EmptyTypes, null);
            if (m == null) { Model.Say("no " + name); return; }
            try
            {
                object r = m.Invoke(null, null);
                if (r is Task) Begin((Task)r);
            }
            catch (TargetInvocationException e) { throw e.InnerException; }
        }

        static void PumpUntil(Func<bool> done, int ms)
        {
            var clock = Stopwatch.StartNew();
            while (!done() && clock.ElapsedMilliseconds < ms)
                if (!Dispatcher.UIThread.RunOne()) Thread.Sleep(5);
            while (Dispatcher.UIThread.RunOne()) { }
        }

        /// <summary>Shell.Run's steps in the order Shell.cs has them, then the first frame's.</summary>
        public static string[] Replay(string mode, string[] top, string[] rendered)
        {
            Model.Reset(mode);
            // Each replay is a start of its own.
            firstStatusLogged = false;
            startScanSeconds = -1;
            Dispatcher.UIThread.Owner = Thread.CurrentThread;
            SynchronizationContext was = SynchronizationContext.Current;
            SynchronizationContext.SetSynchronizationContext(new UiContext());
            try
            {
                win = new MainWindow();
                foreach (string step in top)
                {
                    if (step == "RunScan")
                    {
                        // As Run had it: a failure is said and the start goes on.
                        try { RunScan(); }
                        catch (Exception ex) { Log("Could not check the mod list on the way in: " + ex.Message); }
                        Log(DrawStatus() ? "Ready." : "Something needs attention before you can play.");
                    }
                    else if (step == "Checking") Log("Checking your mods against the server.");
                    else if (step == "Show") win.Show();
                    else if (step == "StartupCheck") Call("StartupCheck");
                    else if (step == "LogStartTime") Call("LogStartTime");
                }
                Model.Say("first frame");
                foreach (string step in rendered)
                {
                    if (step == "LogStartTime") Call("LogStartTime");
                    else if (step == "StartupCheck") Call("StartupCheck");
                    else if (step == "RunScan") RunScan();
                }
                Model.Say("first frame handled");
                PumpUntil(delegate { return Model.Has("server asked"); }, 3000);
                Model.Say("harness lets the server time out");
                Model.Answer.Set();
                PumpUntil(delegate { return Model.Has("log: Launcher start: the first status") || Model.Has("no LogFirstStatus"); }, 5000);
                // A second ask writes nothing: one line a start.
                Call("LogFirstStatus");
                return Model.All();
            }
            finally { SynchronizationContext.SetSynchronizationContext(was); }
        }
    }
}
'@

$usings = "using System;`nusing System.Collections.Generic;`nusing System.Diagnostics;`nusing System.IO;`nusing System.Threading;`nusing System.Threading.Tasks;`nusing Avalonia.Threading;`n"
$model = "namespace Thornswood`n{`n    static partial class Shell`n    {`n" + ($lift -join "`n") + "`n    }`n}`n"
# Waiting.cs as it is, its usings at the top of the one file with the others'.
$wUsings = @([regex]::Matches($waiting, '(?m)^using [^;]+;\s*$') | ForEach-Object { $_.Value.Trim() })
$wBody = [regex]::Replace($waiting, '(?m)^using [^;]+;\s*$\n?', '')
$all = (@($usings.Split("`n") + $wUsings) | Where-Object { $_ } | Sort-Object -Unique) -join "`n"
$source = $all + "`n" + $stubs + "`n" + $wBody + "`n" + $model

$built = $false
try {
    Add-Type -TypeDefinition $source -Language CSharp
    $built = $true
} catch {
    Write-Host ('      ' + $_.Exception.Message)
}
Yes 'the real Waiting.cs, RunScan, RunScanAsync and the start''s own methods build against the stand-ins' $built

if ($built) {
    foreach ($mode in @('never answers', 'refuses')) {
        Write-Host ''
        Write-Host ("  a server that " + $mode)
        $ev = [string[]][Thornswood.Harness]::Start($(if ($mode -eq 'refuses') { 'refuses' } else { 'never' }), $topSteps, $renderedSteps)
        foreach ($e in $ev) { Write-Host ('      ' + $e) }
        $at = { param($start) for ($i = 0; $i -lt $ev.Count; $i++) { if ($ev[$i].StartsWith($start)) { return $i } }; return -1 }
        $shown = & $at 'shown'
        $asked = & $at 'server asked'
        $handled = & $at 'first frame handled'
        $answered = & $at $(if ($mode -eq 'refuses') { 'status: Could not check the mod list' } else { 'server timed out' })
        $checking = & $at 'status: Checking your mods against the server.'
        $failed = & $at 'status: Could not check the mod list on the way in: '
        $status = & $at 'status: Something needs attention before you can play.'
        Yes '    the window is shown before the server is asked' ($shown -ge 0 -and $asked -ge 0 -and $shown -lt $asked)
        Yes '    the server is never asked from the window''s thread' (@($ev | Where-Object { $_ -like "server asked on the window's thread*" }).Count -eq 0)
        Yes '    the status line says it is checking before the window is shown' ($checking -ge 0 -and $checking -lt $shown)
        Yes '    the first frame is handled before the server has answered' ($handled -ge 0 -and $answered -ge 0 -and $handled -lt $answered)
        Yes '    the failure is said, then the start goes on to its status' ($failed -ge 0 -and $status -gt $failed)
        $windowLines = @($ev | Where-Object { $_ -match '^log: Launcher start: the window was on screen ' })
        Yes '    the window line is written once' ($windowLines.Count -eq 1)
        Yes '    and names no mod check, which it no longer includes' ($windowLines.Count -eq 1 -and $windowLines[0] -notmatch 'mod check')
        $firstLines = @($ev | Where-Object { $_ -match '^log: Launcher start: the first status was on screen ' })
        Yes '    the first status line is written once, after the status, though asked twice' ($firstLines.Count -eq 1 -and (& $at 'log: Launcher start: the first status') -gt $status)
        Yes '    with the mod check''s time, in seconds, and the launcher' ($firstLines.Count -eq 1 -and
            $firstLines[0] -match '^log: Launcher start: the first status was on screen \d+\.\d s after the launcher started, \d+\.\d s of it the mod check, on launcher 9\.9\.9\.$')
        Yes '    nothing was swallowed' (@($ev | Where-Object { $_ -like 'swallowed:*' }).Count -eq 0)
    }
}

# ---- 3. the weekly reader --------------------------------------------------------------
Write-Host ''
Write-Host 'the weekly reader, scripts\vps\Read-LauncherStarts.ps1 (read, not changed)'
$reader = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/vps/Read-LauncherStarts.ps1'))
$rx = [regex]::Match($reader, "(?m)^\`$StartLine = '([^']+)'").Groups[1].Value
Yes 'the reader''s line pattern is found' ($rx.Length -gt 0)
if ($rx.Length) {
    $stamp = '2026-11-27T04:00:00Z  '
    $w = [regex]::Match($stamp + 'Launcher start: the window was on screen 1.4 s after the launcher started, on launcher 1.2.6.', $rx)
    Yes 'it reads the window line as a start, with no mod check' ($w.Success -and $w.Groups[2].Value -eq '1.4' -and -not $w.Groups[3].Success -and $w.Groups[4].Value -eq '1.2.6')
    Yes 'it does not take the first status line for a start' (-not [regex]::IsMatch($stamp + 'Launcher start: the first status was on screen 9.1 s after the launcher started, 7.6 s of it the mod check, on launcher 1.2.6.', $rx))
}

Done
