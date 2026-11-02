using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// The launcher's side of OwnGame: the card in Settings, the offer at
    /// startup on a machine where another SkyMP server has been, and bringing
    /// the folder up to date by itself when Vortex has deployed a newer
    /// Thornswood collection. Play stays off while either runs.
    /// </summary>
    static partial class Shell
    {
        static bool ownGameBusy, ownGameStarted, restarting;
        // True while StartPlay runs again straight after a bring-up-to-date
        // Play asked for, so OwnGameRefreshIfDue cannot ask for a second one.
        static bool ownGameRefreshedForPlay;
        // Only the window's thread changes this: DrawOwnGame bumps it, and the
        // background answer compares it on the way back through the dispatcher.
        static int ownGameDrawGen;
        static TextBlock txtOwnGameState;
        static Button btnOwnGameMake, btnOwnGamePick, btnOwnGameForget;

        static void WireOwnGame()
        {
            txtOwnGameState = win.TxtOwnGameState;
            btnOwnGameMake = win.BtnOwnGameMake;
            btnOwnGamePick = win.BtnOwnGamePick;
            btnOwnGameForget = win.BtnOwnGameForget;
            var panel = win.PnlOwnGame;

            if (btnOwnGameMake != null) btnOwnGameMake.Click += delegate { AskOwnGame(false); };
            // Bring it up to date from Vortex had a button of its own on
            // Diagnostics until 17 Oct (#2627). Scan finds a folder behind
            // Vortex and Fix brings it up to date, so the button went.
            if (btnOwnGamePick != null) btnOwnGamePick.Click += delegate { PickVortexFolder(); };
            if (btnOwnGameForget != null) btnOwnGameForget.Click += delegate { ForgetVortexFolder(); };
            if (panel != null) WhenShown(panel, DrawOwnGame);

            // Once the window is on screen, so a question has something to sit
            // in front of and the check does not hold up the first draw.
            OnceOnScreen(delegate
            {
                if (ownGameStarted) return;
                ownGameStarted = true;
                OwnGameAtStart();
            });

            win.Closing += delegate(object s, WindowClosingEventArgs e)
            {
                if (!ownGameBusy || restarting) return;
                if (!Ask.YesNo(
                    "Thornswood's own Skyrim folder is still being prepared.\n\nClose anyway? It starts again from where it can the next time the launcher opens.",
                    "Thornswood", Ask.Icon.Warning)) e.Cancel = true;
            };

            DrawOwnGame();
        }

        /// <summary>
        /// Runs draw each time c comes into view: the card is drawn when the
        /// Settings page is shown. WPF said so with IsVisibleChanged, which
        /// counted the page and every other parent. Avalonia's IsVisible is
        /// the control's own, and the event for the whole chain is internal
        /// to it, so each parent's IsVisible is watched here and the card is
        /// in view when all of them are.
        /// </summary>
        static void WhenShown(Control c, Action draw)
        {
            bool was = AllVisible(c);
            for (StyledElement e = c; e != null; e = e.Parent)
            {
                var watched = e as Visual;
                if (watched == null) continue;
                watched.PropertyChanged += delegate (object s, AvaloniaPropertyChangedEventArgs a)
                {
                    if (a.Property != Visual.IsVisibleProperty) return;
                    bool now = AllVisible(c);
                    if (now && !was) draw();
                    was = now;
                };
            }
        }

        static bool AllVisible(Control c)
        {
            for (StyledElement e = c; e != null; e = e.Parent)
            {
                var v = e as Visual;
                if (v != null && !v.IsVisible) return false;
            }
            return true;
        }

        static void OwnGameAtStart()
        {
            Config c = cfg;
            bool active = OwnGame.Active;
            bool collection = Paths.Collection;

            /*
                SAID EVERY START, not once, and said before anything is offered.

                The offer below is made once and can be declined, and after that
                nothing ever mentioned it again. So somebody who said no in
                September is still sharing one Skyrim with every other server on
                their machine months later, with nothing anywhere saying so.

                WHAT SHARING ACTUALLY COSTS, and it is not obvious from the
                outside. Data\Platform\Plugins\skymp5-client-settings.txt is ONE
                FILE in the Steam copy. Every launcher on the machine writes it
                and the game reads whichever wrote last. Ours puts chooseAtMenu
                and a profile id in it on every Play; another server's puts its
                own settings there. Start the game after theirs and our plugin
                sees no chooseAtMenu, does nothing, and the stock SkyMP login box
                comes up reading ID: UNDEFINED. Reported 21 September by a tester
                who plays two other servers, WITH OUR BACKDROP BEHIND IT, which
                is what makes it so hard to read: Vortex deployed our collection
                into that same shared copy, so the art, the menu and the mods are
                all ours and correct while the one file that decides who you are
                belongs to somebody else. My Games and LocalAppData are shared
                the same way, because Swap.Apply stands down in this mode and
                leaves Vortex to own them.

                This line is what lets the next report be read in ten seconds
                instead of an evening. It goes to the log on the window's thread,
                before the pool work below, because Log writes a control.
            */
            if (collection)
            {
                Log(NoOwnFolderYet() + " The Play button says MAKE THORNSWOOD'S OWN FOLDER until that is put right.");
            }

            ThreadPool.QueueUserWorkItem(delegate
            {
                bool refresh = false, offer = false;
                string refused = null;
                try
                {
                    // Vortex deploying into a Thornswood folder is refused
                    // (#2210), and said at every start, because the folder then
                    // never follows Vortex until it is pointed back.
                    if (active) refused = OwnGame.RefusedSource(c);
                    if (refused != null)
                    {
                        string say = refused;
                        try { Dispatcher.UIThread.Post(delegate { Log(say); }); }
                        catch (Exception ex) { Swallow.Note("ShellOwnGame.OwnGameAtStart, refused BeginInvoke", ex); }
                    }
                    else if (active) refresh = OwnGame.NeedsRefresh(c);
                    // A yes given in the setup window (MakeOwnGame) is newer
                    // than a no left in the profile by an earlier install.
                    else if (collection && (!OwnGame.Declined || c.MakeOwnGame))
                    {
                        string src = OwnGame.DeploysInto(c);
                        // Offered whenever it is possible. It used to be offered
                        // only when another server's files were found in the
                        // Steam copy, on the grounds that sharing a Skyrim was
                        // the problem the own folder solved. The own folder is
                        // the settled design now, so the offer stands on its own
                        // and nothing here looks for other servers any more.
                        offer = OwnGame.WhyNot(c, src) == null;
                    }
                }
                catch (Exception ex) { Swallow.Note("ShellOwnGame.OwnGameAtStart, NeedsRefresh or offer", ex); }
                if (!refresh && !offer) return;
                try
                {
                    Dispatcher.UIThread.Post(delegate
                    {
                        if (refresh) StartOwnGame(false, false);
                        else AskOwnGame(true);
                    });
                }
                catch (Exception ex) { Swallow.Note("ShellOwnGame.OwnGameAtStart, BeginInvoke", ex); }
            });
        }

        /// <summary>
        /// The same bring-up-to-date Fix runs on Diagnostics when Scan finds
        /// the folder behind Vortex (#2627). True when Play must stop for that
        /// work.
        ///
        /// OwnGameAtStart does this once when the window is first shown.
        /// Play never asked, so a collection Vortex had already deployed
        /// while the launcher was open went into the game from the last
        /// refresh. That is the cause: StartPlay and Play() checked
        /// ownGameBusy and then launched, and never called NeedsRefresh.
        ///
        /// When the bring-up-to-date succeeds, StartPlay runs again from the
        /// top, so one press of Play ends in the game, through the same Discord
        /// check and character list as any other press. A failure stops there
        /// and says why. StartPlay rather than Play(), because Play() is also
        /// reached from paths that have not been through Discord.
        ///
        /// ownGameBusy is read again after the wait. NeedsRefresh runs under
        /// Waiting, which keeps the window's messages moving, and the
        /// bring-up-to-date OwnGameAtStart queues when the window is first
        /// shown can start inside that wait. Read only before it, a Play
        /// pressed in that first second went on into the game while the
        /// folder under it was being rewritten.
        /// </summary>
        static bool OwnGameRefreshIfDue()
        {
            if (!OwnGame.Active) return false;
            if (playing || Checks.GameRunning()) return false;
            if (ownGameBusy)
            {
                Log("Thornswood's own Skyrim folder is being prepared. Play comes back when it is done.");
                return true;
            }
            bool due = false;
            try
            {
                Waiting(delegate { due = OwnGame.NeedsRefresh(cfg); });
            }
            catch (Exception ex)
            {
                // Same as at startup: not knowing is not a reason to refuse
                // Play, but it is said, so a report shows the check was missed.
                Swallow.Note("ShellOwnGame.OwnGameRefreshIfDue", ex);
                Log("Could not tell whether Thornswood's own Skyrim folder matches what Vortex has deployed (" +
                    ex.Message.TrimEnd('.') + "). Starting from the folder as it is.");
                return false;
            }
            if (ownGameBusy)
            {
                Log("Thornswood's own Skyrim folder is being prepared. Play comes back when it is done.");
                return true;
            }
            if (!due) return false;
            if (ownGameRefreshedForPlay)
            {
                // Just brought up to date for this same press, and it still
                // does not match. Starting it again would go round for ever.
                Log("Thornswood's own Skyrim folder still does not match what Vortex has deployed after bringing it up to date. " +
                    "Press Scan, then Fix, on Diagnostics, and send the launcher log if it keeps saying this.");
                return true;
            }
            StartOwnGame(false, true, delegate
            {
                ownGameRefreshedForPlay = true;
                try { StartPlay(); }
                finally { ownGameRefreshedForPlay = false; }
            });
            return true;
        }

        /// <summary>
        /// Refuse to start out of a shared Skyrim. True when Play may go on.
        ///
        /// "nothing here supports another server's install any more", decided by
        /// Patrick on 20 September and written into CLAUDE.md. The own game
        /// folder was built, the launcher restarts into it, and the shared
        /// layout was left in place underneath as a thing somebody could decline
        /// their way into and stay in for ever. That is not what was decided,
        /// and on 21 September it was still costing people:
        ///
        ///   "we keep having this issue with everyone where some of our stuff
        ///    appears in other servers when launching and vice versae"
        ///
        /// Because in that mode Data\Platform\Plugins\skymp5-client-settings.txt
        /// is ONE FILE that every launcher on the machine writes, and the game
        /// believes whichever wrote last. Ours writes chooseAtMenu and a profile
        /// id on every Play; another server's writes its own; the person gets
        /// the stock SkyMP login box reading ID: UNDEFINED behind our own
        /// backdrop, because Vortex deployed our collection into that same
        /// shared copy so the art is all correct. My Games and LocalAppData go
        /// the same way, since Swap.Apply stands down there.
        ///
        /// NOBODY IS LEFT WITHOUT A WAY FORWARD. WhyNot names the one thing
        /// stopping the folder being made, and every one of its answers says
        /// what to do: downgrade first, turn the Thornswood profile on in
        /// Vortex, or, with Skyrim on one drive and Thornswood on another, the
        /// two ways to put them on one, each named down to the drive letter and
        /// the buttons to press (OwnGame.OneDriveOnly). When it names nothing,
        /// the offer is put up here and now rather than pointing at a button in
        /// another screen.
        /// </summary>
        /// <summary>
        /// Where Thornswood stands before its own folder is made, for the log,
        /// the Play button and the box. Chosen at install (Paths.OwnFirst,
        /// #1226) nothing is shared: its files wait in Profile\Payload and the
        /// Steam copy is not written. Otherwise it shares the Steam copy with
        /// every other server, as it always has.
        /// </summary>
        static string NoOwnFolderYet()
        {
            if (Paths.OwnFirst)
                return "Thornswood's own Skyrim folder was chosen when Thornswood was installed and is not made yet. " +
                       "Until it is, Thornswood's files wait in " + Paths.Payload + " and nothing is written into the Steam copy in " + Paths.SteamCopy + ".";
            return "Thornswood is sharing one Skyrim with every other server on this machine, in " + Paths.SteamCopy +
                   ". Saves, settings and the client's own settings file are shared, so whichever launcher wrote last is the one the game believes, " +
                   "which is how their menus and logins get into Thornswood and Thornswood's get into theirs.";
        }

        static bool OwnGameRequired()
        {
            if (!Paths.Collection) return true;

            string src = OwnGame.DeploysInto(cfg);
            string why = OwnGame.WhyNot(cfg, src);

            if (why == null)
            {
                // It can be made. Offer it instead of refusing at them, and let
                // the person say yes or no to the thing that actually fixes it.
                Log("Thornswood will not start out of a Skyrim shared with other servers.");
                AskOwnGame(false);
                return false;
            }

            string msg =
                "Thornswood needs a Skyrim folder of its own before it can start.\n\n" +
                NoOwnFolderYet() + "\n\n" +
                // Not indented any more: WhyNot's answer can be a long sentence
                // (a drive apart names both ways out and their paths), and an
                // indent the box only applies to the first wrapped line reads
                // as a stray gap in the middle of it.
                "The folder cannot be made yet:\n\n" + why;
            Log("Not starting: Thornswood has no Skyrim folder of its own yet, and it " +
                "cannot be made yet. " + why);
            try
            {
                Ask.Tell(msg, "Thornswood", Ask.Icon.Warning);
            }
            catch (Exception ex) { Swallow.Note("ShellOwnGame.OwnGameRequired, MessageBox", ex); }
            return false;
        }

        static void AskOwnGame(bool atStart)
        {
            if (OwnGame.Active) { Log("Thornswood already runs from its own Skyrim folder, " + OwnGame.Folder + "."); return; }
            string src = OwnGame.DeploysInto(cfg);
            string game = OwnGame.Source(cfg);
            string why = OwnGame.WhyNot(cfg, src);
            if (why != null)
            {
                Log(why);
                if (!atStart) Ask.Tell(why, "Thornswood", Ask.Icon.Info);
                return;
            }

            // Already answered in the setup window (issue #906): its card
            // carries this panel's words and a tick box, and a tick is the
            // same yes as the one below, given before the launcher was open.
            if (cfg.MakeOwnGame)
            {
                Log("Making Thornswood's own Skyrim folder, as chosen when Thornswood was installed. " +
                    "It is made from what Vortex has deployed in " + src + ".");
                StartOwnGame(true, true);
                return;
            }

            bool yes = Ask.YesNo(
                "Give Thornswood a Skyrim folder of its own?\n\n" +
                "Thornswood and other servers are sharing one Skyrim right now, which is how their menus, plugins and mods get into each other. " +
                "With a folder of its own, Thornswood only ever starts from " + OwnGame.Folder + ", and switching profiles in Vortex no longer reaches it.\n\n" +
                "It is made from what Vortex has deployed in " + src +
                (string.Equals(game, src, StringComparison.OrdinalIgnoreCase) ? "" :
                    ", only the files Vortex's record there lists, with the game itself from the Steam copy in " + game + ". Nothing else in " + src + " comes with it") +
                ". The big files are links, so the collection is not on the disk twice. " +
                "It takes a few minutes, and the launcher restarts when it is done." +
                (atStart ? "\n\nSay no and the button stays in Settings, under Maintenance." : ""),
                "Thornswood", Ask.Icon.Question);
            if (!yes)
            {
                if (atStart)
                {
                    OwnGame.Decline();
                    Log("Left Thornswood in the shared Skyrim. Settings, Maintenance has the button when you want it.");
                }
                return;
            }
            StartOwnGame(true, true);
        }

        /// <param name="make">True to make the folder, false to bring it up to date.</param>
        /// <param name="loud">True when somebody pressed a button, so failures get a box as well as a log line.</param>
        static void StartOwnGame(bool make, bool loud)
        {
            StartOwnGame(make, loud, null);
        }

        /// <param name="then">Run on the window's thread once a bring-up-to-date has succeeded, or null. Not run when it fails, and never after a make, which restarts the launcher.</param>
        static void StartOwnGame(bool make, bool loud, Action then)
        {
            StartOwnGame(make, loud, then, null);
        }

        /// <param name="failed">Run on the window's thread when a bring-up-to-date that started did not succeed, or null; Fix carries on from there (#2627).</param>
        /// <returns>True when the work started; false when something in the way was said instead, and neither <paramref name="then"/> nor <paramref name="failed"/> will run.</returns>
        static bool StartOwnGame(bool make, bool loud, Action then, Action failed)
        {
            if (ownGameBusy) return false;
            // The downgrade puts 1.6.1170's files into this folder, or, before
            // there is one, makes it from them itself when it is done (#1218).
            if (Downgrade.Busy)
            {
                Log("Skyrim 1.6.1170 is being fetched for Thornswood's own folder. Press Scan, then Fix, on Diagnostics once that is done; the launcher also brings the folder up to date by itself the next time it starts.");
                return false;
            }
            if (playing || Checks.GameRunning())
            {
                string msg = "Close Skyrim first, then " + (make ? "make" : "update") + " Thornswood's own folder. " + Checks.StuckReport();
                Log(msg);
                if (loud) Ask.Tell(msg, "Thornswood", Ask.Icon.Info);
                return false;
            }
            if (!make && !OwnGame.Active) { Log("Thornswood does not have its own Skyrim folder yet."); return false; }

            ownGameBusy = true;
            // The Play button shows how far it has got (#1145): OwnGame counts
            // the files, and Verify the plugins it checks after.
            PlayProgress.Begin(OwnGame.Phase, 0);
            DrawStatus();
            DrawOwnGame();
            Log(make ? "Making Thornswood's own Skyrim folder from what Vortex has deployed. Play comes back when it is done."
                     : then != null ? "Vortex has deployed since Thornswood's own Skyrim folder was last brought up to date. Bringing it up to date now, and the game starts by itself when it is done."
                     : "Bringing Thornswood's own Skyrim folder up to date with what Vortex has deployed. Play comes back when it is done.");

            Config c = cfg;
            ThreadPool.QueueUserWorkItem(delegate
            {
                Action<string> say = delegate(string m)
                {
                    try { Dispatcher.UIThread.Post(delegate { Log(m); }); } catch (Exception ex) { Swallow.Note("ShellOwnGame.StartOwnGame, say BeginInvoke", ex); }
                };
                // One folder writer at a time (#2210): an update writing what it
                // downloaded finishes first, and none starts writing until this
                // is done, the light flags, the load order and the check after
                // the refresh included. The update's download is not held.
                OwnGame.Alone(delegate { FolderWork(make, loud, then, failed, c, say); },
                    delegate { say("An update is putting its files into the game folder. Thornswood's own Skyrim folder is prepared as soon as that is done."); });
            });
            return true;
        }

        /// <summary>
        /// StartOwnGame's work, on its pool thread, with the folder to itself
        /// (OwnGame.Alone). Its last step queues the finish on the window's
        /// thread before the folder is let go, so an update waiting to write
        /// is always after it there.
        /// </summary>
        static void FolderWork(bool make, bool loud, Action then, Action failed, Config c, Action<string> say)
        {
            // While the folder is prepared the Play button shows that, and an
            // update downloading beside it says nothing to the button.
            PlayProgress.FolderFirst(true);
            string said = null, fail = null;
            try { said = make ? OwnGame.Make(c, say) : OwnGame.Refresh(c, say); }
            catch (Exception ex) { fail = ex.Message; }

            // Made: from here Paths name the new folder, as they will after
            // the restart below, so the light flags and the load order are
            // put right in Thornswood's own folder and its Profile. On the
            // old Paths they went into the Steam copy's plugins, through
            // Vortex's links, and Windows' own plugin list, or, with the
            // folder chosen at install, into a Profile\Payload that is gone
            // (#1226).
            if (make && fail == null)
            {
                try { Paths.Init(Paths.Root); }
                catch (Exception ex) { Swallow.Note("ShellOwnGame.StartOwnGame, pointing Paths at the new folder", ex); }
            }

            // The same load-order step Fix runs. SettleSettings on a full
            // Refresh used to lay Golden's plugins.txt over Live, which put
            // Thornswood-Content.esp out of the server's order (Gavin: Mod
            // list red at position 21 after "already matches"), so
            // PutInServerOrder (the same write Scan and Fix uses) keeps Mod
            // list green. Light flags are not written here or anywhere: the
            // collection installs them (#2979, #3022), and Verify.Run names a
            // copy whose flag is not the server's. Verify.Run follows; when
            // Refresh already matched, skip the Bytes CRC pass so finishing is
            // not held on hashing every plugin, and skip Run entirely when
            // nothing changed and a server-aware LastIssues is already shared.
            if (fail == null)
            {
                bool already = said != null
                    && said.IndexOf("already matches what Vortex has deployed", StringComparison.Ordinal) >= 0;
                int ordered = 0;
                try
                {
                    ordered = Verify.PutInServerOrder(c, say);
                }
                catch (Exception ex)
                {
                    Swallow.Note("ShellOwnGame.StartOwnGame, PutInServerOrder after Vortex bring-up-to-date", ex);
                    say("Could not put the plugin list into the server's order after the Vortex update (" + ex.Message.TrimEnd('.') + "). Press Fix on Diagnostics if Mod list goes red.");
                }
                bool needVerify = !already || ordered > 0
                    || !Verify.LastUsedServer || Verify.LastIssues == null;
                if (needVerify)
                {
                    try { Verify.Run(c, !already); }
                    catch (Exception ex) { Swallow.Note("ShellOwnGame.StartOwnGame, Verify after Vortex bring-up-to-date", ex); }
                }
            }

            // No firewall rule is written here any more, and nothing asks
            // for administrator (#911). Windows only asked about the game's
            // browser because the in-game voice page kept making WebRTC
            // connections after the launcher had taken the audio, and a
            // WebRTC connection opens UDP sockets on every network the
            // machine has. thornswood-voice.js makes none in relay mode now,
            // so the browser has nothing for Windows to ask about.

            // The folder work is over: an update writing next may show itself.
            PlayProgress.FolderFirst(false);
            try
            {
                Dispatcher.UIThread.Post(delegate
                {
                    ownGameBusy = false;
                    PlayProgress.End();
                    if (fail != null)
                    {
                        Log((make ? "Thornswood's own Skyrim folder was not made. " : "Thornswood's own Skyrim folder was not brought up to date. ") + fail);
                        if (loud) Ask.Tell(fail, "Thornswood", Ask.Icon.Warning);
                    }
                    else
                    {
                        Log(said);
                        if (make)
                        {
                            Log("Restarting the launcher so it runs from the new folder.");
                            RestartLauncher();
                            return;
                        }
                        // LastIssues was refreshed on the pool thread after
                        // PutInServerOrder; paint Scan and Fix and Ready from
                        // it so the card does not stay on the pre-Vortex state. The folder is up to date now, so
                        // the card stops saying it is behind.
                        Upkeep.Forget(IssueKind.Behind);
                        if (Verify.LastUsedServer && Verify.LastIssues != null)
                            ShowVerify(Verify.LastIssues, false);
                    }
                    DrawStatus();
                    DrawOwnGame();
                    if (fail == null && !make && then != null) then();
                    else if (fail != null && failed != null) failed();
                    // The scan after an update that found the folder being
                    // prepared (#3201), or after Vortex finished (#5200).
                    // Fix's own refresh is "then", and Fix under way turns
                    // this away.
                    if (fixWhenFolderReady)
                    {
                        fixWhenFolderReady = false;
                        if (fixWhenFolderReadyAfterVortex) { fixWhenFolderReadyAfterVortex = false; RunFix(false, true); }
                        else RunFix(true);
                    }
                });
            }
            catch (Exception ex) { Swallow.Note("ShellOwnGame.StartOwnGame, finish BeginInvoke", ex); }
        }

        static void DrawOwnGame()
        {
            if (txtOwnGameState == null) return;
            // Every draw is numbered, so an answer that comes back from the
            // background after a newer draw is thrown away rather than drawn
            // over it.
            int gen = ++ownGameDrawGen;
            bool active = OwnGame.Active;
            string into = OwnGame.DeploysInto(cfg), game = OwnGame.Source(cfg);
            string from = into + (string.Equals(game, into, StringComparison.OrdinalIgnoreCase) ? "" : ", with the game itself from " + game);
            // Which folder is Vortex's, and whether somebody chose it, so a
            // choice that has gone stale can be seen and forgotten.
            string chosen = string.IsNullOrEmpty(cfg.VortexGame) ? "" :
                "\nVortex's folder is set to " + cfg.VortexGame + ". Forget the chosen folder to have Thornswood look for it again.";
            string state;
            if (ownGameBusy) state = "Working on it now.";
            else if (active) state = "On. Thornswood runs from " + OwnGame.Folder + ", made from " + from + ".";
            else if (!Paths.Collection) state = "This install already has a Game folder of its own from its installer.";
            else
            {
                /*
                    WhyNot reads Vortex's record, and when Vortex deploys into
                    a folder other than the Steam copy that means parsing all of
                    it, six megabytes on a full collection: about 0.4 s measured
                    on an SSD, longer on a hard disk, and this runs at startup
                    on the window's thread. Found in review, 24 September. So it
                    is asked in the background and drawn when it comes back. The
                    answer is kept until Vortex deploys again, so Play and Make
                    it, which ask it again when pressed, find it ready.
                */
                state = "Off. Checking what Vortex has deployed in " + from + ".";
                Config askCfg = cfg;
                string askInto = into, askFrom = from, askChosen = chosen;
                System.Threading.ThreadPool.QueueUserWorkItem(delegate
                {
                    string why;
                    try { why = OwnGame.WhyNot(askCfg, askInto); }
                    catch (Exception ex) { why = "Thornswood could not read what Vortex has deployed: " + ex.Message; }
                    string text = (why == null
                        ? "Off. Vortex has the Thornswood collection deployed in " + askFrom + ", so it can be made now."
                        : "Off. " + why) + askChosen;
                    try
                    {
                        Dispatcher.UIThread.Post(delegate
                        {
                            if (gen != ownGameDrawGen || txtOwnGameState == null) return;
                            txtOwnGameState.Text = text;
                        });
                    }
                    catch { /* the window has closed, so there is nothing to draw into */ }
                });
            }
            txtOwnGameState.Text = state + chosen;
            if (btnOwnGamePick != null) btnOwnGamePick.IsEnabled = !ownGameBusy;
            if (btnOwnGameForget != null)
            {
                btnOwnGameForget.IsVisible = !string.IsNullOrEmpty(cfg.VortexGame);
                btnOwnGameForget.IsEnabled = !ownGameBusy;
            }

            if (btnOwnGameMake != null)
            {
                btnOwnGameMake.IsVisible = !active;
                btnOwnGameMake.IsEnabled = !ownGameBusy && Paths.Collection;
            }
        }

        /// <summary>
        /// Choose Vortex's folder, in Settings: for a folder the search in
        /// OwnGame.DeploysInto cannot find, because it is not in a Steam
        /// library. OwnGame.PointAt takes it only when it is a Skyrim Vortex has
        /// deployed into, and says what it did either way.
        /// </summary>
        static void PickVortexFolder()
        {
            if (ownGameBusy) return;
            var pick = new FolderPickerOpenOptions();
            pick.Title = "Choose the Skyrim folder Vortex deploys into. In Vortex, Mods, Open, Open Game Folder opens it.";
            pick.AllowMultiple = false;
            try
            {
                string start = OwnGame.DeploysInto(cfg);
                if (start.Length > 0 && Directory.Exists(start))
                    pick.SuggestedStartLocation = Pump(win.StorageProvider.TryGetFolderFromPathAsync(start));
            }
            catch { /* only where the picker opens; it opens at its own default instead */ }
            // The picker is Windows' own folder dialog, which Avalonia only
            // offers as a task. Pump keeps the window's messages moving until
            // it is answered, so this carries on from the next line the way
            // the WinForms dialog's ShowDialog did.
            IReadOnlyList<IStorageFolder> picked = Pump(win.StorageProvider.OpenFolderPickerAsync(pick));
            string chosen = picked != null && picked.Count > 0 ? picked[0].TryGetLocalPath() : null;
            if (string.IsNullOrEmpty(chosen)) return;
            bool ok;
            string said = OwnGame.PointAt(cfg, chosen, out ok);
            Log(said);
            if (!ok) Ask.Tell(said, "Thornswood", Ask.Icon.Info);
            else if (OwnGame.Active) Log("Scan and then Fix on Diagnostics take it in now; otherwise the launcher does it the next time it starts.");
            DrawOwnGame();
            DrawStatus();
        }

        static void ForgetVortexFolder()
        {
            if (ownGameBusy) return;
            bool ok;
            Log(OwnGame.PointAt(cfg, "", out ok));
            DrawOwnGame();
            DrawStatus();
        }

        /// <summary>
        /// Paths are worked out once, when the launcher starts, so running from a
        /// new game folder means starting again. Same short detached script the
        /// self update uses: wait for this one to go, start the exe.
        /// </summary>
        static void RestartLauncher()
        {
            try
            {
                // The exe itself. Assembly.Location is empty in a native
                // single file exe, so it is the process's own path.
                string exe = Environment.ProcessPath;
                string bat = Path.Combine(Path.GetTempPath(), "ts-restart-" + Process.GetCurrentProcess().Id + ".cmd");
                // cmd reads a .cmd file in the console's OEM code page, not
                // the UTF-8 this is written in, so a path with any character
                // outside ASCII would reach start as different bytes and the
                // launcher would close and never come back.
                File.WriteAllText(bat,
                    "@echo off\r\n" +
                    "chcp 65001 >nul\r\n" +
                    "ping 127.0.0.1 -n 3 >nul\r\n" +
                    "start \"\" \"" + exe + "\"\r\n" +
                    "del \"%~f0\"\r\n");
                var psi = new ProcessStartInfo(bat);
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                Log("Could not restart by itself (" + ex.Message + "). Close the launcher and open it again.");
                return;
            }
            restarting = true;
            win.Close();
        }
    }
}
