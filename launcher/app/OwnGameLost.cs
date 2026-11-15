using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Files Thornswood's own folder had and has lost (#2627): one the
    /// folder's record says is there and is not. A virus scanner that took
    /// skse64_loader.exe, a file somebody deleted by hand, a disk that lost a
    /// folder. A refresh does not see these, because it looks only at what
    /// Vortex's record says moved (#2210), so before this nothing but making
    /// the folder again brought them back.
    ///
    /// Scan asks Lost, which reads and writes nothing; Fix puts Vortex's back
    /// from Vortex's own mods folder (PutBackLost), Skyrim's own come from the
    /// Downgrade, which asks first, and Thornswood's own come back with the
    /// release they belong to (Updater.Resync).
    /// </summary>
    static partial class OwnGame
    {
        /// <summary>What Lost found, by whose each file is.</summary>
        public sealed class LostFiles
        {
            public readonly List<string> Vortex = new List<string>();
            public readonly List<string> Skyrim = new List<string>();
            public readonly List<string> Ours = new List<string>();
            public int Count { get { return Vortex.Count + Skyrim.Count + Ours.Count; } }
        }

        /// <summary>
        /// Every file the folder's record lists as Vortex's (V) or Skyrim's own
        /// (O) that is not in the folder, and every game file of the release
        /// this install synced to (Updater.ReleaseFiles) that is not, except
        /// the six client runtime files, which ClientRuntime looks after.
        /// Empty when the folder is not made. Reads only.
        ///
        /// Vortex's are asked only while the folder matches what Vortex
        /// deployed (NeedsRefresh false, which the caller knows): after a new
        /// deployment the record is the old one, and the refresh is what puts
        /// the folder right. Thornswood's own are read from the release's list
        /// and not from files.txt, because an update does not write files.txt.
        /// </summary>
        public static LostFiles Lost(bool vortexToo)
        {
            var lost = new LostFiles();
            if (!Active) return lost;
            string game = Paths.Game;
            foreach (KeyValuePair<string, Rec> kv in ReadFiles())
            {
                char origin = kv.Value.Origin;
                if (origin != 'O' && !(vortexToo && origin == 'V')) continue;
                if (There(game, kv.Key)) continue;
                if (origin == 'V') lost.Vortex.Add(kv.Key); else lost.Skyrim.Add(kv.Key);
            }
            List<string> release = null;
            try { release = Updater.ReleaseFiles(); }
            catch (Exception ex) { Swallow.Note("OwnGame.Lost, reading the release's file list", ex); }
            if (release != null)
                foreach (string rel in release)
                    if (!ClientFile(rel) && !There(game, rel)) lost.Ours.Add(rel);
            lost.Vortex.Sort(StringComparer.OrdinalIgnoreCase);
            lost.Skyrim.Sort(StringComparer.OrdinalIgnoreCase);
            lost.Ours.Sort(StringComparer.OrdinalIgnoreCase);
            return lost;
        }

        /// <summary>True unless the file is certainly not there: a path that cannot be asked counts as there.</summary>
        static bool There(string game, string rel)
        {
            try { return File.Exists(Path.Combine(game, rel)); }
            catch (Exception ex) { Swallow.Note("OwnGame.Lost, asking whether " + rel + " is there", ex); return true; }
        }

        /// <summary>
        /// Puts each of <paramref name="rels"/>, Vortex's files the folder
        /// lost, back from Vortex's own mods folder, linked or copied the way
        /// the folder keeps it (MustCopy). The record already lists each, so
        /// it is not changed. The caller holds the folder (Alone). Returns how
        /// many went back; says each one that could not, and why.
        /// </summary>
        public static int PutBackLost(Config cfg, IList<string> rels, Action<string> say)
        {
            if (say == null) say = delegate(string m) { };
            if (!Active || rels == null || rels.Count == 0) return 0;
            string src = "";
            try { src = DeploysInto(cfg); }
            catch (Exception ex) { Swallow.Note("OwnGame.PutBackLost, asking which folder Vortex deploys into", ex); }
            if (src.Length == 0)
            {
                say("Fix could not find the folder Vortex deploys into, so " + rels.Count + " of Vortex's files were not put back. In Vortex, Mods, Open, Open Game Folder shows which folder it uses.");
                return 0;
            }
            Record rec;
            HashSet<string> deployed;
            try
            {
                rec = Staged(src);
                deployed = Deployed(src);
            }
            catch (Exception ex)
            {
                say("Vortex's record in " + src + " could not be read (" + Failure.Why("OwnGameLost, Vortex's record", ex, src) + "), so its files were not put back.");
                return 0;
            }
            int n = 0, missing = 0;
            string game = Paths.Game;
            foreach (string rel in rels)
            {
                string from;
                if (!rec.From.TryGetValue(rel, out from) || string.IsNullOrEmpty(from) || !File.Exists(from))
                {
                    missing++;
                    continue;
                }
                string dest = Path.Combine(game, rel);
                try
                {
                    if (File.Exists(dest)) continue;
                    bool linked;
                    Place(from, dest, MustCopy(rel, deployed), out linked);
                    n++;
                }
                catch (Exception ex) { say(rel + " could not be put back (" + Failure.Why("OwnGameLost, " + rel, ex, rel) + "). Close Skyrim and Vortex and press Fix again."); }
            }
            if (n > 0) say(n + " of Vortex's file" + (n == 1 ? "" : "s") + " that Thornswood's folder had lost " + (n == 1 ? "is" : "are") + " back, from Vortex's own copies.");
            if (missing > 0)
                say(missing + " of the files Thornswood's folder lost " + (missing == 1 ? "is" : "are") + " not in Vortex's mods folder either. In Vortex, press Deploy Mods, then press Scan.");
            return n;
        }
    }
}
