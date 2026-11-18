using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;

namespace Thornswood
{
    // Real native sessions, ICE and DTLS; only signaling and audio are stand-ins.
    // The JS harness changes ONLY VoiceIce's private bind to loopback before
    // compiling. Empty ICE-server lists prevent external STUN/TURN traffic.
    public static class PairRestartCases
    {
        const BindingFlags Fields = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        static readonly List<object> checks = new List<object>();
        static object Get(object o, string n) { return o.GetType().GetField(n, Fields).GetValue(o); }
        static void Set(object o, string n, object v) { o.GetType().GetField(n, Fields).SetValue(o, v); }
        static object Call(object o, string n, params object[] a) { return o.GetType().GetMethod(n, Fields).Invoke(o, a); }
        static void Check(string what, bool ok)
        {
            checks.Add(new { what, ok });
            if (!ok) throw new InvalidOperationException(what);
        }

        sealed class Side : IDisposable
        {
            public readonly int Id;
            public readonly ManualClock Clock = new ManualClock();
            public readonly ManualLoop Loop = new ManualLoop();
            public readonly VoiceSession Session;
            public readonly List<string> Events = new List<string>();
            public readonly List<string> Sent = new List<string>();
            public readonly Channel<string> Out;
            public bool Legacy;

            public Side(int id)
            {
                Id = id;
                Session = new VoiceSession((kind, text) =>
                {
                    if (kind == "log" || (kind == "debug" && text.StartsWith("peer ")))
                        Events.Add(kind + ":" + text);
                }, new Config(), new VoiceSession.World { Loop = () => Loop, Time = Clock });
                Set(Session, "ICE", new List<IceServer>());
                Set(Session, "myPeer", id);
                Set(Session, "myProfile", (long)id * 100);
                Set(Session, "heard", Clock.GetTimestamp());
                // Use the production send queue, without a WSS/auth connection.
                var socket = Activator.CreateInstance(typeof(VoiceSession).GetNestedType("Sock", BindingFlags.NonPublic), true);
                Set(socket, "Open", true);
                Set(Session, "ws", socket);
                Out = (Channel<string>)Get(socket, "Out");
                Loop.Drain();
            }
            public object Rec(int id) { return ((IDictionary)Get(Session, "conns"))[id]; }
            public VoicePeer Pc(int id) { return (VoicePeer)Get(Rec(id), "Pc"); }
            public void Message(object value) { Call(Session, "Message", JsonSerializer.Serialize(value)); Loop.Drain(); }
            public void Roster(params Side[] others)
            {
                var rows = new List<object>();
                foreach (var p in others) rows.Add(new { peer = p.Id, profileId = p.Id * 100, name = "Local peer", voice = true, mode = "local" });
                Message(new { t = "peers", iceServers = Array.Empty<object>(), peers = rows });
                foreach (var p in others)
                    Check("test transport binds only loopback", IPAddress.IsLoopback((IPAddress)Get(Get(Pc(p.Id), "ice"), "bound")));
            }
            public void Dispose() { Session.Dispose(); Loop.Drain(); }
        }

        sealed class Relay : IDisposable
        {
            readonly Socket socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            readonly IPEndPoint a, b;
            readonly Thread reader;
            volatile bool stopped;
            public readonly VoicePeer A, B;
            public volatile bool DropAToB;
            public int Dropped;
            public int Port { get { return ((IPEndPoint)socket.LocalEndPoint).Port; } }
            public Relay(VoicePeer pa, VoicePeer pb)
            {
                A = pa; B = pb;
                a = new IPEndPoint(IPAddress.Loopback, (int)Get(Get(pa, "ice"), "port"));
                b = new IPEndPoint(IPAddress.Loopback, (int)Get(Get(pb, "ice"), "port"));
                socket.Bind(new IPEndPoint(IPAddress.Loopback, 0));
                reader = new Thread(Read) { IsBackground = true };
                reader.Start();
            }
            void Read()
            {
                var buffer = new byte[65536];
                while (!stopped)
                {
                    try
                    {
                        EndPoint from = new IPEndPoint(IPAddress.Loopback, 0);
                        int n = socket.ReceiveFrom(buffer, ref from);
                        var ep = (IPEndPoint)from;
                        if (!IPAddress.IsLoopback(ep.Address)) throw new InvalidOperationException("non-loopback datagram");
                        IPEndPoint to;
                        if (ep.Port == a.Port)
                        {
                            if (DropAToB) { Interlocked.Increment(ref Dropped); continue; }
                            to = b;
                        }
                        else if (ep.Port == b.Port) to = a;
                        else throw new InvalidOperationException("unknown local datagram sender");
                        socket.SendTo(buffer, 0, n, SocketFlags.None, to);
                    }
                    catch (SocketException) { if (!stopped) throw; }
                    catch (ObjectDisposedException) { if (!stopped) throw; }
                }
            }
            public void Dispose() { stopped = true; socket.Dispose(); reader.Join(1000); }
        }

