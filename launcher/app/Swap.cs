using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace Thornswood
{
    // Skyrim always reads its settings and saves from fixed folders under the
    // user's profile. To keep this build from colliding with any other Skyrim
    // on the machine, those folders are pointed here for the length of a play
    // session and put back afterwards.
    static class Swap
    {
        static bool IsLink(string p) { return Junction.IsLink(p); }

        static void DropLink(string p)
        {
            // Removes the link, never the folder it points at.
            try { Directory.Delete(p); } catch (Exception ex) { Swallow.Note("Swap.DropLink, " + p, ex); }
        }

        static bool IsEmpty(string p)
        {
            try { return Directory.GetFileSystemEntries(p).Length == 0; }
            catch { return false; }
        }

        static bool MakeLink(string link, string target)
        {
            string why;
            return Junction.Create(link, target, out why);
        }

        static string[] Pairs(out string[] ours)
        {
            ours = new string[] { Paths.MyGames, Paths.LocalAD };
            return new string[] { Paths.WinMyGames, Paths.WinLocalAD };
        }

        /// <summary>Undo the redirect. Safe to call any time, including after a crash.</summary>
        public static bool Restore()
        {
            bool had = File.Exists(Paths.StateFile);
            bool did = false;
            string[] ours;
            foreach (string win in Pairs(out ours))
            {
                string bak = win + ".st-backup";
                if (IsLink(win)) { DropLink(win); did = true; }

                // A redirect that fell over half way leaves a real empty folder
                // here and the person's own folder still sitting in the backup.
                // The move below will not put a folder back onto a name that
                // already exists, so the empty one is cleared out of its way.
                // Only when it is empty, because anything inside it is theirs.
                if (Directory.Exists(win) && !IsLink(win) && Directory.Exists(bak) && IsEmpty(win))
                {
                    try { Directory.Delete(win); } catch (Exception ex) { Swallow.Note("Swap.Restore, clearing " + win, ex); }
                }

                // A failure here leaves the person's own settings and saves
                // in the backup folder, so it is written down even though
                // Restore carries on as it always has.
                if (Directory.Exists(bak) && !Directory.Exists(win))
                {
                    try { Directory.Move(bak, win); did = true; } catch (Exception ex) { Swallow.Note("Swap.Restore, moving " + bak + " back", ex); }
                }
            }
            try { if (had) File.Delete(Paths.StateFile); } catch (Exception ex) { Swallow.Note("Swap.Restore, the state file", ex); }
            return did || had;
        }

        /// <summary>
        /// True when Windows' Skyrim folders are still pointed at this build,
        /// or one is still moved aside, which is what a game that fell over
        /// leaves behind: a junction where the folder was, a .st-backup beside
        /// an empty or missing folder, or Profile\swap.json. Reads only. Scan
        /// asks it while Skyrim is not running, and Fix then runs Restore
        /// (#2627). While the game runs the redirect is the point of it.
        /// </summary>
        public static bool LeftRedirected()
        {
            try
            {
                if (File.Exists(Paths.StateFile)) return true;
                string[] ours;
                foreach (string win in Pairs(out ours))
                {
                    if (IsLink(win)) return true;
                    string bak = win + ".st-backup";
                    if (Directory.Exists(bak) && (!Directory.Exists(win) || IsEmpty(win))) return true;
                }
            }
            catch (Exception ex) { Swallow.Note("Swap.LeftRedirected", ex); }
            return false;
        }

        /// <summary>
        /// The shipped settings files RepairConfigs would put back because
        /// they are missing, by name, and nothing written (#2627). The plugin
        /// lists are Verify's, so they are not named here. Empty under the
        /// collection, where none of this is the launcher's.
        /// </summary>
        public static List<string> MissingConfigs()
        {
            var l = new List<string>();
            if (Paths.Collection) return l;
            try
            {
                if (!Directory.Exists(Paths.Golden)) return l;
                foreach (string f in Directory.GetFiles(Paths.Golden))
                {
                    string name = Path.GetFileName(f);
                    if (Path.GetExtension(f).ToLowerInvariant() != ".ini") continue;
                    if (!File.Exists(Path.Combine(Paths.MyGames, name))) l.Add(name);
                }
            }
            catch (Exception ex) { Swallow.Note("Swap.MissingConfigs", ex); }
            return l;
        }

        /// <summary>
        /// Fix's half of MissingConfigs (#2627): the shipped settings files
        /// that are missing, copied back, and nothing else. Not RepairConfigs,
        /// which also lays the shipped plugin lists over the live ones and
        /// would take the server's order back out of a list Fix had put it
        /// into. Returns how many were copied.
        /// </summary>
        public static int PutBackMissingConfigs()
        {
            int n = 0;
            foreach (string name in MissingConfigs())
            {
                try
                {
                    Directory.CreateDirectory(Paths.MyGames);
                    File.Copy(Path.Combine(Paths.Golden, name), Path.Combine(Paths.MyGames, name), false);
                    n++;
                }
                catch (Exception ex) { Swallow.Note("Swap.PutBackMissingConfigs, " + name, ex); }
            }
            return n;
        }

        /// <summary>
        /// Moves a folder aside. Windows says access denied when anything still
        /// holds the folder open, and a game that has just fallen over can
        /// still hold it after it has stopped showing in the task list. So a
        /// refused move closes whatever is left of Skyrim, which returns once
        /// those processes have exited and Windows has closed every handle
        /// they held (Checks.CloseGame), and moves once more. A move refused
        /// after that is held by something that is not the game, and waiting
        /// does not make it let go.
        ///
        /// Until #4628 the second move was ten, 400 ms apart: four seconds of
        /// the launcher not answering, hoping the handles had closed by one
        /// of them.
        /// </summary>
        static void MoveAside(string from, string to)
        {
            try { Directory.Move(from, to); return; }
            catch (UnauthorizedAccessException ex) { Swallow.Note("Swap.MoveAside, first move UnauthorizedAccess", ex); }
            catch (IOException ex) { Swallow.Note("Swap.MoveAside, first move IO", ex); }

            try { Checks.CloseGame(); } catch (Exception ex) { Swallow.Note("Swap.MoveAside, CloseGame", ex); }

            try { Directory.Move(from, to); }
            catch (Exception ex) when (ex is UnauthorizedAccessException || ex is IOException) { throw StillHeld(from, ex); }
        }

        /// <summary>
        /// What a refused second move says: the folder, and the cause worth
        /// acting on rather than the word Windows used. A game that would not
        /// go is named by StuckReport; anything else is not Skyrim.
        /// </summary>
        static Exception StillHeld(string from, Exception refused)
        {
            string left = "";
            try { left = Checks.StuckReport(); } catch (Exception ex) { Swallow.Note("Swap.MoveAside, StuckReport", ex); }
            return new Exception(
                "Windows would not let go of\n\n    " + from + "\n\n" +
                (left.Length > 0
                    ? left
                    : "Something other than Skyrim still has it open (" + refused.Message.TrimEnd('.') + "). " +
                      "If it happens again straight after a restart, that folder is most " +
                      "likely in OneDrive, and moving it out of OneDrive fixes it for good."),
                refused);
        }

        public static void Apply()
        {
            // Under the collection, Vortex owns this. A Vortex profile with
            // local saves and local game settings turned on redirects the same
            // two folders, and two things junctioning one folder is how saves
            // end up somewhere neither of them looks. So the launcher stands
            // down and leaves the folders alone.
            if (Paths.Collection) return;

            Directory.CreateDirectory(Paths.MyGames);
            Directory.CreateDirectory(Paths.LocalAD);
            Directory.CreateDirectory(Path.Combine(Paths.MyGames, "Saves"));

            string[] ours;
            string[] wins = Pairs(out ours);
            for (int i = 0; i < wins.Length; i++)
            {
                string win = wins[i], bak = win + ".st-backup";
                if (IsLink(win)) DropLink(win);
                else if (Directory.Exists(win))
                {
                    if (Directory.Exists(bak))
                        try { Directory.Move(bak, bak + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss")); } catch (Exception ex) { Swallow.Note("Swap.Apply, renaming leftover backup", ex); }
                    MoveAside(win, bak);
                }
                Directory.CreateDirectory(Path.GetDirectoryName(win));
                if (!MakeLink(win, ours[i]))
                    throw new Exception("Could not redirect " + win);
            }
            File.WriteAllText(Paths.StateFile, "{\"swappedAt\":\"" + DateTime.Now.ToString("o") + "\"}");
        }

        // The plugin lists are not anyone's to keep. The server compares load
        // orders, so those go back exactly as shipped every single time.
        static readonly string[] Forced = new string[] { "plugins.txt", "loadorder.txt" };

        /// <summary>
        /// Puts the shipped originals back. The plugin lists always. The ini
        /// files only when they are missing, because everything in
        /// SkyrimPrefs.ini is changed from inside the game: volume, gamma,
        /// difficulty, view distance. Copying the shipped one over the top
        /// after every update is exactly why those changes kept vanishing.
        /// </summary>
        public static int RepairConfigs() { return RepairConfigs(false); }

        /// <param name="overwriteSettings">
        /// True only for the Fix button, where putting the originals back over
        /// someone's own settings is the whole point of pressing it.
        /// </param>
        public static int RepairConfigs(bool overwriteSettings)
        {
            int n = 0;

            // Under the collection none of this is the launcher's to write.
            // The plugin list belongs to the active Vortex profile, and
            // putting the shipped one over it would undo the install somebody
            // just did and leave Vortex and the game disagreeing about what is
            // loaded. The ini files are the profile's too. A mismatch here is
            // fixed in Vortex, not by copying files over the top of it, which
            // is what the launcher says when it finds one.
            if (Paths.Collection) return 0;

            if (!Directory.Exists(Paths.Golden)) return 0;
            foreach (string f in Directory.GetFiles(Paths.Golden))
            {
                string name = Path.GetFileName(f);
                string dest = Path.GetExtension(f).ToLowerInvariant() == ".ini" ? Paths.MyGames : Paths.LocalAD;
                Directory.CreateDirectory(dest);
                string target = Path.Combine(dest, name);

                bool forced = false;
                for (int i = 0; i < Forced.Length; i++)
                    if (string.Equals(name, Forced[i], StringComparison.OrdinalIgnoreCase)) forced = true;

                if (!forced && !overwriteSettings && File.Exists(target)) continue;

                File.Copy(f, target, true);
                n++;
            }
            return n;
        }
    }
}
