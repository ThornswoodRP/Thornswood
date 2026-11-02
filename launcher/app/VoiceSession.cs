using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Concentus;
using Concentus.Enums;

namespace Thornswood
{
    /// <summary>
    /// Proximity voice, running in the launcher's own code. Until #4823 this
    /// was voice-host.html, a page in a hidden WebView2; this class is that
    /// page, line for line where it could be, and its comments are the
    /// page's where the reason still holds.
    ///
    /// Everything the page did used to happen inside SkyrimPlatform's in-game
    /// CEF overlay first: getUserMedia, WebRTC, the panner, playback. That
    /// browser has no permission UI, an autoplay policy that will not start
    /// audio without a click nobody can give it, and a focus flag that takes
    /// the keyboard off the game when raised. Signalling worked in there,
    /// which is why names, distances and the speaking indicator were always
    /// right. Audio never did. Then a browser in the launcher carried it, and
    /// now no browser does: the microphone and speakers are WASAPI
    /// (VoiceAudio.cs), the connections are ICE and DTLS-SRTP (VoiceIce.cs,
    /// VoicePeer.cs), the codec is Opus, and the panner and gain are our own
    /// mixer with the page's numbers (VoiceMix.cs). The voice service and its
    /// protocol are the same.
    ///
    /// The page ran on one thread, a browser's event loop, and so does this:
    /// every message, timer and connection event is a job on one queue, run
    /// in order by one thread (VoiceLoop.cs), and an await in a job comes
    /// back to that thread. Only the audio itself goes around it: the
    /// microphone's frames go from its thread to the connections, and what
    /// comes in goes from each connection to the mixer.
    /// </summary>
    sealed class VoiceSession : IDisposable
    {
        /// <summary>
        /// What the session takes from the world besides the launcher: the
        /// loop its jobs run on, the clock and its timers, the random part of
        /// each wait before a retry, and how a socket to the service is
        /// opened. The launcher runs on the real ones. tests\voice-launcher
        /// hands in a loop it runs itself, a clock it moves by hand and
        /// sockets it answers for the service, so the voice harnesses run this
        /// class itself rather than a copy of what it does, the way they ran
        /// the page's own script in a sandbox before #4823.
        /// </summary>
        internal sealed class World
        {
            public Func<VoiceLoop> Loop = delegate { return new VoiceThread(); };
            public TimeProvider Time = TimeProvider.System;
            public Func<double> Jitter = Random.Shared.NextDouble;
            public Func<Uri, IReadOnlyList<string>, CancellationToken, Task<WebSocket>> Dial = DialSocket;
        }

        /// <summary>The real socket: a ClientWebSocket offering the protocols, connected.</summary>
        static async Task<WebSocket> DialSocket(Uri url, IReadOnlyList<string> protocols, CancellationToken stop)
        {
            var ws = new ClientWebSocket();
            try
            {
                foreach (string p in protocols) ws.Options.AddSubProtocol(p);
                await ws.ConnectAsync(url, stop).ConfigureAwait(false);
                return ws;
            }
            catch
            {
                ws.Dispose();
                throw;
            }
        }

        // What the page's host(kind, text) told the launcher: status, log,
        // debug, peers, talking and token.
        readonly Action<string, string> host;
        readonly Config conf;
        readonly World world;
        readonly VoiceLoop loop;
        readonly VoiceMix mix = new VoiceMix();
        readonly IOpusEncoder encoder;
        readonly byte[] packet = new byte[1275];
        VoiceAudio audio;
        volatile bool disposed;

        public VoiceSession(Action<string, string> host, Config conf) : this(host, conf, new World()) { }

        internal VoiceSession(Action<string, string> host, Config conf, World world)
        {
            this.host = host;
            this.conf = conf;
            this.world = world;
            OpusCodecFactory.AttemptToUseNativeLibrary = false;
            encoder = OpusCodecFactory.CreateEncoder(VoiceMix.Rate, 1, OpusApplication.OPUS_APPLICATION_VOIP);
            // What a browser sends for voice: about 32 kbit/s, and in-band
            // forward error correction, so a lost packet can be rebuilt from
            // the next one (useinbandfec=1 in the description).
            encoder.Bitrate = 32000;
            encoder.UseInbandFEC = true;
            encoder.PacketLossPercent = 5;
            loop = world.Loop();
            pinger = world.Time.CreateTimer(delegate { Post(Ping); }, null,
                                            TimeSpan.FromMilliseconds(PING_EVERY), TimeSpan.FromMilliseconds(PING_EVERY));
            Post(delegate { Host("status", "waiting for config"); });
            // The HRTF data is built on the thread pool (VoiceHrtf.cs). If it
            // cannot be, every voice plays in both ears unplaced, so the log
            // says why rather than nothing.
            mix.Hrtf.ContinueWith(delegate (Task t)
            {
                if (t.IsFaulted)
                    Post(delegate { Say("the voice's 3D placement did not load (" + t.Exception.GetBaseException().Message + "), so every voice plays in both ears, unplaced"); });
            }, TaskScheduler.Default);
        }

        void Post(Action a)
        {
            if (disposed) return;
            loop.Add(a);
        }

