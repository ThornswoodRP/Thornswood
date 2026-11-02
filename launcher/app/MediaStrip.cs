using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// What a picture or recording says about where and when it was made
    /// (#3648). A phone or a camera writes the place (often the GPS position),
    /// the time and the camera into the file, and Gallery.Submit sent the
    /// file as it was on disk, so all of it reached the site and was served
    /// from /shot/ to anyone. Clean takes those blocks out before the bytes
    /// leave this machine. Nothing is decoded or encoded again: the file's
    /// blocks are walked and the ones that only describe it are left out, so
    /// every pixel and frame is the one chosen.
    ///
    /// The rules are the site's (stripMedia in site/lib/media.js, which cleans
    /// every upload the same way as it lands, for a browser and a launcher from
    /// before this); a change here is a change there.
    ///
    ///   JPEG  every APP1 (Exif, XMP), APP3 to APP13 (IPTC, Photoshop, makers'
    ///         blocks), APP15 and comment; APP2 unless it is the colour
    ///         profile; anything after the end of the picture, where a phone
    ///         hangs a second picture with an Exif of its own.
    ///   PNG   eXIf, tEXt, zTXt, iTXt, tIME and caBX, and anything after IEND.
    ///   WebP  EXIF and XMP, and the VP8X flags that name them.
    ///   GIF   comments, and application blocks other than looping and colour.
    ///   MP4   udta, meta and XMP uuid boxes become free space of the same
    ///         size, so no offset into the file moves, and the made and
    ///         changed times in mvhd, tkhd and mdhd are zeroed.
    ///   WebM  Tags become Void of the same size, DateUTC in Info is zeroed.
    ///
    /// Kept: the colour profile and the orientation. A turned camera picture
    /// gets a new Exif block saying only that, so it still shows the right way
    /// up, and SendCopies still turns its copies.
    /// </summary>
    public static class MediaStrip
    {
        /// <summary>
        /// The bytes to send: data with its describing blocks taken out (data
        /// itself when there was nothing to take), or null when the file's
        /// blocks cannot be walked, which the caller refuses rather than send
        /// it as it is. ext is the file's extension with its dot; a kind not
        /// listed above is given back as it is. data is never changed.
        /// gps says whether a block taken out held a position; failed is
        /// what stopped the walk, when something did.
        /// </summary>
        public static byte[] Clean(byte[] data, string ext, out bool gps, out List<string> removed, out Exception failed)
        {
            var said = new Said();
            gps = false;
            removed = said.Removed;
            failed = null;
            if (data == null) return null;
            byte[] made;
            try
            {
                switch ((ext ?? "").ToLowerInvariant())
                {
                    case ".jpg":
                    case ".jpeg": made = Jpeg(data, said); break;
                    case ".png": made = Png(data, said); break;
                    case ".webp": made = Webp(data, said); break;
                    case ".gif": made = Gif(data, said); break;
                    case ".mp4": made = Mp4((byte[])data.Clone(), said); break;
                    case ".webm": made = Webm((byte[])data.Clone(), said); break;
                    default: return data;
                }
            }
            catch (Exception ex) when (ex is IndexOutOfRangeException || ex is ArgumentException || ex is OverflowException)
            {
                // A block that says it runs where no block can: the file cannot
                // be walked, which is the null the caller refuses, with what
                // went wrong for its log.
                failed = ex;
                made = null;
            }
            gps = said.Gps;
            if (made == null) return null;
            return said.Changed ? made : data;
        }

        public static byte[] Clean(byte[] data, string ext, out Exception failed)
        {
            bool gps;
            List<string> removed;
            return Clean(data, ext, out gps, out removed, out failed);
        }

        sealed class Said
        {
            public bool Changed;
            public bool Gps;
            public readonly List<string> Removed = new List<string>();
        }

        static readonly Encoding Latin1 = Encoding.GetEncoding(28591);
        static string Text(byte[] b, int from, int to)
        {
            from = Math.Max(0, Math.Min(from, b.Length));
            to = Math.Max(from, Math.Min(to, b.Length));
            return Latin1.GetString(b, from, to - from);
        }
        static byte[] Part(byte[] b, int from, int to)
        {
            from = Math.Max(0, Math.Min(from, b.Length));
            to = Math.Max(from, Math.Min(to, b.Length));
            var p = new byte[to - from];
            Buffer.BlockCopy(b, from, p, 0, p.Length);
            return p;
        }
        static byte[] Join(List<byte[]> parts)
        {
            int n = 0;
            foreach (var p in parts) n += p.Length;
            var all = new byte[n];
            int at = 0;
            foreach (var p in parts) { Buffer.BlockCopy(p, 0, all, at, p.Length); at += p.Length; }
            return all;
        }
        static bool Same(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }
        static int U16BE(byte[] b, int i) { return (b[i] << 8) | b[i + 1]; }
        static long U32BE(byte[] b, int i) { return ((long)b[i] << 24) | ((long)b[i + 1] << 16) | ((long)b[i + 2] << 8) | b[i + 3]; }
        static long U32LE(byte[] b, int i) { return ((long)b[i + 3] << 24) | ((long)b[i + 2] << 16) | ((long)b[i + 1] << 8) | b[i]; }
        static void PutU16BE(byte[] b, int i, int v) { b[i] = (byte)(v >> 8); b[i + 1] = (byte)v; }
        static void PutU32BE(byte[] b, int i, long v) { b[i] = (byte)(v >> 24); b[i + 1] = (byte)(v >> 16); b[i + 2] = (byte)(v >> 8); b[i + 3] = (byte)v; }
        static void PutU32LE(byte[] b, int i, long v) { b[i] = (byte)v; b[i + 1] = (byte)(v >> 8); b[i + 2] = (byte)(v >> 16); b[i + 3] = (byte)(v >> 24); }
        static void Zero(byte[] b, int from, int to) { for (int i = from; i < to && i < b.Length; i++) b[i] = 0; }
        static bool AnyNonZero(byte[] b, int from, int to) { for (int i = from; i < to && i < b.Length; i++) if (b[i] != 0) return true; return false; }

        static bool KeepTurn(int turn) { return turn >= 2 && turn <= 8; }
        // XMP and text blocks are only looked at to count positions, never
        // kept. The copyright sign then xyz is the box a phone writes its
        // position into in a recording, loci the 3GPP one.
        static readonly Regex Where = new Regex("GPS|ISO6709|©xyz|loci|location", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        static bool SaysWhere(byte[] b, int from, int to) { return Where.IsMatch(Text(b, from, to)); }

        // Orientation (0x0112), and whether there is a GPS block (0x8825), in
        // the first IFD of the Exif TIFF at start to end. turn 0 when it does
        // not say.
        static void ExifTags(byte[] b, int start, int end, out int turn, out bool gps)
        {
            turn = 0;
            gps = false;
            if (start < 0 || start + 8 > end || end > b.Length) return;
            string order = Text(b, start, start + 2);
            if (order != "II" && order != "MM") return;
            bool le = order == "II";
            Func<int, int> u16 = at => le ? (b[at] | (b[at + 1] << 8)) : U16BE(b, at);
            long ifd = start + (le ? U32LE(b, start + 4) : U32BE(b, start + 4));
            if (ifd + 2 > end) return;
            int count = u16((int)ifd);
            for (int k = 0; k < count; k++)
            {
                long at = ifd + 2 + k * 12L;
                if (at + 12 > end) break;
                int tag = u16((int)at);
                if (tag == 0x0112) turn = u16((int)at + 8);
                if (tag == 0x8825) gps = true;
            }
        }
        // The Exif TIFF kept for a turned picture: one tag, its orientation.
        static byte[] ExifOnlyTurn(int turn)
        {
            var t = new byte[26];
            t[0] = (byte)'M'; t[1] = (byte)'M'; PutU16BE(t, 2, 42); PutU32BE(t, 4, 8);
            PutU16BE(t, 8, 1);
            PutU16BE(t, 10, 0x0112); PutU16BE(t, 12, 3); PutU32BE(t, 14, 1); PutU16BE(t, 18, turn);
            return t;
        }
        static bool Starts(byte[] b, int at, string text)
        {
            if (at < 0 || at + text.Length > b.Length) return false;
            for (int k = 0; k < text.Length; k++) if (b[at + k] != (byte)text[k]) return false;
            return true;
        }

        static byte[] Jpeg(byte[] b, Said said)
        {
            if (b.Length < 2 || b[0] != 0xff || b[1] != 0xd8) return null;
            var parts = new List<byte[]> { Part(b, 0, 2) };
            int i = 2, turn = 0, exifAt = -1;
            while (i < b.Length)
            {
                if (b[i] != 0xff) return null;
                if (i + 1 >= b.Length) { parts.Add(Part(b, i, b.Length)); break; }
                int m = b[i + 1];
                if (m == 0xff) { i++; continue; }
                if (m == 0xd9)
                {
                    parts.Add(Part(b, i, i + 2));
                    if (i + 2 < b.Length) said.Removed.Add("data after the picture");
                    break;
                }
                if (m == 0x01 || m == 0xd8 || (m >= 0xd0 && m <= 0xd7)) { parts.Add(Part(b, i, i + 2)); i += 2; continue; }
                if (i + 4 > b.Length) { parts.Add(Part(b, i, b.Length)); break; }
                int end = i + 2 + U16BE(b, i + 2);
                int stop = Math.Min(end, b.Length);
                string drop = "";
                if (m == 0xe1 && Starts(b, i + 4, "Exif\0\0"))
                {
                    int t; bool g;
                    ExifTags(b, i + 10, stop, out t, out g);
                    if (g) said.Gps = true;
                    if (turn == 0) turn = t;
                    if (exifAt < 0) exifAt = parts.Count;
                    drop = "Exif";
                }
                else if (m == 0xe1)
                {
                    if (SaysWhere(b, i + 4, stop)) said.Gps = true;
                    drop = "XMP";
                }
                else if (m == 0xe2 && !Starts(b, i + 4, "ICC_PROFILE\0")) drop = "APP2";
                else if ((m >= 0xe3 && m <= 0xed) || m == 0xef) drop = "APP" + (m - 0xe0);
                else if (m == 0xfe) drop = "comment";
                if (drop.Length > 0) said.Removed.Add(drop); else parts.Add(Part(b, i, stop));
                i = end;
                if (m == 0xda && end <= b.Length)
                {
                    // The scan: entropy-coded bytes up to the next marker that
                    // is not a stuffed zero, a restart or a fill byte.
                    int j = end;
                    while (j < b.Length)
                    {
                        if (b[j] == 0xff && j + 1 < b.Length)
                        {
                            int n = b[j + 1];
                            if (n != 0x00 && n != 0xff && !(n >= 0xd0 && n <= 0xd7)) break;
                        }
                        j++;
                    }
                    parts.Add(Part(b, end, j));
                    i = j;
                }
            }
            if (KeepTurn(turn))
            {
                byte[] tiff = ExifOnlyTurn(turn);
                var head = new byte[10];
                head[0] = 0xff; head[1] = 0xe1; PutU16BE(head, 2, 2 + 6 + tiff.Length);
                Latin1.GetBytes("Exif\0\0", 0, 6, head, 4);
                parts.Insert(exifAt, tiff);
                parts.Insert(exifAt, head);
            }
            byte[] all = Join(parts);
            said.Changed = !Same(all, b);
            return all;
        }

        static uint Crc32(byte[] b, int from, int to)
        {
            uint c = 0xffffffff;
            for (int k = from; k < to; k++)
            {
                c ^= b[k];
                for (int j = 0; j < 8; j++) c = (c & 1) != 0 ? (c >> 1) ^ 0xedb88320 : c >> 1;
            }
            return ~c;
        }

        static byte[] Png(byte[] b, Said said)
        {
            if (b.Length < 8) return null;
            var parts = new List<byte[]> { Part(b, 0, 8) };
            long i = 8;
            int turn = 0, exifAt = -1;
            while (i < b.Length)
            {
                int at = (int)i;
                if (at + 8 > b.Length) { parts.Add(Part(b, at, b.Length)); break; }
                long len = U32BE(b, at);
                if (len > 0x7fffffff) return null;
                string type = Text(b, at + 4, at + 8);
                long end = at + 12 + len;
                int stop = (int)Math.Min(end, b.Length);
                if (type == "eXIf")
                {
                    int t; bool g;
                    ExifTags(b, at + 8, (int)Math.Min(at + 8 + len, b.Length), out t, out g);
                    if (g) said.Gps = true;
                    if (turn == 0) turn = t;
                    if (exifAt < 0) exifAt = parts.Count;
                    said.Removed.Add("eXIf");
                }
                else if (type == "tEXt" || type == "zTXt" || type == "iTXt" || type == "tIME" || type == "caBX")
                {
                    if (SaysWhere(b, at, stop)) said.Gps = true;
                    said.Removed.Add(type);
                }
                else parts.Add(Part(b, at, stop));
                i = end;
                if (type == "IEND")
                {
                    if (i < b.Length) said.Removed.Add("data after the picture");
                    break;
                }
            }
            if (KeepTurn(turn))
            {
                byte[] tiff = ExifOnlyTurn(turn);
                var chunk = new byte[12 + tiff.Length];
                PutU32BE(chunk, 0, tiff.Length);
                Latin1.GetBytes("eXIf", 0, 4, chunk, 4);
                Buffer.BlockCopy(tiff, 0, chunk, 8, tiff.Length);
                PutU32BE(chunk, 8 + tiff.Length, Crc32(chunk, 4, 8 + tiff.Length));
                parts.Insert(exifAt, chunk);
            }
            byte[] all = Join(parts);
            said.Changed = !Same(all, b);
            return all;
        }

        static byte[] Webp(byte[] b, Said said)
        {
            if (b.Length < 12) return null;
            var parts = new List<byte[]> { Part(b, 0, 12) };
            long i = 12;
            int turn = 0, exifAt = -1, vp8x = -1;
            while (i < b.Length)
            {
                int at = (int)i;
                if (at + 8 > b.Length) { parts.Add(Part(b, at, b.Length)); break; }
                string tag = Text(b, at, at + 4);
                long len = U32LE(b, at + 4);
                long end = at + 8 + len + (len & 1);
                int stop = (int)Math.Min(end, b.Length);
                if (tag == "EXIF")
                {
                    int data = at + 8, dataEnd = (int)Math.Min(at + 8 + len, b.Length);
                    int t; bool g;
                    ExifTags(b, Starts(b, data, "Exif\0\0") ? data + 6 : data, dataEnd, out t, out g);
                    if (g) said.Gps = true;
                    if (turn == 0) turn = t;
                    if (exifAt < 0) exifAt = parts.Count;
                    said.Removed.Add("EXIF");
                }
                else if (tag == "XMP ")
                {
                    if (SaysWhere(b, at, stop)) said.Gps = true;
                    said.Removed.Add("XMP");
                }
                else
                {
                    if (tag == "VP8X" && vp8x < 0 && stop - at >= 9) vp8x = parts.Count;
                    parts.Add(Part(b, at, stop));
                }
                i = end;
            }
            if (said.Removed.Count == 0) return b;
            if (vp8x >= 0)
            {
                parts[vp8x][8] = (byte)(parts[vp8x][8] & ~0x0c);
                if (KeepTurn(turn))
                {
                    byte[] tiff = ExifOnlyTurn(turn);
                    var chunk = new byte[8 + tiff.Length];
                    Latin1.GetBytes("EXIF", 0, 4, chunk, 0);
                    PutU32LE(chunk, 4, tiff.Length);
                    Buffer.BlockCopy(tiff, 0, chunk, 8, tiff.Length);
                    parts[vp8x][8] |= 0x08;
                    parts.Insert(exifAt, chunk);
                }
            }
            byte[] all = Join(parts);
            PutU32LE(all, 4, all.Length - 8);
            said.Changed = !Same(all, b);
            return all;
        }

        static byte[] Gif(byte[] b, Said said)
        {
            if (b.Length < 13) return null;
            // Sub-blocks from j: the end, past the empty one that closes them.
            Func<long, long> blocks = j =>
            {
                while (j < b.Length) { int n = b[j]; j += 1 + n; if (n == 0) break; }
                return j;
            };
            long i = 13;
            if ((b[10] & 0x80) != 0) i += 3 * (1 << ((b[10] & 7) + 1));
            var parts = new List<byte[]> { Part(b, 0, (int)Math.Min(i, b.Length)) };
            while (i < b.Length)
            {
                int at = (int)i;
                int kind = b[at];
                if (kind == 0x3b)
                {
                    parts.Add(Part(b, at, at + 1));
                    if (at + 1 < b.Length) said.Removed.Add("data after the picture");
                    break;
                }
                if (kind == 0x21)
                {
                    int label = at + 1 < b.Length ? b[at + 1] : -1;
                    long end = blocks(at + 2);
                    int stop = (int)Math.Min(end, b.Length);
                    string drop = "";
                    if (label == 0xfe) drop = "comment";
                    else if (label == 0xff)
                    {
                        string app = Text(b, at + 3, at + 14);
                        if (app != "NETSCAPE2.0" && app != "ANIMEXTS1.0" && app != "ICCRGBG1012") drop = app.Trim().Length > 0 ? app.Trim() : "application block";
                    }
                    if (drop.Length > 0)
                    {
                        if (SaysWhere(b, at, stop)) said.Gps = true;
                        said.Removed.Add(drop);
                    }
                    else parts.Add(Part(b, at, stop));
                    i = end;
                    continue;
                }
                if (kind == 0x2c)
                {
                    long j = at + 10;
                    if (at + 9 < b.Length && (b[at + 9] & 0x80) != 0) j += 3 * (1 << ((b[at + 9] & 7) + 1));
                    long end = blocks(j + 1);
                    parts.Add(Part(b, at, (int)Math.Min(end, b.Length)));
                    i = end;
                    continue;
                }
                return null;
            }
            byte[] all = Join(parts);
            said.Changed = !Same(all, b);
            return all;
        }

        const string XmpUuid = "be7acfcb97a942e89c71999491e3afac";
        // b is the caller's own copy, changed in place.
        static byte[] Mp4(byte[] b, Said said)
        {
            return Mp4Walk(b, 0, b.Length, "", said) ? b : null;
        }
        // Box by box from from to to. False when a size cannot be a box's.
        static bool Mp4Walk(byte[] b, long from, long to, string inside, Said said)
        {
            long i = from;
            while (i + 8 <= to)
            {
                int at = (int)i;
                long size = U32BE(b, at);
                int head = 8;
                string type = Text(b, at + 4, at + 8);
                if (size == 1)
                {
                    if (i + 16 > to) return true;
                    size = (U32BE(b, at + 8) << 32) | U32BE(b, at + 12);
                    head = 16;
                }
                else if (size == 0) size = to - i;
                if (size < head) return false;
                int end = (int)Math.Min(i + size, to);
                bool xmp = type == "uuid" && end - at >= head + 16 && Hex(b, at + head, 16) == XmpUuid;
                if (type == "udta" || type == "meta" || xmp)
                {
                    if (SaysWhere(b, at + head, end)) said.Gps = true;
                    said.Removed.Add(type);
                    Latin1.GetBytes("free", 0, 4, b, at + 4);
                    Zero(b, at + head, end);
                    said.Changed = true;
                }
                else if ((inside == "moov" && type == "mvhd") || (inside == "trak" && type == "tkhd") || (inside == "mdia" && type == "mdhd"))
                {
                    // The made and changed times: four bytes each in version
                    // 0, eight in version 1, after the version and flags.
                    if (at + head < end)
                    {
                        int wide = b[at + head] == 1 ? 8 : 4;
                        int t0 = at + head + 4, t1 = t0 + 2 * wide;
                        if (t1 <= end && AnyNonZero(b, t0, t1))
                        {
                            Zero(b, t0, t1);
                            said.Changed = true;
                            if (!said.Removed.Contains("times")) said.Removed.Add("times");
                        }
                    }
                }
                else if (type == "moov" || type == "trak" || type == "mdia")
                {
                    if (!Mp4Walk(b, at + head, end, type, said)) return false;
                }
                i += size;
            }
            return true;
        }
        static string Hex(byte[] b, int from, int n)
        {
            var sb = new StringBuilder(n * 2);
            for (int k = from; k < from + n && k < b.Length; k++) sb.Append(b[k].ToString("x2"));
            return sb.ToString();
        }

        const long Segment = 0x18538067, Tags = 0x1254c367, Info = 0x1549a966, DateUtc = 0x4461, Cluster = 0x1f43b675;
        static readonly long[] Top = { 0x114d9b74, Info, Cluster, 0x1654ae6b, 0x1c53bb6b, 0x1941a469, 0x1043a770, Tags, Segment, 0x1a45dfa3 };

        // An element's id and size at i. False when the bytes cannot be one;
        // short when the file ends inside its head. size -1 is unknown.
        static bool Head(byte[] b, long i, out bool shortHead, out long id, out long data, out long size)
        {
            shortHead = false; id = 0; data = 0; size = 0;
            if (i >= b.Length) { shortHead = true; return true; }
            int f = b[i];
            int iw = (f & 0x80) != 0 ? 1 : (f & 0x40) != 0 ? 2 : (f & 0x20) != 0 ? 3 : (f & 0x10) != 0 ? 4 : 0;
            if (iw == 0) return false;
            if (i + iw >= b.Length) { shortHead = true; return true; }
            int s = b[i + iw];
            int sw = 1;
            while (sw <= 8 && (s & (0x80 >> (sw - 1))) == 0) sw++;
            if (sw > 8) return false;
            if (i + iw + sw > b.Length) { shortHead = true; return true; }
            for (int k = 0; k < iw; k++) id = (id << 8) | b[i + k];
            long v = s & (0xff >> sw);
            bool all = v == (0xff >> sw);
            for (int k = 1; k < sw; k++) { v = v * 256 + b[i + iw + k]; if (b[i + iw + k] != 0xff) all = false; }
            data = i + iw + sw;
            size = all ? -1 : v;
            return true;
        }
        // The element at at to end made into a Void of the same length.
        static void VoidOut(byte[] b, long at, long end)
        {
            long total = end - at;
            int w = (int)Math.Min(8, total - 1);
            long v = total - 1 - w;
            Zero(b, (int)at, (int)end);
            b[at] = 0xec;
            for (int k = w - 1; k >= 1; k--) { b[at + 1 + k] = (byte)(v % 256); v /= 256; }
            b[at + 1] = (byte)((0x80 >> (w - 1)) | (int)v);
        }
        // b is the caller's own copy, changed in place.
        static byte[] Webm(byte[] b, Said said)
        {
            long i = 0;
            while (i < b.Length)
            {
                bool sh; long id, data, size;
                if (!Head(b, i, out sh, out id, out data, out size)) return null;
                if (sh) break;
                long end = size < 0 ? b.Length : Math.Min(data + size, b.Length);
                if (id != Segment) { i = end; continue; }
                long j = data;
                while (j < end)
                {
                    bool esh; long eid, edata, esize;
                    if (!Head(b, j, out esh, out eid, out edata, out esize)) return null;
                    if (esh) break;
                    if (esize < 0)
                    {
                        // A cluster a recorder wrote with no size: it ends where
                        // an element that only sits at the top of a segment
                        // starts.
                        long k = edata;
                        for (;;)
                        {
                            bool csh; long cid, cdata, csize;
                            if (!Head(b, k, out csh, out cid, out cdata, out csize)) return null;
                            if (csh || Array.IndexOf(Top, cid) >= 0) break;
                            if (csize < 0) return null;
                            k = Math.Min(cdata + csize, end);
                            if (k >= end) break;
                        }
                        j = k;
                        continue;
                    }
                    long stop = Math.Min(edata + esize, end);
                    if (eid == Tags)
                    {
                        if (SaysWhere(b, (int)edata, (int)stop)) said.Gps = true;
                        said.Removed.Add("Tags");
                        VoidOut(b, j, stop);
                        said.Changed = true;
                    }
                    else if (eid == Info)
                    {
                        long k = edata;
                        while (k < stop)
                        {
                            bool csh; long cid, cdata, csize;
                            if (!Head(b, k, out csh, out cid, out cdata, out csize) || csh || csize < 0) break;
                            long cend = Math.Min(cdata + csize, stop);
                            if (cid == DateUtc && AnyNonZero(b, (int)cdata, (int)cend))
                            {
                                Zero(b, (int)cdata, (int)cend);
                                said.Changed = true;
                                said.Removed.Add("DateUTC");
                            }
                            k = cend;
                        }
                    }
                    j = stop;
                }
                i = end;
            }
            return b;
        }
    }
}
