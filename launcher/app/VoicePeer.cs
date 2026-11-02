using System;
using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Concentus;
using Org.BouncyCastle.Crypto;
using Org.BouncyCastle.Tls;
using SharpSRTP.DTLS;
using SharpSRTP.DTLSSRTP;
using SharpSRTP.SRTP;

namespace Thornswood
{
    /// <summary>
    /// This launcher's DTLS certificate, made once a run and used for every
    /// connection, as a browser does. Its SHA-256 fingerprint goes in every
    /// offer and answer, and the other side's DTLS handshake is refused
    /// unless the certificate it shows has the fingerprint its own
    /// description named: the voice service passes descriptions on, so this
    /// is what stops anybody between the two from reading the audio.
    /// </summary>
    static class VoiceCert
    {
        static readonly object gate = new object();
        static Certificate cert;
        static AsymmetricKeyParameter key;
        static string fingerprint;

        public static void Get(out Certificate c, out AsymmetricKeyParameter k, out string fp)
        {
            lock (gate)
            {
                if (cert == null)
                {
                    // ECDSA P-256, what browsers use for WebRTC.
                    var made = DtlsCertificateUtils.GenerateCertificate("WebRTC", DateTime.UtcNow.AddDays(-1), DateTime.UtcNow.AddDays(30), false);
                    cert = made.Certificate;
                    key = made.PrivateKey;
                    fingerprint = Fingerprint(cert);
                }
                c = cert; k = key; fp = fingerprint;
            }
        }

        /// <summary>SHA-256 of the first certificate, as "AB:CD:..." the way SDP writes it.</summary>
        public static string Fingerprint(Certificate c)
        {
            if (c == null || c.IsEmpty) return "";
            byte[] h = SHA256.HashData(c.GetCertificateAt(0).GetEncoded());
            var b = new StringBuilder(h.Length * 3);
            for (int i = 0; i < h.Length; i++)
            {
                if (i > 0) b.Append(':');
                b.Append(h[i].ToString("X2", CultureInfo.InvariantCulture));
            }
            return b.ToString();
        }
    }

    /// <summary>
    /// One connection to one other person: what an RTCPeerConnection was in
    /// the voice page. ICE finds the path (VoiceIce.cs), DTLS-SRTP secures
    /// it (RFC 5764, through SharpSRTP on BouncyCastle), and Opus in RTP
    /// carries the voice, one way per side.
    ///
    /// The description each side sends is ordinary SDP with only what the
    /// other side reads: the ICE username and password, the certificate's
    /// fingerprint, the DTLS role, and Opus at 48 kHz. Both ends are
    /// launchers, so nothing else is negotiated: the side that offers is the
    /// DTLS server and ICE's controlling side, the side that answers is the
    /// DTLS client.
    /// </summary>
    sealed class VoicePeer : IDisposable
    {
        public const int PayloadType = 111;

        public readonly int Id;
        public readonly bool Offerer;
        readonly VoiceIce ice;
        readonly VoiceMix mix;
        readonly Certificate cert;
        readonly AsymmetricKeyParameter key;
        readonly string fingerprint;
        readonly uint ssrc;
        readonly uint tsBase;
        readonly string session;
        readonly BlockingCollection<byte[]> dtlsIn = new BlockingCollection<byte[]>(64);
        readonly object sendLock = new object();
        readonly object recvLock = new object();
        readonly object dtlsGate = new object();
        volatile SrtpSessionContext srtp;
        volatile bool closed;
        int dtlsStarted;
        DtlsTransport dtls;
        string remoteFingerprint = "";
        string remoteSetup = "";
        ushort seq;
        bool spurt = true;
        int lastSeq = -1;
        bool heardAudio;
        readonly IOpusDecoder decoder;
        readonly float[] pcm = new float[5760];

        /// <summary>A candidate line to send, an ICE state, the first audio heard, and launcher.log lines.</summary>
        public Action<string> OnCandidate = delegate { };
        public Action<string> OnState = delegate { };
        public Action OnAudio = delegate { };
        public Action<string> Debug = delegate { };

