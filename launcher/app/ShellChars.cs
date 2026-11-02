using System;
using System.Collections.Generic;
using System.Threading;
using Avalonia.Threading;

namespace Thornswood
{
    // The character start path and the poll that reads who was picked at
    // the game's menu. They live apart from Shell.cs because they are one
    // self-contained slice (the old character-card block), and Shell.cs
    // was long enough (#500).
    static partial class Shell
    {
        // ------------------------------------------------------------- characters
        //
        // Until 20 September this was the character picker: NameOf, SlotName,
        // StartAs(slot, fresh), ForgetChar, DescribeChar, RefreshRoster and
        // BuildChars drew two slot cards under Play, each with its own Play or
        // Make a character button and a Delete. The person picks at the game's
        // own main menu now, from a list Chars.Prepare writes into
        // Data\Platform, and the plugin writes the answer to a file the two
        // second tick reads. Nothing here draws a character any more.

        // A Discord check is out and the game starts on its answer. Only
        // btnPlay was ever switched off while it was, and the slot cards sat
        // on their own bar: two presses on a slot's Play sent two checks, both
        // came back allowed, and the second start found the first Skyrim
        // already up, closed it as a stuck one, and started again. The cards
        // are gone; the flag stays, because a press that lands while the site
        // is still thinking is the same race.
        static bool doorCheckOut = false;

        /// <summary>
        /// Play, from the button. Door.Check first, exactly as StartAs did,
        /// then Chars.Prepare, then a check in with the site for every id this
        /// install could pick, then Play().
        /// </summary>
        static void StartPlay()
        {
            // Before anything else, including Discord: a shared Skyrim is not
            // an install this supports any more. OwnGameRequired says why and
            // offers the folder when it can be made. See ShellOwnGame.cs.
            if (!OwnGameRequired()) return;
            // The same bring-up-to-date Fix runs on Diagnostics. Play
            // used to walk past a folder that NeededRefresh and launch it.
            if (OwnGameRefreshIfDue()) return;

            // Discord decides who gets in, and it is asked here rather than
            // inside Play() because Play() is also the path a game already
            // running comes back through. Asked off the UI thread: the site can
            // take up to fifteen seconds to answer on a bad connection and a
            // frozen launcher looks like a crash.
            if (!Door.RecentlyCleared)
            {
                if (doorCheckOut) { Log("Still asking Discord. One moment."); return; }
                doorCheckOut = true;
                btnPlay.IsEnabled = false;
                Door.Check(Log,
                    delegate (Standing st)
                    {
                        // Whatever it said, do not hold on to it. A refusal for
                        // a missing role is the one answer most likely to be
                        // wrong thirty seconds later, because somebody is
                        // usually giving them the role while they read it.
                        Door.Forget();
                        Door.Explain(st, delegate { ShowPage(PagePlay); });
                    },
                    // Cleared before the start, because this goes straight back
                    // into StartPlay and the whole launch runs inside that call.
                    // Door holds the yes for a few minutes, so the second pass
                    // takes the path below rather than sending another check.
                    delegate { doorCheckOut = false; StartPlay(); },
                    delegate
                    {
                        doorCheckOut = false;
                        btnPlay.IsEnabled = true;
                        RefreshDiscord();
                        DrawStatus();
                        DrawServerPick();
                    });
                return;
            }

            // A Skyrim somebody started by hand after the launcher opened is
            // not 'playing' to this window, and Prepare below rewrites the
            // client settings, which SkyrimPlatform answers with a reload of
            // every plugin in the running game. So a running game goes the
            // way a running game always went, through Play() and its own
            // checks, and nothing under Data is touched first.
            if (Checks.GameRunning()) { Play(); return; }

            // The save folder, the client settings, the menu's character list
            // and voice. Off the window's thread under the wait cursor, because
            // it asks the server for the roster on the way and that is up to
            // two and a half seconds of nothing drawing otherwise. A throw
            // here is the settings file or the list refusing to be written,
            // and the game is not started on either.
            string saveNote = null;
            try
            {
                Waiting(delegate { saveNote = Chars.Prepare(cfg); });
            }
            catch (Exception ex) { Log(ex.Message); return; }
            if (saveNote != null) Log(saveNote);
            RecordBrowserBackend();

            // The Discord check above went out carrying the id the settings
            // file held, which is one of several now. Check in again for every
            // id this install could pick at the menu, characters and spare,
            // so the site's allowed list carries them all before anybody logs
            // in: the site keeps the ids against the account and the game
            // server's door reads that list. In the background, and a failure
            // is a line in the log and nothing more; the game still starts.
            List<int> ids = Chars.KnownIds();
            ThreadPool.QueueUserWorkItem(delegate
            {
                // Stop at the first id the site could not be reached for.
                // It is reachable for all of them or for none, so carrying on
                // only repeats one sentence once per character.
                foreach (int id in ids) { if (!CheckIn(id)) break; }
            });

            chosenId = 0;
            // The last session's join pass is not this one's (#937).
            JoinPass.Forget();
            Log("Starting. You pick your character at the game's main menu.");
            Play();
        }

