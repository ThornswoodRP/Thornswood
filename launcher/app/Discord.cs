// Discord.cs
//
// Linking a copy of Thornswood to a Discord account, and asking the site
// whether that account is still allowed in.
//
// Why it exists: the server password used to live in version.json, which meant
// everybody who had ever installed the game kept a copy of it forever and
// there was no way to take it back off one person. Now the launcher holds a
// signed ticket instead, the site holds the password, and every launch asks
// whether this ticket is still somebody who is allowed in. Leaving the Discord
// or being given the Banned role stops the next launch, with nothing to
// remember to change anywhere else.
//
// Only the base class library, so it compiles against the same reference set
// the rest of the launcher already uses.
//
//   Discord.Folder  = profile folder, set once at startup
//   Discord.Ticket  != null  -> this copy is linked
//   Discord.Connect(...)     -> opens the browser, waits, saves the ticket
//   Discord.Join()           -> ask the site: allowed in, and the password
//   Discord.Forget()         -> unlink
//   Discord.AccountId        -> the Discord id the ticket is for
//   Discord.AvatarUrl        -> CDN URL for the profile picture
//   Discord.NewSession()     -> one id for this Play
//   Discord.SessionStart/End -> both ends of a session, for the site's log

using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Thornswood
{
    public class Standing
    {
        public bool Ok;
        public string Name = "";
        public string Password = "";
        public string Why = "";        // link, guild, banned, role, offline
        // With offline: what the request ran into and how long it waited
        // (Discord.LastFailure), for the log line that reports it.
        public string NetFailure = "";
        public string Message = "";
        public string Invite = "";
        public bool Admin;
        // Allowed on the dev build. The site decides: the staff roles
        // (Owner, Dev, Gamemaster, Moderator, Loremaster) unless its config
        // widens it. Patrick's call on 27 September for the install gate (#605).
        public bool Dev;
        // Character slots at the game's main menu. Two, or three for a
        // Patreon tier or a Gamemaster; the site decides from the roles.
        public int Slots = 2;
    }

    public static class Discord
    {
        public const string Site = "https://thornswood.net";

        public static string Folder = @"C:\Thornswood\Profile";
        const string TicketName = "discord.txt", NameName = "discord-name.txt",
                     AvatarName = "discord-avatar.txt", DevName = "dev-allowed.txt";
        static string TicketFile { get { return Path.Combine(Folder, TicketName); } }
        static string NameFile   { get { return Path.Combine(Folder, NameName); } }
        static string AvatarFile { get { return Path.Combine(Folder, AvatarName); } }
        static string DevFile    { get { return Path.Combine(Folder, DevName); } }

        /// <summary>Which build is asking: "" for the main build, "dev" for the dev build. Set by the shell.</summary>
        public static string Channel = "";

        /// <summary>
        /// Whether the site last said this person may use the dev build. Kept
        /// on disk so the Settings card can show before the first check in of
        /// a session. False until the site has said yes once.
        /// </summary>
        public static bool DevAllowed
        {
            get { try { return File.Exists(DevFile); } catch { return false; } }
        }

        static void NoteDev(bool allowed)
        {
            try
            {
                if (allowed) { Directory.CreateDirectory(Folder); File.WriteAllText(DevFile, "yes"); }
                else if (File.Exists(DevFile)) File.Delete(DevFile);
            }
            catch (Exception ex) { Swallow.Note("Discord.NoteDev", ex); }
        }

        static string ticket;
        static string name;
        static string avatar;

        public static string Ticket
        {
            get
            {
                if (ticket == null)
                {
                    // Encrypted on the disk since 1.0.197. Unprotect hands an
                    // older plain one straight back, and the next Save writes
                    // it down encrypted.
                    try { ticket = File.Exists(TicketFile) ? Secrets.Unprotect(File.ReadAllText(TicketFile).Trim()) : ""; }
                    catch { ticket = ""; }
                }
                return ticket.Length == 0 ? null : ticket;
            }
        }

        public static string Name
        {
            get
            {
                if (name == null)
                {
                    try { name = File.Exists(NameFile) ? File.ReadAllText(NameFile).Trim() : ""; }
                    catch { name = ""; }
                }
                return name;
            }
        }

        public static bool Linked { get { return Ticket != null; } }
        /// <summary>
        /// Discord avatar hash last saved for this ticket, or "" when unknown.
        /// Used with AccountId to build AvatarUrl. Empty means the default
        /// Discord portrait for that id.
        /// </summary>
        public static string Avatar
        {
            get
            {
                if (avatar == null)
                {
                    try
                    {
                        avatar = File.Exists(AvatarFile) ? File.ReadAllText(AvatarFile).Trim() : "";
                        // A quoted hash from an older hand-edit or JSON paste must not fail HashOk.
                        if (avatar.Length >= 2 && avatar[0] == '"' && avatar[avatar.Length - 1] == '"')
                            avatar = avatar.Substring(1, avatar.Length - 2).Trim();
                    }
                    catch (Exception ex) { Swallow.Note("Discord.Avatar", ex); avatar = ""; }
                }
                return avatar;
            }
        }

        /// <summary>
        /// HTTPS address of the profile picture for the linked account, or ""
        /// when not linked. A saved hash uses the custom avatar CDN; otherwise
        /// Discord's default portrait for that id.
        /// </summary>
        public static string AvatarUrl
        {
            get
            {
                string id = AccountId;
                if (id.Length == 0) return "";
                string hash = Avatar;
                if (hash != null && hash.Length > 0 && HashOk(hash))
                {
                    // Animated Discord hashes begin with a_; those need .gif.
                    bool anim = hash.Length > 2 && (hash[0] == 'a' || hash[0] == 'A') && hash[1] == '_';
                    string ext = anim ? ".gif" : ".png";
                    return "https://cdn.discordapp.com/avatars/" + id + "/" + hash + ext + "?size=64";
                }
                return DefaultAvatarUrl(id);
            }
        }

        /// <summary>
        /// Discord avatar hashes are hex, or a_ plus hex for animated ones.
        /// Anything else must not become a CDN URL.
        /// </summary>
        static bool HashOk(string hash)
        {
            if (hash == null || hash.Length == 0) return false;
            int i = 0;
            if (hash.Length > 2 && (hash[0] == 'a' || hash[0] == 'A') && hash[1] == '_') i = 2;
            if (i >= hash.Length) return false;
            for (; i < hash.Length; i++)
            {
                char c = hash[i];
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
                    return false;
            }
            return true;
        }

        static string DefaultAvatarUrl(string id)
        {
            // New Discord usernames: (user_id >> 22) % 6.
            try
            {
                ulong n = ulong.Parse(id);
                int idx = (int)((n >> 22) % 6UL);
                return "https://cdn.discordapp.com/embed/avatars/" + idx + ".png";
            }
            catch (Exception ex) { Swallow.Note("Discord.DefaultAvatarUrl", ex); return "https://cdn.discordapp.com/embed/avatars/0.png"; }
        }

        /// <summary>
        /// The Discord id inside the ticket this copy holds, or "" when it is
        /// not linked or the ticket cannot be read.
        ///
        /// Which account the launcher is acting for, so the character list
        /// can tell when that changes (Chars.EnsureSpare). Not a check of the
        /// ticket: the site checks the signature on every call, and nothing
        /// here is let in or kept out on this.
        /// </summary>
        public static string AccountId { get { return AccountIdOf(Ticket); } }

        /// <summary>
        /// The Discord id out of a ticket, "" for anything that is not one.
        /// The site's makeTicket writes tk1.body.signature, the body being
        /// base64url JSON with the id in d.
        /// </summary>
        public static string AccountIdOf(string ticket)
        {
            if (string.IsNullOrEmpty(ticket)) return "";
            string[] parts = ticket.Split('.');
            if (parts.Length != 3 || parts[0] != "tk1" || parts[1].Length == 0) return "";
            try
            {
                string b = parts[1].Replace('-', '+').Replace('_', '/');
                while (b.Length % 4 != 0) b += "=";
                string d = Field(Encoding.UTF8.GetString(Convert.FromBase64String(b)), "d");
                if (d.Length == 0 || d.Length > 32) return "";
                // A Discord id is a string of digits and nothing else.
                foreach (char c in d) if (c < '0' || c > '9') return "";
                return d;
            }
            catch { return ""; }
        }

        /// <summary>
        /// Every file this account leaves in folder: the sign-in ticket, the
        /// name and picture kept beside it, the site's last staff answer and
        /// the door's last yes or no. Forget deletes them, and so does an
        /// uninstall that keeps the saves and settings (LocalKeep.NotSaves,
        /// #3679), so the two cannot name different files.
        /// </summary>
        public static string[] AccountFiles(string folder)
        {
            return new string[]
            {
                Path.Combine(folder, TicketName),
                Path.Combine(folder, NameName),
                Path.Combine(folder, AvatarName),
                // The site's last staff answer for this account. Left on disk,
                // DevAllowed stays true for the next account until that
                // account's first check-in, and the staff queue can show in
                // between (#1208).
                Path.Combine(folder, DevName),
                // door.txt is the last yes or no the site gave for this ticket
                // (Door.AnswerFile, kept beside the ticket).
                Path.Combine(folder, "door.txt"),
            };
        }

        public static void Forget()
        {
            foreach (string f in AccountFiles(Folder))
            {
                try { if (File.Exists(f)) File.Delete(f); }
                catch (Exception ex) { Swallow.Note("Discord.Forget, " + Path.GetFileName(f), ex); }
            }
            ticket = ""; name = ""; avatar = "";
        }

        static void Save(string t, string who)
        {
            Save(t, who, Avatar);
        }

        static void Save(string t, string who, string pic)
        {
            // Only a real Discord hash is kept. Empty or junk must not leave a
            // bad file that blocks the default portrait, and must not paint
            // the Clyde-style embed avatar when a custom one exists.
            if (pic != null && pic.Length > 0 && !HashOk(pic)) pic = "";
            try
            {
                Directory.CreateDirectory(Folder);
                File.WriteAllText(TicketFile, Secrets.Protect(t ?? ""));
                File.WriteAllText(NameFile, who ?? "");
                File.WriteAllText(AvatarFile, pic ?? "");
                // The ticket is as good as the password: anything holding it
                // can ask the site for the real one. Nobody else on this PC
                // gets to read the file.
                Secrets.LockDown(TicketFile);
            }
            catch (Exception ex) { Swallow.Note("Discord.Save", ex); }
            ticket = t ?? ""; name = who ?? ""; avatar = pic ?? "";
        }

        /// <summary>Remember a fresh avatar hash from the site without touching the ticket.</summary>
        public static void NoteAvatar(string pic)
        {
            if (pic == null) pic = "";
            // Same hash guard as AvatarUrl (hex, or a_ + hex for animated).
            if (!HashOk(pic)) return;
            try
            {
                Directory.CreateDirectory(Folder);
                File.WriteAllText(AvatarFile, pic);
            }
            catch (Exception ex) { Swallow.Note("Discord.NoteAvatar", ex); }
            avatar = pic;
        }

        // ------------------------------------------------------------ link --
        //
        // The standard way a desktop program does this: listen on a spare port
        // on this machine only, send the browser out to the site, and let the
        // site send the answer back to that port. Nothing is typed, nothing is
        // pasted, and the ticket never goes through the clipboard.
        //
        // onDone is called on a thread pool thread. Marshal it yourself.
        public static void Connect(Action<bool, string> onDone)
        {
            HttpListener listener = null;
            int port = 0;

            // The loopback listener below is reachable from any browser tab and
            // from anything else running on this machine, and the port range is
            // twenty numbers wide, so it is guessable by definition. Without
            // this, a web page open at the wrong moment could fire a request at
            // all twenty ports carrying its own ticket, win the race against a
            // human finishing a Discord login, and quietly link this launcher to
            // somebody else's account. The nonce rides out with the request and
            // has to come back on the answer, so a request that did not start
            // here is dropped and the listener keeps waiting.
            string nonce;
            {
                byte[] nb = RandomNumberGenerator.GetBytes(24);
                var sb = new StringBuilder();
                foreach (byte b in nb) sb.Append(b.ToString("x2"));
                nonce = sb.ToString();
            }

            for (int tryPort = 53120; tryPort < 53140 && listener == null; tryPort++)
            {
                try
                {
                    var l = new HttpListener();
                    l.Prefixes.Add("http://127.0.0.1:" + tryPort + "/");
                    l.Start();
                    listener = l;
                    port = tryPort;
                }
                catch (Exception ex) { Swallow.Note("Discord.Connect, binding port", ex); }
            }
            if (listener == null)
            {
                if (onDone != null) onDone(false, "Could not open a port to listen on.");
                return;
            }

            try
            {
                Process_Start(Site + "/auth/discord?back=%2Flink&port=" + port + "&nonce=" + nonce);
            }
            catch
            {
                try { listener.Stop(); } catch (Exception ex) { Swallow.Note("Discord.Connect, stopping listener after browser fail", ex); }
                if (onDone != null) onDone(false, "Could not open your browser.");
                return;
            }

            var done = new ManualResetEvent(false);
            string gotTicket = null, gotName = null, gotAvatar = null, error = null;

            // A loop rather than one shot, so a stray or hostile request is
            // answered and ignored instead of ending the attempt. The listener
            // being stopped below is what breaks it out.
            var worker = new Thread(delegate ()
            {
                while (true)
                {
                    HttpListenerContext ctx;
                    try { ctx = listener.GetContext(); }
                    catch { return; }

                    bool good = false;
                    try
                    {
                        var q = ctx.Request.QueryString;
                        var ep = ctx.Request.RemoteEndPoint;

                        bool local = ep != null && IPAddress.IsLoopback(ep.Address);
                        string sawNonce = q["nonce"] ?? "";
                        bool mine = string.Equals(sawNonce, nonce, StringComparison.Ordinal);
                        string t = q["ticket"];

                        good = local && mine && !string.IsNullOrEmpty(t);
                        if (good)
                        {
                            gotTicket = t;
                            gotName = q["name"];
                            gotAvatar = q["avatar"] ?? "";
                        }

                        string page = good
                            ? Page("Linked", "You can close this and go back to the launcher.")
                            : Page("Not this one", "That did not come from the Connect Discord button, so it was ignored. Close this and press it again.");
                        var bytes = Encoding.UTF8.GetBytes(page);
                        ctx.Response.StatusCode = good ? 200 : 400;
                        ctx.Response.ContentType = "text/html; charset=utf-8";
                        ctx.Response.ContentLength64 = bytes.Length;
                        ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                        ctx.Response.Close();
                    }
                    catch (Exception e) { if (!good) error = e.Message; }

                    if (good) { done.Set(); return; }
                }
            });
            worker.IsBackground = true;
            worker.Start();

            // Two minutes is long enough to sign in to Discord and short enough
            // that a forgotten browser tab does not leave a port open all night.
            bool answered = done.WaitOne(TimeSpan.FromMinutes(2));
            try { listener.Stop(); } catch (Exception ex) { Swallow.Note("Discord.Connect, stopping listener", ex); }

            if (!answered)
            {
                if (onDone != null) onDone(false, "Timed out waiting for the browser.");
                return;
            }
            if (string.IsNullOrEmpty(gotTicket))
            {
                if (onDone != null) onDone(false, error ?? "No ticket came back.");
                return;
            }

            Save(gotTicket, gotName, gotAvatar);
            if (onDone != null) onDone(true, gotName ?? "");
        }

        static void Process_Start(string url)
        {
            var psi = new System.Diagnostics.ProcessStartInfo(url);
            psi.UseShellExecute = true;
            System.Diagnostics.Process.Start(psi);
        }

        static string Page(string title, string line)
        {
            return "<!doctype html><meta charset=utf-8><title>Thornswood</title>" +
                   "<body style=\"background:#12150F;color:#DDE3D5;font:15px/1.6 " +
                   "system-ui;display:grid;place-items:center;height:100vh;margin:0;" +
                   "text-align:center\"><div><h1 style=\"color:#C9A24B;font-weight:600\">" +
                   title + "</h1><p>" + line + "</p></div></body>";
        }

        // ------------------------------------------------------------ join --
        //
        // Called before connecting. Returns whether this person is still
        // allowed in, and the password to connect with if they are.
        public static Standing Join()
        {
            // The profile id goes with the check in. The site keeps it against
            // the Discord account, and the game server's door reads that list
            // to decide who it lets connect. Without it the server has no way
            // to tell one person from another: it never sees a Discord account,
            // only a profile number.
            int pid = 0;
            try { pid = AutoJoin.GetProfileId(); } catch { pid = 0; }
            return Join(pid);
        }

        /// <summary>
        /// The same check in, for one particular id.
        ///
        /// Since 20 September the person picks their character at the game's
        /// menu, so before the game starts Shell checks in once for every id
        /// this install could pick, characters and the spare alike, and once
        /// more with the one that was picked. The version above sends whatever
        /// the settings file says, which is the id played last and no longer
        /// the whole story.
        /// </summary>
        public static Standing Join(int profileId)
        {
            var st = new Standing();
            if (!Linked)
            {
                st.Why = "link";
                st.Message = "This copy is not linked to a Discord account yet.";
                return st;
            }
            int pid = profileId;
            // The sessions of the crash snapshots kept on this PC, so the
            // answer can say which of those crashes staff have looked at
            // (#2319, CrashDump.Tidy).
            string held = CrashDump.HeldSessions();
            string body = "{\"ticket\":\"" + Escape(Ticket) + "\"" +
                          (pid > 0 ? ",\"profileId\":" + pid : "") +
                          (string.IsNullOrEmpty(Channel) ? "" : ",\"channel\":\"" + Escape(Channel) + "\"") +
                          (held.Length > 0 ? ",\"snapshots\":\"" + Escape(held) + "\"" : "") + "}";
            string reply;
            int code = PostJson(Site + "/api/play/join", body, out reply);

            if (code == 0)
            {
                // The site could not be reached. Say so honestly rather than
                // implying the person is banned.
                st.Why = "offline";
                st.Message = "Could not reach thornswood.net to check you in.";
                st.NetFailure = LastFailure ?? "";
                return st;
            }

            st.Ok       = Field(reply, "ok") == "true";
            st.Name     = Field(reply, "name");
            st.Password = Field(reply, "password");
            st.Why      = Field(reply, "why");
            st.Message  = Field(reply, "message");
            st.Invite   = Field(reply, "invite");
            st.Admin    = Field(reply, "admin") == "true";
            st.Dev      = Field(reply, "dev") == "true";
            int slots;
            if (int.TryParse(Field(reply, "slots"), out slots) && slots > 0) st.Slots = slots;
            // Only an answer that carried the flag moves it. An older site
            // that says nothing about dev leaves the last answer standing.
            if (reply.Contains("\"dev\"")) NoteDev(st.Dev);
            // Likewise only an answer that carried it: which crashes staff
            // have marked looked at, whose snapshots Tidy may now delete.
            if (st.Ok && reply.Contains("\"lookedAt\"")) CrashDump.NoteLookedAt(Field(reply, "lookedAt"));

            if (st.Ok && st.Name.Length > 0 && st.Name != Name) Save(Ticket, st.Name);
            string av = Field(reply, "avatar");
            if (st.Ok && av.Length > 0 && av != Avatar) NoteAvatar(av);
            if (!st.Ok && st.Message.Length == 0) st.Message = "Not allowed in.";
            return st;
        }

        /// <summary>
        /// A join pass for one character, or "" with why saying why not (#937).
        ///
        /// The game server ends a session that has not shown it one, so this
        /// is what lets a character into the world at all. The site signs it
        /// only for this ticket's own character, and only when this launcher's
        /// version is one the channel's feed still lets in: from its
        /// minLauncher up to the launcher it published. why is the site's own
        /// sentence when it said no, which is written for the person.
        ///
        /// key is the pass's own key (#1320): the site gives it over https
        /// beside the pass, and the game's client proves the pass on its own
        /// connection with it (a mac over the nonce the game server sends each
        /// login), so the key itself never goes on the game's port. "" from a
        /// site that does not send one yet.
        /// </summary>
        public static string Pass(int profileId, out string key, out string why)
        {
            key = "";
            why = "";
            if (!Linked)
            {
                why = "This copy is not linked to a Discord account yet.";
                return "";
            }
            string body = "{\"ticket\":\"" + Escape(Ticket) + "\"" +
                          ",\"profileId\":" + profileId.ToString(CultureInfo.InvariantCulture) +
                          ",\"channel\":\"" + Escape(string.IsNullOrEmpty(Channel) ? "main" : Channel) + "\"" +
                          ",\"version\":\"" + Escape(Updater.Version) + "\"}";
            string reply;
            int code = PostJson(Site + "/api/play/pass", body, out reply);
            if (code == 0)
            {
                why = "Could not reach thornswood.net for a join pass.";
                return "";
            }
            string pass = Field(reply, "pass");
            if (code == 200 && Field(reply, "ok") == "true" &&
                Regex.IsMatch(pass, "^jp1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"))
            {
                string k = Field(reply, "key");
                if (Regex.IsMatch(k, "^[A-Za-z0-9_-]{16,128}$")) key = k;
                return pass;
            }
            why = Field(reply, "message");
            if (why.Length == 0) why = "thornswood.net answered " + code + " and gave no join pass.";
            return "";
        }

        // -------------------------------------------------------- sessions --
        //
        // Both ends of a play session, so there is a record of who tested what
        // and for how long. /api/play/join is a last played stamp: it says
        // somebody pressed Play and nothing about when they stopped. Djinn
        // asked for a checking sheet on 20 September, and this is the half of
        // it the launcher can see.
        //
        // One id per Play, made here, sent with the start and again with the
        // end. The site matches the two up and the staff console reads them.
        //
        // Nothing in here is allowed to matter. A site that is down, a ticket
        // that has run out, an answer that never comes: each is a line in the
        // log and the game plays exactly the same.

        static string session = "";

        /// <summary>The id this session is logged under. "" before the first Play.</summary>
        public static string SessionId { get { return session; } }

        /// <summary>A fresh id for one session. Made once, as the game starts.</summary>
        public static string NewSession()
        {
            session = Guid.NewGuid().ToString("N");
            return session;
        }

        /// <summary>The game has just been started. Call it from a pool thread.</summary>
        public static void SessionStart(int profileId)
        {
            if (session.Length == 0) NewSession();
            MarkPending(session);
            Send("start", Site + "/api/play/start", Head(profileId) + "}");
        }

        /// <summary>
        /// The session whose logs have not been sent yet, or "".
        ///
        /// Written when a session starts and cleared when its logs are safely
        /// up. If the launcher is killed, or the machine goes down, or the
        /// game takes the launcher with it, SessionEnd never runs and the logs
        /// are still sitting on disk. This is what remembers them, so the next
        /// start can send them before anything wipes them.
        /// </summary>
        static string PendingFile { get { return Path.Combine(Folder, "logs-pending.txt"); } }

        static void MarkPending(string id)
        {
            try
            {
                Directory.CreateDirectory(Folder);
                File.WriteAllText(PendingFile, id);
            }
            catch (Exception ex) { Swallow.Note("Discord.MarkPending", ex); }
        }

        static void ClearPending()
        {
            try { if (File.Exists(PendingFile)) File.Delete(PendingFile); }
            catch (Exception ex) { Swallow.Note("Discord.ClearPending", ex); }
        }

        /// <summary>
        /// Logs from a session that ended without sending them, sent now.
        ///
        /// Called once as the launcher starts, BEFORE Play can run, because
        /// the game truncates its own logs at every game start and after that
        /// there is nothing left to send. The crash that took the launcher
        /// down is exactly the session somebody wants to read afterwards, and
        /// until now it was the one that was always lost.
        ///
        /// Call it from a pool thread.
        /// </summary>
        public static void SendPendingLogs()
        {
            try
            {
                if (!Linked) return;
                string id = "";
                try { if (File.Exists(PendingFile)) id = (File.ReadAllText(PendingFile) ?? "").Trim(); }
                catch { return; }
                if (id.Length < 8) { ClearPending(); return; }

                string was = session;
                session = id;
                try
                {
                    Note("The last session ended without sending its logs. Sending them now.");
                    SessionLogs();
                }
                finally { session = was; }
            }
            catch (Exception ex) { Swallow.Note("Discord.SendPendingLogs", ex); }
        }

        /// <summary>
        /// The game has closed. minutes is how long it ran; why is "quit" when
        /// the person closed it and "update" when the launcher closed it for a
        /// release. Call it from a pool thread.
        /// </summary>
        public static void SessionEnd(int profileId, double minutes, string why)
        {
            // A launcher that took a running session over, or one that was
            // itself replaced mid session, has no id of its own. It makes one
            // and sends the end alone; the site records that as a session whose
            // start was never seen, which is the truth of it.
            if (session.Length == 0) NewSession();
            double m = minutes;
            if (m < 0 || m > 60 * 24 * 7 || double.IsNaN(m)) m = 0;
            string reason = why == "update" ? "update" : "quit";
            Send("end", Site + "/api/play/end",
                 Head(profileId) +
                 ",\"minutes\":" + m.ToString("F1", CultureInfo.InvariantCulture) +
                 ",\"why\":\"" + reason + "\"}");
        }

        /// <summary>
        /// The session's logs, up to the site, as the game closes.
        ///
        /// THIS MOMENT AND NO OTHER. The game truncates its own logs under
        /// Data\Platform every time it starts, so a log nobody collected here
        /// is gone for good. That is why every report so far has begun by
        /// asking the person to go and find four files and paste them, which
        /// they mostly cannot and reasonably do not want to.
        ///
        /// Sent once per session. The site writes a set once and refuses a
        /// second for the same id, because these are meant to stand up when
        /// somebody is suspended, and evidence the accused can overwrite is
        /// not evidence.
        ///
        /// These are the launcher's own log and the game's own logs, and they
        /// are read from the person's PC, so what they can hold is named file
        /// by file on the privacy page (site\data\site\privacy.md, "The logs
        /// sent when a session ends"), and tests\test-session-logs.js fails
        /// when this list names a file that page does not (#3627). Every file
        /// and every line of the scan goes through Scrub first. Called from a
        /// pool thread, after SessionEnd so the row it attaches to exists.
        /// </summary>
        public static void SessionLogs()
        {
            try
            {
                if (!Linked || session.Length == 0) return;

                // Name, then where it is. The names are the ones the site
                // accepts; anything else it drops on the floor.
                string plat = Path.Combine(Paths.Game, "Data\\Platform");
                string[][] want = new string[][] {
                    new string[] { "launcher.log",               Path.Combine(Folder, "launcher.log") },
                    // The SKSE crash log, for a game that went down with no
                    // message (entry 105, Djinn on 20 September: "I was on the
                    // menu and alt tabbed to respond and the dev in game on K
                    // menu crashed"). Only the one this session wrote, because
                    // that folder keeps every crash there has ever been. Second
                    // in the list, so a set too big for the site loses the
                    // everyday logs before it loses this one. Sent with a
                    // first line naming it, its size and the snapshot beside
                    // it, so an empty one still arrives (CrashLogText, #2319).
                    new string[] { "crash.log",                  CrashLogSince(Files.SkseLogDir, PendingSince(PendingFile, session)) },
                    new string[] { "thornswood-front.log",       Path.Combine(plat, "thornswood-front.log") },
                    new string[] { "thornswood-voice.log",       Path.Combine(plat, "thornswood-voice.log") },
                    new string[] { "thornswood-emotes.log",      Path.Combine(plat, "thornswood-emotes.log") },
                    new string[] { "thornswood-input.log",       Path.Combine(plat, "thornswood-input.log") },
                    new string[] { "thornswood-loadorder.txt",   Path.Combine(plat, "thornswood-loadorder.txt") },
                    new string[] { "thornswood-plugins-light.txt", Path.Combine(plat, "thornswood-plugins-light.txt") },
                    // Skyrim Platform's own log: the browser, the native calls
                    // the plugins make, and any script that threw. The game
                    // starts it afresh each run, so it is this session's. Last,
                    // because it is the biggest: 1.3 MB for a session of under
                    // three minutes on Patrick's machine on 23 September, of
                    // which the tail is sent.
                    new string[] { "skyrim-platform.log",        Path.Combine(Files.SkseLogDir, "skyrim-platform.log") }
                };

                // The crash's snapshot is tied to this session here, the one
                // moment both are known, so a looked-at mark on the sessions
                // page can reach it (#2319, CrashDump.Remember).
                CrashDump.Remember(want[1][1], session);

                var sb = new StringBuilder();
                sb.Append("{\"ticket\":\"").Append(Escape(Ticket)).Append("\"");
                sb.Append(",\"session\":\"").Append(Escape(session)).Append("\"");
                sb.Append(",\"issues\":").Append(IssuesJson());
                sb.Append(",\"checks\":").Append(ChecksJson());
                sb.Append(",\"logs\":{");
                int n = 0;
                for (int i = 0; i < want.Length; i++)
                {
                    string text = Scrub(want[i][0] == "crash.log" ? CrashLogText(want[i][1]) : ReadLogTail(want[i][1]));
                    if (text.Length == 0) continue;
                    string one = "\"" + Escape(want[i][0]) + "\":\"" + Escape(text) + "\"";
                    // Past what the site reads it drops the connection, and
                    // every log in the body with it. The one that would tip it
                    // over is left out instead, so the rest still arrive.
                    if (sb.Length + one.Length + 3 > LogBodyMax) continue;
                    if (n > 0) sb.Append(",");
                    sb.Append(one);
                    n++;
                }
                sb.Append("}}");
                if (n == 0) return;

                string reply;
                int code = PostJson(Site + "/api/play/logs", sb.ToString(), out reply);

                // 200 is stored, 409 is a set already there. Both mean there
                // is nothing still owed for this session, so the marker goes.
                // 404 means the site has no row for it and never will, so the
                // marker goes too rather than being retried at every start for
                // ever. Anything else is worth trying again next time.
                if (code == 200) { ClearPending(); Note("Sent " + n + " log(s) from this session to thornswood.net."); return; }
                if (code == 409) { ClearPending(); Note("This session's logs were already sent; the site kept the first set."); return; }
                if (code == 404) { ClearPending(); Note("The site has no record of that session, so its logs were not kept."); return; }
                Note("Could not send this session's logs: " +
                     (code == 0 ? "the site could not be reached" : "it answered " + code) +
                     ". They will be sent at the next start.");
            }
            catch (Exception ex)
            {
                Note("Could not send this session's logs: " + ex.Message);
            }
        }

        /// <summary>
        /// Every blocker and warning the scan found, with MORE than the
        /// launcher's own window shows.
        ///
        /// The window shows the sentence and a Fix button. The Issue carries
        /// more than that and always has: which plugin it is about, whether
        /// the file is absent or merely wrong, and the size, CRC and manifest
        /// index the server expects. On the launcher that detail would be
        /// noise in front of somebody who only wants to press Fix. On the
        /// sessions page it is the difference between "their mods were wrong"
        /// and "SkyUI_SE.esp is 402 bytes short of the server's copy", which
        /// is the one worth reading when the person is not in the room.
        ///
        /// Read here rather than sent from the Play page, because a session
        /// ends long after Play and the scan is cheap.
        /// </summary>
        static string IssuesJson()
        {
            var sb = new StringBuilder();
            sb.Append("[");
            try
            {
                int n = 0;
                foreach (Issue i in Verify.Run())
                {
                    if (i == null) continue;
                    if (n > 0) sb.Append(",");
                    sb.Append("{\"text\":\"").Append(Escape(Scrub(i.Text))).Append("\"");
                    sb.Append(",\"blocking\":").Append(i.Blocking ? "true" : "false");
                    sb.Append(",\"absent\":").Append(i.Absent ? "true" : "false");
                    if (!string.IsNullOrEmpty(i.Plugin))
                    {
                        sb.Append(",\"plugin\":\"").Append(Escape(i.Plugin)).Append("\"");
                        sb.Append(",\"wantSize\":").Append(i.WantSize.ToString(CultureInfo.InvariantCulture));
                        sb.Append(",\"wantCrc\":").Append(i.WantCrc.ToString(CultureInfo.InvariantCulture));
                        sb.Append(",\"wantIndex\":").Append(i.WantIndex.ToString(CultureInfo.InvariantCulture));
                    }
                    sb.Append("}");
                    n++;
                    if (n >= 100) break;   // a list this long is one fault, not a hundred
                }
            }
            catch (Exception ex) { Swallow.Note("Discord.IssuesJson", ex); }
            sb.Append("]");
            return sb.ToString();
        }

        /// <summary>
        /// The readiness rows the Play page shows, as they stood at the end of
        /// the session. A row that is not Ok is why Play was shut, and that is
        /// worth having against the session where somebody says they could not
        /// get in.
        /// </summary>
        static string ChecksJson()
        {
            var sb = new StringBuilder();
            sb.Append("[");
            try
            {
                int n = 0;
                foreach (Check c in Checks.All(cfgFor))
                {
                    if (c == null || c.Ok) continue;   // only what was wrong
                    if (n > 0) sb.Append(",");
                    sb.Append("{\"name\":\"").Append(Escape(Scrub(c.Name))).Append("\"");
                    sb.Append(",\"detail\":\"").Append(Escape(Scrub(c.Detail))).Append("\"}");
                    n++;
                    if (n >= 40) break;
                }
            }
            catch (Exception ex) { Swallow.Note("Discord.ChecksJson", ex); }
            sb.Append("]");
            return sb.ToString();
        }

        /// <summary>
        /// The config the checks are run against. Set once by the shell so
        /// this class does not have to reach into it.
        /// </summary>
        static Config cfgFor;
        public static void UseConfig(Config c) { cfgFor = c; }

        /// <summary>
        /// The last of a log, or "" when there is nothing worth sending.
        ///
        /// The tail, because a crash is at the end and the front of a long log
        /// is the same twenty lines of start-up every time. FileShare is
        /// everything: the game may still be letting go of these, and a log
        /// that cannot be opened is worth skipping rather than worth throwing.
        /// </summary>
        const int LogTailBytes = 192 * 1024;
        static string ReadLogTail(string path)
        {
            try
            {
                if (!File.Exists(path)) return "";
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read,
                                               FileShare.ReadWrite | FileShare.Delete))
                {
                    long len = fs.Length;
                    if (len == 0) return "";
                    int take = (int)Math.Min(len, LogTailBytes);
                    fs.Seek(len - take, SeekOrigin.Begin);
                    var buf = new byte[take];
                    int got = fs.Read(buf, 0, take);
                    string s = Encoding.UTF8.GetString(buf, 0, got);
                    // A tail almost always starts mid line. Drop the fragment
                    // so the first line in the file is a whole one.
                    if (len > take)
                    {
                        int nl = s.IndexOf('\n');
                        if (nl >= 0 && nl + 1 < s.Length) s = s.Substring(nl + 1);
                    }
                    return s;
                }
            }
            catch { return ""; }
        }

        /// <summary>
        /// The most one set of logs may come to. The site reads a body of at
        /// most 1 MB and 64 KB (server.js, /api/play/logs: SLOG_ALL plus
        /// 64 KB) and drops the connection past that, and it keeps no more
        /// than 1 MB of logs from a set anyway.
        /// </summary>
        const int LogBodyMax = 1024 * 1024;

        /// <summary>
        /// When the session being sent began, or MinValue when that is not
        /// known.
        ///
        /// Read off the pending marker, which SessionStart writes as the game
        /// starts, so it is the same answer at the end of the session and at
        /// the next launcher start after a session that took the launcher down
        /// with it. Only when the marker names this session: a marker left by
        /// another one would date the wrong window.
        /// </summary>
        static DateTime PendingSince(string pendingFile, string id)
        {
            try
            {
                if (string.IsNullOrEmpty(id) || !File.Exists(pendingFile)) return DateTime.MinValue;
                if ((File.ReadAllText(pendingFile) ?? "").Trim() != id) return DateTime.MinValue;
                return File.GetLastWriteTimeUtc(pendingFile);
            }
            catch { return DateTime.MinValue; }
        }

        /// <summary>
        /// The newest SKSE crash log written at or after sinceUtc, or "".
        ///
        /// CrashLogger names them crash-YYYY-MM-DD-HH-MM-SS.log and never
        /// deletes one, so an older crash is always sitting there, and sending
        /// it against this session would blame this session for it. With no
        /// start to measure from, none is sent. Whole, in practice: the two on
        /// Patrick's machine (19 and 22 September) are 45 KB and 48 KB, well
        /// under the tail ReadLogTail takes.
        /// </summary>
        static string CrashLogSince(string dir, DateTime sinceUtc)
        {
            try
            {
                if (sinceUtc == DateTime.MinValue || !Directory.Exists(dir)) return "";
                string best = "";
                DateTime bestAt = DateTime.MinValue;
                foreach (string f in Directory.GetFiles(dir, "crash-*.log"))
                {
                    DateTime at = File.GetLastWriteTimeUtc(f);
                    if (at < sinceUtc || at <= bestAt) continue;
                    best = f;
                    bestAt = at;
                }
                return best;
            }
            catch { return ""; }
        }

        /// <summary>
        /// This session's crash log as it is sent: a first line from the
        /// launcher naming the log, its size and the full crash snapshot
        /// beside it, then the log's tail. "" when there is no crash log.
        ///
        /// WHY THE FIRST LINE (#2319). A crash that hangs inside the crash
        /// handler leaves Crash Logger's log empty: the game's own logs stop
        /// at the second the log is named for, and the game sits until it is
        /// closed. Three dev crashes went that way between 29 Sep and 6 Oct.
        /// ReadLogTail gives "" for an empty file and an empty log is never
        /// sent, so those sessions reached the site with no crash.log, the
        /// sessions page did not mark them and the staff channel heard
        /// nothing. With this line the crash is in the set whatever the log
        /// holds, and the site marks any session whose set has a crash.log,
        /// which CrashLogSince only ever picks from this session.
        /// </summary>
        static string CrashLogText(string path)
        {
            if (string.IsNullOrEmpty(path)) return "";
            long bytes = -1;
            // The snapshot beside it, by CrashDump's own rule; only its size is read, and it is never sent.
            string dump = CrashDump.Beside(path);
            long dumpBytes = -1;
            try
            {
                if (File.Exists(path)) bytes = new FileInfo(path).Length;
                if (dump != null) dumpBytes = new FileInfo(dump).Length;
            }
            catch (Exception ex) { Swallow.Note("Discord.CrashLogText", ex); }
            string head = CrashLogHead(Path.GetFileName(path), bytes, dump == null ? "" : Path.GetFileName(dump), dumpBytes);
            string tail = bytes > 0 ? ReadLogTail(path) : "";
            return head + "\n" + tail;
        }

        /// <summary>
        /// The launcher's first line on a crash log it sends. bytes and
        /// dumpBytes are -1 when the file could not be read or is not there.
        /// The site reads "is empty" in it as the crash with nothing in its
        /// log (server.js, crashOf).
        /// </summary>
        static string CrashLogHead(string log, long bytes, string dump, long dumpBytes)
        {
            string s = "Sent by the launcher: this session crashed. Crash Logger's log of it is " + log;
            if (bytes == 0) s += ", and it is empty: 0 bytes when the launcher read it, so nothing of the crash is in it.";
            else if (bytes < 0) s += ", and it could not be read when the launcher read it.";
            else s += ", " + bytes.ToString("N0", CultureInfo.InvariantCulture) + " bytes; what it says follows.";
            if (dumpBytes >= 0)
                s += " The full crash snapshot beside it is " + dump + ", " + dumpBytes.ToString("N0", CultureInfo.InvariantCulture) +
                     " bytes; it stays on that PC.";
            else s += " There is no crash snapshot beside it.";
            return s;
        }

        /// <summary>
        /// A log with anything shaped like a voice join token or a Discord
        /// ticket taken out, before it leaves this machine.
        ///
        /// The game holds the join token (thornswood-front.js hands it to the
        /// browser page), and a crash log dumps what was on the stack, so a
        /// crash at the wrong moment could carry one, although the plugins
        /// take care never to log it. Matched by shape rather than by the
        /// current value, because the token is renewed every few minutes and
        /// the one in a crash is whichever was live then:
        /// "v2.profile.minted.nonce.signature" from voice-server.js
        /// signToken (#1322), the older "v1.profile.until.signature", and
        /// "tk1.body.signature" from the site.
        ///
        /// And who the PC belongs to (#3627). The launcher's log names files
        /// under the Windows user folder (a .NET error names the full path of
        /// the file it failed on, and Vortex keeps everything under AppData),
        /// the voice page logs its own file:// address, and the folder's name
        /// is usually the Windows account's, often a real name. None of that
        /// helps anybody read a fault, and the privacy page promises it is
        /// taken out, so the user folder, any other folder under a Users
        /// folder, the account name as a folder and the PC's name are all
        /// replaced here, the one place every log and scan line leaves by.
        /// The values are read here and not kept, so a test can hand
        /// ScrubFor its own.
        /// </summary>
        static string Scrub(string text)
        {
            return ScrubFor(text, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                            Environment.UserName, Environment.MachineName);
        }

        static string ScrubFor(string text, string profile, string user, string machine)
        {
            if (string.IsNullOrEmpty(text)) return "";
            string s = Regex.Replace(text, @"\bv1\.[0-9]+\.[0-9]+\.[A-Za-z0-9_-]{16,}", "v1.[join token removed]");
            s = Regex.Replace(s, @"\bv2\.[0-9]+\.[0-9]+\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}", "v2.[join token removed]");
            s = Regex.Replace(s, @"\btk1\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}", "tk1.[ticket removed]");
            // The join pass (#937), "jp1.body.signature" from the site's makePass.
            s = Regex.Replace(s, @"\bjp1\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}", "jp1.[join pass removed]");

            // This PC's user folder, however a log wrote it: with backslashes,
            // doubled in JSON, with forward slashes and %20 for a space in a
            // file:// address. Not when the next letter carries the name on,
            // so a folder named Al is not taken out of one named Alba.
            string[] parts = (profile ?? "").Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 2)
            {
                var sep = new string[parts.Length];
                for (int i = 0; i < parts.Length; i++) sep[i] = Regex.Escape(parts[i]).Replace("\\ ", "(?: |%20)");
                s = Regex.Replace(s, string.Join(@"[\\/]{1,2}", sep) + @"(?![\w-])", "%USERPROFILE%", RegexOptions.IgnoreCase);
            }
            // Any other folder under a Users folder: another account on this
            // PC, or this one by its short 8.3 name, spaces and all, up to the
            // separator before the next folder. Public and Default belong to
            // nobody.
            s = Regex.Replace(s, @"(\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2})(?!(?:Public|Default)[\\/])[^\\/:*?""<>|\r\n\t ]+(?: [^\\/:*?""<>|\r\n\t ]+)*(?=[\\/])",
                              "$1[user]", RegexOptions.IgnoreCase);
            // The account's name as a folder anywhere else, D:\Games\<name>\.
            if (!string.IsNullOrEmpty(user))
                s = Regex.Replace(s, @"(?<=[\\/])" + Regex.Escape(user) + @"(?=[\\/]|$|[\s""'])", "[user]",
                                  RegexOptions.IgnoreCase | RegexOptions.Multiline);
            // The PC's own name, wherever it stands as a word.
            if (!string.IsNullOrEmpty(machine))
                s = Regex.Replace(s, @"(?<![\w-])" + Regex.Escape(machine) + @"(?![\w-])", "[pc]", RegexOptions.IgnoreCase);
            return s;
        }

        /// <summary>Everything both ends send, without the closing brace.</summary>
        static string Head(int profileId)
        {
            return "{\"ticket\":\"" + Escape(Ticket) + "\"" +
                   ",\"session\":\"" + Escape(session) + "\"" +
                   (profileId > 0 ? ",\"profileId\":" + profileId : "") +
                   ",\"channel\":\"" + Escape(string.IsNullOrEmpty(Channel) ? "main" : Channel) + "\"" +
                   ",\"version\":\"" + Escape(Updater.Version) + "\"";
        }

        static void Send(string what, string url, string json)
        {
            try
            {
                if (!Linked)
                {
                    Note("Did not tell thornswood.net the session " + what +
                         ": this copy is not linked to a Discord account.");
                    return;
                }
                string reply;
                int code = PostJson(url, json, out reply);
                if (code == 200) return;
                Note("thornswood.net did not record the session " + what + ": " +
                     (code == 0 ? "the site could not be reached" : "it answered " + code) + ".");
            }
            catch (Exception ex)
            {
                Note("Could not tell thornswood.net the session " + what + ": " + ex.Message);
            }
        }

        /// <summary>
        /// Straight into launcher.log. Shell.Log writes the status line as well
        /// and has to be on the window's thread; these run on the pool.
        /// </summary>
        static void Note(string line)
        {
            try
            {
                Directory.CreateDirectory(Folder);
                File.AppendAllText(Path.Combine(Folder, "launcher.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine);
            }
            catch (Exception ex) { Swallow.Note("Discord.Note", ex); }
        }

        public static int PostJson(string url, string json, out string reply)
        {
            return Send("POST", url, json, out reply);
        }

        /// <summary>
        /// Why the last Send on this thread got no answer at all, and how long
        /// it waited, or empty when it got one. Send returns 0 for every such
        /// failure, so until 22 October a timeout, a refused connection and a
        /// name that would not resolve all reached the log as the same "not
        /// answering", and a check in that failed while the game was starting
        /// (launcher.log, 22 Oct, 13:16:06 and 13:17:44) could not say which.
        /// Per thread, because check ins run on pool threads side by side.
        /// </summary>
        [ThreadStatic] public static string LastFailure;

        /// <summary>
        /// One call to the site and whatever it answered: the status code, and
        /// the body in reply, refusals included. 0 is the site not reached at
        /// all, which is not a refusal and is never read as one.
        ///
        /// The method is the caller's, because not every door the launcher may
        /// use is a POST: the gallery queue is a GET and taking an approved
        /// picture off the gallery is a DELETE (#731). json is the body when
        /// there is one and null when there is none, so a GET asks with
        /// nothing rather than with an empty object.
        /// </summary>
        public static int Send(string method, string url, string json, out string reply)
        {
            reply = "";
            LastFailure = "";
            var took = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using (var req = new HttpRequestMessage(new HttpMethod(method), url))
                {
                    req.Headers.TryAddWithoutValidation("User-Agent", "Thornswood");
                    if (json != null)
                    {
                        req.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(json));
                        req.Content.Headers.TryAddWithoutValidation("Content-Type", "application/json");
                    }
                    using (HttpResponseMessage res = Http.Send(req, 15000))
                    {
                        // A refusal is an answer, not a failure. 403 with a
                        // reason in it is exactly what this wants to read.
                        reply = ReadReply(res, "Discord.Send, reading refusal body");
                        return (int)res.StatusCode;
                    }
                }
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TimeoutException)
            {
                // The kind, in the words the log has always used for it:
                // Timeout, ConnectFailure, NameResolutionFailure,
                // SecureChannelFailure and the like.
                LastFailure = FailureKind(ex) + " after " + took.ElapsedMilliseconds + " ms";
                return 0;
            }
            catch (Exception ex)
            {
                Swallow.Note("Discord.Send", ex);
                LastFailure = ex.GetType().Name + " after " + took.ElapsedMilliseconds + " ms";
                return 0;
            }
        }

        /// <summary>
        /// What kind of failure left a request with no answer, named as
        /// .NET Framework's WebExceptionStatus named it, so the log line
        /// (Discord.LastFailure) reads as it always has.
        /// </summary>
        static string FailureKind(Exception ex)
        {
            if (ex is TimeoutException) return "Timeout";
            var h = ex as HttpRequestException;
            if (h == null) return ex.GetType().Name;
            switch (h.HttpRequestError)
            {
                case HttpRequestError.NameResolutionError: return "NameResolutionFailure";
                case HttpRequestError.ConnectionError: return "ConnectFailure";
                case HttpRequestError.SecureConnectionError: return "SecureChannelFailure";
                case HttpRequestError.ProxyTunnelError: return "ProxyNameResolutionFailure";
                case HttpRequestError.ResponseEnded: return "ConnectionClosed";
                case HttpRequestError.InvalidResponse: return "ServerProtocolViolation";
                default: return h.HttpRequestError.ToString();
            }
        }

        /// <summary>
        /// The answer's body as text, read as the old StreamReader over the
        /// response read it (UTF-8 unless a byte order mark says otherwise).
        /// A body that will not read leaves the reply empty, said in the log
        /// under where.
        /// </summary>
        static string ReadReply(HttpResponseMessage res, string where)
        {
            try
            {
                using (var r = new StreamReader(new MemoryStream(Http.Body(res, Http.DefaultReadMs)))) return r.ReadToEnd();
            }
            catch (Exception ex)
            {
                if (res.IsSuccessStatusCode) throw;
                Swallow.Note(where, ex);
                return "";
            }
        }

        /// <summary>
        /// POST raw bytes as the request body. The gallery submit path uses
        /// this: the body IS the file, and the ticket and note ride in the
        /// query, matching /api/gallery/submit on the site. timeoutMs of 0
        /// means sixty seconds, enough for a large screenshot.
        /// </summary>
        public static int PostBytes(string url, byte[] data, string contentType, int timeoutMs, out string reply)
        {
            reply = "";
            if (data == null) data = new byte[0];
            try
            {
                using (var req = new HttpRequestMessage(HttpMethod.Post, url))
                {
                    req.Headers.TryAddWithoutValidation("User-Agent", "Thornswood");
                    req.Content = new ByteArrayContent(data);
                    req.Content.Headers.TryAddWithoutValidation("Content-Type", string.IsNullOrEmpty(contentType) ? "application/octet-stream" : contentType);
                    using (HttpResponseMessage res = Http.Send(req, timeoutMs > 0 ? timeoutMs : 60000))
                    {
                        reply = ReadReply(res, "Discord.PostBytes, reading refusal body");
                        return (int)res.StatusCode;
                    }
                }
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TimeoutException)
            {
                return 0;
            }
            catch (Exception ex)
            {
                Swallow.Note("Discord.PostBytes", ex);
                return 0;
            }
        }

        // Small enough to not want a JSON library for. Flat objects only, which
        // is all either endpoint returns.
        static string Field(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            string needle = "\"" + key + "\"";
            int i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return "";
            i = json.IndexOf(':', i + needle.Length);
            if (i < 0) return "";
            i++;
            while (i < json.Length && (json[i] == ' ' || json[i] == '\t')) i++;
            if (i >= json.Length) return "";
            if (json[i] == '"')
            {
                var sb = new StringBuilder();
                for (i++; i < json.Length; i++)
                {
                    if (json[i] == '\\' && i + 1 < json.Length)
                    {
                        i++;
                        if (json[i] == 'n') sb.Append('\n');
                        else if (json[i] == 't') sb.Append('\t');
                        else if (json[i] == 'u' && i + 4 < json.Length)
                        {
                            sb.Append((char)Convert.ToInt32(json.Substring(i + 1, 4), 16));
                            i += 4;
                        }
                        else sb.Append(json[i]);
                        continue;
                    }
                    if (json[i] == '"') break;
                    sb.Append(json[i]);
                }
                return sb.ToString();
            }
            int end = i;
            while (end < json.Length && json[end] != ',' && json[end] != '}') end++;
            return json.Substring(i, end - i).Trim();
        }

        /// <summary>
        /// A string as it goes inside quotes in JSON.
        ///
        /// Line breaks and every other control character too, not just the
        /// backslash and the quote. JSON does not allow a raw line break in a
        /// string, and the site's JSON.parse refuses the whole body over one.
        /// Every log is nothing but line breaks, so until this, every set of
        /// session logs reached the site as an empty object with no ticket in
        /// it, and the site answered 401. Measured in Profile\launcher.log on
        /// Patrick's machine on 24 September: 27 uploads since 22 September,
        /// 27 answered 401, none sent. The start and the end of each session,
        /// which carry no line break, were recorded all along.
        /// </summary>
        public static string Escape(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new StringBuilder(s.Length + 64);
            foreach (char c in s)
            {
                if (c == '\\') sb.Append("\\\\");
                else if (c == '"') sb.Append("\\\"");
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else if (c == '\t') sb.Append("\\t");
                else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else sb.Append(c);
            }
            return sb.ToString();
        }
    }
}
