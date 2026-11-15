using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;

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
    // The person picks their character at the game's own main menu, which our
    // plugin draws from a file this class writes
    // (Data\Platform\thornswood-characters.json) and answers with one line in
    // Data\Platform\thornswood-choice.txt, which Shell polls while the game
    // runs. The client settings carry chooseAtMenu = true and the id played
    // last, so the client waits at the menu rather than connecting as anybody.
    //
    // THE LIST IS THE SITE'S, KEPT UNDER THE DISCORD ACCOUNT (#5938). Which
    // ids are this person's characters, each one's slot, when it was last
    // played and for how long, the ids they deleted, and the spare the menu's
    // New character uses: until 12 November all of it lived only in
    // Profile\Characters\profiles.txt and retired.txt, so a reinstall or
    // another PC started an empty list, minted a new id, and left every
    // character on the server with nothing that knew its number. Patrick,
    // 12 Nov: "chacrthers, saves, and settings should all be cloud saved by
    // the server and linked to your discord and not all be saved locally".
    // Now the site keeps it on the account's row (site\lib\characters.js) and
    // answers POST /api/play/characters with it; this class asks at every
    // Play and after every pick, forget and finished session, holds the last
    // answer in memory for the menu, and writes no list of its own. The site
    // also mints the spare, against every account's ids rather than one
    // install's, buries the dead, brings back a PK undone and tidies the
    // slots, so none of that is decided here either.
    //
    // The save folder is still redirected, to one folder for the whole
    // install. SkyrimPlatform writes its own .ess as it works and there is no
    // reason for them to land among somebody's own saves; nothing in them is
    // anybody's (Scrub).
    static class Chars
    {
        public static string Home { get { return Path.Combine(Paths.ProfileDir, "Characters"); } }

        // One saves folder for the whole install, for SkyrimPlatform's
        // scaffolding saves. Nothing on this disk decides who the character
        // is (SkyMP loads the character the server holds).
        static string SavesDir { get { return Path.Combine(Home, "saves"); } }

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

        // ------------------------------------------------------- the list

        class Row
        {
            public int Slot;
            public int Id;
            // Local time, as the menu's dates and Roster.Gone take it;
            // MinValue for never.
            public DateTime Played;
            public long Seconds;
        }

        /// <summary>
        /// The slot the site gives a character staff have killed for good
        /// (#1010): out of the numbered slots, shown dead, never played.
        /// </summary>
        const int DeadSlot = -1;

        // The site's last answer for this account, and the spare in it.
        static List<Row> held = new List<Row>();
        static int spareId;
        // How many slots the menu draws: two, or three for a Patreon tier or
        // a Gamemaster (the site's slotsFor). 0 until the site has answered.
        static int slotCount;
        static readonly object heldGate = new object();

        /// <summary>A copy of the last answer's characters, safe to walk off the lock.</summary>
        static List<Row> Rows()
        {
            lock (heldGate) { return new List<Row>(held); }
        }

        /// <summary>
        /// One call to /api/play/characters: op is "" for the list, or
        /// "chose", "played" or "forget" with the character. On an answer the
        /// list held here is replaced with the site's, and the lines it said
        /// (the dead, the revived, the slots tidied) come back in said.
        /// Throws with the site's own words, or what the request ran into, when
        /// there is no list: a menu drawn without the account's characters
        /// would offer only New character. A refusal of the op itself (a
        /// character that is not this account's) still carries the list,
        /// which is kept, and is thrown after.
        /// </summary>
        static void Ask(string op, int profileId, long seconds, out string said)
        {
            said = null;
            if (!Discord.Linked)
                throw new Exception("Connect Discord first: your characters are kept with your Discord account.");
            var json = new StringBuilder();
            json.Append("{\"ticket\":\"").Append(Discord.Escape(Discord.Ticket)).Append('"');
            if (op.Length > 0) json.Append(",\"op\":\"").Append(op).Append('"');
            if (profileId > 0) json.Append(",\"profileId\":").Append(profileId);
            if (seconds > 0) json.Append(",\"seconds\":").Append(seconds);
            json.Append('}');

            string reply;
            int code = Discord.PostJson(Discord.Site + "/api/play/characters", json.ToString(), out reply);
            JsonObject o = null;
            try { o = string.IsNullOrEmpty(reply) ? null : JsonNode.Parse(reply) as JsonObject; }
            catch (Exception ex) { Swallow.Note("Chars.Ask, reading the answer", ex); }
            if (code == 0)
                throw new Exception("thornswood.net is not answering, so your characters could not be fetched" +
                                    (string.IsNullOrEmpty(Discord.LastFailure) ? "" : " (" + Discord.LastFailure + ")") + ".");
            JsonArray list = o != null ? o["chars"] as JsonArray : null;
            if (code != 200 || list == null)
            {
                string message = o != null && o["message"] != null ? (string)o["message"] : "";
                throw new Exception(message.Length > 0 ? message
                    : "thornswood.net answered " + code + " when asked for your characters.");
            }

            var rows = new List<Row>();
            foreach (JsonNode n in list)
            {
                var c = n as JsonObject;
                if (c == null) continue;
                var r = new Row();
                r.Id = Int(c["id"]);
                r.Slot = Int(c["slot"]);
                long ms = Long(c["played"]);
                r.Played = ms > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(ms).LocalDateTime : DateTime.MinValue;
                r.Seconds = Long(c["seconds"]);
                if (r.Id > 0 && r.Slot != 0) rows.Add(r);
            }
            lock (heldGate)
            {
                held = rows;
                spareId = Int(o["spare"]);
                slotCount = Int(o["slots"]);
            }
            var lines = o["said"] as JsonArray;
            if (lines != null && lines.Count > 0)
            {
                var all = new List<string>();
                foreach (JsonNode l in lines) if (l != null) all.Add((string)l);
                said = string.Join(" ", all.ToArray());
            }
            if (o["ok"] != null && !(bool)o["ok"])
            {
                string message = o["message"] != null ? (string)o["message"] : "refused";
                throw new Exception("thornswood.net did not take that: " + message + ".");
            }
        }

        static int Int(JsonNode n)
        {
            try { return n == null ? 0 : (int)n.GetValue<long>(); }
            catch { return 0; }
        }

        static long Long(JsonNode n)
        {
            try { return n == null ? 0 : n.GetValue<long>(); }
            catch { return 0; }
        }

        static Row FindId(List<Row> rows, int profileId)
        {
            foreach (Row r in rows) if (r.Id == profileId) return r;
            return null;
        }

        /// <summary>The rows staff have killed for good.</summary>
        static List<Row> DeadRows(List<Row> rows)
        {
            var l = new List<Row>();
            foreach (Row r in rows) if (r.Slot == DeadSlot && r.Id > 0) l.Add(r);
            return l;
        }

        /// <summary>The rows that are characters, in slot order.</summary>
        static List<Row> Characters(List<Row> rows)
        {
            var l = new List<Row>();
            foreach (Row r in rows) if (r.Slot > 0 && r.Id > 0) l.Add(r);
            l.Sort(delegate (Row a, Row b) { return a.Slot.CompareTo(b.Slot); });
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
        /// Forget a character: the site takes it off the account and never
        /// mints or lets it be picked again; the character itself stays on the
        /// server. Throws with the site's words when it could not.
        /// </summary>
        public static void Forget(int profileId)
        {
            if (profileId <= 0) return;
            string said;
            Ask("forget", profileId, 0, out said);
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
        /// characters in slot order, then the spare. The site already holds
        /// them all for the account; Discord.Join still goes out for each so
        /// the door's list is fresh before the menu has been answered.
        /// </summary>
        public static List<int> KnownIds()
        {
            var l = new List<int>();
            foreach (Row r in Characters(Rows())) l.Add(r.Id);
            int sp = SpareId();
            if (sp > 0 && !l.Contains(sp)) l.Add(sp);
            return l;
        }

        /// <summary>
        /// Add a finished stretch of play to a character's total, on the site.
        ///
        /// Counted by the launcher rather than read out of a save, because
        /// under SkyMP there is no save of the character here at all. Anything
        /// under a minute, or over a day, the site does not count (a launch
        /// that crashed on the way in, a clock change). By profile id, because
        /// the id is what the menu hands back. Call it off the window's thread.
        /// </summary>
        public static void AddPlaytime(int profileId, TimeSpan span)
        {
            if (profileId <= 0) return;
            long secs = (long)span.TotalSeconds;
            if (secs < 60 || secs > 86400) return;
            string said;
            Ask("played", profileId, secs, out said);
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
        /// for each new id it sees in the choice file while the game runs, off
        /// the window's thread.
        ///
        /// The site does the rest: the spare becomes a character on the
        /// lowest free slot and the next spare is minted behind it, so the next
        /// New character gets an id the server has never seen; one of the
        /// account's own has its date moved; anything else is not theirs and
        /// is refused. Throws with what the site said.
        /// </summary>
        public static void Chose(int profileId)
        {
            if (profileId <= 0) return;
            string said;
            Ask("chose", profileId, 0, out said);
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
        /// The characters are the site's list in slot order, and the page
        /// draws each in the slot its number says, fixed, with an empty card
        /// for every number under the allowance nobody holds (the site has
        /// tidied the slots, so a number above the allowance means there was
        /// no room under it). The name, race, trade, town and where come from
        /// the server's roster when it has the character and are empty when
        /// it does not; the played text, the seconds and the date are the
        /// site's count for the account, and slots is how many the menu draws (the site's
        /// answer: two, or three for a Patreon tier or a Gamemaster). Throws
        /// when the file cannot be written, because a menu drawn from a stale
        /// list offers last session's spare and misses whoever was made since.
        /// </summary>
        static void WriteCharacters(Config cfg, List<Row> rows, int last, int spare, int slots)
        {
            // The roster was refreshed by Prepare, before the site was asked
            // for the list, so the names are as fresh as the server can make
            // them.
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
            lock (listGate)
            {
                List<Row> rows = Rows();
                try { WriteList(CharactersJson(rows, LastPlayedId(rows), SpareId(), Slots())); }
                catch (Exception ex) { Swallow.Note("Chars.Relist, write", ex); }
            }
        }

        /// <summary>The id New character uses now, or 0 when there is none yet.</summary>
        public static int SpareId()
        {
            lock (heldGate) { return spareId; }
        }

        /// <summary>How many slots the menu draws: the site's answer, two before it has given one.</summary>
        static int Slots()
        {
            lock (heldGate) { return slotCount > 0 ? slotCount : 2; }
        }

        /// <summary>ISO 8601 in UTC, or empty for a date that was never set.</summary>
        static string Iso(DateTime t)
        {
            if (t == DateTime.MinValue) return "";
            try
            {
                // Ask turns the site's time into local time, the kind
                // Roster.Gone takes too.
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
        /// when the site could not hand over the account's characters, or the
        /// client settings or the character list could not be written, and
        /// Play stops on that: a menu without the account's characters offers
        /// only New character, and a settings file still saying connect as the
        /// last id would walk past the menu as that character.
        ///
        /// The save folder half used to throw too, and Play stopped, with one
        /// line in the log and no reason (a tester on 1.1.36: "Could not point
        /// the save folder at character 1."). Under SkyMP nothing on this disk
        /// decides who the character is (the server does), so a save folder
        /// that cannot be redirected is not a reason to keep anybody out.
        /// </summary>
        public static string Prepare(Config cfg)
        {
            // The account's characters from the site first, before anything
            // here is touched: without them the menu would offer only New
            // character, so Play stops on the site's own words instead (#5938).
            // The roster before that, so the names are as fresh as the server
            // can make them; its own two and a half second timeout, and a
            // server that does not answer costs the names and nothing else.
            try { Roster.Refresh(cfg); } catch (Exception ex) { Swallow.Note("Chars.Prepare, roster", ex); }
            string fetched;
            try { Ask("", 0, 0, out fetched); }
            catch (Exception ex)
            {
                throw new Exception(ex.Message.TrimEnd('.') + ". Your characters are kept with your Discord account on " +
                                    "thornswood.net, so the game was not started without them.");
            }

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
            int spare = SpareId();
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

            // How many slots the menu draws: the site's answer with the list.
            int slots = Slots();
            WriteCharacters(cfg, rows, last, spare, slots);

            // A choice or a forget left over from the last session would be
            // read as this session's the moment the game was up.
            try { if (File.Exists(ChoiceFile)) File.Delete(ChoiceFile); } catch (Exception ex) { Swallow.Note("Chars.Prepare, delete leftover choice", ex); }
            try { if (File.Exists(ForgetFile)) File.Delete(ForgetFile); } catch (Exception ex) { Swallow.Note("Chars.Prepare, delete leftover forget", ex); }

            if (setAside != null) note = (note == null ? "" : note + " ") + setAside;
            // Shell logs the note; its Log is its own, so what the site said
            // about the list (the dead, a PK undone, the slots tidied) rides
            // along here rather than being written from this class.
            if (fetched != null) note = (note == null ? "" : note + " ") + fetched;
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
