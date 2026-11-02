using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// How long the launcher keeps its own records on this PC, and which of
    /// them an uninstall takes even when the saves and settings stay (#3679).
    ///
    /// Measured on one install on 26 Oct: launcher.log was 478,059 bytes,
    /// going back to the day the install was made, because every writer only
    /// ever appended to it and nothing cut it. Profile\Reports kept every
    /// support zip ever built (#3565), and each holds a copy of that log. The
    /// log names more than the game: the voice host, port and profile id, and
    /// the microphone's name. The privacy page said what the copy sent to the
    /// site is kept for and nothing about the copy here.
    ///
    /// So the rule lives here, once, and the privacy page says it: the log
    /// and the reports are kept for Days days, then go. Tidy runs at every
    /// start, straight after Paths.Init and inside the install's mutex, so
    /// nothing else in this launcher is writing the log while it is cut.
    ///
    /// Uninstall's "Keep this build's saves and settings" kept the whole
    /// Profile folder, so the log, the Discord sign-in, name and picture, and
    /// the browser folders voice and the music ran in stayed on the PC under a
    /// box that named none of them. NotSaves lists what goes whatever the box
    /// says.
    /// </summary>
    static class LocalKeep
    {
        /// <summary>How many days launcher.log's lines and the support zips are kept on this PC.</summary>
        public const int Days = 30;

        /// <summary>The stamp every launcher.log writer starts its line with.</summary>
        const string StampFormat = "yyyy-MM-dd HH:mm:ss";

        /// <summary>
        /// The start's one look: launcher.log cut to its last Days days, and
        /// support zips older than that deleted. Says what it removed in the
        /// log, after the cut, so the line itself is kept.
        /// </summary>
        public static void Tidy(DateTime now)
        {
            int lines = 0, zips = 0;
            try { lines = PruneLog(Paths.LogFile, now); }
            catch (Exception ex) { Swallow.Note("LocalKeep.Tidy, launcher.log", ex); }
            try { zips = PruneReports(Diag.ReportDir, now); }
            catch (Exception ex) { Swallow.Note("LocalKeep.Tidy, reports", ex); }
            if (lines == 0 && zips == 0) return;

            var said = new List<string>();
            if (lines > 0) said.Add(lines + (lines == 1 ? " line" : " lines") + " of launcher.log");
            if (zips > 0) said.Add(zips + (zips == 1 ? " support report" : " support reports"));
            try
            {
                File.AppendAllText(Paths.LogFile, now.ToString(StampFormat, CultureInfo.InvariantCulture) +
                    "  Kept to the last " + Days + " days on this PC: removed " + string.Join(" and ", said.ToArray()) +
                    " older than that." + Environment.NewLine);
            }
            catch (Exception ex) { Swallow.Note("LocalKeep.Tidy, saying what went", ex); }
        }

        /// <summary>
        /// Cuts the log at its first line stamped within the last Days days,
        /// and returns how many lines went. A line with no stamp of its own (a
        /// stack trace, the native offsets after a fault) belongs to the stamped
        /// line before it and goes or stays with it. A log with no stamp in it
        /// at all is judged by when it was last written. The rest is written to
        /// a file beside it and put in its place, so a cut that fails part way
        /// leaves the log as it was.
        /// </summary>
        public static int PruneLog(string path, DateTime now)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return 0;
            DateTime cutoff = now.AddDays(-Days);
            string text = File.ReadAllText(path, Encoding.UTF8);

            int cut = -1, dropped = 0;
            bool anyStamp = false;
            int at = 0;
            while (at < text.Length)
            {
                DateTime when;
                if (Stamp(text, at, out when))
                {
                    anyStamp = true;
                    if (when >= cutoff) { cut = at; break; }
                }
                int nl = text.IndexOf('\n', at);
                at = nl < 0 ? text.Length : nl + 1;
                dropped++;
            }

            if (cut < 0)
            {
                // Nothing in the window. Every stamped line is old, and so is
                // every line that came after one; with no stamp anywhere, the
                // file's own write time is the only age there is.
                if (!anyStamp && File.GetLastWriteTime(path) >= cutoff) return 0;
                File.Delete(path);
                return dropped;
            }
            if (cut == 0) return 0;

            string next = path + ".new";
            File.WriteAllText(next, text.Substring(cut), new UTF8Encoding(false));
            try { File.Replace(next, path, null); }
            catch
            {
                try { File.Delete(next); } catch (Exception ex) { Swallow.Note("LocalKeep.PruneLog, clearing " + next, ex); }
                throw;
            }
            return dropped;
        }

        static bool Stamp(string text, int at, out DateTime when)
        {
            when = DateTime.MinValue;
            if (at + StampFormat.Length > text.Length) return false;
            return DateTime.TryParseExact(text.Substring(at, StampFormat.Length), StampFormat,
                CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out when);
        }

        /// <summary>
        /// Deletes the support zips Diag.Report built more than Days days ago,
        /// and returns how many. Only its own thornswood-*.zip names: anything
        /// else somebody put in the folder is theirs.
        /// </summary>
        public static int PruneReports(string dir, DateTime now)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return 0;
            DateTime cutoff = now.AddDays(-Days);
            int gone = 0;
            foreach (string zip in Directory.GetFiles(dir, "thornswood-*.zip"))
            {
                if (File.GetLastWriteTime(zip) >= cutoff) continue;
                File.Delete(zip);
                gone++;
            }
            return gone;
        }

        /// <summary>NotSaves in the words the uninstall page and its dialog use.</summary>
        public const string NotSavesInWords =
            "the launcher's log, your Discord sign-in, name and picture, the support reports, and the voice browser's data";

        /// <summary>
        /// What is in Profile that is not a save or a setting: the launcher's
        /// log, the support zips, the Discord sign-in with the name and picture
        /// kept beside it, and the folders of the browsers voice and the menu
        /// music once ran in. An uninstall removes these even when it keeps the
        /// saves and settings, and the farewell names any that could not be
        /// removed.
        /// </summary>
        public static string[] NotSaves()
        {
            var all = new List<string>();
            all.Add(Paths.LogFile);
            all.Add(Diag.ReportDir);
            all.AddRange(Discord.AccountFiles(Paths.ProfileDir));
            // Voice ran in a WebView2 until #4823 made it native, and that
            // browser's cache and storage are in Profile\VoiceBrowser, which
            // nothing reads now. The privacy page and the box under "Keep this
            // build's saves and settings" promise an uninstall removes that
            // browser's data, so it goes too.
            all.Add(Path.Combine(Paths.ProfileDir, "VoiceBrowser"));
            // The menu music ran in a WebView2 of its own until #3207 moved it
            // to NLayer, and that browser's cache and storage were left in
            // Profile\MusicBrowser, which nothing reads now. It is the
            // launcher's own folder and not a save or a setting, so it goes too.
            all.Add(Path.Combine(Paths.ProfileDir, "MusicBrowser"));
            return all.ToArray();
        }
    }
}
