using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// A full crash snapshot of the game, only when the person turns it on
    /// (#2626, which replaces the dev-and-staff rule of #1191).
    ///
    /// Crash Logger writes a text log for every crash: a scan of the stack
    /// and its best guess at the module. For the rare crashes that is not
    /// enough to find the cause (#407, where frame 0 is the bad address
    /// itself, and #408). Crash Logger can also write a snapshot beside the
    /// log, crash-(time).dmp, holding all of the game's memory at that moment
    /// (it asks Windows for MiniDumpWithFullMemory), which a debugger opens
    /// as if the crash were happening in front of it.
    ///
    /// WHY IT IS OFF UNLESS ASKED FOR. Until 17 October this was turned on
    /// by itself for the dev build and for every staff Discord account, and
    /// the comment here said one was "about 1 GB". The one written on Djinn's
    /// PC that day was 9,829,847,602 bytes and took about 95 seconds, and
    /// nobody had told him it was being written. His words: "filling my PC
    /// with information I knew nothing about taking up space and resources is
    /// not cool". So it is a setting, Settings, Crash snapshots, off for
    /// everybody until they tick it, with the size said beside the box and a
    /// folder they choose.
    ///
    /// Before every Play, Apply writes Crash Logger's own switch into this
    /// install's CrashLogger.ini to match the setting. Turning it off stops
    /// new snapshots and deletes nothing: a file already on somebody's disk
    /// is theirs to keep or delete.
    ///
    /// KEPT UNTIL LOOKED AT, TWO AT MOST (#2319, decided by Patrick on 12
    /// Oct). Until then only the newest was kept, so the next crash deleted
    /// the one before it whether anybody had read it or not: none of the four
    /// written between 29 Sep and 6 Oct was read. Now each snapshot is tied
    /// to the session it crashed in (Remember, from the session logs), staff
    /// mark that crash looked at on the sessions page, the site says so in
    /// the answer to the next check in (its lookedAt field), and Tidy
    /// deletes a snapshot only once its crash is marked, or when it is the
    /// third. Crash Logger's own Max Minidumps is held at the same two. The
    /// setting says all of this before it is ticked.
    ///
    /// As the game closes after a crash, AfterSession moves the snapshot to
    /// the chosen folder when there is one, and the launcher shows it with
    /// its size and asks whether to keep it (Shell.cs).
    ///
    /// A snapshot is never sent anywhere: not with the session logs, not in
    /// the report zip, not by any button. It holds whatever was in the game's
    /// memory, and it stays on the PC it was written on.
    /// </summary>
    static class CrashDump
    {
        // Crash Logger's own keys, as its CrashLogger.ini spells them, all
        // under [Debug].
        const string Section   = "Debug";
        const string WriteKey  = "Crash Log Write Minidump";
        const string KeepKey   = "Max Minidumps";
        // The snapshot Ctrl+Shift+F12 writes for a hang. Nothing here turns
        // it on, and it is held off whenever snapshots are.
        const string ThreadKey = "Thread Dump Write Minidump";
        const string Sep = " = ";

        /// <summary>
        /// The most snapshots kept at once (#2319): written into Crash
        /// Logger's Max Minidumps and held by Tidy across both folders.
        /// </summary>
        public const int Keep = 2;

        public static string Ini { get { return Path.Combine(Paths.Game, "Data\\SKSE\\Plugins\\CrashLogger.ini"); } }
        static string Dll { get { return Path.Combine(Paths.Game, "Data\\SKSE\\Plugins\\CrashLogger.dll"); } }

        /// <summary>Where Crash Logger writes its logs and snapshots: this install's Profile\MyGames\SKSE.</summary>
        public static string Folder { get { return Files.SkseLogDir; } }

        /// <summary>
        /// What Apply wrote into Crash Logger's file at the last Play. The
        /// game writes a snapshot by that, not by the setting as it is when
        /// the game closes: untick the box mid-session and a crash still
        /// writes one, which the person must still be told about.
        /// </summary>
        public static bool AppliedAtPlay;

        /// <summary>Whether the person turned snapshots on.</summary>
        public static bool Wanted(Config cfg)
        {
            return cfg != null && cfg.CrashSnapshots;
        }

        /// <summary>The folder the person chose, or Crash Logger's own when they chose none.</summary>
        public static string KeptIn(Config cfg)
        {
            string chosen = cfg == null ? "" : (cfg.CrashSnapshotFolder ?? "").Trim();
            return chosen.Length > 0 ? chosen : Folder;
        }

        /// <summary>
        /// Before Play: Crash Logger's switch written to match the setting.
        /// Returns a line for the log when anything changed, or null.
        /// </summary>
        public static string Apply(Config cfg)
        {
            AppliedAtPlay = Wanted(cfg);
            return Apply(AppliedAtPlay, KeptIn(cfg));
        }

        public static string Apply(bool want, string keptIn)
        {
            bool turned = false;
            if (want)
            {
                // Only where Crash Logger is. A missing ini beside the plugin
                // is made with the lines under [Debug]; Crash Logger reads
                // its defaults for the rest.
                if (File.Exists(Dll) || File.Exists(Ini))
                {
                    if (Enforce.SetOrAdd(Ini, Section, WriteKey, "true", Sep)) turned = true;
                    Enforce.SetOrAdd(Ini, Section, KeepKey, Keep.ToString(), Sep);
                }
            }
            else
            {
                // A file without the line is at Crash Logger's default, off.
                if (Enforce.Set(Ini, WriteKey, "false", Sep)) turned = true;
                Enforce.Set(Ini, ThreadKey, "false", Sep);
            }

            int looked = 0;
            int gone = want ? Tidy(keptIn, out looked) : 0;

            var said = new List<string>();
            if (turned && want)
                said.Add("Crash snapshots are on, as you set in Settings. If the game crashes, a full snapshot is saved in " + keptIn +
                         ". One can be 9 GB or more, each is kept until staff have looked at that crash, two at most, and it stays on this PC.");
            if (turned && !want)
                said.Add("Crash snapshots are off. Any already saved are left where they are; you can delete them from " + keptIn +
                         (SameFolder(keptIn, Folder) ? "" : " and from " + Folder) + ".");
            string tidied = TidyLine(gone, looked);
            if (tidied != null) said.Add(tidied);
            return said.Count == 0 ? null : string.Join(" ", said.ToArray());
        }

        /// <summary>
        /// The log's line for what Tidy deleted, or null when it deleted
        /// nothing. looked is how many of gone were crashes staff had marked
        /// looked at; the rest went for being past the two kept.
        /// </summary>
        public static string TidyLine(int gone, int looked)
        {
            if (gone <= 0) return null;
            var parts = new List<string>();
            if (looked > 0)
                parts.Add(looked + " crash snapshot" + (looked == 1 ? "" : "s") + " staff have looked at");
            int over = gone - looked;
            if (over > 0)
                parts.Add(over + " older crash snapshot" + (over == 1 ? "" : "s") + " past the " + Keep + " kept");
            return "Deleted " + string.Join(" and ", parts.ToArray()) + ".";
        }

        public static int Tidy(string keptIn)
        {
            int looked;
            return Tidy(keptIn, out looked);
        }

        /// <summary>
        /// Where snapshots are kept, in that folder and in Crash Logger's own
        /// when it is a different one: deletes every snapshot whose crash
        /// staff have marked looked at (LookedAt, from the last check in),
        /// then all but the newest Keep of the rest. A snapshot whose session
        /// is not known (Remember never saw it) is kept like an unread one.
        /// Called only with snapshots on. Returns how many went; looked is
        /// how many of those were looked at.
        /// </summary>
        public static int Tidy(string keptIn, out int looked)
        {
            int gone = 0;
            looked = 0;
            try
            {
                var dumps = new List<FileInfo>();
                var folders = new List<string>();
                folders.Add(Folder);
                if (!string.IsNullOrEmpty(keptIn) && !SameFolder(keptIn, Folder)) folders.Add(keptIn);
                foreach (string dir in folders)
                {
                    if (!Directory.Exists(dir)) continue;
                    foreach (string f in Directory.GetFiles(dir, "crash-*.dmp"))
                        if (IsCrashLoggers(Path.GetFileName(f))) dumps.Add(new FileInfo(f));
                }
                dumps.Sort(delegate(FileInfo a, FileInfo b) { return b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc); });

                Dictionary<string, string> held = ReadHeld();
                var still = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                int kept = 0;
                foreach (FileInfo d in dumps)
                {
                    string sid;
                    bool seen = held.TryGetValue(d.Name, out sid) && IsLookedAt(sid);
                    if (!seen && kept < Keep) { kept++; still.Add(d.Name); continue; }
                    try { d.Delete(); gone++; if (seen) looked++; }
                    catch (Exception ex) { Swallow.Note("CrashDump.Tidy, " + d.Name, ex); still.Add(d.Name); }
                }

                // The record keeps only the snapshots still on disk, so the
                // next check in asks about nothing that is gone.
                var drop = new List<string>();
                foreach (string name in held.Keys) if (!still.Contains(name)) drop.Add(name);
                if (drop.Count > 0) Forget(drop);
            }
            catch (Exception ex) { Swallow.Note("CrashDump.Tidy", ex); }
            return gone;
        }

        // ------------------------------------------------ looked at (#2319) --
        //
        // Which session each snapshot crashed in, so a looked-at mark on the
        // sessions page can reach the snapshot on this PC. One line per
        // snapshot, "crash-(time).dmp<TAB>(session id)", in the profile
        // folder beside the launcher's other records, never beside the
        // snapshots: the chosen folder is the person's.

        static readonly object heldLock = new object();
        static HashSet<string> lookedAt = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>The most snapshot sessions remembered, and so asked about at check in.</summary>
        const int HeldMax = 8;

        static string HeldFile { get { return Path.Combine(Paths.ProfileDir, "crash-snapshots.txt"); } }

        /// <summary>
        /// The session a crash log was written in, remembered against the
        /// snapshot of the same name. Called as the session's logs are sent
        /// (SessionLogs), which is the one moment both are known,
        /// including at the next start after a crash that took the launcher
        /// down with it. Whether the snapshot exists is not asked: it may be
        /// on its way to the chosen folder on another thread, and Tidy drops
        /// the line once it is nowhere.
        /// </summary>
        public static void Remember(string crashLog, string session)
        {
            if (string.IsNullOrEmpty(crashLog) || !SessionOk(session)) return;
            string name = Path.GetFileNameWithoutExtension(crashLog) + ".dmp";
            if (!IsCrashLoggers(name)) return;
            lock (heldLock)
            {
                try
                {
                    var lines = new List<string>();
                    if (File.Exists(HeldFile))
                        foreach (string l in File.ReadAllLines(HeldFile))
                            if (l.Length > 0 && !l.StartsWith(name + "\t", StringComparison.OrdinalIgnoreCase)) lines.Add(l);
                    lines.Add(name + "\t" + session);
                    while (lines.Count > HeldMax) lines.RemoveAt(0);
                    Directory.CreateDirectory(Path.GetDirectoryName(HeldFile));
                    File.WriteAllLines(HeldFile, lines.ToArray());
                }
                catch (Exception ex) { Swallow.Note("CrashDump.Remember", ex); }
            }
        }

        /// <summary>
        /// The sessions of the snapshots remembered, comma separated, for the
        /// check in to ask the site about. "" when there are none.
        /// </summary>
        public static string HeldSessions()
        {
            var ids = new List<string>();
            foreach (string sid in ReadHeld().Values)
                if (!ids.Contains(sid)) ids.Add(sid);
            return string.Join(",", ids.ToArray());
        }

        /// <summary>
        /// The site's answer at check in: which of HeldSessions staff have
        /// marked looked at. The whole answer replaces the last one, so a
        /// mark staff take off again keeps the snapshot.
        /// </summary>
        public static void NoteLookedAt(string csv)
        {
            var next = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string s in (csv ?? "").Split(','))
            {
                string sid = s.Trim();
                if (SessionOk(sid)) next.Add(sid);
            }
            lock (heldLock) lookedAt = next;
        }

        static bool IsLookedAt(string sid)
        {
            lock (heldLock) return !string.IsNullOrEmpty(sid) && lookedAt.Contains(sid);
        }

        static Dictionary<string, string> ReadHeld()
        {
            var held = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            lock (heldLock)
            {
                try
                {
                    if (!File.Exists(HeldFile)) return held;
                    foreach (string l in File.ReadAllLines(HeldFile))
                    {
                        int tab = l.IndexOf('\t');
                        if (tab <= 0) continue;
                        string name = l.Substring(0, tab), sid = l.Substring(tab + 1).Trim();
                        if (IsCrashLoggers(name) && SessionOk(sid)) held[name] = sid;
                    }
                }
                catch (Exception ex) { Swallow.Note("CrashDump.ReadHeld", ex); }
            }
            return held;
        }

        /// <summary>
        /// Those snapshots' lines taken out of the record, read again under
        /// the lock, so a line Remember added since Tidy read it stays.
        /// </summary>
        static void Forget(List<string> names)
        {
            lock (heldLock)
            {
                try
                {
                    if (!File.Exists(HeldFile)) return;
                    var lines = new List<string>();
                    foreach (string l in File.ReadAllLines(HeldFile))
                    {
                        int tab = l.IndexOf('\t');
                        string name = tab > 0 ? l.Substring(0, tab) : "";
                        bool gone = false;
                        foreach (string n in names) if (string.Equals(n, name, StringComparison.OrdinalIgnoreCase)) gone = true;
                        if (l.Length > 0 && !gone) lines.Add(l);
                    }
                    if (lines.Count == 0) File.Delete(HeldFile);
                    else File.WriteAllLines(HeldFile, lines.ToArray());
                }
                catch (Exception ex) { Swallow.Note("CrashDump.Forget", ex); }
            }
        }

        /// <summary>A session id as the launcher makes them (Guid "N"): hex, 32 characters.</summary>
        static bool SessionOk(string sid)
        {
            return System.Text.RegularExpressions.Regex.IsMatch(sid ?? "", "^[0-9a-fA-F]{32}$");
        }

        /// <summary>
        /// Only Crash Logger's own snapshot names, crash-YYYY-MM-DD-HH-MM-SS.dmp,
        /// are ever tidied: the chosen folder may be one other programs use
        /// too, and their files are not this launcher's to delete.
        /// </summary>
        static bool IsCrashLoggers(string name)
        {
            return System.Text.RegularExpressions.Regex.IsMatch(name ?? "",
                @"^crash-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.dmp$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        }

        static bool SameFolder(string a, string b)
        {
            try
            {
                return string.Equals(Path.GetFullPath(a).TrimEnd('\\', '/'), Path.GetFullPath(b).TrimEnd('\\', '/'),
                                     StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        /// <summary>The snapshot written with this crash log, or null.</summary>
        public static string Beside(string crashLog)
        {
            if (string.IsNullOrEmpty(crashLog)) return null;
            string dmp = Path.ChangeExtension(crashLog, ".dmp");
            return File.Exists(dmp) ? dmp : null;
        }

        /// <summary>
        /// As the game closes: when it crashed (Crash Logger wrote a crash
        /// log since sinceLocal), the line saying so. With snapshots on at
        /// Play and a snapshot beside the log, it is moved to the chosen
        /// folder and snapshot is its path, for the launcher to show and ask
        /// about. Null when it did not crash. Can take minutes when the
        /// folder is on another drive (a 9 GB copy), so the launcher calls it
        /// off the window's thread.
        /// </summary>
        public static string AfterSession(DateTime sinceLocal, bool want, string keptIn, out string snapshot)
        {
            snapshot = null;
            try
            {
                if (!Directory.Exists(Folder)) return null;
                FileInfo log = null;
                foreach (string f in Directory.GetFiles(Folder, "crash-*.log"))
                {
                    var fi = new FileInfo(f);
                    if (fi.LastWriteTime < sinceLocal) continue;
                    if (log == null || fi.LastWriteTime > log.LastWriteTime) log = fi;
                }
                if (log == null) return null;

                string line = "The game crashed. Its crash log is " + log.Name + " in " + Folder + ".";
                string dmp = Beside(log.FullName);
                if (dmp == null || !want) return line;

                string to = dmp;
                if (!string.IsNullOrEmpty(keptIn) && !SameFolder(keptIn, Folder))
                {
                    try
                    {
                        Directory.CreateDirectory(keptIn);
                        to = Path.Combine(keptIn, Path.GetFileName(dmp));
                        if (File.Exists(to)) File.Delete(to);
                        File.Move(dmp, to);
                    }
                    catch (Exception ex)
                    {
                        line += " The snapshot could not be moved to " + keptIn + " (" + Failure.Why("CrashDump.AfterSession, move", ex) + "), so it is still beside the crash log.";
                        to = dmp;
                    }
                }
                // Older ones are tidied only once the person has answered
                // (Shell.AskKeepSnapshot): answering No to this one must not
                // leave them with none at all.
                snapshot = File.Exists(to) ? to : null;
                if (snapshot != null)
                    line += " A full crash snapshot was saved: " + snapshot + ", " + Size(new FileInfo(snapshot).Length) +
                            ". It holds what was in the game's memory, so it stays on this PC and nothing sends it anywhere.";
                return line;
            }
            catch (Exception ex) { Swallow.Note("CrashDump.AfterSession", ex); }
            return null;
        }

        public static string Size(long b)
        {
            if (b < 1024L * 1024 * 1024) return (b / (1024.0 * 1024.0)).ToString("F0") + " MB";
            return (b / (1024.0 * 1024.0 * 1024.0)).ToString("F1") + " GB";
        }
    }
}