        /// <summary>
        /// Which in game browser this Play left SkyrimPlatform.ini naming,
        /// written down where a report can quote it. Chars.WriteBrowserBackend
        /// decides from the game folder on every Play and used to tell nobody,
        /// so a report about the interface could not say which one was
        /// running. Now launcher.log gets a line on every Play, config.json
        /// keeps the answer across a restart, and the Settings page shows it.
        /// The deciding itself is untouched.
        /// </summary>
        static void RecordBrowserBackend()
        {
            string backend = Chars.BrowserBackend;
            LogOnly(backend != null
                ? "In-game browser: " + backend
                : "In-game browser: not known, SkyrimPlatform.ini is missing or could not be read or written");
            string keep = backend ?? "";
            if (keep != (cfg.BrowserBackend ?? ""))
            {
                cfg.BrowserBackend = keep;
                cfg.Save(Paths.CfgFile);
            }
            DrawInGameBrowser();
        }

        /// <summary>
        /// The line under Folders on the Settings page, worded so a tester can
        /// read it straight back: "In-game browser: tilted".
        /// </summary>
        static void DrawInGameBrowser()
        {
            var line = win != null ? win.TxtInGameBrowser : null;
            if (line == null || cfg == null) return;
            string b = cfg.BrowserBackend;
            line.Text = string.IsNullOrEmpty(b)
                ? "In-game browser: not known yet. The launcher settles it each time you press Play."
                : "In-game browser: " + b;
        }

        /// <summary>
        /// One check in with the site for one id, from a pool thread. What
        /// went wrong goes to the log; nothing here stops anything.
        ///
        /// False means the site could not be reached at all, which is true of
        /// every id or none of them, so a caller working through a list stops
        /// rather than saying the same thing once per character.
        /// </summary>
        static bool CheckIn(int id)
        {
            try
            {
                Standing st = Discord.Join(id);
                // PresenceLog and not Log, and the difference is the whole bug.
                //
                // This runs on a pool thread. Log writes txtStatus.Text
                // straight, which is a control, so off the window's thread it
                // throws (WPF said "The calling thread cannot access this
                // object because a different thread owns it"; Avalonia says
                // "Call from invalid thread"). PresenceLog is the same line put
                // through the window's dispatcher, which is why the other two
                // calls below use it.
                //
                // WHAT A PLAYTESTER SAW, 21 September: the throw landed in the
                // catch below, and the catch reports with PresenceLog, which
                // works. So the status bar read "Could not check profile
                // 1893288986 in with thornswood.net: The calling thread cannot
                // access this object because a different thread owns it" on a
                // check in that had SUCCEEDED. st.Ok was true and the site had
                // said yes. The launcher was telling somebody it had failed to
                // do the thing it had just done.
                if (st.Ok)
                {
                    PresenceLog("checked character " + id + " in with thornswood.net");
                    try
                    {
                        Dispatcher.UIThread.Post(delegate
                        {
                            try { LoadDiscordAvatar(); }
                            catch (Exception ex) { Swallow.Note("Shell.CheckIn", ex); }
                        });
                    }
                    catch (Exception ex) { Swallow.Note("Shell.CheckIn", ex); }
                    return true;
                }

                // The site not answering is not the site saying no, and it
                // used to be reported as though it were.
                //
                // Discord.Join returns why "offline" when PostJson gets
                // nothing back at all. Run through the prefix below that came
                // out as "Could not check profile 1893288986 in with
                // thornswood.net: Could not reach thornswood.net to check you
                // in.", which names the site twice, reads like a refusal, and
                // was read as one by a tester on 21 September. It is neither:
                // checking in is done off the window's thread precisely so a
                // site that is down changes nothing, and the game starts
                // either way. Say that, once, and let the caller stop.
                if (st.Why == "offline")
                {
                    // Which character, and what the request ran into, so a
                    // failed check in names its own cause (22 Oct: two on dev
                    // logged only "not answering" while the site was up).
                    PresenceLog("thornswood.net is not answering, so your characters were not " +
                                "checked in. The game still starts. (character " + id +
                                (st.NetFailure.Length > 0 ? ": " + st.NetFailure : "") + ")");
                    return false;
                }

                string why = st.Message != null && st.Message.Length > 0 ? st.Message : st.Why;
                PresenceLog("Could not check profile " + id + " in with thornswood.net: " + why);
            }
            catch (Exception ex)
            {
                PresenceLog("Could not check profile " + id + " in with thornswood.net: " + ex.Message);
            }
            return true;
        }

