<#
  test-2627-scan-fix.ps1

  #2627. Scan and Fix on Diagnostics find everything wrong and fix everything
  that can be foreseen, then scan again and say what is still wrong and why.
  Patrick, 16 Oct, with a screenshot of Fix failing on his dev install: Scan
  found the light order wrong at light position 54 ("you have nothing there,
  the server has Thornswood-Last.esp") and Thornswood-Content.esp differing;
  Fix fetched the content plugin, left the order alone because the build's
  list did not enable Thornswood-Last.esp, and logged "Fix put 3 things right"
  with the blocker still there.

  What this holds, against the real launcher code:

    1. Patrick's case. A server whose light order names Thornswood-Last.esp,
       ours and light (the manifest's served list), and a machine without it
       whose content plugin differs. Scan finds both; Fix puts in both from
       the release (#3386: by the sha256 its record gives them, never from
       the server, which serves no plugin file), writes them only when they
       are the copies the server's manifest describes, puts
       Thornswood-Last.esp into the plugin list in the server's place, and
       the scan after it finds nothing.
    2. The server's order naming a plugin that is not ours and that the list
       does not enable: the order is left alone, and the reason says only an
       update or Vortex can bring it.
    3. #2403. With no folder of its own the scan says one thing, the folder,
       and Fix writes nothing into the Steam copy: not a Creation Club plugin
       moved, not a plugin fetched, while it says the folder is made next.
    4. The rest of the install (Upkeep): this build's own files changed or
       missing (a kept file another server changed, Thornswood.ini, a shipped
       settings file), Windows' Skyrim folders left pointed at Thornswood,
       Vortex's files the own folder lost, Skyrim's own files it lost, and a
       newer launcher waiting on the feed. Scan finds each as its own issue
       with what Fix does; Fix's steps that write files put the first four
       right, and the scan after finds none of them.
    5. By the source: Fix is the button, it refuses while the own folder is
       being prepared (#2403), brings the folder up to date from Vortex
       before anything else and takes the update last, rescans, never says
       how many things it did, and the Fix button is on exactly when there is
       something it can fix. Diagnostics keeps the icon refresh and has no
       Repair, Restore or Bring it up to date button any more.
    6. #2856. A Skyrim whose path cannot be read, which is every process of
       another Windows account, counts as ours only while this build's own
       file of that name is running, told from the folder's side. The build
       runners on the box are eight accounts, and another runner's stand-in
       SkyrimSE.exe made case 4 see a running game. The stand-in here has a
       name of its own, so no other build can see it as a game.
    7. #3201. One press of Install now does the whole update: the card's
       button and Settings' are one handler, the automatic update is the
       same press, the update is followed by Fix's whole path (scan, put
       right, scan again), which never takes the update it just tried a
       second time, and the first start of a new launcher (Velopack's
       Velo.Restarted, the start right after an update went in) runs that Fix.
       By the source, in the wiring section.

  HOW. The whole launcher is built with a driver into one program, the way
  the project builds (the .NET 10 SDK, Launcher-Csc.ps1), with a stand-in for
  the list of Skyrim's own files. It builds everywhere and runs on Windows:
  the scan and Fix read Windows paths and Windows' Skyrim folders. The
  server, and the site the release's files are on, are a plain HTTP listener
  on this machine's loopback address, in the driver; the release is read
  through Updater.ReleaseCopyAt, past the https check ReleaseCopy makes,
  which launcher\tests\test-1180-own-plugins.js holds by its text. Paths, Steam and the Windows folders all point into a scratch
  folder; nothing outside it is written. Steam is never started and no
  shortcut is touched: the driver hands Fix's steps only the issues it means.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # builds launcher code the way the project does (#498, #4823)
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

# ---- 5: the wiring, by text, first, since it needs no compiler ---------------------------------------------------
# Line ends as git checked them out: CRLF on a runner, LF in some worktrees.
# The patterns below are written with LF.
function Src([string]$path) { [IO.File]::ReadAllText($path) -replace "`r`n", "`n" }
$shell = Src (Join-Path $App 'Shell.cs')
$sf = Src (Join-Path $App 'ShellScanFix.cs')
$own = Src (Join-Path $App 'ShellOwnGame.cs')
$upd = Src (Join-Path $App 'ShellUpdate.cs')
$xaml = Src (Join-Path $App 'MainWindow.axaml')
$upkeep = Src (Join-Path $App 'Upkeep.cs')
$checks = Src (Join-Path $App 'Checks.cs')

Yes 'the Scan button asks everything, and the Fix button is RunFix' (
    $shell.Contains('btnScan.Click += delegate { RunScan(true); };') -and $shell.Contains('btnFix.Click += delegate { RunFix(); };'))
$runFix = [regex]::Match($sf, '(?s)static void RunFix\(bool afterUpdate, bool afterVortex = false\)(.*?)\n        \}\n').Groups[1].Value
Yes 'Fix refuses while the own folder is being prepared, so it never writes into a folder that is being made (#2403)' (
    $runFix -match 'if \(ownGameBusy\) \{ Log\(' -and $runFix.IndexOf('if (ownGameBusy)') -lt $runFix.IndexOf('fixing = true;'))
Yes 'and while the Downgrade or an update is going in' ($runFix -match 'if \(Downgrade\.Busy\)' -and $runFix -match 'if \(playBar\.Active\)')
Yes 'Fix scans first, then brings the folder up to date from Vortex before anything else, carrying on either way' (
    $runFix -match 'Upkeep\.Look\(cfg, true, null, out feed\)' -and
    $runFix -match 'Has\(rest, IssueKind\.Behind\) &&\s*StartOwnGame\(false, true, delegate \{ FixRest\(known, afterUpdate, afterVortex\); \}, delegate \{ FixRest\(known, afterUpdate, afterVortex\); \}\)')
$fixRest = [regex]::Match($sf, '(?s)static void FixRest\(VersionDoc feed, bool afterUpdate, bool afterVortex\)(.*?)\n        \}\n').Groups[1].Value
$disk = $fixRest.IndexOf('Upkeep.FixOnDisk(')
$rescan = $fixRest.IndexOf('List<Issue> plugins = Rescan(feed);')
$report = $fixRest.IndexOf('Report(plugins);')
$update = $fixRest.IndexOf('RunUpdate(delegate')
$down = $fixRest.LastIndexOf('RunDowngrade();')
Yes 'then the steps that write files, then a scan, then the report, then the update, then the Downgrade' (
    $disk -gt 0 -and $rescan -gt $disk -and $report -gt $rescan -and $update -gt $report -and $down -gt $update)
Yes 'the own folder, made after asking, comes before the update' ($fixRest.IndexOf('if (Verify.OwnFolderNext) { AskOwnGame(false); return; }') -gt $report -and $fixRest.IndexOf('if (Verify.OwnFolderNext)') -lt $update)
# Comments quote the old line on purpose; only the code is read here.
$sfCode = ($sf -split "`n" | Where-Object { $_ -notmatch '^\s*//' }) -join "`n"
$shellCode = ($shell -split "`n" | Where-Object { $_ -notmatch '^\s*//' }) -join "`n"
Yes 'Fix never says how many things it put right' (-not ($sfCode -match 'Fix put \d|put " \+ n \+') -and -not ($shellCode -match '"Fix put " \+'))
Yes 'and says only what is still wrong, with what will put it right, after it' (
    $sf -match 'Fix is done\. Still wrong, and what will put it right:' -and $sf -match 'Fix could not put this right\. " \+ i\.WhatWill')
Yes 'the Fix button is on exactly when there is something Fix can do' ($sf.Contains('btnFix.IsEnabled = canFix > 0 && !fixing;'))
Yes 'a log line that blocks Play keeps the words the site reads' ($sf.Contains('(i.Blocking ? "blocks Play: " : "worth knowing: ")'))
Yes 'the bring-up-to-date tells Fix when it fails, so Fix carries on' ($own -match 'else if \(fail != null && failed != null\) failed\(\);')
Yes 'and the update tells Fix when it is done, or failed, so Fix scans again' (
    $upd.Contains('if (after != null) after(true);') -and $upd.Contains('if (after != null) after(false);'))

# #3201: one press of Install now does the whole update. Both buttons are one
# handler, the automatic update is the same press, the update is followed by
# Fix's whole path, which never takes the update it just tried again, and the
# first start of a new launcher runs that same Fix.
Yes 'Install now, on the card above Play and in Settings, is one handler (#3201)' (
    $shell.Contains('btnUpdate.Click += delegate { InstallNowPressed(); };') -and $shell.Contains('btnInstallNow.Click += delegate { InstallNowPressed(); };'))
Yes 'which opens the collection while the card is about the mods, and is UpdateNow otherwise' (
    $upd -match '(?s)static void InstallNowPressed\(\)\s*\{\s*if \(collectionBarUp \|\| \(collectionNoteUp && !updatePending\)\).*?UpdateNow\(\);')
Yes 'both buttons say the same thing, so the card never says Install now over a card about the mods' (
    -not ($shellCode -match 'btnInstallNow\.Content = ') -and $upd -match 'btnUpdate\.Content = text;')
# Since #3202 the automatic update is UpdateBySelf, after every check, not only after the game closed for one.
Yes 'the automatic update is the same press' ($upd -match '(?s)static void UpdateBySelf\(\).*?Log\("Installing it now, because automatic updates are on \(Settings, Updates\)\."\);\s*UpdateNow\(\);')
Yes 'UpdateNow is the update, then Fix after it' ($upd -match 'static void UpdateNow\(\)\s*\{\s*RunUpdate\(FixAfterUpdate\);\s*\}')
Yes 'Fix after an update forgets the update only when it went in, and runs Fix whole' (
    $sf -match '(?s)static void FixAfterUpdate\(bool wentIn\)\s*\{\s*if \(wentIn\) Upkeep\.Forget\(IssueKind\.Update\);\s*RunFix\(true\);\s*\}')
Yes 'after an update, Fix never takes that same update a second time, whether it went in or failed' (
    $fixRest -match 'afterUpdate && updateTried != null &&\s*updateTried\.IsSupersetOf\(UpdateParts\(pendingPacks, feed, selfUpdateOffered\)\)' -and
    $fixRest.IndexOf('updateTried.IsSupersetOf') -lt $fixRest.IndexOf('RunUpdate(delegate'))
Yes 'and the update records what it tried both ways' (([regex]::Matches($upd, 'updateTried = UpdateParts\(packs, doc, withLauncher\);')).Count -eq 2)
Yes 'a folder being prepared holds Fix after an update until it is ready, and its finish runs it' (
    $runFix -match 'if \(ownGameBusy && afterUpdate\) \{ fixWhenFolderReady = true;' -and
    $own -match '(?s)if \(fixWhenFolderReady\)\s*\{\s*fixWhenFolderReady = false;\s*(if \(fixWhenFolderReadyAfterVortex\) \{ fixWhenFolderReadyAfterVortex = false; RunFix\(false, true\); \}\s*else )?RunFix\(true\);')
Yes 'the first start of a new launcher runs that Fix, after the icon pass, in a folder of its own' (
    $shell -match '(?s)if \(Velo\.Restarted\)\s*ThreadPool\.QueueUserWorkItem\(delegate\s*\{.*?moved = Icons\.Ensure\(true\);.*?if \(!Paths\.Collection\)\s*try \{ Dispatcher\.UIThread\.Post\(\(Action\)delegate \{ RunFix\(true\); \}\);')
Yes 'Fix writes into the game folder with the folder to itself (OwnGame.Alone)' ($upkeep -match '(?s)OwnGame\.Alone\(delegate\s*\{.*?Verify\.Fix\(cfg, say, Updater\.ReleaseCopy\(cfg, v\)\).*?\}, delegate')
Yes 'a game whose path cannot be read counts as ours only while our own file of that name runs (#2856)' (
    $checks -match '\(at == null && !OwnImageRunning\(n\)\)\) skip = true;')
Yes 'Diagnostics keeps the icon refresh, which Scan cannot see' ($xaml -match 'x:Name="BtnIcons"')
Yes 'and has no Repair, Restore or Bring it up to date button, which Fix does now' (
    $xaml -notmatch 'x:Name="BtnRepair"' -and $xaml -notmatch 'x:Name="BtnRestore"' -and $xaml -notmatch 'x:Name="BtnOwnGameRefresh"')

# 1 to 4 build the whole launcher and a driver the way the project builds, and
# run them on Windows.
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$T = Join-Path $Scratch ('scan-fix-2627-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $T

$driver = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Thornswood
{
    static class ScanFixTest
    {
        static int pass, fail;
        static void Yes(string what, bool cond)
        {
            Console.WriteLine((cond ? "PASS  " : "FAIL  ") + what);
            if (cond) pass++; else fail++;
        }

        static string T;

        static void Put(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text, new UTF8Encoding(false));
        }

        /// <summary>A plugin file with a TES4 header, light or not, and a mark that makes its bytes its own.</summary>
        static byte[] PluginBytes(bool light, string mark)
        {
            var b = new List<byte>(Encoding.ASCII.GetBytes("TES4"));
            b.AddRange(BitConverter.GetBytes((uint)32));
            b.AddRange(BitConverter.GetBytes(light ? (uint)0x200 : 0u));
            b.AddRange(Encoding.ASCII.GetBytes(mark.PadRight(32, '.')));
            return b.ToArray();
        }

        static void Plugin(string path, bool light, string mark)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, PluginBytes(light, mark));
        }

        static string Text(string path) { try { return File.ReadAllText(path); } catch { return null; } }

        static uint[] table;
        static int Crc(byte[] data)
        {
            if (table == null)
            {
                table = new uint[256];
                for (uint i = 0; i < 256; i++) { uint c = i; for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; table[i] = c; }
            }
            uint crc = 0xFFFFFFFFu;
            foreach (byte x in data) crc = table[(crc ^ x) & 0xFF] ^ (crc >> 8);
            return (int)(crc ^ 0xFFFFFFFFu);
        }

        static Dictionary<string, string> Snap(string dir)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!Directory.Exists(dir)) return d;
            using (var sha = SHA256.Create())
                foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                    d[f.Substring(dir.Length)] = Convert.ToBase64String(sha.ComputeHash(File.ReadAllBytes(f))) + ":" + File.GetLastWriteTimeUtc(f).Ticks;
            return d;
        }
        static bool Same(Dictionary<string, string> a, Dictionary<string, string> b)
        {
            if (a.Count != b.Count) return false;
            foreach (var kv in a) { string v; if (!b.TryGetValue(kv.Key, out v) || v != kv.Value) return false; }
            return true;
        }

        static bool Clean(string said)
        {
            // The word, as the writing check reads it: "multiplayer client" is
            // the name of a part, not the word the house rules keep out.
            return said != null && said.IndexOf('—') < 0 &&
                !System.Text.RegularExpressions.Regex.IsMatch(said, @"\bplayers?\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        }

        static Issue Find(List<Issue> l, string kind, string has)
        {
            foreach (Issue i in l) if (i.Kind == kind && (has == null || i.Text.IndexOf(has, StringComparison.OrdinalIgnoreCase) >= 0)) return i;
            return null;
        }

        // ---- a server on this machine --------------------------------------
        //
        // The resources port of a SkyMP server, as far as the launcher asks it
        // anything: the manifest. And the site's feed assets, where a release
        // record and its files are kept by their sha256 (#3386).
        static readonly Dictionary<string, byte[]> served = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        static readonly List<string> asked = new List<string>();
        static TcpListener listener;

        static int StartServer()
        {
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var t = new Thread(delegate ()
            {
                while (true)
                {
                    TcpClient c;
                    try { c = listener.AcceptTcpClient(); } catch { return; }
                    try
                    {
                        using (c)
                        using (NetworkStream s = c.GetStream())
                        {
                            var head = new StringBuilder();
                            int b;
                            while ((b = s.ReadByte()) >= 0)
                            {
                                head.Append((char)b);
                                if (head.Length >= 4 && head.ToString().EndsWith("\r\n\r\n")) break;
                            }
                            string first = head.ToString().Split('\n')[0];
                            string[] w = first.Split(' ');
                            string path = w.Length > 1 ? w[1] : "";
                            lock (asked) asked.Add(path);
                            byte[] body;
                            bool have;
                            lock (served) have = served.TryGetValue(path, out body);
                            string status = have ? "200 OK" : "404 Not Found";
                            if (!have) body = new byte[0];
                            byte[] h = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + "\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\n\r\n");
                            s.Write(h, 0, h.Length);
                            s.Write(body, 0, body.Length);
                        }
                    }
                    catch { /* one request at a time; a broken one is the launcher's to report */ }
                }
            });
            t.IsBackground = true;
            t.Start();
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }

        const string Base = "/api/servers/thornswood";

        static readonly string[] Five = { "Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm" };
        const string MasterNames = "\"Skyrim.esm\",\"Update.esm\",\"Dawnguard.esm\",\"HearthFires.esm\",\"Dragonborn.esm\",";

        /// <summary>Bethesda's five masters in Data, which the game loads before any list, and their manifest entries, each followed by a comma.</summary>
        static string Masters(string data)
        {
            var sb = new StringBuilder();
            foreach (string m in Five)
            {
                Plugin(Path.Combine(data, m), false, "MASTER " + m);
                sb.Append(Entry(m, File.ReadAllBytes(Path.Combine(data, m)))).Append(",");
            }
            return sb.ToString();
        }

        static string Sha(byte[] b)
        {
            using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(b)).Replace("-", "").ToLowerInvariant();
        }

        const string Assets = "/feed/assets/";

        /// <summary>
        /// A release on the stand-in site, as Publish-Update leaves one: each
        /// file under its sha256, and the record of them under its own. Fix
        /// reads it the way ReleaseCopy does, past the https check alone.
        /// </summary>
        static Func<string, byte[]> Release(int port, Dictionary<string, byte[]> files)
        {
            var rec = new StringBuilder("{\":record:files\":\"1\"");
            lock (served)
                foreach (var f in files)
                {
                    served[Assets + Sha(f.Value)] = f.Value;
                    rec.Append(",\"").Append(f.Key.Replace("\\", "\\\\")).Append("\":\"").Append(f.Value.Length).Append(":").Append(Sha(f.Value)).Append("\"");
                }
            rec.Append("}");
            byte[] recBytes = Encoding.UTF8.GetBytes(rec.ToString());
            var r = new RecordRef();
            r.sha256 = Sha(recBytes);
            r.id = "test";
            lock (served) served[Assets + r.sha256] = recBytes;
            return Updater.ReleaseCopyAt("http://127.0.0.1:" + port + Assets, r);
        }

        static bool AskedForPluginFiles()
        {
            lock (asked) foreach (string a in asked) if (a.IndexOf("/plugins/", StringComparison.Ordinal) >= 0) return true;
            return false;
        }

        static string Entry(string name, byte[] bytes)
        {
            return "{\"filename\":\"" + name + "\",\"size\":" + bytes.Length + ",\"crc32\":" + Crc(bytes) + "}";
        }

        // ---- an install with a folder of its own ---------------------------
        static Config Install(string name, int port)
        {
            string root = Path.Combine(T, name);
            Paths.Root = root;
            Paths.Game = Path.Combine(root, "Game");
            Paths.LauncherDir = Path.Combine(root, "Launcher");
            Paths.ProfileDir = Path.Combine(root, "Profile");
            Paths.MyGames = Path.Combine(Paths.ProfileDir, "MyGames");
            Paths.LocalAD = Path.Combine(Paths.ProfileDir, "LocalAppData");
            Paths.Golden = Path.Combine(Paths.ProfileDir, "Default");
            Paths.Personal = Path.Combine(root, "Your Mods");
            Paths.Isolated = Path.Combine(Paths.ProfileDir, "Isolated");
            Paths.Replaced = Path.Combine(Paths.ProfileDir, "Replaced");
            Paths.StateFile = Path.Combine(Paths.ProfileDir, "swap.json");
            Paths.PlayedFile = Path.Combine(Paths.ProfileDir, "played.flag");
            Paths.AppliedFile = Path.Combine(Paths.ProfileDir, "applied.txt");
            Paths.PacksDir = Path.Combine(Paths.ProfileDir, "Packs");
            Paths.LogFile = Path.Combine(Paths.ProfileDir, "launcher.log");
            Paths.CfgFile = Path.Combine(root, "config.json");
            Paths.WinMyGames = Path.Combine(T, name + "-windows\\My Games\\Skyrim Special Edition");
            Paths.WinLocalAD = Path.Combine(T, name + "-windows\\LocalAppData\\Skyrim Special Edition");
            Paths.Payload = Path.Combine(Paths.ProfileDir, "Payload");
            Paths.Collection = false;
            Paths.OwnFirst = false;
            Paths.Live = Paths.LocalAD;
            Paths.LiveMyGames = Paths.MyGames;
            Directory.CreateDirectory(Paths.Game);
            Directory.CreateDirectory(Paths.ProfileDir);
            var cfg = new Config();
            cfg.ServerAddress = "127.0.0.1";
            cfg.ServerPort = (port - 1).ToString();
            cfg.VortexGame = "";
            return cfg;
        }

        static Action<string> Into(List<string> said) { return delegate (string m) { lock (said) said.Add(m); }; }

        public static int Main(string[] args)
        {
            T = args[0];
            int port = StartServer();
            Yes("the stand-in server listens on this machine (port " + port + ")", port > 0);
            // A Steam of its own in the scratch folder, so nothing asks the
            // real one where Skyrim is.
            string steamRoot = Path.Combine(T, "steam");
            Directory.CreateDirectory(Path.Combine(steamRoot, "steamapps\\common"));
            Put(Path.Combine(steamRoot, "config\\libraryfolders.vdf"), "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"" + steamRoot.Replace("\\", "\\\\") + "\"\n\t}\n}\n");
            Steam.RootForTest = steamRoot;

            PatricksCase(port);
            NotOurs(port);
            NoFolderYet(port);
            TheRest(port);
            OtherAccount();

            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            try { listener.Stop(); } catch { /* the program ends here either way */ }
            return fail == 0 ? 0 : 1;
        }

        // ---- 1: Patrick's dev install, 16 Oct -------------------------------
        static void PatricksCase(int port)
        {
            Config cfg = Install("patrick", port);
            string data = Path.Combine(Paths.Game, "Data");
            string masters = Masters(data);
            Plugin(Path.Combine(data, "TsOne.esp"), false, "TSONE");
            Plugin(Path.Combine(data, "Beards.esl"), true, "BEARDS");
            Plugin(Path.Combine(data, "Thornswood-Content.esp"), false, "CONTENT-OLD");
            // The build's list, from a release before Thornswood-Last.esp.
            string list = "# Automatically generated by Vortex\r\n*TsOne.esp\r\n*Beards.esl\r\n*Thornswood-Content.esp\r\n";
            Put(Path.Combine(Paths.Golden, "plugins.txt"), list);
            Put(Path.Combine(Paths.LocalAD, "plugins.txt"), list);

            byte[] content = PluginBytes(false, "CONTENT-SERVER");
            byte[] last = PluginBytes(true, "LAST-SERVER");
            byte[] one = File.ReadAllBytes(Path.Combine(data, "TsOne.esp"));
            byte[] beards = File.ReadAllBytes(Path.Combine(data, "Beards.esl"));
            lock (served)
            {
                served.Clear();
                served[Base + "/manifest.json"] = Encoding.UTF8.GetBytes(
                    "{\"versionMajor\":1,\"mods\":[" + masters + Entry("TsOne.esp", one) + "," + Entry("Thornswood-Content.esp", content) + "]," +
                    "\"light\":[" + Entry("Beards.esl", beards) + "," + Entry("Thornswood-Last.esp", last) + "]," +
                    "\"loadOrder\":[" + MasterNames + "\"TsOne.esp\",\"Beards.esl\",\"Thornswood-Content.esp\",\"Thornswood-Last.esp\"]," +
                    "\"served\":[\"Thornswood-Content.esp\",\"Thornswood-Last.esp\"]}");
            }
            // The release carries both of ours (#3386), and another file of
            // ours that is not a plugin, which Fix never takes.
            var releaseFiles = new Dictionary<string, byte[]>();
            releaseFiles["Data\\Thornswood-Content.esp"] = content;
            releaseFiles["Data\\Thornswood-Last.esp"] = last;
            releaseFiles["Data\\Scripts\\MpClientPlugin.pex"] = Encoding.ASCII.GetBytes("PEX");
            Func<string, byte[]> release = Release(port, releaseFiles);

            List<Issue> scan = Verify.Run(cfg);
            Show(scan);
            Issue order = Find(scan, IssueKind.Plugins, "light position");
            Issue bytes = Find(scan, IssueKind.Plugins, "Thornswood-Content.esp is not the same file");
            Yes("Scan finds the light order the server has Thornswood-Last.esp in, as on Patrick's install",
                order != null && order.Text.IndexOf("the server has Thornswood-Last.esp", StringComparison.Ordinal) >= 0 && order.Blocking);
            Yes("and the content plugin that differs", bytes != null && bytes.Blocking && bytes.Served);
            Yes("both are Fixable, and say what Fix does", order != null && order.Fixable && bytes != null && bytes.Fixable &&
                order.Text.IndexOf("Fix ", StringComparison.Ordinal) >= 0 && bytes.Text.IndexOf("Fix puts in the release's copy.", StringComparison.Ordinal) >= 0);
            Yes("each carries the problem alone and what will put it right, in the house words",
                order != null && order.Problem.IndexOf("Fix", StringComparison.Ordinal) < 0 && !string.IsNullOrEmpty(order.WhatWill) && Clean(order.Text) && Clean(order.WhatWill));

            var said = new List<string>();
            int did = Verify.Fix(cfg, Into(said), release);
            string live = Text(Path.Combine(Paths.LocalAD, "plugins.txt"));
            byte[] gotContent = File.Exists(Path.Combine(data, "Thornswood-Content.esp")) ? File.ReadAllBytes(Path.Combine(data, "Thornswood-Content.esp")) : null;
            byte[] gotLast = File.Exists(Path.Combine(data, "Thornswood-Last.esp")) ? File.ReadAllBytes(Path.Combine(data, "Thornswood-Last.esp")) : null;
            Yes("Fix puts in the release's content plugin, the server's", gotContent != null && Convert.ToBase64String(gotContent) == Convert.ToBase64String(content));
            Yes("and Thornswood-Last.esp, from the release by its sha256",
                gotLast != null && Convert.ToBase64String(gotLast) == Convert.ToBase64String(last) && asked.Contains(Assets + Sha(last)));
            Yes("and asks the game server for no plugin file (#3386)", !AskedForPluginFiles());
            Yes("and switches Thornswood-Last.esp on in the server's place, last in the list", live != null &&
                live.IndexOf("*Thornswood-Content.esp\r\n*Thornswood-Last.esp", StringComparison.Ordinal) >= 0);
            bool leftAlone = false;
            foreach (string m in said) if (m.IndexOf("left alone", StringComparison.Ordinal) >= 0) leftAlone = true;
            Yes("and never says the order was left alone", !leftAlone);
            bool told = false;
            foreach (string m in said) if (m.IndexOf("Thornswood-Last.esp is ours", StringComparison.Ordinal) >= 0 && Clean(m)) told = true;
            Yes("it says Thornswood-Last.esp is ours and was switched on in the server's place", told);
            Yes("the shipped list is not touched; the next release carries it", Text(Path.Combine(Paths.Golden, "plugins.txt")) == list);

            List<Issue> after = Verify.Run(cfg);
            Show(after);
            Yes("the scan after Fix finds nothing (" + after.Count + ")", after.Count == 0);

            // A release whose copy is not the one the server runs (a server
            // a deploy took ahead of the last release): nothing is written,
            // and the line says why.
            Plugin(Path.Combine(data, "Thornswood-Content.esp"), false, "CONTENT-OLD-AGAIN");
            File.Delete(Path.Combine(data, "Thornswood-Last.esp"));
            var older = new Dictionary<string, byte[]>(releaseFiles);
            older["Data\\Thornswood-Last.esp"] = PluginBytes(true, "SOMETHING-ELSE");
            said.Clear();
            Verify.Fix(cfg, Into(said), Release(port, older));
            bool refused = false;
            foreach (string m in said) if (m.IndexOf("Thornswood-Last.esp: the release's copy is not the one the server runs", StringComparison.Ordinal) >= 0 && Clean(m)) refused = true;
            Yes("a light plugin whose release copy is not the server's is refused, and said", refused && !File.Exists(Path.Combine(data, "Thornswood-Last.esp")));
            List<Issue> still = Verify.Run(cfg);
            Issue stillOrder = Find(still, IssueKind.Plugins, "light position");
            Yes("then the light order is still found, and what will put it right is the next update",
                stillOrder != null && stillOrder.WhatWill.IndexOf("does not have the copy the server runs yet", StringComparison.Ordinal) >= 0 && Clean(stillOrder.WhatWill));

            // No feed, and a release that does not ship the plugin: nothing
            // is written, and nothing is asked of the game server either.
            said.Clear();
            Verify.Fix(cfg, Into(said), null);
            bool noFeed = false;
            foreach (string m in said) if (m.IndexOf("Thornswood-Last.esp: the update feed could not be read", StringComparison.Ordinal) >= 0) noFeed = true;
            Yes("with no feed to read, Fix puts in nothing and says so", noFeed && !File.Exists(Path.Combine(data, "Thornswood-Last.esp")));
            var without = new Dictionary<string, byte[]>(releaseFiles);
            without.Remove("Data\\Thornswood-Last.esp");
            said.Clear();
            Verify.Fix(cfg, Into(said), Release(port, without));
            bool notShipped = false;
            foreach (string m in said) if (m.IndexOf("Thornswood-Last.esp: the release the update feed names does not ship it", StringComparison.Ordinal) >= 0) notShipped = true;
            Yes("with a release that does not ship it, the same", notShipped && !File.Exists(Path.Combine(data, "Thornswood-Last.esp")));
            Yes("and the game server was never asked for a plugin file", !AskedForPluginFiles());

            // The release is asked only for a plugin of ours by its bare
            // name: the name comes from the game server's manifest.
            Yes("the release reader hands over no file but a plugin in Data, whatever name it is asked for",
                release("Scripts\\MpClientPlugin.pex") == null && release("..\\Data\\Thornswood-Last.esp") == null && release("x.esp") == null);
        }

        // ---- 2: the server names a plugin that is not ours -----------------
        static void NotOurs(int port)
        {
            Config cfg = Install("notours", port);
            string data = Path.Combine(Paths.Game, "Data");
            string masters = Masters(data);
            Plugin(Path.Combine(data, "TsOne.esp"), false, "TSONE");
            Plugin(Path.Combine(data, "Beards.esl"), true, "BEARDS");
            string list = "*TsOne.esp\r\n*Beards.esl\r\n";
            Put(Path.Combine(Paths.Golden, "plugins.txt"), list);
            Put(Path.Combine(Paths.LocalAD, "plugins.txt"), list);
            byte[] one = File.ReadAllBytes(Path.Combine(data, "TsOne.esp"));
            byte[] beards = File.ReadAllBytes(Path.Combine(data, "Beards.esl"));
            byte[] hair = PluginBytes(true, "HAIR");
            lock (served)
            {
                served.Clear();
                served[Base + "/manifest.json"] = Encoding.UTF8.GetBytes(
                    "{\"versionMajor\":1,\"mods\":[" + masters + Entry("TsOne.esp", one) + "]," +
                    "\"light\":[" + Entry("Beards.esl", beards) + "," + Entry("Hair.esp", hair) + "]," +
                    "\"loadOrder\":[" + MasterNames + "\"TsOne.esp\",\"Beards.esl\",\"Hair.esp\"],\"served\":[]}");
            }
            // The manifest is kept for a minute; this is another server's.
            typeof(Verify).GetField("manifestCache", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic).SetValue(null, null);
            var said = new List<string>();
            int moved = Verify.PutInServerOrder(cfg, Into(said));
            bool why = false;
            foreach (string m in said) if (m.IndexOf("names Hair.esp", StringComparison.Ordinal) >= 0 && m.IndexOf("is not Thornswood's own", StringComparison.Ordinal) >= 0 && Clean(m)) why = true;
            Yes("a plugin of another author the list lacks is not switched on, and the reason says only an update or Vortex can bring it",
                moved == 0 && why && Text(Path.Combine(Paths.LocalAD, "plugins.txt")) == list);
            Issue order = Find(Verify.Run(cfg), IssueKind.Plugins, "light position");
            Yes("Scan's line for it says the same", order != null && order.WhatWill.IndexOf("only an update or Vortex can bring it", StringComparison.Ordinal) >= 0);
        }

        // ---- 3: no folder of its own (#2403) -------------------------------
        static void NoFolderYet(int port)
        {
            Config cfg = Install("shared", port);
            string steam = Path.Combine(T, "steam\\steamapps\\common\\Skyrim Special Edition");
            Put(Path.Combine(steam, "SkyrimSE.exe"), "STEAM-EXE");
            Plugin(Path.Combine(steam, "Data\\Skyrim.esm"), false, "MASTER");
            Plugin(Path.Combine(steam, "Data\\ccBGSSSE001-Fish.esm"), false, "FISH");
            Put(Path.Combine(steam, "Skyrim.ccc"), "ccBGSSSE001-Fish.esm\r\n");
            Plugin(Path.Combine(steam, "Data\\Thornswood-Content.esp"), false, "COLLECTION-COPY");
            Directory.Delete(Paths.Game, true);
            Paths.Collection = true;
            Paths.Game = steam;
            Paths.SteamCopy = steam;
            Paths.Live = Paths.WinLocalAD;
            Paths.LiveMyGames = Paths.WinMyGames;
            Put(Path.Combine(Paths.Golden, "plugins.txt"), "*Thornswood-Content.esp\r\n");
            Put(Path.Combine(Paths.WinLocalAD, "plugins.txt"), "*Thornswood-Content.esp\r\n");
            byte[] content = PluginBytes(false, "CONTENT-SERVER");
            lock (served)
            {
                served.Clear();
                served[Base + "/manifest.json"] = Encoding.UTF8.GetBytes(
                    "{\"versionMajor\":1,\"mods\":[" + Entry("Thornswood-Content.esp", content) + "],\"served\":[\"Thornswood-Content.esp\"]}");
            }
            var shipped = new Dictionary<string, byte[]>();
            shipped["Data\\Thornswood-Content.esp"] = content;
            Func<string, byte[]> release = Release(port, shipped);
            typeof(Verify).GetField("manifestCache", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic).SetValue(null, null);

            List<Issue> scan = Verify.Run(cfg);
            Yes("with no folder of its own, Scan says one thing: the folder (" + scan.Count + ")",
                scan.Count == 1 && scan[0].Kind == IssueKind.OwnFolder && scan[0].Text.IndexOf("no Skyrim folder of its own", StringComparison.Ordinal) >= 0);
            Yes("and says the Steam copy is left as it is", scan.Count == 1 && scan[0].Text.IndexOf("Scan and Fix leave it as it is", StringComparison.Ordinal) >= 0 && Clean(scan[0].Text));
            Dictionary<string, string> before = Snap(steam), windows = Snap(Path.GetDirectoryName(Paths.WinLocalAD));
            var said = new List<string>();
            int asks;
            lock (asked) asks = asked.Count;
            Verify.Fix(cfg, Into(said), release);
            int asksAfter;
            lock (asked) asksAfter = asked.Count;
            Yes("Fix writes nothing into the Steam copy: the Creation Club plugin stays, the content plugin is Vortex's", Same(before, Snap(steam)));
            Yes("and nothing into Windows' own plugin list", Same(windows, Snap(Path.GetDirectoryName(Paths.WinLocalAD))));
            Yes("and asks the server and the release for nothing", asksAfter == asks);
            Yes("it hands on to making the folder, and says so", Verify.OwnFolderNext && said.Count > 0 && said[said.Count - 1].IndexOf("nothing is written into the Steam copy", StringComparison.Ordinal) >= 0);
        }

        // ---- 4: the rest of the install (Upkeep) ---------------------------
        static void TheRest(int port)
        {
            Config cfg = Install("rest", port);
            lock (served) { served.Clear(); }
            typeof(Verify).GetField("manifestCache", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic).SetValue(null, null);
            string game = Paths.Game;
            string data = Path.Combine(game, "Data");
            Put(Path.Combine(game, "SkyrimSE.exe"), "OWN-EXE");
            cfg.ExpectedExeBytes = new FileInfo(Path.Combine(game, "SkyrimSE.exe")).Length;
            Put(Path.Combine(game, "skse64_loader.exe"), "LOADER");
            Put(Path.Combine(game, "skse64_1_6_1170.dll"), "SKSE");

            // Vortex: the Steam copy it deploys into, its record and its mods folder.
            string steam = Path.Combine(T, "steam\\steamapps\\common\\Skyrim Special Edition");
            string staging = Path.Combine(T, "vortex\\mods");
            Put(Path.Combine(staging, "ModA\\textures\\ts\\lost.dds"), "VORTEX-LOST");
            Put(Path.Combine(steam, "Data\\vortex.deployment.json"),
                "{\"instance\":\"t\",\"version\":1,\"deploymentMethod\":\"hardlink_activator\",\"gameId\":\"skyrimse\",\"deploymentTime\":1," +
                "\"stagingPath\":\"" + staging.Replace("\\", "\\\\") + "\",\"targetPath\":\"" + Path.Combine(steam, "Data").Replace("\\", "\\\\") + "\"," +
                "\"files\":[{\"relPath\":\"textures\\\\ts\\\\lost.dds\",\"source\":\"ModA\",\"target\":\"\",\"time\":1}]}");
            cfg.VortexGame = steam;
            Put(Path.Combine(steam, "SkyrimSE.exe"), "STEAM-EXE");
            // Made at today's rules from this deployment, so the folder is not
            // behind Vortex and its record is the one to judge lost files by.
            var any = System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public;
            int rules = (int)typeof(OwnGame).GetField("Rules", any).GetValue(null);
            long stamp = (long)typeof(OwnGame).GetMethod("DeploymentStamp", any).Invoke(null, new object[] { steam });
            Put(Path.Combine(Paths.ProfileDir, "OwnGame\\made.txt"), "source=" + steam + "\r\ngame=" + steam + "\r\ndeployment=" + stamp + "\r\nrules=" + rules + "\r\nkinds=1\r\ncopied=0\r\n");

            // The folder's record: one of Vortex's files and one of Skyrim's
            // own, both gone from the folder.
            Put(Path.Combine(Paths.ProfileDir, "OwnGame\\files.txt"),
                "L|V|11|1|Data\\textures\\ts\\lost.dds\r\nC|O|9|1|Data\\Skyrim - Gone.bsa\r\nC|O|7|1|SkyrimSE.exe\r\n");
            Yes("the pretend folder is Thornswood's own (OwnGame.Active)", OwnGame.Active);

            // This build's own files: a kept page another server replaced,
            // no Thornswood.ini, and a shipped settings file that is gone.
            Put(Path.Combine(Paths.ProfileDir, "Keep\\Data\\Platform\\UI\\index.html"), "OUR PAGE");
            Put(Path.Combine(data, "Platform\\UI\\index.html"), "ANOTHER SERVER'S PAGE");
            Put(Path.Combine(Paths.Golden, "Skyrim.ini"), "[General]\r\n");
            Put(Path.Combine(Paths.Golden, "plugins.txt"), "");
            Put(Path.Combine(Paths.LocalAD, "plugins.txt"), "");

            // Windows' Skyrim folder left aside by a game that fell over.
            Put(Path.Combine(Paths.WinMyGames + ".st-backup", "Saves\\mine.ess"), "MY SAVE");
            Put(Paths.StateFile, "{}");

            // The feed's launcherVersion is not the launcher's update any more
            // (#4825): a feed naming a newer one, with no launcher waiting on
            // the Velopack channel, is no update.
            var feed = new VersionDoc();
            feed.launcherVersion = "999.0.0";
            feed.launcherUrl = "https://thornswood.net/feed/assets/0";
            Upkeep.LauncherWaiting = null;
            VersionDoc read;
            Yes("a newer launcherVersion on the feed alone is no update",
                Find(Upkeep.Look(cfg, true, feed, out read), IssueKind.Update, null) == null);

            // A newer launcher waiting on the Velopack channel, as the shell's
            // launcher check found it.
            Upkeep.LauncherWaiting = "999.0.0";
            List<Issue> look = Upkeep.Look(cfg, true, feed, out read);
            Issue build = Find(look, IssueKind.BuildFiles, null);
            Issue folders = Find(look, IssueKind.WindowsFolders, null);
            Issue lost = Find(look, IssueKind.Lost, null);
            Issue skyrim = Find(look, IssueKind.Skyrim, "Skyrim's own files");
            Issue update = Find(look, IssueKind.Update, null);
            Yes("Scan finds this build's own files changed or missing, naming each",
                build != null && build.Fixable && build.Text.IndexOf("index.html", StringComparison.Ordinal) >= 0 &&
                build.Text.IndexOf("Thornswood.ini", StringComparison.Ordinal) >= 0 && build.Text.IndexOf("Skyrim.ini", StringComparison.Ordinal) >= 0);
            Yes("Windows' Skyrim folders left aside while Skyrim is not running", folders != null && folders.Fixable);
            Yes("Vortex's file the own folder lost", lost != null && lost.Fixable && lost.Text.IndexOf("lost.dds", StringComparison.Ordinal) >= 0);
            Yes("Skyrim's own file it lost, which the Downgrade puts back", skyrim != null && skyrim.Fixable && skyrim.Text.IndexOf("Skyrim - Gone.bsa", StringComparison.Ordinal) >= 0 &&
                skyrim.Text.IndexOf("Downgrade", StringComparison.Ordinal) >= 0);
            Yes("and the newer launcher on its channel, which Fix takes last", update != null && update.Fixable && update.Blocking &&
                update.Text.IndexOf("999.0.0", StringComparison.Ordinal) >= 0 && update.Text.IndexOf("last", StringComparison.Ordinal) >= 0);
            Yes("the feed it went by is the one it was handed, not asked again", read == feed);
            bool words = true;
            foreach (Issue i in look) if (!Clean(i.Text) || !Clean(i.WhatWill ?? "")) words = false;
            Yes("every line is in the house words, and every one says what will put it right", words && AllSay(look));

            Yes("Keep.Changed reads and writes nothing", Text(Path.Combine(data, "Platform\\UI\\index.html")) == "ANOTHER SERVER'S PAGE");

            // Fix is handed what Scan found. When Scan missed one, handing it
            // a null only ended the driver in a NullReferenceException that
            // hid which check went wrong (#2856), so stop here and say so.
            if (build == null || folders == null || lost == null)
            {
                Yes("Fix not run: Scan did not find what this case set up, the FAIL lines above say which", false);
                return;
            }
            var said = new List<string>();
            var mine = new List<Issue> { build, folders, lost };
            Upkeep.FixOnDisk(cfg, mine, feed, Into(said));
            Yes("Fix puts the kept page back", Text(Path.Combine(data, "Platform\\UI\\index.html")) == "OUR PAGE");
            Yes("writes Thornswood.ini from the template", File.Exists(ThornIni.File_));
            Yes("puts the shipped settings file back", File.Exists(Path.Combine(Paths.MyGames, "Skyrim.ini")));
            Yes("puts Windows' folder back, with the person's own save in it", Text(Path.Combine(Paths.WinMyGames, "Saves\\mine.ess")) == "MY SAVE" &&
                !Directory.Exists(Paths.WinMyGames + ".st-backup") && !File.Exists(Paths.StateFile));
            Yes("and Vortex's lost file, from Vortex's own copy", Text(Path.Combine(data, "textures\\ts\\lost.dds")) == "VORTEX-LOST");
            bool saidWords = said.Count > 0;
            foreach (string m in said) if (!Clean(m)) saidWords = false;
            Yes("and says what it did, in the house words (" + said.Count + " lines)", saidWords);

            List<Issue> again = Upkeep.Look(cfg, true, feed, out read);
            Yes("the scan after finds none of those four again",
                Find(again, IssueKind.BuildFiles, null) == null && Find(again, IssueKind.WindowsFolders, null) == null && Find(again, IssueKind.Lost, null) == null);
            Yes("and still says what Fix does next: the Downgrade and the update",
                Find(again, IssueKind.Skyrim, null) != null && Find(again, IssueKind.Update, null) != null);
            Yes("Forget takes one kind off what the card shows", CountKind(Upkeep.LastIssues, IssueKind.Update) == 1 &&
                ForgetThenCount(IssueKind.Update) == 0);
        }

        /// <summary>
        /// #2856. Checks.GameProcesses counts a game whose path it cannot read
        /// only while OwnImageRunning says this build's own file of that name
        /// runs. Never named SkyrimSE here: every other build on the box would
        /// see that process.
        /// </summary>
        static void OtherAccount()
        {
            MethodInfo own = typeof(Checks).GetMethod("OwnImageRunning", BindingFlags.NonPublic | BindingFlags.Static);
            Yes("Checks tells this build's own game file running from the folder's side (OwnImageRunning)", own != null);
            if (own == null) return;
            Func<bool> running = delegate { return (bool)own.Invoke(null, new object[] { "ts2856-standin" }); };
            string was = Paths.Game;
            Paths.Game = Path.Combine(T, "other-account");
            string exe = Path.Combine(Paths.Game, "ts2856-standin.exe");
            try
            {
                Yes("a game file that is not there is not running", !running());
                Directory.CreateDirectory(Paths.Game);
                File.Copy(Path.Combine(Environment.SystemDirectory, "PING.EXE"), exe);
                Yes("one that is there and that nothing runs is not running", !running());
                var si = new ProcessStartInfo(exe, "-n 60 127.0.0.1");
                si.UseShellExecute = false;
                si.CreateNoWindow = true;
                using (Process p = Process.Start(si))
                {
                    Yes("while it runs, it is running", running());
                    p.Kill();
                    Yes("once it has exited, it is not running", p.WaitForExit(30000) && !running());
                }
            }
            finally { Paths.Game = was; }
        }

        /// <summary>What a scan found, under the lines that judge it, so a failure can be read.</summary>
        static void Show(List<Issue> l)
        {
            foreach (Issue i in l) Console.WriteLine("      found: [" + i.Kind + "] " + i.Text);
        }

        static bool AllSay(List<Issue> l)
        {
            foreach (Issue i in l) if (string.IsNullOrEmpty(i.WhatWill) || string.IsNullOrEmpty(i.Problem) || string.IsNullOrEmpty(i.Kind)) return false;
            return true;
        }

        static int CountKind(List<Issue> l, string kind)
        {
            int n = 0;
            if (l != null) foreach (Issue i in l) if (i.Kind == kind) n++;
            return n;
        }

        static int ForgetThenCount(string kind)
        {
            Upkeep.Forget(kind);
            return CountKind(Upkeep.LastIssues, kind);
        }
    }
}
'@

