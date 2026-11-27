<#
  test-4727-missing-once.ps1

      pwsh -NoProfile -File .\tests\test-4727-missing-once.ps1

  #4727. A plugin this build expects that is neither in the game's plugin
  list nor in Data was said twice by Scan: once as not installed, and once
  more by the file check as "is in the list but the file is not in Data",
  which is not true. Play's "Not launching. N problems" counted it twice.

  WHAT THIS HOLDS, with the launcher's own Verify.Run and a driver, on
  made-up folders under the scratch folder:
    1. Expected, not in the list, not in Data: one issue, "is not
       installed", Absent and FileMissing, and no line says it is in the list.
    2. Expected, in the list, not in Data: one issue, "is in the list but
       the file is not in Data", FileMissing and not Absent.
    3. Expected, not in the list, in Data: one issue, "is turned off", and
       neither Absent nor FileMissing.
    4. All three at once: three issues, three blocking, the count Play
       gives, and the Mods row's FileMissing count is the two not in Data.

  Every plugin name here is made up, none the build writes, so the gate
  runs this whatever content build it has.

  Reads the repository; writes only its own folder under the scratch folder.
  Needs the compiler the build runs.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
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

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if ($script:fail) { Done }

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    static class MissingOnceTest
    {
        static void Yes(string what, bool ok) { Console.WriteLine((ok ? "PASS  " : "FAIL  ") + what); }

        const string Shipped = "# shipped\n*Base.esp\n*Gone.esp\n*Listed.esp\n*Off.esp\n";

        // live: the game's list. inData: the plugins whose file is in Data.
        static List<Issue> Scan(string root, string live, params string[] inData)
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
            Paths.Root = root;
            Paths.ProfileDir = Path.Combine(root, "Profile");
            Paths.Golden = Path.Combine(Paths.ProfileDir, "Default");
            Paths.LocalAD = Path.Combine(Paths.ProfileDir, "LocalAppData");
            Paths.MyGames = Path.Combine(Paths.ProfileDir, "MyGames");
            Paths.Game = Path.Combine(root, "Game");
            Paths.Personal = Path.Combine(root, "Your Mods");
            Paths.Collection = false;
            Paths.OwnFirst = false;
            Paths.Live = Paths.LocalAD;
            Directory.CreateDirectory(Paths.Golden);
            Directory.CreateDirectory(Paths.LocalAD);
            string data = Path.Combine(Paths.Game, "Data");
            Directory.CreateDirectory(data);
            File.WriteAllText(Path.Combine(Paths.Golden, "plugins.txt"), Shipped);
            File.WriteAllText(Path.Combine(Paths.Golden, "loadorder.txt"), "Skyrim.esm\nBase.esp\nGone.esp\nListed.esp\nOff.esp\n");
            File.WriteAllText(Path.Combine(Paths.LocalAD, "plugins.txt"), live);
            File.WriteAllText(Path.Combine(data, "Base.esp"), "TES4");
            foreach (string p in inData) File.WriteAllText(Path.Combine(data, p), "TES4");
            Verify.LastIssues = null;
            Verify.LastUsedServer = false;
            return Verify.Run(null);
        }

        static List<Issue> About(List<Issue> issues, string plugin)
        {
            var l = new List<Issue>();
            foreach (Issue i in issues)
                if (string.Equals(i.Plugin, plugin, StringComparison.OrdinalIgnoreCase) ||
                    (i.Text != null && i.Text.StartsWith(plugin + " ", StringComparison.OrdinalIgnoreCase)))
                    l.Add(i);
            return l;
        }

        static string Said(List<Issue> l)
        {
            var s = new List<string>();
            foreach (Issue i in l) s.Add("'" + i.Problem + "'");
            return string.Join(", ", s.ToArray());
        }

        static int Blocking(List<Issue> issues)
        {
            int n = 0;
            foreach (Issue i in issues) if (i.Blocking) n++;
            return n;
        }

        static int Main(string[] args)
        {
            string work = args[0];
            const string all = "*Base.esp\n*Gone.esp\n*Listed.esp\n*Off.esp\n";

            // 1. Not in the list, not in Data.
            List<Issue> issues = Scan(Path.Combine(work, "gone"), "*Base.esp\n*Listed.esp\n*Off.esp\n", "Listed.esp", "Off.esp");
            List<Issue> gone = About(issues, "Gone.esp");
            Yes("a plugin neither in the list nor in Data is said once (" + Said(gone) + ")", gone.Count == 1);
            Yes("  as not installed", gone.Count == 1 && gone[0].Problem == "Gone.esp is not installed.");
            Yes("  and nothing says it is in the list", !Said(gone).Contains("in the list"));
            Yes("  it is Absent, and FileMissing so the Mods row names it", gone.Count == 1 && gone[0].Absent && gone[0].FileMissing);
            Yes("  and it is the one problem Play counts (" + Blocking(issues) + ")", Blocking(issues) == 1);

            // 2. In the list, not in Data.
            issues = Scan(Path.Combine(work, "listed"), all, "Gone.esp", "Off.esp");
            List<Issue> listed = About(issues, "Listed.esp");
            Yes("a plugin in the list and not in Data is said once (" + Said(listed) + ")", listed.Count == 1);
            Yes("  as in the list but not in Data", listed.Count == 1 && listed[0].Problem == "Listed.esp is in the list but the file is not in Data.");
            Yes("  FileMissing and not Absent", listed.Count == 1 && listed[0].FileMissing && !listed[0].Absent);
            Yes("  and it is the one problem Play counts (" + Blocking(issues) + ")", Blocking(issues) == 1);

            // 3. Not in the list, in Data.
            issues = Scan(Path.Combine(work, "off"), "*Base.esp\n*Gone.esp\n*Listed.esp\n", "Gone.esp", "Listed.esp", "Off.esp");
            List<Issue> off = About(issues, "Off.esp");
            Yes("a plugin switched off and in Data is said once (" + Said(off) + ")", off.Count == 1);
            Yes("  as turned off, neither Absent nor FileMissing", off.Count == 1 && off[0].Problem == "Off.esp is turned off." && !off[0].Absent && !off[0].FileMissing);

            // 4. All three at once.
            issues = Scan(Path.Combine(work, "three"), "*Base.esp\n*Listed.esp\n", "Off.esp");
            int missing = 0;
            foreach (Issue i in issues) if (i.FileMissing) missing++;
            Yes("three plugins wrong three ways: three issues (" + Said(issues) + ")", issues.Count == 3);
            Yes("  Play counts three problems (" + Blocking(issues) + ")", Blocking(issues) == 3);
            Yes("  and the Mods row counts the two not in Data (" + missing + ")", missing == 2);
            return 0;
        }
    }
}
'@

$work = Join-Path $Scratch ('thornswood-4727-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    try { $exe = Build-LauncherCode -Launcher -Exe -Main 'Thornswood.MissingOnceTest' -Source $driver }
    catch { Yes ('the driver compiles with the launcher: ' + $_.Exception.Message) $false; Done }
    Yes 'the driver compiles with the launcher' $true
    $out = Invoke-LauncherExe $exe $work 2>&1
    $rc = $LASTEXITCODE
    foreach ($line in $out) {
        $s = [string]$line
        if ($s.StartsWith('PASS  ')) { $script:pass++; Write-Host $s }
        elseif ($s.StartsWith('FAIL  ')) { $script:fail++; Write-Host $s }
        else { Write-Host "      $s" }
    }
    Yes 'the driver ran to its end' ($rc -eq 0)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
