using System;
using System.IO;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// Where Thornswood is installed, and the drive questions the install
    /// window asks about it.
    ///
    /// Velopack installs the launcher under the person's own profile
    /// (%LocalAppData%\Thornswood, with the launcher in its current folder),
    /// and that is not where Thornswood's game files can go: the launcher
    /// builds Root\Game out of the Steam copy of Skyrim with hard links, and a
    /// hard link cannot cross a drive (issue #473). So the install folder,
    /// Root, is still the person's choice in the install window, on Skyrim's
    /// drive, and this records it beside Velopack's folder, which Velopack
    /// keeps across updates and removes on an uninstall.
    /// </summary>
    static class InstallPlace
    {
        /// <summary>
        /// The record: one line, the install folder. In the folder above the
        /// launcher's own, which under Velopack is %LocalAppData%\Thornswood.
        /// </summary>
        public static string RecordFile
        {
            get
            {
                string exeDir = Path.GetDirectoryName(Environment.ProcessPath ?? "") ?? "";
                string above = Path.GetDirectoryName(exeDir.TrimEnd('\\', '/')) ?? exeDir;
                return Path.Combine(above, "install-root.txt");
            }
        }

        /// <summary>
        /// The install folder the install window recorded once it finished, or
        /// null when there is none yet: then the launcher has not been
        /// installed for this account, and its first start is the install.
        /// </summary>
        public static string Recorded()
        {
            string f = RecordFile;
            if (!File.Exists(f)) return null;
            string root = File.ReadAllText(f, Encoding.UTF8).Trim();
            if (root.Length == 0 || !Path.IsPathFullyQualified(root)) return null;
            return root;
        }

        /// <summary>Writes the record. Only once the install finished, so a stopped one is asked again.</summary>
        public static void Record(string root)
        {
            File.WriteAllText(RecordFile, root.TrimEnd('\\') + "\r\n", new UTF8Encoding(false));
        }

        // ------------------------------------------------------- Skyrim's drive
        //
        // The launcher builds Thornswood its own game folder out of the Steam
        // copy of Skyrim, most of it as hard links so the collection is not on
        // the disk twice, and a hard link cannot cross a drive. So an install
        // on a different drive from Skyrim is an install that cannot play:
        // OwnGame.WhyNot names it and Play stops there. Issue #473.
        //
        // Skyrim is found the way the rest of the launcher finds it, by
        // Steam.cs: Steam's own folder out of the registry, then every path in
        // config\libraryfolders.vdf, and the first library holding
        // steamapps\common\Skyrim Special Edition with SkyrimSE.exe in it.
        //
        // Nothing here is a refusal. It steers, and says plainly what a
        // different drive costs, because whether the launcher may fall back
        // to copies instead is not the installer's to decide.

        /// <summary>The drive a folder is on, as "D:\", or "" when it has none to read.</summary>
        public static string DriveOf(string path)
        {
            if (string.IsNullOrEmpty(path)) return "";
            try { return Path.GetPathRoot(Path.GetFullPath(path)) ?? ""; }
            catch (Exception e) when (e is ArgumentException || e is NotSupportedException || e is PathTooLongException) { return ""; }
        }

        public static bool SameDrive(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            return string.Equals(a.TrimEnd('\\'), b.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>"D:" rather than "D:\", for the middle of a sentence.</summary>
        public static string Letter(string driveRoot)
        {
            return driveRoot == null ? "" : driveRoot.TrimEnd('\\');
        }

        public static string Gb(long bytes)
        {
            return (bytes / 1073741824.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " GB";
        }

        /// <summary>
        /// What the install needs free on the install folder's drive: the
        /// launcher's own files are Velopack's, so this is Thornswood's own
        /// content and the profile, and the Bethesda archives stay where they
        /// are. InstallSteps stops below it.
        /// </summary>
        public const long Needed = 6L * 1024 * 1024 * 1024;

        /// <summary>
        /// The folder the window starts on: Thornswood on the drive Skyrim is
        /// on. It is the only drive this install can play from, and it is not
        /// something a person can put right with a button afterwards: it is a
        /// reinstall, or moving a Steam library. C:\Thornswood is only the
        /// answer when there is no Steam copy to find.
        /// </summary>
        public static string StartRoot(string skyrimDrive)
        {
            if (string.IsNullOrEmpty(skyrimDrive)) return @"C:\Thornswood";
            return Path.Combine(skyrimDrive, "Thornswood").TrimEnd('\\');
        }

        /// <summary>
        /// The folder a picked folder becomes: a folder called Thornswood
        /// inside it, unless that is the one picked. Picking the folder it is
        /// already in should not nest another one inside it every time.
        /// </summary>
        public static string RootFromPick(string chosen)
        {
            if (chosen.TrimEnd('\\').EndsWith("Thornswood", StringComparison.OrdinalIgnoreCase)) return chosen.TrimEnd('\\');
            return Path.Combine(chosen, "Thornswood");
        }

        /// <summary>
        /// The line under the drive buttons: where Skyrim is against where
        /// this is about to install, and whether that is the warning colour.
        /// A different drive is said in full, because it is the one choice
        /// here that cannot be undone with a button afterwards.
        /// </summary>
        public static string SaySkyrim(string sky, string root, out string colour)
        {
            if (sky.Length == 0)
            {
                colour = "Warn";
                return "Steam's copy of Skyrim Special Edition was not found on this PC, so this cannot " +
                       "say which drive it is on. Thornswood has to go on the same drive as Skyrim, " +
                       "because it builds its game folder out of your Steam copy with hard links and a " +
                       "link cannot cross a drive.";
            }
            // A path with no drive root to read is not a drive to warn about,
            // but Skyrim's is still worth naming.
            if (string.IsNullOrEmpty(root))
            {
                colour = "Warn";
                return "Skyrim is on " + Letter(sky) + ", and Thornswood has to go on that same drive. " +
                       "It builds its game folder out of your Steam copy with hard links, and a link " +
                       "cannot cross a drive.";
            }
            if (SameDrive(sky, root))
            {
                colour = "Faint";
                return "Skyrim is on " + Letter(sky) + ", which is this drive. Thornswood builds its game " +
                       "folder out of your Steam copy with hard links, which take no extra space, and that " +
                       "only works on one drive.";
            }
            colour = "Bad";
            return "Skyrim is on " + Letter(sky) + " and this would put Thornswood on " + Letter(root) +
                   ". Thornswood has to share Skyrim's drive: it builds a game folder of its own out of " +
                   "your Steam copy with hard links, and a link cannot cross a drive. Installed here, the " +
                   "launcher cannot build that folder and will not let you play. Pick " + Letter(sky) + ".";
        }

        /// <summary>
        /// Said once more when Install is pressed on another drive, because
        /// the line under the drive buttons can be scrolled past and this is
        /// the last moment it costs nothing. It asks rather than refuses:
        /// whether the launcher may build the folder some other way on a
        /// second drive is a decision for Patrick and Djinn, not for the
        /// installer to take by blocking it here (issue #473).
        /// </summary>
        public static string OtherDriveQuestion(string sky, string root)
        {
            return "Skyrim is on " + Letter(sky) + " and this would install Thornswood on " +
                   Letter(root) + ".\n\nThornswood builds a game folder of its own out of your " +
                   "Steam copy of Skyrim, with hard links, and a link cannot cross a drive. On " +
                   Letter(root) + " the launcher cannot build that folder, and it will not let " +
                   "you play until Thornswood and Skyrim are on one drive.\n\nNo goes back so you " +
                   "can pick " + Letter(sky) + ". Yes installs on " + Letter(root) + " anyway.";
        }

        /// <summary>
        /// The line about room on the drive. Under what the install needs is a
        /// refusal in the warning colour; within two gigabytes of it is said
        /// as close.
        /// </summary>
        public static string SayRoom(long free, out string colour)
        {
            if (free < 0) { colour = "Warn"; return "Could not read how much room is on that drive."; }
            if (free < Needed)
            {
                colour = "Bad";
                return "Only " + Gb(free) + " free there, and this needs about " + Gb(Needed) + ". Pick another drive.";
            }
            if (free < Needed + 2L * 1024 * 1024 * 1024)
            {
                colour = "Warn";
                return Gb(free) + " free, and this needs about " + Gb(Needed) + ". That is close, so it may not fit.";
            }
            colour = "Faint";
            return Gb(free) + " free, and this needs about " + Gb(Needed) + ".";
        }

        // --------------------------------------- Thornswood's own Skyrim folder

        /// <summary>
        /// Null when the launcher's OwnGame.PointAt would take this folder,
        /// else its sentence saying why not. <paramref name="full"/> is the
        /// folder as it is saved: quotes off, the full path, no trailing
        /// backslash.
        /// </summary>
        public static string VortexFolderProblem(string folder, out string full)
        {
            full = (folder ?? "").Trim().Trim('"').Trim();
            string f = full;
            try { f = Path.GetFullPath(f).TrimEnd('\\'); }
            catch (Exception e) when (e is ArgumentException || e is NotSupportedException || e is PathTooLongException)
            {
                return f + " is not a folder Thornswood can read, so nothing changed.";
            }
            full = f;
            if (!File.Exists(Path.Combine(f, "SkyrimSE.exe")))
                return f + " has no SkyrimSE.exe in it, so it is not a Skyrim folder and nothing changed. Choose the folder that Open Game Folder opens in Vortex.";
            if (!File.Exists(Path.Combine(f, "Data", "vortex.deployment.json")))
                return "Vortex has not deployed into " + f + ": it has no Data\\vortex.deployment.json, the record Vortex leaves in every folder it deploys to, so nothing changed. Choose the folder that Open Game Folder opens in Vortex.";
            return null;
        }

        /// <summary>
        /// The line under the own folder tick: on or off, where the folder
        /// goes and what it is made from, whether the drive picked can hold
        /// it, and the chosen Vortex folder (issue #906).
        /// </summary>
        public static string SayOwnGame(bool on, string root, string sky, string vortexGame, out bool apart)
        {
            string text;
            if (on)
            {
                text = "On. Thornswood will run from " + Path.Combine(root, "Game") +
                       ", made from what Vortex has deployed" + (vortexGame.Length > 0 ? " in " + vortexGame : "") +
                       ". The launcher makes it by itself once Vortex has deployed the Thornswood collection, " +
                       "and restarts when it is done. Nothing is written into your Steam copy of Skyrim: " +
                       "Thornswood's own files wait in the install folder until the folder is made.";
            }
            else
            {
                text = "Off for now. Thornswood's own files go into your Steam copy of Skyrim, and the launcher asks " +
                       "before it makes the folder; Settings, Maintenance has the button, and once the folder is made " +
                       "the launcher takes Thornswood's files back out of the Steam copy. Thornswood will not start out " +
                       "of a Skyrim shared with other servers, so Play asks for it too.";
            }
            // The same drive logic as the line under the drive buttons: the
            // folder is mostly hard links out of the Steam copy.
            string drive = DriveOf(root);
            apart = sky.Length > 0 && drive.Length > 0 && !SameDrive(sky, drive);
            if (apart)
                text += "\nIt cannot be made on " + Letter(drive) + ", because Skyrim is on " + Letter(sky) +
                        " and a link cannot cross a drive.";
            if (vortexGame.Length > 0)
                text += "\nVortex's folder is set to " + vortexGame + ". Forget the chosen folder to have Thornswood look for it again.";
            return text;
        }
    }
}
