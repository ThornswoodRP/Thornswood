using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// The three kinds of file Thornswood's own folder takes, and nothing else
    /// (#1232).
    ///
    /// Patrick, 29 Sep: Thornswood's own folder must take only Skyrim's own
    /// files (Bethesda's, from the Steam copy when it is on the pinned build,
    /// or the Downgrade's download), Vortex's deployed files (by Vortex's own
    /// record), and Thornswood's own files. Mods a person put into their Steam
    /// copy by hand (loose meshes, textures, script extender plugins, their
    /// own .esp) stay out, because people play vanilla Skyrim from Steam with
    /// their own mods and Thornswood runs from its own folder.
    ///
    /// Until then Make walked the whole Steam copy and took every file Skip
    /// did not name, so a hand placed mod there became part of Thornswood's
    /// folder and loaded in Thornswood's sessions, and Publish-Update shipped
    /// it from the shipping machine to everybody.
    ///
    /// SKYRIM'S OWN is a real list, never a guess by folder: every file of the
    /// three depots the pin names (records\skyrim-pin.json), read out of
    /// Steam's own manifests of them by scripts\release\New-SkyrimFilesRecord.ps1
    /// into records\skyrim-files.json, which Build-Launcher puts inside the
    /// launcher. Those manifests are what the Downgrade asks Steam for, so the
    /// list is exactly the files the Downgrade's download holds. 46 files on
    /// 1.6.1170.
    ///
    /// VORTEX'S is Vortex's own record in the folder it deploys into
    /// (Deployed), as it always was.
    ///
    /// THORNSWOOD'S OWN is what Thornswood's own records say it put there:
    /// the packs' records, Keep's copies, the installer's list
    /// (installed-into-game.txt), the copy of that list the Steam copy's clean
    /// up keeps before it empties it (InstalledKept), the game files of the
    /// release the install synced to (Updater.ReleaseFiles), Profile\Payload,
    /// what GeneratedBuild made in the folder (#1247, #3715), and
    /// the few files the launcher and the game plugins write under names
    /// that are Thornswood's. On the machine that ships, the release's files
    /// came from that machine's own folder and the release list is their only
    /// record, so nothing is sorted out while an install synced by an older
    /// launcher has not kept that list yet (OursKnown).
    ///
    /// files.txt records which kind each file is: V Vortex's, O Skyrim's own,
    /// T Thornswood's. A folder made before this recorded everything that was
    /// not Vortex's as O; Rules 13 makes it refresh once, and that refresh
    /// takes out, and logs, every file Make took from the Steam copy that is
    /// none of the three. Only this folder's name for a file goes: the Steam
    /// copy is never written.
    /// </summary>
    static partial class OwnGame
    {
        /// <summary>
        /// Make, Refresh and the Steam copy's clean up, one at a time. The
        /// clean up empties the installer's list, which a refresh reads to
        /// tell Thornswood's files from a hand placed mod; the two start at the
        /// same launcher start on two pool threads.
        /// </summary>
        static readonly object folderWork = new object();

        /// <summary>
        /// Runs <paramref name="work"/> while nothing else writes into the game
        /// folder or its records: a make or a refresh under way finishes first,
        /// and none starts until the work is done (#2210). An update writes the
        /// release it downloaded through this, so the download can run while
        /// the folder is prepared and the writing waits for it, because both
        /// keep records of the folder. <paramref name="waiting"/>, when given,
        /// is called once before waiting, so the log can say why it waits.
        /// The Monitor is the thread's own, so work that itself makes or
        /// refreshes the folder runs on.
        /// </summary>
        public static void Alone(Action work, Action waiting)
        {
            bool held = System.Threading.Monitor.TryEnter(folderWork);
            if (!held)
            {
                if (waiting != null) waiting();
                System.Threading.Monitor.Enter(folderWork);
            }
            try { work(); }
            finally { System.Threading.Monitor.Exit(folderWork); }
        }

        // ------------------------------------------------------------ Skyrim's own

        static readonly object skyrimLock = new object();
        static HashSet<string> skyrimFiles;
        static string skyrimBuild = "";
        // Bytes and SHA-1 beside the path (#1246). A listed file from the
        // Steam copy is the pinned build's only when those match. An archive
        // is the size alone: hashing one is most of a gigabyte.
        class PinFile
        {
            public long Bytes;
            public string Sha1;
        }
        static Dictionary<string, PinFile> skyrimInfo;
        // True when the embedded list carries a real SHA-1 (40 hex digits).
        // A harness that only names the paths still writes "sha1": "0", and
        // then the exe's size stays the only build check, as it was.
        static bool skyrimPinsBytes;
        // path|length|write-time to a SHA-1 already computed this run, so a
        // card that asks every few seconds does not hash the masters again.
        static Dictionary<string, string> sha1Seen;

        /// <summary>
        /// Every file of the pinned build, relative to the game folder, from
        /// the skyrim-files.json Build-Launcher embeds. Empty when the launcher
        /// was built without it, which NoSkyrimList turns into a refusal.
        /// </summary>
        static HashSet<string> SkyrimFiles()
        {
            lock (skyrimLock)
            {
                if (skyrimFiles != null) return skyrimFiles;
                var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var info = new Dictionary<string, PinFile>(StringComparer.OrdinalIgnoreCase);
                bool pins = false;
                try
                {
                    string text = null;
                    using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("skyrim-files.json"))
                    {
                        if (s != null)
                            using (var sr = new StreamReader(s))
                                text = sr.ReadToEnd();
                    }
                    if (!string.IsNullOrEmpty(text))
                    {
                        // Read by pattern, as ClientRuntime reads client-build.json:
                        // the files object is keyed by path, so there is no class
                        // to bind it to, and the shape is the generator's own.
                        foreach (Match m in Regex.Matches(text, "\"((?:[^\"\\\\]|\\\\.)+)\"\\s*:\\s*\\{\\s*\"bytes\"\\s*:\\s*([0-9]+)\\s*,\\s*\"sha1\"\\s*:\\s*\"([^\"]*)\""))
                        {
                            string rel = m.Groups[1].Value.Replace("\\\\", "\\");
                            if (!Tidy(rel)) continue;
                            long bytes;
                            if (!long.TryParse(m.Groups[2].Value, out bytes)) continue;
                            set.Add(rel);
                            var pf = new PinFile();
                            pf.Bytes = bytes;
                            pf.Sha1 = m.Groups[3].Value;
                            info[rel] = pf;
                            if (pf.Sha1 != null && pf.Sha1.Length == 40) pins = true;
                        }
                        Match b = Regex.Match(text, "\"build\"\\s*:\\s*\"([^\"]+)\"");
                        if (b.Success) skyrimBuild = b.Groups[1].Value;
                    }
                }
                catch (Exception ex) { Swallow.Note("OwnGame.SkyrimFiles, reading the embedded list", ex); }
                skyrimInfo = info;
                skyrimPinsBytes = pins;
                skyrimFiles = set;
                return skyrimFiles;
            }
        }

        /// <summary>One of the pinned build's own files, by the list.</summary>
        public static bool SkyrimOwn(string rel)
        {
            return SkyrimFiles().Contains(rel);
        }

        /// <summary>
        /// Null when the launcher has the list, otherwise the sentence Make and
        /// Refresh stop with. Without it every one of Skyrim's files would read
        /// as a mod put in by hand, so nothing is made or brought up to date.
        /// </summary>
        static string NoSkyrimList()
        {
            if (SkyrimFiles().Contains("SkyrimSE.exe")) return null;
            return "This launcher was built without the list of Skyrim's own files (records\\skyrim-files.json), so it cannot tell Skyrim's files from mods put into the Steam copy by hand, " +
                   "and Thornswood's own folder is not made or brought up to date. Update the launcher, or tell staff it said this.";
        }

        /// <summary>
        /// An archive is the big file, so its size is the whole check. A
        /// master or a loose file is small enough to hash: those are the ones
        /// a person edits in place, a cleaned master or an edited Skyrim.ccc,
        /// without the exe's size moving.
        /// </summary>
        static bool HashThis(string rel)
        {
            return !rel.EndsWith(".bsa", StringComparison.OrdinalIgnoreCase);
        }

        static string Sha1Of(string path, long length, long ticks)
        {
            string key = path + "|" + length.ToString() + "|" + ticks.ToString();
            lock (skyrimLock)
            {
                if (sha1Seen == null) sha1Seen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                string hit;
                if (sha1Seen.TryGetValue(key, out hit)) return hit;
            }
            string hex;
            using (var sha = SHA1.Create())
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                byte[] h = sha.ComputeHash(fs);
                var sb = new StringBuilder(h.Length * 2);
                for (int i = 0; i < h.Length; i++) sb.Append(h[i].ToString("x2"));
                hex = sb.ToString();
            }
            lock (skyrimLock) { sha1Seen[key] = hex; }
            return hex;
        }

        /// <summary>
        /// This one listed file in <paramref name="game"/> is the pinned
        /// build's: the size on the list, and the SHA-1 when it is a master
        /// or a loose file.
        /// </summary>
        static bool OneFilePinned(string game, string rel)
        {
            SkyrimFiles();
            PinFile info;
            if (skyrimInfo == null || !skyrimInfo.TryGetValue(rel, out info)) return false;
            try
            {
                var fi = new FileInfo(Path.Combine(game, rel));
                if (!fi.Exists || fi.Length != info.Bytes) return false;
                if (!HashThis(rel)) return true;
                if (info.Sha1 == null || info.Sha1.Length != 40) return true;
                return string.Equals(Sha1Of(fi.FullName, fi.Length, fi.LastWriteTimeUtc.Ticks), info.Sha1, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        /// <summary>
        /// Every listed file in this folder is the pinned build's. A list
        /// that does not carry real SHA-1s does not say, and the exe's size
        /// stays the check (FirstBuildWrong).
        /// </summary>
        static bool ListedFilesArePinned(string game)
        {
            SkyrimFiles();
            if (!skyrimPinsBytes) return true;
            foreach (string rel in SkyrimFiles())
                if (!OneFilePinned(game, rel)) return false;
            return true;
        }

        // ------------------------------------------------------------ from a folder that has them

        /// <summary>
        /// 1.6.1170's own files for Make, from <paramref name="from"/>, a
        /// folder that already holds them (#2603): on the machine that ships,
        /// the dev ship root's Game, which OwnGame made, when the Steam copy is
        /// not on the pinned build and the Downgrade, a Steam download under
        /// the person's account, cannot be run by a script. Throws with a
        /// sentence naming the first file that is not the pinned build's, and
        /// then nothing has been placed anywhere.
        ///
        /// WHICH FILES. Every listed file Make takes: not one Skip leaves out
        /// of every folder (the Creation Club plugins the server does not
        /// load, UnwantedCreation, which is why an OwnGame folder never holds
        /// them), and not one Vortex deploys, whose copy goes in instead
        /// (Gather). Each must be in the folder, with the size and the SHA-1
        /// on the list, the archives too: OneFilePinned trusts an archive's
        /// size from the Steam copy, but what is taken from here becomes the
        /// new folder's own copy and is never compared with anything again.
        /// The SHA-1 is the hash the list has: records\skyrim-files.json is
        /// read out of Steam's own depot manifests, which give a SHA-1 for
        /// each file and nothing else, so it is the one record of those bytes
        /// that did not come from a machine's own copy.
        ///
        /// COPIED, NEVER LINKED (Found.Pinned, CopyOf). A hard link would make
        /// the new folder's file the other folder's file under a second name,
        /// and whatever writes into one in place (a tool, a copy over it)
        /// would change both. Each file's stamp (OwnGameShare.cs StampOf: its
        /// id, size and NTFS change time, which moves on every write) is taken
        /// before it is hashed, in <paramref name="stamps"/>, and Make reads
        /// them again once everything is placed (SkyrimFromMoved), so what was
        /// copied is the bytes that were checked.
        /// </summary>
        static List<Found> SkyrimFrom(string from, HashSet<string> deployed, Action<string> say, out Dictionary<string, Stamp> stamps)
        {
            stamps = null;
            string dir = from;  // whole already: Make made it so
            if (!Directory.Exists(dir))
                throw new Exception("There is no folder " + dir + ", so the game's own files were not taken from it, and nothing was made.");
            SkyrimFiles();
            if (!skyrimPinsBytes)
                throw new Exception("This build's list of Skyrim's own files (records\\skyrim-files.json) has no SHA-1 for them, so the files in " + dir +
                                    " cannot be checked against it, and nothing was made.");

            var want = new List<string>();
            foreach (string rel in SkyrimFiles())
                if (Skip(rel) == null && (deployed == null || !deployed.Contains(rel))) want.Add(rel);
            want.Sort(StringComparer.OrdinalIgnoreCase);

            // The sizes first, which costs nothing, then the bytes.
            var l = new List<Found>();
            long total = 0;
            foreach (string rel in want)
            {
                PinFile info = skyrimInfo[rel];
                FileInfo fi;
                try { fi = new FileInfo(Path.Combine(dir, rel)); }
                catch (Exception ex) { throw new Exception(SkyrimFromRefused(dir, rel, "could not be read (" + Failure.Why("OwnGameKinds, " + rel, ex, rel) + ")")); }
                if (!fi.Exists) throw new Exception(SkyrimFromRefused(dir, rel, "is not there"));
                if (fi.Length != info.Bytes)
                    throw new Exception(SkyrimFromRefused(dir, rel, "is " + fi.Length.ToString("n0") + " bytes and the build's is " + info.Bytes.ToString("n0")));
                var f = new Found();
                f.Rel = rel;
                f.From = fi.FullName;
                f.Size = fi.Length;
                f.Ticks = fi.LastWriteTimeUtc.Ticks;
                l.Add(f);
                total += fi.Length;
            }

            var at = new Dictionary<string, Stamp>(StringComparer.OrdinalIgnoreCase);
            long done = 0;
            int shown = 0;
            foreach (Found f in l)
            {
                Stamp before;
                string sha;
                try
                {
                    before = StampOf(f.From);
                    sha = Sha1Whole(f.From, delegate(int n)
                    {
                        done += n;
                        int pct = total > 0 ? (int)(done * 100 / total) : 100;
                        if (say != null && pct >= shown + 10) { shown = pct - pct % 10; say("Checking Skyrim's own files in " + dir + ": " + shown + "%"); }
                    });
                }
                catch (Exception ex) { throw new Exception(SkyrimFromRefused(dir, f.Rel, "could not be read (" + Failure.Why("OwnGameKinds, " + f.Rel, ex, f.Rel) + ")")); }
                if (!string.Equals(sha, skyrimInfo[f.Rel].Sha1, StringComparison.OrdinalIgnoreCase))
                    throw new Exception(SkyrimFromRefused(dir, f.Rel, "has the build's size but not its bytes (SHA-1 " + sha + ", the list's " + skyrimInfo[f.Rel].Sha1 + ")"));
                at[f.Rel] = before;
            }
            if (say != null)
                say("All " + l.Count + " of Skyrim " + (skyrimBuild.Length > 0 ? skyrimBuild : "1.6.1170") + "'s own files the folder takes are in " + dir +
                    " byte for byte as records\\skyrim-files.json lists them, so they are copied from there.");
            stamps = at;
            return l;
        }

        static string SkyrimFromRefused(string dir, string rel, string what)
        {
            return Path.Combine(dir, rel) + " " + what + ", so it is not Skyrim " + (skyrimBuild.Length > 0 ? skyrimBuild : "1.6.1170") +
                   "'s own file as records\\skyrim-files.json lists it. The game's own files are taken from " + dir +
                   " only when every one the folder takes is, so nothing was made.";
        }

        /// <summary>
        /// Null when every file SkyrimFrom checked still has the stamp it had
        /// then, otherwise the sentence Make stops with before it writes any
        /// record or puts the folder in place.
        /// </summary>
        static string SkyrimFromMoved(string dir, Dictionary<string, Stamp> stamps)
        {
            foreach (KeyValuePair<string, Stamp> kv in stamps)
            {
                string path = Path.Combine(dir, kv.Key);
                bool same;
                try { same = StampOf(path).Same(kv.Value); }
                catch { same = false; }
                if (!same)
                    return path + " changed while the folder was being made from it, so what was copied may not be the bytes that were checked, and nothing was made. " +
                           "Run it again once nothing is writing into " + dir + ".";
            }
            return null;
        }

        /// <summary>The SHA-1 of a whole file, read once in large blocks; <paramref name="read"/> is told each block's size.</summary>
        static string Sha1Whole(string path, Action<int> read)
        {
            using (var sha = SHA1.Create())
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 1 << 20, FileOptions.SequentialScan))
            {
                byte[] buf = new byte[1 << 20];
                int n;
                while ((n = fs.Read(buf, 0, buf.Length)) > 0)
                {
                    sha.TransformBlock(buf, 0, n, null, 0);
                    if (read != null) read(n);
                }
                sha.TransformFinalBlock(buf, 0, 0);
                var sb = new StringBuilder(40);
                foreach (byte b in sha.Hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        // ------------------------------------------------------------ Thornswood's own

        /// <summary>
        /// Written by the launcher under a name that is Thornswood's alone:
        /// Thornswood.ini, and thornswood- files directly in Data\Platform, its
        /// Plugins or its UI folder (Keep, Chars, JoinPass, the session note,
        /// the plugins and the overlays).
        /// </summary>
        static bool NamedOurs(string rel)
        {
            if (rel.Equals("Data\\SKSE\\Plugins\\Thornswood.ini", StringComparison.OrdinalIgnoreCase)) return true;
            return Regex.IsMatch(rel, @"^Data\\Platform\\((Plugins|UI)\\)?thornswood-[^\\]+$", RegexOptions.IgnoreCase);
        }

        /// <summary>
        /// Files Thornswood's launcher and game plugins write into the game
        /// folder under names that are not thornswood-: the client settings
        /// (AutoJoin, Keys and Voice write it before every Play, and it holds
        /// the person's keys) and the voice channel files (Voice.cs and
        /// thornswood-voice.js).
        /// </summary>
        static readonly string[] WrittenInGame = {
            "Data\\Platform\\Plugins\\skymp5-client-settings.txt",
            "Data\\Platform\\voice-port.txt",
            "Data\\Platform\\voice-status.txt",
            "Data\\Platform\\voice-ptt.txt",
            "Data\\Platform\\voice-muted.txt",
        };

        /// <summary>
        /// The files the launcher makes from the person's own game before every
        /// Play (MadeFromGame, #2827), which no pack carries any more. FromGame.Files
        /// by value, so the harnesses that compile this file need none of
        /// FromGame's; tests\test-2827-from-game.ps1 holds the two the same. A
        /// refresh leaves them as they are, Vortex's name or not (Owned), and
        /// keeps them on the folder's record as Thornswood's.
        /// </summary>
        static readonly string[] MadeInGame = {
            "Data\\Interface\\startmenu.swf",
            "Data\\meshes\\thornswood\\noticeboard01.nif",
            "Data\\meshes\\thornswood\\dropbox01.nif",
            // The collection's menus with no gold values (#3113).
            "Data\\Interface\\skyui\\config.txt",
            "Data\\Interface\\skyui\\itemcard.swf",
            "Data\\Interface\\hudmenu.swf",
            "Data\\Interface\\AHZHudInfo.swf",
            "Data\\Interface\\exported\\AHZHudInfo.swf",
            // SkyUI's journal with no saving, loading, help or Creation Club (#3127).
            "Data\\Interface\\quest_journal.swf",
            "Data\\Interface\\inventorymenu.swf",
            // Made from the person's own plugins by the release's recipe (#2791).
            LastPlugin.File,
        };

        /// <summary>Thornswood's by its name alone: NamedOurs, WrittenInGame, MadeInGame, or the client runtime.</summary>
        static bool OursByName(string rel)
        {
            if (NamedOurs(rel) || ClientFile(rel)) return true;
            foreach (string w in WrittenInGame)
                if (rel.Equals(w, StringComparison.OrdinalIgnoreCase)) return true;
            foreach (string m in MadeInGame)
                if (rel.Equals(m, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// What the installer's list (installed-into-game.txt) said was
        /// Thornswood's, kept here by the Steam copy's clean up before it
        /// empties that list, so a refresh can still tell those files from a
        /// hand placed mod once the list is gone. One path per line.
        /// </summary>
        static string InstalledKept { get { return Path.Combine(Dir, "installed-kept.txt"); } }

        /// <summary>Adds every path on the installer's list to InstalledKept.</summary>
        static void KeepInstalledList()
        {
            string list = Path.Combine(Paths.ProfileDir, "installed-into-game.txt");
            if (!File.Exists(list)) return;
            var all = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            if (File.Exists(InstalledKept))
                foreach (string line in File.ReadAllLines(InstalledKept))
                    if (line.Trim().Length > 0) all.Add(line.Trim());
            int before = all.Count;
            foreach (string raw in SetupOwnership.PathsIn(list, Paths.SteamCopy))
            {
                string rel = (raw ?? "").Trim().Replace('/', '\\').TrimStart('\\');
                if (rel.Length > 0 && Tidy(rel)) all.Add(rel);
            }
            if (all.Count == before && File.Exists(InstalledKept)) return;
            WriteRecord(InstalledKept, all);
        }

        /// <summary>
        /// What GeneratedBuild made in this folder (#1247): the behavior files
        /// Pandora makes and the BodySlide bodies. Patrick, 29 Sep: they are
        /// made in Thornswood's own folder, and the Steam copy stays the
        /// person's own; 27 Oct (#3715): on each computer, by the launcher
        /// (GeneratedHere), and no release carries them. One "file
        /// &lt;sha256&gt; &lt;path&gt;" line per file, among lines that say
        /// what they were built from (Generated.cs, GeneratedRecord).
        /// </summary>
        static string GeneratedFile { get { return Path.Combine(Dir, "generated.txt"); } }

        /// <summary>
        /// The paths on GeneratedFile, none when it has never run here. Read
        /// without a catch, as every record of Thornswood's own is (Ours).
        /// </summary>
        static List<string> GeneratedFiles()
        {
            var l = new List<string>();
            if (!File.Exists(GeneratedFile)) return l;
            foreach (string line in File.ReadAllLines(GeneratedFile))
            {
                Match m = Regex.Match(line, "^file [0-9a-f]{64} (.+)$");
                if (m.Success && Tidy(m.Groups[1].Value)) l.Add(m.Groups[1].Value);
            }
            return l;
        }

        /// <summary>
        /// A folder made anew holds none of what Build-Generated made, only
        /// Vortex's and Skyrim's own files, so its record goes with the old
        /// folder (Make). Left, it would keep Vortex's files of those names
        /// from ever being brought up to date, and the Ship check would stop
        /// on the files it lists, which is how the machine that ships learns
        /// to build them again.
        /// </summary>
        static void ForgetGenerated()
        {
            if (File.Exists(GeneratedFile)) File.Delete(GeneratedFile);
        }

        /// <summary>
        /// Thornswood's own files by its records: the same ones Owned reads
        /// (the packs', Keep's, the installer's list and what Build-Generated
        /// made), the installer's list as the Steam copy's clean up kept it
        /// (InstalledKept), and the kept list of the release's files
        /// (Updater.ReleaseFiles).
        /// </summary>
        static HashSet<string> Ours(HashSet<string> deployed)
        {
            // Every record is read here without a catch: a record that cannot
            // be read would make its files look like nobody's, and a refresh
            // would take them out. Make and Refresh stop instead, and say why.
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            Action<string> add = delegate(string raw)
            {
                string rel = (raw ?? "").Trim().Replace('/', '\\').TrimStart('\\');
                if (rel.Length > 0 && (deployed == null || !deployed.Contains(rel))) set.Add(rel);
            };
            // What each pack put into the game (Updater: "N|game\..." or "R|game\...").
            if (Directory.Exists(Paths.PacksDir))
                foreach (string rec in Directory.GetFiles(Paths.PacksDir, "*.files"))
                    foreach (string line in File.ReadAllLines(rec))
                    {
                        int bar = line.IndexOf('|');
                        if (bar < 0) continue;
                        string rel = line.Substring(bar + 1);
                        if (rel.StartsWith("game\\", StringComparison.OrdinalIgnoreCase)) set.Add(rel.Substring(5));
                    }
            // Keep's copies of what an update wrote.
            foreach (string rel in Keep.Held()) set.Add(rel);
            // The installer's list, and the copy the clean up keeps of it.
            string list = Path.Combine(Paths.ProfileDir, "installed-into-game.txt");
            if (File.Exists(list)) foreach (string line in SetupOwnership.PathsIn(list, Paths.SteamCopy)) add(line);
            if (File.Exists(InstalledKept)) foreach (string line in File.ReadAllLines(InstalledKept)) add(line);
            // The game files of the release this install synced to (Sync.cs):
            // on the machine that ships, the only record of the release's own
            // files that were already in the folder.
            foreach (string rel in Updater.ReleaseFiles()) add(rel);
            // What Build-Generated made here, even where Vortex deploys a file
            // of the same name: this folder's is Thornswood's (#1247).
            foreach (string rel in GeneratedFiles()) set.Add(rel);
            return set;
        }

        /// <summary>
        /// Every record of Thornswood's own files is on this machine, so a
        /// file on none of them is not Thornswood's. Not so only on an install
        /// a launcher from before #1232 synced to a release record, until the
        /// next check against that release keeps its list (Sync.cs).
        /// </summary>
        static bool OursKnown()
        {
            return Updater.ReleaseFilesKnown();
        }

        /// <summary>
        /// The folder has files not yet sorted into the three kinds, or not
        /// yet taken out, and can be now (made.txt kinds=1 once it is).
        /// </summary>
        static bool KindsDue()
        {
            return Recorded("kinds") < 1 && OursKnown();
        }

        // ------------------------------------------------------------ which kind

        /// <summary>
        /// Which of the three kinds a file is: V Vortex's (by the record, when
        /// <paramref name="deployed"/> is given), O Skyrim's own (by the list),
        /// T Thornswood's (by its records or its name), or '\0' for none of
        /// them, which stays out of Thornswood's folder.
        /// </summary>
        static char KindOf(string rel, HashSet<string> deployed, HashSet<string> ours)
        {
            if (deployed != null && deployed.Contains(rel)) return 'V';
            if (SkyrimOwn(rel)) return 'O';
            if ((ours != null && ours.Contains(rel)) || OursByName(rel)) return 'T';
            return '\0';
        }

        /// <summary>Why a file of the Steam copy stays out, in left-out.txt and the log.</summary>
        static string NoneOfThree
        {
            get
            {
                return "not one of Skyrim " + (skyrimBuild.Length > 0 ? skyrimBuild : "1.6.1170") + "'s own files, not deployed by Vortex and not Thornswood's, " +
                       "so it is the Steam copy's alone: a mod put there by hand, or a file of another build";
            }
        }

        /// <summary>
        /// The walk of a Steam copy, without what is none of the three kinds.
        /// What Skip names is passed on, so Make says Skip's reason for it.
        /// <paramref name="byHand"/> counts what was left out here.
        /// </summary>
        static List<Found> OnlyThree(List<Found> walked, HashSet<string> deployed, HashSet<string> ours, List<string> left, ref int byHand)
        {
            var l = new List<Found>(walked.Count);
            foreach (Found f in walked)
            {
                if (Skip(f.Rel) == null && KindOf(f.Rel, deployed, ours) == '\0')
                {
                    left.Add(f.Rel + "  (" + NoneOfThree + ")");
                    byHand++;
                    continue;
                }
                l.Add(f);
            }
            return l;
        }

        /// <summary>A few names and a count, for one line in the log.</summary>
        static string Some(List<string> names)
        {
            var shown = new List<string>();
            for (int i = 0; i < names.Count && i < 6; i++) shown.Add(names[i]);
            return string.Join(", ", shown.ToArray()) + (names.Count > shown.Count ? " and " + (names.Count - shown.Count).ToString("n0") + " more" : "");
        }
    }
}
