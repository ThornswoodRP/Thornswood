using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Everything Scan finds wrong with this install that is not the plugin
    /// list, and what Fix does about each (#2627). Verify holds the plugin
    /// list against the server; this holds the rest: an update waiting on the
    /// feed, Thornswood's own folder behind Vortex or missing files, this
    /// build's own files changed, Windows' Skyrim folders left pointed at
    /// Thornswood, the shortcut icon, the client runtime, Steam, and the
    /// Skyrim build.
    ///
    /// Patrick, 16 Oct, with a screenshot of Fix failing: "the scan fix button
    /// should scan for anything wrong if something is found it gets fix upon
    /// clicking fix", and "the fix should fix everything its great it will
    /// tell you what is still wrong but I want it to fix everything we can
    /// predicate". Until then each of these had a button of its own on
    /// Diagnostics, or none, and Scan looked at none of them.
    ///
    /// Look reads and writes nothing in the game folder (the update check
    /// keeps its own cache of the feed, as every update check does). Fix's
    /// steps are FixOnDisk here, for everything that writes files, and the
    /// rest, which asks something or restarts the launcher, is the shell's
    /// (ShellScanFix.cs). Nothing here is a retry or a wait: each step runs
    /// once, and Scan afterwards says what is still wrong and why.
    /// </summary>
    static class Upkeep
    {
        // Which check found an issue: IssueKind, in Verify.cs.

        /// <summary>What the last Look found, for the card and Ready to launch to share. Null until the first.</summary>
        public static List<Issue> LastIssues;

        /// <summary>
        /// The launcher waiting on this install's Velopack channel, by its
        /// number, or null when there is none (#4825). Set by the shell from
        /// the launcher check's own answer (LauncherAnswer in ShellUpdate.cs),
        /// which lands before the feed's answer that FeedSays is given, so the
        /// card and the update card above Play go by the same launcher check.
        /// The feed's launcherVersion and launcherUrl are not read for this:
        /// they named the launcher's own self update, which Velopack replaced.
        /// </summary>
        public static volatile string LauncherWaiting;

        /// <summary>
        /// Takes one kind off LastIssues once the shell has put it right some
        /// other way: the bring-up-to-date that finished, the update that went
        /// in. The next Look finds it again if it is still there.
        /// </summary>
        public static void Forget(string kind)
        {
            List<Issue> l = LastIssues;
            if (l == null) return;
            var kept = new List<Issue>();
            foreach (Issue i in l) if (i.Kind != kind) kept.Add(i);
            LastIssues = kept;
        }

        /// <summary>
        /// Everything this class can find. <paramref name="pressed"/> is true
        /// when somebody pressed Scan or Fix: the update feed is asked, the
        /// game folder's record is walked for lost files, and the shortcuts
        /// are read. At startup and before Play the quick checks run alone,
        /// because the update check, the icon pass and the folder's own
        /// refresh run then anyway. <paramref name="known"/> is a feed already
        /// read, which is used instead of asking again (Fix's scan after its
        /// work); <paramref name="feed"/> is the feed this look went by, or
        /// null. Runs on a pool thread; never throws.
        /// </summary>
        public static List<Issue> Look(Config cfg, bool pressed, VersionDoc known, out VersionDoc feed)
        {
            var l = new List<Issue>();
            VersionDoc v = known;
            try { Feed(cfg, pressed, ref v, l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, the update feed", ex); }
            bool behind = false;
            if (OwnGame.Active)
            {
                try { behind = Folder(cfg, l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, the own folder", ex); }
                try { LostFiles(cfg, pressed, behind, v, l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, lost files", ex); }
            }
            if (!Paths.Collection)
            {
                try { BuildFiles(l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, this build's files", ex); }
            }
            try { Made(l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, the files made from the game", ex); }
            if (OwnGame.Active)
            {
                try { Built(l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, the animation and body files", ex); }
            }
            try { WindowsFolders(l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, Windows' Skyrim folders", ex); }
            if (pressed)
            {
                try { Icon(l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, the shortcut icon", ex); }
            }
            if (!Paths.Collection)
            {
                try { Client(l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, the client runtime", ex); }
            }
            try { SteamUp(l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, Steam", ex); }
            try { GameBuild(cfg, l); } catch (Exception ex) { Swallow.Note("Upkeep.Look, the Skyrim build", ex); }
            LastIssues = l;
            feed = v;
            return l;
        }

        /// <summary>
        /// The update check's own answer, into what the card shows, so the
        /// Fix button knows about an update waiting without Scan being pressed:
        /// the start, the feed watch and Check now all land here through
        /// Shell.OnVersionDoc. Replaces the update and feed lines of the last
        /// look and keeps the rest.
        /// </summary>
        public static void FeedSays(VersionDoc v)
        {
            if (v == null) return;
            var l = new List<Issue>();
            VersionDoc known = v;
            try { Feed(null, false, ref known, l); } catch (Exception ex) { Swallow.Note("Upkeep.FeedSays", ex); return; }
            List<Issue> was = LastIssues;
            if (was != null)
                foreach (Issue i in was) if (i.Kind != IssueKind.Update && i.Kind != IssueKind.Feed) l.Add(i);
            LastIssues = l;
        }

        // ------------------------------------------------------------ checks

        /// <summary>A newer launcher or release on the feed, or a feed that holds Play or did not answer.</summary>
        static void Feed(Config cfg, bool pressed, ref VersionDoc v, List<Issue> l)
        {
            if (v == null && pressed)
            {
                string why = null;
                try
                {
                    v = Updater.Check(cfg);
                    if (v == null) why = "it had nothing to say";
                }
                catch (Exception ex) { why = ex.Message.TrimEnd('.'); }
                if (why != null)
                {
                    l.Add(Issue.Of(IssueKind.Feed, "The update feed did not answer (" + why + "), so it is not known whether this build is current.", null,
                        "Fix cannot take an update it cannot see. See whether thornswood.net opens in your browser: if it does not, the site is down and it is not your end; if it does, send the launcher log to the Discord.", true));
                    return;
                }
            }
            if (v == null) return;
            string launcher = LauncherWaiting;
            bool newLauncher = !string.IsNullOrEmpty(launcher);
            List<Pack> packs = Updater.Pending(cfg, v);
            var parts = new List<string>();
            if (newLauncher) parts.Add("launcher " + launcher + ", and this one is " + Updater.Version);
            if (packs.Count > 0) parts.Add(packs.Count + (packs.Count == 1 ? " mod update" : " mod updates"));
            if (parts.Count > 0)
                l.Add(Issue.Of(IssueKind.Update, "An update is waiting on the update feed: " + string.Join("; ", parts.ToArray()) + ".",
                    "Fix takes it last, after everything else" + (newLauncher ? ", and the launcher restarts into the new one." : "."),
                    "Install now, on the card above Play, takes it too. Mod updates wait until the Thornswood collection is installed in Vortex, and when the update itself failed, its line in the log says why.", true));
            FeedNotice notice = FeedNotice.From(v, Updater.Version);
            if (notice.Hold != null && !newLauncher)
                l.Add(Issue.Of(IssueKind.Feed, notice.Hold, null, "Nothing on this machine changes that: the update feed holds Play for everybody until staff lift it.", true));
        }

        /// <summary>
        /// Thornswood's own folder against Vortex's deployment: refused when
        /// Vortex deploys into a Thornswood folder, behind when Vortex has
        /// deployed since the folder was last brought up to date. True when
        /// it is behind, so the lost files are not judged on the old record.
        /// </summary>
        static bool Folder(Config cfg, List<Issue> l)
        {
            string refused = OwnGame.RefusedSource(cfg);
            if (refused != null)
            {
                l.Add(Issue.Of(IssueKind.VortexInto, refused, null, "Only Vortex's own settings can change where it deploys, so Fix cannot.", false));
                return false;
            }
            bool due;
            try { due = OwnGame.NeedsRefresh(cfg); }
            catch (Exception ex)
            {
                // Not knowing is said, and Fix brings the folder up to date
                // anyway, because the refresh itself says what is in the way.
                l.Add(Issue.Of(IssueKind.Behind, "Thornswood could not tell whether its own Skyrim folder matches what Vortex has deployed (" + ex.Message.TrimEnd('.') + ").",
                    "Fix brings the folder up to date from Vortex, which says what is in the way if it cannot.", Upkeep.CloseAndRetry, false));
                return true;
            }
            if (!due) return false;
            l.Add(Issue.Of(IssueKind.Behind, "Vortex has deployed since Thornswood's own Skyrim folder was last brought up to date, so the folder is behind the collection.",
                "Fix brings it up to date from Vortex first.", "The bring-up-to-date's own line in the log says what stopped it.", true));
            return true;
        }

        const string CloseAndRetry = "Close Skyrim and Vortex, then press Fix again; if it is still here after that, send the launcher log to the Discord.";

        /// <summary>
        /// Files the own folder had and lost (OwnGame.Lost), and the script
        /// extender, whose two files the Ready to launch rows ask for by name.
        /// The record is walked when somebody pressed Scan or Fix, or when one
        /// of those two files is missing; otherwise it is three megabytes read
        /// for nothing at every start.
        /// </summary>
        static void LostFiles(Config cfg, bool pressed, bool behind, VersionDoc v, List<Issue> l)
        {
            string loader = Paths.Loader;
            string skse = Path.Combine(Paths.Game, "skse64_1_6_1170.dll");
            bool skseGone = !File.Exists(loader) || !File.Exists(skse);
            if (!pressed && !skseGone) return;

            OwnGame.LostFiles lost = OwnGame.Lost(!behind);
            if (lost.Vortex.Count > 0)
            {
                bool blocks = Has(lost.Vortex, "skse64_loader.exe") || Has(lost.Vortex, "skse64_1_6_1170.dll");
                l.Add(Issue.Of(IssueKind.Lost, Count(lost.Vortex.Count, "of Vortex's files") + " missing from Thornswood's own folder: " + Some(lost.Vortex) + ".",
                    "Fix puts " + (lost.Vortex.Count == 1 ? "it" : "them") + " back from Vortex's own copies.",
                    "Vortex does not have " + (lost.Vortex.Count == 1 ? "it" : "them") + " any more: in Vortex, press Deploy Mods, then press Scan.", blocks));
            }
            if (lost.Skyrim.Count > 0)
                l.Add(Issue.Of(IssueKind.Skyrim, Count(lost.Skyrim.Count, "of Skyrim's own files") + " missing from Thornswood's own folder: " + Some(lost.Skyrim) + ".",
                    "Fix starts the Downgrade, which asks first: Steam downloads 1.6.1170's own files under your account and they go into Thornswood's folder.",
                    DowngradeNeeds, true));
            if (lost.Ours.Count > 0)
            {
                string what = Count(lost.Ours.Count, "of Thornswood's own files") + " missing from its game folder: " + Some(lost.Ours) + ".";
                bool waiting = false;
                foreach (Issue i in l) if (i.Kind == IssueKind.Update) waiting = true;
                if (waiting)
                    l.Add(Issue.Of(IssueKind.OursLost, what, "The update Fix takes puts them back.", "Install now, on the card above Play, puts them back.", true));
                else if (Updater.CanResync(cfg, v))
                    l.Add(Issue.Of(IssueKind.OursLost, what, "Fix checks every file of this release and fetches the ones that are missing or changed.",
                        "The release's files could not be fetched; its line in the log says why. Press Fix again when thornswood.net answers.", true));
                else
                    l.Add(Issue.Of(IssueKind.OursLost, what, null, "The update feed names no release to fetch them from, so the next update puts them back.", true));
            }
            if (skseGone && !Has(lost.Vortex, "skse64_loader.exe") && !Has(lost.Vortex, "skse64_1_6_1170.dll"))
                l.Add(Issue.Of(IssueKind.ScriptExtender, "The script extender is not in Thornswood's own folder (" + (!File.Exists(loader) ? "skse64_loader.exe" : "skse64_1_6_1170.dll") +
                    " is missing), and Vortex's record of the folder never listed it.", null,
                    "Vortex deploys the script extender with the collection: in Vortex, enable the Thornswood profile and press Deploy, then press Scan, and Fix brings the folder up to date.", true));
        }

        const string DowngradeNeeds = "The Downgrade needs Steam open and signed in to the account that owns Skyrim. Its card on the Play page says how far it got and why it stopped.";

        /// <summary>This build's own files: the kept ones under Data\Platform, Thornswood.ini and the shipped settings files.</summary>
        static void BuildFiles(List<Issue> l)
        {
            var names = new List<string>();
            foreach (string rel in Keep.Changed()) names.Add(Path.GetFileName(rel));
            if (!File.Exists(ThornIni.File_)) names.Add("Thornswood.ini");
            foreach (string c in Swap.MissingConfigs()) names.Add(c);
            if (names.Count == 0) return;
            l.Add(Issue.Of(IssueKind.BuildFiles, Count(names.Count, "of this build's own files") + " missing or not as this build shipped " + (names.Count == 1 ? "it" : "them") + ": " + Some(names) +
                ". Another server's launcher, or a session that fell over, can leave them like that.",
                "Fix puts them back.", CloseAndRetry, false));
        }

        /// <summary>
        /// The main menu, the notice board's meshes and the mods' menus with no
        /// gold values, which Thornswood makes from the person's own game
        /// (MadeFromGame, #2827, #3113): missing or not the bytes it makes.
        /// Made here without writing, so the line says whether Fix can make
        /// them or which of the game's or the mods' files stops it.
        /// </summary>
        static void Made(List<Issue> l)
        {
            List<string> off = MadeFromGame.OutOfDate();
            if (off.Count == 0) return;
            var names = new List<string>();
            foreach (string rel in off) names.Add(Path.GetFileName(rel));
            string why = null;
            bool mod = false, last = false, english = false;
            foreach (FromGameFile f in MadeFromGame.Make(off))
                if (off.Contains(f.Rel) && f.Problem != null)
                {
                    why = f.Problem.TrimEnd('.');
                    mod = MadeFromGame.FromMod(f.Rel);
                    last = f.Rel.Equals(LastPlugin.File, StringComparison.OrdinalIgnoreCase);
                    english = f.NotEnglish;
                    break;
                }
            string what = Count(names.Count, "of the files Thornswood makes from your game") + " missing or changed: " + Some(names) +
                          ". Until " + (names.Count == 1 ? "it is" : "they are") + " made, " + MadeFromGame.Shows(off) + ".";
            if (why == null)
                l.Add(Issue.Of(IssueKind.MadeFromGame, what, "Fix makes them again from your game's own files.", CloseAndRetry, false));
            else
                l.Add(Issue.Of(IssueKind.MadeFromGame, what + " They cannot be made from this game: " + why + ".", null,
                    english ? "Thornswood plays in English: in Steam, right click Skyrim Special Edition, Properties, Language, pick English and let Steam download it, then press Scan."
                    : last ? "Install the collection revision Thornswood pins in Vortex and press Deploy there, so its plugins are the ones " + LastPlugin.Name + " is made from, then press Scan."
                    : mod ? "Install the collection revision Thornswood pins in Vortex, so its SkyUI, SkyHUD and moreHUD are the ones these are made from, then press Scan."
                        : "Put the game back on the Skyrim build Thornswood pins (the Downgrade on the Play page does that), then press Scan.", false));
        }

        /// <summary>
        /// The behavior files and covered bodies Thornswood builds on this
        /// computer from the collection's Pandora and BodySlide (GeneratedHere,
        /// #3715): never built, or stale since the collection, the mod list or
        /// the build list changed. Play builds them too; Fix builds them now.
        /// </summary>
        static void Built(List<Issue> l)
        {
            string problem = GeneratedHere.Problem();
            if (problem == null) return;
            l.Add(Issue.Of(IssueKind.Generated, problem,
                "Fix builds them now with the collection's Pandora and BodySlide, which takes a few minutes; Play does the same.",
                "Fix said what stopped the build: put that right in Vortex, deploy, then press Scan.", false));
        }

        /// <summary>Windows' Skyrim folders still pointed at Thornswood while Skyrim is not running.</summary>
        static void WindowsFolders(List<Issue> l)
        {
            if (!Swap.LeftRedirected() || Checks.GameRunning()) return;
            l.Add(Issue.Of(IssueKind.WindowsFolders, "Windows' Skyrim settings and saves folders are still pointed at Thornswood, though Skyrim is not running, which is what a game that fell over leaves behind.",
                "Fix puts them back.", "Windows would not let go of one of them: restart the PC, then press Fix again.", false));
        }

        /// <summary>A shortcut to this launcher that Icons.Ensure would change.</summary>
        static void Icon(List<Issue> l)
        {
            List<string> off = Icons.OutOfDate();
            if (off.Count == 0) return;
            l.Add(Issue.Of(IssueKind.Icon, "The shortcut icon is out of date: " + Some(off) + ".",
                "Fix points the shortcuts at the current icon, and when that is not enough it asks to restart Explorer so Windows draws them again.",
                "Unpin the launcher from the taskbar and pin it again: Windows keeps its own note of a pinned item, which nothing else can reach.", false));
        }

        /// <summary>The six client runtime files against the record compiled into the launcher.</summary>
        static void Client(List<Issue> l)
        {
            if (ClientRuntime.Recorded().Count == 0 || ClientRuntime.Good()) return;
            l.Add(Issue.Of(IssueKind.Client, "The multiplayer client is not this build's: " + Checks.ClientDetail() + ".",
                "Fix puts the recorded files back, from the kept copies or the update feed.",
                "The update feed had no copy to give: press Scan when thornswood.net opens, and send the launcher log to the Discord if it says this again.", true));
        }

        /// <summary>Steam, which the game checks ownership through.</summary>
        static void SteamUp(List<Issue> l)
        {
            if (Checks.SteamRunning()) return;
            l.Add(Issue.Of(IssueKind.Steam, "Steam is not running, and the game checks through it that you own Skyrim.", "Fix starts Steam.",
                "Start Steam yourself, signed in to the account that owns Skyrim, then press Scan.", true));
        }

        /// <summary>The game Thornswood runs is not 1.6.1170, or archives it shares with the Steam copy changed there.</summary>
        static void GameBuild(Config cfg, List<Issue> l)
        {
            if (cfg == null || !Downgrade.Needed(cfg)) return;
            string what = "The Skyrim Thornswood runs is not 1.6.1170, the build the server runs: " + Downgrade.Describe(cfg) + ".";
            if (Downgrade.Busy)
                l.Add(Issue.Of(IssueKind.Skyrim, what, null, "The Downgrade is running; its card on the Play page says how far it has got.", true));
            else
                l.Add(Issue.Of(IssueKind.Skyrim, what,
                    "Fix starts the Downgrade, which asks first: Steam downloads 1.6.1170's own files under your account and they go into Thornswood's own folder. The Steam copy is not changed.",
                    DowngradeNeeds, true));
        }

        // ------------------------------------------------------------ fixing

        /// <summary>
        /// Fix's steps that write files, for the issues in <paramref name="found"/>,
        /// on a pool thread. Everything that writes into the game folder runs
        /// with the folder to itself (OwnGame.Alone), after any refresh or
        /// update under way. What each step did, or why it could not, goes to
        /// <paramref name="say"/>. The Downgrade, making the own folder, the
        /// bring-up-to-date and the update are the shell's, because they ask
        /// something or restart the launcher.
        /// </summary>
        public static void FixOnDisk(Config cfg, List<Issue> found, VersionDoc v, Action<string> say)
        {
            if (say == null) say = delegate(string m) { };
            var kinds = new HashSet<string>(StringComparer.Ordinal);
            foreach (Issue i in found) if (i.Fixable) kinds.Add(i.Kind);

            if (kinds.Contains(IssueKind.WindowsFolders))
            {
                bool put = false;
                try { put = Swap.Restore(); } catch (Exception ex) { say("Windows' Skyrim folders could not be put back (" + ex.Message.TrimEnd('.') + ")."); }
                if (put) say("Windows' Skyrim settings and saves folders are back to normal.");
            }
            if (kinds.Contains(IssueKind.Steam)) StartSteam(say);

            OwnGame.Alone(delegate
            {
                if (kinds.Contains(IssueKind.Lost))
                {
                    try { OwnGame.PutBackLost(cfg, OwnGame.Lost(true).Vortex, say); }
                    catch (Exception ex) { Swallow.Note("Upkeep.FixOnDisk, putting back Vortex's files", ex); say("Vortex's files could not be put back (" + ex.Message.TrimEnd('.') + ")."); }
                }
                if (kinds.Contains(IssueKind.BuildFiles)) PutBackBuildFiles(say);
                if (kinds.Contains(IssueKind.MadeFromGame))
                {
                    try { string made = MadeFromGame.Ensure(); if (!string.IsNullOrEmpty(made)) say(made); }
                    catch (Exception ex) { Swallow.Note("Upkeep.FixOnDisk, the files made from the game", ex); say("The files made from your game could not be written (" + ex.Message.TrimEnd('.') + ")."); }
                }
                if (kinds.Contains(IssueKind.Generated))
                {
                    try { string built = GeneratedHere.Ensure(say); if (!string.IsNullOrEmpty(built)) say(built); }
                    catch (GeneratedStop ex) { say(ex.Message); }
                    catch (Exception ex) { Swallow.Note("Upkeep.FixOnDisk, the animation and body files", ex); say("The animation and body files could not be built (" + ex.Message.TrimEnd('.') + ")."); }
                }
                if (kinds.Contains(IssueKind.Client))
                {
                    try { ClientRuntime.Heal(cfg, say); }
                    catch (Exception ex) { Swallow.Note("Upkeep.FixOnDisk, the client runtime", ex); say("The client runtime could not be put back (" + ex.Message.TrimEnd('.') + ")."); }
                }
                if (kinds.Contains(IssueKind.Plugins) || kinds.Contains(IssueKind.Personal) || kinds.Contains(IssueKind.OwnFolder))
                {
                    try { Verify.Fix(cfg, say, Updater.ReleaseCopy(cfg, v)); }
                    catch (Exception ex) { Swallow.Note("Upkeep.FixOnDisk, the plugin list", ex); say("The plugin list could not be put right (" + ex.Message.TrimEnd('.') + ")."); }
                }
                // Thornswood's own files, from the release this install is
                // on, when no update is waiting to bring them anyway.
                if (kinds.Contains(IssueKind.OursLost) && !kinds.Contains(IssueKind.Update) && Updater.CanResync(cfg, v))
                {
                    try
                    {
                        if (!Updater.Resync(cfg, v, say)) say("The update feed's release does not have its files on the site one by one, so the missing files come with the next update.");
                    }
                    catch (Exception ex) { Swallow.Note("Upkeep.FixOnDisk, the release's files", ex); say("Thornswood's own files could not be fetched (" + ex.Message.TrimEnd('.') + ")."); }
                }
            }, delegate { say("An update or a bring-up-to-date is writing into the game folder. Fix goes on as soon as that is done."); });

            if (kinds.Contains(IssueKind.Icon))
            {
                int moved = Icons.Ensure(true);
                if (moved > 0) say(moved + (moved == 1 ? " shortcut points" : " shortcuts point") + " at the current icon now.");
            }
        }

        /// <summary>Repair's steps, on what Scan found: the kept files, Thornswood.ini, the shipped settings files, and the mod settings Play writes.</summary>
        static void PutBackBuildFiles(Action<string> say)
        {
            try { int seeded = Keep.Seed(); if (seeded > 0) say("Kept a copy of " + seeded + " of this build's file" + (seeded == 1 ? "" : "s") + " to put back from."); }
            catch (Exception ex) { Swallow.Note("Upkeep.PutBackBuildFiles, Keep.Seed", ex); }
            string back = Keep.PutBack();
            if (!string.IsNullOrEmpty(back)) say(back);
            try { string ini = ThornIni.Ensure(); if (!string.IsNullOrEmpty(ini)) say(ini); }
            catch (Exception ex) { Swallow.Note("Upkeep.PutBackBuildFiles, Thornswood.ini", ex); }
            int cfgs = Swap.PutBackMissingConfigs();
            if (cfgs > 0) say("Put back " + cfgs + " of the settings file" + (cfgs == 1 ? "" : "s") + " this build shipped.");
            // The settings two mods rewrite on the way out, the same write
            // Play makes. Scan does not count those as wrong, because those
            // mods rewrite them at every exit by design and Play writes them
            // back every time; here they are written with the rest.
            try { int rules = Enforce.Apply(); if (rules > 0) say("Put back " + rules + " mod setting" + (rules == 1 ? "" : "s") + " this build holds in place."); }
            catch (Exception ex) { Swallow.Note("Upkeep.PutBackBuildFiles, Enforce", ex); }
        }

        /// <summary>
        /// Starts Steam, in the tray the way it usually runs (-silent), rather
        /// than opening its window over the launcher; through its steam://
        /// link when steam.exe is not where Steam's install says. True when
        /// one of the two was started.
        /// </summary>
        public static bool StartSteam(Action<string> say)
        {
            if (say == null) say = delegate(string m) { };
            string root = "";
            try { root = Steam.Path_() ?? ""; } catch (Exception ex) { Swallow.Note("Upkeep.StartSteam, finding Steam", ex); }
            string exe = root.Length > 0 ? Path.Combine(root, "steam.exe") : "";
            if (exe.Length > 0 && File.Exists(exe))
            {
                try { Process.Start(new ProcessStartInfo(exe, "-silent") { UseShellExecute = false }); say("Started Steam."); return true; }
                catch (Exception ex) { say("steam.exe would not start (" + ex.Message.TrimEnd('.') + "), so Steam's link is asked instead."); }
            }
            if (Downgrade.AskSteam("steam://open/main", say)) { say("Asked Windows to start Steam."); return true; }
            say("Steam could not be started. Start it yourself.");
            return false;
        }

        // ------------------------------------------------------------ words

        static bool Has(List<string> rels, string name)
        {
            foreach (string r in rels) if (string.Equals(Path.GetFileName(r), name, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>"One of X is" or "N of X are".</summary>
        static string Count(int n, string ofWhat)
        {
            return (n == 1 ? "One " : n.ToString("n0") + " ") + ofWhat + (n == 1 ? " is" : " are");
        }

        /// <summary>The first three, then how many more.</summary>
        static string Some(List<string> items)
        {
            const int show = 3;
            var l = new List<string>();
            for (int i = 0; i < items.Count && i < show; i++) l.Add(items[i]);
            string s = string.Join(", ", l.ToArray());
            return items.Count > show ? s + " and " + (items.Count - show).ToString("n0") + " more" : s;
        }
    }
}
