using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// "Playing Thornswood" in Discord while the game runs: the world's
    /// headcount, how long this session has been going, the emblem, and two
    /// buttons other people can press, Download and Discord.
    ///
    /// It talks to the Discord app on this machine over the local pipe the
    /// Discord game SDK uses, so nothing is installed and nothing leaves the
    /// machine except what Discord itself shows. No Discord running: nothing
    /// happens and nothing is said, because most of the time that is simply
    /// somebody who does not use Discord on this computer. If Discord is
    /// opened mid-session the card goes up within half a minute.
    ///
    /// The card is set when the game starts and cleared when it closes. The
    /// headcount is refreshed from the same server poll the Play page uses.
    /// All pipe work is on one background thread that lives as long as the
    /// launcher; the launcher's own thread only ever sets fields.
    /// </summary>
    static class Presence
    {
        // Discord's local pipes. The first one that answers is the running app.
        const int Pipes = 10;
        const int OpHandshake = 0, OpFrame = 1, OpClose = 2, OpPing = 3, OpPong = 4;
        // Discord answers a frame at once. Longer than this and the pipe is dead.
        const int ReadMs = 5000;

        static readonly object gate = new object();
        static Thread worker;
        static bool wanted;                 // the game is running, keep a card up
        static bool dirty;                  // the card changed since it was last sent
        static string appId = "", name = "Thornswood", image = "", download = "", discord = "";
        static int now = -1, max;
        static long since;                  // unix seconds this session started
        static Action<string> say;
        static bool imageRefused;           // Discord said no to the picture once, so it is left out

        /// <summary>The game has started. Puts the card up and keeps it fresh.</summary>
        public static void Start(Config cfg, Action<string> log)
        {
            lock (gate)
            {
                say = log;
                appId = (cfg.DiscordAppId ?? "").Trim();
                name = cfg.IsDev ? "Thornswood Dev" : "Thornswood";
                image = (cfg.PresenceImage ?? "").Trim();
                string site = (cfg.SiteUrl ?? "").Trim().TrimEnd('/');
                download = site;
                discord = site.Length > 0 ? site + "/discord" : "";
                since = ToUnix(DateTime.UtcNow);
                now = -1; max = cfg.MaxOnline;
                wanted = appId.Length > 0;
                dirty = true;
                if (!wanted) return;
                if (worker == null || !worker.IsAlive)
                {
                    worker = new Thread(Loop);
                    worker.IsBackground = true;
                    worker.Name = "discord-presence";
                    worker.Start();
                }
                Monitor.PulseAll(gate);
            }
        }

        /// <summary>The headcount changed. Cheap to call; nothing happens if it is the same.</summary>
        public static void Update(int online, int seats)
        {
            lock (gate)
            {
                if (!wanted) return;
                if (online == now && seats == max) return;
                now = online; max = seats; dirty = true;
                Monitor.PulseAll(gate);
            }
        }

        /// <summary>The game closed. Takes the card down.</summary>
        public static void Stop()
        {
            lock (gate)
            {
                if (!wanted) return;
                wanted = false; dirty = true;
                Monitor.PulseAll(gate);
            }
        }

        static void Loop()
        {
            NamedPipeClientStream pipe = null;
            DateTime nextTry = DateTime.MinValue;
            DateTime lastSent = DateTime.MinValue;
            bool said = false;
            while (true)
            {
                try
                {
                    bool up, send; string body;
                    lock (gate)
                    {
                        // Wake on a change, or every 15 seconds to look after
                        // the pipe: a card is sent again once a minute so a
                        // Discord that restarted gets it back.
                        if (!dirty) Monitor.Wait(gate, 15000);
                        up = wanted;
                        send = dirty || (up && pipe != null && (DateTime.UtcNow - lastSent).TotalSeconds > 60);
                        dirty = false;
                        body = up ? Activity() : null;
                    }

                    if (!up)
                    {
                        if (pipe != null)
                        {
                            // Clear the card and let go of the pipe until the next Play.
                            try
                            {
                                Send(pipe, OpFrame, "{\"cmd\":\"SET_ACTIVITY\",\"args\":{\"pid\":" + Pid() + ",\"activity\":null},\"nonce\":\"" + Nonce() + "\"}");
                                Read(pipe);
                            }
                            catch (Exception ex) { Swallow.Note("Presence.Loop, clearing activity", ex); }
                            try { pipe.Dispose(); } catch (Exception ex) { Swallow.Note("Presence.Loop, disposing pipe", ex); }
                            pipe = null;
                            said = false;
                        }
                        continue;
                    }
                    if (!send) continue;

                    if (pipe == null)
                    {
                        if (DateTime.UtcNow < nextTry) { lock (gate) { dirty = true; } Thread.Sleep(3000); continue; }
                        pipe = Connect();
                        if (pipe == null)
                        {
                            // Discord is not running here. Looked for again in a
                            // while, in case it is opened mid-session.
                            nextTry = DateTime.UtcNow.AddSeconds(30);
                            lock (gate) { dirty = true; }
                            Thread.Sleep(3000);
                            continue;
                        }
                    }

                    try
                    {
                        Send(pipe, OpFrame, "{\"cmd\":\"SET_ACTIVITY\",\"args\":{\"pid\":" + Pid() + ",\"activity\":" + body + "},\"nonce\":\"" + Nonce() + "\"}");
                        string reply = Read(pipe);
                        lastSent = DateTime.UtcNow;
                        if (reply != null && reply.Contains("\"evt\":\"ERROR\""))
                        {
                            string why = Field(reply, "message");
                            if (!imageRefused && image.Length > 0)
                            {
                                // Most likely the picture. Once more without it, so
                                // at least the words go up.
                                imageRefused = true;
                                Say("Discord did not take the presence card (" + why + "), trying without the picture.");
                                lock (gate) { dirty = true; }
                                continue;
                            }
                            if (!said) Say("Discord did not take the presence card: " + why);
                            said = true;
                        }
                        else if (!said)
                        {
                            said = true;
                            Say("Discord shows you playing " + name + ".");
                        }
                    }
                    catch (Exception ex)
                    {
                        // Discord closed, or the pipe broke. Dropped, and picked
                        // up again from the top next time round.
                        try { pipe.Dispose(); } catch (Exception disposeEx) { Swallow.Note("Presence.Loop, disposing broken pipe", disposeEx); }
                        pipe = null;
                        nextTry = DateTime.UtcNow.AddSeconds(10);
                        lock (gate) { dirty = true; }
                        if (said) Say("Discord presence dropped: " + Failure.Why("Presence", ex, "Discord") + ". Trying again.");
                        said = false;
                        Thread.Sleep(3000);
                    }
                }
                catch
                {
                    // Nothing in here is allowed to end the thread.
                    Thread.Sleep(5000);
                }
            }
        }

        /// <summary>The card, as Discord's activity JSON.</summary>
        static string Activity()
        {
            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"details\":").Append(Q("Roleplaying in " + name));
            string state = now >= 0 ? (now + (max > 0 ? " of " + max : "") + " awake") : "In the world";
            sb.Append(",\"state\":").Append(Q(state));
            sb.Append(",\"timestamps\":{\"start\":").Append(since).Append("}");
            if (image.Length > 0 && !imageRefused)
                sb.Append(",\"assets\":{\"large_image\":").Append(Q(image)).Append(",\"large_text\":").Append(Q(name)).Append("}");
            if (download.Length > 0 || discord.Length > 0)
            {
                sb.Append(",\"buttons\":[");
                bool first = true;
                if (download.Length > 0) { sb.Append("{\"label\":\"Download\",\"url\":").Append(Q(download)).Append("}"); first = false; }
                if (discord.Length > 0) { if (!first) sb.Append(","); sb.Append("{\"label\":\"Discord\",\"url\":").Append(Q(discord)).Append("}"); }
                sb.Append("]");
            }
            sb.Append(",\"instance\":false}");
            return sb.ToString();
        }

        static NamedPipeClientStream Connect()
        {
            for (int i = 0; i < Pipes; i++)
            {
                NamedPipeClientStream p = null;
                try
                {
                    p = new NamedPipeClientStream(".", "discord-ipc-" + i, PipeDirection.InOut, PipeOptions.Asynchronous);
                    p.Connect(300);
                    Send(p, OpHandshake, "{\"v\":1,\"client_id\":" + Q(appId) + "}");
                    string hello = Read(p);
                    if (hello != null && hello.Contains("\"evt\":\"READY\"")) return p;
                    if (hello != null && hello.Contains("\"code\"")) Say("Discord refused the handshake: " + Field(hello, "message"));
                    p.Dispose();
                }
                catch
                {
                    if (p != null) { try { p.Dispose(); } catch (Exception ex) { Swallow.Note("Presence.Connect, disposing failed pipe", ex); } }
                }
            }
            return null;
        }

        static void Send(PipeStream p, int op, string json)
        {
            byte[] body = Encoding.UTF8.GetBytes(json);
            byte[] frame = new byte[8 + body.Length];
            Array.Copy(BitConverter.GetBytes(op), 0, frame, 0, 4);
            Array.Copy(BitConverter.GetBytes(body.Length), 0, frame, 4, 4);
            Array.Copy(body, 0, frame, 8, body.Length);
            p.Write(frame, 0, frame.Length);
            p.Flush();
        }

        /// <summary>One frame back from Discord, or null. Answers a ping on the way.</summary>
        static string Read(PipeStream p)
        {
            for (int guard = 0; guard < 4; guard++)
            {
                byte[] head = Fill(p, 8);
                int op = BitConverter.ToInt32(head, 0);
                int len = BitConverter.ToInt32(head, 4);
                if (len < 0 || len > 1 << 20) throw new IOException("Discord sent a frame that makes no sense");
                byte[] body = Fill(p, len);
                string text = Encoding.UTF8.GetString(body);
                if (op == OpPing) { Send(p, OpPong, text); continue; }
                if (op == OpClose) throw new IOException("Discord closed the pipe");
                return text;
            }
            return null;
        }

        /// <summary>Exactly n bytes, or an exception. Never waits forever.</summary>
        static byte[] Fill(PipeStream p, int n)
        {
            byte[] buf = new byte[n];
            int got = 0;
            while (got < n)
            {
                IAsyncResult ar = p.BeginRead(buf, got, n - got, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(ReadMs)) throw new IOException("Discord did not answer");
                int r = p.EndRead(ar);
                if (r <= 0) throw new IOException("Discord hung up");
                got += r;
            }
            return buf;
        }

        static string Field(string json, string key)
        {
            try
            {
                var m = Regex.Match(json ?? "", "\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                return m.Success ? m.Groups[1].Value.Replace("\\\"", "\"") : "no reason given";
            }
            catch { return "no reason given"; }
        }

        static string Q(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append("\"").ToString();
        }

        static int Pid() { return System.Diagnostics.Process.GetCurrentProcess().Id; }
        static string Nonce() { return Guid.NewGuid().ToString("N"); }
        static long ToUnix(DateTime utc) { return (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds; }

        static void Say(string m)
        {
            Action<string> s = say;
            if (s == null) return;
            try { s(m); } catch (Exception ex) { Swallow.Note("Presence.Say", ex); }
        }
    }
}
