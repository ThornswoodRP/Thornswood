using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Threading;

namespace Thornswood
{
    // The update check, its half hourly clock, and the Install path that puts
    // a new launcher and the game files its package carries in (Velopack,
    // #4825). Asked of GitHub alone (GitHub.cs, #5608). They live apart from
    // Shell.cs because they are one self-contained slice, and Shell.cs was
    // long enough (#500).
    static partial class Shell
    {
        // A newer launcher on this install's Velopack channel, from the last
        // launcher check that answered (CheckUpdatesBackground), or null.
        // Only ever set and read on the window's thread.
        static Updater.LauncherUpdate pendingLauncher;
        // When the launcher's channel on GitHub was last asked (LauncherCheckDue).
        static DateTime launcherAskedAt = DateTime.MinValue;
        static readonly object launcherAskGate = new object();
        // Said once each in launcher.log, and again when it changes: what the
        // launcher check found, and why one could not be made.
        static string launcherSaid = "";
        static string launcherFailSaid = "";
        // True while the last launcher check could not be made, so the clock
        // asks again sooner (StartLauncherPoll).
        static volatile bool launcherCheckFailed;
        // True from the moment RunUpdate starts one until it has gone in or
        // failed (#3202). A new launcher closes the window instead.
        static bool updating;
        static bool launcherPollStarted;
        static volatile bool launcherPollStop;

        // How often an open launcher asks its channel, and how soon after one
        // ask another may be made without a press of Check now. GitHub allows
        // sixty API calls an hour from one address without a token, shared by
        // every launcher behind it (GitHub.cs, THE HOUR'S SIXTY).
        static readonly TimeSpan LauncherPoll = TimeSpan.FromMinutes(30);
        static readonly TimeSpan LauncherMinGap = TimeSpan.FromMinutes(10);

        /// <summary>
        /// GitHub tells nobody when a Release is published, so an open launcher
        /// asks its channel itself, every half hour, through the same check
        /// the start runs, and ten minutes after a check that could not be
        /// made (GitHub did not answer: the network, or GitHub's own trouble,
        /// neither of them ours to order). Not while the game runs: a new
        /// launcher waits for the game to end, and the check after it is
        /// asked when it does (Shell.cs, the game closed). Started once;
        /// stopped when the window closes.
        /// </summary>
        static void StartLauncherPoll()
        {
            if (launcherPollStarted) return;
            launcherPollStarted = true;
            launcherPollStop = false;
            var poll = new Thread(delegate ()
            {
                while (!launcherPollStop)
                {
                    Thread.Sleep(launcherCheckFailed ? LauncherMinGap : LauncherPoll);
                    if (launcherPollStop) break;
                    if (playing) continue;
                    CheckUpdatesBackground(false);
                }
            });
            poll.IsBackground = true;
            poll.Name = "launcher update poll";
            poll.Start();
        }

        static void StopLauncherPoll()
        {
            launcherPollStop = true;
        }

        /// <summary>
        /// Whether this check asks GitHub: always for Check now (loud),
        /// otherwise when the last ask is LauncherMinGap old. Claims the ask,
        /// so two checks at once ask once.
        /// </summary>
        static bool LauncherCheckDue(bool loud)
        {
            lock (launcherAskGate)
            {
                DateTime now = DateTime.UtcNow;
                if (!loud && now - launcherAskedAt < LauncherMinGap) return false;
                launcherAskedAt = now;
                return true;
            }
        }