        sealed class Room : IDisposable
        {
            public readonly Side[] Sides;
            public readonly Dictionary<string, Relay> Relays = new Dictionary<string, Relay>();
            public Room(params Side[] sides) { Sides = sides; }
            static string Key(int a, int b) { return a + ":" + b; }
            public Relay Pair(int a, int b) { return Relays[Key(a, b)]; }
            public void Pump()
            {
                for (int pass = 0; pass < 20; pass++)
                {
                    bool sent = false;
                    foreach (var side in Sides)
                    {
                        side.Loop.Drain();
                        while (side.Out.Reader.TryRead(out string json))
                        {
                            side.Sent.Add(json);
                            using var doc = JsonDocument.Parse(json);
                            var root = doc.RootElement;
                            string kind = root.GetProperty("t").GetString();
                            if (kind != "sdp" && kind != "ice" && kind != "voice-restart") continue;
                            int id = root.GetProperty("to").GetInt32();
                            var target = Array.Find(Sides, x => x.Id == id);
                            if (target == null || (target.Legacy && kind == "voice-restart")) continue;
                            // The service's auth/visibility gates are tested separately
                            // over real sockets. This fixture only routes its local IDs.
                            var payload = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
                            payload["from"] = side.Id;
                            target.Message(payload);
                            sent = true;
                        }
                    }
                    if (!sent) break;
                }
                foreach (var a in Sides) foreach (var b in Sides)
                {
                    if (a.Id >= b.Id || a.Rec(b.Id) == null || b.Rec(a.Id) == null) continue;
                    var pa = a.Pc(b.Id); var pb = b.Pc(a.Id);
                    if (pa.RemoteUfrag != pb.LocalUfrag || pb.RemoteUfrag != pa.LocalUfrag) continue;
                    string key = Key(a.Id, b.Id);
                    if (Relays.TryGetValue(key, out var old))
                    {
                        if (old.A == pa && old.B == pb) continue;
                        old.Dispose();
                    }
                    var relay = new Relay(pa, pb);
                    Relays[key] = relay;
                    string candidate = "candidate:1 1 udp 2130706431 127.0.0.1 " + relay.Port + " typ host";
                    pa.AddCandidate(candidate, pb.LocalUfrag);
                    pb.AddCandidate(candidate, pa.LocalUfrag);
                }
            }
            public bool Wait(Func<bool> predicate, int ms)
            {
                var watch = Stopwatch.StartNew();
                while (watch.ElapsedMilliseconds < ms)
                {
                    Pump(); if (predicate()) return true; Thread.Sleep(20);
                }
                Pump(); return predicate();
            }
            public void Dispose() { foreach (var relay in Relays.Values) relay.Dispose(); }
        }

        static bool Secure(VoicePeer p) { return Get(p, "srtp") != null && (string)Get(Get(p, "ice"), "state") == "connected"; }
        static int Count(Side side, string kind)
        {
            return side.Sent.FindAll(x => { using var d = JsonDocument.Parse(x); return d.RootElement.GetProperty("t").GetString() == kind; }).Count;
        }

