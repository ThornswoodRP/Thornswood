using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

namespace Thornswood
{
    /// <summary>
    /// Builds Thornswood's animation and body files on this computer, in
    /// Thornswood's own folder, from the collection's own Pandora, BodySlide and
    /// mods (issue #3715). Patrick, 27 Oct 2026, option A on the report page:
    /// "The launcher makes all 45 files on each computer." Until then every
    /// release carried the 39 behavior files and 6 bodies the shipping machine
    /// had built, and those are the game's own graphs with Precision's and True
    /// Directional Movement's patches merged in, and CBBE 3BA's, CBBE's and
    /// HIMBO's bodies: other people's work, which Thornswood has no right on
    /// record to hand on (THIRD-PARTY.md). Made here, nothing of theirs leaves
    /// anybody's machine, the way the main menu and the mods' menus are made
    /// from the person's own game (MadeFromGame, #2827, #3113).
    ///
    /// GeneratedBuild does the build and Generated says whether the files in
    /// the folder are current. This decides when: before every Play (ShellPlay,
    /// beside MadeFromGame), and from Fix (Upkeep), only when the record of
    /// the last build is missing or stale, so an ordinary Play reads the record
    /// and the files and runs nothing. The build list, records\generated.json,
    /// is compiled into the launcher, so the recipe moves with each release.
    ///
    /// Play does not start on a build that failed or a body that is nude
    /// (#405): without the behavior files Precision and True Directional
    /// Movement have no animations, and without the built bodies the
    /// collection's prebuilt CBBE 3BA body, which has no underwear, is what
    /// every woman wears.
    /// </summary>
    static class GeneratedHere
    {
        static GeneratedList list;
        static string listError;

        /// <summary>
        /// The build list compiled into this launcher, or null with ListError
        /// saying why: a launcher built without it is a build fault, reported
        /// as one.
        /// </summary>
        public static GeneratedList List
        {
            get
            {
                if (list != null || listError != null) return list;
                try
                {
                    string text = null;
                    using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("generated.json"))
                    {
                        if (s != null)
                            using (var sr = new StreamReader(s))
                                text = sr.ReadToEnd();
                    }
                    if (string.IsNullOrEmpty(text)) listError = "this launcher was built without its build list, generated.json";
                    else list = GeneratedList.Parse(text, "records\\generated.json");
                }
                catch (GeneratedStop ex) { listError = Failure.Why("GeneratedHere, the list", ex); }
                return list;
            }
        }

        public static string ListError { get { return List == null ? listError : null; } }

        /// <summary>
        /// Whether the files in Thornswood's own folder are current, or null
        /// with problem saying why it cannot be told. Reads the records and the
        /// 45 files; writes nothing.
        /// </summary>
        public static GeneratedState State(out string problem)
        {
            problem = null;
            if (List == null) { problem = ListError; return null; }
            try { return Generated.State(Paths.Root, List); }
            catch (GeneratedStop ex) { problem = Failure.Why("GeneratedHere, a generated file", ex); return null; }
        }

        /// <summary>
        /// Builds them when they are not current. Returns null when they were
        /// current and nothing ran, or a line for the log saying what was
        /// built. Throws GeneratedStop with the sentence to show when they
        /// could not be built, or a body in the folder is nude; the game must
        /// not start then. say gets each line the build says, for the log.
        /// Only in Thornswood's own folder: Play needs one (OwnGameRequired).
        /// </summary>
        public static string Ensure(Action<string> say)
        {
            if (!OwnGame.Active) return null;
            string problem;
            GeneratedState state = State(out problem);
            if (state != null && state.Current) return null;
            if (state == null && List == null) throw new GeneratedStop("Thornswood's animation and body files cannot be built: " + problem + ".");
            if (say != null)
            {
                string why = state != null ? string.Join("; ", state.Why) : problem;
                say("Building Thornswood's animation and body files on this computer with the collection's Pandora and BodySlide (" + why + "). This takes a few minutes.");
            }
            int made = 0;
            OwnGame.Alone(delegate
            {
                var build = new GeneratedBuild();
                build.Root = Paths.Root;
                build.List = List;
                // The build's own lines go to the log only, without the
                // headings' rules: what it ran and what it found.
                build.Say = delegate(string m, string colour)
                {
                    if (say == null || m.Trim().Length == 0) return;
                    say(colour == "Head" ? m + ":" : m.Trim());
                };
                // The game is closed (ClearStuckGame before Play, CloseAndRetry
                // before Fix), and this launcher is what writes the folder.
                build.InUse = null;
                made = build.Run();
            }, delegate { if (say != null) say("An update or a bring-up-to-date is writing into the game folder. The animation and body files are built as soon as that is done."); });
            return "Built " + made + " animation and body files from your collection, in Thornswood's own folder.";
        }

        /// <summary>
        /// What the card says, as a problem for Scan, or null when the files
        /// are current or this install has no folder of its own.
        /// </summary>
        public static string Problem()
        {
            if (!OwnGame.Active) return null;
            string problem;
            GeneratedState state = State(out problem);
            if (state != null && state.Current) return null;
            string why = state != null ? string.Join("; ", state.Why) : problem;
            return "Thornswood's animation and body files are not built for the collection on this computer: " + why + ". " +
                   "Until they are, the game does not start, because the animations would be missing and the bodies would have no underwear.";
        }
    }
}
