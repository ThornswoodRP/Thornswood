using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using System.Security.Cryptography;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// Keeping the shortcut showing the icon it is supposed to show.
    ///
    /// Windows draws a shortcut's icon once and then remembers the picture
    /// against the place it came from. Every build used to point the shortcut
    /// at the launcher exe's own first icon, so that address never changed and
    /// neither did the remembered picture. New artwork could sit inside the exe for a week
    /// while the desktop went on showing the old one, and a reboot does not
    /// clear it, which is what makes people think the update did not arrive.
    ///
    /// So the artwork gets its own file, named after a hash of itself. New
    /// artwork means a new name means an address Windows has never drawn
    /// before, and it has nothing cached to show instead. Unchanged artwork
    /// keeps the same name and nothing happens at all.
    ///
    /// The icon travels inside the exe as a resource, so the update that
    /// replaces the launcher brings its own, the same way the emblem does.
    ///
    /// The name under the icon and the label that appears when you hover come
    /// from the shortcut file rather than from the program, so this fixes
    /// those too. A shortcut still carrying an old name goes on saying so
    /// forever otherwise, and the pinned taskbar copy is its own file in its
    /// own folder that no build script was ever looking at.
    ///
    /// Shortcuts are read and written through the shell's own ShellLink
    /// object (Link, below), the object WScript.Shell's CreateShortcut wraps.
    /// This went through WScript.Shell by late binding until the move to
    /// native code (#4823), which cannot call a COM object by name.
    /// </summary>
    static partial class Icons
    {
        const int SHCNE_ASSOCCHANGED = 0x08000000;
        const int SHCNE_UPDATEITEM = 0x00002000;
        const int SHCNE_DELETE = 0x00000004;
        const uint SHCNF_IDLIST = 0x0000;
        const uint SHCNF_PATHW = 0x0005;
        const uint SHCNF_FLUSH = 0x1000;

        [LibraryImport("shell32.dll")]
        private static partial void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);

        // Same entry point, path form: telling Explorer about one .lnk is what
        // makes a blank shortcut redraw without clearing the whole icon cache.
        [LibraryImport("shell32.dll", EntryPoint = "SHChangeNotify", StringMarshalling = StringMarshalling.Utf16)]
        private static partial void SHChangeNotifyPath(int eventId, uint flags, string item1, string item2);

        /// <summary>
        /// The running launcher, wherever it is and whatever it is called.
        /// Asking the process means the shortcut points at the one that is
        /// actually there.
        /// </summary>
        static string LauncherExe
        {
            get { return Environment.ProcessPath; }
        }

        /// <summary>
        /// Writes the icon out beside the launcher under a name that changes
        /// only when the artwork does. Returns the path, or null when this
        /// build carries no icon resource and the exe has to do. The menu
        /// music's Volume Mixer entry shows the same file (MenuMusic.cs).
        /// </summary>
        internal static string IconFile()
        {
            try
            {
                string pick;
                byte[] bytes = IconBytes(out pick);
                if (bytes == null) return null;
                string hash = Hash(bytes);

                if (!Directory.Exists(Paths.LauncherDir)) return null;
                string want = Path.Combine(Paths.LauncherDir, "icon-" + hash + ".ico");
                if (!File.Exists(want) || new FileInfo(want).Length != bytes.Length)
                {
                    File.WriteAllBytes(want, bytes);
                    // The shortcuts may have been drawn while it was gone, and
                    // Windows keeps that blank against this same name (#887).
                    iconWritten = true;
                }
                return want;
            }
            catch { return null; }
        }

        static bool iconWritten;

        /// <summary>
        /// True in the dev build. Set by the shell from the config, as
        /// BuildName is, so the shortcuts' icon is chosen here and not by the
        /// window's art (Art.cs, which is Avalonia's). The ship root tool
        /// builds this file without the window (#4823).
        /// </summary>
        public static bool Dev;

        /// <summary>
        /// The artwork this build's shortcuts show, out of the exe, or null
        /// when it carries none. The dev build's shortcuts get the dev icon,
        /// app-dev.ico; the main build keeps app.ico. A dev build without it
        /// uses app.ico.
        /// </summary>
        static byte[] IconBytes(out string pick)
        {
            pick = null;
            Assembly asm = typeof(Icons).Assembly;
            if (Dev)
                foreach (string n in asm.GetManifestResourceNames())
                    if (n.EndsWith("app-dev.ico", StringComparison.OrdinalIgnoreCase)) { pick = n; break; }
            if (pick == null)
                foreach (string n in asm.GetManifestResourceNames())
                    if (n.EndsWith("app.ico", StringComparison.OrdinalIgnoreCase)) { pick = n; break; }
            if (pick == null) return null;
            using (Stream st = asm.GetManifestResourceStream(pick))
            {
                if (st == null) return null;
                var ms = new MemoryStream();
                st.CopyTo(ms);
                byte[] bytes = ms.ToArray();
                return bytes.Length == 0 ? null : bytes;
            }
        }

        /// <summary>The first eight hex digits of the artwork's SHA-256, which name its file.</summary>
        static string Hash(byte[] bytes)
        {
            using (SHA256 sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(bytes), 0, 4).Replace("-", "").ToLowerInvariant();
        }

        /// <summary>
        /// Whether the shortcuts need redrawing even where IconLocation already
        /// reads right, issue #887. An update, a rebuild or a Ship puts a new
        /// exe where the old one was, and Install-Launcher used to delete
        /// the icon file the Start menu and pinned shortcuts name; Windows then
        /// drew them blank and kept that. So Profile\icons.stamp remembers the
        /// icon and the exe (size, write time) of the last redraw, and a start
        /// where either differs, or where the icon file had to be written
        /// again, redraws. An ordinary start matches and stays quiet.
        /// </summary>
        static bool Due(string exe, string want, bool wrote)
        {
            if (wrote) return true;
            try
            {
                string stamp = Path.Combine(Paths.ProfileDir, "icons.stamp");
                if (!File.Exists(stamp)) return true;
                return !string.Equals(File.ReadAllText(stamp).Trim(), Mark(exe, want), StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception ex) { Swallow.Note("Icons.Due", ex); return true; }
        }

        static void Remember(string exe, string want)
        {
            try
            {
                if (Directory.Exists(Paths.ProfileDir))
                    File.WriteAllText(Path.Combine(Paths.ProfileDir, "icons.stamp"), Mark(exe, want));
            }
            catch (Exception ex) { Swallow.Note("Icons.Remember", ex); }
        }

        static string Mark(string exe, string want)
        {
            var fi = new FileInfo(exe);
            return want + "|" + (fi.Exists ? fi.Length + "|" + fi.LastWriteTimeUtc.Ticks : "none");
        }

        static void Sweep(string keep)
        {
            try
            {
                foreach (string f in Directory.GetFiles(Paths.LauncherDir, "icon-*.ico"))
                    if (!string.Equals(f, keep, StringComparison.OrdinalIgnoreCase))
                        try { File.Delete(f); } catch (Exception ex) { Swallow.Note("Icons.Sweep, delete", ex); }
            }
            catch (Exception ex) { Swallow.Note("Icons.Sweep", ex); }
        }

        class Place
        {
            public string Dir;
            public bool MayRename;      // false where the file name is load bearing
            public bool MakeIfMissing;  // a place the build wants a shortcut in, put back when it is gone
            public Place(string d, bool r) : this(d, r, r) { }
            public Place(string d, bool r, bool m) { Dir = d; MayRename = r; MakeIfMissing = m; }
        }

        /// <summary>
        /// Where a shortcut to this launcher might be. Renaming is fine on the
        /// desktop and in the install folder. It is not fine for a pinned
        /// taskbar item: Windows ties the pin to that exact file, so renaming
        /// or replacing it unpins the launcher and the person has to pin it
        /// again after every update. Those get their icon and their label
        /// fixed in place and nothing else.
        /// </summary>
        static List<Place> Places()
        {
            var l = new List<Place>();
            try { l.Add(new Place(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), true)); } catch (Exception ex) { Swallow.Note("Icons.Places, desktop", ex); }
            try { l.Add(new Place(Paths.Root, true)); } catch (Exception ex) { Swallow.Note("Icons.Places, root", ex); }
            try
            {
                string app = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                l.Add(new Place(Path.Combine(app, "Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"), false));
                // The Start menu gets one made for it if it has none. Typing
                // "Thornswood" into Start should find the launcher, and tools
                // that only know a program by its Start menu entry (screen
                // sharing and remote control among them) cannot see it
                // otherwise. Still never renamed: a Start menu tile can be
                // pinned, and a pin dies with the file it points at.
                l.Add(new Place(Path.Combine(app, "Microsoft\\Windows\\Start Menu\\Programs"), false, true));
            }
            catch (Exception ex) { Swallow.Note("Icons.Places, start menu", ex); }
            return l;
        }

        /// <summary>
        /// Points every shortcut that runs this launcher at the current icon.
        /// Returns how many it had to change, so a start that changed nothing
        /// can stay quiet. Never throws and never restarts anything.
        ///
        /// Pass force after an update to the launcher (Velo.Restarted): Windows
        /// can blank the cached picture for a shortcut even when IconLocation
        /// still names the right file, and a quiet Ensure then skips the
        /// notify that would redraw it. Force
        /// rewrites the same IconLocation, tells Explorer about each .lnk, and
        /// asks ie4uinit to refresh, without killing Explorer (Repair still does
        /// that from Settings when somebody needs the heavy pass). Ensure also
        /// forces itself when the exe or the icon changed since the last pass
        /// (Due), which covers an update, a rebuild or a Ship.
        /// </summary>
        public static int Ensure()
        {
            return Ensure(false);
        }

        /// <summary>See <see cref="Ensure()"/>.</summary>
        public static int Ensure(bool force)
        {
            iconWritten = false;
            string icon = IconFile();
            string exe = LauncherExe;
            string want = (icon == null ? exe : icon) + ",0";

            // A launcher that changed since the last pass (an update, a
            // rebuild, a Ship), which is when blank icons show up: the stamp
            // says so.
            if (!force && Due(exe, want, iconWritten)) force = true;

            int changed = 0;
            var touchedLinks = new List<string>();
            bool forced = force;
            try
            {
                OnSta(delegate
                {
                    foreach (Place spot in Places())
                    {
                        string place = spot.Dir;
                        if (string.IsNullOrEmpty(place) || !Directory.Exists(place)) continue;
                        string[] links;
                        try { links = Directory.GetFiles(place, "*.lnk"); }
                        catch (Exception ex) { Swallow.Note("Icons.Ensure, listing " + place, ex); continue; }
                        bool found = false;

                        foreach (string lnk in links)
                        {
                            try
                            {
                                using (Link sc = Link.Open(lnk))
                                {
                                    string target = sc.Target;
                                    // The multiplayer client carries the same file name
                                    // as the launcher, so this has to match the whole
                                    // path or a shortcut to the game gets an icon that
                                    // is not the game's.
                                    if (string.IsNullOrEmpty(target)) continue;
                                    if (!string.Equals(Full(target), Full(exe),
                                                       StringComparison.OrdinalIgnoreCase)) continue;

                                    // Wrong file name, which is where an old name
                                    // survives: the label under a shortcut and the one
                                    // that appears on hover are the file name, not
                                    // anything inside the program.
                                    found = true;
                                    if (spot.MayRename &&
                                        !string.Equals(Path.GetFileName(lnk), Name,
                                                       StringComparison.OrdinalIgnoreCase))
                                    {
                                        string dest = Path.Combine(place, Name);
                                        if (File.Exists(dest))
                                        {
                                            // The right one is already sitting beside
                                            // it, so this is the leftover.
                                            if (Kill(lnk)) changed++;
                                        }
                                        else if (Rename(sc, dest, want))
                                        {
                                            Kill(lnk);
                                            touchedLinks.Add(dest);
                                            changed++;
                                        }
                                        continue;
                                    }

                                    bool touched = false;
                                    string now = sc.IconLocation;
                                    // Force rewrites even when the string matches: the
                                    // .lnk timestamp and a shell notify are what clear a
                                    // blank cache entry after an update replaced the exe.
                                    if (forced || !string.Equals(now, want, StringComparison.OrdinalIgnoreCase))
                                    {
                                        sc.IconLocation = want;
                                        touched = true;
                                    }

                                    if (!string.Equals(sc.Description, Label, StringComparison.Ordinal))
                                    {
                                        sc.Description = Label;
                                        touched = true;
                                    }

                                    if (touched)
                                    {
                                        sc.Save(lnk);
                                        touchedLinks.Add(lnk);
                                        changed++;
                                    }
                                }
                            }
                            catch (Exception ex) { Swallow.Note("Icons.Ensure, shortcut", ex); }
                        }

                        // A desktop that has lost its shortcut gets it back, and
                        // the Start menu gets one it never had. Only the places
                        // the build wants one in; never the taskbar pins.
                        if (!found && spot.MakeIfMissing && File.Exists(exe))
                        {
                            string made = Path.Combine(place, Name);
                            if (Make(made, exe, want))
                            {
                                touchedLinks.Add(made);
                                changed++;
                            }
                        }
                    }
                });
                // Every shortcut has been walked, so the next start with the
                // same exe and icon can stay quiet.
                Remember(exe, want);
            }
            catch (Exception ex) { Swallow.Note("Icons.Ensure", ex); }

            if (icon != null) Sweep(icon);

            if (changed > 0 || force)
            {
                // The icon file first, since Windows keeps the picture against
                // its path, then one .lnk at a time: ASSOCCHANGED alone leaves
                // blank shortcut icons after an update on some machines.
                if (icon != null)
                    try { SHChangeNotifyPath(SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH, icon, null); } catch (Exception ex) { Swallow.Note("Icons.Ensure, notify icon file", ex); }
                foreach (string lnk in touchedLinks)
                    try { SHChangeNotifyPath(SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH, lnk, null); } catch { /* shell notify is best-effort */ }
                try { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero); } catch { /* shell notify is best-effort */ }
                // Same soft ask Install-Launcher uses before it ever kills Explorer.
                AskIconCache();
            }
            return changed;
        }

        /// <summary>
        /// What Ensure would change, said and not done (#2627): each shortcut
        /// to this launcher that names another icon or another label or has
        /// an old name, the desktop or the Start menu without one, the icon
        /// file not written yet, and a launcher that changed since the
        /// shortcuts were last redrawn (Due). Empty when Ensure would find
        /// nothing to do. Scan asks this; Fix then runs Ensure. Never writes
        /// and never throws.
        /// </summary>
        public static List<string> OutOfDate()
        {
            var l = new List<string>();
            string exe = LauncherExe;
            string icon = null;
            try
            {
                string pick;
                byte[] bytes = IconBytes(out pick);
                if (bytes != null && Directory.Exists(Paths.LauncherDir))
                {
                    icon = Path.Combine(Paths.LauncherDir, "icon-" + Hash(bytes) + ".ico");
                    if (!File.Exists(icon) || new FileInfo(icon).Length != bytes.Length) l.Add("the icon file " + Path.GetFileName(icon) + " is not beside the launcher");
                }
            }
            catch (Exception ex) { Swallow.Note("Icons.OutOfDate, the icon file", ex); }
            string want = (icon == null ? exe : icon) + ",0";
            if (l.Count == 0 && Due(exe, want, false)) l.Add("the launcher changed since the shortcuts were last redrawn");

            try
            {
                OnSta(delegate
                {
                    foreach (Place spot in Places())
                    {
                        string place = spot.Dir;
                        if (string.IsNullOrEmpty(place) || !Directory.Exists(place)) continue;
                        string[] links;
                        try { links = Directory.GetFiles(place, "*.lnk"); }
                        catch (Exception ex) { Swallow.Note("Icons.OutOfDate, listing " + place, ex); continue; }
                        bool found = false;
                        foreach (string lnk in links)
                        {
                            try
                            {
                                using (Link sc = Link.Open(lnk))
                                {
                                    string target = sc.Target;
                                    if (string.IsNullOrEmpty(target) || !string.Equals(Full(target), Full(exe), StringComparison.OrdinalIgnoreCase)) continue;
                                    found = true;
                                    if (spot.MayRename && !string.Equals(Path.GetFileName(lnk), Name, StringComparison.OrdinalIgnoreCase))
                                    {
                                        l.Add(lnk + " has an old name");
                                        continue;
                                    }
                                    string now = sc.IconLocation;
                                    string desc = sc.Description;
                                    if (!string.Equals(now, want, StringComparison.OrdinalIgnoreCase)) l.Add(lnk + " shows another icon");
                                    else if (!string.Equals(desc, Label, StringComparison.Ordinal)) l.Add(lnk + " has another label");
                                }
                            }
                            catch (Exception ex) { Swallow.Note("Icons.OutOfDate, shortcut", ex); }
                        }
                        if (!found && spot.MakeIfMissing && File.Exists(exe)) l.Add(Path.Combine(place, Name) + " is missing");
                    }
                });
            }
            catch (Exception ex) { Swallow.Note("Icons.OutOfDate", ex); }
            return l;
        }

        /// <summary>
        /// The heavy pass, for the Settings button. Repoints the shortcuts as
        /// above, then throws away the pictures Windows has remembered and
        /// restarts Explorer so it draws them again. The desktop and taskbar
        /// vanish for a second. Returns a line to show the person.
        /// </summary>
        public static string Repair()
        {
            int changed = Ensure(true);

            int gone = 0;
            bool restarted = false;
            try
            {
                Run("taskkill", "/f /im explorer.exe", 8000);

                string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                var targets = new List<string>();
                targets.Add(Path.Combine(local, "IconCache.db"));
                try
                {
                    string dir = Path.Combine(local, "Microsoft\\Windows\\Explorer");
                    if (Directory.Exists(dir))
                        targets.AddRange(Directory.GetFiles(dir, "iconcache_*.db"));
                }
                catch (Exception ex) { Swallow.Note("Icons.Repair, list cache", ex); }

                foreach (string f in targets)
                    try { if (File.Exists(f)) { File.Delete(f); gone++; } } catch (Exception ex) { Swallow.Note("Icons.Repair, delete cache", ex); }
            }
            catch (Exception ex) { Swallow.Note("Icons.Repair", ex); }
            finally
            {
                try { Process.Start("explorer.exe"); restarted = true; } catch (Exception ex) { Swallow.Note("Icons.Repair, restart explorer", ex); }
            }

            try { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero); } catch (Exception ex) { Swallow.Note("Icons.Repair, notify", ex); }

            string said = "Shortcut icon refreshed";
            if (changed > 0) said += ", " + changed + (changed == 1 ? " shortcut repointed" : " shortcuts repointed");
            if (gone > 0) said += ", " + gone + " cached copies thrown away";
            if (!restarted) said += ". Explorer did not come back on its own, press Ctrl Shift Esc, File, Run explorer.exe";
            else said += ".";
            if (changed == 0 && gone == 0)
                said = "Nothing needed changing. If a pinned taskbar item is still wrong, unpin it and pin it again: Windows keeps its own note of what was pinned and that is the only thing out here that cannot reach it.";
            return said;
        }

        /// <summary>Set by the shell from the config: "Thornswood" or "Thornswood Dev".</summary>
        public static string BuildName = "Thornswood";
        static string Name  { get { return BuildName + ".lnk"; } }
        static string Label { get { return BuildName == "Thornswood" ? "ThornsWood" : BuildName; } }

        /// <summary>
        /// Every shortcut that runs this exe, whatever it is called: the
        /// desktop (the person's and the shared one), the install folder, the
        /// Start menu and the pinned taskbar copy. What an uninstall or a dev
        /// build removal deletes.
        ///
        /// Issue #3205: removal used to delete Thornswood.lnk on the desktop
        /// and in the Start menu by name and nothing else. The pinned copy
        /// stayed behind pointing at an exe that was gone, still holding the
        /// name, and the next time the launcher was pinned Windows found
        /// Thornswood.lnk taken and called the new pin "Thornswood (2)", which
        /// is the name the taskbar shows on hover. Asking by name also took
        /// the main build's shortcuts when it was the dev build being removed.
        /// So this asks each shortcut what it runs, the same whole-path match
        /// Ensure makes. Never throws.
        /// </summary>
        public static List<string> ShortcutsTo(string exe)
        {
            var l = new List<string>();
            if (string.IsNullOrEmpty(exe)) return l;
            var dirs = new List<string>();
            foreach (Place spot in Places()) dirs.Add(spot.Dir);
            try { dirs.Add(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)); } catch (Exception ex) { Swallow.Note("Icons.ShortcutsTo, shared desktop", ex); }

            try
            {
                OnSta(delegate
                {
                    foreach (string place in dirs)
                    {
                        if (string.IsNullOrEmpty(place) || !Directory.Exists(place)) continue;
                        string[] links;
                        try { links = Directory.GetFiles(place, "*.lnk"); }
                        catch (Exception ex) { Swallow.Note("Icons.ShortcutsTo, listing " + place, ex); continue; }
                        foreach (string lnk in links)
                        {
                            try
                            {
                                using (Link sc = Link.Open(lnk))
                                {
                                    string target = sc.Target;
                                    if (!string.IsNullOrEmpty(target) && string.Equals(Full(target), Full(exe), StringComparison.OrdinalIgnoreCase)
                                        && !l.Contains(lnk))
                                        l.Add(lnk);
                                }
                            }
                            catch (Exception ex) { Swallow.Note("Icons.ShortcutsTo, shortcut", ex); }
                        }
                    }
                });
            }
            catch (Exception ex) { Swallow.Note("Icons.ShortcutsTo", ex); }
            return l;
        }

        /// <summary>
        /// Deletes every shortcut that runs this exe (ShortcutsTo) and tells
        /// Explorer each one is gone, so a pin leaves the taskbar with its
        /// file. Returns how many went.
        /// </summary>
        public static int Drop(string exe)
        {
            int gone = 0;
            foreach (string lnk in ShortcutsTo(exe))
            {
                try { File.Delete(lnk); gone++; }
                catch (Exception ex) { Swallow.Note("Icons.Drop, delete", ex); continue; }
                try { SHChangeNotifyPath(SHCNE_DELETE, SHCNF_PATHW | SHCNF_FLUSH, lnk, null); } catch (Exception ex) { Swallow.Note("Icons.Drop, notify", ex); }
            }
            return gone;
        }

        /// <summary>The launcher this one is, for Uninstall.</summary>
        public static string Exe { get { return LauncherExe; } }

        static string Full(string p)
        {
            try { return Path.GetFullPath(p); } catch { return p; }
        }

        static bool Kill(string path)
        {
            try { File.Delete(path); return true; } catch { return false; }
        }

        /// <summary>
        /// Writes the same shortcut out under the right name. A shortcut cannot
        /// be renamed through the shell object, so the properties are read off
        /// the old one and written to a new one beside it.
        /// </summary>
        static bool Rename(Link src, string dest, string icon)
        {
            try
            {
                string target = src.Target, args = src.Arguments, wd = src.WorkingDirectory;
                using (Link made = Link.New())
                {
                    made.Target = target;
                    made.Arguments = args ?? "";
                    made.WorkingDirectory = wd ?? "";
                    made.IconLocation = icon;
                    made.Description = Label;
                    made.Save(dest);
                }
                return true;
            }
            catch (Exception ex) { Swallow.Note("Icons.Rename", ex); return false; }
        }

        static bool Make(string dest, string exe, string icon)
        {
            try
            {
                using (Link made = Link.New())
                {
                    made.Target = exe;
                    made.Arguments = "";
                    made.WorkingDirectory = Path.GetDirectoryName(exe);
                    made.IconLocation = icon;
                    made.Description = Label;
                    made.Save(dest);
                }
                return true;
            }
            catch (Exception ex) { Swallow.Note("Icons.Make", ex); return false; }
        }

        /// <summary>
        /// Runs the work on a thread of its own in a single threaded apartment,
        /// which the shell's ShellLink object wants, whatever thread asked, and
        /// waits for it. What the work throws is thrown here.
        /// </summary>
        static void OnSta(Action work)
        {
            Exception failed = null;
            var t = new Thread(delegate()
            {
                try { work(); }
                catch (Exception ex) { failed = ex; }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join();
            if (failed != null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Throw(failed);
        }

        /// <summary>
        /// One shortcut file, through the shell's ShellLink object, with the
        /// five things WScript.Shell's shortcut object gave this class:
        /// TargetPath, Arguments, WorkingDirectory, Description and
        /// IconLocation ("file,index"). The interfaces are InstallShortcut's,
        /// generated for native code. Used on OnSta's thread only.
        /// </summary>
        sealed partial class Link : IDisposable
        {
            static readonly Guid ShellLinkClass = new Guid("00021401-0000-0000-C000-000000000046");
            static readonly StrategyBasedComWrappers Wrappers = new StrategyBasedComWrappers();
            // Long enough for any path Windows will hand back.
            const int Chars = 32768;

            readonly object com;
            readonly InstallShortcut.IShellLinkW link;

            Link(object com)
            {
                this.com = com;
                link = (InstallShortcut.IShellLinkW)com;
            }

            /// <summary>A new, empty shortcut, written with Save.</summary>
            public static Link New()
            {
                Guid clsid = ShellLinkClass, iid = typeof(InstallShortcut.IShellLinkW).GUID;
                int hr = CoCreateInstance(in clsid, IntPtr.Zero, ClsctxInprocServer, in iid, out IntPtr unknown);
                if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                try { return new Link(Wrappers.GetOrCreateObjectForComInstance(unknown, CreateObjectFlags.UniqueInstance)); }
                finally { Marshal.Release(unknown); }
            }

            /// <summary>The shortcut file at lnk, read.</summary>
            public static Link Open(string lnk)
            {
                Link l = New();
                try { ((InstallShortcut.IPersistFile)l.com).Load(lnk, 0); }
                catch { l.Dispose(); throw; }
                return l;
            }

            public string Target
            {
                get { return Read(delegate(IntPtr b) { link.GetPath(b, Chars, IntPtr.Zero, 0); }); }
                set { link.SetPath(value); }
            }

            public string Arguments
            {
                get { return Read(delegate(IntPtr b) { link.GetArguments(b, Chars); }); }
                set { link.SetArguments(value); }
            }

            public string WorkingDirectory
            {
                get { return Read(delegate(IntPtr b) { link.GetWorkingDirectory(b, Chars); }); }
                set { link.SetWorkingDirectory(value); }
            }

            public string Description
            {
                get { return Read(delegate(IntPtr b) { link.GetDescription(b, Chars); }); }
                set { link.SetDescription(value); }
            }

            /// <summary>"file,index", as WScript.Shell wrote and read it.</summary>
            public string IconLocation
            {
                get
                {
                    int index = 0;
                    string file = Read(delegate(IntPtr b) { link.GetIconLocation(b, Chars, out index); });
                    return file + "," + index;
                }
                set
                {
                    string file = value ?? "";
                    int index = 0;
                    int comma = file.LastIndexOf(',');
                    if (comma >= 0 && int.TryParse(file.Substring(comma + 1).Trim(), out index)) file = file.Substring(0, comma);
                    else index = 0;
                    link.SetIconLocation(file, index);
                }
            }

            /// <summary>Writes the shortcut to lnk.</summary>
            public void Save(string lnk)
            {
                ((InstallShortcut.IPersistFile)com).Save(lnk, true);
            }

            static string Read(Action<IntPtr> into)
            {
                IntPtr b = Marshal.AllocHGlobal(Chars * 2);
                try
                {
                    Marshal.WriteInt16(b, 0);
                    into(b);
                    return Marshal.PtrToStringUni(b) ?? "";
                }
                finally { Marshal.FreeHGlobal(b); }
            }

            public void Dispose()
            {
                // The shell object goes now, not whenever the collector runs:
                // a shortcut left open stays locked against the rename.
                ((ComObject)com).FinalRelease();
            }

            const uint ClsctxInprocServer = 0x1;

            [LibraryImport("ole32.dll")]
            private static partial int CoCreateInstance(in Guid clsid, IntPtr outer, uint context, in Guid iid, out IntPtr obj);
        }

        /// <summary>
        /// Asks Windows to rebuild what it has drawn for icons, without killing
        /// Explorer. Matches Install-Launcher.ps1's soft pass.
        /// </summary>
        static void AskIconCache()
        {
            try
            {
                string ie4 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "ie4uinit.exe");
                if (!File.Exists(ie4)) return;
                Run(ie4, "-show", 8000);
            }
            catch { /* ie4uinit missing or refused: Ensure already notified each .lnk */ }
        }

        static void Run(string file, string args, int waitMs)
        {
            try
            {
                var psi = new ProcessStartInfo(file, args);
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process p = Process.Start(psi);
                if (p != null) p.WaitForExit(waitMs);
            }
            catch (Exception ex) { Swallow.Note("Icons.Run", ex); }
        }
    }
}
