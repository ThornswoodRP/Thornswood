using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    /// <summary>
    /// Skyrim's own archives in Thornswood's folder, kept on the disk once
    /// (#1217) without Thornswood depending on the Steam copy (#1218), and
    /// 1.6.1170's own files put into the folder by the Downgrade.
    ///
    /// THE QUESTION. Thornswood\Game and the Steam copy both hold Skyrim's
    /// archives, 15 GB of them. A hard link keeps them on the disk once, but a
    /// hard link is one file under two names, and the Steam copy is the
    /// person's to update, verify and mod however they like (Patrick,
    /// 29 Sep). So what does each of those do to a file linked from here?
    ///
    /// MEASURED, 29 September, on the shipping machine:
    ///   - Steam never writes an update or a repair into a file in place.
    ///     Every update in both content logs stages whole files under
    ///     steamapps\downloading\app and moves them in: stage totals equal the
    ///     full size of the files changed, delta updates included (Echoes of
    ///     Aincrad: download 4.7 GB and reuse 3.9 GB, stage 8.85 GB, commit of
    ///     10 files in the same second). A move puts a new file under the
    ///     Steam copy's name and leaves the file linked from here as it was.
    ///     Vortex replaces a file by renaming the old one to .vortex_backup,
    ///     which leaves it as it was too.
    ///   - A file copied over the Steam copy's DOES reach here. Of nine ways
    ///     of putting new bytes at a path with a second name linked to it,
    ///     rename, File.Replace and Move-Item left the second name on the old
    ///     bytes; .NET File.Copy with overwrite, PowerShell Copy-Item, cmd
    ///     copy /y, xcopy /y, robocopy and a patcher writing in place all
    ///     changed it. Copying files over the game is how manual mods and
    ///     other launchers' downgrades go in.
    ///   - NTFS's change time of the file moves on every one of those writes,
    ///     even when the writer puts the last-write time back, and on a name
    ///     being added or removed; reading it and holding it open do not move
    ///     it. So the change time says for certain whether the bytes can have
    ///     changed, without reading them.
    ///   - On the shipping machine 18 of the folder's archives, 13.2 GB, were
    ///     copies of their own (on record as links) and all 18 had the same
    ///     bytes as the Steam copy's. SHA-256 read them at 492 MB/s, so all of
    ///     the archives take about 30 seconds: too long for every Play, fine
    ///     once in a while.
    ///
    /// SO: an archive is linked to the Steam copy's only when the two hold the
    /// same bytes (Share), with its SHA-256, file id, size and change time on
    /// record. Before every Play (CheckShared) each linked archive's change
    /// time is read; one that moved is hashed, and one whose bytes are no
    /// longer the recorded ones is never played on. The bytes are gone from
    /// the disk then, because the one file was written, so the Downgrade
    /// fetches 1.6.1170's own files from Steam again and the folder takes a
    /// copy of its own (TakePinned). A Steam update or verify never costs
    /// that; only a file copied over the Steam copy's archive does, and then
    /// Thornswood stops and says so rather than play on the wrong bytes.
    /// Nothing here ever writes into the Steam copy.
    /// </summary>
    static partial class OwnGame
    {
        [StructLayout(LayoutKind.Sequential)]
        struct FileBasicInfo
        {
            public long CreationTime, LastAccessTime, LastWriteTime, ChangeTime;
            public uint FileAttributes;
        }

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool GetFileInformationByHandleEx(SafeFileHandle hFile, int infoClass, out FileBasicInfo info, uint size);

        /// <summary>What the Play button says while archives are compared or checked.</summary>
        public const string SharePhase = "Checking Skyrim's archives";

        /// <summary>sha256|size|file id|change time|path: one line per archive shared with the Steam copy.</summary>
        static string SharesFile { get { return Path.Combine(Dir, "shared.txt"); } }
        /// <summary>own stamp|Steam copy's stamp|path: compared and not the same bytes, so not read again until either moves.</summary>
        static string DiffersFile { get { return Path.Combine(Dir, "differs.txt"); } }
        /// <summary>One path per line: archives whose bytes changed through the Steam copy, until the Downgrade puts them back.</summary>
        static string ChangedFile { get { return Path.Combine(Dir, "changed.txt"); } }

        /// <summary>One of Skyrim's archives, directly in Data.</summary>
        public static bool IsArchive(string rel)
        {
            return Regex.IsMatch(rel, @"^Data\\[^\\]+\.bsa$", RegexOptions.IgnoreCase);
        }

        class Stamp
        {
            public string Id;
            public long Size, Change;
            public int Links;
            public bool Same(Stamp o) { return o != null && Id == o.Id && Size == o.Size && Change == o.Change; }
            public override string ToString() { return Id + ":" + Size + ":" + Change; }
        }

        class Shared
        {
            public string Sha, Rel;
            public Stamp At;
        }

        static Stamp StampOf(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                FileInfoByHandle info;
                if (!GetFileInformationByHandle(fs.SafeFileHandle, out info))
                    throw new IOException("Windows would not say which file " + path + " is.");
                FileBasicInfo basic;
                if (!GetFileInformationByHandleEx(fs.SafeFileHandle, 0, out basic, (uint)Marshal.SizeOf<FileBasicInfo>()))
                    throw new IOException("Windows would not say when " + path + " last changed.");
                var s = new Stamp();
                s.Id = info.VolumeSerialNumber.ToString("x") + "." + info.FileIndexHigh.ToString("x") + "." + info.FileIndexLow.ToString("x");
                s.Size = ((long)info.FileSizeHigh << 32) | info.FileSizeLow;
                s.Links = (int)info.NumberOfLinks;
                s.Change = basic.ChangeTime;
                return s;
            }
        }

        static string Sha256(string path)
        {
            using (var sha = SHA256.Create())
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 1 << 20, FileOptions.SequentialScan))
            {
                byte[] h = sha.ComputeHash(fs);
                var sb = new StringBuilder(64);
                foreach (byte b in h) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        // ------------------------------------------------------------ records

        static Dictionary<string, Shared> ReadShares()
        {
            var d = new Dictionary<string, Shared>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (!File.Exists(SharesFile)) return d;
                foreach (string line in File.ReadAllLines(SharesFile))
                {
                    string[] p = line.Split(new char[] { '|' }, 5);
                    if (p.Length < 5 || p[0].Length != 64) continue;
                    var s = new Shared();
                    s.Sha = p[0];
                    s.Rel = p[4];
                    s.At = new Stamp();
                    s.At.Id = p[2];
                    long.TryParse(p[1], out s.At.Size);
                    long.TryParse(p[3], out s.At.Change);
                    d[s.Rel] = s;
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.ReadShares", ex); }
            return d;
        }

        static void WriteShares(Dictionary<string, Shared> d)
        {
            var lines = new List<string>();
            foreach (Shared s in d.Values)
                lines.Add(s.Sha + "|" + s.At.Size + "|" + s.At.Id + "|" + s.At.Change + "|" + s.Rel);
            lines.Sort(StringComparer.OrdinalIgnoreCase);
            WriteRecord(SharesFile, lines);
        }

        static Dictionary<string, string> ReadDiffers()
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (!File.Exists(DiffersFile)) return d;
                foreach (string line in File.ReadAllLines(DiffersFile))
                {
                    string[] p = line.Split(new char[] { '|' }, 3);
                    if (p.Length == 3) d[p[2]] = p[0] + "|" + p[1];
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.ReadDiffers", ex); }
            return d;
        }

        static void WriteDiffers(Dictionary<string, string> d)
        {
            var lines = new List<string>();
            foreach (KeyValuePair<string, string> kv in d) lines.Add(kv.Value + "|" + kv.Key);
            lines.Sort(StringComparer.OrdinalIgnoreCase);
            WriteRecord(DiffersFile, lines);
        }

        /// <summary>
        /// Archives whose bytes changed through the Steam copy and are not
        /// back yet. Downgrade.Needed reads it: Play stays shut and the
        /// Downgrade card is up until TakePinned has put them back.
        /// </summary>
        public static List<string> Changed()
        {
            var l = new List<string>();
            try
            {
                if (!File.Exists(ChangedFile)) return l;
                foreach (string line in File.ReadAllLines(ChangedFile))
                    if (line.Trim().Length > 0) l.Add(line.Trim());
            }
            catch (Exception ex) { Swallow.Note("OwnGame.Changed", ex); }
            return l;
        }

        static void WriteChanged(ICollection<string> rels)
        {
            Directory.CreateDirectory(Dir);
            if (rels.Count == 0) { if (File.Exists(ChangedFile)) File.Delete(ChangedFile); return; }
            var l = new List<string>(rels);
            l.Sort(StringComparer.OrdinalIgnoreCase);
            WriteRecord(ChangedFile, l);
        }

        /// <summary>A folder made anew starts with no record of what an earlier one shared.</summary>
        static void ForgetShares()
        {
            foreach (string f in new string[] { SharesFile, DiffersFile, ChangedFile })
            {
                try { if (File.Exists(f)) File.Delete(f); }
                catch (Exception ex) { Swallow.Note("OwnGame.ForgetShares, " + f, ex); }
            }
        }

        // ------------------------------------------------------------ sharing

        /// <summary>
        /// Links each of the game's own archives in the folder to the Steam
        /// copy's file at the same path when the two hold the same bytes, and
        /// puts every linked archive on record. Run by Make and Refresh, after
        /// CheckShared has looked at what is on record already. Only this
        /// folder's names change: the Steam copy's file is read, and gains a
        /// name, and nothing is written into it. Returns a line for the log,
        /// or null when nothing changed.
        /// </summary>
        public static string Share(string steam, Action<string> say)
        {
            if (string.IsNullOrEmpty(steam) || !Directory.Exists(steam) || !Directory.Exists(Folder) || SameFolder(steam, Folder)) return null;
            string bad = CheckShared(steam, say);

            Dictionary<string, Rec> files = ReadFiles();
            Dictionary<string, Shared> shares = ReadShares();
            Dictionary<string, string> differs = ReadDiffers();
            var changed = new HashSet<string>(Changed(), StringComparer.OrdinalIgnoreCase);
            bool oneDrive = SameVolume(steam, Folder);

            var archives = new List<string>();
            foreach (KeyValuePair<string, Rec> kv in files)
                if (kv.Value.Origin == 'O' && IsArchive(kv.Key) && !changed.Contains(kv.Key)) archives.Add(kv.Key);
            archives.Sort(StringComparer.OrdinalIgnoreCase);

            int linked = 0, onRecord = 0, looked = 0;
            long saved = 0;
            foreach (string rel in archives)
            {
                PlayProgress.Files(SharePhase, looked++, archives.Count);
                string own = Path.Combine(Folder, rel), theirs = Path.Combine(steam, rel);
                try
                {
                    if (!File.Exists(own) || !File.Exists(theirs)) continue;
                    Stamp o = StampOf(own), s = StampOf(theirs);
                    Shared had;
                    shares.TryGetValue(rel, out had);
                    if (o.Id == s.Id)
                    {
                        // One file already, from Make or from before this
                        // record existed: its bytes go on record as they are.
                        if (had != null && had.At.Same(o)) continue;
                        var now = new Shared();
                        now.Rel = rel;
                        now.Sha = Sha256(own);
                        now.At = StampOf(own);
                        shares[rel] = now;
                        onRecord++;
                        continue;
                    }
                    if (!oneDrive || o.Size != s.Size) continue;
                    string memo = o + "|" + s, was;
                    if (differs.TryGetValue(rel, out was) && was == memo) continue;
                    if (say != null) say("Comparing " + rel + " with the Steam copy's, " + Mb(o.Size) + ".");
                    string sha = Sha256(own);
                    if (!string.Equals(sha, Sha256(theirs), StringComparison.Ordinal))
                    {
                        differs[rel] = memo;
                        continue;
                    }
                    // The same bytes: this folder's name moves onto the Steam
                    // copy's file. The new name is made first, so a stop part
                    // way never leaves the folder without the archive.
                    string next = own + ".thornswood-share";
                    // A .thornswood-share left by a stopped run is a link to the
                    // Steam copy's file: its name goes without touching the
                    // file's read only mark (#2599).
                    DeleteName(next);
                    if (!CreateHardLink(next, theirs, IntPtr.Zero)) continue;
                    SwapNameIn(next, own, true);   // one rename, never a delete first; next goes if it is refused
                    var sh = new Shared();
                    sh.Rel = rel;
                    sh.Sha = sha;
                    sh.At = StampOf(own);
                    shares[rel] = sh;
                    differs.Remove(rel);
                    linked++;
                    saved += o.Size;
                }
                catch (Exception ex) { Swallow.Note("OwnGame.Share, " + rel, ex); }
            }
            PlayProgress.Files(SharePhase, archives.Count, archives.Count);

            WriteShares(shares);
            WriteDiffers(differs);
            if (linked > 0)
                try { WriteRecord(FilesList, Relabel(File.ReadAllLines(FilesList), shares)); }
                catch (Exception ex) { Swallow.Note("OwnGame.Share, files list", ex); }

            string said = null;
            if (linked > 0)
                said = linked + " of Skyrim's archives in Thornswood's folder held the same bytes as the Steam copy's and are one file with them now, " +
                       Mb(saved) + " back on the disk. They are checked before every Play, and nothing is ever written into the Steam copy.";
            else if (onRecord > 0)
                said = onRecord + " of Skyrim's archives Thornswood's folder shares with the Steam copy are on record now, and checked before every Play.";
            if (bad != null) said = said == null ? bad : said + " " + bad;
            return said;
        }

        /// <summary>files.txt with each shared archive's kind set to L.</summary>
        static string[] Relabel(string[] lines, Dictionary<string, Shared> shares)
        {
            for (int i = 0; i < lines.Length; i++)
            {
                string[] p = lines[i].Split(new char[] { '|' }, 5);
                if (p.Length == 5 && shares.ContainsKey(p[4])) lines[i] = "L" + lines[i].Substring(1);
            }
            return lines;
        }

        /// <summary>
        /// Before every Play: each archive shared with the Steam copy still
        /// holds the bytes on record. Its change time is read and nothing
        /// more, unless it moved; then it is hashed. One whose bytes changed is
        /// taken from the Steam copy's file again only when that is a
        /// different file with the recorded bytes; otherwise it goes on
        /// Changed and Play stays shut until the Downgrade puts it back.
        /// Null when everything is as recorded, otherwise one sentence.
        /// </summary>
        public static string CheckShared(string steam, Action<string> say)
        {
            Dictionary<string, Shared> shares = ReadShares();
            var changed = new HashSet<string>(Changed(), StringComparer.OrdinalIgnoreCase);
            bool dirty = false;
            foreach (Shared s in new List<Shared>(shares.Values))
            {
                string own = Path.Combine(Folder, s.Rel);
                try
                {
                    Stamp o = File.Exists(own) ? StampOf(own) : null;
                    if (o != null && o.Same(s.At)) continue;
                    dirty = true;
                    if (o != null)
                    {
                        if (say != null) say("Checking " + s.Rel + ": it changed on the disk since the last check, so its bytes are read, " + Mb(o.Size) + ".");
                        if (string.Equals(Sha256(own), s.Sha, StringComparison.Ordinal))
                        {
                            // The same bytes. Most often the Steam copy's name
                            // went, which a Steam update does; the file is then
                            // this folder's alone and needs no more checking.
                            s.At = StampOf(own);
                            if (s.At.Links <= 1) shares.Remove(s.Rel);
                            continue;
                        }
                    }
                    if (TakeBack(steam, s, o))
                    {
                        if (say != null) say(s.Rel + " is back to the bytes on record, from the Steam copy's file, which still has them.");
                        continue;
                    }
                    shares.Remove(s.Rel);
                    changed.Add(s.Rel);
                }
                catch (Exception ex)
                {
                    // Not readable now, the game holding it for one: checked
                    // again at the next Play, and not called changed.
                    Swallow.Note("OwnGame.CheckShared, " + s.Rel, ex);
                }
            }
            if (dirty)
            {
                try { WriteShares(shares); WriteChanged(changed); }
                catch (Exception ex) { Swallow.Note("OwnGame.CheckShared, records", ex); }
            }
            if (changed.Count == 0) return null;
            var names = new List<string>(changed);
            names.Sort(StringComparer.OrdinalIgnoreCase);
            return "Skyrim's " + string.Join(", ", names.ToArray()) + " in Thornswood's folder " + (names.Count == 1 ? "is" : "are") +
                   " no longer the bytes it was made with: " + (names.Count == 1 ? "it was" : "they were") +
                   " one file with the Steam copy's, and something copied over " + (names.Count == 1 ? "that" : "those") +
                   " in the Steam copy. Thornswood will not start on files that are not 1.6.1170's. Press Downgrade on the Play page: " +
                   "Steam downloads 1.6.1170's own files again, and Thornswood's folder keeps a copy of its own. The Steam copy is not changed.";
        }

        /// <summary>
        /// The Steam copy's file at the same path, when it is a different file
        /// from this folder's and has the recorded bytes, becomes this folder's
        /// again. True when it did.
        /// </summary>
        static bool TakeBack(string steam, Shared s, Stamp o)
        {
            if (string.IsNullOrEmpty(steam) || SameFolder(steam, Folder)) return false;
            string theirs = Path.Combine(steam, s.Rel), own = Path.Combine(Folder, s.Rel);
            if (!File.Exists(theirs)) return false;
            Stamp t = StampOf(theirs);
            if ((o != null && t.Id == o.Id) || t.Size != s.At.Size) return false;
            if (!string.Equals(Sha256(theirs), s.Sha, StringComparison.Ordinal)) return false;
            string next = own + ".thornswood-share";
            DeleteName(next);   // a stale one may be a read only link to the Steam copy's file (#2599)
            bool linked;
            Place(theirs, next, !SameVolume(steam, Folder), out linked);
            SwapNameIn(next, own, true);   // one rename, never a delete first; next goes if it is refused
            s.At = StampOf(own);
            return true;
        }

        // ------------------------------------------------------------ Downgrade

        /// <summary>
        /// Puts 1.6.1170's own files, from the folders the Downgrade downloaded
        /// them into, into the folder the game runs from: Thornswood's own
        /// folder, or the Game folder of an install older than the collection.
        /// Never the Steam copy (#1218): with no folder of its own the
        /// Downgrade leaves its download for Make instead.
        ///
        /// Each file's name comes off first, so nothing is written through a
        /// hard link, and SkyrimSE.exe goes last, so a stop part way leaves the
        /// build reading as not 1.6.1170 and the Downgrade card up (#369 F3).
        /// The collection's files, and what a Thornswood update wrote, stay as
        /// they are. The record then lists each as the folder's own copy, and
        /// Share links the archives that are the same as the Steam copy's
        /// again. <paramref name="progress"/> gets bytes copied and bytes in
        /// all. Returns a line for the log, or throws with a sentence.
        /// </summary>
        public static string TakePinned(Config cfg, List<string> pinned, Action<long, long> progress, Action<string> say)
        {
            if (Paths.Collection)
                throw new Exception("Thornswood has no folder of its own yet, and the Steam copy is never written. The folder is made from the downloaded files instead.");
            string game = Paths.Game;
            bool made = Active;
            Dictionary<string, Rec> files = made ? ReadFiles() : null;
            var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (made)
            {
                foreach (KeyValuePair<string, Rec> kv in files) if (kv.Value.Origin == 'V' || kv.Value.Origin == 'T') keep.Add(kv.Key);
                foreach (string rel in Owned(new HashSet<string>(StringComparer.OrdinalIgnoreCase))) keep.Add(rel);
            }
            else keep = DeployedIn(game);

            var take = new List<Found>();
            Found exe = null;
            long total = 0;
            int kept = 0;
            foreach (string dir in pinned)
            {
                foreach (Found f in Walk(dir))
                {
                    if (f.Rel.StartsWith(".thornswood", StringComparison.OrdinalIgnoreCase)) continue;
                    if (keep.Contains(f.Rel)) { kept++; continue; }
                    total += f.Size;
                    if (string.Equals(f.Rel, "SkyrimSE.exe", StringComparison.OrdinalIgnoreCase)) exe = f;
                    else take.Add(f);
                }
            }
            if (exe != null) take.Add(exe);

            long done = 0;
            var took = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Found f in take)
            {
                string dest = Path.Combine(game, f.Rel);
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    if (File.Exists(dest)) DropName(dest);
                    File.Copy(f.From, dest, false);
                }
                catch (Exception ex)
                {
                    throw new Exception("Could not put " + f.Rel + " into " + game + ": " + ex.Message);
                }
                took.Add(f.Rel);
                done += f.Size;
                if (progress != null) progress(done, total);
                if (made)
                {
                    var r = new Rec();
                    r.Kind = 'C';
                    r.Origin = 'O';
                    r.Size = f.Size;
                    r.Ticks = f.Ticks;
                    files[f.Rel] = r;
                }
            }

            if (made)
            {
                var lines = new List<string>();
                foreach (KeyValuePair<string, Rec> kv in files)
                    lines.Add(kv.Value.Kind + "|" + kv.Value.Origin + "|" + kv.Value.Size + "|" + kv.Value.Ticks + "|" + kv.Key);
                WriteRecord(FilesList, lines);

                Dictionary<string, Shared> shares = ReadShares();
                Dictionary<string, string> differs = ReadDiffers();
                var changed = new HashSet<string>(Changed(), StringComparer.OrdinalIgnoreCase);
                foreach (string rel in took) { shares.Remove(rel); differs.Remove(rel); changed.Remove(rel); }
                WriteShares(shares);
                WriteDiffers(differs);
                WriteChanged(changed);
            }

            string said = "Put " + took.Count.ToString("n0") + " of 1.6.1170's own files, " + Mb(done) + ", into " + game + "." +
                          (kept > 0 ? " " + kept + " that the collection or a Thornswood update replaces were left as they are." : "") +
                          " The Steam copy was not changed.";
            if (made)
            {
                string shared = Share(Source(cfg), say);
                if (shared != null) said += " " + shared;
            }
            return said;
        }
    }
}