        public string LocalUfrag { get { return ice.LocalUfrag; } }
        public string RemoteUfrag { get { return ice.RemoteUfrag; } }

        static VoicePeer()
        {
            // Concentus only, never a native opus.dll it might find on the
            // machine: what runs is what was tested.
            OpusCodecFactory.AttemptToUseNativeLibrary = false;
        }

        public VoicePeer(int id, bool offerer, VoiceMix mix)
        {
            Id = id;
            Offerer = offerer;
            this.mix = mix;
            VoiceCert.Get(out cert, out key, out fingerprint);
            Span<byte> r = stackalloc byte[12];
            RandomNumberGenerator.Fill(r);
            ssrc = BinaryPrimitives.ReadUInt32BigEndian(r);
            tsBase = BinaryPrimitives.ReadUInt32BigEndian(r.Slice(4));
            seq = BinaryPrimitives.ReadUInt16BigEndian(r.Slice(8));
            session = (BinaryPrimitives.ReadUInt32BigEndian(r.Slice(4)) & 0x7FFFFFFF).ToString(CultureInfo.InvariantCulture);
            decoder = OpusCodecFactory.CreateDecoder(VoiceMix.Rate, 1);

            ice = new VoiceIce(offerer);
            ice.OnCandidate = delegate (string l) { OnCandidate(l); };
            ice.OnState = State;
            ice.OnSelected = StartDtls;
            ice.OnMedia = Media;
            ice.Debug = delegate (string m) { Debug(m); };
        }

        public void Gather(List<IceServer> servers) { ice.Gather(servers); }

        // ----------------------------------------------------- descriptions

        /// <summary>This side's offer or answer, as SDP.</summary>
        public string Description()
        {
            var b = new StringBuilder();
            b.Append("v=0\r\n");
            b.Append("o=- ").Append(session).Append(" 2 IN IP4 127.0.0.1\r\n");
            b.Append("s=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n");
            b.Append("m=audio 9 UDP/TLS/RTP/SAVPF ").Append(PayloadType).Append("\r\n");
            b.Append("c=IN IP4 0.0.0.0\r\n");
            b.Append("a=ice-ufrag:").Append(ice.LocalUfrag).Append("\r\n");
            b.Append("a=ice-pwd:").Append(ice.LocalPwd).Append("\r\n");
            b.Append("a=ice-options:trickle\r\n");
            b.Append("a=fingerprint:sha-256 ").Append(fingerprint).Append("\r\n");
            b.Append("a=setup:").Append(Offerer ? "actpass" : "active").Append("\r\n");
            b.Append("a=mid:0\r\na=sendrecv\r\na=rtcp-mux\r\n");
            b.Append("a=rtpmap:").Append(PayloadType).Append(" opus/48000/2\r\n");
            b.Append("a=fmtp:").Append(PayloadType).Append(" minptime=10;useinbandfec=1\r\n");
            b.Append("a=ssrc:").Append(ssrc.ToString(CultureInfo.InvariantCulture)).Append(" cname:thornswood\r\n");
            return b.ToString();
        }

        /// <summary>
        /// The other side's offer or answer. Throws when it lacks what a
        /// connection needs, with the reason, which the caller logs as the
        /// page logged "sdp failed".
        /// </summary>
        public void SetRemote(string sdp)
        {
            string ufrag = "", pwd = "", fp = "", setup = "";
            var cands = new List<string>();
            foreach (string raw in (sdp ?? "").Split('\n'))
            {
                string l = raw.TrimEnd('\r');
                if (l.StartsWith("a=ice-ufrag:", StringComparison.Ordinal)) ufrag = l.Substring(12).Trim();
                else if (l.StartsWith("a=ice-pwd:", StringComparison.Ordinal)) pwd = l.Substring(10).Trim();
                else if (l.StartsWith("a=fingerprint:", StringComparison.Ordinal))
                {
                    string[] f = l.Substring(14).Trim().Split(' ');
                    if (f.Length == 2 && f[0].Equals("sha-256", StringComparison.OrdinalIgnoreCase)) fp = f[1].ToUpperInvariant();
                }
                else if (l.StartsWith("a=setup:", StringComparison.Ordinal)) setup = l.Substring(8).Trim();
                else if (l.StartsWith("a=candidate:", StringComparison.Ordinal)) cands.Add(l.Substring(2));
            }
            if (ufrag.Length == 0 || pwd.Length == 0) throw new InvalidDataException("no ICE username or password in it");
            if (fp.Length == 0) throw new InvalidDataException("no sha-256 fingerprint in it");
            remoteFingerprint = fp;
            remoteSetup = setup;
            ice.SetRemote(ufrag, pwd);
            foreach (string c in cands) ice.AddRemote(c, ufrag);
        }

