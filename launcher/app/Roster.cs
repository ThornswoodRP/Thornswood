using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// Who each profile id is, according to the server.
    ///
    /// The launcher picks a character by profile id and that is all it knows
    /// about them. The race and the sex are chosen inside the game, and the
    /// trade is applied by the gamemode, so none of it is written down on this
    /// machine: the character is a change form on the server.
    ///
    /// The gamemode writes a small file into the folder the server already
    /// serves over HTTP, the same way the online count works, and this reads
    /// it. Nothing new is opened on either end.
    ///
    /// Everything here fails quietly. A server that is down, a file that is not
    /// there yet, a character nobody has played since the roster was added:
    /// each of those means one line on a card is shorter than it might be, and
    /// none of them is worth an error.
    /// </summary>
    static class Roster
    {
        public class Row
        {
            public string Name = "";
            public string Race = "";
            public bool Female;
            public string Trade = "";     // the gamemode key, eg "smith"
            public string Town = "";      // the gamemode key, eg "riften"

            // Where they were standing when the server last looked, already in
            // words: "Candlehearth Hall", not a form id. Written by the
            // gamemode while somebody is online and left on the row after they
            // log out, which is the only time anybody reads it.
            public string Where = "";
        }

        static Dictionary<int, Row> cache = new Dictionary<int, Row>();
        static DateTime cachedAt = DateTime.MinValue;

        // This account's characters that the server this build plays on
        // looked up and does not hold (#955), and when it looked, in UTC.
        // Empty when the site had no recent answer from that server.
        static HashSet<int> gone = new HashSet<int>();
        static DateTime goneAt = DateTime.MinValue;

        // This account's characters staff have killed for good, and the ones
        // under a ban of their own (#1010). The menu shows a dead one in no
        // slot, so the account can make a new character, and neither can be
        // picked. Empty when the site said nothing.
        static HashSet<int> dead = new HashSet<int>();
        static HashSet<int> barred = new HashSet<int>();
        // And the ones an admin brought back from a PK made by mistake (#1010,
        // 29 September). Only an id the site names here leaves DeadSlot, so a
        // site that said nothing brings nobody back.
        static HashSet<int> revived = new HashSet<int>();

        /// <summary>True when staff have killed this character for good.</summary>
        public static bool Dead(int profileId)
        {
            lock (gate) { return dead.Contains(profileId); }
        }

        /// <summary>True when an admin undid this character's PK.</summary>
        public static bool Revived(int profileId)
        {
            lock (gate) { return revived.Contains(profileId) && !dead.Contains(profileId); }
        }

        /// <summary>True when staff have banned this character by itself.</summary>
        public static bool Barred(int profileId)
        {
            lock (gate) { return barred.Contains(profileId); }
        }

        /// <summary>
        /// The ids in one list of a /api/play/roster answer, "pk" or "banned".
        /// Empty when the list is not there.
        /// </summary>
        public static HashSet<int> ReadIds(string text, string key)
        {
            var ids = new HashSet<int>();
            if (string.IsNullOrEmpty(text)) return ids;
            Match m = Regex.Match(text, "\"" + key + "\"\\s*:\\s*\\[([^\\]]*)\\]");
            if (!m.Success) return ids;
            foreach (string part in m.Groups[1].Value.Split(','))
            {
                int id;
                if (int.TryParse(part.Trim(), out id) && id > 0) ids.Add(id);
            }
            return ids;
        }

        /// <summary>
        /// True when the server said it has no character under this profile,
        /// and said so after the character was last played here. Played is
        /// local time, as profiles.txt keeps it. A character made or played
        /// after the server's last look is never called gone on that look.
        /// </summary>
        public static bool Gone(int profileId, DateTime lastPlayedLocal)
        {
            lock (gate)
            {
                if (!gone.Contains(profileId) || goneAt == DateTime.MinValue) return false;
                return Played(lastPlayedLocal) < goneAt;
            }
        }

        /// <summary>A local time from profiles.txt in UTC; MinValue stays MinValue.</summary>
        public static DateTime Played(DateTime local)
        {
            if (local == DateTime.MinValue) return DateTime.MinValue;
            try { return DateTime.SpecifyKind(local, DateTimeKind.Local).ToUniversalTime(); }
            catch { return DateTime.MinValue; }
        }

        /// <summary>
        /// The site's "gone" and "goneAt" out of a /api/play/roster answer:
        /// the ids, and the moment in UTC, or MinValue when either is missing.
        /// </summary>
        public static HashSet<int> ReadGone(string text, out DateTime at)
        {
            var ids = new HashSet<int>();
            at = DateTime.MinValue;
            if (string.IsNullOrEmpty(text)) return ids;
            Match g = Regex.Match(text, "\"gone\"\\s*:\\s*\\[([^\\]]*)\\]");
            Match t = Regex.Match(text, "\"goneAt\"\\s*:\\s*(\\d+)");
            long ms;
            if (!g.Success || !t.Success || !long.TryParse(t.Groups[1].Value, out ms) || ms <= 0) return ids;
            foreach (string part in g.Groups[1].Value.Split(','))
            {
                int id;
                if (int.TryParse(part.Trim(), out id) && id > 0) ids.Add(id);
            }
            at = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(ms);
            return ids;
        }
        // Separate from cachedAt on purpose. A server that is down never moves
        // cachedAt, so without this a launcher left open would queue a fetch
        // every time the cards were drawn and never stop.
        static DateTime triedAt = DateTime.MinValue;
        static readonly object gate = new object();

        /// <summary>The row for one profile, or null. Never blocks.</summary>
        public static Row For(int profileId)
        {
            lock (gate)
            {
                Row r;
                if (cache.TryGetValue(profileId, out r)) return r;
                return null;
            }
        }

        /// <summary>True when there is no point asking again yet, answer or no answer.</summary>
        public static bool Fresh
        {
            get
            {
                lock (gate)
                {
                    if ((DateTime.UtcNow - cachedAt).TotalMinutes < 2) return true;
                    return (DateTime.UtcNow - triedAt).TotalSeconds < 20;
                }
            }
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. Returns true when the roster
        /// changed, so the caller knows whether redrawing is worth it.
        /// </summary>
        public static bool Refresh(Config cfg)
        {
            if (cfg == null) return false;
            lock (gate) { triedAt = DateTime.UtcNow; }

            // From the site, with the Discord ticket, since 20 September. This
            // used to GET characters.json off the game server's resource port,
            // and that has been a 404 since the file moved into the private
            // folder on the 18th (it names people and where they stand), so no
            // card has had a name since. The gamemode pushes its book to the
            // site and the site answers with this account's own rows only.
            string text = null;
            try
            {
                if (!Discord.Linked) return false;
                string reply;
                // The channel says which server's answer about gone
                // characters this build wants (#955).
                string channel = string.IsNullOrEmpty(Discord.Channel) ? "main" : Discord.Channel;
                int code = Discord.PostJson(Discord.Site + "/api/play/roster",
                                            "{\"ticket\":\"" + Discord.Escape(Discord.Ticket) + "\"" +
                                            ",\"channel\":\"" + Discord.Escape(channel) + "\"}", out reply);
                if (code != 200 || string.IsNullOrEmpty(reply)) return false;
                text = reply;
            }
            catch { return false; }

            // Before the rows, which return early when there are none: a
            // character the server does not hold may have no row at all.
            DateTime goneWhen;
            HashSet<int> goneNow = ReadGone(text, out goneWhen);
            HashSet<int> deadNow = ReadIds(text, "pk");
            HashSet<int> barredNow = ReadIds(text, "banned");
            HashSet<int> revivedNow = ReadIds(text, "revived");
            bool goneChanged;
            lock (gate)
            {
                goneChanged = goneWhen != goneAt || !goneNow.SetEquals(gone) ||
                              !deadNow.SetEquals(dead) || !barredNow.SetEquals(barred) ||
                              !revivedNow.SetEquals(revived);
                gone = goneNow;
                goneAt = goneWhen;
                dead = deadNow;
                barred = barredNow;
                revived = revivedNow;
            }

            var got = new Dictionary<int, Row>();
            try
            {
                // Read with a regex rather than a serializer. It was written
                // while the launcher ran on the .NET Framework that ships in
                // Windows, whose only serializer was the data contract one,
                // and that cannot read a dictionary keyed by an arbitrary
                // number without being told the shape in advance. This file
                // has to survive the gamemode adding a field to it, which a
                // declared shape would not. On .NET 10 (#4823) JsonNode reads
                // it with no declared shape; this was not moved to it.
                var each = Regex.Matches(text,
                    "\"(\\d+)\"\\s*:\\s*\\{(.*?)\\}", RegexOptions.Singleline);
                foreach (Match m in each)
                {
                    int pid;
                    if (!int.TryParse(m.Groups[1].Value, out pid)) continue;
                    string body = m.Groups[2].Value;

                    var row = new Row();
                    row.Name = Str(body, "name");
                    row.Race = Str(body, "race");
                    row.Trade = Str(body, "trade");
                    row.Town = Str(body, "town");
                    row.Where = Str(body, "where");
                    row.Female = Regex.IsMatch(body, "\"female\"\\s*:\\s*true");
                    got[pid] = row;
                }
            }
            catch { return false; }

            if (got.Count == 0) return goneChanged;

            bool changed;
            lock (gate)
            {
                changed = goneChanged || got.Count != cache.Count;
                if (!changed)
                {
                    foreach (var kv in got)
                    {
                        Row was;
                        if (!cache.TryGetValue(kv.Key, out was) ||
                            was.Name != kv.Value.Name || was.Race != kv.Value.Race ||
                            was.Female != kv.Value.Female || was.Trade != kv.Value.Trade ||
                            was.Town != kv.Value.Town)
                        { changed = true; break; }
                    }
                }
                cache = got;
                cachedAt = DateTime.UtcNow;
            }
            return changed;
        }

        static string Str(string body, string key)
        {
            var m = Regex.Match(body, "\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            if (!m.Success) return "";
            return m.Groups[1].Value
                    .Replace("\\\"", "\"")
                    .Replace("\\\\", "\\");
        }

        /// <summary>
        /// "Nord woman,  smith,  last seen in The Bee and Barb", as much of it
        /// as is known.
        /// </summary>
        public static string Describe(Row r)
        {
            if (r == null) return "";
            var bits = new List<string>();

            string who = r.Race;
            if (who.Length > 0) who += " " + (r.Female ? "woman" : "man");
            else who = r.Female ? "woman" : "";
            if (who.Length > 0) bits.Add(who);

            // The raw gamemode keys with a capital, "Smith" and "Riften".
            // Until 20 September these went through the creation dialog's
            // option lists to become labels; that dialog is gone and the
            // keys read well enough on their own.
            string trade = Cap(r.Trade);
            string town = Cap(r.Town);
            bool somewhere = !string.IsNullOrEmpty(r.Where);

            // The town somebody started in stops being worth saying the moment
            // there is a real place to report instead. "Bard in Markarth, last
            // seen in The Bee and Barb" names two towns and means one, and it
            // leads with the one that stopped being true the first time they
            // walked out of it.
            if (trade.Length > 0 && town.Length > 0 && !somewhere) bits.Add(trade + " in " + town);
            else if (trade.Length > 0) bits.Add(trade);
            else if (town.Length > 0 && !somewhere) bits.Add("started in " + town);

            // Last, because it is the one thing here that changes. Everything
            // before it is who the character is; this is where you left them.
            if (somewhere) bits.Add("last seen in " + r.Where);

            return string.Join(",  ", bits.ToArray());
        }

        /// <summary>"smith" as "Smith". Empty stays empty.</summary>
        static string Cap(string key)
        {
            if (string.IsNullOrEmpty(key)) return "";
            if (key.Length == 1) return key.ToUpperInvariant();
            return char.ToUpperInvariant(key[0]) + key.Substring(1);
        }
    }
}
