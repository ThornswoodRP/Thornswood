using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// Points the game at the server before it starts.
    ///
    /// Under the old multiplayer mod this was a real piece of work: its join menu was a
    /// Chromium page, so connecting for someone meant injecting a script beside
    /// it, wrapping the bridge object the game put on the window, fanning out
    /// listeners because the bridge allowed only one per event, and retrying.
    ///
    /// SkyMP has no join menu. The client reads server-ip and server-port out of
    /// skymp5-client-settings.txt at startup and connects on its own, so all
    /// that is left is writing two values into a file.
    ///
    /// Edited as text rather than parsed and rewritten. A serializer bound to a
    /// class drops keys it was not told about, and this file belongs to SkyMP, not to
    /// us: a key added upstream would vanish the first time the launcher touched
    /// it. Everything not named here is left exactly as found.
    /// </summary>
    static class AutoJoin
    {
        public static string SettingsFile
        {
            get { return Path.Combine(Paths.Game, "Data\\Platform\\Plugins\\skymp5-client-settings.txt"); }
        }

        /// <summary>
        /// Makes sure the settings file exists at all, and says so when it had
        /// to be made.
        ///
        /// Nothing ships this file. The 16 Sep installer carried one person's
        /// character id inside it, so every new install walked in as that
        /// character. The fix that evening made it a machine file that never
        /// leaves a machine, which was right, and nothing was put in its place.
        /// The client bundle does not create it, and every function in this
        /// class returned early when it was missing. So from that evening on a
        /// fresh install could not choose a character: SetProfileId returned
        /// false, GetProfileId read nothing, and Chars.StartAs stopped with
        /// "they still say no profile", which is what a tester reported on
        /// 17 Sep after reinstalling.
        ///
        /// The file holds only what the bundle reads: both profile ids at 0,
        /// no hours offset, and an empty server address for Apply to fill on
        /// the way to Play. Keybinds are left out on purpose; Keys.cs makes
        /// that block the first time it writes one.
        /// </summary>
        public static bool Ensure(Action<string> say)
        {
            try
            {
                string file = SettingsFile;
                if (File.Exists(file)) return false;
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                string json =
                    "{" + Environment.NewLine +
                    "  \"profileId\": 0," + Environment.NewLine +
                    "  \"gameData\": { \"profileId\": 0 }," + Environment.NewLine +
                    "  \"hoursOffset\": 0," + Environment.NewLine +
                    "  \"master\": \"\"," + Environment.NewLine +
                    "  \"server-ip\": \"\"," + Environment.NewLine +
                    "  \"server-port\": 7777," + Environment.NewLine +
                    "  \"server-master-key\": \"\"" + Environment.NewLine +
                    "}" + Environment.NewLine;
                File.WriteAllText(file, json, new UTF8Encoding(false));
                if (say != null) say("Made a fresh client settings file, because this install had none.");
                return true;
            }
            catch (Exception ex)
            {
                if (say != null) say("Could not make the client settings file: " + ex.Message);
                return false;
            }
        }

        /// <summary>Writes the address and port. Returns a line for the log, or null when nothing changed.</summary>

        /// <summary>
        /// Cheap structural check before anything is written back.
        ///
        /// This file is read by SkyrimPlatform while it loads plugins, so a
        /// malformed one does not just break joining: it throws during startup
        /// and every plugin after the throw never runs. That is the emote wheel
        /// and the creation menus gone, with the only evidence a single line in
        /// skyrim-platform.log that nobody thinks to look at. Whatever is wrong
        /// with an edit, leaving the old file in place is better.
        ///
        /// Not a parser, deliberately: balanced braces and quotes catch the
        /// shape of every corruption an edit here can produce, and the launcher
        /// has no JSON reader that round trips a document it was not told about.
        /// </summary>
        static bool LooksLikeJson(string t)
        {
            if (string.IsNullOrEmpty(t)) return false;
            string s = t.Trim();
            if (s.Length < 2 || s[0] != '{' || s[s.Length - 1] != '}') return false;

            int depth = 0;
            bool inStr = false, esc = false;
            foreach (char c in s)
            {
                if (inStr)
                {
                    if (esc) { esc = false; continue; }
                    if (c == '\\') { esc = true; continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == '{' || c == '[') depth++;
                else if (c == '}' || c == ']') { depth--; if (depth < 0) return false; }
                // A lone $ outside a string is the signature of a regex
                // replacement that did not expand, which is what put "$17777"
                // in this file where the port should have been.
                else if (c == '$') return false;
            }
            return depth == 0 && !inStr;
        }

        public static string Apply(Config cfg)
        {
            try
            {
                string file = SettingsFile;
                Ensure(null);
                if (!File.Exists(file))
                    return "SkyMP's client settings file is missing and could not be made, so the server address was not set.";

                if (!cfg.AutoJoin)
                    return "Auto join is off, leaving the server address as it is.";

                int port;
                if (!int.TryParse(cfg.ServerPort, out port) || port <= 0) port = 7777;

                string host = cfg.ServerAddress;
                if (string.IsNullOrEmpty(host))
                    return "No server address is set, so the game was left pointing wherever it was.";

                string before = File.ReadAllText(file);
                string after = SetString(before, "server-ip", host);
                after = SetNumber(after, "server-port", port);

                // Where the client goes looking for the load order it has to
                // match. Left empty, getMasterUrl falls back to
                // https://gateway.skymp.net and getServerMasterKey falls back
                // to "<address>:<port>", so every launch asked a public server
                // about an address it has never heard of, five times, and got
                // an empty mod list back.
                //
                // An empty list is not an error to that code. It prints the
                // yellow "you have more mods than server" line for five
                // seconds and then compares against nothing, so the load order
                // has never once been checked here. The gamemode publishes the
                // real manifest at this key on the resources port, which makes
                // the warning go away and the check mean something.
                //
                // A name rather than the address, because the key lands in a
                // file path on the server and a colon cannot go in one.
                after = SetString(after, "master", "http://" + host + ":" + ResourcePort(port));
                after = SetString(after, "server-master-key", "thornswood");

                // The publish step diffs the game folder by size and date, so a
                // file rewritten on every launch would show as a change every
                // single time even when nothing moved.
                if (string.Equals(before, after, StringComparison.Ordinal)) return null;

                if (!LooksLikeJson(after))
                    return "Left the client settings alone: the edit would have broken the file, " +
                           "and a broken one stops SkyrimPlatform loading any plugin at all.";

                string pointed = after;
                Hold.Around(file, delegate { File.WriteAllText(file, pointed, new UTF8Encoding(false)); });
                return "Pointed the game at " + host + ":" + port + ".";
            }
            catch (Exception ex)
            {
                return "Could not set the server address: " + ex.Message;
            }
        }

        /// <summary>
        /// The port the server serves its resources folder on.
        ///
        /// Worked out the same way the server does it, in ui.ts:
        ///
        ///     const uiPort = settings.port === 7777 ? 3000 : settings.port + 1;
        /// </summary>
        static int ResourcePort(int gamePort)
        {
            return gamePort == 7777 ? 3000 : gamePort + 1;
        }

        /// <summary>
        /// Which character slot the client is currently set to, or 0.
        ///
        /// Read back out of the settings file rather than remembered in a
        /// field, so there is one answer and it is the one the game will
        /// actually use. The server's door identifies people by this number,
        /// so a stale copy here would lock the wrong person out.
        /// </summary>
        public static int GetProfileId()
        {
            try
            {
                string file = SettingsFile;
                if (!File.Exists(file)) return 0;
                var m = Regex.Match(File.ReadAllText(file),
                                    "\"profileId\"\\s*:\\s*(-?[0-9]+)");
                if (!m.Success) return 0;
                int n;
                if (!int.TryParse(m.Groups[1].Value, out n)) return 0;
                return n > 0 ? n : 0;
            }
            catch { return 0; }
        }

        /// <summary>
        /// Which character slot the client asks the server for.
        ///
        /// It has to go INSIDE gameData. That is not a tidiness point, it is
        /// the whole difference between walking into the world and staring at
        /// a login box.
        ///
        /// authService.ts decides on one line:
        ///
        ///     const settingsGameData = this.sp.settings["skymp5-client"]["gameData"];
        ///     const isOfflineMode = Number.isInteger(settingsGameData?.profileId);
        ///
        /// An integer there and the client emits authAttempt with the local
        /// profile and joins. Anything else and it takes the remote path: it
        /// shows the AUTHORIZATION panel over the main menu, reads a token out
        /// of PluginsNoLoad\auth-data-no-load.js that this launcher has never
        /// written, fails to resolve it against the master, and sits there
        /// saying ID: UNDEFINED. The log line for it is
        /// "No offline mode detectted in settings, regular auth needed",
        /// spelling and all.
        ///
        /// This was writing profileId at the top level of the document, where
        /// gameData?.profileId is undefined, so offline mode has never once
        /// engaged. Nothing else was wrong: not the token, not the browser,
        /// not the menu.
        /// </summary>
        public static bool SetProfileId(int profileId)
        {
            try
            {
                string file = SettingsFile;
                Ensure(null);
                if (!File.Exists(file)) return false;
                string before = File.ReadAllText(file);

                // Put one inside gameData if it is not there, then bring every
                // copy in the file to the same number. Older files carry a top
                // level profileId from before this was understood, and two
                // copies that disagree is how GetProfileId starts answering
                // with the wrong slot.
                string after = EnsureInGameData(before, "profileId", profileId.ToString());
                after = SetEveryNumber(after, "profileId", profileId);

                if (string.Equals(before, after, StringComparison.Ordinal)) return false;
                if (!LooksLikeJson(after)) return false;
                string changed = after;
                Hold.Around(file, delegate { File.WriteAllText(file, changed, new UTF8Encoding(false)); });
                return true;
            }
            catch { return false; }
        }

        /// <summary>
        /// Tell the client to wait at the main menu and let the person pick,
        /// rather than connecting as one id the moment it loads.
        ///
        /// Since 20 September the launcher has no character picker of its
        /// own. gameData.chooseAtMenu = true is what our fork of the client
        /// reads to hold at the menu, and gameData.profileId still carries a
        /// number, the id played last (or the spare on an install that has
        /// played nobody), so the menu has something to offer first and an
        /// older client that does not know the flag still walks in as
        /// somebody rather than showing the login box (see SetProfileId for
        /// why the number has to be inside gameData).
        ///
        /// Same edit style as SetProfileId: one key put inside gameData when
        /// it is not there, every copy in the file brought to the same value,
        /// the shape checked, and the write under Hold.Around. Then the file
        /// is read back and this throws when it does not say what was
        /// written, because a write that quietly failed leaves the client
        /// connecting as whoever the last session left there. Play stops on
        /// the throw. Never called while the game runs: a write to this file
        /// hot reloads every plugin.
        /// </summary>
        public static void SetChooseAtMenu(int lastProfileId)
        {
            string file = SettingsFile;
            Ensure(null);
            if (!File.Exists(file))
                throw new Exception("SkyMP's client settings file is missing and could not be made, so the game was not started.");

            string before = File.ReadAllText(file);
            string after = EnsureInGameData(before, "profileId", lastProfileId.ToString());
            after = SetEveryNumber(after, "profileId", lastProfileId);
            after = EnsureInGameData(after, "chooseAtMenu", "true");
            after = SetEveryBool(after, "chooseAtMenu", true);
            // SkyMP's skipUpdates draws everybody else's movement at half
            // rate (worldView.ts skips every other update when it is true).
            // Patrick, 28 September (#963): it stays off. Absent is off, so
            // nothing is added; one that says true is put back to false.
            after = SetEveryBool(after, "skipUpdates", false);

            if (!string.Equals(before, after, StringComparison.Ordinal))
            {
                if (!LooksLikeJson(after))
                    throw new Exception("Left the client settings alone: the edit would have broken the file, " +
                                        "and a broken one stops SkyrimPlatform loading any plugin at all. The game was not started.");
                string changed = after;
                Hold.Around(file, delegate { File.WriteAllText(file, changed, new UTF8Encoding(false)); });
            }

            int wrote = GetProfileId();
            bool menu = GetChooseAtMenu();
            if (wrote != lastProfileId || !menu)
                throw new Exception(
                    "The client settings could not be written: they say " +
                    (wrote > 0 ? "profile " + wrote : "no profile") + " instead of profile " + lastProfileId +
                    (menu ? "" : " and do not ask for the menu") + ". " +
                    "Skyrim would have connected as whoever the last session left there, so it was not started. " +
                    "Check that Data\\Platform\\Plugins\\skymp5-client-settings.txt is not read only.");
        }

        /// <summary>True when the file asks the client to wait at the menu.</summary>
        static bool GetChooseAtMenu()
        {
            try
            {
                string file = SettingsFile;
                if (!File.Exists(file)) return false;
                return Regex.IsMatch(File.ReadAllText(file), "\"chooseAtMenu\"\\s*:\\s*true");
            }
            catch { return false; }
        }

        // ------------------------------------------------------------ text edits
        // Replace the value of an existing key, or add the key if it is absent.
        // Absent is worth handling: an older settings file predates some of
        // these keys, and silently doing nothing would leave the game pointed at
        // localhost with no sign of why.

        /// <summary>
        /// Makes sure gameData holds this key, without disturbing anything
        /// else in it. The value itself is set afterwards by SetEveryNumber,
        /// so this only has to create the slot.
        ///
        /// Braces are walked rather than matched with a pattern, because
        /// gameData holds objects of its own and a lazy pattern stops at the
        /// first inner brace.
        /// </summary>
        static string EnsureInGameData(string json, string key, string literal)
        {
            var at = Regex.Match(json, "\"gameData\"\\s*:\\s*\\{");
            if (!at.Success)
            {
                // No gameData at all, which is an older file. Give it one.
                return Insert(json, "gameData", "{ \"" + key + "\": " + literal + " }");
            }

            int open = at.Index + at.Length - 1;
            int depth = 0, close = -1;
            bool inStr = false, esc = false;
            for (int i = open; i < json.Length; i++)
            {
                char c = json[i];
                if (inStr)
                {
                    if (esc) { esc = false; continue; }
                    if (c == '\\') { esc = true; continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == '{') depth++;
                else if (c == '}') { depth--; if (depth == 0) { close = i; break; } }
            }
            if (close < 0) return json;

            string block = json.Substring(open, close - open + 1);
            if (Regex.IsMatch(block, "\"" + Regex.Escape(key) + "\"\\s*:")) return json;

            string indent = "    ";
            var m = Regex.Match(block, "\\r?\\n([ \\t]+)\"");
            if (m.Success) indent = m.Groups[1].Value;

            string rest = block.Substring(1);
            string sep = Regex.IsMatch(rest, "^\\s*\\}") ? "" : ",";
            string next = "{" + Environment.NewLine + indent + "\"" + key + "\": " + literal + sep + rest;

            return json.Substring(0, open) + next + json.Substring(close + 1);
        }

        /// <summary>
        /// Same value everywhere the key appears. SetNumber stops at the first
        /// one, which is right for a key that occurs once and wrong for one
        /// that an older file put in two places.
        /// </summary>
        static string SetEveryNumber(string json, string key, int value)
        {
            var rx = new Regex("(\"" + Regex.Escape(key) + "\"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?|null)");
            return rx.Replace(json, "${1}" + value.ToString());
        }

        /// <summary>The same, for a key whose value is true or false.</summary>
        static string SetEveryBool(string json, string key, bool value)
        {
            var rx = new Regex("(\"" + Regex.Escape(key) + "\"\\s*:\\s*)(true|false|null)");
            return rx.Replace(json, "${1}" + (value ? "true" : "false"));
        }

        static string SetString(string json, string key, string value)
        {
            string quoted = "\"" + Escape(value) + "\"";
            var rx = new Regex("(\"" + Regex.Escape(key) + "\"\\s*:\\s*)(\"(?:[^\"\\\\]|\\\\.)*\"|null)");
            if (rx.IsMatch(json)) return rx.Replace(json, "${1}" + quoted.Replace("$", "$$"), 1);
            return Insert(json, key, quoted);
        }

        static string SetNumber(string json, string key, int value)
        {
            var rx = new Regex("(\"" + Regex.Escape(key) + "\"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?|null)");
            // ${1} rather than $1, and the braces are the whole point. A
            // replacement of "$1" + 7777 is the string "$17777", which .NET
            // reads as capture group 17777. There is no such group, so it gives
            // up and writes the six characters literally: the file ends up with
            //     $17777
            // where the port should be, and profile id 2 lands as $12. That is
            // not valid JSON, so SkyrimPlatform throws while loading plugins,
            // and every plugin after the throw never runs. It costs you the
            // emote wheel and the creation menus and says nothing about why.
            if (rx.IsMatch(json)) return rx.Replace(json, "${1}" + value.ToString(), 1);
            return Insert(json, key, value.ToString());
        }

        static string Insert(string json, string key, string literal)
        {
            int brace = json.IndexOf('{');
            if (brace < 0) throw new Exception("skymp5-client-settings.txt is not an object");

            // Match the file's own indentation rather than imposing ours, so the
            // diff stays to the one line that actually changed.
            string indent = "  ";
            var m = Regex.Match(json.Substring(brace), "\\r?\\n([ \\t]+)\"");
            if (m.Success) indent = m.Groups[1].Value;

            string rest = json.Substring(brace + 1);
            string sep = Regex.IsMatch(rest, "^\\s*\\}") ? "" : ",";
            return json.Substring(0, brace + 1) + Environment.NewLine +
                   indent + "\"" + key + "\": " + literal + sep + rest;
        }

        static string Escape(string s)
        {
            if (s == null) return "";
            var b = new StringBuilder();
            foreach (char c in s)
            {
                if (c == '\\' || c == '"') b.Append('\\').Append(c);
                else if (c == '\r') b.Append("\\r");
                else if (c == '\n') b.Append("\\n");
                else if (c == '\t') b.Append("\\t");
                else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
                else b.Append(c);
            }
            return b.ToString();
        }
    }
}
