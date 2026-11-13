<#
  #4630: concurrent diagnostic lines must all reach the real launcher log.
  Compiles Swallow.cs with only a scratch Paths, never starts the launcher.
  The same driver also checks the 4 MiB cap and its one older file.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $root 'tests/Launcher-Csc.ps1')
$app = Join-Path $root 'launcher/app'
$driver = @'
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
namespace Thornswood
{
    static class Paths { public static string LogFile; }
    static class Diag { public static string ReportDir; }
    public static class LogWriterTest
    {
        static int failed;
        static void Yes(string name, bool ok)
        {
            Console.WriteLine((ok ? "PASS " : "FAIL ") + name);
            if (!ok) failed++;
        }
        public static int Main(string[] args)
        {
            string dir = args[0];
            Directory.CreateDirectory(dir);
            Paths.LogFile = Path.Combine(dir, "launcher.log");
            const int threads = 12, each = 300;
            var start = new Barrier(threads);
            var workers = new Thread[threads];
            int errors = 0;
            for (int t = 0; t < threads; t++)
            {
                int id = t;
                workers[t] = new Thread(delegate()
                {
                    start.SignalAndWait();
                    for (int i = 0; i < each; i++)
                    {
                        try { Swallow.Say("concurrent", "record=" + id + ":" + i + ";" + new string('x', 200)); }
                        catch (Exception ex) { Interlocked.Increment(ref errors); Console.WriteLine(ex.GetType().Name); }
                    }
                });
                workers[t].Start();
            }
            foreach (Thread worker in workers) worker.Join();
            string text = File.Exists(Paths.LogFile) ? File.ReadAllText(Paths.LogFile) : "";
            int found = 0;
            for (int t = 0; t < threads; t++)
                for (int i = 0; i < each; i++)
                {
                    string mark = "record=" + t + ":" + i + ";";
                    int at = text.IndexOf(mark, StringComparison.Ordinal);
                    if (at >= 0 && text.IndexOf(mark, at + mark.Length, StringComparison.Ordinal) < 0) found++;
                }
            Console.WriteLine("concurrent: expected=" + threads * each + " unique=" + found + " exceptions=" + errors);
            Yes("every concurrent record appears exactly once", found == threads * each && errors == 0);
            File.Delete(Paths.LogFile);
            const int cap = 4 * 1024 * 1024;
            string older = Paths.LogFile + ".1";
            File.WriteAllText(Paths.LogFile, new string('a', cap - 1), new UTF8Encoding(false));
            Swallow.Say("cap", "roll-one");
            Yes("a write crossing 4 MiB rolls the previous file", File.Exists(older) && new FileInfo(older).Length == cap - 1);
            Yes("the crossing record is whole in the current file", File.ReadAllText(Paths.LogFile).Contains("roll-one") && new FileInfo(Paths.LogFile).Length <= cap);
            File.WriteAllText(Paths.LogFile, new string('b', cap), new UTF8Encoding(false));
            Swallow.Say("cap", "roll-two");
            Yes("the second roll replaces the one older file", File.Exists(older) && File.ReadAllText(older).StartsWith("bbb") && Directory.GetFiles(dir, "launcher.log.*").Length == 1);
            Yes("both files are bounded", new FileInfo(Paths.LogFile).Length <= cap && File.Exists(older) && new FileInfo(older).Length <= cap);
            File.Delete(Paths.LogFile);
            File.Delete(older);
            string huge = new string('\u20ac', cap / 3 + 100);
            LauncherLog.Text(huge);
            var strict = new UTF8Encoding(false, true);
            string joined = strict.GetString(File.ReadAllBytes(older)) + strict.GetString(File.ReadAllBytes(Paths.LogFile));
            Yes("an oversized record spans bounded files without losing UTF-8", joined == huge && new FileInfo(older).Length <= cap && new FileInfo(Paths.LogFile).Length <= cap);
            File.WriteAllText(Paths.LogFile, new string('z', cap + 100), new UTF8Encoding(false));
            LauncherLog.Line("after legacy log");
            Yes("an existing unbounded log retains only a bounded older tail", new FileInfo(older).Length == cap && File.ReadAllText(Paths.LogFile).Contains("after legacy log"));
            bool refused = false;
            string normal = Paths.LogFile;
            Paths.LogFile = dir;
            try { LauncherLog.Line("cannot append to a directory"); }
            catch (IOException) { refused = true; }
            catch (UnauthorizedAccessException) { refused = true; }
            Paths.LogFile = normal;
            Yes("a genuine I/O refusal is reported rather than skipped", refused);
            File.Delete(Paths.LogFile);
            File.Delete(older);
            LauncherLog.Text("multiline\nstack detail\n");
            Swallow.Note("mixed", new InvalidOperationException("the reason"));
            Yes("raw multiline and exception records share the writer", File.ReadAllText(Paths.LogFile).StartsWith("multiline\nstack detail\n") && File.ReadAllText(Paths.LogFile).Contains("the reason"));
            DateTime now = DateTime.Now;
            string oldLine = now.AddDays(-31).ToString("yyyy-MM-dd HH:mm:ss") + "  old\n";
            string keptLine = now.ToString("yyyy-MM-dd HH:mm:ss") + "  kept\n";
            File.WriteAllText(Paths.LogFile, oldLine + keptLine);
            File.WriteAllText(older, oldLine);
            Diag.ReportDir = Path.Combine(dir, "Reports");
            LocalKeep.Tidy(now);
            Yes("age pruning covers both generations and retains recent records", !File.Exists(older) && File.ReadAllText(Paths.LogFile).StartsWith(keptLine));
            Console.WriteLine(failed + " failed");
            return failed == 0 ? 0 : 1;
        }
    }
}
'@
$work = Join-Path ([IO.Path]::GetTempPath()) ('tw-log-4630-' + [Guid]::NewGuid().ToString('N'))
try {
    $exe = Build-LauncherCode -File (Join-Path $app 'Swallow.cs'), (Join-Path $app 'LocalKeep.cs') -Source $driver -Exe -Main 'Thornswood.LogWriterTest'
    Invoke-LauncherExe $exe $work | ForEach-Object { Write-Host $_ }
    $result = $LASTEXITCODE
} finally {
    if (Test-Path $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
exit $result
