using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Text;
using System.Threading;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Platform.Storage;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Ellipse = Avalonia.Controls.Shapes.Ellipse;   // not the namespace: Avalonia.Controls.Shapes.Path would collide with System.IO.Path

namespace Thornswood
{
    /// <summary>
    /// The launcher itself: Main, the window, every button, and the Play
    /// sequence. The window is MainWindow.axaml, compiled with the launcher,
    /// and holds no logic of its own: Run makes it, Bind takes the named
    /// controls from its generated fields and Wire attaches every handler. So
    /// this is one static class, not a Window subclass, split across Shell.cs
    /// and every other file that declares partial class Shell.
    ///
    /// launcher\app\ARCHITECTURE.md walks through it: the startup order, what
    /// each of the other classes owns on disk, and every step between the
    /// Play button and the game starting, with the file and line of each.
    /// Whoever changes one of those steps changes that page in the same pull
    /// request; launcher\tests\test-architecture.js fails when the page names a step
    /// that is gone or out of order.
    /// </summary>
    static partial class Shell
    {
        // The compiled window (MainWindow.axaml). Its named controls are
        // generated fields, so win.BtnPlay and the rest are checked when the
        // launcher is built.
        static MainWindow win;
        static Config cfg;
        static VersionDoc pendingDoc;
        static bool playing;
        // An update waiting means this build no longer matches what the
        // server expects. Playing anyway is how someone gets turned away at
        // the door, or worse, gets in with a different mod list.
        /*
          Play starts blocked, not allowed.

          This was a plain false, which meant the launcher opened with Play
          live and only took it away once a background check had come back and
          said there was something waiting. Anybody quick enough got into the
          game on an old build in the gap, and the same gap opened whenever the
          check failed or the version document could not be read: no answer,
          no block, straight in. That is how somebody ends up playing a release
          behind and reporting bugs that were fixed hours ago.

          So the question is no longer "has an update been found" but "has
          anything told us it is safe to play yet", and the answer starts as no.
          updateAnswered is what turns CHECKING into either PLAY or UPDATE
          FIRST.

          Decided by Patrick on 20 September: nobody plays on a build that is
          not known to be current, on main or on dev. A check that cannot reach
          the source used to say so and let the game start, on the argument
          that a launcher that bricks itself when GitHub hiccups is worse than
          one a release behind. It is the other way round for a playtest: a
          release behind reports bugs fixed hours ago and desyncs everybody,
          so the button stays shut with the reason on it and the check runs
          again every thirty seconds until the source answers. Automatic
          updates being off no longer skips the check either; it only means
          the pack waits for the Install button instead of going in on its own.
          The one case that still frees Play without an answer is a launcher
          with no update source configured at all, which is a developer's own
          build and never a tester's.
        */
        static bool updatePending = true;
        static bool updateAnswered;
        static bool checkFailed;
        static DateTime playStartedAt;
        // When the last session's game closed, for PlayPressedBy (#2215).
        static DateTime gameClosedAt;
        // The last key that went down on this window, for PlayPressedBy.
        static Key lastKeyDown = Key.None;
        static DateTime lastKeyDownAt;
        static KeyModifiers lastKeyModifiers = KeyModifiers.None;
        // What was used last on this window: "mouse", "keyboard", "pen" or
        // "touch", or null while nothing has been. Avalonia keeps no record of
        // the last input device, so Wire notes it on the way in.
        static string lastInput;
        // Whether the mouse's left button went down on this window and has not
        // come up yet.
        static bool leftButtonDown;

        // An update published while the game runs. The check that runs every
        // thirty seconds during play notices it; four and a half minutes after it is first
        // seen the game is closed so the launcher can install it, which is
        // what the server's own five minute warning has been counting down
        // to. The server's kick by itself did nothing: the client reconnects
        // in three seconds and carries on running files the rest of the room
        // has moved past, which is what happened to everybody on 1.1.40.
        static DateTime updateSeenAt = DateTime.MinValue;
        static bool closedForUpdate = false;
        static int inPlayTicks = 0;
        static DispatcherTimer timer;

        // The character bar (charBar, charRow, txtCharNote, charPickerOpen)
        // went on 20 September; the person picks at the game's main menu.
        // This is who they picked, read out of the plugin's choice file while
        // the game runs, and 0 until they have.
        static int chosenId;

        static TextBlock txtServer, txtPing, txtStatus, txtStatusRight, txtVersion, txtBuildLine,
                         txtUpdateTitle, txtUpdateNote,
                         txtPageTitle, txtHeroLine, txtVerifyTitle, txtVerifyNote,
                         txtDisplayNote,
                         txtReadyTitle, txtReadyNote;
        static Ellipse dotServer, dotVerify, dotReady;
        static StackPanel statusList, themeRow, themeEditor, pathRows, displayModeRow,
                          firstRunCard, quickKeysCard, quickKeys;
        // Play hero stats strip: three equal columns (Played / Sessions / Last played).
        static UniformGrid statRow;
        // GalleryCard is a Grid that fills the Play centre; only IsVisible is touched.
        static Control galleryCard;
        static Image galleryImage; static TextBlock galleryBy;
        // The pictures /api/public is showing and where the card is in turning
        // through them. Null until the feed has answered with at least one.
        static List<Gallery.Shot> galleryShots;
        static int galleryAt = -1;
        static DispatcherTimer galleryTimer;
        // Gallery page tools (#731). Play keeps the rotating spotlight only.
        // galleryWho is what /api/gallery/who answered at start up, null until
        // it has; galleryReporting is the picture an open report on the Gallery
        // page is about.
        static Gallery.Who galleryWho;
        static Gallery.Shot galleryReporting;
        static List<string> galleryChosenPaths = new List<string>();
        static Button btnGalleryChoose, btnGallerySend, btnGalleryRefresh,
                      btnGalleryReportSend, btnGalleryReportCancel;
        static TextBox boxGalleryBy, boxGalleryNote, boxGalleryWhy;
        static TextBlock txtGalleryChosen, txtGalleryPageSaid, txtGalleryDropLead,
                         txtGalleryApprovedEmpty;
        static Control galleryPageReportRow;
        static Border galleryDrop;
        static StackPanel galleryChosenList;
        static WrapPanel galleryApprovedList;
        static List<Gallery.Pending> galleryPending;
        static TextBox boxResolution, boxFrameLimit;
        static CheckBox chkAutoUpdate, chkVSync, chkKeepOpen, chkLockRes;
        static CheckBox chkCrashSnapshots; static TextBlock txtCrashFolder; static Button btnCrashFolder;
        static CheckBox chkMusic; static Slider sldMusic; static TextBlock txtMusic;
        static CheckBox chkKeepSaves;
        static CheckBox chkDeleteMods;
        static Button btnUninstall;
        static Button btnServerMain, btnServerDev, btnServerPick, btnCheckDiagnostics, btnOpenSteam;
        static Popup serverPickPopup;
        static Border serverPickPanel;
        static TextBlock txtBrandSmall, txtBrandBig, txtServerPick, txtServerPickMeta;
        static TextBlock txtServerMainMeta, txtServerDevMeta;
        static Ellipse dotServerPick, dotServerMain, dotServerDev;
        static string pingMsText = "";
        static string awakeMineText = "";
        static string awakeOtherText = "";
        // Per-server chip lines for the dropdown (Main and Dev each once).
        static string pingMainText = "";
        static string pingDevText = "";
        static string awakeMainText = "";
        static string awakeDevText = "";
        static string dotMainKey = "Faint";
        static string dotDevKey = "Faint";
        static Border updateBar;
        static Border downgradeBar;
        static TextBlock txtDowngradeNote, txtDowngradeTitle;
        static Button btnDowngrade;
        static ProgressBar prgDowngrade;
        // The feed's word to everybody and whether it holds Play (entry 262).
        // Empty until a document has actually been read, so nothing here can
        // hold Play on a check that failed. See FeedNotice.cs.
        static Border noticeBar;
        static TextBlock txtNoticeTitle, txtNoticeNote;
        static FeedNotice feedNotice = new FeedNotice();
        static Grid titleBar;
        static Button buttonDiscord;
        static TextBlock labelDiscord;
        static Ellipse discordAvatar;
        static Button btnPlay, btnCopy, btnUpdate, btnMin, btnMax, btnClose,
                      btnCheckNow, btnFolder, btnOpenLog,
                      btnIcons, btnScan, btnFix, btnInstallNow, btnSaveDisplay,
                      btnQuitGame;
        static Button[] navButtons;
        static Control[] pages;

        [STAThread]
        static void Main(string[] args)
        {
            // Velopack first (#4825): when it runs the exe about an install, an
            // update or an uninstall, this answers and the process ends here.
            Velo.Start(args);

            // PerMonitorV2 is in the application manifest (#463), and Avalonia
            // rescales on WM_DPICHANGED by itself; WindowFit keeps the window
            // inside the work area when the scale changes.
            bool fresh;
            using (var mutex = new Mutex(true, MutexName(args), out fresh))
            {
                // A second copy used to return here in silence, which from the
                // outside is indistinguishable from the launcher being broken:
                // you double click it, nothing happens, forever. Usually it is
                // a copy that crashed without releasing the mutex, or one
                // sitting behind another window.
                if (!fresh)
                {
                    try
                    {
                        var mine = System.Diagnostics.Process.GetCurrentProcess();
                        foreach (var p in System.Diagnostics.Process.GetProcessesByName(mine.ProcessName))
                        {
                            if (p.Id == mine.Id) continue;
                            if (p.MainWindowHandle != IntPtr.Zero)
                            {
                                // There is a real window somewhere. Say so
                                // rather than doing nothing at all.
                                Ask.Tell(
                                    "Thornswood is already open.\n\nLook for it in the taskbar. " +
                                    "If you cannot find it, end Thornswood.exe in Task Manager and try again.",
                                    "Thornswood", Ask.Icon.Info);
                                return;
                            }
                        }
                        Ask.Tell(
                            "Another copy of Thornswood is running but has no window, which means " +
                            "it did not shut down properly last time.\n\nOpen Task Manager, end " +
                            "every Thornswood.exe, then start it again.",
                            "Thornswood", Ask.Icon.Warning);
                    }
                    catch (Exception ex) { Swallow.Note("Shell.Main", ex); }
                    return;
                }

                try { Run(args); }
                catch (Exception ex)
                {
                    // Into the log as well as onto the screen. A message box
                    // gets closed and then nobody can say what it said, and
                    // "it will not open" is not something anybody can act on.
                    try
                    {
                        Paths.Init(null);
                        File.AppendAllText(Paths.LogFile,
                            DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") +
                            "  COULD NOT START: " + ex.ToString() + Environment.NewLine);
                    }
                    catch (Exception logEx) { Swallow.Note("Shell.Main, append", logEx); }
                    Ask.Tell(ex.ToString(), "Thornswood could not start", Ask.Icon.Error);
                }
            }

            // The very last thing: an update downloaded and checked while the
            // launcher ran goes in now that the window has closed, everything
            // it put back is back and the lock is let go (Velo.ExitApply).
            Velo.ExitApply();
        }

        /// <summary>
        /// The single-instance lock, one per install. It used to be one name
        /// for every copy on the machine, which was right when there was one
        /// copy. The dev build lives in its own folder beside the main one and
        /// both may be open at once, so the folder is part of the name: the
        /// install's (Velo.InstallRoot), else the one given with -root, else
        /// the folder above the exe's, as Run picks it for Paths.Init.
        /// </summary>
        static string MutexName(string[] args)
        {
            string root = null;
            try
            {
                root = Velo.InstallRoot;
                if (string.IsNullOrEmpty(root))
                    for (int i = 0; i < args.Length - 1; i++)
                        if (args[i].Equals("-root", StringComparison.OrdinalIgnoreCase)) root = args[i + 1];
                if (string.IsNullOrEmpty(root))
                    root = Path.GetDirectoryName(Path.GetDirectoryName(Environment.ProcessPath));
                root = Path.GetFullPath(root).TrimEnd('\\').ToLowerInvariant();
            }
            catch { root = ""; }
            uint h = 2166136261;
            foreach (char c in root) { h ^= c; h *= 16777619; }
            return "ThornswoodLauncher-" + h.ToString("x8");
        }

        /// <summary>
        /// Windows sent us here from Installed apps, so open on the page that
        /// does it. The entry in Settings points at this rather than deleting
        /// anything itself, because the uninstall asks two questions that
        /// matter and puts the Windows Skyrim folders back first.
        /// </summary>
        static bool askedToUninstall;

        /// <summary>
        /// How long the mod check on the way in took, for the start line
        /// (LogStartTime). -1 until it has run.
        /// </summary>
        static double startScanSeconds = -1;

        /// <summary>
        /// One line in launcher.log once the window has drawn: how long after
        /// Windows started the process, and how much of that the mod check
        /// on the way in took (#3534). Nothing measured the launcher's start
        /// before, so the weekly review had no number for it. The line goes to
        /// the site with the session's launcher.log like every other line, and
        /// scripts\vps\Read-LauncherStarts.ps1 totals a week of them on the box.
        /// Its words are what that script reads: change both together.
        /// </summary>
        static void LogStartTime()
        {
            double window;
            using (var me = Process.GetCurrentProcess())
                window = (DateTime.Now - me.StartTime).TotalSeconds;
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            LogOnly("Launcher start: the window was on screen " + window.ToString("F1", inv) + " s after the launcher started" +
                    (startScanSeconds >= 0 ? ", " + startScanSeconds.ToString("F1", inv) + " s of it the mod check" : "") +
                    ", on launcher " + Updater.Version + ".");
        }

        static void Run(string[] args)
        {
            string root = null;
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i].Equals("-root", StringComparison.OrdinalIgnoreCase)) root = args[i + 1];
            for (int i = 0; i < args.Length; i++)
                if (args[i].Equals("-uninstall", StringComparison.OrdinalIgnoreCase)) askedToUninstall = true;

            // Avalonia first: the terms window below and the uninstall are
            // Avalonia windows, and no window can be made before the platform
            // is set up. The launcher runs its own message loop at the end of
            // Run, until its window closes.
            AppBuilder.Configure<App>().UsePlatformDetect().SetupWithoutStarting();

            // Where Thornswood is: the folder the install recorded (Velo.
            // InstallRoot), else the one given with -root, else the folder
            // above the exe's, which is a launcher built into a test root
            // (Paths.Init), the same order as the lock in MutexName.
            //
            // The first start after Velopack's Setup.exe put the launcher down
            // is the install (#4824): Velopack installed it, no folder is
            // recorded and none was given, so the install window asks where
            // and puts Thornswood there. Closed without installing, the
            // launcher ends. Installed, it stays up until the launcher's own
            // window is on screen (InstallWindow says why), and closing it then
            // does not end anything. Somebody sent here by Windows Settings to
            // uninstall is not asked to install.
            string recorded = Velo.InstallRoot;
            InstallWindow installing = null;
            if (recorded != null) root = recorded;
            else if (root == null && Velo.Installed && !askedToUninstall)
            {
                installing = new InstallWindow();
                installing.Show();
                string installed = Pump(installing.Done);
                if (installed == null) return;
                root = installed;
            }

            Paths.Init(root);
            // The log and the support zips are kept for LocalKeep.Days days on
            // this PC, and the privacy page says so (#3679). Here, inside this
            // install's mutex and before anything else in it writes the log.
            LocalKeep.Tidy(DateTime.Now);
            // Profile\accepted.json is the install window's record of the terms,
            // the privacy policy and the rules (issue #1009). An install made
            // before that has no file, and silence is not a yes. Ask before
            // anything else is opened. Uninstall must still be reachable.
            bool termsOnFile = !Acceptance.NeedsAsk(Acceptance.Read(Paths.ProfileDir), null);
            if (!askedToUninstall && !termsOnFile && !Acceptance.Ensure(Paths.ProfileDir)) return;
            cfg = Config.Load(Paths.CfgFile);
            Stats.Load();
            Keep.BuildName = cfg.BuildName;
            Icons.BuildName = cfg.BuildName;
            Icons.Dev = cfg.IsDev;
            Art.Dev = cfg.IsDev;
            Discord.Channel = cfg.Channel;

            win = new MainWindow();

            Bind();
            Themes.Apply(win, Themes.Resolve(cfg.Theme, cfg.CustomColors, cfg.CustomLight));
            Wire();
            BuildThemeRow();
            BuildThemeEditor();
            BuildDisplay();
            BuildStatRow();
            BuildPathRows();

            // Windows Settings sends people here with -uninstall. The window
            // and the Settings page above are what the uninstall is made of;
            // everything below is a launcher starting up to play, and none of
            // it belongs on the way out. ShellUninstall.cs says what still runs.
            if (askedToUninstall) { OpenForUninstall(); return; }

            RefreshDiscord();
            // Linked tickets from before the site sent avatar still need a hash.
            // Join answers with it; paint once it lands so the sidebar is not stuck on Clyde.
            PullDiscordAvatarIfNeeded();
            ShowPage(PagePlay);

            // And put Thornswood in Installed apps, or bring the entry up to
            // date. Done here rather than in the installer so that every
            // install that already exists gets one on its next launch.
            try { Register.Ensure(cfg); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }

            // So the session report can run the readiness checks against the
            // same config this launcher is using, without reaching in here.
            try { Discord.UseConfig(cfg); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }

