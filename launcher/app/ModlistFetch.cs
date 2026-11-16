// ModlistFetch.cs
//
// What the modlist install (ModlistInstall.cs, #6244) needs from outside the
// launcher, fetched from GitHub only: 7-Zip, which unpacks the archives the
// framework cannot (7z and RAR, Mod Organizer 2's own among them), and every
// archive the modlist downloads by address, which is Mod Organizer 2 from its
// GitHub release.
//
// 7-ZIP is pinned here, in the signed launcher: 7zr.exe and the x64 installer
// of 7-Zip 25.01 from its own GitHub release (ip7z/7zip, tag 25.01), each held
// to the size and sha256 below. 7zr unpacks 7z.exe and 7z.dll out of the
// installer, which is a 7z archive, and those two are held to theirs; nothing
// is installed into Windows and nothing else is kept. The sha256s were read
// on 16 Nov 2026 from those files on GitHub; the installer is the same bytes
// as 7-zip.org's (7zr.exe there is a later build, so GitHub's is the one
// pinned). 7z.dll carries the RAR codec, which 14 of the collection's
// archives need (scripts\release\Get-SevenZip.ps1 says what was measured).
//
// AN ARCHIVE BY ADDRESS has to be a file of a GitHub Release
// (https://github.com/<owner>/<repo>/releases/download/<tag>/<name>, which is
// what CollectionModlist.Read takes), and is fetched through GitHub's API like
// every other file the launcher reads from GitHub (GitHub.cs: api.github.com
// answered on 9 Nov 2026 while github.com's download addresses did not). It
// is held to GitHub's sha256, then to the size and xxHash64 the modlist names,
// before it takes its name in downloads. The modlist is the signed record's
// part, so that is the hash that decides.
//
// AN ARCHIVE ALREADY ON THIS PC is taken before anything is downloaded
// (FromPlaces): Vortex has downloaded these same Nexus files for the
// collection into its own downloads folder, and a person may have one in their
// Downloads folder. Any file there of the archive's size is held to the
// modlist's xxHash64, whatever its name, and only then taken: linked out of
// Vortex's folder (copied when it is on another drive), so Vortex keeps its
// own, and moved out of the person's Downloads. Install holds every archive
// to its hash again before it unpacks one.
//
// A NEXUS FILE DOWNLOADED BY HAND (ByHand), as a free Nexus account does:
// the launcher opens that file's page on Nexus, the person presses Manual
// Download there, and the file is taken from their Downloads folder the same
// way once it lands, then the next page opens. No nxm:// handler is taken
// over, so a person's own Vortex or Mod Organizer keeps it.
//
// The game is not touched here, and nothing runs from what is fetched but
// 7-Zip.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;

namespace Thornswood
{
    static class SevenZip
    {
        /// <summary>One pinned file: its name, size and sha256.</summary>
        internal sealed class Pin
        {
            public string Name;
            public long Size;
            public string Sha256;
        }

        internal const string Repo = "ip7z/7zip";
        internal const string Tag = "25.01";
        internal const string Folder = "7zip-25.01";

        // The two files fetched, and the two kept. Not readonly, so a harness
        // can pin its own stand-ins; nothing in the launcher writes them.
        internal static Pin Unpacker = new Pin { Name = "7zr.exe", Size = 601088, Sha256 = "27cbe3d5804ad09e90bbcaa916da0d5c3b0be9462d0e0fb6cb54be5ed9030875" };
        internal static Pin Installer = new Pin { Name = "7z2501-x64.exe", Size = 1643509, Sha256 = "78afa2a1c773caf3cf7edf62f857d2a8a5da55fb0fff5da416074c0d28b2b55f" };
        internal static Pin[] Kept =
        {
            new Pin { Name = "7z.exe", Size = 575488, Sha256 = "4cd7d776c686427226a151789d2d61f0b2ed2c392148cc4e69c0238362fafecf" },
            new Pin { Name = "7z.dll", Size = 1906176, Sha256 = "5bd20fb38499d95c39594f41d4781b6181b3304b7f1f4d06b0182f514e7eaa74" },
        };

