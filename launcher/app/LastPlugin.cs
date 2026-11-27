using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// Makes Data\Thornswood-Last.esp on each machine from that machine's own
    /// plugins, by the recipe the release carries beside it,
    /// Data\Thornswood-Last.recipe (#2791, Patrick's A of 26 Oct 2026 on #3721).
    ///
    /// WHY. The plugin copies the winning record of each cell, world, quest and
    /// placed actor it changes out of the load order: 15,543 of its records
    /// are other authors' records, and many of their pages ask for permission
    /// before their files are changed or handed on. So Thornswood hands on
    /// only the recipe, which record of which plugin goes where and what
    /// Thornswood changes in it, and every byte of theirs comes out of the
    /// person's own copy of their plugin, which Vortex installed from its
    /// author. scripts\mods\last_recipe.py writes the recipe and says what is
    /// in it; this is its apply() in C#, step for step.
    ///
    /// BYTE FOR BYTE. The recipe names the size and sha256 of every plugin and
    /// string table it reads and of the plugin it makes. A plugin of another
    /// revision of the collection, or a game in another language, makes
    /// nothing, and the reason names the file that differs; a plugin that
    /// would come out different is never written.
    ///
    /// Who runs it: MadeFromGame, before every Play and from Fix, whenever the
    /// game folder holds a recipe and its Thornswood-Last.esp is missing or
    /// not the bytes the recipe makes. A game folder with no recipe (a
    /// release that still carries the plugin itself) is left to the release.
    /// tests\test-2791-last-plugin.ps1 holds this to last_recipe.py on
    /// made-up plugins (tests\fixtures\2791).
    /// </summary>
    public static class LastPlugin
    {
        public const string Name = "Thornswood-Last.esp";
        public const string File = "Data\\Thornswood-Last.esp";
        const string RecipeName = "Thornswood-Last.recipe";

        static readonly byte[] Magic = { (byte)'T', (byte)'S', (byte)'L', (byte)'R', 1 };
        const uint Compressed = 0x00040000;
        const int PluginSource = 0, TableSource = 1;
        const int Lit = 0, Rec = 1, Cpy = 2, Str = 3;

        /// <summary>
        /// Why the plugin cannot be made, said in a few words. NotEnglish when
        /// an English string table the recipe reads is missing, which is a
        /// game set to another language in Steam (#4007). Patrick's A of 27
        /// Oct 2026: Thornswood plays in English, and Scan says how to switch.
        /// </summary>
        public sealed class CannotMake : Exception
        {
            public readonly bool NotEnglish;
            public CannotMake(string why, bool notEnglish) : base(why) { NotEnglish = notEnglish; }
        }

        /// <summary>One plugin or string table a recipe reads, as it names it.</summary>
        public sealed class Source
        {
            public int Kind;
            public string Name;
            public long Size;
            public byte[] Sha256;
            public bool IsTable { get { return Kind == TableSource; } }
        }

        /// <summary>A recipe's header: the plugin it makes and what it reads.</summary>
        public sealed class Header
        {
            public long Size;
            public byte[] Sha256;
            public List<Source> Sources = new List<Source>();
            internal int StepsAt;
        }

        /// <summary>Opens a source's bytes for reading, or returns null when this machine has none.</summary>
        public delegate Stream Open(Source s);

        /// <summary>Whether the game folder holds a recipe, so the plugin is made here rather than shipped.</summary>
        public static bool HasRecipe(string game)
        {
            return System.IO.File.Exists(RecipeAt(game));
        }

        /// <summary>Whether this plugin is the one a recipe in the game folder makes.</summary>
        public static bool Makes(string game, string plugin)
        {
            return string.Equals(plugin, Name, StringComparison.OrdinalIgnoreCase) && HasRecipe(game);
        }

        /// <summary>The sha256 (hex) the recipe in the game folder makes, or null when there is no recipe that reads.</summary>
        public static string Expected(string game)
        {
            try { return Hex(ReadHeader(System.IO.File.ReadAllBytes(RecipeAt(game))).Sha256); }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
            catch (CannotMake) { return null; }
        }

        /// <summary>Whether the game folder's Thornswood-Last.esp is the plugin its recipe makes.</summary>
        public static bool IsCurrent(string game)
        {
            string want = Expected(game);
            string path = Path.Combine(Path.Combine(game, "Data"), Name);
            if (want == null || !System.IO.File.Exists(path)) return false;
            using (var f = OpenRead(path))
            using (var h = SHA256.Create())
                return Hex(h.ComputeHash(f)) == want;
        }

        /// <summary>
        /// Makes the plugin from the recipe in <paramref name="game"/> and the
        /// plugins and string tables of its Data folder. Throws
        /// CannotMake with the reason when it cannot be made.
        /// </summary>
        public static byte[] Make(string game)
        {
            string data = Path.Combine(game, "Data");
            byte[] recipe;
            try { recipe = System.IO.File.ReadAllBytes(RecipeAt(game)); }
            catch (FileNotFoundException) { throw Bad("the release's " + RecipeName + " is not in the game folder"); }
            return Apply(recipe, delegate(Source s) { return s.IsTable ? Table(data, s.Name) : Plugin(data, s.Name); });
        }

        static string RecipeAt(string game) { return Path.Combine(Path.Combine(game, "Data"), RecipeName); }

        static Stream Plugin(string data, string name)
        {
            string path = Path.Combine(data, name);
            return System.IO.File.Exists(path) ? OpenRead(path) : null;
        }

        /// <summary>
        /// A string table, found the way the game finds it and the way
        /// Build-LastPlugin.py's string_table found it: the loose file under
        /// Data\Strings, then each archive of Data in name order that holds
        /// strings\name. An archive that cannot be read is passed over, as
        /// the builder passes it over.
        /// </summary>
        static Stream Table(string data, string name)
        {
            string loose = Path.Combine(Path.Combine(data, "Strings"), name);
            if (System.IO.File.Exists(loose)) return new MemoryStream(System.IO.File.ReadAllBytes(loose));
            if (!Directory.Exists(data)) return null;
            var archives = new List<string>();
            foreach (string p in Directory.GetFiles(data))
                if (p.EndsWith(".bsa", StringComparison.OrdinalIgnoreCase)) archives.Add(Path.GetFileName(p));
            // Python's sorted(): by code point, upper case before lower.
            archives.Sort(StringComparer.Ordinal);
            string rel = "strings\\" + name;
            foreach (string a in archives)
            {
                GameArchive arc;
                try { arc = new GameArchive(Path.Combine(data, a)); }
                catch (InvalidDataException) { continue; }
                catch (EndOfStreamException) { continue; }
                catch (ArgumentException) { continue; }
                catch (IndexOutOfRangeException) { continue; }
                if (arc.Has(rel)) return new MemoryStream(arc.Read(rel));
            }
            return null;
        }

        static FileStream OpenRead(string path)
        {
            return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        }

        // ------------------------------------------------------------ reading

        /// <summary>The recipe's header; CannotMake when it is not a version 1 recipe.</summary>
        public static Header ReadHeader(byte[] recipe)
        {
            if (recipe.Length < Magic.Length) throw Bad("this is not a version 1 recipe for " + Name);
            for (int i = 0; i < Magic.Length; i++) if (recipe[i] != Magic[i]) throw Bad("this is not a version 1 recipe for " + Name);
            int p = Magic.Length;
            var h = new Header();
            h.Size = BitConverter.ToUInt32(Raw(recipe, ref p, 4), 0);
            h.Sha256 = Raw(recipe, ref p, 32);
            long n = Varint(recipe, ref p);
            for (long i = 0; i < n; i++)
            {
                var s = new Source();
                s.Kind = Byte(recipe, ref p);
                s.Name = Encoding.UTF8.GetString(Raw(recipe, ref p, Varint(recipe, ref p)));
                s.Size = Varint(recipe, ref p);
                s.Sha256 = Raw(recipe, ref p, 32);
                h.Sources.Add(s);
            }
            h.StepsAt = p;
            return h;
        }

        /// <summary>
        /// The plugin a recipe makes, with each source opened by <paramref name="open"/>
        /// and held to the size and sha256 the recipe names. Throws
        /// CannotMake with the reason when it cannot be made.
        /// </summary>
        public static byte[] Apply(byte[] recipe, Open open)
        {
            Header h = ReadHeader(recipe);
            var got = new Dictionary<int, Stream>();
            var tables = new Dictionary<int, Dictionary<uint, byte[]>>();
            try
            {
                var outp = new MemoryStream();
                byte[] cur = null;
                int p = h.StepsAt;
                while (p < recipe.Length)
                {
                    int op = Byte(recipe, ref p);
                    if (op == Lit)
                    {
                        long n = Varint(recipe, ref p);
                        byte[] b = Raw(recipe, ref p, n);
                        outp.Write(b, 0, b.Length);
                    }
                    else if (op == Rec)
                    {
                        int i = (int)Math.Min(Varint(recipe, ref p), int.MaxValue);
                        long off = Varint(recipe, ref p);
                        if (i >= h.Sources.Count || h.Sources[i].Kind != PluginSource) throw Bad("a record step names a source that is not a plugin");
                        cur = RecordData(Held(h, i, open, got), off, h.Sources[i].Name);
                    }
                    else if (op == Cpy)
                    {
                        long off = Varint(recipe, ref p), n = Varint(recipe, ref p);
                        if (cur == null || off + n > cur.Length) throw Bad("a copy step runs past its record");
                        outp.Write(cur, (int)off, (int)n);
                    }
                    else if (op == Str)
                    {
                        int i = (int)Math.Min(Varint(recipe, ref p), int.MaxValue);
                        long sid = Varint(recipe, ref p);
                        if (i >= h.Sources.Count || h.Sources[i].Kind != TableSource) throw Bad("a string step names a source that is not a string table");
                        Dictionary<uint, byte[]> t;
                        if (!tables.TryGetValue(i, out t))
                        {
                            Stream st = Held(h, i, open, got);
                            var all = new byte[st.Length];
                            st.Position = 0;
                            ReadFully(st, all, h.Sources[i].Name);
                            t = TableStrings(all, Kind(h.Sources[i].Name));
                            tables[i] = t;
                        }
                        byte[] text;
                        if (sid > uint.MaxValue || !t.TryGetValue((uint)sid, out text)) throw Bad(h.Sources[i].Name + " has no string " + sid);
                        outp.Write(text, 0, text.Length);
                    }
                    else throw Bad("the recipe has a step of kind " + op + ", which version 1 does not have");
                }
                byte[] made = outp.ToArray();
                if (made.LongLength != h.Size || Hex(Sha(made)) != Hex(h.Sha256)) throw Bad("the recipe did not make the plugin it names");
                return made;
            }
            finally
            {
                foreach (Stream s in got.Values) s.Dispose();
            }
        }

        /// <summary>Source i, opened once and held to the size and sha256 the recipe names.</summary>
        static Stream Held(Header h, int i, Open open, Dictionary<int, Stream> got)
        {
            Stream st;
            if (got.TryGetValue(i, out st)) return st;
            Source s = h.Sources[i];
            st = open(s);
            if (st == null && s.IsTable && s.Name.IndexOf("_english.", StringComparison.OrdinalIgnoreCase) >= 0)
                throw new CannotMake(s.Name + " is not on this machine, which is how a Skyrim set to another language than English looks", true);
            if (st == null) throw Bad(s.Name + " is not on this machine");
            got[i] = st;
            long have = st.Length;
            if (have != s.Size)
                throw Bad(s.Name + " is not the copy the recipe was written for (yours is " + have + " bytes, the recipe's " + s.Size + ")");
            st.Position = 0;
            string sha;
            using (var hash = SHA256.Create()) sha = Hex(hash.ComputeHash(st));
            if (sha != Hex(s.Sha256))
                throw Bad(s.Name + " is not the copy the recipe was written for (same size, sha256 " + sha + ", not " + Hex(s.Sha256) + ")");
            return st;
        }

        /// <summary>The data of the record at off, inflated when it is compressed, as last_recipe.record_data reads it.</summary>
        static byte[] RecordData(Stream st, long off, string name)
        {
            if (off + 24 > st.Length) throw Bad("there is no record at offset " + off + " of " + name);
            var head = new byte[24];
            st.Position = off;
            ReadFully(st, head, name);
            if (head[0] == 'G' && head[1] == 'R' && head[2] == 'U' && head[3] == 'P') throw Bad("there is no record at offset " + off + " of " + name);
            uint size = BitConverter.ToUInt32(head, 4), flags = BitConverter.ToUInt32(head, 8);
            if (off + 24 + size > st.Length) throw Bad("the record at offset " + off + " runs past the end of " + name);
            var raw = new byte[size];
            ReadFully(st, raw, name);
            if ((flags & Compressed) == 0) return raw;
            if (raw.Length < 6) throw Bad("the record at offset " + off + " of " + name + " is compressed and too short to hold a size and zlib's header");
            uint want = BitConverter.ToUInt32(raw, 0);
            var outp = new MemoryStream((int)Math.Min(want, 64u << 20));
            // zlib: two header bytes, deflate, four bytes of Adler-32, which
            // the sha256 of the plugin made already holds to account.
            try
            {
                using (var z = new DeflateStream(new MemoryStream(raw, 6, raw.Length - 6), CompressionMode.Decompress))
                    z.CopyTo(outp);
            }
            catch (InvalidDataException) { throw Bad("the record at offset " + off + " of " + name + " does not inflate"); }
            if (outp.Length != want) throw Bad("the record at offset " + off + " of " + name + " inflates to the wrong size");
            return outp.ToArray();
        }

        /// <summary>{string id: bytes} of a .STRINGS, .DLSTRINGS or .ILSTRINGS table, as last_recipe.table_strings reads one.</summary>
        static Dictionary<uint, byte[]> TableStrings(byte[] d, string kind)
        {
            var outp = new Dictionary<uint, byte[]>();
            uint count = BitConverter.ToUInt32(d, 0);
            long b = 8 + (long)count * 8;
            for (uint i = 0; i < count; i++)
            {
                uint sid = BitConverter.ToUInt32(d, (int)(8 + i * 8));
                long p = b + BitConverter.ToUInt32(d, (int)(8 + i * 8 + 4));
                if (kind == "strings")
                {
                    int e = Array.IndexOf(d, (byte)0, (int)p);
                    if (e < 0) throw Bad("a string of a table runs past its end");
                    outp[sid] = Slice(d, (int)p, e - (int)p);
                }
                else
                {
                    int n = (int)BitConverter.ToUInt32(d, (int)p);
                    int end = (int)Math.Min(p + 4 + n, d.Length);
                    while (end > p + 4 && d[end - 1] == 0) end--;
                    outp[sid] = Slice(d, (int)p + 4, end - (int)p - 4);
                }
            }
            return outp;
        }

        static string Kind(string name)
        {
            int dot = name.LastIndexOf('.');
            return (dot < 0 ? name : name.Substring(dot + 1)).ToLowerInvariant();
        }

        // ------------------------------------------------------------ bytes

        static CannotMake Bad(string why) { return new CannotMake(why, false); }

        static int Byte(byte[] b, ref int p)
        {
            if (p >= b.Length) throw Bad("the recipe ends in the middle of a step");
            return b[p++];
        }

        static long Varint(byte[] b, ref int p)
        {
            long n = 0;
            int shift = 0;
            while (true)
            {
                int x = Byte(b, ref p);
                n |= (long)(x & 0x7F) << shift;
                if ((x & 0x80) == 0) return n;
                shift += 7;
                if (shift > 62) throw Bad("a recipe number runs past 63 bits");
            }
        }

        static byte[] Raw(byte[] b, ref int p, long n)
        {
            if (n < 0 || p + n > b.Length) throw Bad("the recipe ends in the middle of a step");
            byte[] r = Slice(b, p, (int)n);
            p += (int)n;
            return r;
        }

        static byte[] Slice(byte[] b, int at, int n)
        {
            var r = new byte[n];
            Buffer.BlockCopy(b, at, r, 0, n);
            return r;
        }

        static void ReadFully(Stream st, byte[] into, string name)
        {
            int got = 0;
            while (got < into.Length)
            {
                int k = st.Read(into, got, into.Length - got);
                if (k <= 0) throw Bad(name + " ended while it was read");
                got += k;
            }
        }

        static byte[] Sha(byte[] b)
        {
            using (var h = SHA256.Create()) return h.ComputeHash(b);
        }

        static string Hex(byte[] b)
        {
            var sb = new StringBuilder(b.Length * 2);
            foreach (byte x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }
    }
}
