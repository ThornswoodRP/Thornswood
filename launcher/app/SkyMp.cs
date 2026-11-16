using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// Everything this launcher needs to know about SkyMP.
    ///
    /// Pointing the client at an address is AutoJoin's job, which writes
    /// skymp5-client-settings.txt. This is the other half: the server. Without one answering, SkyMP never sends
    /// the message that creates your character, the client never loads a world,
    /// and you sit through a long wait and a black screen before landing in
    /// what is effectively single player: no character on the server, no
    /// creation menus, nothing. It looks exactly like the game being broken,
    /// and it is one missing window. When the address is this machine, the
    /// launcher starts the server itself rather than trusting anyone to
    /// remember.
    /// </summary>
    static class SkyMp
    {
        // The resources folder the server also serves. Game traffic is UDP and
        // there is nothing to connect to, so this is what a probe can reach.
        /// <summary>
        /// The port the server serves its resources folder on: 3000 when the
        /// game is on the default 7777, otherwise the game port plus one. The
        /// same rule the server uses and AutoJoin writes into the client, so
        /// the dev server on 7787 is asked on 7788.
        /// </summary>
        public static int ResourcePortFor(Config cfg)
        {
            int port;
            if (cfg == null || !int.TryParse(cfg.ServerPort, out port) || port <= 0) port = 7777;
            return port == 7777 ? 3000 : port + 1;
        }

        public static string PidFile
        {
            get { return Path.Combine(Paths.ProfileDir, "server.pid"); }
        }

        // ------------------------------------------------------------ the server

        public static bool IsLocal(Config cfg)
        {
            string ip = (cfg.ServerAddress == null ? "" : cfg.ServerAddress.Trim());
            return ip == "127.0.0.1" || ip.Equals("localhost", StringComparison.OrdinalIgnoreCase) || ip == "::1";
        }

        /// <summary>
        /// Where a local server lives. The build folder is checked first because
        /// that is what a machine compiling SkyMP ends up with; a Server folder
        /// beside the game is what a packaged copy gets.
        /// </summary>
        public static string ServerDir(Config cfg)
        {
            string[] tries = new string[]
            {
                cfg == null ? null : cfg.ServerFolder,
                Path.Combine(Paths.Root, "Server"),
                "C:\\Thornswood\\skymp\\build\\dist\\server"
            };
            foreach (string t in tries)
            {
                if (string.IsNullOrEmpty(t)) continue;
                if (File.Exists(Path.Combine(t, "dist_back\\skymp5-server.js"))) return t;
            }
            return null;
        }

        /// <summary>True when something is answering on the resources port.</summary>
        public static bool Up(Config cfg)
        {
            string ip = (cfg.ServerAddress == null ? "" : cfg.ServerAddress.Trim());
            if (ip.Length == 0) return false;
            try
            {
                using (var c = new TcpClient())
                {
                    IAsyncResult ar = c.BeginConnect(ip, ResourcePortFor(cfg), null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(700)) return false;
                    c.EndConnect(ar);
                    return c.Connected;
                }
            }
            catch { return false; }
        }

        /// <summary>The server this launcher started, if it is still running.</summary>
        public static Process Ours()
        {
            try
            {
                if (!File.Exists(PidFile)) return null;
                int pid;
                if (!int.TryParse(File.ReadAllText(PidFile).Trim(), out pid)) return null;
                Process p = Process.GetProcessById(pid);
                if (p == null || p.HasExited) return null;
                // A pid gets reused once the process behind it is gone, so the
                // name is checked too before anything is done to it.
                if (!p.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase)) return null;
                return p;
            }
            catch { return null; }
        }

        public static string NodeExe()
        {
            string[] tries = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs\\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs\\node.exe")
            };
            foreach (string t in tries) if (File.Exists(t)) return t;

            // PATH is read here rather than trusted from the environment this
            // process inherited, which can be an hour old on a machine where
            // Node was installed after the launcher opened.
            try
            {
                string path = Environment.GetEnvironmentVariable("PATH") ?? "";
                foreach (string d in path.Split(';'))
                {
                    if (d.Length == 0) continue;
                    try
                    {
                        string p = Path.Combine(d.Trim('"'), "node.exe");
                        if (File.Exists(p)) return p;
                    }
                    catch (Exception ex) { Swallow.Note("SkyMp.NodeExe, one PATH entry", ex); }
                }
            }
            catch (Exception ex) { Swallow.Note("SkyMp.NodeExe, reading PATH", ex); }
            return null;
        }

        /// <summary>
        /// Starts the local server and waits for it to answer. Returns null on
        /// success, or a sentence explaining why not.
        /// </summary>
        public static string Start(Config cfg, Action<string> say)
        {
            string dir = ServerDir(cfg);
            if (dir == null)
                return "The server address is this machine, but there is no server folder here to start. Point Server folder in Settings at the one with dist_back\\skymp5-server.js in it.";

            string node = NodeExe();
            if (node == null)
                return "Node is not installed on this machine, so the local server cannot be started. Install it from nodejs.org, or point the launcher at a server somewhere else.";

            try
            {
                var psi = new ProcessStartInfo(node, "dist_back/skymp5-server.js");
                psi.WorkingDirectory = dir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;

                Process p = Process.Start(psi);
                try { File.WriteAllText(PidFile, p.Id.ToString()); } catch (Exception ex) { Swallow.Note("SkyMp.Start, writing pid file", ex); }

                // Kept, because when the server refuses to come up the reason is
                // in here and nowhere else.
                string logFile = Path.Combine(Paths.ProfileDir, "server.log");
                try { File.WriteAllText(logFile, ""); } catch (Exception ex) { Swallow.Note("SkyMp.Start, clearing server.log", ex); }
                DataReceivedEventHandler sink = delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data == null) return;
                    try { File.AppendAllText(logFile, e.Data + Environment.NewLine); } catch (Exception ex) { Swallow.Note("SkyMp.Start, appending server.log", ex); }
                };
                p.OutputDataReceived += sink;
                p.ErrorDataReceived += sink;
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();

                if (say != null) say("Starting the server.");

                for (int i = 0; i < 40; i++)
                {
                    if (p.HasExited)
                        return "The server started and stopped again. " + Tail(logFile);
                    if (Up(cfg)) return null;
                    System.Threading.Thread.Sleep(500);
                }
                return "The server was started but never answered. " + Tail(logFile);
            }
            catch (Exception ex)
            {
                return "Could not start the server: " + Failure.Say("SkyMp, starting the server", ex);
            }
        }

        static string Tail(string file)
        {
            try
            {
                string[] lines = File.ReadAllLines(file);
                int n = Math.Min(3, lines.Length);
                if (n == 0) return "It printed nothing.";
                var sb = new StringBuilder("It said: ");
                for (int i = lines.Length - n; i < lines.Length; i++) sb.Append(lines[i].Trim()).Append(" ");
                return sb.ToString().Trim();
            }
            catch { return "Its log could not be read."; }
        }

        /// <summary>Stops only a server this launcher started.</summary>
        public static bool Stop()
        {
            Process p = Ours();
            if (p == null) return false;
            try
            {
                p.Kill();
                p.WaitForExit(5000);
            }
            catch (Exception ex) { Swallow.Note("SkyMp.Stop, killing process", ex); }
            try { File.Delete(PidFile); } catch (Exception ex) { Swallow.Note("SkyMp.Stop, deleting pid file", ex); }
            return true;
        }
    }
}
