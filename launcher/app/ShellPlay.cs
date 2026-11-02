using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Text;
using System.Threading;
using Avalonia.Controls;
using Avalonia.Threading;

namespace Thornswood
{
    // Play and its unwind: the checks on the way in, the launch, the wait
    // for the game to close, and clearing a Skyrim that will not let go.
    // They live apart from Shell.cs because they are one session slice, and
    // Shell.cs was long enough (#500).
    static partial class Shell
    {
        /// <summary>
        /// Clears a Skyrim that is still holding on. A crash, an Alt-F4, or one
        /// of the multiplayer client's browser helpers leaves a process behind
        /// with no window on screen: invisible to the person sitting there, and
        /// in the way of everything that comes next. Those are closed without
        /// asking, because there is nothing to lose and nothing to look at. A
        /// game that is actually on screen is somebody's session, so that one
        /// is asked about first. Returns false when the way is still blocked.
        /// </summary>
        static bool ClearStuckGame(bool askIfVisible)
        {
            if (!Checks.GameRunning())
            {
                // Somebody else's Skyrim, from another folder. Not ours to
                // close, and Steam will not run two at once, so the only
                // useful thing is to say which one is in the way.
                if (Checks.OtherSkyrimRunning())
                {
                    if (!askIfVisible) return true;
                    bool other = Ask.YesNo(
                        "A different Skyrim is already running, from another folder on this PC.\n\n" +
                        "Steam will not run two at once. Close that one first.\n\nTry to start this one anyway?",
                        "Thornswood", Ask.Icon.Warning);
                    if (!other) { Log("Left the other Skyrim alone."); return false; }
                }
                return true;
            }

            if (Checks.GameVisible())
            {
                if (!askIfVisible) return false;
                bool close = Ask.YesNo(
                    "Skyrim is already open.\n\n" +
                    "Close it and carry on? Anything not saved in that session is lost.",
                    "Thornswood", Ask.Icon.Warning);
                if (!close) { Log("Left the game where it was."); return false; }
            }

            Log("Closing what is left of Skyrim...");
            int n;
            string still = CloseGameWaiting(out n);
            if (still.Length > 0)
            {
                Log("Skyrim would not close. " + still);
                if (askIfVisible)
                    Ask.Tell("Skyrim would not close, so this has to wait.\n\n" + still,
                             "Thornswood", Ask.Icon.Warning);
                return false;
            }
            if (n > 0) Log("Closed " + n + " Skyrim process" + (n == 1 ? "" : "es") + " that was still open.");
            return true;
        }

        /// <summary>
        /// Ends the game and whatever it left behind, with the window still
        /// drawing while it waits (Waiting). Returns what is still running
        /// afterwards, as a sentence, or "" when everything went.
        /// </summary>
        static string CloseGameWaiting(out int closed)
        {
            int n = 0;
            string still = "";
            stallDoing = "closing Skyrim";
            try
            {
                Waiting(delegate
                {
                    n = Checks.CloseGame();
                    still = Checks.StuckReport();
                });
            }
            finally { stallDoing = null; }
            closed = n;
            return still ?? "";
        }

        /// <summary>
        /// Makes sure something is actually listening before the game starts.
        ///
        /// This is the failure everyone hits and nobody recognises. Without a
        /// server, SkyMP never sends the message that creates your character,
        /// so the client never loads a world: you get a long wait, a black
        /// screen, and then single player with no creation menus and no
        /// character on the server. It reads as the game being broken. It is
        /// one window nobody opened.
        /// </summary>
        static bool EnsureServer()
        {
            try
            {
                if (SkyMp.Up(cfg)) return true;

                if (!SkyMp.IsLocal(cfg))
                {
                    bool anyway = Ask.YesNo(
                        "The server is not answering.\n\n" +
                        "Starting anyway gives you a long wait, a black screen and then Skyrim on your own: " +
                        "no character creation, and nothing anyone else can see.\n\nStart the game anyway?",
                        "Thornswood", Ask.Icon.Warning);
                    if (!anyway) { Log("Not starting. The server is not answering."); return false; }
                    Log("Starting anyway. The server is not answering.");
                    return true;
                }

                // Up to forty eight seconds of waiting on the server to answer,
                // and the window has to keep drawing through it or Windows
                // offers to close the launcher instead. SafeLog, because what
                // Start says now comes from another thread.
                string why = null;
                Waiting(delegate { why = SkyMp.Start(cfg, SafeLog); });
                if (why == null) { Log("The server is up."); return true; }

                Log(why);
                Ask.Tell(why, "Thornswood", Ask.Icon.Warning);
                return false;
            }
            catch (Exception ex)
            {
                Log("Could not check the server: " + ex.Message);
                return true;
            }
        }

