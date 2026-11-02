<#
  test-own-folder-alone.ps1

      pwsh -NoProfile -File .\launcher\tests\test-own-folder-alone.ps1

  Thornswood's own game folder stands on its own once it is made, and the
  Steam copy of Skyrim is never written. Issues #1218 and #1217.

  WHAT WAS WRONG, 29 September. Once C:\Thornswood\Game held a whole 1.6.1170
  game, a Steam update of the Steam copy still stopped every refresh from
  Vortex ("most likely because Steam updated it. Press Downgrade on the Play
  page first"), and the Downgrade then copied 1.6.1170 over the Steam copy
  (#1218). And 18 of Skyrim's archives, 13.2 GB, were in the folder as copies
  of their own, the same bytes as the Steam copy's (#1217). Patrick, 29 Sep:
  "it shouldn't be using Steam's now anyway, but this way people can play
  vanilla at whatever version and their own mods".

  WHAT THIS HOLDS THE LAUNCHER TO.
    1. A folder made from a Steam copy on 1.6.1170: the game's own files are
       the folder's own copies, Vortex's files are links, and Skyrim's archives
       are one file with the Steam copy's and on record with their SHA-256.
    2. The Steam copy then updated to a newer build (by moving new files in,
       the way Steam does), a mod put into it by hand, and Vortex deploying
       another file: no Downgrade is asked for, the refresh works, takes only
       Vortex's new file, and the folder keeps its 1.6.1170 exe, master and
       archives. The check before Play passes.
    3. A first setup from a Steam copy on a newer build: the folder cannot be
       made and the sentence says the Steam copy stays as it is and the
       Downgrade gets 1.6.1170's own files; once they are downloaded the folder
       is made from them, an archive the Steam copy has the same bytes of is
       shared, one it does not is a copy, and the download is cleared away.
    4. An archive shared with the Steam copy and written over there (a file
       copied over it, which writes through a hard link): the check before
       Play finds it, Play stays shut, the Downgrade card comes up, and the
       Downgrade's files put 1.6.1170's bytes back as a copy of the folder's
       own. With no folder of its own the Downgrade refuses to write anywhere.
    5. The Steam copy's files are byte for byte and time for time what they
       were around every one of those: Make, Refresh, Share, the check, and
       the Downgrade's files. And the launcher's source keeps it that way.
    6. Only three kinds of file (#1232): Skyrim's own by the pinned build's
       list, Vortex's by its record, Thornswood's by its records. A plugin, a
       loose mesh and a script extender plugin put into the Steam copy by hand
       never reach Root\Game, at Make, from a newer Steam copy with the
       Downgrade's files, or at a refresh; Skyrim's own loose files and
       Vortex's still come in. A folder made before this, which took them,
       loses them at its next refresh, once, logged, with the Steam copy
       untouched; one held open is tried again at the next start.

  HOW. It builds the shipped launcher\app\OwnGame.cs, OwnGameShare.cs,
  Downgrade.cs, Steam.cs, Paths.cs and Config.cs the way the project builds
  them, with the .NET 10 SDK (tests\Launcher-Csc.ps1, #4823), with stand-ins
  for the few calls that touch the machine (Checks, Keep, Junction). The
  build runs on any machine with the SDK. A driver builds a pretend Steam,
  Steam copy and Vortex in a scratch folder, points Steam.cs at it through
  Steam.RootForTest, and runs the real code. That run is Windows' alone: the
  code under test makes NTFS hard links through kernel32, and the driver
  reads file ids and change times the same way, so elsewhere it says SKIP and
  the reading of the source in 5 and 6 still runs. Steam's console is never
  driven: the Downgrade's download is laid down as Steam leaves it.

  Nothing outside its own scratch folder is read or written, apart from the
  build under out\harness, which git ignores.
#>
[CmdletBinding()]
param([string]$AppPath, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
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

Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)

# OwnGameKinds and Verify name LastPlugin (#2791), which reads the game's archives through FromGameArchive.cs.
# Config and OwnGame read their JSON through LooseString since the move to System.Text.Json, and
# Downgrade opens the clipboard for Ask.Owner, the window its boxes belong to (#4823).
$real = @('OwnGame.cs', 'OwnGameShare.cs', 'OwnGameKinds.cs', 'Downgrade.cs', 'Steam.cs', 'Paths.cs', 'Config.cs', 'Secrets.cs', 'LoadOrder.cs', 'Swallow.cs', 'Progress.cs', 'LastPlugin.cs', 'FromGameArchive.cs', 'LooseString.cs', 'Ask.cs') |
    ForEach-Object { Join-Path $AppPath $_ }
foreach ($f in $real) {
    Yes "launcher\app\$([IO.Path]::GetFileName($f)) is there" (Test-Path -LiteralPath $f)
    if (-not (Test-Path -LiteralPath $f)) { Done }
}

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
        // OwnGame.Foreign reads the hashed UI asset list Ship wrote, from Keep
        // among other roots (#1318).
        public static string Dir { get { return System.IO.Path.Combine(Paths.ProfileDir, "Keep"); } }
    }
    // An install that never synced to a release record (Sync.cs): every record
    // of Thornswood's own files is its packs', Keep's and the installer's.
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
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    static class OwnFolderAloneTest
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
        [StructLayout(LayoutKind.Sequential)]
        struct Basic
        {
            public long Creation, Access, Write, Change;
            public uint Attributes;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetFileInformationByHandleEx(SafeFileHandle h, int infoClass, out Basic info, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetFileInformationByHandle(SafeFileHandle h, int infoClass, ref Basic info, uint size);

        // Sets a file's change time back by the given ticks (#1707). NTFS takes
        // the change time from the system clock, which moves in steps of about
        // 15.6 ms; a write in the same step as the last stamp leaves the change
        // time as it was. Setting it back first makes any later write move it.
        static bool ChangeTimeBack(string path, long ticks)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete))
            {
                Basic b;
                uint n = (uint)Marshal.SizeOf(typeof(Basic));
                if (!GetFileInformationByHandleEx(fs.SafeFileHandle, 0, out b, n)) return false;
                b.Creation = 0; b.Access = 0; b.Write = 0; b.Attributes = 0;
                b.Change -= ticks;
                return SetFileInformationByHandle(fs.SafeFileHandle, 0, ref b, n);
            }
        }

        static string Id(string path)
        {
            if (!File.Exists(path)) return "none:" + path;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                Info i;
                if (!GetFileInformationByHandle(fs.SafeFileHandle, out i)) return "?";
                return i.Volume + ":" + i.IndexHigh + ":" + i.IndexLow;
            }
        }

        const int ExeBytes = 4096, NewerExeBytes = 5000;
        static string T;

        static void Put(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text, new UTF8Encoding(false));
        }

        // An archive: its mark, a zero where Text stops reading, then padding,
        // so two builds can be the same size.
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

        static string Text(string path)
        {
            try
            {
                byte[] b = File.ReadAllBytes(path);
                int n = Array.IndexOf(b, (byte)0);
                return Encoding.ASCII.GetString(b, 0, n < 0 ? b.Length : n);
            }
            catch { return null; }
        }

        static string J(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

        // The time Vortex's record gives a file is the file's own write time
        // in milliseconds, as Vortex writes it; a refresh compares it with the
        // last record's to tell which files moved (#2210).
        static string VortexTime(string staged)
        {
            if (!File.Exists(staged)) return "1";
            return ((long)(File.GetLastWriteTimeUtc(staged) - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds).ToString();
        }

        static void Record(string path, string staging, string target, string[][] files, DateTime when)
        {
            var sb = new StringBuilder();
            sb.Append("{\n  \"instance\": \"test\",\n  \"version\": 1,\n  \"deploymentMethod\": \"hardlink_activator\",\n  \"gameId\": \"skyrimse\",\n");
            sb.Append("  \"stagingPath\": \"" + J(staging) + "\",\n  \"targetPath\": \"" + J(target) + "\",\n  \"files\": [\n");
            for (int i = 0; i < files.Length; i++)
                sb.Append("    { \"relPath\": \"" + J(files[i][0]) + "\", \"source\": \"" + J(files[i][1]) + "\", \"target\": \"\", \"time\": " + VortexTime(Path.Combine(staging, files[i][1] + "\\" + files[i][0])) + " }" + (i + 1 < files.Length ? "," : "") + "\n");
            sb.Append("  ]\n}\n");
            Put(path, sb.ToString());
            File.SetLastWriteTimeUtc(path, when);
        }

        // Every file under a folder with its bytes and its write time.
        static Dictionary<string, string> Snap(string dir)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!Directory.Exists(dir)) return d;
            using (var sha = SHA256.Create())
            {
                foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                {
                    var fi = new FileInfo(f);
                    d[f.Substring(dir.Length)] = fi.Length + ":" + Convert.ToBase64String(sha.ComputeHash(File.ReadAllBytes(f))) + ":" + fi.LastWriteTimeUtc.Ticks + ":" + fi.Attributes;
                }
            }
            return d;
        }

        static bool Same(Dictionary<string, string> a, Dictionary<string, string> b)
        {
            if (a.Count != b.Count) return false;
            foreach (KeyValuePair<string, string> kv in a)
            {
                string v;
                if (!b.TryGetValue(kv.Key, out v) || v != kv.Value) return false;
            }
            return true;
        }

        static bool Clean(string said)
        {
            return said != null && said.IndexOf('\u2014') < 0 && said.IndexOf("player", StringComparison.OrdinalIgnoreCase) < 0;
        }

        // Steam puts an update in by building the new file under
        // steamapps\downloading and moving it over the old name (measured,
        // OwnGameShare.cs). The old file stays as it was for any other name.
        static void SteamUpdates(Scene s, string rel, Action<string> write)
        {
            string staged = Path.Combine(s.Steam, "steamapps\\downloading\\489830\\" + rel);
            write(staged);
            string at = Path.Combine(s.Game, rel);
            if (File.Exists(at)) File.Delete(at);
            Directory.CreateDirectory(Path.GetDirectoryName(at));
            File.Move(staged, at);
        }

        class Scene
        {
            public string Dir, Steam, Game, Staging, Ts;
            public Config Cfg;
        }

        static readonly string Tex = "Data\\Skyrim - Textures0.bsa", Mesh = "Data\\Skyrim - Meshes0.bsa";
        // A loose file of the game's own, as every Steam copy has it. It was a
        // script source until #1227 kept those out of the folder altogether.
        static readonly string Master = "Data\\Skyrim.esm", Loose = "Data\\Video\\BGS_Logo.bik";
        static readonly string[] Hand = { "Data\\MyOwn.esp", "Data\\meshes\\mine\\sword.nif", "Data\\SKSE\\Plugins\\MyOwnPlugin.dll" };

        static bool NoneIn(string folder, string[] rels)
        {
            foreach (string r in rels) if (File.Exists(Path.Combine(folder, r))) { Console.WriteLine("      in " + folder + ": " + r); return false; }
            return true;
        }

        static bool AllIn(string folder, string[] rels)
        {
            foreach (string r in rels) if (Text(Path.Combine(folder, r)) != "PERSON " + r) { Console.WriteLine("      not as the person left it in " + folder + ": " + r); return false; }
            return true;
        }

        static string FilesTxt() { return File.ReadAllText(Path.Combine(OwnGame.Dir, "files.txt")); }
        static string LeftOut() { return File.ReadAllText(Path.Combine(OwnGame.Dir, "left-out.txt")); }

        static Scene NewScene(string name, bool newer)
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
            // What Paths.Init sets beside Game (#1226).
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

            // The Steam copy's game, on 1.6.1170 or on a newer build.
            if (newer)
            {
                Exe(Path.Combine(s.Game, "SkyrimSE.exe"), "NEW-EXE", NewerExeBytes);
                Put(Path.Combine(s.Game, Master), "NEW-MASTER");
                Archive(Path.Combine(s.Game, Tex), "PIN-TEX0");          // unchanged between builds
                Archive(Path.Combine(s.Game, Mesh), "NEW-MESH0");        // changed, the same size
            }
            else
            {
                Exe(Path.Combine(s.Game, "SkyrimSE.exe"), "PIN-EXE", ExeBytes);
                Put(Path.Combine(s.Game, Master), "PIN-MASTER");
                Archive(Path.Combine(s.Game, Tex), "PIN-TEX0");
                Archive(Path.Combine(s.Game, Mesh), "PIN-MESH0");
            }
            Put(Path.Combine(s.Game, Loose), "GAME-LOOSE");
            Put(Path.Combine(s.Game, "bink2w64.dll"), "GAME-BINK");
            // Mods the person put into the Steam copy by hand (#1232), for the
            // Skyrim they play from Steam: their own plugin, a loose mesh and a
            // script extender plugin. None of Skyrim's, Vortex's or Thornswood's.
            foreach (string h in Hand) Put(Path.Combine(s.Game, h), "PERSON " + h);

            // Vortex: two files in staging, deployed into the Steam copy as hard links.
            Deploy(s, new string[][] { new string[] { "TsOne.esp", "ModA", "VORTEX-TSONE" },
                                       new string[] { "textures\\ts\\wood.dds", "ModA", "VORTEX-DDS" } }, DateTime.UtcNow.AddMinutes(-10));
            return s;
        }

        static void Deploy(Scene s, string[][] files, DateTime when)
        {
            var rec = new List<string[]>();
            foreach (string[] f in files)
            {
                string staged = Path.Combine(s.Staging, f[1] + "\\" + f[0]);
                if (!File.Exists(staged)) Put(staged, f[2]);
                string at = Path.Combine(s.Game, "Data\\" + f[0]);
                if (!File.Exists(at)) { Directory.CreateDirectory(Path.GetDirectoryName(at)); CreateHardLink(at, staged, IntPtr.Zero); }
                rec.Add(new string[] { f[0], f[1] });
            }
            Record(Path.Combine(s.Game, "Data\\vortex.deployment.json"), s.Staging, Path.Combine(s.Game, "Data"), rec.ToArray(), when);
        }

        // Steam's download of 1.6.1170's own files, as Steam leaves it and
        // the Downgrade marks it: three depot folders under steamapps\content.
        static List<string> Download(Scene s)
        {
            var folders = new List<string>();
            string content = Path.Combine(s.Steam, "steamapps\\content\\app_489830");
            string[] cmds = Downgrade.Commands(s.Cfg);
            for (int i = 0; i < cmds.Length; i++)
            {
                string[] p = cmds[i].Split(' ');
                string folder = Path.Combine(content, "depot_" + p[2]);
                if (i == 0) Exe(Path.Combine(folder, "SkyrimSE.exe"), "PIN-EXE", ExeBytes);
                if (i == 1) { Archive(Path.Combine(folder, Tex), "PIN-TEX0"); Archive(Path.Combine(folder, Mesh), "PIN-MESH0"); }
                if (i == 2) Put(Path.Combine(folder, Master), "PIN-MASTER");
                Put(Path.Combine(folder, ".thornswood-complete"), p[3] + "\n1");
                folders.Add(folder);
            }
            return folders;
        }

        static void MadeNowRuns(Scene s)
        {
            // What the restart after Make does: the launcher runs from the folder.
            Paths.Collection = false;
            Paths.Game = OwnGame.Folder;
            Paths.Live = Paths.LocalAD;
            Paths.LiveMyGames = Paths.MyGames;
        }

        static string Shares() { string f = Path.Combine(OwnGame.Dir, "shared.txt"); return File.Exists(f) ? File.ReadAllText(f) : ""; }

        // The stamp CheckShared holds a shared archive to (file id, size,
        // change time in 100 ns ticks), read by its own StampOf, and the
        // line shared.txt keeps for it. Printed when the written-through scene
        // misses the copy (#1707), to measure why.
        static string StampNow(string path)
        {
            MethodInfo m = typeof(OwnGame).GetMethod("StampOf", BindingFlags.NonPublic | BindingFlags.Static);
            if (m == null) return "(no StampOf)";
            try { return Convert.ToString(m.Invoke(null, new object[] { path })); }
            catch (Exception ex) { return "(" + (ex.InnerException ?? ex).Message + ")"; }
        }
        static string OnRecord(string rel)
        {
            foreach (string l in Shares().Split('\n'))
                if (l.TrimEnd('\r').EndsWith("|" + rel, StringComparison.OrdinalIgnoreCase)) return l.TrimEnd('\r');
            return "(no line)";
        }


        // A fake Steam copy, under this scene's temp folder, never a real
        // Steam library. The exe is 1.6.1170's size and the master is the
        // same length as the pinned one, so only the SHA-1 says it changed.
        static void CleanedMaster()
        {
            Scene s = NewScene("cleaned-master", false);
            Put(Path.Combine(s.Game, Master), "CLEANED-MA");
            var before = Snap(s.Game);
            string src = OwnGame.DeploysInto(s.Cfg);
            string why = OwnGame.WhyNot(s.Cfg, src);
            Yes("a same-size cleaned master is not the pinned build", why != null);
            Yes("and the sentence says the Steam copy stays as it is and the Downgrade gets 1.6.1170's own files",
                why != null && why.Contains("never changes that copy") && why.Contains("press Downgrade") && why.Contains("stays as it is") && why.Contains("cleaned master") && Clean(why));
            if (why != null && !(why.Contains("stays as it is") && why.Contains("cleaned master"))) Console.WriteLine("      WhyNot said: " + why);
            Yes("the Downgrade card is up (Downgrade.Needed)", Downgrade.Needed(s.Cfg));
            bool threw = false;
            try { OwnGame.Make(s.Cfg, null); } catch { threw = true; }
            Yes("Make refuses, and the cleaned master never reaches the folder", threw && !Directory.Exists(OwnGame.Folder));
            Yes("and wrote nothing into the Steam copy", Same(before, Snap(s.Game)));

            Download(s);
            Yes("once 1.6.1170's files are downloaded, the folder can be made", OwnGame.WhyNot(s.Cfg, src) == null && !Downgrade.Needed(s.Cfg));
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string own = OwnGame.Folder;
            Yes("Make works from the download", made != null && Clean(made));
            Yes("and still wrote nothing into the Steam copy", Same(before, Snap(s.Game)));
            Yes("the folder's master is the download's, not the cleaned one",
                Text(Path.Combine(own, Master)) == "PIN-MASTER" && Id(Path.Combine(own, Master)) != Id(Path.Combine(s.Game, Master)));
            Yes("the Steam copy still has the cleaned master", Text(Path.Combine(s.Game, Master)) == "CLEANED-MA");
            Yes("the folder's line says the Steam copy was not changed", made != null && made.Contains("was not changed"));
        }

        static int Main(string[] args)
        {
            T = args[0];
            try
            {
                UiGoneCompiledIn();
                OneGap();
                SteamMovesOn();
                FirstFromNewer();
                CleanedMaster();
                WrittenThrough();
                MadeBefore();
                UnreadableRecord();
                GeneratedStays();
            }
            catch (Exception ex)
            {
                Yes("the driver ran to the end (" + ex.GetType().Name + ": " + ex.Message + ")", false);
                Console.WriteLine(ex.StackTrace);
            }
            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            return fail > 0 ? 1 : 0;
        }

        // records\ui-gone.json is compiled in. OwnGame.Foreign reads that
        // copy, not a test override. 37 Daedric names and hashes, 42 unused,
        // the four Futura PT and DIN Pro faces (#1317), and Bankir-Retro and
        // icomoon, which fork #41 took out of the front (#3130's pin).
        static void UiGoneCompiledIn()
        {
            Yes("a Daedric jpg from the compiled-in gone record is not ours",
                OwnGame.Foreign("Data\\Platform\\UI\\0d38fd98ca293be5d0c8270fef9dedef.jpg"));
            var flags = BindingFlags.NonPublic | BindingFlags.Static;
            var leaves = typeof(OwnGame).GetField("uiGoneLeaves", flags).GetValue(null) as HashSet<string>;
            var hashes = typeof(OwnGame).GetField("uiGoneHashes", flags).GetValue(null) as HashSet<string>;
            var commercial = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
                "6f802bf60c545304b09e.ttf", "00e4a2200c3e5ae71d67.ttf", "268a0df3f0e2c23d1ea6.ttf", "fdf086661e1600f95a34.ttf",
                "855bfaf67c57745958d3.ttf", "d213051bb6f28a25fb26.ttf" };
            int daedric = 0, unused = 0, faces = 0;
            if (leaves != null)
            {
                foreach (string n in leaves)
                {
                    string x = (n ?? "").ToLowerInvariant();
                    if (commercial.Contains(x)) faces++;
                    else if (x.EndsWith(".svg") || x == "bg.png") unused++;
                    else daedric++;
                }
            }
            Yes("the compiled-in gone record has 37 Daedric names", daedric == 37);
            Yes("  and 37 Daedric hashes", hashes != null && hashes.Count == 37);
            Yes("  and 42 unused names", unused == 42);
            Yes("  and the four Futura PT and DIN Pro faces (#1317) and Bankir-Retro and icomoon", faces == 6);
            Yes("  so a refresh keeps them out", OwnGame.Foreign("Data\\Platform\\UI\\268a0df3f0e2c23d1ea6.ttf"));
            Yes("  Bankir-Retro too", OwnGame.Foreign("Data\\Platform\\UI\\855bfaf67c57745958d3.ttf"));
        }

        // One plugin the published collection does not ship must not read as
        // another profile. Half the list gone still must.
        static void OneGap()
        {
            Yes("one missing plugin in a full list is not another profile", !OwnGame.NotThisCollection(1, 96));
            Yes("half a full list missing is another profile", OwnGame.NotThisCollection(48, 96));
            Yes("sixty eight missing, before a collection has deployed, is another profile", OwnGame.NotThisCollection(68, 96));
            Yes("the only plugin in a short list missing is another profile", OwnGame.NotThisCollection(1, 1));

            Scene s = NewScene("one-gap", false);
            var names = new List<string>();
            var files = new List<string[]>();
            names.Add("*TsOne.esp");
            files.Add(new string[] { "TsOne.esp", "ModA", "VORTEX-TSONE" });
            for (int i = 0; i < 19; i++)
            {
                string n = "Gap" + i.ToString("00") + ".esp";
                names.Add("*" + n);
                files.Add(new string[] { n, "ModA", "GAP" });
            }
            names.Add("*MissingOne.esp");
            Put(Path.Combine(Paths.Golden, "plugins.txt"), "# Automatically generated by Vortex\r\n" + string.Join("\r\n", names.ToArray()) + "\r\n");
            Deploy(s, files.ToArray(), DateTime.UtcNow);
            string why = OwnGame.WhyNot(s.Cfg, s.Game);
            Yes("one plugin the collection does not ship does not refuse the own folder", why == null);
            if (why != null) Console.WriteLine("      WhyNot said: " + why);

            var few = new List<string>();
            few.Add("*TsOne.esp");
            for (int i = 0; i < 19; i++) few.Add("*Gone" + i.ToString("00") + ".esp");
            Put(Path.Combine(Paths.Golden, "plugins.txt"), "# Automatically generated by Vortex\r\n" + string.Join("\r\n", few.ToArray()) + "\r\n");
            why = OwnGame.WhyNot(s.Cfg, s.Game);
            Yes("most of the list missing still says another profile", why != null && why.IndexOf("another profile") >= 0);
            if (why != null && why.IndexOf("another profile") < 0) Console.WriteLine("      WhyNot said: " + why);
        }

        // ---- 1 and 2: made from 1.6.1170, then Steam moves on -----------------
        static void SteamMovesOn()
        {
            Scene s = NewScene("moves-on", false);
            var before = Snap(s.Game);
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string own = OwnGame.Folder;
            Yes("made from a Steam copy on 1.6.1170", made != null && Clean(made));
            Yes("Make wrote nothing into the Steam copy", Same(before, Snap(s.Game)));
            Yes("the exe is the folder's own copy", Text(Path.Combine(own, "SkyrimSE.exe")) == "PIN-EXE" && Id(Path.Combine(own, "SkyrimSE.exe")) != Id(Path.Combine(s.Game, "SkyrimSE.exe")));
            Yes("a loose game file is the folder's own copy, not a link to the Steam copy's",
                Text(Path.Combine(own, Loose)) == "GAME-LOOSE" && Id(Path.Combine(own, Loose)) != Id(Path.Combine(s.Game, Loose)));
            Yes("Vortex's files are links to Vortex's own copies",
                Id(Path.Combine(own, "Data\\TsOne.esp")) == Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")));
            Yes("Skyrim's archives are one file with the Steam copy's, so they are on the disk once",
                Id(Path.Combine(own, Tex)) == Id(Path.Combine(s.Game, Tex)) && Id(Path.Combine(own, Mesh)) == Id(Path.Combine(s.Game, Mesh)));
            string shares = Shares();
            Yes("and both are on record with their SHA-256 for the check before Play",
                shares.Contains("|" + Tex) && shares.Contains("|" + Mesh));
            Yes("the mods put into the Steam copy by hand stayed out: the person's own plugin, a loose mesh and a script extender plugin", NoneIn(own, Hand));
            Yes("and they are still in the Steam copy, as the person left them", AllIn(s.Game, Hand));
            string leftOut = LeftOut();
            Yes("left-out.txt names each of them and why", Array.TrueForAll(Hand, delegate(string h) { return leftOut.Contains(h + "  (not one of Skyrim 1.6.1170's own files, not deployed by Vortex and not Thornswood's"); }));
            Yes("Make's line says mods put into the Steam copy by hand stay with it", made != null && made.Contains("3 of them are in the Steam copy and not Skyrim's own, Vortex's or Thornswood's, such as mods put there by hand"));
            string rec = FilesTxt();
            Yes("the record says which kind each file is: the game's own O, Vortex's V",
                rec.Contains("|O|" + 4096 + "|") && rec.Contains("|SkyrimSE.exe") && rec.Contains("C|O|") && rec.Contains("|V|") &&
                rec.Contains("|" + Loose) && rec.Contains("|bink2w64.dll") && !rec.Contains("MyOwn.esp"));
            MadeNowRuns(s);
            Yes("the check before Play passes on a folder just made", OwnGame.CheckShared(OwnGame.Source(s.Cfg), null) == null);

            // Steam updates its copy to a newer build, and the person mods it by hand.
            SteamUpdates(s, "SkyrimSE.exe", delegate (string p) { Exe(p, "NEW-EXE", NewerExeBytes); });
            SteamUpdates(s, Master, delegate (string p) { Put(p, "NEW-MASTER"); });
            SteamUpdates(s, Tex, delegate (string p) { Archive(p, "NEW-TEX0"); });
            Put(Path.Combine(s.Game, "Data\\PersonsOwn.esp"), "PERSON-MOD");
            Archive(Path.Combine(s.Game, "Data\\NewBuild.bsa"), "NEW-ARCHIVE");
            // And Vortex deploys another file of the collection.
            Deploy(s, new string[][] { new string[] { "TsOne.esp", "ModA", "VORTEX-TSONE" },
                                       new string[] { "textures\\ts\\wood.dds", "ModA", "VORTEX-DDS" },
                                       new string[] { "meshes\\ts\\bench.nif", "ModB", "VORTEX-BENCH" } }, DateTime.UtcNow);

            string src = OwnGame.DeploysInto(s.Cfg);
            string why = OwnGame.WhyNot(s.Cfg, src);
            Yes("with the Steam copy on a newer build, a made folder can still follow Vortex (WhyNot says nothing)", why == null);
            if (why != null) Console.WriteLine("      WhyNot said: " + why);
            Yes("and no Downgrade is asked for", !Downgrade.Needed(s.Cfg));
            Yes("the check before Play passes: the archive the Steam update replaced kept its bytes here",
                OwnGame.CheckShared(OwnGame.Source(s.Cfg), null) == null && Text(Path.Combine(own, Tex)) == "PIN-TEX0");
            Yes("the folder asks to follow Vortex", OwnGame.NeedsRefresh(s.Cfg));

            // A pack replaced the hard link to Vortex's TsOne.esp with this
            // folder's own copy. Vortex's file is unchanged, so Refresh keeps
            // it, and the record has to say C (#1255).
            string packAt = Path.Combine(own, "Data\\TsOne.esp");
            File.Delete(packAt);
            Put(packAt, "TS-PACK");

            var steamNow = Snap(s.Game);
            string again = null;
            try { again = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes("the refresh works", again != null && Clean(again));
            Yes("and wrote nothing into the Steam copy", Same(steamNow, Snap(s.Game)));
            Yes("Vortex's new file came in, as a link", Id(Path.Combine(own, "Data\\meshes\\ts\\bench.nif")) == Id(Path.Combine(s.Staging, "ModB\\meshes\\ts\\bench.nif")));
            Yes("the folder kept its 1.6.1170 exe, master and archives",
                Text(Path.Combine(own, "SkyrimSE.exe")) == "PIN-EXE" && new FileInfo(Path.Combine(own, "SkyrimSE.exe")).Length == ExeBytes &&
                Text(Path.Combine(own, Master)) == "PIN-MASTER" && Text(Path.Combine(own, Tex)) == "PIN-TEX0" && Text(Path.Combine(own, Mesh)) == "PIN-MESH0");
            Yes("nothing of the newer build or of the person's own mods came in",
                !File.Exists(Path.Combine(own, "Data\\PersonsOwn.esp")) && !File.Exists(Path.Combine(own, "Data\\NewBuild.bsa")) && NoneIn(own, Hand));
            string files = File.ReadAllText(Path.Combine(OwnGame.Dir, "files.txt"));
            Yes("the game's own files are still on record after the refresh", files.Contains("|O|") && files.Contains("|" + Master) && files.Contains("|" + Loose));
            // Its entry in Vortex's record did not move, so since #2210 the
            // refresh does not open it and its line keeps the L or C it had
            // (decided by Patrick on 12 Oct; only the installed size Windows
            // shows reads it). The file itself stays the pack's.
            bool packOnRecord = false;
            foreach (string line in files.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                if (line.EndsWith("|Data\\TsOne.esp", StringComparison.OrdinalIgnoreCase)) packOnRecord = true;
            Yes("a pack's file over a Vortex name stays the pack's own copy after a refresh, and on record",
                packOnRecord && Text(packAt) == "TS-PACK" && Id(packAt) != Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")));
            Yes("the check before Play still passes", OwnGame.CheckShared(OwnGame.Source(s.Cfg), null) == null);
        }

        // ---- 3: first setup from a Steam copy on a newer build ---------------
        static void FirstFromNewer()
        {
            Scene s = NewScene("first-newer", true);
            var before = Snap(s.Game);
            string src = OwnGame.DeploysInto(s.Cfg);
            string why = OwnGame.WhyNot(s.Cfg, src);
            Yes("first setup, Steam copy newer: the folder cannot be made yet", why != null);
            Yes("and the sentence says the Steam copy stays as it is and the Downgrade gets 1.6.1170's own files",
                why != null && why.Contains("never changes that copy") && why.Contains("press Downgrade") && why.Contains("stays on the build it is on") && Clean(why));
            Yes("the Downgrade card is up (Downgrade.Needed)", Downgrade.Needed(s.Cfg));
            bool threw = false;
            try { OwnGame.Make(s.Cfg, null); } catch { threw = true; }
            Yes("Make refuses", threw && !Directory.Exists(OwnGame.Folder));

            List<string> depots = Download(s);
            Yes("once 1.6.1170's files are downloaded, Downgrade.Downloaded finds all three", Downgrade.Downloaded(s.Cfg) != null && Downgrade.Downloaded(s.Cfg).Count == 3);
            Yes("the Downgrade card goes, and the folder can be made", !Downgrade.Needed(s.Cfg) && OwnGame.WhyNot(s.Cfg, src) == null);
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string own = OwnGame.Folder;
            Yes("Make works from the download", made != null && Clean(made));
            Yes("and wrote nothing into the Steam copy", Same(before, Snap(s.Game)));
            Yes("the folder has 1.6.1170's exe and master, not the Steam copy's",
                Text(Path.Combine(own, "SkyrimSE.exe")) == "PIN-EXE" && new FileInfo(Path.Combine(own, "SkyrimSE.exe")).Length == ExeBytes &&
                Text(Path.Combine(own, Master)) == "PIN-MASTER");
            Yes("an archive the newer build changed is 1.6.1170's, as a copy of the folder's own",
                Text(Path.Combine(own, Mesh)) == "PIN-MESH0" && Id(Path.Combine(own, Mesh)) != Id(Path.Combine(s.Game, Mesh)));
            Yes("an archive with the same bytes in both builds is shared with the Steam copy",
                Text(Path.Combine(own, Tex)) == "PIN-TEX0" && Id(Path.Combine(own, Tex)) == Id(Path.Combine(s.Game, Tex)) && Shares().Contains("|" + Tex));
            Yes("Vortex's files are in", Id(Path.Combine(own, "Data\\TsOne.esp")) == Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")));
            Yes("the mods put into the newer Steam copy by hand stayed out of a folder made from the download", NoneIn(own, Hand) && AllIn(s.Game, Hand));
            bool gone = true;
            foreach (string d in depots) if (Directory.Exists(d)) gone = false;
            Yes("the download is cleared away once the folder has the files", gone);
            Yes("the folder's line says the Steam copy was not changed", made != null && made.Contains("was not changed"));
        }

        // ---- 4: a shared archive written over through the Steam copy ---------
        static void WrittenThrough()
        {
            Scene s = NewScene("written-through", false);
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string own = OwnGame.Folder;
            MadeNowRuns(s);
            Yes("(made, with the meshes archive shared)", made != null && Id(Path.Combine(own, Mesh)) == Id(Path.Combine(s.Game, Mesh)));

            // The person copies another build's archive over the Steam copy's,
            // the way a manual mod or another launcher's downgrade puts one in.
            string other = Path.Combine(s.Dir, "other.bsa");
            Archive(other, "MODDED-MESH");
            // The record and a copy made in the same clock step carry the same
            // change time, so the copy would read as no change (#1707). The
            // archive's change time goes back 10 s and the check puts that on
            // record (same bytes, so it is only re-stamped); the copy then
            // moves the change time past it in every run.
            Yes("(the shared archive's change time set back 10 s, and re-stamped by the check)",
                ChangeTimeBack(Path.Combine(own, Mesh), 10L * 10000000L) && OwnGame.CheckShared(OwnGame.Source(s.Cfg), null) == null &&
                StampNow(Path.Combine(own, Mesh)).EndsWith(":" + OnRecord(Mesh).Split('|')[3]));
            string recorded = OnRecord(Mesh), before = StampNow(Path.Combine(own, Mesh));
            File.Copy(other, Path.Combine(s.Game, Mesh), true);
            long clock = DateTime.UtcNow.ToFileTimeUtc();
            string after = StampNow(Path.Combine(own, Mesh));
            Yes("(copying over the Steam copy's archive changed the one in Thornswood's folder too)", Text(Path.Combine(own, Mesh)) == "MODDED-MESH");

            var steamNow = Snap(s.Game);
            string said = OwnGame.CheckShared(OwnGame.Source(s.Cfg), null);
            Yes("the check before Play finds it and names it", said != null && said.Contains("Skyrim - Meshes0.bsa") && Clean(said));
            if (said == null)
                Console.WriteLine("      the check found nothing changed (#1707). On record: " + recorded + ". Before the copy: " + before +
                                  ". After it: " + after + ". The clock just after it: " + clock + ".");
            Yes("and says the Downgrade puts it right", said != null && said.Contains("Press Downgrade"));
            Yes("it goes on record as changed, so Play stays shut", OwnGame.Changed().Contains(Mesh));
            Yes("and the Downgrade card comes up", Downgrade.Needed(s.Cfg));
            Yes("the check wrote nothing into the Steam copy", Same(steamNow, Snap(s.Game)));
            Yes("an untouched shared archive is not called changed", !OwnGame.Changed().Contains(Tex));

            List<string> depots = Download(s);
            steamNow = Snap(s.Game);
            string took = null;
            try { took = OwnGame.TakePinned(s.Cfg, depots, null, null); } catch (Exception ex) { Console.WriteLine("      TakePinned said: " + ex.Message); }
            Yes("the Downgrade's files go into the folder", took != null && Clean(took));
            Yes("and 1.6.1170's bytes are back, as the folder's own copy",
                Text(Path.Combine(own, Mesh)) == "PIN-MESH0" && Id(Path.Combine(own, Mesh)) != Id(Path.Combine(s.Game, Mesh)));
            Yes("nothing is on record as changed any more, the check passes and the card goes",
                OwnGame.Changed().Count == 0 && OwnGame.CheckShared(OwnGame.Source(s.Cfg), null) == null && !Downgrade.Needed(s.Cfg));
            Yes("the Steam copy still has what the person put there, untouched", Same(steamNow, Snap(s.Game)) && Text(Path.Combine(s.Game, Mesh)) == "MODDED-MESH");
            Yes("Vortex's files were left as they are", Id(Path.Combine(own, "Data\\TsOne.esp")) == Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")));
            string files = File.ReadAllText(Path.Combine(OwnGame.Dir, "files.txt"));
            Yes("the record lists the archive as the folder's own copy", files.Contains("C|O|" + new FileInfo(Path.Combine(own, Mesh)).Length));

            // With no folder of its own the Downgrade writes nowhere.
            Paths.Collection = true;
            Paths.Game = s.Game;
            steamNow = Snap(s.Game);
            bool refused = false;
            try { OwnGame.TakePinned(s.Cfg, depots, null, null); } catch (Exception ex) { refused = ex.Message.Contains("never written"); }
            Yes("before a folder of its own exists, the Downgrade's files are never put into the Steam copy", refused && Same(steamNow, Snap(s.Game)));
        }

        // ---- 6: a folder made before #1232, which took the hand placed mods -----
        static void MadeBefore()
        {
            Scene s = NewScene("made-before", false);
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string own = OwnGame.Folder;
            MadeNowRuns(s);
            Yes("(made)", made != null);

            // What Make used to do: the Steam copy's hand placed mods came in
            // as hard links to its files, and everything not Vortex's went on
            // record as O, under rules 12. A pack's file and one on the
            // installer's list are in the folder too, on record as O.
            var lines = new List<string>();
            foreach (string line in File.ReadAllLines(Path.Combine(OwnGame.Dir, "files.txt"))) lines.Add(line.Replace("|T|", "|O|"));
            foreach (string h in Hand)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(own, h)));
                CreateHardLink(Path.Combine(own, h), Path.Combine(s.Game, h), IntPtr.Zero);
                var fi = new FileInfo(Path.Combine(s.Game, h));
                lines.Add("L|O|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks + "|" + h);
            }
            string packFile = "Data\\textures\\thornswood\\pack.dds", installerFile = "Data\\meshes\\thornswood\\sign.nif";
            Put(Path.Combine(own, packFile), "TS-PACK");
            Put(Path.Combine(own, installerFile), "TS-INSTALLER");
            lines.Add("C|O|7|1|" + packFile);
            lines.Add("C|O|12|1|" + installerFile);
            File.WriteAllLines(Path.Combine(OwnGame.Dir, "files.txt"), lines.ToArray());
            Put(Path.Combine(Paths.PacksDir, "20260920-0000.files"), "abc|game\\" + packFile + "\r\n");
            Put(Path.Combine(Paths.ProfileDir, "installed-into-game.txt"), installerFile + "\r\n");
            string madeTxt = Path.Combine(OwnGame.Dir, "made.txt");
            var made12 = new List<string>(); foreach (string l in File.ReadAllLines(madeTxt)) made12.Add(l.StartsWith("rules=") ? "rules=12" : l); File.WriteAllLines(madeTxt, made12.ToArray());
            Yes("(the folder now holds the hand placed mods, as one made before this did)", AllIn(own, Hand));

            var steamNow = Snap(s.Game);
            Yes("a folder made under the old rules asks to refresh once, though Vortex has not moved", OwnGame.NeedsRefresh(s.Cfg));

            // A game started from Steam has one of them open.
            string held = Path.Combine(own, Hand[2]);
            string first = null;
            using (new FileStream(held, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                try { first = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            }
            Yes("the refresh takes the hand placed mods out of Thornswood's folder", first != null && !File.Exists(Path.Combine(own, Hand[0])) && !File.Exists(Path.Combine(own, Hand[1])));
            Yes("and logs what it took out, and that the Steam copy keeps them",
                first != null && first.Contains("Took 2 files out of Thornswood's folder") && first.Contains(Hand[0]) && first.Contains(Hand[1]) &&
                first.Contains("still in the Steam copy, which was not touched") && Clean(first));
            Yes("left-out.txt says each was taken out and why", LeftOut().Contains(Hand[0] + "  (taken out: not one of Skyrim 1.6.1170's own files"));
            Yes("the one held open is left as it is, and the line says it tries again at the next start",
                File.Exists(held) && first != null && first.Contains("could not be taken out yet") && first.Contains("tries again the next time it starts"));
            Yes("so the folder still asks to refresh", OwnGame.NeedsRefresh(s.Cfg));
            Yes("the Steam copy was not touched: its hand placed mods are there, byte and time", Same(steamNow, Snap(s.Game)) && AllIn(s.Game, Hand));

            string second = null;
            try { second = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes("the next refresh takes out the one that was held", second != null && !File.Exists(held) && second.Contains("Took 1 file out") && second.Contains(Hand[2]));
            Yes("and the folder is on the new rules, so it does not ask again", !OwnGame.NeedsRefresh(s.Cfg));
            Yes("the Steam copy still was not touched", Same(steamNow, Snap(s.Game)) && AllIn(s.Game, Hand));

            string rec = FilesTxt();
            Yes("a pack's file and the installer's stay, on record as Thornswood's (T)",
                Text(Path.Combine(own, packFile)) == "TS-PACK" && Text(Path.Combine(own, installerFile)) == "TS-INSTALLER" &&
                rec.Contains("|T|7|1|" + packFile) && rec.Contains("|T|12|1|" + installerFile));
            Yes("Skyrim's own files stay, on record as Skyrim's (O): the exe, the master, a loose file, the archives",
                Text(Path.Combine(own, "SkyrimSE.exe")) == "PIN-EXE" && Text(Path.Combine(own, Master)) == "PIN-MASTER" && Text(Path.Combine(own, Loose)) == "GAME-LOOSE" &&
                rec.Contains("|O|" + ExeBytes + "|") && rec.Contains("|O|10|") && rec.Contains("|" + Tex));
            Yes("Vortex's files stay, as links to Vortex's own copies, on record as V",
                Id(Path.Combine(own, "Data\\TsOne.esp")) == Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")) && rec.Contains("|V|") && rec.Contains("|Data\\TsOne.esp"));
            Yes("nothing of the hand placed mods is on record any more", !rec.Contains("MyOwn") && !rec.Contains("sword.nif") && !rec.Contains("MyOwnPlugin"));

            string third = null;
            try { third = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes("a refresh after that takes nothing more out", third != null && third.Contains("already matches") && !third.Contains("Took"));
            Yes("the check before Play still passes", OwnGame.CheckShared(OwnGame.Source(s.Cfg), null) == null);
        }

        // A pack list held open must stop the refresh, not be skipped (#1249).
        static void UnreadableRecord()
        {
            Scene s = NewScene("unread", false);
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string own = OwnGame.Folder;
            MadeNowRuns(s);
            Yes("(made, for an unreadable pack list)", made != null);

            string esp = Path.Combine(own, "Data\\TsOne.esp");
            File.Delete(esp);
            Put(esp, "TS-UPDATE");
            Put(Path.Combine(Paths.PacksDir, "good.files"), "a|game\\Data\\TsOne.esp\r\n");
            string bad = Path.Combine(Paths.PacksDir, "held.files");
            Put(bad, "b|game\\Data\\textures\\ts\\wood.dds\r\n");
            string madeTxt = Path.Combine(OwnGame.Dir, "made.txt");
            var made12 = new List<string>();
            foreach (string l in File.ReadAllLines(madeTxt)) made12.Add(l.StartsWith("rules=") ? "rules=12" : l);
            File.WriteAllLines(madeTxt, made12.ToArray());

            string said = null;
            using (new FileStream(bad, FileMode.Open, FileAccess.Read, FileShare.None))
            {
                try { OwnGame.Refresh(s.Cfg, null); }
                catch (Exception ex) { said = ex.Message; }
            }
            Yes("a pack record that cannot be read stops the refresh and names the list",
                said != null && said.Contains("held.files") && said.Contains("Nothing was changed") && Clean(said));
            if (said != null) Console.WriteLine("      Refresh said: " + said);
            Yes("and Thornswood's update of the Vortex file is still its own copy",
                Text(esp) == "TS-UPDATE" && Text(Path.Combine(s.Staging, "ModA\\TsOne.esp")) == "VORTEX-TSONE");

            List<string> depots = Download(s);
            string marker = Path.Combine(depots[0], "Data\\FromDepot.esp");
            Put(marker, "DEPOT-ONLY");
            string pinned = null;
            using (new FileStream(bad, FileMode.Open, FileAccess.Read, FileShare.None))
            {
                try { OwnGame.TakePinned(s.Cfg, depots, null, null); }
                catch (Exception ex) { pinned = ex.Message; }
            }
            Yes("and the Downgrade's copy stops on the same list, before it writes",
                pinned != null && pinned.Contains("held.files") && Clean(pinned) &&
                !File.Exists(Path.Combine(own, "Data\\FromDepot.esp")));
        }
        // ---- 7: what Build-Generated.ps1 made in the folder (#1247) ------------
        static void GeneratedStays()
        {
            Scene s = NewScene("generated", false);
            string made = null;
            try { made = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            string own = OwnGame.Folder;
            MadeNowRuns(s);
            Yes("(made)", made != null);

            // Build-Generated puts a new file of the folder's own where Vortex
            // deploys one (as a body over Vortex's), and makes one that came in
            // from the Steam copy when the folder was made (the Steam copy's own
            // Nemesis output, on record as O the way Make used to record it).
            string body = "Data\\textures\\ts\\wood.dds";
            string behavior = "Data\\meshes\\actors\\character\\behaviors\\0_master.hkx";
            string atBody = Path.Combine(own, body), atBehavior = Path.Combine(own, behavior);
            File.Delete(atBody);
            Put(atBody, "GENERATED-BODY");
            Put(atBehavior, "GENERATED-BEHAVIOR");
            string filesTxt = Path.Combine(OwnGame.Dir, "files.txt");
            File.AppendAllText(filesTxt, "C|O|18|1|" + behavior + "\r\n");
            string record = Path.Combine(OwnGame.Dir, "generated.txt");
            string recordText = "generated 1\r\ngame " + own + "\r\nfile " + new string('a', 64) + " " + body + "\r\nfile " + new string('b', 64) + " " + behavior + "\r\n";
            Put(record, recordText);

            // Vortex brings out a new version of the file the body sits over.
            string staged = Path.Combine(s.Staging, "ModA\\textures\\ts\\wood.dds");
            string steamLink = Path.Combine(s.Game, "Data\\textures\\ts\\wood.dds");
            // Each deployment a minute after the one before, so Vortex's record
            // reads as a new one. The new version's own write time moves the
            // same minute: the record times a file by it (VortexTime), and two
            // versions written back to back here can land in one tick of the
            // clock Windows stamps files from, so both read as the same file
            // and the refresh rightly leaves it alone (#2210). A real install
            // of a new version is never written in the same tick as the last.
            int deployed = 0;
            Action<string> vortexBringsOut = delegate (string bytes)
            {
                File.Delete(steamLink);
                File.Delete(staged);
                Put(staged, bytes);
                deployed++;
                File.SetLastWriteTimeUtc(staged, DateTime.UtcNow.AddMinutes(deployed));
                CreateHardLink(steamLink, staged, IntPtr.Zero);
                Deploy(s, new string[][] { new string[] { "TsOne.esp", "ModA", "VORTEX-TSONE" },
                                           new string[] { "textures\\ts\\wood.dds", "ModA", bytes } }, DateTime.UtcNow.AddMinutes(deployed));
            };
            vortexBringsOut("VORTEX-DDS-TWO");
            Yes("(the folder asks to follow Vortex)", OwnGame.NeedsRefresh(s.Cfg));
            var steamNow = Snap(s.Game);
            string first = null;
            try { first = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes("the refresh works", first != null && Clean(first));
            Yes("the file Build-Generated made where Vortex deploys one stays as it was made, though Vortex brought out a new one of that name",
                Text(atBody) == "GENERATED-BODY");
            Yes("and Vortex's own copy of that name was not written", Text(staged) == "VORTEX-DDS-TWO");
            Yes("the one that came in from the Steam copy stays, on record as Thornswood's (T), not taken out as a mod put there by hand",
                Text(atBehavior) == "GENERATED-BEHAVIOR" && FilesTxt().Contains("|T|18|1|" + behavior));
            Yes("the Steam copy was not touched", Same(steamNow, Snap(s.Game)));

            // The same again without the record: it is the record that keeps them.
            File.Delete(record);
            vortexBringsOut("VORTEX-DDS-THREE");
            string second = null;
            try { second = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes("without the record, a refresh puts Vortex's new file in its place", second != null && Text(atBody) == "VORTEX-DDS-THREE");
            Yes("and takes out the one from the Steam copy as none of the three kinds", second != null && !File.Exists(atBehavior));

            // A folder made anew holds nothing Build-Generated made, so the
            // record goes with the old one, before Make reads it.
            Put(record, recordText);
            Directory.Delete(own, true);
            Paths.Collection = true;
            Paths.Game = s.Game;
            Paths.Live = Paths.WinLocalAD;
            Paths.LiveMyGames = Paths.WinMyGames;
            string again = null;
            try { again = OwnGame.Make(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Make said: " + ex.Message); }
            Yes("a folder made anew forgets what Build-Generated made in the old one", again != null && !File.Exists(record));
            Yes("and has Vortex's file of that name, as a link to Vortex's own copy",
                Text(Path.Combine(own, body)) == "VORTEX-DDS-THREE" && Id(Path.Combine(own, body)) == Id(staged));
        }
    }
}
'@

$work = Join-Path $Scratch ('thornswood-own-alone-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    # The pretend build's list, in records\skyrim-files.json's shape (#1232).
    # Bytes and SHA-1 are what NewScene writes for 1.6.1170 (PIN-EXE at 4096,
    # PIN-MASTER, the two archives, GAME-BINK, GAME-LOOSE), so a file edited
    # in this fake Steam copy is not the pinned build's (#1246).
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
    $uiGoneList = Join-Path (Join-Path $Here 'records') 'ui-gone.json'
    $exe = $null
    if (Test-Path -LiteralPath $LauncherDotnet) {
        try { $exe = Build-LauncherCode -File $real -Source $stubs, $driver -Exe -Resource @{ 'skyrim-files.json' = $skyrimList; 'ui-gone.json' = $uiGoneList } }
        catch { Write-Host ('      ' + $_.Exception.Message) }
        Yes 'the real OwnGame.cs, OwnGameShare.cs and Downgrade.cs build with the driver, the way the project builds them' ($null -ne $exe)
    }

    if ($exe -and -not $OnWindows) {
        Write-Host 'SKIP  the driver run, 1 to 4 and 6''s files: OwnGame makes NTFS hard links through kernel32, and the driver reads file ids the same way, which only Windows has'
    }
    elseif ($exe) {
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
finally {
    try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop } catch { }
}

# ---- 5: the launcher's source keeps the Steam copy unwritten ------------------
$read = { param($n) [IO.File]::ReadAllText((Join-Path $AppPath $n)) }
$own = & $read 'OwnGame.cs'
$share = & $read 'OwnGameShare.cs'
$down = & $read 'Downgrade.cs'
$shell = & $read 'Shell.cs'
$upd = & $read 'Updater.cs'
$all = (Get-ChildItem -LiteralPath $AppPath -Filter '*.cs' | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"

Yes 'nothing asks for the Steam copy to be downgraded any more (SourceNeeded and Downgrade.Target are gone)' `
    (($all -notmatch 'SourceNeeded\(') -and ($all -notmatch 'Downgrade\.Target\('))
Yes 'WhyNot no longer refuses a made folder over the Steam copy''s build' ($own -notmatch 'most likely because Steam updated it')
Yes 'a refresh takes only Vortex''s files (Refresh calls Vortex, not Gather)' `
    (($own -match 'List<Found> all = Vortex\(src, left, scope, failed\);') -and ($own -notmatch 'List<Found> all = Gather\(src, left\);'))
Yes 'the Downgrade puts its files only through OwnGame.TakePinned, and never names the Steam copy (OwnGame.Source)' `
    (($down -match 'OwnGame\.TakePinned\(') -and ($down -notmatch 'OwnGame\.Source') -and ($down -notmatch 'File\.Copy\('))
$run = $down.Substring($down.IndexOf('static bool Run(Config cfg'))
Yes 'with no folder of its own the Downgrade returns before any file is put anywhere' `
    (($run.IndexOf('if (first)', $run.IndexOf('DownloadedExe(content)')) -ge 0) -and
     ($run.IndexOf('if (first)', $run.IndexOf('DownloadedExe(content)')) -lt $run.IndexOf('OwnGame.TakePinned(')))
Yes 'TakePinned refuses outright before a folder of its own exists' `
    ($share -match 'if \(Paths\.Collection\)\s*throw new Exception\("Thornswood has no folder of its own yet, and the Steam copy is never written')
Yes 'SkyrimSE.exe goes in last (#369 F3)' `
    (($share -match 'if \(string\.Equals\(f\.Rel, "SkyrimSE\.exe", StringComparison\.OrdinalIgnoreCase\)\) exe = f;') -and ($share -match 'if \(exe != null\) take\.Add\(exe\);'))
Yes 'removing a pack no longer deletes anything from the Steam copy' `
    ($upd -notmatch 'also went from the Skyrim on Steam')
$shellPlay = & $read 'ShellPlay.cs'
$play = $shellPlay.Substring($shellPlay.IndexOf('static void Play()'))
Yes 'Play checks the shared archives before anything else is read, and stops when one changed' `
    (($play.IndexOf('OwnGame.CheckShared(') -ge 0) -and ($play.IndexOf('OwnGame.CheckShared(') -lt $play.IndexOf('Verify.Run(cfg)')))
Yes 'after the Downgrade, the folder is made from the download, and Steam''s updates are not asked about' `
    (($shell -match 'if \(ok && Paths\.Collection && Downgrade\.Downloaded\(cfg\) != null\) StartOwnGame\(true, true\);') -and
     ($shell -notmatch 'if \(ok\) AskToHoldSteamUpdates\(\);'))
Yes 'the Downgrade question says the Steam copy is not changed' ($shell -match 'Your Steam copy of Skyrim is not changed and can stay on any build')
$kinds = & $read 'OwnGameKinds.cs'

# ---- 6: only the three kinds, by a real list (#1232) ---------------------------
$gather = $own.Substring($own.IndexOf('static List<Found> Gather('))
$gather = $gather.Substring(0, $gather.IndexOf('static void Pin('))
Yes 'Make keeps to the three kinds on both walks of the Steam copy (Gather calls OnlyThree twice)' (([regex]::Matches($gather, 'OnlyThree\(')).Count -eq 2)
Yes 'Skyrim''s own is the embedded list of the pinned build''s files, not a guess by folder' `
    (($kinds -match 'GetManifestResourceStream\("skyrim-files\.json"\)') -and ($kinds -match 'public static bool SkyrimOwn\(string rel\)\s*\{\s*return SkyrimFiles\(\)\.Contains\(rel\);'))
Yes 'without the list nothing is made or refreshed (WhyNot asks NoSkyrimList first)' ($own -match 'string noList = NoSkyrimList\(\);\s*if \(noList != null\) return noList;')
$rulesNum = [regex]::Match($own, '(?m)^\s*const int Rules = (\d+);')
Yes 'OwnGame''s Rules is at least 13, so every folder made before #1232 refreshes once' ($rulesNum.Success -and [int]$rulesNum.Groups[1].Value -ge 13)
$refreshNow = $own.Substring($own.IndexOf('static string RefreshNow('))
Yes 'the refresh takes out what is none of the three and records the kind of the rest' `
    ($refreshNow -match '(?s)origin = KindOf\(kv\.Key, null, ours\);\s*if \(origin == ''\\0'' && !sortNow\)\s*\{.*?else if \(origin == ''\\0''\)\s*\{\s*try\s*\{\s*DropName\(at\);')
Yes 'and takes nothing out until every record of Thornswood''s own files is here (OursKnown, the release''s list)' `
    (($refreshNow -match 'bool sortNow = OursKnown\(\);') -and ($refreshNow -match 'WriteMade\(src, SumCopied\(lines\), sortNow && stuck\.Count == 0 \? 1 : 0\);'))
Yes 'Make, Refresh and the Steam copy''s clean up run one at a time' `
    (($own -match 'lock \(folderWork\) return MakeNow\(') -and ($own -match 'lock \(folderWork\) return RefreshNow\(') -and ((& $read 'OwnGameClean.cs') -match 'lock \(folderWork\) return CleanSteamCopyNow\('))
Yes 'the clean up keeps the installer''s list before it empties it' ((& $read 'OwnGameClean.cs') -match 'KeepInstalledList\(\);\s*\r?\n\s*\r?\n\s*string steam = Source\(cfg\);')
Yes 'a listed file from the Steam copy is the pinned build''s by its size, and by SHA-1 when it is not an archive (#1246)' `
    (($kinds -match 'fi.Length != info.Bytes') -and ($kinds -match 'return !rel.EndsWith\("\.bsa"') -and ($own -match 'return !ListedFilesArePinned\(game\);') -and ($down -match 'OwnGame.SteamCopyNotPinned\(cfg\)'))

Done
