<#
  test-6327-shipped-list.ps1

      pwsh -NoProfile -File .\tests\test-6327-shipped-list.ps1

  #6327. Profile\Default\plugins.txt, the plugin list a build ships, is the
  reference Scan holds the game's list against and the list Fix and every
  update write into the game's. Until 27 Nov a missing one was one issue
  that did not block Play, and Scan returned before the server order, the
  bytes and the other servers' clients, so Play went ahead with any load
  order. An empty one, or one of comments alone, was copied over the game's
  list by Fix and switched every plugin off.

  WHAT THIS HOLDS, with the launcher's own code and a driver, on made-up
  folders under the scratch folder:
    1. No shipped list: Scan's one issue blocks Play, names
       Profile\Default\plugins.txt, has nothing for Fix to do, and is what
       the Mods and Mod list rows read (LastIssues). Expected is 0.
    2. A shipped list of comments and switched off lines alone: the same,
       saying it switches no plugin on.
    3. SettleLoadOrder (Fix, and every update that carries the list) writes
       nothing over the game's list from either, and Swap.RepairConfigs and
       nothing else it copies does either, while a shipped ini still goes.
    4. A shipped list that switches a plugin on is still written, by both.

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
    static class ShippedListTest
    {
        static void Yes(string what, bool ok) { Console.WriteLine((ok ? "PASS  " : "FAIL  ") + what); }

        static void Lay(string root)
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
            Directory.CreateDirectory(Path.Combine(Paths.Game, "Data"));
            File.WriteAllText(Path.Combine(Paths.LocalAD, "plugins.txt"), Live);
            File.WriteAllText(Path.Combine(Paths.LocalAD, "loadorder.txt"), LiveOrder);
        }

        const string Live = "# the game's list\n*Unofficial Skyrim Special Edition Patch.esp\n*Thornswood-Content.esp\n";
        const string LiveOrder = "Skyrim.esm\nUnofficial Skyrim Special Edition Patch.esp\nThornswood-Content.esp\n";

        static bool Untouched()
        {
            return File.ReadAllText(Path.Combine(Paths.LocalAD, "plugins.txt")) == Live &&
                   File.ReadAllText(Path.Combine(Paths.LocalAD, "loadorder.txt")) == LiveOrder;
        }

        static void NoReference(string what, string says)
        {
            Verify.LastIssues = null;
            Verify.LastUsedServer = false;
            List<Issue> issues = Verify.Run(null);
            Yes(what + ": Scan has one issue, and it blocks Play", issues.Count == 1 && issues[0].Blocking);
            Yes("  it names Profile\\Default\\plugins.txt and says " + says,
                issues.Count == 1 && issues[0].Problem.Contains("Profile\\Default\\plugins.txt") && issues[0].Problem.Contains(says));
            Yes("  Fix has nothing to do for it, and what will is said", issues.Count == 1 && !issues[0].Fixable && !string.IsNullOrEmpty(issues[0].WhatWill));
            Yes("  the Mods and Mod list rows read the same issue", Verify.LastIssues == issues);
            Yes("  and no plugin is expected", Verify.Expected == 0);
            Yes("  ShippedListProblem says the same", Verify.ShippedListProblem() == issues[0].Problem);
            Yes("  SettleLoadOrder writes nothing over the game's list", Verify.SettleLoadOrder() == 0 && Untouched());
            int copied = Swap.RepairConfigs();
            Yes("  nor does RepairConfigs, which still puts the shipped ini in place",
                Untouched() && copied == 1 && File.Exists(Path.Combine(Paths.MyGames, "Skyrim.ini")));
        }

        static int Main(string[] args)
        {
            string work = args[0];

            Lay(Path.Combine(work, "missing"));
            File.WriteAllText(Path.Combine(Paths.Golden, "Skyrim.ini"), "[General]\n");
            NoReference("No shipped list", "no plugin list of its own");

            Lay(Path.Combine(work, "empty"));
            File.WriteAllText(Path.Combine(Paths.Golden, "Skyrim.ini"), "[General]\n");
            File.WriteAllText(Path.Combine(Paths.Golden, "plugins.txt"), "# This file is used by Skyrim to keep track of your downloaded content.\n\nThornswood-Content.esp\n");
            File.WriteAllText(Path.Combine(Paths.Golden, "loadorder.txt"), "Skyrim.esm\n");
            NoReference("A shipped list that switches nothing on", "switches no plugin on");

            Lay(Path.Combine(work, "usable"));
            const string shipped = "# shipped\n*Thornswood-Content.esp\n";
            File.WriteAllText(Path.Combine(Paths.Golden, "plugins.txt"), shipped);
            File.WriteAllText(Path.Combine(Paths.Golden, "loadorder.txt"), "Skyrim.esm\nThornswood-Content.esp\n");
            Yes("A shipped list that switches a plugin on is no problem", Verify.ShippedListProblem() == null);
            Yes("  SettleLoadOrder writes it and its load order into the game's",
                Verify.SettleLoadOrder() == 2 && File.ReadAllText(Path.Combine(Paths.LocalAD, "plugins.txt")) == shipped);
            File.WriteAllText(Path.Combine(Paths.LocalAD, "plugins.txt"), Live);
            Yes("  and so does RepairConfigs",
                Swap.RepairConfigs() == 2 && File.ReadAllText(Path.Combine(Paths.LocalAD, "plugins.txt")) == shipped);
            return 0;
        }
    }
}
'@

$work = Join-Path $Scratch ('thornswood-6327-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    try { $exe = Build-LauncherCode -Launcher -Exe -Main 'Thornswood.ShippedListTest' -Source $driver }
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
