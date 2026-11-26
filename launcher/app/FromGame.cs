using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// The three files Thornswood makes on each machine from that machine's
    /// own Skyrim, so no pack, installer or release record hands on a file of
    /// Bethesda's or one built from Bethesda's (#2827, Patrick's option 2,
    /// 19 Oct 2026):
    ///
    ///   Data\Interface\startmenu.swf             the main menu with no Bethesda
    ///                                            logo and no button list
    ///   Data\meshes\thornswood\noticeboard01.nif  the notice board
    ///   Data\meshes\thornswood\dropbox01.nif      the hold's drop box beside it
    ///
    /// WHY. Bethesda's terms for Skyrim mods (the Creation Kit licence, read on
    /// #2792 and #2827) grant no right to hand on the game's own files, edited
    /// or not, or meshes put together from them. The menu is Skyrim's own
    /// interface\startmenu.swf with its logo shapes taken out (#2177), and the
    /// board and box are pieces of Skyrim's own meshes placed and joined
    /// (#2298, #2502). So only Thornswood's part travels: the edit to the menu
    /// (MenuRecipe, FromGameMenu.cs) and where each piece goes and the
    /// collision Thornswood drew around them (BoardRecipe, FromGameBoard.cs).
    /// The game's part is read from the person's own archives here.
    ///
    /// BYTE FOR BYTE. What this makes is the file that shipped until #2827,
    /// and each one is checked against that file's sha256 before it is
    /// written; a file that would come out different is not written, and the
    /// reason says which of the game's files differs. FromGameMath.cs and
    /// FromGameDeflate.cs say how the numbers and the compression are kept the
    /// same as the tools that made them. tests\test-2827-from-game.ps1 holds
    /// this to those tools on made-up archives; scripts\mods\Check-FromGame.ps1
    /// checks it against a real game.
    ///
    /// THE COLLECTION'S MENUS, the same way (#3113). An item on Thornswood has
    /// no gold price, and five files of three of the collection's mods draw
    /// one: SkyUI's item lists (interface\skyui\config.txt) and item card
    /// (itemcard.swf), SkyHUD's line under an item somebody looks at
    /// (hudmenu.swf), and moreHUD's value to weight beside it (AHZHudInfo.swf
    /// and its copy under exported). SkyUI's journal (quest_journal.swf) is
    /// made the same way with the System page entries Thornswood does not use
    /// taken off (#3127). Its inventory uses the mapped key to close (#7008).
    /// Those are their authors' files, so they
    /// are not handed on either: the edits (MenuRecipe.Mods, FromGameModMenus.cs,
    /// written by scripts\mods\Build-ModMenus.py) are made here against the
    /// person's own copy of each mod, out of its archive. A loose file at the
    /// same path wins over the archive in the game, which is what puts the
    /// edited one in front.
    ///
    /// Who runs it: the launcher before every Play and from Scan and Fix
    /// (MadeFromGame.cs), and scripts\release\Go.ps1 for a ship root. It reads
    /// the archives and writes nothing itself.
    /// </summary>
    public static class FromGame
    {
        public const string MenuFile = "Data\\Interface\\startmenu.swf";
        public const string BoardFile = "Data\\meshes\\thornswood\\noticeboard01.nif";
        public const string BoxFile = "Data\\meshes\\thornswood\\dropbox01.nif";

        /// <summary>Every path this makes, under the game folder: the three of the game's, then the mods' menus.</summary>
        public static readonly string[] Files = AllFiles();

        static string[] AllFiles()
        {
            var l = new List<string> { MenuFile, BoardFile, BoxFile };
            foreach (MenuRecipe m in MenuRecipe.Mods) l.Add(m.Path);
            return l.ToArray();
        }

        /// <summary>The sha256 each one must have.</summary>
        public static string Expected(string rel)
        {
            if (rel.Equals(MenuFile, StringComparison.OrdinalIgnoreCase)) return MenuRecipe.Shipped.Sha256;
            if (rel.Equals(BoardFile, StringComparison.OrdinalIgnoreCase)) return BoardRecipe.Shipped.BoardSha256;
            if (rel.Equals(BoxFile, StringComparison.OrdinalIgnoreCase)) return BoardRecipe.Shipped.BoxSha256;
            foreach (MenuRecipe m in MenuRecipe.Mods)
                if (rel.Equals(m.Path, StringComparison.OrdinalIgnoreCase)) return m.Sha256;
            return null;
        }

        public static string Sha256(byte[] b)
        {
            using (var h = SHA256.Create())
            {
                var sb = new StringBuilder(64);
                foreach (byte x in h.ComputeHash(b)) sb.Append(x.ToString("x2"));
                return sb.ToString();
            }
        }

        /// <summary>Whether the file at <paramref name="rel"/> under <paramref name="game"/> is the one this makes.</summary>
        public static bool IsCurrent(string game, string rel)
        {
            string path = Path.Combine(game, rel);
            if (!File.Exists(path)) return false;
            return Sha256(File.ReadAllBytes(path)) == Expected(rel);
        }

        /// <summary>
        /// Makes every file in Files from the archives in <paramref name="data"/>
        /// (a game's Data folder). Each result carries its bytes, or the reason
        /// it could not be made; nothing is written.
        /// </summary>
        public static List<FromGameFile> Build(string data)
        {
            List<FromGameFile> l = Build(data, MenuRecipe.Shipped, BoardRecipe.Shipped);
            foreach (MenuRecipe m in MenuRecipe.Mods) l.Add(BuildMenu(data, m));
            return l;
        }

        public static List<FromGameFile> Build(string data, MenuRecipe menu, BoardRecipe board)
        {
            var l = new List<FromGameFile>();
            l.Add(BuildMenu(data, menu));
            l.AddRange(BuildBoard(data, board));
            return l;
        }

        // ------------------------------------------------------------ the menu

        public static FromGameFile BuildMenu(string data, MenuRecipe r)
        {
            var f = new FromGameFile { Rel = r.Path, Expected = r.Sha256 };
            byte[] src;
            try { src = new GameArchives(data, new[] { r.Archive }).Read(r.Source); }
            catch (Exception ex) { f.Problem = "could not read " + r.Source + " from " + r.Archive; f.Error = ex; return f; }
            string have = Sha256(src);
            if (have != r.SourceSha256)
            {
                f.Problem = (r.Mod == null ? "the game's " : r.Mod + "'s ") + r.Source + " (" + src.Length + " bytes, sha256 " + have +
                            ") is not the one Thornswood's file is made from (" + r.SourceSize + " bytes, sha256 " + r.SourceSha256 + "), so " +
                            (r.Mod == null ? "the game is not on the build Thornswood pins" : r.Mod + " is not the version the collection pins");
                return f;
            }
            // A text file (SkyUI's config.txt) takes its edits as it is.
            if (!r.Path.EndsWith(".swf", StringComparison.OrdinalIgnoreCase)) return Checked(f, Edited(src, r.Edits));
            if (src.Length < 8 || src[0] != 'C' || src[1] != 'W' || src[2] != 'S')
            {
                f.Problem = "the game's " + r.Source + " is not a compressed SWF";
                return f;
            }
            var full = new MemoryStream();
            full.Write(src, 0, 8);
            using (var z = new DeflateStream(new MemoryStream(src, 10, src.Length - 10 - 4), CompressionMode.Decompress))
                z.CopyTo(full);
            byte[] swf = Edited(full.ToArray(), r.Edits);
            byte[] packed = ZlibLevel6.Compress(Slice(swf, 8, swf.Length - 8));
            var outp = new byte[8 + packed.Length];
            Buffer.BlockCopy(swf, 0, outp, 0, 8);
            Buffer.BlockCopy(packed, 0, outp, 8, packed.Length);
            return Checked(f, outp);
        }

        /// <summary>The bytes with the edits made, in order.</summary>
        static byte[] Edited(byte[] plain, MenuEdit[] edits)
        {
            var edited = new MemoryStream();
            int at = 0;
            foreach (MenuEdit e in edits)
            {
                edited.Write(plain, at, e.At - at);
                byte[] ins = Hex(e.Insert);
                edited.Write(ins, 0, ins.Length);
                at = e.At + e.Remove;
            }
            edited.Write(plain, at, plain.Length - at);
            return edited.ToArray();
        }

        static FromGameFile Checked(FromGameFile f, byte[] b)
        {
            string sha = Sha256(b);
            if (sha != f.Expected)
            {
                f.Problem = "it came out " + b.Length + " bytes with sha256 " + sha + ", not the " + f.Expected +
                            " Thornswood's file has, so it was not written";
                return f;
            }
            f.Bytes = b;
            f.Sha256 = sha;
            return f;
        }

        static byte[] Slice(byte[] b, int at, int n)
        {
            var r = new byte[n];
            Buffer.BlockCopy(b, at, r, 0, n);
            return r;
        }

        static byte[] Hex(string s)
        {
            var b = new byte[(s ?? "").Length / 2];
            for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(s.Substring(2 * i, 2), 16);
            return b;
        }

        // ------------------------------------------------------- the board and box

        static readonly double[] Turn = { -1, 0, 0, 0, -1, 0, 0, 0, 1 }; // the concept faced -y; the game's board faces +y

        public static List<FromGameFile> BuildBoard(string data, BoardRecipe r)
        {
            var board = new FromGameFile { Rel = r.BoardPath, Expected = r.BoardSha256 };
            var box = new FromGameFile { Rel = r.BoxPath, Expected = r.BoxSha256 };
            var l = new List<FromGameFile> { board, box };
            byte[] boardBytes, boxBytes;
            try
            {
                var game = new GameArchives(data, r.Archives);
                // Each of the game's meshes first, so a game that differs is named by the file that differs.
                foreach (BoardSource src in r.Sources)
                {
                    byte[] b = game.Read(src.Path);
                    string have = Sha256(b);
                    if (have != src.Sha256)
                    {
                        board.Problem = box.Problem = "the game's " + src.Path + " (" + b.Length + " bytes, sha256 " + have +
                            ") is not the one Thornswood's board is made from (" + src.Size + " bytes, sha256 " + src.Sha256 +
                            "), so the game is not on the build Thornswood pins";
                        return l;
                    }
                }
                Meshes(game, r, out boardBytes, out boxBytes);
            }
            catch (Exception ex)
            {
                board.Problem = box.Problem = "could not be made from the game's meshes";
                board.Error = box.Error = ex;
                return l;
            }
            Checked(board, boardBytes);
            Checked(box, boxBytes);
            return l;
        }

        static void Meshes(GameArchives game, BoardRecipe r, out byte[] boardBytes, out byte[] boxBytes)
        {
            var cache = new Dictionary<string, List<NifShape>>(StringComparer.OrdinalIgnoreCase);
            Func<string, List<NifShape>> shapes = p =>
            {
                List<NifShape> s;
                if (!cache.TryGetValue(p, out s)) cache[p] = s = NifRead.Shapes(game.Read(p), p);
                return s;
            };
            var zero = new double[3];

            var board = new NifMesh(r.BoardRoot);
            var count = new Dictionary<string, int>();
            foreach (BoardPart part in r.Parts)
            {
                int n;
                count.TryGetValue(part.Name, out n);
                count[part.Name] = ++n;
                List<NifShape> ss = shapes(part.Mesh);
                for (int k = 0; k < ss.Count; k++)
                    board.Shape(part.Name + n.ToString("00") + ":" + k, ss[k], Baked(ss[k], part, zero), false);
            }
            NifShape nail = null;
            foreach (NifShape s in shapes(r.NailSource))
            {
                foreach (string p in s.Paths) if (p.ToLowerInvariant().Contains(r.NailTexture)) { nail = s; break; }
                if (nail != null) break;
            }
            if (nail == null) throw new InvalidDataException(r.NailSource + " has no shape textured with " + r.NailTexture);
            board.Ours("NailHeads", nail, Convert.FromBase64String(r.NailHeads), false);

            // the drop box: the strongbox, its origin at the bottom middle of the box
            List<NifShape> sb = shapes(r.Box.Mesh);
            double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue }, hi = { double.MinValue, double.MinValue, double.MinValue };
            foreach (NifShape s in sb)
            {
                Geometry g = Baked(s, r.Box, zero);
                for (int i = 0; i < g.Count; i++)
                    for (int a = 0; a < 3; a++)
                    {
                        double v = g.Pos[i * 3 + a];
                        if (v < lo[a]) lo[a] = v;
                        if (v > hi[a]) hi[a] = v;
                    }
            }
            double[] origin = { (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] };
            double[] shift = { -origin[0], -origin[1], -origin[2] };
            var box = new NifMesh(r.BoxRoot);
            for (int k = 0; k < sb.Count; k++)
                box.Shape(r.Box.Name + ":" + k, sb[k], Baked(sb[k], r.Box, shift), false);
            box.Ours("CoinSlotLip", sb[0], Convert.FromBase64String(r.CoinSlotLip), false);
            box.Ours("CoinSlot", sb[0], Convert.FromBase64String(r.CoinSlot), true);

            boardBytes = board.Finish(Blobs(r.BoardHulls), r.BoardList, NifRead.First(game.Read(r.BodyBoard), "bhkRigidBody", r.BodyBoard));
            boxBytes = box.Finish(Blobs(r.BoxHulls), r.BoxList, NifRead.First(game.Read(r.BodyBox), "bhkRigidBody", r.BodyBox));
        }

        static List<byte[]> Blobs(string[] b64)
        {
            var l = new List<byte[]>();
            foreach (string s in b64) l.Add(Convert.FromBase64String(s));
            return l;
        }

        /// <summary>Build-NoticeBoard.py's baked(): one vanilla shape placed and moved into the built mesh's space.</summary>
        static Geometry Baked(NifShape s, BoardPart part, double[] shift)
        {
            double[] rot = part.Rot;
            double[] diag = { part.Scale[0], 0, 0, 0, part.Scale[1], 0, 0, 0, part.Scale[2] };
            var sm = new double[9];
            for (int i = 0; i < 9; i++) sm[i] = s.S * s.M[i];
            double[] a = FromGameMath.MatMul(FromGameMath.MatMul(FromGameMath.MatMul(Turn, rot), diag), sm);
            double[] st = { part.Scale[0] * s.T[0], part.Scale[1] * s.T[1], part.Scale[2] * s.T[2] };
            double[] u = FromGameMath.MatVec(rot, st);
            for (int i = 0; i < 3; i++) u[i] = u[i] + part.Pos[i];
            double[] b = FromGameMath.MatVec(Turn, u);
            for (int i = 0; i < 3; i++) b[i] = b[i] + shift[i];
            double[] inv = FromGameMath.Inverse(a);

            int n = s.Count, vsize = (int)(s.Desc & 0xF) * 4;
            ulong attrs = (s.Desc >> 44) & 0xFFF;
            int oUv = Off(s.Desc, 2), oN = Off(s.Desc, 4), oT = Off(s.Desc, 5), oC = Off(s.Desc, 6);
            var g = new Geometry { Count = n, Pos = new double[n * 3], Raw = new byte[n * vsize] };
            var r = new double[3];
            var v = new double[3];
            for (int i = 0; i < n; i++)
            {
                int o = i * vsize;
                double px = BitConverter.ToSingle(s.Raw, o), py = BitConverter.ToSingle(s.Raw, o + 4), pz = BitConverter.ToSingle(s.Raw, o + 8);
                double bx = BitConverter.ToSingle(s.Raw, o + 12), by = 0, bz = 0;
                double nx = 0, ny = 0, nz = 0, tx = 0, ty = 0, tz = 0;
                if ((attrs & 0x8) != 0)
                {
                    nx = s.Raw[o + oN] / 127.5 - 1.0; ny = s.Raw[o + oN + 1] / 127.5 - 1.0; nz = s.Raw[o + oN + 2] / 127.5 - 1.0;
                    by = s.Raw[o + oN + 3] / 127.5 - 1.0;
                }
                if ((attrs & 0x10) != 0)
                {
                    tx = s.Raw[o + oT] / 127.5 - 1.0; ty = s.Raw[o + oT + 1] / 127.5 - 1.0; tz = s.Raw[o + oT + 2] / 127.5 - 1.0;
                    bz = s.Raw[o + oT + 3] / 127.5 - 1.0;
                }

                FromGameMath.RowT(px, py, pz, a, r);
                for (int k = 0; k < 3; k++) g.Pos[i * 3 + k] = r[k] + b[k];

                FromGameMath.RowT(bx, by, bz, a, v);
                FromGameMath.Unit(v);
                byte[] w = BitConverter.GetBytes((float)g.Pos[i * 3]);
                Buffer.BlockCopy(w, 0, g.Raw, o, 4);
                Buffer.BlockCopy(BitConverter.GetBytes((float)g.Pos[i * 3 + 1]), 0, g.Raw, o + 4, 4);
                Buffer.BlockCopy(BitConverter.GetBytes((float)g.Pos[i * 3 + 2]), 0, g.Raw, o + 8, 4);
                Buffer.BlockCopy(BitConverter.GetBytes((float)v[0]), 0, g.Raw, o + 12, 4);
                if ((attrs & 0x2) != 0) Buffer.BlockCopy(s.Raw, o + oUv, g.Raw, o + oUv, 4);
                if ((attrs & 0x8) != 0)
                {
                    FromGameMath.Row(nx, ny, nz, inv, r);
                    FromGameMath.Unit(r);
                    g.Raw[o + oN] = FromGameMath.ToByte(r[0]);
                    g.Raw[o + oN + 1] = FromGameMath.ToByte(r[1]);
                    g.Raw[o + oN + 2] = FromGameMath.ToByte(r[2]);
                    g.Raw[o + oN + 3] = FromGameMath.ToByte(v[1]);
                }
                if ((attrs & 0x10) != 0)
                {
                    FromGameMath.RowT(tx, ty, tz, a, r);
                    FromGameMath.Unit(r);
                    g.Raw[o + oT] = FromGameMath.ToByte(r[0]);
                    g.Raw[o + oT + 1] = FromGameMath.ToByte(r[1]);
                    g.Raw[o + oT + 2] = FromGameMath.ToByte(r[2]);
                    g.Raw[o + oT + 3] = FromGameMath.ToByte(v[2]);
                }
                if ((attrs & 0x20) != 0) Buffer.BlockCopy(s.Raw, o + oC, g.Raw, o + oC, 4);
            }
            return g;
        }

        static int Off(ulong desc, int k) { return (int)((desc >> (4 * k)) & 0xF) * 4; }
    }

    public sealed class FromGameFile
    {
        public string Rel;
        public byte[] Bytes;
        public string Sha256;
        public string Expected;
        /// <summary>Why it was not made, or null when Bytes is the file.</summary>
        public string Problem;
        /// <summary>
        /// The exception behind Problem, when one was caught. Problem says
        /// what could not be made in this file's own words and never carries
        /// the exception's Message; the launcher's side says the exception
        /// through Failure, which this file does not reach because scripts
        /// compile FromGame*.cs on their own (#4633).
        /// </summary>
        public Exception Error;
        /// <summary>Not made because the game is set to another language than English (#4007, LastPlugin).</summary>
        public bool NotEnglish;
    }

    /// <summary>One edit to the menu: at At in the game's file, uncompressed, Remove bytes go and Insert (hex) comes in.</summary>
    public sealed class MenuEdit
    {
        public int At;
        public int Remove;
        public string Insert;
        public MenuEdit(int at, int remove, string insert) { At = at; Remove = remove; Insert = insert; }
    }

    /// <summary>
    /// Thornswood's edit to one menu file: Skyrim's main menu (MenuRecipe.Shipped,
    /// FromGameMenu.cs), or one of the collection's mods' menus (MenuRecipe.Mods,
    /// FromGameModMenus.cs). Mod is the mod's name for the latter, null for the game.
    /// </summary>
    public sealed partial class MenuRecipe
    {
        public string Archive, Source, SourceSha256, Path, Sha256, Mod;
        public int SourceSize, Size;
        public MenuEdit[] Edits;
    }

    /// <summary>
    /// One piece of the board: a vanilla mesh, turned, scaled and placed. Rot
    /// is the rotation matrix, row by row, as numpy made it from the part's
    /// degrees in Build-NoticeBoard.py (the recipe says the degrees beside it).
    /// </summary>
    public sealed class BoardPart
    {
        public string Name, Mesh;
        public double[] Rot, Scale, Pos;
        public BoardPart(string name, string mesh, double[] rot, double[] scale, double[] pos)
        {
            Name = name; Mesh = mesh; Rot = rot; Scale = scale; Pos = pos;
        }
    }

    /// <summary>
    /// Where each piece of the board and the box goes, and the parts of the two
    /// meshes Thornswood drew itself: the nail heads, the coin slot and its
    /// lip, and the collision boxes, as the blocks Build-NoticeBoard.py writes
    /// for them. The one in use is BoardRecipe.Shipped, in FromGameBoard.cs,
    /// which that script writes.
    /// </summary>
    public sealed partial class BoardRecipe
    {
        public string[] Archives;
        public BoardSource[] Sources;
        public BoardPart[] Parts;
        public BoardPart Box;
        public string NailSource, NailTexture, BodyBoard, BodyBox, BoardRoot, BoxRoot;
        public string NailHeads, CoinSlotLip, CoinSlot, BoardList, BoxList;
        public string[] BoardHulls, BoxHulls;
        public string BoardPath, BoardSha256, BoxPath, BoxSha256;
        public int BoardSize, BoxSize;
    }

    /// <summary>One of the game's meshes the board is made from, as the game Build-NoticeBoard.py read had it.</summary>
    public sealed class BoardSource
    {
        public string Path, Sha256;
        public int Size;
        public BoardSource(string path, int size, string sha256) { Path = path; Size = size; Sha256 = sha256; }
    }

    sealed class Geometry
    {
        public int Count;
        public double[] Pos;
        public byte[] Raw;
    }

    /// <summary>One BSTriShape of a vanilla mesh, with what it needs to be copied: Build-NoticeBoard.py's Nif.shapes().</summary>
    sealed class NifShape
    {
        public uint Flags;
        public ulong Desc;
        public int Count;
        public byte[] Raw, Tris;
        public int TriCount;
        public bool HasAlpha;
        public ushort AlphaFlags;
        public byte AlphaThreshold;
        public byte[] Shader, TexSet;
        public string[] Paths;
        public double[] M, T;
        public double S;
    }

    /// <summary>Enough of a Skyrim Special Edition NIF to copy its shapes.</summary>
    static class NifRead
    {
        static readonly string[] Nodes = { "NiNode", "BSFadeNode", "BSValueNode", "BSLeafAnimNode", "BSMultiBoundNode", "BSOrderedNode" };

        sealed class File
        {
            public byte[] Data;
            public string[] Kinds, Strings;
            public int[] Offsets, Sizes;
        }

        static File Open(byte[] data, string name)
        {
            int o = Array.IndexOf(data, (byte)'\n') + 1;
            uint version = BitConverter.ToUInt32(data, o);
            uint user = BitConverter.ToUInt32(data, o + 5);
            int count = (int)BitConverter.ToUInt32(data, o + 9);
            uint bsver = BitConverter.ToUInt32(data, o + 13);
            o += 17;
            if (version != 0x14020007 || user != 12 || bsver != 100) throw new InvalidDataException(name + " is not a Skyrim Special Edition NIF");
            for (int i = 0; i < 3; i++) o += 1 + data[o];
            int ntypes = BitConverter.ToUInt16(data, o); o += 2;
            var types = new string[ntypes];
            for (int i = 0; i < ntypes; i++) types[i] = Sized(data, ref o);
            var f = new File { Data = data, Kinds = new string[count], Offsets = new int[count], Sizes = new int[count] };
            for (int i = 0; i < count; i++) { f.Kinds[i] = types[BitConverter.ToUInt16(data, o) & 0x7FFF]; o += 2; }
            for (int i = 0; i < count; i++) { f.Sizes[i] = (int)BitConverter.ToUInt32(data, o); o += 4; }
            int nstr = (int)BitConverter.ToUInt32(data, o); o += 8;
            f.Strings = new string[nstr];
            for (int i = 0; i < nstr; i++) f.Strings[i] = Sized(data, ref o);
            int groups = (int)BitConverter.ToUInt32(data, o); o += 4 + 4 * groups;
            for (int i = 0; i < count; i++) { f.Offsets[i] = o; o += f.Sizes[i]; }
            return f;
        }

        static string Sized(byte[] d, ref int o)
        {
            int n = (int)BitConverter.ToUInt32(d, o);
            o += 4;
            var c = new char[n];
            for (int i = 0; i < n; i++) c[i] = (char)d[o + i];
            o += n;
            return new string(c);
        }

        static byte[] Block(File f, int i)
        {
            var b = new byte[f.Sizes[i]];
            Buffer.BlockCopy(f.Data, f.Offsets[i], b, 0, b.Length);
            return b;
        }

        /// <summary>The first block of <paramref name="kind"/>, as its bytes.</summary>
        public static byte[] First(byte[] data, string kind, string name)
        {
            File f = Open(data, name);
            for (int i = 0; i < f.Kinds.Length; i++) if (f.Kinds[i] == kind) return Block(f, i);
            throw new InvalidDataException(name + " has no " + kind + " to take settings from");
        }

        // NiAVObject: name, extra data, controller, flags, translation, rotation, scale, collision.
        static void Av(byte[] d, ref int o, out uint flags, out double[] tr, out double[] rot, out double sc)
        {
            o += 4;
            int extra = (int)BitConverter.ToUInt32(d, o);
            o += 4 + 4 * extra + 4;
            flags = BitConverter.ToUInt32(d, o); o += 4;
            tr = new double[3];
            for (int i = 0; i < 3; i++) { tr[i] = BitConverter.ToSingle(d, o); o += 4; }
            rot = new double[9];
            for (int i = 0; i < 9; i++) { rot[i] = BitConverter.ToSingle(d, o); o += 4; }
            sc = BitConverter.ToSingle(d, o); o += 4;
            o += 4;
        }

        public static List<NifShape> Shapes(byte[] data, string name)
        {
            File f = Open(data, name);
            var l = new List<NifShape>();
            Walk(f, 0, new double[] { 1, 0, 0, 0, 1, 0, 0, 0, 1 }, new double[3], 1.0, l, name);
            return l;
        }

        static void Walk(File f, int i, double[] m, double[] t, double s, List<NifShape> l, string name)
        {
            byte[] d = f.Data;
            int o = f.Offsets[i];
            string kind = f.Kinds[i];
            uint flags;
            double[] tr, rot;
            double sc;
            if (Array.IndexOf(Nodes, kind) >= 0)
            {
                Av(d, ref o, out flags, out tr, out rot, out sc);
                if ((flags & 1) != 0) return;
                double[] m2 = FromGameMath.MatMulT(m, rot);
                double[] mt = FromGameMath.MatVec(m, tr);
                double[] t2 = { t[0] + s * mt[0], t[1] + s * mt[1], t[2] + s * mt[2] };
                double s2 = s * sc;
                int n = (int)BitConverter.ToUInt32(d, o); o += 4;
                for (int c = 0; c < n; c++)
                {
                    int k = BitConverter.ToInt32(d, o); o += 4;
                    if (k >= 0) Walk(f, k, m2, t2, s2, l, name);
                }
            }
            else if (kind == "BSTriShape")
            {
                Av(d, ref o, out flags, out tr, out rot, out sc);
                if ((flags & 1) != 0) return;
                o += 16;
                o += 4;
                int shader = BitConverter.ToInt32(d, o); o += 4;
                int alpha = BitConverter.ToInt32(d, o); o += 4;
                ulong desc = BitConverter.ToUInt64(d, o); o += 8;
                int ntri = BitConverter.ToUInt16(d, o), nv = BitConverter.ToUInt16(d, o + 2);
                o += 8;
                int vsize = (int)(desc & 0xF) * 4;
                var sh = new NifShape { Flags = flags, Desc = desc, Count = nv, TriCount = ntri };
                sh.Raw = new byte[nv * vsize];
                Buffer.BlockCopy(d, o, sh.Raw, 0, sh.Raw.Length);
                o += sh.Raw.Length;
                sh.Tris = new byte[ntri * 6];
                Buffer.BlockCopy(d, o, sh.Tris, 0, sh.Tris.Length);
                if (alpha >= 0)
                {
                    int ao = f.Offsets[alpha] + 12;
                    sh.HasAlpha = true;
                    sh.AlphaFlags = BitConverter.ToUInt16(d, ao);
                    sh.AlphaThreshold = d[ao + 2];
                }
                sh.Shader = Block(f, shader);
                int nextra = (int)BitConverter.ToUInt32(sh.Shader, 8);
                int ts = BitConverter.ToInt32(sh.Shader, 12 + 4 * nextra + 4 + 24);
                if (f.Kinds[ts] != "BSShaderTextureSet") throw new InvalidDataException(name + " has a shader that does not name a texture set");
                sh.TexSet = Block(f, ts);
                int to = 0;
                int np = (int)BitConverter.ToUInt32(sh.TexSet, to); to += 4;
                sh.Paths = new string[np];
                for (int p = 0; p < np; p++) sh.Paths[p] = Sized(sh.TexSet, ref to);
                sh.M = FromGameMath.MatMulT(m, rot);
                sh.S = s * sc;
                double[] mt = FromGameMath.MatVec(m, tr);
                sh.T = new double[] { t[0] + s * mt[0], t[1] + s * mt[1], t[2] + s * mt[2] };
                l.Add(sh);
            }
        }
    }

    /// <summary>Build-NoticeBoard.py's Mesh: the blocks of a built NIF, and the file they make.</summary>
    sealed class NifMesh
    {
        readonly List<string> kinds = new List<string>();
        readonly List<byte[]> bodies = new List<byte[]>();
        readonly List<string> strings = new List<string>();
        readonly List<int> kids = new List<int>();
        readonly string rootName;
        readonly int root, bsx;
        const uint AvFlags = 524302; // the flags vanilla static shapes and roots carry

        public NifMesh(string rootName)
        {
            this.rootName = rootName;
            root = Add("BSFadeNode", new byte[0]);
            var w = new Writer();
            w.I(String("BSX")); w.U(130);
            bsx = Add("BSXFlags", w.Bytes());
        }

        int String(string s)
        {
            int i = strings.IndexOf(s);
            if (i >= 0) return i;
            strings.Add(s);
            return strings.Count - 1;
        }

        int Add(string kind, byte[] body)
        {
            kinds.Add(kind);
            bodies.Add(body);
            return kinds.Count - 1;
        }

        static void AvObject(Writer w, int name, uint flags, int[] extra, int collision)
        {
            w.I(name); w.U((uint)extra.Length);
            foreach (int e in extra) w.I(e);
            w.I(-1); w.U(flags);
            w.F(0); w.F(0); w.F(0);
            w.F(1); w.F(0); w.F(0); w.F(0); w.F(1); w.F(0); w.F(0); w.F(0); w.F(1);
            w.F(1);
            w.I(collision);
        }

        /// <summary>Build-NoticeBoard.py's shader_copy(): a vanilla BSLightingShaderProperty with no name, extra data or controller, pointing at texset.</summary>
        static byte[] ShaderCopy(byte[] src, int texset, bool vertexColours)
        {
            int nextra = (int)BitConverter.ToUInt32(src, 8);
            int from = 12 + 4 * nextra + 4;
            var rest = new byte[src.Length - from];
            Buffer.BlockCopy(src, from, rest, 0, rest.Length);
            Buffer.BlockCopy(BitConverter.GetBytes(texset), 0, rest, 24, 4);
            if (vertexColours)
            {
                uint f2 = BitConverter.ToUInt32(rest, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(f2 | 0x20), 0, rest, 4, 4);
            }
            var w = new Writer();
            w.Raw(src, 0, 4); w.I(-1); w.U(0); w.I(-1); w.Raw(rest, 0, rest.Length);
            return w.Bytes();
        }

        int[] Materials(NifShape s, bool vertexColours)
        {
            int ts = Add("BSShaderTextureSet", s.TexSet);
            int sh = Add("BSLightingShaderProperty", ShaderCopy(s.Shader, ts, vertexColours));
            return new[] { ts, sh };
        }

        /// <summary>A vanilla shape, baked into place, with its own texture set, shader and alpha.</summary>
        public void Shape(string name, NifShape s, Geometry g, bool vertexColours)
        {
            int sh = Materials(s, vertexColours)[1];
            int al = -1;
            if (s.HasAlpha)
            {
                var a = new Writer();
                a.I(-1); a.U(0); a.I(-1); a.H(s.AlphaFlags); a.B(s.AlphaThreshold);
                al = Add("NiAlphaProperty", a.Bytes());
            }
            double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue }, hi = { double.MinValue, double.MinValue, double.MinValue };
            for (int i = 0; i < g.Count; i++)
                for (int k = 0; k < 3; k++)
                {
                    double v = g.Pos[i * 3 + k];
                    if (v < lo[k]) lo[k] = v;
                    if (v > hi[k]) hi[k] = v;
                }
            double[] c = { (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2 };
            double rad2 = double.MinValue;
            for (int i = 0; i < g.Count; i++)
            {
                double dx = g.Pos[i * 3] - c[0], dy = g.Pos[i * 3 + 1] - c[1], dz = g.Pos[i * 3 + 2] - c[2];
                double q = (dx * dx + dy * dy) + dz * dz;
                if (q > rad2) rad2 = q;
            }
            var w = new Writer();
            AvObject(w, String(name), s.Flags, new int[0], -1);
            w.F((float)c[0]); w.F((float)c[1]); w.F((float)c[2]); w.F((float)Math.Sqrt(rad2));
            w.I(-1); w.I(sh); w.I(al); w.Q(s.Desc);
            w.H((ushort)s.TriCount); w.H((ushort)g.Count); w.U((uint)(g.Raw.Length + s.Tris.Length));
            w.Raw(g.Raw, 0, g.Raw.Length);
            w.Raw(s.Tris, 0, s.Tris.Length);
            w.U(0);
            kids.Add(Add("BSTriShape", w.Bytes()));
        }

        /// <summary>A shape Thornswood drew, as the block Build-NoticeBoard.py wrote, on a vanilla shape's texture and shader.</summary>
        public void Ours(string name, NifShape material, byte[] body, bool vertexColours)
        {
            Materials(material, vertexColours);
            String(name);
            kids.Add(Add("BSTriShape", body));
        }

        public byte[] Finish(List<byte[]> hulls, string list, byte[] bodyTemplate)
        {
            var subs = new List<int>();
            foreach (byte[] h in hulls) subs.Add(Add("bhkConvexVerticesShape", h));
            int shape = subs.Count == 1 ? subs[0] : Add("bhkListShape", Convert.FromBase64String(list));
            var rb = (byte[])bodyTemplate.Clone();
            Buffer.BlockCopy(BitConverter.GetBytes(shape), 0, rb, 0, 4);
            int body = Add("bhkRigidBody", rb);
            var co = new Writer();
            co.I(root); co.H(0x81); co.I(body);
            int col = Add("bhkCollisionObject", co.Bytes());
            var w = new Writer();
            AvObject(w, String(rootName), AvFlags, new[] { bsx }, col);
            w.U((uint)kids.Count);
            foreach (int k in kids) w.I(k);
            w.U(0);
            bodies[root] = w.Bytes();

            var types = new List<string>();
            foreach (string k in kinds) if (!types.Contains(k)) types.Add(k);
            var o = new Writer();
            o.Raw(Encoding.ASCII.GetBytes("Gamebryo File Format, Version 20.2.0.7\n"));
            o.U(0x14020007); o.B(1); o.U(12); o.U((uint)bodies.Count); o.U(100);
            o.Short("Thornswood"); o.Short(""); o.Short("");
            o.H((ushort)types.Count);
            foreach (string t in types) o.Sized(t);
            foreach (string k in kinds) o.H((ushort)types.IndexOf(k));
            foreach (byte[] b in bodies) o.U((uint)b.Length);
            int longest = 0;
            foreach (string s in strings) longest = Math.Max(longest, s.Length);
            o.U((uint)strings.Count); o.U((uint)longest);
            foreach (string s in strings) o.Sized(s);
            o.U(0);
            foreach (byte[] b in bodies) o.Raw(b, 0, b.Length);
            o.U(1); o.I(0);
            return o.Bytes();
        }

        sealed class Writer
        {
            readonly MemoryStream m = new MemoryStream();
            public void Raw(byte[] b) { m.Write(b, 0, b.Length); }
            public void Raw(byte[] b, int at, int n) { m.Write(b, at, n); }
            public void I(int v) { Raw(BitConverter.GetBytes(v)); }
            public void U(uint v) { Raw(BitConverter.GetBytes(v)); }
            public void Q(ulong v) { Raw(BitConverter.GetBytes(v)); }
            public void H(ushort v) { Raw(BitConverter.GetBytes(v)); }
            public void B(byte v) { m.WriteByte(v); }
            public void F(float v) { Raw(BitConverter.GetBytes(v)); }
            public void Short(string s) { byte[] b = Encoding.ASCII.GetBytes(s + "\0"); B((byte)b.Length); Raw(b); }
            public void Sized(string s) { byte[] b = Encoding.ASCII.GetBytes(s); U((uint)b.Length); Raw(b); }
            public byte[] Bytes() { return m.ToArray(); }
        }
    }
}
