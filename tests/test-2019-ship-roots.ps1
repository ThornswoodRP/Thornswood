<#
  test-2019-ship-roots.ps1

      pwsh -NoProfile -File .\tests\test-2019-ship-roots.ps1

  Issue #2019. A Ship never packs a folder that can be stale.

  WHAT WAS WRONG, measured on One on 15 Oct. The dev ship root
  (local\release-devbuild) was a launcher install whose launcher is never
  started, so its Game folder was still the one made on 3 Oct: OwnGame rules
  14 against the code's 16, made from C:\Thornswood-DevBuild\Game rather than
  Vortex's deployment, the collection's old 3BBB.esp in it, and the 12 Oct
  client. Ship read the client from the worktree's own engine\skymp\build,
  also 12 Oct, and refused twice. Main had no ship root of its own, so a main
  Ship packed C:\Thornswood, Patrick's own install.

  WHAT IT HOLDS.
    1. The ship root tool (scripts\release\ShipRoot), compiled from the real
       OwnGame sources with its own two files, on a pretend Steam, Vortex and
       root in a scratch folder:
       a. a new main root is made the way an install that chose its own
          folder is: config.json for main, Thornswood's own files synced from
          the channel's release into Payload (the sync stood in for), Make,
          Payload gone, and the folder current;
       b. the same root made at older rules from another folder, after Vortex
          deployed a new copy of a plugin (One's dev root on 15 Oct): -Check
          says it was made from another folder and changes nothing; a run
          brings it up to date, the plugin is Vortex's new bytes, made.txt
          names the folder Vortex deploys into at the current rules, and
          Thornswood's own file is still there;
       c. Vortex deploying again is seen by -Check and taken in by a run;
       d. refusals, each with nothing changed: the other channel's root, a
          folder Vortex deploys into, a Game folder OwnGame did not make,
          -Check on a root that is not there.
       e. #2603, a Steam copy that is not 1.6.1170 (a cleaned master, as
          One's has another Dawnguard.esm): a new root is refused as an
          install's Make refuses it; -SkyrimFrom naming a folder with a
          listed file missing, or an archive of the right size with other
          bytes, is refused naming that file, with no game folder made; a
          folder holding them all makes the root, with the game's own files
          copied from it (a write into the new root's master leaves the
          source's as it was), the Steam copy's cleaned master nowhere, a
          Creation Club plugin the folder never takes not asked for, and
          made.txt naming the folder; a refresh keeps that line, and
          -SkyrimFrom on a made root is said and not used. A file of the
          source that changes after it was checked stops Make (the stamp
          check, called as Make calls it).
       f. The tool's own project, ShipRoot.csproj (#4823): it names only
          launcher files that exist and none that uses Avalonia, at the
          launcher's framework, C# version and package versions; it builds
          with the .NET SDK on every machine, and the program it builds
          refuses a channel that is not main or dev. Update-ShipRoot.ps1
          builds it with dotnet build, not MSBuild.
    2. Where.ps1 and where.js: with no record ClientDist and ServerDist are
       under the checkout's engine\skymp; with Setup-ShipMachine's record they
       are under the recorded fork's build, for every clone; a record naming
       a folder with no build stops with a sentence and never falls back.
    3. Update-ShipRoot.ps1, the real script with a stand-in tool: a tool that
       refuses stops it, naming why; a client build that is not the record
       stops it; the recorded build goes in, through a file that had a second
       name without writing through it, and it ends current. -SkyrimFrom is
       handed to the tool, whole, and never with -Check (#2603).
    4. Setup-ShipMachine.ps1's Save-EngineBuild writes the record and refuses
       a folder with no build in it; Ship.ps1 runs Update-ShipRoot.ps1 for
       the channel's root before the version moves and before anything is
       built, and stops when it refuses (tests\test-ship-dry-run.ps1 runs that
       Ship, N). Setup-ShipMachine.ps1 takes -SkyrimFrom and hands it to
       Update-ShipRoot.ps1, not with -Check.

  Nothing outside its own scratch folder and its build under out\harness is
  written. Needs the .NET SDK the launcher builds with (tests\Launcher-Csc.ps1,
  #4823) and node. 1 is built on every machine and run on Windows only: OwnGame
  lays the game folder out by Windows paths and links with kernel32.
#>
[CmdletBinding()]
param([string]$Scratch)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = Split-Path -Parent $PSScriptRoot
$App = Join-Path $Here 'launcher\app'
$Tool = Join-Path $Here 'scripts\release\ShipRoot'
$Release = Join-Path $Here 'scripts\release'
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

$work = Join-Path $Scratch ('thornswood-2019-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
$utf8 = New-Object System.Text.UTF8Encoding($false)
$oldLocal = $env:LOCALAPPDATA

try {
# ============================================================ 1. the tool ====
$stubs = @'
using System;
using System.Collections.Generic;
using System.IO;

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
        public static string Dir { get { return Path.Combine(Paths.ProfileDir, "Keep"); } }
    }
    static class Junction { public static bool IsLink(string p) { return false; } }
    static class Icons
    {
        public static string Exe { get { return null; } }
        public static List<string> ShortcutsTo(string exe) { return new List<string>(); }
        public static int Drop(string exe) { return 0; }
    }
    // The launcher's sync, stood in for: what Updater.Resync leaves in an
    // install that chose its own folder, which is the release's game files in
    // Paths.Game (Profile\Payload until the folder is made) and its plugin
    // list in Profile\Default. tests\test-record-sync.ps1 holds the real one.
    static partial class Updater
    {
        public static int Synced;
        public static string SyncedInto;
        public static bool ReleaseFilesKnown() { return true; }
        public static List<string> ReleaseFiles() { return new List<string>(); }
        public static VersionDoc Check(Config cfg) { return new VersionDoc(); }
        public static bool Resync(Config cfg, VersionDoc v, Action<string> log)
        {
            Synced++;
            SyncedInto = Paths.Game;
            string ours = Path.Combine(Paths.Game, "Data\\Platform\\Plugins\\thornswood-front.js");
            Directory.CreateDirectory(Path.GetDirectoryName(ours));
            File.WriteAllText(ours, "// thornswood's own, from the release");
            Directory.CreateDirectory(Paths.Golden);
            File.WriteAllText(Path.Combine(Paths.Golden, "plugins.txt"), "# Automatically generated by Vortex\r\n*TsOne.esp\r\n");
            log("Release stand-in: 1 file put right.");
            return true;
        }
    }
}
'@

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace Thornswood
{
    static class ShipRootTest
    {
        static int pass, fail;
        static void Yes(string what, bool cond)
        {
            Console.WriteLine((cond ? "PASS  " : "FAIL  ") + what);
            if (cond) pass++; else fail++;
        }
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CreateHardLink(string newName, string existing, IntPtr security);

        static string T, SteamDir, Game, Staging;
        static void Put(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text, new UTF8Encoding(false));
        }
        static string J(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

        // A Steam copy on the pinned build: the exe at the config's own
        // default ExpectedExeBytes, and every file on the list below with the
        // bytes its SHA-1 names (#2603 needs the hashes real, so a cleaned
        // master can be told apart).
        static void Steam()
        {
            SteamDir = Path.Combine(T, "steam");
            Game = Path.Combine(SteamDir, "steamapps\\common\\Skyrim Special Edition");
            Staging = Path.Combine(T, "vortex\\mods");
            Put(Path.Combine(SteamDir, "config\\libraryfolders.vdf"),
                "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"" + J(SteamDir) + "\"\n\t}\n}\n");
            Thornswood.Steam.RootForTest = SteamDir;
            Directory.CreateDirectory(Game);
            using (var fs = new FileStream(Path.Combine(Game, "SkyrimSE.exe"), FileMode.Create)) fs.SetLength(new Config().ExpectedExeBytes);
            Put(Path.Combine(Game, "Data\\Skyrim.esm"), "PIN-MASTER");
            Put(Path.Combine(Game, "Data\\Skyrim - Misc.bsa"), "PIN-ARCHIVE");
            Put(Path.Combine(Game, "Data\\ccBGSSSE037-Curios.esl"), "CC-CURIOS");
            Deploy("VORTEX-TSONE-1", DateTime.UtcNow.AddMinutes(-30));
        }

        // A folder holding the listed files a new folder takes (#2603), as a
        // ship root's Game does: no Creation Club plugin, which none takes.
        static string SkyrimSource(string name, string master, string archive)
        {
            string d = Path.Combine(T, name);
            Directory.CreateDirectory(d);
            using (var fs = new FileStream(Path.Combine(d, "SkyrimSE.exe"), FileMode.Create)) fs.SetLength(new Config().ExpectedExeBytes);
            if (master != null) Put(Path.Combine(d, "Data\\Skyrim.esm"), master);
            Put(Path.Combine(d, "Data\\Skyrim - Misc.bsa"), archive);
            return d;
        }

        // Vortex's deployment: one plugin, linked from its staging copy, and
        // its record. A new text is a new copy in staging and a new link.
        static void Deploy(string plugin, DateTime when)
        {
            string staged = Path.Combine(Staging, "ModA\\TsOne.esp");
            string at = Path.Combine(Game, "Data\\TsOne.esp");
            if (File.Exists(at)) File.Delete(at);
            if (File.Exists(staged)) File.Delete(staged);
            Put(staged, plugin);
            CreateHardLink(at, staged, IntPtr.Zero);
            string rec = Path.Combine(Game, "Data\\vortex.deployment.json");
            // The time Vortex's record gives a file is its staging copy's write
            // time in milliseconds (measured on One, 16 Oct: 400 of 400), which
            // a refresh compares with the last record's (#2210).
            long time = (long)(File.GetLastWriteTimeUtc(staged) - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            Put(rec, "{\n  \"instance\": \"test\",\n  \"version\": 1,\n  \"deploymentMethod\": \"hardlink_activator\",\n  \"gameId\": \"skyrimse\",\n" +
                     "  \"stagingPath\": \"" + J(Staging) + "\",\n  \"targetPath\": \"" + J(Path.Combine(Game, "Data")) + "\",\n" +
                     "  \"files\": [ { \"relPath\": \"TsOne.esp\", \"source\": \"ModA\", \"target\": \"\", \"time\": " + time + " } ]\n}\n");
            File.SetLastWriteTimeUtc(rec, when);
        }

        static string Made(string root, string key)
        {
            string f = Path.Combine(root, "Profile\\OwnGame\\made.txt");
            if (!File.Exists(f)) return null;
            foreach (string l in File.ReadAllLines(f)) if (l.StartsWith(key + "=")) return l.Substring(key.Length + 1);
            return null;
        }
        static void SetMade(string root, string key, string value)
        {
            string f = Path.Combine(root, "Profile\\OwnGame\\made.txt");
            var lines = new List<string>();
            foreach (string l in File.ReadAllLines(f)) lines.Add(l.StartsWith(key + "=") ? key + "=" + value : l);
            File.WriteAllLines(f, lines.ToArray());
        }
        static string RulesNow()
        {
            return Convert.ToString(typeof(OwnGame).GetField("Rules", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null));
        }
        static bool Same(string a, string b)
        {
            return a != null && b != null && string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }

        static string Run(string root, string channel, bool check, List<string> said)
        {
            try { return ShipRootTool.Run(root, channel, check, delegate(string m) { said.Add(m); }); }
            catch (Exception ex) { return "THREW " + ex.Message; }
        }
        static string RunFrom(string root, string skyrimFrom, List<string> said)
        {
            try { return ShipRootTool.Run(root, "main", false, skyrimFrom, delegate(string m) { said.Add(m); }); }
            catch (Exception ex) { return "THREW " + ex.Message; }
        }

        static int Main(string[] args)
        {
            T = args[0];
            try
            {
                Steam();
                string root = Path.Combine(T, "repo\\local\\release-main");
                var said = new List<string>();

                // ---- a. a new main root ------------------------------------
                string why = Run(root, "main", true, said);
                Yes("a. -Check on a root that is not there says so and makes nothing", why != null && why.Contains("no ship root") && !Directory.Exists(root));
                why = Run(root, "main", false, said);
                Yes("a. a new main root is made (" + (why ?? "current") + ")", why == null);
                Config cfg = Config.Load(Path.Combine(root, "config.json"));
                Yes("a.   with a config.json for main", File.Exists(Path.Combine(root, "config.json")) && !cfg.IsDev && cfg.ServerPort == "7777");
                Yes("a.   Thornswood's own files synced from the channel's release once, into Profile\\Payload",
                    Updater.Synced == 1 && Same(Updater.SyncedInto, Path.Combine(root, "Profile\\Payload")));
                Yes("a.   taken into the game folder by Make, and Payload gone",
                    File.Exists(Path.Combine(root, "Game\\Data\\Platform\\Plugins\\thornswood-front.js")) && !Directory.Exists(Path.Combine(root, "Profile\\Payload")));
                Yes("a.   with Vortex's plugin in it", File.ReadAllText(Path.Combine(root, "Game\\Data\\TsOne.esp")) == "VORTEX-TSONE-1");
                Yes("a.   made.txt names the folder Vortex deploys into, at the current rules",
                    Same(Made(root, "source"), Game) && Made(root, "rules") == RulesNow() && Made(root, "kinds") == "1");
                said.Clear();
                Yes("a.   and -Check calls it current", Run(root, "main", true, said) == null && string.Join(" ", said.ToArray()).Contains("is current"));

                // ---- b. made at older rules, from another folder -----------
                SetMade(root, "rules", "14");
                SetMade(root, "source", Path.Combine(T, "Thornswood-DevBuild\\Game"));
                Deploy("VORTEX-TSONE-2-REINSTALLED", DateTime.UtcNow.AddMinutes(-5));
                why = Run(root, "main", true, said);
                Yes("b. -Check on a root made from another folder says so", why != null && why.Contains("was made from") && why.Contains("Thornswood-DevBuild"));
                Yes("b.   and changes nothing", File.ReadAllText(Path.Combine(root, "Game\\Data\\TsOne.esp")) == "VORTEX-TSONE-1" && Made(root, "rules") == "14");
                SetMade(root, "source", Game);
                why = Run(root, "main", true, said);
                Yes("b. one at older rules is named too", why != null && why.Contains("rules 14"));
                SetMade(root, "source", Path.Combine(T, "Thornswood-DevBuild\\Game"));
                said.Clear();
                why = Run(root, "main", false, said);
                Yes("b. a run brings it up to date (" + (why ?? "current") + ")", why == null);
                Yes("b.   the plugin is Vortex's new copy", File.ReadAllText(Path.Combine(root, "Game\\Data\\TsOne.esp")) == "VORTEX-TSONE-2-REINSTALLED");
                Yes("b.   made.txt names the folder Vortex deploys into, at the current rules",
                    Same(Made(root, "source"), Game) && Made(root, "rules") == RulesNow());
                Yes("b.   Thornswood's own file is still there", File.Exists(Path.Combine(root, "Game\\Data\\Platform\\Plugins\\thornswood-front.js")));
                Yes("b.   and no second sync: a made root's own files are the Ship's", Updater.Synced == 1);

                // ---- c. Vortex deploys again ------------------------------
                Deploy("VORTEX-TSONE-3", DateTime.UtcNow);
                why = Run(root, "main", true, said);
                Yes("c. -Check sees Vortex has deployed since", why != null && why.Contains("has deployed"));
                Yes("c.   a run takes it in", Run(root, "main", false, said) == null && File.ReadAllText(Path.Combine(root, "Game\\Data\\TsOne.esp")) == "VORTEX-TSONE-3");

                // ---- d. refusals -------------------------------------------
                why = Run(root, "dev", false, said);
                Yes("d. the main root asked for as dev is refused", why != null && why.Contains("main build's") && Made(root, "rules") == RulesNow());
                string vortexRoot = Path.Combine(T, "vortex-root");
                Put(Path.Combine(vortexRoot, "Game\\Data\\vortex.deployment.json"), "{}");
                why = Run(vortexRoot, "dev", false, said);
                Yes("d. a folder Vortex deploys into is refused", why != null && why.Contains("Vortex deploys into") && !File.Exists(Path.Combine(vortexRoot, "config.json")));
                string handRoot = Path.Combine(T, "hand-root");
                Put(Path.Combine(handRoot, "Game\\Data\\Skyrim.esm"), "A COPY BY HAND");
                why = Run(handRoot, "dev", false, said);
                Yes("d. a Game folder OwnGame did not make is refused, saying what to do", why != null && why.Contains("OwnGame did not make it") && why.Contains("Move that Game folder"));
                Yes("d.   and left as it was", File.ReadAllText(Path.Combine(handRoot, "Game\\Data\\Skyrim.esm")) == "A COPY BY HAND");
                Config dev = Config.Load(Path.Combine(handRoot, "config.json"));
                Yes("d.   its config.json was written for dev, as DevBuild.Install writes one", dev.IsDev && dev.ServerPort == DevBuild.DevPort && dev.UpdateFeedUrl.Contains("/feed-dev/"));

                // ---- e. a Steam copy that is not 1.6.1170 (#2603) ----------
                string steamMaster = Path.Combine(Game, "Data\\Skyrim.esm");
                File.WriteAllText(steamMaster, "CLEANED-MA");
                string rootE = Path.Combine(T, "repo\\local\\release-e");
                string gameE = Path.Combine(rootE, "Game");
                said.Clear();
                why = Run(rootE, "main", false, said);
                Yes("e. with a cleaned master in the Steam copy a new root is refused, as an install's Make is", why != null && why.Contains("one of its own files is not that build's") && !Directory.Exists(gameE));
                Console.WriteLine("      it said: " + why);

                string noMaster = SkyrimSource("skyrim-no-master", null, "PIN-ARCHIVE");
                said.Clear();
                why = RunFrom(rootE, noMaster, said);
                Yes("e. -SkyrimFrom a folder without a listed file is refused, naming it", why != null && why.Contains(Path.Combine(noMaster, "Data\\Skyrim.esm") + " is not there") && why.Contains("nothing was made"));
                Yes("e.   and no game folder is made, not even half of one", !Directory.Exists(gameE) && !Directory.Exists(gameE + ".new"));
                Console.WriteLine("      it said: " + why);

                string badArchive = SkyrimSource("skyrim-bad-archive", "PIN-MASTER", "PIN-ARCHIV3");
                said.Clear();
                why = RunFrom(rootE, badArchive, said);
                Yes("e. an archive of the right size with other bytes is refused too, naming it: archives are hashed here", why != null && why.Contains(Path.Combine(badArchive, "Data\\Skyrim - Misc.bsa") + " has the build's size but not its bytes"));
                Yes("e.   and no game folder is made, not even half of one", !Directory.Exists(gameE) && !Directory.Exists(gameE + ".new"));
                Console.WriteLine("      it said: " + why);

                string good = SkyrimSource("skyrim-good", "PIN-MASTER", "PIN-ARCHIVE");
                said.Clear();
                why = RunFrom(rootE, good, said);
                Yes("e. -SkyrimFrom a folder that holds them makes the root (" + (why ?? "current") + ")", why == null);
                if (why != null) foreach (string m in said) Console.WriteLine("      " + m);
                string masterE = Path.Combine(gameE, "Data\\Skyrim.esm");
                Yes("e.   the game's own master is the build's, from that folder, not the Steam copy's cleaned one",
                    File.Exists(masterE) && File.ReadAllText(masterE) == "PIN-MASTER");
                Yes("e.   the archive is in it", File.Exists(Path.Combine(gameE, "Data\\Skyrim - Misc.bsa")) && File.ReadAllText(Path.Combine(gameE, "Data\\Skyrim - Misc.bsa")) == "PIN-ARCHIVE");
                Yes("e.   a Creation Club plugin no folder takes was not asked of that folder, and is not in the root",
                    !File.Exists(Path.Combine(gameE, "Data\\ccBGSSSE037-Curios.esl")));
                Yes("e.   Vortex's plugin is in it", File.ReadAllText(Path.Combine(gameE, "Data\\TsOne.esp")) == "VORTEX-TSONE-3");
                Yes("e.   made.txt names the folder the game's own files came from", Same(Made(rootE, "skyrim"), good) && Same(Made(rootE, "source"), Game));
                Yes("e.   the log says they were checked and copied from it", string.Join(" ", said.ToArray()).Contains("copied from " + good));
                File.AppendAllText(masterE, "+WRITTEN");
                Yes("e.   copied, not linked: a write into the root's master leaves the folder's own as it was", File.ReadAllText(Path.Combine(good, "Data\\Skyrim.esm")) == "PIN-MASTER");
                Yes("e.   and the Steam copy's master as it was", File.ReadAllText(steamMaster) == "CLEANED-MA");
                // An archive is linked when it comes from anywhere else, so
                // this is the file that shows the copy: the folder's own has
                // no second name in the root (or anywhere).
                MethodInfo links = typeof(OwnGame).GetMethod("Links", BindingFlags.NonPublic | BindingFlags.Static);
                Yes("e.   the folder's archive and master have no second name: nothing in the root is linked to them",
                    (int)links.Invoke(null, new object[] { Path.Combine(good, "Data\\Skyrim - Misc.bsa") }) == 1 &&
                    (int)links.Invoke(null, new object[] { Path.Combine(good, "Data\\Skyrim.esm") }) == 1 &&
                    (int)links.Invoke(null, new object[] { Path.Combine(good, "SkyrimSE.exe") }) == 1);
                said.Clear();
                Yes("e.   -Check calls it current", Run(rootE, "main", true, said) == null);

                Deploy("VORTEX-TSONE-4", DateTime.UtcNow.AddMinutes(1));
                said.Clear();
                why = RunFrom(rootE, good, said);
                Yes("e. a refresh of it takes Vortex's new copy (" + (why ?? "current") + ")", why == null && File.ReadAllText(Path.Combine(gameE, "Data\\TsOne.esp")) == "VORTEX-TSONE-4");
                Yes("e.   says -SkyrimFrom was not used, the folder being made already", string.Join(" ", said.ToArray()).Contains("was not used"));
                Yes("e.   and keeps made.txt's skyrim line", Same(Made(rootE, "skyrim"), good));

                // The stamp check Make runs once everything is placed, as Make
                // calls it: a write into the source after it was checked is seen.
                MethodInfo from = typeof(OwnGame).GetMethod("SkyrimFrom", BindingFlags.NonPublic | BindingFlags.Static);
                MethodInfo moved = typeof(OwnGame).GetMethod("SkyrimFromMoved", BindingFlags.NonPublic | BindingFlags.Static);
                object[] a = new object[] { good, new HashSet<string>(StringComparer.OrdinalIgnoreCase), null, null };
                from.Invoke(null, a);
                Yes("e. the stamps of what was checked: nothing moved, nothing said", a[3] != null && moved.Invoke(null, new object[] { good, a[3] }) == null);
                File.WriteAllText(Path.Combine(good, "Data\\Skyrim.esm"), "PIN-MASTER");
                string after = (string)moved.Invoke(null, new object[] { good, a[3] });
                Yes("e. a file written after it was checked stops Make, naming it", after != null && after.Contains(Path.Combine(good, "Data\\Skyrim.esm") + " changed while the folder was being made"));
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

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (Test-Path -LiteralPath $LauncherDotnet) {
    # OwnGameKinds and Verify name LastPlugin (#2791), which reads the game's archives through FromGameArchive.cs.
    # Config and OwnGame read their JSON through LooseString.cs, and Downgrade asks with Ask.cs (#4823).
    $real = @('OwnGame.cs', 'OwnGameShare.cs', 'OwnGameKinds.cs', 'Downgrade.cs', 'Steam.cs', 'Paths.cs', 'Config.cs', 'Secrets.cs', 'LoadOrder.cs', 'Swallow.cs', 'Progress.cs', 'DevBuild.cs', 'LastPlugin.cs', 'FromGameArchive.cs', 'LooseString.cs', 'Ask.cs') |
        ForEach-Object { Join-Path $App $_ }
    $real += @((Join-Path $Tool 'ShipRoot.cs'), (Join-Path $Tool 'OwnGameShipRoot.cs'))
    foreach ($f in $real) { Yes ("$([IO.Path]::GetFileName($f)) is there") (Test-Path -LiteralPath $f) }
    $skyrimList = Join-Path $work 'skyrim-files.json'
    # Real SHA-1s of what the driver puts in its Steam copy (#2603): the exe is
    # 37,157,144 zero bytes, the rest short texts.
    function Sha1Of([byte[]]$b) { return ([BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash($b)) -replace '-', '').ToLowerInvariant() }
    $listed = [ordered]@{
        'SkyrimSE.exe' = @(37157144, (Sha1Of (New-Object byte[] 37157144)))
        'Data\\Skyrim.esm' = @(10, (Sha1Of $utf8.GetBytes('PIN-MASTER')))
        'Data\\Skyrim - Misc.bsa' = @(11, (Sha1Of $utf8.GetBytes('PIN-ARCHIVE')))
        'Data\\ccBGSSSE037-Curios.esl' = @(9, (Sha1Of $utf8.GetBytes('CC-CURIOS')))
    }
    $rows = @($listed.Keys | ForEach-Object { '    "' + $_ + '": { "bytes": ' + $listed[$_][0] + ', "sha1": "' + $listed[$_][1] + '", "depot": "1" }' })
    [IO.File]::WriteAllText($skyrimList, ("{`n  ""build"": ""1.6.1170"",`n  ""files"": {`n" + ($rows -join ",`n") + "`n  }`n}`n"), $utf8)
    $exe = $null; $compiled = @()
    try {
        $exe = Build-LauncherCode -Exe -Main 'Thornswood.ShipRootTest' -Source $stubs, $driver -File @($real | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }) `
            -Resource @{ 'skyrim-files.json' = $skyrimList; 'ui-gone.json' = (Join-Path $Here 'records\ui-gone.json') }
    } catch { $compiled = @($_.Exception.Message -split "`n") }
    Yes 'the ship root tool builds with the real OwnGame and the driver, with the .NET SDK the launcher builds with' ($null -ne $exe)
    if (-not $exe) { foreach ($l in $compiled) { Write-Host "      $l" } }
    elseif (-not $OnWindows) {
        Write-Host 'SKIP  1. the ship root tool run on a pretend Steam, Vortex and root: OwnGame lays the game folder out by Windows paths and makes its links with kernel32, so it runs on Windows only'
    } else {
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
}

# ------------------------------------------- 1f. the tool's own project ----
# What Update-ShipRoot.ps1 builds at the start of every Ship: OwnGame's
# closure, no window (#4823).
$projPath = Join-Path $Tool 'ShipRoot.csproj'
$projText = [IO.File]::ReadAllText($projPath)
$appDir = $App.TrimEnd('\', '/')
$named = @([regex]::Matches($projText, '<Compile Include="\$\(ThornswoodApp\)([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
$toolOwn = @([regex]::Matches($projText, '<Compile Include="\$\(MSBuildThisFileDirectory\)([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
Yes ('1f. ShipRoot.csproj names its own two files and launcher files (' + $named.Count + ')') (
    $named.Count -gt 0 -and (@($toolOwn | Sort-Object) -join ',') -eq 'OwnGameShipRoot.cs,ShipRoot.cs' -and
    $projText -match '<EnableDefaultItems>false</EnableDefaultItems>' -and $projText -notmatch '<Compile Include="[^"]*\*')
$gone = @($named | Where-Object { -not (Test-Path -LiteralPath (Join-Path $appDir $_)) })
Yes ('1f.   every one of them is in launcher\app' + $(if ($gone.Count) { ', not ' + ($gone -join ', ') } else { '' })) ($gone.Count -eq 0)
$ui = @($named | Where-Object { (Test-Path -LiteralPath (Join-Path $appDir $_)) -and ([IO.File]::ReadAllText((Join-Path $appDir $_)) -match '(?m)^\s*using Avalonia') })
Yes ('1f.   and none of them is the window''s (no using Avalonia)' + $(if ($ui.Count) { ', not ' + ($ui -join ', ') } else { '' })) ($ui.Count -eq 0)
$parts = @(Get-ChildItem -LiteralPath $appDir -Filter '*.cs' -File | Where-Object { [IO.File]::ReadAllText($_.FullName) -match 'static partial class OwnGame\b' } | ForEach-Object { $_.Name })
Yes ('1f.   every part of OwnGame is in it (' + ($parts -join ', ') + ')') ($parts.Count -gt 0 -and @($parts | Where-Object { $named -notcontains $_ }).Count -eq 0)
$launcherProj = [IO.File]::ReadAllText((Join-Path $appDir 'Thornswood.csproj'))
function ProjValue([string]$text, [string]$name) { $m = [regex]::Match($text, '<' + $name + '>([^<]+)</' + $name + '>'); if ($m.Success) { $m.Groups[1].Value } else { '' } }
Yes '1f.   at the launcher''s framework and C# version' (
    (ProjValue $projText 'TargetFramework') -eq (ProjValue $launcherProj 'TargetFramework') -and (ProjValue $projText 'TargetFramework') -ne '' -and
    (ProjValue $projText 'LangVersion') -eq (ProjValue $launcherProj 'LangVersion'))
$pkgs = @([regex]::Matches($projText, '<PackageReference Include="([^"]+)" Version="([^"]+)"') | ForEach-Object { [pscustomobject]@{ Name = $_.Groups[1].Value; Version = $_.Groups[2].Value } })
$offPkg = @($pkgs | Where-Object { $launcherProj -notmatch ('<PackageReference Include="' + [regex]::Escape($_.Name) + '" Version="' + [regex]::Escape($_.Version) + '"') } | ForEach-Object { $_.Name + ' ' + $_.Version })
Yes ('1f.   with only the launcher''s packages, at its versions' + $(if ($offPkg.Count) { ', not ' + ($offPkg -join ', ') } else { '' })) ($offPkg.Count -eq 0 -and @($pkgs | Where-Object { $_.Name -like 'Avalonia*' }).Count -eq 0)
if (Test-Path -LiteralPath $LauncherDotnet) {
    $toolOut = Join-Path $work 'shiproot-tool'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $built = & $LauncherDotnet build $projPath -c Release -o $toolOut --nologo -v quiet --disable-build-servers 2>&1 | Out-String
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    $toolDll = Join-Path $toolOut 'Thornswood-ShipRoot.dll'
    Yes '1f. ShipRoot.csproj builds with the .NET SDK the launcher builds with' ($rc -eq 0 -and (Test-Path -LiteralPath $toolDll))
    if ($rc -ne 0) { ($built -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    else {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $said = @(& $LauncherDotnet $toolDll -Root (Join-Path $work 'no-root') -Channel nightly 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
        $ErrorActionPreference = $old
        Yes '1f.   and the program it builds refuses a channel that is not main or dev, with a sentence' ($rc -eq 1 -and ($said -join ' ') -match 'STOP\. -Channel is main or dev, and it was nightly\.')
    }
}
$upd = [IO.File]::ReadAllText((Join-Path $Release 'Update-ShipRoot.ps1'))
Yes '1f. Update-ShipRoot.ps1 builds it with dotnet build, not MSBuild' (
    $upd -match "\`$dotnet\.Source build \(Resolve-Path -LiteralPath \`$proj\)\.Path -c Release -o \`$out" -and $upd -notmatch 'Find-MSBuild|Find-ThornswoodMSBuild')

# ============================================== 2. Where.ps1 and where.js ====
$repo = Join-Path $work 'repo'
New-Item -ItemType Directory -Force -Path (Join-Path $repo 'scripts\release'), (Join-Path $repo 'records') | Out-Null
foreach ($n in 'Where.ps1', 'where.js', 'Update-ShipRoot.ps1', 'Sync-Client.ps1', 'RecordShape.ps1', 'Read-JsonFile.ps1', 'Get-ScratchDir.ps1') {
    Copy-Item -LiteralPath (Join-Path $Release $n) -Destination (Join-Path $repo 'scripts\release')
}
Copy-Item -LiteralPath (Join-Path $Here 'layout.json') -Destination $repo
$env:LOCALAPPDATA = Join-Path $work 'localappdata'
New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA | Out-Null
$w = Join-Path $repo 'scripts\release\Where.ps1'
$wj = Join-Path $repo 'scripts\release\where.js'
function Same([string]$a, [string]$b) { return $a -and $b -and ([IO.Path]::GetFullPath($a).TrimEnd('\') -eq [IO.Path]::GetFullPath($b).TrimEnd('\')) }
function AskJs([string]$what) { $o = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { return [string](& node $wj $what 2>&1) } finally { $ErrorActionPreference = $o } }
$engine = Join-Path $repo 'engine\skymp'
Yes '2. with no record, ClientDist is the checkout''s engine\skymp build' (Same (& $w ClientDist) (Join-Path $engine 'build\dist\client'))
Yes '2.   and ServerDist too' (Same (& $w ServerDist) (Join-Path $engine 'build\dist\server'))
Yes '2.   and EngineBuild is Engine' (Same (& $w EngineBuild) $engine)
Yes '2.   EngineBuilds is this machine''s own data, beside ship-roots.json' (Same (& $w EngineBuilds) (Join-Path $env:LOCALAPPDATA 'Thornswood\engine-build.json'))
$fork = Join-Path $work 'worktrees\skymp-built'
New-Item -ItemType Directory -Force -Path (Join-Path $fork 'build\dist\client'), (Join-Path $fork 'build\dist\server') | Out-Null
$setup = Join-Path $Release 'Setup-ShipMachine.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($setup, [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Save-EngineBuild' }, $true)
Yes '4. Setup-ShipMachine.ps1 has Save-EngineBuild' ([bool]$fn)
if ($fn) { . ([scriptblock]::Create($fn.Extent.Text)) }
$recFile = Join-Path $env:LOCALAPPDATA 'Thornswood\engine-build.json'
$noBuild = Join-Path $work 'worktrees\skymp-never-built'
New-Item -ItemType Directory -Force -Path $noBuild | Out-Null
$why = Save-EngineBuild $recFile $noBuild
Yes '4. Save-EngineBuild refuses a fork folder with no build in it, and writes nothing' ($why -match 'no build\\dist' -and -not (Test-Path -LiteralPath $recFile))
$why = Save-EngineBuild $recFile $fork
Yes '4. and records one that has a build' (-not $why -and (Test-Path -LiteralPath $recFile))
Yes '2. with the record, ClientDist is the recorded fork''s build, not the checkout''s' (Same (& $w ClientDist) (Join-Path $fork 'build\dist\client'))
Yes '2.   and ServerDist, ServerSettings and ChangeForms are under it too' (
    (Same (& $w ServerDist) (Join-Path $fork 'build\dist\server')) -and (Same (& $w ServerSettings) (Join-Path $fork 'build\dist\server\server-settings.json')) -and
    (Same (& $w ChangeForms) (Join-Path $fork 'build\dist\server\world\changeForms')))
Yes '2.   and where.js says the same' ((Same (AskJs ClientDist).Trim() (& $w ClientDist)) -and (Same (AskJs ServerDist).Trim() (& $w ServerDist)))
[IO.File]::WriteAllText($recFile, (ConvertTo-Json -InputObject ([ordered]@{ fork = $noBuild })), $utf8)
$threw = ''
try { & $w ClientDist | Out-Null } catch { $threw = $_.Exception.Message }
Yes '2. a record naming a fork with no build stops with a sentence, and does not fall back' ($threw -match 'no build\\dist in it' -and $threw -match 'Setup-ShipMachine\.ps1 -EngineBuild')
Yes '2.   and where.js stops too' ((AskJs ClientDist) -match 'no build\\dist')
[IO.File]::WriteAllText($recFile, (ConvertTo-Json -InputObject ([ordered]@{ fork = $fork })), $utf8)

# ===================================================== 3. Update-ShipRoot ====
# A record of two client files, the recorded build in the fork, and a ship
# root whose game folder holds an old copy of one of them under a second name.
$cA = 'Data\SKSE\Plugins\MpClientPlugin.dll'; $cB = 'Data\Platform\Plugins\skymp5-client.js'
function Sha([string]$t) { return ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($utf8.GetBytes($t))) -replace '-', '').ToLowerInvariant() }
$record = [ordered]@{ recordedUtc = '2026-10-16T02:29:34Z'; fork = 'x'; forkBranch = 'thornswood/engine-changes'; forkCommit = '0714e444'; files = [ordered]@{
    $cA = [ordered]@{ sha256 = (Sha 'CLIENT-A-NEW'); bytes = 12 }; $cB = [ordered]@{ sha256 = (Sha 'CLIENT-B-NEW'); bytes = 12 } } }
[IO.File]::WriteAllText((Join-Path $repo 'records\client-build.json'), (ConvertTo-Json -InputObject $record -Depth 5), $utf8)
$shipRoot = Join-Path $work 'repo\local\release-devbuild'
$elsewhere = Join-Path $work 'other-install\Game'
foreach ($p in @((Join-Path $fork ('build\dist\client\' + $cA)), (Join-Path $elsewhere $cA))) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null }
[IO.File]::WriteAllText((Join-Path $elsewhere $cA), 'CLIENT-A-OLD', $utf8)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $shipRoot ('Game\' + $cA))) | Out-Null
$null = New-Item -ItemType HardLink -Path (Join-Path $shipRoot ('Game\' + $cA)) -Target (Join-Path $elsewhere $cA)
$standIn = Join-Path $work 'stand-in-tool.ps1'
[IO.File]::WriteAllText($standIn, @'
param([string]$Root, [string]$Channel, [switch]$Check, [string]$SkyrimFrom)
[IO.File]::AppendAllText($env:TS_TOOL_CALLS, "tool -Root $Root -Channel $Channel" + $(if ($Check) { ' -Check' } else { '' }) + $(if ($SkyrimFrom) { " -SkyrimFrom $SkyrimFrom" } else { '' }) + "`r`n")
if ($env:TS_TOOL_EXIT -eq '1') { Write-Output 'STOP. stand-in: the game folder was made from another folder.'; exit 1 }
Write-Output '  stand-in: current.'
exit 0
'@, $utf8)
$env:TS_TOOL_CALLS = Join-Path $work 'tool-calls.txt'
$up = Join-Path $repo 'scripts\release\Update-ShipRoot.ps1'
$ps = (Get-Process -Id $PID).Path
function Up([string[]]$more) {
    $o = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $t = & $ps -NoProfile -ExecutionPolicy Bypass -File $up -Channel dev -Root $shipRoot -Tool $standIn -NoPause @more 2>&1 | Out-String; return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $t } }
    finally { $ErrorActionPreference = $o }
}
$env:TS_TOOL_EXIT = '1'
$r = Up @()
Yes ("3. a tool that refuses stops Update-ShipRoot.ps1 (exit {0}), naming why" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'not current with Vortex''s deployment, so nothing is packed from it: stand-in: the game folder was made from another folder')
Yes '3.   before any client file is touched' ([IO.File]::ReadAllText((Join-Path $shipRoot ('Game\' + $cA))) -eq 'CLIENT-A-OLD')
Yes '3.   and the tool was asked about the channel''s root' (([IO.File]::ReadAllText($env:TS_TOOL_CALLS)) -match [regex]::Escape("tool -Root $shipRoot -Channel dev"))
$env:TS_TOOL_EXIT = '0'
[IO.File]::WriteAllText((Join-Path $fork ('build\dist\client\' + $cA)), 'CLIENT-A-NEW', $utf8)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $fork ('build\dist\client\' + $cB))) | Out-Null
[IO.File]::WriteAllText((Join-Path $fork ('build\dist\client\' + $cB)), 'CLIENT-B-STALE', $utf8)
$r = Up @()
Yes ("3. an engine build that is not the record stops it (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'could not be put into' -and $r.Out -match 'not the recorded one')
Yes '3.   and nothing was copied' ([IO.File]::ReadAllText((Join-Path $shipRoot ('Game\' + $cA))) -eq 'CLIENT-A-OLD')
[IO.File]::WriteAllText((Join-Path $fork ('build\dist\client\' + $cB)), 'CLIENT-B-NEW', $utf8)
$r = Up @()
Yes ("3. with the recorded build in the recorded fork, it ends current (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'is current, with the recorded client in it')
Yes '3.   the root holds the recorded client' (
    [IO.File]::ReadAllText((Join-Path $shipRoot ('Game\' + $cA))) -eq 'CLIENT-A-NEW' -and [IO.File]::ReadAllText((Join-Path $shipRoot ('Game\' + $cB))) -eq 'CLIENT-B-NEW')
Yes '3.   and the file it replaced kept its other name''s bytes: nothing was written through the hard link' ([IO.File]::ReadAllText((Join-Path $elsewhere $cA)) -eq 'CLIENT-A-OLD')
$r = Up @('-Check')
Yes '3. -Check asks the tool with -Check and changes nothing' ($r.Code -eq 0 -and ([IO.File]::ReadAllText($env:TS_TOOL_CALLS)) -match '-Channel dev -Check')
$skyFrom = Join-Path $work 'some root\Game'
$r = Up @('-SkyrimFrom', $skyFrom)
Yes '3. -SkyrimFrom is handed to the tool, whole (#2603)' ($r.Code -eq 0 -and ([IO.File]::ReadAllText($env:TS_TOOL_CALLS)) -match [regex]::Escape("-Channel dev -SkyrimFrom $skyFrom"))
[IO.File]::WriteAllText($env:TS_TOOL_CALLS, '', $utf8)
$r = Up @('-Check', '-SkyrimFrom', $skyFrom)
Yes '3.   and not with -Check, which makes nothing' ($r.Code -eq 0 -and ([IO.File]::ReadAllText($env:TS_TOOL_CALLS)) -match '-Channel dev -Check' -and ([IO.File]::ReadAllText($env:TS_TOOL_CALLS)) -notmatch 'SkyrimFrom')

# ============================================================= 4. Ship.ps1 ====
$shipText = [IO.File]::ReadAllText((Join-Path $Release 'Ship.ps1'))
$callAt = $shipText.IndexOf("& (Join-Path `$Here 'Update-ShipRoot.ps1') -Channel `$Channel -Root `$Root -NoPause")
Yes '4. Ship.ps1 runs Update-ShipRoot.ps1 for the channel''s root' ($callAt -ge 0)
$rootAt = $shipText.IndexOf("Where.ps1') `$(if (`$Dev) { 'ShipRootDev' } else { 'ShipRoot' })")
$vortexAt = $shipText.IndexOf("is a folder Vortex deploys into (Game\Data\vortex.deployment.json is there), so a release is never built from it")
$genAt = $shipText.IndexOf("Head 'Animation and body files'")
$pubAt = $shipText.IndexOf("Head 'Publishing'")
Yes '4.   after it knows the root and has refused a folder Vortex deploys into' ($rootAt -ge 0 -and $vortexAt -ge 0 -and $callAt -gt $rootAt -and $callAt -gt $vortexAt)
Yes '4.   and before the collection is asked whether it builds the animation and body files, or anything is published (Ship builds no launcher since #4825)' ($genAt -gt $callAt -and $pubAt -gt $callAt)
$setupText = [IO.File]::ReadAllText($setup)
Yes '4. Setup-ShipMachine.ps1 takes -SkyrimFrom and hands it to Update-ShipRoot.ps1, not with -Check (#2603)' (
    $setupText -match '\[string\]\$SkyrimFrom' -and $setupText -match "(?s)if \(\`$Check\) \{ \`$upArgs\['Check'\] = \`$true \}\s*elseif \(\`$SkyrimFrom\) \{ \`$upArgs\['SkyrimFrom'\] = \`$SkyrimFrom \}")
Yes '4.   and it stops when the root is not current' ($shipText -match "(?s)Update-ShipRoot\.ps1'\) -Channel \`$Channel -Root \`$Root -NoPause\s*if \(\`$LASTEXITCODE -ne 0\) \{\s*Die \(")
}
finally {
    $env:LOCALAPPDATA = $oldLocal
    Remove-Item Env:TS_TOOL_CALLS, Env:TS_TOOL_EXIT -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
