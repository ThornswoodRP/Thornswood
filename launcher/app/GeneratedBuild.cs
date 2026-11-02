using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Xml;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    /// <summary>
    /// Builds Thornswood's animation and body files (Pandora Behaviour Engine+'s
    /// behavior files and BodySlide's bodies) in a Thornswood game folder, and
    /// records them (Generated.cs). Issue #1247, and since 27 Oct 2026 #3715:
    /// the launcher runs this on each computer (GeneratedHere.cs) instead of a
    /// release carrying what the shipping machine built, because what Pandora
    /// and BodySlide make is the game's graphs and other people's bodies, which
    /// Thornswood has no right to hand on (THIRD-PARTY.md). Never writes into
    /// the Steam copy.
    ///
    /// WHY PANDORA AND NOT NEMESIS. Measured 29 Sep on the shipping machine:
    /// Nemesis -generate sat for seven minutes on 0.09 s of processor time,
    /// with no window and no file written. In its own source, v0.84 and since,
    /// -generate connects its worker to a slot named GenerateBehavior(), which
    /// does not exist (the slot is InitializeGeneration()), so no Nemesis
    /// release can generate from a command line. Pandora Behaviour Engine+
    /// reads the same patches, runs from a command line (--auto_run
    /// --auto_close), and was compared with Nemesis' output the same day: the
    /// same 20 behavior and character files with the same names in them. The
    /// collection carries Pandora from revision 2 (docs\COLLECTION-REVISION-2.md).
    ///
    /// WHAT IT DOES, in &lt;Root&gt;\Game:
    ///   1. Refuses while anything has the folder open (InUse), when the folder
    ///      is not one the launcher made, and when it could be the Steam copy
    ///      or any folder Vortex deploys into.
    ///   2. Checks the build list: Pandora and the patches are in this folder,
    ///      and every BodySlide set it names keeps to the body rules. Each set
    ///      is built at its own slider defaults, written out as a preset that
    ///      names every slider, and nothing that shapes the breasts, the seat,
    ///      the genitals or the nipples may do anything (issue #1004), no zap
    ///      may take the underwear off (issue #405), and no RaceMenu morph file
    ///      is built (BodySlide is never given --trimorphs).
    ///   3. Gives the folder its own copy of every file BodySlide writes in
    ///      place (its settings, its presets and groups). The folder holds most
    ///      of the collection as hard links to Vortex's copies, and a file
    ///      written through a link is written in Vortex's copy and the Steam
    ///      copy too.
    ///   4. Pandora: runs a copy of it in the work folder, never the one in the
    ///      game folder: its own folder, or, where Vortex deployed it loose into
    ///      Data, the files Vortex's record lists for its mod. Its Settings.json
    ///      names this folder's Data and a work output folder and nothing else:
    ///      Pandora reads its folders from there, not from -o (v4.4.0 parses -o
    ///      and never uses it), and without it falls back to the registry's
    ///      Skyrim, the Steam copy. Its ActiveMods.json turns on exactly the
    ///      patches the list names and every other patch off. It refuses if
    ///      Pandora changed anything in the game folder, if its log has an
    ///      error or names other patches, then puts each file it made in place
    ///      as a new file of this folder's own, in the letter case the folder
    ///      already uses.
    ///   5. BodySlide: sets it to Skyrim Special Edition and this folder's Data,
    ///      builds each set into a folder of its own (--targetdir), reads the
    ///      bodies it built (CoveredBodies) and refuses a nude one, then puts
    ///      each file in place as a new file of this folder's own.
    ///   6. Refuses, and records nothing, if any file the tools changed is
    ///      shared with another folder (written through a link), or if
    ///      BodySlide wrote anywhere but where it was told.
    ///   7. Files the last build made that this one did not are put back:
    ///      Vortex's own copy where Vortex deploys that path, otherwise taken
    ///      out.
    ///   8. Reads every body in the folder, the built ones and any a mod
    ///      brought, and records nothing while one is nude (#405).
    ///   9. Writes Profile\OwnGame\generated.txt: each file it made, with its
    ///      sha256, and what it was built from. The launcher keeps those files
    ///      as Thornswood's (OwnGameKinds.cs), and nothing ships them
    ///      (Ship-Rules.ps1 $ShipGeneratedPatterns).
    ///
    /// Every refusal is a GeneratedStop with the sentence to show: Code 1, or 3
    /// when the folder is in use. scripts\mods\Build-Generated.ps1 runs this
    /// for a folder by hand and turns those into its exit codes.
    ///
    /// Compiled on its own with Generated.cs by scripts\mods\Generated.ps1, so
    /// it keeps to what Windows PowerShell 5.1's compiler takes.
    /// </summary>
    public sealed class GeneratedBuild
    {
        /// <summary>The Thornswood install (the folder with Game and Profile in it).</summary>
        public string Root = "";
        /// <summary>What to build: records\generated.json, read.</summary>
        public GeneratedList List;
        /// <summary>Checks everything and says what it would run, and writes nothing.</summary>
        public bool DryRun;
        /// <summary>How long each tool may run before it is stopped and the build refused.</summary>
        public int Minutes = 30;
        /// <summary>
        /// How long a tool may sit using almost no processor time (under a
        /// second of it) while no file changes in the game folder or the work
        /// folder, before it is taken as waiting on something nobody can
        /// answer, stopped, and the build refused.
        /// </summary>
        public int StallSeconds = 180;
        /// <summary>
        /// Each line to show and its colour, as Write-Host names them; "Head"
        /// is a heading. Null says nothing.
        /// </summary>
        public Action<string, string> Say;
        /// <summary>
        /// What has the folder open, one line each; none or null when nothing
        /// does. Asked before anything is written and again before the record.
        /// Null asks nothing: the launcher builds only from Play and Fix, with
        /// the game closed and the folder to itself (OwnGame.Alone).
        /// </summary>
        public Func<string[]> InUse;

        string game, data, ownDir, workDir = "";
        string bsDir, bsExe, pandoraExe = "";
        string[] patchDirs;
        List<string> pandoraFiles = new List<string>();
        List<string> patchNames = new List<string>();
        readonly List<Planned> sets = new List<Planned>();

        sealed class Planned
        {
            public BodySlideSet Set;
            public List<BodySlideValue> Values;
            public bool Outfit;
            public List<string> Expect;
        }

        void Line(string m, string c) { if (Say != null) Say(m, c); }
        void Head(string m) { Line(m, "Head"); }

        /// <summary>
        /// Builds and records them, or with DryRun says what it would do.
        /// Returns the number of files recorded (0 on a dry run). Throws
        /// GeneratedStop with the sentence to show; the work folder is gone
        /// either way.
        /// </summary>
        public int Run()
        {
            if (List == null) throw new GeneratedStop("No build list was given.");
            Root = Path.GetFullPath(Root).TrimEnd('\\', '/');
            game = Path.Combine(Root, "Game");
            data = Path.Combine(game, "Data");
            ownDir = Path.Combine(Root, "Profile\\OwnGame");
            bsDir = Path.Combine(data, "CalienteTools\\BodySlide");
            bsExe = Path.Combine(bsDir, "BodySlide.exe");
            patchDirs = new[] { Path.Combine(data, "Nemesis_Engine\\mod"), Path.Combine(data, "Pandora_Engine\\mod") };
            try { return Steps(); }
            finally
            {
                if (workDir.Length > 0 && Directory.Exists(workDir))
                {
                    // The build has already stopped and says why; a folder something still holds
                    // is emptied by the next build before it starts, which says so if it cannot.
                    try { Directory.Delete(workDir, true); }
                    catch (IOException) { /* still held: the next build empties it first */ }
                    catch (UnauthorizedAccessException) { /* still held: the next build empties it first */ }
                }
            }
        }

        int Steps()
        {
            // ------------------------------------------------------------ the folder
            Head("The folder");
            if (!File.Exists(Path.Combine(game, "SkyrimSE.exe")))
                throw new GeneratedStop("There is no Skyrim in " + game + ". Open the launcher once; it makes Thornswood's own folder there.");
            if (!File.Exists(Path.Combine(ownDir, "files.txt")))
                throw new GeneratedStop(game + " is not a folder the launcher made (there is no " + ownDir + "\\files.txt), so it cannot be told which files are Vortex's. Open the launcher once to make it.");
            // Never the Steam copy, and never a folder Vortex deploys into:
            // Vortex's record in Data is how a folder Vortex manages is known,
            // and the launcher's record names the folder it was made from.
            if (File.Exists(Path.Combine(data, "vortex.deployment.json")))
                throw new GeneratedStop(game + " has Vortex's own record in it (Data\\vortex.deployment.json), so it is a folder Vortex deploys into, not Thornswood's own. Nothing is built there.");
            string made = Path.Combine(ownDir, "made.txt");
            if (File.Exists(made))
                foreach (string line in File.ReadAllLines(made))
                {
                    Match m = Regex.Match(line.TrimStart('﻿'), "^(source|game)=(.+)$");
                    if (!m.Success) continue;
                    string src = m.Groups[2].Value.Trim().TrimEnd('\\');
                    if (src.Length > 0 && string.Equals(Path.GetFullPath(src).TrimEnd('\\'), game, StringComparison.OrdinalIgnoreCase))
                        throw new GeneratedStop(game + " is the folder Thornswood's own folder was made from, the Steam copy. Nothing is built there.");
                }
            Line("  " + game + " is Thornswood's own folder, made by the launcher", "Green");
            NotInUse();
            Line("  nothing has it open", "Green");

            // ------------------------------------------------------------ what to build
            Head("What to build");
            Line("  " + List.Path, "DarkGray");
            if (List.Patches.Count > 0) FindPandora();
            PlanSets();
            GeneratedInputs inputs = Generated.Inputs(Root, List);
            Line(string.Format(CultureInfo.InvariantCulture, "  built from {0:n0} of Vortex's files for Pandora and {1:n0} for BodySlide, and the mod list",
                inputs.BehaviorFiles, inputs.BodySlideFiles), "DarkGray");

            if (DryRun)
            {
                Head("Would run");
                if (List.Patches.Count > 0)
                    Line("  a copy of " + Path.GetDirectoryName(pandoraExe) + " in the work folder: " + Quote(Path.GetFileName(pandoraExe)) +
                         " --tesv " + Quote(game) + " -o <a folder of its own> --auto_run --auto_close, with the patches " + string.Join(" ", List.Patches.ToArray()), "White");
                for (int i = 0; i < sets.Count; i++)
                    Line("  " + Quote(bsExe) + " --groupbuild " + Quote(GroupOf(i)) + " --targetdir <a folder of its own> --preset " + Quote(GroupOf(i)), "White");
                GeneratedState state = Generated.State(Root, List);
                if (state.Current) Line("  the files in the folder are already current", "Green");
                else foreach (string w in state.Why) Line("  out of date: " + w, "Yellow");
                Line("  dry run: nothing was copied, set, started or recorded", "Yellow");
                return 0;
            }

            workDir = Path.Combine(ownDir, "build-generated");
            if (Directory.Exists(workDir)) Directory.Delete(workDir, true);
            Directory.CreateDirectory(workDir);

            // ------------------------------------------------------------ its own copies
            // What BodySlide writes in place in its own folder: its settings,
            // and the presets and groups. Pandora runs from a copy and writes
            // nothing here.
            Head("This folder's own copies");
            int split = 0;
            var toSplit = new List<string>();
            if (sets.Count > 0)
                foreach (string rel in Snap().Keys)
                    if (Regex.IsMatch(rel, @"(?i)^Data\\CalienteTools\\BodySlide\\([^\\]+|SliderPresets\\[^\\]+|SliderGroups\\[^\\]+)$")) toSplit.Add(rel);
            foreach (string rel in toSplit) if (SplitLink(Path.Combine(game, rel))) split++;
            Line(string.Format(CultureInfo.InvariantCulture, "  {0:n0} file(s) BodySlide writes in place were shared with another folder and are this folder's own copies now; {1:n0} already were",
                split, toSplit.Count - split), "Green");

            var outputs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (List.Patches.Count > 0) RunPandora(outputs);
            if (sets.Count > 0) RunBodySlide(outputs);

            // ------------------------------------------------------------ what the last one made
            string recordPath = Generated.RecordPath(Root);
            GeneratedRecord old = GeneratedRecord.Read(recordPath);
            if (old != null) PutBackDropped(old, outputs, made);

            // Every body in the folder now, the built ones and any other a mod
            // brought (a 3BA extra body, a male body with anatomy): one that is
            // nude, or cannot be read, and nothing is recorded, so the launcher
            // does not start the game on it and the next Play tries again.
            if (sets.Count > 0)
            {
                Head("Every body in the folder");
                CoveredResult all = CoveredBodies.Check(game, true, Say);
                if (all.Nude > 0 || all.Unread > 0)
                    throw new GeneratedStop("A body in " + game + " is nude, or cannot be read (see above), so nothing was recorded and the game does not start on it (issue #405). " +
                        "The mesh named above comes from a mod in Vortex: take that mod out of the Thornswood profile, deploy, and play again.");
            }

            // ------------------------------------------------------------ the record
            Head("The record");
            NotInUse();
            var files = new List<GeneratedFile>();
            foreach (string rel in outputs) files.Add(new GeneratedFile { Rel = rel, Sha = Generated.FileSha(Path.Combine(game, rel)) });
            GeneratedRecord.Write(recordPath, game, inputs, files);
            Line(string.Format(CultureInfo.InvariantCulture, "  {0} file(s) recorded as Thornswood's in {1}", files.Count, recordPath), "Green");
            Directory.Delete(workDir, true);

            GeneratedState after = Generated.State(Root, List);
            if (!after.Current) throw new GeneratedStop("The record was written and does not read back as current: " + string.Join("; ", after.Why));
            return files.Count;
        }

        void NotInUse()
        {
            if (InUse == null) return;
            string[] users = InUse();
            if (users == null || users.Length == 0) return;
            foreach (string u in users) Line("  in use by " + u, "Red");
            throw new GeneratedStop("Thornswood's folder at " + Root + " is in use. Close Skyrim and the Thornswood launcher (and any Pandora or BodySlide started from it), then run this again. " +
                "The launcher brings the folder up to date while it runs, and the game holds its files open.", 3);
        }

        // ------------------------------------------------------------ Pandora, found

        void FindPandora()
        {
            // Pandora as the collection deployed it into this folder, in a
            // folder of its own: it runs from a copy of that folder, so it has
            // to be one.
            var found = new List<string>();
            Find(data, "Pandora Behaviour Engine+.exe", 3, found);
            if (found.Count == 0)
                throw new GeneratedStop("Pandora Behaviour Engine+ is not in this folder. It comes with the collection from revision 2 (docs\\COLLECTION-REVISION-2.md): install it in Vortex, deploy, and bring the folder up to date in the launcher (Settings, Maintenance).");
            if (found.Count > 1)
                throw new GeneratedStop("Pandora is in this folder more than once (" + string.Join(", ", found.ToArray()) + "), so which one runs cannot be told. Keep one in Vortex.");
            pandoraExe = found[0];
            // Its files, to copy into the work folder: its own folder, or, when
            // Vortex deployed it loose into Data (its archive has no folder at
            // the top), the files Vortex's own record lists for the same mod.
            string from = Path.GetDirectoryName(pandoraExe);
            if (string.Equals(from, data, StringComparison.OrdinalIgnoreCase)) pandoraFiles = Generated.LoosePandoraFiles(Root);
            else foreach (string f in Directory.GetFiles(from, "*", SearchOption.AllDirectories)) pandoraFiles.Add(f.Substring(from.Length + 1));
            foreach (string p in List.Patches)
            {
                string n = PatchName(p);
                if (n == null)
                    throw new GeneratedStop("The behavior patch '" + p + "' that records\\generated.json names is not installed (no " + string.Join(" or ", patchDirs) +
                        " entry with an info.ini or info.xml). Is the mod that carries it deployed?");
                patchNames.Add(n);
            }
            Line("  Pandora, " + pandoraExe, "Green");
            var named = new List<string>();
            for (int i = 0; i < List.Patches.Count; i++) named.Add(List.Patches[i] + " (" + patchNames[i] + ")");
            Line("  with the patches " + string.Join(", ", named.ToArray()) + "; every other patch off", "Green");
        }

        /// <summary>Files of this name in dir and up to depth folders below it, never through a folder link.</summary>
        static void Find(string dir, string name, int depth, List<string> found)
        {
            string here = Path.Combine(dir, name);
            if (File.Exists(here)) found.Add(here);
            if (depth == 0) return;
            foreach (string sub in Directory.GetDirectories(dir))
            {
                if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0) continue;
                Find(sub, name, depth - 1, found);
            }
        }

        /// <summary>
        /// A patch's name as its own record gives it, which is how Pandora's log
        /// names the patches it ran with: info.ini's name= (Nemesis' format) or
        /// info.xml's &lt;name&gt; (Pandora's).
        /// </summary>
        string PatchName(string code)
        {
            foreach (string d in patchDirs)
            {
                string ini = Path.Combine(d, code + "\\info.ini");
                if (File.Exists(ini))
                {
                    Match m = Regex.Match(File.ReadAllText(ini), @"(?m)^name=(.+?)\s*$");
                    if (m.Success) return m.Groups[1].Value;
                }
                string xml = Path.Combine(d, code + "\\info.xml");
                if (File.Exists(xml))
                {
                    Match m = Regex.Match(File.ReadAllText(xml), @"<name>\s*(.+?)\s*</name>");
                    if (m.Success) return m.Groups[1].Value;
                }
            }
            return null;
        }

        // ------------------------------------------------------------ BodySlide, planned

        void PlanSets()
        {
            // The bodies first, then the outfits fitted to them (#2454): one
            // group each, every one at its defaults and under the same rules.
            var wanted = new List<KeyValuePair<string, bool>>();
            foreach (string s in List.Sets) wanted.Add(new KeyValuePair<string, bool>(s, false));
            foreach (string s in List.Outfits) wanted.Add(new KeyValuePair<string, bool>(s, true));
            if (wanted.Count == 0) return;
            if (!File.Exists(bsExe))
                throw new GeneratedStop("BodySlide is not in this folder (" + bsExe + "). It comes with the collection: deploy it in Vortex and bring the folder up to date in the launcher.");
            var bad = new List<string>();
            foreach (var w in wanted)
            {
                BodySlideSet set = Generated.Set(Path.Combine(bsDir, "SliderSets"), w.Key);
                List<string> expect = Generated.SetOutputs(set);
                if (w.Value)
                    foreach (string e in expect)
                        if (Generated.IsBodyPath(e))
                            throw new GeneratedStop("The outfit set '" + w.Key + "' writes a body (" + e + "). Bodies are built from bodyslide.sets only. Nothing was built.");
                Dictionary<string, Dictionary<string, double>> moves;
                if (!List.Sliders.TryGetValue(w.Key, out moves)) moves = null;
                List<BodySlideValue> values = Generated.Values(set, moves);
                bad.AddRange(Generated.Rules(set, values, moves));
                sets.Add(new Planned { Set = set, Values = values, Outfit = w.Value, Expect = expect });
                var zaps = new List<string>();
                foreach (BodySlideSlider sl in set.Sliders) if (sl.Zap) zaps.Add(sl.Name);
                Line(string.Format(CultureInfo.InvariantCulture, "  BodySlide, '{0}' ({1}): shapes {2}; {3} sliders at their defaults{4}",
                    w.Key, Path.GetFileName(set.File), string.Join(", ", set.Shapes.ToArray()), set.Sliders.Count,
                    zaps.Count > 0 ? "; zaps " + string.Join(", ", zaps.ToArray()) + " as the set has them" : ""), "Green");
            }
            if (bad.Count > 0)
            {
                foreach (string b in bad) Line("  " + b, "Red");
                throw new GeneratedStop("A body would be built against the body rules (no shaping of the breasts, the seat, the genitals or the nipples, issue #1004; the underwear stays on, issue #405). Nothing was built. Change records\\generated.json.");
            }
            Line("  every body keeps to the rules: nothing shapes the breasts, the seat, the genitals or the nipples, the underwear stays on, and no morph file is built", "Green");
        }

        static string GroupOf(int i) { return "Thornswood " + (i + 1).ToString(CultureInfo.InvariantCulture); }

        static string Quote(string a)
        {
            if (Regex.IsMatch(a, "[\\s\"]")) return "\"" + a.Replace("\"", "\\\"") + "\"";
            return a;
        }

        // ------------------------------------------------------------ Pandora, run

        void RunPandora(HashSet<string> outputs)
        {
            Head("Pandora");
            // A copy of Pandora's folder in the work folder, so what it writes
            // beside itself (its settings, its caches) never lands in the game
            // folder.
            string pFrom = Path.GetDirectoryName(pandoraExe);
            string pRun = Path.Combine(workDir, "pandora");
            foreach (string rel in pandoraFiles)
            {
                string f = Path.Combine(pFrom, rel);
                if (!File.Exists(f)) continue;
                string to = Path.Combine(pRun, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(to));
                File.Copy(f, to, true);
            }
            string pExe = Path.Combine(pRun, Path.GetFileName(pandoraExe));
            string pOut = Path.Combine(workDir, "pandora-out");
            Directory.CreateDirectory(Path.Combine(pOut, "Pandora_Engine"));
            // Its folders, by name: this folder's Data to read and the work
            // output folder to write. It reads them from here and nowhere else;
            // -o is parsed and never used in v4.4.0, and with no game folder
            // here it would take the registry's Skyrim, the Steam copy.
            var settings = new StringBuilder();
            settings.Append("{\r\n  \"app\": {},\r\n  \"games\": {\r\n    \"SkyrimSE\": {\r\n");
            settings.Append("      \"gameDataPath\": ").Append(Json(data)).Append(",\r\n");
            settings.Append("      \"outputPath\": ").Append(Json(pOut)).Append("\r\n    }\r\n  }\r\n}");
            File.WriteAllText(Path.Combine(pRun, "Settings.json"), settings.ToString(), new UTF8Encoding(false));
            // Exactly the patches the list names on, in its order, and every
            // other patch in this folder off. A patch left off this list would
            // keep Pandora's own default, which for an FNIS list is on: those
            // are what Nemesis always read as well.
            var entries = new List<string>();
            int prio = 1;
            foreach (string p in List.Patches) entries.Add(Entry(p, true, prio++));
            foreach (string d in patchDirs)
            {
                if (!Directory.Exists(d)) continue;
                foreach (string sub in Directory.GetDirectories(d))
                {
                    string code = Path.GetFileName(sub);
                    if (List.Patches.Contains(code)) continue;
                    entries.Add(Entry(code, false, prio++));
                }
            }
            File.WriteAllText(Path.Combine(pOut, "Pandora_Engine\\ActiveMods.json"), "[\r\n" + string.Join(",\r\n", entries.ToArray()) + "\r\n]", new UTF8Encoding(false));

            Dictionary<string, string> before = Snap();
            RunTool(pExe, new[] { "--tesv", game, "-o", pOut, "--auto_run", "--auto_close" }, "Pandora");
            List<string> changed = Changed(before, Snap());
            if (changed.Count > 0)
                throw new GeneratedStop("Pandora wrote into the game folder itself (" + First(changed, 5) + ") and not only into the folder it was given. Nothing was recorded.");
            string[] crash = Directory.GetFiles(pOut, "Pandora_CriticalCrash*", SearchOption.TopDirectoryOnly);
            if (crash.Length > 0) throw new GeneratedStop("Pandora crashed (" + crash[0] + "). Nothing was recorded.");
            string engineLog = Path.Combine(pOut, "Engine.log");
            if (!File.Exists(engineLog)) throw new GeneratedStop("Pandora finished without writing its log (" + engineLog + "), so what it did cannot be checked. Nothing was recorded.");
            string logText = File.ReadAllText(engineLog);
            var errors = new List<string>();
            foreach (Match m in Regex.Matches(logText, @"(?m)^(ERROR|FATAL) : .*$")) errors.Add(m.Value.Trim());
            if (errors.Count > 0)
            {
                for (int i = 0; i < errors.Count && i < 8; i++) Line("  " + errors[i], "Red");
                throw new GeneratedStop("Pandora's log has errors (above). Nothing was recorded. Run this again after putting right what they name.");
            }
            var ran = new SortedSet<string>(StringComparer.Ordinal);
            foreach (Match m in Regex.Matches(logText, @"(?m)Pandora Mod \d+ : (.+?) - v"))
            {
                string n = m.Groups[1].Value.Trim();
                if (n != "Pandora Base") ran.Add(n);
            }
            var want = new SortedSet<string>(patchNames, StringComparer.Ordinal);
            if (string.Join("|", new List<string>(ran).ToArray()) != string.Join("|", new List<string>(want).ToArray()))
                throw new GeneratedStop("Pandora ran with the patches " + string.Join(", ", new List<string>(ran).ToArray()) + ", and records\\generated.json names " +
                    string.Join(", ", new List<string>(want).ToArray()) + ". Nothing was recorded.");
            var pMade = new List<string>();
            foreach (string f in Directory.GetFiles(pOut, "*", SearchOption.AllDirectories))
            {
                string r = f.Substring(pOut.Length + 1);
                if (r == "Engine.log" || r.StartsWith("Pandora_Engine\\", StringComparison.OrdinalIgnoreCase)) continue;
                pMade.Add(f);
            }
            if (pMade.Count == 0) throw new GeneratedStop("Pandora finished and made nothing. Nothing was recorded.");
            foreach (string f in pMade) outputs.Add(PutOutput(f, "Data\\" + f.Substring(pOut.Length + 1)));
            Line(string.Format(CultureInfo.InvariantCulture, "  made {0} file(s) with {1}, and they are in the folder", pMade.Count,
                string.Join(", ", new List<string>(want).ToArray())), "Green");
        }

        static string Entry(string code, bool active, int prio)
        {
            return "  {\r\n    \"code\": " + Json(code) + ",\r\n    \"active\": " + (active ? "true" : "false") +
                   ",\r\n    \"priority\": " + prio.ToString(CultureInfo.InvariantCulture) + "\r\n  }";
        }

        static string Json(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        // ------------------------------------------------------------ BodySlide, run

        void RunBodySlide(HashSet<string> outputs)
        {
            Head("BodySlide");
            // Skyrim Special Edition, this folder's Data. Left unset it asks
            // which game on its first start, which a build started from here
            // cannot answer.
            string cfgPath = Path.Combine(bsDir, "Config.xml");
            var cfg = new XmlDocument();
            if (File.Exists(cfgPath)) cfg.Load(cfgPath); else cfg.AppendChild(cfg.CreateElement("Config"));
            XmlElement cfgRoot = cfg.DocumentElement;
            SetNode(cfgRoot, "TargetGame", "4");
            SetNode(cfgRoot, "GameDataPath", data + "\\");
            var paths = cfgRoot.SelectSingleNode("GameDataPaths") as XmlElement;
            if (paths == null) { paths = cfg.CreateElement("GameDataPaths"); cfgRoot.AppendChild(paths); }
            SetNode(paths, "SkyrimSpecialEdition", data + "\\");
            cfg.Save(cfgPath);

            // One group and one preset for each set, named for Thornswood,
            // naming every slider at the value it is built with.
            var groups = new XmlDocument();
            groups.AppendChild(groups.CreateXmlDeclaration("1.0", "UTF-8", null));
            XmlNode gRoot = groups.AppendChild(groups.CreateElement("SliderGroups"));
            var presets = new XmlDocument();
            presets.AppendChild(presets.CreateXmlDeclaration("1.0", "UTF-8", null));
            XmlNode pRoot = presets.AppendChild(presets.CreateElement("SliderPresets"));
            for (int i = 0; i < sets.Count; i++)
            {
                string gname = GroupOf(i);
                XmlElement g = groups.CreateElement("Group"); g.SetAttribute("name", gname); gRoot.AppendChild(g);
                XmlElement mem = groups.CreateElement("Member"); mem.SetAttribute("name", sets[i].Set.Name); g.AppendChild(mem);
                XmlElement p = presets.CreateElement("Preset"); p.SetAttribute("name", gname); p.SetAttribute("set", sets[i].Set.Name); pRoot.AppendChild(p);
                XmlElement pg = presets.CreateElement("Group"); pg.SetAttribute("name", gname); p.AppendChild(pg);
                foreach (BodySlideValue v in sets[i].Values)
                    foreach (string size in new[] { "big", "small" })
                    {
                        XmlElement ss = presets.CreateElement("SetSlider");
                        ss.SetAttribute("name", v.Name);
                        ss.SetAttribute("size", size);
                        ss.SetAttribute("value", (size == "big" ? v.Big : v.Small).ToString(CultureInfo.InvariantCulture));
                        p.AppendChild(ss);
                    }
            }
            Directory.CreateDirectory(Path.Combine(bsDir, "SliderGroups"));
            Directory.CreateDirectory(Path.Combine(bsDir, "SliderPresets"));
            groups.Save(Path.Combine(bsDir, "SliderGroups\\Thornswood.xml"));
            presets.Save(Path.Combine(bsDir, "SliderPresets\\Thornswood.xml"));

            string stageRoot = Path.Combine(workDir, "bodyslide");
            string stageData = Path.Combine(stageRoot, "Data");
            Directory.CreateDirectory(stageData);
            Dictionary<string, string> before = Snap();
            for (int i = 0; i < sets.Count; i++)
                RunTool(bsExe, new[] { "--groupbuild", GroupOf(i), "--targetdir", stageData, "--preset", GroupOf(i) }, "BodySlide ('" + sets[i].Set.Name + "')");
            List<string> changed = Changed(before, Snap());
            NoWriteThrough(changed, "BodySlide");
            var stray = new List<string>();
            foreach (string rel in changed) if (!InTool(rel)) stray.Add(rel);
            if (stray.Count > 0)
                throw new GeneratedStop("BodySlide wrote into the game folder itself (" + First(stray, 5) + ") and not only into the folder it was given. Nothing was recorded.");
            string[] built = Directory.GetFiles(stageData, "*", SearchOption.AllDirectories);
            if (built.Length == 0) throw new GeneratedStop("BodySlide finished and built nothing. Nothing was recorded. Its log is Log_BS.txt beside it.");
            var tri = new List<string>();
            foreach (string f in built) if (Path.GetExtension(f).Equals(".tri", StringComparison.OrdinalIgnoreCase)) tri.Add(Path.GetFileName(f));
            if (tri.Count > 0)
                throw new GeneratedStop("BodySlide built RaceMenu morph files (" + string.Join(", ", tri.ToArray()) + "), which the body rules do not allow (issue #1004). Nothing was put in the folder.");
            // Every outfit built exactly the files its set names, and nothing
            // else landed beside them (#2454).
            var builtRel = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string f in built) builtRel.Add("Data\\" + f.Substring(stageData.Length + 1));
            var expectAll = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var outfitDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var missing = new List<string>();
            foreach (Planned s in sets)
                foreach (string e in s.Expect)
                {
                    expectAll.Add(e);
                    if (!s.Outfit) continue;
                    outfitDirs.Add(Path.GetDirectoryName(e));
                    if (!builtRel.Contains(e)) missing.Add(e);
                }
            if (missing.Count > 0) throw new GeneratedStop("BodySlide did not build every outfit file its sets name (" + First(missing, 5) + "). Nothing was put in the folder.");
            var extra = new List<string>();
            foreach (string r in builtRel) if (outfitDirs.Contains(Path.GetDirectoryName(r)) && !expectAll.Contains(r)) extra.Add(r);
            if (extra.Count > 0) throw new GeneratedStop("BodySlide built files no set names (" + First(extra, 5) + "). Nothing was put in the folder.");

            // The bodies it built, read before any is put in place.
            CoveredResult covered = CoveredBodies.Check(stageRoot, false, Say);
            if (covered.Nude > 0 || covered.Unread > 0)
                throw new GeneratedStop("A body BodySlide built is not covered, or cannot be read (see above). Nothing was put in the folder (issue #405).");

            foreach (string f in built) outputs.Add(PutOutput(f, "Data\\" + f.Substring(stageData.Length + 1)));
            Line(string.Format(CultureInfo.InvariantCulture, "  built {0} file(s) and put them in the folder", built.Length), "Green");
        }

        static void SetNode(XmlElement parent, string name, string value)
        {
            XmlNode n = parent.SelectSingleNode(name);
            if (n == null) { n = parent.OwnerDocument.CreateElement(name); parent.AppendChild(n); }
            n.InnerText = value;
        }

        // ------------------------------------------------------------ the last build's files

        void PutBackDropped(GeneratedRecord old, HashSet<string> outputs, string made)
        {
            var dropped = new List<string>();
            foreach (GeneratedFile f in old.Files) if (!outputs.Contains(f.Rel)) dropped.Add(f.Rel);
            if (dropped.Count == 0) return;
            Head("What the last build made and this one did not");
            // Vortex's own copy where Vortex deploys that path, by its record
            // in the folder it deploys into, which the launcher names in
            // made.txt.
            var staged = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string src = "";
            if (File.Exists(made))
                foreach (string line in File.ReadAllLines(made))
                {
                    Match m = Regex.Match(line.TrimStart('﻿'), "^source=(.+)$");
                    if (m.Success) src = m.Groups[1].Value.Trim();
                }
            string vm = src.Length > 0 ? Path.Combine(src, "Data\\vortex.deployment.json") : "";
            if (vm.Length > 0 && File.Exists(vm))
                foreach (VortexFile vf in VortexFile.Read(vm))
                    staged["Data\\" + vf.RelPath.TrimStart('\\')] = Path.Combine(Path.Combine(vf.StagingPath, vf.Source), vf.RelPath.TrimStart('\\'));
            foreach (string rel in dropped)
            {
                string dest = Path.Combine(game, rel);
                if (File.Exists(dest)) File.Delete(dest);
                string from;
                if (staged.TryGetValue(rel, out from) && File.Exists(from))
                {
                    File.Copy(from, dest);
                    Line("  " + rel + " is Vortex's again", "DarkGray");
                }
                else Line("  " + rel + " taken out", "DarkGray");
            }
        }

        // ------------------------------------------------------------ running a tool

        /// <summary>
        /// Runs a tool and waits for it, watching that it is working: it uses
        /// the processor, or a file changes in the game folder or the work
        /// folder. A tool that does neither for StallSeconds is waiting on
        /// something nobody here can answer (a window, a prompt, an argument
        /// it did not take), and is stopped.
        /// </summary>
        void RunTool(string exe, string[] arguments, string who)
        {
            var quoted = new List<string>();
            foreach (string a in arguments) quoted.Add(Quote(a));
            var psi = new ProcessStartInfo(exe, string.Join(" ", quoted.ToArray()));
            psi.WorkingDirectory = Path.GetDirectoryName(exe);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            // What a tool prints (Pandora prints its whole trace) is drained,
            // not shown: each tool keeps its own log, which is what is checked.
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            Line("  " + who + ": " + Path.GetFileName(exe) + " " + psi.Arguments, "DarkGray");
            using (var watch = new GeneratedActivity(new[] { game, workDir }))
            using (Process p = Process.Start(psi))
            {
                p.OutputDataReceived += delegate { };
                p.ErrorDataReceived += delegate { };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                DateTime deadline = DateTime.UtcNow.AddMinutes(Minutes);
                DateTime quietSince = DateTime.UtcNow;
                TimeSpan cpuThen = TimeSpan.Zero;
                long eventsThen = 0;
                while (!p.WaitForExit(2000))
                {
                    p.Refresh();
                    TimeSpan cpu;
                    try { cpu = p.TotalProcessorTime; } catch (InvalidOperationException) { break; }
                    long events = watch.Events;
                    // More than a second of work, or any file, since it last did anything.
                    if ((cpu - cpuThen).TotalMilliseconds > 1000 || events != eventsThen) { quietSince = DateTime.UtcNow; cpuThen = cpu; eventsThen = events; }
                    double quiet = (DateTime.UtcNow - quietSince).TotalSeconds;
                    if (quiet >= StallSeconds || DateTime.UtcNow > deadline)
                    {
                        try { p.Kill(); } catch (InvalidOperationException) { /* it had already exited, so there is nothing to stop */ }
                        p.WaitForExit();
                        if (quiet >= StallSeconds)
                            throw new GeneratedStop(who + " used almost no processor time and changed no file for " + StallSeconds + " seconds, so it was waiting on something nobody here can answer " +
                                "(a window, a prompt, or an argument it did not take). It was stopped and nothing was recorded. Run it by hand from " + Path.GetDirectoryName(exe) + " to see what it waits on.");
                        throw new GeneratedStop(who + " was still working after " + Minutes + " minutes, so it was stopped and nothing was recorded.");
                    }
                }
                p.WaitForExit();
                if (p.ExitCode != 0)
                    throw new GeneratedStop(who + " stopped with exit code " + p.ExitCode + ". Nothing was recorded. Its own log is in " + Path.GetDirectoryName(exe) + ".");
            }
        }

        // ------------------------------------------------------------ the folder's files

        /// <summary>Every file under Game\Data as "bytes|write time", without following a folder link out of the folder.</summary>
        Dictionary<string, string> Snap()
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var stack = new Stack<string>();
            stack.Push(data);
            int cut = game.Length + 1;
            while (stack.Count > 0)
            {
                string dir = stack.Pop();
                foreach (string f in Directory.GetFiles(dir))
                {
                    var fi = new FileInfo(f);
                    d[f.Substring(cut)] = fi.Length.ToString(CultureInfo.InvariantCulture) + "|" + fi.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture);
                }
                foreach (string sub in Directory.GetDirectories(dir))
                {
                    if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0) continue;
                    stack.Push(sub);
                }
            }
            return d;
        }

        /// <summary>What is new, changed or deleted between two snapshots.</summary>
        static List<string> Changed(Dictionary<string, string> before, Dictionary<string, string> after)
        {
            var l = new List<string>();
            foreach (var kv in after)
            {
                string was;
                if (!before.TryGetValue(kv.Key, out was) || was != kv.Value) l.Add(kv.Key);
            }
            foreach (string rel in before.Keys) if (!after.ContainsKey(rel)) l.Add(rel);
            return l;
        }

        static string First(List<string> l, int n)
        {
            return string.Join(", ", l.GetRange(0, Math.Min(n, l.Count)).ToArray());
        }

        static bool InTool(string rel)
        {
            foreach (string t in Generated.ToolDirs) if (rel.StartsWith(t, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// Gives this folder's name for a file a copy of its own, as it is now,
        /// so a tool writing it in place writes only here. The other names keep
        /// their file. True when there was a link to undo.
        /// </summary>
        bool SplitLink(string path)
        {
            if (GeneratedOs.Links(path) <= 1) return false;
            if ((File.GetAttributes(path) & FileAttributes.ReadOnly) != 0)
            {
                // Clearing it would change the attribute of every name, the
                // Steam copy's included, so this stops instead.
                throw new GeneratedStop(path + " is read only and shared with another folder, so this folder cannot be given its own copy without changing the other one. " +
                    "Clear read only on it in Vortex's own copy, deploy, and run this again.");
            }
            string tmp = path + ".thornswood-own";
            File.Copy(path, tmp, true);
            File.Delete(path);
            File.Move(tmp, path);
            return true;
        }

        /// <summary>
        /// Stops when a file the tools changed is shared with another folder:
        /// the change is in Vortex's copy or the Steam copy as well.
        /// </summary>
        void NoWriteThrough(List<string> changed, string who)
        {
            var through = new List<string>();
            foreach (string rel in changed)
            {
                string p = Path.Combine(game, rel);
                if (File.Exists(p) && GeneratedOs.Links(p) > 1) through.Add(rel);
            }
            if (through.Count > 0)
                throw new GeneratedStop(who + " wrote into " + through.Count + " file(s) this folder shares with another (" + First(through, 5) +
                    "), so the same change is in Vortex's copy or the Steam copy of it. Nothing was recorded. Put Vortex's copies back (Vortex, Deploy), " +
                    "and send the launcher log to staff with which files these were.");
        }

        /// <summary>
        /// The path under the game folder in the letter case the folder already
        /// uses, so a tool that writes Behaviors\0_Master.hkx puts its file
        /// where behaviors\0_master.hkx is, under that name, and the record
        /// keeps one name for it.
        /// </summary>
        string ResolveRel(string rel)
        {
            string cur = game;
            var outp = new List<string>();
            foreach (string seg in rel.Split('\\'))
            {
                string name = seg;
                if (Directory.Exists(cur))
                    foreach (string e in Directory.EnumerateFileSystemEntries(cur))
                    {
                        string leaf = Path.GetFileName(e);
                        if (string.Equals(leaf, seg, StringComparison.OrdinalIgnoreCase)) { name = leaf; break; }
                    }
                outp.Add(name);
                cur = Path.Combine(cur, name);
            }
            return string.Join("\\", outp.ToArray());
        }

        /// <summary>
        /// Puts a file a tool made in a work folder into the game folder as a
        /// new file of this folder's own. Deleting the name first drops only
        /// this folder's link; Vortex's copy and the Steam copy keep theirs.
        /// Returns the path it went to.
        /// </summary>
        string PutOutput(string from, string rel)
        {
            rel = ResolveRel(rel);
            string dest = Path.Combine(game, rel);
            if (File.Exists(dest)) File.Delete(dest);
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            File.Copy(from, dest);
            return rel;
        }
    }

    /// <summary>What the build asks of Windows: a file's number of names, and one rename over a record.</summary>
    public static class GeneratedOs
    {
        [StructLayout(LayoutKind.Sequential)]
        struct Info
        {
            public uint Attributes;
            // The three FILETIMEs, each two DWORDs, as plain numbers.
            public uint CLow, CHigh, ALow, AHigh, WLow, WHigh;
            public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }

        // DllImport and not LibraryImport: scripts\mods\Generated.ps1 compiles
        // this file with Add-Type, in Windows PowerShell 5.1 as well as 7,
        // and Add-Type runs no source generators, so a LibraryImport partial
        // has no body there (CS8795). The native build makes these two calls'
        // marshalling when it compiles (a handle, a plain structure, a UTF-16
        // string), so nothing is made at run time.
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetFileInformationByHandle(SafeFileHandle h, out Info info);

        [DllImport("kernel32.dll", EntryPoint = "MoveFileExW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool MoveFileEx(string existing, string replacement, int flags);

        const int MoveReplaceExisting = 0x1;
        const int MoveWriteThrough = 0x8;

        public static bool OnWindows { get { return Environment.OSVersion.Platform == PlatformID.Win32NT; } }

        /// <summary>
        /// How many names the file has: more than one is a hard link shared
        /// with another folder (Vortex's copy, the Steam copy). Off Windows
        /// (a harness in a cloud session) every file counts as its own.
        /// </summary>
        public static int Links(string path)
        {
            if (!OnWindows) return 1;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                Info i;
                if (!GetFileInformationByHandle(fs.SafeFileHandle, out i)) throw new IOException("the link count of " + path + " cannot be read");
                return (int)i.Links;
            }
        }

        /// <summary>
        /// Renames from over to in one step, so nothing ever reads half a
        /// record (#2586): one MoveFileEx with MOVEFILE_REPLACE_EXISTING, the
        /// call OwnGame.WriteRecord makes. Deleting the old record and moving
        /// the new one in left a moment with no record at all, and File.Replace
        /// has the same moment inside it. Off Windows File.Replace is rename(2),
        /// which replaces in one step as well.
        /// </summary>
        public static void Replace(string from, string to)
        {
            if (!OnWindows)
            {
                if (File.Exists(to)) File.Replace(from, to, null); else File.Move(from, to);
                return;
            }
            if (!MoveFileEx(from, to, MoveReplaceExisting | MoveWriteThrough))
                throw new IOException(to + " could not be replaced by " + from + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
        }
    }

    /// <summary>
    /// Counts every file created, changed, deleted or renamed under the folders
    /// it is given, so a tool that writes is known to be working.
    /// </summary>
    public sealed class GeneratedActivity : IDisposable
    {
        long events;
        readonly List<FileSystemWatcher> watchers = new List<FileSystemWatcher>();

        public GeneratedActivity(string[] dirs)
        {
            foreach (string d in dirs)
            {
                if (string.IsNullOrEmpty(d) || !Directory.Exists(d)) continue;
                var w = new FileSystemWatcher(d);
                w.IncludeSubdirectories = true;
                w.InternalBufferSize = 65536;
                w.NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size;
                FileSystemEventHandler seen = delegate { Interlocked.Increment(ref events); };
                w.Changed += seen; w.Created += seen; w.Deleted += seen;
                w.Renamed += delegate { Interlocked.Increment(ref events); };
                // Too much at once to list is a great deal of work, not none.
                w.Error += delegate { Interlocked.Increment(ref events); };
                w.EnableRaisingEvents = true;
                watchers.Add(w);
            }
        }

        public long Events { get { return Interlocked.Read(ref events); } }

        public void Dispose() { foreach (FileSystemWatcher w in watchers) w.Dispose(); }
    }
}
