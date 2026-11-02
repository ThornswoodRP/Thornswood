using System;
using System.IO;
using System.Text;
using System.Threading;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// The collection card notices Vortex finishing an update by itself (#5136).
    ///
    /// Patrick, 31 Oct, on his dev install: "after updating to collection
    /// version 6 I had to click in the diagnasotics page and manually click
    /// scan and fix the app didnt catch automatically that I had updated to
    /// revision 6". Two things were missing, and both had to be there:
    ///
    ///   1. Nothing looked at Vortex again. DrawStatus reads the installed
    ///      revision fresh, but only runs on a page change, a scan, a feed
    ///      answer or Steam starting and stopping. Somebody who pressed
    ///      "Open revision N", updated in Vortex and came back to the Play
    ///      page touched none of those, so the card said the mods needed
    ///      updating long after they did not.
    ///   2. The updates that waited on the collection were never asked for
    ///      again. OnVersionDoc returns early while ModsMissing, with no mod
    ///      updates pending, so even a redraw that took the card down left
    ///      the release built on the new revision uninstalled and Play open
    ///      on the old one. Only Scan, which hands its feed answer back to
    ///      OnVersionDoc, ever put that right.
    ///
    /// So while the collection card or the not-confirmed note is up, the two
    /// second tick compares what Vortex has on disk (its state.v2 files and
    /// the plugin list, by name, size and write time, which is a directory
    /// listing and nothing more). Only when that changes is the revision read
    /// again, off the UI thread, because the read walks Vortex's whole state
    /// database. When the answer differs from what the card was drawn from,
    /// the card is drawn again; when the card comes down, the feed is asked
    /// again the same way the start and Scan ask it, with Play shut on
    /// CHECKING until it answers, so the waiting updates are offered, and go
    /// in by themselves when automatic updates are on.
    ///
    /// Every later change Vortex writes is looked at the same way, so the
    /// card follows Vortex to where it stops. Play's own gates (Verify, and
    /// OwnGameRefreshIfDue for Thornswood's own folder) still judge the
    /// folder Vortex left, as they always have.
    ///
    /// Since #5200 the card's button opens Vortex itself at the server's
    /// revision (Shell.OpenCollection), and when the card comes down here
    /// Scan and Fix run after the feed's answer (FixAfterVortex), so the
    /// press on Diagnostics Patrick made by hand is made for him.
    /// </summary>
    static partial class Shell
    {
        /// <summary>What Vortex had on disk at the last look, or null before the first one with the card up.</summary>
        static string vortexSeen;

        /// <summary>A look is under way on a pool thread, so the tick never starts a second one.</summary>
        static bool vortexLooking;

        /// <summary>
        /// The revision and the problem the collection card was last drawn
        /// from (DrawStatus), so a look can tell whether anything it reads
        /// would change what the card says.
        /// </summary>
        static string collectionDrawn = "";

        static string CollectionKey(int revision, string problem)
        {
            return revision + "|" + problem;
        }

        /// <summary>
        /// Vortex's state.v2 files and the plugin list Play reads, by name,
        /// size and write time. Null when the listing itself failed, which is
        /// noted and means no look this tick.
        /// </summary>
        static string VortexOnDisk()
        {
            var sb = new StringBuilder();
            try
            {
                string state = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vortex\\state.v2");
                if (Directory.Exists(state))
                {
                    string[] files = Directory.GetFiles(state);
                    Array.Sort(files, StringComparer.OrdinalIgnoreCase);
                    foreach (string f in files)
                    {
                        var i = new FileInfo(f);
                        sb.Append(i.Name).Append('|').Append(i.Length).Append('|').Append(i.LastWriteTimeUtc.Ticks).Append('\n');
                    }
                }
                if (!string.IsNullOrEmpty(Paths.Live))
                {
                    string plugins = Path.Combine(Paths.Live, "plugins.txt");
                    if (File.Exists(plugins))
                    {
                        var i = new FileInfo(plugins);
                        sb.Append("plugins.txt|").Append(i.Length).Append('|').Append(i.LastWriteTimeUtc.Ticks).Append('\n');
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Shell.VortexOnDisk", ex); return null; }
            return sb.ToString();
        }

        /// <summary>
        /// The tick's look at Vortex while the collection card or note is up.
        /// Cheap when nothing changed: a directory listing compared with the
        /// last one.
        /// </summary>
        static void WatchVortex()
        {
            if (!collectionBarUp && !collectionNoteUp) { vortexSeen = null; return; }
            // Fix and an update paint the card themselves when they are done.
            if (vortexLooking || fixing || updating || playing) return;
            vortexLooking = true;
            string was = vortexSeen;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string now = null;
                int revision = 0;
                string problem = "";
                bool look = false;
                try
                {
                    now = VortexOnDisk();
                    look = now != null && now != was;
                    if (look)
                    {
                        revision = Checks.CollectionRevision(cfg);
                        problem = CollectionProblem(revision);
                    }
                }
                catch (Exception ex) { Swallow.Note("Shell.WatchVortex", ex); look = false; }
                try
                {
                    Dispatcher.UIThread.Post(delegate
                    {
                        vortexLooking = false;
                        if (now == null) return;
                        vortexSeen = now;
                        if (look) VortexChanged(revision, problem);
                    });
                }
                catch (Exception ex) { vortexLooking = false; Swallow.Note("Shell.WatchVortex, dispatch", ex); }
            });
        }

        /// <summary>
        /// On the UI thread, after a look found Vortex's files changed. Draws
        /// the card again when the revision or the problem it was drawn from
        /// moved, and asks the feed again when the card came down.
        /// </summary>
        static void VortexChanged(int revision, string problem)
        {
            if (CollectionKey(revision, problem) == collectionDrawn) return;
            // The card may have come down some other way while the look ran.
            if (!collectionBarUp && !collectionNoteUp) return;
            bool barWasUp = collectionBarUp;
            DrawStatus();
            if (!barWasUp || collectionBarUp)
            {
                if (barWasUp && revision > 0)
                    LogOnly("Vortex now has collection revision " + revision + " installed; the server's is " + Updater.FeedCollectionRevision + ".");
                return;
            }
            Log("Vortex now has collection revision " + revision + " installed, the one the server was built against. Checking for the updates that waited on it, then scanning and fixing.");
            // Scan and Fix follow the answer (FixAfterVortex), once the
            // update it brings has been taken or left on the card (#5200).
            fixAfterVortex = true;
            // Play stays shut on CHECKING until the feed answers, as at the
            // start: the release built on this revision may have mod updates.
            updatePending = true;
            updateAnswered = false;
            DrawStatus();
            ThreadPool.QueueUserWorkItem(delegate { CheckUpdatesBackground(false); });
        }

        /// <summary>
        /// Set when the collection card came down because Vortex finished,
        /// so the feed's answer is followed by Scan and Fix (#5200). Cleared
        /// by the one answer that runs them.
        /// </summary>
        static bool fixAfterVortex;

        /// <summary>
        /// After a feed answer on the UI thread (CheckUpdatesBackground,
        /// after OnVersionDoc and UpdateBySelf): Scan and Fix, once, when the
        /// collection card came down because Vortex finished (#5200).
        ///
        /// Patrick, 31 Oct, after updating to revision 6 through the card:
        /// "I had to click in the diagnasotics page and manually click scan
        /// and fix". The card already came down by itself (#5136); this is
        /// the press he made by hand. Vortex has just rewritten the plugin
        /// list and the mods, so the folder Play reads is judged and put
        /// right now, not at the next Play.
        ///
        /// The order is the one a press of Install now and then Fix has.
        /// When UpdateBySelf started the update the new revision's release
        /// brought, the update's own end runs Fix (FixAfterUpdate), so this
        /// does not run a second one beside it. Otherwise Fix runs here and
        /// leaves the update where UpdateBySelf left it, on the card: it is
        /// waiting because automatic updates are off, or a game is open, and
        /// Fix after Vortex does not overrule that (FixRest).
        /// </summary>
        static void FixAfterVortex()
        {
            if (!fixAfterVortex) return;
            fixAfterVortex = false;
            if (updating) return;
            RunFix(false, true);
        }
    }
}
