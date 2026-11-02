using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text.RegularExpressions;
using Velopack;
using Velopack.Locators;

namespace Thornswood
{
    /// <summary>
    /// THE GAME FILES FROM THE VELOPACK PACKAGE, ON DEV (#4825). The plan has
    /// one update channel carry both the launcher and the game payload, so on
    /// the dev channel (Velo.GameFromPackage, which says why main is not yet)
    /// each launcher update's package is also where Thornswood's game files
    /// come from, and the feed's release record and packs are not offered
    /// (Sync.cs, Pending).
    ///
    /// They go in the way a release record's files do, through Sync.cs's own
    /// compare and write (PlanSync, WriteSync), so everything that keeps track
    /// of the game folder is kept the same way for both: release.txt and
    /// release-files.txt (here naming the merge release's tag and the sha256
    /// of its game-files.json), Keep, installed-into-game.txt, the files the
    /// release no longer ships (game-files.json's "gone", written as a
    /// record's :gone:), the reference load order (the package's
    /// profile\plugins.txt and loadorder.txt, as a record's :golden:), and the
    /// six client files, which stay ClientRuntime's. Only where a file's bytes
    /// come from differs: out of the package FetchLauncher checked file by
    /// file against the signed lists (VeloPackage.cs), or, for a repair, out
    /// of the installed package's folder, each checked against the signed
    /// game-files.json of the installed version as it is copied.
    ///
    /// The rest of what the package carries beside Game (config.json,
    /// applied.txt, the source note and the licence texts) is the install's
    /// (InstallSteps.cs), read once on the first start; an update does not lay
    /// it again, as no update did before.
    /// </summary>
    static partial class Updater
    {
        static readonly string[] GoldenFiles = { "plugins.txt", "loadorder.txt" };

        /// <summary>True when a repair can put Thornswood's own files back: from the installed package on dev, or from the feed's record.</summary>
        public static bool CanResync(Config cfg, VersionDoc v)
        {
            return Velo.GameFromPackage(cfg) || (v != null && v.record != null);
        }

        /// <summary>
        /// The update's first half for the game files of a checked launcher
        /// package: compares the game folder with the package's lists and takes
        /// every file that differs out of the package into Profile\Sync. Writes
        /// nothing into the game folder; WriteSync does, under OwnGame.Alone.
        /// </summary>
        internal static SyncPlan PreparePackage(LauncherUpdate u, Action<string> log)
        {
            if (u == null || !u.Checked || u.Record == null || u.Game == null || u.Setup == null || string.IsNullOrEmpty(u.Package))
                throw new Exception("The launcher update was not downloaded and checked, so no game file is taken from it.");
            var src = PackageSource.FromPackage(u.Package, u.Game, u.Setup);
            SyncPlan plan;
            try { plan = PlanSync(PackageRecord(u.Record), null, PackageMap(u.Game, u.Setup), src.Fetch, true, log); }
            finally { src.Close(); }
            plan.Close = src.Close;
            return plan;
        }

        /// <summary>
        /// A repair on dev: the game folder checked against the installed
        /// version's signed lists, and anything missing or changed put back
        /// from the installed package's own folder. The caller holds the game
        /// folder (OwnGame.Alone). False when Velopack did not install this
        /// launcher.
        /// </summary>
        static bool ResyncFromPackage(Config cfg, Action<string> log)
        {
            IVelopackLocator at = Velo.Locator;
            if (!Velo.Installed || at == null || at.CurrentlyInstalledVersion == null) return false;
            string said;
            VeloRecord.Manifest m = VeloRecord.Get(at.CurrentlyInstalledVersion, out said);
            if (said.Length > 0) log(said);
            VeloRecord.GameList game = VeloRecord.Game(m);
            VeloRecord.GameList setup = VeloRecord.Setup(m, Velo.ChannelFor(cfg));
            var src = PackageSource.FromFolder(at.AppContentDir, game, setup);
            SyncPlan plan = PlanSync(PackageRecord(m), null, PackageMap(game, setup), src.Fetch, true, log);
            plan.Close = src.Close;
            WriteSync(cfg, plan, log);
            return true;
        }

