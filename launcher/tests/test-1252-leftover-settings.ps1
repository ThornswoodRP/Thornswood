<#
  test-1252-leftover-settings.ps1

      pwsh -NoProfile -File .\launcher\tests\test-1252-leftover-settings.ps1
      pwsh -NoProfile -File .\launcher\tests\test-1252-leftover-settings.ps1 -Recorded <folder>

  The dev release records of 28 and 29 Sep listed the machine that ships' mod
  menu settings, window layouts and notes as Thornswood's files, so a dev
  launcher that synced to one fetched them (#1252). Patrick's answer, 5 Oct:
  take each one out of Thornswood's own game folder only, and only while its
  bytes are still exactly what the record handed out; a file the person has
  changed since is theirs and stays. Leaks.cs carries the list (path, size,
  sha256) and does it at every start.

  WHAT THIS HOLDS THE LAUNCHER TO.
    1. The list in Leaks.cs is the nine paths of #1252, each with a size and a
       sha256, the join pass with the two it was handed out as, and every one
       of them is a file Ship-Rules keeps out of every pack and record, so
       nothing hands it out again.
    2. In Thornswood's own folder, a file with the bytes the record handed out
       is removed, one path at a time and all at once, read only or not, and
       the log line names what went and says nothing banned.
    3. The same path with other bytes stays byte for byte: the same size with
       one byte changed, longer, and shorter.
    4. Never anywhere else: the Steam copy beside an own folder, the Steam
       copy of an install with no folder of its own, and Profile\Payload while
       the own folder is chosen and not made all keep the handed out bytes.
    5. A file the own folder shares with the Steam copy by hard link loses
       only the own folder's name; the Steam copy's file stays, bytes and
       attributes as they were.
    6. A second start finds nothing and says nothing, and the saved sign in
       of 16 Sep is still taken as before.
    7. With -Recorded, a folder holding the files as the records handed them
       out, each named by its sha256: the list as it is in Leaks.cs, not a
       stand-in, removes each of them and keeps each with one byte changed.
       The bytes are one machine's settings and two expired join passes, so
       they are not in the repository (tests\test-no-machine-files.ps1); on a
       machine without them this part says so and is skipped.

  HOW. Builds the whole launcher with a driver into one program (the .NET
  SDK the launcher builds with, tests\Launcher-Csc.ps1, #4823), on every
  machine, points Steam.cs at a pretend Steam in a scratch folder, and runs
  the real Leaks.Clean. The run is Windows only: the launcher lays out its
  install and the game by Windows paths, and 5 makes the hard link with
  kernel32; elsewhere 2 to 7 say SKIP. For 2 to 6
  the driver gives each entry of the list planted bytes of its own, through
  reflection on the array, keeping the path; 7 leaves the list alone.

  Nothing outside its own scratch folder and its build under out\harness is
  written; the repository and the -Recorded folder are only read.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch, [string]$Recorded)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }
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

$App = Join-Path $Repo 'launcher\app'
$LeaksCs = Join-Path $App 'Leaks.cs'

