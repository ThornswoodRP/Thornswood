using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Velopack;
using Velopack.Locators;
using Velopack.Sources;

namespace Thornswood
{
    /// <summary>
    /// THE LAUNCHER UPDATES THROUGH VELOPACK (#4825). This replaces the
    /// launcher's own self update: version.json's launcherUrl, the download
    /// into %TEMP%, and the swap script that kept Thornswood.exe.old
    /// (SelfSwap.cs, gone with it). Velopack keeps the version before in its
    /// packages folder and applies a new one in a process of its own, so the
    /// way back the swap script was there for is Velopack's.
    ///
    /// What is checked, in order, before an update is applied:
    ///   1. Velopack checks every package it downloads against the sha256 its
    ///      channel's feed names (releases.&lt;channel&gt;.json on the Release).
    ///   2. That sha256 must be the one the Release's signed record lists for
    ///      that file (VeloRecord.Vouches), checked in Velopack's own checksum
    ///      step, so a package nobody signed for is refused before Velopack
    ///      keeps it or takes its Update.exe out of it.
    ///   3. Every file in the package, however it was put together (whole, or
    ///      rebuilt from the version before and its deltas): each game file by
    ///      size and sha256 against the signed game-files.json, each file
    ///      beside them against the signed setup-files.&lt;channel&gt;.json, each program by
    ///      Signature.Refusal (VeloPackage.cs).
    ///   4. The Update.exe Velopack took out of the package, by Signature.Refusal,
    ///      since it is what applies the update.
    /// A refusal deletes the package and says which check it failed; the
    /// launcher that is running is untouched.
    /// </summary>
    static partial class Updater
    {
        /// <summary>A newer launcher on this install's channel, found by CheckLauncher.</summary>
        public sealed class LauncherUpdate
        {
            internal UpdateManager Manager;
            internal UpdateInfo Info;
            /// <summary>The package's version, which is the new launcher's number.</summary>
            public string Version;
            public string Channel;
            /// <summary>The bytes the download is, as the feed gives them: the whole package, or its deltas.</summary>
            public long Size;
            /// <summary>Set by FetchLauncher once the package is downloaded and every check passed.</summary>
            internal bool Checked;
            // What FetchLauncher checked the package against, and where it is:
            // the game files go in from it (SyncPackage.cs).
            internal VeloRecord.Manifest Record;
            internal VeloRecord.GameList Game, Setup;
            internal string Package;
        }

        /// <summary>What the last launcher check found, in words, for launcher.log.</summary>
        public static string LastLauncherCheck = "";

        /// <summary>
        /// Asks this install's channel for a launcher newer than the one
        /// running. Null when there is none, or when Velopack did not install
        /// this launcher (LastLauncherCheck says which). Throws when the
        /// Releases could not be read, which is not the same as no update.
        ///
        /// One request to the site for the list of Releases and one small
        /// download per Release that carries this channel's feed, each through
        /// the site's Release route (ChannelSource, #5608): nothing is asked of
        /// GitHub by this launcher, so no address's sixty anonymous calls an
        /// hour are spent. The caller still does not ask on every feed check
        /// (ShellUpdate.cs, LauncherCheckDue).
        /// </summary>
        public static LauncherUpdate CheckLauncher(Config cfg)
        {
            if (!Velo.Installed)
            {
                LastLauncherCheck = "This launcher was not installed by Thornswood's setup, so it does not update itself.";
                return null;
            }
            string channel = Velo.ChannelFor(cfg);
            var opts = new UpdateOptions();
            opts.ExplicitChannel = channel;
            // The channel's release is the one its newest Release carries
            // (ChannelSource, THE CHANNEL'S RELEASE), so a lower number than
            // this one's is taken too: Velopack alone takes only a higher one.
            opts.AllowVersionDowngrade = true;
            var mgr = new CheckedUpdates(new ChannelSource(channel, 11), opts);
            UpdateInfo info = mgr.CheckForUpdatesAsync().GetAwaiter().GetResult();
            // The collection revision the channel's servers run is the one in
            // the signed record of the Release the channel is on: the one this
            // launcher is going to, or the one it is (#5767). Held to its
            // signature like every record; read once per Release (VeloRecord).
            SemanticVersion on = info != null ? info.TargetFullRelease.Version : Velo.Locator?.CurrentlyInstalledVersion;
            if (on != null)
            {
                string recordSaid;
                ServerCollectionRevision = VeloRecord.Get(on, out recordSaid).CollectionRevision;
            }
            if (info == null)
            {
                LastLauncherCheck = "The launcher is the one the " + channel + " channel is on.";
                return null;
            }
            var u = new LauncherUpdate();
            u.Manager = mgr;
            u.Info = info;
            u.Version = info.TargetFullRelease.Version.ToString();
            u.Channel = channel;
            long deltas = 0;
            foreach (VelopackAsset d in info.DeltasToTarget) deltas += d.Size;
            u.Size = deltas > 0 && deltas <= info.TargetFullRelease.Size ? deltas : info.TargetFullRelease.Size;
            LastLauncherCheck = info.IsDowngrade
                ? "The " + channel + " channel is on launcher " + u.Version + " now, a lower number than this one, " + Version + "."
                : "Launcher " + u.Version + " is out on the " + channel + " channel; this one is " + Version + ".";
            return u;
        }

