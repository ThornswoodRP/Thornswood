using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// SYNCING THE GAME FOLDER TO A RELEASE (#1050, #4825). Patrick, 29 Sep:
    /// the launcher syncs the install to a release's list of files instead of
    /// replaying a chain of packs. It compares every file of ours in the
    /// install with the list, by size and then sha256, puts in only a file
    /// that differs, and takes out files of ours the release says are gone.
    ///
    /// The files and the list come from the checked Velopack package of each
    /// launcher update (SyncPackage.cs), or, for a repair, from the folder
    /// Velopack unpacked the installed one into. This file is the compare and
    /// the write they share (PlanSync, WriteSync), so release.txt,
    /// release-files.txt, Keep, installed-into-game.txt, the gone and golden
    /// entries and the client files left to ClientRuntime are kept one way.
    /// The record and the packs the old update feed named, and the fetching
    /// of files from the site, went with the feed (#5608).
    /// </summary>
    static partial class Updater
    {
        const string GoldenMark = ":golden:";
        const string GoneMark = ":gone:";

        internal static bool IsSha(string s) { return RecordRef.IsSha(s); }

        // ---- what this install last synced to ---------------------------------
        //
        // Profile\release.txt: "synced <sha256> <id>" once a sync finishes.
        // A "packs" line an older launcher wrote is read past.

        class SyncState
        {
            public string Synced = "";
            public string SyncedId = "";
        }

        static string SyncStateFile { get { return Path.Combine(Paths.ProfileDir, "release.txt"); } }
        static string SyncDir { get { return Path.Combine(Paths.ProfileDir, "Sync"); } }

        static SyncState ReadSyncState()
        {
            var s = new SyncState();
            try
            {
                if (!File.Exists(SyncStateFile)) return s;
                foreach (string raw in File.ReadAllLines(SyncStateFile))
                {
                    string[] w = raw.Trim().Split(new[] { ' ' }, 3, StringSplitOptions.RemoveEmptyEntries);
                    if (w.Length < 2) continue;
                    if (w[0] == "synced") { s.Synced = w[1].ToLowerInvariant(); s.SyncedId = w.Length > 2 ? w[2] : ""; }
                }
            }
            catch (Exception ex) { Swallow.Note("Updater.ReadSyncState", ex); }
            return s;
        }

        static void WriteSyncState(SyncState s)
        {
            var lines = new List<string>();
            if (s.Synced.Length > 0) lines.Add("synced " + s.Synced + (s.SyncedId.Length > 0 ? " " + s.SyncedId : ""));
            // Whole or not at all (#2591): deleting release.txt and then moving
            // the new one in left no record when the launcher was stopped in
            // between, and the next start read that as never synced.
            OwnGame.WriteRecord(SyncStateFile, lines);
        }

        /// <summary>The release this install last synced to, or "" when it has
        /// never synced to one (it has not updated yet).</summary>
        public static string SyncedRelease()
        {
            SyncState s = ReadSyncState();
            return s.SyncedId.Length > 0 ? s.SyncedId : s.Synced;
        }

        // ---- the game files that release ships (#1232) -----------------------
        //
        // Profile\release-files.txt: "release <sha256> <id>", then every game
        // file the release this install synced to ships, one path a line.
        // Thornswood's own folder counts these as Thornswood's own files
        // (OwnGameKinds.cs). A file that already had the release's bytes is
        // not written by a sync, so no pack, Keep or installer record names
        // it; on the machine that ships, the release's files are the folder's
        // own and have no other record at all.

        static string ReleaseFilesFile { get { return Path.Combine(Paths.ProfileDir, "release-files.txt"); } }

        static void WriteReleaseFiles(RecordRef r, ICollection<string> rels)
        {
            var lines = new List<string>();
            lines.Add("release " + r.sha256 + " " + r.id);
            var sorted = new List<string>(rels);
            sorted.Sort(StringComparer.OrdinalIgnoreCase);
            lines.AddRange(sorted);
            // Whole or not at all (#2591), as release.txt above.
            OwnGame.WriteRecord(ReleaseFilesFile, lines);
        }

        /// <summary>The sha256 of the release the kept list is for, or "".</summary>
        static string ReleaseFilesSha()
        {
            try
            {
                if (!File.Exists(ReleaseFilesFile)) return "";
                using (var sr = new StreamReader(ReleaseFilesFile))
                {
                    string first = sr.ReadLine() ?? "";
                    string[] w = first.Split(' ');
                    return w.Length >= 2 && w[0] == "release" ? w[1].ToLowerInvariant() : "";
                }
            }
            catch (Exception ex) { Swallow.Note("Updater.ReleaseFilesSha", ex); return ""; }
        }

        /// <summary>
        /// True when every record of Thornswood's own game files is on this
        /// machine: the install never synced to a release record (every file
        /// of ours came through the installer, a pack or Keep, which all keep
        /// records), or it keeps the list of the release it synced to.
        /// </summary>
        public static bool ReleaseFilesKnown()
        {
            SyncState s = ReadSyncState();
            return s.Synced.Length == 0 || ReleaseFilesSha() == s.Synced;
        }

        /// <summary>
        /// The kept list of the release's game files; empty when
        /// ReleaseFilesKnown is not true of it. Throws when the list is there
        /// and cannot be read, because an empty answer would call every file
        /// of the release somebody else's.
        /// </summary>
        public static List<string> ReleaseFiles()
        {
            var l = new List<string>();
            SyncState s = ReadSyncState();
            if (s.Synced.Length == 0 || ReleaseFilesSha() != s.Synced) return l;
            string[] all = File.ReadAllLines(ReleaseFilesFile);
            for (int i = 1; i < all.Length; i++)
                if (all[i].Trim().Length > 0) l.Add(all[i].Trim());
            return l;
        }

        /// <summary>
        /// A repair: checks the install against the installed package's lists
        /// and puts right anything that differs (SyncPackage.cs). False when
        /// Velopack did not install this launcher, so there is no package.
        /// </summary>
        public static bool Resync(Config cfg, Action<string> log)
        {
            return ResyncFromPackage(cfg, log);
        }

        /// <summary>
        /// Thornswood's own plugins as the installed package ships them
        /// (#3386), for Fix: a plugin's bytes, checked against the installed
        /// version's signed game-files.json, or null when the package does not
        /// ship it. Null itself when Velopack did not install this launcher.
        ///
        /// Until #3386 Fix took them from the game server's resources port,
        /// over plain http, and checked them against the size and crc32 of
        /// that same server's manifest, so anybody on the path could hand
        /// over another plugin with the numbers to match.
        /// </summary>
        public static Func<string, byte[]> ReleaseCopy(Config cfg)
        {
            return Velo.Installed ? PackageCopy(cfg) : null;
        }

        internal class SyncItem
        {
            public string Rel;
            public string Dest;
            public long Bytes;
            public string Sha;
            public bool InGame;
            // The file as it was when it was found to match (OwnGame.Identity),
            // so the write can tell whether anything changed it since.
            public string Seen;
        }

        /// <summary>
        /// A release checked and downloaded and not yet written (#2210): what
        /// the check found, and every file it needs waiting in Profile\Sync.
        /// </summary>
        public sealed class SyncPlan
        {
            // Puts the file with that sha256 and size into the path given,
            // checked against the sha256, out of the Velopack package or the
            // installed package's folder (SyncPackage.cs).
            internal Blob Fetch;
            // Run once the plan is written or dropped: lets go of the package.
            internal Action Close;
            internal string Stage;
            internal RecordRef Record;
            internal List<SyncItem> Items, Need;
            internal List<KeyValuePair<string, string>> Gone;
            internal HashSet<string> Listed, Client;
            internal long Total;
            internal int Fetched;
        }

        /// <summary>One file into dest, by its sha256 and size, checked; onBytes may be null.</summary>
        internal delegate void Blob(string sha, long bytes, string dest, Action<long> onBytes);

        /// <summary>
        /// The compare and the fetch, for a record's entries (<paramref name="map"/>,
        /// in the record's shape: game files, :golden: and :gone:) from
        /// wherever <paramref name="fetch"/> takes them. Writes nothing into
        /// the game folder or its records.
        /// </summary>
        static SyncPlan PlanSync(RecordRef r, Dictionary<string, string> map, Blob fetch, Action<string> log)
        {
            string stage = SyncDir;
            Directory.CreateDirectory(stage);
            var items = new List<SyncItem>();
            var gone = new List<KeyValuePair<string, string>>();
            var listed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            // The six client runtime files stay with the launcher, which
            // carries the record of which build belongs beside it and puts
            // back any other (ClientRuntime.Heal), the same rule a rollback
            // keeps (Rollback-Feed.ps1). Never written or removed here.
            var client = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (ClientRuntime.Entry ce in ClientRuntime.Recorded()) client.Add(ce.Rel);
            foreach (KeyValuePair<string, string> e in map)
            {
                string k = e.Key;
                if (k.StartsWith(GoneMark, StringComparison.Ordinal))
                {
                    string rel = k.Substring(GoneMark.Length).Replace('/', '\\');
                    if (rel.Length > 0) gone.Add(new KeyValuePair<string, string>(rel, e.Value));
                    continue;
                }
                bool golden = k.StartsWith(GoldenMark, StringComparison.Ordinal);
                if (k.StartsWith(":", StringComparison.Ordinal) && !golden) continue;

                long bytes; string sha;
                if (!ReadEntry(e.Value, out bytes, out sha))
                    throw new Exception("The record of release " + r.id + " has an entry that is not a size and a checksum (" + k + "). Nothing was changed.");

                var it = new SyncItem();
                it.Bytes = bytes;
                it.Sha = sha;
                string full;
                if (golden)
                {
                    // Only the reference plugin list's own files, into
                    // Profile\Default, the way a pack's profile/ tree goes.
                    string leaf = k.Substring(GoldenMark.Length);
                    if (leaf.Length == 0 || leaf.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || leaf.StartsWith(".")) continue;
                    try { full = Path.GetFullPath(Path.Combine(Paths.Golden, leaf)); } catch { continue; }
                    if (!PathFence.Inside(full, Paths.Root)) continue;
                    it.Rel = leaf;
                }
                else
                {
                    string rel = k.Replace('/', '\\');
                    // Fenced after the path is resolved, as Install does.
                    try { full = Path.GetFullPath(Path.Combine(Paths.Game, rel)); } catch { continue; }
                    if (!PathFence.Inside(full, Paths.Game)) continue;
                    it.Rel = full.Substring(Paths.Game.TrimEnd('\\', '/').Length).TrimStart('\\', '/');
                    it.InGame = true;
                    listed.Add(it.Rel);
                    if (client.Contains(it.Rel)) continue;
                }
                it.Dest = full;
                items.Add(it);
            }

            // ---- compare: size first, then the sha256 ---------------------
            log("Checking " + items.Count + " files against release " + r.id + "...");
            var need = new List<SyncItem>();
            int looked = 0;
            foreach (SyncItem it in items)
            {
                // Taken before the bytes are read, so a change made while they
                // are is seen at the write.
                it.Seen = OwnGame.Identity(it.Dest);
                if (!Matches(it.Dest, it.Bytes, it.Sha)) need.Add(it);
                PlayProgress.Files("Checking files", ++looked, items.Count);
            }

            // ---- fetch what differs, each file once ------------------------
            var want = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (SyncItem it in need) want[it.Sha] = it.Bytes;
            long total = 0;
            foreach (long b in want.Values) total += b;
            if (want.Count > 0)
            {
                log("Taking " + want.Count + (want.Count == 1 ? " file, " : " files, ") + Mb(total) + " MB out of the update package.");
                long got = 0; int quarter = 0;
                PlayProgress.Bytes("Updating", 0, total);
                foreach (KeyValuePair<string, long> f in want)
                {
                    long before = got;
                    fetch(f.Key, f.Value, Path.Combine(stage, f.Key),
                          delegate(long had) { PlayProgress.Bytes("Updating", before + Math.Min(had, f.Value), total); });
                    got += f.Value;
                    PlayProgress.Bytes("Updating", got, total);
                    int now = total > 0 ? (int)(got * 4 / total) : 4;
                    if (now > quarter && now < 4 && total > 20L * 1048576) log("  " + Mb(got) + " of " + Mb(total) + " MB");
                    quarter = now;
                }
                log("Every file checked against its checksum.");
            }

            var plan = new SyncPlan();
            plan.Fetch = fetch;
            plan.Stage = stage;
            plan.Record = r;
            plan.Items = items;
            plan.Need = need;
            plan.Gone = gone;
            plan.Listed = listed;
            plan.Client = client;
            plan.Total = total;
            plan.Fetched = want.Count;
            return plan;
        }

        /// <summary>
        /// The update's second half (#2210): puts what PrepareSync downloaded
        /// in place, takes out what the release says is gone, and records the
        /// release. The caller holds the game folder (OwnGame.Alone), so a
        /// refresh is not writing beside it. A file that matched at the check
        /// and has been changed since, by a refresh that ran while the update
        /// downloaded, is compared again, and fetched when it now differs.
        /// </summary>
        public static void WriteSync(Config cfg, SyncPlan plan, Action<string> log)
        {
            string stage = plan.Stage;
            RecordRef r = plan.Record;
            List<SyncItem> items = plan.Items;
            var need = new List<SyncItem>(plan.Need);
            List<KeyValuePair<string, string>> gone = plan.Gone;
            HashSet<string> listed = plan.Listed, client = plan.Client;
            long total = plan.Total;
            int fetched = plan.Fetched;
            PlayProgress.Plan("Updating", 0, "files");

            var wanted = new HashSet<SyncItem>(need);
            int again = 0;
            foreach (SyncItem it in items)
            {
                if (wanted.Contains(it) || OwnGame.Identity(it.Dest) == it.Seen) continue;
                if (Matches(it.Dest, it.Bytes, it.Sha)) continue;
                need.Add(it);
                again++;
                string blob = Path.Combine(stage, it.Sha);
                if (!File.Exists(blob))
                {
                    plan.Fetch(it.Sha, it.Bytes, blob, null);
                    total += it.Bytes;
                    fetched++;
                }
            }
            if (again > 0)
                log(again + (again == 1 ? " file of this release was" : " files of this release were") +
                    " changed while it downloaded, by Thornswood's own Skyrim folder being brought up to date, and " +
                    (again == 1 ? "goes" : "go") + " in as the release has " + (again == 1 ? "it." : "them."));

            // ---- put them in place ------------------------------------------
            var newInGame = new List<string>();
            var gameWritten = new List<string>();
            bool carriedProfile = false;
            foreach (SyncItem it in need)
            {
                string src = Path.Combine(stage, it.Sha);
                Directory.CreateDirectory(Path.GetDirectoryName(it.Dest));
                bool existed = File.Exists(it.Dest);
                if (existed)
                {
                    // In a game folder made of links, writing over a linked
                    // file would rewrite Vortex's copy with it (Install).
                    if (it.InGame) OwnGame.Unshare(it.Dest);
                    try { if (File.Exists(it.Dest)) File.SetAttributes(it.Dest, FileAttributes.Normal); }
                    catch (Exception ex) { Swallow.Note("Updater.Sync, attributes", ex); }
                }
                File.Copy(src, it.Dest, true);
                if (it.InGame)
                {
                    gameWritten.Add(it.Rel);
                    if (!existed) newInGame.Add(it.Rel);
                }
                else if (it.Rel.Equals("plugins.txt", StringComparison.OrdinalIgnoreCase) ||
                         it.Rel.Equals("loadorder.txt", StringComparison.OrdinalIgnoreCase))
                    carriedProfile = true;
            }

            // ---- and what the release says is gone --------------------------
            // "always" is a path taken out of every install whatever put it
            // there (Ship-Rules' delete list), like a line in a pack's
            // delete.txt. A 64-hex value is the sha256 of bytes we once
            // shipped (#1261): delete only when the file still matches, so a
            // copy a person installed themselves is never touched. Any other
            // value is a file of ours a release stopped shipping: left alone
            // when Vortex has deployed that path since, the same rule
            // RemovePack keeps, because then it is the collection's file and
            // not ours. Hash-matched paths also skip when Vortex deploys them.
            var removed = new List<string>();
            HashSet<string> deployed = null;
            int shared = 0;
            foreach (KeyValuePair<string, string> g in gone)
            {
                string full;
                try { full = Path.GetFullPath(Path.Combine(Paths.Game, g.Key)); } catch { continue; }
                if (!PathFence.Inside(full, Paths.Game)) continue;
                string rel = full.Substring(Paths.Game.TrimEnd('\\', '/').Length).TrimStart('\\', '/');
                if (listed.Contains(rel) || client.Contains(rel) || !File.Exists(full)) continue;
                bool always = string.Equals(g.Value, "always", StringComparison.OrdinalIgnoreCase);
                bool byHash = IsSha(g.Value);
                if (!always)
                {
                    if (deployed == null) deployed = DeployedNow(cfg);
                    if (deployed.Contains(rel)) { shared++; continue; }
                }
                if (byHash)
                {
                    try
                    {
                        if (!string.Equals(Sha256(full), g.Value, StringComparison.OrdinalIgnoreCase))
                            continue;
                    }
                    catch (Exception ex) { Swallow.Note("Updater.Sync, hash gone", ex); continue; }
                }
                try
                {
                    File.SetAttributes(full, FileAttributes.Normal);
                    File.Delete(full);
                    removed.Add(rel);
                    log("removed " + rel);
                }
                catch (Exception ex) { Swallow.Note("Updater.Sync, delete", ex); }
            }

            if (carriedProfile)
            {
                try
                {
                    if (Verify.SettleLoadOrder() > 0)
                        log("The plugin list this update carried is in place, so the load order is right without pressing Fix.");
                }
                catch (Exception ex)
                {
                    log("Could not put this update's plugin list in place: " + ex.Message + ". Press Fix in the launcher.");
                }
            }
            Swap.RepairConfigs();
            NoteInstalledIntoGame(newInGame);
            int kept = Keep.Remember(gameWritten);
            if (kept > 0) log("Kept " + kept + " of " + Keep.Build() + "'s own game " + (kept == 1 ? "file" : "files") + " to put back if another server or build changes " + (kept == 1 ? "it." : "them."));
            Keep.Forget(removed);

            // The list first, so an install that says it is on this release
            // always has the list of its files (#1232).
            WriteReleaseFiles(r, listed);
            SyncState state = ReadSyncState();
            state.Synced = r.sha256;
            state.SyncedId = r.id;
            WriteSyncState(state);
            if (plan.Close != null) plan.Close();
            try { Directory.Delete(stage, true); } catch (Exception ex) { Swallow.Note("Updater.Sync, tidy", ex); }

            string msg = "Release " + r.id + ": " + items.Count + " files checked, " + need.Count +
                         (need.Count == 1 ? " file" : " files") + " put right";
            if (fetched > 0) msg += " (" + Mb(total) + " MB from the update package)";
            if (removed.Count > 0) msg += ", " + removed.Count + " removed";
            msg += ".";
            if (shared > 0) msg += " " + shared + (shared == 1 ? " file this release no longer ships is" : " files this release no longer ships are") + " the collection's now and stayed.";
            log(msg);
        }

        static string Mb(long b)
        {
            return (b / 1048576.0).ToString("0.0", CultureInfo.InvariantCulture);
        }

        static bool ReadEntry(string v, out long bytes, out string sha)
        {
            bytes = 0; sha = "";
            if (v == null) return false;
            int c = v.IndexOf(':');
            if (c <= 0) return false;
            if (!long.TryParse(v.Substring(0, c), NumberStyles.None, CultureInfo.InvariantCulture, out bytes)) return false;
            sha = v.Substring(c + 1).ToLowerInvariant();
            return IsSha(sha);
        }

        static bool Matches(string file, long bytes, string sha)
        {
            try
            {
                var fi = new FileInfo(file);
                if (!fi.Exists) return false;
                if (bytes >= 0 && fi.Length != bytes) return false;
                return string.Equals(Sha256(file), sha, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception ex)
            {
                Swallow.Note("Updater.Matches", ex);
                return false;
            }
        }
    }

}
