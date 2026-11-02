using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// AN UPDATE IN TWO HALVES (#2210). Patrick decided on 12 Oct: the game
    /// folder is prepared during the update's download, not after it. Until
    /// then Install now refused while Thornswood's own Skyrim folder was being
    /// prepared ("The update can go in when that is done"), so a Vortex deploy
    /// noticed at a start held Play for the refresh and then for the whole
    /// download after it.
    ///
    /// FetchUpdate is the first half: it downloads everything the update needs
    /// (the release's files into Profile\Sync, a pack's zip, the new
    /// launcher's Velopack package, checked) and writes nothing into the game folder, nor into the records a refresh
    /// reads to tell Thornswood's files from Vortex's (Profile\Packs, Keep,
    /// release.txt's synced line, release-files.txt). So it runs beside a
    /// refresh. WriteUpdate is the second half, and the caller runs it under
    /// OwnGame.Alone, so it waits for a refresh under way and no refresh
    /// starts writing while it does: both keep records of the folder, and one
    /// changing them under the other would leave either record wrong.
    ///
    /// The launcher itself is put in last, once the release is: ApplyLauncher
    /// hands the checked package to Velopack, which applies it when this
    /// launcher has closed (VeloUpdate.cs, Velo.ExitApply).
    /// </summary>
    static partial class Updater
    {
        /// <summary>What FetchUpdate downloaded, waiting to be written.</summary>
        public sealed class Fetched
        {
            internal SyncPlan Release;
            // Each pack in feed order with its downloaded zip, or null when it
            // is already in.
            internal readonly List<KeyValuePair<Pack, string>> Zips = new List<KeyValuePair<Pack, string>>();
            // The new launcher, downloaded and checked, or null.
            internal LauncherUpdate Launcher;
        }

        /// <summary>
        /// The first half: downloads <paramref name="packs"/> (the release, or
        /// the packs) and, when <paramref name="launcher"/> is given, that
        /// launcher's package, with every check FetchLauncher makes. Throws
        /// with nothing written into the game folder; what it had downloaded
        /// is deleted then, except the release's files in Profile\Sync, which
        /// the next try takes up where this one stopped, and a launcher package
        /// that passed its checks, which Velopack keeps in its packages folder
        /// and the next try checks again before it is used.
        /// </summary>
        public static Fetched FetchUpdate(Config cfg, List<Pack> packs, LauncherUpdate launcher, Action<string> log)
        {
            var got = new Fetched();
            try
            {
                int dead = 0;
                foreach (Pack p in packs)
                {
                    if (p == null) continue;
                    // A pack published with no url is unusable and always will
                    // be: there is nothing at the other end to download. It is
                    // not a network problem and retrying never clears it, so
                    // stopping the whole update on it means the Play button
                    // stays off forever, for everyone, including whoever would
                    // have to publish the fix. Skip it, say so, and let the
                    // packs that do have somewhere to download from go in.
                    if (string.IsNullOrEmpty(p.url) || p.url.Trim().Length == 0)
                    {
                        dead++;
                        log("Skipping " + p.id + ": it was published without a download link, so there is nothing to fetch. It will not be offered again.");
                        Skip(p.id);
                        continue;
                    }
                    if (p.Record != null)
                    {
                        // A whole release, synced to its record; when the record
                        // does not say its files are on the site, the packs.
                        got.Release = PrepareRecord(cfg, p.Record, p.Doc, log);
                        if (got.Release == null) FetchPacks(cfg, Pending(cfg, p.Doc), got, log);
                        continue;
                    }
                    FetchPack(cfg, p, got, log);
                }
                if (dead > 0)
                    log(dead + " update" + (dead == 1 ? " was" : "s were") + " published without a download link and had to be skipped. Whatever was in " + (dead == 1 ? "it" : "them") + " comes back in the next one.");
                if (launcher != null)
                {
                    FetchLauncher(launcher, log);
                    got.Launcher = launcher;
                    // On dev the package carries the game files too, and they
                    // go in with WriteUpdate like a release's (SyncPackage.cs).
                    if (Velo.GameFromPackage(cfg)) got.Release = PreparePackage(launcher, log);
                }
                return got;
            }
            catch
            {
                Drop(got);
                throw;
            }
        }

        /// <summary>The packs of a release whose record does not carry its files, in feed order.</summary>
        static void FetchPacks(Config cfg, List<Pack> packs, Fetched got, Action<string> log)
        {
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
                FetchPack(cfg, p, got, log);
            }
        }

        /// <summary>One pack's zip, unless it is already in (ApplyPack's rule).</summary>
        static void FetchPack(Config cfg, Pack p, Fetched got, Action<string> log)
        {
            if (IsInstalled(p.id))
            {
                log(p.id + " is already in.");
                got.Zips.Add(new KeyValuePair<Pack, string>(p, null));
                return;
            }
            log("Downloading " + p.id + "...");
            got.Zips.Add(new KeyValuePair<Pack, string>(p, Download(cfg, p.url, p.sha256, log)));
        }

        /// <summary>
        /// The second half: the release's files, or each pack in turn, into
        /// the game folder and the records. The caller holds the folder
        /// (OwnGame.Alone). The launcher is not put in here; ApplyLauncher
        /// does that after, with Fetched.Launcher.
        /// </summary>
        public static void WriteUpdate(Config cfg, Fetched got, Action<string> log)
        {
            if (got.Release != null) WriteSync(cfg, got.Release, log);
            for (int i = 0; i < got.Zips.Count; i++)
            {
                KeyValuePair<Pack, string> z = got.Zips[i];
                if (z.Value == null) continue;
                try { Install(z.Value, z.Key, log); }
                finally
                {
                    try { File.Delete(z.Value); } catch (Exception ex) { Swallow.Note("Updater.WriteUpdate, delete", ex); }
                    got.Zips[i] = new KeyValuePair<Pack, string>(z.Key, null);
                }
            }
        }

        /// <summary>The new launcher FetchUpdate downloaded and checked, or null when the update has none.</summary>
        public static LauncherUpdate LauncherOf(Fetched got)
        {
            return got == null ? null : got.Launcher;
        }

        /// <summary>
        /// Deletes what an update downloaded and did not write: the zips. The
        /// release's files stay in Profile\Sync for the next try (FetchInto
        /// keeps a file that is already right), and a launcher package that
        /// passed its checks stays in Velopack's packages folder, where the
        /// next try finds it and checks it again (FetchLauncher).
        /// </summary>
        public static void Drop(Fetched got)
        {
            if (got == null) return;
            foreach (KeyValuePair<Pack, string> z in got.Zips)
            {
                if (z.Value == null) continue;
                try { File.Delete(z.Value); } catch (Exception ex) { Swallow.Note("Updater.Drop, zip", ex); }
            }
            got.Zips.Clear();
            got.Launcher = null;
            if (got.Release != null && got.Release.Close != null) got.Release.Close();
        }
    }
}
