using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// Once Thornswood runs from its own folder, the Steam copy of Skyrim goes
    /// back to being the person's: Skyrim, and whatever mods they put in it
    /// themselves (#1226).
    ///
    /// Patrick, 29 Sep: "it should only do that if you choose own folder
    /// during install; otherwise it still uses Steam's copy until you turn own
    /// game folder on later, then it should make the own game folder and do
    /// the clean up; for people that already have the game folder, have the
    /// next update do this for them." An install that chose its own folder in
    /// the setup window never wrote into the Steam copy (Paths.OwnFirst). One
    /// that did not wrote Thornswood's files there, as every install before
    /// it did, and once its folder is made those files are the folder's and
    /// have no business in the Steam copy, where a vanilla game started from
    /// Steam would load Thornswood's client and content.
    ///
    /// So the first start that finds the folder made takes them out, once:
    /// the files the installer put there and the ones packs added after it
    /// (Profile\installed-into-game.txt, the list Uninstall works from), and
    /// the files the launcher itself names as Thornswood's (Thornswood.ini and
    /// the thornswood- notes and scripts under Data\Platform). Nothing that
    /// Vortex's record lists, nothing of Bethesda's, and nothing anybody else
    /// put there. Where another SkyMP server's launcher writes the same path
    /// (the client runtime and the client's page), a file goes only when its
    /// bytes are Thornswood's: the recorded client build, or the copy Keep
    /// holds of what an update wrote. The client's settings file, which every
    /// SkyMP server on the machine writes, stays. What it took out, and what
    /// it left and why,
    /// goes into Profile\OwnGame\steam-copy-cleaned.txt and the log; once
    /// that note is written it never runs again.
    /// </summary>
    static partial class OwnGame
    {
        /// <summary>The list the installer and packs keep of what they put into the Steam copy.</summary>
        static string InstalledList { get { return Path.Combine(Paths.ProfileDir, "installed-into-game.txt"); } }

        /// <summary>
        /// Paths other SkyMP servers' launchers write too. Thornswood's copy is
        /// told from theirs by its bytes, never by the path.
        /// </summary>
        static readonly string[] SharedPages = {
            "Data\\Platform\\UI\\index.html",
            "Data\\Platform\\UI\\build.js",
        };

        static bool SharedWithOthers(string rel)
        {
            if (ClientFile(rel)) return true;
            foreach (string s in SharedPages)
                if (rel.Equals(s, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// Takes Thornswood's files out of the Steam copy once the own folder
        /// is made (see the class notes), and removes a Profile\Payload left
        /// by a Make whose last step stopped. Runs at every start and does
        /// nothing once its note is written. Returns a line for the log, or
        /// null when there was nothing to do.
        /// </summary>
        public static string CleanSteamCopy(Config cfg)
        {
            if (Paths.Collection || !Active) return null;
            // Not while a refresh reads the installer's list (OwnGameKinds.cs).
            lock (folderWork) return CleanSteamCopyNow(cfg);
        }

        static string CleanSteamCopyNow(Config cfg)
        {
            var said = new List<string>();
            string payload = DropPayload();
            if (payload != null) said.Add(payload);
            if (File.Exists(CleanedFile)) return said.Count > 0 ? string.Join(" ", said.ToArray()) : null;
            // The installer's list is about to be emptied; what it says is
            // Thornswood's is kept in OwnGame's own record first (#1232).
            KeepInstalledList();

            string steam = Source(cfg);
            var removed = new List<string>();
            var leftIn = new List<string>();
            int failed = 0;
            var stuck = new List<string>();
            if (steam.Length > 0 && Directory.Exists(steam) && !SameFolder(steam, Folder))
            {
                string fence = Path.GetFullPath(steam).TrimEnd('\\') + "\\";
                var dirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (KeyValuePair<string, string> kv in Leftovers(cfg, steam, leftIn))
                {
                    string full = Path.Combine(steam, kv.Key);
                    try
                    {
                        File.SetAttributes(full, FileAttributes.Normal);
                        File.Delete(full);
                        removed.Add(kv.Key);
                        dirs.Add(Path.GetDirectoryName(full));
                    }
                    catch (Exception ex)
                    {
                        // Held open, most likely by a game started from Steam:
                        // tried again at the next start, because the note is
                        // not written while anything is left to take out.
                        Swallow.Note("OwnGame.CleanSteamCopy, deleting " + full, ex);
                        failed++;
                        stuck.Add(kv.Key);
                    }
                }
                // Folders that held only Thornswood's files, deepest first.
                // Never recursive: a folder with anything left in it stays.
                var ordered = new List<string>(dirs);
                ordered.Sort(delegate(string a, string b) { return b.Length.CompareTo(a.Length); });
                foreach (string d in ordered)
                {
                    string cur = d;
                    while (!string.IsNullOrEmpty(cur) && (cur.TrimEnd('\\') + "\\").StartsWith(fence, StringComparison.OrdinalIgnoreCase)
                           && !SameFolder(cur, steam))
                    {
                        try
                        {
                            if (!Directory.Exists(cur) || Directory.GetFileSystemEntries(cur).Length != 0) break;
                            Directory.Delete(cur, false);
                            cur = Path.GetDirectoryName(cur);
                        }
                        catch { break; }
                    }
                }
                ForgetInstalled(steam, stuck);
            }

            if (failed == 0)
            {
                var note = new List<string>();
                note.Add("at=" + DateTime.Now.ToString("o"));
                note.Add("steam=" + steam);
                foreach (string r in removed) note.Add("removed|" + r);
                foreach (string l in leftIn) note.Add("left|" + l);
                WriteRecord(CleanedFile, note);
            }

            if (removed.Count > 0)
            {
                var names = new List<string>();
                for (int i = 0; i < removed.Count && i < 8; i++) names.Add(removed[i]);
                said.Add("Took " + removed.Count.ToString("n0") + " of Thornswood's own " + (removed.Count == 1 ? "file" : "files") +
                         " out of the Steam copy in " + steam + ", now that Thornswood runs from its own folder: " +
                         string.Join(", ", names.ToArray()) + (removed.Count > names.Count ? " and " + (removed.Count - names.Count).ToString("n0") + " more" : "") +
                         ". Skyrim, Vortex's mods and your own mods there were not touched, and the full list is in " + CleanedFile + ".");
            }
            if (leftIn.Count > 0)
                said.Add(leftIn.Count + " left in the Steam copy because they are not Thornswood's for certain: " + string.Join("; ", leftIn.ToArray()) + ".");
            if (failed > 0)
                said.Add(failed + " of Thornswood's files in the Steam copy could not be taken out yet, most likely because a game started from Steam has them open. The launcher tries again the next time it starts.");
            return said.Count > 0 ? string.Join(" ", said.ToArray()) : null;
        }

        /// <summary>
        /// What CleanSteamCopy takes out of <paramref name="steam"/>, path under
        /// it to why. <paramref name="leftIn"/> gets each file on Thornswood's
        /// record that stays, with the reason.
        /// </summary>
        static Dictionary<string, string> Leftovers(Config cfg, string steam, List<string> leftIn)
        {
            var take = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            HashSet<string> deployed = DeployedIn(steam);
            string fence = Path.GetFullPath(steam).TrimEnd('\\') + "\\";

            var candidates = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            // The installer's record and what packs added to it.
            try
            {
                if (File.Exists(InstalledList))
                    foreach (string raw in SetupOwnership.PathsIn(InstalledList, steam))
                    {
                        string rel = (raw ?? "").Trim().Replace('/', '\\').TrimStart('\\');
                        if (rel.Length > 0 && Tidy(rel)) candidates[rel] = "on the installer's record";
                    }
            }
            catch (Exception ex) { Swallow.Note("OwnGame.Leftovers, reading " + InstalledList, ex); }
            // The launcher's own names.
            foreach (string sub in new string[] { "Data\\SKSE\\Plugins", "Data\\Platform", "Data\\Platform\\Plugins", "Data\\Platform\\UI" })
            {
                string dir = Path.Combine(steam, sub);
                try
                {
                    if (!Directory.Exists(dir)) continue;
                    foreach (string f in Directory.GetFiles(dir))
                    {
                        string rel = sub + "\\" + Path.GetFileName(f);
                        if (NamedOurs(rel) && !candidates.ContainsKey(rel)) candidates[rel] = "Thornswood's by name";
                    }
                }
                catch (Exception ex) { Swallow.Note("OwnGame.Leftovers, listing " + dir, ex); }
            }
            // The client runtime, when it is Thornswood's recorded build.
            foreach (ClientRuntime.Entry e in ClientRuntime.Recorded())
                if (!candidates.ContainsKey(e.Rel)) candidates[e.Rel] = "the client runtime";

            foreach (KeyValuePair<string, string> kv in candidates)
            {
                string rel = kv.Key;
                string full;
                try { full = Path.GetFullPath(Path.Combine(steam, rel)); }
                catch { continue; }
                if (!full.StartsWith(fence, StringComparison.OrdinalIgnoreCase)) continue;
                if (!File.Exists(full)) continue;
                if (deployed.Contains(rel)) continue;
                if (Bethesdas(rel)) { leftIn.Add(rel + " (Skyrim's own)"); continue; }
                if (SharedWithOthers(rel))
                {
                    if (!BytesAreOurs(rel, full))
                    {
                        // Only worth saying when Thornswood's record names it;
                        // another server's client that was never ours is
                        // simply not looked at.
                        if (kv.Value != "the client runtime") leftIn.Add(rel + " (other SkyMP servers write this file too, and its bytes are not Thornswood's)");
                        continue;
                    }
                }
                take[rel] = kv.Value;
            }
            return take;
        }

        /// <summary>
        /// Skyrim's own files, never taken out whatever a record says: the
        /// pinned build's own by its list (OwnGameKinds.cs), and these names
        /// in whatever build the Steam copy is on.
        /// </summary>
        static bool Bethesdas(string rel)
        {
            if (SkyrimOwn(rel)) return true;
            foreach (string m in Masters)
                if (rel.Equals(m, StringComparison.OrdinalIgnoreCase)) return true;
            if (Regex.IsMatch(rel, @"^Data\\(Skyrim - [^\\]+\.bsa|_ResourcePack\.bsa|cc[^\\]+\.(esm|esl|esp|bsa))$", RegexOptions.IgnoreCase)) return true;
            if (rel.StartsWith("Data\\Video\\", StringComparison.OrdinalIgnoreCase)) return true;
            if (rel.IndexOf('\\') >= 0) return false;
            return Regex.IsMatch(rel, @"^(SkyrimSE\.exe|SkyrimSELauncher\.exe|steam_api64\.dll|bink2w64\.dll|Skyrim\.ccc|installscript\.vdf|Skyrim_Default\.ini|High\.ini|Low\.ini|Medium\.ini|Ultra\.ini)$", RegexOptions.IgnoreCase);
        }

        /// <summary>
        /// A file at a path other SkyMP servers write too is Thornswood's when
        /// its bytes are: the recorded client build, or the copy Keep holds of
        /// what a Thornswood update wrote. Not the copy in Thornswood's own
        /// folder: a folder made from the Steam copy took whatever page was
        /// there, another server's included, so it proves nothing.
        /// </summary>
        static bool BytesAreOurs(string rel, string full)
        {
            string sha = ClientRuntime.Sha256Of(full);
            if (sha.Length == 0) return false;
            foreach (ClientRuntime.Entry e in ClientRuntime.Recorded())
                if (e.Rel.Equals(rel, StringComparison.OrdinalIgnoreCase) && e.Sha == sha) return true;
            string kept = Path.Combine(Keep.Dir, rel);
            try { if (File.Exists(kept) && ClientRuntime.Sha256Of(kept) == sha) return true; }
            catch (Exception ex) { Swallow.Note("OwnGame.BytesAreOurs, " + kept, ex); }
            return false;
        }

        /// <summary>
        /// installed-into-game.txt once the Steam copy is cleaned: only what
        /// could not be taken out yet stays on it, for the next start. What
        /// came out is gone, and what stays in the Steam copy stays because it
        /// is not Thornswood's for certain (Vortex's, Skyrim's own, or another
        /// server's bytes at a path Thornswood also writes), so Uninstall must
        /// not take it either. Removed when nothing is left on it.
        /// </summary>
        static void ForgetInstalled(string steam, List<string> stuck)
        {
            try
            {
                if (!File.Exists(InstalledList)) return;
                var still = new HashSet<string>(stuck, StringComparer.OrdinalIgnoreCase);
                var keep = new List<string>();
                foreach (string raw in SetupOwnership.PathsIn(InstalledList, steam))
                {
                    string rel = (raw ?? "").Trim();
                    if (rel.Length > 0 && still.Contains(rel.Replace('/', '\\').TrimStart('\\'))) keep.Add(rel);
                }
                if (keep.Count == 0) File.Delete(InstalledList);
                else WriteRecord(InstalledList, keep);
            }
            catch (Exception ex) { Swallow.Note("OwnGame.ForgetInstalled", ex); }
        }
    }
}
