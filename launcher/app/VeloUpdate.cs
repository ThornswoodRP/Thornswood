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
            // the game files go in from it on dev (SyncPackage.cs).
            internal VeloRecord.Manifest Record;
            internal VeloRecord.GameList Game, Setup;
            internal string Package;
        }

        /// <summary>What the last launcher check found, in words, for launcher.log.</summary>
        public static string LastLauncherCheck = "";

        /// <summary>
        /// Asks this install's channel on GitHub for a launcher newer than the
        /// one running. Null when there is none, or when Velopack did not
        /// install this launcher (LastLauncherCheck says which). Throws when
        /// GitHub could not be asked, which is not the same as no update.
        ///
        /// One request to GitHub's API (the list of Releases) and one small
        /// download per Release that carries this channel's feed. Anonymous
        /// API requests are sixty an hour for each address, so the caller does
        /// not ask on every feed check (ShellUpdate.cs, LauncherCheckDue).
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
            var mgr = new CheckedUpdates(new ChannelSource(channel), opts);
            UpdateInfo info = mgr.CheckForUpdatesAsync().GetAwaiter().GetResult();
            if (info == null)
            {
                LastLauncherCheck = "The launcher is the newest on the " + channel + " channel.";
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
            LastLauncherCheck = "Launcher " + u.Version + " is out on the " + channel + " channel; this one is " + Version + ".";
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
        /// </summary>
        sealed class ChannelSource : GithubSource
        {
            readonly string feedName;

            public ChannelSource(string channel) : base(Velo.RepoUrl, null, true, null)
            {
                feedName = "releases." + channel + ".json";
            }

            protected override async Task<GithubRelease[]> GetReleases(bool includePrereleases)
            {
                string url = "https://api.github.com/repos/" + Velo.Repo + "/releases?per_page=100&page=1";
                string json = await Downloader.DownloadString(url, GetRequestHeaders("application/vnd.github.v3+json"), 30.0).ConfigureAwait(false);
                List<GithubRelease> all = JsonSerializer.Deserialize(json, VeloJson.Default.ListGithubRelease);
                if (all == null) return new GithubRelease[0];
                return all
                    .Where(r => r != null && (includePrereleases || !r.Prerelease) && r.Assets != null &&
                                r.Assets.Any(a => a != null && string.Equals(a.Name, feedName, StringComparison.OrdinalIgnoreCase)))
                    .OrderByDescending(r => r.PublishedAt)
                    .Take(11)
                    .ToArray();
            }
        }
    }
}