        /// <summary>
        /// The first half of a launcher update (UpdateStages.cs): downloads the
        /// package into Velopack's packages folder and makes every check in
        /// this file's header. Nothing is replaced. Throws with the reason, the
        /// package deleted, when a check fails.
        /// </summary>
        public static void FetchLauncher(LauncherUpdate u, Action<string> log)
        {
            log("Downloading launcher " + u.Version + "...");
            long size = u.Size;
            PlayProgress.Plan("Updating the launcher", 1, "updates");
            PlayProgress.Part(0, size);
            u.Manager.DownloadUpdatesAsync(u.Info, delegate (int p) { PlayProgress.Part(size * p / 100, size); }).GetAwaiter().GetResult();
            PlayProgress.PartDone();
            log("Checksum verified.");

            IVelopackLocator at = Velo.Locator;
            string pkg = PackagePath(at, u.Info.TargetFullRelease);
            if (!File.Exists(pkg))
                throw new Exception("Velopack said the launcher " + u.Version + " was downloaded, and there is no package at " + pkg + ". Nothing has been replaced.");
            try
            {
                string recordSaid;
                VeloRecord.Manifest m = VeloRecord.Get(u.Info.TargetFullRelease.Version, out recordSaid);
                if (recordSaid.Length > 0) log(recordSaid);
                VeloRecord.GameList list = VeloRecord.Game(m);
                VeloRecord.GameList setup = VeloRecord.Setup(m, u.Channel);
                string said;
                string why = VeloPackage.Refusal(pkg, list, setup, ExpectedSigner,
                    delegate (long done, long total) { PlayProgress.Files("Checking the update", done, total); }, out said);
                if (why.Length > 0) throw new Exception("The update package " + why);
                log(said);
                string updateExe = at.UpdateExePath;
                string exeSaid;
                string exeWhy = string.IsNullOrEmpty(updateExe) || !File.Exists(updateExe)
                    ? "is not there."
                    : Signature.Refusal(updateExe, ExpectedSigner, out exeSaid);
                if (exeWhy.Length > 0) throw new Exception("Velopack's Update.exe, which applies the update, " + exeWhy);
                u.Record = m;
                u.Game = list;
                u.Setup = setup;
                u.Package = pkg;
            }
            catch (Exception ex)
            {
                try { File.Delete(pkg); } catch (Exception dex) { Swallow.Note("Updater.FetchLauncher, delete the refused package", dex); }
                throw new Exception(
                    "The launcher " + u.Version + " was refused: " + ex.Message + " " +
                    "Nothing has been replaced and the one you are running is untouched. " +
                    "Tell Patrick before running anything.");
            }
            u.Checked = true;
        }

        /// <summary>
        /// Where Velopack keeps the package <paramref name="a"/> once it has
        /// it: its file name in the packages folder, each character Windows
        /// does not allow in a name as '_'. Velopack's own helper for this is
        /// internal to it, so this is the same rule (PathUtil.GetSafeFilename
        /// in Velopack 1.2.161).
        /// </summary>
        static string PackagePath(IVelopackLocator at, VelopackAsset a)
        {
            char[] bad = Path.GetInvalidFileNameChars();
            char[] name = Path.GetFileName(a.FileName).ToCharArray();
            for (int i = 0; i < name.Length; i++) if (Array.IndexOf(bad, name[i]) >= 0) name[i] = '_';
            return Path.Combine(at.PackagesDir, new string(name));
        }

