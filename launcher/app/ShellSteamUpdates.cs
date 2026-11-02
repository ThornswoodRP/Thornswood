using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Avalonia.Threading;

namespace Thornswood
{
    static partial class Shell
    {
        /// <summary>
        /// On the way in, once no downgrade is needed: Steam's Updates setting
        /// for Skyrim is read into the log and, when it does not hold the
        /// version (SteamUpdates.OnStart), set. With Steam closed that happens
        /// here and now, with nothing to ask. With Steam open it needs Steam
        /// closed for a moment, so the question is put once the window is up.
        ///
        /// Issue #493, Patrick on 29 September: "Our Repo should write this so
        /// it doesn't auto update the game and people have to re do the
        /// downgrade again". Until then it was only ever offered right after a
        /// downgrade, so anybody downgraded before that question existed, or
        /// who pressed No once, had nothing holding Steam back. Patrick on 27
        /// October (#3600): always hold it, so nothing the person answered
        /// stops the start writing it with Steam closed, and the question says
        /// so.
        /// </summary>
        static void HoldSteamUpdatesOnStart()
        {
            string target = OwnGame.Source(cfg);
            string manifest = SteamUpdates.ManifestFor(target);
            string what = SteamUpdates.OnStart(SteamUpdates.NeedsHolding(manifest), SteamUpdates.SteamRunning(), playing);
            if (what == SteamUpdates.Write) { Log(SteamUpdates.Hold(manifest)); return; }
            string upd = SteamUpdates.Report(target);
            if (upd != null) Log(upd);
            if (what != SteamUpdates.Ask) return;
            Dispatcher.UIThread.Post(delegate
            {
                try { AskToHoldSteamUpdates(); }
                catch (Exception ex) { Swallow.Note("Shell.HoldSteamUpdatesOnStart, the question", ex); }
            }, DispatcherPriority.ApplicationIdle);
        }

        /// <summary>
        /// The question: whether to close Steam now so the launcher can set
        /// Steam's Updates setting for Skyrim to "Wait until I launch the game"
        /// (SteamUpdates). Asked on the way in (above), only while Steam is
        /// open. It used to follow every downgrade as well, when the downgrade
        /// put the Steam copy on 1.6.1170; the downgrade never writes the Steam
        /// copy now (#1218), so there is nothing there for the setting to hold.
        ///
        /// Steam is usually running. A change made to the file while Steam
        /// runs is undone when Steam closes, so Yes closes Steam itself
        /// (steam://exit, the same as Steam, Exit), waits for it to go, makes
        /// the change, and starts Steam again in the tray, on a pool thread so
        /// the window does not freeze while Steam shuts down. Once Steam has
        /// been asked to exit it is started again whatever happens after, and
        /// a Steam slower than a minute is waited for rather than left closed
        /// (#3600). Never while Skyrim runs, which needs Steam. No means not
        /// now (SteamUpdates.NotNow): nothing is remembered, so the next start
        /// writes it with Steam closed or asks again with Steam open. Play is
        /// never held on this.
        /// </summary>
        static void AskToHoldSteamUpdates()
        {
            string manifest = "";
            try { manifest = SteamUpdates.ManifestFor(OwnGame.Source(cfg)); } catch (Exception ex) { Swallow.Note("Shell.AskToHoldSteamUpdates, finding Steam's file for Skyrim", ex); }
            if (!SteamUpdates.NeedsHolding(manifest)) return;
            if (playing || Checks.GameRunning()) return;
            // Steam closed since the start looked: nothing to close, so nothing to ask.
            if (!SteamUpdates.SteamRunning()) { Log(SteamUpdates.Hold(manifest)); return; }

            if (!Ask.YesNo(SteamUpdates.Question(manifest), "Thornswood", Ask.Icon.Question))
            {
                Log(SteamUpdates.NotNow + " " + SteamUpdates.How);
                return;
            }

            Log("Closing Steam for a moment to change its Updates setting for Skyrim. It starts again by itself.");
            ThreadPool.QueueUserWorkItem(delegate
            {
                string said = CloseSteamAndHold(manifest);
                SayFromPool(said);
            });
        }

        /// <summary>
        /// Yes, off the window's thread: asks Steam to exit, waits for it to
        /// go, makes the change, and starts Steam again. What it returns is the
        /// line for the log.
        ///
        /// Issue #3600: the minute's wait used to end in "nothing was changed"
        /// with Steam already told to exit, and only the branch that wrote
        /// started Steam again, so a Steam that finished closing after the
        /// minute stayed closed. Now the minute only decides when the person
        /// is told Steam is still closing; the wait goes on until Steam has
        /// gone, and every way out after the exit request starts Steam again.
        /// </summary>
        static string CloseSteamAndHold(string manifest)
        {
            bool asked = false;
            string said;
            try
            {
                asked = Downgrade.AskSteam("steam://exit", LogOnly);
                if (!asked)
                    said = "Steam could not be asked to close, so nothing was changed. " + SteamUpdates.How;
                else
                {
                    bool closed = SteamUpdates.WaitClosed(60);
                    if (!closed)
                    {
                        SayFromPool(SteamUpdates.StillClosing);
                        closed = SteamUpdates.WaitClosed(SteamUpdates.NoLimit);
                    }
                    said = closed
                        ? SteamUpdates.Hold(manifest, false)
                        : "Could not tell whether Steam had closed, so nothing was changed. " + SteamUpdates.How;
                }
            }
            catch (Exception ex) { said = "Could not change Steam's Updates setting for Skyrim: " + ex.Message + " " + SteamUpdates.How; }
            // Steam was asked to exit, so it is started again whatever came after, as Yes said.
            if (asked)
            {
                try { StartSteamAgain(); }
                catch (Exception ex) { Swallow.Note("Shell.CloseSteamAndHold, starting Steam again", ex); }
            }
            return said;
        }

        /// <summary>A line for the log from a pool thread, through the window's thread.</summary>
        static void SayFromPool(string said)
        {
            try { Dispatcher.UIThread.Post(delegate { Log(said); }); }
            catch (Exception ex) { Swallow.Note("Shell.AskToHoldSteamUpdates, saying what happened", ex); LogOnly(said); }
        }

        /// <summary>
        /// Starts Steam again after the question closed it, in the tray the way
        /// it usually runs (-silent), rather than opening its window over the
        /// launcher. Through its steam:// link when steam.exe is not where
        /// Steam's install says.
        /// </summary>
        static void StartSteamAgain()
        {
            // The same start Fix makes when Scan finds Steam not running (#2627).
            Upkeep.StartSteam(LogOnly);
        }
    }
}