        public static string Run()
        {
            checks.Clear(); VoiceAudio.Running = false;
            using var a = new Side(1); using var b = new Side(2); using var c = new Side(3);
            a.Roster(b, c); b.Roster(a, c); c.Roster(a, b);
            using var room = new Room(a, b, c);
            Check("three distinct peers secure all three actual ICE/DTLS pairs", room.Wait(() => Secure(a.Pc(2)) && Secure(b.Pc(1)) && Secure(a.Pc(3)) && Secure(c.Pc(1)) && Secure(b.Pc(3)) && Secure(c.Pc(2)), 12000));
            var ab = a.Pc(2); var ba = b.Pc(1);
            var ac = a.Pc(3); var ca = c.Pc(1); var bc = b.Pc(3); var cb = c.Pc(2);
            var oldRelay = room.Pair(1, 2);
            oldRelay.DropAToB = true;
            Check("answerer-only loss requests and secures one fresh pair", room.Wait(() => a.Pc(2) != ab && b.Pc(1) != ba && Secure(a.Pc(2)) && Secure(b.Pc(1)), 42000));
            Check("the offerer did not independently fail", (int)Get(ab, "failed") == 0);
            Check("the answerer actually failed on the one-way path", (int)Get(ba, "failed") == 1 && oldRelay.Dropped > 0);
            Check("both sides spent only their existing one-restart budget", (int)Get(a.Rec(2), "Restarts") == 1 && (int)Get(b.Rec(1), "Restarts") == 1);
            Check("unrelated healthy peer objects and ICE/DTLS remain intact", a.Pc(3) == ac && c.Pc(1) == ca && b.Pc(3) == bc && c.Pc(2) == cb && Secure(ac) && Secure(ca) && Secure(bc) && Secure(cb));
            Check("no signaling socket or native peer ID was replaced", (int)Get(a.Session, "myPeer") == 1 && (int)Get(b.Session, "myPeer") == 2 && (int)Get(c.Session, "myPeer") == 3);
            Check("answerer sent exactly one targeted request", Count(b, "voice-restart") == 1);

            var renewed = a.Pc(2); int offers = Count(a, "sdp");
            a.Message(new { t = "voice-restart", from = 2, to = 1, ufrag = ab.LocalUfrag });
            a.Message(new { t = "voice-restart", from = 2, to = 1, ufrag = renewed.LocalUfrag });
            a.Message(new { t = "voice-restart", from = 2, to = 1, ufrag = renewed.LocalUfrag, extra = true });
            Call(a.Session, "IceState", 2, a.Rec(2), ab, "failed");
            room.Pump();
            Check("stale, duplicate, exhausted-budget and retired-PC callbacks cannot rebuild", a.Pc(2) == renewed && Count(a, "sdp") == offers);
            b.Message(new { t = "voice-restart", from = 1, to = 2, ufrag = b.Pc(1).LocalUfrag });
            room.Pump();
            Check("the offerer cannot request a reverse-role restart", Count(b, "voice-restart") == 1);
            a.Clock.Advance(31000, () => room.Pump()); b.Clock.Advance(31000, () => room.Pump());
            Check("completed restart cancels its old wait without failure notice", !b.Events.Exists(x => x.Contains("could not reconnect")));

            // An older peer or older service safely ignores this optional kind.
            // Model that wire behavior; do not pretend it can recover the pair.
            using var old = new Side(4) { Legacy = true }; using var modern = new Side(5);
            old.Roster(modern); modern.Roster(old);
            using var mixed = new Room(old, modern);
            Check("mixed-version baseline is a secured real transport", mixed.Wait(() => Secure(old.Pc(5)) && Secure(modern.Pc(4)), 12000));
            var oldPc = old.Pc(5); var modernPc = modern.Pc(4);
            Call(modernPc, "State", "failed"); mixed.Pump();
            Check("legacy ignore causes no reverse offer or unrelated teardown", old.Pc(5) == oldPc && modern.Pc(4) == modernPc && Count(modern, "voice-restart") == 1);
            modern.Clock.Advance(30001, mixed.Pump);
            Check("ignored request ends in one bounded, honest failure notice", modern.Events.FindAll(x => x.Contains("could not reconnect")).Count == 1);
            modern.Clock.Advance(60000, mixed.Pump);
            Check("no unbounded request/rejoin retry follows legacy ignore", Count(modern, "voice-restart") == 1 && old.Pc(5) == oldPc);
            return JsonSerializer.Serialize(new { checks });
        }

        public static int Main()
        {
            Paths.LogFile = Path.Combine(Environment.CurrentDirectory, "swallowed.log");
            try { Console.WriteLine(Run()); return File.Exists(Paths.LogFile) && new FileInfo(Paths.LogFile).Length > 0 ? 1 : 0; }
            catch (Exception ex) { Console.Error.WriteLine(ex); Console.WriteLine(JsonSerializer.Serialize(new { checks })); return 1; }
        }
    }
}
