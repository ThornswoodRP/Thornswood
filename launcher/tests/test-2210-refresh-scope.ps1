<#
  test-2210-refresh-scope.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2210-refresh-scope.ps1

  Issue #2210. "Preparing the game folder" walked every file in the folder
  whatever had moved. A launcher update that raised OwnGame.Rules made every
  install walk all thirty thousand files once, though rules 14, 15 and 16 are
  each about one plugin or the client's page folder. And for every file it did
  not change, the walk asked Windows how many names the file has up to three
  times.

  WHAT IT HOLDS THE LAUNCHER TO.
    1. RulesScope: a folder behind only on rules that name their paths in
       RuleTouches looks at those paths; one older than 14, or on the current
       rules, has no scope, so it is walked whole.
    2. A refresh when Vortex has not deployed since and only the rules moved
       (15 to 16): a file under Data\Platform\UI that the new rules leave out
       is taken out; every file outside that path keeps its line of the
       record exactly, and is not touched, even one whose record is out of
       date or that has a second name; what was left out before outside the
       path stays on left-out.txt; made.txt is on the current rules after it;
       and the log line says what it looked at and how long it took.
    3. Rules 5, 6 and 11 are one-time moves (decided by Patrick on 12 Oct): a
       folder on rules 4 is walked whole, a copy it keeps that has a second
       name is its own copy again (a Vortex file and the game's master), and a
       Distribution redistributable it held as a copy is a hard link again. A
       folder on rules 12, also walked whole, has none of that done again: no
       file it does not change is asked for its names, and a file it does not
       open keeps the L or C its record had.
    4. Every number from 14 to the current Rules has a line in RuleTouches, so
       raising Rules without saying what the rule is about fails here.
    5. Vortex deployed since: the refresh compares Vortex's record with the
       one it last took in (Profile\OwnGame\vortex.txt, written by Make and
       Refresh) and looks only at the files whose entry moved: a newer mod's
       file comes in, a new mod's file comes in, a file Vortex no longer
       deploys goes, and every other line of the record is carried forward
       untouched. The same record deployed again looks at no file. With no
       vortex.txt, or one kept for another Vortex folder, everything is walked.
    6. Vortex deploying into a Thornswood game folder (another install's, here
       a pretend dev build) is refused: Choose Vortex's folder will not take
       it, WhyNot names it with the Steam copy and the Forget button,
       NeedsRefresh does not ask, Bring it up to date refuses it, and pointed
       back at the Steam copy nothing is refused.
    7. One writer at a time (decided by Patrick on 12 Oct: the folder is
       prepared during the update's download): OwnGame.Alone makes a second
       writer wait for the first and says so, a refresh started while an
       update writes runs after it, and work under Alone may itself refresh.

  HOW. As test-own-folder-alone.ps1: the shipped OwnGame.cs and the files it
  needs, built with the .NET SDK the launcher builds with
  (tests\Launcher-Csc.ps1, #4823) on every machine, stand-ins for Checks,
  Keep, Updater and Junction, and a driver that builds a pretend Steam, Steam
  copy and Vortex in a scratch folder. The driver runs on Windows only:
  OwnGame lays the game folder out by Windows paths and links with kernel32,
  so 1 to 3 and 5 to 7 say SKIP elsewhere.

  Nothing outside its own scratch folder and its build under out\harness is
  read or written.
#>
[CmdletBinding()]
param([string]$AppPath, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppPath) { $AppPath = Join-Path $Here 'launcher\app' }
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

# ---- 4: every rule from 14 on says what it is about --------------------------
$og = [IO.File]::ReadAllText((Join-Path $AppPath 'OwnGame.cs'))
$rulesNum = [regex]::Match($og, '(?m)^\s*const int Rules = (\d+);')
Yes 'OwnGame.Rules is there' $rulesNum.Success
if (-not $rulesNum.Success) { Done }
$touches = [regex]::Match($og, '(?s)static readonly Dictionary<int, string\[\]> RuleTouches = new Dictionary<int, string\[\]>\s*\{(.*?)\};')
Yes 'RuleTouches is there' $touches.Success
$missing = @()
for ($n = 14; $n -le [int]$rulesNum.Groups[1].Value; $n++) {
    if (-not $touches.Success -or $touches.Groups[1].Value -notmatch ('\{\s*' + $n + '\s*,')) { $missing += $n }
}
Yes ("every rule from 14 to " + $rulesNum.Groups[1].Value + " has a line in RuleTouches (null walks everything)" + $(if ($missing) { '; missing: ' + ($missing -join ', ') } else { '' })) ($missing.Count -eq 0)

# Vortex's plugin list is copied even when nothing was deployed (17 Oct):
# a refresh that returns "already matches" used to skip the copy, so a list
# changed in Vortex alone (a plugin enabled, a reinstall) never reached a
# release folder, and a Ship built from the stale list refused.
$early = [regex]::Match($og, '(?s)static string RefreshNow\(.*?if \(!string\.IsNullOrEmpty\(src\)(.*?)return "Thornswood''s own Skyrim folder already matches what Vortex has deployed\.";')
Yes 'the refresh that finds nothing to bring in still copies Vortex''s plugin list first' ($early.Success -and $early.Groups[1].Value -match 'BakeVortexList\(\);')
$settle = [regex]::Match($og, '(?s)static void SettleSettings\(bool first\)\s*\{(.*?)\n        \}')
Yes 'a refresh that brings files in copies it too (SettleSettings)' ($settle.Success -and $settle.Groups[1].Value -match 'BakeVortexList\(\);')

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

# OwnGameKinds and Verify name LastPlugin (#2791), which reads the game's archives through FromGameArchive.cs.
# Config and OwnGame read their JSON through LooseString.cs, and Downgrade asks with Ask.cs (#4823).
$real = @('OwnGame.cs', 'OwnGameShare.cs', 'OwnGameKinds.cs', 'Downgrade.cs', 'Steam.cs', 'Paths.cs', 'Config.cs', 'Secrets.cs', 'LoadOrder.cs', 'Swallow.cs', 'Progress.cs', 'LastPlugin.cs', 'FromGameArchive.cs', 'LooseString.cs', 'Ask.cs') |
    ForEach-Object { Join-Path $AppPath $_ }
foreach ($f in $real) { if (-not (Test-Path -LiteralPath $f)) { Yes "launcher\app\$([IO.Path]::GetFileName($f)) is there" $false; Done } }

$stubs = @'
using System;
using System.Collections.Generic;

namespace Thornswood
{
    static class Checks
    {
        public const string OffSuffix = ".thornswood-off";
        public static string VortexProfileDir(string name) { return null; }
        public static bool GameRunning() { return false; }
    }
    static class Keep
    {
        public static List<string> Held() { return new List<string>(); }
        public static string Dir { get { return System.IO.Path.Combine(Paths.ProfileDir, "Keep"); } }
    }
    static class Updater
    {
        public static bool ReleaseFilesKnown() { return true; }
        public static List<string> ReleaseFiles() { return new List<string>(); }
    }
    static class Junction { public static bool IsLink(string p) { return false; } }
}
'@

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    static class RefreshScopeTest
    {
        static int pass, fail;
        static void Yes(string what, bool cond)
        {
            Console.WriteLine((cond ? "PASS  " : "FAIL  ") + what);
            if (cond) pass++; else fail++;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct Info
        {
            public uint Attributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME C, A, W;
            public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetFileInformationByHandle(SafeFileHandle h, out Info info);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CreateHardLink(string newName, string existing, IntPtr security);

        static Info Of(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                Info i;
                GetFileInformationByHandle(fs.SafeFileHandle, out i);
                return i;
            }
        }
        static int Names(string path) { return (int)Of(path).Links; }
        static string Id(string path) { Info i = Of(path); return i.Volume + ":" + i.IndexHigh + ":" + i.IndexLow; }

        const int ExeBytes = 4096, NewerExeBytes = 5000;
        static string T;

        static void Put(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text, new UTF8Encoding(false));
        }

        static void Archive(string path, string mark)
        {
            var b = new byte[64 * 1024];
            byte[] m = Encoding.ASCII.GetBytes(mark);
            Array.Copy(m, b, m.Length);
            for (int i = m.Length + 1; i < b.Length; i++) b[i] = (byte)(1 + i % 250);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, b);
        }

        static void Exe(string path, string mark, int size)
        {
            var b = new byte[size];
            byte[] m = Encoding.ASCII.GetBytes(mark);
            Array.Copy(m, b, m.Length);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, b);
        }

        static string J(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

        class Scene
        {
            public string Dir, Steam, Game, Staging, Ts;
            public Config Cfg;
        }

        static readonly string Tex = "Data\\Skyrim - Textures0.bsa", Mesh = "Data\\Skyrim - Meshes0.bsa";
        static readonly string Master = "Data\\Skyrim.esm", Loose = "Data\\Video\\BGS_Logo.bik";

        // Vortex's files: a plugin and a texture (linked), a Nemesis patch
        // (.txt, kept as the folder's own copy), a redistributable under
        // Data\Platform\Distribution (linked though it is a .dll), and a file
        // of another menu under Data\Platform\UI that the rules leave out.
        // Each: the path under Data, the mod, its bytes, and the time Vortex's
        // record gives it. A scene starts from these and may change them.
        static readonly string[][] BaseFiles = {
            new string[] { "TsOne.esp", "ModA", "VORTEX-TSONE", "1" },
            new string[] { "textures\\ts\\wood.dds", "ModA", "VORTEX-DDS", "1" },
            new string[] { "Nemesis_Engine\\mod\\tdm\\patch.txt", "ModN", "NEMESIS-PATCH", "1" },
            new string[] { "Platform\\Distribution\\libcef.dll", "ModD", "VORTEX-CEF", "1" },
            new string[] { "Platform\\UI\\app.js", "ModU", "OTHER-MENU", "1" },
        };
        static List<string[]> Files;

        static Scene NewScene(string name)
        {
            var s = new Scene();
            s.Dir = Path.Combine(T, name);
            s.Steam = Path.Combine(s.Dir, "steam");
            s.Staging = Path.Combine(s.Dir, "vortex\\mods");
            s.Ts = Path.Combine(s.Dir, "Thornswood");
            s.Game = Path.Combine(s.Steam, "steamapps\\common\\Skyrim Special Edition");
            Put(Path.Combine(s.Steam, "config\\libraryfolders.vdf"),
                "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"" + J(s.Steam) + "\"\n\t}\n}\n");
            Steam.RootForTest = s.Steam;

            Paths.Root = s.Ts;
            Paths.LauncherDir = Path.Combine(s.Ts, "Launcher");
            Paths.ProfileDir = Path.Combine(s.Ts, "Profile");
            Paths.MyGames = Path.Combine(Paths.ProfileDir, "MyGames");
            Paths.LocalAD = Path.Combine(Paths.ProfileDir, "LocalAppData");
            Paths.Golden = Path.Combine(Paths.ProfileDir, "Default");
            Paths.Personal = Path.Combine(s.Ts, "Your Mods");
            Paths.Isolated = Path.Combine(Paths.ProfileDir, "Isolated");
            Paths.Replaced = Path.Combine(Paths.ProfileDir, "Replaced");
            Paths.StateFile = Path.Combine(Paths.ProfileDir, "swap.json");
            Paths.PlayedFile = Path.Combine(Paths.ProfileDir, "played.flag");
            Paths.AppliedFile = Path.Combine(Paths.ProfileDir, "applied.txt");
            Paths.PacksDir = Path.Combine(Paths.ProfileDir, "Packs");
            Paths.LogFile = Path.Combine(Paths.ProfileDir, "launcher.log");
            Paths.CfgFile = Path.Combine(s.Ts, "config.json");
            Paths.WinMyGames = Path.Combine(s.Dir, "windows\\My Games\\Skyrim Special Edition");
            Paths.WinLocalAD = Path.Combine(s.Dir, "windows\\LocalAppData\\Skyrim Special Edition");
            Paths.Collection = true;
            Paths.Game = s.Game;
            Paths.SteamCopy = s.Game;
            Paths.Payload = Path.Combine(Paths.ProfileDir, "Payload");
            Paths.OwnFirst = false;
            Paths.Live = Paths.WinLocalAD;
            Paths.LiveMyGames = Paths.WinMyGames;
            Directory.CreateDirectory(Paths.ProfileDir);
            string list = "# Automatically generated by Vortex\r\n*TsOne.esp\r\n";
            Put(Path.Combine(Paths.Golden, "plugins.txt"), list);
            Put(Path.Combine(Paths.WinLocalAD, "plugins.txt"), list);

            s.Cfg = new Config();
            s.Cfg.ServerAddress = "";
            s.Cfg.ExpectedExeBytes = ExeBytes;
            s.Cfg.NewerExeBytes = NewerExeBytes;
            s.Cfg.VortexGame = "";
            Files = new List<string[]>();
            foreach (string[] f in BaseFiles) Files.Add((string[])f.Clone());

            Exe(Path.Combine(s.Game, "SkyrimSE.exe"), "PIN-EXE", ExeBytes);
            Put(Path.Combine(s.Game, Master), "PIN-MASTER");
            Archive(Path.Combine(s.Game, Tex), "PIN-TEX0");
            Archive(Path.Combine(s.Game, Mesh), "PIN-MESH0");
            Put(Path.Combine(s.Game, Loose), "GAME-LOOSE");
            Put(Path.Combine(s.Game, "bink2w64.dll"), "GAME-BINK");
            Deploy(s, DateTime.UtcNow.AddMinutes(-10));
            return s;
        }

        static void Deploy(Scene s, DateTime when)
        {
            var sb = new StringBuilder();
            sb.Append("{\n  \"instance\": \"test\",\n  \"version\": 1,\n  \"deploymentMethod\": \"hardlink_activator\",\n  \"gameId\": \"skyrimse\",\n");
            sb.Append("  \"stagingPath\": \"" + J(s.Staging) + "\",\n  \"targetPath\": \"" + J(Path.Combine(s.Game, "Data")) + "\",\n  \"files\": [\n");
            for (int i = 0; i < Files.Count; i++)
            {
                string staged = Path.Combine(s.Staging, Files[i][1] + "\\" + Files[i][0]);
                if (!File.Exists(staged)) Put(staged, Files[i][2]);
                string at = Path.Combine(s.Game, "Data\\" + Files[i][0]);
                if (!File.Exists(at)) { Directory.CreateDirectory(Path.GetDirectoryName(at)); CreateHardLink(at, staged, IntPtr.Zero); }
                sb.Append("    { \"relPath\": \"" + J(Files[i][0]) + "\", \"source\": \"" + J(Files[i][1]) + "\", \"target\": \"\", \"time\": " + Files[i][3] + " }" + (i + 1 < Files.Count ? "," : "") + "\n");
            }
            sb.Append("  ]\n}\n");
            string rec = Path.Combine(s.Game, "Data\\vortex.deployment.json");
            Put(rec, sb.ToString());
            File.SetLastWriteTimeUtc(rec, when);
        }

        static void MadeNowRuns()
        {
            Paths.Collection = false;
            Paths.Game = OwnGame.Folder;
            Paths.Live = Paths.LocalAD;
            Paths.LiveMyGames = Paths.MyGames;
        }

        static string FilesTxt { get { return Path.Combine(OwnGame.Dir, "files.txt"); } }
        static string LeftOutTxt { get { return Path.Combine(OwnGame.Dir, "left-out.txt"); } }
        static string MadeTxt { get { return Path.Combine(OwnGame.Dir, "made.txt"); } }

        static Dictionary<string, string> Record()
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string l in File.ReadAllLines(FilesTxt))
            {
                string[] p = l.Split(new char[] { '|' }, 5);
                if (p.Length == 5) d[p[4]] = l;
            }
            return d;
        }

        static void SetRecorded(string key, string value)
        {
            var lines = new List<string>();
            foreach (string l in File.ReadAllLines(MadeTxt)) lines.Add(l.StartsWith(key + "=") ? key + "=" + value : l);
            File.WriteAllLines(MadeTxt, lines.ToArray());
        }

        static string Recorded(string key)
        {
            foreach (string l in File.ReadAllLines(MadeTxt)) if (l.StartsWith(key + "=")) return l.Substring(key.Length + 1);
            return null;
        }

        static readonly string Patch = "Data\\Nemesis_Engine\\mod\\tdm\\patch.txt", Wood = "Data\\textures\\ts\\wood.dds",
                               Cef = "Data\\Platform\\Distribution\\libcef.dll", Menu = "Data\\Platform\\UI\\app.js";

        // A folder made, then put in the shape one made under older rules
        // would be in: the other menu's file in it and on record, the Nemesis
        // patch with a second name in another folder (a release folder made by
        // hard linking this one), the redistributable as a copy of its own, a
        // record line out of date, and a line on left-out.txt outside UI.
        static Scene Prepared(string name, string rules)
        {
            Scene s = NewScene(name);
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            MadeNowRuns();
            string own = OwnGame.Folder;
            Yes("(" + name + ": made)", made != null && Directory.Exists(own));
            Yes("(" + name + ": the rules leave the other menu's file out at Make)", !File.Exists(Path.Combine(own, Menu)));

            var fi = new FileInfo(Path.Combine(s.Staging, "ModU\\Platform\\UI\\app.js"));
            Put(Path.Combine(own, Menu), "OTHER-MENU");
            var rec = new List<string>(File.ReadAllLines(FilesTxt));
            rec.Add("C|V|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks + "|" + Menu);
            for (int i = 0; i < rec.Count; i++)
                if (rec[i].EndsWith("|" + Wood)) { string[] p = rec[i].Split('|'); rec[i] = p[0] + "|" + p[1] + "|" + p[2] + "|1|" + Wood; }
            File.WriteAllLines(FilesTxt, rec.ToArray());

            string clone = Path.Combine(s.Dir, "release\\Game\\" + Patch);
            Directory.CreateDirectory(Path.GetDirectoryName(clone));
            CreateHardLink(clone, Path.Combine(own, Patch), IntPtr.Zero);
            string masterClone = Path.Combine(s.Dir, "release\\Game\\" + Master);
            Directory.CreateDirectory(Path.GetDirectoryName(masterClone));
            CreateHardLink(masterClone, Path.Combine(own, Master), IntPtr.Zero);

            string cef = Path.Combine(own, Cef);
            DateTime t = File.GetLastWriteTimeUtc(cef);
            byte[] b = File.ReadAllBytes(cef);
            File.Delete(cef);
            File.WriteAllBytes(cef, b);
            File.SetLastWriteTimeUtc(cef, t);

            File.AppendAllText(LeftOutTxt, "Data\\Elsewhere\\old.esp  (an old reason)\r\n");
            SetRecorded("rules", rules);
            Yes("(" + name + ": the patch has a second name, the redistributable is a copy)", Names(Path.Combine(own, Patch)) == 2 && Names(cef) == 1);
            return s;
        }

        static void Scoped()
        {
            Scene s = Prepared("scoped", "15");
            string own = OwnGame.Folder;
            Dictionary<string, string> before = Record();
            // As if Make could not bring the plugin over: vortex.txt has no
            // line for it, so the next refresh after a Vortex deploy looks at
            // it again. A rules-only refresh in between must not write it down
            // as taken in, since it does not look at it.
            string vt = Path.Combine(OwnGame.Dir, "vortex.txt");
            var vl = new List<string>();
            foreach (string l in File.ReadAllLines(vt)) if (!l.EndsWith("|Data\\TsOne.esp", StringComparison.OrdinalIgnoreCase)) vl.Add(l);
            File.WriteAllLines(vt, vl.ToArray());
            Yes("a folder on rules 15 that Vortex has not deployed into since asks for a refresh", OwnGame.NeedsRefresh(s.Cfg));
            string said = null;
            try { said = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            if (said != null) Console.WriteLine("      Refresh said: " + said);
            Yes("the refresh works", said != null);
            Yes("the other menu's file under Data\\Platform\\UI, which the new rules leave out, is taken out", !File.Exists(Path.Combine(own, Menu)) && !Record().ContainsKey(Menu));
            Yes("and left-out.txt says why", File.ReadAllText(LeftOutTxt).Contains(Menu + "  ("));
            Dictionary<string, string> after = Record();
            bool same = true;
            foreach (KeyValuePair<string, string> kv in before)
            {
                if (kv.Key.Equals(Menu, StringComparison.OrdinalIgnoreCase)) continue;
                string now;
                if (!after.TryGetValue(kv.Key, out now) || now != kv.Value) { same = false; Console.WriteLine("      moved: " + kv.Value + " -> " + now); }
            }
            Yes("every other line of the record is carried forward exactly, the out of date one included", same && after.Count == before.Count - 1);
            Yes("the Nemesis patch outside the path was not touched: it still has its second name", Names(Path.Combine(own, Patch)) == 2);
            Yes("the redistributable outside the path was not touched: still a copy", Names(Path.Combine(own, Cef)) == 1);
            Yes("what was left out before outside the path is still on left-out.txt", File.ReadAllText(LeftOutTxt).Contains("Data\\Elsewhere\\old.esp  (an old reason)"));
            Yes("made.txt is on the current rules, so it does not ask again", Recorded("rules") == RulesNow() && !OwnGame.NeedsRefresh(s.Cfg));
            Yes("the line says what it looked at, why, and how long it took",
                said != null && said.Contains("looking only at Data\\Platform\\UI\\") && said.Contains("only the rules about those changed") && said.Contains("It took "));
            string seenNow = File.ReadAllText(vt);
            Yes("vortex.txt gains only what the rules-only refresh looked at, not a file it did not take in",
                seenNow.Contains("|" + Menu) && !seenNow.Contains("|Data\\TsOne.esp"));
            Deploy(s, DateTime.UtcNow);
            said = Refreshed(s);
            Yes("so the next refresh after a Vortex deploy looks at that file again, and only it",
                said != null && said.Contains("looking only at the 1 file whose entry in Vortex's record changed") && File.ReadAllText(vt).Contains("|Data\\TsOne.esp"));

            // A folder made by a launcher before vortex.txt: the rules-only
            // refresh writes none, and the first refresh after a Vortex deploy
            // walks everything and writes it whole.
            File.Delete(vt);
            SetRecorded("rules", "15");
            said = Refreshed(s);
            Yes("a rules-only refresh of a folder with no vortex.txt writes none", said != null && said.Contains("looking only at Data\\Platform\\UI\\") && !File.Exists(vt));
            Deploy(s, DateTime.UtcNow.AddMinutes(1));
            said = Refreshed(s);
            Yes("  then a Vortex deploy walks everything once and writes it whole",
                said != null && said.Contains("looking at every file") && File.ReadAllText(vt).Contains("|Data\\TsOne.esp") && File.ReadAllText(vt).Contains("|" + Cef));
        }

        static string Refreshed(Scene s)
        {
            string said = null;
            try { said = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            if (said != null) Console.WriteLine("      Refresh said: " + said);
            return said;
        }

        // A folder older than rules 5, 6 and 11 is walked whole and has their
        // one-time moves made: the copies it keeps that have a second name
        // are its own again, the redistributable is a link again.
        static void Old(string name, string rules)
        {
            Scene s = Prepared(name, rules);
            string own = OwnGame.Folder;
            string said = Refreshed(s);
            Yes(name + " (rules " + rules + "): the whole folder is walked", said != null && said.Contains("looking at every file"));
            Yes(name + ": the other menu's file is taken out", !File.Exists(Path.Combine(own, Menu)));
            Yes(name + ": rule 5 once: the Nemesis patch is the folder's own copy again, and the other folder keeps its own", Names(Path.Combine(own, Patch)) == 1 &&
                File.ReadAllText(Path.Combine(own, Patch)) == "NEMESIS-PATCH");
            Yes(name + ": rule 11 once: the master is the folder's own copy again", Names(Path.Combine(own, Master)) == 1);
            Yes(name + ": the line says the copies had another name", said != null && said.Contains("had another name") && !said.Contains("animation file"));
            Yes(name + ": rule 6 once: the redistributable is a hard link to Vortex's again",
                Id(Path.Combine(own, Cef)) == Id(Path.Combine(s.Staging, "ModD\\Platform\\Distribution\\libcef.dll")));
            string woodLine;
            Yes(name + ": the out of date record line is read again from Vortex's file", Record().TryGetValue(Wood, out woodLine) && !woodLine.Contains("|1|" + Wood));
            Yes(name + ": the record says L or C as the disk holds it",
                Record()[Patch].StartsWith("C|") && Record()[Cef].StartsWith("L|") && Record()["Data\\TsOne.esp"].StartsWith("L|"));
            Yes(name + ": made.txt is on the current rules", Recorded("rules") == RulesNow() && !OwnGame.NeedsRefresh(s.Cfg));
        }

        // A folder past rules 11 (12, before the three kinds, so it is walked
        // whole): the moves are not made again. Nothing asks a file it does
        // not change how many names it has, and no copy is made its own again
        // at every refresh (#2210, decided by Patrick on 12 Oct).
        static void Past(string name, string rules)
        {
            Scene s = Prepared(name, rules);
            string own = OwnGame.Folder;
            string said = Refreshed(s);
            Yes(name + " (rules " + rules + "): the whole folder is walked", said != null && said.Contains("looking at every file"));
            Yes(name + ": the other menu's file is taken out", !File.Exists(Path.Combine(own, Menu)));
            Yes(name + ": the Nemesis patch is not separated again: it keeps its second name", Names(Path.Combine(own, Patch)) == 2);
            Yes(name + ": nor the master", Names(Path.Combine(own, Master)) == 2);
            Yes(name + ": the redistributable is not relinked: still a copy", Names(Path.Combine(own, Cef)) == 1);
            Yes(name + ": the line names no copies made its own", said != null && !said.Contains("had another name") && !said.Contains("hard links now"));
            string woodLine;
            Yes(name + ": the out of date record line is still read again from Vortex's file", Record().TryGetValue(Wood, out woodLine) && !woodLine.Contains("|1|" + Wood));
            Yes(name + ": a file not opened keeps the L or C its record had", Record()[Cef].StartsWith("L|") && Record()[Patch].StartsWith("C|"));
            Yes(name + ": made.txt is on the current rules", Recorded("rules") == RulesNow() && !OwnGame.NeedsRefresh(s.Cfg));
        }

        static string[] FileOf(string rel)
        {
            foreach (string[] f in Files) if (("Data\\" + f[0]).Equals(rel, StringComparison.OrdinalIgnoreCase)) return f;
            return null;
        }

        // Vortex deployed since, on the current rules: the refresh looks only
        // at the files whose entry in Vortex's record moved (#2210).
        static void Moved()
        {
            Scene s = Prepared("moved", RulesNow());
            string own = OwnGame.Folder;
            Yes("(moved: Make kept Vortex's record as it took it in)", File.Exists(Path.Combine(OwnGame.Dir, "vortex.txt")));
            Dictionary<string, string> before = Record();

            // Vortex now deploys a new wood texture from a newer ModA, one
            // file of a new mod, and no longer the Nemesis mod.
            string[] wood = FileOf(Wood);
            wood[1] = "ModA2"; wood[2] = "VORTEX-DDS-2"; wood[3] = "2000";
            Files.Add(new string[] { "textures\\ts\\stone.dds", "ModB", "VORTEX-STONE", "3000" });
            Files.Remove(FileOf(Patch));
            File.Delete(Path.Combine(s.Game, Wood));
            File.Delete(Path.Combine(s.Game, Patch));
            Deploy(s, DateTime.UtcNow);
            Yes("Vortex deployed since: a refresh is asked for", OwnGame.NeedsRefresh(s.Cfg));
            string said = Refreshed(s);
            Yes("the line says it looked only at the 3 files whose entry moved", said != null && said.Contains("looking only at the 3 files whose entry in Vortex's record changed, came or went"));
            Yes("the new wood texture is in, from the newer mod", File.Exists(Path.Combine(own, Wood)) && File.ReadAllText(Path.Combine(own, Wood)) == "VORTEX-DDS-2" &&
                Id(Path.Combine(own, Wood)) == Id(Path.Combine(s.Staging, "ModA2\\textures\\ts\\wood.dds")));
            Yes("the new mod's file is in and on record", File.Exists(Path.Combine(own, "Data\\textures\\ts\\stone.dds")) && Record().ContainsKey("Data\\textures\\ts\\stone.dds"));
            Yes("the Nemesis patch Vortex no longer deploys is taken out, and its other name kept", !File.Exists(Path.Combine(own, Patch)) && !Record().ContainsKey(Patch) &&
                File.Exists(Path.Combine(s.Dir, "release\\Game\\" + Patch)));
            Dictionary<string, string> after = Record();
            bool same = true;
            foreach (KeyValuePair<string, string> kv in before)
            {
                if (kv.Key.Equals(Wood, StringComparison.OrdinalIgnoreCase) || kv.Key.Equals(Patch, StringComparison.OrdinalIgnoreCase)) continue;
                string now;
                if (!after.TryGetValue(kv.Key, out now) || now != kv.Value) { same = false; Console.WriteLine("      moved: " + kv.Value + " -> " + now); }
            }
            Yes("every other line of the record is carried forward exactly", same);
            Yes("the redistributable whose entry did not move was not touched: still a copy", Names(Path.Combine(own, Cef)) == 1);
            Yes("the master was not touched: still its second name", Names(Path.Combine(own, Master)) == 2);
            Yes("made.txt has the new deployment, so it does not ask again", !OwnGame.NeedsRefresh(s.Cfg));
            string seen = File.ReadAllText(Path.Combine(OwnGame.Dir, "vortex.txt"));
            Yes("vortex.txt has the record as this refresh took it in", seen.Contains("ModA2|2000|" + Wood) && seen.Contains("ModB|3000|Data\\textures\\ts\\stone.dds") && !seen.Contains(Patch));

            // Vortex deploys again with the same record: the stamp moved, no entry did.
            Deploy(s, DateTime.UtcNow.AddMinutes(1));
            said = Refreshed(s);
            Yes("Vortex deploying the same record again: no file is looked at", said != null && said.Contains("already matches") && said.Contains("looking at no file"));

            // No vortex.txt (a folder made before this launcher): everything is walked once, and it is written.
            File.Delete(Path.Combine(OwnGame.Dir, "vortex.txt"));
            Deploy(s, DateTime.UtcNow.AddMinutes(2));
            said = Refreshed(s);
            Yes("with no earlier record of Vortex's to compare with, the whole folder is walked", said != null && said.Contains("looking at every file"));
            Yes("and vortex.txt is written for the next one", File.Exists(Path.Combine(OwnGame.Dir, "vortex.txt")));

            // A vortex.txt for another folder Vortex deployed into is not compared with.
            var seenLines = new List<string>(File.ReadAllLines(Path.Combine(OwnGame.Dir, "vortex.txt")));
            seenLines[0] = "source=" + Path.Combine(s.Dir, "elsewhere");
            File.WriteAllLines(Path.Combine(OwnGame.Dir, "vortex.txt"), seenLines.ToArray());
            Deploy(s, DateTime.UtcNow.AddMinutes(3));
            said = Refreshed(s);
            Yes("a record kept for another Vortex folder walks everything", said != null && said.Contains("looking at every file"));
        }

        // One writer at a time (#2210): an update downloads beside a refresh
        // and writes under OwnGame.Alone, so its write waits for a refresh
        // under way, and a refresh waits for an update's write.
        static void OneWriter()
        {
            Scene s = Prepared("one-writer", RulesNow());
            var held = new System.Threading.ManualResetEvent(false);
            var order = new List<string>();
            System.Threading.ThreadStart writer = delegate()
            {
                OwnGame.Alone(delegate
                {
                    held.Set();
                    System.Threading.Thread.Sleep(400);
                    lock (order) order.Add("first");
                }, null);
            };
            var t = new System.Threading.Thread(writer);
            t.Start();
            held.WaitOne();
            bool waited = false;
            OwnGame.Alone(delegate { lock (order) order.Add("second"); }, delegate { waited = true; });
            t.Join();
            Yes("a second writer waits for the first, and is told it waits", waited && order.Count == 2 && order[0] == "first");

            held.Reset();
            order.Clear();
            SetRecorded("rules", "15");
            t = new System.Threading.Thread(writer);
            t.Start();
            held.WaitOne();
            string said = Refreshed(s);
            lock (order) order.Add("refresh");
            t.Join();
            Yes("a refresh started while an update writes runs after it", said != null && order.Count == 2 && order[0] == "first");
            Yes("Alone runs work that itself refreshes, on the same thread", RanInside(s));
        }

        static bool RanInside(Scene s)
        {
            SetRecorded("rules", "15");
            string said = null;
            OwnGame.Alone(delegate { said = Refreshed(s); }, null);
            return said != null;
        }

        // Vortex deploys into a Thornswood game folder: nothing is made or
        // brought up to date from it (#2210, decided by Patrick on 12 Oct).
        static void Refused()
        {
            Scene s = Prepared("refused", RulesNow());
            string other = Path.Combine(s.Dir, "Thornswood-DevBuild");
            string otherGame = Path.Combine(other, "Game");
            Put(Path.Combine(other, "Profile\\OwnGame\\files.txt"), "L|V|1|1|Data\\TsOne.esp\r\n");
            Exe(Path.Combine(otherGame, "SkyrimSE.exe"), "PIN-EXE", ExeBytes);
            Put(Path.Combine(otherGame, "Data\\vortex.deployment.json"), File.ReadAllText(Path.Combine(s.Game, "Data\\vortex.deployment.json")));
            Yes("ThornswoodInstallOf names the install whose game folder it is", string.Equals(OwnGame.ThornswoodInstallOf(otherGame), other, StringComparison.OrdinalIgnoreCase) &&
                OwnGame.ThornswoodInstallOf(s.Game) == null);

            bool ok;
            string said = OwnGame.PointAt(s.Cfg, otherGame, out ok);
            Console.WriteLine("      PointAt said: " + said);
            Yes("Choose Vortex's folder refuses a Thornswood game folder and keeps the setting", !ok && s.Cfg.VortexGame == "" && said.Contains("game folder of the Thornswood install in " + other));

            s.Cfg.VortexGame = otherGame;
            string why = OwnGame.WhyNot(s.Cfg, OwnGame.DeploysInto(s.Cfg));
            Console.WriteLine("      WhyNot said: " + why);
            Yes("WhyNot refuses it, says why, and names the Steam copy and the Forget button", why != null && why.Contains("game folder of the Thornswood install in " + other) &&
                why.Contains(s.Game) && why.Contains("Forget the chosen folder"));
            Yes("NeedsRefresh does not ask for a refresh from it", !OwnGame.NeedsRefresh(s.Cfg));
            Yes("RefusedSource says the same for the start of the launcher", OwnGame.RefusedSource(s.Cfg) == why);
            string threw = null;
            try { OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { threw = ex.Message; }
            Yes("Bring it up to date refuses it too", threw != null && threw.Contains("game folder of the Thornswood install"));

            s.Cfg.VortexGame = "";
            Yes("pointed back at the Steam copy, nothing is refused", OwnGame.RefusedSource(s.Cfg) == null && OwnGame.WhyNot(s.Cfg, OwnGame.DeploysInto(s.Cfg)) == null);
        }

        static string RulesNow()
        {
            return Convert.ToString(typeof(OwnGame).GetField("Rules", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null));
        }

        static void Scope()
        {
            MethodInfo m = typeof(OwnGame).GetMethod("RulesScope", BindingFlags.NonPublic | BindingFlags.Static);
            Func<long, string[]> scope = delegate(long r) { return (string[])m.Invoke(null, new object[] { r }); };
            int now = int.Parse(RulesNow());
            Yes("on the current rules there is no scope", scope(now) == null);
            Yes("before rule 14 (rules 12) the whole folder is walked", scope(12) == null && scope(-1) == null);
            string[] from15 = scope(15);
            Yes("from 15 to 16 only Data\\Platform\\UI\\ is looked at", now != 16 || (from15 != null && from15.Length == 1 && from15[0] == "Data\\Platform\\UI\\"));
            string[] from13 = scope(13);
            Yes("from 13, Elysium Estate's old plugin and Data\\Platform\\UI\\, once each",
                now != 16 || (from13 != null && from13.Length == 2 && Array.IndexOf(from13, "Data\\ElysiumEstateSSE.esp") >= 0 && Array.IndexOf(from13, "Data\\Platform\\UI\\") >= 0));
        }

        static int Main(string[] args)
        {
            T = args[0];
            try
            {
                Scope();
                Scoped();
                Old("rules-4", "4");
                Past("rules-12", "12");
                Moved();
                Refused();
                OneWriter();
            }
            catch (Exception ex)
            {
                Yes("the driver ran to the end (" + ex.GetType().Name + ": " + ex.Message + ")", false);
                Console.WriteLine(ex.StackTrace);
            }
            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            return fail > 0 ? 1 : 0;
        }
    }
}
'@

$work = Join-Path $Scratch ('thornswood-2210-scope-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    # The pretend build's list, as in test-own-folder-alone.ps1: the bytes and
    # SHA-1 of what NewScene writes for 1.6.1170.
    $skyrimList = Join-Path $work 'skyrim-files.json'
    $listed = @(
        '    "SkyrimSE.exe": { "bytes": 4096, "sha1": "c6b7bc36797a26fa409a0f7fb3333c7cfc990e36", "depot": "1" }',
        '    "bink2w64.dll": { "bytes": 9, "sha1": "f9dcb7c51635e79d3438edc88a3848a2f25a85dd", "depot": "1" }',
        '    "Data\\Skyrim.esm": { "bytes": 10, "sha1": "f02c4781bceef74eed7a337c528c1599d9edd739", "depot": "1" }',
        '    "Data\\Skyrim - Textures0.bsa": { "bytes": 65536, "sha1": "8cf0fb06e3e8887913e498c016e1eed034a2a2a8", "depot": "1" }',
        '    "Data\\Skyrim - Meshes0.bsa": { "bytes": 65536, "sha1": "5536cf0719bc8c69629f9add1a961b58807ce022", "depot": "1" }',
        '    "Data\\Video\\BGS_Logo.bik": { "bytes": 10, "sha1": "b5c2432d19146126a033d65dcb4e3ce01d88cfff", "depot": "1" }'
    )
    [IO.File]::WriteAllText($skyrimList, "{`n  ""build"": ""1.6.1170"",`n  ""files"": {`n" + ($listed -join ",`n") + "`n  }`n}`n", $utf8)
    $uiGoneList = Join-Path $Here 'records\ui-gone.json'
    $exe = $null
    try {
        $exe = Build-LauncherCode -Exe -Main 'Thornswood.RefreshScopeTest' -Source $stubs, $driver -File @($real | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }) `
            -Resource @{ 'skyrim-files.json' = $skyrimList; 'ui-gone.json' = $uiGoneList }
    } catch { ($_.Exception.Message -split "`n") | ForEach-Object { Write-Host "      $_" } }
    Yes 'the real OwnGame.cs builds with the driver, with the .NET SDK the launcher builds with' ($null -ne $exe)
    if (-not $exe) { Done }
    if (-not $OnWindows) {
        Write-Host 'SKIP  1 to 3 and 5 to 7, the driver on a pretend Steam, Steam copy and Vortex: OwnGame lays the game folder out by Windows paths and makes its links with kernel32, so it runs on Windows only'
        Done
    }

    $scene = Join-Path $work 'machine'
    $null = New-Item -ItemType Directory -Force -Path $scene
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = Invoke-LauncherExe $exe $scene 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $old
    foreach ($l in @($out)) {
        $s = [string]$l
        if ($s.StartsWith('PASS  ')) { $script:pass++; Write-Host $s }
        elseif ($s.StartsWith('FAIL  ')) { $script:fail++; Write-Host $s }
        else { Write-Host $s }
    }
    Yes 'the driver finished and agrees' ($code -eq 0)
}
finally {
    try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop } catch { }
}

Done
