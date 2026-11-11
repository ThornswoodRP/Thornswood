using System;
using System.Diagnostics;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Thornswood-ShipRoot.exe (#2019): makes or brings up to date the Game
    /// folder of a ship root, the folder a release is built from, with
    /// OwnGame's own Make and Refresh, and says whether the folder is then
    /// current. ShipRoot.csproj says why it is built from the launcher's
    /// sources; scripts\release\Update-ShipRoot.ps1 builds and runs it before
    /// a Ship packs anything.
    ///
    ///   Thornswood-ShipRoot.exe -Root &lt;folder&gt; -Channel main|dev
    ///       makes &lt;folder&gt;\Game when there is none, or brings it up to date
    ///       with Vortex's deployment and this build's rules; exit 0 when the
    ///       folder is current afterwards, 1 with a sentence when it is not
    ///   ... -Check
    ///       changes nothing; exit 0 when it is current, 1 with why not
    ///   ... -SkyrimFrom &lt;folder&gt;
    ///       for a root with no game folder yet: the game's own files are
    ///       copied from &lt;folder&gt;, which must hold every one the folder
    ///       takes byte for byte as records\skyrim-files.json lists them
    ///       (OwnGame.SkyrimFrom, #2603), instead of from the Steam copy
    ///
    /// A NEW ROOT is made the way an install that chose its own folder is
    /// (#1226), which is what every ship root used to be: its config.json is
    /// written for the channel, Thornswood's own files of the release the
    /// channel is on now are synced into Profile\Payload out of that
    /// release's package on GitHub, with every check an update makes
    /// (Updater.SeedFromChannel, #5608), and Make builds the folder from
    /// Vortex's deployment, the Steam copy's game and that Payload. So the
    /// first release from a new root starts from what everybody already has,
    /// not from a folder that would read as removing every file of ours.
    ///
    /// WHEN THE STEAM COPY IS NOT 1.6.1170 (#2603). Make takes the game's own
    /// files from the Steam copy only when every one is that build's, and an
    /// install otherwise gets them from the Downgrade, a Steam download under
    /// the person's own account, which this cannot start. On 16 Oct the
    /// machine that ships had a Steam copy with another bink2w64.dll and
    /// Dawnguard.esm and the Anniversary Edition's Creation Club files, so
    /// main's root could not be made. -SkyrimFrom names a folder that holds
    /// them, such as the other channel's root's Game: each is checked against
    /// the list before anything is placed, then copied, never linked, so the
    /// new root never shares a file with that folder.
    ///
    /// WHAT IT DOES NOT DO. It never starts the launcher or the game, and
    /// refuses while either runs from the root. It does not run what the
    /// launcher's window does after a refresh (light flags, the server's load
    /// order, the checks against the server): those are for playing, and a
    /// ship root is never played from. It never writes into the Steam copy:
    /// OwnGame does not, and the Steam copy's clean up (CleanSteamCopy) is
    /// not run. It installs no client: Update-ShipRoot.ps1 does that next,
    /// from the configured engine build.
    /// </summary>
    static class ShipRootTool
    {
        static int Main(string[] args)
        {
            string root = null, channel = null, skyrimFrom = null;
            bool check = false;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a.Equals("-Root", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) root = args[++i];
                else if (a.Equals("-Channel", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) channel = args[++i];
                else if (a.Equals("-Check", StringComparison.OrdinalIgnoreCase)) check = true;
                else if (a.Equals("-SkyrimFrom", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) skyrimFrom = args[++i];
                else
                {
                    Console.WriteLine("STOP. " + a + " is not something this takes. Use: Thornswood-ShipRoot.exe -Root <folder> -Channel main|dev [-Check] [-SkyrimFrom <folder>]");
                    return 1;
                }
            }
            Action<string> say = delegate(string m) { Console.WriteLine("  " + m); };
            try
            {
                string why = Run(root, channel, check, skyrimFrom, say);
                if (why != null)
                {
                    Console.WriteLine("STOP. " + why);
                    return 1;
                }
                return 0;
            }
            catch (Exception ex)
            {
                Console.WriteLine("STOP. " + ex.Message);
                return 1;
            }
        }

        /// <summary>
        /// The whole run. Null when the root's Game folder is current at the
        /// end, otherwise the sentence the run stops with. Throws with a
        /// sentence when Make, Refresh or the sync does.
        /// </summary>
        public static string Run(string root, string channel, bool check, Action<string> say)
        {
            return Run(root, channel, check, null, say);
        }

        /// <summary>
        /// Run, with <paramref name="skyrimFrom"/> the folder a new root's
        /// game files come from (#2603), or null for the Steam copy. Only
        /// Make takes it: a root already made never takes the game's own files
        /// again (#1218), so it is said and not used.
        /// </summary>
        public static string Run(string root, string channel, bool check, string skyrimFrom, Action<string> say)
        {
            if (string.IsNullOrEmpty(root)) return "-Root names no folder. Give the ship root, the folder Where.ps1 ShipRoot or ShipRootDev names.";
            if (channel != "main" && channel != "dev") return "-Channel is main or dev, and it was " + (channel ?? "not given") + ".";
            root = Path.GetFullPath(root.Trim().Trim('"')).TrimEnd('\\');
            string game = Path.Combine(root, "Game");

            // Vortex's own folder is the collection's source and never a
            // release folder (Ship.ps1 refuses it too, #1692).
            if (File.Exists(Path.Combine(game, "Data\\vortex.deployment.json")))
                return root + " is a folder Vortex deploys into (Game\\Data\\vortex.deployment.json is there), so it is never a ship root. Nothing was changed.";
            string busy = RunningFrom(root);
            if (busy != null)
                return busy + " is running from " + root + ", so its Game folder was not touched. A ship root's launcher and game are never started; close it and run this again.";

            if (check && !Directory.Exists(root)) return "There is no ship root at " + root + ".";
            Directory.CreateDirectory(root);
            Paths.Init(root);

            Config cfg;
            if (File.Exists(Paths.CfgFile))
            {
                cfg = Config.Load(Paths.CfgFile);
                string has = cfg.IsDev ? "dev" : "main";
                if (has != channel)
                    return root + "\\config.json is the " + has + " build's, and this was asked to bring it up to date as the " + channel + " root. Nothing was changed.";
            }
            else
            {
                if (check) return "There is no config.json in " + root + ", so it is not a ship root yet.";
                cfg = NewConfig(channel);
                cfg.Save(Paths.CfgFile);
                say("Wrote " + Paths.CfgFile + " for the " + channel + " channel.");
            }

            if (check)
            {
                string now = OwnGame.ShipRootCurrent(cfg);
                if (now == null) Say(say);
                return now;
            }

            if (!Directory.Exists(game))
            {
                // A new root: Thornswood's own files of the channel's release
                // into Payload, then the folder made with them (#1226).
                say("There is no game folder in " + root + ", so it is made now, as an install that chose its own folder is.");
                Directory.CreateDirectory(Path.Combine(root, "Profile\\Payload"));
                Paths.Init(root);
                try { Updater.SeedFromChannel(cfg, channel, say); }
                catch (Exception ex)
                {
                    return "Thornswood's own files of the " + channel + " channel's release could not be brought into " + root +
                           ", so the folder was not made: " + ex.Message;
                }
                say(OwnGame.Make(cfg, say, skyrimFrom));
                Paths.Init(root);
            }
            else if (!OwnGame.Active)
            {
                return game + " is there but OwnGame did not make it (" + Path.Combine(Paths.ProfileDir, "OwnGame\\files.txt") +
                       " is missing), so nothing says which of its files are Vortex's. Move that Game folder out of " + root + " and run this again: it makes a new one.";
            }
            else
            {
                if (!string.IsNullOrEmpty(skyrimFrom))
                    say("-SkyrimFrom " + skyrimFrom + " was not used: " + game + " is made already, and a made folder never takes the game's own files again.");
                say(OwnGame.Refresh(cfg, say));
            }

            string why = OwnGame.ShipRootCurrent(cfg);
            if (why != null) return "After bringing it up to date, " + why;
            Say(say);
            return null;
        }

        static void Say(Action<string> say)
        {
            say(Path.Combine(Paths.Root, "Game") + " is current with what Vortex has deployed, to OwnGame's current rules. Its made.txt:");
            foreach (string line in OwnGame.MadeLines()) say("  " + line);
        }

        /// <summary>
        /// A config.json for a new root: the launcher's defaults, which are
        /// the main build's, and for dev what the Server card's switch to the
        /// dev channel changes (DevBuild.Set).
        /// </summary>
        static Config NewConfig(string channel)
        {
            var c = new Config();
            if (channel == "dev") DevBuild.Set(c, "dev");
            return c;
        }

        /// <summary>
        /// The launcher or the game, running from inside the root, or null.
        /// Only those names are asked, and only for where they run from: one
        /// of Patrick's own installs running elsewhere is none of this.
        /// </summary>
        static string RunningFrom(string root)
        {
            string fence = root.TrimEnd('\\') + "\\";
            foreach (string name in new string[] { "Thornswood", "SkyrimSE", "skse64_loader" })
            {
                Process[] ps;
                try { ps = Process.GetProcessesByName(name); }
                catch { continue; }
                foreach (Process p in ps)
                {
                    string path = null;
                    try { path = p.MainModule.FileName; }
                    catch { /* another user's or a protected process: not one started from this root */ }
                    if (path != null && path.StartsWith(fence, StringComparison.OrdinalIgnoreCase)) return name + ".exe";
                }
            }
            return null;
        }
    }
}