        void Host(string kind, string text) { host(kind, text); }
        void Say(string text) { Host("log", text); }
        // Goes to launcher.log and nowhere else. The launcher has one status
        // line and it is the only thing most people ever read, so the running
        // commentary of a connection does not get to sit on it.
        void Quiet(string text) { Host("debug", text); }

        // ------------------------------------------------------------ state

        sealed class Cfg
        {
            public long ProfileId;
            public string Name = "";
            public string Token = "";
            public string Base = "";
            public string Socket = "";
        }

        sealed class Rec
        {
            public VoicePeer Pc;
            public long ProfileId;
            public string Name = "";
            public string Mode = "local";
            public bool Initiator;
            public int Restarts;
        }

        /// <summary>A row of the service's position table: where somebody is, and whether staff silenced them.</summary>
        sealed class Place
        {
            public bool HasPos;
            public double X, Y, Z;
            public double AngleZ;
            public string Cell = "";   // the raw JSON, compared as the page compared it, with !==
            public bool Hush;
        }

        Cfg cfg;
        Sock ws;
        int myPeer;
        long myProfile;
        bool talking;
        string mode = "local";
        readonly Dictionary<int, Rec> conns = new Dictionary<int, Rec>();
        Dictionary<string, Place> places = new Dictionary<string, Place>();
        readonly Dictionary<int, string> lastMode = new Dictionary<int, string>();

        /*
          Who this person has muted, by profile id.

          The mute from #133 lived only in the game's own page, and that page
          carries no audio once the launcher has it. A reviewer measured it on
          23 September: profile 123 muted in the game, standing beside you, and
          the voice page still played them at full level, because nothing there
          had ever heard of a mute. So a muted person went on being heard.

          The list comes from the server, through the game's page, the voice
          plugin and a file the launcher watches (voice-muted.txt), and arrives
          here through Muted. Place reads it before anything else.
        */
        HashSet<long> muted = new HashSet<long>();
        /* Staff silence. The service tells every connection, and the position
           row carries the same bit for a client that joins later. It closes
           this microphone and sets their level to nothing. A personal mute is
           the set above and is not this. */
        readonly HashSet<long> hushed = new HashSet<long>();

        // Read by the microphone's thread: whether to send, and to whom.
        volatile bool micLive;
        volatile VoicePeer[] live = new VoicePeer[0];
        long frames;

        void NoteHush(long pid, bool on)
        {
            if (pid == 0) return;
            if (on) hushed.Add(pid); else hushed.Remove(pid);
        }

        bool MicLive() { return talking && !hushed.Contains(myProfile); }

        void ApplyMicTrack()
        {
            bool now = MicLive();
            if (now && !micLive) foreach (VoicePeer p in live) p.NewSpurt();
            micLive = now;
            Host("talking", now ? "1" : "0");
        }

        // ----------------------------------------------------------- ranges

        const double UNITS_PER_METRE = 70;

        /*
          Whisper, local and yell, and why the level is worked out here rather
          than left to the panner.

          The three modes used to set panner.maxDistance and nothing else, and
          all three sounded identical because WebAudio's inverse distance model
          never reads maxDistance. Only the linear model does. So every voice in
          the world carried the same distance whichever mode the speaker was in,
          and changing mode moved a number nothing looked at.

          Linear is the model that would have honoured it, and it is the wrong
          shape for a voice: the volume falls at a fixed rate and then stops
          dead. So the panner places the voice and applies no distance
          attenuation of its own (rolloffFactor 0 makes the inverse model
          return 1 at every distance, VoiceMix.DistanceGain), and the level is
          worked out below from the speaker's mode.

          Three numbers per mode, metres except the last:

            full   inside this you hear them at the mode's own level
            quiet  by this you hear nothing, and between the two it fades
            level  how loud the mode is at all, because a yell across a square
                   is louder than a whisper in your ear and not only further

          Brought in on 19 September, heard in game rather than worked out here:
          the first set carried too far in all three. Whisper is cut to a third
          of what it was, local and yell to two thirds, which is what Djinn
          asked for after listening to it. The levels are untouched; it was the
          distance that was wrong, not the loudness.

          Local halved again on 20 September, asked for by Patrick after hearing
          the 19 September set in game: 2.7 and 12 become 1.35 and 6. Whisper
          and yell are left where they are, so the three modes separate more
          sharply than they did, which is the point of having three.

          Skyrim is 70 units to the metre, so a whisper dies by about 120
          units, local by about 420 and a yell by about 2100.
        */
        sealed class Range
        {
            public double Full, Quiet, Level;
        }

        static readonly Dictionary<string, Range> RANGE = new Dictionary<string, Range>
        {
            { "whisper", new Range { Full = 0.5,  Quiet = 1.7, Level = 0.85 } },
            { "local",   new Range { Full = 1.35, Quiet = 6,   Level = 1.0  } },
            { "yell",    new Range { Full = 5.3,  Quiet = 30,  Level = 1.35 } },
        };