        /// <summary>
        /// Who the person picked at the game's menu, while the game runs.
        ///
        /// The plugin writes Data\Platform\thornswood-choice.txt when they
        /// pick, and the two second tick reads it. Each new id is written down
        /// (Chars.Chose), voice and the site are told, a join pass is fetched
        /// for it (JoinPass, #937), and the id is kept for the play time count
        /// at close. The settings file is never touched
        /// here: a write to it hot reloads every plugin under the running game.
        /// </summary>
        static readonly HashSet<int> forgotten = new HashSet<int>();

        static void PollChoice()
        {
            // The delete icon at the menu. Each id once, whatever the file says
            // on later ticks; the file itself goes at the next Prepare.
            List<int> gone = null;
            try { gone = Chars.ReadForgets(); } catch { gone = null; }
            if (gone != null)
            {
                foreach (int g in gone)
                {
                    if (!forgotten.Add(g)) continue;
                    try { Chars.Forget(g); Log("forgot character " + g + " at the menu"); }
                    catch (Exception ex) { Log("Could not forget character " + g + ": " + ex.Message); }
                    // The menu can come back in this same session now
                    // (Change character, #3128), and its list is the file.
                    ThreadPool.QueueUserWorkItem(delegate { Chars.Relist(cfg); });
                }
            }

            // The join pass for the character picked, renewed while the game
            // runs; nothing happens until one is picked (#937).
            JoinPass.Tick(PresenceLog);

            int id = 0;
            try { id = Chars.ReadChoice(); } catch { id = 0; }
            if (id <= 0 || id == chosenId) return;
            // Change character (#3128): the one played until now gets its
            // own time, and the count starts again for this one.
            if (chosenId > 0)
            {
                try { Chars.AddPlaytime(chosenId, DateTime.Now - PlayCountedFrom()); } catch (Exception ex) { Swallow.Note("Shell.PollChoice, playtime", ex); }
                choseAt = DateTime.Now;
            }
            chosenId = id;
            JoinPass.For(id, PresenceLog);
            int spareWas = 0;
            try { spareWas = Chars.SpareId(); } catch (Exception ex) { Swallow.Note("Shell.PollChoice, spare", ex); }
            try { Chars.Chose(id); }
            catch (Exception ex) { Log("Could not write that choice down: " + ex.Message); }
            int spareNow = 0;
            try { spareNow = Chars.SpareId(); } catch (Exception ex) { Swallow.Note("Shell.PollChoice, spare", ex); }
            Log("chose character " + id);
            ThreadPool.QueueUserWorkItem(delegate
            {
                try { Voice.Reconfigure(id); } catch (Exception ex) { Swallow.Note("Shell.PollChoice, voice", ex); }
                // A New character pick minted the next spare, which the site
                // has never heard of. Play checks every id in before the menu
                // shows, and Change character brings the menu back without a
                // Play, so this one is checked in now (#3128).
                if (CheckIn(id) && spareNow > 0 && spareNow != spareWas) CheckIn(spareNow);
                Chars.Relist(cfg);
            });
        }

        // When the character played now was picked, for its play time; the
        // game's start for the first pick of a Play (#3128).
        static DateTime choseAt = DateTime.MinValue;

        static DateTime PlayCountedFrom()
        {
            return choseAt > playStartedAt ? choseAt : playStartedAt;
        }

    }
}
