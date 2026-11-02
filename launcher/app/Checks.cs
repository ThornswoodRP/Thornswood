using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Thornswood
{
    class Check
    {
        public string Name, Detail;
        public bool Ok;
        // A row that is shown, and turns amber when it fails, but does not
        // shut Play. A new row starts this way until it has been seen to be
        // right on every tester's machine, because a row that blocks and is
        // wrong locks everybody out on the day it ships.
        public bool Advisory;
        // What the Ready card on Play says when this row is what keeps Play
        // shut: the problem in a few words ("Steam not running"), so nobody
        // has to open Diagnostics to find out what is wrong (#3203). Detail
        // is the row's own column on Diagnostics and reads next to Name;
        // this stands alone. Every row that can block sets it where it is
        // made, because that is where the specifics are known.
        public string Problem;
        public Check(string n, bool ok, string d) { Name = n; Ok = ok; Detail = d; }
        public Check(string n, bool ok, string d, bool advisory) { Name = n; Ok = ok; Detail = d; Advisory = advisory; }

        /// <summary>Whether this row, as it stands, keeps Play shut.</summary>
        public bool Blocks { get { return !Ok && !Advisory; } }
    }

    static class Checks
    {
        /// <summary>
        /// The Address Library row on the Play page.
        ///
        /// Script extender plugins look the game's addresses up in this file,
        /// and one that needs it and cannot find it does not load: EngineFixes
        /// says "failed to locate an appropriate address library" and stays
        /// out (see the working directory note in Shell.Play). Until
        /// 24 September nothing on this page asked, so a missing file read as
        /// all green while those plugins quietly stayed out of the game.
        /// Setup-Thornswood.ps1 has checked for it all along; the launcher
        /// was the one that forgot.
        ///
        /// Advisory: it turns amber and does not shut Play. It is a new row,
        /// and a new row that blocks and is wrong on somebody's machine locks
        /// them out of the game with nothing they can press.
        ///
        /// buildRight is the Game build row's answer. While the exe is the
        /// wrong build the fix is the downgrade, not Vortex: DrawStatus keeps
        /// the collection card down until the build is right, so sending
        /// somebody to Vortex from here would contradict the one card on the
        /// page that helps them.
        /// </summary>
        public static Check AddressLibraryRow(string game, bool buildRight)
        {
            string build;
            string file = AddressLibraryFile(game, out build);
            bool ok = file.Length > 0 && File.Exists(file);
            string detail = ok ? "versionlib " + build
                          : file.Length == 0 ? "cannot tell, SkyrimSE.exe gives no version"
                          : !buildRight ? "missing for " + build + ", downgrade first"
                          : "missing for " + build + ", install the collection in Vortex";
            return new Check("Address Library", ok, detail, true);
        }

        /// <summary>
        /// The Address Library file the game in this folder will open, as a
        /// full path, with the build it is for ("1.6.1170") in build. Both
        /// are "" when SkyrimSE.exe is missing or carries no version.
        ///
        /// Named from the exe's own version rather than from a second copy
        /// of the pin, because the plugins name it the same way when the game
        /// starts: the build that actually runs decides which file they open.
        /// Measured on 24 September: C:\Thornswood\Game\SkyrimSE.exe reads
        /// 1.6.1170.0, and versionlib-1-6-1170-0.bin is the file beside it
        /// that Setup-Thornswood.ps1 tests for. So this follows the pin
        /// wherever it moves without anybody editing it.
        /// </summary>
        public static string AddressLibraryFile(string game, out string build)
        {
            build = "";
            try
            {
                string exe = Path.Combine(game, "SkyrimSE.exe");
                if (!File.Exists(exe)) return "";
                FileVersionInfo v = FileVersionInfo.GetVersionInfo(exe);
                string name = AddressLibraryName(v.FileMajorPart, v.FileMinorPart, v.FileBuildPart, v.FilePrivatePart);
                if (name.Length == 0) return "";
                build = v.FileMajorPart + "." + v.FileMinorPart + "." + v.FileBuildPart;
                return Path.Combine(game, "Data\\SKSE\\Plugins\\" + name);
            }
            catch { build = ""; return ""; }
        }

        /// <summary>
        /// Address Library's file name for one build of the game. The mod
        /// ships one file per build, side by side: version-1-5-97-0.bin for
        /// the 1.5 builds and versionlib-1-6-1170-0.bin for 1.6 and after.
        /// </summary>
        public static string AddressLibraryName(int major, int minor, int build, int rev)
        {
            if (major <= 0) return "";
            string stem = (major == 1 && minor < 6) ? "version-" : "versionlib-";
            return stem + major + "-" + minor + "-" + build + "-" + rev + ".bin";
        }

        /// <summary>
        /// Which revision of the collection this machine has installed, or 0.
        ///
        /// This replaces asking whether one named file exists, which is what
        /// decided "your collection is behind" until 22 September. That test
        /// was wrong in both directions. It named one mod's file, which a
        /// script put into a build BY HAND and which the collection did not
        /// carry then, so anybody who installed the collection correctly and
        /// never ran that script read as behind, and
        /// anybody genuinely two revisions behind read as fine as long as the
        /// file was there.
        ///
        /// WHERE THE NUMBER COMES FROM, and why this was rewritten on
        /// 27 September. The first version read the revision out of the name
        /// Vortex gave the mod folder:
        ///
        ///     %APPDATA%\Vortex\skyrimse\mods\collection_7essxf_2_2026-09-15T21-08-00Z
        ///                                               slug  ^ revision
        ///
        /// Current Vortex does not name the folder that way any more. It names
        /// it for the mod id it made up, with no slug and no number in it:
        ///
        ///     %APPDATA%\Vortex\skyrimse\mods\vortex_collection_ZRT7NjhN_
        ///
        /// So the folder name stopped being able to answer, Have went to 0 on
        /// every up to date machine, and Deploy-Gamemode's revision gate
        /// refused every deploy unless -IgnoreRevision.
        ///
        /// The honest source is Vortex's own state.v2, where it records the
        /// slug and the revision NUMBER against the collection's mod. That is
        /// independent of the folder name, so it answers for both eras. The
        /// old folder-name parse stays as a fallback. The same rule as
        /// Get-CollectionRevision in scripts\mods\LoadOrder.ps1.
        /// </summary>
        public static int CollectionRevision(Config cfg)
        {
            try
            {
                string slug = CollectionSlug(cfg);
                if (slug.Length == 0) return 0;
                int fromState = CollectionRevisionFromState(slug);
                if (fromState > 0) return fromState;
                return CollectionRevisionFromFolder(slug);
            }
            catch { return 0; }
        }

        /// <summary>
        /// Installed revision from current compressed LevelDB metadata, or 0.
        /// collectionSlug and revisionNumber are tied to one installed mod id.
        /// The shared reader honors CURRENT, sequences, tombstones and CRCs.
        /// Locally authored vortex_collection_* mods use their newestFileId
        /// link to a matching cached slug, never an unrelated cached revision.
        /// The publisher uses this same read-only helper.
        /// </summary>
        public static int CollectionRevisionFromState(string slug)
        {
            try {
                if (string.IsNullOrEmpty(slug)) return 0;
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vortex\\state.v2");
                return VortexProfileState.CollectionRevision(dir, slug);
            }
            catch { return 0; }
        }
        /// <summary>
        /// The legacy fallback: the revision out of the old folder name, or 0.
        /// Kept for a machine that still has collection_&lt;slug&gt;_&lt;rev&gt;_&lt;when&gt;
        /// folders and no readable state. Current Vortex does not write these
        /// any more; see CollectionRevision above.
        /// </summary>
        public static int CollectionRevisionFromFolder(string slug)
        {
            try
            {
                if (string.IsNullOrEmpty(slug)) return 0;
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Vortex\\skyrimse\\mods");
                if (!Directory.Exists(dir)) return 0;

                int best = 0;
                foreach (string d in Directory.GetDirectories(dir, "collection_" + slug + "_*"))
                {
                    string name = Path.GetFileName(d);
                    // collection_<slug>_<rev>_<when>
                    string rest = name.Substring(("collection_" + slug + "_").Length);
                    int cut = rest.IndexOf('_');
                    if (cut <= 0) continue;
                    int n = 0;
                    if (!int.TryParse(rest.Substring(0, cut), out n)) continue;
                    if (n > best) best = n;
                }
                return best;
            }
            catch { return 0; }
        }

        /// <summary>
        /// The collection's slug out of its address, "7essxf" from
        /// .../collections/7essxf. Read from the config so a machine pointed at
        /// a different collection still answers about its own.
        /// </summary>
        public static string CollectionSlug(Config cfg)
        {
            try
            {
                string url = cfg == null ? "" : (cfg.CollectionUrl ?? "");
                int at = url.LastIndexOf("/collections/", StringComparison.OrdinalIgnoreCase);
                if (at < 0) return "";
                string s = url.Substring(at + "/collections/".Length).Trim();
                int q = s.IndexOfAny(new char[] { '/', '?', '#' });
                if (q >= 0) s = s.Substring(0, q);
                foreach (char c in s) { if (!char.IsLetterOrDigit(c)) return ""; }
                return s;
            }
            catch { return ""; }
        }

        /// <summary>
        /// The address every collection button opens (#4115): the page of the
        /// revision the server was built against, .../collections/7essxf/revisions/2.
        ///
        /// The buttons used to open the collection's own page, which names no
        /// revision, so Nexus showed its newest and Vortex installed that. On
        /// 30 October Nexus was on revision 5 and both feeds on 2, so following
        /// the "your mods need updating" card, or installing fresh, took a copy
        /// straight past the server and Play shut again on the ahead card.
        /// Nexus keeps every published revision on a page of its own, and
        /// Vortex installs the one on the page it is opened from.
        ///
        /// No revision known (0, the feed not read yet) or an address that is
        /// not a collection's: the address as it is, the only page there is.
        /// </summary>
        public static string CollectionRevisionUrl(Config cfg, int revision)
        {
            string url = cfg == null ? "" : (cfg.CollectionUrl ?? "");
            try
            {
                string slug = CollectionSlug(cfg);
                if (revision <= 0 || slug.Length == 0) return url;
                int at = url.LastIndexOf("/collections/", StringComparison.OrdinalIgnoreCase);
                return url.Substring(0, at + "/collections/".Length) + slug + "/revisions/" + revision;
            }
            catch { return url; }
        }

        /// <summary>
        /// Nexus's own link to one revision of the collection, the one its
        /// site's "Add to Vortex" button hands Windows (#5200):
        /// nxm://skyrimspecialedition/collections/7essxf/revisions/6. Vortex
        /// reads it (NXMUrl in Vortex's source, the pattern
        /// /collections/(\w+)/revisions/(\d+|latest)) and opens that revision
        /// to install or update to, with no page in between.
        ///
        /// The game is the path part before /collections/ in the configured
        /// address, which both of Nexus's address shapes have
        /// (.../games/skyrimspecialedition/collections/7essxf and
        /// next.nexusmods.com/skyrimspecialedition/collections/7essxf).
        ///
        /// Empty when no revision is known or the address is not a
        /// collection's: there is no revision to name, and the page
        /// (CollectionRevisionUrl) is what opens instead.
        /// </summary>
        public static string CollectionNxmUrl(Config cfg, int revision)
        {
            try
            {
                string slug = CollectionSlug(cfg);
                if (revision <= 0 || slug.Length == 0) return "";
                string url = cfg.CollectionUrl;
                int at = url.LastIndexOf("/collections/", StringComparison.OrdinalIgnoreCase);
                string before = url.Substring(0, at).TrimEnd('/');
                string game = before.Substring(before.LastIndexOf('/') + 1).ToLowerInvariant();
                if (game.Length == 0) return "";
                foreach (char c in game) { if (!char.IsLetterOrDigit(c)) return ""; }
                return "nxm://" + game + "/collections/" + slug + "/revisions/" + revision;
            }
            catch { return ""; }
        }

        /// <summary>
        /// Whether the command Windows runs for an nxm link starts Vortex
        /// (#5200). Vortex writes it when it is set to handle Nexus links,
        /// as "C:\...\Vortex.exe" -d "%1". Another manager can hold nxm links
        /// instead (Mod Organizer 2 does), and none but Vortex installs a
        /// collection, so the launcher only hands the link over when Vortex
        /// is the one that answers it.
        /// </summary>
        public static bool NxmStartsVortex(string command)
        {
            try
            {
                string c = (command ?? "").Trim();
                if (c.Length == 0) return false;
                string exe;
                if (c[0] == '"')
                {
                    int end = c.IndexOf('"', 1);
                    if (end < 0) return false;
                    exe = c.Substring(1, end - 1);
                }
                else
                {
                    int end = c.IndexOf(' ');
                    exe = end < 0 ? c : c.Substring(0, end);
                }
                string name = exe.Substring(exe.LastIndexOfAny(new char[] { '\\', '/' }) + 1);
                return string.Equals(name, "Vortex.exe", StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        /// <summary>
        /// The command Windows runs for an nxm link, from the classes the
        /// signed-in account sees (HKEY_CLASSES_ROOT, which is the account's
        /// own over the machine's). Empty when nothing handles them.
        /// </summary>
        public static string NxmCommand()
        {
            try
            {
                using (var k = Microsoft.Win32.Registry.ClassesRoot.OpenSubKey(@"nxm\shell\open\command"))
                {
                    return k == null ? "" : (k.GetValue("") as string ?? "");
                }
            }
            catch (Exception ex) { Swallow.Note("Checks.NxmCommand", ex); return ""; }
        }

        /// <summary>
        /// At or below this many enabled plugins the collection counts as not
        /// installed. Two things on screen ask it: the Mods row on the checks
        /// list and the "not installed yet" card above Play, which is
        /// Shell.CollectionProblem answering "none". Until 24 September each
        /// had its own 40 written into it, so moving one and not the other
        /// would have put a green Mods row under a card saying the mods are
        /// not installed.
        ///
        /// Nothing recorded says where 40 came from; it has been the number
        /// since the first launcher. It sits well under the 94 plugins the
        /// shipped reference list enables, counted on 24 September, so a full
        /// install clears it easily and an empty list does not come near it.
        /// </summary>
        public const int MostPluginsWithoutCollection = 40;

        /// <summary>
        /// Read one Vortex state.v2 file as Latin1 text (every byte one char).
        /// Same as Get-VortexStateText in scripts\mods\LoadOrder.ps1.
        /// </summary>
        static string VortexStateText(string path)
        {
            byte[] raw = File.ReadAllBytes(path);
            var sb = new StringBuilder(raw.Length);
            foreach (byte b in raw) sb.Append((char)b);
            return sb.ToString();
        }

        static string VortexStateDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Vortex\\state.v2");
        }

        /// <summary>
        /// Vortex profile folder named <paramref name="name"/> (default Thornswood),
        /// or null. Same as Get-VortexProfileDir (#557).
        /// </summary>
        public static string VortexProfileDir(string name)
        {
            try
            {
                if (string.IsNullOrEmpty(name)) name = "Thornswood";
                string profilesRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Vortex\\skyrimse\\profiles");
                if (!Directory.Exists(profilesRoot)) return null;
                string stateDir = VortexStateDir();
                if (File.Exists(Path.Combine(stateDir, "CURRENT")))
                    return VortexProfileState.Find(stateDir, profilesRoot, name);
                var ids = new HashSet<string>(StringComparer.Ordinal);
                if (Directory.Exists(stateDir))
                {
                    var pairRe = new Regex(
                        "\"profileId\"\\s*:\\s*\"([^\"]+)\"\\s*,\\s*\"profileName\"\\s*:\\s*\"" +
                        Regex.Escape(name) + "\"");
                    var pairRe2 = new Regex(
                        "\"profileName\"\\s*:\\s*\"" + Regex.Escape(name) +
                        "\"\\s*,\\s*\"profileId\"\\s*:\\s*\"([^\"]+)\"");
                    foreach (string f in Directory.GetFiles(stateDir))
                    {
                        string txt;
                        try { txt = VortexStateText(f); } catch { continue; }
                        foreach (Match m in pairRe.Matches(txt)) ids.Add(m.Groups[1].Value);
                        foreach (Match m in pairRe2.Matches(txt)) ids.Add(m.Groups[1].Value);
                    }
                }
                foreach (string id in ids)
                {
                    string p = Path.Combine(profilesRoot, id);
                    if (File.Exists(Path.Combine(p, "plugins.txt"))) return p;
                    if (Directory.Exists(p)) return p;
                }
            }
            catch (Exception ex) { Swallow.Note("Checks.VortexProfileDir", ex); }
            return null;
        }

        public static int EnabledPlugins()
        {
            try
            {
                string p = Path.Combine(Paths.Live, "plugins.txt");
                if (!File.Exists(p)) return 0;
                int n = 0;
                foreach (string line in File.ReadAllLines(p))
                    if (line.StartsWith("*")) n++;
                return n;
            }
            catch { return 0; }
        }

        /// <summary>
        /// Another server's client, sitting in the Steam game's SKSE folder.
        ///
        /// These are not plugins and not mods, so nothing about the plugin list
        /// notices them. Every check on the Play page can be green while Daedric
        /// Online's client draws the main menu and asks somebody to log in to a
        /// server that is not this one, and Skyrim then will not close, so the
        /// launcher cannot update either.
        ///
        /// Vortex does not take them out. It only tracks what it deployed, and
        /// these were dropped in by somebody else's installer, so Purge Mods
        /// leaves them exactly where they are.
        /// </summary>
        ///
        /// NirnLabUIPlugin.dll WAS on this list and must never go back on it.
        /// Listing it here meant every press of Fix deleted the plugin that
        /// drew the whole in game interface on a machine whose
        /// Data\SKSE\Plugins\SkyrimPlatform.ini said BackendName = nirnlab, so
        /// the overlay never booted and nothing put anybody into the creation
        /// hall.
        ///
        /// Which browser backend runs is not decided here, and this note does
        /// not say which one it is. It used to say this build ran on nirnlab;
        /// on 24 Sep the ini on Patrick's machine read BackendName = tilted and
        /// his thornswood-front.log from 23 Sep said "browser backend: tilted".
        /// Chars.WriteBrowserBackend chooses on every Play from what is in the
        /// game folder, and thornswood-front.js asks SkyrimPlatform at startup
        /// and writes the answer to Data\Platform\thornswood-front.log. Those
        /// two are the record. Keeping NirnLab out of Thornswood's own folder
        /// is OwnGame.Foreign's job: it leaves out Data\NirnLabUIPlatform and
        /// NirnLabUIPlugin.dll when the folder is built, the same rule as
        /// Test-ShipOtherServer in scripts\release\Ship-Rules.ps1.
        // Empty since 20 September. It held the file names of another
        // server's client probe, and Thornswood no longer looks for other
        // servers' files at all: its own folder is built from what belongs,
        // and anything else is simply left out. The array stays because Fix
        // walks it; an empty walk is nothing.
        public static readonly string[] ForeignNames = {
        };

        /// <summary>
        /// The rest of another server's client, as exact paths under the game
        /// folder. The two swf files are the other server's main menu, which
        /// is what shows their logo and their sign in box in place of
        /// Skyrim's.
        ///
        /// Data\\NirnLabUIPlatform is deliberately NOT here. See the note on
        /// ForeignNames above: keeping it out of Thornswood's own folder is
        /// OwnGame.Foreign's job when the folder is built, not Fix's.
        ///
        /// Exact paths only. Never a pattern, and never the bare word daedric,
        /// which is a vanilla Skyrim material that names thousands of ordinary
        /// armour, weapon and texture files.
        /// </summary>
        //
        // Data\Interface\startmenu.swf and loadwaitspinner.swf are NOT here any
        // more. From 2026-09-16 Thornswood ships its own copies of both, a main
        // menu with no Bethesda logo and no button list so the backdrop stands
        // alone, and an empty spinner. The pack overwrites another server's copy
        // on the way in, so nothing has to be moved aside, and listing them here
        // would make Fix quarantine our own files on every scan.
        public static readonly string[] ForeignPaths = {
            "Data\\Video\\Interface\\startmenu.swf",
            "Data\\Video\\Interface\\loadwaitspinner.swf",
        };

        /// <summary>What is left behind after something is moved aside, so the
        /// checks do not keep reporting a file that is already disabled.</summary>
        public const string OffSuffix = ".thornswood-off";

        public static string[] ForeignClients()
        {
            var found = new List<string>();
            try
            {
                string dir = Path.Combine(Paths.Game, "Data\\SKSE\\Plugins");
                foreach (string n in ForeignNames)
                {
                    string f = Path.Combine(dir, n);
                    if (File.Exists(f)) found.Add(f);
                }
                foreach (string rel in ForeignPaths)
                {
                    string f = Path.Combine(Paths.Game, rel);
                    if (File.Exists(f) || Directory.Exists(f)) found.Add(f);
                }
            }
            catch (Exception ex) { Swallow.Note("Checks.ForeignClients", ex); }
            return found.ToArray();
        }

        // The ESL flag in a plugin's header. The launcher only reads it: which
        // plugins are light is the collection's to install (#2979), and a copy
        // whose flag is not the server's is Vortex's to put right (#3022).
        const uint LightFlag = 0x200;

        /// <summary>The ESL flag in the TES4 header, or null when the file is
        /// not there, is not a plugin or cannot be read.</summary>
        static bool? HeaderLight(string path)
        {
            try
            {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    var b = new byte[12];
                    if (fs.Read(b, 0, 12) < 12) return null;
                    if (b[0] != (byte)'T' || b[1] != (byte)'E' || b[2] != (byte)'S' || b[3] != (byte)'4') return null;
                    uint flags = BitConverter.ToUInt32(b, 8);
                    return (flags & LightFlag) != 0;
                }
            }
            catch { return null; }
        }

        /// <summary>True when the TES4 header carries the ESL flag. A file that
        /// cannot be read answers true, so nothing is reported for it.</summary>
        static bool IsLight(string path)
        {
            return HeaderLight(path) ?? true;
        }

        /// <summary>The ESL flag of a plugin in Data, or null when it cannot be
        /// read, so a file open elsewhere is never reported either way.</summary>
        public static bool? FlaggedLight(string name)
        {
            return HeaderLight(Path.Combine(Paths.Game, "Data", name));
        }

        /// <summary>
        /// Moves another server's files aside. It never deletes anything.
        ///
        /// Somebody who plays Thornswood may also play another server or
        /// another server, and their install is theirs. Two steps, because the
        /// game can sit on a different drive from the launcher:
        ///
        ///   1. Rename in place with .thornswood-off. Always on the same
        ///      volume, so it always works, and a renamed dll is not loaded by
        ///      the script extender and a renamed swf is not read by Skyrim.
        ///   2. Move the renamed item into Profile\Isolated, best effort. If
        ///      that fails it stays renamed where it is, still disabled.
        ///
        /// Either way restore.txt in the Isolated folder records where each
        /// item came from and where it went, so it can be put back by hand.
        ///
        /// Named files and exact paths only, nothing matched by pattern.
        /// </summary>
        public static int IsolateForeign(Action<string> say)
        {
            int n = 0;
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmm");
            string bin = Path.Combine(Paths.Isolated, stamp);

            foreach (string f in ForeignClients())
            {
                string name = Path.GetFileName(f);
                try
                {
                    string landed = MoveAside(f, bin, stamp);
                    n++;
                    if (say != null)
                        say(name + " belongs to another server. Moved aside to " + landed +
                            ". Nothing was deleted, and it can be put back.");
                }
                catch (Exception ex)
                {
                    if (say != null)
                        say("Could not move " + name + " aside: " + ex.Message +
                            "  Close Skyrim and try again.");
                }
            }
            return n;
        }

        /// <summary>
        /// The two steps IsolateForeign describes, for one file or folder.
        /// Returns where it ended up; throws when even the rename fails.
        /// </summary>
        static string MoveAside(string f, string bin, string stamp)
        {
            bool isDir = Directory.Exists(f);
            string off = f + OffSuffix;
            if (File.Exists(off) || Directory.Exists(off)) off = off + "-" + stamp;

            if (isDir)
            {
                Directory.Move(f, off);
            }
            else
            {
                try { File.SetAttributes(f, FileAttributes.Normal); } catch (Exception ex) { Swallow.Note("Checks.MoveAside, attributes", ex); }
                File.Move(f, off);
            }

            string landed = off;
            try
            {
                Directory.CreateDirectory(bin);
                string dest = Path.Combine(bin, Path.GetFileName(off));
                if (isDir) Directory.Move(off, dest); else File.Move(off, dest);
                landed = dest;
            }
            catch (Exception ex) { Swallow.Note("Checks.MoveAside", ex); }

            NoteIsolated(bin, f, landed);
            return landed;
        }

        static void NoteIsolated(string bin, string from, string to)
        {
            try
            {
                Directory.CreateDirectory(bin);
                File.AppendAllText(Path.Combine(bin, "restore.txt"),
                    DateTime.Now.ToString("s") + "  was: " + from + Environment.NewLine +
                    "                     now: " + to + Environment.NewLine);
            }
            catch (Exception ex) { Swallow.Note("Checks.NoteIsolated", ex); }
        }

        /// <summary>
        /// Creation Club plugins the game will load without being asked, and
        /// that <paramref name="wanted"/>, the reference list, does not name.
        ///
        /// Skyrim.ccc in the game's root lists the Creation Club's plugins, and
        /// the game loads every one of them it finds in Data straight after the
        /// five masters, whatever plugins.txt says. So they are in no plugin
        /// list and every other row of the scan passes them.
        ///
        /// Measured on 19 Sep. Another server's launcher put the free ones back
        /// into Data, Thornswood's folder took them in, and the game loaded two
        /// full masters the server does not have. Every plugin after
        /// Dragonborn.esm was two places off, the game showed LOAD ORDER ERROR,
        /// and this scan said everything checks out.
        /// </summary>
        public static List<string> StrayCreations(ICollection<string> wanted)
        {
            return StrayCreations(wanted, null);
        }

        /// <summary>
        /// StrayCreations, against a server that loads light plugins and
        /// publishes their order (<paramref name="serverLight"/>, #1715). Then
        /// a light one counts too: the game loads it straight after the five
        /// masters, so it takes light index 0 or 1 and every light plugin after
        /// it is one light index off the server's, which moves every stored
        /// light form id. One the server's light order names (_ResourcePack.esl,
        /// its light index 0) is not stray. Null or empty is a server that
        /// counts no light plugin, and the answer is the old one.
        /// </summary>
        public static List<string> StrayCreations(ICollection<string> wanted, ICollection<string> serverLight)
        {
            var l = new List<string>();
            if (wanted == null || wanted.Count == 0) return l;
            bool lightCounts = serverLight != null && serverLight.Count > 0;
            var theirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (lightCounts) foreach (string s in serverLight) if (s != null) theirs.Add(s.Trim());
            try
            {
                string ccc = Path.Combine(Paths.Game, "Skyrim.ccc");
                if (!File.Exists(ccc)) return l;
                string data = Path.Combine(Paths.Game, "Data");
                // Only a plugin that takes a place in the load order counts.
                // A light one loaded this way is no different to the server
                // from the forty odd light plugins in the list itself: the
                // server's list never holds a light plugin, so none of them
                // is "content the server has", and none of those draws a
                // card. Until 20 September _ResourcePack.esl drew one on
                // every machine: Bethesda's own update 1.6.1130 put it and
                // its archive in every Data folder and Skyrim.ccc names it,
                // it is light, and it holds no placed content (statics,
                // textures and four quests, "additional resources for
                // Creations"). A card about a file nobody installed, that
                // changes nothing anyone can touch, was an alarm with no fire.
                foreach (string raw in File.ReadAllLines(ccc))
                {
                    string n = raw.Trim();
                    if (n.Length == 0 || n.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) continue;
                    if (wanted.Contains(n) || l.Contains(n)) continue;
                    if (!File.Exists(Path.Combine(data, n))) continue;
                    if (TakesNoPlace(n) && (!lightCounts || theirs.Contains(n))) continue;
                    l.Add(n);
                }
            }
            catch (Exception ex) { Swallow.Note("Checks.StrayCreations", ex); }
            return l;
        }

        /// <summary>True when a plugin in Data takes no place in the load
        /// order: an .esl, or the ESL flag in its header.</summary>
        public static bool TakesNoPlace(string name)
        {
            if (name.EndsWith(".esl", StringComparison.OrdinalIgnoreCase)) return true;
            return IsLight(Path.Combine(Paths.Game, "Data\\" + name));
        }

        /// <summary>
        /// Moves each of StrayCreations aside, the same two steps as
        /// IsolateForeign, never deleting anything. Steam put these there and
        /// another server may want them, so each one goes into the Isolated
        /// folder with a line in restore.txt saying where it came from.
        /// </summary>
        public static int IsolateCreations(ICollection<string> wanted, Action<string> say)
        {
            return IsolateCreations(wanted, null, say);
        }

        /// <summary>IsolateCreations against a server's light order (StrayCreations).</summary>
        public static int IsolateCreations(ICollection<string> wanted, ICollection<string> serverLight, Action<string> say)
        {
            int n = 0;
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmm");
            string bin = Path.Combine(Paths.Isolated, stamp);
            string data = Path.Combine(Paths.Game, "Data");

            foreach (string name in StrayCreations(wanted, serverLight))
            {
                try
                {
                    string landed = MoveAside(Path.Combine(data, name), bin, stamp);
                    n++;
                    if (say != null)
                        say(name + " is a Creation Club plugin the server does not have. Moved aside to " + landed +
                            ". Nothing was deleted, and it can be put back.");
                }
                catch (Exception ex)
                {
                    if (say != null)
                        say("Could not move " + name + " aside: " + ex.Message +
                            "  Close Skyrim and try again.");
                }
            }
            return n;
        }

        /// <summary>
        /// The SkyMP client bundle. Not MpClientPlugin.dll, which is the SKSE
        /// side: this is the JavaScript that actually dials the server.
        /// </summary>
        public static string ClientBundle
        {
            get { return Path.Combine(Paths.Game, "Data\\Platform\\Plugins\\skymp5-client.js"); }
        }

        // ClientPatched WAS HERE until 24 September: it searched the bundle's
        // text for "THORNSWOOD PATCH" or "Thornswood:" and called any bundle
        // carrying either one ours. Nothing had called it since a4acb90 (#108)
        // moved the Client row to ClientRuntime, which compares all six files
        // with the recorded sha256, and a test that passes because of
        // something we wrote into the file is not a test (To Do entry 128).

        /// <summary>What the Client row says, green or red.</summary>
        /// <remarks>
        /// IT NO LONGER TELLS ANYBODY TO REINSTALL, and that sentence was the
        /// worst part of this row. The remedy used to be chosen from whether
        /// Profile\Keep held a copy, and a fresh install never does, so a
        /// brand new tester was always told to reinstall Thornswood. On
        /// 22 September one of them did, got the same screen, and only got in
        /// after purging Vortex twice, running another server's launcher
        /// repair and logging in to a character there. The installer they
        /// reinstalled from is a suspect in the same fault, so that advice
        /// sent them round the loop it came from.
        ///
        /// The launcher puts it back itself now. See ClientRuntime.Heal, which
        /// takes the recorded files out of the kept copies or out of a pack on
        /// the feed. This row only has to say what is true while that happens.
        /// </remarks>
        public static string ClientDetail()
        {
            try
            {
                // The record is the check now, not a text search for our name.
                // See ClientRuntime for why the old one could not tell you
                // WHICH build you had.
                if (ClientRuntime.Recorded().Count > 0)
                {
                    List<string> missing;
                    List<string> wrong = ClientRuntime.Wrong(out missing);
                    int bad = missing.Count + wrong.Count;
                    if (bad == 0) return "client bundle";
                    string what = (bad == 1)
                        ? Path.GetFileName(missing.Count > 0 ? missing[0] : wrong[0])
                        : bad + " client files";
                    return (missing.Count > 0 && wrong.Count == 0)
                        ? what + " is missing, the launcher will fetch it"
                        : what + " is not this build's, the launcher will replace it";
                }

                // No record embedded. That is a build fault rather than
                // anything wrong with this machine, so it says so plainly and
                // falls back to asking whether the bundle is there at all.
                if (!File.Exists(ClientBundle))
                    return "skymp5-client.js is missing, and this launcher has no client record to fix it from";
            }
            catch { return "client bundle"; }
            return "client bundle";
        }

        /// <summary>
        /// The Client row's few words for the Ready card (#3203), the same
        /// split ClientDetail makes: files that are not there, or files that
        /// are there and are not this build's. Only read when the row fails,
        /// which ClientRuntime.Good says happens only with a record to judge by,
        /// so the files are not read a third time on a pass where it is right.
        /// </summary>
        static string ClientProblem()
        {
            List<string> missing;
            List<string> wrong = ClientRuntime.Wrong(out missing);
            return (missing.Count > 0 && wrong.Count == 0) ? "Client files missing" : "Client files not this build's";
        }

        public static List<Check> All(Config cfg)
        {
            // The game these rows are about. With the own folder chosen and not
            // made yet (#1226) Paths.Game is Profile\Payload, Thornswood's own
            // files only, and the game and the script extender it will be made
            // with are the Steam copy's and Vortex's, so those are read there.
            string game = Paths.OwnFirst ? Paths.SteamCopy : Paths.Game;
            string exe = Path.Combine(game, "SkyrimSE.exe");
            long bytes = 0;
            try { if (File.Exists(exe)) bytes = new FileInfo(exe).Length; } catch (Exception ex) { Swallow.Note("Checks.All, exe size", ex); }
            int plugins = EnabledPlugins();

            var l = new List<Check>();
            l.Add(new Check("Game build", bytes == cfg.ExpectedExeBytes, Downgrade.Describe(cfg, exe))
                  { Problem = File.Exists(exe) ? "Wrong Skyrim build" : "Skyrim not found" });
            l.Add(new Check("Script Extender", File.Exists(Path.Combine(game, "skse64_1_6_1170.dll")), "skse64 2.2.6")
                  { Problem = "Script Extender missing" });
            // Advisory, so it warns and never shuts Play. See AddressLibraryRow.
            l.Add(AddressLibraryRow(game, bytes == cfg.ExpectedExeBytes));
            l.Add(new Check("Multiplayer", File.Exists(Paths.MpClient), "SkyMP client")
                  { Problem = "Multiplayer client missing" });
            // The other half of the client, and the half that connects.
            // See ClientRuntime: every row above this one asks whether a
            // file exists, and a bundle that is present but not ours is
            // what leaves somebody sitting on the backdrop.
            bool client = ClientRuntime.Good();
            l.Add(new Check("Client", client, ClientDetail()) { Problem = client ? null : ClientProblem() });
            // Mods and Mod list share Verify.LastIssues (filled by Scan, Fix,
            // Play, and Diagnostics open) so they cannot disagree with the
            // Scan and Fix card. A fresh Run(cfg) here would freeze the UI on
            // the server round trip every page change; LastIssues is that
            // same Run, remembered. Until the first Run, fall back to a
            // local-only pass so the rows still say something.
            List<Issue> issues;
            if (Verify.LastUsedServer && Verify.LastIssues != null)
                issues = Verify.LastIssues;
            else
            {
                try { issues = Verify.Run(null); }
                catch { issues = new List<Issue>(); }
            }
            l.Add(ModsRow(plugins, issues));
            l.Add(ModListRow(issues));

            string[] foreign = ForeignClients();
            l.Add(new Check("Other servers",
                            foreign.Length == 0,
                            foreign.Length == 0
                                ? "none"
                                : (foreign.Length == 1
                                    ? Path.GetFileName(foreign[0])
                                    : foreign.Length + " client files"))
                  { Problem = "Another server's client found" });

            // The detail said "running" whether Steam was or not, so a red
            // row read "Steam  running" (#3204).
            bool steam = SteamRunning();
            l.Add(new Check(SteamRow, steam, steam ? "running" : "not running") { Problem = "Steam not running" });
            return l;
        }

        /// <summary>
        /// Ready to launch Mods row. Names the plugin files that are in the
        /// list but not in Data (Verify FileMissing), because the Mods page
        /// is gone and "94 plugins" / "1 missing" without names was not enough.
        /// Falls back to the enabled-plugin count when nothing is missing.
        /// </summary>
        static Check ModsRow(int plugins, List<Issue> issues)
        {
            var missing = new List<string>();
            if (issues != null)
            {
                foreach (Issue i in issues)
                {
                    if (!i.FileMissing) continue;
                    string name = i.Plugin;
                    if (string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(i.Text))
                    {
                        int cut = i.Text.IndexOf(' ');
                        if (cut > 0) name = i.Text.Substring(0, cut);
                    }
                    if (string.IsNullOrEmpty(name)) continue;
                    if (!missing.Contains(name)) missing.Add(name);
                }
            }
            if (missing.Count > 0)
                return new Check("Mods", false, MissingDetail(missing))
                       { Problem = missing.Count == 1 ? "1 mod missing" : missing.Count + " mods missing" };
            if (plugins <= MostPluginsWithoutCollection)
                return new Check("Mods", false, plugins + " plugins") { Problem = "Mods not installed" };
            return new Check("Mods", true, plugins + " plugins");
        }

        /// <summary>
        /// Ready to launch Mod list row. Same Issue list as Scan and Fix, so
        /// a green Scan cannot sit next to a red Mod list (or the reverse).
        /// Names the problems; does not say "open Mods" (that page is gone).
        /// </summary>
        static Check ModListRow(List<Issue> issues)
        {
            var blocking = new List<Issue>();
            if (issues != null)
                foreach (Issue i in issues) if (i.Blocking) blocking.Add(i);
            if (blocking.Count == 0)
                return new Check("Mod list", true, "matches the server");
            return new Check("Mod list", false, ProblemDetail(blocking)) { Problem = "Mod list does not match the server" };
        }

        static string MissingDetail(List<string> missing)
        {
            const int show = 3;
            var shown = new List<string>();
            for (int i = 0; i < missing.Count && i < show; i++) shown.Add(missing[i]);
            string names = string.Join(", ", shown.ToArray());
            if (missing.Count == 1) return "1 missing: " + names;
            if (missing.Count <= show) return missing.Count + " missing: " + names;
            return missing.Count + " missing: " + names + " and " + (missing.Count - show) + " more";
        }

        static string ProblemDetail(List<Issue> blocking)
        {
            // Prefer plugin file names when the issue carries them; otherwise
            // the first short clause of the issue text.
            var bits = new List<string>();
            foreach (Issue i in blocking)
            {
                if (bits.Count >= 3) break;
                if (!string.IsNullOrEmpty(i.Plugin)) { bits.Add(i.Plugin); continue; }
                if (string.IsNullOrEmpty(i.Text)) continue;
                string t = i.Text;
                int dot = t.IndexOf('.');
                if (dot > 0 && dot < 80) t = t.Substring(0, dot);
                if (t.Length > 70) t = t.Substring(0, 67) + "...";
                bits.Add(t);
            }
            string joined = string.Join("; ", bits.ToArray());
            if (blocking.Count == 1) return joined;
            if (bits.Count >= blocking.Count) return blocking.Count + " problems: " + joined;
            return blocking.Count + " problems: " + joined + " and more";
        }

        /// <summary>
        /// The Steam row's name. Shell finds the row by it to show the Open
        /// Steam button and to know what the card last said about Steam.
        /// </summary>
        public const string SteamRow = "Steam";

        public static bool SteamRunning()
        {
            try { return Process.GetProcessesByName("steam").Length > 0; }
            catch { return false; }
        }

        /// <summary>
        /// SteamRunning for the launcher's two second tick, which redraws the
        /// Ready card when Steam starts or closes (#3204). The rows were drawn
        /// on a page change, a scan or a recheck and at no other time, so
        /// Steam closed after that still read "running", and Steam started by
        /// the Open Steam button or by hand left "Steam not running" up until
        /// somebody changed page. Asks the steam.exe the last look found
        /// whether it is still up, by the handle it already has, and lists
        /// the machine's processes again only once it is not, the way
        /// GameStillRunning does for the game (#978). Called from the
        /// window's thread only.
        /// </summary>
        public static bool SteamStillRunning()
        {
            return steamUp.Any();
        }

        static bool steamAskRefused;

        static readonly Watched<Process> steamUp = new Watched<Process>(
            SteamProcesses,
            delegate (Process p)
            {
                // One that cannot be asked is not provably up, so the watch
                // looks again. Said once a session, as GameStillRunning does.
                try { return !p.HasExited; }
                catch (Exception ex)
                {
                    if (!steamAskRefused) { steamAskRefused = true; Swallow.Note("Checks.SteamStillRunning, has exited", ex); }
                    return false;
                }
            },
            delegate (Process p)
            {
                try { p.Dispose(); } catch (Exception ex) { Swallow.Note("Checks.SteamStillRunning, dispose", ex); }
            });

        /// <summary>Every steam.exe running now. The watch above owns what comes back.</summary>
        static List<Process> SteamProcesses()
        {
            try { return new List<Process>(Process.GetProcessesByName("steam")); }
            catch (Exception ex) { Swallow.Note("Checks.SteamProcesses", ex); return new List<Process>(); }
        }

        /// <summary>
        /// Which Skyrim last ran, read back from the script extender's own log.
        /// Empty until the game has been started at least once.
        ///
        /// Worth knowing because the multiplayer client will happily start a
        /// different copy of Skyrim than the one it is sitting in, and when it
        /// does, nothing about this build applies and nothing says so.
        /// </summary>
        public static string LastRunFrom()
        {
            const string key = "plugin directory =";
            const string tail = "\\Data\\SKSE\\Plugins";
            try
            {
                string log = Path.Combine(Paths.LiveMyGames, "SKSE\\skse64.log");
                if (!File.Exists(log)) return "";
                foreach (string line in File.ReadAllLines(log))
                {
                    int at = line.IndexOf(key, StringComparison.OrdinalIgnoreCase);
                    if (at < 0) continue;
                    string p = line.Substring(at + key.Length).Trim();
                    int cut = p.IndexOf(tail, StringComparison.OrdinalIgnoreCase);
                    return (cut > 0 ? p.Substring(0, cut) : p).TrimEnd('\\');
                }
            }
            catch (Exception ex) { Swallow.Note("Checks.LastRunFrom", ex); }
            return "";
        }

        /// <summary>False only when we know for certain it ran somewhere else.</summary>
        public static bool RanFromBuild()
        {
            string from = LastRunFrom();
            if (from.Length == 0) return true;
            return string.Equals(from, Paths.Game.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// True only while Skyrim itself is up, or something it left behind in
        /// this build's folder is still holding files open.
        /// </summary>
        public static bool GameRunning()
        {
            List<Process> ps = GameProcesses();
            int n = ps.Count;
            Release(ps);
            return n > 0;
        }

        /// <summary>
        /// GameRunning for the launcher's two second tick while the game runs.
        /// Asks the processes the last look found whether they are still up,
        /// by the handle each already has, and lists the machine's processes
        /// again only once none of them is (#978). See Watched. Called from
        /// the window's thread only.
        /// </summary>
        public static bool GameStillRunning()
        {
            return inPlay.Any();
        }

        static bool stillAskRefused;

        static readonly Watched<Process> inPlay = new Watched<Process>(
            GameProcesses,
            delegate (Process p)
            {
                // A process that cannot be asked (access refused) is not
                // provably up, so the watch looks again, as GameRunning would.
                // Said once a session: a game run as administrator refuses
                // every tick, and one line says it as well as a thousand.
                try { return !p.HasExited; }
                catch (Exception ex)
                {
                    if (!stillAskRefused) { stillAskRefused = true; Swallow.Note("Checks.GameStillRunning, has exited", ex); }
                    return false;
                }
            },
            delegate (Process p)
            {
                try { p.Dispose(); } catch (Exception ex) { Swallow.Note("Checks.GameStillRunning, dispose", ex); }
            });

        /// <summary>
        /// The in game browser's helpers. Each one is started by Skyrim and
        /// usually dies with it, but after a crash they stay behind with no
        /// window, holding Data\Platform and Data\NirnLabUIPlatform open. Task
        /// Manager's Processes tab files them under background processes with
        /// no Skyrim name on them, so they are one way "Skyrim is running" can
        /// be true with nothing on screen that looks like Skyrim (reported on
        /// 16 Sep). Counted only when they run out of this build's folder.
        /// </summary>
        static readonly string[] Helpers = { "CEFSubprocess", "SkyrimPlatformCEF" };

        /// <summary>
        /// Everything currently running that counts as the game. The caller owns
        /// what comes back and should pass it to Release when finished.
        ///
        /// The launcher's own name is not on the list any more. It was there
        /// from the old multiplayer mod's days, when its client was an exe of
        /// the launcher's old name; SkyMP has no client exe. Left on, another copy of this
        /// launcher (the dev build beside the main one) counted as a running
        /// game, which blocked updates and deleting characters, and Clear then
        /// tried to close that launcher.
        /// </summary>
        public static List<Process> GameProcesses()
        {
            var l = new List<Process>();
            int mine = Process.GetCurrentProcess().Id;

            var names = new List<string> { "SkyrimSE", "skse64_loader" };
            names.AddRange(Helpers);

            // One list of the machine's processes, not one per name. Each
            // GetProcessesByName lists them all and keeps the matches, so
            // asking for four names was four lists (#978).
            Process[] all;
            try { all = Process.GetProcesses(); }
            catch (Exception ex) { Swallow.Note("Checks.GameProcesses, list", ex); return l; }
            var byName = new Dictionary<string, List<Process>>(StringComparer.OrdinalIgnoreCase);
            foreach (string n in names) byName[n] = new List<Process>();
            foreach (Process p in all)
            {
                string pn = null;
                try { pn = p.ProcessName; } catch (Exception ex) { Swallow.Note("Checks.GameProcesses, name", ex); }
                List<Process> into;
                if (pn != null && byName.TryGetValue(pn, out into)) into.Add(p);
                else { try { p.Dispose(); } catch (Exception ex) { Swallow.Note("Checks.GameProcesses, dispose other", ex); } }
            }

            foreach (string n in names)
            {
                bool helper = Array.IndexOf(Helpers, n) >= 0;
                foreach (Process p in byName[n])
                {
                    bool skip = p.Id == mine;
                    // A helper only counts when it provably runs from this
                    // build. One from another folder is another server's.
                    if (!skip && helper && Where(p) != true) skip = true;
                    // SkyrimSE.exe is what every Skyrim install on the machine
                    // is called. Matching the name alone meant another modlist's
                    // game counted as this one: Play stayed blocked while it was
                    // up, and Clear would try to kill somebody else's session
                    // and then tell them to restart the PC when it could not.
                    //
                    // Only skip it when the path says, in as many words, that it
                    // lives somewhere else. A path we cannot read is the state a
                    // game that has already fallen over is usually in, and those
                    // are exactly the ones that need closing: one of them left
                    // holding the profile folder is what makes the next launch
                    // fail with access denied.
                    //
                    // But a path we cannot read is also every process of another
                    // Windows account. The build runners on the box are eight
                    // accounts, and one runner's stand-in Skyrim made another
                    // runner's Scan see a running game (#2856). So an unreadable
                    // one counts only while this build's own file of that name is
                    // running, which is told from the folder's side and needs no
                    // access to the process. A game of ours that fell over but is
                    // still there still has that file open, so it still counts.
                    if (!skip)
                    {
                        bool? at = Where(p);
                        if (at == false || (at == null && !OwnImageRunning(n))) skip = true;
                    }
                    if (skip) { try { p.Dispose(); } catch (Exception ex) { Swallow.Note("Checks.GameProcesses, dispose", ex); } }
                    else l.Add(p);
                }
            }
            return l;
        }

        /// <summary>
        /// False only when this build's own Game\name.exe is provably not
        /// running, told from the folder's side: Windows will not open a
        /// running program's file for writing, which is how the scripts tell
        /// the same thing (#2233, #2412). Needs no access to the process, so it
        /// answers for a game whose path cannot be read. A file that is gone is
        /// not running. A file that is there and cannot be opened for writing
        /// is running, or says nothing either way, and then the game counts, as
        /// every unreadable one did before #2856.
        /// </summary>
        static bool OwnImageRunning(string name)
        {
            if (string.IsNullOrEmpty(Paths.Game)) return false;
            string path = Path.Combine(Paths.Game, name + ".exe");
            try
            {
                if (!File.Exists(path)) return false;
                using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite)) { }
                return false;
            }
            catch (FileNotFoundException) { return false; }
            catch (DirectoryNotFoundException) { return false; }
            catch (IOException) { return true; }
            catch (UnauthorizedAccessException) { return true; }
            catch (Exception ex) { Swallow.Note("Checks.OwnImageRunning", ex); return true; }
        }

        static void Release(List<Process> ps)
        {
            foreach (Process p in ps) { try { p.Dispose(); } catch (Exception ex) { Swallow.Note("Checks.Release, dispose", ex); } }
        }

        /// <summary>
        /// True when at least one of them has a window on screen, which is the
        /// difference between a game somebody is playing and the leftovers of
        /// one that crashed. Skyrim does not always exit cleanly, and the
        /// multiplayer client's browser helpers outlive it more often than not,
        /// so a process with no window is the common case, not the odd one.
        /// </summary>
        public static bool GameVisible()
        {
            List<Process> ps = GameProcesses();
            bool seen = false;
            foreach (Process p in ps)
            {
                try { if (p.MainWindowHandle != IntPtr.Zero) { seen = true; break; } }
                catch (Exception ex) { Swallow.Note("Checks.GameVisible", ex); }
            }
            Release(ps);
            return seen;
        }

        /// <summary>
        /// Closes everything GameProcesses found and waits for it to actually
        /// go. Anything with a window is asked first and given six seconds;
        /// anything without one never had a window to ask, so it is ended
        /// straight away. Returns how many were closed.
        /// </summary>
        public static int CloseGame()
        {
            List<Process> ps = GameProcesses();
            if (ps.Count == 0) return 0;
            int count = ps.Count;

            bool asked = false;
            foreach (Process p in ps)
            {
                try
                {
                    if (p.MainWindowHandle == IntPtr.Zero) continue;
                    p.CloseMainWindow();
                    asked = true;
                }
                catch (Exception ex) { Swallow.Note("Checks.CloseGame, close", ex); }
            }

            if (asked)
            {
                for (int i = 0; i < 24; i++)
                {
                    Thread.Sleep(250);
                    bool any = false;
                    foreach (Process p in ps) { try { if (!p.HasExited) any = true; } catch (Exception ex) { Swallow.Note("Checks.CloseGame, has exited", ex); } }
                    if (!any) break;
                }
            }

            foreach (Process p in ps) { try { if (!p.HasExited) p.Kill(); } catch (Exception ex) { Swallow.Note("Checks.CloseGame, kill", ex); } }
            Release(ps);

            // A process that has been ended can sit in the table for a moment
            // afterwards, so this waits for it to leave rather than reporting a
            // failure on the first look.
            for (int i = 0; i < 12; i++)
            {
                Thread.Sleep(250);
                if (!GameRunning()) break;
            }
            return count;
        }

        /// <summary>
        /// What is still running and why it might not go, as a sentence for a
        /// person to act on. "Skyrim would not close. Restart your PC" named
        /// nothing, and with no Skyrim window anywhere nobody could tell what
        /// the launcher was looking at. Empty when nothing is running.
        /// </summary>
        public static string StuckReport()
        {
            List<Process> ps = GameProcesses();
            if (ps.Count == 0) { Release(ps); return ""; }
            var names = new List<string>();
            foreach (Process p in ps)
            {
                try { names.Add(p.ProcessName + ".exe (process " + p.Id + ")"); } catch (Exception ex) { Swallow.Note("Checks.StuckReport, name", ex); }
            }
            Release(ps);

            // Windows writes a crash report for a game that hung, and the game
            // cannot be ended until that report is finished. With a big mod
            // list the report is a memory dump of several gigabytes.
            bool reporting = false;
            foreach (string n in new string[] { "WerFault", "WerFaultSecure" })
            {
                try
                {
                    Process[] w = Process.GetProcessesByName(n);
                    if (w.Length > 0) reporting = true;
                    foreach (Process x in w) { try { x.Dispose(); } catch (Exception ex) { Swallow.Note("Checks.StuckReport, dispose", ex); } }
                }
                catch (Exception ex) { Swallow.Note("Checks.StuckReport", ex); }
            }

            string said = "Still running: " + string.Join(", ", names.ToArray()) + ".";
            if (reporting)
                said += " Windows is still writing a crash report for it, and it cannot be ended until that finishes. That usually takes a few minutes.";
            else
                said += " Windows would not let the launcher end it. In Task Manager, open the Details tab, end it there, and try again. If it will not end there either, restart the PC.";
            return said;
        }

        /// <summary>
        /// True when the process is running out of this build's folder, false
        /// when it is positively somewhere else, and null when the path cannot
        /// be read at all. The three answers are not the same and the caller
        /// has to tell them apart: treating "cannot read" as "somebody else's"
        /// leaves a crashed game running, and a crashed game still holding the
        /// profile folder is what breaks the next launch.
        /// </summary>
        // Asking a hung process for its own path is allowed to take forever,
        // and this is read from the UI thread on every redraw, so one wedged
        // Skyrim froze the entire launcher. It gets one bounded attempt per
        // process and the answer is kept, so a stuck game costs a second and
        // a half once instead of the window every time it is drawn.
        static readonly Dictionary<int, string> pathCache = new Dictionary<int, string>();

        static string PathOf(Process p)
        {
            int id;
            try { id = p.Id; } catch { return null; }
            lock (pathCache)
            {
                string had;
                if (pathCache.TryGetValue(id, out had)) return had;
            }

            string got = null;
            try
            {
                var t = new Thread(delegate() { try { got = p.MainModule.FileName; } catch (Exception ex) { Swallow.Note("Checks.PathOf, MainModule", ex); } });
                t.IsBackground = true;
                t.Start();
                if (!t.Join(1500)) got = null;
            }
            catch { got = null; }

            lock (pathCache)
            {
                if (pathCache.Count > 256) pathCache.Clear();
                pathCache[id] = got;
            }
            return got;
        }

        static bool? Where(Process p)
        {
            string path = PathOf(p);
            if (string.IsNullOrEmpty(path)) return null;
            try
            {
                string full = Path.GetFullPath(path);

                // Two roots, not one. This tested Paths.Root alone, which is
                // right for an install that built its own copy of the game
                // underneath it, and wrong for every collection install: the
                // game runs out of the Steam folder, which is nowhere near
                // Root, so the running Skyrim was judged to be somebody else's.
                //
                // Everything downstream then went wrong at once. GameRunning
                // said no while the game was plainly on screen, Close Skyrim
                // closed nothing and reported nothing to close, the update
                // refused to start because it could not clear a game it could
                // not see, and the only thing that did fire was the warning
                // about a different Skyrim running from another folder.
                //
                // The launcher lives under Root. The game lives under
                // Paths.Game, which is Root\Game in an old install and the
                // Steam copy in a collection one. Either counts as ours.
                foreach (string r in new string[] { Paths.Root, Paths.Game })
                {
                    if (string.IsNullOrEmpty(r)) continue;
                    string root = Path.GetFullPath(r).TrimEnd('\\') + "\\";
                    if (root.Length < 4) continue;
                    if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return true;
                }
                return false;
            }
            catch { return null; }
        }

        /// <summary>
        /// A Skyrim that is not this one. Two at once is a losing fight with
        /// Steam whoever started them, so it is worth saying, but it is not
        /// ours to close.
        /// </summary>
        public static bool OtherSkyrimRunning()
        {
            string[] names = { "SkyrimSE", "skse64_loader" };
            foreach (string n in names)
            {
                Process[] found;
                try { found = Process.GetProcessesByName(n); } catch { continue; }
                foreach (Process p in found)
                {
                    // Only a path we could actually read counts as somebody
                    // else's game. One we cannot read is ours while this
                    // build's own file of that name runs (GameProcesses), and
                    // otherwise another Windows account's (#2856), which runs
                    // under that account's Steam, not this player's.
                    bool foreign = Where(p) == false;
                    try { p.Dispose(); } catch (Exception ex) { Swallow.Note("Checks.OtherSkyrimRunning, dispose", ex); }
                    if (foreign) return true;
                }
            }
            return false;
        }
    }
}
