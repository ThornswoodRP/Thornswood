using System;
using System.IO;
using System.Text;
using Microsoft.Win32;

namespace Thornswood
{
    /// <summary>
    /// Which Steam account is playing.
    ///
    /// This exists so that a character can be found again. A character under
    /// SkyMP lives on the server as a change form keyed by a profile id, and
    /// that id used to exist in exactly one place on earth: profiles.txt in
    /// this install's Profile folder. Reinstall, or sit down at another
    /// computer, and the file is gone, the launcher rolls a new random id, the
    /// server has never seen it, and you make a new character while your real
    /// one stays on the server with nothing left that knows its number.
    ///
    /// Steam is the one thing about a person that survives all of that. They
    /// own the game through it, so it is already installed, already signed in,
    /// and the same on any machine they play on. Nothing to remember, nothing
    /// to type, nothing to lose.
    ///
    /// Two ways to read it, because neither is enough alone. ActiveUser is the
    /// account Steam is signed into right now and is empty when Steam is
    /// closed. loginusers.vdf is written to disk and survives Steam being
    /// closed, but on a machine with two accounts it can only say which was
    /// used last. Live first, file second.
    /// </summary>
    static class Steam
    {
        // SteamID3 counts from here. Steam's own registry value and the
        // account folder names are the offset part; the 17 digit number people
        // see everywhere is this plus that.
        const long Base = 76561197960265728L;

        static string cached;

        /// <summary>The signed in account's 17 digit id, or "" if it cannot be read.</summary>
        public static string Id()
        {
            if (cached != null) return cached;
            cached = "";
            try { cached = FromRegistry(); } catch (Exception ex) { Swallow.Note("Steam.Id, FromRegistry", ex); }
            if (cached.Length == 0) { try { cached = FromLoginUsers(); } catch (Exception ex) { Swallow.Note("Steam.Id, FromLoginUsers", ex); } }
            return cached;
        }

        /// <summary>
        /// Where Steam is, instead of asking the registry. Only
        /// launcher\tests\test-vortex-folder.ps1 sets it, to a pretend Steam in a
        /// scratch folder, so the search for Vortex's folder can be run
        /// against libraries it made. The launcher leaves it null.
        /// </summary>
        public static string RootForTest;

