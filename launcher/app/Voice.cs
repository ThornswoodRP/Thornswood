using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// Proximity voice, moved out of the game and into the launcher.
    ///
    /// Everything here exists because of where the audio used to run. The voice
    /// page lived inside SkyrimPlatform's in-game CEF overlay, which is a
    /// browser with no permission UI, an autoplay policy that refuses to start
    /// playback without a click nobody can give it, and a focus flag that takes
    /// the keyboard away from the game. Positions, names and distances all
    /// worked there, because that is signalling. Audio never once did.
    ///
    /// Another server does not do it that way. Their in-game voice service only tracks
    /// push to talk, the socket and the HUD, and reports a launcher status of
    /// connected / micOk / talking. The microphone and the audio pipeline live
    /// in their launcher, which is Electron and therefore a real browser.
    ///
    /// This launcher held its audio in a hidden WebView2 page until #4823
    /// (voice-host.html), which needed Edge's runtime on the machine and, for
    /// its audio, the Windows Media components the N editions of Windows do
    /// not have. It has no browser now. VoiceSession.cs is that page in C#,
    /// with the same protocol to the same voice service: the microphone and
    /// speakers through WASAPI (VoiceAudio.cs), the connections through ICE
    /// and DTLS-SRTP (VoiceIce.cs, VoicePeer.cs), Opus through Concentus, and
    /// the page's panner and gain in our own mixer (VoiceMix.cs). This class
    /// is what it always was: the launcher's side, which hands voice its
    /// config and join tokens, and carries push to talk, the mute list and
    /// the status between voice and the game.
    /// </summary>
    static class Voice
    {
        static VoiceSession session;
        static Action<string> logger = delegate { };

        /// <summary>
        /// Straight to launcher.log, never to the status line.
        ///
        /// Voice reports things that matter when voice is broken and
        /// matter to nobody the rest of the time: which stage of the connection
        /// each pair of people is at, several times a minute, named by peer id.
        /// That belongs in the file somebody sends me when it goes wrong, not on
        /// the one line they are actually reading.
        /// </summary>
        static void Quiet(string m)
        {
            try
            {
                // One line at a time: the voice thread, the token fetches and
                // the file channel all write here, and two appends at once
                // collide on the file.
                lock (quietLock)
                {
                    File.AppendAllText(Paths.LogFile,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + m + Environment.NewLine);
                }
            }
            catch (Exception ex) { Swallow.Note("Voice.Quiet, log", ex); }
        }

        static readonly object quietLock = new object();

        /// <summary>
        /// Every line goes through here, and this is not tidiness.
        ///
        /// The launcher's Log writes to a control in the window, so calling it
        /// from any thread but the window's throws. Almost everything here runs
        /// off that thread: the voice thread, the token fetches and the push to
        /// talk listener. An unhandled exception on a threadpool thread does not
        /// show a dialog or write a line, it takes the whole process down
        /// without a word, which is a launcher that opens and vanishes a few
        /// seconds later with a log that simply stops. So a line from anywhere
        /// else is handed to the window's thread (Avalonia's dispatcher).
        /// </summary>
        static void Say(string m)
        {
            try
            {
                var d = Avalonia.Threading.Dispatcher.UIThread;
                if (!d.CheckAccess())
                {
                    d.Post(delegate
                    {
                        try { logger(m); } catch (Exception ex) { Swallow.Note("Voice.Say, invoke logger", ex); }
                    });
                    return;
                }
                logger(m);
            }
            catch (Exception ex) { Swallow.Note("Voice.Say", ex); }
        }

        // Held by reference, not copied. The launcher rewrites these in place
        // when version.json says the server moved, and voice should follow.
        static Config conf;
        static string lastPeers = "", lastStatus = "";

        // What the game's indicator asks about. It has no microphone and no
        // peer connections any more, so the only honest answer comes from here.
        static volatile bool micOk;
        static volatile bool talking;
        static volatile int peerCount;
        static volatile string voiceMode = "local";

        static bool started;

        /// <summary>
        /// Ends voice on the way out: every connection closed, the relay's
        /// addresses handed back, the microphone and speakers let go.
        /// </summary>
        public static void Stop()
        {
            try
            {
                if (session != null) { session.Dispose(); session = null; }
            }
            catch (Exception ex) { Swallow.Note("Voice.Stop, session", ex); }
        }

        /// <summary>
        /// Bring voice up. Safe to call more than once, and from any thread:
        /// nothing here needs the window.
        /// Returns quietly on any failure: a launcher that will not open
        /// because voice did not start is a worse outcome than silent voice.
        /// </summary>
        public static void Start(Action<string> log, Config config)
        {
            if (started) return;
            started = true;
            conf = config;
            logger = log;

            try
            {
                session = new VoiceSession(OnSessionEvent, config);
                Say("Voice: up, in the launcher (no browser)");
                StartPttListener(log);
                StartFileChannel(log);
                Configure(log);
            }
            catch (Exception ex)
            {
                Say("Voice: did not start: " + ex.Message);
            }
        }

        /// <summary>
        /// The profile id has to be the one the game uses or nobody is matched
        /// to their own character, so it is read from the same file the game
        /// reads rather than worked out again here.
        ///
        /// Unless Reconfigure(int) has said otherwise. Since 20 September the
        /// settings file holds the id played last and the person picks at the
        /// game's menu, so once the choice file names somebody the file is
        /// stale and the number Shell hands over is the truth. The file is
        /// never rewritten while the game runs (it hot reloads every plugin),
        /// which is why this cannot simply read it again.
        /// </summary>
        static long profileOverride;

        static long ProfileId()
        {
            if (profileOverride > 0) return profileOverride;
            try
            {
                string f = Path.Combine(Paths.Game, "Data\\Platform\\Plugins\\skymp5-client-settings.txt");
                if (!File.Exists(f)) return 0;
                Match m = Regex.Match(File.ReadAllText(f), "\"profileId\"\\s*:\\s*(\\d+)");
                if (!m.Success) return 0;
                return long.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
            }
            catch { return 0; }
        }

        /// <summary>
        /// A short lived token saying which profile this launcher may join as.
        /// </summary>
        /// <remarks>
        /// The voice port used to believe whatever the join message said its
        /// profile was, and that number is the whole of somebody's identity
        /// here. Anybody who could reach the port was anybody they liked: they
        /// heard every conversation in the world, spoke as somebody else, and
        /// read every person's position off the roster.
        ///
        /// The Discord ticket is what proves anything. The voice service asks
        /// the site whether that ticket owns this profile and signs the answer,
        /// and voice sends what comes back instead of a bare number.
        ///
        /// Empty on any failure, deliberately. The service refuses a
        /// connection without one (#1303, #1337), so this is the difference
        /// between voice and no voice, and the caller says which.
        ///
        /// One token opens one connection and is good for two minutes
        /// (#1322), so this is called for each connection, just before it
        /// opens: PageToken for the launcher's voice, PassTokenAsk for the game.
        /// </remarks>
        static string FetchToken(string host, string port, long profile, Action<string> log)
        {
            string ticket = "";
            try { ticket = Discord.Ticket; } catch { ticket = ""; }
            if (ticket == null) ticket = "";
            if (ticket.Length == 0)
            {
                if (log != null) log("Voice: not linked to Discord, so no join token. Voice may be refused.");
                return "";
            }

            // Through Caddy, the only way in (#1304). With no config yet there
            // is no address at all, so no token.
            if (conf == null)
            {
                if (log != null) log("Voice: no voice address yet, so no join token.");
                return "";
            }
            string url = conf.VoiceBase() + "/token";

            // The ticket only ever goes over https (To Do 144). It is a thirty
            // day credential, as good as this person's Discord account to the
            // site, and it sits under DPAPI on disk; every other place that
            // sends it goes to Discord.Site, which is https. This one follows
            // VoiceBase, which fell back to http://address:port whenever
            // VoiceUrl was empty: a new install until its first update check
            // had filled it in, and the rollback the feed could order by
            // sending voiceUrl empty. Both would have posted the ticket here in
            // the clear. VoiceBase is always https since #1304, and this check
            // stays so nothing but https ever carries the ticket.
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                if (log != null) log("Voice: no join token, because the voice address is not https and the Discord ticket only goes over https. Voice may be refused.");
                return "";
            }

            string body = "{\"profileId\":" + profile.ToString(CultureInfo.InvariantCulture) +
                          ",\"ticket\":\"" + JsonEscape(ticket) + "\"}";
            try
            {
                using (var req = new HttpRequestMessage(HttpMethod.Post, url))
                {
                    req.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    using (HttpResponseMessage resp = TokenHttp.Send(req))
                    {
                        if (resp.StatusCode == HttpStatusCode.Forbidden)
                        {
                            if (log != null) log("Voice: the server says this Discord account does not own profile " + profile + ".");
                            return "";
                        }
                        if (!resp.IsSuccessStatusCode)
                        {
                            if (log != null) log("Voice: could not get a join token (the server answered " + (int)resp.StatusCode + ").");
                            return "";
                        }
                        string text;
                        using (var r = new StreamReader(resp.Content.ReadAsStream(), Encoding.UTF8))
                        {
                            text = r.ReadToEnd();
                        }
                        Match m = Regex.Match(text, "\"token\"\\s*:\\s*\"([^\"]+)\"");
                        if (!m.Success)
                        {
                            if (log != null) log("Voice: the service answered without a token.");
                            return "";
                        }
                        // Never the token itself. It is what somebody would need to
                        // join as this person, and the log is a file on disk.
                        if (log != null) log("Voice: got a join token for profile " + profile);
                        return m.Groups[1].Value;
                    }
                }
            }
            catch (Exception e)
            {
                if (log != null) log("Voice: could not get a join token (" + e.Message + ").");
                return "";
            }
        }

        /// <summary>
        /// One client for every token fetch, with the five seconds the old
        /// request had, in place of a client per fetch.
        /// </summary>
        static readonly HttpClient TokenHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

        /// <summary>Quote anything that would end a JSON string early.</summary>
        static string JsonEscape(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var b = new StringBuilder(s.Length + 8);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
                else if (c < ' ') { b.Append(' '); }
                else { b.Append(c); }
            }
            return b.ToString();
        }

        /*
          Who voice's tokens are for: the host, port and profile of
          the last config sent. Written when a config goes out and read when
          voice asks for a token, on different threads, hence the lock.
        */
        static string tokenHost = "";
        static string tokenPort = "";
        static long tokenProfile = 0;
        static readonly object tokenLock = new object();

        /// <summary>
        /// A join token for the launcher's voice, which is about to connect.
        /// </summary>
        /// <remarks>
        /// Issue #1322. A token opens one connection and is good for two
        /// minutes, so voice asks for one before every try instead of
        /// keeping one. The renewal every half hour and the fetch after a
        /// refusal (#409) went with the hour long token they kept alive.
        /// Voice always gets an answer, an empty token and why when the fetch
        /// failed, so it never waits on one that is not coming, and its own
        /// backoff decides when to ask again.
        /// </remarks>
        static void PageToken()
        {
            string token = "";
            string why = "";
            try
            {
                string host, port;
                long profile;
                lock (tokenLock) { host = tokenHost; port = tokenPort; profile = tokenProfile; }
                if (profile <= 0 || host.Length == 0) { why = "no character yet"; }
                else
                {
                    token = FetchToken(host, port, profile, Quiet);
                    if (token.Length == 0) { why = "the launcher could not get one, launcher.log says why"; }
                }
            }
            finally
            {
                VoiceSession s = session;
                if (s != null) s.Token(token, why);
            }
        }

        /// <summary>
        /// A join token for the game, which asked for one by writing
        /// voice-token-ask.txt, "&lt;profile id&gt; &lt;stamp&gt;", and reads it
        /// back out of voice-token.txt.
        /// </summary>
        /// <remarks>
        /// Issue #1322. The game's chat holds its own connection to the voice
        /// service and has no Discord ticket. It used to be handed this
        /// launcher's own hour long token in voice-token.txt and present it on
        /// every reconnect. Now it asks, through the folder push to talk
        /// already uses, at the moment it is about to connect. The profile is
        /// the game's word, and that is enough: the service asks the site
        /// whether this Discord account owns it, so asking for somebody else's
        /// gets nothing. Fetched off the channel's thread, because the fetch
        /// can take seconds and push to talk cannot wait behind it. A failed
        /// fetch writes nothing; the game asks again on its own next try.
        /// </remarks>
        static volatile string askSeen;

        static void PassTokenAsk(string[] dirs)
        {
            string now = null;
            foreach (string d in dirs)
            {
                string f = Path.Combine(d, "voice-token-ask.txt");
                if (!File.Exists(f)) continue;
                try { now = File.ReadAllText(f).Trim(); }
                catch { now = null; readAgain = true; }   // mid-write, try again in 100ms
                if (now != null) break;
            }
            if (string.IsNullOrEmpty(now) || now == askSeen) return;
            askSeen = now;

            long profile = 0;
            Match m = Regex.Match(now, "^([0-9]+)");
            if (m.Success) { long.TryParse(m.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out profile); }
            if (profile <= 0)
            {
                Quiet("Voice: the game asked for a join token without saying for whom");
                return;
            }
            string host = conf == null ? "" : conf.ServerAddress;
            string port = conf == null ? "" : conf.VoicePort;
            if (string.IsNullOrEmpty(port)) port = "7778";
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    string token = FetchToken(host, port, profile, Quiet);
                    if (token.Length > 0) { WriteChannel("voice-token.txt", token); }
                }
                catch (Exception ex) { Swallow.Note("Voice.PassTokenAsk", ex); }
            });
        }

        // The last config voice was given, as host, port and profile.
        static string lastConfig = "";

        // Voice that has just started knows nothing of what it was sent
        // before, so that path sends a config whatever this says.
        static void Configure(Action<string> log)
        {
            // Nor who is muted, so the file channel hands that over again.
            mutedSeen = null;
            Configure(log, true);
        }

        static void Configure(Action<string> log, bool force)
        {
            long profile = ProfileId();
            string host = conf == null ? "" : conf.ServerAddress;
            string port = conf == null ? "" : conf.VoicePort;
            if (string.IsNullOrEmpty(port)) port = "7778";

            if (string.IsNullOrEmpty(host) || profile == 0)
            {
                Say("Voice: not configured yet (host '" + host + "', profile " + profile + ")");
                return;
            }

            // Voice opens a socket for every config it is handed and the
            // voice service keeps a peer for every socket. Pressing Play twice
            // in one session on the same character is the same config again,
            // and all the second one leaves behind is a ghost on the roster
            // announcing where the last slot was standing. Only a config that
            // changed something is worth sending.
            string want = host + ":" + port + ":" + profile;
            if (!force && want == lastConfig)
            {
                // Worded as the working state it is. This used to read
                // "already configured for ...", one word away from the
                // success line below, and a tester on 21 September reported
                // it as a fault. Nothing is wrong here: voice is up for this
                // profile and there was nothing left to send it.
                Say("Voice: on for " + host + ":" + port + " as profile " + profile);
                return;
            }
            lastConfig = want;

            /*
              The rest waits on a network, so it never runs on the window's
              thread. Reconfigure is called on that thread, and the token
              fetch below is a web request with five second
              timeouts and a name lookup that can take fifteen seconds
              whatever the timeout says, so a slow network at startup could
              hold the launcher window that long (issue #409). Numbered, so
              that when two configs are in flight only the newest reaches
              voice.
            */
            int seq = Interlocked.Increment(ref configSeq);
            ThreadPool.QueueUserWorkItem(delegate
            {
                try { SendConfig(seq, host, port, profile); }
                catch (Exception ex) { Swallow.Note("Voice.Configure, send", ex); }
            });
        }

        static int configSeq;

        static void SendConfig(int seq, string host, string port, long profile)
        {
            // Fetched here rather than in VoiceSession, because the ticket is
            // the launcher's and voice has no business holding it.
            string token = FetchToken(host, port, profile, Say);
            if (seq != Volatile.Read(ref configSeq)) return;

            // Who voice's next tokens are for, whether or not this fetch
            // worked. These used to move only on success, so a config for a
            // new id whose first fetch failed went on minting for the
            // previous id.
            lock (tokenLock)
            {
                tokenHost = host;
                tokenPort = port;
                tokenProfile = profile;
            }

            // This token is voice's alone (#1322). The game's chat asks for
            // its own when it connects: PassTokenAsk.

            // Always https and wss (#1304); Configure returns before this with
            // no config, so the built-in address is only there for the compiler.
            string vbase = conf == null ? Config.Voice : conf.VoiceBase();
            string vsock = conf == null ? ("wss://" + Config.Voice.Substring(8) + "/") : conf.VoiceSocket();
            VoiceSession s = session;
            if (s != null) s.Configure(profile, "", token, vbase, vsock);
            Say("Voice: configured for " + host + ":" + port + " as profile " + profile +
                (token.Length == 0 ? " with no join token" : ""));
        }

        /// <summary>
        /// Send voice its config again.
        ///
        /// Voice is configured once, when it starts, and that happens while
        /// the launcher is still starting up. Pressing Play on a
        /// new character rolls a new profile id well after that, so voice went
        /// on announcing itself as whoever last held the slot and nobody was
        /// matched to their own character. The launch at 2026-09-16 02:25 had
        /// voice on 950724594 while the game was handed 579810940.
        ///
        /// Chars.Prepare calls this before the game starts with the id played
        /// last, and Shell calls it again with whoever the person picked at
        /// the game's menu (20 September; until then Chars.Use called the
        /// parameterless version the moment a slot's id was written). The id
        /// is passed rather than read back out of the settings file because
        /// the file is not rewritten while the game runs. Safe to call before
        /// voice has started: SendConfig does nothing without a session, and
        /// Configure says so and returns when there is no id yet.
        ///
        /// A config voice already has is not sent twice. Every one it is
        /// handed opens a socket, and the service keeps a peer per socket, so a
        /// second Play on the same character used to leave a ghost peer behind
        /// announcing the previous slot.
        /// </summary>
        public static void Reconfigure(int profileId)
        {
            if (profileId > 0) profileOverride = profileId;
            try { Configure(null, false); } catch (Exception ex) { Swallow.Note("Voice.Reconfigure", ex); }
        }

        /// <summary>
        /// What voice reports, as the page's host(kind, text) reported it:
        /// talking, debug, token, peers, status, and everything else a line
        /// for the log. Called on the voice thread.
        /// </summary>
        static void OnSessionEvent(string kind, string text)
        {
            if (text == null) text = "";
            // Push to talk flips many times a minute and the peer count
            // repeats itself constantly. Neither belongs in a log a person
            // reads, and an unlabelled "Voice: 0" belongs there least of all.
            if (kind == "talking") { talking = text == "1"; PublishStatus(); return; }

            if (kind == "debug") { Quiet("Voice: " + text); return; }

            // Voice is about to connect and needs a token of its own
            // (#1322). Fetched off this thread, and always answered.
            if (kind == "token")
            {
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try { PageToken(); } catch (Exception ex) { Swallow.Note("Voice.OnSessionEvent, token", ex); }
                });
                return;
            }

            if (kind == "peers")
            {
                int n; int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out n); peerCount = n;
                PublishStatus();
                if (text == lastPeers) return;
                lastPeers = text;
                Say("Voice: " + text + (text == "1" ? " peer connected" : " peers connected"));
                return;
            }

            if (kind == "status")
            {
                if (text == "mic ready") micOk = true;
                if (text == "no microphone") micOk = false;
                PublishStatus();
                if (text == lastStatus) return;
                lastStatus = text;
                Say("Voice: " + text);
                return;
            }

            Say("Voice: " + text);
        }


        // ------------------------------------------------------------------
        // The file channel.
        //
        // The loopback listener above was the only way the game could see any
        // of this, and it has one failure mode that costs nothing to hit and
        // gives nothing back. The game's voice page is loaded from file://,
        // which is an opaque origin; a fetch from there to 127.0.0.1 is a
        // cross-origin request into the local address space, and Chromium is
        // within its rights to refuse it outright. When it does, the page's
        // fetch rejects, and a rejected fetch is silent. No line in any log on
        // either side, no error anywhere, and a microphone indicator that sits
        // on LISTENING ONLY for the rest of the session while voice itself
        // works perfectly, because the audio does not run in that page any
        // more and never needed the page's permission.
        //
        // That is not a thing to diagnose twice. Two small files in the
        // profile folder do the same job with no origin, no port to discover
        // and no silent branch:
        //
        //   voice-status.txt   written here, read by the game
        //                      "<mic> <peers> <talking> <mode>"
        //   voice-ptt.txt      written by the game, read here
        //                      "<on> <mode>"
        //   voice-muted.txt    written by the game, read here
        //                      "<profileId> <profileId> ...", who is muted
        //
        // The game plugin already reads voice-port.txt out of this same folder
        // every three seconds and has never once failed to, which is the whole
        // argument for using it. The listener stays where it is: push to talk
        // works through it today and there is no reason to take a working path
        // away. Whichever arrives first wins, and they both say the same
        // thing, so there is nothing for them to disagree about.
        // ------------------------------------------------------------------

        /// <summary>
        /// Where the three voice files live: Data\Platform inside the game
        /// folder first, then the Profile folder.
        ///
        /// The Profile folder was the only home, and the game plugin reached
        /// it as "../Profile" from the game folder. That is right when the
        /// game is Root\Game and nowhere else. On a collection install the
        /// game is the Steam copy, "../Profile" from there does not exist, and
        /// the plugin never found voice-port.txt or voice-status.txt: the page
        /// in the game ran its own voice, asked NirnLab's browser for a
        /// microphone it has no way to grant, and sat on LISTENING ONLY while
        /// this launcher was connected with the microphone open. Push to talk
        /// went the same way, into a file nothing read.
        ///
        /// Data\Platform is the one place both ends find without knowing
        /// anything about the other: the plugin runs with the game folder as
        /// its working directory, and this side knows Paths.Game. Both are
        /// written, so an older plugin on the old layout still works.
        /// </summary>
        static string[] ChannelDirs()
        {
            string game = "";
            try { game = Path.Combine(Paths.Game, "Data\\Platform"); } catch (Exception ex) { Swallow.Note("Voice.ChannelDirs, game path", ex); }
            if (game.Length > 0 && Directory.Exists(game)) return new string[] { game, Paths.ProfileDir };
            return new string[] { Paths.ProfileDir };
        }

        static void WriteChannel(string name, string text)
        {
            foreach (string d in ChannelDirs())
            {
                try { File.WriteAllText(Path.Combine(d, name), text); } catch (Exception ex) { Swallow.Note("Voice.WriteChannel, write", ex); }
            }
        }

        static string lastStatusLine = "";

        /// <summary>
        /// Puts the current state where the game can read it. Cheap enough to
        /// call on every change, and it writes nothing when nothing moved.
        /// </summary>
        static void PublishStatus()
        {
            try
            {
                string line = (micOk ? "1" : "0") + " " +
                              peerCount.ToString(CultureInfo.InvariantCulture) + " " +
                              (talking ? "1" : "0") + " " +
                              (voiceMode ?? "local");
                if (line == lastStatusLine) return;
                lastStatusLine = line;
                WriteChannel("voice-status.txt", line);
            }
            catch (Exception ex) { Swallow.Note("Voice.PublishStatus", ex); }
        }

        /// <summary>
        /// The slow tick's half of PublishStatus: puts the line back in any
        /// folder whose copy is missing or says something else, and writes
        /// nothing when both already say it. It used to write both copies
        /// every two seconds whatever they said (#963, #977); a read of an
        /// eleven byte file is all an unchanged one costs now.
        /// </summary>
        static void RepublishIfLost()
        {
            string line = lastStatusLine;
            if (string.IsNullOrEmpty(line)) { PublishStatus(); return; }
            foreach (string d in ChannelDirs())
            {
                string f = Path.Combine(d, "voice-status.txt");
                string there = null;
                try { if (File.Exists(f)) there = File.ReadAllText(f).Trim(); }
                catch (Exception ex) { Swallow.Note("Voice.RepublishIfLost, read", ex); there = null; }
                if (there == line) continue;
                try { File.WriteAllText(f, line); } catch (Exception ex) { Swallow.Note("Voice.RepublishIfLost, write", ex); }
            }
        }

        /// <summary>
        /// The last mute line handed to voice, or null when voice has not been
        /// given one. Written when voice is configured and from the file
        /// channel's thread, hence volatile.
        /// </summary>
        static volatile string mutedSeen;

        /// <summary>
        /// Set when a read of a file the game writes met it mid-write, so the
        /// file channel looks again in 100 ms instead of waiting for a change.
        /// </summary>
        static volatile bool readAgain;

        /// <summary>
        /// Who this person has muted, from the game to the launcher's voice,
        /// which plays the audio.
        ///
        /// The mute from #133 reached the game's own page and stopped there.
        /// That page carries no audio once the launcher has it, so the voice
        /// page here went on playing a muted person at full level: measured on
        /// 23 September, profile 123 muted in the game and beside you, gain 1
        /// here. The server's list reaches the game's page, the voice plugin
        /// writes it into voice-muted.txt, and this passes it on whenever it
        /// changes. VoiceSession.Muted reads the ids out of the line itself
        /// and drops anything that is not one.
        /// </summary>
        static void PassMuted(string[] dirs)
        {
            string now = null;
            foreach (string d in dirs)
            {
                string f = Path.Combine(d, "voice-muted.txt");
                if (!File.Exists(f)) continue;
                try { now = File.ReadAllText(f).Trim(); }
                catch { now = null; readAgain = true; }   // mid-write, try again in 100ms
                if (now != null) break;
            }
            if (now == null || now == mutedSeen) return;
            mutedSeen = now;
            VoiceSession s = session;
            if (s != null) s.Muted(now);
            int n = Regex.Matches(now, "\\d+").Count;
            Quiet("Voice: the game says " + n + (n == 1 ? " person is" : " people are") + " muted");
        }

        /// <summary>
        /// Watches for push to talk and mode changes written by the game, and
        /// republishes our own state on a slow tick so a game that starts late
        /// still finds something to read.
        /// </summary>
        static void StartFileChannel(Action<string> log)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                string[] dirs = ChannelDirs();
                string seen = null;
                DateTime republished = DateTime.UtcNow;

                // Clear anything left behind by the last session, or a key held
                // down when the game was closed would be read back as held.
                WriteChannel("voice-ptt.txt", "0 local");
                // And the game's last token and ask: the token is spent or past
                // its two minutes, and the ask was for a game that has gone.
                WriteChannel("voice-token.txt", "");
                WriteChannel("voice-token-ask.txt", "");

                lastStatusLine = "";
                PublishStatus();

                // Woken by the game writing push to talk or the mute list,
                // not by a 100 ms poll (#977). See ChannelWait.
                ChannelWait wake = new ChannelWait(dirs, "voice-ptt.txt", "voice-muted.txt", "voice-token-ask.txt");
                Say("Voice: talking to the game through " + string.Join(" and ", dirs) +
                    (wake.Watching ? ", woken when the game writes" : ", read every " + ChannelWait.Poll + " ms"));

                while (true)
                {
                    try
                    {
                        // Push to talk is read the moment Windows says the
                        // file changed. The two second timeout is the slow
                        // tick below; with no watcher this is the old 100 ms
                        // sleep. A read that met the game mid-write is tried
                        // again in 100 ms, as before, rather than waiting on
                        // a change Windows has already reported.
                        bool again = readAgain;
                        readAgain = false;
                        wake.Wait(again ? ChannelWait.Poll : 2000);

                        // Republished on a slow tick as well as on change,
                        // because the game may have started after the last
                        // change and a file it never sees is no better than no
                        // file. Two seconds, and only a copy that is missing
                        // or says something else is written: this used to
                        // rewrite both copies every two seconds, and before
                        // that ten times a second, game or no game.
                        if ((DateTime.UtcNow - republished).TotalMilliseconds >= 2000)
                        {
                            republished = DateTime.UtcNow;
                            RepublishIfLost();
                        }
                        PublishStatus();

                        // Before push to talk, whose unchanged line ends the
                        // pass with a continue.
                        PassMuted(dirs);
                        PassTokenAsk(dirs);

                        // The game folder copy is read first: it is the one a
                        // plugin on a collection install can write.
                        string now = null;
                        foreach (string d in dirs)
                        {
                            string f = Path.Combine(d, "voice-ptt.txt");
                            if (!File.Exists(f)) continue;
                            try { now = File.ReadAllText(f).Trim(); }
                            catch { now = null; readAgain = true; }   // mid-write, try again in 100ms
                            if (now != null) break;
                        }
                        if (now == null || now.Length == 0 || now == seen) continue;
                        seen = now;

                        string[] bits = now.Split(' ');
                        bool on = bits.Length > 0 && bits[0] == "1";
                        VoiceSession s = session;
                        if (s != null) s.Ptt(on);

                        if (bits.Length > 1 && bits[1].Length > 0 && bits[1] != voiceMode)
                        {
                            voiceMode = bits[1];
                            if (s != null) s.Mode(voiceMode);
                        }
                    }
                    catch (Exception ex) { Swallow.Note("Voice.StartFileChannel", ex); }
                }
            });
        }

        /// <summary>
        /// Push to talk arrives from the game, which cannot reach this process
        /// any other way. A loopback listener on a port nobody else wants, and
        /// the port written where the game plugin can find it.
        /// </summary>
        static void StartPttListener(Action<string> log)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                HttpListener http = null;
                int port = 0;
                for (int p = 47780; p < 47800; p++)
                {
                    try
                    {
                        http = new HttpListener();
                        http.Prefixes.Add("http://127.0.0.1:" + p + "/");
                        http.Start();
                        port = p;
                        break;
                    }
                    catch { http = null; }
                }
                if (http == null) { Say("Voice: no free loopback port for push to talk"); return; }

                try
                {
                    WriteChannel("voice-port.txt", port.ToString(CultureInfo.InvariantCulture));
                }
                catch (Exception ex) { Swallow.Note("Voice.StartPttListener, write port", ex); }
                Say("Voice: listening for push to talk on 127.0.0.1:" + port);

                while (true)
                {
                    HttpListenerContext c;
                    try { c = http.GetContext(); } catch { return; }
                    try
                    {
                        string q = c.Request.Url.Query;
                        VoiceSession s = session;
                        if (c.Request.Url.AbsolutePath == "/ptt")
                        {
                            bool on = q.IndexOf("on=1", StringComparison.Ordinal) >= 0;
                            if (s != null) s.Ptt(on);
                        }
                        else if (c.Request.Url.AbsolutePath == "/mode")
                        {
                            Match m = Regex.Match(q, "mode=([a-z]+)");
                            if (m.Success)
                            {
                                voiceMode = m.Groups[1].Value;
                                if (s != null) s.Mode(m.Groups[1].Value);
                            }
                        }
                        // Every reply carries the state, so the game's
                        // indicator has something true to draw. It owns no
                        // microphone and no connections now, and asking it
                        // about either only ever returned no.
                        string body = "{\"mic\":" + (micOk ? "true" : "false") +
                                      ",\"peers\":" + peerCount +
                                      ",\"talking\":" + (talking ? "true" : "false") + "}";

                        // The game's page is a file:// origin, so it needs this.
                        //
                        // And more than this. A file:// page has an opaque
                        // origin, which Chromium files under the public
                        // address space, and a request from there to
                        // 127.0.0.1 is a private network request: it is
                        // preflighted, and the preflight is refused unless the
                        // reply says in as many words that a public page may
                        // reach this machine. Without these three headers the
                        // request never arrives, there is nothing in any log
                        // to say so, and the only symptom is an indicator that
                        // never lights and a push to talk key that does
                        // nothing. They are cheap, so they are here, but
                        // nothing depends on them any more: the status the
                        // game draws and the mode it sets travel by file now,
                        // through StartFileChannel below.
                        c.Response.AddHeader("Access-Control-Allow-Origin", "*");
                        c.Response.AddHeader("Access-Control-Allow-Private-Network", "true");
                        c.Response.AddHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
                        c.Response.AddHeader("Access-Control-Allow-Headers", "*");
                        c.Response.ContentType = "application/json";
                        byte[] ok = Encoding.UTF8.GetBytes(body);
                        c.Response.ContentLength64 = ok.Length;
                        c.Response.OutputStream.Write(ok, 0, ok.Length);
                        c.Response.OutputStream.Close();
                    }
                    catch (Exception ex) { Swallow.Note("Voice.StartPttListener, request", ex); }
                }
            });
        }
    }
}
