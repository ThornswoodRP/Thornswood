<# #4630: a refused diagnostic must not change its caller's continuation.
   Compiles the real Swallow and Stall, and both real dispatcher bodies.
   Runs test drivers only, never the launcher, a window or the game. #>
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $root 'tests/Launcher-Csc.ps1')
if (-not $OnWindows) { Write-Host 'SKIP: Windows exclusive-file diagnostic paths'; exit 0 }
$app = Join-Path $root 'launcher/app'
function Read-FaultBody([string]$file) {
    $source = [IO.File]::ReadAllText((Join-Path $app $file))
    $start = $source.IndexOf('Dispatcher.UIThread.UnhandledException += delegate')
    if ($start -lt 0) { throw "No real dispatcher handler in $file" }
    $start = $source.IndexOf('{', $start)
    $end = $source.IndexOf('fault.Handled = true;', $start)
    if ($end -lt 0) { throw "No handled assignment in $file" }
    # End at the handler's closing brace, not at an inner try/catch brace.
    $end = $source.IndexOf('};', $end)
    if ($end -lt 0) { throw "No handler end in $file" }
    $source.Substring($start + 1, $end - $start - 1)
}
$handlers = @'
using System;
using System.Diagnostics;
using System.Reflection;
using System.Text;
namespace Thornswood {
    sealed class Fault { public Exception Exception; public bool Handled; }
    static partial class Shell {
        // The real Log also reaches this writer before its status control.
        static void Log(string message) { LauncherLog.Line(message); }
        public static void MainFault(Fault fault) { MAIN_BODY }
        public static void UninstallFault(Fault fault) { UNINSTALL_BODY }
        public static void StampForTest() { Stamp("held-stall-marker"); }
    }
}
'@
$handlers = $handlers.Replace('MAIN_BODY', (Read-FaultBody 'Shell.cs')).Replace('UNINSTALL_BODY', (Read-FaultBody 'ShellUninstall.cs'))
$driver = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
namespace Thornswood {
    static class Paths { public static string LogFile; }
    public static class HeldDiagnosticTest {
        public static int Main(string[] args) {
            if (args.Length == 1) {
                int failed = 0;
                foreach (string mode in new[] { "main-fault", "uninstall-fault", "stall-thread", "caught-exception" }) {
                    var start = new ProcessStartInfo(Environment.ProcessPath) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
                    start.ArgumentList.Add(typeof(HeldDiagnosticTest).Assembly.Location);
                    start.ArgumentList.Add(args[0]); start.ArgumentList.Add(mode);
                    using (var child = Process.Start(start)) {
                        var output = child.StandardOutput.ReadToEndAsync();
                        var errors = child.StandardError.ReadToEndAsync();
                        child.WaitForExit();
                        bool ok = child.ExitCode == 0 && output.Result.Contains("CONTINUED " + mode);
                        Console.WriteLine((ok ? "PASS " : "FAIL ") + mode + " with exclusive launcher.log, exit=" + child.ExitCode);
                        Console.Write(output.Result); Console.Write(errors.Result);
                        if (!ok) failed++;
                    }
                }
                return failed == 0 ? 0 : 1;
            }
            Directory.CreateDirectory(args[0]);
            Paths.LogFile = Path.Combine(args[0], "launcher.log");
            string action = args[1];
            using (var held = new FileStream(Paths.LogFile, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
                if (action == "stall-thread") {
                    // No catch on this thread: an escaping Stamp really ends
                    // the child process, and the parent records that failure.
                    var thread = new Thread(Shell.StampForTest);
                    thread.Start(); thread.Join();
                } else if (action == "caught-exception") {
                    try { throw new InvalidOperationException("original-caught-marker"); }
                    catch (Exception ex) { Swallow.Note("held-catch", ex); }
                    Swallow.Say("held-reason", "held-say-marker");
                } else {
                    var fault = new Fault { Exception = new InvalidOperationException("handled-fault-marker") };
                    if (action == "main-fault") Shell.MainFault(fault);
                    else Shell.UninstallFault(fault);
                    if (!fault.Handled) return 2;
                }
            }
            Console.WriteLine("CONTINUED " + action);
            return 0;
        }
    }
}
'@
$work = Join-Path ([IO.Path]::GetTempPath()) ('tw-held-4630-' + [Guid]::NewGuid().ToString('N'))
try {
    $exe = Build-LauncherCode -File (Join-Path $app 'Swallow.cs'), (Join-Path $app 'Stall.cs') -Source $handlers, $driver -Exe -Main 'Thornswood.HeldDiagnosticTest'
    Invoke-LauncherExe $exe $work | ForEach-Object { Write-Host $_ }
    $result = $LASTEXITCODE
} finally {
    if (Test-Path $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
exit $result
