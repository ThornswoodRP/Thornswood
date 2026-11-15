using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// THE DEV BUILD IS A CHANNEL OF THE ONE INSTALL (#5608, Patrick's
    /// answer B on 11 Nov 2026). The Server card's Main and Dev switch sets
    /// which Velopack channel this install reads (Velo.ChannelFor) and the
    /// ports that go with it, and the update check takes that channel's
    /// package from GitHub, the launcher and the game files it carries, and
    /// restarts into it. Characters are the server's, so nothing is copied:
    /// the dev server is its own world.
    ///
    /// Until #5608 the dev build was a second copy of the launcher in a folder
    /// of its own beside Root (Root-DevBuild), made from the Server card, that
    /// read the dev update feed. A copy Velopack did not install has no
    /// update source once the feed is gone, so the copy is no longer made. One
    /// made before can still remove itself from its own Settings (RemoveSelf),
    /// and the main launcher's uninstall names its folder (Root).
    /// </summary>
    static class DevBuild
    {
        public const string DevPort = "7787";
        public const string DevVoicePort = "7789";
        public const string MainPort = "7777";
        public const string MainVoicePort = "7778";

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

        /// <summary>
        /// The main voice address from a dev one: the reverse of DevVoiceUrl.
        /// Empty stays empty, and Config.VoiceBase gives the right one.
        /// </summary>
        public static string MainVoiceUrl(string devUrl)
        {
            string u = devUrl == null ? "" : devUrl.Trim();
            while (u.EndsWith("/")) { u = u.Substring(0, u.Length - 1); }
            if (u.EndsWith("-dev", StringComparison.OrdinalIgnoreCase)) u = u.Substring(0, u.Length - 4);
            return u;
        }

        /// <summary>
        /// Puts this install on <paramref name="channel"/> ("dev" or "main"):
        /// the channel the update check reads, and the game and voice ports
        /// of that channel's server, saved to config.json. The caller asks the
        /// channel for its package afterwards. Returns the log line.
        /// </summary>
        public static string Switch(Config cfg, string channel)
        {
            bool dev = Set(cfg, channel);
            cfg.Save(Paths.CfgFile);
            return dev
                ? "This install is on the dev channel now and joins the dev server. Asking GitHub for the dev launcher; it goes in and the launcher restarts into it."
                : "This install is on the main channel now and joins the live server. Asking GitHub for the main launcher; it goes in and the launcher restarts into it.";
        }

        /// <summary>
        /// The channel and its server's ports in <paramref name="cfg"/>,
        /// unsaved: what Switch saves, and what a new dev ship root's
        /// config.json is written with (scripts\release\ShipRoot). True for dev.
        /// </summary>
        public static bool Set(Config cfg, string channel)
        {
            bool dev = string.Equals(channel, "dev", StringComparison.OrdinalIgnoreCase);
            cfg.Channel = dev ? "dev" : "";
            cfg.UpdateBranch = dev ? "dev" : "main";
            cfg.ServerPort = dev ? DevPort : MainPort;
            cfg.VoicePort = dev ? DevVoicePort : MainVoicePort;
            cfg.VoiceUrl = dev ? DevVoiceUrl(cfg.VoiceUrl) : MainVoiceUrl(cfg.VoiceUrl);
            return dev;
        }

        /// <summary>
        /// A dev build copied beside Root before #5608: Root-DevBuild. It
        /// reads no update source now, and is only named or removed.
        /// </summary>
        public static string Root
        {
            get { return Paths.Root.TrimEnd('\\') + "-DevBuild"; }
        }

        public static string Exe
        {
            get { return Path.Combine(Root, "Launcher\\Thornswood.exe"); }
        }

        /// <summary>True when this launcher is such a copy: on the dev channel and not installed by Velopack.</summary>
        public static bool IsOldCopy(Config cfg)
        {
            return cfg != null && cfg.IsDev && !Velo.Installed;
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
            // Until this launcher has really gone, not for a guessed three
            // seconds: while it runs it holds files in the folder (the menu
            // theme in Profile\Music among them), and an rmdir that comes
            // first leaves the folder behind. The same wait Uninstall.Script
            // makes.
            int pid = Process.GetCurrentProcess().Id;
            sb.Append(":wait\r\n");
            sb.Append("tasklist /fi \"PID eq " + pid + "\" | find \"" + pid + "\" >nul 2>&1\r\n");
            sb.Append("if not errorlevel 1 ( timeout /t 1 /nobreak >nul & goto wait )\r\n");
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
    }
}
