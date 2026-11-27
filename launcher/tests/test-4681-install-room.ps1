<#
  test-4681-install-room.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4681-install-room.ps1

  What the install window says about room on the drive is what the install
  refuses (#4681). The window and InstallSteps each made their own check: the
  window compared bytes with InstallPlace.Needed on the install folder's drive
  alone, and InstallSteps rounded the free space to a tenth of a gigabyte
  before comparing (so a drive 50 MB short passed the install after the window
  refused it), then stopped on a second figure of its own, 3 GB on the drive
  Steam keeps Skyrim on, which the window never said or checked.

  What it holds:
    1. Read from the code: InstallSteps has no room figure or comparison of its
       own, and its space step, the window's room line and its Install button
       all take the drives and the room from InstallPlace.Rooms and refuse by
       InstallPlace.Short. The line is said again when the own folder tick
       changes, since the tick decides whether Steam's drive is written to.
    2. The rule itself (InstallPlace.cs, built with a driver by the .NET SDK
       the launcher builds with, tests\Launcher-Csc.ps1), with the free space
       on each drive given to it:
       a. which drives are written to, and what each needs;
       b. 2 GB on Steam's drive is refused, naming that drive, and the window's
          line says the same refusal;
       c. one byte under Needed is refused by both;
       d. exactly Needed is let through by both;
       e. a drive whose room cannot be read is said, not refused;
       f. over a spread of amounts on both drives, ticked and not, the window's
          line is in the refusing colour exactly when Install would refuse.

  Nothing outside its own scratch is written, beyond the build Launcher-Csc.ps1
  keeps under out\harness.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$why = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host ("FAIL  $what" + $(if ($why) { ' | ' + $why } else { '' })) }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