        /// <summary>
        /// The update check, on a pool thread: the launcher's own channel on
        /// GitHub when it is due, and the News tab's notes on the same thread.
        /// A check that is not due puts the last answer up again, so a caller
        /// that set the button to CHECKING always gets an answer back.
        /// </summary>
        static void CheckUpdatesBackground(bool loud)
        {
            bool asked = false;
            Updater.LauncherUpdate launcher = null;
            string launcherWhy = null;
            if (LauncherCheckDue(loud))
            {
                try { launcher = Updater.CheckLauncher(cfg); asked = true; }
                catch (Exception ex) { launcherWhy = Failure.Why("ShellUpdate, the launcher's update", ex); }
                // The notes of the Releases this channel's Deployment reached,
                // here on the check's own thread, so the News tab has them
                // (#5187, ReleaseNews.cs). Never throws.
                Updater.FillNews(cfg);
            }
            launcherCheckFailed = launcherWhy != null;
            string launcherNote = Updater.LastLauncherCheck;
            Dispatcher.UIThread.Post(delegate
            {
                LauncherAnswer(asked, launcher, launcherNote, launcherWhy, loud);
                UpdateBySelf();
                FixAfterVortex();
            });
        }

        /// <summary>
        /// The server runs a plugin of ours this install's release does not
        /// carry (Verify.ServerAheadOfRelease, #7045), which only a newer
        /// Release brings: the channel is asked for it now, whatever the
        /// half hourly clock says, and the answer goes where every check's
        /// does (LauncherAnswer), so Play, Fix and the card above Play judge
        /// the update on it. Awaited on the window's thread. Until #7045
        /// Play and Fix judged it on the last half hourly answer, up to 30
        /// minutes old, and refused a launcher whose update was already out.
        /// </summary>
        static async Task AskForServersRelease(string plugin)
        {
            lock (launcherAskGate) launcherAskedAt = DateTime.UtcNow;
            Log("The server runs a " + plugin + " this launcher's release does not have. Asking GitHub for this channel's newest release.");
            Updater.LauncherUpdate launcher = null;
            string why = null;
            bool asked = false;
            string note = null;
            await OffThread(delegate
            {
                try { launcher = Updater.CheckLauncher(cfg); asked = true; }
                catch (Exception ex) { why = Failure.Why("ShellUpdate, the release the server runs", ex); }
                note = Updater.LastLauncherCheck;
            });
            launcherCheckFailed = why != null;
            LauncherAnswer(asked, launcher, note, why, false);
        }

        /// <summary>
        /// What the launcher check found, on the window's thread: kept for
        /// Install now and the card, said in launcher.log once and again
        /// whenever it changes, and drawn on the card above Play.
        ///
        /// A check that could not be made leaves what was known before (a
        /// launcher found waiting stays waiting) and frees Play when nothing
        /// was known: the site's join pass holds a launcher that is behind,
        /// and GitHub being down never holds one that is current (#5608).
        /// </summary>
        static void LauncherAnswer(bool asked, Updater.LauncherUpdate launcher, string note, string why, bool loud)
        {
            if (why != null)
            {
                Upkeep.LauncherUnknown = why;
                if (why != launcherFailSaid)
                {
                    launcherFailSaid = why;
                    Log("Could not ask GitHub for updates: " + why.TrimEnd('.') + ". The launcher asks again in " +
                        (int)LauncherMinGap.TotalMinutes + " minutes, and Check now asks at once. Play is not held for it.");
                }
            }
            else if (asked)
            {
                launcherFailSaid = "";
                Upkeep.LauncherUnknown = null;
                pendingLauncher = launcher;
                Upkeep.LauncherWaiting = launcher == null ? null : launcher.Version;
                if (!string.IsNullOrEmpty(note) && note != launcherSaid)
                {
                    launcherSaid = note;
                    LogOnly(note);
                }
            }
            // Scan and Fix's card goes by the same answer (#2627), so the Fix
            // button knows about an update waiting without Scan being pressed.
            UpdateOnCard();
            BuildNews();
            ShowUpdate(loud && asked);
        }

