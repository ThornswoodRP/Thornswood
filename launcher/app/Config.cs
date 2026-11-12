using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Thornswood
{
    public class Config : IJsonOnDeserialized
    {
        // The game's own name, a DNS only record in Cloudflare that points at
        // the box (#3690). A name and not the box's address, so the address
        // is written in no file, and a box move is the record and nothing
        // here. The game client resolves it itself (SLikeNet's Connect takes
        // a name), and so does everything else the launcher asks.
        [JsonInclude] public string ServerAddress = "play.thornswood.net";
        // SkyMP's default. 25565 was the old build's, on the old box.
        [JsonInclude] public string ServerPort = "7777";

        /*
          The Nexus collection that installs the mods.

          The installer stopped carrying them: anything the collection provides
          is left out of it, which is what took it from fourteen gigabytes to
          something somebody will actually finish downloading. That trade only
          works if the launcher sends people to the collection, so a build with
          this empty and an installer built against a collection is a build
          nobody can play.

          Compiled in below (Collection): until #5608 the update feed on the
          site moved it, and with the feed gone a new collection goes out as
          a new launcher.
        */
        [JsonInclude] public string CollectionUrl = Collection;

        // The one we ship with, and the one a config.json without a link is
        // given, so somebody installing for the first time is sent to it.
        public const string Collection =
            "https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf";

        // Where a server on this machine lives, when the address above is this
        // machine. Blank means look in the usual two places.
        [JsonInclude] public string ServerFolder = "";

        // Proximity voice runs beside the game server on its own port. The
        // audio goes straight between people; this is only where the browser
        // window connects for positions and signalling.
        [JsonInclude] public string VoicePort = "7778";

        /// <summary>
        /// Where the voice service is: https://thornswood.net/voice, or
        /// /voice-dev on the dev build.
        /// </summary>
        /// <remarks>
        /// Everything voice does goes through Caddy on 443: one door with a
        /// certificate on it, and wss:// rather than ws://, so nobody's voice
        /// signalling, join token or Discord ticket crosses the internet in
        /// the clear.
        ///
        /// Empty, or anything that is not https, used to mean the raw port,
        /// http://address:7778. That port has been shut from outside since
        /// 29 September, the service refuses a token over plain ws (#1304),
        /// and FetchToken never sent the ticket to it anyway, so VoiceBase
        /// gives the built-in address instead (Voice, below).
        /// </remarks>
        [JsonInclude] public string VoiceUrl = "";

        /// <summary>
        /// The voice service behind Caddy, for a config whose VoiceUrl is
        /// empty or not https. The dev build adds -dev, the
        /// same as DevBuild.DevVoiceUrl, written out here because several
        /// harnesses compile this file without DevBuild.cs.
        /// </summary>
        public const string Voice = "https://thornswood.net/voice";

        /// <summary>
        /// The voice service as a base address, https, with no trailing slash.
        /// </summary>
        public string VoiceBase()
        {
            string u = VoiceUrl == null ? "" : VoiceUrl.Trim();
            while (u.EndsWith("/")) { u = u.Substring(0, u.Length - 1); }
            if (u.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) { return u; }
            return IsDev ? Voice + "-dev" : Voice;
        }

        /// <summary>
        /// The same address as a WebSocket url, which is always wss (#1304).
        /// </summary>
        public string VoiceSocket()
        {
            return "wss://" + VoiceBase().Substring(8) + "/";
        }

        /*
          Which microphone to record from, by name, or empty for whatever
          Windows is set to.

          It lives here rather than in Thornswood.ini because the ini is a mod
          file: an update replaces it wholesale, so anything set in it by hand
          is gone the next time the build changes. The launcher copies this
          into the ini at every launch, which also means somebody who never
          touches it still gets their own machine's default written in rather
          than whoever built the release.
        */
        [JsonInclude] public string MicrophoneName = "";

        [JsonInclude, JsonPropertyName("VoiceAuto")] public bool? VoiceAutoSetting = true;

        [JsonIgnore]
        public bool VoiceAuto
        {
            get { return VoiceAutoSetting != false; }
            set { VoiceAutoSetting = value; }
        }
        // How many the server seats, the M of "N of M awake", for when the
        // server does not announce itself: what the update feed last gave a
        // config.json before the feed went (#5608), and 0 otherwise. Main and
        // dev seat differently since 12 Oct (30 and 5,
        // records\most-online.json), so no number built in here is right for
        // both, and 0 shows "N awake" with no "of".
        [JsonInclude] public int MaxOnline = 0;

        /// <summary>
        /// SkyrimSE.exe's size at the build Thornswood is pinned to (#471),
        /// records\skyrim-pin.json's expectedExeBytes, compiled in with the
        /// rest of the pin (Downgrade.cs). Not kept in config.json: the update
        /// feed used to move it there, and with the feed gone (#5608) a copy
        /// in the file would only ever be a stale one. A new pin goes out as
        /// a new launcher.
        /// </summary>
        public const long PinnedExeBytes = 37157144;

        // The sizes the checks compare SkyrimSE.exe with: the pin's, and 0
        // for the newer build's is Downgrade.NewerExeBytes. Never read from
        // or written to config.json; only a harness changes them, to stand a
        // small file in for the exe.
        [JsonIgnore] public long ExpectedExeBytes = PinnedExeBytes;
        [JsonIgnore] public long NewerExeBytes;

        // "dev" here, or in Channel, makes this install the dev channel's
        // (Velo.ChannelFor). The token, the repository and the feed address
        // that sat beside it went with the update feed (#5608): updates come
        // from this repository's Releases on GitHub, which need no credential.
        [JsonInclude] public string UpdateBranch = "main";

        [JsonInclude] public string Theme = "Forge";

        // A theme the person builds for themselves on the Settings page, kept
        // as flat name/hex pairs so the serializer stays as plain as the rest
        // of this file: "Bg","#100D0A","Panel","#171310", and so on for the
        // sixteen colour names in Themes.cs. Null or too short to hold a pair
        // means none has been made, and "Custom" is not offered. CustomLight
        // is the same choice a built-in theme makes with its Light flag, so
        // anything that draws its own graphics can pick a side.
        [JsonInclude] public string[] CustomColors = null;
        [JsonInclude] public bool CustomLight = false;

        /*
          Which build this install follows. Empty is the main build, the one
          everybody plays on. "dev" is the dev channel of the same install
          (#5608, Patrick's answer B on 11 Nov 2026): the Server card's Main
          and Dev switch sets it (DevBuild.Switch), and the launcher then
          takes that channel's package from GitHub, game files included, and
          joins the dev server. New work lands there first and gets broken
          there, so the main build stays playable while it is being tested.
          A dev copy in its own folder from before that is an old copy
          (DevBuild.IsOldCopy).
        */
        [JsonInclude] public string Channel = "";

        [JsonIgnore]
        public bool IsDev
        {
            get { return string.Equals(Channel, "dev", StringComparison.OrdinalIgnoreCase); }
        }

        /// <summary>What this build is called in titles, shortcuts and Discord.</summary>
        [JsonIgnore]
        public string BuildName
        {
            get { return IsDev ? "Thornswood Dev" : "Thornswood"; }
        }

        // The Thornswood application on Discord, the same one the sign in
        // goes through. The presence card ("Playing Thornswood") is set under
        // it, so it carries that application's name and art. Application ids
        // are public, this is not a secret.
        [JsonInclude] public string DiscordAppId = "1549251507361292418";

        // Where the Download button on the presence card goes, and the root
        // the Discord button is built from (SiteUrl + /discord).
        [JsonInclude] public string SiteUrl = "https://thornswood.net";

        // The picture on the presence card. A public https image; Discord
        // fetches it itself. Empty turns the picture off.
        [JsonInclude] public string PresenceImage = "https://thornswood.net/presence.png";

        // Set the first time the launcher matches the game to this screen, so
        // it never does it again and never argues with a choice made since.
        // A plain bool is right here: absent means it has not happened, which
        // is exactly what false means.
        [JsonInclude] public bool DisplaySet = false;

        [JsonInclude] public bool KeepLauncherOpen = false;

        // A full crash snapshot (#2626). Off unless the person turns it on in
        // Settings: one can be 9 GB or more, and Djinn, 17 October, found one
        // on his PC that nobody had told him was being written. Absent means
        // off, which is what false means. The folder is where they go; blank
        // leaves them beside the crash log, where Crash Logger writes them.
        [JsonInclude] public bool CrashSnapshots = false;
        [JsonInclude] public string CrashSnapshotFolder = "";

        // Ticked, the launcher stops matching the game's resolution to the
        // screen when you press Play. For anyone deliberately running the game
        // at something other than what the monitor is set to.
        [JsonInclude] public bool LockResolution = false;

        // The launcher's music: off, or a volume from 0 to 100. Asked for by
        // Patrick on 20 September, the day the dev test track went in
        // (Shell.StartMenuMusic). Nothing plays on the main build yet.
        //
        // Stored the way round that makes ABSENT mean on and half. The .NET
        // Framework serializer this file was read with until #4823 skipped
        // field initialisers, so a bool that was not in the file was false
        // and an int 0, and the first config.json with no music fields in it
        // came up switched off and silent. System.Text.Json runs them, and
        // the way round still holds for a file that says null: a false
        // MusicOff is on; a null MusicLevel is 50.
        [JsonInclude] public bool MusicOff = false;
        [JsonInclude] public string MusicLevel = "50";

        [JsonIgnore]
        public bool MusicOn
        {
            get { return !MusicOff; }
            set { MusicOff = !value; }
        }

        [JsonIgnore]
        public int MusicVolume
        {
            get
            {
                int v;
                if (!int.TryParse(MusicLevel, out v)) return 50;
                return Math.Max(0, Math.Min(100, v));
            }
            set { MusicLevel = Math.Max(0, Math.Min(100, value)).ToString(); }
        }

        // The Skyrim folder Vortex deploys into, which Thornswood's own folder is
        // made from (see OwnGame). Blank means the Steam copy. Set it when Vortex
        // has been moved to a folder of its own so the Steam copy can stay clean.
        [JsonInclude] public string VortexGame = "";

        // Whether the launcher makes Thornswood's own Skyrim folder without
        // asking, the moment it can (AskOwnGame in ShellOwnGame.cs). The setup
        // window's tick box, "Give Thornswood a Skyrim folder of its own",
        // writes it (InstallSteps.OwnFolderCard, issue #906). The box starts
        // ticked and an absent key counts as ticked (Patrick, 12 Nov: the own
        // folder is the default for everyone), because Thornswood only plays
        // from that folder (OwnGameRequired) and a question whose no leaves
        // Play shut is not a real choice. Only an explicit false, the box
        // unticked, has the launcher ask first. Nullable for the same reason
        // as StopServerSetting below: the serializer skips field initialisers.
        [JsonInclude, JsonPropertyName("MakeOwnGame")] public bool? MakeOwnGameSetting = true;

        [JsonIgnore]
        public bool MakeOwnGame
        {
            get { return MakeOwnGameSetting != false; }
            set { MakeOwnGameSetting = value; }
        }

        // Which in game browser the last Play left SkyrimPlatform.ini naming,
        // "nirnlab" or "tilted", so the Settings page can say it after a
        // restart and a report about the interface can quote it. Blank (or
        // absent, which comes back null) means no Play has settled it yet.
        // Written by StartPlay (ShellChars.cs) from Chars.BrowserBackend.
        [JsonInclude] public string BrowserBackend = "";

        // These two default to ON, which a plain bool cannot express here: the
        // serializer skips field initialisers, and false and absent look the
        // same afterwards. So an older config.json, which has neither key,
        // would quietly come back with both switched off. Nullable tells the
        // two apart, and only an explicit false counts as off.
        // Ticked, a server this launcher started is stopped again when the
        // launcher closes, so it is not left holding the port.
        [JsonInclude, JsonPropertyName("StopServerOnExit")] public bool? StopServerSetting = true;

        [JsonIgnore]
        public bool StopServerOnExit
        {
            get { return StopServerSetting != false; }
            set { StopServerSetting = value; }
        }

        [JsonInclude, JsonPropertyName("AutoUpdate")] public bool? AutoUpdateSetting = true;
        [JsonInclude, JsonPropertyName("AutoJoin")]   public bool? AutoJoinSetting = true;

        [JsonIgnore]
        public bool AutoUpdate
        {
            get { return AutoUpdateSetting != false; }
            set { AutoUpdateSetting = value; }
        }

        [JsonIgnore]
        public bool AutoJoin
        {
            get { return AutoJoinSetting != false; }
            set { AutoJoinSetting = value; }
        }

        // System.Text.Json runs the field initialisers, so a field absent
        // from the file keeps its default; one the file holds as null or
        // empty comes back so, and gets its default here.
        void IJsonOnDeserialized.OnDeserialized() { AfterLoad(); }

        void AfterLoad()
        {
            if (string.IsNullOrEmpty(ServerAddress)) ServerAddress = "play.thornswood.net";
            if (string.IsNullOrEmpty(ServerPort)) ServerPort = "7777";
            if (ServerFolder == null) ServerFolder = "";
            if (string.IsNullOrEmpty(CollectionUrl)) CollectionUrl = Collection;
            if (string.IsNullOrEmpty(VoicePort)) VoicePort = "7778";
            if (VoiceUrl == null) VoiceUrl = "";
            VoiceUrl = VoiceUrl.Trim();
            while (VoiceUrl.EndsWith("/")) { VoiceUrl = VoiceUrl.Substring(0, VoiceUrl.Length - 1); }

            if (string.IsNullOrEmpty(UpdateBranch)) UpdateBranch = "main";
            if (string.IsNullOrEmpty(Theme)) Theme = "Forge";
            if (Channel == null) Channel = "";
            if (string.IsNullOrEmpty(DiscordAppId)) DiscordAppId = "1549251507361292418";
            if (string.IsNullOrEmpty(SiteUrl)) SiteUrl = "https://thornswood.net";
            if (PresenceImage == null) PresenceImage = "https://thornswood.net/presence.png";
            if (VortexGame == null) VortexGame = "";
        }

        public static Config Load(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    // Notepad and PowerShell both like to write a UTF-8 byte order
                    // mark, and the JSON reader refuses to parse past one. Losing
                    // the config here would silently turn updates off, so it goes.
                    byte[] raw = File.ReadAllBytes(path);
                    int skip = (raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF) ? 3 : 0;
                    var c = JsonSerializer.Deserialize(new ReadOnlySpan<byte>(raw, skip, raw.Length - skip), ConfigJson.Default.Config);
                    if (c != null) return c;
                }
            }
            catch (Exception ex) { Swallow.Note("Config.Load, reading " + path, ex); }
            return new Config();
        }

        public void Save(string path)
        {
            try
            {
                File.WriteAllBytes(path, JsonSerializer.SerializeToUtf8Bytes(this, ConfigJson.Writer.Config));
                Secrets.LockDown(path);
            }
            // Still no throw, so every caller behaves as it did, but a Save
            // that failed now says so in launcher.log. It used to be the
            // tester saying the Save button did nothing, and nothing else.
            catch (Exception ex) { Swallow.Note("Config.Save, writing " + path, ex); }
        }
    }

    /// <summary>
    /// One note on the News tab: one build Release's notes (ReleaseNews.cs,
    /// #5187). Filled by the launcher from GitHub.
    /// </summary>
    public class NewsItem
    {
        // When the Release was published, M-d-yyyy h:mm tt in this machine's time.
        public string date = "";
        public string title = "";
        public string body = "";
        // What changed in that release, one line each: the "- " lines of the
        // Release's notes.
        public string[] details = null;

        // Which build this note came out on. Empty is a release main's
        // Deployment has reached, the build everybody plays. "dev" is one
        // only dev's has, and only the dev launcher ever sees one, so the
        // News tab can tell what is on dev and not on main yet. Worked out
        // at every read from the two Deployments, so a note that reaches main
        // loses the mark by itself.
        public string channel = "";

        [JsonIgnore]
        public bool IsDev
        {
            get { return channel == "dev"; }
        }

        /// <summary>
        /// The date as it is shown, month first and with the time on it.
        ///
        /// The publisher writes this field, and what it writes has changed:
        /// entries from before carry a bare "17 Sep 2026" with no time at all.
        /// Rewriting the old notes to match would be rewriting history for the sake
        /// of a format, so the reading end converts instead, exactly as the
        /// site does with the stamp under its download button.
        ///
        /// A date that arrives in none of the shapes below is shown as it came,
        /// because a note with an odd date is still a note worth reading.
        /// </summary>
        [JsonIgnore]
        public string DateText
        {
            get
            {
                if (string.IsNullOrEmpty(date)) return "";

                string[] withTime = { "M-d-yyyy h:mm tt", "yyyy-MM-dd HH:mm", "d MMM yyyy HH:mm" };
                string[] dateOnly = { "d MMM yyyy", "M-d-yyyy", "yyyy-MM-dd" };
                DateTime t;

                if (DateTime.TryParseExact(date, withTime, CultureInfo.InvariantCulture,
                                           DateTimeStyles.None, out t))
                    return t.ToString("M-d-yyyy h:mm tt", CultureInfo.InvariantCulture);

                if (DateTime.TryParseExact(date, dateOnly, CultureInfo.InvariantCulture,
                                           DateTimeStyles.None, out t))
                    return t.ToString("M-d-yyyy", CultureInfo.InvariantCulture);

                return date;
            }
        }
    }

    /// <summary>
    /// config.json for System.Text.Json, with the code that reads and writes
    /// it made at build time, which the native build needs (#4823). Members
    /// are the fields marked JsonInclude, under the same names the old
    /// serializer used, so the file on disk keeps its shape. Strings read
    /// loosely, as LooseString says why.
    /// </summary>
    [JsonSourceGenerationOptions(Converters = new[] { typeof(LooseString) })]
    [JsonSerializable(typeof(Config))]
    partial class ConfigJson : JsonSerializerContext
    {
        /// <summary>
        /// The same, writing letters outside ASCII and characters such as
        /// &amp; as they are rather than as \u escapes, as config.json was
        /// written before. The file is never put into a web page.
        /// </summary>
        public static readonly ConfigJson Writer = new ConfigJson(new JsonSerializerOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            Converters = { new LooseString() }
        });
    }

    /// <summary>
    /// The release the game files were last synced to (Sync.cs, SyncPackage.cs):
    /// the merge release's tag, and the sha256 of its signed game-files.json.
    /// </summary>
    public class RecordRef
    {
        public string id = "";
        public string sha256 = "";

        /// <summary>64 lowercase hex characters.</summary>
        public static bool IsSha(string s)
        {
            if (s == null || s.Length != 64) return false;
            foreach (char c in s)
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
            return true;
        }
    }

    /// <summary>
    /// A small JSON reader, for what must be read field by field so one odd
    /// field never costs the rest. Objects come back
    /// as Dictionary&lt;string, object&gt;, arrays as List&lt;object&gt;, strings as
    /// string, numbers as their text, true and false as bool, null as null.
    /// Throws on anything that is not JSON.
    /// </summary>
    static class Json
    {
        public static object Parse(string s)
        {
            int i = 0;
            object v = Value(s, ref i);
            Space(s, ref i);
            if (i != s.Length) throw new FormatException("JSON has more after its end");
            return v;
        }

        public static string Str(Dictionary<string, object> o, string k)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v) || v == null) return "";
            var s = v as string;
            return s == null ? "" : s;
        }

        static void Space(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n' || s[i] == '﻿')) i++;
        }

        static object Value(string s, ref int i)
        {
            Space(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON ends early");
            char c = s[i];
            if (c == '{') return Obj(s, ref i);
            if (c == '[') return Arr(s, ref i);
            if (c == '"') return Text(s, ref i);
            if (Word(s, ref i, "true")) return true;
            if (Word(s, ref i, "false")) return false;
            if (Word(s, ref i, "null")) return null;
            int start = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            if (i == start) throw new FormatException("JSON has an unexpected character at " + i);
            return s.Substring(start, i - start);
        }

        static bool Word(string s, ref int i, string w)
        {
            if (string.CompareOrdinal(s, i, w, 0, w.Length) != 0) return false;
            i += w.Length;
            return true;
        }

        static Dictionary<string, object> Obj(string s, ref int i)
        {
            var o = new Dictionary<string, object>(StringComparer.Ordinal);
            i++;
            Space(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return o; }
            while (true)
            {
                Space(s, ref i);
                if (i >= s.Length || s[i] != '"') throw new FormatException("JSON object key expected at " + i);
                string k = Text(s, ref i);
                Space(s, ref i);
                if (i >= s.Length || s[i] != ':') throw new FormatException("JSON colon expected at " + i);
                i++;
                o[k] = Value(s, ref i);
                Space(s, ref i);
                if (i >= s.Length) throw new FormatException("JSON object not closed");
                if (s[i] == ',') { i++; continue; }
                if (s[i] == '}') { i++; return o; }
                throw new FormatException("JSON comma expected at " + i);
            }
        }

        static List<object> Arr(string s, ref int i)
        {
            var a = new List<object>();
            i++;
            Space(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return a; }
            while (true)
            {
                a.Add(Value(s, ref i));
                Space(s, ref i);
                if (i >= s.Length) throw new FormatException("JSON array not closed");
                if (s[i] == ',') { i++; continue; }
                if (s[i] == ']') { i++; return a; }
                throw new FormatException("JSON comma expected at " + i);
            }
        }

        static string Text(string s, ref int i)
        {
            i++;
            var sb = new StringBuilder();
            while (true)
            {
                if (i >= s.Length) throw new FormatException("JSON string not closed");
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) throw new FormatException("JSON string not closed");
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (i + 4 > s.Length) throw new FormatException("JSON escape cut short");
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: throw new FormatException("JSON escape not known at " + i);
                }
            }
        }
    }
}
