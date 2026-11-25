using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// Says whether every body a game folder shows people is covered by
    /// underwear, men and women alike (issue #405). Patrick, 28 Sep: "I really
    /// just want no nudity in players or NPCs for both males and females." A
    /// body in Skyrim is one mesh per sex (femalebody_0.nif and _1.nif,
    /// malebody_0.nif and _1.nif), and every actor of that sex wears it under
    /// whatever they have on: people, NPCs, a body on the ground after it has
    /// been looted, and the figure in the race menu. So the underwear has to be
    /// part of that mesh. Vanilla Skyrim's are: FemaleUnderwear and
    /// MaleUnderwear_1 are shapes inside the stock meshes. A body replacer that
    /// leaves them out makes everybody of that sex nude the moment their
    /// clothes come off.
    ///
    /// MEASURED 28 SEP on the shipping machine: the female body the collection
    /// deploys is CBBE 3BA 2.48's prebuilt mesh, shapes 3BA, 3BA_Vagina and
    /// 3BA_Anus with no Bra or Panty, and the male body is HIMBO V5's
    /// NeverNude build, whose shapes include "HIMBO - Boxers". So the bodies
    /// are built covered, on each computer since #3715 (GeneratedBuild.cs),
    /// and this is the check that reads what was built and that nothing has
    /// undone it since.
    ///
    /// It reads each mesh's own list of shapes out of the nif (the names of its
    /// BSTriShape and NiTriShape blocks), rather than searching the file for a
    /// word: "Bra" turns up by chance in the bytes of malebody_1.nif, and bone
    /// names such as VaginaDeep1 and "NPC Genitals01" are in every
    /// skeleton-weighted body, covered or not. Then:
    ///
    /// - A woman's body (femalebody_0/_1) is covered when it has a shape for
    ///   the top (Bra, a top, or a one-piece Underwear) and one for the bottom
    ///   (Panty, Underwear, briefs, a loincloth).
    /// - Astrid's burned body (femalebodyastrid_0/_1, one NPC, after one Dark
    ///   Brotherhood scene) is charred skin with no underwear even in Skyrim's
    ///   own mesh, so it is listed on its own line and fails only when it
    ///   carries a genital shape.
    /// - A man's body (malebody_0/_1) is covered when it has a shape for the
    ///   bottom (Boxers, Underwear, briefs, a loincloth).
    /// - A body that is not loose in Data comes from the game's own archive,
    ///   and Skyrim's own bodies are covered.
    /// - Any other mesh under meshes\actors\character with a genital shape in
    ///   it (a 3BA extra body, The New Gentleman, Schlongs of Skyrim) has to
    ///   cover it the same way, or it counts as nude too.
    ///
    /// First-person bodies are not checked: the first-person camera draws the
    /// arms and hands, never the torso. Read only.
    ///
    /// scripts\mods\Check-CoveredBodies.ps1 runs it for a folder by hand.
    /// Compiled on its own by scripts\mods\Generated.ps1, so it keeps to what
    /// Windows PowerShell 5.1's compiler takes.
    /// </summary>
    public static class CoveredBodies
    {
        // Shape names that cover. Matched against whole words of a shape's
        // name, so "Bracers" is not a bra and "HIMBO - Boxers" is boxers.
        public const string TopWords = "(?i)(^|[^a-z])(bra|top|bandeau|chestwrap|breastband)([^a-z]|$)";
        public const string BottomWords = "(?i)(^|[^a-z])(panty|panties|pants|brief|briefs|boxer|boxers|loincloth|thong|shorts|smallclothes)([^a-z]|$)";
        // A one-piece: vanilla's FemaleUnderwear and MaleUnderwear_1, HIMBO's
        // "HIMBO - Underwear". Covers the top and the bottom.
        public const string OnePiece = "(?i)underwear";
        // Shape names that are anatomy. VaginaDeep1 and "NPC Genitals01" are
        // bones and never shape names, which is why this reads shapes and not
        // the whole file.
        public const string Anatomy = "(?i)(vagina|anus|labia|genital|penis|schlong|scrotum|testic)";

        static readonly string[][] Bodies = {
            new[] { "femalebody_0.nif", "female" },
            new[] { "femalebody_1.nif", "female" },
            new[] { "femalebodyastrid_0.nif", "astrid" },
            new[] { "femalebodyastrid_1.nif", "astrid" },
            new[] { "malebody_0.nif", "male" },
            new[] { "malebody_1.nif", "male" }
        };

        /// <summary>
        /// The header of a Skyrim nif (20.2.0.7, LE or SE) lists the block
        /// types, each block's type and size, and a table of strings; a shape
        /// block's first field is the index of its name in that table. Returns
        /// the names of the shape blocks, or throws when the file is not a nif
        /// this understands.
        /// </summary>
        public static string[] ShapeNames(string path)
        {
            byte[] b = File.ReadAllBytes(path);
            int nl = Array.IndexOf(b, (byte)10);
            if (nl < 0 || nl > 64) throw new InvalidDataException("no nif header line");
            string head = Encoding.ASCII.GetString(b, 0, nl);
            if (!Regex.IsMatch(head, @"^Gamebryo File Format, Version 20\.2\.0\.7")) throw new InvalidDataException("not a Skyrim nif (" + head + ")");
            try
            {
                int i = nl + 1;
                i += 4;                                     // version
                i += 1;                                     // endian
                i += 4;                                     // user version
                uint nBlocks = BitConverter.ToUInt32(b, i); i += 4;
                uint bsVer = BitConverter.ToUInt32(b, i); i += 4;
                int shorts = bsVer >= 130 ? 4 : 3;
                for (int k = 0; k < shorts; k++) i += 1 + b[i];
                int nTypes = BitConverter.ToUInt16(b, i); i += 2;
                var types = new string[nTypes];
                for (int k = 0; k < nTypes; k++)
                {
                    int l = checked((int)BitConverter.ToUInt32(b, i)); i += 4;
                    types[k] = Encoding.ASCII.GetString(b, i, l); i += l;
                }
                var blockType = new int[nBlocks];
                for (int k = 0; k < nBlocks; k++) { blockType[k] = BitConverter.ToUInt16(b, i) & 0x7FFF; i += 2; }
                var blockSize = new long[nBlocks];
                for (int k = 0; k < nBlocks; k++) { blockSize[k] = BitConverter.ToUInt32(b, i); i += 4; }
                uint nStrings = BitConverter.ToUInt32(b, i); i += 4;
                i += 4;                                     // longest string
                var strings = new string[nStrings];
                for (int k = 0; k < nStrings; k++)
                {
                    int l = checked((int)BitConverter.ToUInt32(b, i)); i += 4;
                    strings[k] = Encoding.ASCII.GetString(b, i, l); i += l;
                }
                uint nGroups = BitConverter.ToUInt32(b, i); i += checked((int)(4 + 4 * nGroups));
                var names = new List<string>();
                for (int k = 0; k < nBlocks; k++)
                {
                    if (i + blockSize[k] > b.Length) throw new InvalidDataException("block runs past the end of the file");
                    string t = types[blockType[k]];
                    if (Regex.IsMatch(t, "TriShape$|TriStrips$"))
                    {
                        int idx = BitConverter.ToInt32(b, i);
                        if (idx >= 0 && idx < nStrings) names.Add(strings[idx]);
                    }
                    i += checked((int)blockSize[k]);
                }
                return names.ToArray();
            }
            catch (ArgumentException ex) { throw new InvalidDataException("the header runs past the end of the file", ex); }
            catch (IndexOutOfRangeException) { throw new InvalidDataException("the header runs past the end of the file"); }
            catch (OverflowException) { throw new InvalidDataException("a length in the header is too large"); }
        }

        /// <summary>What a list of shape names says about a body. Sex is "female", "male" or "" (a mesh found by its anatomy).</summary>
        public static CoveredVerdict Verdict(string[] shapes, string sex)
        {
            bool top = false, bottom = false;
            var anatomy = new List<string>();
            foreach (string s in shapes)
            {
                if (Regex.IsMatch(s, TopWords) || Regex.IsMatch(s, OnePiece)) top = true;
                if (Regex.IsMatch(s, BottomWords) || Regex.IsMatch(s, OnePiece)) bottom = true;
                if (Regex.IsMatch(s, Anatomy)) anatomy.Add(s);
            }
            var v = new CoveredVerdict();
            v.Covered = sex == "female" ? top && bottom : bottom;
            if (sex == "female" && !top) v.Missing.Add("nothing over the chest");
            if (!bottom) v.Missing.Add("nothing over the groin");
            v.Anatomy = anatomy;
            return v;
        }

        /// <summary>
        /// Reads every body in game\Data and says each line through say (the
        /// line and its colour; quiet says only what is nude or unreadable, and
        /// the verdict). Nude and Unread count what was found; the verdict is
        /// covered only when both are 0.
        /// </summary>
        public static CoveredResult Check(string game, bool quiet, Action<string, string> say)
        {
            var r = new CoveredResult();
            Action<string, string> line = delegate(string m, string c) { r.Lines.Add(m); if (say != null) say(m, c); };
            string data = Path.Combine(game, "Data");
            if (!Directory.Exists(data))
            {
                line("No Data folder in " + game + ". Nothing to check.", "Red");
                r.Unread++;
                return r;
            }
            string assets = Path.Combine(Path.Combine(Path.Combine(Path.Combine(data, "meshes"), "actors"), "character"), "character assets");
            if (!quiet) line("Bodies in " + data, "Cyan");

            foreach (string[] body in Bodies)
            {
                string name = body[0], sex = body[1];
                string p = Path.Combine(assets, name);
                if (!File.Exists(p))
                {
                    string why = sex == "astrid"
                        ? "not loose in Data, so the game's own archive supplies it, as Skyrim ships it"
                        : "not loose in Data, so the game's own archive supplies it, with its underwear";
                    if (!quiet) line(string.Format(CultureInfo.InvariantCulture, "  vanilla  {0,-24} {1}", name, why), "DarkGray");
                    continue;
                }
                string[] shapes;
                try { shapes = ShapeNames(p); }
                catch (Exception ex)
                {
                    if (!(ex is IOException) && !(ex is UnauthorizedAccessException) && !(ex is InvalidDataException)) throw;
                    r.Unread++;
                    r.Errors.Add(ex);
                    string unread = ex is InvalidDataException
                        ? "is not a mesh this check can read; reinstall the mod that carries it, or take it out of the Thornswood profile"
                        : "could not be opened; close any program that has it open (BodySlide, Outfit Studio, NifSkope) and try again";
                    line(string.Format(CultureInfo.InvariantCulture, "  UNREAD   {0,-24} {1}", name, unread), "Red");
                    continue;
                }
                string list = string.Join(", ", shapes);
                if (sex == "astrid")
                {
                    CoveredVerdict a = Verdict(shapes, "female");
                    if (a.Covered) { if (!quiet) line(string.Format(CultureInfo.InvariantCulture, "  covered  {0,-24} shapes: {1}", name, list), "Green"); }
                    else if (a.Anatomy.Count > 0)
                    {
                        r.Nude++;
                        line(string.Format(CultureInfo.InvariantCulture, "  NUDE     {0,-24} shapes: {1}; a genital shape on Astrid's burned body", name, list), "Red");
                    }
                    else if (!quiet)
                        line(string.Format(CultureInfo.InvariantCulture, "  burned   {0,-24} shapes: {1}; Astrid's charred body, bare in Skyrim's own mesh too, not counted (issue #405)", name, list), "Yellow");
                    continue;
                }
                CoveredVerdict v = Verdict(shapes, sex);
                if (v.Covered) { if (!quiet) line(string.Format(CultureInfo.InvariantCulture, "  covered  {0,-24} shapes: {1}", name, list), "Green"); }
                else
                {
                    r.Nude++;
                    line(string.Format(CultureInfo.InvariantCulture, "  NUDE     {0,-24} shapes: {1}; {2}", name, list, string.Join(", ", v.Missing.ToArray())), "Red");
                }
            }

            // Anything else under meshes\actors\character that carries anatomy.
            // FaceGenData is thousands of heads and never a body, so it is left
            // out. A file is named with \ on any machine (#2989).
            string root = Path.Combine(Path.Combine(Path.Combine(data, "meshes"), "actors"), "character");
            var named = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string[] body in Bodies) named.Add(body[0]);
            if (Directory.Exists(root))
            {
                var others = new List<string>();
                Nifs(root, others);
                others.Sort(StringComparer.OrdinalIgnoreCase);
                foreach (string f in others)
                {
                    string fname = Path.GetFileName(f);
                    if (Regex.IsMatch(fname, "(?i)^1stperson")) continue;
                    if (string.Equals(Path.GetDirectoryName(f), assets, StringComparison.OrdinalIgnoreCase) && named.Contains(fname)) continue;
                    string[] shapes;
                    try { shapes = ShapeNames(f); }
                    catch (Exception ex)
                    {
                        if (!(ex is IOException) && !(ex is UnauthorizedAccessException) && !(ex is InvalidDataException)) throw;
                        continue;
                    }
                    CoveredVerdict v = Verdict(shapes, "");
                    if (v.Anatomy.Count == 0) continue;
                    if (Regex.IsMatch(fname, "(?i)female")) v = Verdict(shapes, "female");
                    string rel = f.Substring(data.Length + 1).Replace(Path.DirectorySeparatorChar, '\\');
                    if (v.Covered) { if (!quiet) line("  covered  " + rel + " shapes: " + string.Join(", ", shapes), "Green"); }
                    else
                    {
                        r.Nude++;
                        line("  NUDE     " + rel + " shapes: " + string.Join(", ", shapes) + "; " + string.Join(", ", v.Missing.ToArray()), "Red");
                    }
                }
            }

            line("", "Gray");
            if (r.Unread > 0)
                line(string.Format(CultureInfo.InvariantCulture, "{0} body mesh{1} could not be read. Nothing is certain until it can.", r.Unread, r.Unread == 1 ? "" : "es"), "Red");
            else if (r.Nude > 0)
                line(string.Format(CultureInfo.InvariantCulture, "{0} body mesh{1} would show somebody nude. The bodies are built covered from the collection's BodySlide sets (records\\generated.json, issue #405).", r.Nude, r.Nude == 1 ? "" : "es"), "Red");
            else line("Every body is covered.", "Green");
            return r;
        }

        /// <summary>Every .nif under dir, leaving out FaceGenData and folder links.</summary>
        static void Nifs(string dir, List<string> found)
        {
            foreach (string f in Directory.GetFiles(dir, "*.nif")) found.Add(f);
            foreach (string sub in Directory.GetDirectories(dir))
            {
                if (string.Equals(Path.GetFileName(sub), "facegendata", StringComparison.OrdinalIgnoreCase)) continue;
                if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0) continue;
                Nifs(sub, found);
            }
        }
    }

    public sealed class CoveredVerdict
    {
        public bool Covered;
        public List<string> Missing = new List<string>();
        public List<string> Anatomy = new List<string>();
    }

    /// <summary>What a check found: Nude and Unread counts, and every line it said. Exit 0 covered, 2 nude, 1 unreadable.</summary>
    public sealed class CoveredResult
    {
        public int Nude, Unread;
        public List<string> Lines = new List<string>();
        /// <summary>
        /// The exception behind each UNREAD line, kept whole. The line says
        /// what to do in this file's own words; the stop that follows carries
        /// the first of these as its inner exception, so the launcher writes it
        /// to launcher.log through Failure (#4633), which this file cannot
        /// reach because Generated.ps1 compiles it alone.
        /// </summary>
        public List<Exception> Errors = new List<Exception>();
        public int ExitCode { get { return Unread > 0 ? 1 : Nude > 0 ? 2 : 0; } }
    }
}
