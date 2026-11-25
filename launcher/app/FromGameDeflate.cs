// Altered from zlib 1.3: deflate.c and trees.c, translated into C# by
// Thornswood and cut down to the one setting below (level 6, window bits 15,
// memory level 8, the default strategy). This is not the original software.
// zlib's notice follows unaltered, as its licence asks (THIRD-PARTY.md, #3668).
//
// deflate.c: Copyright (C) 1995-2023 Jean-loup Gailly and Mark Adler
// trees.c:   Copyright (C) 1995-2021 Jean-loup Gailly
//
// zlib.h, version 1.3, August 18th, 2023:
//
//   Copyright (C) 1995-2023 Jean-loup Gailly and Mark Adler
//
//   This software is provided 'as-is', without any express or implied
//   warranty.  In no event will the authors be held liable for any damages
//   arising from the use of this software.
//
//   Permission is granted to anyone to use this software for any purpose,
//   including commercial applications, and to alter it and redistribute it
//   freely, subject to the following restrictions:
//
//   1. The origin of this software must not be misrepresented; you must not
//      claim that you wrote the original software. If you use this software
//      in a product, an acknowledgment in the product documentation would be
//      appreciated but is not required.
//   2. Altered source versions must be plainly marked as such, and must not be
//      misrepresented as being the original software.
//   3. This notice may not be removed or altered from any source distribution.
//
//   Jean-loup Gailly        Mark Adler
//   jloup@gzip.org          madler@alumni.caltech.edu

