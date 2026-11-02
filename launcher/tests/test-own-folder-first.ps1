<#
  test-own-folder-first.ps1

      pwsh -NoProfile -File .\launcher\tests\test-own-folder-first.ps1

  Thornswood's own folder, chosen in the setup window, is built without ever
  writing into the Steam copy of Skyrim; not chosen, the install uses the Steam
  copy as it always has, and turning the folder on later takes Thornswood's
  files back out of it. Issue #1226.

  Patrick, 29 Sep: "First setup builds Thornswood's own folder first and never
  touches Steam's copy", and the launcher sets Steam's "Wait until I launch the
  game" only before the own folder is made; "after that, people's Steam copy is
  theirs to update however they like". Then: "it should only do that if you
  choose own folder during install; otherwise it still uses Steam's copy until
  you turn own game folder on later, then it should make the own game folder
  and do the clean up; for people that already have the game folder, have the
  next update do this for them."

  WHAT THIS HOLDS THE INSTALLER AND THE LAUNCHER TO.
    1. Chosen, Vortex deployed before the launcher first opens: the real
       install (InstallSteps.cs, which replaced Setup-Thornswood.ps1 in
       #4824) puts the payload in Profile\Payload and writes
       nothing into the Steam copy and no installed-into-game list; the
       launcher's first start (Leaks, Thornswood.ini, Keep, the client
       settings, the checks, a pack, Fix's plugin restore,
       Scan) writes into Payload and never into the Steam copy; Steam's Updates
       setting is looked at; Make builds Root\Game with the game, Vortex's files
       and everything from Payload, and removes Payload; after the restart the
       Steam setting is left alone, the one-time clean up finds nothing, a
       second start and a pack write only into Root\Game, and a Payload left
       behind is removed. The Steam copy is byte and time identical from before
       the installer to the end.
    2. Chosen, Vortex deployed after the launcher first opened: the folder
       cannot be made yet and says why, nothing is written anywhere in the
       Steam copy, and once Vortex deploys it is made the same way.
    3. Chosen, the Steam copy on a newer build: the Downgrade card is up
       (it reads the Steam copy's exe, not Payload's), Steam's setting is not
       touched while it is, the download is taken, and the folder is made from
       1.6.1170's own files with the Steam copy left on its build.
    4. Not chosen: the installer writes the payload into the Steam copy with
       its list, the launcher uses the Steam copy as it always has; the folder
       is then turned on and made, and the next start takes out exactly
       Thornswood's files (the installer's record, what packs added to it,
       Thornswood.ini and the thornswood- notes, the client runtime by its
       recorded bytes). A file held open is retried at the next start. The
       person's own mods, Skyrim's own files, Vortex's files, another server's
       page at a path Thornswood also writes, and the client settings file
       every SkyMP server shares all stay, and the log names what went and
       what stayed. The same start is what an existing own folder gets from
       the next update: once, and never again.
    5. The wiring: Shell starts the clean up and gates Steam's setting on the
       folder, Updater keeps the list only while the Steam copy is used, and
       nothing in the launcher decides Paths.Game but Paths.Init.
    6. Issue #1234: before the own folder exists, a pack that carries a plugin
     list and Fix's server-order write leave Windows' plugins.txt and
     loadorder.txt alone. The order goes into Profile and is still there
     when the folder is made. Chosen in the setup window, and not chosen.
  7. Issue #1232: in every case the person's own mods in the Steam copy (a
       plugin, a loose mesh, a script extender plugin) never reach Root\Game,
       and the record says which kind each file is. A folder made before
       that, which took them, loses them at its next refresh, and still keeps
       the installer's files when the clean up has already emptied the
       installer's list.

  HOW. The whole launcher is built with a driver into one program (the .NET
  SDK the launcher builds with, tests\Launcher-Csc.ps1, #4823, with the
  Thornswood.ini template and a client record for the pretend client
  embedded). The installer part has that program run the launcher's own
  InstallSteps on a pretend Steam copy and a pretend package, on every
  machine; tests\test-4824-install.py holds the install more widely. The
  launcher part points Steam.cs at the pretend Steam and runs the real code,
  on Windows only, since the launcher lays out the game folder by Windows
  paths and links with kernel32; elsewhere it says SKIP. The source checks
  of 5 run everywhere.

  Nothing outside its own scratch folder is read or written, beyond reading
  the repository.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
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

$T = Join-Path $Scratch ('own-folder-first-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $T

function Put([string]$path, [string]$text) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path)
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function PutBytes([string]$path, [string]$mark, [int]$size) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path)
    $b = New-Object byte[] $size
    $m = [Text.Encoding]::ASCII.GetBytes($mark)
    [Array]::Copy($m, $b, $m.Length)
    [IO.File]::WriteAllBytes($path, $b)
}
function Sha([string]$path) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (($h.ComputeHash([IO.File]::ReadAllBytes($path)) | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $h.Dispose() }
}
# Every file under a folder: size, SHA-256 and write time.
function Snap([string]$dir) {
    $d = @{}
    if (-not (Test-Path -LiteralPath $dir)) { return $d }
    $pfx = $dir.TrimEnd('\') + '\'
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Recurse -File -Force)) {
        $d[$f.FullName.Substring($pfx.Length)] = '{0}|{1}|{2}' -f $f.Length, (Sha $f.FullName), $f.LastWriteTimeUtc.Ticks
    }
    return $d
}
function SameSnap($a, $b) {
    if ($a.Count -ne $b.Count) { return $false }
    foreach ($k in $a.Keys) { if (-not $b.ContainsKey($k) -or $b[$k] -ne $a[$k]) { return $false } }
    return $true
}

