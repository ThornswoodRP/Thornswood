using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Thornswood
{
    // Read-only metadata from LevelDB's current manifest, tables and WAL.
    // No database handle, lock or write is opened. Formats:
    // https://github.com/google/leveldb/blob/main/doc/table_format.md
    // https://github.com/google/snappy/blob/main/format_description.txt
    public static class VortexProfileState
    {
        const int Limit = 64 * 1024 * 1024;
        sealed class Value { public ulong Sequence; public string Text; }
        sealed class Entry { public byte[] Key, Data; }
        static byte[] Read(string path)
        {
            using (var file = new FileStream(path, FileMode.Open, FileAccess.Read,
                                            FileShare.ReadWrite | FileShare.Delete))
            {
                if (file.Length > Limit) throw new InvalidDataException("Vortex state file exceeds limit");
                var data = new byte[(int)file.Length]; int at = 0;
                while (at < data.Length) {
                    int n = file.Read(data, at, data.Length - at);
                    if (n == 0) throw new EndOfStreamException(); at += n;
                }
                return data;
            }
        }
        static ulong Var(byte[] data, ref int at)
        {
            ulong value = 0;
            for (int shift = 0; shift < 64; shift += 7) {
                if (at >= data.Length) throw new InvalidDataException("Truncated varint");
                byte b = data[at++];
                if (shift == 63 && b > 1) throw new InvalidDataException("Varint overflow");
                value |= (ulong)(b & 127) << shift;
                if (b < 128) return value;
            }
            throw new InvalidDataException("Varint overflow");
        }
        static int Size(ulong value) {
            if (value > Limit) throw new InvalidDataException("Vortex block exceeds limit");
            return (int)value;
        }
        static byte[] Slice(byte[] data, ref int at, int n) {
            if (n < 0 || at < 0 || n > data.Length - at) throw new InvalidDataException("Truncated block");
            var result = new byte[n]; Buffer.BlockCopy(data, at, result, 0, n); at += n; return result;
        }
        static byte[] Bytes(byte[] data, ref int at) { int n = Size(Var(data, ref at)); return Slice(data, ref at, n); }
        static uint Crc(byte[] data, int at, int length, int prefix) {
            uint crc = 0xffffffff;
            if (prefix >= 0) crc = CrcByte(crc, (byte)prefix);
            for (int i = 0; i < length; i++) crc = CrcByte(crc, data[at + i]);
            return ~crc;
        }
        static readonly uint[] CrcTable = MakeCrcTable();
        static uint[] MakeCrcTable() {
            var table = new uint[256];
            for (uint i = 0; i < 256; i++) {
                uint value = i;
                for (int j = 0; j < 8; j++) value = (value >> 1) ^ ((value & 1) != 0 ? 0x82f63b78U : 0);
                table[i] = value;
            }
            return table;
        }
        static uint CrcByte(uint crc, byte value) { return (crc >> 8) ^ CrcTable[(crc ^ value) & 255]; }
        static uint Mask(uint crc) { return unchecked(((crc >> 15) | (crc << 17)) + 0xa282ead8U); }
        static byte[] Unsnappy(byte[] input)
        {
            int at = 0, written = 0; var output = new byte[Size(Var(input, ref at))];
            while (at < input.Length) {
                int tag = input[at++], type = tag & 3, length, offset;
                if (type == 0) {
                    length = tag >> 2;
                    if (length >= 60) {
                        int count = length - 59; uint n = 0;
                        for (int j = 0; j < count; j++) {
                            if (at >= input.Length) throw new InvalidDataException("Truncated literal");
                            n |= (uint)input[at++] << (8 * j);
                        }
                        length = Size(n);
                    }
                    length++;
                    if (length > output.Length - written || length > input.Length - at) throw new InvalidDataException("Invalid literal");
                    Buffer.BlockCopy(input, at, output, written, length); at += length; written += length;
                } else {
                    if (type == 1) {
                        if (at >= input.Length) throw new InvalidDataException("Truncated copy");
                        length = 4 + ((tag >> 2) & 7); offset = ((tag & 224) << 3) | input[at++];
                    } else {
                        length = 1 + (tag >> 2); int count = type == 2 ? 2 : 4; uint n = 0;
                        for (int j = 0; j < count; j++) {
                            if (at >= input.Length) throw new InvalidDataException("Truncated copy");
                            n |= (uint)input[at++] << (8 * j);
                        }
                        offset = Size(n);
                    }
                    if (offset <= 0 || offset > written || length > output.Length - written) throw new InvalidDataException("Invalid copy");
                    for (int j = 0; j < length; j++) { output[written] = output[written - offset]; written++; }
                }
            }
            if (written != output.Length) throw new InvalidDataException("Truncated compressed block");
            return output;
        }
        static byte[] Block(byte[] file, ulong offset, ulong size) {
            int at = Size(offset), n = Size(size);
            if (at > file.Length - 5 || n > file.Length - at - 5) throw new InvalidDataException("Invalid block handle");
            byte kind = file[at + n];
            if (Mask(Crc(file, at, n + 1, -1)) != BitConverter.ToUInt32(file, at + n + 1)) throw new InvalidDataException("Block checksum mismatch");
            byte[] data = Slice(file, ref at, n);
            if (kind == 0) return data;
            if (kind == 1) return Unsnappy(data);
            throw new InvalidDataException("Unknown block compression");
        }
        static IEnumerable<Entry> Entries(byte[] block) {
            if (block.Length < 4) throw new InvalidDataException("Missing restart array");
            int restarts = Size(BitConverter.ToUInt32(block, block.Length - 4));
            if (restarts > (block.Length - 4) / 4) throw new InvalidDataException("Invalid restart count");
            int end = block.Length - 4 - restarts * 4, at = 0; byte[] previous = new byte[0];
            while (at < end) {
                int shared = Size(Var(block, ref at)), tail = Size(Var(block, ref at)), value = Size(Var(block, ref at));
                if (shared > previous.Length || tail > end - at || value > end - at - tail) throw new InvalidDataException("Invalid table entry");
                var key = new byte[shared + tail]; Buffer.BlockCopy(previous, 0, key, 0, shared);
                Buffer.BlockCopy(block, at, key, shared, tail); at += tail;
                byte[] data = Slice(block, ref at, value); previous = key;
                yield return new Entry { Key = key, Data = data };
            }
        }
        static IEnumerable<byte[]> Records(byte[] file) {
            var fragments = new MemoryStream(); bool assembling = false;
            int at = 0;
            for (; at + 7 <= file.Length;) {
                int remain = 32768 - at % 32768;
                if (remain < 7) { at += remain; continue; }
                int length = BitConverter.ToUInt16(file, at + 4), kind = file[at + 6];
                if (kind == 0 && length == 0) { at += remain; continue; }
                if (length > remain - 7) throw new InvalidDataException("Invalid log fragment");
                if (length > file.Length - at - 7) throw new InvalidDataException("Incomplete log tail");
                if (Mask(Crc(file, at + 7, length, kind)) != BitConverter.ToUInt32(file, at)) throw new InvalidDataException("Log checksum mismatch");
                int pos = at + 7; byte[] data = Slice(file, ref pos, length); at = pos;
                if (kind == 1) { if (assembling) throw new InvalidDataException("Interrupted fragmented record"); yield return data; }
                else if (kind == 2) {
                    if (assembling) throw new InvalidDataException("Interrupted fragmented record");
                    fragments.SetLength(0); fragments.Position = 0; fragments.Write(data, 0, data.Length); assembling = true;
                }
                else if (kind == 3 || kind == 4) {
                    if (!assembling) throw new InvalidDataException("Unpaired log fragment");
                    if (fragments.Length + data.Length > Limit) throw new InvalidDataException("Log record exceeds limit");
                    fragments.Write(data, 0, data.Length);
                    if (kind == 4) { assembling = false; yield return fragments.ToArray(); }
                } else throw new InvalidDataException("Unknown log fragment");
            }
            if (assembling) throw new InvalidDataException("Incomplete fragmented record");
            for (; at < file.Length; at++) if (file[at] != 0) throw new InvalidDataException("Incomplete log header");
        }
        static void Keep(Dictionary<string, Value> values, byte[] key, byte[] data, ulong sequence, int kind, Func<string, bool> include) {
            if (kind != 0 && kind != 1) throw new InvalidDataException("Unknown table value kind");
            string name = Encoding.UTF8.GetString(key);
            if (!include(name)) return;
            Value old;
            string text = kind == 1 ? Encoding.UTF8.GetString(data) : null;
            if (values.TryGetValue(name, out old) && sequence == old.Sequence && text != old.Text)
                throw new InvalidDataException("Conflicting profile sequence");
            if (!values.TryGetValue(name, out old) || sequence > old.Sequence)
                values[name] = new Value { Sequence = sequence, Text = text };
        }
        static Dictionary<string, Value> CurrentValues(string stateDir, Func<string, bool> include)
        {
            if (!File.Exists(Path.Combine(stateDir, "CURRENT"))) return new Dictionary<string, Value>(StringComparer.Ordinal);
            string current = Encoding.ASCII.GetString(Read(Path.Combine(stateDir, "CURRENT")));
            if (!current.EndsWith("\n", StringComparison.Ordinal)) throw new InvalidDataException("Incomplete current manifest pointer");
            string manifest = current.Trim();
            if (!System.Text.RegularExpressions.Regex.IsMatch(manifest, "^MANIFEST-[0-9]+$")) throw new InvalidDataException("Invalid manifest name");
            var files = new HashSet<ulong>(); ulong log = 0, previousLog = 0;
            bool hasLog = false, hasNextFile = false, hasSequence = false;
            foreach (byte[] record in Records(Read(Path.Combine(stateDir, manifest)))) {
                int at = 0;
                while (at < record.Length) {
                    ulong tag = Var(record, ref at);
                    if (tag == 1) Bytes(record, ref at);
                    else if (tag == 2) { log = Var(record, ref at); hasLog = true; }
                    else if (tag == 3) { Var(record, ref at); hasNextFile = true; }
                    else if (tag == 4) { Var(record, ref at); hasSequence = true; }
                    else if (tag == 5) { Var(record, ref at); Bytes(record, ref at); }
                    else if (tag == 6) { Var(record, ref at); files.Remove(Var(record, ref at)); }
                    else if (tag == 7) { Var(record, ref at); files.Add(Var(record, ref at)); Var(record, ref at); Bytes(record, ref at); Bytes(record, ref at); }
                    else if (tag == 9) previousLog = Var(record, ref at);
                    else throw new InvalidDataException("Unknown manifest field");
                }
            }
            if (!hasLog || !hasNextFile || !hasSequence) throw new InvalidDataException("Incomplete manifest metadata");
            var values = new Dictionary<string, Value>(StringComparer.Ordinal);
            foreach (ulong number in files) {
                string path = Path.Combine(stateDir, number.ToString("D6") + ".ldb");
                if (!File.Exists(path)) path = Path.Combine(stateDir, number.ToString("D6") + ".sst");
                byte[] file = Read(path);
                if (file.Length < 48 || BitConverter.ToUInt64(file, file.Length - 8) != 0xdb4775248b80fb57UL) throw new InvalidDataException("Invalid table footer");
                int at = file.Length - 48; Var(file, ref at); Var(file, ref at);
                ulong offset = Var(file, ref at), size = Var(file, ref at);
                foreach (Entry index in Entries(Block(file, offset, size))) {
                    at = 0; offset = Var(index.Data, ref at); size = Var(index.Data, ref at);
                    foreach (Entry row in Entries(Block(file, offset, size))) {
                        if (row.Key.Length < 8) throw new InvalidDataException("Invalid internal key");
                        ulong tag = BitConverter.ToUInt64(row.Key, row.Key.Length - 8); at = 0;
                        Keep(values, Slice(row.Key, ref at, row.Key.Length - 8), row.Data, tag >> 8, (int)(tag & 255), include);
                    }
                }
            }
            foreach (string path in Directory.GetFiles(stateDir, "*.log")) {
                ulong number;
                if (!ulong.TryParse(Path.GetFileNameWithoutExtension(path), out number) || (number < log && number != previousLog)) continue;
                foreach (byte[] batch in Records(Read(path))) {
                    if (batch.Length < 12) throw new InvalidDataException("Invalid write batch");
                    ulong sequence = BitConverter.ToUInt64(batch, 0); uint count = BitConverter.ToUInt32(batch, 8); int at = 12;
                    for (uint i = 0; i < count; i++) {
                        if (at >= batch.Length) throw new InvalidDataException("Truncated write batch");
                        int kind = batch[at++]; byte[] key = Bytes(batch, ref at);
                        byte[] data = kind == 1 ? Bytes(batch, ref at) : new byte[0];
                        if (kind != 0 && kind != 1) throw new InvalidDataException("Unknown write kind");
                        Keep(values, key, data, checked(sequence + i), kind, include);
                    }
                    if (at != batch.Length) throw new InvalidDataException("Write batch trailing bytes");
                }
            }
            return values;
        }
        public static string Find(string stateDir, string profilesRoot, string name)
        {
            var values = CurrentValues(stateDir, delegate(string key) {
                return key.StartsWith("persistent###profiles###", StringComparison.Ordinal) &&
                    (key.EndsWith("###name", StringComparison.Ordinal) || key.EndsWith("###gameId", StringComparison.Ordinal));
            });
            string found = null;
            foreach (var pair in values) {
                if (!pair.Key.EndsWith("###name", StringComparison.Ordinal) || pair.Value.Text == null) continue;
                // These two metadata values are JSON strings. Decode through the
                // framework serializer rather than treating an escaped name as raw text.
                if (JsonString(pair.Value.Text) != name) continue;
                string prefix = pair.Key.Substring(0, pair.Key.Length - 7); Value game;
                if (!values.TryGetValue(prefix + "###gameId", out game) || game.Text == null || JsonString(game.Text) != "skyrimse") continue;
                string id = prefix.Substring("persistent###profiles###".Length);
                if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[A-Za-z0-9_-]+$")) continue;
                string dir = Path.Combine(profilesRoot, id);
                if (found != null) throw new InvalidDataException("More than one Vortex profile has this name");
                found = dir;
            }
            return found != null && File.Exists(Path.Combine(found, "plugins.txt")) ? found : null;
        }
        const string Mods = "persistent###mods###skyrimse###";
        const string Revisions = "persistent###collections###revisions###";
        static string Text(Dictionary<string, Value> values, string key) {
            Value value;
            return values.TryGetValue(key, out value) ? value.Text : null;
        }
        static int Positive(string json) {
            int value;
            return json != null && System.Text.RegularExpressions.Regex.IsMatch(json.Trim(' ', '\t', '\r', '\n'), "\\A[1-9][0-9]{0,9}\\z") &&
                int.TryParse(json.Trim(' ', '\t', '\r', '\n'), out value) ? value : 0;
        }
        static string StringValue(string json) { return json == null ? null : JsonString(json); }
        static bool CollectionKey(string key) {
            bool mod = key.StartsWith(Mods, StringComparison.Ordinal);
            if (!mod && !key.StartsWith(Revisions, StringComparison.Ordinal)) return false;
            int start = mod ? Mods.Length : Revisions.Length;
            int end = key.IndexOf("###", start, StringComparison.Ordinal);
            if (end <= start || key.Substring(start, end - start).IndexOf('#') >= 0) return false;
            string field = key.Substring(end + 3);
            return mod ? field == "attributes###collectionSlug" || field == "attributes###revisionNumber" ||
                field == "attributes###newestFileId" || field == "attributes###newestVersion" :
                field == "info###collection###slug" || field == "info###revisionNumber";
        }
        // A revision Vortex stores either as a bare number or as a JSON string.
        static int Revision(string json) {
            int number = Positive(json);
            return number > 0 ? number : Positive(StringValue(json));
        }
        // One installed mod tied to a slug: Prefix is its attributes###, and
        // Revision is the cached revision's info### it links to when the mod
        // was authored here, or null when it was subscribed to.
        sealed class Tie { public string Mod, Prefix, Revision; }
        // The installed revision, the newest one and the mod ids all read
        // through this one tie, so the folder Check-CollectionRules opens is
        // the mod whose revision is reported (#1902).
        static List<Tie> Ties(Dictionary<string, Value> values, string slug) {
            var ties = new List<Tie>();
            foreach (var pair in values) {
                if (!pair.Key.StartsWith(Mods, StringComparison.Ordinal) ||
                    !pair.Key.EndsWith("###collectionSlug", StringComparison.Ordinal) || pair.Value.Text == null) continue;
                if (StringValue(pair.Value.Text) != slug) continue;
                string prefix = pair.Key.Substring(0, pair.Key.Length - "collectionSlug".Length);
                ties.Add(new Tie { Mod = ModId(prefix), Prefix = prefix });
            }
            if (ties.Count > 0) return ties;
            // Locally authored collections lack subscriber attributes. Only their
            // explicit cache link counts, never an ordinary mod or cached download.
            foreach (var pair in values) {
                if (!pair.Key.StartsWith(Mods + "vortex_collection_", StringComparison.Ordinal) ||
                    !pair.Key.EndsWith("###newestFileId", StringComparison.Ordinal) || pair.Value.Text == null) continue;
                string prefix = pair.Key.Substring(0, pair.Key.Length - "newestFileId".Length);
                if (Text(values, prefix + "collectionSlug") != null) continue;
                int id = Positive(pair.Value.Text);
                if (id <= 0) continue;
                string revision = Revisions + id.ToString(System.Globalization.CultureInfo.InvariantCulture) + "###info###";
                if (StringValue(Text(values, revision + "collection###slug")) != slug) continue;
                ties.Add(new Tie { Mod = ModId(prefix), Prefix = prefix, Revision = revision });
            }
            return ties;
        }
        static string ModId(string prefix) {
            return prefix.Substring(Mods.Length, prefix.Length - Mods.Length - "###attributes###".Length);
        }
        static int Installed(Dictionary<string, Value> values, string slug) {
            int best = 0;
            foreach (Tie tie in Ties(values, slug)) {
                if (tie.Revision == null) {
                    best = Math.Max(best, Positive(Text(values, tie.Prefix + "revisionNumber")));
                    continue;
                }
                string cachedNumber = Text(values, tie.Revision + "revisionNumber");
                int number = Positive(cachedNumber);
                if (number <= 0 && cachedNumber == null) number = Revision(Text(values, tie.Prefix + "newestVersion"));
                best = Math.Max(best, number);
            }
            return best;
        }
        public static int CollectionRevision(string stateDir, string slug)
        {
            if (string.IsNullOrEmpty(slug)) return 0;
            return Installed(CurrentValues(stateDir, CollectionKey), slug);
        }
        // The newest revision Vortex knows of for a slug: the newestVersion it
        // records against the tied mod, any cached revision of the slug, and
        // the installed revision as the floor. Read from current state, so
        // compaction cannot hide it and a superseded or deleted value does
        // not count (#1902). Another mod's newestVersion is its own version,
        // never this collection's revision.
        public static int CollectionNewest(string stateDir, string slug)
        {
            if (string.IsNullOrEmpty(slug)) return 0;
            var values = CurrentValues(stateDir, CollectionKey);
            int best = Installed(values, slug);
            foreach (Tie tie in Ties(values, slug))
                best = Math.Max(best, Revision(Text(values, tie.Prefix + "newestVersion")));
            foreach (var pair in values) {
                if (!pair.Key.StartsWith(Revisions, StringComparison.Ordinal) ||
                    !pair.Key.EndsWith("###info###collection###slug", StringComparison.Ordinal) || pair.Value.Text == null) continue;
                if (StringValue(pair.Value.Text) != slug) continue;
                string prefix = pair.Key.Substring(0, pair.Key.Length - "collection###slug".Length);
                best = Math.Max(best, Positive(Text(values, prefix + "revisionNumber")));
            }
            return best;
        }
        // The installed collection's mod ids, which name its staging folder
        // now that the folder is not named for the slug. Empty when no mod is
        // tied to it (#1902).
        public static string[] CollectionModIds(string stateDir, string slug)
        {
            var ids = new List<string>();
            if (string.IsNullOrEmpty(slug)) return ids.ToArray();
            foreach (Tie tie in Ties(CurrentValues(stateDir, CollectionKey), slug))
                if (!ids.Contains(tie.Mod)) ids.Add(tie.Mod);
            ids.Sort(StringComparer.Ordinal);
            return ids.ToArray();
        }
        static string JsonString(string json) {
            json = json.Trim(' ', '\t', '\r', '\n');
            if (json.Length > 4096 || !System.Text.RegularExpressions.Regex.IsMatch(json,
                "\\A\"(?:[^\"\\\\\\x00-\\x1f]|\\\\(?:[\"\\\\/bfnrt]|u[0-9a-fA-F]{4}))*\"\\z"))
                throw new InvalidDataException("Profile metadata is not one JSON string");
            // The pattern above has made sure it is one string token and every
            // escape in it is whole, so the escapes are read here by hand.
            // Not a JSON library: scripts\mods\LoadOrder.ps1 compiles this file
            // with Add-Type in Windows PowerShell 5.1 too, which has none.
            var text = new StringBuilder(json.Length);
            for (int i = 1; i < json.Length - 1; i++) {
                char c = json[i];
                if (c != '\\') { text.Append(c); continue; }
                char e = json[++i];
                switch (e) {
                    case 'b': text.Append('\b'); break;
                    case 'f': text.Append('\f'); break;
                    case 'n': text.Append('\n'); break;
                    case 'r': text.Append('\r'); break;
                    case 't': text.Append('\t'); break;
                    case 'u':
                        text.Append((char)Convert.ToInt32(json.Substring(i + 1, 4), 16));
                        i += 4;
                        break;
                    default: text.Append(e); break; // \" \\ \/
                }
            }
            return text.ToString();
        }
    }
}
