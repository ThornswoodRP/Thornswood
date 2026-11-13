<#
  test-4582-await-not-pump.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4582-await-not-pump.ps1

  #4582. The launcher's long waits (closing a stuck Skyrim, starting the
  local server, the scans, Fix, the character list, the folder check before
  Play) ran the work on a pool thread and held the caller on the window's
  thread in Shell.Waiting, which kept the window drawing with a nested
  Dispatcher.PushFrame. Avalonia refuses that frame while the dispatcher is
  suspended (during layout, for one), and the catch then waited with
  done.WaitOne() on the window's own thread: the launcher froze for as long
  as the work took. Now the work is awaited (Shell.OffThread), so the
  window's own loop carries on and nothing is nested.

    1. The whole launcher, built the way the project builds it: no method
       in it calls Dispatcher.PushFrame. Every call in every method body is
       read from the built IL, lambdas and state machines included. A
       method of the driver's own that does call it must be found, so a
       scan that sees nothing cannot pass.
    2. Shell.OffThread, lifted from launcher\app\Waiting.cs and built with
       stand-ins for the window:
         a. with the window up, it hands its caller a task that is not done
            while the work runs, holds the window once, runs the work on
            another thread, and lets the window go when the work ends;
         b. before the window is up, the work runs there and then, on the
            caller's thread, and the window is not touched;
         c. a fault in the work comes out of the await as it was thrown,
            and the window is still let go.
       Shell.Begin, the start of an awaited path from a button or a
       callback, lifted the same way:
         d. a path that already ended in a fault throws to its caller, so
            the start's own try and catch still sees it;
         e. one that faults later reaches the window's fault handler.
    3. A copy of OffThread that blocks on the work (Task.Run(work).Wait())
       is built too and must fail 2a, so these checks have teeth.

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

Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

# ---- 1. no nested frame anywhere in the built launcher ----------------------
$scan = @'
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Reflection.Emit;

namespace Thornswood4582
{
    public static class Teeth
    {
        // Never run. A nested frame the scan has to find, so a scan that
        // reads nothing cannot pass.
        public static void Nested() { Avalonia.Threading.Dispatcher.UIThread.PushFrame(new Avalonia.Threading.DispatcherFrame()); }
    }

    public static class Scan
    {
        static readonly OpCode[] one = new OpCode[256], two = new OpCode[256];
        static readonly bool[] haveOne = new bool[256], haveTwo = new bool[256];

        static int OperandSize(OperandType k, byte[] il, int at)
        {
            switch (k)
            {
                case OperandType.InlineNone: return 0;
                case OperandType.ShortInlineBrTarget:
                case OperandType.ShortInlineI:
                case OperandType.ShortInlineVar: return 1;
                case OperandType.InlineVar: return 2;
                case OperandType.InlineI8:
                case OperandType.InlineR: return 8;
                case OperandType.InlineSwitch: return 4 + 4 * BitConverter.ToInt32(il, at);
                default: return 4;
            }
        }

        public static int Main()
        {
            foreach (FieldInfo f in typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                OpCode o = (OpCode)f.GetValue(null);
                int v = unchecked((ushort)o.Value);
                if (o.Size == 1) { one[v & 0xff] = o; haveOne[v & 0xff] = true; }
                else { two[v & 0xff] = o; haveTwo[v & 0xff] = true; }
            }

            const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
            int methods = 0, unread = 0, posts = 0;
            var nested = new List<string>();
            Type[] types;
            try { types = typeof(Scan).Assembly.GetTypes(); }
            catch (ReflectionTypeLoadException e)
            {
                // A type that will not load is a body this scan cannot read:
                // counted, and named, never passed over.
                types = e.Types;
                foreach (Exception le in e.LoaderExceptions) { unread++; Console.WriteLine("UNREAD type: " + (le == null ? "?" : le.Message)); }
            }
            foreach (Type t in types)
            {
                if (t == null) continue;
                var bodies = new List<MethodBase>();
                bodies.AddRange(t.GetMethods(all));
                bodies.AddRange(t.GetConstructors(all));
                Type[] typeArgs = t.IsGenericType ? t.GetGenericArguments() : null;
                foreach (MethodBase m in bodies)
                {
                    MethodBody b = m.GetMethodBody();
                    if (b == null) continue;
                    methods++;
                    Type[] methodArgs = m.IsGenericMethod ? m.GetGenericArguments() : null;
                    byte[] il = b.GetILAsByteArray();
                    int i = 0;
                    while (i < il.Length)
                    {
                        OpCode op;
                        byte first = il[i++];
                        if (first == 0xFE)
                        {
                            byte second = il[i++];
                            if (!haveTwo[second]) { unread++; Console.WriteLine("UNREAD " + t.FullName + "." + m.Name); break; }
                            op = two[second];
                        }
                        else
                        {
                            if (!haveOne[first]) { unread++; Console.WriteLine("UNREAD " + t.FullName + "." + m.Name); break; }
                            op = one[first];
                        }
                        if (op.OperandType == OperandType.InlineMethod)
                        {
                            int token = BitConverter.ToInt32(il, i);
                            MethodBase callee = null;
                            try { callee = m.Module.ResolveMethod(token, typeArgs, methodArgs); }
                            catch (Exception ex) { unread++; Console.WriteLine("UNREAD " + t.FullName + "." + m.Name + ": " + ex.Message); }
                            if (callee != null && callee.DeclaringType != null && callee.DeclaringType.FullName == "Avalonia.Threading.Dispatcher")
                            {
                                if (callee.Name == "PushFrame") nested.Add(t.FullName + "." + m.Name);
                                if (callee.Name == "Post" || callee.Name == "InvokeAsync") posts++;
                            }
                        }
                        i += OperandSize(op.OperandType, il, i);
                    }
                }
            }
            Console.WriteLine("METHODS " + methods);
            Console.WriteLine("UNREADCOUNT " + unread);
            Console.WriteLine("POSTS " + posts);
            foreach (string n in nested) Console.WriteLine("NESTED " + n);
            return 0;
        }
    }
}
'@