        public void AddCandidate(string line, string ufrag) { ice.AddRemote(line, ufrag); }

        // ------------------------------------------------------------- DTLS

        bool DtlsServerRole()
        {
            // The offerer said actpass and the answer chose: active makes the
            // answerer the client. A side that answered passive is the server.
            if (Offerer) return remoteSetup != "passive";
            return remoteSetup == "active";
        }

        bool FingerprintOk(Certificate c)
        {
            string got = VoiceCert.Fingerprint(c);
            return got.Length > 0 && remoteFingerprint.Length > 0 &&
                   CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(got), Encoding.ASCII.GetBytes(remoteFingerprint));
        }

        int failed;

        /// <summary>
        /// A state for the owner, with "failed" said once, whichever of ICE or
        /// DTLS failed first, and nothing after it: the owner starts again
        /// once per failure it hears, and a path ICE still holds after DTLS
        /// refused it carries nothing.
        /// </summary>
        void State(string s)
        {
            if (Volatile.Read(ref failed) != 0) return;
            if (s == "failed" && Interlocked.Exchange(ref failed, 1) != 0) return;
            OnState(s);
        }

        void StartDtls()
        {
            if (Interlocked.Exchange(ref dtlsStarted, 1) != 0 || closed) return;
            var t = new Thread(Handshake) { IsBackground = true, Name = "Voice DTLS" };
            t.Start();
        }

        void Handshake()
        {
            bool server = DtlsServerRole();
            SrtpSessionContext got = null;
            string error;
            DtlsTransport tr;
            var io = new Datagrams(this);
            try
            {
                if (server)
                {
                    var s = new CheckedServer(cert, key, FingerprintOk);
                    s.OnSessionStarted += delegate (object o, DtlsSessionStartedEventArgs e) { got = e.Context; };
                    tr = s.DoHandshake(out error, io);
                }
                else
                {
                    var c = new CheckedClient(cert, key, FingerprintOk);
                    c.OnSessionStarted += delegate (object o, DtlsSessionStartedEventArgs e) { got = e.Context; };
                    tr = c.DoHandshake(out error, io);
                }
            }
            catch (Exception ex) { tr = null; error = ex.Message; }

            if (closed) return;
            if (tr == null || got == null)
            {
                Debug("dtls: could not secure the connection to peer " + Id + " (" + (error ?? "no keys") + ")");
                State("failed");
                return;
            }
            dtls = tr;
            srtp = got;
            Debug("dtls: peer " + Id + " secured as " + (server ? "server" : "client"));

            // Kept reading after the handshake: if this side's last flight
            // was lost, the other side sends its own again, and only a read
            // answers it. Nothing else travels over DTLS here.
            byte[] buf = new byte[2048];
            while (!closed)
            {
                try { tr.Receive(buf, 0, buf.Length, 1000); }
                catch (Exception ex)
                {
                    // Closing this side ends the read with an exception, which
                    // is the end and says nothing. Anything else is the other
                    // side ending DTLS, which launcher.log should show.
                    if (!closed) Debug("dtls: peer " + Id + " stopped (" + ex.Message + ")");
                    return;
                }
            }
        }

