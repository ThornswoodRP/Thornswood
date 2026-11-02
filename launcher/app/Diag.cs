using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace Thornswood
{
    class Reading
    {
        public string Title, Detail;
        public int Level;              // 0 fine, 1 worth a look, 2 wrong
        public Reading(int level, string title, string detail) { Level = level; Title = title; Detail = detail; }
    }

    /// <summary>
    /// Everything the launcher can work out about this machine without being
    /// asked a question, and a way to put it in one file.
    ///
    /// The point is the file. Half of every support conversation is spent
    /// getting someone to find four logs in three folders, and most people
    /// give up before the end of it.
    /// </summary>
    static class Diag
    {
        public static string ReportDir { get { return Path.Combine(Paths.ProfileDir, "Reports"); } }

        /*
          What the report holds, said once (#3565). The Diagnostics page used
          to promise "nothing personal beyond your Windows user name in file
          paths" in words written apart from Summary(), which also wrote the
          machine's name, the user name on a line of its own and the server's
          address. Now every file Report() puts in the zip and every line
          Summary() writes names its part in one of these two lists, Held()
          throws for a part that is in neither, and the page's words are made
          from the same lists by WhatTheReportHolds(), so the page cannot say
          less than the zip carries. launcher\tests\test-3565-report-words.js holds the
          code to it. Several keys may share words; the page says them once.
        */
        class Part
        {
            public readonly string Key, Words;
            public Part(string key, string words) { Key = key; Words = words; }
        }

        static readonly Part[] InTheZip =
        {
            new Part("crash log", "the newest crash log"),
            new Part("skse64.log", "the script extender log"),
            new Part("SSEDisplayTweaks.log", "SSE Display Tweaks' log"),
            new Part("plugins.txt", "your plugin list"),
            new Part("plugins-expected.txt", "the plugin list this build expects"),
            new Part("launcher.log", "the launcher log"),
            new Part("SkyrimPrefs.ini", "your game's settings file (SkyrimPrefs.ini)"),
            new Part("summary.txt", "a short summary"),
        };

        static readonly Part[] InTheSummary =
        {
            new Part("built", "when the report was built"),
            new Part("launcher", "the launcher's version"),
            new Part("install", "the folder Thornswood is installed in"),
            new Part("server", "which server it joins (main or dev) and its port"),
            new Part("auto join", "your auto join, auto update and theme settings"),
            new Part("auto update", "your auto join, auto update and theme settings"),
            new Part("theme", "your auto join, auto update and theme settings"),
            new Part("game read from", "which Skyrim folder was read and which one ran last"),
            new Part("ran last from", "which Skyrim folder was read and which one ran last"),
            new Part("game exe", "the game's size against the one expected"),
            new Part("expected exe", "the game's size against the one expected"),
            new Part("multiplayer client", "whether the multiplayer client is there"),
            new Part("plugins enabled", "how many plugins are on and what is wrong with the list"),
            new Part("mod list problems", "how many plugins are on and what is wrong with the list"),
            new Part("script extender plugins", "the script extender plugins"),
            new Part("windows", "the Windows version"),
            new Part("64 bit", "whether Windows is 64 bit"),
            new Part("processors", "the number of processors"),
            new Part("disk free", "the free disk space"),
        };

        /// <summary>How many reports Report() keeps in ReportDir; it deletes older ones (#3565).</summary>
        public const int KeptReports = 3;

        static Part Held(Part[] list, string key)
        {
            foreach (Part p in list) if (p.Key == key) return p;
            throw new InvalidOperationException("The support report would hold \"" + key +
                "\", which Diag's lists do not name, so the Diagnostics page would not say it is in there (#3565).");
        }

        static string Said(Part[] list)
        {
            var words = new List<string>();
            foreach (Part p in list) if (!words.Contains(p.Words)) words.Add(p.Words);
            if (words.Count == 1) return words[0];
            return string.Join(", ", words.GetRange(0, words.Count - 1).ToArray()) + " and " + words[words.Count - 1];
        }

        /// <summary>
        /// The Diagnostics page's words under "One zip for Discord": every file
        /// in the zip, every part of its summary, what in them names the person,
        /// and how long the zips are kept.
        /// </summary>
        public static string WhatTheReportHolds()
        {
            return "It holds " + Said(InTheZip) + ". The summary says " + Said(InTheSummary) + ". " +
                   "File paths in these carry your Windows user name, and the launcher log names the Discord account you linked " +
                   "and the microphone the game used. Beyond those, nothing in it names you or this PC. " +
                   "The " + KeptReports + " newest reports stay in Profile, Reports on this PC, and building another deletes the oldest. " +
                   "Nothing sends them anywhere; you choose who gets one.";
        }

        static string Size(long b)
        {
            if (b < 1024) return b + " B";
            if (b < 1024 * 1024) return (b / 1024) + " KB";
            if (b < 1024L * 1024 * 1024) return (b / (1024.0 * 1024.0)).ToString("F1") + " MB";
            return (b / (1024.0 * 1024.0 * 1024.0)).ToString("F1") + " GB";
        }

        /// <summary>The first line of the newest crash log that names a plugin, if there is one.</summary>
        public static string CrashCulprit()
        {
            try
            {
                Entry e = Files.NewestCrash();
                if (e == null) return "";
                foreach (string line in File.ReadLines(e.FullPath))
                {
                    // Crash Logger prints the faulting module on a line of its own.
                    int at = line.IndexOf("Probable callstack", StringComparison.OrdinalIgnoreCase);
                    if (at >= 0) continue;
                    string t = line.Trim();
                    if (t.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) ||
                        t.EndsWith(".esp", StringComparison.OrdinalIgnoreCase) ||
                        t.EndsWith(".esm", StringComparison.OrdinalIgnoreCase))
                        return t;
                }
            }
            catch (Exception ex) { Swallow.Note("Diag.CrashCulprit", ex); }
            return "";
        }

        // serverServing: the server's resources port took a connection, which
        // is the only thing that proves the server is running rather than its
        // machine merely being switched on. voiceUp: whether the voice
        // service's /health answered, null before it has been asked. Both
        // were on the Server page until it was cut (#3146).
        public static List<Reading> Readings(Config cfg, bool serverUp, bool serverServing, string pingText,
                                             bool? voiceUp, string talkKey)
        {
            var l = new List<Reading>();

            // ---- which Skyrim actually ran
            string ran = Checks.LastRunFrom();
            if (ran.Length == 0)
                l.Add(new Reading(1, "The game has not run from here yet",
                    "Nothing to read. This fills in the first time you press Play and quit."));
            else if (Checks.RanFromBuild())
                l.Add(new Reading(0, "The last session ran this build",
                    ran + ". That is the folder this launcher manages, which is what you want."));
            else
                l.Add(new Reading(2, "The last session ran a different Skyrim",
                    "It ran from " + ran + ", so none of this build's mods were loaded and none of its settings applied. " +
                    "Start the game from this launcher rather than from Steam or a desktop shortcut."));

            // ---- mod list
            int blocking = 0, total = 0;
            try { foreach (Issue i in Verify.Run()) { total++; if (i.Blocking) blocking++; } } catch (Exception ex) { Swallow.Note("Diag.Readings, Verify.Run", ex); }
            if (blocking > 0)
                l.Add(new Reading(2, blocking == 1 ? "1 problem with your mod list" : blocking + " problems with your mod list",
                    "The server compares your plugin list against the one this build shipped with and will refuse the connection. Press Fix above."));
            else if (total > 0)
                l.Add(new Reading(1, total == 1 ? "1 note about your mod list" : total + " notes about your mod list",
                    "Nothing that stops you connecting. Press Scan above to read them."));
            else
                l.Add(new Reading(0, "Your mod list matches the server", Checks.EnabledPlugins() + " plugins, in the order it expects."));

            // ---- crash
            Entry crash = null;
            try { crash = Files.NewestCrash(); } catch (Exception ex) { Swallow.Note("Diag.Readings, NewestCrash", ex); }
            if (crash == null)
                l.Add(new Reading(0, "No crash logs", "Nothing has fallen over on this machine."));
            else
            {
                string who = CrashCulprit();
                string dmp = CrashDump.Beside(crash.FullPath);
                l.Add(new Reading(1, "Newest crash: " + crash.Name,
                    (who.Length > 0 ? "The log points at " + who + ". " : "") +
                    "Send the report below rather than reading it yourself." +
                    (dmp != null ? " Its full crash snapshot is " + dmp + ". The report leaves it out: it holds what was in the game's memory, so it stays on this PC." : "")));
            }

            // ---- server
            if (serverUp && serverServing)
                l.Add(new Reading(0, "The server answers", "round trip " + pingText + "."));
            else if (serverUp)
                l.Add(new Reading(1, "The server's machine answers, but the server is not listening",
                    "Round trip " + pingText + ". The server is probably not running. It is not something on this PC."));
            else
                l.Add(new Reading(1, "The server did not answer",
                    "That is not always a problem. Plenty of hosts drop the kind of packet this test uses, so try connecting before assuming it is down."));

            // ---- voice
            if (voiceUp == true)
                l.Add(new Reading(0, "Voice answers",
                    "The server's voice service is running. Keep this launcher open while you play: voice runs in it." +
                    (string.IsNullOrEmpty(talkKey) ? "" : " Hold " + talkKey + " to talk.")));
            else if (voiceUp == false)
                l.Add(new Reading(1, "Voice did not answer",
                    "The server's voice service is not running, so nobody will hear anybody until it is. It is not something on this PC."));

            // ---- steam
            l.Add(Checks.SteamRunning()
                ? new Reading(0, "Steam is running", "Skyrim still checks ownership through it, even though this build sits outside your Steam folder.")
                : new Reading(2, "Steam is not running", "Start Steam and sign in. The game will not launch without it."));

            // ---- disk
            try
            {
                var d = new DriveInfo(Path.GetPathRoot(Paths.Root));
                long free = d.AvailableFreeSpace;
                l.Add(free < 3L * 1024 * 1024 * 1024
                    ? new Reading(2, "Almost no disk space left", Size(free) + " free on " + d.Name + ". Saves and updates both need room.")
                    : new Reading(0, "Disk space is fine", Size(free) + " free on " + d.Name + "."));
            }
            catch (Exception ex) { Swallow.Note("Diag.Readings, disk space", ex); }

            // ---- leftovers
            if (Checks.GameRunning())
                l.Add(new Reading(2, "Skyrim is running right now",
                    Checks.GameVisible()
                        ? "There is a window for it somewhere."
                        : "With no window anywhere. It is left over from a crash. Press Play and the launcher will clear it."));

            return l;
        }

        /// <summary>
        /// Writes a zip of every log worth having plus a summary, and returns
        /// the path. Slow enough to want a background thread.
        /// </summary>
        public static string Report(Config cfg, string launcherVersion)
        {
            Directory.CreateDirectory(ReportDir);
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmm");
            string work = Path.Combine(ReportDir, "build-" + stamp);
            if (Directory.Exists(work)) Directory.Delete(work, true);
            Directory.CreateDirectory(work);

            try
            {
                Grab(work, "skse64.log", Path.Combine(Paths.LiveMyGames, "SKSE\\skse64.log"));
                Grab(work, "SSEDisplayTweaks.log", Path.Combine(Paths.LiveMyGames, "SKSE\\SSEDisplayTweaks.log"));
                Grab(work, "plugins.txt", Path.Combine(Paths.Live, "plugins.txt"));
                Grab(work, "plugins-expected.txt", Path.Combine(Paths.Golden, "plugins.txt"), "plugins-expected.txt");
                Grab(work, "launcher.log", Paths.LogFile);
                Grab(work, "SkyrimPrefs.ini", Path.Combine(Paths.LiveMyGames, "SkyrimPrefs.ini"));

                Entry crash = Files.NewestCrash();
                if (crash != null) Grab(work, "crash log", crash.FullPath);

                Held(InTheZip, "summary.txt");
                File.WriteAllText(Path.Combine(work, "summary.txt"), Summary(cfg, launcherVersion));

                string zip = Path.Combine(ReportDir, "thornswood-" + stamp + ".zip");
                if (File.Exists(zip)) File.Delete(zip);
                ZipFile.CreateFromDirectory(work, zip, CompressionLevel.Optimal, false);
                KeepNewest();
                return zip;
            }
            finally
            {
                try { Directory.Delete(work, true); } catch (Exception ex) { Swallow.Note("Diag.Report, clearing work folder", ex); }
            }
        }

        /// <summary>
        /// Every press used to leave its zip in ReportDir for good (#3565).
        /// The page says KeptReports are kept, so the older ones go. The names
        /// carry yyyyMMdd-HHmm, so their order is the order they were built.
        /// </summary>
        static void KeepNewest()
        {
            string[] made = Directory.GetFiles(ReportDir, "thornswood-*.zip");
            Array.Sort(made, StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < made.Length - KeptReports; i++)
            {
                try { File.Delete(made[i]); }
                catch (Exception ex) { Swallow.Note("Diag.KeepNewest, deleting " + Path.GetFileName(made[i]), ex); }
            }
        }

        static void Grab(string into, string part, string file) { Grab(into, part, file, null); }

        static void Grab(string into, string part, string file, string rename)
        {
            Held(InTheZip, part);
            try
            {
                if (!File.Exists(file)) return;
                string name = rename != null ? rename : Path.GetFileName(file);
                File.Copy(file, Path.Combine(into, name), true);
            }
            catch (Exception ex) { Swallow.Note("Diag.Grab, " + file, ex); }
        }

        static string Summary(Config cfg, string launcherVersion)
        {
            var s = new StringBuilder();
            void Add(string k, string v) { Held(InTheSummary, k); s.AppendLine(k.PadRight(22) + v); }
            void Section(string k) { Held(InTheSummary, k); s.AppendLine(k); s.AppendLine(new string('-', k.Length)); }

            s.AppendLine("ThornsWood - report");
            s.AppendLine("===================");
            Held(InTheSummary, "built");
            s.AppendLine(DateTime.Now.ToString("dddd d MMMM yyyy, HH:mm"));
            s.AppendLine();

            Add("launcher", launcherVersion);
            Add("install", Paths.Root);
            // Which server, not its address (#3565): the launcher keeps the
            // address off every page (Pages.WirePages), and a zip posted to
            // Discord is a page too. Staff need to know main or dev.
            Add("server", (cfg.IsDev ? "dev" : "main") + ", port " + cfg.ServerPort);
            Add("auto join", cfg.AutoJoin ? "on" : "off");
            Add("auto update", cfg.AutoUpdate ? "on" : "off");
            Add("theme", cfg.Theme);
            s.AppendLine();

            // The game's facts from Paths.Skyrim: the Steam copy while the own
            // folder is chosen and not made, when Paths.Game is Profile\Payload
            // and has no game in it (#1235). The client is Game's either way.
            if (Paths.OwnFirst) Add("game read from", Paths.Skyrim + " (the own folder is not made yet)");
            try { Add("game exe", new FileInfo(Paths.SkyrimExe).Length.ToString("n0") + " bytes"); } catch (Exception ex) { Swallow.Note("Diag.Summary, game exe size", ex); }
            Add("expected exe", cfg.ExpectedExeBytes.ToString("n0") + " bytes");
            Add("multiplayer client", File.Exists(Paths.MpClient) ? "present" : "MISSING");
            Add("plugins enabled", Checks.EnabledPlugins().ToString());
            Add("ran last from", Checks.LastRunFrom());
            s.AppendLine();

            Add("windows", Environment.OSVersion.VersionString);
            Add("64 bit", Environment.Is64BitOperatingSystem ? "yes" : "no");
            Add("processors", Environment.ProcessorCount.ToString());
            try
            {
                var d = new DriveInfo(Path.GetPathRoot(Paths.Root));
                Add("disk free", Size(d.AvailableFreeSpace) + " on " + d.Name);
            }
            catch (Exception ex) { Swallow.Note("Diag.Summary, disk free", ex); }
            s.AppendLine();

            Section("mod list problems");
            try
            {
                var issues = Verify.Run();
                if (issues.Count == 0) s.AppendLine("none");
                foreach (Issue i in issues) s.AppendLine((i.Blocking ? "[blocking] " : "[note]     ") + i.Text);
            }
            catch (Exception ex) { s.AppendLine("could not check: " + ex.Message); }
            s.AppendLine();

            Section("script extender plugins");
            try
            {
                // Two folders while the own folder is chosen and not made: the
                // Steam copy's, what Vortex deployed, and Payload's,
                // Thornswood's own. Each is named so a report says which.
                string[] dirs = Paths.SksePluginDirs;
                foreach (string dir in dirs)
                {
                    if (dirs.Length > 1) s.AppendLine("in " + dir);
                    if (!Directory.Exists(dir)) continue;
                    var files = Directory.GetFiles(dir, "*.dll");
                    Array.Sort(files);
                    foreach (string f in files) s.AppendLine(Path.GetFileName(f));
                }
            }
            catch (Exception ex) { Swallow.Note("Diag.Summary, SKSE plugins", ex); }

            return s.ToString();
        }
    }
}