# The list of Skyrim's own files, in place of the real one: one file, so
# case 4's lost file is the only one it can name.
$skyrimList = Join-Path $T 'skyrim-files.json'
[IO.File]::WriteAllText($skyrimList, "{`n  ""build"": ""1.6.1170"",`n  ""files"": {`n    ""SkyrimSE.exe"": { ""bytes"": 1, ""sha1"": ""0"", ""depot"": ""1"" }`n  }`n}`n", (New-Object Text.UTF8Encoding($false)))
$dll = $null
try { $dll = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Thornswood.ScanFixTest' -Resource @{ 'skyrim-files.json' = $skyrimList } }
catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the driver build the way the project does' ($null -ne $dll)
if ($null -eq $dll -or -not $OnWindows) {
    if ($null -ne $dll) { Write-Host 'SKIP  1 to 4, the scan and Fix run on a scratch install: they read Windows paths, Windows'' Skyrim folders and its processes, which only Windows has' }
    try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
    Done
}

$out = Invoke-LauncherExe $dll $T 2>&1 | ForEach-Object { "$_" }
foreach ($l in $out) {
    if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
    elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
    elseif ($l -match '^driver: ') { }
    else { Write-Host $l }
}
Yes 'the driver ran to the end and reported' (@($out | Where-Object { $_ -match '^driver: ' }).Count -eq 1)

try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
Done
