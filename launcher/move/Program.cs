using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace Thornswood
{
    /// <summary>
    /// THE OLD LAUNCHER MOVES ITSELF TO THE NEW ONE (2 Nov 2026). Patrick: "is
    /// there not a way to from the current launchers people have have it
    /// update to the new one or install the new one and delete the old".
    ///
    /// The launcher from before Velopack updates itself from its own feed:
    /// version.json names a launcher (launcherVersion, launcherUrl,
    /// launcherSha256), and the old launcher downloads it, holds it to that
    /// sha256 and to Thornswood's signature (Signature.cs, #912), and a swap
    /// script puts it in place of Root\Launcher\Thornswood.exe, keeping the
    /// old exe as Thornswood.exe.old and starting the new one. Once a channel
    /// has a Velopack setup program the site names this program there instead
    /// (site\lib\feed.js, feedMove), so the old launcher's own update brings
    /// it in, and this is what starts in its place:
    ///
    ///   1. Thornswood.exe.old goes. That is how the swap script knows the
    ///      launcher it put in started; left there, it would put the old one
    ///      back. This runs to the end without it: a failure below says so,
    ///      and the next start of this program tries again.
    ///   2. The channel is config.json's (Channel or UpdateBranch, "dev" or
    ///      main), as the old launcher read it.
    ///   3. The new launcher's setup program for that channel is downloaded
    ///      from the site's link (/file/, which answers with its GitHub
    ///      Release) and held to Thornswood's signature, the old launcher's
    ///      own check, before it runs.
    ///   4. Root, this install's folder, is handed over (InstallPlace.
    ///      HandoverFile), so the new launcher's first start carries on in it
    ///      with Profile, Game and config.json as they are, and asks nothing.
    ///   5. The shortcuts that start the old launcher go, so nobody starts
    ///      this again by mistake; the setup makes the new launcher's own.
    ///   6. The setup runs. It installs the new launcher for this Windows
    ///      account and starts it.
    ///   7. Once this has closed, Root\Launcher, the old launcher's folder,
    ///      goes. Nothing else of the install is touched.
    ///
    /// When the new launcher is already installed for this account, nothing
    /// is installed over it: it is started, and the old launcher's folder
    /// still goes.
    /// </summary>
    static partial class Move
    {
        // ExpectedSigner, the name in Thornswood's certificate, is written
        // once, in launcher\app\Updater.cs. Move.csproj reads it from there
        // into Signer.g.cs at each build, and launcher\tests\test-move.ps1
        // reads it back out of the built program.

        [STAThread]
        static int Main(string[] args)
        {
            string exe = System.Reflection.Assembly.GetExecutingAssembly().Location;
            string launcherDir = Path.GetDirectoryName(exe);
            string root = Path.GetDirectoryName(launcherDir);

            // 1. The swap script's sign that this started.
            ClearOld(exe + ".old");
            TryDelete(exe + ".bad");

            try
            {
                string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string newExe = Path.Combine(Path.Combine(local, "Thornswood"), "Thornswood.exe");
                if (File.Exists(Path.Combine(Path.Combine(local, "Thornswood"), "install-root.txt")) && File.Exists(newExe))
                {
                    RemoveShortcuts(exe);
                    var start = new ProcessStartInfo(newExe);
                    start.WorkingDirectory = Path.GetDirectoryName(newExe);
                    start.UseShellExecute = true;
                    Process.Start(start);
                    RemoveAfterExit(launcherDir);
                    return 0;
                }

                // 2.
                string channel = Channel(Path.Combine(root, "config.json"));
                string name = channel == "dev" ? "Thornswood-Dev-Setup.exe" : "Thornswood-Setup.exe";

                // 3.
                string setup = Path.Combine(Path.GetTempPath(), "thornswood-move-" + Guid.NewGuid().ToString("N").Substring(0, 12) + "-" + name);
                Download("https://thornswood.net/file/" + name, setup);
                string said;
                string why = Signature.Refusal(setup, ExpectedSigner, out said);
                if (why.Length > 0)
                {
                    TryDelete(setup);
                    throw new Exception("The new launcher's setup that was downloaded " + why + " Nothing was installed.");
                }

                // 4.
                File.WriteAllText(Path.Combine(local, "Thornswood-moved-from.txt"), root + "\r\n", new UTF8Encoding(false));

                // 5.
                RemoveShortcuts(exe);

                // 6.
                // Started in the temp folder, so the new launcher it starts
                // does not hold Root\Launcher as its current folder.
                var run = new ProcessStartInfo(setup);
                run.WorkingDirectory = Path.GetTempPath();
                run.UseShellExecute = true;
                using (Process p = Process.Start(run))
                {
                    p.WaitForExit();
                    if (p.ExitCode != 0)
                        throw new Exception("The new launcher's setup ended with code " + p.ExitCode + ", so it may not have installed.");
                }
                TryDelete(setup);

                // 7.
                RemoveAfterExit(launcherDir);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Thornswood is moving to its new launcher, and this step did not finish:\n\n" + ex.Message +
                    "\n\nNothing of your install was removed. Start Thornswood again to try once more, or install the new launcher from thornswood.net/downloads.",
                    "Thornswood", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }

        /// <summary>"dev" when config.json's Channel or UpdateBranch says dev, otherwise "main", as the old launcher read it.</summary>
        public static string Channel(string configFile)
        {
            string text = File.Exists(configFile) ? File.ReadAllText(configFile) : "";
            foreach (string field in new[] { "Channel", "UpdateBranch" })
            {
                Match m = Regex.Match(text, "\"" + field + "\"\\s*:\\s*\"([^\"]*)\"");
                if (m.Success && string.Equals(m.Groups[1].Value, "dev", StringComparison.OrdinalIgnoreCase)) return "dev";
            }
            return "main";
        }

        static void Download(string url, string to)
        {
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // Tls12
            using (var wc = new WebClient())
            {
                wc.Headers[HttpRequestHeader.UserAgent] = "Thornswood-move";
                wc.DownloadFile(url, to);
            }
        }

        /// <summary>The Desktop, Start menu and taskbar shortcuts whose target is the old launcher's exe.</summary>
        static void RemoveShortcuts(string exe)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            // The taskbar's pins are shortcuts too, in the profile's roaming
            // folder: on 2 Nov Patrick's pin still started the old launcher
            // after the new one was installed.
            string pins = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar");
            var dirs = new System.Collections.Generic.List<string> { pins };
            foreach (Environment.SpecialFolder where in new[] {
                Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.StartMenu,
                Environment.SpecialFolder.Programs, Environment.SpecialFolder.CommonDesktopDirectory })
                dirs.Add(Environment.GetFolderPath(where));
            foreach (string dir in dirs)
            {
                if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
                foreach (string lnk in Directory.GetFiles(dir, "*.lnk", SearchOption.AllDirectories))
                {
                    try
                    {
                        object sc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
                        string target = (string)sc.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, sc, null);
                        if (string.IsNullOrEmpty(target)) continue;
                        if (string.Equals(Path.GetFullPath(target), Path.GetFullPath(exe), StringComparison.OrdinalIgnoreCase)) File.Delete(lnk);
                    }
                    catch (Exception) { }
                }
            }
        }

        /// <summary>
        /// Root\Launcher goes once this process has ended: a hidden cmd waits
        /// for this process id to be gone, then removes the folder.
        /// </summary>
        static void RemoveAfterExit(string launcherDir)
        {
            int me = Process.GetCurrentProcess().Id;
            string bat = Path.Combine(Path.GetTempPath(), "thornswood-move-" + me + ".cmd");
            File.WriteAllText(bat,
                "@echo off\r\nchcp 65001 >nul\r\n:wait\r\n" +
                "tasklist /fi \"PID eq " + me + "\" | find \"" + me + "\" >nul 2>&1\r\n" +
                "if not errorlevel 1 ( ping 127.0.0.1 -n 2 >nul & goto wait )\r\n" +
                "rmdir /s /q \"" + launcherDir + "\"\r\n" +
                "del \"%~f0\"\r\n", new UTF8Encoding(false));
            // Started in the temp folder: a cmd whose current folder is the
            // one it removes leaves that folder behind.
            var psi = new ProcessStartInfo(bat);
            psi.WorkingDirectory = Path.GetTempPath();
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.CreateNoWindow = true;
            psi.UseShellExecute = true;
            Process.Start(psi);
        }

        /// <summary>
        /// The .old the swap script kept, as the old launcher's own Settle
        /// cleared it: five tries a second apart, because antivirus can hold
        /// a file it is reading for a moment (a file another program holds),
        /// and a .old that stays is what the script takes for a launcher that
        /// did not start. After that the move carries on; the script then
        /// puts the old launcher back, and its next update check brings this
        /// in again.
        /// </summary>
        static void ClearOld(string old)
        {
            for (int i = 0; i < 5 && File.Exists(old); i++)
            {
                try { File.SetAttributes(old, FileAttributes.Normal); File.Delete(old); }
                catch (Exception) { System.Threading.Thread.Sleep(1000); }
            }
        }

        static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch (Exception) { }
        }
    }
}
