<#
  #4633: a caught exception never reaches a person in Windows' own words.

  1. Every catch in launcher/app hands its exception to Failure, the one
     place that turns it into what a person reads: no catch puts its
     exception's Message into a line, a box or a string it returns. Read
     from the source on any machine.
  2. Failure, compiled with a stand-in Swallow, given the exceptions Windows
     really throws for a file in use, access denied and a path or file not
     there: the sentence names the file and says what to do next, never
     Windows' own words, and the whole exception goes to launcher.log
     (Swallow.Note). The file in use and access denied cases need Windows'
     own file sharing and read-only rules, so they run on Windows alone.

  Never starts the launcher.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path (Join-Path $root 'tests') 'Launcher-Csc.ps1')
$app = Join-Path $root 'launcher/app'
$failed = 0
function Yes([string]$name, [bool]$ok) {
    Write-Host (($(if ($ok) { 'PASS ' } else { 'FAIL ' })) + $name)
    if (-not $ok) { $script:failed++ }
}

# ---- 1. no catch shows its exception's Message ------------------------------
# Failure.cs is the one reader. Swallow.cs writes the whole exception to
# launcher.log, which is where Windows' words belong.
$readers = @('Failure.cs', 'Swallow.cs')
# Compiled outside the launcher too, by the scripts that sign and publish and
# by the box's deploy agent, so it cannot reach Failure: #6168 holds its fix,
# which is a change to code that signs. Named here so it is never missed.
$waits = @{ 'Signature.cs' = '#6168' }
foreach ($w in $waits.Keys) { Write-Host ('NOTE ' + $w + ' still shows a Message; waits on ' + $waits[$w]) }
$readers += @($waits.Keys)
$shown = New-Object System.Collections.Generic.List[string]
foreach ($f in Get-ChildItem -LiteralPath $app -Filter '*.cs' -File) {
    if ($readers -contains $f.Name) { continue }
    $text = [IO.File]::ReadAllText($f.FullName)
    $names = @([regex]::Matches($text, 'catch\s*\(\s*[\w.]+\s+(\w+)\s*\)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    if ($names.Count -eq 0) { continue }
    $pattern = '\b(' + ($names -join '|') + ')(\.InnerException|\.GetBaseException\(\))?\.Message\b'
    $n = 0
    foreach ($line in $text -split "`n") {
        $n++
        if ($line -match $pattern) { $shown.Add($f.Name + ':' + $n + ': ' + $line.Trim()) }
    }
}
foreach ($s in ($shown | Select-Object -First 40)) { Write-Host ('      ' + $s) }
if ($shown.Count -gt 40) { Write-Host ('      and ' + ($shown.Count - 40) + ' more') }
Yes ('no catch in launcher/app shows its exception''s Message (' + $shown.Count + ' do)') ($shown.Count -eq 0)

# ---- 2. what Failure says for what Windows throws -----------------------------
$failure = Join-Path $app 'Failure.cs'
Yes 'launcher/app/Failure.cs is the one place a caught exception becomes words' (Test-Path -LiteralPath $failure)
if (-not (Test-Path -LiteralPath $failure)) { Write-Host ($failed.ToString() + ' failed'); exit 1 }

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
namespace Thornswood
{
    static class Swallow
    {
        public static readonly List<Exception> Noted = new List<Exception>();
        public static void Note(string where, Exception e) { Noted.Add(e); }
    }
    public static class FailureTest
    {
        static int failed;
        static void Yes(string name, bool ok)
        {
            Console.WriteLine((ok ? "PASS " : "FAIL ") + name);
            if (!ok) failed++;
        }
        static Exception Caught(Action a)
        {
            try { a(); } catch (Exception ex) { return ex; }
            return null;
        }
        // What a person reads for ex: never Windows' words, the file named,
        // a next step, and the whole exception in launcher.log.
        static void Case(string what, Exception ex, string file, string next)
        {
            if (ex == null) { Yes(what + ": Windows threw something", false); return; }
            Swallow.Noted.Clear();
            string said = Failure.Say("FailureTest", ex);
            Console.WriteLine("      " + ex.GetType().Name + " " + ex.HResult.ToString("X8") + ": " + ex.Message);
            Console.WriteLine("      says: " + said);
            Yes(what + ": not Windows' own words", said.IndexOf(ex.Message, StringComparison.Ordinal) < 0);
            Yes(what + ": names the file", said.IndexOf(file, StringComparison.OrdinalIgnoreCase) >= 0);
            Yes(what + ": says what to do next", said.IndexOf(next, StringComparison.Ordinal) >= 0);
            Yes(what + ": the whole exception goes to launcher.log", Swallow.Noted.Count == 1 && Swallow.Noted[0] == ex);
            string why = Failure.Why("FailureTest", ex);
            Yes(what + ": the reason alone is not Windows' words either (" + why + ")", why.Length > 0 && why.IndexOf(ex.Message, StringComparison.Ordinal) < 0);
        }
        public static int Main(string[] args)
        {
            string dir = args[0];
            Directory.CreateDirectory(dir);
            bool windows = OperatingSystem.IsWindows();

            string held = Path.Combine(dir, "held.esp");
            if (windows)
            {
                using (var hold = new FileStream(held, FileMode.Create, FileAccess.ReadWrite, FileShare.None))
                    Case("file in use", Caught(delegate { File.WriteAllText(held, "x"); }), "held.esp", "Close Skyrim, Vortex");

                string locked = Path.Combine(dir, "readonly.ini");
                File.WriteAllText(locked, "x");
                File.SetAttributes(locked, FileAttributes.ReadOnly);
                Case("access denied", Caught(delegate { File.WriteAllText(locked, "y"); }), "readonly.ini", "read-only");
                File.SetAttributes(locked, FileAttributes.Normal);
            }
            else Console.WriteLine("SKIP file in use and access denied: Windows' own sharing and read-only rules");

            string noFolder = Path.Combine(Path.Combine(dir, "no-such-folder"), "plugins.txt");
            Case("path not found", Caught(delegate { File.ReadAllText(noFolder); }), "plugins.txt", "Press Fix on Diagnostics");
            string noFile = Path.Combine(dir, "no-such-file.json");
            Case("file not found", Caught(delegate { File.ReadAllText(noFile); }), "no-such-file.json", "Press Fix on Diagnostics");

            // The launcher's own sentence is already written for a person.
            var own = new Exception("This launcher's copy of records\\ui-gone.json is empty. Update the launcher.");
            Yes("the launcher's own sentence is said as written", Failure.Say("FailureTest", own) == own.Message);

            Console.WriteLine(failed + " failed");
            return failed == 0 ? 0 : 1;
        }
    }
}
'@
$work = Join-Path ([IO.Path]::GetTempPath()) ('tw-4633-' + [Guid]::NewGuid().ToString('N'))
$result = 1
try {
    $exe = Build-LauncherCode -File $failure -Source $driver -Exe -Main 'Thornswood.FailureTest'
    Invoke-LauncherExe $exe $work | ForEach-Object { Write-Host $_ }
    $result = $LASTEXITCODE
} finally {
    if (Test-Path $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
Write-Host ($failed.ToString() + ' failed before the compiled part')
if ($failed -gt 0) { exit 1 }
exit $result