        // How far through the fade they are, the mode's level at the near edge
        // and nothing at the far one. Squared, because halfway between the two
        // should not sound like half volume: a yell at the edge of its range is
        // meant to be a voice in the distance rather than somebody in the
        // conversation.
        public static double LevelFor(string name, double metres)
        {
            Range r;
            if (name == null || !RANGE.TryGetValue(name, out r)) r = RANGE["local"];
            if (metres <= r.Full) return r.Level;
            if (metres >= r.Quiet) return 0;
            double t = 1 - (metres - r.Full) / (r.Quiet - r.Full);
            return r.Level * t * t;
        }

        // Somebody whose name has not arrived yet is a person, not a peer id.
        static string Who(Rec rec) { return rec != null && rec.Name.Length > 0 ? rec.Name : "someone nearby"; }

        // ------------------------------------------------------- microphone

        void OpenMic()
        {
            if (audio != null) return;
            audio = new VoiceAudio(mix, conf);
            audio.OnEvent = delegate (string kind, string text) { Post(delegate { Host(kind, text); }); };
            audio.OnFrame = Frame;
            audio.Start();
        }

        /// <summary>
        /// A 20 ms frame from the microphone, on its thread. Encoded once and
        /// sent to everybody, and only while push to talk is held: the page
        /// kept its track open and disabled, which sent silence; nothing is
        /// sent here between words, and the RTP clock keeps time across them.
        /// </summary>
        void Frame(float[] pcm)
        {
            long n = Interlocked.Increment(ref frames);
            if (!micLive) return;
            VoicePeer[] to = live;
            if (to.Length == 0) return;
            int len = encoder.Encode(pcm, VoiceMix.Frame, packet, packet.Length);
            if (len <= 0) return;
            var opus = new ReadOnlySpan<byte>(packet, 0, len);
            foreach (VoicePeer p in to) p.Send(opus, n);
        }

        // ------------------------------------------------------- signalling

        /// <summary>One socket to the voice service, and the writer that keeps its messages in order.</summary>
        sealed class Sock
        {
            // Null until the handshake is answered; Stop ends a handshake
            // still waiting.
            public WebSocket Ws;
            public readonly CancellationTokenSource Stop = new CancellationTokenSource();
            public readonly Channel<string> Out = Channel.CreateUnbounded<string>();
            public bool Open;
        }

