using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Thornswood's own files in Data\Platform, kept pristine under
    /// Profile\Keep and put back before every Play, with another server's
    /// plugins moved aside.
    ///
    /// Data\Platform is the one place every SkyMP server's launcher writes
    /// into the same Skyrim. Another server's launcher rewrites
    /// Data\Platform\UI\index.html with its own page and drops its own plugin
    /// into Data\Platform\Plugins. Skyrim Platform runs every plugin it finds
    /// and the front plugin loads whatever index.html is there, so on
    /// 2026-09-16 somebody who plays both had that server's page under
    /// Thornswood's chat, and Thornswood's voice indicator over that server's
    /// menu. The plugins now stay idle when the client points at another
    /// server; this is the other half, so another server's session cannot leave
    /// Thornswood loading their page.
    ///
    /// The same mechanism keeps the main build and the dev build apart when
    /// both are installed against one Skyrim. Each launcher remembers the
    /// Data\Platform files its own updates wrote and puts exactly those back
    /// before it plays, and a plugin the other build added is parked for the
    /// session the way another server's would be.
    ///
    /// Which files are ours is learned from the updates that wrote them
    /// (Remember, called by the updater), never from the game folder on its
    /// own, because by the time anybody looks the game folder may already
    /// hold somebody else's version. Core below is the set every build has
    /// had since 1.1.34; anything else under Data\Platform counts as ours
    /// once an update of this build has carried it. Until an update has
    /// carried a file, it is not restored, and nothing is guessed.
    ///
    /// The other server's plugins are parked, not removed: they wait in
    /// Profile\Parked while Thornswood runs and go back the moment the game
    /// closes (Unpark, also run when the launcher starts, in case the last
    /// session ended in a crash). Their launcher then finds its files exactly
    /// where it left them, and switching between servers is pressing Play in
    /// whichever launcher you want, with Vortex never touched.
    /// </summary>
    static class Keep
    {
        /// <summary>
        /// Ours in every build, relative to the game folder. Anything an
        /// update writes under Data\Platform joins this set for the build
        /// that wrote it.
        /// </summary>
        public static readonly string[] Core = {
            "Data\\Platform\\UI\\index.html",
            "Data\\Platform\\UI\\build.js",
            "Data\\Platform\\UI\\thornswood-bridge.js",
            "Data\\Platform\\UI\\thornswood-chat.js",
            "Data\\Platform\\UI\\thornswood-emotes.js",
            "Data\\Platform\\UI\\thornswood-voice.js",
            "Data\\Platform\\Plugins\\skymp5-client.js",
            "Data\\Platform\\Plugins\\thornswood-emotes.js",
            "Data\\Platform\\Plugins\\thornswood-front.js",
            "Data\\Platform\\Plugins\\thornswood-mark.js",
            "Data\\Platform\\Plugins\\thornswood-voice.js",
        };

        /// <summary>The part of the game folder this class looks after.</summary>
        const string Platform = "Data\\Platform\\";

        /// <summary>
        /// Only the plugin folder is swept, and only for scripts: any .js in
        /// it that is not ours and not the client is another server's plugin,
        /// and Skyrim Platform would run it. The UI folder is left alone
        /// beyond the files we keep, because the client's own page keeps its
        /// fonts there under hashed names that nothing here can tell from
        /// another server's assets, and a stray asset file runs nothing.
        /// </summary>
        const string PluginDir = "Data\\Platform\\Plugins";

        public static string Dir
        {
            get { return Path.Combine(Paths.ProfileDir, "Keep"); }
        }

        /// <summary>
        /// Whether there is a kept copy of one file, so somebody can be told
        /// whether Repair can put it back or whether the only way is a
        /// reinstall. A kept copy exists only for a file one of this
        /// build's own updates wrote, so an install that came from the
        /// installer and has never taken a pack has none of them, and
        /// telling that person to press Repair is telling them to press a
        /// button that does nothing.
        /// </summary>
        public static bool HasKept(string rel)
        {
            try { return File.Exists(Path.Combine(Dir, rel)); }
            catch { return false; }
        }

        /// <summary>Where another server's plugins wait while Thornswood runs.</summary>
        public static string ParkDir
        {
            get { return Path.Combine(Paths.ProfileDir, "Parked"); }
        }

        static string ParkList
        {
            get { return Path.Combine(ParkDir, "parked.txt"); }
        }

        /// <summary>
        /// What an update can make ours: a page or asset under UI, or a plugin
        /// script under Plugins. Not the client's settings file beside the
        /// plugins, which the launcher rewrites at every Play with this
        /// machine's profile and server, and not the logs and channel files
        /// the game writes in the Platform folder itself.
        /// </summary>
        static bool UnderPlatform(string rel)
        {
            if (rel == null || rel.IndexOf("..", StringComparison.Ordinal) >= 0) return false;
            if (rel.StartsWith(Platform + "UI\\", StringComparison.OrdinalIgnoreCase))
                return rel.Length > Platform.Length + 3;
            if (rel.StartsWith(PluginDir + "\\", StringComparison.OrdinalIgnoreCase))
                return rel.EndsWith(".js", StringComparison.OrdinalIgnoreCase);
            return false;
        }

        static bool IsCore(string rel)
        {
            foreach (string o in Core)
                if (string.Equals(o, rel, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// Ours: in the core set, named the way this build names its own
        /// plugins, or carried by one of this build's own updates.
        ///
        /// The name has to count, because the kept copy is not always there.
        /// Core is the set as it stood at 1.1.34, and a plugin added since is
        /// known only from the update that wrote it, so on a machine that got
        /// the file from the installer rather than from an update there is no
        /// copy under Profile\Keep and our own plugin reads as another
        /// server's. Parking it takes the feature out of the session it shipped
        /// for. Nobody else's plugin is called thornswood-anything.
        /// </summary>
        public static bool IsOurs(string rel)
        {
            if (IsCore(rel)) return true;
            if (OurPluginName(rel)) return true;
            try { return UnderPlatform(rel) && File.Exists(Path.Combine(Dir, rel)); }
            catch { return false; }
        }

        /// <summary>
        /// A script sitting directly in the plugin folder under a name this
        /// build owns. The dev build's plugins carry the same prefix, so this
        /// stops the two builds parking each other's plugins as well, which is
        /// the one thing it gives up: until now a plugin only the other build
        /// had was parked for the session.
        /// </summary>
        static bool OurPluginName(string rel)
        {
            if (rel == null) return false;
            if (!rel.StartsWith(PluginDir + "\\", StringComparison.OrdinalIgnoreCase)) return false;
            string name = rel.Substring(PluginDir.Length + 1);
            if (name.IndexOf('\\') >= 0) return false;
            return name.StartsWith("thornswood-", StringComparison.OrdinalIgnoreCase) &&
                   name.EndsWith(".js", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// These files are as the update in place has them, relative to the
        /// game folder: the ones under Data\Platform become the copy to
        /// restore from. Returns how many kept copies changed; one already
        /// the same is not written again.
        /// </summary>
        public static int Remember(IEnumerable<string> rels)
        {
            int n = 0;
            if (rels == null) return 0;
            foreach (string rel in rels)
            {
                if (!UnderPlatform(rel)) continue;
                try
                {
                    string src = Path.Combine(Paths.Game, rel);
                    if (!File.Exists(src)) continue;
                    string dst = Path.Combine(Dir, rel);
                    if (File.Exists(dst) && Same(src, dst)) continue;
                    Directory.CreateDirectory(Path.GetDirectoryName(dst));
                    File.Copy(src, dst, true);
                    n++;
                }
                catch (Exception ex) { Swallow.Note("Keep.Remember, copy", ex); }
            }
            return n;
        }

        /// <summary>
        /// An update took these files out of the game. The kept copies go too,
        /// or the next Play would put a removed plugin straight back. Returns
        /// how many kept copies went.
        /// </summary>
        public static int Forget(IEnumerable<string> rels)
        {
            int n = 0;
            if (rels == null) return 0;
            foreach (string rel in rels)
            {
                if (!UnderPlatform(rel)) continue;
                try
                {
                    string kept = Path.Combine(Dir, rel);
                    if (!File.Exists(kept)) continue;
                    File.Delete(kept);
                    n++;
                }
                catch (Exception ex) { Swallow.Note("Keep.Forget, delete", ex); }
            }
            return n;
        }

        /// <summary>
        /// For a launcher that gained this class after the pack carrying a file
        /// had already gone in: packs are applied before the launcher updates
        /// itself, so the launcher that wrote them could not remember them.
        /// Reads the pack records, oldest first, for the game files each one
        /// wrote. A file under Data\Platform with no kept copy is taken from
        /// the game folder only if nothing has written it since that pack went
        /// in, judged by its last write time against the record's. Another
        /// server's copy written afterwards is newer than the record and is
        /// left alone. Returns how many were taken.
        /// </summary>
        public static int Seed()
        {
            int n = 0;
            try
            {
                if (!Directory.Exists(Paths.PacksDir)) return 0;
                var records = new List<FileInfo>();
                foreach (string f in Directory.GetFiles(Paths.PacksDir, "*.files")) records.Add(new FileInfo(f));
                records.Sort(delegate (FileInfo a, FileInfo b) { return a.LastWriteTimeUtc.CompareTo(b.LastWriteTimeUtc); });
                const string mark = "game\\";
                foreach (FileInfo rec in records)
                {
                    string[] lines;
                    try { lines = File.ReadAllLines(rec.FullName); } catch { continue; }
                    foreach (string line in lines)
                    {
                        int bar = line.IndexOf('|');
                        if (bar < 0) continue;
                        string rel = line.Substring(bar + 1);
                        if (!rel.StartsWith(mark, StringComparison.OrdinalIgnoreCase)) continue;
                        rel = rel.Substring(mark.Length);
                        if (!UnderPlatform(rel)) continue;
                        string kept = Path.Combine(Dir, rel);
                        if (File.Exists(kept)) continue;
                        string live = Path.Combine(Paths.Game, rel);
                        if (!File.Exists(live)) continue;
                        if (File.GetLastWriteTimeUtc(live) > rec.LastWriteTimeUtc.AddMinutes(1)) continue;
                        try
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(kept));
                            File.Copy(live, kept, false);
                            n++;
                        }
                        catch (Exception ex) { Swallow.Note("Keep.Seed, copy live", ex); }
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Keep.Seed", ex); }
            return n;
        }

        /// <summary>
        /// What Hold keeps open while the game runs: every kept file, relative
        /// to the game folder. The kept list is the list of what is ours.
        /// </summary>
        public static List<string> Held() { return Kept(); }

        /// <summary>
        /// Where each parked plugin came from, so Hold can stand an empty file
        /// there for the length of the session.
        /// </summary>
        public static List<string> ParkedHomes()
        {
            var homes = new List<string>();
            try
            {
                if (!File.Exists(ParkList)) return homes;
                foreach (string line in File.ReadAllLines(ParkList))
                {
                    int bar = line.IndexOf('|');
                    if (bar < 1) continue;
                    string home = line.Substring(bar + 1);
                    if (!homes.Contains(home)) homes.Add(home);
                }
            }
            catch (Exception ex) { Swallow.Note("Keep.ParkedHomes, reading list", ex); }
            return homes;
        }

        /// <summary>Every file kept, relative to the game folder.</summary>
        static List<string> Kept()
        {
            var l = new List<string>();
            try
            {
                string root = Path.Combine(Dir, Platform.TrimEnd('\\'));
                if (!Directory.Exists(root)) return l;
                foreach (string f in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
                {
                    string rel = f.Substring(Dir.Length).TrimStart('\\', '/');
                    if (UnderPlatform(rel)) l.Add(rel);
                }
            }
            catch (Exception ex) { Swallow.Note("Keep.ParkedHomes, UnderPlatform scan", ex); }
            return l;
        }

        /// <summary>
        /// Before Play. Puts back every kept file that differs from the game
        /// copy, then moves another server's plugins aside. Returns one line
        /// for the log, or null when nothing needed doing. Never throws.
        /// </summary>
        public static string Restore()
        {
            var back = new List<string>();
            var aside = new List<string>();
            var taken = new List<string>();
            PutBackInto(back, taken, true);
            Park(aside);
            return Said(back, aside, taken);
        }

        /// <summary>
        /// Scan and Fix's half of Restore (#2627): every kept file that
        /// differs from the game copy put back, and nothing parked, because
        /// parking is for a session and the plugins it parks go home when the
        /// game closes. Returns one line for the log, or null. Never throws.
        /// </summary>
        public static string PutBack()
        {
            var back = new List<string>();
            var taken = new List<string>();
            PutBackInto(back, taken, true);
            return Said(back, new List<string>(), taken);
        }

        /// <summary>
        /// The kept files PutBack would put back, relative to the game folder,
        /// for Scan to name, and nothing written (#2627). A runtime file the
        /// kept copy is out of date for is not one: that is the kept copy's
        /// own refresh, which nobody needs telling about.
        /// </summary>
        public static List<string> Changed()
        {
            var back = new List<string>();
            PutBackInto(back, new List<string>(), false);
            return back;
        }

        /// <summary>
        /// Restore's first half, and with <paramref name="write"/> false the
        /// same walk that only says which files it would put back (into
        /// <paramref name="back"/>, as paths relative to the game folder; as
        /// file names when it writes, for the log line).
        /// </summary>
        static void PutBackInto(List<string> back, List<string> taken, bool write)
        {
            bool developer = Developer;

            foreach (string rel in Kept())
            {
                try
                {
                    string kept = Path.Combine(Dir, rel);
                    string live = Path.Combine(Paths.Game, rel);
                    // Runtime repair and pack sync have separate sources. An
                    // older retained client must never undo a verified repair
                    // at startup or immediately before Play.
                    ClientRuntime.Entry runtime = ClientRuntime.Recorded().Find(
                        delegate(ClientRuntime.Entry e) { return e.Rel.Equals(rel, StringComparison.OrdinalIgnoreCase); });
                    // A broken build record is not permission to treat the
                    // client as an ordinary UI script and restore any bytes.
                    if (runtime == null && rel.Equals("Data\\Platform\\Plugins\\skymp5-client.js", StringComparison.OrdinalIgnoreCase)) continue;
                    if (runtime != null && !runtime.Sha.Equals(ClientRuntime.Sha256Of(kept), StringComparison.OrdinalIgnoreCase))
                    {
                        if (write && runtime.Sha.Equals(ClientRuntime.Sha256Of(live), StringComparison.OrdinalIgnoreCase))
                        {
                            if (Remember(new[] { rel }) > 0) taken.Add(Path.GetFileName(rel));
                        }
                        continue;
                    }
                    if (File.Exists(live) && Same(kept, live)) continue;
                    if (runtime == null && developer && File.Exists(live) &&
                        File.GetLastWriteTimeUtc(live) > File.GetLastWriteTimeUtc(kept))
                    {
                        // On the machine that builds releases, a newer file in
                        // the game folder is an edit being tested, not another
                        // server's. It becomes the kept copy instead of being
                        // put back, or the next Play would undo the work before
                        // it could be shipped.
                        if (!write) continue;
                        File.Copy(live, kept, true);
                        taken.Add(Path.GetFileName(rel));
                        continue;
                    }
                    if (!write) { back.Add(rel); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(live));
                    OwnGame.Unshare(live);
                    File.Copy(kept, live, true);
                    back.Add(Path.GetFileName(rel));
                }
                catch (Exception ex) { Swallow.Note("Keep.Restore, copy kept to live", ex); }
            }
        }

        /// <summary>Restore's second half: another server's plugins aside until the game closes.</summary>
        static void Park(List<string> aside)
        {
            try
            {
                string dir = Path.Combine(Paths.Game, PluginDir);
                if (Directory.Exists(dir))
                {
                    foreach (string f in Directory.GetFiles(dir, "*.js"))
                    {
                        string rel = PluginDir + "\\" + Path.GetFileName(f);
                        if (IsOurs(rel)) continue;
                        try
                        {
                            Directory.CreateDirectory(ParkDir);
                            string dest = Path.Combine(ParkDir, Path.GetFileName(f));
                            if (File.Exists(dest)) dest = Path.Combine(ParkDir,
                                DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Path.GetFileName(f));
                            try { File.SetAttributes(f, FileAttributes.Normal); } catch (Exception ex) { Swallow.Note("Keep.Restore, clearing attributes", ex); }
                            File.Move(f, dest);
                            File.AppendAllText(ParkList, dest + "|" + f + Environment.NewLine);
                            aside.Add(Path.GetFileName(f));
                        }
                        catch (Exception ex) { Swallow.Note("Keep.Restore, parking file", ex); }
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Keep.Restore", ex); }
        }

        /// <summary>Restore's line for the log, or null when nothing was done.</summary>
        static string Said(List<string> back, List<string> aside, List<string> taken)
        {
            if (back.Count == 0 && aside.Count == 0 && taken.Count == 0) return null;
            string said = "";
            if (taken.Count > 0)
                said = "Refreshed " + taken.Count + " of " + Build() + "'s kept " + (taken.Count == 1 ? "file" : "files") +
                       " from the verified runtime or this machine's edits: " + string.Join(", ", taken.ToArray()) + ".";
            if (back.Count > 0)
                said += (said.Length > 0 ? " " : "") +
                        "Put back " + back.Count + " of " + Build() + "'s own game " +
                       (back.Count == 1 ? "file" : "files") + " another server or build had changed: " +
                       string.Join(", ", back.ToArray()) + ".";
            if (aside.Count > 0)
                said += (said.Length > 0 ? " " : "") +
                        "Parked " + aside.Count + (aside.Count == 1 ? " plugin" : " plugins") +
                        " from another server or build until the game closes: " + string.Join(", ", aside.ToArray()) + ".";
            return said;
        }

        /// <summary>
        /// After the game closes, and when the launcher starts: every parked
        /// plugin goes back where it came from. If its launcher has already
        /// written a fresh copy there in the meantime, the parked one is put
        /// in Profile\Isolated instead of over it. Returns how many went back.
        /// </summary>
        public static int Unpark()
        {
            int n = 0;
            try
            {
                if (!File.Exists(ParkList)) return 0;
                var left = new List<string>();
                foreach (string line in File.ReadAllLines(ParkList))
                {
                    int bar = line.IndexOf('|');
                    if (bar < 1) continue;
                    string parked = line.Substring(0, bar);
                    string home = line.Substring(bar + 1);
                    if (!File.Exists(parked)) continue;
                    try
                    {
                        // Hold's empty stand-in, still there if the launcher
                        // died before it could take it away. Not theirs, so
                        // not worth keeping.
                        try { if (File.Exists(home) && new FileInfo(home).Length == 0) File.Delete(home); } catch (Exception ex) { Swallow.Note("Keep.Unpark, removing the stand-in " + home, ex); }
                        if (File.Exists(home))
                        {
                            string bin = Path.Combine(Paths.Isolated,
                                DateTime.Now.ToString("yyyyMMdd-HHmm") + "-parked");
                            Directory.CreateDirectory(bin);
                            File.Move(parked, Path.Combine(bin, Path.GetFileName(parked)));
                        }
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(home));
                            File.Move(parked, home);
                        }
                        n++;
                    }
                    // Kept on the list for next time, as before, and now also
                    // written down, because a plugin that stays parked is a
                    // file that did not go back and nothing said which.
                    catch (Exception ex) { left.Add(line); Swallow.Note("Keep.Unpark, putting back " + parked, ex); }
                }
                if (left.Count == 0) File.Delete(ParkList);
                else File.WriteAllLines(ParkList, left.ToArray());
            }
            catch (Exception ex) { Swallow.Note("Keep.Unpark", ex); }
            return n;
        }

        /// <summary>
        /// True on the machine that publishes releases. Publish-Update writes
        /// the flag into the profile of the build it publishes from. Elsewhere
        /// the game folder is never trusted over the kept copy.
        /// </summary>
        public static bool Developer
        {
            get { try { return File.Exists(Path.Combine(Paths.ProfileDir, "developer.flag")); } catch { return false; } }
        }

        /// <summary>
        /// The note the plugins read to know this is our session. Another
        /// server's launcher that never rewrites the client settings leaves
        /// our address in them, so the address alone cannot say whose game
        /// this is. Written when the game starts, taken away when it closes
        /// and when the launcher starts. Unix milliseconds, then the build.
        /// </summary>
        static string NoteFile
        {
            get { return Path.Combine(Paths.Game, "Data\\Platform\\thornswood-session.txt"); }
        }

        public static void LeaveNote()
        {
            try
            {
                long ms = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
                Directory.CreateDirectory(Path.GetDirectoryName(NoteFile));
                File.WriteAllText(NoteFile, ms + " " + Build());
            }
            catch (Exception ex) { Swallow.Note("Keep.LeaveNote", ex); }
        }

        public static void TakeNote()
        {
            try { if (File.Exists(NoteFile)) File.Delete(NoteFile); } catch (Exception ex) { Swallow.Note("Keep.TakeNote", ex); }
        }

        /// <summary>What this install is called in the log: the build name if the shell has set one.</summary>
        public static string Build()
        {
            return string.IsNullOrEmpty(BuildName) ? "Thornswood" : BuildName;
        }

        /// <summary>Set by the shell from the config once, so the log says which build spoke.</summary>
        public static string BuildName = "";

        static bool Same(string a, string b)
        {
            try
            {
                var fa = new FileInfo(a);
                var fb = new FileInfo(b);
                if (fa.Length != fb.Length) return false;
                byte[] x = File.ReadAllBytes(a);
                byte[] y = File.ReadAllBytes(b);
                if (x.Length != y.Length) return false;
                for (int i = 0; i < x.Length; i++) if (x[i] != y[i]) return false;
                return true;
            }
            catch { return false; }
        }
    }
}