        /// <summary>
        /// The second half: the checked package goes in once this launcher has
        /// closed (Velo.ExitApply, the last line of Main), and Velopack starts
        /// the new one. The caller closes the window.
        /// </summary>
        public static void ApplyLauncher(LauncherUpdate u)
        {
            if (u == null || !u.Checked) throw new Exception("The launcher update was not downloaded and checked, so it is not applied.");
            Velo.ApplyOnExit(u.Manager, u.Info.TargetFullRelease);
        }

        /// <summary>
        /// The launcher could not start (Shell.Main). Everywhere else the
        /// launcher's own update is asked for from the window (ShellUpdate.cs),
        /// so a launcher whose window cannot open would never reach the one
        /// that fixes it: on 2 Nov the launcher from #5381 stopped as its
        /// window was first laid out, and the fixed one could reach that PC
        /// only by running the setup again. Here, with no window, this
        /// install's channel is asked, a newer launcher is fetched and checked
        /// like any other (FetchLauncher, every check in this file's header),
        /// and it is staged, so Velo.ExitApply, the last line of Main, puts it
        /// in and starts it. Never throws. Returns what to tell the person.
        /// </summary>
        public static string AfterFailedStart(Config cfg, Action<string> log)
        {
            try
            {
                LauncherUpdate u = CheckLauncher(cfg);
                if (u == null) return LastLauncherCheck;
                FetchLauncher(u, log);
                ApplyLauncher(u);
                return "A newer launcher, " + u.Version + ", was found on the " + u.Channel + " channel and checked. " +
                       "It goes in as this one ends, and starts by itself.";
            }
            catch (Exception ex)
            {
                return "No newer launcher could be put in: " + ex.Message;
            }
        }

        /// <summary>
        /// Velopack's update manager with the signed record held in its
        /// checksum step (check 2 in the header): Velopack calls it for the
        /// whole package and for each delta it downloads, before it keeps the
        /// file, so a refusal here leaves nothing behind it would use.
        /// </summary>
        sealed class CheckedUpdates : UpdateManager
        {
            public CheckedUpdates(IUpdateSource source, UpdateOptions options) : base(source, options, null) { }

            protected override async Task VerifyPackageChecksumAsync(VelopackAsset release, string filePathOverride = null)
            {
                await base.VerifyPackageChecksumAsync(release, filePathOverride).ConfigureAwait(false);
                string why = VeloRecord.Vouches(release);
                if (why.Length > 0) throw new Exception("The package " + (release == null ? "" : release.FileName + " ") + why);
            }
        }

        /// <summary>
        /// The feed cut to the channel's release (ChannelSource, THE CHANNEL'S
        /// RELEASE): the full package of the newest published Release among
        /// <paramref name="assets"/>, by <paramref name="published"/>, and
        /// every package numbered at or below it, which are the deltas
        /// Velopack may climb to it by. Anything numbered higher, from a
        /// Release published before it, is dropped, so the newest Release's
        /// package is the highest left and Velopack takes it. Empty when the
        /// newest Release carries no full package.
        ///
        /// A Release's feed also lists the full package of the release its
        /// delta was made from (vpk keeps it in the feed it writes), under the
        /// same Release, so of the newest Release's full packages the highest
        /// numbered is its own.
        /// </summary>
        internal static VelopackAsset[] ChannelRelease(VelopackAsset[] assets, Func<VelopackAsset, DateTime?> published)
        {
            if (assets == null || assets.Length == 0) return new VelopackAsset[0];
            VelopackAsset target = null;
            DateTime newest = DateTime.MinValue;
            foreach (VelopackAsset a in assets)
            {
                if (a == null || a.Type != VelopackAssetType.Full || a.Version == null) continue;
                DateTime? at = published(a);
                if (at == null) continue;
                if (target == null || at.Value > newest || (at.Value == newest && a.Version > target.Version)) { target = a; newest = at.Value; }
            }
            if (target == null) return new VelopackAsset[0];
            return assets.Where(a => a != null && a.Version != null && a.Version <= target.Version).ToArray();
        }

