// ModlistInstall.cs
//
// The launcher's reader of the collection's Wabbajack modlist (#6244), and the
// install it makes: a portable Mod Organizer 2 in <Root>\Mods with every mod
// of the revision in its own folder, built from the archives in
// <Root>\Mods\downloads, every file held to the hash the modlist names.
//
// WHAT IT READS is what scripts\release\WabbajackModlist.cs writes, and only
// that: a zip holding "modlist" (the JSON) and one entry per inline file or
// patch, archives that are Nexus files or one Http download (Mod Organizer 2
// from its GitHub release), and the four directive kinds FromArchive,
// PatchedFromArchive, InlineFile and RemappedInlineFile. Any other kind, a
// path that leaves the install, a hash that is not one, or two files at one
// path, stops the read, naming it, before anything is written. Wabbajack's
// code is GPLv3 and none of it is here: this reads the format.
//
// WHERE IT COMES FROM. Each merge release carries the modlist as its part
// "modlist", its sha256 in the signed record (VeloRecord.cs,
// records\collection-modlist.wabbajack); the caller holds the file to that
// before it reads it here.
//
// WHAT IT DOES NOT DO: download. Missing() says which archives are not in
// downloads, held to size and xxHash64. ModlistFetch.cs downloads the ones the
// modlist gets by address (Mod Organizer 2 from its GitHub release) and puts
// in the pinned unpacker, whose SevenZip.With unpacks what is not a zip, and
// takes a Nexus file already on this PC or downloaded by hand from Nexus
// (FromPlaces, ByHand). Nexus.cs signs a person in to Nexus and downloads a
// Premium account's Nexus files. The game still
// runs from Thornswood's own folder (OwnGame.cs), never inside MO2.
//
// A reason a person reads comes from Failure.cs, as every catch's does
// (#4633). tests\test-6244-modlist-install.ps1 builds it with the launcher and
// the writer, and installs a modlist the writer made.

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Thornswood
{
    /// <summary>Why a modlist was not read or not installed, in words a person reads.</summary>
    public sealed class ModlistStop : Exception
    {
        public ModlistStop(string message) : base(message) { }
    }

    public sealed class ModlistArchive
    {
        public string Name;
        public long Size;
        public ulong Hash;
        /// <summary>"nexus" or "http".</summary>
        public string Kind;
        public string Game;
        public long ModId;
        public long FileId;
        public string ModName;
        public string Url;

        public string Say()
        {
            if (Kind == "nexus") return (string.IsNullOrEmpty(ModName) ? Name : ModName) + " (mod " + ModId + ", file " + FileId + ")";
            return Name + " (" + Url + ")";
        }
    }

    public sealed class ModlistFile
    {
        public string Kind;
        /// <summary>The path in the install, parts joined with \.</summary>
        public string To;
        public ulong Hash;
        public long Size;
        public ulong ArchiveHash;
        public string InArchive;
        public ulong FromHash;
        /// <summary>The zip entry of an inline file (SourceDataID) or a patch (PatchID).</summary>
        public string DataId;
    }

    /// <summary>A modlist as WabbajackModlist.cs writes it, read and checked.</summary>
    public sealed class CollectionModlist
    {
        public static readonly string[] Kinds = { "FromArchive", "PatchedFromArchive", "InlineFile", "RemappedInlineFile" };

        public string File;
        public string Name;
        public string Version;
        public string GameType;
        public readonly List<ModlistArchive> Archives = new List<ModlistArchive>();
        public readonly List<ModlistFile> Files = new List<ModlistFile>();
        readonly Dictionary<string, byte[]> data = new Dictionary<string, byte[]>(StringComparer.Ordinal);

        public byte[] Data(string id)
        {
            byte[] b;
            if (id == null || !data.TryGetValue(id, out b)) throw new ModlistStop("The modlist names " + id + ", which it does not hold.");
            return b;
        }

        public ModlistArchive Archive(ulong hash)
        {
            return Archives.FirstOrDefault(a => a.Hash == hash);
        }

        /// <summary>A path inside the install, parts joined with \, or null for one that is not.</summary>
        // The characters Windows refuses in a file name, on any machine, so a
        // path that reads on Linux is not one Windows would turn down.
        static readonly char[] NotInName = { '<', '>', ':', '"', '|', '?', '*' };

        public static string InsidePath(string p)
        {
            if (string.IsNullOrEmpty(p)) return null;
            var parts = new List<string>();
            foreach (string x in p.Replace('/', '\\').Split('\\').Where(part => part.Length > 0))
            {
                if (x == "." || x == ".." || x.IndexOfAny(NotInName) >= 0) return null;
                foreach (char c in x) if (c < ' ') return null;
                if (x.Trim().Length == 0 || x.EndsWith(" ", StringComparison.Ordinal) || x.EndsWith(".", StringComparison.Ordinal)) return null;
                parts.Add(x);
            }
            if (parts.Count == 0 || p.StartsWith("\\", StringComparison.Ordinal) || p.StartsWith("/", StringComparison.Ordinal)) return null;
            return string.Join("\\", parts);
        }

        static string Str(JsonElement o, string name)
        {
            JsonElement v;
            if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out v)) return null;
            return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        }

        static long Num(JsonElement o, string name)
        {
            JsonElement v;
            long n;
            if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out v) || v.ValueKind != JsonValueKind.Number || !v.TryGetInt64(out n)) return -1;
            return n;
        }

        static ulong Hash(JsonElement o, string name, string what)
        {
            ulong h;
            if (!XxHash64.TryParse(Str(o, name), out h)) throw new ModlistStop("The modlist gives " + what + " no " + name + " that is a hash.");
            return h;
        }

        /// <summary>The $type, which the format puts first in every object.</summary>
        static string TypeOf(JsonElement o)
        {
            if (o.ValueKind != JsonValueKind.Object) return null;
            foreach (JsonProperty p in o.EnumerateObject()) return p.Name == "$type" && p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : null;
            return null;
        }

        public static CollectionModlist Read(string path)
        {
            var m = new CollectionModlist { File = path };
            byte[] json = null;
            try
            {
                using (ZipArchive zip = ZipFile.OpenRead(path))
                    foreach (ZipArchiveEntry e in zip.Entries.Where(z => !z.FullName.EndsWith("/", StringComparison.Ordinal)))
                    {
                        if (e.Length > 256L * 1024 * 1024) throw new ModlistStop("The modlist's entry " + e.FullName + " is " + e.Length + " bytes, more than any file it may hold.");
                        using var ms = new MemoryStream();
                        using (Stream s = e.Open()) s.CopyTo(ms);
                        if (e.FullName == "modlist") json = ms.ToArray();
                        else m.data[e.FullName] = ms.ToArray();
                    }
            }
            catch (InvalidDataException ex) { throw new ModlistStop(path + " is not a modlist: " + Failure.Why("CollectionModlist.Read, open " + path, ex, path) + "."); }
            if (json == null) throw new ModlistStop(path + " holds no modlist.");

            JsonDocument doc;
            try { doc = JsonDocument.Parse(json); }
            catch (JsonException ex) { throw new ModlistStop("The modlist in " + path + " does not read: " + Failure.Why("CollectionModlist.Read, parse " + path, ex, path) + "."); }
            using (doc)
            {
                JsonElement root = doc.RootElement;
                m.Name = Str(root, "Name");
                m.Version = Str(root, "Version");
                m.GameType = Str(root, "GameType");
                if (m.GameType != "SkyrimSpecialEdition") throw new ModlistStop("The modlist is for " + (m.GameType ?? "no game") + ", not Skyrim Special Edition.");

                JsonElement arr;
                if (!root.TryGetProperty("Archives", out arr) || arr.ValueKind != JsonValueKind.Array) throw new ModlistStop("The modlist lists no archives.");
                var seen = new HashSet<ulong>();
                foreach (JsonElement a in arr.EnumerateArray())
                {
                    var x = new ModlistArchive { Name = Str(a, "Name"), Size = Num(a, "Size") };
                    if (string.IsNullOrEmpty(x.Name) || InsidePath(x.Name) != x.Name || x.Name.IndexOf('\\') >= 0 || x.Name.StartsWith(".", StringComparison.Ordinal))
                        throw new ModlistStop("The modlist names an archive \"" + x.Name + "\", which is not a file name.");
                    if (x.Size < 0) throw new ModlistStop("The modlist gives the archive " + x.Name + " no size.");
                    x.Hash = Hash(a, "Hash", "the archive " + x.Name);
                    if (!seen.Add(x.Hash)) throw new ModlistStop("The modlist names two archives with the hash " + XxHash64.Base64(x.Hash) + ".");
                    JsonElement st;
                    if (!a.TryGetProperty("State", out st)) throw new ModlistStop("The modlist gives the archive " + x.Name + " no source.");
                    string t = TypeOf(st);
                    if (t == "NexusDownloader, Wabbajack.Lib")
                    {
                        x.Kind = "nexus";
                        x.Game = Str(st, "GameName");
                        x.ModId = Num(st, "ModID");
                        x.FileId = Num(st, "FileID");
                        x.ModName = Str(st, "Name");
                        if (x.Game != "SkyrimSpecialEdition" || x.ModId <= 0 || x.FileId <= 0) throw new ModlistStop("The modlist gives the archive " + x.Name + " no Skyrim Special Edition mod and file on Nexus.");
                    }
                    else if (t == "HttpDownloader, Wabbajack.Lib")
                    {
                        x.Kind = "http";
                        x.Url = Str(st, "Url");
                        Uri u;
                        if (x.Url == null || !Uri.TryCreate(x.Url, UriKind.Absolute, out u) || u.Scheme != "https" || u.Host != "github.com")
                            throw new ModlistStop("The modlist would download " + x.Name + " from " + (x.Url ?? "nowhere") + ", and the launcher downloads only from GitHub over https.");
                    }
                    else throw new ModlistStop("The modlist would get the archive " + x.Name + " by " + (t ?? "no source") + ", which the launcher does not take.");
                    m.Archives.Add(x);
                }

                if (!root.TryGetProperty("Directives", out arr) || arr.ValueKind != JsonValueKind.Array) throw new ModlistStop("The modlist lists no files.");
                var to = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (JsonElement d in arr.EnumerateArray())
                {
                    string kind = TypeOf(d);
                    string rawTo = Str(d, "To");
                    if (Array.IndexOf(Kinds, kind) < 0) throw new ModlistStop("The modlist would make " + (rawTo ?? "a file") + " by " + (kind ?? "no kind") + ", which the launcher does not take (only " + string.Join(", ", Kinds) + ").");
                    string inside = InsidePath(rawTo);
                    if (inside == null) throw new ModlistStop("The modlist would write " + (rawTo ?? "a file with no path") + ", which is not a path inside the install.");
                    if (!to.Add(inside)) throw new ModlistStop("The modlist writes " + inside + " twice.");
                    var f = new ModlistFile { Kind = kind, To = inside, Size = Num(d, "Size") };
                    f.Hash = Hash(d, "Hash", inside);
                    if (f.Size < 0) throw new ModlistStop("The modlist gives " + inside + " no size.");
                    if (kind == "FromArchive" || kind == "PatchedFromArchive")
                    {
                        JsonElement hp;
                        if (!d.TryGetProperty("ArchiveHashPath", out hp) || hp.ValueKind != JsonValueKind.Array || hp.GetArrayLength() != 2)
                            throw new ModlistStop("The modlist names no archive and path for " + inside + ".");
                        ulong ah;
                        if (!XxHash64.TryParse(hp[0].ValueKind == JsonValueKind.String ? hp[0].GetString() : null, out ah) || m.Archive(ah) == null)
                            throw new ModlistStop("The modlist takes " + inside + " from an archive it does not list.");
                        f.ArchiveHash = ah;
                        f.InArchive = InsidePath(hp[1].ValueKind == JsonValueKind.String ? hp[1].GetString() : null);
                        if (f.InArchive == null) throw new ModlistStop("The modlist takes " + inside + " from a path that is not inside its archive.");
                        if (kind == "PatchedFromArchive")
                        {
                            f.FromHash = Hash(d, "FromHash", inside);
                            f.DataId = Str(d, "PatchID");
                            m.Data(f.DataId);
                        }
                    }
                    else
                    {
                        f.DataId = Str(d, "SourceDataID");
                        byte[] b = m.Data(f.DataId);
                        if (kind == "InlineFile" && (b.LongLength != f.Size || XxHash64.OfBytes(b) != f.Hash))
                            throw new ModlistStop("The modlist's own copy of " + inside + " is not the file it names.");
                    }
                    m.Files.Add(f);
                }
            }
            return m;
        }
    }

    /// <summary>Octodiff's binary delta applied to the old file's bytes (WabbajackModlist.cs, THE DELTA).</summary>
    public static class OctoDeltaApply
    {
        public static byte[] Apply(byte[] old, byte[] delta)
        {
            using (var br = new BinaryReader(new MemoryStream(delta, false), Encoding.UTF8))
            {
                try
                {
                    if (Encoding.ASCII.GetString(br.ReadBytes(9)) != "OCTODELTA" || br.ReadByte() != 1) throw new ModlistStop("A patch in the modlist is not an Octodiff delta.");
                    if (br.ReadString() != "SHA1") throw new ModlistStop("A patch in the modlist names its file by a hash other than SHA1.");
                    int n = br.ReadInt32();
                    if (n != 20) throw new ModlistStop("A patch in the modlist names its file by a SHA1 that is not 20 bytes.");
                    byte[] want = br.ReadBytes(n);
                    if (Encoding.ASCII.GetString(br.ReadBytes(3)) != ">>>") throw new ModlistStop("A patch in the modlist has no commands where they start.");
                    using var output = new MemoryStream();
                    while (br.BaseStream.Position < br.BaseStream.Length)
                    {
                        byte c = br.ReadByte();
                        if (c == 0x60)
                        {
                            long at = br.ReadInt64(), len = br.ReadInt64();
                            if (at < 0 || len < 0 || at + len > old.LongLength) throw new ModlistStop("A patch in the modlist copies past the end of the file it patches.");
                            output.Write(old, (int)at, (int)len);
                        }
                        else if (c == 0x80)
                        {
                            long len = br.ReadInt64();
                            if (len < 0 || len > br.BaseStream.Length - br.BaseStream.Position) throw new ModlistStop("A patch in the modlist is cut short.");
                            output.Write(br.ReadBytes((int)len), 0, (int)len);
                        }
                        else throw new ModlistStop("A patch in the modlist has a command (" + c + ") Octodiff does not write.");
                    }
                    byte[] got = output.ToArray();
                    byte[] sha;
                    using (var s1 = SHA1.Create()) sha = s1.ComputeHash(got);
                    if (!CryptographicOperations.FixedTimeEquals(sha, want)) throw new ModlistStop("A patch in the modlist does not make the file it names.");
                    return got;
                }
                catch (EndOfStreamException) { throw new ModlistStop("A patch in the modlist is cut short."); }
            }
        }
    }

    public static class ModlistInstall
    {
        /// <summary>Unpacks one archive into an empty folder.</summary>
        public delegate void Unpack(string archive, string into);

        /// <summary>A zip, by the framework. Anything else goes through SevenZip.With (ModlistFetch.cs).</summary>
        public static void UnpackZip(string archive, string into)
        {
            ZipFile.ExtractToDirectory(archive, into);
        }

        /// <summary>
        /// The archives of the modlist that are not in <paramref name="downloads"/>
        /// under their own name with their size and xxHash64. A file there that is
        /// not those bytes counts as not there and is left for the caller.
        /// </summary>
        public static List<ModlistArchive> Missing(CollectionModlist m, string downloads)
        {
            var missing = new List<ModlistArchive>();
            foreach (ModlistArchive a in m.Archives)
            {
                string f = Path.Combine(downloads, a.Name);
                if (!File.Exists(f) || new FileInfo(f).Length != a.Size || XxHash64.OfFile(f) != a.Hash) missing.Add(a);
            }
            return missing;
        }

        static string Under(string root, string rel)
        {
            string full = Path.GetFullPath(Path.Combine(root, rel.Replace('\\', Path.DirectorySeparatorChar)));
            string top = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(top, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                throw new ModlistStop(rel + " is not inside " + root + ".");
            return full;
        }

        static void Put(string full, Action<string> write)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(full));
            string part = full + ".part";
            write(part);
            File.Move(part, full, true);
        }

        static bool Already(string full, ModlistFile f)
        {
            return File.Exists(full) && new FileInfo(full).Length == f.Size && XxHash64.OfFile(full) == f.Hash;
        }

        /// <summary>
        /// A settings file in a mod, which a person may change in Mod
        /// Organizer 2 to suit their PC: an .ini or a .toml in a mod's folder.
        /// The mod's meta.ini is Mod Organizer 2's own, not one of these.
        /// </summary>
        public static bool Editable(string to)
        {
            string[] p = to.Split('\\');
            if (p.Length < 3 || !string.Equals(p[0], "mods", StringComparison.OrdinalIgnoreCase)) return false;
            if (p.Length == 3 && string.Equals(p[2], "meta.ini", StringComparison.OrdinalIgnoreCase)) return false;
            string ext = Path.GetExtension(to);
            return string.Equals(ext, ".ini", StringComparison.OrdinalIgnoreCase) || string.Equals(ext, ".toml", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Whether the person changed this settings file since the last whole
        /// install wrote it, so a new copy must not replace it: it is there,
        /// and it is neither the copy that install wrote (<paramref name="wrote"/>,
        /// by its path in the instance) nor the modlist's. Not when the last
        /// copy is not known, which is a first install, or a file another mod
        /// overrides and the game never reads.
        /// </summary>
        static bool Changed(string full, ModlistFile f, IReadOnlyDictionary<string, ulong> wrote)
        {
            ulong last;
            if (wrote == null || !Editable(f.To) || !wrote.TryGetValue(f.To, out last) || !File.Exists(full)) return false;
            ulong now = XxHash64.OfFile(full);
            return now != last && now != f.Hash;
        }

        /// <summary>The magic strings a RemappedInlineFile carries, put in for this install.</summary>
        public static string Remap(string text, string game, string mo2, string downloads)
        {
            foreach (var p in new[] { new[] { "GAME", game }, new[] { "MO2", mo2 }, new[] { "DOWNLOAD", downloads } })
            {
                string back = Path.GetFullPath(p[1]).TrimEnd('\\', '/').Replace('/', '\\');
                text = text.Replace("{--||" + p[0] + "_PATH_MAGIC_DOUBLE_BACK||--}", back.Replace("\\", "\\\\"))
                           .Replace("{--||" + p[0] + "_PATH_MAGIC_BACK||--}", back)
                           .Replace("{--||" + p[0] + "_PATH_MAGIC_FORWARD||--}", back.Replace('\\', '/'));
            }
            return text;
        }

        /// <summary>
        /// Installs <paramref name="m"/> into <paramref name="target"/> (the MO2
        /// instance's folder) from the archives in <paramref name="downloads"/>.
        /// Stops before writing anything when an archive is missing. A file
        /// already there with the modlist's size and hash is left as it is, so a
        /// run again finishes one that was cut short. Every file written is
        /// held to the modlist's hash first, through a .part beside it. A
        /// settings file the person changed since the last whole install wrote
        /// it (<paramref name="wrote"/>, each file's xxHash64 then, by its path
        /// in the instance) is kept as they left it (Changed); one still as
        /// that install wrote it takes the modlist's copy. Last, a file in one
        /// of the modlist's mod folders that it does not name is taken out
        /// (Tidy).
        /// </summary>
        public static int Install(CollectionModlist m, string downloads, string target, string game, Unpack unpack, Action<string> say, IReadOnlyDictionary<string, ulong> wrote)
        {
            List<ModlistArchive> missing = Missing(m, downloads);
            if (missing.Count > 0)
            {
                var names = new List<string>();
                foreach (ModlistArchive a in missing) names.Add(a.Say());
                throw new ModlistStop(missing.Count + " of the modlist's archives are not in " + downloads + " as it names them: " + string.Join(", ", names) + ".");
            }
            Directory.CreateDirectory(target);
            string work = Path.Combine(target, ".unpack");
            int written = 0;
            var kept = new List<string>();

            var byArchive = new Dictionary<ulong, List<ModlistFile>>();
            foreach (ModlistFile f in m.Files.Where(d => d.Kind == "FromArchive" || d.Kind == "PatchedFromArchive"))
            {
                List<ModlistFile> l;
                if (!byArchive.TryGetValue(f.ArchiveHash, out l)) byArchive[f.ArchiveHash] = l = new List<ModlistFile>();
                l.Add(f);
            }

            foreach (ModlistArchive a in m.Archives)
            {
                List<ModlistFile> files;
                if (!byArchive.TryGetValue(a.Hash, out files)) continue;
                var todo = new List<ModlistFile>();
                foreach (ModlistFile f in files)
                {
                    string full = Under(target, f.To);
                    if (Already(full, f)) continue;
                    if (Changed(full, f, wrote)) kept.Add(f.To);
                    else todo.Add(f);
                }
                if (todo.Count == 0) continue;
                if (Directory.Exists(work)) Directory.Delete(work, true);
                Directory.CreateDirectory(work);
                try
                {
                    unpack(Path.Combine(downloads, a.Name), work);
                    var index = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    foreach (string full in Directory.EnumerateFiles(work, "*", SearchOption.AllDirectories))
                    {
                        string rel = Path.GetRelativePath(work, full).Replace(Path.DirectorySeparatorChar, '\\');
                        if (!index.ContainsKey(rel)) index[rel] = full;
                    }
                    foreach (ModlistFile f in todo)
                    {
                        string src;
                        if (!index.TryGetValue(f.InArchive, out src)) throw new ModlistStop(a.Say() + " holds no " + f.InArchive + ", which the modlist takes for " + f.To + ".");
                        string dest = Under(target, f.To);
                        if (f.Kind == "FromArchive")
                        {
                            if (new FileInfo(src).Length != f.Size || XxHash64.OfFile(src) != f.Hash) throw new ModlistStop(f.InArchive + " in " + a.Say() + " is not the file the modlist names for " + f.To + ".");
                            Put(dest, delegate (string part) { File.Copy(src, part, true); });
                        }
                        else
                        {
                            if (XxHash64.OfFile(src) != f.FromHash) throw new ModlistStop(f.InArchive + " in " + a.Say() + " is not the file the modlist patches for " + f.To + ".");
                            byte[] made = OctoDeltaApply.Apply(File.ReadAllBytes(src), m.Data(f.DataId));
                            if (made.LongLength != f.Size || XxHash64.OfBytes(made) != f.Hash) throw new ModlistStop("The patch for " + f.To + " does not make the file the modlist names.");
                            Put(dest, delegate (string part) { File.WriteAllBytes(part, made); });
                        }
                        written++;
                    }
                    if (say != null) say(a.Say() + ": " + todo.Count + " files");
                }
                finally { if (Directory.Exists(work)) Directory.Delete(work, true); }
            }

            foreach (ModlistFile f in m.Files.Where(d => d.Kind == "InlineFile" || d.Kind == "RemappedInlineFile"))
            {
                string dest = Under(target, f.To);
                byte[] b = m.Data(f.DataId);
                if (f.Kind == "RemappedInlineFile") b = new UTF8Encoding(false).GetBytes(Remap(new UTF8Encoding(false).GetString(b), game, target, downloads));
                else if (Already(dest, f)) continue;
                if (File.Exists(dest) && File.ReadAllBytes(dest).AsSpan().SequenceEqual(b)) continue;
                if (f.Kind == "InlineFile" && Changed(dest, f, wrote)) { kept.Add(f.To); continue; }
                Put(dest, delegate (string part) { File.WriteAllBytes(part, b); });
                written++;
            }
            if (kept.Count > 0 && say != null)
                say("Kept " + kept.Count + " settings file" + (kept.Count == 1 ? "" : "s") + " you changed in the mods as you left " + (kept.Count == 1 ? "it" : "them") + ": " +
                    string.Join(", ", kept.Take(5)) + (kept.Count > 5 ? " and " + (kept.Count - 5) + " more" : "") +
                    ". Delete one to take the modlist's copy at the next install");
            Tidy(m, target, say);
            return written;
        }

        /// <summary>
        /// Takes out of each mod folder the modlist names (mods\&lt;mod&gt;) every
        /// file the modlist does not name there: what an earlier revision put
        /// in that this one no longer has, and a .part an install cut short
        /// left. Mod Organizer 2 then holds and shows exactly the modlist's
        /// mods. A folder the modlist does not name, and everything outside
        /// mods (downloads, profiles, overwrite), is left as it is.
        /// </summary>
        static void Tidy(CollectionModlist m, string target, Action<string> say)
        {
            var named = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var folders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (ModlistFile f in m.Files)
            {
                string[] p = f.To.Split('\\');
                if (p.Length < 3 || !string.Equals(p[0], "mods", StringComparison.OrdinalIgnoreCase)) continue;
                named.Add(f.To);
                folders.Add(p[1]);
            }
            int gone = 0;
            foreach (string mod in folders)
            {
                string dir = Under(target, "mods\\" + mod);
                if (!Directory.Exists(dir)) continue;
                foreach (string full in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).ToList())
                {
                    string rel = "mods\\" + mod + "\\" + Path.GetRelativePath(dir, full).Replace(Path.DirectorySeparatorChar, '\\');
                    if (named.Contains(rel)) continue;
                    File.Delete(full);
                    gone++;
                }
                foreach (string sub in Directory.EnumerateDirectories(dir, "*", SearchOption.AllDirectories).OrderByDescending(d => d.Length).ToList())
                    if (!Directory.EnumerateFileSystemEntries(sub).Any()) Directory.Delete(sub);
            }
            if (gone > 0 && say != null) say(gone + " files the modlist no longer has were taken out of the mods");
        }
    }
}