            // Logs from a session that ended without sending them, sent now.
            // On a pool thread so nothing waits on the site, and BEFORE Play
            // can be pressed, because the game truncates its own logs under
            // Data\Platform at every game start and after that there is
            // nothing left to send. A crash that took the launcher down with
            // it is exactly the session somebody wants to read afterwards,
            // and it was the one that was always lost.
            try { ThreadPool.QueueUserWorkItem(delegate { try { Discord.SendPendingLogs(); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); } }); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }

            // The client settings file, made here if this install has none.
            // Nothing ships it, the client does not create it, and without it
            // a character cannot be chosen. From startup, so the log says so
            // before Play or a character choice can trip over its absence.
            try { AutoJoin.Ensure(Log); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }

            // A launcher killed mid-session and opened again finds the game
            // still up. Taking the redirect off now would send the rest of
            // that session's settings and saves into the real Windows folders,
            // and putting other servers' plugins back would hand them to
            // SkyrimPlatform while it is loading them. So the session is picked
            // up where it was, and the two second tick does all of it properly
            // once the game has actually closed.
            playing = Checks.GameRunning();
            if (playing)
            {
                // Only the part of the session this launcher can see is
                // counted. Stats.StartedPlaying already ran in the instance
                // that started the game, so it is not run again here.
                playStartedAt = DateTime.Now;
                btnPlay.Content = "RUNNING";
                Log("Skyrim is still running, so this session is taken over rather than pulled apart under it. Your Windows folders stay pointed at this build until the game closes.");
                int holding = 0;
                try { holding = Hold.Take(PresenceLog); } catch (Exception ex) { Swallow.Note("Shell.Run, dispose", ex); }
                if (holding > 0) Log("Holding " + holding + " of " + cfg.BuildName + "'s game files again, so nothing else can change them under the running game.");
            }
            else
            {
                if (Swap.Restore()) Log("Cleaned up a redirect left behind by a crash.");
                Keep.TakeNote();
            }
            try { string leak = Leaks.Clean(cfg); if (leak != null) Log(leak); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }
            // Once the own folder is made, Thornswood's files come out of the Steam copy, once (OwnGameClean.cs, #1226). Off the window's thread: it deletes.
            ThreadPool.QueueUserWorkItem(delegate
            {
                string cleaned = null;
                try { cleaned = OwnGame.CleanSteamCopy(cfg); } catch (Exception ex) { Swallow.Note("Shell.Run, taking Thornswood's files out of the Steam copy", ex); }
                if (cleaned == null) return;
                try { Dispatcher.UIThread.Post((Action)delegate { Log(cleaned); }); } catch (Exception ex) { Swallow.Note("Shell.Run, saying what came out of the Steam copy", ex); }
            });
            try { string ini = ThornIni.Ensure(); if (ini != null) Log(ini); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }
            // Steam's Updates setting for the Steam copy of Skyrim: logged, and set when it does not hold the version (ShellSteamUpdates.cs, #493), only until the own folder is made (#1226).
            try { if (SteamUpdates.LooksAtStart(!Paths.Collection, Downgrade.Needed(cfg))) HoldSteamUpdatesOnStart(); } catch (Exception ex) { Swallow.Note("Shell.Run, Steam's Updates setting", ex); }
            {
                int parked = playing ? 0 : Keep.Unpark();
                if (parked > 0) Log("Put back " + parked + " parked " + (parked == 1 ? "plugin" : "plugins") + " from another server or build left behind by the last session.");
                // Packs go in before the launcher updates itself, so the first
                // launcher with Keep finds files it never saw arrive.
                int seeded = Keep.Seed();
                if (seeded > 0) Log("Kept " + seeded + " of " + cfg.BuildName + "'s own game files from earlier updates, to put back if another server or build changes them.");
            }

            // Same check the Play button does, run on the way in as well, so
            // somebody who changed monitor sees it corrected before they get
            // as far as pressing anything.
            if (!cfg.LockResolution)
            {
                string res = Display.MatchScreen();
                if (res != null) Log("Set the game to " + res + " to match your screen.");
            }

            // The shortcut points at whatever icon file the last build wrote,
            // and an update brings a new one. Quiet unless it actually had to
            // move something. A launcher that changed since the last pass (an
            // update, a rebuild) rewrites the icons even when the path string
            // did not change (Icons.Due), so blank desktop icons do not stick
            // until someone opens Settings.
            ThreadPool.QueueUserWorkItem(delegate
            {
                int moved = 0;
                try { moved = Icons.Ensure(); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }
                if (moved > 0)
                    Dispatcher.UIThread.Post((Action)delegate { Log("Shortcut icon brought up to date."); });
            });

            // Chars.Adopt and Chars.Sync ran here until 20 September. Adopt
            // made the two slot folders on every start; Sync asked the voice
            // service which characters this Steam account owned, off the UI
            // thread, and always came back with nothing, because that route
            // wants the server secret and the launcher never sent one. The
            // list lives in Profile\Characters\profiles.txt and the person
            // picks at the game's main menu now.
            // Off the window's thread. Ending a stuck game waits on it, and at
            // this point the window has not even been shown yet.
            ThreadPool.QueueUserWorkItem(delegate
            {
                string said = null;
                try { said = ClearLeftovers(); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }
                if (string.IsNullOrEmpty(said)) return;
                try { Dispatcher.UIThread.Post((Action)delegate { Log(said); DrawStatus(); }); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }
            });

            // The installer unpacks into Thornswood-setup at the root of the
            // drive and nothing has ever deleted it, so a folder of leftovers
            // has been sitting on every machine that installed this, somewhere
            // nobody would think to look. Clearing it here means the space
            // comes back on the next start rather than only if somebody
            // uninstalls. Off the UI thread, because it is a recursive delete.
            ThreadPool.QueueUserWorkItem(delegate
            {
                long freed = 0;
                try { freed = Uninstall.DropScratch(null); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }
                if (freed <= 0) return;
                try
                {
                    Dispatcher.UIThread.Post((Action)delegate
                    {
                        Log("Cleared " + (freed / (1024 * 1024)) +
                            " MB the installer left behind on your drive.");
                    });
                }
                catch (Exception ex) { Swallow.Note("Shell.Run", ex); }
            });

            // Scan asks the server for its plugin list. The server having a bad
            // night is not a reason for the launcher to stop halfway through
            // starting, with the window built and nothing on it.
            var scanClock = Stopwatch.StartNew();
            try { RunScan(); }
            catch (Exception ex) { Log("Could not check the mod list on the way in: " + ex.Message); }
            startScanSeconds = scanClock.Elapsed.TotalSeconds;
            if (DrawStatus()) Log("Ready."); else Log("Something needs attention before you can play.");
            // Nobody should have to press anything to get a client file back.
            // This does nothing at all when the six are the recorded build,
            // which is every start but the one that needed it.
            HealClientBackground();
            AutoDisplayOnce();
            StartPing();
            StartGallery();
            // Always: config.json cannot switch the check off (#937), and Play
            // stays shut until it has answered (Updater.FeedUrl).
            ThreadPool.QueueUserWorkItem(delegate { CheckUpdatesBackground(false); });
            StartFeedWatch();

            // Voice comes up with the launcher, not with the game. It needs no
            // window, and its lines come to the status line on the window's
            // thread whichever thread says them (Voice.Say).
            Voice.Start(delegate (string m) { Log(m); }, cfg);

            // The theme starts once the window is on screen: ApplicationIdle
            // is after the first frame, so the track never holds the window
            // back. It plays from this process (MenuMusic.cs, #3207).
            Dispatcher.UIThread.Post(new Action(StartMenuMusic), DispatcherPriority.ApplicationIdle);

            // The rest of an update to the launcher itself, once its window is
            // up. Velopack started this launcher straight after putting the
            // update in (Velo.Restarted), so the shortcut icons are redrawn,
            // which is when blank ones show up, and the same Fix Install an
            // update that needs no restart runs follows (#3201), after the
            // icon pass so the two never race.
            win.ContentRendered += delegate
            {
                try { LogStartTime(); } catch (Exception ex) { Swallow.Note("Shell.Run, saying how long the start took", ex); }
                if (Velo.Restarted)
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        int moved = 0;
                        try { moved = Icons.Ensure(true); } catch (Exception ex) { Swallow.Note("Shell.Run, refreshing shortcut icons after the update", ex); }
                        if (moved > 0)
                            try { Dispatcher.UIThread.Post((Action)delegate { Log("Shortcut icon brought up to date after the update."); }); } catch (Exception ex) { Swallow.Note("Shell.Run, saying shortcut icons were refreshed", ex); }
                        // Not without a folder of our own, where the offer to
                        // make one (OwnGameAtStart) is the thing to answer first.
                        if (!Paths.Collection)
                            try { Dispatcher.UIThread.Post((Action)delegate { RunFix(true); }); } catch (Exception ex) { Swallow.Note("Shell.Run, the scan after the launcher update", ex); }
                    });
                // Message boxes belong to the window from here on, so they
                // stay in front of it and keep it from being used meanwhile.
                try { Ask.Owner = win.TryGetPlatformHandle().Handle; } catch (Exception ex) { Swallow.Note("Shell.Run, giving message boxes the window", ex); }
            };

            // Inside the screen at any display scale, before it is centred (#463).
            try { WindowFit.Keep(win); } catch (Exception ex) { Swallow.Note("Shell.Run, fitting the window to the screen", ex); }
            CentreOnMainScreen();

            /*
              The launcher's life is this window's, and no other window's.

              The application used to close when the LAST window closed. The
              voice host was a real Window that was deliberately never shown,
              so the launcher window closing left the message loop running
              against an invisible window: no UI, process alive, and the
              ThornswoodLauncher mutex still held. Every later launch then hit
              "if (!fresh) return" and vanished without a word, which reads as
              the launcher simply refusing to open.

              So the loop at the end of Run runs until this window has closed
              and then stops, whatever else is open, which is what anyone
              closing it means. What has to be let go on the way out is let go
              after the loop.
            */
            var closed = new CancellationTokenSource();
            win.Closed += delegate { closed.Cancel(); };

            // A fault on the launcher's own thread used to take the window
            // down with no line in the log, or leave it standing and deaf.
            // Now the fault is written down, stack and all, and the launcher
            // stays up. A button that failed once is better than no launcher,
            // and the log line is the only evidence anyone will have.
            Dispatcher.UIThread.UnhandledException += delegate (object faultSender, DispatcherUnhandledExceptionEventArgs fault)
            {
                try { Log("Fault on the launcher's own thread: " + fault.Exception.GetType().Name + ": " + fault.Exception.Message); } catch (Exception ex) { Swallow.Note("Shell.Run", ex); }
                try { File.AppendAllText(Paths.LogFile, fault.Exception.ToString() + Environment.NewLine); } catch (Exception ex) { Swallow.Note("Shell.Run, append", ex); }
                // The launcher is native code with no symbols on the customer's
                // machine, so each frame is also written as its method and its
                // offset into the exe. The pdb the native build writes, kept on
                // the shipping machine, maps that offset to a source line
                // (issue #462) without shipping symbols.
                try
                {
                    StackTrace st = new StackTrace(fault.Exception, false);
                    StringBuilder at = new StringBuilder();
                    at.AppendLine("Native offsets:");
                    for (int fi = 0; fi < st.FrameCount; fi++)
                    {
                        StackFrame fr = st.GetFrame(fi);
                        if (fr == null) continue;
                        string name = "?";
                        DiagnosticMethodInfo mi = DiagnosticMethodInfo.Create(fr);
                        if (mi != null)
                            name = string.IsNullOrEmpty(mi.DeclaringTypeName) ? mi.Name : mi.DeclaringTypeName + "." + mi.Name;
                        long ip = fr.GetNativeIP().ToInt64(), image = fr.GetNativeImageBase().ToInt64();
                        at.Append("  ");
                        at.Append(name);
                        at.Append(ip != 0 && image != 0 ? " +0x" + (ip - image).ToString("x8") : " (no native offset)");
                        at.AppendLine();
                    }
                    File.AppendAllText(Paths.LogFile, at.ToString());
                }
                catch (Exception atEx) { Swallow.Note("Shell.UnhandledException, native offsets", atEx); }
                fault.Handled = true;
            };
            StartStallWatch();
            if (!askedToUninstall && termsOnFile)
            {
                // The record is already there (the install window's, or the
                // first start's above). A page is asked again only when its
                // text has changed since it was accepted, and then only that
                // page: Patrick, 16 Oct 2026 (#2616), asked once at install,
                // and again "if any changes and only ask about the one that
                // does change". Off this thread so startup does not wait on
                // the site. Declining closes the launcher.
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        bool ok = Acceptance.Recheck(Paths.ProfileDir, delegate(bool[] which)
                        {
                            bool ticked = false;
                            Dispatcher.UIThread.Invoke((Action)delegate { ticked = Acceptance.Ask(which, win); });
                            return ticked;
                        });
                        if (!ok)
                        {
                            try { Dispatcher.UIThread.Invoke((Action)Quit); }
                            catch (Exception ex) { Swallow.Note("Shell.Run, closing after a changed page was declined", ex); }
                        }
                    }
                    catch (Exception ex) { Swallow.Note("Shell.Run, terms recheck", ex); }
                });
            }
            win.Show();
            if (installing != null) installing.Close();
            Dispatcher.UIThread.MainLoop(closed.Token);

            StopFeedWatch(); Voice.Stop(); try { Presence.Stop(); } catch (Exception ex) { Swallow.Note("Shell.Run, dispose", ex); } try { Hold.Release(); } catch (Exception ex) { Swallow.Note("Shell.Run, dispose", ex); }
        }

        /// <summary>
        /// True once Quit has been asked for: the window then closes without
        /// asking anything, the way the launcher always closed when it ended
        /// itself (after an uninstall, or a changed page that was declined).
        /// </summary>
        static bool quitting;

        /// <summary>
        /// Ends the launcher: the window's Closing handler puts things back
        /// as it does when somebody closes the window, without its questions,
        /// and then the loop at the end of Run stops.
        /// </summary>
        internal static void Quit()
        {
            quitting = true;
            if (win != null) win.Close();
        }


        /// <summary>
        /// Centres the window on the primary monitor's work area. Centring on
        /// the whole desktop puts it in the gap between two monitors. The
        /// primary monitor's work area is what people mean by the middle of
        /// their screen, and it already excludes the taskbar.
        /// </summary>
        static void CentreOnMainScreen()
        {
            try
            {
                Screen main = win.Screens.Primary;
                if (main == null) return;
                double scale = main.Scaling > 0 ? main.Scaling : 1;
                PixelRect work = main.WorkingArea;
                double w = win.Width, h = win.Height;
                if (double.IsNaN(w) || w <= 0) w = win.Bounds.Width;
                if (double.IsNaN(h) || h <= 0) h = win.Bounds.Height;

                int pw = (int)Math.Round(w * scale), ph = (int)Math.Round(h * scale);
                win.Position = new PixelPoint(work.X + Math.Max(0, (work.Width - pw) / 2),
                                              work.Y + Math.Max(0, (work.Height - ph) / 2));
            }
            catch (Exception ex) { Swallow.Note("Shell.CentreOnMainScreen", ex); }   // a bad monitor layout is not worth refusing to start over
        }

        static void Bind()
        {
            txtServer = win.TxtServer; txtPing = win.TxtPing;
            txtStatus = win.TxtStatus; txtStatusRight = win.TxtStatusRight;
            txtVersion = win.TxtVersion; txtBuildLine = win.TxtBuildLine;
            txtUpdateTitle = win.TxtUpdateTitle; txtUpdateNote = win.TxtUpdateNote;
            txtPageTitle = win.TxtPageTitle; txtHeroLine = win.TxtHeroLine;
            txtVerifyTitle = win.TxtVerifyTitle; txtVerifyNote = win.TxtVerifyNote;
            txtDisplayNote = win.TxtDisplayNote;
            newsList = win.NewsList; statRow = win.StatRow;
            displayModeRow = win.DisplayModeRow;
            boxResolution = win.BoxResolution; boxFrameLimit = win.BoxFrameLimit;
            chkVSync = win.ChkVSync; chkKeepOpen = win.ChkKeepOpen;
            btnSaveDisplay = win.BtnSaveDisplay;
            btnQuitGame = win.BtnQuitGame;
            chkLockRes = win.ChkLockRes;
            chkCrashSnapshots = win.ChkCrashSnapshots; txtCrashFolder = win.TxtCrashFolder;
            btnCrashFolder = win.BtnCrashFolder;
            chkMusic = win.ChkMusic; sldMusic = win.SldMusic; txtMusic = win.TxtMusic;
            dotServer = win.DotServer; dotVerify = win.DotVerify;
            dotReady = win.DotReady;
            txtReadyTitle = win.TxtReadyTitle; txtReadyNote = win.TxtReadyNote;
            statusList = win.StatusList;
            themeRow = win.ThemeRow; themeEditor = win.ThemeEditor;
            pathRows = win.PathRows;
            chkAutoUpdate = win.ChkAutoUpdate;
            updateBar = win.UpdateBar; titleBar = win.TitleBar;
            downgradeBar = win.DowngradeBar; txtDowngradeNote = win.TxtDowngradeNote; btnDowngrade = win.BtnDowngrade;
            prgDowngrade = win.PrgDowngrade;
            txtDowngradeTitle = win.TxtDowngradeTitle;
            noticeBar = win.NoticeBar; txtNoticeTitle = win.TxtNoticeTitle; txtNoticeNote = win.TxtNoticeNote;

            btnPlay = win.BtnPlay; btnCopy = win.BtnCopy;
            btnUpdate = win.BtnUpdate; btnMin = win.BtnMin; btnMax = win.BtnMax;
            btnClose = win.BtnClose;
            btnCheckNow = win.BtnCheckNow; btnInstallNow = win.BtnInstallNow;
            btnFolder = win.BtnFolder;
            btnOpenLog = win.BtnOpenLog;
            btnIcons = win.BtnIcons;
            btnServerMain = win.BtnServerMain; btnServerDev = win.BtnServerDev;
            btnServerPick = win.BtnServerPick; serverPickPopup = win.ServerPickPopup;
            serverPickPanel = win.ServerPickPanel;
            txtServerPick = win.TxtServerPick;
            txtServerPickMeta = win.TxtServerPickMeta;
            txtServerMainMeta = win.TxtServerMainMeta;
            txtServerDevMeta = win.TxtServerDevMeta;
            dotServerPick = win.DotServerPick;
            dotServerMain = win.DotServerMain;
            dotServerDev = win.DotServerDev;
            btnCheckDiagnostics = win.BtnCheckDiagnostics;
            btnOpenSteam = win.BtnOpenSteam;
            txtBrandSmall = win.TxtBrandSmall; txtBrandBig = win.TxtBrandBig;
            btnUninstall = win.BtnUninstall; chkKeepSaves = win.ChkKeepSaves;
            chkDeleteMods = win.ChkDeleteMods;
            btnScan = win.BtnScan; btnFix = win.BtnFix;

            firstRunCard = win.FirstRunCard;
            quickKeysCard = win.QuickKeysCard;
            quickKeys = win.QuickKeys;
            galleryCard = win.GalleryCard;
            galleryImage = win.GalleryImage;
            galleryBy = win.GalleryBy;
            btnGalleryChoose = win.BtnGalleryChoose;
            btnGallerySend = win.BtnGallerySend;
            btnGalleryRefresh = win.BtnGalleryRefresh;
            btnGalleryReportSend = win.BtnGalleryReportSend;
            btnGalleryReportCancel = win.BtnGalleryReportCancel;
            boxGalleryBy = win.BoxGalleryBy;
            boxGalleryNote = win.BoxGalleryNote;
            boxGalleryWhy = win.BoxGalleryWhy;
            txtGalleryChosen = win.TxtGalleryChosen;
            txtGalleryDropLead = win.TxtGalleryDropLead;
            txtGalleryPageSaid = win.TxtGalleryPageSaid;
            txtGalleryApprovedEmpty = win.TxtGalleryApprovedEmpty;
            galleryPageReportRow = win.GalleryPageReportRow;
            galleryDrop = win.GalleryDrop;
            galleryChosenList = win.GalleryChosenList;
            galleryApprovedList = win.GalleryApprovedList;

            // Same order as the PageXxx constants, and as PageTitles.
            navButtons = new Button[] {
                win.NavPlay, win.NavNews, win.NavDiag,
                win.NavSettings, win.NavGallery };
            pages = new Control[] {
                win.PagePlay, win.PageNews, win.PageDiag,
                win.PageSettings, win.PageGallery };

            /*
              What the launcher keeps once settings and keys are in the game
              (#3146, Patrick's A, 22 Oct): Play, News, the update, Diagnostics,
              the Discord account and the display settings that need a restart.
              Everything else moved into the game or was cut:
              - Controls went into the game as Settings (#3126).
              - Help is F7 in the game and help.md on the site. The rail's Help
                opens the site's page; it is not a page here (Wire).
              - Server, Mods, What is installed, Saves and Logs had been off
                the rail since #599 and were kept as collapsed Grids, because
                renumbering these arrays by hand once sent people to the wrong
                page for weeks. They are cut out now, and every use goes
                through the PageXxx names, never a number. Server's voice line
                is a Diagnostics reading; Logs' newest crash is in the report
                Diagnostics builds; the add-ons and the collection card were
                already on Diagnostics (#1170).
              Gallery stays a page: Patrick kept it in the launcher on
              26 Oct (#3146).

              A blocked Play sends people to Diagnostics (ShowPage(PageDiag)),
              where Scan and Fix are since #607.
            */
            buttonDiscord  = win.ButtonDiscord;
            labelDiscord   = win.LabelDiscord;
            discordAvatar  = win.DiscordAvatar;

            // Discord.cs keeps the ticket beside launcher.log rather than in
            // config.json, so a config that gets copied between machines does
            // not carry somebody else's account with it.
            Discord.Folder = Paths.ProfileDir;

            BindPages();
        }

        /// <summary>
        /// Linking Discord, from either button that offers it.
        ///
        /// Discord.Connect runs on a pool thread and used to be called bare. If
        /// anything in it threw after the listener was up, saving the ticket
        /// for instance, the exception killed that thread with the callback
        /// never fired, and the button it had just disabled stayed grey for the
        /// rest of the session. The only way back to it was restarting the
        /// launcher, which is not something anybody guesses.
        ///
        /// So the button is put back on every path out of here, including the
        /// ones nobody thought of.
        /// </summary>
        static void ConnectDiscord()
        {
            if (linkingDiscord) return;
            linkingDiscord = true;
            SetLinkButtons(false);
            if (labelDiscord != null) labelDiscord.Text = "Waiting…";
            Log("Waiting for your browser. Sign in to Discord and it closes itself.");

            ThreadPool.QueueUserWorkItem(delegate
            {
                bool answered = false;
                try
                {
                    Discord.Connect(delegate (bool ok, string who)
                    {
                        answered = true;
                        Dispatcher.UIThread.Post(new Action(delegate
                        {
                            linkingDiscord = false;
                            SetLinkButtons(true);
                            Door.Forget();          // re-ask with the new ticket
                            if (!ok)
                            {
                                if (labelDiscord != null) labelDiscord.Text = who;
                                Log("Discord: " + who);
                                DrawStatus();       // so the collection card offers it again
                            }
                            else
                            {
                                RefreshDiscord();
                                DrawStatus();
                                Log("Linked as " + (who.Length > 0 ? who : "your Discord account") + ".");
                            }
                        }));
                    });
                }
                catch (Exception ex)
                {
                    string why = ex.Message;
                    Dispatcher.UIThread.Post(new Action(delegate
                    {
                        linkingDiscord = false;
                        SetLinkButtons(true);
                        RefreshDiscord();
                        DrawStatus();
                        Log("Connecting Discord failed: " + why + "  Press it again.");
                    }));
                    return;
                }

                // Belt to the braces above: a Connect that returns without ever
                // calling back is still not allowed to leave the button dead.
                if (!answered)
                {
                    Dispatcher.UIThread.Post(new Action(delegate
                    {
                        linkingDiscord = false;
                        SetLinkButtons(true);
                        RefreshDiscord();
                        DrawStatus();
                    }));
                }
            });
        }

        static bool linkingDiscord = false;

        /// <summary>The button that starts a link. The collection bar used to be
        /// a second one; since #428 it only ever opens the collection.</summary>
        static void SetLinkButtons(bool on)
        {
            if (buttonDiscord != null) buttonDiscord.IsEnabled = on;
        }

        /// <summary>The Discord account block above Settings. Called whenever it changes.</summary>
        static void RefreshDiscord()
        {
            if (labelDiscord == null) return;
            // This function is what says the card is now correct, so it is also
            // what puts the button back. Nothing else gets to leave it grey.
            if (buttonDiscord != null) buttonDiscord.IsEnabled = !linkingDiscord;
            if (Discord.Linked)
            {
                string who = Discord.Name;
                labelDiscord.Text = (who != null && who.Length > 0) ? who : "Linked";
                if (buttonDiscord != null) buttonDiscord.Content = "Reconnect";
                LoadDiscordAvatar();
            }
            else
            {
                labelDiscord.Text = "Not linked";
                if (buttonDiscord != null) buttonDiscord.Content = "Connect Discord";
                ClearDiscordAvatar();
            }
            // Linking or unlinking is what decides whether the gallery card can
            // offer Report, and whether the site's last word made this account
            // staff. A report half written under the account that has just gone
            // is closed rather than sent under the new one.
            if (GalleryReportOpen && !Discord.Linked) CloseGalleryReport();
            PaintGalleryPage();
        }

        /// <summary>Empty circle while unlinked, or while a picture is still loading.</summary>
        static void ClearDiscordAvatar()
        {
            if (discordAvatar == null) return;
            discordAvatar.Fill = Res("Line");
        }

        /// <summary>
        /// When linked but no avatar hash is on disk yet, ask /api/play/join once
        /// so the site can hand back Discord's avatar field, then paint it.
        /// </summary>
        static void PullDiscordAvatarIfNeeded()
        {
            if (!Discord.Linked) return;
            string have = "";
            try { have = Discord.Avatar; } catch (Exception ex) { Swallow.Note("Shell.PullDiscordAvatar", ex); }
            if (have != null && have.Length > 0) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try { Discord.Join(); }
                catch (Exception ex) { Swallow.Note("Shell.PullDiscordAvatar", ex); }
                try
                {
                    Dispatcher.UIThread.Post(new Action(delegate
                    {
                        try { LoadDiscordAvatar(); }
                        catch (Exception ex) { Swallow.Note("Shell.PullDiscordAvatar", ex); }
                    }));
                }
                catch (Exception ex) { Swallow.Note("Shell.PullDiscordAvatar", ex); }
            });
        }

        /// <summary>
        /// Discord profile picture into the sidebar circle. Fetched off the UI
        /// thread so a slow CDN does not freeze the window; a miss leaves the
        /// empty circle.
        /// </summary>
        static void LoadDiscordAvatar()
        {
            if (discordAvatar == null) return;
            string url = "";
            try { url = Discord.AvatarUrl; }
            catch (Exception ex) { Swallow.Note("Shell.LoadDiscordAvatar", ex); url = ""; }
            if (string.IsNullOrEmpty(url)) { ClearDiscordAvatar(); return; }
            string want = url;
            ThreadPool.QueueUserWorkItem(delegate
            {
                Bitmap bi = null;
                try
                {
                    byte[] raw = null;
                    try
                    {
                        // TLS 1.2 and later are the default on .NET 10; #1360
                        // had to add 1.2 by hand on the old framework. The
                        // waits are WebClient's: 100 seconds for an answer.
                        using (var ask = new HttpRequestMessage(HttpMethod.Get, want))
                        {
                            ask.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Updater.Version);
                            using (HttpResponseMessage got = Http.Send(ask, 100000))
                            {
                                got.EnsureSuccessStatusCode();
                                raw = Http.Body(got, Http.DefaultReadMs);
                            }
                        }
                    }
                    catch (Exception ex) { Swallow.Note("Shell.LoadDiscordAvatar", ex); raw = null; }
                    if (raw == null || raw.Length == 0) return;
                    using (var ms = new MemoryStream(raw)) bi = new Bitmap(ms);
                }
                catch (Exception ex) { Swallow.Note("Shell.LoadDiscordAvatar", ex); bi = null; }
                if (bi == null) return;
                Bitmap pic = bi;
                try
                {
                    Dispatcher.UIThread.Post(new Action(delegate
                    {
                        if (discordAvatar == null || !Discord.Linked) return;
                        // Stale answer: Reconnect or Forget may have changed the account.
                        string now = "";
                        try { now = Discord.AvatarUrl; } catch (Exception ex) { Swallow.Note("Shell.LoadDiscordAvatar", ex); }
                        if (now != want) return;
                        var brush = new ImageBrush(pic);
                        brush.Stretch = Stretch.UniformToFill;
                        brush.AlignmentX = AlignmentX.Center;
                        brush.AlignmentY = AlignmentY.Center;
                        discordAvatar.Fill = brush;
                    }));
                }
                catch (Exception ex) { Swallow.Note("Shell.LoadDiscordAvatar", ex); }
            });
        }

        static IBrush Res(string key) { return (IBrush)win.Resources[key]; }

        static void Log(string m)
        {
            lastLogged = m;
            txtStatus.Text = m;
            try { File.AppendAllText(Paths.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + m + Environment.NewLine); }
            catch (Exception ex) { Swallow.Note("Shell.Log, append", ex); }
        }

        /// <summary>
        /// One line in launcher.log and nothing on the status line, for
        /// something whoever reads a report needs and whoever is playing does
        /// not. Safe from any thread, which Log is not: Log writes to a control.
        /// </summary>
        static void LogOnly(string m)
        {
            try { File.AppendAllText(Paths.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + m + Environment.NewLine); }
            catch { /* the log is the only place this line could have gone */ }
        }

        /// <summary>
        /// One line saying what pressed Play (#2215): the mouse (and whether its
        /// left button is still down), the keyboard (and the last key down on
        /// this window, and how long ago), or neither, which is UI Automation or
        /// a program; whether the window was the active one; and how long after
        /// the last game closed.
        /// </summary>
        static string PlayPressedBy()
        {
            try
            {
                string by;
                if (lastInput == "mouse")
                    by = "the mouse (left button " + (leftButtonDown ? "still down" : "up") + ")";
                else if (lastInput == "keyboard")
                    by = "the keyboard (last key " + lastKeyDown + ", " +
                         (lastKeyDownAt == DateTime.MinValue ? "never" : (int)(DateTime.Now - lastKeyDownAt).TotalMilliseconds + " ms ago") +
                         (lastKeyModifiers != KeyModifiers.None ? ", " + lastKeyModifiers + " held" : "") + ")";
                else
                    by = lastInput == null ? "no input device (UI Automation or a program)" : lastInput;
                string when = gameClosedAt == DateTime.MinValue ? "no game closed yet this run"
                    : (DateTime.Now - gameClosedAt).TotalSeconds.ToString("0.0") + " s after the last game closed";
                return "Play pressed by " + by + ", window " + (win != null && win.IsActive ? "active" : "not active") + ", " + when + ".";
            }
            catch (Exception ex) { return "Play pressed (what pressed it could not be read: " + ex.Message + ")."; }
        }

        // ------------------------------------------------------------- pages
        // Named, because these are the index into three parallel arrays and a
        // bare number in the middle of Play() sent people to the wrong page for
        // weeks without anyone noticing.
        const int PagePlay = 0, PageNews = 1, PageDiag = 2, PageSettings = 3, PageGallery = 4;

        static readonly string[] PageTitles = {
            "Play", "News", "Diagnostics", "Settings", "Gallery" };

        static void ShowPage(int i)
        {
            for (int k = 0; k < pages.Length; k++)
            {
                pages[k].IsVisible = k == i;
                navButtons[k].Tag = (k == i) ? "on" : "off";
            }
            txtPageTitle.Text = PageTitles[i];

            // Each page is rebuilt as it is opened rather than kept up to date
            // in the background. The folders behind them change while the
            // launcher sits there, so anything cached goes stale.
            if (i == PagePlay) DrawStatus();
            else if (i == PageNews) BuildNews();
            else if (i == PageDiag) BuildDiag();
            else if (i == PageGallery) BuildGalleryPage();

            // The Play spotlight turns only on the Play page, so a page
            // change starts or stops it, the way the title video follows
            // what is on screen.
            GalleryDecide();
        }

        /// <summary>
        /// Puts the moving strip over the still one on the Play page.
        ///
        /// The frames come out of the exe as an animated WebP (Art.HeaderVideo)
        /// and are painted through the same brush as the still picture, with
        /// the same crop, so the two line up. A brush asks for no room at all,
        /// so the band keeps the height the title gives it: a video control
        /// asking for room at the video's own shape once took the band from
        /// 135 to 195 high.
        ///
        /// The frames are decoded on a thread of their own, in order, each at
        /// its own time, and the window's thread only puts the finished frame
        /// on screen: a frame takes about a third of its time on screen to
        /// decode (HeaderFrames says what was measured), which is too much to
        /// take from the thread that answers the mouse. After the last frame
        /// comes the first, with no pause at the join.
        ///
        /// It plays only while somebody can see it: stopped while the window is
        /// minimised or another page is open, and carried on from the same
        /// frame when the Play page is back. Stopped, the thread waits and
        /// costs nothing. If it will not play (no video in this build, a frame
        /// that will not decode) it is hidden and the still picture shows
        /// exactly as before.
        ///
        /// Stopped while the game runs as well, the way the music is. With Keep
        /// Launcher Open ticked the window is never minimised, so until 24
        /// September the video went on decoding behind the game for the whole
        /// session, 3 to 14% of one core that the game could have had. Every
        /// place that changes playing calls headerVideoDecide straight after,
        /// except the check at startup, which runs before the window is shown;
        /// showing it decides then.
        /// </summary>
        static Action headerVideoDecide = delegate { };
        static void StartHeaderVideo()
        {
            var layer = win.HeaderArtVideo;
            var page = win.PagePlay;
            if (layer == null || page == null) return;

            HeaderFrames frames;
            try { frames = Art.HeaderVideo(); }
            catch (Exception ex) { Stamp("Title band: the video did not play (" + ex.Message + "), the still picture stays"); return; }
            if (frames == null) return;

            // The frame on screen. The decoding thread copies each finished
            // frame in under the bitmap's own lock, which is the lock drawing
            // it takes, so a frame is never drawn half copied.
            var shown = new WriteableBitmap(new PixelSize(frames.Width, frames.Height), new Vector(96, 96),
                                            PixelFormat.Bgra8888, AlphaFormat.Premul);
            // Set while somebody can see the strip; the thread waits on it.
            var seenNow = new ManualResetEventSlim(false);
            bool gone = false;
            Action<string> drop = delegate(string why)
            {
                if (gone) return;
                gone = true;
                seenNow.Reset();
                layer.IsVisible = false;
                layer.Background = null;
                Stamp("Title band: the video did not play (" + why + "), the still picture stays");
            };
            Action decide = delegate
            {
                if (gone) return;
                bool seen = win.IsVisible && page.IsVisible && win.WindowState != WindowState.Minimized && !playing;
                if (seen) seenNow.Set(); else seenNow.Reset();
            };

            var decoding = new Thread(delegate()
            {
                bool first = true;
                Stopwatch clock = Stopwatch.StartNew();
                TimeSpan due = TimeSpan.Zero;
                while (true)
                {
                    // Put away: wait, then carry on from this frame on its own
                    // time, not from where the clock got to meanwhile.
                    if (!seenNow.IsSet) { seenNow.Wait(); due = clock.Elapsed; }
                    TimeSpan lasts;
                    try
                    {
                        lasts = frames.Next();
                        using (ILockedFramebuffer to = shown.Lock()) frames.CopyTo(to.Address, to.RowBytes);
                    }
                    catch (Exception ex)
                    {
                        string why = ex.Message;
                        Dispatcher.UIThread.Post(delegate { drop(why); });
                        frames.Dispose();
                        return;
                    }
                    bool putUp = first;
                    first = false;
                    Dispatcher.UIThread.Post(delegate
                    {
                        if (gone) return;
                        if (putUp) { layer.Background = Art.BandBrush(shown); layer.IsVisible = true; }
                        else layer.InvalidateVisual();
                    }, DispatcherPriority.Render);

                    due += lasts;
                    TimeSpan left = due - clock.Elapsed;
                    if (left > TimeSpan.Zero) Thread.Sleep(left);
                    // More than a frame behind (the machine was busy): go on
                    // from now at the strip's own speed rather than racing
                    // through the frames that were missed.
                    else if (-left > lasts) due = clock.Elapsed;
                }
            });
            decoding.IsBackground = true;
            decoding.Name = "Title video";
            decoding.Start();

            decide();
            win.StateChanged += delegate { decide(); };
            win.Opened += delegate { decide(); };
            page.PropertyChanged += delegate(object s, AvaloniaPropertyChangedEventArgs e)
            {
                if (e.Property == Visual.IsVisibleProperty) decide();
            };
            headerVideoDecide = decide;
        }

        /// <summary>
        /// The theme, for the launcher, the game's main menu and the loading
        /// screen. Asked for by Patrick on 20 September, and held to the dev
        /// build until 22 September out of respect for the artist, because the
        /// track was not the final one. He supplied the final version that day
        /// and said it goes to main, so the dev-only rule is gone: the file is
        /// Data\Platform\UI\thornswood-theme.mp3, every pack and the installer
        /// carry it, and it plays on every build.
        ///
        /// It plays from the same file the game's menu plays, so there is one
        /// track on disk and not two.
        ///
        /// On a loop while the launcher is open and the game is not running:
        /// the game's own menu takes over the moment Play is pressed, and the
        /// launcher picks it up again when the game closes. Paused while the
        /// window is minimised, because music from a window nobody can see is
        /// a puzzle rather than a mood. Off entirely when the person has turned
        /// it off in Settings, which is what MusicDecide reads.
        /// </summary>
        // Menu theme plays through MenuMusic, from this process, so the
        // Windows Volume Mixer lists it under this build's name (#3207).
        static void StartMenuMusic()
        {
            // Not for somebody who opened this from Windows Settings to
            // uninstall. The theme playing is the loudest way to say the
            // launcher has started up to play when that is not why it opened.
            if (cfg == null || askedToUninstall) return;
            string src = Path.Combine(Paths.Game, "Data\\Platform\\UI\\thornswood-theme.mp3");
            if (!File.Exists(src))
            {
                string alt = Path.Combine(Paths.Game, "Data\\Platform\\UI\\thornswood-dev-theme.mp3");
                if (File.Exists(alt)) src = alt;
                else return;
            }

            // Played from a copy under Profile, never from the game folder. The
            // copy is refreshed from the game folder on every start, so an
            // updated track is heard the next time the launcher opens, and a
            // pack install is not blocked by a held file handle.
            string file;
            try
            {
                string dir = Path.Combine(Paths.ProfileDir, "Music");
                Directory.CreateDirectory(dir);
                file = Path.Combine(dir, Path.GetFileName(src));
                var a = new FileInfo(src);
                var b = new FileInfo(file);
                if (!b.Exists || b.Length != a.Length || b.LastWriteTimeUtc != a.LastWriteTimeUtc)
                    File.Copy(src, file, true);
            }
            catch (Exception ex)
            {
                Stamp("Menu music: could not copy the track out of the game folder (" + ex.Message + ")");
                return;
            }
            try
            {
                double vol = Math.Max(0, Math.Min(100, cfg.MusicVolume)) / 100.0;
                MenuMusic.Start(file, vol, cfg.BuildName, Icons.IconFile(), Stamp);
                MusicDecide();
                win.StateChanged += delegate { MusicDecide(); };
            }
            catch (Exception ex)
            {
                Stamp("Menu music: " + ex.Message);
            }
        }

        /// <summary>
        /// Plays or pauses the track for the moment: not when it is switched off
        /// in Settings, not while the game runs, not while minimised. The volume
        /// is the Settings slider, 0 to 100.
        /// </summary>
        static void MusicDecide()
        {
            // While the game runs the browser behind the theme is closed, not
            // paused (#963). The first call after the game closes makes it again.
            if (playing) { try { MenuMusic.Close(); } catch (Exception ex) { Swallow.Note("Shell.MusicDecide, close", ex); } return; }
            bool want = cfg != null && cfg.MusicOn && cfg.MusicVolume > 0 && !playing
                && win != null && win.WindowState != WindowState.Minimized;
            double vol = cfg == null ? 0 : Math.Max(0, Math.Min(100, cfg.MusicVolume)) / 100.0;
            try { MenuMusic.Decide(want, vol); } catch (Exception ex) { Swallow.Note("Shell.MusicDecide", ex); }
        }

        static void MusicLabel()
        {
            if (txtMusic == null) return;
            int v = Math.Max(0, Math.Min(100, cfg.MusicVolume));
            txtMusic.Text = v == 0 ? "silent" : v + "%";
        }

        /// <summary>
        /// The pictures the site is showing, turned through on the Play page
        /// as a spotlight of approved pictures only. Upload, Report, Accept
        /// and Delete live on the Gallery page (#731).
        ///
        /// Gallery.Load asks /api/public. The list is fetched once on a pool
        /// thread at start up with /api/gallery/who, so the Gallery page knows
        /// whether the site has the doors at all.
        ///
        /// The Play card stays hidden until the first picture has loaded.
        /// </summary>
        static void StartGallery()
        {
            if (galleryCard == null) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                List<Gallery.Shot> shots = Gallery.Load();
                Gallery.Who who = Gallery.AskWho();
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    galleryWho = who;
                    galleryShots = (shots != null && shots.Count > 0) ? shots : null;
                    galleryAt = -1;
                    PaintGalleryPage();
                    if (galleryShots == null) return;

                    if (galleryTimer == null)
                    {
                        galleryTimer = new DispatcherTimer();
                        galleryTimer.Interval = TimeSpan.FromSeconds(7);
                        galleryTimer.Tick += delegate { ShowNextShot(); };
                        win.StateChanged += delegate { GalleryDecide(); };
                        win.Opened += delegate { GalleryDecide(); };
                    }
                    ShowNextShot();
                    GalleryDecide();
                }));
            });
        }

        /// <summary>
        /// True when the site's last word on this Discord account was that it
        /// is staff: the access.dev roles, which is the same set the site calls
        /// staff at /api/gallery/who.
        ///
        /// Read from the door rather than from who, because who only knows
        /// browser sessions and the launcher has none. Door.Last is this
        /// session's answer when Play has been pressed; Discord.DevAllowed is
        /// the last answer written down, which is what there is before the
        /// first check in of a session.
        /// </summary>
        static bool GalleryStaff()
        {
            if (!Discord.Linked) return false;
            if (Door.Last != null && Door.Last.Dev) return true;
            return Discord.DevAllowed;
        }

        static bool GalleryReportOpen
        {
            get { return galleryPageReportRow != null && galleryPageReportRow.IsVisible; }
        }

        /// <summary>
        /// One line on the Gallery page, or nothing when there is nothing to say.
        /// </summary>
        static void SayGallery(string line)
        {
            if (txtGalleryPageSaid == null) return;
            if (string.IsNullOrEmpty(line))
            {
                txtGalleryPageSaid.Text = "";
                txtGalleryPageSaid.IsVisible = false;
                return;
            }
            txtGalleryPageSaid.Text = line;
            txtGalleryPageSaid.IsVisible = true;
        }

        /// <summary>
        /// Staff block visibility and whether upload is offered, from who and
        /// Discord link state. Called when the Gallery page is built and when
        /// Discord link state changes.
        /// </summary>
        static void PaintGalleryPage()
        {
            bool doors = galleryWho != null && galleryWho.Answered;
            if (btnGallerySend != null)
                btnGallerySend.IsEnabled = doors && Discord.Linked &&
                    galleryChosenPaths != null && galleryChosenPaths.Count > 0;
            if (btnGalleryChoose != null)
                btnGalleryChoose.IsEnabled = doors;
            if (galleryDrop != null)
                galleryDrop.IsEnabled = doors;
        }

        /// <summary>
        /// Rebuilds the Gallery page lists from the public feed and, for staff,
        /// the pending queue. Call on the UI thread after a pool trip, or from
        /// ShowPage which kicks the trip itself.
        /// </summary>
        static void BuildGalleryPage()
        {
            PaintGalleryPage();
            ThreadPool.QueueUserWorkItem(delegate
            {
                List<Gallery.Shot> shots = Gallery.Load();
                Gallery.Who who = Gallery.AskWho();
                string pendingBad = "";
                List<Gallery.Pending> pending = null;
                // Staff queue is Door / DevAllowed, not who.Answered.
                bool staff = Discord.Linked && ((Door.Last != null && Door.Last.Dev) || Discord.DevAllowed);
                if (staff) pending = Gallery.Queue(out pendingBad);
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    galleryWho = who;
                    // A list that could not be read leaves the pictures as
                    // they are rather than hiding Play's card; one that was
                    // read keeps every picture already loaded.
                    if (shots == null) shots = galleryShots;
                    else Gallery.KeepLoaded(shots, galleryShots);
                    // Keep Play's rotation in step with what the Gallery page
                    // just learnt, without forcing a turn mid-page.
                    if (shots != null && shots.Count > 0)
                    {
                        galleryShots = shots;
                        if (galleryAt < 0 || galleryAt >= galleryShots.Count) galleryAt = -1;
                        if (galleryTimer == null)
                        {
                            galleryTimer = new DispatcherTimer();
                            galleryTimer.Interval = TimeSpan.FromSeconds(7);
                            galleryTimer.Tick += delegate { ShowNextShot(); };
                            win.StateChanged += delegate { GalleryDecide(); };
                            win.Opened += delegate { GalleryDecide(); };
                        }
                        if (galleryAt < 0) ShowNextShot();
                        GalleryDecide();
                    }
                    else
                    {
                        galleryShots = null;
                        galleryAt = -1;
                        if (galleryCard != null) galleryCard.IsVisible = false;
                    }

                    galleryPending = pending;
                    PaintGalleryPage();
                    FillGalleryGrid(shots, pending, pendingBad);
                }));
            });
        }

