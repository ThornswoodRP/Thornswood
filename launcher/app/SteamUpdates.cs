using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// Steam's Updates setting for Skyrim: read on every start so the log says
    /// what it is, and set to "Wait until I launch the game" by the launcher
    /// itself, with Steam closed (see "SO THE LAUNCHER WRITES THE SETTING
    /// ITSELF" below).
    ///
    /// Why it matters. The downgrade puts the 1.6.1170 files in place, but
    /// Steam still believes the game is on the newest build, and unless the
    /// setting tells it to wait for a launch, the next Skyrim update Steam
    /// takes by itself undoes the whole downgrade with nobody pressing
    /// anything. Until this, the only protection was a line in the log asking
    /// people not to start Skyrim through Steam.
    ///
    /// The setting lives in Steam's own file for the game,
    /// steamapps\appmanifest_489830.acf in the library that holds Skyrim, as
    /// "AutoUpdateBehavior". In Steam it is the Automatic Updates list on the
    /// game's Properties, Updates page: 0 is "Use global setting" (whatever
    /// Settings, Downloads says for every game), 1 is "Wait until I launch the
    /// game", 2 is "Immediately download updates", 3 is "Let Steam decide when
    /// to update". 1 is what picking "Wait until I launch the game" writes, and
    /// what every downgrade guide sets. It is a mitigation, not a lock: Steam
    /// still updates the game when it is started from Steam, which is what the
    /// downgrade's last log line already asks people not to do.
    ///
    /// Those names and numbers are read off the installed Steam, not from
    /// memory, because Steam has renamed them. The first version of this class
    /// told people to pick "Only update this game when I launch it", and a
    /// review found that no such choice is in Steam any more. On Patrick's
    /// machine on 24 September, steamui\localization\steamui_english-json.js
    /// (8 August) holds the four names above, neither old name is anywhere
    /// under steamui or resource, and the UI bundle, steamui\chunk~2dcc5aaf7.js,
    /// gives use global 0, wait for launch 1, immediately 2 and let Steam
    /// decide 3. test-steam-updates.ps1 checks the names and numbers against
    /// the installed Steam wherever there is one.
    ///
    /// Measured on Patrick's machine on 24 September, read only: the file is
    /// 1156 bytes of Valve's KeyValues text, tab separated, LF line endings,
    /// with "AutoUpdateBehavior" "0". It also carries the ReadOnly attribute,
    /// the only one of twenty manifests there that does, which is what some
    /// downgrade guides tell people to do. Steam was running at the time.
    ///
    /// READ ONLY IS NOT HOW THE VERSION IS HELD (issue #493). Steam keeps
    /// this file up to date with the game's state and writes it every few
    /// seconds while it runs; a read-only file makes every one of those
    /// writes fail. On Patrick's machine on 29 September Steam's
    /// logs\content_log.txt held 11,568 lines of "Failed to write app state
    /// file ... appmanifest_489830.acf (1156 bytes)", one every six seconds,
    /// and nothing else Steam logs about Skyrim is findable among them. The
    /// mark went on by hand or by another program on 10 September, before
    /// any of this repository's tooling existed (nothing in its history sets
    /// it). Until #493 Hold then put it back after every write, so the
    /// launcher kept it there. The version is held by the setting above,
    /// which is Steam's own way to hold it and survives Steam's writes, and
    /// by starting Skyrim from the launcher. So Hold takes the mark off, and
    /// the start line says when a file has it and how to take it off by hand.
    ///
    /// WHAT THE MARK WAS GUARDING, measured on Patrick's machine on
    /// 29 September, read only, when he asked whether it should stay read only
    /// so Steam does not update the game:
    ///   - Thornswood does not run the Steam copy. It runs Thornswood\Game
    ///     (OwnGame), and that folder's SkyrimSE.exe, masters and every file
    ///     in the game's root are its own copies: fsutil gives them other file
    ///     ids than the Steam copy's. Of the Steam copy's files in the root and
    ///     in Data, 27 share a file with Thornswood's folder, and the only ones
    ///     that are the game's own are five archives (_ResourcePack.bsa and
    ///     four Creation Club ones); the rest are mods Vortex deployed.
    ///   - Steam never writes an update into a file in place. It builds each
    ///     changed file whole under steamapps\downloading\<app> and then moves
    ///     it into the game folder: content_log.txt on 25 September has
    ///     Echoes of Aincrad stage 8,850,941,379 bytes and "starting commit
    ///     from ...\downloading\2244210 ... 10 updated" finish in the same
    ///     second, which only a move can do. A move puts a new file under the
    ///     Steam copy's name and leaves the file Thornswood's folder links to
    ///     as it was. So a Steam update cannot reach the game Thornswood runs,
    ///     and Play still checks that folder's exe (Checks "Game build").
    ///   - What an update cost was the Steam copy: Thornswood's folder was
    ///     brought up to date from it, OwnGame.WhyNot refused while it was on
    ///     another build, and the Downgrade had to be run again. Since #1218 a
    ///     folder that is made takes nothing but Vortex's files and never
    ///     reads the Steam copy's game, so an update costs it nothing. The
    ///     setting still saves a download before the folder is made, when
    ///     the folder is made from the Steam copy only if that copy is on
    ///     1.6.1170.
    ///   - The mark itself was never put to the test. Steam's file says it
    ///     holds build 24914197, taken on 10 September 11:06 (lastupdated),
    ///     two hours before the mark went on, and neither content log has an
    ///     "Update Required" for 489830: there has been no newer Skyrim since.
    ///     What it did do is 43,739 "Failed to write app state file" lines in
    ///     the two logs, and it would stop Steam saving this very setting if it
    ///     were changed on Steam's Properties page.
    ///
    /// SO THE LAUNCHER WRITES THE SETTING ITSELF (Patrick on #493, 29 Sep:
    /// "Our Repo should write this so it doesn't auto update the game and
    /// people have to re do the downgrade again"). At every start until
    /// Thornswood's own folder is made (LooksAtStart, #1226), while the
    /// Steam copy is on the build the server runs and the file is not on 1 or
    /// carries the mark (OnStart): with Steam closed it is written there and
    /// then, with nothing to ask; with Steam open, a question whose Yes closes
    /// Steam, writes it, and starts Steam again, and a No that is remembered.
    /// It no longer follows a downgrade: the downgrade does not write the
    /// Steam copy any more (#1218), so there is nothing there to hold.
    ///
    /// So the write:
    ///   - never while Steam is running. Steam keeps the setting in memory and
    ///     writes its own copy of the file when it closes, which undoes an edit
    ///     made underneath it without a sign;
    ///   - changes the bytes of that one value and nothing else, read and
    ///     written byte for byte, because a manifest Steam cannot parse is a
    ///     much worse failure than an unwanted update. Anything not laid out
    ///     the way Steam writes it is left alone;
    ///   - goes through a temporary file, flushed to the disk and renamed over
    ///     the manifest in one call (MoveFileEx, MOVEFILE_REPLACE_EXISTING), so
    ///     the manifest is the old one or the new one whole and never missing.
    ///     Not File.Replace (#2591): it moves the old manifest aside first, so
    ///     a launcher stopped inside it left no manifest at all, which Steam
    ///     reads as Skyrim not being installed. Measured 16 Oct on One: a
    ///     writer swapping a 17 KB file that way, killed 150 times, left it
    ///     missing 6 times; through MoveFileEx, whole all 150
    ///     (tests\test-2591-whole-records.ps1);
    ///   - leaves the file writable, so Steam can keep saving the game's
    ///     state in it (above). A file already on 1 that is only read only has
    ///     just the mark taken off, its bytes untouched.
    /// </summary>
    static partial class SteamUpdates
    {
        const string AppId = "489830";
        public const string Key = "AutoUpdateBehavior";
        public const string OnLaunchOnly = "1";
        /// <summary>What Steam's Automatic Updates list calls 1, word for word.</summary>
        public const string OnLaunchWords = "Wait until I launch the game";

        /// <summary>The same change made by hand, for every message that leaves the file alone.</summary>
        public const string How =
            "To change it in Steam yourself: right click The Elder Scrolls V: Skyrim Special Edition in the library, Properties, Updates, and under Automatic Updates pick \"" + OnLaunchWords + "\".";

        /// <summary>The read-only mark taken off by hand, for the start line when the file has it.</summary>
        public static string Writable(string manifest)
        {
            return "Steam's file for Skyrim, " + manifest + ", is marked read only, so Steam cannot save Skyrim's state in it and logs \"Failed to write app state file\" every few seconds. " +
                   "The Updates setting is what keeps Skyrim on 1.6.1170, so the file does not need the mark. To take it off: exit Steam from its own menu (Steam, Exit), " +
                   "right click that file in File Explorer, Properties, clear Read-only, OK, then start Steam again.";
        }

        // Every byte maps to one char and back, so whatever else is in the
        // file, a UTF-8 path or a byte order mark, is written back exactly as
        // it was read. Everything this class looks for is plain ASCII.
        static readonly Encoding Bytes = Encoding.GetEncoding(28591);

        /// <summary>
        /// Steam's file for the Skyrim in <paramref name="skyrimFolder"/>, or ""
        /// when that folder is not a Steam library's steamapps\common\... folder,
        /// which is the case for a copy of the game the launcher made itself.
        /// Taken from the folder rather than from Steam's own install path,
        /// because a second drive's library keeps its own steamapps.
        /// </summary>
        public static string ManifestFor(string skyrimFolder)
        {
            try
            {
                if (string.IsNullOrEmpty(skyrimFolder)) return "";
                DirectoryInfo game = new DirectoryInfo(skyrimFolder.TrimEnd('\\', '/'));
                DirectoryInfo common = game.Parent;
                if (common == null || !string.Equals(common.Name, "common", StringComparison.OrdinalIgnoreCase)) return "";
                DirectoryInfo steamapps = common.Parent;
                if (steamapps == null || !string.Equals(steamapps.Name, "steamapps", StringComparison.OrdinalIgnoreCase)) return "";
                return Path.Combine(steamapps.FullName, "appmanifest_" + AppId + ".acf");
            }
            catch { return ""; }
        }

        /// <summary>
        /// Steam's own words for a value, as the Automatic Updates list on the
        /// game's Properties, Updates page shows them. A number that is not one
        /// of Steam's four comes back as the number, so the log never names a
        /// choice Steam does not have.
        /// </summary>
        public static string Setting(string value)
        {
            if (value == OnLaunchOnly) return OnLaunchWords;
            if (value == "2") return "Immediately download updates";
            if (value == "3") return "Let Steam decide when to update";
            // 0, and no key at all, which is taken as 0.
            if (string.IsNullOrEmpty(value) || value == "0") return "Use global setting";
            return "AutoUpdateBehavior " + value;
        }

        /// <summary>
        /// The top level AutoUpdateBehavior in a manifest's text: its value, ""
        /// when the key is not there, or null when the text is not a manifest
        /// laid out the way Steam writes one.
        /// </summary>
        public static string Value(string text)
        {
            List<Token> t = Tokens(text);
            if (t == null) return null;
            List<int> found = new List<int>();
            int close;
            if (!Walk(text, t, found, out close)) return null;
            if (found.Count == 0) return "";
            Token v = t[found[0]];
            return text.Substring(v.Start, v.End - v.Start);
        }

        /// <summary>
        /// The same text with the top level AutoUpdateBehavior set to 1, or null
        /// when it is not something to write into. Only the characters of the
        /// value change. When the key is not there at all, it goes in on a line
        /// of its own just above the closing brace, tab indented and separated
        /// like every other line Steam writes, with the file's own line ending.
        /// Already 1 comes back unchanged.
        /// </summary>
        public static string Held(string text)
        {
            List<Token> t = Tokens(text);
            if (t == null) return null;
            List<int> found = new List<int>();
            int close;
            if (!Walk(text, t, found, out close)) return null;

            if (found.Count > 0)
            {
                // From the end, so the earlier positions still hold.
                StringBuilder sb = new StringBuilder(text);
                for (int j = found.Count - 1; j >= 0; j--)
                {
                    Token v = t[found[j]];
                    sb.Remove(v.Start, v.End - v.Start);
                    sb.Insert(v.Start, OnLaunchOnly);
                }
                string after = sb.ToString();
                return after == text ? text : after;
            }

            // The closing brace has to be alone on its line, as Steam writes it.
            // Anything else is a shape this has never seen, and it is left alone.
            int lineStart = text.LastIndexOf('\n', close) + 1;
            if (lineStart == 0) return null;
            for (int j = lineStart; j < close; j++)
                if (text[j] != ' ' && text[j] != '\t') return null;
            string nl = text.IndexOf("\r\n", StringComparison.Ordinal) >= 0 ? "\r\n" : "\n";
            return text.Substring(0, lineStart) + "\t\"" + Key + "\"\t\t\"" + OnLaunchOnly + "\"" + nl + text.Substring(lineStart);
        }

        /// <summary>The value in the file, "" when the key is absent, null when it cannot be read or is not a manifest.</summary>
        public static string Read(string manifest)
        {
            try
            {
                if (string.IsNullOrEmpty(manifest) || !File.Exists(manifest)) return null;
                return Value(Bytes.GetString(File.ReadAllBytes(manifest)));
            }
            catch { return null; }
        }

        /// <summary>
        /// One line for the log on every start, so somebody who changed the
        /// setting in Steam can see it took, and somebody who has not is told
        /// what it will do. Null when there is no Steam file for this Skyrim or
        /// it cannot be read. Reads only.
        /// </summary>
        public static string Report(string skyrimFolder)
        {
            string manifest = ManifestFor(skyrimFolder);
            string v = Read(manifest);
            if (v == null) return null;
            string mark = IsReadOnly(manifest) ? " " + Writable(manifest) : "";
            if (v == OnLaunchOnly)
                return "Steam's Updates setting for Skyrim is \"" + Setting(v) + "\", so Steam leaves it on 1.6.1170 unless Skyrim is started from Steam." + mark;
            return "Steam's Updates setting for Skyrim is \"" + Setting(v) + "\", so Steam can update it by itself. Thornswood's own game folder keeps its own 1.6.1170 files whatever Steam does, but until that folder is made, an update means the Downgrade button downloading 1.6.1170's files first. " + How + mark;
        }

        /// <summary>True when the file carries the ReadOnly attribute. False when it is not there or cannot be read.</summary>
        public static bool IsReadOnly(string manifest)
        {
            try
            {
                if (string.IsNullOrEmpty(manifest) || !File.Exists(manifest)) return false;
                return (File.GetAttributes(manifest) & FileAttributes.ReadOnly) != 0;
            }
            catch { return false; }
        }

        /// <summary>
        /// True when the file is there, readable, and either not already on 1
        /// or marked read only (issue #493). What the start and the question
        /// are asked on.
        /// </summary>
        public static bool NeedsHolding(string manifest)
        {
            string v = Read(manifest);
            return v != null && (v != OnLaunchOnly || IsReadOnly(manifest));
        }

        /// <summary>What the launcher does on the way in, from OnStart.</summary>
        public const string Nothing = "nothing", Write = "write", Ask = "ask";

        /// <summary>
        /// Whether the launcher looks at Steam's Updates setting for Skyrim at
        /// all on the way in: only while the install has no folder of its own
        /// and no downgrade is needed first.
        ///
        /// Patrick, 29 Sep (#1226): the launcher sets "Wait until I launch the
        /// game" only before the own folder is made; after that "people's
        /// Steam copy is theirs to update however they like". Before the folder
        /// exists it is made from the Steam copy's game, so a Steam update then
        /// costs a whole Downgrade; once it exists the folder holds the game
        /// itself (#1218) and an update to the Steam copy costs Thornswood
        /// nothing, so neither the setting nor a line about it is Thornswood's
        /// business any more. <paramref name="ownFolder"/> is true once the game
        /// runs from a folder of its own (Paths.Collection false).
        /// </summary>
        public static bool LooksAtStart(bool ownFolder, bool downgradeNeeded)
        {
            return !ownFolder && !downgradeNeeded;
        }

        /// <summary>
        /// What the launcher does with the file on the way in. Nothing when it
        /// is already held (or cannot be read). Write, with no question, when
        /// Steam is closed: it is Steam's own setting, one value, the one
        /// Patrick asked the launcher to write, and nothing is running to undo
        /// it. Otherwise it needs Steam closed, which is the person's to agree
        /// to: Ask, unless Skyrim is running (closing Steam under the game),
        /// and then Nothing, with the start line saying how to do it by hand.
        ///
        /// Patrick, 27 Oct (#3600): always hold. Nothing about the person's
        /// answer goes in here, because No to the question only ever means
        /// "do not close Steam now": the setting is still written at the next
        /// start with Steam closed, and the question is put again at the next
        /// start with Steam open. The question says both before No is pressed
        /// (Question, NotNow). Until then a No was remembered and stopped the
        /// question, while a start with Steam closed wrote the setting anyway,
        /// against the question's "No leaves it as it is".
        /// </summary>
        public static string OnStart(bool needsHolding, bool steamRunning, bool gameRunning)
        {
            if (!needsHolding) return Nothing;
            if (!steamRunning) return Write;
            if (gameRunning) return Nothing;
            return Ask;
        }

        /// <summary>
        /// What No to the question means, said the same way in the question
        /// and in the log line after it (#3600).
        /// </summary>
        public const string NotNow =
            "No means not now: Steam stays open and nothing is changed yet. The launcher makes the change by itself the next time it starts while Steam is closed, and asks again the next time it starts while Steam is open.";

        /// <summary>
        /// Said when Steam was asked to exit after Yes and is still there a
        /// minute later. The exit request cannot be taken back, so the
        /// launcher keeps waiting for Steam to go, then makes the change and
        /// starts Steam again, as Yes said (#3600). Only a launcher closed in
        /// the meantime can leave Steam closed, and this says so.
        /// </summary>
        public const string StillClosing =
            "Steam was asked to close and is still running a minute later. Once it closes, the launcher changes its Updates setting for Skyrim and starts Steam again. " +
            "If the launcher is closed before that and Steam then closes, start Steam yourself; the launcher makes the change the next time it starts while Steam is closed.";

        /// <summary>
        /// The question, for the file as it is now, put only while Steam is
        /// open (with Steam closed the start writes it with nothing to ask).
        /// Says what the change is and where, that Steam has to be closed for
        /// it because Steam writes its own copy back when it closes and would
        /// undo a change made under it, that Yes closes Steam, makes the change
        /// and starts it again, and what No means (NotNow, #3600).
        /// </summary>
        public static string Question(string manifest)
        {
            const string close =
                "Steam has to be closed while the file changes, or it writes the old setting back when it closes. Close Steam now? Yes closes Steam, makes the change and starts Steam again.\n\n" +
                NotNow;
            if (Read(manifest) == OnLaunchOnly)
                return "Steam's Updates setting for Skyrim is already \"" + OnLaunchWords + "\", which is what keeps Skyrim on 1.6.1170.\n\n" +
                       "But Steam's file for Skyrim is marked read only, which stops Steam saving Skyrim's state in it, so Steam logs a failure every six seconds:\n\n    " + manifest + "\n\n" +
                       "The launcher takes that mark off and changes nothing in the file.\n\n" + close;
            return "Steam can update its copy of Skyrim by itself. Thornswood's own game folder keeps its own 1.6.1170 files whatever Steam does, but until that folder is made, an update means downloading 1.6.1170's files for it first.\n\n" +
                   "So the launcher changes Steam's Updates setting for Skyrim to \"" + OnLaunchWords + "\", the same as picking it under Automatic Updates on Steam's own Properties, Updates page. " +
                   "Thornswood never starts Skyrim through Steam, so Steam then leaves it on 1.6.1170. " +
                   "It changes that one value in Steam's file for Skyrim and nothing else:\n\n    " + manifest + "\n\n" +
                   (IsReadOnly(manifest)
                       ? "That file is marked read only, which stops Steam saving Skyrim's state in it. The launcher also takes that mark off; the Updates setting is what keeps Skyrim on 1.6.1170.\n\n"
                       : "") +
                   close;
        }

        /// <summary>Waits on Steam for as long as it takes (WaitClosed).</summary>
        public const int NoLimit = -1;

        /// <summary>
        /// Waits for every steam.exe to exit, up to <paramref name="seconds"/>,
        /// or for as long as it takes with NoLimit. True once none is left.
        /// Waits on the processes themselves, not on a clock: Steam saves its
        /// files for every game on the way out, and only once it has gone is
        /// the file safe to change.
        /// </summary>
        public static bool WaitClosed(int seconds)
        {
            bool limited = seconds >= 0;
            DateTime until = limited ? DateTime.UtcNow.AddSeconds(seconds) : DateTime.MaxValue;
            while (true)
            {
                Process[] found;
                try { found = Process.GetProcessesByName("steam"); }
                // Not knowing counts as still running, so nothing is written under it.
                catch { return false; }
                if (found.Length == 0) return true;
                if (limited && DateTime.UtcNow >= until)
                {
                    foreach (Process p in found) p.Dispose();
                    return false;
                }
                // Each one waited on until it exits or time runs out, then the
                // list is taken again, because the one that exits can have
                // started another on its way out.
                foreach (Process p in found)
                {
                    try
                    {
                        int left = limited ? (int)Math.Max(0, (until - DateTime.UtcNow).TotalMilliseconds) : -1;
                        p.WaitForExit(left);
                    }
                    catch
                    {
                        // One this cannot wait on (it exited as it was asked,
                        // or Windows refused): the next pass lists it again or
                        // finds it gone, a quarter second from now rather than
                        // at once, so this never spins.
                        System.Threading.Thread.Sleep(250);
                    }
                    finally { p.Dispose(); }
                }
            }
        }

        public static bool SteamRunning()
        {
            try
            {
                Process[] found = Process.GetProcessesByName("steam");
                foreach (Process p in found) p.Dispose();
                return found.Length > 0;
            }
            // Not knowing counts as running, so nothing is written under it.
            catch { return true; }
        }

        /// <summary>
        /// Sets Skyrim's Updates setting to "Wait until I launch the game" in
        /// Steam's file, and takes off a read-only mark. Called on the way in
        /// when Steam is closed (OnStart), or after a person said Yes to the
        /// question. Never writes while Steam runs. Returns one line for the
        /// log saying what happened.
        /// </summary>
        public static string Hold(string manifest) { return Hold(manifest, SteamRunning()); }

        public static string Hold(string manifest, bool steamRunning)
        {
            if (string.IsNullOrEmpty(manifest) || !File.Exists(manifest))
                return "Steam's file for Skyrim was not found, so nothing was changed. " + How;
            if (steamRunning)
                return "Steam is still running, so nothing was changed. Steam writes its own copy of the setting back when it closes, which would undo the change. Exit Steam from its own menu first.";

            string before;
            try { before = Bytes.GetString(File.ReadAllBytes(manifest)); }
            catch (Exception ex) { return "Could not read " + manifest + ": " + ex.Message + " Nothing was changed. " + How; }

            string after = Held(before);
            if (after == null || Value(after) != OnLaunchOnly)
                return manifest + " is not laid out the way Steam writes it, so the launcher left it alone. " + How;
            if (after == before)
            {
                if (!IsReadOnly(manifest))
                    return "Steam's Updates setting for Skyrim is already \"" + Setting(OnLaunchOnly) + "\". Nothing was changed.";
                // On 1 already and only read only: the mark comes off and not
                // a byte of the file changes (issue #493).
                try { File.SetAttributes(manifest, File.GetAttributes(manifest) & ~FileAttributes.ReadOnly); }
                catch (Exception ex) { return "Steam's Updates setting for Skyrim is already \"" + Setting(OnLaunchOnly) + "\", but the read-only mark on " + manifest + " could not be taken off: " + ex.Message + " " + Writable(manifest); }
                return "Steam's Updates setting for Skyrim is already \"" + Setting(OnLaunchOnly) + "\". " + manifest +
                       " is no longer marked read only, so Steam can save Skyrim's state in it again. Nothing else in it changed.";
            }

            string tmp = Path.Combine(Path.GetDirectoryName(manifest), "thornswood-" + AppId + ".tmp");
            FileAttributes attrs = FileAttributes.Normal;
            bool readOnly = false;
            try
            {
                WriteWhole(tmp, Bytes.GetBytes(after));
                attrs = File.GetAttributes(manifest);
                readOnly = (attrs & FileAttributes.ReadOnly) != 0;
                // A rename cannot take the place of a read-only file.
                if (readOnly) File.SetAttributes(manifest, attrs & ~FileAttributes.ReadOnly);
                SwapIn(tmp, manifest);
            }
            catch (Exception ex)
            {
                // These two cannot go to Swallow.Note: test-steam-updates.ps1
                // compiles this class on its own, so it reaches nothing else in
                // the launcher. The line returned below already says the
                // change failed.
                try { if (File.Exists(tmp)) File.Delete(tmp); }
                catch
                {
                    // A stray temp file beside the manifest is all this leaves.
                }
                try { if (readOnly) File.SetAttributes(manifest, attrs); }
                catch
                {
                    // The manifest is left writable, and nothing else changed.
                }
                return "Could not change " + manifest + ": " + ex.Message + " It is as it was. " + How;
            }
            // Left writable, not marked read only again (issue #493): the
            // setting just written is what holds the version, and Steam has to
            // be able to save the game's state here.

            string now = Read(manifest);
            if (now != OnLaunchOnly)
                return "Wrote " + manifest + " but it " + (now == null ? "could not be read back" : "reads back as \"" + Setting(now) + "\"") + ". " + How;
            return "Steam's Updates setting for Skyrim is now \"" + Setting(OnLaunchOnly) + "\". Only that one value in " + manifest +
                   " changed" + (readOnly ? ", and it is no longer marked read only, so Steam can save Skyrim's state in it again." : ".") +
                   " Steam's own Properties, Updates page shows it under Automatic Updates the next time Steam starts.";
        }

        // ------------------------------------------------------------ writing
        //
        // Declared here rather than borrowed from OwnGame.WriteRecord, because
        // launcher\tests\test-steam-updates.ps1 compiles this file on its own. The same
        // call: a file flushed to the disk, then one rename over the manifest.

        /// <summary>The bytes into path, flushed to the disk before it returns.</summary>
        internal static void WriteWhole(string path, byte[] bytes)
        {
            using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                fs.Write(bytes, 0, bytes.Length);
                fs.Flush(true);
            }
        }

        /// <summary>Renames next over path in one call, replacing it.</summary>
        internal static void SwapIn(string next, string path)
        {
            if (!MoveFileEx(next, path, MoveReplaceExisting | MoveWriteThrough))
                throw new IOException(path + " could not be replaced by " + next + ": " +
                                      new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()).Message);
        }

        const int MoveReplaceExisting = 0x1;
        const int MoveWriteThrough = 0x8;
        [LibraryImport("kernel32.dll", EntryPoint = "MoveFileExW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool MoveFileEx(string existing, string replacement, int flags);

        // ------------------------------------------------------------ reading

        // One token of Valve's KeyValues text: a quoted string, where Start and
        // End are the span inside the quotes, or a brace.
        struct Token { public char Kind; public int Start, End; }

        /// <summary>
        /// Quoted strings and braces, or null for anything else. Steam quotes
        /// every key and value in this file, and escapes a backslash or a quote
        /// inside one with a backslash (LauncherPath is written
        /// "C:\\Program Files (x86)\\Steam\\steam.exe"). An unquoted word or a
        /// [$WIN32] condition is legal KeyValues but not something Steam puts
        /// here, so it is refused rather than guessed at.
        /// </summary>
        static List<Token> Tokens(string text)
        {
            if (text == null) return null;
            List<Token> list = new List<Token>();
            int i = 0, n = text.Length;
            // A UTF-8 byte order mark, as bytes or as the one char it decodes to.
            if (text.StartsWith("\u00EF\u00BB\u00BF", StringComparison.Ordinal)) i = 3;
            else if (n > 0 && text[0] == '\uFEFF') i = 1;
            while (i < n)
            {
                char c = text[i];
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') { i++; continue; }
                if (c == '{' || c == '}')
                {
                    Token b = new Token();
                    b.Kind = c; b.Start = i; b.End = i + 1;
                    list.Add(b);
                    i++;
                    continue;
                }
                if (c == '/' && i + 1 < n && text[i + 1] == '/')
                {
                    while (i < n && text[i] != '\n') i++;
                    continue;
                }
                if (c != '"') return null;
                int start = ++i;
                while (i < n && text[i] != '"')
                {
                    if (text[i] == '\\') i++;
                    i++;
                }
                if (i >= n) return null;
                Token s = new Token();
                s.Kind = '"'; s.Start = start; s.End = i;
                list.Add(s);
                i++;
            }
            return list;
        }

        /// <summary>
        /// "AppState" { key value ... } and nothing after it, with every block
        /// balanced. Collects where each top level AutoUpdateBehavior value is,
        /// and where the closing brace of AppState sits.
        /// </summary>
        static bool Walk(string text, List<Token> t, List<int> found, out int close)
        {
            close = -1;
            if (t.Count < 3) return false;
            if (t[0].Kind != '"' || !Is(text, t[0], "AppState")) return false;
            if (t[1].Kind != '{') return false;
            int depth = 1;
            int i = 2;
            while (i < t.Count)
            {
                Token k = t[i];
                if (k.Kind == '}')
                {
                    depth--;
                    i++;
                    if (depth == 0) { close = k.Start; break; }
                    continue;
                }
                if (k.Kind != '"' || i + 1 >= t.Count) return false;
                Token v = t[i + 1];
                if (v.Kind == '{') { depth++; i += 2; continue; }
                if (v.Kind != '"') return false;
                if (depth == 1 && Is(text, k, Key)) found.Add(i + 1);
                i += 2;
            }
            return depth == 0 && i == t.Count;
        }

        // Valve's reader matches keys without regard to case.
        static bool Is(string text, Token t, string word)
        {
            return t.End - t.Start == word.Length &&
                   string.Compare(text, t.Start, word, 0, word.Length, StringComparison.OrdinalIgnoreCase) == 0;
        }
    }
}