        /// <summary>
        /// The Releases of this repository that carry the channel's feed,
        /// newest first.
        ///
        /// Velopack's own GitHub source reads only the ten newest Releases.
        /// Here every merge to main that changes something makes a Release,
        /// and only those that changed the launcher or the game files carry a
        /// package (merge-release.yml), so ten in a row without one, a day of
        /// gamemode merges, would hide the newest launcher from everybody
        /// behind it. This reads a hundred in the same one request and keeps
        /// the ones with the channel's feed: the newest, and the ten before
        /// it that Velopack may take deltas from (MaximumDeltasBeforeFallback).
        ///
        /// THE CHANNEL'S RELEASE (the plan: "which release a channel gets
        /// comes from its Dev or Main Deployment"). Velopack on its own takes
        /// the highest version anywhere in the feed, and only when it is
        /// higher than the running one. So a Release published after one with
        /// a higher number, a promotion of an older build to main or the move
        /// from the 2026.x numbers back to 1.2.x (Patrick, 8 Nov 2026), would
        /// never reach anybody. Here the feed is cut to the newest Release's
        /// full package and what is numbered at or below it (ChannelRelease),
        /// and CheckLauncher lets Velopack take a lower number than the
        /// running one, so every install goes to the release its channel is
        /// on, up or down, with every check in this file's header all the same.
        ///
        /// READ THROUGH THE SITE (#5608, Patrick's B of 9 Nov 2026). The list
        /// is the site's (Velo.ReleaseList), in GitHub's own shape, with each
        /// file's address the site's Release route, and every file Velopack
        /// fetches, the feeds and the packages, goes there (GetAssetUrlFromName),
        /// which sends it on to where GitHub keeps it. Velopack's own source,
        /// with no token, used github.com's download addresses, which GitHub
        /// stopped answering for anybody not signed in on 9 Nov 2026, and its
        /// list cost one of an address's sixty anonymous API calls an hour.
        /// </summary>
        sealed class ChannelSource : GithubSource
        {
            readonly string feedName;
            readonly int take;

            public override async Task<VelopackAssetFeed> GetReleaseFeed(Velopack.Logging.IVelopackLogger logger, string appId, string channel, Guid? stagingId = null, VelopackAsset latestLocalRelease = null)
            {
                VelopackAssetFeed all = await base.GetReleaseFeed(logger, appId, channel, stagingId, latestLocalRelease).ConfigureAwait(false);
                return new VelopackAssetFeed
                {
                    Assets = ChannelRelease(all.Assets, a => a is GitBaseAsset g && g.Release != null ? g.Release.PublishedAt : null)
                };
            }

            /// <param name="take">How many of the Releases with the channel's
            /// feed to read: 11 for an update, the newest and the ten Velopack
            /// may take deltas from; 1 for what the channel is on
            /// (MainVersion.cs), which is the newest Release's own package.</param>
            public ChannelSource(string channel, int take) : base(Velo.RepoUrl, null, true, null)
            {
                feedName = "releases." + channel + ".json";
                this.take = take;
            }

            protected override async Task<GithubRelease[]> GetReleases(bool includePrereleases)
            {
                string json = await Downloader.DownloadString(Velo.ReleaseList, GetRequestHeaders("application/json"), 30.0).ConfigureAwait(false);
                List<GithubRelease> all = JsonSerializer.Deserialize(json, VeloJson.Default.ListGithubRelease);
                if (all == null) return new GithubRelease[0];
                return all
                    .Where(r => r != null && (includePrereleases || !r.Prerelease) && r.Assets != null &&
                                r.Assets.Any(a => a != null && string.Equals(a.Name, feedName, StringComparison.OrdinalIgnoreCase)))
                    .OrderByDescending(r => r.PublishedAt)
                    .Take(take)
                    .ToArray();
            }

            /// <summary>
            /// Where a file of <paramref name="release"/> is fetched from: the
            /// address the site's list gave it, which has to be the site's own
            /// Release route (Velo.SiteReleaseFile).
            /// </summary>
            protected override string GetAssetUrlFromName(GithubRelease release, string assetName)
            {
                GithubReleaseAsset asset = release == null || release.Assets == null ? null :
                    release.Assets.FirstOrDefault(a => a != null && string.Equals(a.Name, assetName, StringComparison.OrdinalIgnoreCase));
                if (asset == null)
                    throw new ArgumentException("The Release " + (release == null ? "" : release.Name) + " has no " + assetName + ".");
                return Velo.SiteReleaseFile(asset.BrowserDownloadUrl);
            }
        }
    }
}
