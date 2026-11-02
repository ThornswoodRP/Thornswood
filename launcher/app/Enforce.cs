using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// Settings this build insists on, re-applied every time you press Play.
    ///
    /// Several of these mods keep their settings in memory and write their own
    /// ini back over the top when Skyrim exits. That means a fix written into
    /// one of those files does not survive the next session: the mod simply
    /// puts its own value back on the way out. Shipping the file in an update
    /// has the same problem, because the very next quit undoes it.
    ///
    /// So rather than editing those files once and hoping, the launcher writes
    /// them immediately before it starts the game, every time. The mod can
    /// write whatever it likes on the way out; the next launch puts it back.
    ///
    /// Only settings that fix a real fault belong here. Anything a person might
    /// reasonably want to change for themselves does not, or the launcher ends
    /// up arguing with them every time they play.
    /// </summary>
    static partial class Enforce
    {
        class Rule
        {
            public string File, Key, Value, Why;
            // The [Section] the key lives under, for files where the key may
            // not exist yet and has to be added rather than replaced. Null
            // means replace only, which is right for a file that always
            // carries the key.
            public string Section;
            // What goes between the key and the value when the line is
            // written. Skyrim's own ini files carry none, key=value, and a
            // rule for one of those keeps its file's style.
            public string Sep = " = ";
            // Only a file that is already there is edited; a missing one is
            // left for whatever makes it, rather than made here with one line.
            public bool Existing;
            public Rule(string f, string k, string v, string why) { File = f; Key = k; Value = v; Why = why; }
            public Rule(string f, string section, string k, string v, string why) { File = f; Section = section; Key = k; Value = v; Why = why; }
        }

        /// <summary>
        /// How far away people and NPCs are drawn, the same for everybody:
        /// Skyrim's fLODFadeOutMultActors, written into SkyrimPrefs.ini before
        /// every Play, and held there in the game by the front plugin, whose
        /// ACTOR_FADE must say the same number (tests\test-963-perf-settings.ps1
        /// checks the two agree).
        ///
        /// Patrick, 28 September (#963): lower it for everyone, one value we
        /// set, not left to each person's settings. Skyrim's presets are Low 5,
        /// Medium 7, High 9 and Ultra 15, and his main profile was Low
        /// everywhere else and Ultra here. 10 is just past High: a market
        /// square or an inn is still drawn wall to wall, so a town reads the
        /// same, and because the distance is a radius the ground it covers is
        /// (10/15)^2, under half of Ultra's, which is where the far NPCs cost
        /// frames. SkyMP only sends actors in the squares next to you anyway
        /// (4096 units each), so Ultra's extra reach was mostly drawing nobody.
        /// </summary>
        public const string ActorFade = "10";

        static string P(string name) { return Path.Combine(Paths.Game, "Data\\SKSE\\Plugins\\" + name); }

        [LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        private static partial IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec,
                                         uint disposition, uint flags, IntPtr template);
        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool GetFileInformationByHandle(IntPtr file, out BY_HANDLE_FILE_INFORMATION info);
        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool CloseHandle(IntPtr h);

        [StructLayout(LayoutKind.Sequential)]
        struct BY_HANDLE_FILE_INFORMATION
        {
            public uint Attributes, CreatedLow, CreatedHigh, AccessedLow, AccessedHigh;
            public uint WrittenLow, WrittenHigh, SerialNumber, SizeHigh, SizeLow, Links;
            public uint IndexHigh, IndexLow;
        }

        /// <summary>How many names this file has. One is a file of our own; more is a hard link.</summary>
        static int Names(string file)
        {
            IntPtr h = CreateFileW(file, 0x80000000, 7, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
            if (h == IntPtr.Zero || h.ToInt64() == -1) return 1;
            try
            {
                BY_HANDLE_FILE_INFORMATION info;
                if (!GetFileInformationByHandle(h, out info)) return 1;
                return (int)info.Links;
            }
            finally { CloseHandle(h); }
        }

        /// <summary>
        /// Anything worth saying from the last Apply, for the caller to log.
        /// Enforce runs before the window is up on one of its two paths, so it
        /// collects rather than logs.
        /// </summary>
        public static readonly List<string> Said = new List<string>();

        /// <summary>
        /// Make this file ours alone before a line of it is rewritten.
        ///
        /// The game folder is built of hard links so the collection is not on
        /// the disk twice, and a hard link is the same file under a second
        /// name: writing a line into one writes it into Vortex's copy, and
        /// through that into every other server's deployment. That happened.
        /// Thornswood pinned Skyrim Souls' favourites menu to paused in
        /// September while it still ran from the Steam copy, the write landed
        /// in Vortex's own file, and the Q menu went on pausing the world in
        /// another server long after Thornswood stopped asking for it (Djinn, 20
        /// September). The folder copies these files now rather than linking
        /// them, so this is the belt rather than the braces, and it is cheap:
        /// one handle, and nothing to do in the normal case.
        ///
        /// Breaking the link is a copy aside, a delete and a rename, so what
        /// is left is a file with one name and the same contents, and nobody
        /// else's file moves.
        /// </summary>
        static void MakeItOurs(string file)
        {
            try
            {
                if (!File.Exists(file) || Names(file) <= 1) return;
                // One rename over the shared name, never a delete first (#2599).
                OwnGame.SwapCopyIn(file, file + ".mine");
                Said.Add("A setting this build writes was the same file as another launcher's copy of " +
                         Path.GetFileName(file) + ". It has its own copy now, so nothing outside " +
                         Paths.Game + " is written.");
            }
            catch (Exception ex) { Swallow.Note("Enforce.MakeItOurs, " + file, ex); }
        }

        static List<Rule> Rules()
        {
            var l = new List<Rule>();

            // Skyrim Souls keeps the world running while a menu is open, which
            // is the point of it here: everybody else's world keeps running
            // whatever your menu is doing.
            //
            // The favourites list was pinned back to paused to stop it crashing
            // through Inventory Interface Information Injector. It did not. All
            // seven crash logs from 18 and 19 Sep were taken with this set to
            // false and the fault is identical in every one, so it bought
            // nothing and cost a pause nobody asked for, which is what Patrick
            // reported when the Q menu froze the world around him.
            //
            // The library is the real fix and OwnGame.Skip now keeps it out of
            // the folder, so this goes back to unpaused. It has to be written
            // rather than dropped: Skyrim Souls writes its own ini back on the
            // way out, so removing the rule would leave our false in the file
            // for good.
            //
            // The Tab menu stays paused. That one locks up with no cursor and
            // no way out, and nothing here has changed about it.
            l.Add(new Rule(P("SkyrimSoulsRE.ini"), "bFavoritesMenu", "true", "the favourites menu pausing the world for nothing"));
            l.Add(new Rule(P("SkyrimSoulsRE.ini"), "bTweenMenu",     "false", "the Tab menu locking up"));

            // Open Animation Replacer draws two things over the main menu and
            // nothing else in this build does: a banner across the top saying
            // which key opens its menu, and a progress bar while it loads
            // animations. The menu is only the Thornswood backdrop now, so
            // both go. The key itself still works. OAR writes this file back
            // with its own values on the way out, which is exactly the case
            // this class exists for, and on a machine that has never run it
            // the file is not there yet, so the [UI] section is written in.
            l.Add(new Rule(P("OpenAnimationReplacer.ini"), "UI", "bShowWelcomeBanner", "false", "the animation replacer banner over the main menu"));
            l.Add(new Rule(P("OpenAnimationReplacer.ini"), "UI", "bEnableAnimationQueueProgressBar", "false", "the animation loading bar over the main menu"));

            // SkyrimPlatform's own log at its normal level, and no text window
            // beside the game. Patrick, 28 September (#963). Both installs here
            // had trace (0) and the window on: 16,324 lines in six minutes,
            // every one also drawn in a console window. Info (2) keeps every
            // line the client and our plugins print (printConsole is info),
            // which is what anybody reads when something goes wrong; only the
            // engine's trace and debug chatter goes. Replace only: a file
            // without the line is at SkyrimPlatform's own default, which is
            // already info and no window, and the file itself is
            // SkyrimPlatform's to make, with its browser and plugin folder
            // lines in it.
            l.Add(new Rule(P("SkyrimPlatform.ini"), "LogLevel", "2", "the in-game client's log at its normal level, not every trace line"));
            l.Add(new Rule(P("SkyrimPlatform.ini"), "Cmd", "false", "no text window open beside the game"));

            // How far people and NPCs are drawn, one number for everybody. See
            // ActorFade. SkyrimPrefs.ini is Skyrim's own, so it is edited
            // only when it is there, and in its own key=value style.
            var fade = new Rule(Path.Combine(Paths.LiveMyGames, "SkyrimPrefs.ini"), "LOD", "fLODFadeOutMultActors", ActorFade,
                                "how far away people and NPCs are drawn, the same for everybody");
            fade.Sep = "=";
            fade.Existing = true;
            l.Add(fade);

            return l;
        }

        /// <summary>
        /// Writes every rule. Returns how many values it had to change, so a
        /// launch that changed nothing can stay quiet.
        /// </summary>
        public static int Apply()
        {
            int changed = 0;
            Said.Clear();
            foreach (Rule r in Rules())
            {
                if (r.Existing && !File.Exists(r.File)) continue;
                if (r.Section == null) { if (Set(r.File, r.Key, r.Value, r.Sep)) changed++; }
                else if (SetOrAdd(r.File, r.Section, r.Key, r.Value, r.Sep)) changed++;
            }

            return changed;
        }

        /// <summary>
        /// Like Set, but for a key that may not be in the file yet. Replaces
        /// the first live occurrence when there is one; otherwise adds the
        /// line under [section], creating the section at the end of the file,
        /// and the file itself, when they are missing. Returns true only when
        /// something actually changed.
        /// </summary>
        internal static bool SetOrAdd(string file, string section, string key, string value, string sep)
        {
            try
            {
                if (File.Exists(file))
                {
                    if (Set(file, key, value, sep)) return true;
                    // Nothing changed: either the key is already right, or it
                    // is not there at all. Tell those two apart.
                    var rx = new Regex("^\\s*" + Regex.Escape(key) + "\\s*=", RegexOptions.IgnoreCase);
                    foreach (string line in File.ReadAllLines(file))
                    {
                        string t = line.TrimStart();
                        if (t.StartsWith(";") || t.StartsWith("#")) continue;
                        if (rx.IsMatch(line)) return false;
                    }
                }

                var lines = new List<string>();
                if (File.Exists(file)) { MakeItOurs(file); lines.AddRange(File.ReadAllLines(file)); }

                // Find the section header; insert right after it, or append a
                // new section when the file has none.
                int at = -1;
                for (int i = 0; i < lines.Count; i++)
                    if (string.Equals(lines[i].Trim(), "[" + section + "]", StringComparison.OrdinalIgnoreCase)) { at = i; break; }
                if (at < 0)
                {
                    if (lines.Count > 0 && lines[lines.Count - 1].Trim().Length > 0) lines.Add("");
                    lines.Add("[" + section + "]");
                    lines.Add(key + sep + value);
                }
                else
                {
                    lines.Insert(at + 1, key + sep + value);
                }
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                File.WriteAllLines(file, lines.ToArray());
                return true;
            }
            catch (Exception ex) { Swallow.Note("Enforce.SetOrAdd, " + file, ex); }
            return false;
        }

        /// <summary>
        /// Replaces the first live occurrence of a key, leaving any later one
        /// alone: these files repeat the same key under several headings and a
        /// rule owns the first of them. Commented out lines are not live.
        /// Returns true only when something actually changed.
        /// </summary>
        internal static bool Set(string file, string key, string value, string sep)
        {
            try
            {
                if (!File.Exists(file)) return false;
                MakeItOurs(file);
                var lines = new List<string>(File.ReadAllLines(file));
                var rx = new Regex("^(\\s*)" + Regex.Escape(key) + "\\s*=\\s*(.*?)\\s*$", RegexOptions.IgnoreCase);

                for (int i = 0; i < lines.Count; i++)
                {
                    string t = lines[i].TrimStart();
                    if (t.StartsWith(";") || t.StartsWith("#")) continue;
                    Match m = rx.Match(lines[i]);
                    if (!m.Success) continue;

                    if (string.Equals(m.Groups[2].Value, value, StringComparison.OrdinalIgnoreCase)) return false;

                    lines[i] = key + sep + value;
                    File.WriteAllLines(file, lines.ToArray());
                    return true;
                }
            }
            catch (Exception ex) { Swallow.Note("Enforce.Set, " + file, ex); }
            return false;
        }
    }
}
