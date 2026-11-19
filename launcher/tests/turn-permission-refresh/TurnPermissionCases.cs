using System;
using System.Buffers.Binary;
using System.Collections;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;

namespace Thornswood {
static class TurnPermissionCases {
    static int passed, failed;
    const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    static void Check(string name, bool ok) { Console.WriteLine((ok ? "PASS " : "FAIL ") + name); if (ok) passed++; else failed++; }
    static void Tick(VoiceIce ice) { typeof(VoiceIce).GetMethod("Tick", Private).Invoke(ice, null); }
    static bool Wait(Func<bool> condition) { return SpinWait.SpinUntil(condition, 3000); }
    static bool Idle(VoiceIce ice) {
        lock (typeof(VoiceIce).GetField("gate", Private).GetValue(ice))
            return ((IDictionary)typeof(VoiceIce).GetField("serverWaits", Private).GetValue(ice)).Count == 0;
    }
    static long RefreshAt(VoiceIce ice) {
        lock (typeof(VoiceIce).GetField("gate", Private).GetValue(ice))
            return (long)typeof(VoiceIce).GetField("turnRefreshAt", Private).GetValue(ice);
    }

    static void Run(uint lifetime, long firstDue) {
        long now = 1000000;
        Func<long> clock = () => Interlocked.Read(ref now);
        // Windows cannot route from VoiceIce's concrete default-source bind
        // to loopback. Use the same local interface, as test-1821 does: no
        // external endpoint or wildcard listener, and no production override.
        var local = (IPAddress)typeof(VoiceIce).GetMethod("DefaultLocal", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, null);
        using var relay = new Relay(lifetime, clock, local);
        using var ice = new VoiceIce(true, clock);
        Check("fixture and native socket share the same concrete local address", ((IPAddress)typeof(VoiceIce).GetField("bound", Private).GetValue(ice)).Equals(local));
        // Retain the real reader, Allocate, Tick and authenticated TURN wire
        // paths; only stop the periodic timer so this clock has one owner.
        using (var drained = new ManualResetEvent(false)) {
            ((Timer)typeof(VoiceIce).GetField("timer", Private).GetValue(ice)).Dispose(drained);
            if (!drained.WaitOne(3000)) throw new Exception("The periodic ICE timer did not drain.");
        }
        using var allocated = new ManualResetEventSlim();
        ice.OnCandidate = line => { if (line.Contains(" typ relay ")) allocated.Set(); };
        var server = new IceServer { Turn = true, Host = local.ToString(), Port = relay.Port, User = Relay.User, Pass = Relay.Password };
        ice.Gather(new List<IceServer> { server });
        if (!allocated.Wait(3000)) throw new Exception("The isolated relay did not allocate.");
        // Candidates arrive after Allocate. Equal timestamps hid the missed
        // renewal when the candidate throttle was also four minutes.
        const long permissionDelay = 1000;
        Interlocked.Exchange(ref now, 1000000 + permissionDelay);
        ice.AddRemote("candidate:fixture 1 udp 1 127.0.0.2 45678 typ host", null);
        ice.AddRemote("candidate:other-port 1 udp 1 127.0.0.2 45679 typ host", null);
        // Connectivity checks are independent of this permission deadline.
        // The peer is loopback-only; no media/DTLS or external traffic is sent.
        lock (typeof(VoiceIce).GetField("gate", Private).GetValue(ice))
            ((IList)typeof(VoiceIce).GetField("pairs", Private).GetValue(ice)).Clear();
        ice.SetRemote("fixture", "fixture-ice-password");
        if (!Wait(() => relay.Permissions == 1 && Idle(ice))) throw new Exception("The initial authenticated permission transaction did not finish.");
        string label = "allocation " + lifetime + "s: ";
        Check(label + "delayed permission coalesces candidates sharing an IP", relay.PermissionAlive && relay.Permissions == 1);
        long scheduled = RefreshAt(ice);
        Interlocked.Exchange(ref now, 1000000 + firstDue - 1); Tick(ice);
        // Tick updates its deadline synchronously before queueing wire work.
        // Check that too: counters alone could miss an unstarted early worker.
        Check(label + "no early refresh", RefreshAt(ice) == scheduled && Idle(ice) && relay.Refreshes == 0 && relay.Permissions == 1);
        Interlocked.Exchange(ref now, 1000000 + firstDue); Tick(ice);
        // Scheduled renewal is distinct from normal candidate suppression,
        // and still sends only one permission request per unique peer IP.
        int firstPermissions = 2;
        bool refreshed = Wait(() => relay.Refreshes == 1 && relay.Permissions == firstPermissions && Idle(ice));
        Check(label + "first due tick refreshes the allocation and due permissions", refreshed);
        if (firstDue == 240000) {
            // No Tick here: prove the permission survived its original expiry
            // before a later renewal could conceal an interruption.
            Interlocked.Exchange(ref now, 1000000 + permissionDelay + 300001);
            Check(label + "permission survives its original expiry without a later renewal", relay.PermissionAlive && relay.Permissions == firstPermissions);
        }
        scheduled = RefreshAt(ice);
        Interlocked.Exchange(ref now, 1000000 + firstDue + 240000 - 1); Tick(ice);
        Check(label + "subsequent cadence is not early", RefreshAt(ice) == scheduled && Idle(ice) && relay.Refreshes == 1 && relay.Permissions == firstPermissions);
        Interlocked.Exchange(ref now, 1000000 + firstDue + 240000); Tick(ice);
        Check(label + "subsequent four-minute refresh remains intact", Wait(() => relay.Refreshes == 2 && relay.Permissions == firstPermissions + 1 && Idle(ice)));
        Check(label + "all requests use fixture authentication", relay.BadAuthentication == 0 && relay.Failure == null);
    }

