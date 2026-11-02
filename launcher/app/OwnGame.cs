using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    /// <summary>
    /// Thornswood's own Skyrim folder, Root\Game, made from whatever Vortex has
    /// deployed while the Thornswood collection is the profile it has on.
    ///
    /// Until 17 September three roleplay servers all ran out of the one
    /// Steam copy of Skyrim. Every launcher wrote its own client into it, every
    /// Vortex profile switch took the other collection out of it, and on 16 Sep
    /// that was another server's session drawing Thornswood's menu, a Daedric menu
    /// behind every server, and a Thornswood launcher that thought its mods were
    /// gone whenever Vortex had another profile on. With a folder of its own,
    /// Thornswood starts from Root\Game, the other servers start from theirs,
    /// and switching the profile in Vortex no longer reaches Thornswood at all.
    ///
    /// The folder is made of hard links, not copies, so the collection is not
    /// on the disk twice. A hard link is the same file under a second name, so
    /// anything written into a linked file in place would land in Vortex's copy
    /// and in every other folder that links it. The game and the mods rewrite
    /// their settings files all the time, and every launcher rewrites its
    /// client. So those are copied and only the big files nothing writes to are
    /// linked: archives, textures, meshes, sounds, plugins. What this launcher
    /// itself writes over goes through Unshare or Separate first.
    ///
    /// Paths.Init already picks Root\Game over the Steam copy when it exists;
    /// that is the layout installs had before the collection. The difference is
    /// only where the files came from, recorded in Profile\OwnGame.
    ///
    /// ONCE MADE, THE FOLDER NEEDS NOTHING FROM THE STEAM COPY (#1218).
    /// Patrick, 29 Sep: "it shouldn't be using Steam's now anyway, but this
    /// way people can play vanilla at whatever version and their own mods".
    /// The Steam copy is the person's: they may update it, verify it and mod
    /// it however they like. So it is read once, when the folder is first
    /// made (Make), and only if it is on 1.6.1170; when it is on another
    /// build the Downgrade downloads 1.6.1170's own files from Steam and the
    /// folder is made from those instead. From then on the folder holds the
    /// game itself, a refresh takes nothing but Vortex's deployment (Vortex),
    /// the game's own files are the folder's own copies, and nothing here
    /// writes into the Steam copy. Skyrim's archives are the one thing still
    /// kept on the disk once, and only while their bytes are the same as the
    /// folder's own record; OwnGameShare.cs checks that before every Play.
    ///
    /// A THIRD WAY IN, FOR THE SHIP ROOT TOOL ONLY (#2603). On 16 Oct the
    /// machine that ships could not make main's ship root: its Steam copy has
    /// 1.6.1170's exe but another bink2w64.dll and Dawnguard.esm and the
    /// Anniversary Edition's Creation Club files, and the Downgrade is a Steam
    /// download under the person's own account, which a script cannot start.
    /// Its dev ship root's Game held 1.6.1170's own files already. So Make
    /// can take the game's own files from a folder that holds them byte for
    /// byte as records\skyrim-files.json lists them (SkyrimFrom,
    /// OwnGameKinds.cs): every one Make takes is checked before anything is
    /// placed, then copied, never linked, so the new folder never shares a
    /// file with the folder it came from. The launcher does not offer it: an
    /// install's way to 1.6.1170's own files is the Downgrade, under the
    /// person's own Steam account, and nobody's install needs another.
    /// </summary>
    static partial class OwnGame
    {
        [LibraryImport("kernel32.dll", EntryPoint = "CreateHardLinkW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

        // FILETIME as the structure below holds it. Our own rather than
        // ComTypes.FILETIME, which is another assembly's, so the generated
        // call cannot count it as plain memory and refuses it (#4823).
        struct FileTime
        {
            public int dwLowDateTime;
            public int dwHighDateTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct FileInfoByHandle
        {
            public uint FileAttributes;
            public FileTime CreationTime;
            public FileTime LastAccessTime;
            public FileTime LastWriteTime;
            public uint VolumeSerialNumber;
            public uint FileSizeHigh;
            public uint FileSizeLow;
            public uint NumberOfLinks;
            public uint FileIndexHigh;
            public uint FileIndexLow;
        }

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool GetFileInformationByHandle(SafeFileHandle hFile, out FileInfoByHandle info);

        [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        private static partial SafeFileHandle CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
            IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

        // Links opens a file for its attributes alone (#2210).
        const uint FileReadAttributes = 0x80;
        const uint FileShareAll = 0x7;          // read, write, delete
        const uint OpenExisting = 3;
        const uint BackupSemantics = 0x02000000;

        // ---------------------------------------------------------------- where

        /// <summary>The folder this makes. Paths.Init runs the game from here once it exists.</summary>
        public static string Folder { get { return Path.Combine(Paths.Root, "Game"); } }

        /// <summary>The records: what came from where, and when.</summary>
        public static string Dir { get { return Path.Combine(Paths.ProfileDir, "OwnGame"); } }

        /// <summary>What the Play button says while Make or Refresh works (#1145).</summary>
        public const string Phase = "Preparing the game folder";

        /// <summary>
        /// One line per file brought in: kind (L linked, C copied), origin (V
        /// deployed by Vortex, O Skyrim's own, T Thornswood's own; before
        /// Rules 13 O was anything not Vortex's), size and write time of the
        /// source when it was brought in, then the path under the game folder.
        /// Publish-Update reads the V lines to keep the collection out of packs.
        /// </summary>
        static string FilesList { get { return Path.Combine(Dir, "files.txt"); } }
        static string MadeFile { get { return Path.Combine(Dir, "made.txt"); } }
        static string LeftOutFile { get { return Path.Combine(Dir, "left-out.txt"); } }
        static string DeclinedFile { get { return Path.Combine(Dir, "declined.txt"); } }
        /// <summary>
        /// When the Steam copy was cleaned of Thornswood's files, what came out
        /// and what was left (OwnGameClean.cs, #1226). Its presence means done.
        /// </summary>
        static string CleanedFile { get { return Path.Combine(Dir, "steam-copy-cleaned.txt"); } }

        /// <summary>
        /// Writes one of the records the launcher keeps about this folder
        /// whole or not at all (#2586). Written straight over the old file, a
        /// launcher killed during the write, or a disk that filled, left the
        /// record cut short: files.txt is about 3 MB and the one record of
        /// which files are Vortex's, and Publish-Update refuses an empty one
        /// but would take a cut one as the truth. So the lines go to a file
        /// beside the record, are flushed to the disk, and that file is
        /// renamed over the record in one call, MoveFileEx with
        /// MOVEFILE_REPLACE_EXISTING: until that call the record is the old
        /// one, after it the new one, and a stop anywhere leaves at most a
        /// .new beside it, which the next write replaces.
        ///
        /// Not File.Replace. ReplaceFile moves the old record aside to a
        /// name of its own first (files.txt~RF....TMP) and then moves the new
        /// one in, so a process killed between the two leaves no record at
        /// all. Measured 16 Oct on One: a writer swapping a 3 MB record in a
        /// loop, killed 150 times, left files.txt missing 4 times through
        /// File.Replace and whole all 150 times through MoveFileEx
        /// (launcher\tests\test-2586-atomic-records.ps1 holds it to that).
        ///
        /// Internal, and the one way the launcher writes a record it keeps
        /// in its Profile (#2591): Updater's release.txt and
        /// release-files.txt (Sync.cs) and the settings cache (FeedSettings.cs) go
        /// through it too. They deleted the old file and then moved the new
        /// one in; killed 150 times, that left the record missing 30 times.
        /// </summary>
        internal static void WriteRecord(string path, IEnumerable<string> lines)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string next = path + ".new";
            using (var fs = new FileStream(next, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                using (var w = new StreamWriter(fs, new UTF8Encoding(false)))
                {
                    foreach (string line in lines) w.WriteLine(line);
                    w.Flush();
                    fs.Flush(true);
                }
            }
            SwapIn(next, path);
        }

        /// <summary>The same, for a record kept byte for byte (the settings cache).</summary>
        internal static void WriteRecord(string path, byte[] bytes)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string next = path + ".new";
            using (var fs = new FileStream(next, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                fs.Write(bytes, 0, bytes.Length);
                fs.Flush(true);
            }
            SwapIn(next, path);
        }

        /// <summary>Renames next over path in one call, replacing it.</summary>
        static void SwapIn(string next, string path)
        {
            if (!MoveFileEx(next, path, MoveReplaceExisting | MoveWriteThrough))
                throw new IOException(path + " could not be replaced by " + next + ": " +
                                      new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()).Message);
        }

        /// <summary>
        /// Puts next in path's place in one rename (#2599), the same MoveFileEx
        /// the records use: until the call path is the old file, after it the
        /// new one, and a launcher stopped anywhere never leaves path missing.
        /// A delete and then a move left a moment with no file: killed 150
        /// times, that left it missing 30 times (#2591). Not SwapIn, which is
        /// the records' plain rename; this one also waits out a lock and may
        /// clear a read only mark.
        ///
        /// next is never opened for writing here. A fresh copy is flushed by
        /// the one that made it (SwapCopyIn), so the name never points at bytes
        /// still only in the cache. Any other next is a link to a file already
        /// on the disk under another name (the share step links the Steam
        /// copy's own file), with nothing to flush, and a write handle on it
        /// would be one on Steam's file, which Steam reading it refuses.
        ///
        /// A lock (an antivirus scan, the indexer, Steam reading the file) is
        /// waited out: the rename is tried again for about 600 ms while it is
        /// refused with a sharing violation (32) or an access denied (5) that
        /// is not a read only mark.
        ///
        /// Read only belongs to the file, not the name, and a rename over a
        /// read only file is refused. clearReadOnly is DropName's rule, for a
        /// name this folder is letting go of: the mark is cleared only when the
        /// rename was refused because of it, and if the rename is refused even
        /// then, the mark goes back on, on every name of the file, before the
        /// refusal is thrown. Without clearReadOnly the refusal is thrown and
        /// path is left as it was.
        /// </summary>
        internal static void ReplaceName(string next, string path, bool clearReadOnly)
        {
            int err = MoveOver(next, path);
            if (err == 0) return;
            if (clearReadOnly && err == 5 && File.Exists(path))
            {
                FileAttributes was = File.GetAttributes(path);
                if ((was & FileAttributes.ReadOnly) != 0)
                {
                    File.SetAttributes(path, was & ~FileAttributes.ReadOnly);
                    err = MoveOver(next, path);
                    if (err == 0) return;
                    File.SetAttributes(path, was);
                }
            }
            throw new IOException(path + " could not be replaced by " + next + ": " +
                                  new System.ComponentModel.Win32Exception(err).Message);
        }

        /// <summary>One MoveFileEx over path, tried again while a lock refuses it. 0, or the last Win32 error.</summary>
        static int MoveOver(string next, string path)
        {
            for (int tries = 1; ; tries++)
            {
                if (MoveFileEx(next, path, MoveReplaceExisting | MoveWriteThrough)) return 0;
                int err = Marshal.GetLastWin32Error();
                if (err != 32 && err != 5) return err;
                // A read only mark refuses with 5 as well, and waiting does not lift it.
                if (err == 5 && File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReadOnly) != 0) return err;
                if (tries >= MoveTries) return err;
                System.Threading.Thread.Sleep(40 * tries);
            }
        }

        const int MoveTries = 6;   // 40 + 80 + ... + 200 ms, 600 ms at most

        /// <summary>
        /// Flushes a file's bytes to the disk (FlushFileBuffers, through
        /// FileStream.Flush(true)), for a fresh copy this file just made.
        /// </summary>
        static void FlushToDisk(string file)
        {
            using (var fs = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
                fs.Flush(true);
        }

        const int MoveReplaceExisting = 0x1;
        const int MoveWriteThrough = 0x8;
        [LibraryImport("kernel32.dll", EntryPoint = "MoveFileExW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool MoveFileEx(string existing, string replacement, int flags);

        // ---- #2599: one name of the game folder replaced whole ------------------

        /// <summary>
        /// Takes one name off a file without touching the file's attributes
        /// (#2599). A read only file's name cannot be deleted the ordinary way,
        /// and clearing the mark to delete it clears it on every other name of
        /// the file too: on a .thornswood-share link that is the Steam copy's
        /// own file. So the name goes with FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE
        /// (Windows 10 1809 and later), which deletes the name and leaves the
        /// mark. On an older Windows the mark is cleared and the name deleted,
        /// which is what DropName does.
        /// </summary>
        internal static void DeleteName(string path)
        {
            if (!File.Exists(path)) return;
            bool gone = false;
            using (Microsoft.Win32.SafeHandles.SafeFileHandle h = OpenForDelete(path, 0x10000, 7, IntPtr.Zero, 3, 0x200000, IntPtr.Zero))
            {
                if (!h.IsInvalid)
                {
                    int flags = 0x1 | 0x2 | 0x10;   // DELETE, POSIX_SEMANTICS, IGNORE_READONLY_ATTRIBUTE
                    gone = SetFileInformationByHandle(h, 21, ref flags, 4);   // FileDispositionInfoEx
                }
            }
            if (gone) return;
            File.SetAttributes(path, File.GetAttributes(path) & ~FileAttributes.ReadOnly);
            File.Delete(path);
        }

        /// <summary>
        /// A copy of path's own, put in path's place (Enforce.MakeItOurs and
        /// Separate). A copy left by a stopped run goes first, read only or
        /// not; File.Copy carries the source's read only mark, which would
        /// refuse every copy over it after. The new copy is written, its mark
        /// cleared so it can be flushed, and renamed over path in one call. If
        /// that is refused (path read only, shared with Vortex's copy), path is
        /// left as it was and the copy goes.
        /// </summary>
        internal static void SwapCopyIn(string path, string aside)
        {
            DeleteName(aside);
            File.Copy(path, aside, false);
            File.SetAttributes(aside, File.GetAttributes(aside) & ~FileAttributes.ReadOnly);
            FlushToDisk(aside);
            SwapNameIn(aside, path, false);
        }

        /// <summary>ReplaceName, and if it is refused, next goes, so nothing is left beside path.</summary>
        internal static void SwapNameIn(string next, string path, bool clearReadOnly)
        {
            try { ReplaceName(next, path, clearReadOnly); }
            catch
            {
                try { DeleteName(next); }
                catch (Exception ex) { Swallow.Note("OwnGame.SwapNameIn, clean up " + next, ex); }
                throw;
            }
        }

        [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        private static partial Microsoft.Win32.SafeHandles.SafeFileHandle OpenForDelete(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool SetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle file, int infoClass, ref int info, int size);

        // ---- end #2599 -----------------------------------------------------------

        /// <summary>A folder made anew has its Steam copy looked at again (Make).</summary>
        static void ForgetCleaned()
        {
            try { if (File.Exists(CleanedFile)) File.Delete(CleanedFile); }
            catch (Exception ex) { Swallow.Note("OwnGame.ForgetCleaned", ex); }
        }

        /// <summary>True when the game runs from a folder this made.</summary>
        public static bool Active
        {
            get
            {
                try
                {
                    return !Paths.Collection && File.Exists(FilesList) &&
                           string.Equals(Path.GetFullPath(Paths.Game).TrimEnd('\\'), Path.GetFullPath(Folder).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
                }
                catch { return false; }
            }
        }

        /// <summary>Somebody said no to the offer at startup. Settings still has the button.</summary>
        public static bool Declined
        {
            get { try { return File.Exists(DeclinedFile); } catch { return false; } }
        }

        public static void Decline()
        {
            try { WriteRecord(DeclinedFile, new string[] { DateTime.Now.ToString("o") }); } catch (Exception ex) { Swallow.Note("OwnGame.Decline, write", ex); }
        }

        /// <summary>
        /// The Skyrim the game itself is taken from when the folder is first
        /// made: a Steam copy of Skyrim Special Edition. When Vortex deploys
        /// into a Steam copy it is that folder, which is the ordinary case and
        /// every install before 24 September. When Vortex deploys into any
        /// other folder it is still the Steam copy and never that folder (see
        /// DeploysInto and Gather). Once the folder is made nothing reads the
        /// game from it again (#1218); Share compares Skyrim's archives with
        /// it, and Leaks and Uninstall take back only files Thornswood itself
        /// once put there, so none of them ever writes into another server's
        /// copy of the game.
        /// </summary>
        public static string Source(Config cfg)
        {
            return GameFor(DeploysInto(cfg));
        }

        /// <summary>
        /// The Skyrim folder Vortex deploys into, where its record of what it
        /// deployed is read. In order: the config's VortexGame when it names a
        /// Skyrim that still holds Vortex's record (Fix and the picker in
        /// Settings set it; without the record it is passed over, so a choice
        /// Vortex has since purged cannot pin Thornswood to it); the Steam copy when
        /// Vortex's record is in it, which is the answer this always gave;
        /// another folder in a Steam library that has Vortex's record (Find);
        /// and last the Steam copy anyway, so WhyNot has a folder to name.
        /// </summary>
        public static string DeploysInto(Config cfg)
        {
            // Fix saves VortexGame by itself, so a tester who later points
            // Vortex back at the Steam copy would otherwise leave Thornswood
            // following a folder Vortex has purged, with nothing said and only
            // Forget in Settings as a way out. Found in review, 24 September.
            //
            // Quotes are taken off and nothing here may throw: a path typed
            // into config.json by hand, pasted from Explorer's Copy as path,
            // arrives in quotes, and Path.Combine threw on it out of here and
            // out of the Settings card on the window's thread. Found by the
            // verification of hotfix 1.1.93.
            string s = cfg == null || cfg.VortexGame == null ? "" : cfg.VortexGame.Trim().Trim('"').Trim().TrimEnd('\\');
            bool usable = false;
            try { usable = s.Length > 0 && File.Exists(Path.Combine(s, "SkyrimSE.exe")) && HasRecord(s); }
            catch { usable = false; }
            if (usable)
            {
                Chosen(s, "VortexGame in config.json names it");
                return s;
            }
            string steam = "";
            try { steam = Steam.SkyrimPath(); } catch { /* no Steam copy: "" is the answer, and WhyNot says so */ }
            if (steam.Length > 0 && HasRecord(steam))
            {
                Chosen(steam, "Vortex's record is in the Steam copy");
                return steam;
            }
            string why = null, found = "";
            try { found = Find(out why); }
            catch (Exception ex) { Swallow.Note("OwnGame.DeploysInto, looking through Steam's libraries for Vortex's folder", ex); }
            if (found.Length > 0)
            {
                Chosen(found, why);
                return found;
            }
            return steam;
        }

        /// <summary>
        /// The folder Vortex deploys into when nothing says, or "".
        ///
        /// 24 September, a tester on the main build: "they have purged and
        /// redeoployed several times, they never got a popup to build their
        /// own folder", and the launcher said Vortex had nothing deployed in
        /// S:\SteamLibrary\steamapps\common\Skyrim Special Edition. Their
        /// Vortex, Mods, Open, Open Game Folder opened
        /// a folder of its own under S:\SteamLibrary\steamapps\common, another SkyMP
        /// server's copy of Skyrim: their Vortex manages that folder and
        /// deploys the Thornswood collection into it, so the Steam copy had
        /// none of the 94 plugins. Vortex's own note of its game folder is in
        /// %APPDATA%\Vortex\state.v2, a LevelDB whose tables are compressed,
        /// and the path is not readable in it as text. So the folder is found
        /// by what Vortex leaves in every folder it deploys to, whatever the
        /// method: Data\vortex.deployment.json.
        ///
        /// Every folder directly under each library's steamapps\common is
        /// looked at, not only Skyrim Special Edition. A Steam copy of Skyrim
        /// Special Edition comes first when more than one has a record, and
        /// otherwise the most recently written record wins.
        /// </summary>
        static string Find(out string why)
        {
            why = null;
            string best = "";
            long bestAt = -1;
            bool bestSteam = false;
            int count = 0;
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string lib in Steam.Libraries())
            {
                string[] dirs;
                try { dirs = Directory.GetDirectories(Path.Combine(lib, "steamapps\\common")); }
                catch { continue; }
                foreach (string d in dirs)
                {
                    string full;
                    try { full = Path.GetFullPath(d).TrimEnd('\\'); } catch { continue; }
                    if (!seen.Add(full)) continue;
                    if (!File.Exists(Path.Combine(full, "SkyrimSE.exe")) || !HasRecord(full)) continue;
                    count++;
                    bool steam = Steam.IsSkyrimCopy(full);
                    long at = 0;
                    try { at = File.GetLastWriteTimeUtc(Path.Combine(full, "Data\\vortex.deployment.json")).Ticks; } catch { /* unreadable: counts as the oldest record */ }
                    if (best.Length == 0 || (steam && !bestSteam) || (steam == bestSteam && at > bestAt))
                    {
                        best = full;
                        bestAt = at;
                        bestSteam = steam;
                    }
                }
            }
            if (best.Length == 0) return "";
            if (count == 1)
                why = "found in Steam's libraries, the one folder there with Vortex's record in it";
            else if (bestSteam)
                why = "found in Steam's libraries; " + count + " folders there have Vortex's record, and a Steam copy of Skyrim Special Edition comes first";
            else
                why = "found in Steam's libraries; " + count + " folders there have Vortex's record and none is a Steam copy of Skyrim Special Edition, so the newest record wins";
            return best;
        }

        static readonly object chosenLock = new object();
        static string lastChosen;

        /// <summary>Which folder Vortex deploys into and why, into the log once each time the answer changes.</summary>
        static void Chosen(string folder, string why)
        {
            string line = "Vortex deploys into " + folder + ": " + why + ".";
            lock (chosenLock)
            {
                if (line == lastChosen) return;
                lastChosen = line;
            }
            try { File.AppendAllText(Paths.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine); }
            catch { /* the log is only a note of the choice; the choice stands without it */ }
        }

        static bool HasRecord(string dir)
        {
            try { return File.Exists(Path.Combine(dir, "Data\\vortex.deployment.json")); }
            catch { return false; }
        }

        /// <summary>
        /// The install whose game folder <paramref name="dir"/> is, when it is
        /// one: a folder named Game beside a Profile\OwnGame\files.txt, this
        /// install's own or another's (the dev build's, a release folder's).
        /// Null for any other folder.
        /// </summary>
        public static string ThornswoodInstallOf(string dir)
        {
            try
            {
                if (string.IsNullOrEmpty(dir)) return null;
                string full = Path.GetFullPath(dir.Trim().Trim('"')).TrimEnd('\\');
                if (!string.Equals(Path.GetFileName(full), "Game", StringComparison.OrdinalIgnoreCase)) return null;
                string root = Path.GetDirectoryName(full);
                if (string.IsNullOrEmpty(root)) return null;
                return File.Exists(Path.Combine(root, "Profile\\OwnGame\\files.txt")) ? root : null;
            }
            catch { return null; }
        }

        /// <summary>
        /// Null unless Vortex deploys into a Thornswood game folder, this
        /// install's or another's; then why nothing is made or brought up to
        /// date from it, and what to do (#2210, decided by Patrick on 12 Oct).
        ///
        /// Vortex deploys by hard link, so every file it deploys into a folder
        /// is a second name of its own copy in its mods folder. From 3 to 11
        /// Oct Vortex deployed into C:\Thornswood-DevBuild\Game on the machine
        /// that ships: each refresh of that folder made the ~7,500 Nemesis
        /// patches it keeps as copies its own again, and Vortex's next deploy
        /// linked them again, while the main install and the dev release folder
        /// took that folder as their source and shared its files. The settled
        /// design is that the launcher never writes into a folder Vortex
        /// manages, so this refuses the setup rather than undoing it at every
        /// refresh.
        /// </summary>
        static string ThornswoodSource(Config cfg, string src)
        {
            string root = ThornswoodInstallOf(src);
            if (root == null && !SameFolder(src, Folder)) return null;
            if (root == null) root = Paths.Root;
            string steam = "";
            try { steam = Steam.SkyrimPath(); } catch { /* no Steam copy: the sentence names none */ }
            bool chosen = cfg != null && !string.IsNullOrEmpty(cfg.VortexGame) && SameFolder(cfg.VortexGame.Trim().Trim('"'), src);
            return "Vortex deploys into " + src + ", which is the game folder of the Thornswood install in " + root +
                   ", and Thornswood never makes or brings its own folder up to date from a Thornswood folder: Vortex links what it deploys into that folder, " +
                   "so the two would share files and each would undo the other's. In Vortex, point Skyrim Special Edition at the Steam copy" +
                   (steam.Length > 0 ? " in " + steam : "") + " again and deploy" +
                   (chosen ? ", press Forget the chosen folder in Settings, under Maintenance," : ",") +
                   " and then press Scan and Fix on Diagnostics.";
        }

        /// <summary>
        /// For the start of the launcher: why the folder cannot follow Vortex
        /// right now when the reason is that Vortex deploys into a Thornswood
        /// folder (ThornswoodSource), so it is said rather than silently never
        /// refreshed. Null otherwise.
        /// </summary>
        public static string RefusedSource(Config cfg)
        {
            try { return ThornswoodSource(cfg, DeploysInto(cfg)); }
            catch (Exception ex) { Swallow.Note("OwnGame.RefusedSource", ex); return null; }
        }

        /// <summary>
        /// The Steam copy the game itself comes from when Vortex deploys into
        /// <paramref name="into"/>: that folder when it is a Steam copy of
        /// Skyrim Special Edition, otherwise the first Steam copy and never the
        /// other folder. "" when the machine has no Steam copy.
        /// </summary>
        static string GameFor(string into)
        {
            if (string.IsNullOrEmpty(into)) return "";
            if (Steam.IsSkyrimCopy(into)) return into;
            try { return Steam.SkyrimPath(); } catch { return ""; }
        }

        /// <summary>
        /// For Scan: the folder Vortex deploys into, when it has Vortex's
        /// record and is not the Skyrim this install reads (Paths.Game). That
        /// is when Fix has somewhere to point the launcher. "" otherwise.
        /// </summary>
        public static string DeploysElsewhere(Config cfg)
        {
            string into = DeploysInto(cfg);
            // Before the folder exists the Skyrim it reads is the Steam copy,
            // also when Paths.Game is Profile\Payload (#1226).
            if (into.Length == 0 || !HasRecord(into) || SameFolder(into, Paths.Collection ? Paths.SteamCopy : Paths.Game)) return "";
            return into;
        }

        /// <summary>
        /// Fix, and the picker in Settings: the launcher takes Vortex's files
        /// from <paramref name="folder"/> from now on, saved as VortexGame.
        /// Only a Skyrim Vortex has deployed into is accepted, which is
        /// SkyrimSE.exe and Vortex's record in Data. "" clears the setting and
        /// the search takes over again. Returns a sentence for the log saying
        /// what it did, or why nothing changed; <paramref name="ok"/> says which.
        /// </summary>
        public static string PointAt(Config cfg, string folder, out bool ok)
        {
            ok = false;
            // Quotes off, for the same reason as in DeploysInto.
            string f = (folder ?? "").Trim().Trim('"').Trim();
            if (f.Length == 0)
            {
                cfg.VortexGame = "";
                cfg.Save(Paths.CfgFile);
                ok = true;
                return "Thornswood no longer has a folder chosen for Vortex, so it looks for the one Vortex deploys into by itself again.";
            }
            try { f = Path.GetFullPath(f).TrimEnd('\\'); }
            catch { return f + " is not a folder Thornswood can read, so nothing changed."; }
            if (!File.Exists(Path.Combine(f, "SkyrimSE.exe")))
                return f + " has no SkyrimSE.exe in it, so it is not a Skyrim folder and nothing changed. Choose the folder that Open Game Folder opens in Vortex.";
            if (!HasRecord(f))
                return "Vortex has not deployed into " + f + ": it has no Data\\vortex.deployment.json, the record Vortex leaves in every folder it deploys to, so nothing changed. Choose the folder that Open Game Folder opens in Vortex.";
            // A Thornswood game folder is never Vortex's folder (#2210).
            string ours = ThornswoodSource(null, f);
            if (ours != null) return ours + " Nothing changed.";
            cfg.VortexGame = f;
            cfg.Save(Paths.CfgFile);
            ok = true;
            string game = GameFor(f);
            if (SameFolder(game, f)) return "Thornswood now takes what Vortex deployed from " + f + ".";
            // No Steam copy: saying the game will come from one was untrue on
            // exactly that machine (verification of hotfix 1.1.93). WhyNot
            // refuses to build there; this says so up front.
            if (game.Length == 0)
                return "Thornswood will take what Vortex deployed into " + f + ", but it takes the game itself only from Steam's own copy of Skyrim Special Edition, " +
                       "and this machine has none, so the folder cannot be made until Skyrim Special Edition is installed in Steam.";
            return "Thornswood now takes what Vortex deployed into " + f + " from Vortex's own mods folder, only the files Vortex's record lists, and the game itself, when its own folder is first made, from " +
                   "the Steam copy in " + game + ". Nothing else in " + f + " is used.";
        }

        // ------------------------------------------------------------ is it time

        /// <summary>
        /// Null when a folder can be made or refreshed from <paramref name="src"/>
        /// right now, otherwise a sentence saying why not.
        /// </summary>
        public static string WhyNot(Config cfg, string src)
        {
            return WhyNot(cfg, src, false);
        }

        /// <summary>
        /// WhyNot, for a Make that is given the game's own files in a folder
        /// of their own (<paramref name="skyrimGiven"/>, #2603): the Steam
        /// copy's build is then not asked about, because none of the game's
        /// own files comes from it. Everything else is asked as it always is.
        /// </summary>
        static string WhyNot(Config cfg, string src, bool skyrimGiven)
        {
            // A folder that is made already holds the game itself, and a
            // refresh takes nothing but Vortex's files (#1218). So the Steam
            // copy's build, and whether there is a Steam copy at all, matter
            // only to Make.
            bool made = Active;
            // Without the pinned build's list nothing can be told apart from a
            // mod put in by hand, so neither Make nor a refresh runs (#1232).
            string noList = NoSkyrimList();
            if (noList != null) return noList;
            if (string.IsNullOrEmpty(src) || !File.Exists(Path.Combine(src, "SkyrimSE.exe")))
                return made
                    ? "Thornswood cannot find the Skyrim folder Vortex deploys into. In Vortex, Mods, Open, Open Game Folder shows which, and Choose Vortex's folder in Settings points Thornswood at it."
                    : "There is no Skyrim to make it from. Steam does not list one.";
            // The game itself comes from a Steam copy whatever Vortex deploys
            // into (Source). When Vortex deploys into the Steam copy the two are
            // one folder and every check below reads exactly as it always did.
            string game = GameFor(src);
            bool apart = !SameFolder(game, src);
            if (!made)
            {
                if (game.Length == 0)
                    return "Vortex deploys into " + src + ", but Thornswood takes the game itself only from Steam's own copy of Skyrim Special Edition, " +
                           "never from another folder, and this machine has none, so install Skyrim Special Edition in Steam and try again.";
                string build = skyrimGiven ? null : FirstBuild(cfg, game);
                if (build != null) return build;
                // Make takes Thornswood's own files from the Steam copy by
                // Thornswood's records, the release's file list among them
                // (#1232). An install an older launcher synced has not kept
                // that list until it is checked against its release again.
                if (!OursKnown())
                    return "Thornswood is checking this install against its release first, which tells it which files in the Steam copy are Thornswood's own. " +
                           "Let the update finish, then make the folder.";
            }
            // This install's own folder or any other Thornswood folder (#2210).
            string thornswood = ThornswoodSource(cfg, src);
            if (thornswood != null) return thornswood;
            if (!HasRecord(src))
                return "Vortex has nothing deployed in " + src + " right now. In Vortex, enable the Thornswood profile and let it deploy, then try again. " +
                       "If it is deployed, Vortex is deploying into another folder: in Vortex, Mods, Open, Open Game Folder shows which, " +
                       "and Choose Vortex's folder in Settings points Thornswood at it.";

            List<string> want = ShippedPlugins();
            if (want.Count == 0)
                return "This install has no reference plugin list yet, so there is no telling whether Vortex has Thornswood's collection on. Let the launcher update first.";
            Record rec = apart || made ? Staged(src) : null;
            HashSet<string> stale = null;
            // Made: a plugin counts where a refresh takes it from, Vortex's
            // files (Vortex), or the game's own that the folder already holds.
            HashSet<string> deployedNow = made ? Deployed(src) : null;
            Dictionary<string, Rec> ownFiles = made ? ReadFiles() : null;
            // Not made: a plugin in the Steam copy counts only when Make will
            // take it, which is one of the three kinds and never a mod put
            // there by hand (#1232).
            HashSet<string> deployedHere = !made && !apart ? Deployed(src) : null;
            HashSet<string> oursNow = null;
            if (!made)
            {
                try { oursNow = Ours(deployedHere); }
                catch (Exception ex)
                {
                    return "Thornswood could not read its own records of which files are its own (" + ex.Message.TrimEnd('.') +
                           "), so it cannot tell them from mods in the Steam copy yet. Close anything that has Thornswood's Profile folder open and try again.";
                }
            }
            int missing = 0, unstaged = 0;
            foreach (string p in want)
            {
                try
                {
                    string from;
                    if (made)
                    {
                        string rel = "Data\\" + p;
                        Rec r;
                        if (ownFiles.TryGetValue(rel, out r) && r.Origin != 'V' && File.Exists(Path.Combine(Folder, rel))) continue;
                        if (FromVortex(src, rel, apart, rec, deployedNow) != null) continue;
                        if (rec.From.TryGetValue(rel, out from)) unstaged++; else missing++;
                        continue;
                    }
                    // Apart, a plugin counts only where Gather will take it
                    // from: Vortex's mods folder by its record, or the Steam
                    // copy's own game. One the record lists whose copy in
                    // Vortex's mods folder is gone is counted apart: the
                    // Thornswood profile is deployed, the deployment is just
                    // out of date (verification of hotfix 1.1.93).
                    if (!apart) { if (!File.Exists(Path.Combine(src, "Data", p)) || KindOf("Data\\" + p, deployedHere, oursNow) == '\0') missing++; }
                    else if (!(rec.From.TryGetValue("Data\\" + p, out from) && File.Exists(from)))
                    {
                        if (stale == null) stale = Deployed(game);
                        if (!File.Exists(Path.Combine(game, "Data", p)) || stale.Contains("Data\\" + p) || KindOf("Data\\" + p, null, oursNow) == '\0')
                        {
                            if (from != null) unstaged++; else missing++;
                        }
                    }
                }
                catch { missing++; }
            }
            if (missing == 0 && unstaged > 0)
                return unstaged + " of Thornswood's " + want.Count + " plugins are in Vortex's record for " + src +
                       " but no longer in Vortex's own mods folder, so that deployment is out of date. In Vortex, press Deploy Mods, then try again.";
            // Not only another profile: Vortex may be deploying Thornswood into
            // a different folder while an old record sits here, which is the
            // one case the search cannot see past. The picker is the way out.
            //
            // A handful missing is a gap in a collection that is deployed, not
            // another profile. 1 October, a clean install of the published
            // collection had 95 of 96 plugins in the Steam folder Vortex
            // deploys into. The one the collection does not ship refused the
            // own folder with the sentence below, and Diagnostics greyed Fix
            // for the same reason, so neither could be used. Half the
            // reference list gone is another profile. See NotThisCollection.
            int gap = missing + unstaged;
            if (gap > 0 && NotThisCollection(gap, want.Count))
                return gap + " of Thornswood's " + want.Count + " plugins are not in " + src +
                       ", so Vortex has another profile deployed, or deploys Thornswood into another folder. In Vortex, enable the Thornswood profile and let it deploy. " +
                       "If it is deployed, Mods, Open, Open Game Folder in Vortex shows where, and Choose Vortex's folder in Settings points Thornswood at it.";

            // Two drives, which is where this used to stop. Both of these said
            // "Thornswood has to be installed on the same drive as Skyrim for
            // this" and ended there: a rule, with nothing to press and nothing
            // to do. Since Play began refusing a shared Skyrim
            // (Shell.OwnGameRequired) that sentence was the whole game for
            // anybody who keeps Steam on a second drive, and plenty of people
            // do. It is still a refusal, because a hard link cannot cross a
            // volume, but OneDriveOnly names both ways out and the paths.
            // Made, the links a refresh makes are to Vortex's files, so it is
            // the folder Vortex deploys into that has to share the drive.
            string linked = made ? src : game;
            if (!SameVolume(linked, Paths.Root))
                return OneDriveOnly("Skyrim is in " + linked, Volume(linked),
                    "move Skyrim to " + Volume(Paths.Root) + ", in Steam, Settings, Storage: choose " + Volume(linked) +
                    " at the top, tick Skyrim Special Edition, press Move and pick " + Volume(Paths.Root));
            if (apart || made)
            {
                foreach (string dir in rec.Staging)
                    if (!SameVolume(dir, Paths.Root))
                        return OneDriveOnly("Vortex keeps its mods in " + dir, Volume(dir),
                            "move Vortex's mods to " + Volume(Paths.Root) + ", in Vortex, Settings, Mods: set the mod staging folder to one on " +
                            Volume(Paths.Root) + " and let Vortex move what is there");
            }
            return null;
        }

        /// <summary>
        /// Null when the first build of the folder has a 1.6.1170 game to take:
        /// the Steam copy is on that build, or the Downgrade has downloaded that
        /// build's own files (Downgrade.Downloaded). Otherwise what happens
        /// next, in one sentence.
        ///
        /// Until #1218 this refused every refresh as well, with "most likely
        /// because Steam updated it. Press Downgrade on the Play page first",
        /// and the Downgrade then copied 1.6.1170 over the Steam copy. The
        /// Steam copy is the person's to keep on any build, so it is never
        /// written, and it is only asked about here, before the folder exists.
        /// </summary>
        static string FirstBuild(Config cfg, string game)
        {
            if (!FirstBuildWrong(cfg, game)) return null;
            if (Downgrade.Downloaded(cfg) != null) return null;
            long exeBytes = -1;
            try { exeBytes = new FileInfo(Path.Combine(game, "SkyrimSE.exe")).Length; } catch { /* unreadable: -1, and Describe says the build */ }
            // The exe is 1.6.1170's size and some other listed file is not:
            // a cleaned master, an edited Skyrim.ccc. Describe would call the
            // whole folder 1.6.1170, which is the thing that is wrong.
            if (exeBytes == cfg.ExpectedExeBytes)
                return "Skyrim in " + game + " has 1.6.1170's exe, but one of its own files is not that build's (a cleaned master, or a file edited in that folder). Thornswood never changes that copy, and it can stay as it is: " +
                       "press Downgrade on the Play page and Steam downloads 1.6.1170's own files under your account, and Thornswood makes its own folder from them. " +
                       "Your Steam copy stays as it is.";
            return "Skyrim in " + game + " is " + Downgrade.Describe(cfg, Path.Combine(game, "SkyrimSE.exe")) + ". Thornswood never changes that copy, and it can stay on any build: " +
                   "press Downgrade on the Play page and Steam downloads 1.6.1170's own files under your account, and Thornswood makes its own folder from them. " +
                   "Your Steam copy stays on the build it is on.";
        }

        /// <summary>
        /// The Steam copy is there and readable, and it is not the pinned
        /// build: the exe is not 1.6.1170's size, or a listed file is missing
        /// or not that build's (its size, and its SHA-1 for a master or a
        /// loose file). An unreadable exe skips the check, as it always did.
        /// </summary>
        static bool FirstBuildWrong(Config cfg, string game)
        {
            if (string.IsNullOrEmpty(game)) return false;
            long exeBytes = -1;
            try { exeBytes = new FileInfo(Path.Combine(game, "SkyrimSE.exe")).Length; } catch { /* unreadable: -1, and the build check is skipped as it always was */ }
            if (exeBytes < 0) return false;
            if (exeBytes != cfg.ExpectedExeBytes) return true;
            return !ListedFilesArePinned(game);
        }

        /// <summary>
        /// The Steam copy's listed files are not all the pinned build's, so
        /// the Downgrade card is the way to 1.6.1170's own files. Same answer
        /// as FirstBuildWrong, on Paths.SteamCopy.
        /// </summary>
        public static bool SteamCopyNotPinned(Config cfg)
        {
            return FirstBuildWrong(cfg, Paths.SteamCopy);
        }

        /// <summary>
        /// Where a refresh takes one of Vortex's files from, or null when it
        /// cannot: Vortex's own copy in its mods folder, by the record; when
        /// Vortex deploys into the Steam copy, the file it deployed there,
        /// which is the same file, as the walk of that folder always took it.
        /// Never a file Vortex's record does not list.
        /// </summary>
        static string FromVortex(string src, string rel, bool apart, Record rec, HashSet<string> deployed)
        {
            string staged;
            if (!apart && deployed.Contains(rel) && Tidy(rel))
            {
                string at = Path.Combine(src, rel);
                if (File.Exists(at)) return at;
            }
            if (rec.From.TryGetValue(rel, out staged) && File.Exists(staged)) return staged;
            return null;
        }


        /// <summary>
        /// True when so many of the shipped plugins are missing that this is
        /// not Thornswood's collection. Less than half missing is a gap in a
        /// collection that is on. On a list of twenty or more, fewer than ten
        /// missing is that same gap: Diagnostics uses ten and half together
        /// before it says the collection is not deployed.
        /// </summary>
        public static bool NotThisCollection(int missing, int expected)
        {
            if (expected <= 0 || missing <= 0) return false;
            if (missing * 2 < expected) return false;
            if (expected >= 20 && missing < 10) return false;
            return true;
        }

        /// <summary>True when Vortex has deployed since the folder was last made or refreshed.</summary>
        /// <summary>
        /// Which build of the rules in this file a folder was made under.
        ///
        /// Bump this whenever Foreign, MustCopy or anything else that decides
        /// what goes in the folder changes. Every folder made under an older
        /// number then refreshes itself the next time the launcher opens.
        ///
        /// 1: NirnLabUIPlatform is another server's and is left out. Before
        ///    this the folder was given it, SkyrimPlatform would not start on
        ///    the browser we ship while it was there, and CEFSubprocess.exe
        ///    came with it for Windows Firewall to ask about.
        /// 2: Creation Club plugins the reference list does not name are left
        ///    out, and taken out of a folder that already has them. See
        ///    UnwantedCreation.
        /// 3: the old multiplayer mod's client folder under Data was left
        ///    out. That rule went on 28 September (issue #497): nothing here
        ///    names that mod any more.
        /// 4: the retired dresser, thornswood-chargen.js, is left out, so a
        ///    refresh cannot copy the Steam copy's old one back in after a
        ///    pack deletes it. See Foreign.
        /// 5: what Nemesis or FNIS writes (behavior files, the two character
        ///    defaults, FNIS.pex) is copied, never linked, and a folder that
        ///    already has them as links gets its own copy of each, as they are
        ///    now. Folders parked at the game's root or in Data (a name that
        ///    starts with an underscore, such as _Parked or _disabledBy and a server's name) are
        ///    left out, and taken out of a folder that already has them. See
        ///    Generated and Parked. The copies are made once, by the refresh of
        ///    a folder whose record is older than 5 (#2210).
        /// 6: Vortex's Data\Platform\Distribution redistributables (the 68 CEF
        ///    and Node files the collection carries, not the two recorded in
        ///    records\client-build.json) are hard linked, even though they are
        ///    .dll/.exe. A folder that still holds its own copy of each gets
        ///    the link instead, giving the disk the second copy back. See
        ///    MustCopy. Done once, by the refresh of a folder whose record is
        ///    older than 6 (#2210).
        /// 7: Start On Save is left out, and taken out of a folder that
        ///    already has it, its settings file included. See Retired.
        /// 8: SkyUI 5.2's ten loose scripts (ski_main.pex and the rest) that the
        ///    collection installer left in the Steam copy are left out, so a
        ///    refresh cannot link them back after a pack deletes them. See
        ///    Foreign, issue #960.
        /// 9: body shape sliders and jiggle (CBPC's cbp.dll and the three
        ///    RaceMenu body slider scripts) are left out, and taken out of a
        ///    folder that already has them. See BodyShape, issue #993.
        /// 10: Bethesda's Creation Kit and copies of the game's own programs
        ///    are left out, and taken out of a folder that already has them.
        ///    See BethesdaTool, issue #1152.
        /// 11: the folder no longer follows the Steam copy (#1218). A refresh
        ///    takes only Vortex's files; the game's own files the folder still
        ///    shares with the Steam copy become copies of its own, except
        ///    Skyrim's archives, which stay shared only while their bytes are
        ///    the ones on record and are shared where they were not (#1217).
        ///    See Refresh and OwnGameShare.cs. The copies are made once, by the
        ///    refresh of a folder whose record is older than 11 (#2210).
        ///
        /// Until 12 Oct the separations of 5, 6 and 11 ran at every refresh: each
        /// file the refresh did not change was asked how many names it has, and
        /// a copy with a second name was made the folder's own again. That
        /// undid the damage instead of stopping its cause, and the cause was two
        /// setups on the machine that ships: Vortex deploying into a Thornswood
        /// folder, and a release folder made by hard linking an install's
        /// folder. Patrick decided on 12 Oct (#2210) to refuse the first
        /// (ThornswoodSource) and to make every release folder with its own
        /// launcher's Make, and to make these one-time moves, as their numbers
        /// always said they were.
        /// 12: the Creation Kit's script sources (Data\Source and
        ///    Data\Scripts\Source) are left out, and taken out of a folder that
        ///    already has them. See BethesdaTool, issue #1227.
        /// 13: only three kinds of file (#1232): Skyrim's own by the pinned
        ///    build's list, Vortex's by its record, Thornswood's by its records.
        ///    What Make took from the Steam copy that is none of them, mods put
        ///    there by hand, is taken out of the folder and logged, and each file
        ///    is recorded as which kind it is (O, V or T). See OwnGameKinds.cs.
        /// 14: Elysium Estate's old plugin, ElysiumEstateSSE.esp, is left out,
        ///    so a refresh cannot copy it back after a pack deletes it. See
        ///    Foreign, issue #690.
        /// 15: another server's menu files under Data\Platform\UI (the 37
        ///    Daedric Online files and the unused fork svgs plus bg.png) are
        ///    left out, so a refresh cannot copy them back after a pack
        ///    deletes them. Only index.html, build.js, thornswood-* files and
        ///    hashed assets Ship wrote into the pack count as ours. See
        ///    Foreign, issue #1318.
        /// 16: an install that does not yet have the hashed UI asset list
        ///    keeps those hashed front assets (chat fonts) on a refresh
        ///    rather than dropping them. The Daedric set and unused fork
        ///    assets in records\ui-gone.json stay out either way. Once a
        ///    list exists, only names on it are ours. See Foreign, issue
        ///    #1318.
        /// 17: five files under Data\Platform nothing uses (Images\lock.png,
        ///    Images\speaking.png and the ChainLink, NoticeIcon and VoiceIcon
        ///    sprite fonts) are left out, so a refresh cannot copy them back
        ///    after a pack deletes them. See Foreign, issue #2177.
        /// 18: the two commercial sprite fonts (Fonts\DIN-Pro-bold and
        ///    Fonts\Futura) are left out, so a refresh cannot copy them back
        ///    after a pack deletes them, and so are the four Futura PT and
        ///    DIN Pro faces under UI that records\ui-gone.json now lists.
        ///    See Foreign, issue #1317.
        ///
        /// Every number from 14 on also gets a line in RuleTouches below.
        /// </summary>
        const int Rules = 18;

        /// <summary>
        /// What each rule from 14 on can decide differently, as the start of
        /// every path it is about (#2210). A folder Vortex has not deployed
        /// into since it was last brought up to date, and which is behind only
        /// on these rules, looks again at the files under these paths and
        /// carries every other line of its record forward as it is: the
        /// launcher update that brought the new rule does not cost a walk of
        /// all thirty thousand files.
        ///
        /// When Rules goes up, add its number here. A rule that can decide
        /// anything anywhere gets null, and so does a missing number: either
        /// one walks the whole folder, which is always right, only slower.
        /// 13 and older are not here, so a folder from before the three kinds
        /// (#1232) is walked whole.
        /// </summary>
        static readonly Dictionary<int, string[]> RuleTouches = new Dictionary<int, string[]>
        {
            { 14, new string[] { "Data\\ElysiumEstateSSE.esp" } },
            { 15, new string[] { "Data\\Platform\\UI\\" } },
            { 16, new string[] { "Data\\Platform\\UI\\" } },
            { 17, new string[] { "Data\\Platform\\Images\\", "Data\\Platform\\Fonts\\" } },
            { 18, new string[] { "Data\\Platform\\Fonts\\", "Data\\Platform\\UI\\" } },
        };

        /// <summary>
        /// The paths a refresh has to look at when the folder's record is on
        /// <paramref name="recorded"/> and only the rules moved since, or null
        /// when it has to look at everything.
        /// </summary>
        static string[] RulesScope(long recorded)
        {
            if (recorded < 0 || recorded >= Rules) return null;
            var paths = new List<string>();
            for (long n = recorded + 1; n <= Rules; n++)
            {
                string[] touches;
                if (!RuleTouches.TryGetValue((int)n, out touches) || touches == null) return null;
                foreach (string p in touches)
                    if (!paths.Contains(p)) paths.Add(p);
            }
            return paths.Count == 0 ? null : paths.ToArray();
        }

        /// <summary>
        /// What a refresh looks at when it does not have to walk everything
        /// (#2210): the paths the new rules are about (RuleTouches), and the
        /// files whose entry in Vortex's record moved since the folder was last
        /// made or brought up to date (VortexMoved). Everything else keeps its
        /// line of the record and is not opened.
        /// </summary>
        class Scope
        {
            /// <summary>Starts of paths, from RuleTouches; null when the rules did not move.</summary>
            public string[] Rules;
            /// <summary>Whole paths, from VortexMoved; null when Vortex has not deployed since.</summary>
            public HashSet<string> Vortex;
        }

        /// <summary>True when <paramref name="rel"/> is one a refresh looks at: all of them when there is no scope.</summary>
        static bool InScope(string rel, Scope scope)
        {
            if (scope == null) return true;
            if (scope.Vortex != null && scope.Vortex.Contains(rel)) return true;
            if (scope.Rules != null)
                foreach (string p in scope.Rules)
                    if (rel.StartsWith(p, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// Vortex's record as the folder last took it in: each file's mod and
        /// time, one line a file, under a first line naming the folder Vortex
        /// deployed into (#2210). Written by Make and Refresh once files.txt
        /// is, so it always speaks for the record beside it.
        /// </summary>
        static string VortexSeenFile { get { return Path.Combine(Dir, "vortex.txt"); } }

        /// <summary>
        /// Writes vortex.txt for the record a make or refresh has just taken
        /// in. A file it could not bring over (<paramref name="failed"/>) is
        /// left out, so the next refresh looks at it again. A file outside
        /// what a scoped refresh looked at keeps the line it had in
        /// <paramref name="was"/>, or none: the refresh did not take it in, so
        /// it must not be written down as taken in. A file the last full walk
        /// could not bring over is then still looked at again by the next
        /// refresh after a Vortex deploy, even when a rules-only refresh came
        /// in between.
        /// </summary>
        static void WriteVortexSeen(string src, Record rec, HashSet<string> failed, Scope scope, Dictionary<string, string> was)
        {
            // A scoped refresh of a folder with no vortex.txt yet (one made by
            // a launcher before this) took in too little to write one: the
            // next refresh after a Vortex deploy walks everything and writes
            // it whole.
            if (scope != null && was == null) return;
            var lines = new List<string>();
            lines.Add("source=" + src);
            foreach (KeyValuePair<string, string> kv in rec.Entry)
            {
                if (failed != null && failed.Contains(kv.Key)) continue;
                if (scope != null && !InScope(kv.Key, scope))
                {
                    string then;
                    if (was != null && was.TryGetValue(kv.Key, out then)) lines.Add(then + "|" + kv.Key);
                    continue;
                }
                lines.Add(kv.Value + "|" + kv.Key);
            }
            WriteRecord(VortexSeenFile, lines);
        }

        /// <summary>
        /// The entries vortex.txt kept for <paramref name="src"/>, or null when
        /// there is none, it cannot be read, or it was written for another
        /// folder: then nothing is known about what moved, and the refresh
        /// walks everything.
        /// </summary>
        static Dictionary<string, string> ReadVortexSeen(string src)
        {
            try
            {
                if (!File.Exists(VortexSeenFile)) return null;
                string[] lines = File.ReadAllLines(VortexSeenFile);
                if (lines.Length == 0 || !lines[0].StartsWith("source=", StringComparison.Ordinal) ||
                    !SameFolder(lines[0].Substring("source=".Length), src)) return null;
                var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                for (int i = 1; i < lines.Length; i++)
                {
                    string[] p = lines[i].Split(new char[] { '|' }, 3);
                    if (p.Length == 3 && p[2].Length > 0) d[p[2]] = p[0] + "|" + p[1];
                }
                return d;
            }
            catch (Exception ex)
            {
                Swallow.Note("OwnGame.ReadVortexSeen", ex);
                return null;
            }
        }

        /// <summary>
        /// The files whose entry in Vortex's record is not the one the folder
        /// last took in: another mod or another time, new to the record, or
        /// gone from it (#2210, decided by Patrick on 12 Oct). Vortex writes
        /// each file's mod and its time into the record, so this is read from
        /// the record alone and opens none of the files. A file the record
        /// lists without an entry the launcher could read is always counted.
        /// Null when there is nothing to compare with, which walks everything.
        /// </summary>
        static HashSet<string> VortexMoved(Dictionary<string, string> was, Record rec, HashSet<string> deployed)
        {
            if (was == null) return null;
            var moved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string rel in deployed)
            {
                string now, then;
                if (!rec.Entry.TryGetValue(rel, out now) || !was.TryGetValue(rel, out then) || now != then) moved.Add(rel);
            }
            foreach (string rel in was.Keys)
                if (!deployed.Contains(rel)) moved.Add(rel);
            return moved;
        }

        /// <summary>The path a line of left-out.txt is about: what comes before "  (".</summary>
        static string LeftRel(string line)
        {
            int at = line.IndexOf("  (", StringComparison.Ordinal);
            return at < 0 ? line.Trim() : line.Substring(0, at);
        }

        public static bool NeedsRefresh(Config cfg)
        {
            if (!Active) return false;
            string src = DeploysInto(cfg);
            if (WhyNot(cfg, src) != null) return false;

            // The rules changed under a folder that was already made.
            //
            // This used to ask one question: has Vortex deployed since. That
            // misses the case where Vortex has not moved at all and it is this
            // launcher that now wants something different from the same
            // deployment. A folder built before a rule existed keeps whatever
            // that rule was added to take out, for as long as Vortex sits
            // still, which on a settled collection is forever. The person has
            // no way to know: nothing on screen says their folder is built to
            // rules nobody uses any more.
            //
            // A folder with no number in its record was made before any of
            // this and reads as -1, so it refreshes once and then matches.
            if (Recorded("rules") != Rules) return true;

            // Files from the Steam copy not sorted into the three kinds yet,
            // and the records to sort them by are here now (#1232).
            if (KindsDue()) return true;

            return DeploymentStamp(src) != Recorded("deployment");
        }

        // ------------------------------------------------------------ making it

        class Found
        {
            public string Rel;
            // Where it is brought from: the file itself in a walked folder, or
            // Vortex's staging copy of it (Gather).
            public string From;
            public long Size, Ticks;
            // One of 1.6.1170's own files from the Downgrade's download, which
            // is removed once the folder is made, or from another folder that
            // holds them (#2603), whose files stay its own: always copied.
            public bool Pinned;
            // Thornswood's own, from Profile\Payload (#1226): linked in and
            // then the Payload name removed, so it ends as the folder's own.
            public bool Ours;
        }

        class Rec
        {
            public char Kind, Origin;
            public long Size, Ticks;
        }

        /// <summary>
        /// Makes Root\Game. Runs on a pool thread; <paramref name="say"/> is
        /// called from it. Returns a line for the log, or throws with a sentence
        /// worth showing.
        /// </summary>
        public static string Make(Config cfg, Action<string> say)
        {
            return Make(cfg, say, null);
        }

        /// <summary>
        /// Make, with the game's own files taken from <paramref name="skyrimFrom"/>
        /// instead of the Steam copy or the Downgrade's download, when it is
        /// given (#2603): a folder that already holds 1.6.1170's own files,
        /// each checked against the list before anything is placed and then
        /// copied (SkyrimFrom). Only the ship root tool passes one; the
        /// launcher's own Make is the one above.
        /// </summary>
        public static string Make(Config cfg, Action<string> say, string skyrimFrom)
        {
            string from = null;
            if (!string.IsNullOrEmpty(skyrimFrom))
            {
                try { from = Path.GetFullPath(skyrimFrom.Trim().Trim('"')).TrimEnd('\\'); }
                catch { throw new Exception(skyrimFrom + " is not a folder Thornswood can read, so the game's own files were not taken from it, and nothing was made."); }
            }
            lock (folderWork) return MakeNow(cfg, say, from);
        }

        static string MakeNow(Config cfg, Action<string> say, string skyrimFrom)
        {
            string src = DeploysInto(cfg);
            string why = WhyNot(cfg, src, skyrimFrom != null);
            if (why != null) throw new Exception(why);
            if (Directory.Exists(Folder))
                throw new Exception("There is already a Game folder at " + Folder + ", so nothing was made.");

            // A half made one from an attempt that stopped part way. Only ever
            // this launcher's, and only ever links and copies.
            string temp = Folder + ".new";
            if (Directory.Exists(temp)) Directory.Delete(temp, true);
            Directory.CreateDirectory(Dir);
            // What Build-Generated made in a folder of this name before
            // (#1247) went with it, so the record goes before Ours reads it.
            ForgetGenerated();

            HashSet<string> deployed = Deployed(src);
            uiHashedWalkRoot = src;
            ResetUiHashedOurs();
            // Thornswood's own files by its records (#1232): the installer's
            // list, the packs' and Keep's, while they still say so.
            HashSet<string> ours = Ours(deployed);
            wantedPlugins = new HashSet<string>(ShippedPlugins(), StringComparer.OrdinalIgnoreCase);
            var left = new List<string>();
            // The Steam copy is not the pinned build: the game comes from the
            // files the Downgrade downloaded (FirstBuild let it through only then).
            // Or from a folder that holds them already, checked file by file
            // before anything is placed (#2603); a refusal throws here, and
            // nothing has been linked or copied.
            string game = GameFor(src);
            Dictionary<string, Stamp> checkedAt = null;
            List<Found> pinned = skyrimFrom != null
                ? SkyrimFrom(skyrimFrom, deployed, say, out checkedAt)
                : FirstBuildWrong(cfg, game) ? Downloads(Downgrade.Downloaded(cfg)) : null;
            int byHand = 0;
            List<Found> all = WithPayload(Gather(src, left, pinned, ours, ref byHand));

            long copyBytes = 0, totalBytes = 0;
            foreach (Found f in all)
            {
                if (SkipOf(f) != null) continue;
                totalBytes += f.Size;
                if (CopyOf(f, deployed)) copyBytes += f.Size;
            }
            long free = FreeSpace(Paths.Root);
            if (free >= 0 && free < copyBytes + 512L * 1024 * 1024)
                throw new Exception("There is not enough room on " + Volume(Paths.Root) + ". The copied part needs " +
                                    Mb(copyBytes) + " and " + Mb(free) + " is free.");

            var lines = new List<string>();
            // What could not be brought over stays out of vortex.txt, so the
            // first refresh looks at it again (#2210).
            var failed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int linked = 0, copied = 0, fellBack = 0, fromPayload = 0;
            long done = 0; int shown = 0, looked = 0;
            foreach (Found f in all)
            {
                PlayProgress.Files(Phase, looked++, all.Count);
                string skip = SkipOf(f);
                if (skip != null) { left.Add(f.Rel + "  (" + skip + ")"); continue; }

                bool copy = CopyOf(f, deployed);
                bool asLink;
                try
                {
                    Place(f.From, Path.Combine(temp, f.Rel), copy, out asLink);
                }
                catch (Exception ex)
                {
                    left.Add(f.Rel + "  (could not be brought over: " + ex.Message + ")");
                    failed.Add(f.Rel);
                    continue;
                }
                // Thornswood's own from Payload is linked in and its Payload
                // name removed once the folder is in place, so on record it
                // is what it then is: a copy of the folder's own.
                if (f.Ours) fromPayload++;
                else if (asLink) linked++; else { copied++; if (!copy) fellBack++; }
                // Which kind it is (OwnGameKinds.cs): Vortex's, Skyrim's own,
                // or Thornswood's. Gather let nothing else through.
                char kind = deployed.Contains(f.Rel) ? 'V' : f.Ours ? 'T' : f.Pinned ? 'O' : KindOf(f.Rel, deployed, ours);
                lines.Add((asLink && !f.Ours ? "L" : "C") + "|" + kind + "|" + f.Size + "|" + f.Ticks + "|" + f.Rel);

                done += f.Size;
                int pct = totalBytes > 0 ? (int)(done * 100 / totalBytes) : 100;
                if (say != null && pct >= shown + 10) { shown = pct - pct % 10; say("Making Thornswood's own Skyrim folder: " + shown + "%"); }
            }
            PlayProgress.Files(Phase, all.Count, all.Count);
            // What was copied from skyrimFrom is the bytes that were checked
            // only if nothing wrote to those files meanwhile (#2603). Before
            // any record is written, so a refusal leaves no folder and no
            // record of one; the next Make removes Game.new.
            if (checkedAt != null)
            {
                string moved = SkyrimFromMoved(skyrimFrom, checkedAt);
                if (moved != null) throw new Exception(moved);
            }

            WriteRecord(FilesList, lines);
            WriteRecord(LeftOutFile, left);
            // A share record left by a folder of the same name that is gone
            // speaks for files that are not there any more.
            ForgetShares();
            // And a note that the Steam copy was cleaned speaks for an install
            // before this one: a reinstall without the own folder put
            // Thornswood's files back into the Steam copy (#1226).
            ForgetCleaned();
            Directory.Move(temp, Folder);
            // Vortex's record as the folder took it in, so the first refresh
            // after a Vortex deploy opens only what moved (VortexMoved).
            WriteVortexSeen(src, Staged(src), failed, null, null);
            WriteMade(src, SumCopied(lines), 1, skyrimFrom);
            SettleSettings(true);
            string payloadLeft = DropPayload();

            string said = "Thornswood's own Skyrim folder is ready at " + Folder + ": " +
                          linked.ToString("n0") + " files linked, " + copied.ToString("n0") + " copied (" + Mb(copyBytes) + ")";
            if (fellBack > 0) said += ", " + fellBack.ToString("n0") + " of them copied because a link could not be made";
            said += ". " + left.Count.ToString("n0") + " left out, other servers' files among them; the list is in " + LeftOutFile + ".";
            if (byHand > 0)
                said += " " + byHand.ToString("n0") + " of them " + (byHand == 1 ? "is" : "are") + " in the Steam copy and not Skyrim's own, Vortex's or Thornswood's, " +
                        "such as mods put there by hand, so " + (byHand == 1 ? "it stays" : "they stay") + " with the Steam copy and out of Thornswood.";
            if (fromPayload > 0)
                said += " " + fromPayload.ToString("n0") + " of Thornswood's own files came from " + Paths.Payload +
                        ", where the installer and the launcher kept them so that nothing was written into the Steam copy.";
            if (payloadLeft != null) said += " " + payloadLeft;
            if (skyrimFrom != null)
                said += " The game itself is 1.6.1170's own files, copied from " + skyrimFrom + " after each was checked against that build's list; the Steam copy in " + game + " was not changed.";
            else if (pinned != null)
            {
                said += " The game itself is 1.6.1170's own files, downloaded from Steam; the Steam copy in " + game + " was not changed.";
                Downgrade.ClearDownloads(cfg, say);
            }
            // Skyrim's archives: shared with the Steam copy where the bytes
            // are the same, and put on record either way (OwnGameShare.cs).
            string shared = Share(game, say);
            if (shared != null) said += " " + shared;
            return said;
        }

        /// <summary>
        /// Brings Root\Game up to date with what Vortex has deployed now. New and
        /// changed files come in, files the collection no longer has go, and
        /// anything a Thornswood update wrote into the folder stays as that
        /// update left it. Returns a line for the log, or throws.
        /// </summary>
        public static string Refresh(Config cfg, Action<string> say)
        {
            if (!Active) throw new Exception("This install is not running from a folder of its own.");
            lock (folderWork) return RefreshNow(cfg, say);
        }

        static string RefreshNow(Config cfg, Action<string> say)
        {
            string src = DeploysInto(cfg);

            // Same deployment stamp and same rules as the last refresh: nothing
            // to bring in. Skip WhyNot, Gather, the per-file Links walk, and
            // SettleSettings. SettleSettings used to copy Golden plugins.txt
            // over Paths.Live on every refresh, which put Thornswood-Content.esp
            // (and the rest) back out of the server's order and left Mod list
            // red after "already matches". ShellOwnGame applies PutInServerOrder
            // after this returns; when nothing changed that write is a no-op.
            if (!string.IsNullOrEmpty(src)
                && Recorded("rules") == Rules
                && !KindsDue()
                && DeploymentStamp(src) == Recorded("deployment")
                && Recorded("deployment") != 0)
            {
                // The files are Vortex's, but its plugin list can change with
                // nothing deployed: enabling a plugin, or a reinstall that
                // Vortex re-enables. On 17 Oct a release folder kept a list
                // from a minute when Thornswood-Content.esp was missing, the
                // Ship built from it refused, and every later refresh came
                // through here and never copied the list again. So the list
                // is copied on this path too. It is two small files, and
                // copying them writes nothing but Profile\OwnGame.
                BakeVortexList();
                return "Thornswood's own Skyrim folder already matches what Vortex has deployed.";
            }

            string why = WhyNot(cfg, src);
            if (why != null) throw new Exception(why);
            var clock = System.Diagnostics.Stopwatch.StartNew();

            // Look only at what can have changed (#2210), and carry the rest of
            // the record forward: the paths the new rules are about when the
            // rules moved (RuleTouches), and the files whose entry in Vortex's
            // record moved when Vortex has deployed since (VortexMoved). Null
            // walks everything: files still to sort into the three kinds, a
            // folder with no deployment on record, a rule with no line, or no
            // earlier record of Vortex's for this folder to compare with.
            long rulesWere = Recorded("rules");
            Dictionary<string, string> seenBefore = ReadVortexSeen(src);
            Scope scope = null;
            if (!KindsDue() && Recorded("deployment") != 0)
            {
                scope = new Scope();
                if (rulesWere != Rules)
                {
                    scope.Rules = RulesScope(rulesWere);
                    if (scope.Rules == null) scope = null;
                }
                if (scope != null && DeploymentStamp(src) != Recorded("deployment"))
                {
                    scope.Vortex = VortexMoved(seenBefore, Staged(src), Deployed(src));
                    if (scope.Vortex == null) scope = null;
                }
            }
            // What the last refresh left out outside those paths stays on the
            // list, since nothing there is looked at again. Read before
            // anything changes, so a list that cannot be read stops the
            // refresh with the folder as it was.
            var leftBefore = new List<string>();
            if (scope != null && File.Exists(LeftOutFile))
            {
                string[] before;
                try { before = File.ReadAllLines(LeftOutFile); }
                catch (Exception ex)
                {
                    throw new Exception("The list of what was left out of Thornswood's folder last time, " + LeftOutFile +
                                        ", could not be read (" + ex.Message.TrimEnd('.') + "), so nothing was changed.");
                }
                foreach (string line in before)
                    if (line.Trim().Length > 0 && !InScope(LeftRel(line), scope)) leftBefore.Add(line);
            }

            Dictionary<string, Rec> old = ReadFiles();
            HashSet<string> deployed = Deployed(src);
            uiHashedWalkRoot = src;
            ResetUiHashedOurs();
            HashSet<string> owned = Owned(deployed);
            HashSet<string> ours = Ours(deployed);
            // Until every record of Thornswood's own files is here, nothing is
            // taken out for being on none of them (OursKnown).
            bool sortNow = OursKnown();
            var byHand = new List<string>();
            var stuck = new List<string>();
            int unsorted = 0;
            wantedPlugins = new HashSet<string>(ShippedPlugins(), StringComparer.OrdinalIgnoreCase);
            var left = new List<string>();
            // Vortex's files and nothing else (#1218). The game itself is the
            // folder's own since it was made; it is carried forward below.
            // What could not be brought in is not written into vortex.txt, so
            // the next refresh looks at it again.
            var failed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            List<Found> all = Vortex(src, left, scope, failed);
            // The one-time moves of rules 5, 6 and 11 (#2210): only a folder
            // whose record is older than the rule has them made.
            bool rule5 = rulesWere < 5, rule6 = rulesWere < 6, rule11 = rulesWere < 11;

            var lines = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int added = 0, changed = 0, removed = 0, kept = 0, separated = 0, relinked = 0, separatedGame = 0;
            long copyBytes = 0;
            int looked = 0;

            foreach (Found f in all)
            {
                PlayProgress.Files(Phase, looked++, all.Count);
                string skip = Skip(f.Rel);
                if (skip != null) { left.Add(f.Rel + "  (" + skip + ")"); continue; }
                seen.Add(f.Rel);

                string dest = Path.Combine(Folder, f.Rel);
                char origin = deployed.Contains(f.Rel) ? 'V' : 'O';
                bool exists = File.Exists(dest);
                Rec r;
                bool had = old.TryGetValue(f.Rel, out r);

                if (exists && (owned.Contains(f.Rel) || (had && r.Size == f.Size && r.Ticks == f.Ticks)))
                {
                    // Unchanged in Vortex, or Thornswood's own update wrote it.
                    // Recorded against what the source holds now either way.
                    // L or C is what the record says, and what the disk holds
                    // when the file is asked (#1255): a file this refresh does
                    // not open keeps the L or C it had (#2210), which only the
                    // installed size Windows shows reads.
                    char kind = had ? r.Kind : 'C';
                    // Rules 5: a generated file this folder still shares with
                    // another folder gets a copy of its own, as it is now.
                    // Rules 6: a Distribution redistributable this folder still
                    // holds as its own copy becomes a hard link to Vortex's.
                    // Only Distribution: a broader !MustCopy re-link also
                    // undid Fix's light-flag Separates on plugins such as
                    // CBBE.esp (copy, ESL set, then Bring it up to date from
                    // Vortex replaced it with Vortex's unflagged staging).
                    //
                    // Both are one-time moves, made only in a folder whose
                    // record is older than the rule (#2210). Until 12 Oct they
                    // ran at every refresh and asked every unchanged file how
                    // many names it has, which undid what a Thornswood folder
                    // Vortex deployed into, or one hard linked from another,
                    // kept doing, instead of those setups being refused.
                    bool must = MustCopy(f.Rel, deployed);
                    bool relink = rule6 && !must && origin == 'V'
                                  && f.Rel.StartsWith("Data\\Platform\\Distribution\\", StringComparison.OrdinalIgnoreCase);
                    if (!had || (rule5 && must) || relink)
                    {
                        try
                        {
                            int names = Links(dest);
                            if (rule5 && must && names > 1)
                            {
                                Separate(dest);
                                names = Links(dest);
                                if (names <= 1) separated++;
                            }
                            else if (relink && names <= 1)
                            {
                                bool nowLink;
                                DropName(dest);
                                Place(f.From, dest, false, out nowLink);
                                if (nowLink) relinked++;
                                names = Links(dest);
                            }
                            kind = names > 1 ? 'L' : 'C';
                        }
                        catch { /* unreadable right now: left as it was */ }
                    }
                    lines.Add(kind + "|" + origin + "|" + f.Size + "|" + f.Ticks + "|" + f.Rel);
                    kept++;
                    continue;
                }

                bool copy = MustCopy(f.Rel, deployed);
                bool asLink;
                try
                {
                    // Deleting the name here removes this folder's link and
                    // nothing else. The file Vortex has stays where it is.
                    if (exists) DropName(dest);
                    Place(f.From, dest, copy, out asLink);
                }
                catch (Exception ex)
                {
                    left.Add(f.Rel + "  (could not be brought over: " + ex.Message + ")");
                    failed.Add(f.Rel);
                    if (exists && had) lines.Add(r.Kind + "|" + r.Origin + "|" + r.Size + "|" + r.Ticks + "|" + f.Rel);
                    continue;
                }
                if (!asLink) copyBytes += f.Size;
                lines.Add((asLink ? "L" : "C") + "|" + origin + "|" + f.Size + "|" + f.Ticks + "|" + f.Rel);
                if (exists) changed++; else added++;
            }

            PlayProgress.Files(Phase, all.Count, all.Count);

            // The collection dropped these. Only Vortex's files are taken out;
            // anything else in the folder is not this refresh's to judge.
            //
            // Except a Creation Club plugin this folder brought in itself before
            // rules 2. Those were never Vortex's, so without this a folder that
            // already had them would keep them for good and keep showing LOAD
            // ORDER ERROR, which is the thing rules 2 is for.
            //
            // What stays is carried forward in the record as it is (#1218):
            // the game's own files are not read from the Steam copy again, so
            // this record is the only place they are listed. One the folder
            // still shares with the Steam copy gets a copy of its own, because
            // a file copied over the Steam copy's writes through every hard
            // link to it (measured, OwnGameShare.cs); Skyrim's archives stay
            // shared, and Share checks them.
            //
            // And only the three kinds stay (#1232). Each file that is not
            // Vortex's is Skyrim's own by the pinned build's list (O) or
            // Thornswood's by its records (T), and is recorded as which. One
            // that is neither came in with the Steam copy when the folder was
            // made, before Make kept to the three: a mod put there by hand. It
            // comes out of this folder, logged; only this folder's name for
            // it goes, and the Steam copy keeps its own.
            foreach (KeyValuePair<string, Rec> kv in old)
            {
                if (seen.Contains(kv.Key)) continue;
                // Outside what this refresh looks at (Scope): Vortex's files as
                // they were. The game's own and Thornswood's are still sorted
                // into the three kinds from the records alone, which opens no
                // file, so one that is none of them still comes out (#1232).
                bool inScope = InScope(kv.Key, scope);
                if (!inScope && kv.Value.Origin == 'V')
                {
                    lines.Add(kv.Value.Kind + "|" + kv.Value.Origin + "|" + kv.Value.Size + "|" + kv.Value.Ticks + "|" + kv.Key);
                    continue;
                }
                bool mine = owned.Contains(kv.Key);
                if (mine || (kv.Value.Origin != 'V' && !UnwantedCreation(kv.Key) && !Parked(kv.Key)))
                {
                    string at = Path.Combine(Folder, kv.Key);
                    try
                    {
                        if (inScope && (!File.Exists(at) || (!mine && Skip(kv.Key) != null))) continue;
                        char origin = kv.Value.Origin;
                        if (origin != 'V')
                        {
                            origin = KindOf(kv.Key, null, ours);
                            if (origin == '\0' && !sortNow)
                            {
                                // Kept as it was until the records are here.
                                unsorted++;
                                origin = kv.Value.Origin;
                            }
                            else if (origin == '\0')
                            {
                                try
                                {
                                    DropName(at);
                                    byHand.Add(kv.Key);
                                    left.Add(kv.Key + "  (taken out: " + NoneOfThree + ")");
                                }
                                catch (Exception ex)
                                {
                                    // Held open: it stays on record as it was,
                                    // and made.txt says the folder is not sorted
                                    // yet (kinds=0), so the next start tries again.
                                    Swallow.Note("OwnGame.Refresh, taking out " + kv.Key, ex);
                                    stuck.Add(kv.Key);
                                    lines.Add(kv.Value.Kind + "|" + kv.Value.Origin + "|" + kv.Value.Size + "|" + kv.Value.Ticks + "|" + kv.Key);
                                }
                                continue;
                            }
                        }
                        char kind = kv.Value.Kind;
                        // Rules 11, once (#2210): in a folder whose record is
                        // older than 11, a game file or one of Thornswood's own
                        // (T) it still shares with the Steam copy, such as the
                        // behavior files Nemesis writes in place there, gets a
                        // copy of its own, and the record says what the disk
                        // holds: eighteen archives on the shipping machine were
                        // on record as linked and were copies (#1217). Any
                        // other folder keeps the L or C its record has.
                        if (rule11)
                        {
                            int names = Links(at);
                            if (origin != 'V' && !IsArchive(kv.Key) && names > 1)
                            {
                                Separate(at);
                                names = Links(at);
                                if (names <= 1) separatedGame++;
                            }
                            kind = names > 1 ? 'L' : 'C';
                        }
                        lines.Add(kind + "|" + origin + "|" + kv.Value.Size + "|" + kv.Value.Ticks + "|" + kv.Key);
                    }
                    catch (Exception ex)
                    {
                        Swallow.Note("OwnGame.Refresh, carrying " + kv.Key + " forward", ex);
                        lines.Add(kv.Value.Kind + "|" + kv.Value.Origin + "|" + kv.Value.Size + "|" + kv.Value.Ticks + "|" + kv.Key);
                    }
                    continue;
                }
                try
                {
                    string dest = Path.Combine(Folder, kv.Key);
                    if (File.Exists(dest)) { DropName(dest); removed++; }
                }
                catch (Exception ex) { Swallow.Note("OwnGame.Refresh, drop removed", ex); }
            }

            // A retired mod goes whether the record lists it or not: the
            // launcher wrote one of its files itself and never recorded it.
            foreach (string r in RetiredFiles)
            {
                try
                {
                    string dest = Path.Combine(Folder, r);
                    if (File.Exists(dest)) { DropName(dest); removed++; }
                }
                catch (Exception ex) { Swallow.Note("OwnGame.Refresh, drop retired", ex); }
            }

            // So do the body shape sliders and jiggle (#993). A link removed
            // here is this folder's name for the file; Vortex's copy stays.
            foreach (string r in BodyShapeFiles)
            {
                try
                {
                    string dest = Path.Combine(Folder, r);
                    if (File.Exists(dest)) { DropName(dest); removed++; }
                }
                catch (Exception ex) { Swallow.Note("OwnGame.Refresh, drop body shape", ex); }
            }

            // And Bethesda's Creation Kit and copies of the game's programs
            // (#1152), whoever put them here: the Steam copy, or a pack that
            // carried them before Ship-Rules kept them out. Only this folder's
            // names go; a Creation Kit in the Steam copy is the person's own.
            foreach (string dest in BethesdaToolsIn(Folder))
            {
                try { if (File.Exists(dest)) { DropName(dest); removed++; } }
                catch (Exception ex) { Swallow.Note("OwnGame.Refresh, drop Bethesda tool", ex); }
            }

            // What was left out outside what this refresh looked at was not
            // looked at again, so its lines stay as the last refresh wrote them.
            if (scope != null)
            {
                leftBefore.AddRange(left);
                left = leftBefore;
            }

            WriteRecord(FilesList, lines);
            WriteRecord(LeftOutFile, left);
            // Vortex's record as this refresh took it in, for the next one to
            // compare with (VortexMoved), after files.txt and before made.txt:
            // a refresh cut short before files.txt keeps the old one, so the
            // next start looks at the same files again.
            WriteVortexSeen(src, Staged(src), failed, scope, seenBefore);
            // Sorted into the three kinds only when every record was here and
            // nothing was held open; otherwise the next start refreshes again
            // once it can finish (KindsDue).
            WriteMade(src, SumCopied(lines), sortNow && stuck.Count == 0 ? 1 : 0);
            SettleSettings(false);

            string own = "";
            if (byHand.Count > 0)
                own += " Took " + byHand.Count.ToString("n0") + (byHand.Count == 1 ? " file" : " files") + " out of Thornswood's folder that came in from the Steam copy when the folder was made " +
                       "and are not Skyrim's own, Vortex's or Thornswood's, such as mods put there by hand: " + Some(byHand) +
                       ". They are still in the Steam copy, which was not touched, for the Skyrim you play from Steam; the list is in " + LeftOutFile + ".";
            if (stuck.Count > 0)
                own += " " + stuck.Count.ToString("n0") + " more like " + (stuck.Count == 1 ? "it" : "them") + " could not be taken out yet, most likely because something has " +
                       (stuck.Count == 1 ? "it" : "them") + " open (" + Some(stuck) + "); the launcher tries again the next time it starts.";
            if (unsorted > 0)
                own += " " + unsorted.ToString("n0") + (unsorted == 1 ? " file" : " files") + " in Thornswood's folder came in from the Steam copy and " + (unsorted == 1 ? "is" : "are") +
                       " not Skyrim's own or Vortex's. Whether " + (unsorted == 1 ? "it is" : "they are") + " Thornswood's is known once the launcher has checked this install against its release, " +
                       "and the next start after that takes out any that are not.";
            // These used to say the files were shared "with the Steam copy".
            // Measured on One (#2210), the other name was another folder's: the
            // dev install's game folder that Vortex deployed into, and a
            // release folder made by hard linking the main install's.
            if (separated > 0) own += " " + separated.ToString("n0") + " of Vortex's file(s) that it keeps as copies of its own had another name, in Vortex's mods folder or another folder, and are its own copies again.";
            if (relinked > 0) own += " " + relinked.ToString("n0") + " Distribution redistributable(s) it held as its own copies are hard links now.";
            if (separatedGame > 0) own += " " + separatedGame.ToString("n0") + " of the game's own and Thornswood's file(s) had another name, in the Steam copy or another folder, and are its own copies again, so nothing done there reaches them.";
            string shared = Share(GameFor(src), say);
            if (shared != null) own += " " + shared;
            // What was looked at and how long it took, so the log says what a
            // refresh cost (#2210).
            string cost = " It took " + Seconds(clock.Elapsed) + Looked(scope) + ".";
            if (added + changed + removed + byHand.Count == 0)
                return "Thornswood's own Skyrim folder already matches what Vortex has deployed." + own + cost;
            return "Thornswood's own Skyrim folder is up to date with Vortex: " + added.ToString("n0") + " new, " +
                   changed.ToString("n0") + " changed, " + removed.ToString("n0") + " taken out" +
                   (copyBytes > 0 ? ", " + Mb(copyBytes) + " copied" : "") + "." + own + cost;
        }

        /// <summary>
        /// What a refresh looked at and why, for its log line (#2210).
        /// </summary>
        static string Looked(Scope scope)
        {
            if (scope == null) return ", looking at every file Vortex deployed and every file on record";
            string rules = scope.Rules == null ? null : string.Join(" and ", scope.Rules);
            int n = scope.Vortex == null ? 0 : scope.Vortex.Count;
            string files = n == 1 ? "the 1 file" : "the " + n.ToString("n0") + " files";
            if (scope.Vortex == null)
                return ", looking only at " + rules + ", because Vortex has not deployed since the last time and only the rules about those changed";
            if (rules == null)
                return n == 0
                    ? ", looking at no file, because Vortex's record lists the same files from the same mods at the same times as the last time"
                    : ", looking only at " + files + " whose entry in Vortex's record changed, came or went since the last time, because nothing else can have changed";
            return ", looking only at " + rules + (n == 0 ? "" : " and " + files + " whose entry in Vortex's record changed, came or went") +
                   ", because only the rules about those changed and nothing else in Vortex's record moved";
        }

        static string Seconds(TimeSpan t)
        {
            int s = (int)Math.Round(t.TotalSeconds);
            if (s < 1) return "less than a second";
            return s == 1 ? "1 second" : s.ToString("n0") + " seconds";
        }

        /// <summary>
        /// Puts collection plugins the golden list expects but Game\Data does not
        /// have back into Data, from what Vortex has deployed (or its staging).
        /// Does not remove anything from plugins.txt: Gavin's Diagnostics case
        /// (CFTO-Lanterns, CFTO-CoveredCarriages, BeardMaskFix and the like) is
        /// light plugins the person wants kept on, and the server never serves
        /// light plugins, so Fix cannot fetch them. Refreshing the own folder,
        /// or linking/copying each missing file from Vortex, is how Fix clears
        /// "in the list but the file is not in Data". Returns how many were
        /// restored. Works for Main (C:\Thornswood) and DevBuild the same way,
        /// because Paths.Game and DeploysInto already follow this install.
        /// </summary>
        public static int RestoreMissingPlugins(Config cfg, Action<string> say)
        {
            if (say == null) say = delegate(string m) { };

            // Chosen at install and not made yet (#1226): Paths.Game is
            // Profile\Payload, which holds Thornswood's own files and none of
            // Vortex's. Vortex's plugins come in with the folder (Make), and
            // putting them into Payload now would take them in as Thornswood's.
            if (Paths.OwnFirst)
            {
                say("Vortex's plugins go into Thornswood's own folder when it is made, so there is nothing to put back before then.");
                return 0;
            }

            List<string> want = ShippedPlugins();
            if (want.Count == 0) return 0;

            string data = Path.Combine(Paths.Game, "Data");
            var missing = new List<string>();
            foreach (string p in want)
            {
                try
                {
                    if (!File.Exists(Path.Combine(data, p))) missing.Add(p);
                }
                catch (Exception ex)
                {
                    Swallow.Note("OwnGame.RestoreMissingPlugins, asking whether " + p + " is in Data", ex);
                    missing.Add(p);
                }
            }
            if (missing.Count == 0) return 0;

            // Own folder: Refresh brings every missing plugin from Vortex and
            // keeps files.txt honest. Targeted Place alone would leave the
            // record short and the next NeedsRefresh confused.
            if (Active)
            {
                string srcOwn = "";
                try { srcOwn = DeploysInto(cfg); }
                catch (Exception ex) { Swallow.Note("OwnGame.RestoreMissingPlugins, asking which folder Vortex deploys into", ex); }
                string why = null;
                if (srcOwn.Length > 0)
                {
                    try { why = WhyNot(cfg, srcOwn); }
                    catch (Exception ex)
                    {
                        Swallow.Note("OwnGame.RestoreMissingPlugins, asking whether the own folder can refresh", ex);
                        why = ex.Message;
                    }
                }
                else why = "Vortex has no folder Thornswood can refresh from.";

                if (why == null)
                {
                    try
                    {
                        say(Refresh(cfg, say));
                        int got = 0;
                        foreach (string p in missing)
                        {
                            try { if (File.Exists(Path.Combine(data, p))) got++; }
                            catch (Exception ex) { Swallow.Note("OwnGame.RestoreMissingPlugins, checking " + p + " after refresh", ex); }
                        }
                        if (got < missing.Count)
                            say((missing.Count - got) + " plugin" + (missing.Count - got == 1 ? "" : "s") +
                                " still missing from Data after refresh. In Vortex, enable the Thornswood profile and press Deploy.");
                        return got;
                    }
                    catch (Exception ex)
                    {
                        Swallow.Note("OwnGame.RestoreMissingPlugins, refreshing the own folder", ex);
                        say("Could not refresh Thornswood's own folder (" + ex.Message.TrimEnd('.') + "). Trying Vortex's files one by one.");
                    }
                }
                else
                {
                    say("Could not refresh Thornswood's own folder: " + why + " Trying Vortex's files one by one.");
                }
            }

            string src = "";
            try { src = DeploysInto(cfg); }
            catch (Exception ex) { Swallow.Note("OwnGame.RestoreMissingPlugins, asking which folder Vortex deploys into for a one-by-one restore", ex); }
            if (string.IsNullOrEmpty(src))
            {
                say("Fix could not find Vortex's deploy folder, so the missing plugins were not put back. In Vortex, Mods, Open, Open Game Folder shows which folder it uses.");
                return 0;
            }

            string game = GameFor(src);
            bool apart = game.Length > 0 && !SameFolder(game, src);
            // A folder of Thornswood's own takes only Vortex's files (#1218):
            // from Vortex's mods folder, or from where Vortex deployed them,
            // and never a file of the same name that is only in the Steam copy.
            bool made = Active;
            Record rec = null;
            if (apart || made)
            {
                try { rec = Staged(src); }
                catch (Exception ex)
                {
                    Swallow.Note("OwnGame.RestoreMissingPlugins, reading Vortex's staging records", ex);
                    say("Vortex's staging record for " + src + " could not be read (" + ex.Message.TrimEnd('.') + ").");
                }
            }

            HashSet<string> deployed = null;
            try { deployed = Deployed(src); }
            catch (Exception ex)
            {
                Swallow.Note("OwnGame.RestoreMissingPlugins, reading what Vortex deployed", ex);
                deployed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }

            int n = 0;
            foreach (string p in missing)
            {
                try { if (File.Exists(Path.Combine(data, p))) continue; }
                catch (Exception ex) { Swallow.Note("OwnGame.RestoreMissingPlugins, re-checking " + p + " before place", ex); }

                string rel = "Data\\" + p;
                string from = null;
                if (rec != null)
                {
                    string staged;
                    if (rec.From.TryGetValue(rel, out staged) && !string.IsNullOrEmpty(staged) && File.Exists(staged))
                        from = staged;
                }
                if (from == null)
                {
                    string direct = Path.Combine(src, "Data", p);
                    try { if (File.Exists(direct) && (!made || deployed.Contains(rel))) from = direct; }
                    catch (Exception ex) { Swallow.Note("OwnGame.RestoreMissingPlugins, looking for " + p + " under Vortex's deploy folder", ex); }
                }
                if (from == null && game.Length > 0 && apart && !made)
                {
                    string steamCopy = Path.Combine(game, "Data", p);
                    try
                    {
                        if (File.Exists(steamCopy) && (deployed == null || !deployed.Contains(rel)))
                            from = steamCopy;
                    }
                    catch (Exception ex) { Swallow.Note("OwnGame.RestoreMissingPlugins, looking for " + p + " under the Steam copy", ex); }
                }
                if (from == null)
                {
                    say(p + " is still missing: Vortex does not have a copy to put back. In Vortex, enable the Thornswood profile and press Deploy.");
                    continue;
                }

                string dest = Path.Combine(data, p);
                try
                {
                    bool copy = MustCopy(rel, deployed);
                    bool linked;
                    if (File.Exists(dest)) DropName(dest);
                    Place(from, dest, copy, out linked);
                    say(p + " was put back into Data from Vortex" + (linked ? " (linked)." : "."));
                    n++;
                }
                catch (Exception ex)
                {
                    Swallow.Note("OwnGame.RestoreMissingPlugins, placing " + p, ex);
                    say(p + " could not be put back (" + ex.Message.TrimEnd('.') + "). Close Skyrim and Vortex and press Fix again.");
                }
            }
            return n;
        }

        /// <summary>
        /// Settings that live outside the game folder. Under the collection the
        /// launcher left Windows' own Skyrim folders alone; from here on it points
        /// them at Profile for each session (Swap), so those need something in
        /// them first.
        /// </summary>
        static void SettleSettings(bool first)
        {
            // Seed the plugin list where Skyrim will read it, under Profile.
            // A file already there is kept. Overwriting it on every refresh
            // put Golden's order back over a Fix/PutInServerOrder list.
            try
            {
                Directory.CreateDirectory(Paths.LocalAD);
                foreach (string n in new string[] { "plugins.txt", "loadorder.txt" })
                {
                    string shipped = Path.Combine(Paths.Golden, n);
                    string dest = Path.Combine(Paths.LocalAD, n);
                    if (!File.Exists(shipped)) continue;
                    // A pack or Fix before the folder existed already wrote
                    // this Profile file (#1234). Make keeps it. Golden fills
                    // only a missing file, on Make and on Refresh, so a
                    // server order is not put back to the shipped list
                    // (Thornswood-Content near the end).
                    if (!File.Exists(dest)) File.Copy(shipped, dest, true);
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.SettleSettings, copy shipped ini", ex); }

            BakeVortexList();

            if (!first) return;
            SettleFirstSettings();
        }

        /// <summary>
        /// Vortex's Thornswood profile list, for Publish-Update on a machine
        /// that ships (#557), copied into Profile\OwnGame. Windows' live
        /// plugins.txt follows whichever Vortex profile is active; the named
        /// Thornswood profile is the collection's order. Nothing here writes
        /// to Vortex. Run on every refresh, the one that finds nothing to
        /// bring in included, since the list changes without a deployment.
        /// </summary>
        static void BakeVortexList()
        {
            try
            {
                string tw = Checks.VortexProfileDir("Thornswood");
                string livePlugins = Path.Combine(Paths.WinLocalAD, "plugins.txt");
                if (tw == null)
                {
                    try { File.AppendAllText(Paths.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  OwnGame: Vortex profile Thornswood was not found; leaving Profile\\OwnGame plugin list alone rather than copying Windows' live list from another profile." + Environment.NewLine); } catch { /* the log is only a note; leaving OwnGame alone stands without it */ }
                }
                else
                {
                    Directory.CreateDirectory(Dir);
                    foreach (string n in new string[] { "plugins.txt", "loadorder.txt" })
                    {
                        string from = Path.Combine(tw, n);
                        if (File.Exists(from)) File.Copy(from, Path.Combine(Dir, n), true);
                    }
                    string twPlugins = Path.Combine(tw, "plugins.txt");
                    if (File.Exists(livePlugins) && File.Exists(twPlugins) && !Junction.IsLink(Paths.WinLocalAD))
                    {
                        string a = File.ReadAllText(livePlugins);
                        string b = File.ReadAllText(twPlugins);
                        if (!string.Equals(a, b, StringComparison.Ordinal))
                            try { File.AppendAllText(Paths.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  OwnGame: Windows' live plugins.txt differs from the Thornswood Vortex profile at " + tw + "; baked OwnGame from Thornswood." + Environment.NewLine); } catch { /* the log is only a note; the bake stands without it */ }
                    }
                }
            }
            catch (Exception ex) { try { File.AppendAllText(Paths.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  OwnGame: baking Thornswood profile list failed: " + ex.Message + Environment.NewLine); } catch { /* the log itself failed; nowhere left to say so */ } }
        }

        /// <summary>The settings a folder gets only when it is made (SettleSettings(true)).</summary>
        static void SettleFirstSettings()
        {
            // Skyrim's own ini files, so the first session is not on defaults.
            try
            {
                Directory.CreateDirectory(Paths.MyGames);
                foreach (string n in new string[] { "Skyrim.ini", "SkyrimPrefs.ini", "SkyrimCustom.ini" })
                {
                    string from = Path.Combine(Paths.WinMyGames, n);
                    string to = Path.Combine(Paths.MyGames, n);
                    if (File.Exists(from) && !File.Exists(to)) File.Copy(from, to, false);
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.SettleSettings, copy profile list", ex); }

            // Under the collection a character's saves were linked into Windows'
            // own save folder, and the link stayed there between sessions, so
            // every other server's game saved into a Thornswood character.
            // Taking the link off leaves the saves where they really are.
            try
            {
                string saves = Path.Combine(Paths.WinMyGames, "Saves");
                if (Junction.IsLink(saves) && !Junction.IsLink(Paths.WinMyGames))
                {
                    Directory.Delete(saves);
                    Directory.CreateDirectory(saves);
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.SettleSettings, create dir", ex); }
        }

        // ------------------------------------------------------------ writes

        /// <summary>
        /// Before a write that replaces a whole file: in a folder made of links
        /// the name comes off first, so the new file belongs to this folder
        /// alone. Nothing happens under the collection, where the Steam copy is
        /// Vortex's and its links are left as Vortex made them.
        /// </summary>
        public static void Unshare(string path)
        {
            if (Paths.Collection) return;
            try
            {
                if (File.Exists(path) && Links(path) > 1) File.Delete(path);
            }
            catch (Exception ex) { Swallow.Note("OwnGame.Unshare, delete", ex); }
        }

        /// <summary>
        /// Before a write into part of a file, which has to keep the rest of it:
        /// this folder gets a copy of its own first. Same rule as Unshare about
        /// the collection.
        /// </summary>
        public static void Separate(string path)
        {
            if (Paths.Collection) return;
            try
            {
                if (!File.Exists(path) || Links(path) <= 1) return;
                // One rename over the shared name, never a delete first (#2599).
                SwapCopyIn(path, path + ".own");
            }
            catch (Exception ex) { Swallow.Note("OwnGame.Separate, move", ex); }
        }

        /// <summary>
        /// Takes one name off a file. Attributes belong to the file rather than
        /// the name, so read only is only cleared when the delete is refused,
        /// and then on a file this folder is letting go of anyway.
        /// </summary>
        public static void DropName(string path)
        {
            try { File.Delete(path); }
            catch (UnauthorizedAccessException)
            {
                File.SetAttributes(path, FileAttributes.Normal);
                File.Delete(path);
            }
        }

        /// <summary>
        /// Break a hard link before a write that replaces the whole file.
        ///
        /// Unshare above deliberately leaves the collection layout alone,
        /// because there the game IS the Steam copy and nearly everything in
        /// it belongs to Vortex. That is the right rule for a file this build
        /// only touches. It is the wrong rule for a plugin that Fix is
        /// replacing outright.
        ///
        /// Vortex deploys by hard link, so the plugin in the Steam copy and
        /// the Nexus mod inside Vortex's staging folder are one file with two
        /// names, and staging is shared by every Skyrim profile on the machine.
        /// Writing through that link puts this build's copy of a plugin inside
        /// another server's collection, where nothing says it came from here
        /// and nobody would think to look. Somebody who plays Thornswood and
        /// one other SkyMP server gets turned away by the other one, and the
        /// only trace is a checksum that stopped matching.
        ///
        /// So this one always breaks the link, whatever the layout. The cost is
        /// that Vortex's staging keeps the bytes it had, so a later Vortex
        /// deploy can put them back here. Scan sees that the moment it runs and
        /// Fix puts it right again, which is a loop somebody can see and get
        /// out of. The other way round is silent and lands on somebody else.
        /// </summary>
        public static void Detach(string path)
        {
            try
            {
                if (File.Exists(path) && Links(path) > 1) File.Delete(path);
            }
            catch (Exception ex) { Swallow.Note("OwnGame.Detach, delete", ex); }
        }

        /// <summary>
        /// How many names the file has. Asked with a handle that may read the
        /// file's attributes and nothing else (#2210). Until 11 Oct this opened
        /// the file for reading, and opening for reading is what the virus
        /// scanner checks: on One, 12.13 ms a file against 0.20 ms for
        /// attributes only, over 1,500 files of the game folder, with the same
        /// count from both on 200 of 200. A refresh asks this of every one of
        /// some 31,000 files, up to three times each, which is why "Preparing
        /// the game folder" took four minutes whatever had changed.
        /// </summary>
        static int Links(string path)
        {
            string p = path.Length >= 260 && !path.StartsWith(@"\\?\") ? @"\\?\" + Path.GetFullPath(path) : path;
            using (SafeFileHandle h = CreateFile(p, FileReadAttributes, FileShareAll, IntPtr.Zero, OpenExisting, BackupSemantics, IntPtr.Zero))
            {
                // Missing, refused or held: the same exceptions FileStream threw,
                // which every caller already catches.
                if (h.IsInvalid) Marshal.ThrowExceptionForHR(Marshal.GetHRForLastWin32Error());
                FileInfoByHandle info;
                if (!GetFileInformationByHandle(h, out info)) return 1;
                return (int)info.NumberOfLinks;
            }
        }

        /// <summary>
        /// Which file is at <paramref name="path"/> right now: its volume and
        /// file id, size and write time, asked the same attributes-only way as
        /// Links. Another file put at the path, or the same one written, gives
        /// another answer. Null when there is no file or it cannot be asked.
        /// The update uses it to tell whether a refresh changed a file between
        /// its check and its write (#2210).
        /// </summary>
        public static string Identity(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path)) return null;
                string p = path.Length >= 260 && !path.StartsWith(@"\\?\") ? @"\\?\" + Path.GetFullPath(path) : path;
                using (SafeFileHandle h = CreateFile(p, FileReadAttributes, FileShareAll, IntPtr.Zero, OpenExisting, BackupSemantics, IntPtr.Zero))
                {
                    if (h.IsInvalid) return null;
                    FileInfoByHandle info;
                    if (!GetFileInformationByHandle(h, out info)) return null;
                    if ((info.FileAttributes & 0x10) != 0) return null;
                    return info.VolumeSerialNumber + ":" + info.FileIndexHigh + ":" + info.FileIndexLow + ":" +
                           info.FileSizeHigh + ":" + info.FileSizeLow + ":" + info.LastWriteTime.dwHighDateTime + ":" + info.LastWriteTime.dwLowDateTime;
                }
            }
            catch { return null; }
        }

        // ------------------------------------------------------------ what goes

        /// <summary>
        /// Null when the file belongs in Thornswood's folder, otherwise why not.
        /// </summary>
        static string Skip(string rel)
        {
            string leaf = Path.GetFileName(rel);
            if (leaf.StartsWith("vortex.deployment", StringComparison.OrdinalIgnoreCase)) return "Vortex's record of the Steam copy";
            if (leaf.Equals("__folder_managed_by_vortex", StringComparison.OrdinalIgnoreCase)) return "Vortex's marker";
            if (leaf.EndsWith(".vortex_backup", StringComparison.OrdinalIgnoreCase)) return "Vortex's backup";
            if (leaf.IndexOf(Checks.OffSuffix, StringComparison.OrdinalIgnoreCase) >= 0) return "moved aside earlier";
            if (leaf.EndsWith(".log", StringComparison.OrdinalIgnoreCase) || leaf.EndsWith(".pdb", StringComparison.OrdinalIgnoreCase)) return "log";
            if (Regex.IsMatch(rel, @"(^|\\)Claude outputs\\", RegexOptions.IgnoreCase)) return "not part of the game";
            if (rel.StartsWith("_to_delete\\", StringComparison.OrdinalIgnoreCase)) return "not part of the game";
            if (Parked(rel)) return "a folder something parked in the Steam copy, not part of the game";
            if (rel.StartsWith(".sentry-native\\", StringComparison.OrdinalIgnoreCase)) return "crash reporter scratch";
            if (rel.Equals("Data\\Platform\\thornswood-session.txt", StringComparison.OrdinalIgnoreCase)) return "session note";
            if (ClientFile(rel)) return "the client runtime comes from the build, not the Steam copy";
            if (Foreign(rel)) return "not one of ours";
            if (UnwantedCreation(rel)) return "a Creation Club plugin the server does not load";
            if (CrashesUs(rel)) return "it crashes the quick favourites menu";
            if (Retired(rel)) return "Start On Save is no longer part of Thornswood";
            if (BodyShape(rel)) return "body shape sliders and jiggle are not part of Thornswood";
            if (BethesdaTool(rel)) return "Bethesda's Creation Kit, its script sources or a copy of one of the game's programs, not part of Thornswood";
            return null;
        }

        /// <summary>
        /// Bethesda's Creation Kit and copies of the game's own programs, never
        /// part of Thornswood's folder (#1152).
        /// </summary>
        /// <remarks>
        /// Steam installs the Creation Kit into the Steam copy, and this folder
        /// used to take it from there like any file Vortex did not deploy. The
        /// shipping machine's folder then held CreationKit.exe, its Tools,
        /// Papyrus Compiler and lex folders, Data\DialogueViews, Data\Scripts.zip
        /// and SkyrimSE.exe.bak-1160-for-369, a copy of Skyrim itself, and packs
        /// handed them to everybody as files of ours. The game needs none of
        /// them, and they are Bethesda's.
        ///
        /// Refresh also deletes them from a folder that has them; Rules 10 makes
        /// every folder refresh once to do it. Only this folder's names go: a
        /// hard link removed here leaves the Steam copy's file where it is.
        /// Ship-Rules.ps1 keeps the same files out of every pack, record and
        /// installer (Test-ShipBethesdaTool); change the two together.
        ///
        /// Data\Source and Data\Scripts\Source are the Creation Kit's script
        /// source folders (#1227): it unpacks Data\Scripts.zip into
        /// Data\Source\Scripts, 14,298 files on the shipping machine, and the
        /// game only ever reads the compiled scripts in Data\Scripts. Rules 12
        /// takes them out of a folder that has them.
        /// </remarks>
        static readonly string[] BethesdaToolDirs = { "Tools", "Papyrus Compiler", "lex", "Data\\DialogueViews", "Data\\Source", "Data\\Scripts\\Source" };
        static readonly string[] BethesdaToolFiles = {
            "flowchartx64.dll", "flowchartx32.dll", "p4com64.dll",
            "EditorWarnings.txt", "DataFiles.txt", "SkyrimReservedAddOnIndexes.txt",
            "Data\\Scripts.zip",
        };

        static bool BethesdaTool(string rel)
        {
            foreach (string d in BethesdaToolDirs)
                if (rel.StartsWith(d + "\\", StringComparison.OrdinalIgnoreCase)) return true;
            foreach (string f in BethesdaToolFiles)
                if (rel.Equals(f, StringComparison.OrdinalIgnoreCase)) return true;
            if (rel.IndexOf('\\') >= 0) return false;
            if (rel.StartsWith("CreationKit", StringComparison.OrdinalIgnoreCase)) return true;
            // A copy of one of the game's programs under another name, such as
            // SkyrimSE.exe.bak-1160-for-369. The programs themselves stay.
            return Regex.IsMatch(rel, @"^(SkyrimSE|SkyrimSELauncher|skse64_loader)\.exe.", RegexOptions.IgnoreCase);
        }

        /// <summary>Every file in the folder that BethesdaTool names.</summary>
        static List<string> BethesdaToolsIn(string folder)
        {
            var found = new List<string>();
            try
            {
                if (!Directory.Exists(folder)) return found;
                foreach (string f in Directory.GetFiles(folder))
                    if (BethesdaTool(Path.GetFileName(f))) found.Add(f);
                foreach (string rel in BethesdaToolFiles)
                {
                    string p = Path.Combine(folder, rel);
                    if (rel.IndexOf('\\') >= 0 && File.Exists(p)) found.Add(p);
                }
                foreach (string d in BethesdaToolDirs)
                {
                    string p = Path.Combine(folder, d);
                    if (Directory.Exists(p)) found.AddRange(Directory.GetFiles(p, "*", SearchOption.AllDirectories));
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.BethesdaToolsIn", ex); }
            return found;
        }

        /// <summary>
        /// A mod Thornswood has taken out, kept out of this folder even while
        /// the collection still deploys it into the Steam copy.
        /// </summary>
        /// <remarks>
        /// Start On Save (po3, Nexus 50054), issue #394. It loads the newest
        /// save at the main menu, or presses New Game when there is none, and
        /// under SkyMP either one is a second load on top of the one the server
        /// starts: the crashes of 12 and 13 Sep, about thirty seconds in, with
        /// its DLL on the stack. The launcher used to hold it still by
        /// rewriting its settings file on every Play. It does not any more, so
        /// the mod must not be in the folder at all: an untouched copy of its
        /// settings file would start those crashes again.
        ///
        /// Refresh also deletes both files from a folder that has them, whether
        /// the folder's record lists them or not, because the settings file
        /// was written by the launcher and never recorded. Rules 7 makes every
        /// folder refresh once to do it.
        ///
        /// Ship-Rules.ps1 keeps the same two files out of every pack and the
        /// installer ($ShipRetiredFiles); change the two together.
        /// </remarks>
        static readonly string[] RetiredFiles = {
            "Data\\SKSE\\Plugins\\po3_StartOnSave.dll",
            "Data\\SKSE\\Plugins\\po3_StartOnSave.ini",
        };

        static bool Retired(string rel)
        {
            foreach (string r in RetiredFiles)
                if (rel.Equals(r, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// Body shape sliders and jiggle, kept out of this folder even while
        /// the collection still deploys them (#993).
        /// </summary>
        /// <remarks>
        /// Patrick, 28 Sep: "I don't want jiggle physics or the ability to
        /// change boob/pussy/dick/ass/nipple related stuff during creation."
        /// For men and women alike; height and weight stay.
        ///
        /// cbp.dll is CBPC (Nexus 21224), the one thing that moves the breast,
        /// belly and seat bones. Its config files do nothing without it, and
        /// no body mesh here carries an SMP physics block, so this is all of
        /// the jiggle, on people and NPCs alike. FSMP (hdtsmp64.dll) stays: it
        /// moves hair and capes, not bodies.
        ///
        /// The three scripts are the slider pages RaceMenu shows for the body:
        /// the women's body morphs (3BA's or CBBE's RaceMenuMorphsCBBE, breast,
        /// nipple and genital shapes among them), the men's (HIMBO), and the
        /// skeleton's genital sliders (XPMSE's RaceMenuPluginSoS). Each is the
        /// script on a quest in a plugin that stays loaded and inert, the same
        /// as I4IconAddon.esp beside CrashesUs, so the load order does not
        /// move. RaceMenu's own breast and glute sliders sit in its archive
        /// beside Height and cannot be left out; the front plugin undoes them
        /// ("body shape" in thornswood-front.js).
        ///
        /// Refresh also deletes them from a folder that has them, as it does
        /// RetiredFiles; Rules 9 makes every folder refresh once to do it.
        /// Ship-Rules.ps1 keeps the same four out of every pack and the
        /// installer ($ShipBodyShapeFiles); change the two together.
        /// </remarks>
        static readonly string[] BodyShapeFiles = {
            "Data\\SKSE\\Plugins\\cbp.dll",
            "Data\\Scripts\\RaceMenuMorphsCBBE.pex",
            "Data\\Scripts\\_RaceMenuMorphsHIMBO.pex",
            "Data\\Scripts\\RaceMenuPluginSoS.pex",
        };

        static bool BodyShape(string rel)
        {
            foreach (string r in BodyShapeFiles)
                if (rel.Equals(r, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// Deployed by Vortex, deliberately kept out of Thornswood's folder.
        /// </summary>
        /// <remarks>
        /// Not clutter and not another server's. Somebody chose this mod, so it
        /// gets a reason and a date and comes back the day the reason goes.
        ///
        /// Inventory Interface Information Injector (InventoryInjector.dll,
        /// v1.1.1, its last release, 2023). Choose a favourite, press Q again,
        /// the game is gone. Seven crash logs across 18 and 19 Sep are the same
        /// crash down to the address: EXCEPTION_ACCESS_VIOLATION executing
        /// 0x656D6167, which is the four characters "game" being called as code.
        /// The return address on the stack is InventoryInjector.dll+0x3AA85 and
        /// R13 holds its own Hooks::IconSetter::ProcessListFunc, with
        /// FavoritesMenu and MagicFavorites beside them; the 21:51 log even has
        /// the source path and "Running IconSetter.processList hook" on the
        /// stack. It calls through a freed pointer while building that list.
        ///
        /// What frees it is this server. SkyMP rebuilds the character's
        /// inventory from the server's copy after an equip, and the Papyrus VM
        /// in every one of those logs has a TESModPlatform.Add queued at the
        /// moment of the fault.
        ///
        /// Taken out rather than worked around: it is the code that faults, it
        /// is not built here, and no other script extender plugin names it, so
        /// nothing else in the build depends on it. What goes with it is the
        /// icons its JSON files put on inventory rows. I4IconAddon.esp stays
        /// loaded and inert, so no plugin is enabled or disabled and the load
        /// order does not move.
        ///
        /// Djinn, 19 Sep. This is the launcher's own folder build, which is what
        /// makes Thornswood\Game. New-GameFolder.ps1 is the same job for
        /// another server and Daedric and is not where this belongs: their folders are
        /// their business.
        /// </remarks>
        static bool CrashesUs(string rel)
        {
            if (rel.Equals("Data\\SKSE\\Plugins\\InventoryInjector.dll", StringComparison.OrdinalIgnoreCase)) return true;
            if (rel.StartsWith("Data\\SKSE\\Plugins\\InventoryInjector\\", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// The plugins switched on in the reference list, set at the start of
        /// Make and Refresh.
        /// </summary>
        static HashSet<string> wantedPlugins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// A Creation Club plugin in Data that the reference list does not name.
        ///
        /// Skyrim.ccc lists the Creation Club's plugins, and the game loads any of
        /// them it finds in Data straight after the five masters, whatever
        /// plugins.txt says. Steam installs four with the game since the 1.6
        /// updates (Fish and AdvDSGS are full masters, Curios and SurvivalMode
        /// are light), and the server's list has none of them. So a folder that is
        /// given them loads two masters the server does not have, and every
        /// plugin after Dragonborn.esm sits two places off: LOAD ORDER ERROR.
        ///
        /// Measured on 19 Sep. Something else had moved them out of the Steam
        /// copy's Data and something else again had put them back, and the
        /// next refresh brought them in here. The game loaded 62 full plugins
        /// against the server's 60 while the scan said everything checks out. The archives stay, because nothing loads
        /// an archive without its plugin. Packs never carry any of these either:
        /// Publish-Update.ps1 counts cc*.es? as vanilla.
        /// </summary>
        static bool UnwantedCreation(string rel)
        {
            if (!Regex.IsMatch(rel, @"^Data\\cc[^\\]*\.(esm|esl|esp)$", RegexOptions.IgnoreCase)) return false;
            return !wantedPlugins.Contains(rel.Substring("Data\\".Length));
        }

        /// <summary>
        /// The SkyMP client runtime Thornswood ships: the six files the fork
        /// builds that differ from upstream, put into the game folder by
        /// scripts\release\Sync-Client.ps1 against records\client-build.json. They are
        /// never taken from the Steam copy, because until 20 September the Steam
        /// copy held another server's launcher's builds of every one of them
        /// and this class copied them across on every rebuild.
        /// </summary>
        public static readonly string[] ClientFiles = {
            "Data\\SKSE\\Plugins\\MpClientPlugin.dll",
            "Data\\SKSE\\Plugins\\SkyrimPlatform.dll",
            "Data\\Platform\\Distribution\\RuntimeDependencies\\SkyrimPlatformImpl.dll",
            "Data\\Platform\\Distribution\\RuntimeDependencies\\SkyrimPlatformCEF.exe.hidden",
            "Data\\Platform\\Plugins\\skymp5-client.js",
            "Data\\Scripts\\TESModPlatform.pex",
        };

        public static bool ClientFile(string rel)
        {
            foreach (string c in ClientFiles)
                if (rel.Equals(c, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// Not one of ours, by what belongs rather than by whose it is. The
        /// same shape as Test-ShipOtherServer in scripts\release\Ship-Rules.ps1; change
        /// both together. Nothing here names another server: the list is what
        /// Thornswood's folder holds, and anything else in these places is
        /// left out whoever wrote it.
        /// </summary>
        public static bool Foreign(string rel)
        {
            const RegexOptions I = RegexOptions.IgnoreCase;
            string leaf = Path.GetFileName(rel);
            // NirnLab UI Platform, another server's interface framework, and
            // the one thing this folder must not be handed.
            //
            // SkyrimPlatform will not start on its own browser while NirnLab is
            // in the folder. NirnLab puts its directory on the process PATH, its
            // libcef.dll is loaded instead of the one in
            // Data\Platform\Distribution, and SkyrimPlatform stops with "Your PATH
            // environment variable contains incompatible entries" before the game
            // draws anything. Measured on 17 Sep in a folder this class built.
            //
            // It is also what brings CEFSubprocess.exe, which is the second
            // program Windows Firewall stops the game to ask about.
            if (rel.StartsWith("Data\\NirnLabUIPlatform\\", StringComparison.OrdinalIgnoreCase)) return true;
            if (leaf.Equals("NirnLabUIPlugin.dll", StringComparison.OrdinalIgnoreCase)) return true;
            // The client's per machine sign in data. It holds an access token.
            if (rel.StartsWith("Data\\Platform\\PluginsNoLoad\\", StringComparison.OrdinalIgnoreCase)) return true;

            /*
              A LOOSE map.swf, WHICH IS SOMEBODY ELSE'S AND BREAKS SkyUI.

              22 September: a full screen box on the way in, "SKYUI ERROR CODE
              5. Incompatible menu file (map.swf)." SkyUI checks that file's
              version and refuses one it does not recognise, so the box is
              SkyUI saying something else's copy won.

              MEASURED RATHER THAN GUESSED. The file is in the Steam copy, this
              class hard linked it into Thornswood's folder, and the publish
              baseline ships it. Vortex's own deployment record does NOT list
              it: nothing in the collection put it there. SkyUI ships its
              map.swf inside SkyUI_SE.bsa, and A Quality World Map, which is
              the other mod anybody would suspect, ships 32 files and not one
              of them is a .swf or anything under Interface at all. Its map is
              Textures\terrain\*.dds, the ESP and two scripts.

              So the loose file is an orphan another launcher left in the Steam
              copy, it overrides SkyUI's copy because loose beats an archive,
              and it is the only reason for the error.

              TAKING IT OUT LOSES NOTHING AND KEEPS THE GOOD MAP. SkyUI's own
              copy loads from its archive, and A Quality World Map's terrain
              textures are untouched, so the map still looks the way Patrick
              wants it to.

              This is the same disease as the SkyMP client runtime above, in a
              different folder: a file in the Steam copy that is not the
              collection's, taken into our folder and then shipped to everybody
              as though it were ours. Ship-Rules.ps1 carries the same rule;
              change the two together.
            */
            if (rel.Equals("Data\\Interface\\map.swf", StringComparison.OrdinalIgnoreCase)) return true;

            // SkyUI 5.2's own scripts, loose, issue #960: "SKYUI ERROR CODE 6,
            // menu file version mismatch, required 5.2 SE, detected 6.11 SE".
            // The collection's SkyUI keeps its scripts and its 6.11 menus in
            // SkyUI_SE.bsa, and its ski_main no longer compares menu versions.
            // These ten, compiled in 2017, were left in the Steam copy by the
            // collection installer; loose beats an archive, so the old
            // ski_main ran against the new menus. Packs delete them, and this
            // keeps a refresh from linking them back in. SKI_ConfigBase and
            // SKI_ConfigManager are MCM Recorder's and are not on the list.
            // Ship-Rules.ps1 carries the same rule ($ShipOldSkyUIScripts);
            // change the two together.
            if (Regex.IsMatch(rel, @"^Data\\Scripts\\ski_(activeeffectswidget|configmenu|favoritesmanager|main|playerloadgamealias|qf_configmanagerinstance|questbase|settingsmanager|widgetbase|widgetmanager)\.pex$", I)) return true;

            // Elysium Estate 4.3.5's plugin, issue #690. The servers load the
            // collection's 5.0.1, ElysiumEstate.esp, since 29 September. The old
            // name was only ever a hand copy in a Steam copy or a pack's copy,
            // so packs delete it and this keeps a refresh from bringing it back.
            // Ship-Rules.ps1 carries the same rule; change the two together.
            if (rel.Equals("Data\\ElysiumEstateSSE.esp", StringComparison.OrdinalIgnoreCase)) return true;

            if (!rel.StartsWith("Data\\Platform\\", StringComparison.OrdinalIgnoreCase)) return false;
            if (leaf.EndsWith(".bak", StringComparison.OrdinalIgnoreCase)) return true;
            // The retired dresser, To Do List entry 127: it put the best armour
            // it could find into every empty slot, which is Patrick's "it is
            // auto equipping things sometimes, like a hat", and it is deleted
            // from the repo. A Steam copy that took packs before its machine had
            // a folder of its own still has the old one; on Patrick's machine on
            // 24 Sep that is 11,654 bytes dated 16 Sep, with its equipItem call.
            // Packs delete it here and Keep.Forget drops the kept copy, and
            // without this line the next refresh finds the name missing, copies
            // that file back in with its 16 Sep time, and Keep.Seed takes it for
            // a kept copy because the old pack records list it. Ship-Rules.ps1
            // carries the same rule and puts the path on $ShipDeleteAlways;
            // change them together.
            if (rel.Equals("Data\\Platform\\Plugins\\thornswood-chargen.js", StringComparison.OrdinalIgnoreCase)) return true;
            // Five files under Data\Platform that nothing uses, issue #2177:
            // two pictures in Images and three icon sprite fonts in Fonts,
            // dated 12 and 14 Sep, which no script, page or font call names and
            // nobody recorded the maker of. Patrick, 15 Oct: they stop shipping
            // and every install loses them on the next release. Packs delete
            // them, and this keeps a refresh from copying a Steam copy's old
            // ones back in. Ship-Rules.ps1 carries the same five
            // ($ShipPlatformUnused); change the two together.
            if (Regex.IsMatch(rel, @"^Data\\Platform\\(Images\\(lock|speaking)\.png|Fonts\\(ChainLink|NoticeIcon|VoiceIcon)\.spritefont)$", I)) return true;
            // Two sprite fonts of commercial faces, issue #1317: DIN-Pro-bold
            // (FSI FontShop's DIN Pro Bold) and Futura (ParaType's Futura PT),
            // which nothing gives Thornswood the right to hand on. The voice
            // mark draws in Barlow-SemiBold since. Packs delete them, and this
            // keeps a refresh from copying a Steam copy's back in. Ship-Rules.ps1
            // carries the same two ($ShipCommercialFonts); change the two together.
            if (Regex.IsMatch(rel, @"^Data\\Platform\\Fonts\\(DIN-Pro-bold|Futura)\.spritefont$", I)) return true;
            // The bundle is on ClientFiles and answered above in WhyLeft, so
            // here it is simply not ours to take from the Steam copy either.
            if (Regex.IsMatch(rel, @"^Data\\Platform\\Plugins\\[^\\]+\.js$", I))
                return !leaf.StartsWith("thornswood-", StringComparison.OrdinalIgnoreCase);
            if (rel.StartsWith("Data\\Platform\\UI\\", StringComparison.OrdinalIgnoreCase))
            {
                // Same rule as Test-ShipOtherServer in Ship-Rules.ps1 (#1318):
                // ours is index.html, build.js, thornswood-* files, and the
                // hashed assets Ship wrote into the pack. Nested paths,
                // another menu's Vite files, and any unnamed flat file are
                // not ours, so a refresh cannot copy the Daedric set or the
                // unused fork svgs back from the Steam copy after a pack
                // deletes them. The list is read from the pack, never by
                // parsing build.js, which might be somebody else's copy.
                const string UiPrefix = "Data\\Platform\\UI\\";
                if (rel.Length <= UiPrefix.Length) return true;
                string rest = rel.Substring(UiPrefix.Length);
                if (rest.IndexOf('\\') >= 0 || rest.IndexOf('/') >= 0) return true;
                if (leaf.Equals("app.js", StringComparison.OrdinalIgnoreCase) || leaf.Equals("vite.svg", StringComparison.OrdinalIgnoreCase)) return true;
                if (leaf.Equals("index.html", StringComparison.OrdinalIgnoreCase) || leaf.Equals("build.js", StringComparison.OrdinalIgnoreCase)) return false;
                if (leaf.StartsWith("thornswood-", StringComparison.OrdinalIgnoreCase)) return false;
                // Before the no-list keep: the Daedric set and unused fork
                // assets are never ours, by name or by sha256, from the
                // same records\ui-gone.json Ship-Rules reads.
                if (UiGoneLeaf(leaf)) return true;
                if (UiGoneByHash(rel)) return true;
                if (UiHashedAssetName(leaf))
                {
                    HashSet<string> ours = UiHashedOurs();
                    // Packs from before #1318 have no list. Hashed front
                    // assets (chat fonts and the rest) stay ours so a
                    // refresh cannot drop them. Once a list exists, only
                    // names on it are ours.
                    if (ours.Count == 0) return false;
                    return !ours.Contains(leaf);
                }
                return true;
            }
            return false;
        }

        const string UiAssetsRel = "Data\\Platform\\UI\\thornswood-ui-assets.txt";
        static readonly Regex UiHashedName = new Regex("^[0-9a-f]{8,32}\\.(ttf|woff2?|eot|otf|svg|png|jpe?g|gif|wav|mp3|ogg|webp)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        static HashSet<string> uiHashedOurs;
        static string uiHashedWalkRoot = null;
        static string uiGoneRecordText;
        static HashSet<string> uiGoneLeaves;
        static HashSet<string> uiGoneHashes;

        static string ReadUiGoneRecord()
        {
            if (!string.IsNullOrEmpty(uiGoneRecordText)) return uiGoneRecordText;
            Stream stream;
            try { stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("ui-gone.json"); }
            catch (Exception ex)
            {
                throw new Exception("This launcher could not open records\\ui-gone.json (" + ex.Message.TrimEnd('.') +
                    "), so a refresh cannot keep another server's menu files out. Update the launcher, or tell staff it said this.");
            }
            if (stream == null)
                throw new Exception("This launcher was built without records\\ui-gone.json, so a refresh cannot keep another server's menu files out. Update the launcher, or tell staff it said this.");
            try
            {
                using (StreamReader sr = new StreamReader(stream))
                {
                    string text = sr.ReadToEnd();
                    if (string.IsNullOrEmpty(text))
                        throw new Exception("This launcher's copy of records\\ui-gone.json is empty, so a refresh cannot keep another server's menu files out. Update the launcher, or tell staff it said this.");
                    return text;
                }
            }
            catch (Exception ex)
            {
                if (ex.Message != null && ex.Message.IndexOf("records\\ui-gone.json", StringComparison.Ordinal) >= 0) throw;
                throw new Exception("This launcher could not read records\\ui-gone.json (" + ex.Message.TrimEnd('.') +
                    "), so a refresh cannot keep another server's menu files out. Update the launcher, or tell staff it said this.");
            }
        }

        static void EnsureUiGone()
        {
            if (uiGoneLeaves != null) return;
            var leaves = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var hashes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string text = ReadUiGoneRecord();
            Match d = Regex.Match(text, "\"daedric\"\\s*:\\s*\\{([\\s\\S]*?)\\}");
            Match u = Regex.Match(text, "\"unused\"\\s*:\\s*\\[([\\s\\S]*?)\\]");
            if (!d.Success || !u.Success)
                throw new Exception("This launcher's copy of records\\ui-gone.json is not the gone set, so a refresh cannot keep another server's menu files out. Update the launcher, or tell staff it said this.");
            int daedric = 0;
            foreach (Match m in Regex.Matches(d.Groups[1].Value, "\"([^\"]+)\"\\s*:\\s*\"([0-9a-fA-F]{64})\""))
            {
                leaves.Add(m.Groups[1].Value);
                hashes.Add(m.Groups[2].Value.ToLowerInvariant());
                daedric++;
            }
            int unused = 0;
            foreach (Match m in Regex.Matches(u.Groups[1].Value, "\"([^\"]+)\""))
            {
                leaves.Add(m.Groups[1].Value);
                unused++;
            }
            if (daedric == 0 || hashes.Count == 0 || unused == 0)
                throw new Exception("This launcher's copy of records\\ui-gone.json names none of the gone set, so a refresh cannot keep another server's menu files out. Update the launcher, or tell staff it said this.");
            uiGoneLeaves = leaves;
            uiGoneHashes = hashes;
        }

        static bool UiGoneLeaf(string leaf)
        {
            if (string.IsNullOrEmpty(leaf)) return false;
            EnsureUiGone();
            return uiGoneLeaves.Contains(leaf);
        }

        static string UiFileSha256(string full, out bool unreadable)
        {
            unreadable = false;
            if (string.IsNullOrEmpty(full) || !File.Exists(full)) return "";
            SHA256 sha = SHA256.Create();
            try
            {
                FileStream fs = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                try
                {
                    byte[] hash = sha.ComputeHash(fs);
                    return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
                }
                finally { fs.Dispose(); }
            }
            catch (Exception ex)
            {
                Swallow.Note("OwnGame.UiGone, hash " + full, ex);
                unreadable = true;
                return "";
            }
            finally { sha.Dispose(); }
        }

        static List<string> UiGoneHashRoots()
        {
            var roots = new List<string>();
            if (!string.IsNullOrEmpty(Paths.Game)) roots.Add(Paths.Game);
            try
            {
                if (!string.IsNullOrEmpty(Keep.Dir)) roots.Add(Keep.Dir);
            }
            catch (Exception ex) { Swallow.Note("OwnGame.UiGone, keep", ex); }
            if (!string.IsNullOrEmpty(uiHashedWalkRoot)) roots.Add(uiHashedWalkRoot);
            return roots;
        }

        static bool UiGoneByHash(string rel)
        {
            EnsureUiGone();
            List<string> roots = UiGoneHashRoots();
            for (int i = 0; i < roots.Count; i++)
            {
                bool unreadable;
                string h = UiFileSha256(Path.Combine(roots[i], rel), out unreadable);
                if (unreadable) return true;
                if (h.Length > 0 && uiGoneHashes.Contains(h)) return true;
            }
            return false;
        }

        static bool UiHashedAssetName(string leaf)
        {
            return leaf != null && UiHashedName.IsMatch(leaf);
        }

        static void ResetUiHashedOurs()
        {
            uiHashedOurs = null;
        }

        static void LoadUiHashedList(HashSet<string> set, string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return;
            foreach (string raw in File.ReadAllLines(path))
            {
                string n = (raw ?? "").Trim();
                if (n.Length == 0 || n[0] == '#') continue;
                if (n.IndexOfAny(new char[] { '/', '\\' }) >= 0) continue;
                if (n.IndexOf("..", StringComparison.Ordinal) >= 0) continue;
                if (UiHashedAssetName(n)) set.Add(n);
            }
        }

        static void LoadUiHashedFromRoot(HashSet<string> set, string root)
        {
            if (string.IsNullOrEmpty(root)) return;
            try { LoadUiHashedList(set, Path.Combine(root, UiAssetsRel)); }
            catch (Exception ex) { Swallow.Note("OwnGame.UiHashedOurs, " + root, ex); }
        }

        /// <summary>
        /// Hashed UI assets Ship wrote into the pack (#1318). Read from that
        /// list, never by parsing build.js.
        /// </summary>
        static HashSet<string> UiHashedOurs()
        {
            if (uiHashedOurs != null) return uiHashedOurs;
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try { LoadUiHashedFromRoot(set, Paths.Game); }
            catch (Exception ex) { Swallow.Note("OwnGame.UiHashedOurs, game", ex); }
            try { LoadUiHashedFromRoot(set, Keep.Dir); }
            catch (Exception ex) { Swallow.Note("OwnGame.UiHashedOurs, keep", ex); }
            LoadUiHashedFromRoot(set, uiHashedWalkRoot);
            try
            {
                if (!string.IsNullOrEmpty(Paths.ProfileDir))
                    LoadUiHashedList(set, Path.Combine(Paths.ProfileDir, "OwnGame", "ui-front-assets.txt"));
            }
            catch (Exception ex) { Swallow.Note("OwnGame.UiHashedOurs, profile", ex); }
            uiHashedOurs = set;
            return set;
        }

        static readonly string[] CopyTypes = {
            ".ini", ".json", ".toml", ".txt", ".cfg", ".xml", ".yaml", ".yml", ".js", ".html", ".htm",
            ".css", ".dll", ".exe", ".asi", ".bat", ".cmd", ".ps1", ".count", ".bak", ".ess", ".skse",
            ".md", ".csv", ".jslot"
        };

        /// <summary>
        /// Skyrim's own master files. The server checks plugins by size and
        /// checksum, and anything else that writes into the Steam copy would
        /// change a linked master under Thornswood, so these are copied.
        /// </summary>
        static readonly string[] Masters = {
            "Data\\Skyrim.esm", "Data\\Update.esm", "Data\\Dawnguard.esm", "Data\\HearthFires.esm",
            "Data\\Dragonborn.esm", "Data\\_ResourcePack.esl"
        };


        /// <summary>
        /// What a behavior generator writes into the game: Nemesis and FNIS
        /// rebuild every behavior graph, the two character defaults and FNIS.pex
        /// for the mod list they are run against, and they write over the
        /// existing files IN PLACE.
        ///
        /// 26 September, Djinn's machine. Nemesis was run at 5:32 AM for a Solo
        /// profile in the Steam copy. Both Thornswood folders on that machine,
        /// the live one and the dev one, had those files as hard links to the
        /// Steam copy's, so both started playing the Solo animations at that
        /// moment without any refresh, and the next dev Ship tried to send
        /// them to every tester (the ship check stopped it). Running Nemesis
        /// again for the Thornswood profile at 2:26 PM changed them back in all
        /// three folders at once, which is the same leak the other way round.
        ///
        /// Copied, the folder keeps what it was built with until a refresh
        /// brings in what Vortex has deployed for Thornswood, whatever anybody
        /// generates in the Steam copy for another profile in between.
        /// </summary>
        static bool Generated(string rel)
        {
            const RegexOptions I = RegexOptions.IgnoreCase;
            if (Regex.IsMatch(rel, @"^Data\\Meshes\\.*\\behaviors\\[^\\]+\.hkx$", I)) return true;
            if (Regex.IsMatch(rel, @"^Data\\Meshes\\actors\\character\\characters( female)?\\default(male|female)\.hkx$", I)) return true;
            if (Regex.IsMatch(rel, @"^Data\\Scripts\\FNIS[^\\]*\.pex$", I)) return true;
            return false;
        }

        /// <summary>
        /// A folder somebody parked inside the Steam copy: a name starting with
        /// an underscore, at the game's root or directly in Data. Skyrim ships
        /// none, and nothing loads from one. What was in them on 26 September:
        /// _Parked (a whole multiplayer client with a voice token), _Solo Mods,
        /// _Profile Switch (a switch script) and another server's
        /// Data\_disabledBy folder, its short name after it. A file
        /// whose own name starts with one, such as Data\_ResourcePack.esl, is
        /// the game's and is not matched: only a folder is.
        /// </summary>
        static bool Parked(string rel)
        {
            string[] p = rel.Split('\\');
            if (p.Length > 1 && p[0].StartsWith("_")) return true;
            if (p.Length > 2 && p[0].Equals("Data", StringComparison.OrdinalIgnoreCase) && p[1].StartsWith("_")) return true;
            return false;
        }

        /// <summary>
        /// Copied rather than linked: anything in the game's root folder, the
        /// client and browser folders, the script extender's folder and MCM's
        /// settings, any settings, script or program file wherever it is, the
        /// game's master files. Those are what gets rewritten in place.
        ///
        /// Exception under Data\Platform\Distribution: a file Vortex deployed
        /// that is not one of the six recorded in records\client-build.json
        /// (ClientFile) is hard linked, even when it is a .dll or .exe. Those
        /// are the 68 CEF and Node redistributables the collection carries;
        /// nothing rewrites them in place. The two recorded Distribution
        /// files (SkyrimPlatformImpl.dll and SkyrimPlatformCEF.exe.hidden)
        /// stay copied. Everything else under Data\Platform keeps being
        /// copied. Issue #392.
        /// </summary>
        public static bool MustCopy(string rel, HashSet<string> deployed)
        {
            if (rel.IndexOf('\\') < 0) return true;
            // The game's own files, whatever Vortex did not deploy, are the
            // folder's own copies (#1218): the Steam copy is the person's to
            // update, verify and mod, and a file copied over one there writes
            // through every hard link to it. Skyrim's archives are the one
            // exception, linked only while their bytes are the ones on record
            // (IsArchive, and Share and CheckShared in OwnGameShare.cs).
            if (deployed != null && !deployed.Contains(rel) && !IsArchive(rel)) return true;
            // Vortex redistributables under Distribution: link, even .dll/.exe.
            // The two recorded client-build files stay copied (ClientFile).
            if (rel.StartsWith("Data\\Platform\\Distribution\\", StringComparison.OrdinalIgnoreCase)
                && deployed != null
                && deployed.Contains(rel)
                && !ClientFile(rel))
                return false;
            foreach (string d in new string[] { "Data\\Platform\\", "Data\\SKSE\\", "Data\\MCM\\", "Data\\Video\\" })
                if (rel.StartsWith(d, StringComparison.OrdinalIgnoreCase)) return true;
            foreach (string m in Masters)
                if (rel.Equals(m, StringComparison.OrdinalIgnoreCase)) return true;
            if (Generated(rel)) return true;
            return Array.IndexOf(CopyTypes, Path.GetExtension(rel).ToLowerInvariant()) >= 0;
        }

        static void Place(string from, string to, bool copy, out bool linked)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(to));
            if (!copy && CreateHardLink(to, from, IntPtr.Zero)) { linked = true; return; }
            File.Copy(from, to, false);
            linked = false;
        }

        // ------------------------------------------------------------ records

        static readonly Regex RelPath = new Regex("\"relPath\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");

        /// <summary>
        /// Every path Vortex says it deployed, relative to the game folder. The
        /// record in Data is relative to Data; the ones in the game's root (the
        /// script extender's loader is one) are relative to the root.
        /// </summary>
        public static HashSet<string> DeployedIn(string src) { return Deployed(src); }

        static HashSet<string> Deployed(string src)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            ReadDeployment(set, Path.Combine(src, "Data"), "Data\\");
            ReadDeployment(set, src, "");
            return set;
        }

        static void ReadDeployment(HashSet<string> set, string dir, string prefix)
        {
            string[] files;
            try { files = Directory.GetFiles(dir, "vortex.deployment*.json"); } catch { return; }
            foreach (string f in files)
            {
                string text;
                try { text = File.ReadAllText(f); } catch { continue; }
                foreach (Match m in RelPath.Matches(text))
                {
                    string rel = Unescape(m.Groups[1].Value).Replace('/', '\\').TrimStart('\\');
                    if (rel.Length > 0) set.Add(prefix + rel);
                }
            }
        }

        static string Unescape(string s)
        {
            if (s.IndexOf('\\') < 0) return s;
            var sb = new StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c != '\\' || i + 1 >= s.Length) { sb.Append(c); continue; }
                char n = s[++i];
                switch (n)
                {
                    case 'n': sb.Append('\n'); break;
                    case 't': sb.Append('\t'); break;
                    case 'r': sb.Append('\r'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u':
                        if (i + 4 < s.Length)
                        {
                            sb.Append((char)Convert.ToInt32(s.Substring(i + 1, 4), 16));
                            i += 4;
                        }
                        break;
                    default: sb.Append(n); break;
                }
            }
            return sb.ToString();
        }

        /// <summary>
        /// Every file that goes into Thornswood's folder when Vortex deploys
        /// into <paramref name="src"/>, each with where it is brought from.
        /// Anything that cannot be brought in is said in <paramref name="left"/>.
        ///
        /// When src is a Steam copy this is a walk of src that keeps only the
        /// three kinds of file (OnlyThree, #1232): Skyrim's own, Vortex's and
        /// Thornswood's. It used to be the whole walk, so a mod put into the
        /// Steam copy by hand came into Thornswood's folder.
        ///
        /// When it is not, NO BLEED. Patrick, 24 September, about a tester
        /// whose Vortex deploys into another server's copy of Skyrim: "can you
        /// make it so our launcher detcts and fixes this but doesnt have the
        /// servers bleed still". That folder holds the other server's own
        /// SkyrimSE.exe, script extender, dlls, ini files, client and whatever
        /// its installer put in Data, and none of it may reach Thornswood. So
        /// nothing is read out of src but Vortex's records, and the folder is
        /// made of exactly two things: the game from the Steam copy (Source),
        /// walked the same way the Steam copy always has been, and the files
        /// those records list, from Vortex's staging folder where they live.
        /// A record's file replaces the Steam copy's at the same path, which is
        /// what Vortex deploying into the Steam copy does. The result is what
        /// somebody whose Vortex deploys into the Steam copy gets.
        /// </summary>
        static List<Found> Gather(string src, List<string> left, List<Found> pinned, HashSet<string> ours, ref int byHand)
        {
            string game = GameFor(src);
            if (SameFolder(game, src))
            {
                // Only the three kinds (#1232): Skyrim's own by the pinned
                // build's list, Vortex's by its record, Thornswood's by its
                // records. A mod the person put into the Steam copy by hand is
                // theirs, for the Skyrim they play from Steam.
                HashSet<string> deployed = Deployed(src);
                List<Found> walked = OnlyThree(Walk(src), deployed, ours, left, ref byHand);
                if (pinned == null) return walked;
                // The Steam copy is on another build, so 1.6.1170's own files
                // take the place of its game files. Not of what Vortex deployed
                // there: the collection's files stay the collection's.
                var withPinned = new Dictionary<string, Found>(StringComparer.OrdinalIgnoreCase);
                foreach (Found f in walked) withPinned[f.Rel] = f;
                DropChangedGame(withPinned, game);
                Pin(withPinned, pinned, deployed);
                return new List<Found>(withPinned.Values);
            }

            // The game, and not an older deployment Vortex left in the Steam
            // copy before it moved: those files are its record there, if any.
            // Of the rest, Skyrim's own and Thornswood's, and never a mod put
            // into the Steam copy by hand (#1232).
            var byRel = new Dictionary<string, Found>(StringComparer.OrdinalIgnoreCase);
            HashSet<string> stale = Deployed(game);
            var notStale = new List<Found>();
            foreach (Found f in Walk(game))
            {
                if (stale.Contains(f.Rel)) { left.Add(f.Rel + "  (an older Vortex deployment in the Steam copy, not where Vortex deploys now)"); continue; }
                notStale.Add(f);
            }
            foreach (Found f in OnlyThree(notStale, null, ours, left, ref byHand)) byRel[f.Rel] = f;
            if (pinned != null) { DropChangedGame(byRel, game); Pin(byRel, pinned, null); }

            Record rec = Staged(src);
            left.AddRange(rec.Refused);
            foreach (KeyValuePair<string, string> kv in rec.From)
            {
                var f = new Found();
                f.Rel = kv.Key;
                f.From = kv.Value;
                try
                {
                    var fi = new FileInfo(kv.Value);
                    if (!fi.Exists)
                    {
                        left.Add(kv.Key + "  (Vortex's record lists it and its mods folder does not have it)");
                        continue;
                    }
                    f.Size = fi.Length;
                    f.Ticks = fi.LastWriteTimeUtc.Ticks;
                }
                catch
                {
                    left.Add(kv.Key + "  (Vortex's copy of it could not be read)");
                    continue;
                }
                byRel[f.Rel] = f;
            }
            return new List<Found>(byRel.Values);
        }

        /// <summary>
        /// A listed file that is not the pinned build's does not come from
        /// the Steam copy. Pin puts the Downgrade's copy of it in its place,
        /// and a changed master never reaches the folder.
        /// </summary>
        static void DropChangedGame(Dictionary<string, Found> byRel, string game)
        {
            SkyrimFiles();
            if (!skyrimPinsBytes) return;
            var drop = new List<string>();
            foreach (string rel in byRel.Keys)
                if (SkyrimOwn(rel) && !OneFilePinned(game, rel)) drop.Add(rel);
            foreach (string rel in drop) byRel.Remove(rel);
        }

        /// <summary>
        /// 1.6.1170's own files, <paramref name="pinned"/> (the Downgrade's
        /// download, or a folder that holds them, SkyrimFrom), over the game's
        /// files in <paramref name="byRel"/>. Each is copied (Found.Pinned):
        /// the download is removed once the folder is made, and another
        /// folder's file must never be this one's too (#2603). A path in
        /// <paramref name="keep"/> is the collection's and is left to it.
        /// </summary>
        static void Pin(Dictionary<string, Found> byRel, List<Found> pinned, HashSet<string> keep)
        {
            foreach (Found f in pinned)
            {
                if (keep != null && keep.Contains(f.Rel)) continue;
                f.Pinned = true;
                byRel[f.Rel] = f;
            }
        }

        /// <summary>
        /// Every file in the folders the Downgrade downloaded into, but its
        /// own markers (.thornswood...), or null when there are none.
        /// </summary>
        static List<Found> Downloads(List<string> dirs)
        {
            if (dirs == null) return null;
            var l = new List<Found>();
            foreach (string dir in dirs)
                foreach (Found f in Walk(dir))
                    if (!f.Rel.StartsWith(".thornswood", StringComparison.OrdinalIgnoreCase)) l.Add(f);
            return l;
        }

        /// <summary>
        /// <paramref name="all"/> with Thornswood's own files from
        /// Profile\Payload over it, when the own folder was chosen at install
        /// (#1226). The installer's payload is there instead of in the Steam
        /// copy, and so is whatever the launcher wrote before the folder
        /// existed (packs, Thornswood.ini, the client settings, the client
        /// runtime), because Paths.Game was Payload until now. Each takes the
        /// place of a file at the same path, the way the installer's copy
        /// into the Steam copy used to, and a pack's the way a pack does.
        /// </summary>
        static List<Found> WithPayload(List<Found> all)
        {
            if (string.IsNullOrEmpty(Paths.Payload) || !Directory.Exists(Paths.Payload)) return all;
            var byRel = new Dictionary<string, Found>(StringComparer.OrdinalIgnoreCase);
            foreach (Found f in all) byRel[f.Rel] = f;
            foreach (Found f in Walk(Paths.Payload))
            {
                f.Ours = true;
                byRel[f.Rel] = f;
            }
            return new List<Found>(byRel.Values);
        }

        /// <summary>
        /// Skip for a file Make brings in. Thornswood's own from Payload come
        /// from the build, so the client runtime among them is taken (it is
        /// left out only when it would come from the Steam copy), and the
        /// rest of Skip still applies: a session note or a log is not the
        /// folder's either way.
        /// </summary>
        static string SkipOf(Found f)
        {
            if (f.Ours && ClientFile(f.Rel)) return null;
            return Skip(f.Rel);
        }

        /// <summary>Whether Make copies a file rather than linking it. Payload's are linked, then Payload goes.</summary>
        static bool CopyOf(Found f, HashSet<string> deployed)
        {
            if (f.Ours) return false;
            return f.Pinned || MustCopy(f.Rel, deployed);
        }

        /// <summary>
        /// Removes Profile\Payload once the folder holds its files. Only names
        /// go: each file in it is also in Root\Game by a hard link, or was
        /// copied there. Null when it is gone or was never there, otherwise a
        /// sentence; what is left is removed at the next start
        /// (CleanSteamCopy), never read again.
        /// </summary>
        static string DropPayload()
        {
            string dir = Paths.Payload;
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return null;
            try
            {
                foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                    DropName(f);
                Directory.Delete(dir, true);
                return null;
            }
            catch (Exception ex)
            {
                Swallow.Note("OwnGame.DropPayload", ex);
                return "Some of " + dir + " could not be removed yet (" + ex.Message.TrimEnd('.') + "); the launcher removes the rest the next time it starts.";
            }
        }

        /// <summary>
        /// Every file Vortex's record in <paramref name="src"/> lists, each with
        /// where a refresh takes it from (FromVortex). This is all a refresh
        /// brings in once the folder is made (#1218): nothing of the Steam
        /// copy's own game is read, so the Steam copy can be on any build, and
        /// mods the person put into it by hand stay out of Thornswood.
        /// </summary>
        static List<Found> Vortex(string src, List<string> left, Scope scope, HashSet<string> failed)
        {
            bool apart = !SameFolder(GameFor(src), src);
            Record rec = Staged(src);
            foreach (string r in rec.Refused)
                if (InScope(LeftRel(r), scope)) left.Add(r);
            HashSet<string> deployed = Deployed(src);
            var l = new List<Found>();
            foreach (string rel in deployed)
            {
                // Outside what this refresh looks at (Scope: the paths the new
                // rules are about, the files whose entry in Vortex's record
                // moved): not read at all, and carried forward by the caller.
                if (!InScope(rel, scope)) continue;
                string from = FromVortex(src, rel, apart, rec, deployed);
                if (from == null)
                {
                    left.Add(rel + "  (Vortex's record lists it and its mods folder does not have it)");
                    failed.Add(rel);
                    continue;
                }
                try
                {
                    var fi = new FileInfo(from);
                    var f = new Found();
                    f.Rel = rel;
                    f.From = from;
                    f.Size = fi.Length;
                    f.Ticks = fi.LastWriteTimeUtc.Ticks;
                    l.Add(f);
                }
                catch (Exception ex)
                {
                    Swallow.Note("OwnGame.Vortex, reading " + from, ex);
                    left.Add(rel + "  (Vortex's copy of it could not be read)");
                    failed.Add(rel);
                }
            }
            return l;
        }

        class VortexRecord
        {
            [JsonInclude] public string stagingPath;
            [JsonInclude] public VortexFile[] files;
        }

        class VortexFile
        {
            [JsonInclude] public string relPath;
            [JsonInclude] public string source;
            // The file's time as Vortex deployed it, in milliseconds (#2210).
            // Read as whatever the record holds, so a record whose time is not
            // a plain number is not refused whole for it.
            [JsonInclude] public object time;
        }

        /// <summary>
        /// Vortex's deployment records for System.Text.Json, with the code
        /// made at build time (#4823). time comes back as a JsonElement, whose
        /// text is the number or string as the record has it, which is what
        /// the old serializer's boxed value printed as. Strings read loosely
        /// (LooseString).
        /// </summary>
        [JsonSourceGenerationOptions(Converters = new[] { typeof(LooseString) })]
        [JsonSerializable(typeof(VortexRecord))]
        partial class VortexJson : JsonSerializerContext { }

        /// <summary>What Vortex's records in a folder list, and where Vortex keeps each file.</summary>
        class Record
        {
            // Path under the game folder, the same one Deployed gives, to the
            // file in staging: stagingPath\source\relPath. Measured on
            // Patrick's machine on 24 September: all 29,964 files the two
            // records in the Steam copy list are at exactly that path.
            public Dictionary<string, string> From = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            // The same paths to "mod|time" as the record has them, which is
            // what a refresh compares with the last one (VortexMoved, #2210).
            public Dictionary<string, string> Entry = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public List<string> Staging = new List<string>();
            public List<string> Refused = new List<string>();
        }

        static readonly object recordLock = new object();
        static string recordKey;
        static Record recordCache;

        /// <summary>
        /// Vortex's records in <paramref name="src"/>, read in full. The one in
        /// Data is six megabytes on a full collection and takes about half a
        /// second to read, and the settings card asks WhyNot on the window's
        /// thread, so the answer is kept until Vortex deploys again.
        /// </summary>
        static Record Staged(string src)
        {
            string key = src + "|" + DeploymentStamp(src);
            lock (recordLock) { if (recordCache != null && recordKey == key) return recordCache; }

            var r = new Record();
            foreach (string[] where in new string[][] { new string[] { Path.Combine(src, "Data"), "Data\\" }, new string[] { src, "" } })
            {
                string[] files;
                try { files = Directory.GetFiles(where[0], "vortex.deployment*.json"); } catch { continue; }
                Array.Sort(files, StringComparer.OrdinalIgnoreCase);
                foreach (string f in files)
                {
                    VortexRecord doc = null;
                    try
                    {
                        using (var fs = File.OpenRead(f))
                            doc = JsonSerializer.Deserialize(fs, VortexJson.Default.VortexRecord);
                    }
                    catch { /* doc stays null, and the record is refused just below with a line saying so */ }
                    if (doc == null || doc.files == null || string.IsNullOrEmpty(doc.stagingPath))
                    {
                        r.Refused.Add(f.Substring(src.TrimEnd('\\').Length).TrimStart('\\') + "  (Vortex's record could not be read, so nothing it lists was brought in)");
                        continue;
                    }
                    // A mods folder that is the folder Vortex deploys into, or
                    // sits inside it, would bring that folder's own files in
                    // whenever the record listed them. Vortex does not accept a
                    // staging folder inside the game folder, so such a record
                    // was not written by it; refusing it keeps the no-bleed rule
                    // true for any record at all. Verification of hotfix 1.1.93.
                    if (Overlaps(doc.stagingPath, src))
                    {
                        r.Refused.Add(f.Substring(src.TrimEnd('\\').Length).TrimStart('\\') + "  (Vortex's record names a mods folder that overlaps " + src + ", so nothing it lists was brought in)");
                        continue;
                    }
                    bool listed = false;
                    foreach (string s in r.Staging) if (SameFolder(s, doc.stagingPath)) listed = true;
                    if (!listed) r.Staging.Add(doc.stagingPath);
                    // Each mod's folder in staging, worked out once per mod
                    // rather than once per file: thirty thousand entries.
                    var mods = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    foreach (VortexFile e in doc.files)
                    {
                        if (e == null || string.IsNullOrEmpty(e.relPath) || string.IsNullOrEmpty(e.source)) continue;
                        string under = e.relPath.Replace('/', '\\').TrimStart('\\');
                        string rel = where[1] + under;
                        string mod;
                        if (!mods.TryGetValue(e.source, out mod)) { mod = ModFolder(doc.stagingPath, e.source); mods[e.source] = mod; }
                        if (mod == null || !Tidy(under) || !Tidy(rel))
                        {
                            r.Refused.Add(rel + "  (Vortex's record points outside Thornswood's folder or Vortex's mods folder)");
                            continue;
                        }
                        if (!r.From.ContainsKey(rel))
                        {
                            r.From[rel] = mod + under;
                            r.Entry[rel] = e.source + "|" + Convert.ToString(e.time, System.Globalization.CultureInfo.InvariantCulture);
                        }
                    }
                }
            }
            lock (recordLock) { recordKey = key; recordCache = r; }
            return r;
        }

        /// <summary>
        /// The mod in Vortex that a plugin comes from, by Vortex's own record
        /// in the folder it deploys into: the plugin sits at the top of its
        /// mod's folder in Vortex's mods folder, and that folder carries the
        /// mod's name. Null when there is no record or it does not list the
        /// plugin. Scan and Fix name it for another author's plugin whose
        /// bytes are not the server's, which Fix has no copy of (#1180).
        /// </summary>
        public static string VortexModOf(Config cfg, string plugin)
        {
            string src = DeploysInto(cfg);
            if (src.Length == 0) return null;
            string from;
            if (!Staged(src).From.TryGetValue("Data\\" + plugin, out from) || string.IsNullOrEmpty(from)) return null;
            return Path.GetFileName(Path.GetDirectoryName(from));
        }

        /// <summary>
        /// stagingPath\source\ with a closing separator, or null when the mod's
        /// name would put it anywhere but directly inside staging. A file under
        /// it stays inside it as long as its own path is Tidy.
        /// </summary>
        static string ModFolder(string staging, string source)
        {
            try
            {
                if (source.IndexOfAny(new char[] { '\\', '/', ':' }) >= 0 || source.Trim('.', ' ').Length == 0) return null;
                string root = Path.GetFullPath(staging).TrimEnd('\\') + "\\";
                string mod = Path.GetFullPath(Path.Combine(staging, source)).TrimEnd('\\') + "\\";
                if (!mod.StartsWith(root, StringComparison.OrdinalIgnoreCase) || mod.Length <= root.Length) return null;
                return mod;
            }
            catch { return null; }
        }

        /// <summary>
        /// One folder is the other or holds it. Anything that cannot be
        /// worked out counts as overlapping, because refusing only means
        /// nothing is brought in from that record.
        /// </summary>
        static bool Overlaps(string a, string b)
        {
            try
            {
                string x = Path.GetFullPath(a).TrimEnd('\\') + "\\";
                string y = Path.GetFullPath(b).TrimEnd('\\') + "\\";
                return x.StartsWith(y, StringComparison.OrdinalIgnoreCase) || y.StartsWith(x, StringComparison.OrdinalIgnoreCase);
            }
            catch { return true; }
        }

        /// <summary>A path under the game folder that stays under it: no drive, no "..".</summary>
        static bool Tidy(string rel)
        {
            if (rel.Length == 0 || rel.IndexOf(':') >= 0 || rel.StartsWith("\\")) return false;
            foreach (string part in rel.Split('\\')) if (part == "..") return false;
            return true;
        }

        /// <summary>When Vortex last deployed, as the newest write time of its records.</summary>
        static long DeploymentStamp(string src)
        {
            long newest = 0;
            foreach (string dir in new string[] { src, Path.Combine(src, "Data") })
            {
                try
                {
                    foreach (string f in Directory.GetFiles(dir, "vortex.deployment*.json"))
                        newest = Math.Max(newest, File.GetLastWriteTimeUtc(f).Ticks);
                }
                catch (Exception ex) { Swallow.Note("OwnGame.DeploymentStamp", ex); }
            }
            return newest;
        }

        /// <summary>
        /// Sum of sizes for files this folder holds as its own copies (C lines
        /// in files.txt). Hard-linked Vortex files are left out on purpose so
        /// Installed apps does not show forty gigabytes of shared collection.
        /// </summary>
        static long SumCopied(List<string> lines)
        {
            long n = 0;
            foreach (string line in lines)
            {
                string[] p = line.Split(new char[] { '|' }, 5);
                if (p.Length < 3 || p[0] != "C") continue;
                long s;
                if (long.TryParse(p[2], out s)) n += s;
            }
            return n;
        }

        /// <summary>
        /// made.txt. kinds=1 when every file in the folder is one of the three
        /// kinds and on record as which (OwnGameKinds.cs), 0 when some from
        /// the Steam copy are still to sort or to take out.
        /// </summary>
        static void WriteMade(string src, long copied, int kinds)
        {
            WriteMade(src, copied, kinds, RecordedText("skyrim"));
        }

        /// <summary>
        /// made.txt, with skyrim= naming the folder the game's own files were
        /// copied from when Make was given one (#2603). A refresh keeps the
        /// line as it is, because a refresh never takes the game's own files
        /// again; Make writes it or leaves it out.
        /// </summary>
        static void WriteMade(string src, long copied, int kinds, string skyrimFrom)
        {
            var lines = new List<string> {
                "source=" + src,
                "game=" + GameFor(src),
            };
            if (!string.IsNullOrEmpty(skyrimFrom)) lines.Add("skyrim=" + skyrimFrom);
            lines.Add("deployment=" + DeploymentStamp(src));
            lines.Add("rules=" + Rules);
            lines.Add("kinds=" + kinds);
            lines.Add("copied=" + copied);
            lines.Add("at=" + DateTime.Now.ToString("o"));
            WriteRecord(MadeFile, lines);
        }

        /// <summary>A text value from made.txt, such as source, or "".</summary>
        static string RecordedText(string key)
        {
            try
            {
                if (!File.Exists(MadeFile)) return "";
                foreach (string line in File.ReadAllLines(MadeFile))
                    if (line.StartsWith(key + "=", StringComparison.Ordinal)) return line.Substring(key.Length + 1).Trim();
            }
            catch (Exception ex) { Swallow.Note("OwnGame.RecordedText, reading made.txt", ex); }
            return "";
        }

        static long Recorded(string key)
        {
            try
            {
                foreach (string line in File.ReadAllLines(MadeFile))
                {
                    if (!line.StartsWith(key + "=", StringComparison.Ordinal)) continue;
                    long v;
                    if (long.TryParse(line.Substring(key.Length + 1), out v)) return v;
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.Recorded, reading stamp", ex); }
            return -1;
        }

        static Dictionary<string, Rec> ReadFiles()
        {
            var d = new Dictionary<string, Rec>(StringComparer.OrdinalIgnoreCase);
            try
            {
                foreach (string line in File.ReadAllLines(FilesList))
                {
                    string[] p = line.Split(new char[] { '|' }, 5);
                    if (p.Length < 5 || p[0].Length != 1 || p[1].Length != 1) continue;
                    var r = new Rec();
                    r.Kind = p[0][0];
                    r.Origin = p[1][0];
                    long.TryParse(p[2], out r.Size);
                    long.TryParse(p[3], out r.Ticks);
                    d[p[4]] = r;
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.ReadFiles", ex); }
            return d;
        }

        /// <summary>
        /// Files a Thornswood update, the installer or GeneratedBuild put into
        /// the game, which a refresh leaves as they are. What the installer laid
        /// down that Vortex also deploys stays Vortex's, so collection updates
        /// still reach it.
        /// </summary>
        static HashSet<string> Owned(HashSet<string> deployed)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            // A record that cannot be read used to end this loop and be
            // swallowed, so the files the rest of the records name were not
            // Thornswood's, and a refresh put Vortex's copy back over them.
            // The caller stops and says why instead (#1249). Ours already
            // reads these the same way, without a catch.
            if (Directory.Exists(Paths.PacksDir))
            {
                string[] recs;
                try { recs = Directory.GetFiles(Paths.PacksDir, "*.files"); }
                catch (Exception ex)
                {
                    throw new Exception("Could not read the pack lists in " + Paths.PacksDir +
                        " (" + ex.Message.TrimEnd('.') + "). Nothing was changed. Close whatever has that folder open and try again.");
                }
                foreach (string rec in recs)
                {
                    string[] lines;
                    try { lines = File.ReadAllLines(rec); }
                    catch (Exception ex)
                    {
                        throw new Exception("Could not read " + Path.GetFileName(rec) +
                            ", a pack's list of the files it put into the game (" +
                            ex.Message.TrimEnd('.') + "). Nothing was changed. Close whatever has that list open and try again.");
                    }
                    foreach (string line in lines)
                    {
                        int bar = line.IndexOf('|');
                        if (bar < 0) continue;
                        string rel = line.Substring(bar + 1);
                        if (rel.StartsWith("game\\", StringComparison.OrdinalIgnoreCase)) set.Add(rel.Substring(5));
                    }
                }
            }
            try { foreach (string rel in Keep.Held()) set.Add(rel); } catch (Exception ex) { Swallow.Note("OwnGame.Owned, Keep.Held", ex); }
            try
            {
                string list = Path.Combine(Paths.ProfileDir, "installed-into-game.txt");
                if (File.Exists(list))
                    foreach (string line in File.ReadAllLines(list))
                    {
                        string rel = line.Trim();
                        if (rel.Length > 0 && !deployed.Contains(rel)) set.Add(rel);
                    }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.Owned, installed-into-game list", ex); }
            // What Build-Generated made in this folder (#1247), Vortex's name
            // or not: a refresh leaves it as built. Read without a catch: one
            // missed would be put back to Vortex's without a word.
            foreach (string rel in GeneratedFiles()) set.Add(rel);
            // What the launcher makes from the game before every Play (#2827),
            // which no pack names any more.
            foreach (string rel in MadeInGame) set.Add(rel);
            return set;
        }

        /// <summary>Plugins switched on in the list this build shipped with.</summary>
        static List<string> ShippedPlugins()
        {
            var l = new List<string>();
            try
            {
                string golden = Path.Combine(Paths.Golden, "plugins.txt");
                if (!File.Exists(golden)) return l;
                foreach (string raw in File.ReadAllLines(golden))
                {
                    string s = raw.Trim();
                    if (s.StartsWith("*") && s.Length > 1) l.Add(s.Substring(1));
                }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.ShippedPlugins, reading plugins.txt", ex); }
            return l;
        }

        // ------------------------------------------------------------ disk

        /// <summary>Every file under <paramref name="root"/>, without following links to folders.</summary>
        static List<Found> Walk(string root)
        {
            var l = new List<Found>();
            string fence = root.TrimEnd('\\') + "\\";
            var stack = new Stack<string>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                string dir = stack.Pop();
                try
                {
                    foreach (string sub in Directory.GetDirectories(dir))
                    {
                        try
                        {
                            if ((new DirectoryInfo(sub).Attributes & FileAttributes.ReparsePoint) != 0) continue;
                        }
                        catch { continue; }
                        stack.Push(sub);
                    }
                }
                catch (Exception ex) { Swallow.Note("OwnGame.Walk, directories", ex); }
                try
                {
                    foreach (string f in Directory.GetFiles(dir))
                    {
                        try
                        {
                            var fi = new FileInfo(f);
                            var found = new Found();
                            found.From = f;
                            found.Rel = f.Substring(fence.Length);
                            found.Size = fi.Length;
                            found.Ticks = fi.LastWriteTimeUtc.Ticks;
                            l.Add(found);
                        }
                        catch (Exception ex) { Swallow.Note("OwnGame.Walk, file info", ex); }
                    }
                }
                catch (Exception ex) { Swallow.Note("OwnGame.Walk, files", ex); }
            }
            return l;
        }

        static bool SameFolder(string a, string b)
        {
            try { return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        static string Volume(string p)
        {
            try { return Path.GetPathRoot(Path.GetFullPath(p)).TrimEnd('\\'); } catch { return p; }
        }

        static bool SameVolume(string a, string b)
        {
            return string.Equals(Volume(a), Volume(b), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// WhyNot's answer when the folder would have to link across two
        /// drives: which drive each side is on, and the two things that put
        /// them on one.
        ///
        /// The links stay. A hard link is the same file under a second name and
        /// Windows will not make one across volumes, so this is a real refusal
        /// and not a message that could be argued out of; whether the launcher
        /// may copy instead, at the 26 to 41 GB measured in a built folder on
        /// 24 September, is the team's call and not this method's. What it stops
        /// is ending the road. Both ways out are somebody else's screen, so
        /// each is named down to the drive letter, the path it lands in and the
        /// buttons to press.
        ///
        /// One sentence, no line breaks: the same string goes to a MessageBox,
        /// to the card in Settings, to the one line status strip on the Play
        /// page and to Profile\launcher.log, which is one entry to a line.
        /// </summary>
        /// <param name="where">Where the other side is, "Skyrim is in D:\SteamLibrary\...".</param>
        /// <param name="theirs">The drive that side is on, "D:".</param>
        /// <param name="move">The second way out: moving that side to Thornswood's drive.</param>
        static string OneDriveOnly(string where, string theirs, string move)
        {
            string here = Volume(Paths.Root);
            return where + ", on " + theirs + ", and Thornswood is in " + Paths.Root + ", on " + here +
                   ". A hard link is the same file under a second name, and Windows cannot make one across two drives, " +
                   "so the folder cannot be made while they are apart. Either of these puts them on one drive. " +
                   "Install Thornswood on " + theirs + " by running Thornswood-Setup.exe again, the one from the " +
                   "Downloads page, letting it replace the launcher already installed, and choosing " + theirs +
                   " when Thornswood's install window asks where to put it, which installs it in " +
                   theirs + "\\Thornswood. Or " + move + ".";
        }

        static long FreeSpace(string p)
        {
            try { return new DriveInfo(Volume(p)).AvailableFreeSpace; } catch { return -1; }
        }

        static string Mb(long bytes)
        {
            return (bytes / 1024.0 / 1024.0).ToString("n0") + " MB";
        }
    }
}
