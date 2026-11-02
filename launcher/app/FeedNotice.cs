using System;

namespace Thornswood
{
    /// <summary>
    /// What the update feed has to say to everybody, and whether it holds Play.
    ///
    /// To Do List entry 262: "There is no way to say anything to everybody when
    /// an outside thing breaks". The feed has carried a message field from the
    /// start, and all the launcher ever did with it was write one line into the
    /// log, where it scrolled away. So on the day Steam, Nexus or Discord
    /// changes something under everybody there was nowhere to say so that a
    /// person would actually see, and no way to stop people launching into it.
    ///
    /// Three fields in version.json, all optional and all set by hand in the
    /// releases repo, because no script writes them:
    ///
    ///   message       one or two sentences for everybody, shown in a bar
    ///                 above Play until a feed without it arrives. On its own
    ///                 it never holds Play.
    ///   maintenance   true holds Play, with the message as the reason.
    ///   minLauncher   a launcher older than this version holds Play.
    ///
    /// Pure on purpose: it takes the document and the running version and
    /// says what to show, so launcher\tests\test-feed-notice.ps1 builds the launcher
    /// and asks it every case through VersionDoc.Parse without a window.
    ///
    /// It is a kill switch, so every doubt comes out open. A document that was
    /// never read, a field missing from an older feed, a minimum that is not a
    /// version number, a maintenance value that is not plainly on: each of
    /// those shows the message at most and leaves Play alone.
    /// </summary>
    public sealed class FeedNotice
    {
        /// <summary>The bar's heading. Null when there is no bar.</summary>
        public string Title;
        /// <summary>The sentences under the heading.</summary>
        public string Text = "";
        /// <summary>Why Play is held, as one sentence for the log and the
        /// button's tooltip. Null when the feed does not hold it.</summary>
        public string Hold;
        /// <summary>What the Play button says while the feed holds it.</summary>
        public string Button;

        public static FeedNotice From(VersionDoc v, string running)
        {
            var n = new FeedNotice();
            // No document means the check did not answer. That already has its
            // own handling in Shell (CheckFailed); a notice that nobody sent
            // must not add a hold of its own on top of it.
            if (v == null) return n;

            string said = v.message == null ? "" : v.message.Trim();
            // The message as a sentence, for where more follows it. The bar
            // shows it as written when it stands alone.
            string whole = said;
            if (whole.Length > 0 && ".!?".IndexOf(whole[whole.Length - 1]) < 0) whole += ".";
            string min = v.minLauncher == null ? "" : v.minLauncher.Trim();
            bool tooOld = IsVersion(min) && IsVersion(running) && Updater.IsNewer(min, running);

            if (On(v.maintenance))
            {
                n.Title = "Closed for maintenance";
                n.Text = (whole.Length > 0 ? whole : "Something is being put right, and Play is off until it is.") +
                         " Open Diagnostics to look again.";
                n.Hold = "Play is off: Thornswood is closed for maintenance." + (whole.Length > 0 ? " " + whole : "");
                n.Button = "CLOSED FOR MAINTENANCE";
            }
            else if (tooOld)
            {
                n.Title = "This launcher is too old to play";
                n.Text = "Thornswood needs launcher " + min + " or newer, and this one is " + running +
                         ". Install the launcher update, or download the launcher again from the site." +
                         (whole.Length > 0 ? " " + whole : "");
                n.Hold = "Play is off: this launcher is " + running + " and Thornswood needs " + min + " or newer.";
                n.Button = "UPDATE THE LAUNCHER";
            }
            else if (said.Length > 0)
            {
                n.Title = "Notice";
                n.Text = said;
            }
            return n;
        }

        /// <summary>
        /// Whether a maintenance value means on. The field is a string on
        /// purpose; see VersionDoc.maintenance. Only the plain ways of saying
        /// yes count, so a typo leaves Play open rather than shut.
        /// </summary>
        public static bool On(string s)
        {
            if (s == null) return false;
            string t = s.Trim().ToLowerInvariant();
            return t == "true" || t == "1" || t == "yes" || t == "on";
        }

        /// <summary>
        /// Digits and dots, with an optional leading v, and nothing else.
        /// Updater.IsNewer answers "newer" for any two strings it cannot parse
        /// that are not equal, which is right for an update nobody could
        /// otherwise install and wrong for a hold: "latest" typed as the
        /// minimum would shut Play for everybody. Nine digits a part at most,
        /// because a longer one does not fit the int IsNewer parses it into
        /// and lands on that same fallback.
        /// </summary>
        public static bool IsVersion(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            string t = s.Trim();
            if (t.StartsWith("v") || t.StartsWith("V")) t = t.Substring(1);
            if (t.Length == 0) return false;
            foreach (string part in t.Split('.'))
            {
                if (part.Length == 0 || part.Length > 9) return false;
                foreach (char c in part)
                    if (c < '0' || c > '9') return false;
            }
            return true;
        }
    }
}
