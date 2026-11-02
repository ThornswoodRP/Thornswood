using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Thornswood
{
    class Issue
    {
        public string Text;
        public bool Blocking;      // true = you will be refused by the server
        // The plugin is not in the live list and not on disk ("is not installed").
        // Fix cannot invent a mod Vortex never had; Shell greys the button for
        // these unless Vortex deploys somewhere else (OwnFolderNext).
        public bool Absent;
        // The plugin's file is missing from the game folder's Data, including
        // ones still named in plugins.txt. Set once per plugin the golden list
        // expects but that is not on disk, so the Mods card can count how many
        // and, when it is most of them, say the collection is not deployed in
        // one sentence instead of one line per plugin. Fix restores these from
        // Vortex (OwnGame.RestoreMissingPlugins); it does not drop them from
        // the list. The gate still counts Blocking (see Shell Play).
        public bool FileMissing;
        // The file is there, enabled, in the right place, and its bytes are
        // not the server's. Fix puts in the release's copy when it is the
        // server's (#3386). Which file, and what the server says it should
        // be, so Fix does not have to ask twice.
        public string Plugin;
        public long WantSize;
        public int WantCrc;
        public int WantIndex;   // position in the server manifest (in its light list when WantLight)
        // Thornswood's own plugin, the only kind the server's manifest lists
        // as served (#1180). Fix puts in only these, from the release (#3386);
        // every other plugin is another author's mod, which Vortex installs
        // from its author, and Fix names the mod to put right in Vortex
        // instead.
        public bool Served;
        // The folder Vortex really deploys into, when it is not the Skyrim this
        // install reads. Fix points the launcher at it and Thornswood's own
        // folder is made from it, so the plugins Run finds missing are not a
        // reason to grey Fix out while this is on the list.
        public string VortexFolder;
        // In the manifest's light list rather than its mods: one of our own
        // light plugins (#2627).
        public bool WantLight;

        // ---- for Scan and Fix (#2627) ----------------------------------
        // Which check found it, so Fix knows what to do and the report after
        // Fix can say which ones are still there (IssueKind).
        public string Kind = "";
        // The problem alone, without the sentence about what Fix does, for
        // the report after Fix: "Fix fetches the server's copy" read after a
        // Fix that could not is the sentence that made Fix look broken.
        public string Problem;
        // Fix has something to do for it. The Fix button is on while any
        // issue on the card is, and only then.
        public bool Fixable;
        // What puts it right when Fix cannot, or tried and could not: one
        // line, said after Fix in place of what Fix does.
        public string WhatWill;

        public Issue(string t, bool b) { Text = t; Problem = t; Blocking = b; }

        /// <summary>
        /// One issue in the shape Scan and Fix read (#2627): the problem, what
        /// Fix does about it (null when Fix cannot, which leaves it not
        /// Fixable), and what puts it right otherwise.
        /// </summary>
        public static Issue Of(string kind, string problem, string fixDoes, string whatWill, bool blocking)
        {
            // The card says what Fix does, or, when Fix cannot, what will.
            string then = fixDoes ?? whatWill;
            var i = new Issue(string.IsNullOrEmpty(then) ? problem : problem + " " + then, blocking);
            i.Kind = kind;
            i.Problem = problem;
            i.Fixable = fixDoes != null;
            i.WhatWill = whatWill;
            return i;
        }
    }

    /// <summary>
    /// Which check found an issue (Issue.Kind, #2627), so Fix knows what to
    /// do for it and the report after Fix can say which are still there.
    /// Verify's own are Plugins and Personal; the rest are Upkeep's checks of
    /// the install beyond the plugin list. Here, beside Issue, so a harness
    /// that compiles Verify alone needs nothing of Upkeep's.
    /// </summary>
    static class IssueKind
    {
        public const string Plugins = "plugins";
        public const string Personal = "your-mods";
        public const string OwnFolder = "own-folder";
        public const string Update = "update";
        public const string Feed = "feed";
        public const string Behind = "behind-vortex";
        public const string VortexInto = "vortex-into-thornswood";
        public const string Lost = "lost-vortex";
        public const string OursLost = "lost-ours";
        public const string Skyrim = "skyrim-build";
        public const string ScriptExtender = "script-extender";
        public const string BuildFiles = "build-files";
        public const string MadeFromGame = "made-from-game";
        public const string Generated = "generated";
        public const string WindowsFolders = "windows-folders";
        public const string Icon = "shortcut-icon";
        public const string Client = "client";
        public const string Steam = "steam";
    }

    static partial class Verify
    {
        static List<string> Enabled(string file)
        {
            var l = new List<string>();
            if (!File.Exists(file)) return l;
            foreach (string raw in File.ReadAllLines(file))
            {
                string s = raw.Trim();
                if (s.Length == 0 || s.StartsWith("#")) continue;
                if (s.StartsWith("*")) l.Add(s.Substring(1));
            }
            return l;
        }

        /// <summary>How many plugins the last Run's reference list enabled, so the
        /// Mods card can tell "most of them are missing" from "one is". 0 when there
        /// was no list to compare against.</summary>
        public static int Expected;

        /// <summary>
        /// The issues the last Run produced. Checks.All (Ready to launch Mods /
        /// Mod list) and the Scan and Fix card both read this so they cannot
        /// disagree: one Run, one truth. Null until the first Run.
        /// </summary>
        public static List<Issue> LastIssues;

        /// <summary>True when the last Run was given a Config, so load order and
        /// bytes were judged against the server the same way Scan does.</summary>
        public static bool LastUsedServer;

        public static List<Issue> Run() { return Run(null); }

        /// <summary>
        /// The shipped plugins.txt is what the server was built against, so it is
        /// the reference for what is on and off. Anything the live list adds or
        /// drops is what gets a person refused at connect. With a Config to hand
        /// it also asks the server for its manifest: the order is judged against
        /// that, the way the game judges it (see LoadOrder), and so are the
        /// bytes of every plugin; see Bytes.
        /// </summary>
        public static List<Issue> Run(Config cfg) { return Run(cfg, true); }

        /// <param name="checkBytes">
        /// False skips the per-plugin CRC pass (Bytes). Bring it up to date from
        /// Vortex uses that when Refresh reported the folder already matched, so
        /// the finish path is not held on hashing every plugin after a no-op.
        /// Names, order, missing files and light flags are still judged.
        /// </param>
        public static List<Issue> Run(Config cfg, bool checkBytes)
        {
            var issues = new List<Issue>();
            Expected = 0;

            // No folder of its own yet, whether it was chosen at install and
            // is not made (Paths.OwnFirst, #1226: Paths.Game is Profile\Payload,
            // Thornswood's own files and nothing else) or Thornswood still
            // shares the Steam copy (Paths.Collection). Either way there is no
            // game of Thornswood's to hold against the server, and the Steam
            // copy is the person's own and not Thornswood's to change (#1218,
            // #1226). Until 17 Oct a shared install was scanned plugin by
            // plugin against the Steam copy, and Fix then put right what the
            // scan found, in the Steam copy: on 11 Oct a new dev build's first
            // Fix moved 21 Creation Club plugins out of it and wrote the
            // server's content plugin over Vortex's copy there, while its own
            // folder was being made (#2403). So the scan says one thing, the
            // folder, and Fix makes it (OwnFolderNext) and writes nothing else.
            if (Paths.Collection)
            {
                issues.AddRange(NoFolderYet(cfg));
                if (cfg != null || LastIssues == null)
                {
                    LastIssues = issues;
                    LastUsedServer = cfg != null;
                }
                return issues;
            }
            string golden = Path.Combine(Paths.Golden, "plugins.txt");

            // Paths.Live, not Paths.LocalAD. Under the collection those are two
            // different files and this was reading the wrong one.
            //
            // LocalAD is the launcher's own redirected copy under Profile, which
            // is right for an install that built its own game. A collection
            // install redirects nothing: Vortex writes the real list into
            // Windows' own AppData and that is what Skyrim and the server see.
            // So this compared against a copy the installer laid down once and
            // nothing has touched since, reported plugins from somebody's old
            // collection that are not enabled anywhere any more, and Fix then
            // rewrote that same unread file. The scan found problems that were
            // not there and fixing them changed nothing, every time.
            //
            // Paths.Live is already the right file for both shapes of install.
            string live = Path.Combine(Paths.Live, "plugins.txt");

            if (!File.Exists(golden))
            {
                issues.Add(Issue.Of(IssueKind.Plugins, "This build shipped without a reference plugin list, so there is nothing to compare against.",
                                    null, "The next update carries one. Fix cannot make it up.", false));
                return issues;
            }
            if (!File.Exists(live))
            {
                issues.Add(Issue.Of(IssueKind.Plugins, "Your plugins.txt is missing.", "Fix puts the shipped one back.", Retry, true));
                return issues;
            }

            List<string> want = Enabled(golden), have = Enabled(live);
            Expected = want.Count;
            var wantSet = new HashSet<string>(want, StringComparer.OrdinalIgnoreCase);
            var haveSet = new HashSet<string>(have, StringComparer.OrdinalIgnoreCase);

            // Turned off and not installed at all look identical in a plugin
            // list and need completely different answers, so they are told
            // apart by looking in Data rather than guessed at.
            string dataDir = Path.Combine(Paths.Game, "Data");
            foreach (string p in want)
            {
                if (haveSet.Contains(p)) continue;
                bool onDisk = true;
                try { onDisk = File.Exists(Path.Combine(dataDir, p)); } catch (Exception ex) { Swallow.Note("Verify.Run, asking whether " + p + " is on disk", ex); }
                Issue off = onDisk
                    ? Issue.Of(IssueKind.Plugins, p + " is turned off.", "Fix switches it on from this build's plugin list.", Retry, true)
                    // Not in the list and not on disk: Vortex never put it on
                    // this machine, or the Thornswood profile is not the one
                    // Vortex has on. Fix brings it from Vortex's own copy when
                    // Vortex has one (OwnGame.RestoreMissingPlugins).
                    : Issue.Of(IssueKind.Plugins, p + " is not installed.", "Fix brings it from Vortex's copy when Vortex has one.", VortexDeploys, true);
                off.Absent = !onDisk;
                off.Plugin = p;
                issues.Add(off);
            }

            // An Anniversary owner's Creation Club plugins that take no place in
            // the order are not counted here (#479, LoadOrder.NotInBuild). Nor
            // is a plugin the server's served list names, which is ours: a server ahead
            // of this build's list names it, Fix put it in the server's place
            // (PutInServerOrder), and the next release's list carries it.
            foreach (string p in LoadOrder.NotInBuild(have, want, LightOrMissing))
            {
                if (ServedByServer(cfg, p)) continue;
                issues.Add(Issue.Of(IssueKind.Plugins, p + " is enabled but is not part of this build.", "Fix switches it off from this build's plugin list.", Retry, true));
            }

            // Another server's client. Not a plugin, so nothing above would ever
            // have found it, and it is the difference between Thornswood loading
            // and another server's main menu loading instead.
            foreach (string f in Checks.ForeignClients())
                issues.Add(Issue.Of(IssueKind.Plugins,
                    Path.GetFileName(f) + " belongs to another server. It replaces the main menu " +
                    "and asks you to sign in to them.",
                    "Fix moves it aside into Thornswood's Isolated folder and nothing is deleted, so that server still works.",
                    "Close that server's launcher and Skyrim, then press Fix again: a file another program has open cannot be moved.", true));

            // A plugin whose light flag is not the one the server's copy has. A
            // copy that is full where the server's is light takes a load order
            // index the server does not have, and one that is light where the
            // server's is full takes none, so from there on every plugin is one
            // place off. Read from the server's own two lists, never worked
            // out. The flag is part of the file, so the collection installs it
            // and Vortex puts it right; the launcher no longer writes it
            // (#3022). Ours are left to Bytes, whose Fix fetches the server's
            // copy. Before the order, so one problem reads as one problem.
            foreach (KeyValuePair<string, bool> f in FlagNotServers(cfg))
                issues.Add(Issue.Of(IssueKind.Plugins,
                    f.Key + (f.Value
                        ? " is light on the server and not flagged light in your copy, so from there on your load order counts one place more than the server's."
                        : " is flagged light in your copy and is a full plugin on the server, so from there on your load order counts one place less than the server's.") +
                    " The game shows that as LOAD ORDER ERROR.",
                    null, FromVortex(cfg, f.Key), true));
            // The order, position by position. Only when nothing above was
            // found, as before: a plugin turned off or not flagged light
            // already explains the shift from there on, and one problem
            // should read as one problem.
            //
            // Against the server's own manifest when the server answers,
            // because that is the list the game compares with: the same
            // walk as loadOrderVerificationService in the client, over the
            // order the game will count (LoadOrder.GameOrder), names only;
            // Bytes below does the sizes and crcs. On 20 Sep a list that
            // matched the shipped reference name for name was in another
            // order than the server's, LOOT having re-sorted both, and the
            // game showed LOAD ORDER ERROR while this said everything checked
            // out. The shipped reference is only for when the server cannot
            // be asked, and never alongside the manifest, or Fix would be
            // chasing two orders.
            if (issues.Count == 0)
            {
                ServerMod[] mods = null;
                try { mods = Manifest(cfg); } catch (Exception ex) { Swallow.Note("Verify.Run, asking the server for its manifest", ex); }
                if (mods != null)
                {
                    List<string> manifest = Names(mods);
                    List<string> game = LoadOrder.GameOrder(have, LightOrMissing, Ccc(), InData);
                    int at = LoadOrder.FirstMismatch(game, manifest);
                    if (at >= 0)
                    {
                        string yours = at < game.Count ? game[at] : "nothing";
                        string theirs = at < manifest.Count ? manifest[at] : "nothing";
                        issues.Add(Issue.Of(IssueKind.Plugins,
                            "Your load order is not the server's from position " + at + ": you have " + yours +
                            " there, the server has " + theirs + ". The game shows that as LOAD ORDER ERROR.",
                            "Fix puts the server's order into this build's plugin list, and adds a plugin of ours the list lacks.",
                            OrderWhatWill(cfg, theirs), true));
                    }
                    else
                    {
                        // The light order, the same walk over the light
                        // plugins (#1715). When it differs every light form id
                        // the server stores names another plugin's form, a
                        // beard turns into nothing, and the person sees a face
                        // that is wrong. The client built from the fork since
                        // #1715 compares the light list too and shows LOAD
                        // ORDER ERROR, and the server ends the session when
                        // refusing is on; this says it before Play.
                        List<string> serverLight = Names(manifestLight);
                        if (serverLight.Count > 0)
                        {
                            List<string> mine = LoadOrder.LightOrder(have, Light, Ccc(), InData);
                            int li = LoadOrder.FirstMismatch(mine, serverLight);
                            if (li >= 0)
                            {
                                string yours = li < mine.Count ? mine[li] : "nothing";
                                string theirs = li < serverLight.Count ? serverLight[li] : "nothing";
                                issues.Add(Issue.Of(IssueKind.Plugins,
                                    "Your light plugins are not in the server's order from light position " + li + ": you have " + yours +
                                    " there, the server has " + theirs + ". Hair, beards and other parts from light plugins would show as the wrong ones.",
                                    "Fix puts the server's order into this build's plugin list, and fetches and adds a plugin of ours the list lacks.",
                                    OrderWhatWill(cfg, theirs), true));
                            }
                        }
                    }
                }
                else if (want.Count == have.Count)
                {
                    for (int i = 0; i < want.Count; i++)
                    {
                        if (!string.Equals(want[i], have[i], StringComparison.OrdinalIgnoreCase))
                        {
                            issues.Add(Issue.Of(IssueKind.Plugins, "The load order does not match this build's from " + want[i] + " onwards.",
                                                "Fix puts this build's plugin list back.", Retry, true));
                            break;
                        }
                    }
                }
            }

            // Creation Club plugins the game loads because Skyrim.ccc names
            // them, which no plugin list shows, and only the ones that take a
            // place in the order: a light one is nothing to the server, the
            // same as the light plugins in the list (Checks.StrayCreations
            // says why). After the positional pass on purpose: that pass only
            // runs when nothing else was found.
            foreach (string p in Checks.StrayCreations(wantSet, LightNames(cfg)))
            {
                // A light one is stray only against a server that publishes
                // its light order (Checks.StrayCreations), and it moves the
                // light plugins rather than the full ones.
                bool lightStray = Checks.TakesNoPlace(p);
                issues.Add(Issue.Of(IssueKind.Plugins,
                    p + " is loaded by the game on its own, because Skyrim.ccc names it, and the server does not have it, " +
                    (lightStray
                        ? "so every light plugin after it is one place off the server's, and hair, beards and other parts from light plugins show as the wrong ones."
                        : "so every plugin after it is out of place and the game shows LOAD ORDER ERROR."),
                    "Fix moves it aside into Thornswood's Isolated folder and nothing is deleted.",
                    "Close Skyrim, then press Fix again: a file the game has open cannot be moved.", true));
            }

            // A plugin the list references but that is not actually on disk.
            // One per expected plugin, flagged FileMissing so the card can count
            // them: when it is most of the list, Vortex has not deployed the
            // collection, and the card says that once instead of once per plugin.
            string data = Path.Combine(Paths.Game, "Data");
            foreach (string p in want)
            {
                try
                {
                    if (!File.Exists(Path.Combine(data, p)))
                    {
                        var gone = Issue.Of(IssueKind.Plugins, p + " is in the list but the file is not in Data.",
                                            "Fix puts it back from Vortex's copy, or fetches the server's when it is ours.", VortexDeploys, true);
                        gone.FileMissing = true;
                        gone.Plugin = p;
                        issues.Add(gone);
                    }
                }
                catch (Exception ex) { Swallow.Note("Verify.Run, asking whether " + p + " is missing from Data", ex); }
            }

            // Personal mods that carry a plugin will be refused.
            if (Directory.Exists(Paths.Personal))
            {
                foreach (string f in Directory.GetFiles(Paths.Personal, "*.*", SearchOption.AllDirectories))
                {
                    string e = Path.GetExtension(f).ToLowerInvariant();
                    if (e == ".esp" || e == ".esm" || e == ".esl")
                    {
                        var mine = Issue.Of(IssueKind.Personal, "Your own mods folder contains " + Path.GetFileName(f) + ". Plugins there will get you refused.",
                                            "Fix moves it aside into Thornswood's Isolated folder and nothing is deleted.",
                                            "Take it out of " + Paths.Personal + " yourself: Fix could not move it.", true);
                        mine.Plugin = Path.GetFileName(f);
                        issues.Add(mine);
                    }
                }
            }

            // Bytes, not names. Everything above compares names, and a machine
            // can pass every line of it and still be red in the game. Skipped
            // when the caller already knows the plugin files did not change
            // (Bring it up to date after an already-matched Refresh).
            if (checkBytes)
            {
                try { issues.AddRange(Bytes(cfg)); } catch (Exception ex) { Swallow.Note("Verify.Run, Bytes", ex); }
            }

            // Only a server-aware Run is remembered as the shared truth. A
            // local-only Run(null) from Checks.All must not overwrite a Scan,
            // or the checklist drifts from the card on the next redraw.
            if (cfg != null)
            {
                LastIssues = issues;
                LastUsedServer = true;
            }
            else if (LastIssues == null)
            {
                LastIssues = issues;
                LastUsedServer = false;
            }
            return issues;
        }

        // ------------------------------------------------------------ bytes
        //
        // The game runs its own check once the world is up: for every plugin in
        // the server's manifest, at the same position, the name has to match
        // and so do the size and the crc32 of the file. One difference paints
        // LOAD ORDER ERROR over the screen for the rest of the session, and
        // every form in that plugin can point at something the server does not
        // mean. This page said "Everything matches" to somebody in exactly
        // that state on 17 Sep, because it only ever compared names: the
        // collection had given his machine another build of one plugin, same
        // name, same place in the order, other bytes.
        //
        // So the same comparison runs here, against the same manifest, and
        // Fix puts in the release's copy of a plugin that differs when it is
        // Thornswood's own (#1180, the manifest's "served" list) and that copy
        // is the server's (#3386: the bytes come from the signed release over
        // https, never from this port, which is plain http). Another author's
        // plugin comes from its author through Vortex, and Fix names the mod
        // to update or reinstall there. The five Bethesda masters and the
        // Creation Club files are left out the way the game leaves them out:
        // Steam owns those, and a person's Skyrim is not the launcher's to
        // rewrite.
        //
        // A server that cannot be reached reports nothing. A check that could
        // not run is not a problem with this machine, and Play should not be
        // refused because the server is down for an update.

        /// <summary>What the launcher writes as server-master-key; the manifest and the files live under it.</summary>
        const string ServerKey = "thornswood";

        static readonly HashSet<string> Storefront = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm",
            "ccBGSSSE001-Fish.esm", "ccBGSSSE025-AdvDSGS.esm", "ccBGSSSE037-Curios.esl",
            "ccQDRSSE001-SurvivalMode.esl", "_ResourcePack.esl"
        };

        class ServerManifest
        {
            [JsonInclude] public ServerMod[] mods;
            // Thornswood's own plugins, by the gamemode's server manifest
            // block (#1180), full and, since #2627, light. Only names: Fix
            // takes their bytes from the release (#3386).
            [JsonInclude] public string[] served;
            // A server that loads light plugins publishes them apart from
            // mods, in light index order (#1715): mods stays the full plugins
            // the client's own check compares with Game.getModName. loadOrder
            // is the server's whole order, full and light together. Both are
            // absent on a server that loads no light plugin.
            [JsonInclude] public ServerMod[] light;
            [JsonInclude] public string[] loadOrder;
        }

        class ServerMod
        {
            [JsonInclude] public string filename;
            [JsonInclude] public long size;
            [JsonInclude] public long crc32;   // the server writes it as a signed 32 bit number
            // Named in the manifest's "served" list, set by Manifest (#1180).
            public bool Served;
        }

        /// <summary>
        /// The server's manifest.json for System.Text.Json, with the code made
        /// at build time (#4823). Strings read loosely (LooseString).
        /// </summary>
        [JsonSourceGenerationOptions(Converters = new[] { typeof(LooseString) })]
        [JsonSerializable(typeof(ServerManifest))]
        partial class ServerManifestJson : JsonSerializerContext { }

        /// <summary>True when the last Run got a manifest out of the server, so "Everything matches" can say what it covered.</summary>
        public static bool BytesChecked;

        static ServerMod[] manifestCache;
        // The light half and the whole order of the same manifest, set with
        // manifestCache so the three always describe one answer.
        static ServerMod[] manifestLight;
        static string[] manifestAll;
        static DateTime manifestAt = DateTime.MinValue;
        static string manifestFrom = "";
        // A fetch that failed is remembered for the same minute a good one is
        // kept, because Run asks for the manifest once for the order and Bytes
        // asks again, and a server that does not answer used to cost the four
        // second timeout twice before the scan could say so.
        static DateTime manifestFailedAt = DateTime.MinValue;
        static string manifestFailedFrom = "";

        static string ServerBase(Config cfg)
        {
            return "http://" + cfg.ServerAddress + ":" + SkyMp.ResourcePortFor(cfg) + "/api/servers/" + ServerKey;
        }

        /// <summary>The server's manifest, kept for a minute so Play and Scan a second apart do not fetch it twice.</summary>
        static ServerMod[] Manifest(Config cfg)
        {
            if (cfg == null || string.IsNullOrEmpty(cfg.ServerAddress)) return null;
            string url = ServerBase(cfg) + "/manifest.json";
            if (manifestCache != null && manifestFrom == url && (DateTime.UtcNow - manifestAt).TotalSeconds < 60)
                return manifestCache;
            if (manifestFailedFrom == url && (DateTime.UtcNow - manifestFailedAt).TotalSeconds < 60)
                return null;
            byte[] raw = Get(url, 4000);
            if (raw == null) { manifestFailedFrom = url; manifestFailedAt = DateTime.UtcNow; return null; }
            try
            {
                ServerManifest doc = JsonSerializer.Deserialize(raw, ServerManifestJson.Default.ServerManifest);
                if (doc == null || doc.mods == null || doc.mods.Length == 0) return null;
                var served = new HashSet<string>(doc.served ?? new string[0], StringComparer.OrdinalIgnoreCase);
                ServerMod[] light = doc.light ?? new ServerMod[0];
                // Full and light alike (#2627): Thornswood-Last.esp is ours and
                // light, and a server that publishes it names it here.
                foreach (ServerMod[] list in new ServerMod[][] { doc.mods, light })
                    foreach (ServerMod m in list)
                        if (m != null && m.filename != null) m.Served = served.Contains(m.filename);
                manifestLight = light;
                manifestAll = doc.loadOrder ?? new string[0];
                manifestCache = doc.mods;
                manifestAt = DateTime.UtcNow;
                manifestFrom = url;
                manifestFailedFrom = "";
                return doc.mods;
            }
            catch { manifestFailedFrom = url; manifestFailedAt = DateTime.UtcNow; return null; }
        }

        /// <summary>Every plugin whose size or crc32 is not the server's, as blocking issues that carry what Fix needs.</summary>
        public static List<Issue> Bytes(Config cfg)
        {
            var issues = new List<Issue>();
            BytesChecked = false;
            if (cfg == null || string.IsNullOrEmpty(cfg.ServerAddress)) return issues;
            ServerMod[] mods = Manifest(cfg);
            if (mods == null) return issues;
            BytesChecked = true;

            // The light plugins a server publishes (#1715) after its full
            // ones: a light plugin with other bytes holds other forms under
            // the same light index, which is the same fault as a full one.
            // One of ours is served like a full one of ours (#2627); another
            // author's is Vortex's to put right.
            ServerMod[] light = manifestLight ?? new ServerMod[0];
            int all = mods.Length + light.Length;
            string data = Path.Combine(Paths.Game, "Data");
            for (int idx = 0; idx < all; idx++)
            {
                // On the Play button only while it is waiting on this, after
                // the game folder is prepared (#1145); PlayProgress drops it
                // otherwise.
                PlayProgress.Files("Checking files", idx + 1, all);
                bool isLight = idx >= mods.Length;
                ServerMod m = isLight ? light[idx - mods.Length] : mods[idx];
                if (m == null || string.IsNullOrEmpty(m.filename) || Storefront.Contains(m.filename)) continue;
                string p = Path.Combine(data, m.filename);
                long size;
                try
                {
                    if (!File.Exists(p)) continue;   // Run has already said it is not installed
                    size = new FileInfo(p).Length;
                }
                catch { continue; }

                bool same = size == m.size;
                if (same)
                {
                    try { same = Crc32Of(p, size) == (int)m.crc32; }
                    catch { continue; }   // open elsewhere; it is checked again next time
                }
                if (same) continue;

                // Made here from the release's recipe (#2791, LastPlugin):
                // never the server's copy. One that is not what the recipe
                // makes is Scan's "made from your game" line, which Fix
                // makes again; one that is, and still is not the server's,
                // means the release and the server are of two builds.
                if (LastPlugin.Makes(Paths.Game, m.filename))
                {
                    if (!LastPlugin.IsCurrent(Paths.Game)) continue;
                    var made = Issue.Of(IssueKind.Plugins,
                        m.filename + " is the one this release makes from your plugins, and it is not the server's" +
                        (size == m.size ? " (same size, other contents)" : " (yours is " + Fmt(size) + ", the server's is " + Fmt(m.size) + ")") +
                        ". The game shows that as LOAD ORDER ERROR and anything in it can mean something else here than on the server.",
                        null, OtherBuild, true);
                    made.Plugin = m.filename;
                    issues.Add(made);
                    continue;
                }

                var i = Issue.Of(IssueKind.Plugins,
                    m.filename + " is not the same file the server has" +
                    (size == m.size ? " (same size, other contents)" : " (yours is " + Fmt(size) + ", the server's is " + Fmt(m.size) + ")") +
                    ". The game shows that as LOAD ORDER ERROR and anything in it can mean something else here than on the server.",
                    m.Served ? "Fix puts in the release's copy." : null,
                    m.Served ? NotInRelease : FromVortex(cfg, m.filename),
                    true);
                i.Plugin = m.filename;
                i.WantSize = m.size;
                i.WantCrc = (int)m.crc32;
                // Its place in the manifest, in mods or in light (#2627),
                // which the session report carries.
                i.WantLight = isLight;
                i.WantIndex = isLight ? idx - mods.Length : idx;
                i.Served = m.Served;
                issues.Add(i);
            }
            return issues;
        }

        /// <summary>
        /// What puts another author's plugin right, said by Scan and by Fix.
        /// Fix puts in only Thornswood's own plugin (#1180, from the release
        /// since #3386): any other is that author's to give out, through Vortex and the
        /// collection, so Vortex is where it is put right. The mod is named by
        /// Vortex's own deployment record when there is one.
        /// </summary>
        static string FromVortex(Config cfg, string plugin)
        {
            string mod = null;
            try { mod = OwnGame.VortexModOf(cfg, plugin); }
            catch (Exception ex) { Swallow.Note("Verify.FromVortex, asking Vortex's record which mod has " + plugin, ex); }
            return "It comes from another author's mod, which Vortex installs from its author, so Thornswood has no copy of it to give. " +
                   "In Vortex, update the Thornswood collection, or reinstall " +
                   (string.IsNullOrEmpty(mod) ? "the mod that has " + plugin : mod) +
                   " (right click it on the Mods page, Reinstall), then press Scan.";
        }

        // ---- what puts each one right when Fix cannot (#2627) ------------

        /// <summary>Said after Fix for a step that fails only while something else has the file open.</summary>
        const string Retry = "Close Skyrim and Vortex, then press Fix again; if it is still here after that, send the launcher log to the Discord.";

        /// <summary>A plugin of the collection that is not in the game folder and Vortex has no copy of.</summary>
        const string VortexDeploys = "Vortex has to deploy it: in Vortex, enable the Thornswood profile and press Deploy, or install the collection if you have not, then press Scan.";

        /// <summary>A plugin of ours whose server copy the release does not have (#3386).</summary>
        const string NotInRelease = "Fix takes Thornswood's own plugins from the latest release, and that release does not have the copy the server runs yet, or could not be reached. The next update brings it: take it when it is waiting, then press Scan.";

        /// <summary>Thornswood-Last.esp made from this release's recipe, and the server holding another (#2791).</summary>
        const string OtherBuild = "The server and this release are of two builds: take the update when one is waiting; when none is, the server is behind, and staff deploy it again.";

        /// <summary>The order cannot be put right while the server names a plugin this build has no line for and that is not ours.</summary>
        const string OrderNeeds = "The server's order names a plugin this build's list does not have and that is not Thornswood's own, so only an update or Vortex can bring it: take the update when one is waiting, or deploy the Thornswood collection in Vortex, then press Scan.";

        /// <summary>
        /// What puts an order right that Fix could not: the release's copy
        /// when the plugin the server has there is ours (Fix puts it in and in
        /// its place, so what is left is a release without it), an
        /// update or Vortex when it is another author's, and pressing Fix again
        /// when the server has nothing there and the list has one too many.
        /// </summary>
        static string OrderWhatWill(Config cfg, string theirs)
        {
            if (theirs == "nothing") return Retry;
            return ServedByServer(cfg, theirs) ? NotInRelease : OrderNeeds;
        }

        /// <summary>
        /// True when the server's manifest names this plugin in its served
        /// list, which makes it ours (#1180): full or light (#2627). False when
        /// the server cannot be asked.
        /// </summary>
        static bool ServedByServer(Config cfg, string plugin)
        {
            if (cfg == null || string.IsNullOrEmpty(plugin)) return false;
            ServerMod[] mods = null;
            try { mods = Manifest(cfg); } catch (Exception ex) { Swallow.Note("Verify.ServedByServer, asking the server for its manifest", ex); }
            if (mods == null) return false;
            foreach (ServerMod[] list in new ServerMod[][] { mods, manifestLight ?? new ServerMod[0] })
                foreach (ServerMod m in list)
                    if (m != null && m.Served && string.Equals(m.filename, plugin, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// What Scan says while Thornswood has no folder of its own: the
        /// folder, and nothing about the Steam copy, which is the person's
        /// (#1218, #2403). When Vortex deploys somewhere else, that folder is
        /// named first, because it is where the folder will be made from.
        /// </summary>
        static List<Issue> NoFolderYet(Config cfg)
        {
            var l = new List<Issue>();
            string into = "";
            if (cfg != null && !Paths.OwnFirst)
            {
                try { into = OwnGame.DeploysElsewhere(cfg); }
                catch (Exception ex) { Swallow.Note("Verify.Run, asking which folder Vortex deploys into", ex); }
            }
            // Vortex deploys the collection somewhere other than the Skyrim
            // this install reads. 24 September, a tester whose Vortex manages
            // another SkyMP server's copy of Skyrim, and deploys Thornswood's
            // collection into it. Patrick: "can we fix it so the launcher can
            // detect and fix this in scan and fix aswell". Blocking, which
            // adds no refusal: it only appears on a shared Skyrim, and Play
            // already refuses to start out of one (Shell.OwnGameRequired).
            if (into.Length > 0)
            {
                string game = "";
                try { game = OwnGame.Source(cfg); } catch { /* "" reads as apart, which only changes the sentence */ }
                bool apart = !string.Equals(game, into, StringComparison.OrdinalIgnoreCase);
                // "Vortex deploys into", not "Thornswood's mods": the record
                // here says Vortex deployed something, not that it is the
                // Thornswood collection. Fix checks that before it builds
                // (OwnGame.WhyNot counts Thornswood's plugins) and says to
                // enable the Thornswood profile when it is not.
                var i = Issue.Of(IssueKind.OwnFolder, "Vortex deploys into " + into + ", not into " + Paths.Game + ".",
                                 "Fix will make Thornswood's own Skyrim folder from what Vortex deployed there, once it has checked that is Thornswood's collection" +
                                 (apart ? ", taking the game itself from the Steam copy and nothing else from that folder." : "."),
                                 "Settings, Maintenance, Choose Vortex's folder, then Make it, does the same by hand.", true);
                i.VortexFolder = into;
                l.Add(i);
                return l;
            }

            string why = null;
            if (cfg != null)
            {
                try { why = OwnGame.WhyNot(cfg, OwnGame.DeploysInto(cfg)); }
                catch (Exception ex) { why = ex.Message; }
            }
            string what = Paths.OwnFirst
                ? "Thornswood's own Skyrim folder was chosen when Thornswood was installed and is not made yet, so there is no game to check."
                : "Thornswood has no Skyrim folder of its own yet, so there is no game of its own to check. The Steam copy in " + Paths.SteamCopy +
                  " is yours, and Scan and Fix leave it as it is.";
            // Not blocking when it was chosen at install, as it never was; a
            // shared Skyrim blocks, because the plugins it used to be judged
            // by are not judged any more and Ready to launch must not read
            // green for an install Play will not start from.
            bool blocks = !Paths.OwnFirst;
            l.Add(why == null
                ? Issue.Of(IssueKind.OwnFolder, what, "Fix makes it from what Vortex has deployed, after asking, and the launcher restarts into it.",
                           "Settings, Maintenance, Make it, makes it too.", blocks)
                : Issue.Of(IssueKind.OwnFolder, what, null, "It cannot be made yet: " + why, blocks));
            return l;
        }

        /// <summary>
        /// The server's light plugins in light index order, or an empty list
        /// when it publishes none: a server that loads no light plugin, or one
        /// that cannot be asked. #1715.
        /// </summary>
        static List<string> LightNames(Config cfg)
        {
            ServerMod[] mods = null;
            try { mods = Manifest(cfg); } catch (Exception ex) { Swallow.Note("Verify.LightNames, asking the server for its manifest", ex); }
            if (mods == null) return new List<string>();
            return Names(manifestLight);
        }

        /// <summary>
        /// The server's whole order, full and light plugins together, by name,
        /// when it publishes a light order; otherwise null, and the order to
        /// put a list into is the full one alone.
        /// </summary>
        static List<string> WholeOrder()
        {
            if (manifestLight == null || manifestLight.Length == 0 || manifestAll == null || manifestAll.Length == 0) return null;
            var l = new List<string>();
            foreach (string p in manifestAll)
            {
                if (string.IsNullOrEmpty(p)) continue;
                string n = p.Trim();
                int cut = Math.Max(n.LastIndexOf('/'), n.LastIndexOf('\\'));
                if (cut >= 0) n = n.Substring(cut + 1);
                if (n.Length > 0) l.Add(n);
            }
            return l;
        }

        /// <summary>The manifest's plugin names in its order, which is the server's load order.</summary>
        static List<string> Names(ServerMod[] mods)
        {
            var l = new List<string>();
            if (mods == null) return l;
            foreach (ServerMod m in mods)
                if (m != null && !string.IsNullOrEmpty(m.filename)) l.Add(m.filename);
            return l;
        }

        /// <summary>
        /// Each plugin in Data whose light flag is not the server's, with true
        /// when the server's copy is light: in its light list (#1715) and not
        /// flagged here, or in its full list and flagged here. Another author's
        /// plugins only, and none when the server cannot be asked. An .esl is
        /// light by its name, and a file that cannot be read is not reported.
        /// </summary>
        static List<KeyValuePair<string, bool>> FlagNotServers(Config cfg)
        {
            var l = new List<KeyValuePair<string, bool>>();
            ServerMod[] mods = null;
            try { mods = Manifest(cfg); }
            catch (Exception ex) { Swallow.Note("Verify.FlagNotServers, asking the server for its manifest", ex); }
            if (mods == null) return l;
            foreach (bool light in new[] { false, true })
            {
                foreach (ServerMod m in light ? (manifestLight ?? new ServerMod[0]) : mods)
                {
                    if (m == null || string.IsNullOrEmpty(m.filename) || m.Served || Storefront.Contains(m.filename)) continue;
                    if (m.filename.EndsWith(".esl", StringComparison.OrdinalIgnoreCase)) continue;
                    bool? here = Checks.FlaggedLight(m.filename);
                    if (here != null && here.Value != light) l.Add(new KeyValuePair<string, bool>(m.filename, light));
                }
            }
            return l;
        }

        // ------------------------------------------------------------ order
        //
        // What LoadOrder needs to know about this machine, and nothing else:
        // which plugins Skyrim.ccc names, which are in Data, which are light.

        /// <summary>Every plugin Skyrim.ccc names, in its order. The game loads the ones it finds before it reads any list.</summary>
        static List<string> Ccc()
        {
            var l = new List<string>();
            try
            {
                string ccc = Path.Combine(Paths.Game, "Skyrim.ccc");
                if (!File.Exists(ccc)) return l;
                foreach (string raw in File.ReadAllLines(ccc))
                {
                    string n = raw.Trim();
                    if (n.Length == 0 || n.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) continue;
                    l.Add(n);
                }
            }
            catch (Exception ex) { Swallow.Note("Verify.Ccc", ex); }
            return l;
        }

        static bool InData(string name)
        {
            try { return File.Exists(Path.Combine(Paths.Game, "Data", name)); }
            catch { return false; }
        }

        /// <summary>True when the game gives the plugin no normal index: not in Data, an .esl, or flagged light.</summary>
        static bool LightOrMissing(string name)
        {
            return !InData(name) || Checks.TakesNoPlace(name);
        }

        /// <summary>True for a plugin in Data that is light. A missing one is not light; the "not in Data" issue owns it.</summary>
        static bool Light(string name)
        {
            return InData(name) && Checks.TakesNoPlace(name);
        }

        /// <summary>
        /// This build's plugin list in the server's order, when the server
        /// answers and the order is not already its own. LoadOrder.Reorder
        /// moves only the full plugins the server names and leaves every
        /// other line where it was, so the file keeps its header, its
        /// comments, its disabled entries and its light plugins. A server
        /// that publishes a light order (#1715) has its light plugins moved
        /// too, by LoadOrder.ReorderWhole, and the list is rewritten when
        /// either order is not the server's. Written
        /// back with the encoding and line endings it had: a byte order mark
        /// or a changed newline is enough for the game to read the list as
        /// something else. Returns 1 when the file was rewritten.
        /// </summary>
        public static int PutInServerOrder(Config cfg, Action<string> say)
        {
            ServerMod[] mods = null;
            try { mods = Manifest(cfg); } catch (Exception ex) { Swallow.Note("Verify.PutInServerOrder, asking the server for its manifest", ex); }
            if (mods == null) return 0;
            List<string> manifest = Names(mods);
            List<string> serverLight = Names(manifestLight);
            List<string> whole = WholeOrder();
            List<string> ccc = Ccc();

            // OrderFolder, not Paths.Live. Before the own folder exists
            // Live is Windows' own Skyrim folder (#1234).
            string live = Path.Combine(OrderFolder, "plugins.txt");
            if (!File.Exists(live)) return 0;
            List<string> enabledNow = Enabled(live);
            bool fullRight = LoadOrder.FirstMismatch(LoadOrder.GameOrder(enabledNow, LightOrMissing, ccc, InData), manifest) < 0;
            bool lightRight = serverLight.Count == 0 ||
                LoadOrder.FirstMismatch(LoadOrder.LightOrder(enabledNow, Light, ccc, InData), serverLight) < 0;
            if (fullRight && lightRight) return 0;

            byte[] raw;
            try { raw = File.ReadAllBytes(live); }
            catch { return 0; }
            bool bom = raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF;
            var utf8 = new UTF8Encoding(false);
            string text = utf8.GetString(raw, bom ? 3 : 0, raw.Length - (bom ? 3 : 0));
            string nl = text.IndexOf("\r\n", StringComparison.Ordinal) >= 0 ? "\r\n" : "\n";
            bool trailing = text.EndsWith("\n");
            var lines = new List<string>(text.Split(new string[] { "\r\n", "\n" }, StringSplitOptions.None));
            if (trailing && lines.Count > 0) lines.RemoveAt(lines.Count - 1);

            // A server with a light order: every line it names, full and
            // light, into its whole order (#1715), so the light plugins take
            // the server's light indices and sit among the full ones where the
            // server has them. The Skyrim.ccc names are the game's to load
            // first and are skipped, as the masters are.
            List<string> ordered = whole != null ? LoadOrder.ReorderWhole(lines, whole, ccc) : LoadOrder.Reorder(lines, manifest, Light);
            var added = new List<string>();
            if (ordered == null)
            {
                List<string> off = whole != null ? LoadOrder.NotEnabledWhole(lines, whole, ccc) : LoadOrder.NotEnabled(lines, manifest);
                // A plugin of ours the server names and this build's list
                // does not enable goes into the server's place (#2627). On
                // 16 Oct the server's order named Thornswood-Last.esp, which
                // the release Patrick's launcher had not taken yet ships, and
                // this said the order "was left alone" at every Fix while the
                // light order stayed wrong. Ours is what the server's served
                // list names, and only once it is in Data: switching on a plugin the
                // game cannot find would move every one after it.
                var ours = new List<string>();
                var notOurs = new List<string>();
                var notHere = new List<string>();
                foreach (string p in off)
                {
                    // Ours: served, or made here from the release's recipe (#2791).
                    if (!ServedByServer(cfg, p) && !LastPlugin.Makes(Paths.Game, p)) notOurs.Add(p);
                    else if (!InData(p)) notHere.Add(p);
                    else ours.Add(p);
                }
                if (off.Count > 0 && notOurs.Count == 0 && notHere.Count == 0)
                {
                    List<string> with = SwitchOn(lines, ours);
                    ordered = whole != null ? LoadOrder.ReorderWhole(with, whole, ccc) : LoadOrder.Reorder(with, manifest, Light);
                    if (ordered != null)
                    {
                        added = ours;
                        lines = with;
                    }
                }
                if (ordered == null)
                {
                    if (notOurs.Count > 0)
                        say("The server's order names " + string.Join(", ", notOurs.ToArray()) + ", which this build's plugin list does not enable and is not Thornswood's own, so the order was left alone. " + OrderNeeds);
                    else if (notHere.Count == 1 && LastPlugin.Makes(Paths.Game, notHere[0]))
                        say("The server's order names " + notHere[0] + ", which this release makes from your plugins and has not been made, so the order was left alone. Scan's line about the files made from your game says what stops it.");
                    else if (notHere.Count > 0)
                        say("The server's order names " + string.Join(", ", notHere.ToArray()) + ", which is ours and is not in Data, because the release did not have it, so the order was left alone. " + NotInRelease);
                    else
                        say("This build's plugin list enables the same plugin twice, so the order was left alone.");
                    return 0;
                }
            }
            string first;
            int moved = LoadOrder.Moved(lines, ordered, out first);
            if (moved == 0 && added.Count == 0) return 0;

            var body = new List<byte>();
            if (bom) body.AddRange(new byte[] { 0xEF, 0xBB, 0xBF });
            body.AddRange(utf8.GetBytes(string.Join(nl, ordered.ToArray()) + (trailing ? nl : "")));
            try
            {
                File.WriteAllBytes(live, body.ToArray());
            }
            catch (Exception ex)
            {
                say("The plugin list could not be written (" + ex.Message.TrimEnd('.') + "). Close Skyrim and press Fix again.");
                return 0;
            }
            if (added.Count > 0)
                say(string.Join(", ", added.ToArray()) + (added.Count == 1 ? " is" : " are") +
                    " ours, and the server's order names " + (added.Count == 1 ? "it" : "them") +
                    ", so " + (added.Count == 1 ? "it is" : "they are") + " switched on in the server's place. The next release's plugin list carries " +
                    (added.Count == 1 ? "it." : "them."));
            if (moved > 0)
                say(moved + (moved == 1 ? " plugin" : " plugins") + " moved into the server's order, the first " + first + ".");
            return 1;
        }

        /// <summary>
        /// The same plugins.txt lines with each of <paramref name="names"/>
        /// switched on: a line that lists it switched off gains its star,
        /// and a name with no line at all gets one at the end, where the
        /// reorder after it takes it to the server's place. Every other line
        /// stays as it was.
        /// </summary>
        static List<string> SwitchOn(IList<string> lines, IList<string> names)
        {
            var result = new List<string>(lines);
            foreach (string name in names)
            {
                bool done = false;
                for (int i = 0; i < result.Count && !done; i++)
                {
                    string t = result[i].Trim();
                    if (t.StartsWith("*")) continue;
                    if (string.Equals(t, name, StringComparison.OrdinalIgnoreCase)) { result[i] = "*" + t; done = true; }
                }
                if (!done) result.Add("*" + name);
            }
            return result;
        }

        static string Fmt(long bytes)
        {
            if (bytes >= 1048576) return (bytes / 1048576.0).ToString("0.0") + " MB";
            if (bytes >= 1024) return (bytes / 1024.0).ToString("0.0") + " KB";
            return bytes + " bytes";
        }

        // Standard CRC-32 (the zlib one), which is what the server's manifest
        // carries, read back as the signed number the manifest prints. Cached
        // by size and write time, because Run is called at Play and again when
        // the game closes and there is no reason to read thirty megabytes twice.
        static uint[] crcTable;
        class CrcEntry { public long Size; public DateTime Written; public int Crc; }
        static readonly Dictionary<string, CrcEntry> crcCache = new Dictionary<string, CrcEntry>(StringComparer.OrdinalIgnoreCase);

        static int Crc32Of(string path, long size)
        {
            DateTime written = File.GetLastWriteTimeUtc(path);
            CrcEntry hit;
            lock (crcCache)
            {
                if (crcCache.TryGetValue(path, out hit) && hit.Size == size && hit.Written == written) return hit.Crc;
            }
            int crc;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                crc = Crc32Of(fs);
            lock (crcCache)
            {
                crcCache[path] = new CrcEntry { Size = size, Written = written, Crc = crc };
            }
            return crc;
        }

        static int Crc32Of(Stream s)
        {
            if (crcTable == null)
            {
                var t = new uint[256];
                for (uint i = 0; i < 256; i++)
                {
                    uint c = i;
                    for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                    t[i] = c;
                }
                crcTable = t;
            }
            uint crc = 0xFFFFFFFFu;
            var buf = new byte[1 << 16];
            int n;
            while ((n = s.Read(buf, 0, buf.Length)) > 0)
                for (int i = 0; i < n; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >> 8);
            return (int)(crc ^ 0xFFFFFFFFu);
        }

        // ms for the answer to start and ms for each read of it (Http).
        static byte[] Get(string url, int ms)
        {
            return Http.GetOrNull(url, ms, ms);
        }

        /// <summary>
        /// The release's copy of one plugin of ours, written over the file
        /// that is here, when it is the copy the server runs (#3386).
        /// Written into the existing file rather than swapped for a new one, so
        /// a hard link (Vortex's deployment, the launcher's own Game folder,
        /// which share the file with the Steam copy) sees the same bytes
        /// everywhere and Vortex has nothing to report. The old bytes are kept
        /// whole under Profile\Replaced first.
        ///
        /// The bytes come from the release the update feed names, over https,
        /// by the sha256 its record gives them (Updater.ReleaseCopy), and
        /// from nowhere else. Until #3386 they came from the server's
        /// resources port over plain http and were checked against the size
        /// and crc32 in that same server's manifest, so anybody on the path
        /// could hand over a plugin of their own with numbers to match. The
        /// manifest is still what says which copy the server runs, so a
        /// release copy that is not that one is not written: it would only
        /// swap one LOAD ORDER ERROR for another.
        /// </summary>
        static bool FetchPlugin(Config cfg, Issue i, Func<string, byte[]> release, Action<string> say)
        {
            // Only what the server lists as served, Thornswood's own plugin
            // (#1180). Before that this fetched any plugin that differed, and
            // the server handed out 42 other authors' mods to anybody who
            // asked (measured on both servers, 5 Oct). The release holds only
            // ours anyway; this keeps the sentence for another author's right.
            if (!i.Served)
            {
                say(i.Plugin + " was left as it is. " + FromVortex(cfg, i.Plugin));
                return false;
            }
            string dest = Path.Combine(Paths.Game, "Data", i.Plugin);
            if (release == null)
            {
                say(i.Plugin + ": the update feed could not be read, so there is no release copy to put in and nothing was changed.");
                return false;
            }
            byte[] bytes;
            try { bytes = release(i.Plugin); }
            catch (Exception ex)
            {
                say(i.Plugin + ": the release's copy could not be fetched (" + ex.Message.TrimEnd('.') + "), so nothing was changed.");
                return false;
            }
            if (bytes == null)
            {
                say(i.Plugin + ": the release the update feed names does not ship it, so nothing was changed.");
                return false;
            }
            int crc;
            using (var ms = new MemoryStream(bytes)) crc = Crc32Of(ms);
            if (bytes.LongLength != i.WantSize || crc != i.WantCrc)
            {
                say(i.Plugin + ": the release's copy is not the one the server runs, so nothing was changed.");
                return false;
            }
            bool hadLocal = false;
            try { hadLocal = File.Exists(dest); }
            catch (Exception ex) { Swallow.Note("Verify.FetchPlugin, asking whether " + i.Plugin + " was already in Data", ex); }
            if (hadLocal)
            {
                try
                {
                    Directory.CreateDirectory(Paths.Replaced);
                    File.Copy(dest, Path.Combine(Paths.Replaced, i.Plugin + "." + DateTime.Now.ToString("yyyyMMdd-HHmmss")), true);
                }
                catch (Exception ex) { Swallow.Note("Verify.FetchPlugin, keeping the old copy of " + i.Plugin + " under Profile\\Replaced", ex); }
            }
            // Our bytes go in our copy of the file and nowhere else.
            //
            // Vortex deploys by hard link, so this plugin and the Nexus mod in
            // Vortex's staging are one file under two names, and staging is
            // shared with every other Skyrim profile on this machine. Without
            // this, pressing Fix here reached into another SkyMP server's
            // collection and changed a plugin it was relying on. FileMode.Create
            // truncates the file it is given rather than replacing it, so the
            // link has to come off first.
            OwnGame.Detach(dest);
            try
            {
                using (var fs = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None))
                    fs.Write(bytes, 0, bytes.Length);
            }
            catch (Exception ex)
            {
                say(i.Plugin + " could not be written (" + ex.Message.TrimEnd('.') + "). Close Skyrim and Vortex and press Fix again.");
                return false;
            }
            lock (crcCache) { crcCache.Remove(dest); }
            say(i.Plugin + " is now the release's copy, the one the server runs (" + Fmt(bytes.LongLength) + ")." + (hadLocal ? " Yours is kept in Profile\\Replaced." : ""));
            return true;
        }

        /// <summary>
        /// Puts the shipped plugin list back, into the file that is actually
        /// read, then the server's order into it when the server can be asked
        /// (PutInServerOrder). The file is OrderFolder: Profile until the own
        /// folder exists, and the file the game reads after that.
        ///
        /// Before the own folder exists this does not write Vortex's file in
        /// Windows' own Skyrim folder. The order waits in Profile (#1234).
        /// Once the folder exists, the file written is the one the game reads.
        /// </summary>
        public static int Fix() { return Fix(null, null, null); }

        /// <summary>
        /// Where plugins.txt and loadorder.txt are written. After the own
        /// folder exists, Paths.Live, the file the game reads. Before it
        /// exists, Paths.Live is Windows' own Skyrim folder, so the order
        /// waits in Profile and reaches the game when the folder is made
        /// (#1234).
        /// </summary>
        public static string OrderFolder
        {
            get { return Paths.Collection ? Paths.LocalAD : Paths.Live; }
        }

        /// <summary>
        /// The reference plugin list into the file the game actually reads.
        /// How many files were copied.
        ///
        /// Its own method because it is also run straight after an update that
        /// carried one, and it is the ONLY part of Fix that may be. Until
        /// 22 September a pack's profile entry landed in Profile\Default and
        /// stopped there, so a release that moved the load order installed
        /// cleanly and then refused the person at the door until they went
        /// back to the launcher and pressed Fix. A first time person reads
        /// that as the game being broken, and they are not wrong to.
        ///
        /// Nothing else in Fix may run on that path. IsolateForeign and
        /// IsolateCreations move other people's files aside and PutInServerOrder
        /// asks the server, and none of that is wanted unprompted after every
        /// pack.
        /// </summary>
        public static int SettleLoadOrder()
        {
            int n = 0;
            foreach (string f in new string[] { "plugins.txt", "loadorder.txt" })
            {
                string src = Path.Combine(Paths.Golden, f);
                if (!File.Exists(src)) continue;
                // Profile until the own folder exists. Paths.Live is then
                // Windows' own plugins.txt, the person's Steam Skyrim and
                // the active Vortex profile (#1234). SettleSettings carries
                // a list already waiting in Profile into the folder.
                Directory.CreateDirectory(OrderFolder);
                File.Copy(src, Path.Combine(OrderFolder, f), true);
                n++;
            }
            return n;
        }

        /// <summary>
        /// Set by Fix when it pointed the launcher at the folder Vortex really
        /// deploys into. The launcher then makes Thornswood's own folder the
        /// way Make it in Settings does, which is its job and not this one's:
        /// it asks, shows what is in the way, and restarts into the folder.
        /// </summary>
        public static bool OwnFolderNext;

        /// <param name="release">Thornswood's own plugins from the release
        /// the update feed names (Updater.ReleaseCopy, #3386), the only
        /// place Fix takes a plugin's bytes from. Null when the feed could not
        /// be read, and then none is put in.</param>
        public static int Fix(Config cfg, Action<string> say, Func<string, byte[]> release)
        {
            if (say == null) say = delegate(string m) { };
            OwnFolderNext = false;

            // No folder of its own yet (#1226, #2403): what Fix puts right is
            // the folder Thornswood plays from, and that folder is what is
            // missing. Making it is the fix, the way Make it in Settings does
            // it, and nothing else is touched first, least of all the Steam
            // copy. Until 17 Oct a shared install got the whole of Fix in the
            // Steam copy: on 11 Oct a new dev build's first Fix moved 21
            // Creation Club plugins out of it and put the server's content
            // plugin over Vortex's copy there, while its own folder was being
            // made. The plugin list a release carries waits in Profile
            // (SettleLoadOrder, OrderFolder, #1234), which is not the Steam
            // copy, and goes into the folder when it is made.
            if (Paths.Collection)
            {
                int made = Paths.OwnFirst ? 0 : SettleLoadOrder();
                if (cfg != null && !Paths.OwnFirst)
                {
                    // Run's first issue, when Vortex deploys somewhere else:
                    // saved as VortexGame, so the own folder is made from there.
                    string into = "";
                    try { into = OwnGame.DeploysElsewhere(cfg); }
                    catch (Exception ex) { Swallow.Note("Verify.Fix, asking which folder Vortex deploys into", ex); }
                    if (into.Length > 0)
                    {
                        bool ok;
                        say(OwnGame.PointAt(cfg, into, out ok));
                        if (!ok) return made;
                    }
                }
                OwnFolderNext = true;
                say("Thornswood's own Skyrim folder is made next, from what Vortex has deployed. Nothing else is put right before it exists, and nothing is written into the Steam copy.");
                return made + 1;
            }

            int n = SettleLoadOrder();

            // Fix means make this install match what the server expects, and
            // another server's client running the main menu is the furthest
            // from that anything gets. It is moved aside, never deleted,
            // because somebody who plays here may also play there.
            n += Checks.IsolateForeign(say);

            // Creation Club plugins the game would load because Skyrim.ccc
            // names them. Moved aside the same way, and said, because these are
            // Steam's files and somebody may go looking for them.
            var wanted = new HashSet<string>(Enabled(Path.Combine(Paths.Golden, "plugins.txt")), StringComparer.OrdinalIgnoreCase);
            List<string> theirLight = cfg != null ? LightNames(cfg) : new List<string>();
            n += Checks.IsolateCreations(wanted, theirLight, say);

            // A plugin in the person's own mods folder, which Play never
            // copies in and the server would refuse: aside, never deleted.
            n += IsolatePersonal(say);

            // Missing plugins the golden list expects. SettleLoadOrder only
            // rewrites plugins.txt; it never puts a file back into Data, which
            // is why Diagnostics Fix left CFTO-Lanterns / BeardMaskFix and the
            // like uncleared on Djinn's machine. Restore from Vortex first.
            // Then fetch any of ours still missing.
            try { n += OwnGame.RestoreMissingPlugins(cfg, say); }
            catch (Exception ex) { Swallow.Note("Verify.Fix, restoring missing plugins from Vortex", ex); say("Could not restore missing plugins from Vortex (" + ex.Message.TrimEnd('.') + ")."); }

            // The release's copy of our own plugin when its bytes are not the
            // server's (#3386); another author's is named for Vortex (#1180).
            if (cfg != null)
            {
                foreach (Issue i in Bytes(cfg))
                    if (i.Plugin != null && !LastPlugin.Makes(Paths.Game, i.Plugin) && FetchPlugin(cfg, i, release, say)) n++;
            }

            // Still missing from Data and ours by the server's served list
            // (#1180), full or light (#2627): the release's copy (#3386).
            // Bytes skips absent files on purpose (Run already named them);
            // Fix still has to put ours back when the game folder lost it, or
            // never had it: on 16 Oct Thornswood-Last.esp, light and ours,
            // shipped only in a release Patrick's open launcher had not taken,
            // the server's light order named it, and Fix fetched nothing
            // because it looked at the full plugins alone. Another author's
            // missing plugin is Vortex's to put back, and RestoreMissingPlugins
            // above has already said so.
            if (cfg != null)
            {
                try
                {
                    ServerMod[] mods = Manifest(cfg);
                    if (mods != null)
                    {
                        ServerMod[] light = manifestLight ?? new ServerMod[0];
                        string dataDir = Path.Combine(Paths.Game, "Data");
                        int all = mods.Length + light.Length;
                        for (int idx = 0; idx < all; idx++)
                        {
                            bool isLight = idx >= mods.Length;
                            ServerMod m = isLight ? light[idx - mods.Length] : mods[idx];
                            // The one made from the release's recipe is MadeFromGame's (#2791).
                            if (m == null || string.IsNullOrEmpty(m.filename) || Storefront.Contains(m.filename) || !m.Served || LastPlugin.Makes(Paths.Game, m.filename)) continue;
                            string dest = Path.Combine(dataDir, m.filename);
                            bool goneFile = false;
                            try { goneFile = !File.Exists(dest); }
                            catch (Exception ex) { Swallow.Note("Verify.Fix, asking whether " + m.filename + " is still missing before fetch", ex); goneFile = true; }
                            if (!goneFile) continue;
                            var miss = new Issue(m.filename + " is missing from Data; Fix puts in the release's copy.", true);
                            miss.FileMissing = true;
                            miss.Plugin = m.filename;
                            miss.WantSize = m.size;
                            miss.WantCrc = (int)m.crc32;
                            miss.WantLight = isLight;
                            miss.WantIndex = isLight ? idx - mods.Length : idx;
                            miss.Served = true;
                            if (FetchPlugin(cfg, miss, release, say)) n++;
                        }
                    }
                }
                catch (Exception ex) { Swallow.Note("Verify.Fix, putting in still-missing plugins of ours from the release", ex); }
            }

            // The server's order, into this build's own list, last: after the
            // reference copy, which settles what is on and off, after the
            // creations are moved aside, so the order is judged on what the
            // game will count, and after our own plugins are fetched, so one
            // the server names and this build's list lacks is in Data when it
            // is put in its place (#2627). The reference under Profile\Default
            // is not touched: the next release carries the server's order in
            // it (Publish-Update) and until then this is what puts it right on
            // a machine.
            if (cfg != null)
            {
                try { n += PutInServerOrder(cfg, say); } catch (Exception ex) { Swallow.Note("Verify.Fix, PutInServerOrder", ex); }
            }
            return n;
        }

        /// <summary>
        /// Plugins in the person's own mods folder, moved aside into
        /// Profile\Isolated, never deleted. Play copies that folder into the
        /// game without its plugins (DeployPersonal), so a plugin there does
        /// nothing but stop Play, and Scan says so. Returns how many moved.
        /// </summary>
        static int IsolatePersonal(Action<string> say)
        {
            int n = 0;
            string[] files;
            try
            {
                if (!Directory.Exists(Paths.Personal)) return 0;
                files = Directory.GetFiles(Paths.Personal, "*.*", SearchOption.AllDirectories);
            }
            catch (Exception ex) { Swallow.Note("Verify.IsolatePersonal, listing " + Paths.Personal, ex); return 0; }
            string bin = Path.Combine(Paths.Isolated, DateTime.Now.ToString("yyyyMMdd-HHmm") + "-your-mods");
            foreach (string f in files)
            {
                string e = Path.GetExtension(f).ToLowerInvariant();
                if (e != ".esp" && e != ".esm" && e != ".esl") continue;
                try
                {
                    Directory.CreateDirectory(bin);
                    string to = Path.Combine(bin, Path.GetFileName(f));
                    if (File.Exists(to)) to = Path.Combine(bin, DateTime.Now.ToString("HHmmss") + "-" + Path.GetFileName(f));
                    File.Move(f, to);
                    say(Path.GetFileName(f) + " was in your own mods folder, where a plugin only stops Play. It is in " + bin + " now; nothing was deleted.");
                    n++;
                }
                catch (Exception ex) { say(Path.GetFileName(f) + " could not be moved out of your own mods folder (" + ex.Message.TrimEnd('.') + ")."); }
            }
            return n;
        }

        /// <summary>Where the load order being judged actually lives, for the
        /// launcher to show, because the last hour of this was not knowing.</summary>
        public static string LiveFile { get { return Path.Combine(Paths.Live, "plugins.txt"); } }

        /// <summary>Copies the person's own loose files into the game before launch.</summary>
        public static int DeployPersonal()
        {
            if (!Directory.Exists(Paths.Personal)) { Directory.CreateDirectory(Paths.Personal); return 0; }
            string dataRoot = Path.Combine(Paths.Game, "Data");
            int n = 0;
            foreach (string src in Directory.GetFiles(Paths.Personal, "*.*", SearchOption.AllDirectories))
            {
                string rel = src.Substring(Paths.Personal.Length).TrimStart('\\');
                string ext = Path.GetExtension(src).ToLowerInvariant();
                if (ext == ".esp" || ext == ".esm" || ext == ".esl") continue;   // never, it breaks the check
                string dest = Path.Combine(dataRoot, rel);
                string full = Path.GetFullPath(dest);
                if (!full.StartsWith(dataRoot, StringComparison.OrdinalIgnoreCase)) continue;
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(full));
                    // Detach rather than Unshare: the same reason as the plugin
                    // write above. Unshare does nothing on a collection install,
                    // which is the layout that ships, so somebody's own file
                    // copied over a Vortex deployed one went straight into the
                    // Nexus mod in staging.
                    OwnGame.Detach(full);
                    File.Copy(src, full, true);
                    n++;
                }
                catch (Exception ex) { Swallow.Note("Verify.DeployPersonal, " + rel, ex); }
            }
            return n;
        }
    }
}