        void Send(Action<Utf8JsonWriter> write)
        {
            if (ws == null || !ws.Open) return;
            var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms))
            {
                w.WriteStartObject();
                write(w);
                w.WriteEndObject();
            }
            ws.Out.Writer.TryWrite(Encoding.UTF8.GetString(ms.ToArray()));
        }

        /*
          Where the voice service is.

          The launcher sends base and socket, https and wss. Only those are
          taken (#1304): the raw port is shut, and the service refuses a join
          token over plain ws, so falling back to it would only ever be
          refused. No secure address is no address, and voice says so.

          Two of them because they are not the same string: a base of
          https://thornswood.net/voice gives wss://thornswood.net/voice/ for
          the socket.
        */
        string VoiceBase()
        {
            string b = cfg == null ? "" : cfg.Base.TrimEnd('/');
            return b.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? b : "";
        }

        string VoiceSocket()
        {
            string s = cfg == null ? "" : cfg.Socket;
            if (s.StartsWith("wss://", StringComparison.OrdinalIgnoreCase)) return s;
            string b = VoiceBase();
            return b.Length > 0 ? "wss://" + b.Substring(8) + "/" : "";
        }

        /*
          HOW SOON TO TRY AGAIN, AND HOW TO TELL THE SERVER IS GONE. Issues
          #409, #519.

          On 21 September the voice page opened the socket 592 times, every two
          seconds, and launcher.log has both halves of why. From 19:09 the
          Wi-Fi was down and the machine slept at 19:39: 425 tries that never
          opened. It woke at 20:06 holding a join token from 19:02, which had
          expired at 20:02; the service refused it and closed, and the page
          never read the refusal, so it came straight back with the same token
          every two seconds: 134 tries that opened and were shut in the same
          second, until the launcher's own renewal got through at 20:11. A two
          second retry has no reason to stop.

          So each try waits longer than the one before, from two seconds to a
          minute, and never exactly as long as anybody else's, so a service
          restart does not bring every launcher back in the same instant. It
          goes back to two seconds only once the service has let us in.

          And every try has a token of its own (#1322). A token opens one
          connection and the service refuses a handshake without one (#1337),
          so each try asks the launcher for a fresh one ('token') and spends it
          on that try, whatever comes of it. A refused handshake looks here
          like any other lost connection, so the backoff is what holds it down;
          the launcher always answers, and an empty answer waits for the clock.

          And voice listens for the server. A WebSocket's own pings are
          answered without anybody seeing them, so a socket that went half open
          during a sleep or a change of network looked exactly like a quiet
          room. Every twenty five seconds this sends { t: 'ping' }, the service
          answers { t: 'pong' }, and seventy seconds with nothing at all from
          it is a lost connection, dealt with like any other.
        */
        const int RETRY_FIRST = 2000, RETRY_MOST = 60000;
        const int PING_EVERY = 25000, SILENT_AFTER = 70000;
        int tries;
        ITimer retry;
        long heard;
        bool asking;
        readonly ITimer pinger;

        int RetryIn()
        {
            double cap = Math.Min(RETRY_MOST, RETRY_FIRST * Math.Pow(2, Math.Min(tries, 10)));
            tries++;
            return (int)Math.Round(cap / 2 + world.Jitter() * cap / 2);
        }

        void Later(int ms)
        {
            if (retry != null) retry.Dispose();
            ITimer t = null;
            t = world.Time.CreateTimer(delegate { Post(delegate { if (retry != t) return; retry = null; Connect(); }); }, null,
                                       TimeSpan.FromMilliseconds(ms), Timeout.InfiniteTimeSpan);
            retry = t;
        }

        // Milliseconds on a clock that only goes forward.
        long Now() { return world.Time.GetTimestamp() * 1000 / world.Time.TimestampFrequency; }

        void Ping()
        {
            if (ws == null || !ws.Open || myPeer == 0) return;
            long quiet = Now() - heard;
            if (quiet > SILENT_AFTER)
            {
                Say("nothing from the voice server for " + Math.Round(quiet / 1000.0).ToString(CultureInfo.InvariantCulture) +
                    " s, so looking for it again");
                Sock dead = ws;
                ws = null;
                Close(dead);
                Lost();
                return;
            }
            Send(delegate (Utf8JsonWriter w) { w.WriteString("t", "ping"); });
        }

        /* The socket is gone, however it went. */
        void Lost()
        {
            Host("status", "disconnected");
            foreach (int id in new List<int>(conns.Keys)) Drop(id);
            myPeer = 0;
            Later(RetryIn());
        }

        static void Close(Sock s)
        {
            s.Out.Writer.TryComplete();
            s.Stop.Cancel();
            if (s.Ws == null) return;
            s.Ws.Abort();
            s.Ws.Dispose();
        }

        /*
          Where to look for each other. The service hands the list over on every
          roster (#1821), which is when connections are built, over the socket
          its join token proved, so the relay comes with it when one is set.
          STUN until the first roster.

          This was a Google STUN server written into three separate pages. STUN
          alone only works when both ends can be reached once they know where
          to look; behind a symmetric NAT, some mobile networks and a lot of
          corporate ones, they cannot, and that pair of people never hear each
          other while everybody else sounds fine. TURN fixes it and needs a
          relay, which is why the service hands the list out.
        */
        List<IceServer> ICE = IceServer.From(new[] { "stun:stun.l.google.com:19302" }, "", "", null);
        string iceSaid = "";

        void TakeIce(JsonElement list)
        {
            if (list.ValueKind != JsonValueKind.Array || list.GetArrayLength() == 0) return;
            var next = new List<IceServer>();
            var skipped = new List<string>();
            foreach (JsonElement s in list.EnumerateArray())
            {
                if (s.ValueKind != JsonValueKind.Object) continue;
                var urls = new List<string>();
                JsonElement u;
                if (s.TryGetProperty("urls", out u))
                {
                    if (u.ValueKind == JsonValueKind.String) urls.Add(u.GetString());
                    else if (u.ValueKind == JsonValueKind.Array)
                        foreach (JsonElement x in u.EnumerateArray()) if (x.ValueKind == JsonValueKind.String) urls.Add(x.GetString());
                }
                next.AddRange(IceServer.From(urls, Str(s, "username"), Str(s, "credential"), skipped));
            }
            if (next.Count == 0) return;
            ICE = next;
            // Said when it changes, not on every roster.
            bool relay = false;
            foreach (IceServer s in ICE) if (s.Turn) relay = true;
            string line = "ice: " + ICE.Count + " server(s), relay " + (relay ? "yes" : "no") +
                          (skipped.Count > 0 ? ", left out " + string.Join(" ", skipped) + " (voice relays over UDP only)" : "");
            if (line != iceSaid) { iceSaid = line; Say(line); }
        }

        void Connect()
        {
            if (retry != null) { retry.Dispose(); retry = null; }
            if (cfg == null) return;

            // A second config (a new character on Play) calls this with the
            // first socket still open. Left there, the service keeps both as
            // peers, this side takes its own old peer for somebody nearby, and
            // offers for one person arrive on both sockets into the same
            // connection. It is taken out of ws before it is closed, so its
            // close is nobody's lost connection.
            if (ws != null)
            {
                Sock old = ws;
                ws = null;
                Close(old);
                foreach (int id in new List<int>(conns.Keys)) Drop(id);
                myPeer = 0;
            }

            // No token of its own yet: ask, and the answer calls this again.
            if (cfg.Token.Length == 0)
            {
                if (!asking) { asking = true; Host("token", "need"); }
                return;
            }
            string token = cfg.Token;
            cfg.Token = "";

            string url = VoiceSocket();
            if (url.Length == 0)
            {
                // Nothing to spend the token on: it stays for when a config
                // with an address arrives, which calls this again.
                cfg.Token = token;
                Say("the launcher gave no secure voice address, so voice is off");
                return;
            }
            Say("connecting to " + url + (tries > 0 ? " (try " + (tries + 1) + ")" : ""));

            // The token goes with the handshake, as the protocol after
            // 'thornswood', and is what says who we are (#1337). It is never
            // in the url, which is written to the launcher's log.
            var s = new Sock();
            ws = s;
            _ = Pump(s, new Uri(url), new[] { "thornswood", token });
        }

        /// <summary>
        /// The socket's life: the handshake, then each message as it comes,
        /// until it closes. It runs on the voice thread, and each await comes
        /// back to it (VoiceLoop), so a message is handled in order with every
        /// other job. A socket that is no longer ws was closed by this side
        /// (Connect, Ping, Dispose), and nothing it still says is read.
        /// </summary>
        async Task Pump(Sock s, Uri url, string[] protocols)
        {
            try { s.Ws = await world.Dial(url, protocols, s.Stop.Token); }
            catch (Exception e)
            {
                if (ws != s) return;
                Quiet("the voice server did not answer (" + e.Message + ")");
                ws = null;
                Lost();
                return;
            }
            // Closed while the handshake was still on its way: nobody holds it now.
            if (ws != s) { s.Ws.Abort(); s.Ws.Dispose(); return; }
            Opened(s);
            _ = Write(s);

            var buf = new byte[64 * 1024];
            var acc = new MemoryStream();
            try
            {
                while (ws == s)
                {
                    WebSocketReceiveResult r = await s.Ws.ReceiveAsync(buf, CancellationToken.None);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    acc.Write(buf, 0, r.Count);
                    if (!r.EndOfMessage) continue;
                    string text = Encoding.UTF8.GetString(acc.GetBuffer(), 0, (int)acc.Length);
                    acc.SetLength(0);
                    if (ws == s) Message(text);
                }
            }
            catch (Exception e) { if (ws == s) Quiet("the voice server's socket closed (" + e.Message + ")"); }
            if (ws != s) return;
            ws = null;
            Close(s);
            Lost();
        }

        /// <summary>
        /// What Send queued, one message at a time, as a WebSocket needs its
        /// sends to be.
        /// </summary>
        async Task Write(Sock s)
        {
            try
            {
                while (await s.Out.Reader.WaitToReadAsync())
                {
                    string m;
                    while (s.Out.Reader.TryRead(out m))
                        await s.Ws.SendAsync(Encoding.UTF8.GetBytes(m), WebSocketMessageType.Text, true, CancellationToken.None);
                }
            }
            catch (Exception e) { if (ws == s) Quiet("could not write to the voice server (" + e.Message + ")"); }
        }

        void Opened(Sock s)
        {
            s.Open = true;
            heard = Now();
            // profileId and name are our word; the service takes who this is
            // from the token and only writes down a profileId that disagrees.
            Send(delegate (Utf8JsonWriter w)
            {
                w.WriteString("t", "join");
                w.WriteNumber("profileId", cfg.ProfileId);
                w.WriteString("name", cfg.Name);
                w.WriteString("mode", mode);
            });
            Host("status", "connected");
        }

        static string Str(JsonElement o, string name)
        {
            JsonElement v;
            if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out v)) return "";
            if (v.ValueKind == JsonValueKind.String) return v.GetString();
            if (v.ValueKind == JsonValueKind.Number) return v.GetRawText();
            return "";
        }

        static double Num(JsonElement o, string name)
        {
            JsonElement v;
            if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out v)) return 0;
            double d;
            if (v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out d)) return d;
            if (v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
            if (v.ValueKind == JsonValueKind.True) return 1;
            return 0;
        }

        static bool Truthy(JsonElement o, string name)
        {
            JsonElement v;
            if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out v)) return false;
            switch (v.ValueKind)
            {
                case JsonValueKind.True: return true;
                case JsonValueKind.Number: return v.GetDouble() != 0;
                case JsonValueKind.String: return v.GetString().Length > 0;
                case JsonValueKind.Object: case JsonValueKind.Array: return true;
                default: return false;
            }
        }

        void Message(string text)
        {
            heard = Now();
            JsonDocument doc;
            try { doc = JsonDocument.Parse(text); }
            catch (JsonException e) { Quiet("the voice server sent something that is not JSON (" + e.Message + ")"); return; }
            using (doc)
            {
                JsonElement m = doc.RootElement;
                string t = Str(m, "t");
                if (t == "pong") return;
                // In, so the next loss starts again from two seconds.
                if (t == "welcome")
                {
                    myPeer = (int)Num(m, "peer");
                    myProfile = cfg.ProfileId;
                    tries = 0;
                    Send(delegate (Utf8JsonWriter w) { w.WriteString("t", "talk"); w.WriteBoolean("on", talking); });
                    return;
                }
                if (t == "peers")
                {
                    JsonElement ice, peers;
                    if (m.TryGetProperty("iceServers", out ice)) TakeIce(ice);
                    OnPeers(m.TryGetProperty("peers", out peers) && peers.ValueKind == JsonValueKind.Array ? peers : default(JsonElement));
                    return;
                }
                // The whole view on the first tick after a join, then only what
                // moved and who left it (issue #482; the note over the tick in
                // voice-server.js).
                if (t == "pos") { places = new Dictionary<string, Place>(); ApplyRows(m); Placed(); ApplyMicTrack(); return; }
                if (t == "moved")
                {
                    ApplyRows(m);
                    JsonElement gone;
                    if (m.TryGetProperty("gone", out gone) && gone.ValueKind == JsonValueKind.Array)
                        foreach (JsonElement g in gone.EnumerateArray()) places.Remove(g.ValueKind == JsonValueKind.String ? g.GetString() : g.GetRawText());
                    Placed();
                    ApplyMicTrack();
                    return;
                }
                if (t == "hush") { NoteHush((long)Num(m, "profileId"), Truthy(m, "on")); Placed(); ApplyMicTrack(); return; }
                if (t == "sdp") { OnSdp(m); return; }
                if (t == "ice") { OnIce(m); return; }
                if (t == "vmode")
                {
                    int from = (int)Num(m, "from");
                    // A mode can arrive before the connection it belongs to, so
                    // it is kept by peer as well: a whisper announced during
                    // the handshake used to be dropped and the speaker was
                    // heard at local range until they changed mode again.
                    string md = Str(m, "mode");
                    lastMode[from] = md;
                    Rec r;
                    if (conns.TryGetValue(from, out r)) { r.Mode = md; Placed(); }
                    return;
                }
            }
        }

        /* The rows of a 'pos' or 'moved' tick: each replaces its own, and the
           staff silence it carries is noted. */
        void ApplyRows(JsonElement m)
        {
            JsonElement who;
            if (!m.TryGetProperty("who", out who) || who.ValueKind != JsonValueKind.Object) return;
            foreach (JsonProperty row in who.EnumerateObject())
            {
                JsonElement v = row.Value;
                var p = new Place();
                JsonElement pos;
                if (v.ValueKind == JsonValueKind.Object && v.TryGetProperty("pos", out pos) &&
                    pos.ValueKind == JsonValueKind.Array && pos.GetArrayLength() >= 3)
                {
                    p.HasPos = true;
                    p.X = Coord(pos[0]); p.Y = Coord(pos[1]); p.Z = Coord(pos[2]);
                }
                p.AngleZ = Num(v, "angleZ");
                JsonElement cell;
                p.Cell = v.ValueKind == JsonValueKind.Object && v.TryGetProperty("cell", out cell) ? cell.GetRawText() : "";
                p.Hush = Truthy(v, "hush");
                places[row.Name] = p;
                long pid;
                if (long.TryParse(row.Name, NumberStyles.Integer, CultureInfo.InvariantCulture, out pid)) NoteHush(pid, p.Hush);
            }
        }

        static double Coord(JsonElement e)
        {
            double d;
            return e.ValueKind == JsonValueKind.Number && e.TryGetDouble(out d) ? d : 0;
        }

        void OnPeers(JsonElement list)
        {
            var seen = new HashSet<int>();
            if (list.ValueKind == JsonValueKind.Array)
            {
                foreach (JsonElement p in list.EnumerateArray())
                {
                    int peer = (int)Num(p, "peer");
                    if (peer == myPeer) continue;
                    // A game chat socket whose launcher holds the audio says it
                    // carries no voice. Its overlay answers nothing, so a
                    // connection to it waited on its offer for good and counted
                    // in the peers reported. None is built, and one that was is
                    // dropped below as if they had left (#1925).
                    JsonElement voice;
                    if (p.TryGetProperty("voice", out voice) && voice.ValueKind == JsonValueKind.False) continue;
                    seen.Add(peer);
                    string md = Str(p, "mode");
                    if (md.Length > 0) lastMode[peer] = md;
                    Rec had;
                    if (conns.TryGetValue(peer, out had))
                    {
                        if (md.Length > 0) had.Mode = md;
                        had.ProfileId = (long)Num(p, "profileId");
                        had.Name = Str(p, "name");
                        continue;
                    }
                    // Only the lower peer id offers, so two offers never cross on a new pair.
                    Open(peer, (long)Num(p, "profileId"), Str(p, "name"), md, myPeer < peer);
                }
            }
            foreach (int id in new List<int>(conns.Keys)) if (!seen.Contains(id)) Drop(id);
            Host("peers", conns.Count.ToString(CultureInfo.InvariantCulture));
        }

        void Open(int id, long profileId, string name, string md, bool initiator)
        {
            string remembered;
            lastMode.TryGetValue(id, out remembered);
            var rec = new Rec
            {
                ProfileId = profileId,
                Name = name ?? "",
                Mode = md.Length > 0 ? md : (remembered ?? "local"),
                Initiator = initiator
            };
            conns[id] = rec;
            // Starts at full level, as a gain node did, unless somebody already
            // muted starts silent instead: the next position is up to a fifth
            // of a second away.
            mix.Add(id, muted.Contains(profileId) || hushed.Contains(profileId));
            Build(id, rec);
            Placed();
        }

        /// <summary>
        /// A connection for this record, new or again after a failure, and the
        /// offer when this side is the one that offers.
        /// </summary>
        void Build(int id, Rec rec)
        {
            if (rec.Pc != null) rec.Pc.Dispose();
            var pc = new VoicePeer(id, rec.Initiator, mix);
            rec.Pc = pc;
            pc.Debug = delegate (string m) { Post(delegate { Quiet(m); }); };
            pc.OnCandidate = delegate (string line)
            {
                Post(delegate
                {
                    if (rec.Pc != pc) return;
                    Send(delegate (Utf8JsonWriter w)
                    {
                        w.WriteString("t", "ice");
                        w.WriteNumber("to", id);
                        w.WriteStartObject("candidate");
                        w.WriteString("candidate", line);
                        w.WriteString("sdpMid", "0");
                        w.WriteNumber("sdpMLineIndex", 0);
                        w.WriteString("usernameFragment", pc.LocalUfrag);
                        w.WriteEndObject();
                    });
                });
            };
            pc.OnState = delegate (string st) { Post(delegate { IceState(id, rec, pc, st); }); };
            pc.OnAudio = delegate { Post(delegate { if (rec.Pc == pc) Say("receiving from " + Who(rec)); }); };
            Live();
            pc.Gather(ICE);
            if (!rec.Initiator) return;
            try
            {
                string sdp = pc.Description();
                SendSdp(id, "offer", sdp);
            }
            catch (Exception e) { Say("offer failed: " + e.Message); }
        }

        void SendSdp(int id, string type, string sdp)
        {
            Send(delegate (Utf8JsonWriter w)
            {
                w.WriteString("t", "sdp");
                w.WriteNumber("to", id);
                w.WriteStartObject("sdp");
                w.WriteString("type", type);
                w.WriteString("sdp", sdp);
                w.WriteEndObject();
            });
        }

        void Live()
        {
            var l = new List<VoicePeer>();
            foreach (Rec r in conns.Values) if (r.Pc != null) l.Add(r.Pc);
            live = l.ToArray();
        }

        void IceState(int id, Rec rec, VoicePeer pc, string st)
        {
            if (rec.Pc != pc) return;
            Quiet("peer " + id + " (" + (rec.Name.Length > 0 ? rec.Name : "no name yet") + ") is " + st);
            if (st != "failed") return;
            if (rec.Restarts >= 1)
            {
                // The launcher puts "Voice: " on the front of anything this sends.
                Say("could not reach " + Who(rec) + ". One of you is behind a router " +
                    "that will not let the two of you talk directly.");
                return;
            }
            rec.Restarts++;
            Quiet("peer " + id + " failed, trying again");
            // Again from the start, with a new ICE username and password: the
            // side that offers makes a new offer, and the side that answers
            // takes it as a new connection (OnSdp). DTLS starts again too.
            if (rec.Initiator) Build(id, rec);
        }

        static string UfragOf(string sdp)
        {
            foreach (string raw in (sdp ?? "").Split('\n'))
            {
                string l = raw.TrimEnd('\r');
                if (l.StartsWith("a=ice-ufrag:", StringComparison.Ordinal)) return l.Substring(12).Trim();
            }
            return "";
        }

        void OnSdp(JsonElement m)
        {
            Rec rec;
            // Never a peer still to be opened (#1869): the service writes the
            // roster that names somebody to this socket before anything they
            // send it, and OnPeers opens everybody on a roster before the next
            // message is read. So this only turns away what was still on its
            // way from a peer that has since left or said it carries no voice
            // (#1925).
            int from = (int)Num(m, "from");
            if (!conns.TryGetValue(from, out rec)) return;
            JsonElement d;
            if (!m.TryGetProperty("sdp", out d) || d.ValueKind != JsonValueKind.Object) return;
            string type = Str(d, "type");
            string sdp = Str(d, "sdp");
            try
            {
                if (type == "offer")
                {
                    // Only the lower id offers, so an offer to the side that
                    // offers is a collision, and this side does not give way.
                    if (rec.Initiator) return;
                    string ufrag = UfragOf(sdp);
                    if (rec.Pc.RemoteUfrag.Length > 0 && rec.Pc.RemoteUfrag != ufrag) Build(from, rec);
                    if (rec.Pc.RemoteUfrag != ufrag) rec.Pc.SetRemote(sdp);
                    SendSdp(from, "answer", rec.Pc.Description());
                    return;
                }
                if (type == "answer")
                {
                    if (!rec.Initiator || rec.Pc.RemoteUfrag.Length > 0) return;
                    rec.Pc.SetRemote(sdp);
                }
            }
            catch (Exception e) { Say("sdp failed: " + e.Message); }
        }

        void OnIce(JsonElement m)
        {
            Rec rec;
            // As in OnSdp: never a peer still to be opened.
            if (!conns.TryGetValue((int)Num(m, "from"), out rec)) return;
            JsonElement c;
            if (!m.TryGetProperty("candidate", out c) || c.ValueKind != JsonValueKind.Object) return;
            string ufrag = Str(c, "usernameFragment");
            rec.Pc.AddCandidate(Str(c, "candidate"), ufrag.Length > 0 ? ufrag : null);
        }

        void Drop(int id)
        {
            Rec rec;
            if (!conns.TryGetValue(id, out rec)) return;
            conns.Remove(id);
            if (rec.Pc != null) rec.Pc.Dispose();
            mix.Remove(id);
            lastMode.Remove(id);
            Live();
            Host("peers", conns.Count.ToString(CultureInfo.InvariantCulture));
        }

        // ------------------------------------------------------------ place

        /// <summary>The page's place(): every connection's level and direction from the latest positions.</summary>
        void Placed()
        {
            Place me;
            if (!places.TryGetValue(myProfile.ToString(CultureInfo.InvariantCulture), out me) || !me.HasPos)
            {
                // Nowhere to measure from, so distance is left as it was. A
                // mute is not a distance and does not wait for one.
                foreach (KeyValuePair<int, Rec> kv in conns)
                    if (muted.Contains(kv.Value.ProfileId) || hushed.Contains(kv.Value.ProfileId)) { mix.SetLevel(kv.Key, 0); mix.SetAudible(kv.Key, false); }
                return;
            }
            double rad = me.AngleZ * Math.PI / 180;
            double cos = Math.Cos(rad), sin = Math.Sin(rad);

            foreach (KeyValuePair<int, Rec> kv in conns)
            {
                int id = kv.Key;
                Rec rec = kv.Value;
                // Muted beats distance: somebody standing next to you and muted is silent.
                Place them;
                places.TryGetValue(rec.ProfileId.ToString(CultureInfo.InvariantCulture), out them);
                if (muted.Contains(rec.ProfileId) || hushed.Contains(rec.ProfileId) || (them != null && them.Hush))
                {
                    mix.SetLevel(id, 0); mix.SetAudible(id, false); continue;
                }
                mix.SetAudible(id, true);
                // A wall is not a distance. Another cell is silence whatever the maths says.
                if (them == null || !them.HasPos || them.Cell != me.Cell) { mix.SetLevel(id, 0); continue; }

                double dx = them.X - me.X;
                double dy = them.Y - me.Y;
                double dz = them.Z - me.Z;

                // Skyrim's angle is a compass bearing, so rotate the world into
                // the listener's frame rather than moving the listener.
                double forward = (dy * cos + dx * sin) / UNITS_PER_METRE;
                double right = (dx * cos - dy * sin) / UNITS_PER_METRE;
                double up = dz / UNITS_PER_METRE;

                // Their mode, not ours: you decide how far your own voice
                // carries and everybody else hears the result at whatever
                // range that choice reaches.
                double metres = Math.Sqrt(right * right + forward * forward + up * up);
                mix.SetLevel(id, LevelFor(rec.Mode, metres));

                // Web Audio looked down -z, so what is in front is negative.
                mix.SetPosition(id, right, up, -forward);
            }
        }

        // ------------------------------------------------ the launcher talks

        /// <summary>The launcher's config: who this is, where the service is, and a join token.</summary>
        public void Configure(long profileId, string name, string token, string vbase, string vsocket)
        {
            Post(delegate
            {
                cfg = new Cfg { ProfileId = profileId, Name = name ?? "", Token = token ?? "", Base = vbase ?? "", Socket = vsocket ?? "" };
                myProfile = cfg.ProfileId;
                Say("configured as profile " + cfg.ProfileId + (cfg.Token.Length > 0 ? "" : ", with no join token"));
                OpenMic();
                Connect();
            });
        }

        /*
          The launcher's answer to 'token': a fresh join token for the try that
          is waiting on it, or none and why. None waits for the backoff, and the
          next try asks again (#1322).
        */
        public void Token(string token, string why)
        {
            Post(delegate
            {
                asking = false;
                if (cfg == null) return;
                cfg.Token = token ?? "";
                if (cfg.Token.Length > 0)
                {
                    if (ws == null) Connect();
                }
                else
                {
                    int wait = RetryIn();
                    Say("no join token from the launcher (" + (string.IsNullOrEmpty(why) ? "it did not say why" : why) +
                        "), so trying again in " + Math.Round(wait / 1000.0).ToString(CultureInfo.InvariantCulture) + " s");
                    Later(wait);
                }
            });
        }

        public void Ptt(bool on)
        {
            Post(delegate
            {
                talking = on;
                ApplyMicTrack();
                Send(delegate (Utf8JsonWriter w) { w.WriteString("t", "talk"); w.WriteBoolean("on", talking); });
            });
        }

        public void Mode(string m)
        {
            Post(delegate
            {
                mode = string.IsNullOrEmpty(m) ? "local" : m;
                Send(delegate (Utf8JsonWriter w) { w.WriteString("t", "vmode"); w.WriteString("mode", mode); });
            });
        }

        /*
          The mute list, as the line the game wrote: profile ids with spaces
          between. The whole list every time, never a change to it, so a
          message that is missed is put right by the next one. Anything that is
          not a profile id is dropped rather than trusted.
        */
        public void Muted(string list)
        {
            Post(delegate
            {
                var next = new HashSet<long>();
                foreach (string s in (list ?? "").Split((char[])null, StringSplitOptions.RemoveEmptyEntries))
                {
                    long n;
                    if (long.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out n) && n > 0) next.Add(n);
                }
                muted = next;
                Placed();
            });
        }

        public void Dispose()
        {
            if (disposed) return;
            loop.Finish(delegate
            {
                if (retry != null) { retry.Dispose(); retry = null; }
                foreach (int id in new List<int>(conns.Keys)) Drop(id);
                if (ws != null) { Sock s = ws; ws = null; Close(s); }
            });
            disposed = true;
            pinger.Dispose();
            if (audio != null) audio.Dispose();
            encoder.Dispose();
        }
    }
}
