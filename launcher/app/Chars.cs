using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Thornswood
{
    // The character list, and what actually keeps characters apart is the
    // profile id.
    //
    // Under SkyMP a character is not a save file. It is a change form held by
    // the server, and which one you get is decided by gameData.profileId in
    // skymp5-client-settings.txt: connect on profile 1 and the server hands
    // back profile 1's body, inventory and face, whatever Skyrim's own menu
    // says. That is why New Game never produced a new character.
    //
    // Until 20 September the launcher chose the id. Play opened a bar with two
    // slots, each slot owned an id, and a slot's button wrote that id into the
    // client settings before the game started; an empty slot took an id nobody
    // had used and a trade and town dialog ran first. All of that is gone.
    // Play means Play: the person picks their character at the game's own
    // main menu, which our plugin draws from a file this class writes
    // (Data\Platform\thornswood-characters.json) and answers with one line in
    // Data\Platform\thornswood-choice.txt, which Shell polls while the game
    // runs. The client settings carry chooseAtMenu = true and the id played
    // last, so the client waits at the menu rather than connecting as anybody.
    //
    // What stays here is the list itself, profiles.txt: one row per id this
    // install has played, plus one spare row on slot 0 holding the id the
    // menu's New character will use, minted under the Discord account the
    // install is linked to. Ids are never reused inside one install.
    //
    // The save folder is still redirected, to one folder for the whole install
    // rather than one per slot. SkyrimPlatform writes its own .ess as it works
    // and there is no reason for them to land among somebody's own saves.
    static class Chars
    {
        public static string Home { get { return Path.Combine(Paths.ProfileDir, "Characters"); } }

        // One saves folder for the whole install, where a folder per slot was
        // until 20 September. Nothing on this disk decides who the character
        // is (SkyMP loads the character the server holds), so there is
        // nothing to keep apart.
        static string SavesDir { get { return Path.Combine(Home, "saves"); } }

        // One line per character, and one for the spare:
        //
        //     slot  profileId  lastPlayedTicks  playedSeconds  trade  town  discordId
        //
        // Deliberately not JSON. The launcher's only serializer is the data
        // contract one, which cannot round trip a shape it was not told about in
        // advance, and this file has to survive being read by a version that
        // adds a field. Everything past the first two is optional on the way in,
        // so a file written before a field existed still reads.
        //
        // A dash stands for an empty trade or town. Space separated fields and
        // empty strings do not mix. Nothing reads the trade or the town any
        // more (the launcher stopped asking on 20 September); they are carried
        // so a file written before that still reads and writes back the same.
        //
        // Slot 0 is the spare: an id minted and written down before the game
        // starts, never played, so the site's allowed list can carry it before
        // anybody picks New character at the menu. Any other slot number is a
        // character. New rows take the next free number; there is no longer a
        // limit of two.
        //
        // The last field is the Discord account the row's id was minted under,
        // a dash when nobody knows (every row written before 24 September).
        // Only the spare's is read; see EnsureSpare for why. An older launcher
        // reads the first six fields and writes the seventh back as nothing,
        // which this one takes as not known and mints a fresh spare for.
        static string ProfileFile { get { return Path.Combine(Home, "profiles.txt"); } }

        // The two files the plugin and the launcher pass between them at the
        // main menu. Both in Data\Platform, the one folder each end finds
        // without knowing anything about the other (see Voice.ChannelDirs).
        static string CharactersFile
        {
            get { return Path.Combine(Paths.Game, "Data\\Platform\\thornswood-characters.json"); }
        }
        static string ChoiceFile
        {
            get { return Path.Combine(Paths.Game, "Data\\Platform\\thornswood-choice.txt"); }
        }
        // The delete icon at the menu: one profile id per line, appended by the
        // plugin, read by Shell's poll while the game runs, removed at Prepare.
        static string ForgetFile
        {
            get { return Path.Combine(Paths.Game, "Data\\Platform\\thornswood-forget.txt"); }
        }
        // Ids this install has forgotten, so they are never minted again: a
        // returning id would hand back the character that was deleted.
        static string RetiredFile { get { return Path.Combine(Home, "retired.txt"); } }

        // Read used to fill this from the newest save's header as well. That
        // went with the per slot folders on 20 September: one shared folder
        // has no save that belongs to any one character, and under SkyMP the
        // header was scaffolding anyway (see Scrub).
        public class Who
        {
            public int Slot;
            public bool Empty = true;
            public int ProfileId;
            public DateTime LastPlayed;
            // Seconds this character has actually been in the game, added up
            // by the launcher across every session. Skyrim keeps its own figure
            // but it is inside the save, and under SkyMP the character is on
            // the server, so there is often no save here to read it out of.
            public long PlaySeconds;
        }

        // ------------------------------------------------------- profile ids

        class Row
        {
            public int Slot;
            public int Id;
            public DateTime Played;
            public long Seconds;
            public string Trade = "";
            public string Town = "";
            // The Discord id this row's id was minted under, "" when not known.
            public string Owner = "";
        }

        static List<Row> Rows()
        {
            var l = new List<Row>();
            try
            {
                if (!File.Exists(ProfileFile)) return l;
                foreach (string line in File.ReadAllLines(ProfileFile))
                {
                    string[] p = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (p.Length < 2) continue;
                    var r = new Row();
                    if (!int.TryParse(p[0], out r.Slot)) continue;
                    if (!int.TryParse(p[1], out r.Id)) continue;
                    long ticks;
                    if (p.Length > 2 && long.TryParse(p[2], out ticks))
                    {
                        try { r.Played = new DateTime(ticks); } catch (Exception ex) { Swallow.Note("Chars.Rows, datetime", ex); }
                    }
                    long secs;
                    if (p.Length > 3 && long.TryParse(p[3], out secs) && secs >= 0) r.Seconds = secs;
                    if (p.Length > 4 && p[4] != "-") r.Trade = p[4];
                    if (p.Length > 5 && p[5] != "-") r.Town = p[5];
                    if (p.Length > 6 && p[6] != "-") r.Owner = p[6];
                    l.Add(r);
                }
            }
            catch (Exception ex) { Swallow.Note("Chars.Rows", ex); }
            return l;
        }

        static void Save(List<Row> rows)
        {
            try
            {
                Directory.CreateDirectory(Home);
                var sb = new StringBuilder();
                foreach (Row r in rows)
                {
                    sb.AppendLine(r.Slot + " " + r.Id + " " + r.Played.Ticks + " " + r.Seconds +
                                  " " + Dash(r.Trade) + " " + Dash(r.Town) + " " + Dash(r.Owner));
                }
                // Whole or not at all (#3128): Relist reads this file on a
                // pool thread while the game runs, and a read in the middle
                // of a plain write sees half a list.
                string next = ProfileFile + ".new";
                File.WriteAllText(next, sb.ToString());
                if (File.Exists(ProfileFile)) File.Replace(next, ProfileFile, null);
                else File.Move(next, ProfileFile);
            }
            catch (Exception ex) { Swallow.Note("Chars.Save, write", ex); }
        }

        static string Dash(string s)
        {
            if (string.IsNullOrEmpty(s)) return "-";
            // Whitespace would split into two fields and shift everything after
            // it. No gamemode key has any, but this file is also written by hand
            // when somebody is poking at it.
            return s.Replace(' ', '_');
        }

        static Row Find(List<Row> rows, int slot)
        {
            foreach (Row r in rows) if (r.Slot == slot) return r;
            return null;
        }

        static Row FindId(List<Row> rows, int profileId)
        {
            foreach (Row r in rows) if (r.Id == profileId) return r;
            return null;
        }

        /// <summary>
        /// The lowest free slot number, 1 on an empty list. The number is the
        /// slot the menu draws the character in, fixed, and a forgotten
        /// character's number is free again. "Highest plus one" climbed past
        /// the allowance: on 20 September the menu read 1 empty, 2 empty, 3,
        /// 4, 5 for an account with three slots and three characters.
        /// </summary>
        static int NextSlot(List<Row> rows)
        {
            int n = 1;
            while (Find(rows, n) != null) n++;
            return n;
        }

        /// <summary>
        /// One tidy before the list is written for the menu: a row numbered
        /// above the allowance moves down into a free number at or below it,
        /// highest number first (Slots.Tidy is the rule), and the file is
        /// saved when anything moved. Rows at or below the allowance never
        /// move, so the menu's fixed slots stay where the person left them.
        /// Every row with a number takes part, played or not, because
        /// NextSlot counts them all as holding one and a move must not land
        /// on a number another row holds. Returns a line for the log naming
        /// what moved, or null when nothing did.
        /// </summary>
        static string TidySlots(List<Row> rows, int allowance)
        {
            var numbered = new List<Row>();
            foreach (Row r in rows) if (r.Slot > 0) numbered.Add(r);
            var before = new int[numbered.Count];
            for (int i = 0; i < numbered.Count; i++) before[i] = numbered[i].Slot;
            int[] after = Slots.Tidy(before, allowance);
            var moved = new List<string>();
            for (int i = 0; i < numbered.Count; i++)
            {
                if (after[i] == before[i]) continue;
                numbered[i].Slot = after[i];
                moved.Add("profile " + numbered[i].Id + " from slot " + before[i] + " to slot " + after[i]);
            }
            if (moved.Count == 0) return null;
            Save(rows);
            return "Slots tidied for an allowance of " + allowance + ": " +
                   string.Join(", ", moved.ToArray()) + ".";
        }

        /// <summary>
        /// The slot number of a character staff have killed for good (#1010).
        /// Patrick, 28 September: the character "can never be played or
        /// selected again" and the account can make a new one. So its row
        /// leaves the numbered slots, which frees its number for New
        /// character, and is kept (never minted again, shown on the menu as
        /// dead, forgettable with the bin) rather than deleted.
        /// </summary>
        const int DeadSlot = -1;

        /// <summary>
        /// Every row the site says is dead for good moves to DeadSlot, and the
        /// file is saved when any did. Returns a line for the log naming them,
        /// or null. Roster.Refresh has run first.
        /// </summary>
        static string BuryDead(List<Row> rows)
        {
            var moved = new List<string>();
            foreach (Row r in rows)
            {
                if (r.Slot <= 0 || r.Id <= 0) continue;
                bool isDead = false;
                try { isDead = Roster.Dead(r.Id); } catch { isDead = false; }
                if (!isDead) continue;
                moved.Add("profile " + r.Id + " from slot " + r.Slot);
                r.Slot = DeadSlot;
            }
            if (moved.Count == 0) return null;
            Save(rows);
            return "Staff have killed " + (moved.Count == 1 ? "a character" : moved.Count + " characters") +
                   " for good, so the slot is free for a new one: " + string.Join(", ", moved.ToArray()) + ".";
        }

        /// <summary>
        /// Every row in DeadSlot whose PK an admin undid (#1010, Patrick,
        /// 29 September) goes back into the lowest free slot, and the file is
        /// saved when any did. The site undoes a PK only while the account has
        /// a free slot, and TidySlots brings the row under the allowance after
        /// this. Only ids the site names as revived move, so a site that did
        /// not answer brings nobody back. Returns a line for the log, or null.
        /// </summary>
        static string RaiseRevived(List<Row> rows)
        {
            var moved = new List<string>();
            foreach (Row r in rows)
            {
                if (r.Slot != DeadSlot || r.Id <= 0) continue;
                bool back = false;
                try { back = Roster.Revived(r.Id); } catch { back = false; }
                if (!back) continue;
                r.Slot = NextSlot(rows);
                moved.Add("profile " + r.Id + " to slot " + r.Slot);
            }
            if (moved.Count == 0) return null;
            Save(rows);
            return "An admin undid the PK of " + (moved.Count == 1 ? "a character" : moved.Count + " characters") +
                   ", so it can be played again: " + string.Join(", ", moved.ToArray()) + ".";
        }

        /// <summary>The rows staff have killed for good that were played here.</summary>
        static List<Row> DeadRows(List<Row> rows)
        {
            var l = new List<Row>();
            foreach (Row r in rows) if (r.Slot == DeadSlot && r.Id > 0) l.Add(r);
            return l;
        }

        /// <summary>
        /// The rows that are characters, in slot order. Slot 0 is the spare
        /// and a row nobody has played is not a character either; the old
        /// two slot picker treated it as an empty slot for the same reason.
        /// </summary>
        static List<Row> Characters(List<Row> rows)
        {
            var l = new List<Row>();
            foreach (Row r in rows)
            {
                if (r.Slot <= 0 || r.Id <= 0 || r.Played == DateTime.MinValue) continue;
                l.Add(r);
            }
            l.Sort(delegate (Row a, Row b) { return a.Slot.CompareTo(b.Slot); });
            return l;
        }

        /// <summary>
        /// An id the server has never seen, and nobody else's launcher will
        /// ever pick either.
        ///
        /// This used to count: the highest id in this machine's own list, plus
        /// one. Every launcher did exactly the same from exactly the same
        /// starting point, so everybody's second character was profile 2 and
        /// their third was profile 3. The server stores one character per
        /// profile id, so two people on two different machines both connected
        /// as profile 2 and both loaded the same character:
        ///
        ///     Connecting a user 1 with ip 203.0.113.10  -> 1 logged as 2
        ///     Connecting a user 2 with ip 203.0.113.20  -> 2 logged as 2
        ///     Loading character ff000000                (the same one, twice)
        ///
        /// Which also meant creation never ran for either of them: the server
        /// found a character that already existed and quite correctly left it
        /// alone. Months of "the trade menu never appears" was this.
        ///
        /// So the id is random over the whole positive range instead. With five
        /// people and a handful of characters each, a collision is not worth
        /// the arithmetic to describe. Ids are still never reused inside one
        /// install, because a returning id would hand back a deleted character.
        /// </summary>
        static int NextProfileId()
        {
            var taken = new List<int>();
            foreach (Row r in Rows()) taken.Add(r.Id);
            foreach (int r in Retired()) taken.Add(r);

            var bytes = new byte[4];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
            {
                for (int attempt = 0; attempt < 64; attempt++)
                {
                    rng.GetBytes(bytes);
                    long v = BitConverter.ToInt32(bytes, 0) & 0x7FFFFFFF;
                    int id = (int)(1000 + (v % 2000000000L));
                    if (!taken.Contains(id)) return id;
                }
            }

            // Sixty-four collisions in a row does not happen, but returning
            // something that might already be in use is worse than anything,
            // so walk up from the highest rather than guess again.
            int high = 1000;
            foreach (int t in taken) if (t > high) high = t;
            return high + 1;
        }

        /// <summary>
        /// The id the menu's New character will use, minted and written down
        /// before the game starts so the site's allowed list can carry it.
        /// Lives on slot 0, unplayed, which Read and the json both treat as no
        /// character. Saves the file only when it had to mint one, and reads
        /// the list back off disk for that so the new id is checked against
        /// everything already written.
        ///
        /// A spare belongs to the Discord account it was minted under, and
        /// one minted under any other account is retired and a fresh one made.
        /// Found reviewing To Do List entry 142 on 24 September. The site's
        /// check in files an id under the first account that checks in with
        /// it and moves it only once that account has left the Discord,
        /// because it cannot tell somebody's own id from one they learned off
        /// the voice service. Shell checks the spare in at every Play
        /// (KnownIds), so account A already holds it. Unlink and Connect
        /// Discord, or Reconnect, to account B left that spare in place, and
        /// B's first New character was made on it: filed under A for as long
        /// as A stays in the Discord, voice refused it as not B's, the menu
        /// card got no name,
        /// and it was let through the game's door on A's standing. Every
        /// launch runs Prepare before the check ins, so B's spare is minted
        /// under B before the site hears of it.
        ///
        /// A spare with no account written down (every list before this) is
        /// retired as well, once, because an install relinked before now holds
        /// exactly that. It costs an id nobody played. When the account is not
        /// known, the ticket missing or unreadable, the spare is left alone:
        /// there is nothing to compare it with.
        /// </summary>
        static int EnsureSpare(List<Row> rows)
        {
            string who = "";
            try { who = Discord.AccountId ?? ""; } catch { who = ""; }

            Row sp = Find(rows, 0);
            if (sp != null && sp.Id > 0)
            {
                if (who.Length == 0 || sp.Owner == who) return sp.Id;
                Retire(sp.Id);
            }
            if (sp == null)
            {
                sp = new Row();
                sp.Slot = 0;
                rows.Add(sp);
            }
            sp.Id = NextProfileId();
            sp.Played = DateTime.MinValue;
            sp.Seconds = 0;
            sp.Owner = who;
            Save(rows);
            return sp.Id;
        }

        /// <summary>
        /// Writes an id down as never to be minted again on this install: a
        /// returning id would hand back whatever the server holds under it.
        /// </summary>
        static void Retire(int profileId)
        {
            if (profileId <= 0) return;
            try
            {
                Directory.CreateDirectory(Home);
                File.AppendAllText(RetiredFile, profileId + Environment.NewLine);
            }
            catch (Exception ex) { Swallow.Note("Chars.Retire, write", ex); }
        }

        static List<int> Retired()
        {
            var l = new List<int>();
            try
            {
                if (!File.Exists(RetiredFile)) return l;
                foreach (string line in File.ReadAllLines(RetiredFile))
                {
                    int id;
                    if (int.TryParse(line.Trim(), out id) && id > 0) l.Add(id);
                }
            }
            catch (Exception ex) { Swallow.Note("Chars.Retired", ex); }
            return l;
        }

        /// <summary>
        /// The ids the delete icon at the menu has asked to forget, one per
        /// line in the forget file, in order. Read by Shell's poll while the
        /// game runs; Shell keeps its own note of which it has acted on.
        /// </summary>
        public static List<int> ReadForgets()
        {
            var l = new List<int>();
            try
            {
                if (!File.Exists(ForgetFile)) return l;
                foreach (string line in File.ReadAllLines(ForgetFile))
                {
                    int id;
                    if (int.TryParse(line.Trim(), out id) && id > 0 && !l.Contains(id)) l.Add(id);
                }
            }
            catch (Exception ex) { Swallow.Note("Chars.ReadForgets", ex); }
            return l;
        }

        /// <summary>
        /// Forget a character: its row goes, its id is written down as retired
        /// so it is never minted again, and the character itself stays on the
        /// server exactly as the old launcher's Delete left it. The spare is
        /// never forgotten this way; it was never a character.
        /// </summary>
        public static void Forget(int profileId)
        {
            if (profileId <= 0) return;
            List<Row> rows = Rows();
            Row r = FindId(rows, profileId);
            // A dead character (DeadSlot) can be forgotten too; the spare never.
            if (r == null || (r.Slot <= 0 && r.Slot != DeadSlot)) return;
            rows.Remove(r);
            Save(rows);
            Retire(profileId);
        }

        /// <summary>The id played most recently, or 0 when nothing has been.</summary>
        static int LastPlayedId(List<Row> rows)
        {
            int id = 0;
            DateTime best = DateTime.MinValue;
            foreach (Row r in Characters(rows))
            {
                if (r.Played > best) { best = r.Played; id = r.Id; }
            }
            return id;
        }

        /// <summary>
        /// Every id the site should hear about before the game starts: the
        /// characters in slot order, then the spare. Discord.Join goes out once
        /// for each, so the server's door knows all of them before the menu
        /// has been answered.
        /// </summary>
        public static List<int> KnownIds()
        {
            var l = new List<int>();
            List<Row> rows = Rows();
            foreach (Row r in Characters(rows)) l.Add(r.Id);
            Row sp = Find(rows, 0);
            if (sp != null && sp.Id > 0 && !l.Contains(sp.Id)) l.Add(sp.Id);
            return l;
        }

        public static Who Read(int slot)
        {
            var w = new Who();
            w.Slot = slot;

            Row row = Find(Rows(), slot);
            if (row == null) return w;
            w.ProfileId = row.Id;
            w.LastPlayed = row.Played;
            w.PlaySeconds = row.Seconds;
            // A row that has been played has a character on the server even
            // when there is no save file here to read, which is the normal
            // case after a fresh install or on somebody else's machine. Slot 0
            // is the spare and has never been played by definition.
            if (slot > 0 && row.Played != DateTime.MinValue) w.Empty = false;
            return w;
        }

        /// <summary>
        /// Add a finished session to a character's total.
        ///
        /// Counted here rather than read out of the save, because under SkyMP
        /// the character lives on the server and there is frequently no save on
        /// this machine at all. Anything under a minute is dropped: a launch
        /// that crashed on the way in is not play time, and the crash log folder
        /// says there have been a few of those.
        ///
        /// By profile id since 20 September, because the id is what the menu
        /// hands back; the slot number is only this file's own line number.
        /// </summary>
        public static void AddPlaytime(int profileId, TimeSpan span)
        {
            if (profileId <= 0) return;
            long secs = (long)span.TotalSeconds;
            if (secs < 60) return;
            // A session longer than a day is a clock change or a launcher left
            // open over a reboot, not somebody playing.
            if (secs > 86400) return;

            List<Row> rows = Rows();
            Row r = FindId(rows, profileId);
            if (r == null) return;
            r.Seconds += secs;
            r.Played = DateTime.Now;
            Save(rows);
        }

        /// <summary>"3h 12m", or empty when nobody has played long enough to count.</summary>
        public static string PlayedText(long seconds)
        {
            if (seconds < 60) return "";
            long h = seconds / 3600;
            long m = (seconds % 3600) / 60;
            if (h > 0) return h + "h " + m + "m played";
            return m + "m played";
        }

        // --------------------------------------------------------- the menu

        /// <summary>
        /// The id in Data\Platform\thornswood-choice.txt, or 0 when there is no
        /// file or nothing worth reading in it yet. The plugin writes one line,
        /// "profileId unixMs", when the person picks at the menu; only the
        /// first half matters here. A read that lands mid write answers 0 and
        /// the next tick reads it whole.
        /// </summary>
        public static int ReadChoice()
        {
            try
            {
                if (!File.Exists(ChoiceFile)) return 0;
                string text = File.ReadAllText(ChoiceFile).Trim();
                if (text.Length == 0) return 0;
                string[] p = text.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                int id;
                if (p.Length == 0 || !int.TryParse(p[0], out id)) return 0;
                return id > 0 ? id : 0;
            }
            catch { return 0; }
        }

        /// <summary>
        /// The plugin says who was picked at the menu. Shell calls this once
        /// for each new id it sees in the choice file while the game runs.
        ///
        /// The spare becomes a played row on the next free slot and a fresh
        /// spare is minted behind it, so the next New character gets an id the
        /// server has never seen. A known id has its date moved. An id this
        /// file has never heard of is written down as a new row, because the
        /// person is playing it and the next json has to list it.
        /// </summary>
        public static void Chose(int profileId)
        {
            if (profileId <= 0) return;
            List<Row> rows = Rows();
            Row r = FindId(rows, profileId);
            // A character staff killed for good is never picked again (#1010).
            if (r != null && r.Slot == DeadSlot) return;
            if (r == null)
            {
                r = new Row();
                r.Id = profileId;
                rows.Add(r);
            }
            bool fromSpare = r.Slot <= 0;
            if (fromSpare) r.Slot = NextSlot(rows);
            r.Played = DateTime.Now;
            Save(rows);
            if (fromSpare) EnsureSpare(rows);
        }

        /// <summary>
        /// Data\Platform\thornswood-characters.json, what the plugin draws the
        /// menu from. Written on every Prepare, UTF-8 without a byte order
        /// mark, in exactly this shape:
        ///
        ///     {"v":1,"last":0,"spare":0,"slots":2,"characters":[
        ///       {"profileId":0,"slot":1,"name":"","race":"","trade":"","town":"",
        ///        "where":"","played":"","seconds":0,"lastPlayed":""}]}
        ///
        /// The characters are this file's rows in slot order, and the page
        /// draws each in the slot its number says, fixed, with an empty card
        /// for every number under the allowance nobody holds (TidySlots has
        /// run by now, so a number above the allowance means there was no
        /// room under it). The name, race, trade, town and where come from
        /// the server's roster when it has the character and are empty when
        /// it does not; the played text, the seconds and the date are the
        /// launcher's own, and slots is how many the menu draws (the site's
        /// answer: two, or three for a Patreon tier or a Gamemaster). Throws
        /// when the file cannot be written, because a menu drawn from a stale
        /// list offers last session's spare and misses whoever was made since.
        /// </summary>
        static void WriteCharacters(Config cfg, List<Row> rows, int last, int spare, int slots)
        {
            // The roster was refreshed by Prepare, before the dead were moved
            // out of their slots (BuryDead), so the names are as fresh as the
            // server can make them.
            string listed = CharactersJson(rows, last, spare, slots);
            try
            {
                WriteList(listed);
            }
            catch (Exception ex)
            {
                throw new Exception("The character list could not be written for the game's menu (" +
                                    ex.Message.TrimEnd('.') + "), so the game was not started. " +
                                    "Check that Data\\Platform is not read only.");
            }

            // The same list as a script beside the page, so the page draws the
            // choice the moment SkyrimPlatform loads it at start, fifteen
            // seconds before any plugin runs (measured 20 September). The page
            // takes music, the painting and its still from here too, each one
            // wherever Go.ps1 put it. The plugin deletes this file once the
            // pick is made, so the page's reload in the world does not bring
            // the choice back.
            //
            // The theme was dev only until 22 September, when Patrick supplied
            // the final version and said it goes to main, so the IsDev test
            // that used to guard it is gone and the file lost its dev- name.
            try
            {
                string ui = Path.Combine(Paths.Game, "Data\\Platform\\UI");
                string json = listed;
                var extra = new StringBuilder();
                if (File.Exists(Path.Combine(ui, "thornswood-theme.mp3")))
                    extra.Append(",\"music\":\"thornswood-theme.mp3\"");
                // WebM first, Djinn, 25 September: the game's browser (CEF in
                // Skyrim Platform) has no H.264, so the .mp4 never played and
                // the still stood in for the loop. The .mp4 stays as the
                // fallback for a game folder from before the .webm.
                // Djinn, 1 October: the still is always named when it is
                // here. The page shows it under the loop while Skyrim and the
                // mods are still loading, until the loop can play.
                if (File.Exists(Path.Combine(ui, "thornswood-menu.webm")))
                    extra.Append(",\"video\":\"thornswood-menu.webm\"");
                else if (File.Exists(Path.Combine(ui, "thornswood-menu.mp4")))
                    extra.Append(",\"video\":\"thornswood-menu.mp4\"");
                if (File.Exists(Path.Combine(ui, "thornswood-menu.jpg")))
                    extra.Append(",\"still\":\"thornswood-menu.jpg\"");
                // The scroll in front of the choice (thornswood-select.js).
                // The page's "Start without the scroll next time" has the
                // plugin write "off" here; anything else, or no file, shows it.
                try
                {
                    string intro = Path.Combine(Paths.Game, "Data\\Platform\\thornswood-intro.txt");
                    if (File.Exists(intro) && File.ReadAllText(intro).Trim() == "off")
                        extra.Append(",\"intro\":false");
                }
                catch (Exception ex) { Swallow.Note("Chars.WriteCharacters", ex); }
                // The fields go in before the closing brace of the object.
                if (extra.Length > 0 && json.EndsWith("}")) json = json.Substring(0, json.Length - 1) + extra.ToString() + "}";
                Directory.CreateDirectory(ui);
                File.WriteAllText(Path.Combine(ui, "thornswood-characters.js"),
                                  "window.THORNSWOOD_SELECT=" + json + ";\n", new UTF8Encoding(false));
            }
            catch
            {
                // The json above is what the plugin falls back on, so this is
                // a slower menu rather than no menu, and not worth stopping for.
            }
        }

        /// <summary>
        /// The list WriteCharacters describes, as text: this file's rows in
        /// slot order, then the dead.
        /// </summary>
        static string CharactersJson(List<Row> rows, int last, int spare, int slots)
        {
            var sb = new StringBuilder();
            sb.Append("{\"v\":1,\"last\":").Append(last)
              .Append(",\"spare\":").Append(spare)
              .Append(",\"slots\":").Append(slots)
              .Append(",\"characters\":[");
            bool first = true;
            // The characters in slot order, then the dead, in no slot (#1010).
            var all = Characters(rows);
            all.AddRange(DeadRows(rows));
            foreach (Row r in all)
            {
                Roster.Row who = null;
                try { who = Roster.For(r.Id); } catch { who = null; }
                // Buried at Play, or killed since, which Relist leaves for
                // the next Play to bury (#3128).
                bool isDead = r.Slot == DeadSlot;
                try { isDead = isDead || Roster.Dead(r.Id); } catch (Exception ex) { Swallow.Note("Chars.CharactersJson, dead", ex); }
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"profileId\":").Append(r.Id)
                  .Append(",\"slot\":").Append(isDead ? 0 : r.Slot)
                  .Append(",\"seconds\":").Append(r.Seconds)
                  .Append(",\"name\":\"").Append(Json(who == null ? "" : who.Name))
                  .Append("\",\"race\":\"").Append(Json(who == null ? "" : who.Race))
                  .Append("\",\"trade\":\"").Append(Json(who == null ? "" : who.Trade))
                  .Append("\",\"town\":\"").Append(Json(who == null ? "" : who.Town))
                  .Append("\",\"where\":\"").Append(Json(who == null ? "" : who.Where))
                  .Append("\",\"played\":\"").Append(Json(PlayedText(r.Seconds)))
                  .Append("\",\"lastPlayed\":\"").Append(Iso(r.Played))
                  .Append("\"");
                // The server said it has no character under this id (#955):
                // the menu marks the card, since picking it makes a new one.
                bool isGone = false;
                try { isGone = !isDead && Roster.Gone(r.Id, r.Played); } catch { isGone = false; }
                if (isGone) sb.Append(",\"gone\":true");
                // Staff killed it for good, or banned it by itself (#1010):
                // the menu shows it and will not play it.
                if (isDead) sb.Append(",\"pk\":true");
                bool isBarred = false;
                try { isBarred = !isDead && Roster.Barred(r.Id); } catch { isBarred = false; }
                if (isBarred) sb.Append(",\"banned\":true");
                sb.Append("}");
            }
            sb.Append("]}");
            return sb.ToString();
        }

        static void WriteList(string json)
        {
            lock (listGate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(CharactersFile));
                File.WriteAllText(CharactersFile, json, new UTF8Encoding(false));
            }
        }

        // Prepare and Relist both write the list, and Relist runs on a pool
        // thread. Relist reads the rows and writes under this, so a Prepare
        // that saved new rows meanwhile writes its list after Relist's.
        static readonly object listGate = new object();

        /// <summary>
        /// The menu's list again, while the game runs (#3128). Change
        /// character takes the person back to the menu without a new Play, so
        /// the list Prepare wrote at the start would offer the spare they have
        /// since made a character on, and miss what they forgot. Shell calls
        /// this off the window's thread after each choice and each forget.
        /// Only the json: the page's script beside it is deleted once the
        /// pick is made, so a reload in the world does not bring the choice
        /// back, and the plugin reads the json when it goes back to the menu.
        /// Nothing here moves a row (the slots are tidied and the dead buried
        /// at the next Play), so a character staff killed while it was played
        /// is marked from the roster instead.
        /// </summary>
        public static void Relist(Config cfg)
        {
            try { Roster.Refresh(cfg); } catch (Exception ex) { Swallow.Note("Chars.Relist, roster", ex); }
            int slots = 2;
            try { if (Door.Last != null && Door.Last.Slots > 0) slots = Door.Last.Slots; }
            catch (Exception ex) { Swallow.Note("Chars.Relist, Door.Last.Slots", ex); }
            lock (listGate)
            {
                List<Row> rows = Rows();
                Row sp = Find(rows, 0);
                try { WriteList(CharactersJson(rows, LastPlayedId(rows), sp != null ? sp.Id : 0, slots)); }
                catch (Exception ex) { Swallow.Note("Chars.Relist, write", ex); }
            }
        }

        /// <summary>The id New character uses now, or 0 when there is none yet.</summary>
        public static int SpareId()
        {
            Row sp = Find(Rows(), 0);
            return sp != null ? sp.Id : 0;
        }

        /// <summary>ISO 8601 in UTC, or empty for a date that was never set.</summary>
        static string Iso(DateTime t)
        {
            if (t == DateTime.MinValue) return "";
            try
            {
                // Ticks in profiles.txt came from DateTime.Now and lost their
                // kind on the way through the file, so they are local time.
                return DateTime.SpecifyKind(t, DateTimeKind.Local).ToUniversalTime()
                               .ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
            }
            catch { return ""; }
        }

        /// <summary>Quote anything that would end a JSON string early, or break its line.</summary>
        static string Json(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var b = new StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') { b.Append('\\').Append(c); }
                else if (c == '\n') b.Append("\\n");
                else if (c == '\r') b.Append("\\r");
                else if (c == '\t') b.Append("\\t");
                else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
                else b.Append(c);
            }
            return b.ToString();
        }

        // ------------------------------------------------------------ moving

        static bool IsLink(string p) { return Junction.IsLink(p); }

        // Adopt and Delete lived here until 20 September. Adopt made the two
        // slot folders on every start; Delete moved a slot's saves into
        // Profile\Characters\_deleted and dropped its row. There are no slot
        // folders now and nothing in the launcher deletes a character: the
        // list is only ever added to, and the server holds the characters.

        /// <summary>
        /// Everything the game folder needs before Skyrim starts, now that the
        /// character is picked at the game's own main menu rather than here.
        /// Replaced Use(slot, fresh) on 20 September.
        ///
        /// Returns a line for the log when the save folder could not be
        /// pointed and the plain one is in use instead, otherwise null. Throws
        /// when the client settings or the character list could not be
        /// written, and Play stops on that: a settings file still saying
        /// connect as the last id would walk past the menu as that character.
        ///
        /// The save folder half used to throw too, and Play stopped, with one
        /// line in the log and no reason (a tester on 1.1.36: "Could not point
        /// the save folder at character 1."). Under SkyMP nothing on this disk
        /// decides who the character is (the server does), so a save folder
        /// that cannot be redirected is not a reason to keep anybody out.
        /// </summary>
        public static string Prepare(Config cfg)
        {
            Directory.CreateDirectory(Home);
            Directory.CreateDirectory(SavesDir);

            string live = Files.SaveDir;
            Directory.CreateDirectory(Path.GetDirectoryName(live));

            string trouble = null;
            string setAside = null;
            if (IsLink(live))
            {
                try { Directory.Delete(live); }
                catch (Exception ex) { trouble = "the old link would not come off: " + ex.Message; }
            }
            else if (Directory.Exists(live))
            {
                // A real folder here is somebody's own Skyrim saves, and they
                // are never deleted. This used to Adopt them into slot one and
                // then Directory.Delete the folder recursively; Adopt declined
                // whenever slot one already had a save, and the delete took the
                // person's saves with it. A folder with anything in it is set
                // aside whole, next to where it was, under a name that says
                // what it is. Only an empty one is removed.
                bool empty = false;
                try { empty = Directory.GetFileSystemEntries(live).Length == 0; } catch (Exception ex) { Swallow.Note("Chars.Prepare, entries", ex); }
                if (empty)
                {
                    try { Directory.Delete(live); }
                    catch (Exception ex) { trouble = "the empty Saves folder would not come off: " + ex.Message; }
                }
                else
                {
                    string aside = live + "-before-Thornswood-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
                    try
                    {
                        Directory.Move(live, aside);
                        setAside = "Your own Skyrim saves were set aside whole in " + aside + ". Nothing was deleted.";
                    }
                    catch (Exception ex2)
                    {
                        trouble = "the Saves folder has files in it and would not move aside (" + ex2.Message.TrimEnd('.') + ")";
                    }
                }
            }

            string note = null;
            string why = null;
            bool linked = trouble == null && Junction.Create(live, SavesDir, out why);
            if (linked)
            {
                Scrub(SavesDir);
            }
            else
            {
                try { Directory.CreateDirectory(live); } catch (Exception ex) { Swallow.Note("Chars.Prepare, create dir", ex); }
                Scrub(live);
                note = "Could not point the save folder at Thornswood's own saves folder: " + (trouble ?? why) +
                       ". Skyrim is using the ordinary Saves folder on this computer instead. Your character lives on the server, so nothing is lost." +
                       (live.IndexOf("\\OneDrive", StringComparison.OrdinalIgnoreCase) >= 0 ? " (That folder is inside OneDrive.)" : "");
            }

            // The part that decides what the client does at the menu.
            // Everything above this line only moves save files about.
            //
            // Until 20 September this claimed a slot's id and wrote it in, and
            // the client connected as that character the moment it loaded.
            // Now it is told to wait at the menu, with the id played last (or
            // the spare, on an install that has played nobody) as the one to
            // offer first. SetChooseAtMenu reads the file back and throws when
            // it does not say what was written, which is what stops Play.
            List<Row> rows = Rows();

            // The roster first, so the names are as fresh as the server can
            // make them and a character staff killed for good (#1010) leaves
            // its slot before the id played last is chosen or the slots are
            // tidied. Its own two and a half second timeout, and a server that
            // does not answer costs the names and nothing else.
            try { Roster.Refresh(cfg); } catch (Exception ex) { Swallow.Note("Chars.Prepare, roster", ex); }
            string buried = null;
            try { buried = BuryDead(rows); } catch (Exception ex) { Swallow.Note("Chars.Prepare, dead", ex); }
            // And one an admin brought back from a PK made by mistake goes back
            // into a free slot, before the slots are tidied (#1010).
            string raised = null;
            try { raised = RaiseRevived(rows); } catch (Exception ex) { Swallow.Note("Chars.Prepare, revived", ex); }

            Row oldSpare = Find(rows, 0);
            int spareBefore = oldSpare != null ? oldSpare.Id : 0;
            string ownerBefore = oldSpare != null ? oldSpare.Owner : "";
            int spare = EnsureSpare(rows);
            // A line for the log when the spare was replaced, so launcher.log
            // says whose it was and a relinked install can be read afterwards.
            string reminted = null;
            if (spareBefore > 0 && spare != spareBefore)
            {
                string now = "";
                try { now = Discord.AccountId ?? ""; } catch { now = ""; }
                reminted = "New character's id " + spareBefore +
                           (ownerBefore.Length == 0
                               ? " was made before the launcher wrote down which Discord account it was for"
                               : " was made under Discord " + ownerBefore) +
                           ", and this copy is linked to Discord " + now +
                           ", so it was retired and New character uses " + spare + " instead.";
            }
            int last = LastPlayedId(rows);
            int point = last > 0 ? last : spare;
            AutoJoin.SetChooseAtMenu(point);

            BrowserBackend = WriteBrowserBackend();
            // The log level and the text window are Enforce's now (#963):
            // normal logging and no window, every Play, for everybody.

            // Voice read the old id out of the settings file at startup and has
            // been using it ever since. The write above just changed it, and
            // Shell hands voice the chosen id again once the menu answers.
            Voice.Reconfigure(point);

            // How many slots the menu draws: the site's answer from the door
            // check a moment ago, two when it said nothing.
            int slots = 2;
            bool answered = false;
            try
            {
                if (Door.Last != null && Door.Last.Slots > 0) { slots = Door.Last.Slots; answered = true; }
            }
            catch (Exception ex) { Swallow.Note("Chars.Prepare, Door.Last.Slots", ex); }

            // A character numbered above that allowance comes down into a
            // free number under it before the list goes out, so the menu
            // does not draw it past the fixed slots when there is room. Only
            // on the site's own answer: the two the launcher falls back on
            // when the site said nothing is a guess, and a three slot
            // account's third character must not be moved on a guess during
            // an outage. The menu still draws it, after the fixed slots.
            string tidied = null;
            if (answered)
            {
                try { tidied = TidySlots(rows, slots); } catch { tidied = null; }
            }
            WriteCharacters(cfg, rows, last, spare, slots);

            // A choice or a forget left over from the last session would be
            // read as this session's the moment the game was up.
            try { if (File.Exists(ChoiceFile)) File.Delete(ChoiceFile); } catch (Exception ex) { Swallow.Note("Chars.Prepare, delete leftover choice", ex); }
            try { if (File.Exists(ForgetFile)) File.Delete(ForgetFile); } catch (Exception ex) { Swallow.Note("Chars.Prepare, delete leftover forget", ex); }

            if (setAside != null) note = (note == null ? "" : note + " ") + setAside;
            // Shell logs the note; its Log is its own, so the tidy's line
            // rides along here rather than being written from this class.
            if (tidied != null) note = (note == null ? "" : note + " ") + tidied;
            if (buried != null) note = (note == null ? "" : note + " ") + buried;
            if (raised != null) note = (note == null ? "" : note + " ") + raised;
            if (reminted != null) note = (note == null ? "" : note + " ") + reminted;
            return note;
        }

        /// <summary>
        /// Throw away SkyrimPlatform's scaffolding saves.
        ///
        /// When SkyMP spawns somebody by loading a save it does not use one of
        /// theirs. It writes one on the spot, TESMODPLATFORM-&lt;guid&gt;.ess, fills
        /// the header with placeholder text and loads that. The file is a
        /// stepping stone and it is finished with the moment the load completes.
        ///
        /// It is also left lying in the save folder, four and a half megabytes
        /// of it per spawn, and it is now the newest file in there. Anything
        /// that reaches for "the most recent save" finds it, and it is not a
        /// save: it is a shell with no world behind it. Loading one gets you a
        /// black screen if you are lucky and a null pointer thirty seconds into
        /// startup if you are not, which is the crash sitting in
        /// crash-2026-09-13-17-45-02.log with an auto load mod's hook on the
        /// stack and rcx at zero.
        ///
        /// This machine's save folder had nothing else left in it. Two
        /// scaffolding files and no real save, each one written by the spawn
        /// before it and loaded by the launch after it.
        ///
        /// So they go, every launch, before the game can see them. Nothing is
        /// lost: a character on this server lives in the server's world file,
        /// and these were never anybody's.
        /// </summary>
        static void Scrub(string dir)
        {
            try
            {
                if (!Directory.Exists(dir)) return;
                foreach (string f in Directory.GetFiles(dir, "TESMODPLATFORM-*.ess"))
                {
                    try { File.Delete(f); } catch (Exception ex) { Swallow.Note("Chars.Scrub, delete", ex); }
                }
                // The .skse companion Skyrim writes beside each save.
                foreach (string f in Directory.GetFiles(dir, "TESMODPLATFORM-*.skse"))
                {
                    try { File.Delete(f); } catch (Exception ex) { Swallow.Note("Chars.Scrub, delete", ex); }
                }
            }
            catch (Exception ex) { Swallow.Note("Chars.Scrub, delete", ex); }
        }

        static string PlatformIni
        {
            get { return Path.Combine(Paths.Game, "Data\\SKSE\\Plugins\\SkyrimPlatform.ini"); }
        }

        /// <summary>
        /// Which in game browser SkyrimPlatform uses. Ours, wherever ours is
        /// present, which is everywhere.
        ///
        /// There are two backends. tilted is the CEF stack built into
        /// SkyrimPlatform. Its runtime lives in Data\Platform\Distribution,
        /// it goes out inside the installer, it draws inside the game's own
        /// process, and there is no executable anywhere in that folder.
        /// nirnlab is the NirnLab UI Platform SKSE plugin and it draws out of
        /// process: Data\NirnLabUIPlatform\CEFSubprocess.exe is a
        /// second program, so the first time it runs Windows Firewall stops
        /// the game to ask about a name nobody recognises.
        ///
        /// NirnLab is not ours. Ship-Rules.ps1 lists NirnLabUIPlatform
        /// among the folders that never go into a release ($ShipForeignDataDirs), and
        /// Clean-OtherServers names it as another roleplay server's interface
        /// framework. Machines that have it got it from that server's
        /// collection. Every other part of this repo treats it as somebody
        /// else's. This method used to be the one place that went looking for
        /// it and handed our own interface to it, firewall prompt and all, on
        /// the machines unlucky enough to have both installed.
        ///
        /// So the folder decides, and NirnLab wins where it is present. Not
        /// because it is better but because tilted will not run beside it:
        /// NirnLab puts its own directory on the process PATH and
        /// SkyrimPlatform stops on that before the game draws anything. A
        /// machine with NirnLab in the folder has one working answer.
        ///
        /// The firewall prompt is not fixable from here either, and not for
        /// the reason this used to give. BOTH backends draw out of process.
        /// NirnLab starts CEFSubprocess.exe; the one we ship starts
        /// SkyrimPlatformCEF.exe.hidden, which lives in
        /// Data\Platform\Distribution\RuntimeDependencies and goes out in the
        /// installer. On 17 Sep a search for *.exe missed it, because of the
        /// .hidden on the end, and this comment said tilted spawned nothing.
        /// Taking NirnLab out changes which program Windows asks about and
        /// nothing else. What Windows asked about was the WebRTC connections
        /// the in-game voice page made after the launcher had taken the
        /// audio; it makes none now (#911), so no firewall rule is needed.
        ///
        /// The file is edited, never rewritten. It also carries the log level,
        /// the console window geometry and the plugin folder list, none of
        /// which are ours to invent.
        ///
        /// Returns the backend the ini names once this is done, "nirnlab" or
        /// "tilted", and null when there is no ini or it could not be read or
        /// written. Every way out returns, the steady state included: on a
        /// healthy install the ini already says the right thing and the
        /// early return below is the one that runs, every Play. Until 27 Sep
        /// this was void and nothing afterwards knew what it had decided.
        /// </summary>
        static string WriteBrowserBackend()
        {
            try
            {
                if (!File.Exists(PlatformIni)) return null;

                // One file, and it is not in SKSE\Plugins.
                //
                // NirnLab is not loaded by the script extender. SkyrimPlatform
                // loads it itself, which is why skse64.log shows SkyrimPlatform
                // registering a listener called NirnLabUIPlatform and no plugin
                // of that name in its own scan. Nexus 125447 deploys exactly
                // Data\NirnLabUIPlatform\NirnLabUIPlatform.dll and nothing into
                // SKSE\Plugins, so testing for a NirnLabUIPlugin.dll there is
                // testing for a file that never exists and pins everybody to
                // tilted no matter what they have installed.
                bool nirnlab = File.Exists(Path.Combine(
                    Paths.Game, "Data\\NirnLabUIPlatform\\NirnLabUIPlatform.dll"));

                // nirnlab wins whenever NirnLab is on disk, and this is not a
                // preference. SkyrimPlatform refuses to start on tilted while
                // NirnLab is in the folder: NirnLab puts its own directory on
                // the process PATH, its libcef.dll would be loaded instead of
                // the one in Distribution, and SkyrimPlatform stops with a
                // box reading "Your PATH environment variable contains
                // incompatible entries" before the game draws anything.
                //
                // Measured on 17 Sep. This method was changed to prefer
                // tilted, a launcher carrying that change wrote tilted into
                // a game folder that had NirnLab in it, and the next Play
                // produced exactly that box.
                //
                // Choosing a backend here is also not a way to get rid of the
                // firewall prompt. Whichever one runs starts a second program,
                // so the prompt follows the backend rather than going away.
                // What settles it is the voice page making no WebRTC
                // connection in the game's browser (#911).
                string want = nirnlab ? "nirnlab" : "tilted";

                string text = File.ReadAllText(PlatformIni);
                var rx = new System.Text.RegularExpressions.Regex(
                    @"(?im)^[ \t]*BackendName[ \t]*=.*$");

                string next;
                if (rx.IsMatch(text))
                {
                    next = rx.Replace(text, "BackendName = " + want);
                }
                else
                {
                    // No [Browser] section at all, which is how a stock
                    // SkyrimPlatform.ini arrives. Adding one is the whole fix.
                    next = text.TrimEnd() + Environment.NewLine + Environment.NewLine +
                           "[Browser]" + Environment.NewLine +
                           "BackendName = " + want + Environment.NewLine;
                }

                if (next == text) return want;

                // The file arrives with a byte order mark and SkyrimPlatform
                // reads it happily, so keep one rather than quietly changing
                // the encoding of a file this launcher does not own.
                File.WriteAllText(PlatformIni, next, new UTF8Encoding(true));
                return want;
            }
            catch (Exception ex) { Swallow.Note("Chars.WriteBrowserBackend, write", ex); }
            // The read or the write threw, so what the ini names is not known.
            return null;
        }

        /// <summary>
        /// What WriteBrowserBackend left the ini naming at the last Play:
        /// "nirnlab", "tilted", or null when it could not say (no
        /// SkyrimPlatform.ini, or reading or writing it failed). Null too
        /// until the first Play of this session. StartPlay puts it in
        /// launcher.log and config.json, and the Settings page shows it.
        /// </summary>
        public static string BrowserBackend { get; private set; }
    }
}