    static int Main() {
        try { Run(600, 240000); Run(3600, 240000); Run(120, 60000); }
        catch (Exception ex) { Console.WriteLine("FAIL fixture: " + ex); failed++; }
        Console.WriteLine(passed + " passed, " + failed + " failed");
        return failed == 0 ? 0 : 1;
    }

    sealed class Relay : IDisposable {
        public const string User = "fixture-user", Password = "fixture-password";
        const string Realm = "fixture.invalid", Nonce = "fixture-nonce";
        readonly Socket socket;
        readonly Thread worker;
        readonly Func<long> clock;
        readonly uint lifetime;
        readonly IPAddress local;
        readonly byte[] key = StunMessage.LongTermKey(User, Realm, Password);
        volatile bool closed;
        int permissions, refreshes, badAuthentication;
        long expires;
        public readonly int Port;
        public string Failure;
        public int Permissions => Volatile.Read(ref permissions);
        public int Refreshes => Volatile.Read(ref refreshes);
        public int BadAuthentication => Volatile.Read(ref badAuthentication);
        public bool PermissionAlive => clock() < Interlocked.Read(ref expires);
        public Relay(uint lifetime, Func<long> clock, IPAddress local) {
            this.lifetime = lifetime; this.clock = clock; this.local = local;
            socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            socket.Bind(new IPEndPoint(local, 0)); socket.ReceiveTimeout = 200;
            Port = ((IPEndPoint)socket.LocalEndPoint).Port;
            worker = new Thread(Read) { IsBackground = true }; worker.Start();
        }
        void Read() {
            try {
                var bytes = new byte[4096];
                while (!closed) {
                    EndPoint from = new IPEndPoint(IPAddress.Any, 0); int count;
                    try { count = socket.ReceiveFrom(bytes, ref from); }
                    catch (SocketException ex) when (ex.SocketErrorCode == SocketError.TimedOut) { continue; }
                    var request = StunMessage.Parse(bytes.AsSpan(0, count));
                    if (request == null || request.Class != StunMessage.Request) continue;
                    bool authenticated = request.GetString(StunMessage.AttrUsername) == User;
                    var answer = new StunMessage { Method = request.Method, Class = authenticated ? StunMessage.Success : StunMessage.Error, Tid = request.Tid };
                    if (!authenticated) {
                        answer.Add(StunMessage.AttrErrorCode, new byte[] { 0, 0, 4, 1 });
                        answer.AddString(StunMessage.AttrRealm, Realm); answer.AddString(StunMessage.AttrNonce, Nonce);
                    } else {
                        if (!request.IntegrityOk(key) || request.GetString(StunMessage.AttrNonce) != Nonce) { Interlocked.Increment(ref badAuthentication); continue; }
                        if (request.Method == StunMessage.Allocate) {
                            answer.AddXorAddress(StunMessage.AttrXorRelayed, new IPEndPoint(local, 34999));
                            answer.AddXorAddress(StunMessage.AttrXorMapped, (IPEndPoint)from);
                            answer.AddUInt(StunMessage.AttrLifetime, lifetime);
                        } else if (request.Method == StunMessage.CreatePermission) {
                            if (request.GetXorAddress(StunMessage.AttrXorPeer) == null) throw new Exception("Missing permission peer.");
                            Interlocked.Exchange(ref expires, clock() + 300000); Interlocked.Increment(ref permissions);
                        } else if (request.Method == StunMessage.Refresh) {
                            uint requested = BinaryPrimitives.ReadUInt32BigEndian(request.Get(StunMessage.AttrLifetime));
                            if (requested > 0) Interlocked.Increment(ref refreshes);
                            answer.AddUInt(StunMessage.AttrLifetime, requested);
                        }
                    }
                    socket.SendTo(answer.Write(authenticated ? key : null, true), from);
                }
            } catch (Exception ex) { if (!closed) Failure = ex.GetType().Name; }
        }
        public void Dispose() { closed = true; socket.Dispose(); if (!worker.Join(1000)) throw new Exception("The fixture relay did not stop."); }
    }
}
}