        static void Play()
        {
            try
            {
                // The button is not the only way in here. StartPlay, after the
                // Discord check, and a session coming back call this too, and
                // greying out btnPlay does nothing for those, so the three
                // things the button is disabled for are checked again on the
                // way in. The
                // one that bites is updatePending: the game closes for an
                // update, the pack is being fetched, and a press in that gap
                // starts Skyrim on a half extracted build.
                if (updatePending) { Log("An update is going in. Play comes back when it is done."); return; }
                if (collectionBarUp) { Log(CollectionHeldLine()); return; }
                if (ownGameBusy) { Log("Thornswood's own Skyrim folder is being prepared. Play comes back when it is done."); return; }
                if (OwnGameRefreshIfDue()) return;
                if (feedNotice.Hold != null) { Log(feedNotice.Hold); return; }

                if (!File.Exists(Paths.Loader)) { Log("skse64_loader.exe is missing from this build."); return; }
                if (!File.Exists(Paths.MpClient)) { Log("MpClientPlugin.dll is missing, so this build has no multiplayer in it."); return; }

                // Starting a second one on top of a copy that never exited is
                // how people end up staring at a launcher that says the game is
                // running while their screen says otherwise.
                if (!ClearStuckGame(true)) return;

                // Skyrim's archives this folder shares with the Steam copy still
                // hold 1.6.1170's bytes (#1217). The change time is all that is
                // read unless it moved, so this is instant on an ordinary Play.
                // The Steam copy is the person's to mod, and a file copied over
                // one of its archives there changes the one here too, so this is
                // checked on every Play, and the game never starts on another
                // build's archives. See OwnGameShare.cs.
                if (OwnGame.Active)
                {
                    string archives = null;
                    Waiting(delegate { archives = OwnGame.CheckShared(OwnGame.Source(cfg), PresenceLog); });
                    if (archives != null)
                    {
                        Log("Not launching. " + archives);
                        DrawStatus();
                        Ask.Tell(archives, "Thornswood", Ask.Icon.Warning);
                        return;
                    }
                }

                // Checked again here, not just at startup, because the player's
                // own mods folder and the plugin list can both change in between.
                int blockers = 0, absent = 0;
                List<Issue> found = null;
                Waiting(delegate { found = Verify.Run(cfg); });
                foreach (Issue i in found)
                {
                    if (!i.Blocking) continue;
                    blockers++;
                    if (i.Absent) absent++;
                }
                if (blockers > 0)
                {
                    Log("Not launching. " + blockers + " problem" + (blockers == 1 ? "" : "s") + " with your mod list would desync everyone.");
                    RunScan();
                    DrawStatus();
                    // Diagnostics, where Scan and Fix are since #607 and which
                    // the rail still shows. It was the Mods page until #982,
                    // which by then had no Fix on it and no rail button back.
                    // launcher\tests\test-refused-play-page.js holds this to the page
                    // that has BtnFix in MainWindow.axaml.
                    ShowPage(PageDiag);

                    // Two different problems wearing the same coat. A list in
                    // the wrong order is Fix's job. Plugins whose files are not
                    // on disk at all is not: nothing in this launcher can put a
                    // mod back, and telling somebody to press Fix when that is
                    // what happened sends them round in circles.
                    if (absent > 0)
                    {
                        // The collection's page is the one place that can put
                        // the mods back, so the box offers it rather than
                        // naming a page the rail no longer shows (#982).
                        bool canOpen = !string.IsNullOrEmpty(cfg.CollectionUrl);
                        bool open = false;
                        string missing =
                            (absent == 1 ? "A mod the server needs is not installed." : absent + " mods the server needs are not installed.") +
                            "\n\nThe usual reason is that a different profile is active in Vortex. Open Vortex, go to " +
                            "Profiles, and press Enable under Thornswood. Close Skyrim first if it is open.\n\n" +
                            "Pressing Fix will not help with this one. Fix repairs the plugin list, it cannot install a mod." +
                            (canOpen ? "\n\nIf you have never installed the collection, press Yes to open it and install it in Vortex." : "");
                        if (canOpen) open = Ask.YesNo(missing, "Thornswood", Ask.Icon.Warning);
                        else Ask.Tell(missing, "Thornswood", Ask.Icon.Warning);
                        if (canOpen && open)
                        {
                            OpenCollection();
                        }
                    }
                    else
                    {
                        Ask.Tell(
                            "Your mod list does not match the one this build shipped with.\n\n" +
                            "Joining like this desyncs the whole server, so the launcher will not start the game until it is sorted.\n\n" +
                            "Press Fix on the Diagnostics page, which is open behind this box, then try again.",
                            "Thornswood", Ask.Icon.Warning);
                    }
                    return;
                }

                // Every file in the personal folder, copied over the top on
                // every Play with nothing comparing them first, so a big one is
                // a visible stall on the window's own thread.
                int mine = 0;
                Waiting(delegate { mine = Verify.DeployPersonal(); });
                if (mine > 0) Log("Copied in " + mine + " of your own files.");

                // Several of these mods rewrite their own ini when Skyrim
                // exits, so a fix written once does not survive the next quit.
                // Putting them back here, every launch, is what makes them
                // stick.
                // Skyrim's window size and Display Tweaks' resolution are two
                // separate settings and either one left on an old monitor's
                // numbers is what leaves the game not reaching the bottom of
                // the screen. Checked every launch, because people change
                // monitors and nobody thinks to come back here.
                if (!cfg.LockResolution)
                {
                    string moved = Display.MatchScreen();
                    if (moved != null) Log("Set the game to " + moved + " to match your screen. Tick Lock resolution in Settings to stop that.");
                }

                int held = Enforce.Apply();
                if (held > 0) Log("Put back " + held + " setting" + (held == 1 ? "" : "s") + " the last session overwrote.");
                // A full crash snapshot on the dev build and staff PCs only
                // (#1191). Before the Said lines, which its writes add to.
                string snapshot = CrashDump.Apply(cfg);
                if (snapshot != null) Log(snapshot);
                foreach (string note in Enforce.Said) Log(note);

                // Written fresh every launch so the address and port the client
                // reads are whatever the launcher is showing. SkyMP has no join
                // screen: this file is the whole of joining.
                string join = AutoJoin.Apply(cfg);
                if (join != null) Log(join);

                // Same idea, for the microphone. The game's browser opens the
                // capture device and asking it for nothing gets Chromium's
                // default, which is not the one in Windows' sound settings. It
                // has to be told a name, and the name cannot ship with the
                // build because everybody owns a different microphone, so it
                // is read off this machine and written into this machine's ini.
                try { string ini = ThornIni.Ensure(); if (ini != null) Log(ini); } catch (Exception ex) { Swallow.Note("Shell.Play", ex); }
                try
                {
                    string mic = Mics.Apply(cfg);
                    if (!string.IsNullOrEmpty(mic)) Log("Microphone: " + mic);
                }
                catch (Exception ex) { Swallow.Note("Shell.Play", ex); }

                // The behavior files and the covered bodies are built here, on
                // this computer, from the collection's Pandora and BodySlide
                // (#3715, GeneratedHere): no release carries them. Only when
                // the record of the last build is missing or stale, which an
                // ordinary Play reads and runs nothing for. A build that fails
                // or a nude body stops Play: the animations would be missing
                // and the bodies would have no underwear (#405).
                string notBuilt = null, built = null;
                Waiting(delegate
                {
                    try { built = GeneratedHere.Ensure(SafeLog); }
                    catch (GeneratedStop ex) { notBuilt = ex.Message; }
                    catch (Exception ex)
                    {
                        Swallow.Note("Shell.Play, the animation and body files", ex);
                        notBuilt = "Thornswood's animation and body files could not be built (" + ex.Message.TrimEnd('.') + ").";
                    }
                });
                if (built != null) Log(built);
                if (notBuilt != null)
                {
                    Log("Not launching. " + notBuilt);
                    DrawStatus();
                    Ask.Tell(notBuilt + "\n\nThe launcher log on the Diagnostics page has each step it took.", "Thornswood", Ask.Icon.Warning);
                    return;
                }

                // The main menu with no Bethesda logo, the notice board's
                // meshes and the mods' menus with no gold values are made from
                // this machine's own game, never shipped (#2827, #3113,
                // MadeFromGame). Only what is missing or changed is
                // written; a game that cannot make them still plays, and the
                // line says why.
                try { string made = MadeFromGame.Ensure(); if (made != null) Log(made); }
                catch (Exception ex)
                {
                    Swallow.Note("Shell.Play, the files made from the game", ex);
                    Log("The files made from your game could not be written (" + ex.Message.TrimEnd('.') + ").");
                }

                if (!EnsureServer()) return;

                // Another SkyMP server's launcher may have rewritten the page
                // the front plugin loads, or the client, or dropped its own
                // plugin in beside ours. Ours go back and theirs step aside
                // until the game closes. See Keep. Last thing before the game
                // starts, so nothing that can still say no leaves them parked.
                string kept = Keep.Restore();
                if (kept != null) Log(kept);
                Keep.LeaveNote();

                // And held, read only, until the game closes. Another server's
                // launcher opened mid-session rewrote them under the game once
                // (16 Sep, 19:08); it cannot now. See Hold.
                int holding = 0;
                try { holding = Hold.Take(PresenceLog); } catch (Exception ex) { Swallow.Note("Shell.Play, dispose", ex); }
                if (holding > 0) Log("Holding " + holding + " of " + cfg.BuildName + "'s game files while the game runs, so nothing else can change them under it.");

                Log("Pointing Skyrim settings and saves at this build.");
                Swap.Apply();
                playing = true;
                MusicDecide();
                headerVideoDecide();
                GalleryDecide();
                btnPlay.IsEnabled = false;
                btnPlay.Content = "RUNNING";
                btnQuitGame.IsVisible = true;

                // Working directory must be the game root. Address Library
                // resolves Data/SKSE/Plugins/versionlib-*.bin relative to it,
                // and EngineFixes refuses to load with "failed to locate an
                // appropriate address library" when it is wrong, even though
                // the file is sitting right there.
                //
                // No --exePath any more. That existed because the old
                // multiplayer mod's own client looked Skyrim up through Steam's registry key and
                // would start the wrong copy. skse64_loader starts the exe
                // beside it, so the build it is sitting in is the one that runs.
                var psi = new ProcessStartInfo(Paths.Loader);
                psi.WorkingDirectory = Paths.Game;

                // No command line switches, and there is no arguing with this
                // one: skse64_loader parses its own arguments and refuses
                // anything it does not recognise. Handing it
                // --enable-media-stream got a message box saying "Couldn't
                // read arguments." and no game at all. It does not forward an
                // unknown switch to SkyrimSE.exe; it stops.
                //
                // Which is fine, because the thing that switch was for is now
                // compiled in. The browser is CEF 108 on the Alloy runtime and
                // SkyrimPlatform registered no permission handler, so every
                // getUserMedia call was denied before Windows saw it, with no
                // prompt to accept because there was nothing there to raise
                // one. MyChromiumApp::OnBeforeCommandLineProcessing appends
                // the switch itself now, inside the process where CEF reads
                // it, which is both the correct place and the only one that
                // was ever reachable.
                //
                // So the microphone travels in SkyrimPlatformImpl.dll, as a
                // mod file, to everybody. Nothing here has to know about it.
                psi.UseShellExecute = true;
                Process.Start(psi);
                // Which pack this game runs on, in the line everybody pastes.
                // Play is shut while a pack waits, but a feed that cannot be
                // reached frees it (Unblock), so "on the right update" was a
                // question until now and this makes it a line in the log.
                string onPack = "no pack";
                try
                {
                    var ids = new List<string>(Updater.Applied());
                    ids.Sort(StringComparer.Ordinal);
                    if (ids.Count > 0) onPack = "pack " + ids[ids.Count - 1];
                }
                catch (Exception ex) { Swallow.Note("Shell.Play", ex); }
                // The display mode rides along because Skyrim itself is known to
                // go down on alt tab in exclusive fullscreen, and a crash report
                // with no crash log needs this line to say which mode it was.
                string mode = "";
                try { mode = ", " + Display.Mode.ToLowerInvariant(); } catch (Exception ex) { Swallow.Note("Shell.Play", ex); }
                Log("Starting the game on launcher " + Updater.Version + ", " + onPack + mode + ".");

                // The site keeps a log of who played, when, and on which
                // build, so the staff console has a sheet to fill in rather
                // than a last played stamp. One id for this session, the start
                // now and the end when the game closes. Off this thread, and
                // wrapped, so a site that is down changes nothing about
                // playing. No character is picked yet: the menu does that, and
                // the end carries whoever was chosen.
                try { Discord.NewSession(); } catch (Exception ex) { Swallow.Note("Shell.Play, dispose", ex); }
                int startedAs = chosenId;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try { Discord.SessionStart(startedAs); } catch (Exception ex) { Swallow.Note("Shell.Play", ex); }
                });