        /// <summary>
        /// Runs a program with its arguments and waits: its exit code, and
        /// what it wrote to stderr. A harness puts a runner of its own here.
        /// </summary>
        internal static Func<string, IList<string>, Tuple<int, string>> Run = RunProcess;

        static Tuple<int, string> RunProcess(string exe, IList<string> args)
        {
            var psi = new ProcessStartInfo(exe)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (string a in args) psi.ArgumentList.Add(a);
            using (Process p = Process.Start(psi))
            {
                // Both read at once, so neither pipe fills and stops it.
                var err = p.StandardError.ReadToEndAsync();
                p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                return Tuple.Create(p.ExitCode, err.GetAwaiter().GetResult());
            }
        }

        static bool Holds(string file, Pin pin)
        {
            if (!File.Exists(file) || new FileInfo(file).Length != pin.Size) return false;
            using (FileStream fs = File.OpenRead(file)) return Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant() == pin.Sha256;
        }

        /// <summary>
        /// 7z.exe in <paramref name="tools"/>\7zip-25.01, put there from
        /// 7-Zip's GitHub release when it and 7z.dll are not there as pinned.
        /// Throws ModlistStop with the reason, and keeps nothing it did not
        /// hold to its pin.
        /// </summary>
        public static string Ensure(string tools, Action<string> say)
        {
            string dir = Path.Combine(tools, Folder);
            string exe = Path.Combine(dir, Kept[0].Name);
            if (Kept.All(k => Holds(Path.Combine(dir, k.Name), k))) return exe;

            string work = Path.Combine(tools, Folder + ".fetch");
            if (Directory.Exists(work)) Directory.Delete(work, true);
            Directory.CreateDirectory(work);
            try
            {
                if (say != null) say("Downloading 7-Zip " + Tag + " from its GitHub release");
                GitHub.Release r;
                try { r = GitHub.TagOf(Repo, Tag); }
                catch (Exception ex) { throw new ModlistStop("7-Zip " + Tag + " could not be read from GitHub: " + Failure.Why("SevenZip.Ensure, read the Release", ex) + "."); }
                foreach (Pin pin in new[] { Unpacker, Installer })
                {
                    GitHub.Asset a = r.File(pin.Name);
                    if (a == null) throw new ModlistStop("7-Zip's Release " + Tag + " on GitHub has no " + pin.Name + ".");
                    string to = Path.Combine(work, pin.Name);
                    try { GitHub.SaveTo(Repo, a, to, null); }
                    catch (Exception ex) { throw new ModlistStop(pin.Name + " could not be downloaded from 7-Zip's GitHub release: " + Failure.Why("SevenZip.Ensure, download " + pin.Name, ex, to) + "."); }
                    if (!Holds(to, pin)) throw new ModlistStop(pin.Name + " from 7-Zip's GitHub release is not the file the launcher pins, so it was not used.");
                }
                string into = Path.Combine(work, "out");
                var args = new List<string> { "x", "-y", "-bso0", "-bsp0", "-o" + into, Path.Combine(work, Installer.Name) };
                foreach (Pin k in Kept) args.Add(k.Name);
                Tuple<int, string> ran = Run(Path.Combine(work, Unpacker.Name), args);
                if (ran.Item1 != 0) throw new ModlistStop("7zr could not take 7-Zip out of its installer (exit " + ran.Item1 + "): " + ran.Item2.Trim());
                foreach (Pin k in Kept)
                    if (!Holds(Path.Combine(into, k.Name), k)) throw new ModlistStop(k.Name + " in 7-Zip's installer is not the file the launcher pins, so it was not used.");
                Directory.CreateDirectory(dir);
                foreach (Pin k in Kept) File.Move(Path.Combine(into, k.Name), Path.Combine(dir, k.Name), true);
                return exe;
            }
            finally { if (Directory.Exists(work)) Directory.Delete(work, true); }
        }

