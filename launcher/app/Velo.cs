using System;
using System.IO;
using Velopack;
using Velopack.Locators;

namespace Thornswood
{
    /// <summary>
    /// VELOPACK INSTALLS AND UPDATES THE LAUNCHER (#4825). Decided by Patrick
    /// on 27 Oct 2026 (docs/studies/launcher-stack/README.md, Decided 4 and 5):
    /// the install is Velopack's Setup, and the launcher updates through
    /// Velopack reading this repository's GitHub Releases directly. Every merge
    /// that changes the launcher or the game files publishes one Velopack
    /// package of both (.github/workflows/merge-release.yml, #5305).
    ///
    /// THE LAYOUT. Velopack keeps an app in one folder of its own, under the
    /// person's profile (%LocalAppData%\Thornswood): Update.exe, a small
    /// Thornswood.exe that starts the real one, current\ with the package's
    /// files (the launcher, Game and the files the install reads beside it),
    /// and packages\ with the package it came from. Root, the folder Profile,
    /// Game and config.json go under, is apart from it, on Skyrim's drive,
    /// chosen in the install window on the first start and recorded beside
    /// Velopack's folder (InstallPlace.cs, #4824), because a hard link cannot
    /// cross a drive. InstallRoot reads that record.
    ///
    /// The update itself, with every check made before it is applied, is
    /// VeloUpdate.cs; the signed release record it is held to, VeloRecord.cs;
    /// what is checked in the package, VeloPackage.cs.
    /// </summary>
    static class Velo
    {
        /// <summary>The repository whose Releases carry the packages.</summary>
        public const string Repo = "ThornswoodRP/Thornswood";
        public const string RepoUrl = "https://github.com/" + Repo;

        // The arguments this launcher was started with, handed back to it when
        // Velopack restarts it after an update.
        static string[] startArgs = new string[0];

        /// <summary>
        /// Velopack's start: the first line of Main, before the mutex, any
        /// window or anything is read from disk. When Velopack runs the exe to
        /// tell it about an install, an update or an uninstall, this answers
        /// and ends the process; otherwise it returns at once.
        ///
        /// Auto apply is off. A package that was downloaded and not yet applied
        /// (a launcher that closed before its update went in) would otherwise
        /// be applied here, at the next start, before the checks in
        /// VeloUpdate.cs have passed it. Left off, the next update check finds
        /// it on disk and checks it like any other.
        /// </summary>
        public static void Start(string[] args)
        {
            startArgs = args ?? new string[0];
            VelopackApp.Build()
                .SetArgs(startArgs)
                .SetAutoApplyOnStartup(false)
                .OnRestarted(delegate { Restarted = true; })
                .Run();
        }

        /// <summary>
        /// True when Velopack started this launcher straight after applying an
        /// update to it. Shell runs the rest of the update then (the icon pass
        /// and Fix, #3201), the way it did when the swap script's
        /// Thornswood.exe.old said so before #4825.
        /// </summary>
        public static bool Restarted { get; private set; }

        /// <summary>Velopack's answer about this install, or null before Start.</summary>
        public static IVelopackLocator Locator
        {
            get { return VelopackLocator.IsCurrentSet ? VelopackLocator.Current : null; }
        }

        /// <summary>
        /// True when Velopack installed this launcher. A launcher started from
        /// a build folder (a developer's Build-Launcher.ps1 into a test root)
        /// is not, and never updates itself.
        /// </summary>
        public static bool Installed
        {
            get
            {
                IVelopackLocator l = Locator;
                return l != null && l.CurrentlyInstalledVersion != null && !string.IsNullOrEmpty(l.RootAppDir);
            }
        }

        /// <summary>
        /// Root, the folder that holds Profile, Game and config.json, when
        /// Velopack installed this launcher and the install window recorded
        /// one (InstallPlace.Recorded); null when not, and then the first
        /// start is the install. Paths.Init and the single-instance lock read
        /// it before they fall back on the folder above the exe's, which is
        /// Root only for a launcher built into a test root.
        /// </summary>
        public static string InstallRoot
        {
            get { return Installed ? InstallPlace.Recorded() : null; }
        }

        /// <summary>
        /// The Velopack channel this install reads: "dev" for the dev server's
        /// launcher, "main" for the live one. The same answer the update feed
        /// goes by (Updater.FeedUrl): config.json's Channel or UpdateBranch.
        ///
        /// Every merge release that makes a package packs it for both
        /// channels, from the same files, and lists both in its one signed
        /// record (merge-release.yml). Velopack writes the channel into the
        /// package, so main's is a package of its own; it is held back and
        /// published only by Patrick's approval (#5181). Until one is, a main
        /// launcher finds no update and says so.
        /// </summary>
        public static string ChannelFor(Config cfg)
        {
            bool dev = cfg != null &&
                       (string.Equals(cfg.Channel, "dev", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(cfg.UpdateBranch, "dev", StringComparison.OrdinalIgnoreCase));
            return dev ? "dev" : "main";
        }

        /// <summary>
        /// THE LINE BETWEEN THE PACKAGE AND THE FEED FOR THE GAME FILES (#4825).
        /// True when Thornswood's game files come from the Velopack package of
        /// each launcher update (Updater, SyncPackage.cs), and the feed's
        /// release record and packs are not this install's (Sync.cs, Pending).
        ///
        /// Dev only, and on purpose. The plan has one update channel carry both
        /// the launcher and the game payload, and the dev channel has a package
        /// on every merge that changes either. Main has none until Patrick
        /// approves one (#5181), so a main launcher whose game files waited on
        /// a package would get none: main stays on the feed's record until main
        /// has packages. Then this is Installed alone, and the feed's game path
        /// (Sync.cs fetching from the site) retires. A launcher Velopack did not
        /// install (a build into a test root) has no package, and stays on the
        /// feed too.
        /// </summary>
        public static bool GameFromPackage(Config cfg)
        {
            return Installed && ChannelFor(cfg) == "dev";
        }

        // The update that goes in when this launcher exits (ApplyOnExit).
        static readonly object stageGate = new object();
        static UpdateManager stagedBy;
        static VelopackAsset staged;

        /// <summary>
        /// Holds a downloaded and checked update to be applied once this
        /// launcher has closed. The caller closes the window; ExitApply, the
        /// last thing the process does, hands it to Velopack.
        /// </summary>
        public static void ApplyOnExit(UpdateManager by, VelopackAsset what)
        {
            lock (stageGate) { stagedBy = by; staged = what; }
        }

        /// <summary>True while an update waits for the launcher to close.</summary>
        public static bool Staged { get { lock (stageGate) return staged != null; } }

        /// <summary>
        /// The last line of Main, after the window has closed and everything
        /// the close puts back (the swapped settings, the hold, the parked
        /// files, the client) is done. Velopack's Update.exe waits for this
        /// process to end, sixty seconds at most, puts the new launcher in and
        /// starts it with the arguments this one had. Called that late so the
        /// wait covers only the process ending: the close itself can take
        /// longer than Velopack waits. Does nothing when no update is staged.
        /// </summary>
        public static void ExitApply()
        {
            UpdateManager by;
            VelopackAsset what;
            lock (stageGate) { by = stagedBy; what = staged; staged = null; stagedBy = null; }
            if (by == null || what == null) return;
            by.WaitExitThenApplyUpdates(what, false, true, startArgs);
        }
    }
}