# ---- the pretend client runtime, and its record ------------------------------
# The six files of launcher\app\OwnGame.cs ClientFiles, with made-up bytes, and
# a client-build.json in records\client-build.json's own shape for them, so
# ClientRuntime.Recorded knows them as Thornswood's build.
$ownGameSrc = [IO.File]::ReadAllText((Join-Path $App 'OwnGame.cs'))
$clientBlock = [regex]::Match($ownGameSrc, '(?s)public static readonly string\[\] ClientFiles = \{(.*?)\};').Groups[1].Value
$clientFiles = @([regex]::Matches($clientBlock, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value.Replace('\\', '\') })
Yes ('the six client runtime files are read out of OwnGame.ClientFiles (' + $clientFiles.Count + ')') ($clientFiles.Count -eq 6)
$clientDir = Join-Path $T 'client'
$recordLines = @()
foreach ($c in $clientFiles) {
    $p = Join-Path $clientDir $c
    PutBytes $p ('TS-CLIENT ' + $c) 512
    $recordLines += ('    "{0}": {{ "sha256": "{1}", "bytes": 512 }}' -f $c.Replace('\', '\\'), (Sha $p))
}
$clientRecord = Join-Path $T 'client-build.json'
Put $clientRecord ("{`n  ""files"": {`n" + ($recordLines -join ",`n") + "`n  }`n}`n")

# ---- the launcher, built with a driver, on every machine ----------------------
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    static class OwnFolderFirstTest
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
        static void PutBytes(string path, string mark, int size)
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
                return Encoding.UTF8.GetString(b, 0, n < 0 ? b.Length : n);
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

        static Dictionary<string, string> Snap(string dir)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!Directory.Exists(dir)) return d;
            using (var sha = SHA256.Create())
                foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                {
                    var fi = new FileInfo(f);
                    d[f.Substring(dir.TrimEnd('\\').Length + 1)] = fi.Length + "|" + Hex(sha.ComputeHash(File.ReadAllBytes(f))) + "|" + fi.LastWriteTimeUtc.Ticks;
                }
            return d;
        }
        static string Hex(byte[] h) { var sb = new StringBuilder(); foreach (byte b in h) sb.Append(b.ToString("x2")); return sb.ToString(); }
        static bool Same(Dictionary<string, string> a, Dictionary<string, string> b)
        {
            if (a.Count != b.Count) { Diff(a, b); return false; }
            foreach (KeyValuePair<string, string> kv in a)
            {
                string v;
                if (!b.TryGetValue(kv.Key, out v) || v != kv.Value) { Diff(a, b); return false; }
            }
            return true;
        }
        static void Diff(Dictionary<string, string> a, Dictionary<string, string> b)
        {
            foreach (string k in a.Keys) if (!b.ContainsKey(k)) Console.WriteLine("      gone: " + k); else if (b[k] != a[k]) Console.WriteLine("      changed: " + k);
            foreach (string k in b.Keys) if (!a.ContainsKey(k)) Console.WriteLine("      new: " + k);
        }
        static bool Clean(string said)
        {
            return said == null || (said.IndexOf('—') < 0 && said.IndexOf("player", StringComparison.OrdinalIgnoreCase) < 0);
        }

        class Scene
        {
            public string Dir, Steam, Game, Staging, Ts, Payload;
            public Config Cfg;
            public List<string> Said = new List<string>();
        }

        static Scene Open(string name)
        {
            var s = new Scene();
            s.Dir = Path.Combine(T, name);
            s.Steam = Path.Combine(s.Dir, "steam");
            s.Game = Path.Combine(s.Steam, "steamapps\\common\\Skyrim Special Edition");
            s.Staging = Path.Combine(s.Dir, "vortex\\mods");
            s.Ts = Path.Combine(s.Dir, "Thornswood");
            s.Payload = Path.Combine(s.Ts, "Profile\\Payload");
            Steam.RootForTest = s.Steam;
            Start(s);
            s.Cfg = Config.Load(Paths.CfgFile);
            s.Cfg.ServerAddress = "";
            s.Cfg.ExpectedExeBytes = ExeBytes;
            s.Cfg.NewerExeBytes = NewerExeBytes;
            return s;
        }

        // What every launcher start does to Paths: Init from the install
        // folder. Windows' own Skyrim folders are moved into the scratch
        // folder, the rest is what Init decided.
        static void Start(Scene s)
        {
            Paths.Init(s.Ts);
            Paths.WinMyGames = Path.Combine(s.Dir, "windows\\My Games\\Skyrim Special Edition");
            Paths.WinLocalAD = Path.Combine(s.Dir, "windows\\LocalAppData\\Skyrim Special Edition");
            Paths.Live = Paths.Collection ? Paths.WinLocalAD : Paths.LocalAD;
            Paths.LiveMyGames = Paths.Collection ? Paths.WinMyGames : Paths.MyGames;
        }

        static void Say(Scene s, string m) { if (m != null) s.Said.Add(m); }

        // Vortex deploys: files into its staging folder, hard links into the
        // Steam copy, and its record. Vortex's writes, not Thornswood's.
        static void Deploy(Scene s, DateTime when)
        {
            string[][] files = {
                new string[] { "TsOne.esp", "ModA", "VORTEX-TSONE" },
                new string[] { "textures\\ts\\wood.dds", "ModA", "VORTEX-DDS" },
                new string[] { "SKSE\\Plugins\\versionlib-1-6-1170-0.bin", "AddressLib", "VORTEX-ADDR" },
            };
            var sb = new StringBuilder();
            sb.Append("{\n  \"instance\": \"test\",\n  \"version\": 1,\n  \"deploymentMethod\": \"hardlink_activator\",\n  \"gameId\": \"skyrimse\",\n");
            sb.Append("  \"stagingPath\": \"" + J(s.Staging) + "\",\n  \"targetPath\": \"" + J(Path.Combine(s.Game, "Data")) + "\",\n  \"files\": [\n");
            for (int i = 0; i < files.Length; i++)
            {
                string staged = Path.Combine(s.Staging, files[i][1] + "\\" + files[i][0]);
                if (!File.Exists(staged)) Put(staged, files[i][2]);
                string at = Path.Combine(s.Game, "Data\\" + files[i][0]);
                if (!File.Exists(at)) { Directory.CreateDirectory(Path.GetDirectoryName(at)); CreateHardLink(at, staged, IntPtr.Zero); }
                sb.Append("    { \"relPath\": \"" + J(files[i][0]) + "\", \"source\": \"" + J(files[i][1]) + "\", \"target\": \"\", \"time\": " + VortexTime(staged) + " }" + (i + 1 < files.Length ? "," : "") + "\n");
            }
            sb.Append("  ]\n}\n");
            string rec = Path.Combine(s.Game, "Data\\vortex.deployment.json");
            Put(rec, sb.ToString());
            File.SetLastWriteTimeUtc(rec, when);
            // And Vortex's plugin list, which it writes into Windows' own folder.
            Put(Path.Combine(Paths.WinLocalAD, "plugins.txt"), "*TsOne.esp\r\n");
        }

        // Steam's download of 1.6.1170's own files, as Steam leaves it and the
        // Downgrade marks it, in Steam's own download folder.
        static void Download(Scene s)
        {
            string content = Path.Combine(s.Steam, "steamapps\\content\\app_489830");
            string[] cmds = Downgrade.Commands(s.Cfg);
            for (int i = 0; i < cmds.Length; i++)
            {
                string[] p = cmds[i].Split(' ');
                string folder = Path.Combine(content, "depot_" + p[2]);
                if (i == 0) PutBytes(Path.Combine(folder, "SkyrimSE.exe"), "PIN-EXE", ExeBytes);
                if (i == 1) PutBytes(Path.Combine(folder, "Data\\Skyrim - Textures0.bsa"), "PIN-TEX0", 65536);
                if (i == 2) Put(Path.Combine(folder, "Data\\Skyrim.esm"), "PIN-MASTER");
                Put(Path.Combine(folder, ".thornswood-complete"), p[3] + "\n1");
            }
        }

        static string PackZip(Scene s, string id)
        {
            string zip = Path.Combine(s.Dir, id + ".zip");
            if (File.Exists(zip)) File.Delete(zip);
            using (ZipArchive z = ZipFile.Open(zip, ZipArchiveMode.Create))
            {
                foreach (string[] e in new string[][] {
                    new string[] { "game/Data/Platform/Plugins/thornswood-" + id + ".js", "PACK-JS " + id },
                    new string[] { "game/Data/textures/thornswood/" + id + ".dds", "PACK-DDS " + id } })
                {
                    ZipArchiveEntry en = z.CreateEntry(e[0]);
                    using (var w = new StreamWriter(en.Open(), new UTF8Encoding(false))) w.Write(e[1]);
                }
            }
            return zip;
        }


        // A pack whose only payload is the reference plugin list (#1234).
        static string ListZip(Scene s)
        {
            string zip = Path.Combine(s.Dir, "list-pack.zip");
            if (File.Exists(zip)) File.Delete(zip);
            using (ZipArchive z = ZipFile.Open(zip, ZipArchiveMode.Create))
            {
                string[][] entries = {
                    new string[] { "profile/plugins.txt", "*FromPack.esp\r\n" },
                    new string[] { "profile/loadorder.txt", "FromPack.esp\r\n" },
                };
                for (int i = 0; i < entries.Length; i++)
                {
                    ZipArchiveEntry en = z.CreateEntry(entries[i][0]);
                    using (var w = new StreamWriter(en.Open(), new UTF8Encoding(false))) w.Write(entries[i][1]);
                }
            }
            return zip;
        }

        // Before the own folder exists, the list must land in Profile and
        // leave Windows' own Skyrim folder as it was (#1234).
        static void SettleList(Scene s, string n)
        {
            string winP = Path.Combine(Paths.WinLocalAD, "plugins.txt");
            string winO = Path.Combine(Paths.WinLocalAD, "loadorder.txt");
            Put(winP, "*SteamOwn.esp\r\n");
            Put(winO, "SteamOwn.esp\r\n");
            string winPBefore = File.ReadAllText(winP);
            string winOBefore = File.ReadAllText(winO);
            var p = new Pack();
            p.id = "listpack";
            Updater.Install(ListZip(s), p, delegate(string m) { Say(s, m); });
            Yes(n + "a pack's plugin list does not write Windows' plugins.txt", File.ReadAllText(winP) == winPBefore);
            Yes(n + "and does not write Windows' loadorder.txt", File.ReadAllText(winO) == winOBefore);
            Yes(n + "the order is in Profile\\Default", File.ReadAllText(Path.Combine(Paths.Golden, "plugins.txt")).IndexOf("FromPack.esp", StringComparison.Ordinal) >= 0);
            Yes(n + "and in Profile\\LocalAppData, where it waits for the folder",
                File.ReadAllText(Path.Combine(Paths.LocalAD, "plugins.txt")).IndexOf("FromPack.esp", StringComparison.Ordinal) >= 0 &&
                File.ReadAllText(Path.Combine(Paths.LocalAD, "loadorder.txt")).IndexOf("FromPack.esp", StringComparison.Ordinal) >= 0);
            Yes(n + "OrderFolder is Profile while there is no own folder",
                Paths.Collection &&
                string.Equals(Path.GetFullPath(Verify.OrderFolder), Path.GetFullPath(Paths.LocalAD), StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(Path.GetFullPath(Verify.OrderFolder), Path.GetFullPath(Paths.WinLocalAD), StringComparison.OrdinalIgnoreCase));
            int ordered = Verify.PutInServerOrder(s.Cfg, delegate(string m) { Say(s, m); });
            Yes(n + "Fix's server order, with no server to ask, leaves Windows' lists alone",
                ordered == 0 && File.ReadAllText(winP) == winPBefore && File.ReadAllText(winO) == winOBefore);
            if (Paths.OwnFirst)
                Yes(n + "Fix before the folder exists still does not write Windows' plugin list",
                    Verify.Fix(s.Cfg, null, null) == 1 && File.ReadAllText(winP) == winPBefore && File.ReadAllText(winO) == winOBefore);
            // Make refuses a golden list whose plugins Vortex has not deployed.
            // This pack's name is not one of them. The waiting copy in
            // LocalAppData stays, and that is what the folder receives.
            File.WriteAllText(Path.Combine(Paths.Golden, "plugins.txt"), "*TsOne.esp\r\n");
            File.WriteAllText(Path.Combine(Paths.Golden, "loadorder.txt"), "TsOne.esp\r\n");
        }

        // The part of a launcher start that writes game files, in Shell.Run's
        // order, then what else can write before Play: a pack, Fix's plugin
        // restore, and the checks and Scan the Play page runs.
        static void StartWrites(Scene s, string pack)
        {
            Action<string> say = delegate(string m) { Say(s, m); };
            Say(s, Leaks.Clean(s.Cfg));
            Say(s, ThornIni.Ensure());
            Keep.TakeNote();
            Keep.Unpark();
            Keep.Seed();
            AutoJoin.Ensure(say);
            if (pack != null)
            {
                var p = new Pack();
                p.id = pack;
                Updater.Install(PackZip(s, pack), p, say);
            }
            OwnGame.RestoreMissingPlugins(s.Cfg, say);
            Verify.Run(null);
            Checks.All(s.Cfg);
        }

        static string Cleaned { get { return Path.Combine(OwnGame.Dir, "steam-copy-cleaned.txt"); } }

        // The person's own mods in the Steam copy, put there by hand (New-Steam).
        static readonly string[] Hand = { "Data\\MyOwn.esp", "Data\\meshes\\mine\\sword.nif", "Data\\SKSE\\Plugins\\MyOwnPlugin.dll" };
        static readonly string[] HandText = { "MINE-ESP", "MINE-NIF", "MINE-SKSE" };
        static bool NoneIn(string folder, string[] rels)
        {
            foreach (string r in rels) if (File.Exists(Path.Combine(folder, r))) { Console.WriteLine("      in " + folder + ": " + r); return false; }
            return true;
        }
        static bool AllIn(string folder, string[] rels)
        {
            for (int i = 0; i < rels.Length; i++) if (Text(Path.Combine(folder, rels[i])) != HandText[i]) { Console.WriteLine("      not as the person left it: " + rels[i]); return false; }
            return true;
        }

        static int Main(string[] args)
        {
            // install <root> <package> <steam root> <steam game> <own 1|0>:
            // the install, as the launcher's first start runs it from its
            // window (InstallSteps.cs, #4824), each line it says printed.
            if (args[0] == "install")
            {
                var choice = new InstallChoice { Root = args[1], Package = args[2], SteamRoot = args[3], SteamGame = args[4], MakeOwnGame = args[5] == "1", VortexGame = "" };
                var steps = new InstallSteps(choice, Console.WriteLine, f => { });
                try { steps.Run(); Console.WriteLine("install: done, " + steps.Bad + " failed"); }
                catch (InstallStop e) { Console.WriteLine("install: stopped, " + e.Message); }
                return 0;
            }
            T = args[0];
            foreach (string scene in new string[] { "chosen-vortex-first", "chosen-vortex-after", "chosen-downgrade", "not-chosen" })
            {
                try
                {
                    if (scene == "chosen-vortex-first") ChosenVortexFirst();
                    if (scene == "chosen-vortex-after") ChosenVortexAfter();
                    if (scene == "chosen-downgrade") ChosenDowngrade();
                    if (scene == "not-chosen") NotChosen();
                }
                catch (Exception ex)
                {
                    Yes(scene + ": the driver ran to the end (" + ex.GetType().Name + ": " + ex.Message + ")", false);
                    Console.WriteLine(ex.StackTrace);
                }
            }
            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            return fail > 0 ? 1 : 0;
        }

        static bool Under(string path, string dir)
        {
            return Path.GetFullPath(path).StartsWith(Path.GetFullPath(dir).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
        }

        // ---- 1 --------------------------------------------------------------
        static void ChosenVortexFirst()
        {
            Scene s = Open("chosen-vortex-first");
            string n = "chosen-vortex-first: ";
            Yes(n + "the first start sees the own folder chosen and not made (Paths.OwnFirst)", Paths.OwnFirst && Paths.Collection && !OwnGame.Active);
            Yes(n + "Paths.Game is Profile\\Payload, and Exe, Loader and MpClient are under it, never the Steam copy",
                string.Equals(Path.GetFullPath(Paths.Game), Path.GetFullPath(s.Payload), StringComparison.OrdinalIgnoreCase) &&
                Under(Paths.Exe, s.Payload) && Under(Paths.Loader, s.Payload) && Under(Paths.MpClient, s.Payload) && !Under(Paths.Game, s.Game));
            Yes(n + "Paths.SteamCopy is the Steam copy", string.Equals(Path.GetFullPath(Paths.SteamCopy), Path.GetFullPath(s.Game), StringComparison.OrdinalIgnoreCase));
            Yes(n + "the game's facts are read from the Steam copy (Paths.Skyrim, SkyrimExe), the script extender plugins from it and Payload (#1235)",
                string.Equals(Path.GetFullPath(Paths.Skyrim), Path.GetFullPath(s.Game), StringComparison.OrdinalIgnoreCase) &&
                Under(Paths.SkyrimExe, s.Game) && Paths.SksePluginDirs.Length == 2 &&
                Under(Paths.SksePluginDirs[0], s.Game) && Under(Paths.SksePluginDirs[1], s.Payload));
            SettleList(s, n);
            Deploy(s, DateTime.UtcNow.AddMinutes(-10));
            var before = Snap(s.Game);

            StartWrites(s, "pack1");
            Yes(n + "the first start, a pack, Fix's restore and the checks wrote nothing into the Steam copy", Same(before, Snap(s.Game)));
            Yes(n + "Thornswood.ini, the client settings and the pack went into Payload",
                File.Exists(Path.Combine(s.Payload, "Data\\SKSE\\Plugins\\Thornswood.ini")) &&
                File.Exists(Path.Combine(s.Payload, "Data\\Platform\\Plugins\\skymp5-client-settings.txt")) &&
                Text(Path.Combine(s.Payload, "Data\\Platform\\Plugins\\thornswood-pack1.js")) == "PACK-JS pack1");
            Yes(n + "and no installed-into-game list was started", !File.Exists(Path.Combine(Paths.ProfileDir, "installed-into-game.txt")));
            List<Check> rows = Checks.All(s.Cfg);
            Yes(n + "the Game build row reads the Steam copy's exe, not Payload's", rows.Count > 0 && rows[0].Name == "Game build" && rows[0].Ok);
            List<Issue> scan = Verify.Run(s.Cfg);
            Yes(n + "Scan says the folder is made next rather than calling the collection missing",
                scan.Count == 1 && scan[0].Text.IndexOf("not made yet", StringComparison.Ordinal) >= 0 && !scan[0].Blocking);
            Yes(n + "Fix makes the folder next and touches nothing else", Verify.Fix(s.Cfg, null, null) == 1 && Verify.OwnFolderNext && Same(before, Snap(s.Game)));
            Yes(n + "Steam's Updates setting is looked at while there is no folder", SteamUpdates.LooksAtStart(!Paths.Collection, Downgrade.Needed(s.Cfg)));
            Yes(n + "the one-time clean up does nothing before the folder is made", OwnGame.CleanSteamCopy(s.Cfg) == null && !File.Exists(Cleaned));
            Yes(n + "the folder can be made", OwnGame.WhyNot(s.Cfg, OwnGame.DeploysInto(s.Cfg)) == null);

            string made = OwnGame.Make(s.Cfg, null);
            string own = OwnGame.Folder;
            Yes(n + "Make made Root\\Game", made != null && Directory.Exists(own) && Clean(made));
            Yes(n + "the order that waited in Profile is the one the folder's game reads",
                File.ReadAllText(Path.Combine(Paths.LocalAD, "plugins.txt")).IndexOf("FromPack.esp", StringComparison.Ordinal) >= 0 &&
                File.ReadAllText(Path.Combine(Paths.WinLocalAD, "plugins.txt")).IndexOf("FromPack.esp", StringComparison.Ordinal) < 0);
            Yes(n + "Make wrote nothing into the Steam copy", Same(before, Snap(s.Game)));
            Yes(n + "Make says where Thornswood's own files came from", made != null && made.IndexOf("Profile\\Payload", StringComparison.Ordinal) >= 0);
            Yes(n + "Payload is gone once the folder has its files", !Directory.Exists(s.Payload));
            Yes(n + "the game is in the folder: the exe and the master are its own copies",
                Text(Path.Combine(own, "SkyrimSE.exe")) == "PIN-EXE" && Id(Path.Combine(own, "SkyrimSE.exe")) != Id(Path.Combine(s.Game, "SkyrimSE.exe")) &&
                Text(Path.Combine(own, "Data\\Skyrim.esm")) == "PIN-MASTER");
            Yes(n + "Vortex's files are links to Vortex's own copies", Id(Path.Combine(own, "Data\\TsOne.esp")) == Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")));
            Yes(n + "the installer's payload is in the folder, the client runtime included",
                Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-front.js")) == "TS-FRONT" &&
                Text(Path.Combine(own, "Data\\Thornswood-Content.esp")) == "TS-CONTENT" &&
                (Text(Path.Combine(own, "Data\\SKSE\\Plugins\\MpClientPlugin.dll")) ?? "").StartsWith("TS-CLIENT"));
            Yes(n + "and what the launcher wrote before the folder existed: Thornswood.ini, the client settings, the pack",
                File.Exists(Path.Combine(own, "Data\\SKSE\\Plugins\\Thornswood.ini")) &&
                File.Exists(Path.Combine(own, "Data\\Platform\\Plugins\\skymp5-client-settings.txt")) &&
                Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-pack1.js")) == "PACK-JS pack1");
            string files = File.ReadAllText(Path.Combine(OwnGame.Dir, "files.txt"));
            Yes(n + "the record lists them as the folder's own copies, and as Thornswood's (T)", files.IndexOf("C|T|", StringComparison.Ordinal) >= 0 &&
                files.IndexOf("|T|8|", StringComparison.Ordinal) >= 0 &&
                files.IndexOf("|Data\\Platform\\Plugins\\thornswood-front.js", StringComparison.OrdinalIgnoreCase) >= 0);
            Yes(n + "and the game's own as Skyrim's (O)", files.IndexOf("C|O|4096|", StringComparison.Ordinal) >= 0);
            Yes(n + "the person's mods put into the Steam copy by hand stayed out of the folder: their plugin, a loose mesh, a script extender plugin",
                NoneIn(own, Hand) && AllIn(s.Game, Hand));

            Start(s);
            Yes(n + "after the restart it runs from Root\\Game", !Paths.Collection && !Paths.OwnFirst && OwnGame.Active &&
                string.Equals(Path.GetFullPath(Paths.Game), Path.GetFullPath(own), StringComparison.OrdinalIgnoreCase));
            Yes(n + "and the game's facts are read from Root\\Game, one script extender folder (#1235)",
                string.Equals(Path.GetFullPath(Paths.Skyrim), Path.GetFullPath(own), StringComparison.OrdinalIgnoreCase) &&
                Paths.SksePluginDirs.Length == 1 && Under(Paths.SksePluginDirs[0], own));
            Yes(n + "once the folder exists the list is written where the game reads it, not into Windows' folder",
                !Paths.Collection &&
                string.Equals(Path.GetFullPath(Verify.OrderFolder), Path.GetFullPath(Paths.Live), StringComparison.OrdinalIgnoreCase) &&
                string.Equals(Path.GetFullPath(Paths.Live), Path.GetFullPath(Paths.LocalAD), StringComparison.OrdinalIgnoreCase));
            Yes(n + "and Steam's Updates setting is left alone from now on", !SteamUpdates.LooksAtStart(!Paths.Collection, Downgrade.Needed(s.Cfg)));
            string c = OwnGame.CleanSteamCopy(s.Cfg);
            Yes(n + "the one-time clean up finds nothing of Thornswood's in the Steam copy", c == null);
            Yes(n + "and writes its note, so it never runs again", File.Exists(Cleaned));
            StartWrites(s, "pack2");
            Yes(n + "a second start and a pack write only into Root\\Game",
                Same(before, Snap(s.Game)) && Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-pack2.js")) == "PACK-JS pack2");
            Put(Path.Combine(s.Payload, "Data\\left.txt"), "LEFT");
            OwnGame.CleanSteamCopy(s.Cfg);
            Yes(n + "a Profile\\Payload left behind by a stopped Make is removed at the next start", !Directory.Exists(s.Payload));
            Yes(n + "the Steam copy is what it was before the installer ran, to the byte and the write time", Same(before, Snap(s.Game)));
            foreach (string m in s.Said) if (!Clean(m)) Yes(n + "no em dash and never the word in: " + m, false);
        }

        // ---- 2 --------------------------------------------------------------
        static void ChosenVortexAfter()
        {
            Scene s = Open("chosen-vortex-after");
            string n = "chosen-vortex-after: ";
            var before = Snap(s.Game);
            StartWrites(s, "pack1");
            Yes(n + "the first start, before Vortex has deployed, wrote nothing into the Steam copy", Same(before, Snap(s.Game)));
            string why = OwnGame.WhyNot(s.Cfg, OwnGame.DeploysInto(s.Cfg));
            Yes(n + "the folder cannot be made yet, and the reason is Vortex", why != null && why.IndexOf("Vortex has nothing deployed", StringComparison.Ordinal) >= 0);
            string threw = null;
            try { OwnGame.Make(s.Cfg, null); } catch (Exception ex) { threw = ex.Message; }
            Yes(n + "Make refuses with that sentence and writes nothing", threw == why && !Directory.Exists(OwnGame.Folder) && Same(before, Snap(s.Game)) && Directory.Exists(s.Payload));

            Deploy(s, DateTime.UtcNow.AddMinutes(-5));
            before = Snap(s.Game);
            Start(s);
            Yes(n + "the next start still sees the folder to make", Paths.OwnFirst);
            StartWrites(s, "pack2");
            string made = OwnGame.Make(s.Cfg, null);
            Yes(n + "once Vortex has deployed the folder is made, and the Steam copy is untouched",
                made != null && Directory.Exists(OwnGame.Folder) && Same(before, Snap(s.Game)) && !Directory.Exists(s.Payload));
            Yes(n + "both packs are in it", Text(Path.Combine(OwnGame.Folder, "Data\\Platform\\Plugins\\thornswood-pack1.js")) == "PACK-JS pack1" &&
                Text(Path.Combine(OwnGame.Folder, "Data\\Platform\\Plugins\\thornswood-pack2.js")) == "PACK-JS pack2");
            Start(s);
            Yes(n + "the clean up after the restart finds nothing to take out", OwnGame.CleanSteamCopy(s.Cfg) == null && Same(before, Snap(s.Game)));
        }

        // ---- 3 --------------------------------------------------------------
        static void ChosenDowngrade()
        {
            Scene s = Open("chosen-downgrade");
            string n = "chosen-downgrade: ";
            Deploy(s, DateTime.UtcNow.AddMinutes(-10));
            var before = Snap(s.Game);
            Yes(n + "the Downgrade card is up: it reads the Steam copy's newer exe, not Payload's missing one", Downgrade.Needed(s.Cfg));
            Yes(n + "and the build it names is the Steam copy's, never missing (#1235)",
                Downgrade.Describe(s.Cfg) != "missing" && Downgrade.Describe(s.Cfg) == Downgrade.Describe(s.Cfg, Path.Combine(s.Game, "SkyrimSE.exe")));
            Yes(n + "Steam's Updates setting is not touched while a downgrade is needed", !SteamUpdates.LooksAtStart(!Paths.Collection, Downgrade.Needed(s.Cfg)));
            StartWrites(s, "pack1");
            Yes(n + "the first start wrote nothing into the Steam copy", Same(before, Snap(s.Game)));
            string why = OwnGame.WhyNot(s.Cfg, OwnGame.DeploysInto(s.Cfg));
            Yes(n + "the folder waits on the Downgrade, and says the Steam copy stays on its build", why != null && why.IndexOf("press Downgrade", StringComparison.Ordinal) >= 0);
            Download(s);
            Yes(n + "with 1.6.1170's files downloaded no downgrade is needed, and the setting is looked at", !Downgrade.Needed(s.Cfg) && SteamUpdates.LooksAtStart(!Paths.Collection, Downgrade.Needed(s.Cfg)));
            string made = OwnGame.Make(s.Cfg, null);
            string own = OwnGame.Folder;
            Yes(n + "the folder is made from the download and Payload", made != null && Text(Path.Combine(own, "SkyrimSE.exe")) == "PIN-EXE" &&
                Text(Path.Combine(own, "Data\\Skyrim.esm")) == "PIN-MASTER" && Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-front.js")) == "TS-FRONT");
            Yes(n + "the Steam copy stays on its newer build, untouched", Same(before, Snap(s.Game)) && Text(Path.Combine(s.Game, "SkyrimSE.exe")) == "NEW-EXE");
            Yes(n + "and the mods put into it by hand stayed out of the folder", NoneIn(own, Hand) && AllIn(s.Game, Hand));
            Yes(n + "the download is cleared and Payload is gone", Downgrade.Downloaded(s.Cfg) == null && !Directory.Exists(s.Payload));
        }

        // ---- 4 --------------------------------------------------------------
        static void NotChosen()
        {
            Scene s = Open("not-chosen");
            string n = "not-chosen: ";
            Yes(n + "without the choice the launcher uses the Steam copy as it always has", Paths.Collection && !Paths.OwnFirst &&
                string.Equals(Path.GetFullPath(Paths.Game), Path.GetFullPath(s.Game), StringComparison.OrdinalIgnoreCase));
            Yes(n + "and reads the game's facts there, one script extender folder (#1235)",
                string.Equals(Path.GetFullPath(Paths.Skyrim), Path.GetFullPath(s.Game), StringComparison.OrdinalIgnoreCase) &&
                Paths.SksePluginDirs.Length == 1);
            SettleList(s, n);
            Deploy(s, DateTime.UtcNow.AddMinutes(-10));
            Yes(n + "and Steam's Updates setting is looked at", SteamUpdates.LooksAtStart(!Paths.Collection, Downgrade.Needed(s.Cfg)));
            StartWrites(s, "pack1");
            Yes(n + "its files went into the Steam copy: Thornswood.ini and the pack", File.Exists(Path.Combine(s.Game, "Data\\SKSE\\Plugins\\Thornswood.ini")) &&
                File.Exists(Path.Combine(s.Game, "Data\\Platform\\Plugins\\thornswood-pack1.js")));
            string list = Path.Combine(Paths.ProfileDir, "installed-into-game.txt");
            Yes(n + "and the pack's new files joined the installer's list", File.ReadAllText(list).IndexOf("Data\\Platform\\Plugins\\thornswood-pack1.js", StringComparison.OrdinalIgnoreCase) >= 0);
            // Another SkyMP server's launcher writes its own page over the one
            // at the path both use, and parks its plugin beside ours; the
            // person adds a mod of their own.
            Put(Path.Combine(s.Game, "Data\\Platform\\UI\\index.html"), "OTHER-INDEX");
            Put(Path.Combine(s.Game, "Data\\Platform\\Plugins\\other-server.js"), "OTHER-PLUGIN");
            Put(Path.Combine(s.Game, "Data\\MyLater.esp"), "MINE-LATER");

            // Turned on later: made, and the launcher restarts into it.
            string made = OwnGame.Make(s.Cfg, null);
            string own = OwnGame.Folder;
            Yes(n + "turned on later, the folder is made from the Steam copy and Vortex", made != null && Directory.Exists(own) &&
                Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-front.js")) == "TS-FRONT");
            Start(s);
            Yes(n + "and the launcher runs from it", OwnGame.Active && !Paths.Collection);
            Yes(n + "the waiting plugin list is still the folder's, and Windows' list was not the pack's",
                File.ReadAllText(Path.Combine(Paths.LocalAD, "plugins.txt")).IndexOf("FromPack.esp", StringComparison.Ordinal) >= 0 &&
                File.ReadAllText(Path.Combine(Paths.WinLocalAD, "plugins.txt")).IndexOf("FromPack.esp", StringComparison.Ordinal) < 0);
            Yes(n + "once the folder exists OrderFolder is the file the game reads",
                string.Equals(Path.GetFullPath(Verify.OrderFolder), Path.GetFullPath(Paths.Live), StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(Path.GetFullPath(Paths.Live), Path.GetFullPath(Paths.WinLocalAD), StringComparison.OrdinalIgnoreCase));
            Yes(n + "Steam's Updates setting is left alone from now on", !SteamUpdates.LooksAtStart(!Paths.Collection, Downgrade.Needed(s.Cfg)));
            Yes(n + "the person's mods in the Steam copy, the ones from before the install and the one put in later, stayed out of the folder",
                NoneIn(own, Hand) && !File.Exists(Path.Combine(own, "Data\\MyLater.esp")) && AllIn(s.Game, Hand));
            string rec = File.ReadAllText(Path.Combine(OwnGame.Dir, "files.txt"));
            Yes(n + "the installer's files and the pack's are on record as Thornswood's (T), taken from the Steam copy by the installer's list",
                rec.IndexOf("C|T|", StringComparison.Ordinal) >= 0 &&
                System.Text.RegularExpressions.Regex.IsMatch(rec, @"\|T\|\d+\|\d+\|Data\\Thornswood-Content\.esp") &&
                System.Text.RegularExpressions.Regex.IsMatch(rec, @"\|T\|\d+\|\d+\|Data\\Platform\\Plugins\\thornswood-pack1\.js"));

            // As a folder made before #1232 has it: everything not Vortex's on
            // record as O, the hand placed mods in it as links to the Steam
            // copy's, under rules 12. The one-time clean up of the Steam copy
            // then runs first and empties the installer's list; the refresh
            // after it must still know the installer's files for Thornswood's.
            var legacy = new List<string>();
            foreach (string line in File.ReadAllLines(Path.Combine(OwnGame.Dir, "files.txt"))) legacy.Add(line.Replace("|T|", "|O|"));
            foreach (string h in Hand)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(own, h)));
                CreateHardLink(Path.Combine(own, h), Path.Combine(s.Game, h), IntPtr.Zero);
                legacy.Add("L|O|9|1|" + h);
            }
            File.WriteAllLines(Path.Combine(OwnGame.Dir, "files.txt"), legacy.ToArray());
            string madeTxt = Path.Combine(OwnGame.Dir, "made.txt");
            var made12a = new List<string>(); foreach (string l in File.ReadAllLines(madeTxt)) made12a.Add(l.StartsWith("rules=") ? "rules=12" : l); File.WriteAllLines(madeTxt, made12a.ToArray());

            // A game started from Steam holds one of the files open.
            string held = Path.Combine(s.Game, "Data\\Platform\\Plugins\\thornswood-front.js");
            string c1;
            using (new FileStream(held, FileMode.Open, FileAccess.Read, FileShare.Read))
                c1 = OwnGame.CleanSteamCopy(s.Cfg);
            Yes(n + "a file held open is not forced, the note is not written, and the log says it tries again",
                File.Exists(held) && !File.Exists(Cleaned) && c1 != null && c1.IndexOf("tries again the next time it starts", StringComparison.Ordinal) >= 0);
            string c2 = OwnGame.CleanSteamCopy(s.Cfg);
            Yes(n + "the next start takes it out and writes the note", !File.Exists(held) && File.Exists(Cleaned) && c2 != null);
            Yes(n + "a third start does nothing", OwnGame.CleanSteamCopy(s.Cfg) == null);
            string all = (c1 ?? "") + " " + (c2 ?? "");
            Yes(n + "the log says what came out", all.IndexOf("of Thornswood's own files out of the Steam copy", StringComparison.Ordinal) >= 0 && Clean(all));

            var pre = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string line in File.ReadAllLines(Path.Combine(s.Dir, "steam-before.txt")))
            {
                string[] p = line.Split('|');
                pre[p[0]] = p[1] + "|" + p[2];
            }
            var now = Snap(s.Game);
            var extra = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
                "Data\\TsOne.esp", "Data\\textures\\ts\\wood.dds", "Data\\SKSE\\Plugins\\versionlib-1-6-1170-0.bin", "Data\\vortex.deployment.json",
                "Data\\Platform\\UI\\index.html", "Data\\Platform\\Plugins\\other-server.js", "Data\\MyLater.esp",
                "Data\\Platform\\Plugins\\skymp5-client-settings.txt" };
            bool back = true;
            foreach (KeyValuePair<string, string> kv in pre)
            {
                string v;
                if (!now.TryGetValue(kv.Key, out v) || !v.StartsWith(kv.Value + "|")) { back = false; Console.WriteLine("      not as before: " + kv.Key); }
            }
            foreach (string k in now.Keys)
                if (!pre.ContainsKey(k) && !extra.Contains(k)) { back = false; Console.WriteLine("      still in the Steam copy: " + k); }
            Yes(n + "the Steam copy is Skyrim and the person's own mods again: every file it had before the installer, as it was, and nothing of Thornswood's", back);
            Yes(n + "the person's mods put in later, Vortex's files and another server's plugin are all still there",
                Text(Path.Combine(s.Game, "Data\\MyLater.esp")) == "MINE-LATER" && Text(Path.Combine(s.Game, "Data\\Platform\\Plugins\\other-server.js")) == "OTHER-PLUGIN" &&
                Id(Path.Combine(s.Game, "Data\\TsOne.esp")) == Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")));
            Yes(n + "another server's page at a path Thornswood also writes stays, and the log says why",
                Text(Path.Combine(s.Game, "Data\\Platform\\UI\\index.html")) == "OTHER-INDEX" &&
                all.IndexOf("Data\\Platform\\UI\\index.html (other SkyMP servers write this file too", StringComparison.Ordinal) >= 0);
            Yes(n + "the client runtime with Thornswood's recorded bytes is gone from the Steam copy",
                !File.Exists(Path.Combine(s.Game, "Data\\SKSE\\Plugins\\MpClientPlugin.dll")) && !File.Exists(Path.Combine(s.Game, "Data\\Platform\\Plugins\\skymp5-client.js")));
            Yes(n + "the client settings file every SkyMP server shares stays", File.Exists(Path.Combine(s.Game, "Data\\Platform\\Plugins\\skymp5-client-settings.txt")));
            Yes(n + "folders that held only Thornswood's files are gone", !Directory.Exists(Path.Combine(s.Game, "Data\\textures\\thornswood")));
            Yes(n + "the installer's list is empty now, so Uninstall has nothing left to look for there", !File.Exists(list));
            long bytes; int count;
            Uninstall.OurGameFiles(s.Cfg, out bytes, out count);
            Yes(n + "and Uninstall counts none", count == 0);
            Yes(n + "Thornswood's own folder keeps every one of its files",
                Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-front.js")) == "TS-FRONT" &&
                Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-pack1.js")) == "PACK-JS pack1" &&
                Text(Path.Combine(own, "Data\\Thornswood-Content.esp")) == "TS-CONTENT");

            // The folder made before #1232 refreshes once, after the clean up
            // emptied the installer's list.
            var steamNow = Snap(s.Game);
            Yes(n + "made before, the folder asks to refresh once", OwnGame.NeedsRefresh(s.Cfg));
            string refreshed = null;
            try { refreshed = OwnGame.Refresh(s.Cfg, delegate(string m) { Say(s, m); }); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes(n + "made before, the refresh takes the hand placed mods out of Thornswood's folder and says which",
                refreshed != null && NoneIn(own, Hand) && refreshed.IndexOf("Took 3 files out of Thornswood's folder", StringComparison.Ordinal) >= 0 &&
                refreshed.IndexOf("Data\\MyOwn.esp", StringComparison.Ordinal) >= 0 && Clean(refreshed));
            Yes(n + "made before, the Steam copy keeps them, untouched", Same(steamNow, Snap(s.Game)) && AllIn(s.Game, Hand));
            Yes(n + "made before, the installer's files stay, known from the list the clean up kept, though the installer's own list is gone",
                !File.Exists(list) && Text(Path.Combine(own, "Data\\Thornswood-Content.esp")) == "TS-CONTENT" &&
                Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-front.js")) == "TS-FRONT" &&
                Text(Path.Combine(own, "Data\\textures\\thornswood\\banner.dds")) == "TS-BANNER");
            Yes(n + "made before, and the pack's, Thornswood.ini and the client settings", Text(Path.Combine(own, "Data\\Platform\\Plugins\\thornswood-pack1.js")) == "PACK-JS pack1" &&
                File.Exists(Path.Combine(own, "Data\\SKSE\\Plugins\\Thornswood.ini")) && File.Exists(Path.Combine(own, "Data\\Platform\\Plugins\\skymp5-client-settings.txt")));
            Yes(n + "made before, Skyrim's own and Vortex's stay", Text(Path.Combine(own, "SkyrimSE.exe")) == "PIN-EXE" && Text(Path.Combine(own, "Data\\Skyrim.esm")) == "PIN-MASTER" &&
                Id(Path.Combine(own, "Data\\TsOne.esp")) == Id(Path.Combine(s.Staging, "ModA\\TsOne.esp")));
            string relabelled = File.ReadAllText(Path.Combine(OwnGame.Dir, "files.txt"));
            Yes(n + "made before, the record now says Thornswood's (T) for the installer's files and Skyrim's (O) for the game",
                System.Text.RegularExpressions.Regex.IsMatch(relabelled, @"\|T\|\d+\|\d+\|Data\\Thornswood-Content\.esp") &&
                System.Text.RegularExpressions.Regex.IsMatch(relabelled, @"\|O\|4096\|\d+\|SkyrimSE\.exe") && relabelled.IndexOf("MyOwn", StringComparison.Ordinal) < 0);
            Yes(n + "made before, and it does not ask again", !OwnGame.NeedsRefresh(s.Cfg));

            // The machine that ships: the release's own files came from its
            // own folder, so the release's file list (Sync.cs) is their only
            // record. An install a launcher from before #1232 synced has not
            // kept that list, and nothing is taken out until it has.
            string shipped = "Data\\meshes\\thornswood\\shipped.nif";
            Put(Path.Combine(own, shipped), "TS-SHIPPED");
            Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(own, Hand[0])));
            CreateHardLink(Path.Combine(own, Hand[0]), Path.Combine(s.Game, Hand[0]), IntPtr.Zero);
            var again = new List<string>(File.ReadAllLines(Path.Combine(OwnGame.Dir, "files.txt")));
            again.Add("C|O|10|1|" + shipped);
            again.Add("L|O|8|1|" + Hand[0]);
            File.WriteAllLines(Path.Combine(OwnGame.Dir, "files.txt"), again.ToArray());
            var made12 = new List<string>();
            foreach (string l in File.ReadAllLines(madeTxt)) if (!l.StartsWith("kinds=")) made12.Add(l.StartsWith("rules=") ? "rules=12" : l);
            File.WriteAllLines(madeTxt, made12.ToArray());
            string sha = new string('a', 64);
            File.WriteAllText(Path.Combine(Paths.ProfileDir, "release.txt"), "synced " + sha + " 20260929-0000\r\n");
            Yes(n + "synced by an older launcher: the release's file list is not known yet", !Updater.ReleaseFilesKnown());
            steamNow = Snap(s.Game);
            string waited = null;
            try { waited = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes(n + "synced by an older launcher: the refresh takes nothing out without the release's list, and says it waits for it",
                waited != null && File.Exists(Path.Combine(own, Hand[0])) && Text(Path.Combine(own, shipped)) == "TS-SHIPPED" &&
                waited.IndexOf("checked this install against its release", StringComparison.Ordinal) >= 0 && Clean(waited));
            Yes(n + "synced by an older launcher: and does not ask again until the list is here", !OwnGame.NeedsRefresh(s.Cfg));

            // The check against the release keeps its list (Sync.cs).
            File.WriteAllText(Path.Combine(Paths.ProfileDir, "release-files.txt"), "release " + sha + " 20260929-0000\r\n" + shipped + "\r\n");
            Yes(n + "with the release's list kept, the folder asks to refresh", Updater.ReleaseFilesKnown() && OwnGame.NeedsRefresh(s.Cfg));
            string sorted = null;
            try { sorted = OwnGame.Refresh(s.Cfg, null); } catch (Exception ex) { Console.WriteLine("      Refresh said: " + ex.Message); }
            Yes(n + "with the release's list kept, the hand placed mod comes out and the release's own file stays, as Thornswood's (T)",
                sorted != null && !File.Exists(Path.Combine(own, Hand[0])) && Text(Path.Combine(own, shipped)) == "TS-SHIPPED" &&
                System.Text.RegularExpressions.Regex.IsMatch(File.ReadAllText(Path.Combine(OwnGame.Dir, "files.txt")), @"\|T\|10\|1\|Data\\meshes\\thornswood\\shipped\.nif"));
            Yes(n + "with the release's list kept, the Steam copy was not touched and nothing more is asked", Same(steamNow, Snap(s.Game)) && AllIn(s.Game, Hand) && !OwnGame.NeedsRefresh(s.Cfg));

            // Installed again without the tick: the setup moves the folder
            // aside and puts Thornswood's files into the Steam copy with its
            // list. The folder made again has the Steam copy looked at again.
            Directory.Move(own, own + "-old");
            Put(Path.Combine(s.Game, "Data\\Thornswood-Content.esp"), "TS-CONTENT-2");
            File.WriteAllText(list, "Data\\Thornswood-Content.esp\r\n");
            Start(s);
            Yes(n + "installed again without the tick, the launcher is back on the Steam copy", Paths.Collection && !Paths.OwnFirst);
            OwnGame.Make(s.Cfg, null);
            Start(s);
            string c4 = OwnGame.CleanSteamCopy(s.Cfg);
            Yes(n + "and once the folder is made again the next start takes them out again",
                c4 != null && !File.Exists(Path.Combine(s.Game, "Data\\Thornswood-Content.esp")) &&
                Text(Path.Combine(OwnGame.Folder, "Data\\Thornswood-Content.esp")) == "TS-CONTENT-2" && File.Exists(Cleaned));
        }
    }
}
'@

# The pretend Steam copy's own files, as records\skyrim-files.json lists the
# real build's (#1232): what OwnGame takes as Skyrim's own.
$skyrimList = Join-Path $T 'skyrim-files.json'
$listed = @('SkyrimSE.exe', 'bink2w64.dll', 'Data\Skyrim.esm', 'Data\Skyrim - Textures0.bsa') |
    ForEach-Object { '    "{0}": {{ "bytes": 1, "sha1": "0", "depot": "1" }}' -f $_.Replace('\', '\\') }
Put $skyrimList ("{`n  ""build"": ""1.6.1170"",`n  ""files"": {`n" + ($listed -join ",`n") + "`n  }`n}`n")
# The whole launcher, with the Thornswood.ini template and the pretend
# client's record embedded where the project embeds the real ones.
$exe = $null
try {
    $exe = Build-LauncherCode -Launcher -Exe -Main 'Thornswood.OwnFolderFirstTest' -Source $driver -Resource @{
        'Thornswood.ini' = (Join-Path $Repo 'launcher\Thornswood.ini')
        'client-build.json' = $clientRecord
        'skyrim-files.json' = $skyrimList
        'ui-gone.json' = (Join-Path $Repo 'records\ui-gone.json')
    }
} catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the driver build with the .NET SDK the launcher builds with' ($null -ne $exe)
if (-not $exe) { Done }

# ---- the package, as Velopack puts it beside the launcher ----------------------
# Thornswood's own game files under Game (InstallSteps.PackageGame), which is
# what the setup window's payload folder was until #4824.
function New-Package([string]$dir) {
    $null = New-Item -ItemType Directory -Force -Path $dir
    Put (Join-Path $dir 'profile\plugins.txt') "# Automatically generated by Vortex`r`n*TsOne.esp`r`n"
    $pay = Join-Path $dir 'Game'
    $null = New-Item -ItemType Directory -Force -Path $pay
    Copy-Item -Recurse -Path (Join-Path $clientDir '*') -Destination $pay -Force
    Put (Join-Path $pay 'Data\Platform\Plugins\thornswood-front.js') 'TS-FRONT'
    Put (Join-Path $pay 'Data\Platform\UI\index.html') 'TS-INDEX'
    Put (Join-Path $pay 'Data\Platform\UI\thornswood-chat.js') 'TS-CHAT'
    Put (Join-Path $pay 'Data\Thornswood-Content.esp') 'TS-CONTENT'
    Put (Join-Path $pay 'Data\textures\thornswood\banner.dds') 'TS-BANNER'
}

# ---- a pretend Steam with Skyrim in it ----------------------------------------
function New-Steam([string]$dir, [bool]$newer) {
    $steam = Join-Path $dir 'steam'
    Put (Join-Path $steam 'config\libraryfolders.vdf') ("""libraryfolders""`n{`n`t""0""`n`t{`n`t`t""path""`t`t""" + $steam.Replace('\', '\\') + """`n`t}`n}`n")
    $game = Join-Path $steam 'steamapps\common\Skyrim Special Edition'
    if ($newer) { PutBytes (Join-Path $game 'SkyrimSE.exe') 'NEW-EXE' 5000; Put (Join-Path $game 'Data\Skyrim.esm') 'NEW-MASTER' }
    else { PutBytes (Join-Path $game 'SkyrimSE.exe') 'PIN-EXE' 4096; Put (Join-Path $game 'Data\Skyrim.esm') 'PIN-MASTER' }
    PutBytes (Join-Path $game 'Data\Skyrim - Textures0.bsa') 'PIN-TEX0' 65536
    Put (Join-Path $game 'bink2w64.dll') 'GAME-BINK'
    # The person's own mods, put in by hand: theirs, whatever Thornswood does,
    # and never part of Thornswood's own folder (#1232).
    Put (Join-Path $game 'Data\MyOwn.esp') 'MINE-ESP'
    Put (Join-Path $game 'Data\meshes\mine\sword.nif') 'MINE-NIF'
    Put (Join-Path $game 'Data\SKSE\Plugins\MyOwnPlugin.dll') 'MINE-SKSE'
    return $game
}

# The install, run by the program built above. No real Skyrim is ever closed:
# InstallSteps looks only at the folders it is given.
function Install([string]$name, [bool]$own, [bool]$newer) {
    $dir = Join-Path $T $name
    $game = New-Steam $dir $newer
    $package = Join-Path $dir 'package'
    New-Package $package
    $root = Join-Path $dir 'Thornswood'
    # The install window writes this when the four boxes are ticked, before
    # it runs the steps (InstallAgreements.cs).
    Put (Join-Path $root 'Profile\accepted.json') '{ "accepted": "2026-09-29T00:00:00Z" }'
    $local = Join-Path $dir 'windows\LocalAppData'
    Put (Join-Path $local 'Skyrim Special Edition\plugins.txt') "*TsOne.esp`r`n"
    $before = Snap $game
    $pre = @{}
    foreach ($k in $before.Keys) { $pre[$k] = $before[$k] }
    [IO.File]::WriteAllLines((Join-Path $dir 'steam-before.txt'), [string[]]@($before.Keys | Sort-Object | ForEach-Object { $_ + '|' + ($before[$_] -split '\|')[0] + '|' + ($before[$_] -split '\|')[1] }))
    # The load order check reads this PC's own AppData. Off Windows that is
    # $XDG_DATA_HOME, pointed at the pretend one; Windows answers its own
    # folder whatever the environment says, so there it may be this PC's.
    $oldXdg = $env:XDG_DATA_HOME
    $env:XDG_DATA_HOME = $local
    try { $out = @(Invoke-LauncherExe $exe install $root $package (Join-Path $dir 'steam') $game $(if ($own) { '1' } else { '0' }) 2>&1 | ForEach-Object { "$_" }) }
    finally { $env:XDG_DATA_HOME = $oldXdg }
    $misses = @($out | Where-Object { $_ -match '\[MISS\]' } | Where-Object { -not ($OnWindows -and $_ -match 'Load order') })
    $ran = (@($out | Where-Object { $_ -match '^install: done' }).Count -eq 1) -and $misses.Count -eq 0
    Yes "$name, installer: it ran through to its checks, and nothing it installs is missing" $ran
    if (-not $ran) { $out | Select-Object -Last 25 | ForEach-Object { Write-Host "      $_" } }
    return @{ Dir = $dir; Game = $game; Root = $root; Before = $pre; After = (Snap $game); Out = $out }
}

# ---- 1-3: the installer with Thornswood's own folder chosen --------------------
foreach ($case in @(@{ Name = 'chosen-vortex-first'; Newer = $false }, @{ Name = 'chosen-vortex-after'; Newer = $false }, @{ Name = 'chosen-downgrade'; Newer = $true })) {
    $r = Install $case.Name $true $case.Newer
    $n = $case.Name
    Yes "${n}, installer: the Steam copy is byte and time identical after it" (SameSnap $r.Before $r.After)
    $payload = Join-Path $r.Root 'Profile\Payload'
    Yes "${n}, installer: Thornswood's files are in Profile\Payload" (
        (Test-Path -LiteralPath (Join-Path $payload 'Data\Platform\Plugins\thornswood-front.js')) -and
        (Test-Path -LiteralPath (Join-Path $payload 'Data\SKSE\Plugins\MpClientPlugin.dll')) -and
        (Test-Path -LiteralPath (Join-Path $payload 'Data\Thornswood-Content.esp')))
    Yes "${n}, installer: no installed-into-game list, because nothing went into the Steam copy" (-not (Test-Path -LiteralPath (Join-Path $r.Root 'Profile\installed-into-game.txt')))
    Yes "${n}, installer: no Game folder yet, so the launcher sees the folder is still to make" (-not (Test-Path -LiteralPath (Join-Path $r.Root 'Game')))
    $cfgText = if (Test-Path -LiteralPath (Join-Path $r.Root 'config.json')) { [IO.File]::ReadAllText((Join-Path $r.Root 'config.json')) } else { '' }
    Yes "${n}, installer: config.json says MakeOwnGame, so the launcher makes it without asking" ($cfgText -match '"MakeOwnGame"\s*:\s*true')
    Yes "${n}, installer: it says up front that nothing is written into the Steam copy" (@($r.Out | Where-Object { $_ -match "own Skyrim folder is chosen, so nothing is written into" }).Count -eq 1)
}

# ---- 4: the installer with the own folder not chosen --------------------------
$r = Install 'not-chosen' $false $false
Yes 'not-chosen, installer: Thornswood''s files go into the Steam copy, as they always have' (
    (Test-Path -LiteralPath (Join-Path $r.Game 'Data\Platform\Plugins\thornswood-front.js')) -and
    (Test-Path -LiteralPath (Join-Path $r.Game 'Data\SKSE\Plugins\MpClientPlugin.dll')))
$list = Join-Path $r.Root 'Profile\installed-into-game.txt'
Yes 'not-chosen, installer: with the list of what it wrote there' (
    (Test-Path -LiteralPath $list) -and ([IO.File]::ReadAllLines($list) -contains ('Data' + [IO.Path]::DirectorySeparatorChar + 'Thornswood-Content.esp')))
Yes 'not-chosen, installer: no Profile\Payload' (-not (Test-Path -LiteralPath (Join-Path $r.Root 'Profile\Payload')))

# ---- 5: the wiring, by text ---------------------------------------------------
$shell = [IO.File]::ReadAllText((Join-Path $App 'Shell.cs'))
Yes 'Shell starts the one-time clean up at every start, off the window''s thread' ($shell -match '(?s)ThreadPool\.QueueUserWorkItem\(delegate\s*\{\s*string cleaned = null;\s*try \{ cleaned = OwnGame\.CleanSteamCopy\(cfg\); \}')
Yes 'Shell looks at Steam''s Updates setting only while there is no folder of its own' ($shell -match 'if \(SteamUpdates\.LooksAtStart\(!Paths\.Collection, Downgrade\.Needed\(cfg\)\)\) HoldSteamUpdatesOnStart\(\);')
$upd = [IO.File]::ReadAllText((Join-Path $App 'Updater.cs'))
Yes 'Updater keeps the installed-into-game list only while the Steam copy is the game' ($upd -match 'if \(!Paths\.Collection \|\| Paths\.OwnFirst \|\| rels == null')
$setters = @(Get-ChildItem (Join-Path $App '*.cs') -File | Where-Object { [IO.File]::ReadAllText($_.FullName) -match 'Paths\.Game\s*=[^=]' } | ForEach-Object { $_.Name })
Yes ('nothing in the launcher sets Paths.Game but Paths.Init (' + ($setters -join ', ') + ')') ($setters.Count -eq 0)
$paths = [IO.File]::ReadAllText((Join-Path $App 'Paths.cs'))
Yes 'Paths.Init points Game at Payload when the folder was chosen and not made' ($paths -match 'Game\s+= !Collection \? own : OwnFirst \? Payload : steam;')
$ownSrc = [IO.File]::ReadAllText((Join-Path $App 'OwnGame.cs'))
Yes 'a folder is not made while an install an older launcher synced has not kept its release''s file list (#1232)' ($ownSrc -match '(?s)if \(!made\)\s*\{.*?if \(!OursKnown\(\)\)\s*return "Thornswood is checking this install against its release first')
$syncSrc = [IO.File]::ReadAllText((Join-Path $App 'Sync.cs'))
Yes 'a sync keeps the release''s file list before it says it is on that release, and an install without the list is checked once more (#1232)' (
    ($syncSrc -match '(?s)WriteReleaseFiles\(r, listed\);\s*(SyncState )?state = ReadSyncState\(\);\s*state\.Synced = r\.sha256;') -and
    ($syncSrc -match 'if \(\(s\.Synced == r\.sha256 && ReleaseFilesSha\(\) == r\.sha256\) \|\| s\.PacksOnly == r\.sha256\) return null;'))
$steps = [IO.File]::ReadAllText((Join-Path $App 'InstallSteps.cs'))
Yes 'the install writes the installed-into-game list only when the Steam copy is used' ($steps -match 'void RecordIntoGame\(List<string> files\)\s*\{\s*if \(ownFirst \|\| madeOwn \|\| files\.Count == 0\) return;')


# ---- the launcher, run with its driver, on Windows only --------------------------
# It lays out the game folder by Windows paths and links with kernel32.
if (-not $OnWindows) {
    Write-Host 'SKIP  1 to 4 and 6 to 7, the launcher driven on those installs: it lays out the game folder by Windows paths and links with kernel32, so it runs on Windows only'
    try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
    Done
}
$out = Invoke-LauncherExe $exe $T 2>&1 | ForEach-Object { "$_" }
foreach ($l in $out) {
    if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
    elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
    elseif ($l -match '^driver: ') { }
    else { Write-Host $l }
}
Yes 'the driver ran and reported' (@($out | Where-Object { $_ -match '^driver: ' }).Count -eq 1)

try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
Done
