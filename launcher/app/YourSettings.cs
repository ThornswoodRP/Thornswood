using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// A person's settings, kept by the site under their Discord account
    /// (#5939, site\lib\your-settings.js), not on this PC.
    ///
    /// Patrick, 12 Nov: "chacrthers, saves, and settings should all be cloud
    /// saved by the server and linked to your discord and not all be saved
    /// locally". Until then every setting lived only here: the keys, field of
    /// view, chat fade and needs bars Settings in the game writes into
    /// Thornswood.ini, the emote wheel's slots, whether the scroll shows before
    /// the character choice, what was saved in each mod's own menu (MCM
    /// Helper's Data\MCM\Settings), and the launcher's own choices in
    /// config.json. An uninstall, a new game folder or another PC started all
    /// of them over.
    ///
    /// The game reads its settings from files, so they are still files while it
    /// runs: PutInPlace writes the account's copy over them before the game
    /// starts, and SendBack sends them to the site once it has closed. The
    /// launcher's choices go up whenever config.json is saved (Noted) and come
    /// down as the launcher starts (TakeLauncher). What belongs to this PC is
    /// never sent: the microphone's name (Mics writes it into Thornswood.ini
    /// at every Play), and the screen and graphics settings.
    /// </summary>
    static class YourSettings
    {
        const string Route = "/api/play/settings";
        const string LauncherName = "launcher.json";
        // The microphone is this PC's device, so its line never leaves it.
        static readonly string[] MachineLines = { "MicrophoneName" };

        /// <summary>
        /// The game's settings files, by the name the site keeps each under,
        /// and where each lives in the game folder. The mod menus are every
        /// .ini MCM Helper has written in Data\MCM\Settings.
        /// </summary>
        static Dictionary<string, string> GameFiles(bool withMenus)
        {
            var all = new Dictionary<string, string>(StringComparer.Ordinal);
            all["game/Thornswood.ini"] = ThornIni.File_;
            all["game/thornswood-emote-slots.json"] = Path.Combine(Paths.Game, "Data\\Platform\\thornswood-emote-slots.json");
            all["game/thornswood-intro.txt"] = Path.Combine(Paths.Game, "Data\\Platform\\thornswood-intro.txt");
            if (withMenus)
            {
                string menus = MenusDir;
                try
                {
                    if (Directory.Exists(menus))
                        foreach (string f in Directory.GetFiles(menus, "*.ini"))
                            all["mcm/" + Path.GetFileName(f)] = f;
                }
                catch (Exception ex) { Swallow.Note("YourSettings.GameFiles, listing the mod menus", ex); }
            }
            return all;
        }

        static string MenusDir { get { return Path.Combine(Paths.Game, "Data\\MCM\\Settings"); } }

        /// <summary>Where a name the site sent lives here, or null for one this launcher does not know.</summary>
        static string PlaceOf(string name)
        {
            string p;
            if (GameFiles(false).TryGetValue(name, out p)) return p;
            if (name.StartsWith("mcm/", StringComparison.Ordinal))
            {
                string file = name.Substring(4);
                if (file.Length > 4 && file.EndsWith(".ini", StringComparison.OrdinalIgnoreCase) &&
                    file.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 && file.IndexOf("..", StringComparison.Ordinal) < 0)
                    return Path.Combine(MenusDir, file);
            }
            return null;
        }

        static string Body(string op, JsonObject files)
        {
            var o = new JsonObject();
            o["ticket"] = Discord.Ticket ?? "";
            o["op"] = op;
            if (files != null) o["files"] = files;
            return o.ToJsonString();
        }

        /// <summary>
        /// The account's files from the site, or throws with what went wrong.
        /// timeoutMs 0 is the launcher's usual wait for the site.
        /// </summary>
        static JsonObject Get(int timeoutMs)
        {
            if (!Discord.Linked) throw new Exception("Connect Discord first: your settings are kept with your Discord account.");
            string reply;
            int code = timeoutMs > 0
                ? Discord.PostBytes(Discord.Site + Route, Encoding.UTF8.GetBytes(Body("get", null)), "application/json", timeoutMs, out reply)
                : Discord.PostJson(Discord.Site + Route, Body("get", null), out reply);
            JsonObject o = null;
            try { o = string.IsNullOrEmpty(reply) ? null : JsonNode.Parse(reply) as JsonObject; }
            catch (Exception ex) { Swallow.Note("YourSettings.Get, reading the answer", ex); }
            if (code == 0) throw new Exception("thornswood.net is not answering, so your settings could not be fetched.");
            var files = o != null ? o["files"] as JsonObject : null;
            if (code != 200 || files == null)
            {
                string message = o != null && o["message"] != null ? (string)o["message"] : "";
                throw new Exception(message.Length > 0 ? message : "thornswood.net answered " + code + " when asked for your settings.");
            }
            return files;
        }

        static void Put(JsonObject files)
        {
            string reply;
            int code = Discord.PostJson(Discord.Site + Route, Body("put", files), out reply);
            if (code == 200) return;
            string message = "";
            try
            {
                var o = string.IsNullOrEmpty(reply) ? null : JsonNode.Parse(reply) as JsonObject;
                if (o != null && o["message"] != null) message = (string)o["message"];
            }
            catch (Exception ex) { Swallow.Note("YourSettings.Put, reading the refusal", ex); }
            throw new Exception(code == 0 ? "thornswood.net is not answering, so your settings were not sent."
                                          : (message.Length > 0 ? message : "thornswood.net answered " + code + " to your settings."));
        }

        // ---------------------------------------------------------- the game

        /// <summary>
        /// Before the game starts: the account's copy of each game setting is
        /// written over the file the game reads. A setting the account has no
        /// copy of yet is left as it is here, and SendBack sends it up when
        /// the game closes. Returns a line for the log, or null. Throws when
        /// the site cannot hand them over, and Play stops: a game started on
        /// this PC's old settings would send them back over the account's.
        /// </summary>
        public static string PutInPlace()
        {
            JsonObject files = Get(0);
            int put = 0;
            foreach (var kv in files)
            {
                string place = PlaceOf(kv.Key);
                string text = kv.Value == null ? null : (string)kv.Value;
                if (place == null || text == null) continue;
                string now = null;
                try { if (File.Exists(place)) now = File.ReadAllText(place); }
                catch (Exception ex) { Swallow.Note("YourSettings.PutInPlace, reading " + place, ex); }
                if (now != null && Strip(now) == text) continue;
                Directory.CreateDirectory(Path.GetDirectoryName(place));
                File.WriteAllText(place, text, new UTF8Encoding(false));
                put++;
            }
            return put == 0 ? null
                : "Put your settings from your Discord account in place: " + put + (put == 1 ? " file." : " files.");
        }

        /// <summary>
        /// Once the game has closed: every game setting as the game left it,
        /// to the site, the microphone's line taken out of Thornswood.ini.
        /// Call it off the window's thread. Throws with what went wrong.
        /// </summary>
        public static void SendBack()
        {
            if (!Discord.Linked) return;
            var files = new JsonObject();
            foreach (var kv in GameFiles(true))
            {
                try
                {
                    if (!File.Exists(kv.Value)) continue;
                    files[kv.Key] = Strip(File.ReadAllText(kv.Value));
                }
                catch (Exception ex) { Swallow.Note("YourSettings.SendBack, reading " + kv.Value, ex); }
            }
            if (files.Count == 0) return;
            Put(files);
        }

        /// <summary>A settings file without the lines that belong to this PC.</summary>
        public static string Strip(string text)
        {
            if (string.IsNullOrEmpty(text)) return text ?? "";
            var keep = new StringBuilder(text.Length);
            foreach (string line in text.Split('\n'))
            {
                string t = line.TrimStart();
                bool machine = false;
                foreach (string k in MachineLines)
                    if (t.StartsWith(k, StringComparison.OrdinalIgnoreCase) && t.Substring(k.Length).TrimStart().StartsWith("=")) machine = true;
                if (machine) continue;
                if (keep.Length > 0) keep.Append('\n');
                keep.Append(line);
            }
            return keep.ToString();
        }

        // ------------------------------------------------------ the launcher

        /// <summary>The launcher's own choices, the ones that are the person's and not this PC's.</summary>
        public static JsonObject LauncherChoices(Config c)
        {
            var o = new JsonObject();
            o["Theme"] = c.Theme ?? "";
            var colors = new JsonArray();
            if (c.CustomColors != null) foreach (string s in c.CustomColors) colors.Add((JsonNode)JsonValue.Create(s ?? ""));
            o["CustomColors"] = colors;
            o["CustomLight"] = c.CustomLight;
            o["MusicOff"] = c.MusicOff;
            o["MusicLevel"] = c.MusicLevel ?? "50";
            o["KeepLauncherOpen"] = c.KeepLauncherOpen;
            o["AutoJoin"] = c.AutoJoin;
            o["AutoUpdate"] = c.AutoUpdate;
            o["VoiceAuto"] = c.VoiceAuto;
            return o;
        }

        /// <summary>
        /// The account's launcher choices laid over c. Returns true when any
        /// changed. A field the account's copy does not have stays as it is.
        /// </summary>
        public static bool ApplyLauncher(Config c, JsonObject o)
        {
            if (o == null) return false;
            string before = LauncherChoices(c).ToJsonString();
            try
            {
                if (o["Theme"] != null) c.Theme = (string)o["Theme"];
                var colors = o["CustomColors"] as JsonArray;
                if (colors != null)
                {
                    var l = new List<string>();
                    foreach (JsonNode n in colors) l.Add(n == null ? "" : (string)n);
                    c.CustomColors = l.Count > 0 ? l.ToArray() : null;
                }
                if (o["CustomLight"] != null) c.CustomLight = (bool)o["CustomLight"];
                if (o["MusicOff"] != null) c.MusicOff = (bool)o["MusicOff"];
                if (o["MusicLevel"] != null) c.MusicLevel = (string)o["MusicLevel"];
                if (o["KeepLauncherOpen"] != null) c.KeepLauncherOpen = (bool)o["KeepLauncherOpen"];
                if (o["AutoJoin"] != null) c.AutoJoin = (bool)o["AutoJoin"];
                if (o["AutoUpdate"] != null) c.AutoUpdate = (bool)o["AutoUpdate"];
                if (o["VoiceAuto"] != null) c.VoiceAuto = (bool)o["VoiceAuto"];
            }
            catch (Exception ex) { Swallow.Note("YourSettings.ApplyLauncher, a field of the wrong kind", ex); }
            string after = LauncherChoices(c).ToJsonString();
            lock (gate) { sent = after; }
            return after != before;
        }

        /// <summary>
        /// As the launcher starts, before its window is drawn: the account's
        /// launcher choices over config.json's. Waits at most timeoutMs for the
        /// site, because the window waits on it; with no answer the launcher
        /// starts on config.json's and says why in the line returned. Returns a
        /// line for the log, or null when nothing changed.
        /// </summary>
        public static string TakeLauncher(Config c, int timeoutMs)
        {
            if (!Discord.Linked) return null;
            JsonObject files;
            try { files = Get(timeoutMs); }
            catch (Exception ex) { return "Your launcher settings were not fetched from your Discord account: " + ex.Message; }
            string text = files[LauncherName] == null ? null : (string)files[LauncherName];
            if (text == null)
            {
                // Nothing kept yet: this PC's choices become the account's.
                Noted(c);
                return null;
            }
            JsonObject o = null;
            try { o = JsonNode.Parse(text) as JsonObject; }
            catch (Exception ex) { Swallow.Note("YourSettings.TakeLauncher, reading launcher.json", ex); }
            if (!ApplyLauncher(c, o)) return null;
            c.Save(Paths.CfgFile);
            return "Took your launcher settings from your Discord account.";
        }

        static readonly object gate = new object();
        // What was last sent or taken, so a Save that changed none of the
        // person's choices sends nothing.
        static string sent;
        // The newest choices not sent yet, and whether a send is under way.
        // One send at a time, newest last, so two quick Saves can never
        // reach the site in the wrong order and leave the older one kept.
        static string pending;
        static bool sending;

        /// <summary>
        /// config.json was saved: when the person's choices in it changed,
        /// they go to the site off the calling thread. Config.Save calls this.
        /// </summary>
        public static void Noted(Config c)
        {
            if (c == null || !Discord.Linked) return;
            string now = LauncherChoices(c).ToJsonString();
            lock (gate)
            {
                if (now == sent) return;
                sent = now;
                pending = now;
                if (sending) return;
                sending = true;
            }
            ThreadPool.QueueUserWorkItem(delegate { SendPending(); });
        }

        static void SendPending()
        {
            while (true)
            {
                string next;
                lock (gate)
                {
                    next = pending;
                    pending = null;
                    if (next == null) { sending = false; return; }
                }
                try
                {
                    var files = new JsonObject();
                    files[LauncherName] = next;
                    Put(files);
                }
                catch (Exception ex)
                {
                    // Not sent, so the next Save tries again with whatever is
                    // current then.
                    lock (gate) { if (sent == next) sent = null; }
                    Swallow.Note("YourSettings.Noted, sending the launcher's choices", ex);
                }
            }
        }
    }
}