$exe = $null
try { $exe = Build-LauncherCode -Launcher -Source $scan -Exe -Main 'Thornswood4582.Scan' }
catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the scan build the way the project builds them' ($null -ne $exe)
if ($exe) {
    $lines = @(Invoke-LauncherExe $exe | ForEach-Object { "$_" })
    Yes 'the scan ran to the end' ($LASTEXITCODE -eq 0 -and @($lines | Where-Object { $_ -like 'METHODS *' }).Count -eq 1)
    $methods = 0; $unread = -1; $posts = 0
    foreach ($l in $lines) {
        if ($l -like 'METHODS *') { $methods = [int]$l.Substring(8) }
        elseif ($l -like 'UNREADCOUNT *') { $unread = [int]$l.Substring(12) }
        elseif ($l -like 'POSTS *') { $posts = [int]$l.Substring(6) }
        elseif ($l -like 'UNREAD *') { Write-Host "      $l" }
    }
    $nested = @($lines | Where-Object { $_ -like 'NESTED *' } | ForEach-Object { $_.Substring(7) })
    Yes "1. every call in every method body was read ($methods methods, $unread unread)" ($methods -gt 1000 -and $unread -eq 0)
    Yes "1. the scan sees the launcher's calls into the dispatcher ($posts posts)" ($posts -gt 10)
    Yes '1. and finds the nested frame the driver plants' ($nested -contains 'Thornswood4582.Teeth.Nested')
    $launcher = @($nested | Where-Object { $_ -ne 'Thornswood4582.Teeth.Nested' })
    foreach ($n in $launcher) { Write-Host "      nested frame in $n" }
    Yes ('1. no method in the launcher pushes a nested frame (' + $launcher.Count + ' do)') ($launcher.Count -eq 0)
}

# ---- 2. OffThread and Begin, lifted --------------------------------------------
$waitingPath = Join-Path $AppDir 'Waiting.cs'
$waiting = [IO.File]::ReadAllText($waitingPath, [Text.Encoding]::UTF8)
$sigs = @('static async Task OffThread(Action work)', 'static void Begin(Task path)')
$bodies = @()
foreach ($sig in $sigs) {
    $b = Body $waiting $sig
    Yes "2. Waiting.cs has $sig" ($b.Length -gt 0)
    $bodies += $b
}

$driver = @'
using System;
using System.Collections.Generic;
using System.Runtime.ExceptionServices;
using System.Threading;
using System.Threading.Tasks;

namespace Thornswood
{
    static partial class Shell
    {
        static bool up;
        static int holds, lets;
        static readonly List<string> faults = new List<string>();
        static readonly ManualResetEventSlim faulted = new ManualResetEventSlim(false);
        static bool WindowUp() { return up; }
        static void HoldWindow() { holds++; }
        static void LetWindowGo() { lets++; }
        static void FaultToWindow(Task done) { lock (faults) faults.Add(done.Exception.InnerException.Message); faulted.Set(); }

__METHODS__

        static int pass, fail;
        static void Yes(string what, bool ok)
        {
            if (ok) { pass++; Console.WriteLine("PASS  " + what); }
            else { fail++; Console.WriteLine("FAIL  " + what); }
        }
        static readonly TimeSpan Long = TimeSpan.FromSeconds(30);