        /// <summary>
        /// The card above Play and the Play button from what is known now
        /// (pendingLauncher). <paramref name="sayUpToDate"/> says "Up to date."
        /// in the log when nothing is waiting, for Check now.
        /// </summary>
        static void ShowUpdate(bool sayUpToDate)
        {
            if (updating) return;
            bool newLauncher = pendingLauncher != null;
            updateAnswered = true;

            // Before a word is said about updates, the collection: the card
            // above Play is about the mods while they are missing, and the
            // launcher goes ahead anyway, because it needs no mods to update.
            // Holding it back with them left a machine whose Vortex was on
            // another server's profile stuck on an old launcher for good.
            if (ModsMissing())
            {
                if (!newLauncher)
                {
                    updatePending = false;
                    if (Downgrade.Needed(cfg))
                    {
                        DrawStatus();
                        return;
                    }
                    ShowCollectionBar();
                    DrawStatus();
                    return;
                }
                collectionBarUp = false;
            }
            else
            {
                collectionBarUp = false;
            }
            InstallLabel("Install now");

            if (!newLauncher)
            {
                updateBar.IsVisible = false;
                InstallShown(false);
                updatePending = false;
                DrawStatus();
                if (sayUpToDate) Log("Up to date.");
                return;
            }
            updatePending = true;
            DrawStatus();
            txtUpdateTitle.Text = "Update available";
            txtUpdateNote.Text = "launcher " + pendingLauncher.Version + (pendingLauncher.Channel == "dev" ? " (dev)" : "");
            updateBar.IsVisible = true;
            InstallShown(true);
            if (pendingLauncher.Version != updateShownFor)
            {
                updateShownFor = pendingLauncher.Version;
                Log(cfg.AutoUpdate
                    ? "Update available: launcher " + pendingLauncher.Version + "."
                    : "Update available: launcher " + pendingLauncher.Version + ". Install it from the card above the Play button, or in Settings.");
            }
        }

        // The launcher the card last said was available, so the line is in
        // the log once and not on every half hourly check.
        static string updateShownFor;

        /// <summary>
        /// Automatic updates (#3202): an update the check found goes in by
        /// itself, the same as one press of Install now, when the setting
        /// is on, which it is unless somebody switched it off. Called after
        /// every update check's answer (CheckUpdatesBackground): the
        /// launcher's start, the half hourly check, Check now, and the check
        /// after the game closed. Not after Scan's or Fix's own scans: Scan
        /// only looks, and Fix takes the update itself, last.
        ///
        /// Patrick, 21 Oct, 6:30 PM: "the app needs to auto update by default
        /// and fix the auto update as I believe it's not working".
        /// </summary>
        static void UpdateBySelf()
        {
            if (!cfg.AutoUpdate) return;
            if (!updatePending || pendingLauncher == null) return;
            if (playing) return;
            // The first setup's Fix is running in a folder just made, and
            // takes the update itself at its end, as its one restart
            // (FirstSetupRestart). Taken here it would close the launcher
            // while Pandora or BodySlide build.
            if (restartAfterFirstFix) return;
            // One update at a time. The one going in is followed by Fix,
            // which takes a newer one last (FixRest).
            if (updating) return;
            // Nor while a Fix runs: it takes the update itself, last
            // (FixRest), once its own work is done. Taken here, the update
            // reached its close while the scan after the last update was
            // still running, the close was held back for it and never made
            // again, and the launcher sat on Updating (#6129, 15 Nov 2026).
            if (fixing) return;
            // An update never closes a game nobody asked it to. A Skyrim the
            // launcher did not start is not "playing", and RunUpdate would
            // ask to close it; the card waits for Install now instead.
            if (Checks.GameRunning())
            {
                Log("Skyrim is open, so the update waits. Close the game and press Install now on the card above Play.");
                return;
            }
            // The update that failed last is never taken again by itself:
            // doing the same thing again is not a fix for why it did not go
            // in, and every later check would otherwise take it again.
            // Install now still can.
            if (updateTried != null && updateTried == pendingLauncher.Version)
            {
                Log("The update that did not go in is not taken again by itself. Its own line in the log says why; Install now takes it once that is put right.");
                return;
            }
            Log("Installing it now, because automatic updates are on (Settings, Updates).");
            UpdateNow();
        }