$sep = [IO.Path]::DirectorySeparatorChar
function Under([string]$dir, [string]$rel) { return [IO.Path]::Combine($dir, $rel.Replace('\', [string]$sep)) }
$App = Under $Repo 'launcher\app'
$steps = [IO.File]::ReadAllText((Join-Path $App 'InstallSteps.cs'))
$window = [IO.File]::ReadAllText((Join-Path $App 'InstallWindow.cs'))

# ---- 1. one rule, read from the code -----------------------------------------
$a = $steps.IndexOf('// ------------------------------------------------- space')
$b = $steps.IndexOf('// ------------------------------------------------- the base game')
$space = if ($a -ge 0 -and $b -gt $a) { $steps.Substring($a, $b - $a) } else { '' }
Yes '1. InstallSteps has its space step' ($space.Length -gt 0)
Yes '1. the space step takes its drives and room from InstallPlace.Rooms' ($space -match 'InstallPlace\.Rooms\(')
Yes '1. and stops by InstallPlace.Short' ($space -match 'InstallPlace\.Short\(')
Yes '1. InstallSteps has no room figure of its own (needGB, FreeGB, a bare 3 GB)' (
    $steps -notmatch '\bneedGB\b' -and $steps -notmatch '\bFreeGB\(' -and $steps -notmatch '\bsf < 3\b' -and $steps -notmatch 'needs about 3 GB')
Yes '1. InstallSteps compares no free space with InstallPlace.Needed itself' ($steps -notmatch 'InstallPlace\.Needed')

$s = $window.IndexOf('void Start()')
$start = if ($s -ge 0) { $window.Substring($s, [Math]::Min(1600, $window.Length - $s)) } else { '' }
Yes '1. the Install button refuses by InstallPlace.Short' ($start -match 'InstallPlace\.Short\(')
Yes '1. and makes no comparison with InstallPlace.Needed of its own' ($window -notmatch '<\s*InstallPlace\.Needed')
Yes '1. the window''s room line reads the same drives' ($window -match 'InstallPlace\.SayRoom\(Rooms\(\)')
Yes '1. the window''s drives come from InstallPlace.Rooms, with the own folder tick' ($window -match 'InstallPlace\.Rooms\(' -and $window -match 'chkOwn\.IsChecked')
Yes '1. the room line is said again when the own folder tick changes' ($window -match 'chkOwn\.IsCheckedChanged \+= delegate \{[^}]*SayRoom\(\);')

# ---- 2. the rule ------------------------------------------------------------------
$driver = @'
using System;
using System.Collections.Generic;
using Thornswood;

namespace Thornswood
{
    // Stands in for launcher\app\Swallow.cs, which Failure.cs writes the
    // whole exception through (#4633). This driver has no launcher.log.
    static class Swallow { public static void Note(string where, Exception e) { } }
}

static class InstallRoomDriver
{
    const long G = 1073741824L;
    const string C = @"C:\", D = @"D:\";
    static int failed;

    static void Yes(string name, bool ok, string why)
    {
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + name + (ok || why == null ? "" : " | " + why));
        if (!ok) failed++;
    }

    static Func<string, long> Free(long c, long d)
    {
        return drive => string.Equals(drive, C, StringComparison.OrdinalIgnoreCase) ? c : d;
    }

    static int Main()
    {
        List<InstallPlace.Room> apart = InstallPlace.Rooms(C, D, true);
        Yes("2a. into the Steam copy on another drive: the install folder's drive needs Needed, Steam's needs NeededOnSteam",
            apart.Count == 2 && apart[0].Drive == C && !apart[0].Steam && apart[0].Need == InstallPlace.Needed &&
            apart[1].Drive == D && apart[1].Steam && apart[1].Need == InstallPlace.NeededOnSteam, apart.Count.ToString());
        Yes("2a. with the own folder, nothing goes into the Steam copy: the install folder's drive alone",
            InstallPlace.Rooms(C, D, false).Count == 1, null);
        Yes("2a. Steam on the same drive, in any case: one drive", InstallPlace.Rooms(C, @"c:\", true).Count == 1, null);

        InstallPlace.Room which;
        string colour;
        string refused = InstallPlace.Short(apart, Free(20 * G, 2 * G), out which);
        string line = InstallPlace.SayRoom(apart, Free(20 * G, 2 * G), out colour);
        Yes("2b. 2 GB on Steam's drive is refused, naming the drive",
            refused != null && which != null && which.Steam && refused.Contains("D:") && refused.Contains("where Steam keeps Skyrim"), refused);
        Yes("2b. and the window's line says that same refusal, in the refusing colour",
            colour == "Bad" && refused != null && line.Contains(refused), colour + ": " + line);

        List<InstallPlace.Room> one = InstallPlace.Rooms(C, C, true);
        refused = InstallPlace.Short(one, Free(InstallPlace.Needed - 1, 0), out which);
        line = InstallPlace.SayRoom(one, Free(InstallPlace.Needed - 1, 0), out colour);
        Yes("2c. one byte under Needed is refused", refused != null && which != null && !which.Steam, refused);
        Yes("2c. and the window says so in the refusing colour", colour == "Bad" && refused != null && line.Contains(refused), colour + ": " + line);

        refused = InstallPlace.Short(one, Free(InstallPlace.Needed, 0), out which);
        line = InstallPlace.SayRoom(one, Free(InstallPlace.Needed, 0), out colour);
        Yes("2d. exactly Needed is let through", refused == null, refused);
        Yes("2d. and the window does not refuse it", colour != "Bad", colour + ": " + line);

        refused = InstallPlace.Short(apart, Free(-1, -1), out which);
        line = InstallPlace.SayRoom(apart, Free(-1, -1), out colour);
        Yes("2e. a drive whose room cannot be read is not refused", refused == null, refused);
        Yes("2e. the window says it could not read it", colour == "Warn" && line.Contains("Could not read"), colour + ": " + line);

        long[] amounts = { -1, 0, G, 2 * G, 3 * G - 1, 3 * G, 5 * G, InstallPlace.Needed - 50L * 1048576, InstallPlace.Needed - 1,
                           InstallPlace.Needed, InstallPlace.Needed + G, InstallPlace.Needed + 2 * G, 100 * G };
        int tried = 0;
        string first = null;
        foreach (bool into in new[] { true, false })
            foreach (string steam in new[] { C, D })
                foreach (long c in amounts)
                    foreach (long d in amounts)
                    {
                        List<InstallPlace.Room> rooms = InstallPlace.Rooms(C, steam, into);
                        string r = InstallPlace.Short(rooms, Free(c, d), out which);
                        string l = InstallPlace.SayRoom(rooms, Free(c, d), out colour);
                        tried++;
                        bool agree = (colour == "Bad") == (r != null) && (r == null || l.Contains(r));
                        if (!agree && first == null)
                            first = (into ? "into Steam" : "own folder") + ", Steam on " + steam + ", " + c + " and " + d + " bytes: " + colour + ": " + l + " / " + r;
                    }
        Yes("2f. over " + tried + " cases, the window's line refuses exactly when Install would", first == null, first);
        return failed > 0 ? 1 : 0;
    }
}
'@

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet) $LauncherDotnet
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$dll = $null
try {
    $dll = Build-LauncherCode -Exe -Source $driver -File @(
        (Join-Path $App 'InstallSteps.cs'), (Join-Path $App 'InstallAgreements.cs'), (Join-Path $App 'PathFence.cs'),
        (Join-Path $App 'InstallPlace.cs'), (Join-Path $App 'InstallShortcut.cs'), (Join-Path $App 'Failure.cs'), (Join-Path $App 'WholeFile.cs')) `
        -Resource @{ 'skyrim-files.json' = (Under $Repo 'records\skyrim-files.json') }
} catch { Yes '2. the room rule builds with a driver' $false $_.Exception.Message; Done }
Yes '2. the room rule builds with a driver' ($null -ne $dll)

$out = @(Invoke-LauncherExe $dll 2>&1 | ForEach-Object { "$_" })
$code = $LASTEXITCODE
foreach ($l in $out) {
    if ($l -match '^PASS  (.*)$') { Yes $Matches[1] $true }
    elseif ($l -match '^FAIL  (.*)$') { Yes $Matches[1] $false }
}
Yes '2. the driver ran to its end' ($code -eq 0 -or @($out | Where-Object { $_ -match '^FAIL  ' }).Count -gt 0) ($out -join ' / ')
Done
