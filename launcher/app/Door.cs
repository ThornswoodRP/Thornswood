using System;
using System.IO;
using System.Threading;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// The Discord check that stands in front of Play.
    ///
    /// Kept out of Shell.cs because it is the one thing in the launcher that
    /// can refuse to start the game, and burying that in a two thousand line
    /// file is how it ends up accidentally bypassed.
    ///
    /// It asks the site rather than deciding anything itself. The site asks
    /// Discord. So removing somebody's role, or removing them from the server,
    /// stops their next launch with nothing to remember to change anywhere.
    ///
    /// The answer is held for a few minutes so pressing Play twice is not two
    /// round trips, and not longer than that, because the whole point is that a
    /// ban lands without waiting for anybody to restart anything.
    ///
    /// A site that did not answer used to be a yes, which made the whole check
    /// optional for anybody willing to put thornswood.net in a hosts file. So
    /// the last answer the site actually gave is written down, and an
    /// unreachable site now stands on that: a yes from the last few days still
    /// opens the door, an older one or a no does not. Nothing signs that note
    /// and nothing needs to, because the lock is the game server's own allowed
    /// list; this only decides whether the launcher starts the game at all.
    /// </summary>
    public static class Door
    {
        const int HoldSeconds = 300;

        /// <summary>
        /// How long a yes from the site is worth something once the site cannot
        /// be reached. Long enough that a weekend of the site being down stops
        /// nobody playing, short enough that somebody who was removed from the
        /// Discord cannot unplug the network and carry on for a month.
        /// </summary>
        const int GraceHours = 72;

        static DateTime clearedAt = DateTime.MinValue;

        /// <summary>The last answer the site gave, kept beside the Discord ticket it was given for.</summary>
        static string AnswerFile
        {
            get { return Path.Combine(Discord.Folder, "door.txt"); }
        }

        /// <summary>
        /// Writes down what the site said, so the next launch has something to
        /// go on when the site cannot be reached.
        /// </summary>
        static void Remember(bool ok)
        {
            try
            {
                Directory.CreateDirectory(Discord.Folder);
                File.WriteAllText(AnswerFile, (ok ? "yes" : "no") + "|" + DateTime.UtcNow.Ticks);
            }
            catch (Exception ex) { Swallow.Note("Door.Remember", ex); }
        }

        /// <summary>
        /// True only when the site said yes inside the grace period. A note
        /// that is missing, unreadable, a no, too old or dated in the future is
        /// a no: everything this cannot answer has to be a no, or the grace is
        /// not a grace, it is the way round the door.
        /// </summary>
        static bool RecentYes()
        {
            try
            {
                if (!File.Exists(AnswerFile)) return false;
                string[] bits = File.ReadAllText(AnswerFile).Trim().Split('|');
                if (bits.Length != 2 || bits[0] != "yes") return false;
                long ticks;
                if (!long.TryParse(bits[1], out ticks)) return false;
                if (ticks <= 0 || ticks > DateTime.MaxValue.Ticks) return false;
                double hours = (DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc)).TotalHours;
                return hours >= 0 && hours < GraceHours;
            }
            catch { return false; }
        }

        public static bool RecentlyCleared
        {
            get { return (DateTime.Now - clearedAt).TotalSeconds < HoldSeconds; }
        }

        /// <summary>
        /// The last yes the site gave, whole, for whoever needs more than the
        /// fact of it: Chars.Prepare reads the slot count off it.
        /// </summary>
        public static Standing Last;

        public static void Forget() { clearedAt = DateTime.MinValue; }

        /// <summary>
        /// Asks, off the UI thread, then calls onAllowed back ON the UI thread
        /// if the answer is yes. If the answer is no it says why and calls
        /// nothing. onRefused runs on the UI thread either way it finishes, so
        /// a disabled button can be put back.
        /// </summary>
        public static void Check(Action<string> log,
                                 Action<Standing> shout, Action onAllowed, Action onDone)
        {
            if (RecentlyCleared)
            {
                if (onAllowed != null) onAllowed();
                if (onDone != null) onDone();
                return;
            }

            log("Asking Discord whether you are still allowed in...");

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

                Dispatcher.UIThread.Post(delegate
                {
                    try
                    {
                        if (st.Ok)
                        {
                            Remember(true);
                            clearedAt = DateTime.Now;
                            Last = st;
                            if (st.Name != null && st.Name.Length > 0) log("Discord says yes. " + st.Name + ".");
                            else log("Discord says yes.");
                            // A yes can still say something: that the world is
                            // full and there will be a wait in line at the
                            // game's menu (#481).
                            if (st.Message != null && st.Message.Length > 0) log(st.Message);
                            if (onAllowed != null) onAllowed();
                            return;
                        }

                        // The site being down is not the person's fault, and a
                        // yes it gave in the last few days still stands. What no
                        // longer stands is an unreachable site on its own, since
                        // that is also exactly what blocking thornswood.net in a
                        // hosts file looks like from here.
                        //
                        // The site answering "could not ask Discord" is the same
                        // case one step further along: the site is up and Discord
                        // did not answer it, usually a rate limit in the restart
                        // wave after a release. Until 24 September the site said
                        // 'guild' for that, which put up "not in the Thornswood
                        // Discord" and wrote a remembered no over the grace. It is
                        // an outage, so it takes the outage path and never the
                        // Remember(false) one below.
                        bool noDiscord = st.Why == "could not ask Discord";
                        if (st.Why == "offline" || noDiscord)
                        {
                            if (RecentYes())
                            {
                                log(noDiscord
                                    ? "thornswood.net could not ask Discord just now, so the last answer it gave stands and you are let in."
                                    : "thornswood.net did not answer, so the last answer it gave stands and you are let in.");
                                clearedAt = DateTime.Now;
                                if (onAllowed != null) onAllowed();
                                return;
                            }
                            // What actually went wrong stays in the log. The box
                            // gets the plain version.
                            if (st.Message != null && st.Message.Length > 0) log(st.Message);
                            st.Message = noDiscord
                                ? "Thornswood could not ask Discord about your account just now, so it cannot say yet whether you are in. Try again in a minute."
                                : "Could not reach thornswood.net, and it has not checked this copy in recently enough to go on that. Check your internet connection and try again.";
                        }
                        else if (st.Why == "banned" || st.Why == "role" || st.Why == "guild")
                        {
                            // A no the site actually gave is worth writing down
                            // as much as a yes: it is what the next launch falls
                            // back on when the site cannot be reached. Only
                            // those three, because a reply the launcher could
                            // not make sense of is not the site saying no, and a
                            // bad gateway on a Sunday should not follow somebody
                            // around for three days. Not being linked yet is not
                            // an answer from the site either.
                            Remember(false);
                        }

                        log(st.Message ?? "Discord said no.");
                        shout(st);
                    }
                    finally { if (onDone != null) onDone(); }
                });
            });
        }

        /// <summary>The message box, kept here so the wording lives in one place.</summary>
        public static void Explain(Standing st, Action connect)
        {
            string title = "Thornswood";
            string body = st.Message ?? "Discord said no.";

            if (st.Why == "link")
            {
                body += "\n\nPress Connect Discord on the Play page, then try again.";
                Ask.Tell(body, title, Ask.Icon.Info);
                if (connect != null) connect();
                return;
            }

            string ask = InviteQuestion(st);
            if (ask != null)
            {
                body += "\n\n" + ask;
                if (Ask.YesNo(body, title, Ask.Icon.Info))
                {
                    try
                    {
                        var psi = new System.Diagnostics.ProcessStartInfo(st.Invite);
                        psi.UseShellExecute = true;
                        System.Diagnostics.Process.Start(psi);
                    }
                    catch (Exception ex) { Swallow.Note("Door.Explain, opening invite", ex); }
                }
                return;
            }

            // banned, or no invite to offer. Neither is something the
            // launcher can help with, so it says so once and stops.
            Ask.Tell(body, title, Ask.Icon.Warning);
        }

        /// <summary>
        /// The question the box ends on when it can open the Discord for
        /// them, or null when it cannot. 'guild' is somebody not in the
        /// Discord; 'role' is somebody in it who has not been accepted yet,
        /// and the site's message tells them to apply there, so the box offers
        /// the invite the site sent with it rather than leaving them to find
        /// the Discord themselves (#999). Banned never gets one, and only a web
        /// address is ever handed to Windows to open.
        /// tests\test-door-invite.ps1 holds it.
        /// </summary>
        public static string InviteQuestion(Standing st)
        {
            if (st == null || st.Invite == null) return null;
            if (!st.Invite.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
                !st.Invite.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) return null;
            if (st.Why == "guild") return "Open the Discord and join it?";
            if (st.Why == "role") return "Open the Discord to apply?";
            return null;
        }
    }
}
