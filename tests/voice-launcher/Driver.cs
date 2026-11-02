using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Thornswood
{
    /*
      One launcher's voice for a harness: the launcher's VoiceSession, run by
      JSON lines on stdin, with everything it tells the launcher and does to
      its socket written as JSON lines on stdout. tests\voice-launcher.js is
      the side a harness talks to.

        --clock real|manual   real: the session's own thread and timers, real
                              sockets and audio. manual: the session's jobs
                              run on this thread, its clock moves only on
                              {"do":"advance"}, and every command is answered
                              {"ev":"done"} once the session has nothing left
                              to do, so a harness reads exactly what it did.
        --wire ws|fake        ws: the session's wss address is dialled as ws
                              on loopback (the voice service a harness starts
                              takes loopback as this machine, the way Caddy
                              hands it on); fake: each dial is an event, and
                              the harness admits, refuses, speaks and closes
                              it as the service would.
        --jitter x            the random part of each retry's wait, fixed.
        --tone hz             the pitch of this microphone.
        --log file            where Swallow writes.

      Commands: configure, token, ptt, mode, muted (the five calls Voice.cs
      makes), advance, tokens (answer the session's token asks on the manual
      clock, as Voice.cs does after its fetch), dials (fail every dial),
      admit, refuse, say, close (one fake socket), hear, quit.
    */
    static class Driver
    {
        static readonly object Out = new object();
        static bool manual;
        static ManualClock clock;
        static ManualLoop loop;
        static VoiceSession session;
        static readonly ConcurrentDictionary<int, FakeSocket> sockets = new ConcurrentDictionary<int, FakeSocket>();
        static int dialled;

        // The launcher's side of a token ask, when the harness hands it here.
        static bool tokensOn, tokensGive;
        static int tokensDelay, minted;
        static string tokensPrefix = "fresh-", tokensWhy = "";
        // Every dial fails, as on a network that is down.
        static volatile bool dialsFail;

        public static void Emit(Action<Utf8JsonWriter> write)
        {
            var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms))
            {
                w.WriteStartObject();
                write(w);
                w.WriteEndObject();
            }
            string line = Encoding.UTF8.GetString(ms.ToArray());
            lock (Out) { Console.Out.WriteLine(line); Console.Out.Flush(); }
        }

        static int Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--hrtf") return HrtfTool.Run(args);
            string clockArg = "real", wireArg = "ws";
            double jitter = -1;
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                string v = args[i + 1];
                switch (args[i])
                {
                    case "--clock": clockArg = v; break;
                    case "--wire": wireArg = v; break;
                    case "--jitter": jitter = double.Parse(v, CultureInfo.InvariantCulture); break;
                    case "--tone": VoiceAudio.Tone = double.Parse(v, CultureInfo.InvariantCulture); break;
                    case "--log": Paths.LogFile = v; break;
                    default: Console.Error.WriteLine("unknown argument " + args[i]); return 2;
                }
            }
            manual = clockArg == "manual";
            var world = new VoiceSession.World();
            if (manual)
            {
                clock = new ManualClock();
                loop = new ManualLoop();
                world.Time = clock;
                world.Loop = delegate { return loop; };
                VoiceAudio.Running = false;
            }
            if (jitter >= 0) world.Jitter = delegate { return jitter; };
            if (wireArg == "fake") world.Dial = FakeDial;
            else world.Dial = LoopbackDial;

            session = new VoiceSession(OnHost, new Config(), world);
            Settle();
            Emit(w => w.WriteString("ev", "ready"));

            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                using (JsonDocument doc = JsonDocument.Parse(line))
                {
                    JsonElement c = doc.RootElement;
                    string what = c.GetProperty("do").GetString();
                    long seq = c.TryGetProperty("seq", out JsonElement sq) ? sq.GetInt64() : 0;
                    if (what == "quit")
                    {
                        session.Dispose();
                        Emit(w => { w.WriteString("ev", "done"); w.WriteNumber("seq", seq); });
                        return 0;
                    }
                    Do(what, c);
                    Settle();
                    Emit(w => { w.WriteString("ev", "done"); w.WriteNumber("seq", seq); });
                }
            }
            session.Dispose();
            return 0;
        }

        static string Str(JsonElement c, string name)
        {
            return c.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.String ? v.GetString() : "";
        }

        static void Do(string what, JsonElement c)
        {
            switch (what)
            {
                case "configure":
                    session.Configure(c.GetProperty("profileId").GetInt64(), Str(c, "name"), Str(c, "token"), Str(c, "base"), Str(c, "socket"));
                    break;
                case "token": session.Token(Str(c, "token"), Str(c, "why")); break;
                case "ptt": session.Ptt(c.GetProperty("on").GetBoolean()); break;
                case "mode": session.Mode(Str(c, "mode")); break;
                case "muted": session.Muted(Str(c, "list")); break;
                case "advance": Need(manual, what); clock.Advance(c.GetProperty("ms").GetInt64(), Settle); break;
                case "tokens":
                    tokensOn = true;
                    tokensGive = c.GetProperty("give").GetBoolean();
                    tokensDelay = c.TryGetProperty("delay", out JsonElement d) ? d.GetInt32() : 0;
                    tokensWhy = Str(c, "why");
                    if (Str(c, "prefix").Length > 0) tokensPrefix = Str(c, "prefix");
                    break;
                case "dials": dialsFail = Str(c, "answer") == "fail"; break;
                case "admit": Sock(c).Admit(); break;
                case "refuse": Sock(c).Refuse(); break;
                case "say": Sock(c).Say(c.GetProperty("msg").GetRawText()); break;
                case "close": Sock(c).CloseFromService(); break;
                case "hear":
                {
                    var levels = new List<KeyValuePair<string, double>>();
                    foreach (JsonElement t in c.GetProperty("tones").EnumerateArray())
                        levels.Add(new KeyValuePair<string, double>(t.GetRawText(), VoiceAudio.Last == null ? 0 : VoiceAudio.Last.Hear(t.GetDouble())));
                    Emit(w =>
                    {
                        w.WriteString("ev", "heard");
                        w.WriteStartObject("levels");
                        foreach (var kv in levels) w.WriteNumber(kv.Key, kv.Value);
                        w.WriteEndObject();
                    });
                    break;
                }
                default: throw new InvalidDataException("no command " + what);
            }
        }

        static void Need(bool ok, string what)
        {
            if (!ok) throw new InvalidOperationException(what + " needs --clock manual");
        }

        static FakeSocket Sock(JsonElement c)
        {
            return sockets[c.GetProperty("n").GetInt32()];
        }

        /// <summary>Until the session has nothing left to do: only the manual loop can say.</summary>
        static void Settle()
        {
            if (manual) loop.Drain();
        }

        static void OnHost(string kind, string text)
        {
            Emit(w => { w.WriteString("ev", "host"); w.WriteString("kind", kind); w.WriteString("text", text); });
            if (kind == "token" && text == "need" && tokensOn)
            {
                // Voice.cs answers every ask, after its fetch.
                clock.CreateTimer(delegate
                {
                    if (tokensGive) session.Token(tokensPrefix + (++minted).ToString(CultureInfo.InvariantCulture), "");
                    else session.Token("", tokensWhy);
                }, null, TimeSpan.FromMilliseconds(tokensDelay), Timeout.InfiniteTimeSpan);
            }
        }

        static Task<WebSocket> FakeDial(Uri url, IReadOnlyList<string> protocols, CancellationToken stop)
        {
            int n = Interlocked.Increment(ref dialled);
            var s = new FakeSocket(n);
            sockets[n] = s;
            Emit(w =>
            {
                w.WriteString("ev", "dial");
                w.WriteNumber("n", n);
                w.WriteString("url", url.ToString());
                w.WriteStartArray("protocols");
                foreach (string p in protocols) w.WriteStringValue(p);
                w.WriteEndArray();
            });
            stop.Register(delegate { s.Dialling.TrySetCanceled(); });
            if (dialsFail) s.Refuse();
            return s.Dialling.Task;
        }

        static async Task<WebSocket> LoopbackDial(Uri url, IReadOnlyList<string> protocols, CancellationToken stop)
        {
            var b = new UriBuilder(url) { Scheme = url.Scheme == "wss" ? "ws" : url.Scheme };
            var ws = new ClientWebSocket();
            foreach (string p in protocols) ws.Options.AddSubProtocol(p);
            try
            {
                await ws.ConnectAsync(b.Uri, stop).ConfigureAwait(false);
            }
            catch
            {
                ws.Dispose();
                throw;
            }
            return ws;
        }
    }

    /// <summary>A clock that moves only when the harness says, with its timers.</summary>
    sealed class ManualClock : TimeProvider
    {
        long now = 1000000;   // milliseconds
        long order;
        readonly List<ManualTimer> timers = new List<ManualTimer>();

        public override long TimestampFrequency { get { return 1000; } }
        public override long GetTimestamp() { return now; }
        public override DateTimeOffset GetUtcNow() { return DateTimeOffset.FromUnixTimeMilliseconds(1767225600000 + now); }

        public override ITimer CreateTimer(TimerCallback callback, object state, TimeSpan dueTime, TimeSpan period)
        {
            var t = new ManualTimer(this, callback, state);
            t.Change(dueTime, period);
            return t;
        }

        /// <summary>Fires every timer due before now + ms, in order, letting the session settle after each.</summary>
        public void Advance(long ms, Action settle)
        {
            long end = now + ms;
            while (true)
            {
                ManualTimer due = null;
                foreach (ManualTimer t in timers)
                    if (t.At <= end && (due == null || t.At < due.At || (t.At == due.At && t.Order < due.Order))) due = t;
                if (due == null) break;
                now = due.At;
                if (due.Every > 0) { due.At += due.Every; due.Order = ++order; }
                else timers.Remove(due);
                due.Fire();
                settle();
            }
            now = end;
        }

        sealed class ManualTimer : ITimer
        {
            readonly ManualClock clock;
            readonly TimerCallback callback;
            readonly object state;
            public long At, Every, Order;

            public ManualTimer(ManualClock clock, TimerCallback callback, object state)
            {
                this.clock = clock;
                this.callback = callback;
                this.state = state;
            }

            public void Fire() { callback(state); }

            public bool Change(TimeSpan dueTime, TimeSpan period)
            {
                clock.timers.Remove(this);
                if (dueTime == Timeout.InfiniteTimeSpan) return true;
                At = clock.now + (long)dueTime.TotalMilliseconds;
                Every = period == Timeout.InfiniteTimeSpan ? 0 : Math.Max(1, (long)period.TotalMilliseconds);
                Order = ++clock.order;
                clock.timers.Add(this);
                return true;
            }

            public void Dispose() { clock.timers.Remove(this); }
            public ValueTask DisposeAsync() { Dispose(); return default; }
        }
    }

    /// <summary>The session's loop on the harness's own thread, run until it is empty.</summary>
    sealed class ManualLoop : VoiceLoop
    {
        readonly ConcurrentQueue<Action> jobs = new ConcurrentQueue<Action>();
        bool ended;

        public override void Add(Action job) { if (!ended) jobs.Enqueue(job); }

        public override void Finish(Action last)
        {
            Add(last);
            Drain();
            ended = true;
        }

        public void Drain()
        {
            Action job;
            while (jobs.TryDequeue(out job)) RunOne(job);
        }
    }

    /// <summary>
    /// A socket the harness answers for the voice service: its handshake is
    /// waiting until admitted or refused, what the session sends is an event,
    /// and what the service says is handed in. The harness's commands come on
    /// the driver's thread and the session reads on its own, so everything it
    /// holds is behind one lock, and a waiting read is woken outside it.
    /// </summary>
    sealed class FakeSocket : WebSocket
    {
        readonly int n;
        readonly object gate = new object();
        public readonly TaskCompletionSource<WebSocket> Dialling = new TaskCompletionSource<WebSocket>();
        readonly Queue<byte[]> inbox = new Queue<byte[]>();
        TaskCompletionSource<bool> waiting;
        WebSocketState state = WebSocketState.Connecting;
        bool closedByService, said;

        public FakeSocket(int n) { this.n = n; }

        public void Admit()
        {
            lock (gate) state = WebSocketState.Open;
            Dialling.TrySetResult(this);
        }

        public void Refuse()
        {
            lock (gate) state = WebSocketState.Closed;
            Dialling.TrySetException(new WebSocketException("refused by the harness's service"));
        }

        public void Say(string json)
        {
            TaskCompletionSource<bool> w;
            lock (gate) { inbox.Enqueue(Encoding.UTF8.GetBytes(json)); w = waiting; waiting = null; }
            if (w != null) w.TrySetResult(true);
        }

        public void CloseFromService()
        {
            TaskCompletionSource<bool> w;
            lock (gate) { closedByService = true; w = waiting; waiting = null; }
            if (w != null) w.TrySetResult(true);
        }

        void Gone()
        {
            lock (gate) { if (said) return; said = true; }
            Driver.Emit(w => { w.WriteString("ev", "closed"); w.WriteNumber("n", n); });
        }

        public override WebSocketCloseStatus? CloseStatus { get { return null; } }
        public override string CloseStatusDescription { get { return null; } }
        public override WebSocketState State { get { lock (gate) return state; } }
        public override string SubProtocol { get { return "thornswood"; } }

        public override void Abort()
        {
            TaskCompletionSource<bool> w;
            lock (gate) { state = WebSocketState.Aborted; w = waiting; waiting = null; }
            Dialling.TrySetCanceled();
            if (w != null) w.TrySetException(new WebSocketException("aborted"));
            Gone();
        }

        public override Task CloseAsync(WebSocketCloseStatus closeStatus, string statusDescription, CancellationToken cancellationToken)
        {
            Abort();
            return Task.CompletedTask;
        }

        public override Task CloseOutputAsync(WebSocketCloseStatus closeStatus, string statusDescription, CancellationToken cancellationToken)
        {
            Abort();
            return Task.CompletedTask;
        }

        public override void Dispose() { if (State != WebSocketState.Aborted) Abort(); }

        public override async Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken cancellationToken)
        {
            while (true)
            {
                Task wait;
                bool closing = false;
                lock (gate)
                {
                    if (state == WebSocketState.Aborted) throw new WebSocketException("aborted");
                    if (inbox.Count > 0)
                    {
                        byte[] m = inbox.Dequeue();
                        if (m.Length > buffer.Count) throw new InvalidDataException("a harness message longer than the session's buffer");
                        Array.Copy(m, 0, buffer.Array, buffer.Offset, m.Length);
                        return new WebSocketReceiveResult(m.Length, WebSocketMessageType.Text, true);
                    }
                    if (closedByService) { state = WebSocketState.Closed; closing = true; wait = null; }
                    else { waiting = new TaskCompletionSource<bool>(); wait = waiting.Task; }
                }
                if (closing)
                {
                    Gone();
                    return new WebSocketReceiveResult(0, WebSocketMessageType.Close, true, WebSocketCloseStatus.NormalClosure, "");
                }
                await wait;
            }
        }

        public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage, CancellationToken cancellationToken)
        {
            if (State != WebSocketState.Open) throw new WebSocketException("not open");
            string text = Encoding.UTF8.GetString(buffer.Array, buffer.Offset, buffer.Count);
            Driver.Emit(w => { w.WriteString("ev", "sent"); w.WriteNumber("n", n); w.WritePropertyName("msg"); w.WriteRawValue(text); });
            return Task.CompletedTask;
        }
    }
}
