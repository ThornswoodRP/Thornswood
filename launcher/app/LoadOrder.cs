using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// The load order as the game counts it, and how to put a plugin list
    /// into the server's order. Pure functions over lists: nothing in here
    /// reads a path, a setting or the window, so the file compiles on its own
    /// with a test, and scripts\mods\LoadOrder.ps1 carries the same rule for the
    /// publisher, line for line.
    ///
    /// The game hands a normal index to the five masters, then to every
    /// plugin Skyrim.ccc names that is in Data, then to every enabled entry
    /// of plugins.txt that is in Data. Light plugins (an .esl, or the ESL
    /// flag in the header) get no normal index and are skipped throughout.
    /// That is the list Game.getModCount and getModName walk, and the client
    /// (loadOrderVerificationService) compares it with the server's manifest
    /// position by position: one name out of place from any index onwards is
    /// LOAD ORDER ERROR for the whole session.
    ///
    /// On 20 Sep the launcher said everything checked out while the game
    /// showed exactly that. Every plugin was present with the server's bytes;
    /// LOOT had re-sorted the list, and the launcher only compared it with
    /// the shipped reference, which had been re-sorted the same way.
    ///
    /// Light plugins have an order of their own (#1715). The game gives each
    /// one a light index, its place among the light plugins it loads, and
    /// every form in it the id 0xFE000000 | (index &lt;&lt; 12) | local id. Once the
    /// server loads them too, that index has to be the same on the server and
    /// on every client, or a stored light form id names a different plugin.
    /// Measured on 5 Oct: across 133 session logs since 24 Sep the clients
    /// reported ten different light orders, KhisartinBeards.esp anywhere from
    /// light index 0x1E to 0x29, and a beard stored on dev as 0xFE020827 named
    /// RaceMenuMorphsHIMBO.esp under that day's dev release. LightOrder is the
    /// game's light order, and ReorderWhole puts a list into the server's
    /// whole order, light plugins included.
    /// </summary>
    static class LoadOrder
    {
        /// <summary>The five the game loads before it reads any list. Never written to plugins.txt.</summary>
        public static readonly string[] Masters = {
            "Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"
        };

        /// <summary>
        /// True when the plugins.txt at <paramref name="file"/> is there and
        /// switches at least one plugin on (a line that starts with *). A
        /// shipped list that does not is never copied over the game's, which
        /// would switch every plugin off (#6327, Verify.ShippedListProblem).
        /// Swap keeps its own copy of this test, since it builds alone.
        /// </summary>
        public static bool SwitchesAnyOn(string file)
        {
            if (!File.Exists(file)) return false;
            foreach (string raw in File.ReadAllLines(file))
                if (raw.Trim().StartsWith("*")) return true;
            return false;
        }

        public static bool IsMaster(string name)
        {
            if (name == null) return false;
            string n = name.Trim();
            foreach (string m in Masters)
                if (string.Equals(m, n, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// The full plugin order the game will use: the masters, then the
        /// Skyrim.ccc entries that are in Data, then the enabled entries that
        /// are in Data, each skipped when isLightOrMissing says so, and a
        /// name never listed twice. Case insensitive throughout.
        /// </summary>
        public static List<string> GameOrder(IList<string> enabled, Func<string, bool> isLightOrMissing, IList<string> ccc, Func<string, bool> existsInData)
        {
            var order = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string m in Masters) { order.Add(m); seen.Add(m); }
            Take(order, seen, ccc, isLightOrMissing, existsInData);
            Take(order, seen, enabled, isLightOrMissing, existsInData);
            return order;
        }

        /// <summary>
        /// The light plugin order the game will use, which is what a light
        /// index counts: the Skyrim.ccc entries that are in Data and light,
        /// then the enabled entries that are in Data and light, a name never
        /// listed twice. The game loads the Skyrim.ccc ones before any list,
        /// so _ResourcePack.esl, which Bethesda's own update puts in every Data
        /// folder and Skyrim.ccc names, is light index 0 on every machine that
        /// has it: every light list the game wrote to
        /// thornswood-plugins-light.txt in the main sessions of 5 Oct starts
        /// with it. No master hoisting, the same as GameOrder.
        /// </summary>
        public static List<string> LightOrder(IList<string> enabled, Func<string, bool> isLight, IList<string> ccc, Func<string, bool> existsInData)
        {
            var order = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string m in Masters) seen.Add(m);
            Func<string, bool> notLight = delegate(string n) { return isLight == null || !isLight(n); };
            Take(order, seen, ccc, notLight, existsInData);
            Take(order, seen, enabled, notLight, existsInData);
            return order;
        }

        static void Take(List<string> order, HashSet<string> seen, IList<string> names, Func<string, bool> isLightOrMissing, Func<string, bool> existsInData)
        {
            if (names == null) return;
            foreach (string raw in names)
            {
                string n = raw == null ? "" : raw.Trim();
                if (n.Length == 0 || seen.Contains(n)) continue;
                if (existsInData != null && !existsInData(n)) continue;
                if (isLightOrMissing != null && isLightOrMissing(n)) continue;
                seen.Add(n);
                order.Add(n);
            }
        }

        /// <summary>
        /// An official Creation Club plugin, by its name: cc, three letters for
        /// who made it, SSE and three digits (ccBGSSSE001-Fish.esm,
        /// ccQDRSSE001-SurvivalMode.esl, ccASVSSE001-ALMSIVI.esm). Every
        /// Creation Club name an Anniversary Edition Skyrim.ccc lists has that
        /// shape: 73 of its 74 lines on the shipping machine, the other being
        /// _ResourcePack.esl, which is the base game's. Decided by Patrick on
        /// 28 Sep (#479): Special Edition is all Thornswood needs, and somebody
        /// who owns the Anniversary upgrade still plays.
        /// </summary>
        public static bool IsCreation(string name)
        {
            if (name == null) return false;
            return Regex.IsMatch(name.Trim(), @"^cc[a-z]{3}sse\d{3}.*\.es[mlp]$", RegexOptions.IgnoreCase);
        }

        /// <summary>
        /// What an enabled list switches on that the reference does not, in
        /// list order, each once: the "is enabled but is not part of this
        /// build" issues. An official Creation Club plugin that takes no place
        /// in the game's order (light, or not in Data) is not counted. An
        /// Anniversary owner's list can name every creation they own, and the
        /// game's own rewrite of the list can add them, but one the game gives
        /// no index moves nothing the server compares, and Thornswood's own
        /// folder never has one in Data (OwnGame.UnwantedCreation). Stopping
        /// Play over it would stop them for nothing. A full one that is in
        /// Data still counts, because it takes a place and every plugin after
        /// it is then out of position.
        /// </summary>
        public static List<string> NotInBuild(IList<string> enabled, IList<string> reference, Func<string, bool> isLightOrMissing)
        {
            var want = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (reference != null)
                foreach (string r in reference) { string t = Norm(r); if (t.Length > 0) want.Add(t); }
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var result = new List<string>();
            if (enabled == null) return result;
            foreach (string raw in enabled)
            {
                string n = Norm(raw);
                if (n.Length == 0 || want.Contains(n) || !seen.Add(n)) continue;
                if (IsCreation(n) && (isLightOrMissing == null || isLightOrMissing(n))) continue;
                result.Add(n);
            }
            return result;
        }

        /// <summary>
        /// The first position where the two lists name different plugins, or
        /// where one of them ends; -1 when they are the same list. The same
        /// walk the client does, names only.
        /// </summary>
        public static int FirstMismatch(IList<string> game, IList<string> manifest)
        {
            int g = game == null ? 0 : game.Count;
            int m = manifest == null ? 0 : manifest.Count;
            int n = Math.Max(g, m);
            for (int i = 0; i < n; i++)
            {
                if (i >= g || i >= m) return i;
                if (!string.Equals(Norm(game[i]), Norm(manifest[i]), StringComparison.OrdinalIgnoreCase)) return i;
            }
            return -1;
        }

        static string Norm(string s)
        {
            return s == null ? "" : s.Trim();
        }

        /// <summary>The plugin an enabled line switches on, or null for a comment, a blank or a disabled line.</summary>
        public static string EnabledName(string line)
        {
            if (line == null) return null;
            string s = line.Trim();
            if (!s.StartsWith("*")) return null;
            string n = s.Substring(1).Trim();
            return n.Length == 0 ? null : n;
        }

        /// <summary>
        /// The same plugins.txt lines with the full enabled plugins in the
        /// server's order.
        ///
        /// The rule: a line moves only when it enables a plugin the server
        /// names and that plugin is not light. Those lines' positions are the
        /// slots, and the slots are refilled top to bottom in the server's
        /// order. Every other line keeps its index: the header, the comments,
        /// the disabled entries, the light plugins and anything the server
        /// does not name. So the result is the same set of lines, two light
        /// plugins that were in one order are still in it, and the full ones
        /// read in the server's order, which is what the game will count.
        ///
        /// The five masters are skipped on the server's side, because the game
        /// loads them before any list and a list never carries them. A light
        /// plugin the server names holds its place: the game gives it no index
        /// either way, and a flag that is not the server's is Vortex's to put
        /// right. A plugin the server names that no line enables is not this
        /// function's to switch on, so it returns null and leaves the list as
        /// it was; the "is turned off" and "is not installed" issues own that.
        /// </summary>
        public static List<string> Reorder(IList<string> lines, IList<string> manifest, Func<string, bool> isLight)
        {
            return Put(lines, manifest, isLight, null);
        }

        /// <summary>
        /// The same lines with every plugin the server names, full and light,
        /// in the server's whole order (#1715): <paramref name="whole"/> is the
        /// manifest's loadOrder, which a server that loads light plugins
        /// publishes beside its light list. The light plugins land in the
        /// server's light order, so each takes the light index the server
        /// stores its forms under, and among the full ones where the server
        /// has them. The names the game loads before it reads any list, the
        /// five masters and <paramref name="loadedFirst"/> (Skyrim.ccc's), are
        /// skipped on the server's side: the server names _ResourcePack.esl
        /// as its first light plugin and no plugin list carries it. Null for
        /// the same reasons as Reorder. A name of its own rather than an
        /// overload, because tests\test-load-order.ps1 calls these by name.
        /// </summary>
        public static List<string> ReorderWhole(IList<string> lines, IList<string> whole, IList<string> loadedFirst)
        {
            return Put(lines, whole, null, loadedFirst);
        }

        static List<string> Put(IList<string> lines, IList<string> manifest, Func<string, bool> isLight, IList<string> loadedFirst)
        {
            if (lines == null || manifest == null) return null;
            var first = Names(loadedFirst);

            // Which line enables each plugin. Two lines enabling the same
            // name is a list nothing here can put in one order, so it is
            // left alone.
            var at = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < lines.Count; i++)
            {
                string name = EnabledName(lines[i]);
                if (name == null) continue;
                if (at.ContainsKey(name)) return null;
                at[name] = i;
            }

            var order = new List<string>();
            var slots = new List<int>();
            var placed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string raw in manifest)
            {
                string n = Norm(raw);
                if (n.Length == 0 || IsMaster(n) || first.Contains(n) || placed.Contains(n)) continue;
                placed.Add(n);
                int line;
                if (!at.TryGetValue(n, out line)) return null;
                if (isLight != null && isLight(n)) continue;
                order.Add(lines[line]);
                slots.Add(line);
            }

            slots.Sort();
            var result = new List<string>(lines);
            for (int k = 0; k < slots.Count; k++) result[slots[k]] = order[k];
            return result;
        }

        /// <summary>
        /// How many lines Reorder changed, and the plugin now sitting on the
        /// first of them, for saying what was done. Same length lists only.
        /// </summary>
        public static int Moved(IList<string> before, IList<string> after, out string first)
        {
            first = null;
            int n = 0;
            if (before == null || after == null || before.Count != after.Count) return 0;
            for (int i = 0; i < before.Count; i++)
            {
                if (string.Equals(before[i], after[i], StringComparison.Ordinal)) continue;
                if (first == null)
                {
                    first = EnabledName(after[i]);
                    if (first == null) first = after[i];
                }
                n++;
            }
            return n;
        }

        /// <summary>
        /// The manifest's plugin names that Reorder would have to enable and
        /// cannot, for saying which ones. Empty when Reorder would not return
        /// null for that reason.
        /// </summary>
        public static List<string> NotEnabled(IList<string> lines, IList<string> manifest)
        {
            return Missing(lines, manifest, null);
        }

        /// <summary>NotEnabled for ReorderWhole: the names the game loads first are skipped, as it skips them.</summary>
        public static List<string> NotEnabledWhole(IList<string> lines, IList<string> whole, IList<string> loadedFirst)
        {
            return Missing(lines, whole, loadedFirst);
        }

        static List<string> Missing(IList<string> lines, IList<string> manifest, IList<string> loadedFirst)
        {
            var missing = new List<string>();
            if (lines == null || manifest == null) return missing;
            var first = Names(loadedFirst);
            var have = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string l in lines)
            {
                string name = EnabledName(l);
                if (name != null) have.Add(name);
            }
            foreach (string raw in manifest)
            {
                string n = Norm(raw);
                if (n.Length == 0 || IsMaster(n) || first.Contains(n) || have.Contains(n)) continue;
                if (!missing.Contains(n)) missing.Add(n);
            }
            return missing;
        }

        static HashSet<string> Names(IList<string> names)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (names == null) return set;
            foreach (string raw in names)
            {
                string n = Norm(raw);
                if (n.Length > 0) set.Add(n);
            }
            return set;
        }
    }
}
