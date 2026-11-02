using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// The dev build: a second copy of the launcher in its own folder beside
    /// this one, following the dev branch of the releases repo and joining
    /// the dev server. New work lands there first and gets broken there, so
    /// the build everybody plays on stays playable while it is being tested.
    ///
    /// Made from the Server card on the Play page of the main build, out of the
    /// main build's own files: the launcher's program is copied, the config is copied with the
    /// channel, branch and ports changed, and the profile records that say
    /// which packs are already applied are copied so the
    /// dev launcher does not try to re-apply a year of updates on its first
    /// start. Characters are not copied: the dev server is its own world.
    ///
    /// Each build makes its own Game folder (OwnGame). The Game folder is not
    /// copied here; the new build offers to make one at first start.
    /// </summary>
    static class DevBuild
    {
        public const string DevPort = "7787";
        public const string DevVoicePort = "7789";

        /// <summary>
        /// The dev voice service's address behind Caddy, from the main one.
        /// Caddy carries /voice/ to the live service and /voice-dev/ to the
        /// dev one (scripts\deploy\Caddyfile), and the dev gamemode collects chat
        /// commands from the dev service only. Until 20 September the dev
        /// build kept the main address, so its chat lines, /pick among them,
        /// went to the live service and were answered by the live gamemode,
        /// which had never heard of the command. Empty stays empty: the dev
        /// build's Config.VoiceBase gives it this for Config.Voice.
        /// </summary>
        public static string DevVoiceUrl(string mainUrl)
        {
            string u = mainUrl == null ? "" : mainUrl.Trim();
            while (u.EndsWith("/")) { u = u.Substring(0, u.Length - 1); }
            if (u.Length == 0) return "";
            if (u.EndsWith("-dev", StringComparison.OrdinalIgnoreCase)) return u;
            return u + "-dev";
        }

        /// <summary>Beside the main install: C:\Thornswood becomes C:\Thornswood-DevBuild.</summary>
        public static string Root
        {
            get { return Paths.Root.TrimEnd('\\') + "-DevBuild"; }
        }

        public static string Exe
        {
            get { return Path.Combine(Root, "Launcher\\Thornswood.exe"); }
        }

        public static bool Installed
        {
            get { try { return File.Exists(Exe); } catch { return false; } }
        }

        /// <summary>
        /// The main build beside a dev build: C:\Thornswood-DevBuild becomes
        /// C:\Thornswood. Used by the server selector on the dev build to hand
        /// the person back to the main server. On the main build this is Root.
        /// </summary>
        public static string MainRoot
        {
            get
            {
                string r = Paths.Root.TrimEnd('\\');
                if (r.EndsWith("-DevBuild", StringComparison.OrdinalIgnoreCase))
                    return r.Substring(0, r.Length - "-DevBuild".Length);
                return r;
            }
        }

        public static string MainExe
        {
            get { return Path.Combine(MainRoot, "Launcher\\Thornswood.exe"); }
        }

        public static bool MainInstalled
        {
            get { try { return File.Exists(MainExe); } catch { return false; } }
        }

        /// <summary>Copies this install into the dev folder and opens it. Returns the log line.</summary>
        public static string Install(Config main)
        {
            if (main.IsDev) return "This is the dev build already.";
            string root = Root;
            Directory.CreateDirectory(Path.Combine(root, "Launcher"));
            Directory.CreateDirectory(Path.Combine(root, "Profile"));

            // The program: the running exe and the native libraries beside it,
            // from the folder this exe runs in. Under Velopack that is its
            // current folder in %LocalAppData%\Thornswood, not Root\Launcher,
            // which a Velopack install does not have. That folder also holds
            // what the package carries for the install (config.json, SOURCE
            // CODE.txt, the licence texts, Game), so only the .exe and .dll
            // files are copied, the program as Build-Launcher.ps1 counts it.
            string exeDir = Path.GetDirectoryName(Environment.ProcessPath);
            int copied = 0;
            foreach (string f in Directory.GetFiles(exeDir))
            {
                string ext = Path.GetExtension(f);
                if (!ext.Equals(".exe", StringComparison.OrdinalIgnoreCase) && !ext.Equals(".dll", StringComparison.OrdinalIgnoreCase)) continue;
                File.Copy(f, Path.Combine(root, "Launcher", Path.GetFileName(f)), true);
                copied++;
            }

            // Profile facts worth carrying over: the golden plugin list, which
            // packs are in, what they wrote, and the kept copies of our own
            // Data\Platform files. Not the log, not the characters, not the
            // stats. The Game folder is not copied; OwnGame makes one later.
            CopyDir(Paths.Golden, Path.Combine(root, "Profile\\Default"));
            CopyDir(Paths.PacksDir, Path.Combine(root, "Profile\\Packs"));
            CopyDir(Keep.Dir, Path.Combine(root, "Profile\\Keep"));
            // Not installed-into-game.txt: that is the list the uninstaller
            // deletes from the game folder, and the dev build's uninstall
            // removes only itself (RemoveSelf).
            // developer.flag is not copied: nothing writes it since 25 September
            // (Publish-Update stopped; Keep still reads one if present).
            foreach (string n in new[] { "applied.txt", "discord.txt", "discord-name.txt" })
            {
                string src = Path.Combine(Paths.ProfileDir, n);
                if (File.Exists(src)) File.Copy(src, Path.Combine(root, "Profile", n), true);
            }

            // The config, with the five things that make it the dev build.
            Config dev = Config.Load(Paths.CfgFile);
            dev.Channel = "dev";
            dev.UpdateBranch = "dev";
            dev.UpdateFeedUrl = "https://thornswood.net/feed-dev/version.json";
            dev.ServerPort = DevPort;
            dev.VoicePort = DevVoicePort;
            dev.VoiceUrl = DevVoiceUrl(dev.VoiceUrl);
            dev.Save(Path.Combine(root, "config.json"));

            try
            {
                var psi = new ProcessStartInfo(Exe);
                psi.WorkingDirectory = Path.Combine(root, "Launcher");
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                return "The dev build is installed at " + root + " but did not open: " + ex.Message;
            }
            return "Installed the dev build at " + root + " (" + copied + " launcher files) and opened it. " +
                   "It follows the dev branch and joins the dev server from here; it makes its own Start menu entry, Thornswood Dev.";
        }

        /// <summary>Closes a running dev launcher and deletes its folder. Returns the log line.</summary>
        public static string Remove()
        {
            string root = Root;
            if (!Directory.Exists(root)) return "There is no dev build installed.";
            int closed = 0;
            try
            {
                foreach (Process p in Process.GetProcessesByName("Thornswood"))
                {
                    try
                    {
                        string path = p.MainModule.FileName;
                        if (path != null && path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                        {
                            p.Kill();
                            p.WaitForExit(5000);
                            closed++;
                        }
                    }
                    catch (Exception ex) { Swallow.Note("DevBuild.Remove, closing a process under the root", ex); }
                }
            }
            catch (Exception ex) { Swallow.Note("DevBuild.Remove, enumerating processes", ex); }
            try
            {
                Directory.Delete(root, true);
            }
            catch (Exception ex)
            {
                return "Could not remove the dev build: " + ex.Message;
            }
            // Every shortcut that ran it, the pinned taskbar copy among them,
            // asked by what it runs rather than by name (#3205).
            try { Icons.Drop(Exe); } catch (Exception ex) { Swallow.Note("DevBuild.Remove, deleting shortcuts", ex); }
            return "Removed the dev build" + (closed > 0 ? " (closed it first)" : "") + ". Your characters on the dev server are still on the server.";
        }

        /// <summary>
        /// Run from inside the dev build: removes this install, folder and
        /// shortcuts, through a short detached script, because a program
        /// cannot delete the folder it is running from. The caller closes the
        /// launcher right after. The Game folder is not touched.
        /// </summary>
        public static string RemoveSelf()
        {
            string root = Paths.Root;
            string bat = Path.Combine(Path.GetTempPath(), "thornswood-dev-remove.cmd");
            var sb = new StringBuilder();
            sb.Append("@echo off\r\n");
            // cmd reads a .cmd file in the console's OEM code page, not the
            // UTF-8 this is written in, so a path with any character outside
            // ASCII would reach rmdir and del as different bytes and the dev
            // build would still be sitting there afterwards.
            sb.Append("chcp 65001 >nul\r\n");
            sb.Append("ping 127.0.0.1 -n 4 >nul\r\n");
            sb.Append("rmdir /s /q \"" + root + "\"\r\n");
            // Found now, while this exe is still here to match against: every
            // shortcut that runs it, the pinned taskbar copy among them (#3205).
            foreach (string lnk in Icons.ShortcutsTo(Icons.Exe))
                sb.Append("del /q \"" + lnk + "\" 2>nul\r\n");
            sb.Append("del \"%~f0\"\r\n");
            File.WriteAllText(bat, sb.ToString());
            var psi = new ProcessStartInfo(bat);
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.CreateNoWindow = true;
            psi.UseShellExecute = true;
            Process.Start(psi);
            return "Removing the dev build. This launcher closes now and " + root + " goes with it. The main build and the game are not touched.";
        }

        static void CopyDir(string from, string to)
        {
            try
            {
                if (!Directory.Exists(from)) return;
                Directory.CreateDirectory(to);
                foreach (string f in Directory.GetFiles(from))
                    File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
                foreach (string d in Directory.GetDirectories(from))
                    CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
            }
            catch (Exception ex) { Swallow.Note("DevBuild.CopyDir", ex); }
        }
    }
}