# ---- 1: the list itself --------------------------------------------------------
$src = [IO.File]::ReadAllText($LeaksCs)
$m = [regex]::Match($src, '(?s)static readonly string\[\]\[\] Synced = \{(.*?)\n        \};')
Yes 'Leaks.cs has the list of files the dev records handed out (Synced)' $m.Success
if (-not $m.Success) { Done }
$entries = @([regex]::Matches($m.Groups[1].Value, 'new\[\] \{ "([^"]+)", "(\d+)",\s*"([0-9a-f]+)" \}') | ForEach-Object {
    [pscustomobject]@{ Path = $_.Groups[1].Value.Replace('\\', '\'); Size = [long]$_.Groups[2].Value; Sha = $_.Groups[3].Value }
})
$nine = @(
    'Data\MCM\Settings\Precision.ini',
    'Data\MCM\Settings\TrueDirectionalMovement.ini',
    'Data\MCM\Settings\TrueHUD.ini',
    'Data\SKSE\Plugins\CommunityShaders\SettingsUser.json',
    'Data\SKSE\Plugins\CommunityShaders_ImGui.ini',
    'Data\SKSE\Plugins\OpenAnimationReplacer_ImGui.ini',
    'Data\Platform\thornswood-spots.txt',
    'Data\Platform\js-hang-culprit.txt',
    'Data\Platform\thornswood-pass.txt'
)
$paths = @($entries | ForEach-Object { $_.Path } | Sort-Object -Unique)
Yes ('the list names exactly the nine paths of #1252 (' + $paths.Count + ' paths, ' + $entries.Count + ' entries)') (
    $paths.Count -eq 9 -and @($nine | Where-Object { $paths -notcontains $_ }).Count -eq 0)
Yes 'every entry has a size and a 64 character sha256' (@($entries | Where-Object { $_.Sha.Length -ne 64 -or $_.Size -le 0 }).Count -eq 0)
Yes 'no two entries are the same bytes' (@($entries | ForEach-Object { $_.Sha } | Sort-Object -Unique).Count -eq $entries.Count)
Yes 'the join pass is there with the two it was handed out as, and every other path once' (
    @($entries | Where-Object { $_.Path -eq 'Data\Platform\thornswood-pass.txt' }).Count -eq 2 -and
    @($entries | Group-Object Path | Where-Object { $_.Name -ne 'Data\Platform\thornswood-pass.txt' -and $_.Count -ne 1 }).Count -eq 0)
. (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')
$shipped = @($paths | Where-Object { -not (Test-ShipMachine $_) })
Yes ('Ship-Rules keeps every one of them out of packs and records (Test-ShipMachine)' + $(if ($shipped.Count) { ', not ' + ($shipped -join ', ') } else { '' })) ($shipped.Count -eq 0)
Yes 'the list is only ever used against Thornswood''s own folder (OwnGame.Active, OwnGame.Folder), never Paths.Game or the Steam copy' (
    $src -match '(?s)static string CleanSynced\(\)\s*\{\s*bool own;\s*try \{ own = OwnGame\.Active; \}.*?if \(!own\) return null;.*?Path\.Combine\(OwnGame\.Folder, s\[0\]\)' -and
    -not ([regex]::Match($src, '(?s)static string CleanSynced\(\).*?\n        \}').Value -match 'Paths\.Game|OwnGame\.Source|SteamCopy'))
Yes 'a match takes only this folder''s name for the file (OwnGame.DropName), not its attributes' ([regex]::Match($src, '(?s)static string CleanSynced\(\).*?\n        \}').Value -match 'OwnGame\.DropName\(p\);' -and
    -not ([regex]::Match($src, '(?s)static string CleanSynced\(\).*?\n        \}').Value -match 'SetAttributes'))

# ---- the launcher, compiled with a driver ---------------------------------------
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Thornswood
{
    static class LeftoverSettingsTest
    {
        static int pass, fail;
        static void Yes(string what, bool cond)
        {
            Console.WriteLine((cond ? "PASS  " : "FAIL  ") + what);
            if (cond) pass++; else fail++;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CreateHardLink(string newName, string existing, IntPtr security);

        static string T;
        // The array Leaks reads, changed in place, and the list as it ships.
        static string[][] Live;
        static string[][] Real;
        static string[][] Sign;

        static string Sha(byte[] b)
        {
            using (var sha = SHA256.Create())
            {
                var sb = new StringBuilder(64);
                foreach (byte x in sha.ComputeHash(b)) sb.Append(x.ToString("x2"));
                return sb.ToString();
            }
        }

        static void Put(string path, byte[] b)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, b);
        }

        static bool Holds(string path, byte[] b)
        {
            if (!File.Exists(path)) return false;
            byte[] now = File.ReadAllBytes(path);
            if (now.Length != b.Length) return false;
            for (int i = 0; i < b.Length; i++) if (now[i] != b[i]) return false;
            return true;
        }

        // The bytes planted for entry i: its own, so that the list given to
        // Leaks says these are what the record handed out.
        static byte[] Handed(int i)
        {
            var sb = new StringBuilder();
            sb.Append("handed out by a dev record of 28 or 29 Sep, entry " + i + ": " + Real[i][0] + "\r\n");
            for (int k = 0; k < 3 + i; k++) sb.Append("value" + k + "=" + (k * 7 + i) + "\r\n");
            return Encoding.ASCII.GetBytes(sb.ToString());
        }

        static void UsePlanted()
        {
            for (int i = 0; i < Live.Length; i++)
            {
                byte[] b = Handed(i);
                Live[i] = new string[] { Real[i][0], b.Length.ToString(), Sha(b) };
            }
        }

        static void UseReal()
        {
            for (int i = 0; i < Live.Length; i++) Live[i] = (string[])Real[i].Clone();
        }

        static bool Clean(string said)
        {
            return said == null || (said.IndexOf((char)0x2014) < 0 && said.IndexOf("player", StringComparison.OrdinalIgnoreCase) < 0);
        }

        class Scene
        {
            public string Dir, Steam, SteamGame, Ts;
            public Config Cfg;
        }

        // own: Thornswood's own folder made (Root\Game and its record).
        // payload: chosen at install and not made (Profile\Payload).
        static Scene Open(string name, bool own, bool payload)
        {
            var s = new Scene();
            s.Dir = Path.Combine(T, name);
            s.Steam = Path.Combine(s.Dir, "steam");
            s.SteamGame = Path.Combine(s.Steam, "steamapps\\common\\Skyrim Special Edition");
            s.Ts = Path.Combine(s.Dir, "Thornswood");
            Put(Path.Combine(s.SteamGame, "SkyrimSE.exe"), Encoding.ASCII.GetBytes("STEAM-EXE"));
            Directory.CreateDirectory(Path.Combine(s.Ts, "Profile"));
            if (own)
            {
                Put(Path.Combine(s.Ts, "Game\\SkyrimSE.exe"), Encoding.ASCII.GetBytes("OWN-EXE"));
                Put(Path.Combine(s.Ts, "Profile\\OwnGame\\files.txt"), Encoding.ASCII.GetBytes("C|O|7|0|SkyrimSE.exe\r\n"));
            }
            if (payload) Directory.CreateDirectory(Path.Combine(s.Ts, "Profile\\Payload"));
            Steam.RootForTest = s.Steam;
            Paths.Init(s.Ts);
            s.Cfg = Config.Load(Paths.CfgFile);
            return s;
        }

        static int Main(string[] args)
        {
            T = args[0];
            string recorded = args.Length > 1 ? args[1] : "";
            FieldInfo f = typeof(Leaks).GetField("Synced", BindingFlags.NonPublic | BindingFlags.Static);
            Live = (string[][])f.GetValue(null);
            Real = new string[Live.Length][];
            for (int i = 0; i < Live.Length; i++) Real[i] = (string[])Live[i].Clone();
            Sign = (string[][])typeof(Leaks).GetField("Shipped", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);

            UsePlanted();
            OwnFolder();
            ChangedStays();
            NeverElsewhere();
            HardLink();
            SecondStart();
            UseReal();
            RealBytes(recorded);

            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            return fail == 0 ? 0 : 1;
        }

        // 2: one path at a time, then all at once, one of them read only.
        static void OwnFolder()
        {
            for (int i = 0; i < Live.Length; i++)
            {
                Scene s = Open("one-" + i, true, false);
                string at = Path.Combine(OwnGame.Folder, Live[i][0]);
                Put(at, Handed(i));
                Yes("the run is in Thornswood's own folder (" + i + ")", OwnGame.Active);
                string said = Leaks.Clean(s.Cfg);
                Yes("own folder: " + Live[i][0] + " with the bytes entry " + i + " was handed out as is removed", !File.Exists(at));
                Yes("  and the log line names it and says nothing banned", said != null && said.IndexOf(Live[i][0], StringComparison.Ordinal) >= 0 && Clean(said));
            }

            Scene a = Open("all", true, false);
            var planted = new List<string>();
            for (int i = 0; i < Live.Length; i++)
            {
                // The pass has two entries for one path; the second is the one
                // planted here, the first had its own round above.
                if (i + 1 < Live.Length && Live[i + 1][0] == Live[i][0]) continue;
                string at = Path.Combine(OwnGame.Folder, Live[i][0]);
                Put(at, Handed(i));
                planted.Add(at);
            }
            File.SetAttributes(planted[0], FileAttributes.ReadOnly);
            string beside = Path.Combine(OwnGame.Folder, "Data\\MCM\\Settings\\SomeoneElse.ini");
            Put(beside, Encoding.ASCII.GetBytes("a mod menu file nobody handed out"));
            string all = Leaks.Clean(a.Cfg);
            int left = 0;
            foreach (string p in planted) if (File.Exists(p)) left++;
            Yes("own folder, all nine paths at once (one read only): every one removed (" + planted.Count + " planted, " + left + " left)", planted.Count == 9 && left == 0);
            Yes("  a file the list does not name, beside them, stays", File.Exists(beside));
            Yes("  one log line says how many went and that a changed copy is kept", all != null && all.IndexOf("Removed 9 files from Thornswood's own folder", StringComparison.Ordinal) >= 0 &&
                all.IndexOf("A copy changed since is yours and was kept.", StringComparison.Ordinal) >= 0 && Clean(all));
        }

        // 3: changed since it was handed out: the person's own.
        static void ChangedStays()
        {
            for (int i = 0; i < Live.Length; i++)
            {
                byte[] b = Handed(i);
                byte[] same = (byte[])b.Clone(); same[same.Length - 3] ^= 0x01;
                byte[] longer = new byte[b.Length + 1]; Array.Copy(b, longer, b.Length); longer[b.Length] = (byte)'\n';
                byte[] shorter = new byte[b.Length - 1]; Array.Copy(b, shorter, shorter.Length);
                byte[][] kinds = { same, longer, shorter };
                string[] names = { "the same size with one byte changed", "one byte longer", "one byte shorter" };
                for (int k = 0; k < kinds.Length; k++)
                {
                    Scene s = Open("changed-" + i + "-" + k, true, false);
                    string at = Path.Combine(OwnGame.Folder, Live[i][0]);
                    Put(at, kinds[k]);
                    DateTime when = File.GetLastWriteTimeUtc(at);
                    string said = Leaks.Clean(s.Cfg);
                    Yes("own folder: " + Live[i][0] + ", " + names[k] + ", stays byte for byte", Holds(at, kinds[k]) && File.GetLastWriteTimeUtc(at) == when);
                    Yes("  and nothing is said about it", said == null);
                }
            }
        }

        // 4: the Steam copy, an install without a folder of its own, Payload.
        static void NeverElsewhere()
        {
            Scene s = Open("steam-beside-own", true, false);
            var steam = new List<string>();
            for (int i = 0; i < Live.Length; i++)
            {
                if (i + 1 < Live.Length && Live[i + 1][0] == Live[i][0]) continue;
                string at = Path.Combine(s.SteamGame, Live[i][0]);
                Put(at, Handed(i));
                steam.Add(at);
            }
            string said = Leaks.Clean(s.Cfg);
            int kept = 0;
            foreach (string p in steam) if (File.Exists(p)) kept++;
            Yes("with an own folder, the Steam copy keeps all nine with the handed out bytes (" + kept + " of " + steam.Count + ")", kept == 9 && said == null);

            Scene c = Open("no-own-folder", false, false);
            Yes("an install with no folder of its own runs from the Steam copy", Paths.Collection && !OwnGame.Active &&
                string.Equals(Paths.Game, c.SteamGame, StringComparison.OrdinalIgnoreCase));
            var col = new List<string>();
            for (int i = 0; i < Live.Length; i++)
            {
                if (i + 1 < Live.Length && Live[i + 1][0] == Live[i][0]) continue;
                string at = Path.Combine(c.SteamGame, Live[i][0]);
                Put(at, Handed(i));
                col.Add(at);
            }
            said = Leaks.Clean(c.Cfg);
            kept = 0;
            foreach (string p in col) if (File.Exists(p)) kept++;
            Yes("  and its Steam copy keeps all nine (" + kept + " of " + col.Count + ")", kept == 9 && said == null);

            Scene p0 = Open("payload", false, true);
            Yes("an install whose own folder is chosen and not made runs from Profile\\Payload", Paths.OwnFirst && !OwnGame.Active);
            var pay = new List<string>();
            for (int i = 0; i < Live.Length; i++)
            {
                if (i + 1 < Live.Length && Live[i + 1][0] == Live[i][0]) continue;
                string at = Path.Combine(Paths.Payload, Live[i][0]);
                Put(at, Handed(i));
                pay.Add(at);
                Put(Path.Combine(p0.SteamGame, Live[i][0]), Handed(i));
            }
            said = Leaks.Clean(p0.Cfg);
            kept = 0;
            foreach (string p in pay) if (File.Exists(p) && File.Exists(p.Replace(Paths.Payload, p0.SteamGame))) kept++;
            Yes("  and Payload and the Steam copy keep all nine (" + kept + " of " + pay.Count + ")", kept == 9 && said == null);
        }

        // 5: shared with the Steam copy by hard link.
        static void HardLink()
        {
            Scene s = Open("hard-link", true, false);
            int i = 0;
            string inSteam = Path.Combine(s.SteamGame, Live[i][0]);
            string inOwn = Path.Combine(OwnGame.Folder, Live[i][0]);
            Put(inSteam, Handed(i));
            // Not read only: attributes belong to the file, not the name, and
            // OwnGame.DropName clears read only when the delete is refused, as
            // it does for every name Refresh drops. Since #1218 (Rules 11) no
            // file but Skyrim's archives is shared with the Steam copy anyway.
            File.SetAttributes(inSteam, FileAttributes.Archive);
            Directory.CreateDirectory(Path.GetDirectoryName(inOwn));
            bool linked = CreateHardLink(inOwn, inSteam, IntPtr.Zero);
            Yes("the own folder's copy is a hard link to the Steam copy's", linked);
            FileAttributes before = File.GetAttributes(inSteam);
            DateTime when = File.GetLastWriteTimeUtc(inSteam);
            string said = Leaks.Clean(s.Cfg);
            Yes("  the own folder's name for it goes", !File.Exists(inOwn) && said != null);
            Yes("  the Steam copy's stays, bytes, write time and attributes as they were", Holds(inSteam, Handed(i)) &&
                File.GetLastWriteTimeUtc(inSteam) == when && File.GetAttributes(inSteam) == before);
        }

        // 6: a second start, and the sign in of 16 Sep as before.
        static void SecondStart()
        {
            Scene s = Open("second-start", true, false);
            string at = Path.Combine(OwnGame.Folder, Live[0][0]);
            Put(at, Handed(0));
            string first = Leaks.Clean(s.Cfg);
            string second = Leaks.Clean(s.Cfg);
            Yes("a second start finds nothing more and says nothing", first != null && second == null);

            string[] keep = (string[])Sign[0].Clone();
            byte[] token = Encoding.ASCII.GetBytes("the saved sign in the 16 Sep installer carried");
            Sign[0] = new string[] { keep[0], Sha(token) };
            Scene g = Open("sign-in", true, false);
            string own = Path.Combine(OwnGame.Folder, keep[0]);
            string steam = Path.Combine(g.SteamGame, keep[0]);
            Put(own, token);
            Put(steam, token);
            string settings = Path.Combine(OwnGame.Folder, Live[1][0]);
            Put(settings, Handed(1));
            string said = Leaks.Clean(g.Cfg);
            Yes("the 16 Sep sign in still goes from the own folder and the Steam copy, beside the settings", !File.Exists(own) && !File.Exists(steam) && !File.Exists(settings));
            Yes("  and the log says both, in one line", said != null && said.IndexOf("saved sign in files", StringComparison.Ordinal) >= 0 &&
                said.IndexOf("Removed 1 file from Thornswood's own folder", StringComparison.Ordinal) >= 0 && Clean(said));
            Sign[0] = keep;
        }

        // 7: the list as it ships, against the bytes the records handed out.
        static void RealBytes(string recorded)
        {
            if (recorded.Length == 0 || !Directory.Exists(recorded))
            {
                Console.WriteLine("NOTE  no folder of the recorded bytes was given (-Recorded), so the list's own sha256s were checked by their shape only");
                return;
            }
            for (int i = 0; i < Live.Length; i++)
            {
                string from = Path.Combine(recorded, Live[i][2]);
                Yes("the recorded bytes of " + Live[i][0] + " (" + Live[i][2].Substring(0, 12) + ") are in " + recorded, File.Exists(from));
                if (!File.Exists(from)) continue;
                byte[] b = File.ReadAllBytes(from);
                Yes("  they are the size and sha256 the list has", b.Length.ToString() == Live[i][1] && Sha(b) == Live[i][2]);

                Scene s = Open("real-" + i, true, false);
                string at = Path.Combine(OwnGame.Folder, Live[i][0]);
                Put(at, b);
                string said = Leaks.Clean(s.Cfg);
                Yes("  the list as it ships removes them from the own folder", !File.Exists(at) && said != null && Clean(said));

                byte[] changed = (byte[])b.Clone(); changed[changed.Length / 2] ^= 0x01;
                Scene c = Open("real-changed-" + i, true, false);
                at = Path.Combine(OwnGame.Folder, Live[i][0]);
                Put(at, changed);
                said = Leaks.Clean(c.Cfg);
                Yes("  and keeps them with one byte changed", Holds(at, changed) && said == null);
            }
        }
    }
}
'@

$exe = $null
try { $exe = Build-LauncherCode -Launcher -Exe -Main 'Thornswood.LeftoverSettingsTest' -Source $driver }
catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the driver build with the .NET SDK the launcher builds with' ($null -ne $exe)
if (-not $exe) { Done }
if (-not $OnWindows) {
    Write-Host 'SKIP  2 to 7, Leaks.Clean run against pretend installs: the launcher lays out its install and the game by Windows paths, and 5 makes its hard link with kernel32, so they run on Windows only'
    Done
}

$T = Join-Path $Scratch ('leftover-settings-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$run = Join-Path $T 'run'
$null = New-Item -ItemType Directory -Force -Path $run
$driverArgs = @($run)
if ($Recorded) { $driverArgs += (Resolve-Path -LiteralPath $Recorded).Path }
$out = Invoke-LauncherExe $exe @driverArgs 2>&1 | ForEach-Object { "$_" }
foreach ($l in $out) {
    if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
    elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
    elseif ($l -match '^driver: ') { }
    else { Write-Host $l }
}
Yes 'the driver ran and reported' (@($out | Where-Object { $_ -match '^driver: ' }).Count -eq 1)

try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
Done
