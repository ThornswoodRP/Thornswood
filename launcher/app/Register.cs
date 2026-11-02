using System;
using System.IO;
using System.Reflection;
using Microsoft.Win32;

namespace Thornswood
{
    /// <summary>
    /// Puts Thornswood in Windows Settings, under Installed apps.
    ///
    /// It was never there, and the reason had nothing to do with how the
    /// launcher is compiled or how the installer is packaged. Windows lists
    /// whatever is registered under the Uninstall key and nothing here had ever
    /// written one. An MSI would appear in that list because MSI writes this
    /// key; a hand written installer appears for exactly the same reason.
    ///
    /// Written by the launcher rather than by the installer, on purpose:
    ///
    ///   - It fixes every install that already exists, on the next launch,
    ///     instead of only the ones made from here on.
    ///   - The launcher knows its own version, and rewriting the entry each
    ///     time keeps DisplayVersion honest as the launcher updates itself.
    ///     An installer writes the version it shipped with and then goes stale.
    ///   - The dev build is a second install in its own folder, and it gets its
    ///     own entry under its own name rather than fighting over one.
    ///
    /// HKEY_CURRENT_USER, because the launcher does not run as administrator
    /// and should not start. A per user entry is what Windows expects from a
    /// per user install and it shows up in the same list.
    /// </summary>
    public static class Register
    {
        const string Root = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";

        /// <summary>
        /// One key per install folder, so the main build and the dev build do
        /// not overwrite each other's entry and uninstalling one leaves the
        /// other listed. The folder is what makes an install distinct.
        /// </summary>
        static string KeyName()
        {
            string root = "";
            try { root = Paths.Root; }
            catch (Exception ex) { Swallow.Note("Register.KeyName, Paths.Root", ex); }
            if (string.IsNullOrEmpty(root)) return "Thornswood";

            // A short stable hash of the folder, the same shape MutexName uses.
            uint h = 2166136261;
            foreach (char c in root.TrimEnd('\\').ToLowerInvariant())
            {
                h ^= c;
                h *= 16777619;
            }
            return "Thornswood-" + h.ToString("x8");
        }

        static string Exe()
        {
            // The exe's own path; Assembly.Location is empty in a native build.
            return Environment.ProcessPath ?? "";
        }

        static string Version()
        {
            try
            {
                Version v = Assembly.GetExecutingAssembly().GetName().Version;
                if (v != null) return v.ToString();
            }
            catch (Exception ex) { Swallow.Note("Register.Version", ex); }
            return "";
        }

        /// <summary>
        /// Writes the entry, or brings it up to date. Never throws: being
        /// absent from a list is not worth stopping a launch over.
        /// </summary>
        public static void Ensure(Config cfg)
        {
            try
            {
                string exe = Exe();
                if (exe.Length == 0 || !File.Exists(exe)) return;

                string name = (cfg != null) ? cfg.BuildName : "Thornswood";
                string root = Paths.Root;

                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Root + "\\" + KeyName()))
                {
                    if (k == null) return;

                    k.SetValue("DisplayName", name);
                    k.SetValue("DisplayVersion", Version());
                    k.SetValue("Publisher", "Thornswood");
                    k.SetValue("InstallLocation", root);
                    k.SetValue("DisplayIcon", exe);

                    // The button in Settings opens the launcher on the page that
                    // does it, rather than doing it behind the person's back.
                    // Thornswood's uninstall asks two questions that matter,
                    // whether to keep the game files and whether to keep the
                    // characters, and it puts the Windows Skyrim folders back
                    // before it deletes anything. None of that survives being
                    // reduced to one button in a list.
                    k.SetValue("UninstallString",
                               "\"" + exe + "\" -root \"" + root.TrimEnd('\\') + "\" -uninstall");

                    // Nothing here answers a Modify or a Repair from Windows, so
                    // it says so rather than offering buttons that do nothing.
                    // Repair lives in the launcher, where it can close the game
                    // first and report what it put back.
                    k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    k.SetValue("NoRepair", 1, RegistryValueKind.DWord);

                    if (cfg != null && !string.IsNullOrEmpty(cfg.SiteUrl))
                        k.SetValue("URLInfoAbout", cfg.SiteUrl);

                    // EstimatedSize in KB from OwnGame's build record (copied= in
                    // Profile\OwnGame\made.txt), plus this launcher exe. That is the
                    // bytes Thornswood holds as its own copies, not the Game folder
                    // walk (Vortex hard-links would inflate it) and not a number
                    // invented here. When the record is absent, write nothing.
                    long copied;
                    if (TryReadCopied(out copied))
                    {
                        long exeBytes = 0;
                        try { exeBytes = new FileInfo(exe).Length; } catch (Exception ex) { Swallow.Note("Register.Ensure, measuring the launcher", ex); }
                        long kb = (copied + exeBytes + 1023L) / 1024L;
                        if (kb > 0 && kb <= int.MaxValue)
                            k.SetValue("EstimatedSize", (int)kb, RegistryValueKind.DWord);
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Register.Ensure", ex); }
        }

        /// <summary>
        /// OwnGame's copied= figure from Profile\OwnGame\made.txt, or false when
        /// the record is missing or unreadable. No invented number.
        /// </summary>
        static bool TryReadCopied(out long copied)
        {
            copied = 0;
            try
            {
                string path = Path.Combine(Paths.ProfileDir, "OwnGame", "made.txt");
                if (!File.Exists(path)) return false;
                foreach (string line in File.ReadAllLines(path))
                {
                    if (!line.StartsWith("copied=", StringComparison.Ordinal)) continue;
                    long v;
                    if (!long.TryParse(line.Substring(7), out v) || v < 0) return false;
                    copied = v;
                    return true;
                }
            }
            catch (Exception ex) { Swallow.Note("Register.TryReadCopied, reading OwnGame record", ex); }
            return false;
        }


        /// <summary>Takes the entry out. Called on the way through an uninstall.</summary>
        public static void Forget()
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(Root + "\\" + KeyName(), false); }
            catch (Exception ex) { Swallow.Note("Register.Forget", ex); }
        }
    }
}