        /// <summary>DTLS records in and out over the ICE path.</summary>
        sealed class Datagrams : DatagramTransport
        {
            readonly VoicePeer p;
            public Datagrams(VoicePeer p) { this.p = p; }
            public int GetReceiveLimit() { return 1500; }
            // Room for a relay's Send indication around every record.
            public int GetSendLimit() { return 1150; }
            public int Receive(byte[] buf, int off, int len, int waitMillis) { return Receive(buf.AsSpan(off, len), waitMillis); }
            public int Receive(Span<byte> buffer, int waitMillis)
            {
                if (p.closed) throw new IOException("the connection is closed");
                byte[] d;
                if (!p.dtlsIn.TryTake(out d, waitMillis)) return -1;
                int n = Math.Min(d.Length, buffer.Length);
                d.AsSpan(0, n).CopyTo(buffer);
                return n;
            }
            public void Send(byte[] buf, int off, int len) { Send(buf.AsSpan(off, len)); }
            public void Send(ReadOnlySpan<byte> buffer)
            {
                byte[] d = buffer.ToArray();
                p.ice.SendMedia(d, d.Length);
            }
            public void Close() { }
        }

        sealed class CheckedClient : DtlsSrtpClient
        {
            readonly Func<Certificate, bool> check;
            public CheckedClient(Certificate c, AsymmetricKeyParameter k, Func<Certificate, bool> check)
                : base(c, k, SignatureAlgorithm.ecdsa, Org.BouncyCastle.Tls.HashAlgorithm.sha256) { this.check = check; }
            public override TlsAuthentication GetAuthentication() { return new Checked(base.GetAuthentication(), check); }
        }

        sealed class Checked : TlsAuthentication
        {
            readonly TlsAuthentication inner;
            readonly Func<Certificate, bool> check;
            public Checked(TlsAuthentication inner, Func<Certificate, bool> check) { this.inner = inner; this.check = check; }
            public void NotifyServerCertificate(TlsServerCertificate serverCertificate)
            {
                inner.NotifyServerCertificate(serverCertificate);
                if (serverCertificate == null || !check(serverCertificate.Certificate)) throw new TlsFatalAlert(AlertDescription.bad_certificate);
            }
            public TlsCredentials GetClientCredentials(CertificateRequest certificateRequest) { return inner.GetClientCredentials(certificateRequest); }
        }

        sealed class CheckedServer : DtlsSrtpServer
        {
            readonly Func<Certificate, bool> check;
            public CheckedServer(Certificate c, AsymmetricKeyParameter k, Func<Certificate, bool> check)
                : base(c, k, SignatureAlgorithm.ecdsa, Org.BouncyCastle.Tls.HashAlgorithm.sha256) { this.check = check; }
            public override void NotifyClientCertificate(Certificate clientCertificate)
            {
                base.NotifyClientCertificate(clientCertificate);
                if (clientCertificate == null || clientCertificate.IsEmpty || !check(clientCertificate)) throw new TlsFatalAlert(AlertDescription.bad_certificate);
            }
        }

        // ------------------------------------------------------------ media

        /// <summary>A datagram from the other side, sorted as RFC 7983 says by its first byte.</summary>
        void Media(byte[] d, int n)
        {
            if (n < 1 || closed) return;
            byte b0 = d[0];
            if (b0 >= 20 && b0 <= 63)
            {
                // The DTLS server's handshake starts on the first ClientHello
                // if its own side has not picked a path yet.
                if (DtlsServerRole()) StartDtls();
                // A full queue drops the record, as a full socket buffer
                // would; DTLS sends its flights again. A closed one is a
                // connection that has gone.
                lock (dtlsGate) { if (!dtlsIn.IsAddingCompleted) dtlsIn.TryAdd(d); }
                return;
            }
            if (b0 < 128 || b0 > 191) return;
            SrtpSessionContext ctx = srtp;
            if (ctx == null || n < 12) return;
            int pt = d[1] & 0x7F;
            if (pt >= 64 && pt <= 95) return;   // RTCP, which nothing here needs
            lock (recvLock)
            {
                if (closed) return;
                int len;
                if (ctx.UnprotectRtp(d, n, out len) != 0 || len < 12) return;
                if ((d[1] & 0x7F) != PayloadType) return;
                int at = 12 + 4 * (d[0] & 0x0F);
                if ((d[0] & 0x10) != 0)
                {
                    if (at + 4 > len) return;
                    at += 4 + 4 * BinaryPrimitives.ReadUInt16BigEndian(d.AsSpan(at + 2));
                }
                int end = len;
                if ((d[0] & 0x20) != 0) end -= d[len - 1];   // padding
                if (at > end) return;
                Decode(BinaryPrimitives.ReadUInt16BigEndian(d.AsSpan(2)), new ReadOnlySpan<byte>(d, at, end - at));
            }
        }