﻿
        /// <summary>
        /// One Gallery grid: approved cards for everyone, plus pending cards for
        /// staff (Door / DevAllowed) in the same WrapPanel. No separate waiting
        /// section. Accept and Delete are staff-only; Reject is gone; Report
        /// stays on approved cards for linked people.
        /// </summary>
        static void FillGalleryGrid(List<Gallery.Shot> shots, List<Gallery.Pending> pending, string pendingBad)
        {
            if (galleryApprovedList == null) return;
            galleryApprovedList.Children.Clear();

            bool doors = galleryWho != null && galleryWho.Answered;
            bool staff = GalleryStaff();
            bool anyApproved = shots != null && shots.Count > 0;
            bool anyPending = staff && pending != null && pending.Count > 0;
            bool any = anyApproved || anyPending;

            if (!string.IsNullOrEmpty(pendingBad) && staff)
                SayGallery(pendingBad);

            if (txtGalleryApprovedEmpty != null)
            {
                txtGalleryApprovedEmpty.Text = any
                    ? ""
                    : "Nothing is on the gallery yet.";
                txtGalleryApprovedEmpty.IsVisible = !any;
            }

            if (anyApproved)
            {
                for (int i = 0; i < shots.Count; i++)
                {
                    Gallery.Shot shot = shots[i];
                    if (shot == null) continue;
                    galleryApprovedList.Children.Add(BuildApprovedCard(shot, doors, staff));
                }
            }

            // Pending only for staff, same grid as approved. Play never sees these.
            if (anyPending)
            {
                for (int i = 0; i < pending.Count; i++)
                {
                    Gallery.Pending item = pending[i];
                    if (item == null || item.Name == null || item.Name.Length == 0) continue;
                    galleryApprovedList.Children.Add(BuildPendingCard(item));
                }
            }
        }

        static Border BuildApprovedCard(Gallery.Shot shot, bool doors, bool staff)
        {
            var card = new Border();
            card.Theme = Look("Slab");
            card.Padding = new Thickness(0);
            card.Margin = new Thickness(0, 0, 14, 14);
            card.Width = 280;
            card.ClipToBounds = true;

            var stack = new StackPanel();

            var frame = new Border();
            frame.Height = 200;
            frame.Background = Res("Line");
            frame.ClipToBounds = true;

            var img = new Image();
            img.Stretch = Stretch.UniformToFill;
            img.HorizontalAlignment = HorizontalAlignment.Stretch;
            img.VerticalAlignment = VerticalAlignment.Stretch;
            RenderOptions.SetBitmapInterpolationMode(img, BitmapInterpolationMode.HighQuality);
            if (shot.Image != null) img.Source = shot.Image;
            frame.Child = img;
            stack.Children.Add(frame);

            if (shot.Image == null && shot.ImageUrl != null && shot.ImageUrl.Length > 0)
            {
                Gallery.Shot hold = shot;
                Image holdImg = img;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    Bitmap bi = Gallery.Fetch(hold);
                    if (bi == null) return;
                    Dispatcher.UIThread.Post(new Action(delegate
                    {
                        if (holdImg != null) holdImg.Source = bi;
                    }));
                });
            }

            var meta = new StackPanel();
            meta.Margin = new Thickness(12, 10, 12, 12);

            var label = new TextBlock();
            label.Theme = Look("Body");
            label.TextWrapping = TextWrapping.Wrap;
            string by = (shot.By != null && shot.By.Length > 0) ? shot.By : "";
            label.Text = by.Length > 0 ? ("By " + by) : "On the gallery";
            meta.Children.Add(label);

            if (doors && Discord.Linked && shot.Name != null && shot.Name.Length > 0)
            {
                var acts = new StackPanel();
                acts.Orientation = Orientation.Horizontal;
                acts.Margin = new Thickness(0, 8, 0, 0);

                var report = new Button();
                report.Theme = Look("Ghost");
                report.Content = "Report";
                report.Padding = new Thickness(10, 4, 10, 4);
                Gallery.Shot holdShot = shot;
                report.Click += delegate { OpenGalleryReport(holdShot); };
                acts.Children.Add(report);

                if (staff)
                {
                    var del = new Button();
                    del.Theme = Look("Ghost");
                    del.Content = "Delete";
                    del.Padding = new Thickness(10, 4, 10, 4);
                    del.Margin = new Thickness(8, 0, 0, 0);
                    string name = shot.Name;
                    del.Click += delegate { GalleryTakeDown(name); };
                    acts.Children.Add(del);
                }
                meta.Children.Add(acts);
            }

            stack.Children.Add(meta);
            card.Child = stack;
            return card;
        }

        static Border BuildPendingCard(Gallery.Pending item)
        {
            var card = new Border();
            card.Theme = Look("Slab");
            card.Padding = new Thickness(0);
            card.Margin = new Thickness(0, 0, 14, 14);
            card.Width = 280;
            card.ClipToBounds = true;

            var stack = new StackPanel();

            var frame = new Border();
            frame.Height = 200;
            frame.Background = Res("Line");
            frame.ClipToBounds = true;

            var img = new Image();
            img.Stretch = Stretch.UniformToFill;
            RenderOptions.SetBitmapInterpolationMode(img, BitmapInterpolationMode.HighQuality);
            if (item.Image != null) img.Source = item.Image;
            frame.Child = img;
            stack.Children.Add(frame);

            Gallery.Pending holdItem = item;
            Image holdImg = img;
            ThreadPool.QueueUserWorkItem(delegate
            {
                Bitmap bi = Gallery.FetchPending(holdItem);
                if (bi == null) return;
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    if (holdImg != null) holdImg.Source = bi;
                }));
            });

            var meta = new StackPanel();
            meta.Margin = new Thickness(12, 10, 12, 12);

            var label = new TextBlock();
            label.Theme = Look("Body");
            label.TextWrapping = TextWrapping.Wrap;
            string by = (item.By != null && item.By.Length > 0) ? item.By : "somebody";
            label.Text = "By " + by + " (waiting)";
            meta.Children.Add(label);

            // Its smaller copies (#3218), which most screens are shown in its
            // place once it is accepted, so staff see them before Accept, and
            // Accept puts out only these.
            int[] copies = item.Copies ?? new int[0];
            if (copies.Length > 0)
            {
                var said = new TextBlock();
                said.Theme = Look("Small");
                said.TextWrapping = TextWrapping.Wrap;
                said.Margin = new Thickness(0, 6, 0, 4);
                said.Text = "Its smaller copies, what most screens show once it is accepted:";
                meta.Children.Add(said);

                var strip = new StackPanel();
                strip.Orientation = Orientation.Horizontal;
                foreach (int width in copies)
                {
                    var small = new Border();
                    small.Width = 120;
                    small.Height = 68;
                    small.Margin = new Thickness(0, 0, 8, 0);
                    small.Background = Res("Line");
                    small.ClipToBounds = true;
                    ToolTip.SetTip(small, "The " + width + " pixel copy");
                    var smallImg = new Image();
                    smallImg.Stretch = Stretch.UniformToFill;
                    RenderOptions.SetBitmapInterpolationMode(smallImg, BitmapInterpolationMode.HighQuality);
                    small.Child = smallImg;
                    strip.Children.Add(small);

                    int holdWidth = width;
                    Image holdSmall = smallImg;
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        Bitmap copy = Gallery.FetchCopy(holdItem, holdWidth);
                        if (copy == null) return;
                        Dispatcher.UIThread.Post(new Action(delegate { holdSmall.Source = copy; }));
                    });
                }
                meta.Children.Add(strip);
            }

            if (item.Note != null && item.Note.Length > 0)
            {
                var note = new TextBlock();
                note.Theme = Look("Small");
                note.TextWrapping = TextWrapping.Wrap;
                note.Margin = new Thickness(0, 4, 0, 0);
                note.Text = item.Note;
                meta.Children.Add(note);
            }

            // Staff-only: this card is only built when GalleryStaff is true.
            var buttons = new StackPanel();
            buttons.Orientation = Orientation.Horizontal;
            buttons.Margin = new Thickness(0, 10, 0, 0);

            var accept = new Button();
            accept.Theme = Look("Solid");
            accept.Content = "Accept";
            accept.Padding = new Thickness(14, 6, 14, 6);
            string name = item.Name;
            accept.Click += delegate { GalleryAccept(name, copies); };
            buttons.Children.Add(accept);

            var del = new Button();
            del.Theme = Look("Ghost");
            del.Content = "Delete";
            del.Padding = new Thickness(12, 6, 12, 6);
            del.Margin = new Thickness(8, 0, 0, 0);
            del.Click += delegate { GalleryDeletePending(name); };
            buttons.Children.Add(del);

            meta.Children.Add(buttons);
            stack.Children.Add(meta);
            card.Child = stack;
            return card;
        }

        static void OpenGalleryReport(Gallery.Shot shot)
        {
            if (shot == null || shot.Name == null || shot.Name.Length == 0) return;
            if (!Discord.Linked)
            {
                SayGallery("Connect Discord first, so the site knows who is reporting this.");
                return;
            }

            galleryReporting = shot;
            SayGallery("Say what is wrong with " + shot.Name + ". Staff read it; nothing comes off the gallery until one of them takes it off.");
            if (boxGalleryWhy != null) boxGalleryWhy.Text = "";
            if (galleryPageReportRow != null) galleryPageReportRow.IsVisible = true;
            if (boxGalleryWhy != null) boxGalleryWhy.Focus();
        }

        static void CloseGalleryReport()
        {
            galleryReporting = null;
            if (galleryPageReportRow != null) galleryPageReportRow.IsVisible = false;
            if (boxGalleryWhy != null) boxGalleryWhy.Text = "";
            if (btnGalleryReportSend != null) btnGalleryReportSend.IsEnabled = true;
        }

        static void SendGalleryReport()
        {
            Gallery.Shot shot = galleryReporting;
            if (shot == null) { CloseGalleryReport(); return; }

            string name = shot.Name;
            string why = boxGalleryWhy == null ? "" : boxGalleryWhy.Text;
            if (btnGalleryReportSend != null) btnGalleryReportSend.IsEnabled = false;
            SayGallery("Sending that to staff...");

            ThreadPool.QueueUserWorkItem(delegate
            {
                string bad = Gallery.Report(name, why);
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    if (bad.Length == 0)
                    {
                        CloseGalleryReport();
                        SayGallery("Sent. Staff will look at it; the picture stays up until one of them takes it down.");
                    }
                    else
                    {
                        if (btnGalleryReportSend != null) btnGalleryReportSend.IsEnabled = true;
                        SayGallery(bad);
                    }
                }));
            });
        }

        static async void GalleryChooseFile()
        {
            var ask = new FilePickerOpenOptions();
            ask.Title = "Choose pictures for the gallery";
            ask.AllowMultiple = true;
            ask.FileTypeFilter = new[] {
                new FilePickerFileType("Pictures") { Patterns = new[] { "*.png", "*.jpg", "*.jpeg", "*.webp", "*.gif" } },
                new FilePickerFileType("All files") { Patterns = new[] { "*.*" } } };
            IReadOnlyList<IStorageFile> picked;
            try { picked = await win.StorageProvider.OpenFilePickerAsync(ask); }
            catch (Exception ex) { Swallow.Note("Shell.GalleryChooseFile", ex); return; }
            if (picked == null || picked.Count == 0) return;
            GalleryAddChosen(LocalPaths(picked));
        }

        /// <summary>
        /// The paths on this PC of files picked or dropped. One that is not a
        /// file on this PC (nothing Windows hands over is that) is left out.
        /// </summary>
        static List<string> LocalPaths(IEnumerable<IStorageItem> items)
        {
            var paths = new List<string>();
            foreach (IStorageItem item in items)
            {
                string path = item.TryGetLocalPath();
                if (!string.IsNullOrEmpty(path)) paths.Add(path);
            }
            return paths;
        }

        static bool GalleryAllowedPath(string path)
        {
            if (path == null || path.Length == 0) return false;
            string ext = Path.GetExtension(path).ToLowerInvariant();
            return ext == ".png" || ext == ".jpg" || ext == ".jpeg" ||
                   ext == ".webp" || ext == ".gif";
        }

        static void GalleryAddChosen(System.Collections.IEnumerable paths)
        {
            if (galleryChosenPaths == null) galleryChosenPaths = new List<string>();
            foreach (string path in paths)
            {
                if (!GalleryAllowedPath(path)) continue;
                if (!File.Exists(path)) continue;
                bool have = false;
                for (int i = 0; i < galleryChosenPaths.Count; i++)
                    if (string.Equals(galleryChosenPaths[i], path, StringComparison.OrdinalIgnoreCase))
                    { have = true; break; }
                if (!have) galleryChosenPaths.Add(path);
            }
            PaintGalleryChosen();
            PaintGalleryPage();
            SayGallery("");
        }

        static void GalleryRemoveChosen(string path)
        {
            if (galleryChosenPaths == null) return;
            for (int i = galleryChosenPaths.Count - 1; i >= 0; i--)
                if (string.Equals(galleryChosenPaths[i], path, StringComparison.OrdinalIgnoreCase))
                    galleryChosenPaths.RemoveAt(i);
            PaintGalleryChosen();
            PaintGalleryPage();
        }

        static void PaintGalleryChosen()
        {
            if (galleryChosenList == null) return;
            galleryChosenList.Children.Clear();
            int n = galleryChosenPaths == null ? 0 : galleryChosenPaths.Count;
            if (txtGalleryChosen != null)
                txtGalleryChosen.Text = n == 0 ? "No file chosen"
                    : (n == 1 ? Path.GetFileName(galleryChosenPaths[0])
                              : (n + " pictures chosen"));
            if (n == 0) return;

            for (int i = 0; i < galleryChosenPaths.Count; i++)
            {
                string path = galleryChosenPaths[i];
                var row = new Border();
                row.Theme = Look("Slab");
                row.Padding = new Thickness(8, 8, 8, 8);
                if (i > 0) row.Margin = new Thickness(0, 8, 0, 0);

                var grid = new Grid();
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                grid.ColumnDefinitions.Add(new ColumnDefinition());
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var thumb = new Border();
                thumb.Width = 56; thumb.Height = 56;
                thumb.ClipToBounds = true;
                thumb.Background = Res("Line");
                var img = new Image();
                img.Stretch = Stretch.UniformToFill;
                try
                {
                    using (FileStream fs = File.OpenRead(path))
                        img.Source = Bitmap.DecodeToWidth(fs, 112);
                }
                catch (Exception ex) { Swallow.Note("Shell.PaintGalleryChosen thumb", ex); }
                thumb.Child = img;
                Grid.SetColumn(thumb, 0);
                grid.Children.Add(thumb);

                var meta = new StackPanel();
                meta.Margin = new Thickness(12, 0, 0, 0);
                meta.VerticalAlignment = VerticalAlignment.Center;
                var name = new TextBlock();
                name.Theme = Look("Body");
                name.Text = Path.GetFileName(path);
                name.TextTrimming = TextTrimming.CharacterEllipsis;
                meta.Children.Add(name);
                try
                {
                    long len = new FileInfo(path).Length;
                    var size = new TextBlock();
                    size.Theme = Look("Small");
                    size.Margin = new Thickness(0, 2, 0, 0);
                    if (len < 1024) size.Text = len + " B";
                    else if (len < 1024 * 1024) size.Text = (len / 1024) + " KB";
                    else size.Text = (len / (1024.0 * 1024.0)).ToString("0.0") + " MB";
                    meta.Children.Add(size);
                }
                catch (Exception ex) { Swallow.Note("Shell.PaintGalleryChosen size", ex); }
                Grid.SetColumn(meta, 1);
                grid.Children.Add(meta);

                var rem = new Button();
                rem.Theme = Look("Ghost");
                rem.Content = "Remove";
                rem.Padding = new Thickness(10, 4, 10, 4);
                rem.VerticalAlignment = VerticalAlignment.Center;
                string hold = path;
                rem.Click += delegate { GalleryRemoveChosen(hold); };
                Grid.SetColumn(rem, 2);
                grid.Children.Add(rem);

                row.Child = grid;
                galleryChosenList.Children.Add(row);
            }
        }

        static void WireGalleryDrop()
        {
            if (galleryDrop == null) return;
            galleryDrop.AddHandler(DragDrop.DragEnterEvent, GalleryDropOver);
            galleryDrop.AddHandler(DragDrop.DragOverEvent, GalleryDropOver);
            galleryDrop.AddHandler(DragDrop.DragLeaveEvent, delegate (object s, DragEventArgs e)
            {
                galleryDrop.BorderBrush = Res("Edge");
                galleryDrop.Background = new SolidColorBrush(Color.FromArgb(0x8C, 0x0B, 0x0E, 0x0A));
            });
            galleryDrop.AddHandler(DragDrop.DropEvent, delegate (object s, DragEventArgs e)
            {
                galleryDrop.BorderBrush = Res("Edge");
                galleryDrop.Background = new SolidColorBrush(Color.FromArgb(0x8C, 0x0B, 0x0E, 0x0A));
                IStorageItem[] files = e.DataTransfer == null ? null : e.DataTransfer.TryGetFiles();
                if (files == null || files.Length == 0) return;
                GalleryAddChosen(LocalPaths(files));
            });
            galleryDrop.PointerReleased += delegate (object s, PointerReleasedEventArgs e)
            {
                if (e.InitialPressMouseButton != MouseButton.Left) return;
                Visual from = e.Source as Visual;
                if (from != null && from.FindAncestorOfType<Button>(true) != null) return;
                GalleryChooseFile();
            };
        }

        static void GalleryDropOver(object s, DragEventArgs e)
        {
            if (e.DataTransfer != null && e.DataTransfer.Contains(DataFormat.File))
            {
                e.DragEffects = DragDropEffects.Copy;
                galleryDrop.BorderBrush = Res("Accent");
                galleryDrop.Background = new SolidColorBrush(Color.FromArgb(0x28, 0xC9, 0xA2, 0x4B));
            }
            else e.DragEffects = DragDropEffects.None;
            e.Handled = true;
        }

        static void GallerySendChosen()
        {
            if (!Discord.Linked)
            {
                SayGallery("Connect Discord first, so the site knows who is sending this.");
                return;
            }
            if (galleryChosenPaths == null || galleryChosenPaths.Count == 0)
            {
                SayGallery("Choose a picture to send first.");
                return;
            }
            string[] paths = galleryChosenPaths.ToArray();
            string by = boxGalleryBy == null ? "" : boxGalleryBy.Text;
            string note = boxGalleryNote == null ? "" : boxGalleryNote.Text;
            if (btnGallerySend != null) btnGallerySend.IsEnabled = false;
            SayGallery(paths.Length == 1
                ? "Sending that to thornswood.net..."
                : ("Sending " + paths.Length + " pictures to thornswood.net..."));

            ThreadPool.QueueUserWorkItem(delegate
            {
                int ok = 0;
                string firstBad = "";
                string firstCopy = "";
                for (int i = 0; i < paths.Length; i++)
                {
                    string copyBad;
                    string bad = Gallery.Submit(paths[i], by, note, out copyBad);
                    if (bad.Length == 0) ok++;
                    else if (firstBad.Length == 0) firstBad = bad;
                    if (copyBad.Length > 0 && firstCopy.Length == 0) firstCopy = copyBad;
                }
                // A smaller copy that did not go (#3218) is said after the rest.
                string copyNote = firstCopy.Length > 0 ? " " + firstCopy : "";
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    if (ok == paths.Length)
                    {
                        galleryChosenPaths.Clear();
                        PaintGalleryChosen();
                        if (boxGalleryNote != null) boxGalleryNote.Text = "";
                        SayGallery((ok == 1
                            ? "Sent. It is waiting for staff to Accept it onto the gallery."
                            : ("Sent " + ok + " pictures. They are waiting for staff to Accept.")) + copyNote);
                        BuildGalleryPage();
                    }
                    else if (ok > 0)
                    {
                        galleryChosenPaths.Clear();
                        PaintGalleryChosen();
                        SayGallery("Sent " + ok + " of " + paths.Length + ". " + firstBad + copyNote);
                        BuildGalleryPage();
                    }
                    else
                    {
                        SayGallery(firstBad.Length > 0 ? firstBad : "Nothing was sent.");
                        PaintGalleryPage();
                    }
                }));
            });
        }

        /// <summary>shown is the smaller copies the card showed (#3218).</summary>
        static void GalleryAccept(string name, int[] shown)
        {
            SayGallery("Accepting " + name + "...");
            ThreadPool.QueueUserWorkItem(delegate
            {
                string bad = Gallery.Approve(name, shown);
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    if (bad.Length == 0)
                    {
                        SayGallery("Accepted. It is on the gallery and will show on Play.");
                        BuildGalleryPage();
                    }
                    else SayGallery(bad);
                }));
            });
        }

        static void GalleryDeletePending(string name)
        {
            SayGallery("Deleting " + name + "...");
            ThreadPool.QueueUserWorkItem(delegate
            {
                // Same staff queue door as the old Reject; UI no longer says Reject.
                string bad = Gallery.Reject(name);
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    if (bad.Length == 0)
                    {
                        SayGallery("Deleted. It is off the gallery queue.");
                        BuildGalleryPage();
                    }
                    else SayGallery(bad);
                }));
            });
        }

        static void GalleryTakeDown(string name)
        {
            SayGallery("Taking " + name + " down...");
            ThreadPool.QueueUserWorkItem(delegate
            {
                string bad = Gallery.TakeDown(name);
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    if (bad.Length == 0)
                    {
                        SayGallery("Taken down. It is no longer on the gallery or on Play.");
                        BuildGalleryPage();
                    }
                    else SayGallery(bad);
                }));
            });
        }

        /// <summary>
        /// Turns to the next picture on the Play spotlight. Its image is
        /// fetched on a pool thread the first time it is shown and kept after
        /// that; a picture that will not load leaves the one before it up and
        /// the next tick turns past it.
        /// </summary>
        static void ShowNextShot()
        {
            if (galleryShots == null || galleryShots.Count == 0) return;
            galleryAt = (galleryAt + 1) % galleryShots.Count;
            Gallery.Shot shot = galleryShots[galleryAt];

            if (shot.Image != null) { ShowShot(shot); return; }

            ThreadPool.QueueUserWorkItem(delegate
            {
                Bitmap bi = Gallery.Fetch(shot);
                if (bi == null) return;
                Dispatcher.UIThread.Post(new Action(delegate { ShowShot(shot); }));
            });
        }

        static void ShowShot(Gallery.Shot shot)
        {
            if (shot == null || shot.Image == null) return;
            if (galleryImage != null)
            {
                galleryImage.Stretch = Stretch.UniformToFill;
                galleryImage.HorizontalAlignment = HorizontalAlignment.Stretch;
                galleryImage.VerticalAlignment = VerticalAlignment.Stretch;
                galleryImage.Source = shot.Image;
            }
            if (galleryBy != null)
                galleryBy.Text = (shot.By != null && shot.By.Length > 0)
                    ? "By " + shot.By
                    : "";
            if (galleryCard != null && !galleryCard.IsVisible)
                galleryCard.IsVisible = true;
        }

        /// <summary>
        /// Runs the Play spotlight rotation only when the Play page is up, the
        /// window is not minimised and no game is running.
        /// </summary>
        static void GalleryDecide()
        {
            if (galleryTimer == null || galleryShots == null) return;
            bool seen = win.IsVisible && pages != null && pages[PagePlay] != null &&
                        pages[PagePlay].IsVisible &&
                        win.WindowState != WindowState.Minimized && !playing;
            if (seen) { if (!galleryTimer.IsEnabled) galleryTimer.Start(); }
            else { if (galleryTimer.IsEnabled) galleryTimer.Stop(); }
        }

        static void Wire()
        {
            // The Play page names the server rather than addressing it. See the
            // note on BtnSrvCopy in Pages.cs.
            txtServer.Text = "Thornswood";
            chkAutoUpdate.IsChecked = cfg.AutoUpdate;
            txtVersion.Text = "launcher " + Updater.Version;
            // Channel is already on the sidebar brand (Thornswood over Dev).
            // Do not also tag the version line; that leftover truncated as
            // "dev bu". The one-line "Thornswood Dev" ran past the emblem in
            // the 208 column; two lines keep the name and Dev both visible.
            if (cfg.IsDev)
            {
                txtServer.Text = "Thornswood Dev";
                if (txtBrandSmall != null) txtBrandSmall.Text = "Thornswood\nDev";
                if (txtBrandBig != null) txtBrandBig.Text = "Thornswood Dev";
                try { win.Title = "Thornswood Dev"; } catch (Exception ex) { Swallow.Note("Shell.ApplyConfig", ex); }
            }
            DrawServerPick();

            DrawBuildLine();
            // Source code, under the version lines: the fork at the commit the
            // six files beside this launcher were built from, or the credits
            // page's source section when the exe carries no record (#421).
            Button btnSource = win.BtnSource;
            string source = ClientRuntime.SourceUrl;
            if (string.IsNullOrEmpty(source)) source = cfg.SiteUrl.TrimEnd('/') + "/credits#source";
            ToolTip.SetTip(btnSource, "SkyMP is free software. This opens its source, with every change Thornswood made: " + source);
            btnSource.Click += delegate { Open(source); };
            txtStatusRight.Text = Paths.Root;
            chkKeepOpen.IsChecked = cfg.KeepLauncherOpen;
            chkCrashSnapshots.IsChecked = cfg.CrashSnapshots;
            DrawCrashFolder();
            if (chkMusic != null) chkMusic.IsChecked = cfg.MusicOn;
            if (sldMusic != null) sldMusic.Value = Math.Max(0, Math.Min(100, cfg.MusicVolume));
            MusicLabel();
            // The address, the port, the update source and the voice port are
            // not on this page any more. They are not settings: they are facts
            // about the server everybody connects to, they arrive in the update
            // and the launcher applies them. A box that lets somebody change
            // where the server is can only ever be wrong.
            //
            // Auto join is forced rather than offered for the same reason.
            // Unticking it left the person at a main menu with no way in and
            // nothing on screen saying why.
            if (!cfg.AutoJoin) { cfg.AutoJoin = true; cfg.Save(Paths.CfgFile); }
            // A request to the voice service. Somebody who came to uninstall
            // is not waiting on its answer, and Diagnostics asks again.
            if (!askedToUninstall) CheckVoice();

            // The emblem travels inside the exe rather than beside it, so the
            // update that replaces the launcher carries its artwork with it and
            // there is no second file to lose.
            Bitmap emblem = Art.Emblem();
            if (emblem != null)
            {
                win.Icon = new WindowIcon(emblem);
                var big = win.Emblem;
                if (big != null) { big.Source = emblem; big.IsVisible = true; }
                var small = win.EmblemSmall;
                if (small != null) { small.Source = emblem; small.IsVisible = true; }
            }
            else
            {
                WindowIcon own = Art.AppIcon();
                if (own != null) win.Icon = own;
            }

            // The landscape behind the title travels the same way. Without it
            // the band stays collapsed and keeps its pattern.
            ImageBrush headerArt = Art.Header();
            if (headerArt != null)
            {
                var band = win.HeaderArt;
                var picture = win.HeaderArtPicture;
                if (band != null && picture != null) { picture.Background = headerArt; band.IsVisible = true; }
                StartHeaderVideo();
            }
            // Menu music starts from the ApplicationIdle callback in Run.

            // Dragging the title bar, a double click on it and snapping are
            // Windows' own: the bar is the window's caption (TitleBar's
            // ElementRole in MainWindow.axaml), and a maximised window fits the
            // screen it is on with nothing hanging past the edges.
            btnMin.Click += delegate { win.WindowState = WindowState.Minimized; };
            btnMax.Click += delegate { win.WindowState = win.WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized; };
            btnClose.Click += delegate { win.Close(); };

            for (int i = 0; i < navButtons.Length; i++)
            {
                int k = i;
                navButtons[i].Click += delegate { ShowPage(k); };
            }
            // Help is the site's, in the browser: the game has it on F7, and a
            // third copy here is the one that goes stale (#3146).
            Button navHelp = win.NavHelp;
            if (navHelp != null) navHelp.Click += delegate { Open(cfg.SiteUrl.TrimEnd('/') + "/help"); };

            btnCopy.IsVisible = false;

            // For PlayPressedBy: the last key that went down on this window,
            // and whether the mouse or the keyboard was used last. Seen on the
            // way down to the control, before anything can handle it.
            win.AddHandler(InputElement.KeyDownEvent, delegate (object s, KeyEventArgs e)
            {
                lastKeyDown = e.Key;
                lastKeyDownAt = DateTime.Now;
                lastKeyModifiers = e.KeyModifiers;
                lastInput = "keyboard";
            }, RoutingStrategies.Tunnel, true);
            win.AddHandler(InputElement.PointerPressedEvent, delegate (object s, PointerPressedEventArgs e)
            {
                lastInput = e.Pointer.Type == PointerType.Mouse ? "mouse" : e.Pointer.Type.ToString().ToLowerInvariant();
                if (e.GetCurrentPoint(win).Properties.IsLeftButtonPressed) leftButtonDown = true;
            }, RoutingStrategies.Tunnel, true);
            win.AddHandler(InputElement.PointerReleasedEvent, delegate (object s, PointerReleasedEventArgs e)
            {
                if (e.InitialPressMouseButton == MouseButton.Left) leftButtonDown = false;
            }, RoutingStrategies.Tunnel, true);
            btnPlay.Click += delegate
            {
                // What pressed it, into the log (#2215). Since 20 September the
                // game has started again within three seconds of closing 17
                // times on One, the person saying they quit with the mouse
                // through Steam's overlay, and only this button reaches
                // StartPlay from outside. Nothing said which input pressed it,
                // so the cause could not be measured; this line is that
                // measurement.
                LogOnly(PlayPressedBy());
                // Play means Play. Until 20 September this opened a bar of two
                // character slots and the slot's own button started the game;
                // the person picks at the game's main menu now.
                if (playing) { Play(); return; }
                StartPlay();
            };
            if (buttonDiscord != null) buttonDiscord.Click += delegate { ConnectDiscord(); };

            // The card above Play and Settings' button are one button in two
            // places (#3201). The card's used to run the update whatever the
            // card said, so under "Your mods are not installed yet" it ran an
            // update with nothing in it instead of opening the collection.
            btnUpdate.Click += delegate { InstallNowPressed(); };
            if (btnDowngrade != null) btnDowngrade.Click += delegate { RunDowngrade(); };
            btnInstallNow.Click += delegate { InstallNowPressed(); };

            if (chkMusic != null) chkMusic.Click += delegate
            {
                cfg.MusicOn = chkMusic.IsChecked == true;
                cfg.Save(Paths.CfgFile);
                MusicDecide();
            };
            if (sldMusic != null) sldMusic.ValueChanged += delegate
            {
                cfg.MusicVolume = (int)Math.Round(sldMusic.Value);
                MusicLabel();
                MusicDecide();
                cfg.Save(Paths.CfgFile);
            };
            chkKeepOpen.Click += delegate
            {
                cfg.KeepLauncherOpen = chkKeepOpen.IsChecked == true;
                cfg.Save(Paths.CfgFile);
            };

            // The dev build's uninstall is its own removal, never the main
            // uninstaller: that one deletes Thornswood's files out of the
            // shared game folder, which would take the main build down too.
            if (cfg.IsDev)
            {
                btnUninstall.Content = "Remove the dev build";
                if (chkDeleteMods != null) chkDeleteMods.IsVisible = false;
                if (chkKeepSaves != null) chkKeepSaves.IsVisible = false;
                btnUninstall.Click += delegate
                {
                    bool r = Ask.YesNo(
                        "Remove the dev build?\n\nThis launcher and its folder go. The main build, the game and your characters on the dev server are not touched.",
                        "Thornswood Dev", Ask.Icon.Question);
                    if (!r) return;
                    try { Log(DevBuild.RemoveSelf()); }
                    catch (Exception ex) { Log("Could not remove the dev build: " + ex.Message); return; }
                    try { Voice.Stop(); } catch (Exception ex) { Swallow.Note("Shell.Wire", ex); }
                    Quit();
                };
            }
            else
            {
                btnUninstall.Click += delegate { DoUninstall(); };
            }
            if (btnServerPick != null) btnServerPick.Click += delegate { ToggleServerPick(); };
            if (btnServerDev != null) btnServerDev.Click += delegate { CloseServerPick(); SwitchToDev(); };
            if (btnServerMain != null) btnServerMain.Click += delegate { CloseServerPick(); SwitchToMain(); };
            if (btnCheckDiagnostics != null) btnCheckDiagnostics.Click += delegate { ShowPage(PageDiag); };
            if (btnOpenSteam != null) btnOpenSteam.Click += delegate { OpenSteam(); };

            btnSaveDisplay.Click += delegate { SaveDisplay(); };
            btnQuitGame.Click += delegate
            {
                if (!Checks.GameRunning()) { Log("Skyrim is not running."); DrawStatus(); return; }
                bool r = Ask.YesNo(
                    "Close Skyrim now?\n\nAnything since your last save in that session is lost, and on a shared world "
                    + "the others will see you vanish.",
                    "Thornswood", Ask.Icon.Warning);
                if (!r) return;

                Log("Closing Skyrim...");
                int n;
                string still = CloseGameWaiting(out n);
                if (still.Length > 0)
                {
                    Log("Skyrim would not close. " + still);
                    Ask.Tell("Skyrim would not close.\n\n" + still, "Thornswood", Ask.Icon.Warning);
                    DrawStatus();
                    return;
                }
                Log(n > 0 ? "Closed Skyrim." : "Skyrim was already gone.");
                // The two second tick does the rest: puts the Windows folders
                // back, records the session and turns Play on again.
                DrawStatus();
            };
            chkCrashSnapshots.Click += delegate
            {
                // #2626: off unless the person turns it on. Crash Logger's own
                // switch follows at the next Play (CrashDump.Apply).
                cfg.CrashSnapshots = chkCrashSnapshots.IsChecked == true;
                try { cfg.Save(Paths.CfgFile); } catch (Exception ex) { Swallow.Note("Shell.Wire, cfg save", ex); }
                Log(cfg.CrashSnapshots
                    ? "Crash snapshots on. From the next Play, a crash saves one in " + CrashDump.KeptIn(cfg) + ". One can be 9 GB or more; each is kept until staff have looked at that crash, two at most."
                    : "Crash snapshots off. From the next Play none are written. Any already saved are left where they are.");
            };
            btnCrashFolder.Click += delegate { PickCrashFolder(); };
            chkLockRes.Click += delegate
            {
                cfg.LockResolution = chkLockRes.IsChecked == true;
                try { cfg.Save(Paths.CfgFile); } catch (Exception ex) { Swallow.Note("Shell.Wire, cfg save", ex); }
                Log(cfg.LockResolution
                    ? "Resolution locked. Play will leave it exactly as you set it."
                    : "Resolution unlocked. Play will match it to your screen.");
            };

            // Scan looks at everything and Fix puts right what it found, then
            // looks again and says what is left (#2627, ShellScanFix.cs).
            btnScan.Click += delegate { RunScan(true); };
            btnFix.Click += delegate { RunFix(); };

            chkAutoUpdate.Click += delegate
            {
                cfg.AutoUpdate = chkAutoUpdate.IsChecked == true;
                cfg.Save(Paths.CfgFile);
            };
            btnCheckNow.Click += delegate
            {
                Log("Checking for updates...");
                ThreadPool.QueueUserWorkItem(delegate { CheckUpdatesBackground(true); });
            };


            // Gallery page (#731): upload, refresh, report send/cancel.
            WireGalleryDrop();
            if (btnGalleryChoose != null) btnGalleryChoose.Click += delegate { GalleryChooseFile(); };
            if (btnGallerySend != null) btnGallerySend.Click += delegate { GallerySendChosen(); };
            if (btnGalleryRefresh != null) btnGalleryRefresh.Click += delegate { BuildGalleryPage(); };
            if (btnGalleryReportCancel != null) btnGalleryReportCancel.Click += delegate { CloseGalleryReport(); };
            if (btnGalleryReportSend != null) btnGalleryReportSend.Click += delegate { SendGalleryReport(); };
            if (boxGalleryWhy != null)
                boxGalleryWhy.KeyDown += delegate (object s, KeyEventArgs e)
                {
                    if (e.Key == Key.Enter) { e.Handled = true; SendGalleryReport(); }
                    else if (e.Key == Key.Escape) { e.Handled = true; CloseGalleryReport(); }
                };

            WirePages();
            WireProgress();
            WireOwnGame();
            btnFolder.Click += delegate { Open(Paths.Root); };
            btnOpenLog.Click += delegate
            {
                if (File.Exists(Paths.LogFile)) Open(Paths.LogFile); else Log("Nothing has been logged yet.");
            };
            // Repair and Restore Windows folders were buttons here until
            // 17 Oct (#2627). Scan finds this build's own files changed or
            // missing and Windows' Skyrim folders left pointed at Thornswood,
            // and Fix runs the same steps (Upkeep.FixOnDisk).
            btnIcons.Click += delegate
            {
                // Explorer goes away for a second, so this one says so first
                // rather than leaving somebody watching their taskbar vanish.
                bool r = Ask.YesNo(
                    "This throws away the pictures Windows has remembered for the shortcut and redraws them.\n\n" +
                    "The desktop and taskbar will blink once while Explorer restarts. Nothing is lost.\n\nGo ahead?",
                    "Thornswood", Ask.Icon.Question);
                if (!r) return;

                btnIcons.IsEnabled = false;
                Log("Refreshing the shortcut icon...");
                ThreadPool.QueueUserWorkItem(delegate
                {
                    string said;
                    try { said = Icons.Repair(); }
                    catch { said = "Could not refresh the icon."; }
                    Dispatcher.UIThread.Post((Action)delegate
                    {
                        btnIcons.IsEnabled = true;
                        Log(said);
                    });
                });
            };

            win.Closing += delegate(object s, WindowClosingEventArgs e)
            {
                // Not while Skyrim is being closed. Play or the update that
                // asked for it carries on once it is gone, window or no window.
                // The launcher ending itself (Quit) is not asked either.
                if (!quitting && waitDepth > 0) { e.Cancel = true; Log("Wait for Skyrim to finish closing."); return; }
                if (!quitting && playing)
                {
                    bool r = Ask.YesNo(
                        "Skyrim is still running. Quit the game first, otherwise this session's saves end up in the wrong folder.\n\nClose the launcher anyway?",
                        "Thornswood", Ask.Icon.Warning);
                    if (!r) { e.Cancel = true; return; }
                }
                if (timer != null) timer.Stop();
                Swap.Restore();
                try { Hold.Release(); } catch (Exception ex) { Swallow.Note("Shell.Wire, dispose", ex); }
                if (!playing) { try { Keep.Unpark(); } catch (Exception ex) { Swallow.Note("Shell.Wire", ex); } }
                if (cfg.StopServerOnExit && SkyMp.Stop()) Log("Stopped the server.");
            };

            timer = new DispatcherTimer();
            timer.Interval = TimeSpan.FromSeconds(2);
            timer.Tick += delegate
            {
                // Every fifteenth two second tick, so the Server page has a
                // history to draw rather than one lonely bar.
                if (++pingTicks >= 15) { pingTicks = 0; StartPing(); }

                // Steam starting or closing redraws the Ready card, so it never
                // says "running" about a Steam that has closed or keeps "Steam
                // not running" up after Open Steam has started it (#3204).
                // Nothing else redraws the rows between page changes and scans.
                if (!playing)
                {
                    if (Checks.SteamStillRunning() != steamShown) DrawStatus();
                    // A collection update finished in Vortex takes the card
                    // down and asks for the updates that waited on it, with
                    // nothing pressed (#5136, ShellVortexWatch.cs).
                    WatchVortex();
                    return;
                }
                // Asks the game processes the last look found whether they are
                // still up, and lists the machine's processes only when none is
                // (#978). Same answer as GameRunning, on the same tick.
                if (Checks.GameStillRunning())
                {
                    // Who was picked at the game's menu, every tick. One file
                    // read, and nothing when the file says what it said last.
                    PollChoice();
                    // Every fifteenth two second tick, so every thirty
                    // seconds: a pack is seen within half a minute of going
                    // out, and the close below lands on the server's own
                    // countdown rather than minutes after it.
                    if (++inPlayTicks >= 15) { inPlayTicks = 0; CheckUpdatesInPlay(); }
                    return;
                }
                playing = false;
                inPlayTicks = 0;
                MusicDecide();
                headerVideoDecide();
                GalleryDecide();
                // An update was seen during the session and they quit before
                // the five minutes were up. The clock goes, the fact does not:
                // it is fetched now, the same as it would have been had the
                // launcher closed the game itself. Otherwise quitting early was
                // a way to stay on a build the rest of the room had moved past,
                // with nothing on screen to say so.
                if (updateSeenAt != DateTime.MinValue) closedForUpdate = true;
                updateSeenAt = DateTime.MinValue;
                try { Presence.Stop(); } catch (Exception ex) { Swallow.Note("Shell.Wire, dispose", ex); }
                try { Hold.Release(); } catch (Exception ex) { Swallow.Note("Shell.Wire, dispose", ex); }
                Keep.TakeNote();
                Swap.Restore();
                {
                    int parked = Keep.Unpark();
                    if (parked > 0) Log("Put back " + parked + " parked " + (parked == 1 ? "plugin" : "plugins") + " from another server or build now that " + cfg.BuildName + " has closed.");
                }
                Stats.StoppedPlaying(playStartedAt);
                // The other end of the session for the site's log: how long it
                // ran, who was played, and why it stopped. closedForUpdate is
                // read here because it is cleared further down this same tick.
                // Off this thread and wrapped: the game has already closed and
                // nothing here is worth a wait on a network.
                double ranFor = (DateTime.Now - playStartedAt).TotalMinutes;
                int playedAs = chosenId;
                bool endedForUpdate = closedForUpdate;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try { Discord.SessionEnd(playedAs, ranFor, endedForUpdate ? "update" : "quit"); } catch (Exception ex) { Swallow.Note("Shell.Wire, dispose", ex); }
                    // Then the logs, on the same thread so they go after the
                    // row they attach to exists. This is the only moment they
                    // can be collected: the game truncates its own logs under
                    // Data\Platform at every game start, so anything not taken
                    // now is gone. Until 22 September every report began by
                    // asking the person to go and find four files themselves.
                    try { Discord.SessionLogs(); } catch (Exception ex) { Swallow.Note("Shell.Wire", ex); }
                });
                // Against the character, not just the install. Skyrim keeps its
                // own play time inside the save, and under SkyMP the character
                // is a change form on the server with often no save here at all,
                // so the launcher is the only thing in a position to count.
                // The character is whoever the menu's choice file named this
                // session; 0 when it never did, and then nothing is counted.
                // Since its pick, when Change character came first (#3128).
                try { Chars.AddPlaytime(chosenId, DateTime.Now - PlayCountedFrom()); } catch (Exception ex) { Swallow.Note("Shell.Wire", ex); }
                BuildStatRow();
                btnPlay.Content = "PLAY";
                btnQuitGame.IsVisible = false;
                gameClosedAt = DateTime.Now;
                Log("Game closed after " + (int)(DateTime.Now - playStartedAt).TotalMinutes + " minutes. Your Windows Skyrim folders are back to normal.");
                {
                    // Where the crash log is, and the snapshot when the
                    // person turned snapshots on (#2626). A snapshot is shown
                    // with its size and they are asked whether to keep it,
                    // since it can be 9 GB or more.
                    // What Crash Logger was told at Play, not the box as it is
                    // now, and off the window's thread: moving a 9 GB
                    // snapshot to a folder on another drive is a copy that
                    // takes minutes.
                    bool keptAtPlay = CrashDump.AppliedAtPlay;
                    string keptIn = CrashDump.KeptIn(cfg);
                    DateTime crashSince = playStartedAt;
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        string snapshot = null, crashed = null;
                        try { crashed = CrashDump.AfterSession(crashSince, keptAtPlay, keptIn, out snapshot); }
                        catch (Exception ex) { Swallow.Note("Shell.Wire, crash snapshot", ex); }
                        try
                        {
                            Dispatcher.UIThread.Post(new Action(delegate
                            {
                                if (crashed != null) Log(crashed);
                                if (snapshot != null) AskKeepSnapshot(snapshot, keptIn);
                            }));
                        }
                        catch (Exception ex) { Swallow.Note("Shell.Wire, crash snapshot", ex); }
                    });
                }

                // The one failure that looks like everything else: a session
                // that ran the wrong Skyrim. Nothing else in here can be trusted
                // if this is wrong, so it is checked first and said plainly.
                string ranFrom = Checks.LastRunFrom();
                if (ranFrom.Length > 0 && !Checks.RanFromBuild())
                    Log("That session ran Skyrim from " + ranFrom + ", not this build, so none of the mod list was in play.");

                // Skyrim rewrites the plugin list every time it runs, and it has
                // been known to drop entries. Better to say so the moment it
                // happens than to let it turn up as a refused connect later.
                // Off the window's thread, because Run now asks the server for
                // its manifest and the server is often mid restart at exactly
                // this moment, after an update.
                ThreadPool.QueueUserWorkItem(delegate
                {
                    int broke = 0;
                    try { foreach (Issue i in Verify.Run(cfg)) if (i.Blocking) broke++; } catch (Exception ex) { Swallow.Note("Shell.Wire", ex); }
                    if (broke == 0) return;
                    try
                    {
                        Dispatcher.UIThread.Post(new Action(delegate
                        {
                            Log("Skyrim changed your plugin list on the way out, " + broke +
                                (broke == 1 ? " problem" : " problems") + ". Mods, then Fix.");
                        }));
                    }
                    catch (Exception ex) { Swallow.Note("Shell.Wire", ex); }
                });

                // Shut Play before the window comes back, not after. Nothing
                // in the in-play check sets updatePending, so the status drawn
                // here said PLAY while the pack the game was just closed for
                // was still being fetched, and a press in that gap started
                // Skyrim on half a pack. updateAnswered goes back to false so
                // the button reads CHECKING, and so Unblock can free Play again
                // if the check never reaches the source.
                if (closedForUpdate)
                {
                    updatePending = true;
                    updateAnswered = false;
                }

                DrawStatus();
                win.WindowState = WindowState.Normal;
                win.Activate();

                if (closedForUpdate)
                {
                    closedForUpdate = false;
                    // With automatic updates on, the check's answer takes it
                    // (UpdateBySelf, #3202), as it takes any update it finds.
                    Log("Fetching the update the game was closed for...");
                    ThreadPool.QueueUserWorkItem(delegate { CheckUpdatesBackground(true); });
                }
            };
            timer.Start();
        }

        /// <summary>
        /// At startup, from a pool thread: a game with no window left over from a
        /// crash is ended quietly, because there is nothing on screen to lose. A
        /// game somebody is looking at is left alone. Returns a line for the log,
        /// or null when there was nothing to do.
        /// </summary>
        static string ClearLeftovers()
        {
            if (!Checks.GameRunning() || Checks.GameVisible()) return null;
            // A game that is still starting has no window yet either. With this
            // mod list Skyrim takes the better part of a minute to put one up
            // and skse64_loader hands over well before that, so a launcher
            // opened in those seconds reads a session that is loading in as the
            // leftovers of a crashed one and kills it. Anything younger than
            // three minutes is left alone; a crash worth clearing is older than
            // that by the time somebody has opened the launcher again, and
            // Clear is there for the rest.
            if (JustStarted(180)) return null;
            int n = Checks.CloseGame();
            string still = Checks.StuckReport();
            if (still.Length > 0) return "Something Skyrim left behind would not close. " + still;
            return n > 0 ? "Closed " + n + " Skyrim process" + (n == 1 ? "" : "es") + " left over from the last session." : null;
        }

        /// <summary>
        /// True when one of the game's processes started fewer than this many
        /// seconds ago. A start time that cannot be read counts as old, the same
        /// call Checks.GameProcesses makes about a path it cannot read: a
        /// process that has already fallen over is the one that hides its own
        /// details, and those are the ones worth closing.
        /// </summary>
        static bool JustStarted(int seconds)
        {
            List<Process> ps = Checks.GameProcesses();
            bool young = false;
            foreach (Process p in ps)
            {
                DateTime started;
                try { started = p.StartTime; }
                catch { continue; }
                if ((DateTime.Now - started).TotalSeconds < seconds) { young = true; break; }
            }
            foreach (Process p in ps) { try { p.Dispose(); } catch (Exception ex) { Swallow.Note("Shell.JustStarted, dispose", ex); } }
            return young;
        }

        static void Open(string path)
        {
            try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
            catch (Exception ex) { Log("Could not open it: " + ex.Message); }
        }

        // ------------------------------------------------------------- checks
        static bool DrawStatus()
        {
            // The checklist now lives on the Diagnostics page and Play shows a
            // one line summary of it (UpdateReadySummary). See #607.
            //
            // The rows are updated in place rather than cleared and rebuilt
            // every time. Rebuilding them on every scan, recheck and update
            // check made the list flash and re-say itself even when nothing had
            // changed, which #607 asked to stop: "it shouldn't say checking
            // every time it checks, it should just update in place if numbers
            // change". Only a row whose text or colour actually differs is
            // touched now, so an unchanged pass moves nothing on screen.
            List<Check> checks = Checks.All(cfg);
            bool all = true;
            var blocking = new List<Check>();
            foreach (Check c in checks)
            {
                // An advisory row that fails is drawn amber and leaves Play
                // alone. See Check.Advisory.
                if (c.Blocks) { all = false; blocking.Add(c); }
                // What the rows now say about Steam, for the tick to compare.
                if (c.Name == Checks.SteamRow) steamShown = c.Ok;
            }

            if (statusList != null)
            {
                // Positional: Checks.All is the one thing that decides how many
                // rows there are, so a change in their number, not just their
                // values, is the only thing that rebuilds.
                if (statusList.Children.Count != checks.Count)
                {
                    statusList.Children.Clear();
                    for (int i = 0; i < checks.Count; i++) statusList.Children.Add(StatusRow());
                }
                for (int i = 0; i < checks.Count; i++)
                    FillStatusRow(statusList.Children[i] as Border, checks[i]);
            }

            UpdateReadySummary(blocking);

            // No card here. It said the same thing as the bar above Play, which
            // lives in its own grid row below the scroller, so the two stacked
            // and the bar sat on top of the card. One message, in the louder
            // of the two places.

            // Connect Discord is put back here as well as in RefreshDiscord.
            //
            // Being refused for a role greyed it out and left it that way, so
            // somebody who was given the role a minute later had no way to
            // reconnect without closing the whole launcher and opening it
            // again. DrawStatus runs on every page change, every scan and every
            // recheck, so pinning the button's state to whether a link is
            // actually in flight means it comes back on its own.
            if (buttonDiscord != null) buttonDiscord.IsEnabled = !linkingDiscord;

            // Whether the mods are on this machine is a fact about this
            // machine, so it decides this, not the timing of a web request.
            // The collection bar went up only inside the update check, which
            // meant anybody whose check had not landed yet, or who could not
            // reach the site at all, got a red "Mods  32 plugins" row on this
            // page and nothing whatsoever to press. A link to the collection
            // is the single thing somebody in that state needs.
            // Guarded, because DrawStatus has always been safe to call before
            // the update card's own controls are resolved and this is the
            // first thing in it that touches them.
            //
            // The wrong Skyrim build comes before the mods. The downgrade needs
            // nothing from the collection, and Vortex deploying onto files the
            // downgrade then copies over is the same work twice, so while the
            // exe is wrong the collection card stays down and the downgrade
            // card is the one thing on this page to press. The collection card
            // comes up by itself once the build is right. A real update still
            // outranks both, below, because an update can carry a new expected
            // build and settle the question by itself.
            //
            // Only the game Thornswood runs counts (#1218). A Steam copy that
            // moved on after Thornswood's own folder was made no longer brings
            // the card up: the folder holds 1.6.1170 itself and follows Vortex
            // whatever build the Steam copy is on.
            bool wrongBuild = Downgrade.Needed(cfg);
            // One current observation per draw, with no stale cache between draws.
            int collectionRevision = updateBar != null && btnInstallNow != null && !wrongBuild ? Checks.CollectionRevision(cfg) : 0;
            if (updateBar != null && btnInstallNow != null && ModsMissing(collectionRevision) && !wrongBuild)
            {
                ShowCollectionBar(collectionRevision);
            }
            else if (collectionBarUp && updateBar != null && btnInstallNow != null)
            {
                collectionBarUp = false;
                InstallLabel("Install now");
                updateBar.IsVisible = false;
                InstallShown(false);
            }

            // Mods that could not be confirmed (Djinn, 2 Oct). CollectionProblem
            // answers "" when it cannot read the revision Vortex installed, which
            // left no card and no way to the collection on this page at all.
            // This is a note, not a hold: Play is not shut for it, because a
            // revision that cannot be read is not proof the mods are wrong.
            if (updateBar != null && btnInstallNow != null && !collectionBarUp && !updatePending &&
                !wrongBuild && !playing && !playBar.Active)
            {
                bool unsure = CollectionUnconfirmed(collectionRevision);
                if (unsure && (collectionNoteUp || !updateBar.IsVisible))
                {
                    txtUpdateTitle.Text = "Your mods could not be confirmed";
                    txtUpdateNote.Text =
                        "The launcher could not read which revision of the Thornswood collection " +
                        "Vortex has installed. If you have not installed it, or are not sure, open " +
                        "the collection and let Vortex install or update it. Play is not held for this.";
                    InstallLabel(CollectionButtonText());
                    btnInstallNow.IsEnabled = true;
                    updateBar.IsVisible = true;
                    InstallShown(true);
                    collectionNoteUp = true;
                }
                else if (!unsure && collectionNoteUp)
                {
                    collectionNoteUp = false;
                    InstallLabel("Install now");
                    updateBar.IsVisible = false;
                    InstallShown(false);
                }
            }
            else if (collectionNoteUp)
            {
                // An update or the collection card took the bar, or the game is
                // running: the note steps aside and leaves the bar to them.
                collectionNoteUp = false;
                if (!collectionBarUp && !updatePending && updateBar != null && btnInstallNow != null)
                {
                    InstallLabel("Install now");
                    updateBar.IsVisible = false;
                    InstallShown(false);
                }
            }
            // What the card or note was just drawn from, for the tick's look at
            // Vortex (ShellVortexWatch.cs, #5136), which draws it again only
            // when Vortex's answer moves away from this.
            collectionDrawn = CollectionKey(collectionRevision, CollectionProblem(collectionRevision));

            // Wrong Skyrim build: the one thing on this page with a button that
            // fixes it. Below the update bar in priority, because an update can
            // carry a new expected build and settle the question by itself.
            if (downgradeBar != null)
            {
                bool updateUp = updateBar != null && updateBar.IsVisible;
                downgradeBar.IsVisible = wrongBuild && !updateUp && !playing;
                if (btnDowngrade != null) btnDowngrade.IsEnabled = !Downgrade.Busy && !ownGameBusy;
                if (txtDowngradeTitle != null)
                    txtDowngradeTitle.Text = Paths.Collection ? "Skyrim on Steam is not on the server's build"
                        : OwnGame.Active && OwnGame.Changed().Count > 0 ? "Some of Skyrim's own files in Thornswood's folder changed"
                        : "Skyrim is on the wrong build";
            }

            bool working = playBar.Active;
            btnPlay.IsEnabled = all && !playing && !updatePending && !collectionBarUp && !ownGameBusy && !working && feedNotice.Hold == null;
            if (!working) HidePlayFill();
            // Only worth offering while there is something to quit, and it is
            // the one control on this page that stays live during a session.
            if (btnQuitGame != null)
                btnQuitGame.IsVisible = Checks.GameRunning();

            // Missing mods outrank everything else here. The collection path
            // sets updatePending false, so the old order fell through to the
            // last branch and put PLAY back on a button that could not play:
            // the bar said install the mods and the button said go.
            // Work that reports how far it has got (#1145): the button is the
            // progress bar, and says what is going on and how much is left.
            // ShellProgress.cs paints the fill; this keeps the words when
            // anything else redraws the button in the meantime.
            if (working && !playing)
            {
                btnPlay.Content = PlayBarCaption(playBar.Text);
                ToolTip.SetTip(btnPlay, "Play comes back when this is done.");
            }
            // The game folder itself is being made or brought up to date, so
            // there is nothing complete to start yet.
            else if (ownGameBusy && !playing)
            {
                btnPlay.Content = "PREPARING THE GAME FOLDER";
                ToolTip.SetTip(btnPlay, "Thornswood's own Skyrim folder is being brought up to date from Vortex. Play comes back when it is done.");
            }
            // Ahead is the server's to fix, not the person's (#4115). It used to
            // read INSTALL THE MODS FIRST and say to open the collection, which
            // cannot help and, from the newest revision, can only lead further on.
            else if (collectionBarUp && !playing && CollectionProblem(collectionRevision) == "ahead")
            {
                btnPlay.Content = "WAITING FOR THE SERVER";
                ToolTip.SetTip(btnPlay, "The server was built against collection revision " + Updater.FeedCollectionRevision +
                                  " and this copy is on " + collectionRevision + ". Nothing needs installing. " +
                                  "Play opens once the server is rebuilt on your revision.");
            }
            else if (collectionBarUp && !playing)
            {
                btnPlay.Content = CollectionProblem(collectionRevision) == "stale" ? "UPDATE THE MODS FIRST" : "INSTALL THE MODS FIRST";
                ToolTip.SetTip(btnPlay, "Open the collection from the card above, install the revision it opens in Vortex, then come back.");
            }
            else if (updatePending && !playing)
            {
                btnPlay.Content = checkFailed ? "NO ANSWER FROM THE UPDATE SOURCE"
                                : updateAnswered ? "UPDATE FIRST" : "CHECKING...";
                ToolTip.SetTip(btnPlay, checkFailed
                    ? "The update source did not answer, so it is not known whether this build is current. Play stays shut until it answers; the check runs again every 30 seconds."
                    : updateAnswered
                    ? "There is an update waiting. Install it and Play comes back."
                    : "Checking for updates before letting anybody in. A moment.");
            }
            // The feed holds Play (entry 262). Below the three above because
            // each of those is something to do or already under way, and the
            // bar above Play says why it is held either way. Above the two
            // below because they label a button that stays live, and this one
            // is not.
            else if (feedNotice.Hold != null && !playing)
            {
                btnPlay.Content = feedNotice.Button;
                ToolTip.SetTip(btnPlay, feedNotice.Hold);
            }
            else if (wrongBuild && !playing && !collectionBarUp)
            {
                btnPlay.Content = Downgrade.Busy ? "DOWNGRADING..." : "DOWNGRADE FIRST";
                ToolTip.SetTip(btnPlay, ModsMissing()
                    ? "This Skyrim is not build 1.6.1170. The card above puts it right; the mods come after that."
                    : "This Skyrim is not build 1.6.1170. The card above puts it right.");
            }
            // A shared Skyrim is not an install this supports, so the button
            // says the thing that fixes it rather than saying PLAY and then
            // refusing. Pressing it goes to OwnGameRequired in ShellOwnGame.cs,
            // which offers the folder when it can be made and names the one
            // thing in the way when it cannot.
            //
            // Ranked BELOW the four above on purpose. Every one of them is also
            // a reason OwnGame.WhyNot gives for the folder not being makeable
            // yet: the mods have to be deployed, the build has to be right.
            // Putting this first would tell somebody to make a folder that
            // cannot be made, and hide the step that actually unblocks them.
            else if (Paths.Collection && !playing)
            {
                btnPlay.Content = "MAKE THORNSWOOD'S OWN FOLDER";
                ToolTip.SetTip(btnPlay, NoOwnFolderYet() + " This gives Thornswood a folder " +
                    "of its own. It takes a few minutes and the launcher restarts when it is done.");
            }
            else if (!playing)
            {
                ToolTip.SetTip(btnPlay, null);
                btnPlay.Content = "PLAY";
            }
            return all;
        }

        /// <summary>
        /// One empty checklist row for the Ready to launch list on Diagnostics.
        /// Built once and then filled by FillStatusRow, so the list is not torn
        /// down and rebuilt on every pass (#607). The shape is a Border holding
        /// a three column Grid: a dot, the name, and the detail.
        /// </summary>
        static Border StatusRow()
        {
            var row = new Grid();
            row.Margin = new Thickness(0, 0, 0, 1);
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var back = new Border();
            back.Background = Res("Card");
            back.BorderBrush = Res("Line");
            back.BorderThickness = new Thickness(1);
            back.Padding = new Thickness(15, 11, 15, 11);
            back.Margin = new Thickness(0, 0, 0, 7);

            var dot = new Ellipse();
            dot.Width = 7; dot.Height = 7;
            dot.Margin = new Thickness(0, 0, 12, 0);
            dot.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(dot, 0); row.Children.Add(dot);

            var t1 = new TextBlock();
            t1.FontSize = 13; t1.Foreground = Res("Ink");
            t1.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(t1, 1); row.Children.Add(t1);

            var t2 = new TextBlock();
            t2.FontSize = 11.5;
            t2.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(t2, 2); row.Children.Add(t2);

            back.Child = row;
            return back;
        }

        /// <summary>
        /// Fills one row from a check, touching only what has actually changed
        /// so an unchanged pass moves nothing on screen. Res returns the one
        /// cached brush per key, so a reference match means the colour is the
        /// same and does not need setting again.
        /// </summary>
        static void FillStatusRow(Border back, Check c)
        {
            if (back == null) return;
            var row = back.Child as Grid;
            if (row == null || row.Children.Count < 3) return;
            var dot = row.Children[0] as Ellipse;
            var t1 = row.Children[1] as TextBlock;
            var t2 = row.Children[2] as TextBlock;

            IBrush wantDot = Res(c.Ok ? "Ok" : c.Advisory ? "Warn" : "Bad");
            if (dot != null && !ReferenceEquals(dot.Fill, wantDot)) dot.Fill = wantDot;

            if (t1 != null && t1.Text != c.Name) t1.Text = c.Name;

            if (t2 != null)
            {
                if (t2.Text != c.Detail) t2.Text = c.Detail;
                IBrush wantT2 = Res(c.Ok ? "Muted" : c.Advisory ? "Warn" : "Bad");
                if (!ReferenceEquals(t2.Foreground, wantT2)) t2.Foreground = wantT2;
            }
        }

        /// <summary>
        /// The one line summary of the checklist that sits on the Play page
        /// (#607). Updated in place: it does not flash or re-say itself when the
        /// words have not changed. The button's own words say why Play is held
        /// for anything that is not a failing row (an update, a downgrade, the
        /// feed), so this stays about the checks themselves.
        ///
        /// A failing pass names the problem in a few words, the first failing
        /// row's Check.Problem in the order Diagnostics lists them, and how many
        /// more there are (#3203). It said only "Check Diagnostics", so finding
        /// out that Steam was closed meant opening another page. Hovering it
        /// lists every one; the Diagnostics button beside it still opens the
        /// rows with their details.
        /// </summary>
        static void UpdateReadySummary(List<Check> blocking)
        {
            bool all = blocking.Count == 0;
            if (dotReady != null)
            {
                IBrush want = Res(all ? "Ok" : "Bad");
                if (!ReferenceEquals(dotReady.Fill, want)) dotReady.Fill = want;
            }
            if (txtReadyTitle != null)
            {
                string title = ReadyTitle(blocking);
                if (txtReadyTitle.Text != title) txtReadyTitle.Text = title;
                string tip = blocking.Count > 1 ? ReadyList(blocking) : null;
                if (!Equals(ToolTip.GetTip(txtReadyTitle), tip)) ToolTip.SetTip(txtReadyTitle, tip);
                IBrush ink = Res(all ? "Ink" : "Bad");
                if (!ReferenceEquals(txtReadyTitle.Foreground, ink)) txtReadyTitle.Foreground = ink;
            }
            if (btnCheckDiagnostics != null)
                btnCheckDiagnostics.IsVisible = !all;
            if (btnOpenSteam != null)
            {
                // Whenever the Steam row is one of the problems, not only when
                // it is the first, so "Wrong Skyrim build and 1 more" with Steam
                // closed still has the button.
                bool steamDown = false;
                foreach (Check c in blocking) if (c.Name == Checks.SteamRow) steamDown = true;
                bool want = steamDown;
                if (btnOpenSteam.IsVisible != want) btnOpenSteam.IsVisible = want;
            }
        }

        /// <summary>
        /// What the Steam row said when the rows were last drawn. The two
        /// second tick redraws when Steam's answer differs from it.
        /// </summary>
        static bool steamShown;

        /// <summary>
        /// The Open Steam button on the Ready card, shown while Steam is not
        /// running (#3204). Opens Steam's own window through its
        /// steam://open/main link, rather than the tray start Fix makes,
        /// because whoever presses it wants Steam in front of them to sign
        /// in. The card turns green by itself once steam.exe is up (the two
        /// second tick, above).
        /// </summary>
        static void OpenSteam()
        {
            if (Downgrade.AskSteam("steam://open/main", Log))
                Log("Opening Steam. Sign in if it asks; the Ready card turns green once Steam is running.");
            else
                Log("Steam could not be opened from here. Start Steam yourself, signed in to the account that owns Skyrim.");
        }

        /// <summary>
        /// The Ready card's words: "Everything checks out", one problem as its
        /// row says it ("Steam not running"), or the first and a count
        /// ("Wrong Skyrim build and 2 more").
        /// </summary>
        static string ReadyTitle(List<Check> blocking)
        {
            if (blocking.Count == 0) return "Everything checks out";
            string first = ProblemWords(blocking[0]);
            if (blocking.Count == 1) return first;
            return first + " and " + (blocking.Count - 1) + " more";
        }

        /// <summary>Every failing row's words, one to a line, for the hover.</summary>
        static string ReadyList(List<Check> blocking)
        {
            var lines = new List<string>();
            foreach (Check c in blocking) lines.Add(ProblemWords(c));
            return string.Join("\n", lines.ToArray());
        }

        /// <summary>
        /// A row's Problem, which every row that can block sets in Checks. A
        /// row added later without one still says which row it is and what
        /// it found, rather than nothing.
        /// </summary>
        static string ProblemWords(Check c)
        {
            if (!string.IsNullOrEmpty(c.Problem)) return c.Problem;
            return c.Name + ": " + c.Detail;
        }

        /// <summary>
        /// "game 1.6.1170" in the corner and in the hero line, or what the exe
        /// actually is when it is not that. Redrawn after a downgrade.
        /// </summary>
        static void DrawBuildLine()
        {
            string build = Downgrade.Needed(cfg) ? Downgrade.Describe(cfg) : "1.6.1170";
            if (txtBuildLine != null) txtBuildLine.Text = "game " + build;
            if (txtHeroLine != null) txtHeroLine.Text = Checks.EnabledPlugins() + " plugins  ·  game " + build + "  ·  launcher " + Updater.Version;
        }

        /// <summary>
        /// The Downgrade button. Everything happens on Downgrade's own thread;
        /// its words come back here through the dispatcher, into the log and
        /// the line under the button, and the page is redrawn. The files go
        /// into Thornswood's own folder, or, before it has one, the folder is
        /// made from them. The Steam copy of Skyrim is never written (#1218).
        /// </summary>
        static void RunDowngrade()
        {
            if (Downgrade.Busy) return;
            if (ownGameBusy) { Log("Thornswood's own Skyrim folder is being prepared. Press Downgrade when that is done."); return; }
            if (Checks.GameRunning()) { Log("Close Skyrim first, then press Downgrade."); return; }
            // Asked first because the downgrade takes over Steam's window, the mouse and the keyboard, and nobody should find that happening without having said yes to it.
            bool r = Ask.YesNo(
                "Downgrade Skyrim to 1.6.1170?\n\n" +
                "Steam only hands over an older build through its own console, so the launcher works that console for you. " +
                "Steam's window comes to the front, the launcher clicks the console's command line and types these three lines into it, one at a time, each after the one before has finished downloading:\n\n" +
                string.Join("\n", Downgrade.Commands(cfg)) + "\n\n" +
                "Steam downloads about 11 GB under your own account, and the launcher then " +
                (Paths.Collection ? "makes Thornswood's own game folder from those files. " : "puts the files into Thornswood's own game folder. ") +
                "Your Steam copy of Skyrim is not changed and can stay on any build.\n\n" +
                "Do not type or click while Steam's window is in front, or the keys go to the wrong place.",
                "Thornswood", Ask.Icon.Question);
            if (!r) { Log("Left Skyrim on the build it is on."); return; }
            btnDowngrade.IsEnabled = false;
            btnDowngrade.Content = "Working...";
            // The bar under the note: a share while Steam downloads a part
            // whose size it has given, moving without a number while it has
            // not, and gone when the run ends. Downgrade.Progress in Downgrade.cs.
            Downgrade.OnProgress = delegate (int p)
            {
                try
                {
                    Dispatcher.UIThread.Post(new Action(delegate
                    {
                        if (prgDowngrade == null) return;
                        if (p == -1) { prgDowngrade.IsVisible = false; return; }
                        prgDowngrade.IsVisible = true;
                        prgDowngrade.IsIndeterminate = p < 0;
                        if (p >= 0) prgDowngrade.Value = Math.Min(100, p);
                    }));
                }
                catch (Exception ex) { Swallow.Note("RunDowngrade, the progress bar", ex); }
            };
            Downgrade.Start(cfg,
                PresenceLog,
                delegate (string s) { try { Dispatcher.UIThread.Post(new Action(delegate { txtDowngradeNote.Text = s; })); } catch (Exception ex) { Swallow.Note("Shell.RunDowngrade", ex); } },
                delegate (bool ok)
                {
                    try
                    {
                        Dispatcher.UIThread.Post(new Action(delegate
                        {
                            btnDowngrade.Content = ok ? "Done" : "Try again";
                            btnDowngrade.IsEnabled = !ok;
                            if (prgDowngrade != null) { prgDowngrade.IsIndeterminate = false; prgDowngrade.IsVisible = false; }
                            // Before Thornswood has a folder of its own the
                            // download is what the folder is made from, and
                            // the person already said yes to that above. With
                            // a folder, the files went straight into it, and
                            // there is nothing for Vortex to bring in. The
                            // Steam copy was not touched either way, so there
                            // is no question about Steam's updates to ask here.
                            if (ok && Paths.Collection && Downgrade.Downloaded(cfg) != null) StartOwnGame(true, true);
                            DrawStatus();
                            DrawBuildLine();
                        }));
                    }
                    catch (Exception ex) { Swallow.Note("Shell.RunDowngrade, own game source", ex); }
                });
        }

        /// <summary>Log from a background thread. Log itself touches the UI.</summary>
        static void SafeLog(string m)
        {
            try
            {
                if (Dispatcher.UIThread.CheckAccess()) Log(m);
                else Dispatcher.UIThread.Post(new Action(delegate { Log(m); }));
            }
            catch (Exception ex) { Swallow.Note("Shell.SafeLog", ex); }
        }

        // Explorer, with the file already picked out: the report Diagnostics
        // builds, where the thing worth reaching is the file itself.
        static void Reveal(string path)
        {
            try
            {
                var psi = new ProcessStartInfo("explorer.exe", "/select,\"" + path + "\"");
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception ex) { Log("Could not open the folder: " + ex.Message); }
        }

        // ------------------------------------------------------------- settings
        // Nine of them now, so they wrap instead of running off the side, and
        // each one says what it is rather than making you click to find out.
        // DIY is a card in the same strip as the presets; its editor panel
        // shows only while that card is selected (#601 follow-up).
        static bool diyPanelOpen;
        static bool diyPanelStateReady;

        static void SyncDiyPanelOpenFromConfig()
        {
            if (diyPanelStateReady) return;
            diyPanelStateReady = true;
            diyPanelOpen = string.Equals(cfg.Theme, Themes.CustomName, StringComparison.OrdinalIgnoreCase)
                && Themes.HasCustom(cfg.CustomColors);
        }

        static void BuildThemeRow()
        {
            SyncDiyPanelOpenFromConfig();
            themeRow.Children.Clear();

            var wrap = new WrapPanel();
            themeRow.Children.Add(wrap);

            foreach (Theme t in Themes.All)
                AddThemeButton(wrap, t);

            // DIY sits after the built-ins in the same strip. Clicking it shows
            // the make-your-own panel; clicking a preset hides that panel again.
            AddDiyButton(wrap);

            if (diyPanelOpen)
                txtThemeNote.Text = "DIY. Make your own colours below.";
            else
            {
                Theme cur = Themes.Resolve(cfg.Theme, cfg.CustomColors, cfg.CustomLight);
                txtThemeNote.Text = cur.Name + ". " + cur.Note;
            }
        }

        static void AddThemeButton(WrapPanel wrap, Theme t)
        {
            Theme captured = t;
            // A preset is not lit while the DIY card is selected, even if the
            // saved theme name still matches that preset (editing before save).
            bool on = !diyPanelOpen
                && string.Equals(t.Name, cfg.Theme, StringComparison.OrdinalIgnoreCase);

            var sw = new Border();
            sw.Width = 15; sw.Height = 15;
            sw.CornerRadius = new CornerRadius(2);
            sw.Background = new SolidColorBrush(Color.Parse(t.Swatch));
            sw.Margin = new Thickness(0, 0, 10, 0);
            sw.VerticalAlignment = VerticalAlignment.Center;

            var label = new TextBlock();
            label.Text = t.Name;
            label.VerticalAlignment = VerticalAlignment.Center;
            label.FontWeight = on ? FontWeight.SemiBold : FontWeight.Normal;

            var sp = new StackPanel();
            sp.Orientation = Orientation.Horizontal;
            sp.Children.Add(sw);
            sp.Children.Add(label);

            var b = new Button();
            b.Content = sp;
            b.Theme = Look("Ghost");
            b.Margin = new Thickness(0, 0, 9, 9);
            b.Padding = new Thickness(12, 9, 16, 9);
            b.MinWidth = 148;
            b.HorizontalContentAlignment = HorizontalAlignment.Left;
            if (on) b.Background = Res("CardHover");
            b.Click += delegate
            {
                diyPanelOpen = false;
                cfg.Theme = captured.Name;
                cfg.Save(Paths.CfgFile);
                Themes.Apply(win, Themes.Resolve(cfg.Theme, cfg.CustomColors, cfg.CustomLight));
                Redraw();
                Log("Theme set to " + captured.Name + ".");
            };
            wrap.Children.Add(b);
        }

        static void AddDiyButton(WrapPanel wrap)
        {
            bool on = diyPanelOpen;

            string swatchHex;
            if (Themes.HasCustom(cfg.CustomColors))
                swatchHex = Themes.Custom(cfg.CustomColors, cfg.CustomLight).Swatch;
            else
                // No saved DIY yet: show the DIY starter accent, not the live
                // preset, so the card does not twin Dwemer (or Forge) at a glance.
                swatchHex = Themes.Custom(null, false).Swatch;

            var sw = new Border();
            sw.Width = 15; sw.Height = 15;
            sw.CornerRadius = new CornerRadius(2);
            sw.Background = new SolidColorBrush(Color.Parse(swatchHex));
            sw.Margin = new Thickness(0, 0, 10, 0);
            sw.VerticalAlignment = VerticalAlignment.Center;

            var label = new TextBlock();
            label.Text = "DIY";
            label.VerticalAlignment = VerticalAlignment.Center;
            label.FontWeight = on ? FontWeight.SemiBold : FontWeight.Normal;

            var sp = new StackPanel();
            sp.Orientation = Orientation.Horizontal;
            sp.Children.Add(sw);
            sp.Children.Add(label);

            var b = new Button();
            b.Content = sp;
            b.Theme = Look("Ghost");
            b.Margin = new Thickness(0, 0, 9, 9);
            b.Padding = new Thickness(12, 9, 16, 9);
            b.MinWidth = 148;
            b.HorizontalContentAlignment = HorizontalAlignment.Left;
            if (on) b.Background = Res("CardHover");
            b.Click += delegate
            {
                diyPanelOpen = true;
                if (Themes.HasCustom(cfg.CustomColors))
                {
                    cfg.Theme = Themes.CustomName;
                    cfg.Save(Paths.CfgFile);
                    Themes.Apply(win, Themes.Resolve(cfg.Theme, cfg.CustomColors, cfg.CustomLight));
                    Redraw();
                    Log("Theme set to DIY.");
                }
                else
                {
                    BuildThemeRow();
                    BuildThemeEditor();
                }
            };
            wrap.Children.Add(b);
        }

        // The boxes the editor draws, kept so their text can be read back when
        // the person presses Use these colours. Rebuilt whenever the editor is.
        static readonly Dictionary<string, TextBox> themeBoxes = new Dictionary<string, TextBox>();
        static CheckBox themeLightBox;

        // The make-your-own editor under the strip. Shown only while the DIY
        // card is selected. It fills from whatever theme is on, so start from
        // a preset, open DIY, change what you want, then Use these colours.
        static void BuildThemeEditor()
        {
            if (themeEditor == null) return;
            themeEditor.Children.Clear();
            themeBoxes.Clear();

            if (!diyPanelOpen)
            {
                themeEditor.IsVisible = false;
                return;
            }
            themeEditor.IsVisible = true;

            Theme cur = Themes.Resolve(cfg.Theme, cfg.CustomColors, cfg.CustomLight);

            var head = new TextBlock();
            head.Text = "Make your own";
            head.FontFamily = new FontFamily("Constantia, Georgia");
            head.FontSize = 13;
            head.Foreground = Res("Faint");
            head.Margin = new Thickness(0, 2, 0, 8);
            themeEditor.Children.Add(head);

            var blurb = new TextBlock();
            blurb.Text = "Start from the colours on screen, change any to a hex value like #C8763A, "
                       + "then press Use these colours. The two soft ones put the opacity first, so "
                       + "#3CC8763A is that accent at low opacity. Pick a preset above to leave DIY.";
            blurb.FontSize = 11.5; blurb.Foreground = Res("Faint");
            blurb.TextWrapping = TextWrapping.Wrap; blurb.LineHeight = 17;
            blurb.Margin = new Thickness(0, 0, 0, 12);
            themeEditor.Children.Add(blurb);

            var grid = new WrapPanel();
            foreach (string name in Themes.Names)
            {
                string val;
                cur.Colors.TryGetValue(name, out val);

                var col = new StackPanel();
                col.Width = 152;
                col.Margin = new Thickness(0, 0, 14, 12);

                var l = new TextBlock();
                l.Text = name;
                l.FontSize = 11.5; l.Foreground = Res("Muted");
                l.Margin = new Thickness(2, 0, 0, 4);
                col.Children.Add(l);

                var box = new TextBox();
                box.Text = val == null ? "" : val;
                box.Theme = Look("Field");
                box.FontFamily = new FontFamily("Cascadia Mono, Consolas");
                col.Children.Add(box);

                themeBoxes[name] = box;
                grid.Children.Add(col);
            }
            themeEditor.Children.Add(grid);

            // Text these colours would make hard to read, said under the boxes
            // while it is so (#2771). The colours on screen are the ones
            // measured, so it updates on Use these colours.
            List<string> low = Themes.LowContrast(cur);
            if (low.Count > 0)
            {
                var warn = new TextBlock();
                warn.Text = "Some text would be hard to read with these colours: " + string.Join(", ", low.ToArray())
                          + ". Text needs at least 4.5 to 1 against what it sits on, so people with low vision can read it. "
                          + "Make that text lighter or the surface darker, the other way round for a light theme.";
                warn.FontSize = 11.5; warn.Foreground = Res("Ink");
                warn.TextWrapping = TextWrapping.Wrap; warn.LineHeight = 17;

                var bar = new Border();
                bar.BorderBrush = Res("Warn");
                bar.BorderThickness = new Thickness(3, 0, 0, 0);
                bar.Padding = new Thickness(10, 4, 0, 4);
                bar.Margin = new Thickness(2, 0, 14, 14);
                bar.Child = warn;
                themeEditor.Children.Add(bar);
            }

            themeLightBox = new CheckBox();
            themeLightBox.Content = "This is a light theme, so the launcher shades its own graphics for a light background";
            themeLightBox.IsChecked = cur.Light;
            themeLightBox.Margin = new Thickness(2, 2, 0, 14);
            themeEditor.Children.Add(themeLightBox);

            var apply = new Button();
            apply.Content = "Use these colours";
            apply.Theme = Look("Solid");
            apply.HorizontalAlignment = HorizontalAlignment.Left;
            apply.Click += delegate { ApplyCustomTheme(); };
            themeEditor.Children.Add(apply);
        }

        static void ApplyCustomTheme()
        {
            var pairs = new List<string>();
            foreach (string name in Themes.Names)
            {
                TextBox box;
                if (!themeBoxes.TryGetValue(name, out box)) continue;
                string hex = (box.Text == null ? "" : box.Text).Trim();

                bool good = false;
                try { Color.Parse(hex); good = true; }
                catch (Exception ex) { Swallow.Note("ApplyCustomTheme, reading " + name, ex); }
                if (!good)
                {
                    Log("The colour for " + name + " is not a hex value. Use something like #C8763A. Nothing changed.");
                    return;
                }
                pairs.Add(name);
                pairs.Add(hex);
            }

            cfg.CustomColors = pairs.ToArray();
            cfg.CustomLight = themeLightBox != null && themeLightBox.IsChecked == true;
            cfg.Theme = Themes.CustomName;
            diyPanelOpen = true;
            cfg.Save(Paths.CfgFile);
            Themes.Apply(win, Themes.Resolve(cfg.Theme, cfg.CustomColors, cfg.CustomLight));
            Redraw();
            Log("Your own theme is on. Change the colours any time, or pick a preset to leave DIY.");
            List<string> low = Themes.LowContrast(Themes.Resolve(cfg.Theme, cfg.CustomColors, cfg.CustomLight));
            if (low.Count > 0)
                Log("Some text is hard to read with these colours (" + string.Join(", ", low.ToArray())
                    + "). The colour editor says what to change.");
        }

        // Everything that paints itself from the theme brushes rather than
        // binding to them. Called after a theme change, and nowhere else.
        static void Redraw()
        {
            BuildThemeRow(); BuildThemeEditor(); DrawStatus(); BuildPathRows();
            BuildStatRow(); BuildNews(); BuildDisplay();
            BuildDiag(); RefreshDiscord();
        }

        static void BuildPathRows()
        {
            pathRows.Children.Clear();
            AddPathRow("Install", Paths.Root);
            AddPathRow("Game", Paths.Game);
            // No Saves row. Characters live on the server, and listing
            // Profile\MyGames\Saves told people their character was in a
            // folder it is not (#984, the same reason the Saves page is
            // hidden, #599).
            AddPathRow("Settings", Paths.LiveMyGames);
            DrawInGameBrowser();
        }

        static void AddPathRow(string label, string value)
        {
            var g = new Grid();
            g.Margin = new Thickness(0, 0, 0, 7);
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(78) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var l = new TextBlock();
            l.Text = label; l.FontSize = 12; l.Foreground = Res("Faint");
            Grid.SetColumn(l, 0); g.Children.Add(l);

            var v = new TextBlock();
            v.Text = value; v.FontSize = 11.5; v.FontFamily = new FontFamily("Cascadia Mono, Consolas");
            v.Foreground = Res("Muted"); v.TextTrimming = TextTrimming.CharacterEllipsis;
            Grid.SetColumn(v, 1); g.Children.Add(v);

            pathRows.Children.Add(g);
        }

        // ------------------------------------------------------------- stat strip
        static void BuildStatRow()
        {
            statRow.Children.Clear();
            AddStat("Played", Stats.PlayedText);
            AddStat("Sessions", Stats.Sessions.ToString());
            AddStat("Last played", Stats.LastPlayedText);
            BuildSideCard();
        }

        // The first-time note is read once and then becomes wallpaper, so once
        // this machine has played the side column hands itself over to the In
        // game card of keys, which is still worth a glance. #3146 took the card
        // off with the launcher's help pages, which Patrick had not asked for,
        // and it came back on 30 Oct.
        static void BuildSideCard()
        {
            bool played = Stats.Sessions > 0 || File.Exists(Paths.PlayedFile);
            firstRunCard.IsVisible = !played;
            quickKeysCard.IsVisible = played;
            if (!played) return;

            quickKeys.Children.Clear();

            // Read out of Thornswood.ini rather than typed here, so a row
            // appears only if its binding is really there, and it shows the
            // key it is really bound to. The five that matter first for
            // somebody joining the server: the emote wheel, and the four keys
            // that only make sense here, trade, party, friend and journal.
            // Settings in the game shows the rest and changes every one
            // (#3126); the launcher only reads them.
            List<Keys.Binding> keys;
            try { keys = Keys.All(); }
            catch (Exception ex) { Swallow.Note("Shell.BuildSideCard, reading the keys", ex); keys = new List<Keys.Binding>(); }

            AddKeyFor(keys, "emotewheel", "The emote wheel of gestures and animations, seen by everyone near you.");
            AddKeyFor(keys, "tradewith",  "Offer a trade to whoever you are looking at.");
            AddKeyFor(keys, "party",      "Your friends, who is online, and your party.");
            AddKeyFor(keys, "friendkey",  "Add or remove the friend you are looking at.");
            AddKeyFor(keys, "journal",    "Your journals, their pages, and sharing them.");
        }

        static void AddKeyFor(List<Keys.Binding> all, string id, string what)
        {
            foreach (Keys.Binding b in all)
            {
                if (!string.Equals(b.Id, id, StringComparison.Ordinal)) continue;
                if (string.IsNullOrEmpty(b.Value)) return;
                AddKey(b.Value, what);
                return;
            }
        }

        static void AddKey(string key, string what)
        {
            var g = new Grid();
            g.Margin = new Thickness(0, 0, 0, 9);
            // Auto rather than a fixed 58, with a minimum so the short ones
            // still line up. A fixed width was fine until a key was called
            // "Middle mouse", which then ran straight into its own description.
            var c0 = new ColumnDefinition(); c0.Width = GridLength.Auto;
            var c1 = new ColumnDefinition(); c1.Width = new GridLength(1, GridUnitType.Star);
            g.ColumnDefinitions.Add(c0);
            g.ColumnDefinitions.Add(c1);

            var k = new TextBlock();
            k.Text = key; k.FontSize = 11.5; k.FontWeight = FontWeight.SemiBold;
            k.FontFamily = new FontFamily("Cascadia Mono, Consolas");
            k.Foreground = Res("Accent");
            k.MinWidth = 52;
            k.Margin = new Thickness(0, 0, 14, 0);
            k.VerticalAlignment = VerticalAlignment.Top;
            Grid.SetColumn(k, 0);
            g.Children.Add(k);

            var v = new TextBlock();
            v.Text = what; v.FontSize = 12; v.Foreground = Res("Muted");
            v.TextWrapping = TextWrapping.Wrap; v.LineHeight = 17;
            Grid.SetColumn(v, 1);
            g.Children.Add(v);

            quickKeys.Children.Add(g);
        }

        static void AddStat(string label, string value)
        {
            var sp = new StackPanel();
            sp.HorizontalAlignment = HorizontalAlignment.Center;
            sp.VerticalAlignment = VerticalAlignment.Center;

            var l = new TextBlock();
            l.Text = label; l.FontSize = 11.5;
            l.FontFamily = new FontFamily("Constantia, Georgia");
            // Ink a little dimmed, not Faint: over the banner art Faint could not be read (#596).
            l.Foreground = Res("Ink"); l.Opacity = 0.78;
            sp.Children.Add(l);

            var v = new TextBlock();
            v.Text = value; v.FontSize = 16; v.Foreground = Res("Ink");
            v.FontFamily = new FontFamily("Constantia, Georgia");
            v.Margin = new Thickness(0, 3, 0, 0);
            sp.Children.Add(v);

            statRow.Children.Add(sp);
        }

        // ------------------------------------------------------------- display
        /// <summary>
        /// Matches the game to this screen, once, on a machine that has never
        /// played it.
        ///
        /// The build ships with whatever resolution it was packaged on, which
        /// is one particular ultrawide, and on anyone else's monitor that is
        /// the wrong shape. Setting it on the first run gets everybody a
        /// correct picture without ever touching it again, so a choice made in
        /// Settings afterwards is the last word.
        /// </summary>
        static void AutoDisplayOnce()
        {
            if (cfg.DisplaySet) return;

            // Written before anything else is attempted, so a failure below
            // cannot turn this into something that runs on every start.
            cfg.DisplaySet = true;
            try { cfg.Save(Paths.CfgFile); } catch (Exception ex) { Swallow.Note("Shell.AutoDisplayOnce, cfg save", ex); }

            // Somebody who has already played has settings of their own by now,
            // whether they chose them or not, and this is not the moment to
            // start moving them around.
            if (File.Exists(Paths.PlayedFile) || Stats.Sessions > 0) return;
            if (!Display.Available) return;

            Display.ScreenMode m = Display.Detect();
            if (m == null) return;

            string want = m.ToString();
            if (string.Equals(Display.Get("Resolution"), want, StringComparison.OrdinalIgnoreCase)) return;
            if (!Display.Set("Resolution", want)) return;

            BuildDisplay();
            Log("Display set to " + want + " to match your screen"
                + (m.Hz > 0 ? ", " + m.Hz + " Hz" : "")
                + ". Change it in Settings if you want something else.");
        }

        static void BuildDisplay()
        {
            displayModeRow.Children.Clear();

            // The field of view is not here: it is set in the game, on
            // Settings, where it can be seen while it changes (#3126).
            if (!Display.Available)
            {
                txtDisplayNote.Text = "SSE Display Tweaks is not in this build, so none of this can be set here. The field of view is on Settings in the game.";
                boxResolution.IsEnabled = false; boxFrameLimit.IsEnabled = false;
                chkVSync.IsEnabled = false; btnSaveDisplay.IsEnabled = false;
                return;
            }

            string current = Display.Mode;
            foreach (string mode in new string[] { "Borderless", "Fullscreen", "Windowed" })
            {
                string captured = mode;
                var b = new Button();
                b.Content = mode;
                b.Theme = Look("Ghost");
                b.Margin = new Thickness(0, 0, 8, 0);
                if (mode == current) b.Background = Res("CardHover");
                b.Click += delegate
                {
                    Display.SetMode(captured);
                    BuildDisplay();
                    Log("Display mode set to " + captured.ToLowerInvariant() + ". It applies next time the game starts.");
                };
                displayModeRow.Children.Add(b);
            }

            string res = Display.Get("Resolution");
            Display.ScreenMode screen = Display.Detect();

            // Blank is auto detect, so the box stays blank. Filling it with the
            // screen we found would look helpful and would be a value somebody
            // could then lock by accident.
            //
            // What was wrong was the wording. A blank box under a line opening
            // "Resolution as 1920x1080" reads as a field that failed to load,
            // and the old note said blank "leaves it to the game", which is not
            // what happens: unless Lock resolution is ticked, pressing Play
            // sets the game to whatever the screen is running at. Lock is what
            // pins a resolution, not typing one.
            boxResolution.Text = res == null ? "" : res;

            string scr = screen == null ? null
                       : screen + (screen.Hz > 0 ? " at " + screen.Hz + " Hz" : "");
            string note;

            if (cfg.LockResolution)
            {
                note = string.IsNullOrEmpty(res)
                     ? "Locked, but nothing is set, so the game keeps whatever it had. Type a resolution like 1920x1080."
                     : "Locked to " + res + ", and it stays there whatever screen you are on.";
                if (scr != null && !string.IsNullOrEmpty(res) &&
                    !string.Equals(res, screen.ToString(), StringComparison.OrdinalIgnoreCase))
                    note += "  This screen is " + scr + ", which is fine if you meant it.";
            }
            else
            {
                note = "This follows your screen. Pressing Play sets the game to whatever it is "
                     + "running at, so moving to another monitor sorts itself out.";
                if (scr != null) note += "  Right now that is " + scr + ".";
                note += "  Tick Lock resolution below to keep one of your own instead.";
            }
            note += "  Frame limit is in frames per second.";
            txtDisplayNote.Text = note;
            boxFrameLimit.Text = Display.GetInt("FramerateLimit", 0).ToString();
            chkVSync.IsChecked = Display.GetBool("EnableVSync", true);
            chkLockRes.IsChecked = cfg.LockResolution;
        }

        /// <summary>The folder crash snapshots go in, under the setting (#2626).</summary>
        static void DrawCrashFolder()
        {
            if (txtCrashFolder == null) return;
            string chosen = (cfg.CrashSnapshotFolder ?? "").Trim();
            txtCrashFolder.Text = chosen.Length > 0
                ? "Saved in " + chosen + "."
                : "Saved beside the crash logs, in " + CrashDump.Folder + ", until you choose a folder.";
        }

        /// <summary>Where crash snapshots go: a folder the person chooses (#2626).</summary>
        static async void PickCrashFolder()
        {
            // Windows' own folder picker, which can also make a new folder.
            var ask = new FolderPickerOpenOptions();
            ask.Title = "Choose the folder crash snapshots are saved in. One can be 9 GB or more, so pick a drive with room.";
            ask.AllowMultiple = false;
            try
            {
                string start = CrashDump.KeptIn(cfg);
                if (start.Length > 0 && Directory.Exists(start))
                    ask.SuggestedStartLocation = await win.StorageProvider.TryGetFolderFromPathAsync(start);
            }
            catch (Exception ex) { Swallow.Note("Shell.PickCrashFolder, where the picker opens (it opens at its own default instead)", ex); }
            IReadOnlyList<IStorageFolder> picked;
            try { picked = await win.StorageProvider.OpenFolderPickerAsync(ask); }
            catch (Exception ex) { Swallow.Note("Shell.PickCrashFolder", ex); return; }
            if (picked == null || picked.Count == 0) return;
            string chosen = picked[0].TryGetLocalPath();
            if (string.IsNullOrEmpty(chosen)) return;
            cfg.CrashSnapshotFolder = chosen;
            try { cfg.Save(Paths.CfgFile); } catch (Exception ex) { Swallow.Note("Shell.PickCrashFolder, cfg save", ex); }
            Log("Crash snapshots will be saved in " + chosen + ".");
            DrawCrashFolder();
        }

        /// <summary>
        /// After a crash that saved a snapshot (#2626): says where it is and
        /// how big, and asks whether to keep it. No deletes it now.
        /// </summary>
        static void AskKeepSnapshot(string snapshot, string keptIn)
        {
            long size = 0;
            try { size = new FileInfo(snapshot).Length; } catch (Exception ex) { Swallow.Note("Shell.AskKeepSnapshot, size", ex); }
            // Owned by the launcher's window, so it opens in front of it.
            bool r = Ask.YesNo(
                "The game crashed, and a full crash snapshot was saved:\n\n" + snapshot + "\n" + CrashDump.Size(size) +
                "\n\nIt is only needed if somebody is going to look into this crash. Keep it?\n\n" +
                "Yes keeps it until staff mark this crash looked at on the sessions page; the launcher deletes it at a Play after that. " +
                "Two are kept at most, so a third crash replaces the oldest. No deletes it now.",
                "Thornswood", Ask.Icon.Question);
            if (r)
            {
                // Only now are older ones tidied, so a No below never leaves
                // somebody with fewer than they had. This one is the newest,
                // and nobody has looked at it yet (#2319).
                int looked;
                int gone = CrashDump.Tidy(keptIn, out looked);
                string tidied = CrashDump.TidyLine(gone, looked);
                Log("Kept the crash snapshot " + snapshot + " until staff have looked at this crash." +
                    (tidied != null ? " " + tidied : ""));
                return;
            }
            try
            {
                File.Delete(snapshot);
                Log("Deleted the crash snapshot " + snapshot + ", " + CrashDump.Size(size) + " freed.");
            }
            catch (Exception ex)
            {
                Log("Could not delete the crash snapshot " + snapshot + ": " + ex.Message);
            }
        }

        static void SaveDisplay()
        {
            if (!Display.Available)
            {
                BuildDisplay();
                return;
            }

            string res = boxResolution.Text.Trim();
            if (res.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(res, @"^\d{3,5}x\d{3,5}$"))
            {
                Log("Resolution has to look like 1920x1080, or be left blank.");
                return;
            }
            if (res.Length > 0) Display.Set("Resolution", res);

            int fps;
            if (int.TryParse(boxFrameLimit.Text.Trim(), out fps) && fps > 0)
            {
                Display.Set("FramerateLimit", fps.ToString());
                Display.Set("MaximumRefreshRate", fps.ToString());
            }
            Display.Set("EnableVSync", chkVSync.IsChecked == true ? "true" : "false");
            BuildDisplay();
            Log("Display settings written. They apply next time the game starts.");
        }

        // ------------------------------------------------------------- ping
        /// <summary>
        /// Is the server there, and how far away is it.
        ///
        /// These are two different questions and this used to answer only the
        /// first one, badly. It pinged, and reported the server down whenever
        /// the ping got no reply. ICMP echo is the first thing a host drops
        /// under load or on principle, so the page sat there saying "no answer"
        /// about a server that was up and serving, with a chart of green bars
        /// directly underneath contradicting it.
        ///
        /// What actually settles it is a TCP connect to the resources port. The
        /// game traffic itself is UDP with nothing to connect to, but the server
        /// serves its resources folder over TCP on 3000 and that is only open
        /// when the server is running. So: TCP decides whether it is up, and
        /// the ping is just the nicer latency number when it comes back.
        /// </summary>
        static void StartPing()
        {
            // Only the first check says "checking". After that the last answer
            // stays up and changes in place when the new one lands (#596).
            if (string.IsNullOrEmpty(txtPing.Text) || txtPing.Text == "no address")
            {
                txtPing.Text = "checking";
                dotServer.Fill = Res("Faint");
            }

            string host = cfg.ServerAddress;
            if (string.IsNullOrEmpty(host)) { txtPing.Text = "no address"; return; }

            // Main resources are on 3000; Dev on 7788 (same pair Online.AskOther uses).
            int mainPort = 3000;
            int devPort = 7788;
            int minePort = SkyMp.ResourcePortFor(cfg);

            ThreadPool.QueueUserWorkItem(delegate
            {
                long icmp = -1;
                try
                {
                    using (var ping = new Ping())
                    {
                        PingReply r = ping.Send(host, 2000);
                        if (r != null && r.Status == IPStatus.Success) icmp = r.RoundtripTime;
                    }
                }
                catch (Exception ex) { Swallow.Note("Shell.StartPing", ex); }

                long tcpMain = TcpMs(host, mainPort);
                long tcpDev = TcpMs(host, devPort);
                long tcpMine = TcpMs(host, minePort);

                bool up = tcpMine >= 0 || icmp >= 0;
                long ms = icmp >= 0 ? icmp : tcpMine;
                bool serving = tcpMine >= 0;

                // Prefer ICMP for latency when that port answers; "no reply" when TCP missed.
                string mainNow = tcpMain < 0 ? "no reply" : (icmp >= 0 ? icmp + " ms" : tcpMain + " ms");
                string devNow = tcpDev < 0 ? "no reply" : (icmp >= 0 ? icmp + " ms" : tcpDev + " ms");
                string mainKey = tcpMain >= 0 ? "Ok" : "Warn";
                string devKey = tcpDev >= 0 ? "Ok" : "Warn";

                Dispatcher.UIThread.Post(new Action(delegate
                {
                    string now = up ? ms + " ms" : "no reply";
                    pingMsText = now;
                    pingMainText = mainNow;
                    pingDevText = devNow;
                    dotMainKey = mainKey;
                    dotDevKey = devKey;
                    // Keep who is on until the next count comes back, so the line
                    // does not shrink and grow again every refresh.
                    string was = txtPing.Text ?? "";
                    int dot = was.IndexOf("   \u00b7   ");
                    string tail = dot >= 0 ? was.Substring(dot) : "";
                    string want = now + tail;
                    if (txtPing.Text != want) txtPing.Text = want;
                    dotServer.Fill = Res(up ? (serving ? "Ok" : "Warn") : "Warn");
                    RecordPing(up ? ms : -1, serving);
                    PaintServerChip();
                    AskOnline();
                }));
            });
        }

        /// <summary>TCP connect time to a resources port, or -1 when it does not answer.</summary>
        static long TcpMs(string host, int port)
        {
            if (string.IsNullOrEmpty(host) || port <= 0) return -1;
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                using (var c = new System.Net.Sockets.TcpClient())
                {
                    IAsyncResult ar = c.BeginConnect(host, port, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(2000) && c.Connected)
                    {
                        c.EndConnect(ar);
                        return sw.ElapsedMilliseconds;
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Shell.TcpMs", ex); }
            return -1;
        }
        // ------------------------------------------------------------- play
        /// <summary>
        /// Whether the voice service on the server answers, for its reading on
        /// Diagnostics.
        ///
        /// The microphone and the audio run in this launcher, in Voice.cs;
        /// this only asks whether the server's half answers, which is worth
        /// showing because it is the one part nothing on this PC can put
        /// right. It was a card on the Server page
        /// until that page was cut (#3146). The page had been off the rail
        /// since #599, so for weeks the answer went into a TextBlock nobody
        /// could see, under a comment that still said voice ran in the game.
        /// </summary>
        static bool? voiceUp;

        static void CheckVoice()
        {
            Config c = cfg;
            // The probe waits on a socket, so it does not run on the thread
            // that draws. A page that freezes for most of a second every time
            // it is opened is worse than one that fills in a moment later.
            ThreadPool.QueueUserWorkItem(delegate
            {
                // Asked at the address voice really uses, not by knocking on the
                // raw port. Since 1.1.49 the service sits behind the site's
                // certificate and listens only on the VPS's own loopback, so the
                // raw port no longer answers from outside, and the knock said
                // nobody would hear anybody while voice was working. VoiceBase is
                // the feed's voiceUrl, or host and port on a config that has
                // none, which asks the same place the knock did.
                string where = c.VoiceBase();
                bool up = false;
                try
                {
                    using (var ask = new HttpRequestMessage(HttpMethod.Get, where + "/health"))
                    using (HttpResponseMessage resp = Http.Send(ask, 4000))
                        up = resp.StatusCode == HttpStatusCode.OK;
                }
                catch (Exception ex) { Swallow.Note("Shell.CheckVoice", ex); }

                bool fUp = up;
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    voiceUp = fUp;
                    if (pages != null && pages[PageDiag].IsVisible) DrawReadings();
                }));
            });
        }

        /// <summary>
        /// The compact Server control on Play: the closed label is the server
        /// this build is on, and the dropdown lists Main and Dev. Picking the
        /// other one opens or installs that build; picking the current one
        /// just closes the list. More servers later are more rows (#605).
        /// </summary>
        static void DrawServerPick()
        {
            if (btnServerMain == null || btnServerDev == null || txtServerPick == null) return;
            // Do not assign Content: the XAML holds the status chip layout.
            // Open panel lists both Main and Dev at the chip width; current stays enabled
            // so the covered-chip popup is one complete panel, not a second orphan card.
            if (cfg.IsDev) txtServerPick.Text = "Dev";
            else txtServerPick.Text = "Main";
            btnServerMain.IsVisible = true;
            btnServerDev.IsVisible = true;
            btnServerMain.IsEnabled = true;
            btnServerDev.IsEnabled = true;
            // The open panel covers the chip, so its first row is where the chip
            // was: that row is the server this install is on, the other below.
            // Until 11 Oct the rows kept the XAML order, Main then Dev, and a dev
            // install opened onto Main (Patrick: "it doesnt have the current
            // server you are on as the one on top").
            var rows = btnServerMain.Parent as Panel;
            if (rows != null && rows == btnServerDev.Parent)
            {
                Button first = cfg.IsDev ? btnServerDev : btnServerMain;
                Button second = cfg.IsDev ? btnServerMain : btnServerDev;
                if (rows.Children.IndexOf(first) != 0)
                {
                    rows.Children.Remove(first);
                    rows.Children.Insert(0, first);
                }
                first.Margin = new Thickness(0, 0, 0, 2);
                second.Margin = new Thickness(0);
            }
            PaintServerChip();
        }

        /// <summary>
        /// Status chip on the server button: dot, name, ms, "N of M awake".
        /// Dropdown rows are exactly Main and Dev; each shows its own dot + ms + awake.
        /// </summary>
        static void PaintServerChip()
        {
            string meta = "";
            if (!string.IsNullOrEmpty(pingMsText)) meta = pingMsText;
            if (!string.IsNullOrEmpty(awakeMineText))
                meta = meta.Length == 0 ? awakeMineText : meta + "   \u00b7   " + awakeMineText;
            if (txtServerPickMeta != null && txtServerPickMeta.Text != meta) txtServerPickMeta.Text = meta;

            string mainMeta = "";
            if (!string.IsNullOrEmpty(pingMainText)) mainMeta = pingMainText;
            if (!string.IsNullOrEmpty(awakeMainText))
                mainMeta = mainMeta.Length == 0 ? awakeMainText : mainMeta + "   \u00b7   " + awakeMainText;
            string devMeta = "";
            if (!string.IsNullOrEmpty(pingDevText)) devMeta = pingDevText;
            if (!string.IsNullOrEmpty(awakeDevText))
                devMeta = devMeta.Length == 0 ? awakeDevText : devMeta + "   \u00b7   " + awakeDevText;
            if (txtServerMainMeta != null && txtServerMainMeta.Text != mainMeta) txtServerMainMeta.Text = mainMeta;
            if (txtServerDevMeta != null && txtServerDevMeta.Text != devMeta) txtServerDevMeta.Text = devMeta;

            if (dotServerMain != null) dotServerMain.Fill = Res(dotMainKey);
            if (dotServerDev != null) dotServerDev.Fill = Res(dotDevKey);
            if (dotServerPick != null && dotServer != null)
                dotServerPick.Fill = dotServer.Fill;
        }

        static void ToggleServerPick()
        {
            if (serverPickPopup == null || btnServerPick == null) return;
            if (!serverPickPopup.IsOpen)
            {
                // Exact chip width; cover the chip so open state is one left-aligned
                // panel (Placement Bottom + VerticalOffset = -height), not a second card.
                btnServerPick.UpdateLayout();
                double w = btnServerPick.Bounds.Width;
                double h = btnServerPick.Bounds.Height;
                if (w < 1) w = btnServerPick.MinWidth > 0 ? btnServerPick.MinWidth : 210;
                if (h < 1) h = 32;
                if (serverPickPanel != null)
                {
                    serverPickPanel.Width = w;
                    serverPickPanel.MinWidth = w;
                    serverPickPanel.MaxWidth = w;
                }
                serverPickPopup.HorizontalOffset = 0;
                serverPickPopup.VerticalOffset = -h;
                serverPickPopup.IsOpen = true;
            }
            else serverPickPopup.IsOpen = false;
        }

        static void CloseServerPick()
        {
            if (serverPickPopup != null) serverPickPopup.IsOpen = false;
        }

        static void SwitchToDev()
        {
            if (cfg.IsDev) return;

            if (DevBuild.Installed)
            {
                try
                {
                    Process.Start(new ProcessStartInfo(DevBuild.Exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(DevBuild.Exe) });
                    Log("Opened the dev build.");
                }
                catch (Exception ex) { Log("Could not open the dev build: " + ex.Message); }
                return;
            }

            // The role check is the site asking Discord about this account, so
            // there has to be an account to ask about first.
            if (!Discord.Linked)
            {
                Ask.Tell(
                    "Connect Discord in the sidebar first. The launcher checks your Discord roles before it installs the dev build.",
                    "Thornswood", Ask.Icon.Info);
                return;
            }

            Log("Checking whether your Discord roles allow the dev build...");
            if (btnServerDev != null) btnServerDev.IsEnabled = false;
            ThreadPool.QueueUserWorkItem(delegate
            {
                Standing st;
                try { st = Discord.Join(); }
                catch (Exception ex)
                {
                    st = new Standing();
                    st.Ok = false;
                    st.Why = "offline";
                    st.Message = "Could not reach thornswood.net: " + ex.Message;
                }

                Dispatcher.UIThread.Post(new Action(delegate
                {
                    try
                    {
                        // Discord.Join has already written dev-allowed.txt when the
                        // answer carried the flag, so DrawServerPick in the finally
                        // reflects the fresh answer either way.
                        if (st.Why == "offline" || st.Why == "could not ask Discord")
                        {
                            Ask.Tell(
                                "Could not reach thornswood.net to check your roles just now. Try again in a minute.",
                                "Thornswood", Ask.Icon.Warning);
                            return;
                        }
                        if (st.Why == "link")
                        {
                            Ask.Tell(
                                "Connect Discord in the sidebar first, then try again.",
                                "Thornswood", Ask.Icon.Info);
                            return;
                        }
                        if (!st.Dev)
                        {
                            Ask.Tell(
                                "The dev build is for the staff roles: Owner, Dev, Gamemaster, Moderator and Loremaster. Your account does not have one; ask Patrick if you need it.",
                                "Thornswood", Ask.Icon.Warning);
                            return;
                        }

                        bool r = Ask.YesNo(
                            "Your roles allow the dev build. Install it?\n\nIt copies this launcher into " + DevBuild.Root +
                            " and opens it. It follows the dev branch and joins the dev server; this build is not touched.",
                            "Thornswood", Ask.Icon.Question);
                        if (!r) return;
                        try { Log(DevBuild.Install(cfg)); }
                        catch (Exception ex) { Log("Could not install the dev build: " + ex.Message); }
                    }
                    finally
                    {
                        if (btnServerDev != null) btnServerDev.IsEnabled = true;
                        DrawServerPick();
                    }
                }));
            });
        }

        /// <summary>
        /// Switch back to the main server from the dev build: open the main
        /// launcher beside this one. Never installs or touches the main build,
        /// only opens what is already there.
        /// </summary>
        static void SwitchToMain()
        {
            if (!cfg.IsDev) return;
            if (DevBuild.MainInstalled)
            {
                try
                {
                    Process.Start(new ProcessStartInfo(DevBuild.MainExe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(DevBuild.MainExe) });
                    Log("Opened the main build.");
                }
                catch (Exception ex) { Log("Could not open the main build: " + ex.Message); }
            }
            else
            {
                Ask.Tell(
                    "The main build is not at " + DevBuild.MainRoot + ". Install it again from thornswood.net.",
                    "Thornswood", Ask.Icon.Warning);
            }
        }

        static void DoUninstall()
        {
            string why = Uninstall.WhyNot();
            if (why != null)
            {
                Ask.Tell(why, "Thornswood", Ask.Icon.Warning);
                return;
            }

            bool keep = chkKeepSaves.IsChecked == true;
            // Ticked by default, which is what this always did. Unticking it is
            // the new part: the mods stay and a reinstall reuses them.
            bool dropMods = chkDeleteMods == null || chkDeleteMods.IsChecked == true;

            var goes = new StringBuilder();
            var stays = new StringBuilder();

            if (Paths.Collection)
            {
                // Paths.Game is the Skyrim they own on Steam here. Measuring
                // that and calling it "the mods" told somebody at the uninstall
                // screen that thirty gigabytes of their own game was about to
                // go. It never was: Begin refuses to delete it whatever the box
                // says. But the dialog said it, which is the worst possible
                // sentence to read at that exact moment.
                long ourBytes = 0; int ourCount = 0;
                try { Uninstall.OurGameFiles(cfg, out ourBytes, out ourCount); }
                catch { ourBytes = 0; ourCount = 0; }
                string ours = ourCount > 0
                    ? ourCount.ToString("n0") + " files, " +
                      (ourBytes / 1024.0 / 1024.0).ToString("0") + " MB"
                    : "nothing on record";

                if (dropMods) goes.AppendLine("    Thornswood's own files inside your Skyrim   (" + ours + ")");
                else          stays.AppendLine("    Thornswood's own files inside your Skyrim   (" + ours + ")");
                stays.AppendLine("    Your Skyrim on Steam. None of it is touched");
                stays.AppendLine("    The collection's mods. Purge Mods in Vortex is what removes those");
            }
            else if (OwnGame.Active)
            {
                // Made of links to Vortex's copies, so deleting it frees the
                // copied part and not the collection; the collection's files
                // stay Vortex's under their other names.
                if (dropMods) goes.AppendLine("    " + Paths.Game + "   (Thornswood's own game folder; the linked mods stay Vortex's)");
                else          stays.AppendLine("    " + Paths.Game + "   (Thornswood's own game folder)");

                // What the installer wrote into the Steam copy before the folder
                // existed comes out with it, from the installer's own list.
                long ourBytes = 0; int ourCount = 0;
                try { Uninstall.OurGameFiles(cfg, out ourBytes, out ourCount); }
                catch { ourBytes = 0; ourCount = 0; }
                string ours = ourCount > 0
                    ? ourCount.ToString("n0") + " files, " +
                      (ourBytes / 1024.0 / 1024.0).ToString("0") + " MB"
                    : "nothing on record";
                if (dropMods) goes.AppendLine("    Thornswood's own files inside your Skyrim on Steam   (" + ours + ")");
                else          stays.AppendLine("    Thornswood's own files inside your Skyrim on Steam   (" + ours + ")");
                stays.AppendLine("    Your Skyrim on Steam. None of the rest of it is touched");
                stays.AppendLine("    The collection's mods. Purge Mods in Vortex is what removes those");
            }
            else
            {
                int files = 0;
                long bytes = Uninstall.Measure(Paths.Game, ref files);
                string size = bytes > 0
                    ? (bytes / 1024.0 / 1024.0 / 1024.0).ToString("0.0") + " GB" : "some space";
                if (dropMods) goes.AppendLine("    " + Paths.Game + "   (" + size + ", the mods)");
                else          stays.AppendLine("    " + Paths.Game + "   (" + size + ", the mods)");
                stays.AppendLine("    Your own Skyrim on Steam");
            }

            goes.AppendLine("    " + Paths.LauncherDir);
            goes.AppendLine("    " + Paths.Personal);
            if (!keep)
            {
                goes.AppendLine("    " + Paths.ProfileDir + "   (your characters and settings)");
                goes.AppendLine("    " + Paths.CfgFile);
            }
            else
            {
                stays.AppendLine("    " + Paths.ProfileDir + "   (your characters and settings)");
                stays.AppendLine("    " + Paths.CfgFile);
                // Kept saves and settings are only that (#3679): the log, the
                // Discord sign-in, name and picture, the support reports and
                // the browser folders inside Profile go either way.
                goes.AppendLine("    From " + Paths.ProfileDir + ": " + LocalKeep.NotSavesInWords);
            }

            // Named rather than removed quietly, because it is not where
            // anybody would look for it and it is usually the biggest thing on
            // the list.
            try
            {
                foreach (string sc in Uninstall.Scratch())
                    goes.AppendLine("    " + sc + "   (what the installer left behind)");
            }
            catch (Exception ex) { Swallow.Note("Shell.DoUninstall", ex); }

            // The dev build is a second install in a folder of its own, beside
            // this one, with its own launcher and its own game folder. Nothing
            // here removes it and nothing here can: every path this uninstall
            // deletes has to sit under Root, and that fence is the reason a
            // wrong entry in a list can never become rmdir pointed at somebody's
            // game. So it is named instead of quietly left, because somebody who
            // has just uninstalled Thornswood and still has a Thornswood
            // launcher on their machine is owed the reason.
            try
            {
                if (Directory.Exists(DevBuild.Root))
                    stays.AppendLine("    the dev build at " + DevBuild.Root +
                                     "   (its own launcher uninstalls it)");
            }
            catch (Exception ex) { Swallow.Note("Shell.DoUninstall", ex); }

            stays.AppendLine("    Windows' own Skyrim settings and saves");

            bool r1 = Ask.YesNo(
                "This removes:\n\n" + goes +
                "\nThis is left alone:\n\n" + stays +
                "\nWindows\u2019 Skyrim settings and saves folders are pointed back at your own copy " +
                "first. If that fails, nothing is deleted.\n\nContinue?",
                "Uninstall Thornswood", Ask.Icon.Warning);
            if (!r1) return;

            // Built from what is actually about to happen rather than from
            // four hand written sentences, which is how one of them came to
            // talk about deleting mods on an install where it deletes none.
            string mods = Paths.Collection
                ? (dropMods ? "Thornswood's files come out of your Skyrim"
                            : "Thornswood's files stay in your Skyrim")
                : (dropMods ? "The mods go" : "The mods stay where they are");
            string chars = keep ? "your characters stay" : "your characters go";
            string warn = keep ? "" : "  None of that can be got back.";

            bool r2 = Ask.YesNo(
                "Last check. " + mods + ", and " + chars + "." + warn +
                (Paths.Collection
                   ? "\n\nThe collection itself is Vortex's. Purge Mods there when you want it gone."
                   : "") +
                "\n\nThe launcher closes as it finishes.",
                "Uninstall Thornswood", Ask.Icon.Warning);
            if (!r2) return;

            btnUninstall.IsEnabled = false;
            try
            {
                string[] rest = Uninstall.Begin(cfg, keep, dropMods, Log);
                Log("Handing the rest to Windows and closing...");
                Uninstall.Finish(rest, keep, dropMods);
            }
            catch (Exception ex)
            {
                btnUninstall.IsEnabled = true;
                Log("Uninstall stopped: " + ex.Message);
                Ask.Tell(ex.Message + "\n\nNothing was removed.",
                                "Thornswood", Ask.Icon.Warning);
                return;
            }

            Quit();
        }

        // ------------------------------------------------------------- updates
        // ------------------------------------------------------------- who is on
        static string pingText = "";

        /// <summary>Presence speaks from its own thread; the log lives on this one.</summary>
        static void PresenceLog(string m)
        {
            try { Dispatcher.UIThread.Post(new Action(delegate { Log(m); })); } catch (Exception ex) { Swallow.Note("Shell.PresenceLog", ex); }
        }

        static void AskOnline()
        {
            pingText = txtPing.Text ?? "";
            int dot = pingText.IndexOf("   \u00b7   ");
            if (dot >= 0) pingText = pingText.Substring(0, dot);
            ThreadPool.QueueUserWorkItem(delegate
            {
                Online.Count c = null;
                Online.Count other = null;
                try { c = Online.Ask(cfg); } catch (Exception ex) { Swallow.Note("Shell.AskOnline", ex); }
                try { other = Online.AskOther(cfg); } catch (Exception ex) { Swallow.Note("Shell.AskOnline", ex); }
                Online.Count got = c;
                Online.Count gotOther = other;
                Dispatcher.UIThread.Post(new Action(delegate
                {
                    string extra = Online.Line(got);
                    awakeMineText = extra;
                    awakeOtherText = Online.Line(gotOther);
                    if (cfg != null && cfg.IsDev)
                    {
                        awakeDevText = extra;
                        awakeMainText = awakeOtherText;
                    }
                    else
                    {
                        awakeMainText = extra;
                        awakeDevText = awakeOtherText;
                    }
                    string want = extra.Length > 0 ? pingText + "   \u00b7   " + extra : pingText;
                    if (txtPing.Text != want) txtPing.Text = want;
                    PaintServerChip();
                    if (playing && got != null)
                    {
                        try { Presence.Update(got.Known ? got.Now : -1, got.Max); } catch (Exception ex) { Swallow.Note("Shell.AskOnline", ex); }
                    }
                }));
            });
        }

        /// <summary>
        /// Put the client runtime back, if it is not the recorded build.
        ///
        /// THE ROW PROMISED THIS AND NOTHING DID IT. 1.1.82 shipped the check
        /// and the repair and never called the repair from anywhere, so the
        /// Client row said "the launcher will fetch it" and the launcher did
        /// not. Patrick, 22 September: "clicking scan and fix shows green and
        /// than recheck does nothing". Recheck did exactly nothing, because
        /// nothing was wired to it.
        ///
        /// Off the UI thread on purpose: this hashes six files, one of which
        /// is 15 MB, and may download a pack. Every line it produces goes to
        /// the log through the dispatcher, and the rows are redrawn at the end
        /// only when something actually changed.
        /// </summary>
        static bool healing;
        static void HealClientBackground()
        {
            if (healing) return;
            if (ClientRuntime.Recorded().Count == 0) return;
            if (ClientRuntime.Good()) return;
            healing = true;
            // One download, the client runtime, shown on the Play button (#1145).
            PlayProgress.Begin("Updating", 1);
            ThreadPool.QueueUserWorkItem(delegate
            {
                int n = 0;
                try
                {
                    n = ClientRuntime.Heal(cfg, delegate(string m)
                    {
                        string line = m;
                        Dispatcher.UIThread.Post(new Action(delegate { Log(line); }));
                    });
                }
                catch (Exception ex)
                {
                    string why = ex.Message;
                    Dispatcher.UIThread.Post(new Action(delegate
                    {
                        Log("Could not put the client runtime back: " + why);
                    }));
                }
                finally
                {
                    healing = false;
                    PlayProgress.End();
                    if (n > 0) Dispatcher.UIThread.Post(new Action(delegate { DrawStatus(); }));
                }
            });
        }


        /// <summary>
        /// Whether the card above Play should be the collection card, and if
        /// so which thing is wrong.
        ///
        /// Returns "none" for never installed, which is no more than
        /// Checks.MostPluginsWithoutCollection plugins enabled; "stale" when
        /// the revision Vortex installed is behind the one the server was
        /// built against; "ahead" when it is in front of it. Otherwise "",
        /// which includes having no collection address and either revision
        /// reading as 0.
        ///
        /// Two tests because a plugin count alone only catches somebody who
        /// has never installed the collection. An older revision still
        /// deploys a full list of plugins and looks perfect by that measure,
        /// so behind and ahead come from the revision numbers.
        ///
        /// ModsMissing is this answering anything but "", and while it does
        /// the mod updates wait. An update cannot succeed against a build
        /// with no mods in it, and the bar above Play used to say "Update
        /// failed" over the top of the one message somebody in that state
        /// actually needs.
        /// </summary>
        static string CollectionProblem(int revision = -1)
        {
            if (string.IsNullOrEmpty(cfg.CollectionUrl)) return "";
            try
            {
                if (Checks.EnabledPlugins() <= Checks.MostPluginsWithoutCollection) return "none";

                // THE REVISION, NOT A NAMED FILE.
                //
                // This used to ask whether one mod's file was present and
                // call the collection stale when it was not. That was wrong in
                // both directions, and on 22 September it was wrong on
                // Patrick's own machine in the quietest possible way.
                //
                // The file was not in the collection then: a script put it
                // into a build by hand. So anybody
                // who installed the collection correctly and never ran that
                // script read as behind, and Patrick, who had run it, read as
                // fine while sitting two revisions behind the collection he
                // publishes. Nothing on screen said a word.
                //
                // Vortex names the collection's own mod folder with the
                // revision, so there is a number to compare, and the feed
                // carries the revision the SERVER was built against. Behind
                // and ahead are different problems and get different words:
                // behind means update, ahead means the server has not caught
                // up with you yet and Play will refuse you on the load order.
                int mine = revision < 0 ? Checks.CollectionRevision(cfg) : revision;
                int wants = Updater.FeedCollectionRevision;
                if (mine > 0 && wants > 0)
                {
                    if (mine < wants) return "stale";
                    if (mine > wants) return "ahead";
                }
            }
            catch { return ""; }
            return "";
        }

        static bool ModsMissing(int revision = -1)
        {
            return CollectionProblem(revision).Length > 0;
        }

        static bool collectionBarUp = false;

        /// <summary>The not-confirmed note is on the bar above Play (see DrawStatus).</summary>
        static bool collectionNoteUp = false;

        /// <summary>
        /// True when CollectionProblem found nothing wrong only because it could
        /// not read which collection revision Vortex installed (Djinn, 2 Oct).
        /// </summary>
        static bool CollectionUnconfirmed(int revision = -1)
        {
            if (string.IsNullOrEmpty(cfg.CollectionUrl)) return false;
            try
            {
                if (revision < 0) revision = Checks.CollectionRevision(cfg);
                if (CollectionProblem(revision).Length > 0) return false;
                return revision <= 0;
            }
            catch (Exception ex) { Swallow.Note("Shell.CollectionUnconfirmed", ex); return false; }
        }

        /// <summary>
        /// Turns the bar above Play into the one thing worth doing first. Same
        /// bar, same button, different job, because a second card underneath a
        /// louder one is a card nobody reads.
        /// </summary>
        static void ShowCollectionBar(int revision = -1)
        {
            if (revision < 0) revision = Checks.CollectionRevision(cfg);
            string problem = CollectionProblem(revision);
            bool stale = problem == "stale";

            if (stale)
            {
                int mine = revision;
                int wants = Updater.FeedCollectionRevision;
                txtUpdateTitle.Text = "Your mods need updating";
                txtUpdateNote.Text =
                    "The server was built against collection revision " + wants + " and this copy is on " + mine +
                    ", so part of what the server expects is not installed. The button opens revision " +
                    wants + " on Nexus; install that one in Vortex, not a newer one Nexus may show first. " +
                    "It is one button there and it takes the lot in one go.";
            }
            else if (problem == "ahead")
            {
                // The other direction, which nothing used to say at all. The
                // person has done everything right and is further forward than
                // the server; Play will still refuse them, on the load order,
                // and without this that reads as their fault.
                int mine = revision;
                int wants = Updater.FeedCollectionRevision;
                txtUpdateTitle.Text = "The server has not caught up with you";
                txtUpdateNote.Text =
                    "You are on collection revision " + mine + " and the server was built " +
                    "against revision " + wants + ". Nothing is wrong with your install and " +
                    "nothing needs installing. Play stays shut until the server is rebuilt on " +
                    "your revision, which is ours to do, so say so in the Discord if nobody has.";
            }
            else
            {
                txtUpdateTitle.Text = "Your mods are not installed yet";
                txtUpdateNote.Text =
                    "Thornswood's mods are a collection on Nexus, and Vortex installs them into a " +
                    "profile of its own, so the Skyrim you already play is left alone. Nothing else " +
                    "here comes right until that is done, updates included.";
            }
            updateBar.IsVisible = true;
            // Ahead has no button (#4115): there is nothing to install, and
            // every collection page leads to the same revision or a newer one.
            InstallShown(problem != "ahead");
            collectionBarUp = true;

            // Open to everybody (#428). Patrick, 28 Sep: "we are in alpha so the
            // world is open by application". Anyone can download, and the
            // collection's link is on the public Downloads page, so holding it
            // back here until Discord was linked kept nothing from anybody and
            // left somebody still waiting on their application with a button
            // that only said Connect Discord, which the site refuses until they
            // are accepted. The application is what unlocks Play, not the mods.
            InstallLabel(CollectionButtonText());
            btnInstallNow.IsEnabled = true;
        }

        /// <summary>
        /// The page the collection buttons open: the revision the server was
        /// built against (#4115, Checks.CollectionRevisionUrl).
        /// </summary>
        static string CollectionLink()
        {
            return Checks.CollectionRevisionUrl(cfg, Updater.FeedCollectionRevision);
        }

        /// <summary>
        /// What every collection button does (#5200): Vortex opened straight
        /// at the revision the server was built against, through Nexus's own
        /// link to it (Checks.CollectionNxmUrl), so a copy on an old revision
        /// is one press from the live one. Before this every button opened
        /// the revision's page on the site, where somebody still had to find
        /// and press the site's own button that hands Vortex this same link.
        ///
        /// The page opens instead when Vortex is not what answers nxm links
        /// on this machine (Checks.NxmStartsVortex: nothing does, or another
        /// manager does), or no revision is known yet. The page says what to
        /// do from there, as it always has.
        ///
        /// When Vortex is done the card comes down by itself and Scan and Fix
        /// run (ShellVortexWatch.cs, VortexChanged).
        /// </summary>
        static void OpenCollection()
        {
            string nxm = Checks.CollectionNxmUrl(cfg, Updater.FeedCollectionRevision);
            string page = CollectionLink();
            bool vortex = nxm.Length > 0 && Checks.NxmStartsVortex(Checks.NxmCommand());
            try
            {
                if (vortex)
                {
                    Log("Opening revision " + Updater.FeedCollectionRevision + " of the collection in Vortex. Install it there; the launcher scans and fixes by itself when Vortex is done.");
                    Process.Start(new ProcessStartInfo(nxm) { UseShellExecute = true });
                    return;
                }
                if (nxm.Length > 0)
                    LogOnly("Vortex does not answer Nexus links on this machine, so the collection opens on the site.");
                Process.Start(new ProcessStartInfo(page) { UseShellExecute = true });
            }
            catch (Exception ex) { Log("Could not open the collection: " + ex.Message); }
        }

        /// <summary>The button's words, naming the revision it opens when one is known.</summary>
        static string CollectionButtonText()
        {
            int wants = Updater.FeedCollectionRevision;
            return wants > 0 ? "Open revision " + wants : "Open the collection";
        }

        /// <summary>
        /// Why the mod updates wait while the collection card is up, in two
        /// halves: what is wrong, and what they wait for (#4115). The log said
        /// "the collection is not installed yet" for all three cases, which
        /// was wrong for a copy behind the server and for one ahead of it.
        /// </summary>
        static string[] CollectionWait()
        {
            int mine = 0;
            try { mine = Checks.CollectionRevision(cfg); }
            catch (Exception ex) { Swallow.Note("Shell.CollectionWait", ex); }
            int wants = Updater.FeedCollectionRevision;
            string problem = CollectionProblem(mine);
            if (problem == "stale")
                return new[] { "The collection here is on revision " + mine + " and the server's is " + wants + ".",
                               "for the collection to be updated to revision " + wants };
            if (problem == "ahead")
                return new[] { "The collection here is on revision " + mine + ", ahead of the server's " + wants + ".",
                               "for the server to be rebuilt on revision " + mine };
            return new[] { "The collection is not installed yet.", "for it to be installed" };
        }

        /// <summary>What Play says when a press reaches it with the collection card up (#4115).</summary>
        static string CollectionHeldLine()
        {
            return CollectionWait()[0] + (CollectionProblem() == "ahead"
                ? " Nothing needs installing; Play opens once the server is rebuilt."
                : " Open the collection from the card above Play, then come back.");
        }


    }
}