        /// <summary>Where Steam is installed, or "" .</summary>
        public static string Path_()
        {
            if (RootForTest != null) return RootForTest;
            foreach (string key in new string[] {
                @"Software\Valve\Steam", @"Software\Wow6432Node\Valve\Steam" })
            {
                try
                {
                    using (RegistryKey k = Registry.CurrentUser.OpenSubKey(key))
                    {
                        if (k == null) continue;
                        object v = k.GetValue("SteamPath");
                        if (v == null) continue;
                        string p = Convert.ToString(v).Replace('/', '\\');
                        if (p.Length > 0 && Directory.Exists(p)) return p;
                    }
                }
                catch (Exception ex) { Swallow.Note("Steam.Path_, CurrentUser registry", ex); }
            }
            try
            {
                using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Wow6432Node\Valve\Steam"))
                {
                    if (k != null)
                    {
                        object v = k.GetValue("InstallPath");
                        if (v != null)
                        {
                            string p = Convert.ToString(v);
                            if (p.Length > 0 && Directory.Exists(p)) return p;
                        }
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Steam.Path_, LocalMachine registry", ex); }
            return "";
        }

        // The account Steam is signed into at this moment. Zero when Steam is
        // not running, which is why this is not the only source.
        static string FromRegistry()
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam\ActiveProcess"))
            {
                if (k == null) return "";
                object v = k.GetValue("ActiveUser");
                if (v == null) return "";
                long account = Convert.ToInt64(v);
                if (account <= 0) return "";
                return (Base + account).ToString();
            }
        }

        /// <summary>
        /// Where Skyrim Special Edition is installed, or "".
        ///
        /// Not always under Steam's own folder. Anybody with a second drive
        /// has library folders, and Steam lists them in
        /// config\libraryfolders.vdf. Every library holds its games under
        /// steamapps\common, so each one is tried and the first with the
        /// executable in it wins. The executable rather than the folder,
        /// because an uninstall leaves the folder behind with the saves and
        /// screenshots still in it.
        /// </summary>
        public static string SkyrimPath()
        {
            System.Collections.Generic.List<string> copies = SkyrimCopies();
            return copies.Count > 0 ? copies[0] : "";
        }

        /// <summary>
        /// Every Steam library on this machine: Steam's own folder first, then
        /// each path in config\libraryfolders.vdf, in the order Steam lists
        /// them. The same list SkyrimPath has always searched.
        /// </summary>
        public static System.Collections.Generic.List<string> Libraries()
        {
            string root = Path_();

            var roots = new System.Collections.Generic.List<string>();
            if (root.Length > 0) roots.Add(root);

            try
            {
                if (root.Length > 0)
                {
                    string vdf = System.IO.Path.Combine(root, "config\\libraryfolders.vdf");
                    if (File.Exists(vdf))
                    {
                        foreach (string raw in File.ReadAllLines(vdf))
                        {
                            string[] parts = Quoted(raw.Trim());
                            if (parts.Length < 2) continue;
                            if (parts[0].ToLowerInvariant() != "path") continue;
                            // Valve escapes the separator in this file.
                            string p = parts[1].Replace("\\\\", "\\");
                            if (p.Length > 0) roots.Add(p);
                        }
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Steam.Libraries, reading libraryfolders.vdf", ex); }
            return roots;
        }

        /// <summary>
        /// Every Steam copy of Skyrim Special Edition on this machine, in the
        /// order SkyrimPath tries them, so the first is its answer. Somebody
        /// with two libraries can have two.
        /// </summary>
        public static System.Collections.Generic.List<string> SkyrimCopies()
        {
            const string tail = "steamapps\\common\\Skyrim Special Edition";
            var copies = new System.Collections.Generic.List<string>();
            foreach (string r in Libraries())
            {
                try
                {
                    string g = System.IO.Path.Combine(r, tail);
                    if (!File.Exists(System.IO.Path.Combine(g, "SkyrimSE.exe"))) continue;
                    bool seen = false;
                    foreach (string c in copies) if (Same(c, g)) seen = true;
                    if (!seen) copies.Add(g);
                }
                catch (Exception ex) { Swallow.Note("Steam.SkyrimCopies, checking one library", ex); }
            }
            return copies;
        }

        /// <summary>
        /// True when <paramref name="path"/> is one of Steam's own copies of
        /// Skyrim Special Edition. Anything else, another server's copy of the
        /// game above all, is never where Thornswood takes the game itself
        /// from (OwnGame.Source).
        /// </summary>
        public static bool IsSkyrimCopy(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            foreach (string c in SkyrimCopies()) if (Same(c, path)) return true;
            return false;
        }

        static bool Same(string a, string b)
        {
            try
            {
                return string.Equals(System.IO.Path.GetFullPath(a).TrimEnd('\\'),
                                     System.IO.Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        /// <summary>
        /// The last account to sign in on this machine, from Steam's own file.
        ///
        /// The format is Valve's key value text: a 17 digit id, then a braced
        /// block of quoted pairs. Parsed by hand rather than properly, because
        /// the only two fields that matter here are MostRecent and Timestamp
        /// and a real VDF parser is a lot of code to answer one question.
        /// </summary>
        static string FromLoginUsers()
        {
            string root = Path_();
            if (root.Length == 0) return "";
            string file = System.IO.Path.Combine(root, "config\\loginusers.vdf");
            if (!File.Exists(file)) return "";

            string[] lines = File.ReadAllLines(file);

            string current = "";
            string best = "";
            long bestStamp = -1;
            bool recent = false;
            long stamp = 0;

            foreach (string raw in lines)
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;

                if (line == "}")
                {
                    if (current.Length > 0)
                    {
                        // MostRecent wins outright. Otherwise keep whoever
                        // signed in last, so a machine with two accounts still
                        // answers with the one in front of you.
                        if (recent) return current;
                        if (stamp > bestStamp) { bestStamp = stamp; best = current; }
                    }
                    current = "";
                    recent = false;
                    stamp = 0;
                    continue;
                }

                string[] parts = Quoted(line);
                if (parts.Length == 1 && IsId(parts[0])) { current = parts[0]; continue; }
                if (parts.Length < 2 || current.Length == 0) continue;

                string key = parts[0].ToLowerInvariant();
                if (key == "mostrecent" && parts[1] == "1") recent = true;
                else if (key == "timestamp") long.TryParse(parts[1], out stamp);
            }

            return best;
        }

        static bool IsId(string s)
        {
            if (s == null || s.Length < 15 || s.Length > 20) return false;
            foreach (char c in s) if (c < '0' || c > '9') return false;
            return true;
        }

        // Everything between pairs of double quotes on one line.
        static string[] Quoted(string line)
        {
            var found = new System.Collections.Generic.List<string>();
            var sb = new StringBuilder();
            bool inside = false;
            foreach (char c in line)
            {
                if (c == '"')
                {
                    if (inside) { found.Add(sb.ToString()); sb.Length = 0; }
                    inside = !inside;
                    continue;
                }
                if (inside) sb.Append(c);
            }
            return found.ToArray();
        }
    }
}
