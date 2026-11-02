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

          It comes down with the update check like the server address does, so
          it can be set once and everybody has it.
        */
        [JsonInclude] public string CollectionUrl = Collection;

        // The one we ship with. The update check overwrites it, but a
        // launcher that has never reached the site still has to be able to
        // send somebody to the collection, because that is exactly the
        // state somebody installing for the first time is in.
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
        /// Where the voice service is, as the feed gives it:
        /// https://thornswood.net/voice, or /voice-dev on the dev build.
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
        /// empty or not https: a new install before its first update check,
        /// or a feed that sends voiceUrl empty. The dev build adds -dev, the
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
        // How many the server seats, the M of "N of M awake", as this build's
        // feed last gave it (maxOnline), for when the server does not announce
        // itself. 0 until the feed says: main and dev seat differently since
        // 12 Oct (30 and 5, records\most-online.json), so no number built in
        // here is right for both, and 0 shows "N awake" with no "of".
        [JsonInclude] public int MaxOnline = 0;

        [JsonInclude] public long ExpectedExeBytes = 37157144;

        // The rest of the Skyrim pin, as the update feed last gave it (#471,
        // Downgrade.AdoptPin). 0 and null mean the feed has not said, and
        // Downgrade uses what it was built with.
        [JsonInclude] public long NewerExeBytes;
        [JsonInclude] public PinDepot[] SkyrimDepots = null;

        // Set these to turn on updates. Leave blank and the launcher never
        // talks to the network beyond a ping.
        // UpdateToken is a problem worth naming rather than leaving implicit.
        // It is written into config.json in plaintext and that file ships to
        // every machine that installs the build, so it is only ever as private
        // as the least careful person holding it, and revoking it breaks
        // updates for all of them at once. A read-only fine-grained PAT limits
        // the damage without fixing the shape. The real fix is a release
        // channel that needs no credential, at which point this field goes.
        // UpdateRepo and UpdateToken are read by nothing since #907, when the
        // GitHub fallback went with Thornswood-Releases; they stay declared so
        // a config.json that carries them still loads and saves unchanged.
        [JsonInclude] public string UpdateRepo = "";    // "owner/name"
        [JsonInclude] public string UpdateToken = "";   // read-only fine-grained PAT
        [JsonInclude] public string UpdateBranch = "main";

        // Direct https URL for version.json on the site feed (#649), the only
        // place updates are read from since #907. Defaults in AfterLoad:
        // main -> https://thornswood.net/feed/version.json ; Channel or
        // UpdateBranch "dev" -> https://thornswood.net/feed-dev/version.json.
        // The feed can announce a move by shipping updateFeedUrl under the old
        // URL first.
        [JsonInclude] public string UpdateFeedUrl = "";

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
          everybody plays on. "dev" is the second launcher, installed beside
          the main one from its Settings page, that reads version.json off
          the dev branch and joins the dev server. New work lands there
          first and gets broken there, so the main build stays playable
          while it is being tested.
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

        // Thornswood's own Skyrim folder was asked for when Thornswood was
        // installed: the setup window's tick box, written here by
        // Setup-Thornswood.ps1 -MakeOwnGame (issue #906). True, the launcher
        // makes the folder without asking the moment it can (AskOwnGame in
        // ShellOwnGame.cs). False or absent, which is every install before
        // that and every install left unticked, it asks first as it always has.
        [JsonInclude] public bool MakeOwnGame;

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

            if (ExpectedExeBytes <= 0) ExpectedExeBytes = 37157144;
            // UpdateRepo used to default to Thornswood-Releases, the GitHub
            // fallback. That repository is gone (#907), so nothing fills it in.
            if (UpdateRepo == null) UpdateRepo = "";
            if (UpdateToken == null) UpdateToken = "";
            if (string.IsNullOrEmpty(UpdateBranch)) UpdateBranch = "main";
            // The site feed (#649), and since #907 the only one: a blank one
            // used to mean a launcher that could never update itself and never
            // said why, so there is always a right answer here.
            if (string.IsNullOrEmpty(UpdateFeedUrl))
            {
                bool feedDev = string.Equals(Channel, "dev", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(UpdateBranch, "dev", StringComparison.OrdinalIgnoreCase);
                UpdateFeedUrl = feedDev
                    ? "https://thornswood.net/feed-dev/version.json"
                    : "https://thornswood.net/feed/version.json";
            }
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
                    if (c != null)
                    {
                        // On the disk these two are DPAPI blobs. Everywhere
                        // else in the launcher they are ordinary strings, so
                        // they get turned back here and nowhere else.
                        // Anything written before this existed is plain text
                        // and comes back through unchanged, then gets
                        // encrypted by the next Save.
                        c.UpdateToken    = Secrets.Unprotect(c.UpdateToken);
                        return c;
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("Config.Load, reading " + path, ex); }
            return new Config();
        }

        public void Save(string path)
        {
            string tk = UpdateToken;
            try
            {
                UpdateToken = Secrets.Protect(tk);
                File.WriteAllBytes(path, JsonSerializer.SerializeToUtf8Bytes(this, ConfigJson.Writer.Config));
                Secrets.LockDown(path);
            }
            // Still no throw, so every caller behaves as it did, but a Save
            // that failed now says so in launcher.log. It used to be the
            // tester saying the Save button did nothing, and nothing else.
            catch (Exception ex) { Swallow.Note("Config.Save, writing " + path, ex); }
            finally
            {
                UpdateToken = tk;
            }
        }
    }

    public class Pack
    {
        [JsonInclude] public string id = "";
        [JsonInclude] public string url = "";
        [JsonInclude] public string sha256 = "";
        [JsonInclude] public string notes = "";

        // Only the optional packs use these two. A required update pack is
        // applied without anybody being asked, so it has nothing to show and
        // no download size worth warning about. An optional one sits on a page
        // with a button next to it and needs both.
        [JsonInclude] public string name = "";
        [JsonInclude] public long bytes;

        [JsonIgnore]
        public string Title { get { return string.IsNullOrEmpty(name) ? id : name; } }

        // Set only on the entry Updater.Pending makes for a whole release the
        // install syncs to (Sync.cs, #1050), never read from the feed: the
        // record, and the feed it came in, whose packs it stands in for.
        public RecordRef Record;
        public VersionDoc Doc;

        [JsonIgnore]
        public string Size
        {
            get
            {
                if (bytes <= 0) return "";
                if (bytes >= 1073741824L) return (bytes / 1073741824.0).ToString("0.0") + " GB";
                if (bytes >= 1048576L) return (bytes / 1048576.0).ToString("0") + " MB";
                return (bytes / 1024.0).ToString("0") + " KB";
            }
        }
    }

    /// <summary>
    /// One note on the News tab: one build Release's notes (ReleaseNews.cs,
    /// #5187). Filled by the launcher from GitHub, never read from the feed.
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
        /// Rewriting the feed to match would be rewriting history for the sake
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
    /// Where to get the SkyMP client runtime, as one download.
    ///
    /// The six files in client-build.json are the only ones a person cannot
    /// get from anywhere else: they are built from the fork, and the folder
    /// build refuses to take them from the Steam copy. A pack carries only
    /// what CHANGED and they change a few times a month, so before this
    /// existed the launcher had to walk back through the update feed hoping to
    /// find a release where they had moved. Published by Publish-Update when
    /// the recorded build is not already on the feed, and named by fork
    /// commit so an unchanged build is never uploaded twice.
    /// </summary>
    public class ClientRuntimeRef
    {
        [JsonInclude] public string url = "";
        [JsonInclude] public string sha256 = "";
        [JsonInclude] public long bytes;
        [JsonInclude] public string forkCommit = "";
    }

    /// <summary>
    /// One of the depots the Downgrade button asks Steam for, with the manifest
    /// that is the pinned build of it. Strings, because a manifest id can be
    /// larger than a long.
    /// </summary>
    public class PinDepot
    {
        [JsonInclude] public string id = "";
        [JsonInclude] public string manifest = "";
    }

    public class VersionDoc
    {
        [JsonInclude] public string launcherVersion = "";
        [JsonInclude] public string launcherUrl = "";
        [JsonInclude] public string launcherSha256 = "";
        [JsonInclude] public string serverAddress = "";
        [JsonInclude] public string collectionUrl = "";

        /// <summary>The client runtime download. Null on a feed written before
        /// this existed, which is why every use of it is guarded.</summary>
        [JsonInclude] public ClientRuntimeRef clientRuntime = null;

        /// <summary>
        /// Which revision of the collection the SERVER was built against.
        ///
        /// Written by Publish-Update from the shipping machine's own Vortex
        /// install, because that is the deployment the server's load order and
        /// the reference plugin list were both derived from. So this is not an
        /// opinion about which revision is newest on Nexus; it is a statement
        /// of which one this release agrees with.
        ///
        /// The launcher compares it with its own installed revision and says
        /// behind or ahead. Before 22 September there was no number at all: it
        /// guessed from whether one named file existed, and that file was not
        /// even in the collection, so Patrick sat two revisions behind his own
        /// collection with nothing on screen saying so.
        ///
        /// 0 from an older feed, which means say nothing rather than guess.
        /// </summary>
        [JsonInclude] public int collectionRevision;

        [JsonInclude] public string serverPort = "";
        [JsonInclude] public int maxOnline;

        // The Skyrim build the release is pinned to (#471): the exe size the
        // checks look for, the size of the newer build Steam hands out, and
        // the depot manifests the Downgrade button asks for. Written by
        // Publish-Update from records\skyrim-pin.json. Null on a feed written
        // before these existed, which leaves the launcher on what it was built
        // with; a launcher older than these ignores them. The sizes are
        // strings for the reason maintenance is below: a long given null or a
        // quoted number throws, and a throw is the whole document unread.
        // Downgrade.AdoptPin reads them as numbers.
        [JsonInclude] public string expectedExeBytes;
        [JsonInclude] public string newerExeBytes;
        [JsonInclude] public PinDepot[] depots = null;

        // Where updates come from, and where voice lives. These used to be
        // boxes on the Settings page, which was wrong twice over: they are not
        // choices anybody makes, and a launcher old enough to have the wrong
        // one is exactly the launcher that cannot be told. Shipping them in the
        // update means a rename or a moved port reaches every copy by itself.
        //
        // updateRepo named the GitHub repository of the fallback. It is read by
        // nothing since #907 and kept only so an older feed still parses.
        [JsonInclude] public string updateRepo = "";

        // Where version.json itself lives, a direct https URL on the site.
        // Publish the new URL under the old feed first, then move (#649).
        // Null/empty on older feeds means keep whatever the launcher already
        // has (including the AfterLoad default).
        [JsonInclude] public string updateFeedUrl = "";
        [JsonInclude] public string voicePort = "";

        /// <summary>
        /// Where voice lives, when that is not the server address and a port.
        /// </summary>
        /// <remarks>
        /// NULL BY DEFAULT, and that is the whole point of it. Every other
        /// field here is picked up only when it arrives non-empty, which can
        /// set a value and can never clear one. That is fine for an address
        /// that only ever changes to another address.
        ///
        /// This one has to be clearable. Pointing everybody at Caddy and then
        /// finding a fault in it has to be undoable in one release, and the way
        /// back is an empty value reaching every machine. Null means the feed
        /// did not mention it; empty means the feed said to clear it. Those are
        /// different answers and the reader below tells them apart.
        /// </remarks>
        [JsonInclude] public string voiceUrl = null;
        [JsonInclude] public string discordAppId = "";
        [JsonInclude] public string siteUrl = "";
        [JsonInclude] public string presenceImage = "";

        [JsonInclude] public string message = "";

        // Entry 262: hold Play for maintenance, or below a launcher version.
        // Set by hand in the releases repo and read by FeedNotice, which says
        // what each one does.
        //
        // maintenance is a string although it means yes or no. Measured on 24
        // September with this serializer on the .NET Framework: a bool field
        // given "yes" or null throws, and a throw here is not one field lost,
        // it is the whole document unread. Every launcher then says there was
        // no answer from the update source and shuts Play, which would turn a
        // typo in a switch meant for one afternoon into a lockout for
        // everybody. As a string, true, "true", 1, null and "yes" all read
        // without a word, and FeedNotice.On decides what counts as on.
        //
        // Both are null on a feed written before this existed: the serializer
        // does not run field initialisers, which the same measurement showed
        // for message too.
        [JsonInclude] public string maintenance;
        [JsonInclude] public string minLauncher;

        [JsonInclude] public Pack[] packs = new Pack[0];

        // Packs nobody has to have. These are never applied on their own: they
        // sit on the Mods page with an Install button, and they are safe only
        // because the publisher refuses to build one that contains a plugin.
        // The server compares plugin lists and nothing else, so a pack of
        // textures and meshes cannot put anybody out of step with it.
        [JsonInclude] public Pack[] optional = new Pack[0];
        // What the main build was on when this feed was written. Only a dev
        // feed carries it, and it is the other half of the answer to the
        // question the News tab could not answer before: this build is on
        // one number, main is on another, and these notes in between are the
        // difference. Which is also the list of what wants testing before a
        // dev release becomes a main one.
        [JsonInclude] public string mainVersion = "";
        /// <summary>
        /// The News tab's notes, from the build Releases this channel's
        /// Deployment reached (ReleaseNews.cs, #5187). Not read from the feed:
        /// a "news" or "newsFile" there is a Ship's, which no Deployment
        /// writes, so Updater.FillNews fills this after every check.
        /// </summary>
        [JsonIgnore] public NewsItem[] news = new NewsItem[0];

        /// <summary>
        /// The record of the release the feed is on, its "baseline" (#1011),
        /// which the launcher syncs the install to (#1050). Not a DataMember:
        /// Parse reads it apart, so a "baseline" of any unexpected shape costs
        /// that one field and never the whole feed. Null when there is none.
        /// </summary>
        public RecordRef record;

        /// <summary>
        /// The signed release manifest, "signedManifest" (#2163, FeedManifest.cs).
        /// Read apart like the record. Null when there is none.
        /// </summary>
        public ManifestRef manifestRef;

        /// <summary>
        /// The rest of the feed as a file of its own, "settings" (#1050,
        /// FeedSettings.cs). Null when the feed carries every field itself.
        /// </summary>
        public SettingsRef settingsRef;

        public static VersionDoc Parse(byte[] raw)
        {
            return ParseFeed(raw, null);
        }

        /// <summary>
        /// The feed, with every asset it names by sha256 alone given the
        /// address it has beside every other asset (#1050): assets is the
        /// feed's own folder plus "assets/" (Updater.AssetsOf). Null for a
        /// reader that has no feed address, which then has only the assets
        /// whose address the feed spells out.
        /// </summary>
        public static VersionDoc ParseFeed(byte[] raw, string assets)
        {
            // A UTF-8 byte order mark is not JSON. The serializer stops on it and
            // reports an unexpected character, which would break the update
            // check for everyone at once, and with it their route to a fix.
            int at = 0;
            if (raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF) at = 3;
            VersionDoc doc = JsonSerializer.Deserialize(new ReadOnlySpan<byte>(raw, at, raw.Length - at), ConfigJson.Default.VersionDoc);
            if (doc != null)
            {
                doc.record = RecordRef.FromFeed(raw, at, assets);
                doc.manifestRef = ManifestRef.FromFeed(raw, at, assets);
                doc.settingsRef = SettingsRef.FromFeed(raw, at);
                if (doc.clientRuntime != null)
                    doc.clientRuntime.url = RecordRef.AssetUrl(doc.clientRuntime.url, (doc.clientRuntime.sha256 ?? "").ToLowerInvariant(), assets);
            }
            return doc;
        }

        /// <summary>
        /// The feed whose update fields are top's and every other field rest's:
        /// version.json and the settings file it names (#1050). The packs stay
        /// in version.json, as an empty list, for every launcher from before
        /// the split.
        /// </summary>
        public static VersionDoc Join(VersionDoc top, VersionDoc rest)
        {
            rest.launcherVersion = top.launcherVersion;
            rest.launcherUrl = top.launcherUrl;
            rest.launcherSha256 = top.launcherSha256;
            rest.minLauncher = top.minLauncher;
            rest.packs = top.packs;
            rest.record = top.record;
            rest.settingsRef = top.settingsRef;
            return rest;
        }
    }

    /// <summary>
    /// The feed's "signedManifest" (#2163): { url, sha256, catalogUrl,
    /// catalogSha256 }, release.json and the catalog ThornswoodRelease signed
    /// over it, each stored under its own sha256 beside every other asset.
    /// Read apart from the serializer, so a signedManifest of any other shape
    /// costs the manifest check and never the feed.
    /// </summary>
    /// <summary>
    /// config.json and the feed for System.Text.Json, with the code that
    /// reads and writes them made at build time, which the native build
    /// needs (#4823). Members are the fields marked JsonInclude, under the
    /// same names the old serializer used, so the files on disk and the feed
    /// keep their shape. Strings read loosely, as LooseString says why.
    /// </summary>
    [JsonSourceGenerationOptions(Converters = new[] { typeof(LooseString) })]
    [JsonSerializable(typeof(Config))]
    [JsonSerializable(typeof(VersionDoc))]
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

    public class ManifestRef
    {
        public string url = "";
        public string sha256 = "";
        public string catalogUrl = "";
        public string catalogSha256 = "";

        /// <summary>The feed's "signedManifest", or null when it names none
        /// this launcher can use. Never throws.</summary>
        public static ManifestRef FromFeed(byte[] raw, int at, string assets)
        {
            try
            {
                var root = Json.Parse(Encoding.UTF8.GetString(raw, at, raw.Length - at)) as Dictionary<string, object>;
                if (root == null) return null;
                object b;
                if (!root.TryGetValue("signedManifest", out b)) return null;
                var o = b as Dictionary<string, object>;
                if (o == null) return null;
                var r = new ManifestRef();
                r.sha256 = Json.Str(o, "sha256").ToLowerInvariant();
                r.url = RecordRef.AssetUrl(Json.Str(o, "url"), r.sha256, assets);
                r.catalogSha256 = Json.Str(o, "catalogSha256").ToLowerInvariant();
                r.catalogUrl = RecordRef.AssetUrl(Json.Str(o, "catalogUrl"), r.catalogSha256, assets);
                if (!RecordRef.IsSha(r.sha256) || r.url.Length == 0) return null;
                if (!RecordRef.IsSha(r.catalogSha256) || r.catalogUrl.Length == 0) return null;
                return r;
            }
            catch (Exception)
            {
                // A feed whose "signedManifest" cannot be read has none: the
                // check says so in the log, and the rest of the feed stands.
                return null;
            }
        }
    }

    /// <summary>
    /// The feed's "settings" (#1050): { sha256 }, every field of the feed that
    /// is not about the update itself, as one asset stored under its own
    /// sha256 beside every other one. Its address is never taken from the
    /// feed: it is the feed's own assets folder plus the sha256, so it is on
    /// the host the feed came from (FeedSettings.cs). Unlike the record, a
    /// "settings" this launcher cannot use is not read as none,
    /// because the server, voice and Skyrim pin are in it: FromFeed gives one
    /// with an empty sha256, and the update check says the feed is unreadable.
    /// </summary>
    public class SettingsRef
    {
        public string sha256 = "";

        /// <summary>The feed's "settings", or null when it names none. Never
        /// throws.</summary>
        public static SettingsRef FromFeed(byte[] raw, int at)
        {
            var r = new SettingsRef();
            try
            {
                var root = Json.Parse(Encoding.UTF8.GetString(raw, at, raw.Length - at)) as Dictionary<string, object>;
                if (root == null) return null;
                object b;
                if (!root.TryGetValue("settings", out b)) return null;
                var o = b as Dictionary<string, object>;
                if (o == null) return r;
                string sha = Json.Str(o, "sha256").ToLowerInvariant();
                if (RecordRef.IsSha(sha)) r.sha256 = sha;
                return r;
            }
            catch (Exception)
            {
                // The serializer has read this same text already, so this is
                // a feed that parsed and a "settings" that did not: unusable.
                return r;
            }
        }
    }

    /// <summary>
    /// The record of a release the feed names as "baseline" (#1011): what that
    /// release left installed, every file of ours as "&lt;bytes&gt;:&lt;sha256&gt;",
    /// itself an asset on the site named by its sha256.
    ///
    /// Not a DataMember on VersionDoc on purpose. A value of the wrong JSON
    /// type makes the serializer throw, and a throw there is the whole feed
    /// unread and Play shut on every launcher. So VersionDoc.Parse reads this
    /// one field on its own, with Json below, and a feed whose "baseline" is
    /// anything unexpected simply has no record: the launcher takes the packs.
    /// </summary>
    public class RecordRef
    {
        public string id = "";
        public string sha256 = "";
        public string url = "";
        // The release note, title first, written beside the record since the
        // packs left the feed (#1050), because the update card used to read it
        // off the last pack. "" on a feed that does not say.
        public string notes = "";

        /// <summary>The "baseline" of a feed, or null when it names none or
        /// names one this launcher cannot use. Never throws.</summary>
        public static RecordRef FromFeed(byte[] raw, int at, string assets)
        {
            try
            {
                var root = Json.Parse(Encoding.UTF8.GetString(raw, at, raw.Length - at)) as Dictionary<string, object>;
                if (root == null) return null;
                object b;
                if (!root.TryGetValue("baseline", out b)) return null;
                var o = b as Dictionary<string, object>;
                if (o == null) return null;
                var r = new RecordRef();
                r.id = Json.Str(o, "id");
                r.sha256 = Json.Str(o, "sha256").ToLowerInvariant();
                r.url = RecordRef.AssetUrl(Json.Str(o, "url"), r.sha256, assets);
                r.notes = Json.Str(o, "notes").Trim();
                if (!IsSha(r.sha256) || r.url.Length == 0) return null;
                if (r.id.Length == 0) r.id = r.sha256.Substring(0, 12);
                return r;
            }
            catch (Exception)
            {
                // A feed whose "baseline" cannot be read has no record: the
                // launcher takes the packs, and the rest of the feed stands.
                return null;
            }
        }

        /// <summary>
        /// An asset's address: the one the feed spells out, or, when it gives
        /// only the sha256 (#1050), the feed's assets folder plus it, which is
        /// where Publish-Update puts every asset. "" when neither is had.
        /// </summary>
        public static string AssetUrl(string given, string sha, string assets)
        {
            string u = given == null ? "" : given.Trim();
            if (u.Length > 0) return u;
            if (string.IsNullOrEmpty(assets) || !IsSha(sha)) return "";
            return assets + sha;
        }

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
    /// A small JSON reader, for the two things the launcher reads that must
    /// never stop the feed being read: the feed's "baseline" and the release
    /// record itself (an object of a few thousand strings). Objects come back
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
