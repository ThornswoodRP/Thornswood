using System;
using System.IO;
using System.Text;
using Microsoft.Win32;

namespace Thornswood
{
    /// <summary>
    /// Where Steam and its copies of Skyrim Special Edition are.
    ///
    /// It also read which Steam account was signed in (Id), written so a
    /// character could be found again once profiles.txt was lost. Nothing
    /// ever called it, and since #5938 the site keeps each Discord account's
    /// characters, so it went.
    /// </summary>
    static class Steam
    {
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