        /// <summary>
        /// Thornswood's own plugins as the installed package ships them, for
        /// Fix (Verify.Fix), the way ReleaseCopy gives them from the feed's
        /// record: a plugin's bytes, checked against the installed version's
        /// signed game-files.json, or null when the package does not ship it.
        /// </summary>
        static Func<string, byte[]> PackageCopy(Config cfg)
        {
            Dictionary<string, VeloRecord.GameFile> files = null;
            string folder = null;
            return delegate(string plugin)
            {
                if (string.IsNullOrEmpty(plugin) || plugin.IndexOfAny(new[] { '\\', '/', ':' }) >= 0 ||
                    !Regex.IsMatch(plugin, @"\.(esp|esm|esl)$", RegexOptions.IgnoreCase))
                    return null;
                if (files == null)
                {
                    IVelopackLocator at = Velo.Locator;
                    if (!Velo.Installed || at == null || at.CurrentlyInstalledVersion == null) return null;
                    string said;
                    VeloRecord.GameList game = VeloRecord.Game(VeloRecord.Get(at.CurrentlyInstalledVersion, out said));
                    var map = new Dictionary<string, VeloRecord.GameFile>(StringComparer.OrdinalIgnoreCase);
                    foreach (VeloRecord.GameFile f in game.Files) if (f != null && f.Path != null) map[f.Path.Replace('\\', '/')] = f;
                    folder = Path.Combine(at.AppContentDir, "Game");
                    files = map;
                }
                VeloRecord.GameFile want;
                if (!files.TryGetValue("Data/" + plugin, out want)) return null;
                byte[] b = File.ReadAllBytes(Path.Combine(folder, "Data", plugin));
                if (b.LongLength != want.Size || !string.Equals(VeloRecord.Sha256(b), want.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("Data\\" + plugin + " in the installed launcher's package is not the one its signed list names.");
                return b;
            };
        }

        /// <summary>
        /// The record the package's files are synced as: the merge release's
        /// tag, and the sha256 of its game-files.json, which the signed record
        /// lists. release.txt and release-files.txt name these.
        /// </summary>
        static RecordRef PackageRecord(VeloRecord.Manifest m)
        {
            VeloRecord.PartFile f = m.File("game", "game-files.json");
            if (f == null || !IsSha((f.Sha256 ?? "").ToLowerInvariant()))
                throw new Exception("The release record of " + m.Tag + " lists no game-files.json, so its game files cannot be synced to.");
            var r = new RecordRef();
            r.id = m.Tag;
            r.sha256 = f.Sha256.ToLowerInvariant();
            return r;
        }

        /// <summary>
        /// The package's lists in a release record's shape (Sync.cs): each game
        /// file as "size:sha256" by its path, each gone file under :gone:, and
        /// the reference load order under :golden:.
        /// </summary>
        static Dictionary<string, string> PackageMap(VeloRecord.GameList game, VeloRecord.GameList setup)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (VeloRecord.GameFile f in game.Files)
                map[f.Path] = f.Size.ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + f.Sha256.ToLowerInvariant();
            if (game.Gone != null)
                foreach (VeloRecord.GoneFile g in game.Gone)
                    if (g != null && !string.IsNullOrEmpty(g.Path)) map[GoneMark + g.Path] = g.Value ?? "";
            foreach (VeloRecord.GameFile f in setup.Files)
            {
                foreach (string leaf in GoldenFiles)
                    if (string.Equals(f.Path, "profile/" + leaf, StringComparison.OrdinalIgnoreCase))
                        map[GoldenMark + leaf] = f.Size.ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + f.Sha256.ToLowerInvariant();
            }
            return map;
        }

        /// <summary>
        /// Where a package's files are read from: the package itself, or the
        /// folder Velopack unpacked the installed one into. Each file is found
        /// by its sha256 through the signed lists, copied, and checked against
        /// that sha256 before it is used.
        /// </summary>
        sealed class PackageSource
        {
            readonly Dictionary<string, string> bySha = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            readonly string package, folder;
            readonly object gate = new object();
            ZipArchive zip;
            Dictionary<string, ZipArchiveEntry> entries;

            PackageSource(string package, string folder, VeloRecord.GameList game, VeloRecord.GameList setup)
            {
                this.package = package;
                this.folder = folder;
                foreach (VeloRecord.GameFile f in game.Files) bySha[f.Sha256] = "Game/" + f.Path.Replace('\\', '/');
                foreach (VeloRecord.GameFile f in setup.Files) if (!bySha.ContainsKey(f.Sha256)) bySha[f.Sha256] = f.Path.Replace('\\', '/');
            }

            public static PackageSource FromPackage(string nupkg, VeloRecord.GameList game, VeloRecord.GameList setup)
            {
                return new PackageSource(nupkg, null, game, setup);
            }

            public static PackageSource FromFolder(string dir, VeloRecord.GameList game, VeloRecord.GameList setup)
            {
                return new PackageSource(null, dir, game, setup);
            }

            public void Fetch(string sha, long bytes, string dest, Action<long> onBytes)
            {
                if (File.Exists(dest))
                {
                    if (Matches(dest, bytes, sha)) return;
                    File.Delete(dest);
                }
                string rel;
                if (!bySha.TryGetValue(sha, out rel)) throw new Exception("The update package's lists name no file with the checksum " + sha + ".");
                string part = dest + ".part";
                lock (gate)
                {
                    using (Stream from = Open(rel))
                    using (var to = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        var buf = new byte[81920];
                        long had = 0;
                        int n;
                        while ((n = from.Read(buf, 0, buf.Length)) > 0)
                        {
                            to.Write(buf, 0, n);
                            had += n;
                            if (onBytes != null) onBytes(had);
                        }
                    }
                }
                if (!Matches(part, bytes, sha))
                {
                    try { File.Delete(part); } catch (Exception ex) { Swallow.Note("Updater.PackageSource, delete", ex); }
                    throw new Exception(rel + " in the update package did not match its checksum, so it was not used.");
                }
                File.Move(part, dest);
            }

            Stream Open(string rel)
            {
                if (folder != null) return File.OpenRead(Path.Combine(folder, rel.Replace('/', Path.DirectorySeparatorChar)));
                if (zip == null)
                {
                    zip = ZipFile.OpenRead(package);
                    entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
                    // NuGet writes each name escaped (VeloPackage.cs).
                    foreach (ZipArchiveEntry e in zip.Entries)
                        entries[Uri.UnescapeDataString(e.FullName.Replace('\\', '/')).TrimStart('/')] = e;
                }
                ZipArchiveEntry found;
                if (!entries.TryGetValue("lib/app/" + rel, out found)) throw new Exception("The update package has no " + rel + ".");
                return found.Open();
            }

            public void Close()
            {
                lock (gate)
                {
                    if (zip != null) { zip.Dispose(); zip = null; entries = null; }
                }
            }
        }
    }
}
