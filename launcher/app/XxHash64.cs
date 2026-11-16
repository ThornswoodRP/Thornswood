// XxHash64.cs
//
// xxHash64 with seed 0, the hash a Wabbajack modlist names every file and
// archive by (#6244), written as the base64 of its eight little-endian bytes.
// The launcher checks every download and every installed file of the
// collection's modlist with it (ModlistInstall.cs), and
// scripts\release\WabbajackModlist.cs, which writes the modlist, is compiled
// with this file, so both sides use one copy. Written from the xxHash
// specification (Yann Collet, BSD 2-clause); held to the reference library's
// values by tests\test-2754-revision-layout.ps1 and
// tests\test-6244-modlist-install.ps1.

using System;
using System.Buffers.Binary;
using System.IO;

namespace Thornswood
{
    public static class XxHash64
    {
        const ulong P1 = 11400714785074694791UL;
        const ulong P2 = 14029467366897019727UL;
        const ulong P3 = 1609587929392839161UL;
        const ulong P4 = 9650029242287828579UL;
        const ulong P5 = 2870177450012600261UL;

        static ulong Rotl(ulong x, int r) { return (x << r) | (x >> (64 - r)); }
        static ulong Round(ulong acc, ulong input) { unchecked { acc += input * P2; acc = Rotl(acc, 31); return acc * P1; } }
        static ulong Merge(ulong acc, ulong val) { unchecked { acc ^= Round(0, val); return acc * P1 + P4; } }

        public static ulong OfFile(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, FileOptions.SequentialScan))
                return OfStream(fs);
        }

        public static ulong OfBytes(byte[] data)
        {
            using (var ms = new MemoryStream(data, false)) return OfStream(ms);
        }

        public static ulong OfStream(Stream s)
        {
            unchecked
            {
                ulong v1 = P1 + P2, v2 = P2, v3 = 0, v4 = 0UL - P1;
                long total = 0;
                var buf = new byte[(1 << 20) + 32];
                int have = 0;
                while (true)
                {
                    int n = s.Read(buf, have, buf.Length - have);
                    if (n <= 0) break;
                    total += n;
                    have += n;
                    int at = 0;
                    while (have - at >= 32)
                    {
                        v1 = Round(v1, BinaryPrimitives.ReadUInt64LittleEndian(buf.AsSpan(at)));
                        v2 = Round(v2, BinaryPrimitives.ReadUInt64LittleEndian(buf.AsSpan(at + 8)));
                        v3 = Round(v3, BinaryPrimitives.ReadUInt64LittleEndian(buf.AsSpan(at + 16)));
                        v4 = Round(v4, BinaryPrimitives.ReadUInt64LittleEndian(buf.AsSpan(at + 24)));
                        at += 32;
                    }
                    Buffer.BlockCopy(buf, at, buf, 0, have - at);
                    have -= at;
                }
                ulong h;
                if (total >= 32)
                {
                    h = Rotl(v1, 1) + Rotl(v2, 7) + Rotl(v3, 12) + Rotl(v4, 18);
                    h = Merge(h, v1); h = Merge(h, v2); h = Merge(h, v3); h = Merge(h, v4);
                }
                else h = P5;
                h += (ulong)total;
                int i = 0;
                for (; i + 8 <= have; i += 8)
                {
                    h ^= Round(0, BinaryPrimitives.ReadUInt64LittleEndian(buf.AsSpan(i)));
                    h = Rotl(h, 27) * P1 + P4;
                }
                if (i + 4 <= have)
                {
                    h ^= (ulong)BinaryPrimitives.ReadUInt32LittleEndian(buf.AsSpan(i)) * P1;
                    h = Rotl(h, 23) * P2 + P3;
                    i += 4;
                }
                for (; i < have; i++)
                {
                    h ^= buf[i] * P5;
                    h = Rotl(h, 11) * P1;
                }
                h ^= h >> 33; h *= P2;
                h ^= h >> 29; h *= P3;
                h ^= h >> 32;
                return h;
            }
        }

        // The hash as a modlist writes it.
        public static string Base64(ulong h)
        {
            var b = new byte[8];
            BinaryPrimitives.WriteUInt64LittleEndian(b, h);
            return Convert.ToBase64String(b);
        }

        // A hash as a modlist writes it, read back; false when it is not eight
        // bytes of base64.
        public static bool TryParse(string text, out ulong h)
        {
            h = 0;
            Span<byte> b = stackalloc byte[9];
            int n;
            if (string.IsNullOrEmpty(text) || !Convert.TryFromBase64String(text, b, out n) || n != 8) return false;
            h = BinaryPrimitives.ReadUInt64LittleEndian(b);
            return true;
        }
    }
}