        /// <summary>The modlist install's unpacker through this 7z.exe: every archive kind 7-Zip reads.</summary>
        public static ModlistInstall.Unpack With(string exe)
        {
            return delegate (string archive, string into)
            {
                Tuple<int, string> ran = Run(exe, new List<string> { "x", "-y", "-bso0", "-bsp0", "-o" + into, "--", archive });
                if (ran.Item1 != 0) throw new ModlistStop("7-Zip could not unpack " + Path.GetFileName(archive) + " (exit " + ran.Item1 + "): " + ran.Item2.Trim());
            };
        }
    }

    static partial class ModlistFetch
    {
        static readonly Regex ReleaseFile = new Regex(@"^https://github\.com/([A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100})/releases/download/([A-Za-z0-9._-]{1,200})/([A-Za-z0-9._%-]{1,200})$");

        /// <summary>
        /// Downloads the modlist's archive <paramref name="a"/>, one it gets by
        /// address, into <paramref name="downloads"/> under its own name: from
        /// the GitHub Release its address names, through GitHub's API, held to
        /// GitHub's sha256 and then to the modlist's size and xxHash64. Throws
        /// ModlistStop with the reason, and leaves nothing under the name when
        /// it did not hold.
        /// </summary>
        public static void ByAddress(ModlistArchive a, string downloads, Action<long> onBytes)
        {
            if (a == null || a.Kind != "http") throw new ModlistStop("Only an archive the modlist gets by address is downloaded here.");
            Match m = ReleaseFile.Match(a.Url ?? "");
            if (!m.Success) throw new ModlistStop("The modlist would download " + a.Name + " from " + a.Url + ", which is not a file of a Release on GitHub.");
            string repo = m.Groups[1].Value, tag = m.Groups[2].Value, name = Uri.UnescapeDataString(m.Groups[3].Value);
            GitHub.Release r;
            try { r = GitHub.TagOf(repo, tag); }
            catch (Exception ex) { throw new ModlistStop(a.Say() + " could not be read from GitHub: " + Failure.Why("ModlistFetch.ByAddress, read " + repo + " " + tag, ex) + "."); }
            GitHub.Asset x = r.File(name);
            if (x == null) throw new ModlistStop("The Release " + tag + " of " + repo + " on GitHub has no " + name + ", which the modlist downloads as " + a.Name + ".");
            if (x.Size != a.Size) throw new ModlistStop(name + " in the Release " + tag + " of " + repo + " is " + x.Size + " bytes, and the modlist names " + a.Size + ".");
            Directory.CreateDirectory(downloads);
            string to = Path.Combine(downloads, a.Name);
            string got = to + ".got";
            try
            {
                try { GitHub.SaveTo(repo, x, got, onBytes); }
                catch (Exception ex) { throw new ModlistStop(a.Say() + " could not be downloaded: " + Failure.Why("ModlistFetch.ByAddress, download " + a.Name, ex, got) + "."); }
                if (new FileInfo(got).Length != a.Size || XxHash64.OfFile(got) != a.Hash)
                    throw new ModlistStop(a.Say() + " arrived, and is not the file the modlist names, so it was not kept.");
                File.Move(got, to, true);
            }
            finally { if (File.Exists(got)) File.Delete(got); }
        }

        /// <summary>A folder where this PC may already hold archives of the modlist.</summary>
        public sealed class Place
        {
            public string Folder;
            /// <summary>
            /// True for the person's own Downloads, where a file is moved out.
            /// False for another manager's downloads (Vortex's), which keeps its
            /// own: the file is linked, or copied when it is on another drive.
            /// </summary>
            public bool Move;
        }

        // A file looked at once: its size and time when it was hashed, so a
        // look again (ByHand looks every second) hashes only what changed.
        sealed class Seen
        {
            public long Size;
            public DateTime Written;
            public ulong Hash;
        }

        /// <summary>
        /// Takes every archive of <paramref name="missing"/> that is already in
        /// one of <paramref name="places"/> (the folder itself, not below it,
        /// under any name) into <paramref name="downloads"/> under its own name:
        /// only a file of the archive's size whose xxHash64 is the modlist's.
        /// Returns the ones still missing, in their order.
        /// </summary>
        public static List<ModlistArchive> FromPlaces(IList<ModlistArchive> missing, IList<Place> places, string downloads, Action<string> say)
        {
            return FromPlaces(missing, places, downloads, say, new Dictionary<string, Seen>());
        }

