using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Scan and Fix on Diagnostics (#2627). Scan finds everything wrong that
    /// the launcher can see: the plugin list against the server's (Verify) and
    /// the rest of the install (Upkeep). Fix puts right everything it found
    /// that it can, then scans again and says what is still wrong, why Fix
    /// could not put it right, and what will.
    ///
    /// Patrick, 16 Oct, with a screenshot of Fix failing on his dev install:
    /// "fix is not fixing it the whole point of the button is to fucking fix
    /// things make it fix things". Fix had fetched the content plugin, left
    /// the light order alone because the server named a plugin of ours that
    /// was not in the build's list, and logged "Fix put 3 things right" with
    /// the blocker still there. It reported a count of what it did, never
    /// whether the problems were gone, and Scan looked at the plugin list
    /// alone while the update waiting on the feed, which carried the plugin,
    /// sat behind a button of its own.
    ///
    /// The order Fix works in: the folder brought up to date from Vortex
    /// first, because everything after it is judged on that folder; then what
    /// writes files (Upkeep.FixOnDisk); then a scan, and the report; then what
    /// asks something or restarts the launcher, last: making Thornswood's own
    /// folder, the update, the Downgrade.
    /// </summary>
    static partial class Shell
    {
        /// <summary>True from Fix pressed to its report, so neither button starts a second one.</summary>
        static bool fixing;

        /// <summary>
        /// What Fix tried and found still there straight after, by kind and
        /// problem. The card says why each could not be put right instead of
        /// what Fix does, and Fix stays off for them until a fresh Scan.
        /// </summary>
        static readonly HashSet<string> triedByFix = new HashSet<string>(StringComparer.Ordinal);

        static string FixKey(Issue i) { return i.Kind + "|" + i.Problem; }

        /// <summary>The quick scan: at startup and when Play is refused. No feed, no record walk, no shortcuts.</summary>
        static void RunScan() { RunScan(false); }

        /// <summary>
        /// The Scan button, and Fix's own scans: <paramref name="pressed"/>
        /// also asks the update feed, walks the game folder's record for lost
        /// files and reads the shortcuts (Upkeep.Look).
        /// </summary>
        static void RunScan(bool pressed)
        {
            if (fixing) return;
            List<Issue> plugins = null;
            VersionDoc feed = null;
            Waiting(delegate
            {
                plugins = Verify.Run(cfg);
                Upkeep.Look(cfg, pressed, null, out feed);
            });
            if (pressed)
            {
                triedByFix.Clear();
                // The update card above Play goes by the same answer, so the
                // two cannot disagree about whether an update is waiting.
                if (feed != null) OnVersionDoc(feed, false);
            }
            ShowVerify(plugins, true);
        }

        /// <summary>
        /// An update check's answer onto the card (Upkeep.FeedSays), and the
        /// card painted again from what it already knows, unless Fix is under
        /// way, whose own scans paint it.
        /// </summary>
        static void FeedOnCard(VersionDoc v)
        {
            Upkeep.FeedSays(v);
            if (!fixing && Verify.LastIssues != null && txtVerifyTitle != null) ShowVerify(Verify.LastIssues, false);
        }

        /// <summary>Verify's issues and Upkeep's, in that order.</summary>
        static List<Issue> AllIssues(List<Issue> plugins)
        {
            var all = new List<Issue>();
            if (plugins != null) all.AddRange(plugins);
            if (Upkeep.LastIssues != null) all.AddRange(Upkeep.LastIssues);
            return all;
        }

        /// <summary>What the card and the log say about one issue: what Fix does, or, once Fix has tried, why it is still there and what will.</summary>
        static string Says(Issue i)
        {
            if (triedByFix.Contains(FixKey(i)) && !string.IsNullOrEmpty(i.WhatWill))
                return i.Problem + " Fix could not put this right. " + i.WhatWill;
            return i.Text;
        }

        /// <summary>
        /// Paints the Scan and Fix card from Verify's issue list and the last
        /// Upkeep look, and redraws Ready to launch from the same lists.
        /// <paramref name="logDetail"/> is true for a fresh Scan (writes the
        /// issue lines to the log); false when Diagnostics opens onto an
        /// already shared LastIssues and should not say the scan again.
        /// </summary>
        static void ShowVerify(List<Issue> issues, bool logDetail)
        {
            if (issues == null) issues = new List<Issue>();
            List<Issue> all = AllIssues(issues);
            int blocking = 0, canFix = 0;
            foreach (Issue i in all)
            {
                if (i.Blocking) blocking++;
                if (i.Fixable && !triedByFix.Contains(FixKey(i))) canFix++;
            }
            // Vortex deploys somewhere else, and Fix makes the own folder from
            // there: the missing mods are in that folder, so Fix does help.
            bool elsewhere = false;
            foreach (Issue i in issues) if (i.VortexFolder != null) elsewhere = true;
            bool tried = triedByFix.Count > 0;

            if (all.Count == 0)
            {
                dotVerify.Fill = Res("Ok");
                txtVerifyTitle.Text = tried ? "Everything is put right" : "Everything matches";
                txtVerifyNote.Text = "Your plugin list is identical to the one the server expects" +
                                     (Verify.BytesChecked
                                        ? ", and every plugin in it is byte for byte the server's."
                                        : ". The server could not be asked about the plugin bytes just now, so only the names were compared.") +
                                     " Nothing else Scan looks at is wrong." +
                                     "\n\nRead from " + Verify.LiveFile;
            }
            else if (CollectionNotDeployed(issues, elsewhere))
            {
                // Vortex has not deployed the collection into the folder the
                // launcher reads, so most of the plugins the server expects are
                // simply not there. One line per missing plugin is a screenful
                // of noise with the one fact that matters left out, so say that
                // fact once and point at Vortex and the collection. The gate is
                // untouched: Play still counts the blocking issues and refuses
                // (Shell Play, Verify.Run).
                dotVerify.Fill = Res("Bad");
                txtVerifyTitle.Text = "The collection is not deployed";
                string dataFolder = Path.Combine(Paths.Game, "Data");
                txtVerifyNote.Text =
                    "Thornswood's mods are not in " + dataFolder + ", so almost none of the " +
                    "collection the server expects is installed where the launcher looks. " +
                    (canFix > 0
                        ? "Fix brings Thornswood's own folder up to date from what Vortex has deployed. Open Vortex and press Deploy first if the collection is not on yet, then Fix."
                        : "Open Vortex and press Deploy, and install the collection first if you have not. The collection card above opens it. Then press Scan again.");
            }
            else
            {
                dotVerify.Fill = Res(blocking > 0 ? "Bad" : "Warn");
                int rest = all.Count - blocking;
                txtVerifyTitle.Text = tried
                    ? (all.Count == 1 ? "1 thing is still wrong after Fix" : all.Count + " things are still wrong after Fix")
                    : blocking > 0
                        ? (blocking == 1 ? "1 problem will stop you connecting" : blocking + " problems will stop you connecting") +
                          (rest > 0 ? ", and " + rest + " more worth putting right" : "")
                        : (all.Count == 1 ? "1 thing worth putting right" : all.Count + " things worth putting right");
                var sb = new System.Text.StringBuilder();
                int shown = 0;
                foreach (Issue i in all)
                {
                    if (shown >= 4) { sb.Append("\nand " + (all.Count - shown) + " more, in the launcher log."); break; }
                    if (shown > 0) sb.Append("\n");
                    sb.Append(Says(i));
                    shown++;
                }
                sb.Append("\n\n").Append(canFix == 0
                    ? "Fix cannot put " + (all.Count == 1 ? "this" : "these") + " right; each line says what will."
                    : canFix == all.Count
                        ? "Fix puts " + (all.Count == 1 ? "it" : "all of them") + " right, then scans again and says anything left."
                        : "Fix puts " + canFix + " of them right, then scans again; for the rest, each line says what will.");
                // Which file it judged. An hour went into a mismatch nobody
                // could place, because the page reported problems without ever
                // saying where it had read the list from.
                sb.Append("\n\nRead from ").Append(Verify.LiveFile);
                txtVerifyNote.Text = sb.ToString();
            }
            // Whenever there is something Fix can do, and only then (#2627).
            btnFix.IsEnabled = canFix > 0 && !fixing;
            btnScan.IsEnabled = !fixing;

            if (logDetail)
            {
                Log("Scan finished. " + all.Count + " issue" + (all.Count == 1 ? "" : "s") + " found" +
                    (all.Count == 0 ? "." : ", and Fix can put right " + (canFix == all.Count ? "all of them." : canFix + " of them.")));
                LogIssues(all);
            }

            // Same Issue lists the card just painted (Verify.LastIssues and
            // Upkeep.LastIssues). Without this, Scan could go green while
            // Ready to launch still showed the previous Run, or the reverse
            // after Fix.
            DrawStatus();
        }

        /*
          WHICH ONES, because the count on its own is not a record of anything.

          FOUND 22 SEPTEMBER while working out why nobody could join the dev
          server. The log said "Scan finished. 4 issues found" and "Something
          needs attention before you can play", and that was the entire record.
          Each session's log goes up to the site, so a tester who cannot press
          Play produced a line with a number in it, while the answer to "why
          can't I play" was sitting in memory at that exact moment.

          BLOCKING FIRST, because those are the ones that refuse Play, and
          capped so a mod list that is 182 wrong does not bury the rest of the
          log. "blocks Play:" is read by the site's session view
          (tests\test-session-logs.js), so it keeps its words.
        */
        static void LogIssues(List<Issue> all)
        {
            if (all.Count == 0) return;
            var named = new List<Issue>();
            foreach (Issue i in all) if (i.Blocking) named.Add(i);
            foreach (Issue i in all) if (!i.Blocking) named.Add(i);
            const int LogAtMost = 25;
            int shown = 0;
            foreach (Issue i in named)
            {
                if (shown >= LogAtMost) break;
                string text = Says(i);
                if (string.IsNullOrEmpty(text)) continue;
                // One line each, flattened: a wrapped sentence in a log file
                // is a sentence somebody has to reassemble by eye.
                string one = text.Replace("\r", " ").Replace("\n", " ").Trim();
                Log("  " + (i.Blocking ? "blocks Play: " : "worth knowing: ") + one);
                shown++;
            }
            if (named.Count > shown)
                Log("  and " + (named.Count - shown) + " more, not written out to keep the log readable.");
        }

        /// <summary>
        /// True when Vortex has not deployed the collection into the folder the
        /// launcher reads: most of the plugins the server expects are simply not
        /// in Data, so the card should say that once rather than list every one.
        /// Not when Vortex deploys somewhere else (that has its own line and Fix
        /// helps), and only past a floor so a couple of missing files is still
        /// read plugin by plugin. This decides only what the card shows; the Play
        /// gate is unchanged and still counts the blocking issues.
        /// </summary>
        static bool CollectionNotDeployed(List<Issue> issues, bool elsewhere)
        {
            if (elsewhere) return false;
            if (Verify.Expected <= 0) return false;
            int missing = 0;
            foreach (Issue i in issues) if (i.FileMissing) missing++;
            // A handful of missing files is a mod or two, not the whole
            // collection. Half of what the server expects, and at least ten,
            // is the collection not being there at all.
            return missing >= 10 && missing * 2 >= Verify.Expected;
        }

        static bool Has(List<Issue> l, string kind)
        {
            if (l == null) return false;
            foreach (Issue i in l) if (i.Kind == kind && i.Fixable) return true;
            return false;
        }

        // ------------------------------------------------------------ Fix

        /// <summary>The Fix button.</summary>
        static void RunFix() { RunFix(false); }

        /// <summary>
        /// True when Fix after an update found Thornswood's own folder being
        /// prepared, so the folder's finish runs it (FolderWork) instead of
        /// leaving it for a press of Fix (#3201).
        /// </summary>
        static bool fixWhenFolderReady;

        /// <summary>
        /// With fixWhenFolderReady: the Fix waiting for the folder is the one
        /// after Vortex finished (FixAfterVortex, #5200), not after an update.
        /// </summary>
        static bool fixWhenFolderReadyAfterVortex;

        /// <summary>
        /// Install now's second half (#3201): the update has gone in, or
        /// failed, and Fix's whole path runs on the folder as it left it.
        /// </summary>
        static void FixAfterUpdate(bool wentIn)
        {
            if (wentIn) Upkeep.Forget(IssueKind.Update);
            RunFix(true);
        }

        /// <param name="afterUpdate">True when an update has just gone in or failed (Install now, the automatic update, the first start of a new launcher): the log says so, and FixRest never takes that same update a second time (#3201).</param>
        /// <param name="afterVortex">True when Vortex has just finished the collection revision the card opened (FixAfterVortex, #5200): the log says so, and FixRest leaves a waiting update on the card, where UpdateBySelf already decided about it.</param>
        static void RunFix(bool afterUpdate, bool afterVortex = false)
        {
            if (fixing) return;
            // Nothing is written into a folder while it is being made or
            // brought up to date. On 11 Oct a new dev build's first Fix ran
            // while its own folder was being made and wrote into the Steam
            // copy (#2403). After an update, the folder's finish runs it.
            if (ownGameBusy && afterUpdate) { fixWhenFolderReady = true; Log("Thornswood's own Skyrim folder is being prepared. The scan after the update runs, and puts right what it finds, as soon as the folder is ready."); return; }
            if (ownGameBusy && afterVortex) { fixWhenFolderReady = true; fixWhenFolderReadyAfterVortex = true; Log("Thornswood's own Skyrim folder is being prepared. The scan after Vortex runs, and puts right what it finds, as soon as the folder is ready."); return; }
            if (ownGameBusy) { Log("Thornswood's own Skyrim folder is being prepared. Press Fix when it is done: nothing is put right in a folder while it is being made."); return; }
            if (Downgrade.Busy) { Log("The Downgrade is running. Press Fix when it is done."); return; }
            if (playBar.Active) { Log("An update is going in. Press Fix when it is done."); return; }
            if (playing) { Log("Quit the game first. Skyrim writes the plugin list back when it exits, which would undo the fix."); return; }
            // A Skyrim left behind with no window is closed; one on screen is
            // asked about, because it is somebody's session.
            if (!ClearStuckGame(true)) return;
            if (Checks.GameRunning())
            {
                Log("Close Skyrim first. It writes the plugin list back when it exits, which would undo the fix.");
                return;
            }

            fixing = true;
            btnFix.IsEnabled = false;
            btnScan.IsEnabled = false;
            triedByFix.Clear();
            Verify.OwnFolderNext = false;
            Log(afterUpdate ? "The update is done. Scanning everything again, and putting right what the scan finds."
                : afterVortex ? "Vortex is done. Scanning everything, and putting right what the scan finds."
                : "Fix: scanning everything first.");
            List<Issue> plugins = null, rest = null;
            VersionDoc feed = null;
            try
            {
                Waiting(delegate
                {
                    plugins = Verify.Run(cfg);
                    rest = Upkeep.Look(cfg, true, null, out feed);
                });
            }
            catch (Exception ex)
            {
                fixing = false;
                Log("Fix could not scan first (" + ex.Message.TrimEnd('.') + "), so nothing was changed.");
                ShowVerify(Verify.LastIssues, false);
                return;
            }
            if (AllIssues(plugins).Count == 0)
            {
                fixing = false;
                Log(afterUpdate ? "The scan after the update found nothing wrong."
                    : afterVortex ? "The scan after Vortex found nothing wrong."
                    : "Fix found nothing to put right.");
                ShowVerify(plugins, false);
                return;
            }

            // The folder first: the plugins, the lost files and this build's
            // own files are judged on the folder as Vortex has it now. Fix
            // carries on whether it succeeds or not, and the scan after says.
            VersionDoc known = feed;
            if (Has(rest, IssueKind.Behind) &&
                StartOwnGame(false, true, delegate { FixRest(known, afterUpdate, afterVortex); }, delegate { FixRest(known, afterUpdate, afterVortex); }))
                return;
            FixRest(known, afterUpdate, afterVortex);
        }

        /// <summary>
        /// Fix after the folder: what writes files, a scan, the report, and
        /// then what asks or restarts. <paramref name="feed"/> is the update
        /// feed Fix's first scan read, so the update is judged on one answer.
        /// <paramref name="afterUpdate"/> and <paramref name="afterVortex"/> are RunFix's.
        /// </summary>
        static void FixRest(VersionDoc feed, bool afterUpdate, bool afterVortex)
        {
            var said = new List<string>();
            Action<string> say = delegate(string m) { lock (said) said.Add(m); };
            List<Issue> found = null;
            try
            {
                Waiting(delegate
                {
                    VersionDoc f;
                    found = new List<Issue>(Verify.Run(cfg));
                    found.AddRange(Upkeep.Look(cfg, true, feed, out f));
                    Upkeep.FixOnDisk(cfg, found, feed, say);
                });
            }
            catch (Exception ex) { say("Fix stopped part way (" + ex.Message.TrimEnd('.') + ")."); }
            foreach (string m in said) Log(m);

            // Scan again: this is the answer, not what Fix did.
            List<Issue> plugins = Rescan(feed);

            // The shortcuts still not right after Ensure: Windows' own pictures,
            // which only an Explorer restart clears. Asked first, because the
            // desktop and taskbar vanish for a second.
            if (Has(Upkeep.LastIssues, IssueKind.Icon) && Has(found, IssueKind.Icon))
            {
                bool yes = Ask.YesNo(
                    "The shortcut icon is still out of date after pointing the shortcuts at the current icon.\n\n" +
                    "Fix can throw away the pictures Windows has remembered for the shortcuts and redraw them. The desktop and taskbar blink once while Explorer restarts. Nothing is lost.\n\nGo ahead?",
                    "Thornswood", Ask.Icon.Question);
                if (yes)
                {
                    string repaired = null;
                    try { Waiting(delegate { repaired = Icons.Repair(); }); }
                    catch (Exception ex) { repaired = "Could not refresh the icon (" + ex.Message.TrimEnd('.') + ")."; }
                    Log(repaired);
                    plugins = Rescan(feed);
                }
            }

            // What Fix tried and is still there is said with why, and Fix
            // stays off for it. What comes next (the own folder, the update,
            // the Downgrade) is not tried yet.
            triedByFix.Clear();
            if (found != null)
            {
                var foundKeys = new HashSet<string>(StringComparer.Ordinal);
                foreach (Issue i in found) if (i.Fixable) foundKeys.Add(FixKey(i));
                foreach (Issue i in AllIssues(plugins))
                {
                    if (i.Kind == IssueKind.Update || i.Kind == IssueKind.Skyrim || i.Kind == IssueKind.OwnFolder) continue;
                    if (foundKeys.Contains(FixKey(i))) triedByFix.Add(FixKey(i));
                }
            }
            fixing = false;
            Report(plugins);

            // Last, what asks something or restarts the launcher. With no
            // folder of its own and Skyrim on another build, the Downgrade
            // comes first: the folder is made from its download when it is
            // done (RunDowngrade), and cannot be made before.
            if (Paths.Collection && Has(Upkeep.LastIssues, IssueKind.Skyrim)) { RunDowngrade(); return; }
            if (Verify.OwnFolderNext) { AskOwnGame(false); return; }
            if (Has(Upkeep.LastIssues, IssueKind.Update) && feed != null)
            {
                OnVersionDoc(feed, false);
                bool waiting = updatePending && (pendingPacks.Count > 0 || selfUpdateOffered);
                // UpdateBySelf decided about the update a moment ago and left
                // it on the card (FixAfterVortex): automatic updates are off,
                // or a game is open. Fix after Vortex is not a press of Fix
                // and does not overrule that, and since Fix has not tried the
                // update it is not marked as tried.
                bool leftOnCard = waiting && afterVortex;
                if (leftOnCard)
                {
                    Log("The update is on the card above Play. Install now takes it.");
                }
                // Straight after an update, only a newer one on the feed is
                // taken: a Ship that published again while the first was
                // going in. The one that was just tried is never taken a
                // second time, whether it went in or failed, because doing
                // the same thing again is not a fix for why it did not hold.
                else if (waiting && afterUpdate && updateTried != null &&
                    updateTried.IsSupersetOf(UpdateParts(pendingPacks, feed, selfUpdateOffered)))
                {
                    Log(updateTriedWentIn
                        ? "The update that just went in is still on the feed as waiting, so Fix does not take it a second time. Send the launcher log to the Discord: this one needs looking at."
                        : "The update did not go in, so Fix does not take it again. The update's own line in the log says why; Install now takes it once that is put right.");
                }
                else if (waiting)
                {
                    Log((afterUpdate && updateTried != null ? "A newer update went out while that one was going in. Fix is taking it now, last." : "Fix is taking the update now, last.") +
                        (selfUpdateOffered ? " The launcher restarts into the new one when it is in." : ""));
                    RunUpdate(delegate(bool wentIn)
                    {
                        Upkeep.Forget(IssueKind.Update);
                        RunScan(true);
                        if (Has(Upkeep.LastIssues, IssueKind.Skyrim)) RunDowngrade();
                    });
                    return;
                }
                else
                {
                    // The mod updates wait for the collection (OnVersionDoc), so
                    // Fix has tried the update and the card says why it waits.
                    Log("The update waits until the collection is installed, as the card above Play says.");
                }
                if (Upkeep.LastIssues != null && !leftOnCard)
                    foreach (Issue i in Upkeep.LastIssues) if (i.Kind == IssueKind.Update) triedByFix.Add(FixKey(i));
                ShowVerify(plugins, false);
            }
            if (Has(Upkeep.LastIssues, IssueKind.Skyrim)) RunDowngrade();
        }

        /// <summary>Verify and Upkeep again, with the feed Fix already read. Returns Verify's list; Upkeep's is Upkeep.LastIssues.</summary>
        static List<Issue> Rescan(VersionDoc feed)
        {
            List<Issue> plugins = null;
            try
            {
                Waiting(delegate
                {
                    VersionDoc f;
                    plugins = Verify.Run(cfg);
                    Upkeep.Look(cfg, true, feed, out f);
                });
            }
            catch (Exception ex) { Log("Fix could not scan again afterwards (" + ex.Message.TrimEnd('.') + "). Press Scan."); }
            return plugins ?? Verify.LastIssues ?? new List<Issue>();
        }

        /// <summary>
        /// What Fix leaves the person with: only what is still wrong, each with
        /// why Fix could not put it right and what will (#2627). Never a count
        /// of what was done while a problem remains: "Fix put 3 things right"
        /// with the blocker still there was the line that made Fix look
        /// broken.
        /// </summary>
        static void Report(List<Issue> plugins)
        {
            List<Issue> left = AllIssues(plugins);
            if (left.Count == 0) Log("Fix put right everything Scan found.");
            else
            {
                int next = 0;
                foreach (Issue i in left)
                    if (i.Fixable && (i.Kind == IssueKind.Update || i.Kind == IssueKind.Skyrim || i.Kind == IssueKind.OwnFolder)) next++;
                Log(left.Count == next
                    ? "Fix put right everything else. What is left, Fix does next:"
                    : "Fix is done. Still wrong, and what will put it right:");
                LogIssues(left);
            }
            ShowVerify(plugins, false);
        }
    }
}
