using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// How long the launcher keeps its own records on this PC (#3679).
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
    /// Uninstall removes all of it: what the person keeps (their characters
    /// and settings) is on the site under their Discord account since #5938
    /// and #5939, so there is no box to keep Profile any more.
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
            try { lines = PruneLog(Paths.LogFile, now) + PruneLog(LauncherLog.Older(Paths.LogFile), now); }
            catch (Exception ex) { Swallow.Note("LocalKeep.Tidy, launcher.log", ex); }
            try { zips = PruneReports(Diag.ReportDir, now); }
            catch (Exception ex) { Swallow.Note("LocalKeep.Tidy, reports", ex); }
            if (lines == 0 && zips == 0) return;

            var said = new List<string>();
            if (lines > 0) said.Add(lines + (lines == 1 ? " line" : " lines") + " of launcher.log");
            if (zips > 0) said.Add(zips + (zips == 1 ? " support report" : " support reports"));
            LauncherLog.Text(now.ToString(StampFormat, CultureInfo.InvariantCulture) +
                "  Kept to the last " + Days + " days on this PC: removed " + string.Join(" and ", said.ToArray()) +
                " older than that." + Environment.NewLine);
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
            return LauncherLog.Holding(delegate { return PruneLogHeld(path, now); });
        }

        static int PruneLogHeld(string path, DateTime now)
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
    }
}
