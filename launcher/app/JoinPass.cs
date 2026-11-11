using System;
using System.IO;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// The join pass the game server asks every session for (#937).
    ///
    /// Patrick, 28 Sep: "People should not be allowed in at all if they don't
    /// join from our launcher." The game server only ever sees a profile number
    /// the client picked, so it could not tell this launcher from Skyrim started
    /// by hand or from a launcher that is out of date. Now it ends any session
    /// that has not shown it a pass the site signed.
    ///
    /// When a character is picked at the game's menu (Shell.PollChoice), this
    /// asks the site for a pass for that character (Discord.Pass) and leaves it
    /// in Game\Data\Platform\thornswood-pass.txt, where the front plugin reads
    /// it and sends it to the game server. A pass is good for ten minutes, but
    /// the game server lets it prove one session only, and start one only in
    /// the minute and a half after the site issued it (#1320), so it is
    /// fetched again every minute while the game runs: a session that
    /// reconnects after a server restart, or after its connection dropped, has
    /// a pass it has not used within the minute. A fetch that fails is tried
    /// again a minute later, and the site's reason goes in the log and on the
    /// status line once. The pass itself never goes in a log.
    ///
    /// Only for joining the game: updating needs none, so a launcher of any age
    /// can still reach GitHub and update itself (#5608).
    /// </summary>
    static class JoinPass
    {
        // Inside the game server's ISSUED_MS, a minute and a half (#1320).
        const int RenewMinutes = 1;
        const int RetryMinutes = 1;

        static readonly object gate = new object();
        static int profile;
        static DateTime due = DateTime.MinValue;
        static bool busy;
        static int gotFor;
        static string lastWhy = "";

        static string FilePath
        {
            get { return Path.Combine(Paths.Game, "Data\\Platform\\thornswood-pass.txt"); }
        }

        /// <summary>
        /// The pass's own key (#1320), for the game's client to prove the pass
        /// on its own connection: the pass's mac, a space, then the key, so the
        /// front plugin pairs a key only with the pass it was given for. Its own
        /// file, so a front plugin that knows nothing of it reads the pass file
        /// exactly as before. Straight in Data\Platform, which no release
        /// carries (Ship-Rules.ps1, one machine's own files by kind).
        /// </summary>
        static string KeyPath
        {
            get { return Path.Combine(Paths.Game, "Data\\Platform\\thornswood-pass-key.txt"); }
        }

        /// <summary>
        /// A new Play: nothing from the last session is sent for this one.
        /// </summary>
        public static void Forget()
        {
            lock (gate) { profile = 0; due = DateTime.MinValue; gotFor = 0; lastWhy = ""; }
            try { if (File.Exists(FilePath)) File.Delete(FilePath); }
            catch (Exception ex) { Swallow.Note("JoinPass.Forget", ex); }
            try { if (File.Exists(KeyPath)) File.Delete(KeyPath); }
            catch (Exception ex) { Swallow.Note("JoinPass.Forget, key", ex); }
        }

        /// <summary>A character was picked at the menu: a pass for it, now.</summary>
        public static void For(int profileId, Action<string> say)
        {
            lock (gate) { profile = profileId; due = DateTime.MinValue; }
            Tick(say);
        }

        /// <summary>Every tick while the game runs; fetches when one is due.</summary>
        public static void Tick(Action<string> say)
        {
            int id;
            lock (gate)
            {
                if (profile <= 0 || busy || DateTime.UtcNow < due) return;
                busy = true;
                id = profile;
            }
            ThreadPool.QueueUserWorkItem(delegate { Fetch(id, say); });
        }

        static void Fetch(int id, Action<string> say)
        {
            string why = "";
            string pass = "";
            string key = "";
            try { pass = Discord.Pass(id, out key, out why); }
            catch (Exception ex) { why = "Could not ask thornswood.net for a join pass: " + ex.Message; }

            string line = null;
            lock (gate)
            {
                busy = false;
                // Another character was picked while this one was out.
                if (id != profile) return;
                if (pass.Length > 0)
                {
                    due = DateTime.UtcNow.AddMinutes(RenewMinutes);
                    lastWhy = "";
                    try
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                        // The key first, named by the pass it belongs to, so
                        // the front plugin never pairs a new pass with an old
                        // key or the other way round (#1320).
                        if (key.Length > 0) File.WriteAllText(KeyPath, pass.Substring(pass.LastIndexOf('.') + 1) + " " + key);
                        else if (File.Exists(KeyPath)) File.Delete(KeyPath);
                        File.WriteAllText(FilePath, pass);
                    }
                    catch (Exception ex)
                    {
                        Swallow.Note("JoinPass.Fetch, write", ex);
                        due = DateTime.UtcNow.AddMinutes(RetryMinutes);
                        return;
                    }
                    if (gotFor != id) { gotFor = id; line = "Got the join pass for character " + id + "."; }
                }
                else
                {
                    due = DateTime.UtcNow.AddMinutes(RetryMinutes);
                    if (why != lastWhy)
                    {
                        lastWhy = why;
                        line = "No join pass for character " + id + ", so the server will end this session: " + why;
                    }
                }
            }
            if (line != null && say != null)
            {
                try { say(line); } catch (Exception ex) { Swallow.Note("JoinPass.Fetch, say", ex); }
            }
        }
    }
}
