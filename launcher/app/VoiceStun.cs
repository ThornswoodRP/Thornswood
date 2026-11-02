using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// STUN messages (RFC 8489), the part of them ICE (RFC 8445) and a TURN
    /// relay (RFC 8656) use: reading one off the wire, checking its
    /// MESSAGE-INTEGRITY and FINGERPRINT, and building one with both.
    ///
    /// Voice used to get all of this from the browser's RTCPeerConnection.
    /// Without a browser it is ours (VoiceIce.cs), and this is its alphabet.
    /// No library: the one complete managed WebRTC stack for .NET, SIPSorcery,
    /// carries a licence condition Thornswood cannot meet (#4823), and STUN
    /// is a small, fixed format.
    /// </summary>
    sealed class StunMessage
    {
        public const uint Cookie = 0x2112A442;

        // Methods.
        public const int Binding = 0x001;
        public const int Allocate = 0x003;
        public const int Refresh = 0x004;
        public const int SendMethod = 0x006;
        public const int DataMethod = 0x007;
        public const int CreatePermission = 0x008;

        // Classes.
        public const int Request = 0;
        public const int Indication = 1;
        public const int Success = 2;
        public const int Error = 3;

        // Attributes.
        public const int AttrUsername = 0x0006;
        public const int AttrIntegrity = 0x0008;
        public const int AttrErrorCode = 0x0009;
        public const int AttrLifetime = 0x000D;
        public const int AttrXorPeer = 0x0012;
        public const int AttrData = 0x0013;
        public const int AttrRealm = 0x0014;
        public const int AttrNonce = 0x0015;
        public const int AttrXorRelayed = 0x0016;
        public const int AttrTransport = 0x0019;
        public const int AttrXorMapped = 0x0020;
        public const int AttrPriority = 0x0024;
        public const int AttrUseCandidate = 0x0025;
        public const int AttrSoftware = 0x8022;
        public const int AttrFingerprint = 0x8028;
        public const int AttrControlled = 0x8029;
        public const int AttrControlling = 0x802A;

        public int Method;
        public int Class;
        public byte[] Tid = new byte[12];
        public readonly List<KeyValuePair<int, byte[]>> Attrs = new List<KeyValuePair<int, byte[]>>();

        /// <summary>The bytes as they came, kept so integrity can be checked over them.</summary>
        public byte[] Raw;
        int integrityAt = -1;   // offset of MESSAGE-INTEGRITY's header in Raw

        public static StunMessage Make(int method, int cls)
        {
            var m = new StunMessage { Method = method, Class = cls };
            RandomNumberGenerator.Fill(m.Tid);
            return m;
        }

        public byte[] Get(int type)
        {
            foreach (var a in Attrs) if (a.Key == type) return a.Value;
            return null;
        }

        public bool Has(int type) { return Get(type) != null; }

        public void Add(int type, byte[] value) { Attrs.Add(new KeyValuePair<int, byte[]>(type, value ?? new byte[0])); }

        public void AddString(int type, string s) { Add(type, Encoding.UTF8.GetBytes(s)); }

        public void AddUInt(int type, uint v)
        {
            var b = new byte[4];
            BinaryPrimitives.WriteUInt32BigEndian(b, v);
            Add(type, b);
        }

        public void AddULong(int type, ulong v)
        {
            var b = new byte[8];
            BinaryPrimitives.WriteUInt64BigEndian(b, v);
            Add(type, b);
        }

        public string GetString(int type)
        {
            byte[] b = Get(type);
            return b == null ? null : Encoding.UTF8.GetString(b);
        }

        public bool SameTransaction(StunMessage other)
        {
            return other != null && Tid.AsSpan().SequenceEqual(other.Tid);
        }

        /// <summary>
        /// The error code, or 0. 401 asks for credentials, 438 for a fresh
        /// nonce (RFC 8489 9.2.4).
        /// </summary>
        public int ErrorCode()
        {
            byte[] b = Get(AttrErrorCode);
            if (b == null || b.Length < 4) return 0;
            return (b[2] & 0x7) * 100 + b[3];
        }

        // ----------------------------------------------------------- reading

        /// <summary>True when these bytes could be a STUN message at all (RFC 7983's first byte, and the cookie).</summary>
        public static bool Looks(ReadOnlySpan<byte> d)
        {
            return d.Length >= 20 && d[0] < 4 && BinaryPrimitives.ReadUInt32BigEndian(d.Slice(4)) == Cookie;
        }

        public static StunMessage Parse(ReadOnlySpan<byte> d)
        {
            if (!Looks(d)) return null;
            int type = BinaryPrimitives.ReadUInt16BigEndian(d);
            int len = BinaryPrimitives.ReadUInt16BigEndian(d.Slice(2));
            if ((len & 3) != 0 || 20 + len > d.Length) return null;
            var m = new StunMessage();
            m.Method = (type & 0x000F) | ((type & 0x00E0) >> 1) | ((type & 0x3E00) >> 2);
            m.Class = ((type & 0x0010) >> 4) | ((type & 0x0100) >> 7);
            d.Slice(8, 12).CopyTo(m.Tid);
            m.Raw = d.Slice(0, 20 + len).ToArray();
            int at = 20;
            while (at + 4 <= 20 + len)
            {
                int at_type = BinaryPrimitives.ReadUInt16BigEndian(d.Slice(at));
                int at_len = BinaryPrimitives.ReadUInt16BigEndian(d.Slice(at + 2));
                if (at + 4 + at_len > 20 + len) return null;
                if (at_type == AttrIntegrity) m.integrityAt = at;
                // Nothing after MESSAGE-INTEGRITY counts but FINGERPRINT.
                if (m.integrityAt >= 0 && at != m.integrityAt && at_type != AttrFingerprint) break;
                m.Add(at_type, d.Slice(at + 4, at_len).ToArray());
                at += 4 + ((at_len + 3) & ~3);
            }
            return m;
        }

        /// <summary>
        /// Whether MESSAGE-INTEGRITY is there and right for this key: the
        /// ICE password for a check, or the long term key for a relay.
        /// </summary>
        public bool IntegrityOk(byte[] key)
        {
            if (integrityAt < 0 || Raw == null) return false;
            byte[] want = Get(AttrIntegrity);
            if (want == null || want.Length != 20) return false;
            byte[] copy = new byte[integrityAt];
            Array.Copy(Raw, copy, integrityAt);
            // The length the HMAC is taken over runs to the end of
            // MESSAGE-INTEGRITY itself (RFC 8489 14.5).
            BinaryPrimitives.WriteUInt16BigEndian(copy.AsSpan(2), (ushort)(integrityAt - 20 + 24));
            byte[] got = HMACSHA1.HashData(key, copy);
            return CryptographicOperations.FixedTimeEquals(got, want);
        }

        // ----------------------------------------------------------- writing

        /// <summary>
        /// The message as bytes, with MESSAGE-INTEGRITY over it when a key is
        /// given and FINGERPRINT last when asked for.
        /// </summary>
        public byte[] Write(byte[] key, bool fingerprint)
        {
            int size = 20;
            foreach (var a in Attrs) size += 4 + ((a.Value.Length + 3) & ~3);
            int full = size + (key != null ? 24 : 0) + (fingerprint ? 8 : 0);
            byte[] b = new byte[full];
            int type = (Method & 0x000F) | ((Method & 0x0070) << 1) | ((Method & 0x0F80) << 2) |
                       ((Class & 1) << 4) | ((Class & 2) << 7);
            BinaryPrimitives.WriteUInt16BigEndian(b, (ushort)type);
            BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(4), Cookie);
            Tid.CopyTo(b, 8);
            int at = 20;
            foreach (var a in Attrs)
            {
                BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(at), (ushort)a.Key);
                BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(at + 2), (ushort)a.Value.Length);
                a.Value.CopyTo(b, at + 4);
                at += 4 + ((a.Value.Length + 3) & ~3);
            }
            if (key != null)
            {
                BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(2), (ushort)(at - 20 + 24));
                byte[] mac = HMACSHA1.HashData(key, b.AsSpan(0, at));
                BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(at), (ushort)AttrIntegrity);
                BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(at + 2), 20);
                mac.CopyTo(b, at + 4);
                at += 24;
            }
            if (fingerprint)
            {
                BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(2), (ushort)(at - 20 + 8));
                uint crc = Crc32(b.AsSpan(0, at)) ^ 0x5354554E;
                BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(at), (ushort)AttrFingerprint);
                BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(at + 2), 4);
                BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(at + 4), crc);
                at += 8;
            }
            BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(2), (ushort)(at - 20));
            return b;
        }

        // ------------------------------------------------------- addresses

        /// <summary>An XOR-*-ADDRESS attribute for this address (RFC 8489 14.2).</summary>
        public void AddXorAddress(int type, IPEndPoint ep)
        {
            byte[] ip = ep.Address.GetAddressBytes();
            byte[] v = new byte[4 + ip.Length];
            v[1] = (byte)(ip.Length == 4 ? 1 : 2);
            BinaryPrimitives.WriteUInt16BigEndian(v.AsSpan(2), (ushort)(ep.Port ^ (Cookie >> 16)));
            byte[] mask = XorMask();
            for (int i = 0; i < ip.Length; i++) v[4 + i] = (byte)(ip[i] ^ mask[i]);
            Add(type, v);
        }

        public IPEndPoint GetXorAddress(int type)
        {
            byte[] v = Get(type);
            if (v == null || v.Length < 8) return null;
            int n = v[1] == 1 ? 4 : v[1] == 2 ? 16 : 0;
            if (n == 0 || v.Length < 4 + n) return null;
            int port = BinaryPrimitives.ReadUInt16BigEndian(v.AsSpan(2)) ^ (int)(Cookie >> 16);
            byte[] mask = XorMask();
            byte[] ip = new byte[n];
            for (int i = 0; i < n; i++) ip[i] = (byte)(v[4 + i] ^ mask[i]);
            return new IPEndPoint(new IPAddress(ip), port);
        }

        byte[] XorMask()
        {
            byte[] mask = new byte[16];
            BinaryPrimitives.WriteUInt32BigEndian(mask, Cookie);
            Tid.CopyTo(mask, 4);
            return mask;
        }

        // ------------------------------------------------------------- CRC

        static readonly uint[] CrcTable = MakeCrcTable();

        static uint[] MakeCrcTable()
        {
            var t = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                uint c = n;
                for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                t[n] = c;
            }
            return t;
        }

        /// <summary>CRC-32 as ISO 3309 and FINGERPRINT define it.</summary>
        public static uint Crc32(ReadOnlySpan<byte> d)
        {
            uint c = 0xFFFFFFFFu;
            foreach (byte x in d) c = CrcTable[(c ^ x) & 0xFF] ^ (c >> 8);
            return c ^ 0xFFFFFFFFu;
        }

        /// <summary>A relay's long term key: MD5 of "username:realm:password" (RFC 8489 9.2.2).</summary>
        public static byte[] LongTermKey(string user, string realm, string pass)
        {
            return MD5.HashData(Encoding.UTF8.GetBytes(user + ":" + realm + ":" + pass));
        }

        public static bool IsV4(IPEndPoint ep) { return ep != null && ep.AddressFamily == AddressFamily.InterNetwork; }
    }
}
