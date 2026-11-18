// WabbajackModlist.cs
//
// The modlist half of Install-NexusRevision.ps1 -Modlist (#6244): one revision
// of the collection written as a Wabbajack modlist that installs a portable
// Mod Organizer 2 instance, so the mods install without Vortex. Compiled by the
// script with Add-Type beside NexusLayout.cs.
//
// THE FORMAT is Wabbajack's, read in wabbajack-tools/wabbajack at ea2b901
// (5 Nov 2026): a zip holding "modlist", the ModList as JSON
// (Wabbajack.DTOs/ModList/ModList.cs), and one entry per inlined file, named by
// the directive's SourceDataID or PatchID (AInstaller.InlinedFileStream).
// Polymorphic objects carry "$type" as their FIRST property, because the
// reader looks at the first property only (JsonConverters/Generated.cs). A
// hash is xxHash64 of the bytes, written as the base64 of its eight
// little-endian bytes (Hashing.xxHash64/Hash.cs, HashJsonConverter). A path is
// its parts joined with \ (Paths/RelativePath.cs). Nothing here is copied
// from Wabbajack, whose code is GPLv3: this writes the format, it does not
// link the code.
//
// ONLY THESE DIRECTIVES are written, and the launcher's reader takes only these:
//   FromArchive          a file of a downloaded archive, by the archive's hash
//                        and its path inside it
//   PatchedFromArchive   the same file put through an Octodiff delta, for a
//                        file the collection patches (NexusLayout's bsdiff)
//   InlineFile           a file this run writes (the MO2 profile, meta.ini)
//   RemappedInlineFile   the same, with the game and MO2 folders put in at
//                        install (ModOrganizer.ini)
//
// THE DELTA is Octodiff's binary delta (Octopus.Octodiff, Apache 2.0, the
// format Wabbajack's BinaryPatching reads): "OCTODELTA", version 1, the hash
// algorithm's name and the new file's hash under it, ">>>", then commands:
// 0x60 copy (offset, length as Int64) from the old file, 0x80 data (length as
// Int64, then the bytes). Written here from that description.
//
// THE SAME RECORD WRITES THE SAME BYTES: inline entries are named in order,
// directives sort by their path, and every zip entry carries one fixed time,
// so the modlist's sha256 says whether two runs wrote the same thing.
//
// XXHASH64 is the launcher's (launcher\app\XxHash64.cs), compiled beside
// this file, so the writer and the launcher's reader name files by one hash.

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Thornswood.Layout
{
    // An Octodiff delta from one file's bytes to another's.
    public static class OctoDelta
    {
        const int Block = 2048;

        public static byte[] Make(string oldFile, string newFile)
        {
            return Make(File.ReadAllBytes(oldFile), File.ReadAllBytes(newFile));
        }

        // Blocks of the old file are found in the new one by a rolling sum and
        // checked byte for byte; what matches is a copy, the rest is data.
        // Adjacent copies are joined into one command.
        public static byte[] Make(byte[] oldBytes, byte[] newBytes)
        {
            var index = new Dictionary<uint, List<int>>();
            for (int at = 0; at + Block <= oldBytes.Length; at += Block)
            {
                uint w = Weak(oldBytes, at, Block);
                List<int> list;
                if (!index.TryGetValue(w, out list)) index[w] = list = new List<int>();
                list.Add(at);
            }
            using var ms = new MemoryStream();
            using var bw = new BinaryWriter(ms, Encoding.UTF8, leaveOpen: true);
            bw.Write(Encoding.ASCII.GetBytes("OCTODELTA"));
            bw.Write((byte)1);
            bw.Write("SHA1");
            byte[] want;
            using (var sha1 = SHA1.Create()) want = sha1.ComputeHash(newBytes);
            bw.Write(want.Length);
            bw.Write(want);
            bw.Write(Encoding.ASCII.GetBytes(">>>"));

            long copyFrom = -1, copyLen = 0;
            int dataStart = 0;
            int i = 0;
            uint a = 0, b = 0;
            bool rolling = false;
            Action flushCopy = () =>
            {
                if (copyLen > 0) { bw.Write((byte)0x60); bw.Write(copyFrom); bw.Write(copyLen); }
                copyFrom = -1; copyLen = 0;
            };
            Action<int> flushData = upTo =>
            {
                if (upTo > dataStart)
                {
                    flushCopy();
                    bw.Write((byte)0x80); bw.Write((long)(upTo - dataStart)); bw.Write(newBytes, dataStart, upTo - dataStart);
                }
                dataStart = upTo;
            };
            while (i + Block <= newBytes.Length)
            {
                if (!rolling) { Sums(newBytes, i, Block, out a, out b); rolling = true; }
                uint w = (b << 16) | a;
                List<int> cands;
                int hit = -1;
                if (index.TryGetValue(w, out cands))
                    foreach (int c in cands)
                        if (newBytes.AsSpan(i, Block).SequenceEqual(oldBytes.AsSpan(c, Block))) { hit = c; break; }
                if (hit >= 0)
                {
                    flushData(i);
                    if (copyLen > 0 && copyFrom + copyLen == hit) copyLen += Block;
                    else { flushCopy(); copyFrom = hit; copyLen = Block; }
                    i += Block;
                    dataStart = i;
                    rolling = false;
                    continue;
                }
                // Roll one byte on.
                if (i + Block < newBytes.Length)
                {
                    uint outB = newBytes[i], inB = newBytes[i + Block];
                    a = (a - outB + inB) & 0xFFFF;
                    b = (b - (uint)Block * outB + a) & 0xFFFF;
                }
                i++;
            }
            flushData(newBytes.Length);
            flushCopy();
            bw.Flush();
            return ms.ToArray();
        }

        static void Sums(byte[] d, int at, int len, out uint a, out uint b)
        {
            a = 0; b = 0;
            for (int k = 0; k < len; k++) { a = (a + d[at + k]) & 0xFFFF; b = (b + a) & 0xFFFF; }
        }

        static uint Weak(byte[] d, int at, int len)
        {
            uint a, b;
            Sums(d, at, len, out a, out b);
            return (b << 16) | a;
        }
    }

    public sealed class Modlist
    {
        public string Name = "", Author = "", Description = "", Website = "", Readme = "", Version = "1.0.0.0";
        public string GameType = "SkyrimSpecialEdition";
        // The oldest Wabbajack whose reader takes these directives, as its own
        // compiler writes it (Wabbajack.Compiler/Consts.cs).
        public string WabbajackVersion = "2.2.2.0";

        sealed class Arch { public string Name, Meta, StateJson; public long Size; public ulong Hash; }
        sealed class Dir { public string To, Json; }

        readonly List<Arch> archives = new List<Arch>();
        readonly HashSet<ulong> archiveHashes = new HashSet<ulong>();
        readonly Dictionary<string, Dir> directives = new Dictionary<string, Dir>(StringComparer.OrdinalIgnoreCase);
        readonly List<KeyValuePair<string, byte[]>> inline = new List<KeyValuePair<string, byte[]>>();

        public int ArchiveCount { get { return archives.Count; } }
        public int DirectiveCount { get { return directives.Count; } }

        static string Json(Action<Utf8JsonWriter> write)
        {
            var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms)) write(w);
            return Encoding.UTF8.GetString(ms.ToArray());
        }

        void AddArchive(Arch a)
        {
            if (!archiveHashes.Add(a.Hash)) throw new InvalidOperationException("two archives have the hash " + XxHash64.Base64(a.Hash) + " (" + a.Name + ")");
            archives.Add(a);
        }

        public void AddNexusArchive(string name, long size, ulong hash, string gameDomain, long modId, long fileId, string modName, string version)
        {
            AddArchive(new Arch
            {
                Name = name, Size = size, Hash = hash,
                Meta = "[General]\ngameName=" + gameDomain + "\nmodID=" + modId + "\nfileID=" + fileId + "\n",
                StateJson = Json(w =>
                {
                    w.WriteStartObject();
                    w.WriteString("$type", "NexusDownloader, Wabbajack.Lib");
                    w.WriteString("Author", "");
                    w.WriteString("Description", "");
                    w.WriteNumber("FileID", fileId);
                    w.WriteString("GameName", GameType);
                    w.WriteNull("ImageURL");
                    w.WriteBoolean("IsNSFW", false);
                    w.WriteNumber("ModID", modId);
                    w.WriteString("Name", modName ?? "");
                    w.WriteString("Version", version ?? "");
                    w.WriteEndObject();
                })
            });
        }

        public void AddHttpArchive(string name, long size, ulong hash, string url)
        {
            AddArchive(new Arch
            {
                Name = name, Size = size, Hash = hash,
                Meta = "[General]\ndirectURL=" + url + "\n",
                StateJson = Json(w =>
                {
                    w.WriteStartObject();
                    w.WriteString("$type", "HttpDownloader, Wabbajack.Lib");
                    w.WriteStartArray("Headers"); w.WriteEndArray();
                    w.WriteString("Url", url);
                    w.WriteEndObject();
                })
            });
        }

        static string Rel(string p)
        {
            var parts = p.Replace('/', '\\').Split('\\').Where(x => x.Length > 0).ToArray();
            if (parts.Length == 0 || parts.Any(x => x == "." || x == "..")) throw new ArgumentException("not a path inside the install: " + p);
            return string.Join("\\", parts);
        }

        void Put(string to, Action<Utf8JsonWriter> body)
        {
            to = Rel(to);
            if (directives.ContainsKey(to)) throw new InvalidOperationException("two files go to " + to);
            directives[to] = new Dir { To = to, Json = Json(w => { w.WriteStartObject(); body(w); w.WriteString("To", to); w.WriteEndObject(); }) };
        }

        void CheckArchive(ulong archiveHash)
        {
            if (!archiveHashes.Contains(archiveHash)) throw new InvalidOperationException("no archive has the hash " + XxHash64.Base64(archiveHash));
        }

        public void FromArchive(ulong archiveHash, string pathInArchive, ulong hash, long size, string to)
        {
            CheckArchive(archiveHash);
            string inArc = Rel(pathInArchive);
            Put(to, w =>
            {
                w.WriteString("$type", "FromArchive");
                w.WriteStartArray("ArchiveHashPath"); w.WriteStringValue(XxHash64.Base64(archiveHash)); w.WriteStringValue(inArc); w.WriteEndArray();
                w.WriteString("Hash", XxHash64.Base64(hash));
                w.WriteNumber("Size", size);
            });
        }

        public void PatchedFromArchive(ulong archiveHash, string pathInArchive, ulong fromHash, byte[] delta, ulong hash, long size, string to)
        {
            CheckArchive(archiveHash);
            string inArc = Rel(pathInArchive);
            string id = AddInline(delta);
            Put(to, w =>
            {
                w.WriteString("$type", "PatchedFromArchive");
                w.WriteStartArray("ArchiveHashPath"); w.WriteStringValue(XxHash64.Base64(archiveHash)); w.WriteStringValue(inArc); w.WriteEndArray();
                w.WriteString("FromHash", XxHash64.Base64(fromHash));
                w.WriteString("Hash", XxHash64.Base64(hash));
                w.WriteString("PatchID", id);
                w.WriteNumber("Size", size);
            });
        }

        public void Inline(byte[] data, string to, bool remapped)
        {
            string id = AddInline(data);
            ulong h = XxHash64.OfBytes(data);
            Put(to, w =>
            {
                w.WriteString("$type", remapped ? "RemappedInlineFile" : "InlineFile");
                w.WriteString("Hash", XxHash64.Base64(h));
                w.WriteNumber("Size", data.LongLength);
                w.WriteString("SourceDataID", id);
            });
        }

        string AddInline(byte[] data)
        {
            string id = "inline-" + (inline.Count + 1).ToString("D5");
            inline.Add(new KeyValuePair<string, byte[]>(id, data));
            return id;
        }

        // Every entry carries this one time, so the same record makes the same zip.
        static readonly DateTimeOffset Fixed = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

        public void Save(string path)
        {
            var dirs = directives.Values.OrderBy(d => d.To, StringComparer.OrdinalIgnoreCase).ThenBy(d => d.To, StringComparer.Ordinal).ToList();
            var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms))
            {
                w.WriteStartObject();
                w.WriteStartArray("Archives");
                foreach (var a in archives.OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Hash))
                {
                    w.WriteStartObject();
                    w.WriteString("Hash", XxHash64.Base64(a.Hash));
                    w.WriteString("Meta", a.Meta);
                    w.WriteString("Name", a.Name);
                    w.WriteNumber("Size", a.Size);
                    w.WritePropertyName("State");
                    w.WriteRawValue(a.StateJson);
                    w.WriteEndObject();
                }
                w.WriteEndArray();
                w.WriteString("Author", Author);
                w.WriteString("Community", "");
                w.WriteString("Description", Description);
                w.WriteStartArray("Directives");
                foreach (var d in dirs) w.WriteRawValue(d.Json);
                w.WriteEndArray();
                w.WriteString("GameType", GameType);
                w.WriteBoolean("IsNSFW", false);
                w.WriteString("Name", Name);
                w.WriteString("Readme", Readme);
                w.WriteString("Version", Version);
                w.WriteString("WabbajackVersion", WabbajackVersion);
                w.WriteString("Website", Website);
                w.WriteEndObject();
            }
            string tmp = path + ".part";
            if (File.Exists(tmp)) File.Delete(tmp);
            using (var fs = new FileStream(tmp, FileMode.CreateNew))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                Action<string, byte[]> add = (n, bytes) =>
                {
                    var e = zip.CreateEntry(n, CompressionLevel.Optimal);
                    e.LastWriteTime = Fixed;
                    using (var s = e.Open()) s.Write(bytes, 0, bytes.Length);
                };
                add("modlist", ms.ToArray());
                foreach (var kv in inline) add(kv.Key, kv.Value);
            }
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }
    }
}