        /// <summary>
        /// Install now, on the card above Play and in Settings, and the
        /// automatic update (UpdateBySelf, #3202): the whole update in one
        /// press (#3201). The new launcher's game files go in, the launcher
        /// restarts into the new one, and the new one runs Fix once its window
        /// is up (Shell.cs, when Velo.Restarted says Velopack started it after
        /// an update). An update that failed still gets Fix (FixRest), and is
        /// not taken again by itself.
        /// </summary>
        static void UpdateNow()
        {
            RunUpdate(FixAfterUpdate);
        }

        /// <summary>
        /// The card's button above Play and the one in Settings: opens the
        /// collection while the card is about the mods, and otherwise is
        /// Install now (UpdateNow).
        /// </summary>
        static void InstallNowPressed()
        {
            if (collectionBarUp || (collectionNoteUp && !updatePending))
            {
                // Ahead has nothing to open (#4115): the button is hidden
                // for it, and a press that slips in before the redraw
                // must not send this copy to another revision.
                if (collectionBarUp && CollectionProblem() == "ahead") return;
                OpenCollection();
                return;
            }
            UpdateNow();
        }

        /// <summary>Whether both of those buttons show, so the card's is hidden where Settings' is, as for a collection ahead of the server (#4115).</summary>
        static void InstallShown(bool shown)
        {
            if (btnInstallNow != null) btnInstallNow.IsVisible = shown;
            if (btnUpdate != null) btnUpdate.IsVisible = shown;
        }

        /// <summary>What both of those buttons say, so the card's never says Install now over a card about the mods.</summary>
        static void InstallLabel(string text)
        {
            if (btnInstallNow != null) btnInstallNow.Content = text;
            if (btnUpdate != null) btnUpdate.Content = text;
        }

        /// <summary>
        /// The launcher the last update tried and failed to put in, by its
        /// version, so Fix after it can tell a newer update from the one it
        /// just tried, and never takes that one a second time (FixRest). One
        /// that goes in restarts the launcher, so nothing here says so.
        /// </summary>
        static string updateTried = null;

        /*
          THE UPDATE HANDED TO VELOPACK, KEPT ACROSS THE RESTART (#6129).
          updateTried lived only in this process, and a launcher update goes
          in after it has ended: Velopack's Update.exe puts it in, and when it
          cannot it starts this launcher again. The new process had no
          updateTried, found the same update, and took it again. On 15 Nov
          2026 that went round every 15 seconds from 11:16 AM, each time
          failing on the same held folder, until GitHub's allowance for the
          address ran out. So the version handed over is written beside the
          log as the launcher ends, and the next start reads it: still on
          another version means it did not go in, and it is tried, as
          updateTried, with the line Velopack's own log gave.
        */
        static string HandedFile { get { return Paths.ProfileDir == null ? null : Path.Combine(Paths.ProfileDir, "launcher-update-handed.txt"); } }

        /// <summary>The last thing before Velo.ExitApply: which update this launcher hands to Velopack, or none.</summary>
        static void HandOverUpdate(string version)
        {
            try
            {
                string file = HandedFile;
                if (file == null) return;
                if (version == null) { if (File.Exists(file)) File.Delete(file); return; }
                File.WriteAllText(file, version);
            }
            catch (Exception ex) { Swallow.Note("Shell.HandOverUpdate", ex); }
        }

        /// <summary>
        /// At start, once the window is up: an update the last launcher handed
        /// to Velopack that did not go in is said, with Velopack's reason, and
        /// marked tried, so neither the automatic update nor Fix takes it
        /// again by itself. Install now still does.
        /// </summary>
        static void SayHandedUpdate()
        {
            string file = HandedFile;
            if (file == null || !File.Exists(file)) return;
            string version = File.ReadAllText(file).Trim();
            File.Delete(file);
            if (version.Length == 0 || version == Updater.Version) return;
            updateTried = version;
            string why = Velo.LastError();
            Log("Launcher " + version + " did not go in when the last launcher closed; this is still " + Updater.Version + "." +
                (why.Length > 0 ? " Velopack said: " + why : "") +
                " It is not taken again by itself. Install now takes it once that is put right.");
        }

