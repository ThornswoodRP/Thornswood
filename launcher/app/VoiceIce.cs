using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// One server from the list the voice service hands out on every roster
    /// (iceServers, #1821): a STUN server to learn this machine's public
    /// address from, or a TURN relay with the credential to use it.
    /// </summary>
    sealed class IceServer
    {
        public string Host = "";
        public int Port = 3478;
        public bool Turn;
        public string User = "";
        public string Pass = "";

        /// <summary>
        /// The urls the service sends, "stun:host:port" and "turn:host:port",
        /// as servers this agent can use. A relay reached over TCP or TLS
        /// (?transport=tcp, turns:) is left out and named in skipped: voice
        /// sends its audio over UDP, and a relay it can only reach some other
        /// way is one it cannot use. The service hands out UDP today
        /// (THORNSWOOD_TURN_URL, voice-server.js).
        /// </summary>
        public static List<IceServer> From(IEnumerable<string> urls, string user, string pass, List<string> skipped)
        {
            var outp = new List<IceServer>();
            foreach (string raw in urls)
            {
                string u = (raw ?? "").Trim();
                string lower = u.ToLowerInvariant();
                bool turn = lower.StartsWith("turn:", StringComparison.Ordinal);
                bool stun = lower.StartsWith("stun:", StringComparison.Ordinal);
                if (!turn && !stun) { if (u.Length > 0 && skipped != null) skipped.Add(u); continue; }
                string rest = u.Substring(5);
                int q = rest.IndexOf('?');
                if (q >= 0)
                {
                    string query = rest.Substring(q + 1).ToLowerInvariant();
                    rest = rest.Substring(0, q);
                    if (query.Contains("transport=tcp")) { if (skipped != null) skipped.Add(u); continue; }
                }
                string host = rest;
                int port = 3478;
                int colon = rest.LastIndexOf(':');
                if (colon > 0 && rest.IndexOf(']') < colon)
                {
                    host = rest.Substring(0, colon);
                    if (!int.TryParse(rest.Substring(colon + 1), NumberStyles.None, CultureInfo.InvariantCulture, out port)) continue;
                }
                host = host.Trim('[', ']');
                if (host.Length == 0) continue;
                outp.Add(new IceServer { Host = host, Port = port, Turn = turn, User = user ?? "", Pass = pass ?? "" });
            }
            return outp;
        }
    }

    /// <summary>
    /// ICE (RFC 8445) for one pair of people: finding a path between this
    /// launcher and one other, through whatever routers lie between, and
    /// keeping it open. What RTCPeerConnection did inside the voice page.
    ///
    /// One UDP socket per connection, bound to the address this machine
    /// reaches the internet from, never to every address: a socket on every
    /// address is a listener on every network, which Windows Firewall asks
    /// about (#911). Its candidates are that address on the socket's port
    /// (host), the address a STUN server sees
    /// it from (server reflexive), and, when the service hands out a relay,
    /// an address on the relay (TURN, RFC 8656) that forwards to this socket.
    /// Each side sends the other its candidates through the voice service
    /// (the 'ice' message), and the two try every pairing with STUN checks
    /// signed with the other's ICE password. The side that made the offer is
    /// controlling and picks the path (USE-CANDIDATE); the other follows.
    ///
    /// Only IPv4. Candidates the other side names by an mDNS .local name, as
    /// a browser does, cannot be reached and are left out: both ends of a
    /// connection here are launchers, which name addresses.
    ///
    /// Thread safety: everything the agent knows is behind one lock. What it
    /// tells its owner (OnState, OnSelected, OnCandidate, OnMedia) is called
    /// after that lock is let go, so the owner may call back in.
    /// </summary>
    sealed class VoiceIce : IDisposable
    {
        public readonly string LocalUfrag = Random(4);
        public readonly string LocalPwd = Random(22);
        public string RemoteUfrag { get; private set; } = "";
        string remotePwd = "";

        readonly bool controlling;
        readonly ulong tiebreaker;
        readonly Socket sock;
        readonly int port;
        readonly IPAddress bound;
        readonly object gate = new object();
        /* Held around every send and around closing, so the socket is never
           disposed while a send is on it: Dispose sets closed under it, and
           a send that comes after finds closed and does not touch the
           socket. The reading thread is the only other user, and it is
           ended by the dispose on purpose (Read). Taken after gate when both
           are held (Tick sends inside gate). */
        readonly object sending = new object();
        readonly Timer timer;
        readonly Thread reader;
        volatile bool closed;

        /// <summary>A candidate line ("candidate:...") to send to the other side.</summary>
        public Action<string> OnCandidate = delegate { };
        /// <summary>checking, connected, disconnected, failed or closed, as RTCPeerConnection named them.</summary>
        public Action<string> OnState = delegate { };
        /// <summary>The first time a path is chosen. DTLS starts here.</summary>
        public Action OnSelected = delegate { };
        /// <summary>A DTLS record or an SRTP packet from an address that has passed a check.</summary>
        public Action<byte[], int> OnMedia = delegate { };
        /// <summary>For launcher.log only.</summary>
        public Action<string> Debug = delegate { };

        sealed class Local
        {
            public string Type;          // host or relay; a server reflexive one is checked from its base, the socket
            public uint Priority;
            public bool Relay;
        }

        sealed class Remote
        {
            public IPEndPoint Addr;
            public uint Priority;
            public string Type;
        }

        const int Waiting = 0, InProgress = 1, Succeeded = 2, Failed = 3;

        sealed class Pair
        {
            public Local L;
            public Remote R;
            public ulong Priority;
            public int State;
            public StunMessage Check;     // the request in flight, retransmitted as is
            public byte[] CheckBytes;
            public int Tries;
            public long NextAt;
            public bool Nominating;       // the check in flight carries USE-CANDIDATE
            public bool NominatedByPeer;  // a check from the other side carried it
        }

        readonly Local direct;
        Local relay;
        readonly List<Remote> remotes = new List<Remote>();
        readonly List<Pair> pairs = new List<Pair>();
        readonly HashSet<string> validated = new HashSet<string>();
        Pair selected;
        Pair lastProven;
        bool told;                // OnSelected has been raised
        string state = "new";
        long checkingSince;
        long lastRemoteAt;
        long lastHeard;
        long nextConsent;
        Pair consentPair;
        bool gathered;
        int gathering;            // STUN and TURN requests still out
        readonly List<string> hostIps = new List<string>();

        public VoiceIce(bool controlling)
        {
            this.controlling = controlling;
            Span<byte> t = stackalloc byte[8];
            RandomNumberGenerator.Fill(t);
            tiebreaker = BinaryPrimitives.ReadUInt64BigEndian(t);

            sock = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            // A packet refused by the other end (ICMP port unreachable) must not
            // end the read loop on Windows: SIO_UDP_CONNRESET off.
            if (OperatingSystem.IsWindows())
            {
                try { sock.IOControl(unchecked((int)0x9800000C), new byte[] { 0, 0, 0, 0 }, null); }
                catch (Exception ex) { Swallow.Note("VoiceIce, SIO_UDP_CONNRESET", ex); }
            }
            bound = DefaultLocal();
            sock.Bind(new IPEndPoint(bound, 0));
            port = ((IPEndPoint)sock.LocalEndPoint).Port;

            direct = new Local { Type = "host", Priority = Prio(126, 65535) };

            reader = new Thread(Read) { IsBackground = true, Name = "Voice ICE" };
            reader.Start();
            timer = new Timer(delegate { Tick(); }, null, 20, 20);
        }

        static uint Prio(int typePref, int localPref) { return (uint)((typePref << 24) | (localPref << 8) | (256 - 1)); }

        static string Random(int bytes)
        {
            byte[] b = new byte[bytes];
            RandomNumberGenerator.Fill(b);
            // ICE's ice-char set: letters, digits, + and /.
            return Convert.ToBase64String(b).TrimEnd('=');
        }

        static long Now() { return Environment.TickCount64; }

        // ------------------------------------------------------- gathering

        /// <summary>
        /// Starts finding this connection's own candidates: its host
        /// addresses at once, and the reflexive and relayed ones as the STUN
        /// and TURN servers answer. Each is handed to OnCandidate.
        /// </summary>
        public void Gather(List<IceServer> servers)
        {
            var lines = new List<string>();
            lock (gate)
            {
                if (!IPAddress.IsLoopback(bound))
                {
                    hostIps.Add(bound.ToString());
                    lines.Add(Line("1", Prio(126, 65535), bound.ToString(), port, "host", null, 0));
                }
                bool relayTried = false;
                foreach (IceServer s in servers)
                {
                    if (!s.Turn) { gathering++; ThreadPool.QueueUserWorkItem(delegate { Reflexive(s); }); }
                    else if (!relayTried) { relayTried = true; gathering++; ThreadPool.QueueUserWorkItem(delegate { Allocate(s); }); }
                }
                if (gathering == 0) gathered = true;
            }
            foreach (string l in lines) OnCandidate(l);
        }

        /// <summary>
        /// The address this machine sends to the internet from, the way
        /// Chromium's WebRTC finds its default local address
        /// (BasicNetworkManager::QueryDefaultLocalAddress): a UDP socket
        /// connected to a public address, which sends nothing, and the
        /// address the system chose for it. With no route out, the first
        /// address of an interface that is up; with none, loopback, where
        /// nobody else can reach and nothing listens on a network.
        /// </summary>
        static IPAddress DefaultLocal()
        {
            using (var probe = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp))
            {
                try
                {
                    probe.Connect(new IPEndPoint(IPAddress.Parse("8.8.8.8"), 53));
                    IPAddress a = ((IPEndPoint)probe.LocalEndPoint).Address;
                    if (Usable(a)) return a;
                }
                // No route out (no network, or none with a gateway): the
                // interfaces below say what there is.
                catch (SocketException ex) { Swallow.Note("VoiceIce.DefaultLocal, no route out", ex); }
            }
            List<IPAddress> all = HostAddresses();
            return all.Count > 0 ? all[0] : IPAddress.Loopback;
        }

        static bool Usable(IPAddress a)
        {
            if (a.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(a)) return false;
            byte[] b = a.GetAddressBytes();
            // 0.0.0.0 is no address, and 169.254 is one nobody else can reach.
            return !(b[0] == 0 || (b[0] == 169 && b[1] == 254));
        }

        static List<IPAddress> HostAddresses()
        {
            var outp = new List<IPAddress>();
            foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (UnicastIPAddressInformation a in ni.GetIPProperties().UnicastAddresses)
                    if (Usable(a.Address)) outp.Add(a.Address);
            }
            return outp;
        }

        string Line(string foundation, uint prio, string ip, int p, string type, string raddr, int rport)
        {
            var b = new StringBuilder();
            b.Append("candidate:").Append(foundation).Append(" 1 udp ").Append(prio.ToString(CultureInfo.InvariantCulture))
             .Append(' ').Append(ip).Append(' ').Append(p.ToString(CultureInfo.InvariantCulture)).Append(" typ ").Append(type);
            if (raddr != null) b.Append(" raddr ").Append(raddr).Append(" rport ").Append(rport.ToString(CultureInfo.InvariantCulture));
            b.Append(" generation 0 ufrag ").Append(LocalUfrag);
            return b.ToString();
        }

        static IPEndPoint Resolve(IceServer s)
        {
            IPAddress ip;
            if (IPAddress.TryParse(s.Host, out ip)) return ip.AddressFamily == AddressFamily.InterNetwork ? new IPEndPoint(ip, s.Port) : null;
            foreach (IPAddress a in Dns.GetHostAddresses(s.Host))
                if (a.AddressFamily == AddressFamily.InterNetwork) return new IPEndPoint(a, s.Port);
            return null;
        }

        // Requests to STUN and TURN servers waiting on an answer, by
        // transaction id, each with what to do when it comes.
        readonly Dictionary<string, Action<StunMessage>> serverWaits = new Dictionary<string, Action<StunMessage>>();

        static string Key(byte[] tid) { return Convert.ToHexString(tid); }

        /// <summary>
        /// Sends a request to a STUN or TURN server and waits for its answer,
        /// sending it again at 0.5, 1.5 and 3.5 seconds: UDP may lose it, and
        /// RFC 8489 6.2.1 asks for exactly this. Null when no answer came.
        /// </summary>
        StunMessage Ask(IPEndPoint server, StunMessage req, byte[] key)
        {
            byte[] bytes = req.Write(key, true);
            StunMessage got = null;
            using (var done = new ManualResetEventSlim(false))
            {
                lock (gate) serverWaits[Key(req.Tid)] = delegate (StunMessage m) { got = m; done.Set(); };
                try
                {
                    foreach (int wait in new int[] { 500, 1000, 2000, 2500 })
                    {
                        if (closed) return null;
                        SendRaw(bytes, server);
                        if (done.Wait(wait)) break;
                    }
                }
                finally { lock (gate) serverWaits.Remove(Key(req.Tid)); }
            }
            return got;
        }

        void Reflexive(IceServer s)
        {
            try
            {
                IPEndPoint server = Resolve(s);
                if (server == null) { Debug("ice: " + s.Host + " has no IPv4 address"); return; }
                StunMessage ans = Ask(server, StunMessage.Make(StunMessage.Binding, StunMessage.Request), null);
                IPEndPoint mapped = ans == null ? null : ans.GetXorAddress(StunMessage.AttrXorMapped);
                if (mapped == null) { Debug("ice: no answer from " + s.Host + ":" + s.Port); return; }
                string line = null;
                lock (gate)
                {
                    if (!hostIps.Contains(mapped.Address.ToString()))
                        line = Line("2", Prio(100, 65535), mapped.Address.ToString(), mapped.Port, "srflx", hostIps.Count > 0 ? hostIps[0] : "0.0.0.0", port);
                }
                if (line != null) OnCandidate(line);
            }
            catch (Exception ex) { Debug("ice: " + s.Host + " could not be asked: " + ex.Message); }
            finally { Gathered(); }
        }

        void Gathered()
        {
            lock (gate)
            {
                gathering--;
                if (gathering <= 0) gathered = true;
            }
        }

        // ------------------------------------------------------------ relay

        IPEndPoint turnServer;
        IceServer turnCreds;
        string turnRealm = "", turnNonce = "";
        byte[] turnKey;
        IPEndPoint relayed;
        long turnRefreshAt;
        readonly Dictionary<string, long> permissions = new Dictionary<string, long>();   // ip -> when asked

        /// <summary>
        /// Asks the relay for an address of this connection's own (an
        /// Allocate, RFC 8656 7). The first try carries no credential, the
        /// relay answers 401 with its realm and a nonce, and the second is
        /// signed with them.
        /// </summary>
        void Allocate(IceServer s)
        {
            try
            {
                IPEndPoint server = Resolve(s);
                if (server == null) { Debug("ice: relay " + s.Host + " has no IPv4 address"); return; }
                lock (gate) { turnServer = server; turnCreds = s; }

                StunMessage ans = TurnAsk(StunMessage.Allocate, delegate (StunMessage m)
                {
                    m.Add(StunMessage.AttrTransport, new byte[] { 17, 0, 0, 0 });   // UDP
                });
                if (ans == null || ans.Class != StunMessage.Success)
                {
                    Debug("ice: the relay " + s.Host + " gave no address (" + (ans == null ? "no answer" : "error " + ans.ErrorCode()) + ")");
                    return;
                }
                IPEndPoint addr = ans.GetXorAddress(StunMessage.AttrXorRelayed);
                IPEndPoint mapped = ans.GetXorAddress(StunMessage.AttrXorMapped);
                if (addr == null) { Debug("ice: the relay's answer had no address"); return; }
                uint life = 600;
                byte[] lb = ans.Get(StunMessage.AttrLifetime);
                if (lb != null && lb.Length == 4) life = BinaryPrimitives.ReadUInt32BigEndian(lb);

                var askFor = new List<IPEndPoint>();
                string line;
                lock (gate)
                {
                    relayed = addr;
                    relay = new Local { Type = "relay", Priority = Prio(0, 65535), Relay = true };
                    turnRefreshAt = Now() + Math.Max(30, (long)life - 60) * 1000;
                    foreach (Remote r in remotes) { AddPair(relay, r); askFor.Add(r.Addr); }
                    line = Line("3", relay.Priority, addr.Address.ToString(), addr.Port, "relay",
                                mapped == null ? "0.0.0.0" : mapped.Address.ToString(), mapped == null ? 0 : mapped.Port);
                }
                OnCandidate(line);
                foreach (IPEndPoint r in askFor) Permit(r);
            }
            catch (Exception ex) { Debug("ice: the relay could not be asked: " + ex.Message); }
            finally { Gathered(); }
        }

        /// <summary>
        /// A request to the relay, signed with its long term credential once
        /// the relay has said its realm. A 401 or a stale nonce (438) is
        /// answered once with what the relay asked for; that is the protocol,
        /// not a retry (RFC 8489 9.2.4).
        /// </summary>
        StunMessage TurnAsk(int method, Action<StunMessage> fill)
        {
            for (int round = 0; round < 2; round++)
            {
                IPEndPoint server;
                IceServer creds;
                string realm, nonce;
                byte[] key;
                lock (gate) { server = turnServer; creds = turnCreds; realm = turnRealm; nonce = turnNonce; key = turnKey; }
                if (server == null || closed) return null;
                StunMessage req = StunMessage.Make(method, StunMessage.Request);
                fill(req);
                if (key != null)
                {
                    req.AddString(StunMessage.AttrUsername, creds.User);
                    req.AddString(StunMessage.AttrRealm, realm);
                    req.AddString(StunMessage.AttrNonce, nonce);
                }
                StunMessage ans = Ask(server, req, key);
                if (ans == null) return null;
                int code = ans.Class == StunMessage.Error ? ans.ErrorCode() : 0;
                if (code != 401 && code != 438) return ans;
                if (code == 401 && key != null) return ans;   // the credential itself was refused
                string r2 = ans.GetString(StunMessage.AttrRealm);
                string n2 = ans.GetString(StunMessage.AttrNonce);
                if (n2 == null) return ans;
                lock (gate)
                {
                    if (r2 != null) turnRealm = r2;
                    turnNonce = n2;
                    turnKey = StunMessage.LongTermKey(creds.User, turnRealm, creds.Pass);
                }
            }
            return null;
        }

        /// <summary>
        /// Lets the other side's address through the relay (CreatePermission,
        /// RFC 8656 9). The relay drops anything from a peer it has no
        /// permission for, the other side's checks included, so this is asked
        /// for as soon as both the relay and the candidate are known, and
        /// again every four minutes, inside the five a permission lasts.
        /// </summary>
        void Permit(IPEndPoint peer)
        {
            string ip = peer.Address.ToString();
            lock (gate)
            {
                if (relayed == null) return;
                long at;
                if (permissions.TryGetValue(ip, out at) && Now() - at < 240000) return;
                permissions[ip] = Now();
            }
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    StunMessage ans = TurnAsk(StunMessage.CreatePermission, delegate (StunMessage m)
                    {
                        m.AddXorAddress(StunMessage.AttrXorPeer, peer);
                    });
                    if (ans == null || ans.Class != StunMessage.Success)
                    {
                        Debug("ice: the relay would not let " + ip + " through (" + (ans == null ? "no answer" : "error " + ans.ErrorCode()) + ")");
                        lock (gate) permissions.Remove(ip);
                    }
                }
                catch (Exception ex) { Swallow.Note("VoiceIce.Permit", ex); }
            });
        }

        void RefreshRelay(uint lifetime)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    StunMessage ans = TurnAsk(StunMessage.Refresh, delegate (StunMessage m) { m.AddUInt(StunMessage.AttrLifetime, lifetime); });
                    if (lifetime > 0 && (ans == null || ans.Class != StunMessage.Success))
                        Debug("ice: the relay would not keep this connection's address (" + (ans == null ? "no answer" : "error " + ans.ErrorCode()) + ")");
                }
                catch (Exception ex) { Swallow.Note("VoiceIce.RefreshRelay", ex); }
            });
        }

        // ------------------------------------------------- the other side

        /// <summary>The other side's ICE username and password, from its offer or answer.</summary>
        public void SetRemote(string ufrag, string pwd)
        {
            lock (gate)
            {
                RemoteUfrag = ufrag ?? "";
                remotePwd = pwd ?? "";
                if (checkingSince == 0) checkingSince = Now();
                lastRemoteAt = Now();
            }
            SetState("checking");
        }

        /// <summary>
        /// One of the other side's candidates, as the line it sent. Lines for
        /// another ufrag (an earlier try), other transports, IPv6 and mDNS
        /// names are left out.
        /// </summary>
        public void AddRemote(string line, string ufrag)
        {
            if (string.IsNullOrEmpty(line)) return;
            string l = line.StartsWith("a=", StringComparison.Ordinal) ? line.Substring(2) : line;
            if (!l.StartsWith("candidate:", StringComparison.Ordinal)) return;
            string[] f = l.Substring(10).Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (f.Length < 8 || f[1] != "1" || !f[2].Equals("udp", StringComparison.OrdinalIgnoreCase) || f[6] != "typ") return;
            uint prio;
            int p;
            IPAddress ip;
            if (!uint.TryParse(f[3], NumberStyles.None, CultureInfo.InvariantCulture, out prio)) return;
            if (!int.TryParse(f[5], NumberStyles.None, CultureInfo.InvariantCulture, out p)) return;
            if (!IPAddress.TryParse(f[4], out ip) || ip.AddressFamily != AddressFamily.InterNetwork) return;
            for (int i = 8; i + 1 < f.Length; i += 2)
                if (f[i] == "ufrag" && ufrag == null) ufrag = f[i + 1];

            var ep = new IPEndPoint(ip, p);
            bool permit = false;
            lock (gate)
            {
                if (ufrag != null && ufrag.Length > 0 && RemoteUfrag.Length > 0 && ufrag != RemoteUfrag) return;
                foreach (Remote r0 in remotes) if (r0.Addr.Equals(ep)) return;
                var r = new Remote { Addr = ep, Priority = prio, Type = f[7] };
                remotes.Add(r);
                lastRemoteAt = Now();
                AddPair(direct, r);
                if (relay != null) { AddPair(relay, r); permit = true; }
            }
            if (permit) Permit(ep);
        }

        Pair AddPair(Local l, Remote r)
        {
            foreach (Pair q in pairs) if (q.L == l && q.R.Addr.Equals(r.Addr)) return q;
            ulong g = controlling ? l.Priority : r.Priority;
            ulong d = controlling ? r.Priority : l.Priority;
            var p = new Pair { L = l, R = r, Priority = (Math.Min(g, d) << 32) + 2 * Math.Max(g, d) + (g > d ? 1UL : 0UL) };
            int at = 0;
            while (at < pairs.Count && pairs[at].Priority >= p.Priority) at++;
            pairs.Insert(at, p);
            return p;
        }

        // --------------------------------------------------------- sending

        void SendRaw(byte[] data, IPEndPoint to)
        {
            lock (sending)
            {
                if (closed) return;
                try { sock.SendTo(data, to); }
                catch (SocketException ex) { Debug("ice: could not send to " + to + " (" + ex.SocketErrorCode + ")"); }
            }
        }

        void SendOn(Pair p, byte[] data)
        {
            if (!p.L.Relay) { SendRaw(data, p.R.Addr); return; }
            IPEndPoint server;
            lock (gate) server = turnServer;
            if (server == null) return;
            // A Send indication (RFC 8656 11.1): the relay passes DATA on to
            // XOR-PEER-ADDRESS from the relayed address.
            StunMessage ind = StunMessage.Make(StunMessage.SendMethod, StunMessage.Indication);
            ind.AddXorAddress(StunMessage.AttrXorPeer, p.R.Addr);
            ind.Add(StunMessage.AttrData, data);
            SendRaw(ind.Write(null, false), server);
        }

        /// <summary>
        /// A DTLS record or SRTP packet to the other side, on the chosen path,
        /// or before one is chosen on the last path a check proved: the DTLS
        /// server answers a ClientHello that may arrive before its own side
        /// has picked.
        /// </summary>
        public void SendMedia(byte[] data, int length)
        {
            Pair p;
            lock (gate) p = selected ?? lastProven;
            if (p == null) return;
            byte[] d = data;
            if (length != data.Length) { d = new byte[length]; Array.Copy(data, d, length); }
            SendOn(p, d);
        }

        StunMessage CheckFor(Pair p, bool nominate)
        {
            StunMessage m = StunMessage.Make(StunMessage.Binding, StunMessage.Request);
            m.AddString(StunMessage.AttrUsername, RemoteUfrag + ":" + LocalUfrag);
            // The priority a peer reflexive candidate from this check would have.
            m.AddUInt(StunMessage.AttrPriority, Prio(p.L.Relay ? 0 : 110, 65535));
            if (controlling) m.AddULong(StunMessage.AttrControlling, tiebreaker);
            else m.AddULong(StunMessage.AttrControlled, tiebreaker);
            if (nominate) m.Add(StunMessage.AttrUseCandidate, null);
            return m;
        }

        void StartCheck(Pair p, bool nominate, long now)
        {
            p.Check = CheckFor(p, nominate);
            p.CheckBytes = p.Check.Write(Encoding.UTF8.GetBytes(remotePwd), true);
            p.Nominating = nominate;
            p.State = InProgress;
            p.Tries = 1;
            p.NextAt = now + 100;
            SendOn(p, p.CheckBytes);
        }

        // ------------------------------------------------------------ clock

        /// <summary>
        /// Every 20 ms (Ta, RFC 8445 14.2): one new check, the retransmits
        /// that are due, the relay's refreshes, and on the chosen path a
        /// check every two seconds (consent, RFC 7675) whose silence says the
        /// other side has gone.
        /// </summary>
        void Tick()
        {
            if (closed) return;
            string to = null;
            bool refresh = false;
            var permit = new List<IPEndPoint>();
            try
            {
                lock (gate)
                {
                    long now = Now();
                    if (remotePwd.Length == 0) return;

                    foreach (Pair p in pairs)
                    {
                        if (p.State != InProgress || now < p.NextAt) continue;
                        // 100, 200, 400, 800, 1600, 1600 ms: about five seconds a check.
                        if (p.Tries >= 7) { p.State = Failed; continue; }
                        p.Tries++;
                        p.NextAt = now + Math.Min(1600, 100 << (p.Tries - 1));
                        SendOn(p, p.CheckBytes);
                    }
                    foreach (Pair p in pairs)
                    {
                        if (p.State != Waiting) continue;
                        StartCheck(p, false, now);
                        break;
                    }

                    if (selected != null)
                    {
                        if (now >= nextConsent)
                        {
                            nextConsent = now + 2000;
                            consentPair = selected;
                            selected.Check = CheckFor(selected, controlling);
                            selected.CheckBytes = selected.Check.Write(Encoding.UTF8.GetBytes(remotePwd), true);
                            selected.Tries = 7;   // consent checks are not retransmitted; the next is two seconds away
                            SendOn(selected, selected.CheckBytes);
                        }
                        long quiet = now - lastHeard;
                        if (quiet > 30000) to = "failed";
                        else if (quiet > 6000) to = "disconnected";
                        else to = "connected";
                    }
                    else if (checkingSince > 0)
                    {
                        bool open = false;
                        foreach (Pair p in pairs) if (p.State == Waiting || p.State == InProgress) open = true;
                        if (now - checkingSince > 30000) to = "failed";
                        else if (!open && gathered && pairs.Count > 0 && now - lastRemoteAt > 5000) to = "failed";
                    }

                    if (relayed != null && turnRefreshAt > 0 && now >= turnRefreshAt)
                    {
                        turnRefreshAt = now + 240000;
                        refresh = true;
                        foreach (Remote r in remotes) permit.Add(r.Addr);
                    }
                }
            }
            catch (Exception ex) { Swallow.Note("VoiceIce.Tick", ex); }
            if (refresh) { RefreshRelay(600); foreach (IPEndPoint r in permit) Permit(r); }
            if (to != null) SetState(to);
        }

        void SetState(string s)
        {
            lock (gate)
            {
                if (state == s || state == "closed" || (state == "failed" && s != "closed")) return;
                state = s;
            }
            OnState(s);
        }

        // --------------------------------------------------------- reading

        void Read()
        {
            byte[] buf = new byte[2048];
            // Overwritten by each ReceiveFrom; it only has to be IPv4.
            EndPoint from = new IPEndPoint(bound, 0);
            while (!closed)
            {
                int n;
                try { n = sock.ReceiveFrom(buf, ref from); }
                catch (ObjectDisposedException) { return; }
                catch (SocketException ex)
                {
                    if (closed) return;
                    if (ex.SocketErrorCode == SocketError.ConnectionReset || ex.SocketErrorCode == SocketError.MessageSize) continue;
                    Debug("ice: the socket stopped reading (" + ex.SocketErrorCode + ")");
                    return;
                }
                try { Arrived(buf, n, (IPEndPoint)from); }
                catch (Exception ex) { Swallow.Note("VoiceIce.Read", ex); }
            }
        }

        void Arrived(byte[] buf, int n, IPEndPoint from)
        {
            var span = new ReadOnlySpan<byte>(buf, 0, n);
            IPEndPoint server;
            lock (gate) server = turnServer;
            bool fromRelay = server != null && server.Equals(from);

            if (StunMessage.Looks(span))
            {
                StunMessage m = StunMessage.Parse(span);
                if (m == null) return;
                if (m.Class == StunMessage.Success || m.Class == StunMessage.Error)
                {
                    Action<StunMessage> wait;
                    lock (gate) serverWaits.TryGetValue(Key(m.Tid), out wait);
                    if (wait != null) { wait(m); return; }
                }
                if (fromRelay && m.Method == StunMessage.DataMethod && m.Class == StunMessage.Indication)
                {
                    IPEndPoint peer = m.GetXorAddress(StunMessage.AttrXorPeer);
                    byte[] data = m.Get(StunMessage.AttrData);
                    if (peer != null && data != null) FromPeer(data, data.Length, peer, true);
                    return;
                }
                FromPeer(buf, n, from, false);
                return;
            }
            if (fromRelay) return;
            FromPeer(buf, n, from, false);
        }

        static string Where(IPEndPoint ep, bool viaRelay) { return (viaRelay ? "r/" : "d/") + ep; }

        void FromPeer(byte[] d, int n, IPEndPoint from, bool viaRelay)
        {
            var span = new ReadOnlySpan<byte>(d, 0, n);
            if (!StunMessage.Looks(span))
            {
                bool ok;
                lock (gate) ok = validated.Contains(Where(from, viaRelay));
                if (!ok) return;
                byte[] copy = new byte[n];
                Array.Copy(d, copy, n);
                OnMedia(copy, n);
                return;
            }
            StunMessage m = StunMessage.Parse(span);
            if (m == null || m.Method != StunMessage.Binding) return;
            if (m.Class == StunMessage.Request) Checked(m, from, viaRelay);
            else if (m.Class == StunMessage.Success) Answered(m, from, viaRelay);
        }

        /// <summary>A check from the other side: answered, and its path tried back.</summary>
        void Checked(StunMessage m, IPEndPoint from, bool viaRelay)
        {
            if (!m.IntegrityOk(Encoding.UTF8.GetBytes(LocalPwd))) return;
            string user = m.GetString(StunMessage.AttrUsername) ?? "";
            if (!user.StartsWith(LocalUfrag + ":", StringComparison.Ordinal)) return;

            StunMessage ok = new StunMessage { Method = StunMessage.Binding, Class = StunMessage.Success, Tid = m.Tid };
            ok.AddXorAddress(StunMessage.AttrXorMapped, from);
            byte[] answer = ok.Write(Encoding.UTF8.GetBytes(LocalPwd), true);

            bool select = false;
            Pair p;
            lock (gate)
            {
                Local l = viaRelay ? relay : direct;
                if (l == null) return;
                Remote r = null;
                foreach (Remote r0 in remotes) if (r0.Addr.Equals(from)) r = r0;
                if (r == null)
                {
                    // Peer reflexive: an address the other side did not know it had.
                    uint prio = 0;
                    byte[] pb = m.Get(StunMessage.AttrPriority);
                    if (pb != null && pb.Length == 4) prio = BinaryPrimitives.ReadUInt32BigEndian(pb);
                    r = new Remote { Addr = from, Priority = prio, Type = "prflx" };
                    remotes.Add(r);
                }
                p = AddPair(l, r);
                validated.Add(Where(from, viaRelay));
                if (lastProven == null) lastProven = p;
                if (selected != null && selected == p) lastHeard = Now();
                if (m.Has(StunMessage.AttrUseCandidate) && !controlling)
                {
                    p.NominatedByPeer = true;
                    if (p.State == Succeeded) select = Choose(p);
                }
                // A triggered check (RFC 8445 7.3.1.4): try this path back now.
                if (remotePwd.Length > 0 && (p.State == Waiting || p.State == Failed)) StartCheck(p, false, Now());
            }
            SendOn(p, answer);
            if (select) OnSelected();
        }

        /// <summary>The other side answered one of this side's checks.</summary>
        void Answered(StunMessage m, IPEndPoint from, bool viaRelay)
        {
            bool select = false;
            lock (gate)
            {
                Pair p = null;
                foreach (Pair q in pairs) if (q.Check != null && q.Check.SameTransaction(m)) { p = q; break; }
                if (p == null) return;
                if (!m.IntegrityOk(Encoding.UTF8.GetBytes(remotePwd))) return;
                validated.Add(Where(from, viaRelay));
                lastProven = p;
                lastHeard = Now();
                bool nominated = p.Nominating;
                p.State = Succeeded;
                p.Check = null;
                if (p == consentPair && p == selected) return;
                if (controlling)
                {
                    if (nominated) select = Choose(p);
                    else if (selected == null || p.Priority > selected.Priority) StartCheck(p, true, Now());
                }
                else if (p.NominatedByPeer) select = Choose(p);
            }
            if (select) OnSelected();
        }

        /// <summary>
        /// This pair is the path from now on, if it is the first or better
        /// than the one there is. True only the first time, which is when
        /// DTLS starts.
        /// </summary>
        bool Choose(Pair p)
        {
            if (selected != null && selected.Priority >= p.Priority) return false;
            bool first = selected == null;
            selected = p;
            lastHeard = Now();
            nextConsent = Now() + 2000;
            Debug("ice: path " + (p.L.Relay ? "through the relay" : "direct") + " to " + p.R.Type + " " + p.R.Addr);
            // The state follows on the next tick, which sees a chosen path.
            if (first && !told) { told = true; return true; }
            return false;
        }

        // ---------------------------------------------------------- closing

        public void Dispose()
        {
            if (closed) return;
            bool hadRelay;
            lock (gate) hadRelay = relayed != null;
            // The relay's address is handed back (a Refresh with lifetime 0)
            // rather than left to expire on the relay's bill.
            if (hadRelay)
            {
                try
                {
                    StunMessage req = StunMessage.Make(StunMessage.Refresh, StunMessage.Request);
                    req.AddUInt(StunMessage.AttrLifetime, 0);
                    IPEndPoint server; IceServer creds; string realm, nonce; byte[] key;
                    lock (gate) { server = turnServer; creds = turnCreds; realm = turnRealm; nonce = turnNonce; key = turnKey; }
                    if (key != null)
                    {
                        req.AddString(StunMessage.AttrUsername, creds.User);
                        req.AddString(StunMessage.AttrRealm, realm);
                        req.AddString(StunMessage.AttrNonce, nonce);
                        SendRaw(req.Write(key, true), server);
                    }
                }
                catch (Exception ex) { Swallow.Note("VoiceIce.Dispose, relay", ex); }
            }
            // No state is reported for a close: the connection's owner closed
            // it and knows, as RTCPeerConnection.close() reported nothing.
            lock (gate) state = "closed";
            lock (sending) closed = true;
            timer.Dispose();
            // Ends the reading thread's ReceiveFrom, which is how it stops.
            sock.Dispose();
        }
    }
}