        static List<ModlistArchive> FromPlaces(IList<ModlistArchive> missing, IList<Place> places, string downloads, Action<string> say, Dictionary<string, Seen> seen)
        {
            var left = new List<ModlistArchive>(missing);
            foreach (Place p in places)
            {
                if (left.Count == 0) break;
                if (string.IsNullOrEmpty(p.Folder) || !Directory.Exists(p.Folder)) continue;
                var bySize = new Dictionary<long, List<FileInfo>>();
                try
                {
                    foreach (FileInfo f in new DirectoryInfo(p.Folder).EnumerateFiles())
                    {
                        List<FileInfo> l;
                        if (!bySize.TryGetValue(f.Length, out l)) bySize[f.Length] = l = new List<FileInfo>();
                        l.Add(f);
                    }
                }
                catch (Exception ex)
                {
                    // A folder this account cannot list holds nothing to take;
                    // the archive is downloaded instead.
                    Swallow.Note("ModlistFetch.FromPlaces, list " + p.Folder, ex);
                    continue;
                }
                foreach (ModlistArchive a in left.ToList())
                {
                    List<FileInfo> files;
                    if (!bySize.TryGetValue(a.Size, out files)) continue;
                    FileInfo hit = files.OrderBy(f => f.Name == a.Name ? 0 : 1).FirstOrDefault(f => HashOf(f, seen) == a.Hash);
                    if (hit == null) continue;
                    Take(a, hit.FullName, p.Move, downloads);
                    files.Remove(hit);
                    left.Remove(a);
                    if (say != null) say((p.Move ? "Took " : "Found ") + a.Say() + " in " + p.Folder);
                }
            }
            return left;
        }

        // The file's xxHash64, or none when it cannot be read now (a browser
        // may still hold it), and it is looked at again next time.
        static ulong? HashOf(FileInfo f, Dictionary<string, Seen> seen)
        {
            Seen s;
            if (seen.TryGetValue(f.FullName, out s) && s.Size == f.Length && s.Written == f.LastWriteTimeUtc) return s.Hash;
            ulong h;
            try { h = XxHash64.OfFile(f.FullName); }
            catch (Exception ex)
            {
                Swallow.Note("ModlistFetch.HashOf, read " + f.FullName, ex);
                return null;
            }
            seen[f.FullName] = new Seen { Size = f.Length, Written = f.LastWriteTimeUtc, Hash = h };
            return h;
        }

        static void Take(ModlistArchive a, string from, bool move, string downloads)
        {
            Directory.CreateDirectory(downloads);
            string to = Path.Combine(downloads, a.Name);
            string got = to + ".got";
            try
            {
                if (File.Exists(got)) File.Delete(got);
                if (move) File.Move(from, got);
                else if (!(OperatingSystem.IsWindows() && CreateHardLink(got, from, IntPtr.Zero))) File.Copy(from, got);
                File.Move(got, to, true);
            }
            catch (Exception ex) { throw new ModlistStop(a.Say() + " is on this PC at " + from + ", and could not be taken into " + downloads + ": " + Failure.Why("ModlistFetch.Take, " + a.Name, ex, to) + "."); }
            finally { if (File.Exists(got)) File.Delete(got); }
        }

