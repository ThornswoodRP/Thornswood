using System;

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
    /// FetchUpdate is the first half: it downloads the new launcher's Velopack
    /// package from GitHub, checks it, and reads the game files it carries
    /// (SyncPackage.cs), writing nothing into the game folder, nor into the
    /// records a refresh reads to tell Thornswood's files from Vortex's
    /// (release.txt's synced line, release-files.txt). So it runs beside a
    /// refresh. WriteUpdate is the second half, and the caller runs it under
    /// OwnGame.Alone, so it waits for a refresh under way and no refresh
    /// starts writing while it does: both keep records of the folder, and one
    /// changing them under the other would leave either record wrong.
    ///
    /// The launcher itself is put in last, once its game files are:
    /// ApplyLauncher hands the checked package to Velopack, which applies it
    /// when this launcher has closed (VeloUpdate.cs, Velo.ExitApply).
    ///
    /// The packs the old update feed listed, and the release record it named,
    /// went with the feed (#5608): every update is one Velopack package.
    /// </summary>
    static partial class Updater
    {
        /// <summary>What FetchUpdate downloaded, waiting to be written.</summary>
        public sealed class Fetched
        {
            internal SyncPlan Release;
            // The new launcher, downloaded and checked, or null.
            internal LauncherUpdate Launcher;
        }

        /// <summary>
        /// The first half: downloads <paramref name="launcher"/>'s package, with
        /// every check FetchLauncher makes, and plans its game files. Throws
        /// with nothing written into the game folder. A package that passed
        /// its checks stays in Velopack's packages folder, and the next try
        /// checks it again before it is used.
        /// </summary>
        public static Fetched FetchUpdate(Config cfg, LauncherUpdate launcher, Action<string> log)
        {
            var got = new Fetched();
            if (launcher == null) return got;
            try
            {
                FetchLauncher(launcher, log);
                got.Launcher = launcher;
                // The package carries the game files too, and they go in with
                // WriteUpdate (SyncPackage.cs).
                if (Velo.GameFromPackage(cfg)) got.Release = PreparePackage(launcher, log);
                return got;
            }
            catch
            {
                Drop(got);
                throw;
            }
        }

        /// <summary>
        /// The second half: the package's game files into the game folder and
        /// the records. The caller holds the folder (OwnGame.Alone). The
        /// launcher is not put in here; ApplyLauncher does that after, with
        /// Fetched.Launcher.
        /// </summary>
        public static void WriteUpdate(Config cfg, Fetched got, Action<string> log)
        {
            if (got.Release != null) WriteSync(cfg, got.Release, log);
        }

        /// <summary>The new launcher FetchUpdate downloaded and checked, or null when the update has none.</summary>
        public static LauncherUpdate LauncherOf(Fetched got)
        {
            return got == null ? null : got.Launcher;
        }

        /// <summary>
        /// Lets go of what an update read and did not write. A launcher package
        /// that passed its checks stays in Velopack's packages folder, where
        /// the next try finds it and checks it again (FetchLauncher).
        /// </summary>
        public static void Drop(Fetched got)
        {
            if (got == null) return;
            got.Launcher = null;
            if (got.Release != null && got.Release.Close != null) got.Release.Close();
        }
    }
}