        static int Main()
        {
            int caller = Environment.CurrentManagedThreadId;

            // ---- a. the window up, the work held --------------------------
            up = true; holds = 0; lets = 0;
            var gate = new ManualResetEventSlim(false);
            int worker = -1;
            Task held = OffThread(delegate { worker = Environment.CurrentManagedThreadId; gate.Wait(Long); });
            Yes("2a. with the window up, the caller has its task back while the work still runs", !held.IsCompleted);
            Yes("2a. and the window is held, once", holds == 1 && lets == 0);
            gate.Set();
            bool ended = false;
            try { ended = held.Wait(Long); } catch (AggregateException) { }
            Yes("2a. the task ends when the work does", ended && held.Status == TaskStatus.RanToCompletion);
            Yes("2a. the work ran on another thread than the caller's", worker != -1 && worker != caller);
            Yes("2a. and the window is let go, once", holds == 1 && lets == 1);

            // ---- b. before the window is up ------------------------------
            up = false; holds = 0; lets = 0;
            int at = -1;
            Task early = OffThread(delegate { at = Environment.CurrentManagedThreadId; });
            Yes("2b. before the window is up, the work runs there and then", early.Status == TaskStatus.RanToCompletion);
            Yes("2b. on the caller's own thread, with the window not touched", at == caller && holds == 0 && lets == 0);

            // ---- c. a fault ----------------------------------------------
            up = true; holds = 0; lets = 0;
            Task bad = OffThread(delegate { throw new InvalidOperationException("the folder is held"); });
            string said = null;
            try { bad.GetAwaiter().GetResult(); }
            catch (InvalidOperationException e) { said = e.Message; }
            catch (Exception e) { said = e.GetType().Name + ": " + e.Message; }
            Yes("2c. a fault comes out of the await as it was thrown (" + said + ")", said == "the folder is held");
            Yes("2c. and the window is still let go", holds == 1 && lets == 1);

            // ---- d. Begin, a path that already faulted --------------------
            up = false;
            bool thrown = false;
            try { Begin(OffThread(delegate { throw new InvalidOperationException("at the start"); })); }
            catch (InvalidOperationException e) { thrown = e.Message == "at the start"; }
            Yes("2d. a path that already ended in a fault throws to whoever started it", thrown);
            bool quiet = true;
            try { Begin(OffThread(delegate { })); } catch (Exception) { quiet = false; }
            Yes("2d. and one that already ended well says nothing", quiet);

            // ---- e. Begin, a path that faults later -----------------------
            up = true;
            var later = new ManualResetEventSlim(false);
            bool returned = true;
            try { Begin(OffThread(delegate { later.Wait(Long); throw new InvalidOperationException("part way"); })); }
            catch (Exception) { returned = false; }
            Yes("2e. a path still running hands straight back to whoever started it", returned);
            later.Set();
            bool reached = faulted.Wait(Long);
            Yes("2e. and its fault reaches the window's fault handler, once", reached && faults.Count == 1 && faults[0] == "part way");

            Console.WriteLine();
            Console.WriteLine(pass + " passed, " + fail + " failed");
            return fail == 0 ? 0 : 1;
        }
    }
}
'@

function Run-Lifted([string[]]$methods, [string]$label) {
    $src = $driver.Replace('__METHODS__', ($methods -join "`r`n`r`n"))
    $built = $null
    try { $built = Build-LauncherCode -Source $src -Exe }
    catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    Yes "$label builds the way the project builds" ($null -ne $built)
    if (-not $built) { return $null }
    return @(Invoke-LauncherExe $built | ForEach-Object { "$_" })
}

if (@($bodies | Where-Object { $_.Length -eq 0 }).Count -eq 0) {
    $lines = Run-Lifted $bodies '2. OffThread and Begin, lifted,'
    foreach ($l in @($lines)) {
        if ($l -like 'PASS  *') { $script:pass++; Write-Host $l }
        elseif ($l -like 'FAIL  *') { $script:fail++; Write-Host $l }
    }

    # ---- 3. teeth ------------------------------------------------------------
    $blocking = $bodies[0].Replace('await Task.Run(work);', 'Task.Run(work).Wait();')
    Yes '3. the blocking copy differs from the shipped one' ($blocking -ne $bodies[0])
    $lines = Run-Lifted @($blocking, $bodies[1]) '3. a copy of OffThread that blocks on the work'
    Yes '3. and it fails 2a: its caller gets nothing back until the work is done' (
        @($lines | Where-Object { $_ -like 'FAIL  2a. with the window up, the caller has its task back*' }).Count -eq 1)
}

Done