        [LibraryImport("kernel32.dll", EntryPoint = "CreateHardLinkW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

        [LibraryImport("shell32.dll")]
        private static partial int SHGetKnownFolderPath(in Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);

        // FOLDERID_Downloads.
        static readonly Guid DownloadsFolder = new Guid("374DE290-123F-4565-9164-39C4925E467B");

        /// <summary>The person's own Downloads folder, where Windows says it is.</summary>
        public static string MyDownloads()
        {
            IntPtr p;
            int hr = SHGetKnownFolderPath(DownloadsFolder, 0, IntPtr.Zero, out p);
            try
            {
                if (hr != 0) throw new ModlistStop("Windows did not say where your Downloads folder is (" + hr.ToString("X8") + ").");
                return Marshal.PtrToStringUni(p);
            }
            finally { Marshal.FreeCoTaskMem(p); }
        }

        /// <summary>
        /// The folders where Vortex keeps Skyrim Special Edition's downloads,
        /// worked out as Vortex works them out (getDownloadPath.ts): its setting,
        /// or {USERDATA}\downloads when it has none, with {USERDATA} and
        /// {USERNAME} put in (any case), the game's id joined on, and a
        /// relative one taken from Vortex's own folder. Its default folder is
        /// in the list too, for an install whose setting moved after it
        /// downloaded. Every file found there is held to its hash, so a folder
        /// that is not Vortex's only finds nothing.
        /// </summary>
        public static List<string> VortexDownloads(string setting, string userData, string userName)
        {
            var folders = new List<string>();
            foreach (string pattern in new[] { setting, null })
            {
                string p = string.IsNullOrEmpty(pattern) ? Path.Combine("{USERDATA}", "downloads") : pattern;
                p = Regex.Replace(p, @"\{userdata\}", userData.Replace("$", "$$"), RegexOptions.IgnoreCase);
                p = Regex.Replace(p, @"\{username\}", userName.Replace("$", "$$"), RegexOptions.IgnoreCase);
                p = Path.Combine(p, "skyrimse");
                if (!Path.IsPathFullyQualified(p)) p = Path.GetFullPath(Path.Combine(userData, p));
                if (!folders.Contains(p, StringComparer.OrdinalIgnoreCase)) folders.Add(p);
            }
            return folders;
        }

        /// <summary>
        /// Where this PC may hold the modlist's archives: Vortex's downloads,
        /// then the person's own Downloads.
        /// </summary>
        public static List<Place> Places()
        {
            var places = new List<Place>();
            string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vortex");
            string setting = null;
            string state = Path.Combine(userData, "state.v2");
            if (Directory.Exists(state))
            {
                try { setting = VortexProfileState.DownloadsSetting(state); }
                catch (Exception ex) { Swallow.Note("ModlistFetch.Places, read Vortex's download folder setting", ex); }
            }
            foreach (string f in VortexDownloads(setting, userData, Environment.UserName)) places.Add(new Place { Folder = f, Move = false });
            places.Add(new Place { Folder = MyDownloads(), Move = true });
            return places;
        }

        /// <summary>The page on Nexus with the Manual Download button for one file.</summary>
        public static string Page(ModlistArchive a)
        {
            return "https://www.nexusmods.com/skyrimspecialedition/mods/" + a.ModId + "?tab=files&file_id=" + a.FileId;
        }

        /// <summary>
        /// The Nexus files of <paramref name="missing"/>, downloaded by hand:
        /// opens the page of the first one still missing through
        /// <paramref name="open"/>, takes each that lands in
        /// <paramref name="folder"/> (any of them, in any order), and opens the
        /// next, until every one is here or <paramref name="stop"/> says so.
        /// Returns the ones still missing.
        /// </summary>
        public static List<ModlistArchive> ByHand(IList<ModlistArchive> missing, string folder, string downloads, Action<string> open, Action<string> say, Func<bool> stop, int everyMs)
        {
            foreach (ModlistArchive a in missing)
                if (a.Kind != "nexus") throw new ModlistStop(a.Say() + " is not a Nexus file, so it is not downloaded by hand.");
            var seen = new Dictionary<string, Seen>();
            var places = new[] { new Place { Folder = folder, Move = true } };
            List<ModlistArchive> left = FromPlaces(missing, places, downloads, say, seen);
            string opened = null;
            while (left.Count > 0 && !stop())
            {
                string page = Page(left[0]);
                if (page != opened)
                {
                    if (say != null) say("Press Manual Download on Nexus for " + left[0].Say() + "; it is taken from " + folder + " when it lands (" + left.Count + " to go)");
                    open(page);
                    opened = page;
                }
                Thread.Sleep(everyMs);
                left = FromPlaces(left, places, downloads, say, seen);
            }
            return left;
        }
    }
}
