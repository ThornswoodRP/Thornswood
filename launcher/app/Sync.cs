using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// SYNCING TO THE RELEASE RECORD (#1050). Patrick, 29 Sep: the launcher
    /// fetches each file straight from the site by its fingerprint, syncing the
    /// install to the release record, instead of replaying the chain of packs.
    ///
    /// Until this a launcher only ever replayed packs: every pack id not in
    /// applied.txt, in feed order, each one a zip of what changed. It never
    /// knew what a release was supposed to leave installed, so a file changed
    /// by hand, a lost applied.txt or a pack that 404ed left an install that
    /// no later update could put right, and the feed had to keep every pack
    /// ever published (76 on main, 82 on dev, most of version.json).
    ///
    /// Now, when the feed names a record whose files are all on the site, the
    /// launcher reads it and compares every file of ours in the install with
    /// it, by size and then sha256. Only a file that differs is downloaded,
    /// from /feed[-dev]/assets/&lt;sha256&gt; beside the record, checked against
    /// that sha256, and put in place. Files of ours the record says are gone
    /// are taken out. A download cut short carries on where it stopped, and a
    /// file already fetched before an interruption is not fetched again.
    ///
    /// The launcher exe is not part of this: it updates through Velopack
    /// (VeloUpdate.cs), with every check that file's header lists.
    ///
    /// ON DEV THE GAME FILES COME FROM THE VELOPACK PACKAGE, NOT FROM HERE
    /// (#4825; the plan: "one update channel carries both the launcher and
    /// the game payload"). A launcher Velopack installed on the dev channel
    /// (Velo.GameFromPackage) takes Thornswood's game files from the checked
    /// package of each update (SyncPackage.cs), and this file's record and
    /// packs are never offered to it (Pending, RecordDue). What the package
    /// brings goes in through this file's own write all the same (WriteSync),
    /// so release.txt, release-files.txt, Keep, installed-into-game.txt, the
    /// gone and golden entries and the client files left to ClientRuntime are
    /// kept one way for both. Main stays on the feed's record until main has
    /// packages (#5181); then the line in Velo.GameFromPackage moves and this
    /// file's fetching from the site retires with the feed.
    /// </summary>
    static partial class Updater
    {
        /// <summary>
        /// The key a record carries when every file it lists is on the site
        /// beside it. Publish-Update.ps1 writes it only after sending them.
        /// A record without it (every release before #1050) is not synced
        /// to: the launcher takes the packs as it always did.
        /// </summary>
        public const string RecordFilesMark = ":record:files";
        const string GoldenMark = ":golden:";
        const string GoneMark = ":gone:";

        internal static bool IsSha(string s) { return RecordRef.IsSha(s); }

        // ---- what this install last synced to ---------------------------------
        //
        // Profile\release.txt: "synced <sha256> <id>" once a sync finishes, and
        // "packs <sha256>" for a record that carries no RecordFilesMark, so it is
        // not downloaded again on every check. Read on every check; a few bytes.

        class SyncState
        {
            public string Synced = "";
            public string SyncedId = "";
            public string PacksOnly = "";
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
                    else if (w[0] == "packs") s.PacksOnly = w[1].ToLowerInvariant();
                }
            }
            catch (Exception ex) { Swallow.Note("Updater.ReadSyncState", ex); }
            return s;
        }

        static void WriteSyncState(SyncState s)
        {
            var lines = new List<string>();
            if (s.Synced.Length > 0) lines.Add("synced " + s.Synced + (s.SyncedId.Length > 0 ? " " + s.SyncedId : ""));
            if (s.PacksOnly.Length > 0) lines.Add("packs " + s.PacksOnly);
            // Whole or not at all (#2591): deleting release.txt and then moving
            // the new one in left no record when the launcher was stopped in
            // between, and the next start read that as never synced.
            OwnGame.WriteRecord(SyncStateFile, lines);
        }

        /// <summary>The release this install last synced to, or "" when it has
        /// never synced to one (it is on packs, or has not updated yet).</summary>
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
        /// The update Pending offers when the feed names a record this install
        /// has not synced to: one entry standing for the whole release, so the
        /// card, the in play clock and Install now need nothing new. Null when
        /// the feed names none, this install is on it already, or it was found
        /// to carry no RecordFilesMark.
        /// </summary>
        static Pack RecordDue(Config cfg, VersionDoc v)
        {
            // On dev the package of each launcher update carries the game
            // files (header; Velo.GameFromPackage), so the feed's record is
            // not this install's to sync to.
            if (Velo.GameFromPackage(cfg)) return null;
            RecordRef r = v == null ? null : v.record;
            if (r == null) return null;
            SyncState s = ReadSyncState();
            // Synced by a launcher from before #1232, which kept no list of the
            // release's files: checked against it once more, which downloads
            // nothing that is already right, and the list is kept this time.
            if ((s.Synced == r.sha256 && ReleaseFilesSha() == r.sha256) || s.PacksOnly == r.sha256) return null;
            var p = new Pack();
            p.id = "release " + r.id;
            p.url = r.url;
            p.sha256 = r.sha256;
            p.notes = r.notes.Length > 0 ? r.notes : LastNotes(v);
            p.Record = r;
            p.Doc = v;
            return p;
        }

        /// <summary>
        /// The note of the last pack on the feed, for a feed whose record does
        /// not carry its own (every one before #1050 took the packs off the
        /// feed). Once the feed's "packs" is empty, there is none to find here
        /// and the record's own note is the one shown.
        /// </summary>
        static string LastNotes(VersionDoc v)
        {
            if (v == null || v.packs == null) return "";
            for (int i = v.packs.Length - 1; i >= 0; i--)
                if (v.packs[i] != null && !string.IsNullOrEmpty(v.packs[i].notes)) return v.packs[i].notes;
            return "";
        }

        /// <summary>
        /// The folder the record's files are in: its own url up to its name.
        /// A record is named by its sha256 like every asset, and Publish-Update
        /// puts every file it lists beside it, so a file's address is this
        /// plus the file's sha256 and never anything the feed spells out.
        /// </summary>
        static string AssetFolder(RecordRef r)
        {
            string u = r.url;
            int q = u.IndexOfAny(new[] { '?', '#' });
            if (q >= 0) u = u.Substring(0, q);
            if (!u.EndsWith("/" + r.sha256, StringComparison.OrdinalIgnoreCase))
                throw new Exception("The update feed names a release record that is not stored under its own checksum. Nothing was downloaded.");
            return u.Substring(0, u.Length - r.sha256.Length);
        }

        /// <summary>
        /// Brings the install to the release the feed names. Falls back to the
        /// packs, in feed order, when that release's record does not say its
        /// files are on the site.
        /// </summary>
        public static void SyncRecord(Config cfg, RecordRef r, VersionDoc v, Action<string> log)
        {
            // Where every byte comes from is decided here, once: https, and a
            // host on the allow list. Every file after this is this address
            // plus 64 hex characters, so it cannot be anywhere else.
            CheckUrl(r.url);
            string at = AssetFolder(r);
            if (Sync(cfg, at, r, v, log)) return;

            List<Pack> packs = Pending(cfg, v);
            int count = 0;
            foreach (Pack p in packs) if (p != null && p.Record == null && !string.IsNullOrEmpty(p.url) && p.url.Trim().Length > 0) count++;
            PlayProgress.Plan("Updating", count, "updates");
            foreach (Pack p in packs)
            {
                if (p == null || p.Record != null) continue;
                if (string.IsNullOrEmpty(p.url) || p.url.Trim().Length == 0)
                {
                    log("Skipping " + p.id + ": it was published without a download link, so there is nothing to fetch. It will not be offered again.");
                    Skip(p.id);
                    continue;
                }
                ApplyPack(cfg, p, log);
            }
        }

        /// <summary>
        /// Checks the install against the record the feed names now and puts
        /// right anything that differs, whether or not it synced to it before.
        /// For a repair. False when the feed names no record it can sync to.
        /// </summary>
        public static bool Resync(Config cfg, VersionDoc v, Action<string> log)
        {
            // On dev the files are the installed package's (SyncPackage.cs).
            if (Velo.GameFromPackage(cfg)) return ResyncFromPackage(cfg, log);
            RecordRef r = v == null ? null : v.record;
            if (r == null) return false;
            CheckUrl(r.url);
            string at = AssetFolder(r);
            return Sync(cfg, at, r, v, log);
        }

        /// <summary>
        /// Thornswood's own plugins as the release the feed names ships them
        /// (#3386), for Fix: a plugin's bytes, or null when the release does
        /// not ship it or its record does not say its files are on the site.
        /// Null itself when the feed names no record.
        ///
        /// Until #3386 Fix took them from the game server's resources port,
        /// over plain http, and checked them against the size and crc32 of
        /// that same server's manifest, so anybody on the path could hand
        /// over another plugin with the numbers to match. Here every byte
        /// comes the way an update's do: https to a host on the list, the
        /// record by the sha256 the feed gives it, each file by the sha256
        /// the record gives it.
        /// </summary>
        public static Func<string, byte[]> ReleaseCopy(Config cfg, VersionDoc v)
        {
            // On dev the plugins are the installed package's (SyncPackage.cs).
            if (Velo.GameFromPackage(cfg)) return PackageCopy(cfg);
            RecordRef r = v == null ? null : v.record;
            if (r == null) return null;
            Func<string, byte[]> at = null;
            return delegate(string plugin)
            {
                if (at == null)
                {
                    CheckUrl(r.url);
                    at = ReleaseCopyAt(AssetFolder(r), r);
                }
                return at(plugin);
            };
        }

        /// <summary>
        /// ReleaseCopy's reader, with $at the folder the record and its files
        /// are in (checked by the caller). The record is read once, on the
        /// first plugin asked for. launcher\tests\test-2627-scan-fix.ps1 calls
        /// this with a copy of the site on this machine.
        /// </summary>
        internal static Func<string, byte[]> ReleaseCopyAt(string at, RecordRef r)
        {
            Dictionary<string, string> map = null;
            return delegate(string plugin)
            {
                // A plugin by its bare name, in Data, and nothing else of the
                // release: the name comes from the game server's manifest.
                if (string.IsNullOrEmpty(plugin) || plugin.IndexOfAny(new[] { '\\', '/', ':' }) >= 0 ||
                    !System.Text.RegularExpressions.Regex.IsMatch(plugin, @"\.(esp|esm|esl)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                    return null;
                string tmp = Path.Combine(Path.GetTempPath(), "thornswood-release-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(tmp);
                try
                {
                    if (map == null)
                    {
                        string recFile = Path.Combine(tmp, "record.json");
                        FetchInto(at + r.sha256, r.sha256, -1, recFile);
                        map = ReadRecord(recFile);
                    }
                    if (!map.ContainsKey(RecordFilesMark)) return null;
                    string want = "Data\\" + plugin;
                    foreach (KeyValuePair<string, string> e in map)
                    {
                        if (e.Key.StartsWith(":", StringComparison.Ordinal)) continue;
                        if (!string.Equals(e.Key.Replace('/', '\\'), want, StringComparison.OrdinalIgnoreCase)) continue;
                        long bytes; string sha;
                        if (!ReadEntry(e.Value, out bytes, out sha))
                            throw new Exception("The record of release " + r.id + " has an entry that is not a size and a checksum (" + e.Key + ").");
                        string blob = Path.Combine(tmp, sha);
                        FetchInto(at + sha, sha, bytes, blob);
                        return File.ReadAllBytes(blob);
                    }
                    return null;
                }
                finally
                {
                    try { Directory.Delete(tmp, true); } catch (Exception ex) { Swallow.Note("Updater.ReleaseCopy, tidy", ex); }
                }
            };
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
            // checked against the sha256: from the site beside the record, or
            // out of the Velopack package (SyncPackage.cs).
            internal Blob Fetch;
            // Run once the plan is written or dropped: lets go of the package.
            internal Action Close;
            // True when Fetch reads a file on this PC rather than the site.
            internal bool Local;
            internal string Stage;
            internal RecordRef Record;
            internal VersionDoc Doc;
            internal List<SyncItem> Items, Need;
            internal List<KeyValuePair<string, string>> Gone;
            internal HashSet<string> Listed, Client;
            internal long Total;
            internal int Fetched;
        }

        /// <summary>One file into dest, by its sha256 and size, checked; onBytes may be null.</summary>
        internal delegate void Blob(string sha, long bytes, string dest, Action<long> onBytes);

        /// <summary>
        /// The sync itself. $at is the folder the record and its files are in
        /// (checked by the caller). tests\test-record-sync.ps1 calls this with
        /// a copy of the site on this machine. The two halves are apart so an
        /// update can download while the game folder is prepared and write
        /// once it is done (#2210): PrepareSync writes nothing into the game
        /// folder or the records it is told apart by, and WriteSync does the
        /// rest.
        /// </summary>
        static bool Sync(Config cfg, string at, RecordRef r, VersionDoc v, Action<string> log)
        {
            SyncPlan plan = PrepareSync(cfg, at, r, v, log);
            if (plan == null) return false;
            WriteSync(cfg, plan, log);
            return true;
        }

        /// <summary>
        /// The update's first half for a release record (#2210): checks the
        /// address, reads the record, compares the install with it and
        /// downloads every file that differs into Profile\Sync. Null when the
        /// record does not say its files are on the site, and the release goes
        /// in pack by pack instead.
        /// </summary>
        public static SyncPlan PrepareRecord(Config cfg, RecordRef r, VersionDoc v, Action<string> log)
        {
            CheckUrl(r.url);
            string at = AssetFolder(r);
            return PrepareSync(cfg, at, r, v, log);
        }

        static SyncPlan PrepareSync(Config cfg, string at, RecordRef r, VersionDoc v, Action<string> log)
        {
            string stage = SyncDir;
            Directory.CreateDirectory(stage);

            string recFile = Path.Combine(stage, "record-" + r.sha256 + ".json");
            FetchInto(at + r.sha256, r.sha256, -1, recFile);
            Dictionary<string, string> map = ReadRecord(recFile);

            SyncState state = ReadSyncState();
            if (!map.ContainsKey(RecordFilesMark))
            {
                state.PacksOnly = r.sha256;
                WriteSyncState(state);
                try { File.Delete(recFile); } catch (Exception ex) { Swallow.Note("Updater.Sync, record", ex); }
                log("Release " + r.id + " does not have its files on the site one by one, so it goes in pack by pack.");
                return null;
            }
            return PlanSync(r, v, map, delegate(string sha, long bytes, string dest, Action<long> onBytes) { FetchInto(at + sha, sha, bytes, dest, onBytes); }, false, log);
        }

        /// <summary>
        /// The compare and the fetch, for a record's entries (<paramref name="map"/>,
        /// in the record's shape: game files, :golden: and :gone:) from
        /// wherever <paramref name="fetch"/> takes them. Writes nothing into
        /// the game folder or its records.
        /// </summary>
        static SyncPlan PlanSync(RecordRef r, VersionDoc v, Dictionary<string, string> map, Blob fetch, bool local, Action<string> log)
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
                log((local ? "Taking " : "Downloading ") + want.Count + (want.Count == 1 ? " file, " : " files, ") + Mb(total) + " MB" + (local ? " out of the update package." : "."));
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
            plan.Local = local;
            plan.Stage = stage;
            plan.Record = r;
            plan.Doc = v;
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
            VersionDoc v = plan.Doc;
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

            // Every pack on the feed now is behind this release, so a feed that
            // later stops naming a record replays only packs published after.
            var done = Applied();
            if (v != null && v.packs != null)
                foreach (Pack p in v.packs)
                    if (p != null && !string.IsNullOrEmpty(p.id) && !done.Contains(p.id)) { MarkApplied(p.id); done.Add(p.id); }

            // The list first, so an install that says it is on this release
            // always has the list of its files (#1232).
            WriteReleaseFiles(r, listed);
            SyncState state = ReadSyncState();
            state.Synced = r.sha256;
            state.SyncedId = r.id;
            if (state.PacksOnly == r.sha256) state.PacksOnly = "";
            WriteSyncState(state);
            if (plan.Close != null) plan.Close();
            try { Directory.Delete(stage, true); } catch (Exception ex) { Swallow.Note("Updater.Sync, tidy", ex); }

            string msg = "Release " + r.id + ": " + items.Count + " files checked, " + need.Count +
                         (need.Count == 1 ? " file" : " files") + " put right";
            if (fetched > 0) msg += " (" + Mb(total) + (plan.Local ? " MB from the update package)" : " MB downloaded)");
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

        static Dictionary<string, string> ReadRecord(string file)
        {
            string text = File.ReadAllText(file, Encoding.UTF8);
            var o = Json.Parse(text) as Dictionary<string, object>;
            if (o == null) throw new Exception("The release record is not a list of files. Nothing was changed.");
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, object> e in o)
            {
                var s = e.Value as string;
                if (s == null) throw new Exception("The release record has an entry that is not text (" + e.Key + "). Nothing was changed.");
                map[e.Key] = s;
            }
            return map;
        }

        /// <summary>
        /// One asset into $dest, checked against its sha256 (and its size when
        /// known). A $dest already there with the right bytes is kept, which
        /// is what makes a sync that was cut off after its downloads cost
        /// nothing the second time. A $dest.part left by a download that was
        /// cut off carries on from where it stopped, with a Range request; if
        /// the joined file does not check out, the part is thrown away and
        /// the file fetched whole once more.
        /// </summary>
        static void FetchInto(string url, string sha, long bytes, string dest)
        {
            FetchInto(url, sha, bytes, dest, null);
        }

        /// <param name="onBytes">Bytes of this file on disk so far, for the Play button (#1145). May be null.</param>
        static void FetchInto(string url, string sha, long bytes, string dest, Action<long> onBytes)
        {
            if (File.Exists(dest))
            {
                if (Matches(dest, bytes, sha)) return;
                File.Delete(dest);
            }
            string part = dest + ".part";
            for (int attempt = 0; attempt < 2; attempt++)
            {
                long have = File.Exists(part) ? new FileInfo(part).Length : 0;
                if (bytes < 0 || have > bytes) { if (have > 0) File.Delete(part); have = 0; }
                if (bytes < 0 || have < bytes) Transfer(url, part, have, onBytes);
                if (Matches(part, bytes, sha))
                {
                    File.Move(part, dest);
                    return;
                }
                try { File.Delete(part); } catch (Exception ex) { Swallow.Note("Updater.FetchInto, delete", ex); }
                if (have == 0) break;
            }
            throw new Exception("Checksum did not match. Download rejected.");
        }

        static void Transfer(string url, string part, long from, Action<long> onBytes)
        {
            using (var req = new HttpRequestMessage(HttpMethod.Get, url))
            {
                req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Version);
                req.Headers.TryAddWithoutValidation("Accept", "application/octet-stream");
                if (from > 0) req.Headers.Range = new RangeHeaderValue(from, null);
                // Ten seconds for the answer to start, a minute for each read
                // of it (Http), as the request had them before.
                using (HttpResponseMessage resp = Http.Send(req, 10000))
                {
                    // Anything but a 2xx is an exception, as it was.
                    resp.EnsureSuccessStatusCode();
                    // A server that ignores the Range answers 200 with the whole
                    // file, and then the part starts again from nothing.
                    bool carryOn = from > 0 && resp.StatusCode == HttpStatusCode.PartialContent;
                    using (var f = new FileStream(part, carryOn ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        long had = carryOn ? from : 0;
                        Http.CopyBody(resp, f, 60000, onBytes == null ? (Action<long>)null : n => onBytes(had + n));
                    }
                }
            }
        }
    }

}