        /// <param name="after">Run on the window's thread when the update failed without restarting the launcher, or null. Install now runs Fix after it (#3201).</param>
        static void RunUpdate(Action<bool> after) { Begin(RunUpdateAsync(after)); }

        /// <summary>The update, awaited: RunUpdate's <c>after</c>.</summary>
        static async Task RunUpdateAsync(Action<bool> after)
        {
            if (playing) { Log("Quit the game first."); return; }
            // One at a time (#3202): an automatic update and a press of
            // Install now or Fix could otherwise each start one.
            if (updating) { Log("An update is already going in."); return; }
            Updater.LauncherUpdate launcherUpdate = pendingLauncher;
            if (launcherUpdate == null) { Log("There is no update waiting."); return; }
            // An update writes into the build. A game still holding files open
            // down there turns that into a half written install.
            if (!await ClearStuckGame(true)) return;
            updating = true;
            btnUpdate.IsEnabled = false;
            btnInstallNow.IsEnabled = false;
            btnPlay.IsEnabled = false;
            txtUpdateTitle.Text = "Updating";
            // Second, so a folder being prepared keeps the button (#2210).
            PlayProgress.Second(true);
            try { PlayProgress.Begin("Updating", 1); }
            finally { PlayProgress.Second(false); }
            DrawStatus();
            // Decided by Patrick on 12 Oct (#2210): the update downloads while
            // Thornswood's own Skyrim folder is prepared, and goes in once that
            // is done.
            if (ownGameBusy)
                Log("Thornswood's own Skyrim folder is being prepared. The update downloads now and goes in as soon as the folder is ready.");

            ThreadPool.QueueUserWorkItem(delegate
            {
                Action<string> log = delegate(string m)
                {
                    Dispatcher.UIThread.Post(delegate { Log(m); });
                };
                Updater.Fetched got = null;
                // What this thread reports stays off the Play button while the
                // folder is being prepared (PlayProgress.FolderFirst).
                PlayProgress.Second(true);
                try
                {
                    // The download, and every check on the launcher's package:
                    // nothing in the game folder or its records changes, so it
                    // runs beside a refresh.
                    got = Updater.FetchUpdate(cfg, launcherUpdate, log);
                    // The write: after a refresh under way, and none starts
                    // until it is done (OwnGame.Alone).
                    Updater.Fetched write = got;
                    OwnGame.Alone(delegate { Updater.WriteUpdate(cfg, write, log); },
                        delegate { log("The update is downloaded. It goes in as soon as Thornswood's own Skyrim folder is ready."); });

                    // The launcher last, once its game files are in: Velopack
                    // puts the checked package in when this launcher has
                    // closed and starts the new one (Velo.ExitApply, the end
                    // of Main).
                    Updater.LauncherUpdate launcher = Updater.LauncherOf(got);
                    log("Updating the launcher. It will restart.");
                    got = null;
                    Updater.ApplyLauncher(launcher);
                    Dispatcher.UIThread.Post(delegate
                    {
                        Stats.LastUpdate = DateTime.Now.ToString("d MMM HH:mm");
                        Stats.Save();
                        win.Close();
                    });
                }
                catch (Exception ex)
                {
                    Updater.Drop(got);
                    Dispatcher.UIThread.Post(delegate
                    {
                        Log("Update failed: " + Failure.Say("ShellUpdate, the update", ex));
                        txtUpdateTitle.Text = "Update failed";
                        updating = false;
                        btnUpdate.IsEnabled = true;
                        btnInstallNow.IsEnabled = true;
                        PlayProgress.End();
                        DrawStatus();
                        Log("Play stays off until the update goes through, because the server lets in only the launcher its channel is on.");
                        updateTried = launcherUpdate.Version;
                        if (after != null) after(false);
                    });
                }
                finally { PlayProgress.Second(false); }
            });
        }
    }
}