        /// <summary>
        /// One Opus packet into the mixer, with what was lost before it
        /// filled in: the frame just before from this packet's forward error
        /// correction, and any older ones by Opus' own concealment, up to
        /// four. A longer gap is a silence, not a loss: nothing is sent
        /// between words.
        /// </summary>
        void Decode(ushort s, ReadOnlySpan<byte> opus)
        {
            int gap = lastSeq < 0 ? 0 : (ushort)(s - (ushort)(lastSeq + 1));
            if (gap >= 0x8000) return;   // late, or a repeat
            lastSeq = s;
            if (gap > 0 && gap <= 5)
            {
                for (int i = 0; i < gap - 1; i++)
                {
                    int k = decoder.Decode(ReadOnlySpan<byte>.Empty, pcm.AsSpan(0, VoiceMix.Frame), VoiceMix.Frame, false);
                    if (k > 0) mix.Push(Id, pcm.AsSpan(0, k));
                }
                int f = decoder.Decode(opus, pcm.AsSpan(0, VoiceMix.Frame), VoiceMix.Frame, true);
                if (f > 0) mix.Push(Id, pcm.AsSpan(0, f));
            }
            int got = decoder.Decode(opus, pcm, pcm.Length, false);
            if (got <= 0) return;
            mix.Push(Id, pcm.AsSpan(0, got));
            if (!heardAudio) { heardAudio = true; OnAudio(); }
        }

        /// <summary>
        /// One 20 ms Opus frame to the other side. frame counts the
        /// microphone's frames since it opened, so the RTP timestamp keeps
        /// time across the silences between words, when nothing is sent.
        /// </summary>
        public void Send(ReadOnlySpan<byte> opus, long frame)
        {
            SrtpSessionContext ctx = srtp;
            if (ctx == null || closed) return;
            byte[] pkt;
            int outLen;
            lock (sendLock)
            {
                int len = 12 + opus.Length;
                pkt = new byte[ctx.CalculateRequiredSrtpPayloadLength(len)];
                pkt[0] = 0x80;
                pkt[1] = (byte)(PayloadType | (spurt ? 0x80 : 0));
                BinaryPrimitives.WriteUInt16BigEndian(pkt.AsSpan(2), seq++);
                BinaryPrimitives.WriteUInt32BigEndian(pkt.AsSpan(4), unchecked(tsBase + (uint)(frame * VoiceMix.Frame)));
                BinaryPrimitives.WriteUInt32BigEndian(pkt.AsSpan(8), ssrc);
                opus.CopyTo(pkt.AsSpan(12));
                spurt = false;
                if (ctx.ProtectRtp(pkt, len, out outLen) != 0) return;
            }
            ice.SendMedia(pkt, outLen);
        }

        /// <summary>The next packet starts a talkspurt (RTP's marker bit).</summary>
        public void NewSpurt() { lock (sendLock) spurt = true; }

        public void Dispose()
        {
            if (closed) return;
            closed = true;
            lock (dtlsGate) dtlsIn.CompleteAdding();
            try { if (dtls != null) dtls.Close(); } catch (Exception ex) { Swallow.Note("VoicePeer.Dispose, dtls", ex); }
            ice.Dispose();
            lock (recvLock) decoder.Dispose();
        }
    }
}