using System;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// zlib's own compressor at level 6, written out in C# so that the start
    /// menu FromGame builds compresses to exactly the bytes Thornswood's menu
    /// has had since 16 September (#2827).
    ///
    /// WHY NOT DeflateStream. The menu is a compressed SWF whose zlib stream is
    /// what zlib 1.2 and 1.3 write at level 6 with the default window and
    /// memory (measured 19 Oct: Python's zlib at level 6, window 15, memory 8,
    /// default strategy gives the shipped file's 83,378 compressed bytes byte for
    /// byte, and no other setting does). .NET's DeflateStream is a different
    /// build of zlib on every Windows and .NET version, and a different build
    /// finds different matches, so the same menu would come out as other bytes
    /// on other machines. This is deflate.c and trees.c of zlib 1.3 for that one
    /// setting, nothing added: the hash chains, the lazy match, the block
    /// split at 16,383 symbols, and the choice between stored, fixed and
    /// dynamic trees. tests\test-2827-from-game.ps1 holds it to zlib's own
    /// output on data with long, short and no repeats.
    ///
    /// Inflating needs no such care, because every zlib reads every zlib
    /// stream the same; FromGame uses DeflateStream for that.
    /// </summary>
    public sealed class ZlibLevel6
    {
        // deflate.c's settings for level 6, window bits 15, memory level 8.
        const int WBits = 15, WSize = 1 << WBits, WMask = WSize - 1;
        const int HashBits = 15, HashSize = 1 << HashBits, HashMask = HashSize - 1;
        const int HashShift = (HashBits + MinMatch - 1) / MinMatch;
        const int LitBufSize = 1 << (8 + 6);
        const int SymEnd = (LitBufSize - 1) * 3;
        const int GoodMatch = 8, MaxLazy = 16, NiceMatch = 128, MaxChain = 128;
        const int MinMatch = 3, MaxMatch = 258;
        const int MinLookahead = MaxMatch + MinMatch + 1;
        const int MaxDist = WSize - MinLookahead;
        const int TooFar = 4096;
        const int WinInit = MaxMatch;
        const int WindowSize = 2 * WSize;

        // trees.c
        const int LengthCodes = 29, Literals = 256, LCodes = Literals + 1 + LengthCodes;
        const int DCodes = 30, BlCodes = 19, HeapSize = 2 * LCodes + 1, MaxBits = 15, MaxBlBits = 7;
        const int EndBlock = 256, Rep3To6 = 16, RepZ3To10 = 17, RepZ11To138 = 18;
        static readonly int[] ExtraLBits = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 };
        static readonly int[] ExtraDBits = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 };
        static readonly int[] ExtraBlBits = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7 };
        static readonly int[] BlOrder = { 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 };

        // tr_static_init's tables. A tree is two arrays, as zlib's ct_data is
        // two unions: fc (the frequency, later the code) and dl (the parent,
        // later the length). Which name is read matters, so both are kept.
        static readonly ushort[] StaticLFc = new ushort[LCodes + 2], StaticLDl = new ushort[LCodes + 2];
        static readonly ushort[] StaticDFc = new ushort[DCodes], StaticDDl = new ushort[DCodes];
        static readonly byte[] DistCode = new byte[512];
        static readonly byte[] LengthCode = new byte[MaxMatch - MinMatch + 1];
        static readonly int[] BaseLength = new int[LengthCodes];
        static readonly int[] BaseDist = new int[DCodes];

        static ZlibLevel6()
        {
            int length = 0, code;
            for (code = 0; code < LengthCodes - 1; code++)
            {
                BaseLength[code] = length;
                for (int n = 0; n < (1 << ExtraLBits[code]); n++) LengthCode[length++] = (byte)code;
            }
            LengthCode[length - 1] = (byte)code;
            int dist = 0;
            for (code = 0; code < 16; code++)
            {
                BaseDist[code] = dist;
                for (int n = 0; n < (1 << ExtraDBits[code]); n++) DistCode[dist++] = (byte)code;
            }
            dist >>= 7;
            for (; code < DCodes; code++)
            {
                BaseDist[code] = dist << 7;
                for (int n = 0; n < (1 << (ExtraDBits[code] - 7)); n++) DistCode[256 + dist++] = (byte)code;
            }
            var count = new ushort[MaxBits + 1];
            int i = 0;
            while (i <= 143) { StaticLDl[i++] = 8; count[8]++; }
            while (i <= 255) { StaticLDl[i++] = 9; count[9]++; }
            while (i <= 279) { StaticLDl[i++] = 7; count[7]++; }
            while (i <= 287) { StaticLDl[i++] = 8; count[8]++; }
            GenCodes(StaticLFc, StaticLDl, LCodes + 1, count);
            for (i = 0; i < DCodes; i++) { StaticDDl[i] = 5; StaticDFc[i] = (ushort)Reverse(i, 5); }
        }

        /// <summary>The zlib stream (header, deflate data, Adler-32) of <paramref name="data"/>, as zlib writes it at level 6.</summary>
        public static byte[] Compress(byte[] data)
        {
            return new ZlibLevel6(data).Run();
        }

        readonly byte[] input;
        int inPos;
        readonly MemoryStream output = new MemoryStream();
        uint adlerA = 1, adlerB;

        readonly byte[] window = new byte[WindowSize];
        readonly ushort[] prev = new ushort[WSize];
        readonly ushort[] head = new ushort[HashSize];
        int insH, strStart, blockStart, lookahead, insert, highWater;
        int matchLength, prevMatch, matchAvailable, matchStart, prevLength;

        readonly ushort[] dynLFc = new ushort[HeapSize], dynLDl = new ushort[HeapSize];
        readonly ushort[] dynDFc = new ushort[2 * DCodes + 1], dynDDl = new ushort[2 * DCodes + 1];
        readonly ushort[] blFc = new ushort[2 * BlCodes + 1], blDl = new ushort[2 * BlCodes + 1];
        int lMaxCode, dMaxCode;
        readonly ushort[] blCount = new ushort[MaxBits + 1];
        readonly int[] heap = new int[2 * LCodes + 1];
        int heapLen, heapMax;
        readonly byte[] depth = new byte[2 * LCodes + 1];
        readonly byte[] symBuf = new byte[LitBufSize * 3];
        int symNext;
        long optLen, staticLen;
        ulong biBuf;
        int biValid;

        ZlibLevel6(byte[] data)
        {
            input = data;
            matchLength = prevLength = MinMatch - 1;
            InitBlock();
        }

        byte[] Run()
        {
            // deflate()'s header for window 15 and level 6: 0x78 0x9C.
            int header = (8 + ((WBits - 8) << 4)) << 8;
            header |= 2 << 6;
            header += 31 - (header % 31);
            output.WriteByte((byte)(header >> 8));
            output.WriteByte((byte)header);
            DeflateSlow();
            uint adler = (adlerB << 16) | adlerA;
            output.WriteByte((byte)(adler >> 24));
            output.WriteByte((byte)(adler >> 16));
            output.WriteByte((byte)(adler >> 8));
            output.WriteByte((byte)adler);
            return output.ToArray();
        }

        // ------------------------------------------------------------ deflate.c

        int ReadBuf(int at, int size)
        {
            int len = Math.Min(input.Length - inPos, size);
            if (len == 0) return 0;
            Buffer.BlockCopy(input, inPos, window, at, len);
            for (int i = 0; i < len; i++)
            {
                adlerA = (adlerA + window[at + i]) % 65521;
                adlerB = (adlerB + adlerA) % 65521;
            }
            inPos += len;
            return len;
        }

        void SlideHash()
        {
            for (int n = 0; n < HashSize; n++) { int m = head[n]; head[n] = (ushort)(m >= WSize ? m - WSize : 0); }
            for (int n = 0; n < WSize; n++) { int m = prev[n]; prev[n] = (ushort)(m >= WSize ? m - WSize : 0); }
        }

        void FillWindow()
        {
            do
            {
                int more = WindowSize - lookahead - strStart;
                if (strStart >= WSize + MaxDist)
                {
                    Buffer.BlockCopy(window, WSize, window, 0, WSize - more);
                    matchStart -= WSize;
                    strStart -= WSize;
                    blockStart -= WSize;
                    if (insert > strStart) insert = strStart;
                    SlideHash();
                    more += WSize;
                }
                if (inPos == input.Length) break;
                int n = ReadBuf(strStart + lookahead, more);
                lookahead += n;
                if (lookahead + insert >= MinMatch)
                {
                    int str = strStart - insert;
                    insH = window[str];
                    insH = ((insH << HashShift) ^ window[str + 1]) & HashMask;
                    while (insert != 0)
                    {
                        insH = ((insH << HashShift) ^ window[str + MinMatch - 1]) & HashMask;
                        prev[str & WMask] = head[insH];
                        head[insH] = (ushort)str;
                        str++;
                        insert--;
                        if (lookahead + insert < MinMatch) break;
                    }
                }
            } while (lookahead < MinLookahead && inPos != input.Length);

            // zlib zeroes what longest_match may read past the data, so a stale
            // byte there can never pick a different match.
            if (highWater < WindowSize)
            {
                int curr = strStart + lookahead;
                if (highWater < curr)
                {
                    int init = Math.Min(WindowSize - curr, WinInit);
                    Array.Clear(window, curr, init);
                    highWater = curr + init;
                }
                else if (highWater < curr + WinInit)
                {
                    int init = Math.Min(curr + WinInit - highWater, WindowSize - highWater);
                    Array.Clear(window, highWater, init);
                    highWater += init;
                }
            }
        }

        int InsertString(int str)
        {
            insH = ((insH << HashShift) ^ window[str + MinMatch - 1]) & HashMask;
            int h = prev[str & WMask] = head[insH];
            head[insH] = (ushort)str;
            return h;
        }

        int LongestMatch(int curMatch)
        {
            int chainLength = MaxChain;
            int scan = strStart;
            int bestLen = prevLength;
            int nice = NiceMatch;
            int limit = strStart > MaxDist ? strStart - MaxDist : 0;
            int strend = strStart + MaxMatch;
            byte scanEnd1 = window[scan + bestLen - 1];
            byte scanEnd = window[scan + bestLen];
            if (prevLength >= GoodMatch) chainLength >>= 2;
            if (nice > lookahead) nice = lookahead;
            do
            {
                int match = curMatch;
                if (window[match + bestLen] != scanEnd || window[match + bestLen - 1] != scanEnd1 ||
                    window[match] != window[scan] || window[match + 1] != window[scan + 1]) continue;
                int s = scan + 2, m = match + 2;
                while (s < strend && window[s] == window[m]) { s++; m++; }
                int len = s - scan;
                if (len > bestLen)
                {
                    matchStart = curMatch;
                    bestLen = len;
                    if (len >= nice) break;
                    scanEnd1 = window[scan + bestLen - 1];
                    scanEnd = window[scan + bestLen];
                }
            } while ((curMatch = prev[curMatch & WMask]) > limit && --chainLength != 0);
            return bestLen <= lookahead ? bestLen : lookahead;
        }

        void FlushBlock(bool last)
        {
            FlushTreeBlock(blockStart >= 0 ? blockStart : -1, strStart - blockStart, last);
            blockStart = strStart;
        }

        void DeflateSlow()
        {
            for (;;)
            {
                if (lookahead < MinLookahead)
                {
                    FillWindow();
                    if (lookahead == 0) break;
                }
                int hashHead = 0;
                if (lookahead >= MinMatch) hashHead = InsertString(strStart);
                prevLength = matchLength;
                prevMatch = matchStart;
                matchLength = MinMatch - 1;
                if (hashHead != 0 && prevLength < MaxLazy && strStart - hashHead <= MaxDist)
                {
                    matchLength = LongestMatch(hashHead);
                    if (matchLength <= 5 && matchLength == MinMatch && strStart - matchStart > TooFar)
                        matchLength = MinMatch - 1;
                }
                if (prevLength >= MinMatch && matchLength <= prevLength)
                {
                    int maxInsert = strStart + lookahead - MinMatch;
                    bool flush = Tally(strStart - 1 - prevMatch, prevLength - MinMatch);
                    lookahead -= prevLength - 1;
                    prevLength -= 2;
                    do
                    {
                        if (++strStart <= maxInsert) InsertString(strStart);
                    } while (--prevLength != 0);
                    matchAvailable = 0;
                    matchLength = MinMatch - 1;
                    strStart++;
                    if (flush) FlushBlock(false);
                }
                else if (matchAvailable != 0)
                {
                    if (Tally(0, window[strStart - 1])) FlushBlock(false);
                    strStart++;
                    lookahead--;
                }
                else
                {
                    matchAvailable = 1;
                    strStart++;
                    lookahead--;
                }
            }
            if (matchAvailable != 0)
            {
                Tally(0, window[strStart - 1]);
                matchAvailable = 0;
            }
            insert = strStart < MinMatch - 1 ? strStart : MinMatch - 1;
            FlushBlock(true);
        }

        // ------------------------------------------------------------ trees.c

        static int DCode(int dist) { return dist < 256 ? DistCode[dist] : DistCode[256 + (dist >> 7)]; }

        static int Reverse(int code, int len)
        {
            int res = 0;
            do { res |= code & 1; code >>= 1; res <<= 1; } while (--len > 0);
            return res >> 1;
        }

        void InitBlock()
        {
            for (int n = 0; n < LCodes; n++) dynLFc[n] = 0;
            for (int n = 0; n < DCodes; n++) dynDFc[n] = 0;
            for (int n = 0; n < BlCodes; n++) blFc[n] = 0;
            dynLFc[EndBlock] = 1;
            optLen = staticLen = 0;
            symNext = 0;
        }

        bool Tally(int dist, int lc)
        {
            symBuf[symNext++] = (byte)dist;
            symBuf[symNext++] = (byte)(dist >> 8);
            symBuf[symNext++] = (byte)lc;
            if (dist == 0) dynLFc[lc]++;
            else
            {
                dist--;
                dynLFc[LengthCode[lc] + Literals + 1]++;
                dynDFc[DCode(dist)]++;
            }
            return symNext == SymEnd;
        }

        void SendBits(int value, int length)
        {
            biBuf |= (ulong)(uint)value << biValid;
            biValid += length;
            while (biValid >= 16)
            {
                output.WriteByte((byte)biBuf);
                output.WriteByte((byte)(biBuf >> 8));
                biBuf >>= 16;
                biValid -= 16;
            }
        }

        void BiWindup()
        {
            if (biValid > 8) { output.WriteByte((byte)biBuf); output.WriteByte((byte)(biBuf >> 8)); }
            else if (biValid > 0) output.WriteByte((byte)biBuf);
            biBuf = 0;
            biValid = 0;
        }

        static bool Smaller(ushort[] fc, int n, int m, byte[] depth)
        {
            return fc[n] < fc[m] || (fc[n] == fc[m] && depth[n] <= depth[m]);
        }

        void PqDownHeap(ushort[] fc, int k)
        {
            int v = heap[k];
            int j = k << 1;
            while (j <= heapLen)
            {
                if (j < heapLen && Smaller(fc, heap[j + 1], heap[j], depth)) j++;
                if (Smaller(fc, v, heap[j], depth)) break;
                heap[k] = heap[j];
                k = j;
                j <<= 1;
            }
            heap[k] = v;
        }

        void GenBitLen(ushort[] fc, ushort[] dl, int maxCode, ushort[] sDl, int[] extra, int extraBase, int maxLength)
        {
            int overflow = 0, h, bits, n, m;
            for (bits = 0; bits <= MaxBits; bits++) blCount[bits] = 0;
            dl[heap[heapMax]] = 0;
            for (h = heapMax + 1; h < HeapSize; h++)
            {
                n = heap[h];
                bits = dl[dl[n]] + 1;
                if (bits > maxLength) { bits = maxLength; overflow++; }
                dl[n] = (ushort)bits;
                if (n > maxCode) continue;
                blCount[bits]++;
                int xbits = 0;
                if (n >= extraBase) xbits = extra[n - extraBase];
                int f = fc[n];
                optLen += (long)f * (bits + xbits);
                if (sDl != null) staticLen += (long)f * (sDl[n] + xbits);
            }
            if (overflow == 0) return;
            do
            {
                bits = maxLength - 1;
                while (blCount[bits] == 0) bits--;
                blCount[bits]--;
                blCount[bits + 1] += 2;
                blCount[maxLength]--;
                overflow -= 2;
            } while (overflow > 0);
            for (bits = maxLength; bits != 0; bits--)
            {
                n = blCount[bits];
                while (n != 0)
                {
                    m = heap[--h];
                    if (m > maxCode) continue;
                    if (dl[m] != bits)
                    {
                        optLen += ((long)bits - dl[m]) * fc[m];
                        dl[m] = (ushort)bits;
                    }
                    n--;
                }
            }
        }

        static void GenCodes(ushort[] fc, ushort[] dl, int maxCode, ushort[] count)
        {
            var next = new ushort[MaxBits + 1];
            int code = 0;
            for (int bits = 1; bits <= MaxBits; bits++)
            {
                code = (code + count[bits - 1]) << 1;
                next[bits] = (ushort)code;
            }
            for (int n = 0; n <= maxCode; n++)
            {
                int len = dl[n];
                if (len == 0) continue;
                fc[n] = (ushort)Reverse(next[len]++, len);
            }
        }

        int BuildTree(ushort[] fc, ushort[] dl, ushort[] sDl, int[] extra, int extraBase, int elems, int maxLength)
        {
            int n, m, maxCode = -1, node;
            heapLen = 0;
            heapMax = HeapSize;
            for (n = 0; n < elems; n++)
            {
                if (fc[n] != 0) { heap[++heapLen] = maxCode = n; depth[n] = 0; }
                else dl[n] = 0;
            }
            while (heapLen < 2)
            {
                node = heap[++heapLen] = (maxCode < 2 ? ++maxCode : 0);
                fc[node] = 1;
                depth[node] = 0;
                optLen--;
                if (sDl != null) staticLen -= sDl[node];
            }
            for (n = heapLen / 2; n >= 1; n--) PqDownHeap(fc, n);
            node = elems;
            do
            {
                n = heap[1];
                heap[1] = heap[heapLen--];
                PqDownHeap(fc, 1);
                m = heap[1];
                heap[--heapMax] = n;
                heap[--heapMax] = m;
                fc[node] = (ushort)(fc[n] + fc[m]);
                depth[node] = (byte)((depth[n] >= depth[m] ? depth[n] : depth[m]) + 1);
                dl[n] = dl[m] = (ushort)node;
                heap[1] = node++;
                PqDownHeap(fc, 1);
            } while (heapLen >= 2);
            heap[--heapMax] = heap[1];
            GenBitLen(fc, dl, maxCode, sDl, extra, extraBase, maxLength);
            GenCodes(fc, dl, maxCode, blCount);
            return maxCode;
        }

        void ScanTree(ushort[] dl, int maxCode)
        {
            int prevlen = -1, curlen, nextlen = dl[0], count = 0, maxCount = 7, minCount = 4;
            if (nextlen == 0) { maxCount = 138; minCount = 3; }
            dl[maxCode + 1] = 0xffff;
            for (int n = 0; n <= maxCode; n++)
            {
                curlen = nextlen;
                nextlen = dl[n + 1];
                if (++count < maxCount && curlen == nextlen) continue;
                else if (count < minCount) blFc[curlen] += (ushort)count;
                else if (curlen != 0)
                {
                    if (curlen != prevlen) blFc[curlen]++;
                    blFc[Rep3To6]++;
                }
                else if (count <= 10) blFc[RepZ3To10]++;
                else blFc[RepZ11To138]++;
                count = 0;
                prevlen = curlen;
                if (nextlen == 0) { maxCount = 138; minCount = 3; }
                else if (curlen == nextlen) { maxCount = 6; minCount = 3; }
                else { maxCount = 7; minCount = 4; }
            }
        }

        void SendCode(int c, ushort[] fc, ushort[] dl) { SendBits(fc[c], dl[c]); }

        void SendTree(ushort[] dl, int maxCode)
        {
            int prevlen = -1, curlen, nextlen = dl[0], count = 0, maxCount = 7, minCount = 4;
            if (nextlen == 0) { maxCount = 138; minCount = 3; }
            for (int n = 0; n <= maxCode; n++)
            {
                curlen = nextlen;
                nextlen = dl[n + 1];
                if (++count < maxCount && curlen == nextlen) continue;
                else if (count < minCount)
                {
                    do { SendCode(curlen, blFc, blDl); } while (--count != 0);
                }
                else if (curlen != 0)
                {
                    if (curlen != prevlen) { SendCode(curlen, blFc, blDl); count--; }
                    SendCode(Rep3To6, blFc, blDl);
                    SendBits(count - 3, 2);
                }
                else if (count <= 10) { SendCode(RepZ3To10, blFc, blDl); SendBits(count - 3, 3); }
                else { SendCode(RepZ11To138, blFc, blDl); SendBits(count - 11, 7); }
                count = 0;
                prevlen = curlen;
                if (nextlen == 0) { maxCount = 138; minCount = 3; }
                else if (curlen == nextlen) { maxCount = 6; minCount = 3; }
                else { maxCount = 7; minCount = 4; }
            }
        }

        int BuildBlTree()
        {
            ScanTree(dynLDl, lMaxCode);
            ScanTree(dynDDl, dMaxCode);
            // zlib keeps the bit length tree's largest code in bl_desc and never
            // reads it again; the tree's lengths in blDl are what is used.
            BuildTree(blFc, blDl, null, ExtraBlBits, 0, BlCodes, MaxBlBits);
            int maxBlIndex;
            for (maxBlIndex = BlCodes - 1; maxBlIndex >= 3; maxBlIndex--)
                if (blDl[BlOrder[maxBlIndex]] != 0) break;
            optLen += 3 * ((long)maxBlIndex + 1) + 5 + 5 + 4;
            return maxBlIndex;
        }

        void SendAllTrees(int lcodes, int dcodes, int blcodes)
        {
            SendBits(lcodes - 257, 5);
            SendBits(dcodes - 1, 5);
            SendBits(blcodes - 4, 4);
            for (int rank = 0; rank < blcodes; rank++) SendBits(blDl[BlOrder[rank]], 3);
            SendTree(dynLDl, lcodes - 1);
            SendTree(dynDDl, dcodes - 1);
        }

        void CompressBlock(ushort[] lFc, ushort[] lDl, ushort[] dFc, ushort[] dDl)
        {
            int sx = 0;
            while (sx < symNext)
            {
                int dist = symBuf[sx++];
                dist += symBuf[sx++] << 8;
                int lc = symBuf[sx++];
                if (dist == 0) SendCode(lc, lFc, lDl);
                else
                {
                    int code = LengthCode[lc];
                    SendCode(code + Literals + 1, lFc, lDl);
                    int extra = ExtraLBits[code];
                    if (extra != 0) SendBits(lc - BaseLength[code], extra);
                    dist--;
                    code = DCode(dist);
                    SendCode(code, dFc, dDl);
                    extra = ExtraDBits[code];
                    if (extra != 0) SendBits(dist - BaseDist[code], extra);
                }
            }
            SendCode(EndBlock, lFc, lDl);
        }

        void FlushTreeBlock(int buf, int storedLen, bool last)
        {
            lMaxCode = BuildTree(dynLFc, dynLDl, StaticLDl, ExtraLBits, Literals + 1, LCodes, MaxBits);
            dMaxCode = BuildTree(dynDFc, dynDDl, StaticDDl, ExtraDBits, 0, DCodes, MaxBits);
            int maxBlIndex = BuildBlTree();
            long optLenB = (optLen + 3 + 7) >> 3;
            long staticLenB = (staticLen + 3 + 7) >> 3;
            if (staticLenB <= optLenB) optLenB = staticLenB;
            int lastBit = last ? 1 : 0;
            if (storedLen + 4 <= optLenB && buf != -1)
            {
                SendBits((0 << 1) + lastBit, 3);
                BiWindup();
                output.WriteByte((byte)storedLen);
                output.WriteByte((byte)(storedLen >> 8));
                output.WriteByte((byte)~storedLen);
                output.WriteByte((byte)(~storedLen >> 8));
                output.Write(window, buf, storedLen);
            }
            else if (staticLenB == optLenB)
            {
                SendBits((1 << 1) + lastBit, 3);
                CompressBlock(StaticLFc, StaticLDl, StaticDFc, StaticDDl);
            }
            else
            {
                SendBits((2 << 1) + lastBit, 3);
                SendAllTrees(lMaxCode + 1, dMaxCode + 1, maxBlIndex + 1);
                CompressBlock(dynLFc, dynLDl, dynDFc, dynDDl);
            }
            InitBlock();
            if (last) BiWindup();
        }
    }
}
