using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// Gets 1.6.1170, the build the server runs, for Thornswood's own game
    /// folder, from one button and with nothing to paste. The Steam copy of
    /// Skyrim is never written (#1218): it is the person's, on whatever build
    /// they like. Before Thornswood has a folder of its own the downloaded
    /// files are what the folder is made from (OwnGame.Make); after, they go
    /// into that folder (OwnGame.TakePinned).
    ///
    /// Steam will hand over any build's files to somebody who owns the game,
    /// through the console command "download_depot", but only from its own
    /// console: there is no URL or command line for it. So this opens that
    /// console (steam://open/console), makes sure Steam's window is the one
    /// in front, types the command into it the way a person would, and then
    /// watches Steam's console_log.txt for "Depot download complete" (see
    /// SteamLog for why that file). Three depots make up the game; they go
    /// one at a time, as Steam wants. When all three are down, the downloaded
    /// exe is checked against the size 1.6.1170 has before anything is
    /// replaced, the files are copied into Thornswood's own folder, the exe
    /// there is checked again, and the downloaded copies are removed so eleven
    /// gigabytes do not stay behind. With no folder of its own yet they stay
    /// until Make has taken them.
    ///
    /// Nothing is typed unless Steam's window is confirmed to be the one in
    /// the foreground. If it cannot be brought there, the command goes on the
    /// clipboard and the log says where to paste it, and the watching carries
    /// on all the same.
    ///
    /// The earlier install shape did this from Setup-Thornswood.ps1 with the
    /// person pasting the three lines. The site tells people to pick the build
    /// in Steam's Betas list; a tester asked for a button instead, for people
    /// who are not at home in Steam's settings. This is that button.
    /// </summary>
    static partial class Downgrade
    {
        const int AppId = 489830;

        // How long nothing may happen before this stops waiting. Measured from
        // the last time the download folder grew, not from the start, so a slow
        // line is never cut off: any progress at all resets it. See the loop
        // below for why a deadline is needed at all.
        const int GiveUpMinutes = 25;
        // ---- THE COMPILED FALLBACK (#471) ----
        // The pin comes from the update feed: version.json carries
        // expectedExeBytes, newerExeBytes and depots, written by Publish-Update
        // from records\skyrim-pin.json, and AdoptPin keeps them in config.json.
        // What follows is only for a launcher that has never had them from the
        // feed. The same numbers are in records\skyrim-pin.json,
        // Config.ExpectedExeBytes and Setup-Thornswood.ps1, and
        // launcher\tests\test-skyrim-pin.ps1 fails when any of them disagree.
        //
        // Depot id -> the manifest of that depot at 1.6.1170.
        static readonly string[][] FallbackDepots = {
            new[] { "489831", "8442952117333549665" },
            new[] { "489832", "8042843504692938467" },
            new[] { "489833", "1914580699073641964" },
        };
        /// <summary>SkyrimSE.exe at 1.7.104, the Steam build we never want.</summary>
        public const long NewerExeBytes = 37910440;
        // ---- end of the compiled fallback ----

        // The depots this run asks Steam for. Run sets it from PinnedDepots.
        static string[][] Depots = FallbackDepots;

        // How many stretches the bar under the button is divided into: one for
        // each of the three downloads, then one for the copy into the game.
        //
        // The downloads used to have the whole bar to themselves, so it filled
        // to the end when the last part came down and then started again at
        // nothing for the copy. Somebody watching it saw a finished job undone.
        // Four stretches means the downloads take it to three quarters and the
        // copy takes it the rest of the way, which is what the bar is for.
        static readonly int Stages = Depots.Length + 1;

        // The processes whose windows are Steam's. Only "steam" was looked for
        // until 24 September, and a tester on 1.1.91 got every part on the
        // clipboard with Steam's console open behind the launcher: "its not
        // going into the console by itself its going to your clipboard"
        // (Patrick). Measured on Patrick's machine that day, with Steam in the
        // tray: Steam's main window (class SDL_app, titled "Steam", 2308 x 927)
        // belongs to steamwebhelper.exe, and steam.exe owns three small popups,
        // none bigger than 149 x 77, so a window that is really Steam's never
        // counted as Steam in front.
        // steamwebhelper is Steam's own and nothing else ships one.
        static readonly string[] SteamNames = { "steam", "steamwebhelper" };

        // The last window the log named as Steam's, so it is said once a run
        // and again only if a different one is found.
        static string saidWindow;

        static Thread worker;
        // Cleared before done is called, not when the thread ends, so what done
        // starts (Thornswood's own folder brought up to date) does not find the
        // downgrade still busy.
        static volatile bool running;
        public static bool Busy { get { return running; } }

        /// <summary>
        /// The game Thornswood runs is not 1.6.1170 and nothing on this machine
        /// puts it right but a download. In Thornswood's own folder: its exe is
        /// another build, or archives it shared with the Steam copy were
        /// written over there (OwnGame.Changed). Before the folder is made: the
        /// Steam copy's listed files are not all the pinned build's, and
        /// 1.6.1170's own files are not downloaded yet.
        ///
        /// Until #1218 this also came up, as SourceNeeded, whenever the Steam
        /// copy alone had moved on, and the folder would not follow Vortex until
        /// the Steam copy was downgraded. A made folder does not read the Steam
        /// copy's game any more, so a Steam update costs it nothing.
        /// </summary>
        public static bool Needed(Config cfg)
        {
            // Before the folder exists it is the Steam copy's build that counts,
            // because that is what Make takes the game from. Paths.Exe is not
            // it when the folder was chosen at install: Game is Profile\Payload
            // until the folder is made (#1226).
            if (Paths.Collection) return OwnGame.SteamCopyNotPinned(cfg) && Downloaded(cfg) == null;
            return Wrong(cfg, Paths.Exe) || (OwnGame.Active && OwnGame.Changed().Count > 0);
        }

        /// <summary>
        /// The three folders Steam downloaded 1.6.1170's own files into, when
        /// every one is complete for the pinned manifest (MarkerIs) and the exe
        /// among them is 1.6.1170's size. Null otherwise. OwnGame.Make makes
        /// the folder from these when the Steam copy is on another build.
        /// </summary>
        public static List<string> Downloaded(Config cfg)
        {
            try
            {
                string steam = Steam.Path_();
                if (string.IsNullOrEmpty(steam)) return null;
                string content = Path.Combine(steam, "steamapps\\content\\app_" + AppId);
                var all = new List<string>();
                string exe = "";
                foreach (string[] d in PinnedDepots(cfg))
                {
                    string folder = Path.Combine(content, "depot_" + d[0]);
                    if (!Directory.Exists(folder) || !MarkerIs(folder, d[1])) return null;
                    all.Add(folder);
                    if (exe.Length == 0 && File.Exists(Path.Combine(folder, "SkyrimSE.exe"))) exe = Path.Combine(folder, "SkyrimSE.exe");
                }
                if (exe.Length == 0 || Wrong(cfg, exe)) return null;
                return all;
            }
            catch (Exception ex) { Swallow.Note("Downgrade.Downloaded", ex); return null; }
        }

        /// <summary>The downloaded copies go once their files are in Thornswood's folder, so eleven gigabytes do not stay behind.</summary>
        public static void ClearDownloads(Config cfg, Action<string> say)
        {
            string steam = "";
            try { steam = Steam.Path_() ?? ""; } catch (Exception ex) { Swallow.Note("Downgrade.ClearDownloads, finding Steam", ex); }
            if (steam.Length == 0) return;
            string content = Path.Combine(steam, "steamapps\\content\\app_" + AppId);
            long freed = 0;
            foreach (string[] d in PinnedDepots(cfg))
            {
                string folder = Path.Combine(content, "depot_" + d[0]);
                try { if (Directory.Exists(folder)) { freed += FolderSize(folder); Directory.Delete(folder, true); } }
                catch (Exception ex) { Swallow.Note("Downgrade.ClearDownloads, deleting " + folder, ex); }
            }
            try { if (Directory.Exists(content) && Directory.GetFileSystemEntries(content).Length == 0) Directory.Delete(content); } catch (Exception ex) { Swallow.Note("Downgrade.ClearDownloads, deleting empty content folder", ex); }
            if (freed > 0 && say != null) say((freed / 1048576).ToString("n0") + " MB of downloaded copies removed from Steam's download folder.");
        }

        static bool SameFolder(string a, string b)
        {
            try { return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        static bool Wrong(Config cfg, string exe)
        {
            try
            {
                if (!File.Exists(exe)) return false;
                return new FileInfo(exe).Length != cfg.ExpectedExeBytes;
            }
            catch { return false; }
        }

        /// <summary>
        /// What the check row should say about the build. Of Paths.SkyrimExe,
        /// the Steam copy's while the own folder is chosen and not made, which
        /// is the build Needed asks about then: Paths.Exe is under
        /// Profile\Payload and said "missing" (#1235).
        /// </summary>
        public static string Describe(Config cfg) { return Describe(cfg, Paths.SkyrimExe); }

        public static string Describe(Config cfg, string exe)
        {
            try
            {
                if (!File.Exists(exe)) return "missing";
                long n = new FileInfo(exe).Length;
                if (n == cfg.ExpectedExeBytes) return "1.6.1170";
                if (n == Newer(cfg)) return "1.7.104, the server runs 1.6.1170";
                return "not 1.6.1170";
            }
            catch { return "unknown"; }
        }

        /// <summary>
        /// The three lines typed into Steam's console, in the order they are
        /// typed. The Downgrade button shows these before anything starts, and
        /// Run types the same strings, so the question cannot name one command
        /// and the keyboard send another.
        /// </summary>
        public static string[] Commands(Config cfg)
        {
            string[][] depots = PinnedDepots(cfg);
            var all = new string[depots.Length];
            for (int i = 0; i < depots.Length; i++) all[i] = Command(depots[i]);
            return all;
        }

        /// <summary>
        /// The depots to ask Steam for: the ones the feed sent, kept in
        /// config.json, or the compiled fallback when it has sent none that
        /// can be used.
        /// </summary>
        static string[][] PinnedDepots(Config cfg)
        {
            if (cfg == null || !Usable(cfg.SkyrimDepots)) return FallbackDepots;
            var all = new string[cfg.SkyrimDepots.Length][];
            for (int i = 0; i < all.Length; i++) all[i] = new[] { cfg.SkyrimDepots[i].id, cfg.SkyrimDepots[i].manifest };
            return all;
        }

        /// <summary>The newer build's exe size, from the feed or the fallback.</summary>
        static long Newer(Config cfg)
        {
            return cfg != null && cfg.NewerExeBytes > 0 ? cfg.NewerExeBytes : NewerExeBytes;
        }

        /// <summary>
        /// A depot list worth using: as many parts as the fallback, because the
        /// card, the bar and every "Part 2 of 3" are built on that many, and each
        /// one an id and a manifest in digits. Anything else is ignored whole,
        /// never half used.
        /// </summary>
        static bool Usable(PinDepot[] d)
        {
            if (d == null || d.Length != FallbackDepots.Length) return false;
            foreach (PinDepot p in d)
                if (p == null || !AllDigits(p.id) || !AllDigits(p.manifest)) return false;
            return true;
        }

        static bool AllDigits(string s)
        {
            if (string.IsNullOrEmpty(s) || s.Length > 20) return false;
            foreach (char c in s) if (c < '0' || c > '9') return false;
            return true;
        }

        /// <summary>A size from the feed, or 0 when it is not a plain number.</summary>
        static long FeedBytes(string s)
        {
            long n;
            return AllDigits(s) && long.TryParse(s, out n) ? n : 0;
        }

        /// <summary>
        /// Takes the Skyrim pin from a version document into cfg (#471). Only
        /// what the feed carries is taken: a size that is not a number above 0
        /// and a missing or unusable depot list leave cfg as it is, so a feed
        /// written before these fields changes nothing. True when anything
        /// moved; the caller saves.
        /// </summary>
        public static bool AdoptPin(Config cfg, VersionDoc v)
        {
            if (cfg == null || v == null) return false;
            bool moved = false;
            long exe = FeedBytes(v.expectedExeBytes), newer = FeedBytes(v.newerExeBytes);
            if (exe > 0 && exe != cfg.ExpectedExeBytes) { cfg.ExpectedExeBytes = exe; moved = true; }
            if (newer > 0 && newer != cfg.NewerExeBytes) { cfg.NewerExeBytes = newer; moved = true; }
            if (Usable(v.depots))
            {
                bool same = cfg.SkyrimDepots != null && cfg.SkyrimDepots.Length == v.depots.Length;
                for (int i = 0; same && i < v.depots.Length; i++)
                    same = cfg.SkyrimDepots[i] != null && cfg.SkyrimDepots[i].id == v.depots[i].id && cfg.SkyrimDepots[i].manifest == v.depots[i].manifest;
                if (!same)
                {
                    var copy = new PinDepot[v.depots.Length];
                    for (int i = 0; i < copy.Length; i++) copy[i] = new PinDepot { id = v.depots[i].id, manifest = v.depots[i].manifest };
                    cfg.SkyrimDepots = copy;
                    moved = true;
                }
            }
            return moved;
        }

        static string Command(string[] depot)
        {
            return "download_depot " + AppId + " " + depot[0] + " " + depot[1];
        }

        /// <summary>
        /// Runs the whole thing on its own thread. <paramref name="log"/> goes
        /// to the launcher log, <paramref name="status"/> to the one line under
        /// the button, <paramref name="done"/> fires at the end either way with
        /// true when the exe is now 1.6.1170. All three may be called from the
        /// worker thread.
        /// </summary>
        public static void Start(Config cfg, Action<string> log, Action<string> status, Action<bool> done)
        {
            if (Busy) return;
            running = true;
            worker = new Thread(delegate ()
            {
                bool ok = false;
                try { ok = Run(cfg, log, status); }
                catch (Exception ex) { Stop("The downgrade stopped: " + ex.Message, log, status); }
                finally { running = false; }
                try { done(ok); } catch (Exception ex) { Swallow.Note("Downgrade.Start, done callback", ex); }
            });
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.STA);   // the clipboard fallback needs it
            try { worker.Start(); }
            catch { running = false; throw; }
        }

        /// <summary>
        /// The bar on the Downgrade card, set by Shell before Start: 0 to 100,
        /// -1 hides it, and -2 is a bar that moves without a number, for the
        /// stretches with nothing to measure against. Another server's launcher shows
        /// one, and a line of megabytes that nobody knows the end of is not
        /// the same thing (Patrick, 24 September).
        /// </summary>
        public static Action<int> OnProgress;

        static void Progress(int percent)
        {
            Action<int> p = OnProgress;
            if (p == null) return;
            try { p(percent); }
            catch (Exception ex) { Swallow.Note("Downgrade.Progress", ex); }
        }

        /// <summary>
        /// Stops the run and says why in both places. Until 24 September every
        /// early stop went to the launcher log alone, so the line under the
        /// button kept the words it had and pressing Downgrade looked like
        /// nothing at all: a tester on 1.1.94, "the dowgrader this time didnt
        /// even upon the steam console let alone put the commands in for you".
        /// </summary>
        static bool Stop(string why, Action<string> log, Action<string> status)
        {
            log(why);
            status(why);
            Progress(-1);
            return false;
        }

        static bool Run(Config cfg, Action<string> log, Action<string> status)
        {
            // The bar is up from the first moment, moving without a number.
            // Opening Steam, signing in and getting the console to take the
            // first command can take three or four minutes between them, and
            // until now the bar appeared only once bytes started landing, so
            // the longest wait in the whole run was the one with nothing on
            // screen moving. Every early stop hides it again through Stop.
            Progress(-2);
            // The same depots Commands showed in the question.
            Depots = PinnedDepots(cfg);
            string steam = Steam.Path_();
            if (string.IsNullOrEmpty(steam) || !Directory.Exists(steam))
                return Stop("Could not find where Steam is installed, so Steam cannot be asked for the files. Open Steam once, then press the button again.", log, status);
            string content = Path.Combine(steam, "steamapps\\content\\app_" + AppId);

            if (Checks.GameRunning())
                return Stop("Skyrim is running. Close it, then press the button again.", log, status);

            // Where the files go: the folder the game runs from, Thornswood's
            // own. Before that folder exists nothing is written anywhere: the
            // Steam copy is never written (#1218) and the download is kept for
            // OwnGame.Make instead, so target is only the Steam copy the
            // sentences name. Not Paths.Game, which is Profile\Payload when
            // the folder was chosen at install (#1226).
            bool first = Paths.Collection;
            string target = first ? Paths.SteamCopy : Paths.Game;
            string targetExe = Path.Combine(target, "SkyrimSE.exe");
            if (first && Downloaded(cfg) != null)
            {
                // Steam is not asked for anything here, and the line under
                // the button has to say so, or it reads as a button that did
                // nothing.
                log("1.6.1170's own files are already downloaded, so nothing needs downloading. Thornswood's own folder is made from them next; the Steam copy in " + target + " is not changed.");
                status("1.6.1170's files are already downloaded. Thornswood's own folder is made from them next.");
                Progress(-2);
                return true;
            }
            if (first)
                log("Skyrim in " + target + " is " + Describe(cfg, targetExe) + ". That copy is yours and stays as it is: Steam downloads 1.6.1170's own files, and Thornswood makes its own folder from them.");

            log("Getting Skyrim 1.6.1170. Steam downloads the build's files under your own account; nothing is touched until all three parts are down.");
            saidWindow = null;
            status("Opening Steam...");
            if (!WaitForSteam(log, status)) return false;

            for (int i = 0; i < Depots.Length; i++)
            {
                string depot = Depots[i][0], manifest = Depots[i][1];
                string folder = Path.Combine(content, "depot_" + depot);
                string cmd = Command(Depots[i]);

                // The marker holds the manifest it was written for, and only
                // that manifest counts as this build being down. A folder left
                // by an attempt at another build is full of the wrong files,
                // and skipping the depot on one of those copies them over the
                // game as if they were 1.6.1170.
                if (Directory.Exists(folder) && MarkerIs(folder, manifest))
                {
                    log("Part " + (i + 1) + " of 3 (depot " + depot + ") is already downloaded.");
                    status("Part " + (i + 1) + " of 3 was already downloaded, so Steam is not asked for it again.");
                    Progress((i + 1) * 100 / Stages);
                    continue;
                }
                if (!ClearLeftover(folder, i + 1, log, status)) return false;

                SteamLog steamLog = new SteamLog(steam);
                bool hadFolder = Directory.Exists(folder);

                // Nothing to measure while Steam's window is being brought
                // forward and the command typed, so the bar moves without a
                // number rather than sitting at whatever the last part left it.
                Progress(-2);
                status("Part " + (i + 1) + " of 3: asking Steam for depot " + depot + "...");
                log("Part " + (i + 1) + " of 3, depot " + depot + ": " + cmd);
                bool typed = TypeIntoConsole(cmd, log);
                bool pasted = !typed;
                if (!typed)
                    OnClipboard(cmd, i + 1, "Steam's window would not come to the front (the window in front belongs to " + InFront() + "), so nothing was typed. ", log, status);

                // Steam makes the depot folder within seconds of taking the
                // command. No folder after a while means it did not take.
                //
                // The folder and the log are kept apart from here on. A folder
                // an aborted attempt left behind would be there before Steam had
                // been asked anything and prove nothing, which is why
                // ClearLeftover removes it above; hadFolder stays as the guard
                // should one ever get through. The log is proof, and so is a
                // folder that was not there before the command and is now; the
                // fallback below needs one of them.
                DateTime askedAt = DateTime.Now;
                bool started = false;
                bool sawStart = false;
                while ((DateTime.Now - askedAt).TotalSeconds < 45)
                {
                    string said = steamLog.Since();
                    if (Refused(said, depot, i + 1, cmd, log, status)) return false;
                    if (LogStarted(said, depot) || (!hadFolder && Directory.Exists(folder))) sawStart = true;
                    if (Directory.Exists(folder) || sawStart) { started = true; break; }
                    Thread.Sleep(1000);
                }
                // Nothing has reached Steam. Bring the console back and try the
                // command line once more.
                //
                // This used to run only when the first attempt had typed. The
                // attempt that fails is the one made while the person is in
                // another window, which is every part after the first: they
                // press Downgrade, part 1 goes in with the launcher in front,
                // and twenty minutes later part 2 is asked for with a browser
                // or a game over the top. That is exactly the case that used to
                // go straight to the clipboard and sit there, and a second go
                // at the console is what it needed. So the retry happens either
                // way, and the clipboard is what is left after it.
                if (!started)
                {
                    // Typed into the wrong place, most likely a console whose
                    // command line did not have the focus, or into no console
                    // at all because Steam's window would not come forward.
                    log("Steam has not started the download. Trying the console's command line once more.");
                    FocusConsole(log);
                    Thread.Sleep(400);
                    // Nothing is typed a second time if Steam took a command
                    // while the console was being brought back. On the fallback
                    // path the command is on the person's clipboard and they
                    // may have pasted it themselves in the meantime, and a
                    // pasted download_depot and a typed one would both run.
                    string sinceCmd = steamLog.Since();
                    if (Refused(sinceCmd, depot, i + 1, cmd, log, status)) return false;
                    if (LogStarted(sinceCmd, depot) || Directory.Exists(folder)) { sawStart = true; started = true; }
                    if (!started)
                    {
                        typed = TypeIntoConsole(cmd, log);
                        askedAt = DateTime.Now;
                        while ((DateTime.Now - askedAt).TotalSeconds < 30)
                        {
                            string said = steamLog.Since();
                            if (Refused(said, depot, i + 1, cmd, log, status)) return false;
                            if (LogStarted(said, depot) || (!hadFolder && Directory.Exists(folder))) sawStart = true;
                            if (Directory.Exists(folder) || sawStart) { started = true; break; }
                            Thread.Sleep(1000);
                        }
                    }
                    if (!started)
                    {
                        // Whatever Steam put in its logs since the command. A
                        // real refusal ("No connection", a manifest error) shows
                        // here; nothing here means the command never reached
                        // the console's command line at all.
                        string tail = steamLog.Tail(12);
                        if (tail.Length > 0) log("Steam's log since the command:" + Environment.NewLine + tail);
                        else log("Steam wrote nothing to its logs, so the command did not reach the console's command line. Steam's console has to be the window in front with its command line clicked.");
                        // Said once. A part whose first attempt already fell
                        // back has the command on the clipboard and the card
                        // already says where to paste it.
                        if (!pasted)
                        {
                            OnClipboard(cmd, i + 1, "", log, status);
                            pasted = true;
                        }
                    }
                }

                // Wait for "Depot download complete" for this depot. Progress
                // is the size of the folder Steam is filling.
                long lastSize = -1;
                long total = 0;
                DateTime lastGrowth = DateTime.Now;
                bool warned = false;
                string downloading = Path.Combine(steam, "steamapps\\downloading\\" + AppId);
                while (true)
                {
                    string said = steamLog.Since();
                    if (LogHasCompletion(said, depot)) break;
                    if (Refused(said, depot, i + 1, cmd, log, status)) return false;
                    long size = FolderSize(folder);
                    if (size != lastSize) { lastSize = size; lastGrowth = DateTime.Now; warned = false; }
                    // Steam says how big the part is when it starts it; until
                    // then the bar moves without a number.
                    if (total <= 0) total = DepotBytes(said, depot);
                    status(SizedLine(i + 1, Depots.Length, size, total, pasted));
                    Progress(total > 0 ? Percent(i, Stages, size, total) : -2);
                    double quiet = (DateTime.Now - lastGrowth).TotalMinutes;
                    if (!warned && quiet > 10)
                    {
                        warned = true;
                        log("Steam has not written anything for ten minutes. Check that Steam is still open and signed in; the download carries on where it left off.");
                    }
                    // Steam's log has always said "Depot download complete" so
                    // far. If a Steam build stops saying it, a folder that has
                    // reached the size Steam announced for this part and been
                    // still for a long while, with nothing left in Steam's
                    // downloading folder, is the next best proof.
                    //
                    // Only at the announced size, and only for a download this
                    // run started. A folder an aborted run left half written is
                    // also still, and a part Steam stopped writing to part way is
                    // still too; taking either as done writes the marker and
                    // copies truncated files into the game, after which
                    // every later attempt skips the depot as already downloaded.
                    // Steam gives the size when it starts the part (total, from
                    // DepotBytes), so a folder short of it is a stall, not a
                    // finish, and the deadline below gives up rather than trust
                    // it. See #369 F4.
                    if (size > 0 && quiet > 20 && !Directory.Exists(downloading))
                    {
                        if (!sawStart && LogStarted(said, depot)) sawStart = true;
                        if (sawStart && total > 0 && size >= total)
                        {
                            log("Steam's log never said the download finished, but the folder has reached the " + (total / 1048576).ToString("n0") + " MB Steam announced for this part and been still for twenty minutes, so it is taken as done.");
                            break;
                        }
                        if (!sawStart)
                            return Stop("Steam never started this download, and " + folder + " is left over from an earlier attempt, so what is in it cannot be trusted. Delete that folder, then press the button again.", log, status);
                    }

                    /*
                      AND A DEADLINE, BECAUSE THIS USED TO BE while(true) WITH
                      NO WAY OUT.

                      Every exit above needs something to have happened: the
                      log saying the download finished, or the folder being
                      non-empty and still. Steam refusing outright satisfies
                      neither. It writes its refusal to its own console, this
                      folder never appears, size stays at zero, and the loop
                      carries on at two seconds a turn for ever behind a
                      progress line that will never move. There is nothing on
                      screen that says so, and nothing a person watching it
                      could do but guess.

                      So: nothing has changed for GiveUpMinutes, stop and say
                      which outside thing did not answer, and leave the manual
                      path on screen. Measured against progress rather than
                      against the clock from the start, so a genuinely slow
                      download on a slow line is never cut off: the folder
                      growing at all resets it.
                    */
                    if (quiet > GiveUpMinutes)
                    {
                        if (size == 0)
                            log("Nothing was downloaded at all, which usually means Steam refused the command. Its console window says why: look for a line about a manifest, a licence or no connection.");
                        log(ByHand(cmd));
                        // The card says the whole of it, not "see the log". The
                        // launcher log is a file somebody has to know about,
                        // find and open, and this line is the one they are
                        // already looking at.
                        return Stop("Steam did nothing for " + GiveUpMinutes + " minutes on part " + (i + 1) + " of 3, which is still " +
                            (size / 1048576).ToString("n0") + " MB, so it was given up on. " +
                            (size == 0
                                ? "Nothing came down at all, so Steam most likely refused the command; its console window says why. Check Steam is open and signed in, then press Try again."
                                : "Check Steam is open and signed in, then press Try again. What is already down is kept, so it carries on from here."), log, status);
                    }
                    Thread.Sleep(2000);
                }
                WriteMarker(folder, manifest);
                log("Part " + (i + 1) + " of 3 is down (depot " + depot + ", " + (FolderSize(folder) / 1048576).ToString("n0") + " MB).");
                Progress((i + 1) * 100 / Stages);
            }

            // ---- apply ------------------------------------------------------
            if (Checks.GameRunning())
                return Stop("Skyrim started while the files were coming down. Close it and press the button again; the downloads are kept.", log, status);

            // The downloaded exe is checked before a single file is put in
            // place anywhere. This used to be checked only after the copy,
            // by which point a wrong download had already gone over the game.
            // The Downgrader Tool on Nexus checks first, and that is right.
            string gotExe = DownloadedExe(content);
            if (gotExe.Length == 0 || Wrong(cfg, gotExe))
            {
                if (gotExe.Length == 0)
                    log("None of the three downloads has SkyrimSE.exe in it, so they are not the 1.6.1170 build. Nothing in " + target + " has been replaced.");
                else
                    log("The SkyrimSE.exe Steam downloaded is " + Describe(cfg, gotExe) + ", not the 1.6.1170 build. Nothing in " + target + " has been replaced.");
                // The next press asks Steam again rather than trusting these.
                foreach (string[] d in Depots)
                {
                    string folder = Path.Combine(content, "depot_" + d[0]);
                    if (gotExe.Length > 0 && !SameFolder(Path.GetDirectoryName(gotExe), folder)) continue;
                    try { File.Delete(Path.Combine(folder, ".thornswood-complete")); } catch (Exception ex) { Swallow.Note("Downgrade, dropping the marker in " + folder, ex); }
                }
                return Stop("Steam's download is not the build we need: " +
                    (gotExe.Length == 0 ? "none of the three parts has SkyrimSE.exe in it" : "the SkyrimSE.exe in it is " + Describe(cfg, gotExe)) +
                    ". Nothing in " + target + " was replaced. Press Try again and Steam is asked for the files once more. If it ends here twice, send your launcher log to the Discord.", log, status);
            }

            // Before Thornswood has a folder of its own, the Steam copy is the
            // only Skyrim there is, and it is the person's: it is never written
            // (#1218). The download stays where Steam put it, and the folder is
            // made from it (OwnGame.Make, which removes it once it has the
            // files). Shell starts that as soon as this returns.
            if (first)
            {
                log("1.6.1170's own files are downloaded. The Steam copy in " + target + " was not changed. Thornswood's own folder is made from these files next.");
                status("Done. 1.6.1170's files are downloaded, and Thornswood's own folder is made from them next.");
                Progress(100);
                return true;
            }

            status("Putting the 1.6.1170 files in place...");
            // The last stretch of the same bar, not a new one: the three
            // downloads have taken it to three quarters and the copy takes it
            // from there. OwnGame.TakePinned copies SkyrimSE.exe last, so a
            // stop part way leaves the build reading as not 1.6.1170 and the
            // card and its Try again button stay (#369 F3).
            var folders = new List<string>();
            long toCopy = 0;
            foreach (string[] d in Depots)
            {
                folders.Add(Path.Combine(content, "depot_" + d[0]));
                toCopy += FolderSize(Path.Combine(content, "depot_" + d[0]));
            }
            Progress(Percent(Depots.Length, Stages, 0, toCopy));
            int shownAt = -1;
            string took;
            try
            {
                took = OwnGame.TakePinned(cfg, folders, delegate (long copied, long all)
                {
                    int mb = (int)(copied / 1048576);
                    if (mb / 256 == shownAt) return;
                    shownAt = mb / 256;
                    status("Putting the 1.6.1170 files in place: " + mb.ToString("n0") + " of " + (all / 1048576).ToString("n0") + " MB");
                    Progress(Percent(Depots.Length, Stages, copied, all));
                }, log);
            }
            catch (Exception ex)
            {
                return Stop(ex.Message, log, status);
            }
            log(took);

            bool right = File.Exists(targetExe) && !Wrong(cfg, targetExe);
            if (!right)
            {
                return Stop("SkyrimSE.exe is still not the 1.6.1170 build after the copy (" + Describe(cfg, targetExe) + "). Send your launcher log to the Discord.", log, status);
            }

            status("Cleaning up the downloaded copies...");
            ClearDownloads(cfg, log);
            log("Skyrim in " + target + " is on 1.6.1170. The Steam copy of Skyrim was not changed, and it can be on any build.");
            status("Done. Skyrim is on 1.6.1170.");
            Progress(100);
            return true;
        }

        // ------------------------------------------------------------ steam

        static Process SteamProcess()
        {
            try
            {
                foreach (Process p in Process.GetProcessesByName("steam")) return p;
            }
            catch (Exception ex) { Swallow.Note("Downgrade.SteamProcess", ex); }
            return null;
        }

        /// <summary>
        /// Asks Steam to open one of its steam:// links. Through Windows first,
        /// the way a person clicking the link would, and when Windows cannot
        /// open it, through steam.exe itself with the link as its argument,
        /// which is the command Windows runs for a steam:// link anyway.
        ///
        /// Every request used to be a bare Process.Start inside an empty catch. On a
        /// machine whose steam:// link does not open (the association missing,
        /// or taken by something else), that threw, the throw was thrown away,
        /// Steam was never asked anything, and nothing was written anywhere:
        /// "didnt even upon the steam console" (Patrick, 24 September, a tester
        /// on 1.1.94). Another SkyMP server's launcher opens the console on those
        /// machines, so it is possible, and this is how.
        /// </summary>
        internal static bool AskSteam(string link, Action<string> log)
        {
            try
            {
                Process.Start(new ProcessStartInfo(link) { UseShellExecute = true });
                return true;
            }
            catch (Exception ex)
            {
                log("Windows would not open " + link + " (" + ex.Message + "), so steam.exe is asked directly.");
            }
            string root = "";
            try { root = Steam.Path_() ?? ""; }
            catch (Exception ex) { Swallow.Note("Downgrade.AskSteam, finding Steam", ex); }
            string exe = root.Length > 0 ? Path.Combine(root, "steam.exe") : "";
            if (exe.Length == 0 || !File.Exists(exe))
            {
                log("steam.exe is not where Steam's install says it is (" + (root.Length > 0 ? root : "no install found") + "), so Steam cannot be asked for " + link + ".");
                return false;
            }
            try
            {
                // The same arguments Windows registers for the link: steam.exe -- "steam://...".
                Process.Start(new ProcessStartInfo(exe, "-- \"" + link + "\"") { UseShellExecute = false });
                return true;
            }
            catch (Exception ex)
            {
                log("steam.exe would not take " + link + " either: " + ex.Message);
                return false;
            }
        }

        static bool WaitForSteam(Action<string> log, Action<string> status)
        {
            if (SteamProcess() == null)
            {
                log("Steam is not running. Starting it; sign in if it asks.");
                status("Starting Steam. Sign in if it asks...");
                // AskSteam handed back false and nothing read it, so a machine
                // where neither the link nor steam.exe can be reached spent
                // ninety seconds waiting for a Steam nobody had asked for.
                if (!AskSteam("steam://open/main", log))
                    return Stop("Steam could not be started: Windows would not open its link and steam.exe is not where Steam's install says it is. Start Steam yourself, sign in, then press the button again.", log, status);
                DateTime t = DateTime.Now;
                while (SteamProcess() == null && (DateTime.Now - t).TotalSeconds < 90) Thread.Sleep(1000);
                if (SteamProcess() == null) { Stop("Steam did not start. Start Steam yourself, sign in, then press the button again.", log, status); return false; }
                // Give it time to sign in and draw its window.
                status("Waiting for Steam to sign in...");
                DateTime t2 = DateTime.Now;
                while (MainWindow() == IntPtr.Zero && (DateTime.Now - t2).TotalSeconds < 120) Thread.Sleep(1000);
            }
            return true;
        }

        /// <summary>
        /// Opens Steam's console, brings Steam in front, confirms Steam's window
        /// is the foreground one, and types the command with Enter. False when
        /// the window never came to the front; nothing is typed then.
        /// </summary>
        static bool TypeIntoConsole(string cmd, Action<string> log)
        {
            AskSteam("steam://open/console", log);

            // Steam's window can take a while to come up, longer still when the
            // client was sitting in the tray, and the first request for the
            // console is sometimes swallowed while it is busy. So: up to twenty
            // seconds, and the console is asked for again halfway.
            bool front = false;
            bool reopened = false;
            IntPtr h = IntPtr.Zero;
            DateTime start = DateTime.Now;
            while (!front && (DateTime.Now - start).TotalSeconds < 20)
            {
                Thread.Sleep(500);
                // Asked again halfway whether or not a window has turned up.
                // This used to sit below the check for a window, so Steam in
                // the tray with no window at all was never asked a second time
                // and the whole twenty seconds went by on the first request.
                if (!reopened && (DateTime.Now - start).TotalSeconds > 8)
                {
                    reopened = true;
                    AskSteam(MainWindow() == IntPtr.Zero ? "steam://open/main" : "steam://open/console", log);
                    if (MainWindow() == IntPtr.Zero) { Thread.Sleep(1500); AskSteam("steam://open/console", log); }
                }
                h = MainWindow();
                if (h == IntPtr.Zero) continue;
                SayWindow(h, log);
                BringToFront(h);
                Thread.Sleep(400);
                front = SteamInFront(h);
            }
            if (!front && h == IntPtr.Zero)
                log("Steam never showed a window in twenty seconds, so its console could not be brought up. It may be signed out or stuck behind a sign in box.");
            if (!front) return false;

            // A moment for the console page to finish drawing.
            Thread.Sleep(1200);
            if (!SteamInFront(h)) return false;

            // Then a click on the command line. Opening the console puts the
            // keyboard there when the page is new, and not when the tab was
            // already open: on 17 Sep the button brought Steam up, said it had
            // typed, and the console showed the old line untouched, because
            // select all, delete and the command had all gone to the page and
            // not to its input. The command line sits along the bottom of the
            // console page, above the status bar, and that is where this
            // clicks, scaled for the monitor Steam is on.
            ClickCommandLine(h);
            Thread.Sleep(150);
            if (!SteamInFront(h)) return false;

            // Whatever is on the command line goes first. The retry used to
            // type the command a second time onto the first one, and Steam ran
            // "download_depot ... 8442952117333549665download_depot ..." (Djinn,
            // 17 Sep). Select all, delete, then type.
            Chord(VK_CONTROL, VK_A);
            Thread.Sleep(80);
            Key(VK_BACK);
            Thread.Sleep(120);
            Type(cmd);
            Thread.Sleep(250);
            // Twice. Steam's console suggests commands as you type, and while a
            // suggestion is up the first Enter takes the suggestion instead of
            // running the line; that is how the command sat there typed and not
            // run. With no suggestion up, the second Enter runs an empty line,
            // which Steam ignores.
            Key(VK_RETURN);
            Thread.Sleep(350);
            Key(VK_RETURN);
            return true;
        }

        /// <summary>
        /// Puts Steam's window in front and makes sure it took.
        ///
        /// Windows only lets the foreground process hand the foreground on, and
        /// this runs on a worker thread of a launcher that stopped being the
        /// foreground process the moment Steam's window appeared. A plain
        /// SetForegroundWindow is refused then, quietly. Three ways through, in
        /// order. Attaching to Steam's input thread, which is enough while
        /// Steam or the launcher is the one in front. A tap of Alt, because a
        /// key press from us counts as the person's and the system lets the
        /// next SetForegroundWindow through after one. And attaching to the
        /// thread of the window that is in front, whatever it is, because that
        /// is the input the foreground belongs to.
        ///
        /// The third was missing until 25 September. A tester on 1.1.94 got
        /// part 1 typed and nothing for part 2: part 1 is asked for straight
        /// after the button is pressed, with the launcher in front, and part 2
        /// twenty minutes later, when the person is somewhere else. Attaching to
        /// Steam's thread does nothing then, and the Alt tap does nothing when
        /// the window in front is one our keys cannot reach, a program running
        /// as administrator for one. A window that has stopped answering is
        /// never attached to: joining a hung thread's input can hang this one.
        /// </summary>
        static void BringToFront(IntPtr h)
        {
            try
            {
                // Restored only when it is minimised. Restoring a maximised
                // window un-maximises it, which every attempt did to Steam once
                // its real window was the one found (review, 24 September).
                if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
                uint pid;
                uint steamThread = GetWindowThreadProcessId(h, out pid);
                uint me = GetCurrentThreadId();
                bool attached = steamThread != 0 && steamThread != me && AttachThreadInput(me, steamThread, true);
                try
                {
                    BringWindowToTop(h);
                    SetForegroundWindow(h);
                }
                finally
                {
                    if (attached) AttachThreadInput(me, steamThread, false);
                }
                if (SteamInFront(h)) return;
                Key(VK_MENU);
                Thread.Sleep(50);
                SetForegroundWindow(h);
                if (SteamInFront(h)) return;
                IntPtr fg = GetForegroundWindow();
                uint fgPid;
                uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out fgPid);
                bool joined = fgThread != 0 && fgThread != me && !IsHungAppWindow(fg) && AttachThreadInput(me, fgThread, true);
                try
                {
                    BringWindowToTop(h);
                    SetForegroundWindow(h);
                }
                finally
                {
                    if (joined) AttachThreadInput(me, fgThread, false);
                }
            }
            catch (Exception ex) { Swallow.Note("Downgrade.BringToFront", ex); }
        }

        /// <summary>
        /// The program that owns the window in front, for the launcher log when
        /// Steam's would not come forward, so the next report says what was in
        /// the way. The process name only and never the window's title: the log
        /// is sent to the Discord for help, and a title can be an email subject
        /// or a page somebody has open.
        /// </summary>
        static string InFront()
        {
            try
            {
                IntPtr fg = GetForegroundWindow();
                if (fg == IntPtr.Zero) return "no window at all, which is how a locked screen looks";
                uint pid;
                GetWindowThreadProcessId(fg, out pid);
                return Process.GetProcessById((int)pid).ProcessName;
            }
            catch { return "a program that could not be read"; }
        }

        /// <summary>
        /// Puts the keyboard back on the console's command line for a retry.
        /// This used to click 28 pixels up from the bottom edge of Steam's
        /// window, where the command line was in the old client. In the
        /// current client that is the status bar, Downloads and Friends and
        /// Chat, so the click opened another page instead of focusing
        /// anything. Opening the console again focuses its command line, and
        /// nothing is clicked.
        /// </summary>
        static void FocusConsole(Action<string> log)
        {
            AskSteam("steam://open/console", log);
            Thread.Sleep(1500);
            IntPtr h = MainWindow();
            if (h == IntPtr.Zero) return;
            BringToFront(h);
            Thread.Sleep(300);
            if (SteamInFront(h)) ClickCommandLine(h);
        }

        /// <summary>
        /// One click on the console's command line.
        ///
        /// Measured on the current Steam client at 100 percent scaling: the
        /// input's centre is 72 pixels above the bottom edge of the window,
        /// with the status bar (Downloads, Friends and Chat) below it. Under
        /// the PerMonitorV2 manifest (#463) this process and Steam share
        /// physical screen coordinates, so the old GetDpiForWindow over
        /// GetDpiForSystem ratio (which compensated for system-DPI
        /// virtualisation) is gone. The 72 is scaled by Steam's window DPI
        /// over 96 so the click still tracks Steam's own UI scale. A Windows
        /// without GetDpiForWindow (before 10.0.1607) keeps the bare 72.
        /// DepotDownloader has not replaced this path.
        /// </summary>
        static void ClickCommandLine(IntPtr h)
        {
            if (h == IntPtr.Zero) return;
            RECT r;
            if (!GetWindowRect(h, out r)) return;
            double scale = 1.0;
            try
            {
                uint steam = GetDpiForWindow(h);
                // 96 DPI is 100 percent, the scale the 72 pixel offset was
                // measured at. Physical coordinates under PerMonitorV2 mean
                // steam/system would undershoot whenever the system scale is
                // above 100 percent on the same monitor as Steam.
                if (steam > 0) scale = steam / 96.0;
            }
            catch (Exception ex) { Swallow.Note("Downgrade.ClickCommandLine, DPI scale", ex); }
            int x = (r.Left + r.Right) / 2;
            int y = r.Bottom - (int)Math.Round(72 * scale);
            SetCursorPos(x, y);
            Thread.Sleep(80);
            Mouse(MOUSEEVENTF_LEFTDOWN);
            Thread.Sleep(60);
            Mouse(MOUSEEVENTF_LEFTUP);
        }

        static bool ForegroundIsSteam()
        {
            try
            {
                IntPtr fg = GetForegroundWindow();
                if (fg == IntPtr.Zero) return false;
                uint pid;
                GetWindowThreadProcessId(fg, out pid);
                if (pid == 0) return false;
                return IsSteam(Process.GetProcessById((int)pid).ProcessName);
            }
            catch { return false; }
        }

        /// <summary>
        /// Steam is in front, and it is the window this brought forward or a
        /// window inside it. Any Steam window was not enough once windows drawn
        /// by steamwebhelper counted as Steam's: the Friends list, a chat window
        /// or the sign-in box can be the one in front, and a download_depot line
        /// and two Enters typed into a chat would go to a friend as a message.
        /// Found in review, 24 September.
        /// </summary>
        static bool SteamInFront(IntPtr h)
        {
            if (h == IntPtr.Zero || !ForegroundIsSteam()) return false;
            try
            {
                IntPtr fg = GetForegroundWindow();
                return fg == h || GetAncestor(fg, GA_ROOT) == h;
            }
            catch { return false; }
        }

        /// <summary>A process named steam or steamwebhelper, in any case.</summary>
        static bool IsSteam(string processName)
        {
            foreach (string name in SteamNames)
                if (string.Equals(processName, name, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>Steam's biggest visible top level window, drawn by steam or by steamwebhelper.</summary>
        static IntPtr MainWindow()
        {
            var pids = new HashSet<uint>();
            try { foreach (string name in SteamNames) foreach (Process p in Process.GetProcessesByName(name)) pids.Add((uint)p.Id); } catch (Exception ex) { Swallow.Note("Downgrade.MainWindow, listing Steam processes", ex); }
            if (pids.Count == 0) return IntPtr.Zero;
            var search = new WindowSearch { Pids = pids };
            GCHandle handle = GCHandle.Alloc(search);
            try { unsafe { EnumWindows(&OnWindow, GCHandle.ToIntPtr(handle)); } }
            finally { handle.Free(); }
            return search.Best;
        }

        /// <summary>
        /// What MainWindow's walk over the windows has found so far. Windows
        /// calls OnWindow once for each top level window with a handle to this
        /// in its second argument: a callback Windows calls is a static
        /// function in the native build, never a lambda.
        /// </summary>
        sealed class WindowSearch
        {
            public HashSet<uint> Pids;
            public IntPtr Best;
            public long BestArea;
        }

        [UnmanagedCallersOnly]
        static int OnWindow(IntPtr h, IntPtr state)
        {
            try
            {
                var s = (WindowSearch)GCHandle.FromIntPtr(state).Target;
                if (!IsWindowVisible(h)) return 1;
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if (!s.Pids.Contains(pid)) return 1;
                RECT r;
                if (!GetWindowRect(h, out r)) return 1;
                long area = (long)Math.Max(0, r.Right - r.Left) * Math.Max(0, r.Bottom - r.Top);
                if (area > s.BestArea) { s.BestArea = area; s.Best = h; }
            }
            catch (Exception ex) { Swallow.Note("Downgrade.MainWindow, measuring window", ex); }
            return 1;
        }

        /// <summary>
        /// Names the window taken for Steam's, the process that drew it and
        /// its size, the first time it is found in a run and again
        /// only if another one is found. When the clipboard fallback comes up
        /// on somebody's machine, this line says whether Steam's window was
        /// found at all and which one it was.
        /// </summary>
        static void SayWindow(IntPtr h, Action<string> log)
        {
            string key = h.ToString();
            if (key == saidWindow) return;
            saidWindow = key;
            log("Found Steam's window: " + WindowWords(h) + ".");
        }

        static string WindowWords(IntPtr h)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            string owner = "process " + pid;
            try { owner = Process.GetProcessById((int)pid).ProcessName + ", process " + pid; }
            catch { /* The process has gone; its number is still worth saying. */ }
            // Never the title (#3627): a Steam chat window is titled with a
            // friend's name, and this line goes up with the session's logs.
            // Which process and how big says which window it was.
            RECT r;
            string size = GetWindowRect(h, out r) ? (r.Right - r.Left) + " x " + (r.Bottom - r.Top) : "size unknown";
            return owner + ", " + size;
        }

        /// <summary>
        /// A part's command goes on the clipboard, and the log, the line on the
        /// card and the launcher's taskbar button all say so.
        ///
        /// The parts go one at a time, so each command is put on the clipboard
        /// only when the part before it is down, in place of whatever was there.
        /// Until 24 September nothing said so, and a tester believed only the
        /// first command was ever given: "it only give you the fiurst one to
        /// yuor clipboards and not all of them" (Patrick). So the line names the
        /// part of three and says the rest follow here.
        ///
        /// The launcher is flashed rather than brought forward: a later part
        /// lands while the person is looking at Steam, and putting the launcher
        /// over Steam's console would cover the place they have to paste into.
        /// </summary>
        static void OnClipboard(string cmd, int part, string why, Action<string> log, Action<string> status)
        {
            // What is said depends on whether the clipboard actually took it.
            // It said "press Ctrl+V" either way until now, and a Ctrl+V after a
            // clipboard that refused the command pastes whatever was on it
            // before: the part before this one, or something from another
            // program, into Steam's console.
            string line = TryClipboard(cmd) ? ClipboardLine(part, Depots.Length) : TypeItLine(cmd, part, Depots.Length);
            log(why + line + " This keeps watching for it.");
            status(line);
            FlashLauncher();
        }

        /// <summary>
        /// What the log and the card say when the clipboard would not take the
        /// command: the command itself, to type in by hand. Never "press
        /// Ctrl+V", because the thing to paste is not there.
        /// </summary>
        static string TypeItLine(string cmd, int part, int of)
        {
            string before = part > 1 ? Parts(1, part - 1, "is down.", "are down.") + " " : "";
            // The command goes last, with nothing after it, so the line does
            // not run "8042843504692938467 Part 3 follows" together and leave
            // somebody copying it wondering where it ends.
            return before + "The clipboard would not take part " + part + " of " + of + ". " + Next(part, of) +
                " Type this into the command line at the bottom of Steam's console and press Enter: " + cmd;
        }

        /// <summary>What the log and the card say when part <paramref name="part"/> of <paramref name="of"/> is on the clipboard.</summary>
        static string ClipboardLine(int part, int of)
        {
            string before = part > 1 ? Parts(1, part - 1, "is down.", "are down.") + " " : "";
            return before + "Part " + part + " of " + of + " is on your clipboard" + (part > 1 ? " now" : "") +
                ": click in Steam's console command line, press Ctrl+V and Enter. " + Next(part, of);
        }

        /// <summary>
        /// The line on the card while a part downloads. It stays there for the
        /// whole part, so a part that went on the clipboard keeps saying so:
        /// the paste itself while nothing has come down, and after that what
        /// follows.
        /// </summary>
        static string ProgressLine(int part, int of, long bytes, bool pasted)
        {
            if (pasted && bytes <= 0) return ClipboardLine(part, of);
            string line = "Part " + part + " of " + of + ": " + (bytes / 1048576).ToString("n0") + " MB down so far (Steam shows the rest in its console)";
            return pasted ? line + ". " + Next(part, of) : line;
        }

        /// <summary>
        /// The line on the card once Steam has said how big the part is: how
        /// much of it is down, of how much, and the share. Before Steam says,
        /// it is ProgressLine's line.
        /// </summary>
        static string SizedLine(int part, int of, long bytes, long total, bool pasted)
        {
            if (total <= 0 || (pasted && bytes <= 0)) return ProgressLine(part, of, bytes, pasted);
            long pct = Math.Min(99, Math.Max(0, bytes * 100 / total));
            string line = "Part " + part + " of " + of + ": " + (bytes / 1048576).ToString("n0") + " of " +
                          (total / 1048576).ToString("n0") + " MB (" + pct + "%)";
            return pasted ? line + ". " + Next(part, of) : line;
        }

        /// <summary>
        /// How far through all the parts the download is, 0 to 99: the parts
        /// before this one are whole, and this one counts by its share. It
        /// never says 100 until the files are in place.
        /// </summary>
        static int Percent(int index, int of, long bytes, long total)
        {
            if (of <= 0) return 0;
            double part = total > 0 ? Math.Min(0.99, Math.Max(0.0, bytes / (double)total)) : 0.0;
            return (int)Math.Min(99.0, (index + part) * 100.0 / of);
        }

        /// <summary>
        /// The size Steam gave this depot when it started on it, in bytes, from
        /// its console line "Downloading depot 489832 (26 files, 7260 MB) ...",
        /// or 0 when it has not said yet. The line is SteamLog's, read in
        /// console_log.txt.
        /// </summary>
        static long DepotBytes(string said, string depot)
        {
            Match m = Regex.Match(said ?? "", "Downloading depot " + Regex.Escape(depot) + @" \(\d+ files?, ([\d,]+) MB\)");
            if (!m.Success) return 0;
            long mb;
            if (!long.TryParse(m.Groups[1].Value.Replace(",", ""), out mb)) return 0;
            return mb * 1048576L;
        }

        static string Next(int part, int of)
        {
            if (part >= of) return "It is the last one.";
            return Parts(part + 1, of, "follows here when it is down.", "follow here when it is down.");
        }

        /// <summary>"Part 2 follows", "Parts 2 and 3 follow", "Parts 2 to 5 follow".</summary>
        static string Parts(int from, int to, string one, string many)
        {
            if (from >= to) return "Part " + from + " " + one;
            return "Parts " + from + (to == from + 1 ? " and " : " to ") + to + " " + many;
        }

        /// <summary>
        /// Flashes the launcher's taskbar button until the person comes back to
        /// it. FlashWindowEx only draws attention: it takes nothing from Steam's
        /// window and sends no input anywhere.
        /// </summary>
        static void FlashLauncher()
        {
            try
            {
                IntPtr me = Process.GetCurrentProcess().MainWindowHandle;
                if (me == IntPtr.Zero) return;
                var f = new FLASHWINFO();
                f.cbSize = (uint)Marshal.SizeOf<FLASHWINFO>();
                f.hwnd = me;
                f.dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG;
                f.uCount = uint.MaxValue;
                f.dwTimeout = 0;
                FlashWindowEx(ref f);
            }
            catch (Exception ex) { Swallow.Note("Downgrade.FlashLauncher", ex); }
        }

        /// <summary>
        /// Puts the command on the clipboard and says whether it is really
        /// there.
        ///
        /// Clipboard.SetText fails whenever another program has the clipboard
        /// open, which on a machine with a clipboard manager, a browser or a
        /// remote desktop on it is often enough to matter. The failure used to
        /// be thrown away and the card said "press Ctrl+V" all the same, which
        /// is the worst of both: the person follows the instruction and Steam's
        /// console gets whatever was on the clipboard before. So it is tried a
        /// few times, a moment apart, and the text is read back before it is
        /// claimed.
        /// </summary>
        static bool TryClipboard(string text)
        {
            for (int i = 0; i < 5; i++)
            {
                try
                {
                    SetClipboardText(text);
                    if (string.Equals(GetClipboardText(), text, StringComparison.Ordinal)) return true;
                }
                catch (Exception ex) { Swallow.Note("Downgrade.TryClipboard", ex); }
                Thread.Sleep(120);
            }
            return false;
        }

        /// <summary>
        /// Puts text on Windows' clipboard as CF_UNICODETEXT, the format
        /// WPF's Clipboard.SetText wrote it in, straight through user32 now
        /// that there is no WPF. The memory is Windows' once SetClipboardData
        /// takes it, so it stays on the clipboard after the launcher closes.
        /// Throws, with Windows' reason, when a step is refused, as
        /// Clipboard.SetText did.
        /// </summary>
        static void SetClipboardText(string text)
        {
            if (!OpenClipboard(Ask.Owner)) throw new Win32Exception(Marshal.GetLastPInvokeError(), "OpenClipboard");
            try
            {
                if (!EmptyClipboard()) throw new Win32Exception(Marshal.GetLastPInvokeError(), "EmptyClipboard");
                IntPtr h = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)((text.Length + 1) * 2));
                if (h == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastPInvokeError(), "GlobalAlloc");
                bool handedOver = false;
                try
                {
                    IntPtr p = GlobalLock(h);
                    if (p == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastPInvokeError(), "GlobalLock");
                    try
                    {
                        Marshal.Copy(text.ToCharArray(), 0, p, text.Length);
                        Marshal.WriteInt16(p, text.Length * 2, 0);
                    }
                    finally { GlobalUnlock(h); }
                    if (SetClipboardData(CF_UNICODETEXT, h) == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastPInvokeError(), "SetClipboardData");
                    handedOver = true;
                }
                finally { if (!handedOver) GlobalFree(h); }
            }
            finally { CloseClipboard(); }
        }

        /// <summary>The clipboard's text, or null when it holds none.</summary>
        static string GetClipboardText()
        {
            if (!OpenClipboard(Ask.Owner)) throw new Win32Exception(Marshal.GetLastPInvokeError(), "OpenClipboard");
            try
            {
                IntPtr h = GetClipboardData(CF_UNICODETEXT);
                if (h == IntPtr.Zero) return null;
                IntPtr p = GlobalLock(h);
                if (p == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastPInvokeError(), "GlobalLock");
                try { return Marshal.PtrToStringUni(p); }
                finally { GlobalUnlock(h); }
            }
            finally { CloseClipboard(); }
        }

        // ---------------------------------------------------------- watching

        /// <summary>
        /// Steam's logs from the moment a command was given. What
        /// download_depot does is written by Steam's console to
        /// logs\console_log.txt, a line for each step:
        ///
        ///   Downloading depot 489832 (26 files, 7260 MB) ...
        ///   Depot download complete : "C:\...\app_489830\depot_489832" (manifest 8042843504692938467)
        ///   Depot download failed : Failed updating depot 489831 while downloading chunk "..." (Failure) (Content unavailable)
        ///
        /// Those three are real lines, recorded on 24 August by the author of
        /// a Skyrim downgrader for RP servers (Mosalah992/Skyrim-downgrader,
        /// logwatch.py) running these same three depots, and
        /// JackifyGameDowngrader reads the same file for the same words.
        ///
        /// Until 24 September this read content_log.txt alone, and took
        /// "depot_489831" as the sign a download had started, which the start
        /// line does not say. So a download that finished was never seen to
        /// finish: the next part was never asked for, which is what a tester
        /// on 1.1.91 got ("it only give you the fiurst one", Patrick), and
        /// twenty minutes on the person was told to delete the folder Steam
        /// had just filled. Both logs are read now, so whichever of them Steam
        /// writes to counts.
        /// </summary>
        sealed class SteamLog
        {
            readonly string[] files;
            readonly long[] from;

            public SteamLog(string steam)
            {
                files = new[] {
                    Path.Combine(steam, "logs\\console_log.txt"),
                    Path.Combine(steam, "logs\\content_log.txt"),
                };
                from = new long[files.Length];
                for (int i = 0; i < files.Length; i++)
                {
                    try { if (File.Exists(files[i])) from[i] = new FileInfo(files[i]).Length; }
                    catch (Exception ex) { Swallow.Note("Downgrade, measuring " + files[i], ex); }
                }
            }

            /// <summary>
            /// What Steam wrote to one log since the command. A log shorter
            /// than it was then has been started again, which Steam does when
            /// it restarts (the old one becomes .previous), so that one is read
            /// from the top.
            /// </summary>
            string Read(int i)
            {
                try
                {
                    if (!File.Exists(files[i])) return "";
                    using (var fs = new FileStream(files[i], FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    {
                        long start = fs.Length < from[i] ? 0 : from[i];
                        if (fs.Length <= start) return "";
                        fs.Seek(start, SeekOrigin.Begin);
                        var buf = new byte[fs.Length - start];
                        int n = fs.Read(buf, 0, buf.Length);
                        return Encoding.UTF8.GetString(buf, 0, n);
                    }
                }
                catch (Exception ex)
                {
                    // Steam holds these open and rotates them; the next turn
                    // of the loop reads again.
                    Swallow.Note("Downgrade, reading " + files[i], ex);
                    return "";
                }
            }

            /// <summary>Everything Steam wrote to either log since the command.</summary>
            public string Since()
            {
                var sb = new StringBuilder();
                for (int i = 0; i < files.Length; i++) sb.Append(Read(i)).Append('\n');
                return sb.ToString();
            }

            /// <summary>
            /// The last few lines of each log since the command, under the
            /// log's name, for the launcher log when a depot will not start.
            /// Each log gets its own lines because one of them can be full of
            /// something else: on Patrick's machine content_log.txt says it
            /// could not write Skyrim's appmanifest every six seconds.
            /// </summary>
            public string Tail(int lines)
            {
                var sb = new StringBuilder();
                for (int i = 0; i < files.Length; i++)
                {
                    var kept = new List<string>();
                    foreach (string line in Read(i).Replace("\r", "").Split('\n'))
                        if (line.Trim().Length > 0) kept.Add(line.Trim());
                    if (kept.Count == 0) continue;
                    int take = Math.Min(kept.Count, lines);
                    if (sb.Length > 0) sb.Append(Environment.NewLine);
                    sb.Append(Path.GetFileName(files[i])).Append(':').Append(Environment.NewLine);
                    sb.Append(string.Join(Environment.NewLine, kept.GetRange(kept.Count - take, take).ToArray()));
                }
                return sb.ToString();
            }
        }

        /// <summary>
        /// True once Steam has said it is downloading this depot
        /// ("Downloading depot 489832 (26 files, 7260 MB) ..."), or has
        /// written any line naming its folder.
        /// </summary>
        static bool LogStarted(string said, string depot)
        {
            return said.IndexOf("Downloading depot " + depot, StringComparison.OrdinalIgnoreCase) >= 0
                || said.IndexOf("depot_" + depot, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        /// <summary>
        /// True once Steam has logged this depot's download as complete, after
        /// the point where the command was given. The line Steam writes names
        /// the folder, so both the words and the depot have to be on the same
        /// line.
        /// </summary>
        static bool LogHasCompletion(string said, string depot)
        {
            foreach (string line in said.Split('\n'))
            {
                if (line.IndexOf("Depot download complete", StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (line.IndexOf("depot_" + depot, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                if (line.IndexOf(depot, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            }
            return false;
        }

        /// <summary>
        /// Steam's line saying this depot's download failed, or "" when there
        /// is none. A failure line that names none of the three depots counts
        /// as this one's, since this one is the only download asked for since
        /// the command; one naming another depot does not.
        /// </summary>
        static string FailedLine(string said, string depot)
        {
            foreach (string raw in said.Split('\n'))
            {
                string line = raw.Trim();
                if (line.IndexOf("Depot download failed", StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (line.IndexOf(depot, StringComparison.Ordinal) >= 0) return line;
                bool other = false;
                foreach (string[] d in Depots)
                    if (d[0] != depot && line.IndexOf(d[0], StringComparison.Ordinal) >= 0) other = true;
                if (!other) return line;
            }
            return "";
        }

        /// <summary>
        /// When Steam has said this depot's download failed, says so with
        /// Steam's own line and returns true. Until 24 September a refusal was
        /// only noticed after GiveUpMinutes with nothing moving.
        /// </summary>
        static bool Refused(string said, string depot, int part, string cmd, Action<string> log, Action<string> status)
        {
            string line = FailedLine(said, depot);
            if (line.Length == 0) return false;
            log("Steam could not download part " + part + " of 3 (depot " + depot + "). Steam's log says: " + line);
            log("Nothing in the game folder has been replaced. Press the button again in a few minutes to ask Steam once more. If it fails the same way twice, send your launcher log to the Discord.");
            log(ByHand(cmd));
            // Steam's own words on the card, not "see the log". A refusal is
            // nearly always something the person can act on (no connection, a
            // licence, the wrong manifest), and it is no use to them in a file.
            status("Steam could not download part " + part + " of 3. Steam says: " + Reason(line) +
                " Nothing in the game folder has been replaced. Press Try again in a few minutes; if it stops the same way twice, send your launcher log to the Discord.");
            return true;
        }

        /// <summary>
        /// Steam's line without the timestamp it starts with, for the line
        /// under the button. The launcher log keeps the whole line.
        /// </summary>
        static string Reason(string line)
        {
            if (line == null) return "";
            Match m = Regex.Match(line, @"^\[[^\]]*\]\s*");
            return m.Success ? line.Substring(m.Length) : line;
        }

        /// <summary>
        /// The way to do one part by hand. steam://open/console is what this
        /// opens too, and the Downgrader Tool on Nexus gives the same way in:
        /// it works whether Steam is already running or not.
        /// </summary>
        static string ByHand(string cmd)
        {
            return "To do it by hand: press Windows+R, type steam://open/console and press Enter, click the command line at the bottom of Steam's console, paste " + cmd + " and press Enter, then wait for Steam to say Depot download complete before the next part.";
        }

        /// <summary>
        /// The SkyrimSE.exe among the downloaded depots, or "" when none of
        /// them has one. It sits at the top of its depot, as it does in the
        /// game folder.
        /// </summary>
        static string DownloadedExe(string content)
        {
            foreach (string[] d in Depots)
            {
                string exe = Path.Combine(Path.Combine(content, "depot_" + d[0]), "SkyrimSE.exe");
                if (File.Exists(exe)) return exe;
            }
            return "";
        }

        /// <summary>
        /// Writes the marker that says this folder holds the build being asked
        /// for: the manifest on the first line, then how many bytes the folder
        /// held when the download finished. MarkerIs reads both.
        /// </summary>
        static void WriteMarker(string folder, string manifest)
        {
            try { File.WriteAllText(Path.Combine(folder, ".thornswood-complete"), manifest + Environment.NewLine + FolderSize(folder)); }
            catch (Exception ex) { Swallow.Note("Downgrade, writing the marker in " + folder, ex); }
        }

        /// <summary>
        /// True when this depot folder's completion marker was written for the
        /// manifest being asked for now AND the files it was written for are
        /// still there. The marker holds the manifest id, so a folder from an
        /// attempt at another build reads as not downloaded and is fetched
        /// again. An empty or unreadable marker is the same answer: nothing in
        /// it says these are the files being asked for.
        ///
        /// The size is checked as well because a marker on its own said the
        /// part was downloaded even when the folder had been emptied since, by
        /// a disk cleaner, by Steam, or by somebody clearing space part way
        /// through eleven gigabytes. The part was then skipped rather than
        /// cleared and fetched again, and the copy put nothing of it into the
        /// game while the exe from another part made the game read as 1.6.1170.
        /// That is the mixed build this is meant to stop. A marker from before
        /// the size was written holds the manifest alone; for one of those the
        /// folder only has to still have something in it.
        /// </summary>
        static bool MarkerIs(string folder, string manifest)
        {
            try
            {
                string mark = Path.Combine(folder, ".thornswood-complete");
                if (!File.Exists(mark)) return false;
                string[] lines = File.ReadAllText(mark).Replace("\r", "").Split('\n');
                if (!string.Equals(lines[0].Trim(), manifest, StringComparison.Ordinal)) return false;
                long was = 0;
                if (lines.Length > 1) long.TryParse(lines[1].Trim(), out was);
                // The marker itself is not one of the downloaded files, so a
                // folder holding nothing but the marker measures zero here and
                // does not pass as a part that is down.
                long now = FolderSize(folder) - new FileInfo(mark).Length;
                return now >= Math.Max(was, 1L);
            }
            catch { return false; }
        }

        /// <summary>
        /// Removes a depot folder that is here without this build's marker,
        /// before Steam is asked for the part, so everything in it afterwards is
        /// what Steam fetched this time. False, with the reason on the card and
        /// in the log, when it cannot be removed.
        ///
        /// A tester on 1.1.94, 25 September: part 1 came down, the launcher
        /// opened Steam's console for part 2 and nothing was typed, and the card
        /// said "8,169 MB down so far" and never moved. Depot 489832 is 7,260 MB
        /// at 1.6.1170, so that folder was left by an attempt at another build.
        /// With it there the run went wrong three ways. Whether Steam had taken
        /// the command was answered yes by the folder being there before Steam
        /// was asked anything, so the second try at the console never ran. The
        /// card showed the old folder's size in place of the line saying the
        /// command was on the clipboard, which is the line that says what to do.
        /// And Steam fills a depot folder without emptying it, so the other
        /// build's files would have gone over the game with the 1.6.1170 ones.
        /// The launcher used to tell the person to delete such a folder by hand,
        /// twenty minutes in; this does it before the part starts.
        /// </summary>
        static bool ClearLeftover(string folder, int part, Action<string> log, Action<string> status)
        {
            if (!Directory.Exists(folder)) return true;
            log("Part " + part + " of 3: " + folder + " is left over from an earlier attempt (" + (FolderSize(folder) / 1048576).ToString("n0") +
                " MB) and is not this build's, so it is removed and Steam fetches this part afresh.");
            try
            {
                // A read only file stops Directory.Delete, so they are cleared first.
                foreach (string f in Directory.GetFiles(folder, "*", SearchOption.AllDirectories))
                    File.SetAttributes(f, FileAttributes.Normal);
                Directory.Delete(folder, true);
                return true;
            }
            catch (Exception ex)
            {
                string why = "Could not remove " + folder + ", left over from an earlier attempt: " + ex.Message +
                             " If Steam is still downloading into it, let that finish or restart Steam. Then delete that folder and press the button again.";
                // Through Stop, so the bar goes too, as every other early stop does.
                return Stop(why, log, status);
            }
        }

        static long FolderSize(string folder)
        {
            long n = 0;
            try
            {
                if (!Directory.Exists(folder)) return 0;
                foreach (string f in Directory.GetFiles(folder, "*", SearchOption.AllDirectories))
                {
                    try { n += new FileInfo(f).Length; } catch (Exception ex) { Swallow.Note("Downgrade.FolderSize, file length", ex); }
                }
            }
            catch (Exception ex) { Swallow.Note("Downgrade.FolderSize", ex); }
            return n;
        }

        // ------------------------------------------------------------ win32

        const int SW_RESTORE = 9;
        const uint GA_ROOT = 2;
        const ushort VK_RETURN = 0x0D;
        const ushort VK_MENU = 0x12;
        const ushort VK_CONTROL = 0x11;
        const ushort VK_BACK = 0x08;
        const ushort VK_A = 0x41;
        const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;
        const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }
        [StructLayout(LayoutKind.Explicit)]
        struct INPUTUNION
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct INPUT { public uint type; public INPUTUNION u; }
        [StructLayout(LayoutKind.Sequential)]
        struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags, uCount, dwTimeout; }
        const uint FLASHW_ALL = 3, FLASHW_TIMERNOFG = 12;

        [LibraryImport("user32.dll")] private static unsafe partial int EnumWindows(delegate* unmanaged<IntPtr, IntPtr, int> cb, IntPtr lParam);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool IsWindowVisible(IntPtr hWnd);
        [LibraryImport("user32.dll")] private static partial uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [LibraryImport("user32.dll")] private static partial IntPtr GetForegroundWindow();
        [LibraryImport("user32.dll")] private static partial IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool IsIconic(IntPtr hWnd);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool SetForegroundWindow(IntPtr hWnd);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool BringWindowToTop(IntPtr hWnd);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool AttachThreadInput(uint idAttach, uint idAttachTo, [MarshalAs(UnmanagedType.Bool)] bool fAttach);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool IsHungAppWindow(IntPtr hWnd);
        [LibraryImport("kernel32.dll")] private static partial uint GetCurrentThreadId();
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool ShowWindow(IntPtr hWnd, int cmd);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool SetCursorPos(int x, int y);
        [LibraryImport("user32.dll")] private static partial uint GetDpiForWindow(IntPtr hWnd);
        [LibraryImport("user32.dll", SetLastError = true)] private static partial uint SendInput(uint n, INPUT[] inputs, int size);
        [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool FlashWindowEx(ref FLASHWINFO info);

        const uint CF_UNICODETEXT = 13;
        const uint GMEM_MOVEABLE = 0x0002;
        [LibraryImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool OpenClipboard(IntPtr owner);
        [LibraryImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool CloseClipboard();
        [LibraryImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool EmptyClipboard();
        [LibraryImport("user32.dll", SetLastError = true)] private static partial IntPtr SetClipboardData(uint format, IntPtr data);
        [LibraryImport("user32.dll", SetLastError = true)] private static partial IntPtr GetClipboardData(uint format);
        [LibraryImport("kernel32.dll", SetLastError = true)] private static partial IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
        [LibraryImport("kernel32.dll", SetLastError = true)] private static partial IntPtr GlobalLock(IntPtr mem);
        [LibraryImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool GlobalUnlock(IntPtr mem);
        [LibraryImport("kernel32.dll")] private static partial IntPtr GlobalFree(IntPtr mem);

        static void Type(string text)
        {
            foreach (char c in text)
            {
                var down = new INPUT(); down.type = INPUT_KEYBOARD;
                down.u.ki.wScan = c; down.u.ki.dwFlags = KEYEVENTF_UNICODE;
                var up = new INPUT(); up.type = INPUT_KEYBOARD;
                up.u.ki.wScan = c; up.u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                SendInput(2, new[] { down, up }, Marshal.SizeOf<INPUT>());
                Thread.Sleep(12);
            }
        }

        static void Key(ushort vk)
        {
            var down = new INPUT(); down.type = INPUT_KEYBOARD; down.u.ki.wVk = vk;
            var up = new INPUT(); up.type = INPUT_KEYBOARD; up.u.ki.wVk = vk; up.u.ki.dwFlags = KEYEVENTF_KEYUP;
            SendInput(2, new[] { down, up }, Marshal.SizeOf<INPUT>());
        }

        /// <summary>A modifier held while another key is pressed, Ctrl+A for one.</summary>
        static void Chord(ushort modifier, ushort vk)
        {
            var mDown = new INPUT(); mDown.type = INPUT_KEYBOARD; mDown.u.ki.wVk = modifier;
            var kDown = new INPUT(); kDown.type = INPUT_KEYBOARD; kDown.u.ki.wVk = vk;
            var kUp = new INPUT(); kUp.type = INPUT_KEYBOARD; kUp.u.ki.wVk = vk; kUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
            var mUp = new INPUT(); mUp.type = INPUT_KEYBOARD; mUp.u.ki.wVk = modifier; mUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
            SendInput(4, new[] { mDown, kDown, kUp, mUp }, Marshal.SizeOf<INPUT>());
        }

        static void Mouse(uint flag)
        {
            var e = new INPUT(); e.type = INPUT_MOUSE; e.u.mi.dwFlags = flag;
            SendInput(1, new[] { e }, Marshal.SizeOf<INPUT>());
        }
    }
}
