using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace Thornswood
{
    /// <summary>
    /// What Thornswood's generated files are, what they were built from, and
    /// whether the ones in a game folder are still current (issue #1247).
    ///
    /// The behavior files Pandora Behaviour Engine+ makes and the bodies
    /// BodySlide builds are made from other people's work: the game's own
    /// animation graphs with Precision's and True Directional Movement's
    /// patches merged in, and CBBE 3BA's, CBBE's and HIMBO's bodies. Patrick,
    /// 27 Oct 2026 (#3715, option A): none of them ships. The launcher makes
    /// them on each computer, in Thornswood's own folder, from the copies of
    /// Pandora, BodySlide and the mods the collection installed there
    /// (GeneratedHere.cs, GeneratedBuild.cs), the way the main menu and the
    /// mods' menus are made from the person's own game (#2827, #3113). What
    /// travels is the recipe, records\generated.json, which the launcher
    /// carries inside it: Thornswood's own numbers, nobody's files.
    ///
    /// The record of a build is in the install's own profile:
    ///
    ///     &lt;Root&gt;\Profile\OwnGame\generated.txt
    ///
    ///     generated 1
    ///     game C:\Thornswood\Game
    ///     built 2026-09-29T21:04:11
    ///     part list &lt;sha256&gt;          records\generated.json and the recipe
    ///     part plugins &lt;sha256&gt;       the mod list, Profile\OwnGame\plugins.txt
    ///     part behaviors &lt;sha256&gt;     Vortex's files Pandora reads
    ///     part bodyslide &lt;sha256&gt;     Vortex's files BodySlide builds from
    ///     inputs &lt;sha256&gt;             all four together
    ///     file &lt;sha256&gt; &lt;path&gt;        one line per file it made, path under the game folder
    ///
    /// The launcher reads the file lines (OwnGameKinds.cs): each is
    /// Thornswood's own, and a refresh leaves it as built even where Vortex
    /// deploys a file of the same name.
    ///
    /// CURRENT means: the record is there, for this folder, every part matches
    /// what is on this machine now, and every file on it is in the folder with
    /// the bytes it was built with. The parts are read from the launcher's own
    /// record of what Vortex deployed (files.txt, the V lines, with the size
    /// and time of Vortex's own copy), never from the folder's files, which the
    /// tools rewrite. So a collection revision that changes a behavior patch,
    /// an animation list, a slider set or BodySlide itself makes it stale, and
    /// so does a changed mod list or a change to records\generated.json.
    ///
    /// Compiled on its own by scripts\mods\Generated.ps1 and Build-Generated.ps1
    /// for a hand-run folder, as Go.ps1 compiles FromGame*.cs, so it keeps to
    /// what Windows PowerShell 5.1's compiler takes and reads JSON itself
    /// (GeneratedJson) rather than leaning on Config.cs.
    /// </summary>
    public static class Generated
    {
        /// <summary>
        /// Move this when the build changes what it builds or how, so every
        /// record made the old way reads as stale.
        /// </summary>
        public const int Recipe = 2;

        /// <summary>
        /// Vortex's files each tool reads, by path under the game folder. What
        /// one of them is changes the tool's output, so a change to any makes
        /// the build stale. Pandora: the patches (Nemesis' format and its own),
        /// Pandora itself in the folder the collection puts it in, and the
        /// animations and lists under meshes.
        /// </summary>
        public static readonly string[] BehaviorInputs = {
            @"^Data\\Nemesis_Engine\\mod\\",
            @"^Data\\Pandora_Engine\\",
            @"^Data\\[^\\]*pandora[^\\]*\\",
            @"^Data\\meshes\\actors\\.+\.(hkx|txt)$",
            @"^Data\\meshes\\[^\\]+\.txt$"
        };
        public static readonly string[] BodySlideInputs = {
            @"^Data\\CalienteTools\\BodySlide\\",
            @"^Data\\meshes\\actors\\character\\character assets\\"
        };

        /// <summary>
        /// The tools' own folders. What BodySlide writes there (its settings,
        /// its log, the group and preset made for a build) is the tool's, never
        /// output. Pandora runs from a copy in the work folder and writes
        /// nothing in the game folder at all.
        /// </summary>
        public static readonly string[] ToolDirs = { @"Data\CalienteTools\" };

        /// <summary>
        /// BODY SHAPE (issue #1004). Patrick, 28 Sep: nothing that changes
        /// breasts, the seat, genitals or nipples. A slider whose name says it
        /// shapes one of them must stay where it does nothing: 0, or 100 on an
        /// inverted slider.
        /// </summary>
        public const string ShapeRule = "(?i)(breast|boob|bust|cleavage|nipple|areola|butt|glute|booty|cheek|crotch|vagina|labia|clit|pussy|anus|anal|genital|schlong|penis|scrotum|testic|bulge|pubic|camel|push.?up|melon|oppai|chest|7b)";

        /// <summary>
        /// COVERED (issue #405). A zap slider takes a whole shape off the mesh.
        /// One named for the underwear must stay at 0, or the body is built nude.
        /// </summary>
        public const string CoverRule = "(?i)(bra|panty|panties|underwear|boxer|brief|loincloth|thong|shorts|top|smallclothes)";

        // ------------------------------------------------------------ hashes

        public static string Sha(byte[] bytes)
        {
            using (var h = SHA256.Create())
            {
                var sb = new StringBuilder(64);
                foreach (byte b in h.ComputeHash(bytes)) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        public static string TextSha(string text) { return Sha(new UTF8Encoding(false).GetBytes(text)); }

        public static string FileSha(string path)
        {
            using (var h = SHA256.Create())
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                var sb = new StringBuilder(64);
                foreach (byte b in h.ComputeHash(fs)) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        /// <summary>
        /// A path under a folder, from a relative path written the Windows way
        /// (the records and files.txt write them so). Off Windows, where a
        /// harness reads a scratch folder, the separators are the system's,
        /// as Join-Path gives them, so the same files are found.
        /// </summary>
        public static string Under(string dir, string rel)
        {
            return Path.Combine(dir, Path.DirectorySeparatorChar == '\\' ? rel : rel.Replace('\\', Path.DirectorySeparatorChar));
        }

        // ------------------------------------------------------------ the record

        public static string RecordPath(string root) { return Under(root, "Profile\\OwnGame\\generated.txt"); }

        // ------------------------------------------------------------ inputs

        /// <summary>
        /// The files of Pandora's mod when Vortex deployed its archive loose
        /// into Data. The build and its freshness check must agree on the exe
        /// and every library.
        /// </summary>
        public static List<string> LoosePandoraFiles(string root)
        {
            string made = Under(root, "Profile\\OwnGame\\made.txt");
            string source = "", steam = "";
            if (File.Exists(made))
                foreach (string line in File.ReadAllLines(made))
                {
                    Match m = Regex.Match(line.TrimStart('\uFEFF'), "^(source|game)=(.+)$");
                    if (!m.Success) continue;
                    if (m.Groups[1].Value == "source") source = m.Groups[2].Value.Trim(); else steam = m.Groups[2].Value.Trim();
                }
            if (source.Length == 0) throw new GeneratedStop(made + " names no source, so the files of Pandora's mod cannot be read.");
            // The source may itself be a Thornswood folder rather than the one
            // Vortex deploys into: the dev release folder and the main install
            // on One both record source=C:\Thornswood-DevBuild\Game. A
            // Thornswood folder never holds Vortex's record, so follow each
            // Thornswood folder's own record back to the folder that has it, a
            // few steps at most so a loop of records cannot spin, and when the
            // chain ends without it, take the game folder the record names
            // (game=, the Steam copy Vortex deploys into).
            string manifest = Under(source, "Data\\vortex.deployment.json");
            var seen = new List<string> { source };
            for (int hop = 0; hop < 4 && !File.Exists(manifest); hop++)
            {
                string back = Under(Path.GetDirectoryName(source.TrimEnd('\\')) ?? "", "Profile\\OwnGame\\made.txt");
                string next = "";
                if (File.Exists(back))
                    foreach (string line in File.ReadAllLines(back))
                    {
                        Match m = Regex.Match(line.TrimStart('\uFEFF'), "^source=(.+)$");
                        if (m.Success) next = m.Groups[1].Value.Trim();
                    }
                if (next.Length == 0 || seen.Contains(next)) break;
                seen.Add(next);
                source = next;
                manifest = Under(source, "Data\\vortex.deployment.json");
            }
            if (!File.Exists(manifest) && steam.Length > 0)
            {
                string atSteam = Under(steam, "Data\\vortex.deployment.json");
                if (File.Exists(atSteam)) manifest = atSteam;
            }
            if (!File.Exists(manifest)) throw new GeneratedStop("Vortex's record (" + manifest + ") cannot be read, so the files of Pandora's mod cannot be read.");
            List<VortexFile> files = VortexFile.Read(manifest);
            var mine = files.FindAll(delegate(VortexFile f) { return f.RelPath.Equals("Pandora Behaviour Engine+.exe", StringComparison.OrdinalIgnoreCase); });
            if (mine.Count != 1) throw new GeneratedStop("Vortex's record (" + manifest + ") does not name one mod for Pandora Behaviour Engine+.exe.");
            var l = new List<string>();
            foreach (VortexFile f in files) if (f.Source == mine[0].Source) l.Add(f.RelPath.TrimStart('\\'));
            return l;
        }

        /// <summary>
        /// The four parts a build depends on, each as a sha256, and all four
        /// together. Reads the launcher's record of what Vortex deployed, never
        /// the folder itself.
        /// </summary>
        public static GeneratedInputs Inputs(string root, GeneratedList list)
        {
            string filesTxt = Under(root, "Profile\\OwnGame\\files.txt");
            if (!File.Exists(filesTxt))
                throw new GeneratedStop("There is no " + filesTxt + ", the launcher's record of what Vortex deployed into this folder, so what the tools build from cannot be read.");
            var loose = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (File.Exists(Under(root, "Game\\Data\\Pandora Behaviour Engine+.exe")))
                foreach (string rel in LoosePandoraFiles(root)) loose.Add("Data\\" + rel);
            var nem = new List<string>();
            var bs = new List<string>();
            foreach (string line in File.ReadLines(filesTxt))
            {
                string[] p = line.Split(new[] { '|' }, 5);
                if (p.Length != 5 || p[1] != "V") continue;
                string rel = p[4];
                string row = rel.ToLowerInvariant() + "|" + p[2] + "|" + p[3];
                if (loose.Contains(rel)) nem.Add(row);
                else foreach (string rx in BehaviorInputs) if (Regex.IsMatch(rel, rx, RegexOptions.IgnoreCase)) { nem.Add(row); break; }
                foreach (string rx in BodySlideInputs) if (Regex.IsMatch(rel, rx, RegexOptions.IgnoreCase)) { bs.Add(row); break; }
            }
            nem.Sort(StringComparer.Ordinal);
            bs.Sort(StringComparer.Ordinal);

            string plugins = Under(root, "Profile\\OwnGame\\plugins.txt");
            string pl = "none";
            if (File.Exists(plugins))
            {
                var keep = new List<string>();
                foreach (string raw in File.ReadAllLines(plugins))
                {
                    string t = raw.Trim();
                    if (t.Length > 0 && !t.StartsWith("#")) keep.Add(t);
                }
                pl = string.Join("\n", keep.ToArray());
            }
            string listText = list.Text.Replace("\r\n", "\n") + "\nrecipe=" + Recipe;

            var r = new GeneratedInputs();
            r.Parts.Add(new KeyValuePair<string, string>("list", TextSha(listText)));
            r.Parts.Add(new KeyValuePair<string, string>("plugins", TextSha(pl)));
            r.Parts.Add(new KeyValuePair<string, string>("behaviors", TextSha(string.Join("\n", nem.ToArray()))));
            r.Parts.Add(new KeyValuePair<string, string>("bodyslide", TextSha(string.Join("\n", bs.ToArray()))));
            var all = new List<string>();
            foreach (var kv in r.Parts) all.Add(kv.Key + "=" + kv.Value);
            r.Sha = TextSha(string.Join("\n", all.ToArray()));
            r.BehaviorFiles = nem.Count;
            r.BodySlideFiles = bs.Count;
            return r;
        }

        /// <summary>What a part changing means, in plain words.</summary>
        public static string PartSays(string part)
        {
            switch (part)
            {
                case "list": return "what records\\generated.json says to build, or how the build makes it, changed";
                case "plugins": return "the mod list changed (Profile\\OwnGame\\plugins.txt)";
                case "behaviors": return "a file Pandora reads changed in Vortex (a behavior patch, an animation list or Pandora itself)";
                case "bodyslide": return "a file BodySlide builds from changed in Vortex (a slider set, its shape data, a body mesh or BodySlide itself)";
            }
            return part + " changed";
        }

        /// <summary>
        /// Whether the generated files in &lt;Root&gt;\Game are current: Current,
        /// or not with Why saying each reason in plain words.
        /// </summary>
        public static GeneratedState State(string root, GeneratedList list)
        {
            string game = Under(root, "Game");
            var why = new List<string>();
            var st = new GeneratedState { Game = game };
            GeneratedRecord rec = GeneratedRecord.Read(RecordPath(root));
            st.Record = rec;
            if (rec == null)
            {
                why.Add("they have never been built in " + game);
                st.Why = why.ToArray();
                return st;
            }
            GeneratedInputs inputs = Inputs(root, list);
            st.Inputs = inputs;
            if (rec.Game.Length > 0 && !string.Equals(rec.Game.TrimEnd('\\'), game.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                why.Add("they were built for " + rec.Game + ", not this folder");
            foreach (var kv in inputs.Parts)
            {
                string was = rec.Part(kv.Key) ?? "";
                if (was != kv.Value) why.Add(PartSays(kv.Key));
            }
            if (rec.Files.Count == 0) why.Add("the record of the last build lists no files");
            var off = new List<string>();
            foreach (GeneratedFile f in rec.Files)
            {
                string p = Under(game, f.Rel);
                if (!File.Exists(p)) { off.Add(f.Rel + " is gone"); continue; }
                if (FileSha(p) != f.Sha) off.Add(f.Rel + " is not as built");
            }
            if (off.Count > 0)
            {
                int show = Math.Min(4, off.Count);
                string more = off.Count > show ? " and " + (off.Count - show) + " more" : "";
                why.Add(string.Format(CultureInfo.InvariantCulture,
                    "{0} of the {1} files it built {2} not in the folder as built, most likely because the launcher made the folder again or a refresh put Vortex's back: {3}{4}",
                    off.Count, rec.Files.Count, off.Count == 1 ? "is" : "are", string.Join(", ", off.GetRange(0, show).ToArray()), more));
            }
            st.Why = why.ToArray();
            st.Current = why.Count == 0;
            return st;
        }

        // ------------------------------------------------------------ BodySlide sets

        /// <summary>
        /// One slider set, out of the .osp files in SliderSets: its output and
        /// shapes, and every slider with its defaults. Throws when no .osp has
        /// it, or two do.
        /// </summary>
        public static BodySlideSet Set(string sliderSetsDir, string name)
        {
            var found = new List<BodySlideSet>();
            foreach (string osp in Directory.GetFiles(sliderSetsDir, "*.osp"))
            {
                var x = new XmlDocument();
                x.Load(osp);
                foreach (XmlElement s in x.SelectNodes("/SliderSetInfo/SliderSet"))
                {
                    if (s.GetAttribute("name") != name) continue;
                    var set = new BodySlideSet { Name = name, File = osp };
                    foreach (XmlElement sl in s.SelectNodes("Slider"))
                    {
                        set.Sliders.Add(new BodySlideSlider
                        {
                            Name = sl.GetAttribute("name"),
                            Big = Num(sl.GetAttribute("big")),
                            Small = Num(sl.GetAttribute("small")),
                            Invert = sl.GetAttribute("invert") == "true",
                            Zap = sl.GetAttribute("zap") == "true",
                            Hidden = sl.GetAttribute("hidden") == "true"
                        });
                    }
                    XmlNode outPath = s.SelectSingleNode("OutputPath");
                    var outNode = s.SelectSingleNode("OutputFile") as XmlElement;
                    set.OutputPath = outPath == null ? "" : outPath.InnerText;
                    set.OutputFile = outNode == null ? "" : outNode.InnerText;
                    set.GenWeights = outNode != null && outNode.GetAttribute("GenWeights") == "true";
                    foreach (XmlNode sh in s.SelectNodes("Shape")) set.Shapes.Add(sh.InnerText);
                    found.Add(set);
                }
            }
            if (found.Count == 0) throw new GeneratedStop("No slider set named '" + name + "' is in " + sliderSetsDir + ". It comes with the collection; is the mod that has it deployed?");
            if (found.Count > 1)
            {
                var names = new List<string>();
                foreach (BodySlideSet f in found) names.Add(Path.GetFileName(f.File));
                throw new GeneratedStop("Two slider sets are named '" + name + "' (" + string.Join(", ", names.ToArray()) + "), so which one is built cannot be told.");
            }
            return found[0];
        }

        static double Num(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            return double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// The files a slider set writes, under the game folder:
        /// OutputPath\OutputFile, as _0 and _1 when it builds weights. A set
        /// that would write anything outside meshes is refused (#2454).
        /// </summary>
        public static List<string> SetOutputs(BodySlideSet set)
        {
            string dir = set.OutputPath.Trim().Trim('\\').Replace('/', '\\');
            string name = set.OutputFile.Trim();
            if (dir.Length == 0 || name.Length == 0) throw new GeneratedStop("The slider set '" + set.Name + "' names no output, so what it builds cannot be told.");
            if (!Regex.IsMatch(dir, @"(?i)^meshes\\") || dir.Contains("..")) throw new GeneratedStop("The slider set '" + set.Name + "' writes to " + dir + ", outside meshes.");
            var l = new List<string>();
            if (set.GenWeights) { l.Add("Data\\" + dir + "\\" + name + "_0.nif"); l.Add("Data\\" + dir + "\\" + name + "_1.nif"); }
            else l.Add("Data\\" + dir + "\\" + name + ".nif");
            return l;
        }

        /// <summary>Whether a path under the game folder is one of the bodies (#405 checks those); an outfit set may not write one.</summary>
        public static bool IsBodyPath(string rel)
        {
            return Regex.IsMatch(rel, @"(?i)^Data\\meshes\\actors\\character\\character assets\\(female|male)body");
        }

        /// <summary>Every slider of a set at the value it is built with: its default, or what the build list moves it to.</summary>
        public static List<BodySlideValue> Values(BodySlideSet set, Dictionary<string, Dictionary<string, double>> moves)
        {
            var l = new List<BodySlideValue>();
            foreach (BodySlideSlider sl in set.Sliders)
            {
                double big = sl.Big, small = sl.Small;
                Dictionary<string, double> m;
                if (moves != null && moves.TryGetValue(sl.Name, out m))
                {
                    double v;
                    if (m.TryGetValue("big", out v)) big = v;
                    if (m.TryGetValue("small", out v)) small = v;
                }
                l.Add(new BodySlideValue { Name = sl.Name, Big = big, Small = small, Slider = sl });
            }
            return l;
        }

        /// <summary>
        /// What would break the body rules in a set built at these values: a
        /// slider that shapes the breasts, the seat, the genitals or the nipples
        /// doing anything (#1004), a zap taking the underwear off (#405), any
        /// other zap moved from its default, and a move that names a slider the
        /// set does not have. Empty when the build keeps to the rules.
        /// </summary>
        public static List<string> Rules(BodySlideSet set, List<BodySlideValue> values, Dictionary<string, Dictionary<string, double>> moves)
        {
            var bad = new List<string>();
            foreach (BodySlideValue v in values)
            {
                BodySlideSlider sl = v.Slider;
                foreach (string size in new[] { "big", "small" })
                {
                    double val = size == "big" ? v.Big : v.Small;
                    double def = size == "big" ? sl.Big : sl.Small;
                    if (sl.Zap)
                    {
                        if (Regex.IsMatch(sl.Name, CoverRule))
                        {
                            if (val != 0) bad.Add(string.Format(CultureInfo.InvariantCulture, "'{0}' in {1} takes the underwear off at {2} ({3}); it has to stay at 0", sl.Name, set.Name, val, size));
                        }
                        else if (val != def)
                            bad.Add(string.Format(CultureInfo.InvariantCulture, "'{0}' in {1} is a zap moved from its default {2} to {3} ({4})", sl.Name, set.Name, def, val, size));
                        continue;
                    }
                    if (Regex.IsMatch(sl.Name, ShapeRule))
                    {
                        double none = sl.Invert ? 100 : 0;
                        if (val != none) bad.Add(string.Format(CultureInfo.InvariantCulture, "'{0}' in {1} shapes the body at {2} ({3}); it has to stay at {4}, where it does nothing", sl.Name, set.Name, val, size, none));
                    }
                }
            }
            if (moves != null)
                foreach (string k in moves.Keys)
                    if (!set.Sliders.Exists(delegate(BodySlideSlider s) { return s.Name == k; }))
                        bad.Add(string.Format(CultureInfo.InvariantCulture, "records\\generated.json moves '{0}', which {1} does not have", k, set.Name));
            return bad;
        }
    }

    /// <summary>A refusal: the sentence to show, and the exit code a script gives it (1 stopped, 3 the folder is in use).</summary>
    public sealed class GeneratedStop : Exception
    {
        public readonly int Code;
        public GeneratedStop(string message) : this(message, 1) { }
        public GeneratedStop(string message, int code) : base(message) { Code = code; }
    }

    /// <summary>records\generated.json, checked.</summary>
    public sealed class GeneratedList
    {
        public string Path = "";
        public string Text = "";
        public List<string> Patches = new List<string>();
        public List<string> Sets = new List<string>();
        public List<string> Outfits = new List<string>();
        public Dictionary<string, Dictionary<string, Dictionary<string, double>>> Sliders = new Dictionary<string, Dictionary<string, Dictionary<string, double>>>();

        public static GeneratedList Read(string path)
        {
            if (!File.Exists(path)) throw new GeneratedStop("There is no build list at " + path + ".");
            return Parse(File.ReadAllText(path), path);
        }

        /// <summary>Throws with the sentence to show.</summary>
        public static GeneratedList Parse(string text, string path)
        {
            var l = new GeneratedList { Path = path, Text = text.TrimStart('\uFEFF') };
            Dictionary<string, object> doc;
            try { doc = GeneratedJson.Parse(l.Text) as Dictionary<string, object>; }
            catch (Exception ex) { throw new GeneratedStop(path + " is not valid JSON: " + Failure.Why("Generated, " + path, ex, path)); }
            if (doc == null) throw new GeneratedStop(path + " is not valid JSON: it is not an object.");
            // A version this build does not know stops here (RecordShape.ps1, #2180).
            object ver;
            if (doc.TryGetValue("version", out ver) && !"1".Equals(ver as string))
                throw new GeneratedStop(path + " is not a generated build list this build can trust: it is version " + ver + ", and this build knows 1: update it, or the record came from somewhere else");
            var pandora = Get(doc, "pandora") as Dictionary<string, object>;
            var bodyslide = Get(doc, "bodyslide") as Dictionary<string, object>;
            if (pandora == null && bodyslide == null)
                throw new GeneratedStop(path + " is not a generated build list this build can trust: it has neither pandora nor bodyslide, so it builds nothing");
            // Either part may be left out; what is there must be whole
            // (scripts\release\RecordShape.ps1 holds the same shape).
            if (pandora != null && !(Get(pandora, "patches") is List<object>))
                throw new GeneratedStop(path + " is not a generated build list this build can trust: pandora.patches is missing or not a list of patch codes");
            if (bodyslide != null && !(Get(bodyslide, "sets") is List<object>))
                throw new GeneratedStop(path + " is not a generated build list this build can trust: bodyslide.sets is missing or not a list of set names");
            if (bodyslide != null && Get(bodyslide, "sliders") != null && !(Get(bodyslide, "sliders") is Dictionary<string, object>))
                throw new GeneratedStop(path + " is not a generated build list this build can trust: bodyslide.sliders is there and not a map");
            l.Patches = Strings(Get(pandora, "patches"), path, "pandora.patches");
            foreach (string p in l.Patches)
                if (!Regex.IsMatch(p, "^[A-Za-z0-9_]+$"))
                    throw new GeneratedStop(path + " names a behavior patch '" + p + "', which is not a patch code (the folder name under Data\\Nemesis_Engine\\mod or Data\\Pandora_Engine\\mod).");
            l.Sets = Strings(Get(bodyslide, "sets"), path, "bodyslide.sets");
            foreach (string s in l.Sets) if (s.Trim().Length == 0) throw new GeneratedStop(path + " names an empty BodySlide slider set.");
            // Outfits fitted to those bodies (#2454): built the same way, under
            // the same rules, and never a body as well.
            l.Outfits = Strings(Get(bodyslide, "outfits"), path, "bodyslide.outfits");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (string s in l.Outfits)
            {
                if (s.Trim().Length == 0) throw new GeneratedStop(path + " names an empty BodySlide outfit set.");
                if (l.Sets.Contains(s)) throw new GeneratedStop(path + " names '" + s + "' as a body and as an outfit; it is one or the other.");
                if (!seen.Add(s)) throw new GeneratedStop(path + " names the outfit set '" + s + "' more than once.");
            }
            var sliders = Get(bodyslide, "sliders") as Dictionary<string, object>;
            if (sliders != null)
                foreach (var sp in sliders)
                {
                    if (!l.Sets.Contains(sp.Key) && !l.Outfits.Contains(sp.Key))
                        throw new GeneratedStop(path + " moves sliders of '" + sp.Key + "', which is not one of the sets it builds.");
                    var one = new Dictionary<string, Dictionary<string, double>>(StringComparer.Ordinal);
                    var byName = sp.Value as Dictionary<string, object>;
                    if (byName != null)
                        foreach (var sl in byName)
                        {
                            var v = new Dictionary<string, double>(StringComparer.Ordinal);
                            var sizes = sl.Value as Dictionary<string, object>;
                            if (sizes != null)
                                foreach (string size in new[] { "big", "small" })
                                {
                                    object n;
                                    if (sizes.TryGetValue(size, out n) && n is string)
                                        v[size] = double.Parse((string)n, NumberStyles.Float, CultureInfo.InvariantCulture);
                                }
                            one[sl.Key] = v;
                        }
                    l.Sliders[sp.Key] = one;
                }
            if (l.Patches.Count == 0 && l.Sets.Count == 0 && l.Outfits.Count == 0) throw new GeneratedStop(path + " names nothing to build.");
            return l;
        }

        static object Get(Dictionary<string, object> o, string k)
        {
            object v;
            return o != null && o.TryGetValue(k, out v) ? v : null;
        }

        static List<string> Strings(object v, string path, string what)
        {
            var l = new List<string>();
            if (v == null) return l;
            var a = v as List<object>;
            if (a == null) throw new GeneratedStop(path + " is not a generated build list this build can trust: " + what + " is not a list");
            foreach (object o in a)
            {
                var s = o as string;
                if (s == null) throw new GeneratedStop(path + " is not a generated build list this build can trust: " + what + " has an entry that is not text");
                l.Add(s);
            }
            return l;
        }
    }

    public sealed class GeneratedFile
    {
        public string Sha = "";
        public string Rel = "";
    }

    /// <summary>generated.txt, read and written.</summary>
    public sealed class GeneratedRecord
    {
        public int Version;
        public string Game = "", Built = "", Inputs = "";
        public List<KeyValuePair<string, string>> Parts = new List<KeyValuePair<string, string>>();
        public List<GeneratedFile> Files = new List<GeneratedFile>();

        public string Part(string k)
        {
            foreach (var kv in Parts) if (kv.Key == k) return kv.Value;
            return null;
        }

        /// <summary>
        /// The record, or null when there is none. Throws on a line it does not
        /// know, because a record read wrong would call a stale build current.
        /// </summary>
        public static GeneratedRecord Read(string path)
        {
            if (!File.Exists(path)) return null;
            var rec = new GeneratedRecord();
            int n = 0;
            foreach (string line in File.ReadAllLines(path))
            {
                n++;
                if (line.Trim().Length == 0) continue;
                Match m = Regex.Match(line, "^file ([0-9a-f]{64}) (.+)$");
                if (m.Success) { rec.Files.Add(new GeneratedFile { Sha = m.Groups[1].Value, Rel = m.Groups[2].Value }); continue; }
                m = Regex.Match(line, "^part ([a-z]+) ([0-9a-f]{64})$");
                if (m.Success) { rec.Parts.Add(new KeyValuePair<string, string>(m.Groups[1].Value, m.Groups[2].Value)); continue; }
                m = Regex.Match(line, "^inputs ([0-9a-f]{64})$");
                if (m.Success) { rec.Inputs = m.Groups[1].Value; continue; }
                m = Regex.Match(line, "^generated ([0-9]+)$");
                if (m.Success) { rec.Version = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture); continue; }
                m = Regex.Match(line, "^game (.+)$");
                if (m.Success) { rec.Game = m.Groups[1].Value; continue; }
                m = Regex.Match(line, "^built (.+)$");
                if (m.Success) { rec.Built = m.Groups[1].Value; continue; }
                throw new GeneratedStop("Line " + n + " of " + path + " is not one this understands: " + line);
            }
            return rec;
        }

        /// <summary>
        /// Writes the record in one step, so nothing ever reads half of one: the
        /// lines go to a file beside it, which is renamed over the record by one
        /// MoveFileEx with MOVEFILE_REPLACE_EXISTING (#2586), the call
        /// OwnGame.WriteRecord makes. Off Windows (a harness in a cloud
        /// session) File.Move over a file is rename(2), one step as well.
        /// </summary>
        public static void Write(string path, string game, GeneratedInputs inputs, List<GeneratedFile> files)
        {
            var lines = new List<string>();
            lines.Add("generated 1");
            lines.Add("game " + game);
            lines.Add("built " + DateTime.Now.ToString("s", CultureInfo.InvariantCulture));
            foreach (var kv in inputs.Parts) lines.Add("part " + kv.Key + " " + kv.Value);
            lines.Add("inputs " + inputs.Sha);
            var sorted = new List<GeneratedFile>(files);
            sorted.Sort(delegate(GeneratedFile a, GeneratedFile b) { return string.Compare(a.Rel, b.Rel, StringComparison.OrdinalIgnoreCase); });
            foreach (GeneratedFile f in sorted) lines.Add("file " + f.Sha + " " + f.Rel);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
            string tmp = path + ".new";
            File.WriteAllLines(tmp, lines.ToArray(), new UTF8Encoding(false));
            GeneratedOs.Replace(tmp, path);
        }
    }

    public sealed class GeneratedInputs
    {
        public string Sha = "";
        public List<KeyValuePair<string, string>> Parts = new List<KeyValuePair<string, string>>();
        public int BehaviorFiles, BodySlideFiles;
    }

    public sealed class GeneratedState
    {
        public bool Current;
        public string[] Why = new string[0];
        public GeneratedRecord Record;
        public GeneratedInputs Inputs;
        public string Game = "";
    }

    public sealed class BodySlideSlider
    {
        public string Name = "";
        public double Big, Small;
        public bool Invert, Zap, Hidden;
    }

    public sealed class BodySlideSet
    {
        public string Name = "", File = "", OutputPath = "", OutputFile = "";
        public bool GenWeights;
        public List<string> Shapes = new List<string>();
        public List<BodySlideSlider> Sliders = new List<BodySlideSlider>();
    }

    public sealed class BodySlideValue
    {
        public string Name = "";
        public double Big, Small;
        public BodySlideSlider Slider;
    }

    /// <summary>One file of Vortex's deployment record (Data\vortex.deployment.json).</summary>
    public sealed class VortexFile
    {
        public string RelPath = "", Source = "";
        public string StagingPath = "";

        public static List<VortexFile> Read(string manifest)
        {
            var doc = GeneratedJson.Parse(File.ReadAllText(manifest).TrimStart('\uFEFF')) as Dictionary<string, object>;
            var l = new List<VortexFile>();
            if (doc == null) return l;
            object staging, files;
            doc.TryGetValue("stagingPath", out staging);
            if (!doc.TryGetValue("files", out files) || !(files is List<object>)) return l;
            foreach (object o in (List<object>)files)
            {
                var f = o as Dictionary<string, object>;
                if (f == null) continue;
                object rel, src;
                f.TryGetValue("relPath", out rel);
                f.TryGetValue("source", out src);
                l.Add(new VortexFile { RelPath = (rel as string) ?? "", Source = (src as string) ?? "", StagingPath = (staging as string) ?? "" });
            }
            return l;
        }
    }

    /// <summary>
    /// A small JSON reader for the build list and Vortex's record. Objects
    /// come back as Dictionary&lt;string, object&gt;, arrays as List&lt;object&gt;,
    /// strings as string, numbers as their text, true and false as bool,
    /// null as null. Throws on anything that is not JSON. Config.cs has the
    /// launcher's own; this file is also compiled on its own (Generated.ps1).
    /// </summary>
    public static class GeneratedJson
    {
        public static object Parse(string s)
        {
            int i = 0;
            object v = Value(s, ref i);
            Space(s, ref i);
            if (i != s.Length) throw new FormatException("JSON has more after its end");
            return v;
        }

        static void Space(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

        static object Value(string s, ref int i)
        {
            Space(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON ends early");
            char c = s[i];
            if (c == '{')
            {
                var o = new Dictionary<string, object>(StringComparer.Ordinal);
                i++; Space(s, ref i);
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
            if (c == '[')
            {
                var a = new List<object>();
                i++; Space(s, ref i);
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
            if (c == '"') return Text(s, ref i);
            if (string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int start = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            if (i == start) throw new FormatException("JSON has an unexpected character at " + i);
            return s.Substring(start, i - start);
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
