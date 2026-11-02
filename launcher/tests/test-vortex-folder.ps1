<#
  test-vortex-folder.ps1

      pwsh -NoProfile -File .\launcher\tests\test-vortex-folder.ps1

  Scan finds the Skyrim folder Vortex really deploys into, Fix builds
  Thornswood's own folder from it, and nothing of another server's install
  comes with it. The To Do List entry is VG.

  WHAT HAPPENED, 24 September. A tester on the main build: "they have purged
  and redeoployed several times, they never got a popup to build their own
  folder", and the launcher said "Vortex has nothing deployed in
  S:/SteamLibrary/steamapps/common/Skyrim Special Edition right now". Their
  Vortex, Mods, Open, Open Game Folder opened
  a folder of its own under S:/SteamLibrary/steamapps/common: another SkyMP server's copy
  of Skyrim, with its own exe, script extender, dlls, ini files, Mods, src,
  Skyrim and Creations folders, and Vortex deploying the Thornswood collection
  into it. Patrick: "can we fix it so the launcher can detect and fix this in
  scan and fix aswell", then "can you make it so our launcher detcts and fixes
  this but doesnt have the servers bleed still".

  WHAT THIS HOLDS THE LAUNCHER TO.
    1. It finds that folder by itself: any folder directly under a Steam
       library's steamapps\common with SkyrimSE.exe and Vortex's record,
       Data\vortex.deployment.json. A Steam copy of Skyrim Special Edition
       comes first; otherwise the newest record wins; VortexGame wins over
       the search.
    2. Scan names it, first, and Fix saves it as VortexGame; the launcher then
       makes the own folder the way Make it does.
    3. NO BLEED. Made from another folder, Thornswood\Game holds the Steam
       copy's game and exactly the files Vortex's record lists, from Vortex's
       staging folder, and not one byte of the other folder's own files.
       Nothing in that folder or in staging is changed.
    4. With two Steam copies, the one with Vortex's record is chosen, and the
       build from a Steam copy is what it always was.
    5. The picker refuses a folder with no Vortex record, and can be cleared.
    6. The nothing-deployed sentence says how to find Vortex's folder.
    7. No Steam copy at all: refused in one sentence, nothing built.

  HOW. It builds the shipped launcher\app\Steam.cs, OwnGame.cs and Verify.cs,
  with Paths.cs, Config.cs, Secrets.cs and LoadOrder.cs, using the .NET SDK
  the launcher builds with (tests\Launcher-Csc.ps1, #4823), on every machine,
  with small stand-ins for the
  classes they call that touch the machine (Checks, Keep, Junction, Downgrade,
  SkyMp, Updater). A driver builds a pretend Steam, a pretend Other Server Online
  and a pretend Vortex staging folder in a scratch folder, points Steam.cs at
  it through Steam.RootForTest, and runs the real Scan, Fix, Make and Refresh.
  Members added by this change are reached by name, so the driver also builds
  against the code before it, where the bleed test fails. The driver runs on
  Windows only, since OwnGame lays the game folder out by Windows paths and
  links with kernel32; elsewhere 1 to 7 say SKIP. The checks of the launcher's
  side, read from the source, run everywhere.

  Nothing outside its own folder in %TEMP% and its build under out\harness
  is read or written: not the real
  Steam, not Vortex, not C:\Thornswood, and nothing goes over the network.
#>
[CmdletBinding()]
param([string]$AppPath, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in launcher\tests\, the repository is two folders up.
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

# ---- the .NET SDK the launcher is built with -------------------------------
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

# OwnGameKinds and Verify name LastPlugin (#2791), which reads the game's archives through FromGameArchive.cs.
# Config, OwnGame and Verify read their JSON through LooseString.cs, and
# Verify fetches a release's plugin through Http.cs, which nothing here
# reaches (#4823).
$real = @('Steam.cs', 'OwnGame.cs', 'Verify.cs', 'Paths.cs', 'Config.cs', 'Secrets.cs', 'LoadOrder.cs', 'LastPlugin.cs', 'FromGameArchive.cs', 'LooseString.cs', 'Http.cs') |
    ForEach-Object { Join-Path $AppPath $_ }
# Config.Save reports a failed write through Swallow.Note since pull request
# 311, and Swallow needs nothing but Paths. Taken only where it exists, so the
# same harness still runs on a tree from before it, such as a hotfix branch
# cut from a live release.
$swallow = Join-Path $AppPath 'Swallow.cs'
if (Test-Path -LiteralPath $swallow) { $real += $swallow }
# OwnGame and Verify report how far they have got to the Play button since
# #1145; Progress.cs needs only Swallow. Taken only where it exists, as above.
$progress = Join-Path $AppPath 'Progress.cs'
if (Test-Path -LiteralPath $progress) { $real += $progress }
# OwnGame's archive sharing and the Downgrade's files are its other half since
# #1217 and #1218. Taken only where it exists, as above.
$ownShare = Join-Path $AppPath 'OwnGameShare.cs'
if (Test-Path -LiteralPath $ownShare) { $real += $ownShare }
# And which kind of file each is, by the pinned build's list, since #1232.
# Taken only where it exists, as above, with a list of the pretend game's own
# files embedded the way Build-Launcher embeds records\skyrim-files.json.
$ownKinds = Join-Path $AppPath 'OwnGameKinds.cs'
if (Test-Path -LiteralPath $ownKinds) { $real += $ownKinds }
foreach ($f in $real) {
    Yes "launcher\app\$([IO.Path]::GetFileName($f)) is there" (Test-Path -LiteralPath $f)
    if (-not (Test-Path -LiteralPath $f)) { Done }
}

# ---- stand-ins for what those files call that touches the machine -----------
#
# Checks moves other servers' files aside and reads the real game folder,
# Downgrade drives Steam, SkyMp and Updater reach the network. None of that is
# what is under test, and all of it would reach outside the scratch folder.
$stubs = @'
using System;
using System.Collections.Generic;

namespace Thornswood
{
    static class Checks
    {
        public const string OffSuffix = ".thornswood-off";
        public static string[] ForeignClients() { return new string[0]; }
        // The light flag of a plugin in Data, which Verify compares with the
        // server's two lists. Null is a file that cannot be read.
        public static bool? FlaggedLight(string name) { return null; }
        public static List<string> StrayCreations(ICollection<string> wanted) { return new List<string>(); }
        // Against a server's light order (#1715).
        public static List<string> StrayCreations(ICollection<string> wanted, ICollection<string> serverLight) { return new List<string>(); }
        public static bool TakesNoPlace(string name) { return false; }
        public static int IsolateForeign(Action<string> say) { return 0; }
        // The real one reads the Vortex state under this account's AppData.
        // No profile found is what OwnGame already handles: it leaves the
        // plugin list alone.
        public static string VortexProfileDir(string name) { return null; }
        public static int IsolateCreations(ICollection<string> wanted, Action<string> say) { return 0; }
        public static int IsolateCreations(ICollection<string> wanted, ICollection<string> serverLight, Action<string> say) { return 0; }
    }
    static class Keep
    {
        public static List<string> Held() { return new List<string>(); }
        // OwnGame.Foreign reads the hashed UI asset list Ship wrote, from Keep
        // among other roots (#1318).
        public static string Dir { get { return System.IO.Path.Combine(Paths.ProfileDir, "Keep"); } }
    }
    static class Junction { public static bool IsLink(string p) { return false; } }
    static class Downgrade
    {
        public static string Describe(Config cfg, string exe) { return "not 1.6.1170"; }
        // Nothing downloaded: the Steam copy is what a folder is made from.
        public static List<string> Downloaded(Config cfg) { return null; }
        public static void ClearDownloads(Config cfg, Action<string> say) { }
    }
    static class SkyMp { public static int ResourcePortFor(Config cfg) { return 0; } }
    // An install that never synced to a release record: every record of
    // Thornswood's own files is its packs', Keep's and the installer's.
    static class Updater
    {
        public const string Version = "test";
        public static bool ReleaseFilesKnown() { return true; }
        public static List<string> ReleaseFiles() { return new List<string>(); }
    }
}
'@

# ---- the driver ---------------------------------------------------------------
$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    static class VortexFolderTest
    {
        static int pass, fail;
        static void Yes(string what, bool cond)
        {
            Console.WriteLine((cond ? "PASS  " : "FAIL  ") + what);
            if (cond) pass++; else fail++;
        }

        const BindingFlags Any = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

        // Members this change added are reached by name, so the driver builds
        // against the code before it too and fails there instead of not building.
        static bool Has(Type t, string name) { return t.GetMethod(name, Any) != null || t.GetField(name, Any) != null; }
        static object Call(Type t, string name, object[] args)
        {
            MethodInfo m = t.GetMethod(name, Any);
            if (m == null) throw new MissingMethodException(t.Name + "." + name);
            try { return m.Invoke(null, args); }
            catch (TargetInvocationException ex) { throw ex.InnerException; }
        }
        static string DeploysInto(Config cfg) { return (string)Call(typeof(OwnGame), "DeploysInto", new object[] { cfg }); }
        static string DeploysElsewhere(Config cfg) { return (string)Call(typeof(OwnGame), "DeploysElsewhere", new object[] { cfg }); }
        static string PointAt(Config cfg, string folder, out bool ok)
        {
            object[] a = new object[] { cfg, folder, false };
            string said = (string)Call(typeof(OwnGame), "PointAt", a);
            ok = (bool)a[2];
            return said;
        }
        static List<string> Libraries() { return (List<string>)Call(typeof(Steam), "Libraries", new object[0]); }
        static bool OwnFolderNext() { FieldInfo f = typeof(Verify).GetField("OwnFolderNext", Any); return f != null && (bool)f.GetValue(null); }
        static string VortexFolderOf(Issue i) { FieldInfo f = typeof(Issue).GetField("VortexFolder"); return f == null ? null : (string)f.GetValue(i); }

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

        static string Id(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                Info i;
                if (!GetFileInformationByHandle(fs.SafeFileHandle, out i)) return "?";
                return i.Volume + ":" + i.IndexHigh + ":" + i.IndexLow;
            }
        }

        const int ExeBytes = 4096;
        static string T;

        static void Put(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text, new UTF8Encoding(false));
        }

        // The same length as the Steam copy's and other bytes, so the build
        // check (a size) passes for either and only where it came from differs.
        static void Exe(string path, string mark)
        {
            var b = new byte[ExeBytes];
            byte[] m = Encoding.ASCII.GetBytes(mark);
            Array.Copy(m, b, m.Length);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, b);
        }

        static string Text(string path)
        {
            try { return Encoding.ASCII.GetString(File.ReadAllBytes(path)).TrimEnd('\0'); } catch { return null; }
        }

        static string J(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

        // A record in the shape Vortex writes, measured from the real one in
        // the Steam copy on Patrick's machine on 24 September (read only).
        static void Record(string path, string staging, string target, string[][] files, DateTime when)
        {
            var sb = new StringBuilder();
            sb.Append("{\n  \"instance\": \"028e5f5a-test\",\n  \"version\": 1,\n  \"deploymentMethod\": \"hardlink_activator\",\n");
            sb.Append("  \"gameId\": \"skyrimse\",\n  \"deploymentTime\": 1790116247008,\n");
            sb.Append("  \"stagingPath\": \"" + J(staging) + "\",\n  \"targetPath\": \"" + J(target) + "\",\n  \"files\": [\n");
            for (int i = 0; i < files.Length; i++)
            {
                sb.Append("    {\n      \"relPath\": \"" + J(files[i][0]) + "\",\n      \"source\": \"" + J(files[i][1]) + "\",\n");
                if (i == 0) sb.Append("      \"merged\": [\"a\", \"b\"],\n");
                sb.Append("      \"target\": \"\",\n      \"time\": 1772817863000\n    }" + (i + 1 < files.Length ? "," : "") + "\n");
            }
            sb.Append("  ]\n}\n");
            Put(path, sb.ToString());
            File.SetLastWriteTimeUtc(path, when);
        }

        static Dictionary<string, string> Snap(string dir)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!Directory.Exists(dir)) return d;
            using (var sha = SHA256.Create())
            {
                foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                {
                    var fi = new FileInfo(f);
                    d[f.Substring(dir.Length)] = fi.Length + ":" + Convert.ToBase64String(sha.ComputeHash(File.ReadAllBytes(f))) + ":" + fi.LastWriteTimeUtc.Ticks;
                }
            }
            return d;
        }

        static bool SameSnap(Dictionary<string, string> a, Dictionary<string, string> b)
        {
            if (a.Count != b.Count) return false;
            foreach (KeyValuePair<string, string> kv in a)
            {
                string v;
                if (!b.TryGetValue(kv.Key, out v) || v != kv.Value) return false;
            }
            return true;
        }

        static List<string> Rels(string dir)
        {
            var l = new List<string>();
            if (!Directory.Exists(dir)) return l;
            string fence = dir.TrimEnd('\\') + "\\";
            foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) l.Add(f.Substring(fence.Length));
            l.Sort(StringComparer.OrdinalIgnoreCase);
            return l;
        }

        static bool Clean(string said)
        {
            return said != null && said.IndexOf('\u2014') < 0 && said.IndexOf("player", StringComparison.OrdinalIgnoreCase) < 0;
        }

        // ---- a scene: a pretend machine under T\name ------------------------
        class Scene
        {
            public string Dir, Steam, Lib2, Staging, Ts;
            public Config Cfg;
            public string Common(string lib, string game) { return Path.Combine(lib, "steamapps\\common\\" + game); }
        }

        static Scene NewScene(string name, bool seam)
        {
            var s = new Scene();
            s.Dir = Path.Combine(T, name);
            s.Steam = Path.Combine(s.Dir, "steam");
            s.Lib2 = Path.Combine(s.Dir, "lib2");
            s.Staging = Path.Combine(s.Dir, "vortex\\mods");
            s.Ts = Path.Combine(s.Dir, "Thornswood");
            Directory.CreateDirectory(Path.Combine(s.Steam, "steamapps\\common"));
            Directory.CreateDirectory(Path.Combine(s.Lib2, "steamapps\\common"));
            Put(Path.Combine(s.Steam, "config\\libraryfolders.vdf"),
                "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"" + J(s.Steam) + "\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"" + J(s.Lib2) + "\"\n\t}\n}\n");
            if (seam) typeof(Steam).GetField("RootForTest", Any).SetValue(null, s.Steam);

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
            Paths.Live = Paths.WinLocalAD;
            Paths.LiveMyGames = Paths.WinMyGames;
            Directory.CreateDirectory(Paths.ProfileDir);

            string list = "# Automatically generated by Vortex\r\n*TsOne.esp\r\n*TsTwo.esm\r\n";
            Put(Path.Combine(Paths.Golden, "plugins.txt"), list);
            Put(Path.Combine(Paths.WinLocalAD, "plugins.txt"), list);

            s.Cfg = new Config();
            s.Cfg.ServerAddress = "";          // no network, ever
            s.Cfg.ExpectedExeBytes = ExeBytes;
            s.Cfg.VortexGame = "";
            return s;
        }

        // The Steam copy: the game and nothing of Vortex's.
        static string SteamCopy(Scene s, string lib, string mark)
        {
            string g = s.Common(lib, "Skyrim Special Edition");
            Exe(Path.Combine(g, "SkyrimSE.exe"), mark + "-EXE");
            Put(Path.Combine(g, "bink2w64.dll"), mark + "-BINK");
            Put(Path.Combine(g, "Data\\Skyrim.esm"), mark + "-MASTER");
            Put(Path.Combine(g, "Data\\Skyrim - Textures0.bsa"), mark + "-BSA");
            Put(Path.Combine(g, "Data\\Scripts\\vanilla.pex"), mark + "-PEX");
            return g;
        }

        static readonly string[][] DataFiles = {
            new string[] { "TsOne.esp", "ModA" },
            new string[] { "TsTwo.esm", "ModA" },
            new string[] { "textures\\ts\\wood.dds", "ModA" },
            new string[] { "textures\\ts\\gone.dds", "ModA" },          // listed, not in staging
            new string[] { "SKSE\\Plugins\\TsHelper.dll", "ModB" },
            new string[] { "meshes\\ts\\chair.nif", "ModB" },
            new string[] { "Scripts\\vanilla.pex", "ModB" },             // a mod's copy of a game file
            new string[] { "..\\..\\escape.txt", "ModA" },               // would climb out of the game folder
            new string[] { "High.ini", "..\\..\\..\\steam\\steamapps\\common\\Other Server Online" },   // would read the other folder
        };
        static readonly string[][] RootFiles = {
            new string[] { "skse64_loader.exe", "SKSE" },
            new string[] { "Data\\Scripts\\input.pex", "SKSE" },
        };

        static void Staging(Scene s)
        {
            Put(Path.Combine(s.Staging, "ModA\\TsOne.esp"), "VORTEX-TSONE");
            Put(Path.Combine(s.Staging, "ModA\\TsTwo.esm"), "VORTEX-TSTWO");
            Put(Path.Combine(s.Staging, "ModA\\textures\\ts\\wood.dds"), "VORTEX-DDS");
            Put(Path.Combine(s.Staging, "ModB\\SKSE\\Plugins\\TsHelper.dll"), "VORTEX-DLL");
            Put(Path.Combine(s.Staging, "ModB\\meshes\\ts\\chair.nif"), "VORTEX-NIF");
            Put(Path.Combine(s.Staging, "ModB\\Scripts\\vanilla.pex"), "VORTEX-PEX");
            Put(Path.Combine(s.Staging, "SKSE\\skse64_loader.exe"), "VORTEX-LOADER");
            Put(Path.Combine(s.Staging, "SKSE\\Data\\Scripts\\input.pex"), "VORTEX-INPUT");
            // In staging and in no record: Vortex has it, did not deploy it.
            Put(Path.Combine(s.Staging, "ModC\\NotDeployed.esp"), "VORTEX-UNDEPLOYED");
        }

        // Another server's copy of Skyrim that Vortex deploys into. Every file
        // of its own says THEIRS, so one byte of it in Thornswood's folder shows.
        static string OtherServer(Scene s, string lib, string name, DateTime when)
        {
            string k = s.Common(lib, name);
            Exe(Path.Combine(k, "SkyrimSE.exe"), "THEIRS-EXE");
            Put(Path.Combine(k, "skse64_1_6_1170.dll"), "THEIRS-SKSE");
            Put(Path.Combine(k, "bink2w64.dll"), "THEIRS-BINK");
            Put(Path.Combine(k, "High.ini"), "THEIRS-INI");
            Put(Path.Combine(k, "ControlMap_Custom.txt"), "THEIRS-CONTROLS");
            Put(Path.Combine(k, "installscript.vdf"), "THEIRS-VDF");
            Put(Path.Combine(k, "Mods\\x.txt"), "THEIRS-MODS");
            Put(Path.Combine(k, "src\\x.txt"), "THEIRS-SRC");
            Put(Path.Combine(k, "Skyrim\\x.txt"), "THEIRS-SKYRIM");
            Put(Path.Combine(k, "Creations\\x.txt"), "THEIRS-CREATIONS");
            Put(Path.Combine(k, "Data\\Platform\\Plugins\\skymp5-client.js"), "THEIRS-CLIENT");
            Put(Path.Combine(k, "Data\\TheirOnly.esp"), "THEIRS-PLUGIN");
            Put(Path.Combine(k, "Data\\Scripts\\theirs.pex"), "THEIRS-SCRIPT");
            Put(Path.Combine(k, "Data\\textures\\theirs\\sky.dds"), "THEIRS-TEXTURE");
            // Where Vortex deployed, with what is there now: the other server's
            // installer has since written over one, so taking the file from
            // this folder rather than from staging would show.
            Put(Path.Combine(k, "Data\\TsOne.esp"), "THEIRS-OVERWROTE");
            Put(Path.Combine(k, "Data\\TsTwo.esm"), "VORTEX-TSTWO");
            Put(Path.Combine(k, "Data\\textures\\ts\\wood.dds"), "VORTEX-DDS");
            Put(Path.Combine(k, "skse64_loader.exe"), "THEIRS-LOADER");
            Record(Path.Combine(k, "Data\\vortex.deployment.json"), s.Staging, Path.Combine(k, "Data"), DataFiles, when);
            Record(Path.Combine(k, "vortex.deployment.dinput.json"), s.Staging, k, RootFiles, when);
            return k;
        }

        static int Main(string[] args)
        {
            T = args[0];
            bool seam = typeof(Steam).GetField("RootForTest", Any) != null;
            Yes("Steam.cs can be pointed at a pretend Steam (Steam.RootForTest)", seam);
            bool found = Has(typeof(OwnGame), "DeploysInto") && Has(typeof(OwnGame), "PointAt") && Has(typeof(OwnGame), "DeploysElsewhere");
            Yes("OwnGame can say where Vortex deploys and be pointed at it (DeploysInto, DeploysElsewhere, PointAt)", found);

            try
            {
                if (seam) OtherServerScene(found);
                else OldCode();
                if (seam && found)
                {
                    TwoCopies();
                    StaleInSteam();
                    Preference();
                    StagingInside();
                    Ordinary();
                    SoloLeftovers();
                    Picker();
                    NothingDeployed();
                    NoSteamCopy();
                }
            }
            catch (Exception ex)
            {
                Yes("the driver ran to the end (" + ex.GetType().Name + ": " + ex.Message + ")", false);
            }
            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            return fail > 0 ? 1 : 0;
        }

        // ---- the code before the change -------------------------------------
        //
        // No seam, so the real Steam must never be asked: the old launcher is
        // pointed at the pretend Other Server Online through VortexGame, which is
        // all it had, and made to build. This is where the bleed shows.
        static void OldCode()
        {
            Scene s = NewScene("old", false);
            string steam = SteamCopy(s, s.Steam, "STEAM");
            Staging(s);
            string k = OtherServer(s, s.Steam, "Other Server Online", DateTime.UtcNow.AddMinutes(-5));
            s.Cfg.VortexGame = k;
            try { OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            Bleed(s, steam, k, "the code before the change, pointed at the other folder");
        }

        static void Bleed(Scene s, string steam, string k, string when)
        {
            string game = OwnGame.Folder;
            List<string> rels = Rels(game);
            Yes(when + ": Thornswood's folder was made", rels.Count > 0);
            var expect = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            expect["SkyrimSE.exe"] = "STEAM-EXE";
            expect["bink2w64.dll"] = "STEAM-BINK";
            expect["Data\\Skyrim.esm"] = "STEAM-MASTER";
            expect["Data\\Skyrim - Textures0.bsa"] = "STEAM-BSA";
            expect["Data\\Scripts\\vanilla.pex"] = "VORTEX-PEX";
            expect["Data\\TsOne.esp"] = "VORTEX-TSONE";
            expect["Data\\TsTwo.esm"] = "VORTEX-TSTWO";
            expect["Data\\textures\\ts\\wood.dds"] = "VORTEX-DDS";
            expect["Data\\SKSE\\Plugins\\TsHelper.dll"] = "VORTEX-DLL";
            expect["Data\\meshes\\ts\\chair.nif"] = "VORTEX-NIF";
            expect["skse64_loader.exe"] = "VORTEX-LOADER";
            expect["Data\\Scripts\\input.pex"] = "VORTEX-INPUT";

            var extra = new List<string>();
            foreach (string r in rels) if (!expect.ContainsKey(r)) extra.Add(r);
            var absent = new List<string>();
            foreach (string r in expect.Keys) if (!rels.Contains(r)) absent.Add(r);
            Yes(when + ": it holds nothing but the Steam copy's game and the files Vortex's record lists" +
                (extra.Count > 0 ? " (also has " + string.Join(", ", extra.ToArray()) + ")" : ""), extra.Count == 0);
            Yes(when + ": and all of those" + (absent.Count > 0 ? " (missing " + string.Join(", ", absent.ToArray()) + ")" : ""), absent.Count == 0);

            var wrong = new List<string>();
            foreach (KeyValuePair<string, string> kv in expect)
            {
                string p = Path.Combine(game, kv.Key);
                if (File.Exists(p) && Text(p) != kv.Value) wrong.Add(kv.Key + " is " + Text(p));
            }
            Yes(when + ": the game itself is the Steam copy's and every mod file is Vortex's staging copy" +
                (wrong.Count > 0 ? " (" + string.Join("; ", wrong.ToArray()) + ")" : ""), wrong.Count == 0);

            var theirs = new List<string>();
            foreach (string r in rels)
            {
                string t = Text(Path.Combine(game, r)) ?? "";
                if (t.IndexOf("THEIRS", StringComparison.Ordinal) >= 0) theirs.Add(r);
            }
            Yes(when + ": not one of the other folder's own files is in it: exe, script extender, bink, ini, " +
                "ControlMap, installscript, client, its own plugin, script and texture, Mods, src, Skyrim, Creations" +
                (theirs.Count > 0 ? " (found " + string.Join(", ", theirs.ToArray()) + ")" : ""), theirs.Count == 0);
            Yes(when + ": what Vortex has in staging and did not deploy stays out", !File.Exists(Path.Combine(game, "Data\\NotDeployed.esp")));
        }

        // ---- 1 and 3: Other Server Online ------------------------------------------
        static void OtherServerScene(bool found)
        {
            Scene s = NewScene("otherserver", true);
            List<string> libs = Libraries();
            bool fenced = libs.Count > 0;
            foreach (string l in libs) if (!l.StartsWith(T, StringComparison.OrdinalIgnoreCase)) fenced = false;
            Yes("the only Steam libraries it sees are the pretend ones", fenced);
            if (!fenced) throw new Exception("Steam was not fenced into the scratch folder; stopping before anything is built");
            if (!found) return;

            string steam = SteamCopy(s, s.Steam, "STEAM");
            Staging(s);
            string k = OtherServer(s, s.Steam, "Other Server Online", DateTime.UtcNow.AddMinutes(-5));
            // SteamCopy is what Paths.Init sets beside Game under the collection (#1226).
            Paths.Game = Paths.SteamCopy = steam;

            Yes("Steam.SkyrimPath still answers the Steam copy", string.Equals(Steam.SkyrimPath(), steam, StringComparison.OrdinalIgnoreCase));
            Yes("the folder Vortex deploys into is found without being told: Other Server Online", string.Equals(DeploysInto(s.Cfg), k, StringComparison.OrdinalIgnoreCase));
            Yes("the game itself still comes from the Steam copy (Source, which Downgrade, Leaks and Uninstall use)", string.Equals(OwnGame.Source(s.Cfg), steam, StringComparison.OrdinalIgnoreCase));
            string why = OwnGame.WhyNot(s.Cfg, DeploysInto(s.Cfg));
            Yes("and the folder can be made from it" + (why == null ? "" : " (" + why + ")"), why == null);

            // Scan.
            Dictionary<string, string> before = Snap(k), staged = Snap(s.Staging);
            List<Issue> issues = Verify.Run(s.Cfg);
            Issue first = issues.Count > 0 ? issues[0] : null;
            Yes("Scan's first line names Other Server Online as where Vortex deploys",
                first != null && first.Text.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0 && first.Text.IndexOf("Fix", StringComparison.Ordinal) >= 0);
            Yes("and says Fix makes Thornswood's own folder from it, the game from the Steam copy",
                first != null && first.Text.IndexOf("own Skyrim folder", StringComparison.Ordinal) >= 0 && first.Text.IndexOf("Steam copy", StringComparison.Ordinal) >= 0);
            Yes("it carries the folder for Fix, and blocks as the missing plugins already do",
                first != null && string.Equals(VortexFolderOf(first), k, StringComparison.OrdinalIgnoreCase) && first.Blocking);
            Yes("the words are the house words: no em dash, never player", first != null && Clean(first.Text));
            // Since #2627 (#2403) nothing of the Steam copy's is judged while
            // there is no folder of its own: the folder is what Fix makes,
            // and the plugins are judged in it.
            Yes("and nothing after it: the plugins missing from the Steam copy are not judged there", issues.Count == 1);
            Yes("DeploysElsewhere answers the same folder", string.Equals(DeploysElsewhere(s.Cfg), k, StringComparison.OrdinalIgnoreCase));

            string log = File.Exists(Paths.LogFile) ? File.ReadAllText(Paths.LogFile) : "";
            int told = 0, at = 0;
            string line = "Vortex deploys into " + k + ": found in Steam's libraries";
            while ((at = log.IndexOf(line, at, StringComparison.OrdinalIgnoreCase)) >= 0) { told++; at += line.Length; }
            Yes("the log says once which folder was chosen and why, however often it was asked (" + told + ")", told == 1);

            // Fix.
            var said = new List<string>();
            Verify.Fix(s.Cfg, delegate(string m) { said.Add(m); }, null);
            Config saved = Config.Load(Paths.CfgFile);
            Yes("Fix saves Other Server Online as VortexGame in config.json", saved != null && string.Equals(saved.VortexGame, k, StringComparison.OrdinalIgnoreCase));
            Yes("and hands on to making the own folder the way Make it does (Verify.OwnFolderNext)", OwnFolderNext());
            bool named = false;
            foreach (string m in said) if (m.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0 && Clean(m)) named = true;
            Yes("and says what it did, naming the folder", named);
            Yes("VortexGame now wins over the search", string.Equals(DeploysInto(s.Cfg), k, StringComparison.OrdinalIgnoreCase));

            // Make, which is what Make it runs.
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            Yes("the own folder is built from it", made != null && Directory.Exists(OwnGame.Folder));
            Bleed(s, steam, k, "built from Other Server Online");

            string game = OwnGame.Folder;
            Yes("the big mod files are hard links to Vortex's staging copies, so the collection is not on the disk twice",
                File.Exists(Path.Combine(game, "Data\\TsOne.esp")) && Id(Path.Combine(game, "Data\\TsOne.esp")) == Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")) &&
                Id(Path.Combine(game, "Data\\textures\\ts\\wood.dds")) == Id(Path.Combine(s.Staging, "ModA\\textures\\ts\\wood.dds")));
            Yes("the game's archives are links to the Steam copy",
                File.Exists(Path.Combine(game, "Data\\Skyrim - Textures0.bsa")) && Id(Path.Combine(game, "Data\\Skyrim - Textures0.bsa")) == Id(Path.Combine(steam, "Data\\Skyrim - Textures0.bsa")));
            Yes("what gets rewritten in place is copied, as it always was: the exe, the masters, the script extender's folder",
                File.Exists(Path.Combine(game, "SkyrimSE.exe")) && Id(Path.Combine(game, "SkyrimSE.exe")) != Id(Path.Combine(steam, "SkyrimSE.exe")) &&
                Id(Path.Combine(game, "Data\\Skyrim.esm")) != Id(Path.Combine(steam, "Data\\Skyrim.esm")) &&
                Id(Path.Combine(game, "Data\\SKSE\\Plugins\\TsHelper.dll")) != Id(Path.Combine(s.Staging, "ModB\\SKSE\\Plugins\\TsHelper.dll")));

            string files = File.ReadAllText(Path.Combine(OwnGame.Dir, "files.txt"));
            Yes("files.txt marks the record's files as Vortex's (V) and the game's as not (O), which Publish-Update reads",
                files.IndexOf("|V|", StringComparison.Ordinal) >= 0 && files.IndexOf("|O|", StringComparison.Ordinal) >= 0 &&
                System.Text.RegularExpressions.Regex.IsMatch(files, @"\|V\|\d+\|\d+\|Data\\TsOne\.esp") &&
                System.Text.RegularExpressions.Regex.IsMatch(files, @"\|O\|\d+\|\d+\|Data\\Skyrim\.esm"));
            string left = File.ReadAllText(Path.Combine(OwnGame.Dir, "left-out.txt"));
            Yes("a file the record lists and staging does not have is left out and said", left.IndexOf("gone.dds", StringComparison.OrdinalIgnoreCase) >= 0);
            Yes("a record entry that would climb out of the game folder, or read the other folder, is refused and said",
                left.IndexOf("escape.txt", StringComparison.OrdinalIgnoreCase) >= 0 && left.IndexOf("High.ini", StringComparison.OrdinalIgnoreCase) >= 0 &&
                !File.Exists(Path.Combine(s.Dir, "escape.txt")) && !File.Exists(Path.Combine(s.Ts, "escape.txt")));
            Yes("nothing in Other Server Online was changed", SameSnap(before, Snap(k)));
            Yes("nothing in Vortex's staging was changed", SameSnap(staged, Snap(s.Staging)));

            // Refresh, once the launcher runs from the folder.
            Paths.Collection = false;
            Paths.Game = OwnGame.Folder;
            Yes("the launcher now runs from it (OwnGame.Active)", OwnGame.Active);
            Yes("and has nothing to refresh until Vortex deploys again", !OwnGame.NeedsRefresh(s.Cfg));
            Put(Path.Combine(s.Staging, "ModA\\textures\\ts\\new.dds"), "VORTEX-NEW");
            var next = new List<string[]>();
            foreach (string[] f in DataFiles) if (f[0] != "meshes\\ts\\chair.nif") next.Add(f);
            next.Add(new string[] { "textures\\ts\\new.dds", "ModA" });
            Record(Path.Combine(k, "Data\\vortex.deployment.json"), s.Staging, Path.Combine(k, "Data"), next.ToArray(), DateTime.UtcNow.AddMinutes(2));
            Put(Path.Combine(k, "Data\\textures\\ts\\new.dds"), "THEIRS-OVERWROTE-NEW");
            Put(Path.Combine(k, "Data\\TheirLater.esp"), "THEIRS-LATER");
            before = Snap(k);
            staged = Snap(s.Staging);
            Yes("Vortex deploying again into Other Server Online is noticed", OwnGame.NeedsRefresh(s.Cfg));
            string refreshed = null;
            try { refreshed = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes("the refresh runs", refreshed != null);
            Yes("it brings in the new file from staging", Text(Path.Combine(game, "Data\\textures\\ts\\new.dds")) == "VORTEX-NEW");
            Yes("and takes out the one Vortex no longer deploys", !File.Exists(Path.Combine(game, "Data\\meshes\\ts\\chair.nif")));
            bool dirty = false;
            foreach (string r in Rels(game)) if ((Text(Path.Combine(game, r)) ?? "").IndexOf("THEIRS", StringComparison.Ordinal) >= 0) dirty = true;
            Yes("and still nothing of the other folder's own comes with it", !dirty);
            Yes("nothing in Other Server Online or staging was changed by the refresh", SameSnap(before, Snap(k)) && SameSnap(staged, Snap(s.Staging)));
            Yes("the game still comes from the Steam copy, which is where Downgrade works", string.Equals(OwnGame.Source(s.Cfg), steam, StringComparison.OrdinalIgnoreCase));
        }

        // ---- 2: two Steam copies ---------------------------------------------
        static void TwoCopies()
        {
            Scene s = NewScene("two", true);
            string first = SteamCopy(s, s.Steam, "STEAM");
            string second = SteamCopy(s, s.Lib2, "LIB2");
            Put(Path.Combine(second, "Data\\TsOne.esp"), "LIB2-TSONE");
            Put(Path.Combine(second, "Data\\TsTwo.esm"), "LIB2-TSTWO");
            Put(Path.Combine(second, "Mods\\left-by-someone.txt"), "LIB2-OWN");
            Record(Path.Combine(second, "Data\\vortex.deployment.json"), s.Staging, Path.Combine(second, "Data"),
                   new string[][] { new string[] { "TsOne.esp", "ModA" }, new string[] { "TsTwo.esm", "ModA" } }, DateTime.UtcNow);
            Paths.Game = Paths.SteamCopy = first;
            Yes("two Steam copies: SkyrimPath still answers the first", string.Equals(Steam.SkyrimPath(), first, StringComparison.OrdinalIgnoreCase));
            Yes("the one with Vortex's record is chosen", string.Equals(DeploysInto(s.Cfg), second, StringComparison.OrdinalIgnoreCase));
            Yes("and, being a Steam copy, the game comes from it too", string.Equals(OwnGame.Source(s.Cfg), second, StringComparison.OrdinalIgnoreCase));
            List<Issue> issues = Verify.Run(s.Cfg);
            Yes("Scan names it", issues.Count > 0 && string.Equals(VortexFolderOf(issues[0]), second, StringComparison.OrdinalIgnoreCase) &&
                issues[0].Text.IndexOf("taking the game itself", StringComparison.Ordinal) < 0);
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            Yes("the folder is made from it", made != null && Text(Path.Combine(OwnGame.Folder, "Data\\TsOne.esp")) == "LIB2-TSONE");
            // Since #1232 only Skyrim's own files, Vortex's and Thornswood's
            // come from a Steam copy; a file somebody left there by hand stays.
            Yes("the game comes from it, and a file left in it by hand stays out of Thornswood's folder",
                !File.Exists(Path.Combine(OwnGame.Folder, "Mods\\left-by-someone.txt")) && Text(Path.Combine(OwnGame.Folder, "SkyrimSE.exe")) == "LIB2-EXE");
        }

        // ---- an older deployment left in the Steam copy ----------------------
        //
        // Vortex moved to Other Server Online and something of its old deployment
        // stayed behind in the Steam copy. The game is taken from the Steam
        // copy; that old deployment is not the game and stays out.
        static void StaleInSteam()
        {
            Scene s = NewScene("stale", true);
            string steam = SteamCopy(s, s.Steam, "STEAM");
            Put(Path.Combine(steam, "Data\\Stale.esp"), "STALE-MOD");
            Record(Path.Combine(steam, "Data\\vortex.deployment.json"), s.Staging, Path.Combine(steam, "Data"),
                   new string[][] { new string[] { "Stale.esp", "ModOld" } }, DateTime.UtcNow.AddDays(-2));
            Staging(s);
            string k = OtherServer(s, s.Steam, "Other Server Online", DateTime.UtcNow);
            s.Cfg.VortexGame = k;
            Paths.Game = Paths.SteamCopy = steam;
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string game = OwnGame.Folder;
            Yes("an older Vortex deployment left in the Steam copy is not taken as part of the game",
                made != null && !File.Exists(Path.Combine(game, "Data\\Stale.esp")) && Text(Path.Combine(game, "Data\\TsOne.esp")) == "VORTEX-TSONE" &&
                File.ReadAllText(Path.Combine(OwnGame.Dir, "left-out.txt")).IndexOf("Stale.esp", StringComparison.Ordinal) >= 0);
        }

        // ---- which record wins ---------------------------------------------
        static void Preference()
        {
            Scene s = NewScene("prefer", true);
            SteamCopy(s, s.Steam, "STEAM");
            string ssc = SteamCopy(s, s.Lib2, "LIB2");
            Record(Path.Combine(ssc, "Data\\vortex.deployment.json"), s.Staging, Path.Combine(ssc, "Data"), new string[][] { new string[] { "TsOne.esp", "ModA" } }, DateTime.UtcNow.AddHours(-3));
            string k = OtherServer(s, s.Steam, "Other Server Online", DateTime.UtcNow);
            Yes("a Steam copy of Skyrim Special Edition with a record comes before a newer record elsewhere",
                string.Equals(DeploysInto(s.Cfg), ssc, StringComparison.OrdinalIgnoreCase));

            Scene t = NewScene("newest", true);
            SteamCopy(t, t.Steam, "STEAM");
            OtherServer(t, t.Steam, "Other Server Online", DateTime.UtcNow.AddHours(-3));
            string other = OtherServer(t, t.Lib2, "Some Other Server", DateTime.UtcNow);
            Yes("among folders that are not Steam copies, the newest record wins", string.Equals(DeploysInto(t.Cfg), other, StringComparison.OrdinalIgnoreCase));
            t.Cfg.VortexGame = Path.Combine(t.Steam, "steamapps\\common\\Other Server Online");
            Yes("and VortexGame wins over the search", string.Equals(DeploysInto(t.Cfg), t.Cfg.VortexGame, StringComparison.OrdinalIgnoreCase));

            // A choice Vortex has since purged does not pin Thornswood to it.
            // Fix saved Other Server Online; the tester then pointed Vortex back at
            // the Steam copy, which purges the other server and deploys into the copy.
            Scene u = NewScene("purged", true);
            string copy = SteamCopy(u, u.Steam, "STEAM");
            string was = OtherServer(u, u.Steam, "Other Server Online", DateTime.UtcNow.AddHours(-1));
            u.Cfg.VortexGame = was;
            Yes("a saved folder with Vortex's record is used", string.Equals(DeploysInto(u.Cfg), was, StringComparison.OrdinalIgnoreCase));
            File.Delete(Path.Combine(was, "Data\\vortex.deployment.json"));
            Record(Path.Combine(copy, "Data\\vortex.deployment.json"), u.Staging, Path.Combine(copy, "Data"),
                   new string[][] { new string[] { "TsOne.esp", "ModA" } }, DateTime.UtcNow);
            Yes("once Vortex has purged it and deploys into the Steam copy, the Steam copy is used, with nothing to forget by hand",
                string.Equals(DeploysInto(u.Cfg), copy, StringComparison.OrdinalIgnoreCase));
            File.Delete(Path.Combine(copy, "Data\\vortex.deployment.json"));
            Yes("and with no record anywhere it names the Steam copy for WhyNot, not the purged folder",
                string.Equals(DeploysInto(u.Cfg), copy, StringComparison.OrdinalIgnoreCase));
        }

        // ---- a record whose mods folder is the other folder itself ---------
        //
        // The judge of the hotfix 1.1.93 verification: nothing checked that
        // Vortex's mods folder named in a record lies outside the folder it
        // deploys into, so a record naming Other Server Online itself as staging
        // would bring in any of that server's own files it listed. Vortex will not
        // write such a record; the launcher must not trust one anyway.
        static void StagingInside()
        {
            Scene s = NewScene("inside", true);
            string steam = SteamCopy(s, s.Steam, "STEAM");
            Staging(s);
            string k = OtherServer(s, s.Steam, "Other Server Online", DateTime.UtcNow);
            // Everything the record lists really is under the folder it names,
            // so without the refusal the build goes ahead and takes them.
            Put(Path.Combine(k, "ModA\\TsOne.esp"), "THEIRS-MODA-ONE");
            Put(Path.Combine(k, "ModA\\TsTwo.esm"), "THEIRS-MODA-TWO");
            Record(Path.Combine(k, "Data\\vortex.deployment.json"), k, Path.Combine(k, "Data"),
                   new string[][] { new string[] { "TsOne.esp", "ModA" }, new string[] { "TsTwo.esm", "ModA" }, new string[] { "x.txt", "Mods" } }, DateTime.UtcNow);
            Paths.Game = Paths.SteamCopy = steam;
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string game = OwnGame.Folder;
            bool none = !File.Exists(Path.Combine(game, "Data\\x.txt")) &&
                        Text(Path.Combine(game, "Data\\TsOne.esp")) != "THEIRS-MODA-ONE" && Text(Path.Combine(game, "Data\\TsTwo.esm")) != "THEIRS-MODA-TWO";
            Yes("a record whose mods folder is the other folder itself brings nothing of that folder in", none);
            string left = "";
            try { left = File.ReadAllText(Path.Combine(OwnGame.Dir, "left-out.txt")); } catch { }
            Yes("and says why, if a folder was built at all", made == null || left.IndexOf("overlaps", StringComparison.Ordinal) >= 0);
        }

        // ---- the ordinary case, unchanged -----------------------------------
        static void Ordinary()
        {
            Scene s = NewScene("ordinary", true);
            string steam = SteamCopy(s, s.Steam, "STEAM");
            Staging(s);
            // Vortex deployed into the Steam copy. The deployed plugin differs
            // from staging here only so it shows which one was taken.
            Put(Path.Combine(steam, "Data\\TsOne.esp"), "DEPLOYED-TSONE");
            Put(Path.Combine(steam, "Data\\TsTwo.esm"), "DEPLOYED-TSTWO");
            Put(Path.Combine(steam, "Data\\Loose.esp"), "STEAM-LOOSE");
            Record(Path.Combine(steam, "Data\\vortex.deployment.json"), s.Staging, Path.Combine(steam, "Data"),
                   new string[][] { new string[] { "TsOne.esp", "ModA" }, new string[] { "TsTwo.esm", "ModA" } }, DateTime.UtcNow);
            Paths.Game = Paths.SteamCopy = steam;
            Yes("Vortex deploying into the Steam copy: it is the answer, as it always was", string.Equals(DeploysInto(s.Cfg), steam, StringComparison.Ordinal));
            Yes("Scan says nothing about another folder", DeploysElsewhere(s.Cfg) == "" && (Verify.Run(s.Cfg).Count == 0 || VortexFolderOf(Verify.Run(s.Cfg)[0]) == null));
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string game = OwnGame.Folder;
            // Since #1232 Skyrim's own files and Vortex's, and not the plugin
            // somebody put into the Steam copy by hand (Data\Loose.esp).
            List<string> expect = new List<string> { "bink2w64.dll", "Data\\Scripts\\vanilla.pex", "Data\\Skyrim - Textures0.bsa",
                                                     "Data\\Skyrim.esm", "Data\\TsOne.esp", "Data\\TsTwo.esm", "SkyrimSE.exe" };
            expect.Sort(StringComparer.OrdinalIgnoreCase);
            Yes("the folder is Skyrim's own files and Vortex's from the Steam copy, and a plugin put there by hand stays out",
                made != null && string.Join("|", Rels(game).ToArray()) == string.Join("|", expect.ToArray()));
            Yes("taken from the Steam copy itself, not from staging",
                Text(Path.Combine(game, "Data\\TsOne.esp")) == "DEPLOYED-TSONE" && Id(Path.Combine(game, "Data\\TsOne.esp")) == Id(Path.Combine(steam, "Data\\TsOne.esp")));
            Paths.Collection = false;
            Paths.Game = Paths.SteamCopy = game;
            string again = null;
            try { again = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes("and a refresh with nothing new changes nothing", again != null && again.IndexOf("already matches", StringComparison.Ordinal) >= 0);
        }

        // ---- 8: a Solo setup in the same Steam copy ----------------------------
        //
        // 26 September, Djinn's machine: Nemesis run for a Solo profile rewrote
        // the Steam copy's behavior files in place and both Thornswood folders,
        // which linked them, played the Solo animations from that moment; a
        // refresh then brought in _Parked, _Solo Mods and _Profile Switch, and
        // the next dev Ship tried to send them all to every tester.
        static void SoloLeftovers()
        {
            Scene s = NewScene("solo", true);
            string steam = SteamCopy(s, s.Steam, "STEAM");
            Staging(s);
            Put(Path.Combine(steam, "Data\\TsOne.esp"), "DEPLOYED-TSONE");
            Put(Path.Combine(steam, "Data\\TsTwo.esm"), "DEPLOYED-TSTWO");
            string beh = "Data\\Meshes\\actors\\character\\behaviors\\1hm_behavior.hkx";
            string male = "Data\\Meshes\\actors\\character\\characters\\defaultmale.hkx";
            string fnis = "Data\\Scripts\\FNIS.pex";
            string anim = "Data\\Meshes\\actors\\character\\animations\\walk.hkx";
            Put(Path.Combine(steam, beh), "TS-BEHAVIOR");
            Put(Path.Combine(steam, male), "TS-MALE");
            Put(Path.Combine(steam, fnis), "TS-FNIS");
            Put(Path.Combine(steam, anim), "ANIMATION");
            Put(Path.Combine(steam, "_Parked\\Multiplayer\\Platform\\voice-token.txt"), "PARKED-TOKEN");
            Put(Path.Combine(steam, "_Profile Switch\\Switch.ps1"), "SWITCH");
            Put(Path.Combine(steam, "Data\\_disabledByOtherServer\\ccParked.esm"), "PARKED-CC");
            Put(Path.Combine(steam, "Data\\_ResourcePack.esl"), "GAME-RESOURCEPACK");
            // The behavior output is Thornswood's, from a pack, as the shipping
            // machine's Nemesis output is: since #1232 a file in the Steam copy
            // that no record names is not taken at all.
            Put(Path.Combine(Paths.PacksDir, "20260926-0000.files"), "a|game\\" + beh + "\r\nb|game\\" + male + "\r\nc|game\\" + fnis + "\r\n");
            // The animation is the collection's, deployed by Vortex. Since
            // #1218 only Vortex's files are linked; the game's own are copies.
            Record(Path.Combine(steam, "Data\\vortex.deployment.json"), s.Staging, Path.Combine(steam, "Data"),
                   new string[][] { new string[] { "TsOne.esp", "ModA" }, new string[] { "TsTwo.esm", "ModA" },
                                    new string[] { "Meshes\\actors\\character\\animations\\walk.hkx", "ModA" } }, DateTime.UtcNow);
            Paths.Game = Paths.SteamCopy = steam;
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string game = OwnGame.Folder;
            bool parked = false;
            foreach (string r in Rels(game)) if (r.StartsWith("_") || r.StartsWith("Data\\_d", StringComparison.OrdinalIgnoreCase)) parked = true;
            Yes("Solo leftovers: folders parked in the Steam copy stay out of Thornswood's folder", made != null && !parked);
            Yes("but a game file whose name starts with an underscore comes in", Text(Path.Combine(game, "Data\\_ResourcePack.esl")) == "GAME-RESOURCEPACK");
            Yes("the behavior file, the character default and FNIS.pex are copies of their own",
                made != null && Id(Path.Combine(game, beh)) != Id(Path.Combine(steam, beh)) &&
                Id(Path.Combine(game, male)) != Id(Path.Combine(steam, male)) && Id(Path.Combine(game, fnis)) != Id(Path.Combine(steam, fnis)));
            Yes("an ordinary animation is still linked, so the collection is not on the disk twice",
                made != null && Id(Path.Combine(game, anim)) == Id(Path.Combine(steam, anim)));
            // Nemesis for another profile, written into the Steam copy in place.
            using (var fs = new FileStream(Path.Combine(steam, beh), FileMode.Open, FileAccess.Write, FileShare.ReadWrite))
            {
                byte[] b = Encoding.ASCII.GetBytes("SOLO-BEHAVIOR");
                fs.SetLength(0); fs.Write(b, 0, b.Length);
            }
            Yes("Nemesis rewriting the Steam copy's behavior file does not reach Thornswood", Text(Path.Combine(game, beh)) == "TS-BEHAVIOR");

            // A folder made under rules 4: the behavior file linked, a parked folder brought in.
            string dest = Path.Combine(game, beh);
            File.Delete(dest);
            Yes("(an older folder is set up with the behavior file linked)", CreateHardLink(dest, Path.Combine(steam, beh), IntPtr.Zero));
            string oldPark = Path.Combine(game, "_Parked\\Multiplayer\\Platform\\voice-token.txt");
            Put(oldPark, "PARKED-TOKEN");
            string files = Path.Combine(OwnGame.Dir, "files.txt");
            var lines = new List<string>(File.ReadAllLines(files));
            for (int i = 0; i < lines.Count; i++)
                if (lines[i].EndsWith("|" + beh, StringComparison.OrdinalIgnoreCase)) lines[i] = "L" + lines[i].Substring(1);
            lines.Add("C|O|12|0|_Parked\\Multiplayer\\Platform\\voice-token.txt");
            File.WriteAllLines(files, lines.ToArray());
            string madeFile = Path.Combine(OwnGame.Dir, "made.txt");
            var made4 = new List<string>();
            foreach (string l in File.ReadAllLines(madeFile)) made4.Add(l.StartsWith("rules=") ? "rules=4" : l);
            File.WriteAllLines(madeFile, made4.ToArray());
            Paths.Collection = false;
            Paths.Game = Paths.SteamCopy = game;
            Yes("a folder made under the old rules asks to refresh", OwnGame.NeedsRefresh(s.Cfg));
            string again = null;
            try { again = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes("and the refresh gives it its own copy of the linked behavior file",
                again != null && Id(dest) != Id(Path.Combine(steam, beh)));
            Yes("and takes the parked folder out", again != null && !File.Exists(oldPark));
        }

        // ---- 4: the picker -----------------------------------------------------
        static void Picker()
        {
            Scene s = NewScene("picker", true);
            SteamCopy(s, s.Steam, "STEAM");
            string bare = s.Common(s.Steam, "Bare Skyrim");
            Exe(Path.Combine(bare, "SkyrimSE.exe"), "BARE-EXE");
            string empty = Path.Combine(s.Dir, "nothing here");
            Directory.CreateDirectory(empty);
            Staging(s);
            string k = OtherServer(s, s.Lib2, "Other Server Online", DateTime.UtcNow);
            s.Cfg.Save(Paths.CfgFile);

            bool ok;
            string said = PointAt(s.Cfg, bare, out ok);
            Yes("the picker refuses a Skyrim with no Vortex record", !ok && s.Cfg.VortexGame == "" && Config.Load(Paths.CfgFile).VortexGame == "");
            Yes("and says why, in the house words", said.IndexOf("vortex.deployment.json", StringComparison.Ordinal) >= 0 && Clean(said));
            said = PointAt(s.Cfg, empty, out ok);
            Yes("and a folder with no SkyrimSE.exe", !ok && s.Cfg.VortexGame == "" && said.IndexOf("SkyrimSE.exe", StringComparison.Ordinal) >= 0);
            said = PointAt(s.Cfg, k + "\\", out ok);
            Yes("it takes the folder Vortex deploys into, saved as VortexGame", ok && string.Equals(Config.Load(Paths.CfgFile).VortexGame, k, StringComparison.OrdinalIgnoreCase));
            Yes("and says the game itself still comes from the Steam copy", said.IndexOf("Steam copy", StringComparison.Ordinal) >= 0 && Clean(said));
            said = PointAt(s.Cfg, "", out ok);
            Yes("and it can be cleared, handing back to the search", ok && s.Cfg.VortexGame == "" && Config.Load(Paths.CfgFile).VortexGame == "" && Clean(said));

            // Verification of hotfix 1.1.93: a path pasted from Explorer's Copy
            // as path arrives in quotes, and Path.Combine threw on it.
            said = PointAt(s.Cfg, "\"" + k + "\"", out ok);
            Yes("a folder pasted in quotes is taken", ok && string.Equals(Config.Load(Paths.CfgFile).VortexGame, k, StringComparison.OrdinalIgnoreCase));
            s.Cfg.VortexGame = "\"" + k + "\"";
            string into = null; bool threw = false;
            try { into = DeploysInto(s.Cfg); } catch { threw = true; }
            Yes("and VortexGame typed in quotes by hand neither throws nor is ignored", !threw && string.Equals(into, k, StringComparison.OrdinalIgnoreCase));
            s.Cfg.VortexGame = k;

            // Vortex's record lists a Thornswood plugin whose copy in Vortex's
            // mods folder is gone: the Thornswood profile is deployed, the
            // deployment is out of date. It must not say another profile.
            Paths.Game = Paths.SteamCopy = s.Common(s.Steam, "Skyrim Special Edition");
            File.Delete(Path.Combine(s.Staging, "ModA\\TsOne.esp"));
            string why = OwnGame.WhyNot(s.Cfg, k);
            Yes("a staged copy gone missing is called an out of date deployment, not another profile",
                why != null && why.IndexOf("Deploy Mods", StringComparison.Ordinal) >= 0 && why.IndexOf("another profile", StringComparison.Ordinal) < 0 && Clean(why));
        }

        // ---- 5: nothing deployed ---------------------------------------------
        static void NothingDeployed()
        {
            Scene s = NewScene("nothing", true);
            string steam = SteamCopy(s, s.Steam, "STEAM");
            Paths.Game = Paths.SteamCopy = steam;
            string why = OwnGame.WhyNot(s.Cfg, DeploysInto(s.Cfg));
            Yes("with nothing deployed anywhere it still names the Steam copy", why != null && why.IndexOf("nothing deployed in " + steam, StringComparison.Ordinal) >= 0);
            Yes("and says how to find the folder Vortex deploys into", why != null && why.IndexOf("Open Game Folder", StringComparison.Ordinal) >= 0);
            // The picker, not Fix: when this sentence shows, the search found
            // no folder with a record, so Fix has nothing to point at.
            Yes("and that the picker points Thornswood at it, without promising Fix can",
                why != null && why.IndexOf("Choose Vortex's folder", StringComparison.Ordinal) >= 0 && why.IndexOf("Fix", StringComparison.Ordinal) < 0 && Clean(why));
        }

        // ---- 7: no Steam copy at all -------------------------------------------
        static void NoSteamCopy()
        {
            Scene s = NewScene("nosteam", true);
            Staging(s);
            string k = OtherServer(s, s.Steam, "Other Server Online", DateTime.UtcNow);
            Paths.Game = Paths.SteamCopy = k;
            Yes("with no Steam copy, Vortex's folder is still found", string.Equals(DeploysInto(s.Cfg), k, StringComparison.OrdinalIgnoreCase));
            Yes("but the game is never taken from it", OwnGame.Source(s.Cfg) == "");
            string why = OwnGame.WhyNot(s.Cfg, k);
            Yes("it refuses in one plain sentence that says to install Skyrim in Steam",
                why != null && why.IndexOf("Steam", StringComparison.Ordinal) >= 0 && why.TrimEnd('.').IndexOf(". ", StringComparison.Ordinal) < 0 && Clean(why));
            bool threw = false;
            try { OwnGame.Make(s.Cfg, null); } catch { threw = true; }
            Yes("and nothing is built", threw && !Directory.Exists(OwnGame.Folder));
            // Verification of hotfix 1.1.93: the picker said the game would come
            // from a Steam copy on the one machine that has none.
            bool ok;
            string said = PointAt(s.Cfg, k, out ok);
            Yes("the picker does not promise a Steam copy the machine lacks",
                said.IndexOf("has none", StringComparison.Ordinal) >= 0 && said.IndexOf("the Steam copy in", StringComparison.Ordinal) < 0 && Clean(said));
        }
    }
}
'@

$work = Join-Path $Scratch ('thornswood-vortex-folder-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $resources = @{}
    if (Test-Path -LiteralPath $ownKinds) {
        $skyrimList = Join-Path $work 'skyrim-files.json'
        $listed = @('SkyrimSE.exe', 'bink2w64.dll', 'High.ini', 'installscript.vdf', 'Data\Skyrim.esm', 'Data\Skyrim - Textures0.bsa',
                    'Data\_ResourcePack.esl', 'Data\Scripts\vanilla.pex') |
            ForEach-Object { '    "{0}": {{ "bytes": 1, "sha1": "0", "depot": "1" }}' -f $_.Replace('\', '\') }
        [IO.File]::WriteAllText($skyrimList, "{`n  ""build"": ""1.6.1170"",`n  ""files"": {`n" + ($listed -join ",`n") + "`n  }`n}`n", $utf8)
        $resources['skyrim-files.json'] = $skyrimList
        $resources['ui-gone.json'] = Join-Path $Here 'records\ui-gone.json'
    }
    $exe = $null
    try { $exe = Build-LauncherCode -Exe -Main 'Thornswood.VortexFolderTest' -Source $stubs, $driver -File @($real | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }) -Resource $resources }
    catch { ($_.Exception.Message -split "`n") | ForEach-Object { Write-Host "      $_" } }
    Yes 'the real Steam.cs, OwnGame.cs and Verify.cs build with the driver, with the .NET SDK the launcher builds with' ($null -ne $exe)
    if (-not $exe) { Done }

    if (-not $OnWindows) {
        Write-Host 'SKIP  1 to 7, the driver on a pretend Steam, other server and Vortex: OwnGame lays the game folder out by Windows paths and makes its links with kernel32, so it runs on Windows only'
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

    # ---- the launcher's side, read from the source ----------------------------
    $shell = [IO.File]::ReadAllText((Join-Path $AppPath 'Shell.cs'))
    # Scan and Fix moved to ShellScanFix.cs with #2627; a tree from before it
    # has them in Shell.cs.
    $scanFixCs = Join-Path $AppPath 'ShellScanFix.cs'
    if (Test-Path -LiteralPath $scanFixCs) { $shell += [IO.File]::ReadAllText($scanFixCs) }
    $verifyCs = [IO.File]::ReadAllText((Join-Path $AppPath 'Verify.cs'))
    $own = [IO.File]::ReadAllText((Join-Path $AppPath 'ShellOwnGame.cs'))
    # The window is Avalonia's MainWindow.axaml since #4823, its controls
    # reached as win.<Name>.
    $xamlPath = Join-Path $AppPath 'MainWindow.axaml'
    $xaml = if (Test-Path -LiteralPath $xamlPath) { [IO.File]::ReadAllText($xamlPath) } else { '' }
    $down = [IO.File]::ReadAllText((Join-Path $AppPath 'Downgrade.cs'))

    Yes 'after Fix points it at the folder, the launcher makes the own folder the way Make it does (AskOwnGame)' `
        ($shell -match 'if\s*\(\s*Verify\.OwnFolderNext\s*\)\s*\{?\s*AskOwnGame\(\s*false\s*\)')
    # Since #2627 the Fix button is on whenever an issue on the card is one
    # Fix can do something about, and the folder Vortex deploys into is one.
    Yes 'Scan keeps Fix pressable when the missing mods are in the folder Vortex deploys into' `
        (($shell -match 'btnFix\.IsEnabled\s*=\s*canFix\s*>\s*0') -and
         ($verifyCs -match '(?s)i\.VortexFolder = into;') -and
         ($verifyCs -match '(?s)Issue\.Of\(IssueKind\.OwnFolder, "Vortex deploys into " \+ into[^;]*"Fix will make Thornswood''s own Skyrim folder'))
    Yes 'Fix stays off only when nothing on the card is something Fix can do' `
        ($shell -match 'if \(i\.Fixable && !triedByFix\.Contains\(FixKey\(i\)\)\) canFix\+\+;')
    Yes 'Settings has Choose Vortex''s folder and Forget the chosen folder' `
        (($xaml -match 'x:Name="BtnOwnGamePick"') -and ($xaml -match 'x:Name="BtnOwnGameForget"') -and
         ($own -match 'btnOwnGamePick = win\.BtnOwnGamePick;') -and ($own -match 'btnOwnGameForget = win\.BtnOwnGameForget;'))
    Yes 'the picker goes through OwnGame.PointAt, which refuses a folder with no Vortex record' `
        (($own -match 'OwnGame\.PointAt\(cfg,\s*chosen') -and ($own -match 'OwnGame\.PointAt\(cfg,\s*""'))
    Yes 'Make it, the offer and the Play refusal read the folder Vortex deploys into' `
        (([regex]::Matches($own, 'string src = OwnGame\.DeploysInto\(')).Count -ge 3)
    # Since #1218 the Downgrade writes into Thornswood's own folder
    # (OwnGame.TakePinned), never into the Steam copy nor the folder Vortex
    # deploys into; test-own-folder-alone.ps1 holds the rest of that.
    Yes 'Downgrade writes neither the Steam copy (OwnGame.Source) nor the folder Vortex deploys into' `
        (($down -match 'OwnGame\.TakePinned\(') -and ($down -notmatch 'OwnGame\.Source') -and ($down -notmatch 'DeploysInto'))

    # Review, 24 September: a pack removal read Vortex's record from the
    # Steam copy, which has none when Vortex deploys elsewhere.
    $upd = [IO.File]::ReadAllText((Join-Path $AppPath 'Updater.cs'))
    Yes 'a pack removal reads Vortex''s record where Vortex deploys (DeploysInto), not the Steam copy' `
        (($upd -match 'OwnGame\.Active\s*\?\s*OwnGame\.DeploysInto\(cfg\)') -and ($upd -notmatch 'OwnGame\.Active\s*\?\s*OwnGame\.Source\(cfg\)'))
    # Review, 24 September: the Settings card parsed Vortex's record on the
    # window's thread at startup.
    Yes 'the Settings card asks WhyNot in the background and drops a stale answer' `
        (($own -match 'ThreadPool\.QueueUserWorkItem') -and ($own -match 'gen\s*!=\s*ownGameDrawGen') -and
         ($own -notmatch 'string why = OwnGame\.WhyNot\(cfg, into\);'))
}
finally {
    try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop } catch { }
}
Done