                // "Playing Thornswood" in Discord, with the headcount and the
                // Download and Discord buttons, for as long as the game runs.
                // Off this thread entirely; a Discord that is not running is
                // simply nothing said.
                try { Presence.Start(cfg, PresenceLog); } catch (Exception ex) { Swallow.Note("Shell.Play", ex); }

                try { File.WriteAllText(Paths.PlayedFile, DateTime.Now.ToString("o")); } catch (Exception ex) { Swallow.Note("Shell.Play, write", ex); }
                playStartedAt = DateTime.Now;
                Stats.StartedPlaying();
                BuildStatRow();
                Thread.Sleep(1200);
                if (!cfg.KeepLauncherOpen) win.WindowState = WindowState.Minimized;
            }
            catch (Exception ex)
            {
                string reason = ex.Message == null ? "" : ex.Message;

                // The whole thing still goes to the log file, because Log
                // writes there before the bar trims anything, and the log is
                // how a report from a tester becomes something to act on.
                Log("Failed to start: " + reason);

                Swap.Restore();
                try { Hold.Release(); } catch (Exception releaseEx) { Swallow.Note("Shell.Play, Hold.Release", releaseEx); }
                try { Keep.Unpark(); } catch (Exception unparkEx) { Swallow.Note("Shell.Play, Keep.Unpark", unparkEx); }
                try { Presence.Stop(); } catch (Exception stopEx) { Swallow.Note("Shell.Play, Presence.Stop", stopEx); }
                Keep.TakeNote();
                playing = false;
                headerVideoDecide();
                GalleryDecide();
                btnPlay.Content = "PLAY";
                DrawStatus();

                // A start that failed has one job left, which is to say why in
                // a way the person can act on, and the status bar cannot do it.
                //
                // WHAT A TESTER SAW, 21 September: Swap.MoveAside could not
                // move a folder, so it threw the message it was written to
                // throw, which names the folder and then the two causes worth
                // acting on: a Skyrim or multiplayer client left over from a
                // crash, which a restart clears, and the folder sitting in
                // OneDrive, which needs moving out for good. Three lines.
                // TxtStatus is one line with TextTrimming CharacterEllipsis,
                // so they read "Failed to start: Windows would not let go of"
                // and nothing after it, and reported that it cuts off. It did.
                // Every line past the first was written for exactly the person
                // who was not shown it.
                //
                // Last, and not before the cleanup above, because this blocks
                // until it is dismissed and the folders should be back by then.
                if (reason.IndexOf('\n') >= 0)
                {
                    try
                    {
                        Ask.Tell(reason, "Thornswood could not start", Ask.Icon.Warning);
                    }
                    catch (Exception boxEx) { Swallow.Note("Shell.Play, start failed box", boxEx); }
                }
            }
        }
    }
}
